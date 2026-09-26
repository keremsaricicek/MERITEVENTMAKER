# Does the result depend on the page being turned the right way up first?

```
node benchmarks/annotate/ornek-raw-frame.mjs        # regenerate the annotation
node benchmarks/run-benchmark.mjs --annotations benchmarks/rotation/annotations \
     --out benchmarks/rotation/report.json
```

ORNEK.pdf stores its page portrait, with the plan lying on its side. The frozen
ground truth was made on the upright rendering, because that is how a human
reads the drawing — which means every headline number for this plan has been
measured on a page that was turned the right way up **for** the system.

Whether that mattered is a question to measure, not to assume.

`annotations/ornek-symbolic-raw.json` is **not new ground truth**. It is
`benchmarks/annotations/ornek-symbolic.json`'s own human-reviewed geometry with
the 90-degree rotation applied that the frozen file itself records:

```
raw(x,y) = ( 1719 - upright.y , upright.x )
```

so both runs are scored against the same human review, in different
coordinates. It is regenerated from the frozen file and must never be edited
independently of it.

## Why it lives here and not in benchmarks/annotations/

It is the **same drawing**. Left in the main annotation directory it would be
counted as a second plan in every aggregate — semantic accuracy, fabricated
facts, plan counts — and one venue would quietly weigh twice. The Golden Plan's
transformed variants are kept out of the main set for exactly this reason; this
follows that precedent.

**REAL DISTINCT VENUE PLANS: 2.** This directory does not add a third.

## Measured

| | upright page | raw page, as it arrives |
|---|---|---|
| tables found | 132 of 166 | 110 of 166 |
| precision | 1.000 | 1.000 |
| recall | **0.795** | **0.663** |
| F1 | 0.886 | 0.797 |
| chairs invented (plan draws none) | 0 | 0 |
| representation | SYMBOLIC | SYMBOLIC |

Orientation costs **22 tables, 13 points of recall** — a real cost, and not a
collapse. Precision holds at 1.000, the plan is still read as symbolic, and no
chair is invented either way, so the reasoning built in this sprint does not
depend on the page having been straightened first.

That is what ranks orientation normalisation where it is: worth doing, and
worth doing after the work that lets the system state what the drawing prints
about itself. It is not the reason this plan was unreadable.
