---
name: merit-quality-program
description: The master quality contract for MERIT ENTERTAINMENT — EVENT MAKER. Defines the seventeen quality dimensions, who owns each, what measurement counts as evidence, and the anti-inflation rules that decide when a dimension may be called 9/10 or 10/10. Use at the start of any quality programme, before scoring any dimension, before declaring any area DONE, and whenever two specialists disagree about whether something is finished.
---

# MERIT Quality Program

The upper contract every other quality skill hangs off. It answers three
questions and nothing else:

1. **What are the dimensions?** Seventeen, listed below. No others are
   scored; none of these is skipped.
2. **Who owns each?** Exactly one agent. `.claude/QUALITY-TEAM.md` is the
   routing table and it is authoritative.
3. **When may a dimension be called 9 or 10?** Only under the gates in this
   file. This is the part that matters, because it is the part that gets
   quietly broken.

## The target, stated honestly

Every dimension that is **technically within our control** should reach
**9/10 minimum**, ideally 9.5–10.

Two dimensions are **not fully within our control** and must never be scored
as if they were: **real-world validation** (§17) needs real operators on real
events, and **plan intelligence reliability** (§8) needs plan families we do
not have. Their ceiling without that evidence is stated in their sections.
Writing 9/10 there is not optimism, it is a false statement about what was
tested.

---

## THE ANTI-INFLATION RULES

A dimension **may not be reported as 9 or 10** if any of these is true:

| Disqualifier | Why |
|---|---|
| **It was not measured this run** | A remembered number is not a measurement. Re-run it or report the dimension as NOT VERIFIED. |
| **No test would fail if the behaviour broke** | Documentation is not coverage. A dimension whose only evidence is prose is capped at **5**. |
| **A known defect is open in it** | An open bug is a fact about the dimension. It does not become 9 because everything else passed. |
| **CI is green because the check is non-blocking** | See §14. A `continue-on-error` gate or an exit code that ignores a FAIL verdict is not a pass. |
| **The threshold was lowered to make it pass** | Moving a bar is not clearing it. This is the single most serious violation in this file. |
| **A test was skipped, deleted or quarantined to get green** | Same. |
| **The evidence is a stale artifact** | A `dist/`, baseline, or report older than the code it describes proves nothing. |
| **The claim is "it boots" or "it builds"** | Booting is not behaving. This repo has shipped a build that booted cleanly with a detector that threw on every real plan. |

**Scoring scale, so the numbers mean one thing:**

| Score | Meaning |
|---|---|
| **10** | Measured, enforced by a release-blocking gate, no open defects, and the gate has been proven to bite (mutation or a real caught regression). |
| **9** | Measured and enforced by a gate; minor known debt is written down and does not affect operators. |
| **7–8** | Measured, but enforcement is partial (informational check, or coverage has a named hole). |
| **5–6** | Implemented and reviewed, but nothing fails if it regresses. |
| **3–4** | Partial implementation, no measurement. |
| **1–2** | Not addressed. |
| **NOT VERIFIED** | Cannot be scored without evidence this build cannot produce. Not a zero — an honest absence. |

**`NOT VERIFIED` is a valid, respectable outcome.** Preferring it to a
guessed 9 is the behaviour this skill exists to produce.

---

## THE SEVENTEEN DIMENSIONS

Each carries: owner · measurement · current evidence · open debt · minimum
gate · 9/10 condition · 10/10 condition.

Current-state figures below were measured at commit `65ea956`. **Re-measure
before using them.** They are a starting point, not a result.

### 1. Business / domain correctness
- **Owner** `merit-product-director`
- **Measurement** `guest-and-seating-rules`, `pax-invariant`,
  `historical-immutability`, `physical-logical-seat-separation`,
  `xlsx-contract`, `arrival-wave`, `seating-freeze`, `table-availability`
- **Evidence** the domain rules in `.claude/rules/product.md` each have a
  suite; the workbook export is opened and diffed, not merely run
- **Open debt** `guest.assignment` has 8 writers across 3 areas
  (`benchmarks/APP-V8-OWNERSHIP-MAP.md` A12/A17/A21)
- **Minimum gate** every rule in `.claude/rules/product.md` has a suite that
  fails when the rule is violated
- **9** the above, plus the single-writer violation closed or explicitly
  accepted in writing by the user
- **10** plus a suite that structurally asserts one writer per domain fact

### 2. Test discipline
- **Owner** `ci-quality-gate-engineer` (suite integrity);
  each specialist owns their own suites' content
- **Measurement** `npm run test:all`; suite count and check count; the
  mutation record for each structural suite
- **Evidence** 65 suites / 2,080 checks at `65ea956`
- **Open debt** **no accessibility, security or resilience suite exists** —
  three dimensions have zero executable coverage
- **Minimum gate** `test:all` green; no skipped/quarantined test
- **9** every dimension in this file has at least one suite that fails when
  it regresses
- **10** plus each structural suite has a recorded mutation proof

### 3. Architecture / modularity
- **Owner** `frontend-architect`
- **Measurement** `dependency-direction`, `boot-contract`,
  `offline-bundle-contract`, `plan-detection-boundary`; line counts
- **Evidence** `app-v8.js` 5,740 lines (was 8,543); detection pipeline
  extracted behind one registry, reading no shell state
- **Open debt** `plan-detection-classical.js` is 2,857 lines — a
  **transitional extraction, not a finished module**; 25 of 26 app-v8 areas
  unextracted
- **Minimum gate** the four structural suites green
- **9** no file over ~1,500 lines is presented as final architecture, and
  every extracted module has a seam suite
- **10** plus the ownership map has no HIGH-difficulty area left blocked on a
  multi-writer field

### 4. Data integrity / storage
- **Owner** `data-architecture-engineer` · skill `merit-data-integrity-hardening`
- **Measurement** `schema-migration`, `storage-provider`,
  `transaction-atomicity`, `backup-restore`, `event-package`,
  `offline-recovery`, `venue-model`
- **Open debt** to be re-measured against the skill's checklist
- **Minimum gate** no silent data loss on any path; historical events
  immutable at the storage layer
- **9** every persisted-shape change has a save→reload round-trip test
- **10** plus corruption of any stored record is detected, contained and
  reported without losing the rest

### 5. Offline
- **Owner** `frontend-architect`
- **Measurement** `npm run verify:offline` — 27 checks that **run** both
  built artifacts, abort off-origin requests, and drive real OCR
- **Evidence** 27/27 at `65ea956`
- **Minimum gate** both artifacts build AND run; zero off-origin requests
- **9** current state
- **10** plus the folder build's source completeness is asserted the way the
  light build's already is

### 6. Performance
- **Owner** `performance-qa-engineer` · skill `merit-performance-hardening`
- **Measurement** `npm run perf`; DOM count, render, search, seating latency,
  heap
- **Open debt** single-run numbers are not evidence; p95 and repeat runs
  required
- **Minimum gate** no unbounded growth; documented budgets
- **9** median **and** p95 over ≥3 runs at 3,000 guests / 400 tables / 4,000
  seats, within budget
- **10** plus a CI performance gate that blocks a real regression

### 7. AI honesty
- **Owner** `computer-vision-engineer`
- **Measurement** `plan-detection-boundary` (`trainedModel:false`),
  `plan-encoder`, `plan-intelligence-contract`, `visual-second-opinion`
- **Evidence** the provider's honesty flags are asserted in a live browser
- **Minimum gate** nothing is called AI or a trained model; no fabricated
  detection, confidence or metric
- **9** current state
- **10** plus every user-facing string that could imply a model is asserted
  by a suite

### 8. Plan intelligence reliability
- **Owner** `computer-vision-engineer` · skill `merit-plan-reliability`
- **Measurement** `npm run benchmark:adversarial`, `benchmark:baseline`,
  `benchmark:memory`, `benchmark:false-positives`
- **Evidence** 8 adversarial fixtures: **1 PASS, 4 PARTIAL, 3 FAIL**
- **Open debt** three fixtures are **actively wrong**, and the runner exits
  non-zero only on *regression vs a frozen baseline that already contains
  those FAILs* — so CI is green while they fail (see §14)
- **Ceiling without new evidence** this dimension is bounded by the plans we
  have. Two real venue plans is not a population.
- **Minimum gate** no fabricated object; abstention available; identity never
  asserted on resemblance alone
- **9** zero FAIL fixtures, and every remaining PARTIAL is a *named,
  understood* limitation — not an unexplained number
- **10** plus a third independent real plan, measured, with no
  sample-specific runtime logic

### 9. UI / UX quality
- **Owner** `premium-ui-director` (direction) + `visual-qa-reviewer`
  (verification) · skill `merit-ui-quality-gates`
- **Measurement** rendered screenshots at 1920×1080 / 2560×1440 / ~1440px ×
  TR+EN; task-completion and interaction counts
- **Open debt** **9 `confirm()` and 2 `prompt()` calls** remain in `src/` —
  browser-native dialogs in a premium product
- **Minimum gate** rendered evidence at 3 viewports; no console errors
- **9** no browser-native dialog on a primary flow; every screen has real
  empty/loading/error states
- **10** plus measured task completion for the core operator workflows

### 10. Accessibility
- **Owner** `accessibility-guardian` · skill `merit-accessibility-hardening`
- **Measurement** automated scan **plus** real keyboard-only workflows
- **Evidence** **23 `aria-*` attributes and 8 `role=` across the whole app;
  zero accessibility suites.** This is the weakest dimension in the product.
- **Minimum gate** every operator task completable by keyboard alone; no
  keyboard trap; visible focus
- **9** the above, automated scan clean, focus trap/restore correct in every
  dialog, dynamic Live Event updates announced
- **10** plus verified with a real screen reader

### 11. Localization
- **Owner** `localization-guardian` · skill `merit-localization-hardening`
- **Measurement** `i18n`, `i18n-key-integrity`, **plus** a hardcoded-English
  scan of `src/`
- **Evidence** 838 `t()` calls, 1,164 keys; key integrity is asserted
  statically across every call site
- **Open debt** key integrity ≠ absence of hardcoded English. No check
  currently looks for a literal user-facing English sentence in source.
- **Minimum gate** no raw key reaches the screen; both languages complete
- **9** plus zero hardcoded user-facing English in `src/`, including
  `aria-label`, `title`, placeholders and error text
- **10** plus TR-first verified in rendered screenshots at both viewports

### 12. Error handling / resilience
- **Owner** `resilience-engineer` · skill `merit-resilience-hardening`
- **Measurement** fault-injection suites per failure mode
- **Evidence** **zero resilience suites.** `offline-recovery` and
  `backup-restore` cover two paths; the rest are unmeasured.
- **Minimum gate** no raw `error.message` shown to an operator; no silent
  catch outside a documented expected-abstention
- **9** every failure mode in the skill's table has DETECT / CONTAIN /
  INFORM / RECOVER / PRESERVE verified by a test
- **10** plus fault injection runs in CI

### 13. Documentation
- **Owner** `release-quality-director`
- **Measurement** every load-bearing figure in `CLAUDE.md`, `.claude/rules/`
  and the skills is re-derivable by a named command
- **Evidence** the repo-facts tables carry their own re-measure commands
- **Open debt** this repo has twice shipped instruction files whose figures
  were stale (61→64 suites; "no automated tests" when 61 existed)
- **Minimum gate** no instruction file contradicts a measurable repo fact
- **9** plus each figure names the command that produces it
- **10** plus a check that fails when a documented figure drifts

### 14. CI / automation
- **Owner** `ci-quality-gate-engineer` · skill `merit-ci-quality-gates`
- **Measurement** read `.github/workflows/ci.yml` **and** each script's exit
  semantics — not the green badge
- **Evidence, measured at `65ea956`** — this is the dimension most at risk of
  a false 9:
  - `benchmarks/adversarial/run-adversarial.mjs` sets a non-zero exit **only
    on regression vs the frozen baseline**. Three fixtures are permanently
    FAIL inside that baseline, so they never turn CI red.
  - `benchmarks/memory/measure-memory.mjs` **does** exit non-zero on unmet
    gates, but CI runs it under `continue-on-error: true` ("Visual Plan
    Memory (measured, not gated)"). A real gate failure is swallowed.
- **Minimum gate** every quality area is classified INFO / WARNING / RELEASE
  GATE, and the classification is written down
- **9** every RELEASE GATE can actually turn CI red, and no
  `continue-on-error` wraps one
- **10** plus a green run provably implies every release gate passed

### 15. Security / privacy
- **Owner** `security-auditor` · skill `merit-security-hardening`
- **Measurement** hostile-input fixtures for every operator-enterable string
- **Evidence** 331 `esc()` calls, **13 `innerHTML` assignments**, 0
  `eval`/`new Function`, `createObjectURL`/`revokeObjectURL` balanced 4/4.
  **Zero security suites.**
- **Open debt** "`esc()` is used" is not proof. Each of the 13 `innerHTML`
  sites needs its inputs traced.
- **Minimum gate** no XSS from any imported or typed string
- **9** hostile-input fixtures for guest names, notes, venue/event names, OCR
  text and Teach AI input all pass, and each `innerHTML` site is accounted for
- **10** plus CSP-ready and no guest data in logs or exports that should not
  carry it

### 16. Desktop readiness
- **Owner** `desktop-electron-engineer`
- **Measurement** `benchmarks/DESKTOP-READINESS.md`,
  `benchmarks/SQLITE-MIGRATION-DESIGN.md`
- **Minimum gate** the migration path is designed and the EXE gate is
  respected
- **9** design complete and current
- **10** not reachable before the user types **EXE YAP**. Until then this
  dimension is capped at 9 by definition, and that is correct.

### 17. Real-world validation
- **Owner** `release-quality-director` (owns declaring it unproven)
- **Measurement** real operators, real events, plans we did not choose
- **Evidence** `benchmarks/` contains an operator test kit and a human test
  contract; **no completed real-operator session is recorded**
- **Ceiling** **NOT VERIFIED** until a real session happens. This dimension
  **may not be scored numerically** from inside a development session.
- **9** a real operator completes the core workflows on a real event and the
  findings are recorded
- **10** plus a second venue, independently

---

## How a quality programme runs

1. **Measure first.** Every owner re-derives their dimension's numbers. No
   dimension is scored from memory or from a previous report.
2. **Each owner reports** evidence, open debt, and a score with the rule from
   the table above that justifies it.
3. **`release-quality-director` cross-checks**, looking specifically for:
   a score unsupported by a command, two owners contradicting each other, a
   green CI hiding a non-blocking gate, a stale artifact, and behaviour
   changes described as refactors.
4. **Verdict per dimension:** `PASS` / `PARTIAL` / `BLOCKED` / `NOT VERIFIED`.
5. **Nothing is DONE** while any dimension is BLOCKED, or while any score is
   unsupported.

**"All tests passed" is not a verdict.** It is one input to one dimension.
