// Questions about the plan (src/plan-scene-query.js, MeritSceneQuery) and the
// review screen's answer to them.
//
// What this pins:
//   A CLOSED SET, NEVER A GUESS. A sentence in Turkish or English is matched
//     to one rule ("tables with no number read", "boxes next to the stage",
//     "tables sharing a number", "tables without chairs", "held back",
//     "not reviewed"); a sentence that matches none is answered with the list
//     of questions this build answers, and nothing opens.
//   "NEXT TO" IS MEASURED IN THE PLAN'S PIXELS. The gap between boxes, in one
//     unit on both axes (plan-percent is not square), within 1.5 x the
//     kind's typical size — stated with the answer.
//   A REJECTED OBJECT IS NOT AN ANSWER, and only a VERIFIED number counts as
//     a number (a duplicate is two verified readings, not two guesses).
//   ASKING CHANGES NOTHING. The answer opens as a review queue — one click
//     per object — and the analysis is byte-identical afterwards.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "scene-queries", tags: ["intelligence", "ux"], timeout: 240000, viewport: { width: 1600, height: 1000 } };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/plan-scene-query.js"), "utf8"), ctx);
  const Q = ctx.MeritSceneQuery;
  checks.require(!!Q && typeof Q.run === "function", "MeritSceneQuery loads outside the browser");

  // ---- the words -------------------------------------------------------------------
  const ids = (s) => { const p = Q.parse(s); return p ? p.id + (p.type ? ":" + p.type : "") : null; };
  checks.equal(["Numarası okunmayan masaları göster", "Sahnenin yanındaki locaları işaretle", "SAHNENİN YANINDAKİ MASALAR", "show the tables with no number read",
    "mark the boxes next to the stage", "aynı numaralı masalar", "tables without chairs", "geri tutulan nesneler", "incelenmemiş nesneler", "what time is dinner", ""].map(ids),
    ["unnumbered", "nearStage:loca", "nearStage:table", "unnumbered", "nearStage:loca", "duplicateNumbers", "noChairs", "heldBack", "unreviewed", null, null],
    "Turkish and English sentences reach the same rule; a sentence outside the set reaches none");

  // ---- the rules, on a plan that is four times wider than tall ---------------------------
  const c = (id, o) => ({ id, kind: "venue", type: "loca", status: "unreviewed", x: 0, y: 0, w: 2, h: 8, ...o });
  const plan = { candidates: [
    c("stage", { type: "stage", x: 40, y: 0, w: 20, h: 20 }),
    c("right", { x: 62, y: 0 }),                 // 2% of 2000 = 40 px to the right
    c("below", { x: 45, y: 30 }),                // 10% of 500 = 50 px below
    c("far", { x: 70, y: 0 }),                   // 200 px away
    c("gone", { x: 61, y: 5, status: "rejected" }),
    c("t1", { kind: "table", type: "round", x: 5, y: 50, w: 3, h: 12, printedNumber: { state: "VERIFIED", value: 7 }, chairDetections: [{}] }),
    c("t2", { kind: "table", type: "round", x: 15, y: 50, w: 3, h: 12, printedNumber: { state: "VERIFIED", value: 7 } }),
    c("t3", { kind: "table", type: "round", x: 25, y: 50, w: 3, h: 12, printedNumber: { state: "UNCERTAIN", value: 9 }, selected: false, lowEvidence: { reason: "belowReviewThreshold" } }),
    c("t4", { kind: "table", type: "round", x: 35, y: 50, w: 3, h: 12, status: "confirmed" }),
  ] };
  const size = { width: 2000, height: 500 };
  const near = Q.run("boxes next to the stage", plan, size);
  checks.ok(near.ok && JSON.stringify(near.ids) === JSON.stringify(["right", "below"]) && near.reach === 60,
    "next to the stage is a gap in pixels within 1.5 x the boxes' typical size: 40 px and 50 px are in, 200 px is out, a rejected box is never an answer", near);
  checks.equal(["tables with no number read", "tables sharing a number", "tables without chairs", "held-back objects", "not yet reviewed"].map((q) => Q.run(q, plan, size).ids),
    [["t3", "t4"], ["t1", "t2"], ["t2", "t3", "t4"], ["t3"], ["stage", "right", "below", "far", "t1", "t2", "t3"]],
    "unread means not VERIFIED; a duplicate is two verified readings; held back and unreviewed come from the analysis as it is");
  checks.equal([Q.run("locas near the stage", { candidates: [c("x")] }, size).reason, Q.run("what time is dinner", plan, size).reason],
    ["NO_STAGE", "UNKNOWN_QUESTION"], "no stage is said as no stage; an unknown sentence is answered as unknown, never guessed");

  // ---- the review screen ----------------------------------------------------------------
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Sorular", date: futureDate() });
  await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64"));
  await runDetection(page);
  await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; render(); });
  await page.waitForSelector("[data-scene-form] input");
  const snap = () => page.evaluate(() => JSON.stringify(state.events[0].analysis.candidates));
  const before = await snap();
  const expected = await page.evaluate(() => { const a = state.events[0].analysis; return MeritSceneQuery.run("Sahnenin yanındaki masaları işaretle", a, { width: a.imageWidth, height: a.imageHeight }); });
  await page.fill("[data-scene-form] input", "Sahnenin yanındaki masaları işaretle");
  await page.click("[data-scene-form] button");
  await page.waitForSelector(".review-queue-bar");
  const opened = await page.evaluate(() => ({ ids: ui.reviewQueue && ui.reviewQueue.ids, selected: ui.selectedCandidateId, bar: document.querySelector(".review-queue-bar .rq-what").textContent }));
  checks.ok(expected.ok && expected.ids.length > 0 && JSON.stringify(opened.ids) === JSON.stringify(expected.ids) && opened.selected === expected.ids[0]
    && /Sahnenin yanındaki Masalar \(\d+\) · kenarına \d+ piksel içinde/.test(opened.bar),
    "a Turkish question opens the tables next to the stage as a review queue, the nearest selected, the rule's reach on the bar", { expected, opened });
  await page.click('[data-queue="exit"]');
  await page.fill("[data-scene-form] input", "akşam yemeği kaçta");
  await page.click("[data-scene-form] button");
  await page.waitForSelector(".scene-answer");
  const unknown = await page.evaluate(() => ({ queue: !!ui.reviewQueue, text: document.querySelector(".scene-answer").textContent }));
  checks.ok(!unknown.queue && /Bu sürüm şu soruları yanıtlar: Numarası okunmayan masaları göster · Sahnenin yanındaki locaları işaretle/.test(unknown.text) && /Tahmin yapılmadı/.test(unknown.text),
    "a question outside the set is answered with the questions this build answers, and nothing opens", unknown);
  checks.equal(await snap(), before, "asking changed nothing on the analysis");
}
