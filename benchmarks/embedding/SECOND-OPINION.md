# The learned second opinion: what it does, and what it was refused

```
node benchmarks/embedding/measure-separation.mjs   # writes separation.json
node tests/run.mjs visual-second-opinion           # the shipped contract
```

Phase 1 established the detector's dominant failure mode on degraded renderings:
it is **invention, not blindness**. `jpeg-q20` finds 45 of 46 tables and adds 26
imaginary ones; `hue-shift` finds 38 and adds 52. A false-positive problem is
what a second, independent opinion is for — so Phase 2 asked whether the trained
encoder can supply one.

Two different questions were measured, and they got two different answers.

## Question 1 — can it be a filter? **NO. NOT PROMOTED.**

Six suppression rules were simulated against ground truth, offline, before
anything was wired. Every rule requires the *absence* of independent evidence
(no seats found by the chair pipeline) as well as a weak visual match, because
similarity alone must never delete anything.

false tables removed / **REAL tables lost**:

| variant | bottom 20% | bottom 30% | bottom 40% | <0.65 | <0.70 | <0.75 |
|---|---|---|---|---|---|---|
| `hue-shift` | 1/**0** | 1/**0** | 2/**0** | 2/**0** | 3/**0** | 3/**1** |
| `contrast-high` | 0/**0** | 2/**0** | 3/**0** | 4/**0** | 5/**1** | 5/**3** |
| `bright-up` | 0/**0** | 2/**0** | 3/**1** | 4/**1** | 4/**2** | 4/**4** |
| `jpeg-q20` | 3/**4** | 7/**5** | 8/**8** | 7/**5** | 11/**9** | 12/**10** |
| `blur` | 0/**1** | 1/**1** | 1/**1** | 1/**1** | 1/**1** | 1/**3** |

A rule is usable only if the right-hand number is 0 everywhere. **None is.**

Two reasons, both structural rather than tunable:

- **The false positives have seats.** The chair associator attaches chairs to
  them, so the "no independent evidence" precondition never fires on the ones
  that matter. The rules that do fire remove 1–3 objects out of ~50.
- **`jpeg-q20` inverts the channel.** There, real tables sit *below* invented
  ones (26 of 26 false positives above the true 10th percentile), so any rule
  tuned on the other renderings deletes real furniture on that one.

A missed table costs an operator more than an extra one they reject in a click.
So **detector fusion did not earn promotion and is not wired.** Per §19 this is
recorded as a result, not retried until it passes.

A runtime abstain proxy was also tested — could the product tell, without ground
truth, whether to trust the channel on a given rendering? Using seated vs
unseated candidates (seats being independent evidence), the median similarity
gap is **negative** on `hue-shift` (−0.241), `contrast-high` (−0.246),
`bright-up` (−0.239) and `blur` (−0.117). It cannot. **Rejected.**

## Question 2 — can it be evidence? **YES. PROMOTED.**

The channel is wired as evidence only: it writes `candidate.visualEvidence` and
`diagnostics.embedding.secondOpinion`, and removes nothing. `role` is
`"evidence-only"` and `suppresses` is `false` in the stored diagnostics, and
`tests/suites/visual-second-opinion.test.mjs` fails the build if a fresh
analysis ever rejects a candidate.

Measured on what the **shipped build** actually wrote (not on a
re-implementation), with the reference library the product really has on a plan
nobody has decided anything on yet — the **provisional** tier:

| variant | refs | weak TP / graded | weak FP / graded | weakLift | "closer to a chair" TP/FP |
|---|--:|--:|--:|--:|--:|
| ORIGINAL | 117 | 13/46 | 4/4 | **3.54** | 1/2 |
| `hue-shift` | 93 | 12/38 | 19/52 | **1.16** | **0/6** |
| `contrast-high` | 104 | 8/37 | 21/49 | **1.98** | **0/2** |
| `bright-up` | 107 | 8/39 | 22/48 | **2.23** | **0/4** |
| `jpeg-q20` | 74 | 7/45 | 17/26 | **4.20** | 12/3 |
| `blur` | 90 | 9/37 | 14/32 | **1.80** | **0/5** |
| `downscale-70` | 185 | 11/41 | 4/4 | **3.73** | 3/1 |

`weakLift` is how much more often an invented table is graded `weak` than a real
one. **1.0 would mean the channel says nothing.** It is above 1 on all seven
renderings, from 1.16 at worst to 4.20 at best.

The class column is read TP/FP: real tables wrongly called chair-like (a false
alarm the operator sees) over invented tables correctly flagged. On the four
worst-invention renderings it flags 17 invented tables and **raises zero false
alarms**. `jpeg-q20` inverts here too, exactly as it does everywhere else.

### The reference library is the whole question

The idealised measurement — human-verified boxes from the clean original — is a
**ceiling the product does not have**. At runtime the library is assembled from
what is actually trustworthy, in three tiers, and **the tier travels with every
answer**:

| tier | what it is |
|---|---|
| `verified` | a candidate matching a plan-memory entry the operator confirmed or drew |
| `memory` | a candidate matching a remembered entry that is not a confirmation |
| `provisional` | the detector's own candidate, admitted only when a *different* pipeline stage corroborates it — seats found by the chair pass plus membership in a repeated size family |

Seats attached to a qualifying table become the chair references, which is what
lets the opinion say "closer to a chair" at all rather than only "matches
nothing". A seat whose table did not qualify is not a reference: a ring of marks
around an invented table teaches nothing about chairs.

Every table in this document was produced with `bestTier: "provisional"` —
the weakest tier, and the runtime default. Nothing here rests on the idealised
library. §13 is satisfied by construction as well as by label: a candidate is
excluded from its own comparison (`assessMany` skips a reference sharing the
item's id), so nothing scores 1.000 against itself, and the review card states
"compared with this plan's own detections, not with verified objects" in both
languages.

### Two independent axes, not one score

`strength` (`strong`/`moderate`/`weak`/`unknown`) says how well the crop matches
anything; `agreement` (`agree`/`disagree`) says whether the best match is in the
class the classical pipeline chose. They are independent, the way planning
status and arrival status are independent everywhere else in this product.

The first implementation gated agreement behind strength — a disagreement only
counted if the match was also strong. That threw away the useful half: it
reported **0** "closer to a chair" on `hue-shift`, `contrast-high`, `bright-up`
and `blur`, where the raw class signal was 6, 2, 4 and 5 invented tables with no
false alarms. Ungated, both facts are stated: *"Does not clearly resemble
anything on this plan; the closest match is among its chairs."*

### Similarity is not probability

Graded against the distribution of this plan's own matches for the same class,
never against a fixed cut — on `jpeg-q20` the true tables themselves only reach
a median of 0.70, so an absolute 0.75 bar would call every real table weak. The
product shows four words and never a percentage; the suite fails on a `%` in the
rendered card, in either language.

## Cost

Measured on the real plan, one run: detection 545 ms, embedding **403 ms** for
164 crops (up from ~50 crops — the 113 seat crops for the chair references are
most of the increase), second opinion **3 ms**, stored analysis 239 KB. Seat
vectors are computed transiently and deliberately **not** persisted; the suite
fails if one ever reaches a stored object.

## What did not move

`npm run benchmark:baseline`: **no regressions, 0 improvements**, all 31 guarded
fields identical. The robustness matrix is unchanged row for row. That is the
expected result and the point of it — an evidence channel that changed a
detection number would not be evidence-only.

## Limits

**REAL DISTINCT VENUE PLANS: 1.** Every row is the same drawing re-rendered.
This measures a within-venue visual channel and says nothing about a venue this
system has not seen. **CROSS-VENUE GENERALIZATION: NOT VERIFIED.**
