// THE RULES EVERY SCREEN ASKS BEFORE IT CHANGES AN EVENT, AND THE GEOMETRY OF
// A TABLE'S CHAIRS — characterized before they move out of app-v8.js
// (benchmarks/MODULARIZATION-ORDER.md step 3b, ownership area A02).
//
// Every screen calls these, so every screen would feel a slip in them — and
// until now nothing asserted two of them directly:
//
//   - the REFUSAL carries its reason. historical-immutability proves a
//     completed event's data does not move; nothing checked the operator is
//     told why. A move that kept the `false` and lost the message would pass
//     every other suite and leave an operator pressing a dead button.
//   - the DAY boundary. An event dated TODAY is tonight's event and must stay
//     editable; one dated yesterday is a record. `<` against `<=` is the whole
//     difference and no suite held it.
//
// And the chair geometry is pinned: the positions a new table's chairs get,
// per table type. A drawn chair is a claim about the room, so a move that
// shifted them would be a silent change to every plan made afterwards.
import { openApp, createBlankEvent, addTables, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "event-rules", tags: ["business", "fast"], timeout: 150000 };

// Chair positions (table-local %, rotation °) the product gives a new table of
// each type, captured from the build this suite was written against.
const PINNED = [
  { type: "round", capacity: 8, chairs: [[50, 4, 0, 1], [81.82, 17.47, 45, 2], [95, 50, 90, 3], [81.82, 82.53, 135, 4], [50, 96, 180, 5], [18.18, 82.53, 225, 6], [5, 50, 270, 7], [18.18, 17.47, 315, 8]] },
  { type: "square", capacity: 8, chairs: [[15, 7, 0, 1], [50, 7, 0, 2], [93, 15, 90, 3], [93, 50, 90, 4], [85, 93, 180, 5], [50, 93, 180, 6], [7, 85, 270, 7], [7, 50, 270, 8]] },
  { type: "rectangle", capacity: 8, chairs: [[12, 8, 0, 1], [37.33, 8, 0, 2], [62.67, 8, 0, 3], [88, 8, 0, 4], [88, 92, 180, 5], [62.67, 92, 180, 6], [37.33, 92, 180, 7], [12, 92, 180, 8]] },
  { type: "bistro", capacity: 8, chairs: [[50, 7, 0, 1], [80.41, 19.59, 45, 2], [93, 50, 90, 3], [80.41, 80.41, 135, 4], [50, 93, 180, 5], [19.59, 80.41, 225, 6], [7, 50, 270, 7], [19.59, 19.59, 315, 8]] },
];

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Rules", hotel: "Merit", date: futureDate() });
  for (const type of ["round", "square", "rectangle", "bistro"]) await addTables(page, { quantity: 1, type });
  const round2 = (n) => Math.round(n * 100) / 100;

  // --- 1. the geometry a new table's chairs get, per type -------------------
  const geometry = await page.evaluate(() => activeEvent().tables.map((t) => ({ type: t.type, capacity: t.capacity,
    chairs: t.chairs.map((c) => [Math.round(c.x * 100) / 100, Math.round(c.y * 100) / 100, Math.round(c.rotation * 10) / 10, c.seatNumber]),
    owned: t.chairs.every((c) => /^chair_/.test(c.id) && c.parentTableId === t.id && c.occupancy === null) })));
  checks.equal(geometry.map((g) => ({ type: g.type, capacity: g.capacity, chairs: g.chairs })), PINNED,
    "each table type's chairs take exactly the positions they always have");
  checks.ok(geometry.every((g) => g.owned), "every chair is its table's, with its own id and no occupancy yet", geometry.map((g) => g.owned));

  // --- 2. growing a drawn table keeps the chairs a person already placed ----
  const grown = await page.evaluate(() => {
    const e = activeEvent(), t = e.tables.find((x) => x.type === "round");
    t.chairs[0].x = 12.5; t.chairs[0].y = 7.25; t.chairs[0].rotation = 33;
    const before = t.chairs.map((c) => ({ id: c.id, x: c.x, y: c.y, rotation: c.rotation }));
    const ok = setTableCapacity(e, t, t.capacity + 2);
    return { ok, before, after: t.chairs.map((c) => ({ id: c.id, x: c.x, y: c.y, rotation: c.rotation })), capacity: t.capacity, n: before.length };
  });
  checks.ok(grown.ok && grown.capacity === grown.n + 2 && grown.after.length === grown.n + 2, "a drawn table grows to the new capacity with a chair per seat", grown.capacity);
  checks.equal(grown.after.slice(0, grown.n), grown.before, "and every chair it already had keeps its id and its exact position — a placed chair is never regenerated");
  checks.ok(grown.after.slice(grown.n).every((c) => /^chair_/.test(c.id) && Number.isFinite(c.x) && Number.isFinite(c.y)), "the two new chairs are real objects with positions", grown.after.slice(grown.n));

  // --- 3. a symbolic table carries no chair, whatever its capacity ----------
  const symbolic = await page.evaluate(() => {
    const e = activeEvent(), t = e.tables.find((x) => x.type === "square");
    t.hasPhysicalSeats = false;
    const ok = setTableCapacity(e, t, 9);
    return { ok, capacity: t.capacity, chairs: t.chairs.length };
  });
  checks.equal(symbolic, { ok: true, capacity: 9, chairs: 0 }, "a symbolic table takes capacity 9 and still has zero chair objects");

  // --- 4. a seated party, with an unseated guest listed before it -----------
  // Checked after the reload below: planned occupancy on a chair is rebuilt
  // when an event loads (and on undo/unassign), not on every assignment —
  // and nothing reads it. That field is recorded in CODE-INVENTORY.md; this
  // suite holds only what the rebuild guarantees.
  await page.evaluate(() => {
    const e = activeEvent(), t = e.tables.find((x) => x.type === "rectangle");
    const g = (id, name, pax) => ({ id, name, additionalGuests: pax - 1, pax, planningStatus: "Confirmed", vip: "Standard", arrivalStatus: "Not Arrived",
      checkedInAt: null, invitedBy: "", notes: "", assignment: null, createdAt: new Date().toISOString() });
    // The unseated guest comes FIRST: the rebuild once returned at the first
    // guest with no assignment and marked every later party's chairs empty.
    e.guests.push(g("gNone", "Nobody Seated", 1), g("gPair", "Pair Seated", 2));
    touchEvent(e);
    assignGuestToTable("gPair", t.id);
  });

  // --- 5. what a stored record cannot make a table be -----------------------
  await page.evaluate(() => { const e = activeEvent(); e.tables.find((x) => x.type === "bistro").capacity = 0; e.tables.find((x) => x.type === "round").capacity = 500; saveState(); });
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => { try { return state.events.length === 1 && state.events[0].tables.length === 4; } catch { return false; } }, null, { timeout: 15000 });
  const clamped = await page.evaluate(() => { const e = state.events[0]; const by = (ty) => e.tables.find((x) => x.type === ty);
    return { bistro: [by("bistro").capacity, by("bistro").chairs.length], round: [by("round").capacity, by("round").chairs.length],
      occupancy: by("rectangle").chairs.slice(0, 3).map((c) => c.occupancy), placed: [by("round").chairs[0].x, by("round").chairs[0].y] }; });
  await page.evaluate(() => { ui.lang = "en"; render(); });
  checks.equal(clamped.bistro, [1, 1], "a stored capacity of 0 loads as one seat with one chair — a table is never zero seats wide");
  checks.equal(clamped.round, [99, 99], "a stored capacity of 500 loads as 99, the most a person can type");
  checks.equal(clamped.occupancy, [{ guestId: "gPair", partyIndex: 0, planned: true }, { guestId: "gPair", partyIndex: 1, planned: true }, null],
    "on load a seated party's chairs carry it, one chair per person — even with an unseated guest listed first");
  checks.equal(clamped.placed, [12.5, 7.25], "and a placed chair's position survives the reload");

  // --- 6. the refusal: who is refused, and that they are told why -----------
  const toastsAfter = async (fn) => {
    await page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove()));
    const r = await page.evaluate(fn);
    await page.waitForTimeout(150);
    return { ...r, toasts: await page.evaluate(() => [...document.querySelectorAll(".toast")].map((x) => x.textContent.replace(/\s+/g, " ").trim())) };
  };
  const day = (offset) => page.evaluate((o) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toLocaleDateString("en-CA"); }, offset);
  const today = await day(0), yesterday = await day(-1);
  const attempt = (date, status) => toastsAfter(new Function(`const e=state.events[0], t=e.tables.find(x=>x.type==="bistro");
    e.date=${JSON.stringify(date)}; e.status=${JSON.stringify(status)}; const before=t.capacity;
    const ok=setTableCapacity(e,t,before+1); return { ok, grew: t.capacity===before+1 };`));

  const tonight = await attempt(today, "Planning");
  checks.ok(tonight.ok && tonight.grew && tonight.toasts.every((x) => !/read-only/.test(x)), "an event dated TODAY is tonight's event: it can still be changed", tonight);
  const noDate = await attempt("", "Planning");
  checks.ok(noDate.ok && noDate.grew, "an event with no date yet is not a record of anything: it can be changed", noDate);
  const pastDate = await attempt(yesterday, "Planning");
  checks.ok(!pastDate.ok && !pastDate.grew, "an event dated yesterday is a record: the change is refused and nothing moves", pastDate);
  checks.ok(pastDate.toasts.some((x) => x === "Historical events are read-only. You cannot change chair capacity."),
    "and the operator is told why, naming what they tried to do", pastDate.toasts);
  const completed = await attempt(futureDate(), "Completed");
  checks.ok(!completed.ok && !completed.grew && completed.toasts.some((x) => /^Historical events are read-only/.test(x)),
    "a Completed event is a record whatever its date, and says so", completed);
  const noEvent = await toastsAfter(() => ({ ok: setTableCapacity(null, null, 3) }));
  checks.ok(noEvent.ok === false && noEvent.toasts.length === 0, "with no event there is nothing to refuse and nothing to announce", noEvent);

  await page.evaluate(() => { ui.lang = "tr"; render(); });
  await settle(page);
  const turkish = await attempt(yesterday, "Planning");
  checks.ok(!turkish.ok && turkish.toasts.some((x) => x === "Geçmiş etkinlikler salt okunurdur; bu işlem yapılamaz."),
    "in Turkish the refusal is Turkish, with no English action phrase spliced into it", turkish.toasts);

  // --- 7. the phase of the night ---------------------------------------------
  // ready → live → closed decides which room the load layer shows: the PLAN
  // keeps a No Show's chairs, the LIVE room frees them, and a finished night
  // is the plan of record. Read through what an operator sees: the Command
  // Center's phase and the band a table is drawn in.
  const phaseOf = async ({ arrival, date, status }) => page.evaluate(({ arrival, date, status }) => {
    const e = state.events[0];
    e.date = date; e.status = status;
    e.tables = e.tables.slice(0, 1); const t = e.tables[0];
    t.hasPhysicalSeats = false; t.chairs = []; t.capacity = 4; t.availability = "AVAILABLE";
    e.guests = [{ id: "gq", name: "Party Of Four", additionalGuests: 3, pax: 4, planningStatus: "Confirmed", vip: "Standard", arrivalStatus: arrival,
      checkedInAt: arrival === "Checked In" ? new Date().toISOString() : null, invitedBy: "", notes: "", assignment: { tableId: t.id, seats: [0, 1, 2, 3], locked: false },
      createdAt: new Date().toISOString() }];
    touchEvent(e);
    ui.screen = "workspace"; ui.activeEventId = e.id;
    ui.lang = "en"; ui.loadLayer = true; ui.tab = "command"; render();
    const phase = document.querySelector(".cc-phase")?.className || null;
    ui.tab = "seating"; render();
    const band = ((document.querySelector(".table-object")?.className.match(/load-(\w+)/) || [])[1] || "").toLowerCase() || null;
    ui.loadLayer = false;
    return { phase, band };
  }, { arrival, date, status });
  const before = await phaseOf({ arrival: "Not Arrived", date: futureDate(), status: "Planning" });
  checks.ok(/phase-ready/.test(before.phase || "") && before.band === "full", "before anyone arrives the night is ready, and the room shows the plan: the party's table is full", before);
  const noShow = await phaseOf({ arrival: "No Show", date: futureDate(), status: "Planning" });
  checks.ok(/phase-live/.test(noShow.phase || "") && noShow.band === "empty",
    "a No Show is an arrival-axis fact, so the night is live — and the live room frees that table", noShow);
  const finished = await phaseOf({ arrival: "No Show", date: futureDate(), status: "Completed" });
  checks.equal(finished.band, "full", "a finished night is the plan of record: the No Show's table still reads as taken, not as freed", finished);
}
