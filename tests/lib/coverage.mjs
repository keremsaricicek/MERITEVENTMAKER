// What the regression suite actually EXECUTES in src/ — V8 block coverage,
// collected from every suite's page and merged. Opt-in:
//
//   MERIT_COVERAGE=1 npm run test:all
//
// §28 of the master programme asks for four things and explicitly not a
// line-coverage percentage: unreachable production regions, critical business
// paths with no behaviour test, critical error branches with no test, and
// dynamic branches never executed. The first is answered statically
// (tests/lib/js-scan.mjs, i18n-hardcoded-english's reachability model); this
// answers the fourth, and is the raw material for the other two — a function
// or branch no suite ever ran is where to look for a path no suite protects.
//
// A byte counts as executed when the innermost V8 range containing it has a
// count above zero in ANY suite. Ranges are applied in the order V8 reports
// them (a function's own range first, its nested blocks after), which is the
// same resolution c8 uses. The percentage is printed because it is cheap, not
// because it is the point.
import fs from "node:fs";
import path from "node:path";

const merged = new Map(); // url -> { source, hit: Uint8Array, fns: Map(key -> {name, start, end, ran}) }

export function addCoverage(entries, baseUrl) {
  for (const entry of entries) {
    if (!entry.url.startsWith(baseUrl + "/src/") || !entry.url.endsWith(".js")) continue;
    const rel = entry.url.slice(baseUrl.length + 1).split("?")[0];
    let file = merged.get(rel);
    if (!file) merged.set(rel, file = { source: entry.source, hit: new Uint8Array(entry.source.length), fns: new Map() });
    const local = new Uint8Array(entry.source.length);
    for (const fn of entry.functions) {
      for (const r of fn.ranges) local.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
      const whole = fn.ranges[0];
      if (!fn.functionName || !whole) continue;
      const key = `${fn.functionName}@${whole.startOffset}`;
      const seen = file.fns.get(key) || { name: fn.functionName, start: whole.startOffset, end: whole.endOffset, ran: false };
      seen.ran = seen.ran || whole.count > 0;
      file.fns.set(key, seen);
    }
    for (let i = 0; i < local.length; i++) if (local[i]) file.hit[i] = 1;
  }
}

const lineOf = (source, offset) => source.slice(0, offset).split("\n").length;

export function writeCoverage(outDir) {
  const files = [];
  for (const [rel, f] of [...merged.entries()].sort()) {
    let code = 0, ran = 0;
    for (let i = 0; i < f.source.length; i++) if (!/\s/.test(f.source[i])) { code++; if (f.hit[i]) ran++; }
    // Unexecuted stretches, as line spans, longest first — "dynamic branches
    // never executed", located.
    const gaps = [];
    for (let i = 0; i < f.source.length;) {
      if (f.hit[i] || /\s/.test(f.source[i])) { i++; continue; }
      let j = i; while (j < f.source.length && !f.hit[j]) j++;
      const text = f.source.slice(i, j);
      const chars = text.replace(/\s/g, "").length;
      if (chars >= 40) gaps.push({ fromLine: lineOf(f.source, i), toLine: lineOf(f.source, j), chars, head: text.trim().slice(0, 80) });
      i = j;
    }
    gaps.sort((a, b) => b.chars - a.chars);
    const neverRan = [...f.fns.values()].filter(x => !x.ran).map(x => ({ name: x.name, line: lineOf(f.source, x.start) }));
    files.push({ file: rel, codeChars: code, executedChars: ran, executed: code ? +(ran / code).toFixed(3) : null,
      functionsNeverRun: neverRan.length, neverRan, largestGaps: gaps.slice(0, 25) });
  }
  fs.mkdirSync(outDir, { recursive: true });
  const report = { ranAt: new Date().toISOString(),
    note: "V8 block coverage merged across every suite page that ran. INFO, not a gate: §28 asks where the untested paths are, not for a percentage.",
    files };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1) + "\n");
  console.log("\nCOVERAGE (executed share of non-whitespace source; functions no suite ever ran)");
  for (const f of files) console.log(`  ${f.file.padEnd(38)} ${String(f.executed).padStart(6)}   never ran: ${f.functionsNeverRun}`);
  console.log(`  wrote ${path.relative(process.cwd(), path.join(outDir, "report.json"))}`);
}
