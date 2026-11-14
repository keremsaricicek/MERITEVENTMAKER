// The local model CHANGING the plan by itself (training/README.md "Changing the
// plan by itself"; the owner's request of 2026-10-25: hand over the corrected
// plan, marked, one click to undo).
//
// NO MODEL RUNS HERE. The local process is tests/lib/fake-local-vlm.mjs, every
// answer SCRIPTED by this file: a pass proves the plumbing and the rules, never
// how well a model answers.
//
// What this pins:
//   ONLY WITH EVIDENCE. A manifest may name questions to apply by itself
//     (`autoApply`) only among its measured `checks`, and only the one the
//     product knows how to apply (merged); anything else is refused at load.
//     The relay says which (status `local.autoApply`). The committed manifests'
//     evidence is checked in local-second-look.
//   THE SAME RECORD A PERSON'S ANSWER WRITES. Both looks saying two pushed-
//     together tables are separate becomes the grouping answer "separate" —
//     marked as the model's (`by: "model"`, its run), audited, NEVER a training
//     example — and the plan regroups at once.
//   ONE CLICK BACK. The finding says it was applied by the model; Undo removes
//     exactly that answer and the grouping returns; the finding is open again.
//   NOTHING ELSE. Without `autoApply` the same look applies nothing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { startFakeLocalVlm, FAKE_LOCAL_NOTICE } from "../lib/fake-local-vlm.mjs";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "local-auto-apply", tags: ["intelligence", "fast"], timeout: 300000 };

export default async function run({ page, checks, repoRoot }) {
  checks.ok(FAKE_LOCAL_NOTICE.includes("not a model"), "the local process in this suite is the scripted fake, and says so");
  const core = await import(path.join(repoRoot, "server/vlm-core.mjs"));
  const { startRelay } = await import(path.join(repoRoot, "server/vlm-relay.mjs"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "merit-auto-apply-"));
  const modelDir = path.join(tmp, "model");
  fs.mkdirSync(modelDir);
  const files = { "weights.gguf": crypto.randomBytes(4096), "mmproj.gguf": crypto.randomBytes(2048), "adapter.gguf": crypto.randomBytes(1024) };
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(modelDir, n), b);
  const real = (n) => fs.realpathSync(path.join(modelDir, n));
  const SERVE = { model: "weights.gguf", lora: [{ path: "adapter.gguf", scale: 1 }], ctx: 2048 };
  const SERVING = { modelPath: real("weights.gguf"), nCtx: 2048, loras: [{ path: real("adapter.gguf"), scale: 1 }] };
  const manifest = (over = {}) => ({ format: "merit-local-vlm/1", id: "fake-local-vlm", name: "Scripted Local VLM", version: "0.0-test", licence: "Apache-2.0 (test)",
    source: "written by tests/suites/local-auto-apply.test.mjs", runtime: "tests/lib/fake-local-vlm.mjs", serve: SERVE,
    checks: ["merged"], checksEvidence: "scripted: tests/suites/local-auto-apply.test.mjs",
    files: Object.entries(files).map(([p, b]) => ({ path: p, bytes: b.length, sha256: crypto.createHash("sha256").update(b).digest("hex") })), ...over });
  const writeManifest = (name, m) => { const fl = path.join(modelDir, name); fs.writeFileSync(fl, JSON.stringify(m)); return fl; };
  const cfg = (m) => core.configFromEnv({ VLM_PROVIDER: "local", VLM_LOCAL_URL: "http://127.0.0.1:9", VLM_LOCAL_MANIFEST: m }, { repoRoot });

  // ---- the manifest ---------------------------------------------------------------
  const auto = writeManifest("auto.json", manifest({ autoApply: ["merged"] }));
  checks.equal([
    cfg(auto).reasonCode,
    cfg(writeManifest("a1.json", manifest({ checks: ["identify"], autoApply: ["merged"] }))).reasonCode,
    cfg(writeManifest("a2.json", manifest({ checks: ["identify", "merged"], autoApply: ["identify"] }))).reasonCode,
    cfg(writeManifest("a3.json", manifest({ autoApply: "merged" }))).reasonCode,
    cfg(writeManifest("a4.json", manifest({ autoApply: ["merged", "merged"] }))).reasonCode,
  ], [null, "LOCAL_MANIFEST_INVALID", "LOCAL_MANIFEST_INVALID", "LOCAL_MANIFEST_INVALID", "LOCAL_MANIFEST_INVALID"],
  "autoApply names only measured questions the product can apply by itself (merged), once each");
  checks.equal(cfg(auto).local.autoApply, ["merged"], "the manifest's autoApply reaches the relay's configuration");

  const opened = [], fakes = [];
  let dirN = 0;
  const log = { log: () => {}, error: () => {} };
  const relayWith = async (m, fake) => {
    const config = core.configFromEnv({ VLM_PROVIDER: "local", VLM_DATA_DIR: path.join(tmp, "d" + (++dirN)), PORT: "0", VLM_LOCAL_URL: fake.baseURL, VLM_LOCAL_MANIFEST: m }, { repoRoot });
    const r = await startRelay({ config, log });
    opened.push(r);
    return r;
  };
  try {
    const fake = await startFakeLocalVlm({ serving: SERVING, fallback: () => "No." });
    fakes.push(fake);
    const r = await relayWith(auto, fake);
    const st = await fetch(r.baseUrl + "/vlm-relay/status").then((x) => x.json());
    checks.equal([st.local.checks, st.local.autoApply], [["merged"], ["merged"]], "status names what is asked and what is applied by itself");

    // ---- the review screen: an analysis, the look by itself, the answer applied ----
    const planPng = "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64");
    const openReview = async (relay) => {
      await openApp(page, relay.baseUrl, { lang: "en" });
      await createBlankEvent(page, { name: "Auto apply", date: futureDate() });
      await importPlan(page, planPng);
      await runDetection(page);
      await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; ui.selectedCandidateId = null; render(); });
    };
    await openReview(r);
    await page.waitForFunction(() => { const v = state.events[0].analysis.vlm; return v && v.mode === "check" && v.status !== "running"; }, null, { timeout: 120000 });
    const after = await page.evaluate(() => {
      const a = state.events[0].analysis, run = a.vlm;
      const key = (ids) => ids.slice().sort().join("|");
      const groups = new Set(a.planIntelligence.furnitureGroups.filter((g) => g.memberIds.length > 1).map((g) => key(g.memberIds)));
      return {
        merged: run.checks.filter((c) => c.question === "merged").map((c) => ({ id: c.id, ids: c.candidateIds, verdict: c.verdict })),
        decisions: JSON.parse(JSON.stringify(a.groupingDecisions || [])),
        findings: run.findings.map((f) => ({ id: f.id, state: f.state, appliedBy: f.appliedBy || null, decisionId: f.decisionId || null, ids: null })),
        stillGrouped: run.checks.filter((c) => c.question === "merged").filter((c) => groups.has(key(c.candidateIds))).length,
        examples: state.verifiedExamples.filter((x) => x.kind === "grouping-question").length,
        audits: state.audit.filter((x) => x.action === "VLM_AUTO_APPLIED").length,
        runId: run.runId,
      };
    });
    const differs = after.merged.filter((c) => c.verdict === "DIFFERS");
    checks.require(differs.length >= 1, "the real plan has pushed-together tables the look asked about, and both looks said separate", after.merged);
    checks.ok(after.decisions.length === differs.length && after.decisions.every((d) => d.decision === "separate" && d.by === "model" && d.vlm && d.vlm.runId === after.runId)
      && differs.every((c) => after.decisions.some((d) => d.memberIds.slice().sort().join() === c.ids.slice().sort().join())),
      "each shared 'separate' became the grouping answer for those tables, marked as the model's and its run", after.decisions);
    checks.equal(after.stillGrouped, 0, "the plan regrouped at once: the tables the model separated are no longer one group");
    checks.ok(after.findings.length === differs.length && after.findings.every((f) => f.state === "applied" && f.appliedBy === "model" && after.decisions.some((d) => d.id === f.decisionId)),
      "each finding says the model applied it, and which answer it wrote", after.findings);
    checks.equal([after.examples, after.audits], [0, differs.length], "never a training example; every change is in the audit");

    // the panel says so and offers Undo
    await page.click('[data-vlm-action="toggle"]');
    await page.waitForSelector(".vlm-panel .vlm-findings");
    const row = await page.evaluate(() => document.querySelector(".vlm-panel .vlm-finding.state-applied")?.textContent || "");
    checks.ok(/Applied by the model/.test(row) && /Undo/.test(row), "the finding reads 'Applied by the model' with an Undo beside it", row.slice(0, 200));
    const first = after.findings[0];
    await page.click(`[data-vlm-action="undo"][data-vlm-finding="${first.id}"]`);
    await page.waitForTimeout(200);
    const undone = await page.evaluate((fid) => {
      const a = state.events[0].analysis, f = a.vlm.findings.find((x) => x.id === fid), c = a.vlm.checks.find((x) => fid.endsWith("-check-" + x.id));
      const key = (ids) => ids.slice().sort().join("|");
      return { state: f.state, decisions: (a.groupingDecisions || []).length, regrouped: a.planIntelligence.furnitureGroups.some((g) => key(g.memberIds) === key(c.candidateIds)) };
    }, first.id);
    checks.equal(undone, { state: "open", decisions: after.decisions.length - 1, regrouped: true }, "Undo removes exactly that answer: the tables are one group again and the finding is open", undone);

    // ---- without autoApply the same look applies nothing ---------------------------
    const r2 = await relayWith(writeManifest("noauto.json", manifest()), fake);
    await openReview(r2);
    await page.waitForFunction(() => { const v = state.events[0].analysis.vlm; return v && v.mode === "check" && v.status !== "running"; }, null, { timeout: 120000 });
    const none = await page.evaluate(() => ({ decisions: (state.events[0].analysis.groupingDecisions || []).length, open: state.events[0].analysis.vlm.findings.every((f) => f.state === "open") }));
    checks.equal(none, { decisions: 0, open: true }, "a manifest without autoApply: the same answers stay suggestions");
  } finally {
    for (const r of opened) await r.close();
    for (const fk of fakes) await fk.close().catch(() => null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
