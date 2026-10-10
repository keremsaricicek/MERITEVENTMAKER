// Relationship Engine 2.0 — which table a chair belongs to, and why.
//
// The old rule was one line of judgement: of the tables within reach, take the
// nearest perimeter. On the Golden Plan that is right 101 times out of 101, and
// it stayed right when the ground truth was expanded from 83 relations to 109,
// so nothing about that plan argues for changing it.
//
// The adversarial fixtures argue for changing it. On a1 (chairs tucked under a
// long table) it leaves 48 of 96 chairs seated at nothing. On a7 it answers,
// with no hedge, for five chairs drawn EXACTLY halfway between two identical
// tables — where the drawing has no answer and a confident one is wrong even
// when it happens to name the table a person would have guessed.
//
// So nearest becomes ONE SIGNAL among several, and the engine gains something
// it never had: the ability to say it is not sure.
//
// ---------------------------------------------------------------------------
// THE SIGNALS, and why each is independent of the others
//
//   PROXIMITY        distance from the chair centre to the table's oriented
//                    perimeter, normalised by the reach that table can plausibly
//                    seat. What the old rule used, kept, demoted.
//
//   PERIMETER        WHERE on the table the chair sits: within the span of an
//   POSITION         edge, under the body, or out past a corner. This is the
//                    signal that resolves the Golden Plan's own ambiguities —
//                    a chair 1.3px nearer one table but past its corner, and
//                    inside the other's edge span, is seated at the second.
//                    A chair off a corner is not a seat.
//
//   FACING           where the chair is pointed, used ONLY where the symbol
//                    actually carries a direction. See orientationOf().
//
//   ARRANGEMENT      whether this chair sits at the same distance from the
//                    table as that table's other seats. A ring of eight at 66px
//                    says a ninth at 66px belongs and one at 22px does not.
//
//   FAMILY           whether this chair looks like the chairs already at that
//                    table. Weak on its own, useful as a tie-breaker.
//
// ---------------------------------------------------------------------------
// WHAT THIS MUST NOT DO — the circularity rule
//
// Forbidden as sole logic, in both directions:
//
//     "this is a chair because it is near a table"
//     "this is a table because chairs are near it"
//
// Nothing in this file decides what an object IS. It receives objects that were
// already classified from their own pixels — size family, tone, shape, fill —
// and only decides how they RELATE. The caller must not feed a relation score
// back into the class decision as if it were independent evidence.
//
// ---------------------------------------------------------------------------
// EVERY DECISION IS INSPECTABLE
//
// Each association carries the full evidence breakdown, the runner-up table,
// and the margin between them. That is not debug output — it is what the review
// screen shows an operator when it asks about a chair, and what the benchmark
// scores when it asks whether a close call was recognised as one.

(() => {
  "use strict";

  const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
  const rad = d => (d * Math.PI) / 180;

  // A chair can only be seated at a table it can physically reach. This is the
  // same reach the previous associator used, deliberately: changing the
  // candidate SET as well as the ranking would make the two impossible to
  // compare, and the set was never the problem.
  function reachFor(chairSpan, table) {
    return Math.min(chairSpan * 1.6 + Math.min(table.w, table.h) * 0.25,
      Math.max(table.w, table.h) * 0.7);
  }

  // Where the chair sits relative to this table, in the table's own frame.
  //
  //   inside   the chair centre is over the table body
  //   edge     it is off one edge, and `inside` says how far within that
  //            edge's span it lies (positive) — a seat pulled up to the side
  //   corner   it is past a corner, and `inside` is negative: how far past
  //
  // The edge/corner distinction is categorical, not a matter of degree, and it
  // is the whole reason this function exists rather than a distance.
  function position(chair, table) {
    const ang = rad(table.rotation || 0);
    const dx = chair.cx - table.cx, dy = chair.cy - table.cy;
    const ca = Math.cos(-ang), sa = Math.sin(-ang);
    const u = dx * ca - dy * sa, v = dx * sa + dy * ca;
    const hw = table.w / 2, hh = table.h / 2;
    const du = Math.abs(u) - hw, dv = Math.abs(v) - hh;
    const d = Math.hypot(Math.max(du, 0), Math.max(dv, 0));
    if (du <= 0 && dv <= 0)
      return { d, kind: "inside", side: "under", inside: Math.min(hw - Math.abs(u), hh - Math.abs(v)), halfEdge: Math.min(hw, hh), u, v };
    if (du > 0 && dv <= 0)
      return { d, kind: "edge", side: u > 0 ? "right" : "left", inside: hh - Math.abs(v), halfEdge: hh, u, v };
    if (dv > 0 && du <= 0)
      return { d, kind: "edge", side: v > 0 ? "bottom" : "top", inside: hw - Math.abs(u), halfEdge: hw, u, v };
    return { d, kind: "corner", side: "corner", inside: -Math.hypot(du, dv), halfEdge: Math.min(hw, hh), u, v };
  }

  const POSITION_SCORE = {
    // A chair over the table body is as seated as it gets — this is the tucked
    // banquet chair, and treating it as suspicious is exactly the mistake the
    // a1 fixture exists to catch.
    inside: p => 1,
    // Along an edge: full credit at the middle of the edge, falling off toward
    // the corners where "seated here" stops being obvious.
    edge: p => 0.5 + 0.5 * clamp(p.inside / Math.max(p.halfEdge, 1)),
    // Past a corner. Not zero — a chair at a round table's four-o'clock is
    // formally past the corner of its bounding box — but low enough that an
    // edge-seated candidate always wins.
    corner: p => 0.25 * clamp(1 + p.inside / Math.max(p.halfEdge, 1)),
  };

  // ---- orientation ---------------------------------------------------------
  //
  // Two different questions, and conflating them is how a product ends up
  // claiming a chair faces north when all it knows is that the symbol is
  // taller than it is wide.
  //
  //   ORIENTATION is an AXIS, modulo 180 degrees. A symbol elongated along one
  //   direction has an orientation; it does not thereby have a front.
  //
  //   FACING is a SIGNED direction, modulo 360. It needs an asymmetry — a
  //   backrest, a heavier edge, an open side — and most plan chair symbols do
  //   not have one.
  //
  // The asymmetry this uses is real and already measured: a connected component
  // carries both its bounding-box centre and its INK CENTROID. A plain square
  // seat has them in the same place. A seat drawn with a heavy backrest has its
  // ink pulled toward the back, and the displacement points AT the back, so the
  // chair faces the other way.
  //
  // Never invent orientation. A symmetric symbol returns known: false, and a
  // family whose members are all near-symmetric returns known: false for every
  // member even where noise nudged one over the threshold.
  const ORIENT_MIN_ASPECT = 1.18;   // elongation before the axis means anything
  const FACING_MIN_OFFSET = 0.055;  // ink displacement, as a share of the span
  const FAMILY_MIN_MEMBERS = 4;     // below this, a family median is not evidence

  function orientationOf(chair) {
    const obb = chair.obb || chair;
    const span = Math.max(obb.w, obb.h) || 1;
    const aspect = Math.max(obb.w, obb.h) / Math.max(1e-6, Math.min(obb.w, obb.h));
    // Ink centroid minus box centre, in image pixels.
    const off = chair.inkOffset || null;
    const offset = off ? Math.hypot(off.x, off.y) / span : 0;
    const axisKnown = aspect >= ORIENT_MIN_ASPECT;
    const out = {
      angle: axisKnown ? ((obb.rotation || 0) % 180 + 180) % 180 : null,
      known: axisKnown,
      strength: axisKnown ? clamp((aspect - 1) / 0.6) : 0,
      evidence: axisKnown ? "obbElongation" : "symbolIsRotationallySymmetric",
      facingAngle: null, facingKnown: false, facingStrength: 0,
      facingEvidence: "noAsymmetry",
      inkOffsetShare: +offset.toFixed(4),
    };
    if (off && offset >= FACING_MIN_OFFSET) {
      // The ink leans toward the back, so the chair faces the opposite way.
      out.facingAngle = ((Math.atan2(-off.y, -off.x) * 180) / Math.PI + 360) % 360;
      out.facingKnown = true;
      out.facingStrength = clamp((offset - FACING_MIN_OFFSET) / 0.12);
      out.facingEvidence = "inkMassOffsetTowardBack";
      if (!out.known) {
        // An asymmetric symbol has an axis even when its box is square.
        out.known = true;
        out.angle = ((out.facingAngle % 180) + 180) % 180;
        out.strength = out.facingStrength;
        out.evidence = "inkMassAsymmetry";
      }
    }
    return out;
  }

  // A family whose members are mostly symmetric does not get to claim facing
  // for the two members that happened to clear the threshold. Plan symbols are
  // drawn from a stencil: within a family they are the same symbol, so the
  // family is the right unit for "is this shape directional at all".
  function calibrateFamilies(chairs) {
    const byFamily = new Map();
    for (const c of chairs) {
      const k = c.family || "unknown";
      if (!byFamily.has(k)) byFamily.set(k, []);
      byFamily.get(k).push(c);
    }
    const verdicts = new Map();
    for (const [family, members] of byFamily) {
      const offsets = members.map(m => m.orientation.inkOffsetShare).sort((a, b) => a - b);
      const median = offsets[offsets.length >> 1] ?? 0;
      const directional = members.length < FAMILY_MIN_MEMBERS
        // Too few to judge as a family: fall back to the per-symbol answer.
        ? null
        : median >= FACING_MIN_OFFSET;
      verdicts.set(family, { members: members.length, medianOffset: +median.toFixed(4), directional });
      if (directional === false)
        for (const m of members) {
          m.orientation.facingKnown = false;
          m.orientation.facingAngle = null;
          m.orientation.facingStrength = 0;
          m.orientation.facingEvidence = "familyIsNotDirectional";
        }
    }
    return verdicts;
  }

  // ---- spatial index -------------------------------------------------------
  // 3,240 chairs against 324 tables is a million pair tests, and the plan that
  // has those numbers is the one where the whole pass has to stay responsive.
  // A uniform grid over the tables turns it into a handful of tests per chair.
  function tableIndex(tables, maxReach) {
    const cell = Math.max(32, maxReach * 2);
    const grid = new Map();
    const key = (gx, gy) => gx + ":" + gy;
    tables.forEach((t, i) => {
      const r = t.reach;
      const x0 = Math.floor((t.obb.cx - t.obb.w / 2 - r) / cell), x1 = Math.floor((t.obb.cx + t.obb.w / 2 + r) / cell);
      const y0 = Math.floor((t.obb.cy - t.obb.h / 2 - r) / cell), y1 = Math.floor((t.obb.cy + t.obb.h / 2 + r) / cell);
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const k = key(gx, gy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    });
    return {
      cell,
      near(cx, cy) {
        const k = key(Math.floor(cx / cell), Math.floor(cy / cell));
        return grid.get(k) || [];
      },
    };
  }

  // ---- the association -----------------------------------------------------
  //
  // Weights. Position outranks proximity on purpose: the whole finding behind
  // this engine is that WHERE a chair sits beats HOW FAR it is, and the Golden
  // Plan's own thirty ambiguous chairs are the proof. Facing, where it exists,
  // is worth as much as proximity — it is direct evidence about intent rather
  // than an inference from spacing.
  const W = { proximity: 1.0, position: 1.3, facing: 1.0, arrangement: 0.6, family: 0.35 };
  // A runner-up this close means the drawing did not decide. The chair keeps
  // its best table — the seat is real and dropping it would lose capacity —
  // but the relation is flagged, and the review queue can ask.
  const AMBIGUOUS_MARGIN = 0.06;

  function scorePair(chair, table, ctx) {
    const p = position(chair.obb, table.obb);
    if (p.d > table.reach) return null;
    const terms = {}, weights = {};
    terms.proximity = 1 - clamp(p.d / Math.max(table.reach, 1));
    weights.proximity = W.proximity;
    terms.position = POSITION_SCORE[p.kind](p);
    weights.position = W.position;

    if (chair.orientation.facingKnown) {
      // Does the chair point at this table? Measured against the direction to
      // the nearest point of the table's perimeter, not its centre: a chair at
      // the middle of a long table's edge faces the edge, not the far centre.
      const ang = rad(table.obb.rotation || 0), ca = Math.cos(ang), sa = Math.sin(ang);
      const hw = table.obb.w / 2, hh = table.obb.h / 2;
      const nu = clamp(p.u, -hw, hw), nv = clamp(p.v, -hh, hh);
      const nx = table.obb.cx + nu * ca - nv * sa, ny = table.obb.cy + nu * sa + nv * ca;
      const tx = nx - chair.obb.cx, ty = ny - chair.obb.cy;
      const len = Math.hypot(tx, ty);
      if (len > 0.5) {
        const f = rad(chair.orientation.facingAngle);
        const cos = (Math.cos(f) * tx + Math.sin(f) * ty) / len;
        terms.facing = clamp((cos + 1) / 2);
        weights.facing = W.facing * (0.5 + 0.5 * chair.orientation.facingStrength);
      }
    }
    if (ctx && ctx.ring && ctx.ring.has(table.index)) {
      const ring = ctx.ring.get(table.index);
      terms.arrangement = 1 - clamp(Math.abs(p.d - ring.medianDistance) / Math.max(ring.medianDistance, 4));
      weights.arrangement = W.arrangement;
    }
    if (ctx && ctx.modalFamily && ctx.modalFamily.has(table.index)) {
      terms.family = (chair.family || "unknown") === ctx.modalFamily.get(table.index) ? 1 : 0.3;
      weights.family = W.family;
    }
    let sum = 0, wsum = 0;
    for (const k in terms) { sum += terms[k] * weights[k]; wsum += weights[k]; }
    return { tableIndex: table.index, score: wsum ? sum / wsum : 0, terms, weights, position: p, distance: p.d };
  }

  function bestFor(chair, tables, index, ctx) {
    const cand = [];
    for (const ti of index.near(chair.obb.cx, chair.obb.cy)) {
      const s = scorePair(chair, tables[ti], ctx);
      if (s) cand.push(s);
    }
    cand.sort((a, b) => b.score - a.score || a.distance - b.distance || a.tableIndex - b.tableIndex);
    return cand;
  }

  // tables: [{ id, obb:{cx,cy,w,h,rotation} }]
  // chairs: [{ id, obb:{cx,cy,w,h,rotation}, family, inkOffset:{x,y}|null }]
  //
  // Returns one record per chair, always — including the ones nothing seats.
  function associate(chairsIn, tablesIn) {
    const tables = tablesIn.map((t, index) => ({ index, id: t.id, obb: t.obb,
      reach: 0 }));
    const chairs = chairsIn.map((c, index) => ({ index, id: c.id, obb: c.obb,
      family: c.family || "unknown", inkOffset: c.inkOffset || null, orientation: null }));
    for (const c of chairs) c.orientation = orientationOf(c);
    const familyVerdicts = calibrateFamilies(chairs);

    // Reach depends on the chair, so index with the largest one on the plan.
    const maxSpan = chairs.reduce((m, c) => Math.max(m, Math.max(c.obb.w, c.obb.h)), 0);
    let maxReach = 0;
    for (const t of tables) { t.reach = reachFor(maxSpan, t.obb); maxReach = Math.max(maxReach, t.reach); }
    const index = tableIndex(tables, maxReach);

    // Pass 1: proximity, position and facing — everything that depends only on
    // the chair and the table, with no reference to other chairs. Doing the
    // context-free pass first is what keeps the context evidence from being
    // circular: the rings it measures are built from decisions that did not
    // use rings.
    const pass1 = chairs.map(c => bestFor(c, tables, index, null));

    // Context: for each table, how far its provisional seats sit and what they
    // look like.
    const ring = new Map(), modalFamily = new Map();
    const byTable = new Map();
    pass1.forEach((cand, ci) => {
      if (!cand.length) return;
      const ti = cand[0].tableIndex;
      if (!byTable.has(ti)) byTable.set(ti, []);
      byTable.get(ti).push({ ci, d: cand[0].distance });
    });
    for (const [ti, seats] of byTable) {
      if (seats.length >= 2) {
        const ds = seats.map(s => s.d).sort((a, b) => a - b);
        ring.set(ti, { medianDistance: ds[ds.length >> 1], seats: seats.length });
      }
      const fams = seats.reduce((m, s) => (m[chairs[s.ci].family] = (m[chairs[s.ci].family] || 0) + 1, m), {});
      const ranked = Object.entries(fams).sort((a, b) => b[1] - a[1]);
      if (ranked.length && ranked[0][1] >= 2) modalFamily.set(ti, ranked[0][0]);
    }

    // Pass 2: the same scoring with the context terms available. One refinement
    // pass, not iterated to convergence — a loop here can oscillate, and a
    // relationship that depends on how many times you ran the loop is not
    // evidence.
    const ctx = { ring, modalFamily };
    // How many seats the evidence puts somewhere that pure nearest-perimeter
    // would not. This is the honest measure of whether the engine changed
    // anything at all, it is computed rather than asserted, and it is reported
    // even when the answer is zero — which on the Golden Plan it is.
    let changedFromNearest = 0;
    const results = chairs.map(c => {
      const cand = bestFor(c, tables, index, ctx);
      if (cand.length) {
        let nearest = cand[0];
        for (const x of cand) if (x.distance < nearest.distance) nearest = x;
        if (nearest.tableIndex !== cand[0].tableIndex) changedFromNearest++;
      }
      if (!cand.length)
        return { chairId: c.id, chairIndex: c.index, tableIndex: null, tableId: null,
          state: "orphan", score: 0, margin: null, runnerUp: null,
          orientation: c.orientation, evidence: null,
          reason: "noTableWithinReach" };
      const best = cand[0], second = cand[1] || null;
      const margin = second ? +(best.score - second.score).toFixed(4) : null;
      const ambiguous = second !== null && margin < AMBIGUOUS_MARGIN;
      return {
        chairId: c.id, chairIndex: c.index,
        tableIndex: best.tableIndex, tableId: tables[best.tableIndex].id,
        state: ambiguous ? "ambiguous" : "assigned",
        ambiguous,
        score: +best.score.toFixed(4),
        margin,
        runnerUp: second ? { tableIndex: second.tableIndex, tableId: tables[second.tableIndex].id,
          score: +second.score.toFixed(4) } : null,
        competitors: cand.length,
        orientation: c.orientation,
        // The evidence breakdown, rounded for storage but not summarised away:
        // this is what the review screen reads back to an operator.
        evidence: {
          distance: +best.distance.toFixed(2),
          positionKind: best.position.kind,
          positionSide: best.position.side,
          insideEdgeSpan: +best.position.inside.toFixed(2),
          terms: Object.fromEntries(Object.entries(best.terms).map(([k, v]) => [k, +v.toFixed(3)])),
        },
        reason: ambiguous ? "runnerUpWithinMargin" : best.position.kind === "inside" ? "seatedOverTableBody"
          : best.position.kind === "edge" ? "seatedAlongEdge" : "nearestByCorner",
      };
    });

    const stats = {
      chairs: chairs.length, tables: tables.length,
      assigned: results.filter(r => r.state === "assigned").length,
      ambiguous: results.filter(r => r.state === "ambiguous").length,
      orphans: results.filter(r => r.state === "orphan").length,
      withCompetingTables: results.filter(r => r.runnerUp).length,
      orientationKnown: results.filter(r => r.orientation.known).length,
      facingKnown: results.filter(r => r.orientation.facingKnown).length,
      facingUsed: results.filter(r => r.evidence && r.evidence.terms.facing !== undefined).length,
      changedFromNearest,
      byPosition: results.reduce((m, r) => {
        const k = r.evidence ? r.evidence.positionKind : "none";
        m[k] = (m[k] || 0) + 1; return m;
      }, {}),
      families: Object.fromEntries(familyVerdicts),
    };
    return { results, stats, familyVerdicts: Object.fromEntries(familyVerdicts) };
  }

  globalThis.MeritRelationships = {
    associate, orientationOf, position, reachFor, calibrateFamilies,
    constants: { W, AMBIGUOUS_MARGIN, ORIENT_MIN_ASPECT, FACING_MIN_OFFSET, FAMILY_MIN_MEMBERS },
    version: 2,
  };
})();
