// What the analysis resolution costs on small objects — measured, not argued.
//
//   node benchmarks/resolution/measure-resolution.mjs
//
// Two parts.
//  1. SIZES. Every annotated object, in pixels, at the plan's own resolution,
//     at the detector's analysis canvas (long edge capped at 1920) and at the
//     vision-language overview (within 2576 px and ~3.59 MP, so the API does
//     not resize it). How many fall under 12 / 8 px on their short side.
//  2. DETECTION. The real app, the real detector, the same plan analysed at
//     several caps (MERIT_ANALYSIS_MAX_SIDE, a benchmark-only override), scored
//     one-for-one against the annotations: tables (precision / recall / F1),
//     chairs (count against the annotated count — no per-chair positions exist
//     for the Golden Plan's chairs beyond the annotation's own list), printed
//     numbers on matched tables (right / wrong / not read), time.
//
// Serves OCR from the pinned cache and refuses the network, like every runner.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp, REPO_ROOT } from "../../tests/lib/server.mjs";
import { routeVendorFromCache } from "../../tests/lib/vendor.mjs";
import { futureDate } from "../../tests/lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLANS = [
  { annotation: "merit-real-venue.json", caps: [900, 1355] },
  { annotation: "ornek-symbolic.json", caps: [1200, 1600, 1920, 2402] },
];
const fitVlm = (w, h) => Math.min(1, 2576 / Math.max(w, h), Math.sqrt(4784 * 750 / (w * h)));

function sizes(annot) {
  const W = annot.source.width, H = annot.source.height;
  const scales = { source: 1, detector: Math.min(1, 1920 / Math.max(W, H)), vlmOverview: fitVlm(W, H) };
  const byClass = {};
  for (const o of annot.objects) {
    const k = o.class + (o.type ? ":" + o.type : "");
    (byClass[k] ||= []).push(Math.min(o.w, o.h));
  }
  const out = {};
  for (const [k, list] of Object.entries(byClass)) {
    list.sort((a, b) => a - b);
    out[k] = { n: list.length };
    for (const [name, s] of Object.entries(scales)) {
      const px = list.map((v) => v * s);
      out[k][name] = { minShortSide: +px[0].toFixed(1), medianShortSide: +px[Math.floor(px.length / 2)].toFixed(1),
        under12: px.filter((v) => v < 12).length, under8: px.filter((v) => v < 8).length };
    }
  }
  return { width: W, height: H, scales: Object.fromEntries(Object.entries(scales).map(([k, v]) => [k, +v.toFixed(3)])), byClass: out };
}

function match(gt, det, tol) {
  const pairs = [];
  gt.forEach((g, gi) => det.forEach((d, di) => { const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy); if (dist <= tol) pairs.push({ gi, di, dist }); }));
  pairs.sort((a, b) => a.dist - b.dist);
  const gu = new Set(), du = new Set(), m = [];
  for (const p of pairs) { if (gu.has(p.gi) || du.has(p.di)) continue; gu.add(p.gi); du.add(p.di); m.push({ g: gt[p.gi], d: det[p.di] }); }
  return { matches: m, fn: gt.length - m.length, fp: det.length - m.length };
}

async function detectAt(browser, baseUrl, file, cap) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  await routeVendorFromCache(page);
  await page.addInitScript((c) => { globalThis.MERIT_ANALYSIS_MAX_SIDE = c; }, cap);
  await page.goto(`${baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Resolution");
  await page.fill('input[name="hotel"]', "Resolution");
  await page.fill('input[name="date"]', futureDate());
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(600);
  await page.evaluate((src) => { state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 }; render(); },
    "data:image/png;base64," + fs.readFileSync(path.join(REPO_ROOT, "benchmarks", file)).toString("base64"));
  await page.waitForTimeout(300);
  const t0 = Date.now();
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 300000 });
  const ms = Date.now() - t0;
  const out = await page.evaluate(() => {
    const a = state.events[0].analysis;
    return { resolution: a.diagnostics && a.diagnostics.resolution, ocr: !!(a.ocr && a.ocr.available),
      candidates: a.candidates.filter((c) => c.status !== "rejected").map((c) => ({ kind: c.kind, type: c.type, x: c.x, y: c.y, w: c.w, h: c.h,
        chairs: (c.chairDetections || []).length, number: c.printedNumber && c.printedNumber.state === "VERIFIED" ? String(c.printedNumber.value) : null })) };
  });
  await page.close();
  return { ms, ...out };
}

function score(annot, det) {
  const W = annot.source.width, H = annot.source.height, tol = (annot.matchToleranceP ?? 3) / 100 * Math.hypot(W, H);
  const px = (c) => ({ ...c, cx: (c.x + c.w / 2) / 100 * W, cy: (c.y + c.h / 2) / 100 * H });
  const tablesGt = annot.objects.filter((o) => o.class === "table"), tablesDet = det.candidates.filter((c) => c.kind === "table").map(px);
  const m = match(tablesGt, tablesDet, tol);
  const p = m.matches.length / (m.matches.length + m.fp || 1), r = m.matches.length / (m.matches.length + m.fn || 1);
  const numbers = { right: 0, wrong: 0, notRead: 0, annotatedLegible: 0 };
  for (const { g, d } of m.matches) {
    if (g.number == null || g.numberLegible === false) continue;
    numbers.annotatedLegible++;
    if (d.number == null) numbers.notRead++; else if (String(d.number) === String(g.number)) numbers.right++; else numbers.wrong++;
  }
  const chairsGt = annot.objects.filter((o) => o.class === "chair").length;
  const chairsDet = det.candidates.reduce((n, c) => n + (c.kind === "table" ? c.chairs : 0), 0);
  return { tables: { tp: m.matches.length, fp: m.fp, fn: m.fn, precision: +p.toFixed(3), recall: +r.toFixed(3), f1: +(p + r ? 2 * p * r / (p + r) : 0).toFixed(3) },
    chairs: chairsGt ? { annotated: chairsGt, detectedOnTables: chairsDet } : null, numbers: numbers.annotatedLegible ? numbers : null };
}

const app = await serveApp();
const browser = await launchChromium();
const report = { measuredOn: new Date().toISOString(), node: process.version, plans: [] };
try {
  for (const plan of PLANS) {
    const annot = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "benchmarks/annotations", plan.annotation), "utf8"));
    const row = { plan: annot.planId, sizes: sizes(annot), runs: [] };
    for (const cap of plan.caps) {
      const det = await detectAt(browser, app.baseUrl, annot.source.file, cap);
      const s = score(annot, det);
      row.runs.push({ cap, resolution: det.resolution, ocr: det.ocr, ms: det.ms, ...s });
      console.log(`${annot.planId} cap ${cap} (${det.resolution}, OCR ${det.ocr ? "on" : "off"}): tables P ${s.tables.precision} R ${s.tables.recall} F1 ${s.tables.f1}`
        + (s.chairs ? `, chairs ${s.chairs.detectedOnTables}/${s.chairs.annotated}` : "") + (s.numbers ? `, numbers right ${s.numbers.right} wrong ${s.numbers.wrong} unread ${s.numbers.notRead} of ${s.numbers.annotatedLegible}` : "") + `, ${det.ms} ms`);
    }
    report.plans.push(row);
  }
} finally {
  await browser.close();
  await app.close();
}
fs.writeFileSync(path.join(HERE, "latest.json"), JSON.stringify(report, null, 1));
console.log("wrote benchmarks/resolution/latest.json");
