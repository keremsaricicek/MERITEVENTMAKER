// The Merit plan-symbol encoder: architecture, forward pass, and gradients.
//
// A small convolutional network that maps a 32x32 grayscale crop of a floor-
// plan object to a 32-dimensional unit vector. About 5,700 trained parameters —
// small enough to sit in the offline package next to the OCR assets without
// anyone noticing, and trained here, on this project's own annotated plans, so
// there is no third-party checkpoint and no dataset licence to reason about.
//
//   32x32x1  conv 5x5 x8  relu  pool2   ->  16x16x8
//            conv 3x3 x16 relu  pool2   ->   8x8x16
//            conv 3x3 x24 relu  pool2   ->   4x4x24
//            global average pool         ->   24
//            dense 24 -> 32, L2 normalise
//
// Input is standardised per crop (subtract mean, divide by standard deviation)
// before the first convolution. That is why the encoder has any chance against
// `bright-up`, `bright-down` and the contrast variants at all: an affine change
// in the paper's exposure is removed before a weight ever sees it.
//
// This file holds forward AND backward because the trainer needs both and a
// second implementation of the forward pass would be a second thing to get
// wrong. src/plan-embedding.js carries the browser forward pass, and
// tests/suites/plan-encoder.test.mjs asserts the two agree to 1e-6 on real
// crops — a parity check, not an assumption.

export const ARCH = {
  side: 32,
  conv: [
    { out: 8, k: 5, in: 1 },
    { out: 16, k: 3, in: 8 },
    { out: 24, k: 3, in: 16 },
  ],
  embedding: 32,
};

export function paramCount(arch = ARCH) {
  let n = 0;
  for (const c of arch.conv) n += c.out * c.in * c.k * c.k + c.out;
  const last = arch.conv[arch.conv.length - 1].out;
  return n + last * arch.embedding + arch.embedding;
}

// ---- initialisation --------------------------------------------------------
// He initialisation, and a seeded PRNG so a training run is reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initWeights(seed = 1, arch = ARCH) {
  const rnd = mulberry32(seed);
  const gauss = () => {
    // Box-Muller, so the initial scale is a real normal and not a uniform
    // wearing its name.
    const u = Math.max(1e-9, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const layers = arch.conv.map(c => {
    const fan = c.in * c.k * c.k;
    const scale = Math.sqrt(2 / fan);
    return { ...c, W: Float64Array.from({ length: c.out * c.in * c.k * c.k }, () => gauss() * scale),
             b: new Float64Array(c.out) };
  });
  const last = arch.conv[arch.conv.length - 1].out;
  const scale = Math.sqrt(2 / last);
  return {
    id: "merit-plan-encoder-v1",
    arch,
    layers,
    head: { W: Float64Array.from({ length: arch.embedding * last }, () => gauss() * scale),
            b: new Float64Array(arch.embedding) },
  };
}

// ---- forward ---------------------------------------------------------------
export function standardise(pixels) {
  const n = pixels.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += pixels[i];
  mean /= n;
  let varr = 0;
  for (let i = 0; i < n; i++) { const d = pixels[i] - mean; varr += d * d; }
  const sd = Math.sqrt(varr / n) || 1;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (pixels[i] - mean) / sd;
  return out;
}

function conv(input, inC, side, layer) {
  const { out: outC, k, W, b } = layer;
  const p = (k - 1) >> 1;
  const o = new Float64Array(outC * side * side);
  for (let f = 0; f < outC; f++) {
    const base = f * side * side;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      let sum = b[f];
      for (let c = 0; c < inC; c++) {
        const wBase = ((f * inC + c) * k) * k;
        const iBase = c * side * side;
        for (let ky = 0; ky < k; ky++) {
          const iy = y + ky - p;
          if (iy < 0 || iy >= side) continue;
          for (let kx = 0; kx < k; kx++) {
            const ix = x + kx - p;
            if (ix < 0 || ix >= side) continue;
            sum += W[wBase + ky * k + kx] * input[iBase + iy * side + ix];
          }
        }
      }
      o[base + y * side + x] = sum;
    }
  }
  return o;
}

function reluInPlace(a) { for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0; return a; }

function maxpool2(input, ch, side) {
  const half = side >> 1;
  const o = new Float64Array(ch * half * half);
  const arg = new Int32Array(ch * half * half);
  for (let c = 0; c < ch; c++) for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) {
    let best = -Infinity, bi = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = c * side * side + (y * 2 + dy) * side + (x * 2 + dx);
      if (input[i] > best) { best = input[i]; bi = i; }
    }
    const oi = c * half * half + y * half + x;
    o[oi] = best; arg[oi] = bi;
  }
  return { out: o, arg, side: half };
}

function l2norm(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const o = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = v[i] / n;
  return { out: o, norm: n };
}

// Returns the embedding. `tape` collects what backward needs; omit it for
// inference and nothing is retained.
export function forward(weights, pixels, tape = null) {
  const arch = weights.arch || ARCH;
  let act = standardise(pixels);
  let ch = 1, side = arch.side;
  if (tape) tape.acts = [{ act, ch, side }];
  for (const layer of weights.layers) {
    const z = conv(act, ch, side, layer);
    const preRelu = tape ? Float64Array.from(z) : null;
    reluInPlace(z);
    const pooled = maxpool2(z, layer.out, side);
    if (tape) tape.acts.push({ preRelu, relu: z, arg: pooled.arg, inAct: act, inCh: ch, inSide: side, layer });
    act = pooled.out; ch = layer.out; side = pooled.side;
  }
  // Global average pool.
  const gap = new Float64Array(ch);
  const area = side * side;
  for (let c = 0; c < ch; c++) {
    let s = 0;
    for (let i = 0; i < area; i++) s += act[c * area + i];
    gap[c] = s / area;
  }
  const e = new Float64Array(arch.embedding);
  for (let j = 0; j < arch.embedding; j++) {
    let s = weights.head.b[j];
    for (let i = 0; i < ch; i++) s += weights.head.W[j * ch + i] * gap[i];
    e[j] = s;
  }
  const { out, norm } = l2norm(e);
  if (tape) { tape.gap = gap; tape.gapSide = side; tape.gapCh = ch; tape.preNorm = e; tape.norm = norm; tape.embedding = out; }
  return Array.from(out);
}

// ---- backward --------------------------------------------------------------
export function zeroGrads(weights) {
  return {
    layers: weights.layers.map(l => ({ W: new Float64Array(l.W.length), b: new Float64Array(l.b.length) })),
    head: { W: new Float64Array(weights.head.W.length), b: new Float64Array(weights.head.b.length) },
  };
}

// dOut is the gradient of the loss with respect to the L2-NORMALISED output.
export function backward(weights, tape, dOut, grads) {
  const arch = weights.arch || ARCH;
  // Through the normalisation: d/dx (x/|x|) = (dy - y (y . dy)) / |x|
  const y = tape.embedding;
  let ydy = 0;
  for (let i = 0; i < y.length; i++) ydy += y[i] * dOut[i];
  const dPre = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) dPre[i] = (dOut[i] - y[i] * ydy) / tape.norm;

  // Dense head.
  const ch = tape.gapCh;
  const dGap = new Float64Array(ch);
  for (let j = 0; j < arch.embedding; j++) {
    grads.head.b[j] += dPre[j];
    for (let i = 0; i < ch; i++) {
      grads.head.W[j * ch + i] += dPre[j] * tape.gap[i];
      dGap[i] += dPre[j] * weights.head.W[j * ch + i];
    }
  }

  // Global average pool.
  const side = tape.gapSide, area = side * side;
  let dAct = new Float64Array(ch * area);
  for (let c = 0; c < ch; c++) for (let i = 0; i < area; i++) dAct[c * area + i] = dGap[c] / area;

  // Conv stack, last to first.
  for (let li = weights.layers.length - 1; li >= 0; li--) {
    const t = tape.acts[li + 1];
    const layer = t.layer, g = grads.layers[li];
    const inSide = t.inSide, inCh = t.inCh, outC = layer.out, k = layer.k, p = (k - 1) >> 1;

    // Through maxpool: route to the argmax, everything else zero.
    const dRelu = new Float64Array(outC * inSide * inSide);
    for (let i = 0; i < t.arg.length; i++) dRelu[t.arg[i]] += dAct[i];
    // Through relu.
    for (let i = 0; i < dRelu.length; i++) if (t.preRelu[i] <= 0) dRelu[i] = 0;

    // Through the convolution.
    const dIn = new Float64Array(inCh * inSide * inSide);
    for (let f = 0; f < outC; f++) {
      const oBase = f * inSide * inSide;
      for (let yy = 0; yy < inSide; yy++) for (let xx = 0; xx < inSide; xx++) {
        const d = dRelu[oBase + yy * inSide + xx];
        if (d === 0) continue;
        g.b[f] += d;
        for (let c = 0; c < inCh; c++) {
          const wBase = ((f * inCh + c) * k) * k;
          const iBase = c * inSide * inSide;
          for (let ky = 0; ky < k; ky++) {
            const iy = yy + ky - p;
            if (iy < 0 || iy >= inSide) continue;
            for (let kx = 0; kx < k; kx++) {
              const ix = xx + kx - p;
              if (ix < 0 || ix >= inSide) continue;
              const ii = iBase + iy * inSide + ix;
              g.W[wBase + ky * k + kx] += d * t.inAct[ii];
              dIn[ii] += d * layer.W[wBase + ky * k + kx];
            }
          }
        }
      }
    }
    dAct = dIn;
  }
}

// ---- serialisation ---------------------------------------------------------
// Plain JSON so the offline package needs no loader and no binary format, and
// so a reviewer can read the file. Rounded to 6 decimals: measured, that costs
// nothing on any retrieval metric and roughly halves the file.
export function serialise(weights, meta = {}) {
  const round = a => Array.from(a, v => +v.toFixed(6));
  return {
    id: weights.id,
    kind: "learned-encoder",
    trainedModel: true,
    arch: weights.arch,
    parameters: paramCount(weights.arch),
    layers: weights.layers.map(l => ({ out: l.out, in: l.in, k: l.k, W: round(l.W), b: round(l.b) })),
    head: { W: round(weights.head.W), b: round(weights.head.b) },
    ...meta,
  };
}

export function deserialise(json) {
  return {
    id: json.id,
    arch: json.arch,
    layers: json.layers.map(l => ({ out: l.out, in: l.in, k: l.k,
      W: Float64Array.from(l.W), b: Float64Array.from(l.b) })),
    head: { W: Float64Array.from(json.head.W), b: Float64Array.from(json.head.b) },
  };
}
