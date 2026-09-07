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

---

## Phase 2 — the number printed inside each table symbol

On a symbolic plan the number **is** the table's identity: what the operator
says on the radio, what the guest list refers to, what has to survive a
re-import. A wrong number is far worse than no number, and the whole design
follows from that asymmetry.

### The montage idea, measured and abandoned

163 engine calls sounded unaffordable, so the first attempt tiled every table's
crop onto one sheet and read it in a single call. It is fast and it is wrong —
the engine's layout analysis runs straight across tile boundaries:

| | calls | time | precision |
|---|---|---|---|
| montage, 64px tiles | 1 | 3.8s | **0.755** (`89→8`, `105→107`, `104→10`) |
| montage, 96px tiles | 1 | 6.5s | **0.506** (`10→6`, `90→9`) |

Per-table calls then turned out to cost almost nothing anyway: a warm worker
reads a 150px crop in about 25ms, so all 163 take a few seconds. The montage was
dropped on the measurement, not on taste.

### One crop per table is not enough either

| view | read | right | precision |
|---|---|---|---|
| inset 0.18, ×3 | 109 | 92 | 0.844 |
| inset 0.18, ×4 | 105 | 91 | 0.867 |
| inset 0.28, ×4 | 98 | 88 | 0.898 |
| inset 0.28, ×6 | 99 | 83 | 0.838 |

Every failure is the same shape — a digit lost off the end: `104→10`, `118→11`,
`157→15`. Nothing in a single reading distinguishes that from a correct short
number, so **no confidence threshold rescues it**.

### What does work: two crops that see different amounts of the symbol

| | agreeing | right | precision |
|---|---|---|---|
| inset 0.18 ×4 **+** inset 0.28 ×4 | 87 | 87 | **1.000** (0 conflicts) |
| read by only one of the two | 29 | 5 | 0.172 |

Two findings, both load-bearing:

**Agreement is the evidence, not confidence.** Two independent crops do not lose
the same digit in the same way.

**The views must differ in what they SEE, not just in resolution.** Pairs
differing only in scale agree more often *and are wrong more often* (0.18×3 +
0.18×4: 99 agreeing, precision 0.909). Two views of the same crop share its
mistakes; two different crops do not.

### Result, end to end on the shipped path

| | ORNEK (symbolic) | Golden (physical) |
|---|---|---|
| symbols examined | 163 | **pass does not run** |
| **VERIFIED** | **87 — all 87 correct, precision 1.000** | — |
| NEEDS REVIEW | 31 | — |
| UNKNOWN | 45 | — |
| number pass cost | 9.1s | 0s |
| total detection | 31.8s | **6.4s, unchanged** |

The pass runs only where tables *are* numbered symbols — the representation
decision already established that, and each promoted table carries
`symbolFamily`. On a plan that draws furniture it would spend engine time
reading nothing, so it does not run.

### LIKELY is deliberately not produced

A number only one crop saw is right **17%** of the time. Calling that "likely"
would be a lie told in the product's own vocabulary, so OCR alone never emits
LIKELY: agreement is VERIFIED, everything weaker is NEEDS REVIEW with the
reading offered as something to check, and nothing readable is UNKNOWN. LIKELY
is reserved for corroboration from another source — verified layout memory, or a
person — which is a different evidence source and belongs to a later phase.

### What is still not solved

- **Recall is 0.569.** 87 of 153 numbered tables are verified; the other 66 are
  honestly NEEDS REVIEW or UNKNOWN rather than guessed.
- **Detection on ORNEK now takes 31.8s** in the offline build with real OCR,
  of which 9.1s is this pass. Whether that is acceptable is an operator
  question, and Phase 8 is where it gets answered rather than assumed.
- **A physical plan with printed table numbers is not covered.** The gate is
  `symbolFamily`, which is honest for the two plans in hand and a known
  limitation for a third.

---

## Phase 3 — is the numbering intact?

Reading a symbol and trusting a numbering are different jobs. Only the whole set
can answer whether anything is claimed twice, whether anything is missing, and
whether the count agrees with what the drawing says about itself.

`src/plan-number-integrity.js` is pure logic over the numbers Phase 2 produced —
no image, no OCR, no DOM — and it is built on three rules.

**Nothing is repaired.** A gap between 136 and 138 is reported as a gap. It is
never filled in with 137, however obvious that looks, because "obvious" is
exactly how a plan with a genuinely skipped number acquires a table that does
not exist. Reading and inference stay separate all the way to the screen, and
the wording says so: *"1 number between 136 and 138 is not accounted for — each
is either a table whose number could not be read, or a number the drawing does
not use."*

**The range comes from the document.** What counts as "outside the expected
range" is derived from numbers actually read, extended by any count the drawing
prints about itself (the capacity rule OCR read). With no such figure there is
nothing to be outside of, and the layer reports less rather than inventing a
ceiling. No production path knows ORNEK runs 1..157; that lives only in the
benchmark's ground truth, and the suite uses invented numbers throughout so a
constant could not creep in unnoticed.

**Repeated uncertainty is one finding, not fifty.** 66 unread numbers is one
thing an operator needs to know. Consecutive gaps collapse into runs, and every
table without a confident number is a single finding that keeps "needs a look"
and "could not be read at all" separately counted.

What it detects, each with its own severity so a review queue can be ordered:

| finding | severity | why |
|---|---|---|
| the same number on two tables | high | an operator otherwise meets this at the door, with a guest in front of them |
| one symbol whose two crops disagree | high | a decision, not a glance — both readings are shown |
| a number past the count the drawing states | high | only checkable when the drawing states one |
| the table count disagrees with the drawing | high | carries the stated figure's own provenance |
| numbers unaccounted for | medium | as runs, never as individual holes |
| tables with no confident number | medium/low | one finding, with the two cases counted apart |

Every number it reports carries where it came from, in `provenance`.

### Result, on ORNEK through the offline build with real OCR

```
tables 163   verified 87   needs review 31   unknown 45   DUPLICATES 0
stated count 166, from "the capacity rule the drawing prints (166 x 12 = 1992)"
discovered range 1..166, from "numbers read from the drawing, extended to the
                               166 the drawing states"

[high]   the drawing states 166 tables; 163 were found
[medium] 79 numbers between 1 and 166 are not accounted for, in 7 runs
[medium] 76 of 163 tables have no confident number
         (31 need a look, 45 could not be read at all)
```

**Three lines for an operator**, not a hundred: 79 unaccounted positions arrive
as 7 runs, and 76 unread tables as one finding. No number was claimed twice, and
nothing was filled in.

On the Golden Plan the layer is absent entirely — there are no numbered symbols
to check.

---

## Phase 4 — a verified table number is an identifier, not a similarity

Visual Plan Memory was **extended, not rewritten**. Everything it weighs —
where a box sits, how big it is, what it looks like, what surrounds it —
answers *how alike are these two objects*. On a plan of a hundred identical
numbered circles that question has no useful answer: the learned encoder rates
every circle about 0.9 similar to every other, which is correct and useless.

"TABLE 137" answers the only question that matters: **is this the same table.**

So a number both sides verified overrides the weighing, in both directions, and
the veto is the more important half:

| | outcome |
|---|---|
| same verified number | this is that table — score taken to certainty, `basis` records that an identifier decided it |
| different verified numbers | **not** that table, however identical the two circles look — no match, not even ambiguous |
| either side unverified | the ordinary weighing, unchanged |

Only VERIFIED numbers count. A NEEDS REVIEW reading is right 17% of the time,
so an unread number is treated as saying nothing rather than as weak evidence —
which is also why the learned embedding can never be overridden by a *guess*.

**This makes matching stricter, never looser.** The distance gate is unchanged,
so a number cannot reach out and claim a distant object; it can only decide
between things geometry already considered plausible, and rule out things
geometry liked. Widening the search on a number alone is exactly the aggressive
matching that previously raised wrong applications, and it is deliberately not
done: the only corpus that could measure it is the Golden Plan, which draws no
numbers at all. Recorded as a limitation rather than shipped on a hunch.

AMBIGUOUS remains a valid answer throughout.

---

## Phase 5 — can the plan check itself?

Every number the product shows an operator comes from one of four places, and
they are not equally trustworthy:

| | source |
|---|---|
| **A** | what the drawing **states** about itself — read by OCR from printed text |
| **B** | what the detector **found** — counted from the analysis |
| **C** | what the **arithmetic** gives — derived from A |
| **D** | what a **person confirmed** — the strongest, and the rarest |

`src/plan-self-check.js` compares them. It is not another detector: it reads
nothing, measures nothing, and adds no engine calls. It only asks whether what
is already known is self-consistent, and reports each answer as CONSISTENT,
INCONSISTENT, NEEDS REVIEW or NOT CHECKABLE.

**Arithmetic is corroboration, not permission to rewrite evidence.** When
`166 × 12` does not equal the printed total the answer is NEEDS REVIEW — never
a licence to adjust one of the numbers until it does. OCR of a photographed
sheet misreads digits constantly; that is exactly why the check is worth having
and exactly why it must not fix its own inputs. Where a digit was misread, the
misread value is reported *as read*: the suite pins that `1166` stays `1166`.

**Every number carries where it came from.** A check with anonymous inputs tells
an operator that something disagrees but not which side to trust — the half of
the message that decides what they do next. So the table count reports itself as
*"derived from the printed seating figure (1992 / 12); OCR itself read 1166"*,
and the found figure reports itself as *"Assisted Detection"*.

### The finding that must never come back

*"The plan states 2064 pax but 0 seats were counted"* was withdrawn in an
earlier sprint: on a plan that draws no seats it is a restatement of what kind
of drawing it is, dressed up as a discovery. The seat comparison is gated on the
representation decision, so on a symbolic plan it returns **NOT CHECKABLE** with
the reason stated, and on a physical plan it does its job. The suite pins both
directions.

A person's confirmed figure outranks everything above it, and when it disagrees
with the system the detail says so without ambiguity: *"the person is right"*.

### Where it runs, and why the position matters

The self-check is the **last** thing the analysis does, after
`buildPlanIntelligence` has been rebuilt from the OCR text. An earlier draft ran
it immediately after the per-table number read, which is wrong in a way neither
real plan would have exposed: `readPrintedTableNumbers` returns early on a plan
whose tables are not numbered, and it is the only thing that refreshes
`planIntelligence` at that point — so on a *physical* plan that prints a capacity
rule, the check would have run against the pre-OCR interpretation and found no
rule to check. Moved, with the reason recorded at the call site. It also re-runs
after every operator decision that recomputes plan intelligence, so a
consistency report never quotes a table count the screen has since changed.

### Result, on both real plans through the offline build with real OCR

| | Golden (PHYSICAL) | ORNEK (SYMBOLIC) |
|---|---|---|
| printed capacity rule | none | `166 × 12 = 1992`, parts `1992 + 72 = 2064` |
| checks produced | **0** | **5** — 3 consistent, 1 inconsistent, 1 not checkable |
| what it says | nothing, because the drawing states nothing to check | see below |

Golden producing **zero** checks is the result, not a gap. The drawing prints no
capacity rule, so there is nothing to compare, and a layer that manufactured a
finding anyway would be doing exactly what this sprint exists to stop.

On ORNEK, in the order it reports them:

```
[CONSISTENT]     166 x 12 = 1992              the drawing's own multiplication comes out
[CONSISTENT]     1992 + 72 = 2064             the parts add up to the total it prints
[INCONSISTENT]   states 166 tables; 163 found  3 not accounted for
[CONSISTENT]     87 numbers, none claimed twice
[NOT_CHECKABLE]  1992 seats stated             this drawing draws no seats
```

The one INCONSISTENT verdict is a **true** finding: the drawing does state 166
and the detector does find 163 (recall 0.976). It is reported as a disagreement
between two sources, each named, and nothing is adjusted to close it.

---

## Phases 4 and 5 — regression

Both phases were measured together, on the artifacts, before either was
committed.

| | before | after |
|---|---|---|
| suites | 23/23, 629 checks | **24/24, 671 checks** (`plan-self-check` +32; `plan-memory` 48 → 58) |
| ORNEK tables | P 0.994 R 0.976 F1 0.985 | **unchanged** |
| Golden tables | P 0.92 R 1 F1 0.958 | **unchanged** |
| Golden chairs | P 0.955 R 0.947 F1 0.951 | **unchanged** |
| Golden relations | 0.99 | **unchanged** |
| 4 adversarial fixtures | — | **unchanged** |
| memory: retention / identity precision / wrong application | 0.786 / 0.945 / 0.055 | **0.7857 / 0.9448 / 0.0552** |
| `verify:offline` | 27/27 | **27/27** |

The memory figures are the honest limit of what Phase 4 could be measured
against: **every scenario in that corpus is the Golden Plan transformed, and the
Golden Plan draws no numbers at all.** So the identifier path is never exercised
there and the numbers are byte-identical — which proves no regression and
proves nothing about the feature's value. What Phase 4 actually does is pinned by
`tests/suites/plan-memory.test.mjs` (58 checks), including the veto. Measuring
it on real numbered plans needs a second numbered venue, which is Phase 11's
job, and until one exists this stays recorded as unverified rather than claimed.

---

## Phase 6 — the Teach Area

### Starting state

The product already learns nothing, and everything up to here made it better at
reading a drawing on its own. What it had no place for was the one source that
outranks all of that: **a person who knows the room.** The head of banqueting
knows the long block by the north wall is the stage, that the grey rectangle by
the service door is a pillar the drawing has always shown badly, and that this
venue numbers its tables 1 to 166. None of it is derivable from the pixels; all
of it is worth keeping.

Two mechanisms existed and neither is this one. `rememberCorrection` keeps an
answer for **this plan only**, and dies with the event. `applyCorrectionToFamily`
spreads one correction across every object the similarity clustering grouped with
it — deliberately, and deliberately marked *"not individually reviewed by a
person"*, because forty repaired objects are not forty human decisions.

### What was built

`src/plan-teach-area.js`. A lesson is a note with a **scope the operator picks**:

| scope | reach | anchor |
|---|---|---|
| `plan` | this drawing | the plan's own fingerprint |
| `layout` | every version this layout is re-issued in | `layoutId` |
| `venue` | every layout in this venue | `venueId` |

The scope is a claim about how far someone's knowledge travels, so **the evidence
required scales with it.** On this drawing nothing moved, so resemblance is
identity. Across a venue it is not — *"a circle that looks like the circle I
ruled on"* describes a hundred tables in a ballroom — so a venue-scope lesson
about a specific object is acted on **only when the object carries the same
verified printed number the lesson carries** (Phase 2's per-table read, Phase 4's
identifier). Without one it is offered for review and never applied, and a lesson
that could never satisfy that is refused *at the moment it is written*, with the
reason and the scope that would work.

Identity is **not** re-implemented. A lesson is shaped into the row Visual Plan
Memory already expects and handed to it, so the veto, the grading and AMBIGUOUS
all come from the engine that was measured, not from a second opinion invented
here.

| answer | what happens |
|---|---|
| `APPLY` | the one object it was taught on, recorded on that object with the scope and the reason |
| `REVIEW` | offered — a good match is not a certain one |
| `AMBIGUOUS` | **nothing is touched.** Two objects fit equally well |
| `NOT_ON_THIS_PLAN` | reported as absent, never forced onto something |
| `STATED` | a fact about the drawing, not a claim about an object |

**One lesson is about one object.** Forty near-identical circles and one lesson
produce exactly one proposal — pinned by the suite. Spreading already exists
elsewhere, with its own honesty label; this is not that feature.

One answer stands per subject: **narrower wins** (the person could see the
thing), then **more recent wins** at equal reach. The second rule is a product
judgement, not a shortcut — an operator answering the same question again is
correcting themselves, and treating that as an unresolvable conflict would lock
them out of their own note. Nothing is dropped quietly: everything a winner
displaced is reported with the reason.

### It is not training, and the wording says so in both languages

Nothing is fitted, no parameter moves, and no model exists to improve. Teaching a
hundred lessons leaves the detector exactly as good and exactly as bad as it was
before the first one. The suite greps the module's own operator-facing strings —
the statement, every `describe()` line, every reason attached to a proposal — for
`train / trained / training / model / learn / learning / neural / weights`, and
fails if any of them appears. The Turkish string is written to the same rule
(*"Hiçbir şey eğitilmez"*).

### On screen

The object card gains a **REMEMBER THIS** block: the reach control, the button,
and the sentence that says what will happen. An object changed by a lesson says
so — *"From a note you wrote — On every version of this layout"* — because a
change that came from a person's note must never be mistaken for the detector
having got cleverer. That badge carries **Forget**, and forgetting removes the
lesson and puts the detector's own answer back rather than leaving the object
holding a classification with no author: a note a person cannot withdraw is a
decision made on their behalf. The status bar carries a chip: *"1 remembered"*.

Rendered and screenshotted at 1920×1080, 2560×1440 and ~1440px. Two things the
render caught that markup review had not:

- `describe()` produced **"this is a other"**. The module now takes the app's own
  word for the type, in the operator's language.
- At 1440 the status bar wrapped its own labels with 200px of empty space beside
  it. `left:50%` with no `right` makes an absolutely positioned box's
  shrink-to-fit width `container − 50%`, so the bar could never exceed 720px at
  that viewport — it was already wrapping before this phase, and the chip made it
  obvious. Centred by auto margins instead: 673px → 788px on one line, same
  height as before.

### Result

| | before | after |
|---|---|---|
| suites | 24/24, 671 checks | **25/25, 752 checks** (`plan-teach-area` +80, of which 12 drive the app's own wiring) |
| ORNEK tables | P 0.994 R 0.976 F1 0.985 | **unchanged** |
| Golden tables / chairs / relations | 0.958 / 0.951 / 0.99 | **unchanged** |
| 4 adversarial fixtures | — | **unchanged** |
| `verify:offline` | 27/27 | **27/27** |

No detector code was touched. The Teach Area runs after detection and before
plan intelligence is rebuilt, so a lesson that moves an object from table to
venue is seen by the capacity, relationship and self-check layers.

### What is not done yet

`REVIEW` and `AMBIGUOUS` proposals are computed, counted and carried on the
analysis, and the status chip says how many are waiting — but there is no screen
yet on which to settle them one by one. That is deliberately **Phase 7's** job:
"do not show the operator 50 warnings just because the system has 50 uncertain
facts" is the same question, and building a second, worse review surface here
only to replace it there would be waste. Until then the count is honest about
itself rather than hidden.

Teaching a **table number** and a **plan fact** are supported by the engine and
stored; the number is applied (marked VERIFIED with the source *"confirmed by a
person"*, which the self-check's wording now names alongside two-crop agreement).
No UI writes either one yet — only object identity has a control.

Cross-venue behaviour is **not verified on real data**: it is pinned by
constructed cases in the suite, and the corpus contains one numbered venue. Until
a second real numbered plan exists (Phase 11), that stays a statement about the
code, not about the world.

---

## Phase 7 — the confidence budget

An operator has a finite number of decisions in them before a plan stops getting
checked and starts getting clicked through. That is the budget. This phase
decides how to spend it.

### Starting state, measured before designing anything

Counted **one line per uncertain fact**, on both real plans through the offline
build with real OCR:

| | Golden (PHYSICAL) | ORNEK (SYMBOLIC) |
|---|---|---|
| uncertain facts, one line each | **119** | **278** |
| existing ranked priorities | 13 | 6 |
| …of which settle **nothing** on any axis | **5** | **2** |
| unconfirmed table numbers not in that list | 0 | **76** |
| integrity findings not in that list | 0 | **3** |
| open consistency checks not in that list | 0 | **1** |

Two problems, both measured rather than assumed, and neither the one this phase
was expected to find:

**The newer layers never reached the ranked list.** `reviewPriorities` predates
Phases 2, 3, 5 and 6. On ORNEK that is 80 uncertain facts sitting in four
different places with no shared ranking — the operator is never pointed at any
of them. The numbering-integrity report and the self-check had **no UI at all**:
they produced data nobody could see.

**The list already contained items that claim nothing.** Five of Golden's
thirteen and two of ORNEK's six settle zero objects, zero seats and zero facts.
Each costs a decision and fixes nothing measurable. That *is* "fifty warnings
because there are fifty uncertain facts".

### What was built

`src/plan-confidence-budget.js`. It runs no detector, reads no pixels and
changes no candidate — it consumes what every other layer concluded and decides
what to say first. It is the last thing the analysis does.

Every source contributes **claims** in one shared shape, so a numbering gap and
a contradiction can finally be compared:

| state | meaning |
|---|---|
| `WORTH_DECIDING` | resolving it demonstrably settles something |
| `NOTHING_MEASURABLE_DEPENDS_ON_IT` | real uncertainty, nothing downstream depends on the answer — counted in one line, never ranked as work |
| `NOT_ANSWERABLE_FROM_THE_DRAWING` | the drawing does not carry the answer; no amount of looking settles it |

**Repeated uncertainty is one claim, not N.** Forty-five tables whose number the
drawing never printed legibly is one thing to decide about, carrying the number
45. A run of seven missing numbers is one line. The count is the information;
the repetition is not.

**One problem is said once.** Claims carry what they are *about*, independent of
which layer raised it. This was not in the design — the first measurement of the
finished budget produced it. On ORNEK, four of the six items shown were the same
disagreement seen from four angles ("the drawing states 166, 163 were found",
noticed separately by the contradiction engine, the integrity report and the
self-check), which pushed 31 tables of real work below the line:

| | before dedupe | after |
|---|---|---|
| claims | 12 | **10** |
| shown | 6 | 6 |
| deferred | 3 | **1** |
| object coverage of what is shown | **0.61** | **0.974** |

A merged claim keeps the **worst** case of each measure — the union of what is
at stake and the true cost of settling it, never a flattering minimum — and
records the corroborating layer rather than discarding it.

**The ranking has no tunable weights, deliberately.** A weighted score would
need numbers chosen to make the result look right, and nothing in this repo
could then tell a good ordering from a tuned one. It is lexicographic, and the
order of the tests is the argument: things that settle something first; then
**facts** (a fact is a claim the *product* is making, and a wrong one is worse
than an unresolved object because the operator will act on it); then how much of
the plan **one decision** settles; then seats; then a stable key so the order
never depends on iteration accidents.

**Nothing is hidden, only ranked.** Everything below the line is counted and
what it would settle is stated. A budget that quietly drops its tail is not a
budget, it is a filter lying about its own coverage.

### Result

| | Golden | ORNEK |
|---|---|---|
| uncertain facts, one line each | 119 | 278 |
| claims after grouping | **13** | **10** |
| shown to the operator | **6** | **6** |
| deferred, counted | 2 | 1 |
| settle nothing measurable, counted | 5 | 2 |
| the drawing cannot answer, counted | 0 | 1 (45 tables) |
| object coverage of what is shown | **0.932** | **0.974** |

### On screen

The Review Center gains a **WORTH DECIDING** block above the review groups,
because it answers "where do I start" and the groups are only one of the things
competing for that answer. It is a numbered list — the order is the content —
and each row says what one decision costs and what it settles. Under it, always:
*"Below the line — 4 more worth deciding · 5 where nothing measurable depends on
the answer"*. The status bar chip becomes *"6 to decide"* rather than a count of
similarity families.

This is also the first surface Phase 3's integrity report, Phase 5's self-check
and Phase 6's unresolved Teach Area proposals have ever had.

Rendered and screenshotted at 1920×1080, 2560×1440 and ~1440px. The render
caught one thing markup review had not: the block's title and its coverage
sentence side by side broke "WORTH DECIDING" across two lines at 1440, and would
have been worse in Turkish, which is longer. Stacked instead.

### Regression

| | before | after |
|---|---|---|
| suites | 25/25, 752 checks | **26/26, 803 checks** |
| ORNEK tables | P 0.994 R 0.976 F1 0.985 | **unchanged** |
| Golden tables / chairs / relations | 0.958 / 0.951 / 0.99 | **unchanged** |
| 4 adversarial fixtures | — | **unchanged** |
| `verify:offline` | 27/27 | **27/27** |

No detector code was touched.

### What is not done yet

The rows are **readable but not yet actionable**: clicking one does not take the
operator to the object it is about. The existing review-group and question
controls still work exactly as before, so nothing regressed — but a ranked list
whose top item cannot be acted on in one click is half a feature, and closing
that is the first thing the human operator test (Phase 8) should be pointed at
rather than guessed about.

`DEFAULT_MAX_ITEMS = 6` is set from two plans. It is a parameter, not a
constant, so a third real venue can re-measure it rather than inherit it.
