---
name: merit-product-contract
description: The permanent domain contract for MERIT ENTERTAINMENT — EVENT MAKER — guest semantics, planning vs. arrival status, chair/capacity model, No Show rules, historical immutability, and reports regression protection. Use before touching Events, Guests, Seating, Live Event, or Reports behavior, or when interpreting any requirement that mentions guests, pax, tables, chairs, arrivals, or completed events.
---

# Merit Product Contract

MERIT ENTERTAINMENT — EVENT MAKER is internal, browser-only event-operations
software for premium hospitality/casino event management. No backend —
everything lives in `localStorage` (`meritEventMaker.v1`). This skill
documents the domain rules **as actually implemented** in `src/app.js`,
`src/app-guests.js`, and `src/app-v8.js`. It is a contract, not aspiration:
verify against the current source before assuming behavior has drifted.

## Core screens

Events → Floor Plan → Guests → Seating Plan → Live Event → Reports, plus
Plan Intelligence (Assisted Detection review) and Teach AI (corrections
inside that review flow). `app-v8.js` is an override/extension layer loaded
after `app.js` and `app-guests.js` and share one global scope — load order
in `index.html` is structural, not incidental.

## Guest semantics — ONE record, not four

A guest record has `additionalGuests` (companions, excluding the primary
person) and a derived `pax = 1 + additionalGuests` (see `normalizeGuest` in
`src/app.js`). **"Name +3" is one logical guest record** — a named guest
plus 3 companions, total pax 4. Never split this into four independent
guest records. Companion seats export as `GUEST OF [PRIMARY NAME]`
(`seatExportName` in `src/app-guests.js`), never as separate names.

Two independent status axes — never conflate them:

- **Planning status**: `Confirmed` | `Tentative` — whether attendance is
  considered definite.
- **Arrival status**: `Not Arrived` | `Checked In` | `No Show` — day-of
  operational state, tracked in Live Event.

Changing one must never change the other. The in-app guide is explicit
about this (`src/app-guests.js`), and it is a real product invariant, not
just copy.

VIP levels: `Standard` | `VIP` | `VVIP` (`g.vip` in `normalizeGuest`).

## Chairs are first-class physical objects

A table's `capacity` is not a bare number — it is backed by an array of
`chairs` on the table (`syncTableChairs` / `chairGeometry` in
`src/app-v8.js`). Each chair carries `id`, `parentTableId`, `seatNumber`,
position (`x`/`y`), `rotation`, and `occupancy`. `physicalCapacity()` sums
real chair counts, not a capacity field in isolation. Any change to table
capacity must go through `setTableCapacity` → `repackTableAssignments`, which
refuses to shrink capacity below the number of currently occupied seats and
repacks seat indices safely. Do not introduce a code path that sets
`table.capacity` without keeping `table.chairs` in sync.

## No Show: planned assignment vs. live occupancy

This is the most important operational rule in the product. A guest marked
**No Show**:

- **Keeps** their planned seating assignment (`guest.assignment` is
  untouched) — the historical/planned record is never destroyed.
- **Releases** live operational capacity — `liveUsedIndexes()` in
  `src/app-v8.js` explicitly excludes guests with `arrivalStatus === "No
  Show"` from the live-occupied set, so their chairs show as available in
  Live Event / operational seating view (the red-glow "available after
  No Show" treatment).

Never merge these two concepts into a single "occupied" boolean. Planned
seating (`occupiedSeatIndexes`) and live occupancy (`liveUsedIndexes`) are
deliberately separate functions — keep them separate in any future change.

## Historical events are immutable

`isHistorical(event)` is true when `event.status === "Completed"` or the
event date is in the past (`src/app-v8.js`). `canMutate(event, action)`
gates every mutation (guest edits, floor plan edits, plan analysis,
background replacement) and refuses on historical events. Historical events
may still be viewed, searched, reported on, and deleted where policy
permits — but never silently editable. Protect this in domain logic
(`canMutate`), not only by disabling buttons in the UI — a UI-only guard is
not a real guard.

## Reports are regression-sensitive

`Reports → Export Table Plan` produces a real `.xlsx` workbook via SheetJS,
entirely offline. Preserve on any reports-adjacent change:

- **TABLE PLAN** sheet: four table cards per horizontal group.
- **GUEST LIST** sheet: every guest record.
- **UNASSIGNED** sheet: only guests without a table assignment.
- Companion seats exported as `GUEST OF [PRIMARY NAME]`, uppercased.
- Seat numbering, table numbering (`T01`, `B01`… via `nextTableNumber` /
  `naturalTableSort`), and professional workbook formatting.

Any change that touches guest, table, or seat data structures needs a
before/after export check — open the produced `.xlsx` and diff sheet
contents, don't just confirm the export doesn't throw.

## Blank events must actually be blank

A newly created blank event (no floor-plan image) must ship with zero
tables, zero guests, zero AI candidates, zero assignments. Never seed a
blank event with sample tables, sample guests, a demo background, or test
assignments as a "convenience." Development fixtures belong in dev-only
tooling, never in the production `createEvent` path.

## Zones and table types

Zones: `VIP FRONT`, `VIP`, `MAIN FLOOR`, `BISTRO`, `RESERVED`
(`ZONES` in `src/app.js`). Table types: `rectangle`, `square`, `round`,
`bistro`. Table numbers use a natural-sort prefix scheme (`T` for standard,
`B` for bistro, `VIP` ranks first) — see `naturalTableSort`.

## When this contract and a requirement conflict

If a requested change would violate one of these rules (e.g., "just delete
the companion's history when they're a No Show" or "merge planning and
arrival status into one field"), stop and flag the conflict explicitly
rather than silently implementing it — these are load-bearing operational
semantics for a live event, not incidental implementation details.
