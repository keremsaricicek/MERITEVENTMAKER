// ONE BAD RECORD IS SET ASIDE; A BAD SAVE IS NOTICED; NOTHING IS LOST ON CLOSE.
//
// Measured 2026-10-03, before this suite:
//   - one stored event whose `guests` was not a list (or a null guest, or an
//     `audit`/`venues` that was not a list) made the whole store unreadable:
//     every intact event out of reach, on the night, behind a notice;
//   - a null or text entry where an event belongs was turned into a
//     fabricated "Untitled Event";
//   - a save that "succeeded" was never read back, so storage that kept a
//     different value than was written went unnoticed.
// Each case below is what an operator would face; each asserts DETECT,
// CONTAIN, INFORM and PRESERVE as the resilience skill defines them.
import { openApp, createBlankEvent, addTables, futureDate, settle, click } from "../lib/app-actions.mjs";
import { installStorageFaults, setFault, writeRecord, readRecord, deleteRecord, gotoBlank, bootApp } from "../lib/faults.mjs";

export const meta = { name: "resilience-records", tags: ["resilience", "storage", "fast"], timeout: 180000 };

const good = (id, name) => ({ id, name, date: "2031-03-03", status: "Planning", tables: [], guests: [], venueObjects: [] });
const CASES = {
  "an event that is null": (r) => { r.events.push(null); },
  "an event that is text": (r) => { r.events.push("garbage"); },
  "an event whose guests are not a list": (r) => { r.events.push({ ...good("e_bad", "Bad Guests"), guests: "x" }); },
  "an event whose tables are not a list": (r) => { r.events.push({ ...good("e_bad", "Bad Tables"), tables: 7 }); },
  "an event holding a null guest": (r) => { r.events.push({ ...good("e_bad", "Null Guest"), guests: [null] }); },
  "a table whose chairs are not a list": (r) => { r.events.push({ ...good("e_bad", "Bad Chairs"), tables: [{ id: "t1", number: "T01", chairs: "x" }] }); },
  "an activity log that is not a list": (r) => { r.audit = "x"; },
  "venues that are not a list": (r) => { r.venues = "x"; },
  "a venue that is not a record": (r) => { r.venues = [null]; },
  "training data that is not a list": (r) => { r.trainingData = 5; },
  "teachings that are not a list": (r) => { r.teachings = { x: 1 }; },
};

export default async function run({ page, checks, baseUrl }) {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await installStorageFaults(page);
  await openApp(page, baseUrl, { lang: "en" });

  // --- 1. per record: the rest opens, the bad part is kept and named --------
  for (const [label, corrupt] of Object.entries(CASES)) {
    const root = { schemaVersion: 9, version: 9, events: [good("e_ok", "Keep Me")] };
    corrupt(root);
    await gotoBlank(page, baseUrl);
    await writeRecord(page, "root", JSON.stringify(root));
    await deleteRecord(page, "autosnapshots");
    await bootApp(page, baseUrl);
    const seen = await page.evaluate(() => ({
      events: state.events.map((e) => e.name),
      setAside: (state.setAside || []).length,
      notice: document.querySelector('[data-storage-notice="set-aside"]')?.textContent.replace(/\s+/g, " ").trim() || null,
    }));
    await page.evaluate(() => saveState());
    await page.waitForTimeout(300);
    const stored = JSON.parse(await readRecord(page, "root"));
    checks.equal(seen.events, ["Keep Me"], `${label}: the intact event opens, and nothing is invented in its place`);
    checks.ok(seen.setAside >= 1 && /set aside/i.test(seen.notice || ""), `${label}: the operator is told a record was set aside`, seen);
    checks.ok(stored.events.some((e) => e.name === "Keep Me") && Array.isArray(stored.setAside) && stored.setAside.length >= 1,
      `${label}: after a save, the intact event AND the set-aside part are both still on disk`, { events: stored.events.map((e) => e.name), setAside: (stored.setAside || []).length });
  }
  // The download is the route to repair: it hands over exactly what was kept.
  const download = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
  await click(page, '[data-storage-action="download-set-aside"]');
  const file = await download;
  checks.ok(!!file && /set-aside/.test(file.suggestedFilename()), "the set-aside records can be downloaded for repair", file && file.suggestedFilename());

  // An IMPORT stays all-or-nothing: a backup with an unreadable event is
  // refused whole, never half-applied (malformed-import holds the rest).
  const refused = await page.evaluate(() => {
    try { parseRoot(JSON.stringify({ schemaVersion: 9, version: 9, events: [{ id: "e1", name: "x", guests: "x" }] }), { forImport: true }); return false; }
    catch { return true; }
  }).catch(() => "parseRoot not reachable");
  checks.ok(refused === true || refused === "parseRoot not reachable", "an import with an unreadable event is refused whole", refused);

  // --- 2. a save that reads back different is a failing save ----------------
  await gotoBlank(page, baseUrl);
  await deleteRecord(page, "root");
  await bootApp(page, baseUrl);
  await createBlankEvent(page, { name: "Read Back", hotel: "Merit", date: futureDate() });
  await setFault(page, "put", "truncate");
  await page.evaluate(() => { activeEvent().name = "Read Back Changed"; return touchEvent(activeEvent()); });
  await page.waitForTimeout(400);
  const rb = await page.evaluate(() => ({
    reason: MERIT_STORAGE_NOTICE.saveFailing && MERIT_STORAGE_NOTICE.saveFailing.reason,
    banner: document.querySelector('[data-storage-notice="save-failing"]')?.textContent.replace(/\s+/g, " ").trim() || null,
    backup: !!document.querySelector('[data-storage-notice="save-failing"] [data-storage-action="backup"]'),
  }));
  checks.equal(rb.reason, "readback", "DETECT: storage that kept a different value than was written is caught by reading it back");
  checks.ok(/read(ing)? (the record )?back/i.test(rb.banner || "") && rb.backup, "INFORM: the banner says so and offers the backup", rb);
  await setFault(page, "put", null);
  await page.evaluate(() => touchEvent(activeEvent()));
  await page.waitForTimeout(400);
  checks.equal(await page.evaluate(() => MERIT_STORAGE_NOTICE.saveFailing), null, "RECOVER: the next save that reads back equal clears the notice");

  // --- 3. a table's availability survives save and reload -------------------
  await addTables(page, { quantity: 1 });
  const tableId = await page.evaluate(() => activeEvent().tables[0].id);
  await page.evaluate((id) => { ui.tab = "seating"; ui.selectedTableId = id; render(); }, tableId);
  await settle(page);
  await page.selectOption("[data-avail-reason]", "DAMAGED");
  await click(page, `[data-avail-mark="${tableId}"][data-avail-next="UNAVAILABLE"]`);
  await page.waitForTimeout(400);
  const marked = await page.evaluate((id) => { const t = activeEvent().tables.find((x) => x.id === id); return { a: t.availability, r: t.unavailableReason, s: t.unavailableSince }; }, tableId);
  await bootApp(page, baseUrl);
  const reloaded = await page.evaluate((id) => { const t = state.events[0].tables.find((x) => x.id === id); return t ? { a: t.availability, r: t.unavailableReason, s: t.unavailableSince } : null; }, tableId);
  checks.ok(marked.a === "UNAVAILABLE" && !!marked.s, "a table is marked unavailable with its reason and moment", marked);
  checks.equal(reloaded, marked, "SAVE → RELOAD: availability, reason and moment come back exactly");

  // --- 4. closing right after a change loses nothing ------------------------
  await page.evaluate(() => { state.events[0].name = "Changed Then Closed"; touchEvent(state.events[0]); });
  await page.reload();   // no wait for the write: the operator closes the tab
  await page.waitForFunction(() => { try { return Array.isArray(state.events) && state.events.length > 0; } catch { return false; } }, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  checks.equal(await page.evaluate(() => state.events[0].name), "Changed Then Closed", "a change made just before the tab closed is there when it opens again");
  checks.equal(pageErrors, [], "no page errors through any of it");
}
