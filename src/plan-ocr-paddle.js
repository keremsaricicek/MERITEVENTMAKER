// MERIT Event Maker — the OCR model provider (MeritPaddleOCR).
//
// A trained text detector and recognizer — PaddleOCR's PP-OCRv4 (Apache-2.0),
// run in the browser by ONNX Runtime Web (MIT) — beside the Tesseract.js path
// (plan-ocr.js), never instead of it. What it is for, measured before it was
// wired in (scratchpad feasibility run, 2026-10-04): on ORNEK it read 148 of
// the 157 legible table numbers right and 1 wrong when its text was matched to
// the tables, where Tesseract's per-table crops verify 87 — and a number drawn
// on two lines comes back as two text boxes the reader joins top line first.
//
// What it is NOT: a model of plans. It detects and reads TEXT. It says nothing
// about tables, chairs or rooms, and nothing here is described otherwise.
//
// Honesty rules this file keeps:
//   - the models are the pinned files, checked by sha256 before a session is
//     created; a mismatch refuses to run (MODEL_INTEGRITY) — never "close
//     enough";
//   - when the runtime or a model cannot be loaded, the result is
//     { available: false, reasonCode } and the product says so; no text is
//     ever made up, and the Tesseract path carries on alone;
//   - which provider read what is recorded with the result (id, version,
//     models), so a reading can always be traced to the engine that made it.
//
// Lifecycle (a class, because it holds real state: two sessions and a
// runtime): load() once, read() any number of times, release() frees the
// sessions. read() honours an AbortSignal and a time budget.
(function () {
  "use strict";

  const PINS = Object.freeze({
    id: "ppocr-v4-ort-web",
    label: "PP-OCRv4 (ONNX Runtime Web)",
    runtime: { package: "onnxruntime-web", version: "1.30.0", license: "MIT", script: "ort.wasm.min.js" },
    models: {
      package: "paddle-ocr-onnx-models", version: "0.2.0", license: "Apache-2.0",
      det: { file: "models/ch_PP-OCRv4_det_infer.onnx", sha256: "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9", bytes: 4745517 },
      rec: { file: "models/ch_PP-OCRv4_rec_infer.onnx", sha256: "48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b", bytes: 10857958 },
    },
    keysScript: "src/plan-ocr-paddle-keys.js",
  });
  const CDN = "https://cdn.jsdelivr.net/npm/";
  const runtimeBase = () => `${CDN}${PINS.runtime.package}@${PINS.runtime.version}/dist/`;
  const modelUrl = (m) => `${CDN}${PINS.models.package}@${PINS.models.version}/${m.file}`;

  // ---- pure parts (exported for the suite) -----------------------------------

  // PaddleOCR's detector input size: long side capped, short side lifted, both
  // multiples of 32 (round-half-even, as the reference implementation does).
  function pyRound(x) { const f = Math.floor(x), d = x - f; if (d > 0.5) return f + 1; if (d < 0.5) return f; return f % 2 === 0 ? f : f + 1; }
  function detSize(W, H, maxSide, limitMin) {
    let w = W, h = H;
    if (Math.max(w, h) > maxSide) { const r = maxSide / Math.max(w, h); h = Math.trunc(h * r); w = Math.trunc(w * r); h = pyRound(h / 32) * 32; w = pyRound(w / 32) * 32; }
    if (Math.min(w, h) < limitMin) { const r = limitMin / Math.min(w, h); h = Math.trunc(h * r); w = Math.trunc(w * r); }
    return [Math.max(32, pyRound(w / 32) * 32), Math.max(32, pyRound(h / 32) * 32)];
  }

  // DB post-processing, simplified: threshold, 2x2 dilation, 8-connected
  // components, an upright box per component scored by its mean probability,
  // grown by area*ratio/perimeter. Boxes come back in SOURCE pixels.
  function dbPost(prob, w, h, W, H, p) {
    const n = w * h, bin = new Uint8Array(n), dil = new Uint8Array(n);
    for (let i = 0; i < n; i++) bin[i] = prob[i] > p.thresh ? 1 : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      dil[i] = bin[i] | (x > 0 ? bin[i - 1] : 0) | (y > 0 ? bin[i - w] : 0) | (x > 0 && y > 0 ? bin[i - w - 1] : 0);
    }
    const seen = new Uint8Array(n), stack = new Int32Array(n), boxes = [];
    for (let s = 0; s < n; s++) {
      if (!dil[s] || seen[s]) continue;
      let sp = 0; stack[sp++] = s; seen[s] = 1;
      let minx = w, miny = h, maxx = -1, maxy = -1;
      while (sp) {
        const i = stack[--sp], x = i % w, y = (i / w) | 0;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx; if (dil[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
        }
      }
      const bw = maxx - minx, bh = maxy - miny;
      if (Math.min(bw, bh) < p.minSize) continue;
      let sum = 0; for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) sum += prob[y * w + x];
      const score = sum / ((bw + 1) * (bh + 1));
      if (score < p.boxThresh) continue;
      const dist = (bw * bh * p.unclipRatio) / (2 * (bw + bh));
      const ex0 = minx - dist, ey0 = miny - dist, ex1 = maxx + dist, ey1 = maxy + dist;
      if (Math.min(ex1 - ex0, ey1 - ey0) < p.minSize + 2) continue;
      const sx = W / w, sy = H / h, cl = (v, m) => Math.max(0, Math.min(m, Math.round(v)));
      boxes.push({ x0: cl(ex0 * sx, W), y0: cl(ey0 * sy, H), x1: cl(ex1 * sx, W), y1: cl(ey1 * sy, H), detScore: +score.toFixed(4) });
    }
    boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    return boxes;
  }

  // Greedy CTC: argmax per step, collapse repeats, drop blanks. The score is
  // the mean of the chosen characters' probabilities — the model's own number.
  function ctcGreedy(data, dims, b, keys) {
    const T = dims[1], K = dims[2], base = b * T * K;
    let prev = -1, text = "", sum = 0, n = 0;
    for (let t = 0; t < T; t++) {
      let bi = 0, bv = -Infinity; const o = base + t * K;
      for (let k = 0; k < K; k++) { const v = data[o + k]; if (v > bv) { bv = v; bi = k; } }
      if (bi !== 0 && bi !== prev) { text += bi - 1 < keys.length ? keys[bi - 1] : " "; sum += bv; n++; }
      prev = bi;
    }
    return { text, score: n ? sum / n : 0 };
  }

  // The number printed inside a box (a table's own symbol), from the items the
  // plan-wide read produced: every item whose centre lies in the box (grown by
  // `grow`), in reading order — lines top to bottom, left to right within a
  // line — joined. A number drawn on two lines ("10" over "4") is two items and
  // reads 104. Anything that is not 1-3 digits once spaces are removed is not a
  // table number, and is reported as such rather than trimmed into one.
  function numberInBox(items, box, grow) {
    const g = grow == null ? 0.15 : grow;
    const cx = box.cx, cy = box.cy, hw = box.w * (1 + g) / 2, hh = box.h * (1 + g) / 2;
    const mine = (items || []).filter(it => {
      const x = (it.box.x0 + it.box.x1) / 2, y = (it.box.y0 + it.box.y1) / 2;
      return Math.abs(x - cx) <= hw && Math.abs(y - cy) <= hh;
    });
    if (!mine.length) return null;
    const lineH = Math.max(4, Math.min(...mine.map(it => it.box.y1 - it.box.y0)) * 0.6);
    mine.sort((a, b) => Math.abs(a.box.y0 - b.box.y0) <= lineH ? a.box.x0 - b.box.x0 : a.box.y0 - b.box.y0);
    const text = mine.map(it => it.text).join("").replace(/\s+/g, "");
    const lines = new Set(mine.map(it => Math.round(it.box.y0 / lineH))).size;
    const score = Math.min(...mine.map(it => it.score));
    // Where the text block sits in the box, 0 top .. 1 bottom: a single short
    // line high in a symbol is often the top line of two, the second unread.
    const y0 = Math.min(...mine.map(it => it.box.y0)), y1 = Math.max(...mine.map(it => it.box.y1));
    const yShare = box.h > 0 ? ((y0 + y1) / 2 - (cy - box.h / 2)) / box.h : null;
    const byLine = new Map();
    for (const it of mine) { const k = Math.round(it.box.y0 / lineH); byLine.set(k, (byLine.get(k) || "") + it.text.replace(/\s+/g, "")); }
    const lineTexts = [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
    const out = { text, score, lines, lineTexts, items: mine.length, yShare: yShare == null ? null : +yShare.toFixed(3) };
    if (!/^[0-9]{1,3}$/.test(text)) return { value: null, ...out };
    return { value: Number(text), ...out };
  }

  async function sha256Hex(bytes) {
    const d = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const fail = (code, message) => Object.assign(new Error(message), { ocrCode: code });
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(fail("ENGINE_NOT_LOADED", "OCR model asset missing: " + src));
    document.head.appendChild(s);
  });
  const b64ToBytes = (s) => { const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };

  // ---- the engine ------------------------------------------------------------
  class PaddleOCREngine {
    constructor() { this.state = "idle"; this.det = null; this.rec = null; this.keys = null; this.loading = null; this.lastError = null; }

    // Where the assets come from: the package's embedded files when the
    // offline build set MERIT_PPOCR_ASSET_PATHS.embedded, otherwise jsDelivr
    // at the pinned versions. The single-file package sets `.none`: it carries
    // no model and must not try the network for one.
    async load() {
      if (this.state === "ready") return this;
      if (this.loading) return this.loading;
      this.loading = (async () => {
        let mjsUrl = null;
        try {
          this.state = "loading";
          const paths = globalThis.MERIT_PPOCR_ASSET_PATHS || null;
          if (paths && paths.none) throw fail("ENGINE_NOT_BUNDLED", paths.none);
          const embedded = paths && paths.embedded;
          if (!globalThis.MERIT_PPOCR_V4_KEYS) await loadScript((embedded ? embedded : "") + (embedded ? "keys.js" : PINS.keysScript));
          this.keys = globalThis.MERIT_PPOCR_V4_KEYS;
          if (!Array.isArray(this.keys) || this.keys.length !== 6623) throw fail("ENGINE_NOT_LOADED", "recognition character list missing or wrong length");
          let detBytes, recBytes;
          if (embedded) {
            // The runtime as its own file; the wasm, its loader and both models
            // as base64 strings in script files — a page opened from disk can
            // run scripts beside it but cannot fetch them.
            if (!globalThis.ort) await loadScript(embedded + PINS.runtime.script);
            for (const part of ["wasm", "mjs", "det", "rec"]) await loadScript(embedded + "embed-" + part + ".js");
            const E = globalThis.MERIT_PPOCR_EMBED || {};
            if (!globalThis.ort) throw fail("ENGINE_NOT_LOADED", "ONNX Runtime Web did not load from the package");
            globalThis.ort.env.wasm.wasmBinary = b64ToBytes(E.wasm);
            mjsUrl = URL.createObjectURL(new Blob([E.mjs], { type: "text/javascript" }));
            globalThis.ort.env.wasm.wasmPaths = { mjs: mjsUrl };
            detBytes = b64ToBytes(E.det); recBytes = b64ToBytes(E.rec);
            delete globalThis.MERIT_PPOCR_EMBED;
          } else {
            if (!globalThis.ort) await loadScript(runtimeBase() + PINS.runtime.script);
            if (!globalThis.ort) throw fail("ENGINE_NOT_LOADED", "ONNX Runtime Web did not load");
            globalThis.ort.env.wasm.wasmPaths = runtimeBase();
            const get = async (m) => {
              const r = await fetch(modelUrl(m));
              if (!r.ok) throw fail("ENGINE_NOT_LOADED", `model fetch failed (${r.status})`);
              return new Uint8Array(await r.arrayBuffer());
            };
            [detBytes, recBytes] = await Promise.all([get(PINS.models.det), get(PINS.models.rec)]);
          }
          // Single thread: a page that is not cross-origin isolated (and a
          // file:// package never is) cannot share memory with workers.
          globalThis.ort.env.wasm.numThreads = 1;
          globalThis.ort.env.logLevel = "error";
          // WebCrypto exists only in a secure context (https, localhost, a file
          // opened from disk). Elsewhere the size is still checked and the
          // result says the hash was not — never that it was.
          const canHash = !!(globalThis.crypto && crypto.subtle);
          for (const [bytes, m] of [[detBytes, PINS.models.det], [recBytes, PINS.models.rec]]) {
            if (bytes.byteLength !== m.bytes) throw fail("MODEL_INTEGRITY", `model size ${bytes.byteLength} is not the pinned ${m.bytes}`);
            if (canHash && (await sha256Hex(bytes)) !== m.sha256) throw fail("MODEL_INTEGRITY", "model sha256 is not the pinned one");
          }
          this.integrity = canHash ? "sha256" : "size-only (no WebCrypto in this context)";
          const so = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
          this.det = await globalThis.ort.InferenceSession.create(detBytes, so);
          this.rec = await globalThis.ort.InferenceSession.create(recBytes, so);
          this.state = "ready";
          return this;
        } catch (error) {
          this.state = "failed"; this.lastError = error; this.loading = null;
          throw error.ocrCode ? error : fail("ENGINE_NOT_LOADED", error && error.message ? error.message : String(error));
        } finally {
          // The runtime has imported its loader by now (or failed to).
          if (mjsUrl) URL.revokeObjectURL(mjsUrl);
        }
      })();
      return this.loading;
    }

    // Read every text line on an image. `image` is anything drawImage takes,
    // with naturalWidth/Height or width/height in SOURCE pixels.
    async read(image, opts) {
      const o = opts || {}, signal = o.signal, t0 = performance.now(), budget = o.timeoutMs || 90000;
      const check = () => {
        if (signal && signal.aborted) throw fail("CANCELLED", "OCR model read cancelled");
        if (performance.now() - t0 > budget) throw fail("TIMEOUT", "OCR model read exceeded its time budget");
      };
      const yieldNow = () => new Promise(r => setTimeout(r, 0));
      await this.load();
      const ort = globalThis.ort, W = image.naturalWidth || image.width, H = image.naturalHeight || image.height;
      const [dw, dh] = detSize(W, H, o.maxSide || 2000, o.limitMin || 736);
      const c = document.createElement("canvas"); c.width = dw; c.height = dh;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(image, 0, 0, dw, dh);
      const px = g.getImageData(0, 0, dw, dh).data, n = dw * dh, t = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) { t[i] = px[4 * i + 2] / 127.5 - 1; t[n + i] = px[4 * i + 1] / 127.5 - 1; t[2 * n + i] = px[4 * i] / 127.5 - 1; }
      check(); await yieldNow();
      const prob = (await this.det.run({ [this.det.inputNames[0]]: new ort.Tensor("float32", t, [1, 3, dh, dw]) }))[this.det.outputNames[0]];
      const tDet = performance.now() - t0;
      const boxes = dbPost(prob.data, prob.dims[3], prob.dims[2], W, H, { thresh: 0.3, boxThresh: 0.5, unclipRatio: 1.6, minSize: 3 });
      check();
      // Recognition in batches of six, ordered by aspect ratio, a tall box
      // read turned 90 degrees (as the reference implementation does).
      boxes.forEach(b => { const cw = b.x1 - b.x0, ch = b.y1 - b.y0; b.rot = ch / Math.max(1, cw) >= 1.5; b.ratio = b.rot ? ch / Math.max(1, cw) : cw / Math.max(1, ch); });
      const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].ratio - boxes[b].ratio);
      const rc = document.createElement("canvas"); rc.width = 2048; rc.height = 48;
      const rg = rc.getContext("2d", { willReadFrequently: true });
      for (let s = 0; s < order.length; s += 6) {
        check(); await yieldNow();
        const idx = order.slice(s, s + 6);
        const imgW = Math.trunc(48 * Math.max(320 / 48, ...idx.map(i => boxes[i].ratio))), B = idx.length, plane = 48 * imgW;
        const data = new Float32Array(B * 3 * plane);
        if (rc.width < imgW) rc.width = imgW;
        idx.forEach((bi, k) => {
          const b = boxes[bi], rw = Math.min(imgW, Math.ceil(48 * b.ratio)), cw = b.x1 - b.x0, ch = b.y1 - b.y0;
          rg.setTransform(1, 0, 0, 1, 0, 0); rg.clearRect(0, 0, rc.width, rc.height);
          if (b.rot) { rg.translate(0, 48); rg.rotate(-Math.PI / 2); rg.drawImage(image, b.x0, b.y0, cw, ch, 0, 0, 48, rw); }
          else rg.drawImage(image, b.x0, b.y0, cw, ch, 0, 0, rw, 48);
          rg.setTransform(1, 0, 0, 1, 0, 0);
          const p = rg.getImageData(0, 0, rw, 48).data, base = k * 3 * plane;
          for (let y = 0; y < 48; y++) for (let x = 0; x < rw; x++) {
            const p4 = 4 * (y * rw + x), o2 = y * imgW + x;
            data[base + o2] = p[p4 + 2] / 127.5 - 1; data[base + plane + o2] = p[p4 + 1] / 127.5 - 1; data[base + 2 * plane + o2] = p[p4] / 127.5 - 1;
          }
        });
        const out = (await this.rec.run({ [this.rec.inputNames[0]]: new ort.Tensor("float32", data, [B, 3, 48, imgW]) }))[this.rec.outputNames[0]];
        idx.forEach((bi, k) => { const r = ctcGreedy(out.data, out.dims, k, this.keys); boxes[bi].text = r.text; boxes[bi].score = +r.score.toFixed(4); });
        if (typeof o.onProgress === "function") o.onProgress(Math.min(1, (s + 6) / Math.max(1, order.length)));
      }
      return {
        available: true, provider: { id: PINS.id, label: PINS.label, runtime: `${PINS.runtime.package}@${PINS.runtime.version}`,
          models: `${PINS.models.package}@${PINS.models.version}`, integrity: this.integrity, trainedModel: true, domain: "text only — not a model of plans" },
        items: boxes.map(b => ({ text: b.text || "", score: b.score || 0, box: { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }, rotated: !!b.rot })),
        imageSize: { width: W, height: H }, ms: { detection: Math.round(tDet), total: Math.round(performance.now() - t0) },
      };
    }

    async release() {
      // A session that fails to release is recorded, not hidden; the engine is
      // reset either way so the next load() starts clean.
      for (const s of [this.det, this.rec]) { try { if (s) await s.release(); } catch (error) { this.releaseError = error; } }
      this.det = this.rec = null; this.state = "idle"; this.loading = null;
    }
  }

  // One engine per page; read() reports unavailability instead of throwing.
  let engine = null;
  async function readPlanText(image, opts) {
    try {
      engine ||= new PaddleOCREngine();
      return await engine.read(image, opts);
    } catch (error) {
      return { available: false, reasonCode: (error && error.ocrCode) || "FAILED", reason: error && error.message ? error.message : String(error),
        provider: { id: PINS.id, label: PINS.label } };
    }
  }

  globalThis.MeritPaddleOCR = Object.freeze({ PINS, PaddleOCREngine, readPlanText, detSize, dbPost, ctcGreedy, numberInBox,
    status: () => (engine ? engine.state : "idle") });
})();
