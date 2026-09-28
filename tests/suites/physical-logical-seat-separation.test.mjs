// PHYSICAL CHAIR, LOGICAL SEAT, OPERATIONAL CAPACITY — three different
// quantities, and this suite exists to keep the data model from collapsing
// them back into one.
//
//   A PHYSICAL CHAIR exists only where the plan genuinely drew one, Assisted
//   Detection found one, or a person placed one. `table.chairs` holds those
//   and NOTHING else. On a symbolic table (`hasPhysicalSeats:false` —
//   capacity read from a printed number, no chairs drawn) the array is
//   EMPTY, at any capacity.
//
//   A LOGICAL SEAT is `table.capacity`: the assignment index space
//   0..capacity-1. Guest assignment, seat numbering, pax arithmetic and the
//   exported seat rows all index into that and nothing else, so they work
//   identically whether or not a chair was ever drawn.
//
//   OPERATIONAL CAPACITY is what the room can seat tonight, summed from
//   logical seats. It is what every "will they fit" judgement uses.
//
// An earlier build kept `table.chairs.length === table.capacity` for every
// table and tagged the invented ones `physical:false`. That is what this
// suite used to assert, and it was the defect: a 420-table symbolic plan
// stored 4,200 chairs at coordinates nothing had ever observed, rewritten on
// every save. A flag disowning a coordinate is not the same as not writing
// it. The assertions below are the stronger contract that replaced it — the
// fabricated chairs do not exist, rather than existing with a label.
import { click, openApp, createBlankEvent, addTables, settle } from "../lib/app-actions.mjs";

export const meta = { name: "physical-logical-seat-separation", tags: ["business", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Seat Separation" });
  await addTables(page, { quantity: 1 });
  await settle(page);

  // --- 1. a manually-created table is physical: real chairs, drawn ---------
  // A person who authored a round table with eight seats in the editor HAS
  // placed eight chairs. That is the "human-confirmed" arm of the rule, not
  // a capacity number being inflated into geometry.
  const before = await page.evaluate(() => {
    const t = state.events[0].tables[0];
    t.capacity = 8;
    touchEvent(state.events[0]);
    render();
    return {
      hasPhysicalSeats: t.hasPhysicalSeats,
      chairsLength: t.chairs.length,
      capacity: t.capacity,
      chairGlyphs: document.querySelectorAll(`.chair[data-chair-id]`).length,
    };
  });
  checks.equal(before.hasPhysicalSeats, true, "a manually-authored table is physical — the operator placed those seats themselves", before);
  checks.equal(before.chairsLength, 8, "so it carries eight real chair objects", before);
  checks.equal(before.capacity, 8, "and eight logical seats", before);
  checks.equal(before.chairGlyphs, 8, "all eight draw on the canvas", before);

  // --- 2. the same table as symbolic: capacity survives, chairs do not -----
  const after = await page.evaluate(() => {
    const e = state.events[0], t = e.tables[0];
    t.hasPhysicalSeats = false;
    touchEvent(e);
    render();
    return {
      capacity: t.capacity,
      chairsLength: t.chairs.length,
      chairGlyphs: document.querySelectorAll(`.chair[data-chair-id]`).length,
      physicalFlagRetired: t.chairs.every(c => !("physical" in c)),
    };
  });
  checks.equal(after.capacity, 8, "capacity is untouched by the physical/symbolic flip — it is a different quantity", after);
  checks.equal(after.chairsLength, 0,
    "and the table now carries ZERO chair objects. This is the contract: a capacity number never synthesises a physical chair, so there is no coordinate to disown", after);
  checks.equal(after.chairGlyphs, 0, "nothing is drawn, because there is nothing to draw", after);
  checks.ok(after.physicalFlagRetired,
    "the `physical:false` flag is gone from the model entirely — presence in table.chairs IS the claim that a chair exists", after);

  // --- 3. a symbolic table still seats guests, on its logical seats --------
  // The whole point of keeping capacity separate: assignment must not care
  // whether anybody drew a chair.
  const seated = await page.evaluate(() => {
    const e = state.events[0], t = e.tables[0];
    e.guests.push({ id: "sym_g1", name: "Symbolic Party", additionalGuests: 2, pax: 3,
      vip: "Standard", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, notes: "", invitedBy: "", checkedInAt: null });
    assignGuestToTable("sym_g1", t.id);
    const g = e.guests.find(x => x.id === "sym_g1");
    return {
      tableId: g.assignment?.tableId, expected: t.id,
      seats: (g.assignment?.seats || []).length,
      chairsAfterAssign: t.chairs.length,
      occupied: occupiedSeatIndexes(e, t.id).size,
    };
  });
  checks.equal(seated.tableId, seated.expected,
    "a +2 party seats at a table whose plan drew no chairs — the printed capacity is a real place to sit", seated);
  checks.equal(seated.seats, 3, "taking exactly three logical seats", seated);
  checks.equal(seated.occupied, 3, "and the table reports three occupied", seated);
  checks.equal(seated.chairsAfterAssign, 0,
    "seating somebody still fabricates no chair — assignment lives on the logical seat space, never on table.chairs", seated);

  // --- 4. detected chair coordinates are never regenerated into a ring -----
  // The AI rule ("confirmed chair coordinates are written verbatim, never
  // regenerated into a synthetic ring") has to survive a capacity sync,
  // which is the operation that rebuilds the array.
  const verbatim = await page.evaluate(() => {
    const e = state.events[0], t = e.tables[0];
    t.hasPhysicalSeats = true;
    t.capacity = 3;
    // Stand in for a commit of three real chair detections at positions no
    // ring would ever produce.
    t.chairs = [
      { id: "c1", parentTableId: t.id, seatNumber: 1, x: 11.5, y: 12.5, rotation: 17, occupancy: null },
      { id: "c2", parentTableId: t.id, seatNumber: 2, x: 22.5, y: 23.5, rotation: 29, occupancy: null },
      { id: "c3", parentTableId: t.id, seatNumber: 3, x: 33.5, y: 34.5, rotation: 41, occupancy: null },
    ];
    const sent = t.chairs.map(c => ({ x: c.x, y: c.y, rotation: c.rotation }));
    // saveState() runs refreshChairOccupancy over every event, which is the
    // path that re-syncs chairs to capacity — the exact operation that must
    // not overwrite a detected coordinate.
    saveState();
    render();
    const got = state.events[0].tables[0].chairs.map(c => ({ x: c.x, y: c.y, rotation: c.rotation }));
    return { same: JSON.stringify(sent) === JSON.stringify(got), got };
  });
  checks.ok(verbatim.same,
    "three detected chair positions survive a capacity sync, a save and a render byte-identically — no synthetic ring is written over them",
    verbatim.got);

  // --- 5. the two totals stay different numbers ----------------------------
  // physicalCapacity() answers "how many chairs did the drawing have";
  // seatingCapacity() answers "how many people can sit". A build that
  // collapses them shows one of these two wrong.
  const totals = await page.evaluate(() => {
    const e = state.events[0];
    e.tables = [
      { ...e.tables[0], id: "phys", number: "T01", capacity: 6, hasPhysicalSeats: true, chairs: [] },
      { ...e.tables[0], id: "symb", number: "T02", capacity: 10, hasPhysicalSeats: false, chairs: [] },
    ];
    e.guests = [];
    touchEvent(e); render();
    return {
      physical: MeritSeatModel.physicalCapacity(e),
      seating: MeritSeatModel.seatingCapacity(e),
      perTable: e.tables.map(t => ({ n: t.number, cap: t.capacity, chairs: t.chairs.length })),
    };
  });
  checks.equal(totals.physical, 6,
    "physical capacity counts the six chairs that exist and not the ten that were only ever printed", totals);
  checks.equal(totals.seating, 16,
    "operational capacity counts all sixteen seats, because all sixteen can hold somebody tonight", totals);

  // --- 6. the Home hero asks the capacity question, so it gets the capacity
  //        answer — a symbolic plan is not "no tables in the plan yet" -----
  await click(page, '[data-action="back-events"]');
  await settle(page);
  const hero = await page.evaluate(() => {
    const e = state.events[0];
    e.tables = e.tables.map(t => ({ ...t, hasPhysicalSeats: false, chairs: [] }));
    touchEvent(e); render();
    const rows = [...document.querySelectorAll(".next-event-bars .nb-top")];
    return {
      rows: rows.length,
      capacityText: rows[1]?.querySelector("b")?.textContent.trim() || null,
      noPlanNotice: rows[1]?.querySelector("b") ? null : rows[1]?.textContent.trim(),
      physical: MeritSeatModel.physicalCapacity(e),
    };
  });
  checks.equal(hero.physical, 0, "every table is symbolic, so there are genuinely no physical chairs", hero);
  checks.ok(hero.capacityText && /\/\s*16\s*$/.test(hero.capacityText),
    "and the hero's capacity bar still reads against 16 seats. Driving it from physical chairs printed 'No tables in the plan yet' over a plan carrying two tables and sixteen seats",
    hero);

  // --- 6b. Reports names the figure it shows ----------------------------------
  // Measured 2026-09-28: on this same symbolic plan Reports printed "EMPTY
  // PHYSICAL CHAIRS 13" — thirteen empty LOGICAL seats under a label claiming
  // chairs the drawing never had — and "ASSIGNED GUESTS 3 · Live": a planned
  // pax figure, labelled as guest records, noted as live.
  const reportsFigures = await page.evaluate(() => {
    const e = state.events[0];
    const g = (id, name, pax) => ({ id, name, additionalGuests: pax - 1, pax, planningStatus: "Confirmed", vip: "Standard", arrivalStatus: "Not Arrived",
      checkedInAt: null, invitedBy: "", notes: "", assignment: null, createdAt: new Date().toISOString() });
    e.guests = [g("gp", "Party Of Three", 3), g("gs", "Single Guest", 1)];
    touchEvent(e);
    ui.activeEventId = e.id; ui.screen = "workspace";
    assignGuestToTable("gp", e.tables[0].id);
    ui.tab = "reports"; render();
    return [...document.querySelectorAll(".reports-stage .mx-metric")].map((m) => ({
      label: m.querySelector(".mx-metric-label")?.textContent.trim() || "",
      value: m.querySelector(".mx-metric-value")?.textContent.trim() || "",
      note: m.querySelector(".mx-metric-note")?.textContent.trim() || "" }));
  });
  const physicalWord = await page.evaluate(() => [t("reports.emptyChairs"), "physical", "fiziksel"]);
  checks.ok(reportsFigures.length === 4 && !reportsFigures.some((m) => /physical|fiziksel/i.test(m.label)),
    "on a plan with no physical chairs, no Reports figure is labelled as physical chairs", { reportsFigures, physicalWord });
  const empty = reportsFigures.find((m) => m.value === "13");
  checks.ok(!!empty && empty.label === (await page.evaluate(() => t("reports.emptySeats"))), "the 13 empty logical seats are labelled as seats", reportsFigures);
  const assigned = reportsFigures[1];
  const expectAssigned = await page.evaluate(() => ({ label: t("reports.assignedPax"), note: t("reports.guestsCount.1", { n: 1 }), live: t("reports.live") }));
  checks.ok(assigned && assigned.value === "3" && assigned.label === expectAssigned.label && assigned.note === expectAssigned.note && assigned.note !== expectAssigned.live,
    "3 assigned pax are labelled as pax, noted as one guest record — not as live", { assigned, expectAssigned });
  // Turkish does not inflect after a number, so the singular is read in English.
  const englishNotes = await page.evaluate(() => { const was = ui.lang; ui.lang = "en"; render();
    const notes = [...document.querySelectorAll(".reports-stage .mx-metric .mx-metric-note")].map((x) => x.textContent.trim());
    ui.lang = was; render(); return notes; });
  checks.equal([englishNotes[1], englishNotes[3]], ["1 guest", "1 guest"], "and one guest record reads as \"1 guest\", not \"1 guests\"", englishNotes);

  // --- 7. the Assisted Detection commit path follows the plan's own
  //        representation verdict, not a hardcoded default ------------------
  // Whether a committed table gets physical chairs is decided by what the
  // plan reader concluded about the drawing. Absence of a verdict is not
  // evidence of drawn chairs, so it abstains.
  const physicalPlan = await commitThroughReview(page, { kind: "PHYSICAL", chairs: [0] });
  const symbolicPlan = await commitThroughReview(page, { kind: "SYMBOLIC", chairs: [0, 4] });
  const noVerdict = await commitThroughReview(page, { kind: null, chairs: [0] });
  checks.equal(physicalPlan[0].physical, true, "a PHYSICAL-verdict plan's committed tables start hasPhysicalSeats:true", physicalPlan);
  checks.ok(symbolicPlan[0].physical === false && symbolicPlan[0].chairs === 0, "a SYMBOLIC-verdict plan's committed tables start hasPhysicalSeats:false, with no chair fabricated from anything", symbolicPlan);
  checks.ok(symbolicPlan[1].physical === true && symbolicPlan[1].chairs === 4, "a candidate with real confirmed chair detections is still physical, with exactly its 4 chairs, on an otherwise-symbolic plan", symbolicPlan);
  checks.equal(noVerdict[0].physical, false, "with no representation verdict at all, the committed table abstains (symbolic), never an unconditional true", noVerdict);
}

async function commitThroughReview(page, { kind, chairs }) {
  // An analysis shaped as the pipeline writes it, committed by pressing the
  // real Commit button — so the check reads what commitCandidates() DID, not
  // a copy of its expression. (§28: the copy could not fail when the product
  // changed; it was a test of itself.)
  await page.evaluate(({ kind, chairs }) => {
    const candidates = chairs.map((n, i) => ({ id: "c" + i, kind: "table", type: "round", x: 10 + i * 15, y: 30, w: 6, h: 6, rotation: 0,
      confidence: 0.9, status: "unreviewed", selected: true, printedNumber: null, evidence: { geometry: 0.8, chairs: 0, repetition: 1 },
      chairDetections: Array.from({ length: n }, (_, s) => ({ x: 10 + i * 15 + s, y: 29, w: 1, h: 1, rotation: 0 })) }));
    const event = { id: "ev-" + Math.random().toString(36).slice(2), name: "Commit", hotel: "Merit", salon: "", date: "2026-12-31", status: "Planning",
      tables: [], venueObjects: [], guests: [], background: { src: "", visible: true }, audit: [], handoverNotes: [] };
    event.analysis = { id: "an", planHash: "h", engine: "ASSISTED_DETECTION", trainedModel: false, createdAt: new Date().toISOString(), imageWidth: 1000, imageHeight: 800,
      threshold: 128, candidates, missed: [], groupingDecisions: [], comparison: { added: candidates.length, removed: 0, changed: 0 }, memoryReapplied: 0, memoryRestored: 0,
      memoryConflicts: [], ocr: { available: false, engine: "tesseract.js" }, ocrText: null, timings: {},
      diagnostics: kind ? { representation: { kind, associationRate: kind === "PHYSICAL" ? 0.95 : 0.05, evidence: {} } } : {} };
    event.analysis.planIntelligence = globalThis.buildPlanIntelligence(event, null);
    state.events.push(event); ui.activeEventId = event.id; ui.screen = "workspace"; ui.tab = "floor"; ui.planMode = "review"; render();
  }, { kind, chairs });
  await page.waitForTimeout(200);
  await page.click('[data-review-action="commit"]');
  await page.waitForTimeout(200);
  return page.evaluate(() => activeEvent().tables.map((t) => ({ source: t.capacitySource, physical: t.hasPhysicalSeats, chairs: (t.chairs || []).length, capacity: t.capacity })));
}
