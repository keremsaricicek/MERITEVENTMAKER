// MERIT Event Maker — the relay's LOCAL provider.
//
//   VLM_PROVIDER=local VLM_LOCAL_URL=http://127.0.0.1:8080 \
//   VLM_LOCAL_MANIFEST=/path/to/model/merit-local-vlm.json npm run serve:vlm
//
// The same reading as the cloud one — the same fixed instruction, the same
// closed answer schema, the same checks on what comes back, the same "a person
// presses Accept" — sent to a vision-language model running in a process on
// THIS machine instead of to an API. The reference process is llama.cpp's
// `llama-server` with its multimodal projector (`--mmproj`), which speaks the
// OpenAI-compatible chat endpoint used here; any server that speaks it on
// loopback works the same way.
//
// What is structural, not promised:
//   LOOPBACK ONLY. The URL must name 127.0.0.1, localhost or ::1. A plan never
//     leaves the machine through this provider; anything else is refused as
//     configuration (LOCAL_NOT_LOOPBACK) before a byte is sent.
//   PINNED WEIGHTS. A manifest names every file the local process loads, each
//     with its size and sha256, plus where it came from and its licence. The
//     relay hashes every file when it starts and refuses to run if one is
//     missing (LOCAL_MODEL_MISSING) or differs (LOCAL_MODEL_INTEGRITY).
//   THE MEASURED SERVER, NOT ONLY THE MEASURED FILES. A manifest that lists
//     measured questions (`checks`) also says how the measured server ran
//     (`serve`: the model file, each adapter and its scale, the context). Before
//     every closed question the relay asks the process what it has loaded
//     (llama-server's /props and /lora-adapters) and refuses unless it is
//     those very files, on those very paths, at that context
//     (LOCAL_SERVER_MISMATCH; LOCAL_SERVER_UNVERIFIED when the process cannot
//     say). A server started without its adapter answers as the untrained model
//     — on the V4 test 0.55 on chairs instead of 0.91 — behind a manifest whose
//     every hash still passes (audit of 2026-10-19). What it cannot see: the
//     projector file (not reported) and --cache-ram, which changes memory, not
//     answers.
//   NO KEY, NO CHARGE. There is no key to hold and nothing to pay; the day's
//     request cap still applies, because a reading still costs this machine
//     minutes of CPU.
//   NOTHING NEW TRUSTED. The answer goes through vlm-core's validateModelOutput
//     exactly like the cloud model's: an answer outside the schema is refused,
//     a finding outside it is dropped with its reason, and a printed table
//     number is never taken from a model (the page's rule, unchanged).
//
// This file holds no model and downloads nothing. Which model, from where and
// under which licence is the manifest's statement, made by the developer who
// fetched the files; benchmarks/offline-intelligence/LOCAL-VLM.md says why none
// could be fetched from this environment.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";

export const MANIFEST_FORMAT = "merit-local-vlm/1";
// The closed questions a manifest may say its model was measured on — the same
// file the relay builds them from (vlm-core ASK_SPEC).
const ASK_QUESTION_NAMES = Object.keys(JSON.parse(fs.readFileSync(new URL("./local-check-questions.json", import.meta.url), "utf8")).questions);
const MAX_FILES = 8;

// The URL, if it names this machine; null otherwise.
export function loopbackOrigin(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return null;
  return u.origin;
}

// In 8 MB pieces: a model file can be gigabytes, and is never read whole.
function sha256File(file) {
  const h = crypto.createHash("sha256"), buf = Buffer.allocUnsafe(8 * 1024 * 1024), fd = fs.openSync(file, "r");
  try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest("hex");
}
const str = (v, max) => typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;

// Read and (by default) verify a manifest:
//   { format: "merit-local-vlm/1", id, name, version, licence, source,
//     runtime: "llama.cpp b6xxx" (what serves it), servedModel: optional name
//     the server expects in "model", files: [{ path, bytes, sha256 }] }
// Paths are relative to the manifest's own directory and may not leave it.
export function readManifest(file, { verify = true } = {}) {
  const fail = (code, problem) => ({ ok: false, code, problem });
  let m;
  try { m = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fail(e && e.code === "ENOENT" ? "LOCAL_NOT_PINNED" : "LOCAL_MANIFEST_INVALID", "the manifest could not be read as JSON"); }
  if (!m || typeof m !== "object" || Array.isArray(m) || m.format !== MANIFEST_FORMAT) return fail("LOCAL_MANIFEST_INVALID", `format must be "${MANIFEST_FORMAT}"`);
  const id = str(m.id, 80), name = str(m.name, 120), version = str(m.version, 60), licence = str(m.licence, 120), source = str(m.source, 300), runtime = str(m.runtime, 120);
  if (!id || !/^[A-Za-z0-9._:-]+$/.test(id) || !name || !version || !licence || !source || !runtime) return fail("LOCAL_MANIFEST_INVALID", "id, name, version, licence, source and runtime are all required");
  const servedModel = m.servedModel == null ? id : str(m.servedModel, 120);
  if (!servedModel) return fail("LOCAL_MANIFEST_INVALID", "servedModel must be a short string");
  // The closed questions (server/local-check-questions.json) this model passed
  // its measurement on, and the file that says so. A question not listed is
  // refused by the relay, so an unmeasured question cannot reach a person.
  const KNOWN = ASK_QUESTION_NAMES;
  if (m.checks != null && (!Array.isArray(m.checks) || m.checks.length > KNOWN.length || !m.checks.every(q => KNOWN.includes(q)) || new Set(m.checks).size !== m.checks.length))
    return fail("LOCAL_MANIFEST_INVALID", `checks must list questions from: ${KNOWN.join(", ")}`);
  const checks = m.checks || [];
  const checksEvidence = m.checksEvidence == null ? null : str(m.checksEvidence, 300);
  if (checks.length && !checksEvidence) return fail("LOCAL_MANIFEST_INVALID", "checks need checksEvidence: the measurement they passed");
  // What the model may CHANGE by itself (training/README.md "Changing the plan by
  // itself"): a subset of its measured checks that passed the stricter bar, and
  // only a question the product knows how to apply — a grouping answer (merged).
  const AUTO = ["merged"];
  if (m.autoApply != null && (!Array.isArray(m.autoApply) || !m.autoApply.every(q => AUTO.includes(q) && checks.includes(q)) || new Set(m.autoApply).size !== m.autoApply.length))
    return fail("LOCAL_MANIFEST_INVALID", `autoApply must list measured checks the product can apply by itself: ${AUTO.join(", ")}`);
  const autoApply = m.autoApply || [];
  // How the measured server ran — required with checks, so the relay can ask
  // the running process whether it is that server.
  let serve = null;
  if (m.serve != null || checks.length) {
    const sv = m.serve, listed = new Set(Array.isArray(m.files) ? m.files.map(f => f && f.path) : []);
    const loraOk = sv && Array.isArray(sv.lora) && sv.lora.length <= 4 && sv.lora.every(l => l && typeof l.path === "string" && listed.has(l.path) && typeof l.scale === "number" && l.scale > 0 && l.scale <= 4);
    if (!sv || typeof sv !== "object" || typeof sv.model !== "string" || !listed.has(sv.model) || !loraOk || !Number.isSafeInteger(sv.ctx) || sv.ctx < 256 || sv.ctx > 262144)
      return fail("LOCAL_MANIFEST_INVALID", "checks need serve: { model, lora: [{ path, scale }], ctx } naming files the manifest pins — how the measured server ran");
    serve = { model: sv.model, lora: sv.lora.map(l => ({ path: l.path, scale: l.scale })), ctx: sv.ctx };
  }
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > MAX_FILES) return fail("LOCAL_MANIFEST_INVALID", `files must list 1 to ${MAX_FILES} files`);
  const dir = path.dirname(path.resolve(file)), files = [];
  for (const f of m.files) {
    if (!f || typeof f.path !== "string" || !Number.isSafeInteger(f.bytes) || f.bytes <= 0 || !/^[0-9a-f]{64}$/.test(String(f.sha256 || ""))) return fail("LOCAL_MANIFEST_INVALID", "each file needs a path, a byte size and a sha256");
    const abs = path.resolve(dir, f.path);
    if (!abs.startsWith(dir + path.sep)) return fail("LOCAL_MANIFEST_INVALID", "a file path leaves the manifest's directory");
    files.push({ path: f.path, abs, bytes: f.bytes, sha256: f.sha256 });
  }
  if (verify) {
    for (const f of files) {
      let st;
      try { st = fs.statSync(f.abs); } catch { return fail("LOCAL_MODEL_MISSING", `${f.path} is not on disk`); }
      if (!st.isFile() || st.size !== f.bytes) return fail("LOCAL_MODEL_INTEGRITY", `${f.path} is ${st.size} bytes, not the pinned ${f.bytes}`);
      if (sha256File(f.abs) !== f.sha256) return fail("LOCAL_MODEL_INTEGRITY", `${f.path} does not match its pinned sha256`);
    }
  }
  return { ok: true, manifest: { id, name, version, licence, source, runtime, servedModel, checks, autoApply, checksEvidence, serve, files: files.map(({ path: p, bytes, sha256 }) => ({ path: p, bytes, sha256 })) } };
}

// The provider-specific half of the relay's configuration (vlm-core merges it
// with the shared limits). Never throws: what is wrong is a reasonCode.
export function localFromEnv(env) {
  const raw = env.VLM_LOCAL_URL || "";
  const origin = loopbackOrigin(raw);
  const manifestPath = env.VLM_LOCAL_MANIFEST ? path.resolve(String(env.VLM_LOCAL_MANIFEST)) : null;
  const read = manifestPath ? readManifest(manifestPath) : { ok: false, code: "LOCAL_NOT_PINNED", problem: "VLM_LOCAL_MANIFEST is not set" };
  const reasonCode = !raw ? "LOCAL_NO_URL" : !origin ? "LOCAL_NOT_LOOPBACK" : !read.ok ? read.code : null;
  return {
    reasonCode,
    problem: reasonCode ? (read.ok ? null : read.problem) : null,
    model: read.ok ? read.manifest.id : "local",
    upstreamBaseURL: origin,
    local: read.ok ? { ...read.manifest, integrity: "sha256", url: origin,
      // the files the measured server loaded, as this disk names them (never sent to the page)
      serveAt: read.manifest.serve ? { model: realOrSelf(path.resolve(path.dirname(manifestPath), read.manifest.serve.model)), ctx: read.manifest.serve.ctx,
        lora: read.manifest.serve.lora.map(l => ({ at: realOrSelf(path.resolve(path.dirname(manifestPath), l.path)), scale: l.scale })) } : null } : null,
  };
}
const realOrSelf = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

// Is the running process the measured server? `props` and `adapters` are what
// llama-server reports (GET /props, GET /lora-adapters). The same model file
// on the same path, every pinned adapter loaded at its scale and no other one
// active, the same context. A pure function: the relay passes what it read.
export function checkServing(local, props, adapters) {
  const at = local && local.serveAt;
  if (!at) return { ok: true, verified: false };
  if (!props || typeof props !== "object" || !Array.isArray(adapters)) return { ok: false, code: "LOCAL_SERVER_UNVERIFIED", problem: "the local process does not say what it has loaded (/props, /lora-adapters)" };
  if (typeof props.model_path !== "string" || realOrSelf(props.model_path) !== at.model) return { ok: false, code: "LOCAL_SERVER_MISMATCH", problem: "the local process is not running the pinned model file" };
  const nCtx = props.default_generation_settings && props.default_generation_settings.n_ctx;
  if (nCtx !== at.ctx) return { ok: false, code: "LOCAL_SERVER_MISMATCH", problem: `the local process runs a context of ${Number(nCtx) || "?"}, the measured one ${at.ctx}` };
  const active = adapters.filter(a => a && Number(a.scale) !== 0).map(a => ({ at: realOrSelf(String(a.path || "")), scale: Number(a.scale) }));
  const same = active.length === at.lora.length && at.lora.every(l => active.some(a => a.at === l.at && Math.abs(a.scale - l.scale) < 1e-6));
  if (!same) return { ok: false, code: "LOCAL_SERVER_MISMATCH", problem: at.lora.length ? "the local process is not running the pinned adapter at its scale" : "the local process runs an adapter the measurement did not" };
  return { ok: true, verified: true };
}

// ---- the request and the answer --------------------------------------------------------
// The cloud request (vlm-core buildMessagesRequest) carries the fixed system
// text, the image, the task text and the answer schema; the local request is
// the same four things in the chat endpoint's shape. Nothing is added.
export function toChatRequest(params, config) {
  const user = params.messages && params.messages[0] && params.messages[0].content || [];
  const image = user.find((b) => b && b.type === "image");
  const text = user.filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
  const schema = params.output_config && params.output_config.format && params.output_config.format.schema;
  return {
    model: (config.local && config.local.servedModel) || params.model,
    max_tokens: params.max_tokens,
    temperature: 0,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: [
        ...(image ? [{ type: "image_url", image_url: { url: `data:${image.source.media_type};base64,${image.source.data}` } }] : []),
        { type: "text", text },
      ] },
    ],
    ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "plan_review", strict: true, schema } } } : {}),
  };
}

// The chat answer in the shape the relay already reads (content blocks, a stop
// reason, usage) — so everything after it is the code the cloud path runs.
export function fromChatResponse(body, config) {
  const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
  const content = choice && choice.message && typeof choice.message.content === "string" ? choice.message.content : "";
  const u = (body && body.usage) || {};
  return {
    model: config.model,
    content: [{ type: "text", text: content }],
    stop_reason: choice && choice.finish_reason === "length" ? "max_tokens" : "end_turn",
    usage: { input_tokens: Number(u.prompt_tokens) || 0, output_tokens: Number(u.completion_tokens) || 0 },
  };
}

// ---- the client -----------------------------------------------------------------------------
// The three calls the relay makes of its client, answered by the local process.
// Failures are thrown as the error classes vlm-core's mapUpstreamError reads,
// plus `localCode` for the one thing only a local provider can say: the
// process is not running.
export class APIUserAbortError extends Error {}
export class APIConnectionTimeoutError extends Error {}
export class APIConnectionError extends Error {}
class LocalStatusError extends Error { constructor(status, message) { super(message); this.status = status; } }

// The default transport: one plain HTTP request to the loopback process, with
// NO clock of its own. The relay's timeout (config.limits.timeoutMs, up to
// 900 s) is the only one. Node's built-in fetch carries its own 300-second
// headers timeout, and that fired first: a real model on four CPU cores that
// was still reading a whole plan at 5 minutes (2026-10-18, Qwen2-VL-2B, 72 % of
// the prompt in 257 s) came back as "the local model process is not running".
function loopbackFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), body = init.body == null ? null : String(init.body);
    const headers = { ...(init.headers || {}) };
    if (body != null) headers["content-length"] = Buffer.byteLength(body);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: init.method || "GET", headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(data) }));
      res.on("error", reject);
    });
    req.setTimeout(0);
    req.on("error", reject);
    if (init.signal) {
      if (init.signal.aborted) { req.destroy(new Error("aborted")); return; }
      init.signal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
    }
    req.end(body == null ? undefined : body);
  });
}
// A transport's OWN timeout (undici's headers/body timers, if a caller passes
// fetch) is a timeout too, never "not running".
const transportTimedOut = (err) => {
  const code = (err && err.cause && err.cause.code) || (err && err.code) || "";
  return /UND_ERR_(HEADERS|BODY)_TIMEOUT|ETIMEDOUT/.test(code);
};

export function makeLocalClient(config, { fetchImpl = loopbackFetch } = {}) {
  const base = config.upstreamBaseURL;
  async function call(pathname, init, opts) {
    const signal = opts && opts.signal, timeout = (opts && opts.timeout) || config.limits.timeoutMs;
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener("abort", onAbort, { once: true }); }
    try {
      const r = await fetchImpl(base + pathname, { ...init, signal: ctrl.signal });
      if (!r.ok) throw new LocalStatusError(r.status, `the local model process answered ${r.status}`);
      return await r.json();
    } catch (err) {
      if (err instanceof LocalStatusError) throw err;
      if (signal && signal.aborted) throw new APIUserAbortError("cancelled");
      if (timedOut || transportTimedOut(err)) throw new APIConnectionTimeoutError("the local model process did not answer in time");
      throw Object.assign(new APIConnectionError("the local model process is not answering"), { localCode: "LOCAL_NOT_RUNNING" });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }
  return {
    provider: "local",
    // One closed question about one crop (the relay's /ask, vlm-core
    // askText): the image and the fixed question, as the benchmark sends them
    // (local-vlm-bench2.py ask) — no system text, no schema, thinking off,
    // a short answer. Returns the raw text; the relay keeps only a closed value.
    async ask({ image, text }, opts) {
      const body = await call("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        model: (config.local && config.local.servedModel) || config.model, max_tokens: 48, temperature: 0, cache_prompt: false,
        chat_template_kwargs: { enable_thinking: false },
        messages: [{ role: "user", content: [
          { type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.data}` } },
          { type: "text", text },
        ] }],
      }) }, opts);
      const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
      return { text: choice && choice.message && typeof choice.message.content === "string" ? choice.message.content : "", finish: (choice && choice.finish_reason) || null };
    },
    // What the process has loaded, to compare with the manifest's `serve`.
    async serving(opts) {
      const props = await call("/props", { method: "GET" }, opts);
      const adapters = await call("/lora-adapters", { method: "GET" }, opts);
      return { props, adapters };
    },
    models: {
      async retrieve(model, _query, opts) {
        const body = await call("/v1/models", { method: "GET" }, opts);
        const served = (body && Array.isArray(body.data) ? body.data : []).map((m) => m && m.id).filter(Boolean);
        return { id: model, display_name: config.local ? `${config.local.name} ${config.local.version}` : model, served };
      },
    },
    beta: {
      messages: {
        // A local process has no free token count, and there is nothing to
        // charge: the relay does not ask (vlm-relay skips counting for "local").
        async countTokens() { throw new Error("local provider: no token count"); },
        async create(params, opts) {
          const body = await call("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(toChatRequest(params, config)) }, opts);
          return fromChatResponse(body, config);
        },
      },
    },
  };
}
