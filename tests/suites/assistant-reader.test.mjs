// The F8 assistant's SECOND reader (server/assistant-reader.mjs, POST
// /vlm-relay/read, src/assistant-reading.js, the panel).
//
// NO MODEL RUNS HERE. The chat process is a scripted fake in this file: a pass
// proves the plumbing and the rules, never how well a model reads (that is
// training/assistant_race.mjs on real models).
//
// What this pins:
//   PINNED AND MEASURED. A reader needs a manifest naming its files (size,
//     sha256), how the measured server ran and the race result that chose it;
//     a loopback URL only; before every reading the process must be that server.
//   THE MEASURED REQUEST. What is sent is word for word what the race measured:
//     MeritAssistantReading's instruction, worked examples and schema, the
//     sentence last, temperature 0, thinking off.
//   A READING OR NOTHING. A reply outside the schema is no reading; a request
//     with any other field, too long, or from another site is refused before
//     the model is called.
//   SMALL TALK IS MARKED. What neither the rules nor the reader place gets the
//     same model's short reply, marked as not resting on the records; it
//     changes nothing.
//   RULES FIRST. The panel asks the reader only when the rules say "unknown";
//     the reading is answered and acted on by the same code — a command is done
//     at once, says the language model read it, and is one undo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { openApp, createBlankEvent, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "assistant-reader", tags: ["assistant", "security", "fast"], timeout: 180000 };

export default async function run({ page, checks, repoRoot }) {
  const core = await import(path.join(repoRoot, "server/vlm-core.mjs"));
  const { startRelay } = await import(path.join(repoRoot, "server/vlm-relay.mjs"));
  const RD = await import(path.join(repoRoot, "server/assistant-reader.mjs"));
  await import(pathToFileURL(path.join(repoRoot, "src/assistant-reading.js")).href);
  const R = globalThis.MeritAssistantReading;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-reader-"));
  const files = { "chat.gguf": crypto.randomBytes(4096) };
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(tmp, n), b);
  const manifest = (over = {}) => ({ format: "merit-local-chat/1", id: "fake-chat", name: "Scripted chat", version: "0-test", licence: "test",
    source: "tests/suites/assistant-reader.test.mjs", evidence: "scripted", serve: { model: "chat.gguf", lora: [], ctx: 4096 },
    files: Object.entries(files).map(([p, b]) => ({ path: p, bytes: b.length, sha256: crypto.createHash("sha256").update(b).digest("hex") })), ...over });
  const write = (n, m) => { const f = path.join(tmp, n); fs.writeFileSync(f, JSON.stringify(m)); return f; };
  const good = write("chat.json", manifest());

  // ---- configuration ---------------------------------------------------------------
  const env = (url, mf) => RD.readerFromEnv({ ASSISTANT_CHAT_URL: url, ASSISTANT_CHAT_MANIFEST: mf });
  checks.equal([
    RD.readerFromEnv({}).reasonCode,
    env("http://192.168.1.5:8097", good).reasonCode,
    env("http://127.0.0.1:8097", write("noev.json", manifest({ evidence: undefined }))).reasonCode,
    env("http://127.0.0.1:8097", write("bad.json", manifest({ files: [{ path: "chat.gguf", bytes: 4096, sha256: "0".repeat(64) }] }))).reasonCode,
    env("http://127.0.0.1:8097", good).configured,
  ], ["CHAT_OFF", "CHAT_NOT_LOOPBACK", "CHAT_MANIFEST_INVALID", "CHAT_MODEL_INTEGRITY", true],
  "a reader is on only with a loopback URL and a manifest whose files match and that names its evidence");

  // ---- a scripted chat process -------------------------------------------------------
  const sent = [];
  let props = { model_path: fs.realpathSync(path.join(tmp, "chat.gguf")), default_generation_settings: { n_ctx: 4096 } };
  let replyWith = null;
  const fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/props") return res.end(JSON.stringify(props));
      if (req.url === "/lora-adapters") return res.end("[]");
      if (req.url === "/v1/chat/completions") { const b = JSON.parse(body); sent.push(b); return res.end(JSON.stringify({ choices: [{ message: { content: typeof replyWith === "function" ? replyWith(b) : replyWith } }] })); }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${fake.address().port}`;
  const reader = env(url, good);
  const config = core.configFromEnv({ VLM_DATA_DIR: path.join(tmp, "data"), PORT: "0" }, { repoRoot });
  const relay = await startRelay({ config, client: { models: {}, beta: { messages: {} } }, log: { log: () => {}, error: () => {} }, reader });
  const post = (b, headers = { "x-merit-relay": "1" }) => fetch(relay.baseUrl + "/vlm-relay/read", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(b) })
    .then(async (x) => ({ http: x.status, json: await x.json().catch(() => null) }));
  const reading = { kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null,
    steps: [{ op: "assign", guest: "Zeynep Arslan", table: "T05", from: null, other: null, name: null, pax: null, fromTable: null }] };
  try {
    const st = await fetch(relay.baseUrl + "/vlm-relay/status").then((x) => x.json());
    checks.equal([st.reader.configured, st.reader.name], [true, "Scripted chat"], "status names the reader");
    replyWith = JSON.stringify(reading);
    const a = await post({ text: "Zeynep Arslan T05 masasına geçsin" });
    checks.equal([a.http, a.json.ok, a.json.reading], [200, true, reading], "a sentence comes back as the model's reading in the rules' shape");
    const req0 = sent[0];
    checks.ok(JSON.stringify(req0.messages) === JSON.stringify(R.messages("Zeynep Arslan T05 masasına geçsin")) && req0.temperature === 0
      && req0.chat_template_kwargs.enable_thinking === false && JSON.stringify(req0.response_format.json_schema.schema) === JSON.stringify(R.SCHEMA),
      "the request is the measured one: the shared instruction, examples and schema, the sentence last, temperature 0, thinking off");
    replyWith = JSON.stringify({ ...reading, answer: "Tamam, yaptım" });
    const off = await post({ text: "Zeynep Arslan T05 masasına geçsin" });
    replyWith = "Elbette! Zeynep'i taşıdım.";
    const prose = await post({ text: "Zeynep Arslan T05 masasına geçsin" });
    checks.equal([off.json.reading, prose.json.reading], [null, null], "a reply outside the schema — an extra field, or words — is no reading");
    const n = sent.length;
    const refused = [
      (await post({ text: "x", note: "y" })).json.code,
      (await post({ text: "a".repeat(401) })).json.code,
      (await post({ text: "Zeynep" }, {})).json.code,
    ];
    checks.equal([refused, sent.length - n], [["UNKNOWN_FIELD", "BAD_PAYLOAD", "CROSS_SITE"], 0], "another field, a long text or another site is refused before the model is called");
    props = { ...props, default_generation_settings: { n_ctx: 2048 } };
    const wrong = await post({ text: "Zeynep Arslan T05 masasına geçsin" });
    checks.equal([wrong.http, wrong.json.code, sent.length - n], [409, "LOCAL_SERVER_MISMATCH", 0], "a process that is not the measured server reads nothing");
    props = { ...props, default_generation_settings: { n_ctx: 4096 } };

    // ---- a model trained on the short instruction is asked with it ------------------
    const shortReader = env(url, write("short.json", manifest({ serve: { model: "chat.gguf", lora: [], ctx: 4096, prompt: "short" } })));
    const relay2 = await startRelay({ config, client: { models: {}, beta: { messages: {} } }, log: { log: () => {}, error: () => {} }, reader: shortReader });
    try {
      replyWith = JSON.stringify(reading);
      const s = await fetch(relay2.baseUrl + "/vlm-relay/read", { method: "POST", headers: { "content-type": "application/json", "x-merit-relay": "1" }, body: JSON.stringify({ text: "Zeynep Arslan T05 masasına geçsin" }) }).then((x) => x.json());
      const reqS = sent[sent.length - 1];
      checks.ok(s.ok && reqS.messages.length === 2 && reqS.messages[0].content === R.SYSTEM_SHORT && reqS.messages[1].content === "Zeynep Arslan T05 masasına geçsin"
        && JSON.stringify(reqS.messages) === JSON.stringify(R.messages("Zeynep Arslan T05 masasına geçsin", { prompt: "short" })),
        "a manifest that says the model was trained on the short instruction is asked with exactly that (no worked examples)");
      checks.equal(env(url, write("badprompt.json", manifest({ serve: { model: "chat.gguf", lora: [], ctx: 4096, prompt: "long" } }))).reasonCode, "CHAT_MANIFEST_INVALID",
        "serve.prompt is \"full\" or \"short\", nothing else");
    } finally { await relay2.close(); }

    // ---- the panel: rules first, then the reader, then the same acting code -------
    replyWith = JSON.stringify(reading);
    await openApp(page, relay.baseUrl, { lang: "tr" });
    await createBlankEvent(page, { name: "Gala", date: futureDate() });
    await page.evaluate(() => {
      const e = activeEvent();
      e.tables.push({ id: "t05", number: "T05", shape: "round", capacity: 10, chairs: [], x: 100, y: 100, w: 80, h: 80, rotation: 0 });
      e.guests.push({ id: "gz", name: "Zeynep Arslan", additionalGuests: 0, pax: 1, planningStatus: "Confirmed", vip: "Standard", invitedBy: "", notes: "", arrivalStatus: "Not Arrived", checkedInAt: null, assignment: null, createdAt: new Date().toISOString() });
      render();
    });
    await settle(page);
    await page.keyboard.press("F8");
    await page.waitForSelector("#assistantPanel:not([hidden])");
    const say = async (text) => {
      await page.fill("#assistantInput", text);
      await page.press("#assistantInput", "Enter");
      await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 20000 });
      await settle(page);
      return page.evaluate(() => [...document.querySelectorAll(".assistant-turn.assistant")].pop().innerText);
    };
    const before = sent.length;
    const last = await say("Zeynep Arslan T05 masasına geçsin");
    const seat = await page.evaluate(() => { const g = activeEvent().guests.find((x) => x.id === "gz"); return g.assignment && g.assignment.tableId; });
    checks.ok(seat === "t05" && /dil modeli okudu/.test(last) && /T05/.test(last) && sent.length === before + 1,
      "the rules could not place it; the reader did, the same acting code seated her at once, and the panel says the language model read it", { seat, last });
    await page.locator(".assistant-undo").last().click();
    await settle(page);
    checks.equal(await page.evaluate(() => activeEvent().guests.find((x) => x.id === "gz").assignment), null, "one Geri al takes it back");
    const n2 = sent.length;
    await say("Zeynep Arslan'ı T05'e oturt");
    checks.equal(sent.length, n2, "a sentence the rules read never goes to the model");
    await page.evaluate(() => { const g = activeEvent().guests.find((x) => x.id === "gz"); unassignGuest(g.id); });

    // small talk: the reader finds nothing to read, the same model replies, marked
    replyWith = (b) => b.response_format ? JSON.stringify({ kind: "unknown", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [] }) : "Merhaba! Yoğun bir gün olmalı, kolay gelsin.";
    const n3 = sent.length;
    const chatSaid = await say("Merhaba, nasılsın?");
    const chatReq = sent[sent.length - 1];
    checks.ok(/kolay gelsin/.test(chatSaid) && /kayıtlarına dayanmaz/.test(chatSaid) && sent.length === n3 + 2 && !chatReq.response_format
      && JSON.stringify(chatReq.messages) === JSON.stringify(R.chatMessages("Merhaba, nasılsın?")),
      "small talk: no reading, so the model's short reply is shown, marked as not resting on the records", { chatSaid });
    checks.equal(await page.evaluate(() => activeEvent().guests.find((x) => x.id === "gz").assignment), null, "small talk changes nothing");
  } finally {
    await relay.close();
    await new Promise((r) => fake.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
