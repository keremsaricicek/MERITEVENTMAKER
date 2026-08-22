---
name: merit-ui-constitution
description: The permanent visual constitution for MERIT ENTERTAINMENT — EVENT MAKER — premium, restrained, operational desktop UI standards, prohibited aesthetics, typography/density rules, canvas-priority layout, and the mandatory rendered-QA workflow. Use for any UI/UX/visual/layout/styling work, and always before claiming a UI task is complete.
---

# Merit UI Constitution

MERIT ENTERTAINMENT — EVENT MAKER is professional desktop operational
software for premium hospitality/casino event management — comparable in
discipline to commissioned enterprise event-operations software, not a
generic dashboard template. The design system lives in `src/styles.css`
as CSS custom properties (spacing, radius, elevation, motion scales, color
tokens); this skill is the durable brief that governs how that system
evolves.

The system in place is **"Merit Night Operations"**: a warm-ink dark
shell (never cool-gray, never black-and-white) with a deep-teal signature
accent, a left navigation rail, and serif used sparingly for identity and
numerals only — not as a body typeface. This replaced an earlier
"dark graphite + cool blue + top tabs" shell; treat that description as
historical, not current.

## The feeling this product must have

Premium. Corporate. Restrained. Sophisticated. Operational. Purpose-built.
Desktop-native. Information-dense but readable. High quality without
decoration for its own sake.

## Visual direction

- **Warm-ink** application shell/chrome (the `--ink-*` token scale) — not
  cool-gray, not pure black. Quiet, layered neutral panels.
- **Left navigation rail** (`.workspace-rail`) is the primary section
  switcher, not a top tab bar. Secondary/destructive card actions
  (Duplicate, Delete) live behind an overflow menu, not as always-visible
  icon buttons.
- **Warm-paper-toned "parchment" canvas** for the Floor Plan and Seating
  Plan — this is a deliberate, singular material contrast with the dark
  shell around it. It is not extended to any other screen.
- **Deep teal signal color** (`--signal`) for selection, interaction,
  focus, and active state — nothing else claims that color.
- **Serif (`--font-display`) is for identity and numerals only** — event
  titles, table numbers, KPI figures, dialog headings. Body/operational
  text stays on the sans (`--font-ui`) stack. Never flip this: serif
  throughout reads as editorial, not operational software.
- **Semantic color only**: green = success, amber = warning, red =
  danger/operational alert. Don't repurpose these for decoration.
- **Gold is VERY restrained** — only where VIP/VVIP business meaning
  genuinely requires it. Never gold as generic "luxury" decoration.

## Prohibited aesthetics — reject these on sight

Generic AI dashboard. Generic SaaS dashboard. Tailwind/shadcn demo look.
Casino marketing website. Gaming UI. Dribbble concept art. Glassmorphism.
Decorative gradients (gradient-heavy cards especially). Fake luxury gold.
Giant rounded "card wall" layouts. Huge empty marketing sections. Tiny
unreadable UI. Random unmotivated theme changes. White generic admin
forms. Anything that reads as a templated interface rather than a
purpose-built one. Also reject the "AI-generated" clichés this system was
deliberately built to avoid: warm cream + high-contrast serif +
terracotta; near-black + a single acid/neon accent; zero-radius broadsheet
styling.

## Typography and density

This is professional desktop operational software: dense is acceptable,
unreadable is not. Normal body/operational text should generally sit
around **12–14px**. Do not shrink critical operational text to 7–8px to
fit more on screen — use visual hierarchy (weight, color, spacing,
grouping) instead of extreme font shrinking to manage density.

## Canvas priority

Floor Plan and Seating Plan must maximize usable canvas space. Side panels
should be contextual, collapsible, and focused — not permanent giant
sidebars, large KPI strips, or wasted chrome. The Floor Plan should feel
closer to professional planning software than an admin dashboard; canvas
space is the product, chrome is in service of it.

## Viewports

Primary targets: **1920×1080** and **2560×1440**. Also check behavior
around **~1440px** desktop width. Desktop is the primary target — do not
compromise desktop UX chasing mobile-app behavior; this product is not
used on phones.

## Rendered QA is mandatory — non-negotiable

A UI task is **not complete** because the HTML exists, the CSS exists,
tests pass, or the DOM looks right in markup. **The rendered application
must actually be inspected in a browser.** For any meaningful UI change:

1. Render and screenshot at minimum: 1920×1080, 2560×1440, and ~1440px
   width.
2. Visually inspect: hierarchy, spacing, alignment, overflow, font sizes,
   canvas space, panel sizing, contrast, button hierarchy, empty states,
   modal sizing, interaction feedback.
3. Do this via the project's Playwright-based visual QA workflow (see the
   `webapp-testing` skill and the `visual-qa-reviewer` agent) — not by
   reading source and assuming it renders correctly.

Do not report a UI change as done without this evidence. "Tests pass" and
"looks right in the diff" are not substitutes for a screenshot.

## Framing every UI decision

Ask: does this look like it was commissioned from a serious enterprise
software studio for a premium hospitality operator, or does it look like
an AI generated a dashboard? If in doubt, strip decoration, tighten
hierarchy, and lean on the existing token system in `src/styles.css`
rather than introducing new ad hoc styles.
