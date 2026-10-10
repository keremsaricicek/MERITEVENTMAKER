---
name: merit-ci-quality-gates
description: The CI honesty contract for MERIT ENTERTAINMENT — EVENT MAKER. Classifies every automated check as INFO, WARNING or RELEASE GATE, and records the five mechanisms by which CI was once green while real quality checks could not fail — or measured a different product from the one recorded — and what closed each. Use before trusting a green CI, before classifying a check, and before claiming a CI or test-discipline score.
---

# MERIT CI Quality Gates

A green CI badge is a claim. This skill decides when that claim is true.

## THE RULE THAT DECIDES THIS DIMENSION

> **GREEN CI ≠ all quality passed.**

Five mechanisms made CI report success while real checks could not fail, or
made its numbers mean something other than what was recorded. Two were
written down here at `65ea956`; §27 of the master programme measured the
pipeline itself and found three more. All five are closed, and
`tests/suites/ci-gate-honesty.test.mjs` feeds each gate's decision function
every case, so reopening one fails the regression suite.

### Found, and closed in §27

| # | Mechanism | What it meant | Closed by |
|---|---|---|---|
| 1 | The adversarial runner set a non-zero exit only on a field regression — never on a FAIL verdict — **and CI ran it without `--compare`**, so in CI it compared nothing at all. | The step could fail on nothing short of a crash while `a2` and `a6` were FAIL: phantom tables on the floor plan. | `benchmarks/adversarial/gate.mjs`, run by CI as `-- --compare`. Blocks on a regression, a FAIL code not listed in `KNOWN-FAILS.json`, a listed code that stopped occurring, a fixture missing, unbaselined, refused or erroring. |
| 2 | Visual Plan Memory's threshold check ran under `continue-on-error`. | It could not fail. A change that doubled wrong applications showed the same yellow as today. The committed `report.json` no longer matched what CI measured (196 scoreable decisions committed, 182 measured). | `--compare` against `benchmarks/memory/BASELINE.json`: a regression gate that can fail, with the §23 thresholds printed as NOT MET on every run. No `continue-on-error` remains in the workflow. |
| 3 | `benchmark:baseline` compared whatever `benchmarks/reports/latest.json` held — a committed file — and a plan missing from the run was a "note". | Run on its own it printed "No regressions" about code it had never measured (entry K of `benchmarks/MASTER-PROGRAMME-STATE.md`). | Every report carries a digest of what it measured (`benchmarks/lib/source-digest.mjs`); the compare and `--record` both refuse a report whose digest differs from the checkout. A missing plan is a regression. |
| 4 | `npm run perf` listed `stress-4000-seats.mjs` as a profiler. | Its reload-integrity assertion (400 tables, 4,000 chairs, 3,000 guests, 500 assignments survive a reload) could exit 1 and the run still passed. | Marked `asserts: true`; the suite fails if any runner that can exit non-zero is not. |
| 5 | The benchmark runners loaded the OCR engine and its language data from jsDelivr. CI could reach it; the development container could not. | Two different products measured under one name. With OCR, `a2` has 3 phantom tables; without, 23. Memory: 182 decisions against 196. Every number committed from the container — including both old baselines and the `a2`/`a6` diagnoses — described the app without OCR, while CI gated the app with it. | `tests/lib/vendor.mjs` pins the OCR packages; `launchChromium` serves every CDN engine from `.vendor-cache` and sends nothing to the network, and refuses to start without OCR. `npm run vendor:test` fetches the pins. Both baselines re-recorded with OCR after their numbers were checked equal to CI's. |

## The classification every check must carry

| Class | Meaning | Turns CI red? |
|---|---|---|
| **INFO** | Reported for humans. Trend data, diagnostics, exploratory measurement. | No |
| **WARNING** | Should be looked at; not yet a blocker. Must have a written path to becoming a gate, or be demoted to INFO. | No |
| **RELEASE GATE** | The product must not ship if this fails. | **Yes** |

Rules:
- **Every check has exactly one class**, written down.
- **A RELEASE GATE may never be wrapped in `continue-on-error`.** If it is
  wrapped, it is not a gate — reclassify it or unwrap it, but do not report
  it as gated.
- **A RELEASE GATE must be able to turn CI red.** Confirm by reading the
  script's exit semantics, not the step's name.
- **WARNING is not a parking space.** A check that sits in WARNING
  indefinitely is INFO with better marketing.

## The classification of every CI check

Every `npm` command `.github/workflows/ci.yml` runs has a row here; the suite
`ci-gate-honesty` fails when one does not. Classified by reading each script's
exit semantics, not its step name.

| Command | Class | What turns it red |
|---|---|---|
| `npm test` | RELEASE GATE | any failed check in any fast suite; any console error or page error |
| `npm run test:slow` | RELEASE GATE | the same, for the suites that run real detection on the real plan |
| `npm run vendor:test` | RELEASE GATE | the pinned OCR engine or language data failing to download. Everything after it would otherwise measure a different product |
| `npm run build:offline` | RELEASE GATE | the build throwing. In the three jobs that only need it as setup, a failure there fails that job too |
| `npm run build:offline-full` | RELEASE GATE | the build throwing |
| `npm run verify:offline` | RELEASE GATE | the BUILT artifacts failing to boot, making an off-origin request, or failing real OCR (27 checks) |
| `npm run benchmark` | INFO | produces the report; exits 1 only when no annotation matched. The gate is the next row |
| `npm run benchmark:baseline` | RELEASE GATE | any guarded field worse than `benchmarks/BASELINE.json`, per plan; a baseline plan not scored; a report measured on different source (exit 2) |
| `npm run benchmark:adversarial -- --compare` | RELEASE GATE | see `benchmarks/adversarial/gate.mjs`. FAILs listed in `KNOWN-FAILS.json` are **INFO**: printed every run with reason and owner, never blocking, never described as passing |
| `npm run benchmark:memory -- --compare` | RELEASE GATE | anything worse than `benchmarks/memory/BASELINE.json`, above all one more wrong application. The §23 thresholds are **INFO**: printed as NOT MET every run; no setting reaches them (§9) |
| `npm run benchmark:review-order` | RELEASE GATE | its own listed failures (`failures.length`) |
| `npm run benchmark:facts` | RELEASE GATE | accuracy < 0.9, any fabricated STRONG fact, any untranslated fact |
| `npm run benchmark:contradictions` | RELEASE GATE | its own listed failures |
| `npm run benchmark:zones` | RELEASE GATE | stability < 0.9, a zone without evidence, seats exceeding capacity |
| `npm run benchmark:false-positives` | RELEASE GATE | the seat-containment gate holding back a real table it is not recorded as holding (per rendering, `KNOWN-FAILS.json`; a count below the record blocks too, until it is lowered), or any real table on the clean plan |
| `npm run benchmark:teaching` | RELEASE GATE | propagation precision, retention or wrong application outside its gates on an unchanged plan |
| `npm run perf` | RELEASE GATE for three runners, INFO for the rest | live-windowing correctness, 4,000-seat reload integrity, save-queue last-write-wins. Every timing is INFO — no budget exists, and none is invented |
| report uploads (`actions/upload-artifact`) | INFO | never |

What a green run therefore proves: every RELEASE GATE row passed. It does
**not** prove the two listed adversarial FAILs are fixed, that the
seat-containment gate holds no real table on the five photometric renderings
accepted in `benchmarks/false-positives/KNOWN-FAILS.json`, or that Visual Plan
Memory meets its §23 thresholds — all are printed as not so on every run.

## The prohibitions

These are the ways a CI dimension gets falsely scored, and all of them are
forbidden:

- **Lowering a threshold to get green.** The single most serious violation
  in this file. If a threshold is wrong, changing it is a deliberate,
  explained, separately-committed decision — never a step in making a build
  pass.
- **Re-freezing a baseline to absorb a regression.** Re-recording is a
  decision with a written reason, per `.claude/rules/testing.md`.
- **Skipping, deleting or quarantining a test** to get green.
- **Adding `continue-on-error` to a failing gate.**
- **Reporting a stale artifact as a measurement.** A `dist/`, baseline or
  report older than the code it describes proves nothing.
- **Reporting "CI green" as a quality result** without stating which classes
  that green covers.

## What a final programme must produce here

1. **A written classification of every check**, in this file, kept current.
   — done; enforced by `ci-gate-honesty`.
2. **A decision on the adversarial runner** — decided in §27: FAIL verdicts
   block, except the ones listed in `benchmarks/adversarial/KNOWN-FAILS.json`,
   each with its codes, reason, owner and where the open work is recorded.
   Listing is not acceptance of the output as correct; a listed FAIL that
   stops failing must be removed, so its return is caught.
3. **A decision on the memory gate** — decided in §27: unwrapped, and turned
   into a regression gate that can fail; the §23 thresholds are INFO and
   printed as NOT MET every run.
4. **No new `continue-on-error`** — there is none, and `ci-gate-honesty`
   fails if one appears.
5. **Test-suite integrity**: no skipped tests, no lowered thresholds, and
   each structural suite carrying a recorded mutation proof.

## Scoring (from `merit-quality-program` §14)

- **Minimum gate** — every quality area classified INFO / WARNING / RELEASE
  GATE, written down.
- **9** — every RELEASE GATE can actually turn CI red, and no
  `continue-on-error` wraps one.
- **10** — plus a green run provably implies every release gate passed.

Mechanisms 1–5 are closed, and a green run now implies every RELEASE GATE
row above passed. A green run still does not mean the listed adversarial
FAILs or the §23 memory thresholds are met, and the classification says so
in the same table a reader uses to interpret the green.
