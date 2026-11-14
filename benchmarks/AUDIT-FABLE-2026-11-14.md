# Independent audit — MERIT EVENT MAKER — 2026-11-14

Branch `claude/merit-concept3-plan-intelligence-rebirth`, tip `3653e10`, tree clean. Read-only; nothing edited, committed, trained or built.

**The worst things first.**
- **An honest 9 overall is not reachable from inside this repository.** Plan reading and AI models have exactly one unseen real-plan measurement, and it failed its bar (Golden 2: 85 % tables, 72 % chairs against ≥ 0.95). The programme's own contract caps both until new unseen plans exist; that evidence is excluded from this plan, and I will not lower the bar.
- **Five keyboard-focus defects recorded on 2026-11-08 are still open.** I reproduced all five today.
- **The committed release report says NOT READY.** It is dated 2026-11-01, from another branch, with 12 of 18 gates NOT RUN.
- **No full `test:all` is recorded on the current tip.** The last recorded full run is 2026-11-12 (194/196); seven source commits have landed since.

**What I ran this session.**
- `node tests/run.mjs doc-drift dependency-direction`: 2/2 suites, 21/21 checks.
- Playwright Chromium renders at 1920×1080, 2560×1440 and 1440×900, default theme, Turkish, six screens plus the Mimar panel. No page errors, no sideways scroll.
- A keyboard-focus probe at 1440×900.
- Static measurements with `wc`, `grep` and `git`, and a read of the raw result files.

**Not verified (CPU held by the training job, no network).** `npm test`, `test:all`, every benchmark, both offline builds, `verify:offline`, CI status on the tip, dark mode and themes B–E, English renders. Scores resting on those are capped below 9 by the anti-inflation rules.

**Excluded, noted once.** Owner-personal tests and tests on new real plans are not counted against any dimension and are not in the plan.

Shots: `/tmp/claude-0/-home-user-MERITEVENTMAKER/7b41f49a-1109-57da-b022-838b2499b2be/scratchpad/audit/shots/`

---

## (a) Scores

| # | Dimension | Score | Verdict | Evidence | What is missing for 9 |
|---|---|---|---|---|---|
| 1 | Code health | **7.5** | PARTIAL | `app-v8.js` 1,342 lines / 107 KB; 138 scripts; 205 suites; `dependency-direction` 13/13 this session | Full gates on the tip; 57 unreachable pre-v8 bodies and 54 overrides; 299 lines over 300 characters |
| 2 | Data integrity | **8** | PARTIAL | `src/schema-migrations.js` (chain, FUTURE refusal), `src/shell-storage.js` (quarantine, unload journal), `server/disk-backup.mjs`; suites exist, not run by me | No multi-tab guard; no backup checksum; persistent storage never requested; training crops in backup unverified |
| 3 | UI/UX | **6.5** | PARTIAL | Rendered at three viewports this session | Five focus defects; text under 12 px on every screen; plan not fitted at 2560 and 1440; redesign unfinished |
| 4 | AI models | **5.5** | PARTIAL | `training/README.md` verdicts; manifests pinned by sha256 | Second look wired for one question only; every recent candidate not shipped; no passing unseen-venue result |
| 5 | Verbal intelligence (Mimar) | **6.5** | PARTIAL | `r2-bars.json`: `pass:false`, 0 wrong changes | Two bars failed; exam sets of about 20 sentences, developer-written; how-to 0.60; raw results not committed |
| 6 | Plan reading | **5.5** | PARTIAL | `benchmarks/plans/blind/README.md`; `benchmarks/BASELINE.json` | Golden 2 failed unseen; two adversarial FAILs accepted; no fresh benchmark report |
| 7 | Enterprise readiness (EXE excluded) | **7** | PARTIAL | `.github/workflows/ci.yml` (no `continue-on-error` on a gate), `scripts/release-report.mjs`, offline CSP `default-src 'none'` | Stale NOT READY report; 15 pre-trial rows without results; stale desktop docs |

**Overall: 6.6 / 10**, the equal-weight mean of the seven. I chose equal weights because no honest weighting trades a plan-reading miss against a focus defect; read the lowest rows (5.5), not the mean. The main session's own card on 2026-11-01 said about 6.8, so the two agree.

---

## (b) Findings per dimension, ranked by impact

### 1. Code health — 7.5
1. **The tip is ungated.** `benchmarks/CODE-HEALTH-2026-11.md` "Gate results at landing" records 194/196 on 2026-11-12. Since then `d35d4de`, `bfe3eca`, `139b556`, `89a0c64`, `8eca10b`, `463d21a` and `d37d9f5` changed `src/`, and `STATE.md` records no full run after them.
2. **The override layer remains.** `app-v8.js` holds 54 `name = function` reassignments of pre-v8 globals. `benchmarks/CODE-INVENTORY.md` (re-measured 2026-11-11) counts 57 unreachable pre-v8 bodies still in `src/app.js` and `src/app-guests.js` (1,521 lines together).
3. **Line count understates size.** `app-v8.js` averages 79 characters a line with a longest line of 1,756; `app.js` has one of 3,172. Across `src/`, 299 lines exceed 300 characters and 56 exceed 600.
4. **Coupling was moved, not removed.** `src/review-commands.js:613` lists 29 injected dependencies; the report counts 313 across 24 modules.
5. **`app-v8.js` grew back** from 1,278 to 1,342 lines in two days; the residue named in the report is still there.
6. **The suite is not reliable under load.** Runs of 169/170, 178/179, 192/194 and 194/196 are each explained as timeouts; "seen while moving" item 27 says "the gate under shared CPU is not a gate."
7. **What is good:** the decomposition is real, documented before it moved, with fingerprint 28/28 and byte-identical workbook recorded; structural suites exist and the one I ran passes.

### 2. Data integrity — 8
1. **No multi-tab protection.** `grep` finds no `BroadcastChannel`, `navigator.locks` or `storage` listener in `src/`. Two tabs on one store are last-write-wins. `storage-provider.js:40` only handles a blocked open.
2. **Backups carry no checksum.** `data-portability.js`, `event-package.js` and `disk-backup.js` validate shape only; a truncated but well-formed file is not detected.
3. **Persistent storage is never requested.** `navigator.storage.estimate()` is read in `diagnose-report.js:48` and `screen-settings.js:107`; `persist()` is not called, so the browser may evict.
4. **Training crops in backups are unverified.** `benchmarks/desktop/AUTO-UPDATE-PLAN.md` §3 itself says "to verify on gate day".
5. **The migration chain has one step** (8→9, `schema-migrations.js:60`), so it has barely been exercised.
6. **What is good:** version is read, not stamped; a newer record opens read-only; unreadable records are quarantined; disk backup writes are atomic with rotation.

### 3. UI/UX — 6.5
1. **Five keyboard-focus defects are open** (`benchmarks/A11Y-KEYBOARD-2026-11.md`, reproduced today):
   - New event opens with focus on `BODY`.
   - Esc on the new-event screen does nothing.
   - Creating an event leaves focus on `BODY`.
   - Enter on a top-bar tab leaves focus on `BODY`.
   - F8 then Esc leaves focus on `BODY`.
2. **Text under 12 px on every screen**, against the 12–14 px rule:

   | Screen | Sizes found (elements) |
   |---|---|
   | Etkinlik/Hazırlık | 8.5 px ×10, 9 px ×5, 9.5 px ×13 |
   | Oturma | 8 px ×12, 11 px ×25 |
   | Kapı | 9.5 px ×12 |
   | Salon | 11 px ×23 |
   | Raporlar | 11–11.5 px ×49 |

   Some of the smallest are labels on the drawn plan; the toolbar captions and panel text are not.
3. **The plan is not fitted to the viewport.** At 2560×1440 the Salon room fills roughly the top-left 60 % × 27 % of the canvas. At 1440 the Oturma room is cut by the right panel at the default 92 % zoom.
4. **Two tabs look active.** The "next step" tab is bold blue (weight 700) while the current tab is weight 500 with `aria-current`. On Misafirler and Raporlar the next tab reads stronger than the page you are on.
5. **The redesign is unfinished.** `STATE.md` 2026-11-13: branch `redesign-v4-product` is not merged, theme A is faithful on three screens only, and owner decisions are pending.
6. **What is good:** restrained palette, no gradients or card wall, real empty states, zero page errors.

### 4. AI models — 5.5
1. **The local second look is wired for one question, `merged`** (`tools/local-vlm/manifests/qwen3.5-0.8b-merit-b6d.json`, `checks:["merged"]`). Identify, chairs and count failed their bars across B6b–B6e.
2. **Every recent candidate was not shipped.** Detector v5-s lost column recall (0.691 → 0.576) and its real benchmark was never run; runS failed zone and chairs (README, verdict of 2026-11-14).
3. **Detector v2 is synthetic-only.** Two cross-venue folds exist; foldB made Golden worse (`benchmarks/offline-intelligence/README.md:139`).
4. **The standing rule of 2026-11-14 ships below-bar candidates.** It is recorded honestly as an override, but "shipped" no longer means "passed".
5. **What is good:** bars are pre-registered, failures are written as failures, bytes are pinned, synthetic is labelled synthetic. Process honesty is about 9; capability is not.

### 5. Verbal intelligence (Mimar) — 6.5
1. **Shipped r2 fails two pre-registered bars:** enmulti12 0.90 (< 0.95) and Turkish briefs all-right 0.95 (< 0.975). I checked the README table against `r2-bars.json`; they match.
2. **Its raw results are not in git.** They exist only under `$S/race/geq/` on this machine; the committed `assistant-race/geq/` holds p08 and p2b only.
3. **The exam sets are small and developer-written.** At about 20 sentences a set, one sentence is 5 points; the same session wrote grammar and exams.
4. **Other measured weak spots:** how-to 0.60, English briefs all-right 0.80, entypo10 0.778, median 4.4 s on four cores.
5. **Scope is narrower than the name.** It no longer chats (`d37d9f5`: one fixed answer). In the plain browser build the panel says "yalnız kurallar"; voice shows "yakında".
6. **What is good:** 0 wrong changes on every set; act-or-ask threshold 0.91; every action previewed with one undo.

### 6. Plan reading — 5.5
1. **The only unseen result failed.** Golden 2 exam, 2026-10-31: 23/27 tables, 49/68 chairs seated, 20 loose, 0 phantom tables. `ACCEPTANCE.md` asks ≥ 0.95 for both.
2. **Golden 2 is now SEEN.** After fixes it reads 25/27 and 57/68; T05/T06 and four phantom loose chairs remain open.
3. **Golden and ORNEK are regression sets.** 46/1/0 and 166/1/0 show nothing got worse, not that new venues work.
4. **Two adversarial fixtures fail and are accepted in writing:** a2 (3 real tables held back, recall 0.571) and a6 (21 phantom proposals).
5. **No fresh measurement.** `BASELINE.json` dates from 2026-10-18 and the local `benchmarks/reports/latest.json` from 2026-10-27, both older than the detector changes of 2026-11-01. Not re-measured this session.
6. **Built but not wired:** `src/plan-zone-number-check.js` has a suite and no caller.

### 7. Enterprise readiness — 7
1. **`benchmarks/RELEASE-REPORT.md` is stale and NOT READY** (commit `add9d2b` on `claude/par-release`).
2. **CI green on the tip is NOT VERIFIED** (no network this session).
3. **`tools/local-vlm/windows/PRE-TRIAL-CHECKLIST.md` has 15 rows and no recorded results.** The package has only been simulated on Linux.
4. **Documents contradict each other.** `tests/README.md:5` and `.claude/rules/testing.md:7` say `npm test` takes about 2 minutes; `CLAUDE.md` says about 25 and `ci.yml` measured 27 min 50 s. `DESKTOP-READINESS.md` and `SQLITE-MIGRATION-DESIGN.md` date from 2026-10-03, before the relay, local models and disk backup.
5. **`npm run serve` exited immediately twice here.** `tests/lib/server.mjs:86` calls `server.unref()` and `tests/serve.mjs` holds nothing else open.
6. **Inline styles keep the CSP loose.** `style-src-attr 'unsafe-inline'` stays in both policies; 74 inline style attributes are inventoried.
7. **No lint or format gate; `npm ci --no-audit` in every job.**
8. **What is good:** five CI jobs plus a release-report job, `ci-gate-honesty`, secret scan, hostile-input, privacy, accessibility, i18n and resilience suites, a guest-free diagnostic report.

---

## (c) EXE readiness checklist (not scored; gate closed)

"EXE YAP" has not been typed. Source: `benchmarks/desktop/AUTO-UPDATE-PLAN.md`.

| Item | State | Gap |
|---|---|---|
| Gate phrase and "açık depo tamam" | Missing | Nothing may start |
| Four gates green on a free CPU | Not done on tip | Training job holds the CPU |
| Electron main/preload, `contextIsolation`, sandbox, fixed `app://` origin | Plan only | No code, no security suite |
| NSIS per-user build, no admin, Turkish/space paths | Plan only | Needs a Windows runner |
| `SQLiteStorageProvider` plus import step | Design from 2026-10-03 | Stale; no round-trip test |
| Relay as utility process, llama-server and whisper spawn, watchdog | Exists as `.cmd` + bundled `node.exe` | Not ported |
| CPU variants (AVX2/AVX/SSE), Vulkan with CPU check | Checklist row 1 | No result recorded |
| Component manager, `components.json`, sha256 pins | Plan only | Plan names `comp-chat-q08`; shipped model is r2 |
| Auto-update: electron-updater, ed25519 manifest, busy guard, rollback | Plan only | No key pair, no public repo, no tests |
| Pre-update backup; training crops in backup | Unverified | §3 says verify first |
| Signing / SmartScreen | Option A (unsigned) recommended | Owner decision; BENIOKU picture unchecked |
| Peak RAM under 8 GB; 8-hour soak | Not measured | Moved to this stage |
| `LICENCES/` for every shipped part | Partial (`runtime/licenses`) | Shipped parts not listed against files |
| Release workflow on `windows-latest`; v1.0.0 → v1.0.1 update proof on a clean VM | Plan only | — |

Thirteen ordered steps against a target of 2026-11-15 evening is not realistic in my judgement.

---

## (d) Work plan

**Honest ceiling.** With every item below done and proven, I estimate:

| Dimension | Today | After the plan |
|---|---|---|
| Code health | 7.5 | 9 |
| Data integrity | 8 | 9 |
| UI/UX | 6.5 | 8.5–9 |
| Enterprise | 7 | 9 |
| Mimar | 6.5 | about 7.5 |
| AI models | 5.5 | about 6.5 |
| Plan reading | 5.5 | about 6.5 |
| **Overall** | **6.6** | **about 8.1** |

The remaining gap is exactly the excluded evidence. No item below pretends otherwise, and none lowers a bar.

Points are on the dimension; divide by 7 for the overall. Items 1–16 are strictly necessary for the four dimensions that can reach 9.

**Strictly necessary**

1. Run `npm run test:all`, both offline builds and `verify:offline` on the tip with the trainer paused; record results in `benchmarks/CODE-HEALTH-2026-11.md`.
   Proof: the four exit codes and suite counts. Code +0.5, Enterprise +0.3. S.
2. Let CI produce the release report on the tip and commit it over `benchmarks/RELEASE-REPORT.md`.
   Proof: the report's commit hash equals the tip and the verdict line. Enterprise +0.5. S.
3. Focus the name field when new-event opens and make Esc cancel it (`src/screen-setup.js`).
   Proof: two new checks in `a11y-dialog-focus`, failing first. UI +0.4. S.
4. Restore focus to the same `data-tab` control after a tab change and after event creation (one helper in `src/shell-focus.js`, called from `render`).
   Proof: new checks in `a11y-keyboard-workflows`, failing first. UI +0.5. S.
5. Remember the focused element before F8 and return to it on close (`src/screen-assistant.js`).
   Proof: new check in `assistant-panel`, failing first. UI +0.2. S.
6. Raise every non-canvas text rule below 12 px to 12 px (`src/styles.css`).
   Proof: a `viewport-matrix` check that no text outside `.plan-canvas` computes under 12 px on six screens × three viewports. UI +0.5. M.
7. Fit the room to the canvas on first open of Salon, Oturma and Kapı (`src/floor-plan-view.js` fit function).
   Proof: a `viewport-matrix` check that the room box is inside the canvas and at least 70 % of its smaller side at all three sizes. UI +0.4. M.
8. Style the current tab stronger than the next-step tab (`.shell-nav-item.active` / `.next` in `src/styles.css`).
   Proof: a `shell-topbar` check that the active tab's computed weight ≥ the next tab's. UI +0.2. S.
9. Make a second tab read-only with a notice, using `navigator.locks` (`src/storage-provider.js`, `src/storage-notice.js`).
   Proof: new suite `multi-tab-guard`: two pages, second cannot save, first loses nothing. Data +0.4. M.
10. Write a sha256 into every backup and event package and refuse a mismatch (`src/data-portability.js`, `src/event-package.js`, `server/disk-backup.mjs`).
    Proof: `backup-restore` and `disk-backup-server` checks with one flipped byte, failing first. Data +0.3. M.
11. Call `navigator.storage.persist()` at boot and show the answer in Ayarlar (`src/shell-storage.js`, `src/screen-settings.js`).
    Proof: a `storage-provider` check with the permission granted and denied. Data +0.1. S.
12. Assert that a backup carries the IndexedDB `blobs` store and restores it (`src/data-portability.js`).
    Proof: a `data-portability` round-trip check with one captured crop. Data +0.2. S.
13. Delete the 57 unreachable pre-v8 bodies and their `original` capture entries (`src/app.js`, `src/app-guests.js`, `src/app-v8.js`).
    Proof: `tests/lib/reachability.mjs` dead set = 0, `boot-contract`, then item 1's gates. Code +0.5. L.
14. Reflow every `src/*.js` line over 300 characters (except `i18n.js`) and add a suite that fails on a new one.
    Proof: new suite `line-length`; detector fingerprint 28/28 and workbook dump identical. Code +0.3. M.
15. Move the residue named in the code-health report ("What app-v8.js holds now") out of `app-v8.js` into its owning modules.
    Proof: `screen-modules`, `boot-contract`, `screen-console-sweep`; `wc -l` under 900. Code +0.2. M.
16. Correct the "~2 minutes" figures in `tests/README.md` and `.claude/rules/testing.md`, the `CLAUDE.md` line count, and rewrite `DESKTOP-READINESS.md` for the relay and models; add those figures to `doc-drift`.
    Proof: `doc-drift` fails on the old text and passes on the new. Enterprise +0.4. S.

**Raise the capped dimensions as far as is honest**

17. Commit the r2 and q08 raw results (`r2-bars.json`, `r2z.json`, briefs) to `benchmarks/offline-intelligence/assistant-race/geq/` and name them in the r2 manifest's `evidence`.
    Proof: a `chat-model-pinned` check that the evidence files exist and say `pass:false`. Mimar +0.3. S.
18. Raise the how-to matcher from 0.60 on the race's help row by fixing `src/help-topics.js` matching against the committed dev set only.
    Proof: `node training/help/score.mjs` on a newly frozen held-out file, hash committed before the change. Mimar +0.4. M.
19. Wire `src/plan-zone-number-check.js` into the review screen (zone as an Accept suggestion, number as a CHECK flag).
    Proof: `zone-number-check` plus one browser check in `review-decisions`. Plan reading +0.3. M.
20. Run `npm run benchmark`, `benchmark:baseline` and `benchmark:adversarial -- --compare` on the tip and commit `benchmarks/reports/latest.json`.
    Proof: the report's source hash equals the tip. Plan reading +0.4, AI +0.3. S.
21. Add the proposed narrow text rule for T05/T06 (round-glyph word spanning two table candidates) in `src/plan-detection-refine.js`.
    Proof: a new suite failing first; a2 phantom count unchanged; baseline no regression; fingerprint diff listed. Plan reading +0.3. M.
22. Add a suite asserting every manifest's `checksEvidence` file exists and matches the wired `checks`.
    Proof: the suite fails when one evidence path is removed. AI +0.3. S.

**Enterprise completion**

23. Hold the process open in `tests/serve.mjs` until SIGINT.
    Proof: a `smoke`-level check that the process is alive and answers after 3 s. Enterprise +0.1. S.
24. Move the 74 inline style attributes to classes and drop `style-src-attr 'unsafe-inline'` from both CSPs.
    Proof: `csp-readiness` inventory = 0 and `csp-policy` green. Enterprise +0.4. L.
25. Record results for the pre-trial rows checkable on Linux (rows 5, 6, 11, 12, 13) in `PRE-TRIAL-CHECKLIST.md`.
    Proof: each row names the suite or command and its output. Enterprise +0.3. M.
26. Add an `npm audit --omit=dev` INFO step to `ci.yml` and classify it in `merit-ci-quality-gates`.
    Proof: `ci-gate-honesty` passes with the new row. Enterprise +0.1. S.
