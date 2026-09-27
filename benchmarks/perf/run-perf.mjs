#!/usr/bin/env node
// `npm run perf` — every performance runner, in order, with a real exit code.
//
// Mostly measurements, not assertions. Three runners also assert something an
// operator depends on — the live windowing did not change what they see, the
// 4,000-seat event survives a reload intact, the save queue still ends
// last-write-wins — and those fail the run. A runner that CAN exit non-zero is
// marked `asserts: true`; tests/suites/ci-gate-honesty.test.mjs holds that.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const RUNNERS = [
  { file: "live-windowing-correctness.mjs", asserts: true,
    why: "windowing the Live list must not change counts, sort, or who Enter checks in" },
  // Its timings are indicative, but it also asserts that the 4,000-seat event
  // survives a reload intact, and exits 1 when it does not. It was listed as a
  // profiler, so that failure was printed and the run still passed (§27).
  { file: "stress-4000-seats.mjs", asserts: true,
    why: "400 tables / 4,000 chairs / 3,000 guests through the app's own model — and intact after a reload" },
  { file: "profile-render-phases.mjs", asserts: false,
    why: "where render time actually goes, with a forced layout flush inside the timed region" },
  { file: "save-queue-burst.mjs", asserts: true,
    why: "what Section 13's write queue costs in drain latency and retained heap — and that it still ends last-write-wins" },
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
