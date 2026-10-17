# PLAN INTELLIGENCE 2.0 — what was built, and what it measures

> **SPRINT STATUS: PARTIAL.**
> Every phase ran and every claim below is measured. Three targets were met and
> exceeded, one was met on the case it was previously measured on and missed on
> the harder case this sprint introduced, and one mandatory integration was
> completed and then reported as providing no measurable benefit.

```
npm test                          16 suites / 410 checks
npm run benchmark:baseline        detection, 31 guarded fields
npm run benchmark:adversarial     the eight new fixtures
npm run benchmark:memory          identity across transformed plans
npm run benchmark:zones           zone stability + per-type reading
npm run benchmark:facts           semantic accuracy, fabricated STRONG
npm run benchmark:contradictions  does a disagreement point at a real error
npm run benchmark:review-order    does the queue reach errors faster
npm run perf                      4,000 seats
npm run verify:offline            the built artifacts, driven for real
```

---

## BASELINE — before → after

Detection was **not** the objective and did not move. Every one of the 31
guarded fields in `BASELINE.json` is unchanged.

| | before | after |
|---|--:|--:|
| tables F1 / recall | 0.958 / 1.000 | **0.958 / 1.000** |
| chairs F1 | 0.951 | **0.951** |
| table types (square/round/bistro) | 37/37, 4/4, 5/5 | **unchanged** |
| robustness medians (table / chair F1) | 0.877 / 0.955 | **0.877 / 0.955** |
| **relationship coverage (scoreable)** | 83 | **109** |
| **relationship accuracy** | 1.000 over 76 scored | **0.990 over 101 scored** |
| **zone stability** | 0.9658 | **0.9891** |
| **zones read on the original plan** | 11 (6 dining) | **4 (1 dining)** |
| **semantic fact accuracy** | 0.9130 over 23 | **0.9200 over 25** |
| fabricated STRONG facts | 0 | **0** |
| contradictions on the clean plan | 4 | **4** |
| contradiction targeted precision | 0.4666 | **0.4954** |
| Teach AI propagation / retention | 1.000 / 1.000 | **1.000 / 1.000** |
| tests | 14 suites, 305 checks | **16 suites, 410 checks** |

---

## ADVERSARIAL FIXTURES

> **SYNTHETIC ADVERSARIAL FIXTURES. NOT REAL VENUES.** They do not count toward
> REAL DISTINCT VENUE PLANS, the encoder is never trained on them, no threshold
> is tuned to one, and no code branches on a fixture id.

Eight hypothesis-driven layouts, frozen by sha256 of both image and declaration
**before** any inference changed. The runner refuses to score a fixture whose
bytes moved, and a missing `FROZEN.json` is itself a refusal.

| id | hypothesis | before | after | verdict |
|---|---|---|---|---|
| **a1** chair-under-table | the seat-containment gate is over-general | FAIL — 8/16 real tables held back | **0 held back**, zones P/R 0→1 | PARTIAL |
| **a2** mixed-families | size reasoning deletes minority families | FAIL — 7 held, 23 phantoms, chair recall 0.34 | unchanged | FAIL |
| **a3** no-anchors | the interpreter invents stage/bar/lounge | PARTIAL — 5 zones for 1 room | **1 zone, P/R 1.0** | **PASS** |
| **a4** multi-room | zone clustering cannot see a wall | PARTIAL — 11 typed zones for 3, P 0.091 | **P 1.0**, R 0.333 | PARTIAL |
| **a5** architecture-only | the system cannot say "nothing" | FAIL — 8 columns proposed as chairs | unchanged | FAIL |
| **a6** arch-confusion | repetition is read as furniture | FAIL — 46 phantoms against 8 real | zones P/R 0→1; phantoms unchanged | FAIL |
| **a7** dense-overlap | association cannot express doubt | PARTIAL | unchanged | PARTIAL |
| **a8** large-venue | nothing was ever measured past 46 tables | FAIL — **all 240** tables held back | **0 held back** | PARTIAL |

**First run on the untouched build: 5 FAIL, 3 PARTIAL, 0 PASS.** After:
**3 FAIL, 4 PARTIAL, 1 PASS — 9 improvements, 0 regressions**, field by field against the frozen baseline.

None of that was visible in `BASELINE.json`, which was green throughout. That is
the entire argument for the directory.

---

## RELATIONSHIP ENGINE 2.0

Full detail: `benchmarks/RELATIONSHIP-ENGINE.md`.

| | |
|---|--:|
| total chairs (Golden Plan) | 113 |
| scoreable | **109** (was 83) |
| ambiguous by annotation | 4 |
| scored (both ends detected) | 101 |
| correct / wrong / orphan | 100 / 1 / 0 |
| **accuracy** | **0.990** (target ≥ 0.97) |
| coverage | 0.927 |
| orientation known | 59 of 112 |
| facing known | 20 |
| facing actually used in a decision | 16 |
| competing-table cases (a runner-up existed) | 40 |
| flagged ambiguous | 1 |
| **nearest-distance-only decisions remaining** | **112 of 112** |

That last row is the honest headline. **On the one real plan the engine puts
every seat exactly where the old one-line rule put it** (`changedFromNearest: 0`).
The Golden Plan does not discriminate between "nearest table within reach" and
any amount of evidence, because there they agree everywhere. What the engine buys
is the evidence it records — runner-up, margin, term breakdown, orientation
verdict — and the ability to decline. A 57-check unit suite pins those, because
no benchmark on that plan could see them.

Ground truth grew honestly. The annotation abstained on 30 chairs "equidistant
to a fraction of a pixel"; they are not equidistant by a measure the drawing
offers — each sits inside one table's **edge span** and past the other's
**corner**, and a chair off a corner is not a seat. Before deciding anything new
the rule was run against the 83 relations that already had an answer: it agreed
with all 83, including the 20 produced by a genuinely different computation. It
still abstains on 4.

**Circularity is structural, not promised.** The table scorer keeps a crude
adjacency count; the evidence engine runs *after* classification. Measured: when
the engine did feed the scorer, three renderings each gained a phantom table.

### The gate the fixtures broke

Of the 117 invented tables the seat-containment gate has ever held, **every one
has exactly one seat inside it.** a1's real tucked tables have six; a8's have
ten. The topology was never the signal — the count was. And at arena scale the
count alone still is not enough, so the gate also stands down when it would claim
most of the plan (measured: at most 42% where it is genuinely right, 100% on both
plans where it was wrong).

**248 real tables recovered. 117 invented ones still held. Zero change on the
real corpus** — same 117 held, same 109 committed FP, still never a real table.

---

## VISUAL PLAN MEMORY 2.0

Full detail: `benchmarks/memory/README.md`.

| scenario | retained | wrong | identity precision |
|---|--:|--:|--:|
| identical *(control)* | 28/28 | 0 | 1.000 |
| grayscale | 28/28 | 0 | 1.000 |
| blur | 24/28 | 0 | 1.000 |
| downscale-70 | 23/28 | 0 | 1.000 |
| jpeg-q20 | 20/28 | 2 | 0.909 |
| rotate-2 | 18/28 | 4 | 0.818 |
| crop-pad | 16/28 | 5 | 0.762 |

**Retention 0.786 · identity precision 0.945 · wrong application 0.055.**

> Gates (≥0.98 / ≥0.98 / ≤0.01): **MET on an unchanged plan, NOT MET on
> transformed plans.** Nothing regressed — `benchmark:teaching` still reports
> 1.0000 / 1.0000 / 0.0000. The harder case is new, and this is where it stands.

### Does the learned embedding contribute? — the mandatory §24 answer

It is wired in: the encoder's vector for the real crop is stored with every
decision and compared by cosine on every match.

| | retention |
|---|--:|
| full model | 0.786 |
| **without the learned embedding** | **0.796** |
| without the neighbourhood signature | 0.791 |

> **NO MEASURABLE CONTRIBUTION on this corpus. It costs 2 decisions.**

Reported as required rather than explained away. The reason is a property of the
approach: **a learned embedding cannot tell one copy of an object from another
copy of the same object**, and 37 of this plan's tables are near-identical
squares. The same encoder does earn its place for *class* — that is the second-
opinion channel, measured separately.

Scaling its say by how uncertain geometry is did buy something real: identity
precision 0.913 → **0.945**, wrong rate 0.087 → **0.055**.

**The global-transform correction ships OFF**, from measurement: +3 recovered,
+3 misapplied, precision 0.945 → 0.929. A lost decision is reported and re-made;
a wrongly applied one is invisible and corrupts a plan while looking like it
worked.

---

## SCENE GRAPH

| | |
|---|---|
| version | 2 |
| node types | physicalObject, visualFamily, logicalGroup, zone, structuralAnchor |
| edge types | belongsTo, faces, memberOf, adjacentTo, structuralElementOf, connectsTo, locatedIn |
| per-edge evidence | strength · supporting · **contradicting** · humanVerified · source · version |

An ambiguous chair association is now a **weak edge naming its competitor**
rather than an edge that looks like every other one. The sofa-faces-group edge
states its own objection out loud: proximity is not facing.

---

## ZONES

The Golden Plan is one dining floor and the product read it as **six dining
zones standing in columns** — the link distance was a fixed multiple of table
size (6.6% of the plan) against a column pitch leaving a 7.7% gap, so vertical
neighbours linked and horizontal ones did not. The yardstick is now the plan's
own spacing (the 75th percentile of nearest-neighbour gaps).

| | before | after |
|---|--:|--:|
| stability | 0.9658 | **0.9891** |
| zones on the original | 11 | **4** |
| dining zones on the original | 6 | **1** |
| zone precision (a1 / a3 / a4 / a6) | 0 / 0 / 0.091 / 0 | **1.0 / 1.0 / 1.0 / 1.0** |
| false zone inventions, all 8 fixtures | 0 | **0** |

**BAR is now a zone**, on the same rule as the stage: it exists because an object
was typed as a bar, never because a cluster looked service-ish.

---

## WHOLE PLAN

| | before | after |
|---|--:|--:|
| semantic accuracy | 0.9130 over 23 | **0.9200 over 25** |
| **fabricated STRONG facts** | 0 | **0** |
| relationship-aware facts | — | seats ambiguous, seats facing, seats tucked |
| memory-aware facts | — | decisions matched back, lost, left unapplied |

None of the new fact types is STRONG by default (§42).

**An ambiguous seat is not a contradiction**, and that is a revert this sprint
made on its own measurement: `contra:ambiguousSeat` pointed at a real error 25%
of the time — below the 28.8% rate of pointing at random — and put a fifth entry
on the clean plan. Two tables fitting a seat equally well is not two stages
disagreeing; every stage agrees the drawing is symmetric there.

---

## PERFORMANCE

| | |
|---|--:|
| a8: 324 tables / 3,240 seats, full detection + relationships + zones + interpreter | **1.8 s** |
| relationship pass | uniform grid over tables — a million naive pair tests avoided |
| 4,000 seats: guest search | 78 ms |
| 4,000 seats: seating render | 134 ms |
| 4,000 seats: live render | 260 ms |
| 4,000 seats: check-in | 33 ms |
| perf suites | 17 passed, 0 failed |

---

## OFFLINE

Both artifacts rebuilt and **driven**, not just built: `dist/index-offline.html`
(3.1 MB) and `dist/merit-offline/` (25 MB with OCR assets). Verifier **26/26** —
real OCR reads the bistro count and a Turkish venue label, the capacity loop
produces a real contradiction, and **zero off-origin requests** occur.

---

## STALE STATUS

`MERIT_PLAN_INTELLIGENCE_STATUS` was a hand-maintained list still describing the
trained encoder as "evaluated … but not integrated this pass" long after it
shipped. It is now a getter over the real runtime — detector, embedding provider,
relationship engine, memory, graph, zones, OCR — and it carries the limit that
outranks all of it.

---

## FOUR BUGS IN MY OWN MEASUREMENT

Each would have flattered a result, and each is recorded where it happened:

1. Recall reported as `0` on the fixture with no furniture, where it is 0 by
   arithmetic and means nothing.
2. Table **precision** not scored at all, so a6 passed while proposing 46
   phantom tables against 8 real ones.
3. The memory ablation filtered out rejected candidates — and a rejection
   memory's object *is* a rejected candidate, so it removed the objects a third
   of the decisions were about. Read as a product regression; wasn't one.
4. The new ambiguity fact scored against fixtures with no relationship ground
   truth, where "0 ambiguous" means "nobody annotated them".

---

## LIMITATIONS

> **REAL DISTINCT VENUE PLANS: 1**
> **CROSS-VENUE GENERALIZATION: NOT VERIFIED**
> **REAL HUMAN OPERATOR USABILITY: NOT VERIFIED** — no person has performed the
> test in `benchmarks/operator/`. The infrastructure is ready; the answer is not.

Open, with diagnoses rather than intentions:

- **a2, a5, a6 still FAIL.** Minority chair families collapse (recall 0.34);
  columns are proposed as chairs on a drawing with no furniture; repeated
  architecture at furniture scale produces 46 phantom tables. All three are
  detection-stage, upstream of everything this sprint changed.
- **a1's eight control tables are never proposed.** The surface filter rejects
  them at coverage < 0.22 against a dominant surface family the white room
  interior displaces.
- **a4 multi-room recall 0.333.** Zone clustering sees only furniture; separating
  two halls needs the wall between them, and the detector does not produce walls
  as objects.
- **Memory on transformed plans misses its gates** (0.786 / 0.945 / 0.055).
- **The learned embedding does not help object identity** and is kept for the
  transformation cases where geometry cannot reach at all.
