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
//   A CHAIR DRAWN INTO ITS TABLE'S EDGE faces it (D10, 2026-10-18): the
//     tabletop hides the stencil's front, but the join is drawn — walking
//     from the chair's centre toward the table's, its ink runs into the
//     table's drawn edge (an ellipse for a round or bistro table) with no
//     paper between. That states the facing toward the table's centre,
//     evidence drawnAgainstTable; a chair with paper between it and the
//     table, or one inside it, is given nothing.
//   ON THE GOLDEN PLAN: every facing the product states is one the annotation
//     agrees with (within 30 degrees), every one carries the evidence it was
//     read from (stencilBackrest or drawnAgainstTable), and the old per-chair
//     ink-centroid rule states nothing.
//   AND THE DIGITAL PLAN KEEPS IT: Confirm writes each observed facing onto
//     its chair (drawn the way it was seen), writes facing:null where the
//     drawing showed no front (drawn with no front mark), gives a person's
//     layout no observed facing at all, and a reload changes none of it.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate, addTables } from "../lib/app-actions.mjs";

export const meta = { name: "chair-facing", tags: ["intelligence"], timeout: 300000, viewport: { width: 1400, height: 900 } };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  await openApp(page, baseUrl, { lang: "en" });
  const synth = await page.evaluate(async () => {
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
    // Each case is read twice: straight through, and sliced (a pause at every
    // step, as the analysis runs it). The two must give the same answer.
    const flat = (res) => JSON.stringify({ byId: [...res.byId], families: res.families });
    let pauses = 0;
    const run = async (symbol, facings, boxOf) => {
      const r = raster(600, 140), chairs = [];
      facings.forEach((f, i) => { const cx = 40 + i * 70, cy = 70; draw(r, cx, cy, f, symbol);
        const b = boxOf(f); chairs.push({ id: "c" + i, cx, cy, w: b[0], h: b[1], rotation: 0 }); });
      const res = F.readFacing(r, chairs);
      const sliced = await F.readFacingSliced(r, chairs, undefined, async () => { pauses++; await new Promise((ok) => setTimeout(ok, 0)); });
      return { stated: facings.map((_, i) => res.byId.has("c" + i) ? res.byId.get("c" + i).facingAngle : null), families: res.families,
        slicedSame: flat(sliced) === flat(res) };
    };
    const armBox = (f) => (f % 180 === 0 ? [34, 30] : [30, 34]);
    out.arm = await run(inChair, [0, 90, 180, 270, 0, 90, 180, 270], armBox);
    out.square = await run(square, [0, 90, 180, 270, 0, 90], () => [30, 30]);
    out.plank = await run(plank, [0, 90, 0, 90, 0, 90], (f) => (f % 180 === 0 ? [34, 18] : [18, 34]));
    out.pair = await run(inChair, [0, 180], armBox);
    out.pauses = pauses;
    // A chair drawn AGAINST its table (D10): the chair's ink runs into the
    // table's drawn edge with no paper between. Table r=40 at (100,100).
    const TAN = [222, 205, 170], GREY = [140, 140, 140];
    const sheet = () => raster(220, 220);
    const disc = (r, cx, cy, rad) => { for (let y = cy - rad - 1; y <= cy + rad + 1; y++) for (let x = cx - rad - 1; x <= cx + rad + 1; x++) {
      const d = Math.hypot(x - cx, y - cy); if (d <= rad) px(r, x, y, d >= rad - 1.5 ? GREY : TAN); } };
    const box = (r, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(r, x, y, x === x0 || x === x1 || y === y0 || y === y1 ? GREY : TAN); };
    const table = { cx: 100, cy: 100, w: 80, h: 80, rotation: 0, type: "round" };
    const A = (r, chair, t = table) => { const f = F.againstFacing(r, chair, t, F.paperLevel(r)); return f ? [f.facingAngle, f.evidence] : null; };
    const r1 = sheet(); disc(r1, 100, 100, 40);
    box(r1, 139, 90, 157, 110);                          // east, its ink running into the disc's edge
    box(r1, 90, 139, 110, 157);                          // south, the same
    box(r1, 20, 90, 52, 110);                            // west, but 8 px of paper short of the disc
    const r2 = sheet(); box(r2, 60, 60, 140, 140); box(r2, 140, 140, 160, 160); // a chair at a SQUARE table's corner
    const r3 = sheet(); disc(r3, 100, 100, 40); box(r3, 140, 140, 160, 160);    // the same chair at a ROUND table
    out.against = {
      paper: F.paperLevel(r1),
      east: A(r1, { cx: 148, cy: 100 }),
      south: A(r1, { cx: 100, cy: 148 }),
      gap: A(r1, { cx: 36, cy: 100 }),
      inside: A(r1, { cx: 110, cy: 100 }),
      squareCorner: A(r2, { cx: 150, cy: 150 }, { ...table, type: "square" }),
      roundCorner: A(r3, { cx: 150, cy: 150 }),
    };
    return out;
  });
  checks.equal(JSON.stringify(synth.arm.stated), JSON.stringify([0, 90, 180, 270, 0, 90, 180, 270]),
    "eight armchairs from one stencil, in four orientations, each stated facing away from its own backrest", synth.arm);
  checks.ok(synth.square.stated.every(v => v === null), "plain squares have no front: nothing is stated", synth.square.stated);
  checks.ok(synth.plank.stated.every(v => v === null), "an elongated symbol with no backrest has an axis, not a front: nothing is stated", synth.plank.stated);
  checks.ok(synth.pair.stated.every(v => v === null), "two chairs are not a family: nothing is stated", synth.pair.stated);
  checks.ok(["arm", "square", "plank", "pair"].every(k => synth[k].slicedSame) && synth.pauses > 0,
    "the sliced read (a turn for the page between members) gives exactly the answer of the read run straight through", { pauses: synth.pauses });
  checks.equal(JSON.stringify([synth.against.east, synth.against.south]), JSON.stringify([[180, "drawnAgainstTable"], [270, "drawnAgainstTable"]]),
    "a chair whose ink runs into its round table's edge faces the table's centre, and says the join is how it is known", synth.against);
  checks.ok(synth.against.gap === null && synth.against.inside === null && synth.against.paper === 255,
    "a chair with paper between it and the table, or one inside the table, is given no facing: standing near is not a drawing of the two joined", synth.against);
  checks.ok(Array.isArray(synth.against.squareCorner) && synth.against.squareCorner[0] === 225 && synth.against.roundCorner === null,
    "the join is walked to the table's DRAWN edge: the same corner chair touches a square table and stands clear of a round one", synth.against);

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
  const fromStencil = stated.filter(c => c.evidence === "stencilBackrest"), joined = stated.filter(c => c.evidence === "drawnAgainstTable");
  checks.ok(fromStencil.length >= 70, "most of the Golden Plan's armchairs have their facing read off the stencil", fromStencil.length);
  checks.ok(joined.length >= 25 && stated.length / chairs.length >= 0.8,
    "the chairs drawn running into their round and bistro tables are stated facing them, and 80 % of all chairs now have a facing", { joined: joined.length, stated: stated.length, chairs: chairs.length });
  checks.equal(disagreements.length, 0, "every stated facing agrees with the annotation within 30 degrees", disagreements.slice(0, 5));
  checks.ok(stated.every(c => c.evidence === "stencilBackrest" || c.evidence === "drawnAgainstTable"), "and every one says what it was read from: the stencil's backrest, or the chair drawn into its table's edge");
  checks.ok(chairs.filter(c => !c.known).every(c => c.evidence === "stencilNotRead"), "a chair the stencil reading cannot settle says so, rather than keeping a per-chair guess");

  // ---- the facing survives Confirm, a save and a reload --------------------------
  await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; render(); });
  await page.click('[data-review-action="commit"]');
  await page.waitForTimeout(600);
  // A manual table beside the committed ones: its chairs come from the layout,
  // which seats them facing the table, and nobody observed anything about them.
  await addTables(page, { quantity: 1, type: "round" });
  const committed = () => page.evaluate(() => {
    const ts = state.events[0].tables, rows = [];
    for (const t of ts) for (const c of t.chairs || []) rows.push({ origin: t.origin, table: t.rotation || 0, rotation: c.rotation, has: "facing" in c, facing: c.facing, source: c.facingSource });
    const norm = a => ((a % 360) + 360) % 360, diff = (a, b) => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, 360 - d); };
    const det = rows.filter(r => r.origin === "DETECTED"), known = det.filter(r => Number.isFinite(r.facing));
    return {
      detected: det.length, known: known.length,
      // The canvas draws a chair at rotation 0 facing +y of its table, so the
      // drawn facing is table + chair rotation + 90 and must BE the observed one.
      drawnAsObserved: known.filter(r => diff(r.table + r.rotation + 90, r.facing) < 1e-6).length,
      knownSources: [...new Set(known.map(r => r.source))],
      unknown: det.filter(r => r.facing === null).length,
      unknownSources: [...new Set(det.filter(r => r.facing === null).map(r => r.source))],
      manual: rows.filter(r => r.origin === "MANUAL").length, manualWithFacing: rows.filter(r => r.origin === "MANUAL" && r.has).length,
      renderedUnknown: document.querySelectorAll(".table-object .chair.facing-unknown").length,
      rendered: document.querySelectorAll(".table-object .chair").length,
    };
  });
  const first = await committed();
  checks.ok(first.known === stated.length && first.drawnAsObserved === first.known
    && first.knownSources.slice().sort().join() === [...new Set(stated.map(c => c.evidence))].sort().join(),
    "every facing read off the stencil is kept on the committed chair, drawn the way it was observed, and says where it came from", first);
  checks.ok(first.unknown === first.detected - first.known && first.unknownSources.join() === "notObserved" && first.renderedUnknown === first.unknown,
    "a detected chair whose front was not seen is committed facing:null and drawn with no front mark", first);
  checks.ok(first.manual > 0 && first.manualWithFacing === 0,
    "a chair a person laid out carries no observed facing: the layout seats it toward its table", first);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => { openEvent(state.events[0].id); ui.tab = "floor"; ui.planMode = "plan"; render(); });
  await page.waitForTimeout(500);
  const second = await committed();
  checks.equal(JSON.stringify(second), JSON.stringify(first), "and all of it survives a save and a reload, field for field", { first, second });
}
