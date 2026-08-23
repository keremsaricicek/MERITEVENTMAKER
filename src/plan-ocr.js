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
      // scripts/build-offline-full.mjs sets MERIT_OCR_ASSET_PATHS to local
      // relative paths (worker/core/lang files shipped alongside the HTML)
      // so this runs with zero network access. Without it (normal index.html,
      // or the lightweight single-file build), Tesseract.js falls back to
      // its own CDN defaults, which need network on first use.
      const localPaths = globalThis.MERIT_OCR_ASSET_PATHS || {};
      const isLocal = !!globalThis.MERIT_OCR_ASSET_PATHS;
      workerPromise = globalThis.Tesseract.createWorker(["eng", "tur"], 1, {
        errorHandler: () => {},
        ...localPaths,
        // Tesseract.js defaults to spawning the worker from a same-origin
        // `blob:` URL (importScripts trick) so it can load a cross-origin
        // CDN worker script. That blob: URL has no resolvable directory, so
        // the Emscripten core glue can't derive a base path for the .wasm
        // file from it and fetches a bare filename instead — a real,
        // reproducible bug in this exact local-asset setup, not a network
        // issue. For the local/offline build all asset URLs are same-origin,
        // so spawning the worker directly (no blob indirection) gives it a
        // real, resolvable self.location and fixes the .wasm path lookup.
        ...(isLocal ? { workerBlobURL: false } : {}),
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
    onlineBuild: "index.html — Tesseract.js core/lang data load from its CDN default on first use, then cache in the browser.",
    offlineFullBuild: "dist/merit-offline/ (scripts/build-offline-full.mjs) — worker/core/lang files are shipped as local sibling files; MERIT_OCR_ASSET_PATHS points Tesseract.js at them, so OCR works with zero network access. Verified with Playwright network blocking during development.",
    offlineLightBuild: "dist/index-offline.html (scripts/build-offline.mjs) — single email-able file, no OCR bundled (would add ~20MB of base64 language data to one file); reports itself unavailable there rather than faking a result.",
  };
})();
