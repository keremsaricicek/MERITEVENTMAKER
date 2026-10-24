# MERIT ENTERTAINMENT — EVENT MAKER

Browser-only event-operations software (Events, Floor Plan, Guests, Seating,
Live, Reports, Plan Intelligence, Teach the Plan). No backend; state in
`localStorage`/IndexedDB. **This file is the short form. The full text of every
section below is `.claude/PROJECT-GUIDE.md` (same headings) — read the section
you are about to touch before changing its code.** Current work state:
`.claude/STATE.md`. Domain contract: `.claude/skills/merit-product-contract/`.

## Working economically (owner's request, 2026-10-24)
- Read only the files and sections a task needs; prefer Grep/offset reads over whole files.
- Subagents only when they earn it; give them a narrow brief; prefer a smaller model for search/QA.
- Keep replies to the owner short, simple, non-technical Turkish.
- Long jobs (training, benchmarks) run as resumable scripts; check them sparingly.
- Update `.claude/STATE.md` at each milestone so a new session starts from it, not from history.

## Stage and gates
- BROWSER REVIEW. No EXE/Electron/installer until the owner types **"EXE YAP"** (a one-click `.cmd` launcher for the portable local-VLM package was explicitly asked for, 2026-10-24; still no EXE/installer).
- The end user never installs Python/Node/pip/venv or runs a terminal step.

## Non-negotiable domain rules
- Guest = ONE record; "Name +3" is pax 4; companion seats export `GUEST OF [PRIMARY NAME]`.
- Planning status and arrival status are independent axes.
- No Show keeps the planned seat (`occupiedSeatIndexes`) and frees live capacity (`liveUsedIndexes`); never merge them.
- Physical chair ≠ logical seat ≠ capacity. `table.capacity` is logical; `table.chairs` only real drawn/detected/placed chairs; never synthesise chairs from a number. "Can seat" is `capacity > 0` (`MeritSeatModel`, `src/seat-model.js`).
- Historical events (Completed or past) are immutable in domain logic (`canMutate`).
- Reports (TABLE PLAN / GUEST LIST / UNASSIGNED, companion format) are regression-sensitive.
- Blank events are blank: no sample tables, guests or background.

## UI standard
- One light/warm palette app-wide (tokens in `src/styles.css`, `--pi-*`); warm-paper canvas; restrained VIP gold; 12–14px body; desktop-first 1920×1080 / 2560×1440 / ~1440.
- A UI change is done only when rendered and screenshotted at those viewports (`.claude/skills/merit-ui-constitution/`).

## Product layers (one line each; details in PROJECT-GUIDE.md)
- **Captured decisions:** every human decision stores a training example with provenance; capturing trains nothing.
- **Teach Area:** a scoped note (plan/layout/venue), retrieval not learning; one lesson changes one object.
- **Plan Doctor** (`src/plan-doctor.js`): the one "can this event proceed?" layer; derived, stores nothing; a reading is not a fact.
- **Layout changes:** `MeritVenueModel.compareToVersion`; identity by verified table number, then position, never visual similarity.
- **Guest finder** (`src/guest-search.js`): moves nobody; `matchRows` is the one matcher.
- **Smart Seating** (`src/seating-advisor.js`): cannot seat anybody; only Apply → `assignGuestToTable()`.
- **Freeze zones** (`src/seating-freeze.js`): a rule about a place; override is per operation, never stored.
- **Table availability** (`src/table-availability.js`): fact about the table; no override; moves nobody.
- **Risk Radar:** four states from the Plan Doctor only; no percentage; says what it cannot see.
- **Arrival wave** (`src/arrival-wave.js`): expected = stated only, null when none; nothing predicted; `setArrival()` is the one writer.
- **Service load** (`src/service-load.js`): bands per table, no routes, no distances, PLANNED vs LIVE.
- **Model reading** (`server/vlm-relay.mjs`): API key only in the relay's environment; a person starts every paid reading; findings are suggestions applied one at a time by Accept; scripted suites never count as model quality.
- **Local second look** (`/vlm-relay/ask`, `src/plan-local-check.js`): only manifest-measured questions; two looks; nothing applied; relay verifies the running llama-server (`--cache-ram 0`); answers cached per crop in memory.
- **Analysis speed / Stop:** a speed change leaves output identical (measured); Stop ends the engines' work.
- **Plan reading** (`src/plan-reading.js`): discovers no object; every sentence carries its evidence and how it is known.

## Plan Intelligence honesty
- Classical CV is "Assisted Detection", never "AI". The one trained detector (`src/plan-model.js`) loads only from pinned bytes; missing → "DOMAIN MODEL NOT INSTALLED".
- Never fabricate detections, confidences or metrics; thresholds never changed after a result is seen; a trained-on venue is never presented as unseen.
- VLM training/evaluation: pre-register bars before results; frozen tests; independent QA (`model-qa-specialist`); see `training/README.md` (V5/V6) and `tools/local-vlm/v5/README.md`.

## Code health
- `app-v8.js` size: re-measure with `wc -l src/app-v8.js` (6,874 on 2026-10-03). Ownership map, inventory and order: `benchmarks/APP-V8-OWNERSHIP-MAP.md`, `CODE-INVENTORY.md`, `MODULARIZATION-ORDER.md`.
- `guest.assignment` has ONE writer (`src/seat-assignment.js`); dependency direction is one-way; booting is not behaving.
- Rules: `.claude/rules/code-health.md`; procedure: `.claude/skills/merit-maintainability-hardening/`.

## Tests and gates
- `npm test` (fast, ~25 min under load), `npm run test:all`; detector: `npm run benchmark` vs `benchmarks/BASELINE.json`; OCR from `.vendor-cache` (`npm run vendor:test`).
- After `index.html`/`src` changes: `node scripts/build-offline.mjs`, `node scripts/build-offline-full.mjs`, `node benchmarks/offline/verify-offline-package.mjs` (run the artifacts).
- A behaviour change needs a test that fails first. Green CI = RELEASE GATE rows (`.claude/skills/merit-ci-quality-gates/`).

## Data integrity
- Schema bumps need real migrations (`migrateEvent`); historical immutability at the storage layer; save → reload round-trip for shape changes; the unload snapshot (`merit.unloadJournal.v1`) is used only while the store is unchanged.

## Delegation
- Route big work to `.claude/agents/` specialists; never two agents on one central UI file at once. Short durable rules: `.claude/rules/`.
