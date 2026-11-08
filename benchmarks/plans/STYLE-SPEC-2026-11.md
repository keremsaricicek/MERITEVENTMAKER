# The owner's two plan styles — style specification (2026-11-08)

Written from the three real plans in this repository, looked at once each and
measured with a pixel script (colour quantisation at 24 levels, stroke run
lengths along every 7th row/column). This file describes a **look**, never a
layout: no position, count, arrangement or text block below may be copied into
a generator. All three plans are **SEEN** — Golden and ORNEK are the regression
set, Golden 2's blind exam was taken on 2026-10-31 — so nothing scored on them
after this file may be called blind or unseen.

| | Golden (`merit-real-venue-plan.png`) | Golden 2 (`blind/golden2.pdf`) | ORNEK (`ORNEK.pdf`) |
|---|---|---|---|
| style | **G — office graphic** | **G — office graphic, scanned** | **P — printed symbols, photographed ("PDF style")** |
| raster | 1355 × 788 PNG export, dark frame | A4 page, Epson 200 dpi JPEG, 1654 × 2338, drawing turned 90° | one JPEG photo in a PDF, 1719 × 2402 stored portrait, plan reads landscape |
| background | white 56 %, light grey wall bands 6 % | white 82 % | white 72 %, paper grey 13 % |

## Style G — office graphic (Golden, Golden 2)

**Lines.** Thin outlines, 1–2 px at export / 200 dpi (stroke runs: median 1 px,
p75 2 px on Golden 2). Colour blue-grey on Golden (≈ 84,156,204), clearer blue
on Golden 2 (≈ 108,180,252). Walls: a thin double line with light-grey (Golden)
or white (Golden 2) **piers** — small rectangles along the wall every
~10–12 % of the length; one corner may be cut diagonally (Golden 2 top right).

**Tables.**
- *Square:* beige/parchment fill with a fine texture (≈ 228,228,180 → 252,228,180),
  thin outline, a **green centre dot** (light green disc, dark green ring) — the
  dot is the one constant table mark of this style. Side ≈ 3.3 % of the plan's
  long side on Golden (median 45 × 43 px).
- Squares stand **touching in rows of 2–5** (one long table built from squares)
  or in pairs; a **long table** is one rectangle with **two dots** (Golden 2).
- *Round:* wood/cream disc (≈ 228,204,150 → 236,212,178), centre dot, diameter
  ≈ 1.6–2× a square side.
- *Bistro:* small square or disc against a wall, two chairs, no dot on some.

**Chairs.** *Armchairs* for squares: orange (≈ 228,132,60 on Golden; 252,132,84
on Golden 2) seen from above — back, two arms, seat — about 0.75 of a square
side, one per table side, backs away from the table, often **touching each
other** in a row. *Petal chairs* for rounds: 5–6 light grey or cream shells
(Golden 2: cream seat, light-blue back), set radially, partly hidden under the
top. **Banquettes/sofas:** long orange rounded rectangles on one side of a pair
or row. Chairs are counted per table from the drawing; no capacity number is
printed per table.

**Numbers.** **None.** Neither Golden plan prints a table number. A generator of
this style must produce plans with no numbers as the common case (a number
reader must answer "none" here, never invent one) and may add numbers only as a
variant.

**Labels and venue objects.**
- Word-art labels: **outlined hollow letters**, orange outline, white/very light
  fill (GIRIS, BAR) — often faint after scanning (Golden 2's GIRIS is pale salmon).
  Turned 90° with the wall they stand on.
- Capacity block in bold orange word-art ("114 pax seating / 10 pax bistro /
  Total : 124 pax") — a number that is NOT a table number.
- **Stage:** a large white rectangle at one end with blue side blocks (speaker or
  screen boxes), a **truss** — a thick blue bar with blue discs and a blue X at each
  end — a small blue box at the front edge; the word SAHNE in plain small dark
  text inside; **dimension texts** "8 m", "3,10 m" inside. No dance floor drawn.
- **Bar:** a long white counter with inner rectangles (sinks/shelves) and a
  small blue element; label BAR in word-art.
- **Entrance:** a gap in the wall, a door swing arc (Golden 2), word-art GIRIS
  nearby; never an arrow.
- Clutter: a planter box (dark outlined rectangle edged with green shrub
  circles), wall piers, the capacity block.

**Artefacts.** Golden: clean export, dark border around the sheet. Golden 2:
scanner — paper speckles, a few dark dots, faint JPEG ringing, very slight skew,
light colours washed out (dark pixels < 100 grey: 0.08 %), drawing turned 90° on
an A4 page with wide white margins.

## Style P — printed symbols, photographed (ORNEK, the "PDF style")

**Lines.** Dark grey outlines, 1–3 px at 2402 px; paper is not white (≈ 238
mean); the hall outline is a single dark line with grey **wall blocks** at the
sides.

**Tables.** Only **round symbols**: light grey discs (≈ 204–228) with a fine
**dotted halftone** texture, thin dark ring, diameter ≈ 3.2 % of the long side
(78 px). Some discs are **dark grey/black** (filled) — their number is printed in
dark on dark and cannot be read (9 of 166). Rows are slightly wavy (hand placed),
spacing ≈ 1.3–1.4 diameters; a dense block of 150+ tables.

**Chairs.** **None drawn.** Capacity is a printed rule ("SALON : 166 * 12 :
1992 PAX") — every table seats 12 by the legend, not by any drawn chair. A
chair reader must say the drawing shows no chairs; capacity comes from the
printed rule (a person confirms it).

**Numbers.** Sans-serif digits centred in the disc, height ≈ 0.22 of the disc.
1–2 digits on one line; **3-digit numbers split on two lines** ("10" over "0" =
100, "15" over "6" = 156) — the main reading trap. Order: row-major, left to
right, the left block of a row first then the right block across a central
feature (1–5 left, 6–10 right), later rows run across the whole width;
**out-of-sequence inserts** (155–157 sit between 98 and 108). Numbers on the
dark discs are lost.

**Labels and venue objects.**
- **Runway / podium:** a T made of two dotted rectangles in the centre (a catwalk
  joining a stage), no word on it.
- **SYSTEM KONTROL:** a labelled box at the bottom centre between two big
  **outlined arrows** pointing up (the arrows mark the entrance/aisle direction).
- **servant** boxes: dark grey filled rectangles with white words, on the hall
  outline (service points — not tables).
- **LOCA:** a row of rounded boxes along the bottom edge, faint white labels
  (1, 2, 3A, 3B … 9B), the word LOCA under them, and a **legend list**
  ("Loca 1 … Loca 9B") in a ruled column outside the hall.
- Title box ("SILA 29.08.2026"), hall name box, capacity box with three ruled
  lines of numbers — numbers that are NOT table numbers.

**Artefacts.** A photographed printout: perspective (top edge bows), a **fold
line** across the middle (tone step), paper texture and shadow at the edges,
uneven light, JPEG; stored turned 90° in the PDF.

## What the generator must vary (and why)

| axis | G | P | why it matters |
|---|---|---|---|
| page turn | 0/90/180/270 | 0/90/270 | Golden 2 and ORNEK are both stored turned |
| capture | export / 200 dpi scan / phone photo | photo (perspective, fold, shadow, blur) / flat PDF | each real plan is a different capture |
| density | 10–60 tables, touching chairs | 40–220 discs, 1.2–1.6 Ø pitch | ORNEK density, Golden touching chairs |
| merged | 2–5 squares touching, long table with 2 dots | — | Golden's rows |
| numbers | none (default) / printed variant | 1–3 digits, 2-line 3-digit, inserts, prefixes, unreadable dark discs | P's traps; G must answer "none" |
| zones | stage + truss, bar counter, entrance gap/arc, word-art labels | runway T, control box + arrows, servant, loca row + legend | holistic reading |
| new zones (variants) | dance floor (parquet), VIP area (dashed/roped, "VIP"), aisles | same | owner's list; neither real plan draws a dance floor or VIP area |
| clutter | planter box, piers, capacity block, dimension texts | title/capacity boxes, legend | phantom sources |
| other layouts | theatre rows (chairs only), cocktail (bistro, no chairs) | theatre rows | unseen-variant performance |
