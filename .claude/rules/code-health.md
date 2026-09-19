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
  not a smaller line count. The map exists:
  `benchmarks/APP-V8-OWNERSHIP-MAP.md` (26 areas, measured), with
  `benchmarks/CODE-INVENTORY.md` (dead code / duplication, nothing deleted)
  and `benchmarks/MODULARIZATION-ORDER.md` (the proposed order and why it is
  not screen-by-screen). Read all three before proposing an extraction.
- **Size does not predict difficulty.** The map measured it: the largest area
  (the detection pipeline, 34% of the file) is the easiest to move because it
  touches no shell global; the hardest are 74 and 171 lines. Do not pick an
  extraction by line count.
- **`guest.assignment` is written from 8 sites across 3 areas.** Consolidating
  that to one writer blocks the Guests, Seating and canvas extractions and is
  not itself an extraction. It comes before them.
- After every extraction, verify source order and that overridden functions
  still resolve to the `app-v8.js` versions — a silent revert to a pre-v8
  body does not look wrong in a diff.
- UI never owns business logic. Every domain fact keeps exactly ONE writer.
  Do not add shared mutable global state.
- Dependency direction is one-way (`Merit*` modules never read `state`,
  `ui`, `render()`, `touchEvent()`) and is now **enforced by a suite**:
  `tests/suites/dependency-direction.test.mjs`. It discovers the pure layer
  from source, so a new module is covered the day it is added, and it
  distinguishes **injection from coupling** — `venue-model.js` takes `state`
  as a parameter, which is the pure pattern, not a violation.
- Three structural suites guard the moves themselves; run them before and
  after every step: `dependency-direction` (the one-way rule),
  `boot-contract` (load order, plus the check that no overridden function
  silently resolves to its pre-v8 body **at runtime**),
  `offline-bundle-contract` (the build's markup slice and the bundle's
  script order).
- Dead code is deleted only with recorded proof of unreachability, and a
  shadowed function is not an unused one. Current count of removable
  functions: **zero** — see `benchmarks/CODE-INVENTORY.md`, including the
  measurement that first said fourteen and was wrong.
- **Do not measure reachability with grep, or with a scanner that cannot read
  nested template literals.** Nearly every call in this codebase's render
  functions sits inside a template inside a template; a scanner that loses
  those reports live functions as dead. Use `tests/lib/js-scan.mjs`.
- Refactor commits change no behaviour, and never share a commit with
  feature work.
- Both offline build scripts slice `index.html` by string index — this has
  already shipped a dead package once. Protect it with a test before
  changing it; never "improve" the slicing blindly.
- EXE/desktop packaging stays forbidden until the user types **"EXE YAP"**
  — see `.claude/rules/desktop.md`. Nothing in code-health work authorizes
  it.
