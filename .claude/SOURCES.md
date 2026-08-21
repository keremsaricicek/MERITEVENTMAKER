# Sources & Attribution

This file records provenance for every external skill vendored into
`.claude/skills/`, plus the research trail for requests that turned out to
have no good source. All commit hashes and dates below were confirmed by
cloning the source repository directly (not by trusting a search result)
during this environment's setup session. Original `LICENSE` files are
copied alongside each vendored skill — do not remove them.

## Vendored external skills (20)

### 1. ui-ux-pro-max
- **Purpose:** Searchable UI/UX design intelligence — styles, palettes, font
  pairings, UX guideline rules, stack-specific implementation notes.
- **Source:** `https://github.com/nextlevelbuilder/ui-ux-pro-max-skill`
- **Path vendored:** `.claude/skills/ui-ux-pro-max/SKILL.md` (repo root)
- **Commit:** `bc826e2267a36d98a2dcf5231e16c30ff546770f` (2026-08-20)
- **License:** MIT (Next Level Builder, 2024) — `LICENSE` included.
- **Vendored as:** `.claude/skills/ui-ux-pro-max/` (SKILL.md + references/ +
  scripts/ + data/ — the `data/` directory is the searchable dataset the
  skill's own `scripts/search.py` queries; the skill does not function
  without it, so it is vendored in full rather than partially).

### 2. frontend-design (official Anthropic)
- **Purpose:** Distinctive, intentional visual design guidance; explicitly
  names and steers away from three common "AI-generated" default looks.
- **Source:** `https://github.com/anthropics/skills`, path
  `skills/frontend-design/SKILL.md`
- **Commit:** `3b3fad96af16a10759d930941b4520ba0c40edae` (2026-08-21)
- **License:** Apache License 2.0 (`LICENSE.txt` inside the skill folder).
- **Vendored as:** `.claude/skills/frontend-design/`

### 3. redesign-existing-projects
- **Purpose:** Audit-first workflow for upgrading an existing UI without
  breaking functionality — scan, diagnose, detect generic/AI-pattern
  fingerprints, fix.
- **Source:** `https://github.com/Leonxlnx/taste-skill`, path
  `skills/redesign-skill/SKILL.md` (frontmatter name:
  `redesign-existing-projects`)
- **Commit:** `843c8dd4d18ccff0d5a9cd4b0b71d7dbf7278293` (2026-08-21)
- **License:** MIT (Leonxlnx, 2026) — `LICENSE` included.
- **Vendored as:** `.claude/skills/redesign-existing-projects/`
- **Note:** the task requested "Leonxlnx/taste-skill" generally; that repo
  is a 13-skill monorepo. The sub-skill that actually matches "redesign
  existing projects, audit before changing" is `redesign-skill`
  (`redesign-existing-projects`), not the flagship `taste-skill` — that one
  (`design-taste-frontend`) is for greenfield design direction and was not
  vendored, to avoid overlap with #2.

### 4. product-design-and-ux
- **Purpose:** Information architecture, task flows, state/recovery
  models, interface contracts, usability-study planning, engineering
  handoff — behavior/interaction, not visual styling.
- **Source:** `https://github.com/magnus919/agent-skills`, path
  `product-design-and-ux/SKILL.md`
- **Commit:** `94b7231147ab02c93de43d2e51d3a7a834899c6a` (2026-08-21)
- **License:** MIT (Magnus Hedemark, 2026) — `LICENSE.md` included.
- **Vendored as:** `.claude/skills/product-design-and-ux/`

### 5. senior-computer-vision
- **Purpose:** CV architecture — CNN/ViT, detection (YOLO/Faster R-CNN/
  DETR), segmentation (Mask R-CNN/SAM), ONNX/TensorRT deployment.
- **Source:** `https://github.com/alirezarezvani/claude-skills`, path
  `engineering-team/skills/senior-computer-vision/SKILL.md`
- **Commit:** `98180dafc4f0bc9d629bd479fc6107674cfb3cf8` (2026-08-21)
- **License:** MIT (Alireza Rezvani, 2025) — `LICENSE` included.
- **Vendored as:** `.claude/skills/senior-computer-vision/`
- **Note:** this skill does not use the term "oriented bounding boxes"
  specifically — OBB guidance for Merit's rotated tables is carried by the
  project's own `merit-plan-intelligence` skill instead.

### 6. programming-principles — stands in for "Clean Code"
- **Purpose:** Distilled principles from 14 classic engineering books
  (including *Clean Code*, *Refactoring*, *Working Effectively with Legacy
  Code*) applied to review, refactoring, and design decisions.
- **Source:** `https://github.com/magnus919/agent-skills`, path
  `programming-principles/SKILL.md`
- **Commit:** `94b7231147ab02c93de43d2e51d3a7a834899c6a` (2026-08-21)
- **License:** MIT — `LICENSE.md` included.
- **Vendored as:** `.claude/skills/programming-principles/`
- **Replacement note:** see "Requested sources that did not pan out" below
  — the task's preferred source (`AbsolutelySkilled/AbsolutelySkilled`)
  does not contain a clean-code skill.

### 7. software-architecture — stands in for "Clean Architecture"
- **Purpose:** System-level architecture decisions — boundaries, coupling,
  data ownership, distributed consistency, evolution/fitness functions.
  Explicitly routes implementation, persistence, and infra concerns to
  named specialist skills rather than owning them itself.
- **Source:** `https://github.com/magnus919/agent-skills`, path
  `software-architecture/SKILL.md`
- **Commit:** `94b7231147ab02c93de43d2e51d3a7a834899c6a` (2026-08-21)
- **License:** MIT — `LICENSE.md` included.
- **Vendored as:** `.claude/skills/software-architecture/`
- **Replacement note:** same as #6 — `AbsolutelySkilled/AbsolutelySkilled`
  has no clean-architecture skill. See below.

### 8. webapp-testing (official Anthropic) — Playwright browser QA
- **Purpose:** Native Python Playwright scripting for local web-app
  testing — dev-server lifecycle, reconnaissance-then-action pattern,
  screenshots, console logging, element discovery.
- **Source:** `https://github.com/anthropics/skills`, path
  `skills/webapp-testing/SKILL.md`
- **Commit:** `3b3fad96af16a10759d930941b4520ba0c40edae` (2026-08-21)
- **License:** Apache License 2.0 (`LICENSE.txt` inside the skill folder).
- **Vendored as:** `.claude/skills/webapp-testing/`
- **Why this over a community Playwright skill:** it's the official
  Anthropic implementation, it works purely via Bash + Python + Playwright
  (no MCP server dependency to verify), and this remote execution
  environment already ships a pre-installed Chromium that Playwright is
  pre-configured to find — it works here today without extra setup. See
  "MCP / visual QA tooling" below for what was deliberately *not* added.

### 9. web-performance
- **Purpose:** Rendering/DOM-cost performance patterns — profiling before
  optimizing, virtualization (large lists), memoization, lazy loading,
  Core Web Vitals monitoring.
- **Source:** `https://github.com/agents-inc/skills`, path
  `src/skills/web-performance-web-performance/SKILL.md`
- **Commit:** `81d43a51211aca12c85dcc16085fa99014ec548e` (2026-08-09)
- **License:** MIT (Vincent, 2025) — `LICENSE` included.
- **Vendored as:** `.claude/skills/web-performance/`
- **Adaptation note:** the skill's concrete tooling examples (React
  Compiler, `react-window`) assume a React app. MERIT is vanilla classic
  scripts (see `merit-desktop-architecture`) — apply the underlying
  principles (profile first, virtualize large lists/DOM trees, avoid
  unnecessary reflow, lazy-load heavy assets like the floor-plan image and
  PDF engine) rather than the React-specific library calls.

### 10. web-accessibility
- **Purpose:** WCAG 2.2 / ARIA 1.2-informed accessible interface design —
  semantics, keyboard/focus behavior, forms, motion, AT testing evidence.
- **Source:** `https://github.com/magnus919/agent-skills`, path
  `web-accessibility/SKILL.md`
- **Commit:** `94b7231147ab02c93de43d2e51d3a7a834899c6a` (2026-08-21)
- **License:** MIT — `LICENSE.md` included.
- **Vendored as:** `.claude/skills/web-accessibility/`

### 11. desktop-framework-electron
- **Purpose:** Electron main/renderer/preload architecture, mandatory
  `contextIsolation`, secure IPC, packaging.
- **Source:** `https://github.com/agents-inc/skills`, path
  `src/skills/desktop-framework-electron/SKILL.md`
- **Commit:** `81d43a51211aca12c85dcc16085fa99014ec548e` (2026-08-09)
- **License:** MIT — `LICENSE` included.
- **Vendored as:** `.claude/skills/desktop-framework-electron/`
- **Reminder:** installing this skill is not authorization to build
  Electron/EXE now — see the EXE gate in `CLAUDE.md` and
  `merit-desktop-architecture`.

### 12. sqlite-ops
- **Purpose:** SQLite query performance, concurrency/transactions (WAL,
  busy_timeout), schema design (STRICT tables, type affinity), backup/
  recovery, engine-agnostic across sqlite3/Python/Node/D1/Turso.
- **Source:** `https://github.com/0xDarkMatter/claude-mods`, path
  `skills/sqlite-ops/SKILL.md`
- **Commit:** `c3d826bca022068f943adcdf1a8f5c4bde6374bf` (2026-08-15)
- **License:** MIT (0xDarkMatter, 2025-2026) — `LICENSE` included.
- **Vendored as:** `.claude/skills/sqlite-ops/`
- **Note:** this is the optional database skill (task section 15) — one
  installed, not several overlapping SQL packs.

### 13-19. Ultralytics YOLO lifecycle (official) — 7 skills
- **Purpose:** the official Ultralytics Agent Skills covering the full
  YOLO lifecycle — model/task selection, dataset annotation/conversion,
  training, hyperparameter tuning, inference, and export/deployment.
  Directly relevant to Plan Intelligence: table/chair detection, OBB
  models, custom dataset design, and ONNX export are core future
  capabilities of this product.
- **Source:** `https://github.com/ultralytics/skills` (official
  Ultralytics org repo)
- **Paths vendored** (each `skills/<name>/SKILL.md` in the source repo):
  - `skills/yolo/SKILL.md` — entry-point/router skill; routes to the
    stage-specific skill below by task (model choice, data, train, tune,
    infer, export). **Read this one first** — it is the intended
    progressive-loading dispatcher, not a skill to load alongside all six
    others by default.
  - `skills/yolo-models/SKILL.md` — model family/size/task-variant
    selection (YOLO26/YOLO11/YOLOv8, YOLO-World, YOLOE, SAM/SAM2,
    RT-DETR; task variants including `-obb`).
  - `skills/yolo-datasets/SKILL.md` — dataset annotation, `data.yaml`,
    YOLO label formats, COCO/DOTA/mask conversion, dataset analysis.
  - `skills/yolo-training/SKILL.md` — `model.train()`/`yolo train`,
    hyperparameters, augmentation, multi-GPU, diagnosing OOM/NaN/low mAP.
  - `skills/yolo-tuning/SKILL.md` — hyperparameter search
    (`model.tune()`, Ray Tune), systematic model-improvement playbook.
  - `skills/yolo-inference/SKILL.md` — `model.predict()`/`track()`,
    Results API, persistent tracking, Solutions (counting/heatmaps).
  - `skills/yolo-export/SKILL.md` — ONNX/TensorRT/CoreML/OpenVINO/
    LiteRT/NCNN/NPU export, quantization, benchmarking, export-parity
    validation.
- **Commit:** `dcee0db39adf8bc8110329589f4cebb2ad8f0004` (2026-08-20)
- **License:** **GNU AGPL-3.0** (`LICENSE`, Ultralytics) — copied
  alongside each of the 7 vendored skill folders. This is a materially
  different license from every other vendored skill here (all MIT/Apache
  2.0) — **flagging explicitly**: AGPL-3.0 is a strong copyleft license.
  What's vendored here is Ultralytics' own reference documentation/skill
  guidance text, kept and attributed as-is for Claude's use while working
  in this repository — it is not code compiled or linked into the MERIT
  EVENT MAKER application. Before any actual `ultralytics` package code
  or model weights are vendored into or shipped with the product (as
  opposed to Claude reading this guidance during development), get a
  license review — AGPL's network-copyleft terms are a real
  consideration for a commercial product and are out of scope for this
  engineering-environment task to resolve.
- **Vendored as:** `.claude/skills/yolo/`, `.claude/skills/yolo-models/`,
  `.claude/skills/yolo-datasets/`, `.claude/skills/yolo-training/`,
  `.claude/skills/yolo-tuning/`, `.claude/skills/yolo-inference/`,
  `.claude/skills/yolo-export/`
- **Installed:** 2026-08-21
- **Scope note:** development/model-engineering knowledge only. Model
  training does not happen now (current stage is browser review); when it
  does, it happens in a controlled developer/build environment, never on
  the end user's machine — see `merit-desktop-architecture` and
  `CLAUDE.md`'s EXE gate. The end user is never asked to install Python.

### 20. senior-ml-engineer
- **Purpose:** production ML engineering / MLOps — model deployment
  workflow, feature stores, drift monitoring, model registry/promotion,
  automated retraining safeguards, A/B testing, cost optimization.
  Installed specifically to close the MLOps/production-lifecycle gap
  noted in the original pass (see "MLOps / active-learning skill" below)
  — this is a genuinely strong, dedicated fit where the previously
  considered `ml-engineering` (LLM-fine-tuning-flavored) skill was not.
- **Source:** `https://github.com/alirezarezvani/claude-skills`, path
  `engineering-team/skills/senior-ml-engineer/SKILL.md`
- **Commit:** `98180dafc4f0bc9d629bd479fc6107674cfb3cf8` (2026-08-21) — same
  clone already used for `senior-computer-vision` (#5).
- **License:** MIT (Alireza Rezvani, 2025) — `LICENSE` included.
- **Vendored as:** `.claude/skills/senior-ml-engineer/`
- **Installed:** 2026-08-21

## Requested sources that did not pan out

- **`AbsolutelySkilled/AbsolutelySkilled`** (requested as the preferred
  source for computer-vision, MLOps, clean-code, and clean-architecture
  skills): this repo is real (MIT, actively maintained) but it is
  "Absolute," an 11-skill SDLC workflow engine (`absolute-init`,
  `absolute-work`, `absolute-spec`, `absolute-simplify`, `absolute-debt`,
  etc.), **not** a skills registry. It contains none of the four requested
  skills. `senior-computer-vision` was sourced from `alirezarezvani/
  claude-skills` instead (#5 above); clean-code and clean-architecture were
  served by `magnus919/agent-skills` (#6, #7 above) rather than by
  installing several separate, thinly-maintained single-purpose repos
  (`hatlesswizard/clean-code-skills` — 4 stars, no LICENSE file;
  `nathankim0/clean-architecture-skills` — 2 commits) found during
  research. This keeps the stack curated and single-sourced where a
  well-maintained alternative already existed locally.

- **MLOps / active-learning skill — UPDATE (2026-08-21):** the first pass
  found no genuinely strong, actively maintained Claude Code skill
  matching the requested scope (dataset lifecycle, train/val/test
  discipline, model registry, champion/challenger, **active learning**
  for a CV pipeline). The closest candidate at the time,
  `magnus919/agent-skills` → `ml-engineering`, was scoped to LLM
  fine-tuning/serving (LoRA/QLoRA, vLLM, GGUF quantization) and not a
  good fit, so nothing was vendored for this gap in the first pass. A
  follow-up request specifically pointed at `alirezarezvani/claude-skills`
  → `senior-ml-engineer` (#20 above), which genuinely covers production
  MLOps — deployment workflow, drift monitoring, model registry/
  promotion, automated-retraining safeguards — and **has now been
  vendored** to close this gap. CV-pipeline-specific active-learning
  detail (verified examples, negative examples, group-aware splits,
  candidate/champion/challenger for a detection model specifically)
  still lives primarily in the project's own `merit-plan-intelligence`
  skill and the `active-learning-engineer` agent, with `senior-ml-
  engineer` now supplying the general production-MLOps discipline
  underneath it (registry, drift, promotion, rollback safeguards).
  Ultralytics' `yolo-training`/`yolo-tuning`/`yolo-datasets` (#13-19
  above) supply the YOLO-specific training/tuning/dataset mechanics that
  `active-learning-engineer` reaches for only when a task actually
  requires real model work.

- **Canvas/spatial editor skill** (Konva/Fabric/SVG, drag/resize/rotate/
  marquee): no maintained, genuine Claude Code skill was found. Several
  "canvas-design" skills that surfaced in search are about generating
  static PNG/PDF art, unrelated to interactive spatial editors. Per the
  task's explicit instruction ("if not, do not install a weak
  substitute — the custom floor-plan agent can own this domain"), nothing
  was vendored here; the `floor-plan-engineer` agent owns this domain
  directly, informed by `merit-product-contract` and
  `merit-ui-constitution`.

## MCP / visual QA tooling — what was deliberately not configured

No `.mcp.json` was added to this repository. Investigated and rejected:

- **Anthropic's official Playwright MCP plugin**
  (`anthropics/claude-plugins-official`, path `external_plugins/
  playwright/`) is a thin wrapper that runs `npx @playwright/mcp@latest`
  (Microsoft's `playwright-mcp`) — real and official, but it depends on an
  `npx` fetch of an external package at session start, which cannot be
  guaranteed to succeed identically across every Claude Code Web/remote
  session environment. Per the task's own instruction not to "pretend a
  tool is connected," this was not wired up speculatively.
- **Chrome DevTools MCP / Context7:** no clear, specific need for this
  project beyond what `webapp-testing` (vendored, #8 above) already
  covers; not added, per "do not add random MCP servers."

Instead, browser QA for this project runs through the vendored
`webapp-testing` skill: Bash + Python + Playwright, which works directly
against the Chromium already pre-installed in this remote execution
environment (see the environment notes in `CLAUDE.md` / the
`visual-qa-reviewer` agent) with no MCP server or extra setup required. If
a future session confirms reliable MCP support in its specific
environment, add `.mcp.json` then, scoped narrowly, and update this file.

## How to update this file

When vendoring a new external skill or updating an existing one: confirm
the source repo is real by reading its content directly (not just a search
snippet), record the exact path, commit hash, and license here, copy the
license file alongside the skill, and add an entry above following the
same format. Never remove or overwrite a license notice when updating a
vendored skill.
