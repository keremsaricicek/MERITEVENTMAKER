# Merit plan LoRA, run A — for Qwen3.5-0.8B (llama.cpp adapter)

`adapter.gguf` (21,243,648 bytes, sha256
`f5a0344aee305f1f5dc22f4832b781eb3829cddecbe927953eb154289399d9aa`) is a LoRA
adapter for Qwen3.5-0.8B, trained in this repository (`training/vlm_lora.py`,
2026-10-18) on 2,587 crops cut from GENERATED plans in the training style
families only. It holds no plan, no guest and no image. It is useless without
its base model, which is NOT in this repository (a developer-time download).

What it is measured to answer, and nothing else: **merged** — do the tables at
the centre of a crop touch to form one long table. It passed the V4 final test
and the supplementary test S1 on blind generated plans (40 / 40 on S1, no
near-miss pair of separate tables called one unit). It FAILED identify on real
plans, chair counts (it answers even numbers only) and serves (it calls almost
every bench or banquette serving). Those questions are not in its manifest and
the relay will not ask them. Full record:
`benchmarks/offline-intelligence/LOCAL-VLM.md`, `training/README.md` (V4, S1).

## Running it (developer machine)

1. Fetch from https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF:
   `Qwen3.5-0.8B-Q8_0.gguf` and `mmproj-F16.gguf`.
2. Quantize the projector with the pinned llama.cpp (11351, 0fa5950):
   `llama-quantize mmproj-F16.gguf mmproj-Qwen3.5-0.8B-Q8_0-local.gguf Q8_0`.
3. Put the model, the Q8_0 projector, this `adapter.gguf` and
   `tools/local-vlm/manifests/qwen3.5-0.8b-merit-a.json` in ONE directory; the
   manifest pins all three by size and sha256.
4. Start the measured server on THOSE files:

```
llama-server -m DIR/Qwen3.5-0.8B-Q8_0.gguf --mmproj DIR/mmproj-Qwen3.5-0.8B-Q8_0-local.gguf \
  --lora DIR/adapter.gguf -c 2048 -t 4 -np 1 --cache-ram 0 --host 127.0.0.1 --port 8080
VLM_PROVIDER=local VLM_LOCAL_URL=http://127.0.0.1:8080 \
VLM_LOCAL_MANIFEST=DIR/qwen3.5-0.8b-merit-a.json npm run serve:vlm
```

The relay asks the running server what it loaded before every question and
refuses unless it is these files at this context (`server/README.md`).
`--cache-ram 0` keeps the server near 1.2 GB; without it this llama.cpp build
caches up to 8 GiB of prompts it never reuses.
