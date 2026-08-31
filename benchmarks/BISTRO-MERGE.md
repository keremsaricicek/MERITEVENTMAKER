# The bistro merge — a reproduced failure and one rejected fix

```
node benchmarks/make-adversarial-fixtures.mjs   # regenerate the fixture + truth
node benchmarks/run-benchmark.mjs bistro        # measure
```

## The failure

Every one of the five remaining table misses on the real venue plan is a
bistro table: 46×40px, two chairs pulled tight against opposite edges. The
nearest detection sits 83–133px away against a 47px match tolerance.

`benchmarks/fixtures/adversarial-bistro.png` reproduces that regime outside the
one real plan: 18 square tables at the real plan's scale with four separated
chairs each, setting the modal object size, and 5 bistro tables whose chairs
touch the table body. Every box is exact by construction.

It reproduces the failure with the same signature:

```
TABLES   gt=23 det=18 TP=18 FP=0 FN=5 P=1 R=0.783 F1=0.878
TYPES    square 18/18
```

18 of 18 squares, 0 of 5 bistros — recall lost entirely on the minority family
while the majority scores perfectly.

## What is actually happening

The earlier note in this repository said the bistros were "never proposed".
That was wrong, and the fixture shows why. They **are** proposed. All 23
candidates reach the fragment-suppression stage, and the 5 bistros are deleted
there with exactly three reasons:

```
size disagrees with the plan's modal object (0.24)
aspect 1.16 against plan modal 1.00
no seat adjacency
```

Three reasons is the deletion threshold. All three are measured against a
single plan-wide modal, so a minority furniture family disagrees on every axis
at once **by construction**.

The third reason is the interesting one, and it is a compounding failure: a
bistro's two chairs touch its edges, so table and chairs come through as one
component and the chair pass has nothing separate to propose. One missed chair
pair deletes a real table.

## The fix that was tried and rejected

**Hypothesis:** repetition is counter-evidence. A fragment is a one-off shard
cut out of linework; five identical boxes in a row are a family the plan
happens to also contain. So a repeated *whole* component (never one the
valley-split cut out) should need one more reason before it is dropped.

**Result:** fixed the fixture, broke the real plan.

| | before | after |
|---|---|---|
| bistro fixture FN | 5 | **0** |
| bistro fixture F1 | 0.878 | **1.000** |
| real plan FP | 6 | **13** |
| real plan F1 | 0.882 | **0.820** |

Reverted, per the sprint rule that a change which trades one metric for
another is a revert rather than a new number.

**Why it cannot be rescued by tightening "repetition".** The 7 fragments it
spared on the real plan are as tight a family as the real bistros are, on
every axis available:

| | real plan, spared (all FP) | bistro fixture (real tables) |
|---|---|---|
| repetition within 8% | 7 of 7 | 5 of 5 |
| dimensions | 55×26, 56×26, 54×26 | 44×38 |
| seats | 0 | 0 |
| source | tone | tone |
| cut from a merged blob | no | no |
| sizeAgreement | 0.35–0.46 | 0.24 |

The only axis that separates them is aspect — 2.1 against 1.16 — and this
filter deliberately refuses to use aspect as an absolute threshold, because a
banquet hall of 2.4-aspect rectangle tables would lose every real table it has.

So: **repetition does not distinguish a minority furniture family from a
repeating fragment family.** Do not re-run this experiment.

## Where the fix actually belongs

The axis that *does* separate the two cases is already in the filter: seats.
The bistros have two chairs each and score zero only because those chairs
merged into the table's own component. The real plan's 7 spared fragments have
no chairs at all and never will.

Recovering merged chairs would give the bistros seat adjacency — two reasons,
below the bar, kept — and leave the seven fragments exactly where they are. No
change to the suppression rule is needed, and none should be made.

That is upstream work in the chair pass: for a table candidate with no
associated seats, look for chair-sized sub-regions of chair colour at the edges
of its own component, rather than only among components the chair pass already
separated. It is not attempted here, and the fixture stays red until it is.

The baseline in `BASELINE.json` records `fn=5` for this fixture on purpose. It
is a regression fixture holding a known, unfixed failure: when the chair pass
recovers merged chairs, this file's number moves and `npm run benchmark:baseline`
reports it as an improvement.
