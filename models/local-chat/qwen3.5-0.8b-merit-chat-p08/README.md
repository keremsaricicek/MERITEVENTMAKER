# Merit F8 reading LoRA, run P (identical-history equalisation, runP-08-g2) — Turkish + English, for Qwen3.5-0.8B (llama.cpp adapter)

`adapter.gguf` (21,243,648 bytes, sha256 `21b2f56a1bc4e1f267c0e5481c83a82d895585c310e3dcd63658ab50cfaf9b56`)
turns an operator's Turkish or English sentence into the F8 assistant's reading JSON (`src/assistant-reading.js`,
short prompt). Trained here (`training/vlm_lora.py`, 2026-11-02, init runB7e) on generated sentences
(`training/synth_f8.mjs --grammar 6`: Turkish grammar 5 + English, careless typing in both) with a replay of plan
briefs. No guest data; useless without its base model (the same Qwen3.5-0.8B-Q8_0.gguf as the plan model).

Measured as the product works (`training/README.md`, "runB7f verdict"; product rule with grounding), unseen sets:
fresh8 0.957, typo8 0.870, en8 1.000, entypo8 0.950, 0 wrong changes on every set; briefs 0.976 / 0.90 / 0.009.
Shipped as the better of B7e and B7f on the decisive sets (owner's rule). About 4–5 s a sentence on 4 cores.
