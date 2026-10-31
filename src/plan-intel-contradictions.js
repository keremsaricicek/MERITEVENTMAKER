// Contradictions: where one stage's finding disagrees with another's, and what that disagreement does to a claim's strength.
//
// Part of Plan Intelligence, split out of src/plan-intelligence.js on 2026-10-04
// (technical gaps, item 2) and moved verbatim: the only edits are references to
// a name another part owns, which now go through that part's object. Nothing
// here is a trained model; every number is computed from real geometry or OCR.
(() => {
  "use strict";
  const GEOM = globalThis.MeritPlanIntelGeometry;

  // ---- contradictions ------------------------------------------------------
  //
  // Everything above this point is a pipeline stage stating what IT found. Each
  // one is honest on its own terms and each one can be wrong, and the product
  // had no way to notice when two of them could not both be right. The
  // interpreter would then say "112 seats" and "6 tables nobody sits at" in the
  // same confident voice, on the same screen, and leave the operator to spot
  // that those are the same failure described twice.
  //
  // A contradiction here is a specific thing, not a low score: TWO STAGES THAT
  // CANNOT BOTH BE RIGHT. So every entry names both sides and where each came
  // from. A stage merely being unsure is not a contradiction — that is what
  // `strength` already carries.
  //
  // Nothing is deleted, reclassified or re-detected on this evidence. A
  // contradiction lowers the confidence of the claims it undermines and goes to
  // the top of the review queue, because the resolution belongs to the person
  // looking at the drawing.
  const CONTRADICTION_KINDS = ["COUNT", "TYPE", "RELATIONSHIP", "ZONE", "CAPACITY", "MEMORY", "SEMANTIC"];
  const ORPHAN_SEAT_SHARE = 0.15;   // of all detected seats, before it is a disagreement rather than a few stragglers
  const FAMILY_MIN_FOR_OUTLIER = 4; // a "family" of three cannot have a meaningful outlier
  // A disagreement about a handful of objects does not undermine a claim about
  // what the room MOSTLY is. Three mistyped tables out of forty-six do not make
  // "most of them are square" doubtful, and downgrading it anyway would make
  // `uncertain` mean nothing — the same failure as calling everything `strong`,
  // in the other direction. So a contradiction lowers a claim's confidence only
  // when it is large enough to change that claim.
  const MATERIAL_SHARE = 0.2;

  function buildContradictions(ctx) {
    const { candidates, zones, facts, furnitureGroups, similarityGroups,
            capacityAudit, physicalSeats, memoryConflicts } = ctx;
    const alive = candidates.filter(c => c.status !== "rejected");
    const tables = alive.filter(c => c.kind === "table");
    const out = [];
    const factIds = new Set(facts.map(f => f.id));
    const say = (id, kind, key, params, severity, sides, affects, targetIds) => {
      out.push({ id, kind, key, params, severity, policy: policyFor(id),
        sides, affects: affects.filter(a => factIds.has(a)), targetIds: targetIds || [] });
    };
    // One side of a disagreement: which stage said it, and what it said —
    // structured, never a pre-rendered sentence. The domain layer does not
    // decide what language an operator reads, and a `from` that is a literal
    // string would put English underneath a Turkish headline.
    const side = (from, claim, params, fromParams) => ({
      from: `contradiction.from.${from}`, fromParams: fromParams || null,
      claim: `contradiction.claim.${claim}`, params: params || {},
    });
    // Which claims a disagreement over `n` tables is big enough to move. A
    // count is disputed by any wrong object; a claim about the dominant type is
    // not, until enough of them are wrong to shift the majority.
    const tableClaims = n => tables.length && n / tables.length >= MATERIAL_SHARE
      ? ["tableCount", "tableTypeMix"] : ["tableCount"];

    // -- COUNT: seats the table pass could not place ---------------------------
    const standaloneChairs = alive.filter(c => c.kind === "venue" && c.type === "chair");
    const associated = tables.reduce((n, t) => n + (t.chairDetections || []).length, 0);
    const totalSeats = associated + standaloneChairs.length;
    const orphanShare = totalSeats ? standaloneChairs.length / totalSeats : 0;
    if (orphanShare > ORPHAN_SEAT_SHARE)
      say("contra:orphanSeats", "COUNT", "contradiction.orphanSeats",
        { orphans: standaloneChairs.length, total: totalSeats }, "medium",
        [side("chairDetection", "seatsExist", { n: totalSeats }),
         side("chairAssociation", "seatsPlaced", { n: associated })],
        ["seats", "tableCount"], standaloneChairs.map(c => c.id));

    // Tables with nobody at them AND seats with nowhere to sit, at the same
    // time, is not two facts. It is one association failure told twice.
    const unseated = tables.filter(t => !(t.chairDetections || []).length);
    if (unseated.length && standaloneChairs.length)
      say("contra:emptyTablesOrphanSeats", "COUNT", "contradiction.emptyTablesOrphanSeats",
        { tables: unseated.length, seats: standaloneChairs.length },
        // Two tables out of fifty is a couple of stragglers; a fifth of the
        // room is an association failure.
        unseated.length / Math.max(1, tables.length) >= MATERIAL_SHARE ? "high" : "medium",
        [side("tableDetection", "tablesNoSeat", { n: unseated.length }),
         side("chairDetection", "seatsNoTable", { n: standaloneChairs.length })],
        // Always disputes the count of tables nobody sits at, since that is
        // literally what it is about. Disputes the seat TOTAL only when enough
        // seats are unplaced to move it.
        orphanShare > ORPHAN_SEAT_SHARE ? ["unseated", "seats"] : ["unseated"],
        unseated.map(t => t.id));

    // -- TYPE: the learned encoder disagrees with the classifier ---------------
    //
    // The one genuinely independent opinion in the pipeline: it reasons about
    // appearance, every other stage reasons about geometry. Measured on the
    // degraded renderings, it flags invented tables and leaves the real ones
    // alone (benchmarks/embedding/SECOND-OPINION.md).
    const visualDisagree = tables.filter(t => t.visualEvidence && t.visualEvidence.agreement === "disagree");
    if (visualDisagree.length) {
      const tier = visualDisagree[0].visualEvidence.nearestTier;
      say("contra:visualClass", "TYPE", "contradiction.visualClass",
        { n: visualDisagree.length }, tier === "verified" ? "high" : "medium",
        [side("detectionAndShape", "theseAreTables", { n: visualDisagree.length }),
         side("visualSecondOpinion", "lookLikeOthers", {}, { tier: `contradiction.tier.${tier}` })],
        tableClaims(visualDisagree.length), visualDisagree.map(t => t.id));
    }

    // -- TYPE: a family member typed unlike its own family ---------------------
    const byId = new Map(alive.map(c => [c.id, c]));
    const outliers = [];
    for (const g of similarityGroups || []) {
      const members = (g.memberIds || []).map(id => byId.get(id)).filter(c => c && c.kind === "table");
      if (members.length < FAMILY_MIN_FOR_OUTLIER) continue;
      const types = members.reduce((m, c) => (m[c.type] = (m[c.type] || 0) + 1, m), {});
      const [modal] = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
      for (const c of members) if (c.type !== modal) outliers.push({ id: c.id, type: c.type, family: modal });
    }
    if (outliers.length)
      say("contra:familyOutlier", "TYPE", "contradiction.familyOutlier",
        { n: outliers.length }, "medium",
        [side("similarityClustering", "oneFamily"),
         side("shapeClassification", "typedDifferently")],
        tableClaims(outliers.length).filter(id => id === "tableTypeMix"), outliers.map(o => o.id));

    // -- RELATIONSHIP: one physical unit, more than one type -------------------
    const multiGroups = (furnitureGroups || []).filter(g => (g.memberIds || []).length > 1);
    const mixedGroups = multiGroups.filter(g => {
      const members = (g.memberIds || []).map(id => byId.get(id)).filter(Boolean);
      return new Set(members.map(c => c.type)).size > 1;
    });
    if (mixedGroups.length)
      say("contra:mixedGroupTypes", "RELATIONSHIP", "contradiction.mixedGroupTypes",
        { n: mixedGroups.length }, "medium",
        [side("geometricGrouping", "oneUnit"),
         side("shapeClassification", "differentKinds")],
        (mixedGroups.length / Math.max(1, multiGroups.length) >= MATERIAL_SHARE ? ["groups"] : [])
          .concat(tableClaims(mixedGroups.flatMap(g => g.memberIds || []).length)
            .filter(id => id === "tableTypeMix")),
        mixedGroups.flatMap(g => g.memberIds || []));

    // -- RELATIONSHIP: an object that contains its own seats -------------------
    //
    // The detection pass already declines to commit these (app-v8's seat
    // containment gate, measured at 129 invented tables held and zero real ones
    // across eleven renderings). This is the same finding stated to the
    // operator: the chair pass says "seat", the table pass says "table with a
    // seat inside it", and those cannot both describe one object.
    const seatsInside = tables.filter(t => t.lowEvidence && t.lowEvidence.reason === "seatsInsideBody");
    if (seatsInside.length)
      say("contra:seatsInsideBody", "RELATIONSHIP", "contradiction.seatsInsideBody",
        { n: seatsInside.length }, "high",
        [side("tableDetection", "proposedTable", { n: seatsInside.length }),
         side("chairAssociation", "seatsAround")],
        tableClaims(seatsInside.length), seatsInside.map(t => t.id));

    // -- NOT a contradiction: a seat two tables can both claim ----------------
    //
    // This was one, briefly, and the measurement said otherwise. Across nine
    // renderings it pointed at a real error 25% of the time — below the 28.8%
    // rate of pointing at random — and it added a fifth entry to the clean
    // original, tripping the gate that stops this engine crying wolf on a good
    // plan.
    //
    // The measurement only confirmed what the definition at the top of this
    // section already said. A contradiction is TWO STAGES THAT CANNOT BOTH BE
    // RIGHT. Two tables fitting a seat equally well is not a disagreement
    // between stages — every stage agrees, and what they agree on is that the
    // drawing is symmetric there. That is a property of the plan, not a
    // conflict in the reading of it.
    //
    // So the ambiguity is reported where it belongs and nowhere else: as the
    // `seatsAmbiguous` fact, and as a note on the card of the table it affects,
    // naming the competing table. Neither pretends something is wrong.

    // -- ZONE: a table standing on the stage -----------------------------------
    //
    // Deliberately object containment, not zone-box overlap. A zone's box is
    // the axis-aligned hull of a cluster, so on any real plan the dining hull
    // spans the room and touches the stage's hull — the first version of this
    // check fired on the clean original and flagged an entire correct dining
    // area. Overlapping hulls are not evidence of anything; a table whose
    // centre sits inside a detected stage is.
    const stageObjects = alive.filter(c => c.kind === "venue" && c.type === "stage");
    const onStage = tables.filter(t => stageObjects.some(s => GEOM.containsCentre(s, t)));
    if (onStage.length)
      say("contra:seatingInStage", "ZONE", "contradiction.seatingInStage",
        { n: onStage.length }, "high",
        [side("stageDetection", "stageNoSeating"),
         side("tableDetection", "tablesInside", { n: onStage.length })],
        ["zone:stage"].concat(tableClaims(onStage.length)), onStage.map(t => t.id));

    // -- ZONE: a table the zone pass never placed ------------------------------
    // Zones are built by clustering every surviving table, so a table in no
    // zone means the two stages are looking at different object sets.
    const zoned = new Set(zones.flatMap(z => z.memberIds || []));
    const unzoned = tables.filter(t => !zoned.has(t.id));
    if (unzoned.length)
      say("contra:unzonedTables", "ZONE", "contradiction.unzonedTables",
        { n: unzoned.length }, "medium",
        [side("tableDetection", "tablesOnPlan", { n: tables.length }),
         side("semanticZones", "belongNoArea", { n: unzoned.length })],
        tableClaims(unzoned.length), unzoned.map(t => t.id));

    // -- CAPACITY: the drawing's own number against the counted one ------------
    const capacity = facts.find(f => f.id === "capacity");
    if (capacity && capacity.key === "fact.capacityDiffers")
      say("contra:capacity", "CAPACITY", "contradiction.capacity",
        { stated: capacity.params.stated, counted: capacity.params.counted,
          difference: capacity.params.difference }, "high",
        [side("drawingOcr", "statedPeople", { n: capacity.params.stated }),
         side("countedSeats", "countedPeople", { n: capacity.params.counted })],
        ["capacity", "seats"], (capacityAudit && capacityAudit.likelyAreaIds) || []);

    // An agreement that rests on furniture whose capacity nobody has read is
    // not an agreement, it is a coincidence that has not been checked.
    const unverified = (capacityAudit && capacityAudit.unverified) || [];
    if (capacity && capacity.key === "fact.capacityAgrees" && unverified.length)
      say("contra:capacityUnverified", "CAPACITY", "contradiction.capacityUnverified",
        { n: unverified.length, counted: physicalSeats }, "medium",
        [side("capacityAudit", "totalsMatch"),
         side("seatingInventory", "unknownCapacity", { n: unverified.length })],
        ["capacity", "unverifiedSeating"], unverified.map(u => u.id));

    // -- MEMORY: the operator and the detector, on the same object -------------
    const overruled = (memoryConflicts || []).filter(c => c.kind === "overruled");
    if (overruled.length)
      say("contra:memoryOverruled", "MEMORY", "contradiction.memoryOverruled",
        { n: overruled.length }, "medium",
        [side("thisAnalysis", "proposedAgain"),
         side("yourCorrections", "alreadyChanged")],
        tableClaims(overruled.length), overruled.map(c => c.candidateId));
    const lost = (memoryConflicts || []).filter(c => c.kind === "lost");
    if (lost.length)
      say("contra:memoryLost", "MEMORY", "contradiction.memoryLost",
        { n: lost.length }, "high",
        [side("yourConfirmations", "objectsReal", { n: lost.length }),
         side("thisAnalysis", "notFoundNow")],
        ["tableCount", "seats"], []);
    // A decision the matcher could place on two objects about equally well.
    // Deliberately NOT applied to either — a human decision landing on the
    // wrong object corrupts a plan while looking like it worked — so this is
    // the only way the operator learns it happened.
    const ambiguousMemory = (memoryConflicts || []).filter(c => c.kind === "ambiguous");
    if (ambiguousMemory.length)
      say("contra:memoryAmbiguous", "MEMORY", "contradiction.memoryAmbiguous",
        { n: ambiguousMemory.length }, "medium",
        [side("yourCorrections", "appliedToOne", { n: ambiguousMemory.length }),
         side("thisAnalysis", "twoObjectsFit")],
        [], ambiguousMemory.map(c => c.candidateId).filter(Boolean));

    // -- SEMANTIC: facts that cannot all hold ---------------------------------
    const diningZones = zones.filter(z => ["dining", "bistro"].includes(z.type)).length;
    if (tables.length && !diningZones)
      say("contra:tablesNoDining", "SEMANTIC", "contradiction.tablesNoDining",
        { tables: tables.length }, "medium",
        [side("tableDetection", "tablesFound", { n: tables.length }),
         side("semanticZones", "noDiningArea")],
        // Disputes neither the count nor the type mix — it disputes what the
        // room IS, and the interpreter states no fact about that to lower. It
        // goes to the review queue on its own.
        [], []);

    // -- a claim resting entirely on disputed objects -------------------------
    //
    // "Also 2 rectangle" is a claim about two tables. If half of them are
    // objects another stage says are typed wrong, the sentence is not a finding
    // about the room so much as the dispute restated as fact. Measured: on the
    // real plan that claim IS the interpreter's one remaining wrong one
    // (benchmarks/interpreter/), and one of its two tables is exactly what the
    // grouping check points at.
    //
    // Half, rather than all, because these are minority claims resting on a
    // handful of objects — a bistro claim backed by five tables survives one
    // disputed member, a rectangle claim backed by two does not. The claim is
    // lowered in confidence, never removed: a minority type that turns out to
    // be real is exactly what an operator needs to see.
    const DISPUTED_SUPPORT_SHARE = 0.5;
    const disputed = new Set(out.flatMap(c => c.targetIds));
    for (const f of facts) {
      if (!f.id.startsWith("has:")) continue;
      const supporting = tables.filter(t => t.type === f.id.slice(4));
      if (!supporting.length) continue;
      const share = supporting.filter(t => disputed.has(t.id)).length / supporting.length;
      if (share < DISPUTED_SUPPORT_SHARE) continue;
      for (const c of out)
        if (supporting.some(t => c.targetIds.includes(t.id))) c.affects.push(f.id);
    }

    return out;
  }

  // A claim that another stage disagrees with is not as safe as one that stands
  // unopposed, and saying it in the same voice is the failure this whole engine
  // exists to prevent. One step down per DISTINCT disagreeing kind: two
  // instances of the same kind are one disagreement seen twice, and would
  // otherwise let a plan with many similar objects bury every claim it makes.
  const STRENGTH_ORDER = ["strong", "likely", "uncertain"];

  // WHICH CHECKS ARE ALLOWED TO LOWER A CLAIM'S CONFIDENCE.
  //
  // A mean precision of 0.49 across the engine hides the thing that matters:
  // some of these checks point at real errors nearly every time and one of them
  // barely beats guessing. Letting the weak one lower a claim that the strong
  // one would support is how an evidence system turns into noise with a
  // warning label.
  //
  // Measured per check against ground truth on nine renderings
  // (benchmarks/contradictions/, chance rate 0.288 on that set):
  //
  //   contra:seatsInsideBody           1.000  over  95 objects   downgrade
  //   contra:visualClass               0.587  over  46 objects   downgrade
  //   contra:mixedGroupTypes           0.571  over 240 objects   downgrade
  //   contra:emptyTablesOrphanSeats    0.356  over 104 objects   PRIORITISE ONLY
  //   contra:familyOutlier             1.000  over   2 objects   too few to trust
  //   contra:seatingInStage            1.000  over   1 object    too few to trust
  //   contra:orphanSeats                  —   never points at a table
  //
  // Two rules, both deliberate. A check must beat chance by half again before
  // it may lower a claim, AND it must have pointed at enough objects for that
  // to mean something. An UNMEASURED check defaults to prioritise, never to
  // downgrade: a check nobody has scored is not evidence that a claim is wrong.
  //
  // Every check still appears on screen and still raises review priority. This
  // governs one thing only: whether it is allowed to change how confidently the
  // product states something.
  //
  // Calibrated on ONE VENUE. That is a real limit on this table, not a footnote.
  const CONTRADICTION_POLICY = {
    "contra:seatsInsideBody": "downgrade",
    "contra:visualClass": "downgrade",
    "contra:mixedGroupTypes": "downgrade",
    "contra:emptyTablesOrphanSeats": "prioritise",
    "contra:orphanSeats": "prioritise",
    "contra:familyOutlier": "prioritise",
    "contra:seatingInStage": "prioritise",
  };
  const policyFor = id => CONTRADICTION_POLICY[id] || "prioritise";

  function applyContradictions(facts, contradictions) {
    const kindsByFact = new Map();
    for (const c of contradictions.filter(c => policyFor(c.id) === "downgrade"))
      for (const id of c.affects) {
        if (!kindsByFact.has(id)) kindsByFact.set(id, new Set());
        kindsByFact.get(id).add(c.kind);
      }
    for (const f of facts) {
      const kinds = kindsByFact.get(f.id);
      if (!kinds || !kinds.size) continue;
      const from = STRENGTH_ORDER.indexOf(f.strength);
      if (from < 0) continue;
      f.contradictedBy = contradictions.filter(c => c.affects.includes(f.id)).map(c => c.id);
      f.strengthBefore = f.strength;
      f.strength = STRENGTH_ORDER[Math.min(STRENGTH_ORDER.length - 1, from + kinds.size)];
    }
    return facts;
  }

  globalThis.MeritPlanContradictions = Object.freeze({ CONTRADICTION_KINDS, CONTRADICTION_POLICY, applyContradictions, buildContradictions });
})();
