# Does a human decision survive a plan that changed?

```
npm run benchmark:memory          # the seven scenarios, and the ablation
npm run benchmark:teaching        # propagation + retention on an unchanged plan
node tests/run.mjs plan-memory    # the properties a benchmark cannot see
```

## The question this exists to ask

`benchmarks/teach-ai/` already measures retention across a re-analysis and
reports **1.0000**. That number is real, and it is the easy question. The
detector is deterministic, so re-running it on identical pixels puts every box
back within a fraction of a percent and geometry alone gets full marks. What it
measures is **determinism**, not identity.

This measures identity. The same decisions are made, and then the plan is
replaced by a version of itself an operator would plausibly be handed next: the
same drawing mailed as a JPEG, exported without colour, re-issued smaller,
scanned askew, re-cropped. A decision that survives that was matched on what the
object **is**, not on where the detector happened to put a box.

## Results

28 decisions per scenario — reclassifications, confirmations and rejections in
equal measure, made through the real review controls.

| scenario | retained | wrong | lost | ambiguous (not applied) | identity precision |
|---|--:|--:|--:|--:|--:|
| identical *(control)* | **28/28** | 0 | 0 | 0 | 1.000 |
| grayscale | **28/28** | 0 | 0 | 0 | 1.000 |
| blur | 24/28 | 0 | 4 | 2 | 1.000 |
| downscale-70 | 23/28 | 0 | 5 | 4 | 1.000 |
| jpeg-q20 | 20/28 | 2 | 6 | 6 | 0.909 |
| rotate-2 | 18/28 | 4 | 6 | 5 | 0.818 |
| crop-pad | 16/28 | 5 | 7 | 6 | 0.762 |

**Across all seven: retention 0.786, identity precision 0.945, wrong application
rate 0.055.**

Against the §23 gates (retention ≥ 0.98, identity precision ≥ 0.98, wrong
application ≤ 0.01):

> **MET on an unchanged plan. NOT MET on transformed plans.**

That split is the finding. Nothing regressed — the case that was previously
measured is still 1.000 — and the harder case this sprint introduced is where
the product actually stands.

The four scenarios that hold up (identical, greyscale, blur, downscale) share a
property: the image frame is unchanged, so percentage geometry is preserved. The
three that degrade (jpeg, rotate, crop-pad) all change the frame or the linework
enough to move boxes past their own tolerance.

## Does the learned embedding contribute? — the §24 answer

It is wired in: the encoder's vector for the actual crop is stored with every
decision and compared by cosine on every match. Whether it **helps** cannot be
answered by shipping it, so every scenario is scored three ways over identical
inputs.

| | retention |
|---|--:|
| full model | 0.786 |
| **without the learned embedding** | **0.796** |
| without the neighbourhood signature | 0.791 |

> **NO MEASURABLE CONTRIBUTION on this corpus. It costs 2 decisions.**

Reported as required, not explained away. The reason is worth stating because it
is a property of the approach rather than of this encoder:

**A learned embedding cannot tell one copy of an object from another copy of the
same object.** 37 of this plan's tables are near-identical squares, and the
encoder rates every one of them ~0.9 similar to every other. Identity on a
repetitive drawing is exactly the question it cannot answer. The same encoder is
genuinely useful for **class** — that is what `benchmarks/embedding/SECOND-OPINION.md`
measures, and there it earns its place.

What it did buy, once its say was scaled by how uncertain geometry is:

| | flat weight | scaled by geometric uncertainty |
|---|--:|--:|
| retention | 0.801 | 0.786 |
| identity precision | 0.913 | **0.945** |
| wrong application rate | 0.087 | **0.055** |

Fewer decisions land on the wrong object. Given the choice, that is the half to
optimise — see below.

## The global-transform correction, which ships OFF

A re-cropped plan moves **everything** by the same amount, and per-object
identity cannot see that: each box is individually beyond its own tolerance, so
each is individually lost. What can see it is the plan's own confident matches —
if they agree on a displacement and a scale, the drawing moved.

It is implemented, it works, and it is off by default:

| | shipped | with the correction |
|---|--:|--:|
| retention | 0.786 | 0.801 |
| identity precision | **0.945** | 0.929 |
| decisions recovered | — | +3 |
| decisions misapplied | — | +3 |

**A lost decision is reported; the operator sees it and re-makes it. A wrongly
applied one is invisible, and it corrupts a plan while looking like the feature
worked.** Three recovered is not worth three of those. Enable with
`{ shift: true }` when a second real plan can re-decide it with its own evidence.

Two things were tried and measured on the way, and both are recorded in the
source rather than rediscovered later: fitting only a translation recovers
nothing (the frame rescales too — crop-pad is 1475×856 against 1355×788, so
objects shrink by 1.086 in percent space), and seeding the fit only from matches
already inside the old tolerance keeps exactly the anchors that needed no
correcting.

## Four answers, not two

| grade | what it means | applied? |
|---|---|---|
| STRONG | high score, clear margin over the runner-up | yes |
| LIKELY | good score, some margin | yes |
| **AMBIGUOUS** | two candidates fit about equally well | **no** — reported as `contra:memoryAmbiguous` |
| NONE | no match | no — reported as a lost decision, never fabricated back |

The abstention is the part a retention number cannot reward. A matcher that
quietly picked one of two equally good candidates would score **better** on
retention while being precisely the failure this design exists to prevent, which
is why `tests/suites/plan-memory.test.mjs` pins it directly.

Family compatibility is **evidence, never a gate**. The most valuable memory
entry is a reclassification — the detector said table, the operator said chair —
and the detector will say table again next run because it is deterministic.
Requiring the kinds to match would make exactly those impossible to re-apply.

## What a decision now stores

Beyond position and size: the learned encoder's vector for the crop, the
provider and model version that produced it, and a neighbourhood signature (the
sorted distances to the six nearest objects — distances only, because a sorted
distance vector survives a small reflow where bearings turn a two-pixel jitter
into a large difference).

## A scorer bug worth remembering

The first run of this file reported **0.786 on the control**, which looked like a
product regression and was not. The ablation was scored against
`candidates.filter(c => c.status !== "rejected")` — and by the time it runs, a
rejection memory's object **is** a rejected candidate. Filtering them out removed
exactly the objects a third of the decisions were about. The shipped path always
saw the full list.

REAL DISTINCT VENUE PLANS: 1. CROSS-VENUE GENERALIZATION: NOT VERIFIED.
