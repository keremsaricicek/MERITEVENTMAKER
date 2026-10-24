// A Teach Area note's whole life: kept, saved, still there after the page is
// closed and opened again, applied to the one object it was about after a
// re-analysis, forgotten, and — both ways — taken back with Undo (L4,
// 2026-10-17).
//
// plan-teach-area drives the engine and one round trip in memory. What it did
// not cover: that a note survives a reload (it lives in state.teachings, saved
// with the rest of the state), and that keeping or forgetting one can be
// undone. Undo of "keep" forgets it through the same writer as Forget (the
// object is as it was before the note); undo of "forget" puts back the SAME
// stored lesson — its id, its scope, the object it was taught on — and the
// Teach Area applies it as it applies any note. A historical event refuses both.
import { openApp, createBlankEvent, futureDate } from "../lib/app-actions.mjs";

export const meta = {
  name: "teach-lesson-lifecycle",
  tags: ["intelligence", "teach", "data"],
  timeout: 60000,
  viewport: { width: 1400, height: 900 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Lessons", date: futureDate() });
  const mk = (id, x, y) => ({ id, kind: "venue", type: "other", x, y, w: 6, h: 6, status: "unreviewed", rotation: 0 });
  // an analysis as the detector leaves one: two unreviewed objects of the detector's type
  const setAnalysis = (id, cands) => page.evaluate(({ id, cands }) => {
    const ev = state.events[0];
    ev.venueRef = { venueId: "V", layoutId: "L", layoutVersionId: "LV" };
    ev.analysis = { id, planHash: "HASH-1", diagnostics: {}, planIntelligence: null, candidates: cands };
    globalThis.MeritTeachAreaWiring.applyTeachArea(ev);
    saveState();
  }, { id, cands });
  await setAnalysis("an1", [mk("a", 20, 20), mk("b", 60, 20)]);

  const kept = await page.evaluate(() => {
    const ev = state.events[0], c = ev.analysis.candidates[0];
    state.teachings = [];
    c.type = "stage";
    globalThis.MeritTeachAreaWiring.teachSelectedObject(ev, c, "layout");
    return { n: state.teachings.length, id: state.teachings[0]?.id, scope: state.teachings[0]?.scope,
      undoOffered: !!document.querySelector(".toast.has-action .toast-action") };
  });
  checks.equal([kept.n, kept.scope], [1, "layout"], "a note is kept at the reach the person chose");
  checks.ok(kept.undoOffered, "and the confirmation offers Undo");

  // --- persistence: close the page, open it again ---------------------------
  // the write is queued (IndexedDB); wait for it to land, as a person's next
  // action would — closing mid-write is the save-on-close suite's subject
  await page.evaluate(() => saveState());
  await page.reload();
  await page.waitForFunction(() => Array.isArray(state.events) && state.events.length === 1);
  const afterReload = await page.evaluate(() => ({ n: (state.teachings || []).length, id: state.teachings?.[0]?.id, scope: state.teachings?.[0]?.scope }));
  checks.equal(afterReload, { n: 1, id: kept.id, scope: "layout" }, "after a reload the same note is there, at the same reach");

  // a re-analysis: new ids, the detector's own answer again, the object slightly moved
  await setAnalysis("an2", [mk("a2", 20.2, 19.8), mk("b2", 60, 20)]);
  const reapplied = await page.evaluate(() => state.events[0].analysis.candidates.map((c) => `${c.id}:${c.type}:${c.taughtFrom ? c.taughtFrom.lessonId : "-"}`));
  checks.equal(reapplied, [`a2:stage:${kept.id}`, "b2:other:-"], "after a re-analysis it is applied to that one object, not its neighbour");

  // --- forget, then Undo ----------------------------------------------------
  const forgot = await page.evaluate(() => {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const ev = state.events[0], c = ev.analysis.candidates.find((x) => x.taughtFrom);
    globalThis.MeritTeachAreaWiring.forgetLesson(ev, c);
    return { n: state.teachings.length, type: c.type, badge: !!c.taughtFrom, undo: !!document.querySelector(".toast.has-action .toast-action") };
  });
  checks.equal([forgot.n, forgot.type, forgot.badge], [0, "other", false], "Forget removes the note and gives the object the detector's answer back");
  checks.ok(forgot.undo, "and offers Undo");
  await page.click(".toast.has-action .toast-action");
  const restored = await page.evaluate(() => ({ n: state.teachings.length, id: state.teachings[0]?.id, scope: state.teachings[0]?.scope,
    objects: state.events[0].analysis.candidates.map((c) => `${c.id}:${c.type}`),
    audit: (state.audit || []).filter((a) => a.eventId === state.events[0].id).map((a) => a.action).filter((a) => /TEACH_AREA/.test(a)) }));
  checks.equal([restored.n, restored.id, restored.scope], [1, kept.id, "layout"], "Undo puts back the same note — same id, same reach");
  checks.equal(restored.objects, ["a2:stage", "b2:other"], "and it is applied again to its object only");
  checks.ok(restored.audit.includes("TEACH_AREA_LESSON_RESTORED"), "the audit records that it was put back", restored.audit);
  await page.evaluate(() => saveState());
  await page.reload();
  await page.waitForFunction(() => Array.isArray(state.events) && state.events.length === 1);
  checks.equal(await page.evaluate(() => (state.teachings || []).map((l) => l.id)), [kept.id], "the restored note survives a reload too");

  // --- Undo of keeping ------------------------------------------------------
  await setAnalysis("an3", [mk("a3", 20, 20), mk("b3", 60, 20)]);
  const undoKeep = await page.evaluate(() => {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const ev = state.events[0], c = ev.analysis.candidates[1];
    c.type = "bar";
    globalThis.MeritTeachAreaWiring.teachSelectedObject(ev, c, "plan");
    return { before: state.teachings.length };
  });
  await page.click(".toast.has-action .toast-action");
  const afterUndoKeep = await page.evaluate(() => ({ n: state.teachings.length, b3: state.events[0].analysis.candidates[1].type,
    b3Badge: !!state.events[0].analysis.candidates[1].taughtFrom, ids: state.teachings.map((l) => l.id) }));
  checks.equal(undoKeep.before, 2, "a second note is kept");
  checks.equal([afterUndoKeep.n, afterUndoKeep.ids], [1, [kept.id]], "Undo right after keeping it leaves only the first note");
  checks.equal([afterUndoKeep.b3, afterUndoKeep.b3Badge], ["bar", false], "and its object is exactly as it was before the note — the person's own type, no lesson claimed");

  // --- a historical event refuses both ----------------------------------------
  const hist = await page.evaluate(() => {
    const ev = state.events[0];
    ev.status = "Completed";
    const c = ev.analysis.candidates.find((x) => x.taughtFrom) || ev.analysis.candidates[0];
    const before = state.teachings.length;
    globalThis.MeritTeachAreaWiring.teachSelectedObject(ev, ev.analysis.candidates[1], "plan");
    const afterTeach = state.teachings.length;
    if (c.taughtFrom) globalThis.MeritTeachAreaWiring.forgetLesson(ev, c);
    return { before, afterTeach, afterForget: state.teachings.length };
  });
  checks.equal([hist.afterTeach, hist.afterForget], [hist.before, hist.before], "a completed event keeps its notes as they are: nothing kept, nothing forgotten");
}
