# MERIT ENTERTAINMENT — EVENT MAKER

Internal, browser-only event-operations software for premium hospitality/
casino event management (Events, Floor Plan, Guests, Seating Plan, Live
Event, Reports, Plan Intelligence, Teach AI). No backend — state lives in
`localStorage`. See `README.md` for how to run it and the project
structure; see `.claude/skills/merit-product-contract/SKILL.md` for the
full domain contract.

## Current stage: BROWSER REVIEW

This is not an EXE/Electron/desktop-packaging project right now. Desktop
architecture knowledge and skills may be prepared, but nothing gets
packaged, installed, or bundled until the user types the exact phrase
**"EXE YAP"** in the conversation. Installing an Electron-related skill or
discussing desktop architecture is never itself authorization to build one
— see `.claude/skills/merit-desktop-architecture/SKILL.md`.

The end user must never be asked to install Python, Node.js, pip, a venv,
or run any terminal/setup step. Whatever hides behind the eventual desktop
build is a developer-time concern only.

## Non-negotiable domain rules

- **Guest = one record.** "Name +3" is a named guest plus 3 companions,
  total pax 4 — never four separate records. Companion seats export as
  `GUEST OF [PRIMARY NAME]`.
- **Planning status** (Confirmed/Tentative) and **arrival status** (Not
  Arrived/Checked In/No Show) are independent axes. Neither changes the
  other.
- **No Show** preserves the guest's planned seating assignment but
  releases live operational capacity — these are two different concepts
  (`occupiedSeatIndexes` vs. `liveUsedIndexes`), never merge them.
- **Chairs are first-class objects** backing table capacity — never let
  `table.capacity` drift out of sync with `table.chairs`.
- **Historical events are immutable** (`status === "Completed"` or a past
  date) — enforce this in domain logic (`canMutate`), not only in the UI.
- **Reports are regression-sensitive.** TABLE PLAN / GUEST LIST /
  UNASSIGNED sheet contracts and companion-seat export formatting must
  survive any change touching guest/table/seat data.
- **Blank events are actually blank** — never seed sample tables, guests,
  or a demo background into a new event.

Full detail: `.claude/skills/merit-product-contract/SKILL.md`.

## UI standard

Premium, restrained, operational desktop software — not a generic AI
dashboard, card wall, or gradient-heavy template. One coherent light/warm
palette app-wide (the old dark-graphite shell was fully retired, not just
recolored — see `src/styles.css`'s root tokens and the `--pi-*` tokens
they now cohere with), warm-paper Floor Plan canvas, controlled cool-blue/
teal interaction state, semantic-only color, VERY restrained VIP gold.
Body text ~12–14px; dense, not unreadable. Desktop-first at 1920×1080 /
2560×1440 / ~1440px.

The Floor Plan default editing view and the Plan Intelligence review
screen ("Concept 3 — Live Map") still use their own `--pi-*`-scoped
component patterns (no permanent left object list or right technical
inspector — a floating minimal toolbar, a contextual card on selection, a
bottom status pill) since each screen is designed for its own job, not a
single reused component set; but the underlying color language is now the
same one used everywhere else in the app. Don't reintroduce a second,
visually distinct dark system for any screen.

**A UI change is not done until it has been rendered and screenshotted** —
source/markup review is not a substitute. Full detail:
`.claude/skills/merit-ui-constitution/SKILL.md`.

## Captured decisions

Every human decision in the review screen stores a training example with the
real image crop, the plan hash, the venue/layout/version it came from, what
the detector had predicted, and which build predicted it — five decision
types, including negatives ("Not important" is a stored example, never a
delete). This is a data foundation: it trains nothing, and `trainedModel`
stays false. Labels spread across a family are marked as not individually
reviewed. Dataset splits are grouped by plan, never by example. Full detail:
`benchmarks/TRAINING-DATA.md`.

## The Teach Area

What an operator knows about a room is kept as a **note with a scope** — this
plan, this layout, this venue — and offered again where it applies. It is
retrieval, not learning: nothing is fitted, and the wording never says
otherwise in either language. One lesson changes one object, never everything
that resembles it; identity comes from Visual Plan Memory, so AMBIGUOUS still
means nothing is touched; and a venue-wide note about an object is only acted
on when the object carries the same verified printed number. Full detail:
`src/plan-teach-area.js` and `benchmarks/OPERATIONAL-INTELLIGENCE-ROADMAP.md`.

## The Plan Doctor

One layer answers "can this event safely proceed?" and everything else reads
it — the header badge, the Command Center's attention list and the pre-flight
report all come from `src/plan-doctor.js`, so the product cannot say two
different things about one event. It runs no engine of its own and stores
nothing: the report is derived on every read, so a fixed problem disappears by
itself. **A reading is not an operational fact** — two tables a person numbered
the same is BLOCKING, two tables OCR *read* as the same number is NEEDS REVIEW,
and collapsing those two is a revert. Every finding names what is wrong, why,
its source, what it affects and where to go; a finding that cannot say where to
go does not belong in this layer. Full detail:
`benchmarks/EVENT-OPERATIONS-PRODUCT-REPORT.md`.

## Layout changes

What moved since the room was published is `MeritVenueModel.compareToVersion`,
surfaced as a MODE of the Floor Plan on the same canvas — never a second drawing
of the room. Identity is **verified table number first, position second, and no
visual similarity at all**: Table 42 that moved is `TABLE 42 MOVED`, never a
removal plus an addition. One matched pair emits one change per aspect that
differs, so a table that gained seats without moving is `CAPACITY_CHANGED` and
not `MOVED`. `ADDED`, `REMOVED` and `STAGE_CHANGED` are peers — a stage that
appeared is added, not changed. Confirmation is offered only where identity is
UNCERTAIN, and is stored against the version it was made about. Full detail:
`src/venue-model.js` and `benchmarks/EVENT-OPERATIONS-PRODUCT-REPORT.md`.

## The guest finder

The global search answers the whole question in the row — pax, VIP, planning
status, arrival status, table, seats, zone and who invited them — and offers the
four things an operator does next. **Nothing it offers moves a guest**: CHANGE
TABLE opens Seating with the guest selected and waits for a person, and CHECK IN
writes arrival status only, never planning status. An action that cannot apply is
disabled with its reason on the control. Speed is an index keyed on
`event.lastModified`, not a promise — the suite measures a search over four
thousand guests rather than asserting one. Full detail: `src/app-v8.js`
(`guestSearchIndex` / `findGuests`) and `tests/suites/guest-finder.test.mjs`.

## Smart Seating

`src/seating-advisor.js` **cannot seat anybody** — it returns options and
arithmetic and has no path to an assignment. The only writer is the existing
`assignGuestToTable()`, called from one line behind the Apply button. Keep that
boundary: it is what makes "never silently move or seat guests" structural
rather than a promise. Options carry **named reasons, never a score**; a party is
one record and is never split across tables to make the numbers work; a locked
assignment outranks every suggestion; and a constraint with no implementation yet
(unavailable tables) reports **not set up yet** rather than "no conflict" — the
day it ships, that same slot carries a real answer, as Freeze Zones now does.
Nothing mutates until a person presses Apply, and the preview shows the
arithmetic they will get, exactly. Full detail: `src/seating-advisor.js` and
`tests/suites/smart-seating.test.mjs`.

## Freeze zones

A freeze is a **rule about a place**, not a list of table ids: a zone freeze
covers a table moved into the zone tomorrow, a range freeze covers a `T07`
created tomorrow. `src/seating-freeze.js` owns those rules and nothing else
evaluates them — the advisor, the canvas, the Plan Doctor and the override
challenge all consume its resolved answer, so they cannot disagree about what is
held. A table is OPEN or FROZEN; **SUPERVISOR OVERRIDE REQUIRED is the state of
an OPERATION**, not a fourth kind of table. Every path that changes an
assignment runs the same evaluation, in both directions — filling a held area
and emptying a frozen head table are both crossings. An override is a
**parameter spent on one call**, never stored state: the freeze is still
standing for the next operation, and lifting it is a separate, recorded act by a
person. Defined in Seating, drawn on the Floor Plan as a layer that outlines
rather than covers. Full detail: `src/seating-freeze.js` and
`tests/suites/seating-freeze.test.mjs`.

## The Event Risk Radar

"What could make this event fail operationally?" — answered in the Command
Center from the Plan Doctor and nothing else. It **runs no engine of its own**:
every row is a fact another layer already concluded, so the radar cannot
disagree with the pre-flight report. Two refusals are load-bearing. It shows
**no percentage** — there is no honest weighting of one duplicate table number
against twelve unseated guests, so it names one of four states (READY / READY
WITH REVIEW / NOT READY / LIVE RISK) and lists the reasons. And it **says what
it cannot see**: risks this build does not model (`MeritPlanDoctor.NOT_EVALUATED`)
are printed under the verdict, because a radar that shows only what it knows how
to look for teaches an operator that a quiet radar means a safe event. Every row
carries a control; the backup row's control is the export itself, because "go
and find the button" is the dead end this layer forbids. INFORMATION never
reaches the radar — that is the difference between it and the pre-flight report.
Full detail: `src/plan-doctor.js` and `tests/suites/risk-radar.test.mjs`.

## Plan Intelligence honesty

Assisted Detection today is classical computer vision, not a trained
model — label it "Assisted Detection," never "AI." If no trained domain
model exists, say **"DOMAIN MODEL NOT INSTALLED"** rather than implying
one is running. Never fabricate detections, confidence scores, or model
metrics. Full detail: `.claude/skills/merit-plan-intelligence/SKILL.md`.

## Tests

`npm test` runs the regression suite in `tests/` (real UI, real Chromium, its
own server, ~2 min). It is the first thing to run and the first thing to
extend: a behaviour change no suite would have caught needs a suite. Detector
changes are measured with `npm run benchmark` and checked against the
committed `benchmarks/BASELINE.json` — never against remembered numbers.

When a detector count comes up short, **diagnose before theorising**:
`benchmarks/heldout/ornek-stage-walk.mjs` names the stage each missed object
died at, and `ornek-miss-taxonomy.mjs` reports found-vs-missed as distributions
of the quantities the detector actually reasons about. Phase 6 guessed at three
causes and measurement contradicted two of them.

Full detail: `tests/README.md`, `benchmarks/README.md`,
`.claude/rules/testing.md`.

## Data integrity

Persisted state must never silently corrupt guest/table/chair/assignment
relationships across a schema migration, and historical events must stay
immutable at the storage layer. Full detail: the `data-architecture-
engineer` agent and `.claude/skills/merit-product-contract/SKILL.md`.

## Delegation

Route significant work to the matching specialist in `.claude/agents/`
rather than doing everything from one broad context — product-semantics
questions to `merit-product-director`, visual direction to `premium-ui-
director`, rendered verification to `visual-qa-reviewer`, and so on. See
`.claude/rules/` for short, durable per-domain constraints, and
`.claude/skills/` for the full reference material each agent draws on.
Don't let two agents edit the same central UI file at the same time.

## This session's scope

The engineering environment under `.claude/` and this file are the
deliverable of the session that created them — not a license to also
redesign the product, build the EXE, or implement Plan Intelligence
end-to-end just because the relevant skills now exist. Read
`.claude/SOURCES.md` for exactly what was vendored and why, and what was
deliberately left out.
