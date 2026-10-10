// Section 12: interactive first-run onboarding.
//
// A handful of short, dismissible, feature-anchored callouts -- never a
// sequential "step N of M" tour, and never a second, driftable explanation
// of a domain rule the User Guide already owns. This suite protects the
// three properties that make that true in code, not just in copy:
//
//   LOCAL, NEVER PART OF AN EVENT. state.onboarding lives on `state` itself,
//   exactly like state.audit -- never inside `event`, so it is never subject
//   to canMutate/isHistorical, never exported in a portable package, and
//   never resets just because the operator switched events.
//
//   DISMISS IS PERMANENT UNTIL A PERSON RESETS IT. Once dismissed, a callout
//   stays gone across a reload. It is not a one-shot the operator can lose
//   forever, though: "Show tips again" in the Help/User Guide clears every
//   callout back to showing.
//
//   NEVER IN A HISTORICAL EVENT'S READ-ONLY VIEW. A completed event is a
//   record of what happened, not a place to be taught how to use the app.
import { openApp, createBlankEvent, addTables, gotoTab, click, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "onboarding", tags: ["business", "fast"], timeout: 120000 };

const CALLOUT = `(function(){
  const el = document.querySelector(".onboarding-callout");
  return el ? { present: true, text: el.textContent.trim() } : { present: false };
})()`;

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Onboarding", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 2 });

  // --- 1. the workspace header's callout (Global Finder) -------------------
  await gotoTab(page, "guests");
  const globalFinder = await page.evaluate(CALLOUT);
  checks.require(globalFinder.present, "the Global Finder callout shows the first time a workspace is opened", globalFinder);
  checks.ok(!/^[a-z][a-zA-Z0-9]*\.[a-zA-Z]/.test(globalFinder.text) && globalFinder.text.length > 15,
    "in real words, not a raw i18n key", globalFinder);

  // --- 2. dismissing it removes it, and the dismissal is real state --------
  //
  // The reload check further below proves the DATA outlives a reload, but a
  // reload also fires the app's own unconditional beforeunload->saveState(),
  // which would mask a dismiss action that forgot to persist itself and
  // relied entirely on that unrelated safety net. Spying on saveState right
  // here, around the one click, proves THIS action persists on its own.
  const saveSpy = await page.evaluate(() => {
    window.__saveStateCallsBefore = 0;
    const orig = saveState;
    saveState = function (...args) { window.__saveStateCallsBefore++; return orig.apply(this, args); };
    return true;
  });
  checks.require(saveSpy, "saveState could be spied on for this check");
  await click(page, "[data-onboarding-dismiss='globalFinder']");
  await page.waitForTimeout(250);
  const saveCalls = await page.evaluate(() => window.__saveStateCallsBefore);
  checks.ok(saveCalls > 0, "dismissing a callout calls saveState() itself, not relying on an unrelated later save", saveCalls);
  const afterDismiss = await page.evaluate(CALLOUT);
  checks.ok(!afterDismiss.present, "dismissing the callout removes it from the header", afterDismiss);
  const seenFlag = await page.evaluate(() => state.onboarding?.seen?.globalFinder === true);
  checks.ok(seenFlag, "the dismissal is recorded on state.onboarding.seen, not just hidden in the DOM", seenFlag);

  // --- 3. state.onboarding is on `state`, not on the event ------------------
  const onEvent = await page.evaluate(() => "onboarding" in state.events[0]);
  checks.ok(!onEvent, "onboarding state never lives on the event object itself", onEvent);

  // --- 4. dismissal survives a reload ---------------------------------------
  await page.waitForTimeout(400); // let the autosave land
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => Array.isArray(state.events) && typeof render === "function", null, { timeout: 20000 });
  await page.evaluate(() => openEvent(state.events[0].id));
  await page.waitForTimeout(300);
  await gotoTab(page, "guests");
  const afterReload = await page.evaluate(CALLOUT);
  checks.ok(!afterReload.present, "the dismissal is not forgotten on reload", afterReload);

  // --- 5. Command Center's callout (Risk Radar) -----------------------------
  await gotoTab(page, "command");
  await page.waitForTimeout(300);
  const ccCallout = await page.evaluate(() => {
    const radar = document.querySelector(".cc-radar");
    const el = radar?.querySelector(".onboarding-callout");
    return el ? { present: true, insideRadar: true } : { present: false };
  });
  checks.require(ccCallout.present && ccCallout.insideRadar,
    "the Command Center's Risk Radar carries its own callout, undismissed until now", ccCallout);
  await click(page, "[data-onboarding-dismiss='commandCenter']");
  await page.waitForTimeout(250);
  checks.ok(!(await page.evaluate(() => !!document.querySelector(".cc-radar .onboarding-callout"))),
    "dismissing it removes only the Command Center's own callout");
  checks.ok(await page.evaluate(() => state.onboarding?.seen?.commandCenter === true),
    "recorded under its own key, independent of globalFinder's");

  // --- 6. Seating's two callouts: Freeze Zones (empty state) and Smart
  //        Seating (once a guest is selected) -------------------------------
  await gotoTab(page, "seating");
  await page.waitForTimeout(300);
  const freezeCallout = await page.evaluate(() => {
    const panel = document.querySelector(".freeze-panel");
    return panel && panel.querySelector(".onboarding-callout") ? true : false;
  });
  checks.ok(freezeCallout, "the empty Freeze Zones panel carries its own callout", freezeCallout);
  await click(page, "[data-onboarding-dismiss='freezeZones']");
  await page.waitForTimeout(250);

  const guestId = await page.evaluate(() => {
    const e = state.events[0];
    const g = { id: "g_onboarding", name: "Onboarding Guest", additionalGuests: 0, pax: 1, vip: "Standard",
      invitedBy: "", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, createdAt: new Date().toISOString() };
    e.guests = [...(e.guests || []), g];
    ui.selectedGuestId = g.id; ui.seatPreview = null;
    touchEvent(e); render();
    return g.id;
  });
  await page.waitForTimeout(300);
  const smartSeatingCallout = await page.evaluate(() => {
    const panel = document.querySelector(".smart-seating");
    return panel && panel.querySelector(".onboarding-callout") ? true : false;
  });
  checks.require(smartSeatingCallout, "selecting a guest for the first time shows Smart Seating's own callout", { guestId });
  await click(page, "[data-onboarding-dismiss='smartSeating']");
  await page.waitForTimeout(250);
  checks.ok(!(await page.evaluate(() => !!document.querySelector(".smart-seating .onboarding-callout"))),
    "dismissed, and stays dismissed for this guest too");

  // --- 7. Table Availability's callout, only on the AVAILABLE state --------
  const t0 = await page.evaluate(() => state.events[0].tables[0].id);
  await page.evaluate((tid) => { ui.selectedTableId = tid; render(); }, t0);
  await page.waitForTimeout(250);
  const availCalloutBefore = await page.evaluate(() => !!document.querySelector(".table-card .onboarding-callout"));
  checks.ok(availCalloutBefore, "an available table's card shows the Table Availability callout", availCalloutBefore);
  await click(page, "[data-onboarding-dismiss='tableAvailability']");
  await page.waitForTimeout(250);
  checks.ok(!(await page.evaluate(() => !!document.querySelector(".table-card .onboarding-callout"))),
    "and it is gone once dismissed");

  // A table already marked unavailable never shows this callout at all --
  // the tip is about the mark-unavailable control, which is not even on
  // screen once a table already failed.
  await page.evaluate((tid) => {
    const t = state.events[0].tables.find(x => x.id === tid);
    t.availability = "UNAVAILABLE"; t.unavailableReason = "DAMAGED";
    state.onboarding.seen.tableAvailability = false; // force-reset just this one key
    touchEvent(state.events[0]); render();
  }, t0);
  await page.waitForTimeout(250);
  checks.ok(!(await page.evaluate(() => !!document.querySelector(".table-card .onboarding-callout"))),
    "an already-unavailable table shows no Table Availability callout, even with the key un-dismissed",
    await page.evaluate(() => document.querySelector(".table-card")?.outerHTML.slice(0, 200)));
  await page.evaluate((tid) => {
    const t = state.events[0].tables.find(x => x.id === tid);
    t.availability = "AVAILABLE"; t.unavailableReason = null; t.unavailableSince = null;
    touchEvent(state.events[0]); render();
  }, t0);

  // --- 8. "Show tips again" in the Help/User Guide resets every key --------
  await click(page, '[data-action="help"]');
  await page.waitForSelector("#guideRoot [data-guide-reset-onboarding]", { timeout: 8000 });
  await click(page, "[data-guide-reset-onboarding]");
  await page.waitForTimeout(300);
  const resetState = await page.evaluate(() => state.onboarding);
  checks.equal(JSON.stringify(resetState), JSON.stringify({ seen: {} }),
    "resetting clears every dismissed key back to unseen", resetState);
  await click(page, "[data-guide-close]");
  await page.waitForTimeout(300);
  await gotoTab(page, "guests");
  const globalFinderAgain = await page.evaluate(CALLOUT);
  checks.ok(globalFinderAgain.present, "after the reset, the Global Finder callout shows again", globalFinderAgain);

  // --- 9. never inside a historical event's read-only view ------------------
  await page.evaluate(() => { state.events[0].status = "Completed"; openEvent(state.events[0].id); });
  await page.waitForTimeout(400);
  const historicalCallouts = await page.evaluate(() => document.querySelectorAll(".onboarding-callout").length);
  checks.equal(historicalCallouts, 0, "a historical event shows no onboarding callouts anywhere on screen", historicalCallouts);
  await page.evaluate(() => { state.events[0].status = "Confirmed"; openEvent(state.events[0].id); });

  // --- 10. real words in both languages, not a copy-pasted default ---------
  const bilingual = await page.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) { ui.lang = lang; out[lang] = t("onboarding.globalFinder"); }
    ui.lang = "en";
    return out;
  });
  checks.ok(bilingual.en && bilingual.tr && bilingual.en !== bilingual.tr,
    "the callout copy is real, different text in English and Turkish", bilingual);
}
