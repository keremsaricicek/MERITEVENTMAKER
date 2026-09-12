# Performance benchmarks

Driving the real app in Chromium via Playwright. Each runner serves the app
itself, so nothing needs starting first.

```
npm run perf                                    # all of them, in order
node benchmarks/perf/stress-4000-seats.mjs      # end-to-end operator timings
node benchmarks/perf/profile-render-phases.mjs  # where a render's time goes
node benchmarks/perf/live-windowing-correctness.mjs  # windowing changed nothing an operator sees
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

## Caveat on the XLSX row

`stress-4000-seats.mjs` reports an XLSX export failure in a sandbox with no
network, because SheetJS loads from CDN in the normal build. That is an
environment limit, not a product defect — `regress-xlsx-content.mjs` exports a
real 25KB workbook with all three sheets, and the offline single-file build
inlines the engine. Do not "fix" the export because this harness reported it.
