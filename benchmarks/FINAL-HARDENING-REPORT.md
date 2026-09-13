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
| 2 | Physical chair / logical seat / capacity separation | **PARTIAL — root cause fixed, real bug found** | See detailed write-up below. Two real, evidenced bugs found and fixed; the deeper "capacity can exceed physical chair count on the same table" architecture (e.g. capacity=12, physicalChairs=0 as a genuinely empty array) is a larger indexing-scheme change and is deliberately NOT attempted here — see "Deferred sub-scope" below. |
| 3 | Capacity provenance | NOT STARTED | Depends on section 2's data-model correctness landing first. |
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
  and fixed, detailed below.
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

**Section 3 (capacity provenance): NOT STARTED.** Depends on this
section's data model, now sound. Building the actual provenance enum,
Turkish-facing copy, and its survival through save/backup/package/
migration is a distinct, real feature and is the next item once picked
back up.

## Continuation checkpoint (machine-readable)

```
SECTION 2 STATUS: PARTIAL — root cause fixed (see write-up above), commit
  pending push+CI. tests/suites/physical-logical-seat-separation.test.mjs
  (19 checks, mutation-proven) added.
NEXT_SECTION: 3 (Capacity provenance)
NEXT_ACTION: Design the capacity-source enum (DETECTED_PHYSICAL_SEATS /
  PRINTED_TABLE_CAPACITY / PRINTED_ZONE_CAPACITY / PRINTED_TOTAL_CAPACITY /
  DERIVED_PRINTED_RULE / VERIFIED_VENUE_MEMORY / HUMAN_CONFIRMED / UNKNOWN,
  internal names only, natural Turkish user copy), store it per table
  (probably table.capacitySource), wire it from wherever capacity is
  currently SET (setTableCapacity, commitCandidates' capacity-rule
  corrections, manual edits) so it's never left UNKNOWN when a real source
  is known, and make it survive migrateEvent/exportBackup/event-package
  round-trips. Then the 6 mandatory section-2 test names not yet covered
  (capacity-provenance-preserved/integrity) become meaningful. After that,
  move to sections 4/5 (object identity safety, question budget/lifecycle).
DEFERRED_SUB_SCOPE: full physicalChairs-shorter-than-capacity indexing
  change (see "Deferred sub-scope" above) — STILL VALID, not attempted.
BLOCKED_ON: nothing external — this is pure engineering work.
NOT_YET_TOUCHED: sections 3-28, 30-32, 35-38 (see table above).
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
