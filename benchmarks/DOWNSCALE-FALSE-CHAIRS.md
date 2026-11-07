# `downscale-70`: 73 false chairs — root cause and four rejected fixes

The Golden Plan rendered at 70% scale is the only robustness variant where chair
**precision** collapses. Every number below is from a run of the shipped
detector against `benchmarks/robustness/annotations/merit-real-downscale-70.json`,
not from memory.

| | original | `downscale-70` |
|---|---|---|
| detection resolution | 1355×788 | 948×552 |
| chair modal size | 34.5 px | 23.9 px |
| chairs detected | 112 | **185** |
| matched to ground truth | 107 | **112 of 113** |
| false chairs | 5 | **73** |
| chair F1 | 0.951 | **0.752** |

Recall is not the problem — it is the best of any variant at 0.991. The detector
finds every seat and then finds 73 more things.

## What the 73 actually are

Measured, not assumed. Each false detection was compared against every true one:

| | count |
|---|---|
| chair-sized (≥ ¾ of the plan's chair modal) | 40 |
| smaller than ¾ of a chair | 33 |
| within 1.5 chair-widths of a real annotated chair | 56 |
| **maximum IoU with any true detection** | **0.23** |
| pairs above IoU 0.25 | **0** |

That last row is the decisive one. The false chairs do **not** sit on top of
real ones. They sit in the **gaps between** them, at seat scale, on the plan's
densest seating blocks — the same zones as the real seats, offset by roughly
0.6 to 1.8 chair widths.

The mechanism is that a downscale shrinks the drawing but not the ink. The pale
antialiasing between two adjacent seats is 1–2px wide at any resolution; at 70%
the seats have closed up around it and it merges into a pale, compact,
chair-sized blob standing against a table, which is a description that also fits
this plan's 24 genuinely pale outlined chairs. The tone family carrying it flips
verdict accordingly:

| | original | `downscale-70` |
|---|---|---|
| family luma | 201 | 206 |
| modal component side | 4.9 px | 5.9 px |
| plan-relative floor (`minDim × 0.01`) | 7.9 px | 5.5 px |
| verdict | linework | **repeated compact family (chairs only)** |
| chair candidates offered | 0 | **145** |

The fringe grew by 1px while the floor shrank by 2.4px, and they crossed.

## Rejected fix 1 — scale the family floor to the plan's largest tone family

The floor above is plan-relative but anchors to the image's dimensions, which is
exactly what a downscale changes. Anchoring it instead to the largest tone family
on the same image is scale-free by construction.

Measured across all 22 plans and variants, as the ratio of a family's modal
component side to the largest tint family's:

| family | ratio | is it really chairs? |
|---|---|---|
| `greyscale` fixture, luma 140 | 0.170 | **yes** |
| `adversarial-dense`, dark family | 0.183 | **yes** |
| **`downscale-70`, luma 206** | **0.193** | **no** |
| `blur`, luma 139 | 0.248 | yes |
| `adversarial-bistro`, dark family | 0.280 | yes |

The real chair families bracket the false one on both sides. There is no
threshold. **Rejected on measurement.**

## Rejected fix 2 — the family `crowding` diagnostic

Already implemented and reported (`secondaryChairFamilies[].crowding`): how far a
candidate family's members stand from the primary family's seats, in units of
the primary family's own spacing. Real minority families read 1.75–3.34 on the
Golden Plan; the debris families read 1.04–1.07. It separates by 17%, with the
real plan's smallest admitted family nearest the line, and it would remove 32 of
73. **Kept as a reported diagnostic, not gated on** — the margin is not enough to
delete a family on, and it does not solve the problem it would be spent on.

## Rejected fix 3 — cross-family overlap suppression

If the extra detections were fragments of real seats, an IoU test would collapse
them regardless of which family they came from. They are not: **zero** of the 73
reach IoU 0.25 against any true detection, and the highest is 0.23. Neighbouring
seats in a row touch without overlapping, and so do these. A global IoU pass
would remove nothing and would risk the per-family merge that lets a minority
ring survive beside the majority chair. **Rejected on measurement.**

## Rejected fix 4 — raise the family repetition bar

The false family's repetition is 0.63 against a 0.55 bar. Raising the bar to 0.80
would exclude it — and would also exclude the *dominant surface* families of the
real plan (0.86), `crop-pad` (0.62), `jpeg-q40` (0.64), `contrast-low` (0.71) and
`hue-shift` (0.56) from being chair material at all. The bar is load-bearing for
the majority family on almost every variant. **Rejected on measurement.**

## What is not allowed, and was not done

Raising the global minimum chair size would remove these blobs and would also
remove this plan's real bistro chairs (8 of 10 currently found at ~17px against a
34px modal). The sprint forbids it and it is the wrong fix regardless: the
objects are chair-sized, so a size rule cannot separate them.

## Where the remaining evidence points

The one property that still distinguishes them has not been tried because it is
not a detector-stage property: **arrangement**. The real pale outlined chairs on
this plan stand on the perimeter of round tables; the false blobs stand in the
interior gaps of straight dense rows. Deciding that needs the seat-arrangement
reasoning of the relationship stage, not another threshold in the chair pass.

Recorded, and the variant left at 0.752 chair F1 rather than tuned. Chair recall
on it is 0.991 and the median chair F1 across all sixteen renderings is 0.955.

---

## Two more rejected fixes (final hardening sprint)

The taxonomy pass first corrected a mislabel of its own: the cause originally
printed as `on-a-real-chair` for a chair candidate actually means *on a real
**table***, because the check compares against the other class. Renamed
`on-another-class`. So the 53 are **chairs detected on top of real tables** —
at 70% scale the table's own surface pattern reads as seats.

### Rejected: near-duplicate seat spacing

If the false seats were duplicates of real ones, their nearest-neighbour
distance would be smaller than a real seat's. Measured, in units of the
detection's own size:

| | p10 | median | p90 |
|---|--:|--:|--:|
| real seats | 0.6 | 1.2 | 2.7 |
| false seats | 1.0 | **1.6** | 3.0 |

The false seats are **further apart** than the real ones — the opposite of a
duplicate signal. The hypothesis is wrong, not merely unusable.

### Rejected: a seat inside its own table

The mirror of the seat-containment gate that works so well on tables: a seat
sits *around* its table, so one whose centre falls *inside* the table outline
is the table's surface read as a seat. On `downscale-70` this separates
strongly — **54 of 68** false seats against **8 of 104** real ones.

It does not survive contact with the other renderings:

| | real seats inside their own table | false seats inside |
|---|--:|--:|
| `hue-shift` | **47 / 84** | 1 / 2 |
| `bright-up` | **42 / 79** | 1 / 2 |
| `contrast-high` | **42 / 78** | 1 / 2 |
| `blur` | **29 / 82** | 0 / 0 |
| all renderings | **209 / 913** | 58 / 81 |

Applying it would destroy real seats on exactly the renderings where the table
gate helps most. A rule that only works on `downscale-70` is a rule tuned to one
rendering, which is the thing this project has repeatedly refused to ship.

**`downscale-70` keeps its 73 false chairs.** Six fixes have now been priced
against ground truth and rejected. Chair recall there is 0.991 — the seats are
all found; the cost is precision on one rendering, and it is stated rather than
tuned away.
