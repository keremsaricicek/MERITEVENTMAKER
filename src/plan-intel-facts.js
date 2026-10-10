// The whole-plan interpreter: restates, as plan-level facts, what the stages before it found. It discovers no object.
//
// Part of Plan Intelligence, split out of src/plan-intelligence.js on 2026-10-04
// (technical gaps, item 2) and moved verbatim: the only edits are references to
// a name another part owns, which now go through that part's object. Nothing
// here is a trained model; every number is computed from real geometry or OCR.
(() => {
  "use strict";

  // ---- the whole-plan interpreter -----------------------------------------
  //
  // Everything above answers a question about one object, one pair or one
  // region. This answers questions about the DRAWING: what kind of room is
  // this, how many people does it seat, what is unresolved, what should a
  // person look at first. Those are the questions an operator actually opens
  // the plan with, and until now the product could answer none of them in
  // words.
  //
  // A fact is a claim, and a claim can be wrong, so every one carries:
  //
  //   strength    strong | likely | uncertain — and STRONG has to be earned.
  //               A strong fact is one where the evidence is direct and
  //               corroborated, so being wrong about it is a serious defect
  //               and benchmarks/interpreter/ scores it as one. Anything that
  //               depends on the detector having found everything is at best
  //               `likely`, because detection recall is not a certainty.
  //   provenance  which stage produced the evidence, in words.
  //   basis       the actual numbers, so nothing has to be taken on trust.
  //
  // Statements are structured (`key` + `params`), never pre-rendered English,
  // for the same reason review-group titles are: the domain layer does not
  // decide what language an operator reads.
  //
  // NOTHING HERE COUNTS AS A NEW MEASUREMENT. Every fact restates evidence
  // some earlier stage already produced. An interpreter that discovered new
  // objects would be a detector, and this is not one.
  function buildPlanFacts(candidates, zones, furnitureGroups, capacityAudit, physicalSeats, ocrText, extra) {
    const alive = candidates.filter(c => c.status !== "rejected");
    const tables = alive.filter(c => c.kind === "table");
    const facts = [];
    const say = (id, key, params, strength, provenance, basis) =>
      facts.push({ id, key, params, strength, provenance, basis });
    // Where a claim's evidence came from, as a key rather than a sentence. It
    // is shown next to the claim, so it is operator-facing text and belongs in
    // the string table like everything else an operator reads.
    const prov = (key, params) => ({ key: `provenance.${key}`, params: params || {} });

    // WHAT THE DRAWING ITSELF SAYS ITS CAPACITY IS -- unknown, and said so.
    // Defined here because BOTH exits below need it: an architect's shell
    // produces "nothing found" AND "no capacity stated", and those are two
    // different silences. Answering only the first reads as "nothing to
    // report" about the second.
    const sayCapacityUnknown = () => {
      const stated = capacityAudit && capacityAudit.drawingStated;
      if (stated != null) return false;
      const ocrRan = !(capacityAudit && capacityAudit.ocrAvailable === false);
      say("capacityUnknown", ocrRan ? "fact.noCapacityOnDrawing" : "fact.noStatedCapacity", {}, "strong",
        [prov(ocrRan ? "ocrReadNoCapacity" : "ocrDidNotRun")], {});
      return true;
    };

    if (!tables.length && !zones.length) {
      say("empty", "fact.nothingFound", {}, "strong",
        [prov("nothingSurvived")], {});
      // The drawing may still carry a printed capacity, or may carry none.
      // Either way the product states which, rather than falling silent on
      // the question because it found no furniture to count against.
      sayCapacityUnknown();
      return facts;
    }

    // -- what kind of room ----------------------------------------------------
    const byType = tables.reduce((m, t) => (m[t.type] = (m[t.type] || 0) + 1, m), {});
    const rankedTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]);
    if (rankedTypes.length) {
      const [modalType, modalCount] = rankedTypes[0];
      const share = modalCount / tables.length;
      // Two claims, deliberately NOT one sentence, because they are not equally
      // safe and one strength cannot cover both.
      //
      // Which type dominates is a property of the DRAWING: a large majority
      // does not flip because a few tables were missed. How many tables there
      // are is bounded by detection recall and can never be better than it.
      //
      // Measured, when they were one `strong` fact: on the bistro fixture the
      // detector finds 18 of 23 tables, and the interpreter stated "18 tables,
      // most of them square" with certainty. The type half was right and the
      // count half was wrong by 22%, and bundling them made the product
      // confidently wrong — which is worse than saying less.
      say("tableTypeMix", "fact.tableTypeMix", { type: modalType, n: modalCount },
        share >= 0.6 ? "strong" : "likely",
        [prov("typeClassificationThreeStages")],
        { byType, share: +share.toFixed(2) });
      say("tableCount", "fact.tableCount", { total: tables.length }, "likely",
        [prov("tablesSurvivingDetection")],
        { total: tables.length });
      for (const [type, n] of rankedTypes.slice(1))
        say(`has:${type}`, "fact.alsoHas", { n, type }, "likely",
          [prov("typeClassification")], { count: n });
    }

    // -- seating --------------------------------------------------------------
    // What can honestly be said here depends on what kind of drawing this is,
    // so it forks. A plan that draws its furniture gets a seat count; a plan
    // whose tables are symbols has no seats to count and gets told so.
    const seatedTables = tables.filter(t => (t.chairDetections || []).length).length;
    const representation = (extra && extra.representation) || null;
    const symbolic = representation && representation.kind === "SYMBOLIC";
    if (symbolic) {
      // On a drawing whose tables are symbols there are no seats to count, and
      // saying "0 seats detected" would be a capacity claim dressed as a
      // measurement — the reader hears "this room seats nobody". What is
      // actually true is a statement about the DRAWING, and it is strong
      // because it is exactly what was measured: an object family that refuses
      // to behave like seating. What the room really holds is printed on the
      // sheet, and reading that is a separate job from counting shapes.
      say("representation", "fact.symbolicPlan", { tables: tables.length }, "strong",
        [prov("symbolFamilyNoSeating")],
        { associationRate: representation.associationRate, ...representation.evidence });
      // `unseatedTables` is skipped for the same reason. On this plan every
      // table is unseated, by design; reporting it as a finding turns the
      // drawing's own convention into 132 anomalies.
    } else {
      // Never `strong`: a seat count is exactly as complete as detection recall,
      // and claiming certainty about it would be the easiest lie in the product.
      say("seats", "fact.seats", { seats: physicalSeats, tables: tables.length }, "likely",
        [prov("chairsDetectedAssociated")],
        { physicalSeats, seatedTables });
      const unseated = tables.length - seatedTables;
      if (unseated > 0)
        say("unseated", "fact.unseatedTables", { n: unseated }, "likely",
          [prov("tablesWithNoChair")], { unseated });
      if (representation && representation.kind === "NEEDS_REVIEW")
        say("representationUnclear", "fact.representationUnclear",
          { pct: Math.round((representation.associationRate || 0) * 100) }, "uncertain",
          [prov("associationRateInGap")], representation.evidence);
    }

    // -- logical groups -------------------------------------------------------
    const multi = (furnitureGroups || []).filter(g => (g.memberIds || []).length > 1);
    if (multi.length) {
      const biggest = multi.reduce((a, b) => ((b.memberIds || []).length > (a.memberIds || []).length ? b : a));
      say("groups", "fact.combinedTables",
        { groups: multi.length, largest: (biggest.memberIds || []).length }, "likely",
        [prov("touchAndAlign")],
        { groups: multi.length, largest: (biggest.memberIds || []).length });
    }

    // -- zones ----------------------------------------------------------------
    const zoneTypes = zones.reduce((m, z) => (m[z.type] = (m[z.type] || 0) + 1, m), {});
    for (const [type, n] of Object.entries(zoneTypes)) {
      if (type === "unknown") {
        say("zone:unknown", "fact.undeterminedAreas", { n }, "uncertain",
          [prov("noZoneRule")], { n });
        continue;
      }
      // The claim inherits the zones' own confidence rather than asserting one
      // of its own, and a claim about several areas is only as strong as the
      // weakest of them. Hardcoding `strong` for stages here is what let a
      // shape guess reach the operator as a certainty.
      const ofType = zones.filter(z => z.type === type);
      const weakest = ofType.some(z => z.confidence !== "strong") ? "likely" : "strong";
      say(`zone:${type}`, "fact.zone", { n, type }, weakest,
        [prov("zoneTyped", { type })], { n });
    }

    // -- what the drawing itself says -----------------------------------------
    // A printed capacity RULE is worth more than a printed total: it says how
    // many tables the room has and how many people sit at one, which a seat
    // count can never say and which the detector can be measured against.
    const rule = capacityAudit && capacityAudit.rule;
    if (rule) {
      const parts = (capacityAudit && capacityAudit.parts) || {};
      say("capacityRule", "fact.capacityRule",
        { units: rule.units, perUnit: rule.perUnit, seats: rule.total,
          others: parts.total != null ? parts.total - rule.total : null,
          total: parts.total ?? null },
        // Read off the page, and the multiplication checks out — but a count
        // the OCR did not actually agree with is one step further from the
        // page than one it did, and says so.
        rule.unitsAgree ? "strong" : "likely",
        [prov("capacityRuleFromOcr")],
        { ...rule, parts });
      const found = tables.length;
      if (found !== rule.units)
        say("capacityRuleVsFound", "fact.tablesVsStated",
          { stated: rule.units, found, difference: Math.abs(rule.units - found) }, "strong",
          [prov("capacityRuleFromOcr"), prov("tablesDetected")],
          { stated: rule.units, found });
    }
    const stated = capacityAudit && capacityAudit.drawingStated;
    // Comparing a printed pax figure against a SEAT COUNT only means something
    // on a plan that draws seats. On a symbolic one it reads "the plan states
    // 2064 pax but 0 seats were counted", which sounds like a finding and is
    // really just a restatement of what kind of drawing this is. The
    // comparison that does mean something there is tables against tables, and
    // fact.tablesVsStated above makes it. The CAPACITY contradiction is built
    // from this fact, so it stands down with it.
    if (stated != null && !symbolic) {
      const diff = stated - physicalSeats;
      say("capacity", Math.abs(diff) <= Math.max(2, stated * 0.05) ? "fact.capacityAgrees" : "fact.capacityDiffers",
        { stated, counted: physicalSeats, difference: Math.abs(diff) },
        // OCR read a number off the page: what the PLAN says is direct
        // evidence, whatever the detector counted.
        "strong",
        [prov("paxFromOcr"), prov("seatsCounted")],
        { stated, counted: physicalSeats, difference: diff });
    } else {
      // SILENCE IS NOT AN ANSWER. This used to fire only when OCR could not
      // run at all -- so on a drawing where OCR ran perfectly well and simply
      // found no capacity figure, the product said NOTHING about capacity.
      // An operator reads that as "nothing to report", which is the opposite
      // of the truth: the drawing's own figure is unknown. The fact now
      // follows the OUTCOME (no capacity could be established) rather than
      // the REASON one particular route failed, and names which route it was.
      sayCapacityUnknown();
    }
    const unverified = (capacityAudit && capacityAudit.unverified) || [];
    if (unverified.length)
      say("unverifiedSeating", "fact.unverifiedSeating", { n: unverified.length }, "strong",
        [prov("unreadableCapacity")],
        { ids: unverified.map(u => u.id) });

    // -- what the relationships say -------------------------------------------
    //
    // These exist only because Relationship Engine 2.0 does. Before it, the
    // product had no way to know a seat was a close call, so a fact about one
    // would have been invented. None of them is ever `strong`: a new and richer
    // kind of claim does not get to arrive at the top confidence just because
    // it is new (§42), and every one of them rests on detection recall.
    const seatsWithRelation = [];
    for (const t of tables) for (const ch of t.chairDetections || []) if (ch.relation) seatsWithRelation.push(ch);
    if (seatsWithRelation.length) {
      const ambiguous = seatsWithRelation.filter(ch => ch.relation.ambiguous);
      if (ambiguous.length)
        say("seatsAmbiguous", "fact.seatsAmbiguous", { n: ambiguous.length }, "likely",
          [prov("competingTablesCompared")], { n: ambiguous.length });
      const facing = seatsWithRelation.filter(ch => ch.relation.orientation && ch.relation.orientation.facingKnown);
      if (facing.length)
        say("seatsFacing", "fact.seatsFacing", { n: facing.length, total: seatsWithRelation.length },
          // How many symbols carry a direction is a property of the drawing and
          // does not depend on having found every seat, so it is not weakened
          // by recall the way a count is — but it is still only `likely`,
          // because the orientation itself is derived rather than read.
          "likely", [prov("symbolAsymmetry")], { facing: facing.length, of: seatsWithRelation.length });
      const tucked = seatsWithRelation.filter(ch => ch.relation.evidence
        && ch.relation.evidence.positionKind === "inside");
      if (tucked.length >= Math.max(3, seatsWithRelation.length * 0.25))
        say("seatsTucked", "fact.seatsTucked", { n: tucked.length }, "likely",
          [prov("seatPositionOnTable")], { n: tucked.length });
    }

    // -- what the memory says -------------------------------------------------
    //
    // Only from evidence the matcher actually produced. A plan with no earlier
    // decisions produces none of these rather than a reassuring sentence about
    // having nothing to compare.
    const mem = (extra && extra.memory) || null;
    if (mem && mem.reapplied > 0)
      say("memoryReapplied", "fact.memoryReapplied", { n: mem.reapplied }, "strong",
        // Direct: these decisions were re-applied, and the product can point at
        // each one. It does not claim they were re-applied CORRECTLY.
        [prov("decisionsMatchedBack")], { n: mem.reapplied });
    if (mem && mem.lost > 0)
      say("memoryLost", "fact.memoryLostObjects", { n: mem.lost }, "likely",
        [prov("confirmedButNotFound")], { n: mem.lost });
    if (mem && mem.ambiguous > 0)
      say("memoryAmbiguous", "fact.memoryAmbiguousObjects", { n: mem.ambiguous }, "likely",
        [prov("twoObjectsFitOneDecision")], { n: mem.ambiguous });

    return facts;
  }

  globalThis.MeritPlanFacts = Object.freeze({ buildPlanFacts });
})();
