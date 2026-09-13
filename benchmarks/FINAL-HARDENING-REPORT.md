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
| 2 | Physical chair / logical seat / capacity separation | NOT STARTED | Full audit of `syncTableChairs`, `seatPositions`, `hasPhysicalSeats`, `commitCandidates`, table creation, migrations, seating, Live, exports, imports, backup, replay, history, recovery, and plan rendering for capacity-fabricates-chairs bugs. This is the single largest item in the programme — it touches nearly every subsystem below it (provenance, exports, package, migration). |
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
- This report.

## Continuation checkpoint (machine-readable)

```
NEXT_SECTION: 2 (Physical chair / logical seat / capacity separation)
NEXT_ACTION: Audit syncTableChairs, seatPositions, hasPhysicalSeats,
  commitCandidates in src/app.js and src/app-v8.js for any code path where
  `capacity > 0` alone causes a physical chair object to be fabricated.
  Design the fix (capacity as a number, physical chairs as a real array
  that can legitimately be empty), then implement + add the 6 mandatory
  tests from section 2, then move to section 3 (capacity provenance) on
  the same commit or the next one.
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
