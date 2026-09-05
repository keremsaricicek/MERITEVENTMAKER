# Two real plan families — sprint report

**Goal:** make MERIT EVENT MAKER prove it can understand two genuinely
different real seating-plan families without breaking the first one.

```
REAL DISTINCT VENUE PLANS: 2
CROSS-VENUE GENERALIZATION: NOT VERIFIED
REAL HUMAN OPERATOR USABILITY: NOT VERIFIED
```

Two documents is not a distribution. Everything below is a result demonstrated
on two plans and four synthetic fixtures built by this repository, and nothing
broader is claimed.

---

## The headline

| | before | after |
|---|---|---|
| ORNEK tables — precision | 0 | **1.000** |
| ORNEK tables — recall | 0 | **0.795** |
| ORNEK tables — F1 | 0 | **0.886** |
| chairs invented on a plan that draws none | 143 | **0** |
| architecture returned as a table | 9 of 10 | **0** |
| capacity | "2064 stated vs 0 counted" | **"166 tables at 12 pax = 1992, +72 = 2064"** |
| — and | — | **"166 stated, 132 found, 34 unaccounted for"** |
| merit-real-venue, every guarded field | — | **unchanged** |
| 4 adversarial fixtures | — | **unchanged, 0 regressions** |

Plan #1 did not move on any guarded field. That was the constraint, and it held
through every change.

---

## What ORNEK actually is

`ORNEK.pdf` contains **no text and no vector geometry** — one `/DCTDecode`
image and nothing else. It is a photographed printout in a PDF wrapper:
rotated 90°, with a fold down the sheet, camera shadow and paper texture.

It speaks a different plan language from the Golden Plan:

| | merit-real-venue | ornek-symbolic |
|---|---|---|
| tables | shapes with a footprint | identical numbered circles |
| chairs | **113 drawn individually** | **none drawn at all** |
| capacity | countable from drawn seats | **printed as a rule** |

## Ground Truth #2

Frozen and committed **before any measurement was taken against it**.

- **166 tables**, each confirmed in a zoomed crop
- **157 printed numbers**, read by eye — they form 1..157 with no gap and no
  duplicate
- **9 dark-filled tables** whose printing is not legible even under local
  contrast stretching at 8×, recorded as unknown rather than guessed
- **0 chairs** — the plan's own content, not a gap in the annotation
- 19 regions, each marked measured or approximate

157 + 9 = 166 is independently what the sheet prints (`SALON : 166`). That
agreement is recorded as corroboration; it was not the source of the count.

Proposals came from an independent finder that shares no code with the detector
under test — a detector that proposes its own ground truth measures itself.

## The first held-out run, and why the score was the wrong headline

```
TABLES  gt=166 det=10 TP=0 FP=10 FN=166   P=0 R=0 F1=0
CHAIRS  annotated=0   detected=143
```

A zero hides which of two opposite failures happened, so it was not accepted as
the answer. `ornek-diagnose.mjs` asked where every candidate actually landed:

> The detector **found 132 of the 166 tables, centred to 3px median, at the
> right size — and classified every one of them as a chair.** The ten objects it
> returned as tables were, ten for ten, the plan's architecture.

Never a detection failure. A naming failure, downstream of one assumption.

---

## Three bugs, all the same shape

Each is a rule that quietly assumes the plan draws furniture. Each was invisible
until a second real plan arrived.

### 1. Object class inferred from size rank

The chair-first path decides what an object *is* from how it ranks in size
against its neighbours. On a symbolic plan every object is the same size and
nothing is larger, so the reasoning inverts.

Fixed by testing the hypothesis against its own result: a drawn chair sits at a
table, so the share of "chairs" that found one tests whether they are chairs at
all.

| plan | repeated objects | at a table | rate |
|---|---|---|---|
| adversarial ×4 | 72–80 | 72–80 | 0.950 – 1.000 |
| merit-real-venue | 112 | 108 | 0.964 |
| **ornek-symbolic** | 143 | 11 | **0.077** |

Nothing lands in between, so the thresholds sit in the middle of a twelvefold
gap. A plan that does land there is reported `NEEDS_REVIEW`, never forced.
Detail: `benchmarks/PLAN-REPRESENTATION.md`.

### 2. A "stage" that was only ever a shape guess

A venue object is typed `stage` when its aspect ratio exceeds 3. A zone built on
that guess was reported as **certain** — "3 stage areas" on a plan with none.
Two fabricated STRONG facts, breaking a protected invariant.

A zone is now only as certain as the objects it stands on. **FABRICATED STRONG:
0.**

### 3. OCR deleting the tables

Text suppression drops any candidate more than 40% covered by OCR text *unless
it has chairs at it*. On a plan whose tables are numbered circles that exemption
is unavailable by construction. **Turning OCR on took detection from 132 tables
to 15.**

No benchmark here could have caught it: this sandbox has no network, so the
normal build silently has no OCR and every ORNEK number so far was measured on
the no-OCR path — while the offline package, the one that ships Tesseract and
the one an operator runs, was the broken one.

Detail: `benchmarks/CAPACITY-AS-A-RULE.md`.

---

## Capacity the drawing states about itself

```
[likely] The drawing states its own capacity as a rule: 166 tables at 12 pax
         each, 1992 seats, plus 72 elsewhere for 2064 in total.
[strong] The drawing states 166 tables; 132 were found. 34 are not accounted
         for.
```

Withdrawn, because it was never a finding: *"The plan states 2064 pax but 0
seats were counted."* Comparing a printed pax figure against a seat count only
means something on a plan that draws seats.

Reading the rule is not trivial. Tesseract returned **two different readings of
the same line on consecutive runs** — `1166 * 12: 1992` and `1166 * 121992` —
and neither multiplies out. The parser does not repair characters. The
arithmetic has to come out, *and* the product has to match a figure the drawing
states elsewhere (2064 − 72 = 1992). Given nothing to corroborate against, it
claims nothing.

---

## Also fixed: both offline builders were shipping a broken app

Each carried its own hand-written copy of the app's source list, and it had
drifted. `plan-relationships.js` and `plan-memory.js` were added to the app in
the previous sprint and never to the builders, so **every offline artifact built
since then shipped without the relationship engine and without plan memory**,
while both builds reported success.

The list is now read from `index.html`, and the verifier proves each script is
really present in the artifact — confirmed by rebuilding with a file
deliberately dropped, where every existing check still passed.

---

## Measured and deliberately not built

**Orientation.** Measured before building for it:

| | upright | raw page, as it arrives |
|---|---|---|
| recall | 0.795 | **0.663** |
| precision | 1.000 | 1.000 |
| representation | SYMBOLIC | SYMBOLIC |

A real 13-point cost, not a collapse, and not the reason the plan was
unreadable. Ranked below the work that lets the system state what the drawing
prints. `benchmarks/rotation/`.

**Per-table numbers.** Full-page OCR yields a usable digit for **21 of 132
tables (16%)**. Too sparse to present as numbering; doing it properly needs OCR
of each circle's own crop. Measured, recorded, not shipped — a 16% feature that
looks like a working one is exactly what this project forbids.

---

## Still red, honestly

| gate | value | why |
|---|---|---|
| semantic fact accuracy | **0.8571** vs ≥0.90 | ORNEK's 34 unfound tables and 6 shape-guessed stages |
| ORNEK table recall | **0.795** | see below |
| adversarial fixtures | 3 FAIL / 4 PARTIAL / 1 PASS | unchanged from the frozen baseline |

**No gate was moved to make a number pass.**

The 34 tables still missed are a detection-layer weakness, not a naming one:

- **all 9 dark-filled tables** — the pipeline looks for light discs with dark
  rims; these are the tonal inverse
- **the faint row 73–76** — printed at ~241 grey against ~253 paper
- **a band in the photograph's fold**

Recovering every one of them would have moved table recall from 0 to 0 before
the representation fix.

## Verification

```
tests              18/18 suites, 468/468 checks
detection          merit-real-venue + 4 fixtures unchanged, 0 regressions
adversarial        0 regressions, 9 improvements vs the frozen baseline
fabricated STRONG  0
zone stability     0.9891  (gate >= 0.90)
contradictions     all gates met
offline package    27/27, zero off-origin requests, real OCR driven
perf               all suites completed
```

## Not done

- **Phase 6** — detection-layer failures a1/a2/a4/a5/a6, the dark-filled tables,
  the faint row, and a structural-boundary (walls/room) layer. This is what
  closes the semantic-accuracy gate.
- **PDF normalisation** — orientation, deskew, crop, contrast, fold. Measured at
  13 points of recall; the original must stay the hero background.
- **Per-table numbering** — needs per-circle OCR.
- **Operator test on both plans**, and **CI covering both real plans**.

## Standing constraint

The numbers this plan prints — 166, 12, 1992, 72, 2064 — are ground truth for
this benchmark and nothing else. **No production code branches on this file's
name, its hash, or these values,** and none may. Every one of them is reached
from the document.
