// A human decision may change what the plan SAYS. It may never change what the
// detector FINDS.
//
// Both halves of that were broken, and neither was visible until Teach AI was
// measured against ground truth (benchmarks/teach-ai/measure-teaching.mjs).
// Confirmed objects are passed into the next detection pass as protected
// regions, so that a filter cannot delete something a person explicitly
// confirmed — a good rule, implemented two ways that leaked:
//
//   THE GUARD. The fragment filter stands down when it would delete a
//   candidate the detector is confident about. That test was computed over the
//   candidates left AFTER protection was applied, so protecting the one
//   confident candidate that was holding the filter back switched the filter
//   ON — and it then deleted other objects. A confirmation on one object
//   silently removed others.
//
//   THE MATCH. Protection asked only whether a candidate's CENTRE fell inside
//   a confirmed object's box. Measured: confirm six chairs, Re-Analyze, and
//   four merged double-table blobs — correctly deleted on the first pass — had
//   their centres inside a confirmed chair, were exempted, survived, and then
//   absorbed fifteen real chairs as their seats. Fifteen standalone chair
//   candidates the operator never touched disappeared from the plan.
//
// So this suite asserts the invariant directly rather than either mechanism:
// the geometry the detector reports must be identical before and after human
// decisions, and every decision must come back on the object it was made on.
// Accuracy lives in benchmarks/teach-ai/; what is pinned here is that teaching
// the plan cannot damage it.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = {
  name: "plan-memory-isolation",
  tags: ["intelligence", "slow"],
  timeout: 420000,
  viewport: { width: 1800, height: 1000 },
};

const geometryKey = c => `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.w.toFixed(3)},${c.h.toFixed(3)}`;

async function detect(page) {
  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
  await page.waitForTimeout(700);
}

async function reanalyse(page) {
  const previousId = await page.evaluate(() => state.events[0].analysis.id);
  await page.evaluate(() => { ui.screen = "review"; ui.selectedCandidateId = null; render(); });
  await click(page, '[data-review-action="reanalyze"]');
  await page.waitForFunction(id => state.events[0].analysis && state.events[0].analysis.id !== id,
    previousId, { timeout: 240000 });
  await page.waitForTimeout(700);
}

const geometry = page => page.evaluate(() =>
  state.events[0].analysis.candidates.map(c => `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.w.toFixed(3)},${c.h.toFixed(3)}`).sort());

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const planPath = path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png");
  checks.require(fs.existsSync(planPath), "the real venue plan is present", planPath);

  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Memory", hotel: "Merit", date: "2026-10-02" });
  await page.evaluate(src => {
    state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, "data:image/png;base64," + fs.readFileSync(planPath).toString("base64"));
  await page.waitForTimeout(500);

  await detect(page);
  const firstPass = await geometry(page);
  checks.ok(firstPass.length > 20, "the plan produced a substantial first pass", firstPass.length);

  // ---- a re-analysis with no decisions at all is identical ------------------
  // The control. Without it, a later assertion could pass because detection is
  // noisy rather than because protection is isolated.
  await reanalyse(page);
  const untouched = await geometry(page);
  checks.ok(untouched.join("|") === firstPass.join("|"),
    "re-analysing without any human decision reproduces the plan exactly",
    { before: firstPass.length, after: untouched.length,
      lost: firstPass.filter(g => !untouched.includes(g)).slice(0, 4),
      gained: untouched.filter(g => !firstPass.includes(g)).slice(0, 4) });

  // ---- now confirm a spread of objects, the way a person does --------------
  const toConfirm = await page.evaluate(() => {
    const cs = state.events[0].analysis.candidates.filter(c => c.status === "unreviewed");
    const chairs = cs.filter(c => c.kind === "venue" && c.type === "chair").slice(0, 5);
    const tables = cs.filter(c => c.kind === "table").slice(0, 4);
    return [...chairs, ...tables].map(c => ({ id: c.id, kind: c.kind, type: c.type,
      x: c.x, y: c.y, w: c.w, h: c.h }));
  });
  checks.require(toConfirm.length >= 4, "there are objects to confirm", toConfirm.length);

  for (const c of toConfirm) {
    await page.evaluate(id => { ui.screen = "review"; ui.selectedCandidateId = id; ui.reviewDrawMode = false; render(); }, c.id);
    await page.waitForSelector('select[data-candidate-edit="kindtype"]', { timeout: 5000 });
    await page.selectOption('select[data-candidate-edit="kindtype"]', `${c.kind}:${c.type}`);
    await page.waitForTimeout(50);
  }
  const memories = await page.evaluate(() => (state.events[0].planMemory || []).length);
  checks.ok(memories >= toConfirm.length,
    "every decision was remembered (propagation may add more)", { decisions: toConfirm.length, memories });

  // ---- and the detector still finds exactly the same objects ---------------
  await reanalyse(page);
  const afterDecisions = await geometry(page);
  const lost = firstPass.filter(g => !afterDecisions.includes(g));
  const gained = afterDecisions.filter(g => !firstPass.includes(g));
  checks.ok(lost.length === 0,
    "confirming objects never removes an object the detector had found",
    { lost: lost.length, examples: lost.slice(0, 6) });
  checks.ok(gained.length === 0,
    "and never conjures one either",
    { gained: gained.length, examples: gained.slice(0, 6) });

  // ---- every decision came back on the object it was made on ---------------
  const restored = await page.evaluate(objs => objs.map(o => {
    const at = state.events[0].analysis.candidates.filter(c =>
      Math.abs(c.x - o.x) < 0.01 && Math.abs(c.y - o.y) < 0.01 &&
      Math.abs(c.w - o.w) < 0.01 && Math.abs(c.h - o.h) < 0.01);
    const c = at[0];
    return { want: `${o.kind}:${o.type}`, found: c ? `${c.kind}:${c.type}` : null,
      status: c ? c.status : null, fromMemory: c ? !!c.fromMemory : false, matches: at.length };
  }), toConfirm);

  const missing = restored.filter(r => !r.found);
  checks.ok(missing.length === 0,
    "each confirmed object is still at its own coordinates after Re-Analyze", missing.slice(0, 4));
  const wrongLabel = restored.filter(r => r.found && r.found !== r.want);
  checks.ok(wrongLabel.length === 0,
    "and carries the decision the person made, not the detector's guess", wrongLabel.slice(0, 4));
  const notRemembered = restored.filter(r => r.found && !r.fromMemory);
  checks.ok(notRemembered.length === 0,
    "and is marked as coming from memory, so it is never mistaken for a fresh detection",
    notRemembered.slice(0, 4));
  const notConfirmed = restored.filter(r => r.status !== "confirmed");
  checks.ok(notConfirmed.length === 0,
    "and is still confirmed — a person's decision does not decay on re-analysis",
    notConfirmed.slice(0, 4));
}
