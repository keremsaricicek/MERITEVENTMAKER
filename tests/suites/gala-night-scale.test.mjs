// A GALA NIGHT AT FULL SIZE, END TO END, TIMED.
//
// Pre-Windows health check (2026-11-07, benchmarks/HEALTH-2026-11.md). The
// perf runner (`benchmarks/perf/repeat-stress.mjs`) times renders on a planted
// 3,000-guest stress event; nothing walked ONE realistic evening through the
// real paths and timed what the operator feels at each step. This does:
//
//   1,000 guest RECORDS (1,500 people with their +N) arrive in a generated
//   .xlsx through the import wizard; 100 tables of 18 come from the Floor
//   Plan's add panel; 950 records are seated through the one seating writer
//   (`assignGuestToTable` → MeritSeatAssignment), 50 stay unseated; 300 are
//   checked in at the door by pressing their row's button; the workbook is
//   exported five times and read back.
//
// Timed in the page (performance.now(), with a forced layout flush inside the
// timed region, as the perf runners do) and reported as median / p95 / max.
// Budgets follow BUDGETS.json's rule — max(2 × measured p95, p95 + 15 ms),
// rounded up to 5 ms — from the numbers this suite measured on 2026-11-07
// (in HEALTH-2026-11.md). They are regression budgets, not promises: a
// doubling fails, runner noise does not.
//
// Correctness is checked alongside every timing, because a fast wrong answer
// is the worst kind: one record per party, pax = 1 + additionalGuests, the
// door's figures equal a recount from the records, a check-in touches neither
// the planned seat nor the planning status, and the workbook's three sheets
// say exactly what the records say.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent, gotoTab, settle } from "../lib/app-actions.mjs";

export const meta = { name: "gala-night-scale", tags: ["business", "performance", "reports", "slow"], timeout: 900000, downloads: true };

const DEFAULTS = { RECORDS: 1000, TABLES: 100, SEATS_PER_TABLE: 18, UNSEATED: 50, CHECK_INS: 300, EXPORTS: 5 };
// Measured 2026-11-07 (HEALTH-2026-11.md); rule as in benchmarks/perf/BUDGETS.json.
// Worst p95 of three runs: one idle, two with a training job holding ~2.7 of 4 cores.
const DEFAULT_BUDGET_MS = {
  guestListRender: 70,   // worst p95 34.9 ms
  guestSearchKey: 45,    // 21.2
  doorSearchKey: 45,     // 22.1
  seatingAssign: 280,    // 138.3 (assign + the Seating screen's render)
  checkInClick: 65,      // 30.4 idle. Not raised after the 71.5 ms miss under training load (2026-11-08): budgets are never loosened after a result; re-measure on an idle CPU.
  reportExport: 365,     // 181 (click → file, wall clock)
};

const FIRST = ["Ayşe", "Mehmet", "Fatma", "Mustafa", "Emine", "Ahmet", "Hatice", "Ali", "Zeynep", "Hüseyin",
  "Elif", "Hasan", "Meryem", "İbrahim", "Şerife", "Murat", "Sultan", "Ömer", "Hacer", "Yusuf",
  "Özlem", "Can", "Gül", "Kerem", "Selin", "Burak", "Ece", "Emre", "Deniz", "Onur",
  "Cansu", "Tolga", "Nur", "Serkan", "Pınar", "Barış", "Gizem", "Uğur", "Derya", "Çağla"];
const LAST = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk", "Aydın", "Özdemir",
  "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara", "Koç", "Kurt", "Özkan", "Şimşek",
  "Polat", "Korkmaz", "Erdoğan", "Güneş", "Aksoy"];
// +2 every tenth record, +1 for three in ten, alone otherwise: 1,000 records, 1,500 people.
const extra = (i) => (i % 10 === 0 ? 2 : i % 10 <= 3 ? 1 : 0);

export const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { n: s.length, median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
};

// The body is shared with gala-night-scale-3000 (same evening, three times the size).
export default (ctx) => runGala(ctx);
export async function runGala({ page, checks, baseUrl, artifactDir }, cfg = {}) {
  const { RECORDS, TABLES, SEATS_PER_TABLE, UNSEATED, CHECK_INS, EXPORTS } = { ...DEFAULTS, ...cfg };
  const BUDGET_MS = cfg.BUDGET_MS || DEFAULT_BUDGET_MS;
  const PEOPLE = Array.from({ length: RECORDS }, (_, i) => 1 + extra(i)).reduce((a, b) => a + b, 0);
  const nameOf = (i) => `${FIRST[i % 40]} ${LAST[Math.floor(i / 40) % LAST.length]}${i >= 1000 ? " " + String.fromCharCode(65 + Math.floor(i / 1000)) : ""}`;
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const results = {};
  const report = (name, xs) => { results[name] = stats(xs); console.log(`GALA[${RECORDS}] ${name}: ${JSON.stringify(results[name])}`); return results[name]; };

  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: `Gala Night ${RECORDS}` });

  // --- 100 tables of 18 through the Floor Plan's add panel (max 60 a press) --
  for (const quantity of Array.from({ length: TABLES / 50 }, () => 50)) {
    const before = await page.evaluate(() => activeEvent().tables.length);
    await click(page, ".planmap-fab");
    await page.waitForSelector('[data-v8-action="commit-add"]', { timeout: 10000 });
    await page.fill('[data-bulk="quantity"]', String(quantity));
    await page.fill('[data-bulk="chairs"]', String(SEATS_PER_TABLE));
    await page.dispatchEvent('[data-bulk="chairs"]', "change");
    await page.waitForTimeout(150);
    await click(page, '[data-v8-action="commit-add"]');
    await page.waitForFunction(([n, q]) => activeEvent().tables.length >= n + q, [before, quantity], { timeout: 20000 });
    await settle(page);
  }
  const room = await page.evaluate(() => {
    const e = activeEvent();
    return { tables: e.tables.length, seats: MeritSeatModel.seatingCapacity(e), distinctNumbers: new Set(e.tables.map((t) => t.number)).size };
  });
  checks.require(room.tables === TABLES && room.seats === TABLES * SEATS_PER_TABLE && room.distinctNumbers === TABLES,
    `${TABLES} tables of ${SEATS_PER_TABLE}, each with its own number`, room);

  // --- 1,000 records from a generated .xlsx through the real wizard ---------
  const rows = [["NAME SURNAME", "ADDITIONAL GUESTS", "STATUS"]];
  for (let i = 0; i < RECORDS; i++) rows.push([nameOf(i), extra(i), i % 6 ? "Confirmed" : "Tentative"]);
  const xlsx = await page.evaluate((aoa) => {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Guests");
    return Array.from(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
  }, rows);
  await gotoTab(page, "guests");
  const importStart = Date.now();
  await click(page, "[data-guest-command='import']");
  await page.setInputFiles("#guestFileInput", { name: `gala-${RECORDS}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(xlsx) });
  await page.waitForSelector("[data-wizard-next]");
  for (let i = 0; i < 3; i++) { await click(page, "[data-wizard-next]"); await page.waitForTimeout(150); }
  await page.waitForSelector("[data-wizard-import]:not([disabled])", { timeout: 30000 });
  await click(page, "[data-wizard-import]");
  await page.waitForFunction((n) => activeEvent().guests.length >= n, RECORDS, { timeout: 60000 });
  results.importWizardMs = Date.now() - importStart;
  console.log(`GALA import (file chosen → ${RECORDS} records, wall clock incl. wizard clicks): ${results.importWizardMs} ms`);
  await settle(page);
  const imported = await page.evaluate(() => {
    const gs = activeEvent().guests;
    return { records: gs.length, people: gs.reduce((n, g) => n + paxOf(g), 0), paxRule: gs.every((g) => g.pax === 1 + g.additionalGuests),
      names: new Set(gs.map((g) => g.name)).size, tentative: gs.filter((g) => g.planningStatus === "Tentative").length };
  });
  checks.equal(imported, { records: RECORDS, people: PEOPLE, paxRule: true, names: RECORDS, tentative: Math.ceil(RECORDS / 6) },
    "1,000 rows become 1,000 records — a +N party is ONE record — carrying 1,500 people, every pax = 1 + additional, statuses as written");

  // --- guest list render ----------------------------------------------------
  const listRender = await page.evaluate(async () => {
    ui.tab = "guests"; ui.guestQuery = ""; render();
    const xs = [];
    for (let i = 0; i < 22; i++) {
      const t0 = performance.now(); render(); document.body.getBoundingClientRect(); xs.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 0));
    }
    return xs.slice(2);
  });
  report("guestListRender", listRender);

  // --- one keystroke in the guest list's search -----------------------------
  const QUERIES = ["a", "ay", "ayş", "ayşe", "ayşe y", "yıl", "kaya", "öz", "özd", "mehmet", "mehmet ö", "çelik", "tent", "conf", "ş", "şahin", "can", "can k", "elif", "e"];
  const guestKeys = await page.evaluate(async (qs) => {
    const xs = [];
    for (const q of [...qs, ...[...qs].reverse()]) {
      const n = document.getElementById("guestSearch");
      n.value = q;
      const t0 = performance.now(); n.dispatchEvent(new Event("input", { bubbles: true })); document.body.getBoundingClientRect(); xs.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 0));
    }
    const s = document.getElementById("guestSearch"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true }));
    return xs;
  }, QUERIES);
  report("guestSearchKey", guestKeys);
  const hits = await page.evaluate(() => MeritGuestSearch.create({ formatNumber: (n) => formatTableNumber(n) }).matchRows(activeEvent(), "mehmet öz").rows.map((r) => r.guest.name));
  checks.equal(hits.slice().sort(), Array.from({ length: RECORDS }, (_, i) => nameOf(i)).filter((n) => n.startsWith("Mehmet Öz")).sort(),
    "and the search answers correctly at this size (\"mehmet öz\" is exactly the three Mehmet Öz…)");

  // --- seat 950 records through the one seating writer, on the Seating screen
  await gotoTab(page, "seating");
  const seating = await page.evaluate(async ({ UNSEATED }) => {
    const e = activeEvent(), xs = [];
    const order = e.guests.slice(0, e.guests.length - UNSEATED);
    let ti = 0, used = 0;
    for (const g of order) {
      const cap = e.tables[ti].capacity;
      if (used + paxOf(g) > cap) { ti++; used = 0; }
      const tableId = e.tables[ti].id;
      const t0 = performance.now(); assignGuestToTable(g.id, tableId); document.body.getBoundingClientRect(); xs.push(performance.now() - t0);
      used += paxOf(g);
      await new Promise((r) => setTimeout(r, 0));
    }
    return xs;
  }, { UNSEATED });
  report("seatingAssign", seating);
  const seated = await page.evaluate(() => {
    const e = activeEvent();
    const clash = e.tables.some((t) => {
      const seats = e.guests.filter((g) => g.assignment?.tableId === t.id).flatMap((g) => g.assignment.seats.map(Number));
      return new Set(seats).size !== seats.length || seats.some((s) => s < 0 || s >= t.capacity);
    });
    return { seated: e.guests.filter((g) => g.assignment).length,
      seatsMatchParty: e.guests.filter((g) => g.assignment).every((g) => g.assignment.seats.length === paxOf(g)), clash };
  });
  checks.equal(seated, { seated: RECORDS - UNSEATED, seatsMatchParty: true, clash: false },
    "950 records seated through the writer, each with exactly its party's seats, no seat given twice or past a table's capacity");

  // --- 300 check-ins at the door, one row button each ------------------------
  await gotoTab(page, "live");
  const before = await page.evaluate(() => JSON.stringify(activeEvent().guests.map((g) => [g.id, g.assignment, g.planningStatus])));
  // One keystroke in the door search, too: the queue's other half.
  const doorKeys = await page.evaluate(async (qs) => {
    const xs = [];
    for (const q of [...qs, ...[...qs].reverse()]) {
      const n = document.getElementById("liveSearch");
      n.value = q;
      const t0 = performance.now(); n.dispatchEvent(new Event("input", { bubbles: true })); document.body.getBoundingClientRect(); xs.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 0));
    }
    const s = document.getElementById("liveSearch"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true }));
    return xs;
  }, QUERIES);
  report("doorSearchKey", doorKeys);
  const clicks = [], checkedIds = [];
  for (let i = 0; i < CHECK_INS; i++) {
    const r = await page.evaluate(() => {
      const b = document.querySelector('#liveList .arrival-row:not(.is-in):not(.is-no) [data-arrival="Checked In"]');
      if (!b) return null;
      const id = b.dataset.liveGuest;
      const t0 = performance.now(); b.click(); document.body.getBoundingClientRect();
      return { ms: performance.now() - t0, id };
    });
    if (!r) break;
    clicks.push(r.ms); checkedIds.push(r.id);
  }
  report("checkInClick", clicks);
  const door = await page.evaluate(({ ids, PEOPLE }) => {
    const e = activeEvent(), want = new Set(ids);
    const s = MeritOccupancy.liveStats(e, { paxOf });
    const sum = (f) => e.guests.filter(f).reduce((n, g) => n + paxOf(g), 0);
    const shown = [...document.querySelectorAll(".mx-metrics .mx-metric-value")].slice(0, 3).map((n) => Number(n.textContent.trim()));
    return {
      exactlyThose: e.guests.filter((g) => g.arrivalStatus === "Checked In").every((g) => want.has(g.id)) && e.guests.filter((g) => g.arrivalStatus === "Checked In").length === ids.length,
      everyOneHasMoment: e.guests.filter((g) => g.arrivalStatus === "Checked In").every((g) => !!g.checkedInAt),
      statsEqualRecount: s.checked === sum((g) => g.arrivalStatus === "Checked In") && s.notArrived === sum((g) => g.arrivalStatus === "Not Arrived") && s.total === PEOPLE,
      screenEqualsRecount: JSON.stringify(shown) === JSON.stringify([s.checked, s.notArrived, s.noShow]),
    };
  }, { ids: checkedIds, PEOPLE });
  checks.equal({ clicks: clicks.length, unique: new Set(checkedIds).size }, { clicks: CHECK_INS, unique: CHECK_INS }, "300 door clicks check in 300 different records");
  checks.equal(door, { exactlyThose: true, everyOneHasMoment: true, statsEqualRecount: true, screenEqualsRecount: true },
    "exactly those 300 are in, each with its moment, and the door's figures on screen equal a recount from the records");
  const after = await page.evaluate(() => JSON.stringify(activeEvent().guests.map((g) => [g.id, g.assignment, g.planningStatus])));
  checks.ok(after === before, "300 check-ins changed no planned seat and no planning status (two independent axes)");

  // --- the workbook, five times, then read back ------------------------------
  await gotoTab(page, "reports");
  await page.waitForSelector('[data-report="xlsx"]', { timeout: 15000 });
  const exportMs = [];
  let file = null;
  for (let i = 0; i < EXPORTS; i++) {
    const t0 = Date.now();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click('[data-report="xlsx"]')]);
    file = path.join(artifactDir, `gala-night-${i}.xlsx`);
    await download.saveAs(file);
    exportMs.push(Date.now() - t0);
    await settle(page);
  }
  report("reportExport", exportMs);
  const buf = fs.readFileSync(file);
  const book = await page.evaluate((b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const wb = XLSX.read(bytes, { type: "array" }), e = activeEvent();
    const text = (n) => JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }));
    const plan = text("TABLE PLAN").toUpperCase(), list = text("GUEST LIST"), un = text("UNASSIGNED");
    const seatedGs = e.guests.filter((g) => g.assignment), unseated = e.guests.filter((g) => !g.assignment);
    const companions = (plan.match(/GUEST OF /g) || []).length;
    return {
      sheets: wb.SheetNames.filter((n) => ["TABLE PLAN", "GUEST LIST", "UNASSIGNED"].includes(n)).length,
      everyRecordListed: e.guests.every((g) => list.includes(g.name)),
      unassignedExactly: unseated.every((g) => un.includes(g.name)) && seatedGs.every((g) => !un.includes(JSON.stringify(g.name))),
      companionsEqualAdditional: companions === seatedGs.reduce((n, g) => n + g.additionalGuests, 0),
      everyTable: e.tables.every((t) => plan.includes(String(formatTableNumber(t.number)).toUpperCase())),
    };
  }, buf.toString("base64"));
  checks.equal(book, { sheets: 3, everyRecordListed: true, unassignedExactly: true, companionsEqualAdditional: true, everyTable: true },
    "the workbook at this size: three sheets, every record on GUEST LIST, UNASSIGNED exactly the 50 unseated, one GUEST OF seat per companion, every table on TABLE PLAN");

  // --- budgets ----------------------------------------------------------------
  const load = fs.existsSync("/proc/loadavg") ? fs.readFileSync("/proc/loadavg", "utf8").trim() : "n/a";
  console.log(`GALA load average at the end: ${load}`);
  for (const [op, budget] of Object.entries(BUDGET_MS)) {
    checks.ok(results[op].p95 <= budget, `${op}: p95 ${results[op].p95} ms within its ${budget} ms budget`, results[op]);
  }
  checks.equal(pageErrors, [], "no page error through the whole evening");
}
