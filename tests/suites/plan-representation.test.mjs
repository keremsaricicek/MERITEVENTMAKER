// The kind-of-drawing decision, tested where the benchmark cannot look.
//
// benchmarks/run-benchmark.mjs measures what the decision does to detection
// on the two real plans, which is the number that matters. It cannot see the
// properties that keep that number honest:
//
//   1. a plan that draws chairs is classified PHYSICAL and is therefore not
//      touched at all — the whole change has to be a no-op there, and the
//      benchmark can only show that it currently is, not that it must be
//   2. a plan in the gap between the two behaviours is NEEDS_REVIEW, not
//      silently forced into an answer
//   3. too few objects, or no uniform family at all, is UNKNOWN — abstaining
//      rather than guessing from a handful of blobs
//   4. the SYMBOLIC verdict needs the loose objects to clearly outnumber the
//      things called tables, so a plan with many real tables AND many loose
//      chairs is not flipped
//   5. the decision reports the evidence it used, so an operator can disagree
//      with it on the same facts
//
// The numbers below are the real measured ones from the benchmark, so a
// change that would reclassify either real plan fails here first, without
// waiting two minutes for the full detection run.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "plan-representation",
  tags: ["intelligence"],
  timeout: 60000,
  viewport: { width: 1200, height: 800 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);

  const api = await page.evaluate(() => ({
    present: typeof globalThis.MeritPlanRepresentation === "object",
    version: globalThis.MeritPlanRepresentation?.version ?? null,
    constants: globalThis.MeritPlanRepresentation?.constants ?? null,
  }));
  checks.require(api.present, "the representation decision is loaded in the app", api);
  checks.equal(api.version, 1, "at version 1");

  const decide = (ev) => page.evaluate((e) => globalThis.MeritPlanRepresentation.decide(e), ev);
  const physical = { uniformFamily: true, uniformObjects: 112, associatedToTable: 108, standalone: 4, tablesFound: 50 };
  const symbolic = { uniformFamily: true, uniformObjects: 143, associatedToTable: 11, standalone: 132, tablesFound: 10 };

  // ---- 1. the real plans, by their real measured numbers --------------------
  {
    const r = await decide(physical);
    checks.equal(r.kind, "PHYSICAL", "merit-real-venue's own numbers read as a plan that draws chairs");
    checks.ok(r.associationRate > 0.95, "at an association rate above 0.95", r.associationRate);

    const s = await decide(symbolic);
    checks.equal(s.kind, "SYMBOLIC", "ORNEK's own numbers read as a symbolic plan");
    checks.ok(s.associationRate < 0.1, "at an association rate below 0.10", s.associationRate);
  }

  // Every adversarial fixture draws chairs and must stay PHYSICAL, because
  // the swap must never fire on them.
  for (const [name, ev] of Object.entries({
    "adversarial-architecture": { uniformFamily: true, uniformObjects: 80, associatedToTable: 80, standalone: 0, tablesFound: 10 },
    "adversarial-bistro": { uniformFamily: true, uniformObjects: 72, associatedToTable: 72, standalone: 0, tablesFound: 18 },
    "adversarial-dense": { uniformFamily: true, uniformObjects: 80, associatedToTable: 76, standalone: 4, tablesFound: 24 },
    "adversarial-text": { uniformFamily: true, uniformObjects: 73, associatedToTable: 73, standalone: 0, tablesFound: 12 },
  })) {
    const r = await decide(ev);
    checks.equal(r.kind, "PHYSICAL", `${name} is a plan that draws chairs`, r);
  }

  // ---- 2. the gap is reported, not filled in --------------------------------
  //
  // Half the chairs found a table. That is neither behaviour, and guessing
  // either way would be a fabricated verdict on a plan nobody has seen.
  {
    const r = await decide({ uniformFamily: true, uniformObjects: 100, associatedToTable: 50, standalone: 50, tablesFound: 20 });
    checks.equal(r.kind, "NEEDS_REVIEW", "a plan halfway between the two behaviours is sent for review");
    checks.ok(/neither/.test(r.why), "and says why in those terms", r.why);
  }

  // ---- 3. abstaining rather than guessing -----------------------------------
  {
    const noFamily = await decide({ uniformFamily: false, uniformObjects: 0, associatedToTable: 0, standalone: 0, tablesFound: 8 });
    checks.equal(noFamily.kind, "UNKNOWN", "no uniform family at all means no verdict");

    // Six loose blobs at 0% association look exactly like the symbolic case in
    // ratio terms. They are not evidence of anything.
    const tooFew = await decide({ uniformFamily: true, uniformObjects: 6, associatedToTable: 0, standalone: 6, tablesFound: 1 });
    checks.equal(tooFew.kind, "UNKNOWN", "too few objects is UNKNOWN, not SYMBOLIC");
    checks.ok(tooFew.why.includes(String(api.constants.MIN_OBJECTS)),
      "and names the population it would have needed", tooFew.why);
  }

  // ---- 4. many real tables AND many loose chairs is not a symbolic plan -----
  //
  // A lounge with 60 tables and 70 chairs scattered off them associates
  // poorly, but the tables are really there. The ratio guard is what stops
  // the swap throwing 60 real tables away.
  {
    const r = await decide({ uniformFamily: true, uniformObjects: 80, associatedToTable: 10, standalone: 70, tablesFound: 60 });
    checks.ok(r.kind !== "SYMBOLIC",
      `a plan with as many tables as loose chairs is not flipped (got ${r.kind})`, r);
  }

  // ---- 5. the evidence travels with the verdict -----------------------------
  {
    const r = await decide(symbolic);
    checks.equal(r.evidence.uniformObjects, 143, "the verdict carries the object count it used");
    checks.equal(r.evidence.associatedToTable, 11, "and the association count");
    checks.equal(r.evidence.tablesFound, 10, "and what size-rank had called tables");
    checks.ok(r.thresholds && r.thresholds.SYMBOLIC_MAX_ASSOCIATION > 0,
      "and the thresholds it was judged against", r.thresholds);
    checks.ok(r.why.length > 40, "with a reason an operator could argue with", r.why);
  }

  // ---- 6. the boundaries are where they say they are ------------------------
  {
    const c = api.constants;
    const justPhysical = await decide({ uniformFamily: true, uniformObjects: 100, associatedToTable: Math.ceil(c.PHYSICAL_MIN_ASSOCIATION * 100), standalone: 30, tablesFound: 20 });
    checks.equal(justPhysical.kind, "PHYSICAL", "at the physical threshold it is physical");
    const justSymbolic = await decide({ uniformFamily: true, uniformObjects: 100, associatedToTable: Math.floor(c.SYMBOLIC_MAX_ASSOCIATION * 100), standalone: 75, tablesFound: 10 });
    checks.equal(justSymbolic.kind, "SYMBOLIC", "at the symbolic threshold it is symbolic");
  }
}
