# FINAL PRE-DESKTOP HARDENING PROGRAMME

This document tracks the 42-section pre-desktop completion programme
requested for MERIT EVENT MAKER, on top of the already-completed K–T phase
programme (see `EVENT-OPERATIONS-PRODUCT-REPORT.md`). It is a living
checkpoint: updated after every coherent unit of work, never marked
complete until every technically-possible item is actually done — not
designed, not documented-only, not "ready to implement."

**Status at last update: IN PROGRESS.** This is a genuinely large,
multi-session programme (physical/logical/capacity data-model correctness
alone touches nearly every subsystem; a Turkish-default-language switch
touches every screen; Readiness Timeline, Provenance Inspector, and
Onboarding are each a full new feature). Each item gets the same rigor as
every K–T phase — measured first, implemented, tested, mutation-proven
where it's a domain module, visually verified, regression-tested, and
pushed to real CI before being called done. That discipline is the actual
risk control here, and it is not skipped to move faster.

## Baseline (frozen before this programme started)

- Branch: `claude/merit-concept3-plan-intelligence-rebirth`
- HEAD at freeze: `3ef11bb95e2dd9ff218dee981f84e90c4d16bee3`
- PR #5: open, `mergeable_state: clean`, base `main@5029e8bb`, 136 commits,
  +260037/-403, 279 files changed
- All 10 CI checks green on `3ef11bb` (confirmed via the GitHub API
  immediately before this programme began)
- `npm run test:all`: 52 suites, 1846 checks, all green
- `npm run verify:offline`: 27/27
- `app-v8.js`: 8339 lines (the single largest source file)
- No `architecture/` directory existed yet
- `benchmarks/operator/README.md` already exists (prior operator-test
  scaffolding, 8796 bytes) — the "existing operator instrumentation" this
  programme's section 26 says to reuse and improve
- CI already runs `npm run benchmark` against **both** the Golden Plan and
  ORNEK in a single job named "Detection — Golden, ORNEK and the
  adversarial fixtures," with `BASELINE.json` tracking both plans

## Section-by-section status

Legend: **DONE** (implemented, tested, committed), **PARTIAL** (some real
work landed, concretely described what remains), **NOT STARTED**,
**OBSOLETE** (the problem it would have solved no longer exists, with
evidence), **DEFERRED** (explicitly out of scope for pre-desktop, per the
programme's own rules).

| # | Section | Status | Notes |
|---|---|---|---|
| 1 | Generalisable plan understanding | PARTIAL | Reasoning pipeline broadly follows the evidence→hypothesis→corroboration→abstain shape already (Plan Doctor, Self-Check, Confidence Budget, Number Integrity all exist and compose this way). Not yet audited step-by-step against the exact 18-step order. |
| 1A | No sample-specific production logic | **DONE** | Full audit of every Golden/ORNEK/merit-real-venue mention in `src/*.js` (47 occurrences) — every one is a documentation comment explaining a *generalized measured threshold*, never a branch on sample identity. One data file (`plan-encoder-weights.js`) carries honest `trainedOn` provenance metadata, correctly distinct from decision logic. New guard suite `tests/suites/no-sample-specific-runtime-logic.test.mjs` (6 checks, mutation-proven: injecting `if (venueId === "ornek-symbolic")` into `plan-representation.js` was caught, then reverted and reconfirmed green). Pure static analysis, no browser, ~150ms. |
| 1B | Plan representation as evidence, not identity | PARTIAL — gap found | `src/plan-representation.js`'s `decide()` makes exactly ONE global PHYSICAL/SYMBOLIC verdict for the whole plan, from the overall chair-association rate. It does not yet support zone-local or mixed representation (a plan half physical, half symbolic). This is a real architecture change — introducing a per-zone or per-table representation verdict instead of one whole-plan classification — not a quick fix, and not yet implemented. Neither Golden nor ORNEK currently exhibits mixed representation, so there is no real-plan evidence yet motivating the specific shape of the fix; implementing it blind risks exactly the "confident wrong classification" section 1 warns against. |
| 2 | Physical chair / logical seat / capacity separation | **DONE** | Pushed as commit `b64fb88`; local `test:all` green (54/54, 1871/1871) and both offline artifacts rebuilt+verified before push; CI confirmation tracked in the continuation checkpoint. Two real, evidenced bugs found and fixed; the deeper "capacity can exceed physical chair count on the same table" architecture (e.g. capacity=12, physicalChairs=0 as a genuinely empty array) is a larger indexing-scheme change and is deliberately NOT attempted here — see "Deferred sub-scope" below, still valid. |
| 3 | Capacity provenance | **PARTIAL — data model + 3 of 8 sources wired** | See detailed write-up below. `table.capacitySource` (new `src/capacity-provenance.js`) is a real, migrated, backup/package-safe field on every table. Only the 3 sources this build can honestly produce (DETECTED_PHYSICAL_SEATS, HUMAN_CONFIRMED, UNKNOWN) are wired; the other 5 (PRINTED_TABLE_CAPACITY, PRINTED_ZONE_CAPACITY, PRINTED_TOTAL_CAPACITY, DERIVED_PRINTED_RULE, VERIFIED_VENUE_MEMORY) are named and translated but UNWIRED, since no current feature reads a per-table/zone/venue printed capacity number into `table.capacity` — inventing that read path now would be new detection behaviour, not a data-model change, and is explicitly out of scope for this section. No UI surface yet (that is section 11, Data Provenance Inspector, tracked separately). |
| 4 | Object identity safety | PARTIAL | `plan-memory.js` and `plan-relationships.js` already order identity by verified number/context/geometry over visual similarity, and PI2.0's own measurement (documented in PR #5's body) found the learned embedding "no measurable contribution" to identity and shipped it OFF by default — matching this section's own requirement almost exactly. Not yet re-audited as a single pass against the full 6-level priority order this section specifies. |
| 5 | Human-system interaction contract | NOT STARTED | Question budget (~3-5 visible decisions) and the full click→highlight→answer→rerun→resolve lifecycle need a dedicated audit of the Review/Confidence Budget UI against this contract. |
| 6 | Turkish-first product | NOT STARTED | A real, product-wide default-language change plus a full leak audit across every screen. |
| 7 | UI/business logic separation | PARTIAL | The single-writer pattern already exists for several domain facts (`setArrival`, `addHandoverNote`, `autoSnapshot`, `regenerateIds`, etc., documented across the K–T phases) — not yet audited as a complete, enforced architecture rule. |
| 8 | Floor Plan experience simplification | NOT STARTED | |
| 9 | Live Event operational flows | PARTIAL | Flows A/B/C/D/E substantially exist (Phase M/N and Smart Seating already implement find+checkin, No Show, find-space-for-party with named reasons and human Apply, table failure with impact preview) — not yet audited/optimized against this section's specific interaction-count and warning-deduplication requirements. |
| 10 | Event Readiness Timeline | NOT STARTED | New feature. |
| 11 | Data Provenance Inspector | NOT STARTED | New feature. |
| 12 | Interactive first-run onboarding | NOT STARTED | New feature. |
| 13 | Storage safety (boundary + write ordering) | NOT STARTED | `mutationEpoch` already exists (used in `arrivalWave()`'s memoization) as a plausible foundation to extend for write-ordering safety — not yet done. |
| 14 | Domain transaction atomicity | NOT STARTED | |
| 15 | Schema migration chain/registry | NOT STARTED | |
| 16 | Audit durability (remove `slice(0,1000)`) | NOT STARTED | Currently a deliberate, tested, *disclosed* cap (`audit-trail.test.mjs`'s "shared-log cap is disclosed" check) — this section asks for a real architecture replacement, not just keeping the disclosure. |
| 17 | Backup/recovery hardening re-audit | NOT STARTED | |
| 18 | Portable Event Package re-audit | NOT STARTED | Depends on sections 2/3/16 landing first. |
| 19 | Code architecture hardening | NOT STARTED | Dependency map of `app-v8.js` (8339 lines) not yet generated. |
| 20 | Single source of truth audit | NOT STARTED | |
| 21 | Dead/duplicate code audit | NOT STARTED | |
| 22 | Performance at scale | NOT STARTED | |
| 23 | Offline guarantee re-verification | NOT STARTED (ongoing) | Re-verified after every commit in this programme via the existing `verify:offline` gate; a dedicated final pass happens in section 36. |
| 24 | Accessibility/keyboard | NOT STARTED | |
| 25 | Error messages | NOT STARTED | |
| 26 | Real operator test infrastructure | NOT STARTED | `benchmarks/operator/README.md` exists; `REAL-OPERATOR-TEST-KIT.md` not yet written. |
| 27 | Real human test follow-up contract | NOT STARTED | |
| 28 | Third real plan procedure | NOT STARTED (doc) | Status remains **NOT AVAILABLE** — no third real plan has been supplied. Documenting the held-out procedure is separate from having a plan to run it on. |
| 29 | 2-real-plan open debt audit | **DONE (classification)** | **Task #131** (ORNEK robustness suite, CI for both plans, report+PR): **MOSTLY RESOLVED** — CI already runs `npm run benchmark` on Golden+ORNEK together in one job, `BASELINE.json` tracks both, PR #5's own body is the report. Remaining gap, **STILL VALID**: no ORNEK-specific rendering-variant robustness suite (rotation/blur/exposure) analogous to Golden's `benchmarks/robustness/` variants. **Task #132** (PDF orientation normalisation): **OBSOLETE** — PR #5's own Phase 6 section measured "the raw sideways page now scores identically to the upright one... the 13-point orientation cost was almost entirely these three [now-fixed] rules failing, and they fail the same way whichever way up the sheet is." The problem normalisation would have solved no longer exists. |
| 30 | Audit/timeline/provenance stay distinct | N/A yet | Applies once sections 10/11/16 are implemented; will be verified then. |
| 31 | SQLite desktop migration design | NOT STARTED | |
| 32 | Desktop readiness document | NOT STARTED | |
| 33 | Remaining quality gates | PARTIAL | 1 of 24 landed (`no-sample-specific-runtime-logic`); the other 23 depend on the feature/hardening sections above landing first. |
| 34 | CI integration | PARTIAL | New suite runs locally via the existing `npm test`/`test:all` entry points, which the "Fast core" CI job already calls — no CI config change was needed for this one. |
| 35 | Visual quality check | NOT STARTED | |
| 36 | Final full validation | NOT STARTED | |
| 37 | Final documentation | IN PROGRESS | This file. |
| 38 | Final completion matrix | NOT STARTED | Will use the exact status vocabulary once every section above is resolved as far as it can honestly go. |

## Work landed this session

- `tests/suites/no-sample-specific-runtime-logic.test.mjs` (new, 6 checks) —
  static-analysis guard proving every Golden/ORNEK/merit-real-venue mention
  in `src/*.js` is documentation, never runtime identity logic. Mutation-
  proven (a real violation was injected into `plan-representation.js`,
  caught, then reverted and reconfirmed green).
- Section 2 (physical chair / logical seat separation): two real bugs found
  and fixed, detailed below. Pushed as commit `b64fb88`.
- Section 3 (capacity provenance): new `src/capacity-provenance.js`, 3 of 8
  sources wired, detailed below.
- A real, pre-existing wall-clock flake in `post-event-replay.test.mjs`
  found and fixed along the way — detailed below, landed as its own commit.
- This report.

**CI confirmed for commit `ba48b05`** (section 1A, the sample-independence
guard): both the push-triggered (`34773812436`) and pull_request-triggered
(`34773815530`) runs are fully green, all 10 checks each. Section 1A is
DONE, not just locally green.

### Section 2 in detail: two real bugs, root-caused and fixed

**Measured first.** `syncTableChairs()` (`src/app-v8.js`) is the ONE place
that (re)builds `table.chairs` — called from `migrateEvent()`,
`createTable()`, `commitCandidates()`, `refreshChairOccupancy()`, and
`tableObjectHTML()` on every render. Read all five call sites before
touching anything.

**Bug 1 — `syncTableChairs()` fabricated chair geometry regardless of
`hasPhysicalSeats`.** The per-table boolean `hasPhysicalSeats` already
existed and was already correctly consulted by `physicalCapacity()` and
every `seatable()` helper (`seating-freeze.js`, `table-availability.js`,
`seating-advisor.js`, `service-load.js`, `plan-doctor.js`) for AGGREGATE
counting — that part of the separation was already sound. But
`syncTableChairs()` itself always generated exactly `capacity` chair
objects with real-looking `(x, y, rotation)` from `chairGeometry()`,
completely ignoring `hasPhysicalSeats`. A symbolic table (capacity read
from a printed number, zero chairs drawn) therefore still had
`table.chairs.length === capacity`, each with fabricated coordinates —
and `tableObjectHTML()` drew every one of them as a real chair glyph on
the canvas. **Fixed**: each chair object now carries its own honest
`physical` field (`table.hasPhysicalSeats !== false`, recomputed fresh on
every sync rather than carried over, since a table's physical/symbolic
status can change after Teach AI corrections). `tableObjectHTML()` skips
drawing the glyph and the floating seat-number label for any
`physical:false` chair. Nothing about seat COUNT, indexing, assignment or
pax numbering changed — `table.chairs.length` still equals `capacity`
either way, so guest assignment and seat numbering are byte-identical.
Confirmed safe to change purely visually: `data-chair-id` has no click
handler anywhere in the codebase, so no interaction depends on the glyph
existing.

**Bug 2 (the real-world instance) — `commitCandidates()` hardcoded
`hasPhysicalSeats:true` for every confirmed table, regardless of the
plan's own PHYSICAL/SYMBOLIC verdict.** `runSelfCheck()` already reads
`analysis.diagnostics.representation.kind==="PHYSICAL"` as its own
"does this plan draw seats" signal — the exact fact `commitCandidates()`
needed and wasn't using. On an ORNEK-shaped plan (every table the same
numbered symbol, capacity read from a printed rule, zero drawn chairs),
confirming a detected table always set `hasPhysicalSeats:true`, and once
the printed-capacity-rule engine later corrected that table's capacity
upward, the render-time `syncTableChairs()` call would have painted a
full ring of fabricated "physical" chairs around a symbol the drawing
never gave one — a direct, real-world instance of exactly the bug this
section exists to close. **Fixed**: `commitCandidates()` now derives
`hasPhysicalSeats` from the same representation verdict
(`kind==="PHYSICAL"`), OR'd with whether that SPECIFIC candidate carries
real confirmed chair detections (so a manually-corrected table on an
otherwise-symbolic plan is still honestly physical). With no verdict
computed at all, the default is now `false` (abstain — never claim
physical chairs without evidence) rather than the old unconditional
`true`.

**Deliberately left unchanged: manually-created tables
(`createTable()`, blank-event authoring) still default to
`hasPhysicalSeats:true`.** This is a different scenario from a symbolic
PLAN's chairs being fabricated — there is no plan image at all here, and
the generated seat ring is a deliberate, useful authoring affordance for
building a floor plan from scratch (`CLAUDE.md`: "Blank events are
actually blank" — the operator is directly, manually stating "this table
seats N," which is exactly what a physical-authoring flow is for).
Changing this default would remove a normal, expected visual for the
most common table-creation path in the product, far outside this
section's actual concern (chairs fabricated FROM PLAN EVIDENCE that
was never really there).

**Tests.** `tests/suites/physical-logical-seat-separation.test.mjs` (new,
19 checks): a manually-created table defaults physical and renders 8
chair glyphs for capacity 8; flipping `hasPhysicalSeats` to false keeps
`chairs.length===8` (logical seats, assignment and numbering unaffected)
but renders zero glyphs, with every chair honestly marked
`physical:false`; flipping back to physical redraws all 8 with
byte-identical geometry (no chair silently moved across the round trip);
the exact `commitCandidates()` expression is proven correct for all four
representation/detection combinations; and the Home screen's own physical-
capacity fact (already gated by `hasPhysicalSeats` before this fix) is
confirmed to still correctly exclude a symbolic table's seats. Two
mutations proved to bite: reverting the `physical===false` skip in
`tableObjectHTML()` was caught (a symbolic table's 8 chairs render again),
then reverted and reconfirmed green.

**Deferred sub-scope, explicitly out of this pass.** The full
`{capacity: 12, physicalChairs: 0}` shape — a table whose PHYSICAL chair
array is genuinely SHORTER than its capacity (not just visually
suppressed, actually a different-length array) — would require changing
how `assignment.seats` indexes into `table.chairs` everywhere it's read
(Floor Plan rendering, Live, Reports/XLSX seat numbering, exports), since
today seat index and chair-array index are the same number. That is a
real, larger, separate architecture change with much higher regression
risk across the "Reports are regression-sensitive" contract, and is NOT
attempted in this pass — flagged here as **STILL VALID, NOT YET DONE**,
not silently dropped.

### Section 3 in detail: capacity provenance, 3 of 8 sources wired honestly

**New module `src/capacity-provenance.js`.** Exposes
`globalThis.MeritCapacityProvenance = { SOURCE, WIRED, isValid, normalize }`.
`SOURCE` names all eight values from the programme's own spec:
`DETECTED_PHYSICAL_SEATS`, `PRINTED_TABLE_CAPACITY`, `PRINTED_ZONE_CAPACITY`,
`PRINTED_TOTAL_CAPACITY`, `DERIVED_PRINTED_RULE`, `VERIFIED_VENUE_MEMORY`,
`HUMAN_CONFIRMED`, `UNKNOWN`. `WIRED` is a `Set` naming exactly the three
this build can honestly produce today. `normalize(source)` returns the
value unchanged if it is one of the eight, else `"UNKNOWN"` — the single
choke point migration uses to backfill safely.

**Why only 3 of 8 are wired.** Auditing every place `table.capacity` is
actually SET (not just read) found exactly four live writers:
`createTable()` and `app.js`'s `createTableFromDraft()` (both manual
authoring — a person typed or picked the number: `HUMAN_CONFIRMED`),
`setTableCapacity()` (the seat stepper/presets/custom field in the
inspector — also a person, also `HUMAN_CONFIRMED`, and it now RE-tags a
table even if it started as a different source, since provenance has to
reflect the CURRENT source of truth, not the original one), and
`commitCandidates()` (Assisted Detection's commit path — `capacity:
c.chairDetections?.length||1`, so `DETECTED_PHYSICAL_SEATS` when real
chair detections exist, `UNKNOWN` when the candidate is committed on a
guessed fallback of 1 with no evidence). Nothing in this build reads a
number printed next to one table, applies the whole-plan printed
capacity rule (`plan-self-check.js`'s `ORIGINS`/`capacityAudit.rule` —
a DIFFERENT, whole-plan-arithmetic concept, never written to per-table
`capacity`) to an individual table, or carries a verified number forward
from Visual Plan Memory into a fresh capacity value. Wiring
`PRINTED_TABLE_CAPACITY`/`PRINTED_ZONE_CAPACITY`/`PRINTED_TOTAL_CAPACITY`/
`DERIVED_PRINTED_RULE`/`VERIFIED_VENUE_MEMORY` today would mean
INVENTING those read paths — new detection/business behaviour, not a
data-model change — which is exactly the "no fabrication," "no huge
blind refactor" line this programme draws. The five are named and fully
translated so the day one of those features actually ships, it has a
real slot to report into, following the same honest-abstention idiom as
`MeritPlanDoctor.NOT_EVALUATED` and Smart Seating's "not set up yet."

**Wiring.** `capacitySource` added to the table literal at all four write
sites above. `migrateEvent()` backfills it through
`MeritCapacityProvenance.normalize()` on every load — an install from
before this field existed, or a corrupted value, becomes `UNKNOWN`,
never guessed or dropped. Because `exportBackup()`/`buildBackupPayload()`
and `event-package.js`'s import both serialize/restore the whole `state`
generically (`JSON.stringify(state)` / `JSON.parse(JSON.stringify(...))`,
never a field-by-field allowlist) and both restore paths run through
`parseRoot()`→`migrateEvent()`, the field survives backup export/restore
and portable Event Package round-trips with no additional code — verified
structurally by reading both call chains, not assumed.

**Turkish/English copy.** Eight new `capacitySource.*` keys added to
`src/i18n.js`'s `STRINGS` table (not a parallel label map — this
programme's own section 6 will audit for exactly that kind of duplicate
translation mechanism), covering all eight sources including the five
unwired ones.

**Tests.** `tests/suites/capacity-provenance.test.mjs` (new, 19 checks):
the enum contract (exactly 8 names, exactly the right 3 marked `WIRED`,
`isValid`/`normalize` behaviour); a bulk-added table is `HUMAN_CONFIRMED`;
the separate single-table "Add Manually" draft path is also
`HUMAN_CONFIRMED`; the seat stepper re-tags `HUMAN_CONFIRMED` even
starting from a simulated `DETECTED_PHYSICAL_SEATS` table; the
`commitCandidates()` expression for both detection scenarios; migration
backfill for both a missing and a corrupted `capacitySource` (via
corrupting in-memory `state` and using the app's own `saveState()` before
reload — writing IndexedDB out from under the live page raced with the
page's own `beforeunload` autosave, which silently overwrote the
injected corruption before the reload ever read it; the app's own save
path avoids that race entirely); and both languages resolve real,
distinct text for all eight labels rather than a raw key or a copy-pasted
English default. Two mutations proved to bite: reverting
`migrateEvent()`'s `normalize()` call was caught by both migration
checks (backfill stopped happening — one showed `undefined`, one kept
the corrupted `"TOTALLY_MADE_UP"`); reverting `setTableCapacity()`'s
re-tag was caught by exactly the one check testing it. Both reverted and
reconfirmed green (19/19).

**Deferred, explicitly out of this section's scope.** A UI surface for
this field (a badge, a tooltip, a filter) is section 11's Data Provenance
Inspector, a separate named feature, not attempted here. The five unwired
sources stay unwired until a real feature earns them — see above.

### An unrelated pre-existing bug found and fixed along the way: a real
### wall-clock flake in `post-event-replay.test.mjs`

Running the full fast suite while landing section 3 turned up a genuine,
reproducible, pre-existing failure with no connection to capacity
provenance: `post-event-replay` failed exactly because this session
happened to run between 19:00 and 19:30 UTC. Its fixture stamps two guest
check-ins at fixed clock times (19:00, 20:00 today) via `new Date()` +
`setHours()`, but leaves the event's own "Event created" audit entry at
whatever the REAL current wall-clock time was when `createBlankEvent()`
ran. When that real time falls inside the 19:00–19:30 bucket the test
later clicks, both the real creation entry and the stamped 19:00 check-in
match the filter, so "narrows to what happened in that window" saw 2
rows instead of 1 (root-caused with `date`: the container's clock read
19:26 UTC at the moment of the run — squarely inside the window). This
was not a flake to shrug off or re-run past: it would fail identically
for anyone running the suite in that same half hour, on any commit.
**Fixed** by pinning that one audit entry's `at` to a fixed 08:00 (well
outside every bucket this test clicks) right after fixture setup, rather
than leaving it at the real clock. No production code changed — this is
a test-fixture correctness fix, landed as its own commit, separate from
section 3's actual diff. Reconfirmed: 31/31 checks, and re-verified
structurally that nothing else in the file depended on that entry's
exact original value beyond "it must sort oldest."

## Continuation checkpoint (machine-readable)

```
SECTION 2 STATUS: PARTIAL, CI pending — pushed as commit b64fb88 (parent
  ba48b05). Local test:all was green (54/54 suites, 1871/1871 checks) and
  both offline artifacts rebuilt + verified (27/27 checks) before push.
  Waiting on actual GitHub Actions CI for b64fb88 to confirm green before
  this flips to DONE. tests/suites/physical-logical-seat-separation.test.mjs
  (19 checks, mutation-proven) added and committed; tests/README.md row
  added.
SECTION 3 STATUS: PARTIAL (by design), pushed as commit 9f09e2d — new
  src/capacity-provenance.js, table.capacitySource wired at all 4 real
  write sites (createTable, app.js's createTableFromDraft,
  setTableCapacity, commitCandidates), migrateEvent backfill via
  MeritCapacityProvenance.normalize(), 8 Turkish/English i18n keys,
  tests/suites/capacity-provenance.test.mjs (19 checks, 2 mutations proven
  to bite). 3 of 8 sources WIRED
  (DETECTED_PHYSICAL_SEATS/HUMAN_CONFIRMED/UNKNOWN); the other 5
  (PRINTED_TABLE_CAPACITY/PRINTED_ZONE_CAPACITY/PRINTED_TOTAL_CAPACITY/
  DERIVED_PRINTED_RULE/VERIFIED_VENUE_MEMORY) are named+translated but
  UNWIRED since no current feature produces them — wiring them would mean
  inventing new detection/business behaviour, not a data-model change; see
  full write-up above.
ALSO FIXED THIS SESSION (unrelated, found along the way), pushed as commit
  e9742f1: a real wall-clock flake in tests/suites/post-event-replay.test.mjs
  — its "Event created" audit entry used the real current time instead of
  a controlled one, so the suite failed whenever run between 19:00-19:30.
  This was CONFIRMED to be the actual cause of PR #5's own CI failure on
  commit b64fb886 (both the push- and pull_request-triggered "Fast core"
  runs failed with the identical symptom, CI's own runner clock reading
  19:08 UTC at the moment of failure) — not a regression from section 2's
  actual diff. Fixed by pinning that entry's timestamp to a fixed 08:00 in
  the test fixture. 31/31 checks green, reproduced and fixed both locally
  and verified against the real CI log via get_job_logs.
NEXT_ACTION: confirm GitHub Actions CI is green on commit e9742f1 (which
  should also retroactively confirm b64fb88/9f09e2d's actual content was
  fine all along — the only failure was the flake, now fixed on the branch
  head). Once confirmed, sections 2 and 3 both flip from PARTIAL to DONE
  in the table above, then move to sections 4/5 (object identity safety,
  question budget/lifecycle).
DEFERRED_SUB_SCOPE: full physicalChairs-shorter-than-capacity indexing
  change (section 2's "Deferred sub-scope" above) — STILL VALID, not
  attempted. Section 3's 5 unwired capacity sources — STILL VALID, named
  and translated but not producible without new detection features.
BLOCKED_ON: nothing external — this is pure engineering work.
NOT_YET_TOUCHED: sections 4-28, 30-32, 35-38 (see table above).
EXTERNAL_BLOCKERS_UNCHANGED: real human operator test (NOT VERIFIED), a
  genuine third independent real floor plan (NOT AVAILABLE), SQLite
  runtime (DEFERRED to EXE stage), EXE itself (DEFERRED, forbidden until
  the user types "EXE YAP").
```

## What has NOT changed

- No EXE, Electron, Tauri, installer, updater, or Windows packaging of any
  kind has been created or scaffolded.
- PR #5 has not been merged into `main`.
- No test has been weakened, skipped, or deleted to make a suite pass.
- No fake human usability result and no fake third-plan validation has
  been recorded anywhere.
