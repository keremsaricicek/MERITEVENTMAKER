---
name: merit-plan-reliability
description: The reliability contract for MERIT EVENT MAKER's Plan Intelligence — abstention, identity safety, adversarial fixture verdicts, false positives, and the rule that a wrong confident answer is worse than UNKNOWN. Distinct from detector accuracy. Use before changing detection behaviour, before interpreting an adversarial result, and before claiming a plan-intelligence reliability score.
---

# MERIT Plan Reliability

Accuracy asks *how many objects did we find*. **Reliability asks: when we
are wrong, how wrong are we, and did we say so?** Those are different
questions with different evidence, and this file owns the second.

`.claude/skills/merit-plan-intelligence/SKILL.md` owns the domain contract
and the AI-truthfulness rules. This file owns what happens at the edge of
what the detector knows.

## THE LAW

> **A WRONG CONFIDENT ANSWER IS WORSE THAN UNKNOWN.**

An operator who is told "this table could not be read" checks it. An
operator told "Table 14, 10 seats" when it is Table 41 with 8 seats seats
two parties wrong and finds out at 21:00. The second failure is more
expensive than the first even though it looks better in a benchmark.

Every design decision in this layer follows from that sentence. When a
change makes the detector more confident, the question is not "is it more
often right?" but "**what does it now claim that it cannot support?**"

## Where this dimension actually stands

Measured at `65ea956`, `npm run benchmark:adversarial`:

| Verdict | Count | Fixtures |
|---|---|---|
| PASS | 1 | `a3-no-anchors` |
| PARTIAL | 4 | `a1-chair-under-table`, `a4-multi-room`, `a7-dense-overlap`, `a8-large-venue` |
| **FAIL** | **3** | `a2-mixed-families`, `a5-architecture-only`, `a6-architectural-confusion` |

FAIL in this harness means **actively wrong output** — a confident claim
that is false, or a phantom object placed on the floor. Not "scored low."

**These three do not turn CI red.** The runner exits non-zero only on
regression against a frozen baseline that already contains them — see
`merit-ci-quality-gates` §Mechanism 1. So the three FAILs are, right now,
silently accepted by the pipeline.

## The rule about known FAILs

> **"Baseline unchanged" is not success when the baseline contains a FAIL.**

A frozen baseline answers *did this change make things worse*. It cannot
answer *is this good enough to ship*. Reporting "no regressions" on a
detector with three actively-wrong fixtures is true and misleading in the
same sentence — and this skill exists partly to stop that sentence being
written.

Each FAIL must end in one of two states, never a third:
1. **Fixed** — the fixture passes, measured.
2. **Accepted in writing** — with the reason, the operator-visible
   consequence, and an owner. Recorded in `benchmarks/`, not in a commit
   message.

"Known issue" without one of those is the third state, and it is not
allowed.

## What reliability requires

### Abstention is a feature
- `UNKNOWN` must be reachable and must be *used*. A pipeline that never
  abstains is not confident, it is unfalsifiable.
- An abstention is surfaced in the product's own vocabulary — "DOMAIN MODEL
  NOT INSTALLED", "could not read", "needs review" — never as a silent
  absence and never as a confident default.
- Confidence must be earned. A number attached to a guess is a fabricated
  metric and is forbidden by `.claude/rules/ai.md`.

### Identity safety
- A table's identity comes from a **verified printed number** first,
  position second, and **visual similarity never**.
- AMBIGUOUS applies to nothing. If identity is uncertain, no lesson, no
  memory application, no propagation.
- A venue-wide lesson acts only where the object carries the same verified
  printed number.
- A remembered correction must not leak between plans (`plan-memory-isolation`).

### The failure modes the fixtures exist to catch
Architecture read as furniture · mixed furniture families collapsed into one
· dense overlap merged or double-counted · large venues silently truncated
by a cap · symbolic plans treated as physical · a capacity rule claimed from
OCR nothing corroborates · a transformed plan's memory applied to the wrong
object.

### Caps must be visible
If `MAX_TABLES` or any cap truncates the result, the product says so. A
large venue quietly returning its first N tables is the most dangerous
failure in this list, because the output looks complete.

### No sample-specific logic
Guarded by `no-sample-specific-runtime-logic`. The product must understand
the *language* of a plan, never recognise the *identity* of an image. Any
branch keyed to a known sample is a defect regardless of the numbers it
improves.

## Evidence, and its ceiling

Required: `benchmark:adversarial` · `benchmark:baseline` (every guarded
field, per plan) · `benchmark:memory` · `benchmark:false-positives` ·
`symbolic-plan-detection` and the other real-detection suites.

**And the honest limit:** this product has **two real venue plans**. Eight
synthetic adversarial fixtures are constructed probes, not a population.
The fixture runner says so itself — *"SYNTHETIC ADVERSARIAL FIXTURES — NOT
REAL VENUES. REAL DISTINCT VENUE PLANS: 1."*

No amount of fixture work changes that. A third independent real plan is the
only thing that raises the ceiling, and until one exists this dimension is
bounded however green the fixtures go.

## Tuning discipline

Detector changes are **measured, never asserted** (`.claude/rules/testing.md`).

- Run `npm run benchmark` and compare per field, per plan. A trade — chair
  recall up, table F1 down — is invisible in a single score and is a revert,
  not a win.
- **Diagnose before theorising.** `benchmarks/heldout/ornek-stage-walk.mjs`
  names the stage each missed object died at. Phase 6 guessed three causes
  and measurement contradicted two.
- Never tune to a fixture. Fixtures detect overfitting; tuning against them
  destroys that.

## Scoring (from `merit-quality-program` §8)

- **Minimum gate** — no fabricated object; abstention available; identity
  never asserted on resemblance alone.
- **9** — zero FAIL fixtures, and every remaining PARTIAL is a *named,
  understood* limitation.
- **10** — plus a third independent real plan, measured, with no
  sample-specific runtime logic.

With three FAIL fixtures open, this dimension cannot exceed **6**, and
**10 is unreachable** until a third real plan exists. Say that plainly
rather than scoring around it.
