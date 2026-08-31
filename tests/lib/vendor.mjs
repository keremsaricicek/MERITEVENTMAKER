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

const CACHE = path.join(REPO_ROOT, ".vendor-cache");
const JSDELIVR = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/(.+)$/;

export function vendorFileFor(url) {
  const m = JSDELIVR.exec(url.split("?")[0]);
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
// vendor engines" instead of silently testing a crippled app.
export async function routeVendorFromCache(page) {
  const served = [];
  const passedThrough = [];
  await page.route("https://cdn.jsdelivr.net/**", async route => {
    const url = route.request().url();
    const file = vendorFileFor(url);
    if (!file) {
      passedThrough.push(url);
      return route.continue();
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
