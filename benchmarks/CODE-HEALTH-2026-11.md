# Code health 2026-11 — decomposing `app-v8.js` to the end

Owner, 2026-11-08: "Kodu önceden parçalamayı denedin, adam gibi
parçalayamamıştın; bu sefer hallet, bitsin." and "Hiçbir şey kaybolmasın,
hata vermesin."

This file is written BEFORE the code moves. It states the end state, the list
of capabilities in the order they move, what each move must prove, and a
running list of anything suspicious seen on the way. The progress line in
`.claude/STATE.md` reads "N of M capabilities moved, app-v8.js X lines".

## The end state

`src/app-v8.js` holds **boot + state + render dispatch** and nothing else:

- the boot sequence (load, migrate, first render) and the `state` root's
  primitives that every writer shares: `touchEvent`/`mutationEpoch`,
  `canMutate`, `audit`, `activeEvent` wiring;
- the override layer: the `original` capture and one-line reassignments of the
  pre-v8 globals (`name = function(...a){return MODULE.name(...a);}`), which is
  why it is the LAST classic script — this does not move, at any point
  (MODULARIZATION-ORDER Step 6, A26);
- the `create(deps)` call of every module, in boot order, handing each one what
  it reads — shell functions as late-binding wrappers, reassigned bindings as
  `getX()`/`setX(v)`;
- `render()` / `renderScreen()` / `renderFailure()` and the shell bar binding.

Every business capability or screen is its own classic script that publishes
ONE `globalThis.Merit*` object made by `create(deps)` (`screen-modules` holds
the contract: every identifier it uses is declared in it, handed to it, or a
browser built-in), with a suite that exercises its behaviour.

Not in the end state, and not to be done: ES modules, a bundler, a reordered
`<script>` list, a framework, a rewrite. A shadowed pre-v8 body in app.js /
app-guests.js stays where it is (CODE-INVENTORY §1.2: deleting them breaks the
app; `boot-contract` proves at runtime that each override resolves to v8's).
The ownership map, inventory and order are re-measured after the last move.

## How every move is made (and what it must prove)

The tool is `scripts/extract-capability.mjs` — a SCOPE-AWARE parse (acorn),
not grep and not a flat scanner. For a line range it prints every crossing:

- **DEPS** — every name the region reads and does not bind, resolved to where
  it is bound (app-v8.js's IIFE, or app.js/app-guests.js's global scope). Each
  becomes an injected dependency; a binding that is ever reassigned at a file's
  top level goes over as `getX()` (and `setX(v)` if the region writes it).
- **GLOBALS** — `globalThis.Merit*` objects the region reads; rewritten to
  `globalThis.Name`, which is what the bare name resolved to.
- **INWARD** — names the region binds that the rest of app-v8.js reads; they
  become members of the one published object, read as `MODULE.name` at every
  use site (never a local alias).
- **OVERRIDE** — `name = function(...)` reassignments of a pre-v8 global; the
  body moves, app-v8.js keeps the reassignment as a one-line delegate.
- **REFUSED** — anything it cannot do safely (a compound write to a shell
  binding, an inward `let` that is reassigned, a shell `const` declared below
  the cut): the move is redesigned by hand, never guessed.

The region runs inside `create(deps)` at its original indentation, and
`create()` is called where the region stood, so its top-level statements run at
the same moment of boot as before.

Per move, in order:

1. Crossings printed and read (dry run). Every declarator counted — the tool
   reads `VariableDeclaration.declarations`, all of them.
2. The suites that own the behaviour named; if none would fail when the moved
   code breaks, a characterization check is written first and mutation-proven.
3. The move. Then: every function in the region compared byte-for-byte with
   its moved text modulo the printed rewrites; `screen-modules`,
   `boot-contract`, `override-boundary`, `dependency-direction`,
   `offline-bundle-contract` and the owning behaviour suites.
4. For a step touching guests/tables/seats/reports: the workbook (TABLE PLAN /
   GUEST LIST / UNASSIGNED) exported before and after and diffed sheet by
   sheet (`xlsx-contract`, `export-contract-privacy`).
5. Every screen opened in both themes, console errors collected.
6. The four gates: `npm run test:all` · `npm run build:offline` ·
   `npm run build:offline-full` · `npm run verify:offline`. A red gate stops the
   programme until that step is fixed or reverted; nothing red is pushed.
7. Counts updated (`.claude/rules/code-health.md`, the doc-drift figures),
   commit (refactor only, no feature work), push, STATE line.

## The capabilities, in the order they move

Line numbers are app-v8.js at `1aa928f` (5,634 lines) and drift after every
move; the tool is always re-run on the current file.

| # | Capability (map area) | app-v8.js lines | Target | Suites that own the behaviour |
|--:|---|---|---|---|
| 1 | Guest finder panel — results, actions, keys (A10 UI) | 1247–1375 | `src/screen-finder.js` | guest-finder, guest-search-typos, a11y-keyboard-workflows |
| 2 | Event setup & plan-file intake (A09) | 1068–1221 | `src/screen-setup.js` | plan-file-dialog, pdf-text-layer, duplicate-layout, first-view-and-busy, no-sample-specific-runtime-logic |
| 3 | Guest record removal / restore / unassign undo (A21) | 2312–2410 | `src/guest-record-undo.js` | undo-operations, guest-and-seating-rules, assignment-writer, historical-immutability |
| 4 | Freeze zones & group assignment (A16 + A17) | 1986–2163 | `src/seating-commands.js` | seating-freeze, guest-groups, assignment-writer, smart-seating, seating-rules |
| 5 | Service load panel (A15) | 1926–1985 | `src/service-load-panel.js` | service-load |
| 6 | Arrival & availability writers, the announcer (A19) | 2200–2270 | `src/arrival-writer.js` | writer-transitions, arrival-wave, table-availability, a11y-announce-contrast |
| 7 | Floor-plan editing: bulk add, canvas object lifecycle (A12) | 1389–1471, 1632–1867 | `src/floor-plan-editing.js` | bulk-add-integrity, floor-plan-modes, structural-objects, undo-operations |
| 8 | Layout-change panel (A11 UI) | 1528–1631 | `src/screen-layout-changes.js` | layout-changes |
| 9 | Empty states (§20) | 1473–1527 | `src/empty-states.js` | empty-states |
| 10 | Event health readers: Plan Doctor report, readiness, final check, plan issues, provenance (A04/A08 adapters) | 644–1010 (parts) | `src/event-health.js` | plan-doctor, risk-radar, command-center, readiness-timeline, table-provenance |
| 11 | Onboarding callouts (A05) | 782–825 | `src/onboarding-panel.js` | onboarding |
| 12 | Handover notes & audit-trail text (A06 + A07) | 834–931 | `src/event-log-panel.js` | event-handover, audit-trail, audit-durability |
| 13 | Plan memory & training-data capture (A23) | 2605–2838 | `src/plan-learning.js` | plan-memory, plan-memory-isolation, training-data-capture |
| 14 | Detection refinement stages: visual second opinion, text suppression, labelled objects, overlapping tables, venue elements, chair facing, find similar | 2849–3452 | `src/plan-detection-refine.js` | visual-second-opinion, text-suppression-evidence, overlapping-tables, plan-venue-elements, chair-facing, find-similar + `benchmarks/detector-fingerprint.mjs --compare` |
| 15 | Plan text before Analyse, printed table numbers | 3453–3582 | `src/plan-text-intake.js` | analysis-prefetch, plan-table-numbers, plan-label-ocr |
| 16 | Plan checks & the Teach Area (A23) | 3583–3869 | `src/plan-teach.js` | plan-number-integrity, plan-self-check, plan-confidence-budget, plan-teach-area, teach-number, teach-venue-scope, teach-lesson-lifecycle |
| 17 | The analysis run and Stop | 3870–4337 | `src/analysis-run.js` | critical-paths, analysis-workers, resilience-engines, first-view-and-busy + fingerprint |
| 18 | Review decisions, commit, dataset export, review binding (A24) | 4338–5119 | `src/review-decisions.js` | review-decisions, review-queue, confirmed-chair-coordinates, vlm-decisions, training-data-capture |
| 19 | Persistence, unload journal, storage notice (A01) | 13–580, 5251–5330 | `src/shell-storage.js` | save-ordering, resilience-storage, offline-recovery, privacy-logs, schema-migration, transaction-atomicity |
| 20 | Static-dialog translation, toast wrap, loaders | 2433–2489 | `src/shell-i18n.js` | i18n, toast-discipline, native-dialogs |
| 21 | The guide, focus return, keyboard activation (A26 non-anchor part) | 5408–5634 | `src/shell-focus.js` | a11y-dialog-focus, a11y-keyboard-workflows |

**M = 21.** The order puts the presentation-only moves with strong suites first
(1, 2, 8, 9), the writers next (3, 4, 6 — each still the ONE writer, now in its
own file), the plan-intelligence chain after that (13–18, gated on the
detector fingerprint as well), and the shell's own persistence and focus last
(19–21), because they are the boot.

## Progress

app-v8.js line counts are `wc -l` after each move. Moves 8-21 were prepared on
the WIP branch (`origin/claude/code-health-wip`) and gated together on the tip
(see "Gates" below); the rows are in the order the moves were made.

| # | Moved in | Module (lines) | app-v8.js after |
|--:|---|---|--:|
| — | (start, `1aa928f`) | | 5,634 |
| 1 | Guest finder panel (+ `screen-console-sweep`, every screen in both themes) | `screen-finder.js` (181) | 5,509 |
| 2 | Event setup & plan-file intake | `screen-setup.js` (217) | 5,359 |
| 3 | Guest record removal/restore/unassign undo (workbook identical) | `guest-record-undo.js` (167) | 5,267 |
| 4 | Freeze zones & seating a party (workbook identical) | `seating-commands.js` (249) | 5,111 |
| 5 | Service-load panel | `service-load-panel.js` (93) | 5,056 |
| 6 | Arrival & availability writers, the announcer (workbook identical) | `arrival-writer.js` (108) | 4,989 |
| 7a | Floor-plan view: bulk-add fields and ghosts, fitting, viewport, frame | `floor-plan-view.js` (135) | 4,905 |
| 7b | Floor-plan editing: create/duplicate/delete, drag/resize/rotate, inspector, capacity, venues, canvas undo, canvas binding (workbook identical) | `floor-plan-editing.js` (307) | 4,699 |
| 8 | Layout-change mode | `screen-layout-changes.js` (154) | 4,603 |
| 9 | Empty states (§20) | `empty-states.js` (89) | 4,552 |
| 14 | Detection refinement stages (fingerprint 28/28 IDENTICAL) | `plan-detection-refine.js` (657) | 3,955 |
| 16 | Plan checks & the Teach Area | `plan-teach.js` (324) | 3,686 |
| 15 | The plan's text before Analyse, printed numbers | `plan-text-intake.js` (165) | 3,574 |
| 17 | The analysis run and Stop (fingerprint identical) | `analysis-run.js` (554) | 3,113 |
| 13 | Plan memory, visual embedding, training-data capture (fingerprint identical) | `plan-learning.js` (392) | 2,769 |
| 18 | Review commands: the decision writer, undo, Confirm, review drawing, dataset export, binding (fingerprint identical, workbook identical) | `review-commands.js` (614) | 2,249 |
| 11 | Onboarding callouts | `onboarding-panel.js` (73) | 2,215 |
| 12 | Handover notes & audit-trail text | `event-log-panel.js` (141) | 2,125 |
| 10 | Event health: Plan Doctor report, readiness, final check, plan issues | `event-health.js` (185) | 1,997 |
| 21 | Keyboard & focus; the User Guide | `shell-focus.js` (215), `shell-guide.js` (56) | 1,823 |

| 20 | The shell's language plumbing: static dialogs, toast wrap, loaders | `shell-language.js` (94) | 1,773 |
| 19 | Persistence (load, migrate, quarantine, unload journal, save) and the storage notice | `shell-storage.js` (485), `storage-notice.js` (135) | 1,278 |

**M = 21, moved = 21.** `app-v8.js`: 5,634 → **1,278** lines.

## Before / after

| | before (`1aa928f`) | after |
|---|--:|--:|
| `app-v8.js` lines | 5,634 | 1,278 |
| classic scripts in `index.html` (app-v8.js last) | 111 | 135 |
| modules created by app-v8.js with `create(deps)` | 15 | 39 |
| suites | 193 | 196 at landing (+ `screen-console-sweep`; the rest came with working-branch commits) |
| crossings named by the tool, over the 24 new modules | — | 313 injected dependencies, 101 names published (`MODULE.name`), 26 pre-v8 overrides kept as one-line delegates in app-v8.js (measured from each module's `DEPS` list and `return{…}`) |
| detector fingerprint, tip vs pre-move | — | 28 of 28 plans IDENTICAL |
| operational workbook (TABLE PLAN / GUEST LIST / UNASSIGNED), fixed scenario | — | byte-identical dump |

What app-v8.js holds now: the storage provider handle and the `original`
capture, the `ui` defaults, `blankRoot`, the state primitives (`audit`,
`canMutate`, `touchEvent`/`mutationEpoch`, `bootReady`, the module accessors),
every `create(deps)` call in boot order, the override layer's one-line
delegates, `render`/`renderScreen`/`renderFailure`, `bindV8Common`/
`bindShellBar`/`bindPlanDrop`, the boot (`STORAGE.loadV8Async().then(…)`), and
the shared pieces several screens read: `tableObjectHTML`, the freeze /
availability / provenance readers, `tableIndex`, `readonlyGuestsHTML`, the
seating "ready" chrome, the party/seat tag helpers, `toastAction`, the review
canvas helpers (`reviewCandidates`, `applyReviewZoom`, `candidateBox`,
`calibratedThreshold`, the model-grouping apply/undo), `openEvent`/
`duplicateEvent`, and the Floor Plan file input. Those are residue, named
here so the next pass starts from a list, not from a re-reading.

## Seen while moving

A running list — anything suspicious, even outside the step being made. Each
entry says what was seen and what was done about it.

1. **`boot-contract` caught a real load-time read in the walk-in work** (before
   any move): `occupancy.js` (loaded 7 scripts before `event-rules.js`) held
   `const RULES = () => globalThis.MeritEventRules;` at file level. The arrow
   is lazy, so it would have worked, but the rule exists because the same
   shape with an eager read is `undefined`. Fixed in the walk-in commit (read
   inside `placeLive`).
2. **A concurrent agent's English strings in `src/i18n.js` were swept into a
   commit** by `git add src/i18n.js` — caught before push, the commit amended to
   the five walk-in keys. From now: `git diff --stat <path>` before every add of
   a file another agent may edit.
3. **`.claude/rules/code-health.md` carries three overlapping drafts of the
   script-count sentence** (97 / 105 / 109 / 111, partly duplicated mid-
   sentence). Rewritten to one sentence with the count in move 1.
4. **`merit-maintainability-hardening` §0 still says `index.html` loads 34
   scripts** — a figure from the skill's first version (111 today). Not a doc-
   drift figure, so no suite catches it; replaced by the measuring command in
   move 1.
5. **`benchmarks/ux/walkin-noshow/walkin-ask-1920.png` was captured mid fade-in**
   of the `ask()` dialog (`@starting-style` opacity), so the question looks
   translucent behind the tables. The dialog is `showModal()` (top layer); not a
   stacking bug — the evidence shot is weak, not the UI.
6. **A No Show who arrives after a walk-in took the seat live shares the seat**,
   and nothing tells the door. Recorded as known in FEATURES-2026-11-07.md; a
   product decision, not a refactor.
7. **`html-sink-inventory` keys a sink by its enclosing function path**, so a
   function moved inside `create()` is listed as `create > name`. The finder's
   `box.innerHTML` entry moved with it (same trace, same evidence).
8. **No suite opened every screen in both themes.** `screen-console-sweep`
   (move 1) does; mutation-proven: dropping one injected name (`esc`) from the
   finder fails it with `TypeError: esc is not a function`.
9. **Another agent committed AND pushed on the shared branch between two of my
   commands**, so a `git commit --amend` in the main tree amended THEIR commit
   (caught before any push; undone with `git reset --soft` to their pushed
   commit, my change re-committed on its own). Their push also carried the
   walk-in commit to origin before its four gates had finished. From now: no
   `--amend` in the shared tree, ever; every move is prepared and gated in a
   separate worktree and lands with `git cherry-pick`.
10. **The calendar day's "+" (new event on that day) had no test** — it is the
    one place outside the setup screen that reached into the draft
    (`newEventDraft.date=…`). `events-calendar` now presses it (mutation-
    proven on the pre-move code), and the shell reads the draft through
    `SETUP.currentDraft()`.
11. **`readonlyGuestsHTML` (a historical event's guest list) sits between the
    tab dispatch and the setup screen** and belongs to neither; it moves with
    the Guests capability (#3's neighbour), not with setup.
12. **The shell-source scans read only `src/screen-*.js`** besides app-v8.js
    (`tests/lib/shell-sources.mjs`, and `boot-contract`'s own copy), so code
    that left the shell as a non-screen module — `data-portability.js`,
    `review-session-log.js` since 2026-11-01 — was invisible to
    `override-boundary`, `boot-contract`'s delegation count,
    `audit-durability` and `large-venue-scale`. Found when move 3 took
    `original.openGuestDialog(...)` with it and the delegation count dropped to
    11. Both now read every module created with `create(deps)` (the
    `screen-modules` predicate); all four suites green on the widened set.
13. **`toastAction` (the Undo toast) is used by four capabilities** (Live,
    guests, find-similar, the Teach Area) — a shell notification primitive, so
    it stays with `toast`, not with any one of them.
14. **`domain-writers` read its writers from app-v8.js and the screens only.**
    Move 3 had already taken `unassignGuest`/`restoreGuestRecord` (seating
    writers) out of its "every seating writer refuses a historical event"
    scan without any check failing — the scan still found ≥ 5 writers. Move 4
    made it visible (the freeze writers' allow-list named `app-v8.js:`). The
    suite now reads the shell plus every `create(deps)` module, its allow-list
    names `seating-commands.js:`, and the widened scan is mutation-proven
    (dropping `restoreGuestRecord`'s `canMutate` fails it).
15. **A shorthand `{setArrival}` in another module's `create()` above the cut
    is read at boot, before the new module exists.** Move 6's first run
    failed every browser suite with `Cannot access 'ARRIVAL' before
    initialization` (the Live screen's create call handed `recordArrival` and
    `setArrival` by value). Caught by the targeted suites before any commit;
    the tool now hands an inward FUNCTION over as a late-binding wrapper in a
    shorthand, as every other shell function already goes.
16. **`csp-readiness` keeps a per-file inventory of inline style attributes**
    and failed on the cumulative gate (moves 2 and 5 carried three of them
    out of app-v8.js — same count overall). The gate on the tip caught it, not
    the per-move targeted suites; the inventory now names `screen-setup.js` 2,
    `service-load-panel.js` 1, `app-v8.js` 8. From move 7 on, `csp-readiness`
    is in every move's targeted set. Same gate: `gala-night-scale`'s
    `checkInClick` p95 65.6 ms against a 65 ms budget (median 28.4) with three
    training chains on the CPU — a load effect on a path no move touched;
    re-run alone before landing.
17. **An override read at the region's top level captures the PRE-v8
    global** (`const oldViewport=canvasViewportHTML;` before
    `canvasViewportHTML = function…`). Turning the override into the module's
    hoisted function made that capture point at itself — infinite recursion on
    the first Floor Plan render (move 7a's first run; caught by eight browser
    suites, never committed). The tool now reads such a top-level capture
    through `globalThis.name` (the app.js function, exactly what it read
    before) and refuses if the name is not an app.js function. Moves 1-6 had
    no such capture (checked).
18. **`assistant-panel` ("F8 opens the panel with the cursor in its box")
    failed once in the gate on the move-6 tip and once alone on 7a, then
    passed alone on moves 5, 6, 6+fix and 7a.** Focus timing under three
    training chains, not a move (bisected: passes on every commit when the
    CPU is not saturated). Flagged for the cheap-items agent's flaky list.
19. **No suite dropped a guest card on a Seating-canvas table.** That handler
    is the only canvas path that calls the seating commands; move 7b reaches
    them through a getter (they are created further down the shell), and the
    tool first wired that getter by a wrong name (`getSEATCMD` → looked up as
    `sEATCMD`) — a boot ReferenceError, caught by reading before any run. The
    tool resolves the name as the shell binds it now, and
    `screen-console-sweep` drops a guest on a table (mutation-proven with the
    getter returning nothing).
20. **Seven more scans read app-v8.js (or app-v8.js + screens) as "the shell"**
    and lost code the day it moved: `i18n-key-integrity` (the plan-import
    failure message), `i18n-hardcoded-english` (its SHELL list),
    `review-decisions` (the writers of a candidate's decision fields —
    identifyLabelledVenueObjects, placeNamedVenueElements,
    holdBackOverlappingTables, applyTeachArea had silently left its scan),
    `plan-detection-boundary` (how the shell calls detect()),
    `toast-discipline` (the composed-toast inventory by file) and
    `tests/lib/reachability.mjs`. All now read the shell plus every
    `create(deps)` module.
21. **`tests/lib/reachability.mjs` already called two LIVE pre-v8 bodies dead
    before this programme**: `bindGuests` (screen-guests.js calls
    `original.bindGuests` since 2026-11-01) and `focusGuest` (reached only
    from it). With the scan widened, the dead set is 57 (was 59: exactly those
    two) and every other name is unchanged across moves 1-17 — measured by
    running the helper on the pre-move tree and on the tip.
22. **The walk-in commit shipped an unclassified error toast**
    (`walkin.liveRefused`), red in `toast-discipline` on the main branch;
    fixed there on its own (1acf190).
23. **Move 18 first wrote OVER an existing file.** The planned target name,
    `src/review-decisions.js` / `MeritReviewDecisions`, is the review RULES
    module that already exists; the tool overwrote it and published the same
    global. Caught before any commit by `offline-bundle-contract` (the same
    file twice in index.html → no unique window in the bundle); the original
    was restored from git and the move renamed `src/review-commands.js` /
    `MeritReviewCommands`. The tool now refuses an existing file or an
    already-published global; every earlier move re-checked: none existed.
24. **`npm run benchmark` and the detector fingerprint were broken by the
    redesign** (they clicked `.appbar [data-action="create-event"]`; the top
    bar has no `.appbar`), so every structural detector move since redesign v4
    could not have been fingerprinted. Fixed (b724f28).
25. **`ANALYSIS_MAX_SIDE` (the analysis canvas cap) sat inside the review
    region**; hoisted to the shell above it before move 18, so it does not
    move with review code it has nothing to do with.
26. **Seating slows down with the guest count** (the cheap-items agent's
    `gala-night-scale-3000`, noted in STATE): `seatingAssign` median 105 ms at
    1,000 guests → 249 ms at 3,000. Not caused by a move (measured before the
    programme) and not changed by it; the writer now lives in
    `seating-commands.js` (`assignGuestGroup`), which is where a
    `performance-qa-engineer` measurement should start — a behaviour change,
    so not part of a refactor commit.
27. **The gate under shared CPU is not a gate.** With three training chains
    running, a full run took >2.5 h and produced page.goto/page.click timeouts
    in suites no move touched (capacity-rule-commit, chair-facing,
    chair-families, assistant-panel's F8 focus); two runs were lost to machine
    restarts. Per-move targeted suites + static structural suites were run for
    every move. The four gates were then run ONCE on the WIP tip (`88a69c2`)
    and ONCE on the landed branch, with a training job still sharing the CPU
    (2026-11-12) — results in "Gate results at landing" below.
28. **`tests/suites/schema-registry` would have passed vacuously** after
    persistence moved (it asserts a pattern is ABSENT from app-v8.js); it now
    reads the shell text and asserts parseRoot is in it.

## Gate results at landing (2026-11-12)

Run with one training job sharing the 4-core CPU (never stopped).

| gate | WIP tip `88a69c2` | landed on `claude/merit-concept3-plan-intelligence-rebirth` |
|---|---|---|
| `npm run test:all` | 192/194 suites, 5678/5680 checks | 194/196 suites, 5736/5738 checks |
| `build-offline.mjs` / `build-offline-full.mjs` | exit 0 / exit 0 | exit 0 / exit 0 |
| `verify-offline-package.mjs` (runs the artifacts) | 47 passed, 0 failed | 47 passed, 0 failed |
| `detector-fingerprint.mjs --compare` | 28 of 28 IDENTICAL | 28 of 28 IDENTICAL |
| workbook dump vs `before-7` (pre-move tree) | byte-identical | byte-identical |

The failures, each judged against the working branch WITHOUT the moves:

- `viewport-matrix` FOCUS ("every Tab stop shows where focus is", tr events
  list `button.tl-plate.on`, command center `#globalGuestSearch`) — fails
  identically on the working branch before landing. Not caused by a move;
  fixed after landing in its own commit (`2deb081`, focus ring on the
  command search field and the selected event plate).
- `gala-night-scale` (tip only) — a p95 timing budget, a DIFFERENT check on
  each run (reportExport 406/365 ms, then checkInClick 74/65 ms); the working
  branch without the moves missed doorSearchKey 47.9/45 ms under the same
  load; it passed in the landed full run. CPU contention, not a regression;
  a clean measurement belongs to `performance-qa-engineer` on a free CPU.
- `doc-drift` (landed only) — the frontend-architect fact table said 14 slow
  suites, the code has 15; corrected in `2deb081`.
