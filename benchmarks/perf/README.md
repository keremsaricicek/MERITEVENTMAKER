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

## §26 — repeated, at the full workload (2026-09-27)

`node benchmarks/perf/repeat-stress.mjs` — the performance contract's rule is
median AND p95 over repeated runs, never one number. 400 tables · 4,000 chairs
· 3,000 guests (500 seated) · a 6000×4000 background · 5,000 audit entries ·
twelve past events. Every operation 20× per run in two passes of opposite
order, in-page with a forced layout flush inside the timed region; the whole
runner three times. Columns: the median of the three runs' medians / the worst
p95 of the three. Nothing else ran on the machine.

| operation | before | after windowing |
|---|--:|--:|
| Guests screen render | 256 / **733** | **21 / 39** |
| Seating screen render | 247 / 481 | **148 / 254** |
| Floor Plan render | 161 / 258 | 165 / 207 |
| select a table (floor re-render) | 153 / 497 | 106 / 174 |
| Live screen render | 60 / 207 | 50 / 73 |
| Command Center render | 24 / 54 | 27 / 65 |
| Reports render | 50 / 108 | 43 / 147 |
| keystroke, Guests search | 13 / 43 | 13 / 21 |
| keystroke, Live door search | 23 / 35 | 25 / 38 |
| events list (12 past events) | 6 / 18 | 6 / 8 |
| serialise all state | 17 / 30 | 16 / 22 |
| event package: build + serialise | 6 / 19 | 4 / 9 |
| event package: import checks | 12 / 20 | 10 / 17 |
| **plan analysis**, real plan, OCR pinned (9 runs) | 4,137–5,436 ms, median 4,290 | 4,093–5,552 ms, median 4,295 |

**What changed, and why.** Both lists mounted every record. The Guests screen
at 3,000 guests was ~70,000 DOM nodes; the Seating queue mounted every
unassigned guest (23,833 nodes, the drawing only 5,601). That breaks this
contract's standing rule — a large list is never O(n) nodes in the guest count
— and it was the worst p95 on the board. Both are now windowed like Live's door
list (200 rows / 150 cards, "showing X of Y", Show more; search, filter, order
and counts over every record), held by `list-windowing` (31 checks, 12 of 12
mutations fail it). Rows the change does not touch also moved (table select,
Reports p95): read as run-to-run variance and less garbage per render, not
claimed as results.

**Found on the way, fixed, and tested:** both searches restored focus on the
next animation frame with a caret read before render — the §23 door bug.
Typing at full speed, "Mehmet Yılmaz" arrived in the Guests search as "MeheYm"
and "misafir 1" as "mifir".

**Repeated action.** 300 Seating renders, median per block of 25: a steady
~160–235 ms, with 0–3 single blocks per run at ~440–490 ms, in varying
positions, each followed by a block back at the steady level — and the DOM
node count unchanged (2,242 after one and after three laps of every screen).
Collection phases, not growth: nothing climbs. The first
version of this check compared the first ten renders with the last ten and once
read 267 → 1,020 ms; that measured where the collection landed, and was
replaced by the series.

**Single-number runner, three runs each** (`stress-4000-seats.mjs`, wall clock,
median / worst): Guests render 250 / 284 → **43 / 59**; guest filter 154 → **33**;
guest search 131 → **45**; Seating render 199 → **91**; Live render 332 → 270;
XLSX export 447 → 325 (not touched — variance); reload 755 → 737. Data
integrity after reload exact in all six.

**Budgets.** None exists and none is invented here: this contract says budgets
are set with the user. Heap is not reported — `performance.memory` is
coarsened in this browser.

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
