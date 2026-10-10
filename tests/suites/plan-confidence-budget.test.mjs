// The confidence budget — is the operator's attention spent, or just consumed?
//
// An operator has a finite number of decisions in them before a plan stops
// getting checked and starts getting clicked through. Counted one line per
// uncertain fact, the two real plans produce 119 and 278 items. This layer
// decides which handful of those is worth saying first.
//
// The rules it must never break:
//
//   REPEATED UNCERTAINTY IS ONE CLAIM, NOT N. Forty-five tables whose number
//   the drawing never printed legibly is one thing to decide about, carrying
//   the number 45 — not forty-five warnings.
//
//   NOTHING IS HIDDEN, ONLY RANKED. Everything below the line is counted and
//   what it would settle is stated. A budget that quietly drops its tail is a
//   filter that lies about its own coverage.
//
//   AN ITEM THAT SETTLES NOTHING IS NOT WORK. On the real plans, 5 of 13 and
//   2 of 6 existing priorities settle zero objects, zero seats and zero facts.
//   Ranking those as things to do is exactly the failure this exists to stop.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "plan-confidence-budget",
  tags: ["intelligence"],
  timeout: 60000,
  viewport: { width: 1200, height: 800 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const present = await page.evaluate(() => typeof globalThis.MeritConfidenceBudget === "object");
  checks.require(present, "the confidence budget is reachable from the suite");

  const run1 = (input, opts) => page.evaluate(([i, o]) => globalThis.MeritConfidenceBudget.run(i, o), [input, opts || null]);
  const find = (r, id) => r.all.find((c) => c.id === id);

  const priority = (id, key, impact, params) => ({ id, key, params: params || {},
    downstreamImpact: impact, targetIds: [], why: "x" });

  // ---- repeated uncertainty is one claim ----------------------------------
  {
    // ORNEK's real shape: 31 read once and unconfirmed, 45 the drawing never
    // printed legibly. Two claims, not seventy-six warnings.
    const r = await run1({ numbers: { needsReview: 31, unknown: 45,
      needsReviewIds: Array.from({ length: 31 }, (_, i) => `n${i}`),
      unknownIds: Array.from({ length: 45 }, (_, i) => `u${i}`) } });
    checks.equal(r.all.length, 2, "seventy-six unconfirmed numbers become two claims");
    checks.equal(find(r, "budget:numbersUnconfirmed").count, 31, "each carrying its count");
    checks.equal(find(r, "budget:numbersUnread").count, 45, "rather than repeating itself");
    checks.equal(r.counts.distinctThingsTheseClaimsCover, 76,
      "and the layer reports how many distinct things the two claims cover");
  }
  {
    // A gap of seven consecutive numbers is one thing to look at.
    const r = await run1({ numberIntegrity: { findings: [
      { kind: "missingNumbers", runs: [{ from: 40, to: 46, count: 7 }], detail: "40-46 are absent" }] } });
    checks.equal(r.all.length, 1, "a run of missing numbers is one claim");
    checks.equal(r.all[0].count, 7, "carrying how many numbers it covers");
    checks.equal(r.all[0].settles.facts, 1, "and it disputes a statement the product makes");
  }
  {
    const r = await run1({ teachArea: { proposals: [
      { state: "REVIEW", candidateId: "a" }, { state: "REVIEW", candidateId: "b" },
      { state: "AMBIGUOUS", candidateId: null }, { state: "APPLY", candidateId: "c" },
      { state: "NOT_ON_THIS_PLAN", candidateId: null }] } });
    checks.equal(r.all.length, 2, "teach proposals are grouped by what has to be done about them");
    checks.equal(find(r, "budget:teachREVIEW").count, 2, "two to confirm");
    checks.equal(find(r, "budget:teachAMBIGUOUS").count, 1, "one that fits more than one object");
    checks.ok(!find(r, "budget:teachAPPLY"), "and something already applied is not a claim on attention");
  }

  // ---- an item that settles nothing is not work ---------------------------
  {
    // Five of the Golden Plan's thirteen priorities look like this.
    const r = await run1({ reviewPriorities: [
      priority("p:real", "priority.reviewGroup", { objects: 20, seats: 40, facts: 0 }),
      priority("p:empty", "priority.question", { objects: 0, seats: 0, facts: 0 }),
    ] });
    checks.equal(find(r, "p:empty").state, "NOTHING_MEASURABLE_DEPENDS_ON_IT",
      "a priority that settles nothing on any axis is marked as such");
    checks.equal(r.counts.shown, 1, "and it is not one of the things the operator is asked to do");
    checks.equal(r.counts.nothingMeasurableDependsOnThem, 1,
      "but it is counted, because it is real uncertainty and hiding it would be a lie");
    checks.ok(r.all.some((c) => c.id === "p:empty"), "and it stays in the full list");
  }
  {
    // Numbers the drawing does not carry cannot be settled by looking harder.
    const r = await run1({ numbers: { needsReview: 0, unknown: 45 } });
    checks.equal(find(r, "budget:numbersUnread").state, "NOT_ANSWERABLE_FROM_THE_DRAWING",
      "unreadable numbers are not ranked as review work");
    checks.equal(r.counts.shown, 0, "so nothing is put in front of the operator");
    checks.equal(r.counts.notAnswerableFromTheDrawing, 1, "and the count says why");
    checks.ok(/does not carry/.test(find(r, "budget:numbersUnread").why),
      "with the reason readable", find(r, "budget:numbersUnread").why);
  }

  // ---- the ranking is an argument, not a tuned score -----------------------
  {
    const r = await run1({
      reviewPriorities: [
        priority("p:manyObjects", "priority.reviewGroup", { objects: 163, seats: 0, facts: 0 }),
        priority("p:oneFact", "priority.contradiction", { objects: 1, seats: 0, facts: 2 }),
      ],
    });
    checks.equal(r.all[0].id, "p:oneFact",
      "a wrong fact outranks a large batch — the operator will act on a fact");
    checks.equal(r.all[1].id, "p:manyObjects", "and the batch comes next");
  }
  {
    // Same facts, different cost. What one decision settles decides it.
    const r = await run1({
      reviewPriorities: [
        priority("p:batch", "priority.reviewGroup", { objects: 40, seats: 0, facts: 0 }),
        priority("p:perObject", "priority.unverifiedSeating", { objects: 40, seats: 0, facts: 0 }, { n: 40 }),
      ],
    });
    checks.equal(find(r, "p:batch").decisions, 1, "confirming a family is one decision");
    checks.equal(find(r, "p:perObject").decisions, 40, "supplying forty seat counts is forty");
    checks.equal(r.all[0].id, "p:batch", "so the batch is offered first");
    checks.equal(find(r, "p:batch").objectsPerDecision, 40, "settling forty objects for one decision");
    checks.equal(find(r, "p:perObject").objectsPerDecision, 1, "against one for one");
  }
  {
    const r = await run1({ reviewPriorities: [
      priority("p:b", "priority.reviewGroup", { objects: 5, seats: 0, facts: 0 }),
      priority("p:a", "priority.reviewGroup", { objects: 5, seats: 0, facts: 0 }),
    ] });
    const again = await run1({ reviewPriorities: [
      priority("p:a", "priority.reviewGroup", { objects: 5, seats: 0, facts: 0 }),
      priority("p:b", "priority.reviewGroup", { objects: 5, seats: 0, facts: 0 }),
    ] });
    checks.equal(r.all.map((c) => c.id).join(","), again.all.map((c) => c.id).join(","),
      "two claims that are equal on every measure still order the same way both times");
  }

  // ---- nothing is hidden, only ranked -------------------------------------
  {
    const many = Array.from({ length: 11 }, (_, i) =>
      priority(`p:${i}`, "priority.reviewGroup", { objects: 11 - i, seats: 0, facts: 0 }));
    const r = await run1({ reviewPriorities: many });
    checks.equal(r.counts.claims, 11, "all eleven claims exist");
    checks.equal(r.counts.shown, 6, "six are put in front of the operator");
    checks.equal(r.counts.deferred, 5, "and the other five are counted, not dropped");
    checks.equal(r.spend.length + r.deferred.length, 11, "every claim is in exactly one of the two");
    checks.equal(r.spend[0].id, "p:0", "the most valuable one is shown first");
    checks.ok(r.coverage.objects > 0.7 && r.coverage.objects <= 1,
      "and the coverage the shown items achieve is stated as a number", r.coverage.objects);
  }
  {
    const r = await run1({ reviewPriorities: Array.from({ length: 20 }, (_, i) =>
      priority(`p:${i}`, "priority.reviewGroup", { objects: 2, seats: 0, facts: 0 })) }, { maxItems: 3 });
    checks.equal(r.counts.shown, 3, "the cap is a parameter, not a constant baked into the answer");
    checks.equal(r.maxItems, 3, "and the budget reports the cap it used");
    checks.equal(r.counts.deferred, 17, "with the remainder counted");
  }
  {
    const r = await run1({});
    checks.equal(r.counts.claims, 0, "a plan with nothing uncertain produces no claims");
    checks.equal(r.coverage.objects, 1, "and coverage of nothing is complete, not a division by zero");
    checks.ok(/only the ranking decides/.test(r.statement),
      "the policy is stated out loud", r.statement);
  }

  // ---- everything ranked against everything, which is the point -----------
  {
    // The shape of ORNEK: the newer layers used to be invisible to the ranked
    // list. Here they compete with it directly.
    const r = await run1({
      reviewPriorities: [
        priority("p:group", "priority.reviewGroup", { objects: 163, seats: 0, facts: 0 }),
        priority("p:zero", "priority.question", { objects: 0, seats: 0, facts: 0 }),
      ],
      numbers: { needsReview: 31, unknown: 45 },
      numberIntegrity: { findings: [
        { kind: "tableCountDisagreesWithTheDrawing", detail: "the drawing states 166; 163 were found" },
        { kind: "missingNumbers", runs: [{ from: 40, to: 46, count: 7 }] }] },
      selfCheck: { checks: [
        { id: "statedTablesVsDetected", verdict: "INCONSISTENT", statement: "166 stated, 163 found", detail: "3 not accounted for" },
        { id: "capacityRuleArithmetic", verdict: "CONSISTENT", statement: "ok", detail: "ok" }] },
    });
    checks.equal(r.counts.claims, 6,
      "the numbering, integrity and consistency layers reach the same list — and the two that say the same thing arrive as one");
    checks.ok(!r.all.some((c) => c.id === "budget:capacityRuleArithmetic"),
      "a check that came out consistent is not a claim on anyone's attention");
    checks.ok(r.all.slice(0, 2).every((c) => c.settles.facts > 0),
      "the disputed facts sort to the top", r.all.slice(0, 2).map((c) => c.key));
    // The integrity report and the self-check both noticed "166 stated, 163
    // found". That is one disagreement, and the operator is told once.
    const merged = r.all.find((c) => c.about === "statedVsFoundTableCount");
    checks.ok(!!merged, "the two layers that noticed the same disagreement produce one claim");
    checks.ok(merged.corroboratedBy.length >= 1,
      "with the corroborating layer recorded rather than discarded", merged.corroboratedBy);
    checks.ok(!r.all.some((c) => c.id === "budget:statedTablesVsDetected" && c.about !== "statedVsFoundTableCount"),
      "and the same problem is never listed twice");
    checks.equal(find(r, "budget:numbersUnread").state, "NOT_ANSWERABLE_FROM_THE_DRAWING",
      "what the drawing cannot answer stays out of the work");
    checks.equal(find(r, "p:zero").state, "NOTHING_MEASURABLE_DEPENDS_ON_IT",
      "and so does what settles nothing");
    checks.ok(r.counts.shown <= 6, "the operator sees at most a handful", r.counts.shown);
    checks.equal(r.counts.distinctThingsTheseClaimsCover, 163 + 1 + 31 + 45 + 7 + 1,
      "six claims covering 248 distinct things");
  }
}
