# 1 — Maître d' (Etkinlik Defteri)

**Idea:** the event is a maître d's bound reservation book — names on the left page, the room on the right, the evening's course in the spine — and everything undecided is written in **pencil** until someone **inks** it.

**Why Merit:** it borrows the host stand of a grand hotel restaurant, not a SaaS console. Serif names (Palatino/Iowan; Caladea on Linux), a quiet sans for data, hairlines, no boxes. The floor plan is an architect's ink drawing: hatched walls, structural grid bubbles, door swings, dimensions, a title block (Pafta 01 · 1:200). Gold appears only on VIP/VVIP.

**Interaction model (not a sidebar + tabs + KPI template):**
- One spread, two pages. The **spine** in the middle lists the evening's six moments in order (I Hazırlık → VI Raporlar, so the numbering is a real sequence); a bordeaux ribbon marks where the book is open. Changing moment slides the spine (550 ms) to give the page that needs it more room: Salon pushes it left, Kapı gives the stand 60 %.
- **Pencil / ink grammar** everywhere: plan-reading suggestions, draft seating and assistant proposals are dashed graphite on the drawing. One verb applies them: "Mürekkeple". Erasing is "Sil", and there is always "Geri al".
- **F8 assistant = the pen line** at the foot of the book. Answers come back on a slip; an action is first pencilled onto the plan ("Mehmet Kaya?" at T12) and changes nothing until inked. **F10 = the book's index** (topic → moment numeral).

**"Too many buttons":** every page has at most two buttons; everything else sits in `···`. At the door, Giriş is the only button on a row. Gelmedi lives only in `···`, so the two cannot be confused. The Enter key does a check-in, never a no-show.

**"The screen jumps":** check-in replaces only its own row (a tick is drawn in the margin, "Geldi 21:48 · Geri al" sits in the same fixed 252 px slot). Besides the row, only the arrived count, that group's hairline and the recent-arrivals list change. In Salon and Oturma, acting on a suggestion or a guest keeps the row in place with its result and undo; the list never reflows. Slips overlay the page and push nothing.

**Contrast (WCAG, on paper #FBFAF7):** ink 15.98 · ink2 7.76 · ink3 5.27 (4.87 on spine) · pencil 5.86 · pen-blue 9.42 (8.69 on selection wash) · green 7.56 · bordeaux 9.12 · VIP gold 5.62 · paper on ink buttons 15.98. All text is ≥ 4.5:1. Body text is 15 px; nothing operational is below 12 px. Plan labels render at about 12–13 px at 1440.

**Build cost (estimate):** shell (spread, spine, pen line, slips) 2–3 wks. Restyle the ink plan renderer 1–2 wks. Pencil/ink states across detection, draft seating and assistant 2 wks. Door stand 1 wk. QA, i18n and a11y 2 wks. **≈ 8–10 dev-weeks.** No new libraries, system fonts only.

**Risks:** the metaphor can overreach ("kurşun kalem" needs one sentence the first time). The moving spine may disorient some users (reduced-motion turns it off). Serif rendering varies by OS (Palatino on Windows, Iowan on Mac). The plan at 1440 in Oturma is tight for 42+ tables, so it needs zoom. Below 1100 px the spread collapses to one page.

Files: `index.html` (deep links `#home #hazir #salon #misafir #oturma #kapi #rapor`), `shots/*-1440.png`, `shots/*-1920.png`.
