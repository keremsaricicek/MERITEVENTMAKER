# What kind of drawing is this?

Two real supplied plans, two different languages for saying the same thing.

| | merit-real-venue | ornek-symbolic |
|---|---|---|
| tables | shapes with a real footprint | identical numbered circles |
| chairs | **113, drawn individually** | **none drawn at all** |
| capacity | countable by counting seats | **printed as a rule**: `166 * 12 : 1992 PAX` |

The detector was built on the first, and silently assumed the second could not
exist.

## What went wrong, measured

Its chair-first path reasons about **size rank**: many small repeated round
things surrounding a few larger shapes means the small ones are chairs and the
large ones are tables. That is a good rule on a plan that draws furniture, and
it is why this pipeline works on the Golden Plan.

On a symbolic plan it inverts completely, because every object is the same size
and nothing is larger. The first held-out run
(`benchmarks/heldout/ORNEK-FIRST-RUN.md`):

```
TABLES   gt=166  det=10  TP=0  FP=10  FN=166   P=0  R=0  F1=0
CHAIRS   annotated=0     detected=143
```

and, from `ornek-diagnose.mjs`, what those numbers were hiding:

- the detector **found 132 of the 166 tables**, centred to 3px median, at the
  right size — and classified every one of them as a chair
- the 10 objects it returned as tables were, ten for ten, the plan's
  architecture: five LOCA strip cells, the title box, a pillar, both SYSTEM
  KONTROL arrows and the central column

It was never a detection failure. It was a naming failure, and the naming was
downstream of one unexamined assumption.

## The evidence used, and why it needs no special knowledge

**The chair-first path's own failure to associate.**

If a plan really draws chairs, those chairs sit at tables — that is what makes
them chairs. So the fraction of "chairs" that found a table is a direct test of
the chair hypothesis. It knows nothing about circles, numbers, PDFs, venues or
filenames, which is exactly why it can be trusted to generalise further than
the two plans it was measured on.

| plan | repeated objects | at a table | rate |
|---|---|---|---|
| adversarial-architecture | 80 | 80 | 1.000 |
| adversarial-bistro | 72 | 72 | 1.000 |
| adversarial-text | 73 | 73 | 1.000 |
| adversarial-dense | 80 | 76 | 0.950 |
| merit-real-venue | 112 | 108 | 0.964 |
| **ornek-symbolic** | 143 | 11 | **0.077** |

Every plan that draws chairs is at or above 0.95. The one that does not is at
0.077. **Nothing lands in between.**

The thresholds in `src/plan-representation.js` are therefore not doing fine
work and are not tuned to either plan — they sit in the middle of a twelvefold
gap:

```
PHYSICAL   association >= 0.70
SYMBOLIC   association <= 0.25, at least 20 loose objects,
           and the loose objects outnumbering the "tables" 2:1
UNKNOWN    no uniform family, or fewer than 20 objects
NEEDS_REVIEW   anything else — reported, never forced into an answer
```

The ratio guard exists so that a lounge with 60 real tables and 70 chairs
scattered off them is not flipped and its 60 tables thrown away.

## What SYMBOLIC changes

The symbols **are** the tables. They are promoted; what size rank called tables
is demoted, because on a plan whose tables are one uniform symbol, an object
that is not a member of that family is not a table. Both counts are reported in
diagnostics (`representationSwap`), because a swap this large has to be visible
rather than inferred from a changed number.

No seat count is asserted. The drawing shows no seats, so a `0` would read as
"measured none" when the truth is "this drawing does not say, by drawing".
That honesty runs all the way to the surface:

- `fact.seats` is replaced by `fact.symbolicPlan`, and `fact.unseatedTables`
  is suppressed — on this plan every table is unseated by design, and reporting
  it as a finding turns the drawing's own convention into 132 anomalies
- the status pill shows "132 tables drawn as symbols (no seats on this plan)"
  instead of a bold **0 seats**
- an object's card reads "seats not shown on this plan", not "0 seats"

What the room really holds is printed on the sheet. Reading that is a separate
job from counting shapes, and it is not done yet.

## Result

| | before | after |
|---|---|---|
| ORNEK tables P / R / F1 | 0 / 0 / 0 | **1.000 / 0.795 / 0.886** |
| ORNEK invented chairs | 143 | **0** |
| ORNEK architecture called a table | 9 | **0** |
| merit-real-venue, every guarded field | — | **unchanged** |
| 4 adversarial fixtures | — | **unchanged** (0 regressions) |

The 34 tables still missed are a detection-layer weakness, not a naming one:
all 9 dark-filled tables (the pipeline looks for light discs with dark rims and
these are the tonal inverse), the faint row 73–76, and a band in the
photograph's fold. Fixing every one of them would have moved table recall from
0 to 0 before this change.

## What this does not show

**REAL DISTINCT VENUE PLANS: 2. CROSS-VENUE GENERALIZATION: NOT VERIFIED.**

Two documents is not a distribution. The separation above is real and it is
wide, but it is six data points, four of which are synthetic fixtures built by
this repository. A rule that works on both real plans is a rule demonstrated
twice, and nothing more is claimed.
