// The column pass must not tip on one object.
//
// MeritPlanVenueObjects.venueScaleObjects admits a family of compact, seatless,
// repeated marks as columns when enough of them share a row AND a column. That
// decision was taken over the family as a whole, so it could hinge on a single
// member (D2 experiment, 2026-10-18, benchmarks/detection/experiments/
// 2026-10-18-d2-tone/): one bare-paper patch turning "seatless" admitted a
// family on the darkened Golden rendering and the column count went 8 -> 25,
// with orange chairs and a real table's interior among them; removing a few
// patches from another rendering's pool left the plant icons printed at the
// centre of 16 square tables as a family of their own, 4 -> 22 columns, and
// seven real tables could no longer be added where a "column" stood.
//
// Three facts, each a case below, built from boxes so it is the rule that is
// tested:
//   - a family that fails when any ONE of its members is removed is not a
//     structural grid; and a member aligned with no other member on either axis
//     is not standing on the grid at all;
//   - a mark inside an object the size of the plan's tables is part of that
//     object (the plant icon on a table), not structure;
//   - a real grid, complete or partly found, stays a grid -- unless it holds
//     only at the line, where one unseen member would undo it (the cost).
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "column-pass-stability",
  tags: ["detection", "intelligence"],
  timeout: 30000,
  viewport: { width: 1000, height: 700 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const out = await page.evaluate(() => {
    const V = globalThis.MeritPlanVenueObjects;
    let n = 0;
    const box = (cx, cy, s) => ({ x: cx - s / 2, y: cy - s / 2, w: s, h: s, fill: 1, source: "fill" });
    const gapTo = (a, b) => Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)))
      + Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
    // the plan's detected tables: 70 px squares far from every case's marks
    const tables = [[1500, 1500], [1600, 1500], [1500, 1600]].map(([cx, cy], index) =>
      ({ box: { index }, obb: { cx, cy, w: 70, h: 70, rotation: 0 } }));
    const columnsOf = (marks, extraSources = []) => {
      const all = [...marks, ...extraSources];
      const r = V.venueScaleObjects({
        chosen: tables, chairAssign: new Map(), surfaceRejectedComps: marks, chairs: [], gapTo,
        sources: [{ name: "fill", labels: null, comps: all, all }],
        venueSizeOk: () => false, analyze: () => {}, uid: p => `${p}_${++n}`,
        toPercentBox: o => ({ x: o.cx - o.w / 2, y: o.cy - o.h / 2, w: o.w, h: o.h }), chairVenues: [],
      });
      return r.columnComps.map(c => [c.x + c.w / 2, c.y + c.h / 2]);
    };
    const at = pts => pts.map(([x, y]) => box(x, y, 40));
    // a 2 x 3 structural grid, as the architecture fixture draws it
    const grid = [[160, 200], [700, 200], [1240, 200], [160, 700], [700, 700], [1240, 700]];
    // three marks that share one row and nothing else, then one more mark that
    // gives the family a column partner: the share reaches exactly 0.5 on both
    // axes only because of it, and the far mark (900, 900) shares nothing
    const three = [[100, 100], [300, 100], [900, 900]];
    const four = [...three, [100, 300]];
    // plant icons: 13 px marks at the centre of 70 px tables on a 3 x 3 grid
    const centres = [];
    for (const x of [300, 450, 600]) for (const y of [300, 450, 600]) centres.push([x, y]);
    const icons = centres.map(([x, y]) => box(x, y, 13));
    const iconTables = centres.map(([x, y]) => box(x, y, 70));
    return {
      grid: columnsOf(at(grid)).length,
      partialGrid: columnsOf(at([grid[0], grid[1], grid[2], grid[3], grid[5]])).length,
      // four of six, with the column share exactly 0.5: it fails the moment any
      // one member is unseen, so it is refused -- the stated cost of the rule
      marginalGrid: columnsOf(at([grid[0], grid[2], grid[4], grid[5]])).length,
      threeAlone: columnsOf(at(three)).length,
      fourWithOne: columnsOf(at(four)),
      icons: columnsOf(icons, iconTables).length,
    };
  });
  checks.equal(out.grid, 6, "a complete 2 x 3 structural grid is six columns");
  checks.equal(out.partialGrid, 5, "a grid found only in part (5 of 6) is still a grid");
  checks.equal(out.marginalGrid, 0, "a family that one unseen member would undo is not admitted (4 of 6 at share 0.5)");
  checks.equal(out.threeAlone, 0, "three marks sharing one row are not a two-axis grid");
  checks.equal(out.fourWithOne, [],
    "one added mark does not turn a family into columns: removing any one member must leave it a grid");
  checks.equal(out.icons, 0, "a mark inside an object the size of the plan's tables is part of it, not a column");
}
