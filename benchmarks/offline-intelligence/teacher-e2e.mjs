#!/usr/bin/env node
// Teacher → person → label → dataset → training → package → load, end to end,
// with a SCRIPTED teacher (tests/lib/fake-anthropic.mjs). NO MODEL RUNS AS THE
// TEACHER and nothing here measures a model's quality: a pass proves the path.
//
//   MERIT_TRAIN_PYTHON=/path/to/venv/bin/python node benchmarks/offline-intelligence/teacher-e2e.mjs
//
// What it drives, in order, with the real app, the real relay and the real
// training scripts:
//   1. the model reading on the Golden Plan, answered by the scripted teacher:
//      a missing table, a missing chair beside a table, and a "not an object";
//   2. a person ACCEPTS the table and the chair, DISMISSES the "not an object",
//      confirms one classical table and rejects another;
//   3. the app's own Backup button writes the file a person would keep;
//   4. training/export_plans.py turns it into a dataset. Checked: the accepted
//      suggestions are the person's labels (human-confirmed, suggestedBy vlm),
//      the dismissed one is listed as teacher-suggested and is NOT an object,
//      the rejection is a rejection;
//   5. training/detector.py reads that dataset: only the person's labels are
//      targets, unreviewed objects are ignored (neither object nor background),
//      the rejection is background. Then a few training steps, ONNX export, and
//      training/package.py into a throwaway directory (never the repository);
//   6. the app loads that new version through its own loader (pin override +
//      sha256), a wrong hash is refused, and with no override the pinned
//      version comes back — rollback is re-pinning.
// Writes teacher-e2e-latest.json beside this file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { routeVendorFromCache } from "../../tests/lib/vendor.mjs";
import { startFakeAnthropic, messageReply, FAKE_NOTICE } from "../../tests/lib/fake-anthropic.mjs";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../../tests/lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PY = process.env.MERIT_TRAIN_PYTHON || "python3";
const OUT = path.join(HERE, "teacher-e2e-latest.json");
const checks = [];
const check = (ok, what, detail) => { checks.push({ ok: !!ok, what, ...(ok ? {} : { detail }) }); console.log(`${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : "  " + JSON.stringify(detail).slice(0, 400)}`); };
const py = (args, opts = {}) => execFileSync(PY, ["-I", ...args], { cwd: ROOT, encoding: "utf8", timeout: 30 * 60 * 1000, ...opts });

try { py(["-c", "import torch, onnx, PIL, numpy"]); } catch {
  const r = { ran: false, reason: `NOT RUN: ${PY} has no torch/onnx/pillow/numpy. Set MERIT_TRAIN_PYTHON to the training environment (training/README.md).` };
  fs.writeFileSync(OUT, JSON.stringify(r, null, 1)); console.log(r.reason); process.exit(2);
}

// The scripted teacher: built from the boxes the page sent, so refs are real.
function scripted(body) {
  const text = body.messages[0].content[1].text, data = JSON.parse(text.split("\n").pop());
  const W = data.image.width, H = data.image.height, objs = data.detectorObjects;
  const tables = objs.filter((o) => o.kind === "table" && o.status === "unreviewed");
  const t = tables[3];
  return messageReply({ text: JSON.stringify({ planSummary: "SCRIPTED teacher — not a model", regionsToInspect: [], findings: [
    { kind: "missing", ref: null, type: "round", box: [Math.round(W * 0.47), Math.round(H * 0.02), Math.round(W * 0.50), Math.round(H * 0.06)], value: null, confidence: "medium", evidence: "SCRIPTED missing table" },
    t && { kind: "missing", ref: null, type: "chair", box: [t.box[2] + 2, Math.round((t.box[1] + t.box[3]) / 2) - 6, t.box[2] + 14, Math.round((t.box[1] + t.box[3]) / 2) + 6], value: null, confidence: "medium", evidence: "SCRIPTED chair" },
    tables[0] && { kind: "notAnObject", ref: tables[0].ref, type: null, box: null, value: null, confidence: "low", evidence: "SCRIPTED reject" },
  ].filter(Boolean) }) });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-teacher-e2e-"));
const core = await import(path.join(ROOT, "server/vlm-core.mjs"));
const { startRelay } = await import(path.join(ROOT, "server/vlm-relay.mjs"));
const fake = await startFakeAnthropic({ fallback: scripted });
const config = core.configFromEnv({ ANTHROPIC_API_KEY: "sk-ant-e2e-fake-0000000000", VLM_UPSTREAM_BASE_URL: fake.baseURL, VLM_DATA_DIR: tmp, PORT: "0" }, { repoRoot: ROOT });
const relay = await startRelay({ config, log: { log: () => {}, error: () => {} } });
const browser = await launchChromium();
const result = { ran: true, notice: FAKE_NOTICE + ". This proves the path, never a model's quality.", measuredOn: new Date().toISOString() };
try {
  // ---- 1-3: teacher, person, backup ------------------------------------------------
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await routeVendorFromCache(page, { offline: true });
  await openApp(page, relay.baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Teacher e2e", date: futureDate() });
  await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64"));
  await runDetection(page, { timeout: 300000 });
  await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; render(); });
  await page.click('[data-vlm-action="toggle"]');
  await page.waitForSelector(".vlm-panel .vlm-state.ok");
  await page.click('[data-vlm-action="start"]');
  await page.waitForSelector("#meritAskTitle", { state: "visible" });
  await page.click('[data-ask="confirm"]');
  await page.waitForFunction(() => { const v = state.events[0].analysis.vlm; return v && v.status !== "running"; }, null, { timeout: 60000 });
  const findings = await page.evaluate(() => state.events[0].analysis.vlm.findings.map((f) => ({ id: f.id, kind: f.kind, type: f.type, state: f.state })));
  check(findings.length === 3, "the scripted teacher's three findings arrived as suggestions", findings);
  const before = await page.evaluate(() => state.events[0].analysis.candidates.length);
  for (const f of findings) {
    const act = f.kind === "notAnObject" ? "dismiss" : "accept";
    await page.click(`[data-vlm-action="${act}"][data-vlm-finding="${f.id}"]`);
    await page.waitForTimeout(150);
  }
  const decided = await page.evaluate(() => {
    const ev = state.events[0], tables = ev.analysis.candidates.filter((c) => c.kind === "table" && c.status === "unreviewed" && !c.source);
    decideReview(ev, { kind: "confirm", candidateId: tables[1].id });
    decideReview(ev, { kind: "reject", candidateId: tables[2].id });
    return { confirmed: tables[1].id, rejected: tables[2].id, states: ev.analysis.vlm.findings.map((f) => f.state) };
  });
  check(decided.states.filter((s) => s === "accepted").length === 2 && decided.states.includes("dismissed"), "the person accepted two suggestions and dismissed one", decided.states);
  const after = await page.evaluate(() => state.events[0].analysis.candidates.length);
  check(after === before + 1, "accepting the missing table added exactly one object; the chair went onto its table", { before, after });
  await page.click('[data-action="back-events"]');
  await page.waitForSelector('[data-action="backup-export"]', { timeout: 10000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="backup-export"]')]);
  const backup = path.join(tmp, "backup.json");
  fs.copyFileSync(await download.path(), backup);
  await ctx.close();

  // ---- 4: export ----------------------------------------------------------------------
  const ds = path.join(tmp, "dataset");
  py(["training/export_plans.py", "--backup", backup, "--out", ds, "--version", "e2e"]);
  const man = JSON.parse(fs.readFileSync(path.join(ds, "manifest.json"), "utf8"));
  const ann = JSON.parse(fs.readFileSync(path.join(ds, man.plans[0].planId + ".json"), "utf8"));
  const objs = ann.objects;
  const vlmTable = objs.find((o) => o.class === "table" && o.suggestedBy === "vlm");
  const vlmChair = objs.find((o) => o.class === "chair" && o.suggestedBy === "vlm");
  check(vlmTable && vlmTable.verification === "human-confirmed", "the accepted suggested table is the person's label: human-confirmed, suggestedBy vlm", vlmTable);
  check(vlmChair && vlmChair.verification === "human-confirmed", "the accepted suggested chair is the person's label, whatever its table's own state", vlmChair);
  check(ann.teacherSuggestions.length === 1 && ann.teacherSuggestions[0].verification === "teacher-suggested" && !objs.some((o) => o.id === ann.teacherSuggestions[0].id),
    "the dismissed suggestion is listed as teacher-suggested and is not an object", ann.teacherSuggestions);
  check(objs.find((o) => o.id === decided.rejected)?.verification === "rejected" && objs.find((o) => o.id === decided.confirmed)?.verification === "human-confirmed",
    "the person's confirm and reject are exported as such", { confirmed: objs.find((o) => o.id === decided.confirmed), rejected: objs.find((o) => o.id === decided.rejected) });
  result.dataset = { plans: man.plans.length, labelCounts: man.labelCounts, neverTargets: man.neverTargets };

  // ---- 5: the trainer reads only the person's labels; train, export, package -----------
  const probe = JSON.parse(py(["-c", `
import sys, json
sys.path.insert(0, "training")
import detector as D
p = D.load_dataset([sys.argv[1]])[0]
ids = [o for o in p.ann["objects"]]
print(json.dumps({"targets": len(p.objs), "ignored": len(p.ignore),
  "human": sum(1 for o in ids if o.get("verification") == "human-confirmed" and D.class_of(o) is not None),
  "rejected": sum(1 for o in ids if o.get("verification") == "rejected"),
  "unknown": sum(1 for o in ids if o.get("verification") in ("unreviewed", "accepted-on-confirm", "teacher-suggested") and D.class_of(o) is not None)}))
`, ds]).trim());
  check(probe.targets === probe.human && probe.ignored === probe.unknown && probe.targets > 0,
    "training targets are exactly the person's labels; unverified objects are ignored, not taught as background; rejections are background", probe);
  result.trainerView = probe;
  const syn = path.join(tmp, "syn");
  py(["training/synth.py", "--out", syn, "--count", "8", "--seed", "91"]);
  const run = path.join(tmp, "run");
  const t0 = Date.now();
  py(["training/detector.py", "train", "--synthetic", syn, "--dataset", ds, "--steps", "30", "--batch", "4", "--threads", "2", "--out", run]);
  py(["training/detector.py", "export", "--model", path.join(run, "model.pt"), "--onnx", path.join(run, "model.onnx")]);
  const version = "e2e-" + Date.now().toString(36);
  const models = path.join(tmp, "models");
  py(["training/package.py", "--run", run, "--version", version, "--models-dir", models]);
  const pkg = JSON.parse(fs.readFileSync(path.join(models, version, "manifest.json"), "utf8"));
  check(pkg.bytes > 0 && /^[0-9a-f]{64}$/.test(pkg.sha256) && !fs.existsSync(path.join(ROOT, "models/plan-detector", version)),
    "a new version was trained, exported and packaged with its own sha256 — outside the repository", { bytes: pkg.bytes, version });
  result.training = { steps: 30, seconds: Math.round((Date.now() - t0) / 1000), version, bytes: pkg.bytes, sha256: pkg.sha256, note: "30 steps: plumbing, not a model anyone should use" };

  // ---- 6: load it, refuse a wrong hash, roll back -----------------------------------------
  const body = fs.readFileSync(path.join(models, version, "model.js"), "utf8");
  const analyse = async (override) => {
    const c = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await c.newPage();
    await routeVendorFromCache(p, { offline: true });
    if (override) {
      await p.route("**/e2e-model/model.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body }));
      await p.addInitScript((pin) => { globalThis.MERIT_PLAN_MODEL_PIN_OVERRIDE = pin; }, override);
    }
    await openApp(p, relay.baseUrl, { lang: "en" });
    await createBlankEvent(p, { name: "Load", date: futureDate() });
    await importPlan(p, "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64"));
    await runDetection(p, { timeout: 300000 });
    const lm = await p.evaluate(() => state.events[0].analysis.localModel);
    await c.close();
    return lm;
  };
  const pin = { version, file: "e2e-model/model.js", bytes: pkg.bytes, sha256: pkg.sha256 };
  const loaded = await analyse(pin);
  check(loaded && loaded.available && loaded.model.version === version && loaded.model.integrity === "sha256", "the app loaded the new version through its own loader, checked by sha256", loaded);
  const wrong = await analyse({ ...pin, sha256: "0".repeat(64) });
  check(wrong && !wrong.available && wrong.reasonCode === "MODEL_INTEGRITY", "a version whose bytes do not match its pin is refused, and the analysis completes on the classical path", wrong);
  const back = await analyse(null);
  check(back && back.available && back.model.version !== version, "with no override the pinned version runs again: rollback is re-pinning", back && back.model);
  result.loaded = { version: loaded && loaded.model.version, ms: loaded && loaded.ms, wrongHash: wrong && wrong.reasonCode, rolledBackTo: back && back.model.version };
} catch (e) {
  check(false, "the run completed", String(e && e.stack || e));
} finally {
  await browser.close(); await relay.close().catch(() => {}); await fake.close().catch(() => {});
  result.checks = checks;
  result.passed = checks.filter((c) => c.ok).length; result.failed = checks.filter((c) => !c.ok).length;
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${result.passed} passed, ${result.failed} failed — ${FAKE_NOTICE}`);
  process.exitCode = result.failed ? 1 : 0;
}
