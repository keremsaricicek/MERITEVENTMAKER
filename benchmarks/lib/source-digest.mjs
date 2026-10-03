// What a stored measurement was measured ON.
//
// A report file on disk is a claim about some version of the code, and nothing
// in the file used to say which. `benchmark:baseline` read
// benchmarks/reports/latest.json — committed, and rewritten only by
// `npm run benchmark` — so run on its own it compared a result from whenever
// the benchmark last ran and printed "No regressions" about code it had never
// seen (entry K of benchmarks/MASTER-PROGRAMME-STATE.md caught it comparing a
// run from the day before the change it was vouching for). A digest of the inputs, written into the report by the run and
// recomputed by whatever reads it, turns "is this stale?" into a comparison.
//
// The digest covers the app as served (index.html and everything under src/)
// plus whatever a caller names — its annotations, its fixtures, its own
// scoring script — because a change to any of those changes the number.
// Paths are hashed with the bytes, so a rename is a change too.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const APP_INPUTS = ["index.html", "src"];

// Per benchmark: what, besides the app, decides its numbers. Writer and reader
// import the same list, so they cannot hash different things and disagree.
// Plan images are not listed: each annotation already carries its image's
// sha256 and the detection report says whether it matched.
// tests/lib/vendor.mjs is in every list because it pins the OCR engine and
// language data, and OCR changes detection: §27 measured a2 at 3 phantom
// tables with it and 23 without.
export const INPUTS = {
  detection: ["benchmarks/annotations", "benchmarks/run-benchmark.mjs", "tests/lib/vendor.mjs"],
  adversarial: ["benchmarks/adversarial/declarations", "benchmarks/adversarial/fixtures", "benchmarks/adversarial/run-adversarial.mjs",
    "tests/lib/vendor.mjs"],
  memory: ["benchmarks/memory/measure-memory.mjs", "benchmarks/annotations/merit-real-venue.json",
    "benchmarks/plans/merit-real-venue-plan.png", "benchmarks/robustness/variants", "tests/lib/vendor.mjs"],
};

export function sourceDigest(repoRoot, extraInputs = []) {
  const files = [];
  const walk = (rel) => {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
      for (const name of fs.readdirSync(abs)) walk(path.posix.join(rel, name));
    } else files.push(rel);
  };
  for (const rel of [...APP_INPUTS, ...extraInputs]) walk(rel);
  files.sort();
  const hash = crypto.createHash("sha256");
  for (const rel of files) {
    hash.update(rel + "\0");
    hash.update(fs.readFileSync(path.join(repoRoot, rel)));
    hash.update("\0");
  }
  return { digest: hash.digest("hex"), files: files.length, inputs: [...APP_INPUTS, ...extraInputs] };
}

// The one sentence every reader prints when it refuses a stale report, so the
// refusal reads the same wherever it happens.
export function staleReason(stored, current, rerun) {
  if (!stored || !stored.digest)
    return `the report carries no source digest, so nothing says what code it measured. Run \`${rerun}\` first.`;
  if (stored.digest !== current.digest)
    return `the report was measured on different source (digest ${stored.digest.slice(0, 12)}, ` +
      `this checkout ${current.digest.slice(0, 12)}). Run \`${rerun}\` first.`;
  return null;
}
