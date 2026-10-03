// Which pre-v8 function bodies can actually run — computed, not assumed.
//
// app-v8.js reassigns names that app.js and app-guests.js defined. A pre-v8
// BODY is unreachable when app-v8.js overrides its name and never calls it
// back — through `original.NAME` or through a local alias
// (`const oldBindCanvas=bindCanvas; … oldBindCanvas()`) — or when every
// reference to it sits inside unreachable code (to a fixpoint). The NAME stays
// live; the body is what cannot run. `benchmarks/CODE-INVENTORY.md` §1.2 is
// the reason for that distinction: deleting a "dead" name would break the app.
//
// Shared by `i18n-hardcoded-english` (it skips dead bodies when looking for
// English) and `benchmarks/coverage/analyse.mjs` (§28: it cross-checks this
// static answer against what the suites actually executed).
import fs from "node:fs";
import path from "node:path";
import { stripCommentsAndStrings } from "./js-scan.mjs";

export function preV8Reachability(repoRoot) {
  const dir = path.join(repoRoot, "src");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  const SRC = {}, CODE = {};
  for (const f of files) { SRC[f] = fs.readFileSync(path.join(dir, f), "utf8"); CODE[f] = stripCommentsAndStrings(SRC[f]); }
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const v8 = CODE["app-v8.js"];
  const overridden = new Set([...v8.matchAll(/(?:^|[;{}\s])([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/g)].map((m) => m[1]));
  const calledBack = new Set([...v8.matchAll(/\boriginal\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  // …and through a local ALIAS: `const oldBindCanvas=bindCanvas; … oldBindCanvas()`.
  // A first version modelled only original.NAME, so it marked the pre-v8
  // bindCanvas -- and bindInspector, which only it calls -- as dead, while the
  // Floor Plan card's Type/Rotation/Zone fields run through them every day.
  for (const m of v8.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g))
    if (new RegExp(`(?<![\\w$.])${m[1].replace(/\$/g, "\\$")}\\s*\\(`).test(v8)) calledBack.add(m[2]);
  const capStart = v8.search(/const\s+original\s*=\s*\{/), capEnd = capStart < 0 ? -1 : v8.indexOf("}", capStart);
  const defs = [];
  for (const f of ["app.js", "app-guests.js"]) {
    for (const m of CODE[f].matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      let d = 0;
      for (let q = CODE[f].indexOf("{", m.index); q < CODE[f].length; q++) {
        if (CODE[f][q] === "{") d++; else if (CODE[f][q] === "}" && --d === 0) { defs.push({ f, name: m[1], a: m.index, b: q }); break; }
      }
    }
  }
  // Load time is the model's blind spot, and §28 measured it: app-guests.js
  // used to END by calling render(), so the pre-v8 render and eventsHTML ran
  // once at every boot — drawing the retired English shell for ~50-90 ms —
  // while this model called them dead. V8 coverage
  // (benchmarks/coverage/analyse.mjs) is the cross-check that caught it; the
  // load-time render was then REMOVED from the product, which is what makes
  // "overridden and never called back" true again. critical-paths fails if
  // the retired shell ever renders at boot.
  const dead = new Set([...overridden].filter((n) => defs.some((d) => d.name === n) && !calledBack.has(n)));
  const inDead = (f, pos) => defs.some((d) => d.f === f && dead.has(d.name) && pos > d.a && pos < d.b);
  for (let changed = true; changed;) {
    changed = false;
    for (const d of defs) {
      if (dead.has(d.name) || calledBack.has(d.name) || new RegExp(`\\b${d.name}\\b`).test(html)) continue;
      let live = false;
      for (const f of files) {
        for (const m of CODE[f].matchAll(new RegExp(`(?<![\\w$.])${d.name}\\b`, "g"))) {
          if (f === d.f && m.index >= d.a && m.index <= d.b) continue;
          if (f === "app-v8.js" && m.index > capStart && m.index < capEnd) continue;
          if (!inDead(f, m.index)) { live = true; break; }
        }
        if (live) break;
      }
      if (!live) { dead.add(d.name); changed = true; }
    }
  }
  return { SRC, CODE, files, html, defs, dead, calledBack, overridden, capStart, capEnd };
}
