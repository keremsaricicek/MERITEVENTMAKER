// The app shell's source as a check has to read it once screens move out.
//
// app-v8.js hands each screen module (src/screen-*.js) the shell names it
// uses — the `original` capture included — so a fact a suite checks "in
// app-v8.js" (a delegation through original.X, a bare-exception toast, an
// audit truncation) can now live in a screen module. A check that reads only
// app-v8.js would silently stop seeing the code that moved.
import fs from "node:fs";
import path from "node:path";

export function screenFiles(repoRoot) {
  return fs.readdirSync(path.join(repoRoot, "src")).filter((f) => /^screen-.*\.js$/.test(f)).sort();
}
// app-v8.js followed by every screen module, each preceded by a marker line.
export function shellAndScreens(repoRoot) {
  const read = (f) => fs.readFileSync(path.join(repoRoot, "src", f), "utf8");
  return [read("app-v8.js"), ...screenFiles(repoRoot).map((f) => `\n// ==== ${f} ====\n` + read(f))].join("\n");
}
