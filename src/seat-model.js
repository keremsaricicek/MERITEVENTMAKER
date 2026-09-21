// THREE QUANTITIES THAT ARE NOT THE SAME NUMBER.
//
// A table in this product answers three different questions, and every
// defect this module exists to prevent came from answering one of them with
// another one's number.
//
//   LOGICAL SEATS — `table.capacity`. The assignment index space: seats
//   0..capacity-1. Guest assignment, seat numbering, pax arithmetic and the
//   exported seat rows index into this and nothing else. It exists whether
//   or not anybody ever drew a chair.
//
//   PHYSICAL CHAIRS — `table.chairs`. Objects with real coordinates, which
//   exist only where the plan genuinely drew a chair, Assisted Detection
//   found one, or a person placed one. Where none of those happened the
//   array is EMPTY. A capacity number never becomes a chair.
//
//   OPERATIONAL CAPACITY — `seatingCapacity(event)`. What the room can seat
//   tonight, summed from logical seats. This is the number every "will they
//   fit" judgement wants.
//
// Two collapses had actually shipped.
//
// The first was in storage: `table.chairs` was synthesised to `capacity` for
// every table, with the invented entries tagged `physical:false`. A
// 420-table symbolic plan therefore stored 4,200 chairs at coordinates
// nothing had ever observed, re-derived and re-persisted on every save. A
// flag that disowns a coordinate is not the same as not writing it.
//
// The second was in judgement: "can this table seat somebody" was asked as
// `hasPhysicalSeats !== false && capacity > 0`. On a symbolic plan — a real
// and ordinary kind of venue drawing, numbered circles with a printed pax
// figure — that answered NO for every table in the room. Smart Seating
// offered nothing, freezes covered nothing, service load saw an empty room,
// and the Plan Doctor opened the event with "the plan carries no chairs"
// BLOCKING, while the seating screen was seating guests at those same tables
// without complaint. Whether a drawing depicted a chair is a fact about the
// DRAWING. It is not what decides where a guest can be seated.
//
// This module holds no state, reads no shell global, and mutates nothing. It
// takes plain tables and events and returns numbers.
(function () {
  "use strict";

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // The assignment index space of one table.
  const logicalSeatCount = (table) => Math.max(0, Math.trunc(num(table && table.capacity)));

  // How many chairs this table's plan actually carries. Zero on a symbolic
  // table is the correct answer to this question, and says nothing at all
  // about how many people can sit there.
  const physicalChairCount = (table) =>
    (table && Array.isArray(table.chairs) ? table.chairs.length : 0);

  // A place somebody can be seated tonight. Deliberately NOT gated on
  // `hasPhysicalSeats` — see the note at the top of this file.
  const canSeat = (table) => !!table && logicalSeatCount(table) > 0;

  // Does this table's plan draw its chairs? A property of the drawing, used
  // for the "physical chairs" fact and for deciding whether syncing capacity
  // should produce chair objects. Never for deciding seatability.
  const drawsChairs = (table) => !!table && table.hasPhysicalSeats !== false;

  const tablesOf = (event) => (event && Array.isArray(event.tables) ? event.tables : []);

  // WHAT THE ROOM CAN SEAT TONIGHT.
  const seatingCapacity = (event) =>
    tablesOf(event).filter(canSeat).reduce((sum, t) => sum + logicalSeatCount(t), 0);

  // HOW MANY CHAIRS THE PLAN ACTUALLY DREW. Shown only where the label says
  // so; it is not a capacity.
  const physicalCapacity = (event) =>
    tablesOf(event).reduce((sum, t) => sum + physicalChairCount(t), 0);

  // Tables that can seat somebody.
  const seatableTables = (event) => tablesOf(event).filter(canSeat);

  globalThis.MeritSeatModel = {
    version: 1,
    logicalSeatCount,
    physicalChairCount,
    canSeat,
    drawsChairs,
    seatingCapacity,
    physicalCapacity,
    seatableTables,
  };
})();
