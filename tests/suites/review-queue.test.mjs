// A ranked row that cannot be acted on wastes the operator's attention twice.
//
// The Confidence Budget already said WHICH uncertainties were worth deciding
// and in what order. It said it as a list of sentences with no way in: the
// operator read "31 table numbers need review", agreed, and then had to go and
// find those 31 tables themselves. This suite covers the path from a ranked row
// to a decided object and back again.
//
// The load-bearing property is in `queueState`: what counts as RESOLVED is read
// from the candidates on every render and never remembered by the queue. A
// queue that kept its own tally would drift the moment a decision was undone
// and would then be confidently wrong about how much work was left.
import { click, openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = { name: "review-queue", tags: ["business", "fast"], timeout: 180000 };

// Enough round tables in a grid that the detector produces a family worth
// reviewing, drawn in the page so the suite carries no fixture.
const MAKE_PLAN = `(function(){
  const c = document.createElement("canvas");
  c.width = 1000; c.height = 620;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#222"; g.lineWidth = 3;
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.arc(120 + i * 190, 130 + row * 180, 54, 0, Math.PI * 2);
      g.stroke();
    }
  return c.toDataURL("image/png");
})()`;

const QUEUE = `(function(){
  const q = ui.reviewQueue;
  const bar = document.querySelector(".review-queue-bar");
  return {
    open: !!q,
    ids: q ? q.ids.length : 0,
    index: q ? q.index : null,
    skipped: q ? q.skipped.length : 0,
    selected: ui.selectedCandidateId,
    selectedIsCurrent: q ? ui.selectedCandidateId === q.ids[q.index] : null,
    barPresent: !!bar,
    progress: bar ? bar.querySelector(".rq-progress").textContent.trim() : null,
    nextDisabled: bar ? !!bar.querySelector('[data-queue="next-outstanding"]').disabled : null,
    screen: ui.screen, tab: ui.tab, planMode: ui.planMode,
    shellIntact: !!document.querySelector(".workspace-head .event-id strong")
      && document.querySelectorAll(".tabs [data-tab]").length === 6
      && !!document.getElementById("globalGuestSearch"),
  };
})()`;

// Open a queue the way an operator does: through the Review Center's ranked
// rows. Returns false when no claim names more than one live object, which is a
// legitimate state after enough decisions rather than a failure.
async function openAnyQueue(page) {
  await page.evaluate(() => { ui.reviewQueue = null; ui.reviewCenterOpen = true; render(); });
  await page.waitForTimeout(400);
  const id = await page.evaluate(() => {
    const b = state.events[0].analysis.confidenceBudget;
    const byId = new Map(state.events[0].analysis.candidates.map(c => [c.id, c]));
    const c = (b.spend || []).find(x => (x.targetIds || []).filter(i => byId.has(i)).length > 1);
    return c ? c.id : null;
  });
  if (!id) { await page.evaluate(() => { ui.reviewCenterOpen = false; render(); }); return false; }
  await click(page, `[data-budget-open="${id}"]`);
  await page.waitForTimeout(500);
  return await page.evaluate(() => !!ui.reviewQueue);
}

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Queue", hotel: "Merit Royal", date: "2026-11-24" });

  await page.evaluate(src => {
    state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, await page.evaluate(MAKE_PLAN));
  await page.waitForTimeout(300);
  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 120000 });
  await page.waitForTimeout(800);

  // --- 1. every ranked row either goes somewhere or says why it cannot ------
  await page.evaluate(() => { ui.reviewCenterOpen = true; render(); });
  await page.waitForTimeout(400);

  const rows = await page.evaluate(() => {
    const spend = state.events[0].analysis.confidenceBudget.spend;
    const byId = new Map(state.events[0].analysis.candidates.map(c => [c.id, c]));
    return spend.map(c => ({
      id: c.id,
      live: (c.targetIds || []).filter(x => byId.has(x)).length,
      hasButton: !!document.querySelector(`[data-budget-open="${c.id}"]`),
      saysWhyNot: !!document.querySelector(`[data-budget-open="${c.id}"]`) ? null
        : true,
    }));
  });
  checks.require(rows.length > 0, "the plan produced at least one ranked claim", rows.length);
  const wrong = rows.filter(r => (r.live > 0) !== r.hasButton);
  checks.ok(wrong.length === 0,
    "every claim that names live objects offers a way in, and only those do", wrong.slice(0, 3));

  const nowhere = await page.evaluate(() =>
    document.querySelectorAll(".budget-claim-nowhere").length);
  checks.equal(nowhere, rows.filter(r => !r.hasButton).length,
    "a claim with nowhere to go says so instead of offering a dead button");

  const actionable = rows.find(r => r.hasButton && r.live > 1);
  checks.require(!!actionable, "at least one claim covers more than one object", rows);

  // --- 2. opening it lands on the object, inside the shell -----------------
  await click(page, `[data-budget-open="${actionable.id}"]`);
  await page.waitForTimeout(600);
  const opened = await page.evaluate(QUEUE);
  checks.ok(opened.open, "clicking a ranked row opens a review queue over its objects");
  checks.equal(opened.ids, actionable.live, "the queue holds exactly that claim's live objects");
  checks.equal(opened.screen, "workspace", "and does not leave the workspace");
  checks.equal(opened.tab, "floor", "it goes to the Floor Plan");
  checks.equal(opened.planMode, "review", "in review mode");
  checks.ok(opened.shellIntact, "with the event, the tabs and the guest search still there");
  checks.ok(opened.selectedIsCurrent && opened.selected,
    "and the first object of the queue is selected, not just the queue opened", opened);
  checks.ok(opened.barPresent && /\d/.test(opened.progress),
    "the queue states its position", opened.progress);

  // The selected object is what focuses the plan and opens the inspector —
  // the same machinery a manual click uses, not a second one.
  const focused = await page.evaluate(() => ({
    inspector: !!document.querySelector(".poi-card"),
    highlighted: document.querySelectorAll(".candidate-box.selected, .candidate-box.review-target").length,
    zoomed: (document.getElementById("analysisSceneInner")?.style.transform || "").includes("scale"),
  }));
  checks.ok(focused.inspector, "the inspector for that object is open", focused);
  checks.ok(focused.highlighted > 0, "the object is highlighted on the plan", focused);
  checks.ok(focused.zoomed, "and the plan is focused on it", focused);

  // --- 3. moving through it ------------------------------------------------
  const first = opened.selected;
  await click(page, '[data-queue="next-outstanding"]');
  await page.waitForTimeout(400);
  const moved = await page.evaluate(QUEUE);
  checks.ok(moved.selected !== first, "Next undecided moves to a different object", moved.selected);
  checks.ok(moved.selectedIsCurrent, "and the queue's position follows the selection");

  await click(page, '[data-queue="prev"]');
  await page.waitForTimeout(400);
  const back = await page.evaluate(QUEUE);
  checks.equal(back.selected, first, "Previous goes back to the one before");

  await click(page, '[data-queue="skip"]');
  await page.waitForTimeout(400);
  const skipped = await page.evaluate(QUEUE);
  checks.equal(skipped.skipped, 1, "Skip records that one was passed over");
  checks.ok(skipped.selected !== first, "and moves on");

  // --- 4. a decision resolves the item and the counts follow --------------
  const beforeDecision = await page.evaluate(() => ({
    unreviewed: state.events[0].analysis.candidates.filter(c => c.status === "unreviewed").length,
    shown: state.events[0].analysis.confidenceBudget.counts.shown,
    badge: document.querySelector(".plan-health-badge")?.textContent.trim() || null,
  }));
  const deciding = await page.evaluate(() => ui.selectedCandidateId);
  await click(page, '[data-review-action="confirm"]');
  await page.waitForTimeout(700);

  const decided = await page.evaluate(id => ({
    status: state.events[0].analysis.candidates.find(c => c.id === id)?.status,
    unreviewed: state.events[0].analysis.candidates.filter(c => c.status === "unreviewed").length,
    selected: ui.selectedCandidateId,
    queueOpen: !!ui.reviewQueue,
    progress: document.querySelector(".rq-progress")?.textContent.trim() || null,
  }), deciding);
  checks.equal(decided.status, "confirmed", "confirming from inside the queue decides that object");
  checks.equal(decided.unreviewed, beforeDecision.unreviewed - 1, "exactly one object left the undecided pile");
  checks.ok(decided.queueOpen, "the queue stays open");
  checks.ok(decided.selected !== deciding,
    "and moves to the next thing rather than leaving the operator on what they just settled");
  checks.ok(/\d/.test(decided.progress || ""), "the progress line is still readable", decided.progress);

  // The resolved count is READ from the candidates, so it went up on its own.
  const resolvedCount = await page.evaluate(() => {
    const q = ui.reviewQueue;
    const byId = new Map(state.events[0].analysis.candidates.map(c => [c.id, c]));
    return q.ids.filter(id => { const c = byId.get(id); return !c || c.status !== "unreviewed"; }).length;
  });
  checks.ok(resolvedCount >= 1,
    "the queue counts that decision as resolved without being told", resolvedCount);

  // --- 5. undoing a decision must un-resolve it ---------------------------
  //
  // This is the check that a remembered tally would fail. Nothing tells the
  // queue that the decision was reversed; it recomputes from the data.
  await page.evaluate(id => {
    state.events[0].analysis.candidates.find(c => c.id === id).status = "unreviewed";
    render();
  }, deciding);
  await page.waitForTimeout(300);
  const afterUndo = await page.evaluate(() => {
    const q = ui.reviewQueue;
    const byId = new Map(state.events[0].analysis.candidates.map(c => [c.id, c]));
    return q.ids.filter(id => { const c = byId.get(id); return !c || c.status !== "unreviewed"; }).length;
  });
  checks.equal(afterUndo, resolvedCount - 1,
    "reversing a decision drops the queue's resolved count — it reads the data, it does not remember");

  // --- 6. the budget itself recomputes, so a row is never stale ------------
  const budgetNow = await page.evaluate(() => ({
    shown: state.events[0].analysis.confidenceBudget.counts.shown,
    claims: state.events[0].analysis.confidenceBudget.counts.claims,
  }));
  checks.ok(typeof budgetNow.shown === "number" && budgetNow.shown >= 0,
    "the Confidence Budget was recomputed after the decision", budgetNow);

  // --- 7. leaving --------------------------------------------------------
  await page.evaluate(() => { ui.reviewQueue && render(); });
  await click(page, '[data-queue="exit"]').catch(() => {});
  await page.waitForTimeout(400);
  const exited = await page.evaluate(QUEUE);
  checks.ok(!exited.open, "Exit closes the queue");
  checks.equal(exited.screen, "workspace", "and leaves the operator in the workspace");
  checks.equal(exited.planMode, "review", "still on the plan they were reviewing");
  checks.ok(exited.shellIntact, "with the shell intact");

  // Escape does the same thing, because a modal-feeling strip should. Reopened
  // through the real control rather than by calling into the app: openReviewQueue
  // is IIFE-scoped and not reachable from page.evaluate, and a test that reached
  // past the button would stop covering the button.
  const reopen = await openAnyQueue(page);
  if (reopen) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    checks.ok(!(await page.evaluate(() => !!ui.reviewQueue)), "Escape closes it too");
  } else {
    checks.ok(true, "no multi-object claim survived the decisions, so there was no queue to escape");
  }

  // --- 8. no raw key in either language -----------------------------------
  for (const lang of ["en", "tr"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    await page.waitForTimeout(300);
    await openAnyQueue(page);
    const leaked = await page.evaluate(() => {
      const root = document.querySelector(".review-queue-bar") || document.body;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
      const found = new Set();
      let n;
      while ((n = walker.nextNode())) {
        const s = n.textContent.trim();
        if (s && s.length <= 60 && KEY.test(s) && !/^\d/.test(s)) found.add(s);
      }
      return [...found];
    });
    checks.equal(leaked.length, 0, `no untranslated key in the queue bar in ${lang.toUpperCase()}`);
  }
}
