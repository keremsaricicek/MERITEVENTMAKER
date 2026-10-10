# Does a human decision survive a plan that changed?

```
npm run benchmark:memory          # the seven scenarios, and the ablation (exit 1: §23 targets unmet)
npm run benchmark:memory -- --compare   # the CI regression gate against BASELINE.json
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

Re-measure with `npm run benchmark:memory`.

### 2026-10-04 — the harness was scoring transformed plans against the original

Where a re-applied decision LANDED was located with the ORIGINAL plan's
annotation and size for every scenario. On `rotate-2` and `crop-pad` the
drawing's frame changed (crop-pad is 1475×856 against 1355×788), so a decision
that came back on the right table was located up to ~25 px from where that
table now sits — and this plan's chairs sit closer together than that. The
nearest annotated object could be a neighbour, and a correct application was
scored as a wrong one. Each variant already carries its own annotation
(`benchmarks/robustness/annotations/`, same object ids, the same transform as
its pixels — drawn back onto the image with `check-variant-truth.mjs` to
confirm it lands); the harness now scores against it. Same product, same 182
decisions, scored correctly:

| scenario | retained | wrong | lost | ambiguous (not applied) |
|---|--:|--:|--:|--:|
| identical *(control)* | **26/26** | 0 | 0 | 0 |
| grayscale | 23/26 | 0 | 3 | 0 |
| downscale-70 | 22/26 | 0 | 4 | 3 |
| jpeg-q20 | 12/26 | 0 | 14 | 9 |
| blur | 12/26 | 0 | 14 | 10 |
| rotate-2 | 14/26 *(was 12)* | **0** *(was 2)* | 12 | 11 |
| crop-pad | 10/26 *(was 7)* | **0** *(was 3)* | 16 | 15 |

**Across all seven: retention 0.6538, identity precision 1.0, wrong application
rate 0** (was 0.042). Every one of the five "wrong applications" in the table
below was the harness, not the product. The five scenarios whose frame did not
change score exactly as before — the control for the fix.

That table is the matcher as it shipped then, with the global-transform
correction off. With it switched on (see below; the shipped configuration since
the same day) crop-pad retains 25 of 26 and every other row is unchanged:
**retention 0.7363, identity precision 1.0, wrong application 0.**

Against the §23 targets: wrong application ≤ 0.01 and identity precision ≥ 0.98
are **met on this corpus**; retention ≥ 0.98 is **not** (0.7363). One real
venue drawing, transformed seven ways — not a second venue.

The decisions this file and `src/plan-memory.js` recorded from the old scoring
— the `likely` grade sweep and keeping the global-transform correction off —
were made on numbers that counted correct applications as wrong. They are
re-measured below rather than defended.

### 2026-09-27 — §27, as recorded then (scored against the original plan)

Measured with the pinned OCR engine that every runner now serves from
`.vendor-cache`, and equal in every scenario to CI's printed run at `ff023c0`.

26 decisions per scenario, propagation included — reclassifications,
confirmations and rejections, made through the real review controls.

| scenario | retained | wrong | lost | ambiguous (not applied) |
|---|--:|--:|--:|--:|
| identical *(control)* | **26/26** | 0 | 0 | 0 |
| grayscale | 23/26 | 0 | 3 | 0 |
| downscale-70 | 22/26 | 0 | 4 | 3 |
| jpeg-q20 | 12/26 | 0 | 14 | 9 |
| blur | 12/26 | 0 | 14 | 10 |
| rotate-2 | 12/26 | 2 | 12 | 11 |
| crop-pad | 7/26 | 3 | 16 | 15 |

**Across all seven: retention 0.6264, identity precision 0.958, wrong
application rate 0.042.**

Against the §23 targets (retention ≥ 0.98, identity precision ≥ 0.98, wrong
application ≤ 0.01): **met on an unchanged plan, not met on transformed ones**,
and no setting reaches them (§9 of the master programme: a signal problem, not
threshold placement).

> **Every earlier number in this file's history was measured without OCR.**
> Until §27 the runner fetched the OCR engine from jsDelivr; CI could reach it
> and the development container could not, so the container recorded 28
> decisions per scenario and retention 0.7143 (and, before that, 0.786) while
> CI measured this table. Those are a different configuration of the app, not
> an earlier state of this one.

### How CI uses it

`npm run benchmark:memory -- --compare` is a **regression gate**: it fails on
anything worse than `BASELINE.json` — above all one more wrong application,
which an operator cannot see — and prints the §23 targets as NOT MET on every
run. The §23 targets themselves are INFO, not a gate: gating on them would be
permanently red, and wrapping that in `continue-on-error` (as CI did until §27)
made the step unable to fail at all. Without flags the script still exits 1
while the targets are unmet.

## Does the learned embedding contribute? — the §24 answer

It is wired in: the encoder's vector for the actual crop is stored with every
decision and compared by cosine on every match. Whether it **helps** cannot be
answered by shipping it, so every scenario is scored three ways over identical
inputs.

| | retention, with OCR (§27) | retention, without OCR (§24 sprint) |
|---|--:|--:|
| full model | 0.6264 | 0.786 |
| without the learned embedding | 0.6209 | **0.796** |
| without the neighbourhood signature | **0.6319** | 0.791 |

> **No material contribution in either configuration.** With OCR the embedding
> recovers 1 of 182 decisions and the neighbourhood signature costs 1; without
> OCR the embedding cost 2. Re-measure with `npm run benchmark:memory`.

Reported as required, not explained away. The reason is worth stating because it
is a property of the approach rather than of this encoder:

**A learned embedding cannot tell one copy of an object from another copy of the
same object.** 37 of this plan's tables are near-identical squares, and the
encoder rates every one of them ~0.9 similar to every other. Identity on a
repetitive drawing is exactly the question it cannot answer. The same encoder is
genuinely useful for **class** — that is what `benchmarks/embedding/SECOND-OPINION.md`
measures, and there it earns its place.

What it did buy, once its say was scaled by how uncertain geometry is — the §24
sprint's measurement, taken without OCR and not repeated since:

| | flat weight | scaled by geometric uncertainty |
|---|--:|--:|
| retention | 0.801 | 0.786 |
| identity precision | 0.913 | **0.945** |
| wrong application rate | 0.087 | **0.055** |

Fewer decisions land on the wrong object. Given the choice, that is the half to
optimise — see below.

## The global-transform correction — ON since 2026-10-04

A re-cropped plan moves **everything** by the same amount, and per-object
identity cannot see that: each box is individually beyond its own tolerance, so
each is individually lost. What can see it is the plan's own confident matches —
if they agree on a displacement and a scale, the drawing moved.

It shipped **off** because §27 measured it as +7 recovered / +7 misapplied. Those
misapplications were the harness's (see "the harness was scoring transformed
plans against the original" above). Scored against each rendering's own
annotation, over the same 182 decisions:

| | off | **on (shipped)** |
|---|--:|--:|
| retention | 0.6538 | **0.7363** |
| identity precision | 1.0 | 1.0 |
| decisions recovered | — | +15 (all on crop-pad: 10 → 25 of 26) |
| decisions misapplied | — | **0** |

**A lost decision is reported; the operator sees it and re-makes it. A wrongly
applied one is invisible, and it corrupts a plan while looking like the feature
worked.** That rule is why it was off, and it is what keeps it on: every run
prints how many decisions it misapplies, and the memory gate blocks on one more
wrong application than the baseline. `{ shift: false }` switches it off.

(The benchmark's own "without global-transform" ablation reads 0.6758, not
0.6538: it re-runs the matcher on the candidates the shipped matcher has already
re-labelled, which changes their family terms. The off/on comparison above is
two whole runs of the product, one with the correction off and one with it on.)

Applies to remembered review decisions only. The Teach Area passes
`{ shift: false }`: its lessons were not part of this measurement, and
`plan-memory` pins that they still land exactly where the uncorrected matcher
puts them.

The grade sweep was re-run on the corrected scoring too (from one captured run,
replayed through `src/plan-memory.js`): the looser `likely` settings DO misapply
(0.62/0.04: 4 wrong without the correction, 1 with it), and 0.68/0.12 misapplies
none — so the grade stays. The table is beside the constant in the source.

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
