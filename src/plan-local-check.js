// MERIT Event Maker — the LOCAL second look, as rules (MeritLocalCheck).
//
// A small vision-language model on this machine is not asked to review a whole
// plan: measured, a whole-plan reading on four cores ran past 15 minutes and no
// small model passed its bar (benchmarks/offline-intelligence/LOCAL-VLM.md). It
// is asked ONE closed question about ONE place the analysis is unsure of, the
// question it was measured and trained on (server/local-check-questions.json):
//
//   identify  what is at the centre — an object the analysis held back, or
//             seating furniture the classical path has to guess the type of;
//   chairs    how many chairs stand around this table — where the plan's own
//             printed rule, or the table's look-alikes, say a different number;
//   merged    do these tables touch to form one long table — a pushed-together
//             group nobody has answered yet;
//   serves    does this sofa / bench / banquette serve this table — a link the
//             analysis itself calls uncertain.
//
// What is structural here, not promised:
//   A PERSON'S DECISION IS NEVER ASKED ABOUT. What an object is, once a person
//     confirmed, rejected or dismissed it; a table's chairs, once a person
//     confirmed the table or typed its seats; a grouping a person answered: no
//     question is planned for any of them. (Confirming two tables decides that
//     they exist, not whether they are pushed together: that is still asked.)
//   ONLY MEASURED QUESTIONS. The relay names the questions the pinned model
//     passed (its manifest's `checks`); nothing else is planned.
//   TWO LOOKS, OR NO ANSWER. Every place is asked twice — as drawn, and turned
//     a quarter (the model was trained on every orientation, so the truth does
//     not change). Two looks that disagree are UNSURE and say nothing.
//   AN ANSWER IS CHECKED AGAINST WHAT THE ANALYSIS FOUND, not believed. Where
//     the model agrees, that is supporting evidence and nothing is offered;
//     where it disagrees with itself, nothing is offered; only where both looks
//     agree with each other and DISAGREE with the analysis is a finding made —
//     a suggestion in the model reading's own shape (MeritVlmReview), which a
//     person accepts or dismisses one at a time. A seat count, a grouping or a
//     link is never ACCEPTED from a model: those are notes that point a person
//     at the place. The one exception is the relay's `autoApply` (a question
//     measured to the stricter bar): screen-vlm.js then writes a grouping
//     answer by itself, marked as the model's, undone from its finding.
//   SAME PICTURE AS MEASURED. A crop is a square around the object, sized by
//     the rule the benchmark cut its crops by, sent at 448 px on white paper.
//
// Pure: no DOM, no state, no network. Published once on globalThis.
(function () {
  "use strict";

  const CROP_PX = 448;
  const MAX_QUESTIONS = 12;
  const LOOKS = Object.freeze([0, 90]);
  const QUESTIONS = Object.freeze(["identify", "chairs", "merged", "serves"]);
  // The word the model answers for each detector type, and the one type a
  // word may correct an object to (a "table" names no shape, so it corrects
  // nothing; it can only be a note).
  const WORD_OF_TYPE = Object.freeze({ round: "table", square: "table", rectangle: "table", bistro: "table", chair: "chair", armchair: "chair",
    sofa: "sofa", bench: "bench", banquette: "banquette", column: "column", stage: "stage", bar: "bar",
    // V5 words: a loca box is a "lodge"; an exit is drawn as an entrance is (a door), so the word cannot tell them apart
    loca: "lodge", entrance: "entrance", exit: "entrance" });
  const TYPE_OF_WORD = Object.freeze({ chair: "chair", sofa: "sofa", bench: "bench", banquette: "banquette", column: "column", stage: "stage", bar: "bar",
    lodge: "loca" });
  const SEATING = new Set(["sofa", "bench", "banquette"]);

  const isOffered = (c) => c.status === "confirmed" || (c.status !== "rejected" && c.selected !== false);
  const undecided = (c) => c && c.status === "unreviewed" && !c.dismissed;
  const centre = (c, W, H) => ({ cx: (c.x + c.w / 2) / 100 * W, cy: (c.y + c.h / 2) / 100 * H, w: c.w / 100 * W, h: c.h / 100 * H });
  const unionPct = (cs) => {
    const x0 = Math.min(...cs.map(c => c.x)), y0 = Math.min(...cs.map(c => c.y));
    const x1 = Math.max(...cs.map(c => c.x + c.w)), y1 = Math.max(...cs.map(c => c.y + c.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const round1 = (n) => Math.round(n * 10) / 10;

  // The crop rules of local-vlm-bench2.py, in plan pixels.
  function frameFor(question, objs, W, H) {
    if (question === "identify") {
      const o = centre(objs[0], W, H), big = Math.max(o.w, o.h);
      return { cx: o.cx, cy: o.cy, side: objs[0].type === "stage" ? 1.15 * big : 2.0 * big + 30 };
    }
    if (question === "chairs") { const o = centre(objs[0], W, H); return { cx: o.cx, cy: o.cy, side: 2.4 * Math.max(o.w, o.h) + 50 }; }
    if (question === "merged") {
      const u = centre(unionPct(objs), W, H);
      return { cx: u.cx, cy: u.cy, side: Math.max(u.w, u.h) * 1.25 + 40 };
    }
    const t = centre(objs[0], W, H), p = centre(objs[1], W, H);
    return { cx: (t.cx + p.cx) / 2, cy: (t.cy + p.cy) / 2,
      side: Math.max(Math.abs(t.cx - p.cx) + Math.max(t.w, p.w), Math.abs(t.cy - p.cy) + Math.max(t.h, p.h)) * 1.3 + 30 };
  }

  // A table standing alone: no other offered table within 1.8 of the larger
  // size (the benchmark's CHAIRS condition — "the table in the centre" then has
  // one meaning).
  function alone(t, tables, W, H) {
    const a = centre(t, W, H);
    return tables.every(o => {
      if (o === t) return true;
      const b = centre(o, W, H);
      return Math.hypot(a.cx - b.cx, a.cy - b.cy) > 1.8 * Math.max(a.w, a.h, b.w, b.h);
    });
  }

  // What to ask, most useful first, at most `max`. `checks` is what the relay
  // says the pinned model was measured on; `width`/`height` the plan's pixels.
  function plan(analysis, opts) {
    const o = opts || {}, W = o.width, H = o.height;
    const checks = new Set((o.checks || []).filter(q => QUESTIONS.includes(q)));
    const max = Math.max(0, Math.min(o.max ?? MAX_QUESTIONS, 40));
    const all = (analysis && analysis.candidates) || [];
    if (!(W > 0 && H > 0) || !checks.size || !all.length) return [];
    const byId = new Map(all.map(c => [c.id, c]));
    const pi = (analysis && analysis.planIntelligence) || {};
    const out = [];
    const push = (q) => { out.push({ ...q, id: "q" + (out.length + 1), frame: frameFor(q.question, q.objs, W, H), objs: undefined }); };

    if (checks.has("identify")) {
      // Held back by the analysis first, then seating furniture (the classical
      // path guesses sofa / bench / banquette from a box), then the rest of
      // what has a word, least confident first.
      const rank = (c) => (c.lowEvidence ? 0 : SEATING.has(c.type) ? 1 : 2) + (1 - (Number(c.confidence) || 0)) / 10;
      all.filter(c => undecided(c) && WORD_OF_TYPE[c.type] && (c.lowEvidence || SEATING.has(c.type) || (Number(c.confidence) || 0) < 0.6) && c.w > 0 && c.h > 0)
        .sort((a, b) => rank(a) - rank(b))
        .forEach(c => push({ question: "identify", candidateIds: [c.id], focusId: c.id, objs: [c], reason: c.lowEvidence ? "heldBack" : SEATING.has(c.type) ? "seatingType" : "lowConfidence",
          detector: WORD_OF_TYPE[c.type] }));
    }
    if (checks.has("chairs")) {
      const tables = all.filter(c => c.kind === "table" && isOffered(c));
      const rule = pi.capacityAudit && pi.capacityAudit.rule;
      const perUnit = rule && Number.isInteger(rule.perUnit) ? rule.perUnit : null;
      // Each table type's usual chair count among its look-alikes.
      const usual = {};
      for (const ty of new Set(tables.map(t => t.type))) {
        const counts = {};
        for (const t of tables) if (t.type === ty && (t.chairDetections || []).length) counts[t.chairDetections.length] = (counts[t.chairDetections.length] || 0) + 1;
        const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] >= 3) usual[ty] = Number(best[0]);
      }
      for (const t of tables) {
        const n = (t.chairDetections || []).length;
        if (!undecided(t) || !n || t.seatsConfidence === "verified" || !alone(t, tables, W, H)) continue;
        const reason = perUnit != null && n !== perUnit ? "printedRule" : usual[t.type] != null && n !== usual[t.type] ? "unlikeLookAlikes" : null;
        if (reason) push({ question: "chairs", candidateIds: [t.id], focusId: t.id, objs: [t], reason, detector: n, printed: reason === "printedRule" ? perUnit : null });
      }
    }
    if (checks.has("merged")) {
      for (const g of pi.furnitureGroups || []) {
        const ms = (g.memberIds || []).map(id => byId.get(id)).filter(Boolean);
        // A person confirming the tables decided that they exist, not how they
        // are grouped; an answered grouping (g.decision) is never re-asked.
        if (g.decision || ms.length < 2 || ms.length > 4 || ms.length !== (g.memberIds || []).length || ms.some(m => m.status === "rejected" || m.dismissed)) continue;
        push({ question: "merged", candidateIds: ms.map(m => m.id), focusId: ms[0].id, objs: ms, reason: "unansweredGroup", detector: "yes" });
      }
    }
    if (checks.has("serves")) {
      for (const l of (pi.seatingLinks && pi.seatingLinks.links) || []) {
        const piece = byId.get(l.pieceId), table = byId.get(l.tableId);
        if (l.certainty !== "uncertain" || !piece || !table || !SEATING.has(piece.type) || piece.status === "rejected" || piece.dismissed || table.status === "rejected") continue;
        push({ question: "serves", piece: piece.type, candidateIds: [table.id, piece.id], focusId: piece.id, objs: [table, piece], reason: "uncertainLink", detector: "yes" });
      }
    }
    // Interleave the kinds so a cap does not spend every question on one.
    const byKind = QUESTIONS.map(k => out.filter(q => q.question === k));
    const mixed = [];
    for (let i = 0; mixed.length < out.length; i++) for (const list of byKind) if (list[i]) mixed.push(list[i]);
    return mixed.slice(0, max).map((q, i) => ({ ...q, id: "q" + (i + 1), frame: { cx: round1(q.frame.cx), cy: round1(q.frame.cy), side: round1(q.frame.side) } }));
  }

  // Two looks at one place, against what the analysis found.
  //   AGREES     both looks gave the same answer, and it is the analysis's
  //   DIFFERS    both looks gave the same answer, and it is not
  //   UNSURE     the looks disagree with each other
  //   NO_ANSWER  a look did not answer in the closed form
  function judge(q, answers) {
    const a = (answers || []).slice(0, LOOKS.length);
    if (a.length < LOOKS.length || a.some(v => v == null)) return { verdict: "NO_ANSWER", value: null };
    if (a.some(v => v !== a[0])) return { verdict: "UNSURE", value: null };
    return { verdict: a[0] === q.detector ? "AGREES" : "DIFFERS", value: a[0] };
  }

  // The suggestion a DIFFERS makes, in MeritVlmReview's finding shape; null
  // for every other verdict. `box` is in plan-percent (the group's outline for
  // a grouping, the object's otherwise).
  function findingFor(q, j, analysis, idPrefix) {
    if (!j || j.verdict !== "DIFFERS") return null;
    const byId = new Map(((analysis && analysis.candidates) || []).map(c => [c.id, c]));
    const objs = q.candidateIds.map(id => byId.get(id)).filter(Boolean);
    if (objs.length !== q.candidateIds.length) return null;
    const box = q.question === "identify" ? null : unionPct(objs);
    let kind = "note", type = null;
    if (q.question === "identify") {
      if (j.value === "nothing") kind = "notAnObject";
      else if (TYPE_OF_WORD[j.value]) { kind = "wrongType"; type = TYPE_OF_WORD[j.value]; }
    }
    return { id: `${idPrefix || "lc"}-check-${q.id}`, step: "check", regionIndex: null, kind, candidateId: q.focusId, type,
      box: box ? { x: Math.round(box.x * 100) / 100, y: Math.round(box.y * 100) / 100, w: Math.round(box.w * 100) / 100, h: Math.round(box.h * 100) / 100 } : null,
      value: Number.isInteger(j.value) ? j.value : null, confidence: "medium", evidence: "", state: "open",
      check: { question: q.question, piece: q.piece || null, answer: j.value, detector: q.detector, reason: q.reason, printed: q.printed ?? null } };
  }

  // The run's tally, for the panel.
  function tally(checks) {
    const t = { asked: 0, AGREES: 0, DIFFERS: 0, UNSURE: 0, NO_ANSWER: 0 };
    for (const c of checks || []) { if (!c.verdict) continue; t.asked++; t[c.verdict] = (t[c.verdict] || 0) + 1; }
    return t;
  }

  globalThis.MeritLocalCheck = Object.freeze({ CROP_PX, MAX_QUESTIONS, LOOKS, QUESTIONS, WORD_OF_TYPE, TYPE_OF_WORD, plan, frameFor, judge, findingFor, tally });
})();
