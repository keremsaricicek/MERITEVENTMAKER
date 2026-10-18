# Offline plan intelligence — the open items, one table

Opened 2026-10-12 at `597b0cc`. Thresholds come from
[`ACCEPTANCE.md`](ACCEPTANCE.md) (rows added 2026-10-12 were committed in
`d66984a`, before any result of this programme) and from the plan-understanding
contract (`benchmarks/plan-understanding/CONTRACT.md`). A baseline names the date
and commit it was measured at; a number from an older commit is labelled as such.
Every row ends MET, NOT MET (with the number), BLOCKED (with the external cause)
or NOT MEASURED. Results are filled in as each workstream lands; the commit is
named beside each result.

Evidence classes: **REG** regression set (Golden, ORNEK, adversarial — proves
nothing got worse, never a new venue) · **ROB** Golden rendered 15 ways ·
**SYN** synthetic with exact labels (held-out / blind families) · **LOVO** leave
one real venue out · **BLIND** a real venue nobody has seen (none exists).

## Detection

| id | problem | user impact | baseline | acceptance | fix (owner) | verification | result |
|---|---|---|---|---|---|---|---|
| D1 | Golden table precision | a phantom table is a seat that does not exist | 0.979 (46/1/0), REG, 2026-10-11 | ≥ 0.98 | detection workstream | `npm run benchmark` | open **Cause named (2026-10-18):** the one proposed false table (776, 303; 62 × 38) is the split piece, an armchair and half of T11. The offered view already holds it back (plan-understanding table P = 1.0); the proposed view counts it. |
| D2 | Golden chair precision | phantom chairs inflate capacity | 0.973 (108/3/5), REG, `597b0cc` | ≥ 0.98 | detection | `npm run benchmark` | open **Causes named (2026-10-18, `reports/latest.json` spurious list, crops checked):** 108 TP, 3 FP.
- Two FPs, at (1138, 707) and (678, 706), are segments of the stage's blue truss struts. They pass the uniform chair family on size and shape, and colour is not part of that test.
- One FP, at (1310, 572), is a fragment between t040's right chair and the diagonal bar it touches.
The fix belongs in the chair family's admission test, so a mark must look like the chairs drawn at the tables. That is a detector change, gated on the fingerprint and the full detector benchmarks, and is not made this session. |
| D3 | squares typed as round on bold-black and pastel drawings | wrong table type; pushed-together rows never join | 47 units mistyped, SYN dev, 2026-10-11 (`benchmarks/relations/README.md`) | type accuracy ≥ 0.95 per family | cause found: the symbol-family promotion typed every member `round`; now typed from its own outline | `benchmarks/detection/diagnose-types.mjs`; suite `symbolic-plan-shape` | **type: 195 → 0 mistyped** on the bold-black/pastel scenes; dev units exact 0.817 → 0.887 (2026-10-17). Chairs on those two families still not found (D12) |
| D12 | solid-square and half-disc chairs not found | the plan is read as symbolic; seats missing | 0 of 169 chairs on `rel-bold-black-7000032`, 0 of 123 on `rel-pastel-arch-7000043` (2026-10-17) | chair recall ≥ 0.95 per family | cause: the table interiors were the reference "seat"; the solid seats were never offered. Rule: a smaller population that SERVES the reference (outside, ≥ 2 per member, on more than one side) becomes the seats; a seat also passes on its oriented box | `diagnose-types.mjs`; suite `served-seats` | **MET on both plans** (2026-10-17): 168/0/1 and 123/0/0 chairs, 29 → 0 false tables; relation dev units exact 427 → 436 / 476; regression plans identical. Cost stated: a table seated on one side only is not recognised by this rule |
| D4 | photometric robustness (JPEG, blur, brightness, contrast, hue, low-res) | the same plan scanned or photographed differently gives a different room | 8 HEALTHY / 3 WEAK / 5 SEVERE; e.g. hue-shift 39 false tables, lowres-roundtrip table recall 0.37 — ROB, `597b0cc` | all HEALTHY; type stability ≥ 0.95 | causes found per rendering (`benchmarks/robustness/README.md`); model-added tables exempt from text suppression; fusion's size reference is the model's own boxes of the tables both witnesses see | `node benchmarks/robustness/run-robustness.mjs` | **improved, NOT MET** (2026-10-17, re-measured): **11 HEALTHY / 2 ACCEPTABLE / 3 WEAK / 0 SEVERE** (was 8 / 2 / 3 / 3). hue-shift 43/39/3 → 46/0/0, contrast-high 43/36/3 → 46/2/0, bright-up 43/30/3 → 44/2/2 tables, each fixed at its measured cause (surface = the table-scale tone family when the largest is fringe; chair-colour boxes turned away when no surface family survives); Golden and ORNEK candidates byte-identical; median table F1 0.957. Still WEAK: downscale-70 (69 false chairs), jpeg-q20, lowres-roundtrip — `benchmarks/robustness/README.md` |
| D5 | rotated, long, L/T and pushed-together furniture missed or fragmented | groups break; tables to add by hand | relation e2e: member not found dev 25 units, blind 57; duplicate/fragment joined dev 15 — SYN, 2026-10-11 | group P/R ≥ 0.95 | detection + training | `measure-groups-e2e.mjs` | open |
| D6 | box size, not only centre | digital plan and memory depend on the box | v2 model chairs 104/9/9 by centre, 82/31/31 at IoU 0.5 — `597b0cc`; product chair IoU NOT MEASURED | table IoU P10 ≥ 0.6; chair IoU median ≥ 0.6 | detection | run-benchmark box fields; `eval_detector_coco.py` | **table MET, chair MET overall with one family short (2026-10-18, product boxes from `plan-understanding/measure.mjs`, axis-aligned envelope of each chair's turned box against the annotation).** Tables: IoU P10 Golden 0.914, ORNEK 0.847 against measured outlines. Chairs on Golden, 108 matched: IoU median 0.918 (P10 0.425, 89 of 108 at ≥ 0.5). Orange armchairs 0.943 (79/79 ≥ 0.5) and bistro chairs 0.842 (9/9). Pale crescent chairs only 0.425 (1/20): the product boxes them about 20 × 15 px, where the visible chair is about 33 × 24. Open, and named: the pale family's box. |
| D7 | small / faint / partly covered objects | missed tables | ORNEK faint 73–76 found only by the local model (fused 165/1/1), REG, 2026-10-11 | table recall ≥ 0.95 per venue (met on REG) | detection + training | SYN L5–L7 per level | open |
| D8 | classical, model and vector results fused consistently | the same object twice, or two types | suites `local-model`, `plan-number-integrity` green at `597b0cc` | no duplicate, one type, joins numbers/relations/memory/digital | detection | suites + e2e | open |
| D9 | bar and entrance outline accuracy | the digital plan draws them the wrong size | Golden bar shape IoU 0.046, entrance 0.225 (2026-10-10, `latest/report.json`) | ≥ 0.5 | not yet assigned | `plan-understanding/measure.mjs` | **bar MET, entrance NOT MET** (2026-10-18): Golden bar shape IoU 0.046 → **0.87** — the counter drawn around BAR is measured from its fill when no closed area surrounds the word (`plan-venue-elements.js`, geometryBasis "structure"; suite `plan-venue-elements`); entrance still 0.225 / 0.136: an entrance is an OPENING in a wall, which nothing here measures yet. REG evidence (one real plan draws a bar) **Entrance attempt, 2026-10-18 (pre-registered, FAILED, reverted):** a rule took the break in a wall beside the label as the entrance's extent. On the Golden Plan:
- top right: the top wall is NOT broken; it is one slightly tilted line, closed at the corner.
- left: horizontal lines cross the walking band at y 268, 177 and 130. The rule took a 47 px gap in a different wall, which is not the entrance.
Shipping it would have drawn a wrong area, so the label-only extent stays ("not measured: the label's own box"). Note: the scorer's "median" of two values is the larger one, so a one-of-two fix would have read as MET. |
| D10 | chair facing coverage | seats without a direction | Golden 0.699 (2026-10-10) | ≥ 0.8 | detection | `plan-understanding/measure.mjs` | **MET (2026-10-18): coverage 0.699 → 0.894, precision 1.0, wrong > 45° 0, P90 error 1.2°**, suite `chair-facing` (19 checks). Pre-registered twice. The first rule (15–85 % of the chair's BOX inside the table's drawn shape) fired on 0 of 30, because a detected chair box covers only the visible part (box-to-edge gap: median 2.8 px round, 3.3 px bistro); it was not tuned. D10b, written before running: the chair faces its table's centre when, walking from the chair's centre toward it, every pixel up to 2 px past the table's drawn edge is ink, not paper (`drawnAgainstTable`); paper between them gives nothing. Offline on all 109 chairs before wiring: fired 29 of 30 unread, and on 60 of the 79 stencil-read chairs, all within 30°. The only misses were three chairs whose TRUTH was wrong (`34d68de`, Golden truth correction); without that correction this row would read wrong > 45° = 1. **Narrowed after CI** (`benchmark:facts` 0.8387 < 0.90): D10b gave a facing to every plain square touching its table on the three adversarial plans (80/80, 76/76, 48/73 claimed against 0 orientable symbols). Contact says where a chair is, not which way a symmetric symbol faces. So a joined chair must also show a back on its far side — two lines, as the stencil reads a family (`backrestAway`). The adversarial plans now claim nothing; facts accuracy is back to 0.9286. Golden coverage went 0.956 → 0.894 (22 of the 30 joined chairs keep a facing; 8 whose far side does not show its backrest at this resolution stay unread). |
| D11 | ORNEK digital table aspect | drawn tables slightly the wrong shape | P90 log error 0.107 (2026-10-10) | ≤ 0.1 | detection + truth | `plan-understanding/measure.mjs` | **MET against measured outlines (2026-10-18, `5f94283`): 0.091 digital and geometry; 0.107 against the annotation's nominal box (kept in `vsAnnotationBox`).** The annotation gives all 166 tables one nominal 78 × 78 box (its centres are measured, its sizes are not). The photographed sheet draws ellipses 70–90 × 66–77 px. 164 outlines were measured by an independent tool and checked by eye; 2 that touch a pillar line are not measured. Threshold unchanged. Product box errors still visible against the measured outlines: the faint row 71–76 is not ring-refined, a few round symbols are rotated 45°, and table 72 is flattened by glare (73.7 × 40.4). Size error P90 is 0.107 (≤ 0.15 met). |

## Training

| id | problem | user impact | baseline | acceptance | fix (owner) | verification | result |
|---|---|---|---|---|---|---|---|
| T1 | v3 regressed on several levels and real plans | no better model to ship | held-out L5 table P 0.97→0.94, Golden chair R 0.920→0.894, +1 false table on ORNEK (2026-10-11) | root cause written with numbers | training workstream | `training/diagnose_fp.py`; `training/README.md` | **MET** (2026-10-17): the precision loss of v3, v4a and v4b is mostly a SECOND PEAK on a table already found — v4b 132 of 148 false tables on val + held-out L4–L7, same class, 147 pairs within a quarter side — while look-alikes FELL (decorations 22 → 14, chairs 8 → 0). A decoder defect shared by every model (3×3 peak pick only); E3 tests the fix |
| T2 | generator gaps (bold-black/pastel squares, L/T, sofas/benches, look-alikes, photometric) | the model never saw the failures above | generation 3 (seven levels) | data covers D3–D7 | training | inspector READY + per-level eval | open |
| T3 | the old blind families were used in development | "blind" numbers are no longer blind | families 14/15 + u-shape scored 2026-10-11 | a NEW blind set, defined before scoring, scored once | training | `training/README.md` | open |
| T4 | a candidate better than v2 everywhere | fewer corrections | v2 active; v3 not packaged | ACCEPTANCE.md activation rows (QA SOUND, no group worse by > 0.005, no new false table on REG, gates) | training → QA → coordinator | `training/compare_candidates.py`; `model-qa-specialist` report | **NOT MET** (2026-10-17): v4a (E1), v4b (E2, and under the E3 decode), v5a (E4), v5b (E5) and v6a (E6) each fail their pre-registered condition; v2 stays active. Causes measured per run in `training/README.md` **E7 (2026-10-18) FAILS**: sofa R 0.777, bench 0.179, banquette 0.578 at 0.5. Base regressions: val 5, held-out 8, gen-2 val 2 (columns R 0.855 → 0.791). Real set: no regression. Calibrated seating thresholds (E7cal, chosen on training scenes) do not close it: bench 0.083 at the 0.543 its own training scenes require for precision 0.95. v2 stays active; not packaged; blind not scored. Detail: `training/README.md` E7/E7cal. |
| T5 | architecture fixed at four classes | sofas/benches not learned | 4 classes | a measured alternative (5th class or specialist) with CPU/RAM/accuracy cost | training | experiment record | **measured, NOT MET** (2026-10-17): E4 (seven classes end to end), E5 (seating branch on a frozen v2) and E6 (E5 + cut-object label fixed + class balance) — furniture recall at the fixed 0.5: sofa 0 / 0.452 / 0.315, bench 0 / 0.006 / 0.006, banquette 0 / 0.060 / 0.157, precision ≥ 0.68. The branch finds benches (strongest channel at 101–127 of 156 centres) but peaks at a median 0.26–0.29: not a threshold or schedule problem; the next change is what the branch can see E7: adapting the base under distillation lifted all three seating classes (sofa 0.315 → 0.777); benches are the strongest class at 85 % of their centres but cannot be separated from bench-like peaks elsewhere (E7cal). A fifth-class model is measured, and does NOT pass. |

## Relations and capacity

| id | problem | user impact | baseline | acceptance | fix (owner) | verification | result |
|---|---|---|---|---|---|---|---|
| R1 | sofas, benches, banquettes in groups | capacity and grouping wrong where they appear | 2026-10-17, 4 trial furniture scenes (`measure-seating-furniture.mjs`): of 83 pieces 1 named, 24 read as tables, 26 cushions read as chairs; seats unknown reported unknown 1 / 38; groups linked 0 / 20 | seats counted twice 0; unknown capacity reported unknown 100 %; groups P/R ≥ 0.95 | furniture scenes + scorer (`synth_relations.py --furniture`); E4: seating classes in the local model; fusion adds a named piece with seats unknown, marks a table on one | `measure-seating-furniture.mjs` on the furniture dev split | **links MET on true boxes; end to end NOT MEASURABLE yet** (2026-10-17): `buildSeatingLinks` (serves rule in the piece's own frame) — seat/dev 363/363 groups exact, links P/R 1.000/1.000, sofa-apart linked 0/73, room seats never over-counted; blind (scored once, after freezing) 163/163, 0/31. From axis-aligned envelopes 0.705/0.730; the product reads each piece's turn from its pixels (`orientPiece`, 186/186 and 83/83 turned pieces within 5°) and then matches the turned-box result. End to end needs a model that names furniture: E5 and E6 failed their conditions, so none is active — `benchmarks/relations/README.md` (R2), suite `seating-links` |
| R2 | usage groups end to end | pushed-together rows split | units exact dev 0.817, blind 0.861 (2026-10-11) | ≥ 0.95 | relations + detection | `measure-groups-e2e.mjs` | open |
| R3 | printed vs drawn vs group capacity contradictions | wrong capacity accepted silently | capacity audit exists (U6) | each contradiction named with its objects | relations | suites | **improved, open** (2026-10-18): the capacity audit names, per seating group, the table, the pieces and chairs its seats rest on, a shared piece not divided, pieces whose seats are not shown, chairs standing on a piece (counted as chairs, never also as the piece's seats) and table candidates on a piece; pushed-together groups and printed totals as before. End to end on furniture waits for a model that names it |
| R4 | questions to the person | too many confirmations, or none where needed | NOT MEASURED | one most-useful question per ambiguity; questions per plan reported | relations | e2e | **improved, open** (2026-10-18): the capacity audit asks at most ONE seating question — the seats of the longest undivided piece that serves a table when the drawing's total disagrees, else the one uncertain link (suite `seating-links`); questions per plan are not yet reported by a benchmark |

## Learning

| id | problem | user impact | baseline | acceptance | fix (owner) | verification | result |
|---|---|---|---|---|---|---|---|
| L1 | decision memory retention | a person's decision lost after a rescan | 0.8447 (`597b0cc`) | ≥ 0.98 | learning + detection stability (D4) | `npm run benchmark:memory -- --compare` | **NOT MET, cause re-measured** (2026-10-18): 0.8447 unchanged. `measure-memory.mjs --dump` on jpeg-q20: of 12 lost decisions 6 are AMBIGUOUS on SIZE (the compressed image's detection draws the object at another size) and 6 have no candidate at all. A pre-registered margin change (a twin on the same spot is no rival) moved nothing and was reverted. The lever is detection under heavy compression (D4: jpeg-q20 WEAK), not the matcher |
| L2 | decision applied to the wrong object | silent corruption | 0.0073 — one decision (t042, grayscale) | 0 (≤ 0.5 % worst case) | learning | same | **NOT MET, unchanged** (2026-10-18): 0.0073, the same single decision (t042, grayscale); identity precision 0.9927 |
| L3 | find more like this from 1–3 examples | the person draws every missed object by hand | 0 % recovered, up to 9 phantoms / 100 (ORNEK) | ≥ 50 % recovered, ≤ 1 phantom / 100 | learning | `exemplar-measure.mjs` + SYN | **NOT MET, improved and now in the product** (2026-10-18): measured on the 15 renderings where the detector misses 100 tables / 286 chairs (ROB): tables 1 example 0.47 recovered / 0 phantoms per 100; 3 examples union 0.58 / 58.1 → agreement (`searchMany`) 0.47 / 1.55; chairs 0.27 / 0.44 (1), 0.27 / 0.50 (3). The review card of a confirmed object offers "Benzerlerini bul" (suggestions only, Undo); suite `find-similar` |
| L4 | lessons: source, scope, version, undo, no unchecked spread | a lesson leaking to another venue | suites green at `597b0cc` | verified by suites; wording never says "retrained" | learning | suites, TR/EN | **MET** (2026-10-18): scope and spread — `plan-teach-area` (80 checks), `teach-venue-scope`; persistence across a reload, re-application to the one object after a re-analysis, Forget, Undo of keeping and of forgetting (the same lesson id and reach back, audited), refusal on a completed event — `teach-lesson-lifecycle` (15 checks, a no-op restore turns 3 red). The wording never says trained (checked in both languages by `plan-teach-area`) |

## Speed and responsiveness (Linux container; not a Windows measurement)

| id | problem | user impact | baseline | acceptance | fix (owner) | verification | result |
|---|---|---|---|---|---|---|---|
| S1 | ORNEK full analysis, 4 cores, cold | 21 s wait | 21.2 s (p95 21.7) — 2026-10-11, `d14fc37` | ≤ 10 s | coordinator (OCR first: model detection ~5.7 s, recognition 231 lines ~7.1 s) | `taskset -c 0-3 node benchmarks/perf/analysis-profile.mjs 5` | **NOT MET** (2026-10-17, quiet window): 20.1 s median (worst 21.9); OCR model 12.8 s of it. Golden 6.9 s **2026-10-18 (quiet, `runs-2026-10-18/`):** no gap 20.7 s (NOT met). After the person looks at the plan for 5 s: 16.1 s. After 15 s, with the S5 prefetch reading the text meanwhile: **9.0 s (p95 9.5), met only on that condition**. Re-analysis of the same plan (S7, reads reused): 13.9 → **4.9 s**. |
| S2 | ORNEK longest main-thread task | the page stutters | 215 ms (p95 245) cold, 273 ms warm — `d14fc37` | ≤ 200 ms | coordinator | same runner | **NOT MET, at the line** (2026-10-17): 202 ms median cold (worst 249), 187 ms warm (worst 205); Golden 152 / 100 ms 2026-10-18: 186–206 ms on 4 cores, up to 265 ms on 2 cores. At or above the line, NOT met. |
| S3 | 2 cores | slower office PCs | ORNEK 43.9 s, Golden 9.7 s (one run, 2026-10-11) | ≤ 30 s / ≤ 10 s p50 (hardware rows) | coordinator | `taskset -c 0,1 …` | **NOT MET** (2026-10-17, 5 runs): ORNEK 41.6 s, Golden 10.3 s 2026-10-18: ORNEK cold 43.9 s (26.8 s after a 15 s look), re-analysis 27.7 → **5.2 s** (S7); Golden 9.9 s cold (3.6 s after a 15 s look). The ORNEK cold row is NOT met. |
| S4 | import→usable and Analyse→complete reported apart | — | not reported apart | both clocks, cold/warm, 4/2 cores, ≥ 5 runs | coordinator | runner | **half** (2026-10-17): Analyse→complete cold/warm, 4 and 2 cores, 5 runs each, raw logs kept; import→usable NOT MEASURED (the runner has no such clock) **MEASURED (2026-10-18):** import→usable is now a working clock. The old runner never stopped, because the plan is a CSS background, not an `<img>`. 4 cores, prefetch on / off: Golden 0.52 / 0.37 s, ORNEK PNG 1.65 / 1.29 s, ORNEK PDF 5.86 / 4.10 s; 2 cores in `perf/README.md`. Two bugs were found and fixed: the dialog import never started the prefetch (no `importedAtMs`), and the prefetch delayed the first view (now deferred to after the first frames). |
| S5 | Stop ends the engines; stale answers never overwrite | lost decisions on cancel | suites `analysis-workers`, `analysis-cancel` green | stays green after every speed change | coordinator | suites | open |
| S6 | ORNEK analysis inside the plan-understanding contract | — | 66.4 s against ≤ 60 s (2026-10-10, before the speed work) | ≤ 60 s | — | re-measure | **MET** (2026-10-18): ORNEK whole analysis 30.4 s inside `plan-understanding/measure.mjs` (≤ 60 s), measured while a detector trained on 3 of the 4 cores — an upper bound, not a quiet figure |

## Vision-language model, tools, data

| id | problem | user impact | baseline | acceptance | fix | verification | result |
|---|---|---|---|---|---|---|---|
| V1 | local VLM compared on plan tasks | no free-text reading of notes | NOT MEASURED: weights refused by the session's network policy (`huggingface.co`, `cdn-lfs.hf.co`, `cas-bridge.xethub.hf.co` answer 403 to CONNECT; re-checked 2026-10-12) | two candidates compared | BLOCKED — the account owner allows those hosts in the environment's network settings | `LOCAL-VLM.md` | BLOCKED — **2026-10-18: MEASURED, none useful, none wired.** The weights are no longer refused: three Apache-2.0 models were fetched and pinned (`tools/local-vlm/manifests`). Real llama.cpp inference, 4 threads, 136 crops, pre-registered bar (`LOCAL-VLM.md`):
- SmolVLM-256M: furniture 0.028, real 0.031, 8.0 s, 1.1 GB.
- SmolVLM-500M: furniture 0.000, real 0.250, fabrication 1.00, over-count 0.917, 8.5 s, 1.8 GB.
- Qwen2-VL-2B: furniture 0.222, real 0.062, over-count 0.917, 25.8 s, 3.0 GB.
A whole-plan reading through the product relay with Qwen2-VL-2B runs past 15 minutes. It exposed a product bug, now fixed: Node fetch's own 300 s clock reported a slow model as "not running"; `vlm-local` pins the fix. |
| X1 | Olive needs torch; reproducible | dev tooling only | CPU torch index refused (403); verified only with a torch already in the container | reproducible from an allowed official source | coordinator | clean venv | **MET** (2026-10-17): `setup.sh --with-olive-pypi` installs torch 2.14.1 from pypi.org with every file sha256-pinned, into an empty environment, in 6 min 39 s; `import olive` and the Olive INT8 run pass (166 / 166 agree). `tools/model-dev/README.md` |
| X2 | FiftyOne datasets / App | dev tooling only | mongod download refused (403); pycocotools + matcher work | a local DB or a local error gallery | coordinator | run | **MET** (2026-10-17): `tools/model-dev/mongodb.sh` installs MongoDB 8.3.7 from conda-forge (micromamba sha256-checked, packages md5-checked), loopback only; FiftyOne `Dataset` + `evaluate_detections` run against it, cross-check SAME |
| N1 | real blind plans | the 9.5 claim | none in the repository | ≥ 1 licensed public plan of an unseen venue | coordinator (search) | `DATA-SOURCES.md` | open |
| N2 | a real 8 GB Windows PC | the target machine | NOT MEASURED | measured | needs the person | — | NOT MEASURED |
| N3 | an operator's corrections and minutes on a new plan | the real 9.5 | NOT MEASURED | measured | needs the person | — | NOT MEASURED |

## Stale statements corrected

- `README.md`, "Hardware: two cores, a 4 GB memory cap" and its acceptance rows:
  measured before the 2026-10-11 speed work. The longest main-thread task there
  (2.4–5.7 s) is superseded by `benchmarks/perf/README.md` (Golden 156 ms,
  ORNEK 215 ms on 4 cores, `d14fc37`). The 2-core totals there come from a
  different runner with a memory cap; they are kept, dated, and not compared
  with the 4-core runner's numbers.
- `benchmarks/plan-understanding/latest/report.json` is dated 2026-10-10; its
  `run.analysisMs` for ORNEK (66.4 s) predates the speed work and is re-measured
  under S6.
- `benchmarks/robustness/BASELINE.json` was recorded at `b8153d7` (2026-08-31).
  **Settled 2026-10-18: it measured a different product, the app WITHOUT OCR.**
  A run with OCR refused (`MERIT_VENDOR_NETWORK=1`) reproduces its table rows
  exactly: blur table F1 0.643, jpeg-q20 26 false tables, lowres 0.636. Every
  runner since `d65a03a` (2026-09-27) serves the pinned OCR, so the "WORSE" rows
  compared two products. With OCR refused, the residual against the old
  baseline is at most one chair FP per rendering. Re-recorded from a
  clean-tree run with the pinned OCR, with the reason stored in the file;
  `run-robustness.mjs --record` now refuses without `--reason`, as the
  adversarial and memory baselines do. With OCR, renderings are 11 HEALTHY,
  2 ACCEPTABLE, 3 WEAK (downscale-70, jpeg-q20, lowres-roundtrip), 0 SEVERE.

## Continuation record (2026-10-18, end of session)

Closed this session, each with its commit and evidence:

| Item | Result | Commit |
|---|---|---|
| D4 | the three SEVERE renderings fixed at their cause | `3253e13` |
| D10 | chair facing coverage 0.699 → 0.894, precision 1.0 | `929426e`, narrowed in `367aca2` after CI |
| D11 | ORNEK aspect measured against 164 measured outlines: 0.091 | `5f94283` |
| D6 | box IoU measured: tables P10 0.91 / 0.85, chairs median 0.918; pale chairs 0.425 | `5f94283` (scorer), `34d68de` (chair boxes) |
| Golden truth | four pale chairs corrected | `34d68de` |
| L3 | find more like this | `72c3e92` |
| L4 | Teach Area Undo | `02ec729` |
| R2 | seating links, 100 % on true boxes | `5d02c05` |
| S5 | prefetch at import | `99c6607` |
| S5, dialog import | prefetch now starts on the new-event dialog path | `e40db0c` |
| S7 | re-analysis 13.9 → 4.9 s | `e40db0c` |
| S4 | import clock measured | `e40db0c` |
| V1, robustness | baseline re-recorded with the reason (it was measured without OCR) | `e40db0c` |
| V1, local VLM | measured, none useful; relay timeout bug fixed | `394bdda` |
| T4/T5 | E5, E6, E7, E7cal all fail their pre-registered conditions; v2 stays | `c634da3`, `79f4d2e` |

Where the next session starts, in order:

1. **Model (T4/T5).** E7 proved adapting the base lifts sofas (0.777) and
   banquettes (0.578). Benches stay at 0.179: bench peaks also appear where no
   bench is (E7cal). The next experiment changes what the branch can see — the
   table beside the piece — not the schedule, and holds the base harder (E7
   regressed columns 0.855 → 0.791).
2. **D2.** The chair family's admission test should require a mark to look like
   the chairs drawn at the tables (colour). Two stage-truss segments are the
   false chairs. This is a detector change: fingerprint and benchmark gates
   apply.
3. **S1/S2/S3.** ORNEK cold with no gap is still 20.7 s, 12–13 s of it OCR. The
   OCR detection pass is one whole-page inference, and splitting it must be
   proven byte-identical. The longest task sits at 186–265 ms.
4. **Robustness WEAK.** jpeg-q20 and lowres lose chairs only WITH OCR (text
   suppression reads compression noise as printing).
5. **L1/L2/L3.** Causes are known (re-detection on jpeg-q20; too few misses to
   judge exemplar search); unchanged.
6. **D9 entrance.** The drawing shows no readable wall break at either GİRİŞ.
   The label-only extent stands until another drawn cue is found.
7. **N1–N3.** A licensed third real plan, a Windows 8 GB machine, and an
   operator's corrections. None can be produced here.

### The previous record (2026-10-17), kept for its reasoning

Where the next session starts, in order, each with the evidence that set it:

1. **E5, written before it runs**: the seven-class model again, its new heads
   trained longer or at a higher rate, with generation-2 plans kept in the mix
   (E4 lost chair/column recall on generation-2 families and its furniture
   channels stopped at 0.43–0.47). Scored as E4 was; the furniture blind split
   (seed base 10) and blind-2 still unscored.
2. **D4**: the three SEVERE renderings are the colour-dependent tone/accent
   stage (30–39 false tables each); the local model alone is clean on all 16.
3. **S1/S2/S3**: OCR is 12.8 s of ORNEK's 20.1 s cold. The detection pass is one
   whole-page inference on one worker; any split must be proven byte-identical.
4. **L1/L2/L3**: retention losses are objects the re-analysis no longer finds
   (jpeg-q20, blur); exemplar search has only 5 misses to recover on the real
   plans, so it needs a corpus with misses before it can be judged.
5. **R1 groups**: no piece→table link exists; proximity is not evidence, and a
   sofa's facing is not derivable from an axis-aligned box.
6. **N1–N3**: a licensed third real plan, a Windows 8 GB machine, and an
   operator's corrections — none can be produced here.
