# SQLite migration design, and the export format that already exists

Section 31. **Design only.** Nothing here is implemented, and implementing it
now would violate `.claude/rules/data.md`:

> Do not introduce SQLite or any new storage engine speculatively while the
> product is in browser-review stage — prepare the migration path
> (`merit-desktop-architecture`, `sqlite-ops`) without executing it unless
> explicitly asked.

So this file prepares the path. No dependency is added, no schema is created,
no code is written. The EXE gate is also still shut (`.claude/rules/desktop.md`)
and nothing here depends on opening it: a SQLite persistence adapter is a
storage decision, not a packaging one, and could in principle ship behind the
same `StorageProvider` interface the browser build already uses.

---

## 1. The export format v1 is not a thing to design — it already exists, twice

The obvious reading of "export format v1" is that a stable interchange format
must be invented so a desktop build can read what the browser build wrote. It
does not. Two exist, both already version-stamped, both already shipping, both
already covered by regression suites:

| format string | scope | version | built by | guarded by |
|---|---|---|---|---|
| `merit-event-maker-backup` | the **whole install** — every event, replacing what is there | `formatVersion: 1` | `buildBackupPayload()` (app-v8.js) | `tests/suites/backup-restore.test.mjs` |
| `merit-event-maker-event-package` | **one event**, added alongside what exists | `formatVersion: 1` | `MeritEventPackage.buildPayload()` (`src/event-package.js`) | `tests/suites/event-package.test.mjs` |

Both are plain JSON. Both already carry a `format` discriminator *and* a
`formatVersion`, both validate on import rather than trusting the file
(`isWellFormed`, `referencesIntact`, `backupReferencesIntact`), and the package
format already solves the hardest interchange problem — **id collision** — by
renumbering every id the incoming event owns and rewriting every reference to
it, including a freeze that names a table by id.

**The design decision is therefore: do not invent a third format.** A desktop
build reads and writes these two. What follows is how SQLite sits underneath
them, not beside them.

The one thing worth adding before a desktop build, and deliberately *not* added
now because nothing consumes it yet: neither format records the `schemaVersion`
of the install that produced it. Today that is harmless — `migrateEvent()` is
additive and idempotent, and runs on every load whatever the source. It stops
being harmless the first time a migration is non-additive, which is also the
first time a desktop build could receive a file from a newer browser build. The
field to add at that point is `schemaVersion` alongside `formatVersion`, and the
rule is that an importer refuses a `schemaVersion` it does not know rather than
guessing.

## 2. What is actually being migrated

The stored root today (`blankRoot()`, app-v8.js:82):

```js
{ version: 8, schemaVersion: 8, events: [], venues: [], verifiedExamples: [],
  trainingData: [], teachings: [], operatorSessions: [], analyses: [],
  calibration: null, audit: [], lastBackupAt: null }
```

It is serialised whole — one `JSON.stringify(state)` into one IndexedDB record
under key `root` — with image crops held separately in a `blobs` store, already
addressed by id, precisely so a few thousand crops do not turn every ordinary
save into a multi-megabyte serialise/parse.

That existing split is the single most useful fact for this design: **the hard
part is already done once.** The crops were moved out of the state record for
exactly the reason a relational store would move them out, and the decision is
already load-bearing and tested.

## 3. The schema, and where the domain rules land

One table per collection, plus the parent/child structure the domain already
has. The interesting columns are the ones that carry a rule the product refuses
to break:

```sql
CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  hotel         TEXT NOT NULL,
  salon         TEXT NOT NULL DEFAULT '',
  date          TEXT NOT NULL,                     -- ISO date
  status        TEXT NOT NULL CHECK (status IN
                  ('Planning','Confirmed','Live','Completed')),
  created_at    TEXT NOT NULL,
  last_modified TEXT NOT NULL
);

CREATE TABLE tables (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  number           TEXT NOT NULL,
  type             TEXT NOT NULL,
  x REAL, y REAL, w REAL, h REAL, rotation REAL NOT NULL DEFAULT 0,
  zone             TEXT,
  capacity         INTEGER NOT NULL CHECK (capacity >= 0),
  has_physical_seats INTEGER NOT NULL DEFAULT 1,
  capacity_source  TEXT NOT NULL,                  -- MeritCapacityProvenance
  locked           INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, number)                        -- see §4
);

CREATE TABLE chairs (
  id               TEXT PRIMARY KEY,
  parent_table_id  TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  seat_number      INTEGER NOT NULL,
  x REAL, y REAL, rotation REAL NOT NULL DEFAULT 0,
  UNIQUE (parent_table_id, seat_number)
);

CREATE TABLE guests (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  additional_guests INTEGER NOT NULL DEFAULT 0 CHECK (additional_guests >= 0),
  planning_status   TEXT NOT NULL CHECK (planning_status IN
                      ('Confirmed','Tentative')),
  arrival_status    TEXT NOT NULL CHECK (arrival_status IN
                      ('Not Arrived','Checked In','No Show')),
  checked_in_at     TEXT,                          -- see §4, the No Show rule
  vip               TEXT NOT NULL DEFAULT 'Standard',
  invited_by        TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  expected_arrival  TEXT,                          -- stated, never inferred
  created_at        TEXT NOT NULL
);

CREATE TABLE assignments (
  guest_id  TEXT PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
  table_id  TEXT NOT NULL REFERENCES tables(id),
  seats     TEXT NOT NULL,                         -- JSON array of indexes
  locked    INTEGER NOT NULL DEFAULT 0
);
```

Four things deserve comment, because they are where a naive translation would
quietly break a domain rule.

**`guests.pax` is absent, on purpose.** Today `pax` is a redundant cached field
equal to `1 + additionalGuests`, written correctly at five independent sites and
guarded by `tests/suites/pax-invariant.test.mjs` — Section 20 found no live
drift but no single setter either. A relational store is the one place where
that redundancy has a free fix: `pax` becomes a generated column
(`GENERATED ALWAYS AS (1 + additional_guests) VIRTUAL`) and the invariant stops
being something a test has to watch. This is the one genuine improvement SQLite
buys the domain model, rather than a re-expression of what already works.

**`assignments` is a separate table keyed by guest, not a column on `guests`.**
A guest has at most one assignment, so a column would work — but the foreign key
to `tables(id)` is what makes `referencesIntact()` a database constraint instead
of a function the import path remembers to call. `seats` stays JSON: it is a
list of indexes into one table's chairs, always read and written whole, and
normalising it into a row per seat buys nothing and costs a join on the hottest
read in the product.

**No `ON DELETE CASCADE` from `tables` to `assignments`.** Deliberate. Deleting
a table that still has guests assigned to it is exactly the operation the
product must refuse, and a cascade would silently unseat them instead. The
absent cascade turns that into a foreign-key error the application must handle,
which is the correct shape.

**Historical immutability is not a database trigger.** `isHistorical(event)`
(Completed, or past-dated) is enforced by `canMutate()` in the domain layer, and
`.claude/rules/data.md` requires it to stay enforced *at the data layer, not
only via disabled UI controls*. A trigger that rejected writes to a completed
event would be attractive and is wrong for one reason: `migrateEvent()` runs on
every load and legitimately rewrites historical events to backfill fields
honestly (`capacitySource: UNKNOWN`, normalised freezes). A trigger cannot tell
a migration from an edit. The enforcement point stays `canMutate()`, and the
storage layer's job is to make it impossible to bypass by construction — which
is what the adapter boundary in §5 is for.

The remaining root collections (`venues`, `analyses`, `teachings`,
`verifiedExamples`, `trainingData`, `operatorSessions`, `audit`) each become a
table with an `id` and a JSON payload column plus whatever columns are actually
queried. **They are not modelled relationally**, because nothing queries inside
them — they are read whole, by id, or filtered in JS. Normalising a detection
candidate's scene graph into rows would be schema work with no reader.

## 4. The three rules a schema can enforce and the one it cannot

| rule | today | under SQLite |
|---|---|---|
| `pax = 1 + additionalGuests` | 5 write sites + a guard suite | **generated column** — structurally impossible to drift |
| capacity/chairs kept in sync | `syncTableChairs()` only | trigger, or a transaction contract in the adapter |
| a guest's seats belong to their table | `referencesIntact()` on import | **foreign key**, always |
| No Show keeps the planned seat | `setArrival()` is the single writer | **cannot be a constraint** |

The last one is the important admission. "No Show releases live capacity but
never clears `guest.assignment`" is a rule about *which fields a particular
operation may touch*, not about which states are valid — a row with
`arrival_status = 'No Show'` and a live assignment is perfectly valid, and so is
one without. No CHECK constraint expresses it. It stays what it is today: one
writer, `setArrival()`, which maintains `arrivalStatus` and `checkedInAt`
together and writes the audit entry, enforced by `src/arrival-wave.js` refusing
to count a No Show as an arrival and by the suites that pin it.

Writing that down matters more than the schema does. The temptation when moving
to a relational store is to believe the constraints now hold the domain, and to
relax the code that actually holds it.

## 5. Migration path — the boundary that already exists

The browser build already routes every read and write through
`StorageProvider` (`src/storage-provider.js`), with two implementations
(`IndexedDBStorageProvider`, `LocalStorageStorageProvider`) selected at boot,
and `saveState()` already serialises writes through a queue so last-call-wins is
structural (Section 13). A SQLite adapter is a third implementation of that same
interface — `load(key)`, `save(data, key)`, plus the blob methods — and needs no
change to any caller.

That interface is coarse: it moves the whole root as one string. A SQLite
adapter that honoured it literally would store one giant JSON blob and gain
nothing. So the migration is two steps, in this order, and the order is the
whole point:

1. **Ship the adapter behind the existing interface, writing real rows.**
   `save()` becomes a transaction that upserts the changed rows; `load()`
   reconstructs the root object the rest of the app expects. The app cannot tell
   the difference. Every existing suite still applies unchanged, and that is the
   proof the adapter is correct — not a new suite written to match the new
   behaviour.
2. **Only then**, and only where a measurement justifies it, replace whole-root
   reads with narrower queries. Not before: the app's read patterns today assume
   the root is in memory, and rewriting them speculatively is the "destructive
   framework rewrite for architectural purity" that
   `merit-desktop-architecture` forbids.

Step 1 is testable against the existing suites and is the entire deliverable.
Step 2 is optional forever.

### What the first run must do with existing data

An operator upgrading from the browser build has an IndexedDB record. The
desktop build must: read it through the existing provider, run `migrateEvent()`
on it exactly as today, write it into SQLite in one transaction, verify by
reading it back and comparing counts (events, tables, chairs, guests,
assignments, pax) — and **keep the IndexedDB record** until a person has opened
the app and seen their events. A migration that deletes its own source before
anyone has confirmed the destination is the failure this project's whole storage
discipline exists to avoid.

`.claude/rules/data.md` requires a save → reload round-trip check for any change
to persisted shape. For this one the round trip is cross-engine, and the check
is the one `tests/suites/schema-migration.test.mjs` already performs, pointed at
the new engine.

## 6. What this design does not decide

- **Which SQLite binding.** `better-sqlite3`, `node:sqlite`, or WASM in the
  renderer are different trade-offs and the choice depends on the packaging
  decision, which is behind the EXE gate. Naming one now would be picking a
  packaging technology, which is exactly what is forbidden.
- **Whether SQLite is needed at all.** The 4,000-seat fixture serialises to
  1.20 MB and reloads in ~780 ms (`benchmarks/perf/`). Nothing measured so far
  says the current engine is the constraint. SQLite's case is durability,
  crash-safety and concurrent access for a desktop app, not speed — and that
  case should be made on a measurement when there is a desktop app to measure.
- **Any packaging, installer, or updater question.** Out of scope here and
  forbidden until the user types **"EXE YAP"**.
