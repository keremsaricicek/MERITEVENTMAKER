// An automatic, unattended safety net — distinct from backup/restore.
//
// exportBackup() means one specific fact: a file left the browser. This
// suite exists to keep three different properties true, because blurring
// any of them turns "recovery" into a false promise:
//
//   INDEPENDENT STORAGE. Automatic snapshots live under their own
//   StorageProvider key, never the primary record. A corrupted primary
//   record must not be able to take its own safety net down with it.
//
//   THROTTLED, NOT ON EVERY SAVE. A snapshot is taken only when real time
//   has actually passed since the last one — otherwise this would just be
//   a second, wasteful copy of the live state on every keystroke.
//
//   BOOT RECOVERY IS NEVER SILENT. Before this phase, a corrupted primary
//   record fell through to a blank slate with nothing but a console.warn —
//   the operator was never told their data was gone. Falling back to an
//   automatic snapshot must always come with a visible, honest notice, and
//   restoring one deliberately must always be confirmed first, the same as
//   restoring a backup file.
import { click, openApp, createBlankEvent, futureDate, autoAnswer } from "../lib/app-actions.mjs";

export const meta = { name: "offline-recovery", tags: ["storage", "fast"], timeout: 120000 };

export default async function run({ page, context, checks, baseUrl }) {
  page.on("dialog", d => d.accept());
  await autoAnswer(page);
  // Behavioural checks (snapshot cadence, restore messaging), not
  // translation — pinned to English since the product now boots Turkish.
  await openApp(page, baseUrl, { lang: "en" });

  // --- 1. the domain module itself -------------------------------------------
  const bare = await page.evaluate(() => {
    const R = MeritOfflineRecovery;
    const now = Date.now();
    return {
      firstEverIsTrue: R.shouldSnapshot({ hasContent: true, lastSnapshotAt: null, now }),
      noContentIsFalse: R.shouldSnapshot({ hasContent: false, lastSnapshotAt: null, now }),
      tooSoonIsFalse: R.shouldSnapshot({ hasContent: true, lastSnapshotAt: new Date(now - 1000).toISOString(), now }),
      longEnoughIsTrue: R.shouldSnapshot({ hasContent: true, lastSnapshotAt: new Date(now - R.MIN_INTERVAL_MS - 1000).toISOString(), now }),
      keepsNewestFirst: R.withSnapshot([{ at: "old" }], { at: "new" })[0].at,
      keep: R.KEEP,
      capsAtKeep: R.withSnapshot(Array.from({ length: R.KEEP + 2 }, (_, i) => ({ at: "e" + i })), { at: "newest" }).length,
      latestOfEmpty: R.latestSnapshot([]),
      latestOfNone: R.latestSnapshot(null),
    };
  });
  checks.ok(bare.firstEverIsTrue, "the very first snapshot is always taken");
  checks.ok(!bare.noContentIsFalse, "an empty install is never worth snapshotting");
  checks.ok(!bare.tooSoonIsFalse, "a second snapshot one second later is refused");
  checks.ok(bare.longEnoughIsTrue, "a snapshot after the real interval has passed is allowed");
  checks.equal(bare.keepsNewestFirst, "new", "the newest snapshot always reads first");
  checks.equal(bare.capsAtKeep, bare.keep, "adding beyond KEEP still caps the ring buffer at KEEP", bare);
  checks.ok(bare.latestOfEmpty === null && bare.latestOfNone === null, "no snapshots means no latest, not a throw");

  // --- 2. restoring with nothing to restore says so, not a silent no-op -----
  await click(page, '[data-action="recovery-restore"]');
  await page.waitForTimeout(300);
  const noneToast = (await page.locator(".toast").last().textContent().catch(() => "NO TOAST"));
  checks.ok(/no automatic recovery point/i.test(noneToast),
    "with zero events and zero snapshots, restoring says none exists rather than doing nothing silently", noneToast);

  // --- 3. creating an event takes the first automatic snapshot ---------------
  await createBlankEvent(page, { name: "Recovery Check", hotel: "Merit Royal", date: futureDate() });
  await page.waitForTimeout(700);
  const firstSnap = await page.evaluate(() => MERIT_STORAGE_PROVIDER.load("autosnapshots"));
  checks.require(Array.isArray(firstSnap) && firstSnap.length === 1,
    "exactly one automatic snapshot exists after the very first save", firstSnap);
  const firstSnapEvents = JSON.parse(firstSnap[0].payload).events.map(e => e.name);
  checks.ok(firstSnapEvents.includes("Recovery Check"),
    "the snapshot's own payload really contains the event just created", firstSnapEvents);

  // --- 4. a second save moments later does not duplicate it ------------------
  await page.evaluate(() => { const e = state.events[0]; e.name = "Recovery Check Renamed"; touchEvent(e); });
  await page.waitForTimeout(500);
  const afterSecondSave = await page.evaluate(() => MERIT_STORAGE_PROVIDER.load("autosnapshots"));
  checks.equal(afterSecondSave.length, 1,
    "still exactly one snapshot — the throttle is real, not cosmetic", afterSecondSave.length);
  checks.ok(!JSON.parse(afterSecondSave[0].payload).events[0].name.includes("Renamed"),
    "and the kept snapshot is still the earlier moment, not silently refreshed", afterSecondSave[0].payload);

  // --- 5. independent storage: a corrupted primary record is not fatal ------
  // A plain page.reload() would not prove this: app-guests.js registers a
  // beforeunload handler that calls saveState() with whatever good in-memory
  // state the page still holds, silently healing the corruption before the
  // new document even starts loading. A second, fresh page in the SAME
  // browser context reads the SAME storage without ever touching page's
  // document (or its beforeunload handler) at all.
  await page.evaluate(() => MERIT_STORAGE_PROVIDER.save("{not valid json"));
  const stillHasSnapshot = await page.evaluate(() => MERIT_STORAGE_PROVIDER.load("autosnapshots"));
  checks.ok(Array.isArray(stillHasSnapshot) && stillHasSnapshot.length === 1,
    "corrupting the primary record does not touch the automatic snapshot living under its own key", stillHasSnapshot);

  const page2 = await context.newPage();
  await openApp(page2, baseUrl, { lang: "en" });
  await page2.waitForTimeout(500);
  const afterCorruption = await page2.evaluate(() => ({
    events: state.events.map(e => e.name),
    toast: document.getElementById("toastWrap")?.textContent || "",
  }));
  checks.ok(afterCorruption.events.includes("Recovery Check"),
    "with the primary record corrupted, a fresh load recovers the event from the automatic snapshot instead of booting blank", afterCorruption.events);
  checks.ok(/could not be loaded normally|Recovered automatically|yüklenemedi/i.test(afterCorruption.toast),
    "and says so plainly — this is never a silent swap to a blank slate", afterCorruption.toast);

  // --- 6. deliberate manual restore is confirmed, like a backup file ---------
  // Continue on page2, which now holds the recovered state. Make one more
  // real change, let it save, then use the appbar control to go back to the
  // automatic snapshot on purpose (the scenario: undo did not reach far
  // enough back).
  page2.on("dialog", d => d.accept());
  await autoAnswer(page2);
  await page2.evaluate(() => { const e = state.events[0]; e.name = "Post-Recovery Edit"; touchEvent(e); });
  await page2.waitForTimeout(300);
  const beforeManualRestore = await page2.evaluate(() => state.events[0].name);
  checks.equal(beforeManualRestore, "Post-Recovery Edit", "the post-recovery edit really landed first");

  // page2 booted straight onto the Events/Home screen (ui.screen defaults to
  // "events"; nothing here ever opened the event's workspace), where the
  // recovery control already lives — no navigation needed.
  await click(page2, '[data-action="recovery-restore"]');
  await page2.waitForTimeout(500);
  const afterManualRestore = await page2.evaluate(() => ({
    events: state.events.map(e => e.name),
    toast: document.getElementById("toastWrap")?.textContent || "",
  }));
  checks.ok(afterManualRestore.events.includes("Recovery Check") && !afterManualRestore.events.includes("Post-Recovery Edit"),
    "the manual restore replaced current state with the recovery point, confirmed first (dialog auto-accepted)", afterManualRestore.events);
  checks.ok(/Restored from|geri yüklendi/i.test(afterManualRestore.toast),
    "and the operator is told what happened", afterManualRestore.toast);

  // --- 7. both languages, no raw keys, EN really differs from TR -------------
  const words = await page2.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; render();
      out[lang] = document.querySelector('[data-action="recovery-restore"]')?.title || "";
    }
    ui.lang = "en"; render();
    return out;
  });
  checks.ok(words.en && words.tr, "both languages have a real button title", words);
  checks.ok(words.en !== words.tr, "and Turkish is really Turkish", words);

  // --- 8. recovery-of-recovery: the safety net's OWN slot corrupted too ------
  // (Section 17.) Check 5 corrupts the primary record while the snapshot is
  // fine. This corrupts BOTH -- the one scenario neither this suite nor
  // backup-restore.test.mjs exercised -- and proves boot still degrades to
  // an honest blank slate instead of throwing. loadV8Async()'s own snapshot
  // read (src/app-v8.js) is already wrapped in a try/catch for exactly this
  // ("a snapshot that itself fails to parse is treated the same as none"),
  // and MeritOfflineRecovery.latestSnapshot() already returns null for
  // anything that isn't a real array -- this is a missing test for existing
  // protection, not a new code path.
  await page2.evaluate(() => MERIT_STORAGE_PROVIDER.save("{not valid json"));
  await page2.evaluate(() => MERIT_STORAGE_PROVIDER.save("{not valid json either", "autosnapshots"));
  const page3 = await context.newPage();
  const pageErrors = [];
  page3.on("pageerror", (err) => pageErrors.push(err.message));
  await openApp(page3, baseUrl, { lang: "en" });
  await page3.waitForTimeout(500);
  const afterDoubleCorruption = await page3.evaluate(() => ({
    eventsLen: state.events.length,
    toast: document.getElementById("toastWrap")?.textContent || "",
  }));
  checks.equal(pageErrors.length, 0,
    "booting with BOTH the primary record and the automatic snapshot corrupted throws nothing", pageErrors);
  checks.equal(afterDoubleCorruption.eventsLen, 0,
    "and degrades to the correct, honest blank slate rather than a half-built or crashed screen", afterDoubleCorruption);
  await page2.close().catch(() => {});
  await page3.close().catch(() => {});
}
