---
name: merit-ui-constitution
description: The permanent visual constitution for MERIT ENTERTAINMENT — EVENT MAKER — premium, restrained, operational desktop UI standards, prohibited aesthetics, typography/density rules, canvas-priority layout, and the mandatory rendered-QA workflow. Use for any UI/UX/visual/layout/styling work, and always before claiming a UI task is complete.
---

# Merit UI Constitution

MERIT ENTERTAINMENT — EVENT MAKER is professional desktop operational
software for premium hospitality/casino event management — comparable in
discipline to commissioned enterprise event-operations software, not a
generic dashboard template. The current design system already lives in
`src/styles.css` as CSS custom properties (spacing, radius, elevation,
motion scales, color tokens); this skill is the durable brief that governs
how that system evolves.

## The feeling this product must have

Premium. Corporate. Restrained. Sophisticated. Operational. Purpose-built.
Desktop-native. Information-dense but readable. High quality without
decoration for its own sake.

## Visual direction

- **One coherent light/warm system app-wide.** The old dark-graphite
  shell was fully retired, not recolored — every screen (Home, Guests,
  Seating, Live Event, Reports, Floor Plan, Plan Intelligence) draws from
  the same root tokens in `src/styles.css`. Never reintroduce a second,
  visually distinct dark system for any screen.
- **Warm-paper-toned canvas** for the Floor Plan itself — this is
  deliberate and already how `src/styles.css` treats the canvas; it reads
  as a physical plan on paper. It now sits inside a light shell rather
  than contrasting against a dark one.
- **Controlled cool blue** for selection, interaction, focus, and active
  state — nothing else claims that color.
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
purpose-built one.

## A recolor is not a redesign

If asked to redesign a screen, changing color tokens, spacing, or type
scale while leaving the DOM structure, information architecture, and
interaction model intact does **not** satisfy the request. That is
makeup, and it has already been rejected once on this product.

A real redesign answers: what is this screen's job, what should be
primary vs. secondary vs. hidden until asked for, what gets promoted,
what gets removed entirely, and what interaction replaces the old one.
If the redesigned markup is structurally recognizable as the old markup,
it is not done.

Note the inverse trap too: honoring the Floor Plan's design *principles*
on another screen never means literally transplanting its floating
toolbar / contextual card / status pill components there. Each screen is
designed for its own job; only the color language and token system are
shared.

## The user is not an engineer

This is operational hospitality software. It is used by event staff —
sometimes standing at a venue door during a live event, in a hurry, on
someone else's laptop. Usability for a non-technical person is the
primary success criterion; aesthetics second; cleverness never. Prefer
plain operational language over product jargon, make the primary action
on each screen unmistakable, and make destructive or irreversible actions
recoverable.

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
