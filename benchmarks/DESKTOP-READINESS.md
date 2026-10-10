# Desktop readiness

Section 32. What is ready for a desktop build, what is not, and what must not
be decided yet.

## The gate is shut

Desktop packaging — EXE, Electron package, Windows installer, PyInstaller or
Nuitka bundle, installer script, `.cmd` launcher, production desktop bundle —
is **forbidden until the user types the exact phrase "EXE YAP"**. They have
not. `.claude/rules/desktop.md` and `CLAUDE.md` both state it, and the
architecture skill states it again with the specific warning that applies here:

> Installing or reading a desktop/Electron skill is not authorization to build
> one — treat any inference like that as wrong and confirm explicitly instead.

This document is the same kind of thing: reading it is not authorization
either. It exists so that when the gate opens, the work starts from an
inventory rather than from a guess — and so that the honest answer to "how far
away is the desktop build?" is written down instead of estimated on the spot.

---

## What is genuinely ready

These are not aspirations; each is shipping and covered by a suite today.

**The storage boundary.** Every read and write goes through `StorageProvider`
(`src/storage-provider.js`), with two implementations selected at boot. A
desktop persistence layer is a third implementation, not a refactor. Writes are
already serialised so last-call-wins is structural (Section 13), and large
binaries (training-data image crops) already live in a separate blob store
addressed by id rather than inside the state record.

**Offline operation, verified by running the artifact.** Two build scripts
produce `dist/index-offline.html` (single file) and `dist/merit-offline/`
(folder, with local OCR).
`benchmarks/offline/verify-offline-package.mjs` serves the real built package,
**aborts every non-same-origin request**, and drives real OCR — 27/27. A
desktop app is an offline app by definition, and the product already is one;
this is the single largest thing usually left until packaging time, and it is
done.

**No network dependency in the product itself.** The offline verifier proves
zero off-origin requests. `tests/suites/operator-session.test.mjs` goes further
for the recording layer and asserts that `fetch`, `XMLHttpRequest`,
`sendBeacon`, `WebSocket` and `EventSource` are *absent from the source*, not
merely unused.

**Interchange formats, versioned and guarded.** `merit-event-maker-backup`
(whole install) and `merit-event-maker-event-package` (one event) both carry a
`format` discriminator and `formatVersion: 1`, both validate rather than trust
on import, and the package format already renumbers ids on import so two
installs cannot collide. A desktop build reads and writes these. See
`SQLITE-MIGRATION-DESIGN.md` §1 — there is no third format to invent.

**A migration path that runs on every load.** `migrateEvent()` is additive and
idempotent and is proven end-to-end against a genuinely old fixture by
`tests/suites/schema-migration.test.mjs`.

**A regression suite that would survive the move.** 55 suites, 1799 checks,
real Chromium, its own server, storage isolated per suite. Almost all of it is
about domain behaviour, not about being in a browser tab, so it remains the
correctness proof for a desktop renderer rather than needing to be rewritten
for one.

**Recovery from a corrupted store.** `tests/suites/offline-recovery.test.mjs`
corrupts both the primary record *and* the automatic snapshot slot and asserts
the app still boots clean rather than to a dead shell.

## What is not ready, and is not supposed to be

**No packaging technology has been chosen, deliberately.** Electron, Tauri and
everything else are unchosen. Choosing one is itself behind the gate — the rule
names "packaging-technology choice" explicitly, because a choice made in a
design document is a choice made.

**No SQLite.** `.claude/rules/data.md` forbids introducing it speculatively
during browser review. The design exists (`SQLITE-MIGRATION-DESIGN.md`), the
engine does not, and nothing measured so far says the current one is a
constraint — the 4,000-seat fixture is a 1.20 MB payload that reloads in
~780 ms.

**No main/preload/renderer split, no IPC surface.** Nothing to secure yet
because nothing exists. When it does, the rules are already fixed:
`contextIsolation: true` always, never `nodeIntegration` in a renderer, minimal
typed IPC over `contextBridge`, every IPC input validated as untrusted, and
never a broad filesystem handed to the renderer.

**No updater, no code signing, no installer.** All downstream of the packaging
choice.

**No private AI runtime.** Assisted Detection is classical computer vision
today and is labelled as such. If a desktop build ever bundles ONNX Runtime or
a local model, `DOMAIN MODEL NOT INSTALLED` stops being the honest string and
`trainedModel` stops being `false` — and neither may change before the other.

## The one requirement that constrains the packaging choice

From `.claude/rules/desktop.md` and the architecture skill:

> The end user must never install Python, Node.js, pip, or a venv, add anything
> to PATH, or run a terminal/setup step.

The operator at a venue double-clicks one thing. Any Python or Node tooling
used to *build* the package is a developer-time concern and must be invisible
in the shipped artifact. This is a filter on the packaging choice, not a
preference: an approach that requires the operator to install a runtime is
disqualified regardless of its other merits.

## Honest gaps that a desktop build would inherit

Not packaging problems — product ones, carried forward, and listed here so the
desktop conversation does not start by assuming a clean bill of health:

| gap | status | where |
|---|---|---|
| Real operator usability | **NOT VERIFIED** — no person has used it | `operator/README.md`, `operator/REAL-OPERATOR-TEST-KIT.md` |
| Cross-venue generalization | **MEASURED TWICE**, not verified | `heldout/README.md` |
| A third real plan | **NOT AVAILABLE** | `heldout/THIRD-PLAN-PROCEDURE.md` |
| ORNEK rendering-variant robustness | no suite, unlike Golden's | `robustness/` |
| 21 unreachable functions in the override capture | evidenced, deliberately not deleted | `tests/suites/override-boundary.test.mjs` |

A desktop build makes none of these better and makes the first one worse: it is
harder to watch somebody use software you have shipped as an installer than one
you can put in front of them in a browser. **The operator session is best run
before packaging, not after.**

## What "ready" would actually mean

When the gate opens, this is the checklist — not a plan, an inventory of what
would have to become true:

1. A packaging technology chosen, with the end-user-installs-nothing rule as
   the first filter.
2. The security rules above implemented and tested, not merely intended.
3. A persistence decision: keep the current engine, or take
   `SQLITE-MIGRATION-DESIGN.md` §5 step 1 — the adapter behind the existing
   interface, proven by the *existing* suites passing unchanged.
4. The existing regression suite running against the packaged renderer, not
   only against the served app.
5. The offline verifier pointed at the packaged artifact, since "we built it"
   has never been accepted as evidence in this project and must not start being
   accepted at the packaging step, which is where it is most tempting.
6. A real operator session completed first, per §above.

Until then the honest status is the one at the top of this file: **the product
is a browser-review build with a desktop-shaped storage boundary and a verified
offline artifact, and no desktop application exists or is being built.**
