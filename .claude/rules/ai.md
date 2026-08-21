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
  delete — it carries real training signal.
- `improveAI()`-style local calibration is not model training and must
  never be described as such; `trainedModel` flags must reflect reality.
- Full detail: `.claude/skills/merit-plan-intelligence/SKILL.md`.
