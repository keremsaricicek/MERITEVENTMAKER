// Does a human decision survive a plan that changed?
//
//   node benchmarks/memory/measure-memory.mjs
//
// benchmarks/teach-ai/ already measures retention across a re-analysis of the
// SAME image, and reports 1.0000. That number is real and it is also the easy
// question: the detector is deterministic, so re-running it on identical pixels
// puts every box back within a fraction of a percent, and geometry alone gets
// full marks. What it measures is determinism, not identity.
//
// This measures identity. The same decisions are made, and then the plan is
// replaced with a version of itself that a real operator would plausibly be
// handed next: the same drawing exported to JPEG, exported to greyscale,
// re-issued at a smaller scale, or re-issued with objects moved and removed. A
// decision that survives those was matched on what the object IS, not on where
// the detector happened to put a box.
//
// It also answers the question §24 of the sprint makes mandatory: does the
// LEARNED EMBEDDING actually contribute, or is it merely available? That cannot
// be answered by shipping it — it needs the same inputs scored with and without
// it. So every scenario is scored three ways over identical data:
//
//   full        geometry + size + visual + context + family
//   no-visual   the learned embedding withheld
//   no-context  the neighbourhood withheld
//
// If the ablations match the full model, the extra evidence is decoration and
// this file says so.
//
// REAL DISTINCT VENUE PLANS: 1. Every image here is the same drawing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE);
const PLAN = path.join(BENCH, "plans", "merit-real-venue-plan.png");
const ANNOT = JSON.parse(fs.readFileSync(path.join(BENCH, "annotations", "merit-real-venue.json"), "utf8"));
const VARIANTS = path.join(BENCH, "robustness", "variants");

// The transformations a decision has to survive. `identical` is the control:
// if it is not 1.0 something is broken in the harness, not in the product.
const SCENARIOS = [
  { id: "identical", file: null, why: "the same image again — the case teach-ai already measures" },
  { id: "jpeg-q20", file: "merit-real-jpeg-q20.jpg", why: "the plan mailed as a compressed JPEG" },
  { id: "grayscale", file: "merit-real-grayscale.png", why: "the plan exported without colour" },
  { id: "downscale-70", file: "merit-real-downscale-70.png", why: "the plan re-issued smaller" },
  { id: "rotate-2", file: "merit-real-rotate-2.png", why: "the plan scanned slightly askew" },
  { id: "crop-pad", file: "merit-real-crop-pad.png", why: "the plan re-cropped, so everything translated" },
  { id: "blur", file: "merit-real-blur.png", why: "a soft scan" },
];

const dataUrl = file => {
  const b = fs.readFileSync(file);
  const mime = file.endsWith(".jpg") ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${b.toString("base64")}`;
};

const app = await serveApp();
const browser = await launchChromium();

async function open(page) {
  await page.goto(`${app.baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Memory");
  await page.fill('input[name="hotel"]', "Memory");
  await page.fill('input[name="date"]', "2026-10-02");
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(600);
}
async function analyse(page, src) {
  await page.evaluate(s => {
    state.events[0].background = { src: s, name: "plan", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, src);
  await page.waitForTimeout(300);
  // The control that starts a pass is not the same one twice: `detect` only
  // exists on the floor-plan screen, and after the first analysis the app is
  // on the review screen where it is `reanalyze`. Clicking the wrong one times
  // out silently-looking, so try both rather than assuming which screen this is.
  const detect = await page.$('[data-v8-action="detect"]');
  if (detect) await detect.click();
  else await page.click('[data-review-action="reanalyze"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 240000 });
  await page.waitForTimeout(400);
}

// Which annotated object a detection is, so "the decision came back on the same
// object" means the same thing before and after the image changed. Matching is
// the same greedy nearest-first every other benchmark uses.
function annotatedIdFor(det, W, H, tolPx) {
  let best = null, bestD = Infinity;
  const cx = (det.x + det.w / 2) / 100 * W, cy = (det.y + det.h / 2) / 100 * H;
  for (const o of ANNOT.objects) {
    const d = Math.hypot(o.cx - cx, o.cy - cy);
    if (d < bestD) { bestD = d; best = o; }
  }
  return bestD <= tolPx ? best.id : null;
}

const results = [];
for (const scenario of SCENARIOS) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await open(page);
  await analyse(page, dataUrl(PLAN));

  // ---- make real decisions, through the real controls ---------------------
  // A spread of decision types, because they exercise different memory paths:
  // a reclassification is the one that MUST re-apply (the detector will keep
  // proposing the wrong kind), a confirmation is the one whose loss is most
  // visible, a rejection is a stored negative.
  const decided = await page.evaluate(() => {
    const a = state.events[0].analysis;
    const tables = a.candidates.filter(c => c.kind === "table" && c.status === "unreviewed")
      .sort((x, y) => x.x - y.x || x.y - y.y);
    const picks = [];
    for (let i = 0; i < tables.length && picks.length < 18; i += Math.max(1, Math.floor(tables.length / 18)))
      picks.push(tables[i]);
    const out = [];
    for (let i = 0; i < picks.length; i++) {
      const c = picks[i];
      ui.selectedCandidateId = c.id;
      const mode = i % 3;
      if (mode === 0) { c.kind = "venue"; c.type = "chair"; c.status = "confirmed"; }
      else if (mode === 1) { c.status = "confirmed"; }
      else { c.status = "rejected"; c.selected = false; }
      rememberCorrectionForBenchmark(c);
      out.push({ x: c.x, y: c.y, w: c.w, h: c.h, kind: c.kind, type: c.type, status: c.status, mode });
    }
    render();
    return out;
  }).catch(() => null);

  // rememberCorrection is IIFE-scoped and unreachable from page.evaluate, so
  // the decisions are made through the review card's real controls instead —
  // which is also the only way to be sure the product stores what this claims
  // it stores.
  let made = [];
  if (!decided) {
    made = await page.evaluate(() => {
      const a = state.events[0].analysis;
      const tables = a.candidates.filter(c => c.kind === "table" && c.status === "unreviewed")
        .sort((x, y) => x.x - y.x || x.y - y.y);
      const step = Math.max(1, Math.floor(tables.length / 18));
      const picks = [];
      for (let i = 0; i < tables.length && picks.length < 18; i += step) picks.push(tables[i]);
      return picks.map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }));
    });
    for (let i = 0; i < made.length; i++) {
      await page.evaluate(id => { ui.selectedCandidateId = id; ui.reviewDrawMode = false; render(); }, made[i].id);
      const mode = i % 3;
      if (mode === 0) {
        await page.selectOption('[data-candidate-edit="kindtype"]', "venue:chair").catch(() => {});
        await page.waitForTimeout(60);
      }
      const action = mode === 2 ? "reject" : "confirm";
      await page.click(`[data-review-action="${action}"]`).catch(() => {});
      await page.waitForTimeout(60);
      made[i].mode = mode;
    }
  }

  const W = ANNOT.source.width, H = ANNOT.source.height;
  const tolPx = (ANNOT.matchToleranceP ?? 3) / 100 * Math.hypot(W, H);

  const before = await page.evaluate(() => ({
    memory: (state.events[0].planMemory || []).map(m => ({
      id: m.id, kind: m.kind, type: m.type, status: m.status, geometry: m.geometry,
      hasVector: !!(m.visual && m.visual.vector), hasContext: !!m.context,
    })),
  }));
  // Which annotated object each memory entry was made ON.
  const memoryTruth = new Map();
  for (const m of before.memory) {
    const id = annotatedIdFor(m.geometry, W, H, tolPx);
    if (id) memoryTruth.set(m.id, id);
  }

  // ---- change the plan, re-analyse ----------------------------------------
  if (scenario.file) await analyse(page, dataUrl(path.join(VARIANTS, scenario.file)));
  else await analyse(page, dataUrl(PLAN));

  const after = await page.evaluate(() => {
    const a = state.events[0].analysis;
    return {
      conflicts: a.memoryConflicts || [],
      reapplied: a.memoryReapplied,
      candidates: a.candidates.map(c => ({ id: c.id, kind: c.kind, type: c.type, status: c.status,
        x: c.x, y: c.y, w: c.w, h: c.h, fromMemory: !!c.fromMemory,
        memoryMatch: c.memoryMatch || null })),
      // The same inputs, scored three ways. This is the ablation: identical
      // memory, identical candidates, only the evidence available changes.
      ablation: (() => {
        const mem = (state.events[0].planMemory || []);
        // EVERY candidate, including the ones already marked rejected. A
        // rejection memory's object IS a rejected candidate by the time this
        // runs — filtering them out removes exactly the objects a third of
        // these decisions are about, and the first version of this file did,
        // which cost 6 of 28 decisions on the control scenario and looked like
        // a product regression.
        const cands = a.candidates.map(c => ({ id: c.id, kind: c.kind, type: c.type,
          x: c.x, y: c.y, w: c.w, h: c.h,
          vector: c.visualDescriptor && c.visualDescriptor.vector || null }));
        const run = opts => {
          const r = globalThis.MeritPlanMemory.match(mem, cands, opts);
          return { applied: r.matches.map(m => ({ memoryId: m.memoryId, candidateId: m.candidateId,
            grade: m.grade, score: m.score, beyondTolerance: !m.withinOldTolerance })),
            ambiguous: r.ambiguous.length, lost: r.unmatched.length, stats: r.stats };
        };
        // `shifted` is the opt-in global-transform correction, measured beside
        // the shipped configuration so the decision to leave it off stays
        // visible and re-decidable rather than becoming folklore.
        return { full: run({}), noVisual: run({ visual: false }), noContext: run({ context: false }),
          shifted: run({ shift: true }) };
      })(),
    };
  });

  // ---- score ---------------------------------------------------------------
  const candById = new Map(after.candidates.map(c => [c.id, c]));
  const score = applied => {
    let retained = 0, wrong = 0, unscoreable = 0, beyond = 0;
    for (const hit of applied) {
      const truth = memoryTruth.get(hit.memoryId);
      const c = candById.get(hit.candidateId);
      if (!truth || !c) { unscoreable++; continue; }
      const landedOn = annotatedIdFor(c, W, H, tolPx);
      if (landedOn === null) { unscoreable++; continue; }
      if (landedOn === truth) retained++; else wrong++;
      if (hit.beyondTolerance) beyond++;
    }
    const scoreable = memoryTruth.size;
    return {
      scoreableMemories: scoreable, applied: applied.length,
      retained, wrong, unscoreable,
      lost: scoreable - retained - wrong,
      beyondOldTolerance: beyond,
      retention: scoreable ? +(retained / scoreable).toFixed(4) : null,
      wrongRate: applied.length ? +(wrong / applied.length).toFixed(4) : 0,
      // Of the decisions it DID apply, how many landed on the right object.
      identityPrecision: retained + wrong ? +(retained / (retained + wrong)).toFixed(4) : null,
    };
  };

  const row = {
    scenario: scenario.id, why: scenario.why,
    memories: before.memory.length,
    memoriesWithVector: before.memory.filter(m => m.hasVector).length,
    memoriesWithContext: before.memory.filter(m => m.hasContext).length,
    scoreable: memoryTruth.size,
    shipped: score(after.ablation.full.applied),
    ablation: {
      full: score(after.ablation.full.applied),
      noVisual: score(after.ablation.noVisual.applied),
      noContext: score(after.ablation.noContext.applied),
      shifted: score(after.ablation.shifted.applied),
    },
    ambiguousReported: after.ablation.full.ambiguous,
    conflictKinds: after.conflicts.reduce((m, c) => (m[c.kind] = (m[c.kind] || 0) + 1, m), {}),
    pageErrors: errors.length,
  };
  results.push(row);

  const s = row.shipped;
  console.log(`\n=== ${scenario.id} ===  ${scenario.why}`);
  console.log(`  memories ${row.memories} (${row.memoriesWithVector} with a learned vector, ${row.memoriesWithContext} with context), ${row.scoreable} scoreable`);
  console.log(`  retained ${s.retained}  wrong ${s.wrong}  lost ${s.lost}  ambiguous(not applied) ${row.ambiguousReported}  unscoreable ${s.unscoreable}`);
  console.log(`  RETENTION ${s.retention}   IDENTITY PRECISION ${s.identityPrecision}   WRONG RATE ${s.wrongRate}   matched beyond the old tolerance: ${s.beyondOldTolerance}`);
  console.log(`  ablation  full ${row.ablation.full.retained}/${row.scoreable} (wrong ${row.ablation.full.wrong})   no-visual ${row.ablation.noVisual.retained}/${row.scoreable}   no-context ${row.ablation.noContext.retained}/${row.scoreable}   +global-transform ${row.ablation.shifted.retained}/${row.scoreable} (wrong ${row.ablation.shifted.wrong})`);
  if (errors.length) console.log(`  pageErrors ${errors.length}: ${errors[0]}`);
  await page.close();
}

await browser.close();
await app.close?.();

// ---- the two questions this file exists to answer -------------------------
const scored = results.filter(r => r.scoreable > 0);
const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
const totals = {
  scoreable: sum(scored, r => r.scoreable),
  retainedFull: sum(scored, r => r.ablation.full.retained),
  retainedNoVisual: sum(scored, r => r.ablation.noVisual.retained),
  retainedNoContext: sum(scored, r => r.ablation.noContext.retained),
  retainedShifted: sum(scored, r => r.ablation.shifted.retained),
  wrongShifted: sum(scored, r => r.ablation.shifted.wrong),
  appliedShifted: sum(scored, r => r.ablation.shifted.applied),
  wrongFull: sum(scored, r => r.ablation.full.wrong),
  appliedFull: sum(scored, r => r.ablation.full.applied),
};
const rate = (n, d) => (d ? +(n / d).toFixed(4) : null);
const report = {
  ranAt: new Date().toISOString(),
  realVenue: true,
  note: "REAL DISTINCT VENUE PLANS: 1. Every scenario is the same drawing transformed.",
  scenarios: results,
  totals: {
    ...totals,
    retentionFull: rate(totals.retainedFull, totals.scoreable),
    retentionNoVisual: rate(totals.retainedNoVisual, totals.scoreable),
    retentionNoContext: rate(totals.retainedNoContext, totals.scoreable),
    retentionWithGlobalTransform: rate(totals.retainedShifted, totals.scoreable),
    identityPrecisionWithGlobalTransform: rate(totals.retainedShifted, totals.retainedShifted + totals.wrongShifted),
    identityPrecisionFull: rate(totals.retainedFull, totals.retainedFull + totals.wrongFull),
    wrongApplicationRateFull: rate(totals.wrongFull, totals.appliedFull),
  },
};
fs.mkdirSync(HERE, { recursive: true });
fs.writeFileSync(path.join(HERE, "report.json"), JSON.stringify(report, null, 1) + "\n");

console.log("\n\nACROSS EVERY SCENARIO");
console.log(`  scoreable decisions            ${totals.scoreable}`);
console.log(`  retention, full model          ${report.totals.retentionFull}   gate >= 0.98`);
console.log(`  identity precision, full model ${report.totals.identityPrecisionFull}   gate >= 0.98`);
console.log(`  wrong application rate         ${report.totals.wrongApplicationRateFull}   gate <= 0.01`);
console.log("\nDOES THE LEARNED EMBEDDING CONTRIBUTE?  (§24 — the answer has to be measured, not assumed)");
console.log(`  retention with it              ${report.totals.retentionFull}`);
console.log(`  retention without it           ${report.totals.retentionNoVisual}`);
console.log(`  retention without context      ${report.totals.retentionNoContext}`);
const visualGain = totals.retainedFull - totals.retainedNoVisual;
const contextGain = totals.retainedFull - totals.retainedNoContext;
console.log(visualGain > 0
  ? `  The learned embedding recovers ${visualGain} decision(s) geometry alone loses.`
  : `  NO MEASURABLE CONTRIBUTION from the learned embedding on this corpus (${visualGain}). Reported as such.`);
console.log(contextGain > 0
  ? `  The neighbourhood signature recovers ${contextGain} decision(s).`
  : `  NO MEASURABLE CONTRIBUTION from the neighbourhood signature (${contextGain}). Reported as such.`);

const gatesMet = report.totals.retentionFull >= 0.98
  && report.totals.identityPrecisionFull >= 0.98
  && report.totals.wrongApplicationRateFull <= 0.01;
console.log("\nTHE GLOBAL-TRANSFORM CORRECTION, which ships OFF");
console.log(`  retention          ${report.totals.retentionFull} -> ${report.totals.retentionWithGlobalTransform}`);
console.log(`  identity precision ${report.totals.identityPrecisionFull} -> ${report.totals.identityPrecisionWithGlobalTransform}`);
console.log(`  it recovers ${totals.retainedShifted - totals.retainedFull} decision(s) and misapplies ${totals.wrongShifted - totals.wrongFull} more.`);
console.log("  A lost decision is reported and re-made; a wrongly applied one is invisible. Not promoted.");
console.log(`\n${gatesMet ? "All memory gates met." : "MEMORY GATES NOT MET on transformed plans (they are met on an unchanged one)."}`);
console.log("REAL DISTINCT VENUE PLANS: 1. CROSS-VENUE GENERALIZATION: NOT VERIFIED.");
if (!gatesMet) process.exitCode = 1;
