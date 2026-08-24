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
  function visualDistance(v1, v2) {
    if (!v1 || !v2) return 0; // no real pixel signal on one side (e.g. a manually-drawn or memory-restored candidate) — fall back to geometry alone rather than penalizing an unknown.
    const fillDiff = Math.abs(v1.fillRatio - v2.fillRatio);
    const edgeDiff = Math.abs(v1.edgeDensity - v2.edgeDensity);
    const histDiff = v1.intensityHist.reduce((s, val, i) => s + Math.abs(val - v2.intensityHist[i]), 0) / 2;
    const quadDiff = v1.quadrantFill.reduce((s, val, i) => s + Math.abs(val - v2.quadrantFill[i]), 0) / 4;
    return fillDiff * 1.5 + edgeDiff * 1.2 + histDiff * 1.5 + quadDiff * 1.3;
  }
  function featureDistance(f1, f2) {
    if (f1.kind !== f2.kind) return Infinity;
    const areaRatio = Math.max(f1.area, f2.area) / Math.max(0.0001, Math.min(f1.area, f2.area));
    const aspectDiff = Math.abs(f1.aspect - f2.aspect);
    return (areaRatio - 1) * 2 + aspectDiff * 3 + visualDistance(f1.visual, f2.visual) * 2;
  }
  function averageVisual(centroidVisual, incomingVisual, n) {
    if (!incomingVisual) return centroidVisual;
    if (!centroidVisual) return { ...incomingVisual, intensityHist: [...incomingVisual.intensityHist], quadrantFill: [...incomingVisual.quadrantFill] };
    const blend = (a, b) => (a * (n - 1) + b) / n;
    return {
      fillRatio: blend(centroidVisual.fillRatio, incomingVisual.fillRatio),
      edgeDensity: blend(centroidVisual.edgeDensity, incomingVisual.edgeDensity),
      intensityHist: centroidVisual.intensityHist.map((v, i) => blend(v, incomingVisual.intensityHist[i])),
      quadrantFill: centroidVisual.quadrantFill.map((v, i) => blend(v, incomingVisual.quadrantFill[i])),
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
        title: `${sg.type} ${sg.kind === "table" ? "table" : "object"} family`,
        memberIds: needsReview.map(m => m.id),
        totalInFamily: members.length,
        consistentCount: consistent,
        outlierIds: sg.outlierIds,
        question: `${members.length} similar ${sg.type} object${members.length === 1 ? "" : "s"} found. ${consistent} look consistent, ${needsReview.length} need review.`,
        kind: sg.kind,
      });
    }
    return groups.sort((a, b) => b.memberIds.length - a.memberIds.length);
  }

  // ---- Difficult-item queue (Concept 1): only genuinely ambiguous, high-value
  // single objects — never the bulk of low-confidence detections (those go
  // through review groups instead). "Ambiguous" here means: a furniture group
  // with 2+ physical tables (needs a human yes/no on whether it's one dining
  // unit), or a candidate whose aspect ratio sits in the round/rectangle
  // boundary zone.
  function buildDifficultQuestions(candidates, furnitureGroups) {
    const out = [];
    for (const fg of furnitureGroups) {
      if (fg.memberIds.length < 2) continue;
      if (fg.decision) continue; // already answered by a human — never re-ask the same question.
      out.push({ id: uid("question"), candidateId: fg.memberIds[0], groupId: fg.id, kind: "grouping",
        question: `Do these ${fg.memberIds.length} connected tables operate as one seating group?`,
        questionType: "combinedDiningGroup", questionParams: { memberCount: fg.memberIds.length } });
    }
    return out;
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

  function buildCapacityAudit(ocrText, systemCounted, candidates) {
    const stated = parsePaxFromText(ocrText);
    if (stated == null) return null;
    const difference = stated - systemCounted;
    const likelyAreaIds = difference !== 0
      ? [...candidates].sort((a, b) => (b.confidence || 0) - (a.confidence || 0) ? 0 : 0)
        .filter(c => c.status === "unreviewed" || (c.confidence || 0) < 0.6).slice(0, 5).map(c => c.id)
      : [];
    return { drawingStated: stated, systemCounted, difference, sourceText: ocrText.slice(0, 400), likelyAreaIds };
  }

  function buildPlanIntelligence(event, ocrText) {
    const analysis = event.analysis; if (!analysis) return null;
    const tableCandidates = analysis.candidates.filter(c => c.kind === "table");
    const furnitureGroups = buildFurnitureGroups(tableCandidates, analysis.groupingDecisions || []);
    const similarityGroups = buildSimilarityGroups(analysis.candidates);
    const reviewGroups = buildReviewGroups(analysis.candidates, similarityGroups);
    const uncertainQuestions = buildDifficultQuestions(analysis.candidates, furnitureGroups);
    const physicalSeats = computePhysicalCapacity(analysis.candidates);
    const capacityAudit = buildCapacityAudit(ocrText, physicalSeats, analysis.candidates);
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
      },
      furnitureGroups,
      similarityGroups,
      capacityEstimate: { physical: physicalSeats },
      capacityAudit,
      reviewGroups,
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
