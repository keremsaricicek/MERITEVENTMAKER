# `app-v8.js` — ownership map

**Purpose.** `src/app-v8.js` is 8,543 lines and 266 top-level functions in one
IIFE. Before any of it is extracted, this document records **who owns what** —
so an extraction is a decision about a business capability with a known blast
radius, not a decision about a line count.

**Status: reference document. Nothing here has been extracted.** This is the
"ownership map first" step that `.claude/rules/code-health.md` requires before
the first screen comes out.

## How this was produced

Measured, not read off. `tests/lib/js-scan.mjs` strips comments and string
literals (including nested template interpolation, which is where most of
this file's real calls live), and the per-area figures below come from
scanning the stripped source:

```
node tests/run.mjs --suite dependency-direction   # the one-way rule
node tests/run.mjs --suite boot-contract          # the override/load contract
node tests/run.mjs --suite offline-bundle-contract # the build's slicing contract
```

Three numbers worth carrying:

| | |
|---|---|
| Total lines | 8,543 |
| Top-level functions | 266 |
| Functions with no reference anywhere in `src/` beyond their own definition | **0** |

That last figure matters. An earlier measurement said fourteen functions were
unreferenced. All fourteen were live, every one of them called from inside a
**nested** template interpolation that the scanner was throwing away. The
scanner was fixed and the count went to zero. A dead-code pass run on the
broken measurement would have deleted fourteen working functions.

## Reading the fields

- **Writes** lists domain and UI fields assigned in the area. `ui.*` writes
  are view state; `<obj>.*` writes are domain state and are the ones that
  matter for the single-writer rule.
- **Extraction difficulty** is about *coupling*, not size. A 2,900-line area
  that touches no shell global is LOW; a 60-line area that writes `ui` from
  three call paths is not.
- **Missing characterization test** names what would NOT fail today if the
  area's behaviour broke during a move. Per `.claude/rules/code-health.md`,
  that test is written and proven to bite *before* the area moves.

---

## A01 · Persistence & schema migration

- **Lines** 1–81, 141–290 (231)
- **Main functions** `storageProvider` (IIFE), `blankRoot`, `migrateEvent`,
  `parseRoot`, `loadFromLegacyLocalStorage`, `loadV8Async`, `persistPayload`,
  `saveState`, `touchEvent`
- **Reads** `state.events`
- **Writes** `<obj>.lastModified`; schema defaults for `status`, `freezes`,
  `handoverNotes`, `analysis`, `planMemory`
- **Merit modules** `MeritStorageProviders`, `MeritVenueModel`,
  `MeritCapacityProvenance`, `MeritSeatingFreeze`, `MeritEventHandover`
- **Callers** everything — `saveState`/`touchEvent` are called from 14 of the
  26 areas
- **Protected by** `schema-migration`, `storage-provider`,
  `transaction-atomicity`, `backup-restore`
- **Single-writer risk** LOW. `migrateEvent`'s writes are one-time schema
  defaults (`||=`, `||`), not competing writers. They are why five fields show
  as "multi-writer" in a naive scan.
- **Difficulty** HIGH — not because of coupling but because *everything*
  depends on it. It is the wrong thing to move first and the wrong thing to
  move last.
- **Boundary** `saveState`/`touchEvent` stay in the shell. `migrateEvent` +
  `parseRoot` + `blankRoot` are pure functions of a payload and could become
  `MeritStateMigration`.
- **Target file** `src/state-migration.js`
- **Missing test** none material — `schema-migration` covers the migration
  path with real stored payloads.

## A02 · Domain primitives — historical, audit, chair/capacity

- **Lines** 82–140 (59)
- **Main functions** `isHistorical`, `canMutate`, `audit`, `chairGeometry`,
  `syncTableChairs`, `refreshChairOccupancy`
- **Reads** `state.audit`
- **Writes** `state.audit`, `table.capacity`, `table.chairs`
- **Merit modules** none
- **Callers** every mutating path in the file; `canMutate` is the immutability
  gate the product contract requires in domain logic
- **Protected by** `historical-immutability`, `pax-invariant`,
  `physical-logical-seat-separation`, `capacity-provenance`, `audit-trail`
- **Single-writer risk** MEDIUM. `syncTableChairs` is the sanctioned writer of
  `capacity`+`chairs`, but three other sites write `chairs` directly (see
  `CODE-INVENTORY.md`) — two deliberately.
- **Difficulty** LOW — pure functions of an event/table, zero `ui` contact.
- **Boundary** the cleanest first extraction in the file. `isHistorical` +
  `canMutate` need a toast callback injected rather than calling `toast`
  directly.
- **Target file** `src/event-rules.js`
- **Missing test** `canMutate`'s *refusal path* (that a historical event's
  mutation is rejected **and** the toast reason is produced) as a unit, not
  only through the UI.

## A03 · Occupancy & live statistics

- **Lines** 291–346 (56)
- **Main functions** `physicalCapacity`, `liveUsedIndexes`, `liveStats`,
  `tableObjectHTML`, `tableMatchesFilter`, `filterBannerHTML`
- **Reads** none of `state`; `ui.freezeLayer`, `ui.loadLayer`,
  `ui.operationalMode`, `ui.seatingFilter`, `ui.selectedObjectId(s)`,
  `ui.selectedTableId`, `ui.showSeats`, `ui.highlightId`
- **Writes** none
- **Merit modules** none
- **Callers** Floor Plan, Seating, Live, Command Center
- **Protected by** `guest-and-seating-rules`, `service-load`, `arrival-wave`
- **Single-writer risk** none — read-only.
- **Difficulty** MEDIUM — `liveUsedIndexes` is pure and moves trivially;
  `tableObjectHTML` reads eight `ui` fields and is rendering, not domain.
- **Boundary** split the area: `physicalCapacity`/`liveUsedIndexes`/`liveStats`
  are domain; the three HTML/filter functions are Floor Plan rendering and
  belong with A11.
- **Target file** `src/occupancy.js` (domain half only)
- **Missing test** that `liveUsedIndexes` and `app.js`'s `occupiedSeatIndexes`
  **disagree** for a No Show — the difference is the product rule, and no
  suite asserts the pair directly.

## A04 · Plan Doctor, readiness & the resolution readers

- **Lines** 347–457, 484–491, 595–740 (265)
- **Main functions** `planIssues`, `planHealthHTML`, `eventPhase`,
  `eventFreezes`, `resolvedFreezes`, `resolvedUnavailable`,
  `frozenTableIdSet`, `planDoctorReport`, `eventReadiness`, `doctorText`,
  `ccCheckText`, `doctorGoHTML`
- **Reads** nothing from `state` — everything is a function of the event
- **Writes** none
- **Merit modules** `MeritPlanDoctor`, `MeritSeatingFreeze`,
  `MeritTableAvailability`, `MeritCapacityProvenance`
- **Callers** header badge, Command Center, pre-flight report, Risk Radar
- **Protected by** `plan-doctor`, `risk-radar`, `seating-freeze`,
  `table-availability`, `capacity-provenance`
- **Single-writer risk** none — derived on every read, stores nothing.
- **Difficulty** LOW. This area is already the shape the rest of the file is
  trying to become: it runs no engine, it reads modules and formats answers.
- **Boundary** the presentation half (`doctorText`, `doctorGoHTML`,
  `ccCheckText`) stays; the resolution readers are a thin adapter over four
  Merit modules and can move as one.
- **Target file** `src/event-resolution.js`
- **Missing test** none material — four suites already cover it, and the
  "one layer, one answer" property is `plan-doctor`'s subject.

## A05 · Onboarding

- **Lines** 458–483 (26)
- **Main functions** `onboardingSeen`, `dismissOnboarding`, `resetOnboarding`,
  `onboardingCalloutHTML`
- **Reads** `state.onboarding`
- **Writes** `state.onboarding`; calls `saveState()` and `render()`
- **Merit modules** none
- **Callers** Floor Plan, Seating, Live, Plan Intelligence callouts
- **Protected by** `onboarding`
- **Single-writer risk** none — one writer, one key.
- **Difficulty** LOW.
- **Boundary** self-contained; the only shell contact is `saveState`+`render`,
  both injectable.
- **Target file** `src/onboarding.js`
- **Missing test** none material.

## A06 · Event handover

- **Lines** 492–521 (30)
- **Main functions** `resolvedHandoverNotes`, `addHandoverNote`
- **Reads** the event
- **Writes** `event.handoverNotes`
- **Merit modules** `MeritEventHandover`
- **Callers** Command Center handover panel
- **Protected by** `event-handover`
- **Single-writer risk** none. The second write site is `migrateEvent`'s
  schema default.
- **Difficulty** LOW — already a thin adapter over its module.
- **Boundary** fold the adapter into `MeritEventHandover`'s API surface.
- **Target file** none needed; absorb into `src/event-handover.js`
- **Missing test** none material.

## A07 · Audit trail

- **Lines** 522–594 (73)
- **Main functions** `resolvedAuditTrail`, `auditTrailText`, `backupState`
- **Reads** `state.audit`, `state.lastBackupAt`
- **Writes** none here (the writer is `audit()` in A02)
- **Merit modules** `MeritAuditTrail`
- **Callers** Reports audit panel, Command Center
- **Protected by** `audit-trail`
- **Single-writer risk** none.
- **Difficulty** LOW.
- **Boundary** reading and formatting only; moves with A06.
- **Target file** absorb into `src/audit-trail.js`
- **Missing test** none material.

## A08 · Command Center & Risk Radar

- **Lines** 741–1130 (390)
- **Main functions** `commandCenterHTML`, `bindCommand`, `doctorGo`,
  `riskRadarHTML`, `ccPlanConsistencyHTML`, `ccSeatingHTML`,
  `eventHandoverHTML`, `eventHistoryLearningHTML`, `nextEventHeroHTML`,
  `eventsHTML`
- **Reads** `state.events`; **22 distinct `ui` fields**
- **Writes** **21 `ui` fields** — the widest UI write surface in the file
- **Merit modules** `MeritPlanDoctor`, `MeritArrivalWave`, `MeritEventHistory`
- **Callers** the Events/Home screen
- **Protected by** `command-center`, `risk-radar`, `event-history`
- **Single-writer risk** none for domain state — it writes almost no domain
  fields. Its risk is different: it is the file's main **navigation writer**.
- **Difficulty** HIGH. Not for its size: `doctorGo` is the "every finding says
  where to go" contract, and it reaches into nearly every screen's `ui` state
  to land the operator in the right place. Extract it and that contract
  becomes a cross-module protocol.
- **Boundary** do **not** split `doctorGo` from `commandCenterHTML`. Move the
  whole screen or none of it.
- **Target file** `src/screen-command-center.js`
- **Missing test** that **every** Risk Radar / pre-flight row's control
  actually navigates somewhere valid — `risk-radar` asserts the rows exist and
  carry a control, not that each control's destination resolves.

## A09 · Event setup & plan file intake

- **Lines** 1131–1225 (95)
- **Main functions** `setupHTML`, `bindSetup`, `startNewEvent`,
  `createBlankEventFromSetup`, `handlePlanFile`, `selectPdfPage`,
  `renderPdfThumbs`, `readDataURL`
- **Reads** `state.events`; `ui.screen`, `ui.tab`, `ui.activeEventId`,
  `ui.setupBusy`, `ui.leftCollapsed`
- **Writes** the same five `ui` fields; creates events
- **Merit modules** `MeritVenueModel`, `MeritPdf`
- **Callers** Create Event flow
- **Protected by** `no-sample-specific-runtime-logic`, `venue-model`, `smoke`
- **Single-writer risk** none.
- **Difficulty** MEDIUM — async file/PDF handling plus `ui.setupBusy`
  lifecycle.
- **Boundary** `createBlankEventFromSetup` is the "blank events are actually
  blank" contract and is pure; the file intake is I/O.
- **Target file** `src/screen-setup.js`
- **Missing test** that a **PDF** import path produces a blank event with zero
  tables/guests — `no-sample-specific-runtime-logic` covers the image path.

## A10 · Smart Guest Finder

- **Lines** 1226–1425 (200)
- **Main functions** `guestSearchIndex`, `matchGuestRows`, `findGuests`,
  `partyOf`, `guestResultHTML`, `findAction`, `guestSearchKey`,
  `closeGuestSearch`
- **Reads** 11 `ui` fields
- **Writes** 11 `ui` fields — navigation and selection only
- **Merit modules** none
- **Callers** the appbar; `matchGuestRows` is also called by Live's door search
- **Protected by** `guest-finder`, `live-door-keys`
- **Single-writer risk** none — **writes no domain state at all**, which is
  the contract ("nothing it offers moves a guest").
- **Difficulty** LOW for the engine, MEDIUM for the actions. `guestSearchIndex`
  + `matchGuestRows` + `findGuests` are pure over an event; `findAction` is
  navigation.
- **Boundary** extract the **matching engine only**. `matchGuestRows` is
  already the shared contract between two surfaces, which makes it the single
  most obviously-ready module in the file.
- **Target file** `src/guest-search.js`
- **Missing test** none material — two suites cover it, including the shared
  haystack property.

## A11 · Floor Plan workspace & layout-change mode

- **Lines** 1426–1726 (301)
- **Main functions** `floorPlanHTML`, `planMapToolbarHTML`,
  `contextualCardHTML`, `planStatusPillHTML`, `planModeSwitchHTML`,
  `loadLayerToolHTML`, `bulkPanel`, `ghostHTML`, `layoutChanges`,
  `layoutChangePanelHTML`, `confirmLayoutChange`, `bindLayoutChanges`
- **Reads** 15 `ui` fields
- **Writes** `ui.highlightId`, `ui.selectedChangeId`, `event.layoutChangesSeen`
- **Merit modules** `MeritVenueModel`
- **Callers** the Floor Plan screen
- **Protected by** `floor-plan-modes`, `layout-changes`
- **Single-writer risk** LOW.
- **Difficulty** HIGH. Two capabilities are **interleaved by line**: layout
  changes occupy 1426–1459 and 1632–1726 with Floor Plan chrome between them.
  Moving either requires untangling that first.
- **Boundary** untangle before extracting: make layout-changes contiguous in a
  no-behaviour-change commit, *then* move it. Two commits, in that order.
- **Target file** `src/screen-floor-plan.js`, `src/layout-changes-ui.js`
- **Missing test** that the mode switch preserves selection and does **not**
  redraw the room as a second canvas — `floor-plan-modes` covers the modes,
  not the "same canvas" invariant.

## A12 · Canvas object lifecycle

- **Lines** 1727–1800 (74)
- **Main functions** `createTable`, `createTableFromDraft`, `commitBulk`,
  `placeRepeated`, `duplicateSelection`, `deleteSelection`, `startMarquee`,
  `startObjectDrag`, `setTableCapacity`, `addVenue`, `deleteSelectedObject`,
  `redoCanvas`
- **Reads** 16 `ui` fields
- **Writes** `event.tables`, `event.venueObjects`, **`guest.assignment`**,
  `table.capacitySource`, 11 `ui` fields; calls `saveState`, `touchEvent`
- **Merit modules** none
- **Callers** Floor Plan canvas interaction
- **Protected by** `bulk-add-integrity`, `undo-operations`,
  `capacity-provenance`, `historical-immutability`
- **Single-writer risk** **HIGH.** `deleteSelection` nulls `guest.assignment`
  when a table is deleted — one of three areas that write the field.
- **Difficulty** HIGH — densest `ui` coupling per line in the file.
- **Boundary** leave until A17's assignment writer is consolidated. Deleting a
  table must go *through* that writer, not around it.
- **Target file** `src/canvas-objects.js` (after A17)
- **Missing test** that deleting a table with seated guests unassigns them
  **and records it in the audit trail the same way an explicit unassign does** —
  `bulk-add-integrity` covers creation, not this deletion path.

## A13 · Seating roster & table index

- **Lines** 1801–1857 (57)
- **Main functions** `tableIndex`, `guestSelectionRows`, `seatingHTML`
- **Reads** 5 `ui` fields
- **Writes** `ui.leftCollapsed`
- **Merit modules** none
- **Callers** the Seating screen
- **Protected by** `guest-and-seating-rules`, `smart-seating`
- **Single-writer risk** none.
- **Difficulty** LOW.
- **Boundary** `tableIndex` is pure and already exposed as
  `globalThis.meritTableIndex` for the offline verifier.
- **Target file** `src/screen-seating.js`
- **Missing test** none material.

## A14 · Smart Seating

- **Lines** 1858–1980 (123)
- **Main functions** `seatingAdvice`, `smartSeatingHTML`,
  `seatingPreviewHTML`, `reasonText`, `bindSmartSeating`
- **Reads** `ui.selectedGuestId`, `ui.seatPreview`
- **Writes** `ui.seatPreview` only
- **Merit modules** `MeritSeatingAdvisor`
- **Callers** the Seating screen
- **Protected by** `smart-seating`
- **Single-writer risk** none — **the area writes no domain state**, by
  design: the advisor cannot seat anybody and the only writer is
  `assignGuestToTable`, called from one line behind Apply.
- **Difficulty** LOW.
- **Boundary** a thin adapter over its module plus rendering. Moves cleanly.
- **Target file** `src/screen-seating.js` (with A13)
- **Missing test** none material — the "no path to an assignment" property is
  `smart-seating`'s subject.

## A15 · Service load

- **Lines** 1981–2040 (60)
- **Main functions** `serviceLoad`, `serviceLoadHTML`, `loadBandMap`,
  `loadBandText`
- **Reads** the event; no `state`, no `ui` writes
- **Writes** none
- **Merit modules** `MeritServiceLoad`
- **Callers** Floor Plan and Seating toolbars (shared `loadLayerToolHTML`),
  Command Center
- **Protected by** `service-load`
- **Single-writer risk** none.
- **Difficulty** LOW — the cleanest adapter in the file.
- **Boundary** moves as-is.
- **Target file** absorb into `src/service-load.js`
- **Missing test** none material.

## A16 · Freeze zones

- **Lines** 2041–2354 (314)
- **Main functions** `freezePanelHTML`, `freezeFormHTML`,
  `freezeCoveragePreviewHTML`, `freezeChallengeHTML`, `createFreezeFromDraft`,
  `liftFreeze`, `authoriseFreezeOverride`, `bindFreezeZones`,
  `selectedTablePanelHTML`
- **Reads** 7 `ui` fields
- **Writes** `event.freezes`, `ui.freezeDraft`, `ui.freezeChallenge`,
  `ui.freezeLayer`, `ui.loadLayer`
- **Merit modules** (via A04's resolvers) `MeritSeatingFreeze`
- **Callers** Seating; the layer is drawn by Floor Plan
- **Protected by** `seating-freeze`
- **Single-writer risk** LOW — both `event.freezes` writes are in this area;
  the third site is `migrateEvent`'s default.
- **Difficulty** MEDIUM. The override challenge is a *parameter spent on one
  call*, never stored state — an extraction that turns it into module state
  would be a revert.
- **Boundary** the UI panel and the challenge lifecycle move together.
- **Target file** `src/freeze-ui.js`
- **Missing test** none material — `seating-freeze` covers both crossing
  directions and the non-persistence of an override.

## A17 · Seat assignment writer

- **Lines** 2355–2510 (156)
- **Main functions** `assignGuestGroup`, `assignGuestToTable`,
  `selectGuestRecord`, `freezeBlocks`, `challengeFreeze`,
  `toggleAssignmentLock`, `bindSeating`
- **Reads** 11 `ui` fields
- **Writes** **`guest.assignment` (4 sites)**, 11 `ui` fields
- **Merit modules** none directly (freeze evaluation via A04)
- **Callers** Seating, Smart Seating's Apply, the Guest Finder's CHANGE TABLE
- **Protected by** `guest-and-seating-rules`, `seating-freeze`,
  `smart-seating`, `undo-operations`
- **Single-writer risk** **HIGHEST IN THE FILE.** `guest.assignment` is
  written from **8 sites across 3 areas** (A17×4, A21×3, A12×1). The product
  contract names `assignGuestToTable()` as the only writer; today that is true
  of the *seating* path but not of deletion (A12) or guest removal/undo (A21).
- **Difficulty** HIGH.
- **Boundary** **this is the first thing to fix and it is not an extraction.**
  Consolidate all eight sites behind one writer *in place*, prove it with a
  test, and only then consider moving it.
- **Target file** `src/seat-assignment.js` (after consolidation)
- **Missing test** a single suite asserting that **every** path which clears or
  sets an assignment goes through one function — the structural equivalent of
  `dependency-direction`, for this field.

## A18 · Arrival wave

- **Lines** 2511–2808 (298)
- **Main functions** `arrivalWave`, `arrivalWaveHTML`, `waveGuestIds`,
  `waveFilterBannerHTML`, `bindArrivalWaveControls`, `liveHTML`, `bindLive`,
  `focusLiveSearch`, `growLive`
- **Reads** 14 `ui` fields
- **Writes** 14 `ui` fields — all view state, no domain state
- **Merit modules** `MeritArrivalWave`
- **Callers** Live Event, Command Center summary
- **Protected by** `arrival-wave`, `live-door-keys`
- **Single-writer risk** none — the arrival axis is written in A19, not here.
- **Difficulty** MEDIUM — `liveHTML`/`bindLive` are the Live screen and carry
  the door keyboard flow.
- **Boundary** the wave engine adapter is separable from the Live screen.
- **Target file** `src/screen-live.js`
- **Missing test** that selecting a wave narrows **the same** door list rather
  than a parallel one — `arrival-wave` covers the buckets, `live-door-keys`
  the search; neither asserts they are one list.

## A19 · Arrival & availability writers

- **Lines** 2809–2871 (63)
- **Main functions** `setArrival`, `recordArrival`, `setTableAvailability`
- **Reads** `ui.liveRecent`
- **Writes** `guest.arrivalStatus`, `guest.checkedInAt`, `table.availability`,
  `table.unavailableReason/Note/Since`, `ui.liveRecent`
- **Merit modules** none
- **Callers** Live Event, the Guest Finder's CHECK IN, Floor Plan's table
  panel
- **Protected by** `arrival-wave`, `table-availability`, `audit-trail`
- **Single-writer risk** **none, and this area is the reason.** `setArrival` is
  the *only* writer of the arrival axis: it maintains `arrivalStatus` and
  `checkedInAt` together and writes the audit entry, so the moment can never
  survive a contradicting status.
- **Difficulty** LOW.
- **Boundary** **this area is the model the rest of the file should copy.** 63
  lines, three functions, one writer per fact.
- **Target file** `src/arrival-writer.js`
- **Missing test** none material.

## A20 · Excel import · reports pre-flight · print · replay

- **Lines** 2872–3101 (230)
- **Main functions** `renderExcelWizard`, `wizardBodyHTML`, `mappingRowsHTML`,
  `wizIssueText`, `reportsHTML`, `bindReports`, `auditTrailHTML`,
  `postEventReplayHTML`, `printTablePlan`, `printRoot`
- **Reads** `state.audit`; `ui.tab`, `ui.waveKey`
- **Writes** `ui.tab`
- **Merit modules** `MeritPostEventReplay`, `MeritArrivalWave`
- **Callers** Guests (import), Reports
- **Protected by** `xlsx-contract`, `post-event-replay`, `audit-trail`
- **Single-writer risk** none.
- **Difficulty** MEDIUM. Four unrelated capabilities share a line range; the
  XLSX contract is the most regression-sensitive surface in the product.
- **Boundary** split by capability, not by range. The workbook export contract
  (`xlsx-contract`) must be re-run on every step.
- **Target file** `src/screen-reports.js`, `src/excel-wizard.js`
- **Missing test** none material — `xlsx-contract` opens the produced workbook
  and diffs sheet contents.

## A21 · Guests screen & destructive-action undo

- **Lines** 3102–3287 (186)
- **Main functions** `guestsHTML`, `bindGuests`, `guestCounts`,
  `guestPartyCellHTML`, `openGuestDialog`, `deleteGuest`, `unassignGuest`,
  `loadXLSX`, `toastAction`, `translateStaticDialogs`
- **Reads** 6 `ui` fields
- **Writes** **`guest.assignment` (3 sites)**, 5 `ui` fields
- **Merit modules** none
- **Callers** the Guests screen
- **Protected by** `guest-and-seating-rules`, `pax-invariant`,
  `undo-operations`, `xlsx-contract`, `i18n`
- **Single-writer risk** **HIGH** — the second of the three areas writing
  `guest.assignment`, including the undo restore path.
- **Difficulty** HIGH — blocked behind A17 for the same reason as A12.
- **Boundary** after A17's consolidation.
- **Target file** `src/screen-guests.js`
- **Missing test** that undo after `deleteGuest` restores the assignment
  **and** that the seat was not taken in the meantime — `undo-operations`
  covers the restore, not the contested-seat case (`snapshot.assignment=null;
  seatLost=true` at line 3157 is real logic with no suite).

## A22 · Assisted Detection pipeline — **EXTRACTED**

> **Moved out.** Lines 3290–6098 (2,809) are now
> `src/plan-detection-classical.js`, reached only through
> `globalThis.MERIT_PLAN_DETECTION`. `app-v8.js` is 5,741 lines as a result.
> The entry below is the map as it stood before the move, kept because it is
> the reasoning the move was made on. The new file's own internal map is
> `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`.

- **Lines** 3288–6213 (2,926 — **34% of the file**), *before extraction*
- **Main functions** `buildAccentModel`, `buildToneModel`, `buildClassMasks`,
  `labelComponents`, `minAreaRect`, `shapeAnalysis`, `classifyTableShape`,
  `modalMagnitude`, `symbolFamilyMember`, `splitAlongAxis`, `sameObject`,
  `boxIoU`, `computeVisualDescriptor`, `resolvePlanDetectionProvider`,
  `resolveVisualEmbeddingProvider`, `estimatePlanSkew`
- **Reads** **nothing** — no `state`, no `ui`
- **Writes** **nothing**
- **Merit modules** `MeritPlanRepresentation`, `MeritRelationships`,
  `MeritVisualEmbedding`, `MeritSymbolFamilyMember`,
  `MeritRegisterPlanEncoder`
- **Callers** `runAssistedDetection` (A23) only, through the provider object
- **Protected by** `npm run benchmark` + `benchmarks/BASELINE.json`, plus
  `symbolic-plan-detection`, `chair-families`, `table-typing`,
  `structural-objects`, `symbol-family`
- **Single-writer risk** none — it is pure.
- **Difficulty** **LOW, and this is the surprise of the map.** The largest
  area is the least coupled: 2,926 lines that touch no shell global and are
  reached through one provider interface (`{id,label,trainedModel,detect}`).
- **Boundary** already drawn, by the provider object. Moving it is a file move
  plus a script tag.
- **Target file** `src/plan-detection-classical.js`
- **Missing test** none for correctness — the detector is measured, not
  asserted, and `benchmarks/BASELINE.json` compares every guarded field per
  plan. What is missing is a *structural* test that the provider interface is
  the only way in.

## A23 · Plan knowledge — memory, training data, OCR, Teach Area

- **Lines** 6214–7413 (1,200)
- **Main functions** `rememberCorrection`, `captureTrainingExample`,
  `applyPlanMemory`, `matchCandidatesByGeometry`, `operatorSession`,
  `recordOperatorAction`, `applyVisualSecondOpinion`,
  `suppressTextFalsePositives`, `identifyLabelledVenueObjects`,
  `readPrintedTableNumbers`, `checkNumberIntegrity`, `runSelfCheck`,
  `runConfidenceBudget`, `applyTeachArea`, `teachTableNumber`,
  `teachSelectedObject`, `forgetLesson`, `runAssistedDetection`
- **Reads** `state.teachings`, `state.trainingData`, `state.operatorSessions`;
  13 `ui` fields
- **Writes** `state.teachings`, `state.operatorSessions`, `event.analysis`,
  `candidate.printedNumber`, 11 `ui` fields
- **Merit modules** **15** — the widest module fan-out in the file
- **Callers** the Plan Intelligence review screen
- **Protected by** `plan-memory`, `plan-memory-isolation`, `plan-teach-area`,
  `teach-number`, `plan-label-ocr`, `plan-table-numbers`,
  `plan-number-integrity`, `plan-self-check`, `plan-confidence-budget`,
  `training-data-capture`, `operator-session`, `visual-second-opinion`
- **Single-writer risk** LOW for domain fields; `event.analysis` has exactly
  one real writer (`runAssistedDetection`, line 7294) plus a migration
  default.
- **Difficulty** MEDIUM. Each sub-capability is already a Merit module with a
  thin adapter here; `runAssistedDetection` is the orchestrator that ties the
  15 together and is the part that does not move easily.
- **Boundary** extract the adapters per module; leave `runAssistedDetection`
  last.
- **Target file** `src/plan-knowledge.js`
- **Missing test** that a Teach Area lesson scoped to a venue is **refused**
  for an object without a verified printed number, through the app path rather
  than the module's own unit test.

## A24 · Plan Intelligence review screen & dataset export

- **Lines** 7414–8246 (833)
- **Main functions** `analysisHTML`, `explainPlanHTML`, `reviewPoiCardHTML`,
  `reviewCenterPanelHTML`, `difficultQuestionCardHTML`, `openReviewQueue`,
  `queueGo`, `queueNextOutstanding`, `applyCorrectionToFamily`,
  `updateCandidateField`, `commitCandidates`, `recordCorrectionUndo`,
  `undoLastCorrection`, `buildTrainingDatasetExport`, `bindReview`,
  `improveAI`
- **Reads** `state.verifiedExamples`, `state.trainingData`,
  `state.calibration`; 18 `ui` fields
- **Writes** `state.calibration`, `event.planMemory`, `table.capacity`,
  `table.chairs`, 17 `ui` fields
- **Merit modules** `MeritTrainingData`, `MeritOperatorQuestions`
- **Callers** the Floor Plan's review mode
- **Protected by** `review-queue`, `operator-questions`,
  `training-data-capture`, `plan-intelligence-contract`, `symbolic-plan-capacity`
- **Single-writer risk** MEDIUM. `commitCandidates` (line 8080) writes
  `table.capacity` and `table.chairs` **directly**, outside
  `setTableCapacity`/`syncTableChairs`. That is a deliberate exception — the
  AI rules require confirmed chair coordinates to be written *verbatim* and
  never regenerated into a synthetic ring — but it is an exception the
  product rule does not currently name.
- **Difficulty** HIGH — largest `ui` surface after A08, and `bindReview` is a
  single ~70-line click router.
- **Boundary** split `bindReview`'s router from the HTML builders first.
- **Target file** `src/screen-plan-review.js`
- **Missing test** that `commitCandidates` preserves detected chair
  coordinates **exactly** (no re-generation) — the AI rule is documented and
  the code honours it, but no suite fails if a future "cleanup" routes it
  through `syncTableChairs`.

## A25 · Backup, package & offline recovery

- **Lines** 8247–8372 (126)
- **Main functions** `buildBackupPayload`, `exportBackup`, `importBackupFile`,
  `backupReferencesIntact`, `exportEventPackage`,
  `importEventPackagePayload`, `autoSnapshot`, `restoreLatestSnapshot`
- **Reads** `state.events`, `state.venues`, `state.audit`,
  `state.lastBackupAt`; `ui.screen`, `ui.activeEventId`, `ui.undo`, `ui.redo`
- **Writes** `state.audit`, `state.lastBackupAt`, `event.venueRef`, 4 `ui`
  fields
- **Merit modules** `MeritEventPackage`, `MeritOfflineRecovery`
- **Callers** Reports, boot (recovery)
- **Protected by** `backup-restore`, `event-package`, `offline-recovery`
- **Single-writer risk** none.
- **Difficulty** LOW.
- **Boundary** thin adapters over two modules plus file I/O.
- **Target file** `src/data-portability.js`
- **Missing test** none material.

## A26 · Shell binding & focus management

- **Lines** 8373–8543 (171)
- **Main functions** `bindV8Common`, `render`, `openEvent`, `duplicateEvent`,
  `openGuide`, `renderGuide`, `openerSelector`
- **Reads** `state.events`; **25 `ui` fields** — the widest read surface
- **Writes** **25 `ui` fields**, `event.background`, `table.chairs`
- **Merit modules** none
- **Callers** the boot path; `render` is called from everywhere
- **Protected by** `smoke`, `boot-contract`, `override-boundary`, `i18n`
- **Single-writer risk** LOW.
- **Difficulty** **HIGHEST. Do not extract.** This is the override layer
  itself: `render`, `bindCommon` (aliased to `bindV8Common`) and the other
  reassignments are what make `app-v8.js` the last script. Moving any of it
  changes the boot contract, which is why `boot-contract` exists.
- **Boundary** none. This area is the anchor the others are extracted
  *around*.
- **Target file** stays in `src/app-v8.js`
- **Missing test** none — `boot-contract` boots the real app and reads each
  overridden function back out of the page.

---

## What the map says in aggregate

**Size does not predict difficulty.** The largest area (A22, 2,926 lines,
34% of the file) is the *easiest* to extract, because it reads no shell
global and is reached through one provider interface. The hardest areas
(A26 at 171 lines, A12 at 74) are small and coupled.

| Difficulty | Areas | Lines |
|---|---|---|
| LOW | A02, A04, A05, A06, A07, A13, A14, A15, A19, A22, A25 | 3,980 |
| MEDIUM | A03, A09, A16, A18, A20, A23 | 1,952 |
| HIGH | A01, A08, A11, A12, A17, A21, A24, A26 | 2,611 |

**One field is the bottleneck.** `guest.assignment` is written from 8 sites
across A12, A17 and A21. Those three areas cannot be safely extracted
independently, and together they are 416 lines of the hardest tier. Fixing
that field's writer is not an extraction and should not wait for one.

**Three areas already have the right shape** — A19 (one writer per fact),
A04 (derives, stores nothing) and A22 (pure, one interface). They are what
the rest is being moved *towards*, and they are the evidence that the target
is cohesion rather than a smaller line count.
