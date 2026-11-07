// MERIT Event Maker — objects from a vector PDF's own geometry
// (MeritPlanVectorObjects). Pure: shapes in, proposals out.
//
// A plan exported from CAD states its furniture as drawing commands: a
// circle IS a circle, with an exact centre and radius, and no pixel has to be
// interpreted. src/plan-pdf-text.js already extracts those shapes (rectangles
// with their rotation, circles, ellipses, polygons) in raster pixels. This
// module turns them into object proposals by the rule a person uses on a CAD
// sheet: furniture is what REPEATS.
//   · Closed shapes of a furniture size are grouped by kind and size (10 %
//     bins). A group of at least `minRepeat` is a repeated symbol.
//   · The table group is the repeated group whose members have another
//     repeated, smaller group arranged around them (chairs), or that carry a
//     printed number inside, or, failing both, the largest repeated group of
//     circles.
//   · The chair group is the smaller repeated group whose members sit at a
//     table's edge.
// What it returns are proposals with their reason. They are fused like any
// other source (added where nothing was proposed, never replacing), and a
// proposal is never a printed number.
//
// Measured only on generated vector PDFs so far; no real CAD PDF exists in the
// repository (benchmarks/plan-understanding/NEW-VENUES.md). That validation
// stays open.
(function () {
  "use strict";

  const DEFAULTS = { minRepeat: 4, minSideP: 0.004, maxSideP: 0.09, bin: 0.1, chairReach: 1.6 };

  function centre(s) { const b = s.box; return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, w: Math.abs(b.x1 - b.x0), h: Math.abs(b.y1 - b.y0) }; }

  function propose(shapes, frame, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const W = frame.width, H = frame.height, minS = o.minSideP * W, maxS = o.maxSideP * W;
    const closed = (shapes || []).filter(s => s && s.box && s.kind !== "line").map(s => {
      const c = centre(s);
      // a rotated rectangle's own sides, not its axis-aligned box
      const w = s.kind === "rect" && s.sides ? s.sides[0] : c.w, h = s.kind === "rect" && s.sides ? s.sides[1] : c.h;
      return { kind: s.kind === "ellipse" ? "circle" : s.kind, cx: c.cx, cy: c.cy, w, h, angle: s.angle || 0 };
    }).filter(s => Math.min(s.w, s.h) >= minS && Math.max(s.w, s.h) <= maxS);
    // group by kind and size bin (orientation-free: short side, long side)
    const key = s => s.kind + ":" + Math.round(Math.log(Math.max(1, Math.min(s.w, s.h))) / Math.log(1 + o.bin)) + ":" + Math.round(Math.log(Math.max(1, Math.max(s.w, s.h))) / Math.log(1 + o.bin));
    const groups = new Map();
    for (const s of closed) { const k = key(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    // the same physical symbol drawn twice (fill + stroke) is one object
    for (const [k, g] of groups) {
      const kept = [];
      for (const s of g) if (!kept.some(t => Math.hypot(t.cx - s.cx, t.cy - s.cy) < 0.2 * Math.max(s.w, s.h))) kept.push(s);
      groups.set(k, kept);
    }
    const repeated = [...groups.values()].filter(g => g.length >= o.minRepeat);
    const size = g => g.reduce((a, s) => a + Math.max(s.w, s.h), 0) / g.length;
    const numbers = (frame.texts || []).filter(t => /^\d{1,4}$/.test(String(t.text).trim()));
    const hasNumber = s => numbers.some(t => t.cx >= s.cx - s.w / 2 && t.cx <= s.cx + s.w / 2 && t.cy >= s.cy - s.h / 2 && t.cy <= s.cy + s.h / 2);
    const atEdge = (c, t) => {
      const gx = Math.max(0, Math.abs(c.cx - t.cx) - t.w / 2), gy = Math.max(0, Math.abs(c.cy - t.cy) - t.h / 2);
      return Math.hypot(gx, gy) <= o.chairReach * Math.max(c.w, c.h);
    };
    let best = null;
    for (const g of repeated) {
      const smaller = repeated.filter(h => h !== g && size(h) < 0.8 * size(g));
      const ringed = smaller.map(h => ({ h, share: h.filter(c => g.some(t => atEdge(c, t))).length / h.length })).filter(x => x.share >= 0.6);
      const numbered = g.filter(hasNumber).length / g.length;
      const score = (ringed.length ? 2 : 0) + (numbered >= 0.5 ? 2 : 0) + (g[0].kind === "circle" ? 0.5 : 0) + Math.min(1, g.length / 40);
      const reason = ringed.length ? "ringedBySmallerRepeatedShapes" : numbered >= 0.5 ? "carriesPrintedNumbers" : "largestRepeatedGroup";
      if (!best || score > best.score) best = { g, ringed, score, reason, numbered };
    }
    const out = { tables: [], chairs: [], reason: best ? best.reason : "noRepeatedFurnitureShapes", groups: repeated.length };
    if (!best) return out;
    for (const s of best.g) out.tables.push({ cls: s.kind === "circle" ? "table_round" : "table_rect", cx: s.cx, cy: s.cy, w: s.w, h: s.h, angle: s.angle, source: "pdf-vector", reason: best.reason });
    for (const { h } of best.ringed) for (const c of h) if (best.g.some(t => atEdge(c, t)))
      out.chairs.push({ cls: "chair", cx: c.cx, cy: c.cy, w: c.w, h: c.h, angle: c.angle, source: "pdf-vector", reason: "atTableEdge" });
    return out;
  }

  globalThis.MeritPlanVectorObjects = Object.freeze({ propose, DEFAULTS });
})();
