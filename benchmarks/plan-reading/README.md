# Plan reading — the plan, read back like a person would

**Floor Plan → Review → Read the plan / Planı oku.** Offline, from what the
analysis already found. No model and no network: `src/plan-reading.js`
(`MeritPlanReading`, pure) writes the reading and `src/screen-reading.js` shows
it.

## What it says

| part | example (Golden Plan) | example (ORNEK) |
|---|---|---|
| first lines | "A dinner layout with drawn chairs: 46 tables, pushed together in 13 places into long tables, 109 chairs. The plan itself says 124 people." · "The stage is at the bottom right of the sheet." | "SILA · 29.08.2026 · Haluk Elver Salonu 1/2/3" · "A numbered-symbol plan: 163 tables found, chairs not drawn. The plan itself says 2064 people." |
| capacity | printed 124 vs 109 chairs counted: the 15-person gap is pinned on the 3 banquettes and the held-back table | "166 × 12 = 1992", "2064 in total", "72 for the boxes over 12 boxes = 6 per box" (worked out) |
| stage | bottom right, ~32% of the width, named by the printed "SAHNE"; 8 tables right in front of it | no stage named: the block in the middle with tables on three sides **may** be the stage — a question, never a fact |
| tables | 13 pushed-together groups, each with its seats ("4 tables pushed into one, 10 seats") | 145 of 163 numbers read and checked, 18 still open (asked, never guessed) |
| room | 9 columns on the walls; 1 may hide a table from the stage (no heights on the drawing); bar top left; two entrances | 4 service points and "SYSTEM KONTROL" written on the plan; 4 wall elements |
| words | each of the 9 words: what it named or why it was not used | 27 words + 203 numbers: title, venue, capacity lines and labels, the box list as a **legend**, service, technical |
| not sure | 3 held-back objects, 3 disagreements | 4 held-back objects, 2 disagreements |

Every line:

- carries the objects or printed words it stands on: press it and they are
  marked and zoomed to;
- says how it is known. The labels are **You confirmed**, **Remembered**,
  **On the plan**, **Seen**, **Worked out** and **Check**. A person's decision
  outranks the drawing. A decision that came back from plan memory on a new
  analysis says "Remembered".

Each part of the room can also be read on its own: a zone, or a third of an
undivided room.

**Digital** redraws the plan from what was understood, and **Both** lays that
over the scan. It draws:

- tables, chairs, the stage, columns, banquettes, boxes, the bar and entrances;
- pushed-together tables as the one table they are, with their seats;
- the numbers that were read;
- the words that are places (service, technical), the title and the capacity
  lines;
- a possible stage as "STAGE ?".

Teach it ("this block is the stage") and it is drawn as the stage and read back
as yours.

Close-ups, scan / digital / both: `screens/digital-tables-golden.png` and
`screens/digital-tables-ornek.png`. Each chair is drawn on the chair the
analysis found. Before 2026-10-11 every chair was drawn half its own size off
the scan, because a chair detection's x/y is its centre and it was read as a
corner; `plan-reading` now checks where every chair lands. The ORNEK close-up
also shows what is still missing. Table 73 was not found, and 72's number was
not read, so its circle is drawn blank. Nothing is invented to fill either gap.

## Measured

`node benchmarks/plan-reading/measure-structure.mjs` (real detector, pinned OCR,
network refused). It compares against `golden-structure.json`, whose labels are
**model-assisted (read off the image by the assistant), not human-verified**.

| | result |
|---|---|
| columns (11 labelled) | 9 found, 9 right — precision **1.0**, recall **0.82** (the two missed are the two labels marked uncertain) |
| pushed-together tables (12 labelled, 1 ambiguous pair excluded) | 12 found, 12 right — precision **1.0**, recall **1.0** |
| seats per pushed-together table | **12 / 12** exact |
| stage | found, IoU **0.76** with the labelled box |

Reading the plan takes about 6–9 ms. Time and memory on two CPU cores are in
`benchmarks/hardware/`.

## What it does not do

- It finds nothing new. A missed table is missing from the reading too, and a
  phantom table is in it until a person rejects it.
- It assumes no scale and no north. Positions are plan-relative thirds;
  measurements printed on the plan are kept as text.
- "May block the view" is geometry with unknown heights, so it stays worded as
  "may".
- Two venues are not a distribution. The categories of words and the
  "possible stage" rule are generic, but they are only proven on these two
  plans. They are checked again on each new venue (`../plan-understanding/NEW-VENUES.md`).

Suites: `plan-reading` (fast, 24 checks, mutation-checked), `plan-reading-ornek`
(slow, 11 checks, real OCR), `a11y-scan` (the panel and the digital view, both
languages). Screens: `screens/` (1920 / 2560 / 1440, TR and EN).
