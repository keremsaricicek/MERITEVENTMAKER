// WHAT A STRICTER CONTENT-SECURITY-POLICY WOULD STILL BREAK — COUNTED, AND NO NEW ONE.
//
// `.claude/skills/merit-security-hardening/SKILL.md`, Network and CSP: "Track
// what a CSP would break: inline handlers, inline styles, blob: workers. The
// goal is to be CSP-ready before desktop packaging."
//
// Two suites already hold part of it: `csp-policy` runs the product under the
// enforced policy and fails on any violation, and `html-sink-inventory` fails
// on an inline event-handler attribute, a second inline <script> or any
// string-evaluating API. What neither holds is the list of RELAXATIONS the
// policy still carries, and the code that needs each one:
//
//   style-src-attr 'unsafe-inline'   every `style="…"` written into markup
//   worker-src / script-src blob:    every worker or script built from a Blob
//   'wasm-unsafe-eval'               the OCR and model WebAssembly
//   https://cdn.jsdelivr.net         every external engine index.html loads
//
// A desktop build wants each relaxation gone. Until then the debt is pinned
// here per file, so it can only shrink on purpose: a NEW style attribute, a new
// Blob-built script or worker, a new external script, a new <style> element or
// setAttribute("style") — or a new allowance in either policy (index.html, and
// the offline builds' scripts/lib/offline-csp.mjs) — fails, naming the file.
// A count that DROPPED fails too, with the number to write here: a ceiling left
// above the code would let the next one in silently.
//
// MUTATION PROOF (in this suite, every run): the counter is fed a source with
// one style attribute, one Blob-built script and one worker added, and must
// report each; a policy with one extra source must be reported as widened.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const meta = { name: "csp-readiness", tags: ["security", "fast"], timeout: 20000 };

// The debt, per file. Each kind names the relaxation that it is the reason for.
const INVENTORY = {
  // style-src-attr 'unsafe-inline': positions, sizes and colours computed per
  // object (a table at x %, a progress bar's width). Moving them to CSSOM
  // (`el.style.left = …`, which no policy blocks) is the path to dropping it.
    // 2026-11-12 (Atlas Salon): +1 app-v8.js (a decorative seat mark at x/y % and its angle), +1 floor-plan-view.js (the hall outline's computed box) — the same kind as a chair's position.
  styleAttr: {
    "app-guests.js": 12, "app-v8.js": 8, "app.js": 9, "screen-events.js": 2, "screen-guests.js": 5,
    "screen-live.js": 4, "screen-reading.js": 3, "screen-reports.js": 8, "screen-review.js": 6,
    "screen-seating.js": 2, "screen-vlm.js": 3, "screen-wizard.js": 2,
    // moved with their code out of app-v8.js (benchmarks/CODE-HEALTH-2026-11.md): the
    // PDF page thumbnails' and cover's sizes, and the load band's fill width.
    "screen-setup.js": 2, "service-load-panel.js": 1, "floor-plan-view.js": 2,
  },
  // worker-src blob: / script-src blob: — the OCR engines and the ONNX worker
  // pool build their worker code into a Blob so the package needs no server.
  blobScript: { "plan-ocr-paddle.js": 1, "plan-ocr.js": 1, "plan-ort-pool.js": 2 },
  worker: { "plan-ort-pool.js": 1 },
  // style-src 'self' refuses both outright; there must be none.
  styleElement: {},
  setAttributeStyle: {},
};

const PATTERNS = {
  styleAttr: /\bstyle=["'\\]/g,
  blobScript: /new Blob\(\[[^\]]*\]\s*,\s*\{\s*type:\s*["'](?:text|application)\/javascript/g,
  worker: /new\s+(?:Shared)?Worker\(/g,
  styleElement: /<style[\s>]/gi,
  setAttributeStyle: /setAttribute\(\s*["']style["']/g,
};

// Comments carry examples (`style="…"` in an explanation) and are not code.
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");

export function countCspDebt(sources) {
  const out = Object.fromEntries(Object.keys(PATTERNS).map((k) => [k, {}]));
  for (const [file, text] of Object.entries(sources)) {
    for (const [kind, re] of Object.entries(PATTERNS)) {
      const n = (text.match(re) || []).length;
      if (n) out[kind][file] = n;
    }
  }
  return out;
}

function diff(found, expected) {
  const grew = [], shrank = [];
  for (const kind of Object.keys(PATTERNS)) {
    const f = found[kind] || {}, e = expected[kind] || {};
    for (const file of new Set([...Object.keys(f), ...Object.keys(e)])) {
      const now = f[file] || 0, was = e[file] || 0;
      if (now > was) grew.push(`${kind} in ${file}: ${now} (inventory ${was})`);
      if (now < was) shrank.push(`${kind} in ${file}: ${now} — lower the inventory from ${was}`);
    }
  }
  return { grew, shrank };
}

// A policy reduced to its allowances: hashes are content (they change with
// every build) and are replaced by a placeholder, everything else is pinned.
const allowances = (policy) => Object.fromEntries(policy.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
  const [name, ...values] = d.split(/\s+/);
  return [name, [...new Set(values.map((v) => (/^'sha256-/.test(v) ? "'sha256-…'" : v)))].sort()];
}));
const widened = (now, pinned) => {
  const out = [];
  for (const [dir, values] of Object.entries(now)) {
    const was = pinned[dir];
    if (!was) out.push(`new directive ${dir} ${values.join(" ")}`);
    else for (const v of values) if (!was.includes(v)) out.push(`${dir} gained ${v}`);
  }
  for (const dir of Object.keys(pinned)) if (!now[dir]) out.push(`directive ${dir} disappeared (falls back to default-src)`);
  return out;
};

const INDEX_POLICY = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'wasm-unsafe-eval'", "https://cdn.jsdelivr.net"],
  "worker-src": ["'self'", "blob:", "https://cdn.jsdelivr.net"],
  "connect-src": ["'self'", "blob:", "data:", "https://cdn.jsdelivr.net"],
  "img-src": ["'self'", "blob:", "data:"],
  "style-src": ["'self'"],
  "style-src-attr": ["'unsafe-inline'"],
  "font-src": ["'self'", "data:"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'self'"],
};
const OFFLINE_POLICY = {
  "default-src": ["'none'"],
  "script-src": ["'self'", "'sha256-…'", "'wasm-unsafe-eval'", "blob:"],
  "worker-src": ["blob:"],
  "connect-src": ["blob:", "data:"],
  "img-src": ["'self'", "blob:", "data:"],
  "style-src": ["'sha256-…'"],
  "style-src-attr": ["'unsafe-inline'"],
  "font-src": ["data:"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
};
// The external engines index.html loads (the offline builds inline or ship them).
const EXTERNAL_SCRIPTS = [
  "https://cdn.jsdelivr.net/npm/@e965/xlsx@0.20.3/dist/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
];

export default async function run({ checks, repoRoot }) {
  const srcDir = path.join(repoRoot, "src");
  const sources = {};
  for (const f of fs.readdirSync(srcDir).filter((f) => /\.m?js$/.test(f))) sources[f] = stripJsComments(fs.readFileSync(path.join(srcDir, f), "utf8"));
  const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  sources["index.html"] = stripHtmlComments(indexHtml);

  // --- 0. the counter bites -------------------------------------------------
  const mutant = countCspDebt({ "m.js": `x.innerHTML=\`<div style="left:\${a}%">\`;const u=URL.createObjectURL(new Blob([src], { type: "text/javascript" }));new Worker(u);` });
  checks.equal([mutant.styleAttr["m.js"], mutant.blobScript["m.js"], mutant.worker["m.js"]], [1, 1, 1],
    "mutation: one added style attribute, Blob-built script and worker are each counted", mutant);
  checks.equal(diff(mutant, {}).grew.length, 3, "mutation: and each is reported as new debt");
  checks.ok(widened(allowances("default-src 'self'; script-src 'self' https://evil.example"), { "default-src": ["'self'"], "script-src": ["'self'"] })[0] === "script-src gained https://evil.example",
    "mutation: a policy with one extra source is reported as widened");

  // --- 1. the code's debt is exactly the inventory --------------------------
  const found = countCspDebt(sources);
  const { grew, shrank } = diff(found, INVENTORY);
  checks.equal(grew, [], "no NEW inline style attribute, Blob-built script, worker, <style> element or setAttribute('style') — move the value to CSSOM (el.style.x = …), or write it into this inventory with its reason", found);
  checks.equal(shrank, [], "no stale inventory entry: a count that dropped is lowered here, so the ceiling stays at the code", found);

  // --- 2. neither policy gained an allowance --------------------------------
  const indexPolicy = (indexHtml.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
  checks.ok(!!indexPolicy, "index.html carries its policy");
  checks.equal(widened(allowances(indexPolicy), INDEX_POLICY), [], "index.html's policy allows nothing it did not allow when this inventory was taken", allowances(indexPolicy));
  const { offlineCspMeta } = await import(pathToFileURL(path.join(repoRoot, "scripts/lib/offline-csp.mjs")).href);
  for (const scriptSelf of [false, true]) {
    const meta = offlineCspMeta({ scripts: ["a()"], styles: ["b{}"], scriptSelf });
    const policy = (meta.match(/content="([^"]+)"/) || [])[1] || "";
    // the folder build is served by the package's own local server (vlm-relay): its page reaches that
    // server's doors (disk backup, the plan model's second look, the assistant's reader) on its own
    // origin, so connect-src 'self' there — reviewed 2026-11-01 (8593563); the single file has no server
    const pinned = scriptSelf ? { ...OFFLINE_POLICY, "connect-src": ["'self'", ...OFFLINE_POLICY["connect-src"]] } : { ...OFFLINE_POLICY, "script-src": OFFLINE_POLICY["script-src"].filter((v) => v !== "'self'") };
    checks.equal(widened(allowances(policy), pinned), [], `the offline ${scriptSelf ? "folder" : "single-file"} build's policy allows nothing new`, allowances(policy));
  }
  const external = [...sources["index.html"].matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith("src/"));
  checks.equal(external, EXTERNAL_SCRIPTS, "index.html loads no external script beyond the two pinned engines");

  // Printed every run, so the remaining distance to a strict policy is never hidden.
  const total = (k) => Object.values(found[k]).reduce((a, b) => a + b, 0);
  console.log(`    CSP debt still open: ${total("styleAttr")} inline style attributes (style-src-attr 'unsafe-inline'), ${total("blobScript")} Blob-built scripts and ${total("worker")} worker (blob:), 'wasm-unsafe-eval' for OCR/model WebAssembly, ${external.length} CDN engines in the served build`);
}
