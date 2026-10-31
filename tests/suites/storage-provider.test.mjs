// Where the data actually lives, and whether it survives.
//
// The original scratchpad version of this only printed what it found, so it
// could not fail. It is asserted here because the migration from localStorage
// to IndexedDB is exactly the kind of change that appears to work in one
// session and loses a venue's event list in the next.
import { openApp, createBlankEvent, addTables, addGuest, gotoTab, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "storage-provider", tags: ["storage", "fast"], timeout: 90000 };

const DB_NAME = "meritEventMaker";

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const status = await page.evaluate(() => globalThis.MERIT_STORAGE_STATUS || null);
  checks.require(status && typeof status.provider === "string",
    "the app reports which storage provider it selected", status);
  checks.ok(status.provider === "IndexedDBStorageProvider",
    "IndexedDB is the active provider in a normal browser — not the localStorage fallback", status);

  await createBlankEvent(page, { name: "StorageCheck", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 2 });
  await gotoTab(page, "guests");
  await addGuest(page, { name: "PERSISTED GUEST", additionalGuests: 2 });
  await page.waitForTimeout(600);

  // Read the database directly rather than trusting the app's own accessor:
  // the question is whether the bytes reached the store, not whether the app
  // can still see its in-memory copy.
  const stored = await page.evaluate(async dbName => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const raw = await new Promise((res, rej) => {
      const tx = db.transaction("state", "readonly");
      const req = tx.objectStore("state").get("root");
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    db.close();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ev = parsed.events && parsed.events[0];
    return ev ? { name: ev.name, tables: ev.tables.length, guests: ev.guests.map(g => ({ name: g.name, pax: g.pax })) } : null;
  }, DB_NAME);

  checks.require(stored, "the event reached IndexedDB, not just memory", stored);
  checks.ok(stored.name === "StorageCheck" && stored.tables === 2, "tables persisted with the event", stored);
  checks.ok(stored.guests.some(g => g.name === "PERSISTED GUEST" && g.pax === 3),
    "the guest persisted with its party size intact", stored.guests);

  const legacy = await page.evaluate(() => localStorage.getItem("meritEventMaker.v8"));
  checks.ok(legacy === null,
    "the legacy localStorage key is not being written in parallel — one store, one source of truth",
    legacy === null ? null : "still present");

  // --- the round trip that matters -----------------------------------------
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
  const reloaded = await page.evaluate(() => {
    const e = state.events[0];
    return e ? {
      count: state.events.length, name: e.name, tables: e.tables.length,
      chairs: e.tables.map(t => t.chairs.length), capacities: e.tables.map(t => t.capacity),
      guest: e.guests[0] && { name: e.guests[0].name, pax: e.guests[0].pax, additional: e.guests[0].additionalGuests },
    } : null;
  });
  checks.require(reloaded, "state came back after a full page reload", reloaded);
  checks.ok(reloaded.count === 1 && reloaded.name === "StorageCheck", "the event survived the reload", reloaded);
  checks.ok(reloaded.chairs.every((c, i) => c === reloaded.capacities[i]),
    "chairs and capacity are still in sync after a save/load round trip", reloaded);
  checks.ok(reloaded.guest && reloaded.guest.pax === 3 && reloaded.guest.additional === 2,
    "the guest's party size survived serialisation", reloaded.guest);

  // --- write ordering (Section 13) ------------------------------------------
  // storageProvider.save() is async -- IndexedDBStorageProvider opens its own
  // connection per call -- so two overlapping saveState() calls race on which
  // write actually lands last. saveQueue (app-v8.js) fixes this by chaining
  // every save onto the one before it. To prove that deterministically
  // (real IndexedDB is fast enough in a test run that the two calls' opens
  // rarely land out of order on their own), indexedDB.open is wrapped so the
  // FIRST call after this point resolves slower than the second -- exactly
  // the shape of hazard a real browser could produce under load. Without the
  // queue, the fast second write lands first and the slow first write then
  // overwrites it moments later with stale data.
  //
  // Read the raw IndexedDB record directly rather than reloading the page:
  // a reload also fires the app's own unconditional beforeunload->saveState(),
  // which would re-persist the in-memory value (never itself corrupted --
  // only the earlier WRITE ORDER was wrong) and mask exactly the storage-layer
  // corruption this check exists to catch.
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    const origOpen = indexedDB.open.bind(indexedDB);
    let callIndex = 0;
    indexedDB.open = function (name, version) {
      const idx = callIndex++;
      const real = origOpen(name, version);
      const fake = {};
      real.onupgradeneeded = (ev) => { if (fake.onupgradeneeded) fake.onupgradeneeded(ev); };
      real.onblocked = (ev) => { if (fake.onblocked) fake.onblocked(ev); };
      real.onerror = () => {
        const fire = () => { fake.error = real.error; if (fake.onerror) fake.onerror(); };
        idx === 0 ? setTimeout(fire, 250) : fire();
      };
      real.onsuccess = () => {
        const fire = () => { fake.result = real.result; if (fake.onsuccess) fake.onsuccess(); };
        idx === 0 ? setTimeout(fire, 250) : fire();
      };
      return fake;
    };
    const e = state.events[0];
    e.name = "RACE-FIRST"; saveState();   // queued first, but its own connection opens slower
    e.name = "RACE-SECOND"; saveState();  // queued second, opens fast
    await new Promise((r) => setTimeout(r, 600));
    indexedDB.open = origOpen;
  });
  const raceResult = await page.evaluate(async (dbName) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const raw = await new Promise((res, rej) => {
      const tx = db.transaction("state", "readonly");
      const req = tx.objectStore("state").get("root");
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
    db.close();
    return JSON.parse(raw).events[0].name;
  }, DB_NAME);
  checks.ok(raceResult === "RACE-SECOND",
    "the write made second is what's actually stored, even though its own storage connection opened faster than the write made first",
    raceResult);
}
