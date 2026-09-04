// Memory identity, tested where the benchmark cannot look.
//
// benchmarks/memory/ measures what fraction of real decisions survive a
// transformed plan. That is the number that matters and it cannot see the
// properties that keep the number honest — most importantly the abstention. A
// matcher that quietly picked one of two equally good candidates would score
// BETTER on retention while being exactly the failure this design exists to
// avoid, because a decision applied to the wrong object is invisible where a
// lost one is reported.
//
// So this drives src/plan-memory.js directly with geometry where the right
// answer is known, and pins:
//
//   1. an unchanged plan still matches everything, exactly as before
//   2. two candidates that fit equally well produce AMBIGUOUS, and ambiguous
//      is not applied
//   3. a family mismatch lowers the score and never blocks the match, because
//      a reclassification is the memory that matters most
//   4. an object that is simply gone is reported lost, never fabricated
//   5. the global-transform correction is off unless asked for, and when asked
//      for it declines a fit it cannot trust
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "plan-memory",
  tags: ["intelligence"],
  timeout: 120000,
  viewport: { width: 1400, height: 900 },
};

const mem = (id, x, y, w, h, extra = {}) => ({
  id, sourceCandidateId: `src-${id}`, kind: "table", type: "square", status: "confirmed",
  geometry: { x, y, w, h, rotation: 0 }, ...extra,
});
const cand = (id, x, y, w, h, extra = {}) => ({ id, kind: "table", type: "square", x, y, w, h, ...extra });

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);

  const api = await page.evaluate(() => ({
    present: typeof globalThis.MeritPlanMemory === "object",
    version: globalThis.MeritPlanMemory?.version ?? null,
    grades: globalThis.MeritPlanMemory?.grades ?? null,
  }));
  checks.require(api.present, "the memory matcher is loaded in the app", api);
  checks.equal(api.version, 2, "at version 2", api.version);
  checks.equal(JSON.stringify(api.grades), JSON.stringify(["strong", "likely", "ambiguous", "none"]),
    "with four answers, not two", api.grades);

  const run1 = (memory, candidates, options) =>
    page.evaluate(({ m, c, o }) => globalThis.MeritPlanMemory.match(m, c, o || {}),
      { m: memory, c: candidates, o: options });

  // ---- 1. the case that already worked, still works -------------------------
  {
    const memory = [mem("m1", 10, 10, 4, 4), mem("m2", 30, 10, 4, 4), mem("m3", 50, 30, 4, 4)];
    const cands = [cand("c1", 10, 10, 4, 4), cand("c2", 30, 10, 4, 4), cand("c3", 50, 30, 4, 4)];
    const r = await run1(memory, cands);
    checks.equal(r.matches.length, 3, "an unchanged plan re-applies every decision", r.stats);
    checks.ok(r.matches.every(m => m.grade === "strong"), "all of them strongly", r.matches.map(m => m.grade));
    for (const m of r.matches) {
      const i = memory.findIndex(x => x.id === m.memoryId);
      checks.equal(m.candidateId, cands[i].id, `${m.memoryId} lands on the object it was made on`, m);
    }
    checks.equal(r.stats.lost, 0, "and nothing is lost", r.stats);
  }

  // ---- 2. two objects that fit equally well ---------------------------------
  //
  // A decision made between two identical boxes, both now the same distance
  // away. There is no right answer, and picking one is the failure.
  {
    const memory = [mem("m1", 20, 10, 4, 4)];
    const cands = [cand("cLeft", 18.5, 10, 4, 4), cand("cRight", 21.5, 10, 4, 4)];
    const r = await run1(memory, cands);
    checks.equal(r.matches.length, 0, "an even choice applies nothing", r.matches);
    checks.equal(r.ambiguous.length, 1, "and reports it as ambiguous instead", r.ambiguous);
    checks.equal(r.ambiguous[0].grade, "ambiguous", "graded ambiguous", r.ambiguous[0]);
    checks.equal(r.ambiguous[0].applies, false,
      "explicitly marked as not applying, so a caller cannot use it by accident", r.ambiguous[0]);
    checks.ok(r.ambiguous[0].margin < 0.04,
      "because the margin between the two candidates is below the threshold", r.ambiguous[0].margin);
  }

  // ---- 3. family is evidence, never a gate ---------------------------------
  //
  // The most valuable memory is a reclassification: the detector said table,
  // the operator said chair, and the detector will say table again next run
  // because it is deterministic. Requiring the kinds to match would make
  // exactly those impossible to re-apply.
  {
    const memory = [{ ...mem("m1", 10, 10, 4, 4), kind: "venue", type: "chair" }];
    const cands = [cand("c1", 10, 10, 4, 4)];   // still detected as a table
    const r = await run1(memory, cands);
    checks.equal(r.matches.length, 1,
      "a reclassification re-applies even though the detector proposed the wrong kind again", r.matches);
    checks.equal(r.matches[0].reclassifies, true,
      "and it is flagged as overruling the detector rather than agreeing with it", r.matches[0]);
    checks.ok(r.matches[0].terms.family < 1,
      "the family mismatch lowers the score", r.matches[0].terms);

    // The same geometry with a matching family must score HIGHER, or "family is
    // evidence" is not true, it is just ignored.
    const same = await run1([mem("m1", 10, 10, 4, 4)], cands);
    checks.ok(same.matches[0].score > r.matches[0].score,
      "and a matching family scores higher, so the term is doing something",
      { matching: same.matches[0].score, mismatched: r.matches[0].score });
  }

  // ---- 4. an object that is gone ------------------------------------------
  {
    const r = await run1([mem("m1", 10, 10, 4, 4)], [cand("c1", 70, 70, 4, 4)]);
    checks.equal(r.matches.length, 0, "a decision whose object is gone is not re-applied", r.matches);
    checks.equal(r.unmatched.length, 1, "it is reported as unmatched", r.unmatched);
    checks.equal(r.unmatched[0].memoryId, "m1", "naming the decision that was lost", r.unmatched[0]);
    checks.equal(r.stats.applied, 0, "and nothing was fabricated to receive it", r.stats);
  }

  // ---- 5. the global-transform correction -----------------------------------
  //
  // Off by default. That is a measured decision, not an unfinished feature:
  // across the transformed plans it recovers 3 decisions and misapplies 3 more.
  {
    // A re-issued plan, modelled the way a real one changes: the frame grew, so
    // every object scaled about the origin. Objects near the origin barely
    // move and still match strongly — those are the anchors the fit is
    // estimated from — while the ones far out have drifted past their own
    // tolerance. That asymmetry is the whole reason a global fit can work.
    //
    // A uniform shift large enough to lose everything cannot be corrected at
    // all, and should not be: with no object still confidently matched there
    // is nothing to estimate a transform FROM, and inventing one would be
    // guessing. The first version of this test asserted the opposite and was
    // wrong about the product, not the other way round.
    const S = 1.06;
    const memory = [], cands = [];
    for (let i = 0; i < 10; i++) {
      const x = 6 + i * 8;
      memory.push(mem(`m${i}`, x, 20, 5, 5));
      cands.push(cand(`c${i}`, +(x * S).toFixed(2), +(20 * S).toFixed(2), 5, 5));
    }
    const off = await run1(memory, cands);
    const on = await run1(memory, cands, { shift: true });
    checks.equal(off.shift, null, "no transform is fitted unless it is asked for", off.shift);
    checks.ok(on.shift !== null, "and one is fitted when there are anchors to fit it from", on.shift);
    checks.ok(on.shift && Math.abs(on.shift.scale - S) < 0.03,
      "recovering the scale the plan actually changed by", on.shift);
    checks.ok(on.matches.length >= off.matches.length,
      "the correction never returns fewer matches than the uncorrected pass",
      { off: off.matches.length, on: on.matches.length });

    // A scatter of unrelated movements is not one transform, and must not be
    // fitted as if it were.
    const scattered = cands.map((c, i) => ({ ...c, x: c.x + (i % 2 ? 6 : -6), y: c.y + (i % 3 ? 5 : -5) }));
    const noisy = await run1(memory, scattered, { shift: true });
    checks.ok(noisy.shift === null || noisy.shift.applied === false,
      "a scatter of unrelated shifts is refused rather than fitted", noisy.shift);
  }

  // ---- the evidence is inspectable ----------------------------------------
  {
    const r = await run1([mem("m1", 10, 10, 4, 4)], [cand("c1", 10.2, 10.1, 4, 4)]);
    const m = r.matches[0];
    checks.require(m, "a near-identical box matches");
    for (const k of ["grade", "applies", "score", "margin", "distance", "tolerance",
      "withinOldTolerance", "visualUsed", "contextUsed", "terms", "reclassifies"])
      checks.ok(k in m, `every match carries ${k}`, Object.keys(m));
    for (const k of ["geometry", "size", "family"])
      checks.ok(k in m.terms, `the score breakdown carries ${k}`, m.terms);
    checks.equal(m.visualUsed, false,
      "and says plainly when there was no embedding to compare, rather than inventing one", m);
  }

  // ---- an embedding changes the answer, when there is one ------------------
  //
  // §24 makes the learned embedding mandatory as a real signal. Whether it
  // HELPS is a benchmark question and the honest answer there is "not
  // measurably, on this corpus". Whether it is wired in at all is this
  // question, and it has to be yes.
  {
    const v = n => Array.from({ length: 16 }, (_, i) => Math.sin(i * 0.7 + n));
    const memory = [{ ...mem("m1", 10, 10, 4, 4), visual: { vector: v(1) } }];
    const near = await run1(memory, [cand("c1", 11.5, 10, 4, 4, { vector: v(1) })]);
    const far = await run1(memory, [cand("c1", 11.5, 10, 4, 4, { vector: v(9) })]);
    checks.equal(near.matches.length + near.ambiguous.length, 1, "the like-looking box is scored", near.stats);
    checks.ok(near.matches[0] || near.ambiguous[0], "and produces a record");
    const a = (near.matches[0] || near.ambiguous[0]), b = (far.matches[0] || far.ambiguous[0]);
    checks.equal(a.visualUsed, true, "the embedding is actually consulted", a);
    checks.ok(a.score > b.score,
      "and an object that looks like the remembered one scores higher than one that does not",
      { looksSame: a.score, looksDifferent: b.score });
  }
}
