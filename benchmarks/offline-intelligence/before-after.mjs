// Before / after on the same plan (ROADMAP B2): how much is left for a person
// after an analysis WITHOUT the local model, and after the same analysis WITH
// it (its second look, and what it applies by itself). Defined before it runs
// (training/README.md "Before / after"):
//
//   questionsLeft   grouping questions the plan still asks (planIntelligence.
//                   uncertainQuestions not yet answered)
//   heldBack        objects the analysis held back and nobody decided
//   suggestions     open second-look findings waiting for a person
//   appliedByModel  answers the model wrote by itself (each undoable)
//
//   node benchmarks/offline-intelligence/before-after.mjs --server LLAMA_SERVER \
//     --model MODEL.gguf --mmproj MMPROJ.gguf --lora ADAPTER.gguf --manifest MANIFEST.json --out OUT.json
//
// The two real plans' TEST part is held out from training, their left part is
// not: this is a demonstration on plans the model has partly seen, never an
// unseen-venue score. Nothing here is a model's accuracy.
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
const { startStaticServer } = await import(path.join(repo, "tests/lib/server.mjs"));
const { openApp, createBlankEvent, importPlan, runDetection, futureDate } = await import(path.join(repo, "tests/lib/app-actions.mjs"));
const core = await import(path.join(repo, "server/vlm-core.mjs"));
const { startRelay } = await import(path.join(repo, "server/vlm-relay.mjs"));

const PLANS = { golden: "benchmarks/plans/merit-real-venue-plan.png", ornek: "benchmarks/plans/ornek-upright.png" };
const PORT = 8091;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the manifest's files next to it, as the relay expects (links into the model folders)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-before-after-"));
const m = JSON.parse(fs.readFileSync(arg("manifest"), "utf8"));
const src = { [m.serve.model]: arg("model"), [m.files.find((f) => /mmproj/.test(f.path)).path]: arg("mmproj"), "adapter.gguf": arg("lora") };
for (const [n, p] of Object.entries(src)) fs.symlinkSync(path.resolve(p), path.join(tmp, n));
fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify(m));

const llama = spawn(arg("server"), ["-m", path.join(tmp, m.serve.model), "--mmproj", path.join(tmp, Object.keys(src)[1]), "--lora", path.join(tmp, "adapter.gguf"),
  "-c", String(m.serve.ctx), "-t", "4", "-np", "1", "--cache-ram", "0", "--host", "127.0.0.1", "--port", String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {} await sleep(1000); }

const count = (page) => page.evaluate(() => {
  const a = state.events[0].analysis, pi = a.planIntelligence || {};
  const answered = new Set((a.groupingDecisions || []).flatMap((d) => d.memberIds));
  return {
    questionsLeft: (pi.uncertainQuestions || []).length,
    heldBack: a.candidates.filter((c) => c.lowEvidence && c.status === "unreviewed" && !c.dismissed).length,
    suggestions: a.vlm ? a.vlm.findings.filter((f) => f.state === "open").length : 0,
    appliedByModel: a.vlm ? a.vlm.findings.filter((f) => f.state === "applied").length : 0,
    groupsAnsweredByModel: (a.groupingDecisions || []).filter((d) => d.by === "model").length,
    asked: a.vlm ? a.vlm.checks.length : 0,
    answeredTables: answered.size,
  };
});

const browser = await chromium.launch();
const out = { at: new Date().toISOString(), model: m.id, plans: {} };
const stat = await startStaticServer({ port: 0 });
const staticUrl = stat.baseUrl;
const relay = await startRelay({ config: core.configFromEnv({ VLM_PROVIDER: "local", VLM_LOCAL_URL: `http://127.0.0.1:${PORT}`, VLM_LOCAL_MANIFEST: path.join(tmp, "manifest.json"),
  VLM_DATA_DIR: path.join(tmp, "data"), PORT: "0" }, { repoRoot: repo }), log: { log: () => {}, error: () => {} } });
try {
  for (const [name, file] of Object.entries(PLANS)) {
    const png = "data:image/png;base64," + fs.readFileSync(path.join(repo, file)).toString("base64");
    const one = async (base, withModel) => {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await openApp(page, base, { lang: "tr" });
      await createBlankEvent(page, { name: "Before/after", date: futureDate() });
      await importPlan(page, png);
      await runDetection(page);
      if (withModel) await page.waitForFunction(() => { const v = state.events[0].analysis.vlm; return v && v.mode === "check" && v.status !== "running"; }, null, { timeout: 1800000 });
      const c = await count(page);
      await page.close();
      return c;
    };
    out.plans[name] = { before: await one(staticUrl, false), after: await one(relay.baseUrl, true) };
    console.log(name, JSON.stringify(out.plans[name]));
  }
} finally {
  await browser.close(); await relay.close(); await stat.close(); llama.kill();
  fs.writeFileSync(arg("out"), JSON.stringify(out, null, 1));
}
