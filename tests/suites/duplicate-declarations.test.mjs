// NO FUNCTION IS DECLARED TWICE IN ONE SCOPE.
//
// Two `function NAME()` declarations in the same block are legal JavaScript:
// both are hoisted and the LATER one silently wins, everywhere in the block,
// including calls that sit above it. On 2026-10-03 a new `saveVerified()` in
// app-v8.js's IIFE was replaced by an older function of the same name further
// down, and every save failed with ".then of undefined" — no syntax error, no
// warning, the new code simply never ran. Nothing caught it but a suite that
// happened to save. This reads every source file, comments and strings
// stripped (tests/lib/js-scan.mjs, which keeps code inside template
// interpolations), and fails on any name declared twice in one block.
import fs from "node:fs";
import path from "node:path";
import { stripCommentsAndStrings } from "../lib/js-scan.mjs";

export const meta = { name: "duplicate-declarations", tags: ["business", "fast"], timeout: 30000 };

// A `function` keyword that STARTS a statement is a declaration; one that
// follows `=`, `(`, `,`, `:`, `?`, `!`, `&`, `|` or `return` is an
// expression and binds nothing in the enclosing block.
export function duplicateDeclarations(code) {
  const stack = [{ id: 0, names: new Map() }];
  let nextId = 1;
  const out = [];
  const lineAt = (i) => code.slice(0, i).split("\n").length;
  const re = /\{|\}|\b(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    if (m[0] === "{") { stack.push({ id: nextId++, names: new Map() }); continue; }
    if (m[0] === "}") { if (stack.length > 1) stack.pop(); continue; }
    let j = m.index - 1;
    while (j >= 0 && /\s/.test(code[j])) j--;
    const prev = j >= 0 ? code[j] : "";
    const word = code.slice(Math.max(0, j - 5), j + 1);
    const expression = /[=(,:?!&|]/.test(prev) || /\breturn$/.test(word) || prev === "." ;
    if (expression) continue;
    const name = m[2], block = stack[stack.length - 1];
    const lines = block.names.get(name) || [];
    lines.push(lineAt(m.index));
    block.names.set(name, lines);
    if (lines.length === 2) out.push({ name, lines });
  }
  return out;
}

export default async function run({ checks, repoRoot }) {
  const dir = path.join(repoRoot, "src");
  const found = [];
  let scanned = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js")).sort()) {
    const code = stripCommentsAndStrings(fs.readFileSync(path.join(dir, f), "utf8"));
    scanned++;
    for (const d of duplicateDeclarations(code)) found.push(`${f}: ${d.name} declared at lines ${d.lines.join(" and ")}`);
  }
  checks.ok(scanned > 40, "every source file was read", scanned);
  // The detector itself must see what it is looking for.
  const probe = duplicateDeclarations(stripCommentsAndStrings(
    "(function(){ function a(){ return 1 } const x = function b(){}; function a(){ return 2 } function c(){ function a(){} } })();"));
  checks.equal(probe.map((d) => d.name), ["a"], "the check finds a twice-declared function and ignores an expression and an inner scope");
  checks.equal(found, [], "no function is declared twice in one scope (the later one would silently replace the earlier)");
}
