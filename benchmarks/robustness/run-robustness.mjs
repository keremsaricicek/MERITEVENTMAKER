#!/usr/bin/env node
// The robustness matrix: the same real plan, rendered fifteen different ways.
//
//   node benchmarks/robustness/make-variants.mjs     # generate (once)
//   node benchmarks/robustness/run-robustness.mjs    # measure
//
// "The Golden Plan looks good" is one number about one file. This asks the
// question an operator's day actually poses: the plan arrives as a WhatsApp
// JPEG, a grayscale photocopy, a slightly askew scan, a screenshot of a
// screenshot — does detection survive it?
//
// ONE REAL VENUE PLAN EXISTS. Every row below is that same drawing. A high
// score here is evidence of robustness to rendering, and evidence of nothing
// whatsoever about a venue this system has not seen.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const REPORT = path.join(HERE, "report.json");
const BASELINE = path.join(HERE, "BASELINE.json");
const record = process.argv.includes("--record");

if (!process.argv.includes("--reuse")) {
  const run = spawnSync(process.execPath, [
    path.join(ROOT, "run-benchmark.mjs"),
    "--annotations", path.join(HERE, "annotations"),
    "--out", REPORT,
  ], { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" });
  if (run.status !== 0) { console.error(run.stdout); process.exit(run.status || 1); }
}

const { reports } = JSON.parse(fs.readFileSync(REPORT, "utf8"));
// The original, measured in the same run, is the row everything else is read
// against — a variant losing 4 tables only means something next to what the
// untouched plan scores.
const originalReport = JSON.parse(fs.readFileSync(path.join(ROOT, "reports", "latest.json"), "utf8"))
  .reports.find(r => r.planId === "merit-real-venue");

const rows = [];
if (originalReport) rows.push({ id: "ORIGINAL (real plan)", rep: originalReport });
for (const rep of reports.sort((a, b) => a.planId.localeCompare(b.planId))) {
  rows.push({ id: rep.planId.replace("merit-real-", ""), rep });
}

const num = (v, d = 3) => (typeof v === "number" ? v.toFixed(d) : "—");
const cell = (v, w) => String(v).padEnd(w);

console.log("\nROBUSTNESS MATRIX — one real plan, fifteen renderings");
console.log("=".repeat(104));
console.log(cell("variant", 22) + cell("tbl TP", 8) + cell("tbl FP", 8) + cell("tbl F1", 9)
  + cell("chr TP", 8) + cell("chr FP", 8) + cell("chr F1", 9) + cell("armchr R", 10) + "review");
console.log("-".repeat(104));

const summary = [];
for (const { id, rep } of rows) {
  const c = rep.chairs || {};
  const arm = c.byFamily?.["orange-armchair"];
  console.log(
    cell(id, 22) + cell(rep.tables.tp, 8) + cell(rep.tables.fp, 8) + cell(num(rep.tables.f1), 9)
    + cell(c.tp ?? "—", 8) + cell(c.fp ?? "—", 8) + cell(num(c.f1), 9)
    + cell(arm ? num(arm.recall) : "—", 10) + (rep.humanEffort?.reviewGroups ?? "—"));
  summary.push({ variant: id, tableTP: rep.tables.tp, tableFP: rep.tables.fp, tableF1: rep.tables.f1,
    chairTP: c.tp ?? null, chairFP: c.fp ?? null, chairF1: c.f1 ?? null,
    armchairRecall: arm?.recall ?? null, reviewGroups: rep.humanEffort?.reviewGroups ?? null });
}
console.log("=".repeat(104));

// ---- what the matrix says --------------------------------------------------
const base = summary[0];
if (base) {
  const variants = summary.slice(1);
  const collapsed = variants.filter(v => v.tableF1 < base.tableF1 - .15);
  const chairLost = variants.filter(v => (v.chairTP ?? 0) < base.chairTP * .8);
  const noisier = variants.filter(v => (v.chairFP ?? 0) > base.chairFP + 5);
  console.log(`\noriginal: tables F1 ${num(base.tableF1)}, chairs TP ${base.chairTP} FP ${base.chairFP}`);
  console.log(`table detection collapses (F1 down more than 0.15) on: ${collapsed.length ? collapsed.map(v => v.variant).join(", ") : "none"}`);
  console.log(`chair recall drops below 80% of original on: ${chairLost.length ? chairLost.map(v => v.variant).join(", ") : "none"}`);
  console.log(`chair false positives rise by more than 5 on: ${noisier.length ? noisier.map(v => v.variant).join(", ") : "none"}`);
}
console.log("\nREAL DISTINCT VENUE PLANS: 1. Every row above is the same drawing rendered differently.");

const payload = { ranAt: new Date().toISOString(), realDistinctVenuePlans: 1,
  note: "Every variant is a transform of benchmarks/plans/merit-real-venue-plan.png. This matrix measures robustness to rendering, not generalisation to unseen venues.",
  rows: summary };

if (record) {
  fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\nrecorded ${path.relative(process.cwd(), BASELINE)}`);
} else if (fs.existsSync(BASELINE)) {
  const was = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  const byId = new Map(was.rows.map(r => [r.variant, r]));
  const regressions = [];
  for (const row of summary) {
    const before = byId.get(row.variant);
    if (!before) continue;
    for (const [field, dir] of [["tableF1", "up"], ["chairF1", "up"], ["tableFP", "down"], ["chairFP", "down"]]) {
      const a = before[field], b = row[field];
      if (typeof a !== "number" || typeof b !== "number") continue;
      const delta = b - a;
      if (Math.abs(delta) <= 0.005) continue;
      if (dir === "up" ? delta < 0 : delta > 0) regressions.push(`${row.variant} ${field}: ${a} → ${b}`);
    }
  }
  if (regressions.length) {
    console.log("\nWORSE than the recorded robustness baseline:");
    for (const r of regressions) console.log("  " + r);
    process.exitCode = 1;
  } else {
    console.log("\nNo regressions against the recorded robustness baseline.");
  }
}
