// The digital plan lies on its own drawing — position, size, shape and chairs.
//
// Confirming a detected plan writes tables and venue objects onto the floor
// plan. Until 2026-10-04 that write mapped a plan's height by the world's
// fixed 788 px — the Golden Plan's own height — and grew every object to at
// least 55 x 45. On the Golden Plan both were invisible (its aspect IS the
// world's); on any other plan the drawing's top and bottom were cut off by the
// world box and committed tables landed off their own drawing (measured on
// ORNEK, 2402 x 1719: the world box clipped 91 px top and bottom), and small
// objects and their chairs moved. benchmarks/plan-understanding measures it on
// both real plans (the `digital.*` contract rows); this suite pins the rule.
//
// What it pins, on a plan whose aspect is NOT the world's:
//   THE WORLD TAKES THE PLAN'S ASPECT, so the whole drawing is visible and
//     plan percent -> world is a uniform scale (a circle stays a circle).
//   A COMMITTED TABLE'S SURFACE IS WHERE THE DRAWING HAS IT, at its own size,
//     with no minimum-size growth — small objects included.
//   EVERY CHAIR IS WHERE THE DETECTOR FOUND IT on the floor plan, outside the
//     table's own box too, and on a ROTATED table it is not rotated twice.
//   A VENUE OBJECT keeps its own size and place.
//   SAVE -> RELOAD keeps the surface box; a hand-made table has none and keeps
//     the stylesheet's surface.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, importPlan, futureDate, click, addTables, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "digital-plan-fidelity", tags: ["business", "fast"], timeout: 120000, viewport: { width: 1600, height: 1000 } };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Fidelity", hotel: "Merit", date: futureDate() });
  // ORNEK's real image: 2402 x 1719, an aspect (1.397) that is not the world's (1.720).
  const plan = fs.readFileSync(path.join(repoRoot, "benchmarks/plans/ornek-upright.png")).toString("base64");
  await importPlan(page, "data:image/png;base64," + plan);
  await page.waitForTimeout(600);

  const W = 2402, H = 1719;
  await page.evaluate(({ W, H }) => {
    const event = state.events[0];
    const cand = (id, kind, type, x, y, w, h, rotation, chairs) => ({
      id, kind, type, x, y, w, h, rotation, confidence: 0.9, status: "unreviewed", selected: true,
      chairDetections: chairs || [], evidence: { geometry: 0.8, chairs: (chairs || []).length, repetition: 4 } });
    // A ROUND table 78 px across on the drawing (3.247% x 4.537%), near the
    // bottom edge where the old mapping drifted most, with three chairs drawn
    // outside it (centres, in plan percent).
    const round = cand("round", "table", "round", 70, 85, 78 / W * 100, 78 / H * 100, 0, [
      { id: "r1", x: 71.62, y: 83.4, w: 1.0, h: 1.4, rotation: 0 },
      { id: "r2", x: 74.1, y: 87.3, w: 1.0, h: 1.4, rotation: 90 },
      { id: "r3", x: 69.3, y: 87.6, w: 1.0, h: 1.4, rotation: 270 } ]);
    // A SMALL table (30 x 24 px) the old write grew to 55 x 45.
    const small = cand("small", "table", "bistro", 10, 10, 30 / W * 100, 24 / H * 100, 0, []);
    // A ROTATED rectangle with one chair beyond its long end.
    const rotated = cand("rot", "table", "rectangle", 40, 40, 6, 3, 30, [
      { id: "q1", x: 46.4, y: 43.9, w: 1.0, h: 1.4, rotation: 30 } ]);
    const stage = cand("stage", "venue", "stage", 30, 5, 40, 8, 0, []);
    event.analysis = {
      id: "an-fidelity", engine: "ASSISTED_DETECTION", trainedModel: false, createdAt: new Date().toISOString(),
      imageWidth: 1920, imageHeight: Math.round(1920 * H / W), originalWidth: W, originalHeight: H, threshold: 128,
      frames: { source: { width: W, height: H }, analysis: { width: 1920, height: Math.round(1920 * H / W), ratio: 1920 / W }, deskewDeg: 0,
        storedIn: "plan-percent of the analysis canvas", conventions: { candidate: "corner", seat: "centre" } },
      candidates: [round, small, rotated, stage], missed: [], groupingDecisions: [],
      comparison: { added: 4, removed: 0, changed: 0 }, memoryReapplied: 0, memoryRestored: 0, memoryConflicts: [],
      ocr: { available: false, reason: "not attempted", engine: "tesseract.js" }, ocrText: null, timings: {},
      diagnostics: { representation: { kind: "PHYSICAL", associationRate: 0.96, evidence: {} } },
    };
    event.analysis.planIntelligence = globalThis.buildPlanIntelligence(event, null);
    ui.tab = "floor"; ui.planMode = "review"; render();
  }, { W, H });
  await click(page, '[data-review-action="commit"]');
  await page.waitForTimeout(500);

  const out = await page.evaluate(({ W, H }) => {
    const e = state.events[0], el = document.getElementById("canvasWorld");
    const world = { width: el.offsetWidth, height: el.offsetHeight };
    const k = world.width / W;                      // world px per plan px (uniform)
    const plan = (x, y) => [x * k, y * k];           // plan px -> world px at scale 100
    const byType = t => e.tables.find(x => x.type === t);
    const surface = t => { const s = t.surface || { x: 0, y: 0, w: 100, h: 100 };
      return { cx: t.x + (s.x + s.w / 2) / 100 * t.w, cy: t.y + (s.y + s.h / 2) / 100 * t.h, w: s.w / 100 * t.w, h: s.h / 100 * t.h }; };
    // Where the canvas draws a chair: left/top % of the table box, inside the
    // table element rotated about its centre.
    const chairWorld = (t, c) => {
      const lx = c.x / 100 * t.w - t.w / 2, ly = c.y / 100 * t.h - t.h / 2, r = (t.rotation || 0) * Math.PI / 180;
      return [t.x + t.w / 2 + lx * Math.cos(r) - ly * Math.sin(r), t.y + t.h / 2 + lx * Math.sin(r) + ly * Math.cos(r)];
    };
    const round = byType("round"), small = byType("bistro"), rot = byType("rectangle");
    const venue = e.venueObjects.find(v => v.type === "stage");
    return {
      world, k,
      layerSize: getComputedStyle(el.querySelector(".reference-layer")).backgroundSize,
      round: { surface: surface(round), want: { cx: plan((0.70 + 78 / W / 2) * W, 0)[0], cy: plan(0, (0.85 + 78 / H / 2) * H)[1], d: 78 * k },
        chairs: round.chairs.map(c => chairWorld(round, c)),
        wantChairs: [[71.62, 83.4], [74.1, 87.3], [69.3, 87.6]].map(([x, y]) => plan(x / 100 * W, y / 100 * H)),
        surfaceStyled: !!document.querySelector(`[data-object-id="${round.id}"] .table-surface[style]`) },
      small: { surface: surface(small), w: 30 * k, h: 24 * k },
      rot: { chair: chairWorld(rot, rot.chairs[0]), want: plan(46.4 / 100 * W, 43.9 / 100 * H), chairRotation: rot.chairs[0].rotation, tableRotation: rot.rotation },
      venue: { x: venue.x, y: venue.y, w: venue.w, h: venue.h, want: { x: plan(0.30 * W, 0)[0], y: plan(0, 0.05 * H)[1], w: 0.40 * W * k, h: 0.08 * H * k } },
    };
  }, { W, H });

  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  checks.ok(near(out.world.width, 1355, 0.5) && near(out.world.height, 1355 * H / W, 1), "the world box takes the plan's aspect (1355 x 970 for a 2402 x 1719 plan), so nothing of the drawing is cut off", out.world);
  checks.ok(["100%", "100% auto"].includes(out.layerSize), "and the reference layer still draws the image full width, its own aspect", out.layerSize);
  checks.ok(near(out.round.surface.cx, out.round.want.cx, 1e-6) && near(out.round.surface.cy, out.round.want.cy, 1e-6),
    "a committed table's surface centre is exactly where the drawing has it — near the bottom too, where the old mapping drifted most", out.round);
  checks.ok(near(out.round.surface.w, out.round.want.d, 1e-6) && near(out.round.surface.h, out.round.want.d, 1e-6),
    "and a round table is round: the same size across and down, its drawn size", out.round.surface);
  checks.ok(out.round.surfaceStyled, "the canvas draws the table surface at its stored box");
  checks.ok(out.round.chairs.every((c, i) => near(c[0], out.round.wantChairs[i][0], 1e-6) && near(c[1], out.round.wantChairs[i][1], 1e-6)),
    "every chair sits exactly where the detector found it — outside the table's box, not pulled onto its edge", { got: out.round.chairs, want: out.round.wantChairs });
  checks.ok(near(out.small.surface.w, out.small.w, 1e-6) && near(out.small.surface.h, out.small.h, 1e-6),
    "a small table keeps its drawn size — nothing is grown to a 55 x 45 minimum", out.small);
  checks.ok(near(out.rot.chair[0], out.rot.want[0], 1e-6) && near(out.rot.chair[1], out.rot.want[1], 1e-6),
    "on a ROTATED table the chair is still where it was drawn — the table's rotation is not applied to it twice", out.rot);
  checks.ok(near(out.rot.chairRotation + out.rot.tableRotation, 30, 1e-9), "and its own angle, plus the table's, is the angle it was drawn at", out.rot);
  checks.ok(["x", "y", "w", "h"].every(k2 => near(out.venue[k2], out.venue.want[k2], 1e-6)), "a venue object keeps its drawn place and size", out.venue);

  const before = await page.evaluate(() => state.events[0].tables.map(t => t.id));
  await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "plan"; render(); });
  await page.waitForTimeout(300);
  await addTables(page, { quantity: 1, type: "round" });
  const manual = await page.evaluate((before) => {
    const t = state.events[0].tables.find(x => !before.includes(x.id));
    const node = t && document.querySelector(`[data-object-id="${t.id}"] .table-surface`);
    return { found: !!t, surface: t ? (t.surface || null) : "none", styled: node ? node.hasAttribute("style") : null };
  }, before);
  checks.ok(manual.surface === null && manual.styled === false, "a hand-made table has no surface box and keeps the stylesheet's surface", manual);

  // ---- stored and read back ------------------------------------------------
  await page.evaluate(() => saveState());
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => { try { return state.events.length === 1 && state.events[0].tables.length >= 4; } catch { return false; } }, null, { timeout: 30000 });
  const back = await page.evaluate(() => {
    const e = state.events[0], round = e.tables.find(t => t.type === "round");
    return { surface: round.surface || null, chairs: round.chairs.length };
  });
  checks.ok(back.surface && Number.isFinite(back.surface.w) && back.chairs === 3, "the surface box and the chairs survive save → reload", back);
}
