# The single-family audit

Every stage of `runAssistedDetection` that asks

> does this candidate resemble **THE** dominant family?

instead of

> **which** valid family does this candidate belong to?

Each such point can delete a legitimate minority family by construction, and
this repository has now shipped that bug four separate times — once for chairs
(fixed, `BISTRO-MERGE.md`), and three still open when this audit was written.

Read with `benchmarks/BISTRO-MERGE.md`, which is the worked example.

Measured on the real Golden Plan at commit `50d2132` unless stated.
`src/app-v8.js` throughout; line numbers drift, function names do not.

---

## A. Colour and tone model — where minority *materials* die

### A1. `buildToneModel` — `families` is a top-3-by-mass list

```js
const families = peaks.filter(...).sort((a,b) => b.mass - a.mass).slice(0, 3);
```

**Signal:** raw pixel mass of a luma peak.

**Deletes:** any furniture surface that is not one of the three largest fills on
the drawing. A minority surface is *defined* by having little mass, so this cap
is not a tie-break — it is a structural exclusion.

**Measured:** the real plan's luma peaks are
`[29, 109, 121, 146, 169, 201, 229, 255]`. The bistro tables' tan surface
**does** peak, at 201. `families` keeps 229 (fraction 0.082), 121 (0.015) and
146 (0.011) — bulk architecture and two linework families. The tan is excluded,
so no tint mask contains it, so the five bistro discs score 0.124–0.132 surface
coverage against a 0.22 floor and are deleted. **All five of the real plan's
remaining table misses are these.**

**Still justified:** no. The cap exists to stop the nearest-family tone LUT from
stealing pixels from the real table surface (measured once: tone sources
57 → 23 when dark peaks were added). That is an argument about *which* peaks and
*how wide a band* they claim — not an argument for the number three.

**Replacement:** admit a tone family on the same structural furniture evidence
already computed downstream (`solidity`, `compact`, `nearModal`, `repetition` in
the mask loop) rather than on mass, and let the count follow the evidence. Keep
each family's LUT band narrow so a new family cannot steal a neighbour's pixels.

### A2. `buildToneModel` — luma only; chroma is a gate, never an axis

Tone families are peaks of a **1-D luma histogram**. Chroma appears only as an
admission test (`LOW_CHROMA`/`MID_CHROMA`, and `chromaCut` in
`buildAccentModel`), never as a clustering dimension.

**Deletes:** any two materials that share a luma. On this plan the banquet
tables are pale grey (230,230,230; luma 229) and the bistro tables are tan
(240,210,160; luma 213) — 16 luma apart but *wildly* apart in chroma (0 vs 80).
The one axis the model uses is the axis on which they nearly coincide.

**Still justified:** it is cheap and it works on monochrome plans, which are
common. But it is the reason A1's cap bites so hard: with only one axis, the
minority family has to win on mass alone.

**Replacement:** cluster the non-accent pixels in colour space (the machinery
already exists — `buildAccentModel` does exactly this for the accent), or add
chroma as a second histogram axis. Lower priority than A1: A1 alone recovers the
tan family, because it *does* have its own luma peak.

### A3. `buildAccentModel` — exactly one accent hue family

```js
const seed = saturated[0];
const accent = others.filter(c => hueGap(c.hue, seed.hue) <= 30 && ...);
```

**Signal:** `chroma * sqrt(n)` — one winning hue, ±30°.

**Deletes:** a second coloured furniture family in a different hue. This plan
has steel-blue stage/bar/dais objects that are not accent; a plan with orange
chairs *and* blue chairs would detect only the orange ones.

**Still justified:** partly. Hue-anchoring is what stops a fill and its darker
stroke being two families, and it is measured-good. But "one seed" is the same
top-1-by-mass shape as A1.

**Replacement:** allow more than one accent hue family when a second is
independently supported (its own components are compact, repeated, similarly
sized). Not urgent for the Golden Plan — no second accent furniture exists on
it — but it is a real generalization gap and must not be claimed as solved.

### A4. `darkCandidates` — top-3, and chairs only

`darkCandidates` is `.slice(0,3)` and is offered **only** to the chair pool
(`usedForTables:false`, hard-coded). A dark minority *table* surface can never
become a table source on any plan.

**Still justified:** the chairs-only restriction was measured (adding dark peaks
to the tone LUT fragmented the table masks). The `.slice(0,3)` is not.

### A5. `surfaceMask` — the single largest tint family

```js
surfaceMask = masks.tints.reduce(/* the family covering the most pixels */);
```

Used by the surface-coverage filter to ask "is this candidate made of table?".

**Deletes:** any table drawn in a minority finish. Same failure as A1, one stage
later — and on this plan it is the stage that actually kills the bistro tables.

**Already measured:** asking every solid tint family and taking the best answer
changed **nothing** on the real plan (because of A1 — there was no second family
to find) and cost `adversarial-dense-v1` four table false positives, where a
second solid family does exist and "made of SOME furniture tone" is a weaker
question than "made of THE table tone". Reverted; see `BISTRO-MERGE.md`.

**Replacement:** fix A1 first. Then revisit — with a *correctly identified*
second furniture family the plural question is a different question from the one
that regressed the dense fixture.

---

## B. Size and shape modals — where minority *shapes* die

Each of these is one number describing the whole plan. The chair gate was moved
to per-family in `50d2132`; these were not.

| # | where | the one number | minority family it can delete |
|---|---|---|---|
| B1 | `offModalDropped` filter | `modalArea` (÷8, ×6 bounds) | a table family under an eighth or over six times the majority area |
| B2 | `fragmentEvidence` reason 2 | `s.agreement < .6` vs `modalArea` | any minority-size table — contributes 1 of the 3 reasons needed to delete |
| B3 | `fragmentEvidence` reason 3 | `modalAspect` (median of all) | any minority-aspect table; a bistro's 1.16 against a square plan's 1.00 |
| B4 | `splitAtValley` | `modalLong` / `modalShort` | over-splits a genuinely large table; under-splits a merged minority pair |
| B5 | `dedupFitness` ordering | `provisionalModalArea` | a minority table ranked below a majority-sized blob overlapping it, so it loses de-duplication |
| B6 | `chairAreaFloor`, `chairSpanFloor` | `chairModal` (majority chair) | a table barely larger than the majority chair |
| B7 | `chairEvidence` | `chairModal` | scores a minority-family chair as weak evidence purely for being small |
| B8 | association `margin` | `span * 1.6 + minSide * .25` | fine (relative), but the *winner* is nearest-first, so a chair whose real table was deleted attaches to whatever is left — this is how the wall panel got seats |

**B1–B3 are the dangerous ones**, because the fragment filter needs three
reasons and a minority family supplies all three *by construction*. This is
stated in the code already (`FRAGMENT_MIN_REASONS` comment) and is exactly what
`adversarial-bistro-v1` reproduces: 18 square tables set the modal, 5 bistro
tables are proposed and deleted with reasons "size disagrees / aspect disagrees /
no seat adjacency".

**Replacement:** the same shape as the chair fix — cluster table candidates into
size-and-aspect families first, then judge each candidate against its own
family's modal, and require a family to be independently supported (repeated
surface, seating, free-standing) before it counts as a family at all.

---

## C. Absolute-pixel assumptions — where *scale* breaks the model

These are not family assumptions but they cause the same class of failure, and
they are the measured cause of the `downscale-70` chair-FP explosion (0 → 73).

| # | where | the absolute number | what it does at 70% scale |
|---|---|---|---|
| C1 | `chairSizeOk` | `Math.min(c.w,c.h) >= 3` px | a 5px fragment becomes 3.5px and still passes; the floor stops filtering anything |
| C2 | `notWall` | `< 3` px | same |
| C3 | `minPixels` | `Math.max(10, area * 6e-6)` | the constant 10 dominates on smaller images |
| C4 | adaptive threshold | local-mean radius `r = 18` px | a fixed 18px window is a different operator at every rendering scale |
| C5 | Sobel edge gate | `|gx| + |gy| > 150` | absolute gradient magnitude — collapses under blur and low contrast |
| C6 | tone peak separation | `< 10` luma; band `min(14, gap/2)` | absolute luma units — contrast and brightness transforms move peaks past each other |

C5 and C6 are the likeliest causes of the `blur` / `contrast-high` /
`bright-up` table-F1 collapses (0.643 / 0.561 / 0.586 against 0.891).

**Replacement:** express each as a fraction of the plan's own scale — image
diagonal, modal object size, or the measured contrast range — rather than of the
pixel grid.

---

## D. Rotation

There is no deskew stage. `minAreaRect` produces an oriented box *after*
detection, but almost every gate upstream uses the axis-aligned `c.w`/`c.h`:
`chairSizeOk`, `tableSizeOk`, `notWall`, `keyOf` (family binning),
`elongationOf`, `gapTo`, `containedBy`, `touchesSurface`.

A 3° rotation inflates the axis-aligned box of an elongated object and changes
its measured elongation, which moves it into a different family bin — so a
single chair family splits into several under-supported ones.

**Measured:** `rotate-2` and `rotate-minus-3` are the only variants where
armchair recall falls (1.000 → 0.823) and review groups explode (12 → 35 / 41).

**Replacement:** estimate the plan's dominant line orientation and deskew before
detection, or carry OBB dimensions into the family gates. Deskew is preferable:
it fixes every downstream gate at once instead of each separately.

---

## E. Self-disabling guards — where a filter stops filtering

Two filters switch themselves off wholesale when they look like they would
delete too much. The intent is sound; the implementation converts "this plan is
hard" into "no filtering at all", which is the worst available behaviour.

### E1. The fragment filter's proposal-ratio guard — **fixed**

`flagged.length <= ranked.length * .45`. On the Golden Plan the filter removes
38 of 88 proposals — **43.2%**, one percentage point from switching itself off.
The `crop-pad` variant (the same drawing moved 60px right and 34px down, nothing
else) crosses the line: filter off, all 90 proposals kept, 44 table false
positives against 4 on the original.

Replaced by two conditions that are about evidence rather than about how many
things happened to be proposed:

- it stands down if it would delete a candidate that agrees with the modal size
  **and** carries seats (it cannot, by construction — that candidate can collect
  at most two of the three reasons — so this is a safety assertion);
- it stands down if the plan's modal describes fewer than 30% of proposals,
  because every reason it deletes on is a disagreement with that modal. Measured:
  Golden 0.432, crop-pad 0.411, noise 0.538, blur 0.543 against
  lowres-roundtrip 0.190 and jpeg-q20 0.183 — a 2.2× gap.

Measured effect: `crop-pad` table F1 0.676 → **0.968** (FP 44 → 3),
`lowres-roundtrip` 0.554 → 0.636, `jpeg-q20` 0.714 → 0.769.

### E2. The surface filter's keep-ratio guard — open

`if (surfaceKept.length >= max(4, unique.length * .2))` else keep everything.
Fires on `bright-up` and `contrast-high`, where `brightness(1.18)` pushes the
pale grey table fill (luma 229) past 255 and it **clips into the paper**. The
surface family genuinely stops existing, so standing down is correct — but
accepting every candidate afterwards is not. Those two variants carry 48 and 49
table false positives.

The information is really gone, so the answer is not a better threshold: it is
that a stage which loses its evidence should mark candidates for review rather
than pass them through as detections. See §10 of the sprint brief.

---

## Status

| item | state |
|---|---|
| A1 tone families capped at three | **fixed** — cap removed, structural test decides |
| A5 single surface mask | **fixed** — plural, minority finish needs seat corroboration and may not be the plan's chair material |
| B6 table floor from the majority chair | **fixed** — floor is the smallest chair family |
| C1 absolute 3px chair floor | **fixed** — plan-relative (`minDim * .01`), also gates the tone family's own modal |
| E1 fragment filter ratio guard | **fixed** — evidence-based |
| A2 luma-only tone model | open |
| A3 single accent hue | open |
| A4 dark candidates capped, chairs only | open |
| B1–B5 table size/aspect modals | open |
| C2–C6 absolute pixel and luma constants | open |
| D rotation / no deskew | open — the only remaining robustness regression |
| E2 surface filter keep-ratio guard | open |

Measured result of the fixed items, real Golden Plan:

| | before | after |
|---|---|---|
| table TP / FP / FN | 41 / 5 / 5 | **46 / 4 / 0** |
| table F1 | 0.891 | **0.958** |
| bistro table recall | 0/5 | **5/5** |
| chair F1 | 0.951 | 0.951 |

## Priority for what remains

1. **D** — deskew. The rotation variants are the only rows still below their
   recorded baseline, and rotation breaks every axis-aligned gate at once.
2. **C2–C6** — the remaining absolute constants; `downscale-70`'s 73 false
   chairs and the contrast/brightness collapses.
3. **E2** — a stage that loses its evidence must defer to review, not accept.
4. **B1–B5** — table families, the same fix already proven for chairs.
5. **A2, A3, A4** — real generalization gaps with no Golden Plan evidence
   behind them. Must not be claimed as solved.
