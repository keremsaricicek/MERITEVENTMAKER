// Golden 2 development measurement — a SEEN plan since 2026-11-01 (README.md).
// Never report these numbers as an unseen-venue score.
//
//   node benchmarks/run-benchmark.mjs --annotations benchmarks/plans/blind/golden2-bench \
//     --out OUT/report.json --dump OUT
//   node benchmarks/plans/blind/golden2-score.mjs OUT/golden2-seen.detections.json [--json OUT.json]
//
// Reads the runner's raw dump (the real app's analysis, OCR from the pinned cache,
// the trained detector as shipped) and scores it against the table centres in
// golden2-bench/golden2-seen.json: tables matched one-for-one (greedy nearest, within
// 3% of the diagonal), phantom tables, chairs at each matched table (capped at the
// table's counted chairs: "seated at the right table" without chair positions),
// and chairs found loose.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dump = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const annot = JSON.parse(fs.readFileSync(path.join(here, "golden2-bench/golden2-seen.json"), "utf8"));
const W = annot.source.width, H = annot.source.height, tol = annot.matchToleranceP / 100 * Math.hypot(W, H);
const live = dump.candidates.filter((c) => c.status !== "rejected");
const px = (c) => ({ cx: (c.xPct + c.wPct / 2) / 100 * W, cy: (c.yPct + c.hPct / 2) / 100 * H, w: c.wPct / 100 * W, h: c.hPct / 100 * H });
const tables = live.filter((c) => c.kind === "table").map((c) => ({ ...c, ...px(c) }));
const gt = annot.objects.filter((o) => o.class === "table");
const pairs = [];
gt.forEach((g, gi) => tables.forEach((d, di) => { const dist = Math.hypot(g.cx - d.cx, g.cy - d.cy); if (dist <= tol) pairs.push({ gi, di, dist }); }));
pairs.sort((a, b) => a.dist - b.dist);
const gU = new Map(), dU = new Set();
for (const p of pairs) { if (gU.has(p.gi) || dU.has(p.di)) continue; gU.set(p.gi, p.di); dU.add(p.di); }
const perTable = gt.map((g, gi) => {
  const d = gU.has(gi) ? tables[gU.get(gi)] : null;
  return { id: g.id, type: g.type, found: !!d, foundAs: d ? d.type : null, chairsTruth: g.chairs, chairsFound: d ? d.chairCount : 0,
    seated: d ? Math.min(d.chairCount, g.chairs) : 0, box: d ? [Math.round(d.w), Math.round(d.h)] : null };
});
const phantom = tables.filter((_, di) => !dU.has(di)).map((d) => ({ id: d.id, type: d.type, cx: Math.round(d.cx), cy: Math.round(d.cy), w: Math.round(d.w), h: Math.round(d.h), chairs: d.chairCount }));
const loose = live.filter((c) => c.kind === "venue" && c.type === "chair").map((c) => { const p = px(c); return { cx: Math.round(p.cx), cy: Math.round(p.cy), w: Math.round(p.w), h: Math.round(p.h) }; });
const byType = {};
for (const t of perTable) { const b = (byType[t.type] ||= { found: 0, of: 0 }); b.of++; if (t.found) b.found++; }
const out = {
  plan: "golden2 (SEEN)", tablesFound: perTable.filter((t) => t.found).length, tablesTruth: gt.length, byType,
  phantomTables: phantom.length, chairsSeated: perTable.reduce((n, t) => n + t.seated, 0), chairsTruth: gt.reduce((n, g) => n + g.chairs, 0),
  chairsOnTables: tables.reduce((n, t) => n + t.chairCount, 0), chairsOverCount: perTable.reduce((n, t) => n + Math.max(0, t.chairsFound - t.chairsTruth), 0),
  looseChairs: loose.length, missed: perTable.filter((t) => !t.found).map((t) => t.id),
  short: perTable.filter((t) => t.found && t.chairsFound < t.chairsTruth).map((t) => `${t.id} ${t.chairsFound}/${t.chairsTruth}`),
  phantom, loose, perTable,
};
console.log(`GOLDEN2 (SEEN) tables ${out.tablesFound}/${out.tablesTruth} ${JSON.stringify(byType)} phantom ${out.phantomTables}`);
console.log(`  chairs seated ${out.chairsSeated}/${out.chairsTruth} on tables ${out.chairsOnTables} (over ${out.chairsOverCount}) loose ${out.looseChairs}`);
console.log(`  missed ${out.missed.join(" ") || "-"}   short ${out.short.join(", ") || "-"}`);
if (phantom.length) console.log(`  phantom ${JSON.stringify(phantom)}`);
console.log(`  loose ${loose.map((l) => `(${l.cx},${l.cy} ${l.w}x${l.h})`).join(" ")}`);
const j = process.argv.indexOf("--json");
if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 1));
