// What makes the adversarial run exit non-zero, as one pure function so the
// decision can be tested without running detection (tests/suites/
// ci-gate-honesty.test.mjs feeds it every case below).
//
// Before this file the runner went red on exactly one thing — a guarded field
// worse than BASELINE.json — and only when called with --compare, which CI did
// not pass. So in CI it could fail on nothing short of a crash, while two
// fixtures were FAIL: output that is actively wrong, a phantom table on the
// floor plan. Green meant "it ran".
//
// It now blocks on, and only on:
//
//   REFUSED      a fixture whose frozen bytes moved — its score means nothing
//   ERROR        no analysis, a timeout, or a page error during detection
//   MISSING      a baseline fixture this (unfiltered) run did not score
//   UNBASELINED  a fixture with no baseline — nothing to regress against
//   NEW FAIL     a FAIL code KNOWN-FAILS.json does not list for that fixture
//   STALE KNOWN  a listed FAIL code the fixture no longer produces — the entry
//                must go, or it would wave the failure through when it returns
//   REGRESSED    a guarded field worse than the frozen baseline
//
// A listed FAIL does not block, and is printed on every run with its reason
// and owner. Listing is not acceptance of the output as correct: the entry
// says who owns it and where the open work is recorded.

// Every guarded field compared separately, because a trade (relations up,
// table recall down) is invisible in one score and is a revert, not a win.
export const GUARDED = [
  ["tables.f1", r => r.tables?.f1], ["tables.recall", r => r.tables?.recall],
  ["tables.heldBack", r => r.tables?.heldBack, "lower"],
  ["chairs.f1", r => r.chairs?.f1],
  ["relations.accuracy", r => r.relations?.accuracy], ["relations.coverage", r => r.relations?.coverage],
  ["relations.forcedOnAmbiguous", r => r.relations?.forcedOnAmbiguous, "lower"],
  ["zones.precision", r => r.zones?.precision], ["zones.recall", r => r.zones?.recall],
  ["zones.falseZoneInventions", r => r.zones?.falseZoneInventions, "lower"],
  ["facts.fabricatedStrong", r => r.facts?.fabricatedStrong, "lower"],
  ["facts.expectedPresent", r => r.facts?.expectedPresent],
];

export function adversarialGate({ results, refusals = [], baseline, known, filtered = false }) {
  const blocking = [], knownFails = [], improvements = [], regressions = [];
  const baseById = new Map((baseline?.results || []).map(r => [r.planId, r]));
  const knownById = new Map((known?.fails || []).map(k => [k.planId, k]));

  for (const r of refusals) blocking.push(`REFUSED ${r.planId}: ${r.why}`);
  for (const r of results) {
    if (r.error || r.timedOut) { blocking.push(`ERROR ${r.planId}: ${r.error || "timed out"}`); continue; }
    if (r.pageErrors?.length) blocking.push(`ERROR ${r.planId}: ${r.pageErrors.length} page error(s) during detection`);

    const codes = r.verdict?.status === "FAIL" ? (r.verdict.failCodes || ["UNCODED"]) : [];
    const entry = knownById.get(r.planId);
    const listed = new Set(entry?.codes || []);
    for (const code of codes) {
      if (listed.has(code)) knownFails.push({ planId: r.planId, code, why: entry.why, owner: entry.owner, ref: entry.ref });
      else blocking.push(`NEW FAIL ${r.planId} ${code}: ${r.verdict.fail[r.verdict.failCodes?.indexOf(code) ?? 0] || code}`);
    }
    for (const code of listed)
      if (!codes.includes(code))
        blocking.push(`STALE KNOWN ${r.planId} ${code}: listed in KNOWN-FAILS.json but no longer produced — remove it, so its return is caught`);

    const b = baseById.get(r.planId);
    if (!b) { blocking.push(`UNBASELINED ${r.planId}: no baseline to compare against — record one deliberately`); continue; }
    for (const [name, get, dir] of GUARDED) {
      const now = get(r), was = get(b);
      if (now == null || was == null || now === was) continue;
      const better = dir === "lower" ? now < was : now > was;
      const line = `${r.planId} ${name}: ${was} -> ${now}`;
      if (better) improvements.push(line);
      else { regressions.push(line); blocking.push(`REGRESSED ${line}`); }
    }
  }
  // Only an unfiltered run is expected to cover the baseline; `a8` alone is a
  // legitimate way to look at one fixture.
  if (!filtered)
    for (const planId of baseById.keys())
      if (!results.some(r => r.planId === planId) && !refusals.some(r => r.planId === planId))
        blocking.push(`MISSING ${planId}: in the baseline, not scored by this run`);
  // A listed fixture that did not run cannot be checked either way; say so
  // rather than let the entry sit unexamined.
  if (!filtered)
    for (const planId of knownById.keys())
      if (!results.some(r => r.planId === planId))
        blocking.push(`STALE KNOWN ${planId}: listed in KNOWN-FAILS.json but not scored by this run`);

  return { pass: blocking.length === 0, blocking, knownFails, improvements, regressions };
}
