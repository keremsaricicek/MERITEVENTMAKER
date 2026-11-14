// runR2 (training/README.md "runR2"): is a new exam blind to the data the candidate and its ancestors trained on?
// The reverse of check_g8_guard.mjs: for every sentence of the named test files, against every F8 item of the named
// data dirs — an equal sentence (folded), a shared four-word run (names folded to N, as the guard does), and a name word
// of the exam found in the data. Prints counts per data dir and the first hits; exit 1 on any hit in a dir listed with
// --strict (the dirs the candidate's lineage trained on), 0 otherwise.
//   node training/check_exam_blind.mjs --tests en12,entypo12,… --data DIR[,DIR…] [--strict DIR[,DIR…]]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await import(pathToFileURL(path.join(repo, "src/assistant-tools.js")).href);
const fold = (s) => globalThis.MeritAssistantTools.fold(String(s)).replace(/[^a-z0-9]+/g, " ").trim();
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const A = path.join(repo, "training/assistant");
const jl = (f) => fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));

// every name of every test file and the fixture (as the guard), folded to N in both the exam and the data
const names = new Set();
const addName = (v) => { if (typeof v === "string" && v.trim()) fold(v).split(" ").forEach((w) => w && names.add(w)); };
for (const f of fs.readdirSync(A).filter((f) => f.endsWith(".jsonl"))) for (const d of jl(path.join(A, f))) {
  const g = d.gold || {}; addName(g.person); for (const st of g.steps || []) [st.guest, st.name, st.other].forEach(addName);
}
for (const e of JSON.parse(fs.readFileSync(path.join(A, "fixture.json"), "utf8")).events) for (const g of e.guests) addName(g.name);
const examNames = new Set();
const exam = String(arg("tests", "")).split(",").filter(Boolean).flatMap((s) => jl(path.join(A, s + ".jsonl")).map((d) => {
  const g = d.gold || {};
  [g.person, ...(g.steps || []).flatMap((st) => [st.guest, st.name, st.other])].forEach((v) => { if (typeof v === "string") fold(v).split(" ").forEach((w) => examNames.add(w)); });
  return { set: s, id: d.id, text: d.text };
}));
const frame = (t, own) => fold(t).split(" ").map((w) => (names.has(w) || own.has(w) ? "N" : w));
const grams = (ws) => ws.slice(0, Math.max(0, ws.length - 3)).map((_, i) => ws.slice(i, i + 4).join(" "));
const examFold = new Map(exam.map((e) => [fold(e.text), e]));
const examG = new Map();
for (const e of exam) for (const g of grams(frame(e.text, new Set()))) { if (!examG.has(g)) examG.set(g, []); examG.get(g).push(e.id); }
// fixture names said in the exam are N in the exam's frames; in the data they are never present (barred), so the
// data's own names are folded to N too
const fixtureish = new Set(names);

const strict = new Set(String(arg("strict", "")).split(",").filter(Boolean).map((d) => path.resolve(d)));
let bad = 0;
for (const dir of String(arg("data", "")).split(",").filter(Boolean)) {
  const p = path.join(dir, "items.jsonl");
  if (!fs.existsSync(p)) { console.log(JSON.stringify({ dir, missing: true })); continue; }
  let n = 0; const eq = [], g4 = new Map(), nm = new Map();
  for (const it of jl(p)) {
    if (it.task !== "F8") continue;
    n++;
    const t = JSON.parse(it.truth), own = new Set();
    [t.person, ...(t.steps || []).flatMap((s) => [s.guest, s.name, s.other])].forEach((v) => { if (typeof v === "string") fold(v).split(" ").forEach((w) => own.add(w)); });
    const key = fold(it.q);
    if (examFold.has(key)) eq.push([examFold.get(key).id, it.q]);
    for (const g of grams(frame(it.q, new Set([...own, ...fixtureish])))) if (examG.has(g)) for (const id of examG.get(g)) if (!g4.has(id + "|" + g)) g4.set(id + "|" + g, it.q);
    for (const w of key.split(" ")) if (examNames.has(w) && !fixtureish.has(w)) nm.set(w, it.q);
  }
  const hits = eq.length + g4.size + nm.size;
  if (strict.has(path.resolve(dir)) && hits) bad++;
  console.log(JSON.stringify({ dir, f8: n, equal: eq.length, fourWordRuns: g4.size, newNameWords: nm.size, strict: strict.has(path.resolve(dir)) }));
  for (const [id, q] of eq.slice(0, 5)) console.log("  EQUAL", id, "|", q);
  for (const [k, q] of [...g4].slice(0, Number(arg("show", 12)))) console.log("  RUN  ", k, "|", q);
  for (const [w, q] of [...nm].slice(0, 5)) console.log("  NAME ", w, "|", q);
}
process.exit(bad ? 1 : 0);
