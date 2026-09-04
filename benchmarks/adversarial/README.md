# Eight layouts this system had never been allowed to fail on

```
node benchmarks/adversarial/make-fixtures.mjs        # regenerate the eight images + declarations
npm run benchmark:adversarial                        # score the current build against them
npm run benchmark:adversarial -- --compare           # against the frozen baseline, field by field
npm run benchmark:adversarial -- a7                  # one fixture
node benchmarks/adversarial/run-adversarial.mjs --freeze          # (re)freeze, deliberately
node benchmarks/adversarial/run-adversarial.mjs --record-baseline # replace BASELINE.json
```

> **SYNTHETIC ADVERSARIAL FIXTURES. NOT REAL VENUES.**
> They do not count toward **REAL DISTINCT VENUE PLANS: 1**. The learned encoder
> is never trained on them. No threshold is tuned to an individual fixture and
> no code branches on a fixture id. Their scores never enter the real-plan
> aggregates in `benchmarks/BASELINE.json`.

## Why they exist

Every number in this repository came from one drawing and sixteen re-renderings
of it. That corpus can prove a change did not break what already worked. It
cannot separate the system's beliefs about **floor plans** from its beliefs
about **that floor plan** — and after several sprints of tuning against it, the
second set is the dangerous one.

The clearest example is the rule this suite was written to attack. The previous
sprint added a gate: *a table whose every detected seat centre lies inside its
own body is not a table*. Measured on the Golden Plan it removed 158 invented
tables and zero real ones, which is a genuinely good result, and it encodes a
belief about how banquet furniture is drawn. `a1` draws the counterexample the
belief forbids — chairs tucked under, which is how a plan shows a set table
nobody is sitting at — and the gate deletes half the room.

So these are not decorative plans. Each is a **hypothesis** about an assumption
the build might be carrying, drawn so that the assumption, if present, produces
a visible wrong answer. **A fixture everything passes on the first run taught us
nothing.** The useful output of the first run was a list of five failures.

## The freeze is mechanical

```
CREATE  ->  FREEZE  ->  RUN THE UNTOUCHED BUILD  ->  RECORD  ->  only then change inference.
```

A fixture that can be edited after its first result is not a test, it is a
mirror. `FROZEN.json` holds the sha256 of every image **and** every declaration.
`run-adversarial.mjs` refuses to score a fixture whose bytes have moved, and a
missing `FROZEN.json` is itself a refusal rather than a skipped check. Changing
a fixture is allowed — regenerate, re-freeze — but it is a deliberate act that
shows up in the diff, and it cannot happen quietly in the middle of tuning.

## What each one is for

| id | hypothesis under test |
|---|---|
| **a1** chair-under-table | the seat-containment gate is over-general; a plan drawn with chairs tucked under must still keep its tables |
| **a2** mixed-families | plan-relative size reasoning deletes minority furniture families; five table families and four chair families must all survive |
| **a3** no-anchors | hallucination — a plain dining room with no stage, bar, lounge or entrance must produce none of them |
| **a4** multi-room | zone clustering is distance-only and cannot see a wall; two halls joined by a corridor must not become one room |
| **a5** architecture-only | the system has never had to say "nothing"; a shell drawing must yield no tables, no seats and no capacity |
| **a6** architectural-confusion | repetition at a consistent size is read as furniture; repeated architecture that outnumbers the furniture must not become tables |
| **a7** dense-overlap | association is nearest-table-within-reach and has never had to choose, or to decline to |
| **a8** large-venue | every measurement so far was taken on 46 tables; at 324 tables and 3,240 seats everything still has to complete |

Every declaration carries `hypothesis`, `expectedFacts`, `forbiddenFacts`,
`forbiddenZoneTypes`, ground-truth objects, ground-truth chair→table relations,
expected zones, and — where it applies — `minTableTypes`. Because the images are
generated, the ground truth includes three things a human annotator cannot
supply reliably: **which table each chair actually belongs to**, **which chairs
are genuinely ambiguous between two tables**, and **which way each chair faces**.
That is what the synthetic-data cost buys here.

### Ambiguity is part of the ground truth

`a7` row B draws five chairs **exactly** halfway between two identical tables.
Their ground truth is `belongsTo: null`. There is no correct answer, and a
confident one is wrong even when it names the table a person would have guessed.
The benchmark scores that separately:

- `forcedOnAmbiguous` — attached to a table with no ambiguity declared. The
  failure.
- `ambiguousDeclared` — attached **and flagged**. Allowed: the seat is real, so
  dropping it would lose capacity; what must not happen is a silent answer.

## The verdict rules

Nothing in the scorer knows which fixture it is looking at.

**FAIL** — the output is actively wrong: a forbidden fact stated as `strong`, a
zone type the fixture forbids, a real table the pipeline found and then held
back, more phantom tables than real ones, or any furniture at all on a drawing
that has none.

**PARTIAL** — missing or degraded: recall below 0.9, a forbidden fact below
`strong`, a missing expected fact, a chair seated at the wrong table or at no
table, a table family that collapsed, zone precision below 0.5.

Two scorer bugs were fixed before the baseline was recorded, and they are worth
naming because both would have flattered the result. Recall was reported as `0`
on the fixture with no furniture, where it is 0 by arithmetic and means nothing.
And precision was not scored at all, so `a6` — whose entire purpose is false-
positive resistance — passed while proposing 46 phantom tables against 8 real
ones.

## The first run, on the untouched build

`BASELINE.json`. Recorded before one line of inference code was changed.

| fixture | verdict | what it found |
|---|---|---|
| a1 | **FAIL** | 8 of 16 real tables detected then **held back by `seatsInsideBody`**; 48 of 96 chairs left as orphans |
| a2 | **FAIL** | 7 real tables held back; 23 phantom tables against 21 real; bistro typed 0/6; chair recall **0.34** |
| a3 | PARTIAL | no invented anchors — but 240 chairs detected where 160 were drawn, and 5 zones for 1 room |
| a4 | PARTIAL | no invented anchors; zone precision **0.091** (11 typed zones for 3 rooms); bistro typed 0/8 |
| a5 | **FAIL** | correctly found no tables, then proposed **8 columns as chairs**; `capacityUnknown` never stated |
| a6 | **FAIL** | table precision **0.148** — 46 architectural false positives against 8 real tables |
| a7 | PARTIAL | table recall 0.724 (the touching block merged); bistro typed 0/7; chair recall 0.685 |
| a8 | **FAIL** | the `MAX_TABLES` cap reached (240 of 324) and **all 240 held back by `seatsInsideBody`** |

**5 FAIL, 3 PARTIAL, 0 PASS.**

The two most important lines in that table are `a1` and `a8`, and they are the
same defect. On `a8` the table and its ring of chairs merge into one component,
so the detected table box spans the ring, so every seat centre is inside it, so
the gate holds back the entire venue. A rule measured on one plan, where it was
right 158 times and wrong none, is wrong 248 times here.

None of that is visible in `benchmarks/BASELINE.json`, which is still green on
all 31 guarded fields, because the Golden Plan does not contain any of these
situations. That is the whole argument for this directory.
