# `plan-detection-classical.js` — internal ownership map

**Status of the file this describes: TRANSITIONAL EXTRACTION, not a finished
module.** 3,145 lines in one file is not a healthy unit and is not reported as
one.

> **Re-measured after §6 (mixed representation).** The file was 2,858 lines
> when this map was written and is **3,145** now; the §6 work added 287, nearly
> all of it comment and diagnostics inside the chair stage. **Every line number
> below Split A's A-1 has moved**, so the ranges in this document are the
> re-measured ones and the older ones in the git history are not
> interchangeable with them. The helper region (A-1 to A-9) is unchanged in
> size and character — the growth is entirely inside `detect()`, which is the
> argument for doing Split A first, not against it. What the extraction bought is a **boundary** the pipeline did not have:
the app now reaches it through one registry, and it reaches back into nothing.
That boundary is what makes the split below safe to do next.

This document is the map for that split. **Nothing here has been moved.**

## What the file is

| | |
|---|---|
| Lines | **3,145** (2,809 moved + 49 of header and IIFE + 287 from §6) |
| Top-level functions | 24 (23 helpers, lines 43–701, plus the registry resolver at 3,139) |
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

## Split A — progress

**A-4 and A-9 are done.** `minAreaRect`, `sameObject`, `boxIoU` and
`distanceToOBB` live in `src/plan-detection-geometry.js`, published as
`globalThis.MeritPlanGeometry` and reached through a `GEO.` handle at all ten
call sites — never through a local alias sharing a name with the function that
used to be there, which is what would make "did this reach past the boundary?"
unanswerable by reading the code.

The crossing analysis, measured in stripped code across every file in `src/`
and `index.html` before anything moved:

| direction | result |
|---|---|
| outward (region → file's scope) | **zero** — every identifier in all four bodies is a parameter, a local, or `Math` |
| inward (file → region) | four names, counts including each definition: `minAreaRect` 2, `sameObject` 7, `boxIoU` 3, `distanceToOBB` 2 |
| any other file, or `index.html` | **none** — one name entered the app's vocabulary, not four |

`plan-detection-classical.js` 3,145 → **3,090**; `plan-detection-geometry.js`
is 103 lines including its header.

**A-6 and A-7 followed**, into `src/plan-detection-size-prior.js`
(`globalThis.MeritPlanSizePrior`, reached through a `PRIOR.` handle at all
eighteen call sites). The crossing analysis — now a tool,
`scripts/crossing-analysis.mjs`, because it is about to be run six more times
and doing it by eye is how the first split failed:

| direction | result |
|---|---|
| outward | **zero** — the region is closed over its own arguments |
| inward | `modalMagnitude` 11, `sizeAgreement` 8, `symbolFamilyMember` 1 |
| private | the two symbol-family thresholds, which move with the predicate whose measurement chose them |

`app-v8.js` appeared to name `sizeAgreement` and does not: it reads
`c.evidence?.sizeAgreement`, a PROPERTY that happens to share the word. **A
crossing report is a place to start looking, not a verdict.**
`MeritSymbolFamilyMember` was already public and is published under exactly
that name by the new file, so `symbol-family` is untouched — a move must not
rename a surface something else already reaches for.

`plan-detection-classical.js` **3,090 → 3,053**.

**A-5 followed**, into `src/plan-detection-shape.js`
(`globalThis.MeritPlanShape`, `SHAPE.` at both call sites).
`plan-detection-classical.js` **3,053 → 2,971** — under 3,000 for the first
time, and **down 174 lines from 3,145** across three steps.

Its crossing report names one outward name, `GEO`, and the tool now labels
that a **MODULE HANDLE** rather than shell coupling: a region depending on
another module is the one-way direction this codebase wants, and the new file
binds its own handle. Reporting it as "the cut is in the wrong place" would
have argued against exactly the moves that are going well.

**And this map was wrong about A-5.** It recorded the group's dependency as
`maskSolidity` (A-3), which would have tied a clean move to the component
labeller and its module-level `SCRATCH_QUEUE` — the one MEDIUM-risk item in
Split A. Measured: `shapeAnalysis` does not name `maskSolidity` at all. **A map
is the record of a measurement, not a substitute for taking one again.**

One consequence worth naming, because it is what a layered split looks like
when it is working: A-5 took `minAreaRect`'s last remaining caller with it, so
the pipeline no longer calls it at all. The boundary suite's geometry check
now asserts the handle over every CALLER rather than over the one file that
used to be the only one.

**A-8 followed**, into `src/plan-detection-split.js`
(`globalThis.MeritPlanSplit`). `plan-detection-classical.js` **2,971 →
2,888** — **257 lines out across four steps**, from 3,145.

Outward **zero**; the modal sizes it judges parts against arrive as
parameters, which is what keeps it from inventing a boundary. Inward one name,
`splitAtValley`. And `splitAlongAxis` became **genuinely private** — a name
that was top-level in a three-thousand-line file is now internal to its one
caller, which is the thing a split is for and which no amount of moving lines
achieves on its own. The suite asserts it is defined there and NOT published.

The move also cleared a `// ---- Candidate geometry helpers ----` banner that
A-9 orphaned: a section header pointing at nothing is the decay a split leaves
behind if nobody looks.

**A-3's component layer followed**, into
`src/plan-detection-components.js` (`globalThis.MeritPlanComponents`).
`plan-detection-classical.js` **2,888 → 2,793** — **352 lines out of 3,145
across five steps**.

**Not the whole group, and the reason is A-2.** The map's A-3 opens with
`buildClassMasks`, and that function calls `rgbBinIndex`, which belongs to the
colour model — the group already measured as unavailable because its `RGB_*`
and `*_CHROMA` constants are used on both sides of any cut. So A-3 splits
along a line the map did not draw: the part that is about PIXELS-TO-OBJECTS
moves, and `buildClassMasks`, which is about WHICH PIXELS, stays with the
colour work it depends on. Measured after that split: outward crossings
**zero**; inward `maskSolidity` 1, `enclosedRegions` 1, `labelComponents` 5;
private `scratchQueue` and `SCRATCH_QUEUE`.

**The MEDIUM rating was right, and it is about the buffer rather than any
coupling.** `SCRATCH_QUEUE` is one `Int32Array` reused across every flood
fill; allocating one per component would dominate the cost on a large plan and
change **nothing** about the output. The map's warning was exact — "moving the
labeller without the buffer would silently reallocate per call" — and *silent*
is the operative word.

So it is asserted statically, and the mutation shows why that is not
belt-and-braces: with the buffer moved inside its own allocator,
`plan-detection-boundary` fails both checks while **`structural-objects` — a
real-detection suite on a real plan — passes**. A behaviour test cannot see
this one. It is the counterpart to "booting is not detecting": *detecting is
not the whole contract either.*

**A-1 followed**, into `src/plan-detection-deskew.js`
(`globalThis.MeritPlanDeskew`). `plan-detection-classical.js` **2,793 →
2,682** — **463 lines out of 3,145 across six steps, −14.7%**.

Outward **zero**; inward `otsu` (the binarize stage) and `estimatePlanSkew`
(the provider's own surface, which now names the module's function instead of
a shorthand for a local that no longer exists — the shorthand is exactly how a
move like this goes silently wrong). Private: the four `SKEW_*` constants.

**Those four are THE four.** They are declared on one comma-separated line,
and the first attempt at extracting this pipeline captured only the first —
leaving `SKEW_MIN_DEG` in the shell while its value moved, so every REAL
detection threw `ReferenceError` while the syntax checks, `smoke` and all four
structural suites passed. They are now entirely private to the module that
uses them. The mutation reproduces the original failure exactly (drop the
fourth declarator, re-declare it in the pipeline) and fails three checks.

This is also **the only part of the detector that touches the DOM** —
`estimatePlanSkew` needs a canvas 2D context to re-render the page at trial
angles. A worker-based detector cannot use one, and that problem is now a
156-line file rather than a paragraph inside a three-thousand-line one.

**And it broke a check by succeeding.** `plan-detection-boundary` asserted
`detBindings.size > 30` as its guard against the seam checks going vacuous —
if the binding extractor ever returned an empty set, "app-v8 resolves no
pipeline-only name" would be trivially true. Split A is shrinking that surface
on purpose, and it reached exactly 30. Lowering the number each time it bites
is a check that never says anything, so it was replaced by a **positive
control**: names that must still be found (`otsu`, `CLASSICAL_CV_PROVIDER`,
`estimatePlanSkew`, `GEO`, `PRIOR`) plus a floor of 10 stated as a parser
sanity check rather than a target. Mutation — breaking the extractor's
function-declaration regex — fails the control while leaving the old count
above its floor, so it is strictly the stronger guard.

**A-2 was measured and is NOT next, against the map's own LOW rating.** Its
five constants (`RGB_BITS`/`RGB_LEVELS`/`RGB_BINS`/`RGB_SHIFT` on one
four-declarator line, plus `LOW_CHROMA`/`MID_CHROMA`) are used on BOTH sides —
`RGB_BINS` 4 inside and 5 outside, `LOW_CHROMA` 1 and 2, `MID_CHROMA` 2 and 2 —
because `detect()`'s own pixel loop bins and thresholds chroma directly. Moving
them breaks the other side and copying them creates two sources of truth for
one quantisation scheme, so the colour/tone concern does not separate from the
histogram pass that feeds it. That is Split B work, not a helper move.

**And the move found a hole in the safety net, which is the more useful
outcome.** Loading the new script AFTER the pipeline that binds
`const GEO = globalThis.MeritPlanGeometry` at the top of its IIFE passed
`boot-contract`, `smoke` AND `plan-detection-boundary`, and threw
`Cannot read properties of undefined (reading 'sameObject')` on every real
detection — this file's own "booting is not detecting" lesson arriving a second
time, from the other direction. `boot-contract` now DERIVES the rule instead of
listing three orderings by hand: whatever a file publishes as `globalThis.Merit*`
must load before any file that reads it **at load time**, where load time means
the top level of a module rather than inside a function body (`plan-embedding`
and `plan-intelligence` both reach for `MeritVisualEmbedding`, which `app-v8.js`
publishes last, and both are correct because both do it inside a guarded
function). Zero violations on the current tree; the mutation is caught in one
second instead of a 102-second detection timeout, and every future module is
covered the day it is added.

## Split A — the helper groups

Line numbers are within `src/plan-detection-classical.js`.

### A-1 · Image preprocessing — deskew — **MOVED**
- **Lines** 43–157 (115) — `otsu` + `estimatePlanSkew`
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
- **Lines** 158–317 (160)
- **Responsibility** derive the drawing's own palette — accent hue, chroma,
  background luma, tone bands. **No hue and no grey level is hardcoded.**
- **In → Out** RGB/luma histograms → `{accentModel, toneModel}`
- **Dependencies** `rgbBinIndex`, `rgbHue`, `hueGap`
- **Natural split** yes — `plan-detection-tone.js`
- **Risk** **LOW** — pure arithmetic over histograms, no geometry
- **Protected by** `table-typing`, `chair-families`, `benchmarks/BISTRO-MERGE.md`

### A-3 · Masks and connected components — **PART MOVED**
- **Lines** 318–437 (120)
- **Responsibility** labelled components from a binarized image; enclosed
  regions; mask solidity
- **Dependencies** `scratchQueue`
- **Shared helpers** `SCRATCH_QUEUE` is the file's only module-level mutable
  binding — the one thing a split must be careful with
- **Natural split** yes — `plan-detection-components.js`
- **Risk** **MEDIUM**, entirely because of `SCRATCH_QUEUE`: moving the labeller
  without the buffer would silently reallocate per call
- **Protected by** `structural-objects`, `symbolic-plan-detection`

### A-4 · Oriented bounding box — **MOVED**
- **Lines** 438–475 (38)
- **Responsibility** real minimum-area rectangle — never forced axis-aligned
- **Dependencies** none
- **Natural split** yes — `plan-detection-geometry.js`, with A-9
- **Risk** **LOWEST in the file.** Pure, self-contained, no state.
- **Protected by** `.claude/rules/ai.md` (preserve rotation); `plan-intelligence-contract`

### A-5 · Shape analysis and table typing — **MOVED**
- **Lines** 476–553 (78)
- **Responsibility** round / square / rectangle from **real pixels**, not the
  bounding-box aspect ratio
- **Dependencies** `GEO.minAreaRect` only. **This entry used to say `maskSolidity` (A-3) and that was wrong** — measured before the move, `shapeAnalysis` does not name `maskSolidity` at all. The error mattered: it tied A-5 to the component labeller and its module-level scratch buffer, the one MEDIUM-risk item in Split A, and would have deferred a clean move behind a hard one.
- **Natural split** yes, with A-4
- **Risk** **LOW**
- **Protected by** `table-typing`; benchmark field `TYPES round n/n`

### A-6 · Modal-size prior and size agreement — **MOVED**
- **Lines** 554–588 (35) — `modalMagnitude`, `sizeAgreement`
- **Responsibility** the modal object size, and how well a candidate agrees
  with it — the prior that replaced "biggest area first"
- **Shared helpers** `sizeAgreement` is called from **12 places** inside
  `detect()` — the most-used internal helper in the file
- **Natural split** yes — `plan-detection-size-prior.js`
- **Risk** **LOW** to move, **HIGH** to change. `sizeAgreement` is
  intersection-like but not IoU; `CODE-INVENTORY.md` §2.2 records why it must
  never be merged with `boxIoU`.
- **Protected by** `symbol-family`, `chair-families`, `table-typing`

### A-7 · Symbol family membership — **MOVED**
- **Lines** 589–606 (18) — `symbolFamilyMember`
- **Responsibility** is this component a member of the plan's repeated symbol
  family?
- **Shared helpers** exported as `MeritSymbolFamilyMember` — **already public**
- **Natural split** yes, and it is the one group with an external consumer, so
  it moves with its export intact
- **Risk** **LOW**
- **Protected by** `symbol-family` (the suite exists for exactly this)

### A-8 · Splitting merged components — **MOVED**
- **Lines** 607–679 (73) — `splitAlongAxis`, `splitAtValley`
- **Responsibility** split a component that merged two objects, along an axis
  or at a density valley
- **Natural split** yes, with A-4/A-5
- **Risk** **MEDIUM** — it changes the object count, so a mistake moves every
  downstream number
- **Protected by** `benchmarks/BISTRO-MERGE.md`'s fixture; benchmark field
  `mergesSplit`

### A-9 · Candidate geometry helpers — **MOVED**
- **Lines** 680–701 (22) — `sameObject`, `boxIoU`, `distanceToOBB`
- **Responsibility** `sameObject`, `boxIoU`, `distanceToOBB`, box conversions
- **Natural split** yes, with A-4
- **Risk** **LOW to move.** **`sameObject` and `boxIoU` must not be merged** —
  intersection-over-minimum-plus-size-guard answers "same object?",
  intersection-over-union answers "how much do these agree?", and the detector
  needs both.
- **Protected by** `plan-intelligence-contract`

### A-10 · The provider object and registry
- **Lines** 703–3,145 — the provider object (`detect()` starts at 709) plus the registry tail from 3,134
- **Natural split** the registry (last ~15 lines) is trivially separable; the
  rest is Split B
- **Protected by** `plan-detection-boundary`

---

## Split B — measured, and NOT started

`scripts/stage-boundaries.mjs`, run on the post-Split-A file. Each stage is
the code between two `mark()` calls; the tail is where the result object is
assembled.

| stage | lines | declared | escapes | inherited |
|---|---|---|---|---|
| `pixels` | 30 | 19 | 12 | 0 |
| `binarize` | 21 | 11 | 4 | 6 |
| `colourModel` | 2 | 2 | 2 | 2 |
| `interiors` | 67 | 19 | 14 | 4 |
| `toneMasks` | 129 | 32 | 2 | 17 |
| `fillMask` | 11 | 2 | **0** | 9 |
| **`chairs`** | **666** | 108 | 14 | 12 |
| **`tables`** | **1,241** | 193 | 29 | 17 |
| `(assemble)` | 261 | 32 | 0 | **44** |

**The escape count is an UPPER BOUND, ~73, and is labelled as one in the
tool.** Scope in JavaScript cannot be read with regexes. Successive
refinements — excluding names a later stage re-declares, then counting
function and arrow parameters as declarations — took it from 92 to 73, and the
remainder (destructuring, catch bindings, nested callback parameters) needs a
real parser. Publishing 73 as a count would be a precise-looking number
standing on an imprecise method.

**What survives the noise is what the measurement is for:**

- **`chairs` and `tables` are 1,907 of detect()'s ~2,436 lines — 78%.** Split B
  is those two stages and little else. Everything before them totals 260 lines.
- **`(assemble)` inherits from every stage and escapes nothing.** It is the
  return value, not a stage; it cannot move.
- **`fillMask` escapes NOTHING.** A stage that hands nothing forward is where a
  cut actually exists — it is 11 lines, so the cut is not worth taking on its
  own, but it is the shape to look for.
- **The `chairs` → `tables` ordering is real, not incidental.** `chairModal`,
  `chairUniform`, `chairs` and `chairSource` all cross that boundary, which is
  precisely the reason this document already gave for the ordering: table
  scoring uses the chair modal size. It is now measured rather than asserted.

**So Split B stays a design job, and the design is now stated:** the two large
stages cannot leave `detect()` until the values they hand forward become an
explicit structure — a returned record, or a context object passed along —
rather than shared locals. That is a behaviour-preserving refactor of ~1,900
lines with a detector at the end of it, and it belongs in its own session with
`npm run benchmark` after every step, not appended to a run of helper moves.

## Split B — the stages, in execution order

The stages in execution order, with the `mark()` timing label each reports.
Everything between two marks is one responsibility.

**Re-measured after §6.** The table below keeps its original relative line
numbers for continuity; the ABSOLUTE line each `mark()` now sits on, read out
of the current file, is:

| `mark()` | line | stage ends here |
|---|---|---|
| `pixels` | 740 | luma + RGB histograms |
| `binarize` | 762 | fill mask + Sobel edges, kept separate |
| `colourModel` | 765 | A-2 |
| `interiors` | 833 | |
| `toneMasks` | 963 | |
| `fillMask` | 975 | |
| **`chairs`** | **1,642** | 667 lines — the largest stage, and where §6 landed |
| **`tables`** | **2,884** | 1,242 lines from the chair mark |

Those two stages are 61% of the file between them. Split B is a design job and
this is the measurement that says why: `detect()` is not many stages, it is two
very large ones with a short preamble.

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
