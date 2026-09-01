// Is the review queue's order worth anything?
//
//   npm run benchmark:review-order
//
// The product tells an operator what to look at first. That is a claim, and
// until now nothing checked it. An ordering that is no better than the order
// things happened to be built in is not guidance — it is a list with a
// confident heading, and the cost of following it is an operator's time.
//
// So this measures the only thing that matters about an ordering: FOLLOWING IT,
// HOW FAST DO YOU REACH THE ACTUAL ERRORS? An error is defined against the
// annotation, not against the product's own opinion of itself:
//
//   - a detected table that matches no annotated table (invented), and
//   - an annotated table nothing detected (missed), attributed to whichever
//     queue item points at objects nearest to where it should have been.
//
// Three orderings are compared over the same items, so the only variable is the
// order: the shipped one, the rank-only one it replaced, and the mean of many
// random shuffles, which is what "no information" scores.
//
// It also pins two structural properties an operator depends on: the order is
// the same on a re-run of the identical plan (candidate ids are regenerated on
// every analysis, so ordering on them would reshuffle the queue), and the queue
// stays short enough to work through rather than becoming a backlog.
//
// The size of one FAMILY behind a single "apply to all" is reported and
// deliberately not capped. Splitting a family of thirty-five into five batches
// of eight would give the operator five decisions instead of one, covering
// exactly the same objects — a regression dressed as a limit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE);
const GOLDEN = path.join(BENCH, "plans", "merit-real-venue-plan.png");
const GOLDEN_ANNOT = JSON.parse(fs.readFileSync(path.join(BENCH, "annotations", "merit-real-venue.json"), "utf8"));

const VARIANTS = ["ORIGINAL", "jpeg-q40", "grayscale", "noise", "downscale-70", "rotate-2", "contrast-low", "blur", "jpeg-q20"];
const MAX_GROUPS = 8;         // review cards an operator faces at once, before the queue is a backlog
const RANDOM_TRIALS = 200;    // shuffles averaged for the no-information baseline

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
  await page.fill('input[name="name"]', "Order");
  await page.fill('input[name="hotel"]', "Order");
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
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const a = state.events[0].analysis, pi = a.planIntelligence;
    const ow = a.originalWidth, oh = a.originalHeight;
    const px = c => ({ id: c.id, cx: (c.x + c.w / 2) / 100 * ow, cy: (c.y + c.h / 2) / 100 * oh });
    return {
      tables: a.candidates.filter(c => c.kind === "table" && c.status !== "rejected").map(px),
      all: a.candidates.filter(c => c.status !== "rejected").map(px),
      priorities: pi.reviewPriorities.map(p => ({
        key: p.key, rank: p.rank, signature: p.signature, buildOrder: p.buildOrder,
        impact: p.downstreamImpact, targetIds: p.targetIds || [] })),
      reviewGroups: pi.reviewGroups.map(g => ({ need: g.memberIds.length, family: g.totalInFamily })),
    };
  });
}

// How many distinct real errors the first N items of an ordering touch.
function reachedBy(order, n, errorsByTarget) {
  const found = new Set();
  for (const item of order.slice(0, n))
    for (const id of item.targetIds)
      for (const e of errorsByTarget.get(id) || []) found.add(e);
  return found.size;
}

const app = await serveApp();
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });

const report = { ranAt: new Date().toISOString(), maxGroups: MAX_GROUPS, variants: [] };
const failures = [];

console.log("variant           errors  items | shipped 1/3/5   rank-only 1/3/5   random 1/3/5      | groups  biggest batch");
console.log("-".repeat(112));

for (const id of VARIANTS) {
  const { file, annot } = imageFor(id);
  const run = await analyse(page, app.baseUrl, file);
  const gt = annot.objects.filter(o => o.class === "table");
  const tol = ((annot.matchToleranceP ?? 3.0) / 100) * Math.hypot(annot.source.width, annot.source.height);

  const pairs = [];
  gt.forEach((g, gi) => run.tables.forEach((d, di) => {
    const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy);
    if (dist <= tol) pairs.push({ gi, di, dist });
  }));
  pairs.sort((a, b) => a.dist - b.dist);
  const usedG = new Set(), usedD = new Set();
  for (const p of pairs) {
    if (usedG.has(p.gi) || usedD.has(p.di)) continue;
    usedG.add(p.gi); usedD.add(p.di);
  }

  // Every error gets an id, and every error is attributed to the objects a
  // queue item would have to point at for an operator to find it.
  const errorsByTarget = new Map();
  const attach = (objId, errId) => {
    if (!errorsByTarget.has(objId)) errorsByTarget.set(objId, []);
    errorsByTarget.get(objId).push(errId);
  };
  let errorCount = 0;
  run.tables.forEach((d, i) => {
    if (usedD.has(i)) return;
    attach(d.id, `invented:${i}`); errorCount++;
  });
  // A missed table has no detection to point at, so it is attributed to the
  // nearest surviving object: an operator sent to that neighbourhood is looking
  // at the right part of the drawing.
  gt.forEach((g, gi) => {
    if (usedG.has(gi)) return;
    let best = null, bestD = Infinity;
    for (const c of run.all) {
      const dist = Math.hypot(g.cx - c.cx, g.cy - c.cy);
      if (dist < bestD) { bestD = dist; best = c; }
    }
    if (best) { attach(best.id, `missed:${gi}`); errorCount++; }
  });

  const shipped = run.priorities;
  // What the queue was before impact ordering: rank alone, stable in build
  // order. This is the honest "what did the new sort actually buy" comparison.
  const rankOnly = run.priorities.slice().sort((a, b) => a.rank - b.rank || a.buildOrder - b.buildOrder);

  let rnd = { 1: 0, 3: 0, 5: 0 };
  let seed = 1234567;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < RANDOM_TRIALS; t++) {
    const shuffled = run.priorities.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (const n of [1, 3, 5]) rnd[n] += reachedBy(shuffled, n, errorsByTarget);
  }
  for (const n of [1, 3, 5]) rnd[n] /= RANDOM_TRIALS;

  const at = (order, n) => reachedBy(order, n, errorsByTarget);
  const s = [at(shipped, 1), at(shipped, 3), at(shipped, 5)];
  const r = [at(rankOnly, 1), at(rankOnly, 3), at(rankOnly, 5)];
  const biggestBatch = Math.max(0, ...run.reviewGroups.map(g => g.need));

  console.log(`${id.padEnd(17)} ${String(errorCount).padStart(6)} ${String(run.priorities.length).padStart(6)} |`
    + ` ${s.join("/").padEnd(15)} ${r.join("/").padEnd(17)} ${[rnd[1], rnd[3], rnd[5]].map(x => x.toFixed(1)).join("/").padEnd(17)} |`
    + ` ${String(run.reviewGroups.length).padStart(6)}  ${biggestBatch}`);

  if (run.reviewGroups.length > MAX_GROUPS)
    failures.push(`${id}: ${run.reviewGroups.length} review groups (max ${MAX_GROUPS})`);

  report.variants.push({ variant: id, errors: errorCount, items: run.priorities.length,
    reviewGroups: run.reviewGroups.length,
    shipped: { 1: s[0], 3: s[1], 5: s[2] },
    rankOnly: { 1: r[0], 3: r[1], 5: r[2] },
    randomMean: { 1: +rnd[1].toFixed(2), 3: +rnd[3].toFixed(2), 5: +rnd[5].toFixed(2) },
    biggestBatch,
    firstItem: run.priorities[0] ? { key: run.priorities[0].key, impact: run.priorities[0].impact } : null });
}

// ---- the order is the same on a re-run of the same plan ----------------------
const first = await analyse(page, app.baseUrl, GOLDEN);
const second = await analyse(page, app.baseUrl, GOLDEN);
const sig = run => run.priorities.map(p => `${p.rank}|${p.key}|${p.signature}|${p.impact.facts},${p.impact.objects},${p.impact.seats}`);
const deterministic = JSON.stringify(sig(first)) === JSON.stringify(sig(second));
if (!deterministic) failures.push("the queue is not in the same order on a re-run of the identical plan");
report.deterministic = deterministic;

await browser.close();
await app.close();

const sum = (rows, k, n) => rows.reduce((t, v) => t + v[k][n], 0);
const rows = report.variants;
const totals = { shipped: {}, rankOnly: {}, randomMean: {} };
for (const n of [1, 3, 5]) for (const k of ["shipped", "rankOnly", "randomMean"]) totals[k][n] = +sum(rows, k, n).toFixed(2);

console.log("\nTOTAL real errors reached, across all renderings");
console.log(`  first item     shipped ${totals.shipped[1]}   rank-only ${totals.rankOnly[1]}   random ${totals.randomMean[1]}`);
console.log(`  first three    shipped ${totals.shipped[3]}   rank-only ${totals.rankOnly[3]}   random ${totals.randomMean[3]}`);
console.log(`  first five     shipped ${totals.shipped[5]}   rank-only ${totals.rankOnly[5]}   random ${totals.randomMean[5]}`);

console.log("\nGATES");
const gate = (label, value, ok, target) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(50)} ${String(value).padStart(10)}   ${target}`);
  if (!ok) failures.push(`gate: ${label} = ${value} (${target})`);
};
for (const n of [1, 3, 5])
  gate(`first ${n} beats a random order`, `${totals.shipped[n]} vs ${totals.randomMean[n]}`,
    totals.shipped[n] > totals.randomMean[n], "strictly more errors reached");
gate("first 5 is at least as good as rank alone", `${totals.shipped[5]} vs ${totals.rankOnly[5]}`,
  totals.shipped[5] >= totals.rankOnly[5], "impact ordering must not make it worse");
gate("the queue order is stable across a re-run", deterministic, deterministic, "true");
gate("most review groups an operator faces at once", Math.max(...rows.map(r => r.reviewGroups)),
  Math.max(...rows.map(r => r.reviewGroups)) <= MAX_GROUPS, `<= ${MAX_GROUPS}`);
// Reported, deliberately NOT gated. A family of thirty-five is ONE decision --
// "apply to all" -- and splitting it into five batches of eight would give the
// operator five decisions instead of one while covering the same objects. That
// is a regression dressed as a limit. What matters is how many cards they face,
// which is the gate above.
console.log(`  note  largest single family behind one \"apply to all\": ${Math.max(...rows.map(r => r.biggestBatch))} objects`);

report.totals = totals;
fs.writeFileSync(path.join(HERE, "report.json"), JSON.stringify(report, null, 1) + "\n");
console.log(`\nwrote ${path.relative(process.cwd(), path.join(HERE, "report.json"))}`);
console.log("\nREAL DISTINCT VENUE PLANS: 1. Every rendering above is the same drawing.");

if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("\nAll gates met.");
