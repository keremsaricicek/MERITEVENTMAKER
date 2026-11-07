// WHEN DOES A SAVE ACTUALLY LAND, AND WHICH ONE WINS?
//
// `storageProvider.save()` is async — IndexedDBStorageProvider opens its own
// connection per call — so two saves issued close together are two races: one
// for which STARTS first and one for which LANDS last. `saveQueue` already
// chained them, which fixed the ordering. Three things it did not fix:
//
//   NO CALLER CAN WAIT FOR A SAVE. `saveState()` chained onto the queue and
//   returned `undefined`, so `await saveState()` waited for nothing at all
//   and resolved before a single byte had been written. This was found by a
//   test that read storage straight after "awaiting" a save and got an empty
//   store — and a test can work around it by polling. A caller that needs to
//   know the write landed (an export about to hand the operator a file, a
//   close confirmation) cannot.
//
//   A BURST WRITES EVERY SNAPSHOT. Each payload is a COMPLETE picture of
//   `state`, so twenty saves in a burst serialise and write twenty full
//   copies of the same room, of which nineteen are superseded before anyone
//   reads them. A save that has not started yet is not partial work worth
//   preserving; it is an older photograph of the same subject.
//
//   THE RETRY WROTE SOMETHING ELSE. When a save failed, the image-stripping
//   retry rebuilt its payload from the LIVE `state` rather than from the
//   payload it had been handed. "This save writes this snapshot" is the one
//   promise the queue exists to keep, and the failure path broke it.
//
// Coalescing must not weaken last-write-wins: the newest snapshot still lands
// last, and every check below is written to fail if it ever does not.
import { openApp, createBlankEvent, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "save-ordering", tags: ["business", "fast"], timeout: 120000 };

// Reads the raw record, never through a reload: a reload fires the app's own
// beforeunload -> saveState(), which would re-persist memory and mask exactly
// the storage-layer disagreement these checks look for.
const READ = `(async () => {
  const raw = await MERIT_STORAGE_PROVIDER.load();
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
})()`;

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Save Ordering", hotel: "Merit Royal", date: futureDate() });
  await settle(page);

  // --- 1. a save can be awaited -------------------------------------------
  const awaited = await page.evaluate(async () => {
    const e = state.events[0];
    e.name = "Awaited Name";
    const returned = saveState();
    const isThenable = !!returned && typeof returned.then === "function";
    await returned;
    // NO polling. If saveState() is awaitable, the record is already there.
    const raw = await MERIT_STORAGE_PROVIDER.load();
    const root = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { isThenable, stored: root?.events?.[0]?.name || null };
  });
  checks.ok(awaited.isThenable,
    "saveState() hands back the queued write. It returned undefined, so `await saveState()` waited for nothing and resolved before anything was written",
    awaited.isThenable);
  checks.equal(awaited.stored, "Awaited Name",
    "and awaiting it is enough on its own — the record is on disk with no polling, no timeout and no guessed delay", awaited.stored);

  // --- 2. last-write-wins survives a storage layer that reorders ------------
  // The first write is made deliberately SLOW and the second fast. Without
  // ordering, the fast one lands first and the slow one overwrites it with
  // older content — the exact race the queue exists to prevent.
  const ordered = await page.evaluate(async () => {
    const provider = MERIT_STORAGE_PROVIDER;
    const real = provider.save.bind(provider);
    const landed = [];
    let call = 0;
    provider.save = (payload, key) => {
      const n = ++call;
      const delay = n === 1 ? 250 : 0;   // first save is the slow one
      return new Promise((resolve) => setTimeout(resolve, delay))
        .then(() => real(payload, key))
        .then((r) => { if (key === undefined) landed.push(n); return r; });
    };
    const e = state.events[0];
    e.name = "FIRST"; const a = saveState();
    e.name = "SECOND"; const b = saveState();
    await Promise.all([a, b]);
    provider.save = real;
    const raw = await provider.load();
    const root = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { landed, stored: root?.events?.[0]?.name || null };
  });
  checks.equal(ordered.stored, "SECOND",
    "the newest snapshot is what storage holds, even though its write was issued while a much slower one was still in flight", ordered.stored);
  checks.ok(ordered.landed.join(",") === "1,2" || ordered.landed.join(",") === "1",
    "and the writes reached storage in the order they were issued, rather than in the order the storage layer happened to finish them",
    ordered.landed);

  // --- 3. a burst of saves collapses to the ones that matter ---------------
  // Twenty complete snapshots of the same room, nineteen of them superseded
  // before anybody could read them.
  const burst = await page.evaluate(async () => {
    const provider = MERIT_STORAGE_PROVIDER;
    const real = provider.save.bind(provider);
    let writes = 0;
    provider.save = (payload, key) => {
      if (key === undefined) writes++;
      return new Promise((r) => setTimeout(r, 12)).then(() => real(payload, key));
    };
    const e = state.events[0];
    const promises = [];
    for (let i = 0; i < 20; i++) { e.name = "Burst " + i; promises.push(saveState()); }
    await Promise.all(promises);
    provider.save = real;
    const raw = await provider.load();
    const root = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { writes, stored: root?.events?.[0]?.name || null, memory: state.events[0].name };
  });
  checks.equal(burst.writes, 1,
    "twenty saves issued in ONE tick become exactly one write. They are twenty complete snapshots of the same room and nineteen are superseded before anybody could read them — a snapshot that has not started yet is an older photograph of the same subject, not work to preserve",
    burst.writes);
  checks.equal(burst.stored, "Burst 19",
    "and coalescing does NOT weaken last-write-wins — the final snapshot is exactly what landed", burst.stored);
  checks.equal(burst.stored, burst.memory,
    "storage and memory agree at the end of the burst", { stored: burst.stored, memory: burst.memory });

  // --- 3b. saves genuinely separated in time are NOT collapsed -------------
  // The opposite failure, and a worse one: a queue that folded every save
  // into the last would drop writes an operator had waited for. Coalescing
  // may only ever absorb a payload that has not started.
  const sequential = await page.evaluate(async () => {
    const provider = MERIT_STORAGE_PROVIDER;
    const real = provider.save.bind(provider);
    const seen = [];
    provider.save = (payload, key) => {
      if (key === undefined) { try { seen.push(JSON.parse(payload).events[0].name); } catch { seen.push("?"); } }
      return real(payload, key);
    };
    const e = state.events[0];
    for (let i = 0; i < 3; i++) { e.name = "Step " + i; await saveState(); }
    provider.save = real;
    return seen;
  });
  checks.equal(sequential.length, 3,
    "three saves, each awaited before the next was issued, produce three writes — nothing was folded away", sequential);
  checks.equal(sequential.join(","), "Step 0,Step 1,Step 2",
    "and each wrote its own snapshot, in the order it was issued", sequential);

  // --- 4. a failing write never stalls the ones behind it ------------------
  const afterFailure = await page.evaluate(async () => {
    const provider = MERIT_STORAGE_PROVIDER;
    const real = provider.save.bind(provider);
    let failNext = true;
    provider.save = (payload, key) => {
      if (key === undefined && failNext) { failNext = false; return Promise.reject(new Error("quota")); }
      return real(payload, key);
    };
    const e = state.events[0];
    e.name = "AFTER FAILURE";
    await saveState();
    e.name = "AFTER FAILURE 2";
    await saveState();
    provider.save = real;
    const raw = await provider.load();
    const root = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { stored: root?.events?.[0]?.name || null };
  });
  checks.equal(afterFailure.stored, "AFTER FAILURE 2",
    "a save that fails does not break the chain — everything queued behind it still lands, and the newest still wins", afterFailure.stored);

  // --- 5. the retry writes the SNAPSHOT IT WAS GIVEN -----------------------
  // The image-stripping retry rebuilt its payload from live `state`. So a
  // save of one event, failing while a second event had since been added in
  // memory, wrote TWO events — a snapshot nobody had asked to persist, under
  // the identity of a save that was supposed to write one.
  const retryPayload = await page.evaluate(async () => {
    const provider = MERIT_STORAGE_PROVIDER;
    const real = provider.save.bind(provider);
    // Start from a known single-event state.
    state.events = [state.events[0]];
    await saveState();

    let failNext = true;
    let sneaked = false;
    provider.save = (payload, key) => {
      if (key !== undefined) return real(payload, key);
      if (failNext) {
        failNext = false;
        // Mutate memory AFTER the payload was captured and BEFORE the retry
        // rebuilds one. A retry that reads live state picks this up.
        if (!sneaked) {
          sneaked = true;
          state.events = [...state.events, { id: "sneaked", name: "Sneaked In", hotel: "", salon: "",
            date: "2099-12-31", status: "Planning", tables: [], guests: [], venueObjects: [],
            freezes: [], handoverNotes: [], createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString() }];
        }
        return Promise.reject(new Error("quota"));
      }
      return real(payload, key);
    };
    await saveState();
    provider.save = real;
    const raw = await provider.load();
    const root = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { storedEvents: (root?.events || []).length, memoryEvents: state.events.length,
      storedIds: (root?.events || []).map(e => e.id) };
  });
  checks.equal(retryPayload.memoryEvents, 2,
    "memory really did change while the save was in flight", retryPayload.memoryEvents);
  checks.equal(retryPayload.storedEvents, 1,
    "but the retry wrote the snapshot its save was handed, not whatever `state` had become. Rebuilding the payload from live state made a failed save persist a picture nobody asked for",
    retryPayload);
  checks.ok(!retryPayload.storedIds.includes("sneaked"),
    "so the event added mid-flight is not in that record", retryPayload.storedIds);

  // --- 6. after a reload, memory equals what was stored --------------------
  const reloadEquality = await page.evaluate(async () => {
    state.events = state.events.filter(e => e.id !== "sneaked");
    const e = state.events[0];
    e.name = "Reload Equality";
    e.guests = Array.from({ length: 40 }, (_, i) => ({
      id: "rg" + i, name: "Guest " + i, additionalGuests: i % 3, pax: 1 + (i % 3),
      vip: "Standard", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, notes: "", invitedBy: "", checkedInAt: null,
    }));
    // A burst, then one await: if saveState() is awaitable and ordered, this
    // is all a caller should ever need to do.
    for (let i = 0; i < 10; i++) { e.salon = "Hall " + i; saveState(); }
    await saveState();
    return { name: e.name, salon: e.salon, guests: e.guests.length, events: state.events.length };
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  const afterReload = await page.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      if (state.events.length && state.events[0].guests) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const e = state.events[0] || {};
    return { name: e.name || null, salon: e.salon || null,
      guests: (e.guests || []).length, events: state.events.length };
  });
  checks.equal(afterReload.name, reloadEquality.name, "the event name survived the reload", afterReload);
  checks.equal(afterReload.salon, reloadEquality.salon,
    "including the LAST value of a field written ten times in a burst — coalescing kept the newest, not an arbitrary one of them",
    { stored: afterReload.salon, expected: reloadEquality.salon });
  checks.equal(afterReload.guests, reloadEquality.guests, "and all forty guests", afterReload);
  checks.equal(afterReload.events, reloadEquality.events, "with no event lost or duplicated", afterReload);
}
