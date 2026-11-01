// What the data-portability flows DO to the working state, pinned before they
// leave app-v8.js (code health, ownership map A25, 2026-11-01).
//
// backup-restore, event-package, offline-recovery and malformed-import hold
// the files and the refusals. Measured first, by mutating each flow's side
// effects one at a time against those four suites, several survived every one
// of them — they are what this suite pins:
//   - a backup that has really left records `lastBackupAt` (the Risk Radar's
//     "a copy of the event exists" reads it), and only after the file left;
//   - a whole-install restore, from a file or from a recovery point, ends the
//     old undo history: undoing into a state that no longer exists would put
//     the replaced records back over the restored ones;
//   - an event package carries that event's own history, and importing it
//     merges that history under the NEW ids, adds the venue that travelled
//     with it only when this install does not have it, refuses a package from
//     a newer build, and returns the operator to the event list.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent, addTables, addGuest, gotoTab, futureDate, autoAnswer } from "../lib/app-actions.mjs";

export const meta = { name: "data-portability", tags: ["storage", "fast"], timeout: 180000, downloads: true };

export default async function run({ page, checks, baseUrl, artifactDir }) {
  await autoAnswer(page);
  await openApp(page, baseUrl, { lang: "en" });
  // --- 0. an install with no events keeps no recovery point -----------------
  await page.evaluate(() => saveState());
  await page.waitForTimeout(800);
  const emptySnaps = await page.evaluate(async () => {
    const list = await MERIT_STORAGE_PROVIDER.load("autosnapshots");
    return Array.isArray(list) ? list.length : 0;
  });
  checks.equal(emptySnaps, 0, "saving an install with no events takes no recovery point — there is nothing to recover");
  await createBlankEvent(page, { name: "Portable", hotel: "Merit", date: futureDate() });
  await addTables(page);
  await gotoTab(page, "guests");
  await addGuest(page, { name: "PORTABLE GUEST" });
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(400);

  const write = (name, contents) => {
    const file = path.join(artifactDir, name);
    fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
    return file;
  };
  const pick = async (file) => {
    await click(page, '[data-action="backup-import"]');
    await page.setInputFiles("#backupFileInput", file);
    await page.waitForTimeout(700);
    return page.locator(".toast").last().textContent().catch(() => "NO TOAST");
  };
  const download = async (selector) => {
    const [d] = await Promise.all([page.waitForEvent("download"), page.click(selector)]);
    return JSON.parse(fs.readFileSync(await d.path(), "utf8"));
  };

  // --- 1. a backup that left is recorded, and only then ----------------------
  const before = await page.evaluate(() => state.lastBackupAt || null);
  checks.equal(before, null, "a fresh install has never been backed up");
  const backup = await download('[data-action="backup-export"]');
  const after = await page.evaluate(() => state.lastBackupAt || null);
  checks.ok(typeof after === "string" && !Number.isNaN(Date.parse(after)),
    "exporting a backup records when the file left (lastBackupAt)", after);
  const stored = await page.evaluate(async () => JSON.parse(await MERIT_STORAGE_PROVIDER.load()).lastBackupAt || null);
  checks.equal(stored, after, "and that record is saved, not only held in memory");

  // --- 2. the package carries this event's own history ----------------------
  const eventId = await page.evaluate(() => state.events[0].id);
  const ownAudit = await page.evaluate((id) => state.audit.filter((a) => a.eventId === id).length, eventId);
  checks.require(ownAudit > 0, "the event has history of its own to carry", ownAudit);
  const pkg = await download(`[data-export-event-package="${eventId}"]`);
  checks.equal(pkg.auditEntries.length, ownAudit, "the package carries every entry of that event's history");
  checks.ok(pkg.auditEntries.every((a) => a.eventId === eventId), "and nothing from another event");
  checks.require(!!pkg.venue && !!pkg.event.venueRef, "the package carries its venue", pkg.venue && pkg.venue.id);

  // --- 3. importing it: a new event, its history under the new id -----------
  const venuesBefore = await page.evaluate(() => state.venues.length);
  // Marked as if an event were open (no render: the import control stays on
  // screen), so "returned to the event list" is something the import did.
  await page.evaluate(() => { ui.screen = "workspace"; ui.activeEventId = state.events[0].id; });
  await pick(write("package.json", pkg));
  const imported = await page.evaluate(() => ({
    screen: ui.screen, activeEventId: ui.activeEventId, events: state.events.map((e) => e.id),
    venues: state.venues.length,
  }));
  checks.equal(imported.events.length, 2, "the package was imported as a second event", imported.events);
  const newId = imported.events.find((id) => id !== eventId);
  checks.equal(imported.screen, "events", "the operator is returned to the event list");
  checks.equal(imported.activeEventId, null, "and no event is left open");
  const carried = await page.evaluate((id) => state.audit.filter((a) => a.eventId === id).length, newId);
  checks.equal(carried, ownAudit, "the imported event's history was merged in under its NEW id");
  checks.equal(imported.venues, venuesBefore, "a venue this install already has is not added a second time");

  // --- 4. a package whose venue this install does not have ------------------
  const foreign = JSON.parse(JSON.stringify(pkg));
  foreign.venue.id = "venue_from_elsewhere";
  foreign.event.venueRef = { ...foreign.event.venueRef, venueId: "venue_from_elsewhere" };
  foreign.event.name = "Foreign Venue";
  await pick(write("foreign.json", foreign));
  const withVenue = await page.evaluate(() => {
    const e = state.events.find((x) => x.name === "Foreign Venue");
    return { venues: state.venues.length, ref: e && e.venueRef && e.venueRef.venueId,
      exists: !!(e && state.venues.some((v) => v.id === e.venueRef.venueId)) };
  });
  checks.equal(withVenue.venues, venuesBefore + 1, "the venue that travelled with it is added, once");
  checks.ok(withVenue.exists && withVenue.ref !== "venue_from_elsewhere",
    "as its own new record, which the imported event now points at", withVenue);

  // --- 5. a package from a newer build is refused ---------------------------
  const countBefore = await page.evaluate(() => state.events.length);
  const future = JSON.parse(JSON.stringify(pkg));
  future.formatVersion = 999;
  future.event.name = "From The Future";
  const refusal = await pick(write("future.json", future));
  checks.ok(/newer version/i.test(refusal), "a package from a newer build is refused by name", refusal);
  checks.equal(await page.evaluate(() => state.events.length), countBefore, "and nothing was imported");

  // --- 6. a restore from a backup file ends the old undo history ------------
  await page.evaluate(() => { ui.undo = [{ marker: "before-restore" }]; ui.redo = [{ marker: "before-restore" }]; });
  await pick(write("backup.json", backup));
  const afterRestore = await page.evaluate(() => ({ events: state.events.length, undo: ui.undo.length, redo: ui.redo.length }));
  checks.equal(afterRestore.events, 1, "the backup replaced the event set");
  checks.equal([afterRestore.undo, afterRestore.redo], [0, 0], "and the undo history of the replaced state is gone");

  // --- 7. so does a restore from a recovery point ---------------------------
  const snaps = await page.evaluate(async () => {
    const list = await MERIT_STORAGE_PROVIDER.load("autosnapshots");
    return Array.isArray(list) ? list.length : 0;
  });
  checks.require(snaps > 0, "a recovery point exists to restore from", snaps);
  await page.evaluate(() => { ui.undo = [{ marker: "before-recovery" }]; ui.redo = [{ marker: "before-recovery" }]; });
  await click(page, '[data-action="recovery-restore"]');
  await page.waitForTimeout(900);
  const afterRecovery = await page.evaluate(() => ({ undo: ui.undo.length, redo: ui.redo.length, screen: ui.screen }));
  checks.equal([afterRecovery.undo, afterRecovery.redo], [0, 0], "a recovery restore also ends the undo history");
  checks.equal(afterRecovery.screen, "events", "and returns to the event list");
}
