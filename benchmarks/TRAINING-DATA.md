# Captured decisions — the dataset format

Every human decision on a plan now leaves a record with the actual pixels in
it. `src/training-data.js` defines the record; `src/app-v8.js` captures one at
each decision point; `tests/suites/training-data-capture.test.mjs` asserts that
what is stored is what is claimed.

**This is a data foundation. It trains nothing.** Capturing a thousand crops
does not make a model exist, `trainedModel` is false everywhere in it, and
nothing in this pipeline changes a detection.

## Why the crop

Before this, a correction changed a candidate's class and was remembered by
geometry so it would survive Re-Analyze. That keeps one plan tidy and is
useless as training data: it records the answer without the question. Nothing
kept the pixels the person was looking at, what the detector had said before
they disagreed, which plan and which layout version it came from, or which
build produced the prediction. A dataset missing those cannot be evaluated
later, cannot be split without leaking, and cannot be reproduced at all.

## The five decision types

| type | meaning | prediction | human label |
|---|---|---|---|
| `confirmation` | the detector was right, and a person said so | required | required |
| `correction` | a real object, named wrong | required | required |
| `falsePositive` | the detector found something that is not there | required | none |
| `missedObject` | a real object the detector never proposed | none | required |
| `negative` | a real region a person marked as not interesting | either | none |

The shape is enforced at capture: a `correction` with no prediction, or a
`missedObject` that claims one, is refused rather than filtered out later.

Two of these are easy to get wrong:

- **A confirmation is as valuable as a correction.** A dataset of only the
  detector's mistakes teaches a model that everything is a mistake.
- **"Not important" is not a delete.** The review card has three actions:
  *Correct*, *Not an object* (the detector hallucinated — `falsePositive`) and
  *Not important* (the thing is really there and is not something this product
  tracks — `negative`). Both of the last two are stored. Deleting the candidate
  would throw away the one thing that says where the detector should stop
  looking.

## What a record holds

```jsonc
{
  "decisionType": "correction",
  "plan":     { "planHash": "<sha256 of the image bytes>", "name": …, "width": …, "height": … },
  "context":  { "eventId": …, "venueId": …, "layoutId": …, "layoutVersionId": … },
  "geometry": { "x": …, "y": …, "w": …, "h": …, "rotation": 12.5 },   // percent of plan
  "predictionBefore": { "kind": "table", "type": "square", "confidence": 0.49, "source": "tone" },
  "humanTruth":       { "kind": "venue", "type": "column", "seats": null, "seatsConfidence": null },
  "providers": { "detection": { "id": …, "trainedModel": false },
                 "embedding": { "id": "handcrafted-descriptor-v1", "trainedModel": false } },
  "descriptor": { … },                       // the handcrafted vector at capture time
  "crop": { "blobId": …, "size": 96, "sourceRect": { "x": …, "y": …, "w": …, "h": … },
            "objectRect": { … }, "padding": 0.35, "encoding": "image/png" },
  "note": "propagated from candidate_…; not individually reviewed by a person"
}
```

Points that are load-bearing rather than incidental:

- **`planHash` is of the real bytes.** Without it a dataset cannot be split
  without leaking, and cannot notice that a plan was swapped between runs.
- **`rotation` is kept, never normalised.** Rewriting an object to
  axis-aligned destroys the one thing an oriented detector needs.
- **`predictionBefore` and `humanTruth` are both stored.** The difference
  between them is the entire signal.
- **`providers` records which build predicted.** Two examples captured months
  apart are only comparable if it is knowable whether the detector changed.
- **`descriptor`** is the current handcrafted vector, so a learned
  representation can later be compared against the thing it claims to beat, on
  the same objects.
- **`note`** marks labels that were spread rather than individually reviewed.
  One reclassification repairs a whole family; recording forty of those as
  forty human decisions overstates the evidence by a factor of forty.

## The crop

96×96 PNG, square, centred on the object, padded by 0.35 of the object's own
span so the object keeps its context. A square window is used rather than the
object's own aspect because stretching a rectangle to a square would distort
exactly the shape a classifier needs. `sourceRect` records the exact source
pixels, so any crop can be traced back to the plan.

Crops live in their own IndexedDB store (`blobs`, added in DB v2), not in the
state record. A few thousand crops inlined into `state` would turn every
ordinary save — adding a guest, checking someone in — into a multi-megabyte
serialise and parse.

## Export

*Teach AI → Export dataset*, or `MERIT_TRAINING_EXPORT()` from the console.
One JSON file: `format: "merit-training-dataset"`, every record with its crop
inline as a data URL, a summary, and the split.

A missing crop is exported as `{ dataUrl: null, missing: true }` and counted in
`cropsMissing`. It is never replaced with a blank image — a dataset that
silently substitutes empty crops trains on nothing and reports success.

## The split is by plan

`splitByPlan()` groups by plan hash and assigns whole plans to train / val /
test. Splitting individual crops at random puts forty chairs from the same
drawing on both sides of the line, and a model that has memorised one venue
then scores 95% and generalises to nothing.

Two details that exist because the obvious implementation is wrong:

- Allocation is by **plan count**, not by a fraction of a position. Rounding a
  70/15/15 ratio over six plans leaves the test split empty, and an evaluation
  against an empty test set reports nothing while looking like it ran.
- Below three plans there is no split at all: everything goes to train, and
  the export carries a warning saying outright that a dataset from one or two
  drawings cannot say anything about generalising to a new venue.

## Where this stands today

`summarise()` reports a readiness line, and it is deliberately blunt:

- fewer than 3 distinct plans → **"NOT ENOUGH DISTINCT PLANS — this is a
  capture log, not a training set."**
- fewer than 500 examples → too few to evaluate a learned detector against the
  classical pipeline.
- otherwise → enough to *attempt* an evaluation. Whether a learned model beats
  the classical pipeline remains an open question until it is measured.

Only one real venue plan exists in this repository. Everything captured from it
is, by that line's own standard, a capture log.
