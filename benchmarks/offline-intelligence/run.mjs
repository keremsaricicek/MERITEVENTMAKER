// The comparison, on identical plans, labels and scoring:
//   classical  — the classical pipeline alone (MERIT_BENCH_MODEL=off)
//   fused      — classical + the local model through the product's own loader
//   foldX      — fused, but with the cross-venue fold model that never saw that venue
// Every row is benchmarks/run-benchmark.mjs's own evaluation (same greedy
// matching, same tolerance), run as a child process with the switches it reads.
//
//   node benchmarks/offline-intelligence/run.mjs --set regression
//   node benchmarks/offline-intelligence/run.mjs --set synthetic --annotations DIR
//   node benchmarks/offline-intelligence/run.mjs --set lovo --fold-pins A.json,B.json
//
// Writes benchmarks/offline-intelligence/results-<set>.json. A row it cannot
// measure says so; nothing is averaged across venues.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const SET = opt("--set", "regression");
const TMP = opt("--tmp", path.join(ROOT, "benchmarks/offline-intelligence/.runs"));
fs.mkdirSync(TMP, { recursive: true });

function bench(label, env, extra = []) {
  const out = path.join(TMP, `${SET}-${label}.json`);
  execFileSync(process.execPath, [path.join(ROOT, "benchmarks/run-benchmark.mjs"), ...extra, "--out", out], {
    cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"], timeout: 4 * 3600 * 1000 });
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

const row = (r) => ({
  plan: r.planId,
  tables: r.tables && { tp: r.tables.tp, fp: r.tables.fp, fn: r.tables.fn, precision: r.tables.precision, recall: r.tables.recall },
  chairs: r.chairs && r.chairs.tp != null ? { tp: r.chairs.tp, fp: r.chairs.fp, fn: r.chairs.fn, precision: r.chairs.precision, recall: r.chairs.recall } : null,
  columns: r.semanticObjects && r.semanticObjects.column || null,
  relationships: r.relationships ? { correct: r.relationships.correct, wrong: r.relationships.wrong, orphan: r.relationships.orphan, accuracy: r.relationships.accuracy } : null,
  tableTypes: r.tableTypeAccuracy,
  ms: r.detectionMs,
  localModel: r.localModel || null,
  pageErrors: (r.pageErrors || []).length,
});

const result = { set: SET, measuredOn: new Date().toISOString(), runs: {} };
const annotations = opt("--annotations");
const extra = annotations ? ["--annotations", annotations] : [];
if (SET === "lovo") {
  for (const pinPath of (opt("--fold-pins") || "").split(",").filter(Boolean)) {
    const pin = JSON.parse(fs.readFileSync(pinPath, "utf8"));
    const rep = bench(pin.fold, { MERIT_BENCH_MODEL_PIN: path.resolve(pinPath) }, [pin.testPlan]);
    result.runs[pin.fold] = { model: pin.version, trainedWithout: pin.testPlan, rows: rep.reports.map(row) };
  }
} else {
  for (const [label, env] of [["classical", { MERIT_BENCH_MODEL: "off" }], ["fused", {}]]) {
    const rep = bench(label, env, extra);
    result.runs[label] = { rows: rep.reports.map(row) };
  }
}
fs.writeFileSync(path.join(HERE, `results-${SET}.json`), JSON.stringify(result, null, 1));
console.log(`wrote benchmarks/offline-intelligence/results-${SET}.json`);
