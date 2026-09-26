// NO FAILURE IS SWALLOWED, AND NO FAILURE SPEAKS IN ITS OWN WORDS.
//
// `.claude/skills/merit-resilience-hardening/SKILL.md`, required evidence 3
// and 4, and its minimum gate:
//
//   "A static check that no new empty `catch` appears without an
//    expected-abstention comment."
//   "Evidence that no raw `error.message` reaches any surface." It is
//    "untranslated, often meaningless (QuotaExceededError), and sometimes
//    leaks internals."
//
// Both are STATIC because the paths they guard are, by definition, the ones
// no behavioural suite reaches: a catch block runs when something unusual
// happens, and an error toast shows only when that catch runs.
//
// MEASURED WHEN WRITTEN: zero empty catch blocks, one swallowing promise
// `.catch(() => null)` (a missing training crop — counted and reported, so a
// genuine abstention that now carries the marker), and EIGHT surfaces that
// showed a raw message to the operator: Assisted Detection failure, dataset
// export, training capture, the new-event and replace-plan readers, and
// three spreadsheet paths — plus the OCR engine's own sentence rendered in
// the plan review title, English inside a Turkish screen. All now show
// translated text; an error raised FOR the operator carries its sentence in
// `meritUserMessage` (src/app.js `userError` / `userMessage`).
//
// HOW A RAW MESSAGE IS FOUND. Line matching is useless on this codebase's
// minified one-line functions, so each `X.message` read is walked OUTWARD
// through the calls that enclose it. If `toast(`, `t(` or a markup template
// encloses it, the message reaches the screen. Stored diagnostics — a reason
// kept on the analysis for the suites to print — are not a surface.
import fs from "node:fs";
import path from "node:path";
import { stripCommentsAndStrings } from "../lib/js-scan.mjs";

export const meta = { name: "resilience-static", tags: ["resilience", "fast"], timeout: 20000 };

// The import wizard's issue records are the importer's own data, named `x`
// at every read — not caught errors.
const NOT_AN_ERROR = new Set(["x"]);
const SURFACE_CALLEES = new Set(["toast", "baseToast", "toastAction", "t", "confirm", "alert", "prompt"]);

function enclosingCallees(code, index) {
  const callees = [];
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const c = code[i];
    if (c === ")" || c === "]" || c === "}") depth++;
    else if (c === "(" || c === "[" || c === "{") {
      if (depth > 0) { depth--; continue; }
      if (c === "(") {
        const m = code.slice(Math.max(0, i - 40), i).match(/([A-Za-z_$][\w$]*)\s*$/);
        callees.push(m ? m[1] : "(");
      } else if (c === "{" && code[i - 1] === "$") callees.push("${");
      // Stop at the function body that holds this statement.
      if (c === "{" && code[i - 1] !== "$" && /\)\s*$|=>\s*$/.test(code.slice(Math.max(0, i - 4), i))) break;
    } else if (c === ";" && depth === 0) break;
  }
  return callees;
}

export default async function run({ checks, repoRoot }) {
  const dir = path.join(repoRoot, "src");
  const empty = [], swallowed = [], raw = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js")).sort()) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const code = stripCommentsAndStrings(text);
    const lineOf = (i) => code.slice(0, i).split("\n").length;
    const rawLines = text.split("\n");

    for (const m of code.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)) empty.push(`${f}:${lineOf(m.index)}`);

    for (const m of code.matchAll(/\.catch\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:\{\s*\}|null|undefined|false|0)\s*\)/g)) {
      const line = lineOf(m.index);
      const context = rawLines.slice(Math.max(0, line - 5), line).join("\n");
      if (!/EXPECTED ABSTENTION/.test(context)) swallowed.push(`${f}:${line}`);
    }

    for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*message\b/g)) {
      if (NOT_AN_ERROR.has(m[1])) continue;
      const callees = enclosingCallees(code, m.index);
      const hit = callees.find((c) => SURFACE_CALLEES.has(c) || c === "${");
      if (hit) raw.push(`${f}:${lineOf(m.index)} ${m[1]}.message inside ${hit}(`);
    }
  }
  checks.equal(empty, [], "no empty catch block anywhere in src/ — a failure is at least detected where it happens", empty);
  checks.equal(swallowed, [],
    "no promise .catch() that swallows its rejection unless it is marked EXPECTED ABSTENTION and says what reports the gap instead", swallowed);
  checks.equal(raw, [],
    "no caught error's own .message reaches a toast, a translated sentence or a markup template — the operator reads translated text", raw);

  // Positive control: the walker must actually see a surface when there is
  // one, or the check above is vacuous.
  const probe = stripCommentsAndStrings('try{}catch(error){toast(t("k",{reason:error.message}),"error");}');
  const at = probe.indexOf("error.message");
  checks.ok(enclosingCallees(probe, at).includes("toast"),
    "positive control: the walker finds toast( around a message it encloses", enclosingCallees(probe, at));
}
