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
