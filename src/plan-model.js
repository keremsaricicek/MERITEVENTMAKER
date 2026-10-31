// MERIT Event Maker — the local plan-symbol detector (MeritPlanModel).
//
// A small convolutional network, trained in this repository (training/), that
// finds round tables, square/rectangular tables, chairs and columns anywhere
// on a plan. It is a SECOND, INDEPENDENT look at the pixels: it does not start
// from the classical detector's candidates, so it can find objects the
// classical pipeline never proposed.
//
// What it is, stated the way the UI must state it:
//   · a trained model of plan SYMBOLS, about 0.9 M parameters;
//   · trained on what PIN.trainedOn says, written by training/package.py from
//     the run's own arguments. v1 saw synthetic plans ONLY — no real plan —
//     so its scores on the two real venues in benchmarks/plans are scores on
//     venues it never saw;
//   · not a model of rooms. It does not know capacity, relationships or
//     numbers. Those stay with the rule layer, which consumes its output.
// Its measured quality, per fold and per venue, is in
// benchmarks/offline-intelligence/ (never a single average).
//
// Runtime: the onnxruntime-web build the OCR model already loads
// (plan-ocr-paddle.js). The analysis reads the plan's text before it detects,
// so the runtime is present whenever OCR is. If it is not (the single-file
// package carries no model of any kind), the model reports UNAVAILABLE with a
// reason and the analysis continues on the classical path alone.
//
// The model's bytes come from a script file beside the page, pinned here by
// size and sha256. A file that does not match is refused, never run.
// Rolling back is pinning the previous version; versions are kept side by side
// under models/plan-detector/.
//
// It writes nothing and reads no shell state.
(function () {
  "use strict";

  const PIN = {
    id: "merit-plan-detector",
    version: "v2",
    file: "models/plan-detector/v2/model.js",
    bytes: 3540361,
    sha256: "a180b42062e9d24a43e6567ff0878a2cb0da5b25bfb6f046b59fa34c186084de",
    classes: ["table_round", "table_rect", "chair", "column"],
    stride: 4,
    longSide: 1536,
    // Per-class score thresholds, written here by training/package.py from the
    // run's thresholds.json. v1 and v2: 0.5 for every class, fixed in advance —
    // calibration on synthetic plans did not transfer to real ones, and tuning
    // on Golden/ORNEK would tune on the venues it is measured on.
    thresholds: { table_round: 0.5, table_rect: 0.5, chair: 0.5, column: 0.5 },
    trainedOn: "synthetic banquet plans (training/synth.py generation 2, styles other than 8,9) only; no real plan; warm-started from v1",
  };

  // A benchmark may load another version through the same code path
  // (benchmarks/offline-intelligence: the cross-venue fold models). It sets
  // MERIT_PLAN_MODEL_PIN_OVERRIDE before the page loads, with that version's
  // own size and sha256; a file that does not match it is refused the same way.
  // The product never sets it.
  const pinNow = () => {
    const x = globalThis.MERIT_PLAN_MODEL_PIN_OVERRIDE;
    return x && typeof x.file === "string" && x.bytes > 0 && typeof x.sha256 === "string" ? Object.assign({}, PIN, x) : PIN;
  };
  let session = null, state = "idle", loading = null, lastError = null, integrity = null, loadMs = null, poolNames = null, poolKey = null;
  // release() starts a new generation: a load still in flight from the old one
  // ends without touching the state the next load builds.
  let generation = 0;
  const fail = (code, message) => Object.assign(new Error(message), { modelCode: code });

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(fail("MODEL_MISSING", "plan detector model file missing: " + src));
    document.head.appendChild(s);
  });
  const b64ToBytes = (s) => { const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  async function sha256Hex(bytes) {
    const d = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function load(opts) {
    const o = opts || {};
    if (state === "ready") return true;
    if (loading) return loading;
    const gen = generation;
    const current = () => { if (gen !== generation) throw fail("MODEL_STOPPED", "the model was released while it loaded"); };
    loading = (async () => {
      try {
        state = "loading";
        const loadStartedAt = performance.now();
        const pin = o.pin || pinNow();
        if (globalThis.MERIT_PLAN_MODEL_DISABLED) throw fail("MODEL_DISABLED", String(globalThis.MERIT_PLAN_MODEL_DISABLED));
        const ort = globalThis.ort;
        if (!ort || !ort.InferenceSession) throw fail("RUNTIME_NOT_LOADED", "the ONNX runtime is not loaded on this page (it comes with the OCR engine)");
        const base = globalThis.MERIT_PLAN_MODEL_BASE || "";
        if (!globalThis.MERIT_PLAN_MODEL_EMBED || globalThis.MERIT_PLAN_MODEL_EMBED.version !== pin.version) await loadScript(base + pin.file);
        const E = globalThis.MERIT_PLAN_MODEL_EMBED;
        if (!E || typeof E.b64 !== "string") throw fail("MODEL_MISSING", "plan detector model file carried no model");
        const bytes = b64ToBytes(E.b64);
        delete globalThis.MERIT_PLAN_MODEL_EMBED;
        if (bytes.byteLength !== pin.bytes) throw fail("MODEL_INTEGRITY", `model size ${bytes.byteLength} is not the pinned ${pin.bytes}`);
        const canHash = !!(globalThis.crypto && crypto.subtle);
        if (canHash && (await sha256Hex(bytes)) !== pin.sha256) throw fail("MODEL_INTEGRITY", "model sha256 is not the pinned one");
        integrity = canHash ? "sha256" : "size-only (no WebCrypto in this context)";
        // In a worker when the OCR engine's pool is running (src/plan-ort-pool.js),
        // so the inference does not hold the page; otherwise on the page.
        const Pool = globalThis.MeritOrtPool;
        poolNames = null;
        if (Pool && Pool.status().state === "ready") {
          try { poolKey = "plan-model:" + pin.version; poolNames = await Pool.load(poolKey, bytes, 1); }
          catch (error) { poolNames = null; lastError = error; }
        }
        current();
        if (!poolNames) session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
        current();
        // Cold load, measured: fetching the file, decoding it, checking its
        // sha256 and building the session. Reported, never assumed.
        loadMs = Math.round(performance.now() - loadStartedAt);
        state = "ready";
        return true;
      } catch (error) {
        if (gen === generation) { state = "failed"; lastError = error; loading = null; session = null; poolNames = null; }
        throw error.modelCode ? error : fail("MODEL_FAILED", error && error.message ? error.message : String(error));
      }
    })();
    return loading;
  }

  // Grey, resized so the long side is `longSide`, both sides a multiple of 16.
  function prepare(pixels, width, height, longSide) {
    const f = longSide / Math.max(width, height);
    const W = Math.max(16, Math.round(width * f / 16) * 16), H = Math.max(16, Math.round(height * f / 16) * 16);
    const src = document.createElement("canvas"); src.width = width; src.height = height;
    src.getContext("2d").putImageData(pixels, 0, 0);
    const dst = document.createElement("canvas"); dst.width = W; dst.height = H;
    const g = dst.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data, t = new Float32Array(W * H);
    for (let i = 0, j = 0; i < t.length; i++, j += 4) t[i] = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) / 255;
    src.width = src.height = dst.width = dst.height = 0;
    return { tensor: t, W, H, sx: width / W, sy: height / H };
  }

  // Peaks of the heatmap (3×3 local maxima over the threshold) -> boxes.
  function decode(heat, size, off, K, h, w, stride, thr) {
    const out = [], plane = h * w;
    for (let k = 0; k < K; k++) {
      const base = k * plane;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = heat[base + y * w + x];
        if (v < thr) continue;
        let peak = true;
        for (let dy = -1; dy <= 1 && peak; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          if (heat[base + yy * w + xx] > v) { peak = false; break; }
        }
        if (!peak) continue;
        const i = y * w + x;
        out.push({ k, score: v, cx: (x + off[i]) * stride, cy: (y + off[plane + i]) * stride,
          w: Math.exp(size[i]) * stride, h: Math.exp(size[plane + i]) * stride });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 4000);
  }

  // A 3×3 peak pick leaves two peaks on one broad table. A detection whose
  // centre lies within half the short side of a STRONGER detection of the same
  // group (round and rectangular tables are one group) is dropped: two real
  // tables cannot stand that close without overlapping. Measured on generated
  // val + held-out L4–L7 (training/diagnose_fp.py): 43 of v2's 80 false tables
  // and 132 of a later candidate's 148 were such second peaks. The same rule,
  // line for line, is training/detector.py's `suppress_close` (E3). Applied to
  // the detections that passed their class threshold.
  //
  // Seating furniture is LONG (E3b, training/README.md E9): half a bench's short
  // side is ~10 px, so two peaks 30 px apart along one bench both survived and
  // the second was counted as a false bench. Measured on 120 training scenes
  // of the furniture split: 280 of 413 "false" bench peaks stood inside a true
  // bench. Within the seating group and its table conflict, a weaker centre
  // INSIDE the stronger box is the same piece. Tables, chairs and columns keep
  // E3, so a four-class model decodes exactly as before.
  const GROUP_OF = [0, 0, 2, 3, 4, 4, 4]; // a sofa, a bench and a banquette on one spot are one piece (E4)
  const SEATING_GROUP = 4;
  function suppressClose(dets) {
    const kept = [];
    for (const d of dets) {
      const g = GROUP_OF[d.k] ?? d.k;
      // a table and a seating-furniture box on one spot are one object (E5)
      if (kept.some(k => { const h = GROUP_OF[k.k] ?? k.k; return (h === g || (h === 0 && g === 4) || (h === 4 && g === 0))
        && (Math.hypot(d.cx - k.cx, d.cy - k.cy) < 0.5 * Math.min(k.w, k.h)
          || ((h === SEATING_GROUP || g === SEATING_GROUP) && Math.abs(d.cx - k.cx) <= k.w / 2 && Math.abs(d.cy - k.cy) <= k.h / 2)); })) continue;
      kept.push(d);
    }
    return kept;
  }

  // Detect on an ImageData. Returns boxes in the ImageData's own pixels:
  // { available, detections:[{cls, score, cx, cy, w, h}], ms, model }.
  async function detect(pixels, width, height, opts) {
    const o = opts || {};
    try {
      await load(o);
      const pin = o.pin || pinNow(), t0 = performance.now();
      const p = prepare(pixels, width, height, o.longSide || pin.longSide);
      const ort = globalThis.ort;
      let heat, size, off;
      if (poolNames) {
        const r = (await globalThis.MeritOrtPool.run(poolKey, { [poolNames.inputNames[0]]: { type: "float32", data: p.tensor, dims: [1, 1, p.H, p.W] } })).outputs;
        heat = r[poolNames.outputNames[0]]; size = r[poolNames.outputNames[1]]; off = r[poolNames.outputNames[2]];
      } else {
        const r = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", p.tensor, [1, 1, p.H, p.W]) });
        heat = r[session.outputNames[0]]; size = r[session.outputNames[1]]; off = r[session.outputNames[2]];
      }
      const [, K, h, w] = heat.dims;
      const thr = pin.thresholds || {}, floor = o.threshold ?? Math.min(...pin.classes.map(c => thr[c] ?? 0.5));
      const raw = decode(heat.data, size.data, off.data, K, h, w, pin.stride, floor);
      const detections = suppressClose(raw.filter(d => o.threshold != null || d.score >= (thr[pin.classes[d.k]] ?? 0.5)))
        .map(d => ({ cls: pin.classes[d.k], score: +d.score.toFixed(3), cx: d.cx * p.sx, cy: d.cy * p.sy, w: d.w * p.sx, h: d.h * p.sy }));
      return { available: true, detections, ms: Math.round(performance.now() - t0), input: { width: p.W, height: p.H }, model: describe() };
    } catch (error) {
      return { available: false, reasonCode: (error && error.modelCode) || "MODEL_FAILED", reason: error && error.message ? error.message : String(error), detections: [], model: describe() };
    }
  }

  function describe() {
    return { id: PIN.id, version: pinNow().version, trainedModel: true, domain: "plan symbols: tables, chairs, columns — not rooms, not numbers",
      trainedOn: pinNow().trainedOn, integrity, state, loadMs, runsIn: poolNames ? "worker" : session ? "page" : null };
  }

  async function release() {
    try { if (session) await session.release(); } catch (error) { lastError = error; }
    session = null; poolNames = null; state = "idle"; loading = null; generation++;
  }

  globalThis.MeritPlanModel = Object.freeze({ PIN, load, detect, decode, suppressClose, describe, release, status: () => state, lastError: () => lastError });
})();
