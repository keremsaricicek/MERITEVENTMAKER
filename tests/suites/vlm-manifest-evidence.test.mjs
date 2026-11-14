// Every local plan-reader manifest that wires a question carries its evidence
// (audit 2026-11-14, item 22).
//
//   A QUESTION IS WIRED WITHOUT A COMMITTED MEASUREMENT BEHIND IT. A manifest's
//   `checks` (and `autoApply`) say which questions the second look may ask; its
//   `checksEvidence` names the result files that justified them. Nothing checked
//   that those files exist, or that each wired question was actually scored in
//   them, so a question could be added to `checks` with no measurement at all.
// Mutation proof, recorded 2026-11-14: adding an unscored question ("zone") to
// b6d's checks, or an autoApply question not in checks, turns this suite red.
import fs from "node:fs";
import path from "node:path";

export const meta = { name: "vlm-manifest-evidence", tags: ["intelligence", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  const dir = path.join(repoRoot, "tools/local-vlm/manifests");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  checks.ok(files.length > 0, "the manifests were found");
  const problems = [];
  let wired = 0;
  for (const f of files) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const qs = Array.isArray(m.checks) ? m.checks : [];
    const auto = Array.isArray(m.autoApply) ? m.autoApply : [];
    for (const q of auto) if (!qs.includes(q)) problems.push(`${f}: autoApply "${q}" is not in checks`);
    if (!Array.isArray(m.checks)) continue;
    const ev = String(m.checksEvidence || "").match(/benchmarks\/\S+?\.json/g) || [];
    if (!ev.length) { problems.push(`${f}: has checks but names no evidence file`); continue; }
    const missing = ev.filter((e) => !fs.existsSync(path.join(repoRoot, e)));
    if (missing.length) { problems.push(`${f}: evidence missing ${missing.join(", ")}`); continue; }
    for (const q of qs) {
      wired++;
      const scored = ev.some((e) => { const s = JSON.parse(fs.readFileSync(path.join(repoRoot, e), "utf8")).summary || {}; return typeof s[q] === "number"; });
      if (!scored) problems.push(`${f}: wired question "${q}" has no score in its evidence`);
    }
  }
  checks.equal(problems, [], "every manifest's wired questions are backed by committed, scored evidence");
  checks.ok(wired >= 1, "at least one wired question was checked (b6d: merged)", wired);
}
