# The first look at a venue this system has never seen

```
npm run benchmark:heldout                                   # status
npm run benchmark:heldout -- <plan-image> <annotation.json> # run one
```

## Status: **REAL DISTINCT VENUE PLANS: 1. CROSS-VENUE GENERALIZATION: NOT VERIFIED.**

Every number in this repository was produced on one drawing. The robustness
matrix is that drawing re-rendered sixteen ways. The encoder was trained on
crops from it. The interpreter, the contradiction engine and the review queue
were all built and tuned while looking at it. A system in that position does not
know how well it generalises, and no amount of internal measurement can tell it.

This harness exists **now, before there is a second plan**, so that the first
run on one is a measurement rather than a script improvised by someone who
already knows what they hope to see.

## The rule it enforces

> **A plan the encoder was trained on is not held out.**

Before anything is measured, the plan's content hash is checked against:

- the encoder's own `trainedOn` manifest, read out of
  `src/plan-encoder-weights.js`,
- every annotated plan already in `benchmarks/annotations/`, by both image
  bytes and plan id,
- the run history, for a plan benchmarked before under a **different**
  annotation — re-annotating a held-out plan is how a miss quietly becomes a
  hit.

Any match **refuses the run**. There is no override flag, because the only
reason to want one is to publish a number that is not what it says it is.

Verified by running it against the Golden Plan itself:

```
REFUSED — this plan is not held out:
  - this exact image is already in the corpus as merit-real-venue
  - plan id "merit-real-venue" is already annotated in the corpus
  - the encoder was TRAINED on plan id "merit-real-venue"
```

All three fire independently: renaming the file still trips the id and the
manifest.

### The guard that could not read its own input

The manifest was first extracted with a regex, which silently matched nothing.
The trained-on list came back empty, so the "the encoder was trained on this
plan" check passed by default — a leakage guard reporting the same thing whether
or not there was leakage. It now parses by matching braces, and **a failure to
read the manifest aborts the run** instead of defaulting to "clean".

## What a run records

Appended to `history.json`, never rewritten. A held-out result that can be
edited later is not a held-out result: the value of the file is that the first
number stays visible after someone has improved the thing it measured.

Each entry: the plan and annotation fingerprints, the encoder id and what it was
trained on **at the time of the run**, the annotated corpus at the time of the
run, table and chair precision/recall/F1, how many contradictions and facts the
plan produced, and detection time.

## Reading the result when it happens

The score will be lower than the Golden Plan's. That is the expected outcome and
is not a regression — it is the first honest measurement of something that was
previously unknown. What the run is actually for:

- Does detection degrade, or collapse? A drop from 0.958 to 0.80 is a system
  that transfers; a drop to 0.30 is one that memorised a drawing.
- Does the **second opinion** have any references to work from on a plan with no
  operator decisions, and does its tier say `provisional` honestly?
- Do the contradictions point at that plan's real errors, or at nothing?
- Does the interpreter say something true about a room it has never seen, or
  produce confident sentences about the wrong thing?

**One held-out venue is one data point.** It does not make cross-venue
generalization VERIFIED — it makes it MEASURED ONCE.

## Before that run, one thing must not happen

**Do not train the encoder on the second plan before its first held-out
benchmark.** The moment it is in the training set, the only chance to see this
system's honest behaviour on an unseen venue is gone, and it cannot be recovered
by holding out a third.

## Fail-closed, verified by breaking it

Not asserted from reading the code — the manifest was actually corrupted and the
harness re-run:

| situation | exit | behaviour |
|---|--:|---|
| manifest unreadable, status path | **2** | REFUSED, says the guard cannot read its input |
| manifest unreadable, run path | **2** | REFUSED before anything is measured |
| manifest intact, status path | 0 | reports the corpus and NOT VERIFIED |
| manifest intact, plan already trained on | **1** | REFUSED, naming all three checks that fired |

A missing or malformed manifest is never treated as "safe". The only outcomes
are a refusal or a measurement.
