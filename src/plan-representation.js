// What KIND of drawing is this?
//
// Not every seating plan draws furniture. Two real supplied plans, two
// different languages:
//
//   merit-real-venue   draws the furniture. Tables are shapes with a
//                      footprint, 113 chairs are drawn individually around
//                      them, and capacity is countable by counting seats.
//
//   ornek-symbolic     draws SYMBOLS. Every table is an identical numbered
//                      circle standing for a table, no chair is drawn
//                      anywhere on the sheet, and capacity is printed as a
//                      rule: "SALON : 166 * 12 : 1992 PAX".
//
// The detector was built on the first and silently assumed the second could
// not exist. Its chair-first path reasons about SIZE RANK: many small
// repeated round things surrounding a few larger shapes means the small ones
// are chairs and the large ones are tables. That is a good rule on a plan
// that draws furniture, and it earned its place there.
//
// On a symbolic plan it inverts completely. Every object is the same size and
// nothing is larger, so the 166 tables were taken for chairs, 132 of them
// were left as chairs belonging to no table, and the only things on the sheet
// bigger than a circle — the LOCA strip cells, a pillar, two direction arrows
// and the central column — became the tables. Ten "tables" returned, ten of
// them architecture, none of them a table. Measured, not supposed:
// benchmarks/heldout/ORNEK-FIRST-RUN.md.
//
// ---------------------------------------------------------------------------
// The evidence used here is the chair-first path's OWN FAILURE TO ASSOCIATE.
//
// If a plan really draws chairs, those chairs sit at tables — that is what
// makes them chairs. So the fraction of "chairs" that found a table is a
// direct test of the chair hypothesis, and it does not need to know anything
// about circles, numbers, venues or file types. Measured across every plan in
// the benchmark:
//
//     plan                        chairs   at a table   rate
//     adversarial-architecture       80         80      1.000
//     adversarial-bistro             72         72      1.000
//     adversarial-text               73         73      1.000
//     adversarial-dense              80         76      0.950
//     merit-real-venue              112        108      0.964
//     ornek-symbolic                143         11      0.077
//
// Every plan that draws chairs is at or above 0.95. The one that does not is
// at 0.077. There is nothing in between, so the thresholds below are not
// doing fine work and are not tuned to either plan: they are placed in the
// middle of a twelvefold gap, and a plan that lands in the gap is reported as
// NEEDS REVIEW rather than being quietly forced into one answer.
//
// This is deliberately NOT a rule about circles, numbers, PDFs or filenames.
// Nothing here may key on a plan's identity, and the numbers ORNEK prints
// about itself are ground truth for the benchmark, never constants in code.
(function () {
  "use strict";

  const MIN_OBJECTS = 20;            // below this there is no population to reason about
  const PHYSICAL_MIN_ASSOCIATION = 0.7;
  const SYMBOLIC_MAX_ASSOCIATION = 0.25;
  const SYMBOLIC_MIN_RATIO = 2;      // loose symbols must clearly outnumber the "tables"

  // A plan is symbolic if its main object population refuses to behave like
  // seating. `tablesFound` is how many objects the size-rank reasoning called
  // tables; on a symbolic plan that number is small and wrong, and the ratio
  // guard stops a plan that genuinely has many tables AND many loose chairs
  // from being flipped.
  function decide(ev) {
    const objects = ev.uniformObjects | 0;
    const associated = ev.associatedToTable | 0;
    const standalone = ev.standalone | 0;
    const tablesFound = ev.tablesFound | 0;
    const rate = objects > 0 ? associated / objects : null;
    const base = {
      version: 1,
      associationRate: rate === null ? null : Number(rate.toFixed(4)),
      evidence: { uniformObjects: objects, associatedToTable: associated, standalone, tablesFound },
      thresholds: { MIN_OBJECTS, PHYSICAL_MIN_ASSOCIATION, SYMBOLIC_MAX_ASSOCIATION, SYMBOLIC_MIN_RATIO },
    };

    // No uniform repeated family at all: the chair-first path never ran, so
    // its association rate carries no information. Saying nothing is correct.
    if (!ev.uniformFamily) {
      return { ...base, kind: "UNKNOWN",
        why: "no uniform repeated object family was found, so there is no population whose behaviour could say what kind of drawing this is" };
    }
    if (objects < MIN_OBJECTS) {
      return { ...base, kind: "UNKNOWN",
        why: `only ${objects} repeated objects, below the ${MIN_OBJECTS} needed before their association rate means anything` };
    }
    if (rate >= PHYSICAL_MIN_ASSOCIATION) {
      return { ...base, kind: "PHYSICAL",
        why: `${associated} of ${objects} repeated objects sit at a table (${(rate * 100).toFixed(1)}%), which is what drawn chairs do` };
    }
    if (rate <= SYMBOLIC_MAX_ASSOCIATION && standalone >= MIN_OBJECTS && standalone >= tablesFound * SYMBOLIC_MIN_RATIO) {
      return { ...base, kind: "SYMBOLIC",
        why: `only ${associated} of ${objects} repeated objects sit at a table (${(rate * 100).toFixed(1)}%), and ${standalone} are left belonging to nothing against ${tablesFound} objects called tables — a drawn chair belongs to a table, so these are not chairs` };
    }
    return { ...base, kind: "NEEDS_REVIEW",
      why: `${associated} of ${objects} repeated objects sit at a table (${rate === null ? "n/a" : (rate * 100).toFixed(1) + "%"}), which is neither clearly drawn seating nor clearly a symbolic plan` };
  }

  globalThis.MeritPlanRepresentation = { version: 1, decide, constants: { MIN_OBJECTS, PHYSICAL_MIN_ASSOCIATION, SYMBOLIC_MAX_ASSOCIATION, SYMBOLIC_MIN_RATIO } };
})();
