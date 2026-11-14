# Teach AI and Plan Memory, measured

```
npm run benchmark:teaching
```

Writes `report.json`. Exits non-zero if any gate fails.

Both features were built, shipped and covered by contract tests, and neither had
a number. A contract test says propagation happens and memory survives a
re-analysis. It does not say whether the objects a correction reached *deserved*
it, or whether a remembered decision came back on the object a person actually
corrected. Those are the two ways this can be quietly wrong, and measuring them
found two real defects that no existing suite could have caught.

Everything is driven through the control a person uses — the reclassify select
on the review card — so the numbers describe the product rather than a harness's
idea of it.

## Results

| | measured | gate | met |
| --- | ---: | ---: | --- |
| propagation precision | **1.0000** (274 objects reached, 0 wrong) | ≥ 0.98 | **yes** |
| Re-Analyze retention | **1.0000** (21 of 21) | ≥ 0.98 | **yes** |
| wrong application | **0.0000** | ≤ 0.01 | **yes** |

80 of 90 teachable objects spread their decision to at least one other object.
Nothing was reached that the annotation disagrees with, and no correction landed
on an object it was not made on.

## The two defects this found

Both are cases where a **human decision changed what the detector found**, which
it must never do. Confirmed objects are handed to the next detection pass as
*protected regions* so a filter cannot delete something a person explicitly
confirmed — a good rule, implemented two ways that leaked.

### 1. Confirming one object deleted others

The fragment filter stands down when it would delete a candidate the detector is
confident about. That test was computed over the candidates left **after**
protection was applied, so protecting the one confident candidate that was
holding the filter back switched the filter **on**, and it then deleted objects
elsewhere on the plan.

Fixed by deciding whether the filter's reasoning describes the plan *before*
protection is considered, and applying protection to the outcome only. A human
decision can now only ever save a candidate.

### 2. A confirmed chair protected a table-sized blob

Protection asked only whether a candidate's **centre** fell inside a confirmed
object's box. Measured: confirm six chairs, Re-Analyze, and four merged
double-table blobs — which the fragment filter had correctly deleted on the
first pass — had their centres inside a confirmed chair, were exempted, and
survived as tables. Those false tables then absorbed **fifteen real chairs** as
their seats, so fifteen standalone chair candidates the operator had never
touched vanished (unassociated chairs 47 → 32), and three remembered corrections
had nothing left to re-attach to.

Fixed by requiring real overlap — 0.5 intersection-over-union, the ordinary
"same object" threshold — between the candidate and the confirmed region. The
same object re-detected scores about 0.95; a merged pair containing it scores
about 0.44.

`tests/suites/plan-memory-isolation.test.mjs` pins the invariant rather than
either mechanism: **the geometry the detector reports must be identical before
and after human decisions.** Reverted against the old code it fails with 31
objects lost and 20 conjured, so it is a check that can fail.

## A third fix, in the harness rather than the product

The first version scored three corrections as lost while its own output showed
the memory re-applied, confirmed, 42px away, and handed to a *neighbouring*
annotated chair by the harness's own matcher. The object benchmark's flat
3%-of-diagonal tolerance is 47px on this plan and its concert seating puts
adjacent chairs about 35px apart: a tolerance wider than the spacing cannot
answer "is this the same chair" at all.

Identity matching here therefore caps each object's tolerance at half the
distance to its nearest neighbour, so at most one annotated object is reachable
from any candidate. Reporting a measurement artifact as a product defect is
worse than reporting no number.

## What these numbers do not cover

- One plan, one venue. **REAL DISTINCT VENUE PLANS: 1.**
- Propagation precision is scored against 90 candidates that match an annotated
  object. The plan's 113 chairs are mostly seats *inside* tables rather than
  candidates of their own, so they are not individually teachable objects here.
- Retention is measured over a Re-Analyze of the **same image**. A correction
  surviving a re-export of the plan at a different scale is a different
  question, and is not measured — see the Venue/Layout fingerprint work.
- Propagation reached 274 objects across 80 trials, all annotated. A plan where
  the detector proposes objects the annotation does not cover would report those
  separately, as `ontoUnannotated`, and score them neither way.
