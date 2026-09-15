// IS THIS TABLE USABLE TONIGHT, AND WHO WOULD IT STRAND IF NOT?
//
// A table can fail: water damage, a broken base, an AV crew that needs the
// space, a fire-safety call. That is a fact about the TABLE, and this module
// owns exactly one question about it — AVAILABLE or UNAVAILABLE — plus the
// one real consequence of answering UNAVAILABLE: which already-seated guests
// it would strand.
//
// DISTINCT FROM A FREEZE (src/seating-freeze.js). A freeze says a PLACE is
// off-limits to the seating PROCESS until a person allows it — the table is
// fine, the timing or the permission is not, and a supervisor can override
// one operation without lifting it. UNAVAILABLE says the TABLE ITSELF cannot
// be used tonight, full stop — there is no override, the same way there is
// none for a table with no physical seats at all. A table can be both:
// unavailable AND inside a frozen zone, and each layer answers only its own
// question; neither reads the other's state.
//
// MARKING UNAVAILABLE MOVES NOBODY. A person already seated at a table that
// just failed keeps that assignment — it is still theirs on paper — until a
// human uses the existing seating flow (Smart Seating's recommendations, or
// a manual reassignment) to relocate them. This module has no path to an
// assignment, the same discipline as seating-advisor.js and
// seating-freeze.js: it reads the room and reports, and writes nothing.
(function () {
  "use strict";

  const STATE = { AVAILABLE: "AVAILABLE", UNAVAILABLE: "UNAVAILABLE" };

  // A closed set, for the same reason a freeze's reason is closed: "why" has
  // to survive a handover to somebody who was not in the room when the table
  // failed. The note is kept as well, not instead — same shape as REASON.OTHER
  // plus a note in seating-freeze.js.
  const REASON = {
    DAMAGED: "DAMAGED",
    RELOCATED: "RELOCATED",
    AV_HOLD: "AV_HOLD",
    SAFETY: "SAFETY",
    OTHER: "OTHER",
  };

  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  const paxOf = (g) => Math.max(1, Number(g && g.pax) || 1);
  const seatable = (t) => t && t.hasPhysicalSeats !== false && num(t.capacity) > 0;

  const isUnavailable = (t) => !!t && t.availability === STATE.UNAVAILABLE;

  // The resolved list the seating advisor and the Plan Doctor consume — plain
  // data, never the table objects themselves. Same discipline as
  // seating-freeze.js's resolve(): a caller learns the OUTCOME, and this
  // stays the one place "unavailable" is decided.
  function resolve(tables) {
    return (tables || []).filter(isUnavailable).map((t) => ({
      tableId: t.id, number: String(t.number),
      reason: REASON[t.unavailableReason] || REASON.OTHER,
      note: String(t.unavailableNote || "").slice(0, 400),
      since: t.unavailableSince || null,
    }));
  }

  const unavailableTableIds = (tables) => new Set(resolve(tables).map((r) => r.tableId));

  // WHO WOULD THIS STRAND. Every currently-seated guest whose table is marked
  // unavailable — the one operational consequence that matters. Reported by
  // record and by pax, the same discipline as every other headcount in this
  // product: an operator at a door thinks in people, a planner in records.
  function strandedGuests(tables, guests) {
    const bad = unavailableTableIds(tables);
    const hit = (guests || []).filter((g) => g && g.assignment && bad.has(g.assignment.tableId));
    return {
      records: hit.length,
      pax: hit.reduce((n, g) => n + paxOf(g), 0),
      guestIds: hit.map((g) => g.id),
    };
  }

  // Chairs removed from tonight's usable total. Distinct from a freeze's held
  // capacity: a frozen chair still exists and could open later the same
  // night; an unavailable chair does not exist for this event at all.
  function lostCapacity(tables) {
    const bad = unavailableTableIds(tables);
    const lost = (tables || []).filter((t) => seatable(t) && bad.has(t.id));
    return { tables: lost.length, chairs: lost.reduce((n, t) => n + num(t.capacity), 0) };
  }

  globalThis.MeritTableAvailability = {
    version: 1, STATE, REASON,
    isUnavailable, resolve, unavailableTableIds, strandedGuests, lostCapacity,
  };
})();
