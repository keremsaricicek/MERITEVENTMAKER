// Which tables are pushed together (src/plan-intel-groups.js,
// buildFurnitureGroups) — the relation rule on its own, without detection.
//
// What this pins:
//   TOUCHING IS ONE UNIT, AN AISLE IS TWO. Tables drawn edge to edge are one
//     dining unit; the same tables with white paper between them (0.35 of a
//     side or more) are separate, however close and however well aligned.
//     Nearness alone never joins two tables.
//   A TURNED ROW IS STILL A ROW. A table carries its unrotated box plus its
//     rotation, as the detector writes it. Tables turned alike are compared
//     along their own axes, so a row pushed together at 30 degrees is one
//     unit and the same row with an aisle is not (36 of 93 turned rows were
//     missed before this rule, benchmarks/relations).
//   ONE UNIT ON BOTH AXES. Plan percent is not square (x is a share of the
//     width, y of the height); a turn is measured after the plan's aspect is
//     applied, and the analysis passes it.
//   UNTURNED TABLES ARE JUDGED EXACTLY AS BEFORE, round symbols of a numbered
//     sheet are never joined, and a person's "separate" answer still splits a
//     group whatever its geometry.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const meta = { name: "relation-groups", tags: ["intelligence", "fast"], timeout: 60000 };

export default async function run({ checks, repoRoot }) {
  let n = 0;
  const ctx = vm.createContext({ uid: (p) => `${p}-${++n}` });
  for (const f of ["src/plan-intel-geometry.js", "src/plan-intel-groups.js"]) vm.runInContext(fs.readFileSync(path.join(repoRoot, f), "utf8"), ctx);
  const G = ctx.MeritPlanIntelGroups;
  checks.require(!!G && typeof G.buildFurnitureGroups === "function", "buildFurnitureGroups loads outside the browser");

  // A square table of side `u` px at (cx, cy) turned `deg`, written the way the
  // detector writes it on a W x H plan.
  const W = 2000, H = 1000, u = 60;
  const table = (id, cx, cy, deg, extra = {}) => {
    let r = ((deg % 90) + 90) % 90; if (r > 45) r -= 90;
    return { id, kind: "table", type: "square", rotation: r, x: (cx - u / 2) / W * 100, y: (cy - u / 2) / H * 100, w: u / W * 100, h: u / H * 100, ...extra };
  };
  // n tables along direction `deg` from (ox, oy), `gap` sides of paper between neighbours
  const row = (prefix, ox, oy, count, deg, gap) => Array.from({ length: count }, (_, i) => {
    const a = deg * Math.PI / 180, t = i * (1 + gap) * u;
    return table(`${prefix}${i}`, ox + Math.cos(a) * t, oy + Math.sin(a) * t, deg);
  });
  const units = (tables, opts) => G.buildFurnitureGroups(tables, [], opts).filter((g) => g.memberIds.length > 1).map((g) => [...g.memberIds].sort().join(","));
  const aspect = { aspect: W / H };

  // ---- straight rows: as before ------------------------------------------------------
  checks.equal(units(row("a", 300, 300, 4, 0, 0), aspect), ["a0,a1,a2,a3"], "four tables pushed together in a straight row are one unit");
  checks.equal(units(row("a", 300, 300, 4, 0, 0)), ["a0,a1,a2,a3"], "an unturned row is joined with or without the plan's aspect (the rule for unturned tables is unchanged)");
  checks.equal(units(row("b", 300, 300, 4, 0, 0.4), aspect), [], "the same four tables with an aisle of 0.4 of a side between them are four tables, not one unit");
  checks.equal(units(row("b", 300, 300, 3, 90, 0.35), aspect), [], "a vertical line of tables with an aisle is not joined either");

  // ---- turned rows ---------------------------------------------------------------------
  for (const deg of [20, 30, 45, 60, -30]) {
    checks.equal(units(row("r", 400, 400, 4, deg, 0), aspect), ["r0,r1,r2,r3"], `a row pushed together turned ${deg} degrees is one unit`);
    checks.equal(units(row("s", 400, 400, 4, deg, 0.4), aspect), [], `the same row turned ${deg} degrees with an aisle is four separate tables`);
  }
  // an L: a turned row and a leg meeting at its last table, edges touching
  const L = (() => {
    const deg = 30, a = deg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a), vx = -Math.sin(a), vy = Math.cos(a);
    const r = row("L", 500, 300, 3, deg, 0);
    const ex = 500 + ux * 2 * u, ey = 300 + uy * 2 * u;
    return [...r, table("L3", ex + vx * u, ey + vy * u, deg), table("L4", ex + vx * 2 * u, ey + vy * 2 * u, deg)];
  })();
  checks.equal(units(L, aspect), ["L0,L1,L2,L3,L4"], "an L-shaped arrangement turned 30 degrees, every edge touching, is one unit");
  // two turned rows facing across an aisle wide enough for both rows' chairs
  const par = (() => {
    const deg = 30, a = deg * Math.PI / 180, vx = -Math.sin(a), vy = Math.cos(a), off = (u + 1.6 * u) / 2;
    return [...row("p", 600 - vx * off, 500 - vy * off, 3, deg, 0), ...row("q", 600 + vx * off, 500 + vy * off, 3, deg, 0)];
  })();
  checks.equal(units(par, aspect).sort(), ["p0,p1,p2", "q0,q1,q2"], "two turned rows facing across an aisle are two units, never one");

  // ---- the aspect is what makes a turn measurable ------------------------------------------
  // Without it the turned row is measured in a frame whose y is stretched 2x;
  // at 45 degrees its tables no longer line up and the row falls apart.
  checks.equal({ withAspect: units(row("r", 400, 400, 4, 45, 0), aspect), without: units(row("r", 400, 400, 4, 45, 0)) },
    { withAspect: ["r0,r1,r2,r3"], without: [] },
    "on a 2:1 plan a row turned 45 degrees is recognised only once the plan's aspect is applied");
  const pi = fs.readFileSync(path.join(repoRoot, "src/plan-intelligence.js"), "utf8");
  checks.ok(/buildFurnitureGroups\([^;]*aspect:\s*analysis\.imageWidth\s*\/\s*analysis\.imageHeight/.test(pi),
    "the analysis passes the plan's own aspect (imageWidth / imageHeight) to the grouping rule");

  // ---- what must not change --------------------------------------------------------------
  const ring = (id, cx) => ({ id, kind: "table", type: "round", symbolFamily: true, rotation: 0, x: (cx - 40) / W * 100, y: 460 / H * 100, w: 80 / W * 100, h: 80 / H * 100 });
  checks.equal(units([ring("o1", 300), ring("o2", 390)], aspect), [], "two round symbols of a numbered sheet are two tables however close they are drawn");
  const turned = row("d", 400, 400, 3, 30, 0);
  const decided = G.buildFurnitureGroups(turned, [{ decision: "separate", memberIds: ["d0", "d1", "d2"] }], aspect).filter((g) => g.memberIds.length > 1);
  checks.equal(decided.length, 0, "a person's \"separate\" answer splits a turned row the geometry would join");
  const kept = G.buildFurnitureGroups(row("k", 300, 300, 2, 0, 0), [], aspect).find((g) => g.memberIds.length === 2);
  checks.ok(kept && /touch and align/.test(kept.reason), "a joined unit still says why: the tables touch and align");
  // turned differently (more than 10 degrees apart): the contact rule as it was
  const mixed = [table("m0", 300, 300, 0), table("m1", 300 + u, 300, 25)];
  checks.equal(units(mixed, aspect), units(mixed.map((t) => ({ ...t, rotation: 0 })), aspect),
    "two tables turned differently are judged by the unturned contact rule, unchanged");
}
