# Annotating the real plans

```
node benchmarks/annotate/build-real-annotation.mjs --overlay /tmp/check.png
node benchmarks/annotate/build-real-annotation.mjs --write
node benchmarks/annotate/crop.mjs 40 380 170 140 4 /tmp/zoom.png   # inspect a region
```

Writes `benchmarks/annotations/merit-real-venue.json`.

## The rule this tool exists under

**It shares nothing with the detector it produces truth for.** Not a helper,
not a threshold, not an idea. An annotation built with the reasoning of the
thing under test scores that thing against its own opinion, and every number
downstream becomes self-congratulation.

So the rules here are deliberately crude and specific to this one drawing:
literal ink colours read off its own palette, fixed pixel size bands, declared
text regions written down by hand. No modal reasoning, no adaptive thresholds,
nothing that adjusts itself to what it finds.

**The output is not trusted because the code ran.** It is trusted because
`--overlay` draws every extracted object back onto the plan, numbered by class,
and a person compared it against the drawing region by region. Anything that
comparison could not settle is recorded as unverified rather than guessed.

## What the plan contains

| | count | how |
|---|---|---|
| square tables | 37 | tan components, 40–50px, fill > 0.84 |
| round tables | 4 | tan discs, ~68px, fill near π/4 |
| bistro tables | 5 | tan components, 30–39px |
| orange armchairs | 79 | saturated orange components, 25–48px |
| orange bistro chairs | 10 | saturated orange components, 11–24px |
| pale outlined chairs | 24 | angular clustering, see below |
| banquettes | 3 | orange components taller than 90px |
| stage + dais | 2 | steel-blue components |

**113 individually located chairs.** This supersedes the earlier figure of 105,
which was a count from zoomed crops with no positions and did not separate the
bistro chairs from the armchairs.

The drawing's own arithmetic now closes against spatial truth: 79 armchairs +
24 pale chairs = 103 seated at tables, plus the three banquettes' undivided
capacity, against a printed "114 pax seating"; and the 10 bistro chairs are
exactly the printed "10 pax bistro". The residual — 11 seats across 3
banquettes — is precisely the number the drawing does not divide into seat
positions, and is recorded as `capacity.unverified` rather than assigned.

## The pale chairs, and why they are the hard case

They are crescents drawn in the same tan as their table, overlapping its edge.
Sampled along rings from a table centre, one is a grey outline (luma 140–180)
around a very pale fill (215,206,187 and lighter), and roughly a third of the
annulus at chair radius is plain white.

A colour test catches slivers of one chair and misses the next — the first
attempt produced 26 boxes for 24 chairs, each clipped to whatever fragment
happened to pass. So the annulus test is simply **not background**: everything
between the disc and 1.65 radii that is not white *is* the ring of chairs,
because nothing else is drawn there. Grouping those pixels by angle separates
six runs cleanly at 60° apart.

That angle is also the chair's facing — every crescent opens toward the table
centre. It is measured, not assumed, which is why these 24 chairs carry
`orientationKnown: true` and `rotation`, and the orange chairs do not.

### Corrected 2026-10-18: two of the angular clusters were wrong

A rendered review during D10 (chair facing) showed it. Around **t038** the
right, lower-right and lower chairs had come out as TWO boxes 91 px wide whose
centres lie inside the table (`c090`, `c094`); around **t040** the one
right-hand chair had come out as two half-boxes (`c101`, `c107`). The count, 24,
was right by coincidence: one missing at t038, one extra at t040.

```
python3 benchmarks/annotate/round-table-chairs.py benchmarks/plans/merit-real-venue-plan.png \
    benchmarks/annotations/merit-real-venue.json /tmp/round-chairs.json /tmp/round-chairs.png
```

measures every pale chair as a separate connected component instead. It works
in the ring from 3 to 28 px outside each disc's DRAWN edge (the darkest circle
near the annotated radius), keeps ink that is neither paper nor near-black,
and drops straight runs of 45 px or more inside the ring as walls. A chair
abuts its table and is separated from its neighbours by paper. On the 20
chairs the first tool got right, it agrees at IoU 0.66–0.85: its boxes cover
only the visible part, and the first tool's reached a few pixels into the disc.
One chair of t040 touches a drawn diagonal bar of the same grey and comes out
merged; its existing box (`c102`) is right and is kept.

Applied, after checking each box by eye on its review image
(`golden-round-chairs-review.jpg`: green the new boxes, red the boxes held before):
- `c094` is t038's right chair and `c090` its lower-right one, both
  re-measured.
- `c114` is new: t038's lower chair.
- `c101` is removed; `c107` already held t040's right chair whole.

Each re-measured object says so in `boxSource`. The count stays 113
(24 pale, six per round table). The truth facings in
`plan-understanding/truth/merit-real-venue.json` follow. The robustness
variants were regenerated from the corrected file
(`benchmarks/robustness/make-variants.mjs`; images byte-identical). They had
been made before the relationships grew from 24 to 113, and now carry all 113.

## What is deliberately NOT annotated

- **Columns.** Nothing on this drawing is confidently identifiable as a column
  as opposed to a wall pier or a niche. A column benchmark built on a guess
  would measure the guess. (The `column 0/6` figure elsewhere in this
  repository is from the synthetic architecture fixture, which has columns by
  construction — not from this plan.)
- **Banquette seat counts.** The drawing does not divide them.
- **Orange chair orientation.** The armchair symbol is close to symmetric at
  this resolution; `orientationKnown` is false rather than invented.


---

# Real plan #2 — ORNEK

```
node benchmarks/annotate/ornek-circle-finder.mjs benchmarks/plans/ornek-upright.png /tmp/proposals.json
node benchmarks/annotate/ornek-raw-frame.mjs      # the same truth, in the raw page's frame
```

The same rule applies and is stated in the finder's own header: **it shares
nothing with the detector it produces truth for.** Its header also keeps the
four approaches that failed before the one that worked, because each failure is
a true statement about this document — the circles are light discs and not dark
rings, a local-mean background sinks to the discs' own tone in dense rows, and
one row is printed so faintly that no per-pixel threshold reaches it.

`benchmarks/annotations/ornek-symbolic.json` is **not regenerable by running
the finder**, and says so. The finder proposes; 27 proposals were rejected by
eye as sitting on the plan's own furniture, 4 faint tables it could not see
were added after being confirmed in a crop, and all 157 printed numbers were
read by a person from crops at 1.7-4x. That review is the ground truth. See
that file's `annotationMethod`.

`ornek-raw-frame.mjs` derives the rotated copy used by `benchmarks/rotation/`.
It is a coordinate change on the frozen file, never an independent annotation.

## ORNEK table outlines (2026-10-18)

```
python3 benchmarks/annotate/ornek-outline-measure.py benchmarks/plans/ornek-upright.png \
    benchmarks/annotations/ornek-symbolic.json /tmp/outlines.json /tmp/review.png
```

The annotation measures each table's CENTRE and gives all 166 one nominal
78 × 78 box. The photographed sheet draws them as ellipses 70–90 px wide and
66–77 px tall. This tool measures each drawn outline (90 rays, the first rim
followed by paper, a consensus ellipse fit) and shares no code with the
detector. 164 of 166 are measured; two that touch a pillar line are left NOT
MEASURED. Every fit was checked by eye on the review sheet. The result is
frozen in `plan-understanding/truth/ornek-symbolic.json` under `tableOutlines`
(review sheet beside it). The scorer uses it for size and shape and keeps the
nominal-box scores under `vsAnnotationBox`.
