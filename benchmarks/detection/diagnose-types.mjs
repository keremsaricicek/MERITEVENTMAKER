// Why does a table get the type it gets? Runs the real app's analysis on plans
// with exact labels and, for every annotated table, reports the type the
// product gave it and the evidence that decided it (`evidence.shapeBasis`, the
// symbol-family promotion, the local model, a vector shape). It also reports,
// per matched table, the box IoU and the size and angle error, because a table
// found at the right centre with the wrong outline is still wrong on the
// digital plan.
//
//   node benchmarks/detection/diagnose-types.mjs DIR_OR_FILE... [--out FILE] [--limit N]
//
// Annotation files are the repository's format (benchmarks/annotations,
// training/synth*.py output); the image is `source.file` beside the JSON.
// Network refused, pinned OCR — the same environment as every benchmark.
import fs from "node:fs";
import path from "node:path";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import { futureDate } from "../../tests/lib/app-actions.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt("--out", null);
const LIMIT = Number(opt("--limit", 1e9));
const inputs = argv.filter((a, i) => !a.startsWith("--") && !["--out", "--limit"].includes(argv[i - 1]));
const files = inputs.flatMap(p => fs.statSync(p).isDirectory()
  ? fs.readdirSync(p).filter(f => f.endsWith(".json") && f !== "index.json").sort().map(f => path.join(p, f))
  : [p]).slice(0, LIMIT);

const TYPE_OF = o => (o.type === "bistro" ? "bistro" : o.type === "round" ? "round" : o.type === "square" ? "square" : "rectangle");

function iouRot(a, b) {
  // axis-aligned IoU of the two unrotated boxes about their own centres; the
  // annotation and the candidate both store an unrotated w/h plus a rotation,
  // so with equal rotations this is exact and otherwise an upper bound.
  const ix = Math.max(0, Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2));
  const iy = Math.max(0, Math.min(a.cy + a.h / 2, b.cy + b.h / 2) - Math.max(a.cy - a.h / 2, b.cy - b.h / 2));
  const inter = ix * iy;
  return inter / Math.max(1e-9, a.w * a.h + b.w * b.h - inter);
}
const angDiff = (a, b, sym) => { let d = Math.abs(((a - b) % sym + sym) % sym); return Math.min(d, sym - d); };

const app = await serveApp();
const browser = await launchChromium();
const results = [];
for (const file of files) {
  const annot = JSON.parse(fs.readFileSync(file, "utf8"));
  const img = [path.join(path.dirname(file), path.basename(annot.source.file)),
    path.join(path.dirname(file), "..", annot.source.file)].find(p => fs.existsSync(p));
  if (!img) { console.error("no image for", file); continue; }
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${app.baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Diagnose");
  await page.fill('input[name="hotel"]', "Diagnose");
  await page.fill('input[name="date"]', futureDate());
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(500);
  const b64 = fs.readFileSync(img).toString("base64");
  const mime = img.endsWith(".jpg") ? "image/jpeg" : "image/png";
  await page.evaluate(src => { state.events[0].background = { src, name: "plan", opacity: 1, visible: true, locked: false, scale: 100 }; render(); }, `data:${mime};base64,${b64}`);
  await page.waitForTimeout(300);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy && state.events[0].analysis.timings && state.events[0].analysis.timings.analysisCompletedAtMs, null, { timeout: 240000 }).catch(() => {});
  const meta = await page.evaluate(() => {
    const a = state.events[0].analysis || {};
    const d = a.diagnostics || {};
    const chairs = [];
    for (const c of a.candidates || []) {
      if (c.status === "rejected") continue;
      for (const ch of c.chairDetections || []) chairs.push({ x: ch.x, y: ch.y, w: ch.w, h: ch.h });
      if (c.kind === "venue" && c.type === "chair") chairs.push({ x: c.x, y: c.y, w: c.w, h: c.h });
    }
    return { representation: d.representation?.kind || a.representation?.kind || null,
      representationEvidence: d.representation?.evidence || null, chairs };
  });
  const cands = await page.evaluate(() => (state.events[0].analysis?.candidates || []).filter(c => c.kind === "table" && c.status !== "rejected").map(c => ({
    type: c.type, x: c.x, y: c.y, w: c.w, h: c.h, rotation: c.rotation || 0, status: c.status,
    basis: c.evidence?.shapeBasis || c.typeBasis || c.evidence?.basis || null,
    symbolFamily: !!c.symbolFamily, source: c.evidence?.source || null,
    model: !!c.modelSupport || !!c.evidence?.modelSupport, vector: !!c.vectorSupport,
  })));
  await page.close();
  const W = annot.source.width, H = annot.source.height, tol = (annot.matchToleranceP ?? 3) / 100 * Math.hypot(W, H);
  const det = cands.map(c => ({ ...c, cx: (c.x + c.w / 2) / 100 * W, cy: (c.y + c.h / 2) / 100 * H, w: c.w / 100 * W, h: c.h / 100 * H }));
  const gt = annot.objects.filter(o => o.class === "table" && !o.ignore && Number.isFinite(o.cx));
  const pairs = [];
  gt.forEach((g, gi) => det.forEach((d, di) => { const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy); if (dist <= tol) pairs.push({ gi, di, dist }); }));
  pairs.sort((a, b) => a.dist - b.dist);
  const gu = new Set(), du = new Set(), matches = [];
  for (const p of pairs) if (!gu.has(p.gi) && !du.has(p.di)) { gu.add(p.gi); du.add(p.di); matches.push(p); }
  const rows = matches.map(({ gi, di }) => {
    const g = gt[gi], d = det[di];
    const want = TYPE_OF(g);
    const sym = want === "round" ? 360 : (want === "square" ? 90 : 180);
    return { gt: g.id, want, got: d.type, basis: d.basis, symbolFamily: d.symbolFamily, source: d.source, model: d.model,
      iou: +iouRot(g, d).toFixed(3), sizeErr: +(Math.abs(Math.sqrt(d.w * d.h) / Math.sqrt(g.w * g.h) - 1)).toFixed(3),
      angleErr: want === "round" ? 0 : +angDiff(d.rotation, g.rotation || 0, sym).toFixed(1) };
  });
  const gtCh = annot.objects.filter(o => o.class === "chair" && !o.ignore && Number.isFinite(o.cx));
  const detCh = meta.chairs.map(c => ({ cx: (c.x + c.w / 2) / 100 * W, cy: (c.y + c.h / 2) / 100 * H }));
  const cp = [];
  gtCh.forEach((g, gi) => detCh.forEach((d, di) => { const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy); if (dist <= tol) cp.push({ gi, di, dist }); }));
  cp.sort((a, b) => a.dist - b.dist);
  const cgu = new Set(), cdu = new Set();
  for (const p of cp) if (!cgu.has(p.gi) && !cdu.has(p.di)) { cgu.add(p.gi); cdu.add(p.di); }
  const r = { plan: annot.planId, representation: meta.representation, representationEvidence: meta.representationEvidence,
    chairs: { gt: gtCh.length, tp: cgu.size, fp: detCh.length - cdu.size, fn: gtCh.length - cgu.size }, family: annot.split?.family || null, level: annot.level ?? annot.generator?.level ?? null,
    gt: gt.length, found: matches.length, extra: det.length - matches.length, errors: errors.length,
    typeWrong: rows.filter(x => x.want !== x.got).map(x => ({ gt: x.gt, want: x.want, got: x.got, basis: x.basis, symbolFamily: x.symbolFamily, source: x.source, model: x.model })),
    iouMedian: rows.length ? rows.map(x => x.iou).sort((a, b) => a - b)[rows.length >> 1] : null,
    iouP10: rows.length ? rows.map(x => x.iou).sort((a, b) => a - b)[Math.floor(rows.length * 0.1)] : null,
    rows };
  results.push(r);
  console.log(`${r.plan.padEnd(34)} ${String(r.representation).padEnd(9)} chairs ${r.chairs.tp}/${r.chairs.fp}/${r.chairs.fn} found ${r.found}/${r.gt} extra ${r.extra} typeWrong ${r.typeWrong.length} iouP10 ${r.iouP10} ` +
    Object.entries(r.typeWrong.reduce((m, x) => (m[`${x.want}->${x.got}:${x.basis}${x.symbolFamily ? "+family" : ""}`] = (m[`${x.want}->${x.got}:${x.basis}${x.symbolFamily ? "+family" : ""}`] || 0) + 1, m), {})).map(([k, v]) => `${k}×${v}`).join(" "));
}
await browser.close();
await app.close?.();
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
process.exit(0);
