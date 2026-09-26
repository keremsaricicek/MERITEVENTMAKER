# Performance benchmarks

Driving the real app in Chromium via Playwright. Each runner serves the app
itself, so nothing needs starting first.

```
npm run perf                                    # all of them, in order
node benchmarks/perf/stress-4000-seats.mjs      # end-to-end operator timings
node benchmarks/perf/profile-render-phases.mjs  # where a render's time goes
node benchmarks/perf/live-windowing-correctness.mjs  # windowing changed nothing an operator sees
node benchmarks/perf/save-queue-burst.mjs       # what the saveState write queue costs
```

`stress-4000-seats.mjs` builds 400 tables / 4,000 chairs / 3,000 guest records
(4,500 pax) through the app's own model, then times the operations an operator
actually performs and asserts the data survives a reload intact. It exits
non-zero if the table, chair, guest or assignment counts change across the
round trip.

`profile-render-phases.mjs` splits a render into build-HTML / innerHTML /
layout / bind and forces a layout flush **inside** each timed region. That
matters: without the flush, Chromium defers layout past the end of the call
and the cost lands on whichever measurement happens next, which is how the
first pass of this work misattributed ~1.2s of Guests-screen layout to the
following search keystroke.

## Numbers on record

Measured in this environment (headless Chromium, 1920x1080), wall clock in ms.
"Before" is the state at commit `91a5af2`.

| operation | before | after |
| --- | ---: | ---: |
| buildDataset | 12 | 14 |
| saveState | 11 | 9 |
| renderFloorPlan (5,601 canvas nodes) | 39 | 36 |
| assign500Guests | 15 | 15 |
| guestsScreenRender | 270 | 182 |
| **guestSearch** | **1,221** | **116** |
| guestFilterUnassigned | 284 | 131 |
| **seatingScreenRender** | **1,339** | **173** |
| liveScreenRender | 833 | 694 |
| liveSearch | 184 | 117 |
| checkIn | 52 | 52 |
| noShow | 64 | 49 |
| reportsRender | 41 | 45 |
| undoSnapshot | 7 | 7 |
| undoRestore | 46 | 54 |
| saveStateFull | 37 | 37 |
| reloadAndRestore | 978 | 964 |
| backupExport | 51 | 74 |

JS heap 20-27MB. Data integrity after reload: 400 tables / 4,000 chairs /
3,000 guests / 500 assigned / 4,500 pax, all preserved.

### Re-measured at Section 22

The same runner at the end of the pre-desktop programme, on the same fixture:

| | after (above) | Section 22 |
| --- | ---: | ---: |
| saveState | 9 | 22 |
| renderFloorPlan | 36 | 88 |
| guestsScreenRender | 182 | 400 |
| guestSearch | 116 | 178 |
| guestFilterUnassigned | 131 | 396 |
| seatingScreenRender | 173 | 410 |
| liveScreenRender | 694 | 634 |
| liveSearch | 117 | 48 |
| saveStateFull | 37 | 25 |
| reloadAndRestore | 964 | 783 |
| JS heap | 20-27 MB | 72 MB |

Data integrity after reload still exact, console still clean. Several numbers
went up and several went down, and **this table is not a clean before/after**:
the left column was recorded many months and a large amount of product ago
(Command Center, Plan Doctor, freeze zones, table availability, arrival wave,
service load, risk radar, audit trail), all of which render and persist real
work, and the two columns were measured on different machines under different
load. Treat it as a current reading, not as a regression measurement — the
per-change before/after is the job of a runner like `save-queue-burst.mjs`,
which holds everything else fixed.

One thing the table does rule out: `saveState` moving 9 → 22 ms is *not* the
Section 13 write queue. That measurement is synchronous and returns before the
queue does anything, `saveStateFull` moved the other way (37 → 25) under the
identical method, and the queue's real cost is measured directly below.

## What the bottleneck actually was

The first hypothesis was the O(guests x tables) table lookup inside the guest
filter predicates — 1.2M comparisons per render on this fixture. That was a
real inefficiency and it is fixed, but **it was not the cause**: profiled, the
whole filter pass costs 3-4ms with or without the index.

The cost was DOM layout on lists nobody could see. One Guests render put
70,205 nodes on screen (Live 46,141, Seating 23,633) and Chromium laid out
every row, including the ~2,950 below the fold:

| phase (Live, 3,000 rows) | ms |
| --- | ---: |
| build HTML string | 50 |
| parse + insert (innerHTML) | 118 |
| **layout** | **369** |
| bind handlers (6,002 buttons) | 13-18 |

`content-visibility: auto` on the three long-list row classes takes layout to
82ms and needs no JS. Nothing is virtualised away: filters, counts, metrics
and the Live keyboard flow still run over every guest record, so search
results, "still expected" totals and Enter-to-check-in stay exact — only
off-screen *layout* is skipped.

Handler binding was measured before assuming it mattered; at 13-18ms it does
not, so the per-row `onclick` assignments were left alone rather than
converted to delegation for no gain.

## What the saveState write queue costs (Section 22)

Section 13 made `saveState()` serialise its writes through a promise queue, so
that two saves issued microseconds apart can no longer land out of order and
persist a stale state over a fresh one. `save-queue-burst.mjs` measures what
that costs, because `stress-4000-seats.mjs` structurally cannot: it times
`saveState()` as `p.evaluate(() => { saveState(); })`, the synchronous part
only, and returns before a byte reaches IndexedDB.

40 back-to-back `saveState()` calls on the 4,000-seat event (1.20 MB payload
per save), both variants run twice in opposite orders, with a forced GC before
each burst:

| | sync | drain | peak heap | last write wins |
| --- | ---: | ---: | ---: | :---: |
| queued (today) | 210 / 189 ms | 795 / 564 ms | 123 / 97 MB | yes |
| unqueued (before) | 150 / 151 ms | 380 / 399 ms | 81 MB | yes |

**The queue costs, it does not save.** Drain roughly doubles — writes that used
to overlap now run strictly one after another — and peak heap rises by
~16-42 MB, which is the predicted retention: up to 40 payload strings of
1.20 MB alive at once, each captured in its own closure until its turn comes.
The synchronous cost an operator feels grows by ~1-1.5 ms per call, and the
real figure is smaller than the table shows, because the unqueued side skips
`refreshChairOccupancy()` (IIFE-scoped, unreachable from the harness) and so
does strictly less work per call than the queued side it is compared against.

That is an acceptable trade and it is a trade, not a free win: 40 saves
back-to-back is far past what an operator generates (a canvas drag saves on
pointerup, not per frame), 795 ms to fully persist afterwards happens off the
main thread, and 123 MB sits against a 4,096 MB heap limit. The runner asserts
only the property the queue exists for — that the last value written is the one
on disk — and reports the timings.

Note that the unqueued variant also reports last-write-wins here. That does not
mean the race was imaginary; it means an intermittent race did not fire in this
run. `tests/suites/storage-provider.test.mjs` is what proves it deterministically,
by delaying the first `indexedDB.open` and reading the raw record.

### Methodology note: the first version of this runner said the opposite

Run once, with no forced GC and no order control, it reported the queue as
*faster* on every axis — and that was an artifact twice over. The second burst
started on the first burst's uncollected garbage, so its "before" heap was
meaningless, and running second also meant a warmed JIT and an IndexedDB file
already extended on disk. Forcing `HeapProfiler.collectGarbage` between bursts
and running the pair again in the opposite order reversed the drain and heap
findings and made both passes agree. The runner now prints whether the two
passes agree on direction, and says not to quote a winner when they do not.

Same lesson as the layout misattribution below: measure the thing, then check
the measurement is measuring it.

## Caveat on the XLSX row

`stress-4000-seats.mjs` reports an XLSX export failure in a sandbox with no
network, because SheetJS loads from CDN in the normal build. That is an
environment limit, not a product defect — `regress-xlsx-content.mjs` exports a
real 25KB workbook with all three sheets, and the offline single-file build
inlines the engine. Do not "fix" the export because this harness reported it.
