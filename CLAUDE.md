# MERIT ENTERTAINMENT — EVENT MAKER

Internal, browser-only event-operations software for premium hospitality/
casino event management (Events, Floor Plan, Guests, Seating Plan, Live
Event, Reports, Plan Intelligence, Teach AI). No backend — state lives in
`localStorage`. See `README.md` for how to run it and the project
structure; see `.claude/skills/merit-product-contract/SKILL.md` for the
full domain contract.

## Current stage: BROWSER REVIEW

This is not an EXE/Electron/desktop-packaging project right now. Desktop
architecture knowledge and skills may be prepared, but nothing gets
packaged, installed, or bundled until the user types the exact phrase
**"EXE YAP"** in the conversation. Installing an Electron-related skill or
discussing desktop architecture is never itself authorization to build one
— see `.claude/skills/merit-desktop-architecture/SKILL.md`.

The end user must never be asked to install Python, Node.js, pip, a venv,
or run any terminal/setup step. Whatever hides behind the eventual desktop
build is a developer-time concern only.

## Non-negotiable domain rules

- **Guest = one record.** "Name +3" is a named guest plus 3 companions,
  total pax 4 — never four separate records. Companion seats export as
  `GUEST OF [PRIMARY NAME]`.
- **Planning status** (Confirmed/Tentative) and **arrival status** (Not
  Arrived/Checked In/No Show) are independent axes. Neither changes the
  other.
- **No Show** preserves the guest's planned seating assignment but
  releases live operational capacity — these are two different concepts
  (`occupiedSeatIndexes` vs. `liveUsedIndexes`), never merge them.
- **Chairs are first-class objects** backing table capacity — never let
  `table.capacity` drift out of sync with `table.chairs`.
- **Historical events are immutable** (`status === "Completed"` or a past
  date) — enforce this in domain logic (`canMutate`), not only in the UI.
- **Reports are regression-sensitive.** TABLE PLAN / GUEST LIST /
  UNASSIGNED sheet contracts and companion-seat export formatting must
  survive any change touching guest/table/seat data.
- **Blank events are actually blank** — never seed sample tables, guests,
  or a demo background into a new event.

Full detail: `.claude/skills/merit-product-contract/SKILL.md`.

## UI standard

Premium, restrained, operational desktop software — not a generic AI
dashboard, card wall, or gradient-heavy template. "Merit Night Operations"
system: warm-ink shell with a left navigation rail, warm-paper "parchment"
Floor Plan/Seating canvas, deep-teal interaction state, serif reserved for
identity/numerals only, semantic-only color, VERY restrained VIP gold.
Body text ~12–14px; dense, not unreadable. Desktop-first at 1920×1080 /
2560×1440 / ~1440px.

**A UI change is not done until it has been rendered and screenshotted** —
source/markup review is not a substitute. Full detail:
`.claude/skills/merit-ui-constitution/SKILL.md`.

## Plan Intelligence honesty

Assisted Detection today is classical computer vision, not a trained
model — label it "Assisted Detection," never "AI." If no trained domain
model exists, say **"DOMAIN MODEL NOT INSTALLED"** rather than implying
one is running. Never fabricate detections, confidence scores, or model
metrics. Full detail: `.claude/skills/merit-plan-intelligence/SKILL.md`.

## Data integrity

Persisted state must never silently corrupt guest/table/chair/assignment
relationships across a schema migration, and historical events must stay
immutable at the storage layer. Full detail: the `data-architecture-
engineer` agent and `.claude/skills/merit-product-contract/SKILL.md`.

## Delegation

Route significant work to the matching specialist in `.claude/agents/`
rather than doing everything from one broad context — product-semantics
questions to `merit-product-director`, visual direction to `premium-ui-
director`, rendered verification to `visual-qa-reviewer`, and so on. See
`.claude/rules/` for short, durable per-domain constraints, and
`.claude/skills/` for the full reference material each agent draws on.
Don't let two agents edit the same central UI file at the same time.

## This session's scope

The engineering environment under `.claude/` and this file are the
deliverable of the session that created them — not a license to also
redesign the product, build the EXE, or implement Plan Intelligence
end-to-end just because the relevant skills now exist. Read
`.claude/SOURCES.md` for exactly what was vendored and why, and what was
deliberately left out.
