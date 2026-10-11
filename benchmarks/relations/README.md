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
