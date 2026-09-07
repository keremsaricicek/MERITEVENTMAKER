// The confidence budget — what is worth an operator's attention, and what is not.
//
// An operator has a finite number of decisions in them before a plan stops
// getting checked and starts getting clicked through. That is the budget. This
// layer decides how to spend it.
//
// ---- what the measurement said ---------------------------------------------
//
// Counted one line per uncertain fact, the two real plans produce:
//
//   merit-real-venue   119 items    ornek-symbolic   278 items
//
// The existing ranked list (`reviewPriorities`) already collapses much of that
// — 13 items on the first plan, 6 on the second — but two things are wrong with
// it as an answer, and both were measured rather than assumed:
//
//   IT DOES NOT SEE THE NEWER LAYERS. Per-table numbers, numbering integrity,
//   the self-check and the Teach Area all arrived after it was written. On
//   ORNEK that is 76 unconfirmed numbers, 3 integrity findings and 1 open
//   consistency check that the operator is never pointed at, sitting in four
//   different places with no shared ranking.
//
//   IT CONTAINS ITEMS THAT CLAIM NOTHING. 5 of the 13 and 2 of the 6 settle
//   zero objects, zero seats and zero facts. Each costs a decision and fixes
//   nothing measurable. Showing those IS "fifty warnings because there are
//   fifty uncertain facts".
//
// ---- the two rules ---------------------------------------------------------
//
// REPEATED UNCERTAINTY IS ONE CLAIM, NOT N. Forty-five tables whose number the
// drawing never printed legibly is one thing to decide about, carrying the
// number 45 — not forty-five warnings. The count is the information; the
// repetition is not.
//
// NOTHING IS HIDDEN, ONLY RANKED. Everything below the line is counted and
// summarised, and what it would settle is stated. A budget that quietly drops
// the tail is not a budget, it is a filter that lies about its own coverage.
//
// This layer runs no detector, reads no pixels and changes no candidate. It
// consumes what the other layers already concluded and decides what to say
// first.
(function () {
  "use strict";

  // What a claim on attention is worth acting on.
  const STATE = {
    // Resolving it demonstrably settles something.
    WORTH_DECIDING: "WORTH_DECIDING",
    // Real uncertainty, but nothing downstream measurably depends on it. Not
    // hidden — counted, in one line, so the operator knows it exists without
    // being asked to work through it.
    NOTHING_MEASURABLE_DEPENDS_ON_IT: "NOTHING_MEASURABLE_DEPENDS_ON_IT",
    // Cannot be settled by looking harder at this screen: the drawing does not
    // carry the answer. Distinguished so it is never ranked as work.
    NOT_ANSWERABLE_FROM_THE_DRAWING: "NOT_ANSWERABLE_FROM_THE_DRAWING",
  };

  // How many items the budget will actually put in front of someone. Not a
  // guess dressed as a constant: with the two real plans, six covers every
  // claim that settles anything on the physical plan and every claim that
  // settles an object or a fact on the symbolic one, and what it leaves out is
  // reported rather than dropped. Overridable so the measurement can be redone
  // on a third plan instead of inherited.
  const DEFAULT_MAX_ITEMS = 6;

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  // Which claims from different layers are about the same underlying thing.
  // Only genuine restatements are listed: "the drawing states 166 and 163 were
  // found" is one disagreement whether the integrity report or the self-check
  // notices it. `tablesWithoutAConfidentNumber` overlaps the unconfirmed-number
  // claim without being identical -- it also counts the ones the drawing never
  // printed legibly -- and is merged with the half an operator can act on,
  // because the other half is separately reported as unanswerable.
  const INTEGRITY_ABOUT = {
    tableCountDisagreesWithTheDrawing: "statedVsFoundTableCount",
    tablesWithoutAConfidentNumber: "tableNumbersNotConfirmed",
  };
  const SELF_CHECK_ABOUT = {
    statedTablesVsDetected: "statedVsFoundTableCount",
  };

  function claim(o) {
    const settles = {
      objects: num(o.settles && o.settles.objects),
      seats: num(o.settles && o.settles.seats),
      facts: num(o.settles && o.settles.facts),
    };
    const decisions = Math.max(1, num(o.decisions) || 1);
    const settlesSomething = settles.objects > 0 || settles.seats > 0 || settles.facts > 0;
    return {
      id: o.id, source: o.source, key: o.key, params: o.params || {},
      // What this claim is ABOUT, independent of which layer raised it. Several
      // layers legitimately notice the same disagreement -- the integrity
      // report and the self-check both say the drawing states 166 and 163 were
      // found -- and showing one problem four times is the same failure as
      // showing one problem forty-five times, just repeated across layers
      // instead of across objects.
      about: o.about || o.id,
      corroboratedBy: [],
      // How many individual things this one claim stands for. Given explicitly
      // where a claim is a group of repetitions (76 unconfirmed numbers, a run
      // of 7 missing ones); otherwise the objects it covers, because a screen
      // with one line per uncertain thing would have listed those separately.
      // This is the compression, reported as a number rather than asserted.
      count: num(o.count) || Math.max(num(o.settles && o.settles.objects), decisions, 1),
      targetIds: o.targetIds || [],
      settles, decisions,
      // The only ratio in the ranking, and it means one thing: how much of the
      // plan one human decision settles.
      objectsPerDecision: +(settles.objects / decisions).toFixed(3),
      state: o.state || (settlesSomething ? STATE.WORTH_DECIDING : STATE.NOTHING_MEASURABLE_DEPENDS_ON_IT),
      why: o.why || null,
    };
  }

  // ---- gathering ----------------------------------------------------------
  //
  // Each source contributes claims in its own terms; the shape is shared so
  // they can be ranked against each other, which is the whole point — until
  // now a numbering gap and a contradiction could not be compared because they
  // lived in different lists.
  function collect(input) {
    const inp = input || {};
    const out = [];

    // 1. The existing ranked list, unchanged in meaning. Its own impact model
    //    is reused rather than recomputed: it already knows that confirming a
    //    family lands on every member.
    for (const p of inp.reviewPriorities || []) {
      const impact = p.downstreamImpact || {};
      out.push(claim({
        id: p.id, source: "review", key: p.key, params: p.params,
        targetIds: p.targetIds || [],
        settles: impact,
        // A batch is one decision by construction; a per-object ask is not.
        decisions: p.key === "priority.unverifiedSeating" ? num(p.params && p.params.n) || 1 : 1,
        why: p.why || null,
      }));
    }

    // 2. Numbering. Two claims at most, whatever the plan's size — this is the
    //    grouping rule doing its work: 45 tables the drawing never printed
    //    legibly is ONE thing to decide about, carrying the number 45.
    const numbers = inp.numbers || null;
    if (numbers) {
      if (num(numbers.needsReview) > 0)
        out.push(claim({
          id: "budget:numbersUnconfirmed", source: "numbers", key: "budget.numbersUnconfirmed",
          about: "tableNumbersNotConfirmed",
          params: { n: numbers.needsReview }, count: numbers.needsReview,
          targetIds: numbers.needsReviewIds || [],
          // Each was read once and not corroborated; confirming one settles
          // that one table's identity.
          settles: { objects: numbers.needsReview, seats: 0, facts: 0 },
          decisions: numbers.needsReview,
          why: "read once, and one reading alone is right about two times in twelve",
        }));
      if (num(numbers.unknown) > 0)
        out.push(claim({
          id: "budget:numbersUnread", source: "numbers", key: "budget.numbersUnread",
          about: "tableNumbersUnreadable",
          params: { n: numbers.unknown }, count: numbers.unknown,
          targetIds: numbers.unknownIds || [],
          settles: { objects: numbers.unknown, seats: 0, facts: 0 },
          decisions: numbers.unknown,
          // The distinction that keeps this out of the work queue: nothing an
          // operator does on this screen makes the drawing legible. They can
          // type the numbers in, which is data entry, not review.
          state: STATE.NOT_ANSWERABLE_FROM_THE_DRAWING,
          why: "the drawing does not carry a number these can be read from",
        }));
    }

    // 3. Numbering integrity. Already compressed into runs by its own layer, so
    //    each finding is one claim — a gap of seven consecutive numbers is one
    //    thing to look at, not seven.
    for (const f of (inp.numberIntegrity && inp.numberIntegrity.findings) || []) {
      const n = f.tableIds ? f.tableIds.length
        : f.numbers ? f.numbers.length
          : f.runs ? f.runs.reduce((a, r) => a + (num(r.count) || 1), 0) : 1;
      out.push(claim({
        id: `budget:${f.kind}`, source: "integrity", key: `budget.integrity.${f.kind}`,
        about: INTEGRITY_ABOUT[f.kind] || `integrity:${f.kind}`,
        params: { n }, count: n, targetIds: f.tableIds || [],
        // An integrity finding disputes a statement the product is making about
        // the plan, which is what a fact is.
        settles: { objects: f.tableIds ? f.tableIds.length : 0, seats: 0, facts: 1 },
        decisions: 1,
        why: f.detail || null,
      }));
    }

    // 4. The self-check. Only verdicts that are actually open: a CONSISTENT
    //    result is not a claim on anyone's attention, and NOT_CHECKABLE is the
    //    layer saying so itself.
    for (const c of (inp.selfCheck && inp.selfCheck.checks) || []) {
      if (c.verdict !== "INCONSISTENT" && c.verdict !== "NEEDS_REVIEW") continue;
      out.push(claim({
        id: `budget:${c.id}`, source: "selfCheck", key: "budget.selfCheck",
        about: SELF_CHECK_ABOUT[c.id] || `selfCheck:${c.id}`,
        params: { statement: c.statement }, settles: { objects: 0, seats: 0, facts: 1 },
        decisions: 1, why: c.detail || null,
      }));
    }

    // 5. The Teach Area. Grouped by what the operator has to do about them,
    //    which is the same for every proposal in a state — not one line each.
    const proposals = (inp.teachArea && inp.teachArea.proposals) || [];
    const inState = (s) => proposals.filter((p) => p.state === s);
    for (const [state, key, why] of [
      ["REVIEW", "budget.teachReview", "a note you wrote probably belongs to an object here, but not certainly"],
      ["AMBIGUOUS", "budget.teachAmbiguous", "more than one object fits a note you wrote, so none of them was changed"],
    ]) {
      const group = inState(state);
      if (!group.length) continue;
      out.push(claim({
        id: `budget:teach${state}`, source: "teachArea", key,
        params: { n: group.length }, count: group.length,
        targetIds: group.map((p) => p.candidateId).filter(Boolean),
        settles: { objects: group.length, seats: 0, facts: 0 },
        decisions: group.length, why,
      }));
    }

    return out;
  }

  // ---- one problem, said once ---------------------------------------------
  //
  // Measured on ORNEK before this existed: four of the six items the budget put
  // in front of the operator were the same disagreement seen from four angles,
  // which pushed 31 tables of real work below the line and left object coverage
  // at 0.61. Claims that are about the same thing collapse into one, and the
  // merged claim keeps the WORST case of each measure -- the union of what is
  // at stake and the true cost of settling it, never a flattering minimum.
  function dedupe(claims) {
    const byAbout = new Map();
    for (const c of claims) {
      const seen = byAbout.get(c.about);
      if (!seen) { byAbout.set(c.about, c); continue; }
      // Whichever says more about the plan is the one that speaks.
      const keep = (seen.settles.facts !== c.settles.facts ? seen.settles.facts > c.settles.facts
        : seen.settles.objects >= c.settles.objects) ? seen : c;
      const other = keep === seen ? c : seen;
      keep.settles = {
        objects: Math.max(keep.settles.objects, other.settles.objects),
        seats: Math.max(keep.settles.seats, other.settles.seats),
        facts: Math.max(keep.settles.facts, other.settles.facts),
      };
      keep.decisions = Math.max(keep.decisions, other.decisions);
      keep.count = Math.max(keep.count, other.count);
      keep.objectsPerDecision = +(keep.settles.objects / keep.decisions).toFixed(3);
      keep.state = STATE_RANK[keep.state] <= STATE_RANK[other.state] ? keep.state : other.state;
      keep.targetIds = keep.targetIds.length ? keep.targetIds : other.targetIds;
      keep.corroboratedBy = [...keep.corroboratedBy, ...other.corroboratedBy, other.key];
      byAbout.set(c.about, keep);
    }
    return [...byAbout.values()];
  }

  // ---- ranking ------------------------------------------------------------
  //
  // Lexicographic, and deliberately so. A weighted score would need numbers
  // chosen to make the result look right, and nothing in this repo could then
  // tell a good ordering from a tuned one. The order of the tests IS the
  // argument:
  //
  //   1. things that settle something, before things that do not
  //   2. facts first — a fact is a claim the PRODUCT is making, and a wrong one
  //      is worse than an unresolved object because the operator will act on it
  //   3. then how much of the plan one decision settles
  //   4. then seats, then a stable key, so the order never depends on
  //      iteration accidents
  const STATE_RANK = {
    [STATE.WORTH_DECIDING]: 0,
    [STATE.NOTHING_MEASURABLE_DEPENDS_ON_IT]: 1,
    [STATE.NOT_ANSWERABLE_FROM_THE_DRAWING]: 2,
  };
  function rank(claims) {
    return [...claims].sort((a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state]
      || b.settles.facts - a.settles.facts
      || b.objectsPerDecision - a.objectsPerDecision
      || b.settles.objects - a.settles.objects
      || b.settles.seats - a.settles.seats
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // ---- the budget ---------------------------------------------------------
  function run(input, options) {
    const opts = options || {};
    const maxItems = Math.max(1, num(opts.maxItems) || DEFAULT_MAX_ITEMS);
    const all = rank(dedupe(collect(input)));

    const worth = all.filter((c) => c.state === STATE.WORTH_DECIDING);
    const spend = worth.slice(0, maxItems);
    const deferred = worth.slice(maxItems);
    const notWorthIt = all.filter((c) => c.state === STATE.NOTHING_MEASURABLE_DEPENDS_ON_IT);
    const notAnswerable = all.filter((c) => c.state === STATE.NOT_ANSWERABLE_FROM_THE_DRAWING);

    const sum = (list, f) => list.reduce((n, c) => n + f(c), 0);
    const objectsWorth = sum(worth, (c) => c.settles.objects);
    const factsWorth = sum(worth, (c) => c.settles.facts);

    return {
      spend, deferred, notWorthIt, notAnswerable,
      // Everything, ranked, for anything that wants the full list rather than
      // the budget — a report, a benchmark, a later screen.
      all,
      coverage: {
        // What the shown items settle, against what all of them would.
        objects: objectsWorth ? +(sum(spend, (c) => c.settles.objects) / objectsWorth).toFixed(3) : 1,
        facts: factsWorth ? +(sum(spend, (c) => c.settles.facts) / factsWorth).toFixed(3) : 1,
      },
      counts: {
        claims: all.length,
        shown: spend.length,
        deferred: deferred.length,
        nothingMeasurableDependsOnThem: notWorthIt.length,
        notAnswerableFromTheDrawing: notAnswerable.length,
        // How many distinct things these claims cover -- what a screen with one
        // line per uncertain thing would have put in front of someone. A UNION,
        // not a sum: claims overlap (the same 163 tables are covered by a
        // review group and by a contradiction), and adding them would report a
        // compression ratio larger than the thing being compressed. Claims that
        // name no objects contribute their own count instead.
        distinctThingsTheseClaimsCover: (() => {
          const ids = new Set();
          let unnamed = 0;
          for (const c of all) {
            if (c.targetIds && c.targetIds.length) for (const id of c.targetIds) ids.add(id);
            else unnamed += c.count;
          }
          return ids.size + unnamed;
        })(),
      },
      maxItems,
      statement: "everything is counted; only the ranking decides what is said first",
    };
  }

  globalThis.MeritConfidenceBudget = {
    version: 1, STATE, DEFAULT_MAX_ITEMS,
    collect, dedupe, rank, run,
  };
})();
