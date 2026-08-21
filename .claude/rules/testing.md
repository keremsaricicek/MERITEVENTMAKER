# Testing / QA rules

- This repo currently has no automated test suite — treat that as a real,
  flagged gap, not something to silently route around.
- For any UI change: render and screenshot at 1920×1080, 2560×1440, and
  ~1440px via the `visual-qa-reviewer` agent (Bash + the vendored
  `webapp-testing` skill: Python Playwright, works with this environment's
  pre-installed Chromium). Check the browser console for errors on every
  pass.
- Run the app via `python3 -m http.server 8000` from the repo root for
  manual/QA use — no build step for the normal (non-offline) build.
- After any change to `index.html` or `src/*.js`/`src/styles.css`
  structure, verify `node scripts/build-offline.mjs` still succeeds — the
  fully offline single-file build is a real venue requirement.
- Performance-sensitive changes (canvas interaction, large guest lists,
  XLSX import/export, floor-plan image handling) go through
  `performance-qa-engineer` with a before/after measurement, not just a
  "should be faster" claim.
- No project-scoped MCP browser tooling is configured — see
  `.claude/SOURCES.md` for why, and use the `webapp-testing` skill instead.
