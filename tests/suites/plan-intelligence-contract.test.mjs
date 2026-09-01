// What Plan Intelligence is allowed to say about a plan it has just analysed.
//
// This is not an accuracy test. Accuracy is measured object-by-object against
// annotated ground truth in benchmarks/run-benchmark.mjs, and pinning counts
// here would turn every honest detector improvement into a red build. What is
// asserted here is the contract the output must satisfy whatever the detector
// found: internal referential integrity, stated provenance, and the honesty
// rules.
//
// The honesty rules are load-bearing. Classical computer vision must never be
// labelled a trained model; every relationship must carry the evidence that
// produced it; and a capacity the drawing states must never appear when no OCR
// ran to read it — a fabricated "the plan says 124" is worse than an admitted
// unknown, because an operator would act on it.
//
// Slow (real detection on the real venue plan), so it is out of the default
// run and in --all.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = {
  name: "plan-intelligence-contract",
  tags: ["intelligence", "slow"],
  timeout: 300000,
  viewport: { width: 1800, height: 1000 },
};

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const planPath = path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png");
  checks.require(fs.existsSync(planPath), "the real venue plan is present", planPath);

  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Scene", hotel: "Merit", date: "2026-10-02" });

  const dataUrl = "data:image/png;base64," + fs.readFileSync(planPath).toString("base64");
  await page.evaluate(src => {
    state.events[0].background = { src, name: "merit-real-venue-plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, dataUrl);
  await page.waitForTimeout(500);

  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const a = state.events[0].analysis;
    const pi = a.planIntelligence;
    const alive = a.candidates.filter(c => c.status !== "rejected");
    // Chairs are not top-level candidates: each is an entry on the table it was
    // associated with, carrying its own id and coordinates.
    const chairs = alive.flatMap(c => (c.chairDetections || []).map(ch => ({
      id: ch.id, x: ch.x, y: ch.y, parent: c.id,
    })));
    return {
      engine: a.engine,
      trainedModel: a.trainedModel,
      notice: a.notice,
      total: a.candidates.length,
      alive: alive.length,
      kinds: [...new Set(alive.map(c => c.kind))],
      withRotation: alive.filter(c => typeof c.rotation === "number").length,
      chairs,
      candidateIds: alive.map(c => c.id),
      unreviewedLow: a.candidates.filter(c => c.status === "unreviewed" && c.confidence < 0.72).length,
      // Every free-standing chair, and how far it is from the nearest DETECTED
      // table's edge, in units of its own size. A seat touching a real table is
      // not a free-standing object.
      strandedChairs: (() => {
        const tables = alive.filter(c => c.kind === "table");
        const gap = (a, b) => {
          const dx = Math.max(Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) - (a.w + b.w) / 2, 0);
          const dy = Math.max(Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) - (a.h + b.h) / 2, 0);
          return Math.hypot(dx, dy);
        };
        return alive.filter(c => c.kind === "venue" && c.type === "chair").map(c => {
          let nearest = Infinity;
          for (const t of tables) nearest = Math.min(nearest, gap(c, t));
          return { nearestTableGap: nearest, ownSize: Math.sqrt(c.w * c.h) };
        });
      })(),
      chairsReseated: a.diagnostics.chairsReseated ?? null,
      zones: (pi?.zones || []).map(z => ({ type: z.type, confidence: z.confidence,
        evidence: z.evidence, members: z.memberIds.length, memberIds: z.memberIds, seats: z.seats })),
      physicalSeats: pi?.planSummary?.physicalSeats ?? null,
      ocrAvailable: !!pi?.providerMetadata?.ocrAvailable,
      tableIds: alive.filter(c => c.kind === "table").map(c => c.id),
      // Standalone chair candidates plus the seats nested on tables: a
      // contradiction may point at either, and both are objects that survived.
      chairIds: alive.filter(c => c.kind === "venue" && c.type === "chair").map(c => c.id)
        .concat(alive.flatMap(c => (c.chairDetections || []).map(ch => ch.id))),
      facts: (pi?.facts || []).map(f => ({ id: f.id, key: f.key, params: f.params,
        strength: f.strength, strengthBefore: f.strengthBefore || null,
        contradictedBy: f.contradictedBy || null, provenance: f.provenance, basis: f.basis })),
      contradictions: (pi?.contradictions || []).map(c => ({ id: c.id, kind: c.kind, key: c.key,
        params: c.params, severity: c.severity, sides: c.sides, affects: c.affects,
        targets: (c.targetIds || []).length, targetIds: c.targetIds || [] })),
      contradictionKinds: pi?.contradictionKinds || [],
      priorities: (pi?.reviewPriorities || []).map(p => ({ key: p.key, rank: p.rank, why: p.why,
        targets: (p.targetIds || []).length, impact: p.downstreamImpact, signature: p.signature,
        buildOrder: p.buildOrder })),
      prioritiesRendered: (() => {
        const was = ui.lang, out = { en: [], tr: [] };
        for (const lang of ["en", "tr"]) {
          ui.lang = lang;
          out[lang] = (pi?.reviewPriorities || []).map(p => t(p.key, p.params));
        }
        ui.lang = was;
        return out;
      })(),
      factsRendered: (() => {
        const was = ui.lang, out = { en: [], tr: [] };
        for (const lang of ["en", "tr"]) {
          ui.lang = lang;
          out[lang] = (pi?.facts || []).map(f => t(f.key, f.params));
        }
        ui.lang = was;
        return out;
      })(),
      // Everything an operator reads on the review panel, rendered in both
      // languages: the claim, the evidence under it, and both sides of every
      // disagreement. All three have shipped as English literals at some point.
      contradictionsRendered: (() => {
        const was = ui.lang, out = { en: [], tr: [] };
        for (const lang of ["en", "tr"]) {
          ui.lang = lang;
          out[lang] = (pi?.contradictions || []).flatMap(c => [t(c.key, c.params)]
            .concat(c.sides.flatMap(s => [t(s.from, s.fromParams), t(s.claim, s.params)])));
        }
        ui.lang = was;
        return out;
      })(),
      provenanceRendered: (() => {
        const was = ui.lang, out = { en: [], tr: [] };
        for (const lang of ["en", "tr"]) {
          ui.lang = lang;
          out[lang] = (pi?.facts || []).flatMap(f => (f.provenance || []).map(p => t(p.key, p.params)));
        }
        ui.lang = was;
        return out;
      })(),
      reviewGroups: (pi?.reviewGroups || []).map(g => ({
        kind: g.kind, type: g.titleParams?.type, need: g.memberIds.length,
        total: g.totalInFamily, clusters: (g.clusters || []).length,
        memberIds: g.memberIds,
      })),
      questions: (pi?.uncertainQuestions || []).map(q => ({
        type: q.questionType, memberCount: q.questionParams?.memberCount,
        arrangement: q.arrangement || null,
        groupIds: q.groupIds || [q.groupId], covers: q.coversGroups || 1,
      })),
      furnitureGroupIds: (pi?.furnitureGroups || []).map(g => g.id),
      pi: pi && {
        nodeCount: pi.sceneGraph.nodeCount,
        counts: pi.sceneGraph.counts,
        edges: pi.sceneGraph.edges,
        groups: pi.furnitureGroups.map(g => ({ id: g.id, members: g.memberIds, reason: g.reason })),
        audit: pi.capacityAudit,
        providerMetadata: pi.providerMetadata,
      },
    };
  });

  checks.require(result.pi, "the analysis produced a Plan Intelligence layer", { candidates: result.total });

  // --- honesty ---------------------------------------------------------------
  checks.ok(result.engine === "ASSISTED_DETECTION",
    'the engine identifies itself as Assisted Detection, never as "AI"', result.engine);
  checks.ok(result.trainedModel === false,
    "the analysis records that no trained model produced it", result.trainedModel);
  checks.ok(result.pi.providerMetadata && result.pi.providerMetadata.trainedModel === false,
    "the provider metadata agrees — one truth, not two", result.pi.providerMetadata);
  checks.ok(/no trained/i.test(result.notice || "") || !/\btrained\s+model\b/i.test(result.notice || ""),
    "the operator-facing notice does not claim a trained model", result.notice);

  const audit = result.pi.audit;
  checks.require(audit, "a capacity audit was produced", result.pi);
  checks.ok(typeof audit.ocrAvailable === "boolean",
    "the audit states plainly whether OCR was available", audit.ocrAvailable);
  checks.ok(audit.ocrAvailable || audit.drawingStated === null,
    "with no OCR the audit reports no stated capacity rather than inventing one",
    { ocrAvailable: audit.ocrAvailable, drawingStated: audit.drawingStated });
  checks.ok(audit.ocrAvailable || audit.difference === null,
    "and no difference against a number it never read", audit.difference);

  // Physical and logical capacity are different questions and must stay two
  // numbers, each saying where it came from.
  for (const [key, label] of [["physical", "physical"], ["logical", "logical"]]) {
    const value = audit[key];
    checks.ok(value && typeof value.seats === "number" && value.seats >= 0,
      `the audit reports a ${label} seat count it actually counted`, value);
    checks.ok(value && typeof value.source === "string" && value.source.length > 0,
      `the ${label} count says how it was arrived at`, value && value.source);
  }
  checks.ok(Array.isArray(audit.unverified),
    "seats the drawing does not support are listed as unverified rather than guessed", audit.unverified);

  // --- referential integrity -------------------------------------------------
  // Scene-graph nodes span three id spaces: candidates, the chairs hanging off
  // them, and the logical furniture groups.
  const known = new Set([
    ...result.candidateIds,
    ...result.chairs.map(c => c.id),
    ...result.pi.groups.map(g => g.id),
  ]);
  const dangling = result.pi.edges.filter(e => !known.has(e.from) || !known.has(e.to));
  checks.ok(dangling.length === 0,
    "every scene-graph edge connects two objects that actually exist",
    dangling.slice(0, 3).map(e => ({ from: e.from, to: e.to, type: e.type })));

  const danglingMembers = result.pi.groups.flatMap(g => g.members.filter(m => !known.has(m)));
  checks.ok(danglingMembers.length === 0,
    "every furniture-group member is a real detected object", danglingMembers.slice(0, 3));

  const selfEdges = result.pi.edges.filter(e => e.from === e.to);
  checks.ok(selfEdges.length === 0, "no object is related to itself", selfEdges.slice(0, 3));

  checks.ok(result.pi.nodeCount === result.alive,
    "the scene graph covers exactly the objects that survived review",
    { nodeCount: result.pi.nodeCount, alive: result.alive });
  checks.ok(result.pi.edges.length > 0,
    "the plan produced actual relationships, not just a bag of objects", result.pi.counts);

  // Every edge states the evidence that produced it. An unexplained
  // relationship is an assertion the pixels may not support.
  const unexplained = result.pi.edges.filter(e => typeof e.evidence !== "string" || !e.evidence.trim());
  checks.ok(unexplained.length === 0,
    "every relationship records the evidence that produced it",
    unexplained.slice(0, 3).map(e => ({ from: e.from, type: e.type })));

  const groupsWithoutReason = result.pi.groups.filter(g => !g.reason);
  checks.ok(groupsWithoutReason.length === 0,
    "every logical group explains why its tables were grouped", groupsWithoutReason.slice(0, 3));

  // --- suspect regions are ranked and explained ------------------------------
  const suspects = audit.suspectRegions || [];
  if (suspects.length > 1) {
    const scores = suspects.map(s => s.score);
    checks.ok(scores.every((s, i) => i === 0 || scores[i - 1] >= s),
      "suspect regions come back ranked worst-first", scores.slice(0, 6));
    checks.ok(suspects.every(s => Array.isArray(s.reasons) && s.reasons.length),
      "each suspect region says what is suspicious about it", suspects[0]);
    checks.ok(suspects.every(s => known.has(s.id)),
      "each suspect region points at a real object", suspects.slice(0, 2).map(s => s.id));
  }

  // --- rotation is preserved -------------------------------------------------
  checks.ok(result.withRotation === result.alive,
    "every detected object carries a rotation — nothing was forced axis-aligned",
    { withRotation: result.withRotation, alive: result.alive });

  // --- chairs stay individual objects ---------------------------------------
  checks.ok(result.chairs.length > 0,
    "chairs were detected on this plan at all", { chairs: result.chairs.length });
  checks.ok(result.chairs.every(c => c.id && Number.isFinite(c.x) && Number.isFinite(c.y)),
    "each chair is an object with its own id and coordinates, not a seat count on a table",
    result.chairs.slice(0, 2));
  checks.ok(new Set(result.chairs.map(c => c.id)).size === result.chairs.length,
    "no chair id is reused across tables");

  const belongsTo = result.pi.edges.filter(e => e.type === "belongsTo");
  const chairIds = new Set(result.chairs.map(c => c.id));
  checks.ok(belongsTo.every(e => chairIds.has(e.from)),
    "a belongsTo edge always starts at a real chair", belongsTo.slice(0, 2));
  const multiplyOwned = [...new Set(belongsTo.map(e => e.from))]
    .filter(id => belongsTo.filter(e => e.from === id).length > 1);
  checks.ok(multiplyOwned.length === 0,
    "no chair belongs to two tables at once", multiplyOwned.slice(0, 3));

  // --- one family, one decision ---------------------------------------------
  // Similarity clustering is the right unit for propagating a decision and the
  // wrong unit to put in front of a person. Before consolidation this plan
  // produced twelve review groups of which seven were singletons, with the same
  // kind-and-type appearing on three separate cards, plus thirteen questions of
  // which eight were literally the same question about eight identical
  // arrangements of three square tables.
  //
  // These are contracts, not counts: the numbers may move as detection
  // improves, but asking the same question twice must stay impossible.
  const groupKeys = result.reviewGroups.map(g => `${g.kind}:${g.type}`);
  checks.ok(new Set(groupKeys).size === groupKeys.length,
    "no two review groups ask about the same kind and type", groupKeys);
  checks.ok(result.reviewGroups.every(g => g.clusters >= 1),
    "each review group keeps the similarity clusters it was built from, so a decision can still propagate cluster by cluster",
    result.reviewGroups.map(g => ({ type: g.type, clusters: g.clusters })));

  // The arrangement is the table count AND the multiset of table types, so
  // four squares and rectangle-plus-three-squares stay two questions.
  const questionKeys = result.questions.map(q => `${q.type}:${q.arrangement}`);
  checks.ok(result.questions.every(q => q.arrangement),
    "each question records the arrangement that defines it", result.questions);
  checks.ok(new Set(questionKeys).size === questionKeys.length,
    "no two questions ask about the same arrangement", questionKeys);
  checks.ok(result.questions.every(q => q.covers === q.groupIds.length),
    "a question's stated reach matches the groups it actually carries",
    result.questions.map(q => ({ covers: q.covers, ids: q.groupIds.length })));
  const knownGroups = new Set(result.furnitureGroupIds);
  const strayGroupRefs = result.questions.flatMap(q => q.groupIds.filter(id => !knownGroups.has(id)));
  checks.ok(strayGroupRefs.length === 0,
    "every arrangement a question covers is a real furniture group", strayGroupRefs.slice(0, 3));

  // Consolidation must be presentational. Nothing may be dropped from review to
  // make the count look better — the sprint rule is explicit about that.
  // ---- a seat at a table is never reported as a free-standing object -------
  //
  // Association runs over every table PROPOSAL and the fragment filter then
  // deletes some of them. A chair assigned to a deleted proposal used to be
  // dropped from seating entirely and re-emitted as a free-standing object,
  // even with a real surviving table a few pixels away. Measured once
  // relationship ground truth was extended from 24 chairs to 83: chair->table
  // accuracy 0.711, zero WRONG tables, and 22 orphans — every failure was a
  // seat the detector found and seated nowhere, with its annotated table 2 to
  // 5 pixels away and detected. The losers' seats are now offered to the
  // survivors.
  //
  // Asserted as an invariant rather than a count: a free-standing chair may
  // exist (a plan really can draw a seat away from any table), but not one
  // that is touching a table the detector found.
  const touching = result.strandedChairs.filter(c => c.nearestTableGap <= c.ownSize * 0.25);
  checks.ok(touching.length === 0,
    "no chair is reported free-standing while touching a table the detector found",
    { touching: touching.length, sample: touching.slice(0, 4) });
  checks.ok(result.chairsReseated !== null,
    "the detector reports how many seats it moved onto surviving tables", result.chairsReseated);

  // ---- semantic zones say what they are, and why ---------------------------
  //
  // A zone is the product telling an operator what a part of the room is for,
  // which is exactly the kind of statement that must carry evidence or not be
  // made. `unknown` is a real answer here: a cluster of tables nobody sits at
  // is reported as an undetermined region rather than guessed into a dining
  // room, and dropping it silently would be the dishonest option.
  const ZONE_TYPES = new Set(["dining", "bistro", "lounge", "stage", "entrance", "unknown"]);
  checks.ok(result.zones.length > 0, "the plan is read as regions with a job, not just objects", result.zones.length);
  const strangeTypes = result.zones.filter(z => !ZONE_TYPES.has(z.type));
  checks.ok(strangeTypes.length === 0, "every zone uses the declared vocabulary", strangeTypes.slice(0, 3));
  const unevidenced = result.zones.filter(z => !Array.isArray(z.evidence) || !z.evidence.length);
  checks.ok(unevidenced.length === 0,
    "every zone states the facts that typed it", unevidenced.slice(0, 3));
  checks.ok(result.zones.every(z => ["strong", "likely", "uncertain"].includes(z.confidence)),
    "and how sure it is, in words rather than an invented number",
    result.zones.map(z => z.confidence));

  // Nothing is inferred from a name: an entrance zone requires either a
  // confirmed entrance object or wording OCR actually read.
  const entrances = result.zones.filter(z => z.type === "entrance");
  checks.ok(entrances.length === 0 || result.ocrAvailable || entrances.every(z => z.members > 0),
    "no entrance zone is invented on a build where OCR never ran",
    { entrances: entrances.length, ocrAvailable: result.ocrAvailable });

  // A zone may never claim seats the detector did not find.
  const zoneSeats = result.zones.reduce((n, z) => n + z.seats, 0);
  checks.ok(result.physicalSeats == null || zoneSeats <= result.physicalSeats,
    "zones never claim more seats than the detector found",
    { zoneSeats, physicalSeats: result.physicalSeats });

  // Every table is inside exactly one zone — a table in none would be a part of
  // the room the product silently declined to describe.
  const zoned = result.zones.flatMap(z => z.memberIds);
  const missingTables = result.tableIds.filter(id => !zoned.includes(id));
  checks.ok(missingTables.length === 0,
    "no detected table falls outside every zone", missingTables.slice(0, 4));
  checks.ok(new Set(zoned).size === zoned.length,
    "and no object is claimed by two zones at once",
    zoned.filter((id, i) => zoned.indexOf(id) !== i).slice(0, 3));

  // ---- the whole-plan interpreter states what it knows, and how surely ----
  //
  // These are the product's CLAIMS about a drawing, and a product that states
  // wrong things confidently is worse than one that says less. Accuracy is
  // measured against ground truth in benchmarks/interpreter/; what is pinned
  // here is that no claim can be made without an honest strength, provenance
  // and the numbers behind it — and that `strong` is not handed out to a claim
  // whose truth depends on the detector having found everything.
  checks.ok(result.facts.length > 0, "the plan is interpreted as readable claims", result.facts.length);
  const STRENGTHS = new Set(["strong", "likely", "uncertain"]);
  checks.ok(result.facts.every(f => STRENGTHS.has(f.strength)),
    "every fact carries a declared strength", result.facts.map(f => f.strength));
  const noProvenance = result.facts.filter(f => !Array.isArray(f.provenance) || !f.provenance.length);
  checks.ok(noProvenance.length === 0,
    "every fact names the evidence it rests on", noProvenance.slice(0, 3));
  // Structured, not a pre-rendered sentence. This shipped as English literals
  // once and put "Based on: table type classification" under a Turkish claim.
  const literalProvenance = result.facts.filter(f =>
    f.provenance.some(p => typeof p !== "object" || !p.key));
  checks.ok(literalProvenance.length === 0,
    "provenance is a key and params, never a pre-rendered English sentence",
    literalProvenance.map(f => f.id));
  checks.ok(result.facts.every(f => f.basis && typeof f.basis === "object"),
    "and carries the numbers, so nothing has to be taken on trust",
    result.facts.filter(f => !f.basis).slice(0, 3));

  // A count is bounded by detection recall and can never be certain. This is
  // the exact defect the fact benchmark caught: "18 tables, most of them
  // square" was asserted as certain on a plan with 23, because a robust claim
  // and a recall-bound one were bundled under one strength.
  const countFacts = result.facts.filter(f => f.key === "fact.tableCount" || f.key === "fact.seats");
  checks.ok(countFacts.length > 0, "the interpreter states counts at all", countFacts.map(f => f.key));
  checks.ok(countFacts.every(f => f.strength !== "strong"),
    "no count is ever stated as certain — a count cannot beat detection recall",
    countFacts.map(f => ({ key: f.key, strength: f.strength })));

  // Both languages, every fact, with no raw key and no unfilled placeholder.
  for (const lang of ["en", "tr"]) {
    const bad = result.factsRendered[lang]
      .map((s, i) => ({ s, key: result.facts[i].key }))
      .filter(x => !x.s || /^fact\./.test(x.s) || /\{[a-zA-Z]+\}/.test(x.s));
    checks.ok(bad.length === 0, `every fact renders in ${lang} with no raw key or placeholder`, bad.slice(0, 3));
  }

  // Priorities point at real objects and say why, so the UI can take a person
  // there instead of describing a problem at them.
  checks.ok(result.priorities.every(p => typeof p.why === "string" && p.why.length),
    "every review priority says why it matters", result.priorities.slice(0, 3));
  checks.ok(result.priorities.every((p, i, a) => i === 0 || a[i - 1].rank <= p.rank),
    "priorities are ordered by what an unresolved item costs",
    result.priorities.map(p => p.rank));

  const reviewedMembers = new Set(result.reviewGroups.flatMap(g => g.memberIds));
  checks.ok(reviewedMembers.size === result.unreviewedLow,
    "every unreviewed low-confidence candidate is still in exactly one review group — consolidation hides nothing",
    { inGroups: reviewedMembers.size, unreviewedLow: result.unreviewedLow });

  // ---- contradictions: two stages that cannot both be right ---------------
  //
  // The engine's job is to say when the analysis disagrees with itself. The
  // ways that can go wrong are not subtle, and each one is pinned here:
  // inventing a disagreement with only one side to it, pointing at nothing an
  // operator can open, deleting the objects it doubts, or leaving a claim
  // stated as certain while something disputes it.
  const KINDS = new Set(result.contradictionKinds);
  checks.ok(KINDS.size >= 7, "the declared contradiction vocabulary is the documented one",
    result.contradictionKinds);
  const strangeKind = result.contradictions.filter(c => !KINDS.has(c.kind));
  checks.ok(strangeKind.length === 0, "every contradiction uses that vocabulary",
    strangeKind.map(c => c.kind));

  const oneSided = result.contradictions.filter(c =>
    !Array.isArray(c.sides) || c.sides.length !== 2 || c.sides[0].from === c.sides[1].from);
  checks.ok(oneSided.length === 0,
    "every contradiction names two DIFFERENT stages — a single stage being unsure is what `strength` is for, not a disagreement",
    oneSided.map(c => c.id));
  checks.ok(result.contradictions.every(c => c.sides.every(s => s.claim && s.from)),
    "each side says what it claims and where it came from",
    result.contradictions.map(c => c.sides));
  checks.ok(result.contradictions.every(c => ["high", "medium"].includes(c.severity)),
    "every contradiction carries a severity from the declared set",
    result.contradictions.map(c => c.severity));

  // Pointing at real objects is what separates this from a warning banner.
  const aliveIds = new Set(result.tableIds);
  checks.ok(result.contradictions.every(c => c.targets > 0 || c.id === "contra:tablesNoDining" || c.id === "contra:memoryLost"),
    "a contradiction points at objects an operator can open, or is one of the two that are about the plan as a whole",
    result.contradictions.filter(c => !c.targets).map(c => c.id));

  // The affects/strength relationship, in both directions.
  const factById = new Map(result.facts.map(f => [f.id, f]));
  const disputedButCertain = result.facts.filter(f => f.strength === "strong" && (f.contradictedBy || []).length);
  checks.ok(disputedButCertain.length === 0,
    "no claim is stated as certain while another stage disputes it",
    disputedButCertain.map(f => f.id));
  const downgradedWithoutCause = result.facts.filter(f => f.strengthBefore && !(f.contradictedBy || []).length);
  checks.ok(downgradedWithoutCause.length === 0,
    "a claim is only stated less confidently when something actually disputes it",
    downgradedWithoutCause.map(f => f.id));
  const affectsUnknownFact = result.contradictions.flatMap(c => c.affects.filter(id => !factById.has(id)));
  checks.ok(affectsUnknownFact.length === 0,
    "a contradiction never claims to affect a fact the interpreter did not state", affectsUnknownFact);

  // A contradiction is evidence, not a filter. Every table id it points at has
  // to still BE in the surviving candidate list: if doubting an object could
  // remove it, the ids here would outrun the objects there.
  const pointedTables = result.contradictions.flatMap(c => c.targetIds).filter(id => /^candidate_/.test(id));
  const vanished = pointedTables.filter(id => !aliveIds.has(id) && !result.chairIds.includes(id));
  checks.ok(vanished.length === 0,
    "every object a contradiction disputes is still in the candidate list — doubting one never removes it",
    vanished.slice(0, 3));

  for (const lang of ["en", "tr"]) {
    const bad = result.contradictionsRendered[lang]
      .filter(s => !s || /^contradiction\./.test(s) || /\{[a-zA-Z]+\}/.test(s));
    checks.ok(bad.length === 0,
      `every contradiction and both of its sides render in ${lang} with no raw key or placeholder`, bad.slice(0, 3));
    const badProv = result.provenanceRendered[lang]
      .filter(s => !s || /^provenance\./.test(s) || /\{[a-zA-Z]+\}/.test(s));
    checks.ok(badProv.length === 0,
      `every fact's evidence line renders in ${lang} with no raw key or placeholder`, badProv.slice(0, 3));
  }

  // ---- what one answer settles, and why the order is what it is -----------
  //
  // The queue claims an operator's time. Measured in benchmarks/review-order/:
  // following it reaches three times as many real errors per action as working
  // at random. These pin the structure that number depends on.
  const noImpact = result.priorities.filter(p => !p.impact || typeof p.impact.objects !== "number");
  checks.ok(noImpact.length === 0,
    "every queue item says how much of the plan one answer settles", noImpact.slice(0, 3).map(p => p.key));
  const underReach = result.priorities.filter(p => p.impact.objects < p.targets);
  checks.ok(underReach.length === 0,
    "an item's reach is never smaller than the objects it points at",
    underReach.slice(0, 3).map(p => ({ key: p.key, objects: p.impact.objects, targets: p.targets })));
  const groupPriority = result.priorities.find(p => p.key === "priority.reviewGroup");
  const biggestGroup = result.reviewGroups.reduce((a, g) => Math.max(a, g.total || 0), 0);
  checks.ok(!groupPriority || groupPriority.impact.objects > 1 || biggestGroup <= 1,
    "confirming a family counts as reaching the whole family, not just the flagged members",
    { impact: groupPriority && groupPriority.impact, biggestFamily: biggestGroup });

  // Candidate ids are regenerated on every analysis, so an order that depends
  // on them reshuffles the queue when an operator re-analyses the same plan.
  const idInSignature = result.priorities.filter(p => /candidate_/.test(p.signature || ""));
  checks.ok(idInSignature.length === 0,
    "the tiebreak is a geometry signature, never a candidate id", idInSignature.slice(0, 2));
  const sorted = result.priorities.every((p, i, a) => {
    if (i === 0) return true;
    const q = a[i - 1];
    if (q.rank !== p.rank) return q.rank < p.rank;
    if (q.impact.facts !== p.impact.facts) return q.impact.facts > p.impact.facts;
    if (q.impact.objects !== p.impact.objects) return q.impact.objects > p.impact.objects;
    return true;
  });
  checks.ok(sorted,
    "within a rank, the item that settles more comes first",
    result.priorities.slice(0, 5).map(p => `${p.rank}:${p.impact.facts}/${p.impact.objects}`));

  for (const lang of ["en", "tr"]) {
    const bad = result.prioritiesRendered[lang]
      .filter(s => !s || /^priority\./.test(s) || /\{[a-zA-Z]+\}/.test(s));
    checks.ok(bad.length === 0,
      `every queue item renders in ${lang} with no raw key or placeholder`, bad.slice(0, 3));
  }

  // A serious disagreement outranks an ordinary batch of confirmations.
  const firstContra = result.priorities.find(p => p.key === "priority.contradiction");
  const firstGroup = result.priorities.find(p => p.key === "priority.reviewGroup");
  checks.ok(!firstContra || !firstGroup || result.priorities.indexOf(firstContra) < result.priorities.indexOf(firstGroup),
    "a disagreement is queued above an ordinary review group",
    result.priorities.slice(0, 4).map(p => `${p.key}#${p.rank}`));
}
