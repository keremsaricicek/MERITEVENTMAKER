// MERIT Event Maker — the drawn extent of a table symbol (MeritSymbolGeometry).
//
// On a plan whose tables are numbered symbols (a ring with a number in it),
// the detector finds each symbol by its FILL: the component inside the ring.
// The ring itself — the line that is the table's edge on the drawing — lies
// outside that box. Measured on ORNEK against the annotation of the drawn
// symbol: detected boxes were 0.93 of the width and 0.88 of the height
// (median), so every committed table came out a size smaller than the
// drawing, and the digital plan's size row could not be met.
//
// outerOutline(raster, box) measures the ring from the pixels: from each side
// of the fill box it walks outward along nine lines across the middle of
// that side, through the ring, and stops where the ring ends. The upper
// quartile of the nine reaches is the drawn edge. Nothing is assumed about the shape
// (a square symbol and a round one are measured the same way), and nothing is
// grown that the drawing does not show: a side with no ink just beyond it
// stays where it was, and no side moves by more than 8% of the box (a ring's
// own thickness), so a ring touching its neighbour is not walked into it.
//
// Pure: no DOM, no state. A raster is {data, width, height} (RGBA); boxes are
// pixels {x0, y0, x1, y1}. Published once on globalThis.
(function () {
  "use strict";
  const INK = 200;

  function outerOutline(raster, box, opts) {
    const o = opts || {};
    const W = raster.width, H = raster.height, d = raster.data;
    const lum = (x, y) => { const p = 4 * (y * W + x); return (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000; };
    // How far past the fill a ring may be looked for: its own thickness, not
    // the gap to the next object. Further than this and the walk is measuring
    // a neighbour.
    const reachShare = o.reach == null ? 0.08 : o.reach;
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    if (!(w > 2 && h > 2)) return null;
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    // Walk from `start` in `step` direction along one line, through the fill,
    // into the ring; the ring ends at the first pixel that is no longer ink.
    // Stopping THERE, not at the next stretch of paper, is what keeps a ring
    // that touches its neighbour (a column, the next table) from being walked
    // straight into it. Null if no ink was crossed.
    // Ink is darker than the line it starts on by a margin, or plainly dark:
    // a one-pixel ring on a downscaled photograph is a grey, not a black.
    const walk = (start, step, len, at) => {
      const base = at(start);
      if (base == null) return null;
      const isInk = (p) => p < INK || p < base - 18;
      let last = null;
      for (let k = 0; k <= len; k++) {
        const v = start + step * k;
        const p = at(v);
        if (p == null) break;
        if (isInk(p)) last = v;
        else if (last != null) break;
      }
      return last;
    };
    // Nine lines across the middle of each side; the side's edge is the upper
    // quartile of their reaches — near the widest line on a round symbol, and
    // not decided by one line that met something else.
    const side = (name) => {
      const reaches = [];
      for (let i = -4; i <= 4; i++) {
        const f = i * 0.05;
        let v;
        if (name === "left" || name === "right") {
          const y = Math.round(cy + f * h);
          if (y < 0 || y >= H) continue;
          const at = (x) => (x >= 0 && x < W ? lum(x, y) : null);
          v = name === "right" ? walk(Math.round(box.x1) - 1, 1, Math.max(3, Math.round(reachShare * w)), at) : walk(Math.round(box.x0), -1, Math.max(3, Math.round(reachShare * w)), at);
        } else {
          const x = Math.round(cx + f * w);
          if (x < 0 || x >= W) continue;
          const at = (y) => (y >= 0 && y < H ? lum(x, y) : null);
          v = name === "bottom" ? walk(Math.round(box.y1) - 1, 1, Math.max(3, Math.round(reachShare * h)), at) : walk(Math.round(box.y0), -1, Math.max(3, Math.round(reachShare * h)), at);
        }
        if (v != null) reaches.push(v);
      }
      if (reaches.length < 3) return null;
      const outward = name === "right" || name === "bottom";
      reaches.sort((a, b) => (outward ? a - b : b - a));
      return reaches[Math.floor(0.75 * (reaches.length - 1))];
    };
    const l = side("left"), r = side("right"), t = side("top"), b = side("bottom");
    const out = {
      x0: l == null ? box.x0 : Math.min(box.x0, l), y0: t == null ? box.y0 : Math.min(box.y0, t),
      x1: r == null ? box.x1 : Math.max(box.x1, r + 1), y1: b == null ? box.y1 : Math.max(box.y1, b + 1),
    };
    out.measuredSides = [l, r, t, b].filter(v => v != null).length;
    return out;
  }

  globalThis.MeritSymbolGeometry = Object.freeze({ outerOutline });
})();
