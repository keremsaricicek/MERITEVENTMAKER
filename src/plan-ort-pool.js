// MERIT Event Maker — ONNX Runtime in worker threads (MeritOrtPool).
//
// Why it exists: the OCR model and the local plan-symbol detector ran their
// inference on the page's main thread. Measured on ORNEK (4 cores), the OCR
// model alone held it for 23–27 s, in single tasks of up to 4 s, while the
// operator could not scroll, zoom or cancel (benchmarks/perf/analysis-profile.mjs).
//
// What it does: the same onnxruntime-web build, in N dedicated workers made
// from a blob (a page opened from disk cannot start a worker from a file).
// Each worker runs ONE thread (a page that is not cross-origin isolated cannot
// share memory with workers), so parallelism comes from several workers, each
// with its own session. A batch sent to a worker gets the same model, the same
// input and the same single-threaded kernels as on the main thread, so the
// output is the same.
//
// What it does not do: decide anything. The bytes it runs were already
// checked against their pinned size and sha256 by the caller (plan-ocr-paddle,
// plan-model); it only runs them. If a worker cannot be started (no Worker,
// a policy that refuses it, a runtime that fails to initialise), every call
// rejects with a reason and the caller runs the old main-thread path.
//
// It reads no shell state.
(function () {
  "use strict";

  const WORKER_MAIN = `
    "use strict";
    const sessions = new Map();
    const toTensor = (f) => new ort.Tensor(f.type, f.type === "int64" ? new BigInt64Array(f.data) : f.type === "int32" ? new Int32Array(f.data) : new Float32Array(f.data), f.dims);
    self.onmessage = async (event) => {
      const m = event.data;
      try {
        if (m.op === "init") {
          ort.env.wasm.numThreads = 1;
          ort.env.logLevel = "error";
          ort.env.wasm.wasmBinary = new Uint8Array(m.wasm);
          ort.env.wasm.wasmPaths = m.mjsUrl ? { mjs: m.mjsUrl } : { mjs: URL.createObjectURL(new Blob([m.mjs], { type: "text/javascript" })) };
          self.postMessage({ id: m.id, ok: true });
        } else if (m.op === "load") {
          const s = await ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
          sessions.set(m.key, s);
          self.postMessage({ id: m.id, ok: true, inputNames: s.inputNames, outputNames: s.outputNames });
        } else if (m.op === "run") {
          const s = sessions.get(m.key);
          if (!s) throw new Error("no session " + m.key);
          const feeds = {};
          for (const [name, f] of Object.entries(m.feeds)) feeds[name] = toTensor(f);
          const t0 = performance.now();
          const out = await s.run(feeds);
          const outputs = {}, transfer = [];
          for (const [name, t] of Object.entries(out)) {
            const data = t.data.slice();
            outputs[name] = { type: t.type, dims: t.dims, data: data.buffer };
            transfer.push(data.buffer);
          }
          self.postMessage({ id: m.id, ok: true, outputs, ms: performance.now() - t0 }, transfer);
        } else if (m.op === "release") {
          const s = sessions.get(m.key);
          if (s) { sessions.delete(m.key); await s.release(); }
          self.postMessage({ id: m.id, ok: true });
        }
      } catch (error) {
        self.postMessage({ id: m.id, ok: false, error: String(error && error.message || error) });
      }
    };`;

  let workers = [], state = "idle", reason = null, starting = null;
  const fail = (code, message) => Object.assign(new Error(message), { poolCode: code });

  function makeWorker(url) {
    const w = new Worker(url);
    const pending = new Map();
    let next = 0;
    const entry = { w, keys: new Map(), busy: 0, dead: null };
    w.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); entry.busy--; e.data.ok ? p.resolve(e.data) : p.reject(fail("WORKER_ERROR", e.data.error)); };
    entry.kill = (code, message) => { entry.dead = message; for (const p of pending.values()) p.reject(fail(code, message)); pending.clear(); entry.busy = 0; };
    w.onerror = (e) => entry.kill("WORKER_DIED", (e && e.message) || "worker error");
    entry.call = (msg, transfer) => new Promise((resolve, reject) => {
      if (entry.dead) { reject(fail("WORKER_DIED", entry.dead)); return; }
      const id = ++next; pending.set(id, { resolve, reject }); entry.busy++;
      w.postMessage({ ...msg, id }, transfer || []);
    });
    return entry;
  }

  // How many workers a machine gets: one per core the page can use, leaving
  // one for the page itself and the OCR text engine, never more than three
  // (each holds its own copy of a model; three measured 3.1x one on 4 cores).
  function defaultSize() {
    const n = (globalThis.navigator && navigator.hardwareConcurrency) || 2;
    return Math.max(1, Math.min(3, n - 1));
  }

  // runtime: { source (the ort.wasm.min.js text), wasm (bytes), mjs (text) | mjsUrl }
  async function start(runtime, opts) {
    if (state === "ready") return true;
    if (starting) return starting;
    starting = (async () => {
      try {
        if (globalThis.MERIT_ORT_WORKERS_DISABLED) throw fail("DISABLED", String(globalThis.MERIT_ORT_WORKERS_DISABLED));
        if (typeof Worker !== "function") throw fail("NO_WORKER", "this page cannot start workers");
        if (!runtime || typeof runtime.source !== "string" || !runtime.wasm) throw fail("NO_RUNTIME", "the runtime's source or binary was not provided");
        const size = Math.max(1, Math.min(4, (opts && opts.size) || defaultSize()));
        const url = URL.createObjectURL(new Blob([runtime.source, "\n", WORKER_MAIN], { type: "application/javascript" }));
        try {
          workers = Array.from({ length: size }, () => makeWorker(url));
          const wasm = runtime.wasm instanceof ArrayBuffer ? runtime.wasm : runtime.wasm.buffer.slice(runtime.wasm.byteOffset, runtime.wasm.byteOffset + runtime.wasm.byteLength);
          await Promise.all(workers.map((w) => w.call({ op: "init", wasm: wasm.slice(0), mjs: runtime.mjs || null, mjsUrl: runtime.mjsUrl || null })));
        } finally { URL.revokeObjectURL(url); }
        state = "ready"; reason = null;
        return true;
      } catch (error) {
        terminate();
        state = "failed"; reason = { code: error.poolCode || "FAILED", message: error && error.message ? error.message : String(error) };
        starting = null;
        throw error;
      }
    })();
    return starting;
  }

  // Load one model into `count` workers (the least loaded first). Returns the
  // session's input and output names.
  async function load(key, bytes, count) {
    if (state !== "ready") throw fail("NOT_READY", "the worker pool is not running");
    const n = Math.max(1, Math.min(workers.length, count || 1));
    const targets = workers.filter((w) => !w.dead).sort((a, b) => a.keys.size - b.keys.size).slice(0, n);
    const ab = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const results = await Promise.all(targets.map((w) => w.call({ op: "load", key, model: ab.slice(0) })));
    targets.forEach((w) => w.keys.set(key, true));
    return { inputNames: results[0].inputNames, outputNames: results[0].outputNames, workers: targets.length };
  }

  const has = (key) => state === "ready" && workers.some((w) => !w.dead && w.keys.has(key));

  // feeds: { name: { type: "float32", data: TypedArray, dims } }. The data is
  // transferred (the caller's array is emptied). Returns { name: { data, dims } }.
  async function run(key, feeds) {
    const candidates = workers.filter((w) => !w.dead && w.keys.has(key));
    if (!candidates.length) throw fail("NO_SESSION", "no worker holds " + key);
    const w = candidates.sort((a, b) => a.busy - b.busy)[0];
    const msg = {}, transfer = [];
    for (const [name, f] of Object.entries(feeds)) {
      const buf = f.data.buffer.byteLength === f.data.byteLength ? f.data.buffer : f.data.slice().buffer;
      msg[name] = { type: f.type, dims: f.dims, data: buf };
      transfer.push(buf);
    }
    const r = await w.call({ op: "run", key, feeds: msg }, transfer);
    const outputs = {};
    for (const [name, o] of Object.entries(r.outputs)) outputs[name] = { dims: o.dims, data: o.type === "int64" ? new BigInt64Array(o.data) : o.type === "int32" ? new Int32Array(o.data) : new Float32Array(o.data) };
    return { outputs, ms: r.ms };
  }

  // Stops every worker NOW, mid-inference included, and rejects what was
  // waiting on them (poolCode "TERMINATED") so no caller waits forever. The
  // sessions go with the workers; the next start() builds them again.
  function terminate() {
    for (const w of workers) {
      try { w.w.terminate(); } catch (error) { reason = { code: "TERMINATE", message: String(error) }; }
      w.kill("TERMINATED", "the worker pool was stopped");
    }
    workers = []; state = "idle"; starting = null;
  }
  const busy = () => workers.reduce((n, w) => n + w.busy, 0);

  globalThis.MeritOrtPool = Object.freeze({ start, load, run, has, terminate, defaultSize,
    status: () => ({ state, workers: workers.length, busy: busy(), reason, sessions: workers.map((w) => [...w.keys.keys()]) }) });
})();
