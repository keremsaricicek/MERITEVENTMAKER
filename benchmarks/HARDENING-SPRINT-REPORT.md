# Final Hardening Sprint — what changed and what did not

**SPRINT STATUS: PARTIAL.** Three targets met, two missed and stated, two things
that cannot be verified without a person and a second venue.

Every number is reproducible by the command beside it. `ROBUSTNESS-CURRENT.md`
remains the authoritative rendering matrix.

---

## A. PROTECTED BASELINE

Re-measured on the shipped build before anything was touched, and again after.

| | baseline | after | |
|---|--:|--:|:--:|
| Golden tables TP/FP/FN | 46 / 4 / 0 | **46 / 4 / 0** | held |
| Golden table F1 · recall | 0.958 · 1.000 | **0.958 · 1.000** | held |
| Golden chairs TP/FP · F1 | 107 / 5 · 0.951 | **107 / 5 · 0.951** | held |
| Types square / round / bistro | 37/37 · 4/4 · 5/5 | **37/37 · 4/4 · 5/5** | held |
| Columns | 6/6, precision 1.000 | **6/6** | held |
| Relationships scoreable · accuracy | 83 · 1.000, 0 orphans | **83 · 1.000** | held |
| Zone stability | 0.9658 | **0.9658** | held |
| Semantic accuracy · fabricated strong | 0.9130 · 0 | **0.9130 · 0** | held |
| Teach AI propagation / retention / wrong | 1.000 / 1.000 / 0.000 | **1.000 / 1.000 / 0.000** | held |
| Robustness median table / chair F1 | 0.877 / 0.955 | **0.877 / 0.955** | held |
| Review groups (Golden) | 6 | **6** | held |
| Detector baseline, 31 guarded fields | — | **no regressions** | held |

Review groups are **6**, not the 5 the sprint brief recalled — typing the bistro
tables correctly splits them out of the square group. A type discovery, not
effort inflation, and it predates this sprint.

---

## B. DEGRADED-IMAGE HARDENING

Two numbers, both reported. **Proposed** is every candidate the detector keeps —
what `benchmarks/robustness/` measures, and unchanged, because the detector still
proposes what it proposed. **Committed** is what lands on the floor plan if an
operator presses Confirm Plan without reviewing: the false positive they
actually pay for.

| variant | proposed TP/FP | **committed** TP/FP | gate held false/real |
|---|--:|--:|--:|
| ORIGINAL | 46/4 | **46/3** | 1/0 |
| `hue-shift` | 38/52 | **37/11** | 39/0 |
| `contrast-high` | 37/49 | **37/9** | 35/0 |
| `bright-up` | 39/48 | **37/10** | 35/0 |
| `blur` | 37/32 | **37/15** | 16/0 |
| `jpeg-q20` | 45/26 | **23/11** | 0/0 |
| `noise` | 46/16 | **46/15** | 1/0 |
| `lowres-roundtrip` | 28/14 | **9/12** | 0/0 |
| `grayscale` | 43/5 | **43/3** | 2/0 |
| `downscale-70` | 41/4 | **41/3** | 0/0 |
| `bright-down` | 24/4 | **24/4** | 0/0 |
| **all** | **254** | **96** | **129 / 0** |

### Root causes

**`hue-shift`, `bright-up`, `contrast-high`, `blur`** — one cause dominates:
45, 42, 42 and 28 of their invented tables are boxes centred on a real chair.
Pooled, 176 of 176 have seats and 174 of 176 came from a split component. Tone
separation collapses, a chair merges with its surroundings, the table pass draws
a box around it.

**`jpeg-q20`** — almost none of that. 10 unplaced, 9 between-seats, 5
architecture-edge. A different failure, which is why one threshold was never
going to serve both.

**`downscale-70`** — entirely in the chair pass: 53 chairs detected on top of
real *tables* (the table surface read as seats at 70% scale) plus 14 gap
artifacts.

### Targets

| target | result |
|---|---|
| `jpeg-q20` false tables ≤ 10 | **NOT MET** — 26 proposed, **11 committed**. The seat-containment gate does not fire there; the reduction is the pre-existing confidence threshold, which also costs 22 real tables. |
| `hue-shift` table F1 ≥ 0.80 | **NOT MET on the proposed basis** (0.559, unchanged). On the committed basis P 0.771 / R 0.804 → **F1 0.787**. |
| `downscale-70` chair FP ≤ 25 | **NOT MET** — 73, unchanged. Six fixes now priced and rejected. |
| Golden metrics protected | **MET** |
| Robustness median not regressed | **MET** — identical row for row |

---

## C. FALSE-POSITIVE TAXONOMY

`npm run benchmark:false-positives` — one cause per false positive, from
evidence independent of the detector, plus a debug image per rendering (green
true, red false with cause, orange missed) and what the pipeline knew when it
accepted each one.

| cause | tables | chairs |
|---|--:|--:|
| `on-another-class` | 176 | 53 |
| `unplaced` | 31 | 2 |
| `architecture-edge` | 20 | 0 |
| `text` | 14 | 22 |
| `between-seats` | 9 | 20 |
| `fragment` | 4 | 22 |

**The layer that accepted them.** `table:on-another-class`: source `fill` (175 of
176), split 174, seats 176, median size-agreement 0.64. `table:unplaced`: source
`tone` (31 of 31), median size-agreement 0.10, weak visual evidence on 26 of 31.

**Removed: 129 invented tables held back. Real objects harmed: 0.**

---

## D. LEARNED EVIDENCE

Unchanged in role, and the distinction is kept: **detector suppression NOT
PROMOTED; the evidence channel PROMOTED.** No detection decision depends on it.
It contributes to `contra:visualClass`, which is *allowed to downgrade a claim*
(precision 0.5870 over 46 objects) but never to remove an object.

It is not a detector and is not called one.

---

## E. SEMANTIC HARDENING

**Per-check precision** (chance on this set: 0.288):

| check | pointed at | of those false | precision | allowed to |
|---|--:|--:|--:|---|
| `contra:seatsInsideBody` | 95 | 95 | **1.0000** | downgrade |
| `contra:visualClass` | 46 | 27 | **0.5870** | downgrade |
| `contra:mixedGroupTypes` | 240 | 137 | **0.5708** | downgrade |
| `contra:emptyTablesOrphanSeats` | 104 | 37 | **0.3558** | prioritise only |
| `contra:familyOutlier` | 2 | 2 | 1.0000 | too few to trust |
| `contra:seatingInStage` | 1 | 1 | 1.0000 | too few to trust |
| `contra:orphanSeats` | 0 | 0 | — | never points at a table |

By kind: ZONE 1.000 · RELATIONSHIP 0.6925 · TYPE 0.6042 · **COUNT 0.3558**.

**SEM2 satisfied:** a check may lower a claim's confidence only if it beats
chance by half again *and* has pointed at ≥10 objects. Everything else,
including every unmeasured check, only raises review priority.

**Downgrades:** 2 claims, of which 1 wrong (0.500), against 21 undisputed of
which 1 wrong (0.048) — a downgraded claim is now **10.4× more likely to be
wrong**, up from 6.7×. Concretely, *"2 tables have no seats"* — which is true —
stopped being downgraded by the noisy COUNT check.

| | measured | target | met |
|---|--:|---|---|
| semantic accuracy | **0.9130** | ≥ 0.94 | **NOT MET** |
| fabricated `strong` facts | **0** | 0 | **MET** |
| unresolved conflicts | 4 open on the Golden Plan, all stated | — | — |

The two wrong claims need type-classification work this sprint was told not to
chase. **Rejected: family-consensus retype.** The hypothesis was that a unanimous
visual family should overrule a lone shape guess, fixing *"Also 2 rectangle"*.
Measured, every similarity family of ≥3 on the real plan is *already* unanimous
and the two mistyped tables sit in their own clusters — no family exists to
correct them at any threshold. The rule fired zero times and was removed rather
than shipped as dead code.

---

## F. ACTIVE LEARNING

Real errors reached across nine renderings:

| | first | first 3 | first 5 |
|---|--:|--:|--:|
| **shipped** | **41** | **70** | **92** |
| rank alone | 26 | 62 | 84 |
| random (200 shuffles) | 15.3 | 42.1 | 62.5 |

**AL1/AL2 were broken and are fixed.** Confirm, reject, dismiss and
confirm-family — the four most common review actions — never recomputed Plan
Intelligence, so the second question was asked as if the first had not been
answered. They do now.

That exposed a second defect: confirming the top item three times left the
**same item at the top all three times**, because a contradiction stays true
after someone acts on it. A contradiction whose every target has been ruled on
now leaves the queue.

| after | queue items | review groups | unreviewed |
|--:|--:|--:|--:|
| 0 answers | 15 | 6 | 56 |
| 1 | 14 | 6 | 55 |
| 2 | 13 | 5 | 54 |

Review groups an operator faces at once: **7**, limit 8. The largest family
behind one "apply to all" is 35 and is reported, not capped — splitting it would
give five decisions covering the same objects.

---

## G. OPERATOR TEST READINESS

> **OPERATOR TEST INFRASTRUCTURE: READY**
> **REAL HUMAN TEST: NOT PERFORMED**

`Advanced Diagnostics → Session report` renders one page: Import → Confirm,
analysis time, review time, time to first action, actions and how many landed on
the suggested queue, whether they started at the top, what is unreviewed, what
was held back, open disagreements, whether the plan was confirmed — then the
eight questions only a person can answer. Both languages, three viewports, no
page errors, **no developer console**.

Local only, asserted rather than assumed: zero off-origin requests from the
moment recording starts, no non-GET request ever, and no `fetch` /
`XMLHttpRequest` / `sendBeacon` / `WebSocket` / `EventSource` in the
operator-session code — absent, not disabled.

The ten-step flow and the questions are in `benchmarks/operator/README.md`.

---

## H. OCR CAPACITY

Reproduced on the rebuilt offline package, not taken from the previous report.

Real Tesseract reads the printed **124**. Physical and logical capacity stay
separate; nothing forces the object count to match the printed figure. A counted
80 → `fact.capacityDiffers` → a **high-severity CAPACITY contradiction** naming
both sides → the **top item** of the review queue, pointing at 8 real regions. A
count inside the auditor's tolerance (max(2, 5%)) raises nothing — the tolerance
is documented, and a first fixture at 120 vs 124 was correctly called agreement,
which is how the fixture got fixed rather than the product.

In the non-offline build OCR depends on a CDN blocked in this environment, and
the product says `ocr.unavailable` rather than inventing a figure.

---

## I. HELD-OUT READINESS

> **REAL DISTINCT VENUE PLANS: 1**
> **CROSS-VENUE GENERALIZATION: NOT VERIFIED**

`npm run benchmark:heldout -- <plan> <annotation>`. **Fail-closed verified by
breaking it**, not by reading the code:

| situation | exit | behaviour |
|---|--:|---|
| manifest unreadable, status | **2** | REFUSED |
| manifest unreadable, run | **2** | REFUSED before measuring |
| manifest intact, status | 0 | reports NOT VERIFIED |
| manifest intact, plan trained on | **1** | REFUSED, all three checks fire |

A second real plan needs no inference-code change: supply the image and its
annotation. Results append to `history.json` and are never rewritten.

---

## J. PERFORMANCE / OFFLINE / STORAGE

| | result |
|---|---|
| perf suite | **17 passed, 0 failed** |
| 4,000-seat guest search | **104 ms** (was 116) |
| 4,000-seat seating render | **159 ms** (was 173) |
| offline verifier | **26 checks, 0 failed, zero off-origin requests** |
| network in the offline artifact | none — the light build reports OCR unavailable rather than faking it |

**Storage growth, three consecutive re-analyses of the same plan:**

| | pass 1 | pass 2 | pass 3 |
|---|--:|--:|--:|
| stored analysis | 240 KB | 240 KB | 240 KB |
| whole state | 1241 KB | 1249 KB | 1256 KB |
| encoder cache entries | 164 | 164 | 164 |
| cache hits / misses | 0 / 164 | 164 / 164 | 328 / 164 |

The analysis is replaced, not appended. The content-keyed embedding cache
dedupes exactly (misses flat, hits climbing). The +8 KB per pass is the audit
log. Seat vectors backing the visual references are computed transiently and
never persisted — a suite fails if one reaches a stored object.

---

## K. TESTS

**20 suites / 500 checks**, up from 20/483 at sprint start. CI unchanged. Both
offline artifacts rebuilt and **run**, not merely built.

---

## L. GIT

Branch `claude/merit-concept3-plan-intelligence-rebirth`, existing **PR #5**. No
new PR, no new branch. Four commits this sprint.

---

## What is still not true

- **CROSS-VENUE GENERALIZATION: NOT VERIFIED.** One venue.
- **REAL OPERATOR USABILITY: NOT VERIFIED.** No person has run the test.
- **Semantic accuracy 0.9130**, not the 0.94 hoped for.
- **`downscale-70` keeps its 73 false chairs.** Six fixes priced and rejected.
- **`jpeg-q20` and `lowres-roundtrip` lose real tables to the pre-existing
  confidence threshold** — 22 and 19 respectively. Releasing them on
  corroboration recovers zero at four thresholds tried. Kept and stated.
- **No trained domain model is installed.** Detection is classical computer
  vision; the screen still says DOMAIN MODEL NOT INSTALLED.
