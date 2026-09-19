---
name: merit-product-contract
description: The permanent domain contract for MERIT ENTERTAINMENT — EVENT MAKER — guest semantics, planning vs. arrival status, chair/capacity model, No Show rules, historical immutability, and reports regression protection. Use before touching Events, Guests, Seating, Live Event, or Reports behavior, or when interpreting any requirement that mentions guests, pax, tables, chairs, arrivals, or completed events.
---

# Merit Product Contract

MERIT ENTERTAINMENT — EVENT MAKER is internal, browser-only event-operations
software for premium hospitality/casino event management. No backend — all
state stays in the browser, behind the `StorageProvider` boundary in
`src/storage-provider.js`: **IndexedDB is the live engine** (database
`meritEventMaker`, version 2, state record plus a separate blob store for
image crops), with `LocalStorageStorageProvider` kept only as a boot-time
fallback when IndexedDB is unavailable. An earlier version of this file said
everything lives in `localStorage` — that is no longer true, and a refactor
planned on that assumption would be planned against the wrong layer.

This skill documents the domain rules **as actually implemented** in
`src/app.js`, `src/app-guests.js`, and `src/app-v8.js`. It is a contract,
not aspiration: verify against the current source before assuming behavior
has drifted.

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

## Physical chair, logical seat and capacity are THREE different things

This is the permanent domain contract. It is not a description of the
current data structure, and the current data structure must not be read
back as the contract.

| Concept | What it is | What it may never do |
|---|---|---|
| **PHYSICAL CHAIR** | A real object seen on the plan, or confirmed by a person. May carry real coordinates and orientation. | **Never invented from a capacity number.** If a plan draws no chairs, the system produces **no** physical chairs — it does not synthesise them |
| **LOGICAL SEAT** | A seating position used to assign a guest. May come from printed capacity, human confirmation, or another trustworthy capacity source. | **Never claims to be a physical chair** |
| **CAPACITY** | The operational/logical capacity of the table. | **Never required to equal the physical chair count.** Its provenance is tracked separately (`capacitySource`, `src/capacity-provenance.js`) |

A completely valid table:

```
capacity        = 12
logicalSeats    = 12
physicalChairs  =  0
```

This is **normal**, not a defect — it is the ordinary case on a SYMBOLIC
plan (numbered circles, no drawn furniture, capacity printed as a rule).
`hasPhysicalSeats === false` and an unknown seat count is `null`, never `0`.

### CURRENT LEGACY IMPLEMENTATION

The shipping code does **not** yet model these three separately. Today
`table.chairs` is a single array that holds **both** real detected/confirmed
physical chairs **and** non-physical logical placeholders generated to match
`capacity` (`syncTableChairs` / `chairGeometry` in `src/app-v8.js`; each
entry carries `id`, `parentTableId`, `seatNumber`, `x`/`y`, `rotation`,
`occupancy`). `physicalCapacity()` sums entries of that array, so on a
symbolic plan it counts placeholders that correspond to no real object.

Treat that as **legacy implementation detail to be migrated away from**, not
as the target architecture and not as an invariant to preserve. When the
three concepts are separated, the array's dual use is the thing that gets
fixed.

### What IS an invariant today

While the legacy shape stands, `table.capacity` and `table.chairs` must not
drift apart: go through `setTableCapacity` → `repackTableAssignments`, which
refuses to shrink capacity below currently occupied seats and repacks seat
indices safely. Do not add a code path that sets one without the other.

This is a **consistency rule for the current representation** — it keeps
today's code honest. It is not a claim that capacity is *defined by* a
physical chair count, and it must not be cited to justify generating fake
chairs to satisfy a capacity figure.

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
