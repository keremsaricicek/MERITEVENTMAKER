// The Teach Area — where an operator's knowledge is kept, and how far it reaches.
//
// The product already learns nothing. It detects, it reads, it checks its own
// arithmetic, and when it cannot tell it says so. What it has never had is a
// place for the one thing that outranks all of that: a person who knows the
// room. The head of banqueting knows the long block by the north wall is the
// stage, that this venue numbers its tables 1 to 166 with no 13, and that the
// grey rectangle by the service door is a pillar the drawing has always shown
// badly. None of that is derivable from the pixels. All of it is worth keeping.
//
// This module keeps it. It stores lessons, decides which of them are in force
// for the drawing currently open, and — for lessons that are about a specific
// object — asks the existing Visual Plan Memory whether that object is on this
// drawing. It runs no detector, changes no weights, and touches nothing that
// any other plan will ever see.
//
// ---- THIS IS NOT TRAINING ---------------------------------------------------
//
// Say it plainly, because the shape of the feature invites the wrong word. A
// lesson is a stored note with a scope. Re-offering it on a drawing it applies
// to is retrieval, not learning: nothing is fitted, no parameter moves, no
// model exists to improve, and teaching a hundred lessons leaves the detector
// exactly as good and exactly as bad as it was before the first one. The
// operator-facing wording in this file never says otherwise, and a suite
// asserts that it doesn't.
//
// ---- SCOPE IS THE WHOLE DESIGN ----------------------------------------------
//
//   PLAN    this drawing. The narrowest and the safest: the same pixels, so
//           an object is where the person left it.
//   LAYOUT  this layout, across the versions it is re-issued in. The drawing
//           may have been re-exported, re-cropped, or lightly edited.
//   VENUE   this venue, across its layouts. The drawing may be a different
//           drawing entirely.
//
// The scope a person picks is a claim about how far their knowledge travels,
// and the evidence required to act on it scales with that claim. On this
// drawing, resemblance is enough — nothing moved. Across a venue it is not:
// "a circle that looks like the circle I ruled on" describes a hundred tables
// in a ballroom, and applying a decision to the wrong one corrupts a plan while
// looking like the feature worked. So a venue-scope lesson about a specific
// object is only acted on when the object carries the identifier the lesson
// carries — the verified printed number from the per-table read. Without one it
// is offered for review and never applied. A lost lesson is visible. A
// misapplied one is not.
//
// ---- ONE LESSON IS ABOUT ONE THING ------------------------------------------
//
// Nothing here spreads to visually similar objects. That already exists
// elsewhere (applyCorrectionToFamily, deliberately marked as not individually
// reviewed) and is a different feature with a different risk. A lesson taught
// about one table proposes a change to one table. If two objects fit it
// equally well the answer is AMBIGUOUS and neither is touched.
(function () {
  "use strict";

  const SCOPES = ["plan", "layout", "venue"];
  // Narrowest first — the order lessons are considered in, and the order a
  // more specific lesson supersedes a broader one.
  const SCOPE_RANK = { plan: 0, layout: 1, venue: 2 };
  // The field of `where` each scope is anchored to. A lesson without its
  // anchor is not storable: it would be in force everywhere or nowhere, and
  // both are wrong.
  const ANCHOR = { plan: "planHash", layout: "layoutId", venue: "venueId" };

  // What a lesson can be about.
  //
  //   objectIdentity  {kind:"objectIdentity", objectKind:"venue", type:"stage"}
  //                   this thing is a stage. `objectKind` is the candidate kind
  //                   (table | venue) so a lesson can move an object across
  //                   kinds, which is the correction that matters most.
  //   tableNumber     {kind:"tableNumber", value:137}
  //                   this table is number 137, whatever OCR made of it.
  //   planFact        {kind:"planFact", fact:"numberingRange", statement:"...",
  //                    value:{min:1,max:166}}
  //                   something true of the drawing as a whole. Never matched
  //                   to an object, because it is not about one.
  const SUBJECTS = ["objectIdentity", "tableNumber", "planFact"];

  const STATE = {
    APPLY: "APPLY",           // this object, identified well enough to act on
    REVIEW: "REVIEW",         // probably this object — the operator decides
    AMBIGUOUS: "AMBIGUOUS",   // more than one fits; touch none of them
    NOT_ON_THIS_PLAN: "NOT_ON_THIS_PLAN",
    STATED: "STATED",         // a fact about the drawing, not about an object
  };

  const STATEMENT =
    "A lesson is a note you attach to this plan, this layout, or this venue. " +
    "It is stored and offered again wherever it applies. It changes no " +
    "detector and nothing outside the scope you choose.";

  function isObjectSubject(kind) { return kind === "objectIdentity" || kind === "tableNumber"; }

  function scopeKeyOf(scope, where) {
    const anchor = ANCHOR[scope];
    const v = where ? where[anchor] : null;
    return v == null || v === "" ? null : `${scope}:${v}`;
  }

  // ---- storing ------------------------------------------------------------
  //
  // Returns {ok:true, lesson} or {ok:false, reason}. A rejected lesson is a
  // real answer, not an exception to swallow: the caller has to tell the
  // operator their teaching was not kept, and why.
  function lesson(input) {
    const i = input || {};
    const scope = i.scope || "plan";
    if (!SCOPES.includes(scope)) return { ok: false, reason: `unknown scope "${scope}"` };
    const subject = i.subject || {};
    if (!SUBJECTS.includes(subject.kind)) return { ok: false, reason: `unknown subject "${subject.kind}"` };
    const key = scopeKeyOf(scope, i.where);
    if (!key) return { ok: false, reason: `a ${scope}-scope lesson needs a ${ANCHOR[scope]}, and this drawing has none` };

    const from = i.from || null;
    if (isObjectSubject(subject.kind)) {
      if (!from || !from.geometry) return { ok: false, reason: "a lesson about an object needs the object it was taught on" };
      // The claim a venue-scope object lesson makes is that this exact thing
      // reappears on other drawings of the same venue. Only an identifier
      // supports that. Refusing it at storage time is kinder than storing a
      // lesson that can never be acted on.
      if (scope === "venue" && !verifiedNumberOf(from))
        return { ok: false, reason: "across a venue an object has to be identified by its printed number, and this one has no confirmed number — teach it on this layout instead" };
    }

    return {
      ok: true,
      lesson: {
        id: i.id || `lesson_${Math.random().toString(36).slice(2, 10)}`,
        scope, scopeKey: key,
        where: {
          planHash: i.where.planHash ?? null,
          layoutId: i.where.layoutId ?? null,
          layoutVersionId: i.where.layoutVersionId ?? null,
          venueId: i.where.venueId ?? null,
        },
        subject: { ...subject },
        // Everything identity needs, captured where the person was looking.
        from: from ? {
          candidateId: from.candidateId ?? from.id ?? null,
          kind: from.kind ?? null, type: from.type ?? null,
          geometry: { ...from.geometry },
          printedNumber: verifiedNumberOf(from) == null ? null
            : { state: "VERIFIED", value: verifiedNumberOf(from) },
          visual: from.visual || null,
          context: from.context || null,
        } : null,
        note: i.note || null,
        taughtBy: i.taughtBy || null,
        taughtAt: i.taughtAt || new Date().toISOString(),
      },
    };
  }

  function verifiedNumberOf(o) {
    const p = o && o.printedNumber;
    if (!p) return null;
    if (typeof p === "number") return p;
    return p.state === "VERIFIED" && typeof p.value === "number" ? p.value : null;
  }

  // What a lesson is ABOUT, so two lessons that answer the same question can be
  // recognised as the same question. A number identifies a table outright; an
  // object without one is identified by where it was taught, rounded, which is
  // exact for the common case (the same drawing) and approximate across a
  // re-issue. When it is approximate and two lessons end up with different
  // keys, both stay in force and compete for the object through Visual Plan
  // Memory, which gives it to one of them and reports the other as absent —
  // wasteful but never wrong, and never silently applied twice.
  function subjectKey(l) {
    const s = l.subject;
    if (s.kind === "planFact") return `planFact:${s.fact}`;
    if (s.kind === "tableNumber" && l.from && l.from.printedNumber)
      return `tableNumber:#${l.from.printedNumber.value}`;
    const g = l.from ? l.from.geometry : null;
    return `${s.kind}:${g ? `${g.x.toFixed(2)},${g.y.toFixed(2)}` : l.id}`;
  }

  // ---- which lessons are in force for the drawing that is open ------------
  //
  // One answer stands per subject, chosen by two rules in this order:
  //
  //   NARROWER WINS. A note about this drawing is a more considered answer than
  //   one about the whole venue, because the person could see the thing.
  //   THEN MORE RECENT WINS. At equal reach, someone answering the same
  //   question again is correcting themselves, not disagreeing with themselves.
  //   Treating that as an unresolvable conflict would lock an operator out of
  //   their own note.
  //
  // Nothing is discarded quietly: everything a winner displaced comes back in
  // `superseded` with the reason, so an operator wondering why their older note
  // stopped applying can be told.
  function inForce(all, where) {
    const keys = new Set(SCOPES.map((s) => scopeKeyOf(s, where)).filter(Boolean));
    const matching = (all || []).filter((l) => keys.has(l.scopeKey));
    matching.sort((a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]
      || String(b.taughtAt).localeCompare(String(a.taughtAt)));

    const bySubject = new Map();
    for (const l of matching) {
      const k = subjectKey(l);
      if (!bySubject.has(k)) bySubject.set(k, []);
      bySubject.get(k).push(l);
    }

    const lessons = [], superseded = [];
    for (const [k, group] of bySubject) {
      const winner = group[0];
      lessons.push(winner);
      for (const other of group.slice(1))
        superseded.push({ lessonId: other.id, by: winner.id, subject: k,
          detail: other.scope === winner.scope
            ? `you answered this again later, and the later answer is the one that applies`
            : `a ${winner.scope}-scope lesson is more specific than this ${other.scope}-scope one` });
    }
    return { lessons, superseded };
  }

  // ---- what those lessons propose on the candidates in front of us --------
  //
  // Identity is NOT re-implemented here. It is asked of Visual Plan Memory,
  // which already weighs geometry, size, appearance, neighbourhood and — since
  // the numbered-table work — the printed identifier, and which already
  // answers AMBIGUOUS rather than picking. A lesson is shaped into the row
  // that engine expects and handed over.
  function asMemoryRow(l) {
    return {
      id: l.id, kind: l.from.kind, type: l.from.type,
      geometry: l.from.geometry,
      printedNumber: l.from.printedNumber,
      visual: l.from.visual, context: l.from.context,
    };
  }

  function propose(lessonsInForce, candidates, options) {
    const opts = options || {};
    const list = lessonsInForce || [];
    const objectLessons = list.filter((l) => isObjectSubject(l.subject.kind) && l.from);
    const proposals = [];

    for (const l of list.filter((x) => x.subject.kind === "planFact")) {
      proposals.push({
        lessonId: l.id, scope: l.scope, state: STATE.STATED, candidateId: null,
        subject: l.subject,
        why: `a person stated this about ${l.scope === "plan" ? "this drawing" : `this ${l.scope}`}`,
      });
    }

    if (objectLessons.length && globalThis.MeritPlanMemory && (candidates || []).length) {
      const result = globalThis.MeritPlanMemory.match(
        objectLessons.map(asMemoryRow), candidates, { visual: opts.visual !== false });
      const byLesson = new Map(result.matches.map((m) => [m.memoryId, m]));
      for (const l of objectLessons) {
        const m = byLesson.get(l.id);
        if (!m) {
          const amb = (result.ambiguous || []).find((u) => u.memoryId === l.id);
          proposals.push({
            lessonId: l.id, scope: l.scope, subject: l.subject,
            state: amb ? STATE.AMBIGUOUS : STATE.NOT_ON_THIS_PLAN,
            candidateId: null,
            why: amb
              ? "more than one object on this plan fits this lesson equally well, so none of them is changed"
              : "the object this was taught on is not on this plan",
          });
          continue;
        }
        // Across a venue, resemblance is not identity. The printed number is.
        const identifiedByNumber = m.number != null;
        const strongEnough = m.grade === "strong"
          && (l.scope !== "venue" || identifiedByNumber);
        proposals.push({
          lessonId: l.id, scope: l.scope, subject: l.subject,
          state: strongEnough ? STATE.APPLY : STATE.REVIEW,
          candidateId: m.candidateId,
          grade: m.grade, score: m.score, basis: m.basis, number: m.number ?? null,
          why: strongEnough
            ? (identifiedByNumber
              ? `this is the table numbered ${m.number}, which is what the lesson was taught on`
              : "this is the object the lesson was taught on, on the same drawing")
            : l.scope === "venue" && !identifiedByNumber
              ? "across a venue an object has to be identified by its printed number, and this match rests on resemblance"
              : `the match is ${m.grade} rather than certain, so it is offered rather than applied`,
        });
      }
    } else {
      for (const l of objectLessons)
        proposals.push({ lessonId: l.id, scope: l.scope, subject: l.subject,
          state: STATE.NOT_ON_THIS_PLAN, candidateId: null,
          why: "there is nothing detected on this plan to match the lesson against" });
    }

    const count = (s) => proposals.filter((p) => p.state === s).length;
    return {
      proposals,
      summary: {
        total: proposals.length,
        apply: count(STATE.APPLY), review: count(STATE.REVIEW),
        ambiguous: count(STATE.AMBIGUOUS), notOnThisPlan: count(STATE.NOT_ON_THIS_PLAN),
        stated: count(STATE.STATED),
      },
      statement: STATEMENT,
    };
  }

  // One line an operator can read, in their own terms. Deliberately free of
  // the vocabulary of training: nothing here learns.
  function describe(l) {
    const s = l.subject;
    const reach = l.scope === "plan" ? "on this plan"
      : l.scope === "layout" ? "on every version of this layout" : "everywhere in this venue";
    if (s.kind === "planFact") return `${s.statement || s.fact}, ${reach}`;
    if (s.kind === "tableNumber") return `this table is number ${s.value}, ${reach}`;
    // `label` is the operator's own word for the type, passed in by the app
    // from its taxonomy so the line reads in their language and does not have
    // to guess an article ("a other").
    return `marked as ${s.label || s.type || s.kind}, ${reach}`;
  }

  globalThis.MeritTeachArea = {
    version: 1, SCOPES, STATE, STATEMENT,
    lesson, inForce, propose, describe, subjectKey, scopeKeyOf,
  };
})();
