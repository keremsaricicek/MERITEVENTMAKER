# Offline plan intelligence: what was built, what was measured

Started 2026-10-11 from `276c925`. The thresholds every number here is judged
against are in [`ACCEPTANCE.md`](ACCEPTANCE.md). They were fixed before the
first result and have not been changed since. Every number below was measured
in this repository by the script named beside it, with the network refused
(`tests/lib/env.mjs`). A row that was not measured says **NOT MEASURED**.

## What exists now

| Piece | Where | State |
|---|---|---|
| Local plan-symbol detector **v2** (v1 kept for rollback) | `src/plan-model.js`, `models/plan-detector/v2/` (and `v1/`) | ships, on by default, loaded only from pinned bytes (size + sha256) |
| Fusion with the classical candidates | `src/plan-model-fusion.js` | adds tables only; removes and moves nothing |
| Training pipeline (CPU) | `training/` | synthetic generator (2 generations), trainer, calibration, ONNX export, packaging, activation |
| Real-plan dataset export | `training/export_plans.py` | an app backup → per-venue dataset with each label's verification state and who suggested it |
| Vector-PDF furniture proposals | `src/plan-vector-objects.js` | repeated shapes in a vector PDF → tables and chairs, fused like the model |
| Exemplar search ("find more like this") | `src/plan-exemplar.js` | measured below; fails its row; not in the UI |
| Comparison harness | `run.mjs`, `exemplar-measure.mjs`, `vector-measure.mjs`, `teacher-e2e.mjs` | each scored with `benchmarks/run-benchmark.mjs`'s own matching |
| What the operator sees | `screens/` | the review screen with the model's line in Advanced diagnostics, at 1920 / 2560 / 1440, TR and EN, and with the model off ("DOMAIN MODEL NOT INSTALLED" plus the reason). Rendered, 0 console errors, no horizontal overflow |

## The model

- **Architecture**: a CenterNet-style fully convolutional network.
  - 882,864 parameters, stride 4, grey input, long side 1536.
  - Four classes: round table, rectangular table, chair, column.
- **Trained on synthetic banquet plans only** (`training/synth.py`, styles
  0–7; styles 8 and 9 held out). No real plan was used by either version, so
  Golden and ORNEK are venues they never saw.
  - **v1**: generation 1, 4,000 steps from scratch, 2,317 s on 4 CPU cores.
  - **v2**: generation 2, which adds single long banquet tables and chairs
    drawn over the table edge (see "v1 and the adversarial gate" below).
    2,500 steps warm-started from v1, about 30 minutes.
- **Threshold**: 0.5 for every class, fixed in advance.
  - Calibrating on synthetic plans did not transfer: a 0.95 precision target
    picked 0.2 and a 0.995 target picked about 0.75.
  - Tuning on Golden/ORNEK would have tuned on the plans it is scored on.
- **Size and export**: 3,540,361 bytes each as ONNX opset 17. v1's outputs
  match PyTorch to within 7e-7.
- **Runtime**: in the app it runs on the onnxruntime-web 1.30.0 that OCR
  already loads (WASM, single thread). It took 2.0–3.4 s per plan in the runs
  below.

### The model alone (`training/detector.py eval`, threshold 0.5)

| Plan | v1 tables TP / FP / FN | v2 tables TP / FP / FN | v1 chairs P / R | v2 chairs P / R |
|---|---|---|---|---|
| Golden (never seen) | 44 / 1 / 2 | 44 / 1 / 2 | 0.950 / 0.841 | 0.920 / 0.920 |
| ORNEK (never seen) | 166 / 1 / 0 | **166 / 0 / 0** | — | — |
| Held-out styles, generation 1 (80 plans) | P 0.995 / R 0.997 | P 0.998 / R 0.992 | 0.999 / 0.995 | 0.999 / 0.986 |
| Held-out styles, generation 2 (80 plans) | P 0.982 / R 0.891 (34 FP) | **P 0.995 / R 0.911 (10 FP)** | 0.999 / 0.968 | 1.000 / 0.979 |

The classical pipeline on the same real plans scores tables F1 0.958 (Golden)
and 0.985 (ORNEK), and chairs F1 0.964 (Golden).

## Fused into the product: classical vs classical + model (v2)

`node benchmarks/offline-intelligence/run.mjs --set regression` →
`results-regression.json`.

- **Scoring**: the same plans, labels and matching (`run-benchmark.mjs`).
- **Switch**: the only difference between the two runs is
  `MERIT_BENCH_MODEL=off`.
- **What kind of evidence this is**: these six plans are the REGRESSION set.
  Every classical rule was tuned on them, and so was every fusion rule below:
  each one was set by diagnosing a failure on one of these plans. **These
  rows prove nothing got worse; they are not new-venue results.** The model
  alone (the table above) is the unseen-venue number.

| Plan | Classical tables TP/FP/FN | Fused tables TP/FP/FN | Chairs (both) |
|---|---|---|---|
| ORNEK | 162 / 1 / 4 (R 0.976) | **165 / 1 / 1 (R 0.994)** | — |
| Golden | 46 / 1 / 0 | 46 / 1 / 0 | 108 / 3 / 5 |
| adversarial-architecture | 10 / 0 / 0 | 10 / 0 / 0 | — |
| adversarial-bistro | 18 / 0 / 5 | 18 / 0 / 5 | — |
| adversarial-dense | 24 / 0 / 0 | 24 / 0 / 0 | — |
| adversarial-text | 12 / 0 / 0 | 12 / 0 / 0 | — |

- `npm run benchmark:baseline` against the fused run: **no regressions, 5
  improvements** (all ORNEK tables).
- `npm run benchmark:adversarial -- --compare`: **0 blocking**. The 2
  KNOWN FAILs are unchanged.

### What fusion was measured to do wrong, and what changed because of it

Each row was diagnosed on the plan, not guessed at.

| Found | Cause | Change |
|---|---|---|
| Golden: two classical phantom tables survived | A model chair attached to them exempted them from text suppression. | A model chair attaches only to a table the model also sees. |
| adversarial-architecture: +1 table | The model read column C3 as a table. | Nothing is added with its centre on a classical venue object. |
| Columns: 23 added, 0 real | Trained on synthetic only, because the real annotations mask columns. | Model columns are off (`addColumn: null`). |
| Golden chairs: +4 right, +3 wrong (57 %) | A grey seat-like box under two tables that is not a chair, and a speck. | Model chairs are off (`addChair: null`). Classical chair precision (0.973) is already under the 0.98 bar, and a chair has no review line to hold it as a question. |
| Golden, v2: +1 table | A 24 px planter read as a round table; the plan's tables are about 45 px. | A model table is added only at the size the plan's tables are drawn at (±40 % of the classical median, the criterion that already decided selection). With no classical table to compare with, an addition is only ever a question. |

Every rule is checked by the `local-model` suite. The chair and column rules
are tested with those classes switched on, so turning one back on is a new
measurement, not a default.

### v1 and the adversarial gate

**a1-chair-under-table: tables F1 0.667 → 0.400 with v1, a BLOCKING
regression.**

- The fixture has 16 long banquet tables (about 2.3 : 1).
- v1 alone, at 0.5, split each of the 8 that classical detection misses into
  two square-ish halves. That gave 16 phantom tables (4 selected, 12 held
  under the review line, all counted by the gate).
- It saw none of the 8 tables with chairs drawn on top of them.

**Cause: the training data.** Generation 1 drew single rectangular tables
only at 1 : 1 or 1.6 : 1. A long table existed only as a row of
pushed-together squares, each labelled as its own table, so "a long rectangle
is several tables" is what v1 learned. Chairs drawn over a table never
occurred.

**Change: v2 (generation 2 data, no fusion rule).** On a1, v2 alone proposes
**no table at 0.5**: no phantoms, but it does not find a1's missing tables
either. Its strongest responses there are 0.15–0.19, at the top row's tables
with chairs drawn on them. So the gate is clean (a1 back to 0.667), and a1's
recall is still the classical 0.5.

**Recorded honestly:** a1 shaped v2's training distribution, so a1 is no
longer a blind test of the model.

## Cross-venue folds (leave one venue out)

Each fold is v2 warm-started and trained 1,200 more steps on generation-2
synthetic plans plus ONE real venue, then scored on the other venue, which
it never saw. Model alone: `training/detector.py eval`. In the app:
`run.mjs --set lovo` → `results-lovo.json`, through the product's own loader
and fusion.

| Fold | Trained with | Scored on (unseen) | Model alone, tables TP/FP/FN | Model alone, chairs P / R | In the app, tables TP/FP/FN |
|---|---|---|---|---|---|
| v2 (shipped) | synthetic only | Golden | 44 / 1 / 2 | 0.920 / 0.920 | 46 / 1 / 0 |
| v2 (shipped) | synthetic only | ORNEK | 166 / 0 / 0 | — | 165 / 1 / 1 |
| foldA | + Golden | ORNEK | 166 / 0 / 0 | — | 165 / 1 / 1 |
| foldB | + ORNEK | Golden | **42 / 1 / 4** | **0.967 / 0.788** | **46 / 2 / 0** |

**What it says:**
- Adding one real venue did not help the other. foldA could not improve on
  ORNEK, which v2 already scores 166/0/0.
- foldB is WORSE on Golden than the synthetic-only v2: table recall 0.957 →
  0.913, chair recall 0.920 → 0.788, and one more phantom table in the app.
  ORNEK draws no chairs; its "no chair here" labels and its single symbol
  style pulled the model away from a drawn-furniture plan.
- So v2 stays active. A model trained on both venues would have no unseen
  venue left to check it against, and foldB shows what that risks.
- **Two folds are two data points**, not a distribution. The honest headline
  stays "real blind: NOT MEASURED".

## Teacher → person → dataset → training → package → load (scripted teacher)

`MERIT_TRAIN_PYTHON=… node benchmarks/offline-intelligence/teacher-e2e.mjs` →
`teacher-e2e-latest.json`. The teacher is `tests/lib/fake-anthropic.mjs`.
Its answers are SCRIPTED, so this proves the path and says nothing about any
model's quality. **12 / 12 passed:**

1. **The teacher suggests.** Its three findings arrive as suggestions, and
   nothing changes.
2. **A person decides.** They accept a missing table and a chair, dismiss a
   "not an object", confirm one table and reject another, all through the
   review's single writer.
3. **The app's own Backup button** writes the file. `export_plans.py` makes
   it a dataset:
   - the accepted suggestions are `human-confirmed`, `suggestedBy: vlm`;
   - the dismissed one is listed as `teacher-suggested` and is NOT an object;
   - the reject is `rejected`.
4. **The trainer reads only the person's labels.**
   - It reads 5 targets, exactly the 5 human-confirmed objects.
   - It ignores the 161 objects nobody verified, teaching them as neither
     object nor background.
   - The rejections are background.
5. **Packaging.** 30 training steps (plumbing only), ONNX export, packaged
   with its own sha256, outside the repository.
6. **Loading and rollback.**
   - The app loads the new version through its own loader, checked by
     sha256.
   - A wrong hash is refused (`MODEL_INTEGRITY`) and the analysis completes
     classically.
   - With no override the pinned v2 runs again: rollback is re-pinning.

**Found by this run:** the model-reading relay (`npm run serve:vlm`) served
only `index.html` and `src/`. An operator using the model reading therefore
got the classical path alone (`MODEL_MISSING`). The relay now also serves
`models/plan-detector/<version>/model.js`, and nothing else from that folder;
`vlm-relay` checks both.

## Vector PDF: the document's own shapes (synthetic PDFs only)

`node benchmarks/offline-intelligence/vector-measure.mjs DIR` →
`vector-latest.json`.

- **The PDFs:** six synthetic vector PDFs from `training/synth_pdf.py`, with
  circle and rectangle paths and text, and exact annotations.
- **The procedure:** each is imported through the app's own PDF path, then
  analysed with vector fusion off and on.
- **The rule** (`src/plan-vector-objects.js`): furniture is what repeats. A
  table is the repeated group ringed by a smaller repeated group (its
  chairs).

| PDF | Chairs recall, off → on | Tables, off → on | Added false objects |
|---|---|---|---|
| cad-line-5-0 | 0.000 → 0.945 (503 / 532) | 70 / 10 / 0 → same | 0 |
| cad-line-5-3 | 0.887 → 0.990 | 54 / 0 / 0 → same | 0 |
| mono-num-chairs-5-2 | 0.940 → 1.000 | 24 / 0 / 1 → **25 / 0 / 0** | 0 |
| mono-num-chairs-5-5 | 0.998 → 1.000 | 48 / 1 / 0 → same | 0 |
| thin-circle-5-1 | 0.000 → 0.857 | 21 / 40 / 0 → same | 0 |
| thin-circle-5-4 | 1.000 → 1.000 | 32 / 0 / 0 → same | 0 |

**What the first run showed.** The first run measured no change at all,
because the vector call had inherited the model's chairs-off default. The
model measurement that set that default (4 right, 3 wrong) says nothing
about chairs a document draws as shapes. So the vector call attaches chairs,
and records "not drawn as a table" in `vectorSupport`, never `modelSupport`.

**Still open:**
- Fusion only adds. The classical phantoms on cad-line-5-0 (10) and
  thin-circle-5-1 (40) stay, flagged where the PDF does not draw them.
- **No real CAD PDF exists in the repository** (ORNEK.pdf is a scan), so
  this is synthetic evidence only.

## OCR: PP-OCRv5 against v4, each on its official settings

`node benchmarks/ocr/compare-ppocr.mjs` → `benchmarks/ocr/compare-latest.json`.
Same app, same code path. Every model runs once on the product's detection
settings and once on its OWN official ones: ImageNet normalisation in BGR
order, its size limits, box threshold and unclip ratio. Neither is judged on
the other's terms.

| ORNEK, 157 legible table numbers | Right | Wrong | Unread | Time |
|---|---|---|---|---|
| v4, product settings (**in use**) | **145** | **0** | 12 | 64 s |
| v4, official settings | 113 | 0 | 44 | 41 s |
| v5, product settings | 120 | 0 | 37 | 67 s |
| v5, official settings | 131 | **3** | 23 | 65 s |

- Golden: all four read the same 9 words.
- On its official settings v5 reads more than on the product's (120 → 131),
  but still fewer than v4 (145).
- **It reads three numbers wrong.** ACCEPTANCE.md allows 0, because a wrong
  number is worse than an unread one.
- **v4 stays.** PP-OCRv5 is rejected again, now on fair terms.

## Hardware: two cores, a 4 GB memory cap (Linux simulation, NOT a Windows laptop)

`MERIT_MEM_CGROUP=/sys/fs/cgroup/memory/<cap> taskset -c 0,1 node
benchmarks/hardware/measure-constrained.mjs 3`, with `MERIT_BENCH_MODEL=off`
for the same build without the local detector. Three runs each; median /
p95. Results: `benchmarks/hardware/constrained-latest.json` and
`constrained-latest-model-off.json`.

| Same machine, same day | Golden analysis | ORNEK analysis | Longest main-thread task (G / O) | Peak browser memory (G / O) |
|---|---|---|---|---|
| `a043f26` (before this programme) | 13.8 / 15.4 s | 70.1 / 70.9 s | — | 1.05 / 1.46 GB |
| now, model off | 17.0 / 17.2 s | 72.7 / 84.1 s | 2.4 / 5.3 s | 1.09 / 1.44 GB |
| now, model on (run 1) | 18.1 / 18.4 s | 75.5 / 79.6 s | 3.3 / 4.8 s | 1.08 / 1.47 GB |
| now, model on (run 2) | 16.2 / 16.3 s | 69.0 / 69.0 s | 3.5 / 4.5 s | 1.04 / 1.46 GB |

- **The model's own cost**, recorded by the app:
  - inference 2.9 s median (3.5 s p95);
  - cold load 0.3–1.0 s (fetch, base64 decode, sha256, session).
  Run-to-run noise on this machine (±3 s) is larger than the model's share
  of the total, so "on minus off" is not a usable measure here.
- **The memory cap was never reached** (failcnt 0, cgroup peak ≤ 1.37 GB of
  4 GB).
- **This machine is slower today** than when `a043f26`'s 10.4 / 50.2 s was
  recorded: the same commit now measures 13.8 / 70.1 s.

| Acceptance row | Threshold | Measured | |
|---|---|---|---|
| ORNEK-size plan p50 / p95 | ≤ 30 s / ≤ 60 s | 69–76 s / 69–80 s | **NOT MET** |
| Golden-size plan p50 / p95 | ≤ 10 s / ≤ 20 s | 16–18 s / 16–18 s | p50 **NOT MET**, p95 met |
| Model load (cold) | ≤ 5 s | 0.3–1.0 s | met |
| Peak browser memory | ≤ 2.0 GB | 1.04–1.49 GB | met |
| Longest main-thread task | ≤ 500 ms | 3.3–5.7 s | **NOT MET**, with or without the model |

**Where the time goes is not the model.** It is the classical detection and
OCR stages, which run on the page's main thread. Two changes would address
it, neither done:
- moving the model's inference to a worker (onnxruntime-web's proxy
  worker);
- moving classical detection off the main thread.

**Not measured:** a real Windows laptop with 8 GB.

## Three approaches, compared

| Approach | State | Evidence |
|---|---|---|
| 1. Classical + OCR + rules | measured | `results-regression.json`, "classical" rows. Every rule was tuned on these plans. |
| 2. + a small local detector (v2) | **shipped**, measured | The model alone on venues it never saw (above); fused on the regression set; LOVO folds; all CI gates green. Adds 3 real tables on ORNEK, 0 false ones anywhere in the regression set. |
| 3. + a small local vision-language model on uncertain regions | **NOT MEASURED** | Every candidate's weights (Florence-2, SmolVLM, Qwen3-VL) are on hosts this environment refuses (403). CPU time, RAM, start-up and accuracy on plan crops are unknown. `LOCAL-VLM.md` says what would unblock it. |

## Against the acceptance table (shipped product: classical + v2)

ACCEPTANCE.md is unchanged since `276c925`. ✓ met · ✗ not met · — not
measurable here.

| Row | Threshold | Measured | |
|---|---|---|---|
| **Real blind plans** | the 9.5 claim | no plan from an unseen venue exists in the repository | **NOT MEASURED** |
| Table precision, Golden / ORNEK | ≥ 0.98 | 0.979 / 0.994 | ✗ / ✓ |
| Table recall, Golden / ORNEK | ≥ 0.95 | 1.000 / 0.994 | ✓ / ✓ |
| Chair precision / recall, Golden | ≥ 0.98 / ≥ 0.95 | 0.973 / 0.956 | ✗ / ✓ |
| Table type accuracy | ≥ 0.95 | 1.000 / 1.000 | ✓ |
| Chair → table link, Golden | ≥ 0.97 | 0.990 | ✓ |
| Venue objects (columns) | recall ≥ 0.90 | Golden 9 of 10 (0.90), ORNEK 4 of 4, **0 false** on either, scored against `benchmarks/plan-understanding/truth`, which does label columns (`latest/report.json`, 2026-10-10). The base annotations this table's other rows use do not label columns, so the regression run's "9 / 4 false positives" were the true columns counted against a set that leaves them out (re-checked 2026-10-11). | ✓ |
| Printed numbers: wrong / read, ORNEK | 0 / ≥ 0.90 | 0 wrong; 148 of 157 legible (0.94) — 145 before the tables the local detector added joined the number reading (2026-10-11; the three it adds, 74, 75 and 76, are each VERIFIED and right) | ✓ / ✓ |
| Decision memory: retention / wrong application | ≥ 0.98 / 0 | 0.8447 / 0.0073 | ✗ / ✗ |
| Local examples (exemplar search) | ≥ 50 % recovered, ≤ 1 phantom / 100 | 0 % recovered, up to 9 / 100 | ✗ (not in the UI) |
| Model update: regression check, version recorded, rollback | all three | baseline + adversarial before activation; pinned by sha256; rollback tested end to end (`teacher-e2e`) | ✓ |
| ORNEK-size plan, 2 cores, p50 / p95 | ≤ 30 s / ≤ 60 s | 69–76 s / 69–80 s | ✗ / ✗ |
| Golden-size plan, 2 cores, p50 / p95 | ≤ 10 s / ≤ 20 s | 16–18 s / 16–18 s | ✗ / ✓ |
| Model load (cold) | ≤ 5 s | 0.3–1.0 s | ✓ |
| Peak browser memory | ≤ 2.0 GB | 1.04–1.49 GB | ✓ |
| Longest main-thread task | ≤ 500 ms | 2.4–5.7 s (with or without the model) | ✗ |
| Off-origin requests, offline package | 0 | 0 (`verify:offline` 44 / 44) | ✓ |
| Model missing / corrupt / disabled | completes classically, says why | `local-model`, `verify:offline` | ✓ |

**What the numbers say about the 9.5 target.** It is not demonstrated, and
cannot be with what this repository holds:
- two real venues, both on the regression set;
- no plan from a venue nobody has seen;
- no real Windows laptop.

What can be claimed:
- The model, trained on synthetic plans only, scores tables 0.978 / 0.957
  (Golden) and 1.000 / 1.000 (ORNEK) on venues it never saw.
- In the product it adds what the classical pass missed without adding a
  single false table on any of the six regression plans.

## Decision memory: a rule tried, measured, and not shipped

`npm run benchmark:memory -- --compare`, seven transformed copies of the
Golden Plan, 161 scoreable decisions.

| Measure | Target (ACCEPTANCE.md) | Measured |
|---|---|---|
| Retention | ≥ 0.98 | **0.8447** ✗ |
| Wrong application | 0 (≤ 0.5 %) | **0.0073** ✗ (one decision, on the grayscale copy) |
| Identity precision | — | 0.9927 |

The worst copy is the JPEG-quality-20 rescan: 11 of 23 decisions kept, 12
lost. Its conflicts are 11 ambiguous and 7 overruled.

**Tried:** a duplicate rule. A non-strong match becomes strong when its
runner-up overlaps the best candidate (IoU ≥ 0.5), on the theory that the
ambiguity was two detections of one object.

**Result:** every scenario identical to the recorded baseline, decision for
decision. So the ambiguity is between genuinely distinct neighbouring tables,
not duplicates. The rule was reverted and is not shipped. Retention and
wrong-application remain **NOT MET**.

## Local examples (exemplar search): measured, fails its row, not in the UI

`node benchmarks/offline-intelligence/exemplar-measure.mjs` →
`exemplar-latest.json`.

- **Setup:** the model is switched off, so the search is measured on the
  classical misses alone. The exemplars are k correct detections (what a
  person would confirm). The search is normalised cross-correlation at four
  quarter turns, threshold 0.72, excluding everything already found.

| Plan, class | Misses before | k = 1: recovered / phantoms | k = 3: recovered / phantoms |
|---|---|---|---|
| Golden, tables | 0 | 0 / 0 | 0 / 0 |
| Golden, chairs | 5 | 0 / 1 | 0 / 1 |
| ORNEK, tables | 4 | 0 / 0 | **0 / 15** |

Acceptance asks for ≥ 50 % of misses recovered and ≤ 1 phantom per 100
objects. Measured: **0 % recovered**, and up to 15 phantoms on ORNEK's 166
tables (9 per 100). **NOT MET.**

**Why:**
- ORNEK's four misses are the faint tables 73–76, printed at grey 238–242.
  Their correlation with a dark exemplar stays under any threshold that
  does not also admit text and boxes.
- Golden's missed chairs are partly hidden under tables.

So `src/plan-exemplar.js` stays as a measured component. It is not offered
in the review UI, and no "find more like this" control exists.

