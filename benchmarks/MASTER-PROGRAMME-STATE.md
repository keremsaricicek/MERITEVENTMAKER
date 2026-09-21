# FINAL MASTER QUALITY & COMPLETION PROGRAMME — state

**This file is the programme's memory.** It survives session boundaries.
A session resuming this work reads this file and the repository — never its
own recollection.

- **Programme start SHA** `02edac7`
- **Branch** `claude/merit-concept3-plan-intelligence-rebirth`
- **PR** #5 — OPEN, must not be merged
- **Current SHA** `02edac7`
- **Status** IN PROGRESS

## How to resume

1. `git rev-parse --short HEAD` and compare with "Current SHA" above.
2. Read this file's **Next step**.
3. Re-measure before trusting any number here — every figure is a dated
   snapshot, not a fact.
4. Continue. Never redo a completed step from memory.

## Gates after every production step

```
npm run test:all · npm run build:offline · npm run build:offline-full · npm run verify:offline
```
plus the benchmarks relevant to what changed. A step that cannot pass all
four is reverted, not patched forward.

---

## Measured starting state (`02edac7`)

| Fact | Value | Command |
|---|---|---|
| `src/*.js` | 34 files, 18,783 lines | `wc -l src/*.js` |
| `app-v8.js` | 5,740 lines, longest line 3,369, 41 lines >500 | `wc -l src/app-v8.js` |
| `plan-detection-classical.js` | 2,857 lines, longest line 331 | `wc -l` |
| `plan-intelligence.js` | 1,903 lines | |
| Suites / checks | 65 / 2,080 | `npm run test:all` |
| Offline | 27 / 27 | `npm run verify:offline` |
| `confirm()` / `prompt()` | 9 / 2 | `grep -o '\bconfirm(' src/*.js` |
| `innerHTML=` / `insertAdjacentHTML` | 13 / 1 | |
| `aria-*` / `role=` | 23 / 8 | |
| Security / a11y / resilience suites | **0 / 0 / 0** | `ls tests/suites` |
| `MAX_TABLES` | **240**, `plan-detection-classical.js:1917` — silent truncation | |
| Audit eviction | `slice(0,1000)` at `app-v8.js:87` and `:5529` — silent | |
| Adversarial | re-measuring at HEAD (see below) | `npm run benchmark:adversarial` |

---

## Work log

Each entry: what changed, its commit, and the evidence. Append only.

### A. §1 — quality-doc corrections — DONE (`dd263e0`)
- [x] `QUALITY-TEAM.md`: UI/UX single owner (`premium-ui-director`),
      `visual-qa-reviewer` recorded as the measurement owner
- [x] `MASTER-PROGRAMME-READINESS.md`: adversarial count re-measured at HEAD
      three times — **1 PASS · 4 PARTIAL · 3 FAIL**, stable. The externally
      cited 1/5/2 does not reproduce here; the discrepancy is recorded with a
      resolution path rather than adopted.

### B. §8 — the 240-table ceiling — DONE
`MAX_TABLES` in `src/plan-detection-classical.js` was **240**, which sits
INSIDE the range real venues occupy. The `a8-large-venue` fixture has 324
ground-truth tables, the detector returned exactly 240, and the reported
table recall was 0.741 — which is 240/324 to four figures. The cause was
proven arithmetically, not guessed.

Raised to **2000**. The slice feeds fragment suppression, which is the real
junk filter and runs BELOW it, so raising the ceiling cannot admit junk and
every plan under it is bit-identical.

Evidence: `a8` table recall **0.741 → 0.892**; every other fixture
byte-identical; Golden and ORNEK baselines "No regressions. 0 improvement(s),
0 note(s)".

New suite `large-venue-scale` (business/fast): asserts the ceiling is far
above real-venue scale AND drives a real 420-table / 900-guest / 4,200-seat
event through the domain — capacity arithmetic, assignment, a save round
trip. The second half is what would catch a loss introduced somewhere other
than the detector.

### C. §4 — physical chair / logical seat / capacity — DONE
Two collapses, both shipped, both closed.

**In storage.** `syncTableChairs` synthesised one chair object per capacity
slot for EVERY table and tagged the invented ones `physical:false`. A
420-table symbolic plan therefore stored **4,200 chairs at coordinates
nothing had ever observed**, re-derived and re-persisted on every save. A
flag disowning a coordinate is not the same as not writing it. `table.chairs`
now holds physical chairs only and is `[]` where the plan drew none; the
`physical` flag is retired, so presence in the array IS the claim. Existing
installs shed their fabricated chairs on the first load, through
`migrateEvent` — capacity, assignments and seat indexes untouched, and a
physical table's real coordinates carried across verbatim.

**In judgement.** "Can this table seat somebody" was asked as
`hasPhysicalSeats !== false && capacity > 0` in six places. On a symbolic
plan — numbered circles with a printed pax figure, an ordinary kind of venue
drawing — that answered NO for every table in the room: Smart Seating offered
nothing, freezes covered nothing, service load saw an empty room, the Plan
Doctor opened the event with "the plan carries no chairs" BLOCKING, and the
Home hero printed "No tables in the plan yet" over a 420-table plan — all
while Seating was assigning guests to those same tables. Seatability is now
`capacity > 0`.

New module `src/seat-model.js` (`globalThis.MeritSeatModel`, 91 lines, pure,
reads no shell state) holds the one definition of each quantity:
`logicalSeatCount` · `physicalChairCount` · `canSeat` · `drawsChairs` ·
`seatingCapacity` · `physicalCapacity` · `seatableTables`. Loaded as script
**4 of 35** in `index.html`, before `app.js`. Consumed by `app.js`,
`app-v8.js`, `plan-doctor.js`, `seating-advisor.js`, `seating-freeze.js`,
`service-load.js`, `table-availability.js`.

`MeritSeatingAdvisor`'s blocked reason `NO_PHYSICAL_SEATS` became `NO_SEATS`
— it names capacity, which is the real hard stop, instead of what the drawing
depicted. No i18n key referenced it.

Two suites re-specified against the corrected contract, both strictly
stronger than what they replaced:
- `physical-logical-seat-separation` asserted `chairs.length === capacity` on
  a symbolic table. It now asserts **zero** chair objects, that the flag is
  gone from the model, that a symbolic table still seats a +2 party on its
  logical seats, that detected coordinates survive a capacity sync
  byte-identically, and that the two totals stay different numbers.
- `smart-seating` asserted a symbolic table "is not a place to sit". It now
  asserts the symbolic table IS offered, and that a table with **no seats at
  all** is blocked as `NO_SEATS` — the genuine hard stop, tested against the
  engine because the shell clamps capacity to at least one.

One thing the step broke and the gates caught, worth recording because the
lesson is not about seats. Routing six consumers through the new module, I
pasted the same seven-line rationale comment into four of them —
duplication in prose, in the very commit whose point was one definition.
`offline-bundle-contract` failed: it identifies each source file inside the
bundle by the 160 characters at its midpoint, and `table-availability.js`'s
midpoint had landed on the duplicated passage, so its probe occurred four
times and the BUNDLE ORDER check became arbitrary. Nothing about the order
had changed. Fixed in both directions — the comment is one line per module
now, with the reasoning kept in `seat-model.js`; and the suite searches for
a window that IS unique instead of assuming the midpoint is one, asserting
the honest version of the control (every file must carry SOME uniquely
identifying window). Both halves proved to bite by mutation: sorting the
bundle alphabetically produced 18 out-of-order transitions, and making two
sources byte-identical produced 2 files with no unique window.

Docs corrected to match measured reality: `CLAUDE.md`,
`.claude/rules/product.md`, `.claude/rules/code-health.md`,
`merit-product-contract` (the "CURRENT LEGACY IMPLEMENTATION" section is gone
— the migration it described has happened), `merit-data-integrity-hardening`,
`APP-V8-OWNERSHIP-MAP.md`, `tests/README.md`.

---

## Measured after §8 + §4

| Fact | Value |
|---|---|
| `src/*.js` | 35 files, 19,009 lines |
| `app-v8.js` | 5,799 lines |
| `src/seat-model.js` | 91 lines (new) |
| `index.html` classic scripts | 35 |
| `MAX_TABLES` | **2000** |
| Offline verification | 27 / 27 |

---

### D. §11 — audit durability — DONE

`state.audit` is ONE root-level log shared by every event, and every write
ended with `state.audit.slice(0, 1000)`. Two kinds of loss followed. A
four-thousand-guest event audits one entry per arrival, so a busy door
erased that same event's `EVENT_CREATED`, its freezes and every teach
decision made while the room was set up. And because the log is shared, a
second event's check-ins evicted the FIRST event's decisions.

The product could not say what it had lost: the banner read "the oldest
entries across ALL events MAY have been superseded" — a warning shaped like
the defect, because nothing had been counted.

`src/audit-trail.js` (v2) now owns retention: `RETENTION_LIMIT` 100,000 and
`DISPLAY_LIMIT` 200 are two different constants answering two different
questions. `append` / `merge` report exactly what they dropped;
`recordEviction` accumulates it into `state.auditRetention`, which is
persisted and normalized on load and is never itself evicted. Storage is
IndexedDB (disk-sized quota), so 1,000 was never a storage constraint — it
was an arbitrary number below real operational volume, the same error as
`MAX_TABLES=240`.

`TRAIL()` moved to line 95, above `audit()`: a `const` arrow declared at line
600 is in its temporal dead zone for any call made while the IIFE body is
still running, and both `audit()` and `parseRoot()` can run during boot.

New suite `audit-durability` (33 checks). **Mutation-proved twice.** Putting
`RETENTION_LIMIT` back to 1,000 reproduces the original defect exactly — of
three events writing 601 entries each, `ev_0` ends with **0** and `ev_1` with
399, and the suite names it. Collapsing `displayWindow` to return everything
paints 1,504 rows instead of 200.

`audit-trail`'s cap section is re-specified: it asserted the "may have been
superseded" banner appears at 1,000 entries. It now asserts no banner when
nothing was lost, and a banner naming **402** when something was. The
`audit.capNotice` key is removed — the product can no longer produce that
sentence.

### E. §13 — write ordering and save atomicity — DONE

`saveQueue` already chained writes, so ORDER was correct. Three things it
did not cover, and all three were real:

**No caller could wait for a save.** `saveState()` chained onto the queue and
returned `undefined`, so `await saveState()` waited for nothing and resolved
before a byte was written. Found while writing §8's round-trip check, which
had to poll the store to work around it. A test can poll; an export about to
hand somebody a file cannot. It now returns the queued write, and the
returned promise never rejects (`persistPayload`'s final `.catch()` always
resolves), so awaiting is safe and not awaiting raises no unhandled
rejection. `touchEvent()` returns it too.

**A burst wrote every snapshot.** Each payload is a COMPLETE picture of
`state`, so twenty saves in one tick serialised and wrote twenty full copies
of the same room, nineteen superseded before anyone could read them. A
`pendingSave` slot now absorbs newer payloads until its write STARTS. This
cannot weaken last-write-wins — the pending slot is already the queue's
tail, so the newest snapshot still lands, and still lands last. Measured: 20
saves in one tick become **1** write; 3 saves each awaited before the next
produce **3**, in order.

**The retry wrote something else.** On failure, the image-stripping retry
rebuilt its payload from live `state` rather than from the payload it had
been handed. Mutate memory while the first attempt is in flight and the
retry persists whatever `state` had become, under the identity of a save
that was supposed to write the earlier picture. It now strips images from
THAT payload, and if the payload cannot be reshaped it fails rather than
substituting a different one.

New suite `save-ordering` (18 checks), including a delayed-storage reorder
test, an injected rejection, and a real page-reload equality check.
**Mutation-proved three times**, one per fix: returning `undefined` breaks
awaitability and collapses 3 sequential writes to 2; removing coalescing
turns 1 write into 20; rebuilding the retry from `state` persists an event
that was added mid-flight and that nobody asked to save.

One suite expectation of mine was wrong and was corrected rather than
worked around: I first asserted a 20-save burst should produce ≥2 writes.
It produces exactly 1, which is the correct behaviour for one tick — the
real property worth guarding is that saves separated IN TIME are not
folded, and that is now its own check.

### F. §12 — real schema migration registry — DONE

`parseRoot()` opened with `parsed.version=8; parsed.schemaVersion=8;`. It
**stamped** the version rather than reading it, and everything after was one
unconditional additive pass. Three consequences, worst last:

- Corruption was indistinguishable from age — `{}`, a string, an array, a
  root whose `events` was not a list, all "version 8".
- Nothing could be version-gated, so a step that changes what a field MEANS
  had nowhere to live.
- **A record from a newer build was silently downgraded and then
  overwritten.** Its version was replaced with 8, its unknown fields ignored,
  and the first mutation saved over it. The data was not misread; it was
  destroyed. The destructive half is the WRITE.

`src/schema-migrations.js` (script 5 of 36, before `app.js`) reads the
declared version, runs a sequential chain of named steps to
`CURRENT_VERSION = 9`, and returns one of three verdicts: `OK`, `FUTURE`,
`UNREADABLE`. `FUTURE` hands the root back **unchanged** and latches
`MERIT_SCHEMA_GUARD.readOnly`, which `saveState()` now honours — refusing to
read also refuses to write. The load path short-circuits too: falling through
to the legacy reader or a recovery snapshot would put something OLDER on
screen as though it were the record. The screen says which schema is stored
and which this build understands, in both languages.

The 8→9 step is **real, not scaffolding**: it is this programme's own §4
change expressed as a migration — a symbolic table's fabricated chairs are
emptied and the retired per-chair `physical` flag is dropped, with
`table.capacity` untouched. That is precisely the kind of non-additive step
the old unconditional pass could not express, so a v8 record and a v9 record
are now genuinely distinguishable.

There is deliberately **no `else` that stamps a version** when the module is
absent: that branch would silently reintroduce the defect, so a record keeps
whatever version it declared and nothing claims to have migrated it.

New suite `schema-registry` (33 checks). **Mutation-proved three times:**
removing the future guard downgrades a version-12 record to 9 and lets the
app write 8 over a version-99 record on disk, erasing its content; removing
the save guard alone does the same; ungating the chain makes an
already-current record run a step again, breaking idempotence.

**Found while mutating, deferred to §19:** `fmtDate()` throws
`RangeError: Invalid time value` on an event with no `date`. It only
surfaces when a malformed record is loaded, which the guard now prevents —
but a hand-edited backup could still carry one. Resilience work, not schema
work.

### G. §3C — `guest.assignment` single writer — DONE

The ownership map called this a **blocker**: the Guests, Seating and canvas
extractions cannot move while the field is written from everywhere, and it is
not itself an extraction, so it comes before them.

Measured before: **eleven** raw write sites across three files — eight in
`app-v8.js` (assign, two undo arms, rollback, table deletion, guest
restoration, unassign, unassign-undo), one live in `app-guests.js` (the
spreadsheet import), and two in `app.js` (the normalization default, and the
dead `seedAssignments` reachable only from `createDemoEvent`, which has no
caller). After: **zero** outside `src/seat-assignment.js`.

`MeritSeatAssignment` (script 6 of 37, before `app.js`) is the one writer.
It reads no `state`, no `ui`, and calls no `render()`/`touchEvent()` — a
guest and an assignment go in, the guest comes back normalized. It refuses an
assignment naming no table (which is the Plan Doctor's own
`guestAtMissingTable` blocker, prevented at the source), coerces seat indexes
to numbers and drops what is not one, and defaults `locked` to false.

**Two things it deliberately does not do.** It does not sort `seats` — the
order maps a party to its companions and `refreshChairOccupancy` walks it by
index, so tidying would silently reseat somebody. And it decides nothing
about capacity, freezes or locks; folding those in would make "the one
writer" quietly the one decision-maker.

The dead `seedAssignments` was routed through the writer rather than
allowlisted, so the static guard carries **zero exceptions**. Nothing was
deleted — `CODE-INVENTORY.md`'s removable count stays zero.

New suite `assignment-writer` (27 checks): a static scan of every `.assignment =`
in `src/`, plus assign / move / unassign / undo / locked / contested-seat /
table-deletion behaviour. **Mutation-proved twice:** reintroducing a single
raw writer is caught by the scan; sorting the seat order is caught by the
companion-ordering check.

Noted in passing, for §16: `deleteSelection()` still asks through a native
`confirm()`, which the suite has to accept.

### H. §7 — plan reliability — `a5` FIXED, `a2`/`a6` diagnosed

Adversarial moved from **1 PASS / 4 PARTIAL / 3 FAIL** to
**2 PASS / 4 PARTIAL / 2 FAIL**. Golden and ORNEK: *No regressions. 0
improvement(s), 0 note(s).* Every other fixture's metrics are unchanged —
no trade.

**Diagnosed before theorising, and two guesses were wrong.** A new
diagnostic, `benchmarks/adversarial/explain-candidates.mjs`, runs one
fixture through the real detector and prints the evidence attached to every
candidate. It reads only the product's own fields, never the declaration: a
signal that needs ground truth to compute is not a signal the detector could
use.

`a5-architecture-only` — **FIXED, now PASS.** The product already said
`kind: "UNKNOWN"` ("only 8 repeated objects, below the 20 needed") with
`tablesFound: 0`, and then typed 8 shapes as chairs anyway. Abstention was
reachable and not used. Two fixes, neither a threshold nor keyed to a
sample:
- A standalone chair is a claim about SEATING. When the plan reader returns
  UNKNOWN and its own evidence records no table at all, nothing anchors the
  claim: the shapes stay, the claim does not, in the "uncorroborated shape"
  vocabulary the size path already uses.
- `capacityUnknown` fired only when OCR could not run AT ALL, and the whole
  capacity block sat below an early return taken when nothing was found — so
  the one drawing that most needs the fact was guaranteed not to get it. The
  fact now follows the OUTCOME and names which route failed, in both
  languages.

Mutation-proved twice. Restoring the capacity silence drops the fact.
Restoring the chair claims brings back 8 phantom chairs **and** pushes
`capacityAudit.physical.seats` from 0 to 8 — the phantoms were not merely
visible, they were being counted as real seats.

`a6-architectural-confusion` — **diagnosed, NOT yet fixed.** 46 phantoms is
exactly the count of the fixture's 24 floor boxes + 10 plinths + 12
mullions. Two theories died on measurement: the phantoms are **not**
separable by "has an associated chair" (27 tables have one, 27 do not — not
8 / 46), and the architecture regions the harness scores against come from
the DECLARATION, so they are not a signal the product can read. The real
finding is **circularity**: 51 of 51 chair candidates associate to some
table, `standalone: 0`, so the representation classifier concludes PHYSICAL
at a 100% association rate — the phantom tables supplied the anchors that
justified the phantom chairs, which justified keeping both.

`a2-mixed-families` — not yet diagnosed. 7 real tables are detected and then
**held back as unknown** while 23 phantoms are kept, which is the reverse of
the abstention the product is supposed to have.

Neither open FAIL is "accepted" — they are recorded here as in progress,
which is the state the reliability contract requires instead of a silent
"known issue".

## Gates re-measured at `3451f67` (post-§8 + §4)

| Gate | Result |
|---|---|
| `npm run test:all` | **66 / 66 suites · 2,104 / 2,104 checks** |
| `npm run build:offline` · `build:offline-full` | 35 sources, `index.html` order |
| `npm run verify:offline` | **27 / 27** — both artifacts RUN |
| `npm run benchmark:baseline` | **No regressions. 0 improvement(s), 0 note(s).** |
| CI on head commit | 10 / 10 check runs green |

Golden plans unchanged: `merit-real-venue` square 37/37, round 4/4, bistro
5/5, chair F1 0.951, chair→table accuracy 0.99; `ornek-symbolic` tables
162/166, F1 0.985. `pageErrors=0` on both. Adding `seat-model.js` to
`index.html` changed nothing the detector does — which is what §4's script
tag needed to prove, rather than be assumed.

### Adversarial at `3451f67` — 1 PASS · 4 PARTIAL · 3 FAIL

Same distribution as `02edac7`; the run exits 0 because it gates on
regression against a baseline that already contains the three FAILs. That
is CI's first false-green mechanism, and it is why these numbers are read
here rather than taken from the badge.

| Fixture | Verdict | Table recall | Why |
|---|---|---|---|
| `a1-chair-under-table` | PARTIAL | 0.500 | 48 chairs seated at no table |
| `a2-mixed-families` | **FAIL** | 1.000 | 7 real tables detected then held back (unknown ×7); 23 FP vs 21 GT (precision 0.477) |
| `a3-no-anchors` | PASS | 1.000 | — |
| `a4-multi-room` | PARTIAL | 1.000 | bistro typed 0/8; chair recall 0.586 |
| `a5-architecture-only` | **FAIL** | 0.000 | 8 chairs proposed on a drawing with no furniture |
| `a6-architectural-confusion` | **FAIL** | 1.000 | 46 FP vs 8 GT (precision 0.148) |
| `a7-dense-overlap` | PARTIAL | 0.724 | bistro typed 0/7; chair recall 0.685 |
| `a8-large-venue` | PARTIAL | **0.892** | round typed 136/289; chair recall 0.089 |

**§8 confirmed at this HEAD.** `a8` was 0.741 = 240/324 exactly, the hard
cap. It is now **0.892** (289/324) with **precision 1.000 and zero false
positives** — the ceiling admitted 49 more real tables and no junk, which is
what "the fragment filter runs below the slice" predicted. `a8` remains
PARTIAL for reasons the ceiling never touched: chair recall 0.089 and round
typing 136/289.

## Next step

§7 — plan reliability. The three FAIL fixtures at `02edac7` are `a2`
(7 real tables detected then held back as unknown; 23 FP vs 21 GT), `a5`
(8 chairs proposed on a drawing with no furniture), `a6` (46 FP vs 8 GT,
architecture read as furniture). §8's ceiling fix already moved `a8`'s
table recall to 0.892. Re-measure `npm run benchmark:adversarial` before
choosing which to attack.

Also still open from the audit: §11 audit durability (`slice(0,1000)` at
`app-v8.js:87` and `:5529`, silent), §13 write ordering (`saveState()`
chains onto `saveQueue` but returns `undefined`, so no caller can await a
save), §14/§15/§19 security / accessibility / resilience (zero suites each),
§16 `confirm()`/`prompt()` removal (9 / 2).

## Permanent constraints (do not re-derive)

- No EXE, no Electron/Tauri/MSIX, no packaging-technology choice.
- No SQLite runtime. Storage boundary and migration design only.
- Do not merge PR #5. Do not touch other branches.
- No framework migration, no TypeScript, no bundler.
- Never lower a threshold, delete a fixture, or skip a test to get green.
- Never fabricate a human operator session or a third real plan.
- Synthetic fixtures are encouraged, and are labelled SYNTHETIC.
