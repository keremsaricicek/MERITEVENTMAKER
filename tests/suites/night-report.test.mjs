// NIGHT-END REPORT — one event, one page: who came, who did not, who walked in.
//
// Pure module (src/night-report.js). What it guards:
//
//   PEOPLE, NOT RECORDS. A +3 party is four people on every figure.
//   A WALK-IN WAS NOT EXPECTED. Walk-ins never inflate a host's expected count
//     or arrival rate; they are counted and listed on their own.
//   NO RATE WITHOUT A DENOMINATOR. A host whose only guests walked in has no
//     arrival rate (null), not 0 % or 100 %.
//   THE PLAN AND TONIGHT DISAGREE FOR A NO SHOW. The No Show's planned seats are
//     still planned, and empty tonight.
//   FORMULA-SAFE CELLS. A typed "=HYPERLINK(...)" reaches the sheet as text
//     (the exportJunketReport rule), and the module never touches the existing
//     TABLE PLAN / GUEST LIST / UNASSIGNED workbook.
//   READ-ONLY.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const meta = { name: "night-report", tags: ["business", "reports", "fast"], timeout: 30000 };

const DEPS = ["seat-model", "event-rules", "occupancy", "assistant-tools", "guest-groups", "arrival-wave", "night-report"];

export default async function run({ checks, repoRoot }) {
  const ctx = vm.createContext({});
  for (const f of DEPS) {
    const p = path.join(repoRoot, "src", `${f}.js`);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: p });
  }
  const N = ctx.MeritNightReport;
  checks.require(!!N && typeof N.build === "function" && typeof N.summaryRows === "function",
    "MeritNightReport loads outside the browser with build() and summaryRows()");

  // stamps at a wall-clock time, in this process's timezone (the door's)
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const g = (id, name, pax, extra = {}) => ({ id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: "", notes: "",
    planningStatus: "Confirmed", arrivalStatus: "Not Arrived", checkedInAt: null, expectedArrival: null, assignment: null, ...extra });
  const ev = {
    id: "e1", name: "Gala", date: "2026-01-10", status: "Completed",
    tables: [{ id: "t1", number: "T01", capacity: 10, chairs: [] }, { id: "t2", number: "T02", capacity: 6, chairs: [] }, { id: "t3", number: "T03", capacity: 0, chairs: [] }],
    guests: [
      g("a", "Ayşe Demir", 4, { invitedBy: "Kerem Sarıçiçek", arrivalStatus: "Checked In", checkedInAt: at(20, 5), assignment: { tableId: "t1", seats: [0, 1, 2, 3] } }),
      g("b", "Burak Şahin", 2, { invitedBy: "KEREM SARICICEK", arrivalStatus: "No Show", assignment: { tableId: "t1", seats: [4, 5] } }),
      g("c", "=HYPERLINK(\"http://x\")", 1, { invitedBy: "Kerem Sarıçiçek", arrivalStatus: "Not Arrived", assignment: { tableId: "t2", seats: [0] } }),
      g("d", "Deniz Yıldız", 3, { invitedBy: "Milica V.", arrivalStatus: "Checked In", checkedInAt: at(22, 40), assignment: { tableId: "t2", seats: [1, 2, 3] } }),
      g("e", "Emre Kaya", 2, { invitedBy: "+Junket", walkIn: true, walkInAt: at(21, 10), arrivalStatus: "Checked In", checkedInAt: at(21, 11) }),
      g("f", "Fatma Ak", 1, { arrivalStatus: "Checked In", checkedInAt: null, assignment: { tableId: "t2", seats: [4] } }),
    ],
  };
  const before = JSON.stringify(ev);
  const r = N.build(ev);

  checks.equal(r.people, { expected: 11, arrived: 8, noShow: 2, notArrived: 1, walkIns: 2, inRoom: 10 },
    "people: 11 expected on the list (walk-ins excluded), 8 of them came, 2 No Show, 1 never came, 2 walked in, 10 in the room — a +3 is four people");
  const host = (h) => r.hosts.find((x) => x.host === h) || {};
  checks.equal([host("Kerem Sarıçiçek").expected, host("Kerem Sarıçiçek").arrived, host("Kerem Sarıçiçek").noShow], [7, 4, 2],
    "one host however it was typed (folded): 7 expected, 4 came, 2 No Show");
  checks.equal(host("Kerem Sarıçiçek").rate, 4 / 7, "arrival rate = arrived / expected people");
  checks.equal([host("+Junket").expected, host("+Junket").walkIns, host("+Junket").rate], [0, 2, null],
    "a host with only walk-ins has walk-ins and NO rate (nothing was expected)");
  checks.equal([host(null).expected, host(null).arrived], [1, 1], "guests with no host are their own row, not dropped");

  checks.equal([r.firstArrival, r.lastArrival], [at(20, 5), at(22, 40)], "first and last arrival are the earliest and latest check-in moments (walk-ins included)");
  checks.equal(r.untimedArrivals, 1, "a check-in with no recorded moment is counted, never given a time");

  checks.equal(r.noShows.map((x) => [x.name, x.pax, x.host, x.table]), [["Burak Şahin", 2, "KEREM SARICICEK", "T01"]], "the No Show list, with the seat the plan kept");
  checks.equal(r.walkIns.map((x) => [x.name, x.pax, x.host, x.table, x.at]), [["Emre Kaya", 2, "+Junket", null, at(21, 10)]], "the walk-in list");

  checks.equal(r.seats, { capacity: 16, planned: 11, heldTonight: 9, seatedArrived: 8, empty: 8, freedByNoShow: 2, arrivedUnseated: 2 },
    "seats: 16 logical, 11 planned, 9 held tonight (the No Show's 2 freed), 8 occupied by people who came, 8 empty, and 2 people in the room without a table");

  // ---- the sheet ---------------------------------------------------------------
  const rows = N.summaryRows(r);
  const cells = rows.flat().filter((v) => typeof v === "string");
  checks.ok(Array.isArray(rows) && rows.every(Array.isArray) && rows.length > 10, "summaryRows is an array of rows (one sheet)", rows.length);
  checks.ok(!cells.some((v) => /^[=+\-@\t\r]/.test(v)), "no text cell starts with = + - @ (formula injection)", cells.filter((v) => /^[=+\-@]/.test(v)));
  checks.equal(N.safeCell('=HYPERLINK("http://x")'), "'=HYPERLINK(\"http://x\")", "a formula-looking text is kept as text with a leading quote");
  checks.ok(cells.includes("'+Junket"), "a host typed with a leading + is escaped the same way", cells.filter((v) => /Junket/.test(v)));
  checks.ok(cells.includes("BURAK ŞAHIN") || cells.includes("Burak Şahin"), "the No Show is on the sheet");
  checks.ok(rows.some((row) => row.includes("20:05")) && rows.some((row) => row.includes("22:40")), "arrival times appear as HH:MM");
  const tr = N.summaryRows(r, (k) => `tr:${k}`);
  checks.ok(tr.flat().some((v) => v === "tr:title"), "headings come from an injected label function (Turkish-first UI)");
  checks.equal(N.safeCell("@SUM(A1)"), "'@SUM(A1)", "safeCell escapes a leading @");
  checks.equal(N.safeCell(12), 12, "numbers stay numbers");

  // the existing workbook is not this module's business
  const src = fs.readFileSync(path.join(repoRoot, "src", "night-report.js"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  checks.ok(!/TABLE PLAN|GUEST LIST|UNASSIGNED|XLSX\.|book_new|writeFile/.test(src), "the module builds no workbook and names no existing sheet — TABLE PLAN / GUEST LIST / UNASSIGNED are untouched");
  checks.equal(JSON.stringify(ev), before, "building the report changes nothing");

  const empty = N.build({ id: "x", name: "Boş", date: "2026-01-01", tables: [], guests: [] });
  checks.equal([empty.firstArrival, empty.lastArrival, empty.hosts.length, empty.seats.capacity], [null, null, 0, 0], "an empty event is an empty report, not an error");
}
