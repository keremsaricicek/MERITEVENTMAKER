// Backup export/import, including every way a bad file must be refused.
//
// A restore is the one operation that can destroy a venue's whole event
// history in a single click, so the rejection paths matter more than the happy
// one: a corrupt or foreign file must be refused with the current data left
// exactly as it was, never half-applied.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent, addTables, addGuest, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "backup-restore", tags: ["storage", "fast"], timeout: 120000, downloads: true };

export default async function run({ page, checks, baseUrl, artifactDir }) {
  page.on("dialog", d => d.accept());
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "BackupCheck", hotel: "Merit", date: "2026-12-15" });
  await addTables(page);
  await gotoTab(page, "guests");
  await addGuest(page, { name: "BACKUP GUEST" });
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(400);

  // --- export carries the real content --------------------------------------
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-action="backup-export"]'),
  ]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  checks.require(exported.format === "merit-event-maker-backup",
    "the export carries the documented format marker", exported.format);
  checks.ok(exported.payload.events.length === 1 && exported.payload.events[0].name === "BackupCheck",
    "the export contains the real event", exported.payload.events.map(e => e.name));
  checks.ok(exported.payload.events[0].guests.some(g => g.name === "BACKUP GUEST"),
    "the export contains the real guest");
  checks.ok(exported.payload.events[0].tables.length === 4,
    "the export contains the floor plan", exported.payload.events[0].tables.length);

  const write = (name, contents) => {
    const file = path.join(artifactDir, name);
    fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
    return file;
  };
  const tryImport = async file => {
    await click(page, '[data-action="backup-import"]');
    await page.setInputFiles("#backupFileInput", file);
    await page.waitForTimeout(500);
    return page.locator(".toast").last().textContent().catch(() => "NO TOAST");
  };

  // --- 1. a file that is simply not one of ours -----------------------------
  let toast = await tryImport(write("not-a-backup.json", { foo: "bar" }));
  checks.ok(/not a MERIT EVENT MAKER backup/i.test(toast), "a file with no format marker is refused by name", toast);

  // --- 2. genuinely corrupt bytes -------------------------------------------
  toast = await tryImport(write("corrupt.json", "{not valid json"));
  checks.ok(/could not be read/i.test(toast), "corrupt JSON is refused rather than throwing", toast);

  // --- 3. structurally valid, semantically broken ---------------------------
  const broken = JSON.parse(JSON.stringify(exported));
  broken.payload.events[0].guests[0].assignment = { tableId: "does-not-exist", seats: [0], locked: false };
  toast = await tryImport(write("broken-ref.json", broken));
  checks.ok(/broken internal references/i.test(toast),
    "a backup whose guest points at a table that isn't there is refused", toast);

  const untouched = await page.evaluate(() => ({
    events: state.events.length,
    name: state.events[0]?.name,
    guest: state.events[0]?.guests[0]?.name,
  }));
  checks.ok(untouched.events === 1 && untouched.name === "BackupCheck" && untouched.guest === "BACKUP GUEST",
    "after three refused imports the current data is exactly what it was — nothing half-applied", untouched);

  // --- 4. a valid, different backup replaces rather than merges -------------
  const other = JSON.parse(JSON.stringify(exported));
  other.payload.events[0].id = "evt-restored-1";
  other.payload.events[0].name = "Restored Event";
  other.payload.events[0].guests[0].name = "RESTORED GUEST";
  await tryImport(write("other-backup.json", other));
  const restored = await page.evaluate(() => state.events.map(e => ({ name: e.name, guests: e.guests.map(g => g.name) })));
  checks.ok(restored.length === 1 && restored[0].name === "Restored Event",
    "the restore replaced the event set", restored);
  checks.ok(restored[0].guests.includes("RESTORED GUEST") && !restored[0].guests.includes("BACKUP GUEST"),
    "it is a replace, not a merge — the old guest is gone", restored[0].guests);

  // --- 5. and the restore was actually written ------------------------------
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
  const afterReload = await page.evaluate(() => state.events.map(e => ({ name: e.name, tables: e.tables.length })));
  checks.ok(afterReload.length === 1 && afterReload[0].name === "Restored Event",
    "the restored data was persisted, not just held in memory", afterReload);
  checks.ok(afterReload[0].tables === 4, "the restored floor plan came back whole", afterReload);
}
