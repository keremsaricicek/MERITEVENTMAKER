# Plan Intelligence completion sprint — evidence report

Every number here is a measurement from a run of the shipped build at the
commit this file was written on. Nothing is remembered, nothing is estimated,
and where a gate is not met it says so.

Reproduce with:

```
npm run benchmark && npm run benchmark:baseline
npm run benchmark:teaching
npm run benchmark:retrieval
npm run benchmark:zones
npm run benchmark:facts
node benchmarks/robustness/run-robustness.mjs
npm run test:all && npm run perf && npm run verify:offline
```

## 1. Sprint status: **PARTIAL — six of six stages attempted, five fully met**

| stage | before | after | gate | met |
|---|---|---|---|---|
| 1. Detector gaps | bistro type 0/5, columns 4/6 | **bistro 5/5, columns 6/6** | §6/§7 | **yes** |
| 1b. `downscale-70` false chairs | 73 | **73** | §9 ≤ 20 | **no** — root-caused, four fixes measured and rejected |
| 2. Learned visual similarity | handcrafted descriptor, `trainedModel:false` | **5,656-parameter trained encoder, `trainedModel:true`** | §16/§24 | **yes** |
| 3. Teach AI + memory | built, never measured | **propagation 1.000, retention 1.000, wrong 0.000** | §C | **yes** |
| 4. Relationship intelligence | 24 relations, 1.000 | **83 relations, 1.000, zero orphans** | §D | **yes** |
| 5. Semantic zones | did not exist | **stability 0.9658 across 16 renderings** | §E | **yes** |
| 6. Whole-plan interpreter | did not exist | **fact accuracy 0.9130, 0 fabricated strong facts** | §F | **yes** |

## 2. Detection, on the real Golden Plan

| | GT | TP | FP | FN | precision | recall | F1 |
|---|---|---|---|---|---|---|---|
| tables | 46 | **46** | 4 | **0** | 0.920 | **1.000** | **0.958** |
| chairs | 113 | 107 | 5 | 6 | 0.955 | 0.947 | **0.951** |

**Table type accuracy 46/46 = 1.000** — square 37/37, round 4/4, **bistro 5/5**
(was 0/5). All five bistro tables were already being *found*; every one was
typed as something else, and detection recall and type accuracy are different
numbers.

Bistro typing requires **three agreeing facts from three different pipeline
stages** — smaller than this plan's modal table (size), seats far fewer than it
(association), seated by a minority chair family (chair families), drawn in a
minority surface finish (tone families). "Small table = bistro" would relabel a
room of two-tops and is explicitly not what this does: a plan of uniformly sized
tables produces none, asserted by `tests/suites/table-typing.test.mjs`.

**Columns 6/6 at precision 1.000** (was 4/6). Two bugs, both measured:

- a **bin edge**. Families were keyed by `round(log(size)/log(1.18))`; the
  fixture's square columns measure 42 across and its round ones 40 — 5% apart,
  well inside the 18% the key tolerates — but the two fell either side of a bin
  boundary. One structural grid became a family of four and a family of two.
- **someone else's chair**. "Nobody sits at it" was implemented as "no seat
  nearby", and a column in a room of round tables is surrounded by other
  people's seats.

Zero columns are invented on the text fixture, the dense fixture, or the real
plan, whose annotation records that none are identifiable there.

### The four fixtures

| plan | table F1 | notes |
|---|---|---|
| `adversarial-architecture-v1` | 1.000 | columns 6/6 |
| `adversarial-dense-v1` | 1.000 | |
| `adversarial-text-v1` | 1.000 | no text read as furniture |
| `adversarial-bistro-v1` | 0.878 | 18 of 23; the 5 synthetic bistros still missed |

## 3. Robustness — 16 renderings of one drawing

| gate | target | measured | met |
|---|---|---|---|
| median table F1 | ≥ 0.85 | **0.877** | yes |
| median chair F1 | ≥ 0.90 | **0.955** | yes |
| chair floor, all variants | ≥ 0.85 | **0.752** on `downscale-70` | **no** |
| table floor, low resolution / colour | ≥ 0.75 | 0.636 / 0.559 | **no** |

No regressions against the recorded robustness baseline across the whole
sprint, through every change in it.

## 4. `downscale-70`: the gate that was not met

73 false chairs, unchanged. **Root-caused, with four candidate fixes measured
and rejected** — `benchmarks/DOWNSCALE-FALSE-CHAIRS.md` has the numbers.

A downscale shrinks the drawing but not the ink. The pale antialiasing between
two adjacent seats is 1–2px wide at any resolution; at 70% the seats have closed
up around it and it merges into a pale, compact, chair-sized blob standing
against a table — which also describes this plan's 24 genuinely pale outlined
chairs.

The decisive measurement: the false chairs sit in the **gaps between** real
seats. **Zero** of the 73 reach IoU 0.25 against any true detection.

Rejected on measurement, not on opinion: anchoring the tone-family floor to the
largest family (real chair families bracket the false one at 0.170/0.183 and
0.248/0.280 against its 0.193); the family `crowding` diagnostic (17% margin,
removes 32 of 73); cross-family IoU suppression (removes **0** of 73); raising
the repetition bar (would disqualify the dominant surface family on most
variants). Raising the global minimum chair size would work, is forbidden by
§11, and is the wrong fix anyway — the blobs are chair-sized.

Per §3's tuning limit, this was recorded and left rather than tuned further.

## 5. Learned visual similarity — a real trained model

| | |
|---|---|
| id | `merit-plan-encoder-v1+handcrafted-descriptor-v1` |
| `trainedModel` | **true** |
| parameters | **5,656**, fitted by gradient descent |
| size in the offline package | 54 KB, **inlined, never fetched** |
| licence | **trained in this repository on this project's own annotated plans** |
| runtime | in-page JavaScript; no ONNX runtime, no CDN, no network |

Trained with InfoNCE over the **same annotated object rendered differently** —
the Golden Plan genuinely re-rendered by the robustness suite, never synthetic
augmentation. Measured on 2,699 crops, on **objects the encoder never trained
on**:

| top-1 | handcrafted | learned | **both** |
|---|---:|---:|---:|
| same-object invariance | 0.7188 | 0.9447 | **0.9495** |
| same-class retrieval | 0.9255 | 0.9075 | **0.9435** |
| table-type retrieval | 0.8542 | 0.8625 | **0.8750** |
| held-out plans, top-5 purity | 0.9573 | 0.9947 | **0.9947** |

The learned encoder **alone is worse** at same-class retrieval. That is why it
did not ship alone: a representation that hands back one number to buy another
has not earned promotion, and the trade is invisible in an average. Concatenated,
the worst movement on any measured metric is **+0.0000**.

The backward pass is hand-written, so it is checked against finite differences
before anything is trained on it — worst relative error 3.3e-7. The first
version of that check sampled six near-identical crops, saturated the softmax
and passed on gradients of 1e-18 against a numeric zero; it now fails outright
if every numeric gradient is zero, because a check that cannot fail is not a
check.

**What `trainedModel: true` does not mean:** not that a trained *domain model*
is installed. Detection is still classical computer vision,
`analysis.trainedModel` is still `false`, and the screen still says **DOMAIN
MODEL NOT INSTALLED**.

## 6. Teach AI and Plan Memory — measured, and two defects found

| | measured | gate | met |
|---|---:|---:|---|
| propagation precision | **1.0000** (274 objects reached, 0 wrong) | ≥ 0.98 | yes |
| Re-Analyze retention | **1.0000** (21 of 21) | ≥ 0.98 | yes |
| wrong application | **0.0000** | ≤ 0.01 | yes |

Both features were built, shipped and covered by contract tests, and neither had
a number. Measuring them found two defects of the same shape — **a human
decision changed what the detector found**:

1. **Confirming one object deleted others.** The fragment filter stands down
   when it would delete a candidate the detector is confident about; that test
   was computed over the candidates left *after* human protection was applied,
   so protecting the one confident candidate holding the filter back switched it
   **on**, and it deleted objects elsewhere.
2. **A confirmed chair protected a table-sized blob.** Protection asked only
   whether a candidate's *centre* fell inside a confirmed object's box. Four
   merged double-table blobs, correctly deleted on the first pass, survived and
   then absorbed **fifteen real chairs** as their seats — fifteen candidates the
   operator never touched vanished from the plan.

`tests/suites/plan-memory-isolation.test.mjs` pins the invariant rather than
either mechanism: the geometry the detector reports must be identical before and
after human decisions. Run against the reverted code it fails with **31 objects
lost and 20 conjured** — verified, not assumed.

## 7. Relationship intelligence — 24 → 83 scoreable

| | value |
|---|---|
| ground-truth relationships | **83** (was 24) |
| scored | 76 |
| correct | **76** |
| wrong | **0** |
| orphan | **0** |
| **accuracy** | **1.000** |
| by method | derived 56/56 = 1.000, annulus 20/20 = 1.000 |
| abstained by the annotation | 30 |

Wider measurement immediately found a real defect: accuracy 0.711 with **zero
wrong tables and 22 orphans** — every failure was a seat the detector found and
seated nowhere, with its annotated table 2–5px away and detected. Association
runs over every table *proposal*, the fragment filter then deletes some, and a
chair assigned to a deleted proposal was dropped from seating entirely. The
losers' seats are now offered to the survivors.

The ground truth **abstains** on 30 chairs nearly equidistant from two tables:
guessing one would manufacture a disagreement the annotation cannot adjudicate.
And the derived rule agrees with **all 24** independently recovered annulus
relationships, which is a real check of it where independent truth exists.

## 8. Semantic zones

| | measured | gate | met |
|---|---:|---:|---|
| stability across 16 renderings | **0.9658** (621 of 643 object/rendering pairs) | ≥ 0.90 | yes |
| every zone states its evidence | yes | required | yes |
| zone seats never exceed detected seats | yes | required | yes |
| entrance zones invented without OCR | **0 of 16** | 0 | yes |

The first version of this metric compared the multiset of zone types across
renderings and scored **1 of 16** — a meaningless number, because how a room
partitions into clusters depends on which tables that rendering found. The
well-posed question is object-level: a table is in the same part of the same
room in all sixteen images. All 22 disagreements are `dining` versus the honest
`unknown` on one degraded rendering.

## 9. Whole-plan interpretation

| | measured | gate | met |
|---|---:|---:|---|
| semantic-fact accuracy | **0.9130** (21 of 23 checkable) | ≥ 0.90 | yes |
| fabricated `strong` facts | **0** | 0 | yes |
| raw keys or placeholders, EN and TR | **0** | 0 | yes |

The benchmark caught a fabricated strong fact on its first run: "18 tables, most
of them square" asserted as certain on a plan with 23. Two claims of very
different reliability had been bundled under one strength — *which type
dominates* is a property of the drawing, *how many there are* is bounded by
detection recall. They are now separate facts, and the contract suite pins the
rule: **no count may ever be stated as certain**.

## 10. Operator effort

| | before | after | gate | met |
|---|---:|---:|---:|---|
| review groups, real plan | 5 | **6** | ≤ 8 | yes |
| uncertain questions | 5 | 5 | — | — |

Review groups went 5 → 6 because typing the bistro tables correctly splits them
out of the square group into a sixth group of their own. That is a **type
discovery, not effort inflation**, and it was re-recorded in the baseline as a
deliberate, explained trade.

## 11. Model status

| | |
|---|---|
| active detector | classical CV (`classical-cv`) |
| detector `trainedModel` | **false** |
| active embedding | `merit-plan-encoder-v1+handcrafted-descriptor-v1` |
| embedding `trainedModel` | **true** — 5,656 real trained parameters |
| domain model | **NOT INSTALLED**, and the UI still says so |
| runtime | in-page JavaScript, no network at any point |

## 12. Generalization

**REAL DISTINCT VENUE PLANS: 1.**

**Cross-venue generalization: NOT VERIFIED.**

Every headline number in this report comes from one real venue plus four
synthetic fixtures. The sixteen "renderings" are the same drawing re-rendered.
The learned encoder's held-out-plans column is four synthetic fixtures, not four
venues. A 0.9495 on one venue's held-out objects is not evidence about the next
venue, and a 0.9130 fact accuracy over 23 checkable claims can detect a
systematically wrong interpreter but not a subtly miscalibrated one.

What genuinely improved for generalization, and is checkable: no Golden Plan
coordinate or count is hard-coded anywhere; absolute pixel floors were replaced
with plan-relative ones in the chair path, the memory matcher and the zone
clusterer; the tone, surface and chair stages all admit more than one family;
the size-family bin edge that split one column grid in two is gone.

Still absolute and still a generalization risk, catalogued in
`SINGLE-FAMILY-AUDIT.md`: the adaptive-threshold window radius, the Sobel edge
gate, the tone-peak separation in luma units, the single accent hue, and the
luma-only tone model.

## Regression status

| | |
|---|---|
| tests | **18 suites, 393 checks, all passing** (was 14 / 274) |
| detector baseline | **no regressions**, 31 guarded fields |
| robustness baseline | **no regressions** |
| performance | **17 passed, 0 failed**, heap 58.2 MB |
| offline artifacts | **21 passed, 0 failed**, zero off-origin requests |

Six suites were added or extended this sprint: `table-typing`,
`structural-objects`, `plan-encoder`, `plan-memory-isolation`, and new zone,
interpreter and re-seating contracts in `plan-intelligence-contract`.

The detector baseline itself had two gaps closed: relationship fields were being
recorded on every run and compared on none, and neither table type accuracy nor
semantic-object detection was guarded at all — so both of this sprint's first
wins were silently reversible. 19 guarded fields → 31.
