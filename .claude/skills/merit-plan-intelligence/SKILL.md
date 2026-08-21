---
name: merit-plan-intelligence
description: High-priority domain skill for MERIT ENTERTAINMENT — EVENT MAKER's floor-plan understanding — Assisted Detection (classical CV), the OBB/rotation-aware table-detector requirement, the PlanDetectionProvider abstraction, chair-first-class objects, chair-table association, Teach AI corrections, active-learning data, and the strict AI-truthfulness rules. Use for any work touching floor-plan analysis, object/chair detection, OBB, OCR, Teach AI, verified examples, or model lifecycle.
---

# Merit Plan Intelligence

Long-term goal: upload a real venue/event floor plan and automatically
understand its physical objects, with human-verifiable corrections and
trainable feedback. This is one of the most important capabilities of the
product. This skill covers both **what exists today** in `src/app-v8.js`
and the **future architecture** it should grow into — keep those clearly
separated in any work here.

## What exists today (read this before assuming otherwise)

`runAssistedDetection()` in `src/app-v8.js` is classical computer vision,
not a trained model: Otsu thresholding, adaptive local thresholding, an
edge map, connected-component analysis (with PCA-based rotation via
covariance), and heuristic size/fill/aspect filters that bucket components
into `chairs`, `tables`, and `venues`. Chair↔table association is
proximity-based (nearest components within a margin of each table). This
is real, useful, and already chair-aware — it is not a stub.

The result is stored on `event.analysis` with `engine: "ASSISTED_DETECTION"`
and `trainedModel: false`, and the UI notice string is explicit: *"Classical
computer vision is active; no trained Merit model is installed in this
browser review."* Preserve that honesty — see "No fake AI" below.

`commitCandidates()` writes confirmed candidates into real `table`/`chair`/
`venueObject` records only after user confirmation — nothing is added to
the plan automatically. Confirmed chair detections are written verbatim as
`table.chairs` (real detected coordinates), never regenerated into a
generic ring.

Teach AI today: `ui.teachAI`, manual "Draw Missed Detection"
(`bindReviewDrawing`), `saveVerified()` (pushes to
`state.verifiedExamples`), and `improveAI()` (a **local confidence
calibration**, not model training — it computes a recommended confidence
threshold from verified examples and stores it as `state.calibration` with
`trainedModel: false`). This is real, working local calibration; it must
never be described or displayed as neural-network training.

## Primary object classes

`rectangle_table`, `square_table`, `round_table`, `bistro_table`, `chair`,
`stage`, `bar`, `entrance`, `exit`, `column`. Allow extension for
restricted/service zones, text labels, and other venue objects without
corrupting this core taxonomy — extend, don't overload existing classes.

## Future architecture (roadmap — do not claim it's built)

A serious ensemble, when actually built in a controlled dev/build
environment:

1. Trainable oriented detector — prefer YOLO OBB or an equally justified
   oriented detector (preserve rotation; never force it to zero).
2. Dedicated chair detector.
3. OCR (supporting evidence only — see below).
4. OpenCV geometric verifier.
5. Chair → table spatial association (rectangular tables: TOP/RIGHT/
   BOTTOM/LEFT side awareness; round tables: polar/angular placement).
6. Repetition clustering (tables of the same type/size repeat across a
   venue — useful signal, already used heuristically today via
   `evidence.repetition`).
7. Active learning / verified corrections feeding future training.
8. Model registry/versioning with champion/challenger and rollback.
9. Dataset lifecycle management.

**OBB requirement — non-negotiable.** The preferred table detector must
support oriented bounding boxes (OBB) or an equivalently rotation-aware
representation. Do not convert rotated rectangular tables into
axis-aligned boxes unless technically unavoidable. Always preserve
`center x/y`, `width`, `height`, `rotation` end to end — from detection,
through the review UI, through confirmation, into the persisted table
record. Use OBB output or `minAreaRect`/PCA where appropriate (the current
PCA rotation computation in `runAssistedDetection` is exactly this
pattern, just on connected components instead of a trained detector).
Chair detections remain first-class objects under this rule too — a
confirmed chair's real detected coordinates are never discarded or
regenerated after confirmation (see "Chairs are first-class" below).

When real detector training starts, `.claude/skills/
merit-yolo-obb-workflow/SKILL.md` is the original, vendor-neutral MERIT
workflow for this — detector selection, OBB dataset taxonomy and label
formats, source-plan-aware splitting, training/tuning, inference,
evaluation, and export. It stays vendor-neutral by design: no specific
vendor's SDK/skill package is assumed or required to read it.

## Provider abstraction — never hard-wire to one vendor

MERIT EVENT MAKER must retain a **`PlanDetectionProvider`** abstraction in
the domain/application layer. The domain layer depends on this interface,
never directly on a vendor's detection API (Ultralytics/YOLO, ONNX
Runtime, or any other SDK). Concrete implementations behind that
interface can include:

- `ClassicalCvProvider` — today's `runAssistedDetection` heuristics; the
  guaranteed always-available fallback.
- `UltralyticsObbProvider` — a future Ultralytics YOLO OBB model, if that
  turns out to be the chosen detector family (see
  `merit-yolo-obb-workflow`).
- `OnnxObbProvider` — a future ONNX Runtime-based provider, independent
  of which framework trained the model.
- `FutureDetectorProvider` — whatever else turns out to fit best; the
  interface is the contract, not any one of these names.

This mirrors the boundary discipline in `.claude/skills/
software-architecture/SKILL.md` — treat detection engine choice as an
infrastructure detail behind a stable interface, not something the UI or
domain logic reaches through to a specific vendor SDK. `merit-yolo-obb-
workflow` is knowledge for implementing one such provider later — it is
not permission to wire the application directly to any vendor's package.

## Chairs are first-class — never collapse to a seat count

Never reduce floor-plan understanding to "this is an eight-seat table."
Detect table geometry **and** individual chairs, then associate chairs
with tables; each chair belongs to at most one table. This mirrors the
`table.chairs` array already in the domain model (see
`merit-product-contract`) — plan intelligence should populate that
structure with real detected/verified positions, never a synthetic
fallback ring, once a table is confirmed.

## OCR is supporting evidence only

Labels like STAGE/SAHNE, BAR, ENTRANCE/ENTRY/GIRIŞ, EXIT/ÇIKIŞ, VIP/VVIP,
BISTRO, TABLE/MASA may support classification. OCR text alone never
defines physical geometry — geometry comes from detection, OCR only helps
disambiguate class or confirm a label.

## Analysis quality profiles (future)

Support `FAST` / `BALANCED` / `PRECISE` profiles once real inference exists;
default product intent is `PRECISE`. Avoid aggressive downscaling — prefer
high-resolution inference, multi-scale, or tiling over shrinking the image
to fit a cheap pass. (Today's implementation already caps working
resolution at 1920px on the long edge for performance — that's a pragmatic
current constraint, not the target end state.)

## AI truthfulness — strict, non-negotiable

- Never fabricate detections, seed positions, or leak object locations
  from another event.
- Never use filename assumptions to infer plan content.
- Never generate random/fake confidence scores or fake model metrics.
- Classical CV output must be labeled **"Assisted Detection"**, never
  "AI" or "trained model."
- If no trained domain model is installed, show **"DOMAIN MODEL NOT
  INSTALLED"** rather than implying one exists.
- Never call OpenCV/classical heuristics "trained AI."

## Teach AI — UX model for a normal employee, not an ML engineer

Teach AI must never expose class IDs, YAML, tensor language, or annotation
jargon. Default framing: "AI needs your help" — show the crop, ask "What
is this?" with plain object-type buttons (Rectangle Table, Round Table,
Square Table, Bistro Table, Chair, Stage, Bar, Entrance, Exit, Column,
Other Object, Ignore/Not Important). If a table type is chosen, ask "how
many chairs?" and let the user add/remove/move chair markers. Support "AI
missed this" (draw a region, then classify) and negative examples via
Ignore/Not Important — store negative examples, don't just delete them;
they carry real training signal.

## Active learning data — what a verified example must preserve

Source image identity/hash, crop coordinates, `predictionBefore`,
`userGroundTruth`, false positives, missed detections, ignored/negative
examples, object type, chair markers and chair↔table relationships,
confidence, model version, analysis settings, event context where
appropriate, and a timestamp. `saveVerified()` today is a reasonable
starting shape for this — extend it, don't replace its intent.

## Train/val/test discipline (future, once real training exists)

Avoid data leakage: never split crops from the same floor plan across
train and validation/test. Use group-aware splits — by source plan, venue,
or layout version.

## Model evaluation and lifecycle (future)

When a real trained model exists, track real metrics only: precision,
recall, mAP, table recall, chair recall, exact seat-count accuracy,
table-type accuracy, mean rotation error, stage-detection quality — never
fabricated numbers. Support candidate/champion/challenger models with
explicit activation and rollback; never silently swap or promote the
production model after one correction — promotion happens only after
explicit evaluation against these tracked metrics. `.claude/skills/
senior-ml-engineer/SKILL.md` covers the general production-MLOps
discipline behind this (deployment workflow, drift monitoring, registry,
automated-retraining safeguards, A/B testing, rollback) — apply it, don't
duplicate it here.

## Browser training honesty

If browser review truly cannot train the neural model, say so. The
browser can collect corrections, build a dataset, run local calibration
(as `improveAI()` does today), and run inference — real training happens
later in a controlled developer/build environment. The end user must never
be asked to install Python (see `merit-desktop-architecture`).
