// Where Playwright and Chromium actually live.
//
// These tests were written inside a container that has Playwright installed
// globally and Chromium pre-downloaded under PLAYWRIGHT_BROWSERS_PATH, so the
// original scratchpad versions hardcoded two absolute paths. That made them
// unrunnable anywhere else -- including CI, where Playwright is a normal npm
// dependency and Chromium sits wherever `playwright install` put it.
//
// Resolution order, most explicit first:
//   1. MERIT_PLAYWRIGHT / MERIT_CHROMIUM  -- an operator says exactly what to use
//   2. a normal `playwright` import        -- CI, or anyone who ran `npm i`
//   3. the known global install path       -- this container
// Chromium may also resolve to `undefined`, which is not a failure: it means
// "let Playwright pick the browser it downloaded itself", which is the right
// answer on a machine that ran `npx playwright install chromium`.
import fs from "node:fs";
import path from "node:path";

const CANDIDATE_PLAYWRIGHT = [
  process.env.MERIT_PLAYWRIGHT,
  "playwright",
  "/opt/node22/lib/node_modules/playwright/index.mjs",
].filter(Boolean);

let cached = null;

export async function loadPlaywright() {
  if (cached) return cached;
  const tried = [];
  for (const specifier of CANDIDATE_PLAYWRIGHT) {
    try {
      const mod = await import(specifier);
      if (mod && mod.chromium) {
        cached = { chromium: mod.chromium, specifier };
        return cached;
      }
      tried.push(`${specifier} (loaded, but exports no chromium)`);
    } catch (err) {
      tried.push(`${specifier} (${err.code || err.message})`);
    }
  }
  throw new Error(
    "Playwright could not be resolved. Tried:\n  " + tried.join("\n  ") +
    "\nInstall it (`npm install`) or set MERIT_PLAYWRIGHT to a module path."
  );
}

export function resolveChromium() {
  if (process.env.MERIT_CHROMIUM) return process.env.MERIT_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return undefined;
  // A direct symlink (this container has /opt/pw-browsers/chromium) wins;
  // otherwise take the highest-numbered chromium-<build> directory, because
  // several builds can sit side by side and the newest is the one Playwright
  // itself would choose.
  const direct = path.join(root, "chromium");
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  const builds = fs.readdirSync(root)
    .filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const build of builds) {
    const exe = path.join(root, build, "chrome-linux", "chrome");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

// One place that knows how to start a browser here. Every runner in the repo
// goes through it, so a new machine is one env var away from working rather
// than a hunt through a dozen hardcoded paths.
//
// Every context it creates serves the pinned CDN engines — SheetJS, PDF.js,
// Tesseract and its language data — from .vendor-cache and sends nothing to
// the network. Before §27 the benchmark runners did not, so a machine that
// could reach jsDelivr measured Assisted Detection WITH OCR and one that could
// not measured it without, and both wrote numbers under the same name. It
// refuses to start with the OCR files missing, rather than measure a
// different product: `npm run vendor:test` fetches them from the npm registry.
// MERIT_VENDOR_NETWORK=1 restores the old behaviour for a deliberate look.
export async function launchChromium(options = {}) {
  const { chromium } = await loadPlaywright();
  const executablePath = resolveChromium();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...options });
  if (process.env.MERIT_VENDOR_NETWORK === "1") return browser;
  const { routeVendorFromCache, ocrCacheComplete } = await import("./vendor.mjs");
  if (!ocrCacheComplete()) {
    await browser.close();
    throw new Error("The pinned OCR engine is not in .vendor-cache, so this run would measure the app without OCR. " +
      "Run `npm run vendor:test` once (developer-time only; the product never downloads anything).");
  }
  // Browser.newPage goes through newContext, so this one wrapper covers both.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await newContext(...args);
    await routeVendorFromCache(context, { offline: true });
    return context;
  };
  return browser;
}

export function describeEnvironment() {
  return {
    playwright: cached ? cached.specifier : "(not loaded yet)",
    chromium: resolveChromium() || "(Playwright default)",
    node: process.version,
  };
}
