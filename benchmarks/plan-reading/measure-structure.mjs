// Columns and pushed-together tables on the Golden Plan, against
// golden-structure.json (MODEL-ASSISTED labels — see its annotationMethod).
//
//   node benchmarks/plan-reading/measure-structure.mjs
//
// The real app, the real detector, pinned OCR, network refused. A detected
// column matches a labelled one when its centre falls inside the labelled box
// grown by 1.5 % of the plan; a detected group matches a labelled one when
// their boxes overlap by IoU ≥ 0.5 AND they hold the same number of tables.
// The ambiguous pair is scored neither way. Seats: chairs the reading counts
// for a matched group, against the chairs labelled for it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp, REPO_ROOT } from "../../tests/lib/server.mjs";
import { routeVendorFromCache } from "../../tests/lib/vendor.mjs";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../../tests/lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const truth = JSON.parse(fs.readFileSync(path.join(HERE, "golden-structure.json"), "utf8"));
const iou = (a, b) => { const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h); const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); return i / (a.w * a.h + b.w * b.h - i || 1); };
const inside = (p, b, g) => p.x >= b.x - g && p.x <= b.x + b.w + g && p.y >= b.y - g && p.y <= b.y + b.h + g;

const app = await serveApp(); const browser = await launchChromium();
let det;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await routeVendorFromCache(page);
  await openApp(page, app.baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Structure", date: futureDate() });
  await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(REPO_ROOT, "benchmarks", truth.source.file)).toString("base64"));
  await runDetection(page);
  det = await page.evaluate(() => {
    const a = state.events[0].analysis, r = MeritPlanReading.read(a), byId = new Map(a.candidates.map((c) => [c.id, c]));
    const offered = (c) => c && c.status !== "rejected" && (c.status === "confirmed" || c.selected !== false);
    const groups = (a.planIntelligence.furnitureGroups || []).map((g) => g.memberIds.map((id) => byId.get(id)).filter(offered)).filter((m) => m.length > 1).map((m) => {
      const x0 = Math.min(...m.map((c) => c.x)), y0 = Math.min(...m.map((c) => c.y)), x1 = Math.max(...m.map((c) => c.x + c.w)), y1 = Math.max(...m.map((c) => c.y + c.h));
      return { tables: m.length, chairs: m.reduce((k, c) => k + (c.chairDetections || []).length, 0), box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
    });
    const columns = a.candidates.filter((c) => offered(c) && c.type === "column").map((c) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 }));
    const stage = a.candidates.filter((c) => offered(c) && c.type === "stage").map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }));
    const sight = [...r.headline, ...r.sections.flatMap((s) => s.sentences)].find((s) => s.key === "read.room.sightline");
    return { groups, columns, stage, sightline: sight ? sight.params : null };
  });
} finally { await browser.close(); await app.close(); }

// columns
const colUsed = new Set();
let colTP = 0;
for (const c of det.columns) {
  const hit = truth.columns.items.findIndex((t, i) => !colUsed.has(i) && inside(c, t.box, 1.5));
  if (hit >= 0) { colUsed.add(hit); colTP++; }
}
const missedColumns = truth.columns.items.filter((_, i) => !colUsed.has(i)).map((t) => t.id);
// groups
const gUsed = new Set();
let gTP = 0, seatsRight = 0, ambiguousHits = 0;
const unmatched = [];
for (const g of det.groups) {
  const hit = truth.mergedTables.items.findIndex((t, i) => !gUsed.has(i) && t.tables === g.tables && iou(t.box, g.box) >= 0.5);
  if (hit >= 0) { gUsed.add(hit); gTP++; if (truth.mergedTables.items[hit].chairs === g.chairs) seatsRight++; continue; }
  if (truth.mergedTables.ambiguous.some((t) => iou(t.box, g.box) >= 0.3)) { ambiguousHits++; continue; }
  unmatched.push(g);
}
const scored = det.groups.length - ambiguousHits;
const report = {
  measuredOn: new Date().toISOString(), labels: "MODEL-ASSISTED, not human-verified",
  columns: { labelled: truth.columns.items.length, detected: det.columns.length, matched: colTP,
    precision: +(colTP / (det.columns.length || 1)).toFixed(3), recall: +(colTP / truth.columns.items.length).toFixed(3), missed: missedColumns },
  mergedTables: { labelled: truth.mergedTables.items.length, detected: det.groups.length, ambiguousDetected: ambiguousHits, matched: gTP,
    precision: +(gTP / (scored || 1)).toFixed(3), recall: +(gTP / truth.mergedTables.items.length).toFixed(3), seatsExact: `${seatsRight}/${gTP}`,
    unmatched: unmatched.map((g) => ({ tables: g.tables, box: Object.fromEntries(Object.entries(g.box).map(([k, v]) => [k, +v.toFixed(1)])) })) },
  stage: { detected: det.stage.length, iou: det.stage.length ? +iou(det.stage[0], truth.stage.box).toFixed(3) : 0 },
  sightline: det.sightline,
};
fs.writeFileSync(path.join(HERE, "structure-latest.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
