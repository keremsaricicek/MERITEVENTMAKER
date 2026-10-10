# Gates C/D — text and architectural false-positive suppression

```
node benchmarks/make-adversarial-fixtures.mjs        # regenerate fixtures + ground truth
node benchmarks/run-benchmark.mjs                    # measure
MERIT_BENCH_NO_FRAGMENT_FILTER=1 node benchmarks/run-benchmark.mjs   # pre-suppression baseline
```

The A/B switch measures both sides on the same build, so the table below is
two runs of one binary rather than a comparison against remembered numbers
from reverted code.

## Measured before / after

| fixture | metric | before | after |
| --- | --- | ---: | ---: |
| **merit-real-venue** | table false positives | **41** | **6** |
| | precision | 0.500 | **0.872** |
| | F1 | 0.641 | **0.882** |
| | recall | 0.891 | 0.891 |
| | true positives | 41 | 41 |
| | chairs detected | 79 | 79 |
| | review groups the operator must clear | 13 | **8** |
| | questions | 15 | 12 |
| **adversarial-dense** | detections on printed text | **24** | **0** |
| | phantom "stage" objects | **3** | **0** |
| | review groups | 8 | **0** |
| | tables | 24/24, F1 1.0 | 24/24, F1 1.0 |
| **adversarial-text** | everything | F1 1.0, 0 FP | unchanged |
| **adversarial-architecture** | everything | F1 1.0, 0 FP | unchanged |

Recall did not move on any fixture. That is the point of the check: every one
of these suppressions can "succeed" by deleting furniture, and the same images
score recall.

## The fixtures

`make-adversarial-fixtures.mjs` generates three images and emits their ground
truth. Because the images are drawn from the spec, every box is exact by
construction — `annotationMethod: "constructed"` — so a detection inside a text
or architecture region is unambiguously wrong, with no question of whether an
annotator missed something.

- **adversarial-text** — 12 square tables buried in a title block, capacity
  legend, scale bar with ticks, north arrow, legend swatches, three lines of
  small notes, and a printed number beside every table.
- **adversarial-architecture** — 10 round tables among double-line perimeter
  walls, partitions, six columns, two door leaves with swing arcs, an
  eight-tread staircase, a hatched service area, and nine window mullions.
  Columns are annotated as *objects* (legitimate venue furniture); walls, doors,
  stairs, hatching and mullions are *regions* where any detection is wrong.
- **adversarial-dense** — the hard one. Greyscale, so the chair-first colour
  clustering cannot engage; 24 tables spaced 12px apart so the blob stage
  merges them and the valley-split step must guess boundaries; walls cutting
  through the seating field; filled service blocks at table scale; room labels
  drawn as large as a table.

**The first two scored F1 = 1.0 before any of this work and still do.** They
were built to be adversarial and are not. They earn their place as regression
guards — they prove a suppression rule does not break an easy plan — but the
failures were only reproducible once `adversarial-dense` existed. Stating that
plainly matters more than presenting three fixtures as if all three drove the
result.

## What the 41 false positives actually were

Diagnosed before writing any rule, by matching detections to ground truth and
comparing the two populations:

| | real (n=41) | fragments (n=41) |
| --- | --- | --- |
| aspect ratio | 1.00–1.12 | 1.18–2.69 (median 1.55) |
| size agreement with plan modal | median 0.99 | median 0.39 |
| came from the valley-split step | 0/41 | 28/41 |
| mask source | tone 41/41 | fill 28, tone 13 |
| classified type | square/round | rectangle 39/41 |

They were fragments cut out of merged linework, not text or walls.

## The three rules, and why each is shaped the way it is

### 1. Fragment suppression (`fragmentSuppression` in diagnostics)

`aspect > 1.18` separates the two populations on this plan **perfectly**. It is
also worthless: a banquet hall of 2.4-aspect rectangle tables would lose every
table it has. Nothing here is an absolute threshold.

A plan states its own furniture vocabulary — a modal size and a modal aspect —
and each candidate is judged against *that*. On a rectangle-table plan the modal
aspect simply becomes 2.4 and rectangles read as normal.

A candidate is dropped only when it disagrees with that vocabulary on **three
independent axes at once** (came from a split, size disagrees, aspect
disagrees, no seat adjacency). One odd axis is an unusual real object; three is
a fragment. Measured: removes 35/41 fragments, 0/41 real tables.

It self-disables if it would remove more than 45% of the plan, or if there are
fewer than 8 candidates to derive a vocabulary from — the same guard shape the
surface-coverage filter already uses — and reports which happened.

### 2. Text-glyph suppression without OCR (`textGlyphChairsDropped`)

On a plan with no colour separation the chair detector reads the letters of a
room label as seats: 24 phantom chairs on the dense fixture, every one a letter
of `BALLROOM B` / `96 PAX` / `ZONE A` / `ZONE B`.

The existing OCR-based suppression cannot help, because it requires Tesseract
and the offline build may not have it — in this sandbox OCR reports
`available: false` and that path never runs at all. But text does not have to be
*read* to be recognised as text: a word is a run of marks on a shared baseline
with gaps smaller than the marks are wide.

The first hypothesis for separating a word from a row of seats was shape
variation — letters differ in width, seats do not. **The measurement rejected
it**: glyph runs came back at cv 0.08 against 0.03 for seats, far too close to
separate on. It is left out rather than tuned into place.

What does separate them is the domain fact that a seat serves a table.
Measured distance from a run to the nearest detected table, in mark-widths:

| | glyph runs | real unassociated seats |
| --- | --- | --- |
| distance to nearest table | 5.12 – 13.93 | 0.09 – 0.12 |

Two orders of magnitude apart. The threshold of 2.0 sits in an empty gap rather
than against either distribution. Only *unassociated* marks are eligible — a
seat the associator tied to a table is never touched — and a run must be at
least 4 long.

An earlier version of this rule without the distance test removed 13 real
chairs from the real plan. The benchmark caught it; that is why the rule has
the shape it has.

### 3. Merged-row venue suppression (`mergedRowVenuesDropped`)

Three 511×102 "stages" at aspect 5.0 on the dense fixture were each exactly one
row of six tables plus their seats — the merged blob the tables were cut out of.
A venue-scale blob that geometrically *contains* two or more detected table
centres is not a stage. This needs no threshold: either real table centres sit
inside the box or they do not.

## Known gaps, not fixed here

Stated rather than left for someone to discover:

- **Columns are not detected at all.** The architecture fixture annotates six
  and scores `column TP0/FP0/FN6`. They are not misclassified as tables — they
  are simply not found.
- **Chair detection collapses in greyscale.** The dense fixture has 96
  constructed chairs and detects 0. The chair-first path depends on colour
  clustering; the luma fallback does not recover seats at that scale.
- **The real plan still detects 79 of 105 annotated chairs** and misses 5 of 46
  tables, with 6 false positives remaining.
