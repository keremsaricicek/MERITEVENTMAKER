// MERIT Event Maker — what a review decision does (MeritReviewDecisions).
//
// A person looking at a detected object can confirm it, reject it ("not an
// object"), dismiss it ("real, but not important"), give it a different type
// (which spreads to the unreviewed members of its visual family), accept a
// whole family at once, or switch a candidate in or out of what Confirm will
// write. Each of those used to be written inline where its button was
// handled, and each kept a different subset of the records a decision has to
// keep in step.
//
// This module says, as DATA, what one decision does: which fields change on
// which candidates, which of them plan memory keeps, which training labels it
// produces and whether a person actually looked at each one. It writes
// nothing. The one writer — decideReview() in app-v8.js — applies the plan
// together with memory, training capture, the audit trail and the human
// observation, and undoes all of them together.
//
// Pure: no DOM, no state. Published once on globalThis.
(function () {
  "use strict";

  const KINDS = Object.freeze(["confirm", "reject", "notImportant", "reclassify", "confirmFamily", "include", "exclude", "forgetLesson",
    "addObject", "addChair", "setSeats"]);

  const classOf = (c) => c ? { kind: c.kind, type: c.type, confidence: c.confidence,
    source: (c.evidence && c.evidence.geometry) ?? null, candidateId: c.id } : null;

  // decision: { kind, candidateId, to?: {kind, type}, familyIds?: [], ids?: [] }
  // ctx:      { candidates, unverifiedSeating: [types] }
  function plan(decision, ctx) {
    const kind = decision && decision.kind;
    if (!KINDS.includes(kind)) return { ok: false, reason: `unknown decision "${kind}"` };
    const byId = new Map((ctx.candidates || []).map(c => [c.id, c]));
    const unverified = new Set(ctx.unverifiedSeating || []);
    const writes = [], training = [], memory = [], create = [];
    const target = byId.get(decision.candidateId);
    const one = (c, set, label) => {
      writes.push({ id: c.id, set });
      if (label) training.push({ id: c.id, ...label });
    };

    switch (kind) {
      case "confirm":
        if (!target) break;
        one(target, { status: "confirmed", selected: true }, { decisionType: "confirmation", predictionBefore: classOf(target), reviewedIndividually: true });
        memory.push(target.id);
        break;
      case "reject":
        if (!target) break;
        one(target, { status: "rejected", selected: false }, { decisionType: "falsePositive", predictionBefore: classOf(target), reviewedIndividually: true });
        memory.push(target.id);
        break;
      case "notImportant":
        // Real, but not something this plan tracks. Kept in the analysis —
        // rejected and marked dismissed — so it can be undone and so Re-Analyze
        // does not ask again; the training label keeps the distinction from
        // "not an object".
        if (!target) break;
        one(target, { status: "rejected", selected: false, dismissed: true }, { decisionType: "negative", predictionBefore: classOf(target), reviewedIndividually: true,
          note: "operator dismissed this region as not important" });
        memory.push(target.id);
        break;
      case "reclassify": {
        if (!target || !decision.to) break;
        const to = decision.to, crossed = to.kind !== target.kind, changed = crossed || to.type !== target.type;
        const set = (c) => {
          const s = { kind: to.kind, type: to.type, status: "confirmed", selected: true };
          if (crossed && to.kind !== "table") s.clearSeats = true;
          // Into seating furniture never invents a capacity: an admitted unknown.
          if (unverified.has(to.type)) s.seatsUnknown = true; else s.dropSeatsState = true;
          return s;
        };
        one(target, set(target), { decisionType: changed ? "correction" : "confirmation", predictionBefore: classOf(target), reviewedIndividually: true });
        memory.push(target.id);
        // The family: every still-unreviewed member the similarity clustering
        // already calls the same shape, that still says what the target said.
        for (const id of decision.familyIds || []) {
          const other = byId.get(id);
          if (!other || other.id === target.id || other.status !== "unreviewed") continue;
          if (other.kind !== target.kind || other.type !== target.type) continue;
          one(other, set(other), { decisionType: "correction", predictionBefore: classOf(other), reviewedIndividually: false, propagatedFrom: target.id,
            note: `propagated from ${target.id}; not individually reviewed by a person` });
          memory.push(other.id);
        }
        break;
      }
      case "confirmFamily":
        for (const id of decision.ids || []) {
          const c = byId.get(id);
          if (!c) continue;
          one(c, { status: "confirmed", selected: true }, { decisionType: "confirmation", predictionBefore: classOf(c), reviewedIndividually: false,
            note: "accepted in bulk via Confirm All; not individually reviewed by a person" });
          memory.push(c.id);
        }
        break;
      // An object the detector missed, added because a person said so (drawn by
      // hand, or a model's suggestion accepted). It is CREATED by the decision,
      // so undo removes it; it carries a missed-object label and plan memory.
      case "addObject": {
        const c = decision.candidate;
        if (!c || !c.id || byId.has(c.id)) break;
        create.push(c);
        writes.push({ id: c.id, set: { status: "confirmed", selected: true } });
        training.push({ id: c.id, decisionType: "missedObject", predictionBefore: null, reviewedIndividually: true,
          note: decision.note || "added by the operator where the detector proposed nothing" });
        memory.push(c.id);
        break;
      }
      // A chair the detector missed, on the table it stands at: the table's own
      // chair list grows by one, and undo takes it back.
      case "addChair": {
        const ch = decision.chair;
        if (!target || target.kind !== "table" || !ch || !ch.id) break;
        one(target, { chairDetections: [...(target.chairDetections || []), ch] });
        break;
      }
      // A seat count a person settled (typed, or a suggestion accepted): the
      // count is verified, and says where it came from.
      case "setSeats": {
        if (!target || !Number.isInteger(decision.value) || decision.value < 0 || decision.value > 99) break;
        one(target, { seats: decision.value, seatsConfidence: "verified", seatsSource: decision.source || "typed" });
        break;
      }
      case "include":
      case "exclude":
        // What Confirm will write — not a statement about what the object is,
        // so no training label and no memory.
        if (!target) break;
        one(target, { selected: kind === "include" });
        break;
      case "forgetLesson": {
        // A lesson taken back puts the detector's own answer back.
        const was = target && target.taughtFrom && target.taughtFrom.was;
        if (!was) break;
        one(target, { kind: was.kind, type: was.type, status: was.status, printedNumber: was.printedNumber ?? null, forgetLesson: true });
        break;
      }
    }
    return { ok: writes.length > 0, reason: writes.length ? null : "nothing to decide", kind, writes, training, memory, create,
      spread: training.filter(t => t.propagatedFrom).length };
  }

  // The fields a decision can change, captured before it so undo restores
  // exactly what was there.
  const SNAPSHOT_FIELDS = ["kind", "type", "status", "selected", "dismissed", "chairDetections", "seats", "seatsConfidence", "seatsSource", "printedNumber", "taughtFrom", "typeBasis"];

  globalThis.MeritReviewDecisions = Object.freeze({ KINDS, SNAPSHOT_FIELDS, plan, classOf });
})();
