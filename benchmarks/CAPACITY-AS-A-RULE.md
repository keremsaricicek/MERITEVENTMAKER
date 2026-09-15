# Capacity the drawing states, not capacity you count

Some plans do not leave their capacity to be counted. ORNEK prints the
arithmetic:

```
SALON    : 166 * 12 : 1992 PAX
LOCALAR  :  72      PAX
TOPLAM   : 2064     PAX
```

That says three things a seat count can never say: how many tables the room
has, how many people sit at one, and what the figures add up to. On a drawing
with no seats drawn anywhere, it is the **only** capacity there is.

It also gives the detector something to be measured against. "132 tables were
found" is a number. "The drawing states 166 tables; 132 were found; 34 are not
accounted for" is a job.

## What the operator now sees

```
[likely]  The drawing states its own capacity as a rule: 166 tables at
          12 pax each, 1992 seats, plus 72 elsewhere for 2064 in total.
[strong]  The drawing states 166 tables; 132 were found. 34 are not
          accounted for.
```

and what has **stopped** appearing, because it was never a finding:

```
[strong]  The plan states 2064 pax but 0 seats were counted — a difference
          of 2064.                                            ← withdrawn
```

Comparing a printed pax figure against a seat count only means something on a
plan that draws seats. On a symbolic one it reads like a discovery and is
really a restatement of what kind of drawing it is. The CAPACITY contradiction
was built from that fact and stands down with it.

## Reading it through OCR that cannot hold punctuation

This is a photographed printout, and Tesseract returned **two different
readings of the same line on consecutive runs**:

```
run 1   SALON 1166 * 12: 1992 PAX      the colon before 166 became a 1
run 2   SALON 1166 * 121992 PAX        and then vanished, fusing 12 and 1992
```

Neither reading multiplies out. `1166 x 12` is 13992, not 1992.

**The parser is not allowed to repair characters.** Guessing what a glyph
"should" have been is exactly how OCR output turns into fiction. So two other
things decide instead:

1. **The arithmetic is the validator.** A triple is only a capacity rule if
   the multiplication actually comes out. Three unrelated numbers near a `*`
   will not divide exactly.
2. **The page corroborates itself.** The drawing separately prints
   `TOPLAM 2064` and `LOCALAR 72`, so the seating figure should be 1992. Of
   every way to split the fused run `121992`, only `12 | 1992` both divides
   *and* matches a figure read independently elsewhere on the sheet.

`1992 / 12 = 166` exactly, so the count is **derived** and recorded as derived,
with the 1166 that OCR actually read kept beside it. Nothing is claimed for
that token.

The corroboration requirement is what keeps this honest rather than lucky:

| input | result |
|---|---|
| `SALON : 166 * 12 : 1992 PAX` (clean) | 166 x 12 = 1992, **read** |
| `1166 * 12: 1992` + printed totals | 166 x 12 = 1992, **derived** |
| `1166 * 121992` + printed totals | 166 x 12 = 1992, **derived** |
| `1166 * 121992`, nothing to check against | **null** — no claim |
| `the room holds 12 * 7 tables and about 900 chairs` | **null** |

Some split of a long digit run will always divide. Without a figure elsewhere
on the page agreeing with the product, the parser refuses.

Nothing here keys on this plan, its name or its hash. The pattern is "a
multiplication and its result, agreeing with what the page says elsewhere".

## The bug this work uncovered

Turning OCR on for the first time on this plan took table detection from
**132 to 15**.

`suppressTextFalsePositives` drops a candidate more than 40% covered by OCR
word boxes — *unless it has chairs at it*. That exemption is sound on a plan
that draws chairs. On a plan whose tables are numbered circles it is
unavailable by construction: no table has a chair, every table has a number
printed inside it, and OCR of a photographed printout throws big sloppy word
boxes across whole rows. The rule deleted 117 of 132 tables.

It is the same failure as the representation bug, one layer down: a rule that
quietly assumes the plan draws furniture.

The fix is the evidence that made them tables in the first place — a candidate
that is one of a hundred-odd identical, regularly spaced symbols is not printed
text, whatever overlaps it.

### Why nothing caught it

**No benchmark in this repository can reach that code path.** This sandbox has
no network, so the normal build silently has no OCR, and every ORNEK number
measured so far was measured on the no-OCR path. The offline package — the one
that actually ships Tesseract, and the one a real operator would run — was the
broken one.

`tests/suites/symbolic-plan-capacity.test.mjs` now pins both fixes directly, as
pure functions, so neither depends on a benchmark being able to run OCR.
