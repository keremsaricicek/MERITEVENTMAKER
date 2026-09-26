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
