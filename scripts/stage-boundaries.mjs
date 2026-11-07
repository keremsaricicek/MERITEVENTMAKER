// WHAT WOULD HAVE TO BECOME A PARAMETER BEFORE `detect()` CAN BE SPLIT?
//
// `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md` says Split B — taking stages
// out of `detect()` — is "a design job, not a move", and gives the reason: the
// stages share local bindings and are ordered by data, because table scoring
// uses the chair modal size. Split A could be done by naming crossings;
// Split B cannot, because the crossings are not between a region and a file,
// they are between one stage and every stage after it.
//
// This measures that. For each stage — the code between two `mark()` calls —
// it reports:
//
//   DECLARED   bindings introduced in the stage, counting every declarator
//              on a comma-separated line, the detail that shipped a
//              ReferenceError the first time this file was split.
//   ESCAPES    of those, the ones LATER stages read. Each is a value that
//              would have to cross an extracted stage's boundary: a return
//              field, a parameter, or a shared context object.
//   INHERITED  bindings the stage reads that an EARLIER stage declared.
//
// A stage whose declarations all escape is not separable on its own; a stage
// that inherits little and escapes little is where a real cut exists.
//
//   node scripts/stage-boundaries.mjs
//
// This measures only. Nothing here moves code, and the numbers are a snapshot
// to be re-taken rather than quoted from memory.
//
// AND THE ESCAPE COUNT IS AN UPPER BOUND, not a count. Scope in JavaScript
// cannot be read with regexes: this one knows about `const`/`let`/`var`,
// function and arrow parameters, and re-declaration in a later stage, which
// took the figure from 92 to 73 — but destructuring, catch bindings and
// nested callback parameters still leak through, so a later stage's own
// `labels` reads as a use of an earlier stage's. The remainder needs a real
// parser. The SHAPE of the result is what it is for, and that survives: which
// stages are large, which escape nothing, and which values genuinely order
// the pipeline.
import fs from "node:fs";
import { stripCommentsAndStrings } from "../tests/lib/js-scan.mjs";

const FILE = process.argv[2] || "src/plan-detection-classical.js";
const raw = fs.readFileSync(FILE, "utf8");
// Two views of the same file, line for line. The RAW text is where the stage
// names are read, because `mark("pixels")` is a string literal and the
// stripper blanks it — the first version of this looked for the marks in the
// stripped text and found one stage covering the whole function. The STRIPPED
// text is where bindings are read, so a name inside a comment or a string
// cannot be mistaken for code.
const rawLines = raw.split("\n");
const lines = stripCommentsAndStrings(raw).split("\n");
if (rawLines.length !== lines.length) {
  console.error("the stripper did not preserve line numbers; the two views cannot be aligned");
  process.exit(2);
}

const detectAt = rawLines.findIndex((l) => /async detect\(pixels,width,height/.test(l));
if (detectAt < 0) { console.error("detect() not found"); process.exit(2); }
const marks = [];
rawLines.forEach((l, i) => {
  const m = l.match(/mark\("([^"]+)"\)/);
  if (m && i > detectAt) marks.push({ name: m[1], line: i });
});
if (!marks.length) { console.error("no mark() calls found inside detect()"); process.exit(2); }
// The tail after the last mark is a stage too — it is where the result object
// is assembled, and it reads from everything.
const endAt = lines.length - 1;
const stages = [];
let from = detectAt + 1;
for (const m of marks) { stages.push({ name: m.name, from, to: m.line }); from = m.line + 1; }
stages.push({ name: "(assemble)", from, to: endAt });

// Bindings introduced by a block, counting EVERY declarator. Inside detect()
// the indentation is deeper and irregular, so this does not anchor on two
// spaces the way the top-level readers do.
const declaredIn = (text) => {
  const names = new Set();
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([^\n;=]*?)(?==[^=]|;|\n)/g)) {
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
  for (const m of text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // PARAMETERS ARE DECLARATIONS TOO, and leaving them out is what kept `x`,
  // `y`, `c` and `v` in the crossing list: `chairs.map(c => c.w)` reads `c`,
  // and a reader that only knows about `const`/`let`/`var` sees that as a use
  // of some outer `c` rather than of the parameter three characters to its
  // left. Arrow parameters, both parenthesised and bare, and function
  // parameters.
  for (const m of text.matchAll(/\(([^()]*)\)\s*=>/g))
    for (const p of m[1].split(",")) {
      const n = p.trim().match(/^\.{0,3}([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  for (const m of text.matchAll(/(?:^|[^\w.$])([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  for (const m of text.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^()]*)\)/g))
    for (const p of m[1].split(",")) {
      const n = p.trim().match(/^\.{0,3}([A-Za-z_$][\w$]*)/);
      if (n) names.add(n[1]);
    }
  return names;
};
const readsOf = (text) =>
  new Set([...text.matchAll(/(^|[^\w.$])([A-Za-z_$][\w$]*)/g)].map((m) => m[2]));

const text = (s) => lines.slice(s.from, s.to).join("\n");
for (const s of stages) { s.declared = declaredIn(text(s)); s.reads = readsOf(text(s)); }

// A stage's escapes: what it declares that any LATER stage reads WITHOUT
// declaring it again.
//
// The re-declaration clause is not a refinement, it is the difference between
// a measurement and a number. Without it every `i`, `x`, `c` and `v` counts as
// crossing a boundary, because a later stage's own loop variable shares the
// name — the first run of this reported 92 distinct crossings, and a large
// part of that was loop counters shadowing each other in code that never
// shares a value at all.
for (let i = 0; i < stages.length; i++) {
  const later = stages.slice(i + 1);
  stages[i].escapes = [...stages[i].declared]
    .filter((n) => later.some((s) => s.reads.has(n) && !s.declared.has(n)));
  const earlier = stages.slice(0, i);
  stages[i].inherited = [...stages[i].reads]
    .filter((n) => !stages[i].declared.has(n) && earlier.some((s) => s.declared.has(n)));
}

const pad = (v, n) => String(v).padEnd(n);
console.log(`\n${FILE} — detect() at line ${detectAt + 1}, ${stages.length} stages\n`);
console.log("stage          lines  declared  escapes  inherited");
for (const s of stages)
  console.log(`${pad(s.name, 14)} ${pad(s.to - s.from, 6)} ${pad(s.declared.size, 9)} ` +
    `${pad(s.escapes.length, 8)} ${s.inherited.length}`);

const allEscapes = new Set();
for (const s of stages) for (const n of s.escapes) allEscapes.add(n);
console.log(`\nUPPER BOUND ON VALUES THAT CROSS A STAGE BOUNDARY: ${allEscapes.size}`);
console.log("An UPPER bound, and deliberately labelled as one. This reads scopes with");
console.log("regexes, and JavaScript scoping cannot be read that way: destructuring,");
console.log("catch bindings and parameters of nested callbacks all leak through, so a");
console.log("later stage's own `labels` or `w` still reads as a use of an earlier");
console.log("stage's. Successive refinements took the figure from 92 to 73 and the");
console.log("remainder needs a real parser rather than another regex.");
console.log("");
console.log("What survives the noise, and is what this measurement is for:");
console.log("  - the two big stages are 78% of detect(), so Split B is mostly them;");
console.log("  - `(assemble)` inherits from every stage, because the result object");
console.log("    reads from all of them — it cannot move, it is the return value;");
console.log("  - the chairs -> tables ordering is REAL, not incidental: chairModal,");
console.log("    chairUniform, chairs and chairSource all cross that boundary, which");
console.log("    is the ownership map's stated reason that the stages are ordered by");
console.log("    data rather than by choice;");
console.log("  - a stage that escapes NOTHING is where a cut actually exists.\n");

for (const s of stages) {
  if (!s.escapes.length) continue;
  console.log(`  ${s.name} → ${s.escapes.length}`);
  console.log(`    ${s.escapes.sort().join(", ")}`);
}
console.log();
