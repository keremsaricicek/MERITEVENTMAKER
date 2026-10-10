# Plan understanding — the 9/10 acceptance contract

Written 2026-10-04, **before** any of the work it judges, against the code at
`65808d5`. The thresholds are in `contract.mjs` (the copy a run is checked
against); this file says why each one is what it is. A threshold changes only
with a shown error in it, never to turn a run green. Existing targets are kept
as they were (§23 memory, the object-benchmark baseline, the CI analysis
budget); nothing here is lower than a target already written down.

```
node benchmarks/plan-understanding/measure.mjs             # report + overlays → ./latest
node benchmarks/plan-understanding/measure.mjs --compare   # exit 1 unless every row is met
```

## What is measured, and on what

The real app, on the two real supplied plans, **after the whole analysis has
finished** (OCR, label reading, printed numbers, plan intelligence —
`ui.analysisBusy` false), with the pinned OCR served from `.vendor-cache` and
the network refused. Every row is per plan, on the **auto** view: what an
operator gets by confirming the result as offered. A real object the product
found but held back is a miss here — the operator still has to find it and
switch it on. The **proposed** view (everything shown for review) is reported
beside it and never passes a gate.

Truth is the base annotation (`benchmarks/annotations/*.json`, human-verified
tables, chairs and chair→table links) plus `truth/*.json`, written for this
contract: venue elements measured from the drawing's own fill/outline pixels
and checked on zoomed crops, joined groups derived from the verified table
boxes (≤ 8 px apart; the smallest gap between tables that are NOT joined is
40 px, so no case is borderline), and chair facing checked by eye with an arrow
drawn per chair. Where the drawing does not decide what something is (the T
block in the middle of ORNEK, the grey boxes at the Golden stage's corners) the
region is **excluded** and neither class is scored there; a table found inside
it is still a false table.

Two real plans cannot show generalization and nothing here claims it. The
synthetic fixtures (`a2`, `a6`, `a8`) and the robustness renderings are tracked
by their own runners and listed under "carried targets" — they are not new
venues.

## Two measurement errors found while writing this

1. **The object benchmark read an intermediate state.** `run-benchmark.mjs`
   (and thirteen other runners) waited for `state.events[0].analysis` to exist —
   which it does *before* OCR, text suppression and label reading run. It
   measured a result the operator never sees. Fixed to wait for
   `!ui.analysisBusy`; on the Golden Plan the finished analysis has 2 phantom
   tables, not 4, and finds the stage; adversarial-dense has 76 chairs, not
   80. `BASELINE.json` re-recorded from the finished state (reason in the
   commit). The other thirteen still read early; each is listed in `README.md`
   here and is fixed when its area is worked.
2. **Chairs were scored half a chair off.** A candidate's x/y is its top-left
   corner; a chair detection's x/y is its **centre** (the review layer draws
   it with `translate(-50%,-50%)` and the commit path keeps it as a centre).
   The benchmark read chairs as top-left, adding ~24 px to every chair, hidden
   by a 3%-of-diagonal tolerance (47 px). Fixed in both scorers; the product
   itself was consistent. Chair centre error p90 goes from a reported 0.76 of
   a chair to 0.07. This is the case for one coordinate module (work item B).

## The thresholds

| area | row | 9/10 threshold | baseline `65808d5` (Golden · ORNEK) | why this number |
|---|---|---|---|---|
| tables | precision, recall | ≥ 0.97 each, count error ≤ 0.03 | P 0.979 R 1 · P 0.994 R 0.976 | a table carries 4–12 seats; 0.97 allows one error on the 46-table room and five on the 166-table one — beyond that the printed-total cross-check can no longer say *where* the error is |
| bistro | precision, recall | ≥ 0.9 | 1 / 1 · absent | five on the Golden Plan: all five, or one wrong type at most when there are ten |
| chairs | precision, recall | ≥ 0.95 each, count error ≤ 0.05 | P 1 R 0.947 · absent | chairs ARE the capacity: 5% is ~6 seats on 113, the most a coordinator can absorb without re-counting the room by hand |
| sofa, stage, column, bar, entrance, loca | precision, recall | ≥ 0.9 per class present | 0 / 0 for all six (stage found but held back) | the user's list; few per plan, so 0.9 means "all, or one miss in ten" |
| any class absent from a plan | false positives | 0 | 0 | a loca invented on a plan with none is a fabricated object |
| venue elements | median box IoU of found elements | ≥ 0.5 | — | a stage found as only its truss bar is in the right place and the wrong shape |
| chair→table | link accuracy · end-to-end | ≥ 0.97 · ≥ 0.92 | 0.99 · 0.917 | accuracy alone hides chairs never found; end-to-end (correct / all annotated links) = 0.97 × the 0.95 chair recall |
| joined groups | exact groups · exact chair count · spurious | ≥ 0.9 · ≥ 0.9 · ≤ 1 | 12/12 · 12/12 · 1 | a group is one dining unit: "3 tables + 8 chairs" must come out as one unit with eight seats, member geometry kept |
| geometry | table centre error p90 (share of side) | ≤ 0.15 | 0.035 · 0.095 | a table placed off by more than a sixth of itself is visibly wrong on the floor plan |
| | table box IoU p10 | ≥ 0.6 | 0.914 · 0.703 | shape and size, not only position |
| | table type accuracy | ≥ 0.97 | 1 · 1 | round/square/rectangle/bistro decides capacity rules |
| | rotation error p90 | ≤ 5° | 0 · 0 | both plans are axis-aligned; the robustness renderings rotate (carried target) |
| | chair centre error p90 | ≤ 0.35 of a chair | 0.071 · — | a seat drawn in the wrong place moves a guest's chair |
| direction | precision of stated facing (≤ 30°) · coverage | ≥ 0.95 · ≥ 0.8 | **0.684** · **0.115** | facing is stated only from the chair's own symbol, never from the box angle or "it is next to a table"; a stated facing that is wrong is worse than none, hence the precision floor |
| printed | table-number recall · verified precision | ≥ 0.9 · ≥ 0.99 | — · 0.554 / 1.0 | a VERIFIED number that is wrong seats a guest at the wrong table; recall below 0.9 is a page of manual typing |
| | printed capacity total read | exact | **not read** · 2064 ✓ | the Golden Plan prints "Total : 124 pax" in outlined orange text OCR does not read |
| capacity | held-back chairs in the drawn-chair figure | 0 | **5** · 0 | the product's "physical seats" counts chairs on tables it did not offer — the leak the user named |
| | drawn chairs vs truth · written total vs truth | ≤ 5% · exact | 112/113 ✓, total **null** · 0/0, 2064 ✓ | four numbers stay separate: drawn chairs, written capacity, logical seats, printed totals |
| digital plan | committed tables = offered tables | equal | ✓ · ✓ | Confirm must write what was offered, nothing more or less |
| | committed table surface centre error p90 (share of side), mapped back onto the drawing as the canvas draws it | ≤ 0.15 | **0.299** · **0.528** (97 of 166 on their drawing) | detection quality is wasted if Confirm writes the table somewhere else |
| | committed table aspect (log ratio) p90 · size error p90 | ≤ 0.1 · ≤ 0.15 | **0.267 · 0.447** · **0.201 · 0.25** | a round table stays round, a bistro stays bistro-sized |
| | committed chair centre error p90 (share of a chair) | ≤ 0.35 | **0.703** · — | a chair on the floor plan is where the drawing has it |
| corrections | operator actions per 100 objects (lower bound) | ≤ 5 | **14.2** · **11.5** | one action per wrong/missing object, link, type or group; the gap between "detected" and "usable" |
| run | analysis wall clock (this container, 4 CPU, no GPU) | ≤ 15 s · ≤ 60 s | 5.5 s · 30.2 s | an import is once per plan, with progress and cancel; the CI budget for the Golden Plan (7,680 ms) still applies separately |
| | peak JS heap | ≤ 1024 MB | 21 · 55 MB | a browser tab |
| | plan or guest data leaving the machine | 0 requests | 0 · 0 | the pinned engines (GETs of library and model files the CSP allows — 7 at baseline, 12 once the OCR model is in) are counted apart; anything else — another host, any request with a body — is egress |

**Baseline: 43 of 75 rows met** (the nine `digital.*` rows were added the same day, after a rendered screenshot showed the committed plan off its drawing, and still before the fix). Overlays (what was found, invented, missed;
wrong links; groups) are in `baseline-65808d5/*.overlay.jpg`, the full stored
analyses beside them.

## Progress, measured on commits (never remembered)

| commit | rows met | what moved |
|---|---|---|
| `65808d5` baseline | 43 / 75 | — |
| `1da997a` digital fidelity, review writer, two-line numbers, held-back capacity | 48 / 75 | digital centre/aspect/size/chair on the Golden Plan; held-back chairs in the drawn figure 5 → 0 |
| OCR model (PP-OCRv4, work item F) | 51 / 75 | Golden printed total **not read → 124 ✓** (and the written-capacity figure with it); ORNEK table-number recall **0.720 → 0.924**, verified wrong 0 → 0 (precision 1.0) |
| venue elements (work item H, `src/plan-venue-elements.js`) | 68 / 81 | stage, bar, both entrances on Golden from their printed words (P 1, R 1); columns as wall-threaded families — Golden 9 of 10, ORNEK 4 of 4, no false positive; ORNEK's 12 locas from the row its LOCA title labels (12 of 12, P 1). Six new rows exist because elements now match: their shape IoU — stage 0.613, columns 0.74–0.89 / 0.83–0.90, locas 0.92–0.94 met; **bar 0.046 and entrances 0.14/0.23 NOT met**, because their extent is the label's own box and says so (`geometryBasis: "label"`). Corrections per 100 objects: Golden 14.2 → 6.8, ORNEK 11.5 → 2.7 |
| printed matter is not seat evidence (the OCR model's lines handed to the detector and to text suppression) | 72 / 81 | Golden chair recall **0.947 → 0.956**, count error 0.053 → 0.035, drawn-chair error 0.053 → 0.035, chair→table end-to-end **0.917 → 0.927**; table precision unchanged at 0.979 (a first attempt traded one false table for the chairs — the door label GİRİŞ and its column, until then held back only because a glyph-"chair" sat inside it — and was not kept until text suppression read that label too) |
| banquettes, symbol rings, round symbols not joined by contact | 76 / 82 | Golden's three banquettes found in the seats' own measured colour (P 1 R 1), seat count admitted unknown; corrections per 100 objects 6.8 → **5.11** (needs ≤ 5). ORNEK table symbols measured out to their drawn ring: size error p90 **0.166 → 0.145** (met), IoU median 0.797 → 0.857; numbers still read inside the ring (recall 0.924, wrong 0). Two round symbols drawn close are no longer a "joined group": ORNEK spurious groups 1 → 0. **Not met, and not chased:** ORNEK aspect p90 0.107 — the annotation gives every one of its 166 tables the same nominal 78 × 78 disc, while the photographed sheet draws them as ~75 × 70 ellipses (measured off the pixels); fitting the boxes to the nominal square would be fitting the annotation, not the drawing |
| chair facing read off the family stencil (`src/plan-chair-facing.js`) | 77 / 82 | direction precision **0.684 → 1.0** (79 stated, 79 within 30°), coverage **0.106 → 0.699** — the 79 orange armchairs. The bistro chairs (9) and the pale round-table chairs (21) state nothing: their averaged stencils show no single backrest side at this resolution, and a guess is not a reading. Coverage stays NOT met |
| two tables cannot stand in one place; dining groups are made of offered tables | 78 / 82 | Golden table precision **0.979 → 1.0** (the split piece — an armchair and half of T11 — held back, its two seats returned to the tables they stand against), chair recall unchanged, chair→table end-to-end 0.927 → **0.945**, corrections per 100 objects 5.11 → **4.55** (met) |
| the facing survives Confirm (the digital plan keeps what was observed) | 78 / 82 | no contract row moves — the rows score the analysis — but the EDITABLE plan now carries it: of Golden's 109 committed chairs, 79 hold `facing` with `facingSource: "stencilBackrest"` and are drawn turned that way; 30 hold `facing: null` and are drawn with no front mark instead of the box angle's implied one; a save and a reload change none of it (`chair-facing` suite, both halves mutation-proved). The workbook is byte-for-byte the same sheet text before and after |

The OCR model's cost is time, measured here: Golden 4.1 s → 7.9 s, ORNEK
25.6 s → 43.9 s (budgets 15 s and 60 s); heap peak 24 → 21 MB and 60 → 61 MB.
Both rows were measured by `measure.mjs` on this container, the second with
the model served from the pinned test cache.

## A third measurement error, found by a screenshot

The `digital.*` rows were first scored assuming the canvas draws the plan
image anchored top-left. A rendered screenshot showed otherwise: the reference
layer draws it `background-size: 100% auto; background-position: center` in a
world box of fixed height 788 — the Golden Plan's own height — so on ORNEK the
drawing's top and bottom 91 px were cut off and the committed tables sat in a
frame the scorer did not model. The scorer now maps through the frame the
canvas actually draws (`score.mjs`, `scoreDigital`), reading the world box
size from the element; the baseline above was re-measured at `65808d5` with
it. Source review would not have caught this; the picture did.

## What a PDF carries (work item D) — and what no real plan here can measure

`src/plan-pdf-text.js` records, at import, what a PDF page carries besides
its pixels: its text objects in the raster's own pixels, and a count of what
it is drawn with. The text objects join the OCR model's lines wherever those
are used for what is PRINTED — printed-matter suppression for the detector and
for text, the plan's text the capacity layer reads, and the words that name a
stage, bar or entrance. A label the document states carries no confidence
figure and is observed on the `pdf-text` channel, never as `ocr`. Two things
are deliberately NOT done: a text object is not used as a table's printed
NUMBER (which symbol a number belongs to is a judgement with its own vote and
provenance), and vector paths are counted and named as unread, never turned
into tables or chairs.

No contract row moves, and none can: both real plans are rasters. `ORNEK.pdf`
is recorded `SCAN` — one image, zero text objects, zero paths — exactly as
`benchmarks/plans/ORNEK-SOURCE.md` measured it by hand. The behaviour is pinned
by `pdf-text-layer` on a SYNTHETIC vector PDF written byte by byte in the suite
(not a venue, never counted as one): a stage whose name is INVISIBLE text —
no pixel shows it, the OCR model does not read it — is still named, and
measured to the outline it sits in on the raster. A vector reader that turns
paths into furniture needs a real CAD-exported plan to be measured against;
there is none, and one is not invented.

## Carried targets (their own runners, not lowered)

| target | where | baseline |
|---|---|---|
| a2 mixed families: no real table held back, table recall ≥ 0.9, three chair families | `benchmarks/adversarial` (KNOWN FAIL) | recall 0.571, 3 held back, chair recall 0.34 |
| a6 architecture: offered phantoms 0 and offered precision ≥ 0.9 | same (KNOWN FAIL) | 0 offered, 21 held back (precision 0.276 proposed) |
| a8 small chairs: chair recall ≥ 0.8 | same | **0.089** |
| §23 memory: retention ≥ 0.98, identity precision ≥ 0.98, wrong application ≤ 0.01 | `benchmarks/memory` | 0.736 · 1.0 · 0 |
| robustness: no SEVERE rendering among the 13 | `benchmarks/robustness` | 7 SEVERE (blur, bright ±, contrast-high, hue-shift, jpeg-q20, lowres) |
| object benchmark: no guarded field worse than `BASELINE.json` | `npm run benchmark:baseline` | re-recorded from the finished analysis |

## Cloud and model cost

Measured, not estimated: every row above ran with **no cloud call**; cost 0.
Since the OCR model (work item F) the served app downloads two pinned model
files (PP-OCRv4 det 4.7 MB + rec 10.9 MB, Apache-2.0) and the ONNX Runtime Web
wasm (14.2 MB, MIT) from jsDelivr on first analysis — GETs with no body,
checked against their sha256 before use; the folder package carries them and
fetches nothing.

### The vision-language loop (work item G): built to the boundary, not run

`src/plan-vlm.js` turns the analysis's own doubts into one narrow question
per object — a bench whose seats are unknown, a reading held back, a printed
number the vote could not settle — about one crop, and checks each answer
against that question's closed schema. Answers come back as SUGGESTIONS on
the `vlm` channel, applied to nothing. It has never run against a model, and
nothing here says it has: the review screen states VISION-LANGUAGE MODEL NOT
CONFIGURED, and `vlm-replay` drives the loop with SCRIPTED answers written for
the suite to pin the boundary — no key and no guest data in any request, an
instruction printed on the drawing carried only as quoted data, a relay off
the page's own origin refused, out-of-schema answers refused, nothing applied.

What running it needs, concretely, and none of it is in this repository:

1. **A relay at the app's own origin** (`/vlm-relay`) that holds the API key
   server-side and forwards the request. The browser build is static files
   and its policy is `connect-src 'self'`; a key in the page or the package
   is refused by design. The eventual desktop build's main process could be
   that relay — after "EXE YAP", not before.
2. **A paid API key** for a vision-capable model, held by that relay.
3. **The operator's decision to send plan CROPS off the machine.** Only the
   crops of the objects asked about leave, never a guest, an inviter or a
   note — but a client's floor plan is still their drawing.

What it would cost is measured by the loop itself from the usage the
transport reports, and priced only from a table the operator supplies. The
size of the job, measured on this commit: the Golden Plan raises **4**
questions (3 benches' seats, 1 held-back reading), ORNEK **19** (12 locas'
seats, 7 printed numbers). Each request is a crop (the objects' own crops are
9–33 thousand pixels; upscaled to about 400 × 400 for legibility that is
about 213 image tokens by the published width × height / 750 rule) plus
about 800 characters of fixed instruction — on the order of 450 input and
40 output tokens a question, so about 2 thousand input tokens for the Golden
Plan and 9 thousand for ORNEK. That is an estimate of size, not a measured
cost: the first real run replaces it.
