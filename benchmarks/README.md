# MERIT EVENT MAKER — Detection Benchmark

Ground truth lives here as data, never inside test code, so it can be
reviewed, corrected and extended by a person without touching a runner.

```
benchmarks/
  plans/            real venue plans (the images themselves, committed)
  fixtures/         synthetic plans whose truth is known by construction
  annotations/      *.json ground truth, one per plan/fixture
  reports/          runner output, one JSON per run
  run-benchmark.mjs the runner
```

## Why object-level

A total count proves nothing. A detector can report 46 tables on a plan
that has 46 tables while missing 6 real ones and inventing 6 others. Every
accuracy claim here is therefore computed per object by matching detections
to annotated objects, never by comparing totals.

Matching rule: a detection matches an annotated object when their centres
are within `matchToleranceP` percent of the plan's diagonal AND (for sized
objects) their boxes overlap. Each annotated object may be matched at most
once — the best (nearest) detection wins, so two detections on one real
table produce one true positive and one false positive, which is exactly
the over-splitting failure mode we need to see.

## Annotation format

```jsonc
{
  "planId": "merit-real-venue",
  "source": {
    "file": "plans/merit-real-venue-plan.png",
    "sha256": "...",            // so a silently swapped image is detectable
    "width": 1355, "height": 788,
    "venue": "…", "layout": "…"  // optional, for Venue/Layout Memory work
  },
  "annotationMethod": "…",       // how the truth was established — required
  "confidence": { "tables": "high", "chairs": "medium", … },
  "objects": [
    { "id": "t01", "class": "table", "type": "square",
      "cx": 845, "cy": 98, "w": 52, "h": 48, "rotation": 0,
      "seats": 2, "seatsConfidence": "high" }
  ],
  "relationships": [ { "chair": "c01", "belongsTo": "t01" } ],
  "logicalGroups": [ { "id": "g1", "members": ["t01","t02","t03"], "seats": 8 } ],
  "capacity": {
    "ocrStated": { "seating": 114, "bistro": 10, "total": 124 },
    "annotatedChairs": 105,
    "unverified": [ { "objectIds": ["s01","s02","s03"], "reason": "…" } ]
  },
  "regions": [ { "class": "text", "x": 100, "y": 55, "w": 170, "h": 80 } ]
}
```

`class` is one of: `table`, `chair`, `sofa`, `bench`, `banquette`,
`armchair`, `lounge_table`, `stage`, `bar`, `entrance`, `exit`, `column`,
`architecture`, `text`, `ignore`.

`type` (tables only): `rectangle`, `square`, `round`, `bistro`.

### Honesty rules for annotations

- `annotationMethod` is mandatory and must describe how truth was actually
  established. "Counted from the image" and "known by construction" are
  very different evidence and must not be conflated.
- Where the drawing genuinely does not support a confident number (a
  banquette's seat count, for example), record it under
  `capacity.unverified` rather than guessing. A guessed number that later
  gets reported as a metric is worse than an admitted unknown.
- `capacity.ocrStated` is what the drawing itself claims. It is evidence,
  not automatically truth, and is reported separately from what was counted.

## Running

```
npm run benchmark                            # all annotated plans
node benchmarks/run-benchmark.mjs realplan   # substring filter
npm run benchmark:baseline                   # compare this run to BASELINE.json
node benchmarks/record-baseline.mjs --record # adopt this run as the new baseline
```

The runner serves the app itself and drives the real detector through the real
UI, because most of the domain logic is closure-scoped and not reachable any
other way. Set `MERIT_BASE_URL` to point it at a server you already have.

## Notes on specific failures

- `DETECTION-GATE-C-D.md` — text and architectural false-positive suppression.
- `BISTRO-MERGE.md` — the five remaining real-plan misses, the fixture that
  reproduces them, and one fix that was measured and rejected. Read it before
  touching fragment suppression.
- `detection/ERROR-CATEGORIES.md` — every remaining error on the real plan.
- `TRAINING-DATA.md` — what a human decision captures.

## The recorded baseline

`BASELINE.json` is the committed claim about what the detector currently does:
per plan, per field, at a named commit, against images with recorded hashes.
`npm run benchmark:baseline` compares a fresh run to it and exits non-zero on
any drop.

Fields are compared one at a time and per plan, on purpose. A single overall
score hides the trade this project cares most about — chair recall rising
while table F1 collapses — and that trade is a revert, not a win. An
improvement is reported and never fails the run. If a change genuinely earns
worse numbers somewhere, re-record with `--record` and say why in the commit
message; the baseline is a claim someone made deliberately, not a rubber stamp.
