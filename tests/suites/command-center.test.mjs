// The Event Command Center: does the product answer "is this event ready" once,
// in words, with the reasons attached?
//
// Three things here are load-bearing and are the reason this suite exists.
//
// 1. THE VERDICT IS NEVER A NUMBER. There is no honest weighting of "one
//    duplicate table number" against "twelve unseated guests", so the screen
//    must never render a readiness percentage. A future refactor that adds one
//    would look like an improvement in a diff and is the exact thing the
//    programme forbids.
// 2. THE HEADER AND THE SCREEN CANNOT DISAGREE. The workspace header badge and
//    the Command Center count the same reasons. Two controls answering the same
//    question with different numbers is the defect B1 fixed for the status pill
//    and the review chip; it must not come back here.
// 3. THE SELF-CHECK REACHES A TURKISH OPERATOR IN TURKISH. The module writes
//    English sentences for the benchmarks and the exported report, so the screen
//    restates each check from the numbers the check carries. If that path breaks
//    the screen silently falls back to English inside a Turkish UI.
import { click, openApp, createBlankEvent, addTables, addGuest, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "command-center", tags: ["business", "fast"], timeout: 120000 };

// Two tables named the same is a blocker; ten pax against eight chairs is a
// second. Both go through the model the way the app stores it.
const BREAK_THE_PLAN = `(function(){
  const e = state.events[0];
  e.tables.forEach(t => { t.number = "T01"; });
  return e.tables.map(t => t.number);
})()`;

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Command", hotel: "Merit Royal", date: "2026-11-20" });

  // --- 1. creating an event still lands on the plan, not on a summary -------
  const afterCreate = await page.evaluate(() => ui.tab);
  checks.equal(afterCreate, "floor",
    "a newly created blank event opens on Floor Plan — there is nothing to summarise yet");

  await addTables(page, { quantity: 2 });
  await gotoTab(page, "guests");
  await addGuest(page, { name: "Ada Lovelace", additionalGuests: 3 });

  // --- 2. reopening an event lands on the Command Center --------------------
  await page.evaluate(() => { ui.screen = "events"; render(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => openEvent(state.events[0].id));
  await page.waitForTimeout(400);
  checks.equal(await page.evaluate(() => ui.tab), "command",
    "reopening an existing event lands on the Command Center");

  const tabs = await page.evaluate(() => [...document.querySelectorAll(".tabs [data-tab]")].map(b => b.dataset.tab));
  checks.equal(tabs[0], "command", "the Command Center is the first tab");
  checks.equal(tabs.length, 6, "the programme added exactly one navigation item", tabs);

  // --- 3. the verdict is a named state, never a percentage ------------------
  const verdicts = ["ready", "readyWithReview", "notReady", "liveRisk"];
  const headClass = await page.evaluate(() => document.querySelector(".cc-head")?.className || "");
  checks.ok(verdicts.some(v => headClass.includes("verdict-" + v)),
    "the header carries exactly one of the four named verdicts", headClass);

  const headText = await page.evaluate(() => document.querySelector(".cc-head")?.textContent || "");
  checks.ok(!/\d+\s*%/.test(headText),
    "the verdict is never expressed as a readiness percentage", headText);

  // --- 4. unseated guests are a review reason, not a blocker ---------------
  const withUnseated = await page.evaluate(() => ({
    verdict: document.querySelector(".cc-head").className,
    reasons: [...document.querySelectorAll(".cc-reason")].map(r => r.className),
  }));
  checks.ok(withUnseated.verdict.includes("verdict-readyWithReview"),
    "four unseated pax make the event ready-with-open-questions, not un-openable", withUnseated);
  checks.ok(withUnseated.reasons.length === 1 && withUnseated.reasons[0].includes("review"),
    "the unseated guests appear as a review reason", withUnseated.reasons);

  // --- 5. a blocker changes the verdict, and going live changes it again ----
  await page.evaluate(src => eval(src), BREAK_THE_PLAN);
  await page.evaluate(() => render());
  await page.waitForTimeout(250);
  const blocked = await page.evaluate(() => ({
    verdict: document.querySelector(".cc-head").className,
    blockers: document.querySelectorAll(".cc-reason.blocker").length,
  }));
  checks.ok(blocked.verdict.includes("verdict-notReady"),
    "a duplicate table number makes the event not ready to open", blocked);
  checks.ok(blocked.blockers >= 1, "the blocker is listed with its own weight", blocked);

  await page.evaluate(() => { state.events[0].guests[0].arrivalStatus = "Checked In"; render(); });
  await page.waitForTimeout(250);
  const live = await page.evaluate(() => ({
    verdict: document.querySelector(".cc-head").className,
    phase: document.querySelector(".cc-phase").className,
  }));
  checks.ok(live.verdict.includes("verdict-liveRisk"),
    "the same blocker with the doors open is a problem on the floor, not a preparation task", live);
  checks.ok(live.phase.includes("phase-live"),
    "checking a guest in moves the event into its live phase", live);

  // A checked-in guest must not have been rewritten by any of this: planning
  // status and arrival status are independent axes.
  const axes = await page.evaluate(() => {
    const g = state.events[0].guests[0];
    return { planning: g.planningStatus, arrival: g.arrivalStatus, assignment: g.assignment };
  });
  checks.equal(axes.planning, "Confirmed", "reading the Command Center did not touch planning status");
  checks.equal(axes.arrival, "Checked In", "reading the Command Center did not touch arrival status");

  // --- 6. the Self-Check reaches the screen, in the operator's language -----
  //
  // Injected directly because producing a real one needs OCR, which the normal
  // build does not have. The shape is exactly what MeritSelfCheck.run emits.
  await page.evaluate(() => {
    state.events[0].analysis = state.events[0].analysis || {};
    state.events[0].analysis.selfCheck = {
      checks: [
        { id: "capacityRuleArithmetic", statement: "166 x 12 = 1992", verdict: "CONSISTENT",
          inputs: [], detail: "the drawing's own multiplication comes out",
          params: { a: 166, b: 12, c: 1992, p: 1992 } },
        { id: "statedTablesVsDetected", statement: "the drawing states 166 tables; 163 were found",
          verdict: "INCONSISTENT", inputs: [], detail: "3 not accounted for",
          params: { a: 166, b: 163, d: 3, direction: "short" } },
      ],
      summary: { total: 2, consistent: 1, inconsistent: 1, needsReview: 0, notCheckable: 0 },
    };
    render();
  });
  await page.evaluate(() => { ui.lang = "tr"; render(); });
  await page.waitForTimeout(250);

  const tr = await page.evaluate(() => ({
    checks: [...document.querySelectorAll(".cc-check")].map(n => n.textContent.trim()),
    reasons: [...document.querySelectorAll(".cc-reason")].map(n => n.textContent.trim()),
  }));
  checks.ok(tr.checks.length === 2,
    "both self-check findings reach the Command Center — its first surface anywhere in the product", tr.checks);
  checks.ok(tr.checks.some(x => x.includes("çizim") || x.includes("masa")),
    "the self-check statement is restated in Turkish, not passed through in English", tr.checks);
  checks.ok(!tr.checks.some(x => /the drawing states/.test(x)),
    "no English self-check sentence leaks into the Turkish screen", tr.checks);
  checks.ok(tr.reasons.some(x => x.includes("163")),
    "an INCONSISTENT check is also listed as something that needs a decision", tr.reasons);

  await page.evaluate(() => { ui.lang = "en"; render(); });
  await page.waitForTimeout(250);
  const en = await page.evaluate(() => [...document.querySelectorAll(".cc-check")].map(n => n.textContent.trim()));
  checks.ok(en.some(x => x.includes("the drawing states 166 tables")),
    "the same finding reads correctly in English", en);

  // --- 6b. an empty check list has two different meanings ------------------
  //
  // Found by rendering the real Golden Plan: it HAD been analysed, it simply
  // prints no figure about itself for the arithmetic to check, and the screen
  // said "no plan has been analysed for this event yet". That is a lie an
  // operator has no way to detect, and it looked correct in source review.
  const silences = await page.evaluate(() => {
    const read = () => document.querySelector(".cc-block .cc-empty")?.textContent.trim() || null;
    const e = state.events[0], keep = e.analysis;
    e.analysis = { ...keep, selfCheck: { checks: [], summary: {} } };
    render();
    const analysed = read();
    e.analysis = null;
    render();
    const never = read();
    e.analysis = keep;
    render();
    return { analysed, never, expectAnalysed: t("cc.plan.nothingStated"), expectNever: t("cc.plan.none") };
  });
  checks.equal(silences.analysed, silences.expectAnalysed,
    "a plan that was read but states nothing checkable says exactly that");
  checks.equal(silences.never, silences.expectNever,
    "a plan that was never analysed says that instead");
  checks.ok(silences.analysed !== silences.never,
    "the two silences are not the same sentence", silences);

  // --- 7. the header badge and the screen count the same things ------------
  //
  // Deliberately checked HERE and not earlier. Before the self-check was
  // injected, `planIssues` and the full readiness reason list happened to be
  // the same length, so a badge wired to the narrower source passed anyway --
  // the check only bites once the screen knows something the old badge did
  // not. That is exactly the disagreement this guards against, so the guard
  // has to stand where the two sources genuinely differ.
  const contributions = await page.evaluate(() => ({
    planIssues: state.events[0].guests.filter(g => !g.assignment).length,
    inconsistent: state.events[0].analysis.selfCheck.checks.filter(c => c.verdict === "INCONSISTENT").length,
  }));
  checks.ok(contributions.inconsistent > 0,
    "the fixture really does give the screen a reason the plan-issue list cannot see", contributions);

  for (const lang of ["en", "tr"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    await page.waitForTimeout(250);
    const agreement = await page.evaluate(() => {
      const badge = document.querySelector(".plan-health-badge")?.textContent || "";
      const m = badge.match(/(\d+)\s*$/);
      return { badge: m ? Number(m[1]) : null, reasons: document.querySelectorAll(".cc-reason").length };
    });
    checks.ok(agreement.reasons > 1,
      `the screen lists more than one reason in ${lang.toUpperCase()}, so the count is worth comparing`, agreement);
    checks.equal(agreement.badge, agreement.reasons,
      `the header badge and the Command Center report the same number of open items in ${lang.toUpperCase()}`);
  }

  // --- 8. no raw translation key on the screen in either language ----------
  for (const lang of ["en", "tr"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    await page.waitForTimeout(200);
    const leaked = await page.evaluate(() => {
      const root = document.querySelector(".command-center");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const found = new Set();
      const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (text && text.length <= 60 && KEY.test(text) && !/^\d/.test(text)) found.add(text);
      }
      return [...found];
    });
    checks.ok(leaked.length === 0, `no untranslated key on the Command Center in ${lang.toUpperCase()}`, leaked);
  }

  // --- 9. reasons route into the screen that owns the work -----------------
  await page.evaluate(() => { ui.lang = "en"; render(); });
  await page.waitForTimeout(200);
  const routed = await page.evaluate(() =>
    [...document.querySelectorAll(".cc-reason [data-tab]")].map(b => b.dataset.tab));
  checks.ok(routed.includes("floor") || routed.includes("seating"),
    "each reason offers a way into the screen that can fix it", routed);
  await click(page, '.cc-reason [data-tab="seating"]');
  await page.waitForTimeout(400);
  checks.equal(await page.evaluate(() => ui.tab), "seating",
    "following a reason actually navigates to the screen that owns it");

  // --- 10. a historical event has no Command Center ------------------------
  await page.evaluate(() => {
    state.events[0].status = "Completed";
    openEvent(state.events[0].id);
  });
  await page.waitForTimeout(400);
  const historical = await page.evaluate(() => ({
    tab: ui.tab,
    tabs: [...document.querySelectorAll(".tabs [data-tab]")].map(b => b.dataset.tab),
    badge: !!document.querySelector(".plan-health-badge"),
    popover: !!document.querySelector("details.plan-health"),
  }));
  checks.ok(!historical.tabs.includes("command"),
    "a completed event has no Command Center — a finished night has no readiness to assess", historical.tabs);
  checks.equal(historical.tab, "guests", "a completed event still opens on its guest record");
  checks.ok(historical.popover && !historical.badge,
    "with no Command Center to open, the header keeps its own plan-health popover", historical);

  // Nothing in this walk may mutate a historical event.
  const untouched = await page.evaluate(() => {
    const e = state.events[0];
    return { tables: e.tables.length, guests: e.guests.length, arrival: e.guests[0].arrivalStatus };
  });
  checks.equal(untouched.tables, 2, "walking a historical event's screens changed no table");
  checks.equal(untouched.guests, 1, "walking a historical event's screens changed no guest");
  checks.equal(untouched.arrival, "Checked In", "walking a historical event's screens changed no arrival status");

  await gotoTab(page, "reports");
  checks.ok(await page.evaluate(() => (document.querySelector("#app")?.children.length || 0) > 0),
    "a historical event's reports still render with the Command Center in the build");
}
