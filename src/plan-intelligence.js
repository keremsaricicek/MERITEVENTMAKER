(() => {
  "use strict";
  // The parts below are its own files now (src/plan-intel-*.js); this file
  // orchestrates them and reaches each through its one published object.
  const GROUPS = globalThis.MeritPlanIntelGroups;
  const CAPACITY = globalThis.MeritPlanIntelCapacity;
  const SCENE = globalThis.MeritPlanSceneGraph;
  const ZONES = globalThis.MeritPlanZones;
  const FACTS = globalThis.MeritPlanFacts;
  const CONTRA = globalThis.MeritPlanContradictions;
  // ============================================================
  // PlanIntelligenceResult — vendor-neutral contract
  // ============================================================
  // This module turns the raw classical-CV candidate list already produced
  // by runAssistedDetection() (app-v8.js) into a higher-level, still-honest
  // interpretation: which physical objects likely form one logical dining
  // group, which detections are visually similar enough to resolve together,
  // and whether the plan's own printed pax notes agree with what was
  // detected. Every number here is computed from real geometry/OCR — nothing
  // is a trained-model confidence score, and nothing is fabricated.
  //
  // Shape (kept intentionally close to a real production contract so a
  // future stronger provider — server-side detector, hosted vision model —
  // can populate the same fields without the UI layer changing):
  //
  // PlanIntelligenceResult = {
  //   version: 1,
  //   providerMetadata: { engine, trainedModel:false, ocrEngine, ocrAvailable },
  //   planSummary: { diningGroups, physicalSeats, stage, bar, entrances, lounge, reviewGroups },
  //   physicalObjects: [ candidateId... ]              // pass-through references
  //   furnitureGroups: [ { id, memberIds:[], reason, bbox } ]      // combined-table reasoning
  //   similarityGroups: [ { id, kind, type, memberIds:[], representativeId, outlierIds:[] } ]
  //   capacityEstimate: { physical, byGroup:[{groupId, seats, evidence}] }
  //   capacityAudit: { drawingStated:number|null, systemCounted, difference, sourceText, likelyAreaIds:[] } | null
  //   reviewGroups: [ { id, title, memberIds:[], question, kind } ]   // Concept 2 bulk review
  //   uncertainQuestions: [ { id, candidateId, question, kind } ]     // Concept 1 difficult-item queue
  // }

  // What a person should look at first, and why.
  //
  // Ordered by what an unresolved item COSTS, not by how many there are: a
  // capacity disagreement can invalidate a whole plan, an undetermined area is
  // a part of the room nobody has named, and a review group is a batch of
  // ordinary confirmations. Each priority points at real ids so the UI can
  // take a person straight there rather than describing the problem at them.
  // Two stages that cannot both be right outrank everything else on this list.
  // An ordinary review group is a batch of confirmations a person could work
  // through in any order; a contradiction is the product telling them it does
  // not know something it appears to know, and it stays wrong until someone
  // looks.
  //
  // Within a rank, order by WHAT ONE ANSWER SETTLES. Every item here costs the
  // operator roughly the same — read it, look at the objects, decide — so the
  // only thing that separates them is how much of the plan stops being unknown
  // afterwards. That is deliberately measured as three plain quantities and
  // compared lexicographically rather than folded into a weighted score:
  // "objects × 1 + seats × 0.5 + facts × 3" would be three invented constants
  // presented as a ranking.
  //
  //   facts   — claims on screen that this answer could settle. A wrong
  //             sentence an operator has already read is the most expensive
  //             thing on the list.
  //   objects — how many candidates the answer reaches, including propagation:
  //             confirming a family of twelve is one decision, not twelve.
  //   seats   — how many people hang on those objects, since a ten-top and a
  //             two-top are not the same mistake.
  //
  // The tiebreak is a rounded geometry signature, never an id: candidate ids
  // are regenerated on every analysis, so ordering on them would reshuffle the
  // queue on a re-run of the identical plan.
  function buildReviewPriorities(facts, zones, reviewGroups, uncertainQuestions, capacityAudit, contradictions, candidates) {
    const out = [];
    const byId = new Map((candidates || []).filter(c => c.status !== "rejected").map(c => [c.id, c]));
    // A question the operator has already answered.
    //
    // A contradiction is a statement about the plan and stays true until the
    // plan changes — `seatsInsideBody` still holds after someone confirms the
    // object, because the topology has not moved. But the QUEUE is not a list
    // of true statements, it is a list of things still needing a decision, and
    // an item that keeps returning to the top after being acted on teaches an
    // operator that the list is broken.
    //
    // Measured: without this, confirming the top item three times in a row left
    // the same item at the top all three times and the unreviewed count moved
    // once. So a contradiction whose every target has been ruled on — confirmed
    // or rejected — leaves the queue. It stays on screen as a stated
    // disagreement, and it still lowers the confidence of what it disputes; it
    // simply stops being asked again.
    const statusOf = new Map((candidates || []).map(c => [c.id, c.status]));
    const settled = c => {
      const targets = (c.targetIds || []).filter(id => statusOf.has(id));
      return targets.length > 0 && targets.every(id => statusOf.get(id) !== "unreviewed");
    };
    const seatsOf = ids => ids.reduce((n, id) => {
      const c = byId.get(id);
      if (!c) return n;
      const seats = (c.chairDetections || []).length;
      return n + (seats || (c.kind === "venue" && c.type === "chair" ? 1 : 0));
    }, 0);
    const signature = ids => ids.map(id => byId.get(id)).filter(Boolean)
      .map(c => `${Math.round(c.x)},${Math.round(c.y)}`).sort().join(";");
    const impact = (targetIds, factCount, reach) => ({
      objects: Math.max(reach || 0, new Set(targetIds).size),
      seats: seatsOf(targetIds),
      facts: factCount || 0,
    });
    const push = (item, targetIds, factCount, reach) => {
      item.targetIds = targetIds;
      item.downstreamImpact = impact(targetIds, factCount, reach);
      item.signature = signature(targetIds);
      // The position this item was built in, before any sorting. Kept so the
      // ordering can be compared against the one it replaced without a
      // benchmark having to guess how the list used to be assembled — the
      // first attempt at that reconstructed the order from the already-sorted
      // list, which made the two orderings identical by construction and the
      // comparison meaningless.
      item.buildOrder = out.length;
      out.push(item);
    };
    for (const c of (contradictions || []).filter(c => !settled(c)))
      push({ id: `priority:${c.id}`, key: "priority.contradiction",
        rank: c.severity === "high" ? 0 : 2,
        params: { kind: `contradiction.kind.${c.kind}` }, contradictionId: c.id,
        // Developer-facing, and English on purpose: `why` explains the ordering
        // in diagnostics and benchmark output. What an operator reads is `key`.
        why: `${c.sides[0].from} and ${c.sides[1].from} cannot both be right` },
        c.targetIds || [], c.affects.length);
    const capacity = facts.find(f => f.id === "capacity");
    // Skipped when the contradiction engine already raised the same
    // disagreement, so the operator is not shown one problem as two.
    const capacityRaised = (contradictions || []).some(c => c.id === "contra:capacity");
    if (capacity && capacity.key === "fact.capacityDiffers" && !capacityRaised)
      push({ id: "priority:capacity", key: "priority.capacity", rank: 1,
        params: { difference: capacity.params.difference },
        why: "the drawing states a different number of people from the one counted" },
        (capacityAudit && capacityAudit.likelyAreaIds) || [], 2);
    const unknownZones = zones.filter(z => z.type === "unknown");
    if (unknownZones.length)
      push({ id: "priority:unknownZones", key: "priority.undeterminedAreas", rank: 3,
        params: { n: unknownZones.length },
        why: "part of the room has no determined purpose" },
        unknownZones.flatMap(z => z.memberIds), 1);
    const unverified = facts.find(f => f.id === "unverifiedSeating");
    if (unverified)
      push({ id: "priority:unverifiedSeating", key: "priority.unverifiedSeating", rank: 4,
        params: { n: unverified.params.n },
        why: "seating whose capacity only a person can supply" },
        unverified.basis.ids || [], 1);
    for (const q of uncertainQuestions || [])
      // A grouping answer reaches every arrangement it repeats across, not only
      // the one the question shows.
      push({ id: `priority:${q.id}`, key: "priority.question", rank: 5,
        params: { n: 1 }, why: "a grouping the detector could not resolve" },
        q.memberIds || [], 0, (q.memberIds || []).length * (q.coversGroups || 1));
    for (const g of reviewGroups || [])
      // Confirming a family is one decision that lands on every member of it,
      // not only the ones flagged for review — that is what makes it a batch.
      push({ id: `priority:${g.id}`, key: "priority.reviewGroup", rank: 6,
        params: { n: g.memberIds.length, type: g.titleParams && g.titleParams.type },
        why: "a batch of similar objects to confirm together" },
        g.memberIds, 0, g.totalInFamily);
    return out.sort((a, b) =>
      a.rank - b.rank
      || b.downstreamImpact.facts - a.downstreamImpact.facts
      || b.downstreamImpact.objects - a.downstreamImpact.objects
      || b.downstreamImpact.seats - a.downstreamImpact.seats
      || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0)
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  function buildPlanIntelligence(event, ocrText) {
    const analysis = event.analysis; if (!analysis) return null;
    // Dining groups are made of the tables the analysis OFFERS. A reading a
    // person rejected, or one held back (it covers another table, it fell
    // below the review threshold), is not furniture on this plan yet, and
    // joining it to a real table made a "group" out of a table and its own
    // split-off fragment. The same rule the room's seat count follows.
    const tableCandidates = analysis.candidates.filter(c => c.kind === "table" && CAPACITY.isOffered(c));
    const furnitureGroups = GROUPS.buildFurnitureGroups(tableCandidates, analysis.groupingDecisions || []);
    const similarityGroups = GROUPS.buildSimilarityGroups(analysis.candidates);
    const reviewGroups = GROUPS.buildReviewGroups(analysis.candidates, similarityGroups);
    const uncertainQuestions = GROUPS.buildDifficultQuestions(analysis.candidates, furnitureGroups);
    const physicalSeats = CAPACITY.computePhysicalCapacity(analysis.candidates);
    const capacityAudit = CAPACITY.buildCapacityAudit(ocrText, physicalSeats, analysis.candidates, furnitureGroups);
    // Zones before the graph, because the graph now attaches structural and
    // semantic anchors to the region they stand in — a column belongs to a part
    // of the room, and the graph cannot say so before the regions exist.
    const zones = ZONES.buildZones(analysis.candidates, furnitureGroups, ocrText);
    const sceneGraph = SCENE.buildSceneGraph(analysis.candidates, furnitureGroups, zones, similarityGroups);
    const conflictsIn = analysis.memoryConflicts || [];
    const facts = FACTS.buildPlanFacts(analysis.candidates, zones, furnitureGroups, capacityAudit, physicalSeats, ocrText, {
      representation: (analysis.diagnostics || {}).representation || null,
      memory: {
        reapplied: analysis.memoryReapplied || 0,
        lost: conflictsIn.filter(c => c.kind === "lost").length,
        ambiguous: conflictsIn.filter(c => c.kind === "ambiguous").length,
      },
    });
    // Built from the facts, then applied back to them: a claim another stage
    // disagrees with stops being stated in the same voice as one nothing
    // disputes. Nothing is deleted or reclassified on this evidence.
    const contradictions = CONTRA.buildContradictions({
      candidates: analysis.candidates, zones, facts, furnitureGroups, similarityGroups,
      capacityAudit, physicalSeats, memoryConflicts: analysis.memoryConflicts || [],
    });
    CONTRA.applyContradictions(facts, contradictions);
    const reviewPriorities = buildReviewPriorities(facts, zones, reviewGroups, uncertainQuestions, capacityAudit, contradictions, analysis.candidates);
    const venueCandidates = analysis.candidates.filter(c => c.kind === "venue");
    // Which detection path actually ran is reported, not hidden: a chair-first
    // pass (chairs detected from their own colour/size model, then tables
    // inferred among them) and the table-first fallback have very different
    // reliability, and the operator is entitled to know which one produced the
    // number on screen. Passed straight through from the provider's real
    // diagnostics — never asserted when the provider did not report it.
    const diag = analysis.diagnostics || {};
    return {
      version: 1,
      providerMetadata: {
        engine: "ASSISTED_DETECTION_GEOMETRIC_HEURISTICS",
        trainedModel: false,
        detectionProvider: diag.provider || null,
        detectionPath: diag.detectionPath || null,
        chairSource: diag.chairSource || null,
        ocrEngine: ocrText != null ? "tesseract.js" : null,
        ocrAvailable: ocrText != null,
        // The OCR model (PP-OCRv4) that read text beside Tesseract, when it
        // ran. A model of TEXT: it says nothing about tables or rooms, and the
        // detector above is still not a trained model.
        ocrModel: analysis.ocrModel && analysis.ocrModel.available ? analysis.ocrModel.provider.label : null,
        ocrModelReason: analysis.ocrModel && !analysis.ocrModel.available ? analysis.ocrModel.reasonCode || null : null,
      },
      planSummary: {
        diningGroups: furnitureGroups.length,
        // On a drawing whose tables are symbols there are no seats to count,
        // and a prominent "0 seats" reads as "this room seats nobody" rather
        // than "this drawing does not show seats". The status pill asks for
        // this and must not be handed a zero it will present as a measurement.
        physicalSeats: (diag.representation && diag.representation.kind === "SYMBOLIC") ? null : physicalSeats,
        representation: diag.representation ? diag.representation.kind : null,
        tables: analysis.candidates.filter(c => c.kind === "table" && c.status !== "rejected").length,
        associatedSeats: CAPACITY.countAssociatedSeats(analysis.candidates),
        unassociatedChairs: CAPACITY.countStandaloneChairs(analysis.candidates),
        detectionPath: diag.detectionPath || null,
        stage: venueCandidates.filter(c => c.type === "stage").length,
        bar: venueCandidates.filter(c => c.type === "bar").length,
        entrances: venueCandidates.filter(c => c.type === "entrance").length,
        reviewGroups: reviewGroups.length,
        zones: zones.length,
        zoneTypes: zones.reduce((m, z) => (m[z.type] = (m[z.type] || 0) + 1, m), {}),
      },
      furnitureGroups,
      // Regions of the room with a job, each carrying the evidence that typed
      // it. A region that satisfies no rule is reported as `unknown` rather
      // than dropped — see buildZones.
      zones,
      // What the whole drawing says, as claims a person can read and check.
      // Every fact carries its strength, its provenance and the numbers it
      // rests on; `strong` has to be earned. See buildPlanFacts.
      facts,
      // Where two stages of the pipeline cannot both be right. Each entry names
      // both sides and where each came from; none of them deletes or
      // reclassifies anything. See buildContradictions.
      contradictions,
      contradictionKinds: CONTRA.CONTRADICTION_KINDS,
      // Which checks are allowed to lower a claim's confidence, and which only
      // raise review priority. Measured, not assumed — see CONTRADICTION_POLICY.
      contradictionPolicy: CONTRA.CONTRADICTION_POLICY,
      // What to look at first, and why, pointing at real ids.
      reviewPriorities,
      capacityEstimate: { physical: physicalSeats },
      capacityAudit,
      // Physical objects and logical seating groups are deliberately separate
      // structures: three tables pushed together stay three physical table
      // candidates that also appear as one logical group, and are never
      // replaced by a single invented rectangle.
      sceneGraph,
      reviewGroups,
      // The full similarity families, not just the ones that still need
      // review. Documented in the contract at the top of this file but never
      // actually returned, so a correction could only ever be spread across a
      // family that happened to be flagged. A family the detector already
      // considers consistent is exactly the one where a single correction
      // should repair every member.
      similarityGroups,
      uncertainQuestions,
    };
  }

  globalThis.buildPlanIntelligence = buildPlanIntelligence;
  // What this build actually is, derived at read time from the modules that are
  // loaded rather than from a hand-maintained list.
  //
  // The list it replaces had gone stale in the way hand-maintained status
  // always does: it still described a real trained visual encoder as
  // "evaluated ... but not integrated this pass" long after the encoder was
  // trained, shipped and measured, and it described the relationship engine as
  // an association step. A status block that has to be remembered is a status
  // block that will be wrong, and being wrong ABOUT HOW MUCH OF THIS IS
  // LEARNED is the one kind of wrong this product cannot afford.
  //
  // So it is a getter over the real runtime. Anything it cannot read, it says
  // it cannot read.
  Object.defineProperty(globalThis, "MERIT_PLAN_INTELLIGENCE_STATUS", {
    configurable: true,
    get() {
      const encoder = globalThis.MERIT_PLAN_ENCODER_WEIGHTS || null;
      const provider = globalThis.MeritVisualEmbedding && globalThis.MeritVisualEmbedding.resolve
        ? globalThis.MeritVisualEmbedding.resolve() : null;
      return {
        // The detector is classical computer vision. It has never been a
        // trained model and this line must never say otherwise.
        detector: { engine: "Assisted Detection (classical computer vision)", trainedModel: false,
          note: "DOMAIN MODEL NOT INSTALLED — no trained object detector is running." },
        visualRepresentation: {
          provider: provider ? provider.id : "none",
          // TRUE, and it means exactly one thing: real weights fitted by
          // gradient descent multiply real pixels. It does NOT mean a trained
          // DOMAIN model is detecting objects. Both stay true at once.
          trainedModel: !!(encoder && provider && provider.id === "learned"),
          parameters: encoder ? encoder.parameters : null,
          modelId: encoder ? encoder.id : null,
          trainedOn: encoder ? encoder.trainedOn : null,
          usedFor: ["class second opinion (measured, promoted)",
            "object identity in Plan Memory (measured, no contribution on the one real plan)"],
        },
        relationships: {
          engine: globalThis.MeritRelationships ? `relationship engine v${globalThis.MeritRelationships.version}` : "none",
          trainedModel: false,
          evidence: ["perimeter position", "proximity", "facing where derivable",
            "arrangement", "family", "competing tables with a margin"],
        },
        memory: {
          engine: globalThis.MeritPlanMemory ? `plan memory v${globalThis.MeritPlanMemory.version}` : "none",
          trainedModel: false,
          grades: globalThis.MeritPlanMemory ? globalThis.MeritPlanMemory.grades : null,
        },
        sceneGraph: { version: SCENE.GRAPH_VERSION, nodeTypes: SCENE.NODE_TYPES },
        zones: { types: ["dining", "bistro", "lounge", "stage", "bar", "entrance", "unknown"],
          evidenceOnly: true },
        interpreter: { engine: "Whole Plan Interpreter", trainedModel: false,
          note: "restates evidence earlier stages produced; it never discovers an object" },
        ocr: { available: typeof globalThis.runPlanOCR === "function",
          engine: globalThis.MERIT_OCR_STATUS ? "Tesseract, local when the offline assets are present" : "not loaded" },
        // The limit that outranks every capability above it.
        corpus: { realDistinctVenuePlans: 1, crossVenueGeneralization: "NOT VERIFIED" },
      };
    },
  });
})();
