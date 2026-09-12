// Whether a plan's numbering is intact — a different question from whether any
// one number was read.
//
// The rules this pins, all three of which are ways of not lying:
//
//   NOTHING IS REPAIRED. A gap between 136 and 138 is a gap. It is never filled
//   in with 137, however obvious that looks, because "obvious" is how a plan
//   with a genuinely skipped number acquires a table that does not exist.
//
//   THE RANGE COMES FROM THE DOCUMENT. What counts as out of range is derived
//   from numbers actually read and from figures the drawing prints about
//   itself. Nothing in production knows that ORNEK runs 1..157; that lives only
//   in the benchmark's ground truth, and these tests use invented numbers
//   throughout so a constant could not creep in unnoticed.
//
//   REPEATED UNCERTAINTY IS ONE FINDING. Sixty-six unread numbers is one thing
//   an operator needs to know, not sixty-six things.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "plan-number-integrity",
  tags: ["intelligence"],
  timeout: 60000,
  viewport: { width: 1200, height: 800 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const present = await page.evaluate(() => typeof globalThis.MeritNumberIntegrity === "object");
  checks.require(present, "the integrity layer is reachable from the suite");

  const analyse = (input) => page.evaluate((i) => globalThis.MeritNumberIntegrity.analyse(i), input);
  const verified = (id, value) => ({ id, printedNumber: { state: "VERIFIED", value } });
  const review = (id, readings) => ({ id, printedNumber: { state: "NEEDS_REVIEW", value: null, readings } });
  const unknown = (id) => ({ id, printedNumber: { state: "UNKNOWN", value: null, readings: [] } });
  const kinds = (r) => r.findings.map((f) => f.kind);

  // ---- a clean plan says nothing alarming ---------------------------------
  {
    const r = await analyse({ tables: [verified("a", 1), verified("b", 2), verified("c", 3)] });
    checks.equal(r.summary.verified, 3, "three confident numbers are counted");
    checks.equal(r.findings.length, 0, "and an intact 1-2-3 raises nothing", kinds(r));
    checks.equal(r.range.from, 1, "the range starts where the numbers do");
    checks.equal(r.range.to, 3, "and ends where they do");
  }

  // ---- the same number twice ----------------------------------------------
  {
    const r = await analyse({ tables: [verified("a", 41), verified("b", 42), verified("c", 42)] });
    const dup = r.findings.find((f) => f.kind === "duplicateNumber");
    checks.ok(!!dup, "two tables reading the same number is reported", kinds(r));
    checks.equal(dup && dup.number, 42, "naming the number");
    checks.equal(dup && dup.tableIds.length, 2, "and both tables that claim it");
    checks.equal(dup && dup.severity, "high",
      "at high severity — an operator otherwise meets this at the door with a guest in front of them");
  }

  // ---- a symbol whose own crops disagreed ----------------------------------
  {
    const r = await analyse({ tables: [
      verified("a", 1), verified("b", 2),
      review("c", [{ view: "x", value: 104 }, { view: "y", value: 10 }]),
    ] });
    const conflict = r.findings.find((f) => f.kind === "conflictingReadings");
    checks.ok(!!conflict, "a symbol whose crops disagree is reported as a conflict", kinds(r));
    checks.ok(conflict && conflict.values.includes(104) && conflict.values.includes(10),
      "with both readings shown so a person can choose", conflict && conflict.values);
    checks.equal(conflict && conflict.severity, "high", "and it needs a decision, not a glance");
  }
  {
    // A single unread crop is NOT a conflict — nothing disagreed with anything.
    const r = await analyse({ tables: [verified("a", 1), review("b", [{ view: "x", value: 7 }]) ] });
    checks.ok(!kinds(r).includes("conflictingReadings"),
      "one crop reading and the other reading nothing is not a conflict", kinds(r));
  }

  // ---- gaps are runs, and are never filled in ------------------------------
  {
    const r = await analyse({ tables: [verified("a", 136), verified("b", 138)] });
    const gap = r.findings.find((f) => f.kind === "missingNumbers");
    checks.ok(!!gap, "a hole in the numbering is reported", kinds(r));
    checks.equal(gap && gap.count, 1, "one position unaccounted for");
    checks.equal(gap && gap.runs[0].from, 137, "named as 137");
    checks.ok(!r.findings.some((f) => f.number === 137 && f.kind !== "missingNumbers"),
      "and 137 is NOT handed to any table");
    checks.ok(gap && /not accounted for/.test(gap.detail),
      "the wording says unaccounted for, not missing table", gap && gap.detail);
    checks.ok(gap && /could not be read|does not use/.test(gap.note || ""),
      "and names both explanations rather than choosing one", gap && gap.note);
  }
  {
    // Consecutive holes collapse. This is the difference between an operator
    // seeing one line and seeing sixty-six.
    const tables = [verified("a", 1)];
    for (let n = 20; n <= 30; n++) tables.push(verified(`t${n}`, n));
    const r = await analyse({ tables });
    const gap = r.findings.find((f) => f.kind === "missingNumbers");
    checks.equal(gap && gap.count, 18, "eighteen positions are unaccounted for");
    checks.equal(gap && gap.runs.length, 1, "but they are ONE run, not eighteen findings");
    checks.equal(gap && gap.runs[0].from, 2, "from 2");
    checks.equal(gap && gap.runs[0].to, 19, "to 19");
  }
  {
    const runs = await page.evaluate(() => globalThis.MeritNumberIntegrity.toRuns([3, 4, 5, 9, 11, 12]));
    checks.equal(runs.length, 3, "separate holes stay separate runs");
    checks.equal(runs[0].count, 3, "with their lengths counted");
    checks.equal(runs[1].from, 9, "and a single missing number is its own run");
  }

  // ---- the range comes from the drawing, and only from it ------------------
  {
    // With no stated count there is nothing to be outside of, so no such
    // finding is produced. Inventing a ceiling here is exactly the hardcoding
    // this layer exists to avoid.
    const r = await analyse({ tables: [verified("a", 1), verified("b", 900)] });
    checks.ok(!kinds(r).includes("numberOutsideTheStatedRange"),
      "with no stated count, nothing is called out of range", kinds(r));
    checks.equal(r.range.to, 900, "the discovered range simply reaches as far as what was read");
    checks.ok(/read from the drawing/.test(r.provenance.rangeFrom),
      "and says where it came from", r.provenance.rangeFrom);
  }
  {
    // WITH a stated count, a number beyond it is checkable — and the count is
    // the drawing's own, passed in, never a constant in the code.
    const r = await analyse({ tables: [verified("a", 1), verified("b", 9)], statedCount: 5,
      statedCountSource: "the capacity rule the drawing prints (5 x 12 = 60)" });
    const over = r.findings.find((f) => f.kind === "numberOutsideTheStatedRange");
    checks.ok(!!over, "a number past what the drawing states is reported", kinds(r));
    checks.ok(over && over.numbers.includes(9), "naming it", over && over.numbers);
    checks.ok(/capacity rule/.test(r.provenance.statedCountFrom),
      "and the stated count carries its own provenance", r.provenance.statedCountFrom);
  }
  {
    const r = await analyse({ tables: [verified("a", 1), verified("b", 2)], statedCount: 40,
      statedCountSource: "printed" });
    const count = r.findings.find((f) => f.kind === "tableCountDisagreesWithTheDrawing");
    checks.ok(!!count, "a plan with fewer tables than the drawing claims is reported", kinds(r));
    checks.equal(count && count.stated, 40, "stating what the drawing said");
    checks.equal(count && count.found, 2, "and what was found");
    checks.equal(r.range.to, 40, "and the range extends to the stated count, not just to what was read");
  }

  // ---- unread tables are one line, with the two cases kept apart -----------
  {
    const tables = [verified("a", 1)];
    for (let i = 0; i < 30; i++) tables.push(unknown(`u${i}`));
    for (let i = 0; i < 5; i++) tables.push(review(`r${i}`, [{ view: "x", value: 50 + i }]));
    const r = await analyse({ tables });
    const unread = r.findings.find((f) => f.kind === "tablesWithoutAConfidentNumber");
    checks.ok(!!unread, "tables with no confident number are reported", kinds(r));
    checks.equal(unread.count, 35, "as one finding covering all 35");
    checks.equal(unread.needsReview, 5, "with the ones worth a look counted");
    checks.equal(unread.unknown, 30, "separately from the ones nothing could read");
    checks.equal(r.findings.filter((f) => f.kind === "tablesWithoutAConfidentNumber").length, 1,
      "and it is ONE finding, not thirty-five");
  }

  // ---- ordering: what an operator should look at first ---------------------
  {
    const tables = [verified("a", 1), verified("b", 5), verified("c", 5)];
    for (let i = 0; i < 4; i++) tables.push(unknown(`u${i}`));
    const r = await analyse({ tables });
    checks.equal(r.findings[0].severity, "high", "the duplicate comes first");
    checks.equal(r.findings[0].kind, "duplicateNumber", "because it is the one that bites at the door");
  }

  // ---- an empty plan claims nothing ---------------------------------------
  {
    const r = await analyse({ tables: [] });
    checks.equal(r.findings.length, 0, "no tables means no findings");
    checks.equal(r.range, null, "and no range is invented");
  }
  {
    const r = await analyse({ tables: [unknown("a"), unknown("b")] });
    checks.equal(r.range, null, "a plan where nothing could be read has no discovered range");
    checks.ok(!kinds(r).includes("missingNumbers"),
      "and no gaps are reported against a range that does not exist", kinds(r));
  }
}
