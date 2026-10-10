# Tools for plan understanding: what was checked, what was chosen, and why

Checked 2026-10-10 against the projects' official pages, model cards and
licence files. Hardware here: 4 CPU cores, 15 GB RAM, **no GPU**. The product
target is the same: an ordinary operator laptop, offline-capable, with
nothing for the end user to install.

The rule for choosing: take the smallest option that measurably closes a gap
on real plans. Score it on accuracy, false suggestions, time, memory and cost.
A tool that is not measured here is not called better, whatever its paper
says.

| id | candidate | licence (verified) | weight / runtime | state | decision and evidence |
|---|---|---|---|---|---|
| T1 | SAHI-style sliced inference | MIT (arXiv 2202.06934) | none (a procedure) | **1 · DONE for the model reading; 3 · REJECTED for the detector on today's plans** | Model reading: `MeritVlmReview.tilePlan` cuts overlapping native tiles only when the overview would shrink the smallest object below 12 px. It records what it inspected (`vlm-reading`, `vlm-decisions`). Detector: giving it more pixels per object did not help. ORNEK at native 2402 px scored F1 0.967 against 0.985 at the 1920 cap, and precision fell (`benchmarks/resolution`). Revisit when a real plan has symbols under 12 px at the cap (N1). |
| T2 | RF-DETR (fine-tuned symbol detector) | Nano/Small/Medium **Apache-2.0**; XL is **PML 1.0** (not usable) | Nano ~30 M params; ONNX export exists | **2 · BLOCKED** | Fine-tuning needs labelled plans from several venues (one venue trains a memoriser), and practically needs a GPU. Neither exists here: two real venues are labelled and the container has no GPU. The data foundation is ready: decisions are captured as training examples with crops, and splits are grouped by plan (`benchmarks/TRAINING-DATA.md`). Unblocks with N1 plus a GPU session. Until then, "DOMAIN MODEL NOT INSTALLED" stays true. |
| T3 | PP-OCRv5 mobile vs the PP-OCRv4 in use | Apache-2.0 (`pdfmarkdown-ppocrv5-models@1.0.0`, integrity checked) | det `.ort` + rec `.onnx`, same onnxruntime-web 1.30.0 | **3 · REJECTED BY EXPERIMENT** | `benchmarks/ocr/compare-ppocr.mjs`, same app and code path through a benchmark-only override. ORNEK numbers: v4 145 right / 0 wrong / 12 unread, v5 120 / 0 / 37 — v5 reads the circles around numbers as "$". Golden: identical 9/9 words. Same time. v4 stays. |
| T4 | ONNX Runtime WebGPU / worker | MIT | already pinned (1.30.0, WASM) | **3 · REJECTED for now** | No bottleneck is measured that it would remove. Detection on ORNEK is ~60 s, but that time is in the classical stages, not ONNX inference. The OCR model runs in WASM already. WebGPU is unavailable in this headless Chromium and on many operator laptops, so it would be an optional path that needs a fallback. Revisit if T2 lands, since a neural detector is where GPU inference pays. |
| T5 | PDF.js vector geometry | Apache-2.0 (pdfjs-dist 5.7.284, pinned) | already in the app | **1 · DONE (extraction) / 2 · BLOCKED (use as detection)** | `MeritPdfText.vectorShapes` follows save/restore/cm and the clip in raster pixels. It yields rectangles with their rotation, circles, ellipses, polygons and lines, and classes a page RASTER / VECTOR / MIXED (`pdf-text-layer`, synthetic PDF, mutation-checked). Turning shapes into tables needs a real CAD PDF to measure against. ORNEK.pdf is a scan. Blocked on N1. |
| T6 | CVAT / FiftyOne for labelling and error review | CVAT MIT; FiftyOne Apache-2.0 | server / Python app (developer side only) | **2 · BLOCKED** | Useful when labelling the 5–10 new venues (N1), not before. The annotation format in `benchmarks/annotations/` is plain JSON with object-level ids and is easy to export to COCO for CVAT. Nothing is installed for the end user. |
| T7 | LightGlue (or simpler) for plan-to-plan alignment | LightGlue weights Apache-2.0; **SuperPoint is non-commercial**, so DISK (Apache-2.0) or ALIKED (BSD-3) would be the extractor | ~50 MB + extractor | **OPEN — simpler method first** | Plan memory measures identity precision **1.0** and wrong application **0**. Retention is **0.7363**, below the 0.98 target, on seven transforms of one venue (`benchmarks/memory/README.md`). The losses are on perspective and heavy distortion. Before a learned matcher, the order is: check whether a RANSAC homography over the existing matched tables recovers them, then measure. Not done in this pass. |
| T8 | Qwen3-VL as a local VLM | 2B/4B **Apache-2.0** | 2B ≈ 1.9 GB quantised; needs a GPU or a slow CPU path | **3 · REJECTED for the browser product** | 1.9 GB of weights in a browser-only, localStorage app is not shippable. CPU inference of a 2B vision model on a 4-core machine takes minutes per plan. The hosted model reading (relay, key in the server environment, a person starts every send) covers the need. Its quality is unmeasured until the pilot (V3). Revisit only for the desktop build (gated on "EXE YAP"). |
| T9 | GroundingDINO / SAM 2.1 | Apache-2.0 both | SAM2.1-tiny 110 MB encoder + 17 MB decoder; SlimSAM 14 MB INT8 | **2 · BLOCKED** | Segmentation would sharpen object outlines, which the detector already reports with rotation. Open-vocabulary detection would find symbols nobody has a class for. Neither can be scored without labelled outlines from more venues (N1). |

## What the agents and skills now say

- `computer-vision-engineer`: classical Assisted Detection stays the engine
  until T2's data exists. No trained model is claimed.
- The model reading is a hosted VLM behind the relay. A fake model's green
  result is never reported as model quality (`.claude/rules/ai.md`).
- `benchmarks/resolution` is the first thing to re-run when a new venue
  arrives. It decides whether T1 is needed on the detector.
