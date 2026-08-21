# UI rules

- No generic AI-dashboard, card-wall, glassmorphism, or gradient-heavy
  aesthetics. No fake decorative gold — gold only for genuine VIP/VVIP
  meaning.
- Ground every style change in the existing tokens in `src/styles.css`
  (spacing/radius/elevation/motion/color custom properties) — don't fork a
  parallel system.
- Body/operational text ~12–14px. Use hierarchy (weight, color, spacing)
  for density, not extreme font shrinking.
- Floor Plan and Seating Plan canvases stay canvas-priority — panels are
  contextual/collapsible, not permanent giant chrome.
- Desktop-first: verify at 1920×1080, 2560×1440, and ~1440px.
- A UI change is not complete without an actual rendered screenshot at
  those viewports via the `visual-qa-reviewer` agent / `webapp-testing`
  skill — markup/diff review alone does not satisfy this.
- Full detail: `.claude/skills/merit-ui-constitution/SKILL.md`.
