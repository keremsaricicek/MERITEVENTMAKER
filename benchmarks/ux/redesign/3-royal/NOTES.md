# 3 — Merit Royal: "Etkinlik Defteri" (the maître d's book)

**Idea.** The product is one open register on emerald casino felt. Every job is a two-page spread: the **left page lists**, the **right page works** on the one thing chosen. The floor plan is an atlas plate across both pages, with the fold on the dance floor.
**Navigation.** No sidebar, tab bar or KPI row. You move with the book's thumb index on the fore-edge, which also shows each chapter's live status ("14 masasız", "312 / 420 geldi"). The F8 concierge is a note card that rises from the silk ribbon at the fold; F10 help is the back of that card.

**Why Merit.** It uses the resort and casino's own materials: green baize, the reservation ledger, the escort card, a crest. Calm, symmetric pages for reading; an asymmetric right page for work. Gold appears only on real VIP marks and VIP tables.
**"Too many buttons".** At most one primary action and one "Diğer" menu per page; rare actions are quiet links on the right page. Add, paste and Excel import open on the right page, so there are no modal stacks.
**"The screen jumps".** A click changes only its own row or card.
- Door: Giriş swaps one fixed-height zone for "Giriş yapıldı 21:42 · Geri al"; the row gets a tick; counters change digits only.
- Gelmedi sits under a rule, far from Giriş, and has undo. Enter only ever checks in.
- Seating: the seated row folds away and "→ T29 · Geri al" appears in a line fixed at the page foot. Rule breaks are footnotes, never pop-ups.

**Contrast (measured, WCAG; body 15 px, nothing operational below 12 px, plan labels scaled per zoom).**
- On paper #FAF6EC: ink 15.2, ink-2 8.6, ink-3 6.0, emerald link 9.1, VIP gold #755A22 6.0, oxblood 7.9.
- Ivory on the emerald button 9.2; ink-3 on a thumb tab 4.7; on a selected row 5.3.
- On the felt: text 12.9, muted 8.5.
- Below 4.5 on purpose: tables that cannot take the selected guest are dimmed to 42 %.

**Cost.** About 3–4 weeks of front end, no domain changes: a spread shell with thumb index and ribbon card, each screen re-cut into a left and a right page, the plan canvas reused as the plate, the existing F8 assistant re-housed in the card. Then screenshot, language and keyboard tests.

**Risk.**
- Overdo the metaphor (paper texture, page curls) and it becomes a costume; it must stay flat.
- Pages are half-width at 1440, so the fold moves per chapter (36–60 %); some may find that unusual.
- The dark felt goes against today's "one light palette" rule and needs the owner's yes.
