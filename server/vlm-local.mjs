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
//     missing (LOCAL_MODEL_MISSING) or differs (LOCAL_MODEL_INTEGRITY). It
//     cannot see inside the other process, so this proves the files on disk are
//     the pinned ones — the process must be started on those same paths, which
//     the manifest states.
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

export const MANIFEST_FORMAT = "merit-local-vlm/1";
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
  return { ok: true, manifest: { id, name, version, licence, source, runtime, servedModel, files: files.map(({ path: p, bytes, sha256 }) => ({ path: p, bytes, sha256 })) } };
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
    local: read.ok ? { ...read.manifest, integrity: "sha256", url: origin } : null,
  };
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

export function makeLocalClient(config, { fetchImpl = globalThis.fetch } = {}) {
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
      if (timedOut) throw new APIConnectionTimeoutError("the local model process did not answer in time");
      throw Object.assign(new APIConnectionError("the local model process is not answering"), { localCode: "LOCAL_NOT_RUNNING" });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }
  return {
    provider: "local",
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
