// The third-party inventory (benchmarks/dependencies/INVENTORY.json) against
// the pins in the code — including what `npm audit` never sees: the CDN
// scripts, the WASM runtimes, the OCR data and the model weights.
//
// What this pins:
//   EVERY RUNTIME PIN HAS A ROW, AT THE SAME VERSION. A version changed in
//     index.html, a build script, the OCR loader or the test vendor list
//     without its row (or the reverse) fails here.
//   EVERY ADVISORY HAS A STATUS. An advisory row is OPEN, NOT AFFECTED or NOT
//     REACHABLE with its reason; an OPEN row must name what blocks the fix.
//   THE OPEN ONES ARE REPORTED, NOT HIDDEN: printed as a check that passes
//     only while the row says why it is still open.
import fs from "node:fs";
import path from "node:path";

export const meta = { name: "dependency-inventory", tags: ["security", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  const read = (f) => fs.readFileSync(path.join(repoRoot, f), "utf8");
  const inv = JSON.parse(read("benchmarks/dependencies/INVENTORY.json"));
  const rows = new Map(inv.assets.map((a) => [a.name, a]));

  // What the code pins, found where it is pinned.
  const found = [];
  const add = (name, version, where) => found.push({ name, version, where });
  for (const m of (read("index.html") + read("src/pdf-bridge.mjs")).matchAll(/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\//g)) add(m[1], m[2], "index.html / pdf-bridge");
  for (const f of ["scripts/build-offline.mjs", "scripts/build-offline-full.mjs"]) {
    const src = read(f);
    for (const [k, name] of [["XLSX_VERSION", "xlsx"], ["PDFJS_VERSION", "pdfjs-dist"], ["TESSERACT_VERSION", "tesseract.js"], ["TESSERACT_CORE_VERSION", "tesseract.js-core"]]) {
      const m = src.match(new RegExp(`const ${k} = "([^"]+)"`));
      if (m) add(name, m[1], f);
    }
  }
  const paddle = read("src/plan-ocr-paddle.js");
  const rt = paddle.match(/runtime: \{ package: "([^"]+)", version: "([^"]+)"/), md = paddle.match(/package: "(paddle-ocr-onnx-models)", version: "([^"]+)"/);
  if (rt) add(rt[1], rt[2], "src/plan-ocr-paddle.js");
  if (md) add(md[1], md[2], "src/plan-ocr-paddle.js");
  for (const m of read("tests/lib/vendor.mjs").matchAll(/\["((?:@[^"\/]+\/)?[^"]+)", "([0-9][^"]*)"\]/g)) add(m[1], m[2], "tests/lib/vendor.mjs");
  const pkg = JSON.parse(read("package.json"));
  for (const [name, v] of Object.entries(pkg.dependencies || {})) add(name, v.replace(/^[\^~]/, ""), "package.json");

  checks.ok(found.length >= 12, `the scan found the code's pins (${found.length})`, found.length);
  const missing = found.filter((f) => !rows.has(f.name)).map((f) => `${f.name}@${f.version} (${f.where})`);
  const drift = found.filter((f) => rows.has(f.name) && rows.get(f.name).version !== f.version).map((f) => `${f.name}: code ${f.version} (${f.where}) vs inventory ${rows.get(f.name).version}`);
  checks.equal([...new Set(missing)], [], "every third-party asset the code pins has an inventory row");
  checks.equal([...new Set(drift)], [], "and every row's version is the one the code pins");
  const unused = inv.assets.filter((a) => a.version !== "in-repo" && !found.some((f) => f.name === a.name)).map((a) => a.name);
  checks.equal(unused, [], "no inventory row describes an asset the code no longer pins");

  const advisories = inv.assets.flatMap((a) => (a.advisories || []).map((x) => ({ asset: a.name, ...x })));
  checks.ok(advisories.every((x) => /^(OPEN|NOT AFFECTED|NOT REACHABLE) — /.test(x.status || "")), "every advisory states OPEN, NOT AFFECTED or NOT REACHABLE, with its reason", advisories.filter((x) => !/^(OPEN|NOT AFFECTED|NOT REACHABLE) — /.test(x.status || "")));
  const open = advisories.filter((x) => x.status.startsWith("OPEN"));
  checks.ok(open.every((x) => /block|blocked/i.test(x.status) && x.fixedIn), `open advisories name their fixed version and what blocks it (${open.map((x) => `${x.asset} ${x.id}`).join(", ") || "none"})`, open);
  checks.ok(inv.assets.every((a) => a.license), "every asset names its licence");
}
