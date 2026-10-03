# Final completion matrix — the FINAL MASTER QUALITY & COMPLETION PROGRAMME

The one current matrix. It replaces the previous programme's matrix (whose
section numbers meant different things); that programme's closing record stays
in `FINAL-HARDENING-REPORT.md` as history. Every figure here was measured at
the commit it names, by the command it names. The work log behind each row is
`benchmarks/MASTER-PROGRAMME-STATE.md` (entries A–AI).

- **Programme start** `02edac7` · **final validation** `f34b855` (§35, below) ·
  **final head** `fb8238e` (the last code commit; the commit carrying this
  file adds documents only). After `f34b855` there is one code change —
  `fb8238e`, three i18n strings and the check that pins them, gated by the
  i18n suites, offline 27/27 and CI — and the rest is documents.
- **Not done, by instruction:** no EXE or desktop package; PR #5 not merged; no
  third real plan invented; no human test invented.

## Vocabulary

| status | means |
|---|---|
| **DONE** | Implemented, tested by a suite that fails when it regresses, committed, pushed, CI green. |
| **NOT VERIFIED** | Built; the verification it needs can only happen outside a development session. |
| **NOT AVAILABLE** | Blocked on an input that does not exist (a third real plan). |
| **DEFERRED BY EXPLICIT EXE GATE** | Forbidden until the user types **EXE YAP**. |
| **BELOW TARGET** | Measured, worked on, not reached; the concrete technical blocker is stated. Not a softer DONE. |

The programme asked that no technically fixable PARTIAL remain. Three rows end
**BELOW TARGET** instead of DONE: they are detector-reliability limits that
were measured and attacked, where no measured fix exists and lowering a
threshold to pass is forbidden. They are not relabelled to fit the list.

---

## §35 — final validation at `f34b855`

Run on a clean `git archive` of `f34b855`, the pinned OCR engine served
locally, the network refused (`tests/lib/env.mjs`).

| check | command | result |
|---|---|---|
| suites | `node tests/run.mjs --all` | **104/104 suites, 3,289/3,289 checks** (8 slow included) |
| offline, both artifacts built AND run | `build-offline` · `build-offline-full` · `verify-offline-package` | **27 passed, 0 failed** (also 27/27 on `fb8238e`) |
| detection, every guarded field per plan | `npm run benchmark` + `benchmark:baseline` | **No regressions. 0 improvement(s), 0 note(s).** Golden (merit-real-venue): tables F1 0.958 (46/46, 4 FP), chairs F1 0.951; ORNEK: tables F1 0.985 (162/166, 1 FP) |
| detector output, byte-for-byte, 28 plans | `node benchmarks/detector-fingerprint.mjs --compare` | **28 of 28 plans IDENTICAL** — the §3E reformat and every Split B move changed no detector output |
| adversarial, fixture by fixture | `run-adversarial.mjs --compare` | exit 0 — **2 PASS · 5 PARTIAL · 2 FAIL**; 0 blocking, the 2 FAILs are the known ones in `KNOWN-FAILS.json` |
| Visual Plan Memory | `measure-memory.mjs --compare` | exit 0 — no regression; retention 0.6264, identity precision 0.958, wrong application 0.042; §23 targets NOT MET (INFO, not gated). Real distinct venue plans: 1 — cross-venue NOT VERIFIED |
| review order · facts · contradictions · zones · false positives · teaching | `npm run benchmark:<name>` | each exit 0 (review order, facts, contradictions, zones, false positives, teaching — teaching precision 1.0000 against ≥ 0.98) |
| CI, job by job | GitHub check runs on the pushed head | **10/10 green on `fb8238e`** — Fast core, Detection, Intelligence, Offline, Performance, each on the push and pull_request triggers; read from the check runs, the Performance job's log read for the figures below |

| fixture | verdict | tables (with OCR) |
|---|---|---|
| a1-chair-under-table | PARTIAL | 8/16, 0 FP |
| a2-mixed-families | **FAIL** (known) | 12/21, 3 FP, 3 held back |
| a3-no-anchors | PASS | 20/20 |
| a4-multi-room | PARTIAL | 17/25, 0 FP |
| a5-architecture-only | PASS | 0 proposed on a drawing with no furniture |
| a6-architectural-confusion | **FAIL** (known) | 8/8, 21 FP |
| a7-dense-overlap | PARTIAL | 15/29, 0 FP |
| a8-large-venue | PARTIAL | 289/324, 0 FP (round typed 136/289, chair recall 0.089) |
| a9-mixed-representation | PARTIAL | 72/75, 0 FP |

**Performance on `fb8238e`** (CI, `npm run perf`, 400 tables / 3,000 guests /
4,000 seats, 20 samples per operation in two passes, ms, median / p95):
command 29.7 / 56.7 · floor 148.6 / 194.7 · guests 20 / 30.1 · guest search
keystroke 13.1 / 20.2 · seating 150 / 190.7 · live 56.4 / 70.9 · live search
keystroke 26.2 / 39.6 · reports 57.6 / 82.1 · table select 103.6 / 181 ·
serialise 14.2 / 22. 300 seating renders: block medians 156–176, no
degradation; DOM 2,270 nodes after one lap and after three. Plan analysis on
the real venue plan with OCR: median 3,780 ms of 3. These are measurements —
no budget exists, which is why dimension 6 is 7.

---

## The 40 sections

| § | section | status | evidence |
|---|---|---|---|
| 0 | start with truth | **DONE** | Starting state measured at `02edac7` (state doc, "Measured starting state"). |
| 1 | the two stale quality-doc defects | **DONE** | `dd263e0` (entry A). |
| 2 | programme quality target | see the 17-dimension table | |
| 3A | detector Split A | **DONE** | Geometry, size prior, shape, components, split, deskew, tone → own modules; seam suite `plan-detection-boundary` (entries L, AH). |
| 3B | detector Split B | **DONE** | `detect()` is an orchestrator (221-line file) over seven stage modules, each with an IN/OUT contract; the tables stage is nine named sub-stages. Every move 28/28 byte-identical on the fingerprint; each mutation-proven (entries AH, AI). |
| 3C | `guest.assignment` single writer | **DONE** | `src/seat-assignment.js`; `assignment-writer` fails on a new raw write (entry G). |
| 3D | app-v8 modularization | **DONE** | Rules moved out of screen code: event rules, occupancy, phase/radar verdict, layout-change rules, writer transitions, the guest-matching engine (steps 3a–6). app-v8.js is 30% of `src/` by bytes (472,391 of 1,579,906): the override layer and screen presentation over modules. Screens themselves not moved — see dimension 3. |
| 3E | dead code / duplication / long lines | **DONE** | Removable functions: 0 (`CODE-INVENTORY.md`, measured with `js-scan`); 3 dead exports and a write-only field removed with proof; shell lines >500 chars 110 → 59, the rest single markup templates or single statements; AST-identical before/after (`f34b855`). |
| 4 | physical chair / logical seat / capacity | **DONE** | Entry C; `physical-logical-seat-separation`. |
| 5 | capacity provenance | **DONE** | Entry AD. |
| 6 | local / mixed representation | **DONE** | Entries K, K2. |
| 7 | plan reliability — known bad scenarios | **BELOW TARGET** | `a5` fixed (entry H). `a2`, `a6` remain FAIL, accepted in writing for the CI gate (`adversarial/KNOWN-FAILS.json`), not as correct. Blocker: four theories for `a6` measured and refuted; the surviving one is untested; no threshold may be lowered. |
| 8 | 240-table ceiling | **DONE** | Ceiling 2,000, reported when reached; `large-venue-scale` (entry B, fixed for the moved constant in `32da994`). |
| 9 | identity safety | **BELOW TARGET** | Wrong-application rate 0.042 against 0.01. Blocker: a signal problem — no threshold setting reaches it (entry I); measured INFO beside a real regression gate. |
| 10 | ORNEK robustness | **BELOW TARGET** | Suite exists, regression-gated. SEVERE renderings share one mechanism: whole-canvas statistics (Otsu, tone) applied locally. Blocker: needs region-local statistics, a detector redesign not yet measured safe (entry J). |
| 11 | audit durability | **DONE** | Entry D. |
| 12 | schema migration registry | **DONE** | Entry F. |
| 13 | write ordering / atomicity | **DONE** | Entry E. |
| 14 | security / privacy | **DONE** | Entry O; five suites. |
| 15 | accessibility | **DONE** | Entry P; four suites. A real screen reader: **NOT VERIFIED**. |
| 16 | no native confirm/prompt | **DONE** | 9 + 2 → 0 (entry R). |
| 17 | toast system | **DONE** | Entry S. |
| 18 | localization | **DONE** | Entry T. |
| 19 | resilience | **DONE** | Entry Q; four suites. |
| 20 | first-run onboarding | **DONE** | Entry U. |
| 21 | provenance inspector | **DONE** | Entry V. |
| 22 | readiness timeline | **DONE** | Entry W. |
| 23 | Live Event UX | **DONE** | Entry X; plus `3f860a0` — the door search finds "yilmaz" and "ROSSI" (it did not). |
| 24 | Floor Plan UX | **DONE** | Entry Y. |
| 25 | visual quality | **DONE** | Entry Z. |
| 26 | performance | **DONE** | Entry AB. |
| 27 | CI release gates | **DONE** | Entry AA. |
| 28 | coverage discipline | **DONE** | Entry AC. |
| 29 | security + a11y + resilience suites exist | **DONE** | 5 + 4 + 4, in `npm test`, in CI. |
| 30 | documentation health | **DONE** | Counts re-measured with their commands (`311fed7`); this file replaces the contradicting old matrix. |
| 31 | third real plan | **NOT AVAILABLE** | None supplied. Procedure ready; nothing called cross-venue verified. |
| 32 | real operator session | **NOT VERIFIED** | Kit complete for §32's list, incl. Session C (16 cards, SYNTHETIC guest list) and the second round (`311fed7`). No session has happened. |
| 33 | SQLite / desktop | **DEFERRED BY EXPLICIT EXE GATE** | Storage boundary and migration design kept; no runtime, no package, no technology chosen. |
| 34 | commit discipline | **DONE** | One change per commit, characterization committed before each move. One commit (`650b60d`) broke a suite; the gate caught it before push and `32da994` fixed it — nothing was pushed red. |
| 35 | final validation | **DONE** | Table above. |
| 36 | final quality review | **DONE** | Below, with the release-quality-director cross-check. |
| 37 | this matrix | **DONE** | |
| 38 | final response | **DONE** | |
| — | PR #5 merged | **NO** | By instruction. |
| — | EXE | **BLOCKED** | Until **EXE YAP**. |

---

## §36 — the seventeen dimensions

START scores are **retrospective**: no score was recorded at `02edac7`, so
each is the score the skill's own rules give the measured starting state
(e.g. "zero suites" caps a dimension at 5). FINAL scores follow the evidence
and were cross-checked independently (below); the cross-check may only
downgrade.

| # | dimension | START | FINAL | status | evidence (command / suite) | why not 10 (or why below 9) |
|---|---|:-:|:-:|---|---|---|
| 1 | Business / domain correctness | 7 | **9** | DONE | `guest-and-seating-rules`, `pax-invariant`, `historical-immutability`, `physical-logical-seat-separation`, `xlsx-contract`, `writer-transitions`, `assignment-writer` (one writer for `guest.assignment`, static) | The structural one-writer assertion covers `guest.assignment` only, not every domain fact |
| 2 | Test discipline | 7 | **8** | BELOW TARGET | `npm run test:all` 104 suites / 3,289 checks at `f34b855`; mutation proofs per move | Documentation, performance timings and desktop readiness have no suite that fails when they regress — the 9 condition |
| 3 | Architecture / modularity | 7 | **8** | BELOW TARGET | four structural suites; detector a 221-line orchestrator over 7 stage modules; rules out of screen code (steps 3a–6) | `app-v8.js` 6,874 lines (29.9% of `src` bytes) and `plan-intelligence.js` 1,927 exceed the ~1,500 bar. Blocker: screen builders read helpers closure-scoped in the app-v8 IIFE; moving them needs those helpers published as globals (forbidden) or an injected-context redesign of every screen |
| 4 | Data integrity / storage | 7 | **9** | DONE | `schema-registry`, `schema-migration`, `save-ordering`, `transaction-atomicity`, `audit-durability`, `backup-restore`, persisted-data fault suites | Corruption is handled per tested shape; the table-availability fields have no save→reload round trip of their own |
| 5 | Offline | 9 | **9** | DONE | `verify:offline` 27/27 on both built artifacts, off-origin requests aborted | The folder build's source completeness is not asserted the way the light build's is |
| 6 | Performance | 6 | **7** | BELOW TARGET | `npm run perf`: median + p95 over repeated runs at stress size (entry AB) | No budget exists, so no run can fail on a timing (entry AB says so); XLSX 50k-row and 40-page PDF never measured |
| 7 | AI honesty | 8 | **9** | DONE | `plan-detection-boundary` (`trainedModel:false`); `i18n-hardcoded-english` now fails on any string calling the detector AI, every key, both languages (`fb8238e`) | Was 7 at the cross-check — three review-screen strings said "AI"; fixed. The area name "Teach AI" still carries the word |
| 8 | Plan intelligence reliability | 5 | **7** | BELOW TARGET | adversarial `--compare` (§35), `KNOWN-FAILS.json`, `benchmark:memory`, `false-positives` | `a2`, `a6` FAIL; identity wrong-application 0.042 vs 0.01; whole-canvas statistics. Blocker: no measured fix exists, thresholds may not be lowered, and the a6 theories and photometry rows were measured only without OCR |
| 9 | UI / UX quality | 6 | **8** | BELOW TARGET | 0 native dialogs; rendered sweep at 1920/2560/1440 (entry Z); counted core tasks (entry Y) | Entry Z's bulk "Add Manually" finding is open (Seating opens with most tables off-screen until Fit); no suite shows loading states |
| 10 | Accessibility | 3 | **9** | DONE | `a11y-scan`, `a11y-dialog-focus`, `a11y-keyboard-workflows`, `a11y-announce-contrast` | A real screen reader: NOT VERIFIED |
| 11 | Localization | 7 | **9** | DONE | `i18n`, `i18n-key-integrity`, `i18n-hardcoded-english` (static + rendered walk, both languages) | TR-first rendered verification is a sweep, not a standing gate at every viewport |
| 12 | Error handling / resilience | 4 | **8** | BELOW TARGET | four resilience suites (entry Q) | "Read-back differs" and "save during unload" have no suite of their own — the 9 condition is every listed mode |
| 13 | Documentation | 6 | **7** | BELOW TARGET | counts re-measured with commands (`311fed7`); the two contradictions the cross-check found fixed (`fb8238e`); old matrix replaced | No check fails when a documented figure drifts, and the cross-check found two contradictions this pass had missed — the rest are not proven absent |
| 14 | CI / automation | 4 | **9** | DONE | `ci.yml` classified INFO / WARNING / RELEASE GATE; adversarial FAIL gate; no `continue-on-error` on a gate (entry AA); CI read job by job on the final head | "Green ⇒ every release gate passed" is documented, not machine-checked |
| 15 | Security / privacy | 5 | **8** | BELOW TARGET | `hostile-input`, `html-sink-inventory`, prototype pollution, `malformed-import`, privacy scan | The 9 condition names Teach AI input; `hostile-input` covers no Teach Area lesson field. Not CSP-ready: 1 inline script, 66 inline styles (0 inline handlers, guarded) |
| 16 | Desktop readiness | 5 | **5** | DEFERRED BY EXPLICIT EXE GATE | `DESKTOP-READINESS.md`, `SQLITE-MIGRATION-DESIGN.md` (stale line corrected `fb8238e`) | Design documents only, which the skill caps at 5; nothing beyond design is allowed before EXE YAP |
| 17 | Real-world validation | NOT VERIFIED | **NOT VERIFIED** | NOT VERIFIED | operator kit incl. Session C; human test contract | No real operator session; no third real plan |

### The cross-check

The `release-quality-director` agent reviewed the proposed table read-only
(no test runs) and **downgraded 8 of 17 rows**; every downgrade above is
theirs, accepted. The one row restored is AI honesty: the cross-check's reason
— three review-screen strings calling the classical detector "AI" — was a real
defect, fixed and pinned in `fb8238e` before this table was final. The
cross-check also corrected four START scores (2, 3, 7, 16) and found two stale
documentation statements, fixed in the same commit.

**Eight technically controllable dimensions remain below 9** (2, 3, 6, 8, 9,
12, 13, 15). The programme's target was ≥ 9 for all of them; it is not met,
and each row says what stands in the way. None was raised by moving a bar.
