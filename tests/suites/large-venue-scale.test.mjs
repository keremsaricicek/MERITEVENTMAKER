// A plan bigger than the cap, and the cap that used to eat it.
//
// `plan-detection-classical.js` bounds how many table candidates it will
// rank. That bound was 240 — and 240 sits *inside* the range real venues
// occupy. The large-venue adversarial fixture has 324 tables, so the
// detector returned exactly 240 of them and reported table recall 0.741,
// which is 240/324 to four figures. Eighty-four real tables were discarded
// by arithmetic rather than by any judgement about them, and the operator's
// only clue was one row in a diagnostics panel.
//
// A resource ceiling is still correct engineering: a photograph of noise can
// label tens of thousands of components, and something has to refuse to run
// unbounded. The error was placing the ceiling where real work happens.
//
// Two different things are asserted here, and they are different on purpose:
//
//   1. THE CEILING IS NOT A CORRECTNESS LIMIT. It must sit far above any plan
//      a venue could draw, and truncation must be reported when it happens.
//
//   2. THE APP CARRIES A REAL LARGE VENUE. 400+ tables and 4,000+ logical
//      seats, through the actual product: capacity arithmetic, seating,
//      assignment, reports. A detector that returns every object is worth
//      nothing if the shell loses them afterwards.
//
// The second is the one that would catch a silent loss introduced somewhere
// other than the detector, which is why it exercises the domain rather than
// re-testing the pipeline.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "large-venue-scale", tags: ["business", "fast"], timeout: 180000 };

const TABLES = 420;
const SEATS_PER = 10;          // 4,200 logical seats
const GUESTS = 900;

// Built through the model: this suite is about whether scale survives the
// domain, and 420 dialog round-trips would measure Playwright instead.
const SEED = `(function(){
  const e = state.events[0];
  const tables = [];
  for (let i = 0; i < ${TABLES}; i++) {
    const id = "t_" + i;
    tables.push({
      id, number: "T" + String(i + 1).padStart(3, "0"),
      type: i % 5 === 0 ? "round" : "rectangle",
      x: 60 + (i % 30) * 42, y: 60 + Math.floor(i / 30) * 52,
      w: 38, h: 30, rotation: 0, locked: false, z: 10,
      capacity: ${SEATS_PER},
      zone: ["MAIN FLOOR", "VIP", "BISTRO"][i % 3],
      // A SYMBOLIC plan: capacity is a printed rule, no chair was drawn.
      // physicalChairs stays empty on purpose — inventing ${TABLES * SEATS_PER}
      // chair coordinates from a capacity number is exactly what the product
      // contract forbids.
      chairs: [], hasPhysicalSeats: false, capacitySource: "PRINTED_TABLE_CAPACITY",
    });
  }
  e.tables = tables;
  const guests = [];
  for (let i = 0; i < ${GUESTS}; i++) {
    guests.push({
      id: "g_" + i, name: "Guest " + String(i).padStart(4, "0"),
      additionalGuests: i % 3, pax: 1 + (i % 3),
      vip: "Standard", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, notes: "", invitedBy: "", checkedInAt: null,
    });
  }
  e.guests = guests;
  return { tables: e.tables.length, guests: e.guests.length };
})()`;

export default async function run({ page, checks, baseUrl, repoRoot }) {
  // --- 1. the ceiling, read from the source it lives in --------------------
  const det = fs.readFileSync(path.join(repoRoot, "src", "plan-detection-classical.js"), "utf8");
  const cap = det.match(/const\s+MAX_TABLES\s*=\s*(\d+)/);
  checks.require(cap, "the candidate ceiling is still a named constant in the detection pipeline");
  const ceiling = Number(cap[1]);

  checks.ok(ceiling >= 1000,
    "the candidate ceiling sits far above real-venue scale. It was 240, which is INSIDE the range venues occupy — the 324-table fixture lost 84 real tables to it and reported recall 0.741 = 240/324 exactly. A ceiling is fine; a ceiling where real work happens is a correctness bug",
    ceiling);
  checks.ok(ceiling > TABLES * 2,
    `the ceiling clears this suite's ${TABLES}-table plan with real headroom, so a large venue is nowhere near it`,
    { ceiling, tables: TABLES });

  // A ceiling that is never reported is the failure mode being fixed, so the
  // reporting path has to exist even though no honest plan should reach it.
  checks.ok(/capReached\s*=\s*scored\.length\s*>\s*MAX_TABLES/.test(det),
    "truncation is still detected when it happens — a silent slice is what made the original bug invisible",
    true);
  const v8 = fs.readFileSync(path.join(repoRoot, "src", "app-v8.js"), "utf8");
  checks.ok(/candidateCapReached/.test(v8),
    "and the shell surfaces it, so hitting the ceiling reaches a person rather than only a variable",
    true);

  // --- 2. a real large venue, through the product --------------------------
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Large Venue Scale", date: futureDate(30) });
  const seeded = await page.evaluate(SEED);
  checks.equal(seeded.tables, TABLES, `the event carries ${TABLES} tables`, seeded.tables);
  checks.equal(seeded.guests, GUESTS, `and ${GUESTS} guest records`, seeded.guests);

  const model = await page.evaluate(() => {
    const e = state.events[0];
    return {
      tables: e.tables.length,
      logicalSeats: e.tables.reduce((n, t) => n + (Number(t.capacity) || 0), 0),
      physicalChairs: e.tables.reduce((n, t) => n + (t.chairs || []).length, 0),
      physicalCapacity: MeritSeatModel.physicalCapacity(e),
      seatingCapacity: MeritSeatModel.seatingCapacity(e),
      zones: [...new Set(e.tables.map(t => t.zone))].sort(),
      numbersUnique: new Set(e.tables.map(t => t.number)).size,
    };
  });

  checks.ok(model.logicalSeats >= 4000,
    "the plan carries over four thousand LOGICAL seats — the scale the product is specified for",
    model.logicalSeats);
  checks.equal(model.physicalChairs, 0,
    "and ZERO physical chairs, because nothing drew any. capacity=10 with physicalChairs=0 is the ordinary symbolic-plan case, not a defect — inventing 4,200 chair coordinates from a capacity number is what the contract forbids",
    model.physicalChairs);
  checks.equal(model.physicalCapacity, 0,
    "the room's PHYSICAL chair count is honestly zero — nothing drew one", model.physicalCapacity);
  checks.equal(model.seatingCapacity, model.logicalSeats,
    "while its OPERATIONAL capacity is all 4,200 seats. Answering the capacity question with the physical-chair number reported an empty room for a whole class of real venue plans",
    { seating: model.seatingCapacity, logical: model.logicalSeats });
  checks.equal(model.numbersUnique, TABLES,
    "every table kept a distinct number at this scale — a collision here would strand guests at the door", model.numbersUnique);

  // --- 3. nothing is lost across a save/reload round trip ------------------
  // The detector returning every object is worth nothing if persistence
  // drops some. This is the check that would catch a loss introduced
  // somewhere other than the pipeline.
  // saveState() queues the write and returns undefined — it does not hand
  // back the queue promise, so `await saveState()` waits for nothing. Poll
  // the store instead of guessing a delay. (That the save cannot be awaited
  // is a real property of the current write path, noted for the write-ordering
  // work rather than worked around here.)
  const after = await page.evaluate(async () => {
    saveState();
    const read = async () => {
      const raw = await MERIT_STORAGE_PROVIDER.load();
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    };
    let root = null;
    for (let i = 0; i < 100; i++) {
      root = await read();
      if ((root?.events?.[0]?.tables || []).length) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const ev = (root?.events || [])[0] || {};
    return {
      tables: (ev.tables || []).length,
      guests: (ev.guests || []).length,
      seats: (ev.tables || []).reduce((n, t) => n + (Number(t.capacity) || 0), 0),
      chairs: (ev.tables || []).reduce((n, t) => n + (t.chairs || []).length, 0),
    };
  });
  checks.equal(after.tables, TABLES, "every table survived the round trip to storage", after.tables);
  checks.equal(after.guests, GUESTS, "every guest survived it", after.guests);
  checks.equal(after.seats, model.logicalSeats, "and the logical seat total is unchanged", after.seats);
  checks.equal(after.chairs, 0, "no chair was synthesised on the way to storage", after.chairs);

  // --- 4. assignment arithmetic holds at scale -----------------------------
  const seating = await page.evaluate(() => {
    const e = state.events[0];
    const t = e.tables[0];
    // Seat a +2 party: one record, three people, three seats.
    const g = e.guests.find(x => x.additionalGuests === 2);
    assignGuestToTable(g.id, t.id);
    const seated = e.guests.find(x => x.id === g.id);
    return {
      pax: 1 + (seated.additionalGuests || 0),
      seats: (seated.assignment?.seats || []).length,
      tableId: seated.assignment?.tableId,
      expectedTable: t.id,
      occupied: typeof occupiedSeatIndexes === "function"
        ? occupiedSeatIndexes(e, t.id).size : null,
    };
  });
  checks.equal(seating.tableId, seating.expectedTable,
    "a guest seated at the first table of a 420-table plan lands on that table", seating.tableId);
  checks.equal(seating.seats, seating.pax,
    "a +2 party takes exactly three seats — one record, three people, and the arithmetic does not drift at scale",
    { seats: seating.seats, pax: seating.pax });
  checks.equal(seating.occupied, seating.pax,
    "and the table reports exactly those seats occupied", seating.occupied);
}
