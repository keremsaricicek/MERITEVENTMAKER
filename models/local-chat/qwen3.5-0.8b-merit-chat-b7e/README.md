# Merit F8 reading LoRA, run B7e — for Qwen3.5-0.8B (llama.cpp adapter)

`adapter.gguf` (21,243,648 bytes, sha256
`1b37ca8aa79a5c0805038695439b299fa8ce0857e59f4c2b57e13f98a40459bd`) turns an
operator's sentence into the F8 assistant's reading JSON (`src/assistant-reading.js`,
short prompt). Trained in this repository (`training/vlm_lora.py`, 2026-11-01,
init runB7d) on generated Turkish sentences (`training/synth_f8.mjs --grammar 5`,
careless typing included) with a replay of plan briefs. No guest data; useless
without its base model (the same Qwen3.5-0.8B-Q8_0.gguf as the plan model).

Measured as the product works (`training/README.md`, "Grounding" verdict;
`--order product`, the reading grounded in the sentence and the guest list):
fresh7 0.917 right, typo7 0.792 right, 0 wrong changes on every set — better than
B7c (0.875 / 0.583) on the same unseen tests. Its own pre-registered bars (runB7e)
were NOT passed, and typo7 is below the owner's 0.85; it ships because the owner
asked for the best measured model (2026-11-02). Anything not sure and grounded is
shown first and waits for Onayla. About 3–4 s a sentence on a 4-core CPU.
