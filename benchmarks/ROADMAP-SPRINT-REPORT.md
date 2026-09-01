# Final Intelligence Roadmap — what was measured

Supersedes nothing; it sits alongside `ROBUSTNESS-CURRENT.md`, which remains the
authoritative rendering matrix. Every number here is reproducible by the command
beside it.

---

## 1. ROBUSTNESS VERIFICATION

**Question asked:** are the bad colour/exposure numbers stale, or current?

**Answer: current.** `node benchmarks/robustness/run-robustness.mjs`

`hue-shift` really is table F1 **0.559** on the shipped build, and so are
`bright-up` 0.586, `contrast-high` 0.561, `blur` 0.643, `lowres-roundtrip`
0.636. Median across all 16 renderings: **table F1 0.877, chair F1 0.955**. That
question is closed.

**The finding that redirected the sprint:** the dominant failure is not
blindness, it is **invention**. `jpeg-q20` finds 45 of 46 tables and adds 26.
Five of the seven SEVERE renderings keep respectable recall and collapse on
precision. So the tone architecture was **not** rewritten — the evidence pointed
at a second opinion, not at a colour model.

Four stale claims were corrected in the process (bistro 0/5 → 5/5, columns 4/6 →
6/6, review groups 5 → 6, scoreable relationships 24 → 83).

---

## 2. LEARNED SECOND OPINION

`npm run benchmark:separation` · `benchmarks/embedding/SECOND-OPINION.md`

**As a detector filter: NOT PROMOTED.** Six suppression rules were simulated
against ground truth before anything was wired. Every one also removed **real**
tables on at least one rendering. Two structural reasons: the false positives
that matter *have* seats, so a "no independent evidence" precondition never
reaches them; and `jpeg-q20` inverts the channel outright. A runtime abstain
proxy was also tested and rejected (median gap negative on four renderings). Per
§19 this is recorded as a result, not retried until it passes.

**As evidence: PROMOTED.** Measured on what the shipped build actually writes,
using the reference tier the product really has on an undecided plan
(`provisional`):

| variant | weak TP/graded | weak FP/graded | weakLift | closer-to-a-chair TP/FP |
|---|--:|--:|--:|--:|
| ORIGINAL | 13/46 | 4/4 | **3.54** | 1/2 |
| `hue-shift` | 12/38 | 19/52 | **1.16** | **0/6** |
| `contrast-high` | 8/37 | 21/49 | **1.98** | **0/2** |
| `bright-up` | 8/39 | 22/48 | **2.23** | **0/4** |
| `jpeg-q20` | 7/45 | 17/26 | **4.20** | 12/3 |
| `blur` | 9/37 | 14/32 | **1.80** | **0/5** |
| `downscale-70` | 11/41 | 4/4 | **3.73** | 3/1 |

An invented table is graded `weak` **1.16× to 4.20×** more often than a real
one, on every rendering. On the four worst-invention renderings the class
channel flags 17 invented tables and raises **zero** false alarms.

References are tiered (`verified` / `memory` / `provisional`) and the tier
travels with every answer. A candidate is excluded from its own comparison, so
nothing scores 1.000 against itself (§13). Similarity is graded against the
plan's own distribution and never shown as a percentage (§15).

**`downscale-70` retest:** unchanged at 73 false chairs / chair F1 0.752. It was
kept as the hard test and the second opinion did not make it easier, because
suppression was refused.

---

## 3. CONTRADICTION / EVIDENCE ENGINE

`npm run benchmark:contradictions` · `benchmarks/contradictions/README.md`

Seven kinds — COUNT, TYPE, RELATIONSHIP, ZONE, CAPACITY, MEMORY, SEMANTIC —
each naming both disagreeing stages and where each came from, stating no
verdict, deleting nothing.

| gate | measured | target |
|---|---:|---|
| mean targeted precision | **0.4876** | above 0.2876 (pointing at random) |
| renderings where pointing beats chance | **9/9** | ≥ 70% |
| contradictions on the clean original | **3** | ≤ 4 |
| claims stated as certain while disputed | **0** | 0 |

Largest lift where it matters most: **5.36×** on the clean original, **6.25×**
on `jpeg-q40` — the renderings where a few wrong objects hide among many correct
ones.

**Fact-strength calibration** (`npm run benchmark:facts`): a claim a
disagreement lowered is **6.7× more likely to be wrong** than one nothing
disputes (0.333 vs 0.050 over 23 claims — a small sample, stated as one).

**Semantic accuracy: 0.9130, unchanged. Fabricated `strong` facts: 0.** The
roadmap's ≥0.95 target was **not reached**, and reaching it would require
detector type-classification work this sprint was told not to do. What did
change: the interpreter's one remaining wrong claim on the real plan (*"Also 2
rectangle"*) is now stated as `uncertain`, while the correct minority claims
beside it stay `likely`. The benchmark scores a claim, not its confidence, so
this cannot move the number — which is why calibration is reported separately.

---

## 4. ACTIVE LEARNING / REVIEW ORDER

`npm run benchmark:review-order` · `benchmarks/review-order/README.md`

Real errors reached, across nine renderings:

| | first item | first three | first five |
|---|--:|--:|--:|
| **shipped order** | **42** | **80** | **91** |
| rank alone | 30 | 63 | 71 |
| random (mean of 200) | 14.1 | 39.9 | 60.8 |

One action reaches **3×** as many real errors as one taken at random; ordering
by downstream impact is worth a further **40%** over cost class alone.

Impact is three plain quantities compared lexicographically — disputed claims
settled, objects reached including propagation, seats riding on them —
deliberately not a weighted score. The tiebreak is a geometry signature, not a
candidate id, and the benchmark analyses the same plan twice to prove the order
is stable.

**Review groups: 7 at worst, limit 8 — met.** The largest single family behind
one "apply to all" is 35 objects and is reported, not capped: splitting it into
five batches of eight gives the operator five decisions covering the same
objects.

---

## 5. OPERATOR USABILITY

`benchmarks/operator/README.md` · `tests/suites/operator-session.test.mjs`

> **OPERATOR TEST INFRASTRUCTURE: READY**
> **REAL OPERATOR USABILITY: NOT VERIFIED**

No person has performed this test. Sessions are recorded locally — every action,
time since the session opened, and its position in the order suggested at the
time. Entirely local: the suite asserts zero off-origin requests from the moment
recording starts, no non-GET request ever, and no `fetch` / `XMLHttpRequest` /
`sendBeacon` / `WebSocket` / `EventSource` anywhere in the code — absent, not
disabled.

The ten questions a real person has to answer are written down. Until someone
does, the second line above stands.

---

## 6. OCR CAPACITY LOOP

`node benchmarks/offline/verify-offline-package.mjs`

> **VERIFIED in the offline package**, on real Tesseract output.

The loop runs end to end: real OCR reads the printed **124**; a counted 80
becomes `fact.capacityDiffers`, then a high-severity CAPACITY contradiction
naming both sides, then the **top item** of the review queue pointing at 8 real
regions. A count inside the auditor's tolerance raises nothing.

In the non-offline build, OCR depends on a CDN that is blocked in this
environment, and the product says `ocr.unavailable` rather than fabricating a
figure — which the light-build check asserts.

---

## 7. HELD-OUT VENUE

`npm run benchmark:heldout` · `benchmarks/heldout/README.md`

> **REAL DISTINCT VENUE PLANS: 1**
> **CROSS-VENUE GENERALIZATION: NOT VERIFIED**

The harness exists **before** a second plan does, so the first run on one is a
measurement rather than an improvised script. It refuses any plan the encoder
was trained on or already in the corpus — by image bytes, by plan id, and by the
encoder's own manifest — and any plan benchmarked before under a different
annotation. **No override flag.** Results append to `history.json` and are never
rewritten.

Verified by running it against the Golden Plan, where all three checks fire.

---

## What each phase got wrong first

Every one of these was caught by measuring, not by review.

| phase | the mistake | how it surfaced |
|---|---|---|
| 2 | the "cosine" was a bare dot product over vectors of norm √2, reporting similarities above 1 | a contract test asserting similarity ≤ 1 |
| 2 | agreement was gated behind strength, hiding the class signal on the four worst renderings | measuring the raw signal separately: 0/6, 0/2, 0/4, 0/5 |
| 3 | the ZONE check compared zone bounding boxes and flagged an entire correct dining area on the clean original | it fired where the detector is nearly perfect |
| 3 | the first calibration downgraded almost everything, including a true and robust claim | reading what it did to `tableTypeMix` |
| 3 | contradiction sides shipped as English literals under a Turkish headline | the benchmark rendered the structure directly and printed a raw key |
| 4 | the rank-only baseline was reconstructed from the already-sorted list and could not differ from it | "shipped 42, rank-only 42" on every rendering |
| 4 | the batch gate was written as "no group larger than 8" and failed everywhere | it is the wrong limit — a family is one decision |
| 5 | the network assertion demanded zero off-origin traffic and failed on the build's own vendor CDN loads | asserting the wrong thing loudly |
| 6 | the "differs" fixture was 4 seats off a 124 total, inside the auditor's 5% tolerance | the auditor correctly called it agreement |
| 7 | the leakage guard read the manifest with a regex that silently matched nothing, so its main check passed by default | an empty "trained on" line in the status output |

---

## Standing totals

| | |
|---|---|
| regression suites / checks | **20 / 483** (from 18 / 393) |
| detector baseline | **no regressions**, 31 guarded fields |
| robustness matrix | **unchanged row for row** — an evidence-only channel changed no detection |
| offline verifier | **26 checks, zero off-origin requests** |
| performance | render and 4,000-seat guards unchanged |
| new benchmarks | separation, contradictions, review-order, held-out |

## What is still not true

- **Cross-venue generalization: NOT VERIFIED.** One venue.
- **Real operator usability: NOT VERIFIED.** No person has done the test.
- **Semantic accuracy 0.9130, not the 0.95 the roadmap hoped for.**
- **No trained domain model is installed.** Detection remains classical computer
  vision, the screen still says DOMAIN MODEL NOT INSTALLED, and the learned
  encoder is a visual representation — not a detector.
