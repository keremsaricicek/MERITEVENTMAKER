// MERIT Event Maker — the F8 assistant's SECOND reader, on this machine.
//
//   ASSISTANT_CHAT_URL=http://127.0.0.1:8097 \
//   ASSISTANT_CHAT_MANIFEST=/path/to/merit-local-chat.json npm run serve:vlm
//
// A sentence the F8 rules could not place (src/assistant-parse.js says
// "unknown") is sent by the page to POST /vlm-relay/read; the relay asks a chat
// model running in a process on THIS machine to read it into the rules' own
// shape (src/assistant-reading.js — the one source of the instruction, the
// worked examples and the schema that training/assistant_race.mjs measured) and
// returns that reading, or none. The page then answers and acts with the same
// code as for the rules.
//
// What is structural, not promised:
//   LOOPBACK ONLY, as the local vision model: the URL must name this machine.
//   PINNED WEIGHTS. The manifest names every file the process loads (size,
//     sha256), where they came from, their licence, how the measured server ran
//     (`serve`) and the race result that chose it (`evidence`); the relay hashes
//     them when it starts and refuses to read with a missing or changed file.
//   THE MEASURED SERVER. Before every reading the process is asked what it has
//     loaded (/props, /lora-adapters) — the pinned model file at the measured
//     context, the pinned adapter if any — or nothing is read.
//   A READING, NOTHING ELSE. The answer must be the schema's object exactly
//     (MeritAssistantReading.valid); anything else is "no reading". The model
//     never answers the person and never changes the plan: the page's acting
//     layer does, through the app's writers, past events refused.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { loopbackOrigin, checkServing, loopbackFetch } from "./vlm-local.mjs";

export const CHAT_MANIFEST_FORMAT = "merit-local-chat/1";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await import(pathToFileURL(path.join(REPO_ROOT, "src/assistant-reading.js")).href);
export const READING = globalThis.MeritAssistantReading;
export const MAX_TEXT = 400;

const str = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const realOrSelf = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

export function readChatManifest(file, { verify = true } = {}) {
  const fail = (code, problem) => ({ ok: false, code, problem });
  let m;
  try { m = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fail(e && e.code === "ENOENT" ? "CHAT_NOT_PINNED" : "CHAT_MANIFEST_INVALID", "the manifest could not be read as JSON"); }
  if (!m || typeof m !== "object" || m.format !== CHAT_MANIFEST_FORMAT) return fail("CHAT_MANIFEST_INVALID", `format must be "${CHAT_MANIFEST_FORMAT}"`);
  const id = str(m.id, 80), name = str(m.name, 120), version = str(m.version, 80), licence = str(m.licence, 160), source = str(m.source, 300), evidence = str(m.evidence, 300);
  if (!id || !/^[A-Za-z0-9._:-]+$/.test(id) || !name || !version || !licence || !source || !evidence) return fail("CHAT_MANIFEST_INVALID", "id, name, version, licence, source and evidence are all required");
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > 4) return fail("CHAT_MANIFEST_INVALID", "files must list 1 to 4 files");
  const dir = path.dirname(path.resolve(file)), files = [];
  for (const f of m.files) {
    if (!f || typeof f.path !== "string" || !Number.isSafeInteger(f.bytes) || f.bytes <= 0 || !/^[0-9a-f]{64}$/.test(String(f.sha256 || ""))) return fail("CHAT_MANIFEST_INVALID", "each file needs a path, a byte size and a sha256");
    const abs = path.resolve(dir, f.path);
    if (!abs.startsWith(dir + path.sep)) return fail("CHAT_MANIFEST_INVALID", "a file path leaves the manifest's directory");
    files.push({ path: f.path, abs, bytes: f.bytes, sha256: f.sha256 });
  }
  const sv = m.serve, listed = new Set(files.map((f) => f.path));
  const loraOk = sv && Array.isArray(sv.lora) && sv.lora.length <= 1 && sv.lora.every((l) => l && listed.has(l.path) && typeof l.scale === "number" && l.scale > 0 && l.scale <= 4);
  if (!sv || !listed.has(sv.model) || !loraOk || !Number.isSafeInteger(sv.ctx) || sv.ctx < 512 || sv.ctx > 65536) return fail("CHAT_MANIFEST_INVALID", "serve: { model, lora: [], ctx } must name pinned files");
  if (verify) for (const f of files) {
    let st;
    try { st = fs.statSync(f.abs); } catch { return fail("CHAT_MODEL_MISSING", `${f.path} is not on disk`); }
    if (st.size !== f.bytes) return fail("CHAT_MODEL_INTEGRITY", `${f.path} is ${st.size} bytes, not the pinned ${f.bytes}`);
    if (sha256File(f.abs) !== f.sha256) return fail("CHAT_MODEL_INTEGRITY", `${f.path} does not match its pinned sha256`);
  }
  const serveAt = { model: realOrSelf(path.resolve(dir, sv.model)), ctx: sv.ctx, lora: sv.lora.map((l) => ({ at: realOrSelf(path.resolve(dir, l.path)), scale: l.scale })) };
  return { ok: true, manifest: { id, name, version, licence, source, evidence, files: files.map(({ path: p, bytes, sha256 }) => ({ path: p, bytes, sha256 })) }, serveAt };
}

// The reader's configuration, or why there is none. Never throws.
export function readerFromEnv(env) {
  const raw = env.ASSISTANT_CHAT_URL || "", mf = env.ASSISTANT_CHAT_MANIFEST ? path.resolve(String(env.ASSISTANT_CHAT_MANIFEST)) : null;
  if (!raw && !mf) return { configured: false, reasonCode: "CHAT_OFF" };
  const origin = loopbackOrigin(raw);
  if (!origin) return { configured: false, reasonCode: raw ? "CHAT_NOT_LOOPBACK" : "CHAT_NO_URL" };
  const read = mf ? readChatManifest(mf) : { ok: false, code: "CHAT_NOT_PINNED", problem: "ASSISTANT_CHAT_MANIFEST is not set" };
  if (!read.ok) return { configured: false, reasonCode: read.code, problem: read.problem };
  return { configured: true, reasonCode: null, url: origin, manifest: read.manifest, serveAt: read.serveAt };
}

export function makeReader(cfg, { fetchImpl = loopbackFetch, timeoutMs = 120000 } = {}) {
  async function getJson(p, signal) {
    const r = await fetchImpl(cfg.url + p, { method: "GET", signal });
    return r.ok ? r.json() : null;
  }
  // Is the process the measured server? (vlm-local checkServing, the same rule.)
  async function verify(signal) {
    try {
      const [props, adapters] = await Promise.all([getJson("/props", signal), getJson("/lora-adapters", signal).catch(() => [])]);
      return checkServing({ serveAt: cfg.serveAt }, props, Array.isArray(adapters) ? adapters : []);
    } catch { return { ok: false, code: "CHAT_NOT_RUNNING", problem: "the chat model process does not answer" }; }
  }
  async function read(text, { signal } = {}) {
    const served = await verify(signal);
    if (!served.ok) return { ok: false, code: served.code };
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), timeoutMs);
    if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    try {
      const body = { messages: READING.messages(text), temperature: 0, max_tokens: 400, cache_prompt: false, chat_template_kwargs: { enable_thinking: false },
        response_format: { type: "json_schema", json_schema: { name: "reading", schema: READING.SCHEMA } } };
      const r = await fetchImpl(cfg.url + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      if (!r.ok) return { ok: false, code: "CHAT_ERROR" };
      const j = await r.json();
      let reading = null;
      try { reading = JSON.parse(j.choices[0].message.content); } catch { reading = null; }
      return { ok: true, reading: READING.valid(reading) ? reading : null };
    } catch { return { ok: false, code: ctrl.signal.aborted ? "CHAT_TIMEOUT" : "CHAT_NOT_RUNNING" }; }
    finally { clearTimeout(t); }
  }
  // A short small-talk reply (READING.chatMessages); plain text, at most 800
  // characters, nothing else taken from it.
  async function chat(text, { signal } = {}) {
    const served = await verify(signal);
    if (!served.ok) return { ok: false, code: served.code };
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), timeoutMs);
    if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    try {
      const body = { messages: READING.chatMessages(text), temperature: 0.3, max_tokens: 220, cache_prompt: false, chat_template_kwargs: { enable_thinking: false } };
      const r = await fetchImpl(cfg.url + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      if (!r.ok) return { ok: false, code: "CHAT_ERROR" };
      const j = await r.json();
      const reply = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim().slice(0, 800);
      return reply ? { ok: true, reply } : { ok: false, code: "CHAT_EMPTY" };
    } catch { return { ok: false, code: ctrl.signal.aborted ? "CHAT_TIMEOUT" : "CHAT_NOT_RUNNING" }; }
    finally { clearTimeout(t); }
  }
  return { read, chat, verify };
}
