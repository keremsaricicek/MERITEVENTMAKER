// One section of the CI run's summary page, classified the way
// .claude/skills/merit-ci-quality-gates classifies checks. §27 of the master
// programme asks that a green run SAY what it covers: which release gates
// passed, what is a warning, what is only a measurement. A step's green tick
// cannot say that; this can.
//
// Writes only when GitHub provides GITHUB_STEP_SUMMARY, so a local run prints
// exactly what it printed before.
import fs from "node:fs";

export function ciSummary(title, rows) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const md = [`### ${title}`, "", "| class | result |", "|---|---|",
    ...rows.map((r) => `| ${cell(r.cls)} | ${cell(r.text)} |`), "", ""].join("\n");
  try { fs.appendFileSync(file, md); }
  catch (e) { console.warn(`could not write the CI summary: ${e.message}`); }
}
