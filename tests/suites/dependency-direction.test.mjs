// The one-way dependency rule, enforced instead of assumed.
//
// 28 of the 33 files in src/ export `globalThis.Merit*` and are pure: they
// take plain data, return plain data, and know nothing about the app shell.
// app-v8.js reads THEM. Nothing goes the other way. That is what makes them
// testable in isolation, and it is the property that has to survive
// modularization — the moment a module reaches back into `state` or calls
// `render()`, extracting anything from app-v8.js stops being safe.
//
// This held with zero exceptions when audited by hand, but a hand audit is
// not a guard. Section 19's write-up said so explicitly and left it open.
// This suite closes it.
//
// WHY NOT GREP: the codebase legitimately mentions these identifiers in
// prose. `seating-freeze.js` has "that is its resting state"; its line 143
// says "that is an operation's state"; `table-availability.js` says
// "neither reads the other's state". A grep rule fires on all three, gets
// called noisy, and gets switched off. So the source is stripped of
// comments and string literals first (tests/lib/js-scan.mjs) and the rule
// runs against what is actually code.
import fs from "node:fs";
import path from "node:path";
import { stripCommentsAndStrings, matchLines } from "../lib/js-scan.mjs";

export const meta = { name: "dependency-direction", tags: ["business", "fast"], timeout: 20000 };

// The app-shell globals a pure module must never touch. Each is a real
// coupling: reading `state`/`ui` means the module depends on the shell's
// shape; calling `render`/`touchEvent` means it has opinions about the UI
// lifecycle and about persistence.
const FORBIDDEN = [
  { id: "state", what: "reads the shell's `state` global", re: /(^|[^\w.$'"`])state\s*[.[]/ },
  { id: "ui", what: "reads the shell's `ui` global", re: /(^|[^\w.$'"`])ui\s*[.[]/ },
  { id: "render", what: "calls render()", re: /(^|[^\w.$])render\s*\(/ },
  { id: "touchEvent", what: "calls touchEvent()", re: /(^|[^\w.$])touchEvent\s*\(/ },
  { id: "saveState", what: "calls saveState()", re: /(^|[^\w.$])saveState\s*\(/ },
  { id: "activeEvent", what: "calls activeEvent()", re: /(^|[^\w.$])activeEvent\s*\(/ },
];

// The shell itself. These are ALLOWED to use those globals — they own them.
const SHELL = new Set(["app.js", "app-guests.js", "app-v8.js"]);

export default async function run({ checks, repoRoot }) {
  const srcDir = path.join(repoRoot, "src");
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".js"));
  checks.require(files.length > 25, "the src/ tree was found and is the real one", files.length);

  // A module is in scope if it exports globalThis.Merit* — that is the
  // marker of the pure layer, and it is derived from the source rather than
  // from a hand-kept list, so a NEW module is covered the day it is added.
  const modules = files.filter((f) => {
    if (SHELL.has(f)) return false;
    return /globalThis\.Merit/.test(fs.readFileSync(path.join(srcDir, f), "utf8"));
  });
  checks.require(modules.length >= 25,
    "the pure Merit* module layer was discovered from source, not from a hardcoded list", modules.length);

  // --- 1. the rule ---------------------------------------------------------
  //
  // INJECTION IS NOT COUPLING. `venue-model.js` is full of `state.venues`,
  // and that is correct: every one of its functions takes `state` as a
  // PARAMETER (`findVenue(state, venueId)`). Receiving the root as an
  // argument is the pure pattern — the module still knows nothing about the
  // shell and stays testable in isolation. Reaching for the ambient global
  // is the thing that couples.
  //
  // This scanner does no scope analysis, so it cannot tell the two apart per
  // use site. It resolves that the only honest way: if the module BINDS the
  // name anywhere (parameter, const/let/var, function name), its uses are
  // treated as the local, and the name is reported as injected rather than
  // silently ignored. A module that reaches for the global will not have
  // bound it, and that is exactly what gets caught.
  const injected = [];
  const violations = [];
  for (const file of modules) {
    const code = stripCommentsAndStrings(fs.readFileSync(path.join(srcDir, file), "utf8"));
    for (const rule of FORBIDDEN) {
      const bound = new RegExp(
        `(function\\s+\\w*\\s*\\([^)]*\\b${rule.id}\\b|` +        // parameter
        `\\(\\s*[^)]*\\b${rule.id}\\b[^)]*\\)\\s*=>|` +            // arrow param
        `\\b(?:const|let|var|function)\\s+${rule.id}\\b)`          // local binding
      ).test(code);
      const hits = matchLines(code, rule.re);
      if (!hits.length) continue;
      if (bound) {
        injected.push(`${file} — \`${rule.id}\` is a local/parameter here (${hits.length} use${hits.length === 1 ? "" : "s"}), not the shell global`);
        continue;
      }
      for (const hit of hits) {
        violations.push(`${file}:${hit.line} — ${rule.what} :: ${hit.text}`);
      }
    }
  }
  checks.equal(violations.length, 0,
    "no globalThis.Merit* module reaches back into the app shell — the dependency graph stays one-way, which is what makes extracting from app-v8.js safe",
    violations);

  // The injected set is asserted, not merely tolerated: if a module stops
  // taking `state` as a parameter and starts grabbing the global, it leaves
  // this list and lands in `violations` above. Printing it keeps the
  // allowance visible instead of hidden inside the rule.
  checks.ok(injected.some((s) => s.startsWith("venue-model.js")),
    "venue-model.js is recognised as taking `state` by injection (a parameter), which is the pure pattern and NOT a dependency violation",
    injected);

  // --- 2. the scanner is not lying by being blind --------------------------
  // A stripper that returned "" would make check 1 pass forever. These two
  // prove it still sees real code and still hides prose.
  const probe = stripCommentsAndStrings(
    'const a = 1;\n// this comment mentions state.foo and render(\nconst s = "state.bar render( touchEvent(";\nif (a) { realCall(); }\n'
  );
  checks.ok(/realCall\s*\(/.test(probe),
    "the scanner preserves real code (a call outside comments/strings survives)", probe.trim().slice(0, 80));
  checks.ok(!/state\s*\./.test(probe) && !/render\s*\(/.test(probe),
    "the scanner removes comment and string mentions, so prose cannot trip the rule", probe.trim().slice(0, 80));

  // NESTED TEMPLATES. This is the property the rule above actually depends
  // on, and the one a naive scanner gets wrong. Every render function in
  // this codebase is templates inside templates; an early version of
  // js-scan.mjs treated the inner backtick as opening a plain string and
  // blanked the interpolated CODE along with it. A module reaching for
  // `state` from inside a nested template would then have been invisible —
  // the rule would have passed while the violation shipped. Measured
  // against app-v8.js, that same blindness made 14 live functions look
  // like they had no caller at all.
  const nested = stripCommentsAndStrings(
    "const h = `<ul>${rows.map(r => `<li>${esc(state.label)}</li>`).join('')}</ul>`;"
  );
  checks.ok(/esc\s*\(/.test(nested) && /state\s*\./.test(nested),
    "the scanner sees code inside a NESTED template interpolation — if it did not, a violation written there would pass this suite silently",
    nested.replace(/\s+/g, " ").trim());
  const deep = stripCommentsAndStrings("const h = `a${b(`c${d(`e${render()}`)}`)}`;");
  checks.ok(/render\s*\(/.test(deep),
    "nesting is handled to arbitrary depth, not just one level", deep.replace(/\s+/g, " ").trim());
  const templateText = stripCommentsAndStrings("const h = `state.foo render( touchEvent(`;");
  checks.ok(!/state\s*\./.test(templateText) && !/render\s*\(/.test(templateText),
    "and a template's literal TEXT is still stripped — the fix widened what counts as code without widening what counts as prose",
    JSON.stringify(templateText.trim()));

  // --- 3. the known comment-only mentions stay invisible --------------------
  // These three exist today. If the scanner ever regresses to grep-like
  // behaviour they come back as false positives, and this check says so
  // before somebody disables the suite as noisy.
  for (const file of ["seating-freeze.js", "table-availability.js"]) {
    const raw = fs.readFileSync(path.join(srcDir, file), "utf8");
    const rawHits = matchLines(raw, /(^|[^\w.$])(state|ui)\s*[.[]/).length;
    const codeHits = matchLines(stripCommentsAndStrings(raw), /(^|[^\w.$])(state|ui)\s*[.[]/).length;
    checks.ok(rawHits > 0 && codeHits === 0,
      `${file} mentions shell globals only in prose — raw text hits ${rawHits}, real code hits ${codeHits}`,
      { rawHits, codeHits });
  }

  // --- 4. the shell is excluded on purpose, not by accident ----------------
  const shellCode = stripCommentsAndStrings(fs.readFileSync(path.join(srcDir, "app-v8.js"), "utf8"));
  checks.ok(matchLines(shellCode, /(^|[^\w.$'"`])state\s*[.[]/).length > 25,
    "app-v8.js itself uses the shell globals heavily — confirming the rule above is scoped to the pure layer and is not simply finding nothing anywhere");
}
