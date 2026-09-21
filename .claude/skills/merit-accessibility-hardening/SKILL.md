---
name: merit-accessibility-hardening
description: The accessibility contract for MERIT ENTERTAINMENT — EVENT MAKER — keyboard-only operation, focus management, dialog semantics, live-region announcements, accessible names, contrast, zoom, reduced motion, and Floor Plan canvas accessibility. Use for any accessibility work, before adding aria attributes, and before claiming an accessibility score. Requires real keyboard workflow tests, not attribute counts.
---

# MERIT Accessibility Hardening

Project-specific accessibility contract. The general method lives in
`.claude/skills/web-accessibility/SKILL.md` — read that for WCAG technique
and ARIA semantics. This file says what that method means **for this
product**, and what counts as evidence here.

## Where this dimension actually stands

Measured at `65ea956`:

| | |
|---|---|
| `aria-*` attributes across `src/` + `index.html` | **23** |
| `role=` attributes | **8** |
| Accessibility test suites (of 65) | **0** |
| Browser-native `confirm()` / `prompt()` in `src/` | **9 / 2** |

For an application with eight screens, a canvas editor, a live door
workflow and a dozen dialogs, those numbers describe an app that has not
been made accessible yet. Start from that, not from a hopeful reading.

## THE RULE THAT DECIDES THIS DIMENSION

> **Adding `aria-*` attributes is not accessibility work.**

An attribute count can go up while the app remains unusable by keyboard. The
evidence that counts here is a **completed operator task without a mouse**,
and nothing else substitutes for it.

Specifically, the following do **not** count as evidence:
- a higher `aria-label` count
- an automated scan with no violations, on its own
- `role` attributes added to elements that were already semantic
- a screenshot

## What must be true

### Keyboard-only operation
Every operator task completable with the keyboard alone, from page load:
create an event · import a guest list · place and number tables · assign a
guest to a table · check a guest in at the door · mark a No Show · export the
workbook · review a detected plan · record a Teach Area lesson.

- **Logical tab order** following visual order, per screen.
- **No keyboard trap anywhere.** Tab must always be able to leave.
- **Visible focus on every focusable element**, including custom controls and
  canvas objects. A focus style removed for aesthetics is a defect.
- **Escape** closes the topmost layer and nothing else. It never discards
  unsaved operator input silently.

### Dialogs
This app is dialog-heavy, so this section carries most of the risk.

- Focus **moves into** the dialog on open, to the first meaningful control —
  not the close button unless that is the only action.
- Focus is **trapped** inside while it is open.
- Focus is **restored** to the invoking control on close. Returning focus to
  `<body>` is a defect: it drops the operator at the top of the page.
- The dialog has an accessible name tied to its visible heading.
- Background content is inert to assistive technology.

### The 9 `confirm()` and 2 `prompt()` calls
Browser-native dialogs are both an accessibility problem and a UI-quality
problem (`merit-ui-quality-gates` §native dialogs). They cannot be styled,
cannot be made to match the product, and their semantics vary by browser.
Replace them with real in-app dialogs that meet the rules above. Coordinate
with `premium-ui-director` so the replacement is designed, not improvised.

### Announcements and dynamic content
Live Event is the hard case: arrivals, check-ins and wave changes update
while the operator is working.

- A status change an operator must know about is announced via a live region.
- **Politeness matters**: a check-in confirmation is `polite`; a blocking
  error is `assertive`. Announcing everything assertively is as bad as
  announcing nothing.
- A live region must exist in the DOM *before* the content changes.
- Do not announce the entire re-rendered list. Announce the change.

### Names, labels and errors
- Every control has an accessible name. Icon-only buttons need one
  explicitly — and it must be translated (see
  `merit-localization-hardening`; an English `aria-label` in a Turkish UI is
  both a localization and an accessibility defect).
- Every form field has a programmatically associated label.
- Every validation error is **linked to its field**, not only shown as a
  toast. A toast that disappears is not an error message for someone using a
  screen reader.

### Tables and lists
Guest lists, seating rosters and the audit trail are real tabular data.
Use real table semantics or correct `role` structure — not a grid of divs
with no relationships.

### Floor Plan canvas
The canvas is the hardest surface and must not be silently exempted.

Minimum: an operator can reach, select and act on plan objects without a
mouse — via the object list, keyboard selection, or an equivalent path. If a
capability genuinely cannot be made keyboard-accessible, that is a **named,
written limitation with an alternative path**, not silence.

### Visual
- Contrast meets WCAG AA for text and meaningful UI, in **both** the light
  shell and the `--pi-*` scoped surfaces.
- Usable at 200% zoom without loss of function or content.
- `prefers-reduced-motion` respected.
- Colour is never the only carrier of meaning — VIP, No Show, frozen and
  unavailable states each need a non-colour cue.

## Required evidence

A suite — there is none today, and creating it is the first task.

1. **Automated scan** across every screen, both languages, run in CI.
2. **Real keyboard workflows** driving the app through the tasks listed
   above with keyboard events only, asserting the task completes.
3. **Focus assertions**: for each dialog, focus enters, is trapped, and is
   restored to the invoker.
4. **Announcement assertions**: the live region's content changes when an
   arrival is recorded.
5. **Contrast** computed from rendered pixels, at both themes.

Scan and workflows are both required. The scan catches missing names; only
the workflows catch a trap, a lost focus, or a task that cannot be finished.

## Scoring (from `merit-quality-program` §10)

- **Minimum gate** — every operator task completable by keyboard; no trap;
  visible focus.
- **9** — plus automated scan clean, focus trap/restore correct in every
  dialog, dynamic Live Event updates announced.
- **10** — plus verified with a real screen reader.

Until suites 1–4 exist and pass, this dimension cannot be scored above
**5**, regardless of how many attributes were added.
