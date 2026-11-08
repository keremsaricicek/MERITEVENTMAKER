// runQ's data guard (training/README.md "runQ"): run on a data dir before training; exit 1 on any hit.
// It reads the test files and the data, nothing else (no generator pool or list).
//   F8 items:    no text equals (folded) any sentence of any test file in training/assistant/ (fresh*, typo*,
//                en*, entypo*, deep*, questions, commands, variants — the runQ exam included); no four-word run
//                (names folded to N) shared with any of them; no word that is a name in a test set or the fixture.
//   BRIEF items: no text equals (folded) a brief of training/planner_briefs.jsonl; no six-word run shared with one.
//
//   node training/check_g8_guard.mjs DATA_DIR
// synth_f8.mjs --grammar 8 imports guard() and skips what it rejects; this CLI re-checks the written file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function guard() {
await import(pathToFileURL(path.join(repo, "src/assistant-tools.js")).href);
const fold = (s) => globalThis.MeritAssistantTools.fold(String(s)).replace(/[^a-z0-9]+/g, " ").trim();
const A = path.join(repo, "training/assistant");
const jl = (f) => fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));

// names: every name in every test gold, the original commands' added guests, and the fixture
const names = new Set();
const addName = (v) => { if (typeof v === "string" && v.trim()) fold(v).split(" ").forEach((w) => w && names.add(w)); };
const tests = [];
for (const f of fs.readdirSync(A).filter((f) => f.endsWith(".jsonl")).sort()) for (const d of jl(path.join(A, f))) {
  tests.push(d.text ?? d.q);
  const g = d.gold || {};
  addName(g.person); for (const st of g.steps || []) [st.guest, st.name, st.other].forEach(addName);
  for (const c of d.calls || []) if (c[0] === "addGuest") addName(c[1]);
}
const fx = JSON.parse(fs.readFileSync(path.join(A, "fixture.json"), "utf8"));
for (const e of fx.events) for (const g of e.guests) addName(g.name);
const frame = (t, extra) => fold(t).split(" ").map((w) => (names.has(w) || extra.has(w) ? "N" : w));
const grams = (ws, k) => ws.slice(0, ws.length - k + 1).map((_, i) => ws.slice(i, i + k).join(" ")).filter((g) => g.split(" ").length === k);
const testFold = new Set(tests.map(fold)), testG4 = new Set(tests.flatMap((t) => grams(frame(t, new Set()), 4)));
const briefs = jl(path.join(repo, "training/planner_briefs.jsonl")).map((b) => b.text);
const briefFold = new Set(briefs.map(fold)), briefG6 = new Set(briefs.flatMap((t) => grams(fold(t).split(" "), 6)));

// the reason an item may not be trained on, or null
function brief(q) {
  const key = fold(q);
  if (briefFold.has(key)) return "brief = test brief";
  if (grams(key.split(" "), 6).some((g) => briefG6.has(g))) return "brief shares 6 words with a test brief";
  return null;
}
function f8(q, t) {
  const key = fold(q), own = new Set();
  [t.person, ...(t.steps || []).flatMap((s) => [s.guest, s.name, s.other])].forEach((v) => { if (typeof v === "string") fold(v).split(" ").forEach((w) => own.add(w)); });
  if (testFold.has(key)) return "sentence = test sentence";
  if (grams(frame(q, own), 4).some((g) => testG4.has(g))) return "4-word run of a test sentence";
  const bad = key.split(" ").filter((w) => names.has(w));
  return bad.length ? `test name word(s) ${bad.join(",")}` : null;
}
return { brief, f8, sizes: { testSentences: tests.length, testBriefs: briefs.length, nameWords: names.size } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const G = await guard(), dir = process.argv[2];
  const items = fs.readFileSync(path.join(dir, "items.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const hits = [];
  let nf = 0, nb = 0;
  for (const it of items) {
    const why = it.task === "BRIEF" ? (nb++, G.brief(it.q)) : it.task === "F8" ? (nf++, G.f8(it.q, JSON.parse(it.truth))) : null;
    if (why) hits.push([why, it.q]);
  }
  console.log(JSON.stringify({ dir, f8: nf, briefs: nb, ...G.sizes, hits: hits.length }));
  for (const h of hits.slice(0, 20)) console.log("HIT", h[0], "|", h[1]);
  process.exit(hits.length ? 1 : 0);
}
