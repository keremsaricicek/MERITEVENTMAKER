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

import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSources } from "./lib/app-sources.mjs";
import { offlineCspMeta } from "./lib/offline-csp.mjs";

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

// The OCR model (src/plan-ocr-paddle.js): the versions, files and sha256 are
// read from the provider's own PINS, never restated here, and every model file
// is checked against them before it goes into the package — the build refuses
// bytes the app would refuse.
const paddleSrc = readFileSync(path.join(ROOT, "src/plan-ocr-paddle.js"), "utf8");
const pin = (re, what) => { const m = paddleSrc.match(re); if (!m) throw new Error(`build-offline-full: could not read ${what} from plan-ocr-paddle.js PINS`); return m; };
const [, ortPkg, ortVersion, ortScript] = pin(/runtime:\s*\{\s*package:\s*"([^"]+)",\s*version:\s*"([^"]+)",[^}]*script:\s*"([^"]+)"/, "the runtime pin");
const [, modelPkg, modelVersion] = pin(/models:\s*\{\s*package:\s*"([^"]+)",\s*version:\s*"([^"]+)"/, "the model package pin");
const modelPins = ["det", "rec"].map((k) => {
  const [, file, sha256, bytes] = pin(new RegExp(`${k}:\\s*\\{\\s*file:\\s*"([^"]+)",\\s*sha256:\\s*"([0-9a-f]{64})",\\s*bytes:\\s*(\\d+)`), `the ${k} model pin`);
  return { key: k, file, sha256, bytes: Number(bytes) };
});
const ortDir = fetchTarball(ortPkg, ortVersion);
const modelDir = fetchTarball(modelPkg, modelVersion);
const modelBytes = Object.fromEntries(modelPins.map((m) => {
  const buf = readFileSync(path.join(modelDir, m.file));
  const sha = createHash("sha256").update(buf).digest("hex");
  if (buf.length !== m.bytes || sha !== m.sha256) throw new Error(`build-offline-full: ${m.file} is not the pinned model (${buf.length} bytes, sha256 ${sha})`);
  return [m.key, buf];
}));

const xlsxSrc = readFileSync(path.join(xlsxDir, "dist/xlsx.full.min.js"), "utf8");
const pdfCoreSrc = readFileSync(path.join(pdfjsDir, "build/pdf.min.mjs"), "utf8");
const pdfWorkerSrc = readFileSync(path.join(pdfjsDir, "build/pdf.worker.min.mjs"), "utf8");

const styles = readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
// Read from index.html, never listed here. The hand-written copy of this
// list drifted once already: plan-relationships.js and plan-memory.js were
// added to the app and never to the builders, so every offline artifact
// built afterwards shipped without them while the build reported success.
const { files: appJsFiles, code: appJs } = readAppSources(ROOT);

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

// Tells src/plan-ocr.js where the EMBEDDED OCR engine is. A page opened by
// double-click (file://) cannot fetch its sibling files, and Chrome refuses to
// start a worker from a file:// script — measured 2026-10-03: OCR did not run
// in this package opened from disk, though it did when served. So the worker
// script, the core (wasm inlined) and both language files ship as plain
// <script> files that set strings on a global; plan-ocr.js loads them on first
// use and starts ONE blob worker that carries all of it. One path, whether the
// folder is served or opened from disk.
// The OCR model rides the same way, in its own folder (MERIT_PPOCR_ASSET_PATHS).
const ocrPathsBlock = `\nglobalThis.MERIT_OCR_ASSET_PATHS = { embedded: "./assets/ocr/" };\nglobalThis.MERIT_PPOCR_ASSET_PATHS = { embedded: "./assets/ocr/ppocr/" };\n`;

// Every inline block is built once, hashed for the policy, then inserted.
// The OCR engine's files are the package's own siblings, loaded by <script src>
// ('self'); nothing else external runs.
const styleBlock = `\n${styles}\n  `;
const xlsxBlock = xlsxSrc;
const pdfBlock = `\n${pdfCoreSrc}\n${pdfBridge}\n  `;
const appBlock = `\n${appJs}\n  `;
const csp = offlineCspMeta({ scripts: [ocrPathsBlock, xlsxBlock, pdfBlock, appBlock], styles: [styleBlock], scriptSelf: true });

const html = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  ${csp}
  <title>MERIT ENTERTAINMENT — EVENT MAKER</title>
  <style>${styleBlock}</style>
</head>
${bodyMarkup}
  <script>${ocrPathsBlock}</script>
  <script data-merit-offline-xlsx>${xlsxBlock}</script>
  <script type="module" data-merit-offline-pdf>${pdfBlock}</script>
  <script src="./assets/ocr/tesseract.min.js"></script>
  <script>${appBlock}</script>
</body>
</html>
`;

// Cleared first: a file a previous build shipped and this one no longer uses
// must not ride along in the package.
rmSync(OCR_OUT, { recursive: true, force: true });
mkdirSync(OCR_OUT, { recursive: true });
writeFileSync(path.join(OUT, "index.html"), html);
copyFileSync(path.join(tesseractDir, "dist/tesseract.min.js"), path.join(OCR_OUT, "tesseract.min.js"));
// Each embedded asset is `(globalThis.MERIT_OCR_EMBED ||= {})[key] = "<text>"`:
// the worker and core as their JavaScript source, the language data as base64
// of the .gz file the worker un-gzips itself.
const embed = (name, key, text) => writeFileSync(path.join(OCR_OUT, name),
  `(globalThis.MERIT_OCR_EMBED=globalThis.MERIT_OCR_EMBED||{})[${JSON.stringify(key)}]=${JSON.stringify(text)};\n`);
embed("embed-worker.js", "worker", readFileSync(path.join(tesseractDir, "dist/worker.min.js"), "utf8"));
embed("embed-core.js", "core", readFileSync(path.join(tesseractCoreDir, "tesseract-core-simd-lstm.wasm.js"), "utf8"));
embed("embed-eng.js", "eng", readFileSync(engTrainedData).toString("base64"));
embed("embed-tur.js", "tur", readFileSync(turTrainedData).toString("base64"));

// The OCR model: the runtime script as shipped, its wasm and module loader and
// both models as base64 strings on MERIT_PPOCR_EMBED, the character list as the
// app's own file.
const PPOCR_OUT = path.join(OCR_OUT, "ppocr");
mkdirSync(PPOCR_OUT, { recursive: true });
const embedModel = (name, key, text) => writeFileSync(path.join(PPOCR_OUT, name),
  `(globalThis.MERIT_PPOCR_EMBED=globalThis.MERIT_PPOCR_EMBED||{})[${JSON.stringify(key)}]=${JSON.stringify(text)};\n`);
copyFileSync(path.join(ortDir, "dist", ortScript), path.join(PPOCR_OUT, ortScript));
embedModel("embed-wasm.js", "wasm", readFileSync(path.join(ortDir, "dist/ort-wasm-simd-threaded.wasm")).toString("base64"));
embedModel("embed-mjs.js", "mjs", readFileSync(path.join(ortDir, "dist/ort-wasm-simd-threaded.mjs"), "utf8"));
embedModel("embed-det.js", "det", modelBytes.det.toString("base64"));
embedModel("embed-rec.js", "rec", modelBytes.rec.toString("base64"));
copyFileSync(path.join(ROOT, "src/plan-ocr-paddle-keys.js"), path.join(PPOCR_OUT, "keys.js"));
// Licences travel with the bytes: the package's own LICENSE file where it ships
// one, otherwise the licence its package.json declares.
writeFileSync(path.join(PPOCR_OUT, "NOTICE.txt"), [[ortDir, ortPkg, ortVersion], [modelDir, modelPkg, modelVersion]].map(([dir, pkg, v]) => {
  const declared = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).license || "licence in its LICENSE file";
  const text = existsSync(path.join(dir, "LICENSE")) ? readFileSync(path.join(dir, "LICENSE"), "utf8") : `${pkg} declares the ${declared} licence in its package.json.`;
  return `==== ${pkg}@${v} (${declared}) ====\n${text}\n`;
}).join("\n"));

const totalSize = execSync(`du -sh "${OUT}"`).toString().split("\t")[0];
console.log(`Bundled ${appJsFiles.length} app sources from index.html: ${appJsFiles.map((f) => f.replace("src/", "")).join(", ")}`);
console.log(`Wrote ${OUT}/ (${totalSize} total, including offline OCR assets)`);
console.log("Open dist/merit-offline/index.html by double-click, or serve the folder — OCR runs either way with no network (verify-offline-package checks both).");
