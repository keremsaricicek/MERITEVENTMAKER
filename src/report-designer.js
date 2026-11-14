// REPORT DESIGNER — the pure half of Raporlar → "Rapor tasarımcısı".
//
// Owner (binding): "Reporting must always be detailed, so you can build any
// report you want; the preview must be visible; and PDF output on request."
//
// This module decides WHAT a designed report contains: which guest records
// (filters), in which order (sort), under which headings (group-by), with which
// columns, and how the lines fall onto sheets of paper (paging). It reads an
// event and writes nothing — not the event, not storage, not the DOM. The screen
// (src/screen-reports.js) renders it, prints it (the browser's print-to-PDF via
// the print stylesheet — no network, no library) and hands sheetRows() to
// SheetJS. The one-click TABLE PLAN / GUEST LIST / UNASSIGNED workbook is NOT
// built here and is not touched (report-xlsx-identity guards its bytes).
//
// Domain rules it keeps:
//   ONE RECORD PER PARTY. "Name +3" is one row with 4 people; totals count
//     records and people (pax) from records only. With "companions" on, the
//     party's other people are drawn as lines under it — "GUEST OF [PRIMARY]",
//     uppercased exactly like the workbook — and never counted twice.
//   PLANNING ≠ ARRIVAL. Two separate filters, two separate columns.
//   NO SHOW KEEPS ITS PLANNED SEAT. A No Show still shows its table and seats.
//
// Helpers that need the app (labels, table numbering, natural sort) are
// INJECTED per call; the module never reads the shell's globals.
(() => {
  "use strict";

  const COLUMNS = Object.freeze(["name", "pax", "table", "seat", "zone", "host", "vip", "planning", "arrival", "checkedIn", "phone", "notes"]);
  const GROUPS = Object.freeze(["none", "table", "zone", "host", "arrival", "planning", "vip"]);
  const SORTS = Object.freeze(["table", "name", "pax", "host", "arrival", "zone"]);
  const PAPERS = Object.freeze(["A4-portrait", "A4-landscape", "A3-portrait", "A3-landscape"]);
  const FONTS = Object.freeze([9, 10, 11, 12, 13, 14]);
  const PLANNING = Object.freeze(["Confirmed", "Tentative"]);
  const ARRIVAL = Object.freeze(["Not Arrived", "Checked In", "No Show"]);
  // The two values of the table filter that are not a table id.
  const UNASSIGNED = "__none__", ASSIGNED = "__any__";

  const FILTERS0 = Object.freeze({ q: "", planning: "", arrival: "", vip: "", table: "", zone: "", host: "" });
  // A kind is a starting point, not a cage: every control stays editable after.
  const KINDS = Object.freeze({
    guests: { cols: ["name", "pax", "table", "seat", "host", "vip", "planning", "arrival"], sort: "name", groupBy: "none", companions: false, filters: {} },
    tablePlan: { cols: ["table", "seat", "name", "pax", "vip", "host"], sort: "table", groupBy: "table", companions: true, filters: { table: ASSIGNED } },
    unassigned: { cols: ["name", "pax", "host", "vip", "planning", "phone"], sort: "name", groupBy: "none", companions: false, filters: { table: UNASSIGNED } },
    arrivals: { cols: ["name", "pax", "table", "arrival", "checkedIn", "host"], sort: "name", groupBy: "arrival", companions: false, filters: {} },
    hosts: { cols: ["name", "pax", "table", "arrival", "vip"], sort: "name", groupBy: "host", companions: false, filters: {} },
    vip: { cols: ["name", "vip", "pax", "table", "seat", "host", "notes"], sort: "table", groupBy: "none", companions: false, filters: { vip: "vip" } },
    zone: { cols: ["table", "name", "pax", "vip", "arrival"], sort: "table", groupBy: "zone", companions: false, filters: {} },
    custom: null,
  });
  const KIND_NAMES = Object.freeze(Object.keys(KINDS));

  const str = (v, max) => String(v == null ? "" : v).slice(0, max || 200);
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const paxOf = (g) => Math.max(1, Number(g && g.pax) || 1);
  const fold = (s) => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").trim();
  const isVip = (g) => /VIP/i.test(String((g && g.vip) || ""));
  const plainSort = (a, b) => String(a).localeCompare(String(b), "tr", { numeric: true, sensitivity: "base" });

  // Any stored or typed design comes through here: unknown keys dropped, every
  // value clamped to what the screen can draw. A template from an older build
  // (merit.reportTemplates.v1: {cols, filters:{name,group,table,vip,arrival}})
  // is read too — its fields are mapped, not lost.
  function normalize(input) {
    const d = input && typeof input === "object" ? input : {};
    const f = d.filters && typeof d.filters === "object" ? d.filters : {};
    const filters = {
      q: str(f.q != null ? f.q : f.name, 80),
      planning: pick(f.planning, PLANNING, ""),
      arrival: pick(f.arrival, ARRIVAL, ""),
      vip: f.vip === true || f.vip === "vip" ? "vip" : f.vip === "standard" ? "standard" : "",
      table: str(f.table, 80),
      zone: str(f.zone, 80),
      host: str(f.host != null ? f.host : f.group, 120),
    };
    const cols = (Array.isArray(d.cols) ? d.cols : KINDS.guests.cols).filter((c, i, a) => COLUMNS.includes(c) && a.indexOf(c) === i);
    const sort = d.sort && typeof d.sort === "object" ? d.sort : {};
    return {
      kind: pick(d.kind, KIND_NAMES, "custom"),
      cols: cols.length ? cols : ["name"],
      filters,
      sort: { by: pick(sort.by, SORTS, "table"), dir: sort.dir === "desc" ? "desc" : "asc" },
      groupBy: pick(d.groupBy, GROUPS, "none"),
      companions: d.companions === true,
      title: str(d.title, 160),
      subtitle: str(d.subtitle, 240),
      showEvent: d.showEvent !== false,
      logo: /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(String(d.logo || "")) && String(d.logo).length <= 560000 ? String(d.logo) : "",
      paper: pick(d.paper, PAPERS, "A4-portrait"),
      font: FONTS.includes(Number(d.font)) ? Number(d.font) : 12,
    };
  }
  function defaults() { return applyKind(normalize({}), "guests"); }
  // Choosing a kind resets the WHAT (columns, filters, sort, grouping) and keeps
  // the HOW (title, logo, paper, font). "custom" changes nothing.
  function applyKind(design, kind) {
    const d = normalize(design), k = KINDS[kind];
    if (!k) return Object.assign(d, { kind: "custom" });
    return Object.assign(d, {
      kind, cols: k.cols.slice(), filters: Object.assign({}, FILTERS0, k.filters),
      sort: { by: k.sort, dir: "asc" }, groupBy: k.groupBy, companions: k.companions,
    });
  }

  function tableIndex(event) { return new Map(((event && event.tables) || []).map((t) => [t.id, t])); }
  function rows(event, design) {
    const d = normalize(design), f = d.filters, q = fold(f.q), byId = tableIndex(event);
    return ((event && event.guests) || []).map((g) => ({ g, tb: (g.assignment && byId.get(g.assignment.tableId)) || null })).filter(({ g, tb }) => {
      if (q && ![g.name, g.invitedBy, g.phone, g.notes].some((v) => fold(v).includes(q))) return false;
      if (f.planning && (g.planningStatus || "Confirmed") !== f.planning) return false;
      if (f.arrival && (g.arrivalStatus || "Not Arrived") !== f.arrival) return false;
      if (f.vip === "vip" && !isVip(g)) return false;
      if (f.vip === "standard" && isVip(g)) return false;
      if (f.table === UNASSIGNED && tb) return false;
      if (f.table === ASSIGNED && !tb) return false;
      if (f.table && f.table !== UNASSIGNED && f.table !== ASSIGNED && !(tb && tb.id === f.table)) return false;
      if (f.zone && !(tb && String(tb.zone || "") === f.zone)) return false;
      if (f.host && fold(g.invitedBy) !== fold(f.host)) return false;
      return true;
    });
  }
  function sortRows(list, sort, h) {
    const ns = (h && h.naturalSort) || plainSort, dir = sort.dir === "desc" ? -1 : 1;
    const tableKey = (r) => (r.tb ? String(r.tb.number) : "");
    const byTable = (a, b) => (a.tb ? 0 : 1) - (b.tb ? 0 : 1) || ns(tableKey(a), tableKey(b));
    const byName = (a, b) => plainSort(a.g.name || "", b.g.name || "");
    const key = {
      table: byTable,
      name: byName,
      pax: (a, b) => paxOf(a.g) - paxOf(b.g),
      host: (a, b) => plainSort(a.g.invitedBy || "￿", b.g.invitedBy || "￿"),
      arrival: (a, b) => ARRIVAL.indexOf(a.g.arrivalStatus || "Not Arrived") - ARRIVAL.indexOf(b.g.arrivalStatus || "Not Arrived"),
      zone: (a, b) => plainSort((a.tb && a.tb.zone) || "￿", (b.tb && b.tb.zone) || "￿"),
    }[sort.by] || byTable;
    // The chosen key decides; ties fall back to table then name, so the order
    // is total and the same every time.
    return list.slice().sort((a, b) => dir * key(a, b) || byTable(a, b) || byName(a, b) || plainSort(a.g.id || "", b.g.id || ""));
  }
  function label(h, key, fallback) { const v = h && h.t ? h.t(key) : null; return v && v !== key ? v : fallback; }
  function tableLabel(tb, h) { return tb ? ((h && h.formatTableNumber) ? h.formatTableNumber(tb.number) : String(tb.number)) : ""; }
  function clock(iso) { const m = /T(\d\d):(\d\d)/.exec(String(iso || "")); if (!m) return ""; const d = new Date(iso); return isNaN(d) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function cell(col, r, h) {
    const g = r.g, seats = g.assignment && Array.isArray(g.assignment.seats) ? g.assignment.seats : [];
    switch (col) {
      case "name": return str(g.name, 200);
      case "pax": return String(paxOf(g));
      case "table": return r.tb ? tableLabel(r.tb, h) : "—";
      case "seat": return r.tb && seats.length ? seats.map((n) => "S" + (Number(n) + 1)).join(", ") : "—";
      case "zone": return r.tb ? str(r.tb.zone, 80) : "";
      case "host": return str(g.invitedBy, 120);
      case "vip": return isVip(g) ? str(g.vip, 20) : "";
      case "planning": return label(h, "status.planning." + (g.planningStatus || "Confirmed"), g.planningStatus || "Confirmed");
      case "arrival": return label(h, "status.arrival." + (g.arrivalStatus || "Not Arrived"), g.arrivalStatus || "Not Arrived");
      case "checkedIn": return g.arrivalStatus === "Checked In" ? clock(g.checkedInAt) : "";
      case "phone": return str(g.phone, 60);
      case "notes": return str(g.notes, 400);
      default: return "";
    }
  }
  // A companion line: the party's k-th extra person, the k-th seat when one is
  // planned. Name and seat only — pax stays with the record.
  function companionCells(cols, r, k, h) {
    const seats = r.g.assignment && Array.isArray(r.g.assignment.seats) ? r.g.assignment.seats : [];
    return cols.map((c) => {
      if (c === "name") return "GUEST OF " + String(r.g.name || "").toUpperCase();
      if (c === "seat") return r.tb && seats[k] != null ? "S" + (Number(seats[k]) + 1) : "—";
      if (c === "table") return r.tb ? tableLabel(r.tb, h) : "—";
      return "";
    });
  }
  function groupKey(by, r, h) {
    const g = r.g;
    if (by === "table") return r.tb ? { key: "t:" + r.tb.id, label: tableLabel(r.tb, h), sortKey: [0, String(r.tb.number)] } : { key: "t:", label: label(h, "rd.g.noTable", "No table"), sortKey: [1, ""] };
    if (by === "zone") { const z = r.tb ? String(r.tb.zone || "") : ""; return z ? { key: "z:" + z, label: z, sortKey: [0, z] } : { key: "z:", label: label(h, "rd.g.noZone", "No zone"), sortKey: [1, ""] }; }
    if (by === "host") { const x = String(g.invitedBy || "").trim(); return x ? { key: "h:" + fold(x), label: x, sortKey: [0, x] } : { key: "h:", label: label(h, "rd.g.noHost", "No host"), sortKey: [1, ""] }; }
    if (by === "arrival") { const a = g.arrivalStatus || "Not Arrived"; return { key: "a:" + a, label: cell("arrival", r, h), sortKey: [ARRIVAL.indexOf(a), ""] }; }
    if (by === "planning") { const p = g.planningStatus || "Confirmed"; return { key: "p:" + p, label: cell("planning", r, h), sortKey: [PLANNING.indexOf(p), ""] }; }
    if (by === "vip") { const v = isVip(g) ? String(g.vip) : ""; return v ? { key: "v:" + v, label: v, sortKey: [v === "VVIP" ? 0 : 1, v] } : { key: "v:", label: label(h, "rd.g.standard", "Standard"), sortKey: [2, ""] }; }
    return { key: "all", label: "", sortKey: [0, ""] };
  }

  // The whole report as data: columns, groups (each with its own records/pax),
  // every line in order, and the totals. Lines are { type: "row" | "companion",
  // cells, guestId }.
  function build(event, design, h) {
    const d = normalize(design), cols = d.cols;
    const sorted = sortRows(rows(event, d), d.sort, h);
    const ns = (h && h.naturalSort) || plainSort, groups = new Map();
    for (const r of sorted) {
      const k = groupKey(d.groupBy, r, h);
      if (!groups.has(k.key)) groups.set(k.key, { key: k.key, label: k.label, sortKey: k.sortKey, records: 0, pax: 0, lines: [] });
      const grp = groups.get(k.key);
      grp.records += 1; grp.pax += paxOf(r.g);
      grp.lines.push({ type: "row", guestId: r.g.id, cells: cols.map((c) => cell(c, r, h)) });
      if (d.companions) for (let i = 1; i < paxOf(r.g); i++) grp.lines.push({ type: "companion", guestId: r.g.id, cells: companionCells(cols, r, i, h) });
    }
    const list = [...groups.values()].sort((a, b) => a.sortKey[0] - b.sortKey[0] || ns(a.sortKey[1], b.sortKey[1]));
    list.forEach((x) => delete x.sortKey);
    return {
      design: d, columns: cols.slice(), grouped: d.groupBy !== "none", groups: list,
      totals: { records: sorted.length, pax: sorted.reduce((n, r) => n + paxOf(r.g), 0) },
    };
  }

  // ---- paper ----------------------------------------------------------------
  // Millimetres, so the preview sheet and the printed sheet are the same box.
  const SIZE = { A4: [210, 297], A3: [297, 420] };
  const MARGIN = 12, HEAD_MM = 26, FOOT_MM = 8;
  function pageBox(paper) {
    const [size, orient] = String(pick(paper, PAPERS, "A4-portrait")).split("-"), [w, hgt] = SIZE[size];
    return orient === "landscape" ? { w: hgt, h: w, margin: MARGIN } : { w, h: hgt, margin: MARGIN };
  }
  // One printed line at this font: line-height 1.3 plus 2 × 1.1 mm padding.
  function lineMm(font) { return Number(font) * 0.3528 * 1.3 + 2.2; }
  // How many lines a row takes: a long cell wraps (at most 3 lines, the CSS
  // clamp), estimated from its length against an even share of the width.
  function lineWeight(line, ncols, box, font) {
    const colMm = (box.w - 2 * box.margin) / Math.max(1, ncols), charMm = Number(font) * 0.3528 * 0.52;
    const perLine = Math.max(4, Math.floor(colMm / charMm));
    return Math.min(3, Math.max(1, ...line.cells.map((c) => Math.ceil(String(c).length / perLine) || 1)));
  }
  // Pages, each a list of { group, cont, lines }. The first page carries the
  // document head; every page repeats the column header; a group that runs on
  // carries its heading again, marked as continued.
  function paginate(report) {
    const d = report.design, box = pageBox(d.paper), lh = lineMm(d.font), n = report.columns.length;
    const usable = (first) => box.h - 2 * box.margin - FOOT_MM - (first ? HEAD_MM : 0) - lh; // minus the column header
    const pages = [];
    let page = null, left = 0;
    const newPage = () => { page = { parts: [] }; pages.push(page); left = usable(pages.length === 1); };
    newPage();
    for (const grp of report.groups) {
      const headMm = report.grouped ? lh * 1.2 : 0;
      let part = null;
      const openPart = (cont) => { part = { group: grp, cont, lines: [] }; page.parts.push(part); left -= headMm; };
      if (left < headMm + lh && page.parts.length) newPage();
      openPart(false);
      for (const line of grp.lines) {
        const need = lineWeight(line, n, box, d.font) * lh;
        if (need > left && part.lines.length) { newPage(); openPart(true); }
        part.lines.push(line); left -= need;
      }
    }
    return { box, lineMm: lh, pages };
  }

  // ---- Excel ----------------------------------------------------------------
  // One sheet as an array of arrays: title lines, the header, then group
  // headings, rows and companion lines, and the totals. A cell that starts like
  // a formula is written as text (the exportJunketReport rule).
  const safe = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
  function sheetRows(report, head, h) {
    const out = [];
    for (const line of (head || []).filter(Boolean)) out.push([safe(String(line))]);
    if (out.length) out.push([]);
    const cols = report.columns;
    out.push(cols.map((c) => label(h, "rd.col." + c, c)));
    const paxAt = cols.indexOf("pax");
    for (const grp of report.groups) {
      if (report.grouped) out.push([safe(grp.label + " — " + label(h, "rd.groupCount", "{records} / {pax}").replace("{records}", grp.records).replace("{pax}", grp.pax))]);
      for (const line of grp.lines) out.push(line.cells.map((c, i) => (i === paxAt && line.type === "row" ? Number(c) : safe(c))));
    }
    out.push([]);
    out.push([label(h, "rd.total", "Total"), report.totals.records, report.totals.pax]);
    return out;
  }

  // ---- templates --------------------------------------------------------------
  // A template is a named design. Stored by the screen on THIS machine, per
  // event id, outside the event record — so saving one never mutates an event
  // and is allowed for a historical (read-only) event too.
  function template(name, design) {
    const n = str(name, 80).trim();
    if (!n) return null;
    return Object.assign({ name: n }, normalize(design));
  }
  function templates(list) {
    return (Array.isArray(list) ? list : []).filter((x) => x && typeof x.name === "string" && x.name.trim())
      .map((x) => template(x.name, x)).filter(Boolean);
  }
  function upsert(list, tpl) { const l = templates(list).filter((x) => x.name !== tpl.name); l.push(tpl); return l; }

  globalThis.MeritReportDesigner = Object.freeze({
    COLUMNS, GROUPS, SORTS, PAPERS, FONTS, KINDS: Object.freeze(KIND_NAMES.slice()), UNASSIGNED, ASSIGNED,
    normalize, defaults, applyKind, rows, build, paginate, pageBox, sheetRows, template, templates, upsert, paxOf,
  });
})();
