# Modularization order — proposal

**Status: proposal. Nothing here has been implemented.** This document is the
output of the ownership map, not a plan that has started.

The order below is **derived from measurement**, and it is not the order that
seems obvious. The obvious order is by screen — Guests, then Seating, then
Live, then Reports — because that is how the product is organised. The map
says that order is wrong, for three reasons the evidence makes plain:

1. **The biggest area is the easiest.** A22 (Assisted Detection, 2,926 lines,
   34% of the file) reads no shell global, writes nothing, and is reached
   through one provider interface. Extracting it is a file move. Extracting
   the Guests screen is not.
2. **Three screens share one broken field.** `guest.assignment` is written
   from 8 sites across Guests (A21), Seating (A17) and the canvas (A12).
   Taking any one of those screens out first leaves the other two writing the
   same field from another file. Screen-by-screen extraction makes that worse
   before it makes it better.
3. **Two capabilities are interleaved by line, not by screen.** Layout changes
   occupies 1426–1459 and 1632–1726 with Floor Plan chrome between. No
   screen-shaped cut separates them.

So the order is: **prove the boundaries, take the free win, fix the one broken
field, then take screens.**

Each step is one commit. `.claude/rules/code-health.md`'s four gates run after
**every** step, not at the end:

```
npm run test:all · npm run build:offline · npm run build:offline-full · npm run verify:offline
```

---

## Step 0 — the safety net *(done: this commit)*

**Why first.** The rule was "dependency direction is enforced by grep, not yet
by a suite. That suite is required before the first screen extraction." An
extraction cannot be verified against a rule nothing checks.

- **Responsibility moved** none. Tests and documents only.
- **Not moved** all production code.
- **Characterization test required** —
- **Delivered** `dependency-direction` (the one-way rule, comment/string-aware),
  `boot-contract` (load order + the override contract, verified in a real
  browser), `offline-bundle-contract` (the build's slicing and ordering
  contract), plus this document, `APP-V8-OWNERSHIP-MAP.md` and
  `CODE-INVENTORY.md`.
- **Blast radius** none — no production file changed.
- **Rollback** delete the suites.

---

## Step 1 — extract the detection pipeline (A22)

`src/app-v8.js:3288–6213` → `src/plan-detection-classical.js`

**Why this order.** It is the largest single reduction available (−34% of the
file) at the lowest risk in the file. The area reads no `state`, no `ui`,
calls no `render`, and every caller reaches it through one object:
`{id, label, trainedModel:false, detect(pixels,width,height,hooks)}`. The
boundary is not something this step invents — it already exists and
`resolvePlanDetectionProvider` already honours it. Doing it first also proves
the Step 0 suites work on a real move, while the move itself is the one least
able to break the product.

**Responsibility moved** all classical CV: tone/accent models, masks,
component labelling, OBB fitting, shape analysis, size priors, splitting,
geometry helpers, the visual descriptor and both provider resolvers.

**Not moved** `runAssistedDetection` (A23) — it is the orchestrator, it writes
`event.analysis` and drives `ui.analysisStage`. It stays in `app-v8.js` and
keeps calling the provider exactly as it does now.

**Characterization test required** none new for behaviour: the detector is
*measured*, not asserted. `npm run benchmark` + `benchmarks/BASELINE.json`
compare every guarded field per plan, and a trade (chair recall up, table F1
down) is already a failure there. What **is** required is the structural
assertion that the provider interface is the only way in — a check that the
new file exports nothing else and that `app-v8.js` references no function from
it by name.

**Blast radius** Plan Intelligence only. No screen, no storage, no reports.
`benchmarks/BASELINE.json` must be byte-identical after the move; if any
guarded field changes, the move was not behaviour-preserving.

**Rollback** revert one commit; the file is self-contained.

---

## Step 2 — consolidate the `guest.assignment` writer (A12 + A17 + A21)

**No file moves. This is not an extraction.**

**Why this order.** It is the single highest-value change in the whole
programme and it blocks three of the eight HIGH-difficulty areas. The product
contract names `assignGuestToTable()` as the only writer of a guest's seat;
today that holds for the seating path and not for the other two:

| Site | Area | What it does |
|---|---|---|
| `:2406` | A17 | seats a party |
| `:2418`, `:2422`, `:2438` | A17 | undo/restore paths |
| `:1732` | A12 | `deleteSelection` nulls assignments when a table is deleted |
| `:3157`, `:3180`, `:3192` | A21 | `deleteGuest` / `unassignGuest` / undo restore |

Eight sites, three areas. Extract any one screen first and the field is then
written from two files instead of one — the refactor would have made the
contract *harder* to hold.

**Responsibility moved** none between files. All eight sites are routed
through one writer in place, which also becomes the single place the freeze
evaluation and the audit entry happen — as `setArrival()` already is for the
arrival axis (A19 is the model this step copies).

**Not moved** the seat-packing arithmetic, the freeze challenge lifecycle, and
the undo snapshot format all stay where they are. This step changes who calls
whom, not what anything computes.

**Characterization test required — write and mutation-prove BEFORE the
change:**
1. deleting a table with seated guests unassigns them **and** writes the same
   audit entry an explicit unassign writes (no suite covers this today);
2. undo after `deleteGuest` restores the assignment, **including** the
   contested-seat case where the seat was taken in the meantime
   (`snapshot.assignment=null; seatLost=true`, `:3157` — real logic, no
   suite);
3. a structural test, in the spirit of `dependency-direction`, asserting that
   `guest.assignment` is assigned from exactly one function.

Test 3 is what makes this step permanent rather than a one-time tidy.

**Blast radius** Seating, Guests, Floor Plan deletion, undo, and the freeze
override path. High. This is why the tests come first and why it is its own
commit with nothing else in it.

**Rollback** revert one commit; no file structure changed, so the revert is
clean.

---

## Step 3 — extract the domain primitives (A02 + A03-domain + A04)

`src/event-rules.js`, `src/occupancy.js`, `src/event-resolution.js`

**Why this order.** These are the functions every screen calls, so they must
be out before any screen moves — otherwise each screen extraction drags a copy
of the rules with it. All three are LOW difficulty: they are pure functions of
an event, they write no `ui`, and A04 already has the target shape (derives on
read, stores nothing).

**Responsibility moved** `isHistorical`, `canMutate`, `chairGeometry`,
`syncTableChairs`, `refreshChairOccupancy`, `audit` (A02); `physicalCapacity`,
`liveUsedIndexes`, `liveStats` (A03's domain half); the freeze/availability/
capacity-provenance resolvers and `planDoctorReport`/`eventReadiness` (A04).

**Not moved** `tableObjectHTML`, `tableMatchesFilter`, `filterBannerHTML` —
these live in A03's line range but are Floor Plan *rendering* and belong with
A11. `doctorText`/`doctorGoHTML`/`ccCheckText` stay with A08 for the same
reason. The cut is by responsibility, not by line range.

**Characterization test required** `canMutate`'s refusal path as a unit — that
a historical event's mutation is rejected **and** produces its reason — rather
than only through a disabled button. And the A03 pair test: that
`liveUsedIndexes` and `occupiedSeatIndexes` **disagree** for a No Show. No
suite asserts that pair today, and it is the product's most important
operational rule.

**Blast radius** every screen, shallowly. `canMutate` needs its `toast` call
injected rather than reached for, which is the only real change of shape.

**Rollback** revert one commit. Watch for the silent case: an extraction that
accidentally resolves an overridden name to its pre-v8 body. `boot-contract`
is the guard, and it is why Step 0 came first.

---

## Step 4 — untangle layout changes from the Floor Plan (A11)

**Two commits, in this order, and the first moves no file.**

**Why this order.** Layout changes occupies `1426–1459` and `1632–1726`, with
Floor Plan toolbar, contextual card, bulk panel and ghosts in between. No cut
by line range separates them. Making the range contiguous is a
no-behaviour-change commit; extracting it is a second one. Merging the two
would produce a diff in which a real behaviour change could hide.

**4a — make it contiguous.** Move the layout-change functions together inside
`app-v8.js`. Nothing leaves the file. Diff is pure movement.

**4b — extract.** `src/layout-changes-ui.js`, then `src/screen-floor-plan.js`.

**Responsibility moved** layout-change detection and review UI; then the
Floor Plan workspace chrome plus A03's three rendering functions.

**Not moved** the canvas object lifecycle (A12) — it is blocked behind Step 2
and comes later.

**Characterization test required** that the mode switch preserves selection
and draws on **the same canvas** — `floor-plan-modes` covers the modes
existing, not the "never a second drawing of the room" invariant, which is the
contract this screen is most likely to lose in a move.

**Blast radius** Floor Plan and Plan Intelligence review mode (they share the
canvas).

**Rollback** revert 4b, then 4a if needed. Keeping them separate is what makes
a partial rollback possible.

---

## Step 5 — the clean adapters (A05, A06, A07, A14, A15, A19, A25)

Onboarding, handover, audit trail, Smart Seating, service load, the arrival
writer, data portability.

**Why this order.** Seven LOW-difficulty areas, ~500 lines, each a thin
adapter over a Merit module that already exists. They are deliberately **not**
first: they are the smallest win per commit, and doing them early would have
spent the programme's early credibility on changes nobody notices. After Step
4 they are routine.

**Responsibility moved** each adapter joins its module (`src/event-handover.js`,
`src/audit-trail.js`, `src/service-load.js`) or becomes a small new file
(`src/onboarding.js`, `src/arrival-writer.js`, `src/data-portability.js`).

**Not moved** the HTML builders that render these panels, where they are
screen-specific.

**Characterization test required** none new — all seven are covered by
existing suites (`onboarding`, `event-handover`, `audit-trail`,
`smart-seating`, `service-load`, `arrival-wave`, `backup-restore`,
`event-package`, `offline-recovery`).

**Blast radius** small and local per area. Can be several commits.

**Rollback** per area.

---

## Step 6 — the screens

**Only now**, and in this order: Seating (A13+A17) → Guests (A21) → Live
(A18) → Reports (A20) → Plan review (A24) → Command Center (A08).

**Why this order.** Seating first because Step 2 has already made its
assignment writer the single one, so the extraction carries a fact that is
already true. Guests and Live follow because they depend on it. Reports is
fourth because the XLSX contract is the most regression-sensitive surface in
the product and benefits from every earlier step having settled. Plan review
(A24) and Command Center (A08) are last because they have the widest `ui`
surfaces in the file — 18 and 22 fields read, 17 and 21 written.

**Not moved, at any point:** A26. `bindV8Common`, `render` and the
reassignments *are* the override layer; they are why `app-v8.js` is the last
script in `index.html`. It is the anchor everything else is extracted around.

**Characterization test required** per screen, before it moves — the missing
tests are named per area in `APP-V8-OWNERSHIP-MAP.md`. Two are worth
repeating: that every Risk Radar / pre-flight control's destination actually
resolves (A08), and that `commitCandidates` preserves detected chair
coordinates verbatim rather than regenerating a ring (A24).

**Blast radius** one screen per commit, which is the point of leaving them
until last.

**Rollback** per screen.

---

## What this order is optimised for

Not line count. `app-v8.js` is 8,543 lines and Step 1 alone removes 2,926 of
them — but Step 2, the most valuable step in the programme, removes **zero**.
The target is the property the map measured: **every domain fact has exactly
one writer, and the dependency graph stays one-way.** Steps 0 and 2 serve that
directly and move nothing.

Order of first four steps, stated plainly:

| Step | What | Lines moved |
|---|---|---|
| 0 | prove the boundaries | 0 |
| 1 | extract the detection pipeline | 2,926 |
| 2 | one writer for `guest.assignment` | 0 |
| 3 | extract the domain primitives | ~430 |

Two of the four move nothing. That is the proposal's main claim.
