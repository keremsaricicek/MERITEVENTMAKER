# Master Programme — Readiness

Written at commit `65ea956`, before the FINAL MASTER PROGRAMME runs.

This file says **who is ready, what they will read, what they will measure,
and what is honestly unknown today.** It fixes nothing. Every gap below is
work for the programme, not for the session that wrote this.

## Ready

All seventeen quality areas have exactly one owner. See
`.claude/QUALITY-TEAM.md` for the table and the boundary notes.

| | |
|---|---|
| Quality areas with an owner | **17 / 17** |
| Areas with no owner | **0** |
| Agents | 16 (10 existing, 6 added) |
| Project quality skills | 10 added, bound to owners |
| Final arbitration | `release-quality-director` |

## Starting state, measured at `65ea956`

Numbers the programme will re-derive. **Do not carry them forward without
re-measuring** — that is the failure mode this repo has already had twice.

| Area | Measured | Command |
|---|---|---|
| Suites / checks | 65 / 2,080 | `npm run test:all` |
| Offline verification | 27 / 27 | `npm run verify:offline` |
| Detector baseline | no regressions, per field per plan | `npm run benchmark:baseline` |
| Adversarial | 1 PASS · 4 PARTIAL · **3 FAIL** (re-measured at `02edac7`; see note) | `npm run benchmark:adversarial` |
| `app-v8.js` | 5,740 lines | `wc -l src/app-v8.js` |
| `plan-detection-classical.js` | 2,857 lines — transitional | `wc -l src/plan-detection-classical.js` |
| `aria-*` / `role=` | **23 / 8** | `grep -o 'aria-[a-z]*' src/*.js index.html \| wc -l` |
| `confirm()` / `prompt()` | **9 / 2** | `grep -o '\bconfirm(' src/*.js \| wc -l` |
| `innerHTML =` / `esc(` | **13 / 331** | `grep -o 'innerHTML\s*=' src/*.js \| wc -l` |
| `eval` / `new Function` | **0** | `grep -c 'eval(\|new Function' src/*.js` |
| `t()` calls / keys | 838 / 1,164 | `grep -o '\bt("' src/*.js \| wc -l` |
| Accessibility suites | **0** | `ls tests/suites \| grep -iE 'access\|a11y'` |
| Security suites | **0** | `ls tests/suites \| grep -iE 'secur\|xss'` |
| Resilience suites | **0** | `ls tests/suites \| grep -iE 'resilien'` |

### Adversarial re-measurement, `02edac7`

Re-run at this HEAD three times during the programme's opening: **1 PASS,
4 PARTIAL, 3 FAIL**, stable. The table above was already correct and needed
no correction.

A figure of 1 PASS / 5 PARTIAL / 2 FAIL was cited from an external
verification. It does **not** reproduce at this HEAD. Rather than adopt a
number this repository cannot produce, the measured result stands and the
discrepancy is recorded here. Whoever holds the external run can resolve it
by naming the commit it was taken at.

Per-fixture reasons at `02edac7`, which are the programme's §7 targets:

| Fixture | Verdict | Why |
|---|---|---|
| `a1-chair-under-table` | PARTIAL | 48 chairs seated at no table; table recall 0.500 |
| `a2-mixed-families` | **FAIL** | 7 real tables detected then **held back** as unknown; 23 FP vs 21 GT (precision 0.477) |
| `a3-no-anchors` | PASS | — |
| `a4-multi-room` | PARTIAL | bistro typed 0/8; chair recall 0.586 |
| `a5-architecture-only` | **FAIL** | **8 chairs proposed on a drawing with no furniture**; expected `capacityUnknown` fact absent |
| `a6-architectural-confusion` | **FAIL** | 46 FP vs 8 GT (precision 0.148) — architecture read as furniture |
| `a7-dense-overlap` | PARTIAL | bistro typed 0/7; table recall 0.724; chair recall 0.685 |
| `a8-large-venue` | PARTIAL | table recall **0.741 = 240/324** — the `MAX_TABLES=240` cap, arithmetically; chair recall 0.074 |

`a8`'s root cause is **proven rather than suspected**: 324 ground-truth
tables, 240 detected, and 240/324 is exactly 0.7407. That is the hard cap in
`plan-detection-classical.js`, not a detection weakness.

## The five things the programme must decide, not discover

Each is a known problem with a known owner. None can be closed by measuring
harder — each needs a decision.

1. **Three adversarial fixtures are FAIL and CI is green.**
   `run-adversarial.mjs` exits non-zero only on regression against a frozen
   baseline that already contains them. Either the FAIL verdicts become
   release-blocking, or each is accepted in writing with a reason and an
   owner. Silence grants a pass nobody decided to give.
   → `ci-quality-gate-engineer` + `computer-vision-engineer`

2. **A real gate runs under `continue-on-error`.** `measure-memory.mjs`
   exits non-zero on unmet thresholds; CI swallows it ("Visual Plan Memory
   (measured, not gated)"). Unwrap it, or reclassify it as INFO and say so
   in the quality report.
   → `ci-quality-gate-engineer`

3. **Three dimensions have zero executable coverage** — accessibility,
   security, resilience. Building the first suite in each is the largest
   single block of work in the programme.
   → `accessibility-guardian`, `security-auditor`, `resilience-engineer`

4. **`guest.assignment` has 8 writers across 3 areas.** This blocks the
   Guests, Seating and canvas extractions. Consolidating it is not itself an
   extraction and comes before them.
   → `frontend-architect` + `merit-product-director`

5. **Real-world validation has no evidence.** An operator test kit and a
   human test contract exist; no completed session is recorded. This cannot
   be produced from inside a development session.
   → `release-quality-director` owns saying so

## Honest ceilings

Two dimensions cannot reach 10 in this programme, and saying so now prevents
a dishonest number later:

- **Plan intelligence reliability** — bounded by having **two real venue
  plans**. Eight synthetic fixtures are constructed probes, not a
  population. 10 needs a third independent real plan.
- **Real-world validation** — **NOT VERIFIED** until real operators run real
  events. It may not be scored numerically from a dev session.

**Desktop readiness** is capped at 9 by design: 10 is unreachable before the
user types **EXE YAP**, and that is correct, not a gap.

## What each owner reads first

| Owner | Reads |
|---|---|
| `release-quality-director` | `merit-quality-program`, `QUALITY-TEAM.md`, this file |
| `merit-product-director` | `merit-product-contract`, `.claude/rules/product.md` |
| `frontend-architect` | `merit-maintainability-hardening`, the three ownership/inventory maps in `benchmarks/` |
| `data-architecture-engineer` | `merit-data-integrity-hardening`, `.claude/rules/data.md` |
| `computer-vision-engineer` | `merit-plan-reliability`, `merit-plan-intelligence`, `.claude/rules/ai.md` |
| `accessibility-guardian` | `merit-accessibility-hardening`, `web-accessibility` |
| `security-auditor` | `merit-security-hardening` |
| `localization-guardian` | `merit-localization-hardening` |
| `resilience-engineer` | `merit-resilience-hardening`, `.claude/rules/data.md` |
| `ci-quality-gate-engineer` | `merit-ci-quality-gates`, `.github/workflows/ci.yml` |
| `performance-qa-engineer` | `merit-performance-hardening`, `web-performance` |
| `premium-ui-director` / `visual-qa-reviewer` | `merit-ui-quality-gates`, `merit-ui-constitution` |
| `desktop-electron-engineer` | `merit-desktop-architecture`, `.claude/rules/desktop.md` |

## Handoff

1. Each owner **re-measures** their dimension. No score from memory or from
   this file.
2. Each reports evidence · open debt · score, citing the rule from
   `merit-quality-program` that justifies the score.
3. `release-quality-director` cross-checks and issues a verdict per
   dimension.
4. Nothing is DONE while any dimension is BLOCKED or any score is
   unsupported.

## Readiness

**READY.** Every area has an owner, a contract, and a named measurement.
Three dimensions start from zero coverage and two carry honest ceilings —
both are stated above rather than discovered mid-programme.

The infrastructure is ready. The product is not yet 9/10, and this file does
not pretend otherwise.
