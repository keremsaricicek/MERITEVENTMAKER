#!/usr/bin/env node
// Builds dist/merit-offline/ — a folder deliverable (index.html + assets/ocr/)
// that runs with ZERO network access at runtime, INCLUDING real OCR for the
// Plan Intelligence capacity auditor. This differs from build-offline.mjs
// (a single email-able HTML file with no OCR, kept as the lighter option)
// specifically because real trained OCR language data cannot be honored
// without shipping real bytes somewhere — inlining ~19MB of gzipped
// traineddata as base64 into one HTML file is possible but wasteful; a
// folder is the more honest shape for "offline package with local assets,"
// which is explicitly an acceptable deliverable shape for this product.
//
// Usage: node scripts/build-offline-full.mjs

import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, ".vendor-cache");
const OUT = path.join(ROOT, "dist", "merit-offline");
const OCR_OUT = path.join(OUT, "assets", "ocr");

const XLSX_VERSION = "0.18.5";
const PDFJS_VERSION = "5.7.284";
const TESSERACT_VERSION = "5.1.1";
const TESSERACT_CORE_VERSION = "5.1.1";

function fetchTarball(pkg, version) {
  const dest = path.join(CACHE, `${pkg}-${version}.tgz`);
  if (!existsSync(dest)) {
    mkdirSync(CACHE, { recursive: true });
    console.log(`Downloading ${pkg}@${version} from the npm registry...`);
    execSync(`curl -sSL -o "${dest}" "https://registry.npmjs.org/${pkg}/-/${pkg}-${version}.tgz"`, { stdio: "inherit" });
  }
  const extractDir = path.join(CACHE, `${pkg}-${version}`);
  if (!existsSync(extractDir)) {
    mkdirSync(extractDir, { recursive: true });
    execSync(`tar xzf "${dest}" -C "${extractDir}"`);
  }
  return path.join(extractDir, "package");
}

function fetchRaw(name, url) {
  const dest = path.join(CACHE, name);
  if (!existsSync(dest)) {
    console.log(`Downloading ${name}...`);
    execSync(`curl -sSL -o "${dest}" "${url}"`, { stdio: "inherit" });
  }
  return dest;
}

console.log("Fetching vendor packages (xlsx, pdfjs-dist, tesseract.js, tesseract.js-core)...");
const xlsxDir = fetchTarball("xlsx", XLSX_VERSION);
const pdfjsDir = fetchTarball("pdfjs-dist", PDFJS_VERSION);
const tesseractDir = fetchTarball("tesseract.js", TESSERACT_VERSION);
const tesseractCoreDir = fetchTarball("tesseract.js-core", TESSERACT_CORE_VERSION);
// Pinned mirror of the classic naptha/tessdata 4.0.0 quantized language
// packs (the same source Tesseract.js's own CDN default pulls from).
const engTrainedData = fetchRaw("eng.traineddata.gz", "https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0/eng.traineddata.gz");
const turTrainedData = fetchRaw("tur.traineddata.gz", "https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0/tur.traineddata.gz");

const xlsxSrc = readFileSync(path.join(xlsxDir, "dist/xlsx.full.min.js"), "utf8");
const pdfCoreSrc = readFileSync(path.join(pdfjsDir, "build/pdf.min.mjs"), "utf8");
const pdfWorkerSrc = readFileSync(path.join(pdfjsDir, "build/pdf.worker.min.mjs"), "utf8");

const styles = readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
const appJs = ["src/storage-provider.js", "src/venue-model.js", "src/app.js", "src/app-guests.js", "src/i18n.js", "src/plan-ocr.js", "src/plan-intelligence.js", "src/training-data.js", "src/app-v8.js"]
  .map((f) => readFileSync(path.join(ROOT, f), "utf8"))
  .join("\n");

const shell = readFileSync(path.join(ROOT, "index.html"), "utf8");
const bodyStart = shell.indexOf("<body>");
// Cut at the first <script>, not at the first HTML comment. build-offline.mjs
// was fixed for this and this build was not, so it silently shipped truncated
// markup for as long as index.html has carried an explanatory comment above
// the dialogs: #guestDialog never made it into the file, app-guests.js threw
// on `getElementById("guestForm").elements`, and because all eight sources
// are concatenated into ONE <script> the throw killed everything after it —
// i18n, plan-ocr, plan-intelligence and app-v8 never ran. The package booted
// to a dead shell, and the OCR this build exists to provide was not merely
// broken but absent. The assertions below make that a build failure.
const bodyEnd = shell.indexOf("<script");
if (bodyStart < 0 || bodyEnd < 0 || bodyEnd <= bodyStart) {
  throw new Error("build-offline-full: could not locate the body markup range in index.html");
}
const bodyMarkup = shell.slice(bodyStart, bodyEnd);
for (const required of ['id="app"', 'id="guestForm"', 'id="excelDialog"', 'id="guideDialog"', 'id="toastWrap"', 'id="floorPlanFile"', 'id="guestFileInput"', 'id="backupFileInput"']) {
  if (!bodyMarkup.includes(required)) {
    throw new Error(`build-offline-full: body markup is missing ${required} — the offline package would boot to a dead shell`);
  }
}

const pdfBridge = `
GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([${JSON.stringify(pdfWorkerSrc)}], {type:"text/javascript"}));
globalThis.MeritPdf = { getDocument, GlobalWorkerOptions };
globalThis.dispatchEvent(new CustomEvent("merit-pdf-ready"));
`;

// Tells src/plan-ocr.js to point Tesseract.js at these LOCAL relative paths
// instead of its CDN defaults, so OCR works with zero network access.
const ocrPathsBridge = `<script>
globalThis.MERIT_OCR_ASSET_PATHS = {
  workerPath: "./assets/ocr/worker.min.js",
  corePath: "./assets/ocr/tesseract-core-simd-lstm.js",
  langPath: "./assets/ocr",
  gzip: true,
};
</script>`;

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
  ${ocrPathsBridge}
  <script data-merit-offline-xlsx>${xlsxSrc}</script>
  <script type="module" data-merit-offline-pdf>
${pdfCoreSrc}
${pdfBridge}
  </script>
  <script src="./assets/ocr/tesseract.min.js"></script>
  <script>
${appJs}
  </script>
</body>
</html>
`;

mkdirSync(OCR_OUT, { recursive: true });
writeFileSync(path.join(OUT, "index.html"), html);
copyFileSync(path.join(tesseractDir, "dist/tesseract.min.js"), path.join(OCR_OUT, "tesseract.min.js"));
copyFileSync(path.join(tesseractDir, "dist/worker.min.js"), path.join(OCR_OUT, "worker.min.js"));
copyFileSync(path.join(tesseractCoreDir, "tesseract-core-simd-lstm.js"), path.join(OCR_OUT, "tesseract-core-simd-lstm.js"));
copyFileSync(path.join(tesseractCoreDir, "tesseract-core-simd-lstm.wasm"), path.join(OCR_OUT, "tesseract-core-simd-lstm.wasm"));
copyFileSync(engTrainedData, path.join(OCR_OUT, "eng.traineddata.gz"));
copyFileSync(turTrainedData, path.join(OCR_OUT, "tur.traineddata.gz"));

const totalSize = execSync(`du -sh "${OUT}"`).toString().split("\t")[0];
console.log(`Wrote ${OUT}/ (${totalSize} total, including offline OCR assets)`);
console.log("Open dist/merit-offline/index.html directly, or serve the folder — no network required, including Assisted Detection's capacity-audit OCR.");
