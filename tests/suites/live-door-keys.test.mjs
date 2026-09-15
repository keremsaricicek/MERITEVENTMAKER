// The door keyboard flow: type a name, press Enter, the right person is
// checked in.
//
// This is the highest-consequence keystroke in the product — it runs at a door
// with a queue behind it. The dangerous failure is not "nothing happened", it
// is "the wrong guest was checked in", so the ambiguous-query case is asserted
// first and hardest.
import { click, openApp, createBlankEvent, addGuest, addTables, gotoTab, settle, typeQuery, futureDate, seatGuestOnFirstTable } from "../lib/app-actions.mjs";

export const meta = { name: "live-door-keys", tags: ["business", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Door", hotel: "Merit", date: futureDate() });

  await gotoTab(page, "guests");
  // Two guests sharing a first name, so a partial query is genuinely ambiguous.
  await addGuest(page, { name: "MEHMET OZTURK", additionalGuests: 3 });
  await addGuest(page, { name: "MEHMET KAYA" });
  await addGuest(page, { name: "ZEYNEP ARSLAN", additionalGuests: 1 });
  await gotoTab(page, "live");
  await settle(page);

  // --- 1. an ambiguous query must arm nobody --------------------------------
  await typeQuery(page, "#liveSearch", "MEHMET", { state: "liveQuery" });
  checks.ok((await page.locator(".arrival-row.is-armed").count()) === 0,
    "an ambiguous query arms nobody",
    { rows: await page.locator(".arrival-row").count() });

  await page.keyboard.press("Enter");
  await page.waitForTimeout(450);
  const afterAmbiguous = await page.evaluate(() => state.events[0].guests.map(g => [g.name, g.arrivalStatus]));
  checks.ok(afterAmbiguous.every(([, status]) => status === "Not Arrived"),
    "Enter on an ambiguous query checks nobody in", afterAmbiguous);
  const toasts = await page.locator("#toastWrap").allTextContents();
  const queryState = await page.evaluate(() => ({
    uiQuery: ui.liveQuery,
    domValue: document.getElementById("liveSearch")?.value,
    rows: [...document.querySelectorAll(".arrival-row .party-name")].map(n => n.textContent.trim()),
    guests: state.events[0].guests.map(g => ({
      name: g.name, vip: g.vip, invitedBy: g.invitedBy,
      planning: g.planningStatus, arrival: g.arrivalStatus,
    })),
  }));
  checks.ok(toasts.some(t => /\b2\b/.test(t)),
    "the operator is told how many still match, so they know what to type next",
    { toasts: toasts.slice(-1), queryState });

  // --- 2. narrowing to one arms exactly that row ----------------------------
  await typeQuery(page, "#liveSearch", "MEHMET OZ", { state: "liveQuery" });
  const armed = await page.locator(".arrival-row.is-armed .party-name").allTextContents();
  checks.require(armed.length === 1 && armed[0].trim() === "MEHMET OZTURK",
    "a single match arms exactly that row", armed);
  checks.ok((await page.locator(".enter-key").count()) === 1,
    "the armed row shows the Enter affordance, so the operator can see it will fire");

  // --- 3. Enter touches one axis and resets for the next guest --------------
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => state.events[0].guests.some(g => g.arrivalStatus === "Checked In") && ui.liveQuery === "",
    null, { timeout: 5000 });
  await settle(page);
  const after = await page.evaluate(() => state.events[0].guests.map(g => ({
    name: g.name, arrival: g.arrivalStatus, planning: g.planningStatus,
  })));
  checks.ok(after.find(g => g.name === "MEHMET OZTURK").arrival === "Checked In",
    "Enter checked in the armed guest", after);
  checks.ok(after.filter(g => g.arrival === "Checked In").length === 1,
    "nobody else's arrival status moved", after);
  checks.ok(after.every(g => g.planning === "Confirmed"),
    "an arrival keystroke never writes to planning status", after);
  checks.ok((await page.inputValue("#liveSearch")) === "", "the query cleared for the next name");
  checks.ok((await page.evaluate(() => document.activeElement && document.activeElement.id)) === "liveSearch",
    "focus stayed in the search field — the operator never has to touch the mouse");

  // --- 4. Enter cannot double-fire ------------------------------------------
  await typeQuery(page, "#liveSearch", "OZTURK", { state: "liveQuery" });
  checks.ok((await page.locator(".arrival-row.is-armed").count()) === 0, "an already-checked-in guest is not armed");
  await page.keyboard.press("Enter");
  await settle(page);
  checks.ok((await page.evaluate(() => state.events[0].guests.filter(g => g.arrivalStatus === "Checked In").length)) === 1,
    "Enter on a checked-in guest is a no-op");

  // --- 5. Escape clears -----------------------------------------------------
  // Waiting on the state the keystroke is supposed to produce, not on a fixed
  // sleep: Escape clears the query and re-renders the list, and a 400ms guess
  // occasionally read the screen mid-render and saw a short list.
  await page.keyboard.press("Escape");
  const cleared = await page.waitForFunction(
    () => ui.liveQuery === "" && document.querySelectorAll(".arrival-row").length === 3,
    null, { timeout: 5000 }).then(() => true).catch(() => false);
  checks.ok(cleared, "Escape clears the search and brings every row back", await page.evaluate(() => ({
    query: ui.liveQuery, rows: document.querySelectorAll(".arrival-row").length,
  })));
  checks.ok((await page.inputValue("#liveSearch")) === "", "the field itself is empty too");

  // --- 6. the door search is the SAME ENGINE as the Global Finder, not a
  // second one. Before this phase, Live tested the whole typed query as one
  // contiguous substring against a hand-built haystack that only had name,
  // vip, invitedBy, both statuses and the raw table number — so term order
  // mattered and zone was invisible. matchGuestRows() is now the one place
  // either surface tests a query against a guest.
  await gotoTab(page, "guests");
  await addGuest(page, { name: "AYSE DEMIR", vip: "VIP" });
  await gotoTab(page, "live");
  await settle(page);
  // Reversed term order: "vip demir" never appears as contiguous text in
  // "ayse demir vip ..." (name comes before vip), so the old single-substring
  // filter matched nobody here even though both words are true of this guest.
  // AND-narrowing over independent terms — the Global Finder's own rule —
  // must find her regardless of the order they were typed in.
  await typeQuery(page, "#liveSearch", "VIP DEMIR", { state: "liveQuery" });
  const reversedMatch = await page.evaluate(() =>
    [...document.querySelectorAll(".arrival-row .party-name")].map(n => n.textContent.trim()));
  checks.ok(reversedMatch.length === 1 && reversedMatch[0] === "AYSE DEMIR",
    "a reversed-term query (\"VIP DEMIR\") finds the guest, not zero — same rule as the Global Finder", reversedMatch);
  checks.ok((await page.locator(".arrival-row.is-armed").count()) === 1,
    "the single match still arms for Enter-to-check-in");

  // --- 7. the door search reaches a table's zone, exactly like the Global
  // Finder does — the old Live filter never looked at zone at all.
  await page.keyboard.press("Escape");
  await gotoTab(page, "floor");
  await addTables(page, { quantity: 1, prefix: "T" });
  await page.evaluate(() => { state.events[0].tables[0].zone = "TERRACE"; render(); });
  await seatGuestOnFirstTable(page, "AYSE DEMIR");
  await gotoTab(page, "live");
  await settle(page);
  await typeQuery(page, "#liveSearch", "TERRACE", { state: "liveQuery" });
  const zoneMatch = await page.evaluate(() =>
    [...document.querySelectorAll(".arrival-row .party-name")].map(n => n.textContent.trim()));
  checks.ok(zoneMatch.length === 1 && zoneMatch[0] === "AYSE DEMIR",
    "a table's zone is searchable at the door, the same as in the Global Finder", zoneMatch);
  await page.keyboard.press("Escape");

  // --- 8. a +N party and an unseated guest both still read correctly here,
  // after everything above ran on the same list.
  await settle(page);
  const oztur = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".arrival-row")]
      .find(r => r.querySelector(".party-name")?.textContent.trim() === "MEHMET OZTURK");
    return row ? {
      partySub: row.querySelector(".party-sub")?.textContent || "",
      seatTag: row.querySelector(".seat-tag")?.className || "",
    } : null;
  });
  checks.require(!!oztur, "the +3 party is still on the door list", oztur);
  checks.ok(/4/.test(oztur.partySub), "a +3 party reads as one party of 4, never four rows", oztur);
  checks.ok(oztur.seatTag.includes("none"),
    "an unseated guest shows as having no table rather than being hidden or erroring", oztur);
  checks.ok((await page.evaluate(() => state.events[0].guests.length)) === 4,
    "still exactly one record per party — nothing above split a +N party into separate guests");

  // --- 9. the whole path disappears when the event goes historical ----------
  await page.evaluate(() => { state.events[0].status = "Completed"; render(); });
  await page.waitForFunction(() => document.querySelectorAll('[data-tab="live"]').length === 0,
    null, { timeout: 5000 }).catch(() => {});
  checks.ok((await page.locator("#liveSearch").count()) === 0,
    "a completed event has no Live search field at all");
  checks.ok((await page.locator('[data-tab="live"]').count()) === 0,
    "a completed event has no Live Event tab");
  checks.ok((await page.evaluate(() => state.events[0].guests.filter(g => g.arrivalStatus === "Checked In").length)) === 1,
    "no arrival record changed as the event became historical");
}
