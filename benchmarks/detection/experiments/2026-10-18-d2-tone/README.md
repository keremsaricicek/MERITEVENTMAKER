# D2 tone experiment (2026-10-18) — measured, NOT shipped

Golden's three false chairs are seat-sized patches of bare paper: the triangles
between the struts of the two stage trusses (1138, 707) and (678, 706), and the
gap between t040's chair and the bar drawn against it (1310, 572). All three are
outline-interior members of SECONDARY seat families, admitted on adjacency to a
"table surface" (a grey box / the truss), and all three read d = 0 (paper level
minus the median gray of their own pixels), against d 44-167 for every true
filled member (7-13 on the brightened renderings).

`PREREG.md` is the full record, in order: R-D2 (withdrawn before running — it
would have deleted a9's 24 real terrace seats), R-D2c (surface fill, refused: no
separation), R-D2t (pixel paper share — failed: a4's 24 turned chairs, tone
drift on bright-up / contrast-high), R-D2s (median tone, sub-family floor), and
R-D2s+ (refused patches also leave the table pool; the column pass refuses
bare-paper candidates).

`r-d2s-plus.patch` is the last version (against `4717d67`). Its result,
`fingerprint-diff-r-d2s-plus.txt` (HEAD vs patch, 28 plans):

- Golden: chairs 108/3/5 -> **108/0/5**; 14 renderings lose 1-3 false chairs.
- Columns: a2 32 -> 14, a4 40 -> 17 (both fixtures have NO columns);
  adversarial-architecture keeps its six.
- **lowres-roundtrip: tables 39 -> 32, columns 4 -> 22.** The 13x13 plant
  icons at the centre of each square table become a column family once the
  paper patches no longer dilute it, and the local model cannot add a table
  where the classical pass proposed a column. 7 true tables lost.

Not shipped. What it established: the chair rule is right in isolation; the
COLUMN PASS is the coupling point. Its two-axis grid test tips on one member
(bright-down 8 -> 25 columns from a single patch turning "seatless"; lowres
4 -> 22 from removing members). The next step is a column pass that is stable
under one member's removal (and never takes a mark standing inside a table's
own box), measured on all 28 plans, BEFORE the chair rule is re-applied.

## Shipped after the column pass was made stable (2026-10-18, second session)

The column pass now (a) refuses a mark that stands inside an object the size of
the plan's tables, (b) admits a family only if it still passes with any ONE
member removed, and (c) drops a member aligned with no other member on either
axis (`tests/suites/column-pass-stability.test.mjs`, red on the old pass). The
column fix alone changed only columns, on 4 renderings, all downward, and no
table or chair anywhere (24 of 28 plans identical); adversarial-architecture
keeps its six real columns.

R-D2s's chair parts were then re-applied (refused patches leave the table pool;
the column-pass bare-paper clause was NOT needed and is not shipped). Measured
with the pinned OCR, every runner:

- Golden: chairs 108/3/5 -> **108/0/5**; tables 46/1/0 unchanged.
- Robustness, no rendering loses a true table: bright-up table FP 2 -> 0,
  contrast-high 2 -> 1; chair FP falls by 1-3 on 14 renderings.
- lowres-roundtrip chair TP 75 -> 74: the removed detection is the t040
  fragment itself (1310, 572), bare paper, d 0. On that rendering c102 — the
  real chair beside it — is not detected, so the fragment had been matched to
  c102 at the 47 px tolerance. No real chair's own pixels were removed; the
  lost "TP" was the false fragment standing in for a missed chair.
- Adversarial: every fixture's detection identical; the gate passes.
