# The vision-language relay

`npm run serve:vlm` starts one small Node process that serves the app **and**
holds the API key for the review screen's **Model reading**. The browser never
sees the key and never talks to Anthropic: it sends the relay a plan image, the
detector's boxes and the text read off the plan; the relay builds the request
from a fixed template, spends the key it was started with, checks the answer,
and returns findings for a person to accept or dismiss.

This is a developer/operator tool for the browser-review stage. It is **not**
the desktop build, it installs nothing, and it is not needed for anything else
in the app: `npm run serve` (no relay) and both offline packages work exactly
as before, and their review screen says no model relay is present.

## Running it

```
npm ci                                  # once — installs @anthropic-ai/sdk among the dev tools
ANTHROPIC_API_KEY=… npm run serve:vlm   # the key comes from the environment, nowhere else
# open http://127.0.0.1:8787/index.html
```

The key is read from the process environment as `ANTHROPIC_API_KEY` and from
nowhere else — not a file, not a flag, not the page. Never put it in a file in
this repository: `.env` and `.env.*` are ignored, but the right place is the
environment (or a secret store that sets it, such as a GitHub Codespaces
secret).

The console prints what the relay is: CONFIGURED or NOT CONFIGURED (and why),
the model, the prices it budgets with, its limits and today's spend so far.

In the app: open an event, import a plan, run Assisted Detection, go to the
review screen (**Floor Plan → Review / İnceleme**) and press **Model reading /
Model okuması**. The panel shows the relay's state; **Check connection (free)**
asks the API whether the key and the model are accepted (it costs nothing and
does **not** prove there is a balance); **Send plan to model** shows exactly
what will be sent and the spend caps, and sends only on **Send**.

## What leaves the machine

To the relay, then to the Anthropic API:

- the plan image, sized within both of the API's image limits (2,576 px long
  edge, about 3.59 million pixels) so the model's coordinates are the image's
  own pixels — and then up to four zoomed crops of regions the model asked to
  look at more closely;
- the detector's boxes on that image, with type, review status, a verified
  printed number and a typed seat count;
- the text the OCR model read off the plan, as quoted data.

Never: a guest, a note, an inviter, a seat assignment, the event's name. The
page builds the request from the analysis only (`MeritVlmReview.payloadFor`
is never handed an event), and the relay refuses any field it does not know,
anywhere in the request (`validateRunPayload`).

## A model on this machine instead (`VLM_PROVIDER=local`)

The same reading can go to a vision-language model running in a process on
this computer — nothing leaves the machine, there is no key and no charge:

```
# 1. a local model process speaking the OpenAI-compatible chat endpoint on
#    loopback, e.g. llama.cpp:  llama-server -m <model.gguf> --mmproj <mmproj.gguf> --port 8080 --cache-ram 0
#    (--cache-ram 0: this llama.cpp keeps up to 8 GiB of old prompt states by
#    default; the relay never reuses one, so on an 8 GB computer that cache is
#    the whole difference between fitting and not — measured, LOCAL-VLM.md)
# 2. a manifest beside the files, pinning each one:
#    { "format": "merit-local-vlm/1", "id": "...", "name": "...", "version": "...",
#      "licence": "...", "source": "<where the files came from>", "runtime": "llama.cpp bNNNN",
#      "files": [ { "path": "model.gguf", "bytes": N, "sha256": "<64 hex>" }, ... ] }
VLM_PROVIDER=local VLM_LOCAL_URL=http://127.0.0.1:8080 \
VLM_LOCAL_MANIFEST=/path/to/merit-local-vlm.json npm run serve:vlm
```

`server/vlm-local.mjs` is the provider. What it refuses, before anything is
sent: a URL that is not 127.0.0.1, localhost or ::1 (`LOCAL_NOT_LOOPBACK`); no
manifest (`LOCAL_NOT_PINNED`); a file missing (`LOCAL_MODEL_MISSING`) or one
byte different from its pinned size and sha256 (`LOCAL_MODEL_INTEGRITY`); a
manifest without a licence or a source, or with a path outside its folder
(`LOCAL_MANIFEST_INVALID`). The request is the cloud request's fixed
instruction, task text, image and answer schema in the chat endpoint's shape;
the answer goes through the same `validateModelOutput`; the day's request cap
still applies. A process that is not running is `LOCAL_NOT_RUNNING`. The page
says "on this computer", names the model, version and licence, and shows no
price.

No model ships with this repository. Models are fetched by a developer, pinned
by a manifest in `tools/local-vlm/manifests/`, and measured
(`benchmarks/offline-intelligence/LOCAL-VLM.md`).
`tests/suites/vlm-local.test.mjs` runs the whole path against
`tests/lib/fake-local-vlm.mjs`, whose answers are SCRIPTED: it proves the
plumbing, never a model's reading.

### The second look (`POST /vlm-relay/ask`)

A small model on four CPU cores cannot review a whole plan in useful time
(measured: past 15 minutes), so the local provider has a second door: ONE
closed question about ONE crop, chosen by the page from the places the analysis
is unsure of (`src/plan-local-check.js`):

| question | asks | answer |
|---|---|---|
| `identify` | what single object is at the centre | a word from a closed list |
| `count` | how many tables are in the crop | a number |
| `chairs` | how many chairs stand around the table in the centre | a number |
| `merged` | do the tables in the centre touch to form one long table | yes / no |
| `serves` | does this sofa / bench / banquette serve the table | yes / no |

The page sends a question NAME, a 64–1024 px crop and the run's ids — a closed
shape, an unknown field anywhere is refused. The relay writes the question
from `server/local-check-questions.json`, the file the benchmark
(`local-vlm-bench2.py`) and the training set (`training/vlm_lora.py`) read, so
the product asks word for word what was measured. The request carries no
system text and turns the model's thinking off, as the benchmark does. What
comes back is the closed value (`parseAskAnswer`, the benchmark's own reading
rules) or "no answer" — never the model's text. A question is asked only if
the manifest lists it under `checks`, with `checksEvidence` naming the
measurement it passed; otherwise `QUESTION_NOT_VALIDATED`, and the page offers
no second look at all. Never sent to a paid API (`ASK_LOCAL_ONLY`).

```
#  "checks": ["identify", "chairs"],
#  "checksEvidence": "benchmarks/offline-intelligence/local-vlm-results/<run>.json"
```

| variable | default | |
|---|---|---|
| `VLM_MAX_ASKS_PER_RUN` | 40 | questions in one second look |
| `VLM_MAX_ASKS_PER_DAY` | 800 | per UTC day; CPU, not money, so counted in memory, not in the spend ledger |

After an analysis the page starts the second look BY ITSELF when this relay
serves a local model with measured questions (the owner's decision,
2026-10-18; a switch in the panel turns it off on that computer). The relay
marks the pages it serves with `Server-Timing: merit-relay`, so a page served
any other way never calls `/vlm-relay`. One request at a time across `/run` and
`/ask`; Cancel aborts the question in flight and refuses the look's next one. Codes: `ASK_LOCAL_ONLY`,
`QUESTION_NOT_VALIDATED`, `ASK_LIMIT`, `ASK_DAY_LIMIT`.

## Limits

Every limit is checked against each **attempt's** worst case and refuses
**before** that attempt is sent. The worst case is the input the API's free
`count_tokens` reports for that model (documented by Anthropic as an estimate,
so 5% and 64 tokens are added; without a count the figure is a labelled
heuristic, never called exact) plus every output token `max_tokens` allows,
summed over every model the request may run on, at that model's price
(official table, checked 2026-10-10, Haiku 5.5's 100K-token tier included).

| variable | default | |
|---|---|---|
| `VLM_MODEL` | `claude-opus-5-5` | any model id; one without a listed price needs the two price variables |
| `VLM_PRICE_INPUT_PER_MTOK`, `VLM_PRICE_OUTPUT_PER_MTOK` | listed table (2026-10-06) | USD per million tokens |
| `VLM_EFFORT` | `high` | `low` … `max` |
| `VLM_FALLBACK_MODELS` | (none) | an explicit, priced chain such as `claude-opus-5`: a declined attempt and its fallback can BOTH be billed, so each hop is held. Open-ended routing (`VLM_FALLBACKS=default`) cannot be bounded and is refused as configuration |
| `VLM_MAX_OUTPUT_TOKENS` | 10000 | per request |
| `VLM_MAX_USD_PER_RUN` | 1.50 | one reading (overview + its regions) |
| `VLM_MAX_USD_PER_DAY` | 5.00 | per UTC day, held or spent |
| `VLM_MAX_REQUESTS_PER_DAY` | 40 | every attempt counts, retries included |
| `VLM_MAX_STEPS_PER_RUN` | 5 | 1 overview + up to 4 regions |
| `VLM_TIMEOUT_MS` | 180000 | per request; then TIMEOUT |
| `VLM_MAX_IMAGE_BYTES` | 4.5 MB | per image |
| `VLM_DATA_DIR` | `.vlm-data/` | the daily ledger (`usage.json`: aggregates only) |
| `PORT`, `HOST` | 8787, 127.0.0.1 | |
| `VLM_ALLOWED_HOSTS` | loopback (+ the Codespace's own forwarded name) | extra Host names, `name` or `*.suffix` |

Each attempt holds its own reservation, with an id and the UTC day it was
made in; it settles once, against that day, even when the answer arrives after
midnight. An attempt refused before processing (bad key, no balance, rate
limit, overload) gives its hold back. One that timed out, was cancelled, lost
its page, hit a broken connection or a 5xx keeps the worst case, because
nobody can know what it cost — and a retry is a new attempt with a new hold.

The ledger (`.vlm-data/usage.json`) is written to a temporary file, flushed,
then renamed. A ledger that exists but cannot be read is **not** reopened as
zero spend: the relay refuses paid requests and leaves the file untouched until
a person deals with it. A lock file (`usage.lock`, the writer's pid) keeps a
second relay off the same ledger. A reservation whose request never settled
(the process died) stays held after a restart, and the console says so.

## Security model

- The key is read once (`configFromEnv`) and used only as the `x-api-key`
  header to the upstream. `status`, replies, the log and the ledger never
  carry it; anything key-shaped is redacted from text that leaves the process.
- The SDK is constructed with an explicit key, `authToken: null` and an
  explicit base URL, and with `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_CUSTOM_HEADERS` and `ANTHROPIC_LOG` hidden from it: a shell that
  sets them for other tools does not redirect the product's requests, add a
  bearer token, or add headers.
- The relay serves `index.html` and `src/` only — not itself, its ledger,
  `package.json` or `node_modules`.
- A POST must carry `X-Merit-Relay: 1` (a cross-site form cannot set it), must
  not come from another Origin or be flagged cross-site, and must name a Host
  the relay was started for (DNS rebinding).
- One request at a time; Cancel aborts the request in flight and refuses the
  reading's next step; a page that disconnects aborts its request.
- Text printed on a plan is content of the drawing: it travels as quoted JSON
  data, the instruction is identical whatever the plan says, and the answer is
  checked against a closed schema (refs must exist, boxes must sit in the
  image, counts are capped).

## Testing without a key

`tests/suites/vlm-relay.test.mjs` and `tests/suites/vlm-reading.test.mjs` run
the relay against `tests/lib/fake-anthropic.mjs`, a local server whose every
answer is **scripted** by the suite. They prove the plumbing — key handling,
limits, cancellation, error codes, stale-answer rejection, the screen's
accept/dismiss path — and nothing about how well a model reads a plan. No
result of theirs may be reported as model performance.

## Error codes

`NO_KEY`, `UNKNOWN_PRICE`, `BUSY`, `BAD_PAYLOAD`, `UNKNOWN_FIELD`,
`PAYLOAD_TOO_LARGE`, `IMAGE_TOO_LARGE`, `RUN_UNKNOWN`, `RUN_MISMATCH`,
`CANCELLED`, `STEP_LIMIT`, `REQUEST_LIMIT`, `DAY_BUDGET`, `RUN_BUDGET`,
`TIMEOUT`, `UNREACHABLE`, `LEDGER_CORRUPT`, `LEDGER_LOCKED`, `UNBOUNDED_FALLBACK`, `KEY_INVALID`, `NO_BALANCE` (a 402, a
`billing_error`, or a 400 stating the credit balance), `KEY_FORBIDDEN`,
`MODEL_UNAVAILABLE`, `RATE_LIMITED` and `OVERLOADED` (each retried once),
`BAD_REQUEST`, `UPSTREAM_ERROR`, `MODEL_DECLINED`, `OUTPUT_TRUNCATED`,
`INVALID_OUTPUT`, `CROSS_SITE`, `HOST_NOT_ALLOWED`, `CHECK_TOO_SOON`,
`ASK_LOCAL_ONLY`, `QUESTION_NOT_VALIDATED`, `ASK_LIMIT`, `ASK_DAY_LIMIT`. Each
has a sentence in both languages in `src/i18n.js` (`vlm.err.*`).
