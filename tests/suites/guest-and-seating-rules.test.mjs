// The non-negotiable domain rules, driven through the real UI.
//
// Every check here corresponds to a rule in .claude/rules/product.md. They are
// grouped in one suite on purpose: these rules interact (a "+N" party is one
// record AND occupies N+1 seats AND keeps its seats when it goes No Show), and
// a regression usually breaks the interaction rather than a single rule.
import { click, openApp, createBlankEvent, addTables, addGuest, gotoTab, seatGuestOnFirstTable } from "../lib/app-actions.mjs";

export const meta = { name: "guest-and-seating-rules", tags: ["business", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Rules", hotel: "Merit Royal", date: "2026-09-10" });
  checks.require((await addTables(page)) === 4, "four tables exist to seat against");

  // --- table.capacity and table.chairs must move together -------------------
  await click(page, ".table-object >> nth=0");
  await page.waitForTimeout(200);
  await click(page, '.contextual-card [data-seat-capacity="12"]');
  await page.waitForTimeout(300);
  const sync = await page.evaluate(() => {
    const t = state.events[0].tables[0];
    return { capacity: t.capacity, chairs: t.chairs.length };
  });
  checks.ok(sync.capacity === 12 && sync.chairs === 12,
    "a seat preset changes capacity and chairs together — chairs never drift from capacity", sync);

  // --- "Name +3" is ONE record with pax 4 -----------------------------------
  await gotoTab(page, "guests");
  await addGuest(page, { name: "Kerem Sariciek", additionalGuests: 3 });
  const party = await page.evaluate(() => {
    const e = state.events[0];
    return { records: e.guests.length, pax: e.guests[0].pax, additional: e.guests[0].additionalGuests };
  });
  checks.ok(party.records === 1, "a +3 party is one guest record, not four", party);
  checks.ok(party.pax === 4, "pax is 1 + additionalGuests", party);

  // --- seating the party takes 4 seats, not 1 -------------------------------
  await seatGuestOnFirstTable(page, "Kerem");
  const seated = await page.evaluate(() => {
    const e = state.events[0], g = e.guests[0];
    return { assigned: !!g.assignment, seats: g.assignment ? g.assignment.seats.length : 0 };
  });
  checks.require(seated.assigned, "the guest was seated through the real seating flow", seated);
  checks.ok(seated.seats === 4, "the whole party occupies 4 seats from one record", seated);

  // --- planning status and arrival status are independent axes --------------
  await gotoTab(page, "live");
  const beforeNoShow = await page.evaluate(() => {
    const g = state.events[0].guests[0];
    return { planning: g.planningStatus, assignment: JSON.stringify(g.assignment) };
  });
  await click(page, 'button[data-arrival="No Show"]');
  await page.waitForTimeout(400);
  const afterNoShow = await page.evaluate(() => {
    const g = state.events[0].guests[0];
    return { arrival: g.arrivalStatus, planning: g.planningStatus, assignment: JSON.stringify(g.assignment) };
  });
  checks.ok(afterNoShow.arrival === "No Show", "No Show sets the arrival axis", afterNoShow);
  checks.ok(afterNoShow.planning === beforeNoShow.planning,
    "No Show did not touch planning status — the two axes are independent", afterNoShow);
  checks.ok(afterNoShow.assignment === beforeNoShow.assignment,
    "No Show preserved the planned seat assignment verbatim", afterNoShow);

  // A No Show releases LIVE capacity while the planned seat stays booked.
  // Those are two different numbers and must not have been merged.
  // occupiedSeatIndexes returns a Set of planned seat indexes for a table.
  const capacity = await page.evaluate(() => {
    const e = state.events[0], g = e.guests[0];
    const tableId = g.assignment.tableId;
    return { planned: occupiedSeatIndexes(e, tableId).size, tableId };
  });
  checks.ok(capacity.planned === 4,
    "the planned seats are still occupied after No Show (planned ≠ live occupancy)", capacity);

  // --- Ctrl+D duplicate on the canvas ---------------------------------------
  await gotoTab(page, "floor");
  await click(page, ".table-object >> nth=0");
  await page.waitForTimeout(200);
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(400);
  const duplicated = await page.evaluate(() => state.events[0].tables.length);
  checks.ok(duplicated === 5, "Ctrl+D duplicates the selected table", duplicated);
}
