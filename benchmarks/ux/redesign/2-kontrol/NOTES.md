# 2 · Kontrol masası — notes

**The idea in one sentence:** the room never leaves the screen. You *read* it through six lenses (Durum, Plan, Misafirler, Oturma, Kapı, Raporlar), you *speak* to it through one command line, and every answer sits in one column right above that line, tied to its place in the room by a thin bronze leader line.

**The interaction model (not a template):** no navigation sidebar, no top tabs, no KPI tiles, no table-grid pages. There are three parts. (1) **Room**: the drawn ballroom fills the stage in every lens. A lens changes only the colours: chairs filled when a seat is planned, green on arrival, claret for a no-show, bronze where a seat would go. (2) **Line**: F8, or simply start typing. Names, tables (`t05`, `vip 2`) and Turkish verbs (`oturt`, `giriş`, `gelmedi`, `ne eksik`, `yazdır`) all go to the same line. (3) **Column**: it shows what the lens or the line produced. Answers stack upward from the line, so the best match is the row directly above the cursor; Enter applies it. The events home is a season strip: past events sit to the left, locked; tonight is in the middle; upcoming events and "+ Yeni" are to the right.

**Why it suits Merit:** it works like a five-star night desk: low light, ink and graphite, warm bronze for the one accent, gold only on a real VIP. Turkish serif for names and dates, mono figures for counts. It is quiet in a dim foyer at 22:00, with no glow and no neon.

**"Too many buttons":** each lens has at most one filled button. Everything else is a text action or sits in a ⋯ menu. "Gelmedi" never sits next to "Giriş": it is only in the row's ⋯ menu, so a slip between the two is physically impossible. Delete asks for confirmation inside its own row. Rules give warnings and never block.

**"The screen jumps":** the room's geometry is identical in every lens, and a lens change only recolours it. A check-in changes three things only: that row's state cell (which shows "Geldi 22:14 · Geri al"), the chairs at that guest's table (a short glow), and the counter cells, which are fixed-width tabular figures with a 0.9 s tint. A seated guest stays in place in the tray as "T14 · Geri al" instead of vanishing. Undo works in two places: inside the row, and on the room's caption (or Ctrl+Z).

**Assistant (F8) / help (F10):** the assistant is the line itself, not a chat bubble. When it is unsure it shows first: "Emin değilim… Hangisi?" for an ambiguous name, or "T12 dolu, en yakın T37" when a table is full, with a dashed preview of the chairs it would use. Nothing is applied until Enter. F10 opens help topics in the same column.

**Contrast (WCAG, measured):** paper #EDE7DB on ink #141820 is 14.4:1. Secondary #BDB5A7 is 8.8:1. Tertiary #9A9387 is 5.8:1 (5.4:1 on hover rows). Bronze #C99D6B is 7.2:1. Button text #18120B on bronze is 7.5:1. VIP gold is 10.9:1, "Geldi" green 9.0:1, "Gelmedi" claret 8.0:1. On the print preview, ink on paper is 13.8:1 and grey on paper 6.2:1. Body text is 14–16 px; the smallest operational text is 12 px. Plan table labels stay ≥ 12 px at 1440.

**Fonts and offline:** the page uses system fonts only (Iowan / Palatino / Charter for the serif, Segoe / SF / Inter for the sans, SF Mono / Cascadia / JetBrains for figures), with inline SVG and no network requests. The prototype's console is clean apart from a missing favicon.

**Cost to build (estimate):** a new shell of about 3–4 weeks: the lens dial, the answer column, the caption and the leader-line overlay. The room renderer exists (the floor plan), but it needs a "lens" paint mode and per-table redraw: about 1–2 weeks. The line can reuse today's F8 parse/actions (`assistant-*`), plus bottom-anchored results: about 1 week. Each existing screen's content has to be rewritten as column content: about 3–4 weeks. Every writer (seat assignment, `setArrival`) stays as it is. Total: roughly 8–11 weeks, plus a UI test suite rewrite.

**Risks:** (1) A room-first layout depends on a plan existing: a blank event or a cocktail event with no tables needs a good empty room (proposal: "Planı oku" fills the stage). (2) 200+ guest lists live in a 470–540 px column; heavy list work, like a bulk Excel fix, may want a temporary full-width roll. (3) Bottom-anchored answers are unusual for reading; they are right for the door, but staff need one minute of explanation. (4) The dark theme must stay readable on cheap foyer screens, so gamma needs testing on the real hardware.

Shots: `shots/1-home … 9-assistant-question`, each at 1440 and 1920 (`8` = F8 seat command, `9` = "bugün ne eksik").
