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
