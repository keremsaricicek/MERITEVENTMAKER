// A SCREEN MOVED OUT OF app-v8.js READS ONLY WHAT IT IS HANDED.
//
// Screens leave app-v8.js as modules created once with their dependencies
// (`src/screen-*.js`, `globalThis.MeritScreen*.create(deps)`). The danger of
// such a move is not a syntax error — it is a name the moved code still
// resolves from somewhere else: a shell global it now reaches past the
// boundary, or a helper of app-v8.js's IIFE it can no longer see at all,
// which is a ReferenceError the first time an operator presses that control
// (the detection extraction shipped exactly that, 2026-10-02).
//
// So, parsed rather than grepped, for every screen module:
//   - every identifier it uses is declared in it, handed to it, or a browser
//     built-in — nothing else;
//   - its published DEPS list, its `let` bindings, the assignments in
//     create(), and the keys app-v8.js passes are the SAME list;
//   - shell functions app-v8.js reassigns (render, toast, touchEvent) are
//     passed as wrappers, never as captured references, which would freeze
//     whichever body was current when the screen was created.
import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

export const meta = { name: "screen-modules", tags: ["business", "fast"], timeout: 30000 };

const BROWSER = new Set(("document window globalThis Math Number Set Map WeakMap Object Array String JSON Date Error TypeError Promise " +
  "CSS IntersectionObserver ResizeObserver MutationObserver requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval " +
  "clearInterval performance Intl Boolean RegExp Symbol Infinity NaN undefined console navigator location getComputedStyle Node Element " +
  "HTMLElement Event CustomEvent KeyboardEvent MouseEvent URL Blob FileReader isNaN isFinite parseInt parseFloat encodeURIComponent " +
  "decodeURIComponent queueMicrotask structuredClone matchMedia innerWidth innerHeight scrollTo addEventListener removeEventListener " +
  "DOMException arguments").split(" "));
const REASSIGNED_BY_SHELL = ["render", "toast", "touchEvent"];

function freeNames(code) {
  const ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "script" });
  const refs = new Set(), decls = new Set();
  walk.fullAncestor(ast, (node, _s, anc) => {
    const p = anc[anc.length - 2];
    if (node.type === "Identifier") {
      if (p && p.type === "MemberExpression" && p.property === node && !p.computed) return;
      if (p && p.type === "Property" && p.key === node && !p.computed && !p.shorthand) return;
      refs.add(node.name);
    }
    if ((node.type === "FunctionDeclaration" || node.type === "FunctionExpression") && node.id) decls.add(node.id.name);
    if (/Function/.test(node.type)) for (const prm of node.params) walk.full(prm, (x) => { if (x.type === "Identifier") decls.add(x.name); });
    if (node.type === "VariableDeclarator") walk.full(node.id, (x) => { if (x.type === "Identifier") decls.add(x.name); });
    if (node.type === "CatchClause" && node.param) walk.full(node.param, (x) => { if (x.type === "Identifier") decls.add(x.name); });
  });
  return [...refs].filter((n) => !decls.has(n) && !BROWSER.has(n)).sort();
}

export default async function run({ checks, repoRoot }) {
  const src = (f) => fs.readFileSync(path.join(repoRoot, "src", f), "utf8");
  const screens = fs.readdirSync(path.join(repoRoot, "src")).filter((f) => /^screen-.*\.js$/.test(f)).sort();
  checks.ok(screens.length >= 1, "the screen modules were found", screens);
  const v8 = src("app-v8.js");
  const v8ast = acorn.parse(v8, { ecmaVersion: "latest", sourceType: "script" });
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");

  for (const file of screens) {
    const code = src(file);
    const published = (code.match(/globalThis\.(MeritScreen\w+)\s*=/) || [])[1];
    checks.ok(!!published, `${file}: publishes one globalThis.MeritScreen* object`, published);
    // 1. it reads nothing it was not handed
    checks.equal(freeNames(code), [], `${file}: every name it uses is its own, handed to it, or a browser built-in — no shell global, no app-v8.js helper`);
    // 2. one list, four places
    const deps = JSON.parse((code.match(/DEPS:Object\.freeze\((\[[^\]]*\])\)/) || [, "[]"])[1]);
    const lets = [...code.matchAll(/^ {2}let (\w+);$/gm)].map((m) => m[1]);
    const assigned = [...code.matchAll(/^ {4}(\w+)=deps\.\1;$/gm)].map((m) => m[1]);
    let passed = null, wrapped = {};
    walk.full(v8ast, (n) => {
      if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && v8.slice(n.callee.object.start, n.callee.object.end) === `globalThis.${published}` && n.callee.property.name === "create") {
        const obj = n.arguments[0];
        passed = obj.properties.map((pr) => pr.key.name);
        for (const pr of obj.properties) wrapped[pr.key.name] = /Function/.test(pr.value.type);
      }
    });
    checks.ok(deps.length > 0 && JSON.stringify(lets) === JSON.stringify(deps) && JSON.stringify(assigned) === JSON.stringify(deps),
      `${file}: its DEPS list, its bindings and create()'s assignments are one list`, { deps, lets, assigned });
    checks.equal([...(passed || [])].sort(), [...deps].sort(), `${file}: app-v8.js hands it exactly that list`);
    checks.equal(REASSIGNED_BY_SHELL.filter((n) => deps.includes(n) && !wrapped[n]), [], `${file}: render/toast/touchEvent are handed over as wrappers, never as captured references`);
    // 3. it loads before the file that creates it
    const at = html.indexOf(`src="src/${file}"`), v8at = html.indexOf('src="src/app-v8.js"');
    checks.ok(at > 0 && at < v8at, `${file}: loads before app-v8.js`);
  }
}
