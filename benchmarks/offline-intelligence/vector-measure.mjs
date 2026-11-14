// The vector-PDF path, measured on generated CAD-like PDFs
// (training/synth_pdf.py): what the document's own shapes add over reading
// its pixels.
//
//   node benchmarks/offline-intelligence/vector-measure.mjs DIR
//
// For each PDF: import it through the product (the same file input a person
// uses), analyse it twice — vector fusion off, then on — and score tables and
// chairs with the benchmark's greedy matching (3 % of the diagonal). The
// annotation is in PDF points; the product's raster is points × the import's
// own scale. These are GENERATED plans: this measures the generic path, not a
// real CAD export (none exists in the repository).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import { routeVendorFromCache } from "../../tests/lib/vendor.mjs";
import { openApp, createBlankEvent, runDetection, futureDate } from "../../tests/lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2];
if (!DIR) { console.error("usage: vector-measure.mjs DIR"); process.exit(2); }

function score(gt, det, tol) {
  const pairs = [];
  gt.forEach((g, gi) => det.forEach((d, di) => { const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy); if (dist <= tol) pairs.push({ gi, di, dist }); }));
  pairs.sort((a, b) => a.dist - b.dist);
  const gU = new Set(), dU = new Set();
  for (const p of pairs) { if (gU.has(p.gi) || dU.has(p.di)) continue; gU.add(p.gi); dU.add(p.di); }
  const tp = gU.size, fp = det.length - dU.size, fn = gt.length - tp;
  return { tp, fp, fn, precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : 0, recall: tp + fn ? +(tp / (tp + fn)).toFixed(3) : 0 };
}

const app = await serveApp(); const browser = await launchChromium();
const report = { measuredOn: new Date().toISOString(), note: "generated vector PDFs (training/synth_pdf.py); not a real CAD export", plans: {} };
try {
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith(".json")).sort()) {
    const annot = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
    const pdf = fs.readFileSync(path.join(DIR, annot.source.file));
    const row = {};
    for (const mode of ["off", "on"]) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await routeVendorFromCache(page, { offline: true });
      await page.addInitScript(m => { globalThis.MERIT_PLAN_MODEL_DISABLED = "vector measurement"; if (m === "off") globalThis.MERIT_PLAN_VECTOR_DISABLED = true; }, mode);
      await openApp(page, app.baseUrl, { lang: "en" });
      await createBlankEvent(page, { name: "Vector", date: futureDate() });
      await page.setInputFiles("#floorPlanFile", { name: "plan.pdf", mimeType: "application/pdf", buffer: pdf });
      await page.waitForFunction(() => !!state.events[0].background?.pdfSource, null, { timeout: 60000 });
      await runDetection(page, { timeout: 600000 });
      const out = await page.evaluate(() => {
        const ev = state.events[0], a = ev.analysis, ps = ev.background.pdfSource, W = a.imageWidth, H = a.imageHeight;
        const live = a.candidates.filter(c => c.status !== "rejected");
        return { scale: ps.scale, rasterW: ps.width, rasterH: ps.height, W, H, objects: ps.vector.objects ? { reason: ps.vector.objects.reason, tables: ps.vector.objects.tables.length, chairs: ps.vector.objects.chairs.length } : null,
          vectorObjects: a.vectorObjects || null,
          tables: live.filter(c => c.kind === "table").map(c => ({ cx: (c.x + c.w / 2) / 100 * W, cy: (c.y + c.h / 2) / 100 * H })),
          chairs: live.filter(c => c.kind === "table").flatMap(c => (c.chairDetections || []).map(ch => ({ cx: ch.x / 100 * W, cy: ch.y / 100 * H }))) };
      });
      // annotation points -> raster px -> analysis px
      const k = out.scale * (out.W / out.rasterW);
      const gt = cls => annot.objects.filter(o => o.class === cls).map(o => ({ cx: o.cx * k, cy: o.cy * k }));
      const tol = 0.03 * Math.hypot(out.W, out.H);
      row[mode] = { tables: score(gt("table"), out.tables, tol), chairs: score(gt("chair"), out.chairs, tol), proposals: out.objects, fused: out.vectorObjects };
      await page.close();
    }
    report.plans[annot.planId] = row;
    console.log(annot.planId, "tables off/on", JSON.stringify(row.off.tables), JSON.stringify(row.on.tables), "chairs off/on", JSON.stringify(row.off.chairs), JSON.stringify(row.on.chairs), "proposals", JSON.stringify(row.on.proposals));
  }
} finally { await browser.close(); await app.close(); }
fs.writeFileSync(path.join(HERE, "vector-latest.json"), JSON.stringify(report, null, 1));
console.log("wrote benchmarks/offline-intelligence/vector-latest.json");
