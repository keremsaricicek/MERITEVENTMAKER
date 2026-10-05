// Which way a chair faces, read off its own stencil (src/plan-chair-facing.js).
//
// What this pins:
//   A FAMILY'S BACKREST IS READ, NOT GUESSED: armchair symbols drawn from one
//     stencil in all four orientations are each stated facing away from their
//     own backrest — the side that shows two lines (the edge and the
//     backrest's inner edge) where the front shows one.
//   A SYMMETRIC SYMBOL HAS NO FRONT: plain squares state nothing, and so does
//     a family too small to be a family.
//   THE BOX ANGLE IS NOT A FRONT: an elongated symbol with no backrest line
//     states nothing however clearly its axis is known.
//   ON THE GOLDEN PLAN: every facing the product states is one the annotation
//     agrees with (within 30 degrees), every one carries stencilBackrest as
//     its evidence, and the old per-chair ink-centroid rule states nothing.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "chair-facing", tags: ["intelligence"], timeout: 300000, viewport: { width: 1400, height: 900 } };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  await openApp(page, baseUrl, { lang: "en" });
  const synth = await page.evaluate(() => {
    const F = globalThis.MeritChairFacing;
    const raster = (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) });
    const px = (r, x, y, rgb) => { if (x < 0 || y < 0 || x >= r.width || y >= r.height) return; const p = 4 * (y * r.width + x); r.data[p] = rgb[0]; r.data[p + 1] = rgb[1]; r.data[p + 2] = rgb[2]; };
    const ORANGE = [236, 125, 50], LINE = [110, 120, 130];
    // An armchair facing +x in its own frame: 34 deep (x) by 30 wide (y).
    // Back at -x: the outer edge and an inner backrest line at depth 9.
    // Arms at -y and +y: inner lines at depth 6. Front at +x: the edge only.
    const inChair = (u, v) => {
      const D = 17, Wd = 15;
      if (Math.abs(u) > D || Math.abs(v) > Wd) return null;
      const edge = Math.abs(u) >= D - 1 || Math.abs(v) >= Wd - 1;
      const back = Math.abs(u - (-D + 9)) < 1 && Math.abs(v) <= Wd - 6;
      const arms = Math.abs(Math.abs(v) - (Wd - 6)) < 1 && u >= -D + 9;
      return edge || back || arms ? LINE : ORANGE;
    };
    const draw = (r, cx, cy, facing, symbol) => {
      const rad = facing * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
      for (let y = cy - 25; y <= cy + 25; y++) for (let x = cx - 25; x <= cx + 25; x++) {
        const dx = x - cx, dy = y - cy, u = c * dx + s * dy, v = -s * dx + c * dy;
        const col = symbol(u, v); if (col) px(r, x, y, col);
      }
    };
    const square = (u, v) => (Math.abs(u) > 15 || Math.abs(v) > 15 ? null : Math.abs(u) >= 14 || Math.abs(v) >= 14 ? LINE : ORANGE);
    const plank = (u, v) => (Math.abs(u) > 17 || Math.abs(v) > 9 ? null : Math.abs(u) >= 16 || Math.abs(v) >= 8 ? LINE : ORANGE);
    const out = {};
    const run = (symbol, facings, boxOf) => {
      const r = raster(600, 140), chairs = [];
      facings.forEach((f, i) => { const cx = 40 + i * 70, cy = 70; draw(r, cx, cy, f, symbol);
        const b = boxOf(f); chairs.push({ id: "c" + i, cx, cy, w: b[0], h: b[1], rotation: 0 }); });
      const res = F.readFacing(r, chairs);
      return { stated: facings.map((_, i) => res.byId.has("c" + i) ? res.byId.get("c" + i).facingAngle : null), families: res.families };
    };
    const armBox = (f) => (f % 180 === 0 ? [34, 30] : [30, 34]);
    out.arm = run(inChair, [0, 90, 180, 270, 0, 90, 180, 270], armBox);
    out.square = run(square, [0, 90, 180, 270, 0, 90], () => [30, 30]);
    out.plank = run(plank, [0, 90, 0, 90, 0, 90], (f) => (f % 180 === 0 ? [34, 18] : [18, 34]));
    out.pair = run(inChair, [0, 180], armBox);
    return out;
  });
  checks.equal(JSON.stringify(synth.arm.stated), JSON.stringify([0, 90, 180, 270, 0, 90, 180, 270]),
    "eight armchairs from one stencil, in four orientations, each stated facing away from its own backrest", synth.arm);
  checks.ok(synth.square.stated.every(v => v === null), "plain squares have no front: nothing is stated", synth.square.stated);
  checks.ok(synth.plank.stated.every(v => v === null), "an elongated symbol with no backrest has an axis, not a front: nothing is stated", synth.plank.stated);
  checks.ok(synth.pair.stated.every(v => v === null), "two chairs are not a family: nothing is stated", synth.pair.stated);

  // ---- the Golden Plan ------------------------------------------------------------
  const plan = "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64");
  await createBlankEvent(page, { name: "Facing", date: futureDate() });
  await importPlan(page, plan);
  await runDetection(page);
  const chairs = await page.evaluate(() => state.events[0].analysis.candidates.filter(c => c.kind === "table")
    .flatMap(c => (c.chairDetections || []).map(ch => ({ x: ch.x / 100 * 1355, y: ch.y / 100 * 788,
      known: !!(ch.relation && ch.relation.orientation && ch.relation.orientation.facingKnown),
      angle: ch.relation && ch.relation.orientation ? ch.relation.orientation.facingAngle : null,
      evidence: ch.relation && ch.relation.orientation ? ch.relation.orientation.facingEvidence : null }))));
  const truth = JSON.parse(fs.readFileSync(path.join(repoRoot, "benchmarks/plan-understanding/truth/merit-real-venue.json"), "utf8"));
  const ann = JSON.parse(fs.readFileSync(path.join(repoRoot, "benchmarks/annotations/merit-real-venue.json"), "utf8"));
  const byId = new Map(ann.objects.map(o => [o.id, o]));
  const stated = chairs.filter(c => c.known);
  const angDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return Math.min(d, 360 - d); };
  const disagreements = [];
  for (const c of stated) {
    let best = null, bd = Infinity;
    for (const f of truth.chairFacing) { const o = byId.get(f.chair); const d = Math.hypot(o.cx - c.x, o.cy - c.y); if (d < bd) { bd = d; best = f; } }
    if (!best || bd > 15 || angDiff(best.facingDeg, c.angle) > 30) disagreements.push({ at: [Math.round(c.x), Math.round(c.y)], stated: c.angle, truth: best && best.facingDeg, d: Math.round(bd) });
  }
  checks.ok(stated.length >= 70, "most of the Golden Plan's armchairs have their facing read off the stencil", stated.length);
  checks.equal(disagreements.length, 0, "every stated facing agrees with the annotation within 30 degrees", disagreements.slice(0, 5));
  checks.ok(stated.every(c => c.evidence === "stencilBackrest"), "and every one says it came from the stencil's backrest");
  checks.ok(chairs.filter(c => !c.known).every(c => c.evidence === "stencilNotRead"), "a chair the stencil reading cannot settle says so, rather than keeping a per-chair guess");
}
