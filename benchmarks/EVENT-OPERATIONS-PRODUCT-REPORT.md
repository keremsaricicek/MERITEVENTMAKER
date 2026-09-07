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

**Status: battery running at the time of this commit.** The full protected state
— `npm test`, `test:all`, `benchmark`, `benchmark:baseline`, `adversarial`,
`zones`, `facts`, `contradictions`, `review-order`, `false-positives`,
`teaching`, `memory`, `perf`, `verify:offline` — is being run in order, each to
its own log with its exit code and wall-clock cost. The recorded values land in
the follow-up commit; this one carries the architecture work, which does not
depend on them.

First result in:

| | |
|---|---|
| `npm test` | **27/27 suites, 818/818 checks**, exit 0, 213s |

Nothing in this commit changes application source, so the battery measures the
same tree the numbers will describe.

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

### The central finding: four surfaces answer "what needs your attention", and they disagree

This is not a style complaint. Rendered side by side on the same event, in the
same visual component, in the same screen position, the product says:

| surface | where | what it counts | showed |
|---|---|---|---|
| `planStatusPillHTML` | **Floor Plan** tab, bottom pill | `reviewGroups` members + questions — the **raw, un-collapsed** count | **"37 items need review"** |
| `planIntelBottomPillHTML` | **Review** screen, bottom pill | the Confidence Budget | **"6 to decide"** |
| `planHealthHTML` | workspace header | `planIssues()` — 4 hard-coded rules | **"Plan Health · 1"** |
| Review Center panel | inside Review | the Confidence Budget, ranked | 6 rows |

Three different numbers for one question, two of them in an identically styled
pill at the bottom of the screen, both linking to the same Review Center.

The raw count is exactly what the Confidence Budget was built to replace — *"do
not show the operator 50 warnings just because the system has 50 uncertain
facts"* — and it is still the number the Floor Plan shows.

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
| Floor Plan pill "N items need review" (raw count) | **retire the number.** One count, from the Confidence Budget, everywhere |
| Review screen pill "N to decide" | keep the number, make the component shared |
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
| A — freeze Beta Core | in progress |
| B — UI/UX architecture pass | planned above, not implemented |
| C — Confidence Budget actionable | not started |
| D–X | not started |

## Not verified

- **Real human operator usability.** No person has run Session A (Golden) or
  Session B (ORNEK). `benchmarks/operator/README.md` holds the protocol.
- **Cross-venue generalisation.** One numbered venue in the corpus.
- **Visual Plan Memory on transformed drawings.** Retention 0.786 against a
  0.98 gate — a known, measured, accepted limit, not a solved problem.
