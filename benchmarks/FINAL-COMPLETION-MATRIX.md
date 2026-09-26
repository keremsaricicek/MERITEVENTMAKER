# Final completion matrix

Section 38. The closing statement of the pre-desktop programme, in the exact
vocabulary the programme permits and no other.

## The vocabulary

| status | means |
|---|---|
| **DONE** | Implemented, tested, committed, pushed, and verified by real PR CI. |
| **PARTIAL** | Real work landed; what remains is named concretely, with why. |
| **NOT VERIFIED** | Built, but the verification it needs has not happened. |
| **NOT AVAILABLE** | Blocked on an input that does not exist yet. |
| **DEFERRED** | Deliberately out of scope for pre-desktop, per the programme's rules. |
| **BLOCKED** | Cannot proceed without something external. |

No other word appears in the Status column. In particular there is no "mostly",
no "essentially done", and no percentage — a section is one of these six or it
is not described.

Two of these mean the work is finished and two mean it is not, and the
difference is deliberately visible. **NOT VERIFIED and NOT AVAILABLE are not
softer DONEs.** Where a section produced a document and the thing the document
prepares for has not happened, the matrix carries *both* statuses rather than
letting the document's completion stand in for the event's.

---

## The matrix

| # | Section | Status | What that means here |
|---|---|---|---|
| 1 | Generalisable plan understanding | **PARTIAL** | The evidence→hypothesis→corroboration→abstain shape exists and composes (Plan Doctor, Self-Check, Confidence Budget, Number Integrity). Not audited step-by-step against the exact 18-step order. |
| 1A | No sample-specific production logic | **DONE** | All 47 Golden/ORNEK/merit-real-venue mentions in `src/*.js` audited: every one a comment explaining a generalized measured threshold, never a branch on sample identity. Guarded by a new static suite, mutation-proven. |
| 1B | Plan representation as evidence | **PARTIAL** | `decide()` makes one global PHYSICAL/SYMBOLIC verdict per plan. Zone-local/mixed representation is a real architecture change, and **neither real plan exhibits it** — implementing it blind risks the confident-wrong-classification this section exists to prevent. |
| 2 | Physical chair / logical seat separation | **DONE** | New suite, mutation-proven, CI-confirmed. |
| 3 | Capacity provenance | **DONE** | 3 of 8 sources wired; the other 5 are named and translated but **unwired because no current feature produces them**. Stated as by-design, not as a shortfall. |
| 4 | Object identity safety | **DONE** | Audit; no gap found. The safety property was already implemented. |
| 5 | Human-system interaction contract | **DONE** | Audit; no gap found. |
| 6 | Turkish-first product | **DONE** | Including the boot-default check nothing previously observed. |
| 7 | UI/business logic separation | **PARTIAL** | Four representative domain facts grepped; **zero violations on that sample**. Not exhaustively verified across the ~8,000-line file — that needs AST analysis, which is named and not attempted. |
| 8 | Floor Plan experience simplification | **PARTIAL** | The original numeric targets were lost to an earlier context compaction. Rather than fabricate compliance against unknown numbers, a fresh evidence-based UX audit was commissioned and every real finding fixed, including one CRITICAL. Honestly not a re-verification of the original targets. |
| 9 | Live Event operational flows | **PARTIAL** | Same audit; 5 more real findings fixed. Two real findings (native `confirm()`, unbounded toast stacking) deliberately deferred and named. |
| 10 | Event Readiness Timeline | **OBSOLETE** | The problem it would solve no longer exists, with evidence. *(Outside the six-word vocabulary: this was the user's own explicit instruction — "Mark section 10 OBSOLETE with the evidence, not NOT STARTED.")* |
| 11 | Data Provenance Inspector | **DONE** | |
| 12 | Interactive first-run onboarding | **DONE** | |
| 13 | Storage safety, write ordering | **DONE** | Real IndexedDB hazard closed; proven with deterministic simulated latency, because real IndexedDB is too fast to reproduce it from incidental timing. |
| 14 | Domain transaction atomicity | **DONE** | Narrowly scoped on purpose: the rollback pattern was **not** extended to four other mutators with no try/catch and no history of throwing. |
| 15 | Schema migration chain | **PARTIAL** | Version-dispatch scaffolding deliberately not built — untestable today, since every migration step is idempotent and additive. The testable thing was built instead: an end-to-end proof against a genuinely old fixture. |
| 16 | Audit durability | **DONE** | `EVENT_UPDATED` removed entirely: pure noise, never read, competing with real decisions for a capped shared array. |
| 17 | Backup/recovery re-audit | **DONE** | Audit found no production gap; added the missing recovery-of-recovery test. |
| 18 | Portable Event Package re-audit | **DONE** | Verification only. |
| 19 | Code architecture hardening | **DONE** | The dependency graph was already sound — zero exceptions found. The real gap was an unenforced override boundary, closed with a static suite rather than a restructure. |
| 20 | Single source of truth audit | **DONE** | One narrow latent risk found (`guest.pax`), guarded rather than refactored, because every current write site is already correct and no bug drove the refactor. |
| 21 | Dead/duplicate code audit | **DONE** | 5 functions removed after independent verification. A larger finding — 21 unreachable capture functions — deliberately **not** deleted; tracked explicitly instead. |
| 22 | Performance at scale | **DONE** | Re-measured, plus one new per-change runner. Finding: Section 13's queue **costs** drain latency and heap; recorded as a trade, not a win. |
| 23 | Offline guarantee re-verification | **DONE** | 27/27 after every commit, by **running** the built artifact. |
| 24 | Accessibility / keyboard | **DONE** | One real gap (no Tab containment on the only custom `role="alertdialog"`), closed and mutation-proven. |
| 25 | Error messages | **DONE** | Two real defects fixed; a static guard added for error-path i18n keys, which no rendering test can reach. |
| 26 | Real operator test infrastructure | **DONE** | The kit is written. |
| 26 | Real operator **session** | **NOT VERIFIED** | **No person has used this product.** Nothing in this repository says otherwise. |
| 27 | Human test follow-up contract | **DONE** | Written before any session, which is the only time it could be written honestly. Unexercised. |
| 28 | Third real plan procedure | **DONE** | Nine steps, each one what was actually done for ORNEK. |
| 28 | Third real plan itself | **NOT AVAILABLE** | No third plan has been supplied. |
| 29 | 2-real-plan open debt audit | **DONE** | Classification. One remaining gap named: no ORNEK rendering-variant robustness suite. |
| 30 | Audit/timeline/provenance distinct | **DONE** | Verified; the boundary already held. |
| 31 | SQLite migration design | **DONE** | Design only, as `.claude/rules/data.md` requires. Main finding: the export format already exists twice. |
| 31 | SQLite itself | **DEFERRED** | Forbidden during browser review, and no measurement says the current engine is the constraint. |
| 32 | Desktop readiness document | **DONE** | Inventory. |
| 33 | Remaining quality gates | **DONE** | Coverage audit: 9 new suites, 18 extended, 61 files, 61 reachable, 0 orphaned. |
| 34 | CI integration | **DONE** | Verified against the workflow *and* a real run log, which is how the CI heap defect was found. |
| 35 | Visual quality check | **DONE** | Rendered and screenshotted at all three viewports, console clean at each. One real defect found — a toast covering the Floor Plan's own "Add Manually" button — fixed, re-rendered, and guarded by a rendered-geometry check. |
| 36 | Final full validation | **DONE** | 61/61 suites, 2011/2011 checks; offline 27/27; detector baseline "no regressions", every guarded field per plan. |
| 37 | Final documentation | **DONE** | `FINAL-HARDENING-REPORT.md` plus this file. |
| 38 | Final completion matrix | **DONE** | This file. |
| — | **Desktop / EXE build** | **BLOCKED** | Forbidden until the user types the exact phrase **"EXE YAP"**. They have not. No packaging, no installer, no packaging-technology choice, and PR #5 is not merged to `main`. |

---

## The four things that are not finished, stated plainly

A matrix that is read quickly is read for its DONEs. These are the rows that
matter more:

1. **No real person has used this product.** Every usability number in this
   repository was produced by a script, and a script never gets confused by a
   card or scrolls past the item it needed. The instrument, the kit and the
   contract are all ready; the session has not happened. **NOT VERIFIED.**

2. **Cross-venue generalization is measured twice, not verified.** Two real
   plan families, one physical and one symbolic. A third would make it three
   data points, and this project has deliberately not defined a threshold at
   which the word VERIFIED becomes honest. **NOT AVAILABLE** (the plan).

3. **Six sections are PARTIAL, and each names what remains** — the 18-step
   audit (§1), mixed representation with no real plan exhibiting it (§1B), the
   AST-based exhaustive single-writer audit (§7), the lost numeric targets
   replaced by a fresh audit (§8/9), and version-dispatch scaffolding that
   would be untestable today (§15). None of these is a silent shortfall; each
   was a decision with a reason, and in four of them the reason is that
   building the thing now would be speculative work against an unknown or
   absent requirement.

4. **The desktop build does not exist and is not being built.** **BLOCKED** on
   one exact phrase.

## What this programme actually changed

Measured against the frozen baseline `3ef11bb`:

| | baseline | now |
|---|---:|---:|
| suites | 52 | **61** |
| checks (full run, slow included) | 1,846 | **2,011** |
| offline verification | 27/27 | **27/27** |
| detector baseline | green | **no regressions, any field, either plan** |
| CI checks green | 10/10 | **10/10** |

Nine new suites, eighteen extended, every behaviour change mutation-proven
individually, and every section group pushed and CI-confirmed before the next
began.

## Three times a measurement said nothing, and was caught

Recorded because the pattern is the most transferable thing here, and because
each was found by looking rather than by a failing test:

1. A perf profile misattributed ~1.2s of Guests-screen layout to the following
   keystroke, because layout was deferred past the end of the timed region.
2. Section 22's burst runner reported, on its first run, that the write queue
   was *faster* on every axis — an artifact of no forced GC and no order
   control. Corrected, it says the opposite.
3. That same runner printed `heap 13.6→13.6→13.6 MB` in CI, because
   `performance.memory` is coarsened in a container. A green job was reporting
   "the burst allocated nothing", which is the reverse of the finding.

In all three the code ran, the job passed, and the number meant nothing.
**"It ran" is not evidence, in exactly the way "the build succeeded" is not.**
