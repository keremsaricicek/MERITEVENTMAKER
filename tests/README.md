# Regression suite

```
npm install          # once — Playwright only; the app itself has no dependencies
npm test             # every fast suite (~2 minutes)
npm run test:all     # including the slow ones (real detection on the real plan)
npm run test:list    # what exists
node tests/run.mjs xlsx storage       # substring filter on suite name
node tests/run.mjs --tag=business     # everything tagged business
```

The runner serves the app itself on an ephemeral port and gives every suite a
fresh browser context, so nothing depends on a server someone remembered to
start, and IndexedDB written by one suite cannot reach the next. Exit code is 1
if any check failed, any suite threw, or any suite saw a page error.

## What is here

| suite | tags | what breaks if it goes red |
|---|---|---|
| `smoke` | business | the app does not boot, or a screen throws |
| `no-sample-specific-runtime-logic` | business | a Golden/ORNEK/merit-real-venue reference in `src/*.js` stops being a documentation comment and becomes a branch on which specific sample was uploaded — the product must understand the language of a plan, never recognise the identity of the image |
| `guest-and-seating-rules` | business | pax semantics, chair/capacity sync, the planning-vs-arrival split |
| `physical-logical-seat-separation` | business | a capacity number synthesises physical chairs again (a symbolic table's `chairs` must be `[]`, not a ring tagged `physical:false`), a symbolic table stops seating guests or stops counting toward operational capacity, detected chair coordinates get regenerated into a synthetic ring by a capacity sync, the two totals (`seatingCapacity` vs `physicalCapacity`) collapse into one number, or Assisted Detection's commit path stops sourcing `hasPhysicalSeats` from the plan's own representation verdict |
| `save-ordering` | business | `saveState()` stops being awaitable (it returned `undefined` while chaining onto the queue, so `await saveState()` waited for nothing), last-write-wins breaks under a storage layer that finishes writes out of order, a burst of saves in one tick stops coalescing — or starts coalescing saves that were genuinely separated in time — or a failed save's image-stripping retry rebuilds its payload from live `state` instead of writing the snapshot it was handed |
| `audit-durability` | business | the activity log truncates on write again (it capped at 1,000 across ALL events, so a busy door erased its own event's opening entries and the previous event's history with them), retention and the screen's display window collapse back into one number, an eviction happens without being counted, or a package import / save round trip loses entries |
| `large-venue-scale` | business | the detector's candidate ceiling drops back into real-venue range or stops reporting truncation, or a 420-table / 4,200-seat plan loses tables, guests, seats or seat arithmetic through the domain and a save round trip |
| `historical-immutability` | business | a completed event can be edited |
| `bulk-add-integrity` | business | the Turkish UI writes labels where identifiers belong |
| `undo-operations` | business | one of twelve destructive operations no longer round-trips |
| `live-door-keys` | business | the door keyboard flow checks in the wrong person, or Live's search stops agreeing with the Global Finder on what a query matches (term order, zone, a +N party, an unseated guest) |
| `xlsx-contract` | business, reports | the exported workbook's sheets, companion seats, or table numbering |
| `storage-provider` | storage | data does not reach IndexedDB, or does not survive a reload |
| `backup-restore` | storage | a bad backup file is accepted, or a good one does not restore |
| `venue-model` | storage | a published layout version is no longer frozen |
| `i18n` | ui | a raw translation key reaches the screen, or a language stops rendering |
| `i18n-key-integrity` | business | a `t()` key stops existing, or loses one of its two languages — statically, across every call site, because the strings this matters most for (error paths) are the ones no rendering test ever reaches. Also guards that no toast shows a bare `error.message` |
| `plan-intelligence-contract` | intelligence, **slow** | the detector fabricates, or its scene graph points at objects that do not exist |
| `chair-families` | intelligence, **slow** | the detector can only describe one kind of chair again, or printed text gets in as the second kind |
| `plan-memory-isolation` | intelligence, **slow** | a human decision changes what the detector finds — confirming one object deletes or conjures others, or a confirmed object does not come back after Re-Analyze |
| `plan-encoder` | intelligence | the browser forward pass drifts from the trainer's, the encoder's embeddings collapse, a provider hides whether it is a trained model, or shipping one starts implying a domain model is installed |
| `structural-objects` | intelligence, **slow** | a column grid is split by a size-bin edge, a column is thrown out for someone else's chair, or printed text starts being read as a column grid |
| `table-typing` | intelligence, **slow** | a table is typed bistro on its size alone, without evidence, or a plan of uniform tables starts producing bistros |
| `training-data-capture` | intelligence, **slow** | a human decision stops storing a real crop with its provenance, or a capture log starts calling itself a model |
| `relationship-engine` | intelligence | a seat is put at the wrong table, or an ambiguous seat is claimed as settled |
| `plan-memory` | intelligence | a remembered correction stops surviving Re-Analyze, or leaks between plans |
| `visual-second-opinion` | intelligence | the learned encoder's opinion is presented as more than a second opinion |
| `plan-representation` | intelligence | a plan that draws chairs is read as symbolic, or one that draws none is read as physical |
| `symbolic-plan-capacity` | intelligence | a numbered symbol is deleted as printed text, or a capacity rule is claimed from OCR nothing corroborates |
| `plan-self-check` | intelligence | arithmetic starts repairing its own inputs, a number loses its provenance, or the withdrawn "stated pax vs 0 counted seats" finding returns on a symbolic plan |
| `operator-questions` | intelligence | two questions that are about different things start reading as the same sentence — correct individually, indistinguishable together, which is the failure reviewing one string at a time cannot catch |
| `plan-confidence-budget` | intelligence | repeated uncertainty stops being grouped, one disagreement gets listed once per layer that noticed it, an item that settles nothing is ranked as work, or the tail below the line is dropped instead of counted |
| `plan-teach-area` | intelligence | a lesson reaches outside the scope it was given, one lesson spreads to every object that resembles it, an ambiguous match gets applied anyway, a venue-wide note acts on resemblance instead of a printed number, or the wording starts calling any of it training |
| `plan-number-integrity` | intelligence | a gap in the numbering gets silently filled in, a numbering range gets hardcoded instead of discovered, or repeated uncertainty stops being grouped |
| `plan-table-numbers` | intelligence | a table number is claimed on weaker evidence than two crops agreeing, or LIKELY starts being produced from OCR alone |
| `plan-label-ocr` | intelligence | an object stops being named from the word the drawing prints on it, or starts being named from a scattered reading stitched back together |
| `symbol-family` | intelligence | family membership widens until architecture is admitted, or narrows until the family's own members fall out |
| `symbolic-plan-detection` | intelligence | on a symbolic plan a detected family member fails to become a table — because it was drawn in solid ink, read as printing, or counted as the seat of an object that was then demoted |
| `operator-session` | business | the operator's review session loses its place, its queue order, or its decisions |
| `command-center` | business | readiness becomes a percentage, the header badge and the screen count different things, or a self-check finding reaches a Turkish operator in English |
| `floor-plan-modes` | business | reviewing a plan costs the operator the workspace around it — the event's name, the tabs, the guest search — or the uploaded plan stops being the hero |
| `review-queue` | business | a ranked list of uncertainties stops becoming "this one, decide, next", or a settled item leaves the operator sitting on what they just settled |
| `teach-number` | business | a number a person confirmed becomes indistinguishable from one two crops agreed on, or an unsafe scope is refused after the click instead of before |
| `plan-doctor` | business | an uncertain OCR reading becomes a blocker, a finding has nowhere to go, a fixed problem lingers as a stale warning, or the pre-flight and the header disagree |
| `layout-changes` | business | a moved table is reported as a removal plus an addition, a capacity change is lumped in with movement, the change view stops being a mode of the Floor Plan, or a published version is rewritten by reading it |
| `guest-finder` | business | the global search stops answering the whole question in the row, an action silently reseats or reclassifies a guest, the keyboard path breaks, or a four-thousand-guest search stops being fast |
| `smart-seating` | business | a recommendation becomes a mutation before someone presses Apply, a party gets split across tables to make the numbers work, a constraint that has never run is reported as satisfied, or a locked assignment stops outranking the advisor |
| `arrival-wave` | business | the expected axis is drawn as a zero curve when nobody stated a time, a No Show reaches the arrival curve, an arrival moment survives a status that contradicts it, an untimed check-in is dropped instead of counted, partial coverage is presented as complete, a forecast appears, or selecting a wave stops narrowing the door list |
| `risk-radar` | business | the Command Center's radar invents a readiness percentage, stops naming the risks this build cannot evaluate, raises a No Show as a problem with the plan, treats every occupied frozen table as a contradiction, stops raising a checked-in guest with no table as BLOCKING, or leaves a resolved row on screen |
| `seating-freeze` | business | a seating path crosses a freeze without a supervisor, an override lifts the freeze instead of authorising one operation, Smart Seating starts recommending frozen tables, the freeze stops being a rule (a table added to the zone afterwards is not covered), the canvas layer buries the plan under an opaque block, or a freeze does not survive a reload |
| `service-load` | business | occupancy bands are scored as a percentage instead of named, PLANNED and LIVE occupancy stop being different rooms (a No Show's chair still reads as taken), a distance or route is computed from an unmarked or a marked service point, the layer paints an opaque block over the plan, or toggling it mutates the room |
| `table-availability` | business | marking a table unavailable moves a guest or touches capacity/chairs, a NEW assignment can still land on an unavailable table from any path (a seat row, not only the disabled button), Smart Seating recommends it anyway, a freeze and an unavailable state stop being independent facts about the same table, the Plan Doctor stops naming who it strands, or the canvas mark is gated behind a layer toggle |
| `event-handover` | business | the digest disagrees with the same fact shown elsewhere on the Command Center (it must be read, never recomputed), a handover note can be edited or deleted, notes stop being newest-first, a blank note is accepted silently, a note ever moves a guest or changes arrival status, or a historical event keeps reaching the composer (or the Command Center at all) |
| `audit-trail` | business | the generic per-mutation log entry leaks into the trail as if it were a decision, one real decision gets logged twice under two different codes, another event's decisions leak into this one's trail, an unresolvable guest/table id throws instead of falling back honestly, the shared log hitting its cap goes undisclosed, or the trail stops being reachable on a historical event |
| `offline-recovery` | storage | a corrupted primary record boots blank with no notice, an automatic snapshot is taken on every save instead of throttled, the ring buffer grows past its cap, a snapshot shares storage with (and can be corrupted by) the primary record, a deliberate restore is not confirmed first, or automatic recovery is ever presented as equivalent to `exportBackup()`'s "a file left the browser" |
| `event-package` | storage | importing a package replaces or touches any event already present instead of adding one alongside, a table freeze/chair/guest-assignment/audit-trail reference is left pointing at an old id after renumbering, exporting a package sets `lastBackupAt` as if the whole install had been backed up, or `duplicateEvent()`'s own TABLE-scope freeze regresses to pointing at the wrong table |
| `post-event-replay` | business | the replay reaches a non-historical event, it reorders or restyles the Audit Trail section it sits above instead of leaving it alone, a bucket click fails to narrow to that window (or an empty window looks like a bare list instead of saying so), the clock-time shown on a row stops using the wave module's own helpers, or `MeritPostEventReplay` mutates its input or guesses without both clock helpers injected |
| `event-history` | business | the history panel reports a percentage for an event with no capacity or no invited pax instead of naming the gap, one fact's missing data drags down the other fact's average, an average's own sample size stops being independent per fact, the panel appears with zero historical events, or its wording starts implying a trained model instead of a plain average of real past events |
| `dependency-direction` | business | a `globalThis.Merit*` module reaches back into the app shell (`state`, `ui`, `render()`, `touchEvent()`, `saveState()`, `activeEvent()`) and the one-way graph that makes extraction safe stops holding. Also guards the scanner it depends on: prose mentions must stay invisible, `venue-model.js`'s injected `state` parameter must stay recognised as injection rather than coupling, and code inside a **nested** template interpolation must stay visible — a scanner blind to those reports live functions as dead |
| `boot-contract` | business | the 33 classic scripts change order, `app-v8.js` stops being last, a script is loaded twice, or — the one static analysis cannot see — an overridden function silently resolves to its **pre-v8 body at runtime**, which is what an extraction from `app-v8.js` is most likely to cause and what does not look wrong in a diff. Also pins the `original` capture's classification (12 delegated / 20 shadowed / 1 untouched), so a future dead-code pass cannot read "21 unreachable" as 21 dead functions |
| `offline-bundle-contract` | business | an element the app looks up by id ends up **below** the first `<script>` tag and is silently dropped from both offline artifacts while both builds report success (this already shipped a dead package once), or the bundle stops concatenating the sources in `index.html`'s document order — which keeps every file present, builds clean, and breaks the app, because `app-v8.js`'s overrides would run before the files they override |

| `plan-detection-boundary` | business | the Assisted Detection pipeline's seam closes again: `app-v8.js` resolves a name bound only inside `plan-detection-classical.js` (or the reverse) — a ReferenceError at runtime, not a style complaint; the file exports something beyond its three public names; a function was COPIED rather than moved (two detectors that drift is worse than one in the wrong file); the injected `confidenceThreshold` or the returned `applyDeg` stops crossing, so calibration or the deskew deadband silently stops applying; or `trainedModel` stops being `false`, which a refactor is exactly the kind of change to drop and which would make the product imply a trained model exists |

## Structural suites

Four of the suites above guard *structure* rather than behaviour, and exist
so `app-v8.js` can be broken up safely: `dependency-direction`,
`boot-contract`, `offline-bundle-contract` and `plan-detection-boundary`.
Run them before and after every structural step.

**None of them proves a detector still detects.** The first attempt at the
detection extraction passed all four, booted cleanly, and threw
`ReferenceError` on every real analysis. Pair them with a suite that exercises
the behaviour being moved — for detection that is `symbolic-plan-detection`,
plus `npm run benchmark` against the committed baseline. The plan they serve is in
`benchmarks/MODULARIZATION-ORDER.md`, the map it is derived from is
`benchmarks/APP-V8-OWNERSHIP-MAP.md`, and the evidence behind "delete
nothing yet" is `benchmarks/CODE-INVENTORY.md`.

They share `tests/lib/js-scan.mjs`, which strips comments and string literals
so a rule can be written about *code* rather than about text. Use it instead
of grep for any question of the form "does this file really reference X?" —
and note its one hard-won property: it keeps the contents of **nested**
template interpolations, because that is where nearly every call in this
codebase's render functions lives.

## Environment

Everything is resolved, with the container's values as the last fallback, so
the same files run here and in CI:

| variable | what it overrides |
|---|---|
| `MERIT_PLAYWRIGHT` | module path to Playwright (default: a normal `playwright` import) |
| `MERIT_CHROMIUM` | Chromium executable (default: under `PLAYWRIGHT_BROWSERS_PATH`, else Playwright's own) |
| `MERIT_BASE_URL` | use an already-running server instead of starting one |
| `MERIT_TEST_ARTIFACTS` | where downloaded workbooks and backup fixtures are written |

The two pinned CDN engines (SheetJS, PDF.js) and Tesseract are served from
`.vendor-cache/` when it exists, which `node scripts/build-offline.mjs`
populates. Without it the tests still run wherever there is network, but a
sandbox with no outbound access boots the app with `XLSX` undefined — the
workbook export then produces nothing and looks fine. Run the offline build
once and the whole suite is hermetic.

## Writing a suite

A suite is a file in `suites/` named `*.test.mjs`:

```js
import { openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = { name: "my-suite", tags: ["business", "fast"], timeout: 90000 };

export default async function run({ page, checks, baseUrl, artifactDir, repoRoot }) {
  await openApp(page, baseUrl);
  checks.ok(condition, "what an operator would lose if this were false", detail);
  checks.require(condition, "…");   // aborts the suite instead of cascading
}
```

Add `downloads: true` to `meta` if the suite saves a file, and a `viewport` if
1920×1080 is wrong for it.

Three things this suite learned the hard way, all encoded in `lib/app-actions.mjs`:

- **Never hardcode a fixture date.** An event dated in the past is
  `isHistorical`: read-only, with no Floor Plan tab and no add-object control.
  A suite that hardcodes a date fails the day it passes, with a
  `click(".planmap-fab")` timeout that says nothing about the cause. Use
  `futureDate()` — `createBlankEvent` already defaults to it. Pass a past date
  only when the suite genuinely wants a finished event.

- **Drive the real UI.** Nearly every domain function — `canMutate`,
  `setTableCapacity`, the seating logic — lives inside a closure and is not on
  `globalThis`. So do `state` and `ui`: they are top-level `let` bindings, so
  `state.events` works inside `page.evaluate` and `globalThis.state` is
  `undefined` on a perfectly healthy app.
- **Wait on state, never on a sleep.** `render()` rebuilds the screen from
  places a test cannot see, and a synthetic keystroke or fill that lands
  mid-render reaches a detached node. The helpers confirm what they typed
  actually reached `ui`, and read the data back before drawing any conclusion
  from it.
