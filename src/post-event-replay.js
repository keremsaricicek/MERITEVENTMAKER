// POST-EVENT REPLAY — the story of the night, in the order it happened.
//
// This is deliberately NOT a third data source. src/audit-trail.js already
// names and scopes the decisions that matter; src/arrival-wave.js already
// knows when people were expected and when they actually walked in. Replay
// computes nothing either of those modules could disagree with it about —
// it only reorders one and lets the other's own bucket boundaries narrow it.
//
// TWO THINGS, BOTH BORROWED:
//
//   CHRONOLOGICAL ORDER. audit() writes newest-first because that is what a
//   live event wants ("what just happened"). A finished event wants the
//   opposite — the story from the door opening to the last decision of the
//   night — so this module reverses rather than asking the audit trail to
//   serve two orderings it was never designed for.
//
//   A BUCKET'S OWN WINDOW. Deciding whether a decision happened "during the
//   19:30 wave" needs the same clock arithmetic src/arrival-wave.js already
//   exports (`minutesOfStamp`, `minutesOfClock`). Both are taken as injected
//   helpers rather than reached for on `globalThis`, so this module stays a
//   pure function of its inputs and never silently drifts if the wave module
//   changes its own internal clock handling.
(function () {
  "use strict";

  // Oldest-first. Does not mutate its input — the audit trail's own
  // newest-first array may still be in use elsewhere on the same render.
  function chronological(auditEntries) {
    return Array.isArray(auditEntries) ? [...auditEntries].reverse() : [];
  }

  // Whether one trail entry's timestamp falls inside a wave bucket's window
  // [bucket.fromMinutes, bucket.fromMinutes + bucketMinutes). The upper bound
  // comes from the bucket's own `to` clock string via the injected
  // `minutesOfClock`, never from a duration this module assumes.
  function inWindow(entry, bucket, helpers) {
    const h = helpers || {};
    if (!entry || !bucket) return false;
    if (typeof h.minutesOfStamp !== "function" || typeof h.minutesOfClock !== "function") return false;
    const at = h.minutesOfStamp(entry.at);
    if (at === null || at === undefined) return false;
    const from = bucket.fromMinutes;
    const to = h.minutesOfClock(bucket.to);
    if (typeof from !== "number" || to === null || to === undefined) return false;
    // A window that wraps past midnight (from > to) still contains a moment
    // that is either at-or-after `from` or before `to`.
    return to > from ? (at >= from && at < to) : (at >= from || at < to);
  }

  // Convenience: the entries (already chronological or not — order is kept)
  // whose timestamp falls inside the given bucket.
  function windowed(entries, bucket, helpers) {
    return (Array.isArray(entries) ? entries : []).filter((e) => inWindow(e, bucket, helpers));
  }

  globalThis.MeritPostEventReplay = { version: 1, chronological, inWindow, windowed };
})();
