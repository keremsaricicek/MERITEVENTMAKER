// WHEN STORAGE FAILS, THE EVENING CONTINUES AND NOTHING THAT WAS RIGHT IS LOST.
//
// `.claude/skills/merit-resilience-hardening/SKILL.md`: "The data is the
// event. A guest list rebuilt from scratch at 21:00 because a save failed
// silently is the worst outcome this product can produce." Every failure
// path is held to DETECT / CONTAIN / INFORM / RECOVER / PRESERVE, "and the
// one that matters most is PRESERVE".
//
// Faults are injected into the browser's own IndexedDB (tests/lib/faults.mjs),
// never into the product's functions, so what is exercised is the product's
// real handling.
//
// MEASURED BEFORE THE FIX, which is this suite's reason to exist:
//
//   AN UNREADABLE RECORD WAS DESTROYED. The app opened empty with no word
//   said, and the first save wrote the new, almost-empty state over the
//   record it could not read — one that was a single hand-edited quote away
//   from readable. It is now copied aside first, the operator is told, and
//   if even the copy cannot be written the session refuses to save.
//
//   A FAILING SAVE WAS A TOAST. Shown once, gone in six seconds, and nothing
//   after it said the work was not being kept. It is now a notice that stays
//   until a save succeeds, with the backup download beside it.
//
//   A BLANK INSTALL SAVED ITSELF AS SCHEMA 8 while the registry was at 9.
import { openApp, createBlankEvent, futureDate } from "../lib/app-actions.mjs";
import { installStorageFaults, setFault, readRecord, writeRecord, deleteRecord, listKeys, gotoBlank, bootApp } from "../lib/faults.mjs";

export const meta = { name: "resilience-storage", tags: ["resilience", "storage", "fast"], timeout: 180000, downloads: true };

const PRECIOUS = '{"schemaVersion":9,"events":[{"id":"e1","name":"PRECIOUS GALA","date":"2031-01-01","guests":[{"id":"g1","name": ALMOST READABLE", "pax":1}],"tables":[]}]}';

export default async function run({ page, checks, baseUrl }) {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await installStorageFaults(page);
  await openApp(page, baseUrl, { lang: "en" });

  // --- 0. a blank install is stamped with the version this build writes ----
  await createBlankEvent(page, { name: "Resilient Gala", hotel: "Merit", date: futureDate() });
  await page.waitForTimeout(700);
  const stamped = JSON.parse(await readRecord(page));
  const current = await page.evaluate(() => MeritSchemaMigrations.CURRENT_VERSION);
  checks.equal(stamped.schemaVersion, current,
    "a brand-new install saves itself at the schema version this build writes — it said 8 with the registry at 9", stamped.schemaVersion);

  // --- 1. the quota runs out mid-evening ------------------------------------
  const goodOnDisk = await readRecord(page);
  await setFault(page, "put", "quota");
  await page.evaluate(() => { state.events[0].name = "EDITED WHILE FULL"; touchEvent(state.events[0]); });
  await page.waitForTimeout(900);
  const full = await page.evaluate(() => ({
    notice: !!document.querySelector('[data-storage-notice="save-failing"]'),
    noticeText: document.querySelector('[data-storage-notice="save-failing"]')?.textContent.replace(/\s+/g, " ").trim() || null,
    inMemory: state.events[0].name,
  }));
  checks.ok(full.notice, "INFORM: a failing save raises a notice that STAYS — a toast that is gone in six seconds is not an error message", full);
  checks.equal(full.inMemory, "EDITED WHILE FULL", "CONTAIN: the operator's edit is still in front of them");
  checks.equal(await readRecord(page), goodOnDisk,
    "PRESERVE: what was on disk is exactly what was there before — a failed save wrote nothing half-way");
  await page.evaluate(() => { ui.lang = "tr"; render(); });
  const tr = await page.evaluate(() => document.querySelector('[data-storage-notice="save-failing"]')?.textContent || "");
  checks.ok(/KAYDEDİLMİYOR/.test(tr), "and it says so in Turkish in the Turkish UI", tr.slice(0, 60));
  await page.evaluate(() => { ui.lang = "en"; render(); });
  // Guarded rather than assumed, so that against code with no notice this
  // records a failure and carries on to the sections below.
  if (await page.$('[data-storage-action="backup"]')) {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click('[data-storage-action="backup"]')]);
    const backup = JSON.parse(await (await import("node:fs")).promises.readFile(await dl.path(), "utf8"));
    checks.ok(backup.payload.events.some((e) => e.name === "EDITED WHILE FULL"),
      "RECOVER: the backup beside the notice works WHILE storage is failing, and carries the unsaved edit");
  } else checks.ok(false, "RECOVER: a backup control sits beside the failing-save notice");
  await setFault(page, "put", null);
  await page.evaluate(() => { state.events[0].name = "SAVED AFTER RECOVERY"; touchEvent(state.events[0]); });
  await page.waitForTimeout(900);
  const recovered = await page.evaluate(() => !!document.querySelector('[data-storage-notice="save-failing"]'));
  checks.ok(!recovered, "RECOVER: the notice clears itself on the first save that succeeds");
  checks.equal(JSON.parse(await readRecord(page)).events[0].name, "SAVED AFTER RECOVERY",
    "and that save wrote everything the failed ones could not — every save is a whole snapshot");

  // --- 2. the stored record cannot be read at boot --------------------------
  await gotoBlank(page, baseUrl);
  await writeRecord(page, "root", PRECIOUS);
  await deleteRecord(page, "autosnapshots");
  pageErrors.length = 0;
  await bootApp(page, baseUrl);
  const boot = await page.evaluate(() => ({
    notice: !!document.querySelector('[data-storage-notice="unreadable"]'),
    text: document.querySelector('[data-storage-notice="unreadable"]')?.textContent.replace(/\s+/g, " ").trim() || null,
    events: state.events.length,
  }));
  checks.ok(boot.notice && /not deleted/.test(boot.text),
    "INFORM: an unreadable record is announced at boot — it used to open an empty app with no word said", boot);
  checks.equal(pageErrors.slice(), [], "CONTAIN: the app boots and renders; nothing throws");
  const keys = await listKeys(page);
  const qKey = keys.find((k) => k.startsWith("quarantine:"));
  checks.ok(!!qKey && (await readRecord(page, qKey)) === PRECIOUS,
    "PRESERVE: the unreadable record is copied aside, byte for byte, before anything else happens", keys);
  await createBlankEvent(page, { name: "Work After Corruption", hotel: "Merit", date: futureDate() });
  await page.waitForTimeout(800);
  checks.equal(await readRecord(page, qKey), PRECIOUS,
    "and the copy survives the operator carrying on — the first save used to destroy the only copy");
  if (await page.$('[data-storage-action="download-unreadable"]')) {
    const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click('[data-storage-action="download-unreadable"]')]);
    const downloaded = await (await import("node:fs")).promises.readFile(await dl2.path(), "utf8");
    checks.equal(downloaded, PRECIOUS, "RECOVER: the unreadable record downloads exactly as stored, for support to repair");
  } else checks.ok(false, "RECOVER: the unreadable record can be downloaded from the notice");

  // --- 3. unreadable AND the copy cannot be written -------------------------
  await gotoBlank(page, baseUrl);
  await writeRecord(page, "root", PRECIOUS);
  await deleteRecord(page, "autosnapshots");
  for (const k of await listKeys(page)) if (k.startsWith("quarantine:")) await deleteRecord(page, k);
  await setFault(page, "put", "quota");
  await page.evaluate(() => { sessionStorage.setItem("armQuota", "1"); });
  await page.addInitScript(() => { if (sessionStorage.getItem("armQuota")) window.__faults.put = "quota"; });
  await bootApp(page, baseUrl);
  const notKept = await page.evaluate(() => document.querySelector('[data-storage-notice="unreadable"]')?.textContent || "");
  checks.ok(/will NOT save/.test(notKept), "INFORM: when not even a copy can be written, the operator is told this session will not save", notKept.slice(0, 120));
  await page.evaluate(() => { sessionStorage.removeItem("armQuota"); window.__faults.put = null; });
  await page.evaluate(() => { state.events.push({ id: "e_new", name: "WOULD OVERWRITE", date: "2031-02-02", tables: [], guests: [] }); touchEvent(state.events[0]); });
  await page.waitForTimeout(900);
  checks.equal(await readRecord(page), PRECIOUS,
    "PRESERVE: even once storage accepts writes again, this session never writes over the only copy of a record it could not read");

  // --- 4. the browser's storage will not open at all ------------------------
  await page.evaluate(() => { sessionStorage.setItem("armOpen", "1"); });
  await page.addInitScript(() => { if (sessionStorage.getItem("armOpen")) window.__faults.open = "fail"; });
  pageErrors.length = 0;
  await bootApp(page, baseUrl);
  const unavailable = await page.evaluate(() => ({
    text: document.querySelector('[data-storage-notice="unreadable"]')?.textContent || "",
    download: !!document.querySelector('[data-storage-action="download-unreadable"]'),
    usable: !!document.querySelector('[data-action="create-event"]'),
  }));
  checks.ok(/could not be opened/.test(unavailable.text) && !unavailable.download && unavailable.usable,
    "an unopenable store is announced honestly — nothing to download, the app still usable, and nothing written over what it could not see", unavailable);
  checks.equal(pageErrors.slice(), [], "and nothing throws");
  await page.evaluate(() => { sessionStorage.removeItem("armOpen"); window.__faults.open = null; });
  checks.equal(await readRecord(page), PRECIOUS, "PRESERVE: the record it could not open is untouched");
}
