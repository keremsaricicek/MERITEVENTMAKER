# A local vision-language model: candidates, what was tried, what blocks it

Recorded 2026-10-11, superseded in part on 2026-10-17/18. Approach 3 of the
comparison is "a small local vision model helps on uncertain regions or with
the overall reading". This file says honestly how far that got.

## 2026-10-17: the network block is gone — weights fetched, pinned, run

The 403 below (2026-10-11/12) is **history, not a current block**. On
2026-10-17 the environment's policy allowed Hugging Face, and access was
verified by fetching every file, not by a status probe:

| Model (all Apache-2.0, read off the model cards 2026-10-18) | Files | Bytes | Manifest |
|---|---|---|---|
| SmolVLM-256M-Instruct, GGUF Q8_0 (`ggml-org/SmolVLM-256M-Instruct-GGUF`) | model + mmproj | 175,054,528 + 103,769,856 | `tools/local-vlm/manifests/smolvlm-256m-q8.json` |
| SmolVLM-500M-Instruct, GGUF Q8_0 (`ggml-org/SmolVLM-500M-Instruct-GGUF`) | model + mmproj | 436,806,912 + 108,783,360 | `tools/local-vlm/manifests/smolvlm-500m-q8.json` |
| Qwen2-VL-2B-Instruct, GGUF Q4_K_M, projector Q8_0 (`ggml-org/Qwen2-VL-2B-Instruct-GGUF`) | model + mmproj | 986,046,944 + 709,883,360 | `tools/local-vlm/manifests/qwen2-vl-2b-q4km.json` |

Each manifest pins every file by size and sha256 in the `merit-local-vlm/1`
format `server/vlm-local.mjs` refuses to run without, and states its licence,
source and runtime. The runtime is llama.cpp's `llama-server` from conda-forge
(`llama.cpp 11351 cpu_mkl`, version 0.5.0-dev, commit `0fa5950`), CPU only,
`-ngl 0`. The weights are developer-time downloads kept OUT of the repository
(2.5 GB); the manifests are what is committed. No plan, guest record or image
of a customer's plan left the machine: every inference runs on loopback.

Florence-2 is not among them: its ONNX export runs in the page, not in
`llama-server`, and its task tokens (`<OD>`, `<OCR_WITH_REGION>`) are not the
question-and-answer interface the relay's local provider speaks. It stays a
candidate for the page itself, unmeasured.

What was measured, and what the pre-registered bar was, is in **Measured on
real inference** below. Everything from "Candidates" down to "What would
unblock it" is the 2026-10-11 record, kept as written.

## Second pass (2026-10-18, evening): a fair test first, then training

### The first harness was checked before any model was blamed on it

`local-vlm-bench.py` (the table below) was audited against its own output
before its verdicts were trusted. Three faults, each able to eliminate a model
for the test's sake:

- a crop reaching past the plan's edge was padded **black** (PIL fills an
  out-of-range crop with zeros, pasted over the white page) — a black band no
  plan has;
- `max_tokens` 12 with no control of a model's thinking mode: Qwen3.5 writes
  its whole answer into `reasoning_content` and returns an EMPTY answer, so
  every crop would have scored "unparsed";
- one image size for every model, below what Qwen-VL projectors ask for.

The image path itself is sound (a red circle, "HELLO 42" and a table with four
chairs are described correctly through `llama-server`). The second harness,
`local-vlm-bench2.py`, pads with paper, turns thinking off
(`chat_template_kwargs`), allows 48 answer tokens, and asks the questions a
plan reading needs, each with a closed answer and a known truth: **identify**
(what is at the centre, incl. "nothing"), **NEG** (the same on an empty crop —
fabrication), **count** (tables wholly in view), **chairs** (round tables of
1–12 chairs, standing alone), **merged** (pushed together vs. an aisle of ≥ 0.9
sides) and **serves** (a sofa/bench/banquette against its table vs. the
generator's "sofa-apart" negatives). Count and chairs are stratified (≤ 5 / ≤ 3
items per true value) so a constant answer cannot score; a "yes" on a true
negative counts as a fabrication. Questions live in
`server/local-check-questions.json`, the one file the benchmark, the training
set and the product's relay read.

Projector precision dominates CPU time: Qwen3.5's published F16 projector
encodes a 448 px crop in 15.5 s on 4 cores, the same projector quantized to
Q8_0 here with the pinned `llama-quantize` in 5.2 s (BF16: no faster).

### Zero-shot, on the fair test (dev: 60 items, seed 11, 448 px, 4 threads)

| Model (licence) | identify gen. / furniture / real | empty → fabricated | count | chairs exact (±1) | merged / serves | median / item | peak RSS |
|---|---|---|---|---|---|---|---|
| Qwen3.5-0.8B Q8_0 (Apache-2.0) | 0.17 / **0.00** / 0.17 | **1.00** | 1.00 | 0.43 (1.00) | 0.80 / 0.20 | 5.5 s | 3,626 MB |
| Qwen3.5-2B Q4_K_M (Apache-2.0) | 0.09 / 0.06 / 0.58 | 0.00 | 0.50 | 0.43 (0.43) | 0.60 / 0.20 | 17.0 s | 4,373 MB |
| Qwen3-VL-2B Q4_K_M (Apache-2.0) | 0.22 / 0.29 / 0.25 | 0.00 | 0.50 | **0.86** (0.86) | 0.60 / 0.20 | 16.0 s | 4,275 MB |

Timing caveat: the dev runs of the two 2 B models overlapped, for a few
minutes each, a training smoke test (Qwen3.5-2B) and a regression-suite run
(Qwen3-VL-2B) on the same 4 cores; their medians are upper bounds. The final
comparison below is timed on a quiet machine.

Small per-question counts (4–5 items on count, merged, serves, empty); the
point is the pattern, and the pattern holds across all three: **the models do
not know the drawing convention.** A sofa seen from above is "table" or
"nothing"; "serves" is answered "no" almost always (0.20 = the negatives).
Chair counting on a clear round table is the one zero-shot skill. The faults
the audit found were real but were not why these models fail — with them
fixed, the failure is knowledge, not settings.

## Measured on real inference (2026-10-18)

The bar was pre-registered before any inference
(`local-vlm-results/PREREG.md`). A candidate is USEFUL, and is wired into the
offline flow for uncertain regions only, if ALL of these hold at 4 threads:

| Condition | Threshold |
|---|---|
| generated furniture accuracy | ≥ 0.80 |
| real-plan accuracy | ≥ 0.80 |
| fabrication on empty crops | ≤ 0.05 |
| table over-count | ≤ 0.10 |
| median per crop | ≤ 10 s |
| peak server RSS | ≤ 3,000 MB |

Run: `local-vlm-bench.py`, 136 crops, seed 5, the same crops for every model,
on a quiet 4-core Linux container (not a Windows measurement), llama.cpp CPU,
`--temp 0`. Raw answers, per crop:
`local-vlm-results/bench-<model>-t4.json`.

| Model | furniture (36) | real plans (32) | fabrication (20 empty) | T2 exact / over-count (24) | median / p90 per crop | peak RSS |
|---|---|---|---|---|---|---|
| SmolVLM-256M Q8_0 | 0.028 | 0.031 | 0.00 * | 0.417 / 0.25 | 8.0 / 8.3 s | 1,088 MB |
| SmolVLM-500M Q8_0 | 0.000 | 0.250 | **1.00** | 0.000 / **0.917** | 8.5 / 8.8 s | 1,849 MB |
| Qwen2-VL-2B Q4_K_M | 0.222 | 0.062 | 0.00 * | 0.083 / **0.917** | 25.8 / 32.1 s | 2,998 MB |

\* Not a strength. SmolVLM-256M's answer could not be parsed for 69 of 112
crops ("Banquet." for almost everything). Qwen2-VL-2B answered "nothing" to
95 of 112 crops, including 31 of the 32 real-plan objects. SmolVLM-500M
answered "chair" 87 times, and so names a chair on every empty crop.

**None passes; none is wired.** No row is close. The best furniture
result (Qwen2-VL-2B, 7 of 12 generated sofas) comes with 1 of 12 Golden tables,
0 of 8 ORNEK tables and an over-count on 22 of 24 scenes. On this task a small
general VLM is not a second reader; it is noise with a latency.

**The whole-plan reading through the product's relay, with a real model.**
`VLM_PROVIDER=local` pointed at a real `llama-server` running Qwen2-VL-2B,
sent the same fixed request the page sends for the Golden Plan: the image,
120 detected candidates and an estimated 9,612 input tokens. On 4 CPU cores
the model processed 3,786 prompt tokens in 256.7 s (14.75 tokens/s,
`local-vlm-results/relay-e2e-qwen2-vl-2b-before-fix.server-timing.txt`). At the default
180 s cap the relay correctly answered TIMEOUT, with zero spend recorded.

With the cap raised to 900 s, the request instead came back after 301 s as
`LOCAL_NOT_RUNNING`. That was a **product bug**, found only because a real
model ran: Node's built-in fetch keeps its own 300-second headers clock, which
fired before the relay's, and its error was read as "the process is not
running". `server/vlm-local.mjs` now talks to the loopback process over a
plain HTTP request with no clock of its own. The relay's limit is the only
one. A transport's own timeout is still classed as TIMEOUT. The `vlm-local`
suite pins both, and a mutation of the classification turns it red.

After the fix, the same reading with the cap at 900 s: the relay waited its
own 900 s and answered **TIMEOUT**, with zero spend. The model had finished
reading the prompt and was writing its answer at 1.76 tokens/s, 1,098 tokens
in, peak RSS 2.69 GB (`relay-e2e-qwen2-vl-2b-after-fix.*`). A whole-plan
reading by a 2 B model on 4 CPU cores takes more than fifteen minutes.

What this settles for the ≤ 10 s target: on the reference class of machine, a
whole-plan reading by the smallest model that answers at all takes minutes,
not seconds. Even a per-region reading costs 8–26 s per crop. The model
reading stays what it was designed as: an optional, person-started second
look, through the cloud relay or a local process on stronger hardware, never
part of the analysis clock.

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
