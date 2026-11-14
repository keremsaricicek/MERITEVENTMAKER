// The Golden 2 blind exam (benchmarks/plans/blind/README.md): the owner's third real
// plan, read ONCE by the product as shipped — classical detection, the trained
// detector, and the wired local model's second look with what it applies by itself.
// Nothing here is tuned on the plan; the result is reported as measured.
//
//   node benchmarks/offline-intelligence/golden2-exam.mjs --server LLAMA_SERVER --model MODEL.gguf \
//     --mmproj MMPROJ.gguf --lora ADAPTER.gguf --manifest MANIFEST.json --image PLAN.jpg --out OUT.json --shot OUT.png
//
// The image is the scan embedded in golden2.pdf (pdfimages: one 1654×2338 JPEG, 200 dpi),
// i.e. the same pixels the PDF import shows.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const arg = (k) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : null; };
const { openApp, createBlankEvent, importPlan, runDetection, futureDate } = await import(path.join(repo, "tests/lib/app-actions.mjs"));
const core = await import(path.join(repo, "server/vlm-core.mjs"));
const { startRelay } = await import(path.join(repo, "server/vlm-relay.mjs"));
const PORT = 8091;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-golden2-"));
const m = JSON.parse(fs.readFileSync(arg("manifest"), "utf8"));
const mmName = m.files.find((f) => /mmproj/.test(f.path)).path;
for (const [n, p] of [[m.serve.model, arg("model")], [mmName, arg("mmproj")], ["adapter.gguf", arg("lora")]]) fs.symlinkSync(path.resolve(p), path.join(tmp, n));
fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(m));
const llama = spawn(arg("server"), ["-m", path.join(tmp, m.serve.model), "--mmproj", path.join(tmp, mmName), "--lora", path.join(tmp, "adapter.gguf"),
  "-c", String(m.serve.ctx), "-t", "4", "-np", "1", "--cache-ram", "0", "--host", "127.0.0.1", "--port", String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {} await sleep(1000); }

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
const relay = await startRelay({ config: core.configFromEnv({ VLM_PROVIDER: "local", VLM_LOCAL_URL: `http://127.0.0.1:${PORT}`, VLM_LOCAL_MANIFEST: path.join(tmp, "manifest.json"),
  VLM_DATA_DIR: path.join(tmp, "data"), PORT: "0" }, { repoRoot: repo }), log: { log: () => {}, error: () => {} },
  // --root dist/merit-offline: the shipped offline package (its OCR engine included), as the Windows launcher serves it
  ...(arg("root") ? { root: path.resolve(arg("root")) } : {}) });
const out = { at: new Date().toISOString(), model: m.id, image: path.basename(arg("image")) };
try {
  const img = "data:image/jpeg;base64," + fs.readFileSync(arg("image")).toString("base64");
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const t0 = Date.now();
  await openApp(page, relay.baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Golden 2", date: futureDate() });
  await importPlan(page, img);
  await runDetection(page);
  out.detectSeconds = (Date.now() - t0) / 1000;
  // the second look starts by itself only when the analysis left something to ask; if no run
  // appears within two minutes there was nothing to ask (recorded), else wait for it to end
  out.secondLook = "none started";
  for (let i = 0; i < 240; i++) {
    const v = await page.evaluate(() => { const x = state.events[0].analysis.vlm; return x ? { mode: x.mode, status: x.status, checks: (x.checks || []).length } : null; });
    if (v && v.mode === "check" && v.status !== "running") { out.secondLook = v.status; break; }
    if (v) out.secondLook = "running";
    if (!v && i >= 8) break;
    await sleep(15000);
  }
  out.totalSeconds = (Date.now() - t0) / 1000;
  Object.assign(out, await page.evaluate(() => {
    const a = state.events[0].analysis, pi = a.planIntelligence || {};
    const live = a.candidates.filter((c) => !c.dismissed && c.status !== "rejected");
    const tables = live.filter((c) => c.kind === "table");
    return {
      provider: a.provider || null, trainedDetector: a.model || a.detector || null,
      tables: tables.map((c) => ({ id: c.id, type: c.type, x: +c.x.toFixed(1), y: +c.y.toFixed(1), w: +(c.w || 0).toFixed(1), h: +(c.h || 0).toFixed(1),
        chairs: (c.chairDetections || []).length, status: c.status, lowEvidence: !!c.lowEvidence, confidence: c.confidence })),
      otherKinds: live.filter((c) => c.kind !== "table").reduce((m, c) => (m[c.kind + ":" + (c.type || "")] = (m[c.kind + ":" + (c.type || "")] || 0) + 1, m), {}),
      chairsOnTables: tables.reduce((n, c) => n + (c.chairDetections || []).length, 0),
      groups: (pi.groups || []).map((g) => g.memberIds ? g.memberIds.length : 0),
      questionsLeft: (pi.uncertainQuestions || []).length,
      heldBack: a.candidates.filter((c) => c.lowEvidence && c.status === "unreviewed" && !c.dismissed).length,
      vlm: a.vlm ? { asked: a.vlm.checks.length, findings: a.vlm.findings.map((f) => ({ kind: f.kind, state: f.state, question: f.question })) } : null,
      groupingByModel: (a.groupingDecisions || []).filter((d) => d.by === "model").length,
    };
  }));
  if (arg("shot")) await page.screenshot({ path: arg("shot") });
  await page.close();
} finally {
  await browser.close(); await relay.close(); llama.kill();
  fs.writeFileSync(arg("out"), JSON.stringify(out, null, 1));
}
console.log(JSON.stringify({ tables: out.tables && out.tables.length, chairsOnTables: out.chairsOnTables, questionsLeft: out.questionsLeft, heldBack: out.heldBack, totalSeconds: out.totalSeconds }));
