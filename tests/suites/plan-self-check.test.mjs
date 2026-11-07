// Can the plan check itself, and does it stay honest while doing so?
//
// Every number the product shows comes from one of four places, and they are
// not equally trustworthy: what the drawing STATES about itself, what the
// detector FOUND, what the ARITHMETIC gives, and what a PERSON confirmed. This
// layer compares them. It reads nothing, measures nothing, and adds no engine
// calls — it only asks whether what is already known is self-consistent.
//
// The two rules it must never break:
//
//   ARITHMETIC IS CORROBORATION, NOT PERMISSION TO REWRITE EVIDENCE. When
//   166 x 12 does not equal the printed total, the answer is NEEDS REVIEW —
//   never a licence to adjust one of the numbers until it does. OCR of a
//   photographed sheet misreads digits constantly, which is exactly why the
//   check is worth having and exactly why it must not fix its own inputs.
//
//   EVERY NUMBER CARRIES WHERE IT CAME FROM. A check with anonymous inputs
//   tells an operator that something disagrees but not which side to trust,
//   which is the half of the message that decides what they do next.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "plan-self-check",
  tags: ["intelligence"],
  timeout: 60000,
  viewport: { width: 1200, height: 800 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const present = await page.evaluate(() => typeof globalThis.MeritSelfCheck === "object");
  checks.require(present, "the self-check layer is reachable from the suite");

  const run1 = (input) => page.evaluate((i) => globalThis.MeritSelfCheck.run(i), input);
  const find = (r, id) => r.checks.find((c) => c.id === id);

  // ORNEK's real printed rule, as the shape of a plan that states its own
  // capacity. The values are the drawing's, passed in — nothing in the module
  // knows them.
  const ORNEK_RULE = { units: 166, perUnit: 12, total: 1992, unitsSource: "derived", unitsAsRead: 1166, unitsAgree: false };
  const ORNEK_PARTS = { total: 2064, boxes: 72 };

  // ---- the arithmetic the drawing states about itself ----------------------
  {
    const r = await run1({ capacityAudit: { rule: ORNEK_RULE, parts: ORNEK_PARTS } });
    const a = find(r, "capacityRuleArithmetic");
    checks.ok(!!a, "the drawing's own multiplication is checked");
    checks.equal(a.verdict, "CONSISTENT", "166 x 12 = 1992 comes out");
    checks.equal(a.inputs.length, 3, "with all three numbers shown");
    checks.ok(a.inputs.every((i) => i.source), "each carrying where it came from", a.inputs);
    checks.ok(/derived from the printed seating figure/.test(a.inputs[0].source),
      "including that the table count was derived rather than read directly", a.inputs[0].source);

    const p = find(r, "capacityPartsSum");
    checks.equal(p.verdict, "CONSISTENT", "1992 + 72 = 2064 also comes out");
  }
  {
    // A misread digit. The answer is NEEDS REVIEW — not a repaired number.
    const r = await run1({ capacityAudit: { rule: { units: 1166, perUnit: 12, total: 1992 }, parts: ORNEK_PARTS } });
    const a = find(r, "capacityRuleArithmetic");
    checks.equal(a.verdict, "NEEDS_REVIEW", "a multiplication that does not come out is NEEDS REVIEW");
    checks.ok(/none of them is adjusted/.test(a.detail),
      "and the detail says plainly that nothing was adjusted to make it close", a.detail);
    checks.equal(a.inputs.find((i) => /tables/.test(i.name)).value, 1166,
      "the misread number is reported AS READ, not silently corrected to 166");
  }
  {
    const r = await run1({ capacityAudit: { rule: { units: 10, perUnit: 10, total: 100 }, parts: { total: 999, boxes: 5 } } });
    checks.equal(find(r, "capacityPartsSum").verdict, "NEEDS_REVIEW",
      "parts that do not add to the printed total are NEEDS REVIEW");
  }

  // ---- what the drawing claims against what was found ---------------------
  {
    const r = await run1({ capacityAudit: { rule: ORNEK_RULE, parts: ORNEK_PARTS }, tablesDetected: 163 });
    const v = find(r, "statedTablesVsDetected");
    checks.equal(v.verdict, "INCONSISTENT", "166 stated against 163 found is a real disagreement");
    checks.ok(/3 not accounted for/.test(v.detail), "named as three unaccounted for", v.detail);
    checks.equal(v.inputs.find((i) => /found/.test(i.name)).source, "Assisted Detection",
      "and the found figure says which side produced it");
  }
  {
    const r = await run1({ capacityAudit: { rule: ORNEK_RULE, parts: ORNEK_PARTS }, tablesDetected: 166 });
    checks.equal(find(r, "statedTablesVsDetected").verdict, "CONSISTENT", "and agreement is reported as agreement");
  }

  // ---- the finding that must never come back ------------------------------
  //
  // "The plan states 2064 pax but 0 seats were counted" was withdrawn in an
  // earlier sprint: on a plan that draws no seats it is a restatement of what
  // kind of drawing it is, dressed up as a discovery. It must not return
  // through this layer.
  {
    const r = await run1({ capacityAudit: { rule: ORNEK_RULE, parts: ORNEK_PARTS },
      seatsCounted: 0, drawsSeats: false });
    const s = find(r, "statedSeatsVsCounted");
    checks.equal(s.verdict, "NOT_CHECKABLE",
      "on a plan that draws no seats, the seat comparison is NOT CHECKABLE");
    checks.ok(!/INCONSISTENT/.test(s.verdict), "and never an inconsistency");
    checks.ok(/draws no seats/.test(s.detail), "with the reason stated", s.detail);
  }
  {
    const r = await run1({ capacityAudit: { rule: { units: 40, perUnit: 3, total: 120 }, parts: {} },
      seatsCounted: 112, drawsSeats: true });
    const s = find(r, "statedSeatsVsCounted");
    checks.equal(s.verdict, "CONSISTENT",
      "on a plan that DOES draw seats, 120 stated against 112 counted is within a tenth");
  }
  {
    const r = await run1({ capacityAudit: { rule: { units: 40, perUnit: 3, total: 120 }, parts: {} },
      seatsCounted: 40, drawsSeats: true });
    checks.equal(find(r, "statedSeatsVsCounted").verdict, "INCONSISTENT",
      "and a real shortfall on such a plan is reported");
  }

  // ---- numbering soundness ------------------------------------------------
  {
    const r = await run1({ numberIntegrity: { summary: { verified: 87 }, findings: [] } });
    const u = find(r, "tableNumbersUnique");
    checks.equal(u.verdict, "CONSISTENT", "no duplicate numbers is a consistent result");
    checks.ok(/two crops agreed/.test(u.inputs[0].source),
      "and the count of confident numbers says how it was earned", u.inputs[0].source);
    checks.ok(/a person confirmed/.test(u.inputs[0].source),
      "naming both routes to a confident number rather than implying every one was machine-read",
      u.inputs[0].source);
  }
  {
    const r = await run1({ numberIntegrity: { summary: { verified: 87 },
      findings: [{ kind: "duplicateNumber", number: 42, tableIds: ["a", "b"] }] } });
    checks.equal(find(r, "tableNumbersUnique").verdict, "INCONSISTENT", "a duplicate number is inconsistent");
  }

  // ---- a person outranks the system ---------------------------------------
  {
    const r = await run1({ humanVerified: [
      { id: "count", name: "table count", value: 166, against: 163, againstSource: "Assisted Detection" },
    ] });
    const h = r.checks.find((c) => /humanVerified/.test(c.id));
    checks.ok(!!h, "a human-confirmed figure is checked against the system's");
    checks.equal(h.verdict, "INCONSISTENT", "and a disagreement is reported");
    checks.ok(/the person is right/.test(h.detail),
      "with no ambiguity about which side wins", h.detail);
    checks.equal(h.inputs[0].confidence, "verified", "the human figure is the verified one");
  }

  // ---- says nothing when it knows nothing ---------------------------------
  {
    const r = await run1({});
    checks.equal(r.checks.length, 0, "a plan with no stated capacity and no numbers produces no checks");
    checks.equal(r.summary.total, 0, "and claims nothing in its summary");
  }
  {
    const r = await run1({ capacityAudit: { rule: ORNEK_RULE, parts: ORNEK_PARTS }, tablesDetected: 163 });
    checks.ok(/no input is adjusted/.test(r.policy),
      "and the policy is stated out loud rather than left to be inferred", r.policy);
    checks.equal(r.summary.consistent + r.summary.inconsistent + r.summary.needsReview + r.summary.notCheckable,
      r.checks.length, "every check lands in exactly one verdict bucket");
  }
}
