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
