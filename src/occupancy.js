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
    });
    return used;
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

  globalThis.MeritOccupancy = { version: 1, liveUsedIndexes, liveStats };
})();
