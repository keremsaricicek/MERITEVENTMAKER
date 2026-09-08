// Reviewing a plan must not cost the operator the application around it.
//
// Review used to be `ui.screen = "review"`: a full-screen takeover that replaced
// the workspace. Everything the operator uses to stay oriented went with it —
// the event's name, the tab bar, the readiness badge, and the global guest
// search. Someone reviewing a plan could not answer "which event am I in" or
// "is Mr Yilmaz already seated" without abandoning what they were doing.
//
// It is a MODE of the Floor Plan now. This suite exists to keep it one: the
// checks below are about the shell surviving, not about the review UI itself,
// because a future change that made review a screen again would look perfectly
// reasonable in a diff and would undo exactly this.
import { click, openApp, createBlankEvent, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "floor-plan-modes", tags: ["business", "fast"], timeout: 180000 };

// A small plan the detector can actually read, drawn in the page so the suite
// stays fast and carries no fixture. Eight filled circles in a row read as
// round tables; the exact count does not matter here, only that detection has
// something real to find.
const MAKE_PLAN = `(function(){
  const c = document.createElement("canvas");
  c.width = 900; c.height = 500;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#222"; g.lineWidth = 3;
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc(140 + i * 190, 160 + row * 190, 52, 0, Math.PI * 2);
      g.stroke();
    }
  return c.toDataURL("image/png");
})()`;

const SHELL = `({
  eventName: document.querySelector(".workspace-head .event-id strong")?.textContent || null,
  tabs: [...document.querySelectorAll(".tabs [data-tab]")].map(b => b.dataset.tab),
  activeTab: document.querySelector(".tabs .tab.active")?.dataset.tab || null,
  search: !!document.getElementById("globalGuestSearch"),
  readiness: !!document.querySelector(".plan-health-badge"),
  headerLang: document.querySelectorAll(".workspace-actions .lang-btn").length,
  modes: [...document.querySelectorAll("[data-plan-mode]")].map(b =>
    b.dataset.planMode + (b.classList.contains("active") ? "*" : "")),
  screen: ui.screen, tab: ui.tab, planMode: ui.planMode,
})`;

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Modes", hotel: "Merit Royal", date: "2026-11-22" });

  // --- 1. no plan, no mode switch -----------------------------------------
  const blank = await page.evaluate(SHELL);
  checks.equal(blank.planMode, "plan", "the Floor Plan starts in plan-editing mode");
  checks.equal(blank.modes.length, 0,
    "an event with no plan imported offers no mode switch — there is nothing to review");

  // --- 2. importing a plan offers the switch, and nothing else moves -------
  await page.evaluate(src => {
    state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, await page.evaluate(MAKE_PLAN));
  await page.waitForTimeout(300);

  const withPlan = await page.evaluate(SHELL);
  checks.equal(withPlan.modes.join(","), "plan*,review",
    "with a plan imported the Floor Plan offers both modes, editing selected");
  checks.equal(withPlan.screen, "workspace", "and it is still the workspace");

  // --- 3. the round trip keeps every part of the shell ---------------------
  //
  // This is the whole point of the phase, so it is checked on each leg rather
  // than only at the end: a shell that survives the trip out but not the trip
  // back is still a shell the operator loses.
  const legs = [];
  await click(page, '[data-plan-mode="review"]');
  await page.waitForTimeout(400);
  legs.push(["into review", await page.evaluate(SHELL)]);
  await click(page, '[data-plan-mode="plan"]');
  await page.waitForTimeout(400);
  legs.push(["back to plan", await page.evaluate(SHELL)]);
  await click(page, '[data-plan-mode="review"]');
  await page.waitForTimeout(400);
  legs.push(["into review again", await page.evaluate(SHELL)]);

  for (const [where, s] of legs) {
    checks.equal(s.screen, "workspace", `${where}: the operator never leaves the workspace`);
    checks.ok(s.eventName === "Modes", `${where}: the event's name is still on screen`, s.eventName);
    checks.equal(s.tabs.length, 6, `${where}: the tab bar is still there`);
    checks.equal(s.activeTab, "floor", `${where}: Floor Plan is still the active tab`);
    checks.ok(s.search, `${where}: the global guest search is still reachable`);
    checks.ok(s.readiness, `${where}: the readiness badge is still there`);
  }
  checks.equal(legs[0][1].planMode, "review", "the switch actually changes the mode");
  checks.equal(legs[1][1].planMode, "plan", "and changes it back");

  // The guest search is not just present — it works from inside review mode.
  await click(page, '[data-plan-mode="review"]');
  await page.waitForTimeout(300);
  await page.fill("#globalGuestSearch", "any");
  await page.waitForTimeout(300);
  checks.ok(await page.evaluate(() => !!document.getElementById("globalSearchResults")),
    "and it responds to typing rather than being decoration");

  // --- 4. the mode is remembered across a visit to another tab -------------
  await gotoTab(page, "guests");
  await page.waitForTimeout(200);
  checks.equal(await page.evaluate(() => ui.planMode), "review",
    "stepping into Guests does not silently abandon a review in progress");
  await gotoTab(page, "floor");
  await page.waitForTimeout(400);
  const returned = await page.evaluate(SHELL);
  checks.equal(returned.planMode, "review", "and coming back to Floor Plan resumes it");
  checks.equal(returned.screen, "workspace", "still in the workspace");

  // --- 5. one language control, in the shell, not three in the screens -----
  const langs = await page.evaluate(() => ({
    header: document.querySelectorAll(".workspace-actions .lang-btn").length,
    inToolbar: document.querySelectorAll(".planmap-toolbar [data-v8-action='toggle-lang']").length,
    inReviewBar: document.querySelectorAll(".planintel-top [data-review-action='toggle-lang']").length,
  }));
  checks.equal(langs.header, 1, "the language toggle lives in the workspace header");
  checks.equal(langs.inToolbar, 0, "not also inside the plan toolbar");
  checks.equal(langs.inReviewBar, 0, "and not also inside the review bar");

  await click(page, ".workspace-actions .lang-btn");
  await page.waitForTimeout(300);
  checks.equal(await page.evaluate(() => ui.lang), "tr",
    "and it works from inside review mode");
  const trModes = await page.evaluate(() =>
    [...document.querySelectorAll("[data-plan-mode]")].map(b => b.textContent.trim()));
  checks.ok(trModes.length === 2 && trModes.every(x => x && !/^[a-z]+\.[a-z]/i.test(x)),
    "the mode switch is translated, not showing a raw key", trModes);
  await click(page, ".workspace-actions .lang-btn");
  await page.waitForTimeout(300);

  // --- 6. Assisted Detection lands in review MODE, not another screen ------
  await click(page, '[data-plan-mode="plan"]');
  await page.waitForTimeout(300);
  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 120000 });
  await page.waitForTimeout(600);
  const afterDetect = await page.evaluate(SHELL);
  checks.equal(afterDetect.screen, "workspace",
    "running Assisted Detection does not take the operator out of the workspace");
  checks.equal(afterDetect.tab, "floor", "it stays on the Floor Plan tab");
  checks.equal(afterDetect.planMode, "review", "and switches that tab into review mode");
  checks.ok(afterDetect.eventName === "Modes" && afterDetect.search && afterDetect.tabs.length === 6,
    "with the event, the tabs and the search all still present", afterDetect);

  // --- 7. the Command Center's way in is the same way in ------------------
  await gotoTab(page, "command");
  await page.waitForTimeout(400);
  const reviewLink = await page.evaluate(() =>
    document.querySelectorAll('[data-cc-action="review"]').length);
  if (reviewLink) {
    await click(page, '[data-cc-action="review"]');
    await page.waitForTimeout(500);
    const fromCC = await page.evaluate(SHELL);
    checks.equal(fromCC.screen, "workspace",
      "following the Command Center into review keeps the workspace");
    checks.equal(fromCC.tab, "floor", "and lands on the Floor Plan tab");
    checks.equal(fromCC.planMode, "review", "in review mode");
  } else {
    checks.ok(true, "this plan produced nothing worth deciding, so there was no review link to follow");
  }

  // --- 8. the original plan is still the hero -----------------------------
  await click(page, '[data-plan-mode="review"]').catch(() => {});
  await page.waitForTimeout(400);
  const hero = await page.evaluate(() => {
    const img = document.querySelector("#analysisSceneInner img");
    if (!img) return null;
    return { src: img.getAttribute("src").slice(0, 30), w: img.clientWidth, h: img.clientHeight };
  });
  checks.ok(hero && hero.src.startsWith("data:image") && hero.w > 200 && hero.h > 100,
    "review mode still shows the uploaded plan itself, at size — never a redraw", hero);
}
