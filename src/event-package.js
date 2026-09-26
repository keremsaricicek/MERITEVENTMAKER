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

  // CAN THIS BUILD OPERATE ON THIS EVENT? Asked of every event that arrives in
  // a file — a package's one event, and each event in a whole-install backup —
  // BEFORE anything is replaced or added, so a file is refused whole rather
  // than half-applied.
  //
  // Deliberately narrower than "is this exactly what this build writes".
  // `migrateEvent` already repairs what it can repair honestly (an unknown
  // status, a missing background, a capacity out of range). What is checked
  // here is what it cannot, each found by feeding the file to the real
  // restore (`tests/suites/malformed-import.test.mjs`):
  //
  //   A LIST THAT IS NOT A LIST, OR AN ENTRY THAT IS NOT A RECORD. `null` in
  //     `guests` threw a TypeError out of the file reader with no message.
  //   A DATE NOTHING CAN READ. Accepted, saved, and then every render of the
  //     Events screen threw — the install was dead, reload after reload.
  //   A NAME OR TABLE NUMBER THAT IS NOT TEXT. `nextTableNumber` calls
  //     `.startsWith` on it; an object name renders as "[object Object]".
  //   A PARTY SIZE THAT IS NOT A PARTY. `additionalGuests: 1e9` was accepted
  //     as a guest of a billion; seat code builds arrays that long. The bound
  //     is the one the guest dialog already enforces (0–99 additional).
  //   AN ID THIS PRODUCT COULD NOT HAVE WRITTEN. Ids come from `uid()` and
  //     never from a person, and they are interpolated into markup as
  //     attribute values; an id carrying a quote is an injection, not an id.
  //
  // Returns the FIRST problem as `{ path, rule }`, or null. `path` is built
  // from this walk's own fixed field names and indexes, never from content,
  // so it is safe to show.
  const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
  const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const isCalendarDate = (v) => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + "T12:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  };
  const MAX_ADDITIONAL = 99;
  function eventProblem(event, at = "event") {
    if (!isRecord(event)) return { path: at, rule: "notRecord" };
    if (event.id !== undefined && !(typeof event.id === "string" && ID.test(event.id))) return { path: `${at}.id`, rule: "badId" };
    if (event.name !== undefined && typeof event.name !== "string") return { path: `${at}.name`, rule: "notText" };
    if (!isCalendarDate(event.date)) return { path: `${at}.date`, rule: "badDate" };
    for (const list of ["tables", "guests", "venueObjects", "freezes", "handoverNotes"]) {
      const v = event[list];
      if (v === undefined || v === null) continue;
      if (!Array.isArray(v)) return { path: `${at}.${list}`, rule: "notList" };
      for (let i = 0; i < v.length; i++) {
        const item = v[i], here = `${at}.${list}[${i}]`;
        if (!isRecord(item)) return { path: here, rule: "notRecord" };
        if (item.id !== undefined && !(typeof item.id === "string" && ID.test(item.id))) return { path: `${here}.id`, rule: "badId" };
      }
    }
    for (let i = 0; i < (event.tables || []).length; i++) {
      const t = event.tables[i], here = `${at}.tables[${i}]`;
      if (typeof t.number !== "string") return { path: `${here}.number`, rule: "notText" };
      if (t.chairs !== undefined && t.chairs !== null) {
        if (!Array.isArray(t.chairs)) return { path: `${here}.chairs`, rule: "notList" };
        const c = t.chairs.findIndex((x) => !isRecord(x));
        if (c >= 0) return { path: `${here}.chairs[${c}]`, rule: "notRecord" };
        const b = t.chairs.findIndex((x) => x.id !== undefined && !(typeof x.id === "string" && ID.test(x.id)));
        if (b >= 0) return { path: `${here}.chairs[${b}].id`, rule: "badId" };
      }
    }
    for (let i = 0; i < (event.guests || []).length; i++) {
      const g = event.guests[i], here = `${at}.guests[${i}]`;
      if (typeof g.name !== "string" || !g.name.trim()) return { path: `${here}.name`, rule: "notText" };
      if (g.additionalGuests !== undefined && g.additionalGuests !== null && !isInt(g.additionalGuests, 0, MAX_ADDITIONAL))
        return { path: `${here}.additionalGuests`, rule: "badPax" };
      if ((g.additionalGuests === undefined || g.additionalGuests === null) && g.pax !== undefined && g.pax !== null && !isInt(g.pax, 1, MAX_ADDITIONAL + 1))
        return { path: `${here}.pax`, rule: "badPax" };
      const a = g.assignment;
      if (a !== undefined && a !== null) {
        if (!isRecord(a) || typeof a.tableId !== "string" || !Array.isArray(a.seats) || !a.seats.every((s) => isInt(s, 0, 98)))
          return { path: `${here}.assignment`, rule: "badAssignment" };
      }
    }
    return null;
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

  globalThis.MeritEventPackage = { version: 1, FORMAT, FORMAT_VERSION, MAX_ADDITIONAL, buildPayload, isWellFormed, referencesIntact, eventProblem, regenerateIds };
})();
