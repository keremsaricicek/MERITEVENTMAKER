# Robustness: what the SHIPPED build actually does

This is the authoritative rendering matrix. It replaces every earlier
robustness table in this repository. Reproduce with:

```
node benchmarks/robustness/run-robustness.mjs
```

**ONE REAL VENUE PLAN EXISTS.** Every row is that same drawing re-rendered. A
good score here is evidence of robustness to *rendering*, and evidence of
nothing whatsoever about a venue this system has not seen.

## The matrix

| variant | tTP | tFP | tFN | tP | tR | **tF1** | cTP | cFP | cFN | cP | cR | **cF1** | bistro | rev | ms | triage |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|:--:|--:|--:|---|
| **ORIGINAL** | 46 | 4 | 0 | 0.92 | 1.00 | **0.958** | 107 | 5 | 6 | 0.96 | 0.95 | **0.951** | 5/5 | 6 | 927 | HEALTHY |
| `contrast-low` | 41 | 2 | 5 | 0.95 | 0.89 | **0.921** | 105 | 1 | 8 | 0.99 | 0.93 | 0.959 | 0/0 | 6 | 877 | HEALTHY |
| `crop-pad` | 46 | 3 | 0 | 0.94 | 1.00 | **0.968** | 107 | 5 | 6 | 0.95 | 0.95 | 0.951 | 5/5 | 7 | 890 | HEALTHY |
| `jpeg-q40` | 46 | 4 | 0 | 0.92 | 1.00 | **0.958** | 109 | 2 | 4 | 0.98 | 0.96 | 0.973 | 5/5 | 7 | 760 | HEALTHY |
| `rotate-2` | 45 | 2 | 1 | 0.96 | 0.98 | **0.968** | 112 | 11 | 1 | 0.91 | 0.99 | 0.949 | 4/4 | 7 | 1050 | HEALTHY |
| `rotate-minus-3` | 41 | 4 | 5 | 0.91 | 0.89 | **0.901** | 112 | 6 | 1 | 0.95 | 0.99 | 0.970 | 0/0 | 6 | 958 | HEALTHY |
| `grayscale` | 43 | 5 | 3 | 0.90 | 0.94 | **0.915** | 104 | 15 | 9 | 0.87 | 0.92 | 0.897 | 2/2 | 7 | 907 | ACCEPTABLE |
| `noise` | 46 | 16 | 0 | 0.74 | 1.00 | **0.852** | 111 | 6 | 2 | 0.95 | 0.98 | 0.965 | 5/5 | 6 | 929 | ACCEPTABLE |
| `downscale-70` | 41 | 4 | 5 | 0.91 | 0.89 | **0.901** | 112 | **73** | 1 | **0.60** | 0.99 | **0.752** | 0/0 | 6 | 706 | WEAK |
| `blur` | 37 | **32** | 9 | **0.54** | 0.80 | **0.643** | 113 | 2 | 0 | 0.98 | 1.00 | 0.991 | 0/0 | 4 | 1149 | **SEVERE** |
| `bright-down` | 24 | 4 | 22 | 0.86 | **0.52** | **0.649** | 102 | 1 | 11 | 0.99 | 0.90 | 0.944 | 0/0 | 5 | 958 | **SEVERE** |
| `bright-up` | 39 | **48** | 7 | **0.45** | 0.85 | **0.586** | 101 | 2 | 12 | 0.98 | 0.89 | 0.935 | 0/0 | 6 | 915 | **SEVERE** |
| `contrast-high` | 37 | **49** | 9 | **0.43** | 0.80 | **0.561** | 111 | 3 | 2 | 0.97 | 0.98 | 0.978 | 0/0 | 6 | 1042 | **SEVERE** |
| `hue-shift` | 38 | **52** | 8 | **0.42** | 0.83 | **0.559** | 113 | 6 | 0 | 0.95 | 1.00 | 0.974 | 0/1 | 6 | 980 | **SEVERE** |
| `jpeg-q20` | 45 | **26** | 1 | **0.63** | 0.98 | **0.769** | 107 | 3 | 6 | 0.97 | 0.95 | 0.960 | 5/5 | 6 | 806 | **SEVERE** |
| `lowres-roundtrip` | 28 | 14 | 18 | 0.67 | **0.61** | **0.636** | 103 | 3 | 10 | 0.97 | 0.91 | 0.941 | 2/2 | 5 | 905 | **SEVERE** |

**Median across all 16 renderings: table F1 0.877, chair F1 0.955.**

Triage thresholds are for *sorting* renderings so the weak ones are obvious,
not claims of statistical certainty — one venue cannot support those. `SEVERE`
is deliberately about the failure *mode* rather than the score: a false-positive
explosion and a recall collapse cost an operator different things.

| | count | variants |
|---|--:|---|
| HEALTHY | 6 | ORIGINAL, `contrast-low`, `crop-pad`, `jpeg-q40`, `rotate-2`, `rotate-minus-3` |
| ACCEPTABLE | 2 | `grayscale`, `noise` |
| WEAK | 1 | `downscale-70` |
| **SEVERE** | 7 | `blur`, `bright-down`, `bright-up`, `contrast-high`, `hue-shift`, `jpeg-q20`, `lowres-roundtrip` |

## The single most important finding

**The dominant failure is not that the detector stops finding tables. It is
that it starts inventing them.**

Look at the recall column on the SEVERE rows:

| variant | table recall | table FP | what actually went wrong |
|---|--:|--:|---|
| `jpeg-q20` | **0.98** | 26 | finds 45 of 46 tables, then adds 26 imaginary ones |
| `bright-up` | 0.85 | 48 | finds 39, adds 48 |
| `hue-shift` | 0.83 | 52 | finds 38, adds 52 |
| `contrast-high` | 0.80 | 49 | finds 37, adds 49 |
| `blur` | 0.80 | 32 | finds 37, adds 32 |

Five of the seven SEVERE renderings keep respectable recall and collapse on
**precision**. `jpeg-q20` is the clearest case in the whole matrix: recall 0.98,
precision 0.63. The detector can still see this plan through a bad JPEG. It just
cannot tell what *isn't* a table any more.

Only two SEVERE rows are genuine recall collapses — `bright-down` (0.52) and
`lowres-roundtrip` (0.61), where the drawing's own contrast or resolution has
been destroyed.

**Chair detection is largely unaffected**: chair F1 is above 0.93 on every
rendering except `downscale-70` (0.752) and `grayscale` (0.897). Chair recall
never drops below 80% of the original anywhere.

## What this means for the roadmap

The roadmap asked whether earlier bad colour/exposure numbers were **stale**.
Re-measured on the shipped build: **they are not stale, they are current.**
`hue-shift` really is 0.559 today. That question is now closed.

But the failure mode says the fix is not a tone-architecture rewrite. Every one
of those five variants is a **false-positive** problem, and a false-positive
problem is precisely what a second, independent opinion on "does this crop
actually look like a table?" is for. That is Phase 2 of this roadmap, and the
matrix above is its before-measurement.

**Phase 2 result: the matrix did not move, by design.** Every suppression rule
built on the learned channel was simulated against ground truth and every one
also removed real tables on at least one rendering, so detector fusion was
**NOT PROMOTED**. The channel ships as evidence instead — it flags invented
tables to the operator without deleting anything, which is why every number
above is identical after it. Full result and the numbers behind both decisions:
`benchmarks/embedding/SECOND-OPINION.md`.

So per §7 and §58: **the tone architecture is not being rewritten on this
evidence.** The evidence points at Phase 2, not back at Phase 1.

## `downscale-70` stays as the hard test

Unchanged and deliberately not tuned: 73 false chairs, chair precision 0.60.
Root cause and four rejected fixes in `DOWNSCALE-FALSE-CHAIRS.md`. It is kept
as the hard test the learned second opinion has to face, per §9 and §17.

## Stale values corrected

| claim | where | status |
|---|---|---|
| bistro type accuracy 0/5 | `SPRINT-INTELLIGENCE-REPORT.md` | **stale** — now 5/5; file marked superseded |
| column recall 0.667 (4/6) | `SPRINT-INTELLIGENCE-REPORT.md` | **stale** — now 1.000 (6/6) |
| review groups 5 | several | **stale** — now **6**, because typing the bistro tables correctly splits them out of the square group. A type discovery, not effort inflation. |
| 24 scoreable relationships | `SPRINT-INTELLIGENCE-REPORT.md` | **stale** — now 83 |
| `hue-shift` 0.559 | everywhere | **NOT stale — confirmed current** |
| `bright-up` 0.586, `contrast-high` 0.561, `blur` 0.643, `lowres` 0.636 | everywhere | **NOT stale — confirmed current** |
| median table F1 0.877 / chair F1 0.955 | everywhere | **NOT stale — confirmed current** |
