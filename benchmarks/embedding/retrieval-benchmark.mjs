// What a visual representation is actually FOR, measured.
//
//   node benchmarks/embedding/retrieval-benchmark.mjs
//   node benchmarks/embedding/retrieval-benchmark.mjs --provider learned
//   node benchmarks/embedding/retrieval-benchmark.mjs --json out.json
//
// Teach AI propagates a human decision to the objects that look like the one
// the human judged, and Plan Memory re-finds a corrected object after the plan
// is re-analysed. Both are nearest-neighbour lookups in representation space,
// so the honest test of a representation is retrieval, not a loss curve.
//
// Two questions, deliberately separate, because a representation can be good at
// one and useless at the other:
//
//   SAME-OBJECT INVARIANCE  Given this chair as it appears in one rendering,
//                           is the nearest crop in the other fifteen
//                           renderings the SAME physical chair? This is what
//                           Plan Memory needs, and it is measured against
//                           genuine re-renderings of one drawing (blur,
//                           rescale, recolour, JPEG, rotation), not jitter.
//
//   SAME-CLASS RETRIEVAL    Given this object, is the nearest OTHER object of
//                           the same kind? This is what Teach AI propagation
//                           needs. The query's own crops are removed from the
//                           gallery entirely, so nothing can score by finding
//                           itself.
//
// Reported per split. `held-out objects` trains on some of a venue's objects
// and asks about others — the right unit for the invariance question. `held-out
// plan` asks about a plan the encoder never saw at all. They answer different
// questions and are never averaged together.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCrops } from "./extract-crops.mjs";
import { describe } from "./descriptor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const optOf = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

// Which objects are held out, decided by a stable hash of the object id rather
// than by position, so re-running cannot quietly reshuffle the split and the
// trainer and the benchmark agree without passing a file between them.
export function objectSplit(objectId, holdout = 0.3) {
  let h = 2166136261;
  for (let i = 0; i < objectId.length; i++) { h ^= objectId.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000 < holdout ? "test" : "train";
}

function l2normalise(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}

// Cosine on L2-normalised vectors is a dot product; both representations are
// normalised so neither wins on magnitude.
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

function topK(query, gallery, k) {
  const scored = gallery.map((g, i) => ({ i, s: dot(query.vec, g.vec) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map(x => gallery[x.i]);
}

export function sameObjectInvariance(items, k = 5) {
  // Only objects that exist in more than one rendering can be asked.
  const byObject = new Map();
  for (const it of items) {
    const key = `${it.plan}|${it.objectId}`;
    if (!byObject.has(key)) byObject.set(key, []);
    byObject.get(key).push(it);
  }
  let asked = 0, top1 = 0, topk = 0;
  for (const it of items) {
    const siblings = byObject.get(`${it.plan}|${it.objectId}`);
    if (siblings.length < 2) continue;
    // Gallery: every crop of this plan from a DIFFERENT rendering.
    const gallery = items.filter(g => g.plan === it.plan && g.variant !== it.variant);
    if (gallery.length < k) continue;
    const hits = topK(it, gallery, k);
    asked++;
    if (hits[0].objectId === it.objectId) top1++;
    if (hits.some(h => h.objectId === it.objectId)) topk++;
  }
  return { asked, top1: asked ? +(top1 / asked).toFixed(4) : null,
           [`top${k}`]: asked ? +(topk / asked).toFixed(4) : null };
}

export function sameClassRetrieval(items, labelOf, k = 5) {
  let asked = 0, top1 = 0, purity = 0;
  for (const it of items) {
    const label = labelOf(it);
    if (label == null) continue;
    // Everything about this object leaves the gallery, in every rendering.
    const gallery = items.filter(g => g.plan === it.plan && g.objectId !== it.objectId && labelOf(g) != null);
    if (gallery.length < k) continue;
    const hits = topK(it, gallery, k);
    asked++;
    if (labelOf(hits[0]) === label) top1++;
    purity += hits.filter(h => labelOf(h) === label).length / k;
  }
  return { asked, top1: asked ? +(top1 / asked).toFixed(4) : null,
           [`top${k}Purity`]: asked ? +(purity / asked).toFixed(4) : null };
}

// ---- providers -------------------------------------------------------------
export function handcraftedProvider(side) {
  return { id: "handcrafted-descriptor-v1", trainedModel: false,
           embed: c => describe(c.pixels, side) };
}

export async function learnedProvider() {
  const wf = path.join(HERE, "encoder-weights.json");
  if (!fs.existsSync(wf)) return null;
  const { forward, deserialise } = await import("./encoder.mjs");
  const json = JSON.parse(fs.readFileSync(wf, "utf8"));
  const weights = deserialise(json);
  return { id: json.id, trainedModel: true, weights: json,
           embed: c => forward(weights, c.pixels) };
}

// The two representations are not competitors by nature: one is trained to
// know that two crops are the same object, the other measures what the object
// is made of. Concatenating them, each L2-normalised first so neither can win
// on magnitude, asks whether they are complementary. Measured, not assumed —
// and if it is not better than both on the numbers that matter, it does not
// ship.
export function combinedProvider(learned, handcrafted) {
  return {
    id: `${learned.id}+${handcrafted.id}`,
    trainedModel: true,
    embed(c) {
      const a = l2normalise(learned.embed(c)), b = l2normalise(handcrafted.embed(c));
      return [...a, ...b];
    },
  };
}

// ---- run -------------------------------------------------------------------
export function evaluate(crops, provider, side) {
  const embedded = crops.map(c => ({ ...c, vec: l2normalise(provider.embed(c)) }));
  const real = embedded.filter(e => e.plan === "merit-real-venue");
  const heldOutObjects = real.filter(e => objectSplit(e.objectId) === "test");
  const otherPlans = embedded.filter(e => e.plan !== "merit-real-venue");

  const tableType = it => (it.cls === "table" ? it.type : null);
  const anyClass = it => it.cls;

  return {
    provider: provider.id,
    trainedModel: provider.trainedModel,
    dimensions: provider.embed(crops[0]).length,
    splits: {
      "held-out objects (Golden Plan, 16 renderings)": {
        crops: heldOutObjects.length,
        distinctObjects: new Set(heldOutObjects.map(e => e.objectId)).size,
        sameObjectInvariance: sameObjectInvariance(heldOutObjects),
        sameClassRetrieval: sameClassRetrieval(heldOutObjects, anyClass),
        tableTypeRetrieval: sameClassRetrieval(heldOutObjects.filter(e => e.cls === "table"), tableType),
      },
      "held-out plans (four fixtures the encoder never saw)": {
        crops: otherPlans.length,
        distinctObjects: new Set(otherPlans.map(e => `${e.plan}|${e.objectId}`)).size,
        sameClassRetrieval: sameClassRetrieval(otherPlans, anyClass),
        tableTypeRetrieval: sameClassRetrieval(otherPlans.filter(e => e.cls === "table"), tableType),
      },
      "all Golden Plan objects (train and test together — reported, never a gate)": {
        crops: real.length,
        sameObjectInvariance: sameObjectInvariance(real),
        sameClassRetrieval: sameClassRetrieval(real, anyClass),
      },
    },
  };
}

function line(name, r) {
  const parts = Object.entries(r).filter(([k]) => k !== "asked").map(([k, v]) => `${k}=${v}`);
  return `    ${name.padEnd(22)} n=${String(r.asked).padStart(5)}  ${parts.join("  ")}`;
}

async function main() {
  if (!fs.existsSync(path.join(HERE, "crops.json"))) {
    console.error("No crop corpus. Run `node benchmarks/embedding/extract-crops.mjs` first.");
    process.exit(2);
  }
  const meta = JSON.parse(fs.readFileSync(path.join(HERE, "crops.json"), "utf8"));
  const crops = loadCrops(HERE);
  const want = optOf("--provider") || "all";
  const providers = [];
  const hand = handcraftedProvider(meta.side);
  const learned = await learnedProvider();
  if (want === "all" || want === "handcrafted") providers.push(hand);
  if (want === "all" || want === "learned") {
    if (learned) providers.push(learned);
    else if (want === "learned") { console.error("No trained encoder. Run `node benchmarks/embedding/train-encoder.mjs`."); process.exit(2); }
  }
  if ((want === "all" || want === "combined") && learned) providers.push(combinedProvider(learned, hand));

  const results = [];
  for (const p of providers) {
    const r = evaluate(crops, p, meta.side);
    results.push(r);
    console.log(`\n=== ${r.provider}   trainedModel=${r.trainedModel}   dims=${r.dimensions}`);
    for (const [split, s] of Object.entries(r.splits)) {
      console.log(`  ${split}  (${s.crops} crops)`);
      if (s.sameObjectInvariance) console.log(line("same-object", s.sameObjectInvariance));
      if (s.sameClassRetrieval) console.log(line("same-class", s.sameClassRetrieval));
      if (s.tableTypeRetrieval) console.log(line("table-type", s.tableTypeRetrieval));
    }
  }

  // Promotion is decided here, against the handcrafted descriptor, on every
  // metric separately. A representation that trades one number for another has
  // not earned promotion — that trade is invisible in an average and is exactly
  // what a single headline score hides.
  if (results.length > 1) {
    const base = results[0];
    for (const r of results.slice(1)) {
      console.log(`\n=== ${r.provider} vs ${base.provider}`);
      let worst = 0;
      for (const split of Object.keys(base.splits)) {
        for (const metric of ["sameObjectInvariance", "sameClassRetrieval", "tableTypeRetrieval"]) {
          const x = base.splits[split][metric], y = r.splits[split][metric];
          if (!x || !y || x.top1 == null || y.top1 == null) continue;
          const d = y.top1 - x.top1;
          worst = Math.min(worst, d);
          console.log(`  ${split.slice(0, 34).padEnd(36)} ${metric.padEnd(21)} ${x.top1.toFixed(4)} → ${y.top1.toFixed(4)}  ${d >= 0 ? "+" : ""}${d.toFixed(4)}`);
        }
      }
      console.log(`  worst movement on any metric: ${worst >= 0 ? "+" : ""}${worst.toFixed(4)}`);
    }
  }

  const out = optOf("--json") || path.join(HERE, "retrieval.json");
  fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), corpus: {
    crops: crops.length, side: meta.side, margin: meta.margin,
    plans: [...new Set(crops.map(c => c.plan))] }, results }, null, 1) + "\n");
  console.log(`\nwrote ${path.relative(process.cwd(), out)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
