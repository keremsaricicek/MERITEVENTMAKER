// AUDIT TRAIL — the foundation for "what actually happened to this event."
//
// This is deliberately NOT Post-Event Replay (a later phase): it names and
// orders the decisions that were made, it does not play the room back.
//
// The raw log it reads (`state.audit`, written by `audit()` in app-v8.js) is
// not itself a decision record — `touchEvent()` writes an EVENT_UPDATED entry
// on every single mutation, as a side effect of saving, so most of that log
// is noise a human never asked to see. This module is an ALLOWLIST, not an
// exclude-list: a future audit code this module has not been told about
// stays invisible rather than leaking into the trail unreviewed — showing
// nothing is honest, showing noise is not.
//
// It resolves nothing else. What each code MEANS in a person's language is
// decided in app-v8.js, next to t() and the guest/table lookups a sentence
// needs — this module only knows which raw entries belong in the trail at
// all, and in what order (unchanged: `audit()` already writes newest-first,
// so this never re-sorts).
(function () {
  "use strict";

  const DECISION_CODES = new Set([
    "EVENT_CREATED",
    "GUEST_DELETED",
    "ARRIVAL_STATUS_CHANGED",
    "TABLE_AVAILABILITY_CHANGED",
    "FREEZE_CREATED",
    "FREEZE_LIFTED",
    "FREEZE_OVERRIDDEN",
    "LAYOUT_CHANGE_CONFIRMED",
    "HANDOVER_NOTE_ADDED",
    "TEACH_AREA_NUMBER_CONFIRMED",
    "TEACH_AREA_LESSON_KEPT",
    "TEACH_AREA_LESSON_FORGOTTEN",
    "ASSISTED_DETECTION_COMPLETED",
  ]);

  function resolve(auditEntries, eventId) {
    if (!eventId) return [];
    return (Array.isArray(auditEntries) ? auditEntries : [])
      .filter((a) => a && a.eventId === eventId && DECISION_CODES.has(a.action));
  }

  globalThis.MeritAuditTrail = { version: 1, DECISION_CODES, resolve };
})();
