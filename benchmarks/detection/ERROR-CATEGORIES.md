# Real-plan detection errors, categorized

```
node benchmarks/detection/categorize-errors.mjs
```

Prints every false positive with its geometry, classification, the evidence
that produced it, the nearest ground-truth object, and which annotated regions
it falls inside — then every missed table with the distance to the nearest
detection. The point is to fix categories, never coordinates.

Current state: **6 false positives, 5 false negatives** against 46 annotated
tables (precision 0.872, recall 0.891, F1 0.882).

## False positives — 3 categories

### A. Split fragments beside a real table (3 of 6)

`FP1 (776,303)`, `FP3 (341,566)`, `FP4 (341,629)`

| | |
| --- | --- |
| signature | `source=fill`, `split=true`, size agreement 0.04–0.67 |
| location | 32–33px from a real table they were cut out of |
| chairs | 1–2 |

These are the residue of the valley-split step: it cut a merged blob and one
piece became a phantom neighbour. The existing fragment filter already removes
35 of these; the survivors have *some* seat adjacency (1–2 chairs), which is
one of the four disagreement axes, so they only reach two reasons instead of
the three required to drop.

Tractable next step: a fragment whose box is largely *contained by or abutting*
a higher-confidence table it was split from is a duplicate of that table, not a
new object. That is a containment test against the split parent, not a
threshold.

### B. Off-modal tone blobs with no seats (2 of 6)

`FP5 (1145,516)`, `FP6 (668,520)`

| | |
| --- | --- |
| signature | `source=tone`, `split=false`, size agreement 0.24–0.29 |
| repetition | **2** — only two similar objects on a plan carrying 46 tables |
| chairs | 0 |
| location | 58–60px from the nearest real table, i.e. free-standing |

The strongest available rejecting evidence is repetition. On a plan whose
furniture repeats 37 times, an object with two peers, no seats, and poor
agreement with the modal size is not part of the seating vocabulary.

Not implemented here, deliberately: a rare-but-real table type (one head table,
two bars) would also score low repetition, so this needs the rule to consider
repetition *together with* seat adjacency and free-standing distance rather
than alone — and it needs a fixture containing a legitimately rare table before
it can be shown not to cost recall.

### C. Venue object read as a table (1 of 6)

`FP2 (45,153)`

Sits **15px from the annotated entrance `v03`**, inside both a text region and
an architecture region, with 0 chairs. The evidence to reject it already
exists and is already computed — this candidate is inside two annotated
non-furniture regions at once. The gap is that region evidence currently feeds
the *benchmark report* rather than the detector.

## False negatives — 1 category, all 5

`t42, t43, t44, t45, t46` — **every miss is a bistro table**, and every one is
83–133px from the nearest detection against a 47px match tolerance. They are
not mislocalized. They are not detected at all.

Cross-referencing the chair-extraction overlay explains why: the bistro tables
are drawn as a small table with a chair hard against each of two opposite
sides, and the three merge into a single blob (measured at 73×29 and 55×30
pixels). The merged shape is too wide and too thin to pass `tableSizeOk`, so
nothing is proposed.

This is the same structural problem as the chair/table size overlap recorded in
`src/app-v8.js`: the split between furniture and its seats has to happen with
knowledge of the plan's modal sizes, and currently it happens before those are
known. Fixing bistro detection and fixing the outlined-chair source are the
same pipeline reordering.

## What this list is for

Every entry above names the evidence that would reject or recover the object.
None of them is "these six coordinates". A rule that improves any category has
to be re-measured against `benchmarks/run-benchmark.mjs` on all four fixtures,
and must not trade table or chair recall for precision.
