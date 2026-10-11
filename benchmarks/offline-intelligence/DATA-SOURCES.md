# Training and evaluation data: sources, licences, what was tried

Recorded 2026-10-11. This is a log of what was searched and what was reachable.
It is not a promise that a source is usable.

## In use

| Set | Source | Licence / permission | Used for | Verification state |
|---|---|---|---|---|
| Golden Plan | `benchmarks/plans/merit-real-venue-plan.png`, supplied by the user | the user's own plan, internal use | regression; scored as an UNSEEN venue by the shipped model (v1 trained on no real plan); training data only in the cross-venue fold that is scored on ORNEK | tables and chairs: human-verified annotation (`benchmarks/annotations/merit-real-venue.json`). Columns, merged groups: **model-assisted** labels (`benchmarks/plan-reading/golden-structure.json`), never used as training targets |
| ORNEK | `benchmarks/plans/ORNEK.pdf`, supplied by the user | the user's own plan, internal use | regression; scored as an UNSEEN venue by the shipped model; training data only in the cross-venue fold that is scored on Golden | tables, numbers: human-verified (`benchmarks/annotations/ornek-symbolic.json`) |
| Synthetic banquet plans | `training/synth.py`, generated | generated here, no third-party content. Fonts: DejaVu / FreeFont, both redistributable. | auxiliary training; style-held-out evaluation | `synthetic-exact`: exact by construction, **not** a human judgement and **not** real-venue evidence |

## Searched, not used

| Candidate | What it is | Why not (today) |
|---|---|---|
| Banquet or seating-chart datasets | Searched the web for event seating plans with table and chair labels | None found with a stated permissive licence and banquet content. |
| Roboflow Universe "floorplan" / "chair" / "table" projects marked CC BY 4.0 | user-uploaded detection sets | Content is unverified: the pages do not say whether the images are banquet layouts. Downloading needs a Roboflow account and API key. Opening an account needs your approval. |
| FloorPlanCAD (ICCV 2021) | 10–15 k vector residential/commercial CAD plans, 30–35 symbol classes | Domain mismatch: these are residential/commercial plans, not event seating. Licence not confirmed from a primary source: the project page could not be fetched from here (DNS failure through the fetch tool). Hosting is outside the allowed network. |
| CubiCasa5k | 5 000 residential floor plans | Residential, no banquet furniture. Licence not confirmed from a primary source here (believed non-commercial). |
| ArchCAD-400K | large architectural CAD set | Licence not found. Domain: architecture, not seating. |

Residential and architectural sets would teach walls, doors and beds. A detector
scored well on them would say nothing about round tables of twelve and
banquette rows, so a high number from them would mislead.

## Network facts that shaped this (measured 2026-10-11)

| Host | Result |
|---|---|
| pypi.org, files.pythonhosted.org, registry.npmjs.org | reachable (package registries are allowed) |
| huggingface.co, hf-mirror.com, modelscope.cn | `403` on CONNECT from the egress proxy |
| cdn.jsdelivr.net, download.pytorch.org, cdn.sheetjs.com | `403` on CONNECT |
| api.github.com (outside this session's repository scope) | `403` |

Consequences:

- PyTorch was installed from PyPI with its CUDA libraries. It runs on CPU and
  needs no GPU.
- No pretrained weights could be fetched from Hugging Face or the PyTorch CDN,
  so the detector is trained from scratch.
- No vision-language model weights are reachable from here (see
  `LOCAL-VLM.md`).

## What would change the picture

Real plans from venues not yet seen, even 5–10 of them, labelled in the
repository's annotation format. They are the only thing that turns
"cross-venue on two venues" into a real blind measurement. The procedure is
in `benchmarks/heldout/THIRD-PLAN-PROCEDURE.md`.
