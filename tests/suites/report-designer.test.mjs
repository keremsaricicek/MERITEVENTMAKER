// REPORT DESIGNER — pure module (src/report-designer.js). What it guards:
//
//   ONE RECORD PER PARTY. "Name +3" is one row, 4 people; totals are records
//     and pax from records. Companion lines read "GUEST OF [PRIMARY]" uppercased
//     (the workbook's wording), sit on the party's own seats, and are never
//     counted as records or people.
//   PLANNING ≠ ARRIVAL. Filtering one never reads the other.
//   NO SHOW KEEPS ITS PLANNED SEAT in every kind.
//   COLUMNS: chosen and ordered by the design; unknown ones dropped.
//   FILTERS: search (name/host/phone/notes, Turkish-folded), planning, arrival,
//     VIP, table / unassigned / assigned, zone, host (folded).
//   SORT and GROUP-BY: deterministic; groups carry their own records and pax.
//   KINDS: guest list, table plan, unassigned, arrivals, hosts, VIP, zone.
//   PAGING: every line lands on exactly one page, A3 holds more than A4,
//     a bigger font needs more pages, a continued group says so.
//   EXCEL ROWS: formula-safe, totals right. TEMPLATES: sanitised, upserted,
//     an older v1 template's fields mapped.
//   READ-ONLY: the event is byte-identical after everything.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const meta = { name: "report-designer", tags: ["business", "reports", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  const ctx = vm.createContext({});
  const p = path.join(repoRoot, "src", "report-designer.js");
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: p });
  const R = ctx.MeritReportDesigner;
  checks.require(!!R && typeof R.build === "function" && typeof R.paginate === "function" && typeof R.sheetRows === "function",
    "MeritReportDesigner loads outside the browser with build(), paginate() and sheetRows()");

  const g = (id, name, pax, extra = {}) => ({ id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: "", notes: "", phone: "",
    planningStatus: "Confirmed", arrivalStatus: "Not Arrived", checkedInAt: null, assignment: null, ...extra });
  const ev = {
    id: "e1", name: "Gala", date: "2099-01-10",
    tables: [{ id: "t1", number: "T01", zone: "Salon", capacity: 10, chairs: [] }, { id: "t2", number: "T10", zone: "Salon", capacity: 6, chairs: [] },
      { id: "t3", number: "T02", zone: "Teras", capacity: 4, chairs: [] }],
    guests: [
      g("a", "Kerem Sarıçiçek", 4, { vip: "VIP", invitedBy: "Junket A", assignment: { tableId: "t1", seats: [0, 1, 2, 3] } }),
      g("b", "Ayşe Demir", 1, { arrivalStatus: "No Show", invitedBy: "junket a", assignment: { tableId: "t2", seats: [4] } }),
      g("c", "=HYPERLINK(\"x\")", 1, { planningStatus: "Tentative", arrivalStatus: "Checked In", checkedInAt: "2099-01-10T20:05:00", assignment: { tableId: "t3", seats: [0] } }),
      g("d", "Işıl Öztürk", 2, { vip: "VVIP", phone: "0555", notes: "vejetaryen" }),
      g("e", "Burak Şahin", 1, { planningStatus: "Tentative", invitedBy: "Milica" }),
    ],
  };
  const before = JSON.stringify(ev);
  const H = { t: (k) => "~" + k, formatTableNumber: (n) => n, naturalSort: (a, b) => String(a).localeCompare(String(b), "tr", { numeric: true }) };
  const build = (patch, kind) => R.build(ev, Object.assign(kind ? R.applyKind({}, kind) : R.defaults(), patch || {}), H);
  const names = (rep) => rep.groups.flatMap((x) => x.lines.filter((l) => l.type === "row").map((l) => l.guestId));

  // ---- one record per party, companions ----
  let rep = build({ cols: ["name", "pax", "table", "seat"], sort: { by: "table" } });
  checks.equal(rep.totals, { records: 5, pax: 9 }, "totals: 5 records, 9 people (a +3 is four people, one record)");
  checks.equal(rep.groups[0].lines.filter((l) => l.type === "row").length, 5, "one row per record, never split");
  checks.equal(rep.groups[0].lines[0].cells, ["Kerem Sarıçiçek", "4", "T01", "S1, S2, S3, S4"], "a party's row shows its pax, table and all its seats");
  rep = build({ cols: ["name", "pax", "table", "seat"], sort: { by: "table" }, companions: true });
  const comp = rep.groups[0].lines.filter((l) => l.type === "companion" && l.guestId === "a");
  checks.equal(comp.map((l) => l.cells), [["GUEST OF KEREM SARIÇIÇEK", "", "T01", "S2"], ["GUEST OF KEREM SARIÇIÇEK", "", "T01", "S3"], ["GUEST OF KEREM SARIÇIÇEK", "", "T01", "S4"]],
    "companions: three GUEST OF [PRIMARY] lines (workbook uppercase), on the party's own seats, with no pax of their own");
  checks.equal(rep.totals, { records: 5, pax: 9 }, "companion lines are never counted as records or people");
  checks.equal(rep.groups[0].lines.filter((l) => l.type === "companion" && l.guestId === "d").map((l) => l.cells[3]), ["—"], "an unseated party's companion has no seat");

  // ---- columns ----
  rep = build({ cols: ["arrival", "name", "bogus", "name", "planning"] });
  checks.equal(rep.columns, ["arrival", "name", "planning"], "columns keep the chosen order; unknown and duplicate columns are dropped");

  // ---- filters ----
  const only = (filters, extra) => names(build(Object.assign({ filters: Object.assign({}, R.defaults().filters, filters) }, extra || {}))).sort();
  checks.equal(only({ q: "isil" }), ["d"], "search folds Turkish letters (isil finds Işıl)");
  checks.equal(only({ q: "vejet" }), ["d"], "search reads notes too");
  checks.equal(only({ planning: "Tentative" }), ["c", "e"], "planning filter: Tentative only");
  checks.equal(only({ arrival: "Not Arrived" }), ["a", "d", "e"], "arrival filter is independent of planning (Tentative Burak still Not Arrived)");
  checks.equal(only({ arrival: "No Show" }), ["b"], "No Show filter");
  checks.equal(only({ vip: "vip" }), ["a", "d"], "VIP filter takes VIP and VVIP");
  checks.equal(only({ vip: "standard" }), ["b", "c", "e"], "standard-only filter");
  checks.equal(only({ table: R.UNASSIGNED }), ["d", "e"], "unassigned filter");
  checks.equal(only({ table: "t2" }), ["b"], "a No Show stays on its planned table");
  checks.equal(only({ zone: "Teras" }), ["c"], "zone filter");
  checks.equal(only({ host: "JUNKET A" }), ["a", "b"], "host filter is folded (Junket A = junket a)");

  // ---- sort ----
  checks.equal(names(build({ sort: { by: "table", dir: "asc" } })), ["a", "c", "b", "e", "d"], "table sort is natural (T01, T02, T10), unseated last, then name (Turkish: Burak before Işıl)");
  checks.equal(names(build({ sort: { by: "pax", dir: "desc" } })), ["a", "d", "c", "b", "e"], "pax descending, ties by table then name");
  checks.equal(names(build({ sort: { by: "name", dir: "asc" } })).slice(1), ["b", "e", "d", "a"], "name sort in Turkish order");

  // ---- group by ----
  rep = build({ groupBy: "host" });
  checks.equal(rep.groups.map((x) => [x.label.toLowerCase(), x.records, x.pax]), [["junket a", 2, 5], ["milica", 1, 1], ["~rd.g.nohost", 2, 3]],
    "group by host: one group per host however it was typed, each with its own records and people; no host last");
  rep = build({ groupBy: "arrival" });
  checks.equal(rep.groups.map((x) => x.key), ["a:Not Arrived", "a:Checked In", "a:No Show"], "group by arrival in the arrival order");
  rep = build({ groupBy: "table" });
  checks.equal(rep.groups.map((x) => x.label), ["T01", "T02", "T10", "~rd.g.noTable"], "group by table, natural order, no table last");

  // ---- kinds ----
  rep = build({}, "tablePlan");
  checks.ok(rep.design.companions && rep.grouped && names(rep).every((id) => ["a", "b", "c"].includes(id)), "table plan: seated records by table, with companions");
  checks.equal(names(build({}, "unassigned")).sort(), ["d", "e"], "unassigned kind: only records without a table");
  checks.equal(names(build({}, "vip")).sort(), ["a", "d"], "VIP kind");
  checks.equal(build({}, "zone").groups.map((x) => x.label), ["Salon", "Teras", "~rd.g.noZone"], "zone kind groups by zone");
  const arr = build({}, "arrivals");
  checks.ok(arr.columns.includes("checkedIn") && arr.groups.find((x) => x.key === "a:Checked In").lines[0].cells[arr.columns.indexOf("checkedIn")] === "20:05",
    "arrivals kind: grouped by arrival, the check-in time shown");
  const kept = R.applyKind(Object.assign(R.defaults(), { title: "X", paper: "A3-landscape", font: 10 }), "hosts");
  checks.equal([kept.title, kept.paper, kept.font, kept.groupBy], ["X", "A3-landscape", 10, "host"], "a kind resets what is shown, keeps title/paper/font");

  // ---- paging ----
  const many = { id: "m", name: "M", tables: ev.tables, guests: Array.from({ length: 140 }, (_, i) => g("m" + i, "Guest " + i, 1 + (i % 3), { invitedBy: "H" + (i % 4), assignment: i % 5 ? { tableId: "t1", seats: [i] } : null })) };
  const pg = (patch) => R.paginate(R.build(many, Object.assign(R.defaults(), patch), H));
  const a4 = pg({}), a3 = pg({ paper: "A3-portrait" }), big = pg({ font: 14 });
  const count = (x) => x.pages.reduce((n, p) => n + p.parts.reduce((m, q) => m + q.lines.length, 0), 0);
  checks.equal(count(a4), 140, "every line lands on exactly one page");
  checks.ok(a4.pages.length > 1 && a3.pages.length < a4.pages.length && big.pages.length > a4.pages.length,
    "A3 needs fewer pages than A4; 14 pt needs more than 12 pt", { a4: a4.pages.length, a3: a3.pages.length, big: big.pages.length });
  checks.equal([a4.box.w, a4.box.h, pg({ paper: "A4-landscape" }).box.w], [210, 297, 297], "paper boxes in millimetres");
  const grp = pg({ groupBy: "host", companions: true });
  checks.ok(grp.pages.some((p, i) => i > 0 && p.parts[0].cont === true), "a group that runs onto the next page is marked continued");

  // ---- excel rows ----
  rep = build({ cols: ["name", "pax"], groupBy: "none" });
  const aoa = R.sheetRows(rep, ["Gala", "", "sub"], H);
  checks.equal(aoa[0], ["Gala"], "title lines first, blanks skipped");
  checks.ok(aoa.some((r) => r[0] === "'=HYPERLINK(\"x\")"), "a formula-looking name is written as text");
  checks.ok(aoa.some((r) => r[0] === "Kerem Sarıçiçek" && r[1] === 4), "pax is a number in the sheet");
  checks.equal(aoa[aoa.length - 1], ["~rd.total", 5, 9], "the last row is the totals: records, people");

  // ---- templates ----
  const v1 = { name: "Eski", cols: ["name", "nope"], filters: { name: "ker", group: "Junket A", vip: true, arrival: "No Show" }, paper: "A9", font: 99 };
  const tp = R.templates([v1, { name: "" }, null])[0];
  checks.equal([tp.name, tp.cols, tp.filters.q, tp.filters.host, tp.filters.vip, tp.filters.arrival, tp.paper, tp.font],
    ["Eski", ["name"], "ker", "Junket A", "vip", "No Show", "A4-portrait", 12], "a v1 template is read and mapped; nonsense clamped; nameless dropped");
  const up = R.upsert([R.template("A", R.defaults()), R.template("B", R.defaults())], R.template("A", Object.assign(R.defaults(), { font: 10 })));
  checks.equal(up.map((x) => [x.name, x.font]), [["B", 12], ["A", 10]], "saving under an existing name replaces it");
  checks.equal(R.normalize({ logo: "javascript:alert(1)" }).logo, "", "a logo is only a png/jpeg data URL");

  checks.equal(JSON.stringify(ev), before, "read-only: the event is unchanged after every call");
}
