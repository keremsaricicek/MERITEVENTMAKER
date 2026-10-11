# Offline plan intelligence: acceptance table

Fixed on 2026-10-11 at commit `276c925`, **before** any result of this
programme was measured. Thresholds are not lowered after a result is seen. If
one turns out to be wrong, it is changed in a separate commit that says why,
and the old value stays in the table, struck through.

Target machine: 8 GB RAM Windows business PC, no discrete GPU, no internet.
Everything below is measured with the network refused (`tests/lib/env.mjs`)
unless a row says otherwise.

## What counts as which kind of evidence

| Set | What it is | What it can prove |
|---|---|---|
| **Regression** | Golden Plan, ORNEK. Every rule in this repo was tuned on them. | That nothing got worse. **Never** a new-venue result. |
| **Cross-venue (LOVO)** | Leave one venue out. A learned model is trained without venue X and scored on venue X. Two venues give two folds. | The best new-venue evidence available today. Two folds, so it is reported per fold, never as one average. |
| **Synthetic held-out** | Generated banquet plans whose symbol styles and layouts were not used in training (split by style family, not by image). | That the pipeline generalises across drawing styles. **Not** real-venue accuracy. |
| **Real blind** | Plans from venues never seen by any rule or model. | The 9.5 claim. **None exist in this repo today.** Until they do, every real-blind row reads NOT MEASURED. |

## Detection: per class, per venue (blind or cross-venue)

| Measure | Threshold | Notes |
|---|---|---|
| Table precision | ≥ 0.98 | Per venue. A phantom table corrupts capacity. |
| Table recall | ≥ 0.95 | Per venue. |
| Chair precision / recall (plans that draw chairs) | ≥ 0.98 / ≥ 0.95 | |
| Venue objects (stage, column, bar, entrance, banquette, loca): recall | ≥ 0.90 per class with ≥ 3 instances | Reported per class; a class with < 3 instances is listed, not scored. |
| Table type accuracy (on matched tables) | ≥ 0.95 | |
| Chair → table link accuracy | ≥ 0.97 | Over matched chairs. |
| Merged-table group: precision / recall | ≥ 0.95 / ≥ 0.95 | Seats per group exact on ≥ 0.95 of matched groups. |
| Printed number: wrong reads | **0** (≤ 0.5 % if > 200 numbers) | A wrong number is worse than an unread one. |
| Printed number: read and verified | ≥ 0.90 of legible numbers | |
| Corrections per 100 objects | ≤ 5 | Misses + phantoms + wrong type + wrong number + wrong link, divided by annotated objects, × 100. |
| Silent decision or record loss | **0** | Any person's decision lost or changed without being shown. |

## Learning

| Measure | Threshold |
|---|---|
| Decision memory: retention on the 7 transformed copies | ≥ 0.98 |
| Decision memory: wrong application | **0** (≤ 0.5 % worst case) |
| Local examples: misses recovered on a plan after 1–3 confirmed exemplars, phantoms added | recovered ≥ 50 % of exemplar-class misses, phantoms added ≤ 1 per 100 objects |
| Model update: regression check before activation, version recorded, rollback restores the previous model | all three, every update |

## Hardware (2 CPU cores, memory capped where the host allows)

| Measure | Threshold |
|---|---|
| Analysis, ORNEK-size plan (166 symbols, OCR on): p50 / p95 | ≤ 30 s / ≤ 60 s |
| Analysis, Golden-size plan: p50 / p95 | ≤ 10 s / ≤ 20 s |
| Model load (cold), each local model | ≤ 5 s |
| Whole browser, peak PSS during analysis | ≤ 2.0 GB |
| UI responsiveness during analysis: longest main-thread task | ≤ 500 ms (input answered within 1 s) |

## Requirement change, 2026-10-11 (later the same day): full analysis ≤ 10 s

Added after the hardware rows above were measured, at the user's request. The
rows above stay as they were, with their measurements; this section adds a
stricter requirement beside them and lowers nothing.

**The requirement.** A full analysis of a supported plan completes in
**≤ 10 s at p95**, cold, on the reference machine, and the page does not freeze
while it runs.

- **Full** means `analysis.timings.analysisCompletedAtMs` is set: detection,
  the local model, OCR, labels, printed numbers, plan memory and the readiness
  checks all done. A first preview, a partial result or "the tables are drawn"
  is not complete and is never reported against this row. While an analysis
  runs, the review screen says it is not complete and takes no decisions.
- **Clock**: from the plan's import completing to the full result (the runner
  presses Analyse at once). Reported COLD (a fresh browser: engines, models and
  caches loaded from nothing) and CACHED (re-analysis of the same plan in the
  same session) separately. The requirement is on COLD.
- **Does not freeze**: no main-thread task over **200 ms**, and a frame asked
  for at any moment during the analysis drawn within **250 ms** (that is what a
  scroll, a zoom or the Stop button waits). Stop ends the engines' work, not
  only the wait for it.
- **Without accuracy loss**: a speed-up that changes what the analysis finds is
  measured against the regression set and is not adopted if anything gets
  worse (`benchmarks/perf/README.md` lists the ones measured and refused).

**Reference machine.** 4 logical cores (measured as `taskset -c 0-3` on an
Intel Xeon @ 2.10 GHz), 8 GB RAM class, no GPU, Chromium. 2 cores are measured
and reported beside it; the 10 s requirement is stated for 4, and the 2-core
rows above keep their own thresholds.

**Supported plan envelope** (both regression plans are inside it, by design):

| Property | Supported | Golden | ORNEK |
|---|---|---|---|
| Pages | one page per analysis (an image, or the one PDF page chosen at import) | 1 | 1 |
| Source size | long side ≤ 2,600 px, ≤ 4.5 megapixels | 1355 × 788 | 2402 × 1719 |
| Tables (annotated) | ≤ 170 | 46 | 166 |
| Printed text lines (OCR model reads) | ≤ 250 | 9 | 231 |
| Drawn chairs (annotated) | ≤ 400 | 113 | 0 (symbolic plan) |

A plan outside the envelope is analysed the same way; its time is reported,
not promised.

**Measured 2026-10-11** (`benchmarks/perf/analysis-profile.mjs`, median of 3,
p95 beside it):

| Plan | Cold (4 cores) | Cached (4 cores) | Longest task | Frame wait max | Cold (2 cores) | Verdict |
|---|--:|--:|--:|--:|--:|---|
| Golden | 7.3 s / 8.0 s | 3.3 s | 535 ms | 44 ms | 9.7 s | time **MET**; freeze **NOT MET** (task > 200 ms) |
| ORNEK | 22.5 s / 22.5 s | 15.0 s | 728 ms | 599 ms | 43.9 s | **NOT MET** |

Before this change the same runner measured Golden 15.7 s and ORNEK 44.5 s
cold, with main-thread tasks of 2.1 s and 4.1 s. Where ORNEK's 22.5 s goes,
and what was tried, is in `benchmarks/perf/README.md`.

**Measured 2026-10-11, later** (same runner and machine), after the page got a
turn inside the stages that still held it: the detector's sources stage, the
chair-facing read, the venue elements, the embedding pass and the last stage.
The analysis output was identical before and after, cold and re-analysed, on
both plans:

| Plan | Cold (4 cores) | Cached | Longest task, cold / cached | Frame wait max | Verdict |
|---|--:|--:|--:|--:|---|
| Golden | 7.3 s / 7.3 s | 3.2 s | **156 ms** (p95 174) / 101 ms | 87 ms (p95 157) | time **MET**; freeze **MET** |
| ORNEK | 21.2 s / 21.7 s | 14.4 s | 215 ms (p95 245) / 273 ms (p95 285) | 159 ms (p95 266) | **NOT MET** (time; tasks of 210–285 ms remain) |

## Offline and failure behaviour

| Measure | Threshold |
|---|---|
| Off-origin requests in the offline package | **0** |
| Network off: analysis, reading, digital view, review all work | yes |
| Model file missing, corrupt or wrong hash | analysis completes on the classical path. The person is told in plain words, nothing is half-applied, and cancel works. |

## Not a 9.5

Meeting every row here does not by itself make the product a 9.5. The
remaining parts are judged on real blind plans:

- the user's work to finish a plan (corrections and minutes);
- hard plans: scans, photos, unusual symbols.

Until such plans exist, the honest headline is the cross-venue result plus
"real blind: NOT MEASURED".
