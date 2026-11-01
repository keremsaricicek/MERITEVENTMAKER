# Blind plans (never trained on, never tuned on)

## golden2.pdf — the third real plan ("Golden 2", owner, 2026-10-31)

- Source: the owner's own scan (one A4 page, Epson Scan 2, scanned 2026-10-29), sent in
  the session on 2026-10-31; named "Golden 2" by the owner. sha256
  `f8500be7c673ff58465e0f84d4a2a78ea1177637eabfceaa7af12df0c1aa3c1e`.
- **Frozen as the final blind exam.** Committed before anyone looked at its content.
  Until the exam it is not opened for development: no training example, no detector or
  threshold change, no generator change is made from it.
- **The exam (owner: "after everything, one complete exam on it"):** after the last
  model and code of this round are fixed, (1) its ground truth is written — tables
  (number, kind), chairs per table, seat capacity — and the owner confirms the counts;
  (2) the product reads it ONCE, as shipped (classical detection + the trained detector +
  the wired local model's second look and what it applies by itself), and the result is
  scored against that truth: tables found / missed / phantom, chairs per table, seat
  count, grouping, what a person would still have to fix; (3) the result is reported as
  measured, the first unseen-venue score. Only after that may it become training data.

## Golden 2 — exam result (2026-10-31, read once by the product as shipped)

Raw: `benchmarks/offline-intelligence/golden2-exam/result.json`, screenshot `after.png`. Shipped
offline package (`dist/merit-offline`, OCR included), classical detection + trained detector,
the wired local model (runB6d) on its second look. This 4-core cloud CPU, no GPU, trainer paused.

| | truth (hand count) | product | |
|---|---|---|---|
| tables | 27 (4 round, 22 square, 1 long) | **23** (3 round, 20 square, 0 long) | 85 % found, 0 phantom tables seen |
| chairs seated at their table | 68 | **49** | 72 % |
| chairs found but not tied to a table | – | 20 | a person ties them |
| banquettes | 3 | 2 | |
| dining groups | 14 | 11 | |
| left for a person | – | 6 decisions + 2 questions | |
| time to the plan on screen | – | **17 s** | second look: nothing to ask, 0 s |

Missed: one round table of the two by the entrance (and its 5 chairs), the long 8-seat table
(its chairs found as loose chairs), two square tables. The second look did not start: the
analysis left no grouping in doubt, and the wired model is measured only on grouping.
**First attempt:** the exam script waited for a second look that never started and timed out
after 58 min without recording a result (harness fault; fixed to stop when none starts). The
reading above is the first one that was recorded. Golden 2 is now SEEN.

## Golden 2 — where each miss was lost (diagnosis, 2026-11-01) — a SEEN plan from here on

Measured, not guessed: the real app's analysis on the embedded scan with every stage exposed
(classical candidates straight out of `provider.detect`, the trained detector's raw read, fusion's
output, Tesseract's words, `MERIT_STAGE_CENSUS`, plus a one-off census of the ranked tables). The
trained detector is v2, as shipped; it read 98 objects. Truth centres: `golden2-table-centres.json`.

| object | trained detector raw | classical | lost at | rule |
|---|---|---|---|---|
| T24 round (top left) | table_round 0.97, 92x91 | the ring's interior 91x92 in the pool; a TONE piece 87x67 of it (uneven scan fill) seeded first | table pool de-dup (B-6), then fragment filter (B-11); fusion refused the model's table | de-dup prefers the tone source, the whole disc was dropped as the piece's duplicate; the piece had 3 fragment reasons (size 0.08, aspect 1.32, no counted seats); fusion: short side 91 > 1.4 x median 62.6 ("off size") |
| T25 round (top right) | table_round 0.97, 87x86 | interior 91x92; tone pieces 34x22 / 29x26 | same de-dup and fragment filter | found only because fusion ADDED the model's table (86 within the size band) — with 0 chairs: model chairs are never attached and the classical chairs had already been left loose |
| T05, T06 (banquette group C) | table_rect 0.94 each | found, chosen, 0 chairs (their two chairs, touching the table edge, never became chair components) | text suppression (app) | Tesseract read the two side-by-side squares as the word "oo" (confidence 52); overlap > 0.4 and no chairs → deleted |
| T23 long table (8 armchairs) | no table at all (7 chairs) | table surface 68x247 (interior and tone, fill 0.93) | source size gate | `tableSizeOk` aspect >= 0.28: 68/247 = 0.275. Admitted, it would still meet the off-modal (area 4.8 x modal) and fragment rules (size, aspect 3.6 vs plan 1.09, seats not counted below size agreement 0.25) |
| 20 loose chairs | – | – | – | 8 = the two top rounds' chairs (4 each seen), 5 = the long table's (1 more deleted by text), 7 are not chairs (4 on the printed lettering at the lower left, 3 on the stage's blue fixtures) |

**Fixed (one cause, `src/plan-detection-tables.js`, B-6):** a tone box lying inside an enclosed
interior that it fills less than half of is a partial read of that surface; the interior stands
for it. Suite `table-partial-surface-read` (fails on the old code: a 65x44 "rectangle").
Gates, against the same build without the change: `benchmark` + `benchmark:baseline` no
regression (Golden 46/1/0 tables, 108/0/5 chairs, relations 103/1; ORNEK 166/1/0 — identical);
`benchmark:adversarial --compare` 0 blocking (identical); `detector-fingerprint` 23 of 28 plans
byte-identical — ORNEK the same 187 objects in another order, four robustness renderings changed;
robustness, old → new: jpeg-q20 tables 34/8/12 → 46/1/0 and chairs 94 → 106; lowres-roundtrip
32/7/14 → 40/3/6, chairs 91 → 101; bright-down table FP 4 → 3, relations 47 → 58 correct;
blur tables and chairs equal, relations correct 64 → 61 (wrong 0 → 0); every other rendering
equal; robustness gate "no regressions".

**Measured and refused:** letting a classical table the trained detector also sees at >= 0.7 escape
text suppression (it would have kept T05/T06). On `a2-mixed-families` it kept two PHANTOM round
tables offered at 0.72 (table F1 0.667 → 0.632; with held-back tables included, 4 real ones only
as held back). A wrong confident answer is worse than a miss: not shipped.

**Not done:** the long table (two classical gates + the model not seeing it), the group-C chairs
that touch their tables, the top rounds' two unseen chairs each, the 7 phantom loose chairs.
Note: the crop of the top rounds shows 6 chairs each, the centres file says 5 (positions and
per-table chairs there are not human-verified).

### Re-read of Golden 2 by the shipped offline package — SEEN PLAN, not an unseen-venue score

Same harness as the exam (`golden2-exam.mjs --root dist/merit-offline`, runB6d), after the fix
above; raw `../../offline-intelligence/golden2-exam/reread-2026-11-01.json`, screenshot
`reread-2026-11-01.png`. Golden 2 was used to find this cause, so this row is not evidence about
an unseen venue.

| | exam (2026-10-31, unseen) | re-read (2026-11-01, SEEN) |
|---|---|---|
| tables found / 27 | 23 (round 3/4, square 20/22, long 0/1) | **24** (round 4/4, square 20/22, long 0/1) |
| phantom tables | 0 | 0 |
| chairs tied to the right table / 68 | 43 | **51** |
| chairs on tables / loose | 49 / 20 | 57 / 12 |
| still missed | T05, T06, T23, T24 | T05, T06, T23 |
| analysis time | 17 s | 20 s (busy shared CPU) |
