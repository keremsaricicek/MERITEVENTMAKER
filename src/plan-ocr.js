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
      // the engine ships inside the package (embeddedWorker, below). Without
      // it (normal index.html, or the lightweight single-file build, which
      // carries no OCR) Tesseract.js uses its CDN defaults, network on first use.
      workerPromise = newWorker();
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
  // The blob is built once and kept only until the crop workers (below) have
  // been made from it; then the page keeps neither the URL nor the strings.
  let embeddedUrl = null;
  async function embeddedSource(base) {
    if (embeddedUrl) return embeddedUrl;
    for (const part of ["worker", "core", "eng", "tur"]) await loadScript(base + "embed-" + part + ".js");
    const E = globalThis.MERIT_OCR_EMBED || {};
    const shim = "const __L=" + JSON.stringify({ eng: E.eng, tur: E.tur }) + ";" +
      "const __b=(s)=>{const t=atob(s),u=new Uint8Array(t.length);for(let i=0;i<t.length;i++)u[i]=t.charCodeAt(i);return u;};" +
      "const __f=self.fetch&&self.fetch.bind(self);" +
      "self.fetch=(u,o)=>{const m=String(u).match(/merit-ocr\\/(\\w+)\\.traineddata/);" +
      "return m&&__L[m[1]]?Promise.resolve(new Response(__b(__L[m[1]]))):__f(u,o);};\n";
    embeddedUrl = URL.createObjectURL(new Blob([E.core, "\n", shim, E.worker], { type: "application/javascript" }));
    delete globalThis.MERIT_OCR_EMBED;
    return embeddedUrl;
  }
  function releaseEmbeddedSource() {
    if (embeddedUrl) URL.revokeObjectURL(embeddedUrl);
    embeddedUrl = null;
  }
  async function embeddedWorker(base) {
    const url = await embeddedSource(base);
    return globalThis.Tesseract.createWorker(["eng", "tur"], 1, {
      errorHandler: () => {}, workerPath: url, corePath: "embedded", langPath: "merit-ocr",
      workerBlobURL: false, cacheMethod: "none", gzip: true,
    });
  }
  function newWorker() {
    const paths = globalThis.MERIT_OCR_ASSET_PATHS || null;
    return paths && paths.embedded ? embeddedWorker(paths.embedded)
      : globalThis.Tesseract.createWorker(["eng", "tur"], 1, { errorHandler: () => {} });
  }

  // Stopping OCR (an analysis the operator cancelled) terminates the workers —
  // a recognition in progress cannot be interrupted any other way — and every
  // read still waiting is answered at once with CANCELLED. The next read starts
  // the engine again.
  const gate = () => { let reject; const p = new Promise((_, r) => { reject = r; }); return { p, reject }; };
  let stopGate = gate();
  // EXPECTED ABSTENTION: the gate's own rejection is read by each Promise.race below.
  stopGate.p.catch(() => {});
  const untilStopped = (p) => Promise.race([p, stopGate.p]);
  // A read that began before a stop must not start a job on a worker the stop
  // has just terminated (tesseract.js posts to it and throws, unhandled).
  const cancelled = () => Object.assign(new Error("OCR stopped"), { ocrCode: "CANCELLED" });
  async function terminate() {
    const workers = [];
    if (workerPromise) workers.push(workerPromise);
    if (cropPool) workers.push(cropPool.then((list) => list.map((s) => s.w)));
    workerPromise = null; cropPool = null;
    const g = stopGate; stopGate = gate();
    // EXPECTED ABSTENTION: the gate's own rejection is read by each Promise.race above.
    stopGate.p.catch(() => {});
    g.reject(Object.assign(new Error("OCR stopped"), { ocrCode: "CANCELLED" }));
    const settled = await Promise.allSettled(workers);
    const all = new Set(settled.flatMap((r) => (r.status === "fulfilled" ? [].concat(r.value) : [])));
    await Promise.allSettled([...all].map((w) => w.terminate()));
    return all.size;
  }

  async function runPlanOCR(imageSrc, { timeoutMs = 25000 } = {}) {
    const began = stopGate;
    try {
      const worker = await Promise.race([
        getWorker(),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("OCR engine load timed out."), { ocrCode: "TIMEOUT" })), timeoutMs)),
      ]);
      if (began !== stopGate) throw cancelled();
      const { data } = await untilStopped(worker.recognize(imageSrc));
      return { available: true, text: data.text || "", words: (data.words || []).map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) };
    } catch (error) {
      // `reason` is the engine's own words, kept for diagnostics (the suites
      // print it). What an operator reads is `reasonCode`, translated -- the
      // raw message is English in a Turkish UI and sometimes internals.
      return { available: false, text: null, reason: error.message || String(error),
        reasonCode: (error && error.ocrCode) || "FAILED" };
    }
  }

  // ---- crops: several workers, and no crop read twice -----------------------
  //
  // Labels and printed table numbers are read one small crop at a time — on
  // ORNEK about 400 crops, 13 s through the one worker above while three of
  // four cores sat idle (benchmarks/perf/analysis-profile.mjs). The same engine
  // in a few more workers reads them side by side. Tesseract's LSTM engine
  // (OEM 1, the mode created here) keeps no state between recognitions, so a
  // crop reads the same whichever worker takes it — the suites and the
  // benchmark compare the readings, not only the time.
  //
  // A crop already read in this session is not read again: the key is the
  // crop's own encoded pixels, so a crop that changed by one pixel is a new
  // crop. Re-analysing a plan after a correction re-reads only what changed.
  // Only successful readings are kept; a failure is always retried.
  const cropCache = new Map();
  const CROP_CACHE_MAX = 4000;
  function hashString(s) {
    // cyrb53: two 32-bit lanes, plus the length in the key.
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36) + ":" + s.length;
  }
  function cropWorkerCount() {
    const forced = Number(globalThis.MERIT_OCR_CROP_WORKERS);
    if (forced >= 1) return Math.min(4, Math.floor(forced));
    const n = (globalThis.navigator && navigator.hardwareConcurrency) || 2;
    return Math.max(1, Math.min(3, n - 1));
  }
  let cropPool = null;
  const cropStats = { reads: 0, cacheHits: 0, workers: 0, failedWorkers: 0 };
  function getCropWorkers() {
    if (!cropPool) {
      cropPool = (async () => {
        const first = await getWorker();
        const extra = await Promise.allSettled(Array.from({ length: cropWorkerCount() - 1 }, () => newWorker()));
        releaseEmbeddedSource();
        const list = [first, ...extra.filter((r) => r.status === "fulfilled").map((r) => r.value)].map((w) => ({ w, busy: 0 }));
        cropStats.workers = list.length;
        cropStats.failedWorkers = extra.filter((r) => r.status === "rejected").length;
        return list;
      })();
      cropPool.catch(() => { cropPool = null; });
    }
    return cropPool;
  }
  async function readCrop(imageSrc, { timeoutMs = 25000 } = {}) {
    const key = typeof imageSrc === "string" ? hashString(imageSrc) : null;
    if (key && cropCache.has(key)) { cropStats.cacheHits++; return cropCache.get(key); }
    const began = stopGate;
    try {
      const list = await Promise.race([
        getCropWorkers(),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("OCR engine load timed out."), { ocrCode: "TIMEOUT" })), timeoutMs)),
      ]);
      if (began !== stopGate) throw cancelled();
      const slot = list.reduce((a, b) => (b.busy < a.busy ? b : a));
      slot.busy++;
      let data;
      try { ({ data } = await untilStopped(slot.w.recognize(imageSrc))); } finally { slot.busy--; }
      cropStats.reads++;
      const out = { available: true, text: data.text || "", words: (data.words || []).map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })) };
      if (key) {
        cropCache.set(key, out);
        if (cropCache.size > CROP_CACHE_MAX) cropCache.delete(cropCache.keys().next().value);
      }
      return out;
    } catch (error) {
      return { available: false, text: null, reason: error.message || String(error), reasonCode: (error && error.ocrCode) || "FAILED" };
    }
  }

  globalThis.runPlanOCR = runPlanOCR;
  globalThis.MeritPlanOCRCrops = Object.freeze({
    read: readCrop,
    // Start the crop workers before the first crop is asked for, so their
    // start-up overlaps work that does not need them. EXPECTED ABSTENTION: a
    // start that fails is retried, and reported, by the first read().
    prewarm: () => { if (globalThis.Tesseract) getCropWorkers().catch(() => {}); },
    workers: cropWorkerCount,
    terminate,
    stats: () => ({ ...cropStats, cached: cropCache.size }),
    hashString,
  });
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
