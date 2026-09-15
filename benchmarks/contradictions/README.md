# Contradictions: two stages that cannot both be right

```
npm run benchmark:contradictions   # writes report.json, non-zero exit on a failed gate
```

Every stage of Plan Intelligence reports what it found, honestly, on its own
terms. None of them could notice when two of them were incompatible. So the
review screen would say **"112 seats"** and **"2 tables nobody sits at"** and
**"4 seats belonging to no table"** in the same confident voice, and leave the
operator to work out that those are one association failure described three
times.

A contradiction here is a specific thing, not a low score: **two stages that
cannot both be right**. Each one names both sides and where each came from, and
states no verdict — the product does not know which side is wrong. Nothing is
deleted, reclassified or re-detected on this evidence; the resolution belongs to
the person looking at the drawing.

## Seven kinds, all from evidence that already existed

| kind | what disagrees |
|---|---|
| `COUNT` | seats the chair pass found against seats the association could place; empty tables next to unplaced seats |
| `TYPE` | the classical classifier against the learned visual second opinion; a family member typed unlike its own family |
| `RELATIONSHIP` | one physical seating unit whose tables were typed as different kinds |
| `ZONE` | a table standing inside a detected stage; a table belonging to no area of the room |
| `CAPACITY` | the pax figure printed on the drawing against the seats counted; a total that "agrees" while some seating has no known capacity |
| `MEMORY` | the detector re-proposing a class the operator already corrected; a confirmed object it no longer finds |
| `SEMANTIC` | tables found, but no part of the room reads as a place people eat |

## Does it point at things that are actually wrong?

That is the only question that matters. A contradiction that points at ordinary
correct detections is worse than silence: it teaches people to dismiss it, and
the one time it is right they dismiss that too.

**Targeted precision** — of the table objects the engine pointed at, what share
are genuinely false positives, against the annotation? The honest baseline is
that rendering's own false-positive rate, which is what pointing at random
detections would score.

| variant | tables | FP | baseline | contradictions | pointed at | of those false | precision | lift |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| ORIGINAL | 50 | 4 | 0.080 | 3 | 7 | 3 | **0.429** | **5.36×** |
| `jpeg-q40` | 50 | 4 | 0.080 | 3 | 8 | 4 | **0.500** | **6.25×** |
| `grayscale` | 48 | 5 | 0.104 | 3 | 13 | 4 | 0.308 | 2.95× |
| `noise` | 62 | 16 | 0.258 | 3 | 32 | 16 | 0.500 | 1.94× |
| `downscale-70` | 45 | 4 | 0.089 | 3 | 11 | 3 | 0.273 | 3.07× |
| `blur` | 69 | 32 | 0.464 | 6 | 47 | 28 | 0.596 | 1.28× |
| `hue-shift` | 90 | 52 | 0.578 | 4 | 76 | 50 | 0.658 | 1.14× |
| `contrast-high` | 86 | 49 | 0.570 | 5 | 70 | 47 | 0.671 | 1.18× |
| `jpeg-q20` | 71 | 26 | 0.366 | 4 | 44 | 20 | 0.455 | 1.24× |

| gate | measured | target | met |
|---|---:|---|---|
| mean targeted precision | **0.4876** | above 0.2876, the rate of pointing at random | **yes** |
| renderings where pointing beats chance | **9/9** | at least 70% | **yes** |
| contradictions on the clean original | **3** | ≤ 4, or it cries wolf on a good plan | **yes** |
| claims stated as certain while disputed | **0** | 0 | **yes** |

The lift is largest exactly where it is most useful — on the renderings that are
mostly right, where a handful of wrong objects hide among many correct ones
(5.36× on the clean original, 6.25× on `jpeg-q40`). On the badly degraded ones
the lift falls towards 1 because more than half of everything is wrong there,
and pointing anywhere hits an error.

## Does the downgrade land on the claims that are wrong?

From `npm run benchmark:facts`:

| | claims | of which wrong |
|---|--:|--:|
| a disagreement lowered its confidence | 3 | 1 — **0.333** |
| nothing disputed it | 20 | 1 — **0.050** |

A downgraded claim is **6.7× more likely to be wrong** than one nothing
disputes. Twenty-three claims is a small sample and this can detect a
systematically miscalibrated engine, not a subtly miscalibrated one.

The concrete case: the interpreter's one remaining wrong claim on the real plan
is *"Also 2 rectangle"* — two square tables mistyped. One of those two tables is
also the object the grouping check points at, so the claim is now stated as
`uncertain` while *"Also 5 bistro"* and *"Also 4 round"*, both correct, stay
`likely`. Semantic accuracy is unchanged at **0.9130**: the benchmark scores the
claim, not its confidence, and lowering confidence on a wrong claim cannot move
it. That is the honest outcome, and it is why the calibration number above is
reported separately rather than folded into accuracy.

## A disagreement only lowers a claim it could actually change

Three mistyped tables out of forty-six do not make *"most of them are square"*
doubtful. The first version of this engine downgraded it anyway, along with
almost everything else, which would have made `uncertain` mean nothing — the
same failure as calling everything `strong`, in the other direction.

So a contradiction touches a count (any wrong object disputes a count) but
touches a claim about the dominant type only when it covers at least 20% of the
tables. One step down per **distinct disagreeing kind**, never per instance: a
plan of many similar objects would otherwise bury every claim it makes.

## The check that was wrong, and how it was caught

The first `ZONE` check asked whether a stage zone's bounding box overlapped a
dining zone's. On the clean original it fired and flagged an entire correct
dining area of fifteen objects. A zone's box is the axis-aligned hull of a
cluster, so on any real room the dining hull spans the floor and touches the
stage hull — overlapping hulls are not evidence of anything.

It now asks whether a **table's centre lies inside a detected stage object**,
which is unambiguous, and it no longer fires on the original. Running the
benchmark before believing the feature is the entire reason this is in the past
tense.

## Limits

**REAL DISTINCT VENUE PLANS: 1.** Every rendering above is the same drawing.
Targeted precision measures whether the engine points at this venue's own
detection errors under re-rendering, and says nothing about a venue this system
has not seen. **CROSS-VENUE GENERALIZATION: NOT VERIFIED.**

---

## Per-category precision, and who is allowed to lower a claim

A combined mean of 0.49 hides the thing that matters. Scored per check against
ground truth on nine renderings (chance rate on that set: **0.288**):

| check | fired | pointed at | of those false | **precision** | allowed to |
|---|--:|--:|--:|--:|---|
| `contra:seatsInsideBody` | 7 | 95 | 95 | **1.0000** | downgrade |
| `contra:visualClass` | 9 | 46 | 27 | **0.5870** | downgrade |
| `contra:mixedGroupTypes` | 9 | 240 | 137 | **0.5708** | downgrade |
| `contra:emptyTablesOrphanSeats` | 9 | 104 | 37 | **0.3558** | prioritise only |
| `contra:familyOutlier` | 2 | 2 | 2 | 1.0000 | too few to trust |
| `contra:seatingInStage` | 1 | 1 | 1 | 1.0000 | too few to trust |
| `contra:orphanSeats` | 4 | 0 | 0 | — | never points at a table |

By kind: ZONE 1.000, **RELATIONSHIP 0.6925**, **TYPE 0.6042**, COUNT 0.3558.

`contra:emptyTablesOrphanSeats` is only **1.24× chance**. Letting it lower the
confidence of a claim that a 1.000-precision check would support is how an
evidence system becomes noise with a warning label. So the action policy is per
check, not global (`CONTRADICTION_POLICY` in `src/plan-intelligence.js`):

- **downgrade** — beats chance by half again *and* has pointed at ≥10 objects.
- **prioritise** — everything else, including every **unmeasured** check. A
  check nobody has scored is not evidence that a claim is wrong.

Every check still appears on screen and still raises review priority. The policy
governs one thing: whether it may change how confidently the product speaks.

### What it bought

From `npm run benchmark:facts`:

| | claims | of which wrong | |
|---|--:|--:|---|
| before, any check could downgrade | 3 | 1 | 0.333 |
| **after, only measured checks** | **2** | **1** | **0.500** |
| claims nothing disputed | 21 | 1 | 0.048 |

A downgraded claim went from 6.7× to **10.4×** more likely to be wrong than an
undisputed one. Concretely, *"2 tables have no seats detected at them"* — which
is **true** — went back to `likely` after the noisy COUNT check stopped being
allowed to lower it.

**Calibrated on one venue.** That is a real limit on this table.

## A queue item that has been answered leaves the queue

A contradiction is a statement about the plan and stays true until the plan
changes: `seatsInsideBody` still holds after someone confirms the object,
because the topology has not moved. But the queue is a list of things still
needing a decision, not a list of true statements.

Measured before the fix: confirming the top item three times in a row left the
**same item at the top all three times**. Now a contradiction whose every target
has been ruled on leaves the queue — items 15 → 14 → 13, review groups 6 → 5. It
stays on screen as a stated disagreement and still lowers what it disputes; it
just stops being asked again.
