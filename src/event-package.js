// PORTABLE EVENT PACKAGE — one event, moved whole to another machine.
//
// Distinct from backup/restore (Gate L), which is the whole install: every
// event, replacing what is already there. A package is ONE event, added
// alongside whatever already exists — an operator sending a single night's
// plan to a colleague, or archiving one finished event outside the browser
// it was built in. Never presented as a substitute for exportBackup(): it
// says nothing about any other event in the install, and does not touch
// the Risk Radar's "backed up" fact (`lastBackupAt`), which means the whole
// install left the browser, not one event.
//
// This module knows the payload's shape and how to renumber an event's
// internal ids consistently. It has no idea what storage is and never
// touches `state` — app-v8.js hands it plain data and an id factory, and
// gets plain data back.
(function () {
  "use strict";

  const FORMAT = "merit-event-maker-event-package";
  const FORMAT_VERSION = 1;

  function buildPayload(event, { venue = null, auditEntries = [] } = {}) {
    return { format: FORMAT, formatVersion: FORMAT_VERSION, exportedAt: new Date().toISOString(), event, venue, auditEntries };
  }

  function isWellFormed(parsed) {
    return !!(parsed && parsed.format === FORMAT && parsed.event && Array.isArray(parsed.event.tables) && Array.isArray(parsed.event.guests));
  }

  // Every guest.assignment.tableId must resolve to a table in the SAME
  // package -- the same discipline backupReferencesIntact() already applies
  // to a whole-install backup, scoped to one event.
  function referencesIntact(event) {
    const tableIds = new Set((event.tables || []).map((t) => t.id));
    return (event.guests || []).every((g) => !g.assignment || !g.assignment.tableId || tableIds.has(g.assignment.tableId));
  }

  // Every id the package's own event owns gets a fresh one, and every place
  // that pointed at an old id is updated to point at the new one — a table
  // freeze naming a table by id (never by zone or number range, which are
  // plain strings and travel unchanged), a chair's parentTableId, a guest's
  // seat assignment, and the eventId on any audit-trail entry carried
  // alongside it, so Phase P's trail keeps reading correctly after import
  // instead of falling back to "no longer on this event" for history that
  // is, in fact, still there under a new id.
  function regenerateIds(event, auditEntries, idFactory) {
    const tableMap = new Map();
    const guestMap = new Map();
    const nextEventId = idFactory("event");
    const tables = (event.tables || []).map((t) => {
      const id = idFactory("table");
      tableMap.set(t.id, id);
      const chairs = (t.chairs || []).map((c, i) => ({ ...c, id: idFactory("chair"), parentTableId: id, seatNumber: i + 1 }));
      return { ...t, id, chairs };
    });
    const venueObjects = (event.venueObjects || []).map((o) => ({ ...o, id: idFactory("venue") }));
    const guests = (event.guests || []).map((g) => {
      const id = idFactory("guest");
      guestMap.set(g.id, id);
      const assignment = g.assignment && tableMap.has(g.assignment.tableId)
        ? { ...g.assignment, tableId: tableMap.get(g.assignment.tableId) }
        : g.assignment;
      return { ...g, id, assignment };
    });
    const freezes = (event.freezes || []).map((f) =>
      f.scope === "TABLE" && tableMap.has(f.tableId) ? { ...f, tableId: tableMap.get(f.tableId) } : { ...f });
    const remappedEvent = { ...event, id: nextEventId, tables, venueObjects, guests, freezes };
    const remappedAudit = (auditEntries || []).map((a) => {
      const detail = { ...a.detail };
      if (detail.tableId && tableMap.has(detail.tableId)) detail.tableId = tableMap.get(detail.tableId);
      if (detail.guestId && guestMap.has(detail.guestId)) detail.guestId = guestMap.get(detail.guestId);
      return { ...a, id: idFactory("audit"), eventId: nextEventId, detail };
    });
    return { event: remappedEvent, auditEntries: remappedAudit };
  }

  globalThis.MeritEventPackage = { version: 1, FORMAT, FORMAT_VERSION, buildPayload, isWellFormed, referencesIntact, regenerateIds };
})();
