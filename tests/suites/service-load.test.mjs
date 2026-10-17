// Where is this room busy right now?
//
// The layer answers one question from facts the product already has. This suite
// mostly guards what it must NOT answer, because every one of those is a
// convincing thing to draw and none of them is supported by the data:
//
//   NO WALKING ROUTE. The product knows where objects sit on a drawing. It does
//   not know where the walls, doors or service corridors are.
//
//   NO DISTANCE IN ANY UNIT. Nothing calibrates a plan's pixels to metres.
//   Relative ordering on one drawing is valid; "14m from the bar" is a number
//   with no referent.
//
//   NO SERVICE TIME AND NO STAFF LOAD. There is no staff record and no service
//   event anywhere in this product.
//
//   NO CONTINUOUS HEAT FIELD. Occupancy is known per table. A smooth surface
//   between tables would invent a figure for floor nothing measured.
//
// And the one domain rule it must get right: PLANNED and LIVE are different
// rooms. A No Show keeps the planned seat — the plan and the reports are
// correct — and frees the chair tonight.
import { click, openApp, createBlankEvent, addTables, gotoTab, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "service-load", tags: ["business", "fast"], timeout: 180000 };

const PANEL = `(function(){
  const s = document.querySelector(".service-load");
  if (!s) return null;
  return {
    question: s.querySelector(".sl-head p")?.textContent.trim() || "",
    total: s.querySelector(".sl-total")?.textContent.trim() || "",
    zones: [...s.querySelectorAll(".sl-zone")].map(z => ({
      zone: z.querySelector("em")?.textContent.trim() || "",
      count: z.querySelector("b")?.textContent.trim() || "",
      band: z.querySelector(".sl-band")?.textContent.trim() || "",
      fill: z.querySelector(".sl-fill")?.className || "",
    })),
    service: s.querySelector(".sl-service")?.textContent.trim() || null,
    blind: s.querySelector(".sl-blind")?.textContent.trim() || null,
    text: s.textContent,
  };
})()`;

const BANDS = `(function(){
  const out = {};
  for (const el of document.querySelectorAll(".table-object")) {
    const m = /(?:^|\\s)load-([A-Z]+)/.exec(el.className);
    out[el.dataset.objectId] = m ? m[1] : null;
  }
  return out;
})()`;

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Load", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 4 });

  const room = await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 8; e.tables[0].zone = "VIP FRONT";
    e.tables[0].x = 100; e.tables[0].y = 100;
    e.tables[1].number = "T02"; e.tables[1].capacity = 8; e.tables[1].zone = "MAIN FLOOR";
    e.tables[1].x = 900; e.tables[1].y = 100;
    e.tables[2].number = "T03"; e.tables[2].capacity = 8; e.tables[2].zone = "MAIN FLOOR";
    e.tables[2].x = 1400; e.tables[2].y = 600;
    e.tables[3].number = "T04"; e.tables[3].capacity = 8; e.tables[3].zone = "MAIN FLOOR";
    e.tables[3].x = 900; e.tables[3].y = 600;
    const g = (id, name, pax, tableId, seats, extra) => ({
      id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: "Host",
      notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      expectedArrival: null, checkedInAt: null,
      assignment: tableId ? { tableId, seats, locked: false } : null,
      createdAt: new Date().toISOString(), ...extra,
    });
    e.guests = [
      g("g_full", "Ayşe Demir", 8, e.tables[0].id, [0,1,2,3,4,5,6,7]),   // T01 full
      g("g_half", "Burak Şahin", 3, e.tables[1].id, [0,1,2]),            // T02 light
      g("g_busy", "Can Öztürk", 5, e.tables[2].id, [0,1,2,3,4]),         // T03 busy
    ];                                                                    // T04 empty
    touchEvent(e); render();
    return { t01: e.tables[0].id, t02: e.tables[1].id, t03: e.tables[2].id, t04: e.tables[3].id };
  });

  await gotoTab(page, "command");
  await settle(page);

  // --- 1. bands are named, and come from occupancy -------------------------
  const first = await page.evaluate(PANEL);
  checks.ok(first, "the Command Center carries a service load summary");
  checks.equal(first.total, "16/32", "totalling the room's chairs and the people on them");
  const bands = await page.evaluate(() => {
    const l = MeritServiceLoad.build({ tables: state.events[0].tables, guests: state.events[0].guests,
      venueObjects: [], mode: "PLANNED" });
    return Object.fromEntries(l.tables.map(r => [r.number, r.band]));
  });
  checks.equal(bands.T01, "FULL", "a table with every chair taken is FULL");
  checks.equal(bands.T03, "BUSY", "five of eight is BUSY");
  checks.equal(bands.T02, "LIGHT", "three of eight is LIGHT");
  checks.equal(bands.T04, "EMPTY", "and a table nobody is on is EMPTY");
  checks.ok(!/\d+(\.\d+)?\s*%/.test(first.text),
    "no percentage on the panel — the bands are named, not scored", first.text);

  // --- 2. what it cannot see is stated -------------------------------------
  const blind = await page.evaluate(() => {
    const list = MeritServiceLoad.NOT_EVALUATED.map(x => t("load.notEvaluated." + x.aspect));
    return { list, shown: document.querySelector(".sl-blind")?.textContent.trim() || null,
      measured: MeritServiceLoad.build({ tables: [], guests: [], venueObjects: [] }).measured };
  });
  checks.equal(blind.list.length, 3, "the engine names three aspects it does not evaluate", blind.list);
  checks.ok(blind.shown && blind.list.every(n => blind.shown.includes(n)),
    "and every one of them is on the screen, in words", blind);
  checks.equal(blind.measured, false,
    "the engine says in its own output that nothing here is measured");

  // --- 3. an unmarked service point stays unknown --------------------------
  const noService = await page.evaluate(() => {
    const l = MeritServiceLoad.build({ tables: state.events[0].tables, guests: state.events[0].guests,
      venueObjects: [], mode: "PLANNED" });
    return { known: l.servicePoints.known, why: l.servicePoints.why,
      farthest: l.farthestFromService.length,
      shown: document.querySelector(".sl-service")?.textContent.trim() || "" };
  });
  checks.equal(noService.known, false, "a plan with no service point marked says so");
  checks.ok(noService.why && noService.why.length > 10, "with a reason", noService.why);
  checks.equal(noService.farthest, 0,
    "and computes NO ordering from it — an unknown stays unknown rather than becoming a list derived from nothing");
  checks.ok(/no service point|işaretlenmemiş/i.test(noService.shown),
    "the screen says it rather than leaving the reader to assume", noService.shown);

  // --- 4. a marked service point gives RELATIVE order, never a distance ----
  await page.evaluate((ids) => {
    const e = state.events[0];
    e.venueObjects = [{ id: "bar1", type: "bar", label: "BAR", x: 60, y: 60, w: 120, h: 40,
      rotation: 0, locked: true, z: 2 }];
    touchEvent(e); render();
  }, room);
  await page.waitForTimeout(400);

  const withService = await page.evaluate(() => {
    const e = state.events[0];
    const l = MeritServiceLoad.build({ tables: e.tables, guests: e.guests,
      venueObjects: e.venueObjects, mode: "PLANNED" });
    return { known: l.servicePoints.known, count: l.servicePoints.count,
      order: l.farthestFromService.map(f => f.number),
      ranks: l.farthestFromService.map(f => f.rank),
      keys: [...new Set(l.farthestFromService.flatMap(f => Object.keys(f)))],
      raw: JSON.stringify(l.farthestFromService) };
  });
  checks.equal(withService.known, true, "a marked bar is read off the drawing as a service point");
  // ALL occupied tables are ranked, including the one sitting right on the
  // bar -- it is simply last, the closest rather than excluded. Dropping it
  // would silently narrow "occupied tables, ordered" into "occupied tables
  // except the ones that are inconvenient to rank".
  checks.equal(withService.order.join(","), "T03,T02,T01",
    "every occupied table is ordered by how far it sits from the service point — furthest first", withService.order);
  checks.equal(withService.ranks.join(","), "1,2,3", "as ranks, one per table", withService.ranks);
  checks.ok(!withService.keys.some(k => /dist|metre|meter|_d/i.test(k)),
    "and no distance is carried in the result at all — nothing calibrates a plan's pixels to a unit",
    withService.keys);
  // Strip the one field that legitimately carries digits -- the table's
  // internal id, a UUID -- before checking that nothing else in the object
  // looks like a geometric coordinate or a calibrated distance.
  const sanitized = withService.raw.replace(/"tableId":"[^"]*"/g, '"tableId":"x"');
  checks.ok(!/\b\d{3,}\b/.test(sanitized),
    "nor leaked as a raw geometric figure", sanitized);
  checks.equal(withService.order[withService.order.length - 1], "T01",
    "and T01 — sitting right on the bar — is the closest, not the furthest", withService.order);

  const wording = await page.evaluate(() => document.querySelector(".sl-service")?.textContent.trim() || "");
  checks.ok(/relative|göreli/i.test(wording),
    "the screen calls the ordering relative", wording);
  checks.ok(/not a distance|not a walking route|mesafe|güzergâh/i.test(wording),
    "and says plainly that it is neither a distance nor a route", wording);

  // --- 5. the layer draws bands on the plan, without burying it ------------
  await gotoTab(page, "floor");
  await settle(page);
  checks.equal(await page.evaluate(() => Object.values((function(){
    const o={};for(const el of document.querySelectorAll(".table-object")) o[el.dataset.objectId]=/load-/.test(el.className);return o;})()).filter(Boolean).length), 0,
    "the layer is off by default — load is not a rule an operator can be blocked by, so a permanent tint would be decoration");
  await click(page, "[data-load-layer]");
  await page.waitForTimeout(500);
  const painted = await page.evaluate(BANDS);
  checks.equal(painted[room.t01], "FULL", "switching it on bands the full table");
  checks.equal(painted[room.t03], "BUSY", "the busy one");
  checks.equal(painted[room.t02], "LIGHT", "the light one");
  checks.equal(painted[room.t04], "EMPTY", "and the empty one");

  const opaque = await page.evaluate(() => {
    // The band must sit ON the table surface, not over the drawing. An opaque
    // pseudo-element across the object would be the blob this layer forbids.
    const el = document.querySelector(".table-object.load-FULL");
    const after = getComputedStyle(el, "::after");
    const m = /rgba?\(([^)]+)\)/.exec(after.backgroundColor || "");
    const parts = m ? m[1].split(",").map(Number) : null;
    return { after: parts && parts.length === 4 ? parts[3] : 0,
      surfaceBg: getComputedStyle(el.querySelector(".table-surface")).backgroundColor };
  });
  checks.ok(opaque.after <= 0.25,
    "and nothing opaque is laid over the drawing to do it", opaque);

  await click(page, "[data-load-layer]");
  await page.waitForTimeout(400);
  checks.equal(Object.values(await page.evaluate(BANDS)).filter(Boolean).length, 0,
    "the layer can be turned off again");
  await click(page, "[data-load-layer]");
  await page.waitForTimeout(400);

  // --- 6. the layer never changes anything ---------------------------------
  const untouched = await page.evaluate(() => JSON.stringify(state.events[0].guests.map(g => [g.id, g.assignment])));
  await click(page, "[data-load-layer]");
  await page.waitForTimeout(300);
  await click(page, "[data-load-layer]");
  await page.waitForTimeout(300);
  checks.equal(await page.evaluate(() => JSON.stringify(state.events[0].guests.map(g => [g.id, g.assignment]))),
    untouched, "toggling the layer moved nobody and changed no table");

  // --- 7. PLANNED and LIVE are different rooms -----------------------------
  //
  // A No Show keeps the planned seat and frees the chair tonight. Both numbers
  // are correct and they are different numbers.
  const twoRooms = await page.evaluate(() => {
    const e = JSON.parse(JSON.stringify(state.events[0]));
    e.guests.find(g => g.id === "g_full").arrivalStatus = "No Show";
    const planned = MeritServiceLoad.build({ tables: e.tables, guests: e.guests,
      venueObjects: e.venueObjects, mode: "PLANNED" });
    const live = MeritServiceLoad.build({ tables: e.tables, guests: e.guests,
      venueObjects: e.venueObjects, mode: "LIVE" });
    const band = (l, n) => l.tables.find(r => r.number === n).band;
    return { plannedSeated: planned.room.seated, liveSeated: live.room.seated,
      plannedBand: band(planned, "T01"), liveBand: band(live, "T01"),
      assignmentKept: !!e.guests.find(g => g.id === "g_full").assignment };
  });
  checks.equal(twoRooms.plannedSeated, 16, "the seating plan still seats sixteen");
  checks.equal(twoRooms.liveSeated, 8, "tonight's room holds eight — the No Show's chairs are free");
  checks.equal(twoRooms.plannedBand, "FULL", "the planned table is still full");
  checks.equal(twoRooms.liveBand, "EMPTY", "and the live one is empty");
  checks.ok(twoRooms.assignmentKept,
    "with the planned seat untouched — No Show never clears an assignment");

  // --- 8. checking somebody in does not double count them ------------------
  const beforeCheckIn = await page.evaluate(() =>
    MeritServiceLoad.build({ tables: state.events[0].tables, guests: state.events[0].guests,
      venueObjects: state.events[0].venueObjects, mode: "LIVE" }).room.seated);
  await page.evaluate(() => {
    const e = state.events[0];
    const g = e.guests.find(x => x.id === "g_half");
    g.arrivalStatus = "Checked In"; g.checkedInAt = new Date().toISOString();
    touchEvent(e); render();
  });
  await page.waitForTimeout(400);
  const afterCheckIn = await page.evaluate(() =>
    MeritServiceLoad.build({ tables: state.events[0].tables, guests: state.events[0].guests,
      venueObjects: state.events[0].venueObjects, mode: "LIVE" }).room.seated);
  checks.equal(afterCheckIn, beforeCheckIn,
    "an arrival adds nothing to the load — the seat was already counted when it was assigned");

  // --- 9. occupancy change moves the load ----------------------------------
  await page.evaluate(() => {
    const e = state.events[0];
    e.guests.find(g => g.id === "g_half").assignment = { tableId: e.tables[3].id, seats: [0,1,2], locked: false };
    touchEvent(e); render();
  });
  await page.waitForTimeout(500);
  const moved = await page.evaluate(BANDS);
  checks.equal(moved[room.t02], "EMPTY", "moving a party empties the table they left");
  checks.equal(moved[room.t04], "LIGHT", "and loads the one they moved to");

  // --- 10. zones are reported from the zone field, not invented ------------
  const zones = await page.evaluate(() => {
    const l = MeritServiceLoad.build({ tables: state.events[0].tables, guests: state.events[0].guests,
      venueObjects: state.events[0].venueObjects, mode: "PLANNED" });
    return { names: l.zones.map(z => z.zone), busiest: l.busiestZone && l.busiestZone.zone,
      totals: Object.fromEntries(l.zones.map(z => [z.zone, `${z.pax}/${z.capacity}`])) };
  });
  checks.equal([...zones.names].sort().join(","), "MAIN FLOOR,VIP FRONT",
    "the zones are the ones the tables carry", zones.names);
  checks.equal(zones.totals["VIP FRONT"], "8/8", "with their own totals", zones.totals);
  checks.equal(zones.totals["MAIN FLOOR"], "8/24", "counting every table in them", zones.totals);
  checks.equal(zones.busiest, "MAIN FLOOR",
    "and the busiest is the one with the most people, not the fullest ratio — an operator asks where the people are");

  // --- 11. a large room stays responsive -----------------------------------
  const perf = await page.evaluate(() => {
    const tables = [], guests = [];
    for (let i = 0; i < 400; i++) {
      tables.push({ id: "t" + i, number: "T" + i, zone: "Z" + (i % 8), capacity: 10,
        x: (i % 20) * 160, y: Math.floor(i / 20) * 160, w: 120, h: 120, hasPhysicalSeats: true });
      for (let j = 0; j < 3; j++) guests.push({ id: `g${i}_${j}`, pax: 3, arrivalStatus: "Not Arrived",
        assignment: { tableId: "t" + i, seats: [j * 3, j * 3 + 1, j * 3 + 2] } });
    }
    const objects = [{ id: "b", type: "bar", x: 0, y: 0, w: 40, h: 40 }];
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) MeritServiceLoad.build({ tables, guests, venueObjects: objects, mode: "LIVE" });
    return { ms: (performance.now() - t0) / 5, tables: tables.length, guests: guests.length };
  });
  checks.ok(perf.ms < 60,
    `a 400-table, 1,200-record room builds in ${perf.ms.toFixed(1)}ms — measured, not asserted`, perf);

  // --- 12. both languages ---------------------------------------------------
  const words = await page.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; ui.tab = "command"; render();
      const s = document.querySelector(".service-load");
      out[lang] = {
        question: s?.querySelector(".sl-head p")?.textContent.trim() || "",
        band: s?.querySelector(".sl-band")?.textContent.trim() || "",
        blind: s?.querySelector(".sl-blind")?.textContent.trim() || "",
        service: s?.querySelector(".sl-service")?.textContent.trim() || "",
      };
    }
    ui.lang = "en"; render();
    return out;
  });
  for (const lang of ["en", "tr"]) {
    checks.ok(Object.values(words[lang]).every(v => v.length > 0), `${lang}: the panel is written`, words[lang]);
    checks.ok(Object.values(words[lang]).every(v => !/^[a-z][a-zA-Z0-9]*\.[a-zA-Z]/.test(v)),
      `${lang}: in words, never a raw key`, words[lang]);
    checks.ok(!/^[A-Z_]{4,}$/.test(words[lang].band), `${lang}: the band is a word, not an enum`, words[lang].band);
  }
  checks.ok(words.en.question !== words.tr.question,
    "and Turkish is really Turkish, not English left in place", words);
  checks.ok(words.en.blind !== words.tr.blind, "including what the layer cannot see", words);
}
