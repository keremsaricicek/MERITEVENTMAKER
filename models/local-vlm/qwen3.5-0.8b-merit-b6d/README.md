# Merit plan LoRA, run B6d (V6) — for Qwen3.5-0.8B (llama.cpp adapter)

`adapter.gguf` (21,243,648 bytes, sha256
`643d42fab763b2adee491e9f14e19dd3fc2a30d73687082c445abf15414b882e`) is a LoRA
adapter for Qwen3.5-0.8B, trained in this repository (`training/vlm_lora.py`,
2026-10-28) from run B6c with many more empty crops (plain paper, a printed word,
or a real table or chair cut off by the crop's edge) from the TRAINING part of the
two real plans, half-tucked chairs and a replay of B6c's and V5's data. It holds no
plan, no guest and no image, and is useless without its base model (not in this
repository; same files as runs A, B, B6b and B6c).

What it is measured to answer, and nothing else: **merged** — fresh V5 test blind4
79 / 80, S1 40 / 40, the held-out right 40 % of the two real plans 41 / 44 with no
answer where both looks agree and are wrong (0 / 44); it also applies merged by
itself (`autoApply`). It identifies real symbols best of every run (0.986 on the
real test, 1 of 32 empty crops called something; blind4 0.98, empty 0 / 40; tucked
chairs 77 / 77) but FAILS identify on the fresh tucked test's empty crops (4 / 48 on
the first look, all Golden-plan paper; bar 0.05), so identify is not in its
manifest; chairs and serves fail too. Its Turkish brief reading passes (0.982
fields right, 0.009 invented). Full record: `training/README.md` ("runB6d verdict").

Run it exactly like run A (`../qwen3.5-0.8b-merit-a/README.md`), with this
`adapter.gguf` and `tools/local-vlm/manifests/qwen3.5-0.8b-merit-b6d.json`.
