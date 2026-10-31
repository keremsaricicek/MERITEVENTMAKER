# Relationship Engine 2.0 — what it changed, and what it did not

```
npm run benchmark -- merit-real            # the RELATIONS line
npm run benchmark:adversarial              # per-fixture relation scoring
node tests/run.mjs relationship-engine     # the properties a benchmark cannot see
node benchmarks/annotate/expand-relationships.mjs   # how the ground truth grew
```

## The honest headline first

**On the one real plan, the new engine puts every seat exactly where the old
one-line rule put it.** `changedFromNearest: 0`, over 112 seats. Not one
decision moved.

That is not a disappointing result, it is the finding: the Golden Plan does not
discriminate between "nearest table within reach" and any amount of evidence-
based reasoning, because on that drawing they agree everywhere. A benchmark on
that plan alone could never have told a working evidence model from one whose
terms were all being ignored — which is why `tests/suites/relationship-engine.test.mjs`
exists and drives the module directly.

What the engine actually buys is measured on the fixtures and in what it now
records: a runner-up, a margin, an evidence breakdown, an orientation verdict,
and the ability to say it is not sure.

## The ground truth grew, honestly: 83 → 109

The annotation used to abstain on 30 of its 113 chairs, each with an evidence
line like *"3.0px from t012 and 3.0px from t014 — the annotation cannot
adjudicate"*. That was correct for the measure it had. It is not correct for the
drawing:

```
c016  chair centre (1019, 340)
t014  centre (976, 362)  43x48  ->  vertical span 338..386   340 is INSIDE
t012  centre (976, 310)  43x46  ->  vertical span 287..333   340 is OUTSIDE
```

The chair is beside t014's edge and past t012's **corner**. A chair off a corner
is not a seat at that table, and that categorical difference is what
nearest-perimeter flattens into 1.3px.

The obvious worry is circularity — the engine uses perimeter position, so a rule
that writes the answers and then grades them proves nothing. Two things bound
it, and both are in `expand-relationships.mjs`, which refuses to run if the first
one fails:

1. **It was checked against the 83 answers that already existed, before it was
   allowed to decide anything new.** It agreed with all 83 and disagreed with
   none — including the 20 `annulus` relations, which came from angular
   clustering around round tables and are the one part of this annotation
   produced by a genuinely different computation.
2. **It still abstains.** Four chairs sit exactly on one table's corner boundary
   and past the other's, and there is no defensible answer for them. A rule that
   decided all thirty would be the suspicious one.

| method | relations | what produced it |
|---|--:|---|
| `annulus` | 24 | angular clustering in the ring outside a round table |
| `derived` | 59 | nearest annotated perimeter |
| `perimeter-span` | 26 | inside one table's edge span, past the other's corner |
| `ambiguous` | 4 | the drawing does not decide |

## Golden Plan, before and after

| | before | after |
|---|--:|--:|
| scoreable relations | 83 | **109** |
| scored (both ends detected) | 76 | **101** |
| correct | 76 | 100 |
| wrong | 0 | **1** |
| accuracy | 1.000 | **0.990** |

Target is ≥ 0.97. The one disagreement is `c069`, which sits past the corner of
**both** t034 and t036 — 20.6px past one and 21.9px past the other. The
annotation itself derived it from a 1px difference in perimeter distance, which
is exactly the kind of call it refuses to make elsewhere. Detection is unchanged
(tables F1 0.958, chairs F1 0.951, every type 100%), and the robustness matrix is
unchanged row for row.

## The signals, and the one that is deliberately excluded

| signal | weight | what it is |
|---|--:|---|
| perimeter position | 1.30 | inside the body / along an edge / past a corner |
| proximity | 1.00 | distance to the oriented perimeter, over the table's reach |
| facing | 1.00 | does the chair point at this table — only where derivable |
| arrangement | 0.60 | does it sit at the same distance as this table's other seats |
| family | 0.35 | does it look like this table's other seats |

Weights are renormalised over the terms actually available, so a chair with no
derivable facing is not penalised for lacking one.

**Position outranks proximity on purpose.** That is the finding the whole engine
rests on, and the Golden Plan's own thirty previously-unanswerable chairs are
the evidence for it.

### What is excluded, and why

Relationship evidence does **not** feed the decision about what is a table. The
detector's table scorer still counts seat ADJACENCY with a crude
nearest-within-reach pass, and the evidence engine runs afterwards, over tables
already classified.

That is the circular-reasoning rule made structural rather than promised: a
table must not be a table because chairs relate well to it while those chairs
relate well to it because it is a table. It is also measured — when the evidence
engine did feed the table scorer, seat counts shifted, confidence shifted with
them, and three renderings of the Golden Plan each gained a phantom table.

## Orientation, and the discipline around it

Two different questions, and conflating them is how a product ends up claiming a
chair faces north when all it knows is that the symbol is taller than it is wide.

- **Orientation** is an axis, modulo 180°. From the OBB's elongation.
- **Facing** is signed, modulo 360°. It needs a real asymmetry, and it comes
  from something already measured: a connected component carries both its
  bounding-box centre and its ink centroid. A plain square seat has them in the
  same place; a seat drawn with a heavy backrest has its ink pulled toward the
  back, so the chair faces the other way.

**A family, not a symbol, decides whether facing exists at all.** Plan symbols
come from a stencil, so within a family they are the same shape. If the family's
median ink offset is below threshold, no member gets a facing direction, however
much antialiasing noise nudged one of them over the line.

On the Golden Plan that produces exactly the right answer without being told:

```
primary       79 members   median ink offset 0.040   directional: false
family:16:1    4 members   median 0.078              directional: true
family:17:0    4 members   median 0.037              directional: false
family:17:1   13 members   median 0.062              directional: true
family:17:2    5 members   median 0.060              directional: true
family:18:0    7 members   median 0.103              directional: true
```

The 79 orange armchairs — the plan's dominant family, and a near-symmetric
symbol — claim no facing. The pale crescent chairs, which genuinely are
asymmetric, do. 59 of 112 seats have a known orientation axis, 20 a known facing,
and 16 had facing actually used in a decision.

## Ambiguity is a first-class answer

A runner-up within `AMBIGUOUS_MARGIN` (0.06 on the 0–1 score) marks the relation
ambiguous. The seat **stays at its best table** — it is real, and dropping it
would lose capacity — but it is flagged, the competing table is named, and it
raises `contra:ambiguousSeat` in the review queue.

That contradiction disputes **no fact**, deliberately. A seat whose table is
uncertain does not make the seat COUNT uncertain, and downgrading the capacity
claim over it would be the overreaction that makes `uncertain` stop meaning
anything.

One seat of 108 is flagged on the Golden Plan. An engine that hedged everything
would be useless rather than honest, and the test suite pins both directions.

## The gate this work was really about

`a1` and `a8` were built to attack the seat-containment gate, and they broke it:
8 real tables held back on one, **all 240** on the other. Re-reading the
measurement rather than guessing produced the fix:

> Of the 117 invented tables the gate has ever held across eleven renderings,
> **every single one has exactly one seat inside it.** Not one has two. a1's real
> tucked tables have six; a8's have ten.

The topology was never the signal — the count was. And on `a8` the count alone is
still not enough, because chair recall there collapses to 0.074 and each merged
box carries exactly one detected seat. So the gate also stands down when it would
claim most of the plan: measured, the most this pattern ever describes where it
is genuinely a fragment is 42%; on the two plans where the held tables are real
it describes 100%. The limit is 60%.

Result: **248 real tables recovered, 117 invented ones still held, zero change on
the real corpus.**

| | before | after |
|---|--:|--:|
| a1 real tables held back | 8 | **0** |
| a8 real tables held back | 240 | **0** |
| invented tables held across 11 renderings | 117 | 117 |
| real tables ever held on the real corpus | 0 | 0 |
| committed table FP across 11 renderings | 109 | 109 |

## Performance

The relationship pass is indexed on a uniform grid over the tables rather than
comparing every chair to every table: `a8` is 3,240 seats against 324 tables, a
million pair tests done naively. Detection on that fixture completes in ~1.8s
end to end.

## What is still open

- **a1 chair recall 0.5 for relations** — 48 of 96 seats are orphans, because the
  eight pulled-out control tables are never proposed. The cause is upstream of
  this engine: the surface filter rejects them at coverage < 0.22 against a
  dominant surface family that the white room interior displaces. Recorded, not
  fixed.
- **a4, a7 relation coverage 0.59 and 0.76** — chair recall, not association.
- **a8 relation coverage 0.074** — chair recall at arena scale.

REAL DISTINCT VENUE PLANS: 1. CROSS-VENUE GENERALIZATION: NOT VERIFIED.
