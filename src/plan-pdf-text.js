// MERIT Event Maker — what a PDF plan carries besides its pixels (MeritPdfText).
//
// A plan exported from CAD keeps its words as TEXT OBJECTS: "SAHNE", "BAR",
// "GİRİŞ", a printed capacity line. Those are not read off pixels — the
// document states them, at a position, exactly. A plan that was scanned or
// photographed and wrapped in a PDF carries none: ORNEK.pdf is one JPEG and no
// font (benchmarks/plans/ORNEK-SOURCE.md). This module tells the two apart and
// hands the text objects on, in the pixels of the raster the page was drawn
// on, so the analysis can use them where it now uses OCR lines.
//
// What it does NOT do:
//   - it does not turn vector paths into tables or chairs. It measures them
//     (vectorShapes: rectangles, circles, polygons and lines in raster pixels,
//     transforms and clipping followed) and counts them, so the analysis can
//     say what geometry the drawing HAS without claiming what it IS;
//   - it does not decide what a text object is the number OF. A word inside a
//     table symbol is near the table; which table it numbers is a separate
//     judgement with its own provenance (plan-table-numbers.js), not done here;
//   - it does not trust the text: a PDF's strings are content from whoever made
//     the file. They are kept as strings, capped in length and count, and only
//     ever compared or escaped — never executed or treated as instructions.
//
// Pure: no DOM, no state. Coordinates: pdf.js's textContent items are in PDF
// user space; viewport.transform maps user space to the raster pdf.js drew
// (MeritPlanFrames.pdfToSource), y flip and page rotation included. Published
// once on globalThis.
(function () {
  "use strict";
  const MAX_ITEMS = 5000, MAX_CHARS = 200;

  // Each non-empty text object as {text, score: 1, engine, box} in raster
  // pixels: the axis-aligned box around the object's four corners, from its
  // descent below the baseline to its ascent above it, so a rotated label is
  // still covered.
  function itemsFromTextContent(textContent, viewportTransform, options) {
    const o = options || {};
    const maxItems = o.maxItems || MAX_ITEMS, maxChars = o.maxChars || MAX_CHARS;
    const styles = (textContent && textContent.styles) || {};
    const toRaster = globalThis.MeritPlanFrames.pdfToSource(viewportTransform);
    const items = [];
    let dropped = 0, truncated = false;
    for (const it of (textContent && textContent.items) || []) {
      const raw = typeof it.str === "string" ? it.str : "";
      const text = raw.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "").trim().slice(0, maxChars);
      if (!text) { dropped++; continue; }
      if (items.length >= maxItems) { truncated = true; break; }
      const t = Array.isArray(it.transform) && it.transform.length === 6 ? it.transform.map(Number) : null;
      if (!t || !t.every(Number.isFinite)) { dropped++; continue; }
      const along = Math.hypot(t[0], t[1]), up = Math.hypot(t[2], t[3]);
      if (!(along > 0) || !(up > 0)) { dropped++; continue; }
      const w = Number(it.width) || 0, h = Number(it.height) || up;
      const st = styles[it.fontName] || {};
      const asc = Number.isFinite(st.ascent) && st.ascent > 0 ? st.ascent : 1;
      const desc = Number.isFinite(st.descent) && st.descent < 0 ? st.descent : 0;
      const ux = t[0] / along, uy = t[1] / along, vx = t[2] / up, vy = t[3] / up;
      const corners = [];
      for (const s of [0, w]) for (const v of [desc * h, asc * h])
        corners.push(toRaster.apply(t[4] + ux * s + vx * v, t[5] + uy * s + vy * v));
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      items.push({ text, score: 1, engine: "pdfTextLayer",
        box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
        angle: Math.round(Math.atan2(t[1], t[0]) * 180 / Math.PI) });
    }
    return { items, dropped, truncated };
  }

  // What the page is drawn with, counted from pdf.js's operator list. `OPS` is
  // pdf.js's own operator table, handed in so this module never hard-codes a
  // library's numbering. A path counts only when it is PAINTED (stroked or
  // filled): a scan wrapped in a PDF still builds one path, the clip around
  // its image, and a clip draws nothing. pdf.js 5 carries the painting
  // operator as the first argument of constructPath; older versions emit it
  // as the next operator — both are counted, neither twice.
  function vectorSummary(operatorList, OPS) {
    const fn = (operatorList && operatorList.fnArray) || [], args = (operatorList && operatorList.argsArray) || [];
    if (!OPS) return { paths: null, images: null, text: null };
    const images = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup].filter(v => v != null));
    const paint = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter(v => v != null));
    let paths = 0, img = 0, text = 0;
    for (let i = 0; i < fn.length; i++) {
      const f = fn[i];
      if (f === OPS.constructPath) { const a = args[i]; if (Array.isArray(a) && paint.has(a[0])) paths++; }
      else if (paint.has(f)) paths++;
      else if (images.has(f)) img++;
      else if (f === OPS.showText || f === OPS.showSpacedText) text++;
    }
    return { paths, images: img, text };
  }

  // The painted shapes of a page, in the raster's pixels. Walks the operator
  // list with the graphics-state stack (save / restore / transform), so a
  // shape drawn under a `cm` lands where the page shows it, rotation kept.
  // The clip is followed as the raster box of the clipping path (a rotated
  // clip is approximated by its box): a shape wholly outside it is not
  // visible and is counted as clipped, never returned. Curves are bounded by
  // their control polygon, which is never smaller than the curve.
  // pdf.js 5 hands each path as [paintOp, [Float32Array | null], minMax];
  // the array holds DrawOPS codes: moveTo 0, lineTo 1, curveTo 2,
  // quadraticCurveTo 3, closePath 4. `toRaster` is viewport.transform.
  //
  // What it does NOT do: say what a shape IS. A circle of table size is a
  // circle, not a table; turning shapes into objects needs real CAD plans to
  // be measured against, and none is in the benchmark yet.
  const MAX_SHAPES = 20000;
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  function vectorShapes(operatorList, OPS, toRaster) {
    const fn = (operatorList && operatorList.fnArray) || [], args = (operatorList && operatorList.argsArray) || [];
    const out = { shapes: [], clipped: 0, truncated: false };
    if (!OPS) return { ...out, reasonCode: "NO_OPS" };
    const base = Array.isArray(toRaster) || ArrayBuffer.isView(toRaster) ? Array.from(toRaster).slice(0, 6) : [1, 0, 0, 1, 0, 0];
    const paintKind = (op) => op === OPS.stroke || op === OPS.closeStroke ? "stroke"
      : op === OPS.fill || op === OPS.eoFill ? "fill"
      : [OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(op) ? "both" : null;
    let ctm = [1, 0, 0, 1, 0, 0], clip = null, pendingClip = false;
    const stack = [];
    for (let i = 0; i < fn.length; i++) {
      const f = fn[i], a = args[i];
      if (f === OPS.save) { stack.push({ ctm, clip }); continue; }
      if (f === OPS.restore) { const s = stack.pop(); if (s) { ctm = s.ctm; clip = s.clip; } continue; }
      if (f === OPS.transform) { if (Array.isArray(a) || ArrayBuffer.isView(a)) ctm = mul(ctm, Array.from(a).slice(0, 6)); continue; }
      if (f === OPS.clip || f === OPS.eoClip) { pendingClip = true; continue; }
      if (f !== OPS.constructPath || !Array.isArray(a)) continue;
      const data = Array.isArray(a[1]) ? a[1][0] : null, paint = paintKind(a[0]);
      if (!data || !data.length) { pendingClip = false; continue; }
      const m = mul(base, ctm);
      for (const sub of subpaths(data, m)) {
        if (pendingClip) { clip = clip ? intersect(clip, sub.box) || { x0: 0, y0: 0, x1: 0, y1: 0 } : sub.box; continue; }
        if (!paint) continue;
        let box = sub.box, partly = false;
        if (clip) { const v = intersect(box, clip); if (!v) { out.clipped++; continue; } partly = v.x0 > box.x0 || v.y0 > box.y0 || v.x1 < box.x1 || v.y1 < box.y1; box = v; }
        if (out.shapes.length >= MAX_SHAPES) { out.truncated = true; continue; }
        out.shapes.push({ ...sub, box, paint, ...(partly ? { clippedPart: true } : {}) });
      }
      pendingClip = false;
    }
    return out;
  }
  function intersect(a, b) {
    const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
    return x1 >= x0 && y1 >= y0 ? { x0, y0, x1, y1 } : null;
  }
  // One path's subpaths, each classified from its own geometry in raster
  // pixels: a closed four-sided path with right angles is a RECT (its side
  // lengths and the angle of its first side kept), a closed path of curves is
  // an ELLIPSE (CIRCLE when its box is square within 8%), anything else
  // closed is a POLYGON, and an open path is a LINE.
  function subpaths(data, m) {
    const subs = [];
    let cur = null;
    const start = (x, y) => { cur = { pts: [ap(m, x, y)], ctrl: [], lines: 0, curves: 0, closed: false }; subs.push(cur); };
    for (let k = 0; k < data.length;) {
      const op = data[k++];
      if (op === 0) { start(data[k], data[k + 1]); k += 2; }
      else if (op === 1) { if (!cur) start(data[k], data[k + 1]); else { cur.pts.push(ap(m, data[k], data[k + 1])); cur.lines++; } k += 2; }
      else if (op === 2) { if (!cur) start(data[k + 4], data[k + 5]); else { cur.ctrl.push(ap(m, data[k], data[k + 1]), ap(m, data[k + 2], data[k + 3])); cur.pts.push(ap(m, data[k + 4], data[k + 5])); cur.curves++; } k += 6; }
      else if (op === 3) { if (!cur) start(data[k + 2], data[k + 3]); else { cur.ctrl.push(ap(m, data[k], data[k + 1])); cur.pts.push(ap(m, data[k + 2], data[k + 3])); cur.curves++; } k += 4; }
      else if (op === 4) { if (cur) cur.closed = true; }
      else break;
    }
    const r1 = (v) => Math.round(v * 10) / 10;
    return subs.filter((s) => s.pts.length > 1).map((s) => {
      const all = s.pts.concat(s.ctrl), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
      const box = { x0: r1(Math.min(...xs)), y0: r1(Math.min(...ys)), x1: r1(Math.max(...xs)), y1: r1(Math.max(...ys)) };
      const p = s.pts.slice(), first = p[0], last = p[p.length - 1];
      const closes = s.closed || Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.5;
      if (closes && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.5 && p.length > 1) p.pop();
      const w = box.x1 - box.x0, h = box.y1 - box.y0;
      if (!closes) return { kind: "line", box };
      if (s.curves === 0 && p.length === 4) {
        const side = (i) => [p[(i + 1) % 4][0] - p[i][0], p[(i + 1) % 4][1] - p[i][1]];
        const square = [0, 1, 2, 3].every((i) => { const u = side(i), v = side((i + 1) % 4), d = Math.hypot(...u) * Math.hypot(...v); return d > 0 && Math.abs(u[0] * v[0] + u[1] * v[1]) / d < 0.02; });
        if (square) { const u = side(0), v = side(1);
          return { kind: "rect", box, sides: [r1(Math.hypot(...u)), r1(Math.hypot(...v))], angle: Math.round(Math.atan2(u[1], u[0]) * 1800 / Math.PI) / 10 }; }
      }
      if (s.curves >= 2 && s.lines === 0) return { kind: Math.abs(w - h) <= 0.08 * Math.max(w, h) ? "circle" : "ellipse", box };
      return { kind: "polygon", box };
    });
  }
  // How many of each, for the record kept with the plan (the shapes
  // themselves are not stored: a CAD page can carry tens of thousands).
  function shapeSummary(result) {
    const r = result || {}, counts = { rect: 0, circle: 0, ellipse: 0, polygon: 0, line: 0 };
    for (const sh of r.shapes || []) counts[sh.kind] = (counts[sh.kind] || 0) + 1;
    return { ...counts, clipped: r.clipped || 0, truncated: !!r.truncated };
  }

  // RASTER — drawn with images only; VECTOR — with paths only; MIXED — both
  // (a scan with vector annotations, or CAD with an embedded photo). Text is
  // a separate axis, kept by sourceKind below.
  function contentClass(summary) {
    const s = summary || {};
    if (s.paths == null && s.images == null) return null;
    return (s.paths || 0) > 0 ? ((s.images || 0) > 0 ? "MIXED" : "VECTOR") : (s.images || 0) > 0 ? "RASTER" : "EMPTY";
  }

  // SCAN — an image and nothing else: every word on it must be read off pixels.
  // VECTOR — drawn with paths; TEXT — carries text objects. Both can hold.
  function sourceKind(summary, textItems) {
    const s = summary || {}, n = textItems || 0;
    const vector = (s.paths || 0) > 0, text = n > 0;
    if (!vector && !text) return s.images ? "SCAN" : "EMPTY";
    return vector && text ? "VECTOR_WITH_TEXT" : vector ? "VECTOR" : "TEXT_ONLY";
  }

  // The text objects in another raster's pixels (the plan the analysis looks
  // at may be the same raster resized): one scale per axis, nothing else.
  // What is stored came from a file and may come back from a backup or a
  // package, so it is rebuilt field by field here: a string, four finite
  // numbers, the same caps as on the way in — anything else is not text.
  function scaledItems(source, width, height) {
    if (!source || !source.text || !Array.isArray(source.text.items) || !(source.width > 0) || !(source.height > 0)) return [];
    const sx = width / source.width, sy = height / source.height, out = [];
    for (const it of source.text.items.slice(0, MAX_ITEMS)) {
      const b = it && it.box, text = it && typeof it.text === "string" ? it.text.slice(0, MAX_CHARS) : "";
      if (!text.trim() || !b || ![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)) continue;
      out.push({ text, score: 1, engine: "pdfTextLayer", box: { x0: b.x0 * sx, y0: b.y0 * sy, x1: b.x1 * sx, y1: b.y1 * sy } });
    }
    return out;
  }

  globalThis.MeritPdfText = Object.freeze({ itemsFromTextContent, vectorSummary, vectorShapes, shapeSummary, contentClass, sourceKind, scaledItems, MAX_ITEMS, MAX_CHARS, MAX_SHAPES });
})();
