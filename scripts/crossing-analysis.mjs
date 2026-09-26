// WHAT WOULD THIS MOVE HAVE TO CARRY WITH IT?
//
// `.claude/rules/code-health.md`: "A structural move names its crossings
// first. Measure, in stripped code, what the region reads from the shell's
// scope and what the shell reads from it. Count EVERY DECLARATOR on a
// comma-separated `const` line: missing the third name on a four-name line is
// what shipped a `ReferenceError` into every real detection on the first
// attempt."
//
// That rule was followed by hand twice and is a tool now, because it is about
// to be followed six more times and because doing it by eye is exactly how the
// first attempt failed. `src/plan-detection-classical.js:163` is
// `const RGB_BITS=3,RGB_LEVELS=1<<RGB_BITS,RGB_BINS=RGB_LEVELS**3,RGB_SHIFT=8-RGB_BITS;`
// — four names on one line, and a reading that captures only the first calls
// an unsafe move clean.
//
// It reports three things for a candidate region:
//
//   OUTWARD   names the region reads that are bound in the file OUTSIDE it.
//             Each one must move with the region, become an argument, or be
//             published — and a name used on BOTH sides is the finding that
//             says the cut is in the wrong place.
//   INWARD    names the region binds that the rest of the file reads. These
//             become the module's published surface.
//   PRIVATE   names the region binds that nobody outside reads. These are free.
//
// Usage — by line range, or by the first/last top-level declaration:
//   node scripts/crossing-analysis.mjs src/plan-detection-classical.js 165 324
//   node scripts/crossing-analysis.mjs src/plan-detection-classical.js rgbBinIndex buildClassMasks
//
// The second form is exclusive of the end marker, which is how the ownership
// map's groups are written ("A-2: rgbBinIndex .. up to buildClassMasks").
import fs from "node:fs";
import { stripCommentsAndStrings } from "../tests/lib/js-scan.mjs";

const [file, a, b] = process.argv.slice(2);
if (!file || !a || !b) {
  console.error("usage: crossing-analysis.mjs <file> <startLine|startFn> <endLine|endFn>");
  process.exit(2);
}
const lines = fs.readFileSync(file, "utf8").split("\n");
const findFn = (name) => {
  const i = lines.findIndex((l) => new RegExp(`^  (?:async )?(?:function )?${name}\\b`).test(l));
  if (i < 0) { console.error(`no top-level declaration named ${name}`); process.exit(2); }
  return i;
};
const start = /^\d+$/.test(a) ? Number(a) - 1 : findFn(a);
const end = /^\d+$/.test(b) ? Number(b) : findFn(b);

const region = lines.slice(start, end).join("\n");
const outside = lines.slice(0, start).concat(lines.slice(end)).join("\n");
const rs = stripCommentsAndStrings(region);
const os = stripCommentsAndStrings(outside);

// Every top-level binding, INCLUDING every declarator on a comma-separated
// line. This is the part that must not be simplified.
const bindings = (text) => {
  const names = new Set();
  for (const m of text.matchAll(/(?:^|\n)  (?:async )?function ([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/(?:^|\n)  (?:const|let|var)\s+([^\n;]*)/g)) {
    let depth = 0, cur = "";
    const parts = [];
    for (const ch of m[1]) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
      if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
      cur += ch;
    }
    parts.push(cur);
    for (const p of parts) {
      const n = p.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  }
  return names;
};
const count = (text, n) => (text.match(new RegExp(`\\b${n}\\b`, "g")) || []).length;

const regionBinds = bindings(rs);
const outerBinds = bindings(os);

// A HANDLE TO A PUBLISHED MODULE IS NOT SHELL COUPLING. `const GEO =
// globalThis.MeritPlanGeometry` reads as an outward crossing by the letter of
// the rule and is nothing of the kind: the region depends on another MODULE,
// which is the one-way direction this codebase wants, and the new file can
// simply bind its own handle. Reporting it as "the cut is in the wrong place"
// would argue against exactly the moves that are going well.
const handles = new Map();
for (const m of os.matchAll(/(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*globalThis\.((?:Merit|MERIT_)[A-Za-z0-9_$]*)/g))
  handles.set(m[1], m[2]);

const outward = [...outerBinds].filter((n) => count(rs, n) > 0 && !regionBinds.has(n));
const inward = [...regionBinds].filter((n) => count(os, n) > 0);
const priv = [...regionBinds].filter((n) => count(os, n) === 0);

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${file}  lines ${start + 1}–${end}  (${end - start} lines)`);
console.log(`region binds ${regionBinds.size} name(s)\n`);

console.log(`OUTWARD — the region reads these, and they are bound outside it (${outward.length}):`);
if (!outward.length) console.log("  none — the region is closed over its own arguments");
for (const n of outward) {
  const inN = count(rs, n), outN = count(os, n);
  // A name used on BOTH sides cannot simply travel with the region: moving it
  // breaks the other side, copying it creates two sources of truth. That is
  // the cut being in the wrong place, and it is the most useful line here.
  const verdict = handles.has(n)
    ? `MODULE HANDLE for globalThis.${handles.get(n)} — the new file binds its own; not shell coupling`
    : outN > 0
      ? "SHARED — used on both sides; the cut does not separate it"
      : "moves with the region";
  console.log(`  ${pad(n, 20)} region=${pad(inN, 4)} outside=${pad(outN, 4)} ${verdict}`);
}

console.log(`\nINWARD — the rest of the file reads these, so they are the published surface (${inward.length}):`);
if (!inward.length) console.log("  none");
for (const n of inward) console.log(`  ${pad(n, 20)} ${count(os, n)} reference(s) outside`);

console.log(`\nPRIVATE — bound in the region and read nowhere else (${priv.length}):`);
console.log(priv.length ? "  " + priv.join(", ") : "  none");

// And whether anything beyond this file cares, which decides how many names
// the move adds to the app's vocabulary.
const others = fs.readdirSync("src").filter((f) => f.endsWith(".js") && !file.endsWith(f));
const elsewhere = [];
for (const f of others) {
  const code = stripCommentsAndStrings(fs.readFileSync(`src/${f}`, "utf8"));
  for (const n of regionBinds) if (count(code, n)) elsewhere.push(`${f}: ${n}`);
}
console.log(`\nELSEWHERE IN src/ (${elsewhere.length}):`);
console.log(elsewhere.length ? "  " + elsewhere.join("\n  ") : "  nothing outside this file names any of them");
console.log();
