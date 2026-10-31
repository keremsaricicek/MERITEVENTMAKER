#!/usr/bin/env node
// §28: where are the paths no suite protects? Reads the merged V8 coverage
// written by `MERIT_COVERAGE=1 npm run test:all` and answers the programme's
// four questions without a percentage in the verdict:
//
//   1. UNREACHABLE production regions — the pre-v8 bodies the static model
//      (tests/lib/reachability.mjs) proves can never run. Cross-checked: if a
//      suite EXECUTED one, the static model is wrong, and that is reported
//      before anything else.
//   2. REACHABLE BUT NEVER EXECUTED functions, per file — the candidates for
//      "critical business path with no behaviour test".
//   3. The same, restricted to the modules that own an operator-critical fact
//      (seating, storage, migration, import, export, arrival, freeze,
//      availability) — the list §28 actually acts on.
//   4. The largest never-executed stretches inside functions that DID run —
//      "dynamic branches never executed", located by line.
//
//   node benchmarks/coverage/analyse.mjs [--json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preV8Reachability } from "../../tests/lib/reachability.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const report = JSON.parse(fs.readFileSync(path.join(HERE, "report.json"), "utf8"));
const byFile = new Map(report.files.map((f) => [f.file.replace(/^src\//, ""), f]));

// The operator-critical modules: each owns a fact an evening depends on.
export const CRITICAL = ["seat-assignment.js", "seat-model.js", "storage-provider.js", "schema-migrations.js", "offline-recovery.js",
  "event-package.js", "audit-trail.js", "arrival-wave.js", "seating-freeze.js", "table-availability.js", "seating-advisor.js",
  "plan-doctor.js", "app-guests.js"];

const R = preV8Reachability(ROOT);
const lineAt = (src, offset) => src.slice(0, offset).split("\n").length;
const deadBodies = R.defs.filter((d) => R.dead.has(d.name)).map((d) => ({ file: d.f, name: d.name, line: lineAt(R.SRC[d.f], d.a) }));

// 1. static vs dynamic
const executedDead = deadBodies.filter((d) => {
  const f = byFile.get(d.file);
  return f && !f.neverRan.some((n) => n.name === d.name && Math.abs(n.line - d.line) <= 1);
});
// 2/3. reachable, never executed
const deadKey = new Set(deadBodies.map((d) => `${d.file}:${d.name}`));
const reachableNeverRun = [];
for (const [file, f] of byFile) for (const n of f.neverRan) if (!deadKey.has(`${file}:${n.name}`)) reachableNeverRun.push({ file, ...n });
const critical = reachableNeverRun.filter((n) => CRITICAL.includes(n.file));

const out = {
  staticallyUnreachableBodies: deadBodies.length,
  unreachableButExecuted: executedDead,
  reachableNeverExecuted: reachableNeverRun.length,
  criticalReachableNeverExecuted: critical,
  criticalGaps: Object.fromEntries(CRITICAL.map((f) => [f, (byFile.get(f)?.largestGaps || []).slice(0, 6)])),
};
if (process.argv.includes("--json")) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }

console.log(`1. UNREACHABLE: ${deadBodies.length} pre-v8 bodies proven unreachable by the static model.`);
console.log(executedDead.length ? `   !! ${executedDead.length} of them EXECUTED in a suite — the static model is wrong: ${executedDead.map((d) => d.name).join(", ")}`
  : "   None of them executed in any suite: static and dynamic agree.");
console.log(`\n2. REACHABLE, NEVER EXECUTED: ${reachableNeverRun.length} named functions across src/.`);
const perFile = {};
for (const n of reachableNeverRun) (perFile[n.file] = perFile[n.file] || []).push(n);
for (const [file, list] of Object.entries(perFile).sort((a, b) => b[1].length - a[1].length).slice(0, 12))
  console.log(`   ${file.padEnd(34)} ${String(list.length).padStart(3)}  ${list.slice(0, 6).map((n) => n.name).join(", ")}${list.length > 6 ? ", …" : ""}`);
console.log(`\n3. IN THE OPERATOR-CRITICAL MODULES: ${critical.length}`);
for (const n of critical) console.log(`   ${n.file}:${n.line}  ${n.name}`);
console.log("\n4. LARGEST NEVER-EXECUTED STRETCHES in critical modules (chars of code, lines):");
for (const f of CRITICAL) for (const g of (byFile.get(f)?.largestGaps || []).slice(0, 3))
  console.log(`   ${f}:${g.fromLine}-${g.toLine}  ${String(g.chars).padStart(5)}  ${g.head}`);
