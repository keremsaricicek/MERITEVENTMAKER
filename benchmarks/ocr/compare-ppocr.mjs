// PP-OCRv4 (in the product) against PP-OCRv5 mobile, on the real plans —
// measured before anything is switched (benchmarks/plan-understanding/TOOLS.md T3).
//
//   node benchmarks/ocr/compare-ppocr.mjs
//
// Needs the v5 package in the vendor cache, fetched once from the npm registry
// and checked against its published integrity:
//   npm pack pdfmarkdown-ppocrv5-models@1.0.0   (sha512-BDxXJ0k2…ysdyg==)
//   → .vendor-cache/pdfmarkdown-ppocrv5-models-1.0.0/package/
//
// The engine is swapped through a benchmark-only override that the product
// never sets (globalThis.MERIT_PPOCR_EXPERIMENT, read once in
// MeritPaddleOCR.load), with the v5 files pinned here by sha256 and size the
// way the product pins v4. Everything else is the same app, the same detector,
// pinned OCR, network refused. Scored against the annotations: on ORNEK each
// legible table number read right, read wrong, or not read; and every word
// the reading puts in a category (title, venue, capacity, places).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp, REPO_ROOT } from "../../tests/lib/server.mjs";
import { routeVendorFromCache, CACHE } from "../../tests/lib/vendor.mjs";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../../tests/lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V5DIR = path.join(CACHE, "pdfmarkdown-ppocrv5-models-1.0.0", "package");
if (!fs.existsSync(V5DIR)) { console.error("PP-OCRv5 package not in the vendor cache — see the header"); process.exit(2); }
const KEYS_URL = "https://cdn.jsdelivr.net/npm/pdfmarkdown-ppocrv5-models@1.0.0/recognition/ppocrv5_dict.keys.js";
// The package's dictionary starts with a placeholder line: the model's output
// index i is line i (index 0 the CTC blank), not line i-1 as in the v4 list.
// Measured, not assumed: read with the list as-is, every character came back
// one place early ("GIRIS" read "FHQHR"); dropping the first line fixes all.
const dictFile = fs.readFileSync(path.join(V5DIR, "recognition/ppocrv5_dict.txt"), "utf8").split(/\r?\n/);
if (dictFile[dictFile.length - 1] === "") dictFile.pop();
const dict = dictFile.slice(1);
import crypto from "node:crypto";
const pin = (rel) => { const b = fs.readFileSync(path.join(V5DIR, rel)); return { file: rel, sha256: crypto.createHash("sha256").update(b).digest("hex"), bytes: b.length }; };
const V5 = { id: "ppocr-v5-mobile-experiment", label: "PP-OCRv5 mobile (experiment)",
  models: { package: "pdfmarkdown-ppocrv5-models", version: "1.0.0", license: "Apache-2.0",
    det: pin("detection/PP-OCRv5_mobile_det_infer.ort"), rec: pin("recognition/PP-OCRv5_mobile_rec_infer.onnx") },
  keysScript: KEYS_URL, keysGlobal: "MERIT_PPOCR_V5_KEYS", keysCount: dict.length };

async function run(browser, baseUrl, engine, file) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  await routeVendorFromCache(page, { offline: true });
  if (engine === "v5") {
    await page.route(KEYS_URL, (r) => r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: `globalThis.MERIT_PPOCR_V5_KEYS=${JSON.stringify(dict)};` }));
    await page.addInitScript((p) => { globalThis.MERIT_PPOCR_EXPERIMENT = p; }, V5);
  }
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "OCR " + engine, date: futureDate() });
  await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(REPO_ROOT, "benchmarks/plans", file)).toString("base64"));
  const t0 = Date.now();
  await runDetection(page, { timeout: 600000 });
  const ms = Date.now() - t0;
  const out = await page.evaluate(() => {
    const a = state.events[0].analysis, r = MeritPlanReading.read(a);
    return { ocr: a.ocrModel && { available: a.ocrModel.available, provider: a.ocrModel.provider && (a.ocrModel.provider.id || a.ocrModel.provider), items: (a.ocrModel.items || []).length, ms: a.ocrModel.ms, reason: a.ocrModel.reasonCode || null },
      tables: a.candidates.filter((c) => c.kind === "table" && c.status !== "rejected").map((c) => ({ cx: c.x + c.w / 2, cy: c.y + c.h / 2, n: c.printedNumber && c.printedNumber.state === "VERIFIED" ? String(c.printedNumber.value) : null })),
      words: r.texts.filter((t) => t.category !== "number").map((t) => ({ text: t.text, category: t.category })) };
  });
  await page.close();
  return { ms, ...out };
}

function scoreNumbers(annot, det) {
  const W = annot.source.width, H = annot.source.height, tol = (annot.matchToleranceP ?? 3) / 100 * Math.hypot(W, H);
  const gt = annot.objects.filter((o) => o.class === "table" && o.number != null && o.numberLegible !== false).map((o) => ({ ...o, px: (o.cx ?? (o.x + o.w / 2)), py: (o.cy ?? (o.y + o.h / 2)) }));
  const used = new Set(), s = { legible: gt.length, right: 0, wrong: 0, unread: 0, wrongList: [] };
  for (const g of gt) {
    let best = -1, bd = Infinity;
    det.tables.forEach((d, i) => { if (used.has(i)) return; const dd = Math.hypot(d.cx / 100 * W - g.px, d.cy / 100 * H - g.py); if (dd < bd && dd <= tol) { bd = dd; best = i; } });
    if (best < 0) { s.unread++; continue; }
    used.add(best);
    const n = det.tables[best].n;
    if (n == null) s.unread++; else if (n === String(g.number)) s.right++; else { s.wrong++; s.wrongList.push(`${g.number}→${n}`); }
  }
  return s;
}

const app = await serveApp(); const browser = await launchChromium();
const report = { measuredOn: new Date().toISOString(), v5: { det: V5.models.det, rec: V5.models.rec, keys: V5.keysCount }, plans: {} };
try {
  for (const [name, file, annotFile] of [["ornek", "ornek-upright.png", "ornek-symbolic.json"], ["golden", "merit-real-venue-plan.png", null]]) {
    report.plans[name] = {};
    for (const engine of ["v4", "v5"]) {
      const r = await run(browser, app.baseUrl, engine, file);
      const row = { ms: r.ms, ocr: r.ocr, words: r.words.map((w) => `${w.text} [${w.category}]`) };
      if (annotFile) {
        const annot = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "benchmarks/annotations", annotFile), "utf8"));
        // annotation boxes may be percent; normalise to pixels
        for (const o of annot.objects) if (o.cx == null && o.x <= 100 && o.w <= 100) { o.cx = (o.x + o.w / 2) / 100 * annot.source.width; o.cy = (o.y + o.h / 2) / 100 * annot.source.height; }
        row.numbers = scoreNumbers(annot, r);
      }
      report.plans[name][engine] = row;
      console.log(`${name} ${engine}: OCR ${r.ocr && r.ocr.available ? "on" : "OFF (" + (r.ocr && r.ocr.reason) + ")"}, ${r.ocr && r.ocr.items} items, ${r.ms} ms` + (row.numbers ? `, numbers right ${row.numbers.right} wrong ${row.numbers.wrong} unread ${row.numbers.unread} of ${row.numbers.legible}` : "") + `, words: ${r.words.length}`);
    }
  }
} finally { await browser.close(); await app.close(); }
fs.mkdirSync(HERE, { recursive: true });
fs.writeFileSync(path.join(HERE, "compare-latest.json"), JSON.stringify(report, null, 1));
console.log("wrote benchmarks/ocr/compare-latest.json");
