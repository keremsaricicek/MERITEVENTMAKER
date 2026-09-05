# Gates H/I — human decisions survive Re-Analyze

```
node benchmarks/teach/human-decisions-survive-reanalyze.mjs
```

Exits non-zero if an object the operator confirmed does not come back.

## What this guards

Plan memory already re-applied corrections by **geometry rather than by id**
(`applyPlanMemory` in `src/app-v8.js`): the source image does not change and
the classical CV pipeline is deterministic, so the same physical object
reappears at essentially the same position on every run. Candidate ids are
regenerated each pass, so matching on them would lose every correction.

Gate C/D's fragment suppression introduced a way to break that, because the
filter runs **inside detection, before memory is re-applied**. If it drops a
candidate the operator explicitly confirmed as a real table, memory has nothing
left to match against and the object disappears from their plan. An automatic
filter deleting a human's decision is the worst failure this feature can have.

## What was found

The confirmed object *did* survive — but for the wrong reason. The filter
removed the table candidate, and memory then matched an unrelated **chair**
candidate that happened to sit at the same position and rewrote it back into
the confirmed table. That is an accident of this particular plan, not a
guarantee: on a plan with nothing else at that position, the object would be
gone.

So the protection is now explicit. `runAssistedDetection` passes
`protectedRegions` — every region carrying a `confirmed` or manually drawn
memory entry — into `provider.detect()`, and fragment suppression skips any
candidate inside one. Measured on the real venue plan with one confirmed
fragment: `dropped` falls from 35 to 34 and `protectedByHumanDecision: 1`
appears in diagnostics.

The rule this encodes: **an automatic filter may disagree with the detector.
It may not overrule a human.**

## What the test does

Drives the real review UI, not closure internals.

1. Runs detection with the fragment filter **off** via the benchmark A/B switch,
   so fragments are present and selectable.
2. Finds a candidate that trips three or more disagreement reasons — one the
   filter would definitely drop.
3. Confirms it through the actual `[data-review-action="confirm"]` control, so
   plan memory is written by the real code path.
4. Turns the filter back **on** and clicks the real Re-Analyze button.
5. Asserts the object is still there, still `confirmed`, and flagged
   `fromMemory` so it is never passed off as a fresh detection.

## Note on a stale sibling test

`test-plan-memory.mjs` (scratchpad, not committed) fails on
`grouping-test-plan.png` waiting for a `.review-pin.question` that no longer
appears. That failure is **pre-existing and unrelated**: the fixture produces
0 uncertain questions at commit `65870a0`, before any of this work, and
fragment suppression drops nothing on it (`frag: 0` with the filter both on and
off). Uncertain questions themselves still work — the real venue plan generates
12.
