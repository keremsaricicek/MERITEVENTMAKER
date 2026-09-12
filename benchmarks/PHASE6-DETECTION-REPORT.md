# Phase 6 — closing the measured detection and semantic failures

**Starting commit:** `9a8d57a5c33646cbc17dfad76e4a20734af09c51`
(branch `claude/merit-concept3-plan-intelligence-rebirth`)

The brief for this phase was narrow: close the remaining measured failures on
ORNEK without touching the Golden Plan, without moving a gate, and without
shipping a rule that has no measured separation behind it.

---

## Headline

| | start of Phase 6 | end of Phase 6 |
|---|---|---|
| ORNEK tables — precision | 1.000 | **0.994** |
| ORNEK tables — recall | 0.795 | **0.976** |
| ORNEK tables — F1 | 0.886 | **0.985** |
| ORNEK — tables found | 132 of 166 | **162 of 166** |
| ORNEK — false stage claims | 6 | **0** |
| semantic fact accuracy | 0.8571 | **0.9231**  (gate ≥ 0.90) |
| fabricated STRONG facts | 0 | **0**  (gate = 0) |
| chairs invented on a plan that draws none | 0 | **0** |
| architecture returned as a table | 0 | **0** |
| merit-real-venue tables, chairs, relations | — | **unchanged** |
| merit-real-venue stage semantics | tp 1, fp 1 | **tp 0, fp 0, fn 1 — a guarded regression** |

Two costs were taken deliberately, both with the alternative measured and
rejected, and both described below rather than tidied away: **one false table
on ORNEK**, and **the Golden Plan's one real stage, which the system no longer
names.** The second is a guarded regression against the recorded baseline and
is the one acceptance criterion this phase does not meet — §10.

---

## 1. The 34 missed tables were not one problem

The previous report guessed at three groups — dark fills, a faint row, and a
band inside the photograph's fold. Two of those three guesses were wrong, and
the instruction not to treat 34 misses as one problem is what caught it.

`benchmarks/heldout/ornek-miss-taxonomy.mjs` measures, for all 166 annotated
tables, the quantities the detector actually reasons about — local paper level,
interior grey, contrast, rim step, ink fraction, crowding — and reports found
against missed as distributions.

**The fold group does not exist.** The local paper estimate reads 255 across the
whole sheet, including inside the fold. The fold is visible to a human and is
not what any threshold in this pipeline is looking at. No work was done on it.

**The dark discs were not where they were assumed to be.** They were expected in
the `dark-tone-cluster0` chair family. That family's modal component is 8.1px of
linework and it has nothing on any of the nine discs.

A per-stage census (`MERIT_STAGE_CENSUS`, gated behind `MERIT_DETECT_DEBUG`)
then walked every missed table through every stage of the pipeline. The real
taxonomy:

| cause | n | what actually happened |
|---|---|---|
| **A — consumed as a seat** | 10 | detected, associated to an architecture proposal as its seat, destroyed when the swap demoted that proposal |
| **B — read as printed text** | 11 | detected, flagged as a glyph run, dropped |
| **C — the family's other polarity** | 9 | detected at the right size through the *table* sources, demoted with the architecture |
| **D — never detected** | 4 | tables 73–76 are not components in any source |
| | **34** | |

Groups A, B and C are all the same failure in three places: **a rule whose
safety depends on an exemption that a symbolic plan cannot supply.** It is
precisely the shape of the OCR text-suppression bug found in Phase 5.

---

## 2. Group C — the symbol family is a family, not a polarity

ORNEK draws 157 open circles and 9 filled ones. Same object, same size,
different ink. The open ones arrive through the chair sources (light interior,
dark rim); the filled ones arrive through the tone/fill *table* sources, because
a solid disc is a surface. The representation swap promotes the chair-source
family and demotes everything the table path proposed, so the filled half went
out with the architecture.

The rule added asks a family question, never a tone question: *does this agree
with the vocabulary the plan has already declared through its other half?* Both
tests are agreement functions already in this file, at the thresholds already
used there (the fragment filter's 0.6 on size, 0.55 on aspect).

Measured over the 40 de-duplicated table-pool components, against a modal taken
**from the open circles alone**:

| | size agreement | aspect agreement |
|---|---|---|
| the 9 filled discs | 0.89 – 0.94 | 0.96 – 0.97 |
| the other 31 | 0.00 – 0.94 | 0.00 – 0.99 |

None of the 31 passes both. Every component that agrees on size is a wall, door
or bay at aspect 1.96 – 3.54; every component that agrees on aspect is half the
family's size or twice it. **9 of 9 and 0 of 31**, with the nearest miss on
either axis about four times the threshold away. It is not a knife edge, and the
aspect column is the one that would show dark architecture arriving as tables if
it ever started to.

The rule runs only when the representation decision returns SYMBOLIC. On the
Golden Plan that decision is PHYSICAL and the code never executes.

---

## 3. Groups A and B — two exits only a chair can take

**Association (10 tables).** A family member counted as a seat of a table
proposal. Every one of those proposals is demoted by the swap moments later, so
the seat relationship no longer stands — its table is not a table. The pipeline
already re-homes chairs whose table the fragment filter deleted; the swap
deletes tables too and never did the same.

**Text runs (11 tables).** The text-run test's own discriminator is *"this run
sits at least 2 mark-widths from the nearest detected table"* — which is what
separates a caption from a row of seats. When the marks **are** the tables that
quantity is degenerate. Measured on ORNEK:

```
runGapInWidths   min 0.62   p10 1.15   med 1.97   p90 3.04   max 5.46
threshold        2.0
```

The population straddles the threshold with no separation to find. 11 of 11
flagged marks are annotated tables and none is text.

ORNEK is also **the only plan in the entire benchmark set that reaches this code
at all**: the Golden Plan and all eight adversarial fixtures consider zero text
runs, because only unassociated marks are eligible and their seats are
associated.

Both groups are now restored when — and only when — the swap fires. Nothing
about the representation decision changes: it is still taken on the association
rate as measured, before any restoration.

---

## 4. Group D — tables 73–76, still missed

These four are not components in any source at any stage. Measured against the
162 that are found, on their own local paper level:

| | interior grey | contrast to its own paper |
|---|---|---|
| the 162 found | 123.7 – 235.2 | 19.8 – 131.3 |
| tables 73–76 | 238.4 – 242.3 | 12.7 – 16.6 |

The two ranges do not overlap. That looks like a separation and **it is not
usable as one**: it is the detector's own accept/reject boundary showing up in
the data, not a measurement of these four against anything that would be wrong
to admit. The question a rule needs answered is what *else* arrives in the
12–20 contrast band, and that has not been measured.

So nothing was changed for them. §4 forbids simply lowering a global threshold,
and admitting them honestly means a NEEDS REVIEW tier measured against
everything else the lower bound would let in — real work, deliberately not
started inside this phase. **ORNEK recall is 162/166 = 0.976 because of these
four**, and they are reported as missed rather than recovered by a guess.

The fold band that the previous report listed as a cause does not exist: the
local paper level reads 255 at every one of the 166 tables, these four
included.

---

## 5. The one false positive

Restoring group A brings back 11 objects, of which 10 are annotated tables and
one is not — a family-sized mark near the SYSTEM KONTROL block. Precision
1.000 → 0.994.

Two rules were tried to remove it and **both were rejected on measurement**:

- **"a member inside the body of the object it was seated at is part of that
  object"** — measured insideness is 0.000 for all 11, TP and FP alike. No
  separation.
- **"apply the family-membership size test to restored members too"** — the FP
  scores 0.541 on size agreement; a genuine annotated table scores **0.533**. A
  floor anywhere between them trades one false positive for one false negative
  and is a threshold fitted to a single object with no margin. Rejected under
  §12.

One false table costs an operator one click. The rule that would remove it costs
a real table. It stays, and it is recorded here rather than hidden.

---

## 6. The six false stages

A venue object was typed `stage` on aspect ratio alone. Phase 4 stopped that
guess being reported as STRONG, which removed the fabricated certainty but not
the fabrication — the claim was still made, more quietly.

Measured across both real plans, the rule names 8 objects `stage`:

```
merit-real-venue   aspect 6.00, 7.93                          2 annotated
ornek-symbolic     aspect 2.80, 4.55, 5.43, 6.08, 8.97, 31.17 0 annotated
```

**Two right, six wrong — and the two right ones sit inside the range of the six
wrong ones.** Aspect cannot be retuned to separate them, and neither can the
other axes measured beside it: object size (10.9–13.4% of the plan against
12.9–13.1%), look-alike sibling count (0–2 against 0–1), or how much furniture
faces it. Every one overlaps.

Per §6 — *"without corroboration use UNKNOWN"* — these objects are no longer
named. The shape evidence is kept (`shapeSuggests: "band" | "block"`, and
`typeBasis` still travels with the object) and they are reported as areas that
could not be identified.

**This has a real cost, stated plainly: the Golden Plan's stage is genuine and
the system no longer names it.** It buys the removal of six false claims and
stops a 25%-precision label being presented to an operator as a finding.

What would corroborate a stage honestly is the drawing's own word for it — the
Golden Plan prints "SAHNE" beside its stage and ORNEK prints nothing beside any
of its six bands. That needs OCR, which this sandbox cannot run in the normal
build. Building a rule where no benchmark can reach it is exactly what produced
the Phase 5 OCR bug, so it is recorded as the way forward and not written blind.

Columns are unaffected. They are detected by a separate pass that requires four
independent facts to agree and scores 6 of 6 with no false positives on the
architecture fixture. That pass is what a corroborated structural claim looks
like; the aspect guess is what an uncorroborated one looks like.

---

## 7. What was NOT done, and why

- **No `if dark then table` rule**, and nothing keyed to an ORNEK coordinate,
  filename, hash or table number.
- **No relationship reasoning fed back into detection** (§9). The crude
  nearest-table association that scores candidates is untouched.
- **No global threshold lowered** to reach tables 73–76.
- **No gate moved and no baseline re-recorded.** Every gate threshold is the one
  it was at the start of the phase, and the recorded detector baseline is
  untouched — which is why it now reports the Golden stage regression in §10
  instead of quietly absorbing it.
- **No new family invented from one odd object** (§7). The family rule reads a
  vocabulary the plan declares across 154 members.
- **The original page is unchanged for display.** No illumination correction was
  built, because the measurement showed there is nothing to correct.

---

## 8. An unplanned result: the orientation cost was mostly these bugs

The previous sprint measured ORNEK's raw, unrotated page at recall 0.663
against 0.795 upright, and ranked PDF orientation work accordingly. Re-measured
now, with nothing about orientation changed:

| | upright | the raw page, as it arrives |
|---|---|---|
| before Phase 6 | R 0.795 | R 0.663 |
| after Phase 6 | R 0.976 | **R 0.976** |

The raw page now scores identically to the upright one — precision 0.994,
recall 0.976, F1 0.985 on both. The "13-point orientation cost" was almost
entirely these three rules failing, and they fail the same way whichever way up
the sheet is. Orientation normalisation is worth less than it appeared, and the
measurement that said so is `benchmarks/rotation/`.

---

## 9. Verification

Every number re-measured after the change, against the Phase 6 starting values
rather than remembered ones.

| | start of Phase 6 | now |
|---|---|---|
| `npm test` | 18/18 suites, 468/468 checks | **20/20 suites, 516/516 checks** |
| ORNEK tables | P 1.000 R 0.795 F1 0.886 | **P 0.994 R 0.976 F1 0.985** |
| ORNEK, raw page | P 1.000 R 0.663 | **P 0.994 R 0.976** |
| merit-real-venue tables | P 0.92 R 1 F1 0.958 | **unchanged** |
| merit-real-venue chairs | P 0.955 R 0.947 F1 0.951 | **unchanged** |
| merit-real-venue relations | 0.99 | **unchanged** |
| adversarial-architecture | 10/10 tables, columns 6/6 | **unchanged** |
| adversarial-bistro | gt 23 det 18 P 1 R 0.783 | **unchanged** |
| adversarial-dense / text | 24/24, 12/12 | **unchanged** |
| adversarial fixtures | 4 PARTIAL / 3 FAIL / 1 PASS | **unchanged** |
| semantic fact accuracy | 0.8571 NOT MET | **0.9231 MET** |
| fabricated STRONG | 0 MET | **0 MET** |
| untranslated strings | 0 | **0** |
| zone stability | 0.9891 MET | **0.9891 MET** |
| contradiction gates | all met | **all met** |
| offline package | 27/27, zero off-origin | **27/27, zero off-origin** |
| ORNEK detection time | 1855 ms | **1786 ms** |
| perf suites | all completed | **all completed** |

Both offline artifacts were rebuilt and then *run*, not merely built:
`dist/index-offline.html` and `dist/merit-offline/`, verified by
`benchmarks/offline/verify-offline-package.mjs` — 27 checks, every bundled
source proved to have executed, real Tesseract OCR driven against the real
plan, and zero off-origin requests even attempted.

Driving ORNEK through the offline package with **real OCR running** — the path
no benchmark here can reach, and the one that hid a bug last sprint:

```
representation=SYMBOLIC   tables=163
[likely] The drawing states its own capacity as a rule: 166 tables at 12 pax
         each, 1992 seats, plus 72 elsewhere for 2064 in total.
[strong] The drawing states 166 tables; 163 were found. 3 are not accounted for.
```

That last line read "34 are not accounted for" at the start of the phase. No
stage claim appears at all.

---

## 10. Still red, and one of them is a guarded regression

**The Golden Plan lost a true stage, and the baseline check reports it.** This
is the one acceptance criterion this phase does not meet:

```
better  merit-real-venue semanticObjects.stage.fp: 1 -> 0
WORSE   merit-real-venue semanticObjects.stage.tp: 1 -> 0
WORSE   merit-real-venue semanticObjects.stage.fn: 0 -> 1

2 regression(s) against the recorded baseline.
```

§6 said to stop naming a stage without corroboration; §11 said the Golden Plan
must show no guarded regression. On this defect the two collide, because the
rule that names ORNEK's six false stages is the same rule that names the
Golden's one real one, and no measured axis separates them.

**The baseline has deliberately NOT been re-recorded.** Re-recording would make
the check pass by redefining what passing means, which is exactly what this
project forbids. It is left failing so it stays visible, and it is the first
thing to overrule if the trade is judged the wrong way round.

| still red | value | why |
|---|---|---|
| Golden stage semantics | tp 1→0, fn 0→1 | the trade above; baseline not re-recorded |
| ORNEK table recall | 0.976 | tables 73–76, faint print, §4 work not started |
| ORNEK table precision | 0.994 | one false table; the rule to remove it costs a real one |
| adversarial fixtures | 3 FAIL / 4 PARTIAL / 1 PASS | unchanged; out of this phase's scope |

**No gate was moved and no baseline was re-recorded to make a number pass.**

---

## 11. What guards this now

Two new suites, both proven to fail when the code they guard is reverted:

- **`symbol-family`** (31 checks) — the membership test as a pure function,
  pinned with the real measured sizes of the nine solid discs and of the
  architecture they must be told apart from, at both ends of its tolerance, and
  on a rectangle-table plan so nothing assumes the symbol is round.
- **`symbolic-plan-detection`** (17 checks) — a symbolic plan constructed in the
  test with exact ground truth: 44 symbols in two tones, numbers printed inside
  them, a word-shaped row, a pair drawn against another symbol, and a piece of
  architecture. All three recovery routes are asserted by name.

Reverting each fix in turn:

| reverted | what fails |
|---|---|
| the family's other polarity | 3 checks — 44 tables become 36, 0 of 4 solid symbols found |
| the two exit restorations | 4 checks — the invariant, plus the word-row and seat cases at 0 |
| the stage naming change | 1 check — a band is named a stage again |

`benchmarks/heldout/ornek-stage-walk.mjs` is committed alongside them: it walks
every annotated table through every stage of the table path and names the exit
any lost member took. It is what replaced guessing, and it is the tool to reach
for the next time a count is short.
