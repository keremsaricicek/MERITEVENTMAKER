# 6 · Birleşik — combined direction, revision 3 (SPEC-v2, "Owner's verdict on v2")
- **Shell:** a thin 52 px bar with Etkinlik · Salon · Misafirler · Oturma · Kapı · Raporlar (keys 1–6) and the F8 command line. Fonts are system sans only.
- **Etkinlik (v3):** a quiet month calendar, Monday first, opening on Aralık 2026 (‹ › Bugün).
  - Each event is one slim entry: a bar, the name, and the time underneath.
  - Past days are a shade darker, and past events are grey with a lock.
  - Today has a filled date marker. Clicking an entry fills a calm side panel: date and time, venue, people, readiness (four lines), "Etkinliği aç", "Aynı yerleşimle yeni" and ⋯ (Çoğalt, Dışa aktar, Sil).
  - A "+" appears on a future day under the pointer, to create an event on that date.
- **Salon / Kapı plan (v3):** a minimal icon plan with no chairs by default (circle or rounded rectangle, number, occupancy ring).
- **Glow:** these make one table glow and pulse softly, with fine chairs drawn around it:
  - the assistant is asked "X nerede oturuyor";
  - a guest row is clicked at the door, or a guest checks in;
  - a table is clicked in the salon, or a name in its popover.
  The guest's own seats are highlighted (steel blue in light, champagne in dark). The assistant answers "T05'te oturuyor · sandalye 1–4".
  The glowing table is drawn last, so nothing covers it. Measured: T05 showed 10 chairs, 4 of them highlighted; the clicked door row did not move.
- **Classic dark (v3):** deep navy and graphite (#0D1117 / #131A23), ivory text #EEE7D9, champagne primary #CDB98F and gold only on VIP.
  - Status is shown by a subtle tone plus an icon: sage #A7B59F with a check for arrived, dusty rose #C4A09A with an × for no-show.
  - There is no neon and no saturated green or red. F9 or the button switches theme.
- **Unchanged (owner approved):** Misafirler, Oturma (chair drawing) and the door's behaviour (big Giriş on the right, Gelmedi in ⋯ and it asks first, Geri al).
- **Contrast (WCAG), dark theme on surface #131A23:** ink 14.2 · ink-2 9.1 · ink-3 5.4 (5.8 on background) · sage 8.1 · rose 7.4 · VIP 8.5 · champagne 9.4 · button text 9.4.
- **Contrast (WCAG), light theme:** ink 17.6 · ink-3 5.7 · VIP 5.4 · green 6.4 · steel 6.8 · button text 14.4.
- **Text sizes:** nothing operational is below 12 px.
- **v3 shots, 1440×900:** 1-home (events, light) · 8-home-dark (events, dark) · 2-salon (T05 glowing after the assistant was asked) · 5-door-light · 6-door-dark. Shots 3, 4 and 7 are from v2 and were not re-taken. The console was clean.
- **Cost / risk:** a shell of about 6–8 weeks, reusing the writers (`assignGuestToTable`, `setArrival`) and the F8 parser. The glow needs per-table seat order, which the seat model already has. An event with no plan needs an empty state.
