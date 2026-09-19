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
| 2 | Physical chair / logical seat / capacity separation | **DONE** | Pushed as commit `b64fb88`, CI CONFIRMED GREEN on the branch head (commit `dcde06c`, all 10 checks across both push- and pull_request-triggered runs). Two real, evidenced bugs found and fixed; the deeper "capacity can exceed physical chair count on the same table" architecture (e.g. capacity=12, physicalChairs=0 as a genuinely empty array) is a larger indexing-scheme change and is deliberately NOT attempted here — see "Deferred sub-scope" below, still valid. |
| 3 | Capacity provenance | **DONE (by design, 3 of 8 sources wired)** | Pushed as commit `9f09e2d`, CI CONFIRMED GREEN (commit `dcde06c`, all 10 checks). See detailed write-up below. `table.capacitySource` (new `src/capacity-provenance.js`) is a real, migrated, backup/package-safe field on every table. Only the 3 sources this build can honestly produce (DETECTED_PHYSICAL_SEATS, HUMAN_CONFIRMED, UNKNOWN) are wired; the other 5 (PRINTED_TABLE_CAPACITY, PRINTED_ZONE_CAPACITY, PRINTED_TOTAL_CAPACITY, DERIVED_PRINTED_RULE, VERIFIED_VENUE_MEMORY) are named and translated but UNWIRED, since no current feature reads a per-table/zone/venue printed capacity number into `table.capacity` — inventing that read path now would be new detection behaviour, not a data-model change, and is explicitly out of scope for this section. This is the section's designed end state, not a partial result awaiting more work. No UI surface yet (that is section 11, Data Provenance Inspector, tracked separately). |
| 4 | Object identity safety | **DONE (audit, no gap found)** | Re-audited this session; see detailed write-up below. `plan-memory.js`'s `identity()` already implements exactly the safety property this section protects: a VERIFIED printed number is an absolute veto in both directions (checked before any weighing), geometry dominates the weighted score, visual similarity's weight is scaled by `1 - geometryCertainty` (near-zero when geometry already agrees, largest only when an object has moved beyond tolerance), and family mismatch is evidence that lowers the score but never blocks a match. Correction to an earlier note: visual similarity is not "off by default" — it is always computed and always wired in (mandatory per the module's own §24 requirement), but its WEIGHT is what stays governed. `venue-model.js`'s layout-change comparison uses a stricter, purely deterministic ladder for its own different task (verified table number, then position, no visual similarity at all). Both are already covered by existing suites (`plan-memory`, `layout-changes`); no gap found, no new code needed. |
| 5 | Human-system interaction contract | **DONE (audit, no gap found)** | Re-audited this session; see detailed write-up below. `plan-confidence-budget.js`'s `DEFAULT_MAX_ITEMS=6` is a real, measured, justified budget ("with the two real plans, six covers every claim that settles anything... overridable so the measurement can be redone on a third plan"), with everything below the line counted and disclosed rather than hidden. `review-queue.js` implements the click→highlight→answer→resolve lifecycle with resolution state read live from the candidates on every render (never a separate tally that could drift), tested in `review-queue.test.mjs` (38 checks). `operator-questions.test.mjs` (15 checks) separately guards against two different underlying questions reading as identical text. No gap found, no new code needed. |
| 6 | Turkish-first product | **DONE** | See detailed write-up below. Found and fixed a real bug: the product actually booted in English by default (`ui.lang` was never initialized, and `app-v8.js`'s own `Object.assign(ui,{...lang:"en"...})` clobbered app.js's default even after a first attempted fix), despite the whole product's UI being fully bilingual. Now boots Turkish, verified with a real rendered screenshot. New default-boot regression check in `i18n.test.mjs`. Fixing this correctly surfaced 12 suites (382 checks) whose assertions had silently depended on the old implicit English default — each fixed on its merits (pinned to explicit English for suites testing behaviour, not translation; two suites had assertions whose expected VALUE needed updating, not just their language, since the default flip changed which value a first toggle-click produces). Zero checks removed or weakened — same check counts before and after, all passing. |
| 7 | UI/business logic separation | PARTIAL — spot-checked, no violation found | This session grepped every direct write of 4 representative domain facts across `app-v8.js`: `guest.arrivalStatus` (exactly one write site, inside `setArrival()`), `table.availability` (exactly one write site, inside `setTableAvailability()`), freeze creation/lift (exactly one call site each, `createFreezeFromDraft()`/`liftFreeze()`), and `guest.planningStatus` (the one non-migration write is legitimate free-form operator editing, not a derived/paired fact the way arrival status is, so it correctly has no dedicated writer). Zero violations found on this sample. NOT exhaustively verified as "a complete, enforced architecture rule" across the full ~8000-line file — that would need AST-based tooling (an ESLint rule forbidding direct assignment to a named list of guarded fields outside their writer function) rather than grep, and is the concrete next step if this section is picked up again, not a re-scan by hand. |
| 8 | Floor Plan experience simplification | PARTIAL | This section's original exact interaction-count/warning-deduplication numeric targets were lost to an earlier context compaction and are not recoverable — rather than fabricate compliance against unknown numbers, this session commissioned a fresh, evidence-based UX audit (`visual-qa-reviewer` agent, real DOM/console/screenshot inspection) of Floor Plan and Live Event and fixed every real, well-scoped finding it surfaced. One CRITICAL finding fixed: the contextual card's capacity stepper/presets always edit `ui.selectedObjectId` alone but gave no indication of that when `ui.selectedObjectIds` held more (bulk-add, marquee) — see detail below. Not a re-verification of the original section 8 requirements, since those requirements are gone; a real, different, and honestly-scoped pass on the same screen. |
| 9 | Live Event operational flows | PARTIAL | Same audit (see section 8's row and detail below) surfaced and fixed 5 more real findings spanning Seating/Freeze Zones/Table Availability/Smart Seating: a reason dropdown silently defaulting instead of forcing a choice, a freeze form with no pre-commit scope warning, an inconsistent disabled-vs-toast affordance for the same "table unavailable" rule, sub-floor operational text, and a "no table fits" message that did not name frozen/unavailable tables as the reason. Two findings (native `confirm()` dialogs, unbounded toast stacking) are real but deliberately deferred — see detail below. Flows A/B/C/D/E from the original section 9 description still substantially exist as previously noted; the specific interaction-count/warning-dedup numeric targets remain unverifiable for the same reason as section 8. |
| 10 | Event Readiness Timeline | **OBSOLETE** | Investigated first via the `merit-product-director` agent, per an explicit user decision to scope before coding. Whatever "Readiness Timeline" could honestly mean is already covered: Plan Doctor answers "can this event safely proceed" live and un-cached; the Command Center's Risk Radar and attention list surface the same facts as a status, not a log; the Arrival Wave tracks the door in real time; Post-Event Replay reconstructs history from the audit trail after the fact. A NEW stored timeline would either duplicate one of these (drift risk — the exact thing Plan Doctor's own "derived live, not remembered" design law exists to prevent) or introduce a second place the product could disagree with itself. User decision: mark OBSOLETE with this evidence, not NOT STARTED — see detail below. |
| 11 | Data Provenance Inspector | **DONE** | Implemented: one read-only line on the contextual card showing `table.capacitySource` (tables) or `seatsConfidence`/`seats` (sofa/bench/banquette venue objects), reusing the existing `MeritCapacityProvenance` module with zero new state. Two real bugs found by the mandatory rendered screenshot pass (a missing-i18n-key raw-text leak, a Turkish-text CSS overflow) and both fixed with regression tests, mutation-proven. See detail below. |
| 12 | Interactive first-run onboarding | **DONE** | Implemented: 5 short, dismissible, feature-anchored callouts (Global Finder, Command Center, Freeze Zones, Smart Seating, Table Availability) — never a sequential tour, never a second explanation of a domain rule the User Guide already owns. `state.onboarding` persists like `state.audit` (never on `event`), a "Show tips again" control in the Guide resets it, and callouts never appear in a historical event's read-only view. New suite (22 checks), mutation-proven. See detail below. |
| 13 | Storage safety (boundary + write ordering) | **DONE** | `saveState()` now serialises every save onto a `saveQueue` promise chain, so overlapping writes reach storage in the exact order they were called — closing a real, evidenced hazard (`storageProvider.save()` opens its own IndexedDB connection per call, so two overlapping calls could otherwise land out of order). Proven with a deterministic simulated-latency stress test in `storage-provider.test.mjs`, not incidental browser timing. `mutationEpoch` itself was confirmed to guard only render-time memos, unrelated to the write path — this fix does not touch it. |
| 14 | Domain transaction atomicity | **DONE (narrowly scoped)** | `assignGuestGroup()`'s existing snapshot-and-rollback had a real gap: it persists the new assignment (via `touchEvent()`) *before* `render()`, so a throw from `render()` itself left storage holding the successful move while the catch's revert only undid it in memory — the next unrelated `touchEvent()` anywhere in the app would then persist that stale, reverted state. Fixed by re-persisting inside the catch. New suite `transaction-atomicity.test.mjs`. Deliberately did **NOT** extend snapshot/rollback wrapping to `setArrival`/`setTableAvailability`/freeze create-lift/`commitCandidates` — see detail below for why that would be speculative over-engineering, not a real fix. |
| 15 | Schema migration chain/registry | **PARTIAL (deliberately, by evidence)** | Investigated in detail; a real dispatch/version-preservation mechanism would be untestable scaffolding today, since no current migration step needs to distinguish prior versions (every one is idempotent/additive) — building one now would be exactly the "no half-finished implementation" this programme's own rules forbid. Built the one real, valuable, testable thing instead: a genuine end-to-end regression proving the existing single-pass `migrateEvent()`/`parseRoot()` correctly upgrades data shaped like a truly old, pre-field-existence install. New suite `schema-migration.test.mjs`. See detail below. |
| 16 | Audit durability (remove `slice(0,1000)`) | **DONE** | `touchEvent()` no longer writes a generic `EVENT_UPDATED` entry on every mutation — it never carried anything `event.lastModified` didn't already, and it was competing with real, allowlisted decisions for the same shared, capped 1000-entry array. Confirmed by direct read that `EVENT_UPDATED` was write-only noise, never read by `MeritAuditTrail`'s own allowlist. New regression check in `audit-trail.test.mjs` proving zero `EVENT_UPDATED` entries exist after a full session of ordinary mutations. See detail below. |
| 17 | Backup/recovery hardening re-audit | **DONE (audit, no code gap found)** | Re-audited both mechanisms (`exportBackup`/`importBackupFile` and `src/offline-recovery.js`'s automatic snapshot ring buffer) against the angles this section named — corrupted-backup-file detection, corrupted-primary-record detection, and "recovery-of-recovery." The first two were already covered and tested; the third (the automatic snapshot slot *itself* corrupted, not just the primary record) had real, existing production-code protection (`loadV8Async()`'s own try/catch, `MeritOfflineRecovery.latestSnapshot()`'s array guard) with no test constructing that exact scenario. Added the missing test to `offline-recovery.test.mjs`; zero production code changed. |
| 18 | Portable Event Package re-audit | **DONE (verification)** | Confirmed sections 2 (chair physical/logical separation) and 3 (capacity provenance) already flow safely through `exportEventPackage()`/`importEventPackagePayload()` with no gap. Section 16 was the one real, live dependency (the package's carried audit history reads from the same shared, capped array) — added the regression case the investigation named: exporting a package for an event whose early decisions would have been evicted by 1000 ordinary edits to an unrelated event, mutation-proven to fail before Section 16's fix and pass after. |
| 19 | Code architecture hardening | **DONE (audit, real architecture already sound)** | Investigated via `frontend-architect`, independently re-verified. `app-v8.js` (8,527 lines) is the sink for the whole 32-file, 18,710-line `src/` tree, loaded last, with every one of ~28 smaller domain modules confirmed to depend on app-v8.js's mutable globals in exactly zero places (`state.`/`ui.`/`render(`/`touchEvent(` all grep-clean) — the intended one-directional-via-`globalThis.MeritXxx` architecture already holds with no exceptions found. What was real: the boundary between that clean small-module graph and app-v8.js's OWN `original={...}` override capture (of app.js/app-guests.js's pre-V8 functions) was undocumented and unenforced — closed with a new static-analysis test, not a restructure. See detail below. |
| 20 | Single source of truth audit | **DONE (one real, narrow gap, guarded not refactored)** | Checked table capacity/chairs, `isHistorical`, and `occupiedSeatIndexes`/`liveUsedIndexes` — no violation found in any of the three; each is already correctly single-sourced or deliberately, correctly separate. Found one real, narrow, currently-latent risk: `guest.pax` is a redundant cached field (`1+additionalGuests`) written correctly at all 5 current sites but with no single setter enforcing it, so a future write site could drift silently. New regression test guards the invariant across real UI flows; deliberately did NOT convert `pax` to a computed property, since every current site is already correct and that refactor would touch reports/exports with no real bug driving it. See detail below. |
| 21 | Dead/duplicate code audit | **DONE (5 confirmed dead functions removed)** | Investigated via `frontend-architect`, each candidate independently re-verified by direct grep (zero occurrences across `src/`, `tests/`, `index.html`, `scripts/`, `benchmarks/` besides the declaration itself) before deletion. Removed `eventCard` (app-v8.js — superseded by the hero/list Events layout), `isTableFrozen` (app-v8.js — its one caller inlines the identical check), `memoryDistance` (app-v8.js — `matchCandidatesByGeometry` inlines the same formula), `migrateState` (app.js — `loadState()` never calls it, a pre-V8-storage relic), `numberOf` (plan-number-integrity.js — `analyse()` inlines the identical check). A separate, much larger finding — 21 of `app-v8.js`'s own `original={...}` capture's ~32 names are confirmed, deterministically unreachable under the current boot sequence — was deliberately NOT acted on by deletion this pass; see Section 19's detail for why (multi-file blast radius, no existing test coverage of the boot-sequence assumption it rests on). |
| 22 | Performance at scale | **DONE (re-measured; one new per-change runner)** | Re-ran the full existing perf harness on the 4,000-seat fixture (400 tables / 4,000 chairs / 3,000 guests / 4,500 pax): data integrity after reload exact, console clean, no suite failed. Built a new runner, `benchmarks/perf/save-queue-burst.mjs`, to measure the one thing this programme changed that the existing harness structurally could not see — Section 13's `saveState()` write queue. Result: **the queue costs, it does not save** — drain roughly doubles and peak heap rises ~16–42 MB, in exchange for deterministic last-write-wins. Measured, judged acceptable, and now guarded. The first version of that runner reported the opposite and was wrong; see detail below. |
| 23 | Offline guarantee re-verification | **DONE (continuously, plus this pass)** | Both artifacts rebuilt and the real built package re-verified after every commit in this programme, 27/27 each time, including this one. A dedicated final pass still happens in section 36. |
| 24 | Accessibility/keyboard | **DONE (one real gap, closed and mutation-proven)** | Audited directly rather than assumed: a global `:focus-visible` ring already exists (`src/styles.css:70`) and the app's three native `<dialog>` elements get focus containment and Escape-close from the platform. The one real gap was the freeze-challenge `<aside role="alertdialog">` — the app's only custom scrim — which had initial focus and Escape but no Tab containment, so Tab walked out of an alertdialog into the page behind it. Trap implemented; 6 new checks in `tests/suites/seating-freeze.test.mjs` (89→96). |
| 25 | Error messages | **DONE (two real defects + a static guard)** | Audited all 104 `toast()` call sites (80 in app-v8.js, 12 each in app-guests.js/app.js; 31 error-level). Most already name the object, the reason and the next step. Two did not: the Create Event and Replace Plan paths each toasted a bare `error.message` — a raw pdf.js/FileReader string naming no action, offering no next step, and arriving in English on a Turkish-default product. Both now build a real message from a new i18n key, keeping the library's `{reason}`. Separately found that **nothing statically verified that a `t()` key exists** — and error-path keys are precisely the ones no rendering test ever reaches. New suite `i18n-key-integrity` closes that. No live missing key found. |
| 26 | Real operator test infrastructure | **DONE (kit written) / session NOT VERIFIED** | `benchmarks/operator/REAL-OPERATOR-TEST-KIT.md` written — the runnable facilitator kit (pre-day setup against the real offline artifact, the verbatim script, the how-to-answer-their-questions table, the observer sheet, the end-of-session sequence), distinct from the existing `README.md`, which is the rationale. Also **corrected a stale known-gap** in that README: it told facilitators to discount an operator who could not get from a Worth deciding row to the object — that gap was closed by the click-to-act work (`data-budget-open` → `openReviewQueue`), so the note would have caused a real finding to be dismissed. **No session has been run**; real operator usability stays NOT VERIFIED. |
| 27 | Real human test follow-up contract | **DONE (contract written, unexercised)** | `benchmarks/operator/HUMAN-TEST-CONTRACT.md` — written *before* any session, which is the only time it can be written honestly. Fixes in advance: a 7-class finding taxonomy (DEFECT/BLOCKER/FRICTION/VOCABULARY/MISSING/PREFERENCE/CONTAMINATED) with a per-class obligation; what does and does not oblige a fix; the rule that an operator finding beats a measured internal result when they conflict; the exact permitted status strings, with `MEASURED ONCE` explicitly not a stepping stone to VERIFIED; and what obliges a re-run with a *new* operator. |
| 28 | Third real plan procedure | **DONE (doc) / plan NOT AVAILABLE** | `benchmarks/heldout/THIRD-PLAN-PROCEDURE.md` — 9 ordered steps, every one of them what was actually done for ORNEK rather than an invention, including the permanent-first-run-record practice (`ORNEK-FIRST-RUN.md`) that sits alongside the `benchmark:heldout` leakage guard. Status of the thing itself is unchanged: **NOT AVAILABLE** — no third real plan has been supplied, and documenting the procedure is not having a plan to run it on. |
| 29 | 2-real-plan open debt audit | **DONE (classification)** | **Task #131** (ORNEK robustness suite, CI for both plans, report+PR): **MOSTLY RESOLVED** — CI already runs `npm run benchmark` on Golden+ORNEK together in one job, `BASELINE.json` tracks both, PR #5's own body is the report. Remaining gap, **STILL VALID**: no ORNEK-specific rendering-variant robustness suite (rotation/blur/exposure) analogous to Golden's `benchmarks/robustness/` variants. **Task #132** (PDF orientation normalisation): **OBSOLETE** — PR #5's own Phase 6 section measured "the raw sideways page now scores identically to the upright one... the 13-point orientation cost was almost entirely these three [now-fixed] rules failing, and they fail the same way whichever way up the sheet is." The problem normalisation would have solved no longer exists. |
| 30 | Audit/timeline/provenance stay distinct | **DONE (verified)** | Section 10's own investigation is this verification: the audit trail (what happened, `audit-trail.js`), the Plan Doctor/Risk Radar (can this event safely proceed, derived live from current state), and Section 11's new provenance line (where did this one number come from) each answer a different question from a different data source, and none of the three sections implemented this round introduced a fourth overlapping concept. No new code was needed to keep them distinct — the boundary already held. |
| 31 | SQLite desktop migration design | **DONE (design only, as the rules require)** | `benchmarks/SQLITE-MIGRATION-DESIGN.md`. Nothing implemented — `.claude/rules/data.md` forbids introducing SQLite speculatively during browser review, so no dependency, no schema, no code. **Main finding: "export format v1" does not need designing — it already exists twice** (`merit-event-maker-backup` whole-install and `merit-event-maker-event-package` single-event), both `formatVersion: 1`, both validating rather than trusting on import, and the package format already solves id collision by renumbering. The real design work is therefore the schema mapping and the adapter contract, plus the one genuine improvement SQLite buys the domain (`pax` as a generated column, retiring the Section 20 cached-field risk structurally) and the one rule it explicitly **cannot** enforce (No Show keeping the planned seat is a rule about which fields an operation may touch, not about which states are valid — no CHECK expresses it; `setArrival()` stays the single writer). |
| 32 | Desktop readiness document | **DONE (inventory; gate still shut)** | `benchmarks/DESKTOP-READINESS.md`. Separates what genuinely is ready and shipping (the `StorageProvider` boundary, offline operation verified by *running* the built artifact 27/27, no network dependency proven by absence-of-`fetch` assertions, two versioned interchange formats, an idempotent migration proven against an old fixture, 55 suites/1799 checks that are about domain behaviour rather than about being in a tab, corrupted-store recovery) from what is deliberately not (no packaging technology chosen — that choice is itself behind the gate; no SQLite; no IPC surface; no updater/signing/installer; no private AI runtime). Also carries forward the honest gaps a desktop build would inherit, and states that **the operator session is best run before packaging, not after**. |
| 33 | Remaining quality gates | **DONE (coverage audit; every behaviour change landed with its guard)** | The earlier "1 of 24" note was written when the feature/hardening sections it depended on had not landed. They have. Counted, not estimated: **9 new suites** this programme (`no-sample-specific-runtime-logic`, `physical-logical-seat-separation`, `capacity-provenance`, `onboarding`, `transaction-atomicity`, `schema-migration`, `override-boundary`, `pax-invariant`, `i18n-key-integrity`) and **18 existing suites extended**, against the frozen baseline `3ef11bb`. Every section that changed behaviour shipped with the guard that would catch its revert, and each was mutation-proven individually at the time. Suite files on disk: **61. Declared and reachable: 61. Orphaned: 0** — verified by diffing the filenames against the runner's own declared list, not by counting. |
| 34 | CI integration | **DONE (verified against the real workflow and a real run log)** | Every suite reaches CI: `npm test` runs the 55 fast suites in the *Fast core* job and `npm run test:slow` runs the 6 slow ones in *Intelligence* — union 61, nothing unreached. `npm run perf` runs in the *Performance* job, so this programme's new asserting runner (`save-queue-burst.mjs`) is genuinely gated, **confirmed by reading the run log rather than by inference**. The three npm scripts not in CI are correctly absent: `benchmark:retrieval` and `benchmark:separation` assert nothing (no regression gate to fail), and `benchmark:heldout` would refuse, because there is no held-out plan. **One real defect found by reading that log**: in CI the burst runner printed `heap 13.6→13.6→13.6 MB` on every row — `performance.memory` is coarsened in a container, so the column was rendering non-data as data, and read as "the burst allocated nothing", the opposite of the finding. Now reported as UNAVAILABLE; fix proven both ways (real numbers locally, UNAVAILABLE under a simulated coarsened `performance.memory`). |
| 35 | Visual quality check | **DONE (rendered at all three viewports; one real defect found and fixed)** | Every primary screen rendered and screenshotted at 1920×1080, 2560×1440 and ~1440px — Home (empty *and* populated), Create Event, Floor Plan (blank canvas, with tables, and with a table selected), Guests + the add/edit dialog, Seating, Live, Reports. **Console clean at all three viewports.** The constitution holds: one warm/light palette throughout, warm-paper canvas, floating toolbar + contextual card + bottom status pill on Floor Plan, restrained VIP gold, no second dark system, no gradient/card-wall aesthetic, no overflow at 1440. **One real defect found and fixed**: the toast stack (`z-index: 2000`, `bottom: 16px`) rendered directly on top of the Floor Plan's `.planmap-fab` "Add Manually" button (`bottom: 20px`, 44px tall) — so the toast saying *"add the plan objects when you are ready"* covered the one control that adds them. Fixed, re-rendered, and guarded by a new rendered-geometry check in `floor-plan-modes` (45→46 checks), mutation-proven. Note the sweep was run directly rather than via the `visual-qa-reviewer` agent, which died on a session rate limit. |
| 36 | Final full validation | **DONE** | `npm run test:all` (every suite, slow included): **61/61 suites, 2011/2011 checks**. Both offline artifacts rebuilt and the real built package re-verified: **27/27**. Detector benchmark against the committed `BASELINE.json`: **"No regressions. 0 improvement(s), 0 note(s)"** — every guarded field, per plan. Re-run in full after the Section 35 fix. |
| 37 | Final documentation | **DONE** | This file (the narrative and per-section detail) plus `benchmarks/FINAL-COMPLETION-MATRIX.md` (the closing statement). Also written this programme: `benchmarks/SQLITE-MIGRATION-DESIGN.md`, `benchmarks/DESKTOP-READINESS.md`, `benchmarks/operator/REAL-OPERATOR-TEST-KIT.md`, `benchmarks/operator/HUMAN-TEST-CONTRACT.md`, `benchmarks/heldout/THIRD-PLAN-PROCEDURE.md`, plus the perf README's re-measurement and methodology sections. No stale suite counts were found hardcoded in `README.md` or `tests/README.md`. |
| 38 | Final completion matrix | **DONE** | `benchmarks/FINAL-COMPLETION-MATRIX.md`, using ONLY the permitted vocabulary (DONE / PARTIAL / NOT VERIFIED / NOT AVAILABLE / DEFERRED / BLOCKED) in its Status column — no "mostly", no "essentially done", no percentage. Sections 26/28/31 carry **two** rows each, so a written document's completion can never stand in for the event it prepares for: the kit is DONE and the session is NOT VERIFIED; the procedure is DONE and the third plan is NOT AVAILABLE; the design is DONE and SQLite itself is DEFERRED. The desktop/EXE build is its own row, BLOCKED. |

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
- Sections 4/5 (object identity safety, question budget/lifecycle):
  re-audited, no gap found, detailed below — including a correction to
  this report's own earlier claim that visual similarity ships off by
  default in `plan-memory.js` (it does not; its weight, not its presence,
  is what stays governed).
- Section 6 (Turkish-first product): found and fixed a real bug — the
  product actually booted in English by default — plus fixed 12 suites
  (382 checks) whose assertions silently depended on that bug, detailed
  below.
- Sections 8/9 (Floor Plan/Live UX hardening): a fresh, evidence-based UX
  audit of Floor Plan and Seating surfaced 8 real findings; 6 fixed
  (multi-select scope disclosure, forced-choice unavailable-reason,
  freeze pre-commit scope preview, consistent unavailable-block toast,
  three areas of sub-floor typography, Smart Seating's "why nothing fits"
  message), 2 deliberately deferred, detailed below.
- Sections 10/11/12/30: section 10 (Event Readiness Timeline) investigated
  via `merit-product-director` and marked OBSOLETE with evidence, per an
  explicit user decision to scope before coding, then to build 11+12 only.
  Section 11 (Data Provenance Inspector) and Section 12 (interactive
  first-run onboarding) implemented, tested, mutation-proven, and verified
  by a rendered screenshot pass that found and fixed two real bugs.
  Section 30 (audit/timeline/provenance stay distinct) verified as a
  byproduct of section 10's own investigation — detailed below.
- Sections 13-18 (storage/transaction/migration/audit/backup/package
  hardening): investigated via `data-architecture-engineer`, then built.
  Section 13 (write-ordering): a real save-queue fix for an evidenced
  IndexedDB race, with a deterministic stress test. Section 14 (transaction
  atomicity): a real gap closed in `assignGuestGroup()`'s existing
  rollback, narrowly scoped — deliberately did not extend rollback wrapping
  to four other mutators with no history of throwing. Section 15 (schema
  migration): a real gap in the OTHER direction — declined to build
  speculative, untestable version-dispatch scaffolding, and instead added
  a genuine old-data-upgrades-correctly regression test. Section 16 (audit
  durability): removed the `EVENT_UPDATED` noise write entirely, since it
  was write-only and competing with real decisions for the same capped
  array. Section 17 (backup/recovery): audited, one real missing test
  added ("recovery-of-recovery"), zero production code changed. Section 18
  (Portable Event Package): verification-only, confirming Section 16's fix
  actually reaches the export path. Two new suites
  (`transaction-atomicity.test.mjs`, `schema-migration.test.mjs`) plus
  extensions to `storage-provider`/`audit-trail`/`offline-recovery`/
  `event-package`. Every fix mutation-proven; full clean regression 52/52
  suites, 1764/1764 checks; both offline artifacts rebuilt and verified
  (27/27). See detail below.
- Sections 19-21 (code architecture/SSOT/dead-code audits): investigated
  via `frontend-architect`, then acted on selectively. Section 19: the
  small-module dependency graph is already clean (zero exceptions found);
  the real gap was the undocumented app.js/app-guests.js override
  boundary, closed with a new static-analysis test rather than a
  restructure. Section 20: one real, narrow, currently-latent SSOT risk
  found (`guest.pax` vs. `additionalGuests`) and guarded with a
  regression test, not refactored into a computed property. Section 21:
  5 confirmed-dead functions removed (each independently re-verified,
  zero call sites anywhere), after finding a much larger candidate (21
  unreachable functions in app-v8.js's own override-capture object) and
  deliberately declining to delete those this pass — multi-file blast
  radius, no existing test coverage of the boot-sequence assumption the
  claim rests on. Two new suites (`override-boundary`, `pax-invariant`),
  every fix/guard mutation-proven. Full clean regression: 54/54 suites,
  1779/1779 checks. Both offline artifacts rebuilt and verified (27/27).
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

### Sections 4/5 in detail: audited, no gap found, no new code

Both sections asked for a re-audit of existing behaviour against a
safety/UX contract, not new implementation. The audit was real (source
read, not assumed) and its honest conclusion is that both are already
compliant — completing an audit by confirming compliance is the audit
doing its job, not a shortcut past it.

**Section 4 — object identity safety.** Read `src/plan-memory.js`'s
`identity()` end to end. The priority order it actually implements:

1. **A distance gate first.** A candidate beyond `tolerance *
   SEARCH_OF_TOLERANCE` from the remembered geometry is never considered
   at all — visual or contextual similarity cannot reach out and claim a
   distant object.
2. **A verified printed number is an absolute veto, both directions**,
   checked before any weighing: two objects with different VERIFIED
   numbers never match "however identical the two circles look" (its own
   comment, and its own test at `plan-memory.test.mjs`); two with the SAME
   verified number match at certainty regardless of what the weighing
   would have said. Only VERIFIED readings count — a NEEDS_REVIEW number
   is treated as saying nothing, since it is measured right only 17% of
   the time.
3. **Geometry dominates the weighted score** for everything the veto
   didn't already settle.
4. **Visual similarity's WEIGHT is scaled by geometric uncertainty**
   (`weights.visual = W.visual * (1 - geometryCertainty)`) — near-zero
   when geometry already agrees, largest only for an object that moved
   beyond its own tolerance. This is where a correction to an earlier
   note in this report is needed: visual similarity is not "off by
   default" — §24 of the module's own history makes it mandatory to wire
   in, and production calls `MeritPlanMemory.match()` with no `opts`,
   so `useVisual` defaults true. What stays governed is its WEIGHT, not
   whether it runs. The module's own measurement (in its header comment)
   found it does not help on this corpus — "the embedding cost four
   decisions... the neighbourhood signature cost three" — and reports
   that honestly rather than pretending it doesn't matter.
5. **Family is evidence, never a gate** — a reclassification (detector
   said table, operator said chair) is exactly the correction this
   layer exists to preserve, and requiring kind-matching would make the
   most valuable corrections impossible to re-apply.

Separately, `src/venue-model.js`'s `compareToVersion` (Layout Changes,
CLAUDE.md's own worked example) uses a stricter, purely deterministic
ladder for a different task — real published-layout comparison, where a
false positive is worse than a missed one: verified table number first,
position second, no visual similarity at all. The two modules solving two
different problems (re-identifying across a re-analysis of possibly-
different pixels, vs. comparing two published, human-confirmed layouts)
correctly use different-strength versions of the same underlying
principle — verified facts always outrank appearance — rather than one
sharing an inappropriately loose or tight rule with the other.

Both are already covered: `plan-memory.test.mjs` tests the veto in both
directions, family-never-gates, and that the embedding is "actually
consulted" and changes the score when present; `layout-changes.test.mjs`
tests the deterministic ladder. No gap found. No source or test changed
for this section.

**Section 5 — human-system interaction contract.** Read
`src/plan-confidence-budget.js` and `src/review-queue` render logic
(`app-v8.js`'s queue/review binding) plus their test suites.
`DEFAULT_MAX_ITEMS = 6` is not an arbitrary UX guess — its own header
states it was measured against both real plans ("with the two real
plans, six covers every claim that settles anything on the physical plan
and every claim that settles an object or a fact on the symbolic one")
and is explicitly overridable so a third real plan can redo the
measurement rather than inherit this one. Two governing rules are
enforced structurally, not just documented: repeated uncertainty across
N identical objects is one claim carrying the count N, not N separate
warnings; and everything below the visible line is counted and
summarised rather than silently dropped — "a budget that quietly drops
the tail is not a budget, it is a filter that lies about its own
coverage" (its own words).

The click→highlight→answer→resolve lifecycle lives in the review queue
(`ui.reviewQueue`/`queueState`), and its one load-bearing property —
what counts as RESOLVED is read from the live candidates on every
render, never a separately-tracked tally — is exactly what prevents the
queue from drifting the moment a decision is undone. `review-queue.test.
mjs` (38 checks) covers the row→highlight→decide→next path end to end
against the real committed plan (not a synthetic canvas drawing, since
OCR-based text suppression behaves differently on a real vs. a runtime-
rasterised image). `operator-questions.test.mjs` (15 checks) separately
guards the one failure mode a lifecycle test can't see on its own: two
DIFFERENT underlying questions rendering as the identical sentence,
which a person reading one row at a time has no way to detect.

No gap found. No source or test changed for this section.

### Section 6 in detail: the product actually booted in English, fixed, and 12 suites' hidden dependency on that bug fixed with it

**The bug.** `src/app.js`'s `ui` object literal had no `lang` field at all,
so `i18n.js`'s `lang()` helper (`ui.lang === "tr" ? "tr" : "en"`) treated
every fresh boot as English. `ui.guideLang` (the separate User Guide/help
language) defaulted to `"en"` explicitly. Neither was ever persisted —
`ui` is pure in-memory state, reset on every reload — so this was not an
edge case: every single session of this Turkish hospitality/casino
operations product opened in English until someone found and clicked the
language toggle.

**First fix attempt was incomplete.** Adding `lang:"tr", guideLang:"tr"`
to `app.js`'s `ui` literal fixed `guideLang` but not `lang` — because
`app-v8.js` (loaded after `app.js`, per `index.html`'s script order) runs
`Object.assign(ui, {..., lang:"en", ...})` at its own IIFE's top level,
unconditionally re-clobbering whatever `app.js` had just set. This is the
actual, sole place the real default lived. Found by testing the fix
before declaring it done — the first version passed `guideLang` but
failed `lang` in the exact same test run, which is what surfaced the
second write site rather than accepting a partially-working result.
Both are now `"tr"`, with a comment at the `Object.assign` site
explaining why keeping them in sync matters (it silently overrides
`app.js`'s value otherwise).

**Verified, not just asserted.** A real rendered screenshot at 1920x1080
(sent to the user) shows the Home screen booting fully in Turkish —
"Etkinlik Oluşturucu", "Yaklaşan etkinlik yok", "Etkinlik Oluştur",
"Yardım / Kullanım Kılavuzu" — with zero language-toggle interaction.
New regression check in `i18n.test.mjs` ("check 0", run before any other
check sets `ui.lang` explicitly) asserts a fresh `openApp()` with no
`lang` option produces `ui.lang==="tr"`, `ui.guideLang==="tr"`, and real
Turkish text in the rendered DOM — not just the internal flag, since a
flag can be right while the render path that reads it is wrong.
Mutation-tested: reverting the `Object.assign` site alone reproduced
exactly the 3 checks that depend on it; reverted back, reconfirmed
27/27.

**The 12-suite fallout, and why it is not scope creep.** Running the full
fast suite after the fix turned red in 12 suites (382 checks) that had
never explicitly set a language and had silently relied on the old
English default — hardcoded English string/regex assertions
(`event-handover`, `event-history`, `event-package`, `guest-finder`,
`offline-recovery`, `plan-doctor`, `post-event-replay`, `audit-trail`,
`backup-restore`), a Playwright `:has-text("Export Table Plan")` selector
that stopped matching anything once the button read in Turkish
(`xlsx-contract`), and two suites whose language-TOGGLE assumption
(`floor-plan-modes`, `operator-questions`) flipped: a test that clicked
the language button once and expected Turkish now correctly gets English
first, since Turkish is the state it started in. This is not scope creep
— section 6 explicitly asked for a leak audit, and a test suite that
silently depended on the very default being fixed is exactly the kind of
leak that audit exists to find. Every fix was on the test's own terms:
suites testing BEHAVIOUR (ordering, validation, wording logic), not
translation quality, were pinned to explicit English via `openApp(page,
baseUrl, { lang: "en" })` or an explicit `"en"` argument to an existing
per-call language parameter — never by weakening an assertion or
accepting a different observed value as newly "correct." The two
toggle-assumption suites got their expected VALUE corrected (English
after one click from a Turkish start, not Turkish), with a comment
explaining why. Suites with their own dedicated bilingual sections
(`guest-finder`, `audit-trail`, `post-event-replay`) were checked to
confirm those sections already set `ui.lang` explicitly per iteration
before pinning the boot default, so the pin could not interfere with
them. Zero checks were removed; every suite's check count after the fix
matches its count before section 6 began (48/48 fast suites → still
48/48, 12 previously-failing suites → 382/382 on their own, then
confirmed together with the rest via `test:all`).

### Sections 8/9 in detail: a fresh UX audit, since the original numeric targets were unrecoverable

**Why this is not the original section 8/9 work.** This report's own
earlier NEXT_ACTION entry described sections 8/9 as needing "real
interaction counting on Floor Plan and Live Event... against sections
8/9's specific interaction-count and warning-deduplication requirements."
Those specific numeric targets were part of the original 42-section
programme text, which is not recoverable in this session (lost to an
earlier context compaction). Rather than invent numbers to satisfy an
unknown target — which section 42's own rules forbid ("never fabricate
results") — this session commissioned a genuine, fresh UX audit of the
same screens (Floor Plan, Seating, Live Event) via the `visual-qa-reviewer`
agent: real rendered Chromium, real DOM/`getComputedStyle` inspection,
`page.on("dialog")` capture, and screenshots at the standard viewports —
not a design-document comparison. The agent's role is read-only/reporting
per its own definition; all triage and fixes below are this session's own.

**The audit exercised:** bulk-add, capacity edit via the contextual card,
marking a table unavailable, creating a freeze zone, attempting to seat
into a frozen/unavailable table, Global Finder check-in, Live door-search
check-in, No Show, and Smart Seating from Live. One environment caveat:
CDN requests are blocked in this sandbox, so xlsx.js/tesseract.js/pdf.js
never load — Excel import/export, OCR, and PDF plan import were
unverified in this pass (a pre-existing sandbox restriction, not a new
finding).

**8 real findings surfaced, one confirmed non-finding.** Triage below;
6 fixed this session, 2 deliberately deferred as real but larger/lower-
priority than a "no huge blind refactor" pass should absorb.

**Fixed #1 — CRITICAL: silent multi-select scope mismatch.**
`contextualCardHTML()` (`src/app-v8.js`) always resolves every field —
capacity stepper, presets, type, zone, rotation — against
`ui.selectedObjectId` alone, never the rest of `ui.selectedObjectIds`.
Bulk-add creating 4 tables, or a marquee catching several, leaves the
canvas showing a multi-select highlight while the always-visible card
implies (by giving no indication otherwise) that a capacity click would
apply to all of them — it would only ever touch one. Fixed by computing
`alsoSelected = max(0, selectedObjectIds.length - 1)` and rendering a new
`.contextual-card-also-selected` banner ("Editing this one only — N more
also selected" / Turkish equivalent) whenever it is nonzero, on both the
table card and the venue-object card. New i18n keys
`inspector.alsoSelected`/`inspector.object`. New test in
`tests/suites/guest-and-seating-rules.test.mjs`: confirms no banner with
one object selected, confirms the banner and its count with two selected,
and confirms a capacity-preset click changes only the primary selection's
capacity — mutation-proven (zeroing the `alsoSelected` computation was
caught, then reverted and reconfirmed).
**Follow-up from the post-fix screenshot pass:** the banner's text/
background pairing measured at ≈3:1 contrast (computed against the near-
white card background this sits on, `color-mix(...,8%,transparent)` of
`--pi-warn` over `--pi-surface: #fff`) — under WCAG AA's 4.5:1 floor for
11px text. This exact `--pi-warn`-on-8%-tint pairing is inherited from an
existing pattern used in several other places already (`.poi-lowevidence`,
`.poi-visual-note.disagree`, `.plan-contradictions>strong`), so a
token-level fix was out of scope here; instead this one new component's
text color was switched to `--amber-ink` (~5.7:1 against the same
background, same warning hue family, border/background tint unchanged) —
a locally-scoped fix since this is new code, not a patch applied
inconsistently to a shared token used elsewhere.

**Fixed #2 — MEDIUM: unavailable-reason silently defaults to "Damaged."**
The reason `<select>` (`src/app-v8.js`, the table card's availability
block) built its options via `Object.keys(A.REASON).map(...)` with no
blank/placeholder entry, so the browser pre-selects whichever `REASON` key
happens to be listed first (`DAMAGED`) — a click on "Mark unavailable"
that never opens the dropdown silently records "Damaged" for a table that
might be relocated, on AV hold, or anything else. Fixed with a disabled,
selected placeholder option (`avail.reason.CHOOSE`, "Choose a reason…")
as the first entry, plus a guard in the click handler
(`if(next==="UNAVAILABLE"&&reasonEl&&!reasonEl.value){toast(...);return;}`)
that refuses to proceed and shows `avail.reasonRequiredToast` if the
placeholder is still selected. `setTableAvailability()` itself was already
safe (`A.REASON[reason]||A.REASON.OTHER`); the bug was purely that the UI
always handed it *some* value even when the operator chose nothing. New
checks in `tests/suites/table-availability.test.mjs`: the select starts on
the empty placeholder value; clicking Mark Unavailable without choosing a
reason marks nothing and toasts the explanation; choosing a real reason
then works normally. Mutation-proven (removing the guard was caught by
both the new check and, transitively, by the existing "since"/"reason
recorded" checks further down the same suite, then reverted). This also
required updating `tests/suites/audit-trail.test.mjs`'s own
mark-unavailable step to select a reason first — it was relying on the
old implicit default, the same class of hidden dependency section 6 found
around the language default.
**Follow-up from the post-fix screenshot pass:** the same pass found the
`[data-avail-reason]` select renders in native, unstyled browser grey —
pre-existing (it sits in `.table-card-avail`, never inside a `.field`
wrapper, so it never picked up the app's `.field select` input styling),
not introduced by this diff, but tightly coupled to this fix's own goal
of "reads as a placeholder, not a real choice." Fixed by giving
`.table-card-avail select` the same background/border/radius/focus-ring
treatment as `.field select`, plus a `required` attribute on the element
(purely for the `:invalid` CSS hook — nothing here calls
`checkValidity()`/`reportValidity()`, so it changes no runtime behaviour)
so the still-placeholder state visibly reads as muted via
`:invalid{color:var(--muted-2)}`.

**Fixed #3 — MEDIUM: Freeze Zone form's fast path could freeze 100% of
the room with no warning.** Opening the freeze form defaults to
`scope: "ZONE"` with `zone: zones[0]`, so a room with one dominant zone
covering every table could be entirely held back by opening the form and
clicking Freeze without changing anything — `createFreezeFromDraft()`
already refuses a rule that covers *nothing*, but nothing warned about a
rule that covers *everything*. Fixed with a live preview computed from
the in-progress draft on every render (`freezeFormHTML()`, `src/app-v8.js`):
a `.freeze-preview` line ("This will cover N of M tables · C chairs") using
`FREEZE().tablesCovered()` against the current draft, and an additional,
more strongly-styled `.freeze-preview-all` warning line when the scope
covers every seatable table in the plan. New i18n keys
`freeze.preview`/`freeze.previewNone`/`freeze.previewAll`. New checks in
`tests/suites/seating-freeze.test.mjs`: the partial-scope preview names
the right table/chair counts with no whole-room warning; a deliberately
whole-room-covering scope (TABLE_GROUP, prefix T, 0–99, matching every
table in that suite's room) raises both the count line and the warning
line, with the right total. Mutation-proven (forcing `coversAll` to always
`false` was caught, then reverted).

**A real reactivity bug in this fix, found by actually rendering it — and
a real gap in the first test that let it through.** The mandatory
post-fix screenshot pass (`visual-qa-reviewer`, per this project's own
"not done until rendered and screenshotted" rule) found that the preview
box only updated when the SCOPE field itself changed
(`if(key==="scope")render();` in `bindFreezeZones`'s field-commit
handler) — changing zone, prefix, from, or to committed to
`ui.freezeDraft` but never re-rendered, so the box could sit on a stale
"1 of 4 tables" number right up to the click that would actually freeze
all 4. Re-running the ORIGINAL version of this fix's own test against the
unfixed code showed it passing anyway — a real gap in the test, not just
in the code: the test happened to reselect the scope dropdown to a value
it already held immediately before checking the zone-driven number, and
that incidental full re-render (triggered by the scope field alone)
masked the exact bug it was meant to catch. Confirmed by mutation: the
original test, run against the reverted (buggy) commit-handler, stayed
green. Fixed properly in two parts: (1) `freezeCoveragePreviewHTML()` was
pulled out of `freezeFormHTML()` into its own function so the field-commit
handler can refresh just the preview `<div id="freezePreviewBox">` for
any field that changes coverage (`zone`/`prefix`/`from`/`to`/`tableId`),
without a full `render()` — deliberately not a full re-render on every
keystroke, since that would replace the input DOM nodes themselves and
throw the caret out of whatever field is being typed into, the exact
failure mode the original code's own comment was written to avoid for the
note field; (2) the test was rewritten to isolate the exact non-scope-field
case — switch to `TABLE_GROUP` once (a real, expected-to-render scope
change), then change ONLY the `to` field, with no further scope touch at
all, and assert the box moves immediately and raises the whole-room
warning. Re-run against the reverted commit-handler, this rewritten test
now fails exactly as expected (`afterToChangeOnly` stays byte-identical to
`beforeToChange`); reverted back to the fix, 89/89 green. This is the same
"first fix attempt was incomplete, found by testing before declaring it
done" discipline section 6 already established, this time catching a gap
in the TEST rather than the first code fix.

**Fixed #4 — LOW-MEDIUM: the same "table is unavailable" rule gave two
different affordances.** The seat-row path already gave a clear toast via
`assignGuestGroup()`'s own guard; the primary "Seat/Move here" CTA on the
table card used a native `disabled` attribute instead, which swallows the
click entirely — a dead click with no explanation beyond a hover tooltip.
Fixed by dropping the native `disabled` attribute in favour of a purely
visual `.is-blocked` class (same dimmed look, `cursor:not-allowed`) so the
click still reaches `assignGuestGroup()`'s existing guard and produces the
identical toast the seat-row already gives. Discovered mid-fix that
`aria-disabled="true"` has the same swallowing effect (Playwright's own
actionability model — and some assistive tech — treat it as non-
interactive the same as native `disabled`), so the button carries neither
attribute, only the `is-blocked` class and its `title` tooltip; this is
also the more honest a11y shape here, since the control genuinely does
something when activated (explains why, rather than being truly inert).
New checks in `tests/suites/table-availability.test.mjs`: the CTA is
`is-blocked` but not natively disabled, and clicking it directly (not just
the seat row) seats nobody and shows the same toast. Mutation-proven
(reverting to native `disabled` was caught by both the class check and a
real click timeout, then reverted).

**Fixed #6 — LOW: sub-floor typography on real operational content.**
Three elements the UI constitution's ~12–14px floor applies to (they are
content an operator reads continuously, not decorative micro-labels) were
measured via `getComputedStyle` at 9–9.5px: the seat-row list inside the
table card (seat numbers, occupant names, "Empty"), the Floor Plan/Seating
canvas toolbar's zoom-percentage label, and the table card's
CAPACITY/OCCUPIED/EMPTY stat labels. Bumped in `src/styles.css`:
`.seat-row` 9px→11px, `.zoom-label` 9px→11px, `.table-card-stats span`
9.5px→10.5px (a smaller bump — this one is a genuine uppercase kicker
label pattern used consistently across dozens of other labels app-wide,
and its adjacent value is already 17px, so a full jump would be
inconsistent with the rest of the app's established hierarchy language
rather than a correction). Deliberately not a sweep of every 9px kicker
label in the app — those are a consistent, intentional hierarchy device
per the UI constitution's own "use hierarchy, not extreme shrinking"
language, and the finding named these three specific, content-bearing
spots, not the whole app's label system.

**Fixed #7 — LOW: Smart Seating's "no table fits" message didn't explain
frozen/unavailable tables as the reason.** `smartSeatingHTML()` showed
`seat.noneFit` ("No table has N seats free together. M were considered.")
whenever `advice.options.length === 0`, with no distinction between "the
room is genuinely full" and "most of the room is frozen or failed
tonight" — the latter could read as a broken recommender to a first-time
operator. Fixed by counting `advice.blocked` entries with
`why === "FROZEN"`/`"UNAVAILABLE"` and appending
`seat.noneFitFrozen`/`seat.noneFitUnavailable` ("N of them are frozen." /
"N of them are marked unavailable.") whenever those counts are nonzero —
`seating-advisor.js` itself was untouched, since it already reported these
reasons in `blocked`; only the empty-state message composition in
`app-v8.js` needed to read them. New check in
`tests/suites/smart-seating.test.mjs`: a scenario with one table
unavailable and one frozen produces a message naming both, in whichever
language is active; the suite's existing "genuinely full room" scenario
(no frozen/unavailable tables involved) continues to pass unchanged,
proving the addition is additive, not a rewording of the base case.
Mutation-proven (zeroing both counts was caught, then reverted).

**Deferred #5 — LOW: native `browser confirm()` for destructive actions**
(table delete, backup restore, event-package import, offline-recovery
restore) is inconsistent with the app's own styled modal system
elsewhere. Real, but a multi-site refactor touching several independent
flows — STILL VALID, not attempted, consistent with the "no huge blind
refactor" constraint.

**Deferred #8 — LOW: toasts stack indefinitely with no dismiss control.**
Real, but cosmetic and lower priority than the six fixed above — STILL
VALID, not attempted.

**Confirmed non-finding:** Live Event has no direct Smart Seating control
on a guest row. This matches this project's own documented, intentional
design (`CLAUDE.md`'s guest-finder section: "CHANGE TABLE opens Seating
with the guest selected and waits for a person") — not a gap.

**Validation, in two rounds.** Round one (source/logic review + mutation
testing, before any rendering): all new/modified suites green individually
and together, plus the full fast suite (49/49 suites, 1701/1701 checks)
and both offline artifacts rebuilt and verified. Round two was the
mandatory rendered-and-screenshotted pass this project's own UI
constitution requires before any UI change counts as done
(`visual-qa-reviewer`, real Chromium, at 1920×1080/2560×1440/~1440px) —
and it is the round that actually earned its keep: it found the fix #3
reactivity bug (detailed above) that round one's own mutation testing had
missed, plus the two styling follow-ups on fixes #1 and #2. Every fix
that changed after round two was re-validated the same way as round one
— mutation-proven, then the full fast suite re-run green — before being
called done. Final counts: `table-availability` (42 checks),
`seating-freeze` (89, +4 from the reactivity-bug test rewrite),
`smart-seating` (48), `guest-and-seating-rules` (16), `audit-trail` (27,
one pre-existing step updated for fix #2's new required-reason
behaviour), full fast suite 49/49 suites green, both offline artifacts
rebuilt and re-verified (27/27) after every code change in this section.

### Sections 10/11/12/30 in detail: investigate-first on net-new features, then build only the real gaps

**Why this section was handled differently from 8/9.** Sections 8/9 audited
EXISTING screens against lost numeric targets — there was real code to
measure against, even without the original numbers. Sections 10-12 describe
three NET-NEW features with no existing implementation to audit, and the
same context compaction that cost sections 8/9 their numeric targets also
cost these three their detailed specs. Building three net-new features from
guessed specs risks exactly what section 42 forbids — implementing
something and calling it done against a requirement nobody can actually
check. This session asked the user how to proceed (the first of two genuine
decision points in this segment); the user chose **investigate and propose
scope first**, so the `merit-product-director` agent (read-only,
product-semantics specialist) was sent to establish what the surrounding
product already covers for each of the three, before any code was written.

**The investigation's findings, and the second user decision.** The agent
found: **Section 10** (Event Readiness Timeline) is substantially redundant
— Plan Doctor already answers "can this event proceed" live and derived
(never stored, never stale), the Command Center's Risk Radar and attention
list already surface the same underlying facts as a status rather than a
log, the Arrival Wave already tracks the door in real time, and Post-Event
Replay already reconstructs what happened after the fact from the audit
trail. A genuinely new stored "timeline" would either restate one of these
in a second place (a drift risk Plan Doctor's own "nothing is remembered,
derived live" design law exists specifically to prevent) or add a feature
whose only job is to summarize features that already exist. **Section 11**
(Data Provenance Inspector) is a real, narrow, clean gap: `table.
capacitySource` (from Section 3, this same session) and venue-object
`seatsConfidence`/`seats` (pre-existing, sofa/bench/banquette only) are both
fully computed and persisted, but neither had ANY rendering path anywhere
in the UI after being set — confirmed by grep, zero hits. **Section 12**
(interactive first-run onboarding) is genuinely unbuilt — no onboarding
concept of any kind existed in the codebase. Presented with this, the user
chose the second explicit decision of this segment: **build 11 and 12 only,
skip 10, and mark 10 OBSOLETE with the evidence rather than NOT STARTED** —
since NOT STARTED would wrongly imply the feature is still owed, when the
investigation showed the problem it would solve does not exist.

**Section 11 implementation.** `contextualCardHTML()` (`src/app-v8.js`)
gained one new read-only block per object kind, inserted between the
existing form/stats and the action row — never editable, since provenance
is a fact about where a number came from, not a field to correct (a
correction happens through the object's own existing edit path, which
already re-derives provenance on write). For a **table**: `capacitySource`
is read through a new accessor mirroring the existing `FREEZE()`/`AVAIL()`
pattern (`const CAPPROV=()=>globalThis.MeritCapacityProvenance||null;`),
and a `capacitySourceKey()` helper does a pure mechanical camelCase
conversion (`"DETECTED_PHYSICAL_SEATS"` → `"capacitySource.
detectedPhysicalSeats"`) to reach the already-existing i18n keys from
Section 3 — no new enum, no new state, the whole feature is a read of data
that already existed. For a **sofa/bench/banquette venue object** (the
`UNVERIFIED_SEATING` set): the seat count and its verified/unverified badge
render the same way, reusing the exact fields Section 11's own audit
confirmed were being computed and silently dropped. New i18n keys:
`inspector.capacitySource`, `inspector.seatsVerified`, `inspector.
seatsUnverified`.

**Two real bugs, found by the mandatory rendered screenshot pass, both
fixed.** Consistent with this project's own "not done until rendered and
screenshotted" rule, a `visual-qa-reviewer` pass on the new card content
surfaced two genuine defects neither source review nor the first round of
tests had caught:

1. **Raw i18n key leak.** The venue-object header composes as `t("inspector.
   object",{type:t("bulk.type."+o.type)})`, but `bulk.type.sofa`/`bench`/
   `banquette` had never been defined — those three types were previously
   reachable only through Assisted Detection's review flow, which uses a
   parallel `teach.type.*` key family, never through a committed venue
   object's contextual card until Section 11 made that path render for the
   first time. The result was a literal raw key on screen: "BULK.TYPE.SOFA
   NESNESİ" in Turkish. Fixed by adding the three missing keys (`src/
   i18n.js`, EN/TR pairs, with a comment explaining why they were missing).
2. **CSS overflow in Turkish.** `.contextual-card-provenance`'s original
   layout was a non-wrapping `display:flex;justify-content:space-between`
   row with `white-space:nowrap` on its label/value spans — sized to fit
   the English strings, but Turkish equivalents run longer and pushed the
   confidence badge past the fixed 272px card's right edge. Fixed by
   rewriting the block to a stacked layout (label on its own line via
   `span{display:block}`, value/badge flowing as normal inline text below,
   `overflow-wrap:anywhere`) that cannot overflow regardless of language or
   content length.

Both fixes got new regression tests in `tests/suites/capacity-provenance.
test.mjs`, and both were mutation-proven: removing the three i18n keys
reproduced the exact raw-key text the new header-leak check asserts
against; reverting the CSS reproduced the exact overflow the new check
catches. The overflow check needed a second attempt to get right — see
"A test-writing lesson" below. Final suite count: 33 checks (`capacity-
provenance`), all passing alongside the existing 27 in `i18n`.

**A test-writing lesson: measure the child, not the container.** The first
version of the overflow check measured the ROW's own `getBoundingClientRect
().right` against the card's — and it passed even against the reverted,
genuinely-overflowing CSS (confirmed by mutation-testing, a false
negative). The reason: a `display:flex` block-level child with `width:auto`
sizes its own box to the parent's available width regardless of its
children's content, while flex ITEMS with `white-space:nowrap` (default
`min-width:auto`) cannot shrink below their own content's intrinsic
minimum — when the combined minimums exceed the available space, the
CHILDREN visually spill past the container's edge while the container's own
measured box is untouched. The check only became meaningful once rewritten
to measure each child's own `getBoundingClientRect().right`
(`[...row.children].map(el => el.getBoundingClientRect().right)`) against
the card's edge, which then correctly failed against the buggy CSS
(`childRights: [1749.2, 1807.4, 1903.5]` vs. `cardRight: 1900`, a ~3.5px
overflow matching the visual bug exactly) and passed once fixed.

**Section 12 implementation.** New functions in `src/app-v8.js`:
`onboardingSeen(key)`, `dismissOnboarding(key)`, `resetOnboarding()`, and
`onboardingCalloutHTML(key)` (returns `""` once a key is seen, so every
call site is a plain, unconditional call with no caller-side branching).
`state.onboarding` follows the exact same lazy-init, `state`-not-`event`
pattern as `state.audit` — never subject to `canMutate`/`isHistorical`,
never exported in a portable event package, never reset by switching
events. Five anchor points, each gated behind `!historical` at its call
site: the workspace header (`workspaceHTML()`, key `globalFinder`), the
Command Center's Risk Radar (`riskRadarHTML()`, key `commandCenter`), the
Freeze Zones empty state (`freezePanelHTML()`, key `freezeZones`), Smart
Seating once a guest is selected (`smartSeatingHTML()`, key
`smartSeating`), and an available table's card (only when NOT already
unavailable — the tip is about the mark-unavailable control itself, which
isn't even on screen once a table has already failed, key
`tableAvailability`). A single delegated `document.addEventListener
("click", ...)` handles every `[data-onboarding-dismiss]` click from one
place, so no per-screen bind function needs to know the feature exists —
modeled on this file's existing persistent listeners (`pointerdown`,
`focusin`) at the same top-level location. The Guide modal gained a "Show
tips again" button calling `resetOnboarding()`, which clears every key back
to unseen.

**A real override-pattern trap, caught before it shipped.** The first
attempt at the Guide's reset button was written into `app-guests.js`'s
`renderGuide()` — the ORIGINAL implementation of that function. But
`app-v8.js` (loaded last, per `index.html`'s script order) reassigns the
bare `renderGuide` identifier to its own, entirely different card-grid
implementation — a top-level `let`/`function` in a non-module classic
script is a plain global, and the later script's bare reassignment silently
shadows the earlier one for every caller from that point on. The button
never appeared in the actually-rendered Guide; a debug dump of the live
DOM's Guide markup showed a template with no trace of the edit, which is
what surfaced the mistake. Fixed by reverting the `app-guests.js` edit
(restoring it to original, plus a comment explaining the override for the
next person who reads that function first) and applying the real button +
`resetOnboarding()` wiring to the ACTIVE override inside `app-v8.js`.

**A false-negative persistence test, caught by mutation-testing the test
itself.** The "dismissal survives a reload" check passed even when
`dismissOnboarding()`'s own `saveState()` call was deliberately removed,
because the app's unconditional `window.addEventListener("beforeunload",
() => saveState())` safety net saves current state before any `page.
reload()` completes — masking a missing explicit save inside the function
under test. Fixed by spying on the bare `saveState` global immediately
before the one dismiss click under test (reassigning it to a counting
wrapper via `page.evaluate`, restorable since it is a plain top-level
binding) and asserting the spy fired from that action alone, independent
of the later reload's own safety-net save.

**Validation.** New suite `tests/suites/onboarding.test.mjs` (22 checks)
covers: callout presence on first view of the workspace, dismissal removes
it and persists (via the `saveState` spy above) and survives reload,
`state.onboarding` never lives on the event object, each of the 4 other
anchors dismisses independently under its own key, the Table Availability
callout is absent when a table is already unavailable even with its key
force-reset to unseen, "Show tips again" clears every key at once, zero
callouts render anywhere once an event is historical, and both languages
carry real, different copy. Mutation-proven across 3 distinct mutations
(a missing `saveState()` call, `resetOnboarding()` not clearing `seen`, and
`onboardingCalloutHTML()` ignoring seen/historical state — all three
correctly caught, then reverted). A `visual-qa-reviewer` pass at the
standard viewports found zero remaining issues.

**Full validation after both sections' bug fixes.** A clean, full fast
regression run (no concurrent edits, per this session's own earlier
methodology correction) came back 50/50 suites, 1737/1737 checks passed.
Both offline artifacts were rebuilt (`build-offline.mjs`, `build-offline-
full.mjs`) and re-verified end-to-end via `verify-offline-package.mjs`
(27/27), since `src/app-v8.js`, `src/i18n.js`, and `src/styles.css` all
changed again after the last offline build.

### Sections 13-18 in detail: storage/transaction/migration/audit/backup/package hardening

**Investigated first.** These six sections span data-architecture territory
squarely matching the `data-architecture-engineer` agent's role, and — like
sections 10-12 — their original one-line status-table descriptions are all
that survives the earlier context compaction. Rather than build blind
against vague descriptions, the agent investigated the actual current
implementation of each (with file/line citations) and reported back real
gaps, real non-gaps, and concrete, minimal-scope proposals, before any code
was written. All six investigation findings held up under this session's
own direct re-reading of the same code, with two of six (sections 14 and
15) resolved differently from the investigation's own proposal, for reasons
detailed below.

**Section 13 (storage write-ordering safety) — DONE.** The investigation's
finding, confirmed by direct reading: `saveState()` was fire-and-forget —
`storageProvider.save(payload)` fired immediately with no in-flight
tracking, and `IndexedDBStorageProvider.save()` opens a brand-new
`indexedDB.open()` connection on every single call. Two overlapping
`saveState()` calls therefore raced on which write's underlying transaction
actually got *created* first, which depends on connection-open latency, not
call order. `mutationEpoch` — named in the status table as a "plausible
foundation" — was confirmed to guard only three render-time memos
(`frozenMemo`/`loadMemo`/`waveMemo`), never the write path itself, so
extending it was the wrong lever. **Fixed** by introducing `saveQueue`
(`src/app-v8.js`): every `saveState()` call now does
`saveQueue=saveQueue.then(()=>persistPayload(payload,show))`, chaining each
save onto the one before it so writes reach storage in exactly the order
`saveState()` was called, regardless of connection-open timing.
`persistPayload()`'s own last `.catch()` always resolves, so one save's
storage error can never stall every save queued after it.

**A test that needed two attempts to get right, twice.** Real IndexedDB is
too fast in a test run for the hazard to reproduce from incidental timing,
so `storage-provider.test.mjs`'s new check wraps `indexedDB.open` to make
the FIRST call after a marker point resolve 250ms slower than the second —
simulating the exact shape of hazard a loaded browser could produce. The
first version asserted on the result of a `page.reload()`; this reproduced
the corruption directly (confirmed via a raw IndexedDB read: the stale
value from the deliberately-slow call really did land last and overwrite
the fast one) but the RELOAD-based assertion itself came back showing the
*correct* value regardless — because the app's own unconditional
`beforeunload`→`saveState()` handler fires during the reload and
re-persists the OLD page's (never-corrupted) in-memory value, masking the
exact storage-layer inconsistency the check exists to catch. This is the
same masking class this session already found once this segment (in the
Section 15 fixture-loading test, below) and once in an earlier segment (the
onboarding persistence test). **Fixed** by reading the raw IndexedDB record
directly instead of reloading — mutation-tested by reverting the queue,
which reproduced the corruption exactly (`"RACE-FIRST"` where `"RACE-
SECOND"` was expected), then reverting back to confirm green.

**Section 14 (domain transaction atomicity) — DONE, narrowly scoped
differently from the investigation's own proposal.** The investigation
found two things: (1) `assignGuestGroup()`'s existing snapshot-and-rollback
(the only such mechanism in the codebase) calls `touchEvent(event)` —
which persists — *before* `render()`, inside the same `try`. A throw from
`render()` itself (not the assignment loop) would leave storage holding
the successful move while the catch's revert only undoes it in memory; the
next unrelated `touchEvent()` anywhere in the app would then persist that
stale, reverted state, silently undoing an already-saved seating move.
This is real and was confirmed by direct reading. (2) The investigation
additionally proposed extracting a reusable rollback helper and applying
it to `setArrival`/`setTableAvailability`/freeze create-lift/
`commitCandidates`, none of which have any existing try/catch.

**This session implemented (1) but declined (2), deliberately.** All four
of those other functions are plain field assignments and one `audit()`
call — no loops, no lookups that could realistically fail, no external
calls. `render()` throwing is a systemic risk shared by roughly 30+
`touchEvent(x);render()` call sites across the codebase, not something
unique to these four; wrapping only these four in new snapshot/rollback
machinery would be inconsistent (why these and not the other 26+) and,
more importantly, exactly the "add error handling for scenarios that can't
happen" this project's own CLAUDE.md explicitly forbids. `assignGuestGroup`
earned its existing rollback because its assignment LOOP was judged risky
enough for one historically; that judgment does not transfer to four
functions with no comparable loop and no history of needing one. **Fixed**
by re-persisting inside the existing catch:
`snapshot.forEach(...);touchEvent(event);toast(...)` — closing the real gap
without inventing new machinery. New suite `transaction-atomicity.test.mjs`
monkey-patches `render` to throw once mid-move, confirms the in-memory
assignment reverts to the original table, and — reading the raw IndexedDB
record directly for the same reload-masking reason as Section 13 — confirms
storage agrees. Mutation-tested: removing the added `touchEvent(event)`
reproduced the exact stale-persistence bug (`persistedAfterRollback` held
the failed move's table id), then reverted to confirm green.

**Section 15 (schema migration chain/registry) — PARTIAL, deliberately, by
evidence.** The investigation's own proposal — preserve the incoming
`schemaVersion` before `parseRoot` overwrites it, and give `migrateEvent`'s
patches named-step identity — was explicit that "this alone doesn't change
any behavior today." Confirmed by direct reading: `parsed.schemaVersion` is
a write-only stamp, never read or branched on anywhere in the codebase, and
every migration step to date is idempotent and purely additive. Building
version-dispatch scaffolding with nothing to route yet, and no way to test
it (nothing would observably differ before/after), is precisely the kind
of speculative, half-finished implementation this project's own rules
forbid — this is the mirror image of section 14's call: there, evidence
justified a real fix over the investigation's broader proposal; here,
absence of evidence argues against implementing the investigation's
proposal at all. **What WAS real and buildable**: proof that the existing
single-pass, version-blind `migrateEvent()`/`parseRoot()` actually upgrades
data shaped like a genuinely old install, not just today's shape minus one
field. New suite `schema-migration.test.mjs` writes a raw fixture directly
into IndexedDB — no `capacitySource`, no `hasPhysicalSeats`, no `freezes`/
`handoverNotes`/`background`, a guest with only the pre-split `status`
field and no `pax` at all — and confirms every field arrives at today's
correct, complete shape after a reload. Building this test hit the same
`beforeunload`-masking class twice: first the fixture write itself was
silently overwritten by the OLD page's blank in-memory state saving itself
during the reload (fixed by neutralising `saveState` right before
navigating away, since that safety net's write is not what the test
exercises); second, the fixture's missing `date` field crashed
`fmtDate()`/`nextEventHeroHTML()` during the FIRST render after recovery —
a real fixture gap, not a code bug, fixed by adding a realistic `date`.
Mutation-tested: skipping `capacitySource` normalization in `migrateEvent`
was caught (`table with no capacitySource... UNKNOWN`), then reverted.

**Section 16 (audit durability) — DONE.** The clearest-scoped fix of the
six, because the module's own existing doc comments already named the
diagnosis. Confirmed by direct reading: `touchEvent()` called
`audit(event,"EVENT_UPDATED")` on every single mutation across the whole
app, into the SAME global, shared, 1000-entry FIFO-capped `state.audit`
array `MeritAuditTrail`'s 13-code allowlist reads from — but
`EVENT_UPDATED` is not in that allowlist, is never rendered, and
`event.lastModified` already captures the one fact ("last touched") it
could have carried. It was pure write-time noise competing with real,
allowlisted decisions for the same shared budget — an event with heavy
mundane editing could evict a genuine `FREEZE_CREATED` or
`TABLE_AVAILABILITY_CHANGED` well before 1000 *real* decisions ever
accumulated. **Fixed** by removing the `audit(event,"EVENT_UPDATED")` call
from `touchEvent()` entirely — confirmed via grep that nothing else in
`src/` or `tests/` depends on it being written (the existing cap-disclosure
test pads `state.audit` directly, bypassing `touchEvent`, so it is
unaffected). New check in `audit-trail.test.mjs`: after a full session of
ordinary mutations (table creation, arrival check-in, freeze, handover
notes, a second event), zero `EVENT_UPDATED` entries exist anywhere in the
shared log. Mutation-tested: restoring the old write reproduced exactly 6
stray entries, then reverted to confirm zero.

**Section 17 (backup/recovery hardening re-audit) — DONE, audit only, no
code gap found.** Re-read both mechanisms end to end:
`exportBackup`/`importBackupFile` (whole-install backup, with reference-
integrity checks before touching `state`) and `src/offline-recovery.js`
(an automatic, throttled, capped ring buffer under its own StorageProvider
key, independent of the primary record). Corrupted-backup-file detection
and corrupted-*primary*-record detection were both already covered and
tested. The one angle neither suite exercised: the automatic snapshot slot
*itself* corrupted (as distinct from the primary record) — "recovery-of-
recovery." Direct reading confirmed this is ALREADY safe by construction:
`loadV8Async()`'s snapshot read is wrapped in its own try/catch, and
`MeritOfflineRecovery.latestSnapshot()` already returns `null` for
anything that isn't a real array (`Array.isArray(snapshots) ? snapshots :
[])[0] || null`), so a corrupted `"autosnapshots"` value falls through to
`blankRoot()` exactly like having no snapshot at all. **Fixed nothing in
production code** — added the missing test to `offline-recovery.test.mjs`:
corrupt BOTH the primary record and the autosnapshot slot, boot a fresh
page in the same browser context (bypassing `beforeunload` healing, the
same technique the suite's own check 5 already established), and confirm
boot throws nothing and degrades to the correct, honest blank slate.
Mutation-tested against `latestSnapshot`'s own array guard (removing it
reproduced a crash during the SAME check-1 unit-level assertion, confirming
the guard is real and load-bearing) and against the outer try/catch in
`loadV8Async` (removing it broke the suite before check 8 even ran, since
check 5 shares the same code path — confirming both checks are sensitive
to real regressions in this exact area, even though this particular
mutation couldn't cleanly isolate check 8 alone from check 5).

**Section 18 (Portable Event Package re-audit) — DONE, verification
only.** Traced sections 2 and 3's dependencies through
`src/event-package.js` directly: `regenerateIds()`'s spread preserves a
symbolic table's `physical:false` chairs unchanged (section 2, no gap), and
`exportEventPackage()`'s generic clone plus `importEventPackagePayload()`'s
`migrateEvent()` call means `capacitySource` travels and normalizes with
no special-casing (section 3, no gap) — both independently confirmed, not
assumed from the earlier section 3 write-up. Section 16 was the one real,
live dependency: `exportEventPackage()` sources its carried audit history
from the same shared, capped `state.audit` array section 16 fixed. Added
the regression case the investigation named to `event-package.test.mjs`:
inject 1000 ordinary `touchEvent()` calls on a second, unrelated event
between building the real fixture's decisions and exporting it, then
confirm the export still carries `HANDOVER_NOTE_ADDED`. Mutation-tested by
reintroducing the old `EVENT_UPDATED` write: the 1000 unrelated edits
correctly evicted the fixture's own decision (`pkg.auditEntries` came back
empty), reproducing the exact defect Section 16 fixed; reverted to confirm
33/33 green.

**Validation.** Every fix mutation-tested individually as detailed above.
Full clean regression run (no concurrent edits): 52/52 suites, 1764/1764
checks passed — up from 50/50 suites, 1737/1737 checks before this
segment, reflecting the two new suites (`transaction-atomicity`,
`schema-migration`) plus extended checks in `storage-provider`,
`audit-trail`, `offline-recovery`, and `event-package`. Both offline
artifacts rebuilt (`build-offline.mjs`, `build-offline-full.mjs`) and
re-verified end to end (27/27), since `src/app-v8.js` changed materially
across all six sections.

### Sections 19-21 in detail: code architecture, SSOT, and dead-code audits

**Investigated first, then independently re-verified.** These three sections
are squarely `frontend-architect`'s domain (code health, modularization,
dependency boundaries). Their one-line status-table descriptions were all
that survived the earlier context compaction, so the agent investigated
the actual codebase — real line counts, a real cross-reference graph, grep
evidence for every claim — before proposing scope. This session then
independently re-verified the two most consequential and most destructive-
if-wrong claims (the 5 "confirmed dead" functions, and the 21-vs-12 split
of `original`'s captured names) by direct grep before acting on either,
per this project's own "trust but verify" standard for anything a delete
depends on.

**Section 19 (code architecture hardening) — DONE, audit only.**
`src/app-v8.js` is 8,527 lines; the full `src/` tree is 18,710 lines across
32 files. Confirmed by grepping every one of the ~28 smaller domain modules
for `state.`/`ui.`/`render(`/`touchEvent(`/`toast(`/`canMutate(`: zero real
hits (the handful of matches are comments or same-named local parameters,
not the global). Every smaller module is a pure function taking its inputs
as arguments — none reaches into app-v8.js's mutable globals. Two apparent
"forward references" (`plan-embedding.js`'s `MeritRegisterPlanEncoder`,
`plan-intelligence.js`'s lazy read of `MeritVisualEmbedding`) are both
lazy, guarded, and already documented — not a genuine circular dependency.
**No restructuring was warranted**: the one-directional-via-`globalThis`
architecture is already the intended, working shape. What WAS real and
previously unenforced: the boundary between that clean graph and
app-v8.js's OWN `const original={...}` capture of app.js/app-guests.js's
pre-V8 bare functions (`render`, `saveState`, `touchEvent`, and ~30 others)
— some are genuinely delegated to later in the file, most are captured and
never referenced again, and which is which was an undocumented,
unenforced fact. **Fixed** with a new pure-Node static-analysis suite,
`override-boundary.test.mjs` (matching the existing
`no-sample-specific-runtime-logic.test.mjs` pattern — no browser): it
parses the `original={...}` object, checks every name against a real
`original.<name>` call site elsewhere in the file, and asserts the
computed unreferenced set matches an explicit, reviewed allowlist exactly
in both directions — a name added to `original` without being reviewed
fails loudly, and so does a name on the allowlist that quietly gained a
real delegation since it was last reviewed. Mutation-tested: adding an
unreviewed new name (`canMutate`) to the capture object was caught, then
reverted.

**Section 20 (single source of truth audit) — DONE, one real narrow gap
found and guarded.** Checked three candidates directly: table
capacity/chairs (all four write sites — `createTable`, `createTableFromDraft`'s
override, `setTableCapacity`, `commitCandidates` — call `syncTableChairs`
at the same statement; no drift path); `isHistorical` (exactly one
definition, confirmed by grep); `occupiedSeatIndexes` vs. `liveUsedIndexes`
(deliberately separate functions over different fields, exactly as the
product contract requires — not a violation). Found one real, narrow risk:
`guest.pax` is a redundant cached field (`1+additionalGuests`), correctly
recomputed at all 5 current write sites (`normalizeGuest`, the guest-dialog
submit handler, the import wizard's `revalidateInterpreted`/
`importInterpretedGuests`, and the demo-seed data) — but `paxOf()` reads
the cached field directly rather than recomputing it, and nothing enforces
the relationship, so a future write site could drift silently with nothing
to catch it. **Fixed** with a new suite, `pax-invariant.test.mjs`, checking
the invariant across three real, UI-driven paths: manually adding a guest
via the dialog, manually editing one's party size down via the same
dialog, and the demo-seed generators (`seedGuests()`/`createDemoEvent()`,
called directly as the production seed-data functions they are).
Deliberately did **NOT** convert `pax` into a computed getter — every
current site is already correct, and that refactor would touch every read
site (`paxOf`, exports, reports, Excel import/export) with no real bug
driving it, exactly the kind of wide change this programme's own rules
argue against absent evidence. Mutation-tested: making the edit-dialog's
submit handler preserve the OLD cached `pax` instead of recomputing it
(exploiting the fact that the assignment-branch's own early `pax` write is
overwritten by a later `Object.assign` for unassigned guests) reproduced
the exact drift (`expected:1, actual:4`), then reverted.

**Section 21 (dead/duplicate code audit) — DONE, 5 confirmed dead
functions removed.** Every candidate was independently re-verified by
direct grep (`grep -rn '\bname\b' src/ tests/ index.html scripts/
benchmarks/`) before deletion, confirming exactly one occurrence (the
declaration) in every case:
- `eventCard(event)` (`app-v8.js`) — a card-grid Events-screen layout
  superseded by the current hero/list layout (`nextEventHeroHTML`); never
  called by the live `eventsHTML`.
- `isTableFrozen(event,tableId)` (`app-v8.js`) — its one real caller
  inlines the identical `frozenTableIdSet(event).has(table.id)` check.
- `memoryDistance(c,m)` (`app-v8.js`) — `matchCandidatesByGeometry`
  immediately below it inlines the identical `Math.hypot(...)` formula
  with different variable names.
- `migrateState(parsed)` (`app.js`) — `loadState()` is a hardcoded stub
  (`return{version:8,events:[]}`) that never calls it, a relic from before
  the V8 IndexedDB storage rewrite.
- `numberOf(table)` (`plan-number-integrity.js`) — `analyse()` in the same
  file inlines the identical `p.state==="VERIFIED"&&typeof p.value===
  "number"` check.

**A much larger finding, deliberately NOT acted on this pass.** Of the
`original={...}` object's ~32 captured names (Section 19), 21 are never
referenced again as `original.<name>` anywhere in the file — independently
confirmed by this session's own grep, not just trusted from the
investigation. The chain of reasoning for why this is safe (traced, not
assumed): `app-guests.js` calls bare `render()` once at script-load time,
before app-v8.js has reassigned anything; that call's workspace branch
(`bindCanvas`/`bindGuests`/etc.) only runs when `state.events.length>0`;
and `state` at that point comes from `loadState()`, which — per the
confirmed-dead `migrateState` finding above — is a hardcoded
`{events:[]}` stub for every user, always. So all 21 are confirmed,
deterministically unreachable under the current boot sequence. **Deleting
them was deliberately declined this pass**: it would touch two files
outside app-v8.js, several of the functions are substantial HTML-builders
(`seatingHTML`, `guestsHTML`, `reportsHTML`, `floorPlanHTML`,
`inspectorHTML`), and there is currently zero test coverage of the
boot-sequence assumption (`loadState()` always returning empty) the whole
conclusion rests on — exactly the "no huge blind refactor" case this
programme's rules exist to catch. Section 19's new `override-boundary`
suite makes the 21-vs-12 split an explicit, checked fact instead; actual
deletion is a separate, later, evidence-gated step per that suite's own
comment.

**Validation.** Both mutation tests confirmed to fail exactly as expected
against the reverted code, then pass again once restored. Full clean
regression (no concurrent edits): 54/54 suites, 1779/1779 checks — up from
52/52, 1764/1764 before this segment, reflecting the two new suites
(`override-boundary`, `pax-invariant`). Both offline artifacts rebuilt and
re-verified (27/27). No rendered-screenshot pass was run for the 5 dead-
code removals specifically: each was independently confirmed to have zero
call sites anywhere, so removing it cannot change any rendered output by
construction, not merely by inspection — the full regression suite's
existing Events-screen coverage is the applicable check, not a new
screenshot of behavior that was already unreachable.

### Sections 22-25 — performance, offline, accessibility, error messages

**Section 22 — performance at scale.** The existing harness
(`benchmarks/perf/`, `npm run perf`) was re-run in full on the 4,000-seat
fixture: 400 tables, 4,000 chairs, 3,000 guest records, 4,500 pax. Data
integrity after reload exact (all five counts preserved), console clean,
the one asserting runner (live windowing correctness, 17 checks) green.

The numbers moved against the table recorded in `benchmarks/perf/README.md`
— several up, several down, heap 20-27MB → 72MB. That comparison is **not**
a regression measurement and the README now says so explicitly: the
recorded column predates Command Center, Plan Doctor, freeze zones, table
availability, arrival wave, service load, risk radar and the audit trail,
all of which render and persist real work, and the two columns were taken
on different machines under different load. Quoting it as before/after
would be exactly the kind of claim this programme forbids.

What *is* a real before/after is the one thing this programme changed that
the existing harness structurally cannot see. Section 13 made `saveState()`
serialise its writes through a promise queue. `stress-4000-seats.mjs` times
`saveState()` as `p.evaluate(() => { saveState(); })` — the synchronous part
only, returning before a byte reaches IndexedDB — so it is blind to the
queue by construction. The two things a queue actually risks (drain latency,
and retained memory from N payload strings alive at once) went unmeasured.

New runner `benchmarks/perf/save-queue-burst.mjs` measures both, by firing
40 back-to-back `saveState()` calls on the 4,000-seat event (1.20 MB payload
per save) and polling the **raw IndexedDB record** until the last value
lands — then rebuilding the pre-Section-13 unqueued `saveState()` in the
page and running the identical burst through it.

| | sync | drain | peak heap | last write wins |
| --- | ---: | ---: | ---: | :---: |
| queued (today) | 210 / 189 ms | 795 / 564 ms | 123 / 97 MB | yes |
| unqueued (before) | 150 / 151 ms | 380 / 399 ms | 81 MB | yes |

**The queue costs; it does not save.** Drain roughly doubles — writes that
overlapped now run strictly in sequence — and peak heap rises ~16-42 MB,
which is the predicted retention (up to 40 × 1.20 MB payload strings alive
simultaneously, each held in its own closure until its turn). Judged
acceptable and stated as a trade, not a win: 40 saves back-to-back is well
past what an operator generates, the drain happens off the main thread, and
123 MB sits against a 4,096 MB limit. The runner asserts only the property
the queue exists for — last-write-wins — and reports the timings.

Two honesty notes are recorded in the README rather than buried. First, the
unqueued variant **also** reports last-write-wins here; that does not
retire the race, it means an intermittent race did not fire in this run —
`tests/suites/storage-provider.test.mjs` is what proves it deterministically,
by delaying the first `indexedDB.open`. Second, and more important: **the
first version of this runner reported the exact opposite** (queue faster on
every axis). That was an artifact twice over — the second burst started on
the first burst's uncollected garbage, and running second also meant a
warmed JIT and an already-extended IndexedDB file. Forcing
`HeapProfiler.collectGarbage` between bursts and running the pair again in
the reversed order flipped the drain and heap findings and made both passes
agree. The runner now prints whether the two passes agree on direction and
refuses to name a winner when they do not. The wrong first reading is
written down because the repo's own README already carries the same lesson
from the misattributed 1.2s of layout, and a measurement that quietly
replaces an earlier one teaches nothing.

The unqueued side omits `refreshChairOccupancy()` (IIFE-scoped, unreachable
from the harness), so its sync figure is an under-estimate — a bias in
favour of the *old* code, which is the safe direction.

**Section 23 — offline guarantee.** Both artifacts rebuilt
(`build-offline.mjs`, `build-offline-full.mjs`) and the real built package
re-verified (`verify-offline-package.mjs`, 27/27) as part of this segment,
as after every commit in this programme. The verifier serves the artifact,
aborts every non-same-origin request and drives real OCR, so this is the
built package running, not a build that reported success. The dedicated
final pass remains section 36.

**Section 24 — accessibility/keyboard.** Audited rather than assumed. A
global `:focus-visible` ring already exists (`src/styles.css:70`); the app's
three native `<dialog>` elements get focus containment and Escape-close from
the platform for free; `trapFocus`/`focus-trap` appear nowhere in `src/`,
which is correct for those three and was the gap for the fourth.

The one real defect: `.freeze-challenge-scrim` — the app's only custom
scrim — carries `<aside class="freeze-challenge" role="alertdialog">` with
initial focus management and Escape-to-close, but **no Tab containment**.
An element with `role="alertdialog"` that lets Tab walk out into the page
behind it is making a promise the markup does not keep, and the supervisor-
override challenge is exactly the moment where wandering focus matters.
Trap added to the existing global keydown handler (forward wrap, backward
wrap, and re-entry when focus is already outside the scrim). Six new checks
in `tests/suites/seating-freeze.test.mjs` (89 → 96); reverting the trap
produced `✗ Tab from the challenge's last control wraps back to its first
:: {"insideScrim":false,"isFirst":false}`.

**Section 25 — error messages.** All 104 `toast()` call sites read (80 in
`app-v8.js`, 12 each in `app-guests.js` and `app.js`; 31 error-level). The
large majority already do the right thing — they name the object, state the
reason, and imply the next step (`"T07 has 6 assigned pax. Capacity cannot
drop below occupancy."`). Two did not, and both were the same shape:

- Create Event's plan import (`app-v8.js:1186`) and Floor Plan's replace-plan
  handler (`app-v8.js:8444`) each toasted a **bare `error.message`** — a raw
  pdf.js or FileReader string such as `"Invalid PDF structure."`. It names no
  action, offers no next step, and passes straight through the toast
  translation boundary untouched, so a Turkish-default operator gets an
  English library internal at the moment something broke.

Both now build their message from a new bilingual key
(`setup.planReadFailed`, `plan.replaceFailed`) that names the failed action,
gives the next step, and **keeps the library's `{reason}`** — the fix was to
add an instruction, not to discard the one text that says why. The replace
path additionally states that the current plan is unchanged, which was
verified in the code rather than assumed: every mutation in that handler
(`recordUndo`, `event.background = …`) happens *after* the awaits that throw.

The second finding is the structural one. `t()` falls back to returning the
key itself when a string is missing — correct behaviour, and what the
existing `i18n` suite hunts for by walking the rendered DOM of five screens
in both languages. But **error messages are by definition the strings
nothing renders**: `backup.badReference` appears only when a restore file has
broken references, `teachArea.refused` only when a lesson is refused,
`recovery.none` only when recovery finds no snapshot. No suite drives those
paths, so deleting or mistyping one of those keys today ships a raw dotted
identifier to an operator at the worst possible moment — invisibly.

New suite `tests/suites/i18n-key-integrity.test.mjs` (13 checks, static,
pure Node) extracts every complete literal `t("key")` in `src/` and every
entry in the string table, and asserts every used key exists **with both an
`en` and a `tr` string**. The second half matters independently: `t()`
resolves `entry[currentLang()] || entry.en`, so an English-only key resolves
silently with no raw identifier for the DOM-walking suite to catch, on a
product whose default language is Turkish.

**No live bug was found** — all 682 complete literal keys resolve in both
languages today. This is a guard for an uncovered risk, in the same spirit
as `pax-invariant` (Section 20), and it is stated as such rather than dressed
up as a fix. Keys assembled by concatenation (`t("status.planning." + x)`)
are deliberately excluded: their full key is not knowable statically, and
enumerating the enum values would assert this suite's idea of the domain
rather than the product's. `src/app.js`'s demo-seed builder uses a *local*
helper also named `t` — those 16 matches are excluded by shape (no dot), not
by filename, so a genuine one-word key would still be caught.

**Validation.** Four mutations proven against the new i18n suite — delete an
error-path key (fails check 1), strip one key's Turkish (check 2), revert
the replace-plan fix to a bare exception (checks 4 + the sweep), drop
`{reason}` from a message (the substitution check) — each failing exactly
its intended check and nothing else, then restored and reconfirmed. Six
mutation-proven checks for the focus trap. Full clean regression with no
concurrent edits: **55/55 suites, 1799/1799 checks**, up from 54/54 and
1779/1779, reflecting the new `i18n-key-integrity` suite and the 6 added
freeze checks plus the rest. Both offline artifacts rebuilt and re-verified,
27/27.

No rendered-screenshot pass was run for this segment. The UI rules require
one for a UI change, and neither change is one: the focus trap alters
keyboard behaviour with no visual output (and is verified by asserting where
focus actually lands in a real browser, which is stronger than a screenshot
for this property), and the two error messages change toast *text* on
failure paths a screenshot pass does not reach. The Section 35 visual sweep
remains the applicable visual gate.

### Sections 26-28 — the externally-blocked three

All three of these sections are blocked on something this session cannot
produce: a real event operator who has never seen the screen, and a third real
venue drawing. What is *not* blocked is the thing that has to exist before
either would be worth doing, and that is what landed.

The distinction is kept sharp in every status line: the kit, the contract and
the procedure are DONE; the session is NOT VERIFIED and the third plan is NOT
AVAILABLE. Neither document may be read as evidence about the thing it prepares
for, and each says so in its own status block rather than relying on this file
to qualify it.

**Section 26 — `benchmarks/operator/REAL-OPERATOR-TEST-KIT.md`.** The existing
`README.md` in that directory is a genuinely good document, but it is a
*rationale*: why the test exists, what is instrumented, the two failure modes it
hunts, the 14 questions. A facilitator could not run a session from it without
assembling half a dozen things themselves. The kit is what is carried into the
room: build the folder artifact (not `npm run serve` — the folder build is the
one with real offline OCR, and OCR is load-bearing on the symbolic plan, so
Session B against a light build tests a product the operator will never be
given), verify 27/27, take the machine offline, start from a blank profile, have
both plan files ready; the script to read verbatim; a table of what to say when
they ask what a button does; the observer sheet with the three things the
recording *cannot* capture (what they looked at and did not click, their own
words for product concepts, hesitation before "apply to all"); and the
end-of-session order — open the report **before** discussing it, because it
lives in `state.operatorSessions` and a cleared profile takes it away.

The 14 questions are deliberately **not** duplicated into the kit. They are in
`README.md` and on the report page itself; a third copy is a third thing to keep
correct.

One real correction came out of writing it. The README's "Known before the
session starts" section recorded that Worth deciding rows were readable but not
actionable, and instructed the facilitator to treat an operator hunting for the
object as a known gap rather than a discovery. That gap is **closed** — verified
in the source, not assumed: `budgetClaimHTML()` now emits
`data-budget-open` → `openReviewQueue(ev, …)` for every row with targets, and
for a claim about the whole drawing with no target it says so
(`budget.wholeDrawing`) instead of offering a dead control. A stale known-gap
list is worse than none, because it tells the facilitator *in advance* to ignore
the exact behaviour the session exists to observe. Corrected, with a standing
instruction to re-check that section before every session.

**Section 27 — `benchmarks/operator/HUMAN-TEST-CONTRACT.md`.** Written before
any session, on purpose: a test whose consequences are decided after seeing its
outcome is not a test, and the rules can only be set honestly while nobody knows
what the result will be.

It fixes seven finding classes with a per-class obligation, so that a count of
findings can never be reported without the classes and BLOCKER can never quietly
become FRICTION because it was fixed quickly. It states that speed is not a
finding on its own — there is no baseline for a good review time and this
project refuses to invent one, so a timing becomes a finding only when attached
to an observation. It contains the clause the whole file exists for: when an
operator's behaviour contradicts a measured internal result, **the operator
wins** — if they work entirely off-queue, `benchmarks/review-order/`'s measured
40% improvement is an improvement to an artefact nobody reads, and must not be
quoted afterwards as though the session had not happened. And it fixes the
permitted status strings, with `USABILITY: MEASURED ONCE` named explicitly as a
status rather than a stepping stone to VERIFIED — the threshold for VERIFIED is
deliberately left undefined, because defining it before seeing what one session
looks like would be inventing rigour rather than having it.

**Section 28 — `benchmarks/heldout/THIRD-PLAN-PROCEDURE.md`.** Nine ordered
steps, and the reason to trust them is that none is invented: every one is what
was actually done for ORNEK. Take the file in by hash and write the provenance
while the only thing known about the drawing is its hash; measure what the file
*is* before looking at what it draws (for ORNEK that step alone killed a planned
vector parser — `/Font 0`, `/FontFile 0`, one `/DCTDecode` image); classify the
representation, because PHYSICAL vs SYMBOLIC changes what capacity *means* and
whether an unknown seat count is `0` or `null`; annotate ground truth by a
person looking at the drawing and **freeze it in a commit** before any detector
output is seen; run once untouched; diagnose before theorising.

Step 5 was corrected after checking what the repo actually did rather than what
its tooling offers. `run-heldout.mjs` and its `history.json` are the leakage
guard, but ORNEK's first run was recorded through a separate permanent record —
`ORNEK-FIRST-RUN.md` plus `ornek-first-run.json`, naming the commit under test
and the reproduce command. Both belong in the procedure, and the record is the
more important half: ORNEK's first run scored `TABLES … TP=0 FP=10 FN=166 P=0
R=0 F1=0`, that number is still in the repository unedited, and it is what makes
every later improvement measurable against a starting point nobody was tempted
to soften.

The procedure ends by naming the failure mode it exists to prevent, which is not
a bad score but a **good one arrived at by having looked first** — open the
plan, notice a missed cluster, adjust a threshold, then annotate, then run, then
report a strong held-out result. Every step there feels reasonable in isolation
and the number is worthless, and once the session is over it is
indistinguishable from a real one. The freeze commits in steps 1 and 4 are what
make the ordering checkable by somebody who was not there.

**Validation.** These three are documentation, and this report does not call
documentation implementation — the status lines above say DONE for the
documents and NOT VERIFIED / NOT AVAILABLE for the things they prepare for. The
one code-adjacent claim made (that the Worth deciding gap is closed) was
verified by reading the emitting function and its handler, not assumed from the
CLAUDE.md summary. No suite changes and no regression re-run were needed for
this segment: nothing under `src/` was touched.

### Sections 31/32 — the desktop path, prepared and not taken

Both are design and documentation **by rule, not by choice of effort**.
`.claude/rules/data.md` forbids introducing SQLite or any new storage engine
speculatively while the product is in browser-review stage, and
`.claude/rules/desktop.md` forbids packaging until the user types **"EXE YAP"**
— which they have not. So: no dependency added, no schema created, no adapter
written, and **no packaging technology chosen** — that last one matters, because
the rule names "packaging-technology choice" explicitly, and a choice made in a
design document is a choice made.

**Section 31 — `benchmarks/SQLITE-MIGRATION-DESIGN.md`.** The section's title
contains a premise worth checking before designing anything, and checking it was
the most useful thing in this segment: **"export format v1" does not need
designing, because it already exists twice.**

| format | scope | version | guarded by |
|---|---|---|---|
| `merit-event-maker-backup` | whole install | `formatVersion: 1` | `backup-restore` |
| `merit-event-maker-event-package` | one event | `formatVersion: 1` | `event-package` |

Both plain JSON, both carrying a `format` discriminator *and* a `formatVersion`,
both validating on import rather than trusting the file, and the package format
already solves the hardest interchange problem — id collision — by renumbering
every id the incoming event owns and rewriting every reference to it, including
a freeze that names a table by id. Inventing a third would have been pure cost.
The design adds exactly one field, and deliberately does not implement it now
because nothing consumes it: a `schemaVersion` beside `formatVersion`, needed the
first time a migration is non-additive, with the rule that an importer refuses a
version it does not know rather than guessing.

The schema itself is the uninteresting part. Two things in it are not:

- **`pax` becomes a generated column.** Section 20 found `guest.pax` is a
  redundant cached field (`1 + additionalGuests`), correct at all five write
  sites but with no single setter enforcing it, and added `pax-invariant` to
  guard a risk it could not remove. A relational store removes it —
  `GENERATED ALWAYS AS (1 + additional_guests)` makes drift impossible rather
  than merely detected. This is the one genuine improvement the engine buys the
  domain model, as opposed to a re-expression of what already works.
- **One rule a schema cannot enforce, stated as such.** "No Show releases live
  capacity but never clears the planned seat" is a rule about *which fields an
  operation may touch*, not about which states are valid: a No Show row with a
  live assignment is perfectly valid, and so is one without. No CHECK constraint
  expresses it, and `setArrival()` stays the single writer. Writing that down
  matters more than the schema does, because the temptation on moving to a
  relational store is to believe the constraints now hold the domain and to
  relax the code that actually holds it.

Two smaller decisions carry their reasoning rather than being left implicit.
**No `ON DELETE CASCADE` from `tables` to `assignments`**: deleting a table with
guests on it is precisely the operation the product must refuse, and a cascade
would silently unseat them, so the absent cascade turns it into a foreign-key
error the application must handle. And **historical immutability is not a
trigger**: `migrateEvent()` legitimately rewrites historical events on every
load to backfill fields honestly (`capacitySource: UNKNOWN`, normalised
freezes), a trigger cannot tell a migration from an edit, so enforcement stays
at `canMutate()`.

The migration path needs no new boundary, because one exists: `StorageProvider`
already has two implementations selected at boot, and a SQLite adapter is a
third. Two ordered steps, and the order is the whole point — ship the adapter
behind the *existing* interface writing real rows, proven by **every existing
suite passing unchanged** rather than by a new suite written to match the new
behaviour; and only then, only where a measurement justifies it, narrow the
whole-root reads. Step 2 is optional forever. The design also records what it
does **not** decide: which binding (that depends on the packaging decision,
which is gated), and whether SQLite is needed at all — the 4,000-seat fixture is
a 1.20 MB payload reloading in ~780 ms, and nothing measured says the current
engine is the constraint.

**Section 32 — `benchmarks/DESKTOP-READINESS.md`.** An inventory, so "how far
away is the desktop build?" has a written answer rather than one estimated on
the spot. What is genuinely ready turned out to be more than expected, and every
item is shipping and covered: the storage boundary; offline operation verified
by **running** the built artifact (27/27) rather than by building it; no network
dependency, proven by the operator-session suite asserting `fetch`,
`XMLHttpRequest`, `sendBeacon`, `WebSocket` and `EventSource` are *absent from
the source* rather than merely unused; two versioned interchange formats; an
idempotent migration proven against a genuinely old fixture; 55 suites and 1,799
checks that are about domain behaviour rather than about being in a browser tab,
and so survive the move; and recovery from a store whose primary record *and*
snapshot slot are both corrupted.

The document refuses to let its own existence read as progress — the
architecture skill's specific warning is that reading a desktop skill is not
authorization, and the readiness doc says the same about itself. It carries the
inherited gaps forward rather than presenting a clean bill of health (operator
usability NOT VERIFIED, cross-venue generalization MEASURED TWICE, no third
plan, no ORNEK robustness suite, the 21 evidenced-but-undeleted unreachable
functions), and names the one that packaging makes *worse*: it is harder to
watch somebody use software shipped as an installer than software you can put in
front of them in a browser, so **the operator session is best run before
packaging, not after.**

**Validation.** Documentation, and not called implementation: the status lines
say DONE for the documents while SQLite stays unbuilt and the EXE gate stays
shut. Every factual claim was checked against the source rather than recalled —
the two format strings and their `formatVersion`s, `blankRoot()`'s actual
collection list, `migrateEvent()`'s additive backfills, and the two
`StorageProvider` implementations. Nothing under `src/` was touched, so no
regression re-run was required.

### Sections 33/34 — what guards what, and whether CI actually runs it

Section 33's earlier status ("1 of 24 landed; the other 23 depend on the
feature/hardening sections above landing first") was written before those
sections landed. They have, and the honest closing move is a coverage audit
rather than a burst of new suites written to reach a number — a suite added to
make a count look complete guards nothing.

**Counted against the frozen baseline `3ef11bb`, not estimated:**

| | |
|---|---:|
| new suites this programme | **9** |
| existing suites extended | **18** |
| suite files on disk | **61** |
| suites declared and reachable by the runner | **61** |
| orphaned (a file the runner would never run) | **0** |

The nine: `no-sample-specific-runtime-logic` (§1A),
`physical-logical-seat-separation` (§2), `capacity-provenance` (§3),
`onboarding` (§10/11/12/30), `transaction-atomicity` (§14),
`schema-migration` (§15), `override-boundary` (§19), `pax-invariant` (§20),
`i18n-key-integrity` (§25). Every section that changed behaviour shipped with
the guard that would catch its revert, and each guard was mutation-proven
individually at the time rather than assumed.

The orphan count matters more than it looks. A suite file that exists but is
not in the runner's declared list runs nowhere and fails nothing, while still
reading as coverage to anybody scanning the directory. It was checked by
diffing the filenames on disk against the runner's own list — 61 = 61, empty
difference — not by counting files and trusting they are wired up.

**Section 34 — CI, verified against the workflow and against a real run log.**

Every suite reaches CI, and the two halves are in different jobs on purpose:
`npm test` runs the 55 fast suites in *Fast core*, `npm run test:slow` runs the
6 slow ones in *Intelligence* — union 61, nothing unreached. That split is
itself a repaired hole the workflow documents: the slow contract suites were
once excluded by `npm test` and run by no other job, so two checks failed
continuously and invisibly.

`npm run perf` runs in the *Performance* job, so this programme's new asserting
runner is genuinely gated. That was **confirmed by reading the run log**, not
inferred from the workflow file — and reading it was worth it, because the
Performance job completed in eighteen seconds, which looked impossible for four
runners. It was not impossible (the CI runner is simply faster on this work),
and the log shows the burst runner executing, reporting, and agreeing with the
local measurement on direction: queued drain 374/354 ms against unqueued
256/252 ms, on a different machine.

Three npm scripts are not in CI and are correctly absent, which is worth
stating so their absence is not later mistaken for a gap:
`benchmark:retrieval` and `benchmark:separation` assert nothing — there is no
regression gate in either to fail — and `benchmark:heldout` would *refuse*,
because there is no held-out plan to run it on.

**The one real defect, found by reading the log rather than trusting the green
tick.** In CI, every row of the burst runner printed `heap 13.6→13.6→13.6 MB`.
`performance.memory` is coarsened inside a container, so the column was
rendering non-data as data — and rendering it in the shape of a finding: three
identical numbers read as *"the burst allocated nothing"*, which is the exact
opposite of what the runner exists to show. A green job was reporting a false
reassurance.

It now reports `heap UNAVAILABLE (performance.memory coarsened — same value
throughout)`, and the fix was proven in both directions rather than one: the
runner still prints real figures locally (13.3→126.5→146.3 MB), and under a
simulated coarsened `performance.memory` it prints UNAVAILABLE on every row.
The simulation was reverted and the file reconfirmed clean.

This is the same class of error as the one the perf README already records
about misattributed layout time, and as Section 22's own wrong first reading —
which is three in this programme. The pattern is consistent enough to name: the
measurement ran, the job passed, and the number meant nothing. "It ran" is not
evidence, in exactly the way "the build succeeded" is not.

### Sections 35-38 — the closing pass

**Section 35 — the rendered sweep.** Every primary screen was rendered and
screenshotted at 1920×1080, 2560×1440 and ~1440px, and the screenshots were
**looked at**, not merely produced: Home in its genuine empty state *and*
populated, Create Event, Floor Plan blank / with tables / with a table
selected, Guests with the add-edit dialog open, Seating, Live, Reports.
Console clean at all three viewports, at every step.

The constitution holds. One warm/light palette throughout with no second dark
system anywhere; warm-paper Floor Plan canvas; the intended `--pi-*` pattern on
Floor Plan (floating minimal toolbar, contextual card on selection, bottom
status pill — no permanent left list, no permanent right inspector); restrained
VIP/VVIP gold used only where it means something; no gradient, glassmorphism or
card-wall aesthetic; no horizontal overflow at 1440; the modal correctly sized
and centred at 2560 with a visible focus ring.

Several domain rules were visible as *rendered truth* rather than as code,
which is the point of looking: Live states that a No Show preserves the planned
seat while releasing operational capacity; the arrival wave says plainly that
nobody has a stated arrival time so there is nothing to compare, and that
**nothing is predicted**; a "+3" guest renders as one record of four with three
companions; Reports names its three sheets with counts and admits that workbook
headings stay English by design; every pre-flight finding carries a control
that says where to go.

**One real defect, and it was only findable by looking.** The toast stack
(`.toast-wrap`, `position: fixed`, `bottom: 16px`, `z-index: 2000`) rendered
directly on top of the Floor Plan's `.planmap-fab` "Add Manually" button
(`position: absolute`, `bottom: 20px`, height 44px, `z-index: 40`). Measured
rather than eyeballed: FAB at top 836 / bottom 880, toast at top 845 / bottom
884 — fully overlapping. The toast an operator sees the moment they create a
blank event reads *"Boş etkinlik oluşturuldu. Hazır olduğunuzda plan
nesnelerini ekleyin"* — "add the plan objects when you are ready" — while
sitting on top of the one button that adds them.

Neither rule is wrong on its own, which is exactly why no source-reading check
would have caught it, and why the first instinct on seeing the screenshot — that
the button was *clipped* by the viewport — was also wrong. A DOM probe settled
it: nothing overflowed the viewport at all (`overflowPx: -20`); the button was
fully laid out and simply covered. Diagnosing before theorising, again.

Fixed with one scoped rule — `body:has(.planmap-fab) .toast-wrap{bottom:76px}`,
clearing 20 + 44 + 12 — so the offset applies only on a screen that actually
has a FAB, and degrades to previous behaviour where `:has()` is unsupported.
Re-measured after: toast bottom 824, FAB top 836, no overlap. Re-rendered and
looked at again: both controls fully visible and readable.

Guarded by a new check in `tests/suites/floor-plan-modes.test.mjs` (45→46),
placed immediately after `createBlankEvent()` because that is the exact moment
the real product shows that toast on that screen. It measures **rendered
geometry in a real browser**, not CSS text, because what was wrong was the
rendered result of two individually-correct rules. Mutation-proven: removing
the fix produces `✗ a toast never covers the Floor Plan's Add Manually
button … {"overlap":true}` with the real boxes attached.

One process note, recorded rather than glossed: `.claude/rules/ui.md` asks for
this sweep via the `visual-qa-reviewer` agent. That agent was dispatched and
**died on a session rate limit** before producing anything. Rather than record
Section 35 as blocked, the sweep was run directly with the same tools the agent
would have used — the repo's own Playwright harness and the pre-installed
Chromium. The rule's actual requirement is *rendered screenshots at three
viewports, looked at*, and that requirement was met; the agent is the usual
vehicle, not the requirement itself.

**Section 36 — final full validation.** On the finished tree, after the
Section 35 fix:

| gate | result |
|---|---|
| `npm run test:all` (every suite, slow included) | **61/61 suites, 2011/2011 checks** |
| both offline artifacts rebuilt, real package run | **27/27** |
| detector vs committed `BASELINE.json` | **No regressions. 0 improvement(s), 0 note(s)** |

The baseline comparison is the one worth reading twice: it compares **every
guarded field separately, per plan**, precisely so a trade — chair recall up,
table F1 down — cannot hide inside a single score. Nothing moved in either
direction on either plan, which is the correct outcome for a programme that
changed no detector code.

**Sections 37/38 — documentation and the matrix.** `FINAL-COMPLETION-MATRIX.md`
is the closing statement and uses only the six permitted words in its Status
column. Its structural decision: sections 26, 28 and 31 each get **two rows**,
so that a written document's completion can never stand in for the event it
prepares for — the kit is DONE while the session is NOT VERIFIED, the procedure
is DONE while the third plan is NOT AVAILABLE, the design is DONE while SQLite
is DEFERRED. The desktop build has its own row: **BLOCKED**.

The matrix also carries a section a completion document usually will not: the
four things that are *not* finished, stated before the summary of what is, and
a short record of the three times in this programme a measurement ran, passed,
and meant nothing.

## Continuation checkpoint (machine-readable)

```
SECTION 2 STATUS: DONE. Pushed as commit b64fb88 (parent ba48b05). CI
  CONFIRMED GREEN on the branch head, commit dcde06c — all 10 checks
  (both push- and pull_request-triggered "Fast core", "Offline",
  "Detection", "Intelligence", "Performance" jobs) succeeded.
  tests/suites/physical-logical-seat-separation.test.mjs (19 checks,
  mutation-proven) added; tests/README.md row added.
SECTION 3 STATUS: DONE (by design, 3 of 8 capacity sources wired). Pushed
  as commit 9f09e2d. CI CONFIRMED GREEN on the branch head, commit
  dcde06c — same 10/10 as above. New src/capacity-provenance.js,
  table.capacitySource wired at all 4 real write sites (createTable,
  app.js's createTableFromDraft, setTableCapacity, commitCandidates),
  migrateEvent backfill via MeritCapacityProvenance.normalize(), 8
  Turkish/English i18n keys, tests/suites/capacity-provenance.test.mjs (19
  checks, 2 mutations proven to bite). 3 of 8 sources WIRED
  (DETECTED_PHYSICAL_SEATS/HUMAN_CONFIRMED/UNKNOWN); the other 5
  (PRINTED_TABLE_CAPACITY/PRINTED_ZONE_CAPACITY/PRINTED_TOTAL_CAPACITY/
  DERIVED_PRINTED_RULE/VERIFIED_VENUE_MEMORY) are named+translated but
  UNWIRED since no current feature produces them — wiring them would mean
  inventing new detection/business behaviour, not a data-model change;
  this is the section's designed end state. See full write-up above.
ALSO FIXED THIS SESSION (unrelated, found along the way), pushed as commit
  e9742f1: a real wall-clock flake in tests/suites/post-event-replay.test.mjs
  — its "Event created" audit entry used the real current time instead of
  a controlled one, so the suite failed whenever run between 19:00-19:30.
  CONFIRMED (via get_job_logs on the actual CI run) to be the sole cause
  of PR #5's CI failure on commit b64fb886 — not a regression from section
  2's actual diff. Fixed by pinning that entry's timestamp to a fixed
  08:00 in the test fixture. Both locally (31/31) and now on real CI
  (10/10 on dcde06c), the fix holds.
SECTIONS 4/5 STATUS: DONE (audit, no gap found). See detailed write-up
  above. Section 4: `plan-memory.js`'s `identity()` already implements
  verified-number veto (both directions) > geometry > uncertainty-scaled
  visual > family-as-evidence-never-gate, already tested in
  `plan-memory.test.mjs`; `venue-model.js`'s layout-change comparison uses
  a stricter deterministic version for its own different task, tested in
  `layout-changes.test.mjs`. NOTE: corrects an earlier (pre-this-session)
  claim in this report that visual similarity "ships off by default" —
  it does not; it is always wired in (mandatory per the module's own
  history) and its WEIGHT is what stays governed by geometric certainty.
  Section 5: `plan-confidence-budget.js`'s `DEFAULT_MAX_ITEMS=6` is
  measured against both real plans and overridable for a third; the
  review queue's resolution state is read live from candidates every
  render (never a driftable tally); `review-queue.test.mjs` (38 checks)
  and `operator-questions.test.mjs` (15 checks) already cover the
  lifecycle and the no-duplicate-question-wording guarantee. No source or
  test code changed for either section — the audit found no gap to fix.
SECTION 6 STATUS: DONE, CI CONFIRMED GREEN. Pushed as commit 5600bce,
  checkpoint commits 2a67e17 and 76859e4. CI on the branch head (76859e4)
  is 10/10 green (both push- and pull_request-triggered "Fast core",
  "Offline", "Detection", "Intelligence", "Performance" jobs). Real bug
  found and fixed: ui.lang was never
  initialized in app.js (so i18n.js's lang() helper treated a fresh boot
  as English), and app-v8.js's own Object.assign(ui,{...}) independently
  hardcoded lang:"en", silently overriding a first attempted fix to
  app.js alone — found by testing that first fix before declaring it
  done. Both sites now say "tr". ui.guideLang had the same bug, fixed
  the same way. Verified with a real rendered screenshot (sent to the
  user) and a new i18n.test.mjs boot-default check (mutation-tested).
  Fixing this correctly turned 12 suites (382 checks) red — each
  depended on the old implicit English default — and each was fixed on
  its own terms, never by weakening a check. Zero checks removed; full
  regression green (55/55, 1894/1894 via test:all); both offline
  artifacts rebuilt and verified (27/27).
SECTION 7 STATUS: PARTIAL — spot-checked 4 representative domain facts
  (guest.arrivalStatus, table.availability, freeze create/lift,
  guest.planningStatus) via grep for every direct write site in
  app-v8.js. Zero violations found: each guarded fact has exactly one
  write site (its designated function), and planningStatus's one
  non-migration write is legitimate free-form operator editing, not a
  derived fact needing a dedicated writer. NOT exhaustive — a real
  "complete, enforced architecture rule" needs AST-based tooling (an
  ESLint rule forbidding direct assignment to a named list of guarded
  fields outside their writer), not a grep spot-check. See the status
  table's section-7 row for the exact fields checked.
SECTIONS 8/9 STATUS: PARTIAL, not the original scope, but CI CONFIRMED
  GREEN. Pushed as commit 6adca31 (parent d42d84f). Both the push- and
  pull_request-triggered CI runs on the branch head (6adca31, runs
  34925774240 and 34925777211) are fully green, all 10 checks each
  ("Fast core", "Offline", "Detection", "Intelligence", "Performance" ×
  2 triggers). The original numeric interaction-count/warning-
  deduplication targets were lost to context compaction and are
  unrecoverable; fabricating compliance against them would violate
  section 42's own rules. Instead, ran a genuine visual-qa-reviewer-
  driven UX audit of Floor Plan/Seating/Live and fixed 6 of 8 real
  findings surfaced (multi-select scope disclosure on the contextual
  card, forced-choice unavailable-reason, freeze pre-commit scope/count
  preview with a whole-room warning — including a real reactivity bug
  the mandatory post-fix screenshot pass caught and a real gap in that
  fix's own first test, both closed — consistent unavailable-block toast
  on the primary CTA, three sub-floor typography spots bumped to the
  ~11px range, Smart Seating's "why nothing fits" message naming
  frozen/unavailable tables). 2 deferred (native confirm() dialogs —
  multi-site refactor; unbounded toast stacking — cosmetic). A second,
  independent visual-qa-reviewer pass re-verified all three
  post-screenshot-QA follow-ups (the reactivity fix, a contrast fix on
  the new banner, and a styling fix on the reason select) live in a
  rendered browser with no remaining issues. See detailed write-up above
  for exact file/line-level changes, i18n keys, and per-fix
  mutation-testing evidence.
SECTIONS 10/11/12/30 STATUS: 10 OBSOLETE (evidence-based, by explicit user
  decision), 11 DONE, 12 DONE, 30 DONE (verified as a byproduct of 10's
  investigation). Pushed as commit d322237 (parent a358749). CI CONFIRMED
  GREEN on the branch head, commit d322237 — both the push-triggered
  (run 34930824597) and pull_request-triggered (run 34930831053) workflow
  runs are fully green, all 10 checks each ("Fast core", "Offline",
  "Detection", "Intelligence", "Performance" × 2 triggers), verified job-
  by-job via the GitHub Actions API, not just the run-level conclusion.
  Two user decisions this segment: (1) investigate-and-
  propose-scope-first for sections 10-12 (net-new features with lost
  specs, unlike 8/9's audit-of-existing-code approach) via `merit-product-
  director`; (2) build 11+12 only, skip 10, mark 10 OBSOLETE with the
  evidence rather than NOT STARTED. Section 11 (Data Provenance Inspector):
  one read-only line on the contextual card reusing Section 3's
  `MeritCapacityProvenance` module and existing i18n keys — zero new state.
  Two real bugs found by the mandatory rendered screenshot pass (missing
  `bulk.type.sofa/bench/banquette` i18n keys causing a raw-key leak; a
  non-wrapping flex layout overflowing in Turkish) — both fixed, both
  mutation-proven, both covered by new regression checks in `capacity-
  provenance.test.mjs` (now 33 checks). Section 12 (onboarding): 5 anchor
  points, `state.onboarding` persisted like `state.audit` (never on
  `event`), one delegated click listener, Guide-modal reset control — new
  `tests/suites/onboarding.test.mjs` (22 checks), mutation-proven across 3
  distinct mutations. A real override-pattern trap was caught before
  shipping (the first attempt edited `app-guests.js`'s `renderGuide()`,
  which `app-v8.js` shadows with its own reassignment loaded last — fixed
  by moving the edit to the actual active override). Full clean regression
  after all fixes: 50/50 suites, 1737/1737 checks. Both offline artifacts
  rebuilt and re-verified (27/27). See full write-up above.
SECTIONS 13-18 STATUS: 13 DONE, 14 DONE (narrowly scoped), 15 PARTIAL
  (deliberately, by evidence), 16 DONE, 17 DONE (audit only, no code gap),
  18 DONE (verification only). Pushed as commit a19c2fe (parent 977628c).
  CI CONFIRMED GREEN on the branch head, commit a19c2fe — both the
  push-triggered (run 34949715080) and pull_request-triggered (run
  34949719153) workflow runs are fully green, all 10 checks each ("Fast
  core", "Offline", "Detection", "Intelligence", "Performance" × 2
  triggers), verified job-by-job via the GitHub Actions API. Investigated
  via `data-architecture-engineer` first (matching the sections 10-12
  investigate-first pattern), then built. Section 13: `saveState()` now serialises onto a `saveQueue`
  promise chain, closing a real IndexedDB write-ordering hazard
  (`storageProvider.save()` opens its own connection per call, so
  overlapping saves could land out of order) — proven with a deterministic
  simulated-latency stress test in `storage-provider.test.mjs`, since real
  IndexedDB is too fast for the hazard to reproduce from incidental timing.
  Section 14: re-persists inside `assignGuestGroup()`'s existing rollback
  catch, closing a real gap (it persisted the new assignment via
  `touchEvent()` BEFORE `render()`, so `render()` throwing left storage
  correct but memory reverted with nothing to re-sync them) — new suite
  `transaction-atomicity.test.mjs`. Deliberately did NOT extend rollback
  wrapping to `setArrival`/`setTableAvailability`/freeze create-lift/
  `commitCandidates` (no existing try/catch, no history of throwing,
  extending it would be exactly the "error handling for scenarios that
  can't happen" CLAUDE.md forbids). Section 15: declined to build the
  investigation's own proposed version-preservation scaffolding (untestable,
  zero behavioral payoff today, no known non-additive migration to route)
  — instead added `schema-migration.test.mjs`, a genuine end-to-end proof
  that the existing migration chain upgrades data shaped like a truly old
  install. Section 16: removed `touchEvent()`'s `EVENT_UPDATED` write
  entirely (pure noise, never read, competing with real decisions for the
  same capped array) — new check in `audit-trail.test.mjs`. Section 17:
  audited, no production code gap found; added the one missing
  "recovery-of-recovery" test (both primary record AND the automatic
  snapshot slot corrupted) to `offline-recovery.test.mjs`. Section 18:
  verification only — confirmed sections 2/3 already flow safely through
  the Portable Event Package, and added the one regression case Section 16
  unblocked (an event's decisions surviving export despite 1000 unrelated
  edits elsewhere) to `event-package.test.mjs`. Every fix mutation-proven
  individually. Full clean regression: 52/52 suites, 1764/1764 checks
  (up from 50/50, 1737/1737). Both offline artifacts rebuilt and
  re-verified (27/27). See full write-up above.
SECTIONS 19-21 STATUS: 19 DONE (audit, architecture already sound — the
  small-module dependency graph has zero exceptions; the real gap was the
  undocumented app.js/app-guests.js override boundary, closed with a new
  static-analysis test), 20 DONE (one real narrow SSOT risk found —
  guest.pax vs. additionalGuests — guarded with a regression test, not
  refactored), 21 DONE (5 confirmed-dead functions removed, each
  independently re-verified by direct grep before deletion; a much larger
  candidate — 21 unreachable functions in app-v8.js's own override-capture
  object — deliberately NOT deleted this pass, multi-file blast radius
  with no test coverage of the boot-sequence assumption it rests on).
  Pushed as commit b499dbe (parent af123a0). CI CONFIRMED GREEN on the
  branch head, commit b499dbe — both the push-triggered (run 34954004952)
  and pull_request-triggered (run 34954009456) workflow runs are fully
  green, all 10 checks each, verified job-by-job via the GitHub Actions
  API. Investigated via `frontend-architect` first, then two of
  its most consequential/destructive claims (the 5 dead functions, the
  21-vs-12 original split) independently re-verified by this session's
  own direct grep before acting on either. New suites
  `override-boundary.test.mjs` (parses app-v8.js's `original={...}`
  capture, asserts the unreferenced set matches a reviewed allowlist
  exactly in both directions) and `pax-invariant.test.mjs` (checks
  pax===1+additionalGuests across manual add, manual edit, and demo-seed
  paths). Both mutation-tested (an unreviewed new override name caught;
  a simulated pax-drift edit caught with the exact expected/actual
  mismatch). Full clean regression: 54/54 suites, 1779/1779 checks (up
  from 52/52, 1764/1764). Both offline artifacts rebuilt and re-verified
  (27/27). See full write-up above.
SECTIONS 22-25 STATUS: ALL FOUR DONE. 22 DONE (re-measured the full perf
  harness on the 4,000-seat fixture — integrity exact, console clean,
  windowing-correctness 17/17 — and built one new per-change runner,
  `benchmarks/perf/save-queue-burst.mjs`, wired into `npm run perf`, for
  the one thing this programme changed that the existing harness
  structurally cannot see: Section 13's saveState() write queue. Finding:
  the queue COSTS — drain ~2x (795/564ms vs 380/399ms), peak heap
  +16-42MB — in exchange for deterministic last-write-wins. Recorded as a
  trade, not a win. The runner's FIRST version reported the opposite and
  was wrong (no forced GC, no order control); both the corrected result
  and the wrong first reading are written into
  benchmarks/perf/README.md). 23 DONE (both artifacts rebuilt, real built
  package re-verified 27/27; dedicated final pass still section 36). 24
  DONE (one real gap: the freeze-challenge role="alertdialog" over the
  app's only custom scrim had initial focus + Escape but no Tab
  containment — trap added, 6 new checks in seating-freeze, 89->96,
  mutation-proven). 25 DONE (all 104 toast() sites audited; two real
  defects — Create Event's plan import and Floor Plan's replace-plan each
  toasted a bare error.message, untranslated, naming no action and no next
  step. Both now build from new bilingual keys setup.planReadFailed /
  plan.replaceFailed, keeping the library's {reason}. Plus a structural
  finding: nothing statically verified that a t() key exists, and
  error-path keys are exactly the ones no rendering test reaches — new
  static suite tests/suites/i18n-key-integrity.test.mjs, 13 checks, 4
  mutations proven. NO live missing key found; this is a guard for an
  uncovered risk, stated as such). Full clean regression: 55/55 suites,
  1799/1799 checks (up from 54/54, 1779/1779). Both offline artifacts
  rebuilt and re-verified (27/27). Pushed as commit 7d0aa49 (parent
  4b33fdb). CI CONFIRMED GREEN on that commit — both the push-triggered
  run 35427154716 and the pull_request-triggered run 35427155926 completed
  with conclusion "success", all 5 jobs each (Fast core, Offline,
  Detection, Intelligence, Performance) = 10/10 checks. See full write-up
  above.
SECTIONS 26-28 STATUS: ALL THREE DOCUMENTS DONE; the things they prepare
  for remain externally blocked and are NOT claimed. 26 DONE
  (benchmarks/operator/REAL-OPERATOR-TEST-KIT.md — the runnable facilitator
  kit, distinct from the existing README.md rationale; also CORRECTED a
  stale known-gap in that README which told facilitators to discount an
  operator who could not reach the object behind a Worth deciding row —
  that gap is closed, verified in budgetClaimHTML()'s data-budget-open ->
  openReviewQueue, so the note would have suppressed a real finding). REAL
  OPERATOR USABILITY: still NOT VERIFIED — no session has been run. 27
  DONE (benchmarks/operator/HUMAN-TEST-CONTRACT.md — 7 finding classes with
  per-class obligations, what does/does not oblige a fix, the
  operator-beats-the-metric clause, permitted status strings with
  MEASURED ONCE explicitly NOT a stepping stone to VERIFIED, and re-run
  triggers requiring a NEW operator). Unexercised. 28 DONE
  (benchmarks/heldout/THIRD-PLAN-PROCEDURE.md — 9 ordered steps, each one
  what was actually done for ORNEK; step 5 corrected after checking the
  repo rather than the tooling: benchmark:heldout/history.json is the
  leakage guard, but ORNEK's first run was recorded via the permanent
  ORNEK-FIRST-RUN.md + ornek-first-run.json record, and BOTH belong in the
  procedure). THIRD REAL PLAN: still NOT AVAILABLE. Nothing under src/ was
  touched, so no regression re-run was required for this segment.
SECTIONS 31/32 STATUS: BOTH DONE as design/documentation, which is what
  the rules permit — no dependency added, no schema created, no adapter
  written, and NO PACKAGING TECHNOLOGY CHOSEN (the rule names
  "packaging-technology choice" explicitly; a choice made in a design
  document is a choice made). 31 DONE
  (benchmarks/SQLITE-MIGRATION-DESIGN.md — main finding is that "export
  format v1" needs no designing because it already exists twice,
  merit-event-maker-backup and merit-event-maker-event-package, both
  formatVersion 1, both validating on import, the package format already
  solving id collision by renumbering; the design adds exactly one field,
  schemaVersion beside formatVersion, unimplemented because nothing
  consumes it yet. Schema records pax as a GENERATED column — the one
  genuine improvement SQLite buys the domain, structurally retiring
  Section 20's cached-field risk — and states plainly the one rule a
  schema CANNOT enforce: No Show keeping the planned seat is about which
  fields an operation may touch, not which states are valid, so
  setArrival() stays the single writer. Migration path is 2 ordered steps
  behind the EXISTING StorageProvider interface, proven by every existing
  suite passing unchanged). 32 DONE (benchmarks/DESKTOP-READINESS.md — an
  inventory separating what is shipping and covered from what is
  deliberately absent, carrying the inherited gaps forward rather than
  presenting a clean bill of health, and naming the one packaging makes
  worse: the operator session is best run BEFORE packaging, not after).
  Nothing under src/ touched; no regression re-run required.
SECTIONS 33/34 STATUS: BOTH DONE. 33 DONE as a coverage audit rather than
  a burst of new suites written to reach a number (a suite added to make a
  count look complete guards nothing). Counted against baseline 3ef11bb:
  9 new suites this programme, 18 existing extended, 61 suite files on
  disk, 61 declared and reachable, 0 orphaned — the orphan count verified
  by diffing filenames against the runner's own declared list, not by
  counting files and trusting they are wired up. 34 DONE and verified
  against the real workflow AND a real run log: npm test (55 fast) in Fast
  core + npm run test:slow (6) in Intelligence = 61, nothing unreached;
  npm run perf in Performance, so save-queue-burst.mjs is genuinely gated
  (confirmed by reading the log, not inferred). The 3 npm scripts absent
  from CI are correctly absent (benchmark:retrieval and
  benchmark:separation assert nothing; benchmark:heldout would refuse,
  there being no held-out plan). ONE REAL DEFECT found by reading that
  log: the burst runner printed "heap 13.6→13.6→13.6 MB" in CI because
  performance.memory is coarsened in a container — non-data rendered as
  data, reading as "the burst allocated nothing", the opposite of the
  finding. Now reports UNAVAILABLE; fix proven BOTH ways (real numbers
  locally, UNAVAILABLE under a simulated coarsened performance.memory),
  simulation reverted and file reconfirmed clean.
SECTIONS 35-38 STATUS: ALL FOUR DONE. 35 DONE — rendered and
  screenshotted at 1920x1080, 2560x1440 and ~1440px, console clean at all
  three, and the screenshots LOOKED AT rather than merely produced. ONE
  REAL DEFECT found and fixed: the toast stack (fixed, bottom:16px,
  z-index 2000) rendered directly on top of the Floor Plan's .planmap-fab
  "Add Manually" button (absolute, bottom:20px, 44px tall) — the toast
  saying "add the plan objects when you are ready" covering the one button
  that adds them. FAB 836/880 vs toast 845/884, measured. Fixed with
  body:has(.planmap-fab) .toast-wrap{bottom:76px}; re-measured 824 vs 836,
  no overlap; guarded by a new RENDERED-GEOMETRY check in floor-plan-modes
  (45->46), mutation-proven. The first reading of that screenshot — that
  the button was CLIPPED — was itself wrong; a DOM probe showed
  overflowPx -20, i.e. fully laid out and simply covered. The sweep was run
  directly rather than via the visual-qa-reviewer agent, which died on a
  session rate limit; the rule's requirement (rendered screenshots at three
  viewports, looked at) was met with the same tools the agent would have
  used. 36 DONE — npm run test:all 61/61 suites, 2011/2011 checks; both
  offline artifacts rebuilt and the real package RUN, 27/27; detector vs
  committed BASELINE.json "No regressions. 0 improvement(s), 0 note(s)",
  every guarded field per plan. 37 DONE (this file plus the matrix and the
  five other documents this programme wrote). 38 DONE
  (benchmarks/FINAL-COMPLETION-MATRIX.md, six permitted words only;
  sections 26/28/31 each carry TWO rows so a document's completion cannot
  stand in for the event it prepares for; the desktop build is its own row,
  BLOCKED).
CI_CONFIRMED: commit 7d0aa49 (sections 22-25) — 10/10, both triggers.
  Commit 2084b38 (sections 26-28, 31/32, 33/34) — 10/10, both triggers,
  runs 35427789080 (push) and 35427791578 (pull_request), conclusion
  "success". Note commit 202f47d's own run was CANCELLED, not failed: the
  workflow sets concurrency cancel-in-progress, and 2084b38 superseded it
  while it was still running. 2084b38 contains those commits, so the
  confirmation covers them. Commit e0c9c2e (sections 35-38) — 10/10, both
  triggers, runs 35441013558 (push) and 35441016226 (pull_request), both
  conclusion "success". Commit cbbf950, the checkpoint commit that RECORDS
  those confirmations and is the actual branch head — 10/10, both triggers,
  runs 35441520963 (push) and 35441522454 (pull_request), both conclusion
  "success", all 5 jobs each. THE BRANCH HEAD ITSELF IS CI-CONFIRMED GREEN,
  not merely the commit before it: a checkpoint commit still changes the
  head, and "the final head is green" has to mean the head that is actually
  there.
NEXT_SECTION: none. All 38 sections are resolved as far as they can
  honestly go. What remains is not a section: the real operator session
  (NOT VERIFIED), a third real plan (NOT AVAILABLE), and the desktop build
  (BLOCKED until the user types "EXE YAP").
NEXT_ACTION: sections 22-25 are fully closed out — committed (7d0aa49),
  pushed, CI-confirmed 10/10 both triggers. Sections 26-28 are committed
  locally as 4eaa5e6 and sections 31/32 follow; both are documentation and
  still need push -> CI confirmation, then proceed to 33/34. Section 7's
  exhaustive AST-based single-writer lint rule remains a live, separate
  opportunity if that section is revisited (see DEFERRED_SUB_SCOPE), but is
  not a blocker.
DEFERRED_SUB_SCOPE: full physicalChairs-shorter-than-capacity indexing
  change (section 2's "Deferred sub-scope" above) — STILL VALID, not
  attempted. Section 3's 5 unwired capacity sources — STILL VALID, named
  and translated but not producible without new detection features.
  Section 7's exhaustive AST-based audit — STILL VALID, not attempted;
  the grep spot-check is real evidence but not the complete audit.
  Section 8/9's native-confirm()-replacement and toast-dismiss findings
  (#5, #8 in the detailed write-up above) — STILL VALID, not attempted.
  Section 14's rollback pattern for the four other mutators — deliberately
  NOT extended, per the reasoning above; revisit only if one of them is
  ever found to actually throw in practice, with real evidence, not
  speculatively. Section 15's version-preservation scaffolding —
  deliberately NOT built; revisit only when a real non-additive migration
  step is actually needed, per the reasoning above. Section 21's 21
  unreachable original-capture functions in app.js/app-guests.js —
  STILL VALID and evidenced, deliberately NOT deleted; the
  `override-boundary` suite now tracks the fact explicitly, so revisit
  only as a deliberate, separate, evidence-gated deletion pass, ideally
  after adding real boot-sequence test coverage first.
  Section 25's dynamically-composed i18n keys (t("status.planning." + x)
  and ~27 other prefixes) — deliberately NOT covered by the new static
  suite; their full key is not knowable statically and enumerating the
  enum values would assert the suite's idea of the domain rather than the
  product's. A runtime sweep that exercises every enum value through the
  real render paths would close it; not attempted, and the existing
  DOM-walking `i18n` suite already covers the composed keys that any
  default-state screen renders.
BLOCKED_ON: nothing external for the next section. Sections 26-28's
  DOCUMENTS are done; their EXECUTION (a real operator session, a third
  real plan) is blocked on inputs only the user can supply, and is
  correctly left as NOT VERIFIED / NOT AVAILABLE rather than closed.
NOT_YET_TOUCHED: sections 33/34, 35-38 (see table above).
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
