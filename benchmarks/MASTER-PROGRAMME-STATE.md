# FINAL MASTER QUALITY & COMPLETION PROGRAMME — state

**This file is the programme's memory.** It survives session boundaries.
A session resuming this work reads this file and the repository — never its
own recollection.

- **Programme start SHA** `02edac7`
- **Branch** `claude/merit-concept3-plan-intelligence-rebirth`
- **PR** #5 — OPEN, must not be merged
- **Current SHA** see `git log` — §6 (mixed representation) is the last entry
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

`a6-architectural-confusion` — **measured, NOT fixed, and the next step is
specific.** 46 phantoms is exactly the fixture's 24 floor boxes + 10 plinths
+ 12 mullions. THREE theories died on measurement:

1. "Phantoms have no associated chair" — false. 27 tables have one, 27 do
   not, which is not the 8 / 46 split.
2. "Use the architecture regions" — impossible. Those come from the
   fixture's DECLARATION, so they are not a signal the product can read. A
   signal that needs ground truth is not a signal.
3. "The representation verdict is circular" — **my own over-claim, and
   wrong.** a6 has 8 real tables with 32 real drawn chairs, so `PHYSICAL` is
   the CORRECT verdict. The classifier is not the defect.

What the fields actually say, matched against ground truth (validation only
— no runtime branch may key on it):

| field | 8 real tables | 46 phantoms |
|---|---|---|
| `evidence.chairs` | **4** (min = med = max) | min 0, **med 0, max 1** |
| `confidence` | 0.66 | med **0.716**, max 0.753 |
| `sizeAgreement` | **0** | med 0.98 |
| `evidence.repetition` | 18 | med 18 |

So `evidence.chairs` separates them perfectly at ≥2 — and `confidence` is
**actively misleading**, scoring phantoms HIGHER than real tables.

**Why the obvious rule is not the fix.** "A table needs ≥2 associated
chairs" would delete a8-large-venue entirely: 289 tables there carry roughly
one chair each (chair recall 0.089). A trade like that is a revert, not a
win.

**A FOURTH theory then died, and it was my own proposed next step.** The
conditional form — "only lean on chair count where chair detection is
productive on that plan" — was measured across every fixture and does not
separate them:

| fixture | chairs per detected table | table precision | verdict |
|---|---|---|---|
| a1 | 12.13 | 1.000 | PARTIAL |
| a3 | 12.00 | 1.000 | PASS |
| a4 | 4.00 | 1.000 | PARTIAL |
| a7 | 1.76 | 1.000 | PARTIAL |
| **a8** | **1.06** | **1.000** | PARTIAL |
| **a6** | **0.94** | **0.148** | **FAIL** |
| a2 | 0.73 | 0.477 | FAIL |

a6 and a8 sit at essentially the same ratio — 0.94 against 1.06 — while one
is almost entirely phantoms and the other is perfect. The plan-level mean
carries no signal. (It also corrects a figure in the previous version of
this entry: a6 is 0.94 chairs per DETECTED table, not 6.4.)

**What is left, as a hypothesis and not a plan:** the difference is the
SHAPE of the distribution, not its mean. a6 is bimodal — 8 tables with four
seats each, 19 with one, 27 with none — while a8 is flat at roughly one
seat per table across 289 of them. A rule would have to say that a table
with markedly fewer seats than its own plan's well-seated population is
weaker evidence, which is a relative ranking rather than a threshold. That
is plausible and untested. It must be measured against a1 (12.13), a4
(4.00), a7 (1.76), a8 (1.06) and both golden plans before any of it is
written.

**a6 stays an open FAIL. It is not accepted**, and four theories about it
are now recorded as refuted so the next attempt does not re-derive them.

`a2-mixed-families` — **diagnosed, one half fixed, still FAIL.** The
held-back 7 were deselected by `selected: s.confidence >= confidenceThreshold()`
and nothing recorded the decision, so the operator saw a real table unticked
with no reason and the harness read the same absence as `unknown`. The
candidate now carries `lowEvidence: {reason: "belowReviewThreshold",
confidence, threshold}`, surfaced in both languages with BOTH numbers so the
decision can be judged rather than taken on trust. Measured:
`{"unknown": 7}` → `{"belowReviewThreshold": 7}`.

**The threshold is unchanged, and the fixture still FAILs.** Lowering 0.48
to make those seven tables pass would be tuning to a fixture, which this
contract forbids. The harness fails on `heldBack > 0` whatever the reason,
and a2's second FAIL line — 23 phantom tables against 21 real ones — is
untouched. What is fixed is the silence, not the verdict, and saying
otherwise would be the exact "true and misleading in the same sentence"
this skill exists to prevent.

Neither open FAIL is "accepted" — they are recorded here as in progress,
which is the state the reliability contract requires instead of a silent
"known issue".

### I. §9 — Visual Plan Memory / identity safety — MEASURED, next step specific

`npm run benchmark:memory`, 196 scoreable decisions across every scenario:

| gate | measured | required | met |
|---|---|---|---|
| retention | 0.7857 | ≥ 0.98 | no |
| identity precision | 0.9448 | ≥ 0.98 | no |
| **wrong application rate** | **0.0552** | ≤ 0.01 | **no** |

The gates are met on an UNCHANGED plan and missed on transformed ones.
The third row is the one that matters for identity safety: 5.5% of
remembered corrections are applied to the wrong object, against a 1%
ceiling. A wrongly applied correction is silent — the operator sees a
confident answer about the wrong table.

**The abstention machinery already exists and is well built.**
`src/plan-memory.js` grades every match on BOTH a score and a MARGIN
("a score alone cannot tell 'this is clearly the object' from 'two objects
fit equally well', and the second is how a decision quietly lands on the
wrong one"), and only `strong` and `likely` are applied. So the 5.5% are
matches that cleared `likely` — score ≥ 0.62 with margin ≥ 0.04 — and were
still wrong.

**The module's own doctrine names the fix.** The global-transform correction
ships OFF because it "recovers 3 decision(s) and misapplies 3 more", with
the reason recorded as: *a lost decision is reported and re-made; a wrongly
applied one is invisible.* The current grade thresholds violate that same
priority — they accept a 5.5% invisible-error rate to hold retention at
0.79.

**That next step was measured and it FAILED — the third of my own proposed
steps this programme has killed.** Sweeping the `likely` grade over 196
decisions:

| score | margin | retention | precision | wrong-rate |
|---|---|---|---|---|
| 0.62 | 0.04 *(was)* | 0.7857 | 0.9448 | 0.0552 |
| 0.62 | 0.08 | 0.7347 | 0.9412 | **0.0588 — worse** |
| 0.62 | 0.12 | 0.7194 | 0.9592 | 0.0408 |
| 0.68 | 0.08 | 0.7296 | 0.9470 | 0.0530 |
| **0.68** | **0.12** *(is)* | 0.7143 | 0.9655 | **0.0345** |
| 0.72 | 0.12 | 0.6990 | 0.9648 | 0.0352 |

**No setting reaches the 0.01 gate**; the best is 3.5× over it. And the
curve is not even monotone — tightening the margin from 0.04 to 0.08 makes
the wrong rate WORSE. Threshold placement is therefore not the fix. The
score cannot separate a right match from a wrong one on a transformed plan,
which is the same conclusion the ablation reaches when it reports the
learned embedding contributing **nothing measurable**. That is a SIGNAL
problem: a better feature, or a narrower claim about when memory may be
applied at all. It stays open.

**What shipped, and why.** `likely` moved to 0.68 / 0.12. Between two
settings that both miss the gate, this module's own doctrine decides — *a
lost decision is reported and re-made; a wrongly applied one is invisible*.
The change costs 7 points of retention (0.786 → 0.714) and removes **37% of
the invisible errors** (0.0552 → 0.0345), with precision rising 0.945 →
0.966. The numbers are in the source beside the constant so the next reader
does not re-sweep.

**The gate is still NOT MET and is not reported as met.** `benchmark:memory`
still prints `MEMORY GATES NOT MET on transformed plans`, and §9 is not
closed.

Two things the benchmark already reports honestly and that must not be
"fixed" by making them sound better: the learned embedding contributes
**nothing measurable** on this corpus (−2 decisions) and the neighbourhood
signature contributes nothing (−1).

### J. §10 — ORNEK robustness — RE-MEASURED, two findings retired, one real

`node benchmarks/robustness/run-robustness.mjs`: **no regressions against the
recorded baseline**, original tables F1 0.958 / 4 FP, chairs 107 TP / 5 FP.
Triage across the fifteen renderings of the one real plan: 6 HEALTHY,
2 ACCEPTABLE, 1 WEAK, **7 SEVERE**.

**The README's own findings were stale, and two of the three were wrong.**
Anyone reading it would have chased work that is already done:

- *"Padding alone costs 0.24 of table F1"* — **fixed.** `crop-pad` is now
  F1 0.968, 3 FP, recall 1.000: better than the original. Detection is
  translation-invariant on this corpus.
- *"Grayscale invents 561 chairs"* — **fixed.** Now 5 table FPs, chair F1
  0.897, ACCEPTABLE.

The README is rewritten from the current run.

**What is actually open, and it is one mechanism, not seven bugs.** Six of
the seven SEVERE rows fail identically — a global photometric change
explodes table FALSE POSITIVES:

| rendering | table FP | table F1 | chair F1 |
|---|---|---|---|
| original | 4 | 0.958 | — |
| jpeg-q20 | 26 | 0.769 | 0.960 |
| blur | 32 | 0.643 | **0.991** |
| bright-up | 48 | 0.586 | 0.935 |
| contrast-high | 49 | 0.561 | 0.978 |
| hue-shift | 52 | 0.559 | 0.974 |

Chair detection barely moves — blur posts its **best chair F1 anywhere**,
0.991 — so this is not "the image degraded". It is the TABLE path, and the
mechanism is in the source rather than inferred: `detect()` builds its luma
histogram, its **Otsu threshold**, its RGB colour model and its low/mid
chroma tone histograms over **every pixel of the canvas**. A global
brightness, contrast or hue shift moves all of them together and the
binarisation begins admitting background texture as components. The
remaining two SEVERE rows are the same statistics failing the other way:
`bright-down` recall 0.522, `lowres-roundtrip` 0.609.

**Next step:** make those global statistics robust to a photometric shift —
this is not a threshold to nudge. It changes the answer on every plan, so
the golden baseline, all eight adversarial fixtures and all fifteen
robustness variants must be measured together before and after.

### K. §6 — mixed / local representation — DONE, with the remaining gap named

**The defect, stated structurally.** The product answers "what KIND of
drawing is this?" **once, for the whole sheet**, and then acts on that one
answer **everywhere**. `src/plan-representation.js` takes plan-wide totals; the
swap that verdict triggers used to begin
`candidates.splice(0, candidates.length)` — every table on the drawing,
wherever it stood. That is sound while a drawing speaks one language. A venue
that publishes ONE sheet for a symbolically-numbered ballroom and a
physically-drawn terrace speaks two, and the majority then decides what the
minority is.

**New fixture `a9-mixed-representation`** (SYNTHETIC — does not count toward
REAL DISTINCT VENUE PLANS, still **1**). One sheet: a symbolic hall of 72
identical numbered discs with a printed capacity rule and not one seat drawn,
beside a drawn terrace of 3 round tables with 24 chairs. The terrace is the
control — an ordinary drawn-furniture layout of the kind a3 and a8 already
prove this pipeline handles. `make-fixtures.mjs` regenerates all nine
deterministically; the other eight are byte-identical (`git status` clean
after a regeneration), and FROZEN.json now covers nine.

**Measured first, and the first hypothesis was wrong.** The predicted failure
was the swap inverting the terrace. The actual first measurement was worse and
simpler: `associatedToTable: 0`, `tablesFound: 0`, **`uniformObjects: 72`** —
the terrace was already invisible before representation was ever consulted.
Its 24 chairs were detected (`dark-tone-cluster0`, 24 compact near-modal
components) and then dropped; its 3 tables were never proposed for want of
seats; and its chairs surfaced as 24 **columns**.

**Three root causes, each located at a line, each fixed without moving a
threshold.**

1. **The multi-family pass was unreachable on an ink plan.** The machinery
   that exists so "a 17px crescent is not asked to resemble a 34px armchair"
   sat inside `if (useColourOnly)`. A monochrome plan never opens that gate,
   so the sheet got ONE seat vocabulary set by whichever population was
   largest — here Hall A's 72 discs at 48px, applied to a room they are not
   in. The primary reference is now the largest chair source whatever it is
   made of; colour is still preferred where a plan has one. None of the pass's
   own safeguards was loosened.

2. **The size floor's anchor had an unchecked premise.** The floor says a
   minority seat is not an order of magnitude smaller than the plan's MAIN
   seat. Nothing checked that the main population was a seat. On this sheet
   `referenceSide` and `surfaceSide` are the same 48px — *the same objects* —
   so the band opened at 19.2px and the terrace's 18px family missed it by
   1.2px, with 24 of 24 members sitting against a table. The constant is
   **untouched**; the floor is now skipped only where the reference is not
   smaller than the plan's own surfaces, which is the premise itself and is
   stated three times elsewhere in the file.

   Measured across all eleven plans (`benchmarks/adversarial/family-anchors.mjs`,
   new): `referenceSide < surfaceSide` on a1, a2, a3, a4, a6, a7, a8 and the
   real venue plan — floor unchanged on every one. Equal on exactly three:
   a5, ORNEK and a9, which are exactly the plans with no seating drawn or none
   detected. **The decisive experiment**: setting the ratio to 0 outright
   changed **one** admission across eleven plans, and it was a real seat
   family. The floor, at 0.4, currently rejects exactly one family in the whole
   corpus and it is the correct one.

   Measured across all eleven plans (`benchmarks/adversarial/family-anchors.mjs`,
   new): `referenceSide < surfaceSide` on a1, a2, a3, a4, a6, a7, a8 and the
   real venue plan — floor unchanged on every one. Equal on exactly three:
   a5, ORNEK and a9, which are exactly the plans with no seating drawn or none
   detected. **The decisive experiment**: setting the ratio to 0 outright
   changed **one** admission across eleven plans, and it was a real seat
   family.

   **And that measurement was incomplete, which `npm run test:all` caught.**
   A twelfth plan exists — the drawing `symbolic-plan-detection` constructs in
   the browser, which is not in `benchmarks/` and so not in the sweep. There
   the floor WAS protecting something: dropping it admitted a family of four
   12px fragments standing among the symbols of a sheet with no seat on it,
   which then held four symbols out of the swap as "tables with drawn seats" —
   **48 tables for 44 symbols, and 6 seats claimed where none exist**. A
   diagnostic that reads only `benchmarks/` is not a sweep of the corpus.

   So the floor is replaced, where its anchor fails, by the measurement that
   answers the same question without that anchor: **does this family stand at
   its own tables, or among the primary family's members?** `crowding` was
   already computed and already written down as "reported, not gated on".
   Everything measured, in units of the primary family's own spacing:

   | | plan | crowding |
   |---|---|---|
   | debris | `downscale-70` | 1.04, 1.07 |
   | debris | the symbolic drawing | **1.07** |
   | real | `merit-real-venue` (5 admitted) | 1.75, 2.06, 2.34, 2.91, 3.34 |
   | real | a9's terrace | **3.73** |

   The gate sits at 1.4, between 1.07 and 1.75, and **applies only where the
   floor cannot** — on every plan whose reference really is seat-sized nothing
   changes and `crowding` stays reported and ungated, exactly as the code's own
   note asked. It fails conservatively, and the source says how: a second
   vocabulary drawn right among the first (a drawn top table at the front of a
   symbolic ballroom) reads low and is refused, which loses a family rather
   than inventing one.

3. **The swap acted beyond its own argument.** "These repeated marks sit at
   nothing, so they are not chairs" is a claim about the PRIMARY family and the
   tables size rank proposed out of it. A separately admitted family earned its
   place on the *opposite* evidence — most of its members against a table
   surface — so neither it nor the tables it seats was ever part of the claim.
   The swap is now scoped to the primary family; both exits
   (`familyLostToAssociation`, `familyLostToTextRun`) are filtered the same
   way, since their restoration is justified by "its table has just been
   demoted". `representationSwap` records `keptAsDrawnFurniture`,
   `keptDrawnSeats` and `drawnSeatFamilies`, because a swap that silently
   leaves part of a sheet alone is as large a claim as one that changes all of
   it. On a one-vocabulary plan there are no such families and this reduces
   object for object to the old behaviour — measured identical on ORNEK.

**Result on `a9`:** chairs **0 → 24 detected, recall 0 → 1.000, precision
1.000, F1 0 → 1.000**. Tables 72/75, precision 1.000. Verdict PARTIAL.

**What is NOT fixed, and the attempt that was measured and reverted.** The
terrace's three TABLES are still missed. Root cause located: the plan-wide
modal table area is 347px², taken from the **eleven title glyphs**, once the
furniture is outnumbered — the 104px tables are then pruned as "six times the
modal". The `modalPool.length >= 4` fallback reaches back to the unfiltered
pool, i.e. to the very components excluded on the line above for being smaller
than a chair. Returning `null` there recovers all three tables **and costs
more than it gains**: on `a5-architecture-only` two architecture components
then survive as tables, which disables the unanchored-seat abstention (it
requires `tablesFound === 0`) and brings back the eight phantom chairs §7
removed — **PASS → FAIL, two real abstentions lost, for three tables on one
synthetic fixture**. Narrowing it to "few, but not none" changed nothing,
because a5's own pool is between 1 and 3. Reverted, and recorded in the source
at the line so it is not re-derived. The real fix is a modal **local to a
region**, which is the same mechanism §10 names for the photometric
statistics.

**Suite** `mixed-representation` (intelligence, slow, 17 checks, real
detection on the real image). Mutation-proved three ways, each biting its own
claim and nothing else:

| mutation | result |
|---|---|
| family pass re-gated behind colour | 11/17 — families considered 0, 24 chairs lost |
| `referenceIsSeatSized` forced true | 13/17 — family considered 1, admitted 0 |
| swap made global again | 15/17 — **the 24 terrace chairs become 24 terrace tables** |

`symbolic-plan-detection` is the counterweight and is unchanged at 17/17: it
asserts that on a sheet with no seating every member of the family becomes a
table, no seat is claimed, and no chair is invented.

**Gates.** `npm run test:all` **72 / 72 suites · 2,258 / 2,258 checks**.
`build:offline` · `build:offline-full` · `verify:offline` **27 / 27**, both
artifacts run. Adversarial: **5 PARTIAL · 2 FAIL · 2 PASS** with a9 added —
the same distribution as before §6, **no new regressions**, a5 still PASS.
`npm run benchmark` then `benchmark:baseline`: **No regressions.
0 improvement(s), 0 note(s)** — golden `merit-real-venue` square 37/37, round
4/4, bistro 5/5, chair F1 0.951, chair→table 0.99; `ornek-symbolic` tables
P 0.994 / R 0.976 / F1 0.985, zero invented chairs. Unchanged is the point:
it is what confines this change to mixed sheets.

**A false green found in the gate itself.** `npm run benchmark:baseline` does
**not measure anything**. `record-baseline.mjs` reads
`benchmarks/reports/latest.json`, which only `npm run benchmark` writes, and
compares *that* to `BASELINE.json`. Run on its own it re-reports a stored
result and prints "No regressions" with full confidence. It was run twice
during this section and both times compared a run dated **2026-09-21**, from
before any of these changes — the numbers above are from the re-run after
`npm run benchmark`, dated 2026-09-22T07:24:37Z. Anywhere this programme or
its documents say "benchmark:baseline: no regressions", the question to ask is
whether `npm run benchmark` ran first. §27 owns the fix; it is recorded here
because it is exactly the kind of green that is worse than a red.

**And `benchmark:adversarial -- --compare` now exits 1**, where entry C at
`3451f67` recorded it exiting 0. The cause is the same a8 zone movement §8 left
unrecorded, not anything in §6.

### K2. §6 — the fourth instance, which only CI could see

The commit above was green on every local gate and **failed on CI**, on the
suite §6 had just added. Two separate faults, and the second is the more
important one.

**My assertion was wrong before the environments were.** It asserted that the
24 drawn seats arrive as 24 standalone chair objects *inside the terrace* —
a statement about how this sheet happens to be detected today, not about what
must be true. If the terrace's three tables were ever found, those same chairs
would become their seats, the better outcome, and the suite would have called
it a regression. It now counts the seats wherever the pipeline files them and
allows the terrace up to the 3 tables actually drawn there; 24 there still
fails, which is the inversion the fixture exists for. Re-proved with the same
mutation.

**And there was a real fourth instance of the mechanism, hidden by this
sandbox having no network.** Tesseract loads from a CDN, so OCR never ran
here; CI has network, so it did. The CI payload was identical to the local one
through the whole detector — `keptDrawnSeats: 24`, `promotedToTable: 72`,
`demotedFromTable: 11`, same anchors — and then **zero chair objects in the
result**. `suppressTextFalsePositives` in `app-v8.js` deletes any candidate
whose area is dominated by an OCR word box, exempting three things: it has
chairs at it, it is a member of the symbol family, or it is a column. A DRAWN
SEAT standing on its own qualifies for none of them — a chair has no chairs,
it is a real seat rather than a symbol, and it is not a column — so the filter
deleted the entire terrace.

The exemption list was written when a sheet was one thing or the other. The
fix is the same argument the other two exemptions already make: a family is
admitted on evidence a run of glyphs cannot produce — four or more members at
ONE repeated size and ONE repeated shape, ≥70% against a surface broad enough
to be a table, standing clear of the primary family — so the evidence that
made it a seat is the evidence that rules out text. Deliberately **not**
extended to the primary family: an unassociated primary chair really can be an
OCR'd glyph (that is a5's phantom-chair case) and has no adjacency evidence
behind it. Like the column exemption it can only ever KEEP an object, and it
is inert where no second family was admitted, so neither real plan can move.

**It is now provable here, not only on CI.** The suite stubs
`globalThis.runPlanOCR` before boot and claims the ENTIRE sheet is printed
text — not a plausible OCR result, the BOUND: every candidate's overlap ratio
is 1, so only the exempt survive and nothing else can answer the question.
Mutation (`isDrawnSeat = false`) reproduces CI exactly: `textSuppressed: 35`,
`drawnSeats: 0`, `tally: {table/round: 72}`.

**The lesson worth keeping:** a capability that is absent in the development
environment is not a capability that is absent in the product. Three of this
programme's gates ran green on a build whose text filter deleted a whole room,
because the thing that triggers it needs a network.

**A correction to entry B.** §8 reported "every other fixture byte-identical",
which was true of the *other* fixtures and silently passed over a8's own zone
rows: detecting 289 tables instead of 240 moved `a8 zones.precision 1 → 0.5`
and `zones.recall 0.5 → 0.25`, because the four annotated quadrants bleed
together once the aisles between them are filled. Both still show as
REGRESSED against the frozen baseline. Not caused by §6 and not fixed by it;
recorded here because it was not recorded then.

### L. §3A — detector modularization, Split A step 1 — DONE

**What moved.** `minAreaRect` (A-4) and `sameObject` / `boxIoU` /
`distanceToOBB` (A-9) → `src/plan-detection-geometry.js`, published as
`globalThis.MeritPlanGeometry`. `plan-detection-classical.js` **3,145 →
3,090**; the new file is 103 lines including its header. Chosen by the
ownership map's own risk ranking, not by line count: these four are pure
functions of their arguments, with no state, no DOM and no pixels.

**The crossing analysis came first**, measured in stripped code with
`tests/lib/js-scan.mjs` across every file in `src/` and `index.html`:

| direction | result |
|---|---|
| outward (region → file's scope) | **zero** — every identifier in all four bodies is a parameter, a local, or `Math` |
| inward (file → region) | four names; counts including each definition: `minAreaRect` 2, `sameObject` 7, `boxIoU` 3, `distanceToOBB` 2 |
| any other file, or `index.html` | **none** — one name entered the app's vocabulary, not four |

All ten call sites read `GEO.`, never a local alias sharing a name with the
function that used to live there. That is the rule `.claude/rules/code-health.md`
states for this move, and the reason is not style: an alias leaves every call
site reading exactly as before, which makes "did this reach past the boundary?"
unanswerable by reading the code.

**The seam is guarded.** `plan-detection-boundary` grew a section 5 (41 checks
total): the geometry file is an IIFE, publishes exactly one name, defines all
four, neither the pipeline nor the shell still defines any of them, the pipeline
makes **no bare call** to any of the four, it reaches each through `GEO.`, the
module resolves no name bound only in the pipeline or the shell, and — live in
the browser — a 10×10 square of points still comes back as an axis-aligned
rectangle. Mutation (`const sameObject = GEO.sameObject` plus the call sites
rewritten back) fails exactly three of those checks.

**And the move found a hole in the safety net, which is the more valuable
outcome.** Loading the new script AFTER the pipeline — which binds
`const GEO = globalThis.MeritPlanGeometry` at the top of its IIFE — passed
`boot-contract`, `smoke` **and** `plan-detection-boundary`, and threw
`Cannot read properties of undefined (reading 'sameObject')` on every real
detection. That is this file's own "booting is not detecting" lesson arriving a
second time, from the other direction: the first split lost `SKEW_MIN_DEG` and
the structural suites were blind to it; this one would have lost the whole
geometry group the same way.

`boot-contract` now **derives** the rule instead of listing three orderings by
hand: whatever a file publishes as `globalThis.Merit*` / `MERIT_*` must load
before any file that reads that name **at load time**. Load time is what makes
the rule true rather than merely strict — a read inside a function body runs
long after boot, which is why `plan-embedding` and `plan-intelligence` may both
reach for `MeritVisualEmbedding` although `app-v8.js` publishes it last. Zero
violations on the current tree; the mutation is now caught in **one second**
instead of a 102-second detection timeout, and every future module is covered
the day it is added — the property `dependency-direction` already had.

**Step 2 — A-6 + A-7** → `src/plan-detection-size-prior.js`
(`globalThis.MeritPlanSizePrior`, `PRIOR.` at all eighteen call sites).
`plan-detection-classical.js` **3,090 → 3,053**. Crossing analysis: outward
**zero**, inward `modalMagnitude` 11 / `sizeAgreement` 8 /
`symbolFamilyMember` 1, private the two symbol-family thresholds.
`MeritSymbolFamilyMember` was already public and is published under exactly
that name by the new file, so `symbol-family` is untouched — a move must not
rename a surface something else already reaches for.

The analysis is a tool now, `scripts/crossing-analysis.mjs`, because it is
about to be run six more times and doing it by eye is how the first split
failed. It reports OUTWARD / INWARD / PRIVATE and flags a name used on BOTH
sides as the cut being in the wrong place. **It is a place to start looking,
not a verdict**: it said `app-v8.js` names `sizeAgreement`, and app-v8 reads
`c.evidence?.sizeAgreement`, a property that happens to share the word.

**A-2 was measured and is NOT next, against the map's own LOW rating.** Its
five constants — `RGB_BITS`/`RGB_LEVELS`/`RGB_BINS`/`RGB_SHIFT` on one
four-declarator line, plus `LOW_CHROMA`/`MID_CHROMA` — are used on BOTH sides,
because `detect()`'s own pixel loop bins and thresholds chroma directly
(`RGB_BINS` 4 inside / 5 outside, `LOW_CHROMA` 1 / 2, `MID_CHROMA` 2 / 2).
Moving them breaks the other side; copying them creates two sources of truth
for one quantisation scheme. The colour/tone concern does not separate from
the histogram pass that feeds it, so it is Split B work rather than a helper
move. That is the map's "size does not predict difficulty" finding arriving
again from the other direction — this time a group rated LOW that measurement
says is not available yet.

**Step 3 — A-5** → `src/plan-detection-shape.js` (`globalThis.MeritPlanShape`,
`SHAPE.` at both call sites). `plan-detection-classical.js` **3,053 → 2,971** —
under 3,000 for the first time, **down 174 lines from 3,145** across three
steps. Its one outward name is `GEO`, and the tool now labels that a **MODULE
HANDLE** rather than shell coupling: a region depending on another module is
the direction this codebase wants, and the new file binds its own.

**The map was wrong about A-5, and the error was load-bearing.** It recorded
the dependency as `maskSolidity` (A-3), which would have tied a clean move to
the component labeller and its module-level `SCRATCH_QUEUE` — the one
MEDIUM-risk item in Split A. Measured: `shapeAnalysis` does not name
`maskSolidity` at all. **A map is the record of a measurement, not a substitute
for taking one again**, which is the same lesson the stale line numbers taught
one commit earlier.

A-5 also took `minAreaRect`'s last caller with it, so the pipeline no longer
calls it at all. The boundary suite's geometry check now asserts the handle
over every CALLER rather than over the one file that used to be the only one —
which is what a layered split looks like when it is working.

**Step 4 — A-8** → `src/plan-detection-split.js`
(`globalThis.MeritPlanSplit`). `plan-detection-classical.js` **2,971 →
2,888** — **257 lines out of 3,145 across four steps**. Outward zero; the
modal sizes it judges parts against arrive as parameters, which is what keeps
it from inventing a boundary. Inward one name. And `splitAlongAxis` became
**genuinely private**, internal to its one caller — the thing a split is for,
which moving lines does not achieve on its own. It also cleared a
`// ---- Candidate geometry helpers ----` banner A-9 had orphaned.

**It broke a check by succeeding, and the replacement is stronger.**
`plan-detection-boundary` guarded against its seam checks going vacuous with
`detBindings.size > 30`: if the binding extractor ever returned an empty set,
"app-v8 resolves no pipeline-only name" would be trivially true. Split A is
shrinking that surface on purpose and it reached exactly 30. Lowering the
number each time it bites is a check that never says anything, so it is now a
**positive control** — names that must still be found (`otsu`,
`CLASSICAL_CV_PROVIDER`, `estimatePlanSkew`, `GEO`, `PRIOR`) — plus a floor of
10 stated as a parser sanity check rather than a target. Mutation proof:
breaking the extractor's function-declaration regex fails the control while
leaving the old count above its floor.

**Step 5 — A-3's component layer** → `src/plan-detection-components.js`
(`globalThis.MeritPlanComponents`). `plan-detection-classical.js` **2,888 →
2,793** — **352 lines out of 3,145 across five steps**.

**Not the whole group, and A-2 is the reason.** The map's A-3 opens with
`buildClassMasks`, which calls `rgbBinIndex` from the colour model — the group
already measured as unavailable. So A-3 splits along a line the map did not
draw: PIXELS-TO-OBJECTS moves, and WHICH-PIXELS stays with the colour work it
depends on. After that split, outward **zero**.

**The MEDIUM rating was right, and it is about the buffer, not coupling.**
`SCRATCH_QUEUE` is one `Int32Array` reused across every flood fill;
per-component allocation would dominate the cost on a large plan and change
**nothing** about the output. It is asserted statically, and the mutation
shows why that is not belt-and-braces: with the buffer moved inside its own
allocator, `plan-detection-boundary` fails both checks while
**`structural-objects` — real detection on a real plan — passes**. A behaviour
test cannot see this one. It is the counterpart to "booting is not detecting":
**detecting is not the whole contract either.**

**Step 6 — A-1 deskew** → `src/plan-detection-deskew.js`
(`globalThis.MeritPlanDeskew`). `plan-detection-classical.js` **2,793 →
2,682** — **463 lines out of 3,145 across six steps, −14.7%**.

**It carries THE four names.** `SKEW_MAX_DEG`, `SKEW_STEP`, `SKEW_MIN_DEG`
and `SKEW_MIN_GAIN` are declared on one comma-separated line, and the first
attempt at extracting this pipeline captured only the first — leaving
`SKEW_MIN_DEG` in the shell while its value moved, so every REAL detection
threw `ReferenceError` while the syntax checks, `smoke` and all four
structural suites passed. They are now entirely private to the module that
uses them, and the mutation reproduces the original failure exactly: drop the
fourth declarator, re-declare it in the pipeline, and three checks fail.

The provider's `estimatePlanSkew` shorthand became
`estimatePlanSkew: DESKEW.estimatePlanSkew` — a shorthand for a local that no
longer exists is precisely how a move like this goes silently wrong, so the
suite asserts the explicit form. And this is **the only DOM-touching part of
the detector**; a worker-based detector cannot use a canvas, and that problem
is now a 156-line file instead of a paragraph inside a three-thousand-line one.

**A duplication finding, recorded not acted on.** The crossing report flagged
that `src/plan-embedding.js` names `otsu`, and it does — its own, taking raw
pixels of a 32×32 crop where the detector's takes a histogram the caller
already built in one pass. Same algorithm, two input contracts, each with a
stated reason. `benchmarks/CODE-INVENTORY.md` §2.1b records it as NEEDS TEST
FIRST: **a structural move is not the place to decide a duplication question.**

**Gates.** `npm run test:all` **72 / 72 suites · 2,352 / 2,352 checks** (+90
from the seven seam guards; 2,283 / 2,299 / 2,311 / 2,322 / 2,338 after steps
1–5). `build:offline` · `build:offline-full` ·
`verify:offline` **27 / 27**, both artifacts run, 38 sources bundled.
`npm run benchmark` then `benchmark:baseline` — measured fresh after **each**
step, not re-read — **No regressions. 0 improvement(s), 0 note(s)** both
times, which is the whole claim a behaviour-preserving move is allowed to
make.

### M. §3B measured, §3D/§3E started with the prerequisite the inventory named

**§3B — Split B was measured, not started.** `scripts/stage-boundaries.mjs`
counts, per stage of `detect()`, what it declares, hands forward, and inherits.
`chairs` (666 lines) and `tables` (1,241) are **78%** of the function;
`(assemble)` inherits from every stage and is the return value, not a stage;
`fillMask` hands nothing forward, which is the shape of a real cut; and the
`chairs → tables` ordering is measured rather than asserted — `chairModal`,
`chairUniform`, `chairs` and `chairSource` all cross it.

The crossing count is reported as an **upper bound (~73)** and the tool says so
in its own output. Scope in JavaScript cannot be read with regexes: two
refinements took it from 92 to 73 and the remainder needs a real parser.
Publishing 73 as a count would be a precise-looking number standing on an
imprecise method. Split B stays a design job, now with the design stated: the
two large stages cannot leave `detect()` until what they hand forward becomes an
explicit structure. ~1,900 lines with a detector at the end of it — its own
session, `npm run benchmark` after every step.

**§3D/§3E — the prerequisite first.** `benchmarks/CODE-INVENTORY.md` §3 named
one missing test as "a prerequisite for any work in this area":
`commitCandidates` writes confirmed chair coordinates directly rather than
through `syncTableChairs`, deliberately, and **nothing protected that**. A
"keep capacity and chairs in sync" cleanup would replace every confirmed chair
with a synthetic ring, and no suite would fail.

New suite `confirmed-chair-coordinates` (business, fast, 21 checks) drives the
real review-screen confirm button and asserts the committed chairs **exactly**,
on position and rotation, against coordinates derived from the same inputs. The
planted chairs are deliberately irregular — three along one side at uneven
spacing, one alone opposite — because a generator's four points at 90° on a
circle are plausible, tidy, and a fabrication nobody can spot on the floor plan.
It also covers the negative half: a table committed off a SYMBOLIC plan carries
**no chair objects at all**, with `capacitySource: "UNKNOWN"`.

**The mutation is the exact refactor the inventory warned about**, and it
proves the claim in full: routing through `syncTableChairs` replaces the
detector's coordinates with a ring at 0°/90°/180°/270°, the new suite fails
eight checks — and **`physical-logical-seat-separation`, the existing suite in
this area, passes**.

Two things the suite had to learn, both recorded in it: the review screen is
`ui.tab = "floor"`, not `"plan"`; and a hand-built analysis must carry the
fields the real pipeline writes (`comparison`, `memory*`, `ocr`, `timings`) or
`render()` throws before the control exists. `planIntelligence` is built with
the product's own published `buildPlanIntelligence` rather than hand-shaped, so
the suite cannot pass against a structure the product would never produce.

**Gates.** `npm run test:all` **73 / 73 suites · 2,373 / 2,373 checks**.
`build:offline` · `build:offline-full` · `verify:offline` **27 / 27**. No
production file changed in this step.

### N. §3D + §3E — the inventory's actionable items, closed

`benchmarks/CODE-INVENTORY.md` is the recorded evidence this section works
from, and every actionable line in it is now closed:

| inventory item | before | now |
|---|---|---|
| unreferenced functions | 0 | **0** — nothing to delete, re-confirmed rather than assumed |
| SAFE TO EXTRACT | 1 | **0** — `keepLesson` extracted (`dae3d66`) |
| verbatim chair write, "no suite would fail" | unguarded | **guarded** — `confirmed-chair-coordinates` (`d956cdc`) |
| venue-scope refusal, "write before extracting" | missing | **written first** — `teach-venue-scope` (`4a5361c`) |
| two `otsu` implementations | unrecorded | **recorded** NEEDS TEST FIRST (§2.1b) |

**The two characterization suites share one finding, and it is the reason this
section was worth doing.** In both cases the inventory cited existing coverage
for the area, and in both cases the mutation that matters — routing confirmed
chairs through the ring generator; defaulting a confirmed number to the
object's absent one — **failed only the new suite while the cited ones
passed**: `physical-logical-seat-separation` in the first, `plan-teach-area`
and `teach-number` in the second. Coverage that is real and blind to the one
line that matters is what "characterization before restructuring" exists to
catch.

**`keepLesson` saved 3 code lines, not the ~18 estimated.** Recorded as such.
Its value is that the store / audit / re-apply sequence can no longer drift
between two paths, and that `printedNumber` is **required** — `undefined`
throws a named error — so the load-bearing difference is enforced rather than
remembered.

**What §3D does NOT include, and why — an ordering decision, written down as
the programme requires.** `benchmarks/MODULARIZATION-ORDER.md` puts the screen
extractions (Guests A21, Seating A17, canvas A12) after the `guest.assignment`
single-writer step, which §3C completed, so they are technically unblocked.
They are also the three HIGH-difficulty areas in the ownership map, measured,
and each moves UI and domain code together. Doing them now would put the
largest-risk refactors of the programme ahead of **§14 security, §15
accessibility and §19 resilience, which have ZERO suites between them** — the
largest measured gap left. That is not reordering the user's list: §14–§19
follow §3D/§3E in it. It is declining to expand §3D beyond its inventory into
work the map itself rates hardest, and leaving that work recorded with its
prerequisites met.

**Gates.** `npm run test:all` **74 / 74 suites · 2,383 / 2,383 checks**.
`build:offline` · `build:offline-full` · `verify:offline` **27 / 27**.

### O. §14 — security — DONE, from zero suites to five

The skill's rule decided the approach: "'We use `esc()`' is not evidence. A
hostile-input fixture that passes is." Measured at entry: 335 `esc()` calls,
13 `innerHTML` + 1 `insertAdjacentHTML`, 0 `eval`, object URLs 4/4, and **no
security suite at all**. Every row below was a measured failure through the
real controls before it was fixed, not a hypothetical.

| finding | measured | now |
|---|---|---|
| `__proto__`/`constructor`/`prototype` in a backup or package | Object.prototype clean (every copy spreads) — but the keys rode into state, were saved and re-exported, dormant until the first `Object.assign` | dropped at the record boundary by `MeritSchemaMigrations.parseRecord`, incl. `\u`-escaped spellings (`4ee0935`) |
| backup from a newer build | uncaught throw, no message, **and the read-only guard latched on the healthy CURRENT install** — it silently stopped saving | refused with a message; an import never latches the guard (`3cf39fa`) |
| `guests:[null]`, `tables:"abc"` | TypeError out of the file reader, no message | refused whole, naming the path, before confirm() |
| unreadable event date | accepted, saved, then `fmtDate()` threw out of every render — **the install was dead across reloads** | import refuses it; `fmtDate()` is total ("—") — closes the §19 row below |
| `additionalGuests: 1e9`; sheet `"1e9"`, `"0x10"` | a guest of a billion; `Number()` read hex | 0–99 (the dialog's own bound), plain decimals only; `"3.00"` still 3 |
| an id carrying a quote | restored; ids are interpolated as attribute values | refused (`[A-Za-z0-9_.:-]`) |
| noise named `.xlsx`; a broken PNG | reached the preview (SheetJS sniffs content); became the floor plan | ZIP signature required for `.xlsx`; plan, cover and replace images must DECODE |
| a corrupt stored record | its JSON `SyntaxError` quoted the guest name into the console **three times per boot** | `loggableError()` withholds the excerpt (and the stack that repeats it) |
| any payload through any screen | — | **nothing fired**: `hostile-input` walks every screen with a payload in every field, typed, imported and read off a plan by OCR |

**Five suites, each mutation-proven:** `prototype-pollution` (29) ·
`malformed-import` (125) · `hostile-input` (73) · `html-sink-inventory` (9) ·
`privacy-logs` (5). The one that carries the skill's claim is
`hostile-input`'s mutation H2: removing ONE `esc()` from the finder's result
row is found at the finder, which no count of escape calls could do.

**All 14 sinks traced**, keyed by file + enclosing function (brace-matched —
"nearest function above" named three of them wrongly) + target. Twelve are
small enough to read and their inputs are written down; the two `render`
sinks write every screen and their evidence is the fixture, not a reading.

**CSP readiness, measured:** 0 inline event-handler attributes (now guarded),
1 inline `<script>` (the pdf.js bootstrap — needs a hash; guarded at 1),
66 inline `style=""` (needs `style-src-attr`; a policy decision, recorded not
guarded), a `blob:` OCR worker in the CDN build only (the offline-full build
spawns it directly). Nothing here authorises writing a CSP before the
desktop gate; it records what one would cost.

**Also found while writing the suites, recorded rather than fixed:** a
restore reads its payload TWICE (once to validate, once in `parseRoot`), so
an escaped-key fixture cannot distinguish a sound fast path from an unsound
one on that path — the package path reads once and is where mutation M4
bites. SheetJS renames a `__proto__` header to `__proto___NaN`.

### P. §15 — accessibility — DONE to the skill's "9" bar, one row NOT VERIFIED

The rule that decided the approach: "Adding `aria-*` attributes is not
accessibility work. The evidence that counts here is a completed operator
task without a mouse." At entry: 21 `aria-*`, 9 `role=`, **0 suites**.

| evidence the skill requires | suite | measured before | now |
|---|---|---|---|
| automated scan, every screen, both languages | `a11y-scan` (42 screen states) | **202 failing nodes, 69 distinct** — `--pi-muted` 4.46:1, `--pi-muted-2` **2.80:1**, 35 visible labels tied to nothing, unnamed selects/inputs in the wizard, the finder's listbox rows containing buttons | **0** WCAG A/AA violations, EN and TR |
| real keyboard workflows | `a11y-keyboard-workflows` (11 tasks) | "number a table" and "seat a guest" **could not be finished**: canvas tables and Seating guest cards were pointer-only `<div>`s | all 11 finish with Tab/Enter/arrows only, each reached control shows visible focus |
| focus enters, is trapped, is restored | `a11y-dialog-focus` | Tab from the last control of **all three** native dialogs dropped focus to `<body>`; the import wizard opened on its close button and lost focus on every step | wrapped, first meaningful control, restored to the invoker after Escape AND after the close control |
| live region announces an arrival | `a11y-announce-contrast` | a check-in was announced by nothing; every toast, errors included, was polite | a boot-time polite region outside `#app` says only "NAME: Checked In"; errors are `role=alert` |
| contrast from rendered pixels | `a11y-announce-contrast` | — | measured from screenshots on the shell and the `--pi-*` surfaces, all ≥ 4.5:1 |

**Also guarded there:** frozen, unavailable, VIP and No Show each carry a
non-colour cue (icon + dashed outline, icon + hazard stripes, written text);
the guest list is a named `role=table` with one cell per column header;
`prefers-reduced-motion` collapses transitions.

**Mutation proof, nine:** `--pi-muted` restored (12 scan failures), one label
un-associated (2), no Tab wrap (4), wizard focus left to `showModal` (1), no
keyboard activation, tables without a tab stop, a silent announcer, polite
errors, the guest list back to divs — each fails its suite. One of them
exposed a hollow check first: adding tables SELECTS them, so "table 1 is
selected after Enter" was true before any key. The suite now targets a table
that is provably not selected and asserts that precondition.

**Colour, not just numbers:** same hues, darkened until AA; `--pi-muted` /
`--pi-muted-2` stay one visible step apart (6.6 vs 5.3:1). Rendered before
and after at 1920×1080, 2560×1440 and 1440×900 on Floor Plan (card
selected), Live and Guests: the hierarchy reads the same, the Check In
button is a deeper green, zero page errors at every size.

**Written limitations, with the alternative path, as the skill requires:**
- A 420-table venue is 420 tab stops on the canvas. Not a trap — Tab leaves
  — but long. The alternative path to one table is the global finder.
- The OS file picker cannot be driven by keyboard in any harness; the
  import is OPENED by keyboard and the file handed over at the picker.
- `a11y` needs `axe-core` (MPL-2.0), pinned exactly, a TEST-only dependency:
  neither offline build contains it.

**NOT VERIFIED — and not claimed:** the skill's "10" is "verified with a real
screen reader". No screen-reader session has been run; none is fabricated
here. That row stays open until a person runs NVDA or VoiceOver against it.

### Q. §19 — resilience — DONE for the failure modes the skill lists, each measured first

The skill: "The data is the event … the one that matters most is PRESERVE." At
entry: **zero** resilience suites. Every row below failed through the real
product BEFORE its fix, proven by running the new suite against the previous
commit, not assumed.

| failure | measured before | now | suite |
|---|---|---|---|
| **the stored record cannot be read at boot** | app opened EMPTY with no word said; the **first save overwrote the unreadable record** — destroyed a record one hand-edited quote from readable | copied aside byte-for-byte (`quarantine:<time>`) before anything runs; a persistent notice says it was NOT deleted, with Download and Restore; if even the copy fails, the session refuses to save | `resilience-storage` (12 fail on the old code) |
| storage will not open at all | same silent blank, then saves written over a record never read | announced; nothing written over it this session | `resilience-storage` |
| quota exhausted mid-save | one toast, gone in 6 s | a notice that STAYS until a save succeeds, backup download beside it (works while storage fails); disk keeps the last good record | `resilience-storage` |
| a blank install's schema stamp | saved as version 8 with the registry at 9 | `CURRENT_VERSION` | `resilience-storage` |
| detector fails mid-run | the new analysis replaces the old one PART-WAY through, so a failure after that left a half-built analysis — under "Nothing was changed" | the previous analysis is restored; the sentence is now true | `resilience-detection-render` |
| Re-Analyze while running | 3 presses → **3 pipelines** interleaving writes | 1 | `resilience-detection-render` |
| a screen that throws | escaped `render()` uncaught; stale DOM left bound to moved-on state | a translated recovery screen (`role=alert`): back to events, or a backup; still logged as an ERROR so render bugs stay loud elsewhere | `resilience-detection-render` |
| a raw `error.message` on screen | **8 surfaces** + the OCR engine's own sentence in the review title | translated text; `meritUserMessage` for errors raised FOR the operator; `reasonCode` for OCR | `resilience-static` |
| empty `catch` / swallowed rejection | 0 empty; one `.catch(()=>null)` (a genuine abstention) | guarded; the abstention carries its marker | `resilience-static` |
| dangling table / seat beyond capacity | already right: opens, BLOCKING Plan Doctor findings on screen, **not** silently repaired | characterised; a silent-repair mutation fails 4 checks | `resilience-persisted` |

**Fault injection (evidence 1)** is `tests/lib/faults.mjs`: switchable faults
in the browser's own IndexedDB `put`/`open`, armable before boot, a bypass for
the suite's own reads and writes, and `throwFrom("Module.method")` for a named
boundary. It never stubs the product's functions.

**Also found:** `hostile-input` failed 1 run in 6 when a render landed
mid-fill — the step now reads the form back before saving, the way `addGuest`
already did.

**Not covered, named:** "write succeeds, read-back differs" and "save during
unload" have no suite of their own; the unload race is guarded by
`bootReady` (`save-ordering`). 50k-row XLSX and a 40-page PDF are
performance questions and belong to §26.

### R. §16 — native `confirm()` × 9 / `prompt()` × 2 — DONE, and three real bugs found on the way

All eleven are gone (nine were live; two sat in overridden pre-v8 bodies and
were converted so the count is a clean zero, now enforced statically). One
in-app dialog replaces them — `ask()` in `src/app.js`: yes/no or a bounded
integer, translated, every text set with `textContent` (a guest's name in a
question cannot become markup), Escape and Cancel always NO, a destructive
question opening on Cancel, a number opening in its field with an
out-of-range answer refused IN the dialog and the reason tied to the field.
It is registered with the focus-return mechanism and passes
`a11y-dialog-focus` (now 33 checks) like the other dialogs.

`native-dialogs` (29 checks) drives every live site twice — Cancel/Escape must
leave state byte-identical, yes must act. Writing it found:

| bug | what happened | fix |
|---|---|---|
| **Cancel on "delete table" asked again** | two global key handlers (app-guests.js, pre-v8 but live, and app-v8.js) both handled Delete; with a blocking `confirm()`, Cancel on the first produced the same question a second time | the duplicate branch removed; one press asks once (counted) |
| **Escape in a dialog cleared the selection behind it** | the app's global Escape handler ran as well; Delete / arrows on a dialog button could delete or nudge the table under it | an open dialog owns the keyboard: both global handlers yield to it |
| **PDF plan import was broken on Chromium 141** | pdf.js 5.7 calls `Map.prototype.getOrInsertComputed`, which this browser generation lacks; getting ANY page threw — the new-event form and Replace Plan alike. No suite rendered a PDF page, so nothing said so | the standard polyfill, defined only where missing, in a classic script that runs before the deferred pdf.js module in all three builds |

Mutations: a native `confirm()` restored (4 fail), Escape leaking past the
dialog (2), the polyfill removed (1), the number range unenforced (4). The
duplicate Delete handler, restored, is now HARMLESS — the dialog-owns-keyboard
guard makes the second handler yield — so its removal is recorded as cleanup
and the one-question-per-press count guards the behaviour instead.

Fourteen suites answered the browser's confirm with `page.on("dialog")`; they
now use `autoAnswer(page)` (tests/lib/app-actions.mjs), which answers the
product's dialog the same way. `assignment-writer` awaits the deletion it
starts, because the answer is no longer synchronous.

Gates: `npm run test:all` **88 / 88 suites · 2,851 / 2,851 checks**;
`verify:offline` **27 / 27** on both rebuilt artifacts.

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

**§17 — toast.** Per `merit-ui-quality-gates`: a toast is a transient
confirmation, never the only carrier of an error an operator must act on
(§15 and §19 already moved the two worst cases — failing saves and
unreadable storage — to persistent notices). Measure every `toast(` call by
type and message, find errors that exist ONLY as a toast, and hardcoded
English passed straight to toast() (`translateToast` maps some; measure how
many reach the screen untranslated in TR).

Then, in the order given: §18 localization, §20–§25 UX, §26 performance,
§27 real CI release gates (incl. the `benchmark:baseline` false green and
`--compare` exit 1), §28–30, then the final review and completion matrix.

Deferred with recorded prerequisites met, not forgotten: Split B (a design
job, §3B measured), the screen extractions A21/A17/A12 (entry N).

### Open, measured, NOT accepted

| item | state |
|---|---|
| `a6` | FAIL. Four theories refuted and recorded. Surviving hypothesis is the SHAPE of the chairs-per-table distribution, not its mean; untested. |
| `a2` | FAIL. The silence is fixed (`lowEvidence` names confidence and threshold in both languages); the verdict is unchanged and the threshold is deliberately not lowered. |
| `a9` tables | 3 of 75 missed. Cause measured: the plan-wide modal table area is set by the title's glyphs. Abstaining costs a5 two abstentions — reverted, recorded at the line. Needs a modal local to a region. |
| §9 identity | Wrong-application rate 0.0552 against a 0.01 ceiling. A signal problem, not threshold placement: no setting reaches the gate. |
| §10 photometry | Six SEVERE robustness rows share one mechanism — Otsu, colour and tone statistics computed over the whole canvas. |
| §19 | ~~`fmtDate()` RangeError on a dateless event~~ — **closed in §14** (`3cf39fa`): `fmtDate()` is total, and imports refuse an unreadable date. |
| a8 zones | `zones.precision 1 → 0.5`, `recall 0.5 → 0.25` since §8 detected 289 tables instead of 240. Arithmetic consequence, not a defect in §8, but it makes `--compare` exit 1. |

**One mechanism keeps recurring across §6, §9 and §10, and it is worth naming
once:** a statistic computed over the WHOLE drawing — Otsu's threshold, the
modal chair size, the modal table area, the family size band's two anchors —
applied to a part of the drawing it was not measured in. §6 fixed three
instances of it by fixing anchors and scopes rather than constants. The ones
left are the ones that need the statistic itself to become local.

## Permanent constraints (do not re-derive)

- No EXE, no Electron/Tauri/MSIX, no packaging-technology choice.
- No SQLite runtime. Storage boundary and migration design only.
- Do not merge PR #5. Do not touch other branches.
- No framework migration, no TypeScript, no bundler.
- Never lower a threshold, delete a fixture, or skip a test to get green.
- Never fabricate a human operator session or a third real plan.
- Synthetic fixtures are encouraged, and are labelled SYNTHETIC.
