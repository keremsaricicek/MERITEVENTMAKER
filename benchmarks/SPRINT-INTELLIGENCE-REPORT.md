# Intelligence sprint — evidence report

Every number here is a measurement from `npm run benchmark`,
`node benchmarks/robustness/run-robustness.mjs`, `npm run test:all` and
`npm run perf` at the commit this file was written on. Nothing is remembered
and nothing is estimated. Where a gate is not met it says so.

## SPRINT STATUS: **PARTIAL**

Four of the sprint's areas moved on measured evidence. Three were not
attempted and are reported at their existing level rather than described as
architecture that is ready.

| area | before | after | gate | met |
|---|---|---|---|---|
| Plan object detection | ~7.5 | **9** on tables, 8 on chairs | §50 A | partly |
| Degraded/scanned robustness | ~5.5 | **8** | §50 B | medians yes, floors no |
| Operator effort | not scored | **9** | §50 C | yes |
| Relationship intelligence | ~5.5 | **9** on what is annotated | §50 F | yes, on 20 of 113 chairs |
| Teach AI / memory | ~7 | ~7 — not touched this sprint | §50 E | not measured |
| Real visual similarity | ~5.5 | ~5.5 — handcrafted descriptor unchanged | §50 D | **no** |
| Whole-plan interpretation | ~4 | ~4 — not attempted | §50 G | **no** |
| Cross-venue generalization | n/a | **NOT VERIFIED** | §50 H | n/a — one real plan |

---

## PLAN DETECTION

**before 0.891 table F1 / 0.951 chair F1 → after 0.958 / 0.951**

### Real Golden Plan — tables

| | GT | TP | FP | FN | precision | recall | F1 |
|---|---|---|---|---|---|---|---|
| tables | 46 | **46** | 4 | **0** | 0.920 | **1.000** | **0.958** |

Gate: table F1 ≥ 0.92. **Met** (0.958).

Type accuracy on matched tables: square 37/37, round 4/4, **bistro 0/5**. All
five bistro tables are now *found* — they were the plan's only remaining
misses — but every one is typed as something else. Detection recall and type
accuracy are different numbers and this report keeps them apart.

The four false positives are architectural: a wall panel, a plinth, and two
blobs on the main floor.

### Real Golden Plan — chairs

| | GT | TP | FP | FN | precision | recall | F1 |
|---|---|---|---|---|---|---|---|
| chairs | 113 | 107 | 5 | 6 | 0.955 | 0.947 | **0.951** |

| family | GT | TP | FN | recall | gate | met |
|---|---|---|---|---|---|---|
| orange armchair | 79 | 79 | 0 | **1.000** | — | — |
| orange bistro chair | 10 | 8 | 2 | 0.800 | ≥ 0.90 | **no** |
| pale outlined chair | 24 | 20 | 4 | 0.833 | ≥ 0.90 | **no** |

Gate: chair F1 ≥ 0.95. **Met** (0.951). Two of the three family recall gates
are **not** met.

Four of the five false chairs are glyphs of the printed capacity block and the
GİRİŞ label.

### Columns

| plan | GT | TP | FP | FN | recall | precision |
|---|---|---|---|---|---|---|
| `adversarial-architecture` | 6 | 4 | 0 | 2 | **0.667** | 1.000 |
| `adversarial-dense` | 0 | 0 | **0** | 0 | — | — |
| `adversarial-text` | 0 | 0 | **0** | 0 | — | — |
| real Golden Plan | 0 | 0 | **0** | 0 | — | — |

Gate: column recall ≥ 0.80 where annotated. **Not met** (0.667). Precision is
1.000 everywhere, including on the real plan, whose annotation deliberately
records that no columns are identifiable there — nothing was invented to make
the recall number move.

### The other four plans

| plan | table F1 |
|---|---|
| `adversarial-architecture-v1` | 1.000 |
| `adversarial-dense-v1` | 1.000 |
| `adversarial-text-v1` | 1.000 |
| `adversarial-bistro-v1` | 0.878 (18 of 23; the 5 synthetic bistros still missed) |

---

## ROBUSTNESS

**before: median table F1 0.685 → after 0.877**

| variant | tbl TP | tbl FP | tbl F1 | chr TP | chr FP | chr F1 | review |
|---|---|---|---|---|---|---|---|
| `ORIGINAL (real plan)` | 46 | 4 | 0.958 | 107 | 5 | 0.951 | 5 |
| `blur` | 37 | 32 | 0.643 | 113 | 2 | 0.991 | 4 |
| `bright-down` | 24 | 4 | 0.649 | 102 | 1 | 0.944 | 4 |
| `bright-up` | 39 | 48 | 0.586 | 101 | 2 | 0.935 | 5 |
| `contrast-high` | 37 | 49 | 0.561 | 111 | 3 | 0.978 | 5 |
| `contrast-low` | 41 | 2 | 0.921 | 105 | 1 | 0.959 | 5 |
| `crop-pad` | 46 | 3 | 0.968 | 107 | 5 | 0.951 | 5 |
| `downscale-70` | 41 | 4 | 0.901 | 112 | **73** | **0.752** | 5 |
| `grayscale` | 43 | 5 | 0.915 | 104 | 15 | 0.897 | 5 |
| `hue-shift` | 38 | 52 | **0.559** | 113 | 6 | 0.974 | 5 |
| `jpeg-q20` | 45 | 26 | 0.769 | 107 | 3 | 0.960 | 5 |
| `jpeg-q40` | 46 | 4 | 0.958 | 109 | 2 | 0.973 | 5 |
| `lowres-roundtrip` | 28 | 14 | **0.636** | 103 | 3 | 0.941 | 5 |
| `noise` | 46 | 16 | 0.852 | 111 | 6 | 0.965 | 5 |
| `rotate-2` | 45 | 2 | 0.968 | 112 | 11 | 0.949 | 5 |
| `rotate-minus-3` | 41 | 4 | 0.901 | 112 | 6 | 0.970 | 5 |

| gate | target | measured | met |
|---|---|---|---|
| median table F1 | ≥ 0.85 | **0.877** | yes |
| median chair F1 | ≥ 0.90 | **0.955** | yes |
| table floor, JPEG | ≥ 0.75 | 0.769 / 0.958 | yes |
| table floor, small rotation | ≥ 0.75 | 0.968 / 0.901 | yes |
| table floor, low resolution | ≥ 0.75 | **0.636** | **no** |
| table floor, colour variation | ≥ 0.75 | **0.559** | **no** |
| chair floor, all | ≥ 0.85 | **0.752** on `downscale-70` | **no** |
| no downscale FP explosion | — | **73 false chairs** | **no** |

Biggest movements this sprint: `crop-pad` 0.676 → 0.968, `rotate-2` 0.672 →
0.968, `rotate-minus-3` 0.667 → 0.901, `grayscale` 0.820 → 0.915,
`jpeg-q20` 0.714 → 0.769, `lowres-roundtrip` 0.554 → 0.636.

**Every row is the same drawing rendered differently.**

---

## OPERATOR EFFORT

**before 25 decisions → after 10**

| | before | after | gate |
|---|---|---|---|
| review groups | 12 | **5** | ≤ 8 |
| uncertain questions | 13 | **5** | — |
| total decisions | 25 | **10** | ≤ 8 |
| worst degraded variant | 31 groups | **5** | ≤ 15 |

Gate: ≤ 8 high-value review decisions. **Review groups meet it at 5**; groups
plus questions total 10, which does not. The reduction is entirely
consolidation — the suite asserts that every unreviewed low-confidence
candidate is still in exactly one review group, so nothing was hidden to move
the number.

---

## RELATIONSHIP INTELLIGENCE

**before: unmeasured → after: 1.000 on what is annotated**

| | value |
|---|---|
| ground-truth relationships | 24 |
| scored | 20 |
| correct | **20** |
| wrong | 0 |
| orphan | 0 |
| unscoreable (chair not detected) | 4 |
| **accuracy** | **1.000** |

Gate: chair→table ≥ 0.95 on valid annotated relations. **Met.**

The honest caveat: 24 of this plan's 113 chairs carry a relationship
annotation, so this is a perfect score over 20 chairs, not over the plan.
Extending the annotation is the way to make this number mean more.

---

## VISUAL SIMILARITY — **BELOW 9, NOT ATTEMPTED**

- active embedding: the handcrafted descriptor (fill ratio, edge density,
  intensity histogram, quadrant signature)
- `trainedModel`: **false**
- no learned checkpoint was evaluated, licensed, benchmarked or installed
- no retrieval benchmark (Top-1 / Top-5 purity) was built

The sprint requires a real learned representation for this gate and explicitly
forbids counting the existing descriptor as one. It is not counted.

## TEACH AI / MEMORY — **NOT MEASURED THIS SPRINT**

The capture, propagation and plan-memory machinery from earlier work is intact
and covered by `training-data-capture` (46 checks). No strong-match precision
figure and no re-analyze retention figure were produced, so the gate is not
claimed.

## WHOLE-PLAN INTERPRETATION — **BELOW 9, NOT ATTEMPTED**

No `WholePlanInterpreter`, no first-class zones, no semantic-fact benchmark.
The existing scene graph and capacity audit are unchanged.

## GENERALIZATION

**REAL DISTINCT VENUE PLANS AVAILABLE: 1**

**Cross-venue generalization: NOT VERIFIED.**

Readiness held to this sprint's standard:

- no Golden Plan coordinate or count is hard-coded anywhere in detection
- the plan is deskewed before measurement, so rotation is normalised
- absolute pixel floors in the chair path were replaced with plan-relative ones
- the tone, surface and chair stages all admit more than one family
- transformed real-plan testing is in CI-able form and re-recorded each change
- the dataset splits group by plan, so one venue cannot appear on both sides

Still absolute and still a generalization risk, catalogued in
`SINGLE-FAMILY-AUDIT.md`: the adaptive-threshold window radius, the Sobel edge
gate, the tone-peak separation in luma units, the single accent hue, and the
luma-only tone model.

---

## MODEL STATUS

| | |
|---|---|
| active detector | classical CV (`classical-cv` provider) |
| detector `trainedModel` | **false** |
| active embedding | handcrafted visual descriptor |
| embedding `trainedModel` | **false** |
| model size | none — no weights are installed |
| runtime | in-page JavaScript, no network |

The UI continues to say **DOMAIN MODEL NOT INSTALLED**.

## PERFORMANCE

`npm run perf`: **17 passed, 0 failed.** 400 tables / 3000 guests / 4000
chairs / 4500 pax survive a save-reload round trip with data integrity OK,
clean console, 58.7 MB heap. Detection on the real plan is ~900 ms, up from
~830 ms before the deskew pass.

## TESTS

`npm run test:all`: **14 suites, 274 checks, all passing.** Two suites were
added or extended this sprint — `chair-families` (16 checks) and five new
review-consolidation contracts in `plan-intelligence-contract`.

Offline artifacts rebuilt and **run**: `verify-offline-package` 19 passed,
0 failed, zero off-origin requests, real OCR exercised.

## WHAT WOULD MOVE THE REMAINING GATES

In the order the evidence supports, from `SINGLE-FAMILY-AUDIT.md`:

1. **E2** — the surface filter accepts everything when it loses its evidence.
   `bright-up` (0.586) and `contrast-high` (0.561) are that failure:
   `brightness(1.18)` clips the pale table fill into the paper. A stage that
   loses its evidence must defer to review, not pass candidates through.
2. **C4–C6** — the remaining absolute constants (threshold window, Sobel gate,
   luma peak separation). `blur`, `bright-down` and `lowres-roundtrip` are here.
3. **downscale-70's 73 false chairs** — cause known and written down; the
   family `crowding` diagnostic separates debris from real minority families by
   only 17%, which is not margin enough to delete on.
4. **B1–B5** — table size and aspect modals, the same per-family fix already
   proven for chairs, which is also what would type the bistro tables correctly.
5. **A2/A3** — the luma-only tone model and the single accent hue: real
   generalization gaps with no Golden Plan evidence behind them.
