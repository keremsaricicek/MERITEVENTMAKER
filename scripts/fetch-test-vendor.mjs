#!/usr/bin/env node
// Developer- and CI-time only: puts the CDN engines index.html loads — and the
// OCR language data Tesseract fetches for itself — into .vendor-cache, pinned,
// so the test suites and benchmark runners serve them locally and measure the
// same product on every machine. The product itself never runs this.
//
//   npm run vendor:test
//
// The pins live in tests/lib/vendor.mjs (OCR_PACKAGES), next to the code that
// serves them.
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { CACHE, OCR_PACKAGES } from "../tests/lib/vendor.mjs";

for (const [name, version] of OCR_PACKAGES) {
  const base = name.replace("/", "-") + "-" + version;
  const tgz = path.join(CACHE, base + ".tgz");
  const dir = path.join(CACHE, base);
  if (existsSync(path.join(dir, "package"))) { console.log(`cached      ${name}@${version}`); continue; }
  mkdirSync(dir, { recursive: true });
  const short = name.split("/").pop();
  const url = `https://registry.npmjs.org/${name}/-/${short}-${version}.tgz`;
  console.log(`downloading ${name}@${version}`);
  execFileSync("curl", ["-sSfL", "-o", tgz, url], { stdio: "inherit" });
  execFileSync("tar", ["xzf", tgz, "-C", dir]);
}
console.log("OCR engine and language data are in .vendor-cache.");
