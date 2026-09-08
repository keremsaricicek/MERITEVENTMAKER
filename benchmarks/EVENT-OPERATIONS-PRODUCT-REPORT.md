# MERIT EVENT MAKER — event-operations product programme

**Branch** `claude/merit-concept3-plan-intelligence-rebirth`
**Starting head** `ee069590ac861823ed1bd25414d8fcd134a9f103`
**PR** #5

This is the consolidated report for the product programme. It records what was
measured, what was built, what was rejected, and — with equal weight — what is
still not verified. No marketing language; every number here came from a command
whose output is in the repository.

---

## PHASE A — Beta Core, frozen

The point of this phase is to be able to prove later that product work did not
move the plan reader. Nothing was changed; everything was run and recorded.

State at the start, verified rather than assumed:

```
branch   claude/merit-concept3-plan-intelligence-rebirth
head     ee069590ac861823ed1bd25414d8fcd134a9f103
tree     clean
```

### BETA CORE BASELINE

Fourteen commands, each to its own log, with exit code and wall-clock cost.
Machine-readable copy: `benchmarks/beta-core-baseline.json`.

| command | exit | time | result |
|---|---|---|---|
| `npm test` | 0 | 213s | **27/27 suites, 818/818 checks** |
| `npm run test:all` | **1** | 245s | 32/33 suites, 1011/1013 — see *known failing* |
| `npm run benchmark` | 0 | 25s | detection table below |
| `npm run benchmark:baseline` | 0 | 0s | **No regressions. 0 improvements, 0 notes.** |
| `npm run benchmark:adversarial` | 0 | 33s | |
| `npm run benchmark:zones` | 0 | 63s | |
| `npm run benchmark:facts` | 0 | 22s | |
| `npm run benchmark:contradictions` | 0 | 35s | |
| `npm run benchmark:review-order` | 0 | 49s | |
| `npm run benchmark:false-positives` | 0 | 45s | |
| `npm run benchmark:teaching` | 0 | 17s | |
| `npm run benchmark:memory` | **1** | 93s | gates unmet on *transformed* drawings — known |
| `npm run perf` | 0 | 15s | |
| `npm run verify:offline` | 0 | 8s | **27 passed, 0 failed** |

#### Detection — the numbers product work must not move

| plan | | |
|---|---|---|
| **merit-real-venue** (PHYSICAL) | tables | P **0.92** · R **1** · F1 **0.958** (46/46, 4 fp) |
| | chairs | P **0.955** · R **0.947** · F1 **0.951** |
| | relations | **0.99** (100 correct, 1 wrong, 0 orphan) |
| **ornek-symbolic** (SYMBOLIC) | tables | P **0.994** · R **0.976** · F1 **0.985** (162/166, 1 fp) |
| adversarial architecture | | 10/10, F1 1 · columns 6/6 |
| adversarial bistro | | 18/23, P 1, R 0.783, F1 0.878 |
| adversarial dense | | 24/24, F1 1 |
| adversarial text | | 12/12, F1 1 |

Every figure matches the protected values in the programme brief. The detector
baseline guard independently confirms it: **no regressions, per plan, per field.**

Visual Plan Memory: retention **0.7857**, identity precision **0.9448**, wrong
application **0.0552** — against gates of ≥0.98 / ≥0.98 / ≤0.01. Not met on
transformed drawings, met on an unchanged one. Known, measured, accepted.

#### Known failing — and one of them matters to this programme

**`plan-intelligence-contract`, 2 of 90 checks.** Verified **pre-existing**: the
identical two checks fail in a clean worktree at `cb263eb`, the commit this
sprint started from. Nothing in the previous phases caused it.

It has been invisible because it is a **slow** suite — `npm test` excludes it,
so the CI *fast-core* job has never run it. That is a third CI gap, on top of
the two found in the CI phase.

| check | what is actually wrong |
|---|---|
| every scene-graph edge connects two objects that actually exist | the graph emits `memberOf` edges into **similarity-group** ids; the contract's known id space is candidates + chairs + **furniture** groups. Similarity groups are a fourth id space the contract does not know about |
| every relationship records the evidence that produced it | chair→table `belongsTo` edges carry **no evidence string** |

The second is **load-bearing for this programme.** The Risk Radar (§8), Plan
Doctor (§13), Smart Seating (§16) and the recommendation UI (§37) all require
the product to explain *why*. A relationship with no recorded evidence cannot be
explained to an operator. This is not cosmetic and it is not a test-only
problem — and the fix must be in the engine or in an argued contract change,
never in quietly relaxing the assertion, which would be the same sin as moving
Ground Truth.

**Not fixed in Phase A.** Phase A freezes and records; changing behaviour here
would defeat the freeze. Scheduled ahead of Phase D, which is the first phase
that consumes relationship evidence in the UI.

---

## The product as it exists — measured, not remembered

Before proposing an information architecture, the application was rendered at
1920×1080, 2560×1440 and ~1440px with a real plan, real Assisted Detection
(49 tables committed from 56 candidates) and real guests. Zero page errors at
every viewport.

### What exists today

| | |
|---|---|
| screens | `events`, `new-event`, `workspace`, **`review`** |
| workspace tabs | Floor Plan · Guests · Seating Plan · Live Event · Reports |
| Command Center | **does not exist** |

### The central finding: two surfaces answer the SAME question with different numbers

This is not a style complaint. Rendered side by side on the same event, in the
same visual component, in the same screen position, the product says:

| surface | where | what it counts | showed |
|---|---|---|---|
| `planStatusPillHTML` | **Floor Plan** tab, bottom pill | `reviewGroups` members + questions — the **raw, un-collapsed** count | **"37 items need review"** |
| `planIntelBottomPillHTML` | **Review** screen, bottom pill | the Confidence Budget | **"6 to decide"** |
| `planHealthHTML` | workspace header | `planIssues()` — 4 hard-coded rules | **"Plan Health · 1"** |
| Review Center panel | inside Review | the Confidence Budget, ranked | 6 rows |

**Two of these answer the same question and disagree.** "37 items need review"
and "6 to decide" both mean *how much of this plan still needs a person* — same
question, same component, same corner of the screen, both linking to the same
Review Center, different numbers. The 37 is the raw un-collapsed count, which is
exactly what the Confidence Budget was built to replace: *"do not show the
operator 50 warnings just because the system has 50 uncertain facts."*

**The third is not a contradiction and must not be merged away.** `planIssues()`
answers a *different* question — duplicate table numbers, blank plan, capacity
exceeded, unassigned guests. That is **event data readiness**, not plan-reading
uncertainty. Folding it into one number would destroy real information. It is
poorly placed, not wrong; it becomes an input to Plan Doctor and the Risk Radar
(Phases E and J), which is where those rules belong.

Meanwhile **Self-Check and Number Integrity have no surface at all** outside
the Review Center's budget rows. Two layers that produce real findings are
invisible to an operator who never opens that panel.

### The second finding: the review screen leaves the application

`ui.screen = "review"` is a **separate shell**, not a view. It replaces:

| | workspace | review screen |
|---|---|---|
| main navigation | 5 tabs | **gone** — replaced by a "Floor Plan" back button |
| event identity | name, date, venue | **gone** |
| global guest search | present | **gone** |
| header | brand + event + actions | a different header entirely |
| bottom pill | "37 items need review" | "6 to decide" |

An operator reviewing a plan cannot see which event they are in, cannot search a
guest, and cannot reach any other part of the product without leaving the task.
Two full-screen plan surfaces exist, showing the same plan image at the same
scale, with different chrome.

`CLAUDE.md` permits each screen its own component patterns for its own job. It
does not require two shells, two headers, or two contradictory counts — and the
contradiction is the part that misleads.

---

## The information architecture

### Navigation — one addition, nothing else

```
EVENTS                          (screen)
  └── EVENT WORKSPACE           (one event)
        COMMAND CENTER          ← NEW, and the default landing tab
        FLOOR PLAN
        GUESTS
        SEATING
        LIVE
        REPORTS / HISTORY
```

Six tabs. **Command Center is the only navigation item this whole programme
adds.** Every other feature lives inside the workflow where it is used.

### Where each feature lives

| feature | home | why not its own nav item |
|---|---|---|
| Event Risk Radar | Command Center, primary column | it *is* the Command Center's main content |
| Confidence Budget | Command Center summary + Floor Plan review drawer | it is a way into work, not a place |
| Self-Check | Command Center "plan consistency" + Floor Plan review + Plan Doctor | it is evidence about the plan, read where the plan is |
| Teach Area | Floor Plan contextual inspector | it is always about a selected object |
| Plan Doctor | Command Center action → "can we start?" panel | answered once, before going live |
| Layout Change Detection | Floor Plan **layer toggle** | it is a way of looking at the plan |
| Smart Guest Finder | shell header search (exists) + Guests | needed from everywhere, so it belongs to the shell |
| Smart Seating | Seating, per guest/party | it is a step in seating, not a destination |
| Seating Impact Preview | Seating + Live, before any change applies | a confirmation step, never a page |
| Freeze Zones | Seating (define) + Floor Plan layer (see) | two verbs, two existing homes |
| Emergency Table Failure | Live, table context action | only meaningful during service |
| Arrival Wave | Command Center block; Live during service | a readiness fact, then a live fact |
| Service Load | Floor Plan **layer** + Command Center summary | it is a property of the room |
| Event Handover | Live / Command Center action | an action, not a screen |
| Audit Trail | Reports / History | it is history |
| Post-Event Replay | Reports / History, closed events | it is history, played back |
| Event History & Learning | Reports / History + Events | it is history, reused |
| Backup / Restore | event contextual menu | an action on an event |
| Portable Event Package | event contextual menu | an action on an event |

Nineteen features, **one** new navigation item.

### Surfaces to unify or retire

| surface | decision |
|---|---|
| Floor Plan pill "N items need review" (raw count) | **done in B1.** Both pills now call one shared `planReviewChipHTML()` |
| Review screen pill "N to decide" | **done in B1.** Same function, same number |
| `planHealthHTML` "Plan Health · N" | **demote to an input.** Its four rules feed the Risk Radar and Plan Doctor; it stops being its own header widget with its own number |
| `ui.screen = "review"` separate shell | **fold into the Floor Plan tab as a mode**, so the shell, event identity and search persist |
| two inspector architectures | converge on one contextual inspector, whatever the selection is |

`planIssues()` is not deleted — its rules (duplicate table number, blank plan,
capacity exceeded, unassigned pax) are real and belong in Plan Doctor's
BLOCKING/NEEDS REVIEW tiers. What is removed is a *fourth independent number*
competing for the same corner of the operator's attention.

### The boundary that stops Command Center becoming a second Live screen

Live already carries a five-metric operational strip — Arrived · Still Expected ·
No Show · Empty Tables · Empty Chairs — a full-width guest search, and one-tap
Check In / No Show. It is a good screen and none of it should move.

So the Command Center must not be "the same numbers, elsewhere". The division:

| | question it answers | content |
|---|---|---|
| **Command Center** | *is this event ready, and what deserves my attention now?* | risk, readiness, unresolved decisions, and links **into** the place the work happens |
| **Live** | *let me do the work* | the counts, the search, the check-in |

A number belongs where it is acted on. The Command Center may state that
something is wrong and take you to it; it does not become a wall of statistics
duplicating the screen that already owns them.

### The rule this architecture is built on

> One question, one answer, one number, one place to act on it.

Where two layers legitimately notice the same thing, the Confidence Budget
already collapses them — that mechanism exists and is measured. The product
shell must stop re-introducing the duplication the intelligence layer removed.

---

## Status

| phase | state |
|---|---|
| A — freeze Beta Core | **done** — 14 commands recorded, `benchmarks/beta-core-baseline.json` |
| B — UI/UX architecture pass | **B1 done** (one question, one number). B2 Command Center, B3 shell unification to follow |
| C — Confidence Budget actionable | not started |
| D–X | not started |

## Not verified

- **Real human operator usability.** No person has run Session A (Golden) or
  Session B (ORNEK). `benchmarks/operator/README.md` holds the protocol.
- **Cross-venue generalisation.** One numbered venue in the corpus.
- **Visual Plan Memory on transformed drawings.** Retention 0.786 against a
  0.98 gate — a known, measured, accepted limit, not a solved problem.
- **Scene-graph referential integrity and relationship evidence.** Two contract
  checks fail, pre-existing, and the second blocks the "explain why" requirement
  that runs through the whole programme.
- **`test:all` is not in CI.** The fast-core job runs `npm test`. Adding
  `test:all` would make CI red today, so the honest order is: fix the two
  contract failures first, then gate on it.

---

## PHASE B — the architecture pass

### B1 — one question, one number

The Floor Plan tab and the review screen each computed *"how much of this plan
still needs a person"* independently, and disagreed: **37** against **6** on the
same event. Both are now one function, `planReviewChipHTML()`, so they cannot
drift again — two call sites computing the same question separately is how they
diverged in the first place.

Measured on the Golden Plan through the real UI, at all three viewports:

| | before | after |
|---|---|---|
| Floor Plan tab pill | "37 items need review" | **"6 to decide"** |
| Review screen pill | "6 to decide" | **"6 to decide"** |
| agreement | **no** | **yes**, 1920 / 2560 / 1440, zero page errors |

The fallback before an analysis has produced a budget is the number of review
**groups**, never the member count — the un-collapsed number does not come back
through the back door.

`planIssues()` was deliberately **left alone**: "Plan Health · Ready" answers a
different question and demoting it belongs with Plan Doctor, which does not
exist yet. Removing a real signal before its replacement exists would lose
information, which is the opposite of the point.

The now-dead `plan.needsReview` translation was removed rather than left behind.

### B2 — the Event Command Center

The one navigation item this programme adds, and the last one it will add. It
answers a single question — **is this event ready, and what deserves my
attention now?** — and it does it with facts the product already had.

**No new engine.** It reads `planIssues()`, the Confidence Budget, the
Self-Check, `eventMetrics()` and `physicalCapacity()`. It computes nothing about
the plan itself and calls no detector.

**The verdict is a named state, never a percentage.** One of four:

| verdict | when |
|---|---|
| `ready` | no blockers, nothing open |
| `readyWithReview` | no blockers, but open questions |
| `notReady` | a blocker, doors not yet open |
| `liveRisk` | a blocker, and guests are already arriving |

There is no honest weighting of "one duplicate table number" against "twelve
unseated guests", so no number is derived from one. The screen names the
situation and lists what produced it, each row carrying a way into the screen
that can fix it. A regression check in `tests/suites/command-center.test.mjs`
fails if a readiness percentage ever appears in the header.

**It gives the Self-Check its first surface anywhere in the product.** Phase A
found that the arithmetic engine's findings existed only in the data. On the
real ORNEK plan, through real OCR in `dist/merit-offline`, the screen now shows
all five:

```
✓  166 × 12 = 1992                      the drawing's own multiplication comes out
✓  1992 + 72 = 2064                     the parts the drawing prints add up to the total
!  the drawing states 166 tables;       3 unaccounted for
   163 were found
✓  each of the 87 confidently read      no number is claimed twice
   numbers belongs to one table
—  the drawing's seating figure         this drawing shows its tables as symbols and
   cannot be checked against a           draws no seats, so there is nothing to count
   seat count                            against it
```

The INCONSISTENT one is also listed as something that needs a decision. That
repetition between the summary and the audit below it is deliberate: a finding
an operator has to act on belongs in the action list, and hiding it there to
avoid an echo would be the worse trade.

**Two Self-Check honesty fixes came out of rendering it.**

1. The module writes its sentences in English, because the benchmarks and the
   exported operator report read the same structure. Rendered into a Turkish
   screen that produced English findings inside Turkish chrome. Each check now
   also carries its numbers structurally in `params`, and the screen restates
   the sentence from those — so the two forms are the same facts, and the
   English text stays where the English artifacts need it.
2. "No plan has been analysed for this event yet" was shown whenever the check
   list was empty. On the Golden Plan a plan *had* been analysed; it simply
   prints no figure about itself to check against. Two different silences, and
   saying the wrong one is a lie the operator cannot detect. They are now
   separate sentences.

**The header badge stopped being a second answer.** "Plan Health · 3" listed
`planIssues()` in its own popover — the same question the Command Center now
owns, answered from a narrower source. It is now `Readiness · 3`, a button into
the Command Center, counting exactly what the Command Center counts. A test
holds the two numbers equal, and it is placed after a Self-Check finding is
present, because before that the two sources coincidentally agree and the guard
would not bite. (Verified by mutation: wiring the badge back to `planIssues`
alone fails that check and only that check.) A historical event has no Command
Center to open, so it keeps the popover.

**What it deliberately does not do.** It does not restate Live's five-metric
strip — a number belongs where it is acted on. It does not appear for completed
events: a finished night has no readiness to assess, and "12 unassigned guests"
on it is noise. And a newly created blank event still opens on Floor Plan, since
there is nothing yet to summarise.

Evidence: `tests/suites/command-center.test.mjs` (39 checks), rendered at
1920×1080 / 2560×1440 / ~1440px in EN and TR, on both real plans through the
OCR build — zero page errors, zero horizontal overflow.

Regression after B2: `npm test` **28/28 suites, 857/857 checks** (from 27/818);
`npm run benchmark:baseline` **no regressions, 0 improvements, 0 notes**;
`npm run verify:offline` **27 passed, 0 failed**; `npm run perf` clean. The
protected detection numbers are untouched.

---

## Fixing the two slow contract failures

Phase A froze the Beta Core with two checks in `plan-intelligence-contract`
failing. They were invisible: the suite is tagged **slow**, so `npm test`
excluded it and no CI job ran it. Both are fixed at the root cause, and the
suite now runs in CI.

### What was measured first

A probe dumped the whole graph on the Golden Plan before anything was changed —
every edge type, every endpoint's id space, every edge's supporting evidence:

```
edges 260   belongsTo 108   faces 19   memberOf 106   adjacentTo 27
endpoint id spaces:  candidates 56 · chairs 108 · furnitureGroups 23
                     similarityGroups 26 · zones 2
edges with an empty `supporting` list:  0
edges carrying an `evidence` string:    0
```

That contradicted the recorded diagnosis on both counts, so both were rewritten
from the measurement rather than from the note.

### A — nothing was dangling; the graph published no nodes

Every endpoint resolved to a real object. What failed was the *check*: it
rebuilt the id spaces from four other fields of `planIntelligence`, knew about
three of the five, missed the visual families entirely, and reported 56
perfectly real `memberOf` targets as dangling.

The architecture question — are similarity groups real graph nodes, or an
implementation-side grouping reference? — is answered **A, they are real
nodes**, and the code already said so: `NODE_TYPES` contains `visualFamily`,
`sceneGraph.nodes` counted them, and the builder's own comment reads *"a family
is a node in its own right: it is the unit a correction spreads across, so a
graph that cannot name one cannot explain why a decision reached thirty
objects."* The defect was that the graph published node **counts** and never the
nodes, so **nothing** holding a scene graph could resolve **any** id in it.

So the graph now emits `nodeList` — all five kinds as first-class typed nodes
with stable ids, a label, the stage that produced them, and their own
provenance. Every edge endpoint resolves inside the graph itself. The per-type
census is derived from that same list, so the counts and the nodes can no longer
disagree.

Two things fell out of doing it properly:

- **`memberOf` means two different things.** Object → visual family ("looks like
  these") and object → logical group ("physically joined to these") shared one
  edge type — 56 and 50 edges on the Golden Plan. Every edge now carries
  `fromType`/`toType`, so a surface explaining a decision never has to do a
  lookup to tell them apart.
- **`nodes.physicalObject` was wrong.** It counted 56 candidates while 108
  `belongsTo` edges started from chair ids it did not count at all. It is now
  164. `nodeCount` keeps its original name and meaning — candidates that
  survived review — and `nodeTotal` is the graph's actual size.

A structural anchor is a **role on** a physical object, not a second node for
the same column.

### B — evidence is composed from the reasons, not labelled

No edge had an `evidence` field; all 260 had a non-empty `supporting` array. So
`evidence` is now one readable sentence built from the edge's own supporting
facts, with its objection appended where it has one:

```
seated along its top edge; perimeter distance 21.5
runs alongside the group, gap 18.4 within reach 42.0
  — but the sofa's own orientation was not derivable, so this is proximity, not facing
```

The structured fields all stay. The point of the sentence is that a product
surface which has to answer *"why did you say that"* gets a sentence rather than
an array to assemble — Risk Radar, Plan Doctor, Smart Seating and Impact Preview
all need exactly that.

`edge()` now **refuses** to build a relationship with nothing to say for it, and
refusals are counted in `refusedEdges` rather than silently dropped. On both
real plans that count is 0.

Three checks stop a constant from passing where a reason is required: every
`supporting` string must appear in the sentence, every `contradicting` string
must too, and a chair's `belongsTo` must be explained by the measurement that
decided it.

### Result

| | before | after |
|---|---|---|
| `plan-intelligence-contract` | 88/90 | **104/104** |
| `npm run test:all` | 32/33 suites, 1011/1013 | **34/34 suites, 1066/1066** |
| slow suites in CI | none | `npm run test:slow` gates the `intelligence` job |

No assertion was weakened; the suite gained 14 checks.

Detector unchanged, proven rather than argued: the diff is confined to lines
567–800 of `plan-intelligence.js`, which is the scene-graph section, and
`benchmark:adversarial` was run at `840efbe` and again after — the outputs are
**byte-identical**, graph lines included. `benchmark:baseline` reports no
regressions on either real plan; `verify:offline` 27/27.

---

## PHASE B3 — one shell for the whole workspace

### The defect

`ui.screen = "review"` was a **separate application**. Entering it called
`app.innerHTML = analysisHTML(event)` and replaced everything: the event's
name, the tab bar, the readiness badge, and the global guest search all left
the page. An operator reviewing a plan could not answer *"which event am I
in?"* or *"is Mr Yılmaz already seated?"* without abandoning the review.

### The fix

Review is a **mode of the Floor Plan tab** now — `ui.planMode` ∈
`{plan, review}` — and `ui.screen` stays `"workspace"` throughout. The tab
dispatch picks the mode; `render()` has no review branch left at all.

```
EVENT WORKSPACE  (header · tabs · guest search · readiness — never leave)
└─ Floor Plan
   ├─ Plan mode      the editable canvas
   └─ Review mode    the analysed plan, its candidates and its questions
```

Every way in was rewired to the mode rather than the screen: the plan
toolbar's Assisted Detection button, the Command Center's *Open review*, the
status pill's review chip, and Re-Analyze. The review bar's old *← Floor
Plan* button is gone; a **Plan | Review** segmented control replaces it, and
the same control appears at the head of the floating map toolbar in plan
mode. It is not navigation and does not look like it.

### Two things this surfaced

**The language toggle was owned by two screen-local toolbars.** One inside
the plan toolbar, another inside the review bar, and none anywhere else — so
Guests, Seating, Live, Reports and the Command Center had no language control
at all. It is in the workspace header now, with the other controls that are
about the application rather than the drawing. A check holds it to exactly
one instance in the header and zero in either screen.

**A real defect the new suite caught before any human saw it.** The header
button rendered but did nothing: `[data-v8-action]` is bound inside
`bindCanvas()`, which only runs where a canvas exists — and review mode has
none. Moving a control into the shell means binding it in the shell.
`bindV8Common()` owns it now.

### Evidence

`tests/suites/floor-plan-modes.test.mjs` — 42 checks. It asserts the *shell*,
not the review UI, because a change that made review a screen again would look
perfectly reasonable in a diff:

- the round trip is checked on **each leg** — into review, back to plan, into
  review again — and each leg must still show the event name, six tabs, the
  active Floor Plan tab, the guest search and the readiness badge
- the guest search is typed into from inside review mode, not merely counted
- stepping into Guests and back does not abandon a review in progress
- Assisted Detection lands in review **mode**, with the shell intact
- the Command Center's *Open review* lands in the same place
- the uploaded plan is still the hero in review mode — a data-URL image at
  size, never a redraw

Measured on the real ORNEK plan through real OCR at 1920×1080 / 2560×1440 /
~1440px in EN and TR: `ui.screen` stayed `"workspace"` on every leg, all six
tabs present, event identity and search intact, zero page errors, zero
horizontal overflow.

Two harnesses that drove the old screen were updated to the new architecture
rather than worked around — `plan-memory-isolation` and the teaching
benchmark. `benchmark:teaching` still reports precision 1.0000, retention
1.0000, wrong-application 0.0000, all gates met.

```
npm run test:all            35/35 suites, 1108/1108 checks
npm run benchmark:baseline  no regressions, 0 improvements, 0 notes
npm run verify:offline      27 passed, 0 failed
```
