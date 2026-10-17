// The learned plan-symbol representation, in the browser.
//
// This is the inference half of benchmarks/embedding/. A small convolutional
// encoder — 5,656 trained parameters, trained in this repository on this
// project's own annotated plans — maps a 32x32 grayscale crop of a detected
// object to a 32-dimensional unit vector, and that vector is concatenated with
// the fourteen-number handcrafted descriptor computed on the same crop.
//
// WHY BOTH. They were measured separately and together on 2,699 crops of
// annotated ground-truth boxes across sixteen real re-renderings of the Golden
// Plan, on objects the encoder never trained on
// (benchmarks/embedding/retrieval.json):
//
//                            handcrafted   learned   both
//   same-object invariance      0.719       0.945    0.950
//   same-class retrieval        0.926       0.908    0.944
//   table-type retrieval        0.854       0.863    0.875
//
// The learned encoder is far better at knowing that two crops are the same
// physical object, which is what Plan Memory needs after a re-analysis; the
// descriptor is better at what an object is made of. Together they beat the
// descriptor on every measured number and lose on none, which is the only
// reason this ships. A representation that traded one metric for another would
// not have been promoted.
//
// WHAT trainedModel MEANS HERE. `true`, and it is true: real weights fitted by
// gradient descent are multiplied by real pixels at inference time. It does NOT
// mean a trained DOMAIN MODEL is installed — detection is still classical
// computer vision, the detector's own `trainedModel` is still false, and the
// Plan Intelligence screen still says DOMAIN MODEL NOT INSTALLED. An encoder
// that helps rank visual neighbours is not a detector, and nothing in the UI
// may describe it as one.
//
// No network, ever. The weights are inlined by scripts/build-encoder-module.mjs
// into src/plan-encoder-weights.js, so this works identically in the offline
// single-file build and behind an air gap.
(function () {
  "use strict";

  var W = globalThis.MERIT_PLAN_ENCODER_WEIGHTS || null;

  // ---- the crop ------------------------------------------------------------
  // Must match benchmarks/embedding/extract-crops.mjs exactly: the object's box
  // grown by 15% for context, box-average downsampled to 32x32 grayscale. A
  // chair is a handful of pixels on a downscaled plan, so point sampling would
  // throw most of it away.
  var SIDE = 32, MARGIN = 0.15;

  function cropOf(gray, width, height, candidate) {
    var cx = (candidate.x + candidate.w / 2) / 100 * width;
    var cy = (candidate.y + candidate.h / 2) / 100 * height;
    var w = candidate.w / 100 * width * (1 + MARGIN * 2);
    var h = candidate.h / 100 * height * (1 + MARGIN * 2);
    if (!(w > 0) || !(h > 0)) return null;
    var x0 = cx - w / 2, y0 = cy - h / 2;
    var sx = w / SIDE, sy = h / SIDE;
    var steps = Math.max(1, Math.min(4, Math.round(Math.min(sx, sy))));
    var out = new Float64Array(SIDE * SIDE);
    for (var r = 0; r < SIDE; r++) for (var q = 0; q < SIDE; q++) {
      var sum = 0, n = 0;
      for (var dy = 0; dy < steps; dy++) for (var dx = 0; dx < steps; dx++) {
        var px = x0 + (q + (dx + 0.5) / steps) * sx;
        var py = y0 + (r + (dy + 0.5) / steps) * sy;
        var xi = Math.min(width - 1, Math.max(0, Math.round(px)));
        var yi = Math.min(height - 1, Math.max(0, Math.round(py)));
        sum += gray[yi * width + xi]; n++;
      }
      out[r * SIDE + q] = Math.round(sum / n);
    }
    return out;
  }

  // ---- the encoder ---------------------------------------------------------
  function standardise(pixels) {
    var n = pixels.length, mean = 0, i;
    for (i = 0; i < n; i++) mean += pixels[i];
    mean /= n;
    var varr = 0;
    for (i = 0; i < n; i++) { var d = pixels[i] - mean; varr += d * d; }
    var sd = Math.sqrt(varr / n) || 1;
    var out = new Float32Array(n);
    for (i = 0; i < n; i++) out[i] = (pixels[i] - mean) / sd;
    return out;
  }

  // Weights arrive from the generated module as plain arrays. Converting them
  // once, on first use, keeps the inner loops on typed storage without making
  // the generated file a binary blob nobody can read in a diff.
  var TYPED = null;
  function typedWeights() {
    if (TYPED || !W) return TYPED;
    TYPED = {
      layers: W.layers.map(function (l) {
        return { out: l.out, in: l.in, k: l.k, W: Float32Array.from(l.W), b: Float32Array.from(l.b) };
      }),
      head: { W: Float32Array.from(W.head.W), b: Float32Array.from(W.head.b) },
    };
    return TYPED;
  }

  // Convolution, then ReLU fused with a 2x2 max-pool.
  //
  // The loop order is the whole performance story, and it was measured rather
  // than guessed. Written the natural way — for each output position, sum over
  // channels and kernel taps — this architecture's 721,000 multiply-
  // accumulates per crop cost 3.0ms, because every one of them re-reads a
  // weight and jumps across the input by a row stride. Inverting it so the
  // weight is hoisted out and the innermost loop walks one contiguous input row
  // against one contiguous output row is the same arithmetic with the memory
  // traffic turned the right way round.
  //
  // The output rows for a given kernel tap are a shifted window of the input
  // rows, so the shift is resolved once per (tap, row) and the inner loop has
  // no bounds test at all.
  function conv(input, inC, side, layer, scratch) {
    var outC = layer.out, k = layer.k, Wt = layer.W, b = layer.b, p = (k - 1) >> 1;
    var area = side * side;
    var out = scratch && scratch.length >= outC * area ? scratch : new Float32Array(outC * area);
    for (var f = 0; f < outC; f++) {
      var oBase = f * area, bias = b[f];
      out.fill(bias, oBase, oBase + area);
      for (var c = 0; c < inC; c++) {
        var wBase = (f * inC + c) * k * k, iBase = c * area;
        for (var ky = 0; ky < k; ky++) for (var kx = 0; kx < k; kx++) {
          var w = Wt[wBase + ky * k + kx];
          if (w === 0) continue;
          var dy = ky - p, dx = kx - p;
          // Rows and columns where input[y+dy][x+dx] is inside the image.
          var y0 = Math.max(0, -dy), y1 = Math.min(side, side - dy);
          var x0 = Math.max(0, -dx), x1 = Math.min(side, side - dx);
          for (var y = y0; y < y1; y++) {
            var orow = oBase + y * side, irow = iBase + (y + dy) * side + dx;
            for (var x = x0; x < x1; x++) out[orow + x] += w * input[irow + x];
          }
        }
      }
    }
    return out;
  }

  function reluPool2(input, ch, side, scratch) {
    var half = side >> 1, area = side * side, harea = half * half;
    var out = scratch && scratch.length >= ch * harea ? scratch : new Float32Array(ch * harea);
    for (var c = 0; c < ch; c++) {
      var iBase = c * area, oBase = c * harea;
      for (var y = 0; y < half; y++) {
        var r0 = iBase + (y * 2) * side, r1 = r0 + side, orow = oBase + y * half;
        for (var x = 0; x < half; x++) {
          var x2 = x * 2;
          var a = input[r0 + x2], bb = input[r0 + x2 + 1];
          var cc = input[r1 + x2], dd = input[r1 + x2 + 1];
          var m = a > bb ? a : bb;
          if (cc > m) m = cc;
          if (dd > m) m = dd;
          out[orow + x] = m > 0 ? m : 0;
        }
      }
    }
    return { out: out, side: half };
  }

  function normalise(v) {
    var n = 0, i;
    for (i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    var o = new Array(v.length);
    for (i = 0; i < v.length; i++) o[i] = v[i] / n;
    return o;
  }

  function encode(pixels) {
    if (!W) return null;
    var T = typedWeights();
    var act = standardise(pixels), ch = 1, side = W.arch.side;
    for (var li = 0; li < T.layers.length; li++) {
      var z = conv(act, ch, side, T.layers[li], null);
      var r = reluPool2(z, T.layers[li].out, side, null);
      act = r.out; ch = T.layers[li].out; side = r.side;
    }
    var area = side * side;
    var gap = new Float32Array(ch);
    for (var c = 0; c < ch; c++) {
      var s = 0;
      for (var i = 0; i < area; i++) s += act[c * area + i];
      gap[c] = s / area;
    }
    var dim = W.arch.embedding, e = new Array(dim);
    for (var j = 0; j < dim; j++) {
      var t = T.head.b[j];
      for (var q = 0; q < ch; q++) t += T.head.W[j * ch + q] * gap[q];
      e[j] = t;
    }
    return normalise(e);
  }

  // ---- the descriptor, on the same crop -------------------------------------
  // Deliberately NOT the app's computeVisualDescriptor: that one thresholds
  // with detection's global binary mask and reads the raw box. This reads the
  // same 32x32 crop the encoder sees, thresholded by Otsu, which is what
  // benchmarks/embedding/descriptor.mjs measured. Two halves of one vector have
  // to come from one input or the measured numbers describe something else.
  function otsu(pixels) {
    var hist = new Array(256).fill(0), i;
    for (i = 0; i < pixels.length; i++) hist[pixels[i]]++;
    var total = pixels.length, sum = 0;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = 0, thr = 128;
    for (var t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  }

  function describe(pixels) {
    var thr = otsu(pixels), side = SIDE, total = side * side;
    var filled = 0, hist = new Array(8).fill(0);
    var quadFg = [0, 0, 0, 0], quadTotal = [0, 0, 0, 0];
    for (var y = 0; y < side; y++) for (var x = 0; x < side; x++) {
      var i = y * side + x, on = pixels[i] <= thr ? 1 : 0;
      filled += on;
      hist[Math.min(7, pixels[i] >> 5)]++;
      var q = (y < side / 2 ? 0 : 2) + (x < side / 2 ? 0 : 1);
      quadTotal[q]++; quadFg[q] += on;
    }
    var edge = 0, edgeN = 0;
    for (var yy = 1; yy < side - 1; yy++) for (var xx = 1; xx < side - 1; xx++) {
      var at = function (dx, dy) { return pixels[(yy + dy) * side + (xx + dx)]; };
      var gx = -at(-1, -1) - 2 * at(-1, 0) - at(-1, 1) + at(1, -1) + 2 * at(1, 0) + at(1, 1);
      var gy = -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1);
      edge += Math.sqrt(gx * gx + gy * gy); edgeN++;
    }
    var histN = [], quads = [];
    for (var h = 0; h < 8; h++) histN.push(hist[h] / total);
    for (var k = 0; k < 4; k++) quads.push(quadTotal[k] ? quadFg[k] / quadTotal[k] : 0);
    return { fillRatio: filled / total, edgeDensity: edgeN ? edge / edgeN / 1020 : 0,
             intensityHist: histN, quadrantFill: quads };
  }

  function descriptorVector(d) {
    return [d.fillRatio, d.edgeDensity].concat(d.intensityHist, d.quadrantFill);
  }

  // ---- the provider --------------------------------------------------------
  // One crop, two representations, each unit-length before they are joined so
  // neither half can dominate on magnitude alone.
  //
  // The four descriptor fields are returned in the same SHAPE the handcrafted
  // provider returns them, because plan-intelligence.js's similarity clustering
  // reads them by name. The learned vector rides alongside as an extra field,
  // so a consumer that predates the encoder keeps working unchanged and one
  // that knows about it can use it.
  // Cached on the CROP's contents, not on the candidate's box.
  //
  // Within one detection pass every candidate is a different object, so the
  // cache does nothing and costs a hash of 1,024 bytes. The pass it exists for
  // is Re-Analyze, which runs the whole pipeline again over the same drawing:
  // the boxes are regenerated with new ids and land on the same pixels, so
  // keying on the pixels hits where keying on identity could not. Bounded, and
  // cleared wholesale when it fills, because an embedding is cheap to recompute
  // and a cache that grows without limit on a long session is not.
  var CACHE = new Map(), CACHE_MAX = 6000, cacheHits = 0, cacheMisses = 0;
  function cropKey(crop) {
    var h1 = 2166136261, h2 = 5381;
    for (var i = 0; i < crop.length; i++) {
      var v = crop[i];
      h1 = Math.imul(h1 ^ v, 16777619);
      h2 = (Math.imul(h2, 33) + v) | 0;
    }
    return ((h1 >>> 0) + ":" + (h2 >>> 0));
  }

  function embed(gray, binary, width, height, candidate) {
    var crop = cropOf(gray, width, height, candidate);
    if (!crop) return null;
    var key = cropKey(crop);
    var hit = CACHE.get(key);
    if (hit) { cacheHits++; return hit; }
    cacheMisses++;
    var learned = encode(crop);
    if (!learned) return null;
    var d = describe(crop);
    var out = { fillRatio: d.fillRatio, edgeDensity: d.edgeDensity,
                intensityHist: d.intensityHist, quadrantFill: d.quadrantFill,
                learned: learned,
                vector: learned.concat(normalise(descriptorVector(d))) };
    if (CACHE.size >= CACHE_MAX) CACHE.clear();
    CACHE.set(key, out);
    return out;
  }

  function cacheStats() { return { size: CACHE.size, hits: cacheHits, misses: cacheMisses }; }

  // ---- the visual second opinion -------------------------------------------
  //
  // An independent answer to "does this candidate look like the things we know
  // are real?", computed from the learned encoder and kept SEPARATE from the
  // classical detector's own reasoning so the two can be compared.
  //
  // IT DOES NOT DELETE ANYTHING, and that is a measured decision rather than
  // caution. benchmarks/embedding/measure-separation.mjs shows the visual
  // channel separates true tables from invented ones very well in
  // DISTRIBUTION — on `hue-shift`, 48 of 52 false tables fall below the 10th
  // percentile of the real ones. But every safe suppression rule was simulated
  // against ground truth and none earned promotion:
  //
  //   rule                          hue-shift   contrast-high   blur   jpeg-q20
  //   bottom 30% + no seats          1 / 0        2 / 0         1 / 1   7 / 5
  //   below 0.70 + no seats          3 / 0        5 / 1         1 / 1  11 / 9
  //                                  (false removed / REAL LOST)
  //
  // The false positives on those renderings HAVE seats — the chair associator
  // attached chairs to them — so a gate that requires the absence of
  // independent evidence never reaches them. And on `jpeg-q20` the channel
  // inverts: real tables score BELOW invented ones, so any rule that removes
  // anything there deletes real tables. A missed table costs an operator more
  // than a false one, so that trade is refused.
  //
  // What it does instead is state its opinion as evidence, for the
  // contradiction engine and the review queue to weigh against everything else.
  //
  // REFERENCES ARE TIERED, and the tier travels with the answer. Nothing is
  // baked in from one venue: the library is assembled at runtime from what is
  // actually trustworthy, and a plan with no human decisions yet says so.
  var REFERENCE_TIERS = ["verified", "memory", "provisional"];

  function cosine(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  // embed() returns the learned half and the descriptor half CONCATENATED, and
  // each half is normalised on its own — so the joined vector has norm ~sqrt(2)
  // and a bare dot product is not a cosine. It stays monotone in the cosine
  // while every vector has the same norm, which is why the grading came out
  // right anyway, but it reported similarities above 1 and would silently stop
  // being a cosine the moment one half is missing. Normalise once, at the
  // boundary, instead of trusting the caller.
  function unit(v) {
    var s = 0, i;
    for (i = 0; i < v.length; i++) s += v[i] * v[i];
    if (!(s > 0)) return null;
    var inv = 1 / Math.sqrt(s), out = new Array(v.length);
    for (i = 0; i < v.length; i++) out[i] = v[i] * inv;
    return out;
  }

  // Similarity is NOT a probability and is never reported as one (§15). It is
  // graded against the distribution of the plan's OWN matches for the same
  // class, because what counts as a close match depends on how legible that
  // rendering is at all: on `jpeg-q20` the true tables themselves only reach a
  // median of 0.70, so an absolute 0.75 cut would call every real table weak.
  function gradeStrength(sim, population) {
    if (sim == null || !population || population.length < MIN_POPULATION) return "unknown";
    var sorted = population.slice().sort(function (x, y) { return x - y; });
    var at = function (p) { return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]; };
    if (sim >= at(0.75)) return "strong";
    if (sim >= at(0.35)) return "moderate";
    return "weak";
  }

  // Below this, a percentile says more about the sample size than about the
  // object, so the answer is "unknown" rather than a confident-looking grade.
  var MIN_POPULATION = 8;
  var MIN_REFERENCES_PER_CLASS = 3;

  function buildSecondOpinion(references) {
    var byClass = {}, usable = [];
    for (var i = 0; i < references.length; i++) {
      var r = references[i];
      if (!r || !r.vector || !r.cls || REFERENCE_TIERS.indexOf(r.tier) < 0) continue;
      var u = unit(r.vector);
      if (!u) continue;
      var ref = { id: r.id, cls: r.cls, tier: r.tier, vector: u };
      (byClass[ref.cls] = byClass[ref.cls] || []).push(ref);
      usable.push(ref);
    }
    // A class represented by one or two examples is not a reference library,
    // it is an anecdote. Drop it rather than let a single odd crop define what
    // "looks like a column" means.
    for (var cls in byClass)
      if (byClass[cls].length < MIN_REFERENCES_PER_CLASS) delete byClass[cls];
    usable = usable.filter(function (r) { return byClass[r.cls]; });

    var tiers = {};
    for (var k = 0; k < usable.length; k++) tiers[usable[k].tier] = (tiers[usable[k].tier] || 0) + 1;

    // The nearest reference of every class, EXCLUDING the item itself: a
    // provisional reference set contains the very candidates being assessed,
    // and letting one match itself at similarity 1.0 would be the detector
    // grading its own homework (§13).
    function nearest(vector, selfId) {
      var best = null;
      for (var c in byClass) {
        var group = byClass[c];
        for (var j = 0; j < group.length; j++) {
          if (selfId && group[j].id === selfId) continue;
          var sim = cosine(vector, group[j].vector);
          if (!best || sim > best.sim) best = { cls: c, sim: sim, tier: group[j].tier, refId: group[j].id };
        }
      }
      return best;
    }

    // Two INDEPENDENT axes, the same way planning status and arrival status are
    // independent in the rest of this product. `strength` says how well this
    // crop matches anything at all on the plan; `agreement` says whether the
    // best match belongs to the class the classical pipeline chose. Collapsing
    // them lost the useful half: gating agreement behind strength hid every
    // "that is closer to a chair" on exactly the degraded renderings where the
    // detector invents most (0/6 on `hue-shift` — six invented tables flagged,
    // no real one touched). Neither axis is ever a probability.
    function finish(best, cvClass, population) {
      var strength = gradeStrength(best.sim, population);
      var agreement = cvClass == null ? null : best.cls === cvClass ? "agree" : "disagree";
      return {
        nearestClass: best.cls,
        nearestTier: best.tier,
        similarity: Number(best.sim.toFixed(3)),
        strength: strength,
        agreement: agreement,
        cvClass: cvClass || null,
      };
    }

    return {
      classes: Object.keys(byClass),
      referenceCount: usable.length,
      tiers: tiers,
      // The best tier any reference came from, which is how a consumer knows
      // whether this opinion rests on human decisions or on the detector's own
      // provisional guesses. It travels with every answer too, as nearestTier.
      bestTier: REFERENCE_TIERS.filter(function (t) { return tiers[t]; })[0] || null,

      // Single-shot form, for callers that already know the population.
      assess: function (vector, cvClass, population, selfId) {
        if (!vector || !usable.length) return null;
        var q = unit(vector);
        if (!q) return null;
        var best = nearest(q, selfId);
        return best ? finish(best, cvClass, population || []) : null;
      },

      // Two passes over the same items: find every nearest match, then grade
      // each one against the distribution of matches for ITS OWN class. A
      // chair's similarity numbers and a table's are not on the same scale and
      // must not be pooled.
      assessMany: function (items) {
        if (!usable.length) return items.map(function () { return null; });
        var raw = items.map(function (it) {
          if (!it || !it.vector) return null;
          var q = unit(it.vector);
          return q ? nearest(q, it.id) : null;
        });
        var pops = {};
        for (var a = 0; a < raw.length; a++) {
          if (!raw[a]) continue;
          var key = items[a].cvClass || "?";
          (pops[key] = pops[key] || []).push(raw[a].sim);
        }
        return raw.map(function (best, idx) {
          if (!best) return null;
          return finish(best, items[idx].cvClass, pops[items[idx].cvClass || "?"] || []);
        });
      },
    };
  }

  globalThis.MeritVisualSecondOpinion = {
    build: buildSecondOpinion,
    tiers: REFERENCE_TIERS,
    minReferencesPerClass: MIN_REFERENCES_PER_CLASS,
    minPopulation: MIN_POPULATION,
  };

  globalThis.MeritPlanEncoder = {
    available: !!W,
    weights: W,
    cropSide: SIDE,
    cropMargin: MARGIN,
    cropOf: cropOf,
    encode: encode,
    describeCrop: describe,
    embed: embed,
    cacheStats: cacheStats,
  };

  // Registered as a VisualEmbeddingProvider the moment app-v8.js has published
  // the registry. Load order in index.html puts this file first, so the
  // registration is deferred until the registry exists rather than assumed.
  globalThis.MeritRegisterPlanEncoder = function () {
    if (!W || !globalThis.MeritVisualEmbedding) return false;
    globalThis.MeritVisualEmbedding.register("learned", {
      id: W.id + "+handcrafted-descriptor-v1",
      kind: "learned-encoder + handcrafted-descriptor",
      trainedModel: true,
      label: "A " + W.parameters + "-parameter convolutional encoder trained on this project's own annotated plans, "
        + "concatenated with the geometric/intensity descriptor computed on the same crop.",
      dimensions: W.arch.embedding + 14,
      offline: true,
      licence: W.licence,
      trainedOn: W.trainedOn,
      embed: embed,
      toVector: function (d) { return d ? d.vector : null; },
    });
    return true;
  };
})();
