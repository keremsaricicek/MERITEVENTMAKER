// WHY DOES THIS TABLE HAVE THIS CAPACITY NUMBER?
//
// `table.capacity` and `table.chairs` (see the syncTableChairs() comment in
// app-v8.js) answer "how many seats, and how many chairs did the plan
// actually draw" -- neither says WHERE the capacity number came from. A capacity
// read by counting confirmed chair detections is a different kind of fact
// than one a person typed into the seat-count field, and an operator
// deciding whether to trust a number needs to know which one they are
// looking at. `table.capacitySource` is that provenance tag: one of the
// values below, never invented per call site, never guessed from the
// number's shape.
//
// EIGHT NAMED SOURCES, AT THREE LEVELS, FIVE OF THEM PRODUCIBLE (§5).
//
// A source describes a TABLE, a ZONE or the whole PLAN, and a number is only
// ever tagged at the level its evidence reaches. "The drawing prints 2064
// PAX" says nothing about any one table, so PRINTED_TOTAL_CAPACITY is a PLAN
// source and a table can never carry it — normalizeForTable() turns it into
// UNKNOWN rather than let an aggregate masquerade as a per-table fact.
//
// Produced by this build:
//   DETECTED_PHYSICAL_SEATS  table  Assisted Detection counted confirmed chairs
//   HUMAN_CONFIRMED          table  a person set the number (stepper, preset,
//                                   custom field, manual add)
//   DERIVED_PRINTED_RULE     table  the drawing prints a rule ("166 * 12 : 1992")
//                                   whose multiplication comes out, the plan
//                                   draws no seats, and the table is a seatless
//                                   symbol of the kind the rule counts — see
//                                   ruleApplication() for every condition
//   PRINTED_TOTAL_CAPACITY   plan   the drawing's own stated total, read by OCR
//                                   (planStatedCapacity())
//   UNKNOWN                  table  none of the above: a placeholder, not a claim
//
// Named, and NOT produced — each says why:
//   PRINTED_TABLE_CAPACITY   nothing reads a pax figure printed beside ONE table
//   PRINTED_ZONE_CAPACITY    the labelled figures OCR reads ("LOCALAR : 72 PAX")
//                            name printed areas, which are not mapped to the
//                            product's zones; they stay inside the plan's
//                            statement as its breakdown
//   VERIFIED_VENUE_MEMORY    Visual Plan Memory carries identity, not capacity
//
// Naming a slot before the feature that fills it means that feature reports
// into it instead of growing a second, competing field — the discipline of
// `MeritPlanDoctor.NOT_EVALUATED`. And never, at any level: a printed pax
// figure turned into chairs. A DERIVED capacity is a logical seat space; the
// table's `chairs` stay empty because the drawing drew none.
(function () {
  "use strict";

  const SOURCE = {
    DETECTED_PHYSICAL_SEATS: "DETECTED_PHYSICAL_SEATS",
    PRINTED_TABLE_CAPACITY: "PRINTED_TABLE_CAPACITY",
    PRINTED_ZONE_CAPACITY: "PRINTED_ZONE_CAPACITY",
    PRINTED_TOTAL_CAPACITY: "PRINTED_TOTAL_CAPACITY",
    DERIVED_PRINTED_RULE: "DERIVED_PRINTED_RULE",
    VERIFIED_VENUE_MEMORY: "VERIFIED_VENUE_MEMORY",
    HUMAN_CONFIRMED: "HUMAN_CONFIRMED",
    UNKNOWN: "UNKNOWN",
  };

  const WIRED = new Set([SOURCE.DETECTED_PHYSICAL_SEATS, SOURCE.HUMAN_CONFIRMED, SOURCE.DERIVED_PRINTED_RULE,
    SOURCE.PRINTED_TOTAL_CAPACITY, SOURCE.UNKNOWN]);
  const LEVEL = {
    DETECTED_PHYSICAL_SEATS: "table", PRINTED_TABLE_CAPACITY: "table", DERIVED_PRINTED_RULE: "table",
    VERIFIED_VENUE_MEMORY: "table", HUMAN_CONFIRMED: "table", UNKNOWN: "table",
    PRINTED_ZONE_CAPACITY: "zone", PRINTED_TOTAL_CAPACITY: "plan",
  };
  const MAX_PER_TABLE = 99;   // the same ceiling setTableCapacity() holds a person to

  function isValid(source) {
    return typeof source === "string" && Object.prototype.hasOwnProperty.call(SOURCE, source);
  }

  // Used at every migration/import boundary: a value this build recognises
  // survives untouched; anything else (missing, from a future version, or
  // corrupted) becomes UNKNOWN rather than being guessed at or dropped.
  function normalize(source) {
    return isValid(source) ? source : SOURCE.UNKNOWN;
  }

  // A table's own tag: a plan- or zone-level source on a table is a category
  // error, not a value to keep.
  function normalizeForTable(source) {
    return isValid(source) && LEVEL[source] === "table" ? source : SOURCE.UNKNOWN;
  }

  // May the printed rule give THESE tables a capacity? Every condition is a
  // reason the answer could be wrong, and each refusal is named:
  //   - there is a rule, and its figures are whole numbers that multiply out
  //     (the OCR parser only returns one whose arithmetic checks)
  //   - the plan draws no seats (representation SYMBOLIC): on a plan that
  //     draws chairs, the chairs are the evidence and a rule is not needed
  //   - the table is a seatless symbol — a table with detected chairs is
  //     counted by its chairs, never by the rule
  //   - the rule could cover them all: more seatless tables than the drawing
  //     says it has means the rule is not describing these symbols
  //   - the per-table figure is one a person could have typed (≤ 99)
  // Pure: it decides, it writes nothing.
  function ruleApplication({ rule, representationKind, seatlessTables }) {
    const no = (why) => ({ applies: false, why });
    if (!rule || !Number.isInteger(rule.units) || !Number.isInteger(rule.perUnit) || !Number.isInteger(rule.total))
      return no("noRule");
    if (rule.units * rule.perUnit !== rule.total) return no("arithmetic");
    if (representationKind !== "SYMBOLIC") return no("notSymbolic");
    if (!(seatlessTables > 0)) return no("noSeatlessTables");
    if (seatlessTables > rule.units) return no("moreTablesThanRule");
    if (rule.perUnit < 1 || rule.perUnit > MAX_PER_TABLE) return no("perUnitOutOfRange");
    return {
      applies: true, perUnit: rule.perUnit,
      evidence: {
        source: SOURCE.DERIVED_PRINTED_RULE,
        rule: `${rule.units} × ${rule.perUnit} = ${rule.total}`,
        status: rule.unitsAgree ? "READ" : "DERIVED",
        why: String(rule.why || ""),
        appliesTo: seatlessTables,
        confirmedBy: null,
      },
    };
  }

  // The drawing's own stated capacity, kept at the level it describes.
  function planStatedCapacity(capacityAudit) {
    const a = capacityAudit || {};
    const total = a.parts && Number.isFinite(a.parts.total) ? a.parts.total : Number.isFinite(a.drawingStated) ? a.drawingStated : null;
    if (total == null) return null;
    return { source: SOURCE.PRINTED_TOTAL_CAPACITY, level: "plan", total,
      rule: a.rule ? { units: a.rule.units, perUnit: a.rule.perUnit, total: a.rule.total } : null,
      parts: a.parts || null, sourceText: a.sourceText || null };
  }

  globalThis.MeritCapacityProvenance = { version: 2, SOURCE, WIRED, LEVEL, MAX_PER_TABLE, isValid, normalize, normalizeForTable,
    ruleApplication, planStatedCapacity };
})();
