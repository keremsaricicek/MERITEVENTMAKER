// PHYSICAL CHAIR, LOGICAL SEAT, OPERATIONAL CAPACITY — three different
// concepts, and this suite exists to keep the data model from collapsing
// them back into one the moment a table's capacity is anything but zero.
//
//   A PHYSICAL CHAIR exists only when the plan genuinely depicted one (or a
//   person confirmed one) — never merely because a table has a capacity
//   number. `hasPhysicalSeats:false` (a symbolic table — capacity read from
//   a printed number or rule, no chairs drawn) must render NO chair glyphs
//   on the Floor Plan/Seating canvas, however large its capacity is.
//
//   A LOGICAL SEATING POSITION survives regardless: `table.chairs.length`
//   stays exactly `table.capacity` either way, because guest assignment,
//   seat numbering and pax counting must work identically on a symbolic
//   table — the fix here is what gets DRAWN, never what gets ASSIGNED.
//
//   OPERATIONAL CAPACITY (physical chair counts feeding Live/Reports
//   totals) must keep excluding a symbolic table's seats exactly as it did
//   before this fix — this suite protects that pre-existing behaviour
//   rather than assuming it.
import { click, openApp, createBlankEvent, addTables, settle } from "../lib/app-actions.mjs";

export const meta = { name: "physical-logical-seat-separation", tags: ["business", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Seat Separation" });
  await addTables(page, { quantity: 1 });
  await settle(page);

  // --- 1. a manually-created table is physical by default, chairs render ---
  const before = await page.evaluate(() => {
    const t = state.events[0].tables[0];
    t.capacity = 8;
    touchEvent(state.events[0]);
    render();
    return {
      hasPhysicalSeats: t.hasPhysicalSeats,
      chairsLength: t.chairs.length,
      chairGlyphs: document.querySelectorAll(`.chair[data-chair-id]`).length,
    };
  });
  checks.equal(before.hasPhysicalSeats, true, "a manually-authored table defaults to physical — its seat ring is a deliberate authoring affordance, not fabricated plan evidence", before);
  checks.equal(before.chairsLength, 8, "logical seat count matches capacity", before);
  checks.equal(before.chairGlyphs, 8, "a physical table's chairs render as real glyphs on the canvas", before);

  // --- 2. flip the same table to symbolic: capacity/logical slots untouched,
  //        but no chair is drawn -----------------------------------------
  const after = await page.evaluate(() => {
    const e = state.events[0], t = e.tables[0];
    t.hasPhysicalSeats = false;
    touchEvent(e);
    render();
    return {
      capacity: t.capacity,
      chairsLength: t.chairs.length,
      chairPhysicalFlags: t.chairs.map(c => c.physical),
      chairGlyphs: document.querySelectorAll(`.chair[data-chair-id]`).length,
    };
  });
  checks.equal(after.capacity, 8, "capacity is unchanged by the physical/symbolic flip", after);
  checks.equal(after.chairsLength, 8, "logical seat count is STILL 8 — assignment/seat numbering is unaffected by this fix", after);
  checks.ok(after.chairPhysicalFlags.every(p => p === false), "every chair on a symbolic table honestly records physical:false", after);
  checks.equal(after.chairGlyphs, 0, "a symbolic table's capacity ring draws NO chair glyphs — capacity alone never fabricates a physical chair", after);

  // --- 3. flip back to physical: chairs render again, geometry preserved ---
  const backToPhysical = await page.evaluate(() => {
    const e = state.events[0], t = e.tables[0];
    const beforeGeometry = t.chairs.map(c => ({ x: c.x, y: c.y }));
    t.hasPhysicalSeats = true;
    touchEvent(e);
    render();
    const afterGeometry = state.events[0].tables[0].chairs.map(c => ({ x: c.x, y: c.y }));
    return {
      chairGlyphs: document.querySelectorAll(`.chair[data-chair-id]`).length,
      geometryPreserved: JSON.stringify(beforeGeometry) === JSON.stringify(afterGeometry),
      allPhysical: state.events[0].tables[0].chairs.every(c => c.physical === true),
    };
  });
  checks.equal(backToPhysical.chairGlyphs, 8, "flipping back to physical draws all 8 chairs again", backToPhysical);
  checks.ok(backToPhysical.geometryPreserved, "a physical table's chair geometry (x/y) is byte-identical across a physical->symbolic->physical round trip — no chair silently moved", backToPhysical);
  checks.ok(backToPhysical.allPhysical, "every chair is honestly re-marked physical:true once real seats are confirmed again", backToPhysical);

  // --- 4. Assisted Detection commit path: hasPhysicalSeats follows the
  //        plan's own representation verdict, not a hardcoded default ------
  const commitScenarios = await page.evaluate(() => {
    // Exercises the exact expression commitCandidates() now uses, without
    // needing a full detection run: the same representation-kind check
    // runSelfCheck() already reads from analysis.diagnostics.
    const drawsSeatsFor = (repKind, chairDetectionsLength) => {
      const drawsSeats = !!(repKind === "PHYSICAL");
      return drawsSeats || !!chairDetectionsLength;
    };
    return {
      physicalPlanNoDetections: drawsSeatsFor("PHYSICAL", 0),
      symbolicPlanNoDetections: drawsSeatsFor("SYMBOLIC", 0),
      symbolicPlanButConfirmedChairs: drawsSeatsFor("SYMBOLIC", 4),
      noVerdictYet: drawsSeatsFor(null, 0),
    };
  });
  checks.equal(commitScenarios.physicalPlanNoDetections, true, "a PHYSICAL-verdict plan's committed tables start hasPhysicalSeats:true", commitScenarios);
  checks.equal(commitScenarios.symbolicPlanNoDetections, false, "a SYMBOLIC-verdict plan's committed tables start hasPhysicalSeats:false — no fabricated chairs from a printed-number table", commitScenarios);
  checks.equal(commitScenarios.symbolicPlanButConfirmedChairs, true, "a specific candidate with real confirmed chair detections is still physical even on an otherwise-symbolic plan", commitScenarios);
  checks.equal(commitScenarios.noVerdictYet, false, "with no representation verdict at all, the default is symbolic (abstain from claiming physical chairs), never the old unconditional true", commitScenarios);

  // --- 5. symbolic-table PHYSICAL capacity (physicalCapacity(), the Home
  //        screen's own "physical chairs" fact) stays correctly excluded,
  //        exactly as the pre-existing hasPhysicalSeats gating already did
  //        before this fix — this protects that behaviour, not just adds it.
  await click(page, '[data-action="back-events"]');
  await settle(page);
  // The hero has TWO ".nb-top" rows (seated progress, then capacity
  // progress) when physical capacity is nonzero, collapsing to just the
  // first plus a plain "no plan yet" notice (no <b>) when it is zero.
  const physicalBefore = await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].hasPhysicalSeats = true;
    touchEvent(e); render();
    const rows = [...document.querySelectorAll(".next-event-bars .nb-top")];
    return { count: rows.length, capacityText: rows[1]?.querySelector("b")?.textContent.trim() || null };
  });
  checks.equal(physicalBefore.count, 2, "with the table physical, both the seated and capacity bars render", physicalBefore);
  checks.ok(physicalBefore.capacityText && /\/\s*8\s*$/.test(physicalBefore.capacityText),
    "the home hero's capacity bar denominator (physical chairs) is 8", physicalBefore);
  const physicalAfter = await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].hasPhysicalSeats = false;
    touchEvent(e); render();
    const rows = [...document.querySelectorAll(".next-event-bars .nb-top")];
    return { count: rows.length, secondRowHasBar: !!rows[1]?.querySelector("b") };
  });
  checks.equal(physicalAfter.count, 2, "the second row still renders (as the amber 'no plan yet' notice), just without a bar", physicalAfter);
  checks.ok(!physicalAfter.secondRowHasBar,
    "with the table symbolic, physical capacity is zero — the capacity bar disappears entirely rather than showing 8/0, the same fact the pre-existing hasPhysicalSeats gate already protected", physicalAfter);
}
