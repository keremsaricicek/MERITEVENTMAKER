// The OCR model provider (src/plan-ocr-paddle.js): PP-OCRv4 on ONNX Runtime Web.
//
// What this pins:
//   THE PARTS ARE RIGHT on inputs small enough to check by hand: the
//     detector's input size, DB post-processing of a probability map, greedy
//     CTC decoding, and reading a number out of the text inside a box — two
//     lines top first, never anything that is not 1-3 digits.
//   IT RUNS FOR REAL on the Golden Plan from the pinned files (served from the
//     test cache, never the network) and reads its printed text, including the
//     capacity line Tesseract does not: "Total : 124 pax".
//   THE MODEL IS THE PINNED MODEL: bytes that are not the pinned sha256 are
//     refused (MODEL_INTEGRITY) and nothing is read — never "close enough".
//   UNAVAILABLE IS SAID, NOT HIDDEN: with the engine blocked, an analysis
//     records the model as unavailable with its reason, Tesseract carries on,
//     and no text is invented.
//   IT IS NOT A MODEL OF PLANS: the provider describes itself as text-only,
//     and the analysis still reports the detector as untrained.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "plan-ocr-model", tags: ["intelligence"], timeout: 300000, viewport: { width: 1400, height: 900 } };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  await openApp(page, baseUrl, { lang: "en" });
  checks.require(await page.evaluate(() => typeof globalThis.MeritPaddleOCR === "object"), "MeritPaddleOCR is published");

  // ---- the parts -----------------------------------------------------------
  const parts = await page.evaluate(() => {
    const M = globalThis.MeritPaddleOCR;
    const out = {};
    out.size = M.detSize(1355, 788, 2000, 736);
    out.big = M.detSize(2402, 1719, 2000, 736);
    // A 20x10 probability map with one 6x3 blob of text.
    const w = 20, h = 10, prob = new Float32Array(w * h);
    for (let y = 3; y < 6; y++) for (let x = 5; x < 11; x++) prob[y * w + x] = 0.9;
    out.boxes = M.dbPost(prob, w, h, 200, 100, { thresh: 0.3, boxThresh: 0.5, unclipRatio: 1.6, minSize: 2 });
    // CTC: keys ["1","2"]; steps argmax 1,1,0,2,2 -> "12".
    const K = 4, T = 5, data = new Float32Array(T * K);
    [1, 1, 0, 2, 2].forEach((k, t) => { data[t * K + k] = 1; });
    out.ctc = M.ctcGreedy(data, [1, T, K], 0, ["1", "2"]);
    const it = (text, x0, y0, x1, y1, score = 0.99) => ({ text, score, box: { x0, y0, x1, y1 } });
    const symbol = { cx: 100, cy: 100, w: 70, h: 70 };
    out.twoLine = M.numberInBox([it("4", 92, 105, 108, 125), it("10", 85, 75, 115, 95)], symbol);
    out.oneLine = M.numberInBox([it("37", 85, 90, 115, 110)], symbol);
    out.notNumber = M.numberInBox([it("SAHNE", 70, 90, 130, 110)], symbol);
    out.outside = M.numberInBox([it("12", 300, 300, 320, 320)], symbol);
    out.pins = M.PINS;
    return out;
  });
  // PaddleOCR's DetResizeForTest: round(side / 32) * 32 — 1355 -> 1344, 788 -> 800.
  checks.equal(JSON.stringify(parts.size), JSON.stringify([1344, 800]), "the detector input is the plan rounded to multiples of 32, as PaddleOCR does (short side at least 736)");
  checks.ok(parts.big[0] <= 2016 && parts.big[0] % 32 === 0 && parts.big[1] % 32 === 0, "a large plan is capped near 2000 px, still multiples of 32", parts.big);
  checks.equal(parts.boxes.length, 1, "DB post-processing finds the one text blob");
  checks.ok(parts.boxes[0] && parts.boxes[0].x0 < 50 && parts.boxes[0].x1 > 100, "and returns it in SOURCE pixels, grown by the unclip ratio", parts.boxes[0]);
  checks.equal(parts.ctc.text, "12", "greedy CTC collapses repeats and drops blanks");
  checks.ok(parts.twoLine && parts.twoLine.value === 104 && parts.twoLine.lines === 2 && JSON.stringify(parts.twoLine.lineTexts) === '["10","4"]', "two lines inside a symbol read top line first: 104", parts.twoLine);
  checks.ok(parts.oneLine.value === 37 && Math.abs(parts.oneLine.yShare - 0.5) < 0.01, "one line in the middle of the symbol, with where it sits", parts.oneLine);
  checks.ok(parts.notNumber.value === null && parts.notNumber.text === "SAHNE", "text that is not 1-3 digits is reported as text, never trimmed into a number", parts.notNumber);
  checks.equal(parts.outside, null, "text outside the box is not the box's");
  checks.ok(parts.pins.models.license === "Apache-2.0" && parts.pins.runtime.license === "MIT" && /^[0-9a-f]{64}$/.test(parts.pins.models.det.sha256) && /^[0-9a-f]{64}$/.test(parts.pins.models.rec.sha256),
    "the provider names its pinned runtime and models, their licences and sha256");

  // ---- for real, on the Golden Plan ---------------------------------------------
  const plan = "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64");
  const real = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    return await globalThis.MeritPaddleOCR.readPlanText(img, { timeoutMs: 120000 });
  }, plan);
  checks.ok(real.available, "the model runs from the pinned files", real.reason);
  const texts = (real.items || []).map(i => i.text.replace(/\s+/g, " ").trim().toLowerCase());
  checks.ok(texts.some(t => /total\s*:?\s*124\s*pax/.test(t)), "it reads the printed capacity line Tesseract misses: Total : 124 pax", texts);
  checks.ok(texts.includes("bar") && texts.includes("sahne") && texts.filter(t => t === "giris").length === 2, "and the plan's labels: BAR, SAHNE, both GIRIS", texts);
  checks.ok((real.items || []).every(i => i.score > 0 && i.score <= 1 && i.box.x1 > i.box.x0), "every line carries the model's own score and a box");
  checks.ok(real.provider && real.provider.trainedModel === true && /text only/.test(real.provider.domain), "the provider says it is a trained TEXT model, not a model of plans", real.provider);
  checks.equal(real.provider && real.provider.integrity, "sha256", "and says which integrity check its models passed (sha256 here; size-only where WebCrypto is absent)");

  // ---- integrity: the pinned bytes or nothing ---------------------------------
  const tampered = await page.evaluate(async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, o) => {
      const r = await realFetch(u, o);
      if (!/ch_PP-OCRv4_det_infer\.onnx/.test(String(u))) return r;
      const b = new Uint8Array(await r.arrayBuffer()); b[b.length - 1] ^= 0xff;
      return new Response(b);
    };
    try {
      const E = new globalThis.MeritPaddleOCR.PaddleOCREngine();
      try { await E.load(); return { loaded: true }; } catch (e) { return { loaded: false, code: e.ocrCode, state: E.state }; }
    } finally { globalThis.fetch = realFetch; }
  });
  checks.ok(!tampered.loaded && tampered.code === "MODEL_INTEGRITY" && tampered.state === "failed", "a model whose bytes are not the pinned sha256 is refused, not run", tampered);

  // ---- a package that carries no model says so and asks nobody for one -------------
  const notBundled = await page.evaluate(async () => {
    const before = performance.getEntriesByType("resource").length;
    globalThis.MERIT_PPOCR_ASSET_PATHS = { none: "test: no model in this package" };
    try {
      const E = new globalThis.MeritPaddleOCR.PaddleOCREngine();
      try { await E.load(); return { loaded: true }; } catch (e) { return { loaded: false, code: e.ocrCode, requests: performance.getEntriesByType("resource").length - before }; }
    } finally { delete globalThis.MERIT_PPOCR_ASSET_PATHS; }
  });
  checks.ok(!notBundled.loaded && notBundled.code === "ENGINE_NOT_BUNDLED" && notBundled.requests === 0, "a package that carries no model reports ENGINE_NOT_BUNDLED without making a request", notBundled);

  // ---- unavailable is said, and Tesseract carries on -------------------------------
  await page.route(/onnxruntime-web|paddle-ocr-onnx-models/, r => r.abort());
  await page.reload();
  await page.waitForFunction(() => typeof globalThis.MeritPaddleOCR === "object");
  await createBlankEvent(page, { name: "No model", date: futureDate() });
  await importPlan(page, plan);
  await runDetection(page);
  const blocked = await page.evaluate(() => {
    const a = state.events[0].analysis;
    return { model: a.ocrModel, tesseract: a.ocr && a.ocr.available, pm: a.planIntelligence.providerMetadata, tables: a.candidates.filter(c => c.kind === "table").length };
  });
  checks.ok(blocked.model && blocked.model.available === false && blocked.model.reasonCode === "ENGINE_NOT_LOADED", "with the engine blocked, the analysis records the model as unavailable, with its reason", blocked.model);
  checks.ok(blocked.tesseract && blocked.tables > 40, "Tesseract and detection carry on without it", blocked);
  checks.ok(blocked.pm.ocrModel === null && blocked.pm.ocrModelReason === "ENGINE_NOT_LOADED" && blocked.pm.trainedModel === false, "the provider line says no model read text, and why; the detector is still untrained", blocked.pm);
  await page.unroute(/onnxruntime-web|paddle-ocr-onnx-models/);
}
