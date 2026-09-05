# ORNEK.pdf — real plan #2, and what it actually is

## Provenance

Brought into this branch as a single file, by blob SHA, with no merge of the
branch it came from.

| | |
|---|---|
| source branch | `origin/claude/ui-ux-design-analysis-so5za5` |
| git blob SHA | `702d15a433ba94d57ff96cbfe1b37ae6a95f073c` |
| size | 928,339 bytes |
| content sha256 | `d576b4172120eddb0d4af0f5a8f69ef07c2d86afccb4b0a5b190f05b0de9ba29` |
| verified | `git hash-object` on the extracted file round-trips to the same blob SHA |

## What the PDF contains — measured, not assumed

```
/Font        0
/FontFile    0
/Subtype /Image  1     (/DCTDecode, 1719 x 2402, 8bpc)
/Type /Page  1         (MediaBox [0 0 1719 2402], /Rotate 0)
```

> **There is no native text and no vector geometry. The file is a single JPEG
> photograph wrapped in a PDF.**

That answers the "native text/vector first?" question before any code was
written for it: there is nothing to parse. A vector parser would have been
built for a document that has no vectors. Local rasterisation is the only path,
and the app's existing pdf.js import already does exactly that.

## What the photograph is

Not a clean export. A **photographed printout**, and every degradation is real:

- rotated 90° — the page is stored portrait, the plan reads landscape
- a **fold line** down the middle of the sheet, visible as a tone step
- **shadow and slight perspective** from the camera
- paper texture through the whole image

## What it draws — a different plan language from the Golden Plan

| | Golden Plan | ORNEK |
|---|---|---|
| representation | physical furniture | **symbolic / numbered** |
| tables | drawn shapes with real footprints | numbered circles |
| chairs | **113 individually drawn** | **none drawn at all** |
| capacity | counted from drawn chairs | **printed as a rule** |

Printed on the drawing:

```
Haluk Elver Salonu 1/2/3          SILA  29.08.2026

SALON     : 166 * 12 : 1992 PAX
LOCALAR   :  72      PAX
TOPLAM    : 2064 PAX
```

Plus operational furniture the Golden Plan has none of: four `servant` bars, a
`SYSTEM KONTROL` block with directional arrows, a `LOCA` strip of numbered boxes
along one side, and a `Loca 1 … Loca 9B` index list.

**This is why it is worth having.** It is not a second copy of the same problem.
Everything the product learned on one drawing — that chairs are drawn, that
capacity is counted, that a table is a shape — is a belief this document does not
share.

These printed values are ground truth for the benchmark. They are **never**
production constants: nothing may branch on this file's name or hash.
