#!/usr/bin/env node
// `npm run perf` — every performance runner, in order, with a real exit code.
//
// These are measurements, not assertions, with one exception: the live
// windowing suite asserts that capping the DOM did not change what an operator
// sees, and that one must fail the run if it breaks. So this reports timings
// for the profilers and propagates failure from the correctness suite.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const RUNNERS = [
  { file: "live-windowing-correctness.mjs", asserts: true,
    why: "windowing the Live list must not change counts, sort, or who Enter checks in" },
  { file: "stress-4000-seats.mjs", asserts: false,
    why: "400 tables / 4,000 chairs / 3,000 guests through the app's own model" },
  { file: "profile-render-phases.mjs", asserts: false,
    why: "where render time actually goes, with a forced layout flush inside the timed region" },
];

let failed = 0;
for (const runner of RUNNERS) {
  console.log(`\n${"=".repeat(72)}\n${runner.file}\n${runner.why}\n${"=".repeat(72)}`);
  const result = spawnSync(process.execPath, [path.join(HERE, runner.file)], { stdio: "inherit" });
  if (result.status !== 0) {
    if (runner.asserts) {
      failed++;
      console.log(`\n${runner.file} FAILED (exit ${result.status})`);
    } else {
      console.log(`\n${runner.file} exited ${result.status} — a profiler, so this does not fail the run, but look at it.`);
    }
  }
}

console.log(failed ? `\n${failed} performance suite(s) failed.` : "\nAll performance suites completed.");
process.exit(failed ? 1 : 0);
