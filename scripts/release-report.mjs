// ONE HONEST "READY TO SHIP" REPORT: EVERY RELEASE GATE, PASS OR FAIL, WITH ITS EVIDENCE.
//
// `.claude/skills/merit-ci-quality-gates/SKILL.md` classifies every check CI
// runs as INFO, WARNING or RELEASE GATE. This turns that table into one
// verdict and one file, `benchmarks/RELEASE-REPORT.md`:
//
//   RELEASE GATES   each row PASS / FAIL / NOT RUN, the job(s) that ran it and
//                   the evidence file. Any row that is not PASS blocks — a gate
//                   that did not run is not a gate that passed.
//   INFO / WARNING  in their own section, never blocking, never folded into
//                   the verdict.
//   KNOWN FAILS     every accepted failure, read from the files that accept it
//                   (adversarial and false-positives KNOWN-FAILS.json, the §23
//                   memory thresholds) and printed as FAIL-ACCEPTED with its
//                   reason and owner. Never hidden, never described as passing.
//
// THE CLASSES ARE NOT WRITTEN HERE. They are read from the skill's table, and
// the steps from .github/workflows/ci.yml, so the report cannot drift from the
// classification CI is held to: a CI step with no row is an error, and a row
// marked RELEASE GATE that no job runs is NOT RUN, which blocks.
//
// Modes:
//   node scripts/release-report.mjs record --job <job>
//        In CI, the last step of every job (if: always()). Reads the job's
//        step outcomes from $STEPS_JSON (`toJSON(steps)`) and writes
//        release/results/<job>.json for the release-report job to collect.
//   node scripts/release-report.mjs report --collect release/results [--fingerprint]
//        In CI, the release-report job. Merges every job's record with the
//        jobs' own results ($NEEDS_JSON, `toJSON(needs)`), runs the gates
//        that belong to no other job (secret scan, doc-drift; the detector
//        fingerprint as INFO with --fingerprint), writes the report, and
//        EXITS 1 WHEN ANY RELEASE GATE IS NOT PASS.
//   node scripts/release-report.mjs report --run [--only id,id] [--fingerprint]
//        Locally: runs every CI command itself, in order, and reports.
//        `--only` runs a subset; every other gate is NOT RUN, and blocks.
//
// The decision is `releaseVerdict()`; `tests/suites/release-report.test.mjs`
// feeds it every case and runs this script on a fixture with one failing gate
// to prove the exit code turns CI red.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");

// --- reading the classification and the workflow ---------------------------

export const stepId = (command) => command.replace(/^npm test\b/, "test").replace(/^npm run /, "").replace(/\s+--.*$/, "").replace(/[^A-Za-z0-9_-]/g, "-");

export function readClassification(skillText) {
  const table = skillText.slice(skillText.indexOf("## The classification of every CI check"));
  const rows = new Map();
  for (const line of table.split("\n")) {
    const m = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (!m) continue;
    const cls = /^RELEASE GATE/.test(m[2]) ? "RELEASE GATE" : /^WARNING/.test(m[2]) ? "WARNING" : /^INFO/.test(m[2]) ? "INFO" : null;
    if (!cls) continue;
    const command = m[1].replace(/ --.*$/, "");
    rows.set(command, { command: m[1], cls, classText: m[2], red: m[3] });
  }
  return rows;
}

export function readWorkflow(ciText) {
  const jobs = [];
  const jobsAt = ciText.search(/^jobs:\s*$/m);
  if (jobsAt < 0) return jobs;
  const parts = ciText.slice(jobsAt).split(/\n  (?=[a-z][a-z0-9-]*:\n)/).slice(1);
  for (const part of parts) {
    const name = part.split(":")[0];
    const needs = (/\n    needs:\s*\[([^\]]*)\]/.exec(part) || [, ""])[1].split(",").map((s) => s.trim()).filter(Boolean);
    const steps = [];
    for (const chunk of part.split(/\n      - /).slice(1)) {
      const run = (/(?:^|\n\s*)run: (.+)/.exec(chunk) || [])[1];
      const id = (/(?:^|\n\s*)id: ([A-Za-z0-9_-]+)/.exec(chunk) || [])[1];
      const uses = (/(?:^|\n\s*)uses: (\S+)/.exec(chunk) || [])[1];
      steps.push({ run: run && run.trim(), id, uses });
    }
    jobs.push({ name, needs, steps });
  }
  return jobs;
}

// The gates this script runs itself, in the release-report job (they belong to
// no other job). Their classes are written in the skill like every other row.
export const OWN_GATES = [
  { id: "secret-scan", command: "node scripts/secret-scan.mjs", cls: "RELEASE GATE", evidence: "release/evidence/secret-scan.txt",
    red: "a credential-shaped string (Anthropic/OpenAI/GitHub/AWS/Slack/Google/Hugging Face/Stripe key, a private key, a tracked .env) in any file git tracks" },
  { id: "doc-drift", command: "node tests/run.mjs doc-drift", cls: "RELEASE GATE", evidence: "release/evidence/doc-drift.txt",
    red: "a documented CURRENT figure that no longer matches the code (also inside `npm test`; listed alone so the report names it)" },
  { id: "detector-fingerprint", command: "node benchmarks/detector-fingerprint.mjs --compare", cls: "INFO", optional: "--fingerprint", evidence: "benchmarks/reports/detector-fingerprint.json",
    red: "never in CI: a detector change is EXPECTED to change it. A RELEASE GATE only for a structural detector commit, which must report every plan IDENTICAL" },
];

// Where each CI command leaves its evidence.
export const EVIDENCE = {
  "test": "the job log (every suite and check, printed; downloads in tests/.artifacts/)",
  "test-slow": "the job log (every suite and check, printed; downloads in tests/.artifacts/)",
  "vendor-test": ".vendor-cache/ (pinned OCR/SheetJS/PDF.js tarballs)",
  "audit-deps": "the job log (npm audit --omit=dev summary)",
  "build-offline": "dist/index-offline.html",
  "build-offline-full": "dist/merit-offline/",
  "verify-offline": "the job log (every check of the built artifacts, run)",
  "benchmark": "benchmarks/reports/latest.json (artifact benchmark-report)",
  "benchmark-baseline": "benchmarks/reports/latest.json vs benchmarks/BASELINE.json",
  "benchmark-adversarial": "benchmarks/adversarial/latest.json vs BASELINE.json + KNOWN-FAILS.json",
  "benchmark-memory": "benchmarks/memory/report.json (artifact memory-report) vs BASELINE.json",
  "benchmark-review-order": "benchmarks/review-order/",
  "benchmark-facts": "benchmarks/interpreter/",
  "benchmark-contradictions": "benchmarks/contradictions/",
  "benchmark-zones": "benchmarks/zones/",
  "benchmark-false-positives": "benchmarks/false-positives/ + KNOWN-FAILS.json",
  "benchmark-teaching": "benchmarks/teach-ai/",
  "perf": "benchmarks/perf/ (BUDGETS.json; enforced under CI=true)",
  "release-report": "benchmarks/RELEASE-REPORT.md (artifact release-report)",
};

// --- the decision --------------------------------------------------------------

const OUTCOME = { success: "PASS", failure: "FAIL", cancelled: "NOT RUN", skipped: "NOT RUN" };

// rows: [{ id, cls, result: PASS|FAIL|NOT RUN, ... }] → the verdict.
export function releaseVerdict(rows) {
  const blocking = rows.filter((r) => r.cls === "RELEASE GATE" && r.result !== "PASS");
  const gates = rows.filter((r) => r.cls === "RELEASE GATE");
  return { pass: gates.length > 0 && blocking.length === 0, gates: gates.length, blocking };
}

// Merge every job's recorded step outcomes into one row per gate.
export function buildRows({ workflow, classification, records, needs = null, own = [] }) {
  const rows = [], unclassified = [];
  const byId = new Map();
  for (const job of workflow) {
    if (job.name === "release-report") continue;
    for (const step of job.steps) {
      if (!step.run || !/^npm (test|run )/.test(step.run)) continue;
      const command = step.run.replace(/ --.*$/, "");
      const cls = classification.get(command);
      if (!cls) { unclassified.push(step.run); continue; }
      const id = step.id || stepId(step.run);
      if (!byId.has(id)) byId.set(id, { id, command: step.run, cls: cls.cls, red: cls.red, jobs: [], outcomes: [], missingId: [] });
      const row = byId.get(id);
      row.jobs.push(job.name);
      if (!step.id) row.missingId.push(job.name);
      const rec = records[job.name];
      const outcome = rec && rec.steps && rec.steps[id] && rec.steps[id].outcome;
      row.outcomes.push({ job: job.name, result: outcome ? (OUTCOME[outcome] || "FAIL") : "NOT RUN", raw: outcome || (rec ? "step not recorded" : "job not recorded") });
    }
  }
  for (const row of byId.values()) {
    // A gate several jobs run passes only if it passed in every one of them.
    row.result = row.outcomes.every((o) => o.result === "PASS") ? "PASS" : row.outcomes.some((o) => o.result === "FAIL") ? "FAIL" : "NOT RUN";
    row.evidence = EVIDENCE[row.id] || "the job log";
    rows.push(row);
  }
  // The jobs themselves: a failed checkout or browser install fails no npm
  // step, and must still block. In CI `needs` is the jobs' own results; a job
  // missing from it did not run. Locally there are no jobs (needs === null).
  if (needs) for (const job of workflow) {
    if (job.name === "release-report") continue;
    const result = needs[job.name] ? OUTCOME[needs[job.name].result] || "FAIL" : "NOT RUN";
    rows.push({ id: `job:${job.name}`, command: `job ${job.name}`, cls: "RELEASE GATE", red: "any step of the job failing, including setup (checkout, npm ci, browser install)", jobs: [job.name], result, evidence: "the job's own log", outcomes: [{ job: job.name, result, raw: needs[job.name]?.result || "not in needs" }] });
  }
  for (const g of own) rows.push({ ...g, jobs: ["release-report"] });
  return { rows, unclassified };
}

// --- known fails, never hidden -------------------------------------------------

export function knownFails(root, evidenceDir = null) {
  const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return null; } };
  const out = [];
  const adv = read("benchmarks/adversarial/KNOWN-FAILS.json");
  for (const f of adv?.fails || []) out.push({ where: `adversarial fixture ${f.planId}`, codes: (f.codes || []).join(", "), why: f.why, consequence: f.consequence, owner: f.owner, source: "benchmarks/adversarial/KNOWN-FAILS.json" });
  const fp = read("benchmarks/false-positives/KNOWN-FAILS.json");
  for (const [variant, n] of Object.entries(fp?.acceptedHeldReal || {}))
    out.push({ where: `false-positives rendering "${variant}"`, codes: `${n} real table(s) held back`, why: fp.why, consequence: fp.consequence, owner: fp.owner, source: "benchmarks/false-positives/KNOWN-FAILS.json" });
  const memPath = evidenceDir && fs.existsSync(path.join(evidenceDir, "report.json")) ? path.join(evidenceDir, "report.json") : path.join(root, "benchmarks/memory/report.json");
  let mem = null; try { mem = JSON.parse(fs.readFileSync(memPath, "utf8")); } catch {}
  if (mem?.totals) {
    const t = mem.totals, targets = [["retention", t.retentionFull, ">= 0.98", t.retentionFull >= 0.98], ["identity precision", t.identityPrecisionFull, ">= 0.98", t.identityPrecisionFull >= 0.98], ["wrong application rate", t.wrongApplicationRateFull, "<= 0.01", t.wrongApplicationRateFull <= 0.01]];
    for (const [name, value, target, met] of targets) if (!met)
      out.push({ where: `Visual Plan Memory §23 ${name}`, codes: `${value} (target ${target}) — NOT MET`, why: "No setting reaches the §23 thresholds on transformed renderings of the plan (a signal problem, measured in §9). The CI gate is a regression gate against benchmarks/memory/BASELINE.json, not the §23 target.", consequence: "A decision made on one rendering of a plan is not always carried to a transformed rendering of it, and has to be made again; a wrong application is gated separately (the CI regression gate blocks one more).", owner: "not named in benchmarks/memory/BASELINE.json", source: path.relative(root, memPath) || memPath });
  }
  return out;
}

// --- the report ----------------------------------------------------------------

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");

export function renderReport({ rows, unclassified, verdict, known, meta }) {
  const L = [];
  L.push("# MERIT EVENT MAKER — RELEASE REPORT", "");
  L.push(`> Generated by \`scripts/release-report.mjs\` — do not edit by hand. ${meta.mode === "ci" ? "Collected from the CI run below." : "LOCAL run: only the gates this machine ran are PASS/FAIL; every other gate is NOT RUN and blocks."}`, "");
  L.push(`- **Verdict: ${verdict.pass ? "READY TO SHIP — every release gate passed" : `NOT READY — ${verdict.blocking.length} of ${verdict.gates} release gate(s) not passed`}**`);
  L.push(`- Commit: \`${meta.sha || "unknown"}\`${meta.ref ? ` on \`${meta.ref}\`` : ""}`);
  if (meta.runUrl) L.push(`- CI run: ${meta.runUrl}`);
  L.push(`- Generated: ${meta.at}`);
  L.push(`- Classification: \`.claude/skills/merit-ci-quality-gates/SKILL.md\` (read, not copied). "Green" means the RELEASE GATE rows passed — **not** that the INFO rows or the known fails below are met.`, "");
  if (verdict.blocking.length) {
    L.push("## Blocking", "");
    for (const r of verdict.blocking) L.push(`- **${r.result}** \`${r.command}\`${r.outcomes?.length ? ` — ${r.outcomes.filter((o) => o.result !== "PASS").map((o) => `${o.job}: ${o.raw}`).join("; ")}` : ""}`);
    L.push("");
  }
  if (unclassified.length) {
    L.push("## Unclassified CI steps (an error: every check needs a class)", "");
    for (const u of unclassified) L.push(`- \`${u}\``);
    L.push("");
  }
  L.push("## Release gates", "", "| Gate | Result | Job(s) | Evidence | What turns it red |", "|---|---|---|---|---|");
  for (const r of rows.filter((r) => r.cls === "RELEASE GATE"))
    L.push(`| \`${cell(r.command)}\` | **${r.result}** | ${cell(r.jobs.join(", "))} | ${cell(r.evidence)} | ${cell(r.red)} |`);
  L.push("", "## INFO and WARNING — reported, never blocking", "", "| Check | Class | Result | Evidence | Note |", "|---|---|---|---|---|");
  const info = rows.filter((r) => r.cls !== "RELEASE GATE");
  for (const r of info) L.push(`| \`${cell(r.command)}\` | ${r.cls} | ${r.result} | ${cell(r.evidence)} | ${cell(r.red)} |`);
  if (!info.length) L.push("| — | — | — | — | — |");
  L.push("", "## Known fails — accepted in writing, printed every run, NOT passing", "",
    "Each is listed by the file that accepts it. A listed fail that changes (worse, or stops failing) blocks in its own gate.", "",
    "| Where | What fails | Why | Operator-visible consequence | Owner | Accepted in |", "|---|---|---|---|---|---|");
  for (const k of known) L.push(`| ${cell(k.where)} | ${cell(k.codes)} | ${cell(k.why)} | ${cell(k.consequence)} | ${cell(k.owner)} | \`${cell(k.source)}\` |`);
  if (!known.length) L.push("| — | none listed | | | | |");
  L.push("");
  return L.join("\n");
}

// --- running ----------------------------------------------------------------------

function runCommand(command, logFile) {
  const t0 = Date.now();
  const r = spawnSync(command, { cwd: ROOT, shell: true, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: process.env });
  const out = (r.stdout || "") + (r.stderr || "");
  if (logFile) { fs.mkdirSync(path.dirname(path.join(ROOT, logFile)), { recursive: true }); fs.writeFileSync(path.join(ROOT, logFile), out); }
  process.stdout.write(`  ${r.status === 0 ? "PASS" : "FAIL"}  ${command}  (${Math.round((Date.now() - t0) / 1000)} s)\n`);
  return r.status === 0 ? "PASS" : "FAIL";
}

function arg(flag) { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null; }

function main() {
  const mode = process.argv[2];
  if (mode === "record") {
    const job = arg("--job");
    if (!job) { console.error("record needs --job"); process.exit(2); }
    let steps = {};
    try { steps = JSON.parse(process.env.STEPS_JSON || "{}"); } catch (e) { console.error("STEPS_JSON is not JSON"); process.exit(2); }
    const out = { job, sha: process.env.GITHUB_SHA || null, run: process.env.GITHUB_RUN_ID || null, at: new Date().toISOString(),
      steps: Object.fromEntries(Object.entries(steps).map(([id, s]) => [id, { outcome: s.outcome, conclusion: s.conclusion }])) };
    const dir = path.join(ROOT, arg("--out") || "release/results");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${job}.json`), JSON.stringify(out, null, 2));
    console.log(`recorded ${Object.keys(out.steps).length} step outcome(s) for ${job}: ${Object.entries(out.steps).map(([k, v]) => `${k}=${v.outcome}`).join(" ")}`);
    return;
  }
  if (mode !== "report") { console.error("usage: release-report.mjs record --job <job> | report (--collect <dir> | --run [--only a,b]) [--fingerprint] [--out file]"); process.exit(2); }

  const root = arg("--root") ? path.resolve(arg("--root")) : ROOT;
  const classification = readClassification(fs.readFileSync(path.join(root, ".claude/skills/merit-ci-quality-gates/SKILL.md"), "utf8"));
  const workflow = readWorkflow(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));
  const skipOwn = process.argv.includes("--no-own-gates");
  let records = {}, needs = null, meta;

  if (process.argv.includes("--run")) {
    const only = arg("--only") ? new Set(arg("--only").split(",")) : null;
    const seen = new Set(), steps = {};
    for (const job of workflow) for (const s of job.steps) {
      if (!s.run || !/^npm (test|run )/.test(s.run)) continue;
      const id = s.id || stepId(s.run);
      if (seen.has(id) || id === "release-report" || (only && !only.has(id))) continue;
      seen.add(id);
      steps[id] = { outcome: runCommand(s.run, `release/evidence/${id}.txt`) === "PASS" ? "success" : "failure" };
    }
    // Locally there is one machine: a gate it ran counts for every job that runs it.
    for (const job of workflow) records[job.name] = { steps: Object.fromEntries(job.steps.map((s) => s.id || (s.run && stepId(s.run))).filter((id) => id && steps[id]).map((id) => [id, steps[id]])) };
    const git = (a) => spawnSync("git", a, { cwd: root, encoding: "utf8" }).stdout.trim();
    meta = { mode: "local", sha: git(["rev-parse", "HEAD"]), ref: git(["rev-parse", "--abbrev-ref", "HEAD"]), at: new Date().toISOString() };
  } else {
    const dir = path.resolve(root, arg("--collect") || "release/results");
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : []) {
      try { const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); records[r.job] = r; } catch { /* an unreadable record is a missing one */ }
    }
    // Without the jobs' own results nothing vouches for the setup steps: every
    // job row is then NOT RUN, which blocks (pass --no-needs for a fixture).
    if (!process.argv.includes("--no-needs")) { try { needs = JSON.parse(process.env.NEEDS_JSON || "{}"); } catch { needs = {}; } }
    const server = process.env.GITHUB_SERVER_URL, repo = process.env.GITHUB_REPOSITORY, run = process.env.GITHUB_RUN_ID;
    meta = { mode: "ci", sha: process.env.GITHUB_SHA || Object.values(records)[0]?.sha, ref: process.env.GITHUB_REF_NAME, runUrl: server && repo && run ? `${server}/${repo}/actions/runs/${run}` : null, at: new Date().toISOString() };
  }

  const own = [];
  // A TEST SEAM, for the release-report suite's fixtures only: the outcomes of
  // the gates this script would run itself. CI never passes it, and the suite
  // fails if the workflow does.
  let ownOutcomes = null;
  if (arg("--own-outcomes")) { try { ownOutcomes = JSON.parse(arg("--own-outcomes")); } catch { console.error("--own-outcomes is not JSON"); process.exit(2); } }
  for (const g of OWN_GATES) {
    if (ownOutcomes) { own.push({ ...g, result: OUTCOME[ownOutcomes[g.id]] || "NOT RUN" }); continue; }
    if (skipOwn) { own.push({ ...g, result: "NOT RUN" }); continue; }
    if (g.optional && !process.argv.includes(g.optional)) { own.push({ ...g, result: "NOT RUN", red: `${g.red} (not run: pass ${g.optional})` }); continue; }
    own.push({ ...g, result: runCommand(g.command, `release/evidence/${g.id}.txt`) });
  }

  const { rows, unclassified } = buildRows({ workflow, classification, records, needs, own });
  if (unclassified.length) rows.push({ id: "classification", command: "every CI step classified", cls: "RELEASE GATE", result: "FAIL", jobs: [], evidence: ".claude/skills/merit-ci-quality-gates/SKILL.md", red: `unclassified: ${unclassified.join(", ")}` });
  const verdict = releaseVerdict(rows);
  const known = knownFails(root, arg("--evidence") ? path.resolve(root, arg("--evidence")) : null);
  const md = renderReport({ rows, unclassified, verdict, known, meta });
  const outFile = path.resolve(root, arg("--out") || "benchmarks/RELEASE-REPORT.md");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, md + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n"); } catch {} }
  console.log(`\n${verdict.pass ? "READY TO SHIP" : "NOT READY"}: ${verdict.gates - verdict.blocking.length}/${verdict.gates} release gates passed; ${known.length} known fail(s) listed; report at ${path.relative(root, outFile)}`);
  for (const b of verdict.blocking) console.log(`  BLOCKING ${b.result}  ${b.command}`);
  process.exit(verdict.pass ? 0 : 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
