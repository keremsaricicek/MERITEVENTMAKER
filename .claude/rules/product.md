# Product rules

- A guest record with N additional guests is ONE record with `pax = 1 +
  additionalGuests`. Never split a "+N" party into separate guest records.
- Planning status (`Confirmed`/`Tentative`) and arrival status (`Not
  Arrived`/`Checked In`/`No Show`) are independent. A change to one must
  never write to the other.
- No Show releases live capacity (`liveUsedIndexes`) but must never clear
  or overwrite `guest.assignment` (the planned seat).
- `table.capacity` and `table.chairs` must always be kept in sync — go
  through `setTableCapacity`/`syncTableChairs`, never set one without the
  other.
- `isHistorical(event)` events (Completed or past-dated) must be rejected
  by `canMutate` for every mutation path — new mutation code must call it,
  not just rely on the UI hiding controls.
- A newly created blank event must have zero tables, guests, assignments,
  and AI candidates. Do not add sample/demo data to the production
  `createEvent` path.
- Full detail and code references: `.claude/skills/merit-product-contract/
  SKILL.md`.
