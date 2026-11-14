// MERIT Event Maker — the local second look on ZONES and TABLE NUMBERS (MeritZoneNumberCheck).
//
// Two closed questions the local model can be asked about one crop of a plan
// (server/local-check-questions.json, `zone` and `number`; trained and measured in
// training/README.md, 2026-11-08, runS). This module is the product side of them,
// in the shape of src/plan-local-check.js, and it follows the same rules:
//
//   ONLY MEASURED QUESTIONS. A question is planned only when the relay says the
//     pinned model passed it (its manifest's `checks`); the caller passes that list.
//   TWO LOOKS, OR NO ANSWER. Every place is asked as drawn and turned a quarter.
//     Two looks that disagree are UNSURE and say nothing (abstention).
//   ZONES ARE SUGGESTIONS. Where both looks agree on an area's use and the analysis
//     says something else (or nothing), a finding in MeritVlmReview's shape is made,
//     `state: "open"`: a person accepts or dismisses it, one zone at a time. Nothing
//     here is ever applied by itself; "seating" and "none" never create a zone.
//   A NUMBER IS NEVER TAKEN FROM THE MODEL (rules/ai.md). The model's reading can
//     only AGREE with what OCR verified (evidence) or DISPUTE it. A dispute is a
//     note that the table's printed number must be checked by a person; it carries
//     no value to write (`value: null`), so no path can copy the model's number into
//     a table. A wrong confident number is worse than UNKNOWN.
//   SAME PICTURE AS MEASURED. Frames follow training/synth_styles.py `vlm`: a zone
//     crop is 1.3x the area (at least a fifth of the plan's short side; an entrance
//     3x its size, at least 0.16 of the short side); a number crop is 2.4x the table
//     (at least 56 px). Sent at 448 px.
//
// Pure: no DOM, no state, no network. Published once on globalThis.
(function () {
  "use strict";

  const CROP_PX = 448;
  const LOOKS = Object.freeze([0, 90]);
  const QUESTIONS = Object.freeze(["zone", "number"]);
  const ZONE_WORDS = Object.freeze(["stage", "dancefloor", "bar", "entrance", "vip", "aisle", "seating", "none"]);
  // The words that name a zone a person can accept; "seating" and "none" name no zone.
  const ZONE_TYPES = Object.freeze(["stage", "dancefloor", "bar", "entrance", "vip", "aisle"]);
  // What the analysis already calls a place, as a zone word.
  const ZONE_OF_TYPE = Object.freeze({ stage: "stage", stage_extension: "stage", dancefloor: "dancefloor", dance_floor: "dancefloor", bar: "bar",
    entrance: "entrance", exit: "entrance", vip: "vip", aisle: "aisle" });
  const MAX_QUESTIONS = 12;

  const round1 = (n) => Math.round(n * 10) / 10;
  const pctBox = (b) => ({ x: Math.round(b.x * 100) / 100, y: Math.round(b.y * 100) / 100, w: Math.round(b.w * 100) / 100, h: Math.round(b.h * 100) / 100 });
  const centre = (b, W, H) => ({ cx: (b.x + b.w / 2) / 100 * W, cy: (b.y + b.h / 2) / 100 * H, w: b.w / 100 * W, h: b.h / 100 * H });
  const normLabel = (s) => String(s == null ? "" : s).replace(/[\s-]/g, "").toUpperCase();

  // The crop rule the model was trained and measured with, in plan pixels.
  function frameFor(question, box, W, H, zoneWord) {
    const o = centre(box, W, H), S = Math.min(W, H), big = Math.max(o.w, o.h);
    if (question === "zone") {
      const side = zoneWord === "entrance" ? Math.min(S, Math.max(3 * o.w, 0.16 * S)) : Math.min(S, Math.max(1.3 * big, 0.2 * S));
      return { cx: round1(o.cx), cy: round1(o.cy), side: round1(side) };
    }
    return { cx: round1(o.cx), cy: round1(o.cy), side: round1(Math.max(2.4 * big, 56)) };
  }

  // places: [{ id, box: {x,y,w,h} in plan percent, current: zone word or null, decided: bool }]
  //   — venue candidates, labelled areas, open regions; the caller says which.
  // tables: [{ id, box, printed: { state, value } | null, decided: bool }]
  // validated: the questions the relay lists for the pinned model.
  function plan(input) {
    const { places = [], tables = [], W, H, validated = [], max = MAX_QUESTIONS } = input || {};
    if (!(W > 0 && H > 0)) return [];
    const out = [];
    if (validated.includes("zone")) {
      for (const p of places) {
        if (!p || !p.box || p.decided) continue;   // a person decided this place: never asked again
        const current = ZONE_OF_TYPE[p.current] || (ZONE_WORDS.includes(p.current) ? p.current : null);
        out.push({ question: "zone", placeId: p.id, box: p.box, detector: current, frame: frameFor("zone", p.box, W, H, current) });
      }
    }
    if (validated.includes("number")) {
      for (const t of tables) {
        if (!t || !t.box || t.decided) continue;
        const printed = t.printed && t.printed.state === "VERIFIED" && t.printed.value != null ? normLabel(t.printed.value) : null;
        out.push({ question: "number", tableId: t.id, box: t.box, detector: printed || "none", frame: frameFor("number", t.box, W, H) });
      }
    }
    const byKind = QUESTIONS.map(k => out.filter(q => q.question === k));
    const mixed = [];
    for (let i = 0; mixed.length < out.length; i++) for (const list of byKind) if (list[i]) mixed.push(list[i]);
    return mixed.slice(0, max).map((q, i) => ({ ...q, id: "zn" + (i + 1) }));
  }

  // The closed value of one answer, by the benchmark's rules (local-vlm-bench2.py
  // answer_zone / answer_label); null when it is not in the closed form.
  const ZONE_SYN = Object.freeze({ "dance floor": "dancefloor", dance: "dancefloor", door: "entrance", doorway: "entrance", exit: "entrance", corridor: "aisle",
    walkway: "aisle", podium: "stage", tables: "seating", dining: "seating", nothing: "none", empty: "none", counter: "bar" });
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function parseAnswer(question, raw) {
    const text = String(raw || "").slice(0, 400);
    if (question === "zone") {
      const t = text.toLowerCase();
      let best = null;
      for (const [w, to] of [...ZONE_WORDS.map(w => [w, w]), ...Object.entries(ZONE_SYN)]) {
        const m = new RegExp("\\b" + esc(w) + "s?\\b").exec(t);
        if (m && (!best || m.index < best.at)) best = { at: m.index, value: to };
      }
      return best ? best.value : null;
    }
    if (question === "number") {
      const t = text.trim().toUpperCase();
      if (/^(NONE|NO\b|NOTHING|N\/A)/.test(t)) return "none";
      const m = /\b([A-Z]{1,2}-?\d{1,3}[A-Z]?|\d{1,3}[A-Z]?)\b/.exec(t);
      if (m) return normLabel(m[1]);
      return /\bNONE\b/.test(t) ? "none" : null;
    }
    return null;
  }

  // Two looks at one place, against what the analysis has.
  function judge(q, answers) {
    const a = (answers || []).slice(0, LOOKS.length);
    if (a.length < LOOKS.length || a.some(v => v == null)) return { verdict: "NO_ANSWER", value: null };
    if (a.some(v => v !== a[0])) return { verdict: "UNSURE", value: null };
    return { verdict: a[0] === q.detector ? "AGREES" : "DIFFERS", value: a[0] };
  }

  // The finding a DIFFERS makes, or null. Zones: an open suggestion to accept or dismiss.
  // Numbers: a note that the printed number needs a person; never a value to write.
  function findingFor(q, j, idPrefix) {
    if (!q || !j || j.verdict !== "DIFFERS") return null;
    const id = `${idPrefix || "zn"}-check-${q.id}`;
    if (q.question === "zone") {
      if (ZONE_TYPES.includes(j.value)) {
        return { id, step: "check", kind: "zone", candidateId: q.placeId || null, type: j.value, box: pctBox(q.box), value: null, confidence: "medium",
          evidence: "", state: "open", appliesBy: "person", check: { question: "zone", answer: j.value, detector: q.detector } };
      }
      // the model sees no zone where the analysis put one: a note pointing a person at it (nothing removed)
      if (q.detector && ZONE_TYPES.includes(q.detector)) {
        return { id, step: "check", kind: "note", candidateId: q.placeId || null, type: null, box: pctBox(q.box), value: null, confidence: "medium",
          evidence: "", state: "open", appliesBy: "person", check: { question: "zone", answer: j.value, detector: q.detector } };
      }
      return null;
    }
    if (q.question === "number") {
      // OCR read nothing and the model reads nothing: nothing to say
      if (q.detector === "none" && j.value === "none") return null;
      return { id, step: "check", kind: "numberCheck", candidateId: q.tableId || null, type: null, box: pctBox(q.box), value: null, confidence: "low",
        evidence: "", state: "open", appliesBy: "person",
        check: { question: "number", ocr: q.detector === "none" ? null : q.detector, disputed: q.detector !== "none", modelSawNumber: j.value !== "none" } };
    }
    return null;
  }

  // What a number check does to the table's OCR reading: an agreement is evidence,
  // a dispute makes it UNKNOWN until a person looks; the value itself never changes.
  function numberStatus(ocrState, j) {
    if (!j || j.verdict === "UNSURE" || j.verdict === "NO_ANSWER") return { state: ocrState || null, secondLook: "unsure" };
    if (j.verdict === "AGREES") return { state: ocrState || null, secondLook: "agrees" };
    return { state: ocrState === "VERIFIED" ? "CHECK" : (ocrState || null), secondLook: "disputes" };
  }

  function tally(checks) {
    const t = { asked: 0, AGREES: 0, DIFFERS: 0, UNSURE: 0, NO_ANSWER: 0 };
    for (const c of checks || []) { if (!c || !c.verdict) continue; t.asked++; t[c.verdict] = (t[c.verdict] || 0) + 1; }
    return t;
  }

  globalThis.MeritZoneNumberCheck = Object.freeze({ CROP_PX, LOOKS, QUESTIONS, ZONE_WORDS, ZONE_TYPES, MAX_QUESTIONS, frameFor, plan, parseAnswer, judge, findingFor, numberStatus, tally });
})();
