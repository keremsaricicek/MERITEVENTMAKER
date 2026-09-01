# Operator usability

## Status: **INFRASTRUCTURE READY. REAL OPERATOR USABILITY: NOT VERIFIED.**

No person has performed this test. Nothing in this repository may be read as
saying the review screen works for someone doing this job, and this file exists
partly to make that impossible to imply by accident.

Everything else measured in `benchmarks/` — the queue reaching three times as
many real errors per action as random, the contradiction engine pointing at
things that are actually wrong, the interpreter's 0.9130 — was produced by
scripts. A script never gets confused by a card, never scrolls past the item it
needed, and never decides the third question is not worth answering. Those
numbers say the *information* is good. They say nothing about whether a person
can use it.

## What is ready

**The instrument.** A review session is recorded locally, in
`state.operatorSessions`: when it started, every action taken, the time since
the session opened, and where that action sat in the order the product had
suggested **at the moment the session began** (not recomputed afterwards, which
would flatter the ordering). `MeritOperatorSessions.summary(analysisId)` reads
it back.

It is entirely local. `tests/suites/operator-session.test.mjs` asserts that not
one off-origin request is attempted from the moment recording starts, that no
request the page ever makes is anything but a GET for a vendor asset, and that
the operator-session code contains no `fetch`, `XMLHttpRequest`, `sendBeacon`,
`WebSocket` or `EventSource` — absent, not disabled. A tool that watches
someone work and can also phone home is a different product from the one they
agreed to run.

Nothing about the recording is shown to the operator while they work. Being
shown your own speed mid-task is a product decision nobody asked for.

## The one-click report

`Advanced Diagnostics → Session report`, on the review screen. No developer
console, no URL flag: the person running the test clicks a button and reads a
page they can copy and send back.

It reports **Import → Confirm**, analysis time, review time, time to first
action, how many actions were taken and how many landed on the suggested queue,
whether they started at the top of it, what is still unreviewed, what the
analysis held back, how many disagreements are still open, and whether the plan
was confirmed. Then the eight questions below it, on the same page.

It reports what happened and **does not grade it**. There is no baseline for a
"good" review time, and inventing one would be the overclaiming this product
refuses everywhere else.

The timings live on the background (import) and the analysis (everything after),
because both survive the event migration — a `planTimings` field on the event
itself was silently dropped by `migrateEvent`, which is the kind of thing a test
that reads the *value* catches and a test that reads the *code* does not.

## The test a person has to perform

One session, one real plan, one person who does event operations and has not
been shown the screen first. Do not explain the queue beforehand — whether it
explains itself is most of the question.

Give them the plan and one instruction: *"Get this floor plan into the system
correctly."* Then stop talking.

Open the session report at the end. It fills in the numbers; these are the
answers only a person can give, and they are printed on the same page:

| # | question | what to write down |
|--:|---|---|
| 1 | Did they find the review queue without being told it existed? | yes / no, and how long |
| 2 | Did their first action land on the top item? | `firstActionWasTopOfQueue` |
| 3 | Did they read a disagreement, or scroll past it? | which ones they stopped on |
| 4 | Could they say, unprompted, what a disagreement was telling them? | their words, verbatim |
| 5 | Did "certain / likely / uncertain" change what they did? | quote what they said about a claim |
| 6 | Did "apply to all" read as one decision or as a risk? | did they use it, or confirm one by one |
| 7 | Did the visual check line mean anything to them? | their words |
| 8 | Where did they stop, and why? | done / gave up / ran out of patience |
| 9 | What did they look for and not find? | verbatim |
| 10 | Would they use this instead of what they do now? | yes / no, and the reason |

Also record, from the session: total actions, time to first action, share of
actions on the queue versus off it, and mean suggested position. An operator
who works entirely off-queue is telling you the ordering is not usable, whatever
`benchmarks/review-order/` measured.

## Two failure modes this test exists to catch

**Confident wrongness read as authority.** The interpreter is right about 21 of
23 checkable claims. If an operator reads all of them at the same weight and
does not notice that `uncertain` means something, the strength system is
decoration, and the one claim in twenty that is wrong gets acted on.

**A queue that is right and unused.** Ordering the queue by what one answer
settles is worth 40% over ranking by cost class, measured. If a person works
through the objects on the canvas instead and never reads the list, that
improvement is worth nothing and the effort belongs elsewhere.

## What may be reported before that session happens

> OPERATOR TEST INFRASTRUCTURE: READY

What may **not** be reported:

> ~~REAL OPERATOR USABILITY: PASS~~

Until an actual person has done the above, on a real plan, in front of someone
writing down what they said.
