# Model development tools — setup record (2026-10-12)

Developer-time only. Nothing here is loaded by `index.html`, `src/` or either
offline package, and nothing here is asked of an end user. Zero spend: no paid
API, no Hugging Face Jobs, no GPU, no paid Codespaces, nothing uploaded.

## What was installed

| Path | What |
|---|---|
| `tools/model-dev/setup.sh` | creates `.venv-model-dev/` (git-ignored, 1.2 GB) from the lock; `--with-olive` adds CPU torch |
| `tools/model-dev/requirements.in` / `requirements.lock.txt` | inputs / exact pins (`uv pip compile`, Python 3.11) |
| `tools/model-dev/check.py` | imports every tool, prints versions; non-zero exit on a failure |
| `tools/model-dev/examples/offline_env.py` | the telemetry switches, imported first by every script |
| `tools/model-dev/examples/detector_io.py` | pinned-model loader (size + sha256), NumPy pre/post-processing mirroring `training/detector.py` |
| `tools/model-dev/examples/quantize_detector.py` | INT8 with ONNX Runtime or Olive, scored on Golden + ORNEK, latency, agreement |
| `tools/model-dev/examples/eval_detector_coco.py` | COCO box metrics: pycocotools, FiftyOne matcher, FiftyOne dataset (when MongoDB exists) |
| `.claude/skills/merit-local-vision-training/` | adapted skill + `scripts/inspect_dataset.py` + upstream `LICENSE.txt` |
| `.claude/agents/ai-engineer.md`, `model-qa-specialist.md` | adapted agents (train / audit, kept separate) + `LICENSE.agency-agents.txt` |

Outputs go to `tools/model-dev/out/` and training runs to `runs/` (both git-ignored).

## Sources

| Source | Commit | Licence | Used as |
|---|---|---|---|
| https://github.com/huggingface/skills `skills/huggingface-vision-trainer` | `c3ff942be3e07116b475253f0a8fc4f54682c1a8` | Apache-2.0 | adapted skill (Jobs/Hub/Trackio/cost removed; no upstream script copied) |
| https://github.com/msitarzewski/agency-agents `engineering/engineering-ai-engineer.md`, `specialized/specialized-model-qa.md` | `f99f6aa910a442b0197b768ce0ea7751e35e2060` | MIT (c) 2025 AgentLand Contributors | two adapted agents; every other role ignored |

## Pinned tools (licence from each package's own metadata)

| Package | Version | Licence |
|---|---|---|
| onnxruntime | 1.31.0 | MIT |
| onnx | 1.23.2 | Apache-2.0 |
| olive-ai (Microsoft Olive) | 0.13.0 | MIT |
| fiftyone / fiftyone-brain / fiftyone-db | 1.22.1 / 0.25.0 / 1.4.1 | Apache-2.0 |
| pycocotools | 2.0.11 | FreeBSD |
| onnxscript / onnx-ir | 0.7.2 / 1.0.0 | MIT / Apache-2.0 |
| numpy / pillow | 2.4.6 / 12.3.0 | BSD-3-Clause (+ bundled) / MIT-CMU |
| torch (only for Olive, `--with-olive`) | 2.14.1 | BSD-3-Clause and others |
| torchmetrics / lightning-utilities (Olive imports them) | 1.9.0 / 0.15.2 | Apache-2.0 |

## Verification (run here, 2026-10-12, 4 cores, no GPU)

| Check | Result |
|---|---|
| `setup.sh` + `check.py` | **pass**: onnx, onnxruntime, fiftyone, pycocotools, numpy, PIL import; CPU provider present |
| `quantize_detector.py --engine ort` | **pass**: pinned v2 verified by sha256; INT8 keeps Golden tables 44/1/2, ORNEK 166/0/0; 161/162 and 166/166 detections agree with FP32; 3.5 MB → 0.94 MB; **~8× slower** (Golden 262 → 2 033 ms, ORNEK 307 → 2 521 ms, 1 thread) — not a speed win |
| `quantize_detector.py --engine olive` | **pass only with torch present**: same numbers as ORT. Olive 0.13.0 imports torch at module level, so without torch `import olive` fails |
| `setup.sh --with-olive` | **blocked here**: download.pytorch.org answers 403; exits 2 with the reason. Verified instead with this container's existing torch on `PYTHONPATH` (not committed). Elsewhere: run it where the CPU index is reachable |
| `eval_detector_coco.py` | **pass**: Golden tables AP50 0.999 / AP 0.625, chairs AP50 0.687 / AP 0.236; ORNEK tables AP50 1.000 / AP 0.631; pycocotools and the FiftyOne matcher give the SAME TP/FP/FN on every plan and class |
| FiftyOne dataset / App / `evaluate_detections` | **blocked here**: needs MongoDB; fiftyone-db downloads mongod from fastdl.mongodb.org, which answers 403 (`FiftyOneConfigError`). Free path that works: pycocotools + the FiftyOne matcher; or `FIFTYONE_DATABASE_URI` to a MongoDB you run |
| `inspect_dataset.py` | **pass**: clean split READY; val-as-heldout → 4 LEAKAGE; Golden trained and scored as unseen → 3 LEAKAGE; a broken plan → 5 problems |
| Training smoke run (`synth.py` → `detector.py train` 30 steps → eval → export) | **pass**: 7 s training, ONNX 3 540 361 bytes, zero detections (expected; plumbing only) |
| Outbound network during all of the above | **0 attempts** with `offline_env.py`. Without it: onnxruntime 3, Olive 8 attempts to mobile.events.data.microsoft.com (all refused by the proxy, nothing sent). `OLIVE_DISABLE_TELEMETRY=1` alone did NOT stop Olive; `onnxruntime.disable_telemetry_events()` did NOT stop ORT |
| Skill recognised | **yes** in this session (listed and loaded via the Skill tool) |
| Agents recognised | **not in this session** (`Agent type 'model-qa-specialist' not found`): agents are read when a session starts. Frontmatter parses like the existing agents. Open a new session on `claude/merit-concept3-plan-intelligence-rebirth` to use them |

## Not solved by this setup

- **Local VLM model files**: still 403 at the egress gateway
  (`benchmarks/offline-intelligence/LOCAL-VLM.md`). Nothing here bypasses it.
- **D-FINE / RT-DETR / DETR / YOLOS / timm / SAM**: weights are on the HF Hub
  (403); not supported, not claimed.
- **GPU**: none; every number is CPU.

A 1.2 GB scratch probe environment from this setup, outside the repository,
could not be deleted from this session (the delete was refused); it is not part
of the setup and goes with the container.
