// AUDIT TRAIL — the foundation for "what actually happened to this event."
//
// This is deliberately NOT Post-Event Replay (a later phase): it names and
// orders the decisions that were made, it does not play the room back.
//
// The raw log it reads (`state.audit`, written by `audit()` in app-v8.js) is
// not itself a decision record. `touchEvent()` no longer writes a generic
// EVENT_UPDATED entry on every mutation (Section 16 removed that write: it
// never carried anything `event.lastModified` didn't already, and it was
// competing with real decisions for the same shared, capped array) — but
// this module stays an ALLOWLIST, not an exclude-list, on principle: a
// future audit code this module has not been told about stays invisible
// rather than leaking into the trail unreviewed — showing nothing is
// honest, showing noise is not.
//
// It resolves nothing else. What each code MEANS in a person's language is
// decided in app-v8.js, next to t() and the guest/table lookups a sentence
// needs — this module only knows which raw entries belong in the trail at
// all, and in what order (unchanged: `audit()` already writes newest-first,
// so this never re-sorts).
//
// WHAT THIS LOG IS ALLOWED TO FORGET — and the difference between storing and
// showing.
//
// Every write used to end with `state.audit.slice(0, 1000)`. `state.audit` is
// ONE root-level log shared by every event in the install, so that single
// line did two kinds of damage. A four-thousand-guest event audits one entry
// per arrival, so a busy door erased that same event's EVENT_CREATED, its
// freezes and every teach decision made while the room was being set up. And
// because the log is shared, a second event's check-ins evicted the FIRST
// event's decisions: a trail that was complete on Friday was missing its
// opening entries by Saturday.
//
// The product could not even say what it had lost. The banner read "the
// oldest entries across ALL events MAY have been superseded" — a warning
// shaped exactly like the defect, because nothing had been counted.
//
// Three rules replace it:
//
//   RETENTION IS NOT A DISPLAY LIMIT. RETENTION_LIMIT is what the log keeps.
//   DISPLAY_LIMIT is how many rows one screen paints. Painting 1,500 rows is
//   a rendering problem; solving it by deleting 500 of them is how this
//   started.
//
//   A CEILING MAY EXIST, BUT NOT INSIDE THE WORKING RANGE. Storage is
//   IndexedDB, whose quota is effectively disk-sized, so 1,000 was never a
//   storage constraint — it was an arbitrary number that happened to sit
//   below real operational volume. Same lesson the detector's MAX_TABLES
//   taught at 240.
//
//   NOTHING GOES SILENTLY. append() reports exactly how many entries it
//   dropped and how far back the log used to reach, and recordEviction()
//   accumulates that into a record the shell persists. kept + evicted is
//   always what was written.
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


  // ---- RETENTION ------------------------------------------------------------

  // What the log KEEPS. A hundred thousand entries is far above any season a
  // venue produces: the largest single event this product is specified for
  // (four thousand guests) audits a few thousand decisions, and storage is
  // IndexedDB rather than localStorage's 5-10MB. The ceiling exists so that a
  // runaway writer cannot grow the record without bound, not to bound normal
  // work — and reaching it is reported, never assumed harmless.
  const RETENTION_LIMIT = 100000;

  // What one SCREEN paints. Unrelated to the above, and deliberately a
  // separate constant so the two can never be confused for one decision again.
  const DISPLAY_LIMIT = 200;

  const asLog = (log) => (Array.isArray(log) ? log : []);

  // Add one entry. The log is newest-first (unshift order), so anything
  // dropped is taken from the tail — the oldest — and counted.
  function append(log, entry, limit = RETENTION_LIMIT) {
    const next = [entry, ...asLog(log)];
    if (next.length <= limit) return { log: next, evicted: 0, oldestDroppedAt: null };
    const dropped = next.slice(limit);
    return {
      log: next.slice(0, limit),
      evicted: dropped.length,
      // The NEWEST of what was dropped: the log now begins after this moment,
      // which is the fact a person reading a short trail needs.
      oldestDroppedAt: dropped[0] ? dropped[0].at || null : null,
    };
  }

  // Fold another log in — an imported event package's entries, newest-first
  // like the host's. The old path ran slice(0, 1000) over the concatenation,
  // so importing a large event's history threw most of it away AND evicted
  // the host install's own decisions to make room.
  function merge(existing, incoming, limit = RETENTION_LIMIT) {
    const next = [...asLog(incoming), ...asLog(existing)];
    if (next.length <= limit) return { log: next, evicted: 0, oldestDroppedAt: null };
    const dropped = next.slice(limit);
    return {
      log: next.slice(0, limit),
      evicted: dropped.length,
      oldestDroppedAt: dropped[0] ? dropped[0].at || null : null,
    };
  }

  // The durable record of what left. Cumulative and never itself evicted, so
  // a reload cannot turn "402 entries were removed on the 3rd" back into
  // silence. Returns the record unchanged when nothing was dropped, so a
  // caller can assign the result unconditionally.
  function recordEviction(retention, result) {
    if (!result || !result.evicted) return retention || null;
    const prev = retention || { evicted: 0, firstEvictedAt: null, lastEvictedAt: null, oldestDroppedAt: null };
    const now = new Date().toISOString();
    return {
      evicted: (Number(prev.evicted) || 0) + result.evicted,
      firstEvictedAt: prev.firstEvictedAt || now,
      lastEvictedAt: now,
      // The most recent boundary: where the log begins now.
      oldestDroppedAt: result.oldestDroppedAt || prev.oldestDroppedAt || null,
    };
  }

  // Re-normalized on every load, the same discipline as freezes and handover
  // notes: a hand-edited backup could otherwise carry a retention record that
  // claims a loss which never happened.
  function normalizeRetention(value) {
    if (!value || typeof value !== "object") return null;
    const evicted = Math.max(0, Math.trunc(Number(value.evicted) || 0));
    if (!evicted) return null;
    const iso = (v) => (typeof v === "string" && v ? v : null);
    return {
      evicted,
      firstEvictedAt: iso(value.firstEvictedAt),
      lastEvictedAt: iso(value.lastEvictedAt),
      oldestDroppedAt: iso(value.oldestDroppedAt),
    };
  }

  // What one screen shows, and what it must SAY it is not showing. A window
  // that does not state its own total reads as the whole truth.
  function displayWindow(trail, limit = DISPLAY_LIMIT) {
    const rows = asLog(trail);
    return { rows: rows.slice(0, limit), total: rows.length, hidden: Math.max(0, rows.length - limit) };
  }

  globalThis.MeritAuditTrail = {
    version: 2, DECISION_CODES, resolve,
    RETENTION_LIMIT, DISPLAY_LIMIT,
    append, merge, recordEviction, normalizeRetention, displayWindow,
  };
})();
