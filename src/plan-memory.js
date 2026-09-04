// Visual Plan Memory 2.0 — is this the same object the operator ruled on?
//
// The old answer was one distance: a remembered object and a freshly detected
// one are the same thing if their position-and-size vector is within a
// tolerance derived from the object's own short side. On the Golden Plan that
// retains 100% of corrections across a re-analysis, because the detector is
// deterministic and re-running it on identical pixels puts every box back
// within a fraction of a percent.
//
// That is the whole problem with it. It is not really identity matching, it is
// determinism matching, and it has only ever been asked the easy question. The
// moment the pixels differ — a JPEG round trip, a greyscale export, a plan
// re-issued with two tables moved — a box shifts by more than its tolerance and
// a human decision is silently lost. Worse, a box that shifts ONTO a different
// object inherits a decision that was never about it, which corrupts a plan
// while looking like it worked.
//
// So identity here is scored from several kinds of evidence, and the score is
// graded rather than thresholded into yes/no:
//
//   GEOMETRY   where it is and how big it is. Still the dominant signal,
//              because on an unchanged drawing it is nearly perfect and
//              nothing should move that.
//   SIZE       agreement on proportions, separately from position, so a box
//              that grew is distinguishable from one that moved.
//   VISUAL     cosine similarity of the LEARNED encoder's embedding of the
//              actual crop. This is what lets a moved object still be
//              recognised, and §24 of the sprint makes it mandatory rather
//              than optional — with the requirement that its contribution be
//              measured, and reported honestly if it turns out to be nothing.
//   CONTEXT    what stands around it. A table in the middle of a grid has a
//              neighbourhood signature that survives the whole grid shifting,
//              which is exactly the case geometry alone fails.
//   FAMILY     whether it is still the same kind of thing. EVIDENCE ONLY,
//              never a gate — see below.
//
// ---------------------------------------------------------------------------
// WHY FAMILY CANNOT BE A GATE
//
// The most valuable memory entry is a RECLASSIFICATION: the detector said
// table, the operator said chair. On the next run the detector will say table
// again, because it is deterministic and the pixels did not change. Requiring
// the kinds to match would make exactly the corrections that matter most
// impossible to re-apply. So a family mismatch lowers the score and never
// blocks the match.
//
// ---------------------------------------------------------------------------
// FOUR ANSWERS, NOT TWO
//
//   STRONG     re-apply. High score, clear margin over the runner-up.
//   LIKELY     re-apply. Good score, some margin.
//   AMBIGUOUS  DO NOT re-apply. Two candidates fit and picking one silently is
//              how a decision lands on the wrong object. It is reported so the
//              operator can settle it.
//   NONE       no match. Reported as a lost decision when the memory was a
//              confirmation, never fabricated back into existence.

(() => {
  "use strict";

  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

  function unit(v) {
    if (!v || !v.length) return null;
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    if (!(s > 0)) return null;
    const inv = 1 / Math.sqrt(s), out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
    return out;
  }
  function cosine(a, b) {
    const x = unit(a), y = unit(b);
    if (!x || !y || x.length !== y.length) return null;
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * y[i];
    return clamp(s, -1, 1);
  }

  // The tolerance the old matcher used, kept exactly, because it is the floor
  // this must not fall below on an unchanged plan.
  const TOLERANCE_OF_SIZE = 0.75, MIN_TOLERANCE = 0.5, MAX_TOLERANCE = 3;
  function toleranceFor(g) {
    return Math.max(MIN_TOLERANCE, Math.min(MAX_TOLERANCE, Math.min(g.w, g.h) * TOLERANCE_OF_SIZE));
  }
  // How far out a pair is even considered. Wider than the old hard gate on
  // purpose: an object that MOVED is beyond tolerance by definition, and a
  // matcher that cannot look past it cannot recognise one. Geometry alone does
  // not get an object back from out there — the score falls off with distance,
  // so a far match needs real visual and context support to reach a class that
  // re-applies.
  const SEARCH_OF_TOLERANCE = 3;
  const geometryDistance = (c, g) => Math.hypot(c.x - g.x, c.y - g.y, (c.w - g.w) * 0.5, (c.h - g.h) * 0.5);

  // What stands around an object, as a vector that survives the whole plan
  // shifting. Distances only, not bearings: a sorted distance vector is
  // rotation-invariant and stable under a small reflow, where bearings are
  // order-dependent and turn a two-pixel jitter into a large difference.
  const CONTEXT_K = 6;
  function contextSignature(target, others, k = CONTEXT_K) {
    const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
    const ds = [];
    for (const o of others) {
      if (o === target || (o.id && target.id && o.id === target.id)) continue;
      ds.push(Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy));
    }
    ds.sort((a, b) => a - b);
    const out = ds.slice(0, k);
    while (out.length < k) out.push(null);   // fewer neighbours than k is itself a signature
    return out.map(v => (v == null ? null : +v.toFixed(3)));
  }
  function contextSimilarity(a, b, scale) {
    if (!a || !b || !a.length || !b.length) return null;
    const n = Math.min(a.length, b.length);
    let sum = 0, used = 0;
    for (let i = 0; i < n; i++) {
      if (a[i] == null || b[i] == null) continue;   // a missing neighbour on one side is not a difference
      sum += Math.abs(a[i] - b[i]); used++;
    }
    if (!used) return null;
    return clamp(1 - (sum / used) / Math.max(scale, 0.5));
  }

  // Geometry dominates so that nothing moves on an unchanged plan, which is the
  // case that already worked and must keep working. Visual is next: it is the
  // only term that can survive a re-render, and it is the one §24 requires be
  // real rather than available.
  const W = { geometry: 1.4, size: 0.5, visual: 1.0, context: 0.6, family: 0.3 };
  // Grades. A match must clear BOTH a score and a margin: a score alone cannot
  // tell "this is clearly the object" from "two objects fit equally well", and
  // the second is how a decision quietly lands on the wrong one.
  const GRADE = {
    strong: { score: 0.78, margin: 0.08 },
    likely: { score: 0.62, margin: 0.04 },
    ambiguous: { score: 0.52, margin: 0 },
  };
  const APPLIES = new Set(["strong", "likely"]);

  function identity(memory, candidate, ctx) {
    const g = memory.geometry;
    const tol = toleranceFor(g), search = tol * SEARCH_OF_TOLERANCE;
    const dist = geometryDistance(candidate, g);
    if (dist > search) return null;
    const terms = {}, weights = {};

    terms.geometry = 1 - clamp(dist / search);
    weights.geometry = W.geometry;

    const sw = Math.min(candidate.w, g.w) / Math.max(candidate.w, g.w, 1e-6);
    const sh = Math.min(candidate.h, g.h) / Math.max(candidate.h, g.h, 1e-6);
    terms.size = clamp(sw * sh);
    weights.size = W.size;

    // How much the appearance and the surroundings are allowed to say depends
    // on how much geometry has already settled.
    //
    // This is not a hedge, it is the measurement. On this plan 37 of the tables
    // are near-identical squares, so the learned encoder rates every one of
    // them ~0.9 similar to every other. Given a co-equal vote, that compresses
    // the difference between the right object and its neighbour and pushes
    // correct matches over the ambiguity line: measured flat, the embedding
    // COST four decisions across the transformed plans and the neighbourhood
    // signature cost three.
    //
    // A learned embedding cannot tell one copy of an object from another copy
    // of the same object, and identity on a repetitive drawing is exactly that
    // question. Where it can help is the case geometry cannot reach at all — an
    // object that moved — so its say is scaled by how uncertain geometry is. At
    // the original position it contributes almost nothing; out where a box has
    // shifted past its own tolerance, it is most of the answer.
    const uncertainty = 1 - terms.geometry;
    const cos = cosine(memory.visual && memory.visual.vector, candidate.vector);
    if (cos !== null) {
      terms.visual = clamp((cos + 1) / 2);
      weights.visual = W.visual * uncertainty;
    }

    if (ctx && memory.context) {
      const sim = contextSimilarity(memory.context, ctx.signatureFor(candidate),
        Math.max(g.w, g.h) * 4);
      if (sim !== null) { terms.context = sim; weights.context = W.context * uncertainty; }
    }

    // Evidence, never a gate. A reclassification memory exists precisely
    // because the detector keeps proposing the wrong kind.
    terms.family = candidate.kind === memory.kind
      ? (candidate.type === memory.type ? 1 : 0.6)
      : 0.3;
    weights.family = W.family;

    let sum = 0, wsum = 0;
    for (const k in terms) { sum += terms[k] * weights[k]; wsum += weights[k]; }
    return {
      score: wsum ? sum / wsum : 0, terms, weights,
      distance: dist, tolerance: tol,
      withinOldTolerance: dist <= tol,
      visualUsed: cos !== null, contextUsed: terms.context !== undefined,
      visualCosine: cos,
    };
  }

  function gradeOf(score, margin) {
    if (score >= GRADE.strong.score && margin >= GRADE.strong.margin) return "strong";
    if (score >= GRADE.likely.score && margin >= GRADE.likely.margin) return "likely";
    if (score >= GRADE.ambiguous.score) return "ambiguous";
    return "none";
  }

  // memory:     [{ id, sourceCandidateId, kind, type, status, geometry, visual:{vector}, context:[…] }]
  // candidates: [{ id, kind, type, x, y, w, h, vector }]
  //
  // One memory matches at most one candidate and vice versa, assigned best
  // score first. The runner-up is kept for every match, because the margin is
  // what separates "the same object" from "one of two objects that fit".
  // When a plan is re-cropped or re-issued at another offset, EVERY object
  // moves by the same amount. Per-object identity cannot see that: each box is
  // individually beyond its own tolerance, so each is individually lost, and no
  // amount of appearance evidence recovers a decision when the appearance is
  // shared by thirty-six other tables.
  //
  // What does see it is the plan's own confident matches. If the handful that
  // still matched agree on a displacement, the drawing moved, and the same
  // displacement applies to the ones that did not. The agreement is the
  // evidence: a consistent shift is a re-crop, a scatter of unrelated shifts is
  // just noise and is ignored.
  // And a translation is not enough. Geometry is stored as a PERCENTAGE of the
  // plan image, so re-cropping the drawing changes the frame as well as the
  // position: the crop-pad variant is 1475x856 where the original is 1355x788,
  // and in percent space every object both moves and shrinks by ~1.086. Fitting
  // only a translation to that leaves a residual proportional to how far an
  // object is from the centre, which is why the first version of this recovered
  // nothing. A downscale, by contrast, preserves percentages exactly, which is
  // why that scenario never needed correcting.
  //
  // So the fit is a similarity transform — one scale and one offset — estimated
  // from the confident matches by median, which ignores the handful that
  // matched the wrong object.
  const SHIFT_MIN_MATCHES = 4;    // fewer than this cannot establish a transform
  const SHIFT_MIN = 0.3;          // percent — below this there is nothing to correct
  const SHIFT_MAX_SPREAD = 0.6;   // percent — residual spread above which it is not one transform
  const SCALE_LIMITS = [0.6, 1.6];
  const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
  function estimateShift(matches) {
    // Seeded from every confident match, not only the ones already inside the
    // old tolerance. Restricting it to those was tried and measured: it left
    // the re-cropped plan exactly where it was (19 retained, 8 wrong) and cost
    // the learned embedding its only measurable contribution, because the
    // anchors it kept were the ones that needed no correcting.
    const clear = matches.filter(m => m.grade === "strong" && m.dx !== undefined);
    if (clear.length < SHIFT_MIN_MATCHES) return null;
    const mem = clear.map(m => ({ x: m.memoryCentre.x, y: m.memoryCentre.y }));
    const cand = clear.map(m => ({ x: m.candidateCentre.x, y: m.candidateCentre.y }));
    // Scale from the ratio of pairwise separations. Pairs closer than a
    // percent of the plan are dropped: dividing by a tiny separation turns
    // sub-pixel noise into a wild ratio.
    const ratios = [];
    for (let i = 0; i < mem.length; i++) for (let j = i + 1; j < mem.length; j++) {
      const dm = Math.hypot(mem[i].x - mem[j].x, mem[i].y - mem[j].y);
      const dc = Math.hypot(cand[i].x - cand[j].x, cand[i].y - cand[j].y);
      if (dm > 1) ratios.push(dc / dm);
    }
    let s = ratios.length ? median(ratios) : 1;
    if (!(s >= SCALE_LIMITS[0] && s <= SCALE_LIMITS[1])) s = 1;
    const dx = median(cand.map((c, i) => c.x - s * mem[i].x));
    const dy = median(cand.map((c, i) => c.y - s * mem[i].y));
    // Residual after the fit: if one transform really describes the change,
    // every confident match lands close to where it predicts.
    const spread = Math.max(
      median(cand.map((c, i) => Math.abs(c.x - (s * mem[i].x + dx)))),
      median(cand.map((c, i) => Math.abs(c.y - (s * mem[i].y + dy)))));
    if (spread > SHIFT_MAX_SPREAD) return null;
    // Nothing worth correcting: the plan did not move.
    const moved = Math.hypot(dx + (s - 1) * 50, dy + (s - 1) * 50);
    if (Math.abs(s - 1) < 0.005 && moved < SHIFT_MIN) return null;
    return { scale: +s.toFixed(4), dx: +dx.toFixed(3), dy: +dy.toFixed(3),
      spread: +spread.toFixed(3), from: clear.length };
  }
  // Apply the fitted transform to a remembered box: its centre moves with the
  // transform and its size scales with it.
  function transformGeometry(g, t) {
    const cx = g.x + g.w / 2, cy = g.y + g.h / 2;
    const nx = t.scale * cx + t.dx, ny = t.scale * cy + t.dy;
    const nw = g.w * t.scale, nh = g.h * t.scale;
    return { ...g, x: nx - nw / 2, y: ny - nh / 2, w: nw, h: nh };
  }

  function matchOnce(memory, candidates, opts, ctx, corrected) {
    const useVisual = opts.visual !== false;
    const scored = [];
    for (const m of memory) {
      const rows = [];
      for (const c of candidates) {
        const r = identity(useVisual ? m : { ...m, visual: null }, c, ctx);
        if (r) rows.push({ memory: m, candidate: c, ...r });
      }
      rows.sort((a, b) => b.score - a.score || a.distance - b.distance);
      for (let i = 0; i < rows.length; i++)
        rows[i].margin = +(rows[i].score - (rows[i + 1] ? rows[i + 1].score : 0)).toFixed(4);
      if (rows.length) scored.push(...rows.slice(0, 3));
    }
    scored.sort((a, b) => b.score - a.score || a.distance - b.distance);

    const usedM = new Set(), usedC = new Set(), matches = [], rejected = [];
    for (const row of scored) {
      if (usedM.has(row.memory.id) || usedC.has(row.candidate.id)) continue;
      // A match found only after the remembered layout was corrected by a
      // fitted transform is a weaker claim than one found where the decision
      // was actually made: it depends on a model of how the whole drawing
      // moved, and that model is fitted, not observed. So after a correction
      // only STRONG applies — LIKELY becomes a question for the operator.
      //
      // Measured on the re-cropped plan, without this: 19 retained and 8 wrong,
      // with nothing reported as uncertain. Every remaining decision landed
      // confidently, some of them on the neighbouring table, and a wrongly
      // applied decision is invisible in a way a lost one is not.
      let grade = gradeOf(row.score, row.margin);
      if (corrected && grade === "likely") grade = "ambiguous";
      if (grade === "none") continue;
      usedM.add(row.memory.id); usedC.add(row.candidate.id);
      const rec = {
        memoryId: row.memory.id, candidateId: row.candidate.id, grade,
        applies: APPLIES.has(grade),
        score: +row.score.toFixed(4), margin: row.margin,
        distance: +row.distance.toFixed(3), tolerance: +row.tolerance.toFixed(3),
        withinOldTolerance: row.withinOldTolerance,
        visualUsed: row.visualUsed, visualCosine: row.visualCosine == null ? null : +row.visualCosine.toFixed(4),
        contextUsed: row.contextUsed,
        terms: Object.fromEntries(Object.entries(row.terms).map(([k, v]) => [k, +v.toFixed(3)])),
        reclassifies: row.candidate.kind !== row.memory.kind || row.candidate.type !== row.memory.type,
        // Where this candidate sits relative to where the decision was made.
        // Individually meaningless; collectively it is how a re-crop is seen.
        dx: +(row.candidate.x - row.memory.geometry.x).toFixed(3),
        dy: +(row.candidate.y - row.memory.geometry.y).toFixed(3),
        memoryCentre: { x: row.memory.geometry.x + row.memory.geometry.w / 2,
          y: row.memory.geometry.y + row.memory.geometry.h / 2 },
        candidateCentre: { x: row.candidate.x + row.candidate.w / 2,
          y: row.candidate.y + row.candidate.h / 2 },
      };
      (rec.applies ? matches : rejected).push(rec);
    }
    const unmatched = memory.filter(m => !usedM.has(m.id)).map(m => ({ memoryId: m.id, reason: "noMatch" }));
    return {
      matches, ambiguous: rejected, unmatched,
      stats: {
        memories: memory.length, candidates: candidates.length,
        applied: matches.length,
        byGrade: [...matches, ...rejected].reduce((acc, r) => (acc[r.grade] = (acc[r.grade] || 0) + 1, acc), {}),
        // The number that says whether looking past the old hard tolerance
        // bought anything: matches this found that the geometry-only matcher
        // could not have seen at all.
        beyondOldTolerance: matches.filter(m => !m.withinOldTolerance).length,
        visualAvailable: matches.filter(m => m.visualUsed).length,
        contextAvailable: matches.filter(m => m.contextUsed).length,
        lost: unmatched.length,
      },
    };
  }

  function match(memory, candidates, options) {
    const opts = options || {};
    const ctx = opts.context === false ? null : {
      signatureFor: c => contextSignature(c, candidates, opts.contextK || CONTEXT_K),
    };
    const first = matchOnce(memory, candidates, opts, ctx);
    // OFF BY DEFAULT, and that is a decision from the measurement rather than
    // an unfinished feature. Across the seven transformed renderings the
    // global-transform correction recovers 6 decisions and adds 3 that land on
    // the wrong object — retention 0.786 -> 0.816, identity precision
    // 0.945 -> 0.930. On the re-cropped plan specifically it retains 19 and
    // misapplies 8, with none of them reported as uncertain, because the fitted
    // transform lands each remaining decision confidently on a neighbour one
    // grid position away.
    //
    // A lost decision is visible: it is reported, and the operator re-makes it.
    // A wrongly applied one is invisible, and it corrupts a plan while looking
    // like the feature worked. Six recovered is not worth three of those.
    //
    // Kept, measurable, and opt-in (`{shift:true}`) so the next real plan can
    // re-decide this with its own evidence instead of re-deriving it.
    if (opts.shift !== true) return { ...first, shift: null };

    const shift = estimateShift(first.matches);
    if (!shift) return { ...first, shift: null };

    // The drawing appears to have moved as a whole. Re-ask the same question
    // with the remembered positions corrected by that transform.
    const moved = memory.map(m => ({ ...m, geometry: transformGeometry(m.geometry, shift) }));
    const second = matchOnce(moved, candidates, opts, ctx, true);
    // Accept it only if it actually recovers decisions. A correction that makes
    // things worse is a wrong correction, and the first answer stands.
    if (second.matches.length <= first.matches.length) return { ...first, shift: { ...shift, applied: false } };
    return { ...second, shift: { ...shift, applied: true, recovered: second.matches.length - first.matches.length } };
  }

  globalThis.MeritPlanMemory = {
    match, identity, contextSignature, contextSimilarity, toleranceFor, cosine,
    constants: { W, GRADE, SEARCH_OF_TOLERANCE, CONTEXT_K, TOLERANCE_OF_SIZE, MIN_TOLERANCE, MAX_TOLERANCE },
    grades: ["strong", "likely", "ambiguous", "none"],
    version: 2,
  };
})();
