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

  const DEFAULTS = { addTable: 0.5, addChair: null, addColumn: null, matchFactor: 0.6, chairReach: 1.2, selectScore: 0.7, source: "local-model" };

  function fuse(candidates, venues, model, frame, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const W = frame.width, H = frame.height, uid = frame.uid;
    const pct = (v, dim) => v / dim * 100;
    const out = { added: [], addedVenues: [], chairsAttached: 0, chairsDropped: 0, chairsInText: 0, offSize: 0, unsupported: 0, considered: (model && model.detections || []).length };
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
    const sides = tables.map(t => Math.min(t.w, t.h)).sort((a, b) => a - b);
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
    for (const t of tables) if (!supported.has(t.c)) { t.c.modelSupport = false; out.unsupported++; }

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

  globalThis.MeritPlanModelFusion = Object.freeze({ fuse, DEFAULTS });
})();
