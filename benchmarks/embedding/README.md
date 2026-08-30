# Gate G — VisualEmbeddingProvider, licensing, and whether a model is justified

```
python3 -m http.server 8000
node benchmarks/embedding/measure-descriptor-baseline.mjs
```

Writes `baseline.json`. Re-run it before proposing any learned model.

## What shipped

`MeritVisualEmbedding` in `src/app-v8.js` is the boundary a real learned
embedding would plug into, so swapping one in is a provider registration rather
than a rewrite of the similarity clustering. Detection now obtains descriptors
through `resolveVisualEmbeddingProvider()`, not by calling the pixel function
directly.

`register(id, provider)` **requires** `trainedModel` to be declared explicitly
and throws without it. The honesty rules downstream key off that flag rather
than off a provider's name, so a provider cannot omit it and be quietly treated
as a model — or quietly treated as not one.

Exactly one provider is installed and **it is not a model**:

| | |
| --- | --- |
| id | `handcrafted-descriptor-v1` |
| kind | `handcrafted-descriptor` |
| trainedModel | `false` |
| dimensions | 14 — fill ratio, edge density, 8 intensity-histogram bins, 4 quadrant fills |
| licence | none — computed in-product, no third-party weights |

Calling this an embedding would be false, and the project's rules forbid
describing a pixel histogram as one. `kind` and `trainedModel` say what it is.

## Is a learned model justified? Measured: no.

Before shipping tens of megabytes of weights into an offline package there has
to be a number the model must beat. Measured on real data, matching every
detection to its annotated ground-truth object and scoring how well the
descriptor separates classes:

| plan | matched objects | classes | silhouette | 1-NN accuracy |
| --- | ---: | --- | ---: | ---: |
| merit-real-venue | 42 | 37 square, 4 round, 1 entrance | 0.525 | **1.000 (41/41)** |
| adversarial-text | 12 | 12 square | — | — |
| adversarial-architecture | 10 | 10 round | — | — |

1-NN accuracy is the metric that matters, because nearest-neighbour in
descriptor space is exactly what the similarity clustering does. It is already
**perfect** on the only plan that has more than one class. There is no measured
headroom for a model to capture, so shipping ~30–90MB of weights to improve a
1.000 is not defensible.

**Limits of that claim, stated rather than buried.** It rests on one plan and
41 objects. The classes present — square vs round vs entrance — are visually
very distinct; the silhouette of 0.525 shows the clusters do overlap, and 1-NN
is the more forgiving of the two metrics. The discrimination that would
actually be hard, sofa vs bench vs banquette, is not represented in any
annotation yet. The two synthetic fixtures are single-class and cannot
contribute a separation number at all. So this is evidence that a model is not
justified *today*, not proof that one never will be.

The harness is committed so that decision gets revisited on evidence: when a
plan appears where 1-NN drops, that is the moment to reopen this.

## Licence matrix

Researched against primary sources, because this is the part that is expensive
to get wrong.

| candidate | code licence | **weights** licence | commercially usable | notes |
| --- | --- | --- | --- | --- |
| **DINOv2** (ViT-S/14, 21M params) | Apache-2.0 | **Apache-2.0** | **Yes** | The repo README states plainly: *"DINOv2 code and model weights are released under the Apache License 2.0."* Originally CC-BY-NC and relicensed after community pressure. Pretrained on LVD-142M (142M images), not ImageNet-1k — which is what keeps the weights clean. Requires shipping the Apache-2.0 text and NOTICE. |
| MobileNetV3 / ResNet via **timm** or **torchvision** | Apache-2.0 / BSD | **ImageNet-derived — restricted** | **No, not safely** | The permissive code licence is the easy half and the misleading half. ImageNet's access agreement binds researchers to *non-commercial research and educational purposes*, and binds their for-profit employer too. Whether trained weights are a derivative work of the dataset is genuinely unsettled; the field leans on a fair-use argument, not on permission. For internal hospitality software that is an unnecessary risk. |
| **CLIP** (OpenAI) | MIT | MIT | Yes | ~350MB for ViT-B/32. Far too large for an offline package whose whole point is being copyable to a venue laptop. |
| **ONNX Runtime Web** (runtime, not a model) | **MIT** | n/a | **Yes** | Would be the inference engine for any of the above. Confirmed obtainable here from the npm registry (32MB tarball). |

The headline: **the code licence is not the licence that matters.** MobileNet
and ResNet look permissive and are not, because the constraint travels with the
training data rather than the source. DINOv2 is the one candidate that is clean
on both counts, and it is clean specifically because Meta relicensed it *and*
trained it off ImageNet.

## Secondary blocker: the weights are not obtainable here

Distinct from the "not justified" finding above, and worth recording separately
so nobody mistakes one for the other.

| source | result |
| --- | --- |
| `huggingface.co` (DINOv2 weights) | blocked by the egress proxy |
| `github.com/onnx/models` raw | 403 |
| `cdn.jsdelivr.net` | blocked |
| `registry.npmjs.org` | **reachable** — ONNX Runtime Web downloads fine |
| `storage.googleapis.com/tfjs-models` | **reachable** — but only serves ImageNet-trained weights, which the matrix above rules out |

This is a limit of *this sandbox*, not of the product. A developer machine with
normal network access could fetch DINOv2 and vendor it the same way
`build-offline-full.mjs` already vendors Tesseract. It is not the reason a model
is not shipping; the measurement is.

## If a model is ever added

1. Re-run `measure-descriptor-baseline.mjs` first and record the number to beat.
2. Register it through `MeritVisualEmbedding.register()` with
   `trainedModel: true`.
3. Vendor the weights at build time into `dist/merit-offline/assets/`, next to
   the OCR assets, and ship the Apache-2.0 text and NOTICE alongside them.
4. Re-run `benchmarks/offline/verify-offline-package.mjs` — a model that needs
   the network at runtime breaks the offline guarantee and must fail that check.
5. Only then may the UI describe the representation as learned, and only if
   `trainedModel` is genuinely true. "DOMAIN MODEL NOT INSTALLED" stays the
   honest state until a model is actually running.

## Sources

- [facebookresearch/dinov2 README and LICENSE](https://github.com/facebookresearch/dinov2)
- [ImageNet access agreement](https://image-net.org/accessagreement)
- [timm (pytorch-image-models)](https://github.com/huggingface/pytorch-image-models)
- [torchvision MobileNetV3](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.mobilenet_v3_large.html)
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)
