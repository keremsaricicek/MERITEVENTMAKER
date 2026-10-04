// MERIT Event Maker — plan coordinate frames (MeritPlanFrames).
//
// ONE place that says where a number on a plan is measured from. Before this,
// five frames were converted inline wherever they met, and two conventions
// lived side by side in one stored analysis without a name: a candidate's x/y
// is its TOP-LEFT corner, a chair detection's x/y is its CENTRE. Reading one as
// the other moved every chair by half its own size, and a benchmark did exactly
// that for months behind a generous match tolerance (2026-10-04).
//
// The frames, from the document to what the product stores:
//
//   pdf      PDF user space (points, y up, page rotation) — only for PDF plans
//   source   the plan image's own pixels (a PDF page rasterized, or the file)
//   analysis the detection canvas: source scaled so its long side is <= cap
//   deskew   the analysis canvas rotated about its centre by the measured skew,
//            on a larger canvas — what the detector actually reads
//   tile     a window of source or analysis pixels, possibly scaled
//   percent  plan percent of the analysis canvas — what is stored and drawn
//
// A transform is a CHAIN of primitive steps applied in order (translate,
// scale, rotate-about, matrix), each with an exact inverse. A chain rather than
// one pre-multiplied matrix on purpose: each step does its arithmetic in the
// same order the inline code did, so moving a conversion here changes no
// output by even the last bit (gated by benchmarks/detector-fingerprint.mjs),
// and a forward-then-inverse round trip is exact to floating point.
//
// Pure: no DOM, no state. Published once on globalThis.
(function () {
  "use strict";

  // ---- primitive steps ------------------------------------------------------
  const step = {
    translate: (tx, ty) => ({ op: "translate", tx, ty }),
    scale: (sx, sy) => ({ op: "scale", sx, sy: sy == null ? sx : sy }),
    // Rotate by `rad` about (fx, fy) and land the centre on (tx, ty) — the
    // shape of a deskew onto a re-sized canvas.
    rotateAbout: (rad, fx, fy, tx, ty) => ({ op: "rotateAbout", rad, fx, fy, tx: tx == null ? fx : tx, ty: ty == null ? fy : ty }),
    // x' = a x + c y + e ; y' = b x + d y + f  (the PDF / canvas convention)
    matrix: (a, b, c, d, e, f) => ({ op: "matrix", a, b, c, d, e, f }),
  };

  function applyStep(s, x, y) {
    switch (s.op) {
      case "translate": return [x + s.tx, y + s.ty];
      case "scale": return [x * s.sx, y * s.sy];
      case "rotateAbout": {
        // Same order of operations as the deskew code this replaced.
        const ox = x - s.fx, oy = y - s.fy, cos = Math.cos(s.rad), sin = Math.sin(s.rad);
        return [ox * cos - oy * sin + s.tx, ox * sin + oy * cos + s.ty];
      }
      case "matrix": return [s.a * x + s.c * y + s.e, s.b * x + s.d * y + s.f];
      default: throw new Error(`unknown frame step ${s.op}`);
    }
  }

  function invertStep(s) {
    switch (s.op) {
      case "translate": return step.translate(-s.tx, -s.ty);
      case "scale":
        if (!s.sx || !s.sy) throw new Error("a zero scale has no inverse");
        return step.scale(1 / s.sx, 1 / s.sy);
      case "rotateAbout": return step.rotateAbout(-s.rad, s.tx, s.ty, s.fx, s.fy);
      case "matrix": {
        const det = s.a * s.d - s.b * s.c;
        if (!det) throw new Error("a singular matrix has no inverse");
        const a = s.d / det, b = -s.b / det, c = -s.c / det, d = s.a / det;
        return step.matrix(a, b, c, d, -(a * s.e + c * s.f), -(b * s.e + d * s.f));
      }
      default: throw new Error(`unknown frame step ${s.op}`);
    }
  }

  // A transform: named endpoints plus the steps between them. `from`/`to` are
  // labels, checked when two are composed, so "deskew → percent" can never be
  // glued onto "source → analysis" by accident.
  function transform(from, to, steps) {
    const t = { from, to, steps: steps.slice() };
    t.apply = (x, y) => { let p = [x, y]; for (const s of t.steps) p = applyStep(s, p[0], p[1]); return p; };
    t.inverse = () => transform(to, from, t.steps.slice().reverse().map(invertStep));
    // Rotation (degrees) and uniform scale this transform applies to a vector,
    // measured rather than tracked, so a matrix step is covered too.
    t.linear = () => {
      const [x0, y0] = t.apply(0, 0), [x1, y1] = t.apply(1, 0), [x2, y2] = t.apply(0, 1);
      const ux = x1 - x0, uy = y1 - y0, vx = x2 - x0, vy = y2 - y0;
      const sx = Math.hypot(ux, uy), sy = Math.hypot(vx, vy);
      const det = ux * vy - uy * vx;
      return { rotationDeg: Math.atan2(uy, ux) * 180 / Math.PI, sx, sy, mirrored: det < 0,
        uniform: Math.abs(sx - sy) <= 1e-9 * Math.max(sx, sy), sheared: Math.abs(ux * vx + uy * vy) > 1e-9 * sx * sy };
    };
    return t;
  }
  const identity = (frame) => transform(frame, frame, []);

  function compose(...ts) {
    // compose(a, b, c): apply a, then b, then c.
    for (let i = 1; i < ts.length; i++)
      if (ts[i - 1].to !== ts[i].from) throw new Error(`frame mismatch: ${ts[i - 1].to} -> ${ts[i].from}`);
    return transform(ts[0].from, ts[ts.length - 1].to, ts.flatMap(t => t.steps));
  }

  // ---- the frames this product uses ----------------------------------------

  // pdf.js's viewport.transform is [a, b, c, d, e, f] from PDF user space to
  // the raster the page was drawn on, page rotation and the y flip included.
  function pdfToSource(viewportTransform) {
    const [a, b, c, d, e, f] = viewportTransform;
    return transform("pdf", "source", [step.matrix(a, b, c, d, e, f)]);
  }

  // The detection canvas: the source scaled so its long side is at most `cap`
  // (never up). `width`/`height` are rounded the way the canvas is sized, so
  // percent of the analysis canvas and percent of the source differ by that
  // rounding only — under half a source pixel per side.
  function analysisFrame(sourceWidth, sourceHeight, cap) {
    const ratio = Math.min(1, cap / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * ratio));
    const height = Math.max(1, Math.round(sourceHeight * ratio));
    return { ratio, width, height, sourceWidth, sourceHeight,
      sourceToAnalysis: transform("source", "analysis", [step.scale(ratio)]),
      originalWidth: Math.round(width / ratio), originalHeight: Math.round(height / ratio) };
  }

  // Rotating the analysis canvas by the measured skew onto a canvas big enough
  // to hold it. `applyDeg` 0 is the identity, and both directions say so.
  function deskewFrame(width, height, applyDeg) {
    if (!applyDeg) return { applied: false, angleDeg: 0, dw: width, dh: height,
      analysisToDeskew: identity("analysis"), deskewToAnalysis: identity("analysis") };
    const rad = -applyDeg * Math.PI / 180, cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const dw = Math.max(1, Math.round(width * cos + height * sin));
    const dh = Math.max(1, Math.round(width * sin + height * cos));
    const skewRad = applyDeg * Math.PI / 180;
    const deskewToAnalysis = transform("deskew", "analysis", [step.rotateAbout(skewRad, dw / 2, dh / 2, width / 2, height / 2)]);
    return { applied: true, angleDeg: applyDeg, dw, dh, rad, deskewToAnalysis, analysisToDeskew: deskewToAnalysis.inverse() };
  }

  // A window of a frame at (x0, y0), read at `scale` pixels per frame pixel.
  function tileFrame(frame, x0, y0, scale) {
    const s = scale || 1;
    return transform(`${frame}-tile`, frame, [step.scale(1 / s), step.translate(x0, y0)]);
  }

  // ---- percent, and the two box conventions --------------------------------
  // CORNER: a candidate box — x/y is the top-left corner, in percent.
  // CENTRE: a seat inside a candidate — x/y is the centre, in percent.
  // Both carry w/h in percent and rotation in degrees.
  const CORNER = "corner", CENTRE = "centre";

  function boxCentrePx(box, convention, W, H) {
    if (convention === CENTRE) return [box.x / 100 * W, box.y / 100 * H];
    return [(box.x + box.w / 2) / 100 * W, (box.y + box.h / 2) / 100 * H];
  }

  // Re-express a percent box of a (fromW x fromH) frame as a percent box of a
  // (toW x toH) frame through a point transform. Valid for transforms that keep
  // shapes (translation, uniform scale, rotation): the centre moves, w/h keep
  // their pixel size, and rotation shifts by the transform's own rotation.
  // The arithmetic order is the one runAssistedDetection used, kept so a stored
  // analysis is reproduced to the last bit.
  function mapBox(box, convention, t, fromW, fromH, toW, toH, rotationShiftDeg) {
    const [cx, cy] = t.apply(...boxCentrePx(box, convention, fromW, fromH));
    const pw = box.w / 100 * fromW, ph = box.h / 100 * fromH;
    box.w = pw / toW * 100; box.h = ph / toH * 100;
    if (convention === CENTRE) { box.x = cx / toW * 100; box.y = cy / toH * 100; }
    else { box.x = cx / toW * 100 - box.w / 2; box.y = cy / toH * 100 - box.h / 2; }
    if (rotationShiftDeg) box.rotation = ((box.rotation || 0) + rotationShiftDeg) % 360;
    return box;
  }

  // Percent box → pixel box {cx, cy, w, h, rotation} in a W x H frame.
  function percentToPixels(box, convention, W, H) {
    const [cx, cy] = boxCentrePx(box, convention, W, H);
    return { cx, cy, w: box.w / 100 * W, h: box.h / 100 * H, rotation: box.rotation || 0 };
  }
  // Pixel box → percent box in the given convention.
  function pixelsToPercent(px, convention, W, H) {
    const w = px.w / W * 100, h = px.h / H * 100;
    return convention === CENTRE
      ? { x: px.cx / W * 100, y: px.cy / H * 100, w, h, rotation: px.rotation || 0 }
      : { x: px.cx / W * 100 - w / 2, y: px.cy / H * 100 - h / 2, w, h, rotation: px.rotation || 0 };
  }

  // A pixel-space oriented box through any shape-keeping transform: centre
  // mapped, size scaled by the transform's (uniform) scale, rotation shifted
  // by its rotation. A transform that would distort a rotated box (shear or
  // non-uniform scale with a non-zero angle) is refused rather than
  // approximated — the user-visible promise is that rotation is preserved.
  function mapPixelBox(px, t) {
    const lin = t.linear();
    if (lin.sheared || (!lin.uniform && ((px.rotation || 0) % 90 !== 0 || Math.abs(lin.rotationDeg % 90) > 1e-9)))
      throw new Error("this transform does not keep box shapes; map the corners instead");
    const [cx, cy] = t.apply(px.cx, px.cy);
    const turn = lin.rotationDeg, quarter = Math.round(turn / 90) % 2 !== 0;
    const sw = quarter ? lin.sy : lin.sx, sh = quarter ? lin.sx : lin.sy;
    return { cx, cy, w: px.w * sw, h: px.h * sh, rotation: (((px.rotation || 0) + turn) % 360 + 360) % 360 };
  }

  // The four corners of a pixel box, for transforms mapBox must refuse.
  function corners(px) {
    const r = (px.rotation || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), hw = px.w / 2, hh = px.h / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [px.cx + x * c - y * s, px.cy + x * s + y * c]);
  }

  globalThis.MeritPlanFrames = Object.freeze({
    step, transform, identity, compose,
    pdfToSource, analysisFrame, deskewFrame, tileFrame,
    CORNER, CENTRE, mapBox, percentToPixels, pixelsToPercent, mapPixelBox, corners,
  });
})();
