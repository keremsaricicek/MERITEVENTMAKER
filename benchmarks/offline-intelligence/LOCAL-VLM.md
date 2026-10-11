# A local vision-language model: candidates, what was tried, what blocks it

Recorded 2026-10-11. Approach 3 of the comparison is "a small local vision
model helps on uncertain regions or with the overall reading". This file says
honestly how far that got.

## Candidates

The licences below are from the model pages and the web search results of
2026-10-11. The pages themselves could not be opened from this environment.

| Model | Size | Licence (as listed) | Runtime path for this product | Why it is a candidate |
|---|---|---|---|---|
| Florence-2-base (`onnx-community/Florence-2-base`, `-ft`) | ~0.23 B | MIT | ONNX, Transformers.js tags; q4f16 weights exist. Runs on the same onnxruntime-web the app ships. | OCR with regions, region captioning and grounding in one small model. CPU-feasible size. |
| SmolVLM-256M-Instruct | 0.26 B | Apache-2.0 | ONNX exports by the authors; browser demos (WebGPU) | The smallest general VLM. It can answer a question about a crop. |
| Qwen3-VL-2B | ~2 B | Apache-2.0 (per `benchmarks/plan-understanding/TOOLS.md` T8) | GGUF / a native process | Far stronger reasoning, but ~1.9 GB quantised and minutes per plan on 4 CPU cores. Only plausible as a separate local process in the desktop build. |

## What blocks a measurement here

Every weight file lives on Hugging Face, and this environment's egress policy
refuses it:

| Attempt | Result |
|---|---|
| `huggingface.co` | proxy answers `403` to CONNECT |
| `hf-mirror.com` | `403` |
| `www.modelscope.cn` | `403` |
| `cdn.jsdelivr.net` (not a model host, checked for completeness) | `403` |
| npm packages that mention Florence-2 / SmolVLM | wrappers that download from Hugging Face at run time. They ship no weights, and repackaged weights of unknown provenance would not be acceptable anyway. |

So CPU time, RAM, start-up time and output accuracy on plan crops are **NOT
MEASURED** for every candidate above. No number is given for them here.

## What was done instead (the same function, locally)

The function approach 3 is for is "look again at uncertain places, and find
what the first pass missed". It is provided today by two local components,
both measured in this directory:

1. The **local plan-symbol detector** (`src/plan-model.js`, `training/`).
   It is an independent second look at the whole plan, not limited to the
   classical candidates, so it can find objects nobody proposed.
2. **Exemplar search** from objects a person confirmed. It finds more of the
   same symbol on the same plan (see `README.md` in this directory once
   measured).

Neither one is a VLM. Neither can read a free-text note
("this area is for sponsors"). That gap stays open and is stated as such.

## What would unblock it

One of these, then the measurement script in this directory is run as is:

- Allow `huggingface.co` (read-only) in the environment's network policy; or
- Provide the weight files, with their published checksums, in the repository
  or a release asset.

Integration design, ready for that day:

- Load on demand only when uncertain regions exist, never at start-up.
- Run on crops of uncertain regions only, never once per object.
- Cache answers by crop hash.
- Treat a VLM box as a hint to be snapped to image or vector evidence, never
  as a measurement.
- A printed table number is never taken from it.
