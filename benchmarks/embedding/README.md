# The visual representation: what ships, what it beat, and how to re-measure

```
node benchmarks/embedding/extract-crops.mjs        # build the crop corpus (derived, gitignored)
node benchmarks/embedding/train-encoder.mjs --gradcheck
node benchmarks/embedding/train-encoder.mjs        # ~45s, writes encoder-weights.json
node scripts/build-encoder-module.mjs              # inline the weights into src/
node benchmarks/embedding/retrieval-benchmark.mjs  # the numbers below
```

## What ships

A **trained** representation, and the word is used literally: 5,656 parameters
fitted by gradient descent, multiplied by real pixels at inference time.

| | |
| --- | --- |
| id | `merit-plan-encoder-v1+handcrafted-descriptor-v1` |
| kind | `learned-encoder + handcrafted-descriptor` |
| `trainedModel` | **true** |
| dimensions | 46 — a 32-d learned embedding, plus the 14-number descriptor |
| parameters | 5,656 |
| size in the offline package | 54 KB, inlined, never fetched |
| licence | **trained in this repository on this project's own annotated plans** |
| training data | 112 objects of the Golden Plan across 16 real re-renderings, 1,792 crops |
| held out | 52 objects, and all four fixture plans entirely |

### What `trainedModel: true` does not mean

It does not mean a trained **domain model** is installed. Detection is still
classical computer vision, `analysis.trainedModel` is still `false`, and the
Plan Intelligence screen still says **DOMAIN MODEL NOT INSTALLED**. An encoder
that ranks visual neighbours is not a detector.
`tests/suites/plan-encoder.test.mjs` asserts both halves of that at once.

## The architecture

```
32x32x1   standardise per crop      (removes exposure and contrast)
          conv 5x5 x8   relu pool2  ->  16x16x8
          conv 3x3 x16  relu pool2  ->   8x8x16
          conv 3x3 x24  relu pool2  ->   4x4x24
          global average pool       ->   24
          dense 24 -> 32, L2 normalise
```

Trained with InfoNCE: an anchor is a crop of one annotated object in one
rendering, its positive is the **same object in a different rendering**, and
the negatives are the other objects in the batch. No synthetic augmentation is
used anywhere — the positive pairs are the Golden Plan genuinely re-rendered by
`benchmarks/robustness/make-variants.mjs` (blurred, rescaled, recoloured, JPEG
compressed, rotated), so what the encoder learns to ignore is what a real
export or scan really does to a drawing.

The backward pass is hand-written, so it is checked against finite differences
before anything is trained on it (`--gradcheck`, worst relative error 3.3e-7 on
gradients up to 9.3e-3). An earlier version of that check sampled six
near-identical crops, saturated the softmax, and passed on gradients of 1e-18
against a numeric zero — it now fails if every numeric gradient is zero, because
a check that cannot fail is not a check.

## What it beat

Measured on 2,699 crops of annotated ground-truth boxes across 21 images, on
**objects the encoder never trained on**. Top-1 retrieval accuracy:

| | handcrafted | learned | **both** |
| --- | ---: | ---: | ---: |
| same-object invariance | 0.7188 | 0.9447 | **0.9495** |
| same-class retrieval | 0.9255 | 0.9075 | **0.9435** |
| table-type retrieval | 0.8542 | 0.8625 | **0.8750** |
| *held-out plans*, same-class | 1.0000 | 1.0000 | **1.0000** |
| *held-out plans*, top-5 purity | 0.9573 | 0.9947 | **0.9947** |

The learned encoder alone is far better at knowing two crops are the same
physical object and slightly **worse** at same-class retrieval. That trade is
why it did not ship alone: a representation that hands back one number to buy
another has not earned promotion, and the trade is invisible in an average.
Concatenated with the descriptor, the worst movement on any measured metric is
**+0.0000** — it wins or ties everywhere. That is the whole promotion argument.

### Why these two metrics

They are what the product does with a representation, not proxies for it:

- **Same-object invariance** is Plan Memory. A human corrects an object, the
  plan is re-analysed, and the correction has to land back on the same object.
  It was the weakest number the old descriptor had, and nothing measured it.
- **Same-class retrieval** is Teach AI propagation. A human judges one object
  and the decision spreads to the ones that look like it.

The query's own crops are removed from the gallery entirely in the same-class
test, so nothing can score by finding itself.

## What this supersedes

An earlier pass measured 1-NN class accuracy on 41 matched objects of one plan,
got **1.000**, and concluded there was no headroom for a model. That measurement
was not wrong; it was narrow. Three visually very distinct classes (square,
round, entrance) on 41 objects is an easy problem, and it left out the two
things a representation is actually used for. Measured properly — over 2,699
crops, including all 113 chairs and three chair families, and including
invariance across real re-renderings — the same descriptor scores **0.719** on
the metric Plan Memory depends on.

The old conclusion also assumed any model meant "ship 30–90 MB of third-party
weights". That framing is what made the answer no. Training a domain-specific
encoder on this project's own annotated plans costs 54 KB and no licence
question at all.

## Licence matrix — still valid, and now not needed

Researched against primary sources. It is kept because the reasoning still
applies to any future candidate, and because the **code licence is not the
licence that matters**.

| candidate | code licence | **weights** licence | commercially usable | notes |
| --- | --- | --- | --- | --- |
| **`merit-plan-encoder-v1`** (what ships) | this repo | **this repo** | **Yes** | Trained here on this project's own annotated plans. No third-party weights, no third-party dataset, nothing to attribute. |
| **DINOv2** ViT-S/14, 21M params | Apache-2.0 | **Apache-2.0** | Yes | The repo README states plainly: *"DINOv2 code and model weights are released under the Apache License 2.0."* Originally CC-BY-NC and relicensed after community pressure. Pretrained on LVD-142M, not ImageNet-1k, which is what keeps the weights clean. Would require shipping the Apache-2.0 text and NOTICE. |
| MobileNetV3 / ResNet via **timm** or **torchvision** | Apache-2.0 / BSD | **ImageNet-derived — restricted** | **No, not safely** | The permissive code licence is the easy half and the misleading half. ImageNet's access agreement binds researchers to *non-commercial research and educational purposes*, and binds their for-profit employer too. Whether trained weights are a derivative work of the dataset is genuinely unsettled; the field leans on a fair-use argument, not on permission. |
| **CLIP** (OpenAI) | MIT | MIT | Yes | ~350MB for ViT-B/32. Far too large for a package whose point is being copyable to a venue laptop. |
| **ONNX Runtime Web** (runtime, not a model) | **MIT** | n/a | Yes | Would be the inference engine for any of the above. Not needed: a 5,656-parameter forward pass is ~90 lines of JavaScript, so the product ships no inference runtime at all. |

Egress from this sandbox, re-checked at the time of writing: `huggingface.co`
unreachable, `storage.googleapis.com/tfjs-models` 403, `registry.npmjs.org` and
`raw.githubusercontent.com` reachable. None of it mattered in the end — nothing
is downloaded, at build time or at run time.

## Runtime

No network, at any point. The weights are inlined into
`src/plan-encoder-weights.js` by `scripts/build-encoder-module.mjs`, because a
`fetch()` for a weights file works in the normal build and dies in the offline
single-file one. `benchmarks/offline/verify-offline-package.mjs` runs the
forward pass **inside the built artifact** and asserts it returns a unit vector
with zero off-origin requests.

Cost, measured on the real plan's 99 candidates: ~2.4 ms per crop, ~240 ms for
the plan, reported per run as `diagnostics.embedding.embeddingMs`. The
convolution's loop order accounts for most of that — hoisting the weight out of
the innermost loop so it walks contiguous rows, rather than summing per output
position, is the same arithmetic with the memory traffic the right way round.
Embeddings are cached on the crop's **contents**, which does nothing within one
pass (every candidate is a different object) and hits on Re-Analyze, where the
same drawing produces the same pixels under new candidate ids.

## Honesty rules this file is bound by

- `register()` refuses a provider that will not declare `trainedModel`. Nothing
  downstream keys off a provider's name.
- Both providers stay registered, so the comparison above stays runnable rather
  than becoming a claim about a build that no longer exists.
- If `src/plan-encoder-weights.js` is absent, the app resolves to the
  handcrafted descriptor and the diagnostics say so. It does not pretend.
- **REAL DISTINCT VENUE PLANS: 1.** The held-out-plans column is four synthetic
  fixtures, not four venues. Cross-venue generalization remains **NOT
  VERIFIED**, and a 0.9495 on one venue's held-out objects is not evidence
  about the next venue.

## The second opinion

`npm run benchmark:separation` asks the question this encoder was built to
answer at detection time: can it tell a real table from an invented one? The
answer split in two — **not as a filter, yes as evidence** — and both halves,
with the ground-truth simulations behind them, are in
[`SECOND-OPINION.md`](SECOND-OPINION.md).
