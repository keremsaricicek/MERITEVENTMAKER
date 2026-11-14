// MOVE ONE CAPABILITY OUT OF app-v8.js — mechanically, with every crossing named.
//
// `.claude/rules/code-health.md`: a structural move names its crossings first,
// injects what the module reads, publishes one object, and changes no
// behaviour. By hand that failed once (the third declarator on a four-name
// `const` line shipped a ReferenceError into every real detection), so this
// does it from a SCOPE-AWARE parse rather than by eye:
//
//   1. every identifier the region reads that it does not bind is resolved:
//      a browser built-in (left alone), a `globalThis` property published by a
//      module (rewritten to `globalThis.Name`, which is what the bare name
//      resolved to), or a binding of the shell — app-v8.js's IIFE, or app.js /
//      app-guests.js's global scope — which becomes an injected dependency;
//   2. a shell binding that is ever REASSIGNED (`let state`, `mutationEpoch`)
//      cannot be handed over by value: the region reads it through
//      `getName()` and writes it through `setName(v)`; every other function
//      goes over as a late-binding wrapper `(...a)=>name(...a)`, so a body the
//      shell reassigns later is still the one that runs;
//   3. every name the region binds that the rest of app-v8.js reads becomes a
//      member of the ONE published object (`X.name` at each use site — never a
//      local alias); an override of a shell global (`name = function(...)`)
//      becomes a function of the module and app-v8.js keeps the reassignment
//      as a one-line delegate, so the override layer is still app-v8.js's;
//   4. the region runs INSIDE create(deps), at its original indentation, and
//      create() is called where the region stood — so its top-level statements
//      run at the same moment of boot, in the same order, as before.
//
// Anything it cannot do safely (a compound write to a shell binding, an
// inward `let` that is reassigned, a shell `const` declared below the cut that
// would be read before it exists) is REFUSED with the reason, not guessed.
//
// Usage:
//   node scripts/extract-capability.mjs <startLine> <endLine> <file.js> <MeritName> <SHELLCONST> [--write] [--header=path]
// Without --write it prints the crossings and changes nothing.
import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; }));
const [startArg, endArg, outFile, globalName, shellConst] = args.filter((a) => !a.startsWith("--"));
if (!startArg || !endArg || !outFile || !globalName || !shellConst) {
  console.error("usage: extract-capability.mjs <startLine> <endLine> <file.js> <MeritName> <SHELLCONST> [--write] [--header=path]");
  process.exit(2);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
// Never overwrite a file or reuse a published name: move 18 first wrote over the
// existing src/review-decisions.js (MeritReviewDecisions, the review RULES), and
// only offline-bundle-contract's duplicate script tag caught it.
if (fs.existsSync(path.join(root, "src", outFile))) { console.error(`REFUSED: src/${outFile} already exists`); process.exit(3); }
if (fs.readdirSync(path.join(root, "src")).some((f) => /\.m?js$/.test(f) && new RegExp(`globalThis\\.${globalName}\\s*=`).test(fs.readFileSync(path.join(root, "src", f), "utf8")))) {
  console.error(`REFUSED: globalThis.${globalName} is already published`); process.exit(3);
}
const V8 = path.join(root, "src/app-v8.js");
const v8 = fs.readFileSync(V8, "utf8");
const lines = v8.split("\n");
const start = Number(startArg) - 1, end = Number(endArg);           // [start, end) zero-based lines
const lineOffset = (i) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
const regionStart = lineOffset(start), regionEnd = lineOffset(end);
const region = v8.slice(regionStart, regionEnd);

// The same set screen-modules accepts, plus what a capability module may use.
const BROWSER = new Set(("document window globalThis Math Number Set Map WeakMap Object Array String JSON Date Error TypeError Promise " +
  "CSS IntersectionObserver ResizeObserver MutationObserver requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval " +
  "clearInterval performance Intl Boolean RegExp Symbol Infinity NaN undefined console navigator location getComputedStyle Node Element " +
  "HTMLElement Event CustomEvent KeyboardEvent MouseEvent URL Blob FileReader isNaN isFinite parseInt parseFloat encodeURIComponent " +
  "decodeURIComponent queueMicrotask structuredClone matchMedia innerWidth innerHeight scrollTo addEventListener removeEventListener " +
  "DOMException arguments").split(" "));
const EXTRA_BUILTINS = new Set(("fetch localStorage sessionStorage indexedDB Image ImageData OffscreenCanvas createImageBitmap crypto TextEncoder TextDecoder " +
  "AbortController AbortSignal Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int32Array Int16Array Int8Array Float32Array Float64Array ArrayBuffer DataView " +
  "BigInt RangeError SyntaxError ReferenceError Reflect Proxy WeakSet atob btoa Worker File FormData Response Request Headers HTMLCanvasElement HTMLImageElement " +
  "HTMLInputElement HTMLDialogElement DOMParser XMLHttpRequest PointerEvent WheelEvent FocusEvent alert confirm prompt history screen devicePixelRatio " +
  "scrollX scrollY open print close getSelection requestIdleCallback cancelIdleCallback AggregateError Iterator").split(" "));

const parse = (code) => acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, ranges: true });

// ---- a small scope-aware free-variable resolver ----------------------------
function patternNames(p, out = []) {
  if (!p) return out;
  if (p.type === "Identifier") out.push(p.name);
  else if (p.type === "ObjectPattern") p.properties.forEach((q) => patternNames(q.type === "RestElement" ? q.argument : q.value, out));
  else if (p.type === "ArrayPattern") p.elements.forEach((e) => patternNames(e, out));
  else if (p.type === "RestElement") patternNames(p.argument, out);
  else if (p.type === "AssignmentPattern") patternNames(p.left, out);
  return out;
}
function varNames(node, out = []) {            // `var` declarations hoisted to the function
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((n) => varNames(n, out)); return out; }
  if (/Function/.test(node.type)) return out;
  if (node.type === "VariableDeclaration" && node.kind === "var") node.declarations.forEach((d) => patternNames(d.id, out));
  for (const k of Object.keys(node)) if (k !== "type" && node[k] && typeof node[k] === "object") varNames(node[k], out);
  return out;
}
function blockDecls(stmts) {
  const out = [];
  for (const s of stmts) {
    const d = s.type === "ExportNamedDeclaration" ? s.declaration : s;
    if (!d) continue;
    if (d.type === "VariableDeclaration" && d.kind !== "var") d.declarations.forEach((x) => patternNames(x.id, out));
    if ((d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && d.id) out.push(d.id.name);
  }
  return out;
}
function freeRefs(ast) {
  const refs = [];          // { name, node, parent, write, call, shorthand, compound }
  const lookup = (scope, n) => { for (let s = scope; s; s = s.up) if (s.names.has(n)) return true; return false; };
  const fnDepth = (scope) => { let d = 0; for (let s = scope; s; s = s.up) if (s.isFn) d++; return d; };
  const ref = (node, scope, parent, extra = {}) => { if (!lookup(scope, node.name)) refs.push({ name: node.name, node, parent, depth: fnDepth(scope), ...extra }); };
  const mk = (up, names) => ({ up, names: new Set(names) });
  function writeTarget(p, scope, compound) {
    if (!p) return;
    if (p.type === "Identifier") return ref(p, scope, null, { write: true, compound });
    if (p.type === "MemberExpression") return visit(p, scope, null);
    if (p.type === "ObjectPattern") return p.properties.forEach((q) => { if (q.type === "RestElement") writeTarget(q.argument, scope); else { if (q.computed) visit(q.key, scope, q); writeTarget(q.value, scope); } });
    if (p.type === "ArrayPattern") return p.elements.forEach((e) => writeTarget(e, scope));
    if (p.type === "RestElement") return writeTarget(p.argument, scope);
    if (p.type === "AssignmentPattern") { writeTarget(p.left, scope); return visit(p.right, scope, p); }
  }
  function declPattern(p, scope) {           // visit only the expressions inside a binding pattern
    if (!p) return;
    if (p.type === "ObjectPattern") p.properties.forEach((q) => { if (q.type === "RestElement") declPattern(q.argument, scope); else { if (q.computed) visit(q.key, scope, q); declPattern(q.value, scope); } });
    else if (p.type === "ArrayPattern") p.elements.forEach((e) => declPattern(e, scope));
    else if (p.type === "RestElement") declPattern(p.argument, scope);
    else if (p.type === "AssignmentPattern") { declPattern(p.left, scope); visit(p.right, scope, p); }
  }
  function fn(node, scope) {
    const own = mk(scope, node.type === "FunctionExpression" && node.id ? [node.id.name] : []);
    own.isFn = true;
    const s = mk(own, [...node.params.flatMap((p) => patternNames(p)), ...(node.body.type === "BlockStatement" ? [...varNames(node.body.body), ...blockDecls(node.body.body)] : [])]);
    node.params.forEach((p) => declPattern(p, s));
    if (node.body.type === "BlockStatement") node.body.body.forEach((b) => visit(b, s, node.body)); else visit(node.body, s, node);
  }
  function visit(node, scope, parent) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, scope, parent));
    switch (node.type) {
      case "Identifier": return ref(node, scope, parent, { call: parent && parent.type === "CallExpression" && parent.callee === node });
      case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression": return fn(node, scope);
      case "Program": { const s = mk(scope, [...varNames(node.body), ...blockDecls(node.body)]); return node.body.forEach((b) => visit(b, s, node)); }
      case "BlockStatement": case "StaticBlock": { const s = mk(scope, blockDecls(node.body)); return node.body.forEach((b) => visit(b, s, node)); }
      case "SwitchStatement": { visit(node.discriminant, scope, node); const s = mk(scope, blockDecls(node.cases.flatMap((c) => c.consequent))); return node.cases.forEach((c) => { visit(c.test, s, c); c.consequent.forEach((b) => visit(b, s, c)); }); }
      case "ForStatement": case "ForInStatement": case "ForOfStatement": {
        const head = node.init || node.left;
        const s = mk(scope, head && head.type === "VariableDeclaration" && head.kind !== "var" ? head.declarations.flatMap((d) => patternNames(d.id)) : []);
        if (node.type === "ForStatement") { visit(node.init, s, node); visit(node.test, s, node); visit(node.update, s, node); }
        else { if (node.left.type === "VariableDeclaration") visit(node.left, s, node); else writeTarget(node.left, s); visit(node.right, s, node); }
        return visit(node.body, s, node);
      }
      case "CatchClause": { const s = mk(scope, patternNames(node.param)); return visit(node.body, s, node); }
      case "VariableDeclaration": return node.declarations.forEach((d) => { declPattern(d.id, scope); visit(d.init, scope, d); });
      case "ClassDeclaration": case "ClassExpression": { const s = mk(scope, node.id ? [node.id.name] : []); visit(node.superClass, s, node); return visit(node.body, s, node); }
      case "MethodDefinition": case "PropertyDefinition": if (node.computed) visit(node.key, scope, node); return visit(node.value, scope, node);
      case "MemberExpression": visit(node.object, scope, node); if (node.computed) visit(node.property, scope, node); return;
      case "Property":
        if (node.computed) visit(node.key, scope, node);
        if (node.shorthand && node.value.type === "Identifier") return ref(node.value, scope, node, { shorthand: true });
        return visit(node.value, scope, node);
      case "AssignmentExpression": writeTarget(node.left, scope, node.operator !== "="); return visit(node.right, scope, node);
      case "UpdateExpression": if (node.argument.type === "Identifier") return ref(node.argument, scope, node, { write: true, compound: true }); return visit(node.argument, scope, node);
      case "LabeledStatement": return visit(node.body, scope, node);
      case "BreakStatement": case "ContinueStatement": case "MetaProperty": return;
      default:
        for (const k of Object.keys(node)) if (!["type", "start", "end", "range", "loc"].includes(k) && node[k] && typeof node[k] === "object") visit(node[k], scope, node);
    }
  }
  visit(ast, null, null);
  return refs;
}

// ---- what the shell binds ---------------------------------------------------
const v8Ast = parse(v8);
const iife = v8Ast.body[0].expression.callee;            // (() => { ... })()
const v8Top = iife.body.body;
const shellBindings = new Map();                         // name -> { kind, where, start }
for (const s of v8Top) {
  const add = (n, kind) => { if (!shellBindings.has(n)) shellBindings.set(n, { kind, where: "app-v8", start: s.start }); };
  if (s.type === "FunctionDeclaration") add(s.id.name, "function");
  if (s.type === "VariableDeclaration") s.declarations.forEach((d) => patternNames(d.id).forEach((n) => add(n, d.init && /Function/.test(d.init.type) ? "function" : s.kind)));
}
const globalBindings = new Map();
for (const f of ["app.js", "app-guests.js"]) {
  const ast = parse(fs.readFileSync(path.join(root, "src", f), "utf8"));
  for (const s of ast.body) {
    const add = (n, kind) => { if (!globalBindings.has(n)) globalBindings.set(n, { kind, where: f }); };
    if (s.type === "FunctionDeclaration") add(s.id.name, "function");
    if (s.type === "VariableDeclaration") s.declarations.forEach((d) => patternNames(d.id).forEach((n) => add(n, d.init && /Function/.test(d.init.type) ? "function" : s.kind)));
  }
}
// Every shell binding that is ever REASSIGNED: writes that resolve to a file's
// top level (app-v8.js's IIFE body, or app.js / app-guests.js's global scope).
// Visiting the top-level statements with no enclosing scope makes exactly
// those writes free, and a same-named local inside some function is not one.
const topLevelRefs = (stmts) => stmts.flatMap((s) => freeRefs(s));
const reassigned = new Set();
for (const r of topLevelRefs(v8Top)) if (r.write) reassigned.add(r.name);
for (const f of ["app.js", "app-guests.js"]) for (const r of topLevelRefs(parse(fs.readFileSync(path.join(root, "src", f), "utf8")).body)) if (r.write) reassigned.add(r.name);
const published = (n) => /^(XLSX|pdfjsLib|Tesseract|ort)$/.test(n) || fs.readdirSync(path.join(root, "src")).filter((f) => /\.m?js$/.test(f))
  .some((f) => new RegExp(`(globalThis|window)\\.${n}\\s*=(?!=)`).test(fs.readFileSync(path.join(root, "src", f), "utf8")));

// ---- the region --------------------------------------------------------------
const WRAP = "(function(){\n";
const regionAst = parse(`${WRAP}${region}\n})`);
const regionTop = regionAst.body[0].expression.body.body;
const regionBound = new Set();
for (const s of regionTop) {
  if (s.type === "FunctionDeclaration") regionBound.add(s.id.name);
  if (s.type === "VariableDeclaration") s.declarations.forEach((d) => patternNames(d.id).forEach((n) => regionBound.add(n)));
}
// Overrides: a top-level `name = function(...){...};` whose name the region does not bind.
const overrides = [];
for (const s of regionTop) {
  if (s.type === "ExpressionStatement" && s.expression.type === "AssignmentExpression" && s.expression.operator === "="
    && s.expression.left.type === "Identifier" && !regionBound.has(s.expression.left.name)) {
    const r = s.expression.right;
    if (r.type !== "FunctionExpression") { console.error(`REFUSED: top-level assignment to ${s.expression.left.name} is not a function expression`); process.exit(3); }
    overrides.push({ name: s.expression.left.name, stmt: s, fnExpr: r });
  }
}
const overrideNames = new Set(overrides.map((o) => o.name));
const refs = freeRefs(regionAst).filter((r) => !(overrideNames.has(r.name) && r.write && overrides.some((o) => o.stmt.expression.left === r.node)));

const problems = [];
const preOverride = new Set();
const deps = new Map();       // name -> "fn" | "value" | "getset"
const toGlobal = new Set();
for (const r of refs) {
  const n = r.name;
  if (overrideNames.has(n)) {
    // Inside a function it runs after the reassignment, so it meant v8's body —
    // the module's own function now. At the region's TOP LEVEL it ran at boot,
    // before (or as) the override, and read the PRE-v8 global: e.g.
    // `const oldViewport=canvasViewportHTML;` captures app.js's body. Read
    // there through globalThis, which is that global (a top-level function of
    // app.js); turning it into the module's hoisted local recursed forever
    // (move 7a's first run: "Maximum call stack size exceeded").
    if (r.depth <= 1 && !r.write) { const g = globalBindings.get(n); if (!g || g.kind !== "function") problems.push(`top-level read of override ${n}, which is not an app.js function`); else preOverride.add(r); }
    continue;
  }
  if (BROWSER.has(n) || EXTRA_BUILTINS.has(n)) { if (r.write) problems.push(`writes the built-in ${n}`); continue; }
  const sb = shellBindings.get(n), gb = globalBindings.get(n);
  const b = sb || gb;
  if (!b) {
    // A module's published object is read where it is used, as the screens do
    // (`globalThis.MeritWalkIn`); a published FUNCTION only ever called (`t`)
    // is handed over like every other shell function.
    if (published(n) && !/^(Merit|MERIT_)/.test(n) && refs.filter((x) => x.name === n).every((x) => x.call)) { deps.set(n, "fn"); continue; }
    // A write to a published global (`MERIT_SCHEMA_GUARD={…}`) becomes the same write to
    // `globalThis.NAME` — in strict code that is what a bare assignment to an existing global did.
    if (published(n)) { toGlobal.add(n); continue; }
    problems.push(`unresolved name ${n} (not a built-in, not bound by the shell)`); continue;
  }
  const isFn = b.kind === "function";
  const re = reassigned.has(n);
  if (r.write && r.compound) problems.push(`compound write to shell binding ${n} (${r.node.start})`);
  if (isFn && !re) { if (r.write) problems.push(`writes the shell function ${n}`); deps.set(n, "fn"); continue; }
  if (isFn && re) { deps.set(n, deps.get(n) === "getset" ? "getset" : (r.write ? "getset" : "fn")); continue; }
  if (re) { deps.set(n, "getset"); continue; }
  if (b.kind === "const" || b.kind === "let") {
    // Declared BELOW the cut: it does not exist yet when create() runs, so it
    // is read through getName() at the moment of use, like a reassigned
    // binding (a read at create time would still be a TDZ error at boot, which
    // every browser suite catches).
    if (sb && sb.start > regionStart) { if (r.write) problems.push(`writes shell ${b.kind} ${n} declared below the cut`); deps.set(n, "getset"); continue; }
    if (!deps.has(n)) deps.set(n, "value");
  }
}
// What the rest of app-v8.js reads from the region.
const outsideCode = WRAP + v8.slice(0, regionStart).replace(/^\(\(\) => \{\n/, "") + "\n" + v8.slice(regionEnd).replace(/\}\)\(\);\s*$/, "");
const outsideAst = parse(`${outsideCode}\n})`);
const outsideRefs = freeRefs(outsideAst).filter((r) => regionBound.has(r.name) || overrideNames.has(r.name));
const inward = new Set();
for (const r of outsideRefs) {
  if (overrideNames.has(r.name)) continue;                  // the global stays the global
  if (r.write) problems.push(`app-v8.js writes ${r.name}, which the region binds`);
  inward.add(r.name);
}
for (const n of inward) {
  const d = regionTop.find((s) => s.type === "VariableDeclaration" && s.declarations.some((x) => patternNames(x.id).includes(n)));
  if (d && d.kind === "let") problems.push(`inward let ${n}: the shell would read a stale copy`);
}
const getsetNames = [...deps].filter(([, k]) => k === "getset").map(([n]) => n);

const cap = (n) => n[0].toUpperCase() + n.slice(1);
console.log(`REGION   lines ${start + 1}-${end} (${end - start} lines) -> src/${outFile} as globalThis.${globalName}, shell const ${shellConst}`);
console.log(`DEPS     (${deps.size}) ${[...deps].map(([n, k]) => k === "fn" ? n : `${n}[${k}]`).sort().join(" ")}`);
console.log(`GLOBALS  (${toGlobal.size}) ${[...toGlobal].sort().join(" ")}`);
console.log(`INWARD   (${inward.size}) ${[...inward].sort().join(" ")}`);
console.log(`OVERRIDE (${overrides.length}) ${overrides.map((o) => o.name).join(" ")}`);
console.log(`PRIVATE  (${[...regionBound].filter((n) => !inward.has(n)).length}) ${[...regionBound].filter((n) => !inward.has(n)).sort().join(" ")}`);
if (problems.length) { console.log(`REFUSED  (${problems.length})\n  ${[...new Set(problems)].join("\n  ")}`); process.exit(3); }
if (!flags.write) process.exit(0);

// ---- the module ----------------------------------------------------------------
// Edits to the region text, by position (offsets are into `${WRAP}${region}`).
const edits = [];
const at = (node) => node.start - WRAP.length;
for (const r of refs) {
  const n = r.name;
  let rep = null;
  if (toGlobal.has(n) || preOverride.has(r)) rep = `globalThis.${n}`;
  else if (deps.get(n) === "getset") {
    if (r.write) { edits.push({ kind: "write", name: n, node: r.node }); continue; }
    rep = `get${cap(n)}()`;
  }
  if (rep == null) continue;
  edits.push(r.shorthand ? { from: at(r.node), to: at(r.node) + n.length, text: `${n}:${rep}` } : { from: at(r.node), to: at(r.node) + n.length, text: rep });
}
// `name = v` writes to a get/set binding become `setName(v)`.
(function scan(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(scan);
  if (node.type === "AssignmentExpression" && node.operator === "=" && node.left.type === "Identifier") {
    const e = edits.find((x) => x.kind === "write" && x.node === node.left);
    if (e) { edits.push({ from: at(node), to: at(node.right), text: `set${cap(e.name)}(` }, { from: at(node) + (node.end - node.start), to: at(node) + (node.end - node.start), text: ")" }); e.done = true; }
  }
  for (const k of Object.keys(node)) if (k !== "type" && node[k] && typeof node[k] === "object") scan(node[k]);
})(regionAst);
if (edits.some((e) => e.kind === "write" && !e.done)) { console.error("REFUSED: a write to a get/set binding is not a plain `name = value` assignment"); process.exit(3); }
// Overrides become the module's own function declarations.
for (const o of overrides) {
  const s = at(o.stmt), fe = o.fnExpr;
  edits.push({ from: s, to: at(fe) + (fe.async ? "async function".length : "function".length), text: `${fe.async ? "async " : ""}function ${o.name}` });
  if (region[at(o.stmt) + (o.stmt.end - o.stmt.start) - 1] === ";") edits.push({ from: at(o.stmt) + (o.stmt.end - o.stmt.start) - 1, to: at(o.stmt) + (o.stmt.end - o.stmt.start), text: "" });
}
let moduleRegion = region;
for (const e of edits.filter((x) => x.kind !== "write").sort((a, b) => b.from - a.from || b.to - a.to)) moduleRegion = moduleRegion.slice(0, e.from) + e.text + moduleRegion.slice(e.to);

const depNames = [...new Set([...deps].flatMap(([n, k]) => k === "getset" ? [`get${cap(n)}`, ...(edits.some((e) => e.kind === "write" && e.name === n) ? [`set${cap(n)}`] : [])] : [n]))].sort();
const publishedNames = [...new Set([...inward, ...overrides.map((o) => o.name)])].sort();
const header = flags.header ? fs.readFileSync(flags.header, "utf8").replace(/\s*$/, "\n") : `// ${globalName}: moved out of app-v8.js.\n`;
const moduleSrc = `${header}(() => {
  "use strict";
${depNames.map((n) => `  let ${n};`).join("\n")}
  let created=false;

  function create(deps){
    if(created)throw new Error("${globalName}.create() is called once, by app-v8.js.");
    created=true;
${depNames.map((n) => `    ${n}=deps.${n};`).join("\n")}
${moduleRegion.replace(/\s*$/, "")}
    return{${publishedNames.join(",")}};
  }
  globalThis.${globalName}=Object.freeze({create,DEPS:Object.freeze([${depNames.map((n) => JSON.stringify(n)).join(",")}])});
})();
`;

// ---- the shell -----------------------------------------------------------------
const depArg = depNames.map((n) => {
  const g = n.match(/^get([A-Z].*)$/), s = n.match(/^set([A-Z].*)$/);
  // getState -> state, but getSEATCMD -> SEATCMD: the name as the shell binds it.
  const base = (x) => deps.has(x) ? x : x[0].toLowerCase() + x.slice(1);
  if (g && deps.get(base(g[1])) === "getset") return `${n}:()=>${base(g[1])}`;
  if (s && deps.get(base(s[1])) === "getset") return `${n}:v=>{${base(s[1])}=v;}`;
  return deps.get(n) === "fn" ? `${n}:(...a)=>${n}(...a)` : n;
}).join(",");
// One dependency per entry, wrapped at ~150 columns so the call does not become
// the file's longest line.
const depLines = depArg.split(",").reduce((acc, d) => { const last = acc[acc.length - 1]; if (last && last.length + d.length < 150) acc[acc.length - 1] = `${last}${d},`; else acc.push(`${d},`); return acc; }, []);
const shellBlock = `  const ${shellConst}=globalThis.${globalName}.create({
${depLines.map((l) => `    ${l}`).join("\n")}
  });
${overrides.map((o) => `  ${o.name} = ${o.fnExpr.async ? "async " : ""}function(...a){return ${shellConst}.${o.name}(...a);};`).join("\n")}
`;
// Rewrite the rest of the file: every read of an inward name goes through the one object.
const outEdits = [];
for (const r of outsideRefs) {
  if (!inward.has(r.name)) continue;
  // positions in outsideCode -> positions in v8
  const pos = r.node.start - WRAP.length;
  const before = regionStart - "(() => {\n".length;
  const v8pos = pos < before ? pos + "(() => {\n".length : pos - before - 1 + regionEnd;
  if (v8.slice(v8pos, v8pos + r.name.length) !== r.name) { console.error(`REFUSED: position map failed for ${r.name} at ${v8pos}`); process.exit(4); }
  // A shorthand `{name}` is a value handed over — usually to another module's
  // create() above the cut, which runs BEFORE this module exists. A function
  // goes over as a late-binding wrapper (as every shell function does);
  // reading `${shellConst}.name` there would be a TDZ ReferenceError at boot
  // (move 6 shipped exactly that to its first test run).
  const isFnDecl = regionTop.some((s) => s.type === "FunctionDeclaration" && s.id.name === r.name);
  outEdits.push({ from: v8pos, to: v8pos + r.name.length, text: r.shorthand
    ? (isFnDecl ? `${r.name}:(...a)=>${shellConst}.${r.name}(...a)` : `${r.name}:${shellConst}.${r.name}`)
    : `${shellConst}.${r.name}` });
}
let newV8 = v8.slice(0, regionStart) + shellBlock + v8.slice(regionEnd);
const shift = shellBlock.length - (regionEnd - regionStart);
for (const e of outEdits.sort((a, b) => b.from - a.from)) {
  const f = e.from >= regionEnd ? e.from + shift : e.from;
  newV8 = newV8.slice(0, f) + e.text + newV8.slice(f + (e.to - e.from));
}
fs.writeFileSync(path.join(root, "src", outFile), moduleSrc);
fs.writeFileSync(V8, newV8);
parse(moduleSrc); parse(newV8);
console.log(`WROTE    src/${outFile} (${moduleSrc.split("\n").length} lines); app-v8.js ${lines.length} -> ${newV8.split("\n").length} lines; ${outEdits.length} use sites now read ${shellConst}.*`);
