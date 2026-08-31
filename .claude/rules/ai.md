# Plan Intelligence / AI rules

- Never fabricate detections, seed positions, confidence scores, or model
  metrics. Never infer plan content from a filename. Never leak object
  positions from another event.
- Classical CV output (the current `runAssistedDetection` pipeline) is
  labeled **"Assisted Detection"** — never "AI" or "trained model."
- If no trained domain model is installed, the UI states **"DOMAIN MODEL
  NOT INSTALLED"** — never implies one is running.
- Preserve rotation/orientation on every detected object — never force to
  axis-aligned.
- Chairs are detected/associated individually, never collapsed to a bare
  seat count on the table. Confirmed chair coordinates from a candidate
  are written verbatim — never regenerated into a synthetic ring.
- OCR is supporting evidence only; it never defines geometry by itself.
- "Ignore/Not Important" in Teach AI is a stored negative example, not a
  delete — it carries real training signal. It is the "Not important"
  action, and is distinct from "Not an object": one says the thing is
  real but untracked, the other says the detector hallucinated. Both are
  captured.
- Every human decision captures a training example with the real crop and
  full provenance (`benchmarks/TRAINING-DATA.md`). Capturing examples is
  not training: never let a growing dataset be described as a model
  improving. Labels spread to a family are marked as not individually
  reviewed, and dataset splits group by plan so one venue cannot appear
  on both sides.
- `improveAI()`-style local calibration is not model training and must
  never be described as such; `trainedModel` flags must reflect reality.
- Full detail: `.claude/skills/merit-plan-intelligence/SKILL.md`.
