# MERIT EVENT MAKER — design direction v4 (owner, 2026-11-07, after the review page + multiple-choice answers)

**Theme = Atlas's look, made elegant and calm; layout = combined v3's simplicity.** Users are hotel/casino staff, NOT
architects: NO grid/squares, NO rulers or coordinates (A–H, 1–12), NO scale bars, NO "paftalar/A-01" sheet metaphors,
NO world-map/atlas devices, NO decorative animation. Few words, few boxes, balanced information, readable sizes.
Focus stays on the job of the screen. Tools sit where the hand looks for them ("insan aramasın, bulsun").

- **Top menu:** "otel tabelası" — MERIT mark left, small-caps words with thin vertical separators, no icons. Right
  side: event name · clock · theme · **"Mimar"** (the assistant's name). Not generic/AI-looking.
- **Mimar (F8):** clicking "Mimar" (or F8) opens a bottom-right chat box like classic Facebook chat (title bar
  "Mimar" · – · ×), message bubbles, typing field, a microphone button (voice = later stage, shown disabled/"yakında").
  An action ("Ahmet'i T05'e oturt") is SHOWN first (sentence + the table highlighted on the plan) → **Uygula** → done
  with **Geri al**. Stays open across screens.
- **Etkinlikler:** Atlas timeline with each venue's small plan thumbnail (keep those exactly), "Bugün" line, past left
  (read-only) / upcoming right; simplify everything around; tools (Yeni etkinlik, aç, aynı yerleşimle yeni, çoğalt,
  dışa aktar, sil) visible where expected, not hidden behind "İşlemler…" text links.
- **Hazır mı? (overview):** Kontrol masası layout — plan left, open issues right; hovering/selecting an issue draws a
  thin line to its place on the plan; "Git".
- **Salon:** Atlas table drawing (elegant round/rect tables, real chairs) without grid/rulers; click a table → it opens
  (zooms/focuses) with names by the chairs, and a calm right panel lists that table's people. Default view quiet.
- **Misafirler:** combined v1/v2 plain list; click a row → right panel with that guest's details and actions.
- **Oturma:** Atlas theme + combined v3 simplicity (unseated list | room; drag or click).
- **Kapı:** guest list = 1/4 of the width, room = 3/4; big search, Giriş right, Gelmedi away from it, Geri al.
- **Raporlar:** full-size live preview of the document + a designer panel (1/3 of the screen): choose & order columns,
  filters (person name, group/junket, table no., VIP, arrived/no-show…), title/logo/paper (A4/A3, portrait/landscape,
  font size), save as template.
- **Themes:** light first. Dark = classic night (deep navy/graphite, ivory text, champagne restraint, no neon).
  Later the same pages ship in 4–5 selectable themes; build this main theme first.

## The working order (owner, 2026-11-07) — both themes A and B
1. **Yeni etkinlik → boş şablon** (name, date, venue; nothing else; a blank event is blank).
2. **Salon:** drop/upload the plan image (or PDF) → an analysis screen with a clear **"Analiz et"** button (Assisted
   Detection; suggestions accepted/rejected one by one) → or draw by hand: add round/rect tables, chairs, stage, bar.
3. **Misafirler:** import Excel / paste a list / add by hand; the list then offers **suggestions to tidy it**
   (duplicates, "+N" parsing, missing host, VIP marks) — each accepted or ignored.
4. **Oturma:** place guests (drag/click, groups together, "Taslak yerleşim").
5. **"Hazır"** (button on Oturma): opens Hazır mı? (open issues, line to the place, "Git"); when nothing blocks, the
   room turns into the **settled plan** (yerleşmiş plan: quiet, read-mostly, edits still possible via ⋯).
6. **Kapı** → 7. **Raporlar.**
Steps on screen (decided by Claude per owner "sana bıraktım: şık, sade, kullanışlı, elit"): the top menu IS the
order — Etkinlik · Salon · Misafirler · Oturma · Kapı · Raporlar; a finished step carries a thin ✓, the next step
is the emphasised word; each screen has one quiet "Sonraki: Misafirler →" at the bottom right. No wizard, no stepper bar.
