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

### 2026-10-18 — losses split by cause; the one wrong application closed

The scorer now says WHY a decision was lost: **object not found** (no candidate
on the changed plan lands on the object the decision was made on — the
detector lost it) or **found but not matched** (a candidate lands on it and the
matcher did not apply the decision). Each lost decision is printed with its
cause and, when found, what it was detected as.

Measured after the junk-word seat rule (`d8a7af2`): retention 0.8447 → 0.8758.
The one wrong application (greyscale) was a table the person re-typed as a
chair: the table was not detected there, and the decision landed 2.9 % away —
beyond the old tolerance, graded "likely" on look (cosine 0.86) and
neighbourhood — on the wall pilaster, a column. Past the old tolerance a
decision about furniture (a table or a seat) no longer lands on structure, nor
the reverse; at the decision's own place family stays evidence only, so a
re-typed column still works (suite `plan-memory`, case 3b, red before).

| | before | after |
|---|--:|--:|
| retention | 0.8758 | **0.8758** (141 / 161) |
| wrong applications | 1 (0.007) | **0** |
| identity precision | 0.993 | **1.0** |
| lost: object not found | 15 | 16 |
| lost: found but not matched | 4 | 4 |

What the 20 losses are:
- **9 are rejections whose object the detector no longer proposes** (c012 ×5,
  t044 ×3, t036). Nothing reappears for the person to reject again; they are
  still counted lost, because the scorer counts a decision retained only when
  it lands on its object.
- **7 are confirmations or re-typings of objects the detector does not find**
  on that rendering (six on jpeg-q20, the pilaster case on greyscale). Memory
  cannot apply a decision to an object that is not there, and re-making one
  from the crop was built and refused on 2026-10-11 as fabrication. These are
  detector stability under degradation (jpeg-q20 tables 34 / 8 / 12).
- **4 are found but not matched, all on jpeg-q20**: the candidate on the object
  is a fragment (1.5 × 5.5 % against a 3.4 × 5.5 % table, a square read as
  round) and the matcher abstains (9 ambiguous reported). Forcing those would
  trade the zero wrong applications for retention.

§23 (retention ≥ 0.98) is **not met**; wrong application ≤ 0.01 and identity
precision ≥ 0.98 are met on every scenario. Baseline re-recorded with that reason.

### 2026-10-11 — a recognition layer, built, measured, and not shipped

**Question.** Can the remaining losses be recovered from the confirmed crop
itself? The idea was to look for a confirmed object the detector no longer finds
at the spot where the plan's own strong matches place it, and re-make it if the
learned embedding there is at cosine ≥ 0.9.

**Design.** `MeritPlanMemory.recognise` refused on any one of these:
- the decision is not a confirmation;
- the frame is not established (fewer than four strong matches, or movement no
  single transform explains);
- any detection stands on the spot;
- the crop does not look like the confirmed one.

A decision the matcher called AMBIGUOUS was looked for only at its own spot,
never by choosing between the tied candidates. A Node suite pinned every
refusal on its own.

**Measured:** 0 recognised on all seven scenarios. Retention stayed 0.8447 and
the wrong-application rate 0.0073.

The layer records every refusal with its reason, read from the app's own pass:

| scenario | not retained | what the layer recorded |
|---|--:|---|
| jpeg-q20 | 12 | 8 confirmations considered, all 8 refused because **a detection stands on the spot**, at overlap 1.00. It is a detection of a different shape: a rectangle spanning the table and its neighbour, or a square read as round. |
| crop-pad | 1 | refused: too few strong matches to establish a frame |
| grayscale, downscale-70, rotate-2, blur | 2–4 | not asked: in the app's own pass no confirmation was left unplaced or tied |
| identical | 0 | not asked |

The unretained decisions the scorer names in the last two rows are rejections
and reclassifications. The same three objects come up every time: a rejected
rectangle at a chair's position (c012), a table re-typed as a chair beside a
column (t042, the one wrong application on grayscale), and a rejected bistro
(t044). This layer does not touch any of them.

The decision therefore has no single object to land on. Re-making a second
object on top of a detection that already covers it would be the fabrication
this layer exists to avoid, so the refusal is correct and the layer has nothing
to recover on this corpus. It adds a code path with no measured benefit, so it
is not in the product. The patch, the suite and the probe that produced the
table above are kept outside the repository.

What would move this number is the **detector's stability under degradation**:
the same object read as the same shape after a JPEG round trip at q20. That
belongs to the detector's benchmarks, not to memory. The §23 targets (≥ 0.98,
≤ 0.01) remain **not met**.

### 2026-10-10 — the global transform is affine, and a plan scanned askew is recovered

At the start of this session the detector had moved on and this corpus read
retention **0.8012**, identity precision 0.9923, wrong-application rate 0.0077.
The one wrong application is a grayscale case unrelated to this change.
`rotate-2` kept 14 of 23 decisions, and switching the transform off changed
nothing there. The similarity fit (one scale, one offset) left too much
residual on a 2° rotation and fitted nothing. In plan-percent a rotation is not
even a pure rotation, because the two axes have different lengths.

The fit is now **affine**: rotation, scale per axis and offset. It is least
squares over the confident matches, trimmed once, and refused unless at least
60% of them agree, the residual is small, the scale is plausible and the
rotation is small. The similarity fit remains the fallback for anchors that lie
on one line. After a correction only STRONG matches still apply, as before.

| scenario | before | after |
|---|--:|--:|
| identical | 23/23 | 23/23 |
| jpeg-q20 | 11/23 | 11/23 |
| grayscale | 20/23 (1 wrong) | 20/23 (1 wrong) |
| downscale-70 | 20/23 | 20/23 |
| **rotate-2** | **14/23** | **21/23, 0 wrong** |
| crop-pad | 22/23 | 22/23 |
| blur | 19/23 | 19/23 |
| **all** | retention 0.8012 | **retention 0.8447**, identity precision 0.9927, the transform recovers 12 and misapplies 0 |

Recorded as the baseline with this reason. §23 retention ≥ 0.98 is still **not
met**. What remains is in jpeg-q20 and blur, where the re-analysis of the
degraded image finds different objects. That is a detection-quality loss, not
an alignment one, and no transform recovers it.

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
