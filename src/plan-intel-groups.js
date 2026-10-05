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
  function buildFurnitureGroups(tableCandidates, decisions = []) {
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
        const gap = GEOM.gapBetween(a, b), threshold = Math.min(a.w, a.h, b.w, b.h) * 0.28;
        if (gap <= threshold && GEOM.aligned(a, b)) union(i, j);
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

  globalThis.MeritPlanIntelGroups = Object.freeze({ buildDifficultQuestions, buildFurnitureGroups, buildReviewGroups, buildSimilarityGroups });
})();
