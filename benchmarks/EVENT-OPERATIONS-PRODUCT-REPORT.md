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

---

## PHASE C — the Confidence Budget becomes actionable

### The defect

The budget already knew **which** uncertainties were worth deciding and in what
order. It said so as a list of sentences with no way in. An operator read *"31
table numbers need review"*, agreed, and then had to go and find those 31 tables
themselves. A ranked row that cannot be acted on spends the operator's attention
twice — once to read it, once to work out where to go.

### One workflow, not five

The five claim sources (review priorities, numbering, integrity, self-check,
Teach Area) do not need five destinations. Four of them name candidate objects,
so all four resolve the same way: **take me to these objects and let me decide
one at a time.** That single workflow is §4A and §4B at once.

Every ranked row now carries a **Review N** button, and a claim that names no
objects — the self-check's arithmetic is about the whole drawing — says *"About
the drawing as a whole"* rather than offering a button that would land nowhere.
A check holds that correspondence exactly: `(live objects > 0) === (button
present)`.

### The queue

`ui.reviewQueue` holds an **order and a position, and nothing else.**

What counts as *resolved* is read from the candidates on every render and never
remembered. This is the load-bearing decision: a queue with its own tally would
drift the moment a decision was undone and would then be confidently wrong about
how much work is left. The suite proves it by reversing a decision behind the
queue's back and asserting the resolved count drops.

Opening a row lands the operator on the first object with the shell intact,
reusing the machinery a manual click already uses rather than a second copy of
it: selection highlights the object, opens its inspector, and — new — focuses
the plan on it. Outside a queue a single selection is deliberately left unzoomed;
someone clicking around a plan does not want the view jumping under them. Inside
one, *"take me there"* is the request.

`Previous · Skip · Next undecided · Exit`, with **Next undecided** searching
forward from where you are and wrapping once — an operator who has worked
halfway down does not want to be sent back to the top. Confirming, rejecting or
dismissing advances automatically; recomputation has already run by then, so the
progress line, the ranked row behind it and the readiness badge are all reading
the new state. §4C falls out: a resolved item changes state by itself instead of
sitting there as a stale warning.

### Two i18n defects this surfaced

**`why` is developer-facing English by design** — `plan-intelligence.js` says so
at the call site, and some of it is composed from internal identifiers. Rendering
it in the queue bar produced *"contradiction.from.detectionAndShape and
contradiction.from.visualSecondOpinion cannot both be right"* inside an otherwise
Turkish bar. It is not carried into the queue at all now; what an operator reads
is the claim's own translated label plus what one decision settles.

**The Assisted Detection notice was stored English rendered raw.** It is *data* —
the contract suite asserts on it and the exported report carries it — so it stays
as written and the screen says the same thing in the operator's language. An
analysis whose notice this build does not recognise keeps its own words rather
than being relabelled with a sentence that might not be true of it.

A third, smaller one: the progress separator was a CSS-only dot, so the text read
*"163 içinden 10 karara bağlandı"* — one number where there are two. It is a real
character now.

### Evidence

`tests/suites/review-queue.test.mjs` — 36 checks, covering the path from a ranked
row to a decided object and back, including the undo case above and the
no-raw-key sweep in both languages.

Rendered on the real ORNEK plan through real OCR at 1920×1080 / 2560×1440 /
~1440px in EN and TR: queue bar without overflow, inspector card clearing the
bar, plan focused on the queued object, zero page errors, zero horizontal
overflow.

```
npm run test:all            36/36 suites, 1144/1144 checks
npm run benchmark:baseline  no regressions, 0 improvements, 0 notes
npm run verify:offline      27 passed, 0 failed
```

---

## PHASE D — Self-Check and the Teach Area, surfaced

No engine was rebuilt. Both already worked; what was missing was the product
around them, and in one case a control that had never existed at all.

### 5A — Self-Check now states RESULT, SOURCE and, where there is one, ACTION

Each finding in the Command Center carries where its numbers came from, and an
INCONSISTENT or NEEDS_REVIEW one carries a way to act on it. On the real ORNEK
plan, in Turkish:

```
✓  166 × 12 = 1992              Kaynak: basılı sayılardan hesaplandı; çizimde basılı
✓  1992 + 72 = 2064             Kaynak: çizimde basılı
!  çizim 166 masa belirtiyor;   Kaynak: çizimde basılı; Destekli Tespit   [İncelemeyi aç]
   163 masa bulundu
✓  güvenle okunan 87 numara…    Kaynak: çizimde basılı
—  çizimin koltuk sayısı…       Kaynak: çizimde basılı
```

The sources are **not** the engine's `source` sentences. Those are free English,
one of them is composed from the figures themselves, and they carry OCR
internals — *"OCR of each table's own symbol where two crops agreed"* — which
§5A says not to show by default. So `plan-self-check.js` now emits a stable
`origin` alongside each `source`, one of five named values, and the screen
renders that. Same pattern as the `params` fix: the sentence stays for the
English artifacts, the enum is what a product screen can speak.

### 5C — confirming a table's number, which nothing ever offered

The Teach Area has supported a `tableNumber` subject since it was built, and the
apply layer has written the result since then too. There was no way to reach it,
so **the strongest evidence the product recognises — a person standing behind a
number — was unreachable.**

A table's inspector now shows its printed number, the state that number is in,
and where that came from, with a **Confirm** control. The state is shown rather
than smoothed over: *"read once — not yet confirmed"* is a different fact from
*"confirmed"*, and only the second one identifies a table across a whole venue.
A confirmed number is stored with `source: "confirmed by a person"` — never as
though the drawing had been read.

### 5B — an unsafe scope is refused before the click, not after

Venue scope requires a verified printed number. The Teach Area enforced that
correctly and enforced it **after** the operator chose a scope and pressed the
button. The rule is knowable beforehand, so the option is now disabled with the
reason beside it:

> Across the whole venue an object has to be identified by its printed number.
> Confirm this table's number first, and this becomes available.

Confirming the number then unlocks it. That loop — *why can't I? · here's what
would fix it · now you can* — is the whole of §5B, and the suite walks it.

### Three more English strings that were reaching a Turkish screen

All three were **stored data** rendered raw, and all three are fixed the same
way: the data stays as written, the screen says the same thing in the operator's
language, and a value this build does not recognise is shown as it stands rather
than relabelled with a sentence that might not be true of it.

| | was |
|---|---|
| the Assisted Detection notice | *"Classical computer vision is active…"* under a Turkish heading |
| `printedNumber.source` | *"Doğrulandı · OCR of this table's own symbol"* |
| self-check input sources | *"Kaynak: printed on the drawing, read by OCR"* |

### Evidence

`tests/suites/teach-number.test.mjs` — 23 checks: the panel and its state line,
venue scope disabled with a reason, a confirmed number stored as a person's, the
unlock, a venue-scoped lesson then accepted, rubbish refused with an
explanation, and no raw key in either language.

One defect the suite caught while being written: I had invented two number-state
names (`CONFLICTED`, `UNREADABLE`) that `plan-table-numbers.js` does not emit —
its states are `VERIFIED`, `LIKELY`, `NEEDS_REVIEW`, `UNKNOWN`. Those would have
rendered as raw keys on the two states that matter most.

```
npm run test:all            37/37 suites, 1167/1167 checks
npm run benchmark:baseline  no regressions, 0 improvements, 0 notes
npm run verify:offline      27 passed, 0 failed
```

---

## The CI that was red, and why a local green run was not enough

Four checks failed on the real GitHub run at `d3f13e6` and two more at
`dc1e703`, while every local run was green. The handoff's hypothesis was that
the PR merge ref differed from the branch. It did not: `origin/main` is an
ancestor of the branch, `git merge-base` returns main's own head, and the
`push` run and the `pull_request` run at the same commit failed identically.
The merge was never involved.

**One root cause, measured, behind all four.** `index.html` loads Tesseract
from a CDN. A GitHub runner has network, so Assisted Detection runs its whole
OCR-dependent tail — OCR, text-based false-positive suppression, labelled-object
identification, printed-number reading. This development sandbox has no network,
so that tail had never run here. Every suite written here had been validated
against half the pipeline.

The fix was in the harness, not in any assertion. `tests/lib/app-actions.mjs`
gained `runDetection` / `reRunDetection` / `importPlan`, and there is now ONE
way to wait — *the analysis is finished* (`!!analysis && !ui.analysisBusy`),
not *the analysis exists*. Six suites carried the same latent race and had been
passing by luck. Three suites that drew their plans on a canvas at runtime moved
to the committed `merit-real-venue-plan.png`, byte-identical on every machine.
Each now reports OCR availability rather than assuming a world.

**A real product defect only a machine with OCR could surface.** With OCR live,
`suppressTextFalsePositives` deleted 3 of the adversarial fixture's 6 exact
columns and left the survivors on a single axis — the very shape the column pass
exists to reject, since what separates a structural grid from printed text is
that a grid is aligned in two directions and a word in one. The rule already
carried two exemptions in exactly this idiom (a candidate with chairs at it, a
member of a repeated symbol family); a column is the third and was missing. The
exemption can only ever KEEP an object, so it cannot move a table or chair
number on either real plan — and the four measurements below say so.

Green on the real PR run at `b15c4b1`: fast-core, detection, offline,
intelligence (including the slow contract suites) and performance.

---

## PHASE E — the Plan Doctor

**CAN THIS EVENT SAFELY PROCEED?** A pre-flight check, not a detector. It reads
nothing off the drawing and calls no engine: `src/plan-doctor.js` compares facts
other layers already concluded — the tables, the guests, where they are sitting,
and what the plan reader, Self-Check, Number Integrity, Confidence Budget and
Teach Area made of the drawing.

### One assembly, not three

The change that matters is not the new screen. Before this, the header badge,
the readiness verdict and the reason list each assembled their own view of "is
this event ready" from `planIssues()` and the analysis, and keeping three
assemblies in agreement was a matter of care rather than architecture.
`eventReadiness()` now reads the Doctor's report and nothing else does its own
arithmetic. `planIssues()` is untouched and is one of the Doctor's inputs — the
Reports pre-flight and the historical popover still use it directly, and a rule
added to it tomorrow reaches the Doctor automatically rather than being dropped.

### A reading is not an operational fact

Two tables a person numbered the same is **BLOCKING**: a guest will be sent to
the wrong table tonight. Two tables OCR *read* as the same number is **NEEDS
REVIEW**: the room may be perfectly fine and the reader wrong. The same
disagreement sits at two levels depending on where the number came from.
Collapsing them — which looks like a simplification in a diff — would either cry
wolf on every plan with imperfect OCR or bury a conflict that misdirects a guest.
§4A's "do not turn uncertain OCR into BLOCKING" is this rule, and it is the one
the suite mutation-tests first.

### Every row says five things, and none is a dead end

WHAT is wrong · WHY the system believes it · SOURCE · WHAT it affects · WHAT the
operator can do. Sources are named values (`DRAWING`, `NUMBER_READING`,
`RELATIONSHIPS`, …) that a screen translates, not English sentences — the same
pattern as the Self-Check's `origin`. No raw arrays and no developer
diagnostics: the scene graph appears as "12 chairs were found that no table
claims", which is what an operator can act on, not as an edge count.

Destinations are resolved from live data at click time, not baked into the row:
between render and click the operator may have fixed the problem in another tab,
and acting on a stale payload would send them to a table that no longer exists.

### Nothing is remembered

The report is derived on every read. Fix the duplicate number and the row is
gone on the next render — there is no stored finding list to go stale and no
"dismissed" flag that could hide a problem that has come back. RUN FINAL CHECK
records that a *person* ran the pre-flight, which is a real operational fact;
where the event has changed since, the panel says so rather than letting a
timestamp imply that what is on screen is what was checked.

### Three defects this surfaced, two of them mine

1. **The provenance never matched.** `checkOrigins` compared each self-check
   input's `origin` against the ORIGINS *key names* (`"PRINTED"`) when the values
   are words (`"printedOnTheDrawing"`). It matched nothing, so a finding with
   perfectly good provenance reported none of it. Found by rendering the screen,
   not by reading the diff. It now reads the values from `MeritSelfCheck.ORIGINS`
   rather than keeping a copy that a rename would silently break.
2. **A raw key one origin away.** `ccPlanConsistencyHTML` rendered an
   unrecognised origin as `cc.origin.WHATEVER`. Unreachable today, one added
   ORIGIN from being reachable. Unknown values are now dropped rather than
   printed, as everywhere else.
3. **An English island in a Turkish panel.** The "last run" stamp read
   "son çalıştırma: Just now": `relativeTime()` predates i18n and nothing else
   live still called it. A raw-key sweep cannot see this — the leak is real
   English — so the suite asserts the two languages differ.

### Evidence

`tests/suites/plan-doctor.test.mjs` — 52 checks: the verdict is one of three
named states and never a score; every finding declares a destination, a source
and what it affects; following each row on screen actually leaves the Command
Center; a read duplicate is review while a plan duplicate blocks; fixing it
removes the row with nothing dismissed; a guest at a deleted table is blocking
and selects that guest; INFORMATION is reported and never enters the attention
list; badge, attention list and report agree in both languages; no raw key and
no English in either; and a completed event has no pre-flight and cannot acquire
a final-check record.

Two mutations, to prove the checks bite rather than merely pass:

| Mutation | Result |
| --- | --- |
| `duplicateNumberReading` raised to BLOCKING | 4 checks fail, naming the collapsed distinction |
| a finding's `action` removed | "every finding declares a destination the product can reach" fails |

The second mutation is the reason the contract is asserted against the module
rather than against the rendered row: the UI labels an unknown destination
generically rather than printing a key, so a screen-only check could not tell a
dead end from a working one. The first version of that check could not fail.

```
npm run test:all             38/38 suites, 1227/1227 checks
npm run benchmark:adversarial  identical to the pre-change run on every
                             measured field (only timestamps and timings move)
npm run verify:offline       27 passed, 0 failed
npm run perf                 all suites completed
rendered                     1920×1080, 2560×1440, 1440×900, EN and TR,
                             0px horizontal overflow at every viewport
CI run 116 (pull_request)    all five jobs green, including Detection
```

### A correction about the detector proof

`npm run benchmark:baseline` does **not** re-run detection. It compares the
report `npm run benchmark` last wrote, so on its own it can report "no
regressions" against a measurement taken before the change — which is what
happened while this phase was being checked. It is not the evidence it looks
like, and it is recorded here rather than quietly dropped.

The real proof is CI's **Detection** job, which runs `npm run benchmark` and
then the baseline comparison on a fresh run. It is green at `f3a3894`. The
adversarial comparison above was genuinely fresh — run twice, once with the
changes stashed. Neither this phase nor the next touches the detection path.

The lesson for anything downstream: a green `benchmark:baseline` is only a
detector proof when `npm run benchmark` ran first, in the same working tree.

---

## PHASE F — Layout Change Detection

**No new detector.** `MeritVenueModel.compareToVersion` has done this comparison
since the venue model was built, matching by table number first and geometry
second, and it had **no UI at all** — it was reachable only from a test. Nothing
in the product could answer "what did we change since v3?". Phase F is the
product around it, plus the two classification defects that surfaced once a
person could actually read the output.

### A number outranks a position

The identity order is verified table number → position, and there is
deliberately **no visual-similarity rung**. "Never let embedding similarity
override explicit verified identity" is honoured by not having the input at all:
nothing in this comparison consults an embedding, so similarity cannot outrank
a number it disagrees with.

Removing the number pass is what shows why it matters. The suite's mutation run
reports the moved table as **"T02 removed" plus "T02 added"** — one table
counted twice, in a report whose whole value is telling an operator what is
different. That is the failure §5A names, reproduced on demand.

### A change is named, not lumped

`compareToVersion` folded a capacity change into `moved`. A table that stayed
exactly where it was and gained two seats came out as MOVED, and an operator
reading "3 tables moved" would go looking for movement that never happened. One
matched pair now emits **one change per aspect that differs** — MOVED,
CAPACITY_CHANGED, TYPE_CHANGED, ZONE_CHANGED — rather than one label being
chosen and the rest hidden. `moved` keeps its old meaning for the callers that
read it; the named classes are what a screen shows.

Venue objects were compared as **counts per type**, which is true and useless:
"there is one more bar than there was" cannot say which bar, so nothing could be
shown on the plan — and a stage that moved five metres did not change the count
at all and was invisible. They are matched per object now, by their own label
first and position second.

### A stage that appeared is not a stage that changed

Found by rendering, not by reading: an added stage came out as
**"STAGE CHANGED · STAGE · — → stage"** — the object's type stated twice and its
actual news not at all. ADDED, REMOVED and STAGE_CHANGED are peers in the
taxonomy; the last one means the stage was there before and is different now.
Unmatched objects are ADDED/REMOVED with no before/after, because the row
already names them.

### The plan stays the hero

LAYOUT CHANGES is a **mode of the Floor Plan**, on the same canvas, with the
same toolbar and the same pan and zoom — not a second drawing of the same room.
A view that redrew the layout from the diff would have the operator comparing
the product's picture of the night rather than their own. The overlay is the
selection: choosing a change highlights the object it is about, on the plan
already in front of them.

The mode appears only where there is a published version to compare against. An
event never taken from a layout has no "since when" to answer, and a tab that is
always there and always empty teaches an operator to stop looking at it. The
permanent navigation did not grow.

### Confirmation only where it means something

An UNCERTAIN change — an addition or a removal, matched by nothing — offers a
Confirm. A change matched by its own table number does not: there is nothing for
a person to ratify, and asking them to tick forty certainties would make the
ticks meaningless on the four that matter. A confirmation is stored against the
**version** it was made about, so "T05 is gone relative to v3" stays true and a
table removed, re-added and removed again does not come back already ticked.

### Evidence

`tests/suites/layout-changes.test.mjs` — 46 checks: every named class on a
change that is genuinely only that; the moved table is one MOVED entry matched
by TABLE_NUMBER, not a removal plus an addition; an added stage is ADDED and a
stage present in both is STAGE_CHANGED matched by its label; the view is the
same canvas inside the workspace; every engine change reaches the screen in
words; confirmation is offered only on uncertain changes and marks exactly one;
the card states previous, current, confidence and evidence; no raw key or enum
in either language; the published version is never rewritten; and a completed
event reads its changes and cannot confirm them.

Two mutations, to prove the checks bite:

| Mutation | Result |
| --- | --- |
| identity-by-number pass removed | the moved table comes back as `T02 removed` + `T02 added`; 2 checks fail |
| capacity change folded back into MOVED | `T01`, which never moved, is reported MOVED; 2 checks fail |

```
npm run test:all             39/39 suites, 1273/1273 checks
npm run benchmark             fresh detection run, then
npm run benchmark:baseline    no regressions, 0 improvements, 0 notes
                              (in that order — see the correction above)
npm run verify:offline        27 passed, 0 failed
rendered                     1920×1080, 2560×1440, 1440×900, EN and TR,
                             0px horizontal overflow, no page errors
```

---

## PHASE G — Smart Guest Finder

The global search was a name-and-table lookup that offered one destination. At a
door, with a queue behind somebody, the question is rarely "where is this name"
on its own — it is *who is this, are they expected, have they arrived, where do
they sit, who came with them* — and then one action. The row answers all of that
now, and offers the four things an operator actually does next.

### Speed is an index, not a promise

The old search ran a table lookup **inside** the filter, so every keystroke cost
O(guests × tables). On a four-thousand-guest event that is millions of
comparisons per character typed. One lowercase haystack per guest is built once
per change to the event — `lastModified` is the invalidation key, because
`touchEvent()` stamps it on every mutation — and scanned linearly after that.

Measured rather than asserted, through `renderGlobalSearch` (the whole cost of
one keystroke: index, match, rank, build the rows), over 4,003 guests:

| | ms |
|---|---|
| cold (pays for the index) | reported |
| warm, mean of 8 queries | **gated < 25** |
| warm, worst of 8 | **gated < 60** |

The matcher underneath is closure-scoped and unreachable from a test, which is
the right shape: the suite drives what the product exposes.

### Every field the phase names, and nothing invented

Name, host or company, VIP level, planning status, arrival status, table number
and zone. **`invitedBy` is where this data model keeps both the host and the
company** — there is no separate company field, and adding one would have
created a field nobody fills in. Said plainly rather than papered over.

Terms narrow rather than widen: `kerem yılmaz` matches guests satisfying both.
An OR search over four thousand guests is the same as no search at all.

### The party is the people the same host brought

Not the guest's own companions — those are already inside the record as pax, and
a "party" of one record showing itself tells an operator nothing. `invitedBy` is
the only grouping in this data that survives a guest not being seated yet.

### Nothing moves by itself

CHANGE TABLE opens Seating with the guest selected and waits for a person.
Silently reseating somebody is the one thing this product must never do, and a
"smart" finder is exactly where that would creep in. CHECK IN writes **arrival
status only** — planning status is a separate axis and nothing here touches it.

Each action is offered only where it can do something, with the reason on the
control: an unseated guest cannot be shown on a plan, a guest nobody shares a
host with has no party, a completed event cannot be checked into.

### Four defects this surfaced, two of them only by rendering

1. **The keyboard died after the first Escape.** `ui.findActive` uses -1 for the
   shut state, and the re-activation guard tested `== null` and `>= rows.length`
   but not `< 0`. So after one Escape the list came back with nothing selected
   and Enter did nothing — a door operator's whole path, silently broken.
2. **My own axis check could not fail.** The check-in fixture used a guest who
   was already `Confirmed`, so a mutation that wrote `planningStatus =
   "Confirmed"` on check-in changed nothing and the suite stayed green. The most
   important domain rule in this phase was unguarded. The fixture is `Tentative`
   now, and the mutation fails it.
3. **The results panel was invisible, and nothing was clipping it.** Rendered at
   1920×1080 the finder showed a ~50px sliver of one row. Every ancestor's
   `overflow` was `visible` and all four rows were in the DOM at full height —
   the panel was simply painted UNDER the content, because `.workspace-head` is
   `position: static` and had no stacking context of its own. Pre-existing: the
   old short panel overlapped the screen too, just less visibly. The header is
   positioned now.
4. **Half the Turkish row was English.** Planning status is stored as
   `Confirmed`/`Tentative` — domain values the workbook export and the contract
   read — and was rendered straight through, so a Turkish operator saw
   "2 kişi · VIP · **Confirmed** · giriş yaptı". Arrival status had already been
   translated at the boundary; planning status had not. A raw-key sweep cannot
   see this, so the suite now compares the two languages and rejects English
   status words in the Turkish row.

### Evidence

`tests/suites/guest-finder.test.mjs` — 57 checks against a real 4,003-guest
event: the measured timings; each searchable field; terms narrowing; the row
carrying pax, VIP, both statuses, table, seats, zone and host; actions gated with
reasons; SHOW ON PLAN landing on the guest's own table, selected and highlighted,
inside the workspace; CHECK IN moving one axis and writing an audit entry;
CHANGE TABLE moving nobody; arrow keys and Enter and Escape; a capped result set
counting the rest; no raw key in either language; and a completed event that can
be searched but not changed.

Two mutations, to prove the checks bite:

| Mutation | Result |
| --- | --- |
| CHANGE TABLE silently reseats the guest | "NOTHING was seated, moved or unseated" fails |
| CHECK IN also sets planning status | "checking in does NOT touch planning status" fails — **only after the fixture was corrected**; with the original fixture it passed, which is why the fixture is part of the fix |
| planning status rendered raw again | "no English status survives into the Turkish row" fails |

### A time bomb in the fixtures, found by the calendar

`test:all` went red on `guest-and-seating-rules` and `xlsx-contract` — the
reports contract among them — with an identical, useless message:
`click(".planmap-fab")` timed out. Nothing in the product had changed.

Both suites created their event with a **hardcoded `date: "2026-09-10"`**, and
the day had passed. A past-dated event is `isHistorical`: read-only, with no
Floor Plan tab and no add-object control at all. The suite was not failing a
check — it was waiting for a control the product correctly refuses to render,
and reporting a timeout that says nothing about the cause.

Every other fixture in the suite carried the same bomb with a later fuse; the
next one was due in three weeks. Fixed as a class rather than as two instances:
`futureDate(daysAhead = 90)` in `tests/lib/app-actions.mjs` computes the date,
`createBlankEvent` defaults to it, and 26 suites now use it. The suites that
deliberately want a finished event still pass a past date — `2020-01-01` in
`historical-immutability` is untouched, and the event that starts workable and
is later marked `Completed` correctly got a future date.

Worth stating plainly because it cuts both ways: this failure was **not** caused
by the phases in this report, and finding that out took reading the suite rather
than the diff. A timeout on a selector is the least informative failure this
harness produces, and it is exactly what a date-sensitive fixture yields.
