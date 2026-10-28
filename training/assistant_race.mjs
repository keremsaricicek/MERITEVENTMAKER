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
for (const f of ["src/assistant-tools.js", "src/assistant-actions.js", "src/assistant-parse.js"]) await import(pathToFileURL(path.join(repo, f)).href);
const P = globalThis.MeritAssistantParse, Tl = globalThis.MeritAssistantTools;
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
  ...lines("variants.jsonl").map((v) => {
    const n = Number(v.sameAs.slice(1));
    return v.kind === "question" ? { set: "variant", id: v.id, kind: "question", text: v.text, must: MUST[n] } : { set: "variant", id: v.id, kind: "command", text: v.text, cmd: CMDS[n] };
  }),
];

const INTENTS = ["seatAt", "attended", "sameTable", "vipBefore", "mostPeople", "eventCount", "unassigned", "noShow", "whoAtTable", "whichEvent"];
const OPS = ["assign", "copySeat", "nextTo", "moveTable", "unassign", "deleteGuest", "setPax", "setVip", "addGuest"];
const S = { type: ["string", "null"] }, I = { type: ["integer", "null"] };
const SCHEMA = { type: "object", additionalProperties: false, required: ["kind", "intent", "person", "phone", "event", "many", "table", "steps"], properties: {
  kind: { enum: ["question", "command", "unknown"] }, intent: { enum: [...INTENTS, null] }, person: S, phone: S, event: S, many: { type: "boolean" }, table: S,
  steps: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["op", "guest", "table", "from", "other", "name", "pax", "fromTable"],
    properties: { op: { enum: OPS }, guest: S, table: S, from: S, other: S, name: S, pax: I, fromTable: S } } } } };
const SYSTEM = `Sen bir etkinlik yönetim programındaki asistanın okuyucususun. Kullanıcının cümlesini oku ve SADECE JSON ver; cevap verme, bilgi uydurma.
kind: "question" (geçmiş/şimdiki etkinlikler hakkında soru), "command" (açık etkinlikte misafir/masa değişikliği), "unknown" (anlamadıysan).
Soru ise intent:
- seatAt: bir kişi bir etkinlikte nerede oturdu / oturacak / geldi mi / kaç kişiyle geldi (person, event; birden çok etkinlik soruluyorsa many=true)
- attended: bir kişi kaç / hangi etkinliğimize geldi (person)
- sameTable: kişi hep aynı masada mı oturdu (person)
- vipBefore: kişi daha önce VIP masada oturdu mu (person)
- mostPeople: en çok kişinin geldiği etkinlik
- eventCount: bir etkinliğe kaç kişi geldi (event)
- unassigned: bir etkinlikte masası olmayanlar (event)
- noShow: bir etkinliğe gelmeyenler (event)
- whoAtTable: bir etkinlikte bir masada kim var (event, table)
- whichEvent: bir zamanda (ay, yıl) hangi etkinlik vardı (event = zamanı anlatan kelimeler)
person: cümledeki kişi adı, yazıldığı gibi ama ekleri olmadan ("Ahmet'i" → "Ahmet"). phone: yazılmışsa telefon. event: etkinliği anlatan kelimeler (ör. "sezen aksu konseri", "son konser", "haziran", "gecen yilbasi"), yoksa null. table: "T05", "VIP01" gibi.
Komut ise steps (sırayla):
- assign: guest'i table'a oturt / taşı / al (geçmiş bir etkinlik adı geçiyorsa from = o etkinlik)
- copySeat: guest'i bir etkinlikteki yerine oturt (from = o etkinliği anlatan kelimeler; "son/geçen konser" → "son konser")
- nextTo: guest'i other kişinin yanına oturt
- moveTable: fromTable'daki herkesi table'a taşı
- unassign: guest'i masasından kaldır (silme değil)
- deleteGuest: guest'i listeden sil
- setPax: guest'in kişi sayısı pax olsun ("+2 olsun" → pax 3)
- setVip: guest VIP olsun
- addGuest: yeni misafir ekle (name, pax; "+1" veya "ve bir misafiri" → pax 2); masası yazılmışsa ardından assign (guest = aynı ad, table)
Kullanmadığın alanlar null; many yoksa false; steps soru için boş liste.`;
const EXAMPLES = [
  ["Zeynep Arslan Mabel Matiz'de nerede oturdu?", { kind: "question", intent: "seatAt", person: "Zeynep Arslan", phone: null, event: "mabel matiz", many: false, table: null, steps: [] }],
  ["Elif Şen kaç etkinliğimize geldi?", { kind: "question", intent: "attended", person: "Elif Şen", phone: null, event: null, many: false, table: null, steps: [] }],
  ["Sezen Aksu konserine kimler gelmedi?", { kind: "question", intent: "noShow", person: null, phone: null, event: "sezen aksu konseri", many: false, table: null, steps: [] }],
  ["Elif Şen'i T04'e oturt", { kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [{ op: "assign", guest: "Elif Şen", table: "T04", from: null, other: null, name: null, pax: null, fromTable: null }] }],
  ["Zeynep'i Tarkan konserindeki yerine koy", { kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [{ op: "copySeat", guest: "Zeynep", table: null, from: "tarkan konseri", other: null, name: null, pax: null, fromTable: null }] }],
  ["Mehmet Kaya'yı sil", { kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [{ op: "deleteGuest", guest: "Mehmet Kaya", table: null, from: null, other: null, name: null, pax: null, fromTable: null }] }],
  ["Bugün hava nasıl?", { kind: "unknown", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [] }],
];

async function ask(port, text) {
  const messages = [{ role: "system", content: SYSTEM }];
  for (const [u, a] of EXAMPLES) messages.push({ role: "user", content: u }, { role: "assistant", content: JSON.stringify(a) });
  messages.push({ role: "user", content: text });
  const body = { messages, temperature: 0, max_tokens: 400, cache_prompt: false, chat_template_kwargs: { enable_thinking: false },
    response_format: { type: "json_schema", json_schema: { name: "reading", schema: SCHEMA } } };
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  let got = null;
  try { got = JSON.parse(j.choices[0].message.content); } catch { got = null; }
  return { got, raw: j.choices && j.choices[0].message.content, seconds: (Date.now() - t0) / 1000 };
}
// The model's reading in parse()'s shape.
function toParse(m) {
  if (!m || m.kind === "unknown") return { kind: "unknown" };
  const fold = (s) => (s == null ? "" : Tl.fold(String(s)));
  if (m.kind === "question") return { kind: "question", intent: m.intent, person: m.person || undefined, phone: m.phone || null, event: fold(m.event), many: !!m.many, table: m.table ? String(m.table).replace(/\s+/g, "").toUpperCase() : undefined };
  const steps = (m.steps || []).map((s) => {
    const o = { op: s.op };
    if (s.guest) o.guest = s.guest; if (s.table) o.table = String(s.table).replace(/\s+/g, "").toUpperCase(); if (s.from) o.from = fold(s.from);
    if (s.other) o.other = fold(s.other); if (s.name) o.name = s.name; if (s.pax != null) o.pax = s.pax; if (s.fromTable) o.fromTable = String(s.fromTable).replace(/\s+/g, "").toUpperCase();
    if (s.op === "setVip") o.vip = "VIP";
    // a past event named on an assign: the acting layer refuses it (as parse() marks it)
    if (s.op === "assign" && s.from) { const past = Tl.findEvent(fx.events, fold(s.from), fx.today).events.find((e) => e.past); delete o.from; if (past) o.event = past.name; }
    return o;
  });
  // "add, then seat at the table": the acting layer takes the table on addGuest
  if (steps.length === 2 && steps[0].op === "addGuest" && steps[1].op === "assign" && !steps[0].table) { steps[0].table = steps[1].table; steps.pop(); }
  return { kind: "command", plan: steps };
}
function score(item, parsed) {
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
for (const it of items) {
  const rules = P.parse(it.text, fx.events, fx.today);
  const row = { set: it.set, id: it.id, text: it.text, rules: score(it, rules), rulesKind: rules.kind };
  if (!rulesOnly) {
    const m = await ask(port, it.text);
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
  medianSeconds: secs.length ? secs[Math.floor(secs.length / 2)] : null };
fs.writeFileSync(arg("out"), JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary));
