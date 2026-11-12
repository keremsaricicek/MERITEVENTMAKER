// MIMAR'S SECOND READER: rules first, the local model's reading as a proposal,
// honest when the model is missing (src/assistant-second-reader.js, the
// relay's GET /vlm-relay/status `reader.serving`).
//
// SCRIPTED. The "chat model" here is a fake llama-server in this file: a pass
// proves the policy and the plumbing, never how well any model reads (that is
// training/assistant_race.mjs on real models, training/README.md).
//
// What this pins:
//   RULES FIRST. The model is asked only where the rules read nothing.
//   A READING IS A PROPOSAL. A change the model read always waits for Uygula —
//     a door check-in included; only a door check-in the RULES read is immediate.
//   HONEST WHEN MISSING. No relay, no pinned reader, a process that does not
//     answer or is not the measured server: each is named as such, never as a
//     reading or as "not understood".
//   THE MEASURED SERVER, LIVE. The relay's status says the reader is serving
//     only after asking the running process (/props, /lora-adapters) — the same
//     rule the local second look (/vlm-relay/ask) uses — and never calls the
//     model for it.
//   NOTHING ELSE LEAVES. The request is { text } only, to a same-origin path.
// Mutation proof, recorded 2026-11-12: before src/assistant-second-reader.js and
// `reader.serving` existed, every check below failed (module missing; status had
// no `serving`).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

export const meta = { name: "assistant-second-reader", tags: ["assistant", "security", "fast"], timeout: 60000 };

export default async function run({ checks, repoRoot }) {
  const file = path.join(repoRoot, "src/assistant-second-reader.js");
  checks.ok(fs.existsSync(file), "src/assistant-second-reader.js exists");
  if (!fs.existsSync(file)) return;
  await import(pathToFileURL(file).href);
  const S = globalThis.MeritAssistantSecondReader;
  checks.ok(!!S && Object.isFrozen(S), "MeritAssistantSecondReader is published, frozen");
  if (!S) return;

  // ---- the hybrid order q08 was raced and shipped with ------------------------------------
  // training/assistant_race.mjs `--order hybrid --theta 0.91`: the model's reading when it read something
  // and (the rules read nothing or it is sure); otherwise the rules' reading if they have one.
  checks.ok(typeof S.asksModel === "function" && typeof S.choose === "function" && typeof S.needsModel === "undefined",
    "the policy is the hybrid order (asksModel + choose), not rules-first");
  if (typeof S.asksModel !== "function" || typeof S.choose !== "function") return;
  const doorCmd = { kind: "command", plan: [{ op: "arrive", guest: "A" }] };
  checks.equal([S.asksModel({ kind: "unknown" }), S.asksModel({ kind: "command", plan: [{ op: "assign" }] }), S.asksModel({ kind: "question" }), S.asksModel(doorCmd), S.asksModel(null)],
    [true, true, true, false, false], "the model reads every sentence except a door check-in the rules read (a plain statement)");
  const race = (rulesKind, modelKind, sure) => (modelKind && modelKind !== "unknown" && (rulesKind === "unknown" || sure)) ? "model" : rulesKind !== "unknown" ? "rules" : "none";
  const grid = [];
  for (const rk of ["unknown", "command", "question"]) for (const mk of [null, "unknown", "command"]) for (const sure of [false, true]) grid.push([rk, mk, sure]);
  checks.equal(grid.map(([rk, mk, sure]) => S.choose(rk, mk, sure)), grid.map(([rk, mk, sure]) => race(rk, mk, sure)),
    "choose() is the race's hybrid formula on every combination (rules kind × model kind × sure)");
  checks.equal([S.choose("command", "command", false), S.choose("command", "command", true), S.choose("unknown", "command", false), S.choose("command", null, true)],
    ["rules", "model", "model", "rules"], "an unsure reading yields to the rules; a sure one wins; with no rules reading the model's is used");

  // ---- a reading is a proposal -----------------------------------------------------------
  const door = [{ op: "arrive", guest: "A" }], move = [{ op: "assign", guest: "A", table: "T05" }];
  checks.equal([S.mustShow(door, false), S.mustShow(door, true), S.mustShow(move, false), S.mustShow(move, true), S.mustShow([], false)],
    [false, true, true, true, true], "only a door check-in the rules read is immediate; everything the model read waits for Uygula");

  // ---- the request ----------------------------------------------------------------------
  checks.equal([S.ENDPOINT, S.request("  Zeynep T05'e  "), S.request(""), S.request("a".repeat(401)), S.request({ text: "x" })],
    ["/vlm-relay/read", { text: "Zeynep T05'e" }, null, null, null], "the request is the sentence only, to the relay's same-origin path");
  const src = fs.readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
  checks.ok(!/https?:\/\//.test(src) && !/fetch\s*\(|XMLHttpRequest|api[_-]?key|anthropic/i.test(src), "the module names no host, makes no request and carries no key");

  // ---- outcomes ---------------------------------------------------------------------------
  const reading = { kind: "command", steps: [] };
  const o = (r) => { const x = S.outcome(r); return x.state === "missing" ? `${x.why}:${x.code}` : x.state; };
  checks.equal([
    o({ relay: false }), o({ error: "TypeError" }), o({ http: 404, body: null }),
    o({ http: 200, body: { ok: true, reading, sure: true } }), o({ http: 200, body: { ok: true, reading: null } }),
    o({ http: 409, body: { ok: false, code: "CHAT_OFF" } }), o({ http: 409, body: { ok: false, code: "CHAT_MODEL_INTEGRITY" } }),
    o({ http: 409, body: { ok: false, code: "CHAT_NOT_RUNNING" } }), o({ http: 409, body: { ok: false, code: "LOCAL_SERVER_MISMATCH" } }), o({ http: 409, body: { ok: false, code: "BUSY" } }),
  ], ["norelay:null", "down:CHAT_NOT_RUNNING", "norelay:null", "reading", "none", "off:CHAT_OFF", "off:CHAT_MODEL_INTEGRITY", "down:CHAT_NOT_RUNNING", "down:LOCAL_SERVER_MISMATCH", "down:BUSY"],
  "each relay reply is a reading, no reading, or a NAMED reason the model did not read");
  checks.equal(S.outcome({ http: 200, body: { ok: true, reading, sure: true } }), { state: "reading", reading, sure: true }, "a reading comes through as it was read");
  checks.equal([S.notice(S.outcome({ relay: false })).key, S.notice(S.outcome({ http: 409, body: { code: "CHAT_OFF" } })).key, S.notice(S.outcome({ error: "x" })).key, S.notice({ state: "reading" })],
    ["assistant.modelNoRelay", "assistant.modelOff", "assistant.modelDown", null], "each missing reason has its own words");
  const I18N = fs.readFileSync(path.join(repoRoot, "src/i18n.js"), "utf8");
  for (const k of ["assistant.modelNoRelay", "assistant.modelOff", "assistant.modelDown", "assistant.readyRules"])
    checks.ok(new RegExp(`"${k.replace(".", "\\.")}":\\s*\\{\\s*en:\\s*"[^"]+",\\s*tr:\\s*"[^"]+"`).test(I18N), `${k} has English and Turkish words`);
  checks.equal([
    S.fromStatus(false, { ok: true, reader: { configured: true } }).why,
    S.fromStatus(true, { ok: true, reader: { configured: false, reasonCode: "CHAT_NOT_PINNED" } }).code,
    S.fromStatus(true, { ok: true, reader: { configured: true, name: "m", serving: "CHAT_NOT_RUNNING" } }).why,
    S.fromStatus(true, { ok: true, reader: { configured: true, name: "m", serving: "verified" } }).state,
  ], ["norelay", "CHAT_NOT_PINNED", "down", "on"], "the panel's head reads the relay's status the same way");

  // ---- the relay: reader.serving is a live check of the measured server (SCRIPTED fake) ----
  const core = await import(path.join(repoRoot, "server/vlm-core.mjs"));
  const { startRelay } = await import(path.join(repoRoot, "server/vlm-relay.mjs"));
  const RD = await import(path.join(repoRoot, "server/assistant-reader.mjs"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-second-reader-"));
  const bytes = crypto.randomBytes(2048);
  fs.writeFileSync(path.join(tmp, "chat.gguf"), bytes);
  fs.writeFileSync(path.join(tmp, "chat.json"), JSON.stringify({ format: "merit-local-chat/1", id: "scripted-chat", name: "SCRIPTED chat", version: "0-test", licence: "test",
    source: "tests/suites/assistant-second-reader.test.mjs", evidence: "SCRIPTED — not a model", serve: { model: "chat.gguf", lora: [], ctx: 4096, prompt: "short" },
    files: [{ path: "chat.gguf", bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") }] }));
  const asked = [];
  let props = { model_path: fs.realpathSync(path.join(tmp, "chat.gguf")), default_generation_settings: { n_ctx: 4096 } }, up = true;
  const fake = http.createServer((req, res) => {
    asked.push(req.url);
    if (!up) { res.destroy(); return; }
    res.setHeader("content-type", "application/json");
    if (req.url === "/props") return res.end(JSON.stringify(props));
    if (req.url === "/lora-adapters") return res.end("[]");
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const config = core.configFromEnv({ VLM_DATA_DIR: path.join(tmp, "data"), PORT: "0" }, { repoRoot });
  const quiet = { log: () => {}, error: () => {} };
  const reader = RD.readerFromEnv({ ASSISTANT_CHAT_URL: `http://127.0.0.1:${fake.address().port}`, ASSISTANT_CHAT_MANIFEST: path.join(tmp, "chat.json") });
  const relay = await startRelay({ config, client: { models: {}, beta: { messages: {} } }, log: quiet, reader });
  const off = await startRelay({ config, client: { models: {}, beta: { messages: {} } }, log: quiet });
  const status = (r) => fetch(r.baseUrl + "/vlm-relay/status").then((x) => x.json());
  try {
    checks.ok(reader.configured, "the scripted reader is configured (loopback, pinned file)");
    const s1 = await status(relay);
    checks.equal([s1.reader.serving, S.fromStatus(true, s1).state], ["verified", "on"], "the running process is the measured server: serving verified");
    checks.ok(asked.includes("/props") && !asked.includes("/v1/chat/completions"), "status asks the process what it loaded and never calls the model", asked);
    props = { ...props, default_generation_settings: { n_ctx: 2048 } };
    const s2 = await status(relay);
    checks.equal([s2.reader.serving, S.fromStatus(true, s2).why], ["LOCAL_SERVER_MISMATCH", "down"], "another context than the measured one: not serving, said so");
    up = false;
    const s3 = await status(relay);
    checks.equal([s3.reader.configured, S.fromStatus(true, s3).why], [true, "down"], "a process that does not answer: configured but down, said so");
    checks.ok(s3.reader.serving && s3.reader.serving !== "verified", "…with its reason", s3.reader);
    const s4 = await status(off);
    checks.equal([s4.reader.configured, s4.reader.serving, S.fromStatus(true, s4).why], [false, undefined, "off"], "no reader set up: off, nothing is asked");
    const r4 = await fetch(off.baseUrl + "/vlm-relay/read", { method: "POST", headers: { "content-type": "application/json", "x-merit-relay": "1" }, body: JSON.stringify({ text: "x" }) });
    checks.equal(S.outcome({ http: r4.status, body: await r4.json() }).why, "off", "and /vlm-relay/read with no reader reads as 'off', not as a reading");
  } finally {
    await relay.close(); await off.close();
    await new Promise((r) => fake.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
