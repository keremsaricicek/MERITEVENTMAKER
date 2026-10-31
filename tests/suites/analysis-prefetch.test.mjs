// The plan's text, read at import (S5, 2026-10-17). Both text reads — the OCR
// model's and Tesseract's whole page — depend on the plan image alone, so the
// product starts them when a plan is imported and hands them to the analysis
// when a person presses Analyse. That is only allowed because it changes
// nothing but WHEN; this suite holds what must stay true:
//
//   1. The same analysis with and without it: on the Golden Plan the OCR
//      model's lines, Tesseract's words and every candidate are identical with
//      the prefetch used and with it switched off (MERIT_PREFETCH="off") — and
//      the analysis records that it used both reads.
//   2. A plan replaced before Analyse is never read for the new one: the
//      prefetch is keyed by the image, so the analysis of the second plan reads
//      it afresh (prefetch recorded unused) — and gives that plan's own answer.
//   3. Not started for a plan the test merely sets as the background (no
//      `importedAtMs`), for an event that already has an analysis, or for a
//      completed event.
//   4. Stop still stops: an analysis that took the prefetch over and is stopped
//      ends with nothing applied, and the next analysis runs to the end.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, futureDate } from "../lib/app-actions.mjs";
import { routeVendorFromCache } from "../lib/vendor.mjs";

export const meta = { name: "analysis-prefetch", tags: ["performance", "intelligence"], timeout: 480000 };

const DONE = () => !ui.analysisBusy && state.events[0].analysis && state.events[0].analysis.timings && state.events[0].analysis.timings.analysisCompletedAtMs;

export default async function run({ page, context, checks, baseUrl, repoRoot }) {
  const golden = "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64");
  const ornek = "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/ornek-upright.png")).toString("base64");
  const newPage = async (init) => { const p = await context.newPage(); await routeVendorFromCache(p); if (init) await p.addInitScript(init); return p; };
  const importReal = (p, src) => p.evaluate((src) => {
    state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100, importedAtMs: Date.now() };
    render();
  }, src);
  const fingerprint = (p) => p.evaluate(() => {
    const a = state.events[0].analysis;
    return {
      prefetch: a.timings.prefetch || null,
      ocrModel: (a.ocrModel && a.ocrModel.items || []).map((i) => [i.text, i.score, i.box.x0, i.box.y0, i.box.x1, i.box.y1]),
      words: a.ocr && a.ocr.available ? (a.ocr.words || []).map((w) => [w.text, w.confidence, w.bbox && w.bbox.x0, w.bbox && w.bbox.y0]) : null,
      candidates: a.candidates.map((c) => [c.kind, c.type, +c.x.toFixed(4), +c.y.toFixed(4), +c.w.toFixed(4), +c.h.toFixed(4), c.status, (c.chairDetections || []).length, c.printedNumber ? c.printedNumber.value : null]),
    };
  });
  const analyse = async (p) => { await p.click('[data-v8-action="detect"]'); await p.waitForFunction(DONE, null, { timeout: 300000, polling: 200 }); };

  // ---- 1. with and without: the same analysis ---------------------------------
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Prefetch", date: futureDate() });
  await importReal(page, golden);
  await page.waitForFunction(() => globalThis.MeritPlanTextPrefetch && MeritPlanTextPrefetch.status().active, null, { timeout: 10000 });
  checks.ok(true, "a freshly imported plan starts its text reads before Analyse");
  await page.waitForTimeout(4000); // a person looking at the plan for a moment
  await analyse(page);
  const withIt = await fingerprint(page);
  await page.evaluate(() => { globalThis.__firstDone = state.events[0].analysis.timings.analysisCompletedAtMs; });

  const off = await newPage(() => { globalThis.MERIT_PREFETCH = "off"; });
  await openApp(off, baseUrl, { lang: "en" });
  await createBlankEvent(off, { name: "Prefetch off", date: futureDate() });
  await importReal(off, golden);
  await off.waitForTimeout(500);
  checks.equal(await off.evaluate(() => MeritPlanTextPrefetch.status().active), false, "switched off, nothing is read before Analyse");
  await analyse(off);
  const without = await fingerprint(off);
  await off.close();
  checks.equal([withIt.prefetch && withIt.prefetch.model, withIt.prefetch && withIt.prefetch.page], [true, true], "the analysis took both reads begun at import", withIt.prefetch);
  checks.equal(without.prefetch && [without.prefetch.model, without.prefetch.page], [false, false], "without it, the analysis read both itself", without.prefetch);
  checks.require(withIt.ocrModel.length > 0 && withIt.candidates.length > 0, "the plan was read and analysed", { lines: withIt.ocrModel.length, candidates: withIt.candidates.length });
  checks.equal(withIt.ocrModel, without.ocrModel, `the OCR model's ${without.ocrModel.length} lines are identical`);
  checks.equal(withIt.words, without.words, "Tesseract's whole-page words are identical");
  checks.equal(withIt.candidates, without.candidates, `all ${without.candidates.length} candidates are identical, numbers included`);

  // ---- 1b. a re-analysis of the same plan reuses the reads it completed (S7) ---
  // The text depends on the image alone, so the reads the last analysis
  // completed are handed to the next one as copies: the same lines, words and
  // candidates, without reading the plan again.
  await page.click('.planintel-screen [data-review-action="reanalyze"]');
  await page.waitForFunction(() => !ui.analysisBusy && state.events[0].analysis && state.events[0].analysis.timings && state.events[0].analysis.timings.prefetch
    && state.events[0].analysis.timings.prefetch.keptFromLastAnalysis !== undefined && state.events[0].analysis.timings.analysisCompletedAtMs > (globalThis.__firstDone || 0), null, { timeout: 300000, polling: 200 });
  const again1 = await fingerprint(page);
  checks.equal(again1.prefetch && [again1.prefetch.keptFromLastAnalysis, again1.prefetch.model, again1.prefetch.page], [true, true, true],
    "re-analysing the same plan reuses the two reads the last analysis completed", again1.prefetch);
  checks.equal(again1.ocrModel, without.ocrModel, "and the OCR model's lines are the ones a fresh read gives");
  checks.equal(again1.words, without.words, "and Tesseract's words are the ones a fresh read gives");
  checks.equal(again1.candidates, without.candidates, "and every candidate is the one a fresh read gives");

  // ---- 2. a plan replaced before Analyse ---------------------------------------
  const swap = await newPage();
  await openApp(swap, baseUrl, { lang: "en" });
  await createBlankEvent(swap, { name: "Swap", date: futureDate() });
  await importReal(swap, ornek);
  await swap.waitForFunction(() => MeritPlanTextPrefetch.status().active, null, { timeout: 10000 });
  await importReal(swap, golden);
  await swap.waitForTimeout(300);
  await analyse(swap);
  const swapped = await fingerprint(swap);
  await swap.close();
  checks.equal(swapped.candidates, without.candidates, "the plan imported second is analysed as itself, not with the first plan's text");
  checks.equal(swapped.ocrModel, without.ocrModel, "and its text is its own");

  // ---- 3. not started where it must not be --------------------------------------
  const quiet = await newPage();
  await openApp(quiet, baseUrl, { lang: "en" });
  await createBlankEvent(quiet, { name: "Quiet", date: futureDate() });
  await quiet.evaluate((src) => { state.events[0].background = { src, name: "p.png", opacity: 1, visible: true, locked: false, scale: 100 }; render(); }, golden);
  await quiet.waitForTimeout(300);
  const notImported = await quiet.evaluate(() => MeritPlanTextPrefetch.status().active);
  await quiet.evaluate((src) => { const e = state.events[0]; e.status = "Completed"; e.background = { src, name: "p.png", opacity: 1, visible: true, locked: false, scale: 100, importedAtMs: Date.now() }; render(); }, golden);
  await quiet.waitForTimeout(300);
  const historical = await quiet.evaluate(() => MeritPlanTextPrefetch.status().active);
  await quiet.evaluate((src) => { const e = state.events[0]; e.status = "Planning"; e.analysis = { candidates: [], timings: {} }; e.background = { src, name: "p.png", opacity: 1, visible: true, locked: false, scale: 100, importedAtMs: Date.now() }; render(); }, golden);
  await quiet.waitForTimeout(300);
  const analysed = await quiet.evaluate(() => MeritPlanTextPrefetch.status().active);
  await quiet.close();
  checks.equal([notImported, historical, analysed], [false, false, false], "nothing is read early for a background that was not imported, a completed event, or an event already analysed");

  // ---- 3b. the new-event dialog, the way most plans arrive ----------------------
  // Until 2026-10-18 the dialog's Create wrote the plan with no importedAtMs,
  // so the prefetch never started on the product's main import path; every
  // case above set the stamp by hand and could not see it.
  const dialog = await newPage();
  await openApp(dialog, baseUrl, { lang: "en" });
  await dialog.click('.appbar [data-action="create-event"]');
  await dialog.waitForSelector('input[name="name"]');
  await dialog.fill('input[name="name"]', "Dialog import");
  await dialog.fill('input[name="hotel"]', "Merit");
  await dialog.fill('input[name="date"]', futureDate());
  await dialog.setInputFiles("#v8PlanFile", { name: "golden.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")) });
  await dialog.waitForFunction(() => !!document.querySelector("#v8PlanDrop img")?.complete, null, { timeout: 30000 });
  await dialog.click('[data-setup="create"]');
  await dialog.waitForFunction(() => ui.screen === "workspace" && activeEvent() && activeEvent().name === "Dialog import", null, { timeout: 15000 });
  await dialog.waitForFunction(() => globalThis.MeritPlanTextPrefetch && MeritPlanTextPrefetch.status().active, null, { timeout: 10000 }).catch(() => {});
  const viaDialog = await dialog.evaluate(() => ({ stamped: Number.isFinite(activeEvent().background.importedAtMs), active: MeritPlanTextPrefetch.status().active }));
  await dialog.close();
  checks.equal(viaDialog, { stamped: true, active: true }, "a plan imported through the new-event dialog is stamped as imported, and its text reads start before Analyse");

  // ---- 4. Stop after the analysis took the prefetch over ------------------------
  const stop = await newPage();
  await openApp(stop, baseUrl, { lang: "en" });
  await createBlankEvent(stop, { name: "Stop", date: futureDate() });
  await importReal(stop, golden);
  await stop.waitForFunction(() => MeritPlanTextPrefetch.status().active, null, { timeout: 10000 });
  await stop.click('[data-v8-action="detect"]');
  await stop.waitForSelector('[data-review-action="cancel-analysis"]:not([disabled])', { timeout: 20000 });
  await stop.click('[data-review-action="cancel-analysis"]');
  await stop.waitForFunction(() => !ui.analysisBusy, null, { timeout: 60000 });
  const afterStop = await stop.evaluate(() => ({ analysis: !!state.events[0].analysis, active: MeritPlanTextPrefetch.status().active }));
  checks.equal(afterStop, { analysis: false, active: false }, "stopped: nothing applied, the prefetch the analysis took over is gone, and none is started again behind the person's back");
  await stop.click('.planintel-screen [data-review-action="reanalyze"]');
  await stop.waitForFunction(DONE, null, { timeout: 300000, polling: 200 });
  const again = await fingerprint(stop);
  await stop.close();
  checks.equal(again.candidates, without.candidates, "the next analysis runs to the end with the same answer");
}
