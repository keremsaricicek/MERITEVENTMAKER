// §26: the 4,000-seat stress, measured the way `merit-performance-hardening`
// requires — repeated, reported as median / p95 / max, with the order of the
// operations reversed on a second pass (the first run pays the warm-up), a
// degradation series over 300 repetitions, DOM-node counts after navigating
// every screen three times, and Assisted Detection timed three times. The
// workload is §26's minimum: 3,000 guests, 400 tables, 4,000 chairs, a
// 6000×4000 background, 5,000 audit entries and twelve past events.
//
// `stress-4000-seats.mjs` stays as it is: it asserts data integrity across a
// reload and records single wall-clock numbers, which this file does not
// replace. A single number is INDICATIVE; these are the results.
//
// Timing is in-page (performance.now()) around render() with a forced layout
// flush INSIDE the timed region — without it Chromium defers layout past the
// end of the call and the cost lands on the next measurement
// (profile-render-phases.mjs recorded that trap).
//
// Run with NOTHING else on the machine: concurrent Chromium instances have
// already produced numbers that reversed on a second pass.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import { futureDate } from "../../tests/lib/app-actions.mjs";
import { BUDGETS, judge } from "./budgets.mjs";

const REPS = Number(process.env.REPS || 20);
const app = await serveApp();
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(app.baseUrl + "/index.html");
await page.waitForFunction(() => { try { return Array.isArray(state.events); } catch { return false; } });
await page.evaluate(() => {
  const e = { id: "ev-stress", name: "Stress 4000", hotel: "Merit Arena", salon: "", date: new Date(Date.now() + 90 * 864e5).toLocaleDateString("en-CA"), status: "Planning",
    tables: [], venueObjects: [], guests: [], background: { src: "", visible: true }, audit: [], handoverNotes: [] };
  for (let i = 0; i < 400; i++) {
    const t = { id: "tbl" + i, number: "T" + String(i + 1).padStart(3, "0"), type: ["round", "square", "rectangle", "bistro"][i % 4],
      x: 120 + (i % 20) * 160, y: 120 + Math.floor(i / 20) * 150, w: 120, h: 110, capacity: 10, zone: "MAIN FLOOR",
      rotation: 0, locked: false, z: 10, hasPhysicalSeats: true, chairs: [], origin: "MANUAL" };
    for (let s = 0; s < 10; s++) { const a = s / 10 * Math.PI * 2; t.chairs.push({ id: `ch${i}_${s}`, parentTableId: t.id, seatNumber: s + 1, x: 50 + Math.cos(a) * 46, y: 50 + Math.sin(a) * 46, rotation: 0, occupancy: null }); }
    e.tables.push(t);
  }
  const vips = ["Standard", "VIP", "VVIP"], plan = ["Confirmed", "Tentative"], arr = ["Not Arrived", "Checked In", "No Show"];
  for (let i = 0; i < 3000; i++) {
    const add = i % 5 === 0 ? (i % 4) + 1 : 0;
    e.guests.push({ id: "g" + i, name: "GUEST " + String(i + 1).padStart(4, "0"), additionalGuests: add, pax: 1 + add,
      planningStatus: plan[i % 2], vip: vips[i % 3], arrivalStatus: arr[i % 3], checkedInAt: i % 3 === 1 ? new Date().toISOString() : null,
      invitedBy: "Host " + (i % 40), notes: "", assignment: null, createdAt: new Date().toISOString() });
  }
  for (let i = 0; i < 500; i++) { const g = e.guests[i], t = e.tables[i % 400], used = occupiedSeatIndexes(e, t.id, null), free = [];
    for (let s = 0; s < t.capacity && free.length < g.pax; s++) if (!used.has(s)) free.push(s);
    if (free.length >= g.pax) g.assignment = { tableId: t.id, seats: free, locked: false }; }
  // The rest of §26's minimum workload: a large background image, a large
  // audit trail and a large event history. The image is drawn in-page (a
  // 6000×4000 JPEG with real structure, not a flat fill that compresses to
  // nothing) so the number is about decoding and painting a plan-sized image.
  const cv = document.createElement("canvas"); cv.width = 6000; cv.height = 4000;
  const g = cv.getContext("2d"); g.fillStyle = "#f6f1e7"; g.fillRect(0, 0, 6000, 4000); g.strokeStyle = "#333";
  for (let i = 0; i < 400; i++) { g.beginPath(); g.arc(150 + (i % 20) * 290, 150 + Math.floor(i / 20) * 190, 60, 0, 7); g.stroke(); g.fillText("T" + (i + 1), 140 + (i % 20) * 290, 155 + Math.floor(i / 20) * 190); }
  e.background = { src: cv.toDataURL("image/jpeg", 0.9), name: "plan.jpg", opacity: 1, visible: true, locked: false, scale: 100 };
  const history = [];
  for (let h = 0; h < 12; h++) {
    const past = { id: "ev-past" + h, name: "Past " + h, hotel: "Merit Arena", salon: "", date: `2025-${String(h % 12 + 1).padStart(2, "0")}-15`, status: "Completed",
      tables: [], venueObjects: [], guests: [], background: { src: "", visible: true }, audit: [], handoverNotes: [] };
    for (let i = 0; i < 30; i++) past.tables.push({ id: `p${h}t${i}`, number: "T" + String(i + 1).padStart(2, "0"), type: "round", x: 100 + i * 20, y: 100, w: 100, h: 100, capacity: 10, zone: "MAIN FLOOR", rotation: 0, locked: false, z: 10, hasPhysicalSeats: false, chairs: [], origin: "MANUAL" });
    for (let i = 0; i < 300; i++) past.guests.push({ id: `p${h}g${i}`, name: "PAST GUEST " + i, additionalGuests: 0, pax: 1, planningStatus: "Confirmed", vip: "Standard",
      arrivalStatus: "Checked In", checkedInAt: null, invitedBy: "", notes: "", assignment: i < 290 ? { tableId: `p${h}t${Math.floor(i / 10)}`, seats: [i % 10], locked: false } : null, createdAt: new Date().toISOString() });
    history.push(past);
  }
  state.audit = [];
  for (let i = 0; i < 5000; i++) state.audit.push({ id: "audit" + i, eventId: i % 3 ? e.id : "ev-past" + (i % 12), action: "guest.update", detail: { guestId: "g" + (i % 3000) }, at: new Date(Date.now() - i * 60000).toISOString() });
  state.events = [e, ...history]; ui.activeEventId = e.id; ui.screen = "workspace"; ui.tab = "command"; ui.lang = "tr"; render();
});

// One timed operation, in-page, with the layout flush inside the region.
const OPS = {
  command: () => { ui.tab = "command"; render(); },
  floor: () => { ui.tab = "floor"; ui.planMode = "plan"; render(); },
  guests: () => { ui.tab = "guests"; ui.guestQuery = ""; render(); },
  guestSearchKey: () => { ui.tab = "guests"; ui.guestQuery = ui.guestQuery === "GUEST 25" ? "GUEST 250" : "GUEST 25"; render(); },
  seating: () => { ui.tab = "seating"; render(); },
  live: () => { ui.tab = "live"; ui.liveQuery = ""; render(); },
  liveSearchKey: () => { ui.tab = "live"; ui.liveQuery = ui.liveQuery === "GUEST 12" ? "GUEST 123" : "GUEST 12"; render(); },
  reports: () => { ui.tab = "reports"; render(); },
  // Selecting a table re-renders the floor with its contextual card.
  tableSelect: () => { ui.screen = "workspace"; ui.tab = "floor"; ui.planMode = "plan"; const t = activeEvent().tables[(performance.now() | 0) % 400];
    ui.selectedObjectId = t.id; ui.selectedObjectIds = [t.id]; render(); },
  eventsList: () => { ui.screen = "events"; render(); ui.screen = "workspace"; },
  serialise: () => { JSON.stringify(state); },
  // The pure part of an event package: build + serialise, then everything the
  // import checks before it asks the operator anything. The file dialog and
  // the confirmation are a person's time, not the product's.
  packageExport: () => { const e = activeEvent(); JSON.stringify(MeritEventPackage.buildPayload(e, { auditEntries: state.audit.filter((a) => a.eventId === e.id) })); },
  packageValidate: () => { const e = activeEvent(); const p = JSON.parse(JSON.stringify(MeritEventPackage.buildPayload(e, { auditEntries: [] })));
    if (!MeritEventPackage.isWellFormed(p) || !MeritEventPackage.referencesIntact(p.event) || MeritEventPackage.eventProblem(p.event)) throw new Error("package refused"); },
};
const run = (name, reps) => page.evaluate(({ name, reps, src }) => {
  const op = new Function(`return (${src})`)();
  const out = [];
  for (let i = 0; i < reps; i++) { const t0 = performance.now(); op(); void document.body.offsetHeight; out.push(performance.now() - t0); }
  return out;
}, { name, reps, src: OPS[name].toString() });
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { n: s.length, median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) }; };

// Two passes, opposite orders; each operation's samples from both are pooled.
const names = Object.keys(OPS), samples = Object.fromEntries(names.map((n) => [n, []]));
for (const order of [names, [...names].reverse()]) for (const n of order) samples[n].push(...(await run(n, Math.ceil(REPS / 2))));
const results = Object.fromEntries(names.map((n) => [n, stats(samples[n])]));

// Repeated action: 300 renders of the busiest screen, reported as the median
// of each block of 25. A leak is a series that keeps climbing. The first
// version compared the first ten renders with the last ten and once read
// 267 → 1,020 ms; the block series showed why that was the wrong question —
// single blocks double and the next one RECOVERS, in varying positions, with
// the DOM node count unchanged: a collection phase landing at the end of a
// short series, not growth.
const series = await run("seating", 300);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const blocks = []; for (let b = 0; b < series.length; b += 25) blocks.push(+med(series.slice(b, b + 25)).toFixed(0));
const degradation = { blockMedians: blocks, firstBlock: blocks[0], lastBlock: blocks[blocks.length - 1], worstBlock: Math.max(...blocks) };

// Growth after navigating every screen twice.
const growth = await page.evaluate(() => {
  const count = () => ({ nodes: document.getElementsByTagName("*").length });
  const tabs = ["command", "floor", "guests", "seating", "live", "reports"];
  for (const t of tabs) { ui.tab = t; render(); }
  const a = count();
  for (const t of tabs) { ui.tab = t; render(); }
  for (const t of tabs) { ui.tab = t; render(); }
  return { afterOneLap: a, afterThreeLaps: count() };
});

// Plan analysis: Assisted Detection on the real venue plan (OCR pinned, as
// every runner now serves it), three runs, each on a fresh page through the
// real controls. Wall clock from the click to a finished analysis.
const PLAN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plans", "merit-real-venue-plan.png");
const planSrc = "data:image/png;base64," + fs.readFileSync(PLAN).toString("base64");
const analysis = [];
for (let i = 0; i < 3; i++) {
  const p2 = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  p2.on("pageerror", (e) => errs.push(e.message));
  await p2.goto(app.baseUrl + "/index.html");
  await p2.waitForLoadState("networkidle");
  await p2.click('.appbar [data-action="create-event"]');
  await p2.fill('input[name="name"]', "Analysis"); await p2.fill('input[name="hotel"]', "Merit"); await p2.fill('input[name="date"]', futureDate());
  await p2.click('button[data-setup="blank"]');
  await p2.waitForFunction(() => { try { return state.events.length === 1; } catch { return false; } });
  await p2.evaluate((src) => { state.events[0].background = { src, name: "plan", opacity: 1, visible: true, locked: false, scale: 100 }; ui.tab = "floor"; render(); }, planSrc);
  await p2.waitForSelector('[data-v8-action="detect"]');
  const t0 = Date.now();
  await p2.click('[data-v8-action="detect"]');
  await p2.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 240000 });
  analysis.push(Date.now() - t0);
  await p2.close();
}

console.log(`\n=== 4,000-SEAT REPEATED (ms, in-page incl. layout; ${REPS} samples per op, two passes in opposite order) ===`);
console.log("  op".padEnd(22) + "median".padStart(9) + "p95".padStart(9) + "max".padStart(9));
for (const n of names) console.log("  " + n.padEnd(20) + String(results[n].median).padStart(9) + String(results[n].p95).padStart(9) + String(results[n].max).padStart(9));
console.log("\nREPEATED 300× seating render — median per block of 25:", JSON.stringify(degradation.blockMedians), "first/last/worst", degradation.firstBlock, degradation.lastBlock, degradation.worstBlock);
console.log("DOM growth across three laps of every screen:", JSON.stringify(growth));
console.log("Plan analysis, real venue plan, 3 runs (ms, wall clock incl. OCR):", JSON.stringify(analysis), "median", [...analysis].sort((a, b) => a - b)[1]);
console.log("JS heap: UNAVAILABLE (performance.memory is coarsened in this browser; not printed as data)");
console.log("ERRORS:", errs.length ? JSON.stringify(errs.slice(0, 3)) : "clean");
console.log("JSON " + JSON.stringify({ results, degradation, growth, analysis }));

// The budgets: twice the worst CI p95, and the reasons, in BUDGETS.json.
const third = (xs) => xs.slice(0, 3), lastThird = (xs) => xs.slice(-3);
const seriesRatio = +(med(lastThird(degradation.blockMedians)) / med(third(degradation.blockMedians))).toFixed(2);
const over = judge("4,000-seat stress", [
  ...names.map((n) => [`${n} p95`, results[n].p95, BUDGETS.ops[n].budgetMs]),
  ["plan analysis median", [...analysis].sort((a, b) => a - b)[1], BUDGETS.analysis.budgetMs],
  ["seating 300× late/early", seriesRatio, BUDGETS.seatingSeries.maxRatio, "ratio"],
  ["DOM growth, three laps", growth.afterThreeLaps.nodes - growth.afterOneLap.nodes, BUDGETS.domGrowth.maxNodes, "nodes"],
]);
await browser.close();
await app.close();
process.exit(errs.length || over.length ? 1 : 0);
