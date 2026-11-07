// A DOCUMENTED FIGURE THAT STOPS BEING TRUE FAILS THE BUILD.
//
// FINAL-COMPLETION-MATRIX.md, Documentation: "No check fails when a documented
// figure drifts." Measured 2026-10-04 before this suite: the frontend-architect
// agent's fact table said 43 source files (53), 43 script tags (53), 96 suites
// (110), a 2,682-line detection file (221, after Split A/B) and 27 offline
// checks (37); tests/README.md said "the 33 classic scripts" (53). Each was
// true once and was quoted as current.
//
// Two kinds of figure are held here:
//   CURRENT  a value the doc presents as how things are now. Each one is
//            re-measured from the code, and must match exactly.
//   HISTORY  a value pinned to a date or a commit ("6,874 on 2026-10-03",
//            "measured at 65ea956"). It describes the past and is left alone:
//            rewriting a dated measurement to today's number would falsify it.
// A bold figure in the fact table with no measurement here fails too, so the
// table cannot gain an unchecked number.
import fs from "node:fs";
import path from "node:path";

export const meta = { name: "doc-drift", tags: ["docs", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
  const newlines = (rel) => (read(rel).match(/\n/g) || []).length;
  const srcJs = fs.readdirSync(path.join(repoRoot, "src")).filter((f) => f.endsWith(".js"));
  const v8 = read("src/app-v8.js").split("\n");
  const suites = fs.readdirSync(path.join(repoRoot, "tests/suites")).filter((f) => f.endsWith(".test.mjs"));
  const live = {
    srcFiles: srcJs.length,
    srcLines: srcJs.reduce((n, f) => n + newlines(`src/${f}`), 0),
    v8Lines: newlines("src/app-v8.js"),
    v8Longest: Math.max(...v8.map((l) => l.length)),
    v8Over500: v8.filter((l) => l.length > 500).length,
    detectionLines: newlines("src/plan-detection-classical.js"),
    meritExporters: srcJs.filter((f) => read(`src/${f}`).includes("globalThis.Merit")).length,
    classicScripts: (read("index.html").match(/<script src="src\//g) || []).length,
    suites: suites.length,
    slowSuites: suites.filter((f) => /tags:\s*\[[^\]]*"slow"/.test(read(`tests/suites/${f}`))).length,
    ciJobs: (read(".github/workflows/ci.yml").match(/\n {2}[a-z-]+:\n {4}name:/g) || []).length,
  };

  // --- 1. the frontend-architect fact table: every bold figure, measured ---
  const TABLE = {
    "`src/*.js` files": ["srcFiles"],
    "`src/` total lines": ["srcLines"],
    "`app-v8.js`": ["v8Lines"],
    "Longest single line in `app-v8.js`": ["v8Longest", "v8Over500"],
    "`plan-detection-classical.js`": ["detectionLines"],
    "Files exporting `globalThis.Merit*`": ["meritExporters", "srcFiles"],
    "Classic `<script>` tags in `index.html`": ["classicScripts"],
    "Test suites": ["suites", "slowSuites"],
    "CI jobs": ["ciJobs"],
    "Offline verification": [],
  };
  const doc = read(".claude/agents/frontend-architect.md");
  const rows = [...doc.matchAll(/^\| ([^|]+?) \| ([^|]*?(?:\\\|[^|]*?)*) \| `[^\n]*\|$/gm)].filter((m) => m[1] !== "Fact" && !/^-+$/.test(m[1]));
  const drift = [], unmeasured = [];
  for (const [, fact, value] of rows) {
    const bold = [...value.matchAll(/\*\*(\d[\d,]*)/g)].map((m) => Number(m[1].replace(/,/g, "")));
    const keys = TABLE[fact.trim()];
    if (!keys) { if (bold.length) unmeasured.push(fact.trim()); continue; }
    const want = keys.map((k) => live[k]);
    if (JSON.stringify(bold) !== JSON.stringify(want)) drift.push(`${fact.trim()}: documented ${bold.join(", ") || "(none)"}, measured ${want.join(", ") || "(none)"}`);
  }
  checks.ok(rows.length >= Object.keys(TABLE).length, "the fact table was found and read", rows.map((r) => r[1]));
  checks.equal(unmeasured, [], "every bold figure in the fact table has a measurement in this suite");
  checks.equal(drift, [], "every figure in the frontend-architect fact table matches the code");

  // --- 2. figures stated as current elsewhere --------------------------------
  const CLAIMS = [
    ["tests/README.md", /the (\d+) classic scripts change order/, "classicScripts"],
    [".claude/rules/code-health.md", /<script src="src\/' index\.html` — (\d+) on/, "classicScripts"],
  ];
  const claimDrift = [];
  for (const [file, re, key] of CLAIMS) {
    const m = read(file).match(re);
    if (!m) claimDrift.push(`${file}: the claim ${re} is no longer there — update this registry with the doc`);
    else if (Number(m[1]) !== live[key]) claimDrift.push(`${file}: says ${m[1]}, measured ${live[key]}`);
  }
  checks.equal(claimDrift, [], "figures stated as current in the README and the rules match the code");

  // Every suite has a row saying what breaks when it goes red. 22 had none
  // on 2026-10-04, and one row sat outside the table behind a blank line.
  const readme = read("tests/README.md");
  const suiteNames = suites.map((f) => (read(`tests/suites/${f}`).match(/name:\s*"([^"]+)"/) || [])[1]);
  checks.equal(suiteNames.filter((n) => !readme.includes("| `" + n + "` |")), [], "every suite has a row in tests/README.md's table");
  const table = readme.slice(readme.indexOf("| suite | tags |"));
  const block = table.slice(0, table.search(/\n(?!\|)/));
  checks.equal(suiteNames.filter((n) => !block.includes("| `" + n + "` |")), [], "and every row is inside the table, not cut off from it by a blank line");

  // --- 3. history stays history ------------------------------------------------
  // A figure in CLAUDE.md about app-v8's size must carry its date: the file
  // says "re-measure", and an undated number there would read as current.
  checks.ok(/wc -l src\/app-v8\.js`\s*\([\d,]+ on \d{4}-\d{2}-\d{2}/.test(read("CLAUDE.md")),
    "CLAUDE.md's app-v8 size carries the date it was measured, so it reads as history rather than as current");
}
