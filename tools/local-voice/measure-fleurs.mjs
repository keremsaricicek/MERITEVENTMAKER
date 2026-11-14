#!/usr/bin/env node
// Measures speech-to-text candidates for the F8 voice command against the
// PRE-REGISTERED bar in training/README.md ("Voice command (Mimar)"). Developer
// time only; nothing here ships.
//
//   node tools/local-voice/measure-fleurs.mjs --work DIR --cli PATH/whisper-cli \
//        --models DIR [--threads 2] [--only base,small,turbo] [--langs tr,en]
//
// DIR/data must hold FLEURS (CC-BY-4.0) <lang>_test.tsv and <lang>_test.tar.gz
// (huggingface.co/datasets/google/fleurs, data/<tr_tr|en_us>/). The clip choice is
// the bar's rule, by reference text only. Resumable: each transcript is kept in
// DIR/out/<model>/<lang>/<clip>.txt; a rerun skips what exists. Run it niced:
// another job may own the CPU.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const WORK = path.resolve(arg("work", ".")), CLI = arg("cli"), MODELS = arg("models"), THREADS = arg("threads", "2");
const CANDIDATES = { base: "ggml-base-q5_1.bin", small: "ggml-small-q5_1.bin", turbo: "ggml-large-v3-turbo-q5_0.bin" };
const ONLY = arg("only", "base,small,turbo").split(","), LANGS = arg("langs", "tr,en").split(",");
const COUNT = { tr: 40, en: 20 };

export function normalise(s, lang) {
  let t = String(s).normalize("NFC");
  if (lang === "tr") t = t.replace(/İ/g, "i").replace(/I/g, "ı");
  t = t.toLocaleLowerCase(lang === "tr" ? "tr-TR" : "en-US");
  return t.replace(/['’‘`´]/g, "").replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
}
export function editDistance(a, b) {
  const prev = new Array(b.length + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = prev[j]; prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1)); diag = tmp; }
  }
  return prev[b.length];
}

export function chooseClips(tsvText, n) {
  const seen = new Set(), out = [];
  for (const line of tsvText.split("\n")) {
    const c = line.split("\t");
    if (c.length < 3) continue;
    const [sid, file, raw] = c;
    if (/\d/.test(raw) || seen.has(sid)) continue;
    seen.add(sid); out.push({ sid, file, ref: raw });
    if (out.length === n) break;
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const report = { bar: "training/README.md 2026-11-07 Voice command", threads: Number(THREADS), note: "measured under a training job's CPU load, niced — speed is an upper bound, not the target PC", results: {} };
  for (const lang of LANGS) {
    const tsv = fs.readFileSync(path.join(WORK, "data", `${lang}_test.tsv`), "utf8");
    const clips = chooseClips(tsv, COUNT[lang]);
    const wavDir = path.join(WORK, "wav", lang);
    fs.mkdirSync(wavDir, { recursive: true });
    const missing = clips.filter((c) => !fs.existsSync(path.join(wavDir, c.file)));
    if (missing.length) execFileSync("tar", ["xzf", path.join(WORK, "data", `${lang}_test.tar.gz`), "-C", wavDir, "--strip-components=1", ...missing.map((c) => `test/${c.file}`)]);
    for (const key of ONLY) {
      const outDir = path.join(WORK, "out", key, lang);
      fs.mkdirSync(outDir, { recursive: true });
      let errs = 0, words = 0, cerrs = 0, chars = 0, audio = 0, spent = 0;
      const per = [];
      for (const c of clips) {
        const wav = path.join(wavDir, c.file), txt = path.join(outDir, c.file + ".txt"), tm = txt + ".seconds";
        if (!fs.existsSync(txt)) {
          const t0 = Date.now();
          const r = spawnSync("nice", ["-n", "19", CLI, "-m", path.join(MODELS, CANDIDATES[key]), "-f", wav, "-l", lang, "-nt", "-np", "-t", THREADS], { encoding: "utf8", maxBuffer: 1 << 22 });
          if (r.status !== 0) throw new Error(`${key} ${lang} ${c.file}: exit ${r.status}`);
          fs.writeFileSync(tm, String((Date.now() - t0) / 1000));
          fs.writeFileSync(txt, r.stdout);
        }
        const hyp = normalise(fs.readFileSync(txt, "utf8"), lang).split(" ").filter(Boolean), ref = normalise(c.ref, lang).split(" ").filter(Boolean);
        const head = fs.readFileSync(wav).subarray(0, 64), bytesPerSec = head.readUInt32LE(28);   // FLEURS: 32-bit float, 16 kHz, mono
        const dur = (fs.statSync(wav).size - 44) / bytesPerSec, secs = Number(fs.readFileSync(tm, "utf8"));
        const e = editDistance(ref, hyp), ce = editDistance([...ref.join(" ")], [...hyp.join(" ")]);
        errs += e; words += ref.length; cerrs += ce; chars += ref.join(" ").length; audio += dur; spent += secs;
        per.push({ clip: c.file, wer: +(e / ref.length).toFixed(3), seconds: secs, audio: +dur.toFixed(1) });
      }
      const rtf = per.map((p) => p.seconds / p.audio).sort((a, b) => a - b);
      report.results[`${key}/${lang}`] = { clips: clips.length, words, wer: +(errs / words).toFixed(4), cer: +(cerrs / chars).toFixed(4),
        audioSeconds: +audio.toFixed(1), decodeSeconds: +spent.toFixed(1), medianRealTimeFactor: +rtf[Math.floor(rtf.length / 2)].toFixed(2), per };
      console.log(`${key}/${lang}: WER ${(errs / words * 100).toFixed(1)}%  CER ${(cerrs / chars * 100).toFixed(1)}%  ${words} words  median RTF ${rtf[Math.floor(rtf.length / 2)].toFixed(2)}`);
      fs.writeFileSync(path.join(WORK, "report.json"), JSON.stringify(report, null, 1));
    }
  }
}
