---
name: merit-ci-quality-gates
description: The CI honesty contract for MERIT ENTERTAINMENT — EVENT MAKER. Classifies every automated check as INFO, WARNING or RELEASE GATE, and documents the two live mechanisms by which CI is currently green while real quality checks fail. Use before trusting a green CI, before classifying a check, and before claiming a CI or test-discipline score.
---

# MERIT CI Quality Gates

A green CI badge is a claim. This skill decides when that claim is true.

## THE RULE THAT DECIDES THIS DIMENSION

> **GREEN CI ≠ all quality passed.**

At `65ea956` this is not a hypothetical. There are two live mechanisms by
which CI reports success while real checks fail, and **both are green right
now**. Anyone scoring this dimension must read them before assigning a
number.

### Mechanism 1 — the adversarial runner ignores FAIL verdicts

`benchmarks/adversarial/run-adversarial.mjs` computes a per-fixture verdict
of PASS / PARTIAL / **FAIL**, where FAIL is reserved for output that is
*actively wrong* — a confident claim that is false, a phantom table on the
floor. It then sets a non-zero exit code here, and only here:

```js
if (regressions) process.exitCode = 1;
```

`regressions` counts **fields that got worse than the frozen baseline**. The
FAIL verdicts are not consulted. Three of the eight fixtures
(`a2-mixed-families`, `a5-architecture-only`, `a6-architectural-confusion`)
are FAIL, those FAILs are inside the frozen baseline, and so the run exits 0
forever. CI is green while three fixtures are actively wrong.

**This is defensible as a regression gate and indefensible as a quality
gate.** The script is doing what it was built to do; the error is reading
its green as "adversarial passed".

### Mechanism 2 — a real gate wrapped in `continue-on-error`

`benchmarks/memory/measure-memory.mjs` enforces genuine thresholds and exits
non-zero when they are unmet:

```js
if (!gatesMet) process.exitCode = 1;
```

`.github/workflows/ci.yml` runs it as:

```yaml
- name: Visual Plan Memory (measured, not gated)
  continue-on-error: true
```

The step name is honest — "measured, not gated" says exactly what is
happening. But the effect is that a real threshold failure cannot turn CI
red. This is the **only** `continue-on-error` in the workflow, and it wraps
the one script that self-gates.

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

### Current classification, measured at `65ea956`

| Check | Class today | Can it turn CI red? |
|---|---|---|
| `npm test` / `test:all` | RELEASE GATE | Yes — exit code is the verdict |
| `verify:offline` | RELEASE GATE | Yes |
| `benchmark:baseline` | RELEASE GATE | Yes, on per-field regression |
| `benchmark:adversarial` | **regression gate only** | Only on regression — **not** on FAIL verdicts |
| `benchmark:memory` | **INFO in practice** | No — `continue-on-error: true` |
| Performance suites | RELEASE GATE | Yes |
| Benchmark report upload | INFO | No |

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
2. **A decision on the adversarial runner**: either FAIL verdicts become
   release-blocking, or the three known-FAIL fixtures are explicitly
   accepted in writing with a reason and an owner. Silence is not an option
   — right now the green implies a pass nobody decided to grant.
3. **A decision on the memory gate**: unwrap it, or reclassify it as INFO
   honestly and say so in the quality report.
4. **No new `continue-on-error`** without a class and a reason.
5. **Test-suite integrity**: no skipped tests, no lowered thresholds, and
   each structural suite carrying a recorded mutation proof.

## Scoring (from `merit-quality-program` §14)

- **Minimum gate** — every quality area classified INFO / WARNING / RELEASE
  GATE, written down.
- **9** — every RELEASE GATE can actually turn CI red, and no
  `continue-on-error` wraps one.
- **10** — plus a green run provably implies every release gate passed.

While mechanisms 1 and 2 stand undecided, this dimension cannot exceed
**6**: the pipeline is real and thorough, and its green does not yet mean
what a reader assumes.
