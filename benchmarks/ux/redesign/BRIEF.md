# MERIT EVENT MAKER — redesign brief (owner, 2026-11-02)

The owner does not like the product's look, layout or way of working. Every FEATURE stays; the INTERFACE is
redesigned from the root. Not a recolour, not "small touches". He has been disappointed by AI design before:
this time it must be original, high quality, and make him say "wow".

## What he asked for (his words, translated)
- "Quality, smooth, corporate — and at the same time simple, chic, aesthetic, elegant."
- "In harmony with the workplace": Merit Entertainment — Merit hotels and casinos (Merit Royal, Cyprus), concerts,
  galas, VIP / junket guests. Luxury hospitality, not a start-up dashboard.
- "Too many buttons side by side, too confusing." "You click 'Gelmedi' (no-show) and the left changes, the right
  changes" — a click must change only what it is about.
- "Truly original — today every AI can make this design." No templates, no generic SaaS dashboard.

## Hard rules
- Owner (binding): NO copy of today's app and NO standard interface pattern (sidebar + top tabs + KPI row +
  table grid, stock admin layouts). Each concept is genuinely innovative and different from the other four —
  invent the interaction model, not only the skin.
- One main job per screen; few buttons, each where the hand expects it; secondary actions tucked away.
- Calm layout: nothing jumps; an action changes only its own row/area; motion is subtle and purposeful.
- Readable: body 14–16 px, nothing operational below 12 px; contrast ≥ 4.5:1 for text (measure and state it).
- Desktop first (1440 and 1920 wide). Turkish UI (texts below), Turkish letters everywhere.
- Banned: card walls, glassmorphism, gradient buttons with glow, neon, emoji, stock "AI dashboard" KPI tiles,
  purple-blue gradients, everything-in-rounded-boxes, generic icon soup. Gold only where a guest is truly VIP.
- Offline product: no CDN, no web fonts from the network. Use system fonts or a font stack that degrades well
  (e.g. "Iowan Old Style", "Palatino Linotype", Georgia for a serif; "Segoe UI", "SF Pro", Inter, system-ui for a sans).
  Inline SVG for icons/illustration, drawn by you.

## The product's jobs (all must have a home in your design)
1. Events home: upcoming events, past (read-only) events; create, "same layout" copy, duplicate, export, delete.
2. Event overview ("is it ready?"): open issues, seated / unseated, plan checks.
3. Floor plan: the venue drawing with tables (round/rect), chairs, stage, bar; read the plan from a PDF/image;
   add/move/rotate tables; plan suggestions to accept/reject.
4. Guests: list (name, +N party, VIP, host/junket "Davet eden", status), import Excel, paste a list, add.
5. Seating: unseated guests on one side, the room on the other; assign by drag or click; groups/junkets together;
   draft seating; rules ("keep apart", "VIP at VIP tables") as gentle warnings.
6. Live / door: find a guest in 1 second, check in ("Giriş"), no-show ("Gelmedi") — with undo, never a slip
   between the two; arrivals per group; the door at night is crowded and fast.
7. Reports: Excel table plan, print table plan, door list A–Z, junket report, event summary.
8. F8 assistant: types Turkish ("ahmet yilmazi t05e oturt", "bugün ne eksik"), answers and acts (shows first when
   unsure); F10 help topics. Decide where it lives so it feels native, not a bolted-on chat bubble.

## Sample data (use it; make it feel real)
Event: "Merit Royal Yılbaşı Galası" · 31 Aralık 2026 · Merit Royal Hotel, Grand Balo Salonu · 420 kişi · 42 masa.
Tables T01–T38 (10 kişilik yuvarlak), VIP01–VIP04 (12 kişilik), sahne, bar, DJ kabini.
Guests: Ahmet Yılmaz +3 (VIP, davet eden Kerem Sarıçiçek, T05), Ayşe Demir +1 (T07), Mehmet Kaya +2, Zeynep Arslan
(VVIP, VIP01), Can Öztürk (T02), Elif Şen +1, Burak Şahin, Selin Ak +2 (junket: Kerem Sarıçiçek), Deniz Yurt +1,
Kerem Koç +2 (gelmedi), Hülya Keskin +1, Oya Ergin … invent ~40 more Turkish names; 312 arrived of 420 expected,
9 no-shows, 14 unseated; junkets: Kerem Sarıçiçek (38 kişi), Loyalty Desk (24), International Marketing (16).

## Deliverable (write only inside benchmarks/ux/redesign/<your-id>/)
- `index.html` — ONE self-contained clickable prototype (inline CSS/JS, no network): all 8 jobs reachable,
  real interactions where they explain the idea (check-in a row and show what changes; open the assistant;
  switch screens). Static data is fine.
- `shots/` — screenshots at 1440×900 and 1920×1080 of: home, overview, floor plan, seating, guests, live/door,
  reports, assistant open (Playwright, executablePath "/opt/pw-browsers/chromium"; serve with
  `python3 -m http.server <port> &` and stop it by its PID — never pkill by pattern).
- `NOTES.md` — ≤ 25 lines: the idea in one sentence, why it suits Merit, how it fixes "too many buttons" and
  "the screen jumps", contrast measurements, what it would cost to build, its risk.
Never touch src/, index.html, tests/ or anything outside your folder. Do not commit.
