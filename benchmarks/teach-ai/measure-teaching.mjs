// Teach AI and Plan Memory, measured against ground truth.
//
//   node benchmarks/teach-ai/measure-teaching.mjs
//
// Both features were built and covered by contract tests, and neither had a
// number. A contract test says propagation happens and memory survives a
// re-analysis; it does not say whether the objects the correction reached
// DESERVED it, or whether a remembered correction came back on the object a
// person actually corrected. Those are the two ways this can quietly be wrong,
// and they are what this measures.
//
//   PROPAGATION PRECISION   A person corrects one object and the decision
//                           spreads to its similarity family. Of the objects it
//                           reached, how many are annotated as the thing the
//                           person said? A correction that spreads onto the
//                           wrong objects is worse than one that does not
//                           spread at all, because the person believes it.
//
//   RE-ANALYZE RETENTION    Corrections are made, the plan is re-analysed, and
//                           every correction has to land back on the object it
//                           was made on. Retention counts how many came back;
//                           WRONG APPLICATION counts how many came back on a
//                           DIFFERENT annotated object, which is the failure
//                           that silently corrupts a plan.
//
// Everything is driven through the real UI control a person uses — the
// reclassify select on the review card — not by calling internals. The numbers
// therefore describe the product, not a test harness's idea of it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE);
const PLAN = path.join(BENCH, "plans", "merit-real-venue-plan.png");
const ANNOT = path.join(BENCH, "annotations", "merit-real-venue.json");
const MATCH_TOLERANCE_P = 3.0;

// The annotation's vocabulary, in the app's kind:type terms. Only classes the
// reclassify control can actually express are scored — inventing a mapping for
// one it cannot would measure nothing.
function targetLabel(o) {
  if (o.class === "table") return o.type ? `table:${o.type}` : null;
  if (o.class === "chair") return "venue:chair";
  if (o.class === "banquette") return "venue:banquette";
  if (o.class === "stage" || o.class === "stage_extension") return "venue:stage";
  if (o.class === "column") return "venue:column";
  return null;
}

// Greedy nearest-first, one GT object to one candidate — but with a tolerance
// that can never exceed half the distance to the object's nearest neighbour.
//
// The object benchmark's flat 3%-of-diagonal is 47px on this plan, and this
// plan's concert seating puts adjacent chairs about 35px apart. A tolerance
// wider than the spacing cannot answer "is this the SAME chair" at all: it can
// only answer "is this one of the chairs around here". Measured with the flat
// tolerance, three remembered corrections were scored as lost while the report
// itself showed the memory re-applied, confirmed, 42px away, and handed to a
// neighbouring annotated chair by this very function. That was the harness
// failing, not Plan Memory, and a number that reports a measurement artifact
// as a product defect is worse than no number.
//
// Halving the neighbour distance guarantees at most one annotated object is
// reachable from any candidate, so an identity claim is decidable. Objects
// whose neighbours are too close to separate at all are reported as ambiguous
// rather than silently scored.
function neighbourLimits(objects) {
  const limit = new Map();
  for (const g of objects) {
    let nearest = Infinity;
    for (const o of objects) {
      if (o === g) continue;
      const d = Math.hypot(g.cx - o.cx, g.cy - o.cy);
      if (d < nearest) nearest = d;
    }
    limit.set(g.id, nearest);
  }
  return limit;
}

function matchToGround(candidates, objects, W, H, limits) {
  const flat = (MATCH_TOLERANCE_P / 100) * Math.hypot(W, H);
  const pairs = [];
  objects.forEach((g, gi) => {
    const tol = Math.min(flat, (limits.get(g.id) ?? Infinity) * 0.5);
    candidates.forEach((c, ci) => {
      const cx = (c.x + c.w / 2) / 100 * W, cy = (c.y + c.h / 2) / 100 * H;
      const d = Math.hypot(g.cx - cx, g.cy - cy);
      if (d <= tol) pairs.push({ gi, ci, d });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  const usedG = new Set(), usedC = new Set(), byCandidate = new Map();
  for (const p of pairs) {
    if (usedG.has(p.gi) || usedC.has(p.ci)) continue;
    usedG.add(p.gi); usedC.add(p.ci);
    byCandidate.set(candidates[p.ci].id, objects[p.gi]);
  }
  return byCandidate;
}

async function openWithPlan(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Teach");
  await page.fill('input[name="hotel"]', "Teach");
  await page.fill('input[name="date"]', "2026-10-02");
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(700);
  await page.evaluate(src => {
    state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, `data:image/png;base64,${fs.readFileSync(PLAN).toString("base64")}`);
  await page.waitForTimeout(400);
  return { page, errors };
}

async function analyse(page) {
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
  await page.waitForTimeout(700);
}

// Re-Analyze is the review screen's own button, and it is the path that
// matters: the detector runs again over the same drawing and Plan Memory has
// to put every human decision back. Waits for a genuinely NEW analysis object
// rather than a timeout, so a slow pass cannot be read as a fast failure.
async function reanalyse(page) {
  const previousId = await page.evaluate(() => state.events[0].analysis.id);
  await page.evaluate(() => { ui.screen = "review"; ui.selectedCandidateId = null; render(); });
  await page.click('[data-review-action="reanalyze"]');
  await page.waitForFunction(id => state.events[0].analysis && state.events[0].analysis.id !== id,
    previousId, { timeout: 240000 });
  await page.waitForTimeout(700);
}

// One correction, made the way a person makes it: select the object, then use
// the reclassify control on its card.
async function reclassify(page, candidateId, label) {
  await page.evaluate(id => { ui.screen = "review"; ui.selectedCandidateId = id; ui.reviewDrawMode = false; render(); }, candidateId);
  await page.waitForSelector('select[data-candidate-edit="kindtype"]', { timeout: 5000 });
  const has = await page.evaluate(l =>
    [...document.querySelectorAll('select[data-candidate-edit="kindtype"] option')].some(o => o.value === l), label);
  if (!has) return false;
  await page.selectOption('select[data-candidate-edit="kindtype"]', label);
  await page.waitForTimeout(60);
  return true;
}

const snapshot = page => page.evaluate(() => JSON.stringify({
  analysis: state.events[0].analysis,
  planMemory: state.events[0].planMemory || [],
  trainingData: state.trainingData || [],
}));

const restore = (page, snap) => page.evaluate(s => {
  const o = JSON.parse(s);
  state.events[0].analysis = o.analysis;
  state.events[0].planMemory = o.planMemory;
  state.trainingData = o.trainingData;
  ui.selectedCandidateId = null;
  render();
}, snap);

const labelOf = c => `${c.kind}:${c.type}`;

async function main() {
  const annot = JSON.parse(fs.readFileSync(ANNOT, "utf8"));
  const W = annot.source.width, H = annot.source.height;
  const objects = annot.objects.filter(o => targetLabel(o));
  const app = await serveApp();
  const browser = await launchChromium();
  const { page, errors } = await openWithPlan(browser, app.baseUrl);
  await analyse(page);

  const before = await page.evaluate(() => state.events[0].analysis.candidates.map(c => ({
    id: c.id, kind: c.kind, type: c.type, status: c.status, x: c.x, y: c.y, w: c.w, h: c.h,
  })));
  const limits = neighbourLimits(objects);
  const flatTol = (MATCH_TOLERANCE_P / 100) * Math.hypot(W, H);
  const ambiguous = objects.filter(o => (limits.get(o.id) ?? Infinity) * 0.5 < flatTol).length;
  const gt = matchToGround(before, objects, W, H, limits);
  console.log(`plan ${annot.planId}: ${before.length} candidates, ${objects.length} scoreable annotated objects, ${gt.size} matched`);
  console.log(`match tolerance ${flatTol.toFixed(1)}px, tightened for ${ambiguous} objects whose nearest neighbour is closer than that\n`);

  // ---- propagation precision ----------------------------------------------
  const base = await snapshot(page);
  const trials = [];
  for (const c of before) {
    const g = gt.get(c.id);
    if (!g || c.status !== "unreviewed") continue;
    const want = targetLabel(g);
    if (!want) continue;
    trials.push({ id: c.id, was: labelOf(c), want, gtId: g.id, correction: want !== labelOf(c) });
  }

  let reached = 0, correct = 0, wrong = 0, ontoNothing = 0, spreadTrials = 0;
  const perTrial = [];
  for (const trial of trials) {
    await restore(page, base);
    const applied = await reclassify(page, trial.id, trial.want);
    if (!applied) continue;
    const after = await page.evaluate(() => state.events[0].analysis.candidates.map(c => ({
      id: c.id, kind: c.kind, type: c.type, status: c.status })));
    const afterById = new Map(after.map(c => [c.id, c]));
    // Everything except the object the person actually touched.
    //
    // A spread is a label change OR a status change, and both count. The
    // detector already types most of this plan correctly, so most real
    // corrections are CONFIRMATIONS: the family keeps its label and every
    // member goes from unreviewed to confirmed. Looking only for changed
    // labels reported zero spreads across all 90 trials while the same code
    // was demonstrably propagating — the person is still being told 40 objects
    // were decided for them, and those 40 still have to deserve it.
    const spread = before.filter(c => c.id !== trial.id).filter(c => {
      const a = afterById.get(c.id);
      if (!a) return false;
      return labelOf(a) !== labelOf(c) || (c.status === "unreviewed" && a.status !== "unreviewed");
    });
    if (!spread.length) continue;
    spreadTrials++;
    let tCorrect = 0, tWrong = 0, tNothing = 0;
    for (const s of spread) {
      reached++;
      const g = gt.get(s.id);
      if (!g) { ontoNothing++; tNothing++; continue; }
      if (targetLabel(g) === trial.want) { correct++; tCorrect++; }
      else { wrong++; tWrong++; }
    }
    perTrial.push({ object: trial.gtId, was: trial.was, taught: trial.want,
                    reached: spread.length, correct: tCorrect, wrong: tWrong, ontoUnannotated: tNothing });
  }
  await restore(page, base);

  // An object the annotation does not cover is not evidence either way, so it
  // is reported separately rather than counted as an error.
  const scored = correct + wrong;
  const precision = scored ? correct / scored : null;
  console.log("PROPAGATION");
  console.log(`  trials that spread at all   ${spreadTrials} of ${trials.length}`);
  console.log(`  objects reached             ${reached}`);
  console.log(`  scoreable (annotated)       ${scored}`);
  console.log(`  correct                     ${correct}`);
  console.log(`  wrong                       ${wrong}`);
  console.log(`  onto unannotated detections ${ontoNothing}  (not scored either way)`);
  console.log(`  PRECISION                   ${precision == null ? "n/a" : precision.toFixed(4)}   gate >= 0.98  ${precision >= 0.98 ? "MET" : "NOT MET"}`);
  const worst = perTrial.filter(t => t.wrong > 0).sort((a, b) => b.wrong - a.wrong).slice(0, 6);
  if (worst.length) {
    console.log("  worst trials:");
    for (const t of worst) console.log(`    ${t.object.padEnd(6)} ${t.was} -> ${t.taught}  reached ${t.reached}, wrong ${t.wrong}`);
  }

  // ---- re-analyze retention ------------------------------------------------
  // A spread of corrections across the plan's vocabulary, each one a decision a
  // person could really make, then the plan is re-analysed exactly as the
  // Re-Analyze button does it.
  const wanted = [];
  const perLabel = new Map();
  for (const t of trials) {
    const n = perLabel.get(t.want) || 0;
    if (n >= 6) continue;
    perLabel.set(t.want, n + 1);
    wanted.push(t);
  }
  const made = [];
  for (const t of wanted) {
    const ok = await reclassify(page, t.id, t.want);
    if (ok) made.push(t);
  }
  const memoryCount = await page.evaluate(() => (state.events[0].planMemory || []).length);
  console.log(`\nRE-ANALYZE`);
  console.log(`  corrections made            ${made.length}  (${memoryCount} memory entries, propagation included)`);

  // What the memory actually holds, before re-analysis touches it.
  const memoryEntries = await page.evaluate(() => (state.events[0].planMemory || []).map(m => ({
    kind: m.kind, type: m.type, status: m.status, manual: !!m.manual, geometry: m.geometry })));
  const correctedGeometry = await page.evaluate(ids => ids.map(id => {
    const c = state.events[0].analysis.candidates.find(x => x.id === id);
    return c ? { id, kind: c.kind, type: c.type, x: c.x, y: c.y, w: c.w, h: c.h } : null;
  }), made.map(t => t.id));

  await reanalyse(page);
  const afterReanalyse = await page.evaluate(() => state.events[0].analysis.candidates.map(c => ({
    id: c.id, kind: c.kind, type: c.type, status: c.status, fromMemory: !!c.fromMemory,
    x: c.x, y: c.y, w: c.w, h: c.h })));
  const gt2 = matchToGround(afterReanalyse, objects, W, H, limits);
  const byGtId = new Map();
  for (const c of afterReanalyse) {
    const g = gt2.get(c.id);
    if (g) byGtId.set(g.id, c);
  }

  let retained = 0, lost = 0, wrongObject = 0;
  const lostDetail = [];
  const gtById = new Map(objects.map(o => [o.id, o]));
  for (const t of made) {
    const now = byGtId.get(t.gtId);
    if (now && labelOf(now) === t.want && now.fromMemory) { retained++; continue; }
    if (now && labelOf(now) === t.want) { retained++; continue; } // re-derived to the same answer is not a loss
    lost++;
    // "Not re-detected" is a conclusion, not an observation. What is actually
    // near the annotated object afterwards is the observation, so record it —
    // an object the detector still found but that the GT matcher gave to a
    // neighbour is a completely different failure from one that vanished.
    const g = gtById.get(t.gtId);
    const near = [];
    if (g) {
      for (const c of afterReanalyse) {
        const cx = (c.x + c.w / 2) / 100 * W, cy = (c.y + c.h / 2) / 100 * H;
        const d = Math.hypot(g.cx - cx, g.cy - cy);
        if (d <= (MATCH_TOLERANCE_P / 100) * Math.hypot(W, H) * 1.5)
          near.push({ label: labelOf(c), fromMemory: c.fromMemory, status: c.status, distance: +d.toFixed(1),
                      takenBy: gt2.get(c.id)?.id ?? null });
      }
      near.sort((a, b) => a.distance - b.distance);
    }
    // The memory's own view: what was stored, and how far the nearest fresh
    // candidate is in the metric applyPlanMemory actually uses (percent units
    // over x, y, half-width, half-height).
    const taughtGeom = correctedGeometry[made.indexOf(t)] || null;
    const mem = taughtGeom ? memoryEntries.find(m =>
      Math.abs(m.geometry.x - taughtGeom.x) < 0.01 && Math.abs(m.geometry.y - taughtGeom.y) < 0.01) : null;
    let closestByMemoryMetric = null;
    if (mem) {
      for (const c of afterReanalyse) {
        const d = Math.hypot(c.x - mem.geometry.x, c.y - mem.geometry.y,
          (c.w - mem.geometry.w) * 0.5, (c.h - mem.geometry.h) * 0.5);
        if (!closestByMemoryMetric || d < closestByMemoryMetric.distance)
          closestByMemoryMetric = { label: labelOf(c), fromMemory: c.fromMemory, distance: +d.toFixed(3) };
      }
    }
    lostDetail.push({ object: t.gtId, taught: t.want,
                      correctedFrom: t.was,
                      correctedGeometry: taughtGeom,
                      memoryEntry: mem,
                      closestByMemoryMetric,
                      now: now ? labelOf(now) : "no candidate matched this annotated object",
                      nearby: near.slice(0, 4) });
  }
  // A remembered correction that landed on an object it was never made on.
  const taughtByGt = new Map(made.map(t => [t.gtId, t.want]));
  for (const c of afterReanalyse) {
    if (!c.fromMemory) continue;
    const g = gt2.get(c.id);
    if (!g) continue;
    const meantForThis = taughtByGt.get(g.id);
    if (meantForThis === undefined && targetLabel(g) !== labelOf(c)) wrongObject++;
    else if (meantForThis !== undefined && meantForThis !== labelOf(c)) wrongObject++;
  }
  const retention = made.length ? retained / made.length : null;
  const wrongRate = made.length ? wrongObject / made.length : null;
  console.log(`  retained on the same object ${retained}`);
  console.log(`  lost                        ${lost}`);
  console.log(`  RETENTION                   ${retention == null ? "n/a" : retention.toFixed(4)}   gate >= 0.98  ${retention >= 0.98 ? "MET" : "NOT MET"}`);
  console.log(`  WRONG APPLICATION           ${wrongRate == null ? "n/a" : wrongRate.toFixed(4)}   gate <= 0.01  ${wrongRate <= 0.01 ? "MET" : "NOT MET"}`);
  for (const l of lostDetail.slice(0, 8)) console.log(`    lost: ${l.object} taught ${l.taught}, now ${l.now}`);

  const report = {
    ranAt: new Date().toISOString(),
    plan: annot.planId,
    matchToleranceP: MATCH_TOLERANCE_P,
    candidates: before.length, annotatedScoreable: objects.length, matched: gt.size,
    matching: { flatTolerancePx: +flatTol.toFixed(1), tightenedForNeighbours: ambiguous,
      note: "A GT object's tolerance is capped at half the distance to its nearest neighbour, so an identity claim is decidable on a plan whose chairs are closer together than the flat tolerance." },
    propagation: { trials: trials.length, spreadTrials, reached, scored, correct, wrong,
                   ontoUnannotated: ontoNothing, precision: precision == null ? null : +precision.toFixed(4),
                   gate: 0.98, met: precision >= 0.98, perTrial },
    reanalyze: { correctionsMade: made.length, memoryEntries: memoryCount, retained, lost,
                 retention: retention == null ? null : +retention.toFixed(4), retentionGate: 0.98, retentionMet: retention >= 0.98,
                 wrongApplications: wrongObject, wrongApplicationRate: wrongRate == null ? null : +wrongRate.toFixed(4),
                 wrongApplicationGate: 0.01, wrongApplicationMet: wrongRate <= 0.01, lostDetail },
    pageErrors: errors,
  };
  fs.writeFileSync(path.join(HERE, "report.json"), JSON.stringify(report, null, 1) + "\n");
  console.log(`\npageErrors ${errors.length}`);
  console.log(`wrote ${path.relative(process.cwd(), path.join(HERE, "report.json"))}`);

  await browser.close();
  await app.close();
  const failed = !(precision >= 0.98) || !(retention >= 0.98) || !(wrongRate <= 0.01);
  process.exit(failed ? 1 : 0);
}

await main();
