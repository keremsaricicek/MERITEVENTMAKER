// Section 22: what the saveState() write queue costs under burst mutation.
//
// Section 13 made saveState() serialise its writes. Before, every call fired
// storageProvider.save() immediately, each opening its own IndexedDB
// connection; transaction ordering then followed db.transaction() creation
// time rather than saveState() call order, so two saves issued microseconds
// apart could land in the wrong order and persist a stale state over a fresh
// one. Now each call chains onto a promise queue, which makes last-call-wins
// structural.
//
// That fix has a cost the existing harness cannot see. stress-4000-seats.mjs
// times saveState() as `p.evaluate(() => { saveState(); })` -- the
// SYNCHRONOUS part only: JSON.stringify plus appending to the queue. It
// returns before a single byte reaches IndexedDB. So the number it reports is
// blind to the queue by construction, and the two things a queue actually
// risks go unmeasured:
//
//   1. DRAIN TIME. N queued writes now run strictly one after another instead
//      of overlapping. A burst of mutations -- dragging a table across the
//      canvas, a bulk check-in loop -- could leave writes landing long after
//      the operator has moved on, or (worse) still draining when the tab is
//      closed.
//   2. RETAINED MEMORY. Each queued call captures its own full
//      JSON.stringify(state) payload in a closure and holds it until its turn
//      comes. On a 4,000-seat event that is a multi-MB string per queued
//      entry, alive simultaneously. Unqueued, each payload was released as
//      soon as its own save resolved.
//
// This runner measures both, on the real 4,000-seat dataset, against the real
// storage layer -- and measures them BEFORE and AFTER by rebuilding the
// unqueued saveState() in the page and running the identical burst through
// it. A claim that the queue is cheap is worth nothing without the number it
// replaced.
//
// It also checks the thing the queue exists for: after the burst drains, the
// record on disk must hold the LAST value written, not whichever write won a
// race.
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import { routeVendorFromCache } from "../../tests/lib/vendor.mjs";

const DB_NAME = "meritEventMaker";
const DB_VERSION = 2;
const STORE = "state";
const BURST = 40;

const app = await serveApp();
const b = await launchChromium();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await routeVendorFromCache(p);
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => { if (m.type() === "error" && !/404|ERR_TUNNEL/.test(m.text())) errs.push("console: " + m.text()); });

await p.goto(app.baseUrl + "/index.html");
await p.waitForLoadState("networkidle");
await p.click('.appbar [data-action="create-event"]');
await p.waitForTimeout(300);
await p.fill('input[name="name"]', "Save Queue Burst");
await p.fill('input[name="hotel"]', "Merit Arena");
await p.fill('input[name="date"]', "2026-12-31");
await p.click('button[data-setup="blank"]');
await p.waitForTimeout(700);

// ---- the 4,000-seat dataset ------------------------------------------------
// Byte-for-byte the builder in stress-4000-seats.mjs, so both runners measure
// the same event rather than two similar-sounding ones.
const built = await p.evaluate(() => {
  const e = state.events[0];
  const TABLES = 400, SEATS = 10;            // 4,000 physical chairs
  const tables = [];
  for (let i = 0; i < TABLES; i++) {
    const col = i % 20, row = Math.floor(i / 20);
    const t = { id: "tbl" + i, number: "T" + String(i + 1).padStart(3, "0"),
      type: i % 4 === 0 ? "round" : i % 4 === 1 ? "square" : i % 4 === 2 ? "rectangle" : "bistro",
      x: 120 + col * 160, y: 120 + row * 150, w: 120, h: 110, capacity: SEATS, zone: "MAIN FLOOR",
      rotation: 0, locked: false, z: 10, hasPhysicalSeats: true, chairs: [] };
    for (let s = 0; s < SEATS; s++) {
      const ang = s / SEATS * Math.PI * 2;
      t.chairs.push({ id: "ch" + i + "_" + s, parentTableId: t.id, seatNumber: s + 1,
        x: 50 + Math.cos(ang) * 46, y: 50 + Math.sin(ang) * 46, rotation: 0, occupancy: null });
    }
    tables.push(t);
  }
  e.tables = tables;
  const vips = ["Standard", "VIP", "VVIP"], plan = ["Confirmed", "Tentative"], arr = ["Not Arrived", "Checked In", "No Show"];
  const guests = [];
  for (let i = 0; i < 3000; i++) {
    const add = i % 5 === 0 ? (i % 4) + 1 : 0;
    guests.push({ id: "g" + i, name: "GUEST " + String(i + 1).padStart(4, "0"),
      additionalGuests: add, pax: 1 + add,
      planningStatus: plan[i % 2], vip: vips[i % 3], arrivalStatus: arr[i % 3],
      invitedBy: "Host " + (i % 40), notes: "", assignment: null, createdAt: new Date().toISOString() });
  }
  e.guests = guests;
  return { tables: e.tables.length, chairs: e.tables.reduce((n, t) => n + t.chairs.length, 0),
    guests: e.guests.length, pax: e.guests.reduce((n, g) => n + g.pax, 0) };
});
console.log("DATASET:", JSON.stringify(built));

// Payload size is what the queue holds a copy of per entry -- report it, so
// the retained-memory numbers below have a unit rather than a vibe.
const payloadMB = await p.evaluate(() => JSON.stringify(state).length / (1024 * 1024));
console.log(`PAYLOAD: ${payloadMB.toFixed(2)} MB per queued save`);

// ---- the burst ------------------------------------------------------------
// Fires BURST saveState() calls back to back, each tagged with a distinct
// event name, then polls the RAW IndexedDB record until the LAST tag appears.
// Polling the record rather than awaiting an internal handle is deliberate:
// saveQueue lives inside app-v8.js's IIFE and is not reachable from here, and
// the record is what an operator's data actually is.
// Chromium keeps the previous burst's garbage around until it feels like
// collecting. Without an explicit collection between runs, the second burst
// starts on the first one's residue and its "before" is meaningless -- which
// is exactly what the first version of this runner reported. CDP's
// HeapProfiler.collectGarbage forces a real collection with no launch flags.
const cdp = await p.context().newCDPSession(p);
await cdp.send("HeapProfiler.enable");
async function forceGC() {
  await cdp.send("HeapProfiler.collectGarbage");
  await p.waitForTimeout(250);
}

async function burst(label) {
  await forceGC();
  const before = await p.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : 0);
  const t0 = Date.now();
  const peak = await p.evaluate(({ n, tag }) => {
    const event = state.events[0];
    let peakHeap = 0;
    for (let i = 0; i < n; i++) {
      event.name = `${tag}-${i}`;
      saveState();
      if (performance.memory) peakHeap = Math.max(peakHeap, performance.memory.usedJSHeapSize);
    }
    return peakHeap;
  }, { n: BURST, tag: label });
  const syncMs = Date.now() - t0;

  const want = `${label}-${BURST - 1}`;
  let drained = null;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const onDisk = await p.evaluate(({ dbName, dbVersion, store }) => new Promise((resolve) => {
      const req = indexedDB.open(dbName, dbVersion);
      req.onsuccess = () => {
        const db = req.result;
        const g = db.transaction(store, "readonly").objectStore(store).get("root");
        g.onsuccess = () => {
          db.close();
          try { resolve(JSON.parse(g.result).events[0].name); } catch { resolve(null); }
        };
        g.onerror = () => { db.close(); resolve(null); };
      };
      req.onerror = () => resolve(null);
    }), { dbName: DB_NAME, dbVersion: DB_VERSION, store: STORE });
    if (onDisk === want) { drained = Date.now() - t0; break; }
    await p.waitForTimeout(25);
  }

  const after = await p.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : 0);
  const finalOnDisk = await p.evaluate(({ dbName, dbVersion, store }) => new Promise((resolve) => {
    const req = indexedDB.open(dbName, dbVersion);
    req.onsuccess = () => {
      const db = req.result;
      const g = db.transaction(store, "readonly").objectStore(store).get("root");
      g.onsuccess = () => { db.close(); try { resolve(JSON.parse(g.result).events[0].name); } catch { resolve(null); } };
      g.onerror = () => { db.close(); resolve(null); };
    };
    req.onerror = () => resolve(null);
  }), { dbName: DB_NAME, dbVersion: DB_VERSION, store: STORE });

  return {
    syncMs, drainMs: drained, finalOnDisk, lastWins: finalOnDisk === want,
    heapBeforeMB: before / (1024 * 1024), heapPeakMB: peak / (1024 * 1024), heapAfterMB: after / (1024 * 1024),
  };
}

// saveState() is still the app's own at this point — nothing has replaced it.
const queuedA = await burst("QUEUEDA");

// ---- rebuild the pre-Section-13 saveState and run the identical burst ------
// Not a description of the old code: the old body, restored in the page. It
// is short enough to state exactly -- stringify, then save immediately, with
// no queue and no chaining -- which is precisely the behaviour Section 13
// replaced.
// Two things in the real saveState() are const/function declarations inside
// app-v8.js's IIFE and cannot be reached from here: the storageProvider
// instance and refreshChairOccupancy(). The provider is rebuilt from the same
// class the app itself picks, so the write path is identical. The
// refreshChairOccupancy() pass cannot be, so it is simply absent from the
// unqueued side.
//
// That makes the unqueued SYNC number an under-estimate -- it does strictly
// less work per call than the queued side it is being compared against. The
// bias runs in favour of the old code, which is the safe direction: if the
// queued path still holds up against an opponent given a head start, the
// conclusion survives. The drain and heap numbers, which are what this runner
// exists for, are unaffected either way -- neither depends on that pass.
const useUnqueued = () => p.evaluate(() => {
  if (!globalThis.__origSaveState) globalThis.__origSaveState = saveState;
  if (!globalThis.__unqueuedSaveState) {
    const sp = new MeritStorageProviders.IndexedDBStorageProvider();
    globalThis.__unqueuedSaveState = function () {
      let payload;
      try { payload = JSON.stringify(state); } catch { return; }
      sp.save(payload).catch(() => {});
    };
  }
  saveState = globalThis.__unqueuedSaveState;
});
const useQueued = () => p.evaluate(() => { saveState = globalThis.__origSaveState; });

await useUnqueued();
const unqueuedA = await burst("UNQUEUEDA");

// Second pass in the OPPOSITE order. A single A-then-B run cannot tell a real
// difference from an artifact of going second -- warmed JIT, a grown heap, an
// IndexedDB file that has already been extended on disk. Running the pair
// again reversed is the cheapest way to find out, and if the two passes
// disagree about the direction then this runner has measured the order, not
// the queue, and the output says so instead of picking a winner.
await useUnqueued();
const unqueuedB = await burst("UNQUEUEDB");
await useQueued();
const queuedB = await burst("QUEUEDB");

// ---- report ---------------------------------------------------------------
const row = (label, r) =>
  `  ${label.padEnd(10)} sync ${String(r.syncMs).padStart(5)} ms   drain ${String(r.drainMs ?? "TIMEOUT").padStart(6)} ms   ` +
  `heap ${r.heapBeforeMB.toFixed(1)}→${r.heapPeakMB.toFixed(1)}→${r.heapAfterMB.toFixed(1)} MB   last-write-wins ${r.lastWins ? "YES" : "NO (" + r.finalOnDisk + ")"}`;

console.log(`\n=== ${BURST} back-to-back saveState() calls on a 4,000-seat event ===`);
console.log("  pass 1 — queued first:");
console.log(row("QUEUED", queuedA));
console.log(row("UNQUEUED", unqueuedA));
console.log("  pass 2 — unqueued first:");
console.log(row("UNQUEUED", unqueuedB));
console.log(row("QUEUED", queuedB));
console.log("\n  sync  = the main-thread cost the operator feels (stringify + dispatch).");
console.log("          UNQUEUED omits refreshChairOccupancy (IIFE-scoped, unreachable),");
console.log("          so its sync figure is an under-estimate — biased toward the old code.");
console.log("  drain = until the LAST value is actually the record on disk");
console.log("  heap  = before → peak during the burst → after it drained");

console.log("\nERRORS:", errs.length ? errs : "clean");

// The only assertion. Timings are measurements and this environment is shared,
// so they are reported rather than gated -- but the queue exists to make the
// last write win, and if it ever stops doing that the fix is gone.
const drainAgrees = (queuedA.drainMs < unqueuedA.drainMs) === (queuedB.drainMs < unqueuedB.drainMs);
const syncAgrees = (queuedA.syncMs < unqueuedA.syncMs) === (queuedB.syncMs < unqueuedB.syncMs);
console.log(`\n  ORDER CONTROL: drain direction ${drainAgrees ? "agrees" : "DISAGREES"} across the two passes; ` +
  `sync direction ${syncAgrees ? "agrees" : "DISAGREES"}.`);
if (!drainAgrees || !syncAgrees) {
  console.log("  A disagreement means this measured run order, not the queue — do not quote a winner from it.");
}

let failed = 0;
for (const [label, r] of [["pass 1", queuedA], ["pass 2", queuedB]]) {
  if (!r.lastWins) { console.log(`\nFAIL: the queued burst (${label}) did not leave the last write on disk.`); failed++; }
  if (r.drainMs === null) { console.log(`\nFAIL: the queued burst (${label}) never drained within 120s.`); failed++; }
}

await b.close();
await app.close();
process.exit(failed ? 1 : 0);
