---
name: merit-ui-quality-gates
description: The UI/UX quality gates for MERIT ENTERTAINMENT — EVENT MAKER — the three Plan Intelligence concepts, plan-as-hero, progressive disclosure, no browser-native dialogs, real empty/loading/error states, and task-completion measurement across three viewports and two languages. Use before calling any UI work complete and before claiming a UI/UX score. A screenshot is necessary, not sufficient.
---

# MERIT UI Quality Gates

`.claude/skills/merit-ui-constitution/SKILL.md` owns the visual language —
palette, density, typography, prohibited aesthetics. This file owns **when
UI work is finished**.

## THE RULE THAT DECIDES THIS DIMENSION

> **A screenshot proves it rendered. It does not prove it worked.**

The evidence that closes a UI task is a **completed operator task with a
counted number of interactions**. A screen can be beautiful, render at three
viewports, throw no console error, and still take eleven clicks to check in
a guest.

## The composition gates

### The three concepts, kept distinct
- **Concept 3 — map-first.** The Floor Plan is the primary surface. No
  permanent left object list, no permanent right technical inspector: a
  floating minimal toolbar, a contextual card on selection, a bottom status
  pill.
- **Concept 2 — grouped review.** Review Center answers a *family* at once.
  Not one pin per low-confidence box.
- **Concept 1 — the difficult question.** Reserved for genuinely ambiguous
  grouping, and for Teach. It is not the default review path.

Collapsing these into one generic list is a regression even if every pixel
is correct.

### The uploaded plan is the hero
The operator's own drawing is the largest thing on the Plan Intelligence
screen. Detection overlays serve the plan; they do not replace it. Review
mode is a **mode of the Floor Plan on the same canvas** — never a second
drawing of the room (`floor-plan-modes`, `layout-changes`).

### Progressive disclosure, and the quiet premium bar
- Default view shows what an operator needs *now*. Depth is one action away.
- **No warning flood.** Everything urgent means nothing is.
- **No unlimited toast stacking.** Toasts are capped and never obscure the
  work.
- No generic admin-SaaS card wall, no gradient decoration, no fake gold —
  gold carries VIP meaning only.

### No browser-native dialogs on a primary flow
Measured at `65ea956`: **9 `confirm()` and 2 `prompt()`** remain in `src/`.

These cannot be styled, cannot be translated, cannot be made accessible, and
look nothing like the product. Replacing them is shared work:
`premium-ui-director` designs, `accessibility-guardian` owns focus and
semantics, `localization-guardian` owns the Turkish.

### Every screen has four states
Not just the populated one: **empty · loading · error · populated.** An
empty state explains what to do next; it is not a blank panel. A loading
state does not shift layout when it resolves.

### Onboarding and provenance
- First-run guidance is real and dismissible, and does not reappear forever
  (`onboarding`).
- Where a number came from is reachable — capacity provenance, printed
  numbers, detector source. A figure an operator cannot trace is a figure
  they will not trust.

### Live Event is a speed surface
Door workflows are measured in seconds. Keyboard-first
(`live-door-keys`), minimal confirmation on the common path, and the search
must mean the same thing as the appbar's (`matchGuestRows` is shared).

## Required evidence

1. **Rendered screenshots** at 1920×1080, 2560×1440 and ~1440px, in **both
   TR and EN**, via `visual-qa-reviewer`. Markup review is never a
   substitute.
2. **Console clean** on every pass.
3. **Task completion**, counted, for the core operator workflows: create an
   event · import a guest list · seat a party · check a guest in · mark a No
   Show · export the workbook · review a detected plan. Record the
   interaction count and compare it across changes.
4. **Overflow, collision and truncation** checked with **Turkish** strings,
   which run longer than English.
5. **Four states** per screen, evidenced.

Evidence 3 is the one usually skipped, and it is the one that distinguishes
this file from a style guide.

## Scoring (from `merit-quality-program` §9)

- **Minimum gate** — rendered evidence at 3 viewports; no console errors.
- **9** — no browser-native dialog on a primary flow; every screen has real
  empty/loading/error states.
- **10** — plus measured task completion for the core operator workflows.

While 9 `confirm()` and 2 `prompt()` calls remain, this dimension cannot
exceed **7**.
