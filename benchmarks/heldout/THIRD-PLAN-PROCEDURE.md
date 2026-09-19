# The procedure for a third real plan

Section 28. What to do, in order, the day a genuinely new venue drawing
arrives.

## Status: **NO THIRD PLAN EXISTS. This is the procedure, not a result.**

Two real plan families are in the corpus: the Golden Plan (PHYSICAL — draws its
chairs) and ORNEK (SYMBOLIC — numbered circles, capacity printed as a rule).
Documenting how a third would be handled is not the same as having one, and
nothing here may be read as a third measurement. Cross-venue generalization
remains **MEASURED TWICE**, not VERIFIED.

This file is not invented. Every step below is what was actually done for
ORNEK, written down so the third run is a repeat of a known procedure rather
than a fresh improvisation by somebody who by then knows what they hope to see.

---

## The one rule the whole procedure protects

> **The first run on an unseen plan happens exactly once, and everything you do
> before it decides whether that run means anything.**

It cannot be recovered. Training the encoder on the plan, tuning a rule while
looking at its output, or re-annotating it after seeing the misses each destroy
the measurement permanently, and holding out a *fourth* plan does not undo it.

`run-heldout.mjs` enforces the mechanical half of this and refuses a run whose
plan is in the encoder's `trainedOn` manifest, already annotated in the corpus,
or previously benchmarked under a different annotation. There is no override
flag. The steps below are the half a script cannot enforce.

---

## Step 1 — Take the file in by hash, before looking at it

Copy it in as a single file and record its provenance the way
`benchmarks/plans/ORNEK-SOURCE.md` does: where it came from, its size, its
`sha256`, and a verification that the extracted file round-trips to the same
hash. If it came from another branch, bring in **the blob, not the branch** —
merging a branch brings its tuning with it.

Write the provenance file now, while the only thing you know about the drawing
is its hash. It is the cheapest possible honesty and it is worthless if written
afterwards.

## Step 2 — Measure what the file *is*, without looking at what it draws

Structure only:

```
node benchmarks/plans/extract-ornek.mjs      # the pattern to copy: pages, fonts, images, /Rotate
```

Answer, from the file: native text or none? vector geometry or none? one raster
or many? what resolution, what rotation?

For ORNEK this step alone killed a planned work item — `/Font 0`,
`/FontFile 0`, one `/DCTDecode` image — which said in advance that a vector
parser would have been built for a document containing no vectors. Do this
before deciding what to build, not after.

This step is safe because it reads the container, not the content. You still
have not looked at the plan.

## Step 3 — Classify the representation, and say it out loud

PHYSICAL, SYMBOLIC or HYBRID (`src/plan-representation.js`). This is the single
most consequential fact about a new plan, because it changes what *capacity*
means:

| | PHYSICAL | SYMBOLIC |
|---|---|---|
| chairs | drawn, detectable | **not drawn at all** |
| capacity | counted from chairs found | a figure the drawing prints about itself |
| seat count when unknown | `0` is a real answer | **`null`, never `0`** |

A third plan that is neither — a hybrid, a seating chart with names on it, a CAD
export with layers — is a **new representation**, and that is a finding in
itself, before any score. Say so in the provenance file.

You are now looking at the drawing. Everything from here is one-way.

## Step 4 — Ground truth, frozen, before any detector output is seen

Annotate it into `benchmarks/annotations/` in the existing format, **by a person
looking at the drawing, never by correcting detector output**. Ground truth
built by accepting what the detector found and fixing the obvious errors is not
ground truth; it is the detector's output with its confident mistakes preserved.

Freeze it — commit it — before step 5. The commit is what makes "we did not
adjust the answer after seeing the score" checkable rather than asserted.

For a SYMBOLIC plan, annotate the printed numbers as printed, including the ones
that are ambiguous or damaged. A number a person cannot read is not a gap in the
annotation; it is the ground truth for what the drawing actually offers.

## Step 5 — Run it once, untouched

Change nothing first. Not a threshold, not a rule, not a resolution.

**5a. Clear the leakage guard.**

```
npm run benchmark:heldout -- <plan-image> <annotation.json>
```

This is the check that refuses a plan the encoder was trained on, one already
annotated in the corpus, or one benchmarked before under a different
annotation. It appends to `history.json` (created on first use) and is never
rewritten.

**5b. Write a permanent first-run record.** This is what was actually done for
ORNEK, and it is the step that matters most:

```
node benchmarks/run-benchmark.mjs <plan-id> --out benchmarks/heldout/<plan>-first-run.json
```

then a `<PLAN>-FIRST-RUN.md` beside it, modelled on `ORNEK-FIRST-RUN.md`,
recording **the commit under test**, the exact plan file and its dimensions, the
ground-truth file, the report path, the command to reproduce it, the command to
diagnose it — and the score, in full, however bad.

ORNEK's first run scored `TABLES gt=166 det=10 TP=0 FP=10 FN=166 P=0 R=0 F1=0`.
That number is still in the repository, unedited, and it is the most valuable
artefact of the entire two-plan sprint: everything built afterwards is measured
against a starting point nobody was tempted to soften. Write the equivalent for
plan three before anyone discusses what to do about it.

A held-out result that can be edited later is not one.

Expect a lower score than the corpus plans. That is the expected outcome and is
not a regression; it is the first honest measurement of something previously
unknown. What the number is actually for:

- Does detection **degrade or collapse**? 0.958 → 0.80 is a system that
  transfers. 0.958 → 0.30 is one that memorised a drawing.
- Does the second opinion have references to work from on a plan with no
  operator decisions, and does its tier say `provisional` honestly?
- Do the contradictions point at that plan's real errors, or at nothing?
- Does the interpreter say something **true** about a room it has never seen, or
  confident sentences about the wrong thing?

Record the result before discussing it.

## Step 6 — Diagnose before theorising

This is the step Phase 6 got wrong on ORNEK: it guessed at three causes and
measurement contradicted two of them.

```
node benchmarks/heldout/ornek-miss-taxonomy.mjs   # what the pixels look like
node benchmarks/heldout/ornek-stage-walk.mjs      # where in the pipeline it died
```

Both read the miss list from the last `npm run benchmark`, so run that first.
Copy them for the new plan rather than reading their ORNEK outputs.

- The **taxonomy** reports found-against-missed as *distributions* of the
  quantities the detector actually reasons about — local paper level, interior
  grey, contrast, rim step, ink fraction, crowding — not as a count. It exists
  so that a rule proposed afterwards has a measured separation behind it, and so
  a rule with none can be rejected before it is written. It is what showed
  ORNEK's supposed fold band does not exist: local paper reads 255 at all 166
  tables.
- The **stage walk** traces each object through every stage and names the exit
  it took, separating "the detector never saw it" from "the detector saw it and
  a later rule discarded it". On ORNEK that was 4 objects against 30, and the
  two needed opposite fixes.

**Do not propose a cause you have not measured.** A plausible story about a fold
line cost real work on ORNEK before the taxonomy said the fold was not there.

## Step 7 — Only now, change something

Fix what the diagnosis named. Then, and only then:

```
npm run benchmark                # object-level, per plan, against annotations
npm run benchmark:baseline       # every guarded field, per plan, vs BASELINE.json
```

The baseline compares **every guarded field separately per plan**, because a
trade — chair recall up, table F1 down — is invisible in a single score and is a
revert, not a win. A fix for plan three that costs plan one or two is not a fix.

Re-record `BASELINE.json` only as a deliberate, explained decision, never as a
step in getting a run green.

## Step 8 — The three status lines that must be updated together

A third plan changes what the project may claim, and the claims live in more
than one file. Update all of them in the same commit:

1. `benchmarks/heldout/README.md` — the corpus count and the generalization
   status line. **Three plans make it MEASURED THREE TIMES, not VERIFIED.**
2. `benchmarks/README.md` / `BASELINE.json` — the new plan is a guarded plan
   from now on, with its own per-field rows.
3. `benchmarks/operator/HUMAN-TEST-CONTRACT.md` §5 — a new *representation*
   obliges a new operator session, because the existing two cover PHYSICAL and
   SYMBOLIC only.

## Step 9 — What may be reported

After a completed third-plan run:

> REAL DISTINCT VENUE PLANS: 3. CROSS-VENUE GENERALIZATION: MEASURED THREE TIMES.

What may never be written:

- ~~CROSS-VENUE GENERALIZATION: VERIFIED~~ — three drawings is three data
  points, and this project does not have a defined threshold for that word.
- Any claim that the detector "handles" a representation it has seen once.
- A score for the third plan quoted alongside the corpus plans' scores without
  saying which were tuned on and which was held out.

---

## The failure mode this procedure exists to prevent

Not a bad score. A **good** one, arrived at by having looked first.

The tempting order is: open the plan, notice the detector misses a cluster of
tables, adjust a threshold so it does not, then annotate, then run, then report
a strong held-out result. Every individual step there feels reasonable and the
number at the end is worthless — and, worse, indistinguishable from a real one
once the session is over and nobody remembers what order things happened in.

Steps 1, 4 and 5 are ordered as they are for that reason, and the freeze commits
in steps 1 and 4 are what make the order checkable by somebody who was not
there.
