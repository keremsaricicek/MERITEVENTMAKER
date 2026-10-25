# AI Planner window — design (2026-10-25, owner's brief; build after B6b / 2B / package)

The owner types or says what he needs ("150 m² salon, 100 kişilik toplantı, elimde
10–12 masa var, masalar 180 cm yuvarlak, sandalye 45×50") and gets an editable,
correct floor plan. Offline, free, on his computer.

## 1. Principles (non-negotiable)
- **The model understands, the code draws.** The language model only turns the
  brief into numbers (a structured brief). Every table, chair, distance and total
  is computed by the app's own layout code, so the numbers always add up.
- **Nothing invented.** A missing or contradictory figure is asked back (at most
  two short questions), never guessed silently. Defaults are shown as defaults.
- **Everything editable, everything undoable.** The result is a normal floor plan;
  one undo takes the whole generated layout back.
- **Offline.** Text parsing and voice run on the computer; no plan or guest data
  leaves it; no paid service.
- **Honest limits.** Fire-code and venue rules differ by place: the planner uses
  conservative defaults and says "check with the venue", never "legal".

## 2. The flow (what the owner sees)
1. A side window "Yapay zeka planlayıcı" with one input line and a mic button.
2. He writes/speaks the brief.
3. **"Anladıklarım" card**: the brief as chips he can tap to change — salon
   150 m² · etkinlik toplantı (banket) · 100 kişi · masa 12 × Ø180 · sandalye 45×50 ·
   koridor 1,2 m (varsayılan).
4. If something is missing or impossible, one short question
   ("12 masa × 8 kişi = 96; 100 kişi için 13 masa ya da masa başı 9 kişi?").
5. **2–3 options** as cards with a mini preview: capacity, people per table,
   m² per person, walkway widths, what did not fit and why.
6. "Uygula" → the plan appears on the Floor Plan, selectable and editable;
   "Geri al" takes it back. Follow-ups work in the same window ("sahneyi kuzeye al",
   "kalan yeri 2 kişilik bistrolarla doldur").

## 3. The structured brief (what the model must produce)
```
room:      { width_m, length_m | area_m2, shape: rect|L|drawn, noGo:[...], entrances:[...], stage?, bar?, screen? }
event:     { type: banquet|gala|theatre|classroom|boardroom|u_shape|cocktail|mixed, pax, stageFacing? }
inventory: [ { kind: round|rect|square|bistro|cocktail, size: {diameter_m | length_m,width_m}, count, seatsMax? } ]
chair:     { width_m, depth_m }
rules:     { mainAisle_m, aisle_m, tableGap_m, stageGap_m, accessible? }
prefs:     { homogeneous, fillRemainderWith?, vipNearStage?, keepCentreFree? }
```
Validated against a fixed schema; the model's output is constrained to it
(llama.cpp JSON grammar), so it can only answer in this shape.

## 4. Domain knowledge (defaults, all editable)
| Layout | Space per person (typical) | Notes |
|---|---|---|
| Theatre | 0.6–0.8 m² | rows facing stage, centre/side aisles |
| Classroom | 1.2–1.6 m² | tables in rows, 2–3 per table |
| Banquet (round) | 1.2–1.5 m² | Ø150 → 8, Ø180 → 10, Ø200 → 12 |
| Boardroom / U | 2.0–3.0 m² | one block / open U toward screen |
| Cocktail | 0.5–0.9 m² | high tables, standing |
Clearances: main aisle ≥ 1.2 m, between tables ≥ 0.9 m chair-to-chair, chair
depth + push-back ≈ 0.45–0.6 m, stage front ≥ 1.5 m. Terms understood (TR/EN):
pax, kişi, banket, gala, tiyatro, sınıf, U düzeni, toplantı masası, kokteyl,
bistro, loca, sahne, fuaye, giriş, bar, VIP, koridor.

## 5. Layout engine (the code)
- Free area = room − no-go zones − stage/bar/entrance clearances.
- Per layout type a generator: rounds on a staggered (hex) or square grid; rows
  for theatre/classroom; U and boardroom blocks; cocktail scatter with walkways.
- Fit: the largest homogeneous arrangement that respects clearances; the rest
  filled as asked (e.g. 2-seat bistros); people per table balanced.
- **Feasibility check** before drawing: capacity vs pax vs inventory vs area,
  with the arithmetic shown ("150 m² / 100 kişi = 1.5 m²/kişi: banket için sınırda").
- Score each option: capacity match, clearances, sight lines to stage, walkway
  continuity; show the 2–3 best that differ meaningfully.
- Chairs the planner places are real placed chairs (Floor Plan rules: capacity
  and chairs stay in sync through the existing writers).

## 6. Language and voice models
- Parsing: the same local Qwen3.5 (0.8B or 2B) text-only, Turkish, schema-
  constrained; a rule parser catches the common phrasings first (fast, exact).
- Voice: an offline speech-to-text model (Whisper-small class, ≈250 MB),
  Turkish; measured before it ships.

## 7. Measured before it ships (pre-registered when building starts)
- 100+ Turkish/English briefs written in advance (varied, with typos and slang):
  brief fields extracted correctly ≥ 95 %, contradictions caught 100 %.
- Every generated layout: no overlaps, clearances met, totals exact (100 %).
- Voice: word error on a recorded Turkish brief set reported; the owner's own test.

## 8. UI (UI constitution: warm palette, calm, canvas first)
Side panel, never covering the canvas; chips not forms; option cards with
mini-previews; keyboard and screen-reader usable; TR/EN; the progress bar
while generating; every message short.

## 9. Order and estimate
| Step | What | Estimate |
|---|---|---|
| 1 | Brief schema, feasibility check, layout engine (banquet, theatre, classroom, U, boardroom, cocktail) | 2 days |
| 2 | Parser (rules + local model) and the window UI | 2 days |
| 3 | Offline voice | 1 day |
| 4 | Measurement, polish, both offline builds, CI | 1 day |
