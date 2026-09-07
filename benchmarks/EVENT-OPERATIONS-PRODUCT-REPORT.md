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
