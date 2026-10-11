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

## The 403, diagnosed (2026-10-11, second pass)

The question was whether the refusal comes from the model repository (a gated
repo, a licence click-through), a redirect to a file server, authentication,
or the network. Each host was asked once, and the session's egress proxy
records why it refused (`/__agentproxy/status`, `recentRelayFailures`):

| Host | What answered | Meaning |
|---|---|---|
| `huggingface.co` | the egress gateway: `403` to **CONNECT** | refused before TLS: no request ever reached Hugging Face |
| `cdn-lfs.hf.co`, `cdn-lfs.huggingface.co` | gateway `403` to CONNECT | the LFS file servers `/resolve/` redirects to are refused the same way |
| `cas-bridge.xethub.hf.co` | gateway `403` to CONNECT | the Xet storage bridge newer repositories redirect to, refused the same way |
| `registry.ollama.ai`, `ollama.com`, `www.kaggle.com`, `modelscope.cn`, `dl.fbaipublicfiles.com` | no connection (refused at the gateway) | no alternative model host is reachable either |
| `github.com`, `objects.githubusercontent.com` | GitHub itself answered (`400`/`404` to a bare HEAD) | reachable — but no candidate's authors publish weights there |
| `registry.npmjs.org`, `pypi.org` | `200` | reachable — package registries; no candidate's authors publish weights there |

So it is **the network policy of this cloud session** — an allow-list at the
egress gateway — not the repository, not a redirect target alone, and not
authentication: a `CONNECT` refused at the gateway never reaches the server
that would check a token or a licence acceptance. Nothing in the product or
the repository can change that, and routing around it (a mirror of unknown
provenance, a re-upload on npm or PyPI) would mean running weights nobody can
verify, which this product refuses.

**The one environment change that unblocks it** (read-only download access):

- `huggingface.co`
- `cdn-lfs.hf.co`
- `cas-bridge.xethub.hf.co`

On a desktop machine with ordinary internet none of this applies: the files are
downloaded once by a developer, their sha256 pinned in the repository the way
`src/plan-model.js` pins the local detector, and shipped inside the package.
The end user never downloads a model.

## What is ready for the day a model is allowed (2026-10-11)

The provider side is built and tested, so the only missing piece is the files:

- `server/vlm-local.mjs` — a local model process behind the same relay, same
  instruction, same answer schema, same checks, same Accept-by-a-person flow.
  Loopback only; every model file pinned by size and sha256 in a manifest that
  also states the licence and the source; a request cap but no key and no
  charge. See `server/README.md`.
- `tests/suites/vlm-local.test.mjs` — 17 checks against a scripted local
  process: configuration refusals (off-machine URL, no manifest, missing or
  changed file, path escape, no licence), the request carries the cloud
  request's content unchanged, findings go through the same validation, the day
  cap refuses before the process is called, each failure's code (not running,
  cut-off, malformed, failing, cancelled in flight), and the page's wording
  ("on this computer", the model's name and licence, no price). Mutation-
  checked: removing the loopback or the sha256 check turns it red.

What is still **NOT MEASURED**: any model's accuracy, CPU time, memory and
start-up on plan crops — for Florence-2, SmolVLM or any other candidate. Two
candidates cannot be compared until their files can be fetched (below).

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
