# Plan Intelligence / AI rules

- Never fabricate detections, seed positions, confidence scores, or model
  metrics. Never infer plan content from a filename. Never leak object
  positions from another event.
- Classical CV output (the current `runAssistedDetection` pipeline) is
  labeled **"Assisted Detection"** — never "AI" or "trained model."
- If no trained domain model is installed, the UI states **"DOMAIN MODEL
  NOT INSTALLED"** — never implies one is running.
- The local plan-symbol detector (`src/plan-model.js`) is the one trained
  model in the product. An analysis says it ran only when it loaded from its
  pinned bytes (size + sha256) and ran; a missing/corrupt/disabled model
  falls back to the classical path and says why. What it adds is unreviewed
  and never dressed as a person's decision; fusion removes and moves
  nothing. Its quality is reported per venue and per fold against
  `benchmarks/offline-intelligence/ACCEPTANCE.md`, whose thresholds are never
  changed after a result is seen, and a score on a venue it trained on is
  never presented as an unseen-venue score.
- Preserve rotation/orientation on every detected object — never force to
  axis-aligned.
- Chairs are detected/associated individually, never collapsed to a bare
  seat count on the table. Confirmed chair coordinates from a candidate
  are written verbatim — never regenerated into a synthetic ring.
- OCR is supporting evidence only; it never defines geometry by itself.
- "Ignore/Not Important" in Teach the Plan (formerly Teach AI) is a stored negative example, not a
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
- A Teach Area lesson is a scoped note, never training. It applies within the
  scope the operator chose and nowhere else, changes ONE object rather than
  every object that resembles it, and is only applied across a venue when a
  verified printed number identifies the object. AMBIGUOUS applies to nothing.
- `improveAI()`-style local calibration is not model training and must
  never be described as such; `trainedModel` flags must reflect reality.
- The vision-language model reading goes through `server/vlm-relay.mjs`
  only. The key lives in that process's environment (`ANTHROPIC_API_KEY`) —
  never in `src/`, a committed file, a log or a reply; the relay ignores
  `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_CUSTOM_HEADERS`. A
  person starts every send; findings are suggestions applied only by a
  person's Accept, one object at a time, through the existing writers. A
  printed table number is never taken from a model.
- The LOCAL second look (`/vlm-relay/ask`) asks only questions a pinned local
  model was measured on (manifest `checks`), only about places a person has
  not decided, two looks per place, and applies nothing. It starts by itself
  after an analysis (owner's decision, 2026-10-18) with an off switch; never
  widen that to a paid provider or to applying a finding.
- A result against `tests/lib/fake-anthropic.mjs` is SCRIPTED. Never report
  it, or anything measured with it, as a model's accuracy.
- Full detail: `.claude/skills/merit-plan-intelligence/SKILL.md`.
