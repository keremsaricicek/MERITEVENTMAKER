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

**2026-10-19: one question wired.** A plan-specific LoRA on Qwen3.5-0.8B,
scored once on blind plans and then on a supplementary test an independent
audit asked for, is wired for `merged` only (V4 below); the server measures
1.2 GB once llama.cpp's prompt cache is off.

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
| InternVL3.5-1B Q4_K_M, projector Q8_0 here (Apache-2.0) | 0.22 / **0.00** / 0.50 | **1.00** | 0.75 | 0.57 (0.57) | **1.00 / 1.00** | 15.3 s | 3,833 MB |

Timing caveat: the dev runs of the two 2 B models overlapped, for a few
minutes each, a training smoke test (Qwen3.5-2B) and a regression-suite run
(Qwen3-VL-2B) on the same 4 cores; their medians are upper bounds. The final
comparison below is timed on a quiet machine.

Small per-question counts (4–5 items on count, merged, serves, empty); the
point is the pattern, and the pattern holds across all three: **the models do
not know the drawing convention.** A sofa seen from above is "table" or
"nothing"; "serves" is answered "no" almost always (0.20 = the negatives).
Chair counting on a clear round table is the one zero-shot skill. InternVL's
5 / 5 on merged and on serves is five items each and comes with "table" for
every sofa and "stage" for every empty crop. A 672 px run of Qwen3.5-0.8B was
stopped unrun: the failure is not resolution. The faults
the audit found were real but were not why these models fail — with them
fixed, the failure is knowledge, not settings.

### V4: the drawing convention taught, scored once on unseen plans (2026-10-19)

The zero-shot failure was knowledge, so the convention was taught: a LoRA on
Qwen3.5-0.8B's MLP (rank 16, one epoch, 2,587 crops cut from TRAINING splits
only; `training/vlm_lora.py`; recipe and the bars, committed in 6585076 before
any trained adapter was scored, in `training/README.md` "V4"). The final test
is ONE run of `local-vlm-bench2.py --seed 5 --looks 2 --ctx 2048` on the BLIND
splits (style families 14/15, never trained on) plus the Golden and ORNEK
crops; the adapter and the untrained base answer the same 191 items (same
order, same truths — checked). Q8_0 model, Q8_0 projector, 4 threads. Raw rows:
`local-vlm-results/v4-blind-A.json`, `v4-blind-base.json`.

| Row (pre-registered bar) | n | untrained | **trained (run A)** | |
|---|---|---|---|---|
| identify, generated (≥ 0.85) | 60 | 0.17 | **0.93** | pass |
| identify, furniture (≥ 0.80) | 36 | 0.03 | **1.00** | pass |
| identify, real plans: Golden + ORNEK (≥ 0.80) | 32 | 0.19 | 0.75 | **FAIL** |
| empty crop called an object (≤ 0.05) | 12 | 0.42 | **0.00** | pass |
| "yes" on a true negative, merged + serves (≤ 0.10) | 24 | 0.00 | 0.00 | pass |
| chairs exact (≥ 0.80) / over-count (≤ 0.10) | 22 | 0.55 / 0.09 | **0.91 / 0.00** | pass |
| count exact (≥ 0.80) / over-count (≤ 0.10) | 17 | 0.18 / 0.41 | 0.76 / 0.00 | **FAIL** |
| merged (≥ 0.85) | 24 | 0.75 | **1.00** | pass |
| serves (≥ 0.85) | 24 | 0.50 | **1.00** | pass |
| median s per crop, 4 threads (≤ 10) | 382 looks | 4.8 * | 5.2 | pass |
| peak server RSS (≤ 3,000 MB) | — | 9,425 † | 9,448 † → **1,237** with the cache off | see below |

\* The untrained run's first minute overlapped a 48-second browser suite.
† The memory figure below.

On the real plans the model calls four Golden chairs a sofa (two of them on
both looks), the three Golden banquettes a sofa or a bench, and one ORNEK table
a chair: 24 of 32, under 0.80 — **identify is not wired**: a wrong type on a
real plan is the suggestion the review screen must not make. Count is under its
bar and is not a question the second look asks.

### The audit, and the test that answered it (S1)

`model-qa-specialist` reproduced every number from the rows, found no leakage
(0 of 191 crops, in any quarter turn, pixel-identical to a training crop; no
blind plan, seed or family in training), and returned **UNSOUND as proposed**
for three reasons the V4 test could not see:

- **serves**: no bench or banquette is ever "not serving" anywhere in training
  or test (bench 66 / 0, banquette 101 / 0 in training) — the question word
  alone scores 19 / 24;
- **chairs**: only even counts (2–12) were trained or tested, while the second
  look asks exactly where a count is unusual;
- **merged**: every "no" had a gap of at least 0.9 table sides; the product asks
  where tables nearly touch.

Those became a supplementary blind test, **S1**, pre-registered before any of
its scenes existed (`training/README.md`, commit 62071bb; generator
`synth_relations.py --s1`, blind families only, a new seed base; 122 items;
no retraining; raw rows `local-vlm-results/s1-A.json`):

| S1 row (bar) | n | trained (run A) | Wilson 95 % | |
|---|---|---|---|---|
| chairs exact, odd counts 3–11 (≥ 0.80) | 30 | **0.03** | 0.01–0.17 | **FAIL** |
| chairs exact, all (≥ 0.80) / over-count (≤ 0.10) | 42 | 0.31 / 0.52 | | **FAIL** |
| merged, all (≥ 0.85) | 40 | **1.00** | 0.91–1.00 | pass |
| "yes" on near-miss separate tables (≤ 0.10) | 20 | **0.00** | 0.00–0.16 | pass |
| serves, all (≥ 0.85) | 40 | 0.55 | 0.40–0.69 | **FAIL** |
| "yes" on a bench/banquette set apart (≤ 0.10) | 20 | 0.90 | 0.70–0.97 | **FAIL** |

The audit was right twice. The model has learned "a bench or banquette serves"
(18 of 20 set-apart pieces called serving) and only even chair counts: 3 → 4,
5 → 6, 7 → 8, 9 → 10, 11 → 10, on almost every crop. It has not learned to
count. Merged held: 40 of 40, and no near-miss pair of separate tables (a gap
of 0.35–0.9 sides) called one unit.

The untrained base on the same S1 items: chairs odd 4 / 30, serves 26 / 40
with "yes" on 4 of 20 set-apart pieces, merged 37 / 40 with 0 / 20 near-miss
(`s1-base.json`). Training did not teach serves; it taught the bias — the
base was wrong on set-apart pieces 4 times in 20, the adapter 18.

**Wired: `merged` only** — the one question that passed V4 and S1 (64 / 64
across both, Wilson 0.94–1.00; "yes" on a separate pair 0 / 32, upper bound
0.11). The second audit returned SOUND WITH FINDINGS for wiring it, with the
claim limited to what was measured: on generated plans in style families the
model never saw, whether 2–4 drawn tables touch, for separate pairs at least
0.35 table sides apart. It may NOT be read as: a real-plan result (no
real-plan merged truth exists in the repository), tables closer than 0.35
sides or touching at a corner (no truth generated there — and the product asks
exactly about groups the analysis already formed, so a wrong "yes" there would
read as agreement), a false-"yes" rate below 10 % (the bound is 0.16 on
near-miss pairs), or a memory figure without `--cache-ram 0` (the relay cannot
see that flag). Every answer stays a note a person reads; nothing is applied.

### The memory figure was the server's cache, not the model

Both scored runs reached ~9.4 GB. The server log says why: "making room for
prompt cache entry … (size = 41.620 MiB)", 168 times per run. This llama.cpp
build keeps up to 8 GiB of old prompt states by default (`--cache-ram 8192`)
although every request sends `cache_prompt:false` and none is reused. The same
191 items, adapter and settings, re-run with `--cache-ram 0`
(`v4-blind-A-nocache.json`): **every answer identical on both looks (191 /
191), peak server RSS 1,237 MB** (S1: 1,238 MB). This is a disclosed deviation
of procedure, not of the bar: the bar is unchanged, the scored run's 9,448 MB
stays on record, and the cost run's identity with it is checked by the suite
(`local-second-look`). The launch line now carries `--cache-ram 0`; on an 8 GB
office PC that flag is the difference between fitting and not.

The same default was on for every peak RSS measured before this section (the
zero-shot table above, the first harness's 1,088 / 1,849 / 2,998 MB below):
those are upper bounds that include the cache.

### The models the first harness eliminated, on the fair one, cache off

Dev, 60 items, seed 11 (`local-vlm-results/bench2-dev-*-nocache.json`):

| Model | identify gen. / furniture / real | empty → fabricated | merged / serves | median | peak RSS |
|---|---|---|---|---|---|
| SmolVLM-256M Q8_0 | 0.00 / 0.00 / 0.00 (25 unparsed) | 0.00 | 0.20 / 0.20 | 9.3 s | 632 MB |
| SmolVLM-500M Q8_0 | 0.09 / 0.00 / 0.25 | 1.00 | 0.80 / 0.20 | 10.3 s | 1,035 MB |
| SmolVLM2-500M Q8_0 | 0.30 / 0.18 / 0.08 | 1.00 | 0.80 / 0.20 | 10.3 s | 1,034 MB |
| Qwen2-VL-2B Q4_K_M | 0.17 / 0.24 / 0.17 | 0.00 | 0.80 / 0.20 | 36.0 s | 2,152 MB |

With the harness's faults fixed they still fail on knowledge. The first
harness did not eliminate them unfairly; it was only measuring them wrongly.

### Cost

Trained run, quiet 4-core Xeon (2.8 GHz, AVX-512; faster than the reference
office PC in `ACCEPTANCE.md`): median 5.2 s, p90 5.5 s per crop; a place is
looked at twice, so ~10 s per place. Server 1.24 GB with the cache off.
Training (developer machine only): 8,399 s on 4 threads, 4.9 GB.
Conversion: llama.cpp + adapter answered what transformers + PEFT answered on
24 of 24 crops (training crops, F16 projector — the audit's #8: a weak check).

### In the product, on the two real plans (2026-10-19)

`real-second-look-merged.json`: the real page, the real relay with this
manifest, the real llama-server (adapter, `-c 2048`, `--cache-ram 0`) on
loopback, Analyse pressed once.

- **The relay's server check passed against the real llama-server** (paths
  through symlinks, `/props`, `/lora-adapters`) — the audit's open item.
- **Golden:** analysis 8.4 s; the look started by itself; 12 groups asked (the
  cap; 13 qualify), 24 crops, **134 s** (5.6 s per crop). No main-thread task
  over 50 ms during the look — the page did not freeze. Answers: 10 AGREES
  (both looks "yes"), 2 UNSURE (the looks disagreed), 0 DIFFERS, 0 findings,
  nothing applied. By eye (`real-second-look-golden-groups.png`, the exact
  frames the product cropped) all 12 groups are rows of square tables pushed
  edge to edge — so 10 right, 2 abstained, 0 wrong. That is a person's reading
  of 12 crops, all of them true "yes", not a pre-registered test, and it says
  nothing about false "yes" on a real plan.
- **ORNEK:** every group the analysis formed has one table, so there is
  nothing to ask and nothing was asked.
- **Memory while it ran:** model server 1,213 MB; relay process 146 MB;
  headless Chromium with the app and its analysis engines ~1.75 GB summed RSS
  (an upper bound — shared pages are counted once per process). About 3.1 GB
  in all, inside an 8 GB machine.

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
