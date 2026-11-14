// The one place a performance runner compares a measurement with its budget.
// Budgets, and why each is what it is, live in BUDGETS.json beside this file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUDGETS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "BUDGETS.json"), "utf8"));

// The budgets were measured on the CI runner, so that is where they are
// enforced. This container measured tableSelect at 2× the CI figure: holding a
// slower machine to the CI budget would fail it for being a different machine,
// and loosening the budget to fit it would stop CI catching a doubling. Off CI
// the comparison is printed and does not fail, unless PERF_ENFORCE=1.
export const ENFORCED = process.env.CI === "true" || process.env.PERF_ENFORCE === "1";

// rows: [label, measured, budget, unit]; a measured value ABOVE the budget fails.
export function judge(title, rows) {
  console.log(`\n=== BUDGETS — ${title} (benchmarks/perf/BUDGETS.json) ===`);
  console.log("  " + "check".padEnd(30) + "measured".padStart(10) + "budget".padStart(10) + "   ");
  const over = [];
  for (const [label, measured, budget, unit = "ms"] of rows) {
    const bad = !(Number.isFinite(measured) && measured <= budget);
    if (bad) over.push(label);
    console.log("  " + label.padEnd(30) + String(measured).padStart(10) + String(budget).padStart(10) + `   ${unit}  ${bad ? "OVER BUDGET" : "ok"}`);
  }
  console.log(over.length ? `\n  ${over.length} over budget: ${over.join(", ")}` : "\n  every measurement within budget");
  if (over.length && !ENFORCED) console.log("  NOT ENFORCED HERE: the budgets were measured on the CI runner and are enforced there (CI=true), or with PERF_ENFORCE=1.");
  return ENFORCED ? over : [];
}
