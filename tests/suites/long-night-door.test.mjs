// TWO HOURS AT THE DOOR, COMPRESSED — AND THE TAB CLOSED MID-CHECK-IN.
//
// Pre-Windows health check (2026-11-07, benchmarks/HEALTH-2026-11.md). A gala's
// door is thousands of small writes on one open page: check in, take it back,
// No Show, a wrong person corrected. Nothing ran that many on one page and
// then asked whether the page had grown, whether listeners piled up, and
// whether the figures on screen still equal a recount from the records.
//
//   PART 1 — 3,000 door operations through the Live screen's real controls
//   (row buttons, Recent's Undo, the search + Enter path), chosen by a seeded
//   generator. A shadow of what each operation should do is kept beside it,
//   and at the end every guest's arrival must equal the shadow, every planned
//   seat must equal the one it had before the night began (No Show keeps the
//   planned seat), the audit trail must hold one entry per change, and the
//   figures on screen must equal a recount. Heap (after a forced GC) and the
//   renderer's own DOM counters (nodes, JS event listeners) are sampled after
//   a warm-up and every 500 operations; their growth is held under bounds
//   stated below from what was measured.
//
//   PART 2 — the tab closes the instant after a door click, before IndexedDB
//   could commit (the write is made to never land: `tests/lib/faults.mjs`
//   "lost"). After the reload the arrival is there ONCE — one audit entry, one
//   checked-in record, the same figures — and a second reload (the close-time
//   snapshot read again) does not apply it twice. Enter on the same guest at
//   the door says "already checked in" and changes nothing.
import { click, openApp, createBlankEvent, gotoTab, settle } from "../lib/app-actions.mjs";
import { installStorageFaults, setFault, bootApp } from "../lib/faults.mjs";

export const meta = { name: "long-night-door", tags: ["business", "resilience", "performance", "slow"], timeout: 900000 };

const RECORDS = 600, TABLES = 50, SEATS = 24, OPS = 3000, WARMUP = 250, SAMPLE_EVERY = 500;
// Bounds, from what was measured 2026-11-07 (HEALTH-2026-11.md). The heap
// legitimately grows by the audit trail (one entry per change, ~3,000 here);
// anything past that is a leak.
const HEAP_GROWTH_MB = 8;
const LISTENER_GROWTH = 50;
const NODE_GROWTH = 500;

export default async function run({ page, checks, baseUrl }) {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await installStorageFaults(page);
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Long Night" });

  // --- the room and the list, through the real paths ------------------------
  await click(page, ".planmap-fab");
  await page.waitForSelector('[data-v8-action="commit-add"]', { timeout: 10000 });
  await page.fill('[data-bulk="quantity"]', String(TABLES));
  await page.fill('[data-bulk="chairs"]', String(SEATS));
  await page.dispatchEvent('[data-bulk="chairs"]', "change");
  await page.waitForTimeout(150);
  await click(page, '[data-v8-action="commit-add"]');
  await page.waitForFunction((n) => activeEvent().tables.length >= n, TABLES, { timeout: 20000 });
  await gotoTab(page, "guests");
  const lines = ["NAME SURNAME,ADDITIONAL GUESTS,STATUS"];
  for (let i = 0; i < RECORDS; i++) lines.push(`Misafir ${String(i).padStart(4, "0")} Kapı,${i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0},Confirmed`);
  await click(page, "[data-guest-command='import']");
  await page.setInputFiles("#guestFileInput", { name: "door.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
  await page.waitForSelector("[data-wizard-next]");
  for (let i = 0; i < 3; i++) { await click(page, "[data-wizard-next]"); await page.waitForTimeout(150); }
  await page.waitForSelector("[data-wizard-import]:not([disabled])", { timeout: 30000 });
  await click(page, "[data-wizard-import]");
  await page.waitForFunction((n) => activeEvent().guests.length >= n, RECORDS, { timeout: 60000 });
  await settle(page);
  await gotoTab(page, "seating");
  await page.evaluate(async () => {
    const e = activeEvent();
    let ti = 0, used = 0;
    for (const g of e.guests) {
      if (used + paxOf(g) > e.tables[ti].capacity) { ti++; used = 0; }
      assignGuestToTable(g.id, e.tables[ti].id); used += paxOf(g);
      await new Promise((r) => setTimeout(r, 0));
    }
  });
  const plannedBefore = await page.evaluate(() => JSON.stringify(activeEvent().guests.map((g) => [g.id, g.assignment, g.planningStatus])));
  checks.require(await page.evaluate((n) => activeEvent().guests.filter((g) => g.assignment).length === n, RECORDS), "every record is seated before the doors open");

  await gotoTab(page, "live");
  const cdp = await page.context().newCDPSession(page);
  const sample = async (label, done) => {
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));   // let toast timers settle
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
    const dom = await cdp.send("Memory.getDOMCounters");
    const audit = await page.evaluate(() => (state.audit || []).length);
    const s = { label, done, heapMB: +(heap.usedSize / 1048576).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents, audit };
    console.log(`DOOR sample ${JSON.stringify(s)}`);
    return s;
  };

  // --- PART 1: 3,000 door operations -----------------------------------------
  // In the page, so each one is the same click an operator makes; a macrotask
  // between operations lets render-time timers and toasts run as they would.
  await page.evaluate(() => {
    const e = activeEvent();
    window.__door = { shadow: Object.fromEntries(e.guests.map((g) => [g.id, g.arrivalStatus])), changes: 0, kinds: {}, seed: 20261107, ms: [] };
    window.__doorRun = async (n) => {
      const D = window.__door;
      const rnd = () => { D.seed = (Math.imul(D.seed, 1103515245) + 12345) >>> 0; return D.seed / 4294967296; };
      const tick = () => new Promise((r) => setTimeout(r, 0));
      const pickRow = (sel) => { const bs = [...document.querySelectorAll(sel)]; return bs.length ? bs[Math.floor(rnd() * bs.length)] : null; };
      const search = (name) => { const s = document.getElementById("liveSearch"); s.value = name; s.dispatchEvent(new Event("input", { bubbles: true })); };
      const ev = () => activeEvent();
      for (let i = 0; i < n; i++) {
        // A door that drains its queue stops exercising check-in; when fewer
        // than a quarter of the records are still outside, the night turns
        // to taking arrivals back until the queue refills.
        const outside = ev().guests.filter((x) => x.arrivalStatus === "Not Arrived").length;
        const r = outside < ev().guests.length / 4 ? 0.70 + rnd() * 0.30 : rnd(), t0 = performance.now();
        let kind;
        if (r < 0.40) {                       // check in from the queue (row button)
          kind = "checkin";
          const b = pickRow('#liveList .arrival-row:not(.is-in):not(.is-no) [data-arrival="Checked In"]');
          if (b) { const id = b.dataset.liveGuest; b.click(); D.shadow[id] = "Checked In"; D.changes++; }
        } else if (r < 0.55) {                // check in by name + Enter
          kind = "enter";
          const g = ev().guests.filter((x) => x.arrivalStatus !== "Checked In")[Math.floor(rnd() * 50)];
          if (g) {
            search(g.name);
            document.getElementById("liveSearch").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
            D.shadow[g.id] = "Checked In"; D.changes++;
          }
        } else if (r < 0.70) {                // No Show from the queue
          kind = "noshow";
          const b = pickRow('#liveList .arrival-row:not(.is-in):not(.is-no) [data-arrival="No Show"]');
          if (b) { const id = b.dataset.liveGuest; b.click(); D.shadow[id] = "No Show"; D.changes++; }
        } else if (r < 0.88) {                // Recent's Undo
          kind = "undo";
          const recent = ui.liveRecent || [];
          const entry = recent[Math.floor(rnd() * recent.length)];
          const b = entry && document.querySelector(`[data-live-undo="${CSS.escape(entry.guestId)}"]`);
          if (b) { b.click(); D.shadow[entry.guestId] = entry.from; D.changes++; }
        } else {                              // a wrong arrival taken back from its own row
          kind = "toggle";
          const g = ev().guests.filter((x) => x.arrivalStatus !== "Not Arrived")[Math.floor(rnd() * 20)];
          if (g) {
            search(g.name);
            const b = document.querySelector(`[data-live-guest="${CSS.escape(g.id)}"][data-arrival="${g.arrivalStatus}"]`);
            if (b) { b.click(); D.shadow[g.id] = "Not Arrived"; D.changes++; }
          }
        }
        if (ui.liveQuery) search("");
        D.kinds[kind] = (D.kinds[kind] || 0) + 1;
        D.ms.push(performance.now() - t0);
        await tick();
      }
    };
  });
  await page.evaluate((n) => window.__doorRun(n), WARMUP);
  const samples = [await sample("after warm-up", WARMUP)];
  for (let done = WARMUP; done < OPS;) {
    const n = Math.min(SAMPLE_EVERY, OPS - done);
    await page.evaluate((k) => window.__doorRun(k), n);
    done += n;
    samples.push(await sample(`after ${done}`, done));
  }
  const night = await page.evaluate(() => {
    const e = activeEvent(), D = window.__door;
    const s = MeritOccupancy.liveStats(e, { paxOf });
    const sum = (st) => e.guests.filter((g) => g.arrivalStatus === st).reduce((n, g) => n + paxOf(g), 0);
    const shown = [...document.querySelectorAll(".mx-metrics .mx-metric-value")].slice(0, 3).map((n) => Number(n.textContent.trim()));
    const mismatch = e.guests.filter((g) => D.shadow[g.id] !== g.arrivalStatus).map((g) => ({ name: g.name, data: g.arrivalStatus, expected: D.shadow[g.id] }));
    const arrivalEntries = (state.audit || []).filter((a) => a.eventId === e.id && a.action === "ARRIVAL_STATUS_CHANGED").length;
    const ms = [...D.ms].sort((a, b) => a - b);
    return {
      kinds: D.kinds, changes: D.changes, arrivalEntries, mismatch: mismatch.slice(0, 5), mismatches: mismatch.length,
      recount: { checked: sum("Checked In"), notArrived: sum("Not Arrived"), noShow: sum("No Show") },
      stats: { checked: s.checked, notArrived: s.notArrived, noShow: s.noShow }, shown,
      momentsConsistent: e.guests.every((g) => (g.arrivalStatus === "Checked In") === !!g.checkedInAt),
      noShowSeatsFreeTonight: e.tables.every((t) => [...MeritOccupancy.liveUsedIndexes(e, t.id)].every((i) =>
        e.guests.some((g) => g.assignment?.tableId === t.id && g.arrivalStatus !== "No Show" && g.assignment.seats.map(Number).includes(i)))),
      opMs: { median: +ms[Math.floor(ms.length / 2)].toFixed(1), p95: +ms[Math.floor(ms.length * 0.95)].toFixed(1), max: +ms[ms.length - 1].toFixed(1) },
    };
  });
  console.log(`DOOR night ${JSON.stringify(night)}`);
  checks.ok(Object.values(night.kinds).reduce((a, b) => a + b, 0) === OPS && night.changes > OPS * 0.9,
    `${OPS} door operations ran, of every kind (check-in button, Enter, No Show, Undo, take back)`, night.kinds);
  checks.equal(night.mismatches, 0, "every guest's arrival equals what the operations said it should be", night.mismatch);
  checks.equal(night.arrivalEntries, night.changes, "the audit trail holds exactly one arrival entry per change made — none lost, none doubled");
  checks.equal(night.stats, night.recount, "the door's figures equal a recount from the records (people, not records)");
  checks.equal(night.shown, [night.recount.checked, night.recount.notArrived, night.recount.noShow], "and so do the figures on screen");
  checks.ok(night.momentsConsistent, "a checked-in record has its moment; nobody else has one");
  checks.ok(night.noShowSeatsFreeTonight, "tonight's used seats are exactly the non-No-Show parties' seats");
  const plannedAfter = await page.evaluate(() => JSON.stringify(activeEvent().guests.map((g) => [g.id, g.assignment, g.planningStatus])));
  checks.ok(plannedAfter === plannedBefore, "after 3,000 operations every planned seat and planning status is exactly as before the doors opened (No Show keeps the planned seat)");

  const first = samples[0], last = samples[samples.length - 1];
  const growth = { heapMB: +(last.heapMB - first.heapMB).toFixed(2), listeners: last.listeners - first.listeners, nodes: last.nodes - first.nodes, documents: last.documents - first.documents };
  console.log(`DOOR growth over ${OPS - WARMUP} operations: ${JSON.stringify(growth)}`);
  checks.ok(growth.heapMB <= HEAP_GROWTH_MB, `heap after GC grows ${growth.heapMB} MB over ${OPS - WARMUP} operations (bound ${HEAP_GROWTH_MB} MB, incl. ~${last.audit - first.audit} audit entries)`, samples);
  checks.ok(growth.listeners <= LISTENER_GROWTH, `JS event listeners grow by ${growth.listeners} (bound ${LISTENER_GROWTH}) — re-rendering does not pile them up`, samples.map((s) => s.listeners));
  checks.ok(growth.nodes <= NODE_GROWTH, `DOM nodes grow by ${growth.nodes} (bound ${NODE_GROWTH})`, samples.map((s) => s.nodes));
  checks.ok(growth.documents <= 0, "no document is left behind", samples.map((s) => s.documents));
  // Leak shape: the later half must not grow faster than a steady audit trail.
  const mid = samples[Math.floor(samples.length / 2)];
  checks.ok(last.heapMB - mid.heapMB <= HEAP_GROWTH_MB / 2, "and the second half grows no more than half the bound (no accelerating leak)", { mid: mid.heapMB, last: last.heapMB });

  // --- PART 2: the tab closes the instant after a door click -----------------
  await page.evaluate(() => { const s = document.getElementById("liveSearch"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); });
  await settle(page);
  const target = await page.evaluate(() => {
    const b = document.querySelector('#liveList .arrival-row:not(.is-in):not(.is-no) [data-arrival="Checked In"]');
    return b ? b.dataset.liveGuest : null;
  });
  checks.require(!!target, "someone is still outside to check in");
  await setFault(page, "put", "lost");
  const snapshotBefore = await page.evaluate((id) => {
    document.querySelector(`[data-live-guest="${CSS.escape(id)}"][data-arrival="Checked In"]`).click();
    const e = activeEvent();
    return JSON.stringify([e.guests.map((g) => [g.id, g.arrivalStatus, g.checkedInAt, g.assignment]), (state.audit || []).length]);
  }, target);
  await page.reload();   // no wait: the operator's laptop lid closes
  const readBack = async () => {
    await page.waitForFunction(() => { try { return Array.isArray(state.events) && state.events.length > 0; } catch { return false; } }, null, { timeout: 30000 });
    await page.waitForTimeout(700);
    return page.evaluate((id) => {
      const e = state.events[0];
      return {
        snapshot: JSON.stringify([e.guests.map((g) => [g.id, g.arrivalStatus, g.checkedInAt, g.assignment]), (state.audit || []).length]),
        target: e.guests.find((g) => g.id === id).arrivalStatus,
        entries: (state.audit || []).filter((a) => a.action === "ARRIVAL_STATUS_CHANGED" && a.detail?.guestId === id && a.detail?.to === "Checked In").length,
        checkedRecords: e.guests.filter((g) => g.arrivalStatus === "Checked In").length,
      };
    }, target);
  };
  const r1 = await readBack();
  checks.ok(r1.snapshot === snapshotBefore, "the tab closed the instant after a door click: every arrival, moment, planned seat and audit entry is there when it opens again — once", { target: r1.target });
  await page.reload();
  const r2 = await readBack();
  checks.equal(r2, r1, "a second reload changes nothing — the close-time snapshot is not applied twice");
  await bootApp(page, baseUrl);
  await page.evaluate(() => { ui.activeEventId = state.events[0].id; ui.screen = "workspace"; ui.tab = "live"; render(); });
  await settle(page);
  const name = await page.evaluate((id) => state.events[0].guests.find((g) => g.id === id).name, target);
  const r3before = await readBack();
  // The toast is read in the same task as the key: settle() waits for toasts to go.
  const doorToast = await page.evaluate((n) => {
    const s = document.getElementById("liveSearch"); s.value = n; s.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("liveSearch").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    return [...document.querySelectorAll("#toastWrap .toast")].map((x) => x.textContent.trim()).pop() || "";
  }, name);
  await settle(page);
  const r3 = await page.evaluate((id) => ({
    status: state.events[0].guests.find((g) => g.id === id).arrivalStatus,
    entries: (state.audit || []).filter((a) => a.action === "ARRIVAL_STATUS_CHANGED" && a.detail?.guestId === id && a.detail?.to === "Checked In").length,
    checkedRecords: state.events[0].guests.filter((g) => g.arrivalStatus === "Checked In").length,
  }), target);
  checks.equal({ status: r3.status, entries: r3.entries, checkedRecords: r3.checkedRecords }, { status: "Checked In", entries: r3before.entries, checkedRecords: r3before.checkedRecords },
    "the same guest at the door again after the reload: no second check-in, no second audit entry");
  checks.ok(/already checked in/i.test(doorToast), "and the door says so", doorToast);
  checks.equal(pageErrors, [], "no page error through the night or the reloads");
}
