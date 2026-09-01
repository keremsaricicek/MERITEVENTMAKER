// Every false positive, and why it survived.
//
//   npm run benchmark:false-positives
//
// The robustness matrix says `hue-shift` invents 52 tables and `downscale-70`
// invents 73 chairs. It does not say what those objects ARE, and without that
// any fix is a threshold chosen because it happens to move a number. A
// threshold tuned on one rendering's score is indistinguishable from a
// threshold tuned on that rendering's filename.
//
// So this inspects every false positive individually and assigns it ONE cause,
// from a fixed priority order, using evidence that exists independently of the
// detector: the annotation's own text and architecture regions, the annotated
// objects themselves, and the geometry of what was detected. Then it records
// what the pipeline actually knew about that object at the moment it accepted
// it — which stage proposed it, what family it landed in, what the learned
// channel said — so a fix can be aimed at a stage rather than at a number.
//
// It also writes a debug image per rendering: green true positives, red false
// positives, orange misses, each labelled. A failure you can look at is a
// different kind of problem from one you can only tabulate.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE);
const OUT = path.join(HERE, "debug");
const GOLDEN = path.join(BENCH, "plans", "merit-real-venue-plan.png");
const GOLDEN_ANNOT = JSON.parse(fs.readFileSync(path.join(BENCH, "annotations", "merit-real-venue.json"), "utf8"));

const VARIANTS = process.argv.slice(2).filter(a => !a.startsWith("--"));
const DEFAULT = ["ORIGINAL", "hue-shift", "jpeg-q20", "downscale-70", "bright-up",
                 "bright-down", "contrast-high", "lowres-roundtrip", "blur", "noise", "grayscale"];
const LIST = VARIANTS.length ? VARIANTS : DEFAULT;

function imageFor(id) {
  if (id === "ORIGINAL") return { file: GOLDEN, annot: GOLDEN_ANNOT };
  const a = JSON.parse(fs.readFileSync(path.join(BENCH, "robustness", "annotations", `merit-real-${id}.json`), "utf8"));
  return { file: path.join(BENCH, a.source.file), annot: a };
}

const dataUrl = f => {
  const ext = path.extname(f).toLowerCase() === ".jpg" ? "jpeg" : "png";
  return `data:image/${ext};base64,${fs.readFileSync(f).toString("base64")}`;
};

async function analyse(page, baseUrl, file) {
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(250);
  await page.fill('input[name="name"]', "FP");
  await page.fill('input[name="hotel"]', "FP");
  await page.fill('input[name="date"]', "2026-10-02");
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(600);
  await page.evaluate(src => {
    state.events[0].background = { src, name: "p", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, dataUrl(file));
  await page.waitForTimeout(300);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const a = state.events[0].analysis;
    const ow = a.originalWidth, oh = a.originalHeight;
    // Everything the pipeline knew about this object when it kept it. Reported
    // from the candidate itself rather than re-derived, so "which stage let
    // this through" is answerable rather than inferred.
    const provenance = c => ({
      source: c.evidence && c.evidence.source || null,
      shapeBasis: c.evidence && c.evidence.shapeBasis || null,
      sizeAgreement: c.evidence && c.evidence.sizeAgreement != null ? c.evidence.sizeAgreement : null,
      repetition: c.evidence && c.evidence.repetition != null ? c.evidence.repetition : null,
      split: !!(c.evidence && c.evidence.split),
      geometry: c.evidence && c.evidence.geometry != null ? c.evidence.geometry : null,
      seats: (c.chairDetections || []).length,
      confidence: c.confidence,
      selected: c.selected !== false,
      lowEvidence: c.lowEvidence ? c.lowEvidence.reason : null,
      typeEvidence: c.typeEvidence || null,
      visual: c.visualEvidence ? { strength: c.visualEvidence.strength,
        agreement: c.visualEvidence.agreement, nearest: c.visualEvidence.nearestClass,
        similarity: c.visualEvidence.similarity } : null,
    });
    const box = c => ({ x: c.x / 100 * ow, y: c.y / 100 * oh, w: c.w / 100 * ow, h: c.h / 100 * oh,
      cx: (c.x + c.w / 2) / 100 * ow, cy: (c.y + c.h / 2) / 100 * oh });
    const alive = a.candidates.filter(c => c.status !== "rejected");
    // A table candidate and the seats attached to it, in the SAME frame, so
    // "is this object the same thing as its own seat?" is answerable. A real
    // table's seats sit around its perimeter; a chair promoted to a table
    // contains one seat that fills it.
    const seatGeometry = c => {
      const b = box(c), seats = c.chairDetections || [];
      if (!seats.length) return { seatFill: 0, containedSeats: 0 };
      let area = 0, contained = 0;
      for (const ch of seats) {
        const sw = ch.w / 100 * ow, sh = ch.h / 100 * oh;
        const scx = ch.x / 100 * ow, scy = ch.y / 100 * oh;
        area += sw * sh;
        if (scx > b.x && scx < b.x + b.w && scy > b.y && scy < b.y + b.h) contained++;
      }
      return { seatFill: +(area / Math.max(1, b.w * b.h)).toFixed(3), containedSeats: contained };
    };
    const tables = alive.filter(c => c.kind === "table")
      .map(c => ({ id: c.id, type: c.type, ...box(c), ...provenance(c), ...seatGeometry(c) }));
    // A seat is a chair whether it is nested on a table or standing alone; the
    // object benchmark scores them together and so does this.
    const chairs = [];
    for (const c of alive) {
      for (const ch of c.chairDetections || [])
        chairs.push({ id: ch.id, type: "chair", nested: true, parent: c.id,
          x: (ch.x - ch.w / 2) / 100 * ow, y: (ch.y - ch.h / 2) / 100 * oh,
          w: ch.w / 100 * ow, h: ch.h / 100 * oh,
          cx: ch.x / 100 * ow, cy: ch.y / 100 * oh, confidence: ch.confidence, source: "associated" });
      if (c.kind === "venue" && c.type === "chair")
        chairs.push({ id: c.id, type: "chair", nested: false, parent: null, ...box(c), ...provenance(c) });
    }
    return { tables, chairs, ow, oh,
      diagnostics: { detectionPath: a.diagnostics.detectionPath, chairSource: a.diagnostics.chairSource,
        chairsReseated: a.diagnostics.chairsReseated, tableModalArea: a.diagnostics.tableModalArea } };
  });
}

// Greedy nearest-first matching, the same one every other benchmark uses, so a
// false positive means the same thing here as it does everywhere else.
function match(gt, det, tol) {
  const pairs = [];
  gt.forEach((g, gi) => det.forEach((d, di) => {
    const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy);
    if (dist <= tol) pairs.push({ gi, di, dist });
  }));
  pairs.sort((a, b) => a.dist - b.dist);
  const usedG = new Set(), usedD = new Set(), pairOf = new Map();
  for (const p of pairs) {
    if (usedG.has(p.gi) || usedD.has(p.di)) continue;
    usedG.add(p.gi); usedD.add(p.di); pairOf.set(p.di, p.gi);
  }
  return { usedG, usedD, pairOf };
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
};
const inside = (r, cx, cy) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;

// ONE cause per false positive, assigned in this order. The order matters: an
// object that is both a fragment and sitting on printed text is a text
// artifact, because that is the fact a fix would act on.
const CAUSES = ["duplicate", "text", "architecture-edge", "on-a-real-chair",
                "between-seats", "merged-span", "fragment", "oversized", "unplaced"];

function classify(d, ctx) {
  const { annot, gtSame, gtChairs, gtTables, accepted, modalArea, planW, planH } = ctx;

  // A second box on an object something else already matched. Not an invented
  // object at all — a duplication, and a different fix.
  for (const a of accepted) if (iou(a, d) > 0.3) return "duplicate";

  const regions = annot.regions || [];
  for (const r of regions)
    if (r.class === "text" && inside(r, d.cx, d.cy)) return "text";

  // The room outline covers the whole drawing, so containment in it says
  // nothing. What does say something is sitting ON one of its edges: the
  // perimeter wall read as furniture.
  for (const r of regions) {
    if (r.class !== "architecture") continue;
    const coversPlan = r.w * r.h > 0.5 * planW * planH;
    if (!coversPlan) { if (inside(r, d.cx, d.cy)) return "architecture-edge"; continue; }
    const band = Math.max(12, Math.min(d.w, d.h));
    const nearEdge = Math.abs(d.cx - r.x) < band || Math.abs(d.cx - (r.x + r.w)) < band
      || Math.abs(d.cy - r.y) < band || Math.abs(d.cy - (r.y + r.h)) < band;
    if (nearEdge) return "architecture-edge";
  }

  // Sitting on an annotated object of the OTHER class: a table drawn over a
  // real chair, or a chair over a real table. The object is real; the class is
  // not.
  const otherClass = gtSame === "table" ? gtChairs : gtTables;
  for (const g of otherClass) {
    const tol = Math.max(g.w, g.h) * 0.6;
    if (Math.hypot(g.cx - d.cx, g.cy - d.cy) <= tol) return "on-a-real-chair";
  }

  // The gap between two neighbouring seats of the same table, read as its own
  // object. Two annotated chairs close together with this centre between them.
  for (let i = 0; i < gtChairs.length; i++) for (let j = i + 1; j < gtChairs.length; j++) {
    const a = gtChairs[i], b = gtChairs[j];
    const span = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    if (span > Math.max(a.w, a.h) * 2.6) continue;
    const mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
    if (Math.hypot(mx - d.cx, my - d.cy) < Math.max(a.w, a.h) * 0.5) return "between-seats";
  }

  // One box swallowing several real objects, or spanning across them.
  const spanned = gtTables.concat(gtChairs).filter(g => inside(d, g.cx, g.cy)).length;
  if (spanned >= 2) return "merged-span";

  const area = d.w * d.h;
  if (modalArea && area < modalArea * 0.4) return "fragment";
  if (modalArea && area > modalArea * 3) return "oversized";
  return "unplaced";
}

fs.mkdirSync(OUT, { recursive: true });
const app = await serveApp();
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });

const report = { ranAt: new Date().toISOString(), causes: CAUSES, variants: [] };

for (const id of LIST) {
  const { file, annot } = imageFor(id);
  const run = await analyse(page, app.baseUrl, file);
  const tol = ((annot.matchToleranceP ?? 3.0) / 100) * Math.hypot(annot.source.width, annot.source.height);
  const gtTables = annot.objects.filter(o => o.class === "table").map(o => ({ ...o, x: o.cx - o.w / 2, y: o.cy - o.h / 2 }));
  const gtChairs = annot.objects.filter(o => o.class === "chair").map(o => ({ ...o, x: o.cx - o.w / 2, y: o.cy - o.h / 2 }));

  const areas = a => { const v = a.map(o => o.w * o.h).sort((x, y) => x - y); return v[v.length >> 1] || 0; };
  const modalTable = areas(gtTables), modalChair = areas(gtChairs);

  const out = { variant: id, classes: {} };
  for (const [cls, gt, det, modal] of [["table", gtTables, run.tables, modalTable],
                                       ["chair", gtChairs, run.chairs, modalChair]]) {
    const m = match(gt, det, tol);
    const accepted = det.filter((_, i) => m.usedD.has(i));
    const falses = det.map((d, i) => ({ d, i })).filter(x => !m.usedD.has(x.i));
    const missed = gt.filter((_, i) => !m.usedG.has(i));
    const ctx = { annot, gtSame: cls, gtChairs, gtTables, accepted, modalArea: modal,
      planW: annot.source.width, planH: annot.source.height };
    const byCause = {};
    const detail = [];
    for (const { d } of falses) {
      const cause = classify(d, ctx);
      byCause[cause] = (byCause[cause] || 0) + 1;
      detail.push({ cause, id: d.id, x: Math.round(d.x), y: Math.round(d.y),
        w: Math.round(d.w), h: Math.round(d.h), type: d.type,
        source: d.source, shapeBasis: d.shapeBasis, sizeAgreement: d.sizeAgreement,
        repetition: d.repetition, split: d.split, seats: d.seats, nested: d.nested,
        seatFill: d.seatFill, containedSeats: d.containedSeats,
        selected: d.selected, lowEvidence: d.lowEvidence,
        confidence: d.confidence, visual: d.visual });
    }
    out.classes[cls] = { gt: gt.length, detected: det.length, tp: accepted.length,
      fp: falses.length, fn: missed.length, byCause, falsePositives: detail,
      // The SAME evidence for the objects that are real. A separator measured
      // only on false positives is a separator nobody has priced.
      truePositives: accepted.map(d => ({ id: d.id, type: d.type, source: d.source,
        w: Math.round(d.w), h: Math.round(d.h),
        sizeAgreement: d.sizeAgreement, split: d.split, seats: d.seats,
        seatFill: d.seatFill, containedSeats: d.containedSeats,
        selected: d.selected, lowEvidence: d.lowEvidence,
        confidence: d.confidence, visual: d.visual })),
      // The boxes the debug image draws.
      draw: { tp: accepted.map(d => ({ ...d, mark: "tp" })),
              fp: falses.map(x => ({ ...x.d, mark: "fp", cause: classify(x.d, ctx) })),
              fn: missed.map(g => ({ x: g.x, y: g.y, w: g.w, h: g.h, mark: "fn", type: g.type || cls })) } };
  }
  out.diagnostics = run.diagnostics;
  // The plan's OWN modal areas, from what was detected rather than from the
  // annotation: a rule that has to run at detection time can only use these.
  const med = a => { const v = a.slice().sort((x, y) => x - y); return v[v.length >> 1] || 0; };
  out.detectedModal = {
    table: Math.round(med(run.tables.map(t => t.w * t.h))),
    chair: Math.round(med(run.chairs.map(c => c.w * c.h))),
  };

  // ---- the debug image ---------------------------------------------------
  const png = await page.evaluate(async ([src, tables, chairs, W, H]) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, W, H);
    x.globalAlpha = 0.35; x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.globalAlpha = 1;
    const COLOR = { tp: "#137a3e", fp: "#c02626", fn: "#d98218" };
    const draw = (list, lw) => {
      for (const b of list) {
        x.strokeStyle = COLOR[b.mark]; x.lineWidth = lw;
        x.strokeRect(b.x, b.y, b.w, b.h);
        if (b.mark !== "tp") {
          x.fillStyle = COLOR[b.mark]; x.font = "bold 11px sans-serif";
          x.fillText(b.cause || b.type || "", b.x, Math.max(10, b.y - 2));
        }
      }
    };
    for (const cls of [chairs, tables]) { draw(cls.fn, 2); draw(cls.tp, 1.5); draw(cls.fp, 2.5); }
    return c.toDataURL("image/png");
  }, [dataUrl(file), out.classes.table.draw, out.classes.chair.draw, annot.source.width, annot.source.height]);
  fs.writeFileSync(path.join(OUT, `${id}.png`), Buffer.from(png.split(",")[1], "base64"));

  // The draw lists are only for the image; they would triple the report.
  delete out.classes.table.draw; delete out.classes.chair.draw;
  report.variants.push(out);

  const t = out.classes.table, ch = out.classes.chair;
  console.log(`\n=== ${id}`);
  const heldT = t.falsePositives.filter(f => f.selected === false).length;
  const heldReal = (out.classes.table.truePositives || []).filter(f => f.selected === false).length;
  out.classes.table.committed = { fp: t.fp - heldT, tp: t.tp - heldReal, heldFalse: heldT, heldReal };
  console.log(`  tables  TP ${t.tp}  FP ${t.fp}  FN ${t.fn}`
    + `   | committed TP ${t.tp - heldReal}  FP ${t.fp - heldT}  (held back ${heldT} false, ${heldReal} real)`
    + (t.fp ? `   ${Object.entries(t.byCause).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(", ")}` : ""));
  console.log(`  chairs  TP ${ch.tp}  FP ${ch.fp}  FN ${ch.fn}`
    + (ch.fp ? `   ${Object.entries(ch.byCause).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(", ")}` : ""));
}

await browser.close();
await app.close();

// ---- what the pipeline knew, per cause ---------------------------------------
const pooled = {};
for (const v of report.variants) for (const cls of ["table", "chair"])
  for (const fp of v.classes[cls].falsePositives) {
    const k = `${cls}:${fp.cause}`;
    pooled[k] = pooled[k] || { n: 0, seats: 0, weakVisual: 0, gradedVisual: 0, split: 0,
      sizeAgreement: [], sources: {} };
    const p = pooled[k];
    p.n++;
    if (fp.seats) p.seats++;
    if (fp.visual) { p.gradedVisual++; if (["weak", "unknown"].includes(fp.visual.strength)) p.weakVisual++; }
    if (fp.split) p.split++;
    if (typeof fp.sizeAgreement === "number") p.sizeAgreement.push(fp.sizeAgreement);
    if (fp.source) p.sources[fp.source] = (p.sources[fp.source] || 0) + 1;
  }

console.log("\n\nWHAT THE PIPELINE KNEW, POOLED BY CAUSE");
console.log("cause                          n   withSeats  weakVisual/graded  split  medianAgreement  top source");
for (const [k, p] of Object.entries(pooled).sort((a, b) => b[1].n - a[1].n)) {
  const med = p.sizeAgreement.length
    ? p.sizeAgreement.sort((a, b) => a - b)[p.sizeAgreement.length >> 1].toFixed(2) : "—";
  const src = Object.entries(p.sources).sort((a, b) => b[1] - a[1])[0];
  console.log(`${k.padEnd(28)} ${String(p.n).padStart(3)}  ${String(p.seats).padStart(9)}`
    + `  ${`${p.weakVisual}/${p.gradedVisual}`.padStart(17)}  ${String(p.split).padStart(5)}`
    + `  ${med.padStart(15)}  ${src ? `${src[0]} (${src[1]})` : "—"}`);
}
report.pooledByCause = pooled;

// ---- proposed vs committed, and the gates ------------------------------------
//
// Two different numbers, both reported, neither hidden.
//
//   PROPOSED  — every candidate the detector kept. This is what
//               benchmarks/robustness/ measures and it is unchanged by any
//               review gate: the detector still proposes what it proposes.
//   COMMITTED — the candidates that would land on the floor plan if an operator
//               pressed Confirm Plan without reviewing anything. This is the
//               false positive an operator actually pays for.
//
// A gate that only moved the second number while pretending to move the first
// would be hiding false positives to improve F1. Both are printed side by side
// for exactly that reason.
console.log("\n\nPROPOSED vs COMMITTED TABLES");
console.log("variant           proposed TP/FP   committed TP/FP   held by the seat-containment gate (false/real)");
const failures = [];
for (const v of report.variants) {
  const t = v.classes.table;
  const gate = x => x.lowEvidence === "seatsInsideBody";
  const gatedFalse = t.falsePositives.filter(gate).length;
  const gatedReal = (t.truePositives || []).filter(gate).length;
  v.classes.table.gate = { heldFalse: gatedFalse, heldReal: gatedReal };
  console.log(`  ${v.variant.padEnd(17)} ${`${t.tp}/${t.fp}`.padEnd(16)} ${`${t.committed.tp}/${t.committed.fp}`.padEnd(17)} ${gatedFalse}/${gatedReal}`);
  // The one gate that must never fail. A structural rule that starts costing
  // real tables is a rule that has to come out, whatever it does for a score.
  if (gatedReal > 0)
    failures.push(`${v.variant}: the seat-containment gate held back ${gatedReal} REAL table(s)`);
}
const original = report.variants.find(v => v.variant === "ORIGINAL");
if (original && original.classes.table.committed.tp !== original.classes.table.tp)
  failures.push(`ORIGINAL: ${original.classes.table.tp - original.classes.table.committed.tp} real table(s) would not be committed on the clean plan`);

const totals = report.variants.reduce((a, v) => ({
  proposedFp: a.proposedFp + v.classes.table.fp,
  committedFp: a.committedFp + v.classes.table.committed.fp,
  heldFalse: a.heldFalse + v.classes.table.gate.heldFalse,
  heldReal: a.heldReal + v.classes.table.gate.heldReal,
}), { proposedFp: 0, committedFp: 0, heldFalse: 0, heldReal: 0 });
report.totals = totals;
console.log(`\n  across all renderings: proposed FP ${totals.proposedFp}, committed FP ${totals.committedFp};`
  + ` the gate held ${totals.heldFalse} false and ${totals.heldReal} real tables.`);

fs.writeFileSync(path.join(HERE, "report.json"), JSON.stringify(report, null, 1) + "\n");
console.log(`\nwrote ${path.relative(process.cwd(), path.join(HERE, "report.json"))}`);
console.log(`debug images in ${path.relative(process.cwd(), OUT)}/  (green TP, red FP with cause, orange FN)`);
console.log("\nREAL DISTINCT VENUE PLANS: 1. Every rendering is the same drawing.");
if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("\nAll gates met: the seat-containment gate has never held back a real table.");
