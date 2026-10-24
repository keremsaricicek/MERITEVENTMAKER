// The Teach Area — does an operator's knowledge stay inside the reach they gave it?
//
// A person who knows the room knows things the drawing does not say: which
// block is the stage, how this venue numbers its tables, that the grey shape by
// the service door is a pillar. The Teach Area keeps those, each with a scope —
// this plan, this layout, this venue — and offers them again where they apply.
//
// The whole risk is in that word "where". A note kept too narrowly is merely
// re-typed. A note applied too widely lands on the wrong table and corrupts a
// plan while looking like the feature worked, which is the failure this suite
// exists to prevent. So the rules under test are:
//
//   ONE LESSON IS ABOUT ONE OBJECT. Never spread to everything that resembles
//   it — that is a different feature with a different risk, and it already
//   exists elsewhere, marked as not individually reviewed.
//   THE WIDER THE SCOPE, THE STRONGER THE EVIDENCE. On this drawing nothing
//   moved, so resemblance is identity. Across a venue the drawing may be a
//   different drawing, and "a circle like the circle I ruled on" describes a
//   hundred tables — so only the printed number identifies.
//   AMBIGUOUS TOUCHES NOTHING.
//   AND IT IS NOT TRAINING. Nothing is fitted; the wording must not pretend
//   otherwise.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "plan-teach-area",
  tags: ["intelligence"],
  timeout: 60000,
  viewport: { width: 1200, height: 800 },
};

// A lesson's geometry: tolerance 3 (4 * 0.75), search radius 9.
const AT = { x: 10, y: 10, w: 4, h: 4, rotation: 0 };
const WHERE = { planHash: "plan-a", layoutId: "layout-1", layoutVersionId: "v3", venueId: "venue-x" };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const present = await page.evaluate(() =>
    typeof globalThis.MeritTeachArea === "object" && typeof globalThis.MeritPlanMemory === "object");
  checks.require(present, "the teach area and the memory it defers to are both reachable");

  const teach = (input) => page.evaluate((i) => globalThis.MeritTeachArea.lesson(i), input);
  const inForce = (all, where) => page.evaluate(([a, w]) => globalThis.MeritTeachArea.inForce(a, w), [all, where]);
  const propose = (lessons, cands) => page.evaluate(([l, c]) => globalThis.MeritTeachArea.propose(l, c), [lessons, cands]);
  const describe = (l) => page.evaluate((x) => globalThis.MeritTeachArea.describe(x), l);

  const stageLesson = async (over = {}) => {
    const r = await teach({
      scope: "plan", where: WHERE,
      subject: { kind: "objectIdentity", type: "stage" },
      from: { candidateId: "c1", kind: "venue", type: "other", geometry: AT },
      ...over,
    });
    checks.require(r.ok, "the sample lesson is storable", r.reason);
    return r.lesson;
  };

  // ---- what may be stored, and what may not -------------------------------
  {
    const r = await teach({ scope: "everywhere", where: WHERE, subject: { kind: "planFact", fact: "x" } });
    checks.ok(!r.ok, "a scope the product does not have is refused");
    checks.ok(/unknown scope/.test(r.reason), "and says so", r.reason);
  }
  {
    const r = await teach({ scope: "venue", where: { planHash: "plan-a" },
      subject: { kind: "planFact", fact: "numbering" } });
    checks.ok(!r.ok, "a venue-scope lesson on a drawing with no venue is refused");
    checks.ok(/venueId/.test(r.reason), "naming what is missing rather than failing silently", r.reason);
  }
  {
    const r = await teach({ scope: "plan", where: WHERE, subject: { kind: "objectIdentity", type: "stage" } });
    checks.ok(!r.ok, "a lesson about an object with no object attached is refused");
  }
  {
    // The rule that matters most, enforced at the point of storage: teaching
    // something about one circle "everywhere in this venue" is only meaningful
    // if the circle can be identified on a drawing nobody has seen yet.
    const r = await teach({ scope: "venue", where: WHERE,
      subject: { kind: "objectIdentity", type: "pillar" },
      from: { candidateId: "c1", kind: "venue", type: "other", geometry: AT } });
    checks.ok(!r.ok, "a venue-wide lesson about an object with no confirmed number is refused");
    checks.ok(/printed number/.test(r.reason), "because resemblance is not identity across a venue", r.reason);
    checks.ok(/layout/.test(r.reason), "and the operator is told the scope that would work", r.reason);
  }
  {
    const r = await teach({ scope: "venue", where: WHERE,
      subject: { kind: "tableNumber", value: 137 },
      from: { candidateId: "c1", kind: "table", type: "round", geometry: AT,
        printedNumber: { state: "VERIFIED", value: 137 } } });
    checks.ok(r.ok, "the same lesson on a table with a confirmed number is kept", r.reason);
    checks.equal(r.lesson.from.printedNumber.value, 137, "with the identifier stored alongside it");
    checks.equal(r.lesson.scopeKey, "venue:venue-x", "anchored to the venue it was taught in");
  }
  {
    const r = await teach({ scope: "plan", where: WHERE,
      subject: { kind: "objectIdentity", type: "stage" },
      from: { candidateId: "c1", kind: "venue", type: "other", geometry: AT,
        printedNumber: { state: "NEEDS_REVIEW", value: 4 } } });
    checks.ok(r.ok, "a number that was not confirmed is not refused", r.reason);
    checks.equal(r.lesson.from.printedNumber, null, "but it is not stored as an identifier either");
  }

  // ---- which lessons are in force on the drawing that is open -------------
  const here = await stageLesson();
  {
    const elsewhere = (await teach({ scope: "plan", where: { ...WHERE, planHash: "plan-b" },
      subject: { kind: "objectIdentity", type: "stage" },
      from: { candidateId: "c9", kind: "venue", type: "other", geometry: AT } })).lesson;
    const r = await inForce([here, elsewhere], WHERE);
    checks.equal(r.lessons.length, 1, "a lesson taught on another drawing is not in force on this one");
    checks.equal(r.lessons[0].id, here.id, "and the one taught on this drawing is");
  }
  {
    // Same object, taught twice at different reach. The narrower one is the
    // more considered answer, so it wins and the other is reported as
    // superseded rather than quietly dropped.
    const broad = (await teach({ scope: "layout", where: WHERE,
      subject: { kind: "objectIdentity", type: "dancefloor" },
      from: { candidateId: "c1", kind: "venue", type: "other", geometry: AT } })).lesson;
    const r = await inForce([broad, here], WHERE);
    checks.equal(r.lessons.length, 1, "one answer stands for one object");
    checks.equal(r.lessons[0].scope, "plan", "and it is the narrower one");
    checks.equal(r.superseded.length, 1, "the broader one is reported, not discarded in silence");
    checks.ok(/more specific/.test(r.superseded[0].detail), "with the reason given", r.superseded[0].detail);
  }
  {
    // Same reach, same object, different answers. This is one person changing
    // their mind, not two people disagreeing: the later answer stands, and
    // locking them out of their own note would be the wrong reading.
    const first = (await teach({ scope: "plan", where: WHERE, id: "L_a",
      taughtAt: "2026-09-01T10:00:00.000Z",
      subject: { kind: "objectIdentity", type: "stage" },
      from: { candidateId: "c1", kind: "venue", type: "other", geometry: AT } })).lesson;
    const second = (await teach({ scope: "plan", where: WHERE, id: "L_b",
      taughtAt: "2026-09-02T10:00:00.000Z",
      subject: { kind: "objectIdentity", type: "pillar" },
      from: { candidateId: "c1", kind: "venue", type: "other", geometry: AT } })).lesson;
    const r = await inForce([first, second], WHERE);
    checks.equal(r.lessons.length, 1, "one answer stands even when the same question was answered twice");
    checks.equal(r.lessons[0].id, "L_b", "and it is the later one — a person correcting themselves");
    checks.equal(r.superseded[0].lessonId, "L_a", "the earlier answer is reported, not dropped in silence");
    checks.ok(/again later/.test(r.superseded[0].detail), "with a reason an operator can act on", r.superseded[0].detail);
  }

  // ---- what those lessons propose ----------------------------------------
  const other = { id: "far", kind: "table", type: "round", x: 60, y: 60, w: 4, h: 4 };
  {
    const r = await propose([here], [{ id: "same", kind: "venue", type: "other", ...AT }, other]);
    const p = r.proposals[0];
    checks.equal(r.proposals.length, 1, "one lesson proposes one thing");
    checks.equal(p.state, "APPLY", "the object it was taught on, on the same drawing, is acted on");
    checks.equal(p.candidateId, "same", "and it is that object");
    checks.ok(/same drawing/.test(p.why), "with the reason readable by a person", p.why);
  }
  {
    // The rule the whole feature turns on. Forty near-identical circles, one
    // lesson: one of them changes.
    const grid = [];
    for (let i = 0; i < 40; i++)
      grid.push({ id: `g${i}`, kind: "venue", type: "other",
        x: 10 + (i % 8) * 6, y: 10 + Math.floor(i / 8) * 6, w: 4, h: 4 });
    const r = await propose([here], grid);
    checks.equal(r.proposals.length, 1, "a lesson taught on one object never becomes forty");
    checks.equal(r.summary.apply, 1, "exactly one object is proposed for change");
    checks.equal(r.proposals[0].candidateId, "g0", "the one it was actually taught on");
  }
  {
    // Two objects fit equally well. Picking one silently is how a decision
    // lands on the neighbour.
    const r = await propose([here], [
      { id: "left", kind: "venue", type: "other", x: 8, y: 10, w: 4, h: 4 },
      { id: "right", kind: "venue", type: "other", x: 12, y: 10, w: 4, h: 4 },
    ]);
    checks.equal(r.proposals[0].state, "AMBIGUOUS", "two equal fits are ambiguous");
    checks.equal(r.proposals[0].candidateId, null, "and nothing is changed");
    checks.equal(r.summary.apply, 0, "no application is counted");
  }
  {
    const r = await propose([here], [other]);
    checks.equal(r.proposals[0].state, "NOT_ON_THIS_PLAN", "a lesson whose object is absent is reported as absent");
    checks.ok(/not on this plan/.test(r.proposals[0].why), "rather than forced onto something", r.proposals[0].why);
  }
  {
    const r = await propose([here], []);
    checks.equal(r.proposals[0].state, "NOT_ON_THIS_PLAN", "and a plan with nothing detected changes nothing");
  }

  // ---- the wider the scope, the stronger the evidence has to be -----------
  const numbered = { candidateId: "c1", kind: "table", type: "round", geometry: AT,
    printedNumber: { state: "VERIFIED", value: 137 } };
  const venueLesson = (await teach({ scope: "venue", where: WHERE,
    subject: { kind: "objectIdentity", type: "vipTable" }, from: numbered })).lesson;
  const layoutLesson = (await teach({ scope: "layout", where: WHERE,
    subject: { kind: "objectIdentity", type: "vipTable" },
    from: { candidateId: "c1", kind: "table", type: "round", geometry: AT } })).lesson;
  {
    const r = await propose([venueLesson], [
      { id: "t137", kind: "table", type: "round", ...AT, printedNumber: { state: "VERIFIED", value: 137 } }]);
    checks.equal(r.proposals[0].state, "APPLY", "across a venue, the table with the same printed number is the same table");
    checks.equal(r.proposals[0].number, 137, "and the identifier is what decided it");
    checks.ok(/printed on both/.test(r.proposals[0].basis), "recorded as an identifier, not a resemblance", r.proposals[0].basis);
  }
  {
    const r = await propose([venueLesson], [{ id: "unnumbered", kind: "table", type: "round", ...AT }]);
    checks.equal(r.proposals[0].state, "REVIEW",
      "across a venue, an object that merely sits in the same place is offered, not applied");
    checks.ok(/printed number/.test(r.proposals[0].why), "and the reason is the missing identifier", r.proposals[0].why);
  }
  {
    // Phase 4's veto, seen from here: a different number is a different table,
    // whatever it looks like or where it sits.
    const r = await propose([venueLesson], [
      { id: "t99", kind: "table", type: "round", ...AT, printedNumber: { state: "VERIFIED", value: 99 } }]);
    checks.equal(r.proposals[0].state, "NOT_ON_THIS_PLAN", "a different number is a different table");
  }
  {
    const r = await propose([layoutLesson], [{ id: "unnumbered", kind: "table", type: "round", ...AT }]);
    checks.equal(r.proposals[0].state, "APPLY",
      "within one layout the same position IS enough, because the drawing is the same drawing");
  }

  // ---- a fact about the drawing is not a claim about an object ------------
  {
    const fact = (await teach({ scope: "venue", where: WHERE,
      subject: { kind: "planFact", fact: "numberingRange",
        statement: "tables in this room run 1 to 166 with no 13", value: { min: 1, max: 166 } } })).lesson;
    const r = await propose([fact], [{ id: "same", kind: "venue", type: "other", ...AT }]);
    checks.equal(r.proposals[0].state, "STATED", "a fact about the room is stated, not matched to an object");
    checks.equal(r.proposals[0].candidateId, null, "and claims no object");
    checks.equal(r.summary.stated, 1, "counted as what it is");
  }
  {
    const r = await propose([here], [{ id: "same", kind: "venue", type: "other", ...AT }]);
    const s = r.summary;
    checks.equal(s.apply + s.review + s.ambiguous + s.notOnThisPlan + s.stated, s.total,
      "every proposal lands in exactly one bucket");
  }

  // ---- and none of this is training --------------------------------------
  {
    const words = /\b(train|trains|trained|training|model|models|learn|learns|learned|learning|neural|weights?)\b/i;
    const statement = await page.evaluate(() => globalThis.MeritTeachArea.STATEMENT);
    checks.ok(!words.test(statement), "the Teach Area's own statement never claims anything is trained", statement);
    checks.ok(/scope/.test(statement), "it says what it actually does: it keeps a note within a scope", statement);

    const lines = [
      await describe(here),
      await describe(venueLesson),
      await describe((await teach({ scope: "plan", where: WHERE,
        subject: { kind: "tableNumber", value: 137 }, from: numbered })).lesson),
      await describe((await teach({ scope: "venue", where: WHERE,
        subject: { kind: "planFact", fact: "numberingRange", statement: "tables run 1 to 166" } })).lesson),
    ];
    for (const line of lines)
      checks.ok(!words.test(line), "and neither does the line the operator reads", line);
    checks.ok(/on this plan/.test(lines[0]), "each line says how far the lesson reaches", lines[0]);
    checks.ok(/everywhere in this venue/.test(lines[1]), "including the widest one", lines[1]);

    // The app passes its own word for the type, in the operator's language, so
    // the line never has to guess an article and never reads "a other".
    const labelled = (await teach({ scope: "plan", where: WHERE,
      subject: { kind: "objectIdentity", objectKind: "venue", type: "other", label: "Sütun" },
      from: { candidateId: "c1", kind: "venue", type: "other", geometry: AT } })).lesson;
    const line = await describe(labelled);
    checks.ok(/Sütun/.test(line), "the operator's own word for the type is what appears", line);
    checks.ok(!/\ba other\b/.test(line), "and no line reads \"a other\"", line);

    const r = await propose([venueLesson, here], [{ id: "same", kind: "venue", type: "other", ...AT }]);
    for (const p of r.proposals)
      checks.ok(!words.test(p.why), "nor the reason attached to a proposal", p.why);
  }

  // ---- the round trip, through the app's own wiring -----------------------
  //
  // The engine above is only half the feature. The other half is what the app
  // does with it: where it thinks the open drawing sits, and what "applying"
  // actually changes on a candidate. Driven directly rather than through a
  // 30-second detection run, but through the real functions.
  const wired = await page.evaluate(() => typeof globalThis.MeritTeachAreaWiring === "object");
  checks.require(wired, "the app's teach-area wiring is reachable");

  const roundTrip = await page.evaluate(() => {
    const W = globalThis.MeritTeachAreaWiring;
    state.teachings = [];
    const mk = (id, x, y) => ({ id, kind: "venue", type: "other", x, y, w: 6, h: 6,
      status: "unreviewed", rotation: 0 });
    const ev = {
      id: "ev_t", venueRef: { venueId: "V", layoutId: "L", layoutVersionId: "LV" },
      background: { src: "" },
      analysis: { id: "an", planHash: "HASH-1", candidates: [mk("a", 20, 20), mk("b", 60, 20)],
        diagnostics: {}, planIntelligence: null },
    };
    const out = { where: W.teachWhere(ev) };

    // A person corrects the object, then asks for it to be remembered.
    const target = ev.analysis.candidates[0];
    target.type = "stage";
    W.teachSelectedObject(ev, target, "layout");
    out.stored = state.teachings.length;
    out.storedScope = state.teachings[0] && state.teachings[0].scope;
    out.appliedNow = ev.analysis.teachArea && ev.analysis.teachArea.applied;

    // Re-analysis: fresh candidates, new ids, the detector's original answer,
    // and the object a couple of tenths of a percent from where it was.
    ev.analysis = { id: "an2", planHash: "HASH-1", diagnostics: {}, planIntelligence: null,
      candidates: [mk("a2", 20.2, 19.8), mk("b2", 60, 20)] };
    W.applyTeachArea(ev);
    const back = ev.analysis.candidates.find((c) => c.type === "stage");
    out.recovered = !!back;
    out.recoveredId = back ? back.id : null;
    out.recoveredScope = back && back.taughtFrom ? back.taughtFrom.scope : null;
    out.untouched = ev.analysis.candidates.filter((c) => c.type === "other").length;
    out.summary = ev.analysis.teachArea.summary;

    // Taking it back. The lesson leaves the Teach Area and the object goes back
    // to what the detector said, rather than being left at an answer with no
    // author.
    const taught = ev.analysis.candidates.find((c) => c.taughtFrom);
    W.forgetLesson(ev, taught);
    out.afterForget = { teachings: state.teachings.length, type: taught.type,
      status: taught.status, badge: !!taught.taughtFrom,
      applied: ev.analysis.teachArea.applied };

    // Teach it again so the rest of the checks have something to work with.
    W.teachSelectedObject(ev, Object.assign(ev.analysis.candidates[0], { type: "stage" }), "layout");

    // The same drawing under a different venue: a LAYOUT-scope note has no
    // business there.
    const other = { id: "ev_o", venueRef: { venueId: "V2", layoutId: "L2", layoutVersionId: "LV2" },
      background: { src: "" },
      analysis: { id: "an3", planHash: "HASH-2", diagnostics: {}, planIntelligence: null,
        candidates: [mk("c", 20, 20)] } };
    W.applyTeachArea(other);
    out.elsewhereApplied = other.analysis.teachArea.applied;
    out.elsewhereType = other.analysis.candidates[0].type;

    state.teachings = [];
    return out;
  });

  checks.equal(roundTrip.where.layoutId, "L", "the app knows which layout the open drawing belongs to");
  checks.equal(roundTrip.where.planHash, "HASH-1", "and which drawing it is");
  checks.equal(roundTrip.stored, 1, "teaching stores one lesson");
  checks.equal(roundTrip.storedScope, "layout", "at the reach the operator chose, not a default");
  checks.equal(roundTrip.appliedNow, 1, "and it takes effect on the object it was taught on");
  checks.ok(roundTrip.recovered, "after a re-analysis with new ids the note comes back");
  checks.equal(roundTrip.recoveredId, "a2", "onto the object that is actually there now");
  checks.equal(roundTrip.recoveredScope, "layout", "carrying the reach it was written with, so the card can say so");
  checks.equal(roundTrip.untouched, 1, "and the object it was not about is left alone");
  checks.equal(roundTrip.summary.apply, 1, "one lesson, one application");
  checks.equal(roundTrip.afterForget.teachings, 0, "forgetting a note removes it from the Teach Area");
  checks.equal(roundTrip.afterForget.type, "other", "and the object goes back to what the detector said");
  checks.equal(roundTrip.afterForget.status, "unreviewed", "including its review state");
  checks.ok(!roundTrip.afterForget.badge, "with nothing left claiming a person wrote it");
  checks.equal(roundTrip.afterForget.applied, 0, "and nothing is applied any more");
  checks.equal(roundTrip.elsewhereApplied, 0, "a layout-scope note does nothing in another venue");
  checks.equal(roundTrip.elsewhereType, "other", "the object there keeps the detector's answer");
}
