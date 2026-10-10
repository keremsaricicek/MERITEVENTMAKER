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
    if (!globalThis.Tesseract) return Promise.reject(Object.assign(new Error("Tesseract.js did not load (no network, or CDN blocked)."), { ocrCode: "ENGINE_NOT_LOADED" }));
    if (!workerPromise) {
      // scripts/build-offline-full.mjs sets MERIT_OCR_ASSET_PATHS.embedded:
      // the engine ships inside the package (embeddedWorker, above). Without
      // it (normal index.html, or the lightweight single-file build, which
      // carries no OCR) Tesseract.js uses its CDN defaults.
      const paths = globalThis.MERIT_OCR_ASSET_PATHS || null;
      workerPromise = paths && paths.embedded ? embeddedWorker(paths.embedded)
        // Normal index.html: Tesseract.js's own CDN defaults, network on first use.
        : globalThis.Tesseract.createWorker(["eng", "tur"], 1, { errorHandler: () => {} });
      // A failed start must not be cached for the rest of the session.
      workerPromise.catch(() => { workerPromise = null; });
    }
    return workerPromise;
  }

  // THE OFFLINE PACKAGE'S ENGINE, from its own files only.
  // dist/merit-offline/ is opened by double-click (file://). There a page cannot
  // fetch its sibling files and Chrome will not start a worker from a file://
  // script, so the build ships the worker, the core (wasm inlined) and both
  // language files as <script> files that set strings on MERIT_OCR_EMBED.
  // They are loaded on first use and become ONE blob worker: the core first
  // (so the worker never importScripts it), then a fetch shim that answers
  // "merit-ocr/<lang>.traineddata" from the embedded bytes, then the worker.
  // Language data is not passed as {code, data}: tesseract.js 5.1.1's
  // initialize() joins `l.data` instead of `l.code` for such entries.
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(Object.assign(new Error("OCR asset missing: " + src), { ocrCode: "ENGINE_NOT_LOADED" }));
    document.head.appendChild(s);
  });
  async function embeddedWorker(base) {
    for (const part of ["worker", "core", "eng", "tur"]) await loadScript(base + "embed-" + part + ".js");
    const E = globalThis.MERIT_OCR_EMBED || {};
    const shim = "const __L=" + JSON.stringify({ eng: E.eng, tur: E.tur }) + ";" +
      "const __b=(s)=>{const t=atob(s),u=new Uint8Array(t.length);for(let i=0;i<t.length;i++)u[i]=t.charCodeAt(i);return u;};" +
      "const __f=self.fetch&&self.fetch.bind(self);" +
      "self.fetch=(u,o)=>{const m=String(u).match(/merit-ocr\\/(\\w+)\\.traineddata/);" +
      "return m&&__L[m[1]]?Promise.resolve(new Response(__b(__L[m[1]]))):__f(u,o);};\n";
    const url = URL.createObjectURL(new Blob([E.core, "\n", shim, E.worker], { type: "application/javascript" }));
    try {
      return await globalThis.Tesseract.createWorker(["eng", "tur"], 1, {
        errorHandler: () => {}, workerPath: url, corePath: "embedded", langPath: "merit-ocr",
        workerBlobURL: false, cacheMethod: "none", gzip: true,
      });
    } finally {
      // The worker has its own copy; the page keeps neither the URL nor ~30 MB of strings.
      URL.revokeObjectURL(url);
      delete globalThis.MERIT_OCR_EMBED;
    }
  }

  async function runPlanOCR(imageSrc, { timeoutMs = 25000 } = {}) {
    try {
      const worker = await Promise.race([
        getWorker(),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("OCR engine load timed out."), { ocrCode: "TIMEOUT" })), timeoutMs)),
      ]);
      const { data } = await worker.recognize(imageSrc);
      return { available: true, text: data.text || "", words: (data.words || []).map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) };
    } catch (error) {
      // `reason` is the engine's own words, kept for diagnostics (the suites
      // print it). What an operator reads is `reasonCode`, translated -- the
      // raw message is English in a Turkish UI and sometimes internals.
      return { available: false, text: null, reason: error.message || String(error),
        reasonCode: (error && error.ocrCode) || "FAILED" };
    }
  }

  globalThis.runPlanOCR = runPlanOCR;
  globalThis.MERIT_OCR_STATUS = {
    engine: "tesseract.js (MIT license, client-side WASM, no API key)",
    languages: ["eng", "tur"],
    onlineBuild: "index.html — Tesseract.js core/lang data load from its CDN default on first use, then cache in the browser.",
    offlineFullBuild: "dist/merit-offline/ (scripts/build-offline-full.mjs) — worker, core and language data ship embedded in local script files and run as one blob worker, so OCR works with zero network access whether the folder is served or opened by double-click.",
    offlineLightBuild: "dist/index-offline.html (scripts/build-offline.mjs) — single email-able file, no OCR bundled (would add ~20MB of base64 language data to one file); reports itself unavailable there rather than faking a result.",
    // Measured, not asserted. benchmarks/offline/verify-offline-package.mjs
    // serves dist/merit-offline/ and aborts every request that is not
    // same-origin, so a silent CDN fetch cannot pass. Re-run it after touching
    // either build script.
    offlineVerification: {
      harness: "benchmarks/offline/verify-offline-package.mjs",
      result: "OCR available with zero off-origin requests attempted; ~2.1s for a 1000x420 plan crop, headless Chromium.",
      readCorrectly: ["TOTAL 124 PAX", "114 pax seating", "10 pax bistro", "SAHNE (Turkish label)"],
      // Written down because it is exactly the trap someone would fall into
      // later: OCR is reliable on the printed capacity numbers this product
      // reads, and NOT reliable on alphanumeric table labels.
      knownLimitation: "Table labels mixing a letter with digits are misread: T01/T02/T03 came back as TO1/TO02/TO3 (letter O for digit 0) at confidence 57-89, against 95-97 for the capacity text. Do not build table-number recognition on this. OCR stays supporting evidence for capacity and labels; it never defines geometry or object identity by itself.",
    },
  };
})();
