#!/usr/bin/env node
// The detector's recorded baseline, and the check against it.
//
//   node benchmarks/record-baseline.mjs            compare a fresh run to the baseline
//   node benchmarks/record-baseline.mjs --record   overwrite the baseline with this run
//
// Why this exists: "the numbers were better before" is not evidence anybody
// can act on, and neither is a folder of timestamped reports nobody diffs. The
// committed baseline is a specific claim -- these exact per-plan numbers, from
// this commit, on images with these hashes -- and this script is what makes a
// later change contradict it out loud.
//
// It deliberately fails on any DROP and merely reports an improvement. A
// detector change that trades table F1 for chair recall is exactly the case
// the sprint rules say to revert, and it is invisible to a single overall
// score, so every plan is compared field by field.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(ROOT, "BASELINE.json");
const LATEST = path.join(ROOT, "reports", "latest.json");
const RECORD = process.argv.includes("--record");

// Fields worth guarding, and which direction is bad. Counts of mistakes
// (FP/FN) are "lower is better"; everything else is "higher is better".
const GUARDED = [
  ["tables.tp", "up"],
  ["tables.fp", "down"],
  ["tables.fn", "down"],
  ["tables.precision", "up"],
  ["tables.recall", "up"],
  ["tables.f1", "up"],
  ["chairs.detectedTotal", "up"],
  ["humanEffort.reviewGroups", "down"],
  ["humanEffort.uncertainQuestions", "down"],
];

// Guarded only where the annotation carries chair positions. A plan whose
// annotation records a chair TOTAL cannot report chair precision, and
// pretending otherwise would compare a number against nothing.
const GUARDED_WHEN_SPATIAL_CHAIRS = [
  ["chairs.tp", "up"],
  ["chairs.fp", "down"],
  ["chairs.fn", "down"],
  ["chairs.precision", "up"],
  ["chairs.recall", "up"],
  ["chairs.f1", "up"],
];

// Small movements in a float are noise from a rounding change, not a
// regression; anything a person would notice is above this.
const TOLERANCE = 0.005;

function pick(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function fieldsFor(report) {
  return report.chairs && Number.isFinite(report.chairs.tp)
    ? [...GUARDED, ...GUARDED_WHEN_SPATIAL_CHAIRS]
    : GUARDED;
}

function summarise(report) {
  const out = { planId: report.planId, imageShaMatches: report.imageShaMatches, provider: report.provider };
  for (const [field] of fieldsFor(report)) out[field] = pick(report, field);
  return out;
}

if (!fs.existsSync(LATEST)) {
  console.error("No benchmark run found. Run `npm run benchmark` first.");
  process.exit(2);
}
const latest = JSON.parse(fs.readFileSync(LATEST, "utf8"));
const current = latest.reports.map(summarise);

let commit = "unknown";
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.dirname(ROOT) }).toString().trim(); } catch {}

// A guarded field that is not in the report compares to nothing, so a renamed
// field would quietly turn this whole check into a no-op that still prints
// "no regressions". Refuse to record one.
const absent = current.flatMap((plan, i) =>
  fieldsFor(latest.reports[i]).filter(([f]) => typeof plan[f] !== "number").map(([f]) => `${plan.planId}.${f}`));
if (absent.length) {
  console.error("These guarded fields are missing from the benchmark report, so they cannot be compared:");
  for (const field of absent) console.error("  " + field);
  console.error("\nFix the field paths in GUARDED (this script) to match benchmarks/run-benchmark.mjs.");
  process.exit(2);
}

if (RECORD) {
  const payload = {
    recordedAt: new Date().toISOString(),
    commit,
    note: "Measured by benchmarks/run-benchmark.mjs against the annotations in benchmarks/annotations/. " +
      "Classical computer vision (Assisted Detection); no trained model is involved in these numbers.",
    guardedFields: [...GUARDED, ...GUARDED_WHEN_SPATIAL_CHAIRS]
      .map(([f, dir]) => ({ field: f, worseWhen: dir === "up" ? "lower" : "higher" })),
    tolerance: TOLERANCE,
    plans: current,
  };
  fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Recorded ${current.length} plans to ${path.relative(process.cwd(), BASELINE)} at commit ${commit.slice(0, 8)}.`);
  for (const plan of current) console.log("  " + plan.planId + "  " +
    Object.entries(plan).filter(([k]) => k.includes(".")).map(([k, v]) => `${k.split(".").pop()}=${v}`).join(" "));
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error("No baseline recorded yet. Run `node benchmarks/record-baseline.mjs --record`.");
  process.exit(2);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const byPlan = new Map(baseline.plans.map(p => [p.planId, p]));

const regressions = [];
const improvements = [];
const missing = [];

for (const plan of current) {
  const was = byPlan.get(plan.planId);
  if (!was) { missing.push(`${plan.planId} is not in the baseline (new plan — re-record if intended)`); continue; }
  if (plan.imageShaMatches === false) {
    regressions.push(`${plan.planId}: the plan image no longer matches its annotation's sha256 — the numbers are not comparable`);
  }
  for (const [field, betterDirection] of [...GUARDED, ...GUARDED_WHEN_SPATIAL_CHAIRS]) {
    const before = was[field], after = plan[field];
    if (typeof before !== "number" || typeof after !== "number") continue;
    const delta = after - before;
    if (Math.abs(delta) <= TOLERANCE) continue;
    const worse = betterDirection === "up" ? delta < 0 : delta > 0;
    const line = `${plan.planId} ${field}: ${before} → ${after}`;
    (worse ? regressions : improvements).push(line);
  }
}
for (const planId of byPlan.keys()) {
  if (!current.some(p => p.planId === planId)) missing.push(`${planId} was in the baseline but this run did not produce it`);
}

console.log(`Baseline recorded ${baseline.recordedAt} at commit ${String(baseline.commit).slice(0, 8)}`);
console.log(`This run: ${latest.ranAt}\n`);

for (const line of improvements) console.log("  better  " + line);
for (const line of missing) console.log("  note    " + line);
for (const line of regressions) console.log("  WORSE   " + line);

if (regressions.length) {
  console.log(`\n${regressions.length} regression(s) against the recorded baseline.`);
  console.log("If the change is a deliberate, measured trade, re-record with --record and say so in the commit message.");
  process.exit(1);
}
console.log(`\nNo regressions. ${improvements.length} improvement(s), ${missing.length} note(s).`);
