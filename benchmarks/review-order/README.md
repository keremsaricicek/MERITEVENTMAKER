# "Look at first": is the order worth following?

```
npm run benchmark:review-order   # writes report.json, non-zero exit on a failed gate
```

The review screen tells an operator what to look at first. That is a claim about
their time, and nothing checked it. An ordering no better than the order things
happened to get built in is not guidance — it is a list with a confident
heading.

So this measures the one thing that matters about an ordering: **following it,
how fast do you reach the errors that are actually there?** An error is defined
against the annotation, never against the product's own opinion of itself — a
detected table matching no annotated one (invented), or an annotated table
nothing detected (missed, attributed to the nearest surviving object, since an
operator sent to that neighbourhood is looking at the right part of the
drawing).

Three orderings over the same items, so the only variable is the order.

## Real errors reached

| variant | errors | items | **shipped** 1/3/5 | rank-only 1/3/5 | random 1/3/5 | groups |
|---|--:|--:|--:|--:|--:|--:|
| `ORIGINAL` | 4 | 14 | **2/3/3** | 2/3/3 | 0.6/1.8/2.5 | 6 |
| `jpeg-q40` | 4 | 15 | **3/4/4** | 3/4/4 | 0.6/1.7/2.3 | 7 |
| `grayscale` | 8 | 15 | **3/4/4** | 1/4/4 | 0.9/2.4/3.7 | 7 |
| `noise` | 16 | 16 | **13/16/16** | 3/16/16 | 2.2/6.7/9.8 | 6 |
| `downscale-70` | 9 | 13 | **1/3/3** | 1/3/3 | 0.8/2.8/4.2 | 6 |
| `rotate-2` | 3 | 12 | **1/1/1** | 1/1/1 | 0.4/1.1/1.7 | 7 |
| `contrast-low` | 7 | 12 | **1/2/2** | 1/2/2 | 0.8/2.2/3.6 | 6 |
| `blur` | 41 | 19 | **1/28/37** | 1/11/17 | 4.1/11.5/18.7 | 4 |
| `jpeg-q20` | 27 | 16 | **17/19/21** | 17/19/21 | 3.8/9.8/14.4 | 6 |

**Totals across all nine renderings:**

| | first item | first three | first five |
|---|--:|--:|--:|
| **shipped order** | **42** | **80** | **91** |
| rank alone | 30 | 63 | 71 |
| random (mean of 200 shuffles) | 14.1 | 39.9 | 60.8 |

| gate | measured | target | met |
|---|---:|---|---|
| first 1 beats a random order | 42 vs 14.1 | strictly more | **yes** |
| first 3 beats a random order | 80 vs 39.9 | strictly more | **yes** |
| first 5 beats a random order | 91 vs 60.8 | strictly more | **yes** |
| first 5 at least as good as rank alone | 91 vs 71 | not worse | **yes** |
| queue order stable across a re-run | true | true | **yes** |
| review groups an operator faces at once | 7 | ≤ 8 | **yes** |

One action taken on this queue reaches **three times** as many real errors as
one taken at random, and the impact ordering is worth a further **40%** over
ranking by cost class alone. `blur` is the clearest case: 28 errors after three
actions against 11 for rank alone, because the item that settles most of that
rendering is not the first one the list happened to build.

## What "impact" means, and why it is not a score

Every item on this queue costs the operator roughly the same — read it, look at
the objects, decide. So within a rank the only thing separating two items is how
much of the plan stops being unknown afterwards. Three plain quantities, compared
lexicographically:

- **facts** — claims already on screen that this answer could settle. A wrong
  sentence someone has read is the most expensive thing on the list.
- **objects** — how many candidates the answer reaches, *including propagation*:
  confirming a family of twelve is one decision, not twelve.
- **seats** — how many people hang on those objects, since a ten-top and a
  two-top are not the same mistake.

They are deliberately not folded into `objects × 1 + seats × 0.5 + facts × 3`.
That would be three invented constants presented as a ranking.

## Stable across a re-run

Candidate ids are regenerated on every analysis, so ordering that depends on
them — directly, or through build order — reshuffles the queue when an operator
re-analyses the identical plan. The tiebreak is a rounded geometry signature
instead, and the benchmark analyses the Golden Plan twice and compares the full
ordering including impact figures.

## The size of one family is reported, not capped

The largest family behind a single "apply to all" is **35 objects**. That is
left alone on purpose: splitting it into five batches of eight would give the
operator five decisions instead of one, covering exactly the same objects — a
regression dressed as a limit. What is gated is how many cards they face, which
is 7 at worst.

## The mistake this benchmark made first

The rank-only baseline was reconstructed by re-sorting the *already sorted*
list, which cannot differ from it. The first run duly reported "shipped 42,
rank-only 42" and would have concluded that impact ordering bought nothing. The
priorities now carry the position they were built in, so the comparison is
against the real previous order — which is where the 42-vs-30 came from.

## Limits

**REAL DISTINCT VENUE PLANS: 1.** Every rendering is the same drawing. This
measures whether the queue leads to this venue's own detection errors under
re-rendering, and says nothing about a venue this system has not seen. It also
measures reaching an error, not fixing one: whether a real operator resolves
faster is **NOT VERIFIED** — see `benchmarks/operator/`.
