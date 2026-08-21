---
name: merit-yolo-obb-workflow
description: Original, vendor-neutral MERIT ENTERTAINMENT — EVENT MAKER workflow for building a future oriented (OBB) table/chair detector — detector selection criteria, dataset taxonomy, source-plan-aware splitting, train/tune/infer/evaluate/export workflow, browser-vs-native inference boundaries, model versioning, benchmarking, and the fallback-provider architecture. Use when actual detector training, tuning, dataset engineering, or model export work for Plan Intelligence is in scope — not for the current classical-CV Assisted Detection pipeline itself.
---

# Merit YOLO/OBB Workflow

This is original MERIT engineering guidance for the future trained
detector described in `merit-plan-intelligence`'s roadmap section — it is
written from general object-detection engineering knowledge and public
API/documentation concepts, not reproduced from any vendor's skill or
documentation text. It stays deliberately **vendor-neutral at the domain
boundary**: Ultralytics YOLO is one possible implementation, not the
architecture.

Load this skill when a task involves actually designing, training,
tuning, running, evaluating, or exporting a detector for table/chair
recognition — not for reasoning about the current classical-CV
`runAssistedDetection()` pipeline, which is `merit-plan-intelligence`'s
"What exists today" section, and not for correction-pipeline/UX design,
which is `active-learning-engineer`'s territory via `merit-plan-
intelligence` and `senior-ml-engineer` directly.

## 1. Selecting an oriented detector

The hard requirement, restated from `merit-plan-intelligence`: the
detector must produce an **oriented bounding box (OBB)** or an
equivalently rotation-aware representation for every table — never a
plain axis-aligned box for a rotated table. Two common OBB
parameterizations exist and either is acceptable as long as it round-trips
losslessly into Merit's own `center x/y, width, height, rotation` table
record:

- **5-parameter form**: `(cx, cy, w, h, θ)` — compact, but angle
  discontinuity at the wrap-around point needs care during training
  (loss functions that are periodic-aware, e.g. angle encoded via
  sin/cos or a classification+regression split, avoid the worst of this).
- **8-parameter / 4-corner form**: four `(x, y)` corners — avoids angle
  wrap-around entirely, at the cost of needing a decode step back to
  center/width/height/rotation for the domain model.

Selection criteria for a candidate detector family, in priority order:
1. Native OBB task support (not a bolt-on rotation hack).
2. A path to ONNX export with verified output parity (see §7).
3. Reasonable training cost on a modest dataset (hundreds, not millions,
   of labeled floor plans is the realistic scale here).
4. An inference runtime story that fits the browser/native boundary in
   §6 — either a small enough exported model for constrained runtimes, or
   an acceptance that inference stays server/desktop-side.

Ultralytics YOLO's OBB task variant is one detector that satisfies all
four (see `senior-computer-vision` for general architecture background);
rotated-box variants of other detector families (rotated Faster R-CNN/
RRPN-style two-stage detectors, oriented RepPoints, other DOTA-benchmark
architectures) are the general category of alternatives. Whichever is
chosen, it sits behind `PlanDetectionProvider` (§8) — the choice is an
infrastructure decision, not a domain one, and should be revisited if a
better-fitting option appears later.

## 2. Table/chair dataset taxonomy

Dataset classes map directly onto `merit-plan-intelligence`'s primary
classes — don't invent a parallel taxonomy:

`rectangle_table`, `square_table`, `round_table`, `bistro_table`,
`chair`, `stage`, `bar`, `entrance`, `exit`, `column`, plus an
extensible bucket for restricted/service zones and text labels.

Every table annotation carries `center x/y, width, height, rotation`
(or the corner form, per §1) — never a class label alone. Every chair
annotation is its own object, not folded into a table's seat count (see
`merit-product-contract`'s chair-as-first-class-object rule). Where a
source floor plan's chairs are ambiguous or occluded, annotate what's
visible and mark uncertain cases explicitly rather than guessing a count
from table type.

## 3. Source-plan-aware dataset splitting

Never let crops or annotations from the same source floor plan appear in
more than one of train/validation/test — a detector that's "seen" a venue
layout during training will look artificially good validating against
different crops of that same layout. Group by:

1. Source plan identity (image hash or stable ID) — the strictest,
   always-required grouping.
2. Venue — a detector shouldn't be validated on a venue it was tuned on,
   even via a different plan image of that venue, if venue-level
   generalization matters for the eval question being asked.
3. Layout version — a re-drawn or revised version of the same venue plan
   is still the same underlying venue; treat versions of one venue as one
   group for splitting purposes unless there's a specific reason not to.

A practical split: hold out entire venues for test (never trained or
tuned against), and split remaining venues' plans across train/val by
plan identity. Log which venues/plans landed in which split as part of
the dataset version record (§8) — an eval result is not trustworthy
without knowing this.

## 4. Training workflow

1. Start from a pretrained checkpoint and fine-tune — training an
   oriented detector from random initialization needs orders of magnitude
   more data than this domain realistically has.
2. Run a 1-epoch smoke test first: confirm annotations actually land on
   the right objects at the right rotation before committing to a full
   run — a silently transposed width/height or a wrapped-angle bug will
   otherwise burn a full training budget before it's caught.
3. Use named constants for every hyperparameter that matters (learning
   rate, epoch count, batch size, image size) rather than magic numbers
   scattered through scripts or notes — this also makes a training run
   reproducible from its logged config alone.
4. Watch for the standard failure modes: OOM (reduce batch size or image
   size before reducing model size), NaN loss (usually a learning-rate or
   malformed-annotation problem, not a hardware problem), and
   suspiciously low mAP with normal-looking loss curves (check the
   dataset split and class balance before assuming the model is at
   fault).
5. Keep the best checkpoint by validation metric, not the last checkpoint
   by training step — they're rarely the same one.

## 5. Hyperparameter tuning workflow

Tuning is a separate, bounded activity from the first training run above,
not something to run by default on every iteration:

1. Only tune once a baseline trained model's failure modes are understood
   — tuning against an unknown baseline wastes the search budget on the
   wrong axes.
2. Define a search space over the hyperparameters actually suspected to
   matter (learning rate schedule, augmentation strength, image size) —
   don't search everything simultaneously.
3. Set an explicit budget (trial count or wall-clock time) up front, and
   evaluate every trial against the **same** held-out validation group
   from §3 — never let the tuning process pick its own validation split.
4. A tuning result is only trustworthy if it also holds on the untouched
   test-only venues from §3 — report both, and be suspicious of a large
   gap between them.

## 6. Inference workflow and the browser/native boundary

Inference workflow, once a model exists: batch predictions where
possible, apply a confidence threshold and rotated-NMS to suppress
duplicate/overlapping detections, then decode results into the same
`center x/y, width, height, rotation, chairDetections[]` shape
`commitCandidates()` already expects (see `merit-plan-intelligence`) —
the review/confirmation UI should not need to know whether a detection
came from classical CV or a trained model.

**Browser/native boundary — current stage is browser review.** The
shipped app runs classical CV entirely client-side, with no model file
and no Python. A future trained detector's *inference* may eventually run
client-side too (e.g. via a WASM/ONNX-Runtime-Web-class runtime, if a
compact enough exported model justifies it) — but **training** never
runs in the shipped product, and the end user is never asked to install
Python, exactly as `merit-desktop-architecture` and `CLAUDE.md`'s EXE
gate require. Until a controlled developer/build environment actually
does this work, treat all of this section as design guidance, not a
description of running code.

## 7. Evaluation

Track only real, measured metrics — never fabricate a number to fill in
a table. Use the metric set `merit-plan-intelligence` already names:
precision, recall, mAP (computed with rotated-IoU matching, not
axis-aligned IoU, given the OBB requirement), table recall, chair
recall, exact seat-count accuracy, table-type accuracy, mean rotation
error, and stage-detection quality. Evaluate on the test-only venue group
from §3, never on anything used for training or tuning.

## 8. ONNX export and benchmarking

Export practice, independent of which detector family produced the
weights:

1. Pin the export opset/format version and record it alongside the
   exported artifact — silent opset drift between export and inference
   environments is a common source of subtle numeric mismatches.
2. **Verify parity**: run the same held-out images through the original
   model and the exported artifact, and confirm detections match within
   a small tolerance before trusting the export. A clean export that
   silently changes outputs is worse than a failed one.
3. Confirm whether NMS is baked into the export or must be applied
   post-inference — this varies by export target and is a common cause
   of duplicate detections after export if assumed wrong.
4. Benchmark latency/throughput on representative Merit floor-plan images
   (not a generic benchmark image set) at the resolution the product
   actually uses, and compare against the classical-CV baseline on the
   same images — a trained model that's more accurate but too slow for
   the product's interactive review flow is not yet a shippable
   improvement.

## 9. Model versioning

Every exported model artifact is versioned together with: the dataset
version it was trained on (including which venues/plans were in which
split, per §3), the training config (hyperparameters, base checkpoint),
and the evaluation metrics from §7 that justified its candidacy. This
feeds directly into `merit-plan-intelligence`'s candidate/champion/
challenger lifecycle and `senior-ml-engineer`'s registry/promotion/
rollback discipline — a model version without this record is not
eligible for promotion.

## 10. Fallback-provider architecture

This workflow produces one possible implementation behind
**`PlanDetectionProvider`** (see `merit-plan-intelligence`'s "Provider
abstraction" section) — it never becomes something the domain/application
layer depends on directly. Concrete providers this workflow anticipates,
purely as illustrative names for the same interface:

- `ClassicalCvProvider` — today's heuristic pipeline; the guaranteed
  always-available fallback if no trained provider is installed or a
  trained provider errors.
- `UltralyticsObbProvider` — a future provider wrapping an Ultralytics
  YOLO OBB model, if that's the family chosen per §1.
- `OnnxObbProvider` — a future provider running an ONNX-exported OBB
  model through ONNX Runtime, independent of which framework trained it.
- `FutureDetectorProvider` — a placeholder for whatever else turns out to
  fit best; the interface is the contract, not any one of these names.

A trained provider failing to load, erroring, or returning nothing must
fall back to `ClassicalCvProvider` rather than leaving Plan Intelligence
non-functional — and per `merit-plan-intelligence`'s AI-truthfulness
rules, the UI must always accurately reflect which provider actually
produced a given result ("Assisted Detection" for classical CV, or the
real model identity/version once a trained provider is active — never
implying one when the other ran).
