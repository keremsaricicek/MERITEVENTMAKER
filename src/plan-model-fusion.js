// MERIT Event Maker — fusing the local model's detections with the classical
// candidates (MeritPlanModelFusion). Pure: no DOM, no shell state.
//
// The classical pipeline and the local model look at the same pixels in
// different ways. Fusion only ADDS what one found and the other did not, and
// marks where they disagree. It deletes nothing:
//   · a model table with no classical table near it becomes a NEW candidate,
//     unreviewed, carrying its source and the model's score — only when it
//     is drawn at the size the plan's other tables are drawn at (measured:
//     v2 read a 24 px planter on the Golden Plan, whose tables are ~45 px, as
//     a round table). It is selected for Confirm only when the model is also
//     confident; otherwise the review asks. On a plan where the classical
//     pass found no table to compare with, an addition is never selected;
//   · a model chair that matches no classical chair is attached to the table
//     whose edge it sits beside — only a table the model also sees as a
//     table. On a plan the classical verdict calls
//     SYMBOLIC (numbered symbols, no chairs drawn) no chair is added;
//   · nothing is added where the classical pipeline already proposed an
//     object of ANY kind: a model "table" on a classical column is the two
//     disagreeing about a class, not a missed table (measured: the
//     architecture fixture's column C3);
//   · a model chair whose centre lies inside a line of printed text is not
//     added — the rule the classical chair stage applies to its own seat
//     evidence (plan-detection-chairs.js, inPrintedText). Measured on the
//     Golden Plan: the two printed labels under tables t029/t030 read as
//     chairs;
//   · model CHAIRS are not attached (addChair: null; measured with v1). With every rule
//     above in force, the chairs only the model saw on the Golden Plan were 4
//     right and 3 wrong (two of them a grey seat-like box under a table that
//     is not a chair). Attached directly they would lower chair precision,
//     the criterion the plan already fails (ACCEPTANCE.md: >= 0.98), and
//     unlike a table there is no review line to hold an unsure chair as a
//     question. Turning it on is a new measurement, not a default;
//   · model COLUMNS are not added (addColumn: null; measured with v1). The class was
//     trained on synthetic plans only — real annotations mask it — and on
//     the regression set it added 23 columns where none exist and found no
//     real one. Turning it back on is a new measurement, not a default;
//   · a classical table the model does not support keeps every field and gains
//     `modelSupport:false`. The review can ask about it first; nothing removes
//     it.
//
// Coordinates: candidates are CORNER boxes in percent of the detector's
// (deskewed) frame. Seats inside a candidate are CENTRE boxes in the same
// percent (MeritPlanFrames). Model detections arrive in that frame's pixels.
(function () {
  "use strict";

  // supportField: where "this source did not see that classical table" is
  // written — the model's opinion and the PDF's own shapes are not the same
  // witness, so they never share a field.
  const DEFAULTS = { addTable: 0.5, addChair: null, addColumn: null, addSeating: 0.5, matchFactor: 0.6, chairReach: 1.2, selectScore: 0.7, source: "local-model", supportField: "modelSupport" };
  // Seating furniture a model may name (training/README.md, E4). A model
  // without these classes (v1, v2) never emits them, so nothing here runs.
  const SEATING = new Set(["sofa", "bench", "banquette"]);

  function fuse(candidates, venues, model, frame, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const W = frame.width, H = frame.height, uid = frame.uid;
    const pct = (v, dim) => v / dim * 100;
    const out = { added: [], addedVenues: [], chairsAttached: 0, chairsDropped: 0, chairsInText: 0, offSize: 0, unsupported: 0, seatingAdded: 0, seatingOriented: 0, tablesOnSeating: 0, considered: (model && model.detections || []).length };
    if (!model || !model.available) return out;
    const dets = model.detections;
    const centre = c => ({ cx: (c.x + c.w / 2) / 100 * W, cy: (c.y + c.h / 2) / 100 * H, w: c.w / 100 * W, h: c.h / 100 * H });
    const tables = candidates.filter(c => c.kind === "table").map(c => ({ c, ...centre(c) }));
    const near = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy) <= o.matchFactor * Math.max(a.w, a.h, b.w, b.h);
    const others = (venues || []).map(centre);
    // Printed text in the same pixels ({x0,y0,x1,y1}); empty when nothing read it.
    const text = Array.isArray(frame.textRegions) ? frame.textRegions : [];
    const inPrintedText = d => text.some(r => d.cx >= r.x0 && d.cx <= r.x1 && d.cy >= r.y0 && d.cy <= r.y1);

    // ---- tables
    // A model table counts as consistent with the drawing when its short side
    // is within ±40 % of the classical tables' median: the same furniture, drawn
    // at the same scale. Only a confident AND consistent addition is selected
    // for Confirm; every other one is left for the review, with its confidence
    // held under the review's 0.72 line so it is asked about rather than
    // silently dropped (the raw score stays in evidence.modelScore).
    // The size the plan's tables are drawn at, measured on the tables BOTH
    // witnesses see when there are at least five of them, as the model draws
    // them. On a rendering where the classical pass broke down
    // (benchmarks/robustness, lowres-roundtrip, 2026-10-17) the classical
    // median — and the classical boxes beside the model's tables — were the
    // size of fragments, and the gate refused 15 of the model's real tables as
    // "off size". On a plan where the two agree, the model's boxes of the
    // agreed tables are the same furniture at the same scale, so the ±40 %
    // gate admits and refuses what it did before (the Golden plan's 24 px
    // planter against ~45 px tables).
    const modelTablesAll = dets.filter(d => d.cls === "table_round" || d.cls === "table_rect");
    const agreedSides = modelTablesAll.filter(d => d.score >= o.addTable && tables.some(t => near(t, d))).map(d => Math.min(d.w, d.h));
    const sides = (agreedSides.length >= 5 ? agreedSides : tables.map(t => Math.min(t.w, t.h))).sort((a, b) => a - b);
    const medianSide = sides.length ? sides[sides.length >> 1] : null;
    const consistent = d => medianSide != null && Math.abs(Math.min(d.w, d.h) - medianSide) <= 0.4 * medianSide;
    const modelTables = dets.filter(d => d.cls === "table_round" || d.cls === "table_rect");
    const supported = new Set();
    for (const d of modelTables) {
      const hit = tables.find(t => near(t, d));
      if (hit) { supported.add(hit.c); continue; }
      // its centre on a classical venue object (inside its box, so a stage
      // does not cast a halo its own size over every table around it)
      if (others.some(v => Math.abs(d.cx - v.cx) <= v.w / 2 && Math.abs(d.cy - v.cy) <= v.h / 2)) continue;
      if (d.score < o.addTable) continue;
      if (medianSide != null && !consistent(d)) { out.offSize++; continue; }
      const round = d.cls === "table_round";
      const square = !round && Math.abs(d.w - d.h) < 0.12 * Math.max(d.w, d.h);
      const select = d.score >= o.selectScore && consistent(d);
      const c = { id: uid("candidate"), kind: "table", type: round ? "round" : square ? "square" : "rectangle",
        x: pct(d.cx - d.w / 2, W), y: pct(d.cy - d.h / 2, H), w: pct(d.w, W), h: pct(d.h, H), rotation: 0,
        confidence: select ? d.score : Math.min(d.score, 0.7), status: "unreviewed", selected: select, source: o.source,
        chairDetections: [], evidence: { geometry: o.source, chairs: 0, repetition: 0, modelScore: d.score, consistentSize: consistent(d) } };
      out.added.push(c);
      tables.push({ c, cx: d.cx, cy: d.cy, w: d.w, h: d.h });
      supported.add(c);
    }
    for (const t of tables) if (!supported.has(t.c) && t.c.source !== o.source) { t.c[o.supportField] = false; out.unsupported++; }

    // ---- chairs
    // A model chair is attached only to a table the model ALSO sees. A chair
    // that attaches to a table the model does not support is the model
    // contradicting itself, and it is not harmless: a seat at a table is what
    // exempts that table from text suppression downstream, so on the Golden
    // Plan two classical phantoms (printed text under the real tables t029 and
    // t030) survived only because a model chair landed beside them.
    if (o.addChair != null && frame.representation !== "SYMBOLIC") {
      const seats = [];
      for (const t of tables) for (const ch of t.c.chairDetections || []) seats.push({ cx: ch.x / 100 * W, cy: ch.y / 100 * H, w: ch.w / 100 * W, h: ch.h / 100 * H });
      for (const d of dets.filter(d => d.cls === "chair")) {
        if (seats.some(s => Math.hypot(s.cx - d.cx, s.cy - d.cy) <= o.matchFactor * Math.max(s.w, s.h, d.w, d.h))) continue;
        if (d.score < o.addChair) continue;
        if (inPrintedText(d)) { out.chairsInText++; continue; }
        // the supported table whose EDGE the chair sits beside, within reach of its size
        let best = null, bestGap = Infinity;
        for (const t of tables) {
          if (!supported.has(t.c)) continue;
          const gx = Math.max(0, Math.abs(d.cx - t.cx) - t.w / 2), gy = Math.max(0, Math.abs(d.cy - t.cy) - t.h / 2);
          const gap = Math.hypot(gx, gy);
          if (gap < bestGap) { bestGap = gap; best = t; }
        }
        if (!best || bestGap > o.chairReach * Math.max(d.w, d.h)) { out.chairsDropped++; continue; }
        best.c.chairDetections = best.c.chairDetections || [];
        // Where the chair sits against the table, in the relationship engine's
        // own terms, so everything that explains a seat can explain this one.
        const insideX = Math.abs(d.cx - best.cx) <= best.w / 2, insideY = Math.abs(d.cy - best.cy) <= best.h / 2;
        const positionKind = insideX && insideY ? "inside" : insideX || insideY ? "edge" : "corner";
        const positionSide = positionKind !== "edge" ? null : insideX ? (d.cy < best.cy ? "top" : "bottom") : (d.cx < best.cx ? "left" : "right");
        best.c.chairDetections.push({ id: uid("candidate-chair"), x: pct(d.cx, W), y: pct(d.cy, H), w: pct(d.w, W), h: pct(d.h, H), rotation: 0,
          confidence: d.score, source: o.source,
          relation: { ambiguous: false, score: null, margin: null, reason: "nearestTableEdge:" + o.source, runnerUpTableIndex: null, runnerUpScore: null, competitors: [],
            evidence: { positionKind, positionSide, distance: Math.round(bestGap * 10) / 10 },
            orientation: { known: false, angle: null, strength: 0, evidence: "notRead", facingKnown: false, facingAngle: null, facingEvidence: "notRead" } } });
        seats.push({ cx: d.cx, cy: d.cy, w: d.w, h: d.h });
        out.chairsAttached++;
      }
    }

    // ---- seating furniture
    // A sofa, bench or banquette the model names where the classical pass
    // proposed nothing becomes an unreviewed venue object whose seats are NOT
    // known: a sofa is never "three seats" because it is long, and nothing here
    // counts it (seats null, seatsUnknown, the capacity audit's "unverified
    // seating"). A classical TABLE standing on a piece the model calls seating
    // keeps every field and gains `modelSaysSeating` — the review can ask about
    // it first; nothing removes or retypes it.
    if (o.addSeating != null) {
      const seating = dets.filter(d => SEATING.has(d.cls) && d.score >= o.addSeating);
      const onPiece = (t, d) => Math.abs(t.cx - d.cx) <= d.w / 2 && Math.abs(t.cy - d.cy) <= d.h / 2;
      const placed = (venues || []).map(centre);
      for (const d of seating) {
        let hitTable = false;
        for (const t of tables) if (t.c.source !== o.source && onPiece(t, d)) { t.c.modelSaysSeating = d.cls; hitTable = true; }
        if (hitTable) { out.tablesOnSeating++; continue; }
        if (placed.some(v => near(v, d))) continue;
        const fit = frame.pixels ? orientPiece(frame.pixels, W, H, d) : null;
        const b = fit || { cx: d.cx, cy: d.cy, w: d.w, h: d.h, rotation: 0 };
        const v = { id: uid("candidate"), kind: "venue", type: d.cls, x: pct(b.cx - b.w / 2, W), y: pct(b.cy - b.h / 2, H), w: pct(b.w, W), h: pct(b.h, H),
          rotation: b.rotation, confidence: Math.min(d.score, 0.7), status: "unreviewed", selected: false, source: o.source, chairDetections: [],
          seats: null, seatsConfidence: "unverified", seatsUnknown: true,
          evidence: { geometry: fit ? o.source + "+oriented-from-pixels" : o.source, modelScore: d.score, seats: "not counted: a model names the piece, not its seats" } };
        if (fit) out.seatingOriented++;
        out.addedVenues.push(v);
        placed.push({ cx: d.cx, cy: d.cy, w: d.w, h: d.h });
        out.seatingAdded++;
      }
    }

    // ---- columns
    const cols = (venues || []).filter(v => v.type === "column").map(centre);
    for (const d of dets.filter(d => d.cls === "column")) {
      if (o.addColumn == null || d.score < o.addColumn || cols.some(c => near(c, d))) continue;
      const v = { id: uid("candidate"), kind: "venue", type: "column", x: pct(d.cx - d.w / 2, W), y: pct(d.cy - d.h / 2, H), w: pct(d.w, W), h: pct(d.h, H),
        rotation: 0, confidence: d.score, status: "unreviewed", selected: false, source: o.source, chairDetections: [],
        evidence: { geometry: o.source, modelScore: d.score } };
      out.addedVenues.push(v);
      cols.push({ cx: d.cx, cy: d.cy, w: d.w, h: d.h });
    }
    return out;
  }

  // ---- an oriented box for a seating piece, from its own pixels (R2)
  // The model writes an axis-aligned box. A sofa turned 30 degrees inside one
  // is measured as a fatter, shorter object, and its envelope swallows the
  // armchair beside it: on true boxes the serves-table rule found 0.705 of the
  // seating groups from envelopes and every one from turned boxes
  // (benchmarks/relations/README.md, R2). The turn is taken from the piece's
  // own drawing — the minimum-area rectangle around the largest ink component
  // inside the box (ink: more than 40 grey levels from the crop's commonest
  // grey, so a dark-paper family is read the same way) — and kept only when it
  // says something: the component is mostly inside the model's box, the piece
  // is elongated (long side >= 1.3 x the short one) and turned more than 5
  // degrees. Otherwise the model's box stands. Nothing about a back or a front
  // is read here; a piece's facing stays unknown.
  function orientPiece(rgba, W, H, d) {
    const x0 = Math.max(0, Math.floor(d.cx - d.w * 0.55)), x1 = Math.min(W - 1, Math.ceil(d.cx + d.w * 0.55));
    const y0 = Math.max(0, Math.floor(d.cy - d.h * 0.55)), y1 = Math.min(H - 1, Math.ceil(d.cy + d.h * 0.55));
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    if (cw < 8 || ch < 8 || cw * ch > 600000) return null;
    const lum = new Uint8Array(cw * ch), hist = new Uint32Array(256);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = ((y + y0) * W + x + x0) * 4, v = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000 | 0;
      lum[y * cw + x] = v; hist[v]++;
    }
    let paper = 0;
    for (let v = 1; v < 256; v++) if (hist[v] > hist[paper]) paper = v;
    const ink = new Uint8Array(cw * ch);
    for (let i = 0; i < ink.length; i++) ink[i] = Math.abs(lum[i] - paper) > 40 ? 1 : 0;
    // 8-connected components; the largest one mostly inside the model's box
    const label = new Int32Array(cw * ch), stack = new Int32Array(cw * ch);
    const bx0 = d.cx - d.w / 2 - x0, bx1 = d.cx + d.w / 2 - x0, by0 = d.cy - d.h / 2 - y0, by1 = d.cy + d.h / 2 - y0;
    let best = 0, bestCount = 0, next = 0;
    for (let s = 0; s < ink.length; s++) {
      if (!ink[s] || label[s]) continue;
      const id = ++next; let top = 0, count = 0, inside = 0;
      label[s] = id; stack[top++] = s;
      while (top) {
        const k = stack[--top], x = k % cw, y = (k - x) / cw;
        count++; if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) inside++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const n = ny * cw + nx;
          if (ink[n] && !label[n]) { label[n] = id; stack[top++] = n; }
        }
      }
      if (inside >= 0.6 * count && count > bestCount) { best = id; bestCount = count; }
    }
    if (!best || bestCount < 20) return null;
    // convex hull of the component (row extremes are enough), then the
    // minimum-area rectangle over the hull's edge directions
    const pts = [];
    for (let y = 0; y < ch; y++) {
      let lo = -1, hi = -1;
      for (let x = 0; x < cw; x++) if (label[y * cw + x] === best) { if (lo < 0) lo = x; hi = x; }
      if (lo >= 0) { pts.push([lo, y], [hi + 1, y], [lo, y + 1], [hi + 1, y + 1]); }
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    if (hull.length < 3) return null;
    let rect = null;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!len) continue;
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const p of hull) { const u = p[0] * ux + p[1] * uy, v = -p[0] * uy + p[1] * ux; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
      const area = (u1 - u0) * (v1 - v0);
      if (!rect || area < rect.area) rect = { area, ux, uy, u0, u1, v0, v1 };
    }
    let L = rect.u1 - rect.u0, D = rect.v1 - rect.v0, ang = Math.atan2(rect.uy, rect.ux) * 180 / Math.PI;
    const mu = (rect.u0 + rect.u1) / 2, mv = (rect.v0 + rect.v1) / 2;
    const cx = mu * rect.ux - mv * rect.uy + x0, cy = mu * rect.uy + mv * rect.ux + y0;
    if (D > L) { [L, D] = [D, L]; ang += 90; }
    ang = ((ang % 180) + 180) % 180; if (ang > 90) ang -= 180;
    if (L < 1.3 * D || Math.abs(ang) <= 5 || Math.abs(Math.abs(ang) - 90) <= 5) return null;
    return { cx, cy, w: L, h: D, rotation: Math.round(ang * 10) / 10 };
  }

  globalThis.MeritPlanModelFusion = Object.freeze({ fuse, orientPiece, DEFAULTS });
})();
