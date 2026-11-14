# Merit F8 reading LoRA, run R2 — Turkish + English, for Qwen3.5-0.8B (llama.cpp adapter)

`adapter.gguf` (21,243,648 bytes, sha256 `a15680671e9d13dc55c2aa70d83678765caa7730c404b06676683e0e81f4128d`) turns an operator's Turkish or English sentence into the F8
assistant's reading JSON (`src/assistant-reading.js`, short prompt). Trained here (`training/vlm_lora.py`,
2026-11-14, init q08) on generated sentences (data-g10: English for every kind of input, with the Turkish sets
replayed) and plan-brief replay. No guest data; useless without its base model (Qwen3.5-0.8B-Q8_0.gguf).

Measured as the product works (`training/README.md`, "runR2 verdict"), new blind English sets en12 / entypo12 /
enslang12 / enmulti12 / enascii12: 1.000 / 0.95 / 0.95 / 0.90 / 0.95 (q08: 0.70 / 0.55 / 0.70 / 0.80 / 0.45);
every Turkish set equal to q08; 0 wrong changes on every set. Shipped by the owner's override rule (one
pre-registered bar, enmulti12 ≥ 0.95, and Turkish briefs all-right ≥ 0.975 (0.95) not met). q08 kept for rollback.
