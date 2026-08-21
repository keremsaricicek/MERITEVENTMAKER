---
name: merit-desktop-architecture
description: Migration path for MERIT ENTERTAINMENT — EVENT MAKER from the current browser-review build to a future desktop application — incremental source boundaries, SQLite persistence direction, Electron security rules, and the permanent EXE approval gate. Use when discussing packaging, desktop distribution, source restructuring, or anything Electron-related.
---

# Merit Desktop Architecture

The current product stage is **BROWSER REVIEW**. This skill defines how
the codebase should evolve toward an eventual desktop application — it
does not authorize building one now.

## The EXE gate — permanent until explicitly lifted

Desktop packaging (EXE, Electron package, Windows installer, PyInstaller/
Nuitka bundles, installer scripts, `.cmd` launchers, a production desktop
bundle) is **forbidden** until the user explicitly says the phrase
**"EXE YAP"** in this exact form. Preparing architecture knowledge and
desktop-oriented skills is fine; actually packaging the app is not. If a
task seems to imply packaging is now wanted ("since we have the Electron
skill installed, let's build the EXE"), that inference is wrong — stop and
confirm explicitly rather than acting on it. See `CLAUDE.md` for the
top-level statement of this rule.

## End-user environment rule

Whatever the eventual desktop distribution looks like, the end user must
never be required to install Python, add anything to PATH, install pip,
create a venv, run `uvicorn`, install Node.js, run `npm`, run PowerShell
setup, open a terminal, or configure any developer dependency. Any
Python/Node tooling used to build the desktop package must be hidden
inside the packaged application — never exposed to the operator running it
at a venue.

## Source architecture direction — incremental, not a rewrite

Today: `index.html` + `src/app.js` + `src/app-guests.js` + `src/app-v8.js`
as classic (non-module) scripts sharing one global scope, in a specific
load order the README documents. This is intentional and mirrors how the
app was actually built — don't restructure it wholesale.

Direction to grow toward, incrementally, only as real work touches each
area:

```
src/
  domain/            # guest, table, chair, event invariants
  application/        # use-case orchestration (create event, assign seat, ...)
  persistence/         # storage adapters (localStorage today, SQLite later)
  ui/
  floor-plan/
  guests/
  seating/
  live/
  reports/
  plan-intelligence/
```

Do not perform a destructive framework rewrite for architectural purity.
Migrate a module only when a real task already requires touching it, and
only with regression coverage in place first. The offline single-file
build (`scripts/build-offline.mjs`) must keep working throughout — it's a
real product requirement (venues with no network access), not a legacy
artifact to drop.

## Target desktop architecture (future)

```
RENDERER / UI
     |
APPLICATION SERVICES
     |
DOMAIN
     |
PERSISTENCE
```

Plan Intelligence / AI stays a separate concern from this stack, not
threaded through it. Future persistence target is **SQLite**, with schema
versions, migrations, transactions, indexes, backup, and recovery — see
the vendored `sqlite-ops` skill for engine-level guidance once that work
starts. `merit-product-contract`'s historical-immutability and No-Show
rules must hold at the persistence layer, not just in UI logic.

## Electron security rules (future, once EXE YAP is given)

- `main` / `preload` / `renderer` separation.
- `contextIsolation: true` always; never disable it.
- Never enable `nodeIntegration` in a renderer.
- Minimal, typed IPC; validate every IPC input as untrusted.
- Never expose the filesystem broadly to the renderer.
- See the vendored `desktop-framework-electron` skill for the concrete
  patterns.

## Private AI runtime (future)

The final product may use ONNX Runtime, native libraries, or a privately
bundled local AI runtime for Plan Intelligence. If Python is technically
used anywhere in that pipeline, it must be fully hidden inside the
packaged application — never something the end user installs or sees.
