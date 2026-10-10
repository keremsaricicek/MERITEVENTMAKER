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
//   - it does not turn vector paths into tables or chairs. It counts them, so
//     the analysis can say the drawing HAS vector geometry this build does not
//     read, rather than saying nothing;
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

  globalThis.MeritPdfText = Object.freeze({ itemsFromTextContent, vectorSummary, sourceKind, scaledItems, MAX_ITEMS, MAX_CHARS });
})();
