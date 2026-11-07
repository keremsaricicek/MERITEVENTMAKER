// NIGHT-END REPORT — one event, one page (owner-approved 2026-11-07).
//
// Pure and READ-ONLY: build(event) returns plain data; summaryRows(report, label)
// returns the rows of ONE summary sheet (array of arrays) for the caller to put
// in a workbook. It builds no workbook and leaves the existing export (TABLE
// PLAN / GUEST LIST / UNASSIGNED) exactly as it is.
//
//   PEOPLE, NOT RECORDS. Every figure is pax: a +3 party is four people.
//   A WALK-IN WAS NOT EXPECTED (guest.walkIn, src/walk-in.js). Walk-ins are
//     counted and listed on their own and never enter a host's expected people
//     or arrival rate. A host with nothing expected has rate null, not 0 or 1.
//   HOSTS are MeritGuestGroups.hosts (guest.invitedBy, folded), so "KEREM
//     SARICICEK" and "Kerem Sarıçiçek" are one row. No host is its own row.
//   ARRIVAL TIMES are check-in moments (guest.checkedInAt, written only by
//     setArrival). A check-in with no moment is counted as untimed, never
//     given one.
//   SEATS: logical capacity (MeritSeatModel), the PLAN's seats (a No Show's
//     included) vs TONIGHT's (MeritOccupancy.liveUsedIndexes, a No Show's freed)
//     — kept apart, as everywhere in the product.
//   FORMULA-SAFE: every text cell starting with = + - @ (or tab/CR) gets a
//     leading quote — the exportJunketReport rule (screen-reports.js).
(function () {
  "use strict";

  const SEATS = () => globalThis.MeritSeatModel;
  const OCC = () => globalThis.MeritOccupancy;
  const GROUPS = () => globalThis.MeritGuestGroups;
  const fold = (s) => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const paxOf = (g) => Math.max(1, Number(g && g.pax) || 1);
  const sumPax = (gs) => gs.reduce((n, g) => n + paxOf(g), 0);
  const came = (g) => g.arrivalStatus === "Checked In";
  const isWalkIn = (g) => g.walkIn === true;

  const safeCell = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);

  function hostGroups(event) {
    const G = GROUPS();
    const listed = G && G.hosts ? G.hosts(event) : (() => {
      const m = new Map();
      for (const g of event.guests || []) { const k = fold(g.invitedBy); if (!k) continue; if (!m.has(k)) m.set(k, { host: String(g.invitedBy).trim(), guests: [] }); m.get(k).guests.push(g); }
      return [...m.values()];
    })();
    const none = (event.guests || []).filter((g) => !fold(g.invitedBy));
    return none.length ? [...listed, { host: null, guests: none }] : listed;
  }

  function seatSets(event, table) {
    const planned = new Set(), arrived = new Set();
    for (const g of event.guests || []) {
      if (!g.assignment || g.assignment.tableId !== table.id) continue;
      for (const s of g.assignment.seats || []) { planned.add(Number(s)); if (came(g)) arrived.add(Number(s)); }
    }
    const O = OCC();
    const live = O && O.liveUsedIndexes ? O.liveUsedIndexes(event, table.id)
      : new Set((event.guests || []).filter((g) => g.arrivalStatus !== "No Show" && g.assignment && g.assignment.tableId === table.id).flatMap((g) => (g.assignment.seats || []).map(Number)));
    return { planned, live, arrived };
  }

  function build(event) {
    const ev = event || {};
    const guests = ev.guests || [], tables = ev.tables || [];
    const listed = guests.filter((g) => !isWalkIn(g)), walk = guests.filter(isWalkIn);
    const tableNo = (g) => { const t = g.assignment ? tables.find((x) => x.id === g.assignment.tableId) : null; return t ? String(t.number) : null; };

    const people = {
      expected: sumPax(listed),
      arrived: sumPax(listed.filter(came)),
      noShow: sumPax(listed.filter((g) => g.arrivalStatus === "No Show")),
      notArrived: sumPax(listed.filter((g) => !g.arrivalStatus || g.arrivalStatus === "Not Arrived")),
      walkIns: sumPax(walk),
      inRoom: sumPax(guests.filter(came)),
    };

    const hosts = hostGroups(ev).map((h) => {
      const l = h.guests.filter((g) => !isWalkIn(g)), w = h.guests.filter(isWalkIn);
      const expected = sumPax(l), arrived = sumPax(l.filter(came));
      return { host: h.host, expected, arrived, noShow: sumPax(l.filter((g) => g.arrivalStatus === "No Show")),
        walkIns: sumPax(w), rate: expected ? arrived / expected : null };
    });

    const stamps = guests.filter(came).map((g) => g.checkedInAt).filter((s) => s && isFinite(new Date(s).getTime()))
      .sort((a, b) => new Date(a) - new Date(b));
    const untimedArrivals = guests.filter((g) => came(g) && !(g.checkedInAt && isFinite(new Date(g.checkedInAt).getTime()))).length;

    const S = SEATS();
    const seatable = tables.filter((t) => (S ? S.canSeat(t) : (Number(t.capacity) || 0) > 0));
    const seats = { capacity: 0, planned: 0, heldTonight: 0, seatedArrived: 0, empty: 0, freedByNoShow: 0, arrivedUnseated: 0 };
    for (const t of seatable) {
      const cap = S ? S.logicalSeatCount(t) : Math.max(0, Math.trunc(Number(t.capacity) || 0));
      const inCap = (set) => [...set].filter((i) => i >= 0 && i < cap).length;
      const s = seatSets(ev, t);
      seats.capacity += cap; seats.planned += inCap(s.planned); seats.heldTonight += inCap(s.live); seats.seatedArrived += inCap(s.arrived);
    }
    seats.empty = Math.max(0, seats.capacity - seats.seatedArrived);
    seats.freedByNoShow = Math.max(0, seats.planned - seats.heldTonight);
    seats.arrivedUnseated = sumPax(guests.filter((g) => came(g) && !g.assignment));

    const entry = (g) => ({ guestId: g.id, name: String(g.name || ""), pax: paxOf(g), host: String(g.invitedBy || "").trim() || null, table: tableNo(g) });
    return {
      eventId: ev.id || null, name: ev.name || "", date: ev.date || "",
      people, hosts,
      firstArrival: stamps[0] || null, lastArrival: stamps[stamps.length - 1] || null, untimedArrivals,
      noShows: guests.filter((g) => g.arrivalStatus === "No Show").map(entry),
      walkIns: walk.map((g) => ({ ...entry(g), at: g.walkInAt || null, arrival: g.arrivalStatus || "Not Arrived" })),
      seats,
    };
  }

  const DEFAULT_LABELS = {
    title: "NIGHT-END REPORT", event: "EVENT", date: "DATE",
    people: "PEOPLE", expected: "EXPECTED", arrived: "ARRIVED", noShow: "NO SHOW", notArrived: "NOT ARRIVED", walkIns: "WALK-INS", inRoom: "IN THE ROOM",
    hosts: "BY HOST", host: "HOST", rate: "ARRIVAL RATE", noHost: "(NO HOST)",
    arrivals: "ARRIVALS", firstArrival: "FIRST ARRIVAL", lastArrival: "LAST ARRIVAL", untimed: "CHECKED IN WITHOUT A TIME",
    seats: "SEATS", capacity: "CAPACITY", planned: "PLANNED SEATS", heldTonight: "HELD TONIGHT", seatedArrived: "OCCUPIED BY ARRIVED", empty: "EMPTY SEATS",
    freedByNoShow: "FREED BY NO SHOW", arrivedUnseated: "ARRIVED WITHOUT A TABLE",
    noShowList: "NO SHOWS", walkInList: "WALK-INS", guest: "GUEST", pax: "PAX", table: "TABLE", at: "AT", none: "—",
  };

  // HH:MM in the operator's own timezone (the door's) — the same reading
  // MeritArrivalWave makes of a stamp.
  function clock(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (!isFinite(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function summaryRows(report, label) {
    const r = report || build({});
    const L = (k) => { const v = typeof label === "function" ? label(k) : null; return v == null || v === "" ? DEFAULT_LABELS[k] : v; };
    const rate = (x) => (x == null ? L("none") : `${Math.round(x * 100)}%`);
    const rows = [
      [L("title")],
      [L("event"), r.name], [L("date"), r.date],
      [],
      [L("people"), L("expected"), L("arrived"), L("noShow"), L("notArrived"), L("walkIns"), L("inRoom")],
      ["", r.people.expected, r.people.arrived, r.people.noShow, r.people.notArrived, r.people.walkIns, r.people.inRoom],
      [],
      [L("hosts")],
      [L("host"), L("expected"), L("arrived"), L("noShow"), L("walkIns"), L("rate")],
      ...r.hosts.map((h) => [h.host == null ? L("noHost") : h.host, h.expected, h.arrived, h.noShow, h.walkIns, rate(h.rate)]),
      [],
      [L("arrivals")],
      [L("firstArrival"), clock(r.firstArrival) || L("none")],
      [L("lastArrival"), clock(r.lastArrival) || L("none")],
      [L("untimed"), r.untimedArrivals],
      [],
      [L("seats")],
      [L("capacity"), r.seats.capacity], [L("planned"), r.seats.planned], [L("heldTonight"), r.seats.heldTonight],
      [L("seatedArrived"), r.seats.seatedArrived], [L("empty"), r.seats.empty], [L("freedByNoShow"), r.seats.freedByNoShow],
      [L("arrivedUnseated"), r.seats.arrivedUnseated],
      [],
      [L("noShowList")],
      [L("guest"), L("pax"), L("host"), L("table")],
      ...r.noShows.map((x) => [x.name, x.pax, x.host || "", x.table || ""]),
      [],
      [L("walkInList")],
      [L("guest"), L("pax"), L("host"), L("table"), L("at")],
      ...r.walkIns.map((x) => [x.name, x.pax, x.host || "", x.table || "", clock(x.at)]),
    ];
    return rows.map((row) => row.map(safeCell));
  }

  globalThis.MeritNightReport = Object.freeze({ version: 1, build, summaryRows, safeCell, DEFAULT_LABELS });
})();
