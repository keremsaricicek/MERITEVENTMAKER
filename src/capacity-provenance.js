// WHY DOES THIS TABLE HAVE THIS CAPACITY NUMBER?
//
// `table.capacity` and `table.hasPhysicalSeats`/`chair.physical` (see the
// syncTableChairs() comment in app-v8.js) answer "how many seats, and are
// they real chairs" -- neither says WHERE the number came from. A capacity
// read by counting confirmed chair detections is a different kind of fact
// than one a person typed into the seat-count field, and an operator
// deciding whether to trust a number needs to know which one they are
// looking at. `table.capacitySource` is that provenance tag: one of the
// values below, never invented per call site, never guessed from the
// number's shape.
//
// EIGHT NAMED SOURCES, THREE OF THEM PRODUCIBLE TODAY. This build can
// actually populate DETECTED_PHYSICAL_SEATS (Assisted Detection counted
// real confirmed chairs), HUMAN_CONFIRMED (a person set the number by
// hand -- the seat stepper, a preset, the custom field, or manually adding
// a table) and UNKNOWN (none of the above applied, so the number is a
// placeholder rather than a claim). The other five --
// PRINTED_TABLE_CAPACITY, PRINTED_ZONE_CAPACITY, PRINTED_TOTAL_CAPACITY,
// DERIVED_PRINTED_RULE, VERIFIED_VENUE_MEMORY -- are named because the
// taxonomy has to exist before the feature that fills it does. Nothing in
// this build today reads a number printed next to one table, applies a
// zone or venue-wide printed rule to an individual table's capacity, or
// carries a verified number forward from Visual Plan Memory into a fresh
// capacity value. Naming the slot now, rather than inventing it the day a
// real feature needs it, means that feature gets a place to report into
// instead of a reason to grow a second, competing field -- the same
// discipline as `MeritPlanDoctor.NOT_EVALUATED` and Smart Seating's
// "not set up yet": absence of a capability is stated, never quietly
// filled with a value it did not earn. WIRED below names exactly the three
// this build can honestly produce; the rest are UNWIRED, not aspirational.
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

  const WIRED = new Set([SOURCE.DETECTED_PHYSICAL_SEATS, SOURCE.HUMAN_CONFIRMED, SOURCE.UNKNOWN]);

  function isValid(source) {
    return typeof source === "string" && Object.prototype.hasOwnProperty.call(SOURCE, source);
  }

  // Used at every migration/import boundary: a value this build recognises
  // survives untouched; anything else (missing, from a future version, or
  // corrupted) becomes UNKNOWN rather than being guessed at or dropped.
  function normalize(source) {
    return isValid(source) ? source : SOURCE.UNKNOWN;
  }

  globalThis.MeritCapacityProvenance = { version: 1, SOURCE, WIRED, isValid, normalize };
})();
