# Merit plan LoRA, run B6b (V6) — for Qwen3.5-0.8B (llama.cpp adapter)

`adapter.gguf` (21,243,648 bytes, sha256
`2980ab5e66cfefebd67d6c5b43adef6f84f30d66070d57f1bd53a0d7ac7a457b`) is a LoRA
adapter for Qwen3.5-0.8B, trained in this repository (`training/vlm_lora.py`,
2026-10-25) from run B: the V6 scenes composed from the TRAINING part (x < 0.6 of
the width) of the two real plans' own symbols, plus a replay of 2,400 V5
training crops. It holds no plan, no guest and no image. It is useless without
its base model, which is NOT in this repository (same files as run A and B).

What it is measured to answer, and nothing else: **merged** — do the tables at
the centre of a crop touch to form one long table. Fresh V5 test 79 / 80 ("yes"
on 1 of 40 separate pairs), S1 40 / 40 (no near-miss pair called one unit), and
on the held-out right 40 % of the two real plans 41 / 44 with "yes" on 1 of 38
separate pairs (run B: 39 / 44, 2 of 38). It also identifies real symbols well
(0.97 on the real test) but FAILED identify on the fresh V5 test (bench 10 / 15),
and fails chair counts and serves; those questions are not in its manifest and
the relay will not ask them. Full record: `training/README.md` ("runB6b
verdict" and the owner's one-model decision).

Run it exactly like run A (`../qwen3.5-0.8b-merit-a/README.md`), with this
`adapter.gguf` and `tools/local-vlm/manifests/qwen3.5-0.8b-merit-b6b.json`.
