// OFFLINE RECOVERY — an unattended safety net distinct from backup/restore.
//
// `exportBackup()` (app-v8.js) is the ONLY thing this product calls "backed
// up," and it means one specific fact: a file actually left the browser.
// This module is not that. It is a small, automatic ring buffer of recent
// full-state snapshots kept INSIDE the same browser storage the live state
// already lives in — protection against a corrupted primary record or an
// in-session mistake, never against losing the device or the browser
// profile itself. The two must never be presented as interchangeable: a
// recovery point existing here says nothing about whether a copy of the
// event has ever left this machine.
//
// This module decides WHETHER and WHAT to keep. It has no idea what
// storage is, does not touch IndexedDB or localStorage, and returns plain
// data for app-v8.js to persist through the existing StorageProvider.
(function () {
  "use strict";

  // Small on purpose: each entry is a full copy of the app's state, so this
  // is a few-times storage multiplier, not a versioned history.
  const KEEP = 3;
  // A snapshot only when real time has actually passed since the last one —
  // otherwise every ordinary save would duplicate the same moment.
  const MIN_INTERVAL_MS = 5 * 60 * 1000;

  function shouldSnapshot({ hasContent, lastSnapshotAt, now }) {
    if (!hasContent) return false;
    if (!lastSnapshotAt) return true;
    const last = new Date(lastSnapshotAt).getTime();
    if (!Number.isFinite(last)) return true;
    return (now - last) >= MIN_INTERVAL_MS;
  }

  // Newest first, capped at KEEP — the same shape discipline the handover
  // note log and the audit trail already use.
  function withSnapshot(snapshots, entry) {
    const list = Array.isArray(snapshots) ? snapshots : [];
    return [entry, ...list].slice(0, KEEP);
  }

  function latestSnapshot(snapshots) {
    return (Array.isArray(snapshots) ? snapshots : [])[0] || null;
  }

  globalThis.MeritOfflineRecovery = {
    version: 1,
    KEEP,
    MIN_INTERVAL_MS,
    shouldSnapshot,
    withSnapshot,
    latestSnapshot,
  };
})();
