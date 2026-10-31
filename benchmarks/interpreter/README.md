# The whole-plan interpreter, scored

```
npm run benchmark:facts
```

Writes `report.json`. Exits non-zero if any gate fails.

Everything else in Plan Intelligence answers a question about one object, one
pair, or one region. This answers questions about the **drawing**: what kind of
room is this, how many people does it seat, what is unresolved, what should a
person look at first. Those are the questions an operator opens a plan with, and
until now the product could answer none of them in words.

## Results

| | measured | gate | met |
| --- | ---: | ---: | --- |
| semantic-fact accuracy | **0.9130** (21 of 23 checkable) | ≥ 0.90 | **yes** |
| fabricated `strong` facts | **0** | 0 | **yes** |
| facts rendering as a raw key or unfilled placeholder, EN or TR | **0** | 0 | **yes** |

The two gates are deliberately asymmetric. Accuracy is a quality number. A
fabricated `strong` fact is a product that lies with confidence, and **one is a
failure**.

## Every fact carries three things

- **strength** — `strong` / `likely` / `uncertain`, and `strong` has to be
  earned. A strong fact is one where the evidence is direct, so being wrong
  about it is a serious defect and this benchmark scores it as one.
- **provenance** — which pipeline stage produced the evidence, in words, shown
  next to the claim rather than buried in a diagnostics panel.
- **basis** — the actual numbers, so nothing has to be taken on trust.

Statements are structured (`key` + `params`), never pre-rendered English: the
domain layer does not decide what language an operator reads. Every fact is
rendered in both EN and TR by the benchmark and by the contract suite.

## The failure this benchmark caught on its first run

`fact.tableMix` said **"18 tables, most of them square"** on the bistro fixture,
at `strong` strength. The annotation has **23** tables — the detector finds 18,
because that fixture's five synthetic bistro tables are its known misses.

The design error was bundling two claims of very different reliability into one
sentence under one strength:

- **which type dominates** is a property of the drawing. A large majority does
  not flip because a few tables were missed.
- **how many tables there are** is bounded by detection recall and can never be
  better than it.

They are now two facts. `fact.tableTypeMix` is checked exactly, with no slack,
and may be `strong`. `fact.tableCount` is allowed detection slack and is never
`strong`. `tests/suites/plan-intelligence-contract.test.mjs` pins that rule
directly: no count fact may ever be stated as certain.

That is the whole point of building the benchmark before trusting the feature.

## Unchecked is not the same as correct

A fact the annotation cannot settle is scored **neither way**, with the reason
recorded — marking those correct would inflate the number with things nobody
verified. Currently unchecked, and why:

| fact | why it cannot be scored |
| --- | --- |
| "the drawing's capacity figure was not read, because OCR did not run" | a statement about the run, not about the plan |
| "N areas could not be identified" | an admission of uncertainty, which an annotation cannot contradict |
| "N pieces of seating whose capacity a drawing cannot show" | banquette seat counts are not annotated — the annotation says so itself |
| lounge and entrance zones | the annotation records no such areas on these plans |
| seats, on the synthetic fixtures | those fixtures annotate no chairs |

## The one wrong fact that remains

On the real plan: **"Also 2 rectangle."** The annotation has no rectangle
tables, so two tables are mistyped. It is stated at `likely`, not `strong`,
which is the correct confidence for a claim that rests on type classification —
and it costs accuracy, as it should.

## Limits

One venue and four synthetic fixtures. **REAL DISTINCT VENUE PLANS: 1.** The
accuracy figure is over 23 checkable claims, which is a small number: it can
detect a systematically wrong interpreter, not a subtly miscalibrated one.
