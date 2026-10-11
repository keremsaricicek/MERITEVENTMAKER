# Offline plan intelligence: what was built, what was measured

Started 2026-10-11 from `276c925`. The thresholds every number here is judged
against are in [`ACCEPTANCE.md`](ACCEPTANCE.md). They were fixed before the
first result and have not been changed since. Every number below was measured
in this repository by the script named beside it, with the network refused
(`tests/lib/env.mjs`). A row that was not measured says **NOT MEASURED**.

## What exists now

| Piece | Where | State |
|---|---|---|
| Local plan-symbol detector v1 | `src/plan-model.js`, `models/plan-detector/v1/` | ships, on by default, loaded only from pinned bytes (size + sha256) |
| Fusion with the classical candidates | `src/plan-model-fusion.js` | adds tables only; removes and moves nothing |
| Training pipeline (CPU) | `training/` | synthetic generator, trainer, calibration, ONNX export, packaging, activation |
| Real-plan dataset export | `training/export_plans.py` | an app backup → per-venue dataset with each label's verification state |
| Vector-PDF furniture proposals | `src/plan-vector-objects.js` | repeated shapes in a vector PDF → tables and chairs, fused like the model |
| Exemplar search ("find more like this") | `src/plan-exemplar.js` | NCC template matching at four quarter turns |
| Comparison harness | `run.mjs`, `exemplar-measure.mjs`, `vector-measure.mjs` | each a child of `benchmarks/run-benchmark.mjs`'s scoring |

## The model

- **Architecture**: a CenterNet-style fully convolutional network.
  - 882,864 parameters, stride 4, grey input, long side 1536.
  - Four classes: round table, rectangular table, chair, column.
- **Training**: 4,000 steps on 4 CPU cores in 2,317 s, on synthetic banquet
  plans only (`training/synth.py`, styles 0–7).
  - No real plan was used, so Golden and ORNEK are venues it never saw.
  - The two remaining synthetic styles (8, 9) are held out.
- **Threshold**: 0.5 for every class, fixed in advance.
  - Calibrating on synthetic plans did not transfer: a 0.95 precision target
    picked 0.2 and a 0.995 target picked about 0.75.
  - Tuning on Golden/ORNEK would have tuned on the plans it is scored on.
- **Size and export**: 3,540,361 bytes as ONNX opset 17. Its outputs match
  PyTorch to within 7e-7.
- **Runtime**: in the app it runs on the onnxruntime-web 1.30.0 that OCR
  already loads (WASM, single thread). It took 2.2–3.0 s per plan in the
  runs below.

### The model alone, on venues it never saw (`training/detector.py eval`)

| Plan | Tables P / R / F1 | Chairs P / R | Table type |
|---|---|---|---|
| Golden | 0.978 / 0.957 / 0.967 | 0.950 / 0.841 | 44 / 44 |
| ORNEK | 0.994 / 1.000 / 0.997 | — (draws no chairs) | 166 / 166 |
| Synthetic held-out styles (8, 9) | 0.997 / 0.996 | 0.999 / 0.996 (columns 1.000 / 0.791) | |

The classical pipeline on the same plans scores tables F1 0.958 (Golden) and
0.985 (ORNEK), and chairs F1 0.964 (Golden).

## Fused into the product: classical vs classical + model

`node benchmarks/offline-intelligence/run.mjs --set regression` →
`results-regression.json`.

- **Scoring**: the same plans, labels and matching (`run-benchmark.mjs`).
- **Switch**: the only difference between the two runs is
  `MERIT_BENCH_MODEL=off`.
- **Why it is a fair new-venue comparison here**: these six plans are the
  regression set, which every classical rule was tuned on. The model saw none
  of them.

| Plan | Classical tables TP/FP/FN | Fused tables TP/FP/FN | Chairs (both) |
|---|---|---|---|
| ORNEK | 162 / 1 / 4 (R 0.976) | **165 / 1 / 1 (R 0.994)** | — |
| Golden | 46 / 1 / 0 | 46 / 1 / 0 | 108 / 3 / 5 |
| adversarial-architecture | 10 / 0 / 0 | 10 / 0 / 0 | — |
| adversarial-bistro | 18 / 0 / 5 | 18 / 0 / 5 | — |
| adversarial-dense | 24 / 0 / 0 | 24 / 0 / 0 | — |
| adversarial-text | 12 / 0 / 0 | 12 / 0 / 0 | — |

`npm run benchmark:baseline` against the fused run: **no regressions, 5
improvements** (all ORNEK tables).

### What fusion was measured to do wrong, and what changed because of it

The first fused run regressed in ten places against the committed baseline.
Each was diagnosed on the plan, not guessed at.

| Found | Cause | Change |
|---|---|---|
| Golden: two classical phantom tables survived | A model chair attached to them exempted them from text suppression. | A model chair attaches only to a table the model also sees. Suite: `local-model`. |
| adversarial-architecture: +1 table | The model read column C3 as a table. | Nothing is added with its centre on a classical venue object. |
| Columns: 23 added, 0 real | Trained on synthetic only, because the real annotations mask columns. | Model columns are off in v1 (`addColumn: null`). |
| Golden chairs: +4 right, +3 wrong (57 %) | A grey seat-like box under two tables that is not a chair, and a speck. | Model chairs are off in v1 (`addChair: null`). Classical chair precision (0.973) is already under the 0.98 bar, and a chair has no review line to hold it as a question. |

### What the adversarial gate found with v1 (`npm run benchmark:adversarial -- --compare`)

**a1-chair-under-table: tables F1 0.667 → 0.400, a BLOCKING regression.**

- The fixture has 16 long banquet tables (about 2.3 : 1).
- The model alone, at 0.5, splits each of the 8 that classical detection
  misses into two square-ish halves. That gives 16 phantom tables (4
  selected, 12 held under the review line, all counted by the gate).
- It sees none of the 8 tables with chairs drawn on top of them.

**Cause: the training data.** Synthetic generation 1 drew single
rectangular tables only at 1 : 1 or 1.6 : 1. A long table existed only as a
row of pushed-together squares, each labelled as its own table, so "a long
rectangle is several tables" is what v1 learned. Chairs drawn over a table
never occurred.

**Change: v2.**
- Synthetic generation 2 adds single long tables (1.8–3.5 : 1, chairs on
  both sides) and chairs drawn over the table edge.
- Still no real plan, so Golden and ORNEK remain unseen venues.
- Fusion was not given a rule to hide this.

**Recorded honestly:** a1 shaped v2's training distribution, so a1 is no
longer a blind test of the model.

Turning chairs or columns back on is a new measurement, not a default. The
rules for both stay in the code and are tested with them switched on.

## Against the acceptance table

| Row | Threshold | Golden | ORNEK |
|---|---|---|---|
| Table precision | ≥ 0.98 | 0.979 ✗ | 0.994 ✓ |
| Table recall | ≥ 0.95 | 1.000 ✓ | 0.994 ✓ |
| Chair precision / recall | ≥ 0.98 / ≥ 0.95 | 0.973 ✗ / 0.956 ✓ | — |
| Table type accuracy | ≥ 0.95 | 1.000 ✓ | 1.000 ✓ |
| Chair → table link | ≥ 0.97 | 0.990 ✓ | — |
| Venue objects (columns) | recall ≥ 0.90 | no columns annotated; 9 proposed | none annotated; 4 proposed |
| **Real blind plans** | the 9.5 claim | **NOT MEASURED — no such plan exists in the repository** | |

The rows not yet measured in this programme are filled in below as they are
run:

- the cross-venue folds;
- exemplars;
- vector PDF;
- memory;
- OCR;
- hardware.
