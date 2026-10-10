// Box relations between detected candidates: bounds, the gap between two, whether two line up, whether one holds another's centre.
//
// Part of Plan Intelligence, split out of src/plan-intelligence.js on 2026-10-04
// (technical gaps, item 2) and moved verbatim: the only edits are references to
// a name another part owns, which now go through that part's object. Nothing
// here is a trained model; every number is computed from real geometry or OCR.
(() => {
  "use strict";

  function bbox(c) { return { x1: c.x, y1: c.y, x2: c.x + c.w, y2: c.y + c.h, cx: c.x + c.w / 2, cy: c.y + c.h / 2 }; }
  function gapBetween(a, b) {
    const A = bbox(a), B = bbox(b);
    const dx = Math.max(A.x1 - B.x2, B.x1 - A.x2, 0);
    const dy = Math.max(A.y1 - B.y2, B.y1 - A.y2, 0);
    return Math.hypot(dx, dy);
  }
  function aligned(a, b) {
    const A = bbox(a), B = bbox(b);
    const tolY = Math.min(a.h, b.h) * 0.35, tolX = Math.min(a.w, b.w) * 0.35;
    return Math.abs(A.cy - B.cy) <= tolY || Math.abs(A.cx - B.cx) <= tolX;
  }

  function containsCentre(outer, inner) {
    const cx = inner.x + inner.w / 2, cy = inner.y + inner.h / 2;
    return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h;
  }

  globalThis.MeritPlanIntelGeometry = Object.freeze({ aligned, containsCentre, gapBetween });
})();
