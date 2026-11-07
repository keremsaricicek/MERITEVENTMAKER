// Automatic backup to DISK — the page's side (src/disk-backup.js).
//
// Served by the local relay with a backup folder (the portable package), the
// page hands the relay a whole-install backup after changes (debounced: a burst
// of saves is ONE file), and the events screen offers "restore from the disk
// backups", which goes through the app's ONE validated restore path
// (importBackupFile): a refused file leaves the current state exactly as it
// was, a good one comes back equal — events, guests, assignments, chairs — and
// a historical event is still immutable afterwards.
// Served WITHOUT the relay (the plain browser build), the page sends nothing
// and shows nothing: it behaves exactly as before.
// The relay's own doors are `disk-backup-server`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { click, openApp, autoAnswer, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "disk-backup", tags: ["storage", "fast"], timeout: 180000 };

const NAME_RE = /^merit-yedek-\d{8}-\d{9}-e\d+\.json$/;

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-disk-backup-page-"));
  const dir = path.join(tmp, "yedekler");
  const { startRelay } = await import(path.join(repoRoot, "server/vlm-relay.mjs"));
  const core = await import(path.join(repoRoot, "server/vlm-core.mjs"));
  const { createBackupStore } = await import(path.join(repoRoot, "server/disk-backup.mjs"));
  const log = { log: () => {}, error: () => {} };
  const relay = await startRelay({ config: core.configFromEnv({ VLM_DATA_DIR: path.join(tmp, "data"), PORT: "0" }, { repoRoot }), client: null, log,
    backups: createBackupStore({ dir }) });
  const files = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => NAME_RE.test(n)).sort() : []);
  const waitFiles = async (n, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (files().length >= n) return true; await page.waitForTimeout(150); } return false; };
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  try {
    // ---- 1. the plain browser build: nothing sent, nothing shown ---------------
    const backupRequests = [];
    page.on("request", (r) => { if (r.url().includes("/merit-backup/")) backupRequests.push(r.url()); });
    await page.addInitScript(() => { globalThis.MERIT_DISK_BACKUP_DEBOUNCE_MS = 300; });
    await openApp(page, baseUrl, { lang: "en" });
    await page.evaluate(async () => { state.events.push({ id: "plain-1", name: "Plain", date: "2099-01-01", status: "Planning", tables: [], guests: [] }); await saveState(); });
    await page.waitForTimeout(1200);
    const plain = await page.evaluate(() => ({ available: !!(globalThis.MeritDiskBackup && globalThis.MeritDiskBackup.available()),
      button: !!document.querySelector('[data-action="disk-backup-restore"]') }));
    checks.equal({ requests: backupRequests.length, ...plain }, { requests: 0, available: false, button: false },
      "served without the relay, the page sends nothing to /merit-backup and shows no disk-restore button");

    // ---- 2. served by the relay: a change becomes ONE file on disk ---------------
    await openApp(page, relay.baseUrl, { lang: "en" });
    await page.waitForFunction(() => globalThis.MeritDiskBackup && globalThis.MeritDiskBackup.available(), null, { timeout: 10000 });
    const before = files().length;
    const date = futureDate();
    await page.evaluate(async ({ date }) => {
      const t1 = { id: "dt-t1", name: "T01", label: "T01", number: "T01", type: "round", x: 100, y: 100, w: 80, h: 80, rotation: 0, capacity: 4,
        chairs: [{ id: "c1", x: 100, y: 50 }, { id: "c2", x: 150, y: 100 }, { id: "c3", x: 100, y: 150 }, { id: "c4", x: 50, y: 100 }] };
      const t2 = { id: "dt-t2", name: "T02", label: "T02", number: "T02", type: "round", x: 300, y: 100, w: 80, h: 80, rotation: 0, capacity: 6, chairs: [] };
      const guests = [
        { id: "dg-1", name: "DISK GUEST ONE", additionalGuests: 2, pax: 3, planningStatus: "Confirmed", arrivalStatus: "Not Arrived", assignment: { tableId: "dt-t1", seats: [0, 1, 2], locked: false } },
        { id: "dg-2", name: "DISK GUEST TWO", additionalGuests: 0, pax: 1, planningStatus: "Tentative", arrivalStatus: "Not Arrived", assignment: null },
      ];
      state.events.push({ id: "disk-ev-1", name: "Disk Event", hotel: "Merit", date, status: "Planning", tables: [t1, t2], guests, objects: [] });
      state.events.push({ id: "disk-hist-1", name: "Old Gala", hotel: "Merit", date: "2020-02-02", status: "Completed",
        tables: [{ ...t1, id: "h-t1" }], guests: [{ id: "h-g1", name: "HIST GUEST", additionalGuests: 0, pax: 1, planningStatus: "Confirmed", arrivalStatus: "Checked In", assignment: { tableId: "h-t1", seats: [0], locked: false } }], objects: [] });
      // a burst: five saves in a row
      for (let i = 0; i < 5; i++) { state.events[state.events.length - 2].name = "Disk Event"; await saveState(); }
    }, { date });
    checks.require(await waitFiles(before + 1), "a change made in the app reaches the disk backup folder", files());
    await page.waitForTimeout(1200);
    checks.equal(files().length, before + 1, "a burst of saves is debounced into ONE backup file");
    const newest = JSON.parse(fs.readFileSync(path.join(dir, files().at(-1)), "utf8"));
    checks.ok(newest.format === "merit-event-maker-backup" && newest.payload.events.some((e) => e.id === "disk-ev-1" && e.guests.some((g) => g.name === "DISK GUEST ONE")),
      "the file is a whole-install backup in the app's own format, holding the real event and guests", newest.payload.events.map((e) => e.id));

    const snapshot = await page.evaluate(() => JSON.stringify(state.events.map((e) => ({ id: e.id, name: e.name, status: e.status, date: e.date,
      tables: e.tables.map((t) => ({ id: t.id, capacity: t.capacity, chairs: t.chairs })),
      guests: e.guests.map((g) => ({ id: g.id, name: g.name, pax: g.pax, planningStatus: g.planningStatus, arrivalStatus: g.arrivalStatus, assignment: g.assignment })) }))));
    const goodName = files().at(-1);

    // ---- 3. everything is lost (a cleared browser, in effect) -------------------
    await page.evaluate(async () => { state.events = []; await saveState(); render(); });
    await page.waitForTimeout(1500);
    checks.equal(files().length, before + 1, "a record with no events is never sent (it would push real backups out of the rotation)");

    // ---- 4. a corrupt file and a broken one are refused; the state stays ---------
    const later = (k) => { const n = goodName.replace(/-(\d{9})-/, (m, t) => `-${String(Number(t) + 100000 + k).padStart(9, "0")}-`); return n; };
    const corrupt = later(1), broken = later(2);
    fs.writeFileSync(path.join(dir, corrupt), "{\"format\":\"merit-event-maker-backup\",\"payload\":{\"events\":[");
    const brokenDoc = JSON.parse(JSON.stringify(newest));
    brokenDoc.payload.events.find((e) => e.id === "disk-ev-1").guests[0].assignment = { tableId: "no-such-table", seats: [0], locked: false };
    fs.writeFileSync(path.join(dir, broken), JSON.stringify(brokenDoc));
    await page.evaluate(async () => { state.events.push({ id: "keep-me", name: "Keep Me", date: "2099-05-05", status: "Planning", tables: [], guests: [] }); await saveState(); render(); });
    await autoAnswer(page);
    const restoreFrom = async (name) => {
      await page.waitForSelector('[data-action="disk-backup-restore"]', { state: "attached", timeout: 8000 });
      await click(page, '[data-action="disk-backup-restore"]');
      await page.waitForSelector(`#meritDiskBackupDialog [data-disk-backup-name="${name}"]`, { timeout: 8000 });
      await page.click(`#meritDiskBackupDialog [data-disk-backup-name="${name}"]`);
      await page.waitForTimeout(900);
      return page.locator(".toast").last().textContent().catch(() => "NO TOAST");
    };
    const t1 = await restoreFrom(corrupt);
    checks.ok(/could not be read|not a MERIT/i.test(t1), "a corrupt disk backup is refused with the restore path's own message", t1);
    const t2 = await restoreFrom(broken);
    checks.ok(/broken internal references/i.test(t2), "a disk backup with a broken reference is refused the same way", t2);
    const kept = await page.evaluate(() => state.events.map((e) => e.id));
    checks.equal(kept, ["keep-me"], "after both refusals the current state is exactly what it was");

    // ---- 5. the good one comes back equal ----------------------------------------
    const t3 = await restoreFrom(goodName);
    checks.ok(/restored/i.test(t3), "a good disk backup is restored through the validated path", t3);
    const after = await page.evaluate(() => JSON.stringify(state.events.map((e) => ({ id: e.id, name: e.name, status: e.status, date: e.date,
      tables: e.tables.map((t) => ({ id: t.id, capacity: t.capacity, chairs: t.chairs })),
      guests: e.guests.map((g) => ({ id: g.id, name: g.name, pax: g.pax, planningStatus: g.planningStatus, arrivalStatus: g.arrivalStatus, assignment: g.assignment })) }))));
    checks.equal(JSON.parse(after), JSON.parse(snapshot), "round trip: events, guests, assignments and chairs equal what was backed up");

    // historical after the restore: the rules still say so, and the keyboard
    // paths that mutate an open event change nothing in it
    const readHist = () => page.evaluate(() => JSON.stringify(state.events.find((e) => e.id === "disk-hist-1")));
    const histBefore = await readHist();
    const isHist = await page.evaluate(() => globalThis.MeritEventRules.isHistorical(state.events.find((e) => e.id === "disk-hist-1")));
    // The calendar shows one month; opening the event is what a double-click on its entry does.
    await page.evaluate(() => openEvent("disk-hist-1"));
    await page.waitForTimeout(500);
    for (const [k, c] of [["z", true], ["y", true], ["d", true], ["Delete", false]]) {
      await page.evaluate(({ k, c }) => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: c, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: c, bubbles: true })); }, { k, c });
      await page.waitForTimeout(250);
    }
    checks.equal({ historical: isHist, unchanged: (await readHist()) === histBefore }, { historical: true, unchanged: true },
      "a historical event is still immutable after the restore (Ctrl+Z / Ctrl+Y / Ctrl+D / Delete change nothing)");

    await page.reload(); await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => { try { return state.events.length > 0; } catch { return false; } }, null, { timeout: 15000 });
    const reloaded = await page.evaluate(() => state.events.map((e) => e.id).sort());
    checks.equal(reloaded, ["disk-ev-1", "disk-hist-1", "plain-1"].filter((id) => JSON.parse(snapshot).some((e) => e.id === id)).sort(), "the restored state was persisted, not only held in memory");

    checks.equal(consoleErrors.filter((e) => !/favicon|DOMAIN MODEL|ERR_INTERNET|net::/i.test(e)), [], "no console errors on either build");
  } finally {
    await relay.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
