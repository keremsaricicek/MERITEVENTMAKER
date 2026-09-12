#!/usr/bin/env node
// The one command that runs the regression suite.
//
//   node tests/run.mjs                 every fast suite
//   node tests/run.mjs --all           including the slow ones (real detection)
//   node tests/run.mjs xlsx storage    substring filter on suite name
//   node tests/run.mjs --tag=business  everything tagged business
//   node tests/run.mjs --list          what exists, without running it
//
// It starts its own static server, opens one browser, and gives every suite a
// fresh browser context so IndexedDB from one suite cannot leak into the next.
// Exit code is 1 if any check failed, any suite threw, or any suite saw an
// uncaught page error -- there is no way for a red run to look green.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPlaywright, resolveChromium, describeEnvironment } from "./lib/env.mjs";
import { startStaticServer, REPO_ROOT } from "./lib/server.mjs";
import { Checks, SuiteAborted, watchForErrors } from "./lib/harness.mjs";
import { routeVendorFromCache } from "./lib/vendor.mjs";
import { DEFAULT_VIEWPORT } from "./lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = path.join(HERE, "suites");
const ARTIFACT_DIR = process.env.MERIT_TEST_ARTIFACTS || path.join(HERE, ".artifacts");

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith("--")));
const filters = argv.filter(a => !a.startsWith("--"));
const tagFilter = (argv.find(a => a.startsWith("--tag=")) || "").slice(6);
const includeSlow = flags.has("--all") || flags.has("--include-slow") || tagFilter === "slow";

const suiteFiles = fs.readdirSync(SUITE_DIR).filter(f => f.endsWith(".test.mjs")).sort();
const suites = [];
for (const file of suiteFiles) {
  const mod = await import(pathToFileURL(path.join(SUITE_DIR, file)).href);
  const meta = mod.meta || {};
  suites.push({
    file,
    name: meta.name || file.replace(/\.test\.mjs$/, ""),
    tags: meta.tags || [],
    timeout: meta.timeout || 120000,
    viewport: meta.viewport || DEFAULT_VIEWPORT,
    downloads: !!meta.downloads,
    run: mod.default,
  });
}

const selected = suites.filter(s => {
  if (!includeSlow && s.tags.includes("slow")) return false;
  if (tagFilter && !s.tags.includes(tagFilter)) return false;
  if (filters.length && !filters.some(f => s.name.includes(f) || s.file.includes(f))) return false;
  return true;
});

if (flags.has("--list")) {
  for (const s of suites) {
    console.log(`${s.name.padEnd(34)} ${s.tags.join(",") || "-"}`);
  }
  process.exit(0);
}

if (!selected.length) {
  console.error("No suites matched. Use --list to see what exists.");
  process.exit(1);
}

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const { chromium } = await loadPlaywright();
const executablePath = resolveChromium();
const server = process.env.MERIT_BASE_URL
  ? { baseUrl: process.env.MERIT_BASE_URL, close: async () => {} }
  : await startStaticServer({ root: REPO_ROOT });

console.log("MERIT EVENT MAKER — regression suite");
console.log(`  node       ${describeEnvironment().node}`);
console.log(`  playwright ${describeEnvironment().playwright}`);
console.log(`  chromium   ${executablePath || "(Playwright default)"}`);
console.log(`  serving    ${server.baseUrl}  (${REPO_ROOT})`);
console.log(`  suites     ${selected.length} of ${suites.length}${includeSlow ? "" : "  (slow suites excluded — use --all)"}\n`);

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const results = [];
let vendorWarned = false;

for (const suite of selected) {
  const started = Date.now();
  const checks = new Checks(suite.name);
  const context = await browser.newContext({
    viewport: suite.viewport,
    ...(suite.downloads ? { acceptDownloads: true } : {}),
  });
  const page = await context.newPage();
  const vendor = await routeVendorFromCache(page);
  const errors = watchForErrors(page, { baseUrl: server.baseUrl });
  let thrown = null;
  if (!vendorWarned && !vendor.cacheAvailable) {
    vendorWarned = true;
    console.log("  note: .vendor-cache is empty, so the CDN engines load over the network.");
    console.log("        Run `npm run build:offline` once to make the run fully offline.\n");
  }

  try {
    await withTimeout(suite.run({
      page, context, browser, checks, errors,
      baseUrl: server.baseUrl,
      artifactDir: ARTIFACT_DIR,
      repoRoot: REPO_ROOT,
    }), suite.timeout, suite.name);
  } catch (err) {
    if (!(err instanceof SuiteAborted)) thrown = err;
  }

  await context.close().catch(() => {});
  const ms = Date.now() - started;
  const consoleClean = checks.ok(errors.length === 0, "console and page errors: none", errors.slice(0, 3));
  const failed = checks.failures.length > 0 || !!thrown;
  results.push({ suite, checks, thrown, ms, errors, failed, consoleClean });

  console.log(`${failed ? "FAIL" : "PASS"}  ${suite.name}  (${checks.passed} checks, ${ms}ms)`);
  for (const line of checks.lines) {
    if (line.status === "fail") console.log(`        ✗ ${line.label}${line.detail || ""}`);
  }
  if (thrown) {
    console.log(`        ✗ threw: ${thrown.message.split("\n")[0]}`);
    const frame = (thrown.stack || "").split("\n").find(l => l.includes("/tests/"));
    if (frame) console.log(`          at ${frame.trim()}`);
  }
}

await browser.close();
await server.close();

const failedSuites = results.filter(r => r.failed);
const totalChecks = results.reduce((n, r) => n + r.checks.passed + r.checks.failures.length, 0);
const totalFailed = results.reduce((n, r) => n + r.checks.failures.length, 0);

console.log(`\n${results.length - failedSuites.length}/${results.length} suites passed, ` +
  `${totalChecks - totalFailed}/${totalChecks} checks passed`);
if (failedSuites.length) {
  console.log("\nFailing suites: " + failedSuites.map(r => r.suite.name).join(", "));
}
process.exit(failedSuites.length ? 1 : 0);

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`suite "${label}" exceeded ${ms}ms`)), ms);
    }),
  ]);
}
