# V5 pipeline — resumable from a reset machine

The V5 programme (pre-registration: `training/README.md`, 2026-10-24) runs for
days on a 4-core CPU. Nothing in it depends on one machine surviving:

| what | where it survives |
|---|---|
| code, pre-registration, frozen-test hashes, results | this branch (PR #5) |
| training data, V5 test, V4-style and S1 sets | regenerated from their seeds, byte for byte (hashes in `training/README.md`) |
| models | Hugging Face, pinned by repository revision and sha256 (`pipeline.sh`) |
| training progress (adapter + optimizer + schedule + items seen, every 25 steps) and benchmark rows | branch `claude/v5-train-state`, pushed every 2 hours (owner's permission, 2026-10-24); never merged |

On a fresh machine:

```
S=/path/to/scratch tools/local-vlm/v5/pipeline.sh
```

It installs the tools, downloads and checks the models, regenerates the data,
restores the newest checkpoint from `claude/v5-train-state`, and runs the
chain. Every step is skipped when its output exists; training resumes at the
checkpoint's item (`vlm_lora.py train` reads `RUN/resume`), and every benchmark
resumes from its `.partial.jsonl` (`local-vlm-bench2.py --resume`). At most the
work since the last push (≤ 2 hours) is repeated.

Order of the chain (V6 added 2026-10-24): train 0.8B (V5) -> V5 test, real held-out test, V5 base, run A, S1, V4-style, dev -> 0.8B V6 (continues V5 adapter) -> real, V5, S1, dev -> 2B probe -> 2B V5 -> V5, base, S1, dev, real -> 2B V6 -> real, V5, S1, dev.
