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

  const reviewedMembers = new Set(result.reviewGroups.flatMap(g => g.memberIds));
  checks.ok(reviewedMembers.size === result.unreviewedLow,
    "every unreviewed low-confidence candidate is still in exactly one review group — consolidation hides nothing",
    { inGroups: reviewedMembers.size, unreviewedLow: result.unreviewedLow });
}
