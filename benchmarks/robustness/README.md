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

The original plan scores tables F1 0.882 and chairs 79/113 with zero false
chairs. Against that:

| variant | tbl F1 | chr TP | chr FP | note |
|---|---|---|---|---|
| **contrast-low** | **0.921** | 79 | 0 | better than the original |
| **downscale-70** | 0.911 | 79 | 0 | holds |
| **jpeg-q40** | 0.901 | 79 | 0 | holds |
| noise | 0.811 | 79 | 0 | holds |
| grayscale | 0.739 | **113** | **561** | see below |
| rotate-2 | 0.695 | 89 | 119 | |
| blur | 0.667 | 79 | 0 | |
| bright-down | 0.649 | 79 | 0 | 24 of 46 tables |
| **crop-pad** | **0.646** | 79 | 0 | *nothing changed but the margin* |
| bright-up | 0.578 | 79 | 0 | 45 false tables |
| hue-shift | 0.563 | 79 | 0 | 51 false tables |
| jpeg-q20 | 0.476 | 69 | 1 | 15 of 46 tables |
| **lowres-roundtrip** | **0.133** | 66 | 0 | 4 of 46 tables |

Three findings worth acting on, in order:

**1. Grayscale finds every chair.** 113 of 113, including all 24 pale outlined
chairs and all 10 bistro chairs that the colour path misses entirely on the
original. It also invents 561. So the pale and bistro families are not
invisible to this pipeline — the *colour* path discards them. That is the same
"one global decision deletes minority families" pattern as the table-size,
table-aspect and chair-shape findings in `../BISTRO-MERGE.md`, and it is the
strongest lead for the 34 missed chairs.

**2. Padding alone costs 0.24 of table F1.** `crop-pad` changes no pixel of the
drawing — it adds margin. Table F1 falls 0.882 to 0.646 and false positives go
6 to 42. Detection should be close to translation-invariant and is not.

**3. Resolution loss is catastrophic, brightness is not far behind.** A
downscale-and-upscale round trip leaves 4 tables of 46. Brightness ±18% costs
0.23–0.30 of F1 and, upward, produces 45 false tables. These are the thresholds
adapting badly, and they are the difference between a plan that arrives as a
clean export and one photographed off a desk.

## What this does not claim

Only rendering robustness on one drawing. Cross-venue generalisation is
**unverified** and cannot be verified from this repository's contents.
