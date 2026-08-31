// Gate G: how discriminative is the installed visual representation, really?
//
// Before anyone ships tens of megabytes of model weights into an offline
// package, there has to be a number the model must beat. This produces it.
//
// Method: run detection on the real venue plan and on the benchmark fixtures,
// take the visual descriptor the provider produced for every candidate, and
// measure how well that vector separates objects that ground truth says are
// the same class from objects it says are different.
//
// Two metrics, both standard and both computed here rather than asserted:
//
//   silhouette  -- for each object, (nearest-other-class distance minus
//                  mean-same-class distance) over the larger of the two.
//                  +1 means classes are cleanly separated, 0 means they
//                  overlap, negative means the representation actively
//                  misleads.
//   1-NN accuracy -- label each object by its nearest neighbour in descriptor
//                  space, excluding itself. This is the number that matters
//                  for similarity clustering, because that is exactly what
//                  the clustering does.
//
// Usage: node benchmarks/embedding/measure-descriptor-baseline.mjs
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The runner serves the app itself; nothing here depends on a server a
// person remembered to start. MERIT_BASE_URL overrides it.
const app = await serveApp();

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const PLANS = [
  { id: 'merit-real-venue', img: 'benchmarks/plans/merit-real-venue-plan.png', annot: 'benchmarks/annotations/merit-real-venue.json' },
  { id: 'adversarial-text', img: 'benchmarks/fixtures/adversarial-text.png', annot: 'benchmarks/annotations/adversarial-text.json' },
  { id: 'adversarial-architecture', img: 'benchmarks/fixtures/adversarial-architecture.png', annot: 'benchmarks/annotations/adversarial-architecture.json' },
];

function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }

// Standardise each dimension before measuring, otherwise whichever component
// happens to have the largest raw range silently dominates the distance and
// the result describes that component rather than the representation.
function standardise(vectors) {
  const n = vectors.length, dim = vectors[0].length;
  const mean = new Array(dim).fill(0), sd = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i] / n;
  for (const v of vectors) for (let i = 0; i < dim; i++) sd[i] += (v[i] - mean[i]) ** 2 / n;
  for (let i = 0; i < dim; i++) sd[i] = Math.sqrt(sd[i]) || 1;
  return vectors.map(v => v.map((x, i) => (x - mean[i]) / sd[i]));
}

function silhouette(vectors, labels) {
  const n = vectors.length;
  if (n < 3) return null;
  let total = 0, counted = 0;
  for (let i = 0; i < n; i++) {
    const same = [], byOther = new Map();
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = dist(vectors[i], vectors[j]);
      if (labels[j] === labels[i]) same.push(d);
      else { if (!byOther.has(labels[j])) byOther.set(labels[j], []); byOther.get(labels[j]).push(d); }
    }
    if (!same.length || !byOther.size) continue;
    const a = same.reduce((s, d) => s + d, 0) / same.length;
    const b = Math.min(...[...byOther.values()].map(ds => ds.reduce((s, d) => s + d, 0) / ds.length));
    total += (b - a) / Math.max(a, b); counted++;
  }
  return counted ? { value: +(total / counted).toFixed(4), objects: counted } : null;
}

function nn1(vectors, labels) {
  const n = vectors.length;
  if (n < 2) return null;
  let correct = 0;
  for (let i = 0; i < n; i++) {
    let best = Infinity, bestLabel = null;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = dist(vectors[i], vectors[j]);
      if (d < best) { best = d; bestLabel = labels[j]; }
    }
    if (bestLabel === labels[i]) correct++;
  }
  return { accuracy: +(correct / n).toFixed(4), correct, total: n };
}

const browser = await launchChromium();
const report = { ranAt: new Date().toISOString(), provider: null, plans: [] };

for (const plan of PLANS) {
  const annot = JSON.parse(fs.readFileSync(path.join(ROOT, plan.annot), 'utf8'));
  const W = annot.source.width, H = annot.source.height, diag = Math.hypot(W, H);
  const tol = (annot.matchToleranceP ?? 3) / 100 * diag;

  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  await page.goto(`${app.baseUrl}/index.html`);
  await page.waitForLoadState('networkidle');
  await page.click('.appbar [data-action="create-event"]'); await page.waitForTimeout(300);
  await page.fill('input[name="name"]', 'Emb'); await page.fill('input[name="hotel"]', 'Emb');
  await page.fill('input[name="date"]', '2026-10-02');
  await page.click('button[data-setup="blank"]'); await page.waitForTimeout(700);
  const b64 = fs.readFileSync(path.join(ROOT, plan.img)).toString('base64');
  await page.evaluate(src => { state.events[0].background = { src, name: 'p.png', opacity: 1, visible: true, locked: false, scale: 100 }; render(); }, `data:image/png;base64,${b64}`);
  await page.waitForTimeout(400);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(700);

  const out = await page.evaluate(() => {
    const prov = MeritVisualEmbedding.resolve();
    return {
      provider: { id: prov.id, kind: prov.kind, trainedModel: prov.trainedModel, dimensions: prov.dimensions, licence: prov.licence },
      candidates: (state.events[0].analysis.candidates || [])
        .filter(c => c.status !== 'rejected' && c.visualDescriptor)
        .map(c => ({ kind: c.kind, type: c.type, x: c.x, y: c.y, w: c.w, h: c.h,
          vec: MeritVisualEmbedding.resolve().toVector(c.visualDescriptor) })),
    };
  });
  await page.close();
  report.provider ||= out.provider;

  // Label each detection with the ground-truth class of the annotated object
  // it matches. Detections that match nothing are excluded: a label invented
  // for an unmatched detection would be measuring noise.
  const gt = (annot.objects || []).map(o => ({ ...o }));
  const dets = out.candidates.map(c => ({ ...c, cx: (c.x + c.w / 2) / 100 * W, cy: (c.y + c.h / 2) / 100 * H }));
  const pairs = [];
  gt.forEach((g, gi) => dets.forEach((d, di) => {
    const dd = Math.hypot(g.cx - d.cx, g.cy - d.cy);
    if (dd <= tol) pairs.push({ gi, di, dd });
  }));
  pairs.sort((a, b) => a.dd - b.dd);
  const gU = new Set(), dU = new Set(), labelled = [];
  for (const p of pairs) {
    if (gU.has(p.gi) || dU.has(p.di)) continue;
    gU.add(p.gi); dU.add(p.di);
    const g = gt[p.gi];
    labelled.push({ vec: dets[p.di].vec, label: g.class === 'table' ? `table:${g.type}` : g.class });
  }

  const counts = {};
  labelled.forEach(l => { counts[l.label] = (counts[l.label] || 0) + 1; });
  const usable = labelled.filter(l => counts[l.label] >= 2 && l.vec && l.vec.every(Number.isFinite));
  const entry = { planId: plan.id, detections: out.candidates.length, matchedToGroundTruth: labelled.length,
    classCounts: counts, usableForMetrics: usable.length };
  if (usable.length >= 4 && new Set(usable.map(u => u.label)).size >= 2) {
    const vecs = standardise(usable.map(u => u.vec)), labels = usable.map(u => u.label);
    entry.silhouette = silhouette(vecs, labels);
    entry.nn1 = nn1(vecs, labels);
  } else {
    entry.note = 'not enough classes with 2+ matched objects to compute separation on this plan';
  }
  report.plans.push(entry);

  console.log(`\n=== ${plan.id} ===`);
  console.log(`  detections ${entry.detections}, matched to ground truth ${entry.matchedToGroundTruth}`);
  console.log(`  classes: ${JSON.stringify(counts)}`);
  if (entry.silhouette) console.log(`  silhouette   ${entry.silhouette.value}  (over ${entry.silhouette.objects} objects)`);
  if (entry.nn1) console.log(`  1-NN accuracy ${entry.nn1.accuracy}  (${entry.nn1.correct}/${entry.nn1.total})`);
  if (entry.note) console.log(`  ${entry.note}`);
}

await browser.close();
console.log('\nPROVIDER:', JSON.stringify(report.provider));
const outFile = path.join(ROOT, 'benchmarks/embedding/baseline.json');
fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
console.log('wrote', outFile);
