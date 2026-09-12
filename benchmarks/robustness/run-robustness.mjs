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

// ---- triage ----------------------------------------------------------------
// Thresholds for SORTING renderings into buckets so the weak ones are obvious,
// not claims of statistical certainty. A single real venue cannot support
// those. SEVERE is deliberately about the failure MODE rather than the score:
// a false-positive explosion and a recall collapse cost an operator different
// things, and both are worse than a merely mediocre F1.
function triage(rep, base) {
  const t = rep.tables, c = rep.chairs || {};
  const tF1 = t.f1, cF1 = c.f1;
  const fpExplosion = base && t.fp > Math.max(20, base.tables.fp * 4);
  const recallCollapse = base && t.recall < base.tables.recall * 0.65;
  if (fpExplosion || recallCollapse)
    return { level: "SEVERE", why: fpExplosion ? `table FP ${t.fp} against ${base.tables.fp} on the original` : `table recall ${num(t.recall)} against ${num(base.tables.recall)}` };
  if (tF1 >= 0.90 && (cF1 == null || cF1 >= 0.90)) return { level: "HEALTHY", why: "" };
  if (tF1 >= 0.80 && (cF1 == null || cF1 >= 0.85)) return { level: "ACCEPTABLE", why: "" };
  return { level: "WEAK", why: `table F1 ${num(tF1)}, chair F1 ${num(cF1)}` };
}

const bistroOf = rep => {
  const ta = rep.tableTypeAccuracy || {};
  const b = ta.bistro;
  return b && b.matched ? `${b.correct}/${b.matched}` : (b ? "0/0" : "—");
};
const columnsOf = rep => {
  const col = (rep.semanticObjects || {}).column;
  return col ? `${col.tp}/${col.tp + col.fn}` : "—";
};

console.log("\nROBUSTNESS MATRIX — one real plan, every committed rendering");
console.log("=".repeat(132));
console.log(cell("variant", 20)
  + cell("tTP", 5) + cell("tFP", 5) + cell("tFN", 5) + cell("tP", 7) + cell("tR", 7) + cell("tF1", 8)
  + cell("cTP", 5) + cell("cFP", 5) + cell("cFN", 5) + cell("cP", 7) + cell("cR", 7) + cell("cF1", 8)
  + cell("bistro", 8) + cell("col", 6) + cell("rev", 5) + cell("ms", 6) + "triage");
console.log("-".repeat(132));

const summary = [];
const baseRep = rows[0] && rows[0].rep;
for (const { id, rep } of rows) {
  const t = rep.tables, c = rep.chairs || {};
  const arm = c.byFamily?.["orange-armchair"];
  const tri = triage(rep, baseRep);
  console.log(
    cell(id, 20)
    + cell(t.tp, 5) + cell(t.fp, 5) + cell(t.fn, 5) + cell(num(t.precision, 2), 7) + cell(num(t.recall, 2), 7) + cell(num(t.f1), 8)
    + cell(c.tp ?? "—", 5) + cell(c.fp ?? "—", 5) + cell(c.fn ?? "—", 5)
    + cell(num(c.precision, 2), 7) + cell(num(c.recall, 2), 7) + cell(num(c.f1), 8)
    + cell(bistroOf(rep), 8) + cell(columnsOf(rep), 6)
    + cell(rep.humanEffort?.reviewGroups ?? "—", 5)
    + cell(rep.detectionMs ?? "—", 6) + tri.level);
  summary.push({ variant: id,
    tableTP: t.tp, tableFP: t.fp, tableFN: t.fn,
    tablePrecision: t.precision, tableRecall: t.recall, tableF1: t.f1,
    chairTP: c.tp ?? null, chairFP: c.fp ?? null, chairFN: c.fn ?? null,
    chairPrecision: c.precision ?? null, chairRecall: c.recall ?? null, chairF1: c.f1 ?? null,
    armchairRecall: arm?.recall ?? null,
    bistroType: bistroOf(rep), columns: columnsOf(rep),
    reviewGroups: rep.humanEffort?.reviewGroups ?? null,
    relationshipAccuracy: rep.relationships?.accuracy ?? null,
    detectionMs: rep.detectionMs ?? null,
    triage: tri.level, triageWhy: tri.why });
}
console.log("=".repeat(132));

// ---- what the matrix says --------------------------------------------------
const median = a => { const v = [...a].filter(Number.isFinite).sort((x, y) => x - y);
  return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
const medTable = median(summary.map(r => r.tableF1));
const medChair = median(summary.map(r => r.chairF1));

const byLevel = {};
for (const r of summary) (byLevel[r.triage] ||= []).push(r.variant);
console.log("\nTRIAGE");
for (const level of ["HEALTHY", "ACCEPTABLE", "WEAK", "SEVERE"])
  console.log(`  ${level.padEnd(11)} ${(byLevel[level] || []).length.toString().padStart(2)}  ${(byLevel[level] || []).join(", ") || "—"}`);
for (const r of summary.filter(r => r.triage === "SEVERE" || r.triage === "WEAK"))
  console.log(`    ${r.variant.padEnd(20)} ${r.triageWhy}`);

const base = summary[0];
if (base) {
  const variants = summary.slice(1);
  const collapsed = variants.filter(v => v.tableF1 < base.tableF1 - .15);
  const chairLost = variants.filter(v => (v.chairTP ?? 0) < base.chairTP * .8);
  const noisier = variants.filter(v => (v.chairFP ?? 0) > base.chairFP + 5);
  console.log(`\noriginal: tables F1 ${num(base.tableF1)}, chairs TP ${base.chairTP} FP ${base.chairFP}`);
  console.log(`median across all renderings: table F1 ${num(medTable)}, chair F1 ${num(medChair)}`);
  console.log(`table detection collapses (F1 down more than 0.15) on: ${collapsed.length ? collapsed.map(v => v.variant).join(", ") : "none"}`);
  console.log(`chair recall drops below 80% of original on: ${chairLost.length ? chairLost.map(v => v.variant).join(", ") : "none"}`);
  console.log(`chair false positives rise by more than 5 on: ${noisier.length ? noisier.map(v => v.variant).join(", ") : "none"}`);
}
console.log("\nREAL DISTINCT VENUE PLANS: 1. Every row above is the same drawing rendered differently.");

const payload = { ranAt: new Date().toISOString(), realDistinctVenuePlans: 1,
  note: "Every variant is a transform of benchmarks/plans/merit-real-venue-plan.png. This matrix measures robustness to rendering, not generalisation to unseen venues.",
  medianTableF1: medTable, medianChairF1: medChair,
  triage: byLevel,
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
