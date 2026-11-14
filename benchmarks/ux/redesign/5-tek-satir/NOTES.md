# 5 · Tek Satır — the concierge line

**Idea:** every screen is a quiet sheet under one signature line; you say what you want in Turkish, the line shows *"Anladığım: …"* as you type, and the answer arrives as a single note with one action and a "Geri al".

- **Why Merit:** a luxury hotel works by asking the concierge, not by pressing switches. The line is drawn like the signature line of a guest book (serif, hairline, petrol nib); gold appears only beside VIP/VVIP names and VIP tables.
- **Innovative model, not a skin:** no sidebar, no tabs, no KPI row. Places open from the scope word above the line ("KAPI ⌄") or by typing "kapı"; a "← previous" link replaces navigation chrome. Home is a time ribbon of the house's evenings with a "BUGÜN" line, not an event grid.
- **Fewer buttons:** each sheet has at most one filled button (Etkinliği aç · Oturt · Giriş · Yazdır); everything else is a typed sentence, a text link, or appears on the object (table → Döndür / Kapasite / Kaldır).
- **Nothing jumps:** the desk is a fixed 181 px on every screen (measured on home, genel, oturma, kapı, while typing too). Replies float over the sheet instead of pushing it. A check-in replaces only its own row (fixed 76 px) and the counter, with fixed-width digits. Moving guests changes only the chairs of that table (new ones petrol).
- **Door safety:** "Giriş" is the large right-hand button; "gelmedi olarak işaretle" is a small link under the name at the opposite edge and always asks first, saying the planned seat is kept. Enter on a single match checks in; Ctrl+Z / "Girişi geri al" undoes.
- **Assistant (F8) is the product, not a bubble:** it shows before acting ("Şimdi → Sonra"), asks when unsure, gives gentle rule reminders (VIP table / VIP guest), and Enter again confirms. F10 = help topics in the same note.
- **Domain honesty kept:** plan reading starts only on a person's request; suggestions are accepted one by one; No Show keeps the table; "+3" stays one record of 4.

**Contrast (WCAG, measured):** ink #15252B on paper #FAF8F5 14.88 · ink-2 #4E5C62 6.54 · ink-3 #626D71 5.02 (4.56 on desk) · petrol #1D5561 7.85 · white on petrol 8.32 · VIP brass #7A5A1E 5.99 · arrived pine #2B6548 6.48 · no-show mulberry #7A2D43 8.67 · placeholder #6A706D 4.77. Smallest operational text 12 px (caps labels, table numbers); body 14–16 px; the line 30–34 px. Dimmed (non-fitting) tables during a seat pick are intentionally at 50 % and are not operational text.

**Fonts:** Iowan Old Style / Charter / Palatino / Georgia for the line and headings; Segoe UI / SF Pro / Inter / system-ui for body. No network, inline SVG only.

**Cost to build:** the sheets are a shell rewrite (~3–4 weeks for one engineer: desk + reply component, six sheets reusing the existing writers `assignGuestToTable`, `setArrival`, reports). The F8 parser already exists (`assistant-parse`, `assistant-actions`); making it the primary input needs a stronger "understood" preview, Turkish suffix handling and a command test corpus (~2 weeks). Total ≈ 6 weeks incl. QA at three viewports.

**Risk:** discoverability for staff who will not type — mitigated by the example sentences under the line, the scope menu and visible single actions, but needs a usability check with real door staff. A misread command is the main danger: every write is shown first and undoable, and nothing writes on a guess.
