(() => {
  "use strict";
  // ============================================================
  // PlanIntelligenceResult — vendor-neutral contract
  // ============================================================
  // This module turns the raw classical-CV candidate list already produced
  // by runAssistedDetection() (app-v8.js) into a higher-level, still-honest
  // interpretation: which physical objects likely form one logical dining
  // group, which detections are visually similar enough to resolve together,
  // and whether the plan's own printed pax notes agree with what was
  // detected. Every number here is computed from real geometry/OCR — nothing
  // is a trained-model confidence score, and nothing is fabricated.
  //
  // Shape (kept intentionally close to a real production contract so a
  // future stronger provider — server-side detector, hosted vision model —
  // can populate the same fields without the UI layer changing):
  //
  // PlanIntelligenceResult = {
  //   version: 1,
  //   providerMetadata: { engine, trainedModel:false, ocrEngine, ocrAvailable },
  //   planSummary: { diningGroups, physicalSeats, stage, bar, entrances, lounge, reviewGroups },
  //   physicalObjects: [ candidateId... ]              // pass-through references
  //   furnitureGroups: [ { id, memberIds:[], reason, bbox } ]      // combined-table reasoning
  //   similarityGroups: [ { id, kind, type, memberIds:[], representativeId, outlierIds:[] } ]
  //   capacityEstimate: { physical, byGroup:[{groupId, seats, evidence}] }
  //   capacityAudit: { drawingStated:number|null, systemCounted, difference, sourceText, likelyAreaIds:[] } | null
  //   reviewGroups: [ { id, title, memberIds:[], question, kind } ]   // Concept 2 bulk review
  //   uncertainQuestions: [ { id, candidateId, question, kind } ]     // Concept 1 difficult-item queue
  // }

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
        const gap = gapBetween(a, b), threshold = Math.min(a.w, a.h, b.w, b.h) * 0.28;
        if (gap <= threshold && aligned(a, b)) union(i, j);
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

  // ---- Capacity: physical seat count purely from detected chair objects —
  // no estimation for tables (chairs are literal). Sofas/benches (not yet
  // detected by the classical pipeline; taxonomy exists for Teach AI) get a
  // real evidence-based estimate when the user provides one via Teach AI.
  //
  // Two real chair populations are counted, never double-counted: chairs
  // associated with a table (c.chairDetections, one chair belongs to at most
  // one table) and chairs the detector found on their own that no table could
  // claim (kind "venue", type "chair"). The second group used to be dropped
  // entirely, which is a direct contributor to an under-reported seat total on
  // a plan whose chairs are the number the operator actually needs. Rejected
  // candidates are excluded: a human said that object is not real.
  function computePhysicalCapacity(candidates) {
    return candidates.reduce((n, c) => {
      if (c.status === "rejected") return n;
      // A standalone chair object seats exactly one person.
      if (c.kind === "chair" || (c.kind === "venue" && c.type === "chair")) return n + 1;
      // Only tables seat people. A stage, a bar, or a stray printed label that
      // happened to have a chair associated with it must never inflate the
      // capacity the operator plans against.
      if (c.kind !== "table") return n;
      return n + (c.chairDetections?.length || 0);
    }, 0);
  }
  function countAssociatedSeats(candidates) {
    return candidates.reduce((n, c) => n + (c.status === "rejected" ? 0 : (c.chairDetections?.length || 0)), 0);
  }
  function countStandaloneChairs(candidates) {
    return candidates.filter(c => c.status !== "rejected" && c.kind === "venue" && c.type === "chair").length;
  }

  // ---- OCR capacity cross-check. Requires a real OCR engine (Tesseract.js,
  // loaded separately — see plan-ocr.js). If it isn't loaded, this returns
  // null rather than a fabricated number, per the project's AI-truthfulness
  // rule: never invent OCR results.
  function parsePaxFromText(text) {
    if (!text) return null;
    const matches = [...text.matchAll(/(\d{1,5})\s*(?:pax|kişi|seat|koltuk)/gi)].map(m => Number(m[1]));
    const totalMatch = text.match(/total[:\s]*([\d.,]+)\s*pax/i) || text.match(/toplam[:\s]*([\d.,]+)/i);
    const stated = totalMatch ? Number(totalMatch[1].replace(/[.,]/g, "")) : (matches.length ? Math.max(...matches) : null);
    return Number.isFinite(stated) ? stated : null;
  }

  // Rank the places a missing (or excess) seat is most likely hiding.
  //
  // The previous comparator was `(b.conf - a.conf) ? 0 : 0`, which evaluates
  // the difference only for truthiness and returns 0 either way. It therefore
  // never sorted anything: the "five most likely areas" were just the first
  // five candidates in detection order. This scores each candidate on real
  // evidence and sorts on that score.
  function rankSuspectRegions(candidates, difference) {
    const scored = candidates
      .filter(c => c.status !== "rejected" && c.status !== "confirmed")
      .map(c => {
        const reasons = [];
        let score = 0;
        // An object whose seat count is explicitly unknown is the strongest
        // explanation for a capacity gap -- a banquette nobody has counted.
        if (c.seats == null && (c.kind === "sofa" || c.kind === "bench" || c.kind === "banquette" ||
            c.type === "sofa" || c.type === "bench" || c.type === "banquette")) { score += 6; reasons.push("unverified seating furniture"); }
        // Chairs the association step could not attach to any table: real
        // detected seats that are currently contributing to nobody's total.
        if (c.unassociated) { score += 4; reasons.push("chair not associated with a table"); }
        // A table carrying no chairs at all on a plan where tables normally do.
        if (c.kind === "table" && !(c.chairDetections?.length)) { score += 3; reasons.push("table with no seats found"); }
        // Low confidence and never reviewed: the detector itself is unsure.
        const conf = c.confidence ?? 0;
        if (c.status === "unreviewed") { score += 1; reasons.push("not yet reviewed"); }
        if (conf < 0.5) { score += 2 * (0.5 - conf) / 0.5; reasons.push(`low confidence ${conf.toFixed(2)}`); }
        // Direction matters: if the drawing claims MORE than was counted, look
        // at things that might hide seats; if fewer, look at things that might
        // have invented them.
        if (difference > 0 && c.kind === "table" && (c.chairDetections?.length || 0) < 2) { score += 1; reasons.push("fewer seats than a table usually has"); }
        if (difference < 0 && (c.chairDetections?.length || 0) > 8) { score += 1; reasons.push("unusually many seats for one table"); }
        return { id: c.id, score: +score.toFixed(2), reasons };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
    return scored;
  }

  // Multi-source capacity reasoning: what the drawing says, what was physically
  // detected, what the logical seating groups imply, and what is admittedly
  // unknown. Every number is labelled with where it came from; none of them is
  // adjusted to make the others agree.
  function buildCapacityAudit(ocrText, systemCounted, candidates, furnitureGroups) {
    const stated = parsePaxFromText(ocrText);
    const unverifiedSeating = candidates.filter(c =>
      c.status !== "rejected" && c.seats == null &&
      ["sofa", "bench", "banquette"].includes(c.kind === "venue" ? c.type : c.kind));
    const logicalSeats = (furnitureGroups || []).reduce((n, g) => {
      const members = g.memberIds || [];
      return n + members.reduce((m, id) => {
        const c = candidates.find(x => x.id === id);
        return m + (c?.chairDetections?.length || 0);
      }, 0);
    }, 0);
    const audit = {
      physical: { seats: systemCounted, source: "chairs detected and associated to tables, plus standalone chairs" },
      logical: { seats: logicalSeats, groups: (furnitureGroups || []).length, source: "seats summed over logical seating groups" },
      unverified: unverifiedSeating.map(c => ({ id: c.id, kind: c.kind, type: c.type,
        note: "seat count not determinable from the drawing — needs a human answer" })),
      drawingStated: stated,
      difference: stated == null ? null : stated - systemCounted,
      sourceText: ocrText ? ocrText.slice(0, 400) : null,
      ocrAvailable: ocrText != null,
    };
    audit.suspectRegions = rankSuspectRegions(candidates, audit.difference ?? 0).slice(0, 8);
    // Kept for callers that already read this field.
    audit.likelyAreaIds = audit.suspectRegions.map(s => s.id);
    // With no OCR there is no stated number to compare against, but the
    // physical/logical/unverified breakdown is still real and worth returning.
    return (stated == null && !unverifiedSeating.length && !audit.suspectRegions.length) ? null : audit;
  }

  // ---- scene graph ---------------------------------------------------------
  // Explicit typed relationships derived from real geometry. Nothing here
  // asserts a relationship the pixels do not support: every edge records the
  // evidence that produced it, and objects with no qualifying evidence simply
  // get no edge rather than a guessed one.
  function buildSceneGraph(candidates, furnitureGroups) {
    const edges = [];
    const alive = candidates.filter(c => c.status !== "rejected");
    const tables = alive.filter(c => c.kind === "table");
    const byId = new Map(alive.map(c => [c.id, c]));

    // chair -> belongsTo -> table. The association already happened in the
    // detector (one chair, at most one table); this records it as a relation.
    for (const t of tables)
      for (const ch of t.chairDetections || [])
        edges.push({ from: ch.id || `${t.id}:chair:${Math.round(ch.x)}x${Math.round(ch.y)}`,
          type: "belongsTo", to: t.id, evidence: "chair-table association (nearest table within reach, one table per chair)" });

    // table -> touches -> table, and table -> partOf -> logical group.
    for (const g of furnitureGroups || []) {
      const members = (g.memberIds || []).filter(id => byId.has(id));
      if (members.length > 1) {
        for (let i = 0; i < members.length; i++)
          for (let j = i + 1; j < members.length; j++) {
            const a = byId.get(members[i]), b = byId.get(members[j]);
            if (gapBetween(a, b) <= Math.min(a.w, a.h, b.w, b.h) * 0.28 && aligned(a, b))
              edges.push({ from: members[i], type: "touches", to: members[j], evidence: "boxes within a fraction of a table of each other and axis-aligned" });
          }
      }
      for (const id of members)
        edges.push({ from: id, type: "partOf", to: g.id, evidence: g.decision ? `human answer: ${g.decision}` : "geometric grouping (touch + alignment)" });
    }

    // seating furniture -> faces -> logical group, when it runs alongside one.
    const seating = alive.filter(c => ["sofa", "bench", "banquette"].includes(c.kind === "venue" ? c.type : c.kind));
    for (const s of seating) {
      let best = null, bestGap = Infinity;
      for (const g of furnitureGroups || []) {
        if (!g.bbox) continue;
        const gap = gapBetween(s, g.bbox);
        if (gap < bestGap) { bestGap = gap; best = g; }
      }
      const reach = Math.max(s.w, s.h) * 0.9;
      if (best && bestGap <= reach)
        edges.push({ from: s.id, type: "faces", to: best.id, evidence: `runs alongside the group, gap ${bestGap.toFixed(1)} within reach ${reach.toFixed(1)}` });
    }

    const counts = edges.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {});
    return { edges, counts, nodeCount: alive.length };
  }

  // ---- semantic zones ------------------------------------------------------
  //
  // A plan is not a bag of objects. An operator reads a room as regions with a
  // job — this end is dining, that corner is bistro, the band is the stage —
  // and every number the product reports is easier to trust when it is attached
  // to a part of the room rather than to a total.
  //
  // Three rules this follows, and they are the whole design:
  //
  //   EVIDENCE OR NOTHING. Every zone carries the facts that typed it, in
  //   words. A region that satisfies no rule becomes an `unknown` zone and is
  //   still reported — a plan with a region nobody can name is exactly the
  //   thing an operator needs told, and silently dropping it would be the
  //   dishonest option.
  //
  //   PLAN-RELATIVE, NEVER ABSOLUTE. Clusters link at a fraction of THIS plan's
  //   own modal table size, so a zone is not a distance in pixels and survives
  //   an export at another scale.
  //
  //   NOTHING IS INFERRED FROM A NAME. An entrance zone exists only where OCR
  //   actually read entrance wording or a human confirmed an entrance object.
  //   Where OCR is unavailable there is no entrance zone, rather than a guessed
  //   one.
  const ZONE_LINK_OF_TABLE = 1.5;   // cluster link distance, in modal table sides
  const ENTRANCE_WORDS = /\b(giri[sş]|entrance|entry|exit|[cç][iı]k[iı][sş])\b/i;

  function buildZones(candidates, furnitureGroups, ocrText) {
    const alive = candidates.filter(c => c.status !== "rejected");
    const tables = alive.filter(c => c.kind === "table");
    const venues = alive.filter(c => c.kind === "venue");
    const zones = [];
    const bboxOf = list => {
      const xs = list.flatMap(c => [c.x, c.x + c.w]), ys = list.flatMap(c => [c.y, c.y + c.h]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    };
    const seatsOf = list => list.reduce((n, c) => n + (c.chairDetections || []).length, 0);
    const add = (type, members, confidence, evidence, extra = {}) => {
      if (!members.length) return;
      zones.push({ id: uid("zone"), type, confidence, evidence,
        memberIds: members.map(c => c.id), objects: members.length,
        seats: seatsOf(members), bbox: bboxOf(members), ...extra });
    };

    // -- stage, from objects the detector typed as stage ----------------------
    const stageObjects = venues.filter(c => c.type === "stage");
    if (stageObjects.length) {
      // Stage bands that touch are one performance area, not several.
      for (const cluster of clusterByGap(stageObjects, s => Math.max(s.w, s.h) * 0.6))
        add("stage", cluster, "strong",
          [`${cluster.length} stage object${cluster.length === 1 ? "" : "s"} detected`,
           "no seating is counted inside a stage"]);
    }

    // -- entrance, only where wording was actually read -----------------------
    const entranceObjects = venues.filter(c => c.type === "entrance");
    if (entranceObjects.length) {
      add("entrance", entranceObjects, "strong", ["objects confirmed as entrances"]);
    } else if (ocrText && ENTRANCE_WORDS.test(ocrText)) {
      // Read, but with no object to attach it to. Recorded as a zone with no
      // members and no box rather than invented somewhere plausible.
      zones.push({ id: uid("zone"), type: "entrance", confidence: "uncertain",
        evidence: ["entrance wording was read on the plan, but no entrance object was detected to place it"],
        memberIds: [], objects: 0, seats: 0, bbox: null });
    }

    // -- lounge: seating furniture that serves no table -----------------------
    const loungeFurniture = venues.filter(c => ["sofa", "bench", "banquette"].includes(c.type));
    const modalTableSide = tables.length
      ? (() => { const v = tables.map(t => Math.sqrt(t.w * t.h)).sort((a, b) => a - b); return v[v.length >> 1]; })()
      : 0;
    const link = (modalTableSide || 4) * ZONE_LINK_OF_TABLE;
    const standalone = loungeFurniture.filter(s =>
      !tables.some(t => gapBetween(s, t) <= Math.max(s.w, s.h) * 0.9));
    for (const cluster of clusterByGap(standalone, () => link))
      add("lounge", cluster, cluster.length > 1 ? "likely" : "uncertain",
        [`${cluster.length} seating object${cluster.length === 1 ? "" : "s"} with no table within reach`,
         "seat count on this furniture is unverified unless an operator entered it"],
        { seatsVerified: cluster.every(c => c.seatsConfidence === "verified") });

    // -- dining and bistro: clusters of tables, typed by what they are --------
    //
    // The zone's type comes from its members' modal table type, so a corner of
    // bistro tables reads as a bistro zone and the banquet floor reads as
    // dining. It is never "small tables = bistro": the tables were typed
    // upstream on evidence from three different stages, and this only reports
    // what they already are.
    for (const cluster of clusterByGap(tables, () => link)) {
      const types = cluster.reduce((m, c) => (m[c.type] = (m[c.type] || 0) + 1, m), {});
      const ranked = Object.entries(types).sort((a, b) => b[1] - a[1]);
      const [modalType, modalCount] = ranked[0];
      const share = modalCount / cluster.length;
      const seated = cluster.filter(c => (c.chairDetections || []).length > 0).length;
      const groups = (furnitureGroups || []).filter(g =>
        (g.memberIds || []).some(id => cluster.some(c => c.id === id))).length;
      const evidence = [
        `${cluster.length} table${cluster.length === 1 ? "" : "s"} standing together`,
        `${modalCount} of them typed ${modalType}`,
        `${seated} carry detected seats`,
      ];
      if (groups) evidence.push(`${groups} logical seating group${groups === 1 ? "" : "s"} inside it`);
      if (!seated) {
        // Tables nobody sits at are not a dining room. Say so rather than
        // guessing what the region is for.
        add("unknown", cluster, "uncertain",
          [...evidence, "no seats were detected at any of them, so what this area is for is undetermined"]);
        continue;
      }
      const type = modalType === "bistro" && share >= 0.5 ? "bistro" : "dining";
      add(type, cluster, share >= 0.8 ? "strong" : "likely", evidence, { modalTableType: modalType });
    }
    return zones;
  }

  // Single-linkage clustering with a caller-supplied link distance, so "these
  // things stand together" is a relation between real objects rather than a
  // grid laid over the plan.
  function clusterByGap(items, linkFor) {
    const remaining = items.slice(), clusters = [];
    while (remaining.length) {
      const cluster = [remaining.shift()];
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = remaining.length - 1; i >= 0; i--) {
          const c = remaining[i];
          if (cluster.some(m => gapBetween(m, c) <= Math.max(linkFor(m), linkFor(c)))) {
            cluster.push(c); remaining.splice(i, 1); grew = true;
          }
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  // ---- the whole-plan interpreter -----------------------------------------
  //
  // Everything above answers a question about one object, one pair or one
  // region. This answers questions about the DRAWING: what kind of room is
  // this, how many people does it seat, what is unresolved, what should a
  // person look at first. Those are the questions an operator actually opens
  // the plan with, and until now the product could answer none of them in
  // words.
  //
  // A fact is a claim, and a claim can be wrong, so every one carries:
  //
  //   strength    strong | likely | uncertain — and STRONG has to be earned.
  //               A strong fact is one where the evidence is direct and
  //               corroborated, so being wrong about it is a serious defect
  //               and benchmarks/interpreter/ scores it as one. Anything that
  //               depends on the detector having found everything is at best
  //               `likely`, because detection recall is not a certainty.
  //   provenance  which stage produced the evidence, in words.
  //   basis       the actual numbers, so nothing has to be taken on trust.
  //
  // Statements are structured (`key` + `params`), never pre-rendered English,
  // for the same reason review-group titles are: the domain layer does not
  // decide what language an operator reads.
  //
  // NOTHING HERE COUNTS AS A NEW MEASUREMENT. Every fact restates evidence
  // some earlier stage already produced. An interpreter that discovered new
  // objects would be a detector, and this is not one.
  function buildPlanFacts(candidates, zones, furnitureGroups, capacityAudit, physicalSeats, ocrText) {
    const alive = candidates.filter(c => c.status !== "rejected");
    const tables = alive.filter(c => c.kind === "table");
    const facts = [];
    const say = (id, key, params, strength, provenance, basis) =>
      facts.push({ id, key, params, strength, provenance, basis });
    // Where a claim's evidence came from, as a key rather than a sentence. It
    // is shown next to the claim, so it is operator-facing text and belongs in
    // the string table like everything else an operator reads.
    const prov = (key, params) => ({ key: `provenance.${key}`, params: params || {} });

    if (!tables.length && !zones.length) {
      say("empty", "fact.nothingFound", {}, "strong",
        [prov("nothingSurvived")], {});
      return facts;
    }

    // -- what kind of room ----------------------------------------------------
    const byType = tables.reduce((m, t) => (m[t.type] = (m[t.type] || 0) + 1, m), {});
    const rankedTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]);
    if (rankedTypes.length) {
      const [modalType, modalCount] = rankedTypes[0];
      const share = modalCount / tables.length;
      // Two claims, deliberately NOT one sentence, because they are not equally
      // safe and one strength cannot cover both.
      //
      // Which type dominates is a property of the DRAWING: a large majority
      // does not flip because a few tables were missed. How many tables there
      // are is bounded by detection recall and can never be better than it.
      //
      // Measured, when they were one `strong` fact: on the bistro fixture the
      // detector finds 18 of 23 tables, and the interpreter stated "18 tables,
      // most of them square" with certainty. The type half was right and the
      // count half was wrong by 22%, and bundling them made the product
      // confidently wrong — which is worse than saying less.
      say("tableTypeMix", "fact.tableTypeMix", { type: modalType, n: modalCount },
        share >= 0.6 ? "strong" : "likely",
        [prov("typeClassificationThreeStages")],
        { byType, share: +share.toFixed(2) });
      say("tableCount", "fact.tableCount", { total: tables.length }, "likely",
        [prov("tablesSurvivingDetection")],
        { total: tables.length });
      for (const [type, n] of rankedTypes.slice(1))
        say(`has:${type}`, "fact.alsoHas", { n, type }, "likely",
          [prov("typeClassification")], { count: n });
    }

    // -- seating --------------------------------------------------------------
    // Never `strong`: a seat count is exactly as complete as detection recall,
    // and claiming certainty about it would be the easiest lie in the product.
    const seatedTables = tables.filter(t => (t.chairDetections || []).length).length;
    say("seats", "fact.seats", { seats: physicalSeats, tables: tables.length }, "likely",
      [prov("chairsDetectedAssociated")],
      { physicalSeats, seatedTables });
    const unseated = tables.length - seatedTables;
    if (unseated > 0)
      say("unseated", "fact.unseatedTables", { n: unseated }, "likely",
        [prov("tablesWithNoChair")], { unseated });

    // -- logical groups -------------------------------------------------------
    const multi = (furnitureGroups || []).filter(g => (g.memberIds || []).length > 1);
    if (multi.length) {
      const biggest = multi.reduce((a, b) => ((b.memberIds || []).length > (a.memberIds || []).length ? b : a));
      say("groups", "fact.combinedTables",
        { groups: multi.length, largest: (biggest.memberIds || []).length }, "likely",
        [prov("touchAndAlign")],
        { groups: multi.length, largest: (biggest.memberIds || []).length });
    }

    // -- zones ----------------------------------------------------------------
    const zoneTypes = zones.reduce((m, z) => (m[z.type] = (m[z.type] || 0) + 1, m), {});
    for (const [type, n] of Object.entries(zoneTypes)) {
      if (type === "unknown") {
        say("zone:unknown", "fact.undeterminedAreas", { n }, "uncertain",
          [prov("noZoneRule")], { n });
        continue;
      }
      // A stage is an object the detector typed, so its presence is direct.
      // Dining and bistro areas are clusters, which depend on recall.
      say(`zone:${type}`, "fact.zone", { n, type }, type === "stage" ? "strong" : "likely",
        [prov("zoneTyped", { type })], { n });
    }

    // -- what the drawing itself says -----------------------------------------
    const stated = capacityAudit && capacityAudit.drawingStated;
    if (stated != null) {
      const diff = stated - physicalSeats;
      say("capacity", Math.abs(diff) <= Math.max(2, stated * 0.05) ? "fact.capacityAgrees" : "fact.capacityDiffers",
        { stated, counted: physicalSeats, difference: Math.abs(diff) },
        // OCR read a number off the page: what the PLAN says is direct
        // evidence, whatever the detector counted.
        "strong",
        [prov("paxFromOcr"), prov("seatsCounted")],
        { stated, counted: physicalSeats, difference: diff });
    } else if (capacityAudit && capacityAudit.ocrAvailable === false) {
      say("capacityUnknown", "fact.noStatedCapacity", {}, "strong",
        [prov("ocrDidNotRun")], {});
    }
    const unverified = (capacityAudit && capacityAudit.unverified) || [];
    if (unverified.length)
      say("unverifiedSeating", "fact.unverifiedSeating", { n: unverified.length }, "strong",
        [prov("unreadableCapacity")],
        { ids: unverified.map(u => u.id) });

    return facts;
  }

  // ---- contradictions ------------------------------------------------------
  //
  // Everything above this point is a pipeline stage stating what IT found. Each
  // one is honest on its own terms and each one can be wrong, and the product
  // had no way to notice when two of them could not both be right. The
  // interpreter would then say "112 seats" and "6 tables nobody sits at" in the
  // same confident voice, on the same screen, and leave the operator to spot
  // that those are the same failure described twice.
  //
  // A contradiction here is a specific thing, not a low score: TWO STAGES THAT
  // CANNOT BOTH BE RIGHT. So every entry names both sides and where each came
  // from. A stage merely being unsure is not a contradiction — that is what
  // `strength` already carries.
  //
  // Nothing is deleted, reclassified or re-detected on this evidence. A
  // contradiction lowers the confidence of the claims it undermines and goes to
  // the top of the review queue, because the resolution belongs to the person
  // looking at the drawing.
  const CONTRADICTION_KINDS = ["COUNT", "TYPE", "RELATIONSHIP", "ZONE", "CAPACITY", "MEMORY", "SEMANTIC"];
  const ORPHAN_SEAT_SHARE = 0.15;   // of all detected seats, before it is a disagreement rather than a few stragglers
  const FAMILY_MIN_FOR_OUTLIER = 4; // a "family" of three cannot have a meaningful outlier
  // A disagreement about a handful of objects does not undermine a claim about
  // what the room MOSTLY is. Three mistyped tables out of forty-six do not make
  // "most of them are square" doubtful, and downgrading it anyway would make
  // `uncertain` mean nothing — the same failure as calling everything `strong`,
  // in the other direction. So a contradiction lowers a claim's confidence only
  // when it is large enough to change that claim.
  const MATERIAL_SHARE = 0.2;

  function buildContradictions(ctx) {
    const { candidates, zones, facts, furnitureGroups, similarityGroups,
            capacityAudit, physicalSeats, memoryConflicts } = ctx;
    const alive = candidates.filter(c => c.status !== "rejected");
    const tables = alive.filter(c => c.kind === "table");
    const out = [];
    const factIds = new Set(facts.map(f => f.id));
    const say = (id, kind, key, params, severity, sides, affects, targetIds) => {
      out.push({ id, kind, key, params, severity,
        sides, affects: affects.filter(a => factIds.has(a)), targetIds: targetIds || [] });
    };
    // One side of a disagreement: which stage said it, and what it said —
    // structured, never a pre-rendered sentence. The domain layer does not
    // decide what language an operator reads, and a `from` that is a literal
    // string would put English underneath a Turkish headline.
    const side = (from, claim, params, fromParams) => ({
      from: `contradiction.from.${from}`, fromParams: fromParams || null,
      claim: `contradiction.claim.${claim}`, params: params || {},
    });
    // Which claims a disagreement over `n` tables is big enough to move. A
    // count is disputed by any wrong object; a claim about the dominant type is
    // not, until enough of them are wrong to shift the majority.
    const tableClaims = n => tables.length && n / tables.length >= MATERIAL_SHARE
      ? ["tableCount", "tableTypeMix"] : ["tableCount"];

    // -- COUNT: seats the table pass could not place ---------------------------
    const standaloneChairs = alive.filter(c => c.kind === "venue" && c.type === "chair");
    const associated = tables.reduce((n, t) => n + (t.chairDetections || []).length, 0);
    const totalSeats = associated + standaloneChairs.length;
    const orphanShare = totalSeats ? standaloneChairs.length / totalSeats : 0;
    if (orphanShare > ORPHAN_SEAT_SHARE)
      say("contra:orphanSeats", "COUNT", "contradiction.orphanSeats",
        { orphans: standaloneChairs.length, total: totalSeats }, "medium",
        [side("chairDetection", "seatsExist", { n: totalSeats }),
         side("chairAssociation", "seatsPlaced", { n: associated })],
        ["seats", "tableCount"], standaloneChairs.map(c => c.id));

    // Tables with nobody at them AND seats with nowhere to sit, at the same
    // time, is not two facts. It is one association failure told twice.
    const unseated = tables.filter(t => !(t.chairDetections || []).length);
    if (unseated.length && standaloneChairs.length)
      say("contra:emptyTablesOrphanSeats", "COUNT", "contradiction.emptyTablesOrphanSeats",
        { tables: unseated.length, seats: standaloneChairs.length },
        // Two tables out of fifty is a couple of stragglers; a fifth of the
        // room is an association failure.
        unseated.length / Math.max(1, tables.length) >= MATERIAL_SHARE ? "high" : "medium",
        [side("tableDetection", "tablesNoSeat", { n: unseated.length }),
         side("chairDetection", "seatsNoTable", { n: standaloneChairs.length })],
        // Always disputes the count of tables nobody sits at, since that is
        // literally what it is about. Disputes the seat TOTAL only when enough
        // seats are unplaced to move it.
        orphanShare > ORPHAN_SEAT_SHARE ? ["unseated", "seats"] : ["unseated"],
        unseated.map(t => t.id));

    // -- TYPE: the learned encoder disagrees with the classifier ---------------
    //
    // The one genuinely independent opinion in the pipeline: it reasons about
    // appearance, every other stage reasons about geometry. Measured on the
    // degraded renderings, it flags invented tables and leaves the real ones
    // alone (benchmarks/embedding/SECOND-OPINION.md).
    const visualDisagree = tables.filter(t => t.visualEvidence && t.visualEvidence.agreement === "disagree");
    if (visualDisagree.length) {
      const tier = visualDisagree[0].visualEvidence.nearestTier;
      say("contra:visualClass", "TYPE", "contradiction.visualClass",
        { n: visualDisagree.length }, tier === "verified" ? "high" : "medium",
        [side("detectionAndShape", "theseAreTables", { n: visualDisagree.length }),
         side("visualSecondOpinion", "lookLikeOthers", {}, { tier: `contradiction.tier.${tier}` })],
        tableClaims(visualDisagree.length), visualDisagree.map(t => t.id));
    }

    // -- TYPE: a family member typed unlike its own family ---------------------
    const byId = new Map(alive.map(c => [c.id, c]));
    const outliers = [];
    for (const g of similarityGroups || []) {
      const members = (g.memberIds || []).map(id => byId.get(id)).filter(c => c && c.kind === "table");
      if (members.length < FAMILY_MIN_FOR_OUTLIER) continue;
      const types = members.reduce((m, c) => (m[c.type] = (m[c.type] || 0) + 1, m), {});
      const [modal] = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
      for (const c of members) if (c.type !== modal) outliers.push({ id: c.id, type: c.type, family: modal });
    }
    if (outliers.length)
      say("contra:familyOutlier", "TYPE", "contradiction.familyOutlier",
        { n: outliers.length }, "medium",
        [side("similarityClustering", "oneFamily"),
         side("shapeClassification", "typedDifferently")],
        tableClaims(outliers.length).filter(id => id === "tableTypeMix"), outliers.map(o => o.id));

    // -- RELATIONSHIP: one physical unit, more than one type -------------------
    const multiGroups = (furnitureGroups || []).filter(g => (g.memberIds || []).length > 1);
    const mixedGroups = multiGroups.filter(g => {
      const members = (g.memberIds || []).map(id => byId.get(id)).filter(Boolean);
      return new Set(members.map(c => c.type)).size > 1;
    });
    if (mixedGroups.length)
      say("contra:mixedGroupTypes", "RELATIONSHIP", "contradiction.mixedGroupTypes",
        { n: mixedGroups.length }, "medium",
        [side("geometricGrouping", "oneUnit"),
         side("shapeClassification", "differentKinds")],
        (mixedGroups.length / Math.max(1, multiGroups.length) >= MATERIAL_SHARE ? ["groups"] : [])
          .concat(tableClaims(mixedGroups.flatMap(g => g.memberIds || []).length)
            .filter(id => id === "tableTypeMix")),
        mixedGroups.flatMap(g => g.memberIds || []));

    // -- RELATIONSHIP: an object that contains its own seats -------------------
    //
    // The detection pass already declines to commit these (app-v8's seat
    // containment gate, measured at 129 invented tables held and zero real ones
    // across eleven renderings). This is the same finding stated to the
    // operator: the chair pass says "seat", the table pass says "table with a
    // seat inside it", and those cannot both describe one object.
    const seatsInside = tables.filter(t => t.lowEvidence && t.lowEvidence.reason === "seatsInsideBody");
    if (seatsInside.length)
      say("contra:seatsInsideBody", "RELATIONSHIP", "contradiction.seatsInsideBody",
        { n: seatsInside.length }, "high",
        [side("tableDetection", "proposedTable", { n: seatsInside.length }),
         side("chairAssociation", "seatsAround")],
        tableClaims(seatsInside.length), seatsInside.map(t => t.id));

    // -- ZONE: a table standing on the stage -----------------------------------
    //
    // Deliberately object containment, not zone-box overlap. A zone's box is
    // the axis-aligned hull of a cluster, so on any real plan the dining hull
    // spans the room and touches the stage's hull — the first version of this
    // check fired on the clean original and flagged an entire correct dining
    // area. Overlapping hulls are not evidence of anything; a table whose
    // centre sits inside a detected stage is.
    const stageObjects = alive.filter(c => c.kind === "venue" && c.type === "stage");
    const onStage = tables.filter(t => stageObjects.some(s => containsCentre(s, t)));
    if (onStage.length)
      say("contra:seatingInStage", "ZONE", "contradiction.seatingInStage",
        { n: onStage.length }, "high",
        [side("stageDetection", "stageNoSeating"),
         side("tableDetection", "tablesInside", { n: onStage.length })],
        ["zone:stage"].concat(tableClaims(onStage.length)), onStage.map(t => t.id));

    // -- ZONE: a table the zone pass never placed ------------------------------
    // Zones are built by clustering every surviving table, so a table in no
    // zone means the two stages are looking at different object sets.
    const zoned = new Set(zones.flatMap(z => z.memberIds || []));
    const unzoned = tables.filter(t => !zoned.has(t.id));
    if (unzoned.length)
      say("contra:unzonedTables", "ZONE", "contradiction.unzonedTables",
        { n: unzoned.length }, "medium",
        [side("tableDetection", "tablesOnPlan", { n: tables.length }),
         side("semanticZones", "belongNoArea", { n: unzoned.length })],
        tableClaims(unzoned.length), unzoned.map(t => t.id));

    // -- CAPACITY: the drawing's own number against the counted one ------------
    const capacity = facts.find(f => f.id === "capacity");
    if (capacity && capacity.key === "fact.capacityDiffers")
      say("contra:capacity", "CAPACITY", "contradiction.capacity",
        { stated: capacity.params.stated, counted: capacity.params.counted,
          difference: capacity.params.difference }, "high",
        [side("drawingOcr", "statedPeople", { n: capacity.params.stated }),
         side("countedSeats", "countedPeople", { n: capacity.params.counted })],
        ["capacity", "seats"], (capacityAudit && capacityAudit.likelyAreaIds) || []);

    // An agreement that rests on furniture whose capacity nobody has read is
    // not an agreement, it is a coincidence that has not been checked.
    const unverified = (capacityAudit && capacityAudit.unverified) || [];
    if (capacity && capacity.key === "fact.capacityAgrees" && unverified.length)
      say("contra:capacityUnverified", "CAPACITY", "contradiction.capacityUnverified",
        { n: unverified.length, counted: physicalSeats }, "medium",
        [side("capacityAudit", "totalsMatch"),
         side("seatingInventory", "unknownCapacity", { n: unverified.length })],
        ["capacity", "unverifiedSeating"], unverified.map(u => u.id));

    // -- MEMORY: the operator and the detector, on the same object -------------
    const overruled = (memoryConflicts || []).filter(c => c.kind === "overruled");
    if (overruled.length)
      say("contra:memoryOverruled", "MEMORY", "contradiction.memoryOverruled",
        { n: overruled.length }, "medium",
        [side("thisAnalysis", "proposedAgain"),
         side("yourCorrections", "alreadyChanged")],
        tableClaims(overruled.length), overruled.map(c => c.candidateId));
    const lost = (memoryConflicts || []).filter(c => c.kind === "lost");
    if (lost.length)
      say("contra:memoryLost", "MEMORY", "contradiction.memoryLost",
        { n: lost.length }, "high",
        [side("yourConfirmations", "objectsReal", { n: lost.length }),
         side("thisAnalysis", "notFoundNow")],
        ["tableCount", "seats"], []);

    // -- SEMANTIC: facts that cannot all hold ---------------------------------
    const diningZones = zones.filter(z => ["dining", "bistro"].includes(z.type)).length;
    if (tables.length && !diningZones)
      say("contra:tablesNoDining", "SEMANTIC", "contradiction.tablesNoDining",
        { tables: tables.length }, "medium",
        [side("tableDetection", "tablesFound", { n: tables.length }),
         side("semanticZones", "noDiningArea")],
        // Disputes neither the count nor the type mix — it disputes what the
        // room IS, and the interpreter states no fact about that to lower. It
        // goes to the review queue on its own.
        [], []);

    // -- a claim resting entirely on disputed objects -------------------------
    //
    // "Also 2 rectangle" is a claim about two tables. If half of them are
    // objects another stage says are typed wrong, the sentence is not a finding
    // about the room so much as the dispute restated as fact. Measured: on the
    // real plan that claim IS the interpreter's one remaining wrong one
    // (benchmarks/interpreter/), and one of its two tables is exactly what the
    // grouping check points at.
    //
    // Half, rather than all, because these are minority claims resting on a
    // handful of objects — a bistro claim backed by five tables survives one
    // disputed member, a rectangle claim backed by two does not. The claim is
    // lowered in confidence, never removed: a minority type that turns out to
    // be real is exactly what an operator needs to see.
    const DISPUTED_SUPPORT_SHARE = 0.5;
    const disputed = new Set(out.flatMap(c => c.targetIds));
    for (const f of facts) {
      if (!f.id.startsWith("has:")) continue;
      const supporting = tables.filter(t => t.type === f.id.slice(4));
      if (!supporting.length) continue;
      const share = supporting.filter(t => disputed.has(t.id)).length / supporting.length;
      if (share < DISPUTED_SUPPORT_SHARE) continue;
      for (const c of out)
        if (supporting.some(t => c.targetIds.includes(t.id))) c.affects.push(f.id);
    }

    return out;
  }

  function containsCentre(outer, inner) {
    const cx = inner.x + inner.w / 2, cy = inner.y + inner.h / 2;
    return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h;
  }

  // A claim that another stage disagrees with is not as safe as one that stands
  // unopposed, and saying it in the same voice is the failure this whole engine
  // exists to prevent. One step down per DISTINCT disagreeing kind: two
  // instances of the same kind are one disagreement seen twice, and would
  // otherwise let a plan with many similar objects bury every claim it makes.
  const STRENGTH_ORDER = ["strong", "likely", "uncertain"];
  function applyContradictions(facts, contradictions) {
    const kindsByFact = new Map();
    for (const c of contradictions)
      for (const id of c.affects) {
        if (!kindsByFact.has(id)) kindsByFact.set(id, new Set());
        kindsByFact.get(id).add(c.kind);
      }
    for (const f of facts) {
      const kinds = kindsByFact.get(f.id);
      if (!kinds || !kinds.size) continue;
      const from = STRENGTH_ORDER.indexOf(f.strength);
      if (from < 0) continue;
      f.contradictedBy = contradictions.filter(c => c.affects.includes(f.id)).map(c => c.id);
      f.strengthBefore = f.strength;
      f.strength = STRENGTH_ORDER[Math.min(STRENGTH_ORDER.length - 1, from + kinds.size)];
    }
    return facts;
  }

  // What a person should look at first, and why.
  //
  // Ordered by what an unresolved item COSTS, not by how many there are: a
  // capacity disagreement can invalidate a whole plan, an undetermined area is
  // a part of the room nobody has named, and a review group is a batch of
  // ordinary confirmations. Each priority points at real ids so the UI can
  // take a person straight there rather than describing the problem at them.
  // Two stages that cannot both be right outrank everything else on this list.
  // An ordinary review group is a batch of confirmations a person could work
  // through in any order; a contradiction is the product telling them it does
  // not know something it appears to know, and it stays wrong until someone
  // looks.
  //
  // Within a rank, order by WHAT ONE ANSWER SETTLES. Every item here costs the
  // operator roughly the same — read it, look at the objects, decide — so the
  // only thing that separates them is how much of the plan stops being unknown
  // afterwards. That is deliberately measured as three plain quantities and
  // compared lexicographically rather than folded into a weighted score:
  // "objects × 1 + seats × 0.5 + facts × 3" would be three invented constants
  // presented as a ranking.
  //
  //   facts   — claims on screen that this answer could settle. A wrong
  //             sentence an operator has already read is the most expensive
  //             thing on the list.
  //   objects — how many candidates the answer reaches, including propagation:
  //             confirming a family of twelve is one decision, not twelve.
  //   seats   — how many people hang on those objects, since a ten-top and a
  //             two-top are not the same mistake.
  //
  // The tiebreak is a rounded geometry signature, never an id: candidate ids
  // are regenerated on every analysis, so ordering on them would reshuffle the
  // queue on a re-run of the identical plan.
  function buildReviewPriorities(facts, zones, reviewGroups, uncertainQuestions, capacityAudit, contradictions, candidates) {
    const out = [];
    const byId = new Map((candidates || []).filter(c => c.status !== "rejected").map(c => [c.id, c]));
    const seatsOf = ids => ids.reduce((n, id) => {
      const c = byId.get(id);
      if (!c) return n;
      const seats = (c.chairDetections || []).length;
      return n + (seats || (c.kind === "venue" && c.type === "chair" ? 1 : 0));
    }, 0);
    const signature = ids => ids.map(id => byId.get(id)).filter(Boolean)
      .map(c => `${Math.round(c.x)},${Math.round(c.y)}`).sort().join(";");
    const impact = (targetIds, factCount, reach) => ({
      objects: Math.max(reach || 0, new Set(targetIds).size),
      seats: seatsOf(targetIds),
      facts: factCount || 0,
    });
    const push = (item, targetIds, factCount, reach) => {
      item.targetIds = targetIds;
      item.downstreamImpact = impact(targetIds, factCount, reach);
      item.signature = signature(targetIds);
      // The position this item was built in, before any sorting. Kept so the
      // ordering can be compared against the one it replaced without a
      // benchmark having to guess how the list used to be assembled — the
      // first attempt at that reconstructed the order from the already-sorted
      // list, which made the two orderings identical by construction and the
      // comparison meaningless.
      item.buildOrder = out.length;
      out.push(item);
    };
    for (const c of contradictions || [])
      push({ id: `priority:${c.id}`, key: "priority.contradiction",
        rank: c.severity === "high" ? 0 : 2,
        params: { kind: `contradiction.kind.${c.kind}` }, contradictionId: c.id,
        // Developer-facing, and English on purpose: `why` explains the ordering
        // in diagnostics and benchmark output. What an operator reads is `key`.
        why: `${c.sides[0].from} and ${c.sides[1].from} cannot both be right` },
        c.targetIds || [], c.affects.length);
    const capacity = facts.find(f => f.id === "capacity");
    // Skipped when the contradiction engine already raised the same
    // disagreement, so the operator is not shown one problem as two.
    const capacityRaised = (contradictions || []).some(c => c.id === "contra:capacity");
    if (capacity && capacity.key === "fact.capacityDiffers" && !capacityRaised)
      push({ id: "priority:capacity", key: "priority.capacity", rank: 1,
        params: { difference: capacity.params.difference },
        why: "the drawing states a different number of people from the one counted" },
        (capacityAudit && capacityAudit.likelyAreaIds) || [], 2);
    const unknownZones = zones.filter(z => z.type === "unknown");
    if (unknownZones.length)
      push({ id: "priority:unknownZones", key: "priority.undeterminedAreas", rank: 3,
        params: { n: unknownZones.length },
        why: "part of the room has no determined purpose" },
        unknownZones.flatMap(z => z.memberIds), 1);
    const unverified = facts.find(f => f.id === "unverifiedSeating");
    if (unverified)
      push({ id: "priority:unverifiedSeating", key: "priority.unverifiedSeating", rank: 4,
        params: { n: unverified.params.n },
        why: "seating whose capacity only a person can supply" },
        unverified.basis.ids || [], 1);
    for (const q of uncertainQuestions || [])
      // A grouping answer reaches every arrangement it repeats across, not only
      // the one the question shows.
      push({ id: `priority:${q.id}`, key: "priority.question", rank: 5,
        params: { n: 1 }, why: "a grouping the detector could not resolve" },
        q.memberIds || [], 0, (q.memberIds || []).length * (q.coversGroups || 1));
    for (const g of reviewGroups || [])
      // Confirming a family is one decision that lands on every member of it,
      // not only the ones flagged for review — that is what makes it a batch.
      push({ id: `priority:${g.id}`, key: "priority.reviewGroup", rank: 6,
        params: { n: g.memberIds.length, type: g.titleParams && g.titleParams.type },
        why: "a batch of similar objects to confirm together" },
        g.memberIds, 0, g.totalInFamily);
    return out.sort((a, b) =>
      a.rank - b.rank
      || b.downstreamImpact.facts - a.downstreamImpact.facts
      || b.downstreamImpact.objects - a.downstreamImpact.objects
      || b.downstreamImpact.seats - a.downstreamImpact.seats
      || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0)
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  function buildPlanIntelligence(event, ocrText) {
    const analysis = event.analysis; if (!analysis) return null;
    const tableCandidates = analysis.candidates.filter(c => c.kind === "table");
    const furnitureGroups = buildFurnitureGroups(tableCandidates, analysis.groupingDecisions || []);
    const similarityGroups = buildSimilarityGroups(analysis.candidates);
    const reviewGroups = buildReviewGroups(analysis.candidates, similarityGroups);
    const uncertainQuestions = buildDifficultQuestions(analysis.candidates, furnitureGroups);
    const physicalSeats = computePhysicalCapacity(analysis.candidates);
    const capacityAudit = buildCapacityAudit(ocrText, physicalSeats, analysis.candidates, furnitureGroups);
    const sceneGraph = buildSceneGraph(analysis.candidates, furnitureGroups);
    const zones = buildZones(analysis.candidates, furnitureGroups, ocrText);
    const facts = buildPlanFacts(analysis.candidates, zones, furnitureGroups, capacityAudit, physicalSeats, ocrText);
    // Built from the facts, then applied back to them: a claim another stage
    // disagrees with stops being stated in the same voice as one nothing
    // disputes. Nothing is deleted or reclassified on this evidence.
    const contradictions = buildContradictions({
      candidates: analysis.candidates, zones, facts, furnitureGroups, similarityGroups,
      capacityAudit, physicalSeats, memoryConflicts: analysis.memoryConflicts || [],
    });
    applyContradictions(facts, contradictions);
    const reviewPriorities = buildReviewPriorities(facts, zones, reviewGroups, uncertainQuestions, capacityAudit, contradictions, analysis.candidates);
    const venueCandidates = analysis.candidates.filter(c => c.kind === "venue");
    // Which detection path actually ran is reported, not hidden: a chair-first
    // pass (chairs detected from their own colour/size model, then tables
    // inferred among them) and the table-first fallback have very different
    // reliability, and the operator is entitled to know which one produced the
    // number on screen. Passed straight through from the provider's real
    // diagnostics — never asserted when the provider did not report it.
    const diag = analysis.diagnostics || {};
    return {
      version: 1,
      providerMetadata: {
        engine: "ASSISTED_DETECTION_GEOMETRIC_HEURISTICS",
        trainedModel: false,
        detectionProvider: diag.provider || null,
        detectionPath: diag.detectionPath || null,
        chairSource: diag.chairSource || null,
        ocrEngine: ocrText != null ? "tesseract.js" : null,
        ocrAvailable: ocrText != null,
      },
      planSummary: {
        diningGroups: furnitureGroups.length,
        physicalSeats,
        associatedSeats: countAssociatedSeats(analysis.candidates),
        unassociatedChairs: countStandaloneChairs(analysis.candidates),
        detectionPath: diag.detectionPath || null,
        stage: venueCandidates.filter(c => c.type === "stage").length,
        bar: venueCandidates.filter(c => c.type === "bar").length,
        entrances: venueCandidates.filter(c => c.type === "entrance").length,
        reviewGroups: reviewGroups.length,
        zones: zones.length,
        zoneTypes: zones.reduce((m, z) => (m[z.type] = (m[z.type] || 0) + 1, m), {}),
      },
      furnitureGroups,
      // Regions of the room with a job, each carrying the evidence that typed
      // it. A region that satisfies no rule is reported as `unknown` rather
      // than dropped — see buildZones.
      zones,
      // What the whole drawing says, as claims a person can read and check.
      // Every fact carries its strength, its provenance and the numbers it
      // rests on; `strong` has to be earned. See buildPlanFacts.
      facts,
      // Where two stages of the pipeline cannot both be right. Each entry names
      // both sides and where each came from; none of them deletes or
      // reclassifies anything. See buildContradictions.
      contradictions,
      contradictionKinds: CONTRADICTION_KINDS,
      // What to look at first, and why, pointing at real ids.
      reviewPriorities,
      capacityEstimate: { physical: physicalSeats },
      capacityAudit,
      // Physical objects and logical seating groups are deliberately separate
      // structures: three tables pushed together stay three physical table
      // candidates that also appear as one logical group, and are never
      // replaced by a single invented rectangle.
      sceneGraph,
      reviewGroups,
      // The full similarity families, not just the ones that still need
      // review. Documented in the contract at the top of this file but never
      // actually returned, so a correction could only ever be spread across a
      // family that happened to be flagged. A family the detector already
      // considers consistent is exactly the one where a single correction
      // should repair every member.
      similarityGroups,
      uncertainQuestions,
    };
  }

  globalThis.buildPlanIntelligence = buildPlanIntelligence;
  globalThis.MERIT_PLAN_INTELLIGENCE_STATUS = {
    implemented: ["Geometric furniture grouping (touch+align)", "Similarity clustering using real pixel-derived visual descriptors (fill ratio, edge density, intensity histogram, quadrant fill signature) computed from the actual decoded plan image, not geometry alone — see computeVisualDescriptor() in app-v8.js", "Bulk review-group collapsing", "Difficult-item queue for multi-table groups", "OCR-based capacity audit (when plan-ocr.js/Tesseract is loaded)", "Grouping-question answers persist as real decisions (event.analysis.groupingDecisions) that force-split or force-merge tables on every recompute, and are undoable — never a log-only toast", "Current Plan Memory (event.planMemory, app-v8.js): reclassifications, confirm/reject, and manually-drawn missed objects are re-applied to freshly detected candidates after Re-Analyze by matching real geometry (position/size) — the underlying image and detector are deterministic, so this is a genuine match, not a fabricated one", "OCR-evidence false-positive suppression (app-v8.js suppressTextFalsePositives): a candidate whose area is dominated by real recognized OCR text is dropped unless it has real chair adjacency; table confidence also factors in real repetition (how many similarly-sized tables exist) and seat adjacency, not a flat raised threshold"],
    foundationOnly: ["VisualEmbeddingProvider from a real trained model (ONNX Runtime Web + a pretrained vision model such as MobileNetV2) — evaluated and confirmed technically fetchable in this environment (onnxruntime-web is on the npm registry; a real ~14MB MobileNetV2 ONNX model is reachable via media.githubusercontent.com), but not integrated this pass; the classical pixel-descriptor implementation above is a real, working, swappable stand-in behind the same interface shape, not a placeholder that does nothing", "SemanticVisionProvider/GroundingProvider abstraction — interface not yet defined, no hosted model connected"],
    future: ["Trained/learned object detection", "Sofa/bench automatic capacity estimation from pixels", "Cross-plan venue memory", "Layout change detection"],
  };
})();
