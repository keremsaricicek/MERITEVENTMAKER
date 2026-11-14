// THE SEATING SCREEN AT 3,000 RECORDS (4,500 people, 300 tables of 18 drawn
// chairs, 2,850 records seated), driven through its real controls.
//
// Measured 2026-11-12 (interleaved before/after, five rounds each, real
// Chromium): every Seating action is one full render() of a ~7,900-node
// screen (5,400 of them drawn chairs), and three things made it worse:
//   - the canvas asked "which seats are used at this table" twice per table,
//     each answer walking every guest: 600 walks of 3,000 records per render;
//     the Plan Doctor (two loops) and Smart Seating's recommendation did the
//     same per table;
//   - seating a guest with a host re-folded every guest's host once per
//     spread group (~48 ms per seating);
//   - Unassign and Lock rendered the whole app TWICE: the button's action
//     rendered, then the click bubbled to the seat row, which rendered again.
//
// So this suite holds the SHAPE (counted, no timer noise): one render per
// action — and none for a search keystroke or a table pick, which redraw only
// the list / the card and two marks (2026-11-13), checked against what a full
// render draws — one guest walk per render for the canvas, and the indexes answer
// exactly what the per-table functions answer — plus the operator's actions
// timed (median / p95 / max) against budgets from the measured p95 (rule as
// in benchmarks/perf/BUDGETS.json: max(2 x worst p95, worst p95 + 15 ms),
// rounded up to 5 ms). Budgets are never raised after a red run.
import { openApp, createBlankEvent } from "../lib/app-actions.mjs";
import { stats } from "./gala-night-scale.test.mjs";

export const meta = { name: "seating-scale", tags: ["business", "performance"], timeout: 600000 };

// Worst p95 of three runs of this suite on 2026-11-12, with a training job
// holding ~2-3 of 4 cores (the condition the owner's machine is in while a
// model trains). Sync: the action plus a forced layout, as the gala suites time.
// Timer budgets this wide catch a doubling, not a double render on one action:
// that is what the render COUNT check above is for (it fails the old code).
const BUDGET_MS = {
  openSeating: 520,   // worst p95 258.1 ms
  searchKey: 740,     // 369.4
  selectTable: 955,   // 475.4
  switchTable: 835,   // 416.9
  selectGuest: 770,   // 383.7
  assignClick: 1235,  // 616.6
  unassign: 1035,     // 516.5
  assignDrag: 1185,   // 592.4
};

function plant(RECORDS, TABLES, SEATS) {
  const FIRST = ["Ayşe", "Mehmet", "Fatma", "Mustafa", "Emine", "Ahmet", "Hatice", "Ali", "Zeynep", "Hüseyin", "Elif", "Hasan", "Meryem", "İbrahim", "Şerife", "Murat", "Sultan", "Ömer", "Hacer", "Yusuf",
    "Özlem", "Can", "Gül", "Kerem", "Selin", "Burak", "Ece", "Emre", "Deniz", "Onur", "Cansu", "Tolga", "Nur", "Serkan", "Pınar", "Barış", "Gizem", "Uğur", "Derya", "Çağla"];
  const LAST = ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk", "Aydın", "Özdemir", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara", "Koç", "Kurt", "Özkan", "Şimşek",
    "Polat", "Korkmaz", "Erdoğan", "Güneş", "Aksoy"];
  const extra = (i) => (i % 10 === 0 ? 2 : i % 10 <= 3 ? 1 : 0);
  const e = activeEvent();
  // Drawn chairs on every table: the plan carried them (this is the heavy
  // canvas, 5,400 chair nodes), so `chairs` holds real positions and stays in
  // sync with capacity — nothing here is synthesised from a number.
  e.tables = Array.from({ length: TABLES }, (_, i) => {
    const col = i % 20, row = Math.floor(i / 20), id = "tbl" + i;
    return { id, number: "T" + String(i + 1).padStart(2, "0"), type: "round", x: 120 + col * 170, y: 120 + row * 170, w: 130, h: 130,
      capacity: SEATS, zone: row < 5 ? "VIP FRONT" : "MAIN FLOOR", rotation: 0, locked: false, z: 10, hasPhysicalSeats: true,
      chairs: Array.from({ length: SEATS }, (_, s) => { const a = s / SEATS * Math.PI * 2; return { id: `ch${i}_${s}`, parentTableId: id, seatNumber: s + 1, x: 50 + Math.cos(a) * 46, y: 50 + Math.sin(a) * 46, rotation: 0 }; }) };
  });
  e.guests = Array.from({ length: RECORDS }, (_, i) => ({ id: "g" + i,
    name: `${FIRST[i % 40]} ${LAST[Math.floor(i / 40) % LAST.length]}${i >= 1000 ? " " + String.fromCharCode(65 + Math.floor(i / 1000)) : ""}`,
    additionalGuests: extra(i), pax: 1 + extra(i), planningStatus: i % 6 ? "Confirmed" : "Tentative", vip: i % 50 === 0 ? "VIP" : "Standard",
    arrivalStatus: "Not Arrived", invitedBy: i % 3 ? "" : "Host " + (i % 60), notes: "", phone: "", assignment: null, createdAt: new Date().toISOString() }));
  // 2,850 records seated in table order (planted as stored data, the shape the
  // one writer stores); the last 150 wait in the queue.
  let ti = 0, used = 0;
  for (const g of e.guests.slice(0, RECORDS - 150)) {
    if (used + g.pax > SEATS) { ti++; used = 0; }
    g.assignment = { tableId: e.tables[ti].id, seats: Array.from({ length: g.pax }, (_, k) => used + k), locked: false };
    used += g.pax;
  }
  ui.lang = "en"; saveState(); ui.tab = "seating"; render();
  return { tables: e.tables.length, records: e.guests.length, people: e.guests.reduce((n, g) => n + g.pax, 0), seated: e.guests.filter((g) => g.assignment).length };
}

export default async function run({ page, checks, baseUrl }) {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Seating Scale 3000" });
  const room = await page.evaluate(`(${plant.toString()})(3000, 300, 18)`);
  checks.require(room.tables === 300 && room.records === 3000 && room.people === 4500 && room.seated === 2850,
    "3,000 records (4,500 people) on 300 tables of 18, 2,850 seated", room);

  // --- 1. the indexes answer exactly what the per-table questions answer -----
  const hasIndex = await page.evaluate(() => typeof MeritOccupancy.plannedIndex === "function" && typeof MeritOccupancy.liveIndex === "function");
  checks.ok(hasIndex, "MeritOccupancy publishes plannedIndex and liveIndex (one pass over the guests for every table)");
  const same = !hasIndex ? ["no index"] : await page.evaluate(() => {
    const e = activeEvent(), O = MeritOccupancy;
    // the awkward cases too: a No Show (planned seat kept, live seat freed), a
    // walk-in sitting live, seat numbers stored as strings
    const ns = e.guests[5], walk = e.guests[2990], str = e.guests[7];
    const before = [ns.arrivalStatus, walk.arrivalStatus, walk.walkIn, walk.livePlacement, str.assignment.seats];
    ns.arrivalStatus = "No Show";
    walk.arrivalStatus = "Checked In"; walk.walkIn = true; walk.livePlacement = { tableId: ns.assignment.tableId, seats: ns.assignment.seats.slice(), noShowGuestIds: [ns.id] };
    str.assignment.seats = str.assignment.seats.map(String);
    const planned = O.plannedIndex(e), live = O.liveIndex(e), bad = [];
    const key = (s) => [...(s || [])].sort((a, b) => a - b).join(",");
    for (const t of e.tables) {
      if (key(planned.get(t.id)) !== key(occupiedSeatIndexes(e, t.id))) bad.push("planned " + t.id);
      if (key(live.get(t.id)) !== key(O.liveUsedIndexes(e, t.id))) bad.push("live " + t.id);
    }
    [ns.arrivalStatus, walk.arrivalStatus, walk.walkIn, walk.livePlacement, str.assignment.seats] = before;
    if (walk.walkIn === undefined) delete walk.walkIn;
    if (walk.livePlacement === undefined) delete walk.livePlacement;
    return bad;
  });
  checks.equal(same, [], "plannedIndex / liveIndex give every table exactly occupiedSeatIndexes / liveUsedIndexes (No Show keeps its planned seat and frees the live one)");

  // Smart Seating: every option and every 'not enough seats' says the free seats
  // a per-table recount says, and the host's zone is the recount's.
  const advisor = await page.evaluate(() => {
    const e = activeEvent(), bad = [];
    for (const g of [e.guests[2900], e.guests[2901], e.guests[2903], e.guests[12], e.guests[2997]]) {
      const r = MeritSeatingAdvisor.recommend({ guest: g, tables: e.tables, guests: e.guests, limit: 400, frozen: [], unavailable: [] });
      for (const o of r.options) if (o.free !== o.capacity - occupiedSeatIndexes(e, o.tableId, g.id).size) bad.push(`${g.id} ${o.tableId} free ${o.free}`);
      for (const b of r.blocked.filter((x) => x.why === "NOT_ENOUGH_SEATS")) {
        const t = e.tables.find((x) => x.id === b.tableId);
        if (b.free !== t.capacity - occupiedSeatIndexes(e, t.id, g.id).size) bad.push(`${g.id} ${b.tableId} blocked free ${b.free}`);
      }
      const zones = new Map();
      for (const x of e.guests) if (x.id !== g.id && String(x.invitedBy || "").trim() && String(x.invitedBy).trim() === String(g.invitedBy || "").trim() && x.assignment) {
        const z = e.tables.find((t) => t.id === x.assignment.tableId)?.zone; if (z) zones.set(z, (zones.get(z) || 0) + 1);
      }
      const want = [...zones.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      if (r.preferredZone !== want) bad.push(`${g.id} zone ${r.preferredZone} != ${want}`);
      if (r.offered + r.blocked.length !== e.tables.length) bad.push(`${g.id} tables unaccounted`);
    }
    return bad;
  });
  checks.equal(advisor, [], "Smart Seating's free seats and host zone equal a per-table recount at this size");

  // The Plan Doctor still finds a table over capacity and a seat held twice,
  // with the recount's figures.
  const doctor = await page.evaluate(() => {
    const e = activeEvent();
    // T11 told it has 10 seats (it seats its full 18 people); on T13 the last
    // record is given the first record's seats.
    const t10 = e.tables.find((t) => t.id === "tbl10"), at12 = e.guests.filter((g) => g.assignment?.tableId === "tbl12");
    const c = at12[0], d = at12[at12.length - 1], keep = d.assignment;
    t10.capacity = 10;
    d.assignment = { ...d.assignment, seats: c.assignment.seats.slice(0, d.assignment.seats.length) };
    const run = MeritPlanDoctor.run({ phase: "ready", tables: e.tables, guests: e.guests, frozen: [], unavailable: [], backup: null, planIssues: [], analysis: null });
    t10.capacity = 18; d.assignment = keep;
    const f = (code) => run.all.find((x) => x.code === code);
    const pax10 = e.guests.filter((g) => g.assignment?.tableId === "tbl10").reduce((n, g) => n + g.pax, 0);
    return { got: { over: f("tableOverCapacity")?.params, twice: f("seatHeldTwice")?.params },
      want: { over: { n: 1, tables: 1, number: "T11", pax: pax10, capacity: 10 }, twice: { n: Math.min(keep.seats.length, c.assignment.seats.length), tables: 1, seats: Math.min(keep.seats.length, c.assignment.seats.length), number: "T13" } } };
  });
  checks.equal(doctor.got, doctor.want, "the Plan Doctor still reports the over-full table and the seats held twice, with a recount's figures");

  // --- 2. one render per action, one guest walk per render ------------------
  const shape = await page.evaluate(async () => {
    const e = activeEvent(), idle = () => new Promise((r) => setTimeout(r, 0));
    let renders = 0, walks = 0;
    const realRender = render, realOcc = occupiedSeatIndexes, realPlanned = MeritOccupancy.plannedIndex;
    render = function (...a) { renders++; return realRender.apply(this, a); };
    occupiedSeatIndexes = function (...a) { walks++; return realOcc.apply(this, a); };
    if (realPlanned) MeritOccupancy.plannedIndex = function (...a) { walks++; return realPlanned.apply(this, a); };
    const count = async (f) => { renders = 0; walks = 0; f(); const out = { renders, walks }; await idle(); return out; };
    const tableEl = (id) => document.querySelector(`#canvasWorld [data-object-id="${id}"]`);
    const out = {};
    // What the screen shows, in the parts a table pick or a search may change:
    // the guest list, the table card (and where it sits), and every table's
    // marks on the plan. A partial redraw must leave exactly what a full
    // render() of the same state draws.
    const snap = () => {
      const col = document.querySelector(".seat-canvas-col"), card = col && col.querySelector(":scope > .table-card");
      return { list: document.querySelector(".seat-queue-list").innerHTML, card: card ? card.outerHTML : null, cardAt: card ? [...col.children].indexOf(card) : -1,
        tables: [...document.querySelectorAll("#canvasWorld .table-object")].map((n) => `${n.dataset.objectId}:${[...n.classList].sort().join(".")}:${n.getAttribute("aria-pressed")}`).join("\n") };
    };
    const sameAsRender = () => { const a = snap(); realRender(); const b = snap(); return Object.keys(a).filter((k) => a[k] !== b[k]); };
    const down = (id) => tableEl(id).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    try {
      // First pick (no card yet) and a switch, each with a finder highlight on
      // another table that the pick clears.
      ui.selectedTableId = null; ui.highlightId = "tbl5"; realRender(); await idle();
      out.firstTable = await count(() => down("tbl271"));
      out.firstTableDiff = sameAsRender(); await idle();
      ui.highlightId = "tbl6"; realRender(); await idle();
      out.switchTable = await count(() => down("tbl3"));
      // The switched card is live: its seat row selects that guest.
      const occ = document.querySelector(".table-card [data-occupant-guest]:not([data-occupant-guest=''])");
      out.cardRow = { id: occ && occ.dataset.occupantGuest, clicks: await count(() => occ.click()), selected: ui.selectedGuestId };
      ui.selectedGuestIds = []; ui.selectedGuestId = null; realRender(); await idle();
      out.switchBack = await count(() => down("tbl271"));
      out.switchTableDiff = sameAsRender(); await idle();
      // With the header's first-day tip dismissed, the card's own tip shows (one
      // tip at a time): a pick and a switch still draw what a full render draws.
      const keepTips = state.onboarding; state.onboarding = { seen: { globalFinder: true } };
      ui.selectedTableId = null; realRender(); await idle();
      down("tbl40"); out.tipFirst = { shown: !!document.querySelector(".table-card [data-onboarding]"), diff: sameAsRender() }; await idle();
      down("tbl41"); out.tipSwitch = sameAsRender(); await idle();
      state.onboarding = keepTips; ui.selectedTableId = "tbl271"; realRender(); await idle();
      out.selectTable = await count(() => down("tbl270"));
      const gid = document.querySelector("[data-seating-guest]").dataset.seatingGuest;
      out.gid = gid;
      out.selectGuest = await count(() => document.querySelector("[data-seating-guest]").click());
      out.assign = await count(() => document.querySelector("[data-assign-selected]").click());
      out.seated = e.guests.find((g) => g.id === gid).assignment?.tableId;
      out.badge = tableEl("tbl270").querySelector(".table-occ").textContent.trim();
      out.lock = await count(() => document.querySelector(`[data-lock-assignment="${gid}"]`).click());
      out.locked = e.guests.find((g) => g.id === gid).assignment.locked;
      document.querySelector(`[data-lock-assignment="${gid}"]`).click(); await idle();
      ui.selectedGuestIds = []; ui.selectedGuestId = null;
      out.unassign = await count(() => document.querySelector(`[data-unassign="${gid}"]`).click());
      out.after = { assignment: e.guests.find((g) => g.id === gid).assignment, selectedGuestId: ui.selectedGuestId, selectedGuestIds: ui.selectedGuestIds.slice(),
        badge: tableEl("tbl270").querySelector(".table-occ").textContent.trim(), queued: !!document.querySelector(`[data-seating-guest="${gid}"]`) };
      // A refused Unassign (the assignment is locked) still selects the row's guest and renders once.
      const lockedGuest = e.guests.find((g) => g.assignment?.tableId === "tbl3");
      lockedGuest.assignment.locked = true; ui.selectedTableId = "tbl3"; ui.selectedGuestIds = []; ui.selectedGuestId = null; render(); await idle();
      out.refused = await count(() => document.querySelector(`[data-unassign="${lockedGuest.id}"]`).click());
      out.refusedId = lockedGuest.id;
      out.refusedState = { kept: lockedGuest.assignment?.tableId, selected: ui.selectedGuestIds.slice() };
      lockedGuest.assignment.locked = false;
      // Every badge on the canvas equals a recount after all that.
      render(); await idle();
      out.badgesWrong = e.tables.filter((t) => tableEl(t.id).querySelector(".table-occ").textContent.trim() !== `${realOcc(e, t.id).size} / ${t.capacity}`).map((t) => t.id);
      ui.seatingGuestScope = "all"; ui.selectedTableId = "tbl3"; realRender(); await idle();
      const n = document.getElementById("seatingSearch"); n.focus(); n.value = "kaya"; n.setSelectionRange(2, 2);
      out.searchKey = await count(() => n.dispatchEvent(new Event("input", { bubbles: true })));
      const box = document.activeElement;
      out.searchFocus = { id: box && box.id, caret: box && box.selectionStart, value: box && box.value };
      // The redrawn list is live: a card selects its guest (one render).
      const first = document.querySelector("[data-seating-guest]");
      out.searchCard = { id: first && first.dataset.seatingGuest, clicks: await count(() => first.click()), selected: ui.selectedGuestId };
      const n2 = document.getElementById("seatingSearch"); n2.value = "kay";
      await count(() => n2.dispatchEvent(new Event("input", { bubbles: true })));
      out.searchDiff = sameAsRender(); await idle();
      ui.selectedGuestIds = []; ui.selectedGuestId = null;
      const n3 = document.getElementById("seatingSearch"); n3.value = ""; n3.dispatchEvent(new Event("input", { bubbles: true })); await idle();
      ui.seatingGuestScope = "unassigned"; ui.selectedTableId = null; realRender(); await idle();
    } finally { render = realRender; occupiedSeatIndexes = realOcc; if (realPlanned) MeritOccupancy.plannedIndex = realPlanned; }
    return out;
  });
  checks.equal(shape.seated, "tbl270", "Assign seats the selected guest at the selected table", shape);
  checks.equal(shape.locked, true, "Lock locks it", shape);
  checks.equal(shape.after, { assignment: null, selectedGuestId: shape.gid, selectedGuestIds: [shape.gid], badge: "0 / 18", queued: true },
    "Unassign frees the seat, leaves that guest selected (the row's own selection), back in the queue, and the canvas badge says 0 / 18");
  checks.equal(shape.refusedState, { kept: "tbl3", selected: [shape.refusedId] }, "a refused (locked) Unassign keeps the seat and still selects the row's guest");
  checks.equal(shape.badgesWrong, [], "after all of it, every table's badge on the canvas equals a recount from the records");
  const perAction = Object.fromEntries(["selectGuest", "assign", "lock", "unassign", "refused"].map((k) => [k, shape[k].renders]));
  checks.equal(perAction, { selectGuest: 1, assign: 1, lock: 1, unassign: 1, refused: 1 },
    "every Seating action that changes the room or the selected guest renders the app exactly once (Unassign and Lock rendered twice: the click bubbled to the seat row)");
  // Measured 2026-11-13 (seatperf, 3,000 records): a search keystroke and a
  // table pick each redrew the whole screen (~240 / ~260 ms, mostly the plan's
  // 5,400 chairs) to change the list, or the card and two marks.
  const partial = Object.fromEntries(["firstTable", "switchTable", "switchBack", "selectTable", "searchKey"].map((k) => [k, shape[k].renders]));
  checks.equal(partial, { firstTable: 0, switchTable: 0, switchBack: 0, selectTable: 0, searchKey: 0 },
    "picking a table and typing in the search redraw only the table card / the guest list, never the whole screen");
  checks.equal({ firstTable: shape.firstTableDiff, switchTable: shape.switchTableDiff, search: shape.searchDiff, tipFirst: shape.tipFirst, tipSwitch: shape.tipSwitch },
    { firstTable: [], switchTable: [], search: [], tipFirst: { shown: true, diff: [] }, tipSwitch: [] },
    "after a table pick, a table switch and a search, the list, the card (and its place) and every table's marks are exactly what a full render draws (highlight cleared, aria-pressed moved)");
  checks.equal(shape.searchFocus, { id: "seatingSearch", caret: 2, value: "kaya" }, "typing keeps focus and the caret in the search box");
  checks.ok(shape.searchCard.id && shape.searchCard.selected === shape.searchCard.id && shape.searchCard.clicks.renders === 1,
    "a guest card in the redrawn list selects its guest", shape.searchCard);
  checks.ok(shape.cardRow.id && shape.cardRow.selected === shape.cardRow.id && shape.cardRow.clicks.renders === 1,
    "a seat row on the switched table card selects its guest", shape.cardRow);
  const walks = Object.fromEntries(["selectTable", "selectGuest", "assign", "unassign", "searchKey"].map((k) => [k, shape[k].walks]));
  checks.ok(Object.values(walks).every((n) => n <= 3),
    "the canvas walks the guest list once per render for its seat counts, not twice per table (was 600 walks at 300 tables)", walks);

  // --- 3. the operator's actions, timed --------------------------------------
  const R = await page.evaluate(async () => {
    const R = {}, push = (k, v) => (R[k] ||= []).push(v);
    const flush = () => document.body.getBoundingClientRect(), idle = () => new Promise((r) => setTimeout(r, 0));
    const time = (k, f) => { const t0 = performance.now(); f(); flush(); push(k, performance.now() - t0); };
    const tableEl = (id) => document.querySelector(`#canvasWorld [data-object-id="${id}"]`);
    const down = (el) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    const e = activeEvent();
    for (let i = 0; i < 12; i++) {
      ui.tab = "guests"; ui.selectedTableId = null; render(); await idle();
      const t0 = performance.now(); document.querySelector('[data-tab="seating"]').click(); flush();
      if (i >= 2) push("openSeating", performance.now() - t0);
      await idle();
    }
    ui.seatingGuestScope = "all"; render(); await idle();
    const Q = ["a", "ay", "ayş", "ayşe", "ayşe y", "yıl", "kaya", "öz", "özd", "mehmet", "çelik", "şahin", "can", "elif", "e"];
    for (const q of [...Q, ...[...Q].reverse()]) {
      const n = document.getElementById("seatingSearch"); n.value = q;
      time("searchKey", () => n.dispatchEvent(new Event("input", { bubbles: true }))); await idle();
    }
    { const n = document.getElementById("seatingSearch"); n.value = ""; n.dispatchEvent(new Event("input", { bubbles: true })); }
    ui.seatingGuestScope = "unassigned"; render(); await idle();
    for (let i = 0; i < 16; i++) {
      ui.selectedTableId = null; render(); await idle();
      time("selectTable", () => down(tableEl("tbl" + (i * 7 % 250)))); await idle();
      time("switchTable", () => down(tableEl("tbl" + ((i * 7 + 3) % 250)))); await idle();
    }
    for (let i = 0; i < 16; i++) { const c = document.querySelectorAll("[data-seating-guest]")[i % 10]; time("selectGuest", () => c.click()); await idle(); }
    const free = e.tables.filter((t) => !e.guests.some((g) => g.assignment && g.assignment.tableId === t.id)).map((t) => t.id);
    for (let i = 0; i < 16; i++) {
      down(tableEl(free[i % free.length])); await idle();
      const card = document.querySelector("[data-seating-guest]"), gid = card.dataset.seatingGuest;
      card.click(); await idle();
      time("assignClick", () => document.querySelector("[data-assign-selected]").click()); await idle();
      time("unassign", () => document.querySelector(`[data-unassign="${gid}"]`).click()); await idle();
    }
    for (let i = 0; i < 16; i++) {
      const card = document.querySelector("[data-seating-guest]"), gid = card.dataset.seatingGuest, dt = new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      const el = tableEl(free[(i + 5) % free.length]);
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      time("assignDrag", () => el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }))); await idle();
      if (!e.guests.find((g) => g.id === gid).assignment) throw new Error("the drop did not seat " + gid);
      document.querySelector(`[data-unassign="${gid}"]`).click(); await idle();
    }
    return R;
  });
  const results = {};
  for (const [op, xs] of Object.entries(R)) { results[op] = stats(xs); console.log(`SEATING[3000] ${op}: ${JSON.stringify(results[op])}`); }
  for (const [op, budget] of Object.entries(BUDGET_MS)) {
    if (budget == null) continue;
    checks.ok(results[op].p95 <= budget, `${op}: p95 ${results[op].p95} ms within its ${budget} ms budget`, results[op]);
  }
  checks.equal(pageErrors, [], "no page error through the whole session");
}
