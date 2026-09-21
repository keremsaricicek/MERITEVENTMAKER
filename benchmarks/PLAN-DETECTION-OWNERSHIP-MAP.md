# `plan-detection-classical.js` — internal ownership map

**Status of the file this describes: TRANSITIONAL EXTRACTION, not a finished
module.** 2,858 lines in one file is not a healthy unit and is not reported as
one. What the extraction bought is a **boundary** the pipeline did not have:
the app now reaches it through one registry, and it reaches back into nothing.
That boundary is what makes the split below safe to do next.

This document is the map for that split. **Nothing here has been moved.**

## What the file is

| | |
|---|---|
| Lines | 2,858 (2,809 moved + 49 of header and IIFE) |
| Top-level functions | 24 |
| Public surface | 3 names |
| Shell globals read | **0** — no `state`, `ui`, `render()`, `touchEvent()` |
| Entry point | `globalThis.MERIT_PLAN_DETECTION` |

### The public surface, in full

```js
globalThis.MERIT_PLAN_DETECTION = { providers, resolve(), activeId, trainedModelInstalled:false }
globalThis.MeritSymbolFamilyMember   // family predicate, called by the detection benchmarks
globalThis.MERIT_STAGE_CENSUS        // per-stage diagnostic census, only under MERIT_DETECT_DEBUG
```

`MERIT_STAGE_CENSUS` is measurement surface, not app surface: it is what
`benchmarks/heldout/ornek-stage-walk.mjs` reads to name the stage each missed
object died at. The product never reads it.

### The provider contract

```js
{
  id: "classical-cv",
  label: "Assisted Detection (classical computer vision)",
  trainedModel: false,
  estimatePlanSkew(canvas, width, height) -> { deg, gain, measured, applyDeg },
  async detect(pixels, width, height, { onStage, protectedRegions, confidenceThreshold })
    -> { chairs, tables, venueObjects, representation, diagnostics }
}
```

### The two values that used to cross the seam

Both are now explicit, and both are the reason this extraction is a design
step rather than a file move.

**`confidenceThreshold`** — the pipeline used to call the shell's
`calibratedThreshold()`, which reads `state.calibration`. It is now injected on
every `detect()` call. It is passed as a **function**, not a value, so it is
evaluated at exactly the moments it was evaluated before; the default
(`() => .48`) is the same fallback `calibratedThreshold()` returns when nothing
is calibrated, so an omitted option behaves like an uncalibrated install rather
than like pre-selection turned off.

**`applyDeg`** — `runAssistedDetection` used to decide whether a measured skew
was worth correcting, evaluating
`Math.abs(skew.deg) >= SKEW_MIN_DEG && skew.gain >= SKEW_MIN_GAIN` in the
shell. Those two constants live on the same `const` line as the measurement's
own parameters, so they moved with it. The predicate moved too and is returned
as `applyDeg`; the shell now applies the answer instead of re-deriving it.

> **This is the mistake worth remembering.** The first attempt left the
> decision in the shell. `const SKEW_MAX_DEG=6,SKEW_STEP=.25,SKEW_MIN_DEG=.35,
> SKEW_MIN_GAIN=1.08;` declares four names on one line, and the static crossing
> analysis only captured the first — so `SKEW_MIN_DEG` was never reported as a
> crossing. Syntax checks passed, the app booted, the boundary suite passed,
> `smoke` passed. Every **real detection** threw `ReferenceError`. It was found
> by `symbolic-plan-detection`, which runs the actual detector.
>
> Two lessons are now enforced in `plan-detection-boundary`: count **every
> declarator** on a multi-name `const` line, and never treat "it boots" as
> evidence that a detector still detects.

---

## The shape of the problem

The file is **not** 24 balanced functions. It is roughly 700 lines of helpers
and one ~2,100-line `detect()` method holding the pipeline inline as a sequence
of stages. There are two different splits available, and they are not the same
job:

- **Split A — the helpers.** Ten cohesive groups already separated by section
  banners, most of them pure functions of pixels or boxes. Low risk.
- **Split B — `detect()` itself.** The stages share ~40 local bindings and are
  ordered by data: chairs are found before tables because table scoring uses
  the chair modal size. Splitting this is a design job, not a move.

**Do Split A first.** Split B needs its stage boundaries to become explicit
data structures before any of it can leave the function.

---

## Split A — the helper groups

Line numbers are within `src/plan-detection-classical.js`.

### A-1 · Image preprocessing — deskew
- **Lines** 44–110 (67)
- **Responsibility** estimate page skew, and decide whether it clears the
  deadband worth correcting
- **In → Out** `(canvas, width, height)` → `{deg, gain, measured, applyDeg}`
- **Dependencies** `otsu`; DOM canvas 2D context
- **Shared helpers** `otsu` (also used by the binarize stage)
- **Natural split** yes — `plan-detection-preprocess.js`
- **Risk** **LOW**, with one caveat: the only part of the file that touches the
  DOM. A future worker-based detector has to solve that, and it is better
  solved once this is its own file.
- **Protected by** `npm run benchmark` (the rotate variants; before deskew
  existed, armchair recall fell 1.000 → 0.823)

### A-2 · Colour and tone models
- **Lines** 133–316 (184)
- **Responsibility** derive the drawing's own palette — accent hue, chroma,
  background luma, tone bands. **No hue and no grey level is hardcoded.**
- **In → Out** RGB/luma histograms → `{accentModel, toneModel}`
- **Dependencies** `rgbBinIndex`, `rgbHue`, `hueGap`
- **Natural split** yes — `plan-detection-tone.js`
- **Risk** **LOW** — pure arithmetic over histograms, no geometry
- **Protected by** `table-typing`, `chair-families`, `benchmarks/BISTRO-MERGE.md`

### A-3 · Masks and connected components
- **Lines** 317–430 (114)
- **Responsibility** labelled components from a binarized image; enclosed
  regions; mask solidity
- **Dependencies** `scratchQueue`
- **Shared helpers** `SCRATCH_QUEUE` is the file's only module-level mutable
  binding — the one thing a split must be careful with
- **Natural split** yes — `plan-detection-components.js`
- **Risk** **MEDIUM**, entirely because of `SCRATCH_QUEUE`: moving the labeller
  without the buffer would silently reallocate per call
- **Protected by** `structural-objects`, `symbolic-plan-detection`

### A-4 · Oriented bounding box
- **Lines** 431–465 (35)
- **Responsibility** real minimum-area rectangle — never forced axis-aligned
- **Dependencies** none
- **Natural split** yes — `plan-detection-geometry.js`, with A-9
- **Risk** **LOWEST in the file.** Pure, self-contained, no state.
- **Protected by** `.claude/rules/ai.md` (preserve rotation); `plan-intelligence-contract`

### A-5 · Shape analysis and table typing
- **Lines** 466–546 (81)
- **Responsibility** round / square / rectangle from **real pixels**, not the
  bounding-box aspect ratio
- **Dependencies** `maskSolidity` (A-3)
- **Natural split** yes, with A-4
- **Risk** **LOW**
- **Protected by** `table-typing`; benchmark field `TYPES round n/n`

### A-6 · Modal-size prior and size agreement
- **Lines** 547–674 (128)
- **Responsibility** the modal object size, and how well a candidate agrees
  with it — the prior that replaced "biggest area first"
- **Shared helpers** `sizeAgreement` is called from **12 places** inside
  `detect()` — the most-used internal helper in the file
- **Natural split** yes — `plan-detection-size-prior.js`
- **Risk** **LOW** to move, **HIGH** to change. `sizeAgreement` is
  intersection-like but not IoU; `CODE-INVENTORY.md` §2.2 records why it must
  never be merged with `boxIoU`.
- **Protected by** `symbol-family`, `chair-families`, `table-typing`

### A-7 · Symbol family membership
- **Lines** within A-6's range (~595–625)
- **Responsibility** is this component a member of the plan's repeated symbol
  family?
- **Shared helpers** exported as `MeritSymbolFamilyMember` — **already public**
- **Natural split** yes, and it is the one group with an external consumer, so
  it moves with its export intact
- **Risk** **LOW**
- **Protected by** `symbol-family` (the suite exists for exactly this)

### A-8 · Splitting merged components
- **Lines** 626–674 (49)
- **Responsibility** split a component that merged two objects, along an axis
  or at a density valley
- **Natural split** yes, with A-4/A-5
- **Risk** **MEDIUM** — it changes the object count, so a mistake moves every
  downstream number
- **Protected by** `benchmarks/BISTRO-MERGE.md`'s fixture; benchmark field
  `mergesSplit`

### A-9 · Candidate geometry helpers
- **Lines** 675–702 (28)
- **Responsibility** `sameObject`, `boxIoU`, `distanceToOBB`, box conversions
- **Natural split** yes, with A-4
- **Risk** **LOW to move.** **`sameObject` and `boxIoU` must not be merged** —
  intersection-over-minimum-plus-size-guard answers "same object?",
  intersection-over-union answers "how much do these agree?", and the detector
  needs both.
- **Protected by** `plan-intelligence-contract`

### A-10 · The provider object and registry
- **Lines** 703–2858 — `detect()` plus the registry tail
- **Natural split** the registry (last ~15 lines) is trivially separable; the
  rest is Split B
- **Protected by** `plan-detection-boundary`

---

## Split B — inside `detect()`

The stages in execution order, with the `mark()` timing label each reports.
Everything between two marks is one responsibility. Line numbers are relative
to the start of `detect()` (file line 703).

| # | Stage | Rel. lines | `mark()` | Note |
|---|---|---|---|---|
| B-1 | luma + RGB histograms, one pass | 14–38 | `pixels` | single loop over every pixel |
| B-2 | adaptive fill mask + Sobel edges, kept SEPARATE | 40–60 | `binarize` | the separation is load-bearing: OR-ing edges into the mask fused adjacent tables into one |
| B-3 | colour model | 61–63 | `colourModel` | A-2 |
| B-4 | object sources: interiors, tone masks, fill mask | 104–276 | `interiors`, `toneMasks`, `fillMask` | three independent candidate sources |
| B-5 | **chairs first**, incl. secondary families | 277–808 | `chairs` | largest single stage |
| B-6 | table candidate pool | 810–907 | — | |
| B-7 | is this candidate made of table? | 908–1037 | — | |
| B-8 | symbol family as a family, not a polarity | 1038–1135 | — | |
| B-9 | chair → table association | 1136–1197 | — | |
| B-10 | scoring and ranking | 1198–1216 | — | the modal-size prior |
| B-11 | fragment suppression | 1217–1457 | — | Gate C/D |
| B-12 | re-seat chairs whose table did not survive | 1458–1513 | — | |
| B-13 | bistro typing — semantic, not shape | 1514–1603 | — | |
| B-14 | a table containing all of its own seats | 1604–1810 | — | |
| B-15 | venue-scale objects: stage, bar, columns | 1811–1977 | `tables` | |
| B-16 | what kind of drawing is this? | 1981–… | — | representation verdict |

**Why this cannot be split yet.** The stages share roughly 40 local bindings
(`gray`, `hist`, `fillMask`, `edges`, `comps`, `chairs`, `chairModal`, `pool`,
`diagnosticsSources`, …) and are **ordered by data, not convenience**: B-5 runs
before B-6 because table scoring needs the chair modal size; B-11 runs after
B-9 because suppression consults the associations. Extracting a stage means
first deciding what its input and output objects actually are — a design
decision with measurable risk to detector output, which this commit refused to
take.

**The order to do it in**, when it is done: B-1/B-2/B-3 first (they produce
well-defined arrays and consume nothing but pixels), then B-15 and B-16 (they
consume the finished pool and produce independent outputs), then the middle.
B-11 last — largest, most measured, and the one `benchmarks/false-positives/`
exists to watch.

---

## Summary

**16 natural submodule boundaries: 10 helper groups in Split A, and 16 stages
in Split B of which 6 are separable without a redesign.**

| Split | Groups | Lines | Risk |
|---|---|---|---|
| A — helpers | 10 | ~700 | LOW, except A-3 (`SCRATCH_QUEUE`) and A-8 (changes object count) |
| B — `detect()` stages | 16 | ~2,100 | MEDIUM to HIGH; needs explicit stage contracts first |

Every step is measured the way this one was: `npm run benchmark` against
`benchmarks/BASELINE.json`, every guarded field per plan, plus
`npm run benchmark:adversarial` — **and at least one suite that runs real
detection**, because booting is not detecting. A trade (chair recall up, table
F1 down) is invisible in a single score and is a revert, not a win.
