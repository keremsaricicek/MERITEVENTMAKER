# Testing / QA rules

- The regression suite lives in `tests/` and is the first thing to run and
  the first thing to extend:

  ```
  npm test              # every fast suite (~2 min); exit code is the verdict
  npm run test:all      # plus the slow ones (real detection on the real plan)
  npm run test:list     # what exists
  ```

  It serves the app itself and isolates storage per suite, so nothing
  depends on a server someone started by hand. `tests/README.md` says what
  each suite guards and how to add one. A behaviour change that no suite
  would have caught needs a suite, not a manual check.
- `npm run serve` runs the app on :8000 for manual/QA use — no build step
  for the normal (non-offline) build.
- For any UI change: render and screenshot at 1920×1080, 2560×1440, and
  ~1440px via the `visual-qa-reviewer` agent (Bash + the vendored
  `webapp-testing` skill: Python Playwright, works with this environment's
  pre-installed Chromium). Check the browser console for errors on every
  pass.
- Detector changes are measured, never asserted from memory:

  ```
  npm run benchmark            # object-level, per plan, against annotations
  npm run benchmark:baseline   # compare to the committed benchmarks/BASELINE.json
  ```

  The baseline compares every guarded field separately per plan, because a
  trade (chair recall up, table F1 down) is invisible in a single score and
  is a revert, not a win. Re-record it only as a deliberate, explained
  decision.
- After any change to `index.html` or `src/*.js`/`src/styles.css`
  structure, rebuild BOTH offline artifacts and then **run the built
  artifacts**:

  ```
  node scripts/build-offline.mjs        # dist/index-offline.html (single file)
  node scripts/build-offline-full.mjs   # dist/merit-offline/ (folder, with OCR)
  node benchmarks/offline/verify-offline-package.mjs
  ```

  "The build succeeded" is not evidence and must never be reported as
  such. Both scripts slice `index.html`'s body markup by string index, and
  `build-offline-full.mjs` cut at the first HTML comment — so adding a
  comment above the dialogs silently dropped `#guestDialog`, which made
  `app-guests.js` throw, which killed every source file after it in the
  single concatenated `<script>`. The build reported success and shipped a
  package that booted to a dead shell with no OCR at all. The verifier
  serves the real artifact, aborts every non-same-origin request, and
  drives real OCR; it is the check that would have caught it.
- Performance-sensitive changes (canvas interaction, large guest lists,
  XLSX import/export, floor-plan image handling) go through
  `performance-qa-engineer` with a before/after measurement, not just a
  "should be faster" claim.
- No project-scoped MCP browser tooling is configured — see
  `.claude/SOURCES.md` for why, and use the `webapp-testing` skill instead.
