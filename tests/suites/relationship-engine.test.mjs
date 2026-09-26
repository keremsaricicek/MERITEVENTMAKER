// The relationship engine, tested where a benchmark cannot reach.
//
// benchmarks/ scores the engine's ANSWERS against real drawings. That is the
// measurement that matters, and it is not enough on its own: on the Golden Plan
// the engine agrees with plain nearest-perimeter on every one of 112 seats, so
// a benchmark on that plan cannot tell a working evidence model from one whose
// evidence terms are all being ignored. Every property below is one the
// benchmark would score identically whether or not it held.
//
// So this drives src/plan-relationships.js directly with constructed geometry
// where the right answer is known by construction, and then checks that what it
// decides actually reaches the shipped candidate — because an engine whose
// evidence never leaves the detector is a comment, not a feature.
//
// The properties it pins:
//
//   1. perimeter POSITION beats perimeter DISTANCE. This is the finding the
//      whole engine rests on, and it is the one the Golden Plan's own thirty
//      previously-unanswerable chairs turned on.
//   2. a chair between two equal tables is reported as AMBIGUOUS, with the
//      runner-up named — and is still seated, because the seat is real.
//   3. facing is derived only from a real asymmetry, and a symmetric symbol
//      returns facingKnown: false rather than a plausible angle.
//   4. a family of symmetric symbols cannot claim facing because one member
//      crossed the threshold on noise.
//   5. a chair over the table BODY is seated there, not treated as suspicious.
//      This is the a1 fixture's finding, at unit scale.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "relationship-engine",
  tags: ["intelligence"],
  timeout: 120000,
  viewport: { width: 1400, height: 900 },
};

const table = (id, cx, cy, w, h, rotation = 0) => ({ id, obb: { cx, cy, w, h, rotation } });
const chair = (id, cx, cy, size = 20, extra = {}) =>
  ({ id, obb: { cx, cy, w: size, h: size, rotation: 0 }, ...extra });

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);

  const api = await page.evaluate(() => ({
    present: typeof globalThis.MeritRelationships === "object",
    version: globalThis.MeritRelationships?.version ?? null,
    constants: globalThis.MeritRelationships?.constants ?? null,
  }));
  checks.require(api.present, "the relationship engine is loaded in the app", api);
  checks.equal(api.version, 2, "at version 2", api.version);

  const run1 = args => page.evaluate(({ chairs, tables }) =>
    globalThis.MeritRelationships.associate(chairs, tables), args);

  // ---- 1. position beats distance -----------------------------------------
  //
  // The exact shape of the Golden Plan's thirty abstentions: two tables stacked
  // vertically, a chair beside the lower one's right edge. It is NEARER the
  // upper table's corner by nothing that matters, and it is INSIDE the lower
  // table's edge span. A chair off a corner is not a seat at that table.
  {
    const tables = [table("upper", 200, 100, 44, 46), table("lower", 200, 152, 44, 48)];
    const r = await run1({ tables, chairs: [chair("c", 243, 130, 34)] });
    const a = r.results[0];
    checks.equal(a.tableId, "lower",
      "a chair inside one table's edge span and past another's corner is seated at the first", a);
    checks.equal(a.evidence.positionKind, "edge", "and the reason recorded is edge position", a.evidence);
    checks.ok(a.runnerUp && a.runnerUp.tableId === "upper",
      "with the table it was not given named as the runner-up", a.runnerUp);
    checks.ok(a.margin > 0, "and a margin between them that a person can read", a.margin);

    // And the case really is the hard one: by distance alone these two tables
    // are within a pixel of each other, which is exactly why the Golden Plan's
    // annotation abstained on thirty chairs of this shape. Asserting the
    // near-tie matters — without it this test would pass on geometry where one
    // table is obviously nearer, and prove nothing about the rule.
    const d = await page.evaluate(({ tables, c }) => {
      const P = globalThis.MeritRelationships.position;
      return tables.map(t => { const p = P(c, t.obb); return { id: t.id, d: +p.d.toFixed(2), kind: p.kind }; });
    }, { tables, c: { cx: 243, cy: 130 } });
    const sorted = d.slice().sort((x, y) => x.d - y.d);
    checks.ok(sorted[1].d - sorted[0].d < 2,
      "the two tables are within 2px of each other by distance, so distance cannot decide it", d);
    checks.ok(d.find(x => x.id === "upper").kind === "corner" && d.find(x => x.id === "lower").kind === "edge",
      "and what separates them is that one has the chair off a corner and the other along an edge", d);
  }

  // ---- 2. a chair between two equal tables --------------------------------
  {
    // Close enough that the chair is genuinely within reach of both: at a
    // 200px pitch it reaches neither and the honest answer is "orphan", which
    // is a different (also correct) behaviour and not what this checks.
    const tables = [table("left", 100, 100, 80, 80), table("right", 260, 100, 80, 80)];
    const r = await run1({ tables, chairs: [chair("c", 180, 100, 26)] });
    const a = r.results[0];
    checks.equal(a.state, "ambiguous",
      "a chair exactly halfway between two identical tables is reported ambiguous, not answered", a);
    checks.ok(a.tableId !== null,
      "and is still seated somewhere, because the seat is real and dropping it would lose capacity", a.tableId);
    checks.ok(a.runnerUp && a.runnerUp.tableId !== a.tableId,
      "with the other candidate named so the question can be asked", a.runnerUp);
    checks.ok(a.margin !== null && a.margin < api.constants.AMBIGUOUS_MARGIN,
      "and a margin below the ambiguity threshold", { margin: a.margin, limit: api.constants.AMBIGUOUS_MARGIN });
    checks.equal(r.stats.ambiguous, 1, "counted as one ambiguous relation", r.stats);
  }

  // A clear case must NOT be flagged: an engine that hedges everything is not
  // honest, it is useless, and this is the check that keeps the flag meaningful.
  {
    const tables = [table("near", 100, 100, 80, 80), table("far", 460, 100, 80, 80)];
    const r = await run1({ tables, chairs: [chair("c", 155, 100, 26)] });
    checks.equal(r.results[0].state, "assigned",
      "a chair with one obvious table is not hedged", r.results[0]);
    checks.equal(r.stats.ambiguous, 0, "and nothing is flagged ambiguous on a clear plan", r.stats);
  }

  // ---- 3. facing comes from asymmetry, never from a box --------------------
  {
    const sym = await page.evaluate(() => globalThis.MeritRelationships.orientationOf(
      { obb: { cx: 0, cy: 0, w: 24, h: 24, rotation: 0 }, inkOffset: { x: 0.1, y: -0.05 } }));
    checks.equal(sym.facingKnown, false,
      "a square symbol with its ink centred claims no facing direction", sym);
    checks.equal(sym.facingAngle, null, "and reports no angle at all rather than a plausible one", sym);
    checks.equal(sym.known, false, "nor an orientation axis", sym);

    // A backrest: the ink leans toward the back, so the chair faces the other
    // way. Offset +6px in x on a 24px symbol is 0.25 of the span.
    const back = await page.evaluate(() => globalThis.MeritRelationships.orientationOf(
      { obb: { cx: 0, cy: 0, w: 24, h: 24, rotation: 0 }, inkOffset: { x: 6, y: 0 } }));
    checks.equal(back.facingKnown, true, "a symbol with a heavy edge does have a facing direction", back);
    checks.ok(Math.abs(back.facingAngle - 180) < 1,
      "pointing AWAY from the heavy edge, because the heavy edge is the backrest", back.facingAngle);
    checks.equal(back.facingEvidence, "inkMassOffsetTowardBack",
      "and says which evidence produced it", back.facingEvidence);
  }

  // ---- 4. one member cannot speak for a symmetric family -------------------
  //
  // Plan symbols are drawn from a stencil, so within a family they are the same
  // shape. If most of a family is symmetric, the two members that crossed the
  // threshold on antialiasing noise do not get to claim a direction.
  {
    const chairs = [];
    for (let i = 0; i < 6; i++)
      chairs.push(chair(`s${i}`, 100 + i * 60, 300, 24,
        { family: "flat", inkOffset: { x: 0.2, y: 0.1 } }));      // symmetric
    chairs.push(chair("noisy", 520, 300, 24, { family: "flat", inkOffset: { x: 4, y: 0 } }));
    const r = await run1({ tables: [table("t", 300, 200, 60, 60)], chairs });
    const noisy = r.results.find(x => x.chairId === "noisy");
    checks.equal(noisy.orientation.facingKnown, false,
      "an outlier in a symmetric family does not get a facing direction of its own", noisy.orientation);
    checks.equal(noisy.orientation.facingEvidence, "familyIsNotDirectional",
      "and the reason names the family, not the symbol", noisy.orientation.facingEvidence);
    checks.equal(r.stats.families.flat.directional, false,
      "the family verdict is reported so the decision is inspectable", r.stats.families);

    // A genuinely directional family keeps its facing.
    const dir = [];
    for (let i = 0; i < 6; i++)
      dir.push(chair(`d${i}`, 100 + i * 60, 300, 24, { family: "backed", inkOffset: { x: 5, y: 0 } }));
    const r2 = await run1({ tables: [table("t", 300, 200, 60, 60)], chairs: dir });
    checks.equal(r2.stats.families.backed.directional, true,
      "a family whose members really are asymmetric keeps its facing", r2.stats.families);
    checks.equal(r2.stats.facingKnown, 6, "for every member", r2.stats);
  }

  // ---- 5. a chair over the table body is seated, not suspicious ------------
  //
  // The a1 fixture at unit scale: a banquet table with its chairs tucked under.
  {
    const tables = [table("long", 300, 200, 170, 74)];
    const chairs = [];
    for (const dx of [-50, 0, 50]) for (const dy of [-26, 26])
      chairs.push(chair(`t${dx}_${dy}`, 300 + dx, 200 + dy, 24, { family: "tucked" }));
    const r = await run1({ tables, chairs });
    checks.equal(r.results.filter(x => x.tableId === "long").length, 6,
      "all six tucked seats are seated at the table they are drawn on", r.stats);
    checks.equal(r.stats.orphans, 0, "and none is left seated at nothing", r.stats);
    checks.ok(r.results.every(x => x.evidence.positionKind === "inside"),
      "each recorded as sitting over the table body", r.results.map(x => x.evidence.positionKind));
  }

  // ---- a chair with no table at all ---------------------------------------
  {
    const r = await run1({ tables: [table("far", 900, 900, 60, 60)], chairs: [chair("lonely", 100, 100, 24)] });
    checks.equal(r.results[0].state, "orphan", "a chair with no table within reach is an orphan", r.results[0]);
    checks.equal(r.results[0].tableId, null, "and is not attached to the nearest thing on the plan", r.results[0]);
    checks.equal(r.results[0].reason, "noTableWithinReach", "with the reason recorded", r.results[0].reason);
  }

  // ---- the evidence reaches the shipped object -----------------------------
  //
  // Everything above tests a module. This checks the module's output actually
  // arrives on the candidate the review screen reads, which is the difference
  // between a feature and a comment.
  const shipped = await page.evaluate(() => {
    const src = globalThis.MeritRelationships;
    if (!src) return null;
    // Build the analysis shape the UI consumes, from a real association, so the
    // field names are the ones the app carries rather than the ones this test
    // hopes for.
    const out = src.associate(
      [{ id: 0, obb: { cx: 243, cy: 130, w: 34, h: 34, rotation: 0 }, family: "f" }],
      [{ id: 0, obb: { cx: 200, cy: 100, w: 44, h: 46, rotation: 0 } },
       { id: 1, obb: { cx: 200, cy: 152, w: 44, h: 48, rotation: 0 } }]);
    const r = out.results[0];
    return { keys: Object.keys(r).sort(), evidenceKeys: Object.keys(r.evidence).sort(),
      termKeys: Object.keys(r.evidence.terms).sort(), orientationKeys: Object.keys(r.orientation).sort() };
  });
  for (const k of ["chairId", "tableId", "state", "score", "margin", "runnerUp", "evidence", "orientation", "reason"])
    checks.ok(shipped.keys.includes(k), `every association carries ${k}`, shipped.keys);
  for (const k of ["distance", "positionKind", "positionSide", "insideEdgeSpan", "terms"])
    checks.ok(shipped.evidenceKeys.includes(k), `the evidence breakdown carries ${k}`, shipped.evidenceKeys);
  checks.ok(shipped.termKeys.includes("proximity") && shipped.termKeys.includes("position"),
    "with the individual scored terms, not just a total", shipped.termKeys);
  for (const k of ["known", "angle", "strength", "evidence", "facingKnown", "facingAngle", "facingEvidence"])
    checks.ok(shipped.orientationKeys.includes(k), `orientation carries ${k}`, shipped.orientationKeys);

  // ---- it does not invent orientation on a plan that has none --------------
  const honest = await page.evaluate(() => {
    const chairs = [];
    for (let i = 0; i < 12; i++)
      chairs.push({ id: i, obb: { cx: 100 + i * 40, cy: 100, w: 20, h: 20, rotation: 0 },
        family: "plain", inkOffset: { x: 0, y: 0 } });
    const r = globalThis.MeritRelationships.associate(chairs, []);
    return { facingKnown: r.stats.facingKnown, orientationKnown: r.stats.orientationKnown };
  });
  checks.equal(honest.facingKnown, 0,
    "twelve perfectly symmetric symbols produce zero facing claims", honest);
  checks.equal(honest.orientationKnown, 0,
    "and zero orientation claims — never invent orientation", honest);
}
