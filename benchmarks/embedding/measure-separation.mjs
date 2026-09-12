// Can learned visual similarity tell a real table from an invented one?
//
//   node benchmarks/embedding/measure-separation.mjs
//
// Phase 1 established that the detector's dominant failure on degraded
// renderings is INVENTION, not blindness: `jpeg-q20` finds 45 of 46 tables and
// adds 26 imaginary ones, `hue-shift` finds 38 and adds 52. A false-positive
// problem is what a second opinion is for.
//
// But "the encoder could suppress those" is a hypothesis, and wiring a fusion
// before testing it would be building on a guess. So this measures the only
// thing that decides whether a second opinion can work at all:
//
//   Do TRUE table detections sit closer to a reference table than FALSE ones?
//
// If the two distributions overlap, no threshold and no fusion rule can
// separate them, and the honest outcome is NOT PROMOTED. This script exists to
// be able to return that answer.
//
// THE REFERENCE LIBRARY, and its honest limits. References are crops of
// HUMAN-VERIFIED annotated boxes from the ORIGINAL Golden Plan — the strongest
// reference tier available with no operator decisions yet made. Two things
// follow and are labelled rather than hidden:
//   - they come from ONE venue, so this measures within-venue separation;
//   - the encoder was trained on Golden Plan objects, so a reference crop may
//     be an object it has seen. That inflates true-positive similarity. It does
//     NOT inflate false-positive similarity, which is what the separation is
//     really about, and the FP side is the side that matters here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE);
const GOLDEN = path.join(BENCH, "plans", "merit-real-venue-plan.png");
const GOLDEN_ANNOT = JSON.parse(fs.readFileSync(path.join(BENCH, "annotations", "merit-real-venue.json"), "utf8"));

// The renderings Phase 1 marked SEVERE or WEAK on precision, plus the original
// as the control. No point measuring separation where there is nothing to
// separate.
const VARIANTS = ["ORIGINAL", "hue-shift", "contrast-high", "bright-up", "jpeg-q20", "blur", "downscale-70"];

function imageFor(id) {
  if (id === "ORIGINAL") return { file: GOLDEN, annot: GOLDEN_ANNOT };
  const a = JSON.parse(fs.readFileSync(path.join(BENCH, "robustness", "annotations", `merit-real-${id}.json`), "utf8"));
  return { file: path.join(BENCH, a.source.file), annot: a };
}

const dataUrl = f => {
  const ext = path.extname(f).toLowerCase() === ".jpg" ? "jpeg" : "png";
  return `data:image/${ext};base64,${fs.readFileSync(f).toString("base64")}`;
};

// Embed a list of boxes (in source pixels) out of an image, in the page.
async function embedBoxes(page, file, boxes) {
  return page.evaluate(async ([src, bxs]) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const gray = new Uint8Array(c.width * c.height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4)
      gray[i] = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0;
    return bxs.map(b => {
      const cand = { x: (b.cx - b.w / 2) / c.width * 100, y: (b.cy - b.h / 2) / c.height * 100,
                     w: b.w / c.width * 100, h: b.h / c.height * 100 };
      const crop = globalThis.MeritPlanEncoder.cropOf(gray, c.width, c.height, cand);
      return crop ? globalThis.MeritPlanEncoder.encode(crop) : null;
    });
  }, [dataUrl(file), boxes]);
}

async function detectOn(page, baseUrl, file) {
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(250);
  await page.fill('input[name="name"]', "Sep");
  await page.fill('input[name="hotel"]', "Sep");
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
    return {
      secondOpinion: a.diagnostics?.embedding?.secondOpinion ?? null,
      tables: a.candidates.filter(c => c.kind === "table" && c.status !== "rejected").map(c => ({
        cx: (c.x + c.w / 2) / 100 * ow, cy: (c.y + c.h / 2) / 100 * oh,
        w: c.w / 100 * ow, h: c.h / 100 * oh,
        seats: (c.chairDetections || []).length, type: c.type, confidence: c.confidence,
        // What the SHIPPED build decided, not a re-implementation of it.
        visualEvidence: c.visualEvidence ?? null,
      })),
    };
  });
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const stats = a => {
  if (!a.length) return null;
  const v = [...a].sort((x, y) => x - y);
  const q = p => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
  return { n: v.length, min: v[0], p10: q(0.1), median: q(0.5), p90: q(0.9), max: v[v.length - 1],
           mean: v.reduce((s, x) => s + x, 0) / v.length };
};
const f = x => (x == null ? "—" : x.toFixed(3));

const app = await serveApp();
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });

// ---- the reference library --------------------------------------------------
const refTables = GOLDEN_ANNOT.objects.filter(o => o.class === "table");
const refChairs = GOLDEN_ANNOT.objects.filter(o => o.class === "chair");
await page.goto(`${app.baseUrl}/index.html`);
await page.waitForLoadState("networkidle");
const tableRefs = (await embedBoxes(page, GOLDEN, refTables)).filter(Boolean);
const chairRefs = (await embedBoxes(page, GOLDEN, refChairs)).filter(Boolean);
console.log(`reference library: ${tableRefs.length} verified tables, ${chairRefs.length} verified chairs, all from the ORIGINAL Golden Plan\n`);

const report = { ranAt: new Date().toISOString(),
  referenceLibrary: { tables: tableRefs.length, chairs: chairRefs.length,
    source: "human-verified annotated boxes on the ORIGINAL Golden Plan",
    caveat: "one venue; the encoder trained on Golden objects, which inflates the true-positive side but not the false-positive side" },
  variants: [] };

console.log("variant           TP  FP   | nearest verified TABLE similarity                 | separation");
console.log("                            | TP median  TP p10 | FP median  FP p90  FP max   |");
console.log("-".repeat(104));

for (const id of VARIANTS) {
  const { file, annot } = imageFor(id);
  const run = await detectOn(page, app.baseUrl, file);
  const det = run.tables;
  const gt = annot.objects.filter(o => o.class === "table");
  const tol = ((annot.matchToleranceP ?? 3.0) / 100) * Math.hypot(annot.source.width, annot.source.height);

  // Same greedy matching the object benchmark uses, so TP/FP mean the same
  // thing here as they do in the robustness matrix.
  const pairs = [];
  gt.forEach((g, gi) => det.forEach((d, di) => {
    const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy);
    if (dist <= tol) pairs.push({ gi, di, dist });
  }));
  pairs.sort((a, b) => a.dist - b.dist);
  const usedG = new Set(), usedD = new Set();
  for (const p of pairs) {
    if (usedG.has(p.gi) || usedD.has(p.di)) continue;
    usedG.add(p.gi); usedD.add(p.di);
  }
  const tp = det.filter((_, i) => usedD.has(i));
  const fp = det.filter((_, i) => !usedD.has(i));

  const embeds = await embedBoxes(page, file, det);
  const nearest = (vec, refs) => { let best = -1; for (const r of refs) best = Math.max(best, dot(vec, r)); return best; };
  const tpSim = [], fpSim = [], fpChairSim = [];
  det.forEach((d, i) => {
    const v = embeds[i];
    if (!v) return;
    const s = nearest(v, tableRefs);
    if (usedD.has(i)) tpSim.push(s); else { fpSim.push(s); fpChairSim.push(nearest(v, chairRefs)); }
  });

  // Could the product KNOW, at runtime, whether the visual channel is usable
  // on this rendering? It cannot see TP/FP. But it can see which candidates
  // carry INDEPENDENT evidence — seats detected at them — and ask whether
  // those look different from the ones that carry none. That is not the
  // encoder judging its own guess: seats come from the chair pipeline.
  const seated = [], unseated = [];
  det.forEach((d, i) => {
    const v = embeds[i];
    if (!v) return;
    (d.seats > 0 ? seated : unseated).push(nearest(v, tableRefs));
  });
  const S = stats(seated), U = stats(unseated);
  const runtimeGap = S && U ? S.median - U.median : null;

  const T = stats(tpSim), F = stats(fpSim);
  // The honest question is not "are the means different" but "can a single cut
  // separate them": how many false positives sit above the 10th percentile of
  // the true ones, where any threshold that keeps the tables must also let them
  // through.
  const overlap = T && F ? fpSim.filter(s => s >= T.p10).length : null;
  console.log(`${id.padEnd(17)} ${String(tp.length).padStart(2)}  ${String(fp.length).padStart(2)}   |`
    + ` ${f(T?.median).padEnd(10)} ${f(T?.p10).padEnd(6)} |`
    + ` ${f(F?.median).padEnd(10)} ${f(F?.p90).padEnd(7)} ${f(F?.max).padEnd(8)} |`
    + ` ${overlap == null ? "—" : `${overlap}/${fp.length} FP above TP p10`}`);

  // ---- simulate candidate fusion rules against ground truth ---------------
  //
  // A rule is only worth wiring into the product if it removes false tables
  // WITHOUT removing real ones, on every rendering — including the one where
  // the visual channel is inverted. Simulated here, offline, before anything
  // is changed in detection.
  //
  // Every rule requires the absence of INDEPENDENT evidence (no seats) as well
  // as weak visual evidence. Similarity alone must never delete anything: that
  // is the single-threshold trap the roadmap forbids.
  const withSim = det.map((d, i) => ({ d, sim: embeds[i] ? nearest(embeds[i], tableRefs) : null, tp: usedD.has(i) }))
    .filter(x => x.sim != null);
  const sorted = [...withSim].sort((a, b) => a.sim - b.sim);
  const rules = {};
  for (const pct of [0.2, 0.3, 0.4]) {
    const cut = sorted[Math.max(0, Math.floor(pct * sorted.length) - 1)];
    const bar = cut ? cut.sim : -1;
    const removed = withSim.filter(x => x.d.seats === 0 && x.sim <= bar);
    rules[`bottom${Math.round(pct * 100)}pct+seatless`] = {
      bar: +bar.toFixed(3),
      falseRemoved: removed.filter(x => !x.tp).length,
      trueLost: removed.filter(x => x.tp).length };
  }
  for (const abs of [0.65, 0.70, 0.75]) {
    const removed = withSim.filter(x => x.d.seats === 0 && x.sim < abs);
    rules[`below${abs}+seatless`] = {
      bar: abs,
      falseRemoved: removed.filter(x => !x.tp).length,
      trueLost: removed.filter(x => x.tp).length };
  }

  // ---- what the SHIPPED second opinion actually said -----------------------
  //
  // Everything above uses an IDEALISED reference library: human-verified boxes
  // from the clean original. That is the ceiling, not the product. At runtime,
  // on a plan nobody has decided anything on yet, the library is PROVISIONAL —
  // built from the detector's own better-corroborated candidates on the
  // rendering in front of it, which on `hue-shift` is more than half invented.
  //
  // So the only number that describes the shipped feature is this one: of the
  // tables the build flagged `weak`, how many were actually false? Measured
  // from c.visualEvidence as written by src/app-v8.js, never recomputed here.
  const grade = i => det[i].visualEvidence?.strength ?? null;
  const count = (idxs, g) => idxs.filter(i => grade(i) === g).length;
  const tpIdx = det.map((_, i) => i).filter(i => usedD.has(i) && grade(i));
  const fpIdx = det.map((_, i) => i).filter(i => !usedD.has(i) && grade(i));
  const weakTp = count(tpIdx, "weak"), weakFp = count(fpIdx, "weak");
  const rateTp = tpIdx.length ? weakTp / tpIdx.length : null;
  const rateFp = fpIdx.length ? weakFp / fpIdx.length : null;
  const shipped = {
    referenceTier: run.secondOpinion?.bestTier ?? null,
    references: run.secondOpinion?.references ?? 0,
    tiers: run.secondOpinion?.tiers ?? null,
    classes: run.secondOpinion?.classes ?? null,
    graded: { tp: tpIdx.length, fp: fpIdx.length },
    weak: { tp: weakTp, fp: weakFp },
    // How much more often an invented table is called `weak` than a real one.
    // 1.0 means the channel is telling the operator nothing.
    weakLift: rateTp != null && rateFp != null && rateTp > 0 ? +(rateFp / rateTp).toFixed(2)
      : rateFp != null && rateFp > 0 && rateTp === 0 ? Infinity : null,
    // A `disagree` on a table is the encoder saying this crop is closer to the
    // plan's chairs than to its tables. Reported at every strength, because
    // gating it behind strength hid the signal on exactly the renderings where
    // the detector invents most. `tp` is the false-alarm side and is the number
    // that decides whether the class channel is worth showing at all.
    disagree: { tp: tpIdx.filter(i => det[i].visualEvidence.agreement === "disagree").length,
                fp: fpIdx.filter(i => det[i].visualEvidence.agreement === "disagree").length },
  };

  report.variants.push({ variant: id, tp: tp.length, fp: fp.length, fusionRules: rules,
    tpSimilarity: T, fpSimilarity: F, fpNearestChairSimilarity: stats(fpChairSim),
    falsePositivesAboveTruePercentile10: overlap,
    separable: T && F ? overlap / Math.max(1, fp.length) : null,
    runtimeProxy: { seated: S, unseated: U, medianGap: runtimeGap },
    shippedSecondOpinion: shipped });
}

await browser.close();
await app.close();

console.log("\nSIMULATED FUSION RULES — false tables removed / REAL tables lost");
const ruleNames = Object.keys(report.variants[0].fusionRules);
console.log("  variant           " + ruleNames.map(n => n.padEnd(22)).join(""));
for (const v of report.variants) {
  console.log("  " + v.variant.padEnd(17)
    + ruleNames.map(n => {
        const r = v.fusionRules[n];
        return `${r.falseRemoved}/${r.trueLost}`.padEnd(22);
      }).join(""));
}
console.log("  A rule is usable only if the RIGHT number is 0 on every rendering.");

console.log("\nRUNTIME PROXY — can the product tell, without ground truth, whether to trust the channel?");
console.log("  Candidates WITH detected seats vs WITHOUT. Seats come from the chair pipeline, so this");
console.log("  is independent evidence, not the encoder grading its own homework.");
console.log("  variant           seated median  unseated median  gap");
for (const v of report.variants) {
  const r = v.runtimeProxy;
  console.log(`  ${v.variant.padEnd(17)} ${f(r.seated?.median).padEnd(14)} ${f(r.unseated?.median).padEnd(16)} ${f(r.medianGap)}`);
}

console.log("\nSHIPPED SECOND OPINION — what src/app-v8.js actually wrote onto each candidate");
console.log("  Reference library is PROVISIONAL here (no operator decisions exist on these plans),");
console.log("  which is the weakest tier and the runtime default. Read as: of the tables graded");
console.log("  `weak`, how many were invented? weakLift 1.0 = the channel says nothing.");
console.log("  variant           tier          refs  weak TP/graded  weak FP/graded  weakLift  'closer to a chair' TP/FP");
for (const v of report.variants) {
  const s = v.shippedSecondOpinion;
  console.log(`  ${v.variant.padEnd(17)} ${String(s.referenceTier).padEnd(13)} ${String(s.references).padStart(4)}`
    + `  ${`${s.weak.tp}/${s.graded.tp}`.padEnd(14)}  ${`${s.weak.fp}/${s.graded.fp}`.padEnd(14)}`
    + `  ${String(s.weakLift).padEnd(8)}  ${s.disagree.tp}/${s.disagree.fp}`);
}
console.log("  The class column is read TP/FP: the left number is real tables wrongly called chair-like");
console.log("  (a false alarm shown to the operator), the right is invented tables correctly flagged.");

console.log("\nREADING THIS TABLE");
console.log("  'FP above TP p10' is the number of invented tables that a cut low enough to keep");
console.log("  90% of the real ones would also admit. Small = the encoder can help. Close to the");
console.log("  FP count = it cannot, and no fusion rule built on it would be honest.");

fs.writeFileSync(path.join(HERE, "separation.json"), JSON.stringify(report, null, 1) + "\n");
console.log(`\nwrote ${path.relative(process.cwd(), path.join(HERE, "separation.json"))}`);
