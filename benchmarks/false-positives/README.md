# Every false positive, and why it survived

```
npm run benchmark:false-positives          # all weak renderings
npm run benchmark:false-positives hue-shift jpeg-q20
```

Writes `report.json` and one debug image per rendering in `debug/`: **green** true
positives, **red** false positives labelled with their cause, **orange** misses.
Exits non-zero if the seat-containment gate ever holds back a real table.

The robustness matrix says `hue-shift` invents 52 tables and `downscale-70`
invents 73 chairs. It does not say what those objects *are*, and without that any
fix is a threshold picked because it happened to move a number — indistinguishable
from a threshold tuned on the rendering's filename.

## The taxonomy

Every false positive gets exactly one cause, assigned in a fixed priority order
from evidence independent of the detector: the annotation's own text and
architecture regions, the annotated objects, and detected geometry.

### Tables

| variant | FP | causes |
|---|--:|---|
| ORIGINAL | 4 | 2 unplaced, 1 on-a-real-chair, 1 text |
| `hue-shift` | 52 | **45 on-a-real-chair**, 3 architecture-edge, 2 unplaced, 1 fragment, 1 text |
| `bright-up` | 48 | **42 on-a-real-chair**, 3 text, 2 architecture-edge, 1 fragment |
| `contrast-high` | 49 | **42 on-a-real-chair**, 4 text, 2 architecture-edge, 1 fragment |
| `blur` | 32 | **28 on-a-real-chair**, 2 unplaced, 1 text, 1 architecture-edge |
| `jpeg-q20` | 26 | 10 unplaced, 9 between-seats, 5 architecture-edge, 1 on-a-real-chair, 1 fragment |
| `noise` | 16 | 13 on-a-real-chair, 3 unplaced |
| `lowres-roundtrip` | 14 | 8 unplaced, 5 architecture-edge, 1 text |
| `grayscale` | 5 | 2 on-a-real-chair, 1 text, 1 architecture-edge, 1 unplaced |
| `bright-down` | 4 | 2 unplaced, 1 text, 1 architecture-edge |
| `downscale-70` | 4 | 2 on-a-real-chair, 1 text, 1 unplaced |

### Chairs

| variant | FP | causes |
|---|--:|---|
| `downscale-70` | 73 | **53 on-a-real-chair**, 14 between-seats, 4 text, 2 fragment |
| `grayscale` | 15 | 7 text, 5 fragment, 2 unplaced, 1 between-seats |
| everything else | ≤ 6 | mostly text and fragment |

**These are three different problems, not one threshold problem.** The four
tone-collapse renderings are dominated by one cause; `jpeg-q20` has almost none
of it; `downscale-70`'s failure is entirely in the chair pass.

## The structural finding

`on-a-real-chair` is 176 of the ~250 invented tables. Pooled evidence: **176 of
176 have seats**, **174 of 176 came from a split component**, and the top source
is `fill`. So the tone separation collapses, a chair merges with its
surroundings, and the table pass proposes a box around it.

The separator is topology, not a score:

> **A table's chairs stand around it, so their centres fall outside its
> outline. A box whose every seat lies inside itself is not a table with seats —
> it is a seat wrapped in a table.**

| | every seat inside its own box |
|---|---|
| **correctly detected tables** (424, across 11 renderings) | **0** |
| invented tables | **129** |

Not a low rate. Zero.

### The test that was wrong first

The first version paired the topology with "and the box is closer to the plan's
modal *chair* area than its modal *table* area", on the assumption that these
were chair-sized boxes. Measured, they are the opposite: median area 2470–2665
against 1886 for real tables — **bigger** than a table, not chair-sized. The
combined rule caught **nothing**. The area half was removed; the topology alone
is the whole signal.

## What the gate does — and does not do

It **deselects** and flags `lowEvidence`. It does not delete, reject, or
reclassify. The object stays on screen, keeps its seat, appears in the review
queue, and one click puts it on the floor plan.

That is not caution for its own sake. This is **one venue**. A drawing that
tucks its chairs under its tables would trip the same topology honestly, and
there is no evidence available here to say it wouldn't. Deselecting costs that
operator one confirmation; deleting would cost them a table they could see was
real.

The operator is told, in both languages, on the card and as a `RELATIONSHIP`
contradiction: the chair pass says *seat*, the table pass says *table with a
seat inside it*, and those cannot both describe one object.

## Proposed vs committed

Both numbers are reported, and the distinction is the point. A gate that moved
only the second while implying it moved the first would be hiding false
positives to improve F1.

| variant | proposed TP/FP | **committed** TP/FP | gate held (false/real) |
|---|--:|--:|--:|
| ORIGINAL | 46/4 | **46/3** | 1/0 |
| `hue-shift` | 38/52 | **37/11** | 39/0 |
| `contrast-high` | 37/49 | **37/9** | 35/0 |
| `bright-up` | 39/48 | **37/10** | 35/0 |
| `blur` | 37/32 | **37/15** | 16/0 |
| `jpeg-q20` | 45/26 | **23/11** | 0/0 |
| `noise` | 46/16 | **46/15** | 1/0 |
| `lowres-roundtrip` | 28/14 | **9/12** | 0/0 |
| `grayscale` | 43/5 | **43/3** | 2/0 |
| `downscale-70` | 41/4 | **41/3** | 0/0 |
| `bright-down` | 24/4 | **24/4** | 0/0 |

**Across all renderings: proposed FP 254 → committed FP 96. The gate held 129
false tables and 0 real ones.**

`benchmarks/robustness/` is unchanged row for row, because the detector still
proposes exactly what it proposed. That is the correct outcome for a review
gate and is why both tables exist.

## A pre-existing defect this surfaced

Separating the new gate from the confidence threshold that was already there:

| | held FALSE tables | held REAL tables |
|---|--:|--:|
| seat-containment gate (new) | **129** | **0** |
| confidence threshold (pre-existing) | 29 | **44** |

On `jpeg-q20` the threshold holds back **22 correct tables** to remove 15 false
ones, and on `lowres-roundtrip` **19** to remove 2. That is precisely the trade
this sprint forbids, and it predates it.

It is **not fixed**, and that is a measured decision rather than an omission.
Releasing a held candidate when it carries independent corroboration — seats
found by the chair pass, or membership in a repeated size family — was priced at
four thresholds and **recovers zero real tables at every one**: those particular
detections have a median size-agreement of 0.00 and mostly no seats. They are
genuinely low-evidence detections that happen to be correct, and no safe signal
separates them. Per the sprint's own rule, the limitation is kept and stated
rather than tuned around.

They are not lost, only unselected: they appear in the review screen and in
review groups, one family action away.

## Limits

**REAL DISTINCT VENUE PLANS: 1.** Every rendering is the same drawing. The
topology finding is a physical claim about how floor plans are drawn, and it
holds on 424 correct tables of *this* venue under eleven renderings. That is why
the gate abstains instead of deleting. **CROSS-VENUE GENERALIZATION: NOT
VERIFIED.**
