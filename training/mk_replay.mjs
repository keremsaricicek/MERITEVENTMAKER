// runR2 (training/README.md "runR2"): Turkish replay — F8 items q08 itself trained on (data-g8), so runR2 rehearses what
// q08 read right and runR forgot. Deterministic: a seeded sample of the Turkish F8 items of SRC (family synth-f8, and
// synth-f8-deep items with no English word), each passed through the runQ guard as it stands TODAY (every test file,
// en11* and the blind en12* included); a rejected item is dropped, never edited.
//   node training/mk_replay.mjs --src DIR --out DIR --n 900 --seed 99
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const G = await (await import(pathToFileURL(path.join(repo, "training/check_g8_guard.mjs")).href)).guard();
const EN = /\b(the|and|then|seat|move|put|add|make|who|where|which|how|first|after|please|checking|quick|client|report|table|guest|list|delete|remove|vip status)\b/i;
const src = fs.readFileSync(path.join(arg("src"), "items.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const tr = src.filter((it) => it.task === "F8" && (it.family === "synth-f8" || (it.family === "synth-f8-deep" && !EN.test(it.q))));
let seed = Number(arg("seed", 99)) >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
for (let i = tr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [tr[i], tr[j]] = [tr[j], tr[i]]; }
const n = Number(arg("n", 900)), out = [], why = {};
for (const it of tr) {
  if (out.length >= n) break;
  const w = G.f8(it.q, JSON.parse(it.truth));
  if (w) { why[w.replace(/ .*/, "")] = (why[w.replace(/ .*/, "")] || 0) + 1; continue; }
  out.push({ ...it, family: it.family + "-replay" });
}
fs.mkdirSync(arg("out"), { recursive: true });
fs.writeFileSync(path.join(arg("out"), "items.jsonl"), out.map((x) => JSON.stringify(x)).join("\n") + "\n");
console.log(JSON.stringify({ src: arg("src"), turkish: tr.length, written: out.length, dropped: why }));
