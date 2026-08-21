# Desktop / EXE rules

- Desktop packaging (EXE, Electron package, Windows installer, PyInstaller/
  Nuitka bundle, installer scripts, `.cmd` launchers, production desktop
  bundle) is forbidden until the user types the exact phrase **"EXE YAP"**
  in the current conversation.
- Installing or reading a desktop/Electron skill is not authorization to
  build one — treat any inference like that as wrong and confirm
  explicitly instead.
- The end user must never install Python, Node.js, pip, or a venv, add
  anything to PATH, or run a terminal/setup step — hide any such tooling
  inside the eventual packaged app.
- When the gate is open: `contextIsolation: true` always, never
  `nodeIntegration` in a renderer, minimal typed IPC via `contextBridge`,
  validate all IPC input as untrusted. See `.claude/skills/
  desktop-framework-electron/SKILL.md`.
- Until the gate opens, `desktop-electron-engineer` produces architecture
  notes only — it does not have `Edit`/`Bash` tool access, by design.
