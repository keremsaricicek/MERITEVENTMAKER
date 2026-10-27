# Roadmap (owner, 2026-10-27: "yol haritası oluştur, uygula, hiçbir şey atlama")

Every step ends with its evidence committed. Bars are pre-registered in
`training/README.md` (models) or in the step's own design section before any
result is seen. Order is by dependency; steps marked ∥ run while the CPU trains.

## A. Models
| # | Step | Evidence / bar | Status |
|---|---|---|---|
| A1 | runB6c: train (B6b + tucked chairs + bench/serves + 1,500 Turkish briefs), then tucked test, real test, fresh blind4 test, S1, dev, language test | `training/README.md` "runB6c"; per-question rule vs B6b | training (2026-10-27 13:25 UTC) |
| A2 | B6c verdict → QA audit → conversion check (agree) → wire every question that passes (manifest `checks`) | suite `local-second-look` V6 branch | after A1 |
| A3 | Seat counts from chairs one by one in the PRODUCT (relay asks identify per detected chair; count by geometry; never adds a chair) | measured 18/20 with B6b; wired when identify passes (A2) | after A2 |
| A4 | Changing the plan by itself (`autoApply`) for a question that passes the stricter bar (agreed-and-wrong ≤ 3 % on real AND V5 tests, n ≥ 30) — same writer as Accept, marked as the model's, one-click undo, never a training label | `training/README.md` "Changing the plan by itself" | after A2 |
| A5 ∥ | Chat/command model candidates: Qwen3.5-4B, Gemma 4 E4B, Kara-Kumru 2B (+ B6c) on the 40 briefs and the command set (C4) | brief bar: fields ≥ 0.90, invented ≤ 0.05; commands C4 | download now, test after A1 |
| A6 | Small own ViT classifier (identify) — pre-register first, same data and tests | `training/README.md` | after B-package |

## B. Product and package
| # | Step | Evidence | Status |
|---|---|---|---|
| B1 | Windows package: one-click `MERIT-Baslat.cmd` (no EXE), chosen model (B6b → B6c if it wins), GPU via Vulkan llama.cpp with CPU fallback and a first-run answer check against CPU answers, BENIOKU, sample plan | `tools/local-vlm/windows/`; offline run verified (Linux simulation, said so) | after A2 |
| B2 | Before/after demo on the same plan (old vs new model, corrections needed) | screenshots + numbers | with B1 |
| B3 | Third real plan blind test (owner sends it): label, owner confirms counts, freeze, score once | `benchmarks/` | waiting for the plan |

## C. AI planner and F8 assistant (`benchmarks/AI-PLANNER-DESIGN.md`)
| # | Step | Evidence | Status |
|---|---|---|---|
| C1 ∥ | Brief schema + feasibility check + layout engine (banquet, theatre, classroom, U, boardroom, cocktail) as a pure module with tests | suite: no overlaps, clearances met, totals exact (100 %) | **first version done** (`src/planner-layout.js`, suite `planner-layout`, 56 checks; not loaded in the app until C3) |
| C2 | Brief parser: rules first, model second (schema-constrained) | 40-brief test ≥ 0.90 fields, invented ≤ 0.05 | after A5 |
| C3 | Planner window UI (chips, 2–3 options, Uygula / Geri al) | screenshots at 3 viewports; UI suites | after C1 |
| C4 ∥ | F8 assistant: fixture events + written question set (§11) and command set (§12) with expected tool calls | sets committed before any model sees them | **done** (`training/assistant/`) |
| C5 | F8 tools: read-only (findPerson, eventsOf, seatOf, findEvent, eventFacts) and acting (through the app's writers; one undo per command; `canMutate`) | suite: right answer from data; every command undone by one undo | **read-only tools done** (`src/assistant-tools.js`, suite `assistant-tools`: all 20 questions answered right from the data); **acting layer done** (`src/assistant-actions.js`, suite `assistant-actions`: all 15 commands — right calls, asks, refusals, one undo each); wiring into the app with the real writers comes with C6 |
| C6 | F8 panel UI (right side, small; Esc closes) | screenshots; keyboard/a11y | **first version done** (`src/screen-assistant.js`, suite `assistant-panel`; F8/Esc, answers from data, commands through the writers with one undo, past events refused, the owner's strip; screenshots 1920/2560/1440 with no console errors). Rules-first reader only; the model joins after A5 |
| C7 | Memory (habits, venues) local, listed, deletable | suite | after C6 |
| C8 | Offline voice (Whisper-small class) | word error reported; owner's own test | last |

## D. Gates (every milestone)
- Full `npm test`, both offline builds + `verify-offline-package`, CI green.
- `.claude/STATE.md` updated; short Turkish report to the owner with tables.
