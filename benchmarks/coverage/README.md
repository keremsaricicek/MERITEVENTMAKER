# What the suites actually execute — §28

```
MERIT_COVERAGE=1 npm run test:all        # V8 block coverage, merged over every suite → report.json
node benchmarks/coverage/analyse.mjs     # the four §28 questions, answered from it
```

Not a percentage. §28 of the master programme asks four questions, and a
coverage figure answers none of them on its own:

1. **Unreachable production regions** — answered statically by
   `tests/lib/reachability.mjs` (the pre-v8 bodies `app-v8.js` overrides and
   never calls back), and now **cross-checked**: `analyse.mjs` reports any
   "unreachable" body a suite executed, because that means the static model is
   wrong.
2. **Critical business paths with no behaviour test** — reachable functions no
   suite ever ran, filtered to the modules that own an operator-critical fact.
3. **Critical error branches with no test** — the largest never-executed
   stretches in those modules, by line.
4. **Dynamic branches never executed** — the same, everywhere (`report.json`,
   `largestGaps` per file).

`report.json` is **INFO**, not a gate, and a dated snapshot: re-measure with
the two commands above.

## What the first run found (2026-09-27, 97 suites, 3,089 checks)

**The static model was wrong in the direction that hides code.** It called the
pre-v8 `render` and `eventsHTML` unreachable; V8 coverage showed both running.
Cause: `app-guests.js` **ended with `render()`**, so at every boot the retired
pre-v8 shell drew itself — **in English** ("Event Operations / All Events /
Create Event") — for ~50–90 ms before `app-v8.js` replaced it. Measured with a
DOM observer: English frames from 165 to 214 ms, the Turkish screen at 251 ms.
The load-time render was removed; the first frame is now the real screen, at
178 ms. The i18n scan had never looked at that code, because the model it
trusted said it could not run.

**152 reachable functions no suite executed.** In the operator-critical
modules, the paths that mattered, now covered by `critical-paths`:

| path | what running it found |
|---|---|
| importing the floor plan from a **file** — PNG, and a PDF with its page choice | every suite set `event.background` directly. The PDF page choice **threw** "Cannot use the same canvas during multiple render() operations" into the page: `bindSetup()` runs on every render and each schedules a thumbnail pass, so two passes could draw on one canvas. A canvas is now claimed before its first await. |
| persistence when **IndexedDB is unavailable** | the documented localStorage fallback **could not engage**: `new IndexedDBStorageProvider()` never throws, so every save failed and a reload came back empty. `ResilientStorageProvider` now falls back only when IndexedDB is absent or forbidden by policy (`SecurityError`). One that exists but will not open, is blocked, or is full is NOT a reason to move the data — it may hold the evening, and a second store would hide it. The suite holds both sides. (A first version also fell back on `InvalidStateError`; `resilience-storage` caught that on the gate run — it silently replaced the "could not be opened" notice with an empty app.) |
| the audit trail at its **100,000-entry cap** | the eviction branch, the retention record and its reload had never run. They work. |
| the assignment **lock** | never pressed in any suite. It works; the suite now proves a locked party cannot be moved. |
| the guest **Excel template** | never downloaded. It is a real workbook with the importer's columns. |
| schema 8 → 9 on a **physical** table with placeholder chairs | the branch that drops them had never run. It works. |
| an event package with **malformed chairs** | the three refusals had never run. They work. |

**Two hollow checks.** `capacity-provenance` and
`physical-logical-seat-separation` each re-implemented `commitCandidates()`'s
expression inside the test and asserted the copy — a test of itself, which no
change to the product could fail. Both now press the real Commit button; each
was shown to fail when the real expression is mutated.

## Recorded, not changed

- **Dead exports** — `MeritSeatingFreeze.openCapacityOutsideFreeze`,
  `MeritSeatAssignment.isSeated`, `MeritSeatModel.drawsChairs`: no reference
  outside their own module (stripped-code scan, `index.html` included) and
  never executed in 97 suites. That is the recorded proof
  `benchmarks/CODE-INVENTORY.md` asks for; removing them is a refactor commit
  of its own, not part of a test section.
- **IndexedDB request-level error handlers** (`req.onerror`, `tx.onabort`, …)
  are still not executed by a real IndexedDB failure. The fallback decision is
  tested with a provider whose store throws; forcing a real IndexedDB request
  error in Chromium is not reliable enough to hold a gate.
- The remaining never-executed functions in `app-v8.js` and `app.js` are listed
  in `report.json`. Most are pre-v8 bodies the static model proves unreachable
  or event-handler arrows the suites reach by a different control.
