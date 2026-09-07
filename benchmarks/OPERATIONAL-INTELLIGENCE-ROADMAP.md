# Operational intelligence — turning two working plan readers into a product

**Starting commit:** `cb263eb` (Phase 6 complete)
**Branch:** `claude/merit-concept3-plan-intelligence-rebirth`

The two real plan families now read well enough that their proven paths are
**protected**. Nothing in this sprint redesigns detection or the physical /
symbolic distinction. Every layer here is additive: it consumes what the plan
reader already knows and does more with it.

Protected baselines, reproduced at the start of this sprint and unchanged
unless a line below says otherwise:

```
ornek-symbolic    P 0.994  R 0.976  F1 0.985   162/166 tables
merit-real-venue  tables P 0.92 R 1 F1 0.958   chairs P 0.955 R 0.947 F1 0.951
                  relations 0.99
fixtures          architecture 10/10 · bistro 18/23 · dense 24/24 · text 12/12
```

---

## Phase 1 — a stage is identified because the drawing says so

### Starting state

Phase 6 removed `aspect ratio > 3 ⇒ stage`. Measured across both real plans that
rule named 8 objects and **6 were wrong**, with the 2 right ones sitting inside
the range of the 6 wrong ones — no threshold separates them. Removing it cost
the Golden Plan its one real stage, recorded as a guarded regression rather than
hidden.

### What was measured first

Three things, and two of them contradicted the plan for this phase.

**1. Full-page OCR does not read the label.** The Golden Plan prints SAHNE
across its stage. Full-page OCR of that plan returns 53 tokens and none of them
is SAHNE — the page runs on a canvas capped at 1920 on the long side, and the
label is left with ~78px.

**2. The stage band is deleted before anything could name it.** With OCR on, the
Golden Plan returns 48 candidates and **zero** venue objects, against 50 tables
and 6 venues with OCR off. Text suppression removes 8 objects, and one of them
is the band inside the annotated stage. The reason is measurable: OCR reads four
junk tokens inside the stage — `"EE"`, `"N"`, `"L"`, `"NR"` — whose boxes cover
**82.7%** of it, over the rule's 40% threshold. The very label that identifies
the stage is what deletes it.

**3. A crop of that one band reads it easily.** Same engine, same build, same
image — only the pixel budget differs:

```
full-page OCR of the whole plan       53 tokens, no SAHNE
OCR of the band the detector found    SAHNE, confidence 90
```

### The separation that justified the rule

Every band-shaped object on both real plans, crop-read with the same stage
vocabulary:

| plan | object | reads |
|---|---|---|
| merit-real-venue | the band inside the annotated stage | **SAHNE (90)** |
| merit-real-venue | the other shape-only band | nothing |
| merit-real-venue | the annotated stage extension | nothing (unlabelled) |
| ornek-symbolic | all six bands | nothing |

**1 of the real stages, 0 of 7 everything else.** The ORNEK half is the strong
half: those crops are *not* unreadable — they come back with
`SILA 29.08.2026`, `Haluk Elver Salonu 1/2/3`, `SALON 1166 * 12:1992 PAX`,
`KONTROL servant`. The engine worked on every one of them and none of them is a
stage. A silent engine would prove nothing; a talking engine that never says
"stage" proves the rule.

No threshold was needed or invented. Either the drawing prints the word or it
does not.

### What was built

- **`src/plan-label-ocr.js`** — reads the word a drawing prints on one object,
  from that object's own crop. Analysis-only: the crop is a throwaway canvas and
  the plan the operator sees is never altered.
- **`identifyLabelledVenueObjects`** in `app-v8.js` — runs after OCR over
  shape-only venue proposals *and* the geometry text suppression removed. An
  object only comes back if the drawing names it.
- `suppressTextFalsePositives` now returns *what* it removed, not only how many.
  Its verdict on what is a table is unchanged.

Two design points that came out of measurement rather than intent:

**The crop is a neighbourhood, not the box.** The detector finds a 433×42px
strip of the stage; the drawing prints SAHNE 50px above that strip. Padding by a
fraction of the strip's own 42px height reaches 3px and reads nothing. So the
pad across the short axis is a fraction of the *long* axis — a label is sized
against the object it names, not against how thin that object is.

**A miss costs one engine call, not two.** Running every variant on every object
took ORNEK's detection from 15s to 29s. A crop that read plenty and matched
nothing is not retried — re-preprocessing the same pixels will not conjure a
word that is not there — while a crop that read *nothing at all* is, because
that is what the second variant exists for. ORNEK: **29.1s → 22.5s**, with the
Golden stage still found at 90.

### Result

| | before Phase 1 | after |
|---|---|---|
| Golden stage, offline build with real OCR | not detected at all | **identified as SAHNE, confidence 90** |
| ORNEK false stage claims | 0 | **0** |
| ORNEK bands identified | — | **0 of 9 examined** |
| ORNEK detection time (offline, real OCR) | ~15s | **22.5s** |
| Golden detection time (offline, real OCR) | ~6.5s | **6.5s** |

### What is still not solved

- **The annotated stage extension stays UNKNOWN.** The drawing does not label
  it, so nothing names it. That is the honest outcome and the design working:
  an object keeps its geometry and loses only its label.
- **The benchmark cannot see any of this.** It runs the normal build, which has
  no network and therefore no Tesseract, so `SEMANTIC stage TP0/FP0/FN1` on the
  Golden Plan is unchanged there and the recorded baseline still reports the
  Phase 6 guarded regression. The rule is proven in the offline package, which
  is what an operator actually runs, and pinned as pure functions in
  `tests/suites/plan-label-ocr.test.mjs` so it does not depend on an engine
  being reachable. This is the same split documented in
  `benchmarks/CAPACITY-AS-A-RULE.md`.

### Rejected

- **Restoring `aspect ⇒ stage`** — explicitly out of scope, and measured in
  Phase 6 as 2 right against 6 wrong with no separating axis.
- **Fixing text suppression so the band survives** — that is a detector change,
  and the additive route (keep what it removed, and let only a printed label
  bring one back) achieves the same end without touching what the rule decides
  a table is.
- **Stitching a scattered reading back together.** At 3x and 4x the engine
  returns `I SAHN J 3,10m E` — every letter of the word, scattered through other
  readings. Reassembling it means choosing which characters to skip, which would
  find the word in almost any noisy crop. The variant ladder stops at 2x so the
  case does not arise, and where it does the answer is a miss.
