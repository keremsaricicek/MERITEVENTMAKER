# Product rules

- A guest record with N additional guests is ONE record with `pax = 1 +
  additionalGuests`. Never split a "+N" party into separate guest records.
- Planning status (`Confirmed`/`Tentative`) and arrival status (`Not
  Arrived`/`Checked In`/`No Show`) are independent. A change to one must
  never write to the other.
- No Show releases live capacity (`liveUsedIndexes`) but must never clear
  or overwrite `guest.assignment` (the planned seat).
- `table.capacity` is the LOGICAL seat space; `table.chairs` holds PHYSICAL
  chairs and is empty when the plan drew none. On a table that does draw its
  chairs the two stay in sync — go through `setTableCapacity`/
  `syncTableChairs`, never set one without the other. Never synthesise a
  chair object from a capacity number.
- "Can this table seat somebody" is `capacity > 0`
  (`MeritSeatModel.canSeat`), never `hasPhysicalSeats !== false`. Room
  capacity is `MeritSeatModel.seatingCapacity(event)`; `physicalCapacity`
  answers a different question (how many chairs the drawing carried) and
  belongs only where the label says "physical chairs".
- `isHistorical(event)` events (Completed or past-dated) must be rejected
  by `canMutate` for every mutation path — new mutation code must call it,
  not just rely on the UI hiding controls.
- A newly created blank event must have zero tables, guests, assignments,
  and AI candidates. Do not add sample/demo data to the production
  `createEvent` path.
- Full detail and code references: `.claude/skills/merit-product-contract/
  SKILL.md`.
