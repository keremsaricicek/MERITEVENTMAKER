# Robustness — one real plan, fifteen renderings

```
node benchmarks/robustness/make-variants.mjs      # generate images + transformed truth
node benchmarks/robustness/run-robustness.mjs     # measure, compare to BASELINE.json
node benchmarks/robustness/run-robustness.mjs --record
node benchmarks/robustness/check-variant-truth.mjs rotate-2 /tmp/check.png
```

## These are not extra real plans

**One real venue plan exists in this repository.** Every image in `variants/` is
that same drawing with a transform applied. Each generated annotation carries
`derivedFrom: "merit-real-venue"` and `isRealVenue: false`, and the runner
prints the count of real distinct venue plans on every run.

A good score here is evidence that detection survives a rescan, a JPEG, a
photocopy or a crooked import. It is evidence of **nothing** about a venue this
system has not seen.

## The truth is transformed, not reused

Each variant declares how it maps a source pixel to a variant pixel, and the
annotation goes through the same map — rotated boxes grow to their axis-aligned
extent, scaled boxes scale, padded coordinates shift, and a chair whose facing
was measured has that facing rotated too. `check-variant-truth.mjs` draws the
transformed truth back onto the transformed image; the rotation map was
verified that way before any number below was believed.

## What it found

**Re-measured; the table below is the current run, and it replaces an earlier
one that is now wrong in two of its three conclusions.** The original plan
scores tables F1 **0.958** with 4 false positives and chairs 107 TP / 5 FP.

| variant | tbl F1 | tbl FP | tbl recall | chr F1 | triage |
|---|---|---|---|---|---|
| crop-pad | **0.968** | 3 | 1.000 | 0.951 | HEALTHY |
| rotate-2 | 0.968 | 2 | 0.978 | 0.949 | HEALTHY |
| jpeg-q40 | 0.958 | 4 | 1.000 | 0.973 | HEALTHY |
| contrast-low | 0.921 | 2 | 0.891 | 0.959 | HEALTHY |
| grayscale | 0.915 | 5 | 0.935 | 0.897 | ACCEPTABLE |
| rotate-minus-3 | 0.901 | 4 | 0.891 | 0.970 | HEALTHY |
| downscale-70 | 0.901 | 4 | 0.891 | **0.752** | WEAK |
| noise | 0.852 | 16 | 1.000 | 0.965 | ACCEPTABLE |
| jpeg-q20 | 0.769 | **26** | 0.978 | 0.960 | SEVERE |
| bright-down | 0.649 | 4 | **0.522** | 0.944 | SEVERE |
| blur | 0.643 | **32** | 0.804 | 0.991 | SEVERE |
| lowres-roundtrip | 0.636 | 14 | **0.609** | 0.941 | SEVERE |
| bright-up | 0.586 | **48** | 0.848 | 0.935 | SEVERE |
| hue-shift | 0.559 | **52** | 0.826 | 0.974 | SEVERE |
| contrast-high | 0.561 | **49** | 0.804 | 0.978 | SEVERE |

Median across all renderings: table F1 0.877, chair F1 0.955.

### Two of the three earlier findings no longer hold

The previous version of this section named padding and grayscale as the
leading problems. Both have moved, and leaving them here would send the next
reader after work that is already done:

- **"Padding alone costs 0.24 of table F1" is FIXED.** `crop-pad` is now
  0.968 F1 with 3 false positives and perfect recall — better than the
  original. Detection is translation-invariant on this corpus.
- **"Grayscale invents 561 chairs" is FIXED.** Grayscale is now 5 table FPs
  and chair F1 0.897, triaged ACCEPTABLE.
- **Resolution loss is still real**, and is now joined by a larger family.

### The one finding that remains, and what it actually is

**Seven of fifteen renderings are SEVERE, and six of them fail the same way:
a global photometric change explodes table FALSE POSITIVES.**

    original        4 false tables
    jpeg-q20       26
    blur           32
    bright-up      48
    contrast-high  49
    hue-shift      52

Chair detection barely moves on any of them — blur scores chair F1 **0.991**,
its best row anywhere. So this is not "the image got worse". It is the TABLE
path specifically, and the mechanism is visible in the source: `detect()`
builds its luma histogram, its Otsu threshold, its RGB colour model and its
low/mid-chroma tone histograms over **every pixel of the canvas**. Shift the
whole image's brightness, contrast or hue and every one of those global
statistics moves with it, and the binarisation starts admitting background
texture as components.

The other two SEVERE rows are the same statistics failing in the opposite
direction: `bright-down` keeps false positives at 4 but loses recall to
0.522, and `lowres-roundtrip` to 0.609.

**This is the open §10 work.** It is not a threshold to nudge: the fix has to
make those global statistics robust to a photometric shift, and it changes
the answer on every plan, so it needs the golden baseline, all eight
adversarial fixtures and all fifteen variants measured together.

## 2026-10-17 — what breaks, and two changes that held up

Baseline at `597b0cc` (`node benchmarks/robustness/run-robustness.mjs`): 8 HEALTHY,
3 WEAK, 5 SEVERE. `node benchmarks/detection/diagnose-types.mjs` (new) names the
source and stage of every false and missed table:

- **hue-shift, contrast-high, bright-up** (30–39 false tables): table-sized
  proposals from the `fill` source at the armchairs of the pushed-together rows
  (an armchair plus a table edge), while the round and bistro tables
  (t038–t046) are missed. On the original the same tables come from the `tone`
  source; the colour change moves the tone/accent models, not the Otsu threshold
  (178 vs 179 — measured and ruled out).
- **bright-down** (recall 0.54): the local model found the missing tables and
  fusion added 16 of them, but text suppression then deleted 14: Tesseract read
  word boxes off the darkened table fills (35 suppressions against 5 on the
  original).
- **lowres-roundtrip** (recall 0.37): fusion refused 15 of the model's real tables
  as "off size", measured against the median of the classical proposals, which
  on this rendering are fragments.

**The local model alone is stable on every rendering**: tables 43–46 of 46 found,
0–1 false, on all sixteen (`tools/model-dev` + ONNX Runtime, threshold 0.5).

**Kept** (`src/app-v8.js`, `src/plan-model-fusion.js`):
1. a table the model ADDED, confidently and at the plan's table size (the ones
   fusion selects), is exempt from text suppression — it exists only where the
   classical pass proposed nothing, and the model reads shapes, not glyphs;
2. fusion's size reference is the median of the MODEL's own boxes for the
   tables both witnesses see, when there are at least five (otherwise the
   classical median, as before). A first version took the classical boxes of
   those agreed tables and did not help lowres-roundtrip: the classical box
   beside a model table there is itself a fragment, and 15 tables were still
   refused as off size. On a plan where the two agree the model's box of an
   agreed table is the same furniture at the same scale, so the ±40 % gate
   still refuses the Golden plan's 24 px planter.

Triage is the runner's own (`run-robustness.mjs`, `triage()`), counted over the
original and its fifteen renderings.

| rendering | `597b0cc` tables TP/FP/FN | now | triage `597b0cc` → now |
|---|---|---|---|
| bright-down | 24 / 4 / 22 | **43 / 4 / 3** | SEVERE → **ACCEPTABLE** (chairs 91/2/22) |
| lowres-roundtrip | 17 / 7 / 29 | **32 / 7 / 14** | SEVERE → WEAK |
| blur | 37 / 16 / 9 | 42 / 16 / 4 | WEAK → ACCEPTABLE |
| bright-up | 37 / 30 / 9 | 43 / 30 / 3 | SEVERE (30 false) |
| contrast-high | 37 / 36 / 9 | 43 / 36 / 3 | SEVERE (36 false) |
| hue-shift | 38 / 39 / 8 | 43 / 39 / 3 | SEVERE (39 false) |
| contrast-low | 41 / 1 / 5 | 43 / 1 / 3 | HEALTHY |
| downscale-70 | 41 / 1 / 5 | 43 / 1 / 3 | WEAK (69 false chairs) |
| jpeg-q20 | 33 / 8 / 13 | 34 / 8 / 12 | WEAK |
| rotate-2 | 44 / 2 / 2 | 46 / 2 / 0 | HEALTHY |
| rotate-minus-3 | 41 / 2 / 5 | 44 / 2 / 2 | HEALTHY |
| crop-pad, grayscale, jpeg-q40, noise | unchanged | unchanged | HEALTHY |

8 HEALTHY / 3 WEAK / 5 SEVERE → **8 HEALTHY / 2 ACCEPTABLE / 3 WEAK / 3 SEVERE**.
Mean table F1 over the fifteen renderings 0.811 → 0.871; no rendering lost a
table or gained a false one; chairs unchanged. Every false table that remains is
the colour-dependent tone/accent stage (below). Two bistro tables are now FOUND
on several renderings but typed round (the model has no bistro class).
Regression gates on the same source: `benchmark:baseline` no regressions
(ORNEK 162 → 166 of 166), adversarial 0 blocking (a6 table F1 0.432 → 0.457),
false-positive gates met; the detector fingerprint was re-recorded for this
behaviour change (11 of 28 plans differ, all through fusion).

**Tried and refused — holding back the classical tables the model does not see.**
A plan-wide "classical breakdown" verdict (the model saw ≥ 10 tables, ≥ 80 % of
them confirmed by the classical pass, and the classical pass proposed ≥ max(5,
20 %) tables the model does not support; thresholds fixed before scoring) held
those tables back. It removed the false tables (hue-shift 39 → 0, contrast-high
36 → 0, bright-up 30 → 0) but also real ones, and it fired on renderings that
were fine: noise 46/3/0 → 38/0/8, blur 37 → 26 found, hue-shift 39 → 27, chairs
falling with their tables. Pairing by box overlap instead of centre distance
changed nothing. A held table was centred on a real one 15 of 18 times on noise,
so the unsupported proposals are mostly offset duplicates and fragments of real
tables, which this rule cannot tell from the real table. Not shipped; the false
tables on hue-shift, contrast-high and bright-up stay OPEN, at their cause (the
colour-dependent tone/accent stage), not at the fusion.
