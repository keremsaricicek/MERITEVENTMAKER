# Pushed-together tables, measured

Which tables form one dining unit is answered by one rule,
`buildFurnitureGroups` in `src/plan-intel-groups.js`: two tables are joined when
they **touch** (gap at most 0.28 of the smaller side) **and line up**. Nearness
alone never joins them. Until 2026-10-11 the rule had only been scored on the two
real plans, where every pushed-together row is axis-aligned. These measurements
score it on generated plans where the answer is known by construction.

## The data

`training/synth_relations.py` draws relation scenes in the training families
(`dev`) and in the blind families 14 and 15 (`blind`), clean and through the L6
scan degradation:

| scene | what it is | label |
|---|---|---|
| `merged` | 2–5 squares edge to edge, straight | one unit |
| `merged-rot` | the same row turned 15–60° | one unit |
| `merged-L` | a row and a leg meeting at a corner, edges touching | one unit |
| `parallel` | two pushed-together rows facing across an aisle wide enough for both rows' chairs | two units, never one |
| `aisle` | 2–4 tables in a line, 0.35–1.0 of a side of paper between them | separate (`separateNeighbours`) |
| `aisle-rot` | the same, turned | separate |

Touching is one unit and a visible aisle of at least 0.35 of a side is two
tables. Nothing in between is generated, because a person could not defend the
label either way. Generation 3's level plans (`synth_levels.py`) reserve free
space around every table, so they contain no separate-but-close tables. The
rule scores 260/261 there whatever it does with "close", and that set cannot
answer this question.

## The rule alone (oracle): `measure-groups.mjs`

The rule runs on the TRUE table boxes, written the way the detector writes a
table: percent of the sheet, the unrotated box around the centre, and the
rotation in (−45°, 45°]. A missed or invented table cannot move these numbers.

```
node benchmarks/relations/measure-groups.mjs --dir D/dev   [--rule FILE] [--out FILE]
node benchmarks/relations/measure-groups.mjs --dir D/blind
```

| set | rule | units exact | turned rows | L shapes | facing rows | close-but-separate merged |
|---|---|---|---|---|---|---|
| dev (42 plans) | before | 336 / 476 (0.706) | 36 / 93 | 54 / 99 | 150 / 188 | 0 / 670 |
| dev | after | **476 / 476 (1.000)** | 93 / 93 | 99 / 99 | 188 / 188 | **0 / 670** |
| blind (42 plans, scored once) | before | 280 / 418 (0.670) | 27 / 85 | 41 / 89 | 116 / 148 | 0 / 627 |
| blind | after | **418 / 418 (1.000)** | 85 / 85 | 89 / 89 | 148 / 148 | **0 / 627** |
| generation 3, val + held-out + blind (322 plans) | before = after | 260 / 261 | — | — | — | — |

**What was wrong.** The contact rule read a turned table's unrotated box as if it
were axis-aligned. A row pushed together at 30° became a diagonal of boxes whose
centres do not line up on either axis, so it was never joined. Straight rows
were always right, and close-but-separate tables were never merged, before or
after.

**The change.** Two tables turned alike (within 10°, square symmetry included)
are measured along their own shared axes: the same gap test and the same
alignment test, with the same 0.28 / 0.35 of a side. Plan percent is not square
(x is a share of the width, y of the height), so a turn is only measurable once
the plan's aspect is applied. `buildPlanIntelligence` passes
`imageWidth / imageHeight`. Unturned tables (both within 5°) and tables turned
differently are judged exactly as before. Suite: `relation-groups`.

The rule was frozen on dev before blind was scored. Blind was scored once.

## End to end: `measure-groups-e2e.mjs`

The real app analyses each relation plan: detection, OCR, the local detector and
plan intelligence. The dining units it **offers** are then scored. A true table
is matched to the nearest offered table within half its side. A unit is exact
only when every member was found and the offered unit is exactly those tables.

```
node benchmarks/relations/measure-groups-e2e.mjs --dir D/dev --out FILE [--root CHECKOUT]
```

Before and after are the same plans through two builds. `--root` serves a
worktree of the commit before the change. Measured 2026-10-11 with the pinned
OCR and the network refused:

| set | build | tables found | units exact | exact where every member was found | real over-merge | close-but-separate merged |
|---|---|--:|--:|--:|--:|--:|
| dev (42) | before | 2185 / 2283 | 258 / 476 (0.542) | 0.572 | 0 | 0 / 646 |
| dev | after | 2185 / 2283 | **389 / 476 (0.817)** | 0.863 | 0 | **0 / 646** |
| blind (42, scored once) | before | 1976 / 2144 | 247 / 418 (0.591) | 0.684 | 0 | 0 / 571 |
| blind | after | 1976 / 2144 | **360 / 418 (0.861)** | **0.997** | 0 | **0 / 571** |

What the end-to-end number still loses, by cause:

- **A member the detector did not find** (dev 25 units, blind 57). No grouping
  rule can join a table that was never offered. This is the detector's recall
  on turned and L-shaped furniture, and the place to work next.
- **Squares typed as round symbols** (dev: 47 units, all in two families). On
  bold-black (4 px outlines, white fill) and pastel-arch (1 px lines) the
  squares are found within 1 px and 3 px, but typed `round`. The rule never
  joins round symbols, by design (`plan-intel-groups.js`), so these rows stay
  apart. This is a table-type error in detection, not a grouping one.
- **A duplicate or fragment box joined into an otherwise right unit** (dev
  12 → 15, blind 0). Counted apart from a real over-merge, which is a table
  from outside the unit joined to it, and that stayed at 0 in every run.

Not measured here: sofas, benches and banquettes beside a pushed-together row
(a seat of the unit only when its cushions are divided). The generator draws
them on the level plans, but this scorer reads tables only.

## 2026-10-17 — the squares typed round, fixed at their cause

`node benchmarks/detection/diagnose-types.mjs FILES` (new) runs the real app and
reports, for every annotated table, the type it got and the evidence that
decided it. On the bold-black and pastel-arch scenes all 195 mistyped squares
had one basis: *member of the plan's single uniform object family, on a drawing
that shows no seating*. Those drawings DO show seating — solid black squares and
outlined half-discs — but the chair-first path does not find either kind (0 of
169 chairs on `rel-bold-black-7000032`), takes the table cells for the plan's one
repeated symbol, and the representation verdict calls the sheet SYMBOLIC. The
promotion then typed every member `round` unconditionally.

**Change** (`src/plan-detection-verdict.js`, `src/plan-detection-tables.js`): a
promoted member is typed from its own filled outline
(`MeritPlanShape.classifyTableShape`, the reading every other table gets), with
`typeBasis` saying so; a member the shape pass never measured keeps the old
`round` and says `family-default-round`. The intermediate reading is removed
before the analysis is stored. Suite `symbolic-plan-shape` (mutation-checked:
reverting the verdict turns it red, 36 squares → round); `symbolic-plan-detection`
now also asserts ORNEK-style rings stay round.

**Effect.** On the 28 regression, adversarial and robustness plans the analysis
is identical to `d66984a` apart from ids, timings and the new `typeBasis` field
(full dumps compared). Relation scenes, dev set (used during development, so this
is development evidence, not blind):

| dev (42 plans) | units exact | exact where every member was found | real over-merge | close-but-separate merged |
|---|--:|--:|--:|--:|
| 2026-10-11 | 389 / 476 (0.817) | 0.863 | 0 | 0 / 646 |
| 2026-10-17 | **422 / 476 (0.887)** | **0.936** | 0 | 0 / 646 |

Still open, and NOT fixed by this: on those two families the drawn chairs are not
found at all (solid squares, half-discs), so the verdict is wrong even where the
type is now right; a member the detector did not find (25 units); a duplicate or
fragment joined into a right unit (19).

## 2026-10-17 — the solid seats found, and with them the drawing's kind (D12)

**Cause** (`benchmarks/detection/diagnose-types.mjs`, now with `pipeline`
diagnostics). On `rel-bold-black-7000032` the chair stage's largest source was
`outline-interior` — 74 components, which are the 74 table cells' interiors —
and the 171 solid black seats were in the fill mask's components, which no
chair source offers on an ink plan. The "seats" sat at nothing, the verdict
said SYMBOLIC, and its other-polarity rule promoted 29 black seats to TABLES.
`rel-pastel-arch-7000043` was the same with half-discs, and once the drawing was
read as physical a second cause showed: a half-disc beside a table set at 45°
has a square axis-aligned box (elongation 1.0 against its family's 2.0), was
refused by the seat-shape test, and its seatless table was then deleted by text
suppression (3 tables, 6 seats).

**Change** (`src/plan-detection-chairs.js`):
1. Where the reference "seat" population is at table scale (the condition
   `referenceIsSeatSized` already names), the stage asks whether a smaller
   population SERVES it: each candidate outside a reference member, within 0.7
   of its own long side, smaller in every direction; "most" (0.7) of the members
   served; a median of at least two per member; and those seats on more than one
   side (the length of the mean of their unit directions ≤ 0.5). Thresholds fixed
   before measuring, each from a rule the file already states. If so the
   reference members leave the chair sources (they are still table sources) and
   the serving population becomes the primary chair source. Diagnostics:
   `secondaryChairFamilies.servedSeats`, with every quantity, accepted or not.
2. A seat also passes the shape test on its OWN oriented box. This only ever
   adds a seat; the size test is unchanged.

Suite `served-seats` (three drawings built in the test; each rule
mutation-checked — inversion off, surround rule off, oriented box off — and each
turns it red). Its control is the cost, stated: marks on ONE side of every table
are refused, so a table seated along one side only is not recognised by this
rule either.

**Effect.** Both D12 plans: `rel-bold-black-7000032` chairs 0/169 → 168/0/1,
tables 74/74 with 29 → 0 false; `rel-pastel-arch-7000043` chairs 0/123 → 123/0/0,
tables 52/52. On the 28 regression, adversarial and robustness plans the
analysis is identical to the previous commit apart from the new diagnostic
(full dumps compared): the rule fires on none of them. Relation scenes, dev set
(42 plans, development evidence), previous commit → this one, same machine:

| dev (42 plans) | units exact | exact where every member was found | table recall | duplicate joined | real over-merge | close-but-separate merged |
|---|--:|--:|--:|--:|--:|--:|
| `442d6eb` | 427 / 476 (0.897) | 0.945 | 0.959 | 22 | 0 | 0 / 646 |
| this commit | **436 / 476 (0.916)** | **0.960** | 0.962 | 15 | 0 | 0 / 649 |
