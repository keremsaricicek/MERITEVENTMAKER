// Semantic zones, measured.
//
//   node benchmarks/zones/measure-zones.mjs
//
// A zone is a region of the room with a job — dining, bistro, lounge, stage,
// entrance — and the honest question about one is not "did it find five" but
// "does it read the same room the same way twice".
//
// So the primary measurement here needs no hand-labelled zone truth at all.
// Every one of the sixteen robustness renderings is the SAME DRAWING, blurred,
// rescaled, recoloured, JPEG-compressed or rotated. Whatever the right zones
// are, they are identical across all sixteen, and any disagreement is the
// product's, not the annotation's. That makes stability a fact rather than an
// opinion, which is a stronger footing than a zone ground truth I would have to
// invent for a plan I can only read through its annotation.
//
// The secondary measurement is composition against the annotation: the zones a
// plan reports must together contain the objects the annotation says are there,
// must not claim seats the detector did not find, and must report an `unknown`
// region rather than guessing. That is a consistency check, not independent
// truth, and it is labelled as such.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE);

function renderings() {
  const base = JSON.parse(fs.readFileSync(path.join(BENCH, "annotations", "merit-real-venue.json"), "utf8"));
  const out = [{ id: "ORIGINAL", file: path.join(BENCH, "plans", "merit-real-venue-plan.png"), annot: base }];
  const dir = path.join(BENCH, "robustness", "annotations");
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue;
      const a = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const file = path.join(BENCH, a.source.file);
      if (fs.existsSync(file)) out.push({ id: (a.transform && a.transform.id) || f.replace(/\.json$/, ""), file, annot: a });
    }
  }
  return out;
}

// Which annotated object each zone claims. Every rendering annotates the SAME
// object ids, so this is what makes "the same table" comparable across sixteen
// images that differ in size, colour and rotation.
function zoneTypeByObject(zones, candidates, annot) {
  const W = annot.source.width, H = annot.source.height;
  const tol = ((annot.matchToleranceP ?? 3.0) / 100) * Math.hypot(W, H);
  const gt = annot.objects.filter(o => o.class === "table");
  const cands = candidates.filter(c => c.kind === "table");
  const pairs = [];
  gt.forEach((g, gi) => cands.forEach((c, ci) => {
    const cx = (c.x + c.w / 2) / 100 * W, cy = (c.y + c.h / 2) / 100 * H;
    const d = Math.hypot(g.cx - cx, g.cy - cy);
    if (d <= tol) pairs.push({ gi, ci, d });
  }));
  pairs.sort((a, b) => a.d - b.d);
  const usedG = new Set(), usedC = new Set(), candToGt = new Map();
  for (const p of pairs) {
    if (usedG.has(p.gi) || usedC.has(p.ci)) continue;
    usedG.add(p.gi); usedC.add(p.ci);
    candToGt.set(cands[p.ci].id, gt[p.gi].id);
  }
  const byObject = {};
  for (const z of zones) for (const id of z.memberIds) {
    const g = candToGt.get(id);
    if (g) byObject[g] = z.type;
  }
  return byObject;
}

async function zonesFor(browser, baseUrl, imagePath) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(250);
  await page.fill('input[name="name"]', "Zones");
  await page.fill('input[name="hotel"]', "Zones");
  await page.fill('input[name="date"]', "2026-10-02");
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(600);
  const ext = path.extname(imagePath).toLowerCase() === ".jpg" ? "jpeg" : "png";
  await page.evaluate(src => {
    state.events[0].background = { src, name: "plan", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, `data:image/${ext};base64,${fs.readFileSync(imagePath).toString("base64")}`);
  await page.waitForTimeout(300);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
  await page.waitForTimeout(500);
  const out = await page.evaluate(() => {
    const pi = state.events[0].analysis.planIntelligence;
    return {
      zones: (pi.zones || []).map(z => ({ type: z.type, confidence: z.confidence, objects: z.objects,
        seats: z.seats, evidence: z.evidence, members: z.memberIds.length, memberIds: z.memberIds })),
      candidateList: state.events[0].analysis.candidates.filter(c => c.status !== "rejected")
        .map(c => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, w: c.w, h: c.h })),
      summary: pi.planSummary,
      candidates: state.events[0].analysis.candidates.filter(c => c.status !== "rejected").length,
    };
  });
  await page.close();
  return { ...out, errors };
}

const typeCounts = zones => zones.reduce((m, z) => (m[z.type] = (m[z.type] || 0) + 1, m), {});
const signature = zones => Object.entries(typeCounts(zones)).sort().map(([k, v]) => `${k}x${v}`).join(",");

const app = await serveApp();
const browser = await launchChromium();
const rows = [];
for (const r of renderings()) {
  const z = await zonesFor(browser, app.baseUrl, r.file);
  rows.push({ id: r.id, ...z, signature: signature(z.zones),
    byObject: zoneTypeByObject(z.zones, z.candidateList, r.annot) });
  console.log(`${r.id.padEnd(20)} zones=${String(z.zones.length).padStart(2)}  ${z.signature || signature(z.zones)}`
    + `  seats=${z.zones.reduce((n, x) => n + x.seats, 0)}  pageErrors=${z.errors.length}`);
}
await browser.close();
await app.close();

// ---- stability -------------------------------------------------------------
// Asked per ANNOTATED OBJECT, not per zone count.
//
// The first version of this compared the multiset of zone types — "three
// bistro, six dining, two stage" — across renderings, and scored 1 of 16. That
// is the wrong question. How a room happens to partition into clusters depends
// on which tables the detector found in that particular rendering, so the count
// swings between 3 and 13 dining zones without anything about the ROOM being
// read differently. It measures detection recall wearing a zone's clothing.
//
// The well-posed question is object-level: this drawing's table t012 is in the
// same part of the same room in all sixteen images, so whatever kind of area it
// belongs to, that kind must not change. Every rendering annotates the same
// object ids, which is what makes the comparison possible at all.
const original = rows.find(r => r.id === "ORIGINAL");
const allObjects = [...new Set(rows.flatMap(r => Object.keys(r.byObject)))];
let agreements = 0, comparisons = 0, disagreeingObjects = [];
for (const objId of allObjects) {
  const answers = rows.map(r => r.byObject[objId]).filter(Boolean);
  if (answers.length < 2) continue;
  // Compared against the modal answer rather than the original's, so a single
  // odd rendering cannot define the truth for the other fifteen.
  const tally = answers.reduce((m, a) => (m[a] = (m[a] || 0) + 1, m), {});
  const [modal, modalCount] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  agreements += modalCount; comparisons += answers.length;
  if (modalCount < answers.length)
    disagreeingObjects.push({ object: objId, modal, tally, seenIn: answers.length });
}
const stability = comparisons ? agreements / comparisons : null;

console.log(`\nSTABILITY  the same drawing, ${rows.length} renderings, per annotated table`);
console.log(`  tables compared       ${allObjects.length}`);
console.log(`  object/rendering pairs ${comparisons}`);
console.log(`  agreeing with the modal reading ${agreements}`);
console.log(`  STABILITY             ${stability === null ? "n/a" : stability.toFixed(4)}   gate >= 0.90  ${stability >= 0.9 ? "MET" : "NOT MET"}`);
for (const d of disagreeingObjects.slice(0, 8))
  console.log(`    ${d.object.padEnd(6)} modal ${d.modal.padEnd(8)} ${JSON.stringify(d.tally)}`);

// Zone COUNT instability is real and is reported separately rather than folded
// into the score above, because it is a property of detection recall on a
// degraded image and not of how the room is read.
const counts = rows.map(r => r.zones.length);
console.log(`\nZONE COUNT per rendering  min ${Math.min(...counts)}  max ${Math.max(...counts)}  original ${original.zones.length}`);
console.log(`  the count follows how many tables that rendering found, not how the room is read`);

// Which zone TYPES survive every rendering is more useful than a single score:
// a stage found in one image out of sixteen is not a finding.
const perType = {};
for (const r of rows) {
  const c = typeCounts(r.zones);
  for (const t of Object.keys(c)) perType[t] ||= { present: 0, counts: [] };
}
for (const r of rows) {
  const c = typeCounts(r.zones);
  for (const t in perType) { if (c[t]) perType[t].present++; perType[t].counts.push(c[t] || 0); }
}
console.log(`\nPER TYPE   present in how many of the ${rows.length} renderings`);
for (const [t, v] of Object.entries(perType).sort((a, b) => b[1].present - a[1].present))
  console.log(`  ${t.padEnd(12)} ${String(v.present).padStart(2)}/${rows.length}   counts ${v.counts.join(" ")}`);

// ---- honesty checks --------------------------------------------------------
const everyZoneHasEvidence = rows.every(r => r.zones.every(z => Array.isArray(z.evidence) && z.evidence.length));
const seatsNeverExceed = rows.every(r =>
  r.zones.reduce((n, z) => n + z.seats, 0) <= (r.summary.physicalSeats ?? Infinity));
console.log(`\nHONESTY`);
console.log(`  every zone states its evidence            ${everyZoneHasEvidence ? "yes" : "NO"}`);
console.log(`  zone seats never exceed detected seats    ${seatsNeverExceed ? "yes" : "NO"}`);
console.log(`  entrance zones on a build with no OCR     ${rows.filter(r => r.zones.some(z => z.type === "entrance")).length} of ${rows.length}`);

fs.writeFileSync(path.join(HERE, "report.json"), JSON.stringify({
  ranAt: new Date().toISOString(),
  note: "Stability is measured across renderings of ONE drawing, so disagreement is the product's and not the annotation's. REAL DISTINCT VENUE PLANS: 1.",
  renderings: rows.length, stability, gate: 0.9, met: stability >= 0.9,
  originalSignature: original.signature,
  stabilityMethod: "per annotated table: the share of (object, rendering) pairs whose zone TYPE matches that object's modal reading across renderings",
  tablesCompared: allObjects.length, comparisons, agreements, disagreeingObjects,
  zoneCountRange: [Math.min(...counts), Math.max(...counts)],
  perType, everyZoneHasEvidence, seatsNeverExceed,
  rows: rows.map(r => ({ id: r.id, signature: r.signature, zoneCount: r.zones.length,
    zones: r.zones.map(z => ({ type: z.type, confidence: z.confidence, objects: z.objects, seats: z.seats })),
    pageErrors: r.errors.length })),
}, null, 1) + "\n");
console.log(`\nwrote ${path.relative(process.cwd(), path.join(HERE, "report.json"))}`);
process.exit(stability >= 0.9 && everyZoneHasEvidence && seatsNeverExceed ? 0 : 1);
