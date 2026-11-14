# Desktop install + automatic update — architecture plan (NOT authorization)

Status: **plan only.** The "EXE YAP" gate is CLOSED (`.claude/rules/desktop.md`). Nothing in this file
may be executed (no `package.json` Electron deps, no builder config, no main/preload files, no installer,
no release repo) until the owner types the exact phrase **EXE YAP**. Written 2026-11-13 by
`desktop-electron-engineer` from: `.claude/skills/merit-desktop-architecture/SKILL.md`,
`.claude/STATE.md` (owner answers 2026-11-01, "Before the Windows trial"),
`tools/local-vlm/windows/{MERIT-Baslat.cmd,PRE-TRIAL-CHECKLIST.md}`, `src/storage-provider.js`,
`src/schema-migrations.js`, `src/disk-backup.js`, `server/disk-backup.mjs`.

## 0. What the owner asked for (the acceptance test of this plan)

1. A real Windows install; any 64-bit Win10/11 PC, 8 GB RAM, **no admin rights**, Turkish/space paths.
2. Never uninstall/reinstall: a new published version downloads by itself; he clicks **"Güncelle"**.
3. Events, guests, backups, captured training examples survive every update (and every rollback).
4. Channel: a separate PUBLIC GitHub repo holding only release files — no source, no guest data.
5. End user never installs Python/Node, never opens a terminal (unchanged project rule).

## 1. Packaging choice

| Decision | Choice | Why |
|---|---|---|
| Shell | Electron (pinned major, upgraded deliberately) | Same Chromium the app is tested in; IndexedDB/canvas/workers behave as in review |
| Builder | **electron-builder**, target `nsis`, x64 only | `electron-updater` is built for its NSIS output (latest.yml, blockmap differential) |
| Install mode | `nsis.perMachine: false`, `oneClick: true` | Per-user → `%LOCALAPPDATA%\Programs\MERIT Event Maker\`; no UAC, no admin |
| Uninstall | `deleteAppDataOnUninstall: false` | Uninstall never deletes data (section 3) |
| Not chosen | Electron Forge + Squirrel.Windows | Squirrel installs per-user too, but its update UX/rollback is less controllable and electron-updater's GitHub flow is the one we want |
| Not chosen | MSI / portable EXE | MSI needs admin for most corporate cases; portable cannot self-update |

Process layout (security rules from `desktop-framework-electron`, non-negotiable):
- **main**: window, updater, component (model) manager, SQLite access, file dialogs. No UI logic.
- **preload**: `contextBridge.exposeInMainWorld("meritDesktop", {...})` — a small typed surface only:
  `storage.load/save`, `backup.list/save/read`, `update.status/check/install/setBusy`,
  `components.status/download`, `app.version`. Every handler is `ipcMain.handle` + input validation
  (type, length, allowed keys); no `sendSync`; no generic "read any file" channel.
- **renderer**: today's `index.html` + `src/*` unchanged, `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`, `webSecurity: true`; `setWindowOpenHandler` → deny; `will-navigate` → block
  anything not our origin; existing CSP kept.
- **Fixed origin**: serve the app from a privileged custom scheme (`app://merit/`, registered `standard`
  + `secure`) — never `file://`. Browser storage is per origin; a changing origin silently "loses" data
  (same lesson as PRE-TRIAL item 5).
- **Relay + model servers**: `server/vlm-relay.mjs` runs as an Electron `utilityProcess` (Electron's own
  Node — the user installs nothing); `llama-server.exe` / whisper spawned by main with the same flags as
  `MERIT-Baslat.cmd` (`--cache-ram 0`, `--host 127.0.0.1`), GPU check + CPU-variant selection as today.
  Watchdog restart moves from the `.cmd` loop into main.
- `StorageProvider` is already the persistence boundary: the desktop adds `SQLiteStorageProvider` that
  calls `meritDesktop.storage.*`; no Events/Guests/Seating/Live/Reports code changes
  (design with `data-architecture-engineer`; engine guidance `sqlite-ops`).

## 2. Update flow (electron-updater, GitHub Releases provider)

Config (to be written on gate day): `publish: { provider: "github", owner: "<owner>", repo:
"merit-eventmaker-surumler", releaseType: "release" }`. The repo is public, so the app carries **no token**.

| Step | Behaviour |
|---|---|
| Check | 30 s after start, then every **6 h** while running (`checkForUpdates`). Drafts/prereleases ignored |
| Pre-check | `autoDownload = false`. On `update-available`: fetch `release-manifest.json` + `.sig` from the same release, verify our ed25519 signature (section 5). Fail → ignore this release, log, say nothing alarming |
| Download | In background (`downloadUpdate`), differential via `.blockmap` (only changed blocks); progress in ⋯ menu only, no pop-ups |
| Ready | `update-downloaded` → small top-bar note **"Yeni sürüm hazır (1.3.0) — Güncelle"** |
| Install | Only when he clicks **"Güncelle"**: flush save → write a pre-update backup (section 6) → `quitAndInstall(isSilent=true, isForceRunAfter=true)` → app reopens on the same screen/event |
| Never forced | `autoInstallOnAppQuit = false`. No timer, no countdown, no "must update" |
| Live guard | Renderer reports busy via `update.setBusy(true)` while **Kapı** (live) is open, any event is `Live`, or an analysis/model run is in progress. Main **refuses** `install` while busy (checked in main, not just a hidden button) and the button reads **"Etkinlik bitince güncellenecek"**. Busy unknown (renderer crashed/not reported) = treated as busy |
| Skipped | If he never clicks, the update waits; a newer release replaces the pending one |

## 3. Data location (never in the install directory)

The install dir is replaced on every update — nothing user-owned may live there.
`app.setPath("userData", "%LOCALAPPDATA%\MERIT Event Maker")` before `ready` (LOCAL, not Roaming: corporate
roaming profiles must not sync GBs of models/crops):

```
%LOCALAPPDATA%\MERIT Event Maker\
  data\merit.sqlite (+ -wal)   events, guests, venues, audit, training examples (crops as BLOBs or files)
  yedekler\                    disk backups (server/disk-backup.mjs rules: newest 20 + 1/day for 30 days)
  yedekler\pre-update\         one snapshot per update, named <from>-to-<to>-<time>.json
  components\<name>\<version>\ model / runtime files (section 4)
  logs\                        rotated, never guest data (as diagnose-report.js)
  settings.json                theme, language, web-research switch, GPU choice (was data\gpu.json)
```

**Migration from the review build** (browser IndexedDB/localStorage at another origin cannot be read
by Electron — this is an explicit import, never a silent guess):
- First start with an empty database shows **"Önceki verilerinizi alın"** with two buttons:
  (a) choose a backup file (the existing export → `importBackupFile` validation), (b) choose the portable
  package folder → app lists its `yedekler\*.json` newest first. Import runs `MeritSchemaMigrations.migrate`,
  refuses `FUTURE`/`UNREADABLE`, shows counts (events/guests/examples) before **"Al"**, and is repeatable.
- To verify on gate day: whether the current backup format carries the IndexedDB `blobs` store
  (training crops). If not, add a crops export to the review build FIRST (behind the gate is only packaging).
- Owner said 2026-11-01 there is no old data to migrate; the step still ships (review-build data since).

## 4. Large local model files — separate, versioned, pinned assets

App updates must never re-download GBs. Model and runtime files are **components**, not part of the NSIS.

- Each component is its own release in the same public repo, tag `comp-<name>-<version>`, e.g.
  `comp-vlm-b6d`, `comp-chat-q08`, `comp-llama-<build>-cpu` / `-vulkan`, `comp-whisper-small-q5_1`.
  GitHub's per-asset limit is 2 GiB: every file must be under it (split a file only if ever needed).
- Each app release ships `components.json` (in the app bundle, so it is covered by the installer's sha512):
  for every required component → version, URL, **bytes + sha256** of every file — copied from the existing
  pinned manifests (`tools/local-vlm/manifests/*.json`, `tools/local-chat/manifests/*.json`); same rule as
  the product: a file that does not match its pin is not loaded ("DOMAIN MODEL NOT INSTALLED" style honesty).
- Component manager (main): compare installed vs required; download only what is missing/changed, with
  HTTP Range resume, into `components\<name>\<version>.partial\`; verify bytes+sha256; rename to final;
  only then switch. The previous version stays until the new one has started once successfully, then is
  deleted (keep one back for rollback).
- First install: installer ≈ app only (~150–250 MB); first start downloads components with a progress text
  ("Plan modeli indiriliyor… 640 MB / 1.1 GB"). The app is usable before models arrive (models say
  "not installed" until verified). Offline venues: an optional "tam paket" zip of `components\` that the
  app can import from USB with the same sha256 checks.

## 5. Integrity

| Layer | What guarantees it |
|---|---|
| Installer | `latest.yml` sha512 (electron-updater verifies the downloaded file before install) |
| Release authenticity | Unsigned builds: electron-updater has no publisher check. So each release also carries `release-manifest.json` (version, installer sha512, components.json sha256) + `release-manifest.json.sig` (**ed25519**). Public key compiled into the app; private key only in the private repo's Actions secret. A hijacked release repo cannot push an update without that key |
| Components | Our bytes+sha256 pins (section 4), checked before every activation, not only after download |
| At rest | On each start, re-hash only size+mtime-changed component files (cheap); mismatch → disable that component, say why |

## 6. Rollback and schema safety

- **Data first**: every "Güncelle" writes `yedekler\pre-update\…` (full root + training examples) before
  installing. A failed start after update offers **"Önceki sürüme dön"**.
- **Downgrade path**: NSIS keeps one version. "Önceki sürüme dön" downloads the previous release's installer
  (its tag is recorded before updating), verifies it (sha512 + ed25519) and installs with `allowDowngrade`
  for that one action only, then restores the matching pre-update backup if the schema moved.
- **Developer rollback** (preferred, always forward): publish the old code as a NEW higher version
  (1.3.1 = 1.2.0 code). Users just see a normal update.
- **Schema future-version safety** already exists: `MeritSchemaMigrations.migrate` returns `FUTURE` and hands
  the root back unchanged; the app must not load it and must not overwrite it. Desktop adds: SQLite stores
  `schemaVersion` in a meta table; an older app opening a newer DB opens read-only and shows
  "Bu veriler daha yeni bir sürümle kaydedildi — Güncelle veya yedekten dön". A schema bump ships only with a
  real `migrateEvent`/migration + save→reload round-trip test (`.claude/rules/data.md`).
- Components: previous version kept (section 4); a model change is a component version, revertible alone.

## 7. Privacy

- The update check is a plain GET of public files (releases feed, `latest.yml`, manifest). It sends **no**
  event, guest, machine or usage data; no custom headers, no IDs, no telemetry, no crash upload.
- Honest limit: GitHub sees the PC's IP address and a generic user-agent, as with any download.
- The release repo holds installers, blockmaps, manifests, signatures, component files — never source,
  never guest data, never captured examples. Release notes are written by hand in Turkish, no customer names.
- Diagnostic report stays local and guest-free (PRE-TRIAL item 11).

## 8. Offline behaviour

- No network → the app starts and works fully (it is offline-first today). Update check fails quietly;
  ⋯ menu shows **"Güncelleme denetlenemedi — internet yok"** with the last successful check time. Retry at
  the next 6-h tick or on **"Şimdi denetle"**. A half-finished download resumes later.
- Missing component + no network → that feature says "not installed"; everything else works.

## 9. Code signing (owner decides; nothing bought)

Today there is no certificate → first install shows SmartScreen "Windows bilgisayarınızı korudu" → "Ek bilgi →
Yine de çalıştır" (documented with a picture, as BENIOKU does today). Updates via electron-updater are
downloaded by the app (no Mark-of-the-Web), so normally no SmartScreen prompt on updates; Defender still scans.

| Option | Approx. cost | Effect | Notes |
|---|---|---|---|
| A. Unsigned (default) | 0 | SmartScreen warning on first install; ed25519 protects updates | Fine for one owner PC; awkward for staff PCs |
| B. Azure Trusted/Artifact Signing | ~US$10/month | Microsoft-issued cert, reputation builds | Check eligibility for a Turkish individual/company at decision time |
| C. OV code-signing cert | ~US$200–400/year + hardware token/HSM | Publisher name shown; reputation still builds slowly | Since 2023 keys must be on hardware; CI signing needs a cloud HSM |
| D. EV cert | ~US$300–600/year | Same as OV today (Microsoft removed EV's instant reputation in 2024) | Not worth the premium here |

Prices are indicative and must be re-checked; recommendation: start with A, revisit B if more PCs join.

## 10. Release procedure (developer, every version)

Built on GitHub Actions `windows-latest` in the PRIVATE repo (real Windows; no Wine), triggered by tag `v*`.
1. Version bump in ONE place (`package.json`); a test asserts `MERIT_APP_VERSION` (`src/diagnose-report.js`)
   equals it. Turkish release note line.
2. Gates on that commit: `npm run test:all`, `node scripts/build-offline.mjs`,
   `node scripts/build-offline-full.mjs`, `node benchmarks/offline/verify-offline-package.mjs`, release report
   RELEASE GATE rows green. Red = no release.
3. `electron-builder --win nsis --x64 --publish never` → `Setup-x.y.z.exe`, `.blockmap`, `latest.yml`.
4. Write `release-manifest.json`, sign with ed25519 (secret), attach `components.json`.
5. Create a **draft** release in the public repo with a fine-grained token scoped to that repo only
   (`gh release create vX.Y.Z --draft --repo <owner>/merit-eventmaker-surumler …`).
6. Smoke test on the runner (and a clean VM before the first publish): silent install of the PREVIOUS
   version, create sample data, update to the draft via a test feed, assert data identical, app starts,
   F8 + plan reading answer, uninstall leaves `%LOCALAPPDATA%\MERIT Event Maker` intact.
7. Publish the draft → users' apps see it within 6 h. Keep every old release (needed for downgrade).

## 11. "EXE YAP" day — exact order (nothing before the phrase)

1. Confirm the phrase was typed by the owner in the current conversation; record date in STATE.md.
2. On a free CPU: `npm run test:all`, `npm run build:offline`, `npm run build:offline-full`,
   `npm run verify:offline` on the current branch tip. Any red → fix first; do not package.
3. Owner decisions (one short Turkish question set): signing option (section 9), release repo name, ok to
   create it. Then he creates the public repo and one fine-grained token secret, guided step by step.
4. Generate the ed25519 key pair; private key → Actions secret only; public key → app constant.
5. Add Electron + electron-builder + electron-updater as devDependencies (pinned), `desktop/main.js`,
   `desktop/preload.js`, builder config — app source under `src/` untouched except the storage provider.
6. Security suite first (fails before code): contextIsolation/sandbox on, nodeIntegration off, IPC rejects
   bad input, navigation blocked, origin fixed, no remote URL loaded.
7. `SQLiteStorageProvider` + import step (section 3) with save→reload round-trip and FUTURE-refusal tests;
   reports `.xlsx` before/after diff identical (`.claude/rules/reports.md`).
8. Component manager + `components.json` from the pinned manifests; sha256 mismatch test.
9. Updater: busy guard test (install refused while Kapı open), offline test, signature-refusal test.
10. Re-run the four gates + the new desktop suites; build NSIS on the Windows runner.
11. Release v1.0.0 as draft → smoke (section 10.6) → publish v1.0.0, then publish v1.0.1 with a trivial change
    and prove the real update path on a clean Windows VM (download, "Güncelle", data intact, rollback).
12. PRE-TRIAL-CHECKLIST rows re-checked on the installed app (paths, no admin, RAM, first start, licences
    in `LICENCES/`); the 8-hour memory soak (moved to the EXE stage) runs here.
13. Only then the owner installs. Then (later) LAN sharing, separately gated by its own plan.
