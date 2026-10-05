// MERIT Event Maker — venue elements the drawing names (MeritVenueElements).
//
// A stage, a bar or an entrance is the one kind of object a floor plan TELLS
// you about: it prints SAHNE on the stage, BAR on the counter, GİRİŞ at the
// door. The OCR model (src/plan-ocr-paddle.js) reads those words with their
// boxes on the whole plan in one pass; this module turns a word into an
// element, and says how much of the element it actually measured.
//
// Three rules hold here.
//
//   THE WORD DECIDES THE TYPE, THE DRAWING DECIDES THE EXTENT. A label says
//   what is there. Where the element ends is measured from the pixels: the
//   closed area the label sits in (`regionAround`). When that area is not
//   closed — the flood reaches the plan's edge or spreads past a share of the
//   page, as a bar open to the room does — the extent is NOT measured, the
//   element is the label's own box, and `geometryBasis` says "label" so nobody
//   reads it as a measurement.
//
//   ONE ELEMENT, ONE OBJECT. Pieces of a stage the detector already found (its
//   truss band, typed stage from its own printed label) that touch the measured
//   area are the same stage: they are joined into it, never offered beside it.
//
//   A WORD IS A WHOLE WORD. "LOCA1" in a legend is not "LOCA", and "BAR" inside
//   "BARBEKÜ" is not a bar: the folded text of a reading must BE the term.
//
// Plan text is untrusted data: it is matched against a fixed vocabulary and
// never executed, interpolated into markup or passed on as an instruction.
//
// Pure: no DOM, no state. A raster is {data, width, height} (RGBA). Published
// once on globalThis.
(function () {
  "use strict";

  // Turkish and English, folded (see fold): what each element is called.
  // Loca titles are recognised here but placed by the loca family, not as a
  // label element — the title names a strip of boxes, not one object.
  const VOCABULARY = Object.freeze([
    { type: "stage", terms: ["SAHNE", "STAGE", "PODYUM", "PODIUM"] },
    { type: "bar", terms: ["BAR"] },
    { type: "entrance", terms: ["GIRIS", "GIRISKAPISI", "ENTRANCE", "ENTRY", "ANAGIRIS"] },
    { type: "exit", terms: ["CIKIS", "EXIT", "ACILCIKIS", "EMERGENCYEXIT", "YANGINCIKISI"] },
    { type: "locaTitle", terms: ["LOCA", "LOCALAR", "LOCAS", "LOJ", "LOJLAR"] },
  ]);
  const ELEMENT_TYPES = new Set(["stage", "bar", "entrance", "exit"]);

  // Upper case without diacritics or separators: "Giriş" -> "GIRIS",
  // "GİRİŞ KAPISI" -> "GIRISKAPISI".
  function fold(text) {
    return String(text || "").normalize("NFKC")
      .replace(/[iİı]/g, "I").replace(/[şŞ]/g, "S").replace(/[ğĞ]/g, "G").replace(/[çÇ]/g, "C").replace(/[öÖ]/g, "O").replace(/[üÜ]/g, "U")
      .toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  // The readings that name an element: [{type, term, text, score, box}] with
  // the box in the SAME pixels as the items (the caller says which).
  function anchorsFrom(items, minScore) {
    const floor = minScore == null ? 0.9 : minScore;
    const out = [];
    for (const it of items || []) {
      if (!it || !it.box || !(it.score >= floor)) continue;
      const f = fold(it.text);
      if (!f) continue;
      for (const v of VOCABULARY) {
        const term = v.terms.find(t => t === f);
        if (term) { out.push({ type: v.type, term, text: String(it.text), score: it.score, box: { ...it.box }, engine: it.engine || null }); break; }
      }
    }
    return out;
  }

  // ---- the closed area a label sits in -----------------------------------------
  //
  // Flood from just outside the label over pixels the colour of the paper
  // around it. The label's own glyphs are holes, never walls. Returns the
  // area's box, or null when the area is not closed: it reached the plan's edge,
  // or grew past `maxShare` of the page (a stage is a few percent of a plan; a
  // flood that takes a tenth of it has found the room, not the element).
  function regionAround(raster, box, opts) {
    const o = opts || {};
    const W = raster.width, H = raster.height, d = raster.data;
    const maxShare = o.maxShare == null ? 0.12 : o.maxShare, tol = o.tolerance == null ? 24 : o.tolerance;
    const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
    const x1 = Math.min(W - 1, Math.ceil(box.x1)), y1 = Math.min(H - 1, Math.ceil(box.y1));
    const ring = [];
    const pad = 3;
    for (let x = x0 - pad; x <= x1 + pad; x++) for (const y of [y0 - pad, y1 + pad]) if (x >= 0 && x < W && y >= 0 && y < H) ring.push(y * W + x);
    for (let y = y0 - pad; y <= y1 + pad; y++) for (const x of [x0 - pad, x1 + pad]) if (x >= 0 && x < W && y >= 0 && y < H) ring.push(y * W + x);
    if (!ring.length) return null;
    // The paper: the median colour of the ring.
    const med = (k) => { const v = ring.map(i => d[4 * i + k]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const paper = [med(0), med(1), med(2)];
    const isPaper = (i) => Math.abs(d[4 * i] - paper[0]) <= tol && Math.abs(d[4 * i + 1] - paper[1]) <= tol && Math.abs(d[4 * i + 2] - paper[2]) <= tol;
    const seen = new Uint8Array(W * H), cap = Math.floor(maxShare * W * H);
    const stack = [];
    for (const i of ring) if (!seen[i] && isPaper(i)) { seen[i] = 1; stack.push(i); }
    // The label's own box is part of the area (its glyphs are not walls).
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) seen[y * W + x] = 1;
    let n = 0, minX = x0, minY = y0, maxX = x1, maxY = y1, edge = false;
    while (stack.length) {
      const i = stack.pop(); n++;
      if (n > cap) return null;
      const x = i % W, y = (i - x) / W;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      if (x > 0 && !seen[i - 1] && isPaper(i - 1)) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < W - 1 && !seen[i + 1] && isPaper(i + 1)) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !seen[i - W] && isPaper(i - W)) { seen[i - W] = 1; stack.push(i - W); }
      if (y < H - 1 && !seen[i + W] && isPaper(i + W)) { seen[i + W] = 1; stack.push(i + W); }
    }
    if (edge) return null;
    // An area no bigger than its own label is not an enclosure: the label sits
    // in a box drawn tight around the word.
    const area = (maxX - minX + 1) * (maxY - minY + 1), labelArea = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (area < 4 * labelArea) return null;
    return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1, pixels: n, paper };
  }

  const pctBox = (b, W, H) => ({ x: b.x0 / W * 100, y: b.y0 / H * 100, w: (b.x1 - b.x0) / W * 100, h: (b.y1 - b.y0) / H * 100 });
  const touches = (a, b, gx, gy) => a.x < b.x + b.w + gx && b.x < a.x + a.w + gx && a.y < b.y + b.h + gy && b.y < a.y + a.h + gy;
  const union = (a, b) => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };

  // The elements the drawing names, as candidate PLANS (the caller writes):
  //   { anchor, type, box (plan percent, corner), geometryBasis: "region"|"label",
  //     mergeIds: [existing candidate ids joined into it], keepId|null }
  // `raster` is the analysis canvas; `anchors` are in its pixels.
  // `candidates` are the analysis's own (plan percent, corner boxes).
  function elementsFrom(raster, anchors, candidates, opts) {
    const W = raster.width, H = raster.height;
    // "Touching", in percent of the plan: room for one drawn line between two
    // pieces of the same element (the Golden Plan's truss band sits 13 px —
    // its own 10 px line and a hairline — below the stage area it belongs to).
    const gx = 2.0, gy = 2.0;
    const out = [];
    const claimed = new Set();
    for (const a of anchors || []) {
      if (!ELEMENT_TYPES.has(a.type)) continue;
      // Two readings of one word (Tesseract and the model) are one anchor.
      const labelPct = pctBox(a.box, W, H);
      if (out.some(e => e.type === a.type && touches(e.labelBox, labelPct, 0, 0))) continue;
      const region = a.type === "stage" || a.type === "bar" ? regionAround(raster, a.box, opts) : null;
      let box = region ? pctBox(region, W, H) : labelPct;
      const geometryBasis = region ? "region" : "label";
      // Same-type pieces the detector already found that the element touches:
      // the same object. Only objects no person has ruled on.
      const pieces = (candidates || []).filter(c => c.kind === "venue" && c.type === a.type && !claimed.has(c.id)
        && c.status === "unreviewed" && !c.fromMemory && !c.missed && touches(c, box, gx, gy));
      if (region) for (const p of pieces) box = union(box, p);
      for (const p of pieces) claimed.add(p.id);
      out.push({
        anchor: { term: a.term, text: a.text, score: a.score, box: a.box, engine: a.engine || null },
        type: a.type, box, labelBox: labelPct, geometryBasis,
        region: region ? { pixels: region.pixels } : null,
        keepId: pieces.length ? pieces[0].id : null, mergeIds: pieces.slice(1).map(p => p.id),
      });
    }
    return out;
  }

  // ---- families of repeated filled shapes --------------------------------------
  //
  // Connected regions of one smooth fill: 4-connected pixels that pass `keep`
  // and do not sit on a colour edge (a step of more than `edge` in any channel
  // from the pixel left of or above them). A drawn outline is an edge, so two
  // fills it separates are two regions even when their colours are close.
  function fillRegions(raster, keep, opts) {
    const o = opts || {};
    const W = raster.width, H = raster.height, d = raster.data, edgeStep = o.edge == null ? 14 : o.edge, minArea = o.minArea || 100;
    const ok = new Uint8Array(W * H);
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      const p = 4 * i, r = d[p], g = d[p + 1], b = d[p + 2];
      if (!keep(r, g, b)) continue;
      if (x > 0 && Math.max(Math.abs(r - d[p - 4]), Math.abs(g - d[p - 3]), Math.abs(b - d[p - 2])) > edgeStep) continue;
      if (y > 0) { const q = p - 4 * W; if (Math.max(Math.abs(r - d[q]), Math.abs(g - d[q + 1]), Math.abs(b - d[q + 2])) > edgeStep) continue; }
      ok[i] = 1;
    }
    const label = new Int32Array(W * H), out = [];
    const stack = [];
    let next = 0;
    for (let s = 0; s < W * H; s++) {
      if (!ok[s] || label[s]) continue;
      next++;
      let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1, sr = 0, sg = 0, sb = 0;
      label[s] = next; stack.push(s);
      while (stack.length) {
        const i = stack.pop(), x = i % W, y = (i - x) / W;
        n++; sr += d[4 * i]; sg += d[4 * i + 1]; sb += d[4 * i + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && ok[i - 1] && !label[i - 1]) { label[i - 1] = next; stack.push(i - 1); }
        if (x < W - 1 && ok[i + 1] && !label[i + 1]) { label[i + 1] = next; stack.push(i + 1); }
        if (y > 0 && ok[i - W] && !label[i - W]) { label[i - W] = next; stack.push(i - W); }
        if (y < H - 1 && ok[i + W] && !label[i + W]) { label[i + W] = next; stack.push(i + W); }
      }
      if (n < minArea) continue;
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, w, h, s: Math.min(w, h), l: Math.max(w, h), area: n, solidity: n / (w * h), colour: [sr / n, sg / n, sb / n] });
    }
    return out;
  }

  const luma = (r, g, b) => (r * 299 + g * 587 + b * 114) / 1000;
  const chroma = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);
  const isPaperPx = (r, g, b) => luma(r, g, b) >= 243 && chroma(r, g, b) < 14;

  // Regions alike in size (sorted sides within `tol` of each other, so a shape
  // turned 90 degrees is the same shape) and colour, grouped by single linkage.
  function familiesOf(regions, tol, colourTol) {
    const n = regions.length, parent = regions.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = regions[i], b = regions[j];
      if (Math.abs(a.s - b.s) > tol * Math.max(a.s, b.s) || Math.abs(a.l - b.l) > tol * Math.max(a.l, b.l)) continue;
      if (Math.max(...a.colour.map((c, k) => Math.abs(c - b.colour[k]))) > colourTol) continue;
      parent[find(i)] = find(j);
    }
    const groups = new Map();
    regions.forEach((r, i) => { const k = find(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    return [...groups.values()];
  }

  // How much of a wall runs THROUGH a region: along each side and each centre
  // line, at each offset within 3 px, the share of non-paper pixels on the line
  // continued past BOTH ends by 1.5x the region's thickness; the best line, the
  // lesser end. A column set into a wall — flush with its face or straddling
  // it — has the wall continuing on both sides of it.
  function wallThrough(raster, r) {
    const W = raster.width, H = raster.height, d = raster.data;
    const paper = (x, y) => { const p = 4 * (y * W + x); return isPaperPx(d[p], d[p + 1], d[p + 2]); };
    const E = Math.max(4, Math.round(1.5 * r.s));
    let best = 0;
    for (const side of ["top", "bottom", "middleH", "left", "right", "middleV"]) for (let off = -3; off <= 3; off++) {
      let a = 0, an = 0, b = 0, bn = 0;
      if (side === "top" || side === "bottom" || side === "middleH") {
        const y = (side === "top" ? r.y0 : side === "bottom" ? r.y1 - 1 : Math.floor((r.y0 + r.y1) / 2)) + off;
        if (y < 0 || y >= H) continue;
        for (let x = Math.max(0, r.x0 - E); x < r.x0; x++) { an++; if (!paper(x, y)) a++; }
        for (let x = r.x1; x < Math.min(W, r.x1 + E); x++) { bn++; if (!paper(x, y)) b++; }
      } else {
        const x = (side === "left" ? r.x0 : side === "right" ? r.x1 - 1 : Math.floor((r.x0 + r.x1) / 2)) + off;
        if (x < 0 || x >= W) continue;
        for (let y = Math.max(0, r.y0 - E); y < r.y0; y++) { an++; if (!paper(x, y)) a++; }
        for (let y = r.y1; y < Math.min(H, r.y1 + E); y++) { bn++; if (!paper(x, y)) b++; }
      }
      if (an < E / 2 || bn < E / 2) continue;
      best = Math.max(best, Math.min(a / an, b / bn));
    }
    return best;
  }

  const overlapShare = (r, c, W, H) => {
    const bx0 = c.x / 100 * W, by0 = c.y / 100 * H, bx1 = bx0 + c.w / 100 * W, by1 = by0 + c.h / 100 * H;
    const ix = Math.max(0, Math.min(r.x1, bx1) - Math.max(r.x0, bx0)), iy = Math.max(0, Math.min(r.y1, by1) - Math.max(r.y0, by0));
    return (ix * iy) / Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
  };

  // COLUMNS: a family of at least three filled blocks of one size and one
  // colour, each with a wall running through it. Nothing else on a plan is
  // drawn as identical solid blocks threaded on the walls. A block a table
  // already explains (half of it inside a table's box) is not a column; a block
  // that is not solid (a round symbol, an outline) is not one either.
  // Returns [{box (plan percent), wall, strong}] for the members.
  function columnFamilies(raster, candidates, opts) {
    const o = opts || {};
    const W = raster.width, H = raster.height;
    const sMin = Math.max(10, 0.012 * Math.min(W, H));
    const tables = (candidates || []).filter(c => c.kind === "table");
    const regions = fillRegions(raster, (r, g, b) => !isPaperPx(r, g, b) && luma(r, g, b) >= 140 && chroma(r, g, b) < 24, { minArea: 100 })
      .filter(r => r.solidity >= 0.8 && r.s >= sMin && r.l / r.s <= 6 && r.l <= 0.15 * Math.max(W, H))
      .filter(r => !tables.some(c => overlapShare(r, c, W, H) >= 0.5));
    const out = [];
    for (const fam of familiesOf(regions, 0.25, 14)) {
      if (fam.length < 3) continue;
      const scored = fam.map(r => ({ r, wall: wallThrough(raster, r) }));
      const strong = scored.filter(x => x.wall >= (o.strongWall || 0.85));
      if (strong.length < 3) continue;
      // An established family admits a member whose wall is broken on one side
      // (a door beside it, the plan's edge) on weaker evidence.
      for (const x of scored) if (x.wall >= (o.memberWall || 0.6))
        out.push({ box: pctBox(x.r, W, H), wall: +x.wall.toFixed(3), strong: x.wall >= (o.strongWall || 0.85), familySize: strong.length });
    }
    return out;
  }

  // LOCAS: when the drawing prints a loca title (LOCA, LOCALAR), the row of
  // like closed cells it labels. Cells are paper-coloured areas closed by an
  // outline, of one size, side by side; the row is the chain of such cells
  // that starts at the cell nearest the title and steps to a neighbour no
  // more than one cell width away. Without a title there are no locas — a
  // row of boxes is not called anything the drawing did not call it.
  function locaRows(raster, anchors, opts) {
    const titles = (anchors || []).filter(a => a.type === "locaTitle");
    if (!titles.length) return [];
    const W = raster.width, H = raster.height;
    const cells = fillRegions(raster, (r, g, b) => luma(r, g, b) >= 236 && chroma(r, g, b) < 16, { minArea: 200, edge: 18 })
      .filter(r => r.solidity >= 0.75 && r.l / r.s >= 1.5 && r.l / r.s <= 6 && r.s >= 0.01 * Math.min(W, H) && r.l <= 0.12 * Math.max(W, H));
    const out = [];
    const used = new Set();
    for (const t of titles) {
      const tx = (t.box.x0 + t.box.x1) / 2, ty = (t.box.y0 + t.box.y1) / 2, th = t.box.y1 - t.box.y0;
      const near = cells.filter(c => !used.has(c)).map(c => ({ c, dist: Math.hypot((c.x0 + c.x1) / 2 - tx, (c.y0 + c.y1) / 2 - ty) }))
        .filter(x => x.dist <= Math.max(3 * x.c.l, 6 * th)).sort((a, b) => a.dist - b.dist);
      if (!near.length) continue;
      const seed = near[0].c;
      const like = (c) => Math.abs(c.s - seed.s) <= 0.25 * Math.max(c.s, seed.s) && Math.abs(c.l - seed.l) <= 0.25 * Math.max(c.l, seed.l);
      const row = [seed];
      used.add(seed);
      for (let grew = true; grew;) {
        grew = false;
        for (const c of cells) {
          if (used.has(c) || !like(c)) continue;
          const cy = (c.y0 + c.y1) / 2;
          if (row.some(m => {
            const gap = Math.max(c.x0 - m.x1, m.x0 - c.x1, c.y0 - m.y1, m.y0 - c.y1);
            return gap <= Math.min(m.l, c.l) && Math.abs(cy - (m.y0 + m.y1) / 2) <= 0.6 * Math.max(m.s, c.s) + Math.abs((c.x0 + c.x1) / 2 - (m.x0 + m.x1) / 2) * 0.1;
          })) { row.push(c); used.add(c); grew = true; }
        }
      }
      if (row.length < 3) continue;
      for (const c of row) out.push({ box: pctBox(c, W, H), title: t.term, titleScore: t.score, rowSize: row.length });
    }
    return out;
  }

  // BANQUETTES: long upholstered benches drawn in the seats' own colour, with
  // no seat divisions. The seat colour is MEASURED, never assumed: the median
  // colour at the centres of the chairs the detector already found, and only
  // when those chairs carry a real colour (an ink-only plan has none, and then
  // nothing here runs — a bench drawn as an outline is not claimed). A
  // banquette is a solid region of that colour, several times longer than it
  // is deep and at least twice as long as a chair, standing against a table
  // the analysis offers. Its seat count is never guessed: the caller marks it
  // seatsUnknown. `chairs` are centre points in plan percent; `tables` are the
  // offered tables (plan percent, corner boxes).
  function banquettes(raster, chairs, tables, opts) {
    const o = opts || {};
    const W = raster.width, H = raster.height, d = raster.data;
    if (!chairs || chairs.length < 6 || !tables || !tables.length) return { seatColour: null, found: [] };
    const samples = [];
    for (const c of chairs) {
      const x = Math.round(c.x / 100 * W), y = Math.round(c.y / 100 * H);
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      let r = 0, g = 0, b = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const p = 4 * ((y + dy) * W + x + dx); r += d[p]; g += d[p + 1]; b += d[p + 2]; }
      samples.push([r / 9, g / 9, b / 9]);
    }
    const med = (k) => { const v = samples.map(s => s[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const seat = samples.length >= 6 ? [med(0), med(1), med(2)] : null;
    if (!seat || chroma(seat[0], seat[1], seat[2]) < 50) return { seatColour: seat, found: [] };
    // The chairs' own size, from the boxes the detector gave them.
    const sides = chairs.filter(c => c.w > 0 && c.h > 0).map(c => [Math.min(c.w / 100 * W, c.h / 100 * H), Math.max(c.w / 100 * W, c.h / 100 * H)]);
    if (sides.length < 6) return { seatColour: seat, found: [] };
    const chairShort = sides.map(s => s[0]).sort((a, b) => a - b)[sides.length >> 1];
    const chairLong = sides.map(s => s[1]).sort((a, b) => a - b)[sides.length >> 1];
    const tol = o.colourTolerance || 40;
    const regions = fillRegions(raster, (r, g, b) => Math.abs(r - seat[0]) <= tol && Math.abs(g - seat[1]) <= tol && Math.abs(b - seat[2]) <= tol, { minArea: 100, edge: 40 });
    const found = [];
    for (const r of regions) {
      if (r.solidity < 0.8 || r.l / r.s < 2.5 || r.s < 0.6 * chairShort || r.l < 2 * chairLong) continue;
      const box = pctBox(r, W, H);
      // Standing against a table: within one chair depth of an offered table.
      const gapX = (t) => Math.max(0, t.x - (box.x + box.w), box.x - (t.x + t.w)) / 100 * W;
      const gapY = (t) => Math.max(0, t.y - (box.y + box.h), box.y - (t.y + t.h)) / 100 * H;
      const against = tables.filter(t => Math.max(gapX(t), gapY(t)) <= chairShort);
      if (!against.length) continue;
      // Not a chair the detector already counted.
      if (chairs.some(c => c.x >= box.x && c.x <= box.x + box.w && c.y >= box.y && c.y <= box.y + box.h)) continue;
      found.push({ box, againstTables: against.length, lengthInChairs: +(r.l / chairLong).toFixed(2) });
    }
    return { seatColour: seat.map(v => Math.round(v)), found };
  }

  globalThis.MeritVenueElements = Object.freeze({ VOCABULARY, fold, anchorsFrom, regionAround, elementsFrom,
    fillRegions, familiesOf, wallThrough, columnFamilies, locaRows, banquettes });
})();
