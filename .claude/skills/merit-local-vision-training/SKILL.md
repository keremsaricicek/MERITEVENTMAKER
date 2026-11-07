---
name: merit-local-vision-training
description: Local, CPU-only, zero-cost training, evaluation, optimisation and dataset inspection for MERIT EVENT MAKER's own plan-symbol detector (training/detector.py — round/rect tables, chairs, columns). An ADAPTATION of huggingface/skills' huggingface-vision-trainer (Apache-2.0) with every Hugging Face Jobs, Hub-upload, Trackio and cost flow removed. Use when training or fine-tuning a detector candidate, checking a dataset before training, scoring a candidate with COCO box metrics, or measuring a quantized/optimised ONNX on CPU. Not for D-FINE, RT-DETR, DETR, YOLOS, timm or SAM — those are not supported in this repository.
---

# Local vision training for the plan-symbol detector

## Provenance — this is an adaptation

| | |
|---|---|
| Upstream | https://github.com/huggingface/skills — `skills/huggingface-vision-trainer` |
| Commit | `c3ff942be3e07116b475253f0a8fc4f54682c1a8` (2026-10-08) |
| Licence | Apache License 2.0 — full text in `LICENSE.txt` beside this file (copied unchanged from the upstream repository root) |
| Adapted | 2026-10-12, for this repository |

**What was changed (Apache-2.0 §4(b) notice).** The upstream skill trains
Transformers models (D-FINE, RT-DETR v2, DETR, YOLOS, timm, SAM/SAM2) on paid
Hugging Face Jobs GPUs, pushes results to the Hub, monitors with Trackio and
estimates cost. All of that was removed: none of it is free, and this project
uploads no plan, dataset or model. No upstream script is shipped here. What was
KEPT is its discipline, re-expressed for this repository:

- validate the dataset BEFORE training, and answer READY or say exactly what is
  wrong (upstream `dataset_inspector.py` → `scripts/inspect_dataset.py`, new
  code for this repository's annotation format, local files only);
- sanitise boxes and fail loudly on bad ones (upstream's bbox preprocessing);
- the five reliability principles of upstream `references/reliability_principles.md`
  (verify before use; reliability over speed; atomic scripts; clear error
  context; test the happy path on known-good input first), applied below;
- COCO-style box evaluation (upstream uses torchmetrics `MeanAveragePrecision`;
  here pycocotools, with FiftyOne's matcher as a cross-check).

## What this skill supports — and what it does not

| Supported here (measured working, 2026-10-12) | NOT supported here |
|---|---|
| `training/detector.py` train / eval / calibrate / export on CPU (CenterNet-style, ~0.9 M params, 4 classes) | D-FINE, RT-DETR, DETR, YOLOS, timm, SAM/SAM2 — their weights come from the HF Hub, which this environment refuses (403), and no Transformers training is set up. Do not describe them as available. |
| Dataset pre-flight: `scripts/inspect_dataset.py` | Hugging Face Jobs, Hub push, Trackio, cost estimation — removed on purpose |
| COCO box metrics: `tools/model-dev/examples/eval_detector_coco.py` (pycocotools + FiftyOne matcher) | FiftyOne datasets, App and `evaluate_detections` — need MongoDB; `fiftyone-db` downloads `mongod` from fastdl.mongodb.org, refused here (403). Works with `FIFTYONE_DATABASE_URI` pointing at a MongoDB you run. |
| INT8 / graph optimisation: `tools/model-dev/examples/quantize_detector.py` (`--engine ort` always; `--engine olive` when torch is importable) | A GPU. None exists; every number here is CPU. |
| Local vision-language model weights | NOT solved by this setup: the egress gateway still answers 403 to huggingface.co and its file hosts (`benchmarks/offline-intelligence/LOCAL-VLM.md`). Nothing here works around that. |

## Hard rules (project — these outrank anything upstream said)

1. **CPU only, zero spend, nothing leaves the machine.** No paid API, no HF Jobs,
   no GPU rental, no upload of a plan, dataset or model. Import
   `tools/model-dev/examples/offline_env.py` before onnxruntime, Olive or
   FiftyOne: onnxruntime 1.31.0 (Python, Linux) and Olive 0.13.0 BOTH send
   telemetry by default, and Olive's documented switch alone does not stop it —
   measured, see that file.
2. **The detector is a candidate until a person activates it.** Training writes
   `runs/<x>/`; nothing in `models/` or the PIN in `src/plan-model.js` changes
   until `training/package.py --activate`, which happens only after the
   **model-qa-specialist** verdict is SOUND and `benchmarks/offline-intelligence/run.mjs
   --set regression` + `npm run benchmark:baseline` show no regression.
3. **Thresholds are fixed before results are seen.** v2 is judged at 0.5 for
   every class. A candidate calibrated to a different threshold is "a threshold
   change dressed as a model change" (training/README.md, v3) unless it is ALSO
   reported at the fixed threshold.
4. **Per venue, per level, never one average.** Golden and ORNEK are the only real
   plans and both are evaluation-only for the shipped lineage. A venue a model
   trained on is never reported as unseen (`--heldout` leakage in the inspector).
5. **Only what a person decided is a training target** (`human-confirmed`, and
   `accepted-on-confirm` only with `--with-confirm`); unreviewed boxes are
   ignored, rejections are background, model-assisted labels never train.
6. **A smoke run proves plumbing, never quality.** 30 steps detect nothing; that
   is the expected result, not a failure, and never a metric.
7. Training uses every core: never run a browser benchmark at the same time
   (training slowed ~3× when they overlapped).

## Two environments, neither in the product

| | Training (torch) | Model tools (`.venv-model-dev`) |
|---|---|---|
| For | `training/*.py` | ONNX Runtime, Olive, FiftyOne, pycocotools |
| Set up | Python 3.11 + `torch==2.14.1` + `onnx numpy pillow` (training/README.md). PyPI's Linux torch is the CUDA build (~4.5 GB incl. nvidia libs; it does not import without them). Prefer `--index-url https://download.pytorch.org/whl/cpu` where reachable (refused here). | `bash tools/model-dev/setup.sh` (pinned lock); `--with-olive` adds CPU torch |
| Check | `python -c "import torch; print(torch.__version__)"` | `.venv-model-dev/bin/python -I tools/model-dev/check.py` |

`index.html`, `src/` and both offline packages load neither. The end user never
installs Python.

## Workflow (copy this checklist)

```
[ ] 1. Inspect      inspect_dataset.py --train … --val … --heldout …   → READY
[ ] 2. Smoke        synth 8 plans, train --steps 30, eval, export      → files exist, no error
[ ] 3. Train        detector.py train … --out runs/<name>              (record the command)
[ ] 4. Score        detector.py eval per level and per real plan, at the FIXED thresholds
[ ] 5. Box metrics  eval_detector_coco.py --onnx runs/<name>/model.onnx
[ ] 6. Optimise?    quantize_detector.py --onnx … --engine ort|olive   (optional; latency + agreement)
[ ] 7. Hand over    to model-qa-specialist with the run directory and every report
[ ] 8. Package      only on QA SOUND + regression benchmark; a person runs package.py --activate
```

```bash
I=.claude/skills/merit-local-vision-training/scripts/inspect_dataset.py
.venv-model-dev/bin/python -I $I --train D/train --val D/val --heldout D/heldout,golden,ornek

python training/synth.py --out S/train --count 8 --families 0,1,2,3 --seed 11
python training/synth.py --out S/val   --count 4 --families 0,1,2,3 --seed 23
python training/detector.py train  --synthetic S/train --steps 30 --batch 4 --out S/run
python training/detector.py eval   --model S/run/model.pt --plans S/val --report S/run/eval.json
python training/detector.py export --model S/run/model.pt --onnx S/run/model.onnx

.venv-model-dev/bin/python -I tools/model-dev/examples/eval_detector_coco.py --onnx S/run/model.onnx
.venv-model-dev/bin/python -I tools/model-dev/examples/quantize_detector.py --engine ort --onnx S/run/model.onnx
```

The full-size commands (v1/v2/v3, folds, generation-3 levels) are in
`training/README.md`; they are not repeated here so they cannot drift.

## Measured reference points (2026-10-12, this container: 4 cores, no GPU)

- **Smoke run** (steps above): synth 8 plans 2.8 s; 30 training steps 7 s; eval
  and export OK; exported ONNX 3 540 361 bytes; zero detections (expected).
- **Pinned v2, COCO box metrics** (pycocotools; FiftyOne's matcher gives the
  same TP/FP/FN on every plan and class): Golden tables AP50 0.999 / AP 0.625,
  chairs AP50 0.687 / AP 0.236; ORNEK tables AP50 1.000 / AP 0.631. At IoU 0.5
  and the product threshold Golden chairs are 82 TP / 31 FP / 31 FN, against
  104 / 9 / 9 by the benchmark's centre matching: v2 finds chairs in the right
  PLACE with the wrong box SIZE more often than the centre benchmark shows.
- **Dynamic INT8** (ORT and Olive give the same model behaviour): same table
  results on both plans, 161/162 and 166/166 detections agree with FP32, file
  3.5 MB → 0.94 MB, but **~8× slower** on one CPU thread (Golden 262 → 2 033 ms,
  ORNEK 307 → 2 521 ms). Not a speed win for this conv model; do not propose it
  as one.

## Common failure modes

| Symptom | Cause | What to do |
|---|---|---|
| `ValueError: libcublasLt.so.*[0-9] not found` on `import torch` | PyPI CUDA torch installed without its nvidia libraries | install the CPU wheel, or keep the nvidia libs |
| `download.pytorch.org` refused / 403 | network policy | `setup.sh --with-olive` exits 2 with the reason; use `--engine ort` |
| `import olive` → `No module named 'torch'` | Olive 0.13.0 imports torch at module level | `--with-olive`, or `--engine ort` (same job, torch-free) |
| `FiftyOneConfigError: MongoDB could not be installed` | mongod download refused | pycocotools + FiftyOne matcher still run; or set `FIFTYONE_DATABASE_URI` |
| Outbound connections to `mobile.events.data.microsoft.com` | ORT / Olive telemetry | import `offline_env.py` first |
| AP looks capped on a dense plan | COCOeval's default `maxDets=100` | the example sets `[1, 10, 1000]`; keep it |
| A "better" candidate at a new threshold | threshold change, not model change | also report at the fixed 0.5 |
| Training ~3× slower than expected | a browser benchmark running at the same time | run one at a time |
| Inspector: LEAKAGE train/heldout same split unit | a family or venue on both sides | move it out of training, or stop calling that set unseen |

## Who does what

- **ai-engineer** (`.claude/agents/ai-engineer.md`) runs steps 1–6 and hands over.
- **model-qa-specialist** (`.claude/agents/model-qa-specialist.md`) audits
  independently and gives the verdict; it never trains or tunes.
- **computer-vision-engineer** owns detector design and the classical pipeline;
  **active-learning-engineer** owns Teach / captured examples / dataset versions.
  This skill does not replace either.
