// What makes `measure-memory.mjs --compare` exit non-zero — a pure function,
// tested by tests/suites/ci-gate-honesty.test.mjs without running detection.
//
// It is a REGRESSION gate, and deliberately not the §23 gate. The §23
// thresholds (retention ≥ 0.98, identity precision ≥ 0.98, wrong application
// ≤ 0.01) are not met on transformed plans and no setting reaches them (§9: a
// signal problem, not threshold placement), so gating on them is permanently
// red and CI wrapped the step in `continue-on-error` — which meant it could not
// fail at all. This asks the question that can honestly fail today: did
// anything get worse than the recorded baseline?
//
// The one that matters most is WRONG applications. A lost decision is reported
// to the operator and re-made; a wrongly applied one is invisible, so one more
// of those in any scenario blocks, even when retention rose to pay for it.
export function memoryGate(report, baseline) {
  const blocking = [], improvements = [];
  if (!baseline) return { pass: false, blocking: ["MISSING benchmarks/memory/BASELINE.json — record one with --record-baseline --reason"], improvements };
  const base = new Map(baseline.scenarios.map(s => [s.scenario, s]));
  for (const s of report.scenarios) {
    const b = base.get(s.scenario);
    if (!b) { blocking.push(`UNBASELINED ${s.scenario}: no baseline for this scenario — record one deliberately`); continue; }
    if (s.pageErrors?.length) blocking.push(`ERROR ${s.scenario}: ${s.pageErrors.length} page error(s)`);
    // Retention is a ratio of scoreable decisions; if the decisions themselves
    // changed, a ratio against the old set compares two different corpora.
    if (s.scoreable !== b.scoreable) {
      blocking.push(`CORPUS ${s.scenario}: ${b.scoreable} scoreable decisions recorded, ${s.scoreable} now — the numbers are not comparable; re-record deliberately`);
      continue;
    }
    const now = s.ablation.full, was = b.ablation.full;
    if (now.wrong > was.wrong) blocking.push(`REGRESSED ${s.scenario} wrong applications: ${was.wrong} -> ${now.wrong}`);
    else if (now.wrong < was.wrong) improvements.push(`${s.scenario} wrong applications: ${was.wrong} -> ${now.wrong}`);
    if (now.retained < was.retained) blocking.push(`REGRESSED ${s.scenario} retained: ${was.retained} -> ${now.retained}`);
    else if (now.retained > was.retained) improvements.push(`${s.scenario} retained: ${was.retained} -> ${now.retained}`);
  }
  for (const id of base.keys())
    if (!report.scenarios.some(s => s.scenario === id)) blocking.push(`MISSING ${id}: in the baseline, not measured by this run`);
  return { pass: blocking.length === 0, blocking, improvements };
}
