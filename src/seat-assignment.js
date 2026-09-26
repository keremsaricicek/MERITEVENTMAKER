// WHERE A GUEST SITS — written in exactly one place.
//
// `guest.assignment` is the most consequential field in the product: it
// decides where a person sits, what the workbook prints, who the door
// expects, and what every capacity figure is counted against. It used to be
// written by raw assignment from ELEVEN places across three files — assign,
// unassign, two different undo paths, a rollback, a table deletion, a guest
// restoration, a spreadsheet import, a normalization default, and a dead demo
// seeder.
//
// None of them was individually wrong. The cost was structural, and the
// ownership map names it: with the field written from everywhere, the Guests,
// Seating and canvas extractions cannot move, because no boundary can promise
// anything about a field eleven call sites can change. It is the same problem
// `setArrival()` already solved for the arrival axis.
//
// This module is that one writer. It is pure in the sense that matters here:
// it reads no `state`, no `ui`, calls no `render()` or `touchEvent()`. A
// guest and an assignment go in; the guest comes back with a normalized
// assignment on it. WHO may seat somebody, WHETHER the event can be mutated,
// whether a freeze must be crossed and what the audit should say all remain
// the caller's business — this decides only what the field is allowed to
// contain.
//
// TWO THINGS IT DELIBERATELY DOES NOT DO.
//
//   It does not sort seats. The order maps a party to its companions —
//   refreshChairOccupancy() walks `seats` by index and pairs each with a
//   partyIndex — so tidying the array would silently reseat somebody's
//   companion into a different chair.
//
//   It does not decide capacity, freezes or locks. A locked assignment
//   outranks a suggestion, and a frozen table needs an override; both are
//   decisions with their own layers, and folding them in here would make
//   "the one writer" quietly the one decision-maker too.
(function () {
  "use strict";

  const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  // A seat index is a position in the table's logical seat space. Anything
  // that is not a finite number is dropped rather than carried: a string "3"
  // matches no index lookup, so keeping it would put a guest in a seat the
  // rest of the product cannot see.
  function normalizeSeats(seats) {
    if (!Array.isArray(seats)) return [];
    const out = [];
    for (const raw of seats) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) out.push(Math.trunc(n));
    }
    return out;
  }

  // null, or a complete assignment. An assignment naming no table is not an
  // assignment: it would strand the guest at a table that does not exist,
  // which is exactly the Plan Doctor's guestAtMissingTable blocker.
  function normalize(assignment) {
    if (!isPlainObject(assignment)) return null;
    const tableId = assignment.tableId;
    if (typeof tableId !== "string" || !tableId) return null;
    return {
      tableId,
      seats: normalizeSeats(assignment.seats),
      locked: assignment.locked === true,
    };
  }

  // THE ONE WRITER. Every path that seats, moves, unseats, undoes, rolls
  // back, imports or restores goes through here.
  function write(guest, assignment) {
    if (!isPlainObject(guest)) return guest;
    guest.assignment = normalize(assignment);
    return guest;
  }

  // Convenience for the commonest call, and a name that reads at the call
  // site: `clear(guest)` says what a bare `write(guest, null)` only implies.
  function clear(guest) {
    return write(guest, null);
  }

  function isSeated(guest) {
    return !!(isPlainObject(guest) && normalize(guest.assignment));
  }

  globalThis.MeritSeatAssignment = {
    version: 1, normalize, normalizeSeats, write, clear, isSeated,
  };
})();
