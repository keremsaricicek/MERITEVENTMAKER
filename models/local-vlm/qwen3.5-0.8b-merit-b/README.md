# Merit plan LoRA, run B (V5) — for Qwen3.5-0.8B (llama.cpp adapter)

`adapter.gguf` (21,243,648 bytes, sha256
`62f7599ef845c2cb5b9354b18b0d843bf6b08e9e5a1b3fd9d7de66e37e5355e8`) is a LoRA
adapter for Qwen3.5-0.8B, trained in this repository (`training/vlm_lora.py`,
2026-10-24) on 5,869 crops drawn from GENERATED plans in the training style
families only (`training/synth_vlm.py` generation 5, plus run A's own training
crops for identify, empty, count and merged). It holds no plan, no guest and
no image. It is useless without its base model, which is NOT in this
repository (a developer-time download, same files as run A).

What it is measured to answer, and nothing else: **merged** — do the tables at
the centre of a crop touch to form one long table. It passed the V5 test
(80 / 80, no separate pair called one unit), S1 (40 / 40, no near-miss pair
called one unit), the V4-style rebuilt set, and on the held-out right 40 % of
the two real plans 39 / 44 with "yes" on 2 of 38 separate pairs. It FAILED
chair counts (0 of 20 on real plans), serves ("yes" on 31 % of pieces that do
not serve) and identify on real chairs (0.60). Those questions are not in its
manifest and the relay will not ask them. Full record: `training/README.md`
("V5 results").

Run it exactly like run A (`../qwen3.5-0.8b-merit-a/README.md`), with this
`adapter.gguf` and `tools/local-vlm/manifests/qwen3.5-0.8b-merit-b.json`.
