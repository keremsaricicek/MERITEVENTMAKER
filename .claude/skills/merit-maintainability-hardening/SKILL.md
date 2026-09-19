---
name: merit-maintainability-hardening
description: The operating procedure for MERIT EVENT MAKER's long-term code health — incremental refactor, safe extraction from app-v8.js, dependency-direction enforcement, single-writer domain facts, dead-code removal, and the mandatory gates every structural step must pass. Use for ANY code-health, refactor, extraction, decomposition, dead-code, duplication or modularization task, and always before touching the classic-script load order or either offline build.
---

# Merit Maintainability Hardening

This skill exists because MERIT EVENT MAKER is a **working, shipping product
with an unusually strong test suite and an unusually large core file**. Both
halves of that sentence set the rules: the suite makes restructuring safe,
and the core file makes it necessary — but neither makes it urgent.

The product's own standard applies to refactoring exactly as it applies to
features: **"it ran" is not evidence.** A refactor that passes because
nothing checked the behaviour it moved has proved nothing.

---

## 0. The prohibitions — no exceptions without explicit written approval

| Forbidden | Why |
|---|---|
| Large-scale rewrite | A working product with 2,011 passing checks is not a candidate for a clean slate |
| Framework migration | React / Vue / Svelte / any framework |
| TypeScript conversion | Needs its own approved decision, not a side effect of a cleanup |
| Vite / bundler / build-step introduction | The app deliberately has **no build step**; the offline builds are concatenators, not bundlers |
| Silently changing classic-script load order | `index.html` loads 33 scripts in a fixed order ending with `app-v8.js`; the order is structural |
| Converting `src/*.js` to ES modules | Same reason — they share one global scope by design |
| Behaviour change inside a refactor commit | A refactor commit's diff must be provably behaviour-neutral |
| **Building an EXE / desktop package** | Forbidden until the user types exactly **"EXE YAP"**. Nothing in this skill authorizes it |

If a task seems to require one of these, **stop and ask**. Do not infer
approval from the existence of a skill, a tool, or a convenient opportunity.

---

## 1. Measure first — never work from remembered numbers

Every number below drifts. Re-measure at the start of every session:

```bash
ls src/*.js | wc -l                                   # file count
wc -l src/*.js | sort -rn | head -5                   # where the mass is
awk '{print length}' src/app-v8.js | sort -rn | head -3   # worst lines
grep -c 'src="src/' index.html                        # script count + order
npm run test:list                                     # what already guards what
```

Snapshot at the time of writing (verify, do not trust):

- 33 `src/*.js`, **18,729 lines**
- `app-v8.js`: **8,543 lines (46% of all source)**, 274 functions, longest
  line **3,369 characters**, 41 lines over 500
- 28 of 33 files export `globalThis.Merit*`
- 61 suites / **2,011 checks**; 5 parallel CI jobs; offline verification 27

---

## 2. The four mandatory gates — after EVERY step, not at the end

```bash
npm run test:all          # 61 suites, 2,011 checks — slow suites included
npm run build:offline     # single-file artifact
npm run build:offline-full # folder artifact, with local OCR
npm run verify:offline    # 27 checks — RUNS the artifact, aborts off-origin, drives real OCR
```

All four. Every step. `npm test` alone is not enough (it skips the 6 slow
suites). **A green build is not a gate — `verify:offline` is**, because it
serves the real artifact rather than trusting that it was produced.

If a step cannot pass all four, the step is wrong. Revert it; do not
"fix forward" into a second uncommitted change.

---

## 3. Characterization before restructuring

**Rule: if no suite would fail when the behaviour you are about to move
breaks, you may not move it yet.**

Procedure, in order:

1. Find the suite that owns the behaviour (`npm run test:list`, then read it).
2. If none exists, **write one first** — against current behaviour, however
   ugly that behaviour is. A characterization test records what the code
   *does*, not what it should do.
3. **Prove the test bites**: apply a deliberate mutation to the code it
   covers, watch it fail with the right message, revert, watch it pass.
   An unmutated test is an assumption.
4. Only then restructure.

This is the repo's established practice, not a new invention: every fix in
the pre-desktop programme was mutation-proven individually.

---

## 4. Do NOT break up `app-v8.js` in one pass

The target is **cohesion, not smallness**. A 4,000-line file with one clear
job beats eight 500-line files that all reach into each other.

Required order:

### Step A — map before moving

Produce a written ownership map before any extraction: for each candidate
region of `app-v8.js`, record what it owns, which globals it reads, which
globals it writes, who calls it, and which suite covers it. Extraction
without this map is guesswork.

### Step B — one screen or one business capability at a time

Not "the render layer". Not "all the helpers". **One** — e.g. Reports, or
Guests, or the arrival axis — then all four gates, then commit, then stop
and re-evaluate.

### Step C — verify the load-order contract after every extraction

`app-v8.js` overrides functions declared in `app.js` / `app-guests.js` by
**bare reassignment**, and it must stay last. After every extraction,
confirm:

- source order in `index.html` is still correct and `app-v8.js` is last;
- every previously-overridden function still resolves to the v8 version at
  runtime, not the original;
- `tests/suites/override-boundary.test.mjs` still passes — it parses the
  `const original = {...}` capture and checks each name in both directions.

A function that silently reverts to its pre-v8 body is the single most
dangerous failure mode of this work, and it will not look wrong in a diff.

---

## 5. Structural rules for the code itself

- **UI must not own business logic.** A render function may read domain
  facts and call domain commands; it may not *be* the rule.
- **Single writer for every domain fact.** `guest.arrivalStatus` has exactly
  one writer (`setArrival()`); `table.availability` has one
  (`setTableAvailability()`); freezes have one create and one lift. Any new
  domain fact must name its single writer, and extraction must not create a
  second one.
- **Reduce shared mutable global state.** Do not add to `state`/`ui` as a
  convenience. Moving code out of `app-v8.js` must not turn a local into a
  new global.
- **Dependency direction is one-way and must stay so.** The 28 `Merit*`
  modules never read `state`, `ui`, `render()` or `touchEvent()`;
  `app-v8.js` reads them. This currently holds with **zero exceptions** —
  but it is enforced only by manual grep, **not by a test**. See §8.
- **Collapse duplicated logic to one source** — but only when the
  duplicates are genuinely the same rule, not two rules that happen to look
  alike today. (`occupiedSeatIndexes` vs `liveUsedIndexes` look similar and
  must NEVER be merged — planned seating vs live capacity are different
  concepts. Check `merit-product-contract` before merging anything.)
- **Split long functions at stable responsibility boundaries**, not at
  convenient line counts.
- **No wrapper functions created only to reduce line count.** An indirection
  that adds a name but no meaning makes the code worse while making the
  metric better.
- **One term per concept** across public and domain names. Renaming is
  design work; do it deliberately and everywhere at once.
- **A new file owns exactly one responsibility.** If you cannot name that
  responsibility in one sentence without "and", the split is wrong.

### Comments

Comments are for **WHY / invariant / warning / non-obvious contract** only.
Delete comments that narrate what the code plainly does. This codebase's
existing comments are unusually good — they explain reasoning, refusals and
past failures. Preserve that character; do not strip a comment that records
*why* something is the way it is just because it is long.

---

## 6. Dead code

Delete only after **proving** unreachability:

1. Grep for the name across `src/`, `tests/`, `index.html`, `scripts/`,
   `benchmarks/` — every occurrence besides the declaration itself.
2. Consider the override layer: a function can look unused because it is
   *shadowed*, which is not the same as unused.
3. Record the evidence in the commit message.

**Known, evidenced, deliberately NOT deleted:** 21 of the ~32 names captured
in `app-v8.js`'s `const original = {...}` are unreachable under the current
boot sequence. This is tracked by `override-boundary.test.mjs` on purpose.
Do not delete them opportunistically — they need boot-sequence test coverage
first, and that is their own task.

---

## 7. The offline build is fragile — protect it before touching it

**Both** `scripts/build-offline.mjs` and `scripts/build-offline-full.mjs`
extract the body markup by string index:

```js
const bodyStart = shell.indexOf("<body>");
const bodyEnd   = shell.indexOf("<script");
const bodyMarkup = shell.slice(bodyStart, bodyEnd);
```

This has already shipped a broken package once: a comment added above the
dialogs moved the cut point, `#guestDialog` disappeared, `app-guests.js`
threw, and **every source file after it in the concatenated script died** —
while the build printed success.

Therefore:

- Any change to `index.html` structure runs all four gates, no exceptions.
- **Do not "improve" the slicing blindly.** If it is to be made robust,
  first add a test that pins the current extraction result, prove it bites,
  and only then change the mechanism.
- Adding a `<script>` tag, moving one, or inserting markup near `<body>` or
  the first `<script>` all count as touching this.

---

## 8. Dependency direction must become test-enforced

**Current state, measured:** the one-way rule holds with zero exceptions —
but it is verified by grep, not by a suite. That means nothing prevents the
next extraction from breaking it.

**Required before the first screen extraction from `app-v8.js`:** a static
suite (the `override-boundary` / `no-sample-specific-runtime-logic` pattern —
pure Node, no browser) that fails when any `globalThis.Merit*` module reads
`state`, `ui`, `render(` or `touchEvent(` in code. It must ignore comments,
or it will fire on the three existing comment-only mentions in
`seating-freeze.js` and `table-availability.js` and be disabled as noisy.

Until that suite exists, treat every extraction as unguarded on this axis
and say so.

---

## 9. Commit discipline

- **A refactor commit changes no behaviour.** Feature work and
  behaviour-neutral restructuring never share a commit.
- One screen / one capability / one concern per commit — reversible on its
  own.
- The commit message states: what moved, what did NOT move and why, which
  suite proves the behaviour is unchanged, and the result of all four gates.
- If the four gates were not all run, say so explicitly rather than
  implying they were.

---

## 10. Definition of done for a maintainability step

A step is done when **all** of these are true:

- [ ] Behaviour is **byte-for-byte identical** unless a change was
      explicitly requested.
- [ ] A suite proves it, and that suite was mutation-proven.
- [ ] All four gates pass: `test:all`, `build:offline`,
      `build:offline-full`, `verify:offline`.
- [ ] Source order verified; overridden functions still resolve to the v8
      versions.
- [ ] No new global mutable state; no new second writer for a domain fact.
- [ ] Dead code deleted only with recorded proof of unreachability.
- [ ] The commit contains no feature work.
- [ ] What was deliberately left alone is written down.

If any box is unchecked, the step is not done — report it as incomplete
rather than rounding up.
