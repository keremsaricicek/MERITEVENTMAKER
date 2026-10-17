// The analysis runs its heavy engines off the page, reads each crop once, and
// Stop really stops. benchmarks/perf/analysis-profile.mjs measures the TIME;
// this suite holds what must stay TRUE while the time comes down.
//
//   1. Same answer in a worker as on the page: the OCR model's plan-wide read
//      and the local detector's boxes on the Golden Plan, worker pool on and
//      off (MERIT_ORT_WORKERS_DISABLED) — every item identical.
//   2. Printed table numbers do not depend on read order: readTableNumbers with
//      one lane and with six, over a scripted engine whose answers come back in
//      a random order — the same answer for every table.
//   3. A crop is read once: the same crop twice is one engine read and one
//      cache hit; a crop one pixel different is a second engine read.
//   4. While an analysis runs, the review header says the result is not
//      complete and offers Stop instead of Re-analyse, and the objects on the
//      map take no clicks.
//   5. Stop stops: the screen is free at once, says it stopped, keeps what was
//      there before; every worker the analysis started (ONNX and Tesseract) is
//      terminated, not merely ignored; and the next analysis runs to the end
//      with its engines loaded again.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, importPlan, futureDate, click } from "../lib/app-actions.mjs";
import { routeVendorFromCache } from "../lib/vendor.mjs";

export const meta = { name: "analysis-workers", tags: ["performance", "resilience", "intelligence", "fast"], timeout: 420000 };

// Every Worker the page creates, and whether it was terminated.
const TRACK_WORKERS = () => {
  const Base = globalThis.Worker;
  globalThis.__workers = [];
  globalThis.Worker = class extends Base {
    constructor(...args) { super(...args); this.__alive = true; globalThis.__workers.push(this); }
    terminate() { this.__alive = false; return super.terminate(); }
  };
};

export default async function run({ page, context, checks, baseUrl, repoRoot }) {
  const planUrl = "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64");
  const newPage = async (init) => { const p = await context.newPage(); await routeVendorFromCache(p); if (init) await p.addInitScript(init); return p; };

  // ---- 1. worker and page give the same answer ---------------------------------
  const readBoth = async (p) => {
    await openApp(p, baseUrl, { lang: "en" });
    return p.evaluate(async (src) => {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const ocr = await MeritPaddleOCR.readPlanText(img, { timeoutMs: 180000 });
      const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const model = await MeritPlanModel.detect(g.getImageData(0, 0, c.width, c.height), c.width, c.height);
      return { ocrAvailable: ocr.available, runsIn: ocr.provider && ocr.provider.runsIn, items: (ocr.items || []).map((i) => [i.text, i.score, i.box.x0, i.box.y0, i.box.x1, i.box.y1, i.rotated]),
        modelAvailable: model.available, modelRunsIn: model.model && model.model.runsIn, detections: model.detections.map((d) => [d.cls, d.score, +d.cx.toFixed(3), +d.cy.toFixed(3), +d.w.toFixed(3), +d.h.toFixed(3)]) };
    }, planUrl);
  };
  const inWorkers = await readBoth(page);
  const pageOnly = await newPage(() => { globalThis.MERIT_ORT_WORKERS_DISABLED = "suite: main thread"; });
  const onPage = await readBoth(pageOnly);
  await pageOnly.close();
  checks.require(inWorkers.ocrAvailable && onPage.ocrAvailable && inWorkers.modelAvailable && onPage.modelAvailable, "both pages read the plan with both engines",
    { inWorkers: [inWorkers.ocrAvailable, inWorkers.modelAvailable], onPage: [onPage.ocrAvailable, onPage.modelAvailable] });
  checks.ok(/^workers \(\d\)$/.test(inWorkers.runsIn) && inWorkers.modelRunsIn === "worker", "with workers available, the OCR model and the local detector run in them", { runsIn: inWorkers.runsIn, model: inWorkers.modelRunsIn });
  checks.ok(onPage.runsIn === "page" && onPage.modelRunsIn === "page", "with workers switched off, both run on the page — the fallback is real", { runsIn: onPage.runsIn, model: onPage.modelRunsIn });
  checks.ok(inWorkers.items.length > 0 && JSON.stringify(inWorkers.items) === JSON.stringify(onPage.items),
    "the OCR model reads every line identically in workers and on the page (text, score, box)", { workers: inWorkers.items.length, page: onPage.items.length });
  checks.ok(inWorkers.detections.length > 0 && JSON.stringify(inWorkers.detections) === JSON.stringify(onPage.detections),
    "the local detector finds the same boxes, scores and classes in a worker as on the page", { workers: inWorkers.detections.length, page: onPage.detections.length });

  // ---- 2. table numbers do not depend on read order ------------------------------
  const order = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 900; c.height = 600;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 900, 600); g.fillStyle = "#000"; g.font = "bold 22px sans-serif";
    const tables = [];
    for (let i = 0; i < 24; i++) {
      const x = 40 + (i % 6) * 140, y = 40 + Math.floor(i / 6) * 140;
      g.beginPath(); g.arc(x + 40, y + 40, 38, 0, 2 * Math.PI); g.stroke(); g.fillText(String(101 + i), x + 22, y + 48);
      tables.push({ id: "t" + i, x: x / 9, y: y / 6, w: 80 / 9, h: 80 / 6 });
    }
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = c.toDataURL(); });
    // A scripted engine: its answer is a function of the crop alone, its delay is random.
    const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h >>> 0; };
    const runOCR = async (dataUrl) => {
      await new Promise((r) => setTimeout(r, Math.random() * 12));
      const h = hash(dataUrl), v = String(100 + (h % 30));
      return h % 5 === 0 ? { available: true, text: "", words: [] }
        : { available: true, text: v, words: [{ text: v, confidence: 60 + (h % 40), bbox: { x0: 10, y0: 14, x1: 50, y1: 34 } }] };
    };
    const model = new Map(tables.filter((_, i) => i % 3 === 0).map((t, i) => [t.id, { value: 101 + 3 * i, score: 0.95, lines: 1, yShare: 0.5 }]));
    const strip = (r) => JSON.stringify({ counts: r.counts, byId: [...r.byId.entries()] });
    const one = await MeritTableNumbers.readTableNumbers(runOCR, MeritLabelOCR, img, tables, { modelReadings: model, concurrency: 1 });
    const six = await MeritTableNumbers.readTableNumbers(runOCR, MeritLabelOCR, img, tables, { modelReadings: model, concurrency: 6 });
    return { same: strip(one) === strip(six), counts: one.counts, ids: [...six.byId.keys()].join(",") === tables.map((t) => t.id).join(",") };
  });
  checks.ok(order.same, "printed table numbers read six tables at a time give the same answer for every table as one at a time", order.counts);
  checks.ok(order.ids, "the result lists the tables in the plan's order, whatever order they finished in");

  // ---- 3. a crop is read once ----------------------------------------------------
  const cache = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 220; c.height = 70;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 220, 70); g.fillStyle = "#000"; g.font = "bold 34px sans-serif"; g.fillText("SAHNE", 20, 48);
    const a = c.toDataURL();
    g.fillRect(219, 69, 1, 1);
    const b = c.toDataURL();
    const s0 = MeritPlanOCRCrops.stats();
    const first = await MeritPlanOCRCrops.read(a);
    const s1 = MeritPlanOCRCrops.stats();
    const again = await MeritPlanOCRCrops.read(a);
    const s2 = MeritPlanOCRCrops.stats();
    await MeritPlanOCRCrops.read(b);
    const s3 = MeritPlanOCRCrops.stats();
    return { text: first.text, sameObject: first === again, reads: [s1.reads - s0.reads, s2.reads - s1.reads, s3.reads - s2.reads], hits: [s1.cacheHits - s0.cacheHits, s2.cacheHits - s1.cacheHits], workers: s3.workers };
  });
  checks.ok(/SAHNE/.test(cache.text || ""), "a crop read on the crop workers reads its text", cache.text);
  checks.ok(cache.reads[0] === 1 && cache.reads[1] === 0 && cache.hits[1] === 1 && cache.sameObject,
    "the same crop asked for twice is read once and answered once from memory", cache);
  checks.ok(cache.reads[2] === 1, "a crop that differs by one pixel is read again — the key is the pixels, not the place", cache.reads);

  // ---- 4 + 5. while it runs, and Stop ----------------------------------------------
  const p = await newPage(TRACK_WORKERS);
  await openApp(p, baseUrl, { lang: "en" });
  await createBlankEvent(p, { name: "Stop", date: futureDate() });
  await importPlan(p, planUrl);
  await click(p, '[data-v8-action="detect"]');
  // Stop while an inference is running in a worker: the hardest case to stop.
  await p.waitForFunction(() => ui.analysisBusy && globalThis.MeritOrtPool && MeritOrtPool.status().busy > 0, null, { timeout: 120000, polling: 20 });
  const during = await p.evaluate(() => ({
    header: (document.querySelector(".planintel-top") || {}).textContent || "",
    stop: !!document.querySelector('[data-review-action="cancel-analysis"]:not([disabled])'),
    reanalyse: !!document.querySelector('[data-review-action="reanalyze"]'),
    busyAttr: (document.querySelector(".planintel-screen") || {}).getAttribute?.("aria-busy") || null }));
  checks.ok(during.stop && !during.reanalyse && /Not complete yet/.test(during.header) && during.busyAttr === "true",
    "while the analysis runs the header says it is not complete and offers Stop, not Re-analyse", during);
  const t0 = Date.now();
  await click(p, '[data-review-action="cancel-analysis"]');
  await p.waitForFunction(() => !ui.analysisBusy, null, { timeout: 10000, polling: 20 });
  const freeAfterMs = Date.now() - t0;
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({
    analysis: state.events[0].analysis || null, stage: ui.analysisStage, engines: ui.analysisStoppedEngines,
    alive: (globalThis.__workers || []).filter((w) => w.__alive).length, created: (globalThis.__workers || []).length,
    pool: MeritOrtPool.status(), toast: [...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" | ") }));
  checks.ok(freeAfterMs < 2000, "Stop frees the screen at once", { freeAfterMs });
  checks.ok(after.analysis === null && after.stage === "Analysis stopped" && /previous result is kept/.test(after.toast),
    "a stopped first analysis leaves the plan as it was — no half-built result — and says so", { analysis: !!after.analysis, stage: after.stage, toast: after.toast });
  checks.ok(after.created > 0 && after.alive === 0 && after.engines && after.engines.onnx === true && after.engines.tesseract === true && after.pool.workers === 0,
    "every worker the analysis started is terminated, mid-inference included — the work stops, it is not merely ignored", { created: after.created, alive: after.alive, engines: after.engines, pool: after.pool.state });

  // The next analysis runs to the end, its engines loaded again; and while it
  // runs, the objects already on the map take no clicks. Started from the
  // stopped screen itself: an empty review names its next action.
  await click(p, '.planintel-screen [data-review-action="reanalyze"]');
  const blocked = await p.waitForFunction(() => {
    if (!ui.analysisBusy) return "finished-first";
    const el = document.querySelector(".planintel-screen.analysing .planintel-map-inner > :not(img)");
    return el ? getComputedStyle(el).pointerEvents : false;
  }, null, { timeout: 180000, polling: 25 }).then((h) => h.jsonValue());
  checks.ok(blocked === "none", "while an analysis runs, the objects drawn on the map take no clicks — nothing is decided on a result that is not finished", { pointerEvents: blocked });
  await p.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 240000 });
  const second = await p.evaluate(() => { const a = state.events[0].analysis; return { ocrModel: a.ocrModel && a.ocrModel.available, runsIn: a.ocrModel && a.ocrModel.provider && a.ocrModel.provider.runsIn,
    localModel: a.localModel && a.localModel.available, ocr: a.ocr && a.ocr.available, tables: a.candidates.filter((c) => c.kind === "table").length, stage: ui.analysisStage }; });
  checks.ok(second.ocrModel && second.localModel && second.ocr && /^workers/.test(second.runsIn) && second.tables > 0,
    "after a Stop the next analysis completes with every engine loaded again", second);
  await p.close();
}
