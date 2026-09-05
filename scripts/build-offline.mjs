#!/usr/bin/env node
// Builds dist/index-offline.html: the same app as index.html, but with the
// SheetJS and PDF.js engines inlined instead of loaded from a CDN, so the
// result is a single file that runs with no network access at all — for
// venues or ops laptops where CDN access is not available at event time.
//
// Usage: node scripts/build-offline.mjs

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSources } from "./lib/app-sources.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, ".vendor-cache");
const DIST = path.join(ROOT, "dist");

const XLSX_VERSION = "0.18.5";
const PDFJS_VERSION = "5.7.284";

function fetchTarball(pkg, version) {
  const dest = path.join(CACHE, `${pkg}-${version}.tgz`);
  if (!existsSync(dest)) {
    mkdirSync(CACHE, { recursive: true });
    console.log(`Downloading ${pkg}@${version} from the npm registry...`);
    execSync(
      `curl -sSL -o "${dest}" "https://registry.npmjs.org/${pkg}/-/${pkg}-${version}.tgz"`,
      { stdio: "inherit" }
    );
  }
  const extractDir = path.join(CACHE, `${pkg}-${version}`);
  if (!existsSync(extractDir)) {
    mkdirSync(extractDir, { recursive: true });
    execSync(`tar xzf "${dest}" -C "${extractDir}"`);
  }
  return path.join(extractDir, "package");
}

console.log("Fetching vendor packages (xlsx, pdfjs-dist)...");
const xlsxDir = fetchTarball("xlsx", XLSX_VERSION);
const pdfjsDir = fetchTarball("pdfjs-dist", PDFJS_VERSION);

const xlsxSrc = readFileSync(path.join(xlsxDir, "dist/xlsx.full.min.js"), "utf8");
const pdfCoreSrc = readFileSync(path.join(pdfjsDir, "build/pdf.min.mjs"), "utf8");
const pdfWorkerSrc = readFileSync(path.join(pdfjsDir, "build/pdf.worker.min.mjs"), "utf8");

const styles = readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
// Tesseract.js (OCR) is intentionally NOT vendored here: this build's whole
// point is zero network at runtime, which real OCR language data cannot
// honor without embedding tens of MB. src/plan-ocr.js detects its absence
// and reports the capacity auditor's OCR step as unavailable rather than
// faking a result — see that file for the full rationale.
// Read from index.html, never listed here. The hand-written copy of this
// list drifted once already: plan-relationships.js and plan-memory.js were
// added to the app and never to the builders, so every offline artifact
// built afterwards shipped without them while the build reported success.
const { files: appJsFiles, code: appJs } = readAppSources(ROOT);

const shell = readFileSync(path.join(ROOT, "index.html"), "utf8");

const bodyStart = shell.indexOf("<body>");
// Cut at the first <script>, not at the first HTML comment: the markup this
// build needs (the dialogs, the hidden file inputs, the toast host) sits
// above the script block, and an explanatory comment anywhere in that markup
// used to silently truncate the body and ship a build with no dialogs at all.
const bodyEnd = shell.indexOf("<script");
if (bodyStart < 0 || bodyEnd < 0 || bodyEnd <= bodyStart) {
  throw new Error("build-offline: could not locate the body markup range in index.html");
}
const bodyMarkup = shell.slice(bodyStart, bodyEnd);
for (const required of ['id="app"', 'id="guestForm"', 'id="excelDialog"', 'id="guideDialog"', 'id="toastWrap"', 'id="floorPlanFile"', 'id="guestFileInput"', 'id="backupFileInput"']) {
  if (!bodyMarkup.includes(required)) {
    throw new Error(`build-offline: body markup is missing ${required} — the offline build would be broken`);
  }
}

const pdfBridge = `
GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([${JSON.stringify(
  pdfWorkerSrc
)}], {type:"text/javascript"}));
globalThis.MeritPdf = { getDocument, GlobalWorkerOptions };
globalThis.dispatchEvent(new CustomEvent("merit-pdf-ready"));
`;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>MERIT ENTERTAINMENT — EVENT MAKER</title>
  <style>
${styles}
  </style>
</head>
${bodyMarkup}
  <script data-merit-offline-xlsx>${xlsxSrc}</script>
  <script type="module" data-merit-offline-pdf>
${pdfCoreSrc}
${pdfBridge}
  </script>
  <script>
${appJs}
  </script>
</body>
</html>
`;

mkdirSync(DIST, { recursive: true });
const outPath = path.join(DIST, "index-offline.html");
writeFileSync(outPath, html);
console.log(`Bundled ${appJsFiles.length} app sources from index.html: ${appJsFiles.map((f) => f.replace("src/", "")).join(", ")}`);
console.log(`Wrote ${outPath} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
