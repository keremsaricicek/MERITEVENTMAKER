# Merit F8 reading LoRA, run B7c — for Qwen3.5-0.8B (llama.cpp adapter)

`adapter.gguf` (21,243,648 bytes, sha256
`4c35ac468a4519a5998e7a7a956dcde381ccd555f4d03b51cf4ece0bd38a1d85`) turns an
operator's Turkish sentence into the F8 assistant's reading JSON
(`src/assistant-reading.js`, short prompt). Trained in this repository
(`training/vlm_lora.py`, 2026-10-31) on generated sentences
(`training/synth_f8.mjs --grammar 3`) with a replay of plan briefs. It holds no
guest data and is useless without its base model (not in this repository; the
same Qwen3.5-0.8B-Q8_0.gguf as the plan model).

Measured (`training/README.md`, "runB7c verdict"): its pre-registered bars were
NOT passed (fresh3 0.816 right, 2 wrong changes with rules first). It ships
because the owner chose it on 2026-11-01 behind ask-when-unsure: a reading is
carried out by itself only when the rules read the same change or the model's
confidence is at least 0.91 (`serve.actAt`); otherwise the panel shows what it
would do and asks. At 0.91 no wrong change was carried out on fresh3. About 3 s
a sentence on a 4-core CPU.
