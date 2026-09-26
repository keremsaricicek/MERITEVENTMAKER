// A DETECTOR THAT FAILS, A SECOND PRESS, A SCREEN THAT THROWS.
//
// `.claude/skills/merit-resilience-hardening/SKILL.md`, Plan Intelligence and
// Async groups: "detector throws mid-analysis", "re-analyze while a previous
// analysis is still running", "a render that throws mid-screen". Each held to
// DETECT / CONTAIN / INFORM / RECOVER / PRESERVE.
//
// MEASURED BEFORE THE FIXES:
//
//   A FAILED ANALYSIS DESTROYED THE PREVIOUS ONE. The new analysis object
//   replaces the old one part-way through the run — before OCR, label
//   reading, table numbers and the teach area — so a failure in any of those
//   left a half-built analysis in place of a complete one, under a toast
//   that said "Nothing was changed". The fault here is thrown from
//   `MeritTeachArea.inForce`, which runs after that replacement: the exact
//   window. The previous analysis now comes back.
//
//   A SECOND PRESS STARTED A SECOND PIPELINE, interleaving its writes to the
//   same event.analysis. It is now refused while one is running.
//
//   A SCREEN THAT THREW escaped render() uncaught and left the previous DOM on
//   screen, bound to state that had moved on. It now shows a translated
//   recovery screen with the two ways forward that never need the broken
//   screen. The boundary still logs an ERROR, so every other suite keeps
//   failing loudly on a render bug; this suite takes that one expected error
//   out of the runner's list itself, after asserting it is there.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, futureDate, gotoTab } from "../lib/app-actions.mjs";
import { throwFrom, liftFault } from "../lib/faults.mjs";

export const meta = { name: "resilience-detection-render", tags: ["resilience", "intelligence", "slow"], timeout: 300000, downloads: true };

const SETTLED = () => { try { const e = state.events[0]; return !!e.analysis && !ui.analysisBusy; } catch { return false; } };

export default async function run({ page, checks, baseUrl, repoRoot, errors }) {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Fault Plan", hotel: "Merit", date: futureDate() });
  const plan = fs.readFileSync(path.join(repoRoot, "benchmarks/adversarial/fixtures/a1-chair-under-table.png"));
  await page.evaluate((src) => { state.events[0].background = { src, name: "a1.png", opacity: 1, visible: true, locked: false, scale: 100 }; ui.tab = "floor"; render(); },
    "data:image/png;base64," + plan.toString("base64"));
  await page.waitForTimeout(300);

  // Count real pipeline runs at the provider itself.
  await page.evaluate(() => {
    const P = MERIT_PLAN_DETECTION.resolve();
    window.__detectCalls = 0;
    const orig = P.detect;
    P.detect = function (...a) { window.__detectCalls++; return orig.apply(this, a); };
  });

  // --- 1. a good analysis to lose -------------------------------------------
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(SETTLED, null, { timeout: 120000 });
  await page.waitForTimeout(300);
  const good = await page.evaluate(() => {
    const a = state.events[0].analysis;
    return { id: a.id, n: a.candidates.length, hasIntel: !!a.planIntelligence, calls: window.__detectCalls };
  });
  checks.ok(good.n > 0 && good.hasIntel, "a complete analysis exists before the fault", good);

  // --- 2. the detector fails AFTER the analysis was replaced ----------------
  await throwFrom(page, "MeritTeachArea.inForce", "INJECTED FAULT deep inside the run");
  pageErrors.length = 0;
  await page.evaluate(() => { document.querySelectorAll(".toast").forEach((n) => n.remove()); ui.tab = "floor"; ui.planMode = "review"; render(); });
  await page.click('[data-review-action="reanalyze"]');
  await page.waitForFunction(() => !ui.analysisBusy, null, { timeout: 120000 });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const a = state.events[0].analysis;
    return { id: a && a.id, n: a && a.candidates.length, hasIntel: !!(a && a.planIntelligence), busy: ui.analysisBusy,
      toast: [...document.querySelectorAll(".toast")].map((n) => n.textContent).join(" | "),
      body: document.body.textContent.includes("INJECTED") };
  });
  checks.equal(after.id, good.id, "PRESERVE: the previous, complete analysis is back — not the half-built one that replaced it", after);
  checks.ok(after.n === good.n && after.hasIntel, "with every candidate and its plan intelligence", after);
  checks.ok(/could not finish/i.test(after.toast) && /Nothing was changed/.test(after.toast), "INFORM: the operator is told, in words that are now true", after.toast);
  checks.ok(!after.body, "and the fault's own message appears nowhere on screen");
  checks.ok(!after.busy && pageErrors.length === 0, "CONTAIN: the app is idle again and nothing escaped as an uncaught error", pageErrors);
  await liftFault(page, "MeritTeachArea.inForce");
  await page.click('[data-review-action="reanalyze"]');
  await page.waitForFunction((id) => { const a = state.events[0].analysis; return a && a.id !== id && !ui.analysisBusy; }, good.id, { timeout: 120000 });
  checks.ok(true, "RECOVER: with the fault lifted, Re-Analyze runs to completion and produces a new analysis");

  // --- 3. a second press while one is running --------------------------------
  const before = await page.evaluate(() => window.__detectCalls);
  await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; render(); });
  await page.evaluate(() => {
    const b = document.querySelector('[data-review-action="reanalyze"]');
    b.click(); b.click(); b.click();
  });
  await page.waitForFunction(() => !ui.analysisBusy, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const calls = (await page.evaluate(() => window.__detectCalls)) - before;
  checks.equal(calls, 1, "three presses in a row run the pipeline ONCE — a second run used to interleave its writes with the first", calls);

  // --- 4. a screen that throws ----------------------------------------------
  await page.evaluate(() => { ui.planMode = "edit"; render(); });
  await gotoTab(page, "guests");
  const stateBefore = await page.evaluate(() => JSON.stringify(state.events[0].tables.length) + JSON.stringify(state.events[0].guests));
  await throwFrom(page, "MeritPlanDoctor.run", "INJECTED RENDER FAULT", "ui.screen === 'workspace'");
  pageErrors.length = 0;
  const errorsBefore = errors.length;
  await page.evaluate(() => { ui.tab = "command"; render(); });
  await page.waitForTimeout(200);
  const failure = await page.evaluate(() => ({
    shown: !!document.querySelector("[data-render-failure]"),
    role: document.querySelector("[data-render-failure]")?.getAttribute("role"),
    text: document.querySelector("[data-render-failure]")?.textContent.replace(/\s+/g, " ").trim(),
    focus: document.activeElement?.getAttribute("data-render-recover"),
  }));
  checks.ok(failure.shown && failure.role === "alert", "CONTAIN + INFORM: a screen that throws becomes a recovery screen, announced", failure);
  checks.ok(/Nothing was changed or lost/.test(failure.text) && !/INJECTED/.test(failure.text),
    "which says nothing was lost, and never shows the fault's own words", failure.text);
  checks.equal(failure.focus, "events", "and focus is already on the way back");
  checks.equal(pageErrors.slice(), [], "nothing escapes render() as an uncaught error any more");
  const logged = errors.slice(errorsBefore).filter((e) => /failed to render/.test(e));
  checks.ok(logged.length >= 1, "DETECT: the failure is still logged as an ERROR, so a real render bug stays loud in every other suite", errors.slice(errorsBefore, errorsBefore + 2));
  // Taken out of the runner's list only after being asserted: this suite
  // CAUSED it, and nothing else may be.
  for (let i = errors.length - 1; i >= errorsBefore; i--) if (/failed to render/.test(errors[i])) errors.splice(i, 1);
  await page.evaluate(() => { ui.lang = "tr"; render(); });
  const tr = await page.evaluate(() => document.querySelector("[data-render-failure]")?.textContent || "");
  checks.ok(/Bu ekran gösterilemedi/.test(tr), "and it is Turkish in the Turkish UI", tr.slice(0, 40));
  for (let i = errors.length - 1; i >= errorsBefore; i--) if (/failed to render/.test(errors[i])) errors.splice(i, 1);
  await page.evaluate(() => { ui.lang = "en"; });
  await page.click('[data-render-recover="events"]');
  await page.waitForTimeout(200);
  const recovered = await page.evaluate(() => ({ screen: ui.screen, list: !!document.querySelector('[data-action="create-event"]'),
    state: JSON.stringify(state.events[0].tables.length) + JSON.stringify(state.events[0].guests) }));
  checks.ok(recovered.screen === "events" && recovered.list, "RECOVER: the events list opens from the recovery screen", recovered);
  checks.equal(recovered.state, stateBefore, "PRESERVE: the event in memory is exactly what it was before the screen failed");
  await liftFault(page, "MeritPlanDoctor.run");
}
