#!/usr/bin/env node
// Plan-understanding measurement: runs the real app on each real plan, waits
// for the WHOLE analysis (OCR, label reading, printed numbers, plan
// intelligence — `ui.analysisBusy` false), and scores it against the base
// annotation plus the understanding truth in ./truth (CONTRACT.md).
//
// It also draws the digital result back onto the original plan: what was
// found (green), what was invented (red), what was missed (magenta), which
// chair was seated at the wrong table (red line). The overlay is the evidence
// a person looks at; the numbers are the evidence a gate reads.
//
//   node benchmarks/plan-understanding/measure.mjs            # report + overlays to ./latest
//   node benchmarks/plan-understanding/measure.mjs --out DIR  # somewhere else
//   node benchmarks/plan-understanding/measure.mjs --compare  # gate against CONTRACT thresholds
//
// OCR is served from the pinned .vendor-cache and the network is refused
// (tests/lib/env.mjs) — every number here is the product WITH its OCR.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import { futureDate } from "../../tests/lib/app-actions.mjs";
import { sourceDigest, INPUTS } from "../lib/source-digest.mjs";
import { score } from "./score.mjs";
import { evaluateContract } from "./contract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const OUT = path.resolve(opt("--out") || path.join(HERE, "latest"));
const ONLY = opt("--plan");
fs.mkdirSync(OUT, { recursive: true });

const PLANS = [
  { id: "merit-real-venue", image: "plans/merit-real-venue-plan.png" },
  { id: "ornek-symbolic", image: "plans/ornek-upright.png" },
].filter(p => !ONLY || p.id.includes(ONLY));

const app = await serveApp();
const browser = await launchChromium();

async function analyse(plan) {
  const context = browser.contexts()[0] || browser;
  const page = await (context.newPage ? context.newPage({ viewport: { width: 1800, height: 1000 } }) : browser.newPage({ viewport: { width: 1800, height: 1000 } }));
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // Anything leaving the origin is a cost or a leak; the runner refuses it,
  // and this counts whether the product even tried.
  // Two different things leave the origin. The pinned engines (OCR, PDF,
  // SheetJS) are GETs of public library files from the CDN the CSP allows —
  // the runner serves them from .vendor-cache and the offline package carries
  // them. Anything else — another host, or any request carrying a body — would
  // be plan or guest data leaving the machine, and that is the number gated.
  const offOrigin = [];
  page.on("request", r => {
    const u = r.url();
    if (u.startsWith(app.baseUrl) || u.startsWith("data:") || u.startsWith("blob:")) return;
    offOrigin.push({ method: r.method(), host: new URL(u).host, path: new URL(u).pathname.slice(0, 80), body: !!r.postData() });
  });
  await page.goto(`${app.baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Understanding");
  await page.fill('input[name="hotel"]', "Understanding");
  await page.fill('input[name="date"]', futureDate());
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(700);
  const b64 = fs.readFileSync(path.join(ROOT, plan.image)).toString("base64");
  await page.evaluate(src => {
    state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, `data:image/png;base64,${b64}`);
  await page.waitForTimeout(400);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  let peak = 0, sampling = true;
  const sampler = (async () => {
    while (sampling) {
      try {
        const { metrics } = await cdp.send("Performance.getMetrics");
        const m = metrics.find(x => x.name === "JSHeapUsedSize");
        if (m && m.value > peak) peak = m.value;
      } catch { /* page closing */ }
      await new Promise(r => setTimeout(r, 150));
    }
  })();
  const t0 = Date.now();
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 300000 });
  const analysisMs = Date.now() - t0;
  sampling = false; await sampler;
  const analysis = await page.evaluate(() => {
    const a = JSON.parse(JSON.stringify(state.events[0].analysis));
    for (const c of a.candidates || []) { delete c.visualDescriptor; delete c.visualEvidence; }
    return a;
  });
  return { page, analysis, run: { analysisMs, peakHeapMB: +(peak / 1048576).toFixed(1), offOriginRequests: offOrigin.length,
    engineFetches: offOrigin.filter(r => r.method === "GET" && !r.body && r.host === "cdn.jsdelivr.net").length,
    planDataEgress: offOrigin.filter(r => !(r.method === "GET" && !r.body && r.host === "cdn.jsdelivr.net")),
    cloudCostUSD: 0, providers: analysis.planIntelligence && analysis.planIntelligence.providerMetadata, pageErrors: errors } };
}

// Drawn in the page so the overlay uses the browser's own image decoder — the
// same pixels the detector saw.
async function overlay(page, plan, annotation, truth, analysis, result, file) {
  const b64 = fs.readFileSync(path.join(ROOT, plan.image)).toString("base64");
  const png = await page.evaluate(async ({ src, annotation, truth, analysis, result }) => {
    const img = new Image(); img.src = src; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.drawImage(img, 0, 0);
    g.fillStyle = "rgba(255,255,255,0.45)"; g.fillRect(0, 0, W, H);
    const lw = Math.max(2, Math.round(W / 700));
    const px = c => ({ cx: (c.x + c.w / 2) / 100 * W, cy: (c.y + c.h / 2) / 100 * H, w: c.w / 100 * W, h: c.h / 100 * H });
    const box = (b, color, dash) => { g.save(); g.strokeStyle = color; g.lineWidth = lw; if (dash) g.setLineDash([6, 4]); g.strokeRect(b.cx - b.w / 2, b.cy - b.h / 2, b.w, b.h); g.restore(); };
    const label = (t, x, y, color) => { g.save(); g.font = `bold ${Math.max(11, Math.round(W / 110))}px sans-serif`; g.fillStyle = "rgba(255,255,255,.85)"; const m = g.measureText(t); g.fillRect(x - 2, y - 12, m.width + 4, 15); g.fillStyle = color; g.fillText(t, x, y); g.restore(); };
    const diag = Math.hypot(W, H), tol = (annotation.matchToleranceP ?? 3) / 100 * diag;
    const offered = analysis.candidates.filter(c => c.status !== "rejected" && c.selected === true);
    const tables = offered.filter(c => c.kind === "table").map(c => ({ ...px(c), c }));
    const gtT = annotation.objects.filter(o => o.class === "table");
    const used = new Set();
    for (const t of tables) {
      let best = null, bd = tol;
      for (const gt of gtT) { if (used.has(gt.id)) continue; const d = Math.hypot(gt.cx - t.cx, gt.cy - t.cy); if (d <= bd) { bd = d; best = gt; } }
      if (best) { used.add(best.id); box(t, best.type === t.c.type || !best.type ? "#1a9850" : "#f39c12"); if (best.type && best.type !== t.c.type) label(`${t.c.type}≠${best.type}`, t.cx - t.w / 2, t.cy - t.h / 2 - 2, "#b35806"); }
      else { box(t, "#d73027"); label("EXTRA", t.cx - t.w / 2, t.cy - t.h / 2 - 2, "#d73027"); }
      if (t.c.printedNumber && t.c.printedNumber.state === "VERIFIED") label(String(t.c.printedNumber.value), t.cx - 8, t.cy + 4, "#2c3e50");
    }
    for (const gt of gtT) if (!used.has(gt.id)) { box(gt, "#c51b7d", true); label("MISSED", gt.cx - gt.w / 2, gt.cy + gt.h / 2 + 12, "#c51b7d"); }
    // chairs and links
    const gtC = annotation.objects.filter(o => o.class === "chair");
    // chair detections store their CENTRE (see score.mjs chairToPixels)
    const detC = tables.flatMap(t => (t.c.chairDetections || []).map(ch => ({ cx: ch.x / 100 * W, cy: ch.y / 100 * H, ch, parent: t })));
    const cu = new Set(), du = new Set();
    const pairs = [];
    gtC.forEach((gc, gi) => detC.forEach((dc, di) => { const d = Math.hypot(gc.cx - dc.cx, gc.cy - dc.cy); if (d <= tol) pairs.push({ gi, di, d }); }));
    pairs.sort((a, b) => a.d - b.d);
    const wrongIds = new Set((result.links && result.links.wrongLinks || []).map(w => w.chair));
    for (const p of pairs) { if (cu.has(p.gi) || du.has(p.di)) continue; cu.add(p.gi); du.add(p.di);
      const dc = detC[p.di], gc = gtC[p.gi];
      g.save(); g.strokeStyle = wrongIds.has(gc.id) ? "#d73027" : "rgba(33,102,172,.75)"; g.lineWidth = wrongIds.has(gc.id) ? lw + 1 : 1;
      g.beginPath(); g.moveTo(dc.cx, dc.cy); g.lineTo(dc.parent.cx, dc.parent.cy); g.stroke(); g.restore();
      g.fillStyle = "#1a9850"; g.beginPath(); g.arc(dc.cx, dc.cy, lw + 1, 0, 7); g.fill();
    }
    detC.forEach((dc, di) => { if (!du.has(di)) { g.strokeStyle = "#d73027"; g.lineWidth = lw; g.beginPath(); g.moveTo(dc.cx - 5, dc.cy - 5); g.lineTo(dc.cx + 5, dc.cy + 5); g.moveTo(dc.cx + 5, dc.cy - 5); g.lineTo(dc.cx - 5, dc.cy + 5); g.stroke(); } });
    gtC.forEach((gc, gi) => { if (!cu.has(gi)) { g.strokeStyle = "#c51b7d"; g.lineWidth = lw; g.beginPath(); g.arc(gc.cx, gc.cy, Math.max(6, gc.w / 2), 0, 7); g.stroke(); } });
    // venue elements
    const venue = offered.filter(c => c.kind === "venue" && !/chair/.test(c.type || ""));
    for (const v of venue) { const b = px(v); box(b, "#2166ac"); label(v.type.toUpperCase(), b.cx - b.w / 2, b.cy - b.h / 2 - 2, "#2166ac"); }
    for (const [cls, r] of Object.entries(result.classes)) {
      for (const id of (r.missed || [])) { const e = truth.elements.find(x => x.id === id); if (!e) continue; box(e, "#c51b7d", true); label(`MISSED ${cls.toUpperCase()}`, e.cx - e.w / 2 + 2, e.cy - e.h / 2 + 14, "#c51b7d"); }
    }
    // joined groups: outline the truth group, green when the product grouped it exactly
    const byId = new Map(annotation.objects.map(o => [o.id, o]));
    for (const row of (result.groups && result.groups.rows) || []) {
      const grp = truth.joinedGroups.groups.find(x => x.id === row.id);
      const ms = grp.tables.map(id => byId.get(id));
      const x0 = Math.min(...ms.map(m => m.cx - m.w / 2)) - 4, x1 = Math.max(...ms.map(m => m.cx + m.w / 2)) + 4;
      const y0 = Math.min(...ms.map(m => m.cy - m.h / 2)) - 4, y1 = Math.max(...ms.map(m => m.cy + m.h / 2)) + 4;
      g.save(); g.strokeStyle = row.verdict === "EXACT" ? "rgba(26,152,80,.9)" : "#e08214"; g.setLineDash([2, 3]); g.lineWidth = 1; g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.restore();
      if (row.verdict !== "EXACT") label(row.verdict, x0, y1 + 12, "#b35806");
    }
    // legend
    const lines = [["found", "#1a9850"], ["wrong type", "#f39c12"], ["invented (EXTRA)", "#d73027"], ["missed", "#c51b7d"], ["venue element found", "#2166ac"], ["wrong chair→table link", "#d73027"]];
    g.fillStyle = "rgba(255,255,255,.92)"; g.fillRect(8, H - 20 * lines.length - 16, 230, 20 * lines.length + 10);
    lines.forEach(([t, c], i) => label(t, 16, H - 20 * (lines.length - i) - 2, c));
    return cv.toDataURL("image/jpeg", 0.88);
  }, { src: `data:image/png;base64,${b64}`, annotation, truth, analysis, result });
  fs.writeFileSync(file, Buffer.from(png.split(",")[1], "base64"));
}

const report = { ranAt: new Date().toISOString(), source: sourceDigest(path.join(ROOT, ".."), INPUTS.understanding), plans: [] };
for (const plan of PLANS) {
  const annotation = JSON.parse(fs.readFileSync(path.join(ROOT, "annotations", `${plan.id}.json`), "utf8"));
  const truth = JSON.parse(fs.readFileSync(path.join(HERE, "truth", `${plan.id}.json`), "utf8"));
  const { page, analysis, run } = await analyse(plan);
  const result = score({ analysis, annotation, truth, run });
  result.run.pageErrors = run.pageErrors;
  await overlay(page, plan, annotation, truth, analysis, result, path.join(OUT, `${plan.id}.overlay.jpg`));
  fs.writeFileSync(path.join(OUT, `${plan.id}.analysis.json`), JSON.stringify(analysis));
  await page.close();
  report.plans.push(result);
  const c = result.classes;
  console.log(`\n=== ${plan.id} ===  ${run.analysisMs} ms, heap peak ${run.peakHeapMB} MB, engine fetches ${run.engineFetches}, plan-data egress ${run.planDataEgress.length}`);
  for (const k of Object.keys(c)) if (c[k].gt || c[k].det) console.log(`  ${k.padEnd(9)} gt=${String(c[k].gt).padStart(4)} det=${String(c[k].det).padStart(4)} TP=${c[k].tp} FP=${c[k].fp} FN=${c[k].fn}  P=${c[k].precision} R=${c[k].recall} countErr=${c[k].countError}`);
  console.log(`  links    ${JSON.stringify({ acc: result.links.accuracy, endToEnd: result.links.endToEnd, wrong: result.links.wrong, orphan: result.links.orphan })}`);
  console.log(`  groups   exact ${result.groups.exact}/${result.groups.groundTruth}  chair-count exact ${result.groups.chairCountExact}  spurious ${result.groups.spuriousGroups}`);
  console.log(`  facing   ${JSON.stringify(result.direction)}`.slice(0, 200));
  console.log(`  geometry ${JSON.stringify(result.geometry).slice(0, 260)}`);
  console.log(`  printed  numbers ${JSON.stringify(result.printed.tableNumbers)} capacityTotal ${JSON.stringify(result.printed.capacityTotal)}`);
  console.log(`  capacity ${JSON.stringify(result.capacity).slice(0, 300)}`);
  console.log(`  fixes    ${JSON.stringify(result.corrections)}`);
}
await browser.close();
await app.close?.();
const verdict = evaluateContract(report);
report.contract = verdict;
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
console.log(`\nCONTRACT: ${verdict.passed}/${verdict.total} thresholds met`);
for (const r of verdict.rows.filter(r => !r.pass)) console.log(`  NOT MET  ${r.plan.padEnd(18)} ${r.id.padEnd(28)} ${r.value} (needs ${r.op} ${r.threshold})`);
console.log(`wrote ${OUT}`);
if (argv.includes("--compare")) process.exit(verdict.passed === verdict.total ? 0 : 1);
