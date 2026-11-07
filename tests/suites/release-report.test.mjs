// THE RELEASE REPORT TURNS CI RED WHEN A RELEASE GATE FAILS — AND ONLY THEN.
//
// `scripts/release-report.mjs` is the one "ready to ship" verdict: it reads the
// classes from `.claude/skills/merit-ci-quality-gates/SKILL.md`, the steps
// from `.github/workflows/ci.yml`, every job's recorded step outcomes and the
// jobs' own results, and exits 1 when any RELEASE GATE row is not PASS. This
// suite proves that claim by RUNNING THE SCRIPT on fixtures built from the
// real workflow, with one thing wrong at a time:
//
//   every gate passed                     → exit 0, READY TO SHIP
//   one release gate failed               → exit 1, the row FAIL and named as blocking
//   one job never recorded (cancelled)    → exit 1, its gates NOT RUN — not passed
//   a job failed in setup, steps all green→ exit 1, the job row FAIL
//   the secret scan found something       → exit 1
//   a CI step with no class in the skill  → exit 1, the step named
//   an INFO row failed                    → exit 0, the row shown as FAIL in INFO
//   the known fails                       → listed in every report as NOT passing
//
// and that the workflow is wired so the script sees everything: every job
// records its outcomes `if: always()` and uploads them, every gate step has
// the id the script reads, and the release-report job needs every other job,
// runs `if: always()`, uses none of the fixture seams, and uploads the report.
//
// MUTATION PROOF, recorded 2026-11-01: `releaseVerdict` blocking only on FAIL
// (NOT RUN waved through) fails "a gate that did not run blocks" and the
// cancelled-job case; the script exiting 0 whatever the verdict fails all six
// red cases, the deliberate failing gate first.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const meta = { name: "release-report", tags: ["business", "fast"], timeout: 120000 };

export default async function run({ checks, repoRoot }) {
  const load = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
  const R = await load("scripts/release-report.mjs");
  const S = await load("scripts/secret-scan.mjs");
  const ciText = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const skillText = fs.readFileSync(path.join(repoRoot, ".claude/skills/merit-ci-quality-gates/SKILL.md"), "utf8");
  const workflow = R.readWorkflow(ciText);
  const classification = R.readClassification(skillText);
  const gateJobs = workflow.filter((j) => j.name !== "release-report");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "release-report-"));

  // --- 1. the decision function ---------------------------------------------
  const v = (rows) => R.releaseVerdict(rows);
  checks.ok(v([{ cls: "RELEASE GATE", result: "PASS" }, { cls: "INFO", result: "FAIL" }]).pass, "a failing INFO row does not block");
  checks.ok(!v([{ cls: "RELEASE GATE", result: "PASS" }, { cls: "RELEASE GATE", result: "FAIL" }]).pass, "a failing gate blocks");
  checks.ok(!v([{ cls: "RELEASE GATE", result: "NOT RUN" }]).pass, "a gate that did not run blocks — not run is not passed");
  checks.ok(!v([{ cls: "INFO", result: "PASS" }]).pass, "a report with no release gate at all is not a pass");
  checks.ok(v([{ cls: "WARNING", result: "FAIL" }, { cls: "RELEASE GATE", result: "PASS" }]).pass, "a WARNING does not block");

  // --- 2. the script, run on fixtures from the real workflow ----------------
  const allSuccess = () => Object.fromEntries(gateJobs.map((j) => [j.name, { job: j.name, sha: "fixture", steps: Object.fromEntries(j.steps.filter((s) => s.id).map((s) => [s.id, { outcome: "success" }])) }]));
  const needsOk = () => Object.fromEntries(gateJobs.map((j) => [j.name, { result: "success" }]));
  const ownOk = { "secret-scan": "success", "doc-drift": "success", "detector-fingerprint": "success" };
  let n = 0;
  const runReport = ({ records = allSuccess(), needs = needsOk(), own = ownOk, root = repoRoot } = {}) => {
    const dir = path.join(tmp, `case-${++n}`), out = path.join(dir, "REPORT.md");
    fs.mkdirSync(path.join(dir, "results"), { recursive: true });
    for (const r of Object.values(records)) fs.writeFileSync(path.join(dir, "results", `${r.job}.json`), JSON.stringify(r));
    const env = { ...process.env, NEEDS_JSON: JSON.stringify(needs) };
    delete env.GITHUB_STEP_SUMMARY;
    const r = spawnSync(process.execPath, [path.join(repoRoot, "scripts/release-report.mjs"), "report", "--root", root, "--collect", path.join(dir, "results"), "--out", out, "--own-outcomes", JSON.stringify(own)], { cwd: repoRoot, encoding: "utf8", env });
    return { status: r.status, out: r.stdout + r.stderr, md: fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "" };
  };
  const row = (md, command) => (md.split("\n").find((l) => l.startsWith(`| \`${command}\``)) || "");

  const green = runReport();
  checks.equal(green.status, 0, "every gate passed: the script exits 0", green.out.slice(-600));
  checks.ok(/READY TO SHIP — every release gate passed/.test(green.md), "and the report says READY TO SHIP");
  checks.ok(/a2-mixed-families/.test(green.md) && /a6-architectural-confusion/.test(green.md) && /NOT passing/.test(green.md),
    "a green report still lists the accepted adversarial FAILs, as accepted and NOT passing");
  checks.ok(/Visual Plan Memory §23 retention/.test(green.md) && /NOT MET/.test(green.md), "and the §23 memory threshold as NOT MET");
  const releaseRows = green.md.slice(green.md.indexOf("## Release gates"), green.md.indexOf("## INFO"));
  checks.ok(/`npm run benchmark:baseline`/.test(releaseRows) && /`npm test`/.test(releaseRows) && /`npm run verify:offline`/.test(releaseRows) && /`node scripts\/secret-scan.mjs`/.test(releaseRows),
    "the release-gate table names the suites, the offline verify, the detector baseline and the secret scan");
  checks.ok(!/`npm run benchmark` \|/.test(releaseRows) && /`npm run benchmark` \| INFO/.test(green.md), "the bare benchmark is INFO, in the INFO section, not a gate");

  // THE DELIBERATE FAILING GATE.
  const failed = allSuccess();
  failed.detection.steps["benchmark-baseline"] = { outcome: "failure" };
  const red = runReport({ records: failed });
  checks.equal(red.status, 1, "ONE release gate failed (the detector baseline): the script exits 1, so the release-report job — and CI — is red", red.out.slice(-400));
  checks.ok(/\*\*FAIL\*\*/.test(row(red.md, "npm run benchmark:baseline")) && /## Blocking[\s\S]*benchmark:baseline/.test(red.md) && /NOT READY/.test(red.md),
    "the report marks the row FAIL and lists it under Blocking");

  const missing = allSuccess();
  delete missing.performance;
  const cancelled = runReport({ records: missing });
  checks.equal(cancelled.status, 1, "a job that never recorded its outcomes (cancelled, timed out) blocks");
  checks.ok(/\*\*NOT RUN\*\*/.test(row(cancelled.md, "npm run perf")), "and its gates read NOT RUN, not PASS");

  const setup = runReport({ needs: { ...needsOk(), offline: { result: "failure" } } });
  checks.equal(setup.status, 1, "a job that failed outside its npm steps (checkout, npm ci, browser install) blocks");
  checks.ok(/\*\*FAIL\*\*/.test(row(setup.md, "job offline")), "through its job row");

  const secret = runReport({ own: { ...ownOk, "secret-scan": "failure" } });
  checks.equal(secret.status, 1, "a secret-scan finding blocks");

  const info = allSuccess();
  info.detection.steps.benchmark = { outcome: "failure" };
  const infoRun = runReport({ records: info, own: { ...ownOk, "detector-fingerprint": "failure" } });
  checks.equal(infoRun.status, 0, "a failing INFO row (the bare benchmark, the detector fingerprint) does not block");
  checks.ok(/\| INFO \| FAIL \|/.test(row(infoRun.md, "npm run benchmark")) && /\| INFO \| FAIL \|/.test(row(infoRun.md, "node benchmarks/detector-fingerprint.mjs --compare")),
    "and is shown as FAIL in the INFO section, never hidden");

  // A CI step with no class: a copy of the root whose workflow gained one.
  const alt = path.join(tmp, "alt-root");
  for (const rel of [".github/workflows/ci.yml", ".claude/skills/merit-ci-quality-gates/SKILL.md", "benchmarks/adversarial/KNOWN-FAILS.json", "benchmarks/false-positives/KNOWN-FAILS.json", "benchmarks/memory/report.json"]) {
    fs.mkdirSync(path.dirname(path.join(alt, rel)), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, rel), path.join(alt, rel));
  }
  fs.writeFileSync(path.join(alt, ".github/workflows/ci.yml"), ciText.replace("      - name: Performance suites\n", "      - run: npm run benchmark:heldout\n        id: benchmark-heldout\n      - name: Performance suites\n"));
  const unclassified = runReport({ root: alt });
  checks.equal(unclassified.status, 1, "a CI step with no row in the classification blocks");
  checks.ok(/Unclassified CI steps[\s\S]*benchmark:heldout/.test(unclassified.md), "and the report names it");

  // --- 3. the workflow is wired so the script sees everything ---------------
  checks.ok(gateJobs.length === 5 && workflow.length === 6, "five gate jobs and the release-report job", workflow.map((j) => j.name));
  for (const job of gateJobs) {
    const steps = job.steps;
    const rec = steps.findIndex((s) => s.run && s.run.startsWith("node scripts/release-report.mjs record --job ${{ github.job }}"));
    const up = steps.findIndex((s) => s.uses && s.uses.startsWith("actions/upload-artifact"));
    checks.ok(rec === steps.length - 2 && steps.slice(rec + 1).some((s) => s.uses?.startsWith("actions/upload-artifact")),
      `${job.name}: records its step outcomes and uploads them as its LAST two steps`, { rec, up, n: steps.length });
    const misnamed = steps.filter((s) => s.run && /^npm (test|run )/.test(s.run) && s.id !== R.stepId(s.run)).map((s) => s.run);
    checks.equal(misnamed, [], `${job.name}: every npm step carries the id the report reads`);
  }
  const recordBlocks = ciText.split("- name: Record gate outcomes for the release report").slice(1);
  checks.ok(recordBlocks.length === 5 && recordBlocks.every((b) => /^\s*\n\s*if: always\(\)\s*\n\s*env:\s*\n\s*STEPS_JSON: \$\{\{ toJSON\(steps\) \}\}/.test(b)),
    "each record step runs if: always() with the job's own step outcomes — a failed job is recorded too");
  checks.ok((ciText.match(/name: release-\$\{\{ github\.job \}\}\n\s*path: release\/results\/\n\s*if-no-files-found: error/g) || []).length === 5,
    "and each upload carries the job's name, so the collector can tell a missing job from a passing one");
  const relJob = ciText.slice(ciText.indexOf("\n  release-report:"));
  checks.ok(/\n    needs: \[fast-core, detection, offline, intelligence, performance\]\n    if: always\(\)/.test(relJob), "release-report needs every gate job and runs whatever they concluded");
  checks.ok(/run: npm run release:report -- --collect release\/results/.test(relJob) && /NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}/.test(relJob),
    "it runs the report on the collected outcomes, with the jobs' own results");
  checks.ok(!/--own-outcomes|--no-own-gates|--no-needs|--only/.test(ciText), "CI uses none of the fixture seams");
  checks.ok(/name: release-report\n\s*path: \|\n\s*benchmarks\/RELEASE-REPORT\.md/.test(relJob), "and uploads benchmarks/RELEASE-REPORT.md");
  checks.ok(/"release:report": "node scripts\/release-report.mjs report"/.test(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")), "npm run release:report is the report mode");

  // The gates the script runs itself carry the class the skill gives them.
  for (const g of R.OWN_GATES) {
    const c = classification.get(g.command.replace(/ --.*$/, ""));
    checks.equal(c && c.cls, g.cls, `${g.command}: the script's class matches the skill's row`);
  }

  // --- 4. the secret scanner bites, and is quiet on this tree ---------------
  const fakeAnthropic = "sk-ant-api03-" + "A1b2C3d4E5".repeat(9) + "-AA";
  const fakeGithub = "ghp_" + "Z9y8X7w6V5".repeat(3) + "u4t3s2";
  const pemHeader = "-----BEGIN OPENSSH " + "PRIVATE KEY-----"; // split, so this file is not itself a finding
  const planted = S.scanText(`const k = "${fakeAnthropic}";\ntoken=${fakeGithub}\n${pemHeader}\n`, "planted.js");
  checks.equal(planted.map((f) => f.kind), ["Anthropic API key", "GitHub token", "private key"], "mutation: an Anthropic key, a GitHub token and a private key planted in a file are each found");
  checks.ok(planted.every((f) => !JSON.stringify(f).includes(fakeAnthropic.slice(14, 40)) && !JSON.stringify(f).includes(fakeGithub.slice(4))), "and a finding never carries the value");
  checks.equal(S.scanText(`const KEY = "sk-ant-relaytest-fake-0123456789abcdef"; ANTHROPIC_API_KEY: "sk-ant-test-0000000000"`).length, 0,
    "the suites' short fake keys are not credentials");
  const tree = S.scanTree(repoRoot);
  checks.equal(tree.findings.map((f) => `${f.kind} at ${f.file}:${f.line}`), [], `no credential in the ${tree.scanned} text files git tracks`);
  checks.ok(tree.scanned > 500, "(the scan read the tree)", tree.scanned);
  fs.rmSync(tmp, { recursive: true, force: true });
}
