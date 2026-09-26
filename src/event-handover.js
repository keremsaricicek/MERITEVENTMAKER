// EVENT HANDOVER — one shift tells the next what it needs to know.
//
// This module owns exactly one thing: a human note log. It is deliberately
// NOT a digest engine — the "state of the event" half of Handover (readiness,
// arrivals, freezes, unavailable tables) is composed by app-v8.js directly
// from facts that already have a single authoritative source elsewhere
// (plan-doctor.js, arrival-wave.js, seating-freeze.js, table-availability.js).
// Duplicating that arithmetic here would create a second place those numbers
// could disagree — so this module never reads guests, tables, or the plan.
//
// A note is never interpreted, parsed, or promoted into a system fact. It is
// free text an operator wrote for the next operator, kept verbatim, in the
// order it was written. There is no edit and no delete: a handover log that
// could be rewritten after the fact would not be trustworthy as a record of
// what one shift actually told the next. This is also what keeps it distinct
// from the future Audit Trail (Phase P) — that will be a structured log of
// system-recorded decisions; this is an unstructured note a person chose to
// leave, and the two must never be merged into one list.
(function () {
  "use strict";

  const NOTE_MAX = 500;
  const BY_MAX = 120;

  function normalizeNote(raw) {
    if (!raw || typeof raw !== "object") return null;
    const text = String(raw.text == null ? "" : raw.text).trim().slice(0, NOTE_MAX);
    if (!text) return null;
    return {
      id: raw.id || null,
      text,
      by: String(raw.by == null ? "" : raw.by).trim().slice(0, BY_MAX),
      at: raw.at || null,
    };
  }

  // The stored order IS the read order — newest first, exactly as written.
  // Never sorted, filtered by author, or deduplicated: a repeated note is a
  // repeated thing someone said, not noise to collapse.
  function resolve(notes) {
    return (Array.isArray(notes) ? notes : []).map(normalizeNote).filter(Boolean);
  }

  globalThis.MeritEventHandover = {
    version: 1,
    NOTE_MAX,
    BY_MAX,
    normalizeNote,
    resolve,
  };
})();
