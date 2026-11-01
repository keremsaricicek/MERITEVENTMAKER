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

## Golden 2 work round 2 (2026-11-01, branch `claude/par-plan`) — SEEN plan

Development measurement: `golden2-score.mjs` over the benchmark runner's dump (source app, OCR
from the pinned cache, trained detector v2 as shipped), annotation `golden2-bench/` (table
centres placed by a model, counts owner-confirmed; not in `benchmarks/annotations`, not in the
baseline). Before any change it reproduces the re-read above: tables 24/27, phantom 0, chairs
seated 51/68, loose 12.

**Correction to the diagnosis above (measured with `MERIT_DETECT_DEBUG`):** the group-C chairs
DO become chair components. The accent-colour mask holds them as whole armchairs (42x45 and 44x47
detection px). On this scan most armchairs break into pieces (the modal colour component is
29 px, 32 of 62), so the whole armchairs (17, side 45) are left to a secondary family, `23:0`, and
that family is refused by the size ceiling: side 45 > 0.75 x surface side 59 (the tables are
57x62). Two of them (T05's, T06's) are also not "seated" (a seat surface must hold 3x the seat's
area; these tables hold 1.8x). Seven real armchairs are lost this way: T04, T05, T06, T17, T22 and
two of T23. The ceiling and the 3x rule are not moved (owner: no threshold is loosened).

**Pre-registered before measuring any other plan (2026-11-01 ~09:30 Istanbul):** attaching the
trained detector's chairs (fusion `addChair`, off since v1: 4 right / 3 wrong on Golden) is
measured again for v2 at 0.5 — the score bar fusion already uses for tables and seating, not a
value searched for. Seen first on Golden 2 only (26/27 tables, 60/68 seated, 9 chairs attached).
It ships only if ALL hold: `benchmark:baseline` no regression on any guarded field of any plan;
Golden (merit-real-venue) chairs FP stays 0 and relations wrong do not rise; ORNEK identical;
adversarial `--compare` 0 blocking and no fixture gains a chair; robustness gate no regression.
Any failure: not shipped, reported as measured.

**Result — NOT shipped (bar failed).** v2 chairs attached at 0.5 (pin-carried setting, code
reverted): Golden 2 (SEEN) tables 24 → 26/27 (T05/T06 now keep a seat and survive text
suppression), seated chairs 51 → 60/68, loose 12 → 12. But on Golden (merit-real-venue) chairs FP
0 → 2 (precision 1 → 0.982; recall 0.956 → 0.991, relations correct 103 → 107) and
adversarial-bistro review groups 0 → 1: `benchmark:baseline` reports 3 regressions, and the bar
said Golden chair FP stays 0. Adversarial/fingerprint not completed (stopped after the failure).
The 0.5 bar is not raised to make it pass (that would be choosing it after the result).

**Fixed — fusion's "off size" asks the table's own kind (item 5).** Where the model and the
classical pass agree on ≥ 5 tables of the same kind (round / rect), a model table is compared
with that kind's median (same ±40 %); otherwise the all-table median as before. Check added to
`local-model` (failed first: a 91 px round beside 90 px rounds and 50 px squares was "off size").
Gates: benchmark + baseline no regression; adversarial 0 blocking; fingerprint 28 of 28
IDENTICAL (recorded on this branch's unchanged code — the committed fingerprint file was stale,
28/28 different before any change). It changes no measured plan today, Golden 2 included
(T24 is already found by the classical pass since the B-6 fix): 24/27, 51/68, 12 loose.

**Fixed — the long table (item 1), B-14b `seatedLongTables` (`src/plan-detection-tables.js`).**
The size gate is not moved. A surface it refused ONLY for its aspect (every other part of
`tableSizeOk` holds, fill ≥ 0.35) is offered back after tables and chairs are known when at least
two seats stand along EACH long side (seat smaller than the surface's short side, within 0.7 of
its own long side, beside the long side's span; a seat already at a table moves only if it stands
closer to this surface). The table is HELD BACK for a person (`lowEvidence: seatedLongSurface`).
Suite `seated-long-table` (failed first; its control — the same surface seated from one side —
stays no table). Gates: benchmark + baseline no regression; adversarial 0 blocking (identical,
a6 improvement already present before); fingerprint 0/28 byte-identical ONLY because the
diagnostics carry the new count — with that one field removed all 28 analyses are identical
(the rule fires on no other plan); detection/structural suites pass (13/13).

| Golden 2 (SEEN) | before round 2 | after B-14b |
|---|---|---|
| tables / 27 | 24 (long 0/1) | **25** (long 1/1, held back for a person) |
| phantom tables | 0 | 0 |
| chairs seated / 68 | 51 | **57** (T23 6/8) |
| loose chairs | 12 | **7** (all 7 are the phantoms: 4 lettering, 3 stage fixtures) |

**Verified (2026-11-01, fresh machine):** B-14b's fingerprint claim reproduced — the 28 plans dumped
on `ad1d27d` and on `05a6edf`, compared with the one new field `seatedLongTables` removed: 28 of 28
identical. The fingerprint store is re-recorded on `05a6edf` (it was stale, see item 5).

**Measured and refused — a seat-family member "seated" only at a surface drawn in the seat colour
(the 7 loose phantoms).** Diagnosis (`MERIT_DETECT_DEBUG` census, detection px): all 7 are members of
ADMITTED secondary families, not primary chairs. 3 are pieces of the rotated capacity lettering
("72 pax seating", "Total : 72 pax", printed in the armchairs' orange), each counted as seated
against the next word of the same lettering (25x63 and 25x48, `fill` source: the word is 1 px
wider than the glyph is long); Tesseract does not read the rotated lines, so the printed-text
exclusion never sees them. 1 is on the GIRIS lettering, seated against the door box (59x73,
interior); 3 are on the stage trusses, seated against the boxes beside them (51x86, 49x78) and the
stage band (135x47). Tried: the tables stage's own MADE OF CHAIR bar (accent covers >= 0.25 of the
box → a chair, not a table), not a new number, asked per member after admission. Suite written
first and failing on the old code (an admitted 12x14 stool family plus two stool-sized marks against
a 25x63 seat-colour bar). Golden 2 (SEEN): loose 7 → 4 (the 3 lettering pieces), but seated chairs
57 → 55 (T11 2 → 1, T14 2 → 1): four real seats in the pushed-together rows are "seated" only
against the whole block of three tables and their armchairs (185x164, 171x68, 179x254, 54x49),
whose box is 0.23–0.49 orange; on the surfaces' own pixels the blocks read 0.49–0.56 and the
lettering words 0.75–0.79. Neither measure separates them at the existing bar, and a new one picked
now would be chosen on a seen result. A trade (phantoms down, real seats down) is a revert: not
shipped; the patch and the suite are kept outside the repository.

**Still open (unchanged):** T05/T06 (their armchairs are the whole-armchair family `23:0`, side 45
> 0.75 × surface side 59 — the ceiling is not loosened, and text suppression deletes the seatless
squares in `app-v8.js`, outside this branch's files); T24/T25 one chair short each (4/5); T04, T09,
T17, T18, T22 one short; the 4 loose phantoms (GIRIS, three truss/stage).
