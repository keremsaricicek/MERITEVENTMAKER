// The app shell's source as a check has to read it once screens move out.
//
// app-v8.js hands each screen module (src/screen-*.js) the shell names it
// uses — the `original` capture included — so a fact a suite checks "in
// app-v8.js" (a delegation through original.X, a bare-exception toast, an
// audit truncation) can now live in a screen module. A check that reads only
// app-v8.js would silently stop seeing the code that moved.
import fs from "node:fs";
import path from "node:path";

// Every module created once by app-v8.js with its dependencies: the screens
// (src/screen-*.js) AND the capabilities that left the shell the same way
// (data-portability.js, guest-record-undo.js, … — benchmarks/CODE-HEALTH-2026-11.md).
// Code that left app-v8.js is still the shell's code; a scan that read only the
// screens would lose it the day it moved. Same predicate as `screen-modules`.
export function screenFiles(repoRoot) {
  const dir = path.join(repoRoot, "src");
  return fs.readdirSync(dir).filter((f) => /\.js$/.test(f)
    && (/^screen-/.test(f) || /DEPS:Object\.freeze\(/.test(fs.readFileSync(path.join(dir, f), "utf8")))).sort();
}
// app-v8.js followed by every screen module, each preceded by a marker line.
export function shellAndScreens(repoRoot) {
  const read = (f) => fs.readFileSync(path.join(repoRoot, "src", f), "utf8");
  return [read("app-v8.js"), ...screenFiles(repoRoot).map((f) => `\n// ==== ${f} ====\n` + read(f))].join("\n");
}
