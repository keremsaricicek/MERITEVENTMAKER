---
name: merit-data-integrity-hardening
description: The data-integrity contract for MERIT ENTERTAINMENT — EVENT MAKER — schema versioning, migration registry, idempotence, future-version safety, write ordering, transaction atomicity, audit durability, backup and package import, and the physical-chair / logical-seat / capacity separation. Use for any storage, schema or migration work and before claiming a data-integrity score.
---

# MERIT Data Integrity Hardening

**The data is the event.** A guest list rebuilt at 21:00 because a migration
dropped a field is the most expensive failure this product can produce.

`.claude/rules/data.md` is the short rule set. This file is the checklist a
storage change is measured against.

## THE LAW

> **SILENT DATA LOSS IS THE ONE UNACCEPTABLE OUTCOME.**

Losing data loudly is bad. Losing it quietly — a migration that drops an
unknown field, a merge that overwrites, a save that half-succeeds — is
unrecoverable, because nobody knows to restore.

## Schema and migration

- **`schemaVersion` on every stored record.** No inference from shape.
- **A migration registry**, applied **sequentially**: a record at v3 in a v8
  build runs 3→4→5→6→7→8. Never a single "upgrade to current" branch.
- **Idempotent.** Running a migration twice produces the same result. Assume
  interruption.
- **Never destructive by default.** A migration that cannot map a field
  preserves it rather than dropping it.
- **Future-version safety.** A record written by a *newer* build must be
  detected and refused read-only, not silently downgraded. A user with two
  machines will hit this.
- **New-install defaults are not a migration.** Every version bump needs a
  real path for existing data (`migrateEvent` in `src/app-v8.js`).
- **Round-trip proof.** Every persisted-shape change gets a save → reload →
  compare test before it is considered safe.

## Write ordering and atomicity

- A multi-part write either lands completely or not at all. A guest assigned
  to a table must never persist without the seat indices.
- Concurrent saves must not interleave into a torn record.
- Read-back verification on critical writes: a write reporting success whose
  read returns something else is a silent corruption.
- Covered today by `transaction-atomicity` — extend it as paths are added.

## The domain shapes that must survive

These are the contract items most likely to be damaged by a refactor:

- **Guest = one record.** `pax = 1 + additionalGuests`. Never split a "+N"
  party.
- **Planning status and arrival status are independent axes.** A migration
  must never derive one from the other.
- **No Show keeps `guest.assignment`.** `occupiedSeatIndexes` (planned) and
  `liveUsedIndexes` (live) are two different facts —
  `benchmarks/CODE-INVENTORY.md` §2.4 records why merging them is a revert.
- **Physical chair / logical seat / capacity are three separate concepts**,
  and `src/seat-model.js` holds the one definition of each.
  `capacity=12, logicalSeats=12, physicalChairs=0` is valid and ordinary on
  a symbolic plan. Chairs are never invented from a capacity number:
  `table.chairs` holds physical chairs only and is `[]` where the plan drew
  none, so a stored event carries no fabricated coordinates. The
  `chair.physical` flag is retired — presence in the array IS the claim.
  Seatability is `capacity > 0`, never `hasPhysicalSeats`. See
  `merit-product-contract`.
- **`capacitySource` provenance persists.** A capacity that loses its source
  becomes unfalsifiable.
- **Historical events immutable at the storage layer**, not only via
  disabled UI.

## Audit durability

- The audit trail is capped. When the cap evicts, that is **disclosed**, not
  silent (`audit-trail`).
- One decision logs once, under one code. A generic per-mutation entry must
  not masquerade as a decision.
- Another event's entries never leak into this event's trail.
- An unresolvable guest or table id falls back honestly rather than throwing.

## Import, export, recovery

- **Backup** validated before it replaces anything; a failed restore leaves
  the previous state intact.
- **Event package** *adds* an event — never replaces or mutates an existing
  one. All references (freezes, chairs, assignments, audit) are renumbered
  consistently (`event-package`).
- **Automatic recovery is not a backup.** Snapshots are throttled, capped,
  and stored apart from the primary record so one corruption cannot take
  both. A deliberate restore is confirmed first (`offline-recovery`).
- Exporting a package must not set `lastBackupAt` as if the whole install
  had been backed up.

## Evidence

`schema-migration` · `storage-provider` · `transaction-atomicity` ·
`backup-restore` · `event-package` · `offline-recovery` · `venue-model` ·
`historical-immutability` · `audit-trail` · `capacity-provenance` ·
`physical-logical-seat-separation`

Gaps to close: a **future-schema-version** test, a **migration idempotence**
test, and a **torn-write** test. Coordinate the failure-injection side with
`resilience-engineer`, who owns the harness.

## Scoring (from `merit-quality-program` §4)

- **Minimum gate** — no silent data loss on any path; historical events
  immutable at the storage layer.
- **9** — every persisted-shape change has a save→reload round-trip test.
- **10** — plus corruption of any stored record is detected, contained and
  reported without losing the rest.

## Not now

Do not introduce SQLite or any new storage engine while the product is in
browser review. Prepare the path (`merit-desktop-architecture`,
`sqlite-ops`); do not execute it unless the user asks.
