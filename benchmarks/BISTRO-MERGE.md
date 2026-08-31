# The bistro merge — one reproduced failure, one rejected fix, one that worked

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

It reproduced the failure with the same signature — 18 of 18 squares, 0 of 5
bistros, recall lost entirely on the minority family while the majority scored
perfectly:

```
TABLES   gt=23 det=18 TP=18 FP=0 FN=5 P=1 R=0.783 F1=0.878
```

It now scores 23/23. What follows is how, including the attempt that failed.

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

## Where the first fix would have belonged, and did

The axis that *does* separate the two cases is already in the filter: seats.
The bistros have two chairs each and scored zero only because those chairs
merged into the table's own component. The real plan's 7 spared fragments have
no chairs at all and never will. So the work belonged upstream, in the chair
pass — and that is what was done next.

## The fix that worked

The chairs were not missing from the masks at all. They were dropped by a
**third** global-modal decision: the chair-shape uniformity test. Chairs are
accepted when their elongation matches the plan's modal chair shape within a
factor of 1.6. The square tables' chairs are near-square (elongation ~1.00); a
bistro chair squeezed against the table edge measures ~1.69. Just outside. All
ten were discarded, which left the bistro tables with no seat adjacency, which
supplied the third reason the fragment filter needed to delete the tables.

The chair test now allows a **second** elongation mode — computed on the chairs
the primary mode rejects, and admitted only when it is a substantial,
self-consistent population (at least 4 chairs, at least 6% of the chair
population, and at least 60% of the residual). A handful of odd shapes stays
rejected, which is what the uniformity test is for.

| | before | after |
|---|---|---|
| bistro fixture tables | 18/23, FN 5 | **23/23, FN 0** |
| bistro fixture chairs | 72 of 82 | **82 of 82** |
| bistro fixture F1 | 0.878 | **1.000** |
| bistro fixture review groups | 0 | 1 |
| real plan chairs | 79 of 105 | **87 of 105** |
| real plan table TP / FN | 41 / 5 | 41 / 5 |
| real plan table FP | 6 | **7** |
| real plan F1 | 0.882 | **0.872** |
| real plan review groups | 8 | **12** |

### The regressions, and why they were accepted

**The seventh false positive is not a spurious blob.** It sits at (123,208),
45x99px, carrying 3 chairs, and its nearest ground-truth object is
`table/bistro "t43"` — 51px away against a 47px match tolerance. The detector
has started seeing the bistro region it was previously blind to, and proposes
it as one tall merged box rather than two separate bistro tables. That is a
different, later failure — the merge/split step, not the chair pass — and it
scores as a false positive because the box does not resolve into individual
tables.

**Operator effort rose**, and that is the cost worth stating plainly: review
groups on the real plan went from 8 to 12, roughly 50% more bulk-review work on
this plan. It follows directly from finding 8 more chairs and one more table —
there is genuinely more to look at — but it is a cost, not a free win, and it
belongs in the summary rather than out of it.

Accepted as a deliberate trade and re-recorded in `BASELINE.json`:

- **gained** — an entire failure mode on the fixture (0 of 5 bistro tables to
  5 of 5), and +8 real chairs (75% to 83% of the annotated 105).
- **cost** — one merged proposal an operator can split or reject, and four more
  review groups. Table true positives and misses are unchanged.

This is not the "chair recall up, table F1 collapses" trade the sprint rules
say to revert. That one was measured twice, at 0.882 to 0.543 and 0.882 to
0.820, and reverted both times. This is 0.882 to 0.872 with the table count
itself untouched.

## What is still open

The real plan's five bistro misses remain misses. Their chairs are now found
and the region is now proposed, but as one merged box rather than separate
tables. The remaining work is in the valley-split step, which does not cut this
blob — a different problem from the one this file documents.

The recurring pattern across all three findings here is worth stating on its
own: **this pipeline makes several independent global-modal decisions — table
size, table aspect, chair shape — and each one deletes minority families by
construction.** Two of the three were found this way. The third (aspect) is
still there, still unaddressed, and still the reason a hall of rectangle tables
mixed with round ones has not been tested.
