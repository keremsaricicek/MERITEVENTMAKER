// Is this plan's numbering intact?
//
// Reading numbers and trusting numbering are different jobs. Phase 2 reads each
// symbol on its own and says how sure it is; this layer looks at all of them
// together and asks the questions only the whole set can answer — is anything
// claimed twice, is anything missing, does the count agree with what the
// drawing says about itself.
//
// Three rules govern it.
//
//   NOTHING IS REPAIRED. A gap between 136 and 138 is reported as a gap. It is
//   never filled in with 137, however obvious that looks, because "obvious" is
//   how a plan with a genuinely skipped number acquires a table that does not
//   exist. Reading and inference stay separate all the way to the screen.
//
//   THE RANGE COMES FROM THE DOCUMENT, NEVER FROM A CONSTANT. What counts as
//   "outside the expected range" is derived from numbers actually read and from
//   figures the drawing prints about itself. No production path knows that
//   ORNEK runs 1..157; that fact lives only in the benchmark's ground truth.
//
//   REPEATED UNCERTAINTY IS ONE FINDING, NOT FIFTY. Sixty-six unread numbers is
//   one thing an operator needs to know, not sixty-six things. Runs of
//   consecutive missing numbers are reported as runs.
(function () {
  "use strict";

  const KIND = {
    DUPLICATE: "duplicateNumber",
    CONFLICTING: "conflictingReadings",
    MISSING_RUN: "missingNumbers",
    UNREAD: "tablesWithoutAConfidentNumber",
    OUTSIDE_RANGE: "numberOutsideTheStatedRange",
    COUNT_DISAGREES: "tableCountDisagreesWithTheDrawing",
  };

  // How much an operator should care. Ordering, not arithmetic: these are used
  // to sort a review queue, and Phase 7 turns them into a budget.
  const SEVERITY = { HIGH: "high", MEDIUM: "medium", LOW: "low" };

  function numberOf(table) {
    const p = table && table.printedNumber;
    if (!p || p.state !== "VERIFIED" || typeof p.value !== "number") return null;
    return p.value;
  }

  // Consecutive integers collapse into one run, so "137, 138, 139" is reported
  // as 137-139 rather than three separate holes.
  function toRuns(sorted) {
    const runs = [];
    for (const n of sorted) {
      const last = runs[runs.length - 1];
      if (last && n === last.to + 1) last.to = n;
      else runs.push({ from: n, to: n });
    }
    return runs.map((r) => ({ ...r, count: r.to - r.from + 1 }));
  }

  // `statedCount` is what the drawing says about itself — read by OCR from a
  // printed capacity rule, or confirmed by a person. It is passed in rather
  // than looked up, so this module cannot acquire an opinion about any
  // particular plan.
  function analyse(input) {
    const tables = (input && input.tables) || [];
    const statedCount = input && typeof input.statedCount === "number" ? input.statedCount : null;
    const statedCountSource = (input && input.statedCountSource) || null;

    const findings = [];
    const byNumber = new Map();
    let verified = 0, needsReview = 0, unknown = 0, unnumbered = 0;

    for (const t of tables) {
      const p = t.printedNumber;
      if (!p) { unnumbered++; continue; }
      if (p.state === "VERIFIED" && typeof p.value === "number") {
        verified++;
        if (!byNumber.has(p.value)) byNumber.set(p.value, []);
        byNumber.get(p.value).push(t.id);
      } else if (p.state === "NEEDS_REVIEW") {
        needsReview++;
        // Two crops of one symbol reading different numbers is a different
        // problem from one crop reading nothing, and the operator fixes them
        // differently — one is a choice, the other is a look.
        const values = [...new Set((p.readings || []).map((r) => r.value).filter((v) => v != null))];
        if (values.length > 1) {
          findings.push({ kind: KIND.CONFLICTING, severity: SEVERITY.HIGH,
            tableIds: [t.id], values,
            detail: "two crops of this symbol read different numbers; neither is claimed" });
        }
      } else unknown++;
    }

    // ---- the same number claimed by two tables ------------------------------
    // High severity without qualification: two tables called 42 is an error an
    // operator will otherwise meet at the door, with a guest in front of them.
    for (const [value, ids] of byNumber) {
      if (ids.length > 1) {
        findings.push({ kind: KIND.DUPLICATE, severity: SEVERITY.HIGH,
          number: value, tableIds: ids,
          detail: `${ids.length} tables each read as ${value}` });
      }
    }

    // ---- the range, discovered ---------------------------------------------
    const numbers = [...byNumber.keys()].sort((a, b) => a - b);
    let range = null;
    if (numbers.length) {
      range = {
        from: numbers[0],
        to: statedCount != null ? Math.max(numbers[numbers.length - 1], statedCount) : numbers[numbers.length - 1],
        source: statedCount != null
          ? `numbers read from the drawing, extended to the ${statedCount} the drawing states`
          : "numbers read from the drawing",
      };
    }

    // A number beyond what the drawing says it has. Only checkable when the
    // drawing states a count — without one there is nothing to be outside of,
    // and inventing a ceiling would be exactly the hardcoding this forbids.
    if (statedCount != null) {
      const over = numbers.filter((n) => n > statedCount);
      if (over.length) {
        findings.push({ kind: KIND.OUTSIDE_RANGE, severity: SEVERITY.HIGH,
          numbers: over, tableIds: over.flatMap((n) => byNumber.get(n)),
          detail: `the drawing states ${statedCount} tables, but ${over.join(", ")} ${over.length === 1 ? "was" : "were"} read` });
      }
    }

    // ---- positions in the range that nothing claims -------------------------
    if (range) {
      const have = new Set(numbers);
      const missing = [];
      for (let n = range.from; n <= range.to; n++) if (!have.has(n)) missing.push(n);
      if (missing.length) {
        const runs = toRuns(missing);
        findings.push({ kind: KIND.MISSING_RUN, severity: SEVERITY.MEDIUM,
          count: missing.length, runs,
          detail: `${missing.length} number${missing.length === 1 ? "" : "s"} between ${range.from} and ${range.to} ${missing.length === 1 ? "is" : "are"} not accounted for, in ${runs.length} run${runs.length === 1 ? "" : "s"}`,
          // Said plainly, because the two explanations need different work and
          // this layer cannot tell them apart on its own.
          note: "each is either a table whose number could not be read, or a number the drawing does not use" });
      }
    }

    // ---- tables the system could not confidently number ---------------------
    if (needsReview + unknown > 0) {
      findings.push({ kind: KIND.UNREAD, severity: needsReview ? SEVERITY.MEDIUM : SEVERITY.LOW,
        needsReview, unknown, count: needsReview + unknown,
        detail: `${needsReview + unknown} of ${tables.length} tables have no confident number (${needsReview} need a look, ${unknown} could not be read at all)` });
    }

    // ---- does the count agree with the drawing? -----------------------------
    if (statedCount != null && tables.length !== statedCount) {
      findings.push({ kind: KIND.COUNT_DISAGREES, severity: SEVERITY.HIGH,
        stated: statedCount, found: tables.length, difference: Math.abs(statedCount - tables.length),
        statedSource: statedCountSource,
        detail: `the drawing states ${statedCount} tables; ${tables.length} were found` });
    }

    const order = { high: 0, medium: 1, low: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);

    return {
      summary: {
        tables: tables.length,
        verified, needsReview, unknown, unnumbered,
        duplicates: findings.filter((f) => f.kind === KIND.DUPLICATE).length,
        statedCount, statedCountSource,
      },
      range,
      findings,
      // Every number this layer reports can be traced to where it came from.
      // Nothing here is derived from a constant about any particular plan.
      provenance: {
        numbersFrom: "OCR of each table's own symbol, accepted only where two different crops agreed",
        rangeFrom: range ? range.source : "no numbers were read",
        statedCountFrom: statedCountSource || "not stated by the drawing",
      },
    };
  }

  globalThis.MeritNumberIntegrity = { version: 1, KIND, SEVERITY, analyse, toRuns };
})();
