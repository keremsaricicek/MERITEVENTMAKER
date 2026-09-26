// Train the Merit plan-symbol encoder.
//
//   node benchmarks/embedding/train-encoder.mjs --gradcheck   # verify the maths first
//   node benchmarks/embedding/train-encoder.mjs
//
// The objective is the thing the product actually needs and the thing the
// handcrafted descriptor is measurably worst at: recognising that two crops are
// the SAME physical object seen in two different renderings. Same-object
// invariance top-1 for `handcrafted-descriptor-v1` is 0.719 on held-out
// objects, and Plan Memory's ability to re-find a corrected object after a
// re-analysis rests directly on it.
//
// InfoNCE over genuine re-renderings. An anchor is a crop of object O in one
// rendering, its positive is the same O in another, and the negatives are the
// other objects in the batch. No synthetic augmentation is used anywhere: the
// positive pairs are the Golden Plan actually re-rendered by
// benchmarks/robustness/make-variants.mjs, so what the encoder learns to
// ignore is what a real export, scan or screenshot really does to a drawing.
//
// TRAINED ON one venue's objects, and only the objects on the training side of
// the split. The four synthetic fixtures are never trained on, so the
// retrieval benchmark's "held-out plans" split is genuinely zero-shot. One real
// venue is what this project has, and no amount of training changes that: see
// the generalization section of any sprint report.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCrops } from "./extract-crops.mjs";
import { objectSplit } from "./retrieval-benchmark.mjs";
import { ARCH, initWeights, forward, backward, zeroGrads, serialise, paramCount, mulberry32 } from "./encoder.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const optOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = n => argv.includes(n);

const EPOCHS = +optOf("--epochs", 60);
const BATCH = +optOf("--batch", 48);
const LR = +optOf("--lr", 0.004);
const TAU = +optOf("--tau", 0.12);
const SEED = +optOf("--seed", 7);

// ---- InfoNCE ---------------------------------------------------------------
// logits[i][j] = (anchor_i . positive_j) / tau, target j = i. Returns the loss
// and the gradient with respect to every anchor and positive embedding.
function infoNCE(anchors, positives, tau) {
  const n = anchors.length, d = anchors[0].length;
  const logits = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < d; k++) s += anchors[i][k] * positives[j][k];
      row[j] = s / tau;
    }
    logits.push(row);
  }
  let loss = 0, correct = 0;
  const dA = anchors.map(() => new Float64Array(d));
  const dP = positives.map(() => new Float64Array(d));
  for (let i = 0; i < n; i++) {
    let max = -Infinity, best = 0;
    for (let j = 0; j < n; j++) if (logits[i][j] > max) { max = logits[i][j]; best = j; }
    if (best === i) correct++;
    let sum = 0;
    const p = new Float64Array(n);
    for (let j = 0; j < n; j++) { p[j] = Math.exp(logits[i][j] - max); sum += p[j]; }
    for (let j = 0; j < n; j++) p[j] /= sum;
    loss -= Math.log(Math.max(1e-12, p[i]));
    for (let j = 0; j < n; j++) {
      const g = (p[j] - (j === i ? 1 : 0)) / (tau * n);
      for (let k = 0; k < d; k++) {
        dA[i][k] += g * positives[j][k];
        dP[j][k] += g * anchors[i][k];
      }
    }
  }
  return { loss: loss / n, accuracy: correct / n, dA, dP };
}

// ---- gradient check --------------------------------------------------------
// Finite differences against the analytic gradient, on real crops. Manual
// backprop that is subtly wrong still trains to something plausible, so this
// runs before any weights are believed.
function gradcheck(crops) {
  const w = initWeights(3);
  // Six DIFFERENT objects, spread across the corpus. Taking the first six
  // crops instead takes six near-identical round tables from one fixture: the
  // softmax saturates, every gradient comes out at 1e-18 against a numeric
  // zero, and the check passes without having tested anything. A check that
  // cannot fail is not a check, so the loss magnitude is asserted too.
  const spread = [];
  const seen = new Set();
  for (let i = 0; i < crops.length && spread.length < 6; i += Math.max(1, Math.floor(crops.length / 47))) {
    const c = crops[i];
    if (seen.has(`${c.plan}|${c.objectId}`)) continue;
    seen.add(`${c.plan}|${c.objectId}`);
    spread.push(c);
  }
  const sample = spread;
  const eval1 = () => {
    // A scalar function of the parameters: the InfoNCE loss over three pairs.
    const tapes = sample.map(c => { const t = {}; forward(w, c.pixels, t); return t; });
    const a = [0, 1, 2].map(i => tapes[i].embedding);
    const p = [3, 4, 5].map(i => tapes[i].embedding);
    const r = infoNCE(a, p, TAU);
    return { r, tapes };
  };
  const { r, tapes } = eval1();
  const grads = zeroGrads(w);
  for (let i = 0; i < 3; i++) backward(w, tapes[i], r.dA[i], grads);
  for (let i = 0; i < 3; i++) backward(w, tapes[i + 3], r.dP[i], grads);

  const eps = 1e-5;
  const checks = [];
  const probe = (name, arr, gArr, idxs) => {
    for (const idx of idxs) {
      const orig = arr[idx];
      arr[idx] = orig + eps; const up = eval1().r.loss;
      arr[idx] = orig - eps; const dn = eval1().r.loss;
      arr[idx] = orig;
      const numeric = (up - dn) / (2 * eps);
      const analytic = gArr[idx];
      const denom = Math.max(1e-8, Math.abs(numeric) + Math.abs(analytic));
      checks.push({ name: `${name}[${idx}]`, numeric, analytic, relError: Math.abs(numeric - analytic) / denom });
    }
  };
  probe("conv0.W", w.layers[0].W, grads.layers[0].W, [0, 7, 23, 60]);
  probe("conv0.b", w.layers[0].b, grads.layers[0].b, [0, 3]);
  probe("conv1.W", w.layers[1].W, grads.layers[1].W, [5, 100, 900]);
  probe("conv2.W", w.layers[2].W, grads.layers[2].W, [11, 500, 3000]);
  probe("head.W", w.head.W, grads.head.W, [0, 17, 400]);
  probe("head.b", w.head.b, grads.head.b, [0, 9]);

  let worst = 0, largest = 0;
  for (const c of checks) {
    worst = Math.max(worst, c.relError);
    largest = Math.max(largest, Math.abs(c.numeric));
    console.log(`  ${c.name.padEnd(14)} numeric=${c.numeric.toExponential(4)}  analytic=${c.analytic.toExponential(4)}  rel=${c.relError.toExponential(2)}`);
  }
  console.log(`\nloss ${r.loss.toFixed(4)}   largest |numeric gradient| ${largest.toExponential(2)}   worst relative error ${worst.toExponential(2)}`);
  return { worst, largest };
}

// ---- Adam ------------------------------------------------------------------
function adamState(weights) {
  const like = a => ({ m: new Float64Array(a.length), v: new Float64Array(a.length) });
  return { layers: weights.layers.map(l => ({ W: like(l.W), b: like(l.b) })),
           head: { W: like(weights.head.W), b: like(weights.head.b) }, t: 0 };
}
function adamStep(arr, grad, st, lr, t) {
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  for (let i = 0; i < arr.length; i++) {
    st.m[i] = b1 * st.m[i] + (1 - b1) * grad[i];
    st.v[i] = b2 * st.v[i] + (1 - b2) * grad[i] * grad[i];
    const mh = st.m[i] / (1 - Math.pow(b1, t));
    const vh = st.v[i] / (1 - Math.pow(b2, t));
    arr[i] -= lr * mh / (Math.sqrt(vh) + eps);
  }
}

// ---- train -----------------------------------------------------------------
function main() {
  if (!fs.existsSync(path.join(HERE, "crops.json"))) {
    console.error("No crop corpus. Run `node benchmarks/embedding/extract-crops.mjs` first.");
    process.exit(2);
  }
  const crops = loadCrops(HERE);

  if (has("--gradcheck")) {
    console.log("Finite-difference gradient check on real crops:\n");
    const { worst, largest } = gradcheck(crops);
    if (largest < 1e-8) { console.error("\nEvery numeric gradient is zero — the loss is flat here, so this check tested nothing."); process.exit(1); }
    if (worst > 1e-4) { console.error("\nGradients disagree. The backward pass is wrong; nothing may be trained on it."); process.exit(1); }
    console.log("Gradients agree.");
    return;
  }

  // Training pool: the Golden Plan only, training-side objects only.
  const pool = crops.filter(c => c.plan === "merit-real-venue" && objectSplit(c.objectId) === "train");
  const byObject = new Map();
  for (const c of pool) {
    if (!byObject.has(c.objectId)) byObject.set(c.objectId, []);
    byObject.get(c.objectId).push(c);
  }
  const objects = [...byObject.entries()].filter(([, v]) => v.length >= 2).map(([k]) => k);
  console.log(`corpus  ${crops.length} crops`);
  console.log(`train   ${pool.length} crops, ${objects.length} distinct objects, ${new Set(pool.map(c => c.variant)).size} renderings`);
  console.log(`held out ${new Set(crops.filter(c => c.plan === "merit-real-venue" && objectSplit(c.objectId) === "test").map(c => c.objectId)).size} objects, and every fixture plan`);
  console.log(`model   ${paramCount()} parameters, ${ARCH.embedding}-d embedding\n`);
  if (objects.length < BATCH) { console.error("Not enough distinct objects to train on."); process.exit(2); }

  const w = initWeights(SEED);
  const st = adamState(w);
  const rnd = mulberry32(SEED + 1);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  let best = Infinity, bestWeights = null;
  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    const order = shuffle(objects.slice());
    let lossSum = 0, accSum = 0, batches = 0;
    for (let s = 0; s + BATCH <= order.length; s += BATCH) {
      const batch = order.slice(s, s + BATCH);
      const anchorTapes = [], positiveTapes = [];
      for (const id of batch) {
        const views = byObject.get(id);
        // Two DIFFERENT renderings of the same object.
        let i = Math.floor(rnd() * views.length), j = Math.floor(rnd() * views.length);
        if (j === i) j = (j + 1) % views.length;
        const ta = {}, tp = {};
        forward(w, views[i].pixels, ta);
        forward(w, views[j].pixels, tp);
        anchorTapes.push(ta); positiveTapes.push(tp);
      }
      const r = infoNCE(anchorTapes.map(t => t.embedding), positiveTapes.map(t => t.embedding), TAU);
      const grads = zeroGrads(w);
      for (let i = 0; i < batch.length; i++) backward(w, anchorTapes[i], r.dA[i], grads);
      for (let i = 0; i < batch.length; i++) backward(w, positiveTapes[i], r.dP[i], grads);
      st.t++;
      for (let li = 0; li < w.layers.length; li++) {
        adamStep(w.layers[li].W, grads.layers[li].W, st.layers[li].W, LR, st.t);
        adamStep(w.layers[li].b, grads.layers[li].b, st.layers[li].b, LR, st.t);
      }
      adamStep(w.head.W, grads.head.W, st.head.W, LR, st.t);
      adamStep(w.head.b, grads.head.b, st.head.b, LR, st.t);
      lossSum += r.loss; accSum += r.accuracy; batches++;
    }
    const loss = lossSum / batches, acc = accSum / batches;
    if (loss < best) {
      best = loss;
      bestWeights = { id: w.id, arch: w.arch,
        layers: w.layers.map(l => ({ out: l.out, in: l.in, k: l.k, W: Float64Array.from(l.W), b: Float64Array.from(l.b) })),
        head: { W: Float64Array.from(w.head.W), b: Float64Array.from(w.head.b) } };
    }
    if (epoch === 1 || epoch % 5 === 0 || epoch === EPOCHS)
      console.log(`epoch ${String(epoch).padStart(3)}  loss ${loss.toFixed(4)}  in-batch top1 ${(acc * 100).toFixed(1)}%`);
  }

  const out = serialise(bestWeights, {
    trainedAt: new Date().toISOString(),
    objective: "InfoNCE over the same annotated object rendered under different real transformations",
    trainedOn: { plans: ["merit-real-venue"], objects: objects.length,
                 renderings: [...new Set(pool.map(c => c.variant))].sort(), crops: pool.length },
    heldOut: "objects on the test side of the id-hash split, and every fixture plan",
    hyperparameters: { epochs: EPOCHS, batch: BATCH, lr: LR, tau: TAU, seed: SEED },
    bestTrainingLoss: +best.toFixed(4),
    licence: "Trained in this repository on this project's own annotated plans. No third-party weights, no third-party dataset.",
    input: "32x32 grayscale crop of the object's box with a 15% margin, standardised per crop",
  });
  const file = path.join(HERE, "encoder-weights.json");
  fs.writeFileSync(file, JSON.stringify(out) + "\n");
  console.log(`\nwrote ${path.relative(process.cwd(), file)}  (${out.parameters} parameters, ${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  console.log("Now measure it:  node benchmarks/embedding/retrieval-benchmark.mjs");
}

main();
