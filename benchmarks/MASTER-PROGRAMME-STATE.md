# FINAL MASTER QUALITY & COMPLETION PROGRAMME — state

**This file is the programme's memory.** It survives session boundaries.
A session resuming this work reads this file and the repository — never its
own recollection.

- **Programme start SHA** `02edac7`
- **Branch** `claude/merit-concept3-plan-intelligence-rebirth`
- **PR** #5 — OPEN, must not be merged
- **Current SHA** `02edac7`
- **Status** IN PROGRESS

## How to resume

1. `git rev-parse --short HEAD` and compare with "Current SHA" above.
2. Read this file's **Next step**.
3. Re-measure before trusting any number here — every figure is a dated
   snapshot, not a fact.
4. Continue. Never redo a completed step from memory.

## Gates after every production step

```
npm run test:all · npm run build:offline · npm run build:offline-full · npm run verify:offline
```
plus the benchmarks relevant to what changed. A step that cannot pass all
four is reverted, not patched forward.

---

## Measured starting state (`02edac7`)

| Fact | Value | Command |
|---|---|---|
| `src/*.js` | 34 files, 18,783 lines | `wc -l src/*.js` |
| `app-v8.js` | 5,740 lines, longest line 3,369, 41 lines >500 | `wc -l src/app-v8.js` |
| `plan-detection-classical.js` | 2,857 lines, longest line 331 | `wc -l` |
| `plan-intelligence.js` | 1,903 lines | |
| Suites / checks | 65 / 2,080 | `npm run test:all` |
| Offline | 27 / 27 | `npm run verify:offline` |
| `confirm()` / `prompt()` | 9 / 2 | `grep -o '\bconfirm(' src/*.js` |
| `innerHTML=` / `insertAdjacentHTML` | 13 / 1 | |
| `aria-*` / `role=` | 23 / 8 | |
| Security / a11y / resilience suites | **0 / 0 / 0** | `ls tests/suites` |
| `MAX_TABLES` | **240**, `plan-detection-classical.js:1917` — silent truncation | |
| Audit eviction | `slice(0,1000)` at `app-v8.js:87` and `:5529` — silent | |
| Adversarial | re-measuring at HEAD (see below) | `npm run benchmark:adversarial` |

---

## Work log

Each entry: what changed, its commit, and the evidence. Append only.

### A. Quality-doc corrections — IN PROGRESS
- [ ] QUALITY-TEAM.md: UI/UX single owner (`premium-ui-director`),
      `visual-qa-reviewer` as measurement owner
- [ ] READINESS: adversarial count re-measured at HEAD

---

## Next step

Finish §1 (quality-doc corrections), commit, then begin §3A — detector
Split A extraction using `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`.

## Permanent constraints (do not re-derive)

- No EXE, no Electron/Tauri/MSIX, no packaging-technology choice.
- No SQLite runtime. Storage boundary and migration design only.
- Do not merge PR #5. Do not touch other branches.
- No framework migration, no TypeScript, no bundler.
- Never lower a threshold, delete a fixture, or skip a test to get green.
- Never fabricate a human operator session or a third real plan.
- Synthetic fixtures are encouraged, and are labelled SYNTHETIC.
