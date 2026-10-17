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
| D1 | Golden table precision | a phantom table is a seat that does not exist | 0.979 (46/1/0), REG, 2026-10-11 | ≥ 0.98 | detection workstream | `npm run benchmark` | open |
| D2 | Golden chair precision | phantom chairs inflate capacity | 0.973 (108/3/5), REG, `597b0cc` | ≥ 0.98 | detection | `npm run benchmark` | open |
| D3 | squares typed as round on bold-black and pastel drawings | wrong table type; pushed-together rows never join | 47 units mistyped, SYN dev, 2026-10-11 (`benchmarks/relations/README.md`) | type accuracy ≥ 0.95 per family | cause found: the symbol-family promotion typed every member `round`; now typed from its own outline | `benchmarks/detection/diagnose-types.mjs`; suite `symbolic-plan-shape` | **type: 195 → 0 mistyped** on the bold-black/pastel scenes; dev units exact 0.817 → 0.887 (2026-10-17). Chairs on those two families still not found (D12) |
| D12 | solid-square and half-disc chairs not found | the plan is read as symbolic; seats missing | 0 of 169 chairs on `rel-bold-black-7000032`, 0 of 123 on `rel-pastel-arch-7000043` (2026-10-17) | chair recall ≥ 0.95 per family | cause: the table interiors were the reference "seat"; the solid seats were never offered. Rule: a smaller population that SERVES the reference (outside, ≥ 2 per member, on more than one side) becomes the seats; a seat also passes on its oriented box | `diagnose-types.mjs`; suite `served-seats` | **MET on both plans** (2026-10-17): 168/0/1 and 123/0/0 chairs, 29 → 0 false tables; relation dev units exact 427 → 436 / 476; regression plans identical. Cost stated: a table seated on one side only is not recognised by this rule |
| D4 | photometric robustness (JPEG, blur, brightness, contrast, hue, low-res) | the same plan scanned or photographed differently gives a different room | 8 HEALTHY / 3 WEAK / 5 SEVERE; e.g. hue-shift 39 false tables, lowres-roundtrip table recall 0.37 — ROB, `597b0cc` | all HEALTHY; type stability ≥ 0.95 | causes found per rendering (`benchmarks/robustness/README.md`); model-added tables exempt from text suppression; fusion's size reference is the model's own boxes of the tables both witnesses see | `node benchmarks/robustness/run-robustness.mjs` | **NOT MET**, improved (2026-10-17): 8 HEALTHY / 2 ACCEPTABLE / 3 WEAK / 3 SEVERE; bright-down 24 → 43 of 46 tables found (SEVERE → ACCEPTABLE), lowres-roundtrip 17 → 32 (SEVERE → WEAK), mean table F1 over the renderings 0.811 → 0.871, no rendering worse; ORNEK 162 → 166 / 166. Still SEVERE: hue-shift, contrast-high, bright-up — 30–39 false tables from the colour-dependent tone/accent stage. The local model alone is stable on all 16 (43–46 / 46, 0–1 false). A model-arbitrated hold-back was measured and refused |
| D5 | rotated, long, L/T and pushed-together furniture missed or fragmented | groups break; tables to add by hand | relation e2e: member not found dev 25 units, blind 57; duplicate/fragment joined dev 15 — SYN, 2026-10-11 | group P/R ≥ 0.95 | detection + training | `measure-groups-e2e.mjs` | open |
| D6 | box size, not only centre | digital plan and memory depend on the box | v2 model chairs 104/9/9 by centre, 82/31/31 at IoU 0.5 — `597b0cc`; product chair IoU NOT MEASURED | table IoU P10 ≥ 0.6; chair IoU median ≥ 0.6 | detection | run-benchmark box fields; `eval_detector_coco.py` | open |
| D7 | small / faint / partly covered objects | missed tables | ORNEK faint 73–76 found only by the local model (fused 165/1/1), REG, 2026-10-11 | table recall ≥ 0.95 per venue (met on REG) | detection + training | SYN L5–L7 per level | open |
| D8 | classical, model and vector results fused consistently | the same object twice, or two types | suites `local-model`, `plan-number-integrity` green at `597b0cc` | no duplicate, one type, joins numbers/relations/memory/digital | detection | suites + e2e | open |
| D9 | bar and entrance outline accuracy | the digital plan draws them the wrong size | Golden bar shape IoU 0.046, entrance 0.225 (2026-10-10, `latest/report.json`) | ≥ 0.5 | not yet assigned | `plan-understanding/measure.mjs` | open |
| D10 | chair facing coverage | seats without a direction | Golden 0.699 (2026-10-10) | ≥ 0.8 | not yet assigned | `plan-understanding/measure.mjs` | open |
| D11 | ORNEK digital table aspect | drawn tables slightly the wrong shape | P90 log error 0.107 (2026-10-10) | ≤ 0.1 | not yet assigned | `plan-understanding/measure.mjs` | open |

## Training

| id | problem | user impact | baseline | acceptance | fix (owner) | verification | result |
|---|---|---|---|---|---|---|---|
| T1 | v3 regressed on several levels and real plans | no better model to ship | held-out L5 table P 0.97→0.94, Golden chair R 0.920→0.894, +1 false table on ORNEK (2026-10-11) | root cause written with numbers | training workstream | `training/diagnose_fp.py`; `training/README.md` | **MET** (2026-10-17): the precision loss of v3, v4a and v4b is mostly a SECOND PEAK on a table already found — v4b 132 of 148 false tables on val + held-out L4–L7, same class, 147 pairs within a quarter side — while look-alikes FELL (decorations 22 → 14, chairs 8 → 0). A decoder defect shared by every model (3×3 peak pick only); E3 tests the fix |
| T2 | generator gaps (bold-black/pastel squares, L/T, sofas/benches, look-alikes, photometric) | the model never saw the failures above | generation 3 (seven levels) | data covers D3–D7 | training | inspector READY + per-level eval | open |
| T3 | the old blind families were used in development | "blind" numbers are no longer blind | families 14/15 + u-shape scored 2026-10-11 | a NEW blind set, defined before scoring, scored once | training | `training/README.md` | open |
| T4 | a candidate better than v2 everywhere | fewer corrections | v2 active; v3 not packaged | ACCEPTANCE.md activation rows (QA SOUND, no group worse by > 0.005, no new false table on REG, gates) | training → QA → coordinator | `training/compare_candidates.py`; `model-qa-specialist` report | **NOT MET** (2026-10-17): v4a (E1), v4b (E2, and again under the E3 decode) and v5a (E4) each fail their pre-registered conditions — every one adds a false table on ORNEK and loses recall on some generation-2 families. v2 stays active; its own false tables fell with the E3 decode (val 57 → 28, held-out 29 → 10, gen-2 val 16 → 3, no true detection lost). No candidate reached QA, so none was packaged |
| T5 | architecture fixed at four classes | sofas/benches not learned | 4 classes | a measured alternative (5th class or specialist) with CPU/RAM/accuracy cost | training | experiment record | **measured, NOT MET** (2026-10-17): K = 7 (sofa, bench, banquette) trained end to end (E4): +147 parameters, same speed; the new channels peak at 0.43–0.47 after 2,000 steps, recall 0 at the fixed 0.5. The app and packaging are ready for such a model (fusion: seats unknown, never counted) |

## Relations and capacity

| id | problem | user impact | baseline | acceptance | fix (owner) | verification | result |
|---|---|---|---|---|---|---|---|
| R1 | sofas, benches, banquettes in groups | capacity and grouping wrong where they appear | 2026-10-17, 4 trial furniture scenes (`measure-seating-furniture.mjs`): of 83 pieces 1 named, 24 read as tables, 26 cushions read as chairs; seats unknown reported unknown 1 / 38; groups linked 0 / 20 | seats counted twice 0; unknown capacity reported unknown 100 %; groups P/R ≥ 0.95 | furniture scenes + scorer (`synth_relations.py --furniture`); E4: seating classes in the local model; fusion adds a named piece with seats unknown, marks a table on one | `measure-seating-furniture.mjs` on the furniture dev split | open — E4 in training |
| R2 | usage groups end to end | pushed-together rows split | units exact dev 0.817, blind 0.861 (2026-10-11) | ≥ 0.95 | relations + detection | `measure-groups-e2e.mjs` | open |
| R3 | printed vs drawn vs group capacity contradictions | wrong capacity accepted silently | capacity audit exists (U6) | each contradiction named with its objects | relations | suites | open |
| R4 | questions to the person | too many confirmations, or none where needed | NOT MEASURED | one most-useful question per ambiguity; questions per plan reported | relations | e2e | open |

## Learning

| id | problem | user impact | baseline | acceptance | fix (owner) | verification | result |
|---|---|---|---|---|---|---|---|
| L1 | decision memory retention | a person's decision lost after a rescan | 0.8447 (`597b0cc`) | ≥ 0.98 | learning + detection stability (D4) | `npm run benchmark:memory -- --compare` | **NOT MET, unchanged** (re-measured 2026-10-17): 0.8447; the losses stay in jpeg-q20 and blur, where the re-analysis does not find the object again |
| L2 | decision applied to the wrong object | silent corruption | 0.0073 — one decision (t042, grayscale) | 0 (≤ 0.5 % worst case) | learning | same | **NOT MET, unchanged** (2026-10-17): 0.0073, the same single decision; identity precision 0.9927 |
| L3 | find more like this from 1–3 examples | the person draws every missed object by hand | 0 % recovered, up to 9 phantoms / 100 (ORNEK) | ≥ 50 % recovered, ≤ 1 phantom / 100 | learning | `exemplar-measure.mjs` + SYN | open |
| L4 | lessons: source, scope, version, undo, no unchecked spread | a lesson leaking to another venue | suites green at `597b0cc` | verified by suites; wording never says "retrained" | learning | suites, TR/EN | open |

## Speed and responsiveness (Linux container; not a Windows measurement)

| id | problem | user impact | baseline | acceptance | fix (owner) | verification | result |
|---|---|---|---|---|---|---|---|
| S1 | ORNEK full analysis, 4 cores, cold | 21 s wait | 21.2 s (p95 21.7) — 2026-10-11, `d14fc37` | ≤ 10 s | coordinator (OCR first: model detection ~5.7 s, recognition 231 lines ~7.1 s) | `taskset -c 0-3 node benchmarks/perf/analysis-profile.mjs 5` | **NOT MET** (2026-10-17, quiet window): 20.1 s median (worst 21.9); OCR model 12.8 s of it. Golden 6.9 s |
| S2 | ORNEK longest main-thread task | the page stutters | 215 ms (p95 245) cold, 273 ms warm — `d14fc37` | ≤ 200 ms | coordinator | same runner | **NOT MET, at the line** (2026-10-17): 202 ms median cold (worst 249), 187 ms warm (worst 205); Golden 152 / 100 ms |
| S3 | 2 cores | slower office PCs | ORNEK 43.9 s, Golden 9.7 s (one run, 2026-10-11) | ≤ 30 s / ≤ 10 s p50 (hardware rows) | coordinator | `taskset -c 0,1 …` | **NOT MET** (2026-10-17, 5 runs): ORNEK 41.6 s, Golden 10.3 s |
| S4 | import→usable and Analyse→complete reported apart | — | not reported apart | both clocks, cold/warm, 4/2 cores, ≥ 5 runs | coordinator | runner | **half** (2026-10-17): Analyse→complete cold/warm, 4 and 2 cores, 5 runs each, raw logs kept; import→usable NOT MEASURED (the runner has no such clock) |
| S5 | Stop ends the engines; stale answers never overwrite | lost decisions on cancel | suites `analysis-workers`, `analysis-cancel` green | stays green after every speed change | coordinator | suites | open |
| S6 | ORNEK analysis inside the plan-understanding contract | — | 66.4 s against ≤ 60 s (2026-10-10, before the speed work) | ≤ 60 s | — | re-measure | open (stale number) |

## Vision-language model, tools, data

| id | problem | user impact | baseline | acceptance | fix | verification | result |
|---|---|---|---|---|---|---|---|
| V1 | local VLM compared on plan tasks | no free-text reading of notes | NOT MEASURED: weights refused by the session's network policy (`huggingface.co`, `cdn-lfs.hf.co`, `cas-bridge.xethub.hf.co` answer 403 to CONNECT; re-checked 2026-10-12) | two candidates compared | BLOCKED — the account owner allows those hosts in the environment's network settings | `LOCAL-VLM.md` | BLOCKED |
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
- `benchmarks/robustness/BASELINE.json` was recorded at `b8153d7` (2026-08-31),
  before this programme. `run-robustness.mjs` prints eight rows "WORSE than the
  recorded robustness baseline" (chair F1 on jpeg-q20, lowres-roundtrip,
  bright-down and others) and exits 1. Those rows were already there at
  `597b0cc`: the per-rendering numbers measured on 2026-10-17 are identical to
  the committed `report.json` at `3d89abe`, rendering by rendering. It is not a
  CI gate. It is not re-recorded here: re-recording a baseline is a decision with
  a written reason, and the reason for these eight rows (when they first
  appeared, and whether they are the OCR-on/off line of §27) is not yet
  established.

## Continuation record (2026-10-17, end of session)

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
