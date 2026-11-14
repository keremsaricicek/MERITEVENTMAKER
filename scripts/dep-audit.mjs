#!/usr/bin/env node
// `npm run audit:deps` — INFO (audit 2026-11-14, item 26). Reports known
// vulnerabilities in the RUNTIME dependencies (`npm audit --omit=dev`) for a
// human to read. It never blocks: exit 0 whatever it finds, and it says plainly
// when the audit itself could not run (no network, registry down) instead of
// reporting "0 found". Classified INFO in merit-ci-quality-gates.
import { spawnSync } from "node:child_process";

const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", shell: process.platform === "win32" });
let report = null;
try { report = JSON.parse(r.stdout || ""); } catch {}
const v = report && report.metadata && report.metadata.vulnerabilities;
if (!v) {
  console.log("dependency audit: NOT RUN — npm audit gave no report" + (r.stderr ? ` (${r.stderr.trim().split("\n")[0]})` : ""));
} else {
  const total = Object.values(v).reduce((n, x) => n + (typeof x === "number" ? x : 0), 0) - (v.total || 0);
  console.log(`dependency audit (runtime only): ${v.total ?? total} known — critical ${v.critical || 0}, high ${v.high || 0}, moderate ${v.moderate || 0}, low ${v.low || 0}`);
  for (const [name, d] of Object.entries(report.vulnerabilities || {})) console.log(`  ${d.severity}\t${name}\t${(d.via || []).map((x) => (typeof x === "string" ? x : x.title)).join("; ")}`);
}
process.exit(0);
