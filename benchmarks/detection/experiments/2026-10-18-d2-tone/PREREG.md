# D2 — Golden false chairs, pre-registration (2026-10-18, written before any code change)

## Measured cause (golden-census.json, real app, pinned OCR, MERIT_DETECT_DEBUG)

Golden: 108 TP / 3 FP / 5 FN chairs (tol 47 px).

| FP (image px) | box | how it reaches the output | family | source |
|---|---|---|---|---|
| (1138, 707) | 19 × 22 | standalone venue chair (no table) | family:18:1 | outline-interior — the white triangle enclosed by two blue truss struts |
| (678, 706) | 20 × 20 | standalone venue chair (no table) | family:18:0 | outline-interior — same, the other truss |
| (1310, 572) | 21 × 20 | seat of t040 | family:18:0 | outline-interior — fragment between c102 and the diagonal bar |

Both truss FPs are members of SECONDARY seat families. Those families were
admitted because most of their members sit against a table surface; each truss
triangle "sat" against the truss hub or the riser, which never became a table.
The two are the ONLY standalone chairs on Golden.

## Hypothesis

A member of a separately admitted (secondary) seat family carries no seat
evidence of its own: the family's evidence is "most members sit at a table".
When the association gives such a member to NO table, the evidence that made it
a seat is absent for it. Primary-family standalone chairs are a different case
(the plan's own seat vocabulary, which may stand in a lounge) and are untouched.

## Rule (R-D2)

In B-14 (`containedSeatsAndUnseatedChairs`), a third exit beside association and
text run: an unassociated chair whose `chairFamily` is not primary does not
become a standalone chair. It is counted and boxed in diagnostics
(`secondaryUnseated`), as the text-run exit is.

The representation verdict keeps its input unchanged (it is computed on the
standalone count BEFORE this exit), so no plan's verdict can move because of it.

## Acceptance (every row must hold; otherwise revert and record)

1. Golden: chair FP 3 → ≤ 1 with TP unchanged at 108 (precision ≥ 0.98).
2. `benchmark:baseline`: no guarded field worse on any plan.
3. Robustness renderings: no rendering's chair recall lower by > 0.01; no
   verdict worse.
4. `detector-fingerprint --compare`: every plan that changes is listed, and
   every removed chair is checked against its annotation where one exists. A
   removed TRUE chair anywhere is a fail unless the same plan loses more false
   ones AND no guarded field regresses — reported either way.
5. Suites green: chair-families, symbolic-plan-detection, served-seats,
   plan-detection-boundary, the full suite at the end.

Not attempted: the t040 fragment (FP 3). It is a seat-sized piece of a real
chair's outline joined to a drawn bar; no rule found that is not about this one
spot. It stays named in the gap matrix.

## R-D2 WITHDRAWN before implementation (2026-10-18)

Reading `suppressTextFalsePositives` (src/app-v8.js) before writing code: on
`a9-mixed-representation` the terrace's 24 real chairs are exactly this case —
standalone members of a secondary family whose tables were not detected
(`keptDrawnSeats: 24`). R-D2 would delete all 24. Acceptance row 4 would have
failed it; it is withdrawn without being run.

## R-D2c (next hypothesis, to be measured before it is pre-registered as a rule)

The truss triangles were "seated" by `seatSurfaceFor`, which tests the surface's
BOUNDING BOX (min side > the chair's long side, area >= 3x). A diagonal truss
strut or the whole truss network has a large, square box and very little ink in
it. A table is a compact solid: its drawn region fills a large part of its box
(disc 0.785, square 1.0, a square turned 45 degrees 0.5). Measure first: the
surface each truss triangle was seated at, and its fill; the fill of every
surface that seats a TRUE chair on Golden, a9 and the robustness renderings.
Only if the two populations separate with margin is a rule written.

## R-D2c measured and REFUSED (no rule written)

Surface fill of the surface each seated member stands at (sup-merit-real-venue):
truss triangles 0.556 and 0.592; true chairs' surfaces 0.455, 0.608, 0.759+.
No separation.

## R-D2t — pre-registered 2026-10-18, before the rule is run

Measured (tone-golden.json, worktree debug only): the interior of each admitted
secondary-family member, share of its own pixels at paper tone:

- every TRUE outline-interior chair on Golden: paper share 0.000–0.008, mean
  gray 208–211 (the tan crescent fill); colour-cluster members 0 (orange)
- the two truss triangles: paper share 1.0, gray 255
- the t040 fragment (FP 3): paper share 1.0, gray 255

Physical statement: a seat family is ONE drawn object repeated. Where the
family's members are drawn filled, a seat-sized patch of bare paper enclosed by
other ink is a gap between objects (between a chair and a bar, between truss
struts), not a seat. Where the family is drawn as bare outlines (ink plans), all
members are paper and nothing changes.

Rule: in an ADMITTED SECONDARY family with at least 4 members, a member whose
paper share (pixels with gray >= paper - 12, paper = the plan's 98th-percentile
gray) differs from the family's median paper share by more than 0.5 is not one
of its seats. The primary family is not touched.

Acceptance (all):
1. Golden chairs: FP 3 -> <= 1, TP 108 unchanged.
2. benchmark:baseline: no guarded field worse on any plan.
3. Robustness: no rendering's chair recall lower by > 0.01; no triage worse.
4. Adversarial gate and false-positives renderings: no new FAIL.
5. detector-fingerprint: every changed plan listed; every removed chair checked
   against truth where truth exists; a removed TRUE chair is a fail.
6. Suites: chair-families, symbolic-plan-detection, served-seats,
   plan-detection-boundary, chair-facing; full suite before commit.

## R-D2t RESULT: FAILS acceptance row 5 — not shipped

Golden: chairs 108/3/5 -> 108/0/5 (as predicted). But the fingerprint dumps
(HEAD vs rule, the two new diagnostic fields ignored): 13 of 28 identical, and
- a4-multi-room: 24 TRUE chairs removed (c038, c040, c042, c046, c050, c094,
  c098, ... — the chairs drawn at 45 degrees). a4's chairs are all one style
  (square outline, green backrest, paper interior); anti-aliased edge pixels
  inside a turned chair's interior pull its paper share under 0.5, while the
  family median is 1.
- bright-up, contrast-high: family paper medians 0.48-0.72; the 98th-percentile
  paper minus 12 does not separate the tan fill from paper after the tone
  change, and real bistro/crescent chairs are refused (2 and 6 seats).
The measure, not only the threshold, is wrong: a pixel share is sensitive to
anti-aliasing and to photometric change. Next: the MEDIAN gray of the member's
own pixels against paper, measured on all 28 plans before any rule is written.

## Measurement before R-D2s (tone-all.json, 28 plans, worktree debug)

Per admitted secondary family member: d = paper level - median gray of the
member's own pixels (median, not pixel share: robust to anti-aliased edges).
- Every member at d <= 3, in a family that also holds filled members, is one of
  the three known spots (truss left, truss right, t040 fragment) in every
  rendering where it survives detection, plus thin paper strips beside chairs
  on lowres / downscale / rotate (25x12, 12x20, 27x16 boxes).
- True filled members: d >= 7 (bright-up 7-11, contrast-high 8-13, otherwise
  33-167).
- a4: 32 true paper chairs (d 0) and 24 true filled ones (d 167) in ONE family;
  a7: all paper; a3/a9: all filled. Two tones of one size can both be real.
- A ratio to the family median refuses c111 on contrast-high (d 10 in a family
  whose median is 102 because it also holds orange bistro chairs) — refused.

## R-D2s — pre-registered 2026-10-18, before running it

A member is BARE PAPER when d <= 5 (the bound sits in the measured gap: false
members <= 3, true filled >= 7; stated as such, not tuned after). In an admitted
secondary family, when the bare-paper members are fewer than the family floor
(4) and the other members are at least 4, the bare-paper members are refused:
they could not have been admitted as a family of their own, and the family they
were admitted with is drawn filled. Families that are all paper, all filled, or
whose paper group can stand on its own (a4) are untouched.

Acceptance: same rows 1-6 as R-D2t. Expected: Golden 108/0/5; a4, a7, a3, a9
identical; renderings lose only members at the three known spots or paper
strips, each checked against truth.

## R-D2s RESULT (first run): FAILS rows 3/5 — side effects found, not shipped as is

Golden 108/0/5 and 14 renderings lose 1-3 false chairs; a4/a7/a3/a9 identical.
But: bright-down loses true table t036 and the column pass goes from 8 to 25
columns; lowres-roundtrip loses one true chair (a 25x12 strip matched to c018 /
c047 at tolerance). Mechanism (measured): a refused patch is no longer an
unclaimed seat, so a neighbouring bare-paper truss region (1157,721; d 0) turns
"seatless", joins a column size family and tips its two-axis grid share; eight
orange chairs (d 86) and t036's interior (d 74) then pass as columns, and the
local model cannot add t036 where the classical pass proposed a column.

## R-D2s+ (added 2026-10-18 after that measurement; stated as such)

1. A refused patch leaves the table pool exactly as seats do (it was claimed
   as a seat-family member; it is not a table candidate either).
2. The column pass refuses a bare-paper candidate (median of the inner box
   <= 5 under paper): the only annotated columns (adversarial-architecture,
   six) read d 61; structure is drawn solid.
Measured on bright-down before the full run: tables 43/4/3 (= HEAD), chairs
90/0/23 (FP 3 -> 0), columns 8 (= HEAD).
Acceptance unchanged (rows 1-6), plus: columns on every plan equal to HEAD or
fewer, and adversarial-architecture keeps its six.
