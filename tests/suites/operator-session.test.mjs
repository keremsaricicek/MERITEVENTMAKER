// Recording what an operator did, without becoming something that watches them.
//
// Every number in benchmarks/review-order/ is about REACHING an error, not
// about a person resolving one. Those runs are made by a script that never gets
// confused, never scrolls past a card, and never decides the third question is
// not worth answering. Whether this screen works for someone doing the job is a
// different question, and no benchmark in this repository answers it.
//
// What the product can do is make the answer recordable, so a real session with
// a real person produces evidence instead of an impression. This suite pins the
// two properties that instrument has to have:
//
//   1. It records enough to be worth running — what was done, when, and where
//      it sat in the order the product had suggested at the time.
//   2. It never leaves the machine. A tool that watches an operator work and
//      can also phone home is a different product from the one they agreed to
//      run, so this asserts ZERO off-origin requests across a whole review
//      session, not merely that no analytics endpoint is configured today.
//
// It does NOT claim the screen is usable. That is `benchmarks/operator/`, it
// requires a person, and until one has done it the answer is NOT VERIFIED.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = {
  name: "operator-session",
  tags: ["intelligence"],
  timeout: 240000,
  viewport: { width: 1800, height: 1000 },
};

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const plan = path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png");
  checks.require(fs.existsSync(plan), "the real venue plan fixture is present", plan);

  // Every request the page attempts, from before the app even loads. Same-origin
  // is the app serving itself; anything else is the thing being ruled out.
  // Every request the page attempts, from before the app even loads.
  //
  // The NON-offline build legitimately fetches three vendor libraries from a
  // CDN (SheetJS, Tesseract, pdf.js) — that is what the offline build exists to
  // remove, and benchmarks/offline/ proves it does. So the assertion here is
  // not "no traffic", which would be false for a reason that has nothing to do
  // with this feature. It is the two things that would actually matter: nothing
  // is ever SENT anywhere, and no request at all happens while an operator is
  // being recorded.
  const offOrigin = [];
  page.on("request", r => {
    const u = r.url();
    if (!u.startsWith(baseUrl) && !u.startsWith("data:") && !u.startsWith("blob:"))
      offOrigin.push({ url: u, method: r.method() });
  });

  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Operator", hotel: "Merit", date: "2026-10-02" });
  await page.evaluate(src => {
    state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, "data:image/png;base64," + fs.readFileSync(plan).toString("base64"));
  await page.waitForTimeout(500);
  await click(page, '[data-v8-action="detect"]');
  // Wait for the analysis to FINISH, not merely to exist. `analysis` is
  // assigned partway through the pass, so waiting on it alone reads a run that
  // is still going — and the retrying click helper can start a second one on
  // top of it. `analysisBusy` is the signal a person waits for too.
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy,
    null, { timeout: 240000 });
  await page.waitForTimeout(600);

  // Nothing recorded before anything was done: opening a plan is not a session
  // worth a row.
  const beforeAnyAction = await page.evaluate(() => (state.operatorSessions || []).length);
  checks.equal(beforeAnyAction, 0,
    "analysing a plan records no session on its own — a session starts when someone acts", beforeAnyAction);

  // ---- act like an operator working the queue -----------------------------
  //
  // Real clicks on real controls, because the recording hooks live in the click
  // handlers: calling the domain functions directly would test nothing about
  // what happens when a person uses the screen.
  const firstTarget = await page.evaluate(() => {
    const pi = state.events[0].analysis.planIntelligence;
    const top = pi.reviewPriorities[0];
    const id = (top.targetIds || []).find(x => state.events[0].analysis.candidates.some(c => c.id === x));
    if (!id) return null;
    ui.selectedCandidateId = id; ui.reviewDrawMode = false; render();
    return { id, key: top.key };
  });
  checks.require(firstTarget, "the top of the queue points at an object that can be opened");
  // From here on, the operator is being recorded. Nothing may leave the origin.
  const beforeActions = offOrigin.length;
  await click(page, '[data-review-action="confirm"]');
  await page.waitForTimeout(200);

  // Then something the queue did not point at, which is a real operator
  // behaviour and has to be distinguishable in the record.
  const offQueue = await page.evaluate(() => {
    const a = state.events[0].analysis, pi = a.planIntelligence;
    const suggested = new Set(pi.reviewPriorities.flatMap(p => p.targetIds || []));
    const c = a.candidates.find(x => x.kind === "table" && x.status === "unreviewed" && !suggested.has(x.id));
    if (!c) return null;
    ui.selectedCandidateId = c.id; render();
    return c.id;
  });
  if (offQueue) {
    await click(page, '[data-review-action="reject"]');
    await page.waitForTimeout(200);
  }

  // And a bulk confirmation, which is one decision covering many objects.
  const bulk = await page.evaluate(() => {
    const pi = state.events[0].analysis.planIntelligence;
    const g = pi.reviewGroups[0];
    if (!g) return null;
    ui.reviewCenterOpen = true; render();
    return { id: g.id, members: g.memberIds.length };
  });
  if (bulk) {
    await click(page, `[data-reviewgroup-action="confirm-family"][data-group="${bulk.id}"]`);
    await page.waitForTimeout(300);
  }

  const session = await page.evaluate(() => {
    const s = (state.operatorSessions || [])[0];
    return {
      count: (state.operatorSessions || []).length,
      raw: s ? { analysisId: s.analysisId, actions: s.actions, suggested: s.suggestedOrder.length,
                 hasStart: !!s.startedAt } : null,
      summary: globalThis.MeritOperatorSessions.summary(state.events[0].analysis.id),
      all: globalThis.MeritOperatorSessions.all().length,
    };
  });

  checks.require(session.raw, "a session exists once the operator has acted", session.count);
  checks.equal(session.count, 1, "one analysis, one session — not one per click", session.count);
  checks.ok(session.raw.actions.length >= 2,
    "each action is recorded", session.raw.actions.map(a => a.type));
  checks.ok(session.raw.actions.every(a => typeof a.sinceStartMs === "number" && a.sinceStartMs >= 0),
    "with the time since the session opened, so pace is measurable",
    session.raw.actions.map(a => a.sinceStartMs));
  checks.ok(session.raw.suggested > 0,
    "the order the product suggested is captured as it was AT THE TIME, not recomputed after the edits",
    session.raw.suggested);

  const confirm = session.raw.actions.find(a => a.type === "confirm");
  checks.ok(confirm && confirm.suggestedPosition === 0,
    "an action on the top item is recorded as position 0", confirm);
  if (offQueue) {
    const rejected = session.raw.actions.find(a => a.type === "reject");
    checks.ok(rejected && rejected.suggestedPosition === -1,
      "work the queue never pointed at is recorded as off-queue, not silently attributed to an item",
      rejected);
  }
  if (bulk) {
    const family = session.raw.actions.find(a => a.type === "confirm-family");
    checks.ok(family && family.targetIds.length > 1,
      "a bulk confirmation is one action covering many objects", family && family.targetIds.length);
  }

  const s = session.summary;
  checks.require(s, "the summary reads back for this analysis");
  checks.equal(s.actions, session.raw.actions.length, "the summary counts every action", s.actions);
  checks.ok(s.onQueueActions + s.offQueueActions === s.actions,
    "on-queue and off-queue work account for all of it", s);
  checks.ok(s.msToFirstAction !== null && s.msToLastAction >= s.msToFirstAction,
    "time to first and last action are both available", s);
  checks.equal(s.firstActionWasTopOfQueue, true,
    "and whether the operator started where the product pointed", s.firstActionWasTopOfQueue);

  // ---- the one-click report ------------------------------------------------
  //
  // OP4: the person running the usability test must be able to finish it
  // without opening a developer console. So the report is reached by clicking
  // a real control, and read as rendered text — not from a global.
  await page.evaluate(() => { ui.operatorReportOpen = false; ui.selectedCandidateId = null; render(); });
  // The control lives inside Advanced Diagnostics, which is a collapsed
  // disclosure. That is deliberate — this is test instrumentation, not a
  // feature the everyday operator needs on screen — so the test opens it the
  // way a person would rather than setting the flag directly.
  await click(page, '.planintel-diagnostics > summary');
  await page.waitForTimeout(200);
  await click(page, '[data-review-action="session-report"]');
  await page.waitForTimeout(300);
  const report = await page.evaluate(() => {
    const was = ui.lang, out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; render();
      const n = document.querySelector(".op-report-panel");
      out[lang] = n ? n.innerText : null;
    }
    ui.lang = was; render();
    return { text: out, api: globalThis.MeritOperatorReport() };
  });
  checks.ok(report.text.en && report.text.tr,
    "the session report opens from a control on the screen, in both languages",
    { en: !!report.text.en, tr: !!report.text.tr });
  for (const lang of ["en", "tr"]) {
    checks.ok(!/\bop\.[a-zA-Z]/.test(report.text[lang]) && !/\{[a-zA-Z]+\}/.test(report.text[lang]),
      `no raw key or placeholder reaches the tester in ${lang.toUpperCase()}`,
      (report.text[lang] || "").slice(0, 160));
  }
  const api = report.api;
  checks.require(api, "the report is also readable as data");
  checks.ok(api.actions.total >= 2, "it counts the actions actually taken", api.actions);
  checks.equal(api.actions.startedAtTopOfQueue, true,
    "and whether the operator started where the product pointed", api.actions.startedAtTopOfQueue);
  checks.ok(typeof api.timings.analysisS === "number" && api.timings.analysisS > 0,
    "analysis time is measured, not guessed", api.timings);
  checks.equal(api.confirmed, false,
    "and it says the plan was not confirmed, because it was not", api.confirmed);
  checks.ok(api.plan_state.objectsDetected > 0 && api.plan_state.reviewItemsLeft !== null,
    "it reports what is still unresolved", api.plan_state);

  // ---- it stays on the machine --------------------------------------------
  checks.equal(offOrigin.length - beforeActions, 0,
    "not one off-origin request is attempted from the moment the operator starts being recorded",
    offOrigin.slice(beforeActions).map(r => `${r.method} ${r.url}`));
  const sending = offOrigin.filter(r => r.method !== "GET");
  checks.equal(sending.length, 0,
    "and nothing is ever SENT off-origin — every request the page makes is a GET for an asset",
    sending.map(r => `${r.method} ${r.url}`));
  const unexpectedHosts = [...new Set(offOrigin.map(r => new URL(r.url).host))]
    .filter(h => h !== "cdn.jsdelivr.net");
  checks.equal(unexpectedHosts.length, 0,
    "the only off-origin host is the vendor CDN this build loads its libraries from (the offline build removes even that)",
    unexpectedHosts);

  const source = fs.readFileSync(path.join(repoRoot, "src/app-v8.js"), "utf8");
  const block = source.slice(source.indexOf("---- operator sessions"),
    source.indexOf("---- the visual second opinion"));
  checks.ok(block.length > 500, "the operator-session block was located in source", block.length);
  for (const forbidden of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource"])
    checks.ok(!block.includes(forbidden),
      `the operator-session code contains no ${forbidden} — not disabled, absent`, forbidden);

  // ---- and it survives a reload, like every other decision ----------------
  await page.reload();
  await page.waitForFunction(() => { try { return Array.isArray(state.events); } catch { return false; } },
    null, { timeout: 20000 });
  await page.waitForTimeout(400);
  const afterReload = await page.evaluate(() => {
    const list = state.operatorSessions || [];
    return { count: list.length, actions: list[0] ? list[0].actions.length : 0 };
  });
  checks.equal(afterReload.count, 1, "the session survives a reload", afterReload);
  checks.equal(afterReload.actions, session.raw.actions.length,
    "with every action intact", afterReload.actions);
}
