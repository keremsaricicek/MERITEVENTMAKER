#!/usr/bin/env node
// Does MeritPlanModelFusion.orientPiece recover a seating piece's turn from its
// pixels? (R2, 2026-10-17)
//
//   node benchmarks/relations/measure-piece-orientation.mjs --dir DIR [--dir DIR ...] [--out FILE]
//
// Each annotated sofa, bench and banquette is handed to orientPiece as the
// detector hands it: its axis-aligned envelope, no turn. Counted per piece:
//   turned     the piece is turned more than 5 degrees from an axis
//   recovered  a turned piece whose fitted turn is within 5 degrees of the
//              truth (180-degree symmetric: a box has no front)
//   wrongTurn  a fit whose turn is more than 5 degrees off
//   keptBox    no fit (the envelope stands) — right for an unturned piece,
//              a miss for a turned one
//   sizeErr    |fitted long side / true long side - 1|, and the same for depth,
//              on recovered pieces
import fs from "node:fs";
import path from "node:path";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

const argv = process.argv.slice(2);
const dirs = argv.flatMap((a, i) => a === "--dir" ? [argv[i + 1]] : []);
const oi = argv.indexOf("--out"), OUT = oi >= 0 ? argv[oi + 1] : null;
const FURNITURE = new Set(["sofa", "bench", "banquette"]);
const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".json") && f !== "index.json").sort().map((f) => path.join(d, f)));

const app = await serveApp();
const browser = await launchChromium();
const page = await browser.newPage();
await page.goto(`${app.baseUrl}/index.html`);
await page.waitForFunction(() => !!globalThis.MeritPlanModelFusion?.orientPiece);
const rows = [];
for (const file of files) {
  const a = JSON.parse(fs.readFileSync(file, "utf8"));
  const pieces = a.objects.filter((o) => FURNITURE.has(o.class) && !o.ignore).map((o) => {
    const r = (o.rotation || 0) * Math.PI / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    return { id: o.id, class: o.class, rot: o.rotation || 0, L: Math.max(o.w, o.h), D: Math.min(o.w, o.h), long: o.w >= o.h,
      det: { cx: o.cx, cy: o.cy, w: o.w * c + o.h * s, h: o.w * s + o.h * c } };
  });
  const src = `data:image/png;base64,${fs.readFileSync(path.join(path.dirname(file), a.source.file)).toString("base64")}`;
  const fits = await page.evaluate(async ({ src, dets }) => {
    const img = new Image(); img.src = src; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext("2d"); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, cv.width, cv.height).data;
    return dets.map((d) => MeritPlanModelFusion.orientPiece(px, cv.width, cv.height, d));
  }, { src, dets: pieces.map((p) => p.det) });
  pieces.forEach((p, i) => {
    // the true long axis's turn, folded into (-90, 90]
    let t = p.rot + (p.long ? 0 : 90); t = ((t % 180) + 180) % 180; if (t > 90) t -= 180;
    const turned = Math.min(Math.abs(t), Math.abs(Math.abs(t) - 90)) > 5;
    const f = fits[i];
    let err = null;
    if (f) { err = Math.abs(f.rotation - t) % 180; err = Math.min(err, 180 - err); }
    rows.push({ plan: a.planId, id: p.id, class: p.class, truthTurn: t, turned, fit: f ? f.rotation : null, err, fitBox: f,
      lErr: f ? Math.abs(f.w / p.L - 1) : null, dErr: f ? Math.abs(f.h / p.D - 1) : null });
  });
}
await browser.close();
await app.close?.();
const turned = rows.filter((r) => r.turned), flat = rows.filter((r) => !r.turned);
const rec = turned.filter((r) => r.fit != null && r.err <= 5);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[s.length >> 1] * 1000) / 1000 : null; };
const summary = {
  pieces: rows.length, turned: turned.length, recovered: rec.length,
  turnedKeptBox: turned.filter((r) => r.fit == null).length,
  wrongTurn: rows.filter((r) => r.fit != null && r.err > 5).length,
  unturnedKeptBox: flat.filter((r) => r.fit == null).length, unturned: flat.length,
  medianLongSideErr: med(rec.map((r) => r.lErr)), medianDepthErr: med(rec.map((r) => r.dErr)),
  byClass: Object.fromEntries([...FURNITURE].map((c) => [c, { turned: turned.filter((r) => r.class === c).length, recovered: rec.filter((r) => r.class === c).length }])),
};
console.log(JSON.stringify(summary, null, 1));
const bad = rows.filter((r) => (r.turned && (r.fit == null || r.err > 5)) || (!r.turned && r.fit != null && r.err > 5));
if (bad.length) console.log(`\nmisses (${bad.length}):\n` + bad.slice(0, 12).map((r) => JSON.stringify(r)).join("\n"));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), summary, rows }, null, 1));
