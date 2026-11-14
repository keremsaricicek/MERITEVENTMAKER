// LIVE OCCUPANCY — who is using a table's seats TONIGHT.
//
// Two answers to "who is sitting here", and the difference between them is the
// product's most important operational rule. The PLAN keeps a No Show's seats:
// the assignment, the workbook and the reports stay correct
// (`occupiedSeatIndexes`, app.js). TONIGHT those chairs are free
// (`liveUsedIndexes`, here). They must disagree for a No Show, and
// `tests/suites/occupancy-pair.test.mjs` fails if they ever stop.
//
// Moved out of app-v8.js as step 3a of benchmarks/MODULARIZATION-ORDER.md
// (the domain half of ownership area A03). Pure: it reads only its arguments
// and MeritSeatModel's published definitions of a logical seat, and the one
// thing it needs from the shell — how many people a guest record is — is
// injected, never reached for.
//
// ONE WRITE lives here too (owner decision 2026-11-08): placeLive, the only
// writer of `guest.livePlacement` — a WALK-IN sitting TONIGHT in seats a No
// Show left, after a person confirmed it. It is a live fact, not a plan: the
// walk-in gets no `guest.assignment` (MeritSeatAssignment is not called), the
// No Show keeps theirs, and occupiedSeatIndexes / the workbook never see it.
// liveUsedIndexes counts it, so the door and the next walk-in see the seats
// used again. A guest with a planned seat is never placed live.
(function () {
  "use strict";

  const SEATS = () => globalThis.MeritSeatModel;

  // The seat indexes in use at a table tonight: every assigned party's seats,
  // except a No Show's, and except the ids a caller is about to move.
  function liveUsedIndexes(event, tableId, exceptIds = []) {
    const except = new Set(exceptIds), used = new Set();
    event.guests.forEach((g) => {
      if (except.has(g.id) || g.arrivalStatus === "No Show") return;
      if (g.assignment?.tableId === tableId) (g.assignment.seats || []).forEach((index) => used.add(Number(index)));
      else if (!g.assignment && g.livePlacement?.tableId === tableId) (g.livePlacement.seats || []).forEach((index) => used.add(Number(index)));
    });
    return used;
  }

  // THE SAME TWO ANSWERS FOR EVERY TABLE AT ONCE, in one pass over the guests:
  // tableId -> Set of seat indexes. plannedIndex(event).get(id) is exactly
  // occupiedSeatIndexes(event, id) (app.js) and liveIndex(event).get(id) is
  // exactly liveUsedIndexes(event, id); a table nobody uses has no entry. The
  // canvas asked the per-table question twice per table, so a render at 3,000
  // records and 300 tables walked the guest list 600 times (measured
  // 2026-11-12, tests/suites/seating-scale.test.mjs). Read-only results: the
  // caller must not add to the sets.
  function plannedIndex(event) {
    const by = new Map();
    for (const g of event.guests || []) {
      const id = g.assignment?.tableId;
      if (!id) continue;
      let used = by.get(id);
      if (!used) by.set(id, used = new Set());
      for (const s of g.assignment.seats || []) used.add(Number(s));
    }
    return by;
  }
  function liveIndex(event) {
    const by = new Map(), at = (id) => { let used = by.get(id); if (!used) by.set(id, used = new Set()); return used; };
    for (const g of event.guests || []) {
      if (g.arrivalStatus === "No Show") continue;
      if (g.assignment?.tableId) { const used = at(g.assignment.tableId); (g.assignment.seats || []).forEach((index) => used.add(Number(index))); }
      else if (!g.assignment && g.livePlacement?.tableId) { const used = at(g.livePlacement.tableId); (g.livePlacement.seats || []).forEach((index) => used.add(Number(index))); }
    }
    return by;
  }

  // The door's figures. Free seats are counted on the LOGICAL seat space:
  // reading `chairs.length` made a symbolic table report zero free seats
  // while the same table was happily accepting assignments.
  function liveStats(event, { paxOf }) {
    let emptyTables = 0, emptyChairs = 0;
    for (const table of event.tables.filter(SEATS().canSeat)) {
      const used = liveUsedIndexes(event, table.id);
      if (used.size === 0) emptyTables++;
      emptyChairs += Math.max(0, SEATS().logicalSeatCount(table) - used.size);
    }
    const sum = (status) => event.guests.filter((g) => g.arrivalStatus === status).reduce((n, g) => n + paxOf(g), 0);
    return { total: event.guests.reduce((n, g) => n + paxOf(g), 0), checked: sum("Checked In"), notArrived: sum("Not Arrived"),
      noShow: sum("No Show"), emptyTables, emptyChairs };
  }

  // placeLive(event, guest, { tableId, seats }, { confirmed, now, paxOf })
  //   -> { ok, placement } | { refused }. The whole party at one table, every
  //   seat free tonight, at least one of them a No Show's planned seat (a
  //   plan-free table goes through the assignment writer instead).
  function placeLive(event, guest, place, opts) {
    const o = opts || {};
    const R = globalThis.MeritEventRules;   // read at call time: event-rules.js loads after this file
    const refused = !event ? "NO_EVENT" : R && R.mutationRefusal ? R.mutationRefusal(event) : (event.status === "Completed" ? "HISTORICAL" : null);
    if (refused) return { refused };
    if (o.confirmed !== true) return { refused: "CONFIRM_REQUIRED" };
    if (!guest || !(event.guests || []).includes(guest)) return { refused: "NO_GUEST" };
    if (guest.walkIn !== true) return { refused: "NOT_A_WALK_IN" };
    if (guest.assignment) return { refused: "HAS_PLANNED_SEAT" };
    if (guest.arrivalStatus !== "Checked In") return { refused: "NOT_CHECKED_IN" };
    const table = (event.tables || []).find((t) => t.id === (place && place.tableId));
    if (!table || !SEATS().canSeat(table)) return { refused: "NO_SEATS" };
    const seats = ((place && place.seats) || []).map(Number);
    const cap = SEATS().logicalSeatCount(table), pax = o.paxOf ? o.paxOf(guest) : Math.max(1, Number(guest.pax) || 1);
    const live = liveUsedIndexes(event, table.id, [guest.id]);
    if (seats.length !== pax || new Set(seats).size !== seats.length || seats.some((i) => !Number.isInteger(i) || i < 0 || i >= cap || live.has(i))) return { refused: "SEATS_NOT_FREE" };
    const noShowGuestIds = event.guests.filter((g) => g.arrivalStatus === "No Show" && g.assignment?.tableId === table.id
      && (g.assignment.seats || []).some((s) => seats.includes(Number(s)))).map((g) => g.id);
    if (!noShowGuestIds.length) return { refused: "NOT_A_NO_SHOW_SEAT" };
    guest.livePlacement = { tableId: table.id, seats, noShowGuestIds, at: o.now || null };
    return { ok: true, placement: guest.livePlacement };
  }

  globalThis.MeritOccupancy = { version: 1, liveUsedIndexes, plannedIndex, liveIndex, liveStats, placeLive };
})();
