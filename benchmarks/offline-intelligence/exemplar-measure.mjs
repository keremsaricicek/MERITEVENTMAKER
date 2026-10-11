// Local examples, measured: after a person confirms 1–3 objects of a class,
// how many of the objects the detector MISSED does exemplar search recover,
// and how many phantoms does it add? (src/plan-exemplar.js)
//
//   node benchmarks/offline-intelligence/exemplar-measure.mjs
//
// For each real plan: run the product's analysis (network refused, pinned
// OCR), score detections against the annotation with the benchmark's own
// greedy matching, then for each class pick k exemplars among the CORRECT
// detections (what a person would confirm), search, and score the
// suggestions: a suggestion that lands on an annotated object nobody had
// found is a recovery; one that lands on nothing annotated is a phantom; one
// on an object already detected is a duplicate (excluded before scoring by
// the search's own exclude list, and counted if it slips through).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp, REPO_ROOT } from "../../tests/lib/server.mjs";
import { routeVendorFromCache } from "../../tests/lib/vendor.mjs";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../../tests/lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLANS = [["golden", "merit-real-venue-plan.png", "merit-real-venue.json"], ["ornek", "ornek-upright.png", "ornek-symbolic.json"]];
const K = [1, 3];

function match(gt, det, tol) {
  const pairs = [];
  gt.forEach((g, gi) => det.forEach((d, di) => { const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy); if (dist <= tol) pairs.push({ gi, di, dist }); }));
  pairs.sort((a, b) => a.dist - b.dist);
  const gU = new Set(), dU = new Set(), m = [];
  for (const p of pairs) { if (gU.has(p.gi) || dU.has(p.di)) continue; gU.add(p.gi); dU.add(p.di); m.push(p); }
  return { m, gU, dU };
}

const app = await serveApp(); const browser = await launchChromium();
const report = { measuredOn: new Date().toISOString(), note: "exemplars are CORRECT detections, as a person would confirm them; suggestions are scored against the human annotation", plans: {} };
try {
  for (const [name, file, annFile] of PLANS) {
    const annot = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "benchmarks/annotations", annFile), "utf8"));
    const W = annot.source.width, H = annot.source.height, tol = (annot.matchToleranceP ?? 3) / 100 * Math.hypot(W, H);
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await routeVendorFromCache(page, { offline: true });
    await page.addInitScript(() => { globalThis.MERIT_PLAN_MODEL_DISABLED = "exemplar measurement: classical detections only"; });
    await openApp(page, app.baseUrl, { lang: "en" });
    await createBlankEvent(page, { name: "Exemplar " + name, date: futureDate() });
    await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(REPO_ROOT, "benchmarks/plans", file)).toString("base64"));
    await runDetection(page, { timeout: 600000 });
    const det = await page.evaluate(async () => {
      const a = state.events[0].analysis, W = a.imageWidth, H = a.imageHeight;
      const img = new Image(); img.src = state.events[0].background.src; await img.decode();
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data, grey = new Float32Array(W * H);
      for (let i = 0, j = 0; i < grey.length; i++, j += 4) grey[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      globalThis.__grey = grey;
      const live = a.candidates.filter(c => c.status !== "rejected");
      return { W, H,
        tables: live.filter(c => c.kind === "table").map(c => ({ x: c.x / 100 * W, y: c.y / 100 * H, w: c.w / 100 * W, h: c.h / 100 * H })),
        chairs: live.filter(c => c.kind === "table").flatMap(c => (c.chairDetections || []).map(ch => ({ x: (ch.x - ch.w / 2) / 100 * W, y: (ch.y - ch.h / 2) / 100 * H, w: ch.w / 100 * W, h: ch.h / 100 * H }))) };
    });
    const sx = W / det.W, sy = H / det.H; // analysis px -> annotation (source) px
    const toSrc = b => ({ cx: (b.x + b.w / 2) * sx, cy: (b.y + b.h / 2) * sy });
    const out = {};
    for (const [cls, list] of [["table", det.tables], ["chair", det.chairs]]) {
      const gt = annot.objects.filter(o => o.class === cls && Number.isFinite(o.cx));
      if (!gt.length) continue;
      const base = match(gt, list.map(toSrc), tol);
      const missed = gt.filter((_, i) => !base.gU.has(i));
      const correct = base.m.map(p => list[p.di]);
      out[cls] = { groundTruth: gt.length, detected: list.length, missedBefore: missed.length, byK: {} };
      for (const k of K) {
        if (correct.length < k) continue;
        // k exemplars spread over the plan: every (n/k)-th correct detection
        const ex = Array.from({ length: k }, (_, i) => correct[Math.floor(i * correct.length / k)]);
        const t0 = Date.now();
        const sugg = await page.evaluate(({ ex, W, H, exclude }) => {
          const all = [];
          for (const e of ex) for (const s of MeritPlanExemplar.search(globalThis.__grey, W, H, e, { exclude: exclude.concat(all) })) all.push(s);
          return all;
        }, { ex, W: det.W, H: det.H, exclude: list });
        const ms = Date.now() - t0;
        const sp = sugg.map(toSrc);
        const onMissed = match(missed, sp, tol);
        const recovered = onMissed.m.length;
        const rest = sp.filter((_, i) => !onMissed.dU.has(i));
        const onAnyGt = match(gt, rest, tol);
        const duplicates = onAnyGt.m.length, phantoms = rest.length - duplicates;
        out[cls].byK[k] = { suggestions: sugg.length, recovered, recoveredShare: missed.length ? +(recovered / missed.length).toFixed(3) : null,
          phantoms, phantomsPer100Objects: +(phantoms / gt.length * 100).toFixed(2), duplicates, ms };
        console.log(`${name} ${cls} k=${k}: missed ${missed.length}, suggestions ${sugg.length}, recovered ${recovered}, phantoms ${phantoms}, duplicates ${duplicates}, ${ms} ms`);
      }
    }
    report.plans[name] = out;
    await page.close();
  }
} finally { await browser.close(); await app.close(); }
fs.writeFileSync(path.join(HERE, "exemplar-latest.json"), JSON.stringify(report, null, 1));
console.log("wrote benchmarks/offline-intelligence/exemplar-latest.json");
