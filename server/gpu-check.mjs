// MERIT Event Maker — the Windows package's first-run GPU check.
//
//   node gpu-check.mjs SERVER_EXE MODEL.gguf MMPROJ.gguf ADAPTER.gguf CHECK_DIR OUT.json
//
// The package's llama-server carries the Vulkan backend (ggml-vulkan.dll). A
// graphics card is used only if it gives THE SAME closed answers as the
// processor did when the package was built: CHECK_DIR holds a dozen crops of
// this repository's own plans with the question asked and the answer the CPU
// gave (`expected.json`, written by build-package.sh). The check starts the
// model with every layer on the GPU (-ngl 99), asks each crop exactly as the
// relay asks it, and writes OUT.json { use: "gpu" | "cpu", why, agree, n }.
// No device, a failure to start, or ONE different answer → "cpu". It runs
// once; the launcher reads OUT.json on every start.
//
//   node gpu-check.mjs SERVER MODEL MMPROJ ADAPTER CHECK_DIR --record
// (package build, on the processor) writes CHECK_DIR/expected.json from
// CHECK_DIR/items.json — the answers the graphics card must match.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import * as core from "./vlm-core.mjs";

const [exe, model, mmproj, adapter, dir, out] = process.argv.slice(2);
const RECORD = out === "--record";
const PORT = 8094;
const write = (use, why, extra = {}) => { fs.writeFileSync(out, JSON.stringify({ use, why, at: new Date().toISOString(), ...extra }, null, 1)); console.log(`  GPU kontrolu: ${use === "gpu" ? "ekran karti kullanilacak" : "islemci kullanilacak"} (${why})`); };

let log = "";
const proc = spawn(exe, ["-m", model, "--mmproj", mmproj, "--lora", adapter, "-c", "2048", "-np", "1", "--cache-ram", "0", "-ngl", "99",
  "--host", "127.0.0.1", "--port", String(PORT)].map((a) => (RECORD && a === "99" ? "0" : a)), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
proc.stdout.on("data", (d) => { log += d; });
proc.stderr.on("data", (d) => { log += d; });
const stop = () => { try { proc.kill(); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let up = false;
  for (let i = 0; i < 240 && !up; i++) {
    if (proc.exitCode != null) break;
    try { up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch {}
    if (!up) await sleep(1000);
  }
  if (!up && RECORD) { console.error("the model did not start"); stop(); process.exit(1); }
  if (!up) { write("cpu", "the model did not start with the graphics card"); stop(); process.exit(0); }
  // llama.cpp says which devices it offloaded to; without a Vulkan device every layer stayed on the CPU
  if (!RECORD && (!/Vulkan|vulkan/.test(log) || /no usable GPU|found 0 Vulkan devices|no (vulkan )?devices found/i.test(log))) { write("cpu", "no Vulkan graphics card"); stop(); process.exit(0); }
  const items = JSON.parse(fs.readFileSync(path.join(dir, RECORD ? "items.json" : "expected.json"), "utf8"));
  let agree = 0;
  const rows = [];
  for (const it of items) {
    const data = fs.readFileSync(path.join(dir, it.image)).toString("base64");
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${data}` } }, { type: "text", text: core.askText(it.question, it.piece) }] }],
      temperature: 0, max_tokens: 48, chat_template_kwargs: { enable_thinking: false } };
    let value = null;
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      value = core.parseAskAnswer(it.question, j.choices[0].message.content);
    } catch { value = null; }
    const same = value !== null && String(value) === String(it.expected);
    agree += same ? 1 : 0;
    rows.push({ image: it.image, expected: it.expected, gpu: value });
  }
  if (RECORD) {
    fs.writeFileSync(path.join(dir, "expected.json"), JSON.stringify(items.map((it, i) => ({ ...it, expected: rows[i].gpu })).filter((x) => x.expected !== null), null, 1));
    console.log(`recorded ${rows.filter((r) => r.gpu !== null).length} of ${items.length} answers on the processor`);
    stop(); process.exit(0);
  }
  write(agree === items.length ? "gpu" : "cpu", agree === items.length ? "the graphics card gave the processor's answers" : `the graphics card differed on ${items.length - agree} of ${items.length}`, { agree, n: items.length, rows });
} catch (e) {
  write("cpu", "the check could not run");
} finally { stop(); }
