# Keyboard-only walk of the demo flow — 2026-11-08 (report only, no UI edits)

Method: Playwright Chromium, 1440x900, English. Real key presses only for movement
(Tab, Enter, Esc, F8, F9, ?). Test data (6 tables / 12 guests) was put in through the
page API (not persisted); the walk script is not committed. Each screen: every visible,
enabled interactive control was listed and compared with the controls Tab actually
reached (from the top of the page). The existing suite `a11y-keyboard-workflows` covers
the finished operator tasks; this walk looks for focus loss and unreachable controls.

## Result in one line
No visible control is unreachable by Tab on any screen (Events, New event, Floor, Guests,
Seating, Door, Reports, F8 assistant). Focus loss and Esc behaviour are the real gaps.

## Where focus is lost or a key does nothing
1. **New event (Events screen) -> Enter:** the new-event screen opens and focus drops to
   `<body>`. The first field is not focused; a keyboard user must press Tab twice to reach
   the name field.
2. **Esc on the new-event screen does nothing** (`ui.screen` stays `new-event`); only the
   Cancel button leaves it. Esc is the documented "close the top layer" key.
3. **Enter on a top-bar tab (Room, Guests, Seating, Reports):** the screen changes and
   focus drops to `<body>` (the pressed button is replaced by the re-render). The user
   must Tab from the page start again (about 3-5 presses to get back to the tab row).
   Door is the exception: focus lands in its search box (good).
4. **Create Event (dialog Create/Blank) -> Enter:** the workspace opens with focus on
   `<body>`.
5. **F8 -> Esc:** the assistant closes and focus goes to `<body>`, not back to the control
   or field that had it before F8.
6. **F9 (theme):** works, but focus ends on `<body>` after the theme re-render.
7. **? key:** opens the assistant's key list and focuses its input (good).

## Smaller notes
- Tab order on an empty Events screen: Settings menu summary, then its items (only when
  open), then New event. The order is fine; the "today" block is focusable but does
  nothing (not tested further).
- Tab past the last control leaves the page (focus to browser UI) and does not wrap: normal.
- The date field has four Tab stops (native day/month/year/picker).
- Console during the walk: only external-resource errors (the sandbox has no outbound
  network) and one 404; no page errors.

## Suggested fixes for the UI owner (not done here)
- After any `render()` that replaces the focused control, restore focus to the same
  `data-*` control (one shared helper), and move focus to the first field or heading when
  a screen opens (items 1, 3, 4).
- Esc on the new-event screen = Cancel (item 2).
- Remember the element focused before F8 and return focus to it on close (item 5).
