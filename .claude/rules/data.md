# Data rules

- Every stored-schema version bump needs a real migration for existing
  `localStorage` data, not just new-install defaults (`migrateEvent` in
  `src/app-v8.js`).
- Historical (`isHistorical`) events must stay immutable at the data
  layer, not only via disabled UI controls.
- No Show must never clear `guest.assignment` — planned vs. live occupancy
  are separate concerns at the storage layer too.
- Any change to guest/table/seat/chair persisted shape needs a save →
  reload round-trip check before being considered safe.
- Do not introduce SQLite or any new storage engine speculatively while
  the product is in browser-review stage — prepare the migration path
  (`merit-desktop-architecture`, `sqlite-ops`) without executing it unless
  explicitly asked.
