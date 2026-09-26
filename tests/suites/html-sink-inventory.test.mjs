// EVERY PLACE A STRING BECOMES MARKUP, NAMED — AND NO NEW ONE WITHOUT REVIEW.
//
// `.claude/skills/merit-security-hardening/SKILL.md`: "Every one of the 13
// `innerHTML` assignments has its inputs traced to either a literal, a number,
// or an escaped string. Trace all 13 and write down what each interpolates; do
// not sample." And: "An `innerHTML` inventory test that fails when a new
// assignment appears without review, so the count cannot grow silently."
//
// THE INVENTORY below is that trace. Each sink is identified by its file, the
// function that ENCLOSES it (found by brace matching on code with comments and
// strings stripped, not by "the nearest function above it", which named three
// of these wrongly the first time) and the element it writes to — never by a
// line number, which every unrelated edit would move.
//
// WHAT "TRACED" MEANS HERE, honestly. Twelve of the fourteen write something
// small enough to read in full, and `trace` says what each interpolates. The
// two `render` sinks write the WHOLE screen — thousands of lines of nested
// templates — and reading them is not evidence (that is the skill's whole
// point). For those, the evidence is `hostile-input`, which puts a payload in
// every text field and walks every screen through them. `evidence` names which
// kind each entry has.
//
// FAILS WHEN: a sink appears that is not listed (write its trace here, or
// better, use textContent); a listed sink disappears (the inventory is stale —
// remove it); or any string-evaluating API appears at all.
//
// MUTATION PROOF, recorded: an added `el.innerHTML=v` names itself as
// `app-v8.js :: mutantSink :: el.innerHTML` and moves the total to 15; an
// added `setTimeout("render()",10)` is caught from the raw text; an added
// unpaired createObjectURL makes the count 5 against 4.
import fs from "node:fs";
import path from "node:path";
import { stripCommentsAndStrings } from "../lib/js-scan.mjs";

export const meta = { name: "html-sink-inventory", tags: ["security", "fast"], timeout: 20000 };

const INVENTORY = [
  { file: "app-v8.js", fn: "render", target: "app.innerHTML", count: 2, evidence: "hostile-input",
    trace: "The live render: setupHTML() for the new-event screen, and futureSchemaBannerHTML() + eventsHTML() / workspaceHTML() for everything else. Interpolates every stored text field of every screen; covered by fixture, not by reading." },
  { file: "app.js", fn: "render", target: "app.innerHTML", evidence: "boot-contract",
    trace: "The pre-v8 render. Overridden by app-v8.js's render before first use; boot-contract proves at runtime that the override is the body that runs." },
  { file: "app-v8.js", fn: "renderGlobalSearch", target: "box.innerHTML", evidence: "hostile-input",
    trace: "Global finder results: guestResultHTML() per row (guest name, invited-by, table number, zone — all through esc()), find.more with a numeric count, find.none literal." },
  { file: "app.js", fn: "renderGlobalSearch", target: "box.innerHTML", evidence: "boot-contract",
    trace: "The pre-v8 finder, reassigned by app-v8.js (`renderGlobalSearch = function`) at load." },
  { file: "app-v8.js", fn: "refreshGhosts", target: "world.insertAdjacentHTML", evidence: "literal",
    trace: "ghostHTML(): the bulk-add preview. A table-number prefix through esc(), and x/y pixel positions computed by bulkPositions() — numbers." },
  { file: "app-v8.js", fn: "bindFreezeZones > commit", target: "box.innerHTML", evidence: "literal",
    trace: "freezeCoveragePreviewHTML(): t() strings whose only parameters are table and chair COUNTS. No name, zone or note is interpolated." },
  { file: "app-v8.js", fn: "renderExcelWizard", target: "root.innerHTML", evidence: "hostile-input",
    trace: "The guest-import wizard. File name, column headers, source cells and interpreted fields, all through esc(); step labels and summary counts otherwise." },
  { file: "app-guests.js", fn: "renderExcelWizard", target: "root.innerHTML", evidence: "boot-contract",
    trace: "The pre-v8 wizard, reassigned by app-v8.js (`renderExcelWizard = function`). Its body escapes headers and cells the same way." },
  { file: "app-v8.js", fn: "printTablePlan", target: "root.innerHTML", evidence: "hostile-input",
    trace: "The printable table plan: event name, hotel/salon, formatted table numbers and guest names through esc(); fmtDate() output (a constant placeholder when unreadable) through esc(); pax counts." },
  { file: "app-v8.js", fn: "printTablePlan > cleanup", target: "root.innerHTML", evidence: "literal",
    trace: "Clears the print layer: the empty string." },
  { file: "app-v8.js", fn: "translateStaticDialogs", target: "planningSel.innerHTML", evidence: "literal",
    trace: "Two <option>s whose text is t() of fixed keys and whose values are the literals Confirmed / Tentative." },
  { file: "app-v8.js", fn: "renderGuide", target: "root.innerHTML", evidence: "literal",
    trace: "The user guide: hardcoded EN/TR card text and titles chosen by ui.guideLang. No stored or typed content." },
  { file: "app-guests.js", fn: "renderGuide", target: "root.innerHTML", evidence: "boot-contract",
    trace: "The pre-v8 guide (static GUIDE_EN / GUIDE_TR data), reassigned by app-v8.js." },
];

const FN = /(?:function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{|([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*[A-Za-z_$\w]*\s*\([^)]*\)\s*\{|(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{)/g;
function functionRanges(code) {
  const out = [];
  for (const m of code.matchAll(FN)) {
    const open = m.index + m[0].length - 1;
    let depth = 0, i = open;
    for (; i < code.length; i++) { if (code[i] === "{") depth++; else if (code[i] === "}") { depth--; if (!depth) break; } }
    out.push({ name: m[1] || m[2] || m[3], from: open, to: i });
  }
  return out;
}

export default async function run({ checks, repoRoot }) {
  const dir = path.join(repoRoot, "src");
  const found = [];
  const evalish = [], objectUrls = { create: 0, revoke: 0 };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js")).sort()) {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    const code = stripCommentsAndStrings(raw);
    const ranges = functionRanges(code);
    for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*(innerHTML|outerHTML)\s*(\+?=)(?!=)|([A-Za-z_$][\w$]*)\s*\.\s*insertAdjacentHTML\s*\(/g)) {
      const inside = ranges.filter((r) => r.from < m.index && m.index < r.to).sort((a, b) => (b.to - b.from) - (a.to - a.from));
      found.push({ file: f, fn: inside.map((r) => r.name).join(" > ") || "(top level)", target: `${m[1] || m[4]}.${m[2] || "insertAdjacentHTML"}` });
    }
    for (const m of code.matchAll(/\beval\s*\(|\bnew\s+Function\s*\(|document\s*\.\s*write(?:ln)?\s*\(|createContextualFragment\s*\(|\.srcdoc\s*=|\bDOMParser\b/g))
      evalish.push(`${f}: ${m[0]}`);
    // A string-bodied timer is a string evaluated as code; the stripper blanks
    // the string, so this one is read from the raw text.
    for (const m of raw.matchAll(/\bset(?:Timeout|Interval)\s*\(\s*["'`]/g)) evalish.push(`${f}: ${m[0]}`);
    objectUrls.create += (code.match(/URL\s*\.\s*createObjectURL\s*\(/g) || []).length;
    objectUrls.revoke += (code.match(/URL\s*\.\s*revokeObjectURL\s*\(/g) || []).length;
  }

  const key = (x) => `${x.file} :: ${x.fn} :: ${x.target}`;
  const counts = new Map();
  for (const x of found) counts.set(key(x), (counts.get(key(x)) || 0) + 1);
  const expected = new Map(INVENTORY.map((x) => [key(x), x.count || 1]));

  const unreviewed = [...counts].filter(([k, n]) => (expected.get(k) || 0) < n).map(([k, n]) => `${k} ×${n - (expected.get(k) || 0)}`);
  const stale = [...expected].filter(([k, n]) => (counts.get(k) || 0) < n).map(([k]) => k);
  checks.equal(unreviewed, [],
    "every place a string becomes markup is in the reviewed inventory — a new one needs its inputs traced here, or textContent instead",
    unreviewed);
  checks.equal(stale, [],
    "and every inventoried sink still exists — a sink that moved or went away must be removed from the list, not left to vouch for nothing",
    stale);
  checks.equal(found.length, INVENTORY.reduce((n, x) => n + (x.count || 1), 0),
    `the total is ${found.length}: the skill measured 13 innerHTML assignments and one insertAdjacentHTML at 65ea956`, found.length);
  checks.ok(INVENTORY.every((x) => x.trace && x.trace.length > 30 && ["literal", "hostile-input", "boot-contract"].includes(x.evidence)),
    "and each carries a written trace and names its evidence — a listed sink with no account of its inputs is a count, not a review");
  checks.equal(evalish, [], "no API that evaluates a string as code or parses it as a document — eval, new Function, document.write, string timers, srcdoc, DOMParser, createContextualFragment", evalish);
  checks.equal(objectUrls.create, objectUrls.revoke,
    "every createObjectURL has a matching revokeObjectURL, by count", objectUrls);

  // CSP READINESS. The skill's goal is "CSP-ready before desktop packaging",
  // and measured at the time of writing the product is close: ZERO inline
  // event-handler attributes anywhere (every handler is bound in code), ONE
  // inline <script> (the pdf.js module bootstrap in index.html, which a CSP
  // would admit by hash), 66 inline style="" attributes (style-src-attr), a
  // blob: worker for OCR in the CDN build only. The two numbers that decide
  // `script-src` are held here, so neither can grow without someone reading
  // this. Inline style is recorded, not guarded: it needs a policy decision,
  // not a test.
  const handlerAttr = /[\s<"'`]on[a-z]+\s*=\s*["'`$\\]/g;
  const inlineHandlers = [];
  for (const f of [...fs.readdirSync(dir).filter((x) => x.endsWith(".js")).map((x) => path.join(dir, x)), path.join(repoRoot, "index.html")]) {
    const raw = fs.readFileSync(f, "utf8");
    for (const m of raw.matchAll(handlerAttr)) inlineHandlers.push(`${path.basename(f)}: ${m[0].trim()}`);
  }
  checks.equal(inlineHandlers, [],
    "no inline event-handler attribute in any markup this product writes — the one pattern a CSP forbids outright AND the one an escaping slip turns into execution",
    inlineHandlers.slice(0, 5));
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/g)].length;
  checks.equal(inlineScripts, 1,
    "index.html has exactly one inline <script> (the pdf.js bootstrap) — another one needs a CSP hash, so it needs a decision",
    inlineScripts);
}
