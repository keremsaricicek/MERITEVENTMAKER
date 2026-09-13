// A PORTABLE EVENT PACKAGE moves one event to another machine — distinct
// from exportBackup()'s whole install, which replaces everything.
//
// This suite exists to keep four properties true:
//
//   ONE EVENT, ADDED ALONGSIDE. Importing a package must never replace or
//   touch any event already on the machine — only backup/restore does that.
//
//   EVERY CROSS-REFERENCE FOLLOWS THE NEW IDS. A table freeze naming a
//   table by id, a guest's seat assignment, and the audit-trail history
//   carried alongside the event must all still point at the right thing
//   after every id in the package is renumbered to avoid collisions.
//
//   NEVER CONFLATED WITH exportBackup(). A single event leaving the
//   browser must never touch `lastBackupAt`, which the Risk Radar reads as
//   "the whole install left the browser" — a fact this feature does not
//   establish.
//
//   THE SAME DEFECT CLASS, FOUND AND FIXED IN duplicateEvent() TOO. Measuring
//   this phase's own id-remapping need surfaced a real, pre-existing bug:
//   duplicating an event never remapped a TABLE-scope freeze's tableId, so
//   the freeze silently covered nothing in the copy.
import fs from "node:fs";
import { click, openApp, createBlankEvent, addTables, gotoTab, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "event-package", tags: ["storage", "fast"], timeout: 120000, downloads: true };

export default async function run({ page, checks, baseUrl, artifactDir }) {
  page.on("dialog", d => d.accept());
  await openApp(page, baseUrl);

  // --- 1. the domain module itself --------------------------------------
  const bare = await page.evaluate(() => {
    const P = MeritEventPackage;
    let n = 0;
    const idFactory = kind => `${kind}_${++n}`;
    const source = {
      id: "orig-event", name: "Source", tables: [
        { id: "orig-t1", chairs: [{ id: "orig-c1", parentTableId: "orig-t1", seatNumber: 1 }] },
      ],
      guests: [{ id: "orig-g1", name: "Guest", assignment: { tableId: "orig-t1", seats: [0] } }],
      freezes: [{ id: "f1", scope: "TABLE", tableId: "orig-t1", reason: "OTHER" }],
      venueObjects: [],
    };
    const auditEntries = [
      { id: "a1", eventId: "orig-event", action: "TABLE_AVAILABILITY_CHANGED", detail: { tableId: "orig-t1" }, at: "x" },
      { id: "a2", eventId: "orig-event", action: "ARRIVAL_STATUS_CHANGED", detail: { guestId: "orig-g1" }, at: "y" },
    ];
    const { event, auditEntries: remapped } = P.regenerateIds(source, auditEntries, idFactory);
    return {
      wellFormed: P.isWellFormed({ format: P.FORMAT, event: source }),
      notWellFormed: P.isWellFormed({ format: "something-else", event: source }),
      referencesOk: P.referencesIntact(source),
      referencesBroken: P.referencesIntact({ ...source, guests: [{ id: "g2", assignment: { tableId: "does-not-exist" } }] }),
      eventIdChanged: event.id !== "orig-event",
      tableIdChanged: event.tables[0].id !== "orig-t1",
      chairFollowsTable: event.tables[0].chairs[0].parentTableId === event.tables[0].id,
      guestAssignmentFollows: event.guests[0].assignment.tableId === event.tables[0].id,
      freezeFollows: event.freezes[0].tableId === event.tables[0].id,
      auditEventIdFollows: remapped.every(a => a.eventId === event.id),
      auditTableIdFollows: remapped[0].detail.tableId === event.tables[0].id,
      auditGuestIdFollows: remapped[1].detail.guestId === event.guests[0].id,
    };
  });
  checks.ok(bare.wellFormed, "a package with the right format marker and shape is well-formed");
  checks.ok(!bare.notWellFormed, "the wrong format marker is not well-formed");
  checks.ok(bare.referencesOk, "an internally consistent event passes the reference check");
  checks.ok(!bare.referencesBroken, "a guest pointing at a table that is not in the package fails it");
  checks.ok(bare.eventIdChanged && bare.tableIdChanged, "every id in the package is renumbered");
  checks.ok(bare.chairFollowsTable, "a chair's parentTableId follows its table's new id");
  checks.ok(bare.guestAssignmentFollows, "a guest's seat assignment follows the table's new id");
  checks.ok(bare.freezeFollows, "a TABLE-scope freeze's tableId follows the table's new id");
  checks.ok(bare.auditEventIdFollows, "carried audit entries are re-scoped to the new event id");
  checks.ok(bare.auditTableIdFollows && bare.auditGuestIdFollows,
    "and their own table/guest references inside detail follow the same renumbering, so the trail still reads correctly");

  // --- 2. build a real event with a freeze, a handover note, and history --
  await createBlankEvent(page, { name: "Package Source", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 2 });
  const room = await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 6;
    e.tables[1].number = "T02"; e.tables[1].capacity = 6;
    e.guests = [{
      id: "g_pkg", name: "Package Guest", additionalGuests: 0, pax: 1, vip: "Standard",
      invitedBy: "Host", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: { tableId: e.tables[0].id, seats: [0], locked: false }, createdAt: new Date().toISOString(),
    }];
    e.freezes = [{ id: "f1", scope: "TABLE", tableId: e.tables[1].id, reason: "OTHER", note: "", createdAt: new Date().toISOString() }];
    touchEvent(e); render();
    return { t01: e.tables[0].id, t02: e.tables[1].id };
  });
  await gotoTab(page, "command");
  await settle(page);
  await page.fill("[data-handover-text]", "Package test note.");
  await click(page, "[data-handover-add]");
  await page.waitForTimeout(300);
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(300);

  const beforeBackupAt = await page.evaluate(() => state.lastBackupAt);
  checks.ok(!beforeBackupAt, "lastBackupAt has never been set yet in this fixture");

  // --- 3. export the package through the real button ------------------------
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-export-event-package]'),
  ]);
  const filePath = await download.path();
  const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));
  checks.equal(pkg.format, "merit-event-maker-event-package", "the exported file carries the package's own format marker, not backup.*'s");
  checks.ok(pkg.event.name === "Package Source" && pkg.event.guests.length === 1,
    "the package carries the real event", pkg.event.name);
  checks.ok(pkg.auditEntries.some(a => a.action === "HANDOVER_NOTE_ADDED"),
    "the package carries this event's own audit-trail history", pkg.auditEntries.map(a => a.action));
  const afterExportBackupAt = await page.evaluate(() => state.lastBackupAt);
  checks.ok(!afterExportBackupAt,
    "exporting a package never sets lastBackupAt — that fact means the WHOLE install left the browser, not one event", afterExportBackupAt);

  // --- 4. importing adds a new event alongside, never replaces -------------
  const before = await page.evaluate(() => state.events.map(e => e.id));
  await click(page, '[data-action="backup-import"]');
  await page.setInputFiles("#backupFileInput", filePath);
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => state.events.map(e => ({ id: e.id, name: e.name })));
  checks.equal(after.length, before.length + 1, "importing a package adds one event — nothing already present is replaced", after);
  const original = before[0];
  checks.ok(after.some(e => e.id === original), "the original event is still there, untouched", after);
  const imported = after.find(e => e.id !== original);
  checks.require(imported, "a new, different event id exists after import — ids were really renumbered");

  const importedState = await page.evaluate((id) => {
    const e = state.events.find(x => x.id === id);
    return {
      name: e.name,
      guestAssignmentTable: e.guests[0]?.assignment?.tableId,
      tableIds: e.tables.map(t => t.id),
      freezeTableId: e.freezes[0]?.tableId,
      handoverNotes: e.handoverNotes.map(n => n.text),
    };
  }, imported.id);
  checks.equal(importedState.name, "Package Source", "the imported event keeps its original name");
  checks.ok(importedState.tableIds.includes(importedState.guestAssignmentTable),
    "the imported guest's seat assignment points at one of the imported event's OWN new table ids", importedState);
  checks.ok(importedState.tableIds.includes(importedState.freezeTableId),
    "the imported freeze's tableId points at one of the imported event's OWN new table ids too", importedState);
  checks.ok(importedState.handoverNotes.includes("Package test note."), "the handover note travelled with the event", importedState);

  // --- 5. the imported freeze actually covers its table, and the trail reads
  await page.evaluate((id) => { ui.activeEventId = id; ui.screen = "workspace"; ui.tab = "seating"; render(); }, imported.id);
  await page.waitForTimeout(300);
  const freezeCovers = await page.evaluate(() => {
    const e = state.events.find(x => x.id === ui.activeEventId);
    const frozenTable = e.tables.find(t => t.id === e.freezes[0].tableId);
    return MeritSeatingFreeze.tableState(e.freezes, frozenTable);
  });
  checks.equal(freezeCovers, "FROZEN", "the imported freeze really covers the imported table, not a dangling old id");

  await gotoTab(page, "reports");
  await settle(page);
  const trailRows = await page.evaluate(() => [...document.querySelectorAll(".audit-text")].map(el => el.textContent));
  checks.ok(trailRows.some(r => /Package test note/.test(r)),
    "the imported audit trail reads the carried history correctly", trailRows);
  checks.ok(!trailRows.some(r => /no longer on this event/i.test(r)),
    "and no imported entry falls back to \"no longer on this event\" — the ids inside it were remapped too", trailRows);

  // --- 6. rejections: not our format, and broken internal references -------
  // Back to the Events/Home screen first — the import control lives in its
  // appbar, not inside an event's workspace (where step 5 left off).
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(300);
  const write = (name, contents) => { const f = artifactDir + "/" + name; fs.writeFileSync(f, JSON.stringify(contents)); return f; };
  const tryImport = async file => {
    await click(page, '[data-action="backup-import"]');
    await page.setInputFiles("#backupFileInput", file);
    await page.waitForTimeout(500);
    return page.locator(".toast").last().textContent().catch(() => "NO TOAST");
  };
  let toastText = await tryImport(write("not-a-package.json", { format: "merit-event-maker-event-package", event: { name: "x" } }));
  checks.ok(/not a MERIT EVENT MAKER event package/i.test(toastText), "an event package missing tables/guests arrays is refused", toastText);
  const broken = JSON.parse(JSON.stringify(pkg));
  broken.event.guests[0].assignment.tableId = "does-not-exist";
  toastText = await tryImport(write("broken-package.json", broken));
  checks.ok(/broken internal references/i.test(toastText), "a package whose guest points at a missing table is refused", toastText);

  // --- 7. the pre-existing duplicateEvent() defect this phase's own
  //        measurement found: a TABLE-scope freeze must follow the table's
  //        new id when an event is duplicated, exactly like on import -----
  await page.evaluate(() => { ui.screen = "events"; render(); });
  await click(page, `[data-duplicate-event="${original}"]`);
  await page.waitForTimeout(400);
  const dupCheck = await page.evaluate((origId) => {
    const src = state.events.find(e => e.id === origId);
    const dup = state.events.find(e => e.name === src.name + " — Copy");
    if (!dup) return null;
    const dupFrozenTable = dup.tables.find(t => t.id === dup.freezes[0]?.tableId);
    return { hasFreeze: !!dup.freezes[0], state: dupFrozenTable ? MeritSeatingFreeze.tableState(dup.freezes, dupFrozenTable) : null };
  }, original);
  checks.require(dupCheck && dupCheck.hasFreeze, "the duplicated event carries a freeze at all");
  checks.equal(dupCheck.state, "FROZEN", "and it still covers the duplicated table under its own new id — the fixed defect");

  // --- 8. both languages, no raw keys, EN really differs from TR -----------
  const words = await page.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; render();
      out[lang] = document.querySelector('[data-export-event-package]')?.title || "";
    }
    ui.lang = "en"; render();
    return out;
  });
  checks.ok(words.en && words.tr, "both languages have a real export-button title", words);
  checks.ok(words.en !== words.tr, "and Turkish is really Turkish", words);
}
