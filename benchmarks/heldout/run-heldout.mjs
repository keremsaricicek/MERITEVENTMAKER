// The first look at a venue this system has never seen.
//
//   npm run benchmark:heldout -- <plan-image> <annotation.json>
//   npm run benchmark:heldout                 # status only, no plan supplied
//
// Every number in this repository was produced on ONE drawing. The robustness
// matrix is that drawing re-rendered sixteen ways; the encoder was trained on
// crops from it; the interpreter, the contradiction engine and the review queue
// were all tuned while looking at it. A system in that position does not know
// how well it generalises, and the honest label for that is
// CROSS-VENUE GENERALIZATION: NOT VERIFIED.
//
// This is the harness for the day that changes. It exists now, before there is
// a second plan, so the first run on one is a MEASUREMENT rather than an
// improvised script written by someone who already knows what they hope to see.
//
// It enforces the one rule that makes a first look worth anything:
//
//   A PLAN THE ENCODER WAS TRAINED ON IS NOT HELD OUT.
//
// The plan's content hash is checked against the trained-on manifest and
// against every plan already in the benchmark corpus. If it matches, the run is
// REFUSED. There is no flag to override that, because the only reason to want
// one is to publish a number that is not what it says it is.
//
// It also refuses to run a plan whose fingerprint is already in the version
// history at a DIFFERENT score, which is how a quietly re-annotated plan would
// otherwise turn into an improvement.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE);
const REPO = path.dirname(BENCH);
const HISTORY = path.join(HERE, "history.json");

const fingerprint = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 32);

// Which plans this build has already seen, from the sources that actually
// decide it: the encoder's own manifest, and the annotated corpus.
// Read one JSON object out of the generated weights module by matching braces.
// A regex was tried first and silently returned nothing, which made the
// "trained on this plan" check pass by default — a leakage guard that cannot
// read its own input is worse than none, because it reports the same thing
// either way. So a failure to parse aborts the run rather than defaulting.
function objectAfter(src, key) {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return null;
  const start = src.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      try { return JSON.parse(src.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function seenPlans() {
  const weights = fs.readFileSync(path.join(REPO, "src/plan-encoder-weights.js"), "utf8");
  const trainedOn = objectAfter(weights, "trainedOn");
  if (!trainedOn || !Array.isArray(trainedOn.plans)) {
    console.error("REFUSED — could not read the encoder's trained-on manifest from");
    console.error("src/plan-encoder-weights.js, so whether this plan was trained on");
    console.error("cannot be checked. A leakage guard that cannot read its input is");
    console.error("not a guard.");
    process.exit(2);
  }
  const corpus = [];
  const annotDir = path.join(BENCH, "annotations");
  for (const f of fs.existsSync(annotDir) ? fs.readdirSync(annotDir) : []) {
    if (!f.endsWith(".json")) continue;
    const a = JSON.parse(fs.readFileSync(path.join(annotDir, f), "utf8"));
    const img = a.source && a.source.file && path.join(BENCH, a.source.file);
    corpus.push({ planId: a.planId, file: img,
      fingerprint: img && fs.existsSync(img) ? fingerprint(img) : null });
  }
  return { trainedOn, corpus };
}

const { trainedOn, corpus } = seenPlans();
const history = fs.existsSync(HISTORY) ? JSON.parse(fs.readFileSync(HISTORY, "utf8")) : { runs: [] };

const [planArg, annotArg] = process.argv.slice(2);

if (!planArg) {
  console.log("HELD-OUT VENUE BENCHMARK\n");
  console.log(`  encoder trained on plans      ${trainedOn.plans.join(", ")}`);
  console.log(`  objects it was trained on     ${trainedOn.objects}`);
  console.log(`  annotated plans in the corpus ${corpus.length} (${[...new Set(corpus.map(c => c.planId))].length} distinct ids)`);
  console.log(`  held-out venue runs recorded  ${history.runs.length}`);
  console.log("\n  REAL DISTINCT VENUE PLANS: 1");
  console.log("  CROSS-VENUE GENERALIZATION: NOT VERIFIED");
  console.log("\nSupply a plan and its annotation to run one:");
  console.log("  npm run benchmark:heldout -- path/to/plan.png path/to/annotation.json");
  console.log("\nThe run is REFUSED if that plan is one the encoder was trained on,");
  console.log("or one already in the annotated corpus. There is no override flag.");
  process.exit(0);
}

if (!fs.existsSync(planArg)) { console.error(`plan not found: ${planArg}`); process.exit(2); }
if (!annotArg || !fs.existsSync(annotArg)) { console.error(`annotation not found: ${annotArg}`); process.exit(2); }

const fp = fingerprint(planArg);
const annot = JSON.parse(fs.readFileSync(annotArg, "utf8"));

// ---- leakage, checked before anything is measured ---------------------------
const sameBytes = corpus.filter(c => c.fingerprint === fp);
const sameId = corpus.filter(c => c.planId === annot.planId);
const trainedOnThis = trainedOn.plans.includes(annot.planId);
const leaks = [];
if (sameBytes.length) leaks.push(`this exact image is already in the corpus as ${sameBytes.map(c => c.planId).join(", ")}`);
if (sameId.length) leaks.push(`plan id "${annot.planId}" is already annotated in the corpus`);
if (trainedOnThis) leaks.push(`the encoder was TRAINED on plan id "${annot.planId}"`);
const prior = history.runs.find(r => r.planFingerprint === fp);
if (prior && prior.annotationFingerprint !== fingerprint(annotArg))
  leaks.push(`this plan was benchmarked before under a DIFFERENT annotation (${prior.ranAt}) — re-annotating a held-out plan turns a miss into a hit`);

if (leaks.length) {
  console.error("REFUSED — this plan is not held out:\n");
  for (const l of leaks) console.error("  - " + l);
  console.error("\nA first look at a venue is only worth something if the system has not seen it.");
  console.error("There is no override flag, by design.");
  process.exit(1);
}

// ---- run it -----------------------------------------------------------------
const app = await serveApp();
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
const ext = path.extname(planArg).toLowerCase() === ".jpg" ? "jpeg" : "png";

await page.goto(`${app.baseUrl}/index.html`);
await page.waitForLoadState("networkidle");
await page.click('.appbar [data-action="create-event"]');
await page.waitForTimeout(250);
await page.fill('input[name="name"]', "Held out");
await page.fill('input[name="hotel"]', "Held out");
await page.fill('input[name="date"]', "2026-10-02");
await page.click('button[data-setup="blank"]');
await page.waitForTimeout(600);
await page.evaluate(src => {
  state.events[0].background = { src, name: "p", opacity: 1, visible: true, locked: false, scale: 100 };
  render();
}, `data:image/${ext};base64,${fs.readFileSync(planArg).toString("base64")}`);
await page.waitForTimeout(300);
await page.click('[data-v8-action="detect"]');
await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
await page.waitForTimeout(600);

const run = await page.evaluate(() => {
  const a = state.events[0].analysis, pi = a.planIntelligence;
  const ow = a.originalWidth, oh = a.originalHeight;
  const px = c => ({ cx: (c.x + c.w / 2) / 100 * ow, cy: (c.y + c.h / 2) / 100 * oh, kind: c.kind, type: c.type });
  const alive = a.candidates.filter(c => c.status !== "rejected");
  return {
    tables: alive.filter(c => c.kind === "table").map(px),
    chairs: alive.flatMap(c => (c.chairDetections || []).map(px))
      .concat(alive.filter(c => c.kind === "venue" && c.type === "chair").map(px)),
    contradictions: pi.contradictions.map(c => ({ kind: c.kind, severity: c.severity })),
    facts: pi.facts.length,
    reviewGroups: pi.reviewGroups.length,
    detectionMs: a.diagnostics.detectionMs,
    embedding: a.diagnostics.embedding && { id: a.diagnostics.embedding.id, trainedModel: a.diagnostics.embedding.trainedModel },
    secondOpinionTier: a.diagnostics.embedding?.secondOpinion?.bestTier ?? null,
  };
});

await browser.close();
await app.close();

const tol = ((annot.matchToleranceP ?? 3.0) / 100) * Math.hypot(annot.source.width, annot.source.height);
const score = (det, cls) => {
  const gt = annot.objects.filter(o => o.class === cls);
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
  const tp = usedD.size, fp = det.length - tp, fn = gt.length - usedG.size;
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  return { gt: gt.length, detected: det.length, tp, fp, fn,
    precision: +precision.toFixed(3), recall: +recall.toFixed(3),
    f1: +(precision + recall ? (2 * precision * recall) / (precision + recall) : 0).toFixed(3) };
};

const tables = score(run.tables, "table");
const chairs = score(run.chairs, "chair");

console.log(`HELD-OUT VENUE: ${annot.planId}\n`);
console.log("class    gt  det   tp   fp   fn   precision  recall     F1");
for (const [name, s] of [["tables", tables], ["chairs", chairs]])
  console.log(`${name.padEnd(8)} ${String(s.gt).padStart(2)} ${String(s.detected).padStart(4)} ${String(s.tp).padStart(4)}`
    + ` ${String(s.fp).padStart(4)} ${String(s.fn).padStart(4)}   ${s.precision.toFixed(3).padStart(9)} ${s.recall.toFixed(3).padStart(7)} ${s.f1.toFixed(3).padStart(6)}`);

const golden = history.runs.find(r => r.planId === "merit-real-venue");
console.log(`\ncontradictions ${run.contradictions.length}  facts ${run.facts}  review groups ${run.reviewGroups}`);
console.log(`detection ${run.detectionMs} ms  embedding ${run.embedding && run.embedding.id}`);
console.log(`second opinion reference tier: ${run.secondOpinionTier}`);

// ---- version history --------------------------------------------------------
//
// Appended, never rewritten. A held-out result that can be edited later is not
// a held-out result: the whole value of this file is that the FIRST number
// stays visible after someone has improved the thing it measured.
const entry = {
  ranAt: new Date().toISOString(),
  planId: annot.planId,
  planFingerprint: fp,
  annotationFingerprint: fingerprint(annotArg),
  encoder: { id: "merit-plan-encoder-v1", trainedOnPlans: trainedOn.plans, trainedOnObjects: trainedOn.objects },
  corpusPlansAtRun: [...new Set(corpus.map(c => c.planId))],
  tables, chairs,
  contradictions: run.contradictions.length,
  facts: run.facts,
  reviewGroups: run.reviewGroups,
  detectionMs: run.detectionMs,
  firstEverOnThisPlan: !prior,
};
history.runs.push(entry);
fs.writeFileSync(HISTORY, JSON.stringify(history, null, 1) + "\n");
console.log(`\nappended to ${path.relative(process.cwd(), HISTORY)} (run ${history.runs.length})`);

if (golden) {
  console.log("\nAgainst the venue this system was built on:");
  console.log(`  golden tables F1 ${golden.tables.f1}   here ${tables.f1}`);
  console.log("  A drop here is the expected result, not a regression. It is the first honest");
  console.log("  measurement of something that was previously unknown.");
}
console.log("\nOne held-out venue is one data point. It does not make cross-venue");
console.log("generalization VERIFIED — it makes it MEASURED ONCE.");
