(() => {
  "use strict";
  // Real OCR provider (Tesseract.js — MIT licensed, runs fully client-side,
  // no API key, no backend). Reads plan text such as "114 pax seating /
  // TOTAL 124 PAX" or "GİRİŞ" / "SAHNE" so the capacity auditor and object
  // labels in plan-intelligence.js have real text to reason about instead of
  // nothing. Per the project's AI-truthfulness rule, a failure here must
  // report unavailability honestly — it must never return placeholder text.
  //
  // Requires network access on first use (to fetch the Tesseract WASM core
  // and eng+tur language data, cached by the browser afterward). This is why
  // it is NOT wired into the fully offline single-file build
  // (scripts/build-offline.mjs) — that build's entire purpose is zero
  // network at runtime, which real OCR language models cannot honor without
  // embedding tens of megabytes of trained data. runPlanOCR() below detects
  // that Tesseract did not load and reports unavailable rather than failing
  // silently or fabricating text.

  let workerPromise = null;
  function getWorker() {
    if (!globalThis.Tesseract) return Promise.reject(new Error("Tesseract.js did not load (no network, or CDN blocked)."));
    if (!workerPromise) {
      workerPromise = globalThis.Tesseract.createWorker(["eng", "tur"], 1, {
        errorHandler: () => {},
      });
    }
    return workerPromise;
  }

  async function runPlanOCR(imageSrc, { timeoutMs = 25000 } = {}) {
    try {
      const worker = await Promise.race([
        getWorker(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("OCR engine load timed out.")), timeoutMs)),
      ]);
      const { data } = await worker.recognize(imageSrc);
      return { available: true, text: data.text || "", words: (data.words || []).map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) };
    } catch (error) {
      return { available: false, text: null, reason: error.message || String(error) };
    }
  }

  globalThis.runPlanOCR = runPlanOCR;
  globalThis.MERIT_OCR_STATUS = {
    engine: "tesseract.js (MIT license, client-side WASM, no API key)",
    languages: ["eng", "tur"],
    requiresNetwork: "First use only (WASM core + language data); cached by the browser afterward.",
    notAvailableIn: "The fully offline single-file build (scripts/build-offline.mjs) — that build guarantees zero network at runtime, which real trained language data cannot honor without embedding tens of MB. OCR there reports itself unavailable rather than faking a result.",
  };
})();
