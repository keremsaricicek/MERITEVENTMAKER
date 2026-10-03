// Serve the two pinned CDN engines from disk during a test run.
//
// index.html loads SheetJS, PDF.js and Tesseract.js from jsDelivr. A test
// machine with no outbound access therefore boots the app with `XLSX`
// undefined, which does not look like a failure -- the app renders, the tabs
// work, and only the workbook export quietly produces nothing. That is
// precisely the regression the XLSX suite exists to catch, so the suite must
// not be the thing that disappears when the network does.
//
// The packages are already on disk: scripts/build-offline.mjs downloads the
// exact pinned tarballs into .vendor-cache/ to inline them. Reusing that cache
// keeps the test run offline, deterministic and fast, and means a version bump
// in index.html that the offline build has not seen fails loudly here.
//
// If the cache is absent the request goes to the network unchanged, so a
// developer who has never run the offline build still gets a working test run
// wherever there is connectivity.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./server.mjs";

export const CACHE = path.join(REPO_ROOT, ".vendor-cache");
const JSDELIVR = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/(.+)$/;

// What the app fetches for OCR under index.html, pinned. Tesseract.js asks
// jsDelivr for its language data WITHOUT a version
// (`npm/@tesseract.js-data/eng/4.0.0_best_int/...`), so whichever package
// version jsDelivr calls latest is what OCR reads. Measured in §27: CI reached
// the CDN and ran OCR, this container could not and ran none, and the
// benchmarks reported two different products under one name — 182 against
// 196 memory decisions, 3 against 23 phantom tables on a2. Serving these from
// the cache, pinned, makes every machine measure the same thing.
export const OCR_PACKAGES = [
  ["tesseract.js", "5.1.1"],
  ["tesseract.js-core", "5.1.1"],
  ["@tesseract.js-data/eng", "1.0.0"],
  ["@tesseract.js-data/tur", "1.0.0"],
];
const TESSDATA = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@tesseract\.js-data\/[a-z_]+)\/(.+)$/;

export function vendorFileFor(url) {
  const bare = url.split("?")[0];
  const data = TESSDATA.exec(bare);
  if (data) {
    const pin = OCR_PACKAGES.find(([name]) => name === data[1]);
    const file = pin && path.join(CACHE, `${pin[0].replace("/", "-")}-${pin[1]}`, "package", data[2]);
    return file && fs.existsSync(file) ? file : null;
  }
  const m = JSDELIVR.exec(bare);
  if (!m) return null;
  const [, pkg, version, rest] = m;
  // Tesseract asks its own worker for "@v5.1.1" -- a leading "v" the npm
  // tarball directory does not have. Both spellings resolve to the same
  // cached package.
  const versions = version.startsWith("v") ? [version, version.slice(1)] : [version];
  for (const v of versions) {
    const file = path.join(CACHE, `${pkg.replace("/", "-")}-${v}`, "package", rest);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

const CONTENT_TYPE = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
};

// Returns what actually happened, so a suite can report "ran without the
// vendor engines" instead of silently testing a crippled app. `target` is a
// page or a browser context (a context also covers the OCR worker's own
// requests). With `offline`, a CDN request the cache cannot answer is aborted
// rather than sent, so a measurement can never quietly depend on the network.
export async function routeVendorFromCache(target, { offline = false } = {}) {
  const served = [];
  const passedThrough = [];
  await target.route("https://cdn.jsdelivr.net/**", async route => {
    const url = route.request().url();
    const file = vendorFileFor(url);
    if (!file) {
      passedThrough.push(url);
      return offline ? route.abort("blockedbyclient") : route.continue();
    }
    served.push(url);
    return route.fulfill({
      status: 200,
      contentType: CONTENT_TYPE[path.extname(file).toLowerCase()] || "application/octet-stream",
      body: fs.readFileSync(file),
    });
  });
  return { served, passedThrough, cacheAvailable: fs.existsSync(CACHE) };
}

// Every OCR file index.html asks for, present in the cache? The benchmark
// runners refuse to start without them (tests/lib/env.mjs).
export function ocrCacheComplete() {
  return OCR_PACKAGES.every(([name, version]) => fs.existsSync(path.join(CACHE, `${name.replace("/", "-")}-${version}`, "package")));
}
