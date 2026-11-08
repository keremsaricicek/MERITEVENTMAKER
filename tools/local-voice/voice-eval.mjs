// Voice 2 (training/README.md "runR … voice 2"): transcribe the synthetic spoken-command clips
// (tools/local-voice/make-voice-set.py) with whisper.cpp under one setting, time each clip, score WER, and write
// the transcripts for the end-to-end reading (training/assistant_race.mjs --voice-file).
//
//   node tools/local-voice/voice-eval.mjs --cli whisper-cli --model ggml-small-q5_1.bin --clips DIR \
//        --sets voicedevtr,voicedeven --conds door10 [--hints] [--args "-bs 1 -bo 1"] [--threads 4] --out OUT.json
// --hints: the initial prompt carries the open event's guest names and table codes (as the product sends them).
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanTranscript } from "../../server/voice-listener.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes("--" + k);
const CLI = arg("cli"), MODEL = arg("model"), DIR = arg("clips"), OUT = arg("out"), THREADS = arg("threads", "4");
const SETS = arg("sets", "voicedevtr,voicedeven").split(","), CONDS = arg("conds", "door10").split(","), EXTRA = String(arg("args", "")).split(" ").filter(Boolean);
const man = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8")).clips.filter((c) => SETS.includes(c.set) && CONDS.includes(c.cond));

// the open event's names and tables (the fixture's current event), as the product would pass them
export function hintsFor(event, lang) {
  const names = event.guests.map((g) => g.name).join(", "), tables = event.tables.map((t) => t.number).join(", ");
  return lang === "tr" ? `Misafirler: ${names}. Masalar: ${tables}.` : `Guests: ${names}. Tables: ${tables}.`;
}
const fx = JSON.parse(fs.readFileSync(path.join(repo, "training/assistant/fixture.json"), "utf8"));
const openEvent = fx.events.find((e) => e.id === fx.current);

// ---- WER normalisation (FLEURS bar's + numbers, letter/digit split, "te" → "t"; English folds Turkish letters)
const TR1 = ["sıfır", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"], TR10 = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
const EN1 = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN10 = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const numWords = (n, lang) => {
  if (lang === "tr") { if (n < 10) return [TR1[n]]; if (n < 100) return [TR10[Math.floor(n / 10)], ...(n % 10 ? [TR1[n % 10]] : [])]; return [String(n)]; }
  if (n < 20) return [EN1[n]]; if (n < 100) return [EN10[Math.floor(n / 10)], ...(n % 10 ? [EN1[n % 10]] : [])]; return [String(n)];
};
const FOLD = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
export function norm(s, lang) {
  let t = String(s).normalize("NFC");
  t = lang === "tr" ? t.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr") : t.toLowerCase();
  t = t.replace(/['’`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (lang === "en") t = t.replace(/[çğıöşüâîû]/g, (c) => FOLD[c]);
  const out = [];
  for (const w of t.split(/\s+/).filter(Boolean)) {
    const m = /^(\p{L}*?)(\d+)(\p{L}*)$/u.exec(w);
    if (m) { if (m[1]) out.push(m[1]); const ws = numWords(Number(m[2]), lang); ws[ws.length - 1] += m[3]; out.push(...ws); }
    else out.push(w);
  }
  return out.map((w) => (lang === "tr" && w === "te" ? "t" : w));
}
function edits(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const run = (args) => new Promise((resolve) => {
  const t0 = process.hrtime.bigint();
  execFile(CLI, args, { encoding: "utf8", maxBuffer: 1 << 20, env: { PATH: "", LANG: "C.UTF-8" } }, (err, stdout) => resolve({ ok: !err, stdout: stdout || "", seconds: Number(process.hrtime.bigint() - t0) / 1e9 }));
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = [];
  for (const c of man) {
    const args = ["-m", MODEL, "-f", path.join(DIR, c.file), "-l", c.lang, "-nt", "-np", "-t", THREADS, ...EXTRA, ...(flag("hints") ? ["--prompt", hintsFor(openEvent, c.lang)] : [])];
    const r = await run(args);
    const text = cleanTranscript(r.stdout);
    const ref = norm(c.say, c.lang), hyp = norm(text, c.lang);
    rows.push({ set: c.set, id: c.id, lang: c.lang, voice: c.voice, cond: c.cond, clipSeconds: c.seconds, seconds: +r.seconds.toFixed(3), ok: r.ok, text, say: c.say, errors: edits(ref, hyp), words: ref.length });
    process.stdout.write(`${c.file} ${r.seconds.toFixed(2)}s ${JSON.stringify(text)}\n`);
  }
  const groups = {};
  for (const r of rows) { const k = `${r.lang}@${r.cond}`; (groups[k] ||= []).push(r); }
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  const summary = Object.fromEntries(Object.entries(groups).map(([k, rs]) => [k, { clips: rs.length, wer: +(rs.reduce((a, r) => a + r.errors, 0) / rs.reduce((a, r) => a + r.words, 0)).toFixed(3),
    medianSeconds: +q(rs.map((r) => r.seconds), 0.5).toFixed(2), p95Seconds: +q(rs.map((r) => r.seconds), 0.95).toFixed(2) }]));
  const transcripts = {};
  for (const r of rows) (transcripts[`${r.set}@${r.voice}@${r.cond}`] ||= {})[r.id] = r.text;
  const setting = { model: path.basename(MODEL), threads: Number(THREADS), args: EXTRA, hints: flag("hints") };
  fs.writeFileSync(OUT, JSON.stringify({ setting, summary, rows }, null, 1));
  fs.writeFileSync(OUT.replace(/\.json$/, "") + ".transcripts.json", JSON.stringify(transcripts, null, 1));
  console.log(JSON.stringify({ setting, summary }));
}
