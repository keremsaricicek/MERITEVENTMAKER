# PP-OCRv4 (in the product) against PP-OCRv5 mobile — measured, v4 kept

`node benchmarks/ocr/compare-ppocr.mjs` runs the same app, detector and OCR code
path with each model. The swap goes through `MERIT_PPOCR_EXPERIMENT`, which is
benchmark-only: the product never sets it, the offline build ignores it, and
its own sha256 and size pins still refuse a mismatch. The v5 files come from
`pdfmarkdown-ppocrv5-models@1.0.0` on npm (Apache-2.0), checked against the
published integrity `sha512-BDxXJ0k2…ysdyg==`. Results are in
`compare-latest.json`.

## Measured 2026-10-10

| | PP-OCRv4 (product) | PP-OCRv5 mobile |
|---|---|---|
| ORNEK table numbers, of 157 legible: right / wrong / not read | **145 / 0 / 12** | 120 / 0 / 37 |
| ORNEK words outside the numbers | 26, "SILA29.08.2026" (no space) | read well, "SILA 29.08.2026" — but the circle outlines around numbers come back as "$" ("$10", "$12$") |
| Golden: words read, and what they meant | 9 / 9 | 9 / 9 (identical) |
| time, ORNEK analysis | 48 s | 49 s |

**Decision: keep v4.** v5 loses 25 table numbers on the plan type that
depends on them most, and gains nothing on the drawn-chair plan. It is
rejected by this experiment (TOOLS.md T3), not by its reputation.

**One lesson kept for next time.** The package's dictionary starts with a
placeholder line: the model's output index i is dictionary line i, not i−1. Read
naively, every character came back one place early ("GIRIS" read "FHQHR").
That was found from the output, not assumed, and is fixed in the script.

**Not tried.** v5 with its own detector preprocessing; this run uses the v4
pipeline's normalisation. Re-run this script when a new OCR release or new
venues arrive.
