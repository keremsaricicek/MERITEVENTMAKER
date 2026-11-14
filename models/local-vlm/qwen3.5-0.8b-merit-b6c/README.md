# Merit plan LoRA, run B6c (V6) — for Qwen3.5-0.8B (llama.cpp adapter)

`adapter.gguf` (21,243,648 bytes, sha256
`fd8d72d5728e018bbcf2b9a417a4921c25e8130d22643745e80a825f4153f9d2`) is a LoRA
adapter for Qwen3.5-0.8B, trained in this repository (`training/vlm_lora.py`,
2026-10-27/28) from run B6b: scenes from the TRAINING part of the two real plans
with half the chairs tucked under their tables, more serves, the V5 training
families (new seeds) and 1,500 generated Turkish event briefs. It holds no plan,
no guest and no image, and is useless without its base model (not in this
repository; same files as runs A, B and B6b).

What it is measured to answer, and nothing else: **merged** — do the tables at
the centre of a crop touch to form one long table. Fresh V5 test blind4 79 / 80
("yes" on 1 of 40 separate pairs), S1 40 / 40, the held-out right 40 % of the two
real plans 42 / 44 with "yes" on 2 of 38 separate pairs (only one look each) and NO answer where both
looks agree and are wrong (0 / 44) — so it also applies merged by itself
(`autoApply`, the stricter bar). It recognises tucked chairs far better than B6b
(0.96 vs 0.76 on the tucked test) and passes identify on blind4, but fails
identify on the real test by one empty crop (2 / 32 called something, bar ≤ 0.05),
and fails chair counts and serves on blind4; those are not in its manifest.
Full record: `training/README.md` ("runB6c verdict").

Run it exactly like run A (`../qwen3.5-0.8b-merit-a/README.md`), with this
`adapter.gguf` and `tools/local-vlm/manifests/qwen3.5-0.8b-merit-b6c.json`.
