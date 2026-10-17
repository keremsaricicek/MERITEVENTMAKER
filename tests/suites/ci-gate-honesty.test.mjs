// A GREEN CI HAS TO MEAN SOMETHING: EVERY GATE CAN FAIL, AND EVERY CHECK HAS A CLASS.
//
// Measured before this suite (§27 in benchmarks/MASTER-PROGRAMME-STATE.md):
//
//  - `benchmark:baseline` compared whatever benchmarks/reports/latest.json held
//    — a committed file — and printed "No regressions" about code it had never
//    measured. A plan missing from a run was a "note".
//  - The adversarial step ran WITHOUT --compare, so it could fail on nothing
//    short of a crash while two fixtures were FAIL.
//  - The memory step was wrapped in `continue-on-error`, so it could not fail
//    at all, and the committed report no longer matched what CI measured.
//  - The 4,000-seat reload-integrity assertion was run as a profiler, whose
//    failure `npm run perf` prints and ignores.
//
// This suite asserts each gate's exit semantics directly — the scripts' own
// decision functions, fed every case — and that the workflow and the written
// classification agree. It runs no detection.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const meta = { name: "ci-gate-honesty", tags: ["business", "fast"], timeout: 120000 };

export default async function run({ checks, repoRoot }) {
  const load = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
  const { sourceDigest, INPUTS } = await load("benchmarks/lib/source-digest.mjs");
  const { adversarialGate } = await load("benchmarks/adversarial/gate.mjs");
  const { memoryGate } = await load("benchmarks/memory/gate.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ci-gate-"));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // --- 1. benchmark:baseline refuses a report it cannot vouch for -----------
  // Every call below runs against a COPY of the baseline: with the stale
  // refusal mutated away, --record would otherwise overwrite the real file.
  const baselineBytes = fs.readFileSync(path.join(repoRoot, "benchmarks/BASELINE.json"));
  const baselinePath = path.join(tmp, "BASELINE.json");
  fs.writeFileSync(baselinePath, baselineBytes);
  const committed = JSON.parse(fs.readFileSync(path.join(repoRoot, "benchmarks/reports/latest.json"), "utf8"));
  const compare = (payload, ...extra) => {
    const file = path.join(tmp, `latest-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(payload));
    const r = spawnSync(process.execPath, ["benchmarks/record-baseline.mjs", "--latest", file, "--baseline", baselinePath, ...extra], { cwd: repoRoot, encoding: "utf8" });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const fresh = sourceDigest(repoRoot, INPUTS.detection);

  const noSource = compare({ ...clone(committed), source: undefined });
  checks.equal(noSource.status, 2, "a report that does not say what code it measured is refused (exit 2), not compared");
  checks.ok(/REFUSED/.test(noSource.out) && /npm run benchmark/.test(noSource.out), "and the refusal says to run the benchmark", noSource.out.slice(0, 300));

  const moved = compare({ ...clone(committed), source: { ...fresh, digest: "0".repeat(64) } });
  checks.equal(moved.status, 2, "a report measured on different source is refused");
  const recordStale = compare({ ...clone(committed), source: { ...fresh, digest: "0".repeat(64) } }, "--record");
  checks.equal(recordStale.status, 2, "and --record refuses it too: a stale run is never written as the baseline");

  // The committed report's NUMBERS against the committed baseline, as if
  // measured now: the comparison itself still runs and passes.
  const current = compare({ ...clone(committed), source: fresh });
  checks.equal(current.status, 0, "the same numbers, vouched for by this checkout's digest, compare clean", current.out.slice(-400));
  const skipped = clone(committed);
  const dropped = skipped.reports.pop().planId;
  const partial = compare({ ...skipped, source: fresh });
  checks.equal(partial.status, 1, `a run that did not score ${dropped} fails — a skipped plan is not a note`);
  checks.ok(partial.out.includes(`${dropped} was in the baseline but this run did not produce it`), "and names the plan", partial.out.slice(-400));
  checks.ok(fs.readFileSync(baselinePath).equals(baselineBytes), "the stale --record above wrote nothing to the baseline");

  const digestAgain = sourceDigest(repoRoot, INPUTS.detection);
  checks.equal(digestAgain.digest, fresh.digest, "the digest is stable across two reads of an unchanged checkout");
  checks.ok(fresh.files > 40 && fresh.inputs.includes("src") && fresh.inputs.includes("benchmarks/annotations"),
    "and covers the served app plus the annotations", { files: fresh.files, inputs: fresh.inputs });

  // --- 2. the adversarial gate ---------------------------------------------
  const fixture = (planId, over = {}) => ({ planId, tables: { f1: 0.9, recall: 0.9, heldBack: 0 }, chairs: { f1: 0.8 },
    relations: { accuracy: 1, coverage: 1, forcedOnAmbiguous: 0 }, zones: { precision: 1, recall: 1, falseZoneInventions: 0 },
    facts: { fabricatedStrong: 0, expectedPresent: 2 }, pageErrors: [], verdict: { status: "PASS", fail: [], failCodes: [] }, ...over });
  const failing = (planId, codes) => fixture(planId, { verdict: { status: "FAIL", fail: codes.map((c) => c.toLowerCase()), failCodes: codes } });
  const base = { results: [failing("x", ["PHANTOM_MAJORITY"]), fixture("y")] };
  const known = { fails: [{ planId: "x", codes: ["PHANTOM_MAJORITY"], why: "w", owner: "o", ref: "r" }] };
  const gate = (results, opts = {}) => adversarialGate({ results, refusals: [], baseline: base, known, ...opts });
  const kinds = (g) => g.blocking.map((b) => b.split(" ")[0] + (b.startsWith("NEW") || b.startsWith("STALE") ? " " + b.split(" ")[1] : ""));

  const clean = gate([failing("x", ["PHANTOM_MAJORITY"]), fixture("y")]);
  checks.ok(clean.pass && clean.knownFails.length === 1, "a listed FAIL does not block, and is carried out to be printed", clean);
  checks.equal(kinds(gate([failing("x", ["PHANTOM_MAJORITY", "HELD_BACK_REAL"]), fixture("y")])), ["NEW FAIL"],
    "a listed fixture failing in a NEW way blocks");
  checks.equal(kinds(gate([failing("x", ["PHANTOM_MAJORITY"]), failing("y", ["INVENTED_ZONE"])])), ["NEW FAIL"],
    "an unlisted fixture turning FAIL blocks — the case CI used to wave through");
  checks.equal(kinds(gate([fixture("x"), fixture("y")])), ["STALE KNOWN"],
    "a listed FAIL that stopped failing blocks until the entry is removed, so its return would be caught");
  checks.equal(kinds(gate([failing("x", ["PHANTOM_MAJORITY"]), fixture("y", { tables: { f1: 0.8, recall: 0.9, heldBack: 0 } })])), ["REGRESSED"],
    "a guarded field worse than the baseline blocks");
  checks.ok(gate([failing("x", ["PHANTOM_MAJORITY"]), fixture("y", { tables: { f1: 0.95, recall: 0.9, heldBack: 0 } })]).pass,
    "an improvement does not");
  checks.equal(kinds(gate([failing("x", ["PHANTOM_MAJORITY"])])), ["MISSING"], "a baseline fixture the run did not score blocks");
  checks.ok(gate([fixture("y")], { filtered: true, known: { fails: [] } }).pass, "unless the run was filtered to one fixture on purpose");
  checks.equal(kinds(gate([failing("x", ["PHANTOM_MAJORITY"]), fixture("y"), fixture("z")])), ["UNBASELINED"],
    "a fixture with no baseline blocks — there is nothing to regress against");
  checks.equal(kinds(adversarialGate({ results: [failing("x", ["PHANTOM_MAJORITY"]), fixture("y")], refusals: [{ planId: "q", why: "bytes moved" }], baseline: base, known })),
    ["REFUSED"], "a fixture whose frozen bytes moved blocks");
  checks.equal(kinds(gate([{ planId: "x", error: "detection produced no analysis" }, fixture("y")])), ["ERROR"],
    "a fixture that produced no analysis blocks");
  checks.equal(kinds(gate([failing("x", ["PHANTOM_MAJORITY"]), fixture("y", { pageErrors: ["boom"] })])), ["ERROR"],
    "a page error during detection blocks");

  // The committed files agree with each other: the recorded run passes the
  // gate against the recorded baseline and the listed FAILs.
  const advDir = path.join(repoRoot, "benchmarks/adversarial");
  const advLatest = JSON.parse(fs.readFileSync(path.join(advDir, "latest.json"), "utf8"));
  const advBase = JSON.parse(fs.readFileSync(path.join(advDir, "BASELINE.json"), "utf8"));
  const advKnown = JSON.parse(fs.readFileSync(path.join(advDir, "KNOWN-FAILS.json"), "utf8"));
  const committedGate = adversarialGate({ results: advLatest.results, refusals: advLatest.refusals, baseline: advBase, known: advKnown });
  checks.ok(committedGate.pass, "the committed adversarial run passes the committed gate", committedGate.blocking);
  checks.ok(advKnown.fails.length > 0 && advKnown.fails.every((k) => k.planId && k.codes?.length && k.why?.length > 40 && k.consequence?.length > 40 && k.owner && k.ref),
    "every accepted FAIL names its codes, the reason, the operator-visible consequence, an owner and where the open work is recorded", advKnown.fails);
  checks.ok(advBase.recorded?.reason?.length > 40 && advBase.recorded?.commit, "the adversarial baseline carries the written reason it was recorded for");
  checks.ok(advLatest.results.every((r) => r.verdict?.status !== "FAIL" || r.verdict.failCodes?.length === r.verdict.fail.length),
    "every FAIL in the recorded run carries a code per sentence");

  // --- 3. the memory gate ----------------------------------------------------
  const scen = (id, retained, wrong, scoreable = 26) => ({ scenario: id, scoreable, pageErrors: [], ablation: { full: { retained, wrong } } });
  const mBase = { scenarios: [scen("identical", 26, 0), scen("crop-pad", 7, 3)] };
  const mem = (scenarios) => memoryGate({ scenarios }, mBase);
  checks.ok(mem([scen("identical", 26, 0), scen("crop-pad", 7, 3)]).pass, "memory: the same numbers pass");
  checks.ok(!mem([scen("identical", 26, 0), scen("crop-pad", 9, 4)]).pass,
    "memory: one more WRONG application blocks even when retention rose to pay for it — a wrong one is invisible to the operator");
  checks.ok(!mem([scen("identical", 25, 0), scen("crop-pad", 7, 3)]).pass, "memory: a lost decision blocks");
  checks.ok(!mem([scen("identical", 26, 0), scen("crop-pad", 7, 3, 25)]).pass, "memory: a changed corpus blocks rather than comparing two different sets");
  checks.ok(!mem([scen("identical", 26, 0)]).pass, "memory: a scenario the run skipped blocks");
  checks.ok(!memoryGate({ scenarios: [scen("identical", 26, 0)] }, null).pass, "memory: no baseline is a failure, not a pass");
  const memBase = JSON.parse(fs.readFileSync(path.join(repoRoot, "benchmarks/memory/BASELINE.json"), "utf8"));
  const memReport = JSON.parse(fs.readFileSync(path.join(repoRoot, "benchmarks/memory/report.json"), "utf8"));
  checks.ok(memoryGate(memReport, memBase).pass && memBase.recorded?.reason?.length > 40,
    "the committed memory report passes against the committed baseline, which carries its reason");

  // --- 4. the workflow and the written classification agree ----------------
  const ci = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
  const skill = fs.readFileSync(path.join(repoRoot, ".claude/skills/merit-ci-quality-gates/SKILL.md"), "utf8");
  checks.equal((ci.match(/^\s*continue-on-error\s*:/gm) || []).length, 0, "no step in the workflow is wrapped in continue-on-error");
  checks.ok(/run: npm run benchmark:adversarial -- --compare/.test(ci), "CI runs the adversarial gate, not the bare measurement");
  checks.ok(/run: npm run benchmark:memory -- --compare/.test(ci), "CI runs the memory regression gate");
  const commands = [...new Set([...ci.matchAll(/run: (npm (?:test|run [\w:-]+))/g)].map((m) => m[1]))];
  const table = skill.slice(skill.indexOf("## The classification of every CI check"));
  const unclassified = commands.filter((c) => !new RegExp("\\|\\s*`" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?: [^`]*)?`\\s*\\|[^\\n]*\\b(INFO|WARNING|RELEASE GATE)\\b").test(table));
  checks.ok(commands.length >= 14, "(the workflow's npm commands were found)", commands);
  checks.equal(unclassified, [], "every npm command CI runs has a row, with a class, in the merit-ci-quality-gates classification");

  // --- 5. every machine measures the same product: OCR pinned, never fetched --
  // §27 measured the difference: with OCR a2 has 3 phantom tables, without it
  // 23, and which one a run got depended on whether jsDelivr was reachable.
  const { vendorFileFor, ocrCacheComplete } = await load("tests/lib/vendor.mjs");
  const { launchChromium } = await load("tests/lib/env.mjs");
  checks.ok(ocrCacheComplete(), "the pinned OCR engine and language data are in .vendor-cache (npm run vendor:test)");
  checks.ok(/@tesseract\.js-data-eng-1\.0\.0/.test(vendorFileFor("https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz") || ""),
    "Tesseract's unversioned language-data request resolves to the pinned package, not to whatever the CDN calls latest");
  const bench = await launchChromium();
  try {
    const p = await bench.newPage();
    const pinned = await p.goto("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js").then((r) => r?.status(), (e) => e.message);
    checks.equal(pinned, 200, "a benchmark browser serves a pinned engine from the cache");
    const unpinned = await p.goto("https://cdn.jsdelivr.net/npm/left-pad@1.3.0/index.js").then((r) => `reached: ${r?.status()}`, (e) => e.message);
    checks.ok(/BLOCKED_BY_CLIENT|aborted/i.test(unpinned), "and never sends an unpinned CDN request to the network", unpinned);
  } finally { await bench.close(); }
  const jobs = ci.split(/\n  (?=[a-z-]+:\n    name:)/).slice(1);
  const unvendored = jobs.filter((j) => j.includes("playwright install") && !/playwright install[^\n]*\n(?:\s+#[^\n]*\n)*\s+- run: npm run vendor:test/.test(j))
    .map((j) => j.split(":")[0]);
  checks.ok(jobs.length === 5 && unvendored.length === 0, "every CI job that installs Chromium fetches the pinned OCR engine right after", { jobs: jobs.length, unvendored });

  // --- 6. npm run perf: an assertion is never run as a profiler -------------
  const perf = fs.readFileSync(path.join(repoRoot, "benchmarks/perf/run-perf.mjs"), "utf8");
  const perfRows = [...perf.matchAll(/file: "([\w.-]+)", asserts: (true|false)/g)].map((m) => [m[1], m[2] === "true"]);
  for (const [file, asserts] of perfRows) {
    const src = fs.readFileSync(path.join(repoRoot, "benchmarks/perf", file), "utf8");
    if (/process\.exit\([^)]*\?|process\.exitCode\s*=\s*1/.test(src))
      checks.ok(asserts, `${file} can exit non-zero on a failed assertion, so npm run perf propagates it`);
  }

  // --- 7. the performance budgets can turn CI red ---------------------------
  // A budget that is printed and never enforced is a decoration. GitHub sets
  // CI=true on every job; the budget module must enforce under it, each budget
  // the runners judge must exist in BUDGETS.json, and each runner that judges
  // must fold the verdict into its exit code.
  const budgetsSrc = fs.readFileSync(path.join(repoRoot, "benchmarks/perf/budgets.mjs"), "utf8");
  const budgets = JSON.parse(fs.readFileSync(path.join(repoRoot, "benchmarks/perf/BUDGETS.json"), "utf8"));
  checks.ok(/process\.env\.CI\s*===\s*"true"/.test(budgetsSrc) && /return ENFORCED \? over : \[\]/.test(budgetsSrc),
    "budgets are enforced whenever CI=true (GitHub sets it on every job)");
  const judged = ["repeat-stress.mjs", "save-queue-burst.mjs", "large-files.mjs"].map((f) => [f, fs.readFileSync(path.join(repoRoot, "benchmarks/perf", f), "utf8")]);
  checks.equal(judged.filter(([, src]) => !/judge\(/.test(src) || !(/over\.length \? 1 : 0/.test(src) || /failed \+= judge\(/.test(src))).map(([f]) => f), [],
    "each runner that has budgets folds the budget verdict into its exit code");
  const stressOps = [...fs.readFileSync(path.join(repoRoot, "benchmarks/perf/repeat-stress.mjs"), "utf8").matchAll(/^  (\w+): \(\) => \{/gm)].map((m) => m[1]);
  checks.equal(stressOps.filter((op) => !(budgets.ops[op] && budgets.ops[op].budgetMs > 0)), [], "every timed stress operation has a budget", stressOps);
  checks.ok(Object.values(budgets.ops).every((o) => o.budgetMs <= Math.ceil(Math.max(2 * o.worstP95, o.worstP95 + 15) / 5) * 5),
    "no budget is looser than the stated rule (2 × worst CI p95, 15 ms floor) — a budget cannot be widened quietly", budgets.ops);
  checks.ok(Object.values(budgets.largeFiles.steps).every((o) => o.budgetMs <= Math.ceil(Math.max(2 * o.ciMs, o.ciMs + 15) / 5) * 5)
    && budgets.largeFiles.heapAfterImportMB.budget <= Math.ceil(2 * budgets.largeFiles.heapAfterImportMB.ci),
    "the large-file budgets follow the same rule", budgets.largeFiles);

  // --- 8. every suite is run by CI ------------------------------------------
  // `npm test` runs every suite not tagged slow and `npm run test:slow` every
  // suite tagged slow; CI runs both. A suite outside that partition, a second
  // suite under the same name, or a file the runner cannot load would be a
  // check that exists and never runs.
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts;
  checks.ok(pkg.test === "node tests/run.mjs" && pkg["test:slow"] === "node tests/run.mjs --tag=slow", "npm test runs the non-slow suites and test:slow the slow ones", { test: pkg.test, slow: pkg["test:slow"] });
  checks.ok(/run: npm test\b/.test(ci) && /run: npm run test:slow\b/.test(ci), "CI runs both halves");
  const suiteFiles = fs.readdirSync(path.join(repoRoot, "tests/suites")).filter((f) => f.endsWith(".test.mjs"));
  const metas = [];
  for (const f of suiteFiles) {
    const mod = await import(pathToFileURL(path.join(repoRoot, "tests/suites", f)).href).catch((e) => ({ loadError: String(e) }));
    metas.push({ f, name: mod.meta && mod.meta.name, runs: typeof mod.default === "function" });
  }
  checks.equal(metas.filter((m) => !m.name || !m.runs).map((m) => m.f), [], "every suite file declares a name and a run function the runner will call");
  const names = metas.map((m) => m.name);
  checks.equal(names.filter((n, i) => names.indexOf(n) !== i), [], "no two suites share a name (a name filter would run one and silently skip the other)");
  fs.rmSync(tmp, { recursive: true, force: true });
}
