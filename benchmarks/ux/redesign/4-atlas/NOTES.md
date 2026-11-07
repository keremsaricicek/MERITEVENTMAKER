# 4 — Atlas: the event is a set of architectural drawings
**Idea:** one full-bleed drawing of the room, laid out like an architect's sheet. It has a grid around the edge (A–H, 1–12), a title block and a notes column. Navigation is a **sheet list in the title block** (A-01 Hazırlık … A-06 Çıktılar, keys 1–6). Each sheet shows the same drawing with a different layer on top. There is no sidebar, no tab bar, no row of KPI tiles and no table grid.
**Interaction model (new):** you point at the room or type into it; you do not move between screens.
- **Door:** the one search field at the top pins results to the drawing. A thin line runs from the highlighted result to its table, and that guest's chairs are marked. Enter checks the guest in, and the chairs fill in place.
- **Seating:** unseated guests stand in the drawn **foyer**, outside the door, as small groups of chairs. You drag a group onto a table, or click the group and then the table. Tables with enough free chairs show "N boş".
- **Overview:** open issues are numbered **keynotes**, a real convention on architectural drawings. Each number sits on the drawing and in the notes column.
- **Guests:** the guest list is set like an **atlas index**: "Yılmaz, Ahmet +3 ……… T05 D6". Every guest also has a grid reference, so a waiter hears "T05, D6".
- **Zoom is how you navigate:**
  - double-click a table to zoom to it: guest names appear around its chairs and a small note opens next to it;
  - "Tüm etkinlikler" zooms out to the home screen, a timeline of event drawings with a "Bugün" line between past and upcoming events. Past events are read-only.
- **Assistant (F8):** uses the same search field, so it is part of the drawing rather than a separate chat. For "mehmet kayayı t36ya oturt" it first draws the move on the room with dashed lines, then waits for "Uygula". It refuses honestly when a table is full and offers tables that have room. F10 opens the legend and help.

**Why it suits Merit:** luxury hotels sell rooms, and this design treats the ballroom drawing as the product. The look is calm and suits an architectural office: cool vellum, ink, Prussian blue. Gold appears only on VIP tables and VIP guests' chairs, and red only for problems and no-shows.

**"Too many buttons":** each sheet has at most one primary button, and it sits on the thing it acts on: "Giriş" on the guest's row, "Uygula" on the assistant's answer, "Kabul et" on a plan suggestion. Everything else is a text link or sits behind a ⋯ menu.
- "Gelmedi" lives only in the row's ⋯ menu, so it cannot be pressed by mistake instead of "Giriş".
- For a "+3" party you can tick each person in by clicking the chair boxes.

**"The screen jumps":** nothing is re-laid-out by an action.
- Checking a guest in changes only that row (the button becomes "Giriş 21:42 · Geri al" at the same width), that guest's chairs, and the counts, which use fixed-width digits.
- A seated foyer group leaves a dashed placeholder ("→ T36") behind, so nothing slides into its place.
- There is one fixed status line with "Geri al" just above the title block.
- Only zooming moves the map, and only when you ask for it.

**Contrast (WCAG, measured):**

| Text | On paper #ECEEE9 | On note paper #F7F8F5 | On selection #DCE5EE |
|---|---|---|---|
| Ink #1D2930 | 12.7 | 14.0 | 11.7 |
| Secondary #46525A | 6.9 | 7.5 | 6.3 |
| Muted #566269 | 5.4 | 5.9 | 4.9 |
| Prussian blue #1E4D78 | 7.5 | 8.3 | 6.9 |
| Red #A2352A | 5.8 | 6.4 | — |
| Gold #7E6119 | 5.0 | 5.5 | — |

White on Prussian blue is 8.8 and white on red is 6.8. Body text is 14–16 px and nothing operational is below 12 px.

**Cost:** high, about 6–9 weeks. It needs a scene-graph map renderer with a coordinate system, labels that stay the same size as you zoom, and a full-names view when zoomed in. The domain writers (assignment, arrival, Plan Doctor) stay as they are; the shell is replaced by one map and one notes column.

**Risk:** everything depends on the room drawing. An event with no plan yet needs a strong blank state ("plan yok"), and so does a badly read plan. Users who expect lists must learn that the search field is the door list. The map has to stay fast at 1,000+ chairs: SVG works at 428 chairs, but a canvas fallback may be needed. Long Turkish names around chairs need care at the full-names zoom level.
