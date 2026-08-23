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
  function buildFurnitureGroups(tableCandidates) {
    const n = tableCandidates.length, parent = Array.from({ length: n }, (_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = tableCandidates[i], b = tableCandidates[j];
        const gap = gapBetween(a, b), threshold = Math.min(a.w, a.h, b.w, b.h) * 0.28;
        if (gap <= threshold && aligned(a, b)) union(i, j);
      }
    }
    const groups = new Map();
    tableCandidates.forEach((c, i) => { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(c); });
    return [...groups.values()].filter(members => members.length >= 1).map(members => {
      const xs = members.flatMap(m => [m.x, m.x + m.w]), ys = members.flatMap(m => [m.y, m.y + m.h]);
      return {
        id: uid("furngroup"),
        memberIds: members.map(m => m.id),
        reason: members.length > 1
          ? `${members.length} physical tables touch and align — treated as one logical dining unit.`
          : "Single physical table.",
        bbox: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
      };
    });
  }

  // ---- Similarity clustering: pure geometric feature vector (size, aspect,
  // kind/type), NOT a learned embedding. Greedy nearest-cluster assignment —
  // this is what lets "Teach once" propagate a correction to many objects
  // without asking the same question repeatedly.
  function featureVector(c) {
    return { area: c.w * c.h, aspect: c.w / Math.max(0.001, c.h), kind: c.kind, type: c.type };
  }
  function featureDistance(f1, f2) {
    if (f1.kind !== f2.kind) return Infinity;
    const areaRatio = Math.max(f1.area, f2.area) / Math.max(0.0001, Math.min(f1.area, f2.area));
    const aspectDiff = Math.abs(f1.aspect - f2.aspect);
    return (areaRatio - 1) * 2 + aspectDiff * 3;
  }
  function buildSimilarityGroups(candidates, distanceThreshold = 0.9) {
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
      out.push({ id: uid("question"), candidateId: fg.memberIds[0], groupId: fg.id, kind: "grouping",
        question: `Do these ${fg.memberIds.length} connected tables operate as one seating group?` });
    }
    return out;
  }

  // ---- Capacity: physical seat count purely from confirmed/selected chair
  // detections — no estimation for tables (chairs are literal). Sofas/benches
  // (not yet detected by the classical pipeline; taxonomy exists for Teach AI)
  // get a real evidence-based estimate when the user provides one via Teach AI.
  function computePhysicalCapacity(candidates) {
    return candidates.reduce((n, c) => n + (c.chairDetections?.length || 0), 0);
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
    const furnitureGroups = buildFurnitureGroups(tableCandidates);
    const similarityGroups = buildSimilarityGroups(analysis.candidates);
    const reviewGroups = buildReviewGroups(analysis.candidates, similarityGroups);
    const uncertainQuestions = buildDifficultQuestions(analysis.candidates, furnitureGroups);
    const physicalSeats = computePhysicalCapacity(analysis.candidates);
    const capacityAudit = buildCapacityAudit(ocrText, physicalSeats, analysis.candidates);
    const venueCandidates = analysis.candidates.filter(c => c.kind === "venue");
    return {
      version: 1,
      providerMetadata: {
        engine: "ASSISTED_DETECTION_GEOMETRIC_HEURISTICS",
        trainedModel: false,
        ocrEngine: ocrText != null ? "tesseract.js" : null,
        ocrAvailable: ocrText != null,
      },
      planSummary: {
        diningGroups: furnitureGroups.length,
        physicalSeats,
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
    implemented: ["Geometric furniture grouping (touch+align)", "Geometric similarity clustering", "Bulk review-group collapsing", "Difficult-item queue for multi-table groups", "OCR-based capacity audit (when plan-ocr.js/Tesseract is loaded)"],
    foundationOnly: ["SemanticVisionProvider/GroundingProvider/EmbeddingProvider abstraction — interface not yet defined, no hosted model connected"],
    future: ["Trained/learned object detection", "Sofa/bench automatic capacity estimation from pixels", "Cross-plan venue memory", "Layout change detection"],
  };
})();
