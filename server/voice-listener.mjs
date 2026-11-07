// MERIT Event Maker — voice command for the F8 assistant (Mimar): speech to TEXT, on this machine.
//
//   MERIT_VOICE_MANIFEST=/path/to/merit-local-voice.json npm run serve:vlm
//
// The page records a short spoken command, turns it into 16 kHz mono 16-bit WAV
// (src/voice-input.js) and posts it to POST /vlm-relay/listen?lang=tr|en. The
// relay hands the clip to a speech-to-text ENGINE ON THIS MACHINE (whisper.cpp's
// whisper-cli, a pinned exe + a pinned model file) and returns the words. The
// words go into the F8 box; the person reads them and presses Enter. Voice never
// acts by itself — the assistant's rules and writers stay the only way to the plan.
//
// What is structural, not promised:
//   LOCAL ONLY. The engine is a file next to the manifest, run directly (no shell)
//     with a stripped environment; whisper-cli has no network code. Nothing in this
//     module opens a socket.
//   PINNED. The manifest names the engine exe and the model (size, sha256), their
//     source, licence and the measurement that chose them (`evidence`, see
//     training/README.md "Voice command"). Missing or changed file → no listening.
//   A CLIP, NOTHING ELSE. Only RIFF/WAVE PCM 16-bit, mono, 16 kHz, 0.3–30 s; the
//     clip is written to a private temp dir and deleted in every outcome.
//   NOTHING LOGGED BUT THE OUTCOME. A spoken command may name a guest: the text and
//     the audio never reach a log line or the disk beyond the temp file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

export const VOICE_MANIFEST_FORMAT = "merit-local-voice/1";
export const LANGS = ["tr", "en"];
export const MAX_SECONDS = 30;
export const MIN_SECONDS = 0.3;
export const SAMPLE_RATE = 16000;
export const MAX_BYTES = 44 + MAX_SECONDS * SAMPLE_RATE * 2 + 1024;
export const MAX_TEXT = 400;           // the F8 box's limit (server/assistant-reader.mjs MAX_TEXT)

const str = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

export function readVoiceManifest(file, { verify = true } = {}) {
  const fail = (code, problem) => ({ ok: false, code, problem });
  let m;
  try { m = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fail(e && e.code === "ENOENT" ? "VOICE_NOT_PINNED" : "VOICE_MANIFEST_INVALID", "the manifest could not be read as JSON"); }
  if (!m || typeof m !== "object" || m.format !== VOICE_MANIFEST_FORMAT) return fail("VOICE_MANIFEST_INVALID", `format must be "${VOICE_MANIFEST_FORMAT}"`);
  const id = str(m.id, 80), name = str(m.name, 120), version = str(m.version, 80), licence = str(m.licence, 200), source = str(m.source, 300), evidence = str(m.evidence, 300);
  if (!id || !/^[A-Za-z0-9._:-]+$/.test(id) || !name || !version || !licence || !source || !evidence) return fail("VOICE_MANIFEST_INVALID", "id, name, version, licence, source and evidence are all required");
  if (!Array.isArray(m.files) || m.files.length < 2 || m.files.length > 8) return fail("VOICE_MANIFEST_INVALID", "files must list the engine, its libraries and the model (2 to 8 files)");
  const dir = path.dirname(path.resolve(file)), files = [];
  for (const f of m.files) {
    if (!f || typeof f.path !== "string" || !Number.isSafeInteger(f.bytes) || f.bytes <= 0 || !/^[0-9a-f]{64}$/.test(String(f.sha256 || ""))) return fail("VOICE_MANIFEST_INVALID", "each file needs a path, a byte size and a sha256");
    const abs = path.resolve(dir, f.path);
    if (!abs.startsWith(dir + path.sep)) return fail("VOICE_MANIFEST_INVALID", "a file path leaves the manifest's directory");
    files.push({ path: f.path, abs, bytes: f.bytes, sha256: f.sha256 });
  }
  const sv = m.serve, listed = new Set(files.map((f) => f.path));
  const langsOk = sv && Array.isArray(sv.languages) && sv.languages.length && sv.languages.every((l) => LANGS.includes(l));
  if (!sv || !listed.has(sv.engine) || !listed.has(sv.model) || sv.engine === sv.model || !langsOk || !Number.isSafeInteger(sv.threads) || sv.threads < 1 || sv.threads > 16)
    return fail("VOICE_MANIFEST_INVALID", "serve: { engine, model, languages, threads } must name pinned files and tr/en");
  if (verify) for (const f of files) {
    let st;
    try { st = fs.statSync(f.abs); } catch { return fail("VOICE_MODEL_MISSING", `${f.path} is not on disk`); }
    if (st.size !== f.bytes) return fail("VOICE_MODEL_INTEGRITY", `${f.path} is ${st.size} bytes, not the pinned ${f.bytes}`);
    if (sha256File(f.abs) !== f.sha256) return fail("VOICE_MODEL_INTEGRITY", `${f.path} does not match its pinned sha256`);
  }
  return { ok: true, manifest: { id, name, version, licence, source, evidence, languages: sv.languages.slice(), files: files.map(({ path: p, bytes, sha256 }) => ({ path: p, bytes, sha256 })) },
    serveAt: { engine: path.resolve(dir, sv.engine), model: path.resolve(dir, sv.model), threads: sv.threads, languages: sv.languages.slice() } };
}

// The listener's configuration, or why there is none. Never throws. Off unless a manifest is named.
export function listenerFromEnv(env) {
  const mf = env.MERIT_VOICE_MANIFEST ? path.resolve(String(env.MERIT_VOICE_MANIFEST)) : null;
  if (!mf || String(env.MERIT_VOICE_MANIFEST).toLowerCase() === "off") return { configured: false, reasonCode: "VOICE_OFF" };
  const read = readVoiceManifest(mf);
  if (!read.ok) return { configured: false, reasonCode: read.code, problem: read.problem };
  return { configured: true, reasonCode: null, manifest: read.manifest, serveAt: read.serveAt };
}

// Is this buffer the one shape we accept? Returns { ok, seconds } or { ok:false, code }.
export function checkWav(buf) {
  const bad = { ok: false, code: "BAD_AUDIO" };
  if (!Buffer.isBuffer(buf) || buf.length < 44 || buf.length > MAX_BYTES) return buf && buf.length > MAX_BYTES ? { ok: false, code: "AUDIO_TOO_LONG" } : bad;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return bad;
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4), size = buf.readUInt32LE(off + 4), body = off + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= buf.length) fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    if (id === "data") { data = { bytes: Math.min(size, buf.length - body) }; break; }
    off = body + size + (size & 1);
  }
  if (!fmt || !data || fmt.format !== 1 || fmt.channels !== 1 || fmt.rate !== SAMPLE_RATE || fmt.bits !== 16) return bad;
  const seconds = data.bytes / (SAMPLE_RATE * 2);
  if (seconds > MAX_SECONDS) return { ok: false, code: "AUDIO_TOO_LONG" };
  if (seconds < MIN_SECONDS) return { ok: false, code: "AUDIO_TOO_SHORT" };
  return { ok: true, seconds };
}

// whisper-cli prints the words, sometimes with tags for non-speech ([BLANK_AUDIO],
// (müzik), [Music]). Keep words only, on one line, at most the F8 box's length.
export function cleanTranscript(raw) {
  return String(raw || "")
    .replace(/\[[^\]\n]{0,40}\]|\([^)\n]{0,40}\)|\*[^*\n]{0,40}\*/g, " ")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

// The default runner: the pinned exe, no shell, a stripped environment, a timeout.
function runEngine(file, args, { timeoutMs, signal }) {
  return new Promise((resolve) => {
    const env = { PATH: "", LANG: "C.UTF-8" };
    if (process.platform === "win32") env.SystemRoot = process.env.SystemRoot || "C:\\Windows";
    const child = execFile(file, args, { env, timeout: timeoutMs, maxBuffer: 1 << 20, windowsHide: true, encoding: "utf8", signal }, (err, stdout) => {
      if (err) resolve({ ok: false, code: err.name === "AbortError" ? "VOICE_CANCELLED" : err.killed ? "VOICE_TIMEOUT" : "VOICE_ENGINE_FAILED" });
      else resolve({ ok: true, stdout });
    });
    child.stdin && child.stdin.end();
  });
}

export function makeListener(cfg, { run = runEngine, timeoutMs = 60000, tmpRoot = os.tmpdir() } = {}) {
  async function listen(wav, { lang, signal } = {}) {
    if (!cfg.serveAt.languages.includes(lang)) return { ok: false, code: "BAD_LANGUAGE" };
    const shape = checkWav(wav);
    if (!shape.ok) return shape;
    let dir = null;
    try {
      dir = fs.mkdtempSync(path.join(tmpRoot, "merit-voice-"));
      const clip = path.join(dir, "clip.wav");
      fs.writeFileSync(clip, wav, { mode: 0o600 });
      const args = ["-m", cfg.serveAt.model, "-f", clip, "-l", lang, "-nt", "-np", "-t", String(cfg.serveAt.threads)];
      const r = await run(cfg.serveAt.engine, args, { timeoutMs, signal });
      if (!r.ok) return { ok: false, code: r.code || "VOICE_ENGINE_FAILED" };
      const text = cleanTranscript(r.stdout);
      return text ? { ok: true, text, seconds: shape.seconds } : { ok: false, code: "NOTHING_HEARD" };
    } catch { return { ok: false, code: "VOICE_ENGINE_FAILED" }; }
    finally { if (dir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the OS temp cleaner */ } }
  }
  return { listen };
}
