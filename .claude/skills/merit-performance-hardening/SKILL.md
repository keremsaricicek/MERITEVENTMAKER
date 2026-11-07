---
name: merit-performance-hardening
description: The performance contract for MERIT ENTERTAINMENT — EVENT MAKER — load targets, latency budgets, memory discipline, and the measurement rules that make a performance claim credible. Requires median plus p95 over repeated runs, never a single number. Use for performance work and before claiming a performance score.
---

# MERIT Performance Hardening

The load that matters is a real gala: **3,000+ guests, 400+ tables, 4,000+
logical seats**, a large plan image, and an operator dragging a marquee
across it while the door queue moves.

## THE RULE THAT DECIDES THIS DIMENSION

> **One run is not a measurement.**

A single timing is noise. Browser timing varies with GC, thermal state,
whatever else the machine is doing, and — on this project specifically —
**whatever else this session is running**. Concurrent Chromium instances
have already produced a benchmark that sat in timeouts while the machine was
idle, and a perf result that reversed on the second pass.

Every performance claim needs:
- **≥3 runs**, reported as **median and p95** (or worst)
- **forced GC** before heap measurement
- **order control** — run the comparison both ways round, since the first
  run pays the warm-up
- **nothing else running** on the machine

A number without these is reported as INDICATIVE, never as a result.

### Heap honesty
`performance.memory` is coarsened in modern browsers. Where a real heap
figure cannot be obtained, report **UNAVAILABLE** — never print a coarsened
value as data. This was corrected once already in the CI heap column; do not
reintroduce it.

## What to measure

**DOM cost** — node count at full load; nodes created per render; listener
count after repeated navigation (a growing count is a leak).

**Interaction latency** — table drag and marquee (frame time under
`pointermove`); canvas zoom/pan; selection of hundreds of objects.

**Data operations** — guest search over 4,000 (`guest-finder` measures this
rather than asserting it); seating assignment; filter and sort; XLSX import
and export; plan analysis end to end.

**Memory** — heap after load, after 100 operations, after navigating every
screen twice; the write queue must not grow unboundedly; event history and
audit are capped and the caps hold.

**Repeated action** — the same operation 100× must not degrade. A slow
first run is acceptable; a run that gets slower every time is a leak.

## Budgets

Budgets are a property of the product, not of this file — set them with the
user, write them down here once agreed, and then hold them. Until then,
report measurements against the **previous measurement**, and say that is
what you are doing.

What is already non-negotiable:
- No unbounded growth in nodes, listeners, heap or queue depth.
- No interaction that blocks the main thread long enough to drop the drag.
- Large-list rendering must not be O(n) DOM nodes where n is the guest count
  without windowing.

## Evidence

- `npm run perf` (`benchmarks/perf/run-perf.mjs`)
- the performance suites in CI (currently a RELEASE GATE)
- `guest-finder`'s 4,000-guest search measurement
- before/after for any change touching canvas interaction, large lists,
  XLSX, or floor-plan images (`.claude/rules/testing.md`)

## Scoring (from `merit-quality-program` §6)

- **Minimum gate** — no unbounded growth; documented budgets.
- **9** — median **and** p95 over ≥3 runs at 3,000 guests / 400 tables /
  4,000 seats, within budget.
- **10** — plus a CI performance gate that blocks a real regression.

A dimension reported from a single run cannot exceed **6**, however good the
number looks.
