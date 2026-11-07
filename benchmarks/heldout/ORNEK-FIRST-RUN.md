# ORNEK — the first held-out run, recorded before anything was changed

This is the **untouched** system meeting real plan #2 for the first time. It
was run after `benchmarks/annotations/ornek-symbolic.json` was frozen and
committed, so the ground truth could not be shaped by the result.

**This record is permanent. Later runs go elsewhere. It is never overwritten,
and it is never re-run to get a kinder number.**

```
commit under test   3f96e1c   (Ground Truth #2, no inference code changed)
plan                benchmarks/plans/ornek-upright.png   2402 x 1719
ground truth        benchmarks/annotations/ornek-symbolic.json
report              benchmarks/heldout/ornek-first-run.json
reproduce           node benchmarks/run-benchmark.mjs ornek --out benchmarks/heldout/ornek-first-run.json
diagnose            node benchmarks/heldout/ornek-diagnose.mjs
```

## The score

```
TABLES    gt=166  det=10  TP=0  FP=10  FN=166   P=0  R=0  F1=0
CHAIRS    annotated=0     detected=143  (11 on tables, 132 standalone)
CAPACITY  the plan prints 2064 PAX;  the system reports 143 seats
FP-ZONES  9 of the 10 "tables" are inside annotated non-table regions
TIME      1830 ms   pageErrors=0
```

Zero. Not "poor" — **zero**. Not one of the 166 tables was returned as a table,
and every object that was returned as a table is a false positive.

## The score is not the finding

A zero hides which of two opposite failures happened. "It cannot see anything
on this plan" and "it sees the plan perfectly and names everything wrong" score
identically and need opposite fixes, so the score was not accepted as the
answer. `ornek-diagnose.mjs` asks where every candidate actually landed:

```
kind "venue"  139 objects   median box  73 x 68   (a real table is 78 x 78)
              133 of them within 45px of a real table centre
              covering 132 of the 166 real tables
              median distance to the nearest real table:  3 px

kind "table"   10 objects   median box 137 x 46
                0 within 45px of any real table
              median distance to the nearest real table: 164 px
```

**The detector found the tables. It found 132 of 166 of them, centred to three
pixels, at the right size — and classified every one of them as a chair.**

And what it did call a table:

| what it returned | what is actually there |
|---|---|
| 5 boxes ~145x47 along the bottom | cells of the **LOCA strip** |
| 118x60 in the header | the **title text box** |
| 51x179 on the left wall | a **pillar** |
| 55x163, twice | the two **SYSTEM KONTROL arrows** |
| 86x224 mid-plan | the **central column** |

Ten for ten, it named the architecture. The pipeline reports
`detectionPath: "chair-first"`, `unassociatedChairs: 132`.

## What ORNEK proves the system does not understand

### 1. It decides what an object IS from how big it is relative to its neighbours

This is the whole failure, and everything else follows from it.

The chair-first path was built on the Golden Plan, where the reasoning holds:
many small repeated round things surrounding a few larger shapes — the small
ones are chairs, the large ones are tables. It is a good rule and it earned its
place there.

On ORNEK **every object on the sheet is the same size**. The 166 tables are
identical 78px circles. There is no "larger shape" for them to belong to,
because a symbolic plan does not draw one. So the rule runs off the end: the
tables are taken for chairs, 132 are left as chairs belonging to nothing, and
the only things left that are *bigger* than a circle are the LOCA cells, the
pillars, the arrows and the column — so those become the tables.

The system has no concept of a table that is not the big thing in its
neighbourhood. It never asks what the object *is*; only how it ranks.

### 2. It cannot read a plan that names its objects instead of drawing them

157 of these tables have their number printed inside them, and the sheet states
its own capacity as a rule: `SALON : 166 * 12 : 1992 PAX`. Between them, the
document says exactly what it contains. The system used none of it: it reported
143 seats against a printed 2064, a figure it could have checked against the
document in front of it and did not.

### 3. It reports chairs on a plan that draws none

143 chairs, on a sheet with zero chairs anywhere. Not one of them is a chair —
132 are tables and 11 are attached to architecture. The pipeline has no step
that can conclude "this drawing does not show seats"; the chair-first path
assumes seats exist to be found, so it finds them.

### 4. Faint and inverted printing defeats the detection stage outright

Of the 34 objects it did not locate at all:

- **all 9 dark-filled tables** — every single one. The pipeline looks for light
  discs with darker rims; a solid dark disc is the tonal inverse and is missed
  completely, though it is the same size, in the same row, on the same grid.
- **the faint row (73, 74, 75, 76)** — printed at ~241 grey against ~253 paper.
  An independent finder needed a whole-disc matched filter to see these at all.
- **nine of row 5 (47–55)** and scattered others, in the photograph's fold and
  shadow band.

So the detection stage has a real weakness here too — but it is second order.
Fixing all 34 would take table recall from 0 to 0.

### 5. The Golden Plan taught it three things that are not true of plans in general

| what it learned on plan #1 | ORNEK |
|---|---|
| chairs are drawn | none are drawn |
| capacity is counted from drawn seats | capacity is printed as a rule |
| a table is a shape with a footprint | a table is a numbered circle |

None of these were ever written down as assumptions. They were absorbed from a
sample of one, and they only became visible when a second real plan arrived.

## What this does NOT prove

- It does not prove the detector is broken. On the Golden Plan it is unchanged
  and its baseline still holds; this run touched no inference code.
- It does not prove anything about plans in general. **REAL DISTINCT VENUE
  PLANS: 2. CROSS-VENUE GENERALIZATION: NOT VERIFIED.** Two documents is not a
  distribution, and a fix that works on both is still a fix demonstrated twice.
- It does not tell us what the dark fill *means*. The drawing never says, and
  neither does the ground truth.

## Standing constraint

The numbers on this page — 166, 12, 1992, 72, 2064 — are ground truth for this
benchmark and nothing else. No production code may branch on this file's name,
its hash, or these values. The product has to reach them from the document.
