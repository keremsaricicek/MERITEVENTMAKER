# Semantic zones, measured

```
npm run benchmark:zones
```

Writes `report.json`. Exits non-zero if the stability gate or an honesty check
fails.

A zone is a region of the room with a job — dining, bistro, lounge, stage,
entrance — and `unknown` when nothing warrants a name. It is the product telling
an operator what a part of the room is *for*, which is exactly the kind of
statement that has to carry evidence or not be made.

## Results

| | measured | gate | met |
| --- | ---: | ---: | --- |
| stability across 16 renderings | **0.9658** (621 of 643 object/rendering pairs) | ≥ 0.90 | **yes** |
| every zone states its evidence | yes | required | yes |
| zone seats never exceed detected seats | yes | required | yes |
| entrance zones invented without OCR | **0 of 16** | 0 | yes |

Zone types found in all sixteen renderings: `stage` (16/16), `dining` (16/16).
`bistro` in 8/16 — it depends on the bistro tables being typed, which degraded
renderings do not always manage. `unknown` in 6/16, which is the honest answer
appearing where it should.

## How stability is measured, and the version that was wrong

The first version compared the multiset of zone types across renderings —
"three bistro, six dining, two stage" — and scored **1 of 16**. That is the
wrong question, and the number was meaningless rather than alarming.

How a room happens to partition into clusters depends on which tables the
detector found in *that* rendering. The dining-zone count swings between 3 and
13 across the sixteen images without anything about the room being read
differently: it measures detection recall wearing a zone's clothing.

The well-posed question is object-level. Table `t012` is in the same part of the
same room in all sixteen images, so whatever kind of area it belongs to, that
kind must not change. Every rendering annotates the **same object ids**, which
is what makes the comparison possible, and each object is compared against its
own modal reading rather than against the original's, so one odd rendering
cannot define the truth for the other fifteen.

The 22 disagreements are all `dining` versus `unknown` on a single degraded
rendering — a cluster whose tables lost their seats and was therefore reported
as undetermined rather than guessed. That is the design working.

**Zone count instability is real and is reported separately** (7 to 29 across
the renderings, 11 on the original) rather than folded into the score, because
it is a property of detection recall on a degraded image.

## Why there is no hand-labelled zone ground truth

Because the stability measurement does not need one, and one would be weaker.

Every rendering is the *same drawing*. Whatever the right zones are, they are
identical across all sixteen, so any disagreement is the product's and not an
annotation's — a fact rather than an opinion. A zone ground truth for this plan
would have to be derived from the annotation's own object positions by a
clustering rule, and measuring a clustering detector against a clustering
annotation is close to measuring an assumption against itself.

What this does **not** establish: whether the zones are the ones a hospitality
manager would draw. That needs a second real venue and a person who knows the
room. **REAL DISTINCT VENUE PLANS: 1.**

## The rules the inference follows

- **Evidence or nothing.** Every zone carries the facts that typed it, in words,
  and a confidence in words (`strong` / `likely` / `uncertain`) rather than an
  invented number.
- **Plan-relative, never absolute.** Clusters link at 1.5× *this plan's* modal
  table side, so a zone is not a distance in pixels and survives an export at
  another scale.
- **Nothing is inferred from a name.** An entrance zone exists only where OCR
  actually read entrance wording or a human confirmed an entrance object. On a
  build with no OCR there is no entrance zone rather than a guessed one.
- **`unknown` is an answer.** A cluster of tables with no detected seats is
  reported as an undetermined region, not guessed into a dining room. Dropping
  it would be the dishonest option.
- **A zone type is never "small table = bistro".** The zone takes its type from
  its members' modal *table type*, and those were typed upstream on evidence
  from three separate pipeline stages.

`tests/suites/plan-intelligence-contract.test.mjs` pins all of it: the
vocabulary, the evidence, the confidence wording, no invented entrance, seats
never exceeding what the detector found, every table inside exactly one zone,
and no object claimed by two.
