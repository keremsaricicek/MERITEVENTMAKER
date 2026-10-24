// Which detections belong together: furniture groups, similarity families, the bulk-review groups built on them, and the short queue of genuinely ambiguous single objects.
//
// Part of Plan Intelligence, split out of src/plan-intelligence.js on 2026-10-04
// (technical gaps, item 2) and moved verbatim: the only edits are references to
// a name another part owns, which now go through that part's object. Nothing
// here is a trained model; every number is computed from real geometry or OCR.
(() => {
  "use strict";
  const GEOM = globalThis.MeritPlanIntelGeometry;

  // ---- Furniture grouping: real geometric heuristic (touch + gap + alignment),
  // never "close together" alone. Matches merit-plan-intelligence's requirement
  // that grouping use multiple signals, not proximity by itself.
  //
  // `decisions` are real human answers to a difficult grouping question
  // (event.analysis.groupingDecisions, written by app-v8.js's question
  // handler) — a "separate" decision blocks every pairwise union among its
  // original memberIds so the group genuinely splits into standalone tables;
  // a "merged" decision forces a union even if geometry alone wouldn't
  // connect them, and both are honored on every recompute so a human answer
  // has a real, persistent effect instead of being logged and ignored.
  function pairKey(idA, idB) { return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`; }

  // TURNED TABLES ARE COMPARED IN THEIR OWN FRAME. A table carries its
  // unrotated box around its centre plus a rotation (the detector keeps it in
  // (-45, 45]); the contact rule below reads that box as if it were axis-
  // aligned, so a row of tables pushed together at 30 degrees looked like a
  // diagonal of separate boxes and was never joined (benchmarks/relations:
  // 36 of 93 turned rows). Two tables turned alike (within 10 degrees, square
  // symmetry included) are measured along their shared axes instead — the same
  // gap and the same alignment test, on the same 0.28 / 0.35 of a side. The
  // percent box is anisotropic (x is a share of the width, y of the height),
  // so a turn is only meaningful after y is put in the same unit as x:
  // `aspect` is the plan's width over its height. Tables that are not turned
  // (both within 5 degrees) and tables turned differently keep the contact rule
  // exactly as it was.
  const deg = c => Number.isFinite(c.rotation) ? c.rotation : 0;
  function turnedFrame(a, b, aspect) {
    const ra = deg(a), rb = deg(b);
    if (Math.abs(ra) <= 5 && Math.abs(rb) <= 5) return null;
    let d = ((rb - ra) % 90 + 90) % 90; if (d > 45) d -= 90;
    if (Math.abs(d) > 10) return null;
    const swap = Math.abs(rb - ra) > 45;
    const t = -ra * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
    const centre = c => ({ x: c.x + c.w / 2, y: (c.y + c.h / 2) / aspect });
    const ca = centre(a), cb = centre(b);
    const dx = cb.x - ca.x, dy = cb.y - ca.y;
    const u = dx * cos - dy * sin, v = dx * sin + dy * cos;
    const A = { w: a.w, h: a.h / aspect }, B = swap ? { w: b.h / aspect, h: b.w } : { w: b.w, h: b.h / aspect };
    return { u, v, A, B };
  }
  function touchesAndAligns(a, b, aspect) {
    const f = turnedFrame(a, b, aspect);
    if (!f) {
      const gap = GEOM.gapBetween(a, b), threshold = Math.min(a.w, a.h, b.w, b.h) * 0.28;
      return gap <= threshold && GEOM.aligned(a, b);
    }
    const gu = Math.max(Math.abs(f.u) - (f.A.w + f.B.w) / 2, 0), gv = Math.max(Math.abs(f.v) - (f.A.h + f.B.h) / 2, 0);
    const threshold = Math.min(f.A.w, f.A.h, f.B.w, f.B.h) * 0.28;
    const aligned = Math.abs(f.v) <= Math.min(f.A.h, f.B.h) * 0.35 || Math.abs(f.u) <= Math.min(f.A.w, f.B.w) * 0.35;
    return Math.hypot(gu, gv) <= threshold && aligned;
  }

  function buildFurnitureGroups(tableCandidates, decisions = [], options = {}) {
    const aspect = Number.isFinite(options.aspect) && options.aspect > 0 ? options.aspect : 1;
    const n = tableCandidates.length, parent = Array.from({ length: n }, (_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
    const indexById = new Map(tableCandidates.map((c, i) => [c.id, i]));
    const blockedPairs = new Set(), forcedPairs = new Set();
    for (const d of decisions) {
      if (!Array.isArray(d.memberIds)) continue;
      const target = d.decision === "separate" ? blockedPairs : d.decision === "merged" ? forcedPairs : null;
      if (!target) continue;
      for (let a = 0; a < d.memberIds.length; a++) for (let b = a + 1; b < d.memberIds.length; b++) target.add(pairKey(d.memberIds[a], d.memberIds[b]));
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = tableCandidates[i], b = tableCandidates[j];
        if (blockedPairs.has(pairKey(a.id, b.id))) continue;
        // A ROUND TABLE SYMBOL IS A WHOLE TABLE. On a symbolic sheet each ring
        // stands for one table with its own number; two rings drawn close are
        // two tables, not one dining unit — round tables are not pushed
        // together to seat a party, and the contact rule below, written for
        // drawn furniture, made one ORNEK pair a "joined group" at a 20 px gap
        // between 80 px rings. Only a person's "merged" answer joins them.
        if (a.symbolFamily === true && b.symbolFamily === true && a.type === "round" && b.type === "round") continue;
        if (touchesAndAligns(a, b, aspect)) union(i, j);
      }
    }
    for (const key of forcedPairs) {
      const [idA, idB] = key.split("|");
      if (indexById.has(idA) && indexById.has(idB)) union(indexById.get(idA), indexById.get(idB));
    }
    const groups = new Map();
    tableCandidates.forEach((c, i) => { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(c); });
    return [...groups.values()].filter(members => members.length >= 1).map(members => {
      const xs = members.flatMap(m => [m.x, m.x + m.w]), ys = members.flatMap(m => [m.y, m.y + m.h]);
      const memberIds = members.map(m => m.id).sort();
      const matchingDecision = decisions.find(d => Array.isArray(d.memberIds) && d.memberIds.length === memberIds.length && [...d.memberIds].sort().every((id, i) => id === memberIds[i]));
      return {
        id: uid("furngroup"),
        memberIds: members.map(m => m.id),
        reason: matchingDecision
          ? (matchingDecision.decision === "merged" ? "Confirmed by a human answer as one seating group." : "Confirmed by a human answer as separate tables.")
          : members.length > 1
            ? `${members.length} physical tables touch and align — treated as one logical dining unit.`
            : "Single physical table.",
        decision: matchingDecision?.decision || null,
        decidedAt: matchingDecision?.decidedAt || null,
        bbox: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
      };
    });
  }

  // ---- Similarity clustering: geometric feature vector (size, aspect,
  // kind/type) PLUS, when available, a real pixel-derived visual descriptor
  // (c.visualDescriptor, computed in app-v8.js's runAssistedDetection from
  // the actual decoded plan image — fill ratio, edge density, an intensity
  // histogram, a quadrant fill signature; see the VisualEmbeddingProvider
  // comment there for why this is classical/deterministic rather than a
  // trained embedding). Geometry alone cannot tell a solid table apart from
  // an open frame of the same bounding box; real pixel content can. Greedy
  // nearest-cluster assignment — this is what lets "Teach once" propagate a
  // correction to many objects without asking the same question repeatedly.
  function featureVector(c) {
    return { area: c.w * c.h, aspect: c.w / Math.max(0.001, c.h), kind: c.kind, type: c.type, visual: c.visualDescriptor || null };
  }
  // When the active provider is the learned encoder, the descriptor carries a
  // `learned` unit vector alongside the four measured fields. It is an extra
  // term, never a replacement: cosine distance between two 32-d unit vectors,
  // weighted alongside the others rather than above them. A descriptor without
  // one — a manually drawn candidate, a memory-restored one, or an install
  // whose weights were never built — simply skips the term, which is why the
  // encoder can be absent without any of this changing behaviour.
  function learnedDistance(a, b) {
    if (!a || !b || a.length !== b.length) return null;
    let dotp = 0;
    for (let i = 0; i < a.length; i++) dotp += a[i] * b[i];
    return 1 - dotp; // both sides are unit-length, so this is in [0, 2]
  }
  function visualDistance(v1, v2) {
    if (!v1 || !v2) return 0; // no real pixel signal on one side (e.g. a manually-drawn or memory-restored candidate) — fall back to geometry alone rather than penalizing an unknown.
    const fillDiff = Math.abs(v1.fillRatio - v2.fillRatio);
    const edgeDiff = Math.abs(v1.edgeDensity - v2.edgeDensity);
    const histDiff = v1.intensityHist.reduce((s, val, i) => s + Math.abs(val - v2.intensityHist[i]), 0) / 2;
    const quadDiff = v1.quadrantFill.reduce((s, val, i) => s + Math.abs(val - v2.quadrantFill[i]), 0) / 4;
    const learned = learnedDistance(v1.learned, v2.learned);
    return fillDiff * 1.5 + edgeDiff * 1.2 + histDiff * 1.5 + quadDiff * 1.3
      + (learned == null ? 0 : learned * 1.5);
  }
  function featureDistance(f1, f2) {
    if (f1.kind !== f2.kind) return Infinity;
    const areaRatio = Math.max(f1.area, f2.area) / Math.max(0.0001, Math.min(f1.area, f2.area));
    const aspectDiff = Math.abs(f1.aspect - f2.aspect);
    return (areaRatio - 1) * 2 + aspectDiff * 3 + visualDistance(f1.visual, f2.visual) * 2;
  }
  function averageVisual(centroidVisual, incomingVisual, n) {
    if (!incomingVisual) return centroidVisual;
    if (!centroidVisual) return { ...incomingVisual, intensityHist: [...incomingVisual.intensityHist], quadrantFill: [...incomingVisual.quadrantFill],
      learned: incomingVisual.learned ? [...incomingVisual.learned] : null };
    const blend = (a, b) => (a * (n - 1) + b) / n;
    // A centroid of unit vectors is not a unit vector, and cosine distance
    // against an un-normalised centroid would drift as a cluster grows. So the
    // running mean is re-normalised, which is what makes it a direction the
    // cluster agrees on rather than an average magnitude.
    let learned = centroidVisual.learned || null;
    if (incomingVisual.learned && learned && learned.length === incomingVisual.learned.length) {
      const mean = learned.map((v, i) => blend(v, incomingVisual.learned[i]));
      let norm = 0;
      for (const v of mean) norm += v * v;
      norm = Math.sqrt(norm) || 1;
      learned = mean.map(v => v / norm);
    } else if (!learned && incomingVisual.learned) {
      learned = [...incomingVisual.learned];
    }
    return {
      fillRatio: blend(centroidVisual.fillRatio, incomingVisual.fillRatio),
      edgeDensity: blend(centroidVisual.edgeDensity, incomingVisual.edgeDensity),
      intensityHist: centroidVisual.intensityHist.map((v, i) => blend(v, incomingVisual.intensityHist[i])),
      quadrantFill: centroidVisual.quadrantFill.map((v, i) => blend(v, incomingVisual.quadrantFill[i])),
      learned,
    };
  }
  function buildSimilarityGroups(candidates, distanceThreshold = 1.6) {
    const clusters = [];
    for (const c of candidates) {
      const f = featureVector(c);
      let best = null, bestDist = Infinity;
      for (const cluster of clusters) {
        const d = featureDistance(cluster.centroid, f);
        if (d < bestDist) { bestDist = d; best = cluster; }
      }
      if (best && bestDist <= distanceThreshold) {
        best.members.push(c);
        const n = best.members.length;
        best.centroid.area = (best.centroid.area * (n - 1) + f.area) / n;
        best.centroid.aspect = (best.centroid.aspect * (n - 1) + f.aspect) / n;
        best.centroid.visual = averageVisual(best.centroid.visual, f.visual, n);
      } else {
        clusters.push({ centroid: { ...f }, members: [c] });
      }
    }
    return clusters.map(cluster => {
      const members = cluster.members;
      const avgConf = members.reduce((n, m) => n + (m.confidence || 0), 0) / members.length;
      const outliers = members.filter(m => Math.abs((m.confidence || 0) - avgConf) > 0.22).map(m => m.id);
      return {
        id: uid("simgroup"),
        kind: cluster.centroid.kind,
        type: members[0].type,
        memberIds: members.map(m => m.id),
        representativeId: members[0].id,
        outlierIds: outliers,
      };
    }).filter(g => g.memberIds.length >= 1);
  }

  // ---- Review groups (Concept 2 bulk-review logic): collapse similarity
  // clusters of unreviewed/low-confidence candidates into one decision instead
  // of N. A cluster with 0 unreviewed members needs no review group at all.
  function buildReviewGroups(candidates, similarityGroups) {
    const byId = new Map(candidates.map(c => [c.id, c]));
    const groups = [];
    for (const sg of similarityGroups) {
      const members = sg.memberIds.map(id => byId.get(id)).filter(Boolean);
      const needsReview = members.filter(m => m.status === "unreviewed" && m.confidence < 0.72);
      if (!needsReview.length) continue;
      const consistent = members.length - needsReview.length;
      groups.push({
        id: uid("reviewgroup"),
        // Structured, not pre-rendered: the domain layer must not decide what
        // language the operator reads. The UI renders this through t(), the
        // same way uncertainQuestions already carry questionType/params
        // instead of an English sentence. `title` stays as the English
        // fallback for anything reading the old shape.
        titleParams: { type: sg.type, kind: sg.kind === "table" ? "table" : "object" },
        title: `${sg.type} ${sg.kind === "table" ? "table" : "object"} family`,
        memberIds: needsReview.map(m => m.id),
        totalInFamily: members.length,
        consistentCount: consistent,
        outlierIds: sg.outlierIds,
        question: `${members.length} similar ${sg.type} object${members.length === 1 ? "" : "s"} found. ${consistent} look consistent, ${needsReview.length} need review.`,
        kind: sg.kind,
      });
    }
    // One family, one decision.
    //
    // Similarity clustering is the right unit for PROPAGATION — it is what
    // makes "apply to all" safe — but it is the wrong unit to put in front of a
    // person. Measured on the Golden Plan it produced twelve review groups, of
    // which seven were singletons and the same kind-and-type appeared in three
    // separate cards: three "square table family", two "round table family",
    // two "rectangle table family", three "chair object family", two "stage
    // object family". An operator asked the same question five times has been
    // given five decisions to make, not five pieces of information.
    //
    // So clusters are merged for review by what the operator is actually being
    // asked about, which is the object's kind and type. Each merged group keeps
    // its constituent clusters, so anything that wants to propagate a decision
    // can still do it cluster by cluster rather than across the whole family.
    const merged = new Map();
    for (const g of groups) {
      const key = `${g.kind}:${g.titleParams.type}`;
      const hit = merged.get(key);
      if (!hit) { merged.set(key, { ...g, clusters: [{ memberIds: g.memberIds, outlierIds: g.outlierIds }] }); continue; }
      hit.memberIds = hit.memberIds.concat(g.memberIds);
      hit.totalInFamily += g.totalInFamily;
      hit.consistentCount += g.consistentCount;
      hit.outlierIds = hit.outlierIds.concat(g.outlierIds);
      hit.clusters.push({ memberIds: g.memberIds, outlierIds: g.outlierIds });
    }
    return [...merged.values()]
      .map(g => ({ ...g,
        question: `${g.totalInFamily} similar ${g.titleParams.type} object${g.totalInFamily === 1 ? "" : "s"} found. `
          + `${g.consistentCount} look consistent, ${g.memberIds.length} need review.` }))
      .sort((a, b) => b.memberIds.length - a.memberIds.length);
  }

  // ---- Difficult-item queue (Concept 1): only genuinely ambiguous, high-value
  // single objects — never the bulk of low-confidence detections (those go
  // through review groups instead). "Ambiguous" here means: a furniture group
  // with 2+ physical tables (needs a human yes/no on whether it's one dining
  // unit), or a candidate whose aspect ratio sits in the round/rectangle
  // boundary zone.
  function buildDifficultQuestions(candidates, furnitureGroups) {
    const byId = new Map(candidates.map(c => [c.id, c]));
    // One question per repeated ARRANGEMENT, not per group.
    //
    // Measured on the Golden Plan, this asked thirteen questions of which eight
    // were literally the same question — "3 physical tables touch and align; do
    // they operate as one seating group?" — about eight identical arrangements
    // of three identical square tables. Answering the same question eight times
    // is not eight pieces of information, and the sprint's review-consolidation
    // rule is explicit that a family should be one decision.
    //
    // Two arrangements are the same question when they have the same number of
    // tables and the same multiset of table types. Anything that differs in
    // either stays its own question, so the two four-table groups, the
    // rectangle+square mix and the pair of round tables are still asked
    // separately.
    //
    // Consolidation is presentational only. Every group the question covers is
    // carried in groupIds and gets its OWN decision record when the operator
    // answers, because a grouping decision belongs to the tables it is about —
    // sharing one record across arrangements is the data-model bug this
    // repository has already fixed once.
    const byArrangement = new Map();
    for (const fg of furnitureGroups) {
      if (fg.memberIds.length < 2) continue;
      if (fg.decision) continue; // already answered by a human — never re-ask the same question.
      const types = fg.memberIds.map(id => byId.get(id)?.type || "?").sort().join("+");
      const key = `${fg.memberIds.length}:${types}`;
      const hit = byArrangement.get(key);
      if (hit) { hit.groupIds.push(fg.id); continue; }
      byArrangement.set(key, {
        id: uid("question"), candidateId: fg.memberIds[0], groupId: fg.id, groupIds: [fg.id],
        // What makes two arrangements the same question, recorded so the
        // consolidation is checkable rather than implied by a count.
        arrangement: key,
        kind: "grouping",
        question: `Do these ${fg.memberIds.length} connected tables operate as one seating group?`,
        questionType: "combinedDiningGroup",
        questionParams: { memberCount: fg.memberIds.length },
      });
    }
    // The count each question resolves, so the operator can see what one answer
    // is worth and the effort measurement is not quietly hiding anything.
    return [...byArrangement.values()].map(q => ({ ...q, coversGroups: q.groupIds.length }))
      .sort((a, b) => b.coversGroups - a.coversGroups);
  }

  // ---- Seating furniture → the table it serves (R2, 2026-10-17).
  //
  // A sofa, bench or banquette serves a table when ALL of these hold, measured
  // in the piece's own frame (long axis, depth across it), never by distance
  // between centres alone:
  //   - the table lies along the piece: their extents along the long axis
  //     overlap by at least 30 % of the shorter one;
  //   - across, the gap from the piece's edge to the table's edge is between
  //     -0.5 and 0.6 of the piece's depth (the depth is the one size every
  //     piece has whatever its length — a sofa pulled a metre away from a
  //     table is not at it);
  //   - when the piece's front is KNOWN (`facingDeg`, the direction its seat
  //     faces; a sofa's or banquette's back is on the other side), the table
  //     is in front of it. A bench has no back; a box read without one says
  //     nothing, and nothing is inferred.
  // A table whose centre lies ON the piece is the piece read as a table, not a
  // table it serves (`tablesOn`). A chair whose centre lies on a piece is a
  // cushion of that piece (`chairsOn`) and is not counted as a chair: one seat
  // is counted once. A banquette along several tables serves each of them; its
  // seats count once for the room and are NOT divided between the tables (an
  // even split is a guess the drawing does not make), so each of those tables'
  // seats reads null with the piece named in `sharedPieces`. A piece whose
  // seats are not drawn (`seats` null) makes its table's seats null too —
  // "not shown", never three.
  //
  // Positions in percent of the sheet, the unrotated box around its centre and
  // a rotation (as tables are written); `aspect` is width over height, so the
  // frame is isotropic before anything is turned. Nothing is written back.
  const SEATING_TYPES = new Set(["sofa", "bench", "banquette"]);
  const SERVE = Object.freeze({ minOverlap: 0.3, minGapDepth: -0.5, maxGapDepth: 0.6, clearGapDepth: 0.35, onPieceMargin: 0.1 });
  function boxFrame(c, aspect) {
    const r = deg(c) * Math.PI / 180;
    return { cx: c.x + c.w / 2, cy: (c.y + c.h / 2) / aspect, w: c.w, h: c.h / aspect, ux: Math.cos(r), uy: Math.sin(r) };
  }
  const halfExtent = (f, dx, dy) => Math.abs(f.w / 2 * (f.ux * dx + f.uy * dy)) + Math.abs(f.h / 2 * (-f.uy * dx + f.ux * dy));
  function pieceFrame(c, aspect) {
    const f = boxFrame(c, aspect), long = f.w >= f.h;
    const lx = long ? f.ux : -f.uy, ly = long ? f.uy : f.ux;
    const facing = Number.isFinite(c.facingDeg) ? { x: Math.cos(c.facingDeg * Math.PI / 180), y: Math.sin(c.facingDeg * Math.PI / 180) } : null;
    return { cx: f.cx, cy: f.cy, lx, ly, nx: -ly, ny: lx, L: long ? f.w : f.h, D: long ? f.h : f.w, facing };
  }
  function onPiece(p, x, y, margin = SERVE.onPieceMargin) {
    const dx = x - p.cx, dy = y - p.cy, m = margin * p.D;
    return Math.abs(dx * p.lx + dy * p.ly) <= p.L / 2 + m && Math.abs(dx * p.nx + dy * p.ny) <= p.D / 2 + m;
  }
  function serves(p, t) {
    const dx = t.cx - p.cx, dy = t.cy - p.cy;
    const along = dx * p.lx + dy * p.ly, across = dx * p.nx + dy * p.ny;
    const ea = halfExtent(t, p.lx, p.ly), en = halfExtent(t, p.nx, p.ny);
    const overlap = Math.min(along + ea, p.L / 2) - Math.max(along - ea, -p.L / 2);
    const overlapShare = overlap / Math.min(2 * ea, p.L);
    const gap = (Math.abs(across) - en - p.D / 2) / p.D;
    const front = p.facing ? dx * p.facing.x + dy * p.facing.y > 0 : null;
    const ok = overlapShare >= SERVE.minOverlap && gap >= SERVE.minGapDepth && gap <= SERVE.maxGapDepth && front !== false;
    return { ok, gap, overlapShare, front };
  }
  function buildSeatingLinks(candidates, options = {}) {
    const aspect = Number.isFinite(options.aspect) && options.aspect > 0 ? options.aspect : 1;
    const tables = candidates.filter(c => c.kind === "table" && c.status !== "rejected");
    const pieces = candidates.filter(c => c.kind === "venue" && SEATING_TYPES.has(c.type) && c.status !== "rejected");
    const looseChairs = candidates.filter(c => c.kind === "venue" && c.type === "chair" && c.status !== "rejected");
    const tf = new Map(tables.map(t => [t.id, boxFrame(t, aspect)]));
    const pf = new Map(pieces.map(p => [p.id, pieceFrame(p, aspect)]));
    const links = [], piecesOut = [];
    const chairOn = new Map(); // chair id -> piece id
    const chairPoint = s => ({ x: Number.isFinite(s.cx) ? s.cx : s.x + (s.w || 0) / 2, y: (Number.isFinite(s.cy) ? s.cy : s.y + (s.h || 0) / 2) / aspect });
    // chairDetections are written as centres in percent (plan-detection-chairs.js)
    const tableChairs = tables.flatMap(t => (t.chairDetections || []).map(s => ({ id: s.id, table: t.id, x: s.x, y: s.y / aspect })));
    const loose = looseChairs.map(c => ({ id: c.id, table: null, ...chairPoint(c) }));
    for (const piece of pieces) {
      const p = pf.get(piece.id);
      const tablesOn = tables.filter(t => onPiece(p, tf.get(t.id).cx, tf.get(t.id).cy, 0)).map(t => t.id);
      const chairsOn = [...tableChairs, ...loose].filter(s => onPiece(p, s.x, s.y)).map(s => s.id);
      for (const id of chairsOn) if (!chairOn.has(id)) chairOn.set(id, piece.id);
      const served = [];
      for (const t of tables) {
        if (tablesOn.includes(t.id)) continue;
        const r = serves(p, tf.get(t.id));
        if (!r.ok) continue;
        const certainty = r.gap <= SERVE.clearGapDepth && r.overlapShare >= 0.5 ? "clear" : "uncertain";
        links.push({ pieceId: piece.id, tableId: t.id, gapDepths: Math.round(r.gap * 100) / 100, overlap: Math.round(r.overlapShare * 100) / 100,
          facing: r.front === null ? "unknown" : "front", certainty });
        served.push(t.id);
      }
      const seats = Number.isFinite(piece.seats) && piece.seats > 0 && piece.seatsUnknown !== true ? piece.seats : null;
      piecesOut.push({ id: piece.id, type: piece.type, tables: served, seats, tablesOn, chairsOn });
    }
    const pieceById = new Map(piecesOut.map(p => [p.id, p]));
    const groups = tables.map(t => {
      const pieceIds = links.filter(l => l.tableId === t.id).map(l => l.pieceId);
      const chairIds = tableChairs.filter(s => s.table === t.id && !chairOn.has(s.id)).map(s => s.id);
      const shared = pieceIds.filter(id => pieceById.get(id).tables.length > 1);
      const unknown = pieceIds.filter(id => pieceById.get(id).seats === null);
      const seats = shared.length || unknown.length ? null
        : chairIds.length + pieceIds.reduce((n, id) => n + pieceById.get(id).seats, 0);
      return { tableId: t.id, pieceIds, chairIds, seats, sharedPieces: shared, seatsNotShown: unknown };
    }).filter(g => g.pieceIds.length);
    // The room's seats, each counted once: every chair not on a piece, and every
    // piece's drawn seats; pieces whose seats are not drawn are counted as such.
    const chairsCounted = tableChairs.filter(s => !chairOn.has(s.id)).length + loose.filter(s => !chairOn.has(s.id)).length;
    const room = {
      chairs: chairsCounted, cushionsNotCounted: chairOn.size,
      pieceSeats: piecesOut.reduce((n, p) => n + (p.seats || 0), 0),
      piecesSeatsNotShown: piecesOut.filter(p => p.seats === null).length,
    };
    // ONE question, the one whose answer moves the most: an uncertain link,
    // the piece with the most drawn seats first, then the longest piece.
    const uncertain = links.filter(l => l.certainty === "uncertain");
    const weight = l => [pieceById.get(l.pieceId).seats ?? -1, pf.get(l.pieceId).L];
    uncertain.sort((a, b) => weight(b)[0] - weight(a)[0] || weight(b)[1] - weight(a)[1] || (a.pieceId < b.pieceId ? -1 : 1));
    const q = uncertain[0];
    const question = q ? { kind: "seatingLink", pieceId: q.pieceId, tableId: q.tableId, questionType: "pieceServesTable",
      question: `Does this ${pieces.find(p => p.id === q.pieceId).type} seat guests at this table?` } : null;
    return { links, pieces: piecesOut, groups, room, question };
  }

  globalThis.MeritPlanIntelGroups = Object.freeze({ buildDifficultQuestions, buildFurnitureGroups, buildReviewGroups, buildSeatingLinks, buildSimilarityGroups });
})();
