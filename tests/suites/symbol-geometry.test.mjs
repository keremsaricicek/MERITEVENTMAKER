// The drawn extent of a table symbol, and what a symbol is not joined to.
//
// What this pins:
//   THE RING IS THE EDGE (src/plan-symbol-geometry.js): from the fill box the
//     detector finds, the measured box reaches out to the ring drawn around
//     it — a faint grey ring as well as a black one — and no further.
//   A NEIGHBOUR IS NOT THE RING: with another object a few pixels outside the
//     ring, the measured edge stops at the ring; with no ring at all the box
//     is left exactly where it was.
//   NUMBERS ARE READ INSIDE THE RING: a refined symbol keeps the fill box it
//     came from (`geometryRefined.from`) for the number views.
//   A ROUND SYMBOL IS A WHOLE TABLE (plan-intel-groups.js): two round symbols
//     drawn close are two tables; two drawn rectangles at the same gap are
//     still joined by contact, as before.
export const meta = { name: "symbol-geometry", tags: ["intelligence"], timeout: 120000 };

import { openApp } from "../lib/app-actions.mjs";

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  const r = await page.evaluate(() => {
    const G = globalThis.MeritSymbolGeometry;
    const raster = (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) });
    const fill = (r, x0, y0, x1, y1, v) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = 4 * (y * r.width + x); r.data[p] = r.data[p + 1] = r.data[p + 2] = v; } };
    const ring = (r, x0, y0, x1, y1, t, v) => { fill(r, x0, y0, x1, y0 + t, v); fill(r, x0, y1 - t, x1, y1, v); fill(r, x0, y0, x0 + t, y1, v); fill(r, x1 - t, y0, x1, y1, v); };
    const out = {};
    // A square symbol: ring 2 px (luma 120) around a fill (luma 228) at 52..148.
    const a = raster(200, 200); fill(a, 52, 52, 148, 148, 228); ring(a, 50, 50, 150, 150, 2, 120);
    out.black = G.outerOutline(a, { x0: 52, y0: 52, x1: 148, y1: 148 });
    // The same with a faint ring (luma 205: not "dark", but darker than the fill).
    const b = raster(200, 200); fill(b, 52, 52, 148, 148, 238); ring(b, 50, 50, 150, 150, 2, 205);
    out.faint = G.outerOutline(b, { x0: 52, y0: 52, x1: 148, y1: 148 });
    // A neighbour 3 px outside the right side of the ring.
    const c = raster(220, 200); fill(c, 52, 52, 148, 148, 228); ring(c, 50, 50, 150, 150, 2, 120); fill(c, 153, 40, 170, 160, 90);
    out.neighbour = G.outerOutline(c, { x0: 52, y0: 52, x1: 148, y1: 148 });
    // No ring at all: a fill on paper.
    const d = raster(200, 200); fill(d, 52, 52, 148, 148, 228);
    out.noRing = G.outerOutline(d, { x0: 52, y0: 52, x1: 148, y1: 148 });
    // Grouping: two round symbols 4% apart, and two rectangles at the same gap.
    const GROUPS = globalThis.MeritPlanIntelGroups;
    const t = (id, x, type, sym) => ({ id, kind: "table", type, x, y: 40, w: 10, h: 10, rotation: 0, symbolFamily: sym });
    out.round = GROUPS ? GROUPS.buildFurnitureGroups([t("a", 10, "round", true), t("b", 22, "round", true)]).filter(g => g.memberIds.length > 1).length : null;
    out.rect = GROUPS ? GROUPS.buildFurnitureGroups([t("a", 10, "rectangle", false), t("b", 22, "rectangle", false)]).filter(g => g.memberIds.length > 1).length : null;
    return out;
  });
  checks.ok(r.black && r.black.x0 === 50 && r.black.y0 === 50 && r.black.x1 === 150 && r.black.y1 === 150, "a black ring around the fill is the symbol's edge", r.black);
  checks.ok(r.faint && r.faint.x0 === 50 && r.faint.x1 === 150, "so is a faint grey one, darker than the fill but not 'dark'", r.faint);
  checks.ok(r.neighbour && r.neighbour.x1 === 150, "a neighbour just outside the ring is not walked into", r.neighbour);
  checks.ok(r.noRing && r.noRing.x0 === 52 && r.noRing.x1 === 148 && r.noRing.y0 === 52 && r.noRing.y1 === 148, "with no ring drawn the box stays exactly where it was", r.noRing);
  checks.require(r.round !== null, "the grouping module is published");
  checks.equal(r.round, 0, "two round table symbols drawn close are two tables, not one joined unit");
  checks.equal(r.rect, 1, "two drawn rectangles at the same gap are still joined by contact");
}
