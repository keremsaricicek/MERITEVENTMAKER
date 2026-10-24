# Plan understanding — final report of this programme

Measured on `8a30427` (2026-10-10). The app code there is byte-for-byte
`08da891`'s; the commits after it touch benchmark runners, their reports and
documentation only. Every number below comes from a run on that source, on
this container (4 CPU, no GPU), with the pinned OCR served from
`.vendor-cache` and the network refused. The runs' outputs sit beside this
file: `report.json`, both overlays on the original drawings, both stored
analyses, and the committed digital plan rendered at 1920×1080, 2560×1440 and
1440×900 in `screens/`.

**Two real plans exist** — the Golden Plan (a coloured furniture drawing) and
ORNEK (a photographed printout of a numbered-symbol plan). Two plans cannot
show generalization, and nothing here claims it. No third plan was made up
and no human test was made up.

## The contract, before and after

The contract (`../CONTRACT.md`) was written on 2026-10-04, before the work,
against `65808d5`: numeric thresholds for a 9/10, each with its reason.

| | rows met |
|---|---|
| `65808d5` (baseline, before the work) | **43 / 75** |
| `8a30427` (this run) | **77 / 82** |

Seven rows were added during the work and none removed: the shape IoU of
venue elements that now exist to be measured (stage, columns, bar,
entrances, banquettes, locas). Every row, before and after:
`BEFORE-AFTER.md`. The headline rows:

| | Golden | ORNEK |
|---|---|---|
| tables P / R | 1 / 1 (was 0.979 / 1) | 0.994 / 0.976 |
| chairs P / R / count error | 0.991 / 0.956 / 0.035 (was 1 / 0.947 / 0.053) | — (draws none) |
| stage · bar · entrances · banquettes | 1/1 · 1/1 · 2/2 · 3/3 (was 0 for all) | — |
| columns · locas | 9 of 10, P 1 | 4 of 4 · 12 of 12 (was 0) |
| chair → table end to end | 0.945 (was 0.917) | — |
| joined groups exact | 12 / 12 | no spurious group (was 1) |
| facing: precision · coverage | **1.0** (79 / 79) · **0.699** (was 0.684 · 0.115) | — |
| printed numbers: recall · verified precision | — | **0.924** · 1.0 (was 0.554 recall) |
| printed capacity total read | **124** (was not read) | 2064 |
| corrections per 100 objects | 4.55 (was 14.2) | 2.75 (was 11.5) |
| digital plan: centre error p90 | 0.035 (was 0.299) | 0.097 (was 0.528) |
| analysis wall clock | 11.0 s (budget 15) | **66.4 s (budget 60)** |
| plan or guest data leaving the machine | 0 | 0 |

## Not met (5 of 82), and why

| row | value | target | why it is not met |
|---|---|---|---|
| Golden `bar.shapeIoUMedian` | 0.046 | ≥ 0.5 | The bar is found and placed at its printed word; its counter is open to the room, so no closed area bounds it and the extent is the label's own box, marked "not measured". Guessing an extent is the thing the contract forbids. |
| Golden `entrance.shapeIoUMedian` | 0.225 | ≥ 0.5 | Same: both entrances are found at GİRİŞ; the door area is not a closed region. |
| Golden `direction.coverage` | 0.699 | ≥ 0.8 | Every stated facing is right (79 / 79). The 9 bistro chairs and 21 pale round-table chairs state nothing: their averaged stencils show no single backrest side at this resolution, and a guess is not a reading. |
| ORNEK `digital.tableAspectLogErrorP90` | 0.107 | ≤ 0.1 | The annotation gives all 166 tables one nominal 78×78 disc; the photographed rings are about 75×70 ellipses. The product draws what it sees. Not chased. |
| ORNEK `run.analysisMs` | 66.4 s | ≤ 60 s | Time is the OCR model's cost (its recognition is ~38 s of it: 231 lines, each fed at the model's 48×320 input). On this container the same code measured 57.8 s and 66.4 s in two runs; a slower container gave 71–73 s for both `a353e66` and `f91d42e`; the container the earlier rows ran on gave 47–54 s. Running Tesseract beside the model (`e0d42eb`) took 73.4 → 57.8 s on one machine; merging the model's recognition calls was measured and gave nothing (outputs identical, 36 s → 38 s) and was not kept. The row sits at the edge of its budget on this hardware and is reported as not met. |

## Carried targets (their own runners; not lowered)

Measured on the delivered source. "Start" is what stood when the programme
began: for robustness, `7d3ae9c` re-measured today on this container so the
two columns are comparable; for the others, the recorded baseline in force at
that commit (adversarial 2026-09-27, memory 2026-10-04 at `94ca9f6`).

| target | start (`7d3ae9c`) | now | met? |
|---|---|---|---|
| a2 mixed families: no real table held back | KNOWN FAIL (3 held back) | KNOWN FAIL, unchanged | no — accepted in writing (`benchmarks/adversarial/KNOWN-FAILS.json`) |
| a6 architecture: no offered phantom, precision ≥ 0.9 | KNOWN FAIL | KNOWN FAIL; table F1 0.457 (0.432 at its recorded baseline) | no — accepted in writing |
| a8 small chairs: chair recall ≥ 0.8 | 0.089 | 0.089 | no — see E below |
| §23 memory: retention ≥ 0.98 · identity ≥ 0.98 · wrong ≤ 0.01 | 0.736 · 1.0 · 0 (182 decisions) | 0.801 · 0.992 · 0.008 (161 decisions) | retention no; the other two yes. The one wrong application (grayscale, twin bistros T42/T43) is recorded, not hidden |
| robustness: no SEVERE rendering among the 16 | 5 SEVERE · 3 WEAK · 8 HEALTHY | 5 SEVERE · 3 WEAK · 8 HEALTHY | no |
| false positives: the seat-containment gate holds no real table | 29 real held (finished-analysis read at `98f6c60`) | 16 real held on five photometric renderings | no — accepted per rendering (`benchmarks/false-positives/KNOWN-FAILS.json`); 0 on the clean plan |
| object benchmark: no guarded field worse than `BASELINE.json` | — | no regressions | yes (re-recorded with the two moved fields explained) |

Robustness per rendering, table F1 / chair F1, start → now: blur 0.706 →
0.747 / 0.991 → 0.978 · bright-down 0.658 → 0.649 / 0.843 → 0.883 ·
bright-up 0.636 → 0.655 / 0.935 → 0.935 · contrast-high 0.605 → 0.622 /
0.978 → 0.964 · contrast-low 0.932 → 0.932 / 0.959 → 0.969 · crop-pad 0.989
→ 1.000 / 0.951 → 0.964 · downscale-70 0.911 → 0.932 / 0.752 → 0.762 ·
grayscale 0.923 → 0.933 / 0.936 → 0.936 · hue-shift 0.639 → 0.618 / 0.974 →
0.978 · jpeg-q20 0.750 → 0.759 / 0.828 → 0.832 · jpeg-q40 0.968 → 0.979 /
0.973 → 0.978 · lowres-roundtrip 0.486 → 0.486 / 0.785 → 0.785 · noise 0.920
→ 0.968 / 0.965 → 0.964 · rotate-2 0.968 → 0.957 / 0.949 → 0.969 ·
rotate-minus-3 0.921 → 0.921 / 0.970 → 0.978. Mostly up; five small
declines (largest: hue-shift table F1 −0.021) are listed as measured. The
robustness runner's own `BASELINE.json` dates from 2026-08-31 and its
"worse than baseline" lines (lowres-roundtrip table F1 0.636, jpeg-q20 chair
F1 0.96) were already at today's values when this programme began.

## What was built, by work item

| item | state | what exists | evidence |
|---|---|---|---|
| A — baseline and contract | DONE | thresholds written before the work; `measure.mjs`, `score.mjs`, `contract.mjs` | `../CONTRACT.md`, `../baseline-65808d5/` |
| B — coordinates, sourced observations | DONE | one coordinate module for every frame and both box conventions; every object says who saw it, where, how sure, why | `a803ff9`, `2a723f1` |
| C — review decisions, one writer | DONE | memory, labels, audit and undo move together | `b386354` |
| D — PDF text and vectors | PARTIAL | a PDF's own text objects are used as exact text on the `pdf-text` channel; a scan is recorded as SCAN; vector paths are counted and named as unread | `9b2e233`, `pdf-text-layer` (synthetic PDF, not a venue) |
| E — high-resolution tiled scan | NOT DONE | — | below |
| F — real model providers | PARTIAL | the OCR model (PP-OCRv4, pinned by sha256, carried in the folder package) runs beside Tesseract; no trained OBJECT detector exists — "DOMAIN MODEL NOT INSTALLED" stays | `98b265c`, `plan-ocr-model` |
| G — vision-language loop | BUILT TO THE BOUNDARY, NOT RUN | questions from the analysis's own doubts, a closed answer schema, suggestions applied to nothing; no key in the client, no guest data, plan text as quoted data; nothing runs without a relay | `f91d42e`, `vlm-replay` (scripted answers) |
| H — relations, capacity, facing | DONE on both plans | venue elements; printed matter is not seat evidence; banquettes; symbol rings; facing from the family stencil; overlapping readings held back | `c94bcfa` … `a353e66` |
| I — canvas and persistence | PARTIAL | Confirm writes the plan onto its own drawing; observed facing survives Confirm, save and reload; an unseen front is drawn with none | `ce0e62b`, `4da25c2` |
| J — data, security, delivery | THIS REPORT | captured decisions (`../../TRAINING-DATA.md`); hostile-input checks for the two new entry points; both offline packages built and run | gates below |

## Gates on the delivered source

| gate | result |
|---|---|
| `npm run test:all` (`08da891`) | **127 / 127 suites, 3758 / 3758 checks** |
| `npm run build:offline` · `build:offline-full` | both built |
| `npm run verify:offline` (runs the built packages, network refused, OCR included, opened from disk) | **42 / 42** |
| object benchmark vs `BASELINE.json` | no regressions (re-recorded at `f91d42e` with the two moved fields explained: `2821e7a`) |
| adversarial `--compare` | 0 blocking; the two accepted FAILs (a2, a6) |
| memory `--compare` | met (re-recorded at `f91d42e`, reason stored: `3e23181`) |
| detector fingerprint | 28 plans recorded at the delivered source |
| CI on `8a30427` (push and pull_request runs) | **all five jobs green** |

## Score

**8 / 10 — measured, not 9.**

The contract defines 9/10 as every row met on both real plans. 77 of 82 are
met, so by its own definition this is not a 9, and the rows were not moved to
make it one. What keeps it at 8 rather than lower: none of the five misses
puts a wrong object in front of the operator — two are extents the product
says it did not measure, one is facing it declines to guess (every stated
facing is right), one is the annotation's nominal circle against a
photographed ellipse, and one is wall clock at the edge of its budget on this
hardware. Precision is at or near 1 on every object class on both plans, the
digital plan lands on its drawing (centre error p90 0.035 and 0.097 of a
table), and corrections fall from 14.2 and 11.5 to 4.55 and 2.75 per hundred
objects.

What keeps it from 9 beyond the contract: it is two plans. Nothing here
measures a venue the product has not seen, the photometric renderings still
break table detection on five of sixteen, Visual Plan Memory keeps 80% of
decisions across renderings against a 98% target, and the vision-language and
vector paths have never run on a real document. A score for unseen venues is
not claimed.

## Not done, and why

| item | what it needs | why it is not done here |
|---|---|---|
| **G — run the vision-language loop** | a relay at the app's own origin holding a **paid API key** server-side, and the operator's decision to send plan **crops** off the machine | no relay and no key exist for this product, and the session's own credentials are not the product's. Size measured: 4 questions on the Golden Plan, 19 on ORNEK, about 450 input + 40 output tokens each (estimate; the loop measures real usage). Cost is computed only from a price table the operator supplies |
| **D — read vector geometry** | one real CAD-exported PDF plan | `ORNEK.pdf` is one JPEG and no font; a vector reader tuned on synthetic PDFs would be fitted to drawings no venue sent. Text objects ARE read today |
| **E — high-resolution tiled scan** | a measured reason on a real plan | the only small-object failure is the synthetic `a8` (3,240 chairs, recall 0.089); both real plans are found at full recall without it, and a tiled pass changes the detector on every one of the 28 fingerprinted plans |
| **F — a trained object detector** | a labelled dataset grouped by venue (`benchmarks/TRAINING-DATA.md` captures it) | two plans cannot train or validate one; "DOMAIN MODEL NOT INSTALLED" stays true |
| facing of bistro and pale chairs | a stencil that resolves a backrest at this resolution | 30 chairs state nothing rather than a guess |
| bar and entrance extents | a closed outline in the drawing | the counter and the doorways are open to the room |
| ORNEK under 60 s on slower hardware | narrower recognition inputs (changes what the OCR model reads, so it must be re-measured on every number) or multi-threaded WebAssembly (needs cross-origin isolation, which a file opened from disk never has) | measured; not attempted in this programme |
| generalization | a third real plan and a real operator session | neither was made up |

**Where the work is.** Every commit above is pushed to
`claude/merit-concept3-plan-intelligence-rebirth`, the branch of PR #5 (not
merged). This session was pointed at `claude/event-maker-product-elevation-v1-xtvc4c`,
which is PR #3's single commit from August on a separate line of history;
pushing there would have needed a force-push over that open pull request, so
it was not done. No EXE, no SQLite.

## Reproduce

```
npm run vendor:test                                   # once
node benchmarks/plan-understanding/measure.mjs        # the contract, both plans
npm run benchmark && npm run benchmark:baseline       # objects, against BASELINE.json
npm run benchmark:adversarial -- --compare
npm run benchmark:memory -- --compare
npm run test:all
npm run build:offline && npm run build:offline-full && npm run verify:offline
```
