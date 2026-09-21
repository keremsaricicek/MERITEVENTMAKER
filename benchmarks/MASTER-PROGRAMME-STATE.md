# FINAL MASTER QUALITY & COMPLETION PROGRAMME — state

**This file is the programme's memory.** It survives session boundaries.
A session resuming this work reads this file and the repository — never its
own recollection.

- **Programme start SHA** `02edac7`
- **Branch** `claude/merit-concept3-plan-intelligence-rebirth`
- **PR** #5 — OPEN, must not be merged
- **Current SHA** `02edac7`
- **Status** IN PROGRESS

## How to resume

1. `git rev-parse --short HEAD` and compare with "Current SHA" above.
2. Read this file's **Next step**.
3. Re-measure before trusting any number here — every figure is a dated
   snapshot, not a fact.
4. Continue. Never redo a completed step from memory.

## Gates after every production step

```
npm run test:all · npm run build:offline · npm run build:offline-full · npm run verify:offline
```
plus the benchmarks relevant to what changed. A step that cannot pass all
four is reverted, not patched forward.

---

## Measured starting state (`02edac7`)

| Fact | Value | Command |
|---|---|---|
| `src/*.js` | 34 files, 18,783 lines | `wc -l src/*.js` |
| `app-v8.js` | 5,740 lines, longest line 3,369, 41 lines >500 | `wc -l src/app-v8.js` |
| `plan-detection-classical.js` | 2,857 lines, longest line 331 | `wc -l` |
| `plan-intelligence.js` | 1,903 lines | |
| Suites / checks | 65 / 2,080 | `npm run test:all` |
| Offline | 27 / 27 | `npm run verify:offline` |
| `confirm()` / `prompt()` | 9 / 2 | `grep -o '\bconfirm(' src/*.js` |
| `innerHTML=` / `insertAdjacentHTML` | 13 / 1 | |
| `aria-*` / `role=` | 23 / 8 | |
| Security / a11y / resilience suites | **0 / 0 / 0** | `ls tests/suites` |
| `MAX_TABLES` | **240**, `plan-detection-classical.js:1917` — silent truncation | |
| Audit eviction | `slice(0,1000)` at `app-v8.js:87` and `:5529` — silent | |
| Adversarial | re-measuring at HEAD (see below) | `npm run benchmark:adversarial` |

---

## Work log

Each entry: what changed, its commit, and the evidence. Append only.

### A. §1 — quality-doc corrections — DONE (`dd263e0`)
- [x] `QUALITY-TEAM.md`: UI/UX single owner (`premium-ui-director`),
      `visual-qa-reviewer` recorded as the measurement owner
- [x] `MASTER-PROGRAMME-READINESS.md`: adversarial count re-measured at HEAD
      three times — **1 PASS · 4 PARTIAL · 3 FAIL**, stable. The externally
      cited 1/5/2 does not reproduce here; the discrepancy is recorded with a
      resolution path rather than adopted.

### B. §8 — the 240-table ceiling — DONE
`MAX_TABLES` in `src/plan-detection-classical.js` was **240**, which sits
INSIDE the range real venues occupy. The `a8-large-venue` fixture has 324
ground-truth tables, the detector returned exactly 240, and the reported
table recall was 0.741 — which is 240/324 to four figures. The cause was
proven arithmetically, not guessed.

Raised to **2000**. The slice feeds fragment suppression, which is the real
junk filter and runs BELOW it, so raising the ceiling cannot admit junk and
every plan under it is bit-identical.

Evidence: `a8` table recall **0.741 → 0.892**; every other fixture
byte-identical; Golden and ORNEK baselines "No regressions. 0 improvement(s),
0 note(s)".

New suite `large-venue-scale` (business/fast): asserts the ceiling is far
above real-venue scale AND drives a real 420-table / 900-guest / 4,200-seat
event through the domain — capacity arithmetic, assignment, a save round
trip. The second half is what would catch a loss introduced somewhere other
than the detector.

### C. §4 — physical chair / logical seat / capacity — DONE
Two collapses, both shipped, both closed.

**In storage.** `syncTableChairs` synthesised one chair object per capacity
slot for EVERY table and tagged the invented ones `physical:false`. A
420-table symbolic plan therefore stored **4,200 chairs at coordinates
nothing had ever observed**, re-derived and re-persisted on every save. A
flag disowning a coordinate is not the same as not writing it. `table.chairs`
now holds physical chairs only and is `[]` where the plan drew none; the
`physical` flag is retired, so presence in the array IS the claim. Existing
installs shed their fabricated chairs on the first load, through
`migrateEvent` — capacity, assignments and seat indexes untouched, and a
physical table's real coordinates carried across verbatim.

**In judgement.** "Can this table seat somebody" was asked as
`hasPhysicalSeats !== false && capacity > 0` in six places. On a symbolic
plan — numbered circles with a printed pax figure, an ordinary kind of venue
drawing — that answered NO for every table in the room: Smart Seating offered
nothing, freezes covered nothing, service load saw an empty room, the Plan
Doctor opened the event with "the plan carries no chairs" BLOCKING, and the
Home hero printed "No tables in the plan yet" over a 420-table plan — all
while Seating was assigning guests to those same tables. Seatability is now
`capacity > 0`.

New module `src/seat-model.js` (`globalThis.MeritSeatModel`, 91 lines, pure,
reads no shell state) holds the one definition of each quantity:
`logicalSeatCount` · `physicalChairCount` · `canSeat` · `drawsChairs` ·
`seatingCapacity` · `physicalCapacity` · `seatableTables`. Loaded as script
**4 of 35** in `index.html`, before `app.js`. Consumed by `app.js`,
`app-v8.js`, `plan-doctor.js`, `seating-advisor.js`, `seating-freeze.js`,
`service-load.js`, `table-availability.js`.

`MeritSeatingAdvisor`'s blocked reason `NO_PHYSICAL_SEATS` became `NO_SEATS`
— it names capacity, which is the real hard stop, instead of what the drawing
depicted. No i18n key referenced it.

Two suites re-specified against the corrected contract, both strictly
stronger than what they replaced:
- `physical-logical-seat-separation` asserted `chairs.length === capacity` on
  a symbolic table. It now asserts **zero** chair objects, that the flag is
  gone from the model, that a symbolic table still seats a +2 party on its
  logical seats, that detected coordinates survive a capacity sync
  byte-identically, and that the two totals stay different numbers.
- `smart-seating` asserted a symbolic table "is not a place to sit". It now
  asserts the symbolic table IS offered, and that a table with **no seats at
  all** is blocked as `NO_SEATS` — the genuine hard stop, tested against the
  engine because the shell clamps capacity to at least one.

One thing the step broke and the gates caught, worth recording because the
lesson is not about seats. Routing six consumers through the new module, I
pasted the same seven-line rationale comment into four of them —
duplication in prose, in the very commit whose point was one definition.
`offline-bundle-contract` failed: it identifies each source file inside the
bundle by the 160 characters at its midpoint, and `table-availability.js`'s
midpoint had landed on the duplicated passage, so its probe occurred four
times and the BUNDLE ORDER check became arbitrary. Nothing about the order
had changed. Fixed in both directions — the comment is one line per module
now, with the reasoning kept in `seat-model.js`; and the suite searches for
a window that IS unique instead of assuming the midpoint is one, asserting
the honest version of the control (every file must carry SOME uniquely
identifying window). Both halves proved to bite by mutation: sorting the
bundle alphabetically produced 18 out-of-order transitions, and making two
sources byte-identical produced 2 files with no unique window.

Docs corrected to match measured reality: `CLAUDE.md`,
`.claude/rules/product.md`, `.claude/rules/code-health.md`,
`merit-product-contract` (the "CURRENT LEGACY IMPLEMENTATION" section is gone
— the migration it described has happened), `merit-data-integrity-hardening`,
`APP-V8-OWNERSHIP-MAP.md`, `tests/README.md`.

---

## Measured after §8 + §4

| Fact | Value |
|---|---|
| `src/*.js` | 35 files, 19,009 lines |
| `app-v8.js` | 5,799 lines |
| `src/seat-model.js` | 91 lines (new) |
| `index.html` classic scripts | 35 |
| `MAX_TABLES` | **2000** |
| Offline verification | 27 / 27 |

---

## Next step

§7 — plan reliability. The three FAIL fixtures at `02edac7` are `a2`
(7 real tables detected then held back as unknown; 23 FP vs 21 GT), `a5`
(8 chairs proposed on a drawing with no furniture), `a6` (46 FP vs 8 GT,
architecture read as furniture). §8's ceiling fix already moved `a8`'s
table recall to 0.892. Re-measure `npm run benchmark:adversarial` before
choosing which to attack.

Also still open from the audit: §11 audit durability (`slice(0,1000)` at
`app-v8.js:87` and `:5529`, silent), §13 write ordering (`saveState()`
chains onto `saveQueue` but returns `undefined`, so no caller can await a
save), §14/§15/§19 security / accessibility / resilience (zero suites each),
§16 `confirm()`/`prompt()` removal (9 / 2).

## Permanent constraints (do not re-derive)

- No EXE, no Electron/Tauri/MSIX, no packaging-technology choice.
- No SQLite runtime. Storage boundary and migration design only.
- Do not merge PR #5. Do not touch other branches.
- No framework migration, no TypeScript, no bundler.
- Never lower a threshold, delete a fixture, or skip a test to get green.
- Never fabricate a human operator session or a third real plan.
- Synthetic fixtures are encouraged, and are labelled SYNTHETIC.
