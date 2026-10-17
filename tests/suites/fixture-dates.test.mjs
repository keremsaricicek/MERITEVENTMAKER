// A FIXTURE DATE ABOUT TO EXPIRE IS A FAILURE WAITING FOR THE CALENDAR.
//
// An event dated before today is historical: read-only, no Floor Plan, no
// Detect button. Measured 2026-10-03: every benchmark runner and one suite
// typed "2026-10-02" into the new-event form, and on 2026-10-03 every one of
// them created a record of the past. symbolic-plan-detection timed out on a
// click with a message that said nothing about dates, and the next CI run would
// have failed every detection and intelligence job the same way — with no
// change to the product. Three more fixtures carried "2026-12-31".
//
// An event that must be workable takes futureDate() (tests/lib/app-actions.mjs)
// or, inside page.evaluate, a date computed there. A DELIBERATELY past date
// (a historical-event test) or a far-future one is fine. This fails on the
// dangerous kind: a literal in the next two years, and any literal typed into
// the event form's date field.
import fs from "node:fs";
import path from "node:path";

export const meta = { name: "fixture-dates", tags: ["fast"], timeout: 20000 };

const HORIZON_DAYS = 730;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "reports" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

export default async function run({ checks, repoRoot }) {
  const files = [...walk(path.join(repoRoot, "tests")), ...walk(path.join(repoRoot, "benchmarks"))];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const soon = [], typed = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    if (rel === path.join("tests", "suites", "fixture-dates.test.mjs")) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/["'](\d{4})-(\d{2})-(\d{2})["']/g)) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        // An invalid calendar date (2026-02-31) is a deliberate refusal fixture.
        if (d.getMonth() !== Number(m[2]) - 1) continue;
        const days = (d - today) / 86400000;
        if (days >= 0 && days <= HORIZON_DAYS) soon.push(`${rel}:${i + 1} ${m[0]} (${Math.round(days)} days)`);
      }
      if (/name="date"\]['"],\s*["']\d{4}-/.test(line)) typed.push(`${rel}:${i + 1}`);
    });
  }
  checks.ok(files.length > 50, "the scan reads the test and benchmark sources", files.length);
  checks.equal(typed, [], "no runner types a literal date into the event form — a workable event takes futureDate()");
  checks.equal(soon, [], `no fixture date expires within ${HORIZON_DAYS} days; a deliberate past or far-future date is fine`);
}
