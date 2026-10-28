// The F8 assistant's SECOND reader: can a local chat model place what the rules
// could not? (training/README.md "Chat-model race", pre-registered 2026-10-28.)
//
// A running llama-server (any chat model, optionally with a LoRA) is asked to read
// each sentence into the rules' own shape (src/assistant-parse.js parse():
// a question's intent / person / event words, or a command's writer steps),
// schema-constrained, temperature 0, thinking off. What it returns is then
// answered and carried out by the SAME code the panel uses (answer(),
// MeritAssistantActions with recording writers) and scored like
// tests/suites/assistant-parse.test.mjs: a question by the facts its answer must
// carry, a command by the exact writer calls (or that it asked / refused and
// changed nothing). A wrong writer call is a WRONG CHANGE.
//
// Three readings per set: rules alone, model alone, rules first then the model
// for what the rules left "unknown" (the product's design).
//
//   node training/assistant_race.mjs --port 8099 --label qwen4b --out OUT.json
//   node training/assistant_race.mjs --rules-only --out OUT.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of ["src/assistant-tools.js", "src/assistant-actions.js", "src/assistant-parse.js", "src/assistant-reading.js", "training/assistant/parse-at-race.js"]) await import(pathToFileURL(path.join(repo, f)).href);
// the rules as they were when the race was pre-registered (a frozen copy): later
// product fixes to the rules do not change what is measured here; answer() is the product's
const P = { ...globalThis.MeritAssistantParse, parse: globalThis.MeritAssistantParseAtRace.parse }, Tl = globalThis.MeritAssistantTools;
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes("--" + k);
const fx = JSON.parse(fs.readFileSync(path.join(repo, "training/assistant/fixture.json"), "utf8"));
const lines = (f) => fs.readFileSync(path.join(repo, "training/assistant", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// The facts each question's answer must carry (as assistant-parse.test.mjs), and
// the writer calls each command must make — the originals; a variant has its
// original's outcome (`sameAs`).
const MUST = {
  1: ["T12", "koltuk 4", "geldi"], 2: ["2 etkinliğimize", "Sezen Aksu", "Tarkan", "Mabel Matiz"], 3: ["2 kişi var", "Hangisi"], 4: ["T07", "koltuk 3"],
  5: ["3 kişi", "geldi"], 6: ["4 kişi geldi"], 7: ["Ahmet Yılmaz", "Zeynep Arslan", "Mehmet Kaya"], 8: ["0 etkinliğimize"], 9: ["kayıt yok"],
  10: ["Mabel Matiz", "T12", "gelmedi"], 11: ["T08", "gelmedi"], 12: ["T08", "T02"], 13: ["Evet", "VIP01"], 14: ["Ahmet Yılmaz"],
  15: ["Sezen Aksu", "5 kişi"], 16: ["Tarkan"], 17: ["Evet", "T08"], 18: ["T05", "koltuk 2"], 19: ["Ayşe Demir"], 20: ["kayıtlarda yok"],
};
const CMDS = Object.fromEntries(lines("commands.jsonl").map((c) => [c.id, c]));
const items = [
  ...lines("questions.jsonl").map((q) => ({ set: "original", id: "Q" + q.id, kind: "question", text: q.q, must: MUST[q.id] })),
  ...lines("commands.jsonl").map((c) => ({ set: "original", id: "C" + c.id, kind: "command", text: c.text, cmd: c })),
  ...lines("deep.jsonl").map((d) => ({ set: "deep", id: d.id, kind: d.gold.kind, text: d.text, gold: d.gold })),
  ...lines("variants.jsonl").map((v) => {
    const n = Number(v.sameAs.slice(1));
    return v.kind === "question" ? { set: "variant", id: v.id, kind: "question", text: v.text, must: MUST[n] } : { set: "variant", id: v.id, kind: "command", text: v.text, cmd: CMDS[n] };
  }),
];

// The instruction, worked examples, schema and conversion: one source with the
// relay (src/assistant-reading.js), so what is served is what was measured.
const R = globalThis.MeritAssistantReading;

async function ask(port, text) {
  // the fixed instruction and examples are kept in the server's prompt cache, as the relay asks (2026-10-28)
  const body = { messages: R.messages(text), temperature: 0, max_tokens: 400, cache_prompt: true, chat_template_kwargs: { enable_thinking: false },
    response_format: { type: "json_schema", json_schema: { name: "reading", schema: R.SCHEMA } } };
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  let got = null;
  try { got = JSON.parse(j.choices[0].message.content); } catch { got = null; }
  if (got && !R.valid(got)) got = null;   // the relay takes no reading outside the shape
  return { got, raw: j.choices && j.choices[0].message.content, seconds: (Date.now() - t0) / 1000 };
}
const toParse = (m) => R.toParse(m, fx.events, fx.today);
// A deep item's expected outcome is what its gold reading produces through the
// same code: the same answer text, or the same writer calls / ask / refusal.
function outcome(item, parsed) {
  if (item.kind === "question") {
    let a = { text: "" };
    try { a = parsed.kind === "question" ? P.answer(parsed, fx.events, fx.today, fx.current) : { text: "" }; } catch { a = { text: "" }; }
    return { text: a.text || "" };
  }
  const events = JSON.parse(JSON.stringify(fx.events)), calls = [];
  const gala = () => events.find((e) => e.id === fx.current);
  const rec = (name) => (...a) => { calls.push([name, ...a]); if (name === "addGuest") { gala().guests.push({ id: "new1", name: a[0], pax: a[1], assignment: null }); return "new1"; } };
  const A = globalThis.MeritAssistantActions.create({ events: () => events, current: () => fx.current, today: () => fx.today,
    canMutate: (e) => e.date >= fx.today && e.status !== "Completed",
    writers: { assign: rec("assign"), unassign: rec("unassign"), deleteGuest: rec("deleteGuest"), setPax: rec("setPax"), setVip: rec("setVip"), addGuest: rec("addGuest") },
    snapshot: () => null, registerUndo: () => {} });
  let out;
  try { out = parsed.kind === "command" ? A.run(parsed.plan) : { ask: "not understood" }; } catch (e) { out = { ask: String(e.message || e) }; }
  return { calls, kind: calls.length ? "calls" : out.refuse ? "refuse" : out.ask ? "ask" : "nothing" };
}
function score(item, parsed) {
  if (item.set === "deep") {
    const want = outcome(item, toParse(item.gold)), got = outcome(item, parsed);
    if (item.kind === "question") return { right: !!want.text && got.text === want.text, wrongChange: false, answer: got.text };
    const right = JSON.stringify(got.calls) === JSON.stringify(want.calls) && got.kind === want.kind;
    return { right, wrongChange: !right && got.calls.length > 0, calls: got.calls };
  }
  if (item.kind === "question") {
    let a = { text: "" };
    try { a = parsed.kind === "question" ? P.answer(parsed, fx.events, fx.today, fx.current) : { text: "" }; } catch (e) { a = { text: "" }; }
    return { right: item.must.every((w) => (a.text || "").includes(w)), wrongChange: false, answer: a.text || "" };
  }
  const events = JSON.parse(JSON.stringify(fx.events)), calls = [];
  const gala = () => events.find((e) => e.id === fx.current);
  const rec = (name) => (...a) => { calls.push([name, ...a]); if (name === "addGuest") { gala().guests.push({ id: "new1", name: a[0], pax: a[1], assignment: null }); return "new1"; } };
  const A = globalThis.MeritAssistantActions.create({ events: () => events, current: () => fx.current, today: () => fx.today,
    canMutate: (e) => e.date >= fx.today && e.status !== "Completed",
    writers: { assign: rec("assign"), unassign: rec("unassign"), deleteGuest: rec("deleteGuest"), setPax: rec("setPax"), setVip: rec("setVip"), addGuest: rec("addGuest") },
    snapshot: () => null, registerUndo: () => {} });
  let out;
  try { out = parsed.kind === "command" ? A.run(parsed.plan) : { ask: "not understood" }; } catch (e) { out = { ask: String(e.message || e) }; }
  const c = item.cmd;
  if (c.calls) {
    const want = c.calls.map((x) => x[0] === "assign" && x[1] === "<new>" ? ["assign", "new1", x[2], x[3]] : x);
    const right = JSON.stringify(calls) === JSON.stringify(want);
    return { right, wrongChange: !right && calls.length > 0, calls };
  }
  return { right: calls.length === 0 && (c.ask ? !!out.ask : !!out.refuse), wrongChange: calls.length > 0, calls };
}

const port = Number(arg("port", 8099)), label = arg("label", "rules"), rulesOnly = flag("rules-only");
const rows = [];
// Resumable: each sentence's model reading is kept as it comes (OUT.partial.jsonl);
// a restarted run asks only what is missing and scores everything again from the
// kept readings with this code.
const partialFile = arg("out") + ".partial.jsonl", kept = new Map();
if (!rulesOnly && fs.existsSync(partialFile)) for (const l of fs.readFileSync(partialFile, "utf8").split("\n")) { if (!l.trim()) continue; try { const k = JSON.parse(l); if (k.label === label) kept.set(k.id, k); } catch {} }
for (const it of items) {
  const rules = P.parse(it.text, fx.events, fx.today);
  const row = { set: it.set, id: it.id, text: it.text, rules: score(it, rules), rulesKind: rules.kind };
  if (!rulesOnly) {
    let m = kept.get(it.id);
    if (!m || m.text !== it.text) { m = { label, id: it.id, text: it.text, ...(await ask(port, it.text)) }; fs.appendFileSync(partialFile, JSON.stringify(m) + "\n"); }
    const mp = toParse(m.got);
    row.model = { ...score(it, mp), reading: m.got, seconds: m.seconds };
    row.both = rules.kind === "unknown" ? row.model : row.rules;
  }
  rows.push(row);
  process.stdout.write(`${it.id} rules:${row.rules.right ? "+" : "-"}${row.model ? ` model:${row.model.right ? "+" : "-"}${row.model.wrongChange ? "!" : ""} ${row.model.seconds.toFixed(1)}s` : ""}\n`);
}
const sum = (set, k) => {
  const rs = rows.filter((r) => r.set === set && r[k]);
  return rs.length ? { n: rs.length, right: +(rs.filter((r) => r[k].right).length / rs.length).toFixed(3), wrongChanges: rs.filter((r) => r[k].wrongChange).length } : null;
};
const secs = rows.filter((r) => r.model).map((r) => r.model.seconds).sort((a, b) => a - b);
const summary = { label, at: new Date().toISOString(),
  original: { rules: sum("original", "rules"), model: sum("original", "model"), both: sum("original", "both") },
  variant: { rules: sum("variant", "rules"), model: sum("variant", "model"), both: sum("variant", "both") },
  deep: { rules: sum("deep", "rules"), model: sum("deep", "model"), both: sum("deep", "both") },
  medianSeconds: secs.length ? secs[Math.floor(secs.length / 2)] : null };
fs.writeFileSync(arg("out"), JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary));
