# Code health / refactor rules

- **Read `.claude/skills/merit-maintainability-hardening/SKILL.md` before
  any refactor, extraction, decomposition, dead-code or modularization
  work.** It is the operating procedure; this file is only the summary.
- Forbidden without explicit written approval: large-scale rewrite,
  framework migration, TypeScript conversion, introducing a bundler/build
  step, converting `src/*.js` to ES modules, and silently changing the
  classic-script load order in `index.html` (33 scripts, fixed order,
  `app-v8.js` LAST).
- **Four gates after EVERY structural step**, not at the end:
  `npm run test:all` · `npm run build:offline` ·
  `npm run build:offline-full` · `npm run verify:offline`.
  "The build succeeded" is not evidence; `verify:offline` is, because it
  runs the built artifact.
- **Characterization before restructuring.** If no suite would fail when
  the behaviour you are moving breaks, write one first and prove it bites
  with a deliberate mutation.
- **`app-v8.js` is not broken up in one pass.** Ownership map first, then
  ONE screen or ONE business capability per commit. The target is cohesion,
  not a smaller line count.
- After every extraction, verify source order and that overridden functions
  still resolve to the `app-v8.js` versions — a silent revert to a pre-v8
  body does not look wrong in a diff.
- UI never owns business logic. Every domain fact keeps exactly ONE writer.
  Do not add shared mutable global state.
- Dependency direction is one-way (`Merit*` modules never read `state`,
  `ui`, `render()`, `touchEvent()`) and currently holds with zero
  exceptions — but is enforced by grep, **not yet by a suite**. That suite
  is required before the first screen extraction.
- Dead code is deleted only with recorded proof of unreachability, and a
  shadowed function is not an unused one.
- Refactor commits change no behaviour, and never share a commit with
  feature work.
- Both offline build scripts slice `index.html` by string index — this has
  already shipped a dead package once. Protect it with a test before
  changing it; never "improve" the slicing blindly.
- EXE/desktop packaging stays forbidden until the user types **"EXE YAP"**
  — see `.claude/rules/desktop.md`. Nothing in code-health work authorizes
  it.
