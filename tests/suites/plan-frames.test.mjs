// Where a number on a plan is measured from — MeritPlanFrames.
//
// The frames a plan passes through (PDF page → source image → analysis canvas
// → deskewed canvas → plan percent, and tiles of any of them) each have one
// transform with an exact inverse, and the two box conventions are named:
// a CANDIDATE stores its top-left corner, a SEAT inside it stores its centre.
//
// What this pins, and why each one matters:
//   FORWARD THEN INVERSE RETURNS THE POINT, for every frame — a pipeline that
//     maps a detection to the plan and an operator's region back to the
//     detector must not drift by a pixel each way.
//   THE TWO BOX CONVENTIONS ARE NOT INTERCHANGEABLE: reading a seat as a
//     corner box moves it by half its size (a benchmark did, 2026-10-04).
//   ROTATION IS PRESERVED through a shape-keeping transform, and a transform
//     that would distort a rotated box is REFUSED rather than approximated.
//   PDF user space (y up, page rotation) lands where pdf.js drew it.
//   FRAMES DO NOT GLUE in the wrong order: composing deskew→analysis after
//     source→analysis throws.
import { openApp } from "../lib/app-actions.mjs";

export const meta = { name: "plan-frames", tags: ["intelligence", "fast"], timeout: 60000, viewport: { width: 1200, height: 800 } };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  checks.require(await page.evaluate(() => typeof globalThis.MeritPlanFrames === "object"), "MeritPlanFrames is published");

  const r = await page.evaluate(() => {
    const F = globalThis.MeritPlanFrames;
    const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
    const out = {};

    // ---- round trips --------------------------------------------------------
    const pts = [[0, 0], [17.25, 903.5], [1919, 1], [640.125, 480.75]];
    const deskew = F.deskewFrame(1920, 1080, 2.7);
    out.deskewSize = [deskew.dw, deskew.dh];
    out.deskewRound = pts.every(([x, y]) => {
      const [a, b] = deskew.analysisToDeskew.apply(x, y), [x2, y2] = deskew.deskewToAnalysis.apply(a, b);
      return close(x, x2, 1e-9) && close(y, y2, 1e-9);
    });
    out.deskewMovesPoints = !close(deskew.analysisToDeskew.apply(17.25, 903.5)[0], 17.25, 1e-3);
    const none = F.deskewFrame(1920, 1080, 0);
    out.noDeskewIsIdentity = !none.applied && none.analysisToDeskew.steps.length === 0 && none.dw === 1920;
    // The canvas centre maps to the canvas centre.
    const [ccx, ccy] = deskew.analysisToDeskew.apply(960, 540);
    out.centreToCentre = close(ccx, deskew.dw / 2) && close(ccy, deskew.dh / 2);

    const af = F.analysisFrame(2402, 1719, 1920);
    out.analysis = { ratio: af.ratio, width: af.width, height: af.height, originalWidth: af.originalWidth };
    const small = F.analysisFrame(1355, 788, 1920);
    out.neverUpscaled = small.ratio === 1 && small.width === 1355;
    const [sx, sy] = af.sourceToAnalysis.apply(2402, 1719);
    out.sourceCornerToAnalysisCorner = close(sx, 2402 * af.ratio) && close(sy, 1719 * af.ratio);
    out.analysisRound = pts.every(([x, y]) => { const inv = af.sourceToAnalysis.inverse(); const [a, b] = inv.apply(...af.sourceToAnalysis.apply(x, y)); return close(a, x, 1e-9) && close(b, y, 1e-9); });

    // A tile read at 2x, 512 px in from the left: its pixel (0,0) is frame (512, 300).
    const tile = F.tileFrame("source", 512, 300, 2);
    out.tileOrigin = tile.apply(0, 0);
    out.tileFar = tile.apply(200, 100);
    out.tileRound = pts.every(([x, y]) => { const [a, b] = tile.inverse().apply(x, y); const [c, d] = tile.apply(a, b); return close(c, x, 1e-9) && close(d, y, 1e-9); });

    // ---- PDF user space ---------------------------------------------------------
    // A 595x842 portrait page drawn by pdf.js at scale 2: transform [2,0,0,-2,0,1684]
    // (y flipped). Rotated 90: [0,2,2,0,0,0].
    const portrait = F.pdfToSource([2, 0, 0, -2, 0, 1684]);
    out.pdfOrigin = portrait.apply(0, 0);          // bottom-left of the page -> bottom-left of the raster
    out.pdfTopLeft = portrait.apply(0, 842);       // top-left -> (0,0)
    const rotated = F.pdfToSource([0, 2, 2, 0, 0, 0]);
    out.pdfRotated = rotated.apply(100, 50);
    out.pdfRound = pts.every(([x, y]) => { const [a, b] = portrait.inverse().apply(...portrait.apply(x, y)); return close(a, x, 1e-9) && close(b, y, 1e-9); });
    out.pdfLinear = portrait.linear();

    // ---- composition checks its frames ------------------------------------------
    try { F.compose(af.sourceToAnalysis, deskew.deskewToAnalysis); out.badCompose = "accepted"; }
    catch (e) { out.badCompose = "refused"; }
    const chain = F.compose(af.sourceToAnalysis, deskew.analysisToDeskew);
    out.chainFrames = [chain.from, chain.to];

    // ---- the two box conventions ------------------------------------------------
    const W = 1000, H = 500;
    const corner = { x: 10, y: 20, w: 4, h: 8, rotation: 0 };
    const centre = { x: 10, y: 20, w: 4, h: 8, rotation: 0 };
    out.cornerPx = F.percentToPixels(corner, F.CORNER, W, H);
    out.centrePx = F.percentToPixels(centre, F.CENTRE, W, H);
    out.cornerRound = F.pixelsToPercent(out.cornerPx, F.CORNER, W, H);
    out.centreRound = F.pixelsToPercent(out.centrePx, F.CENTRE, W, H);

    // ---- mapBox through a deskew and back: same box -----------------------------
    const box = { x: 30.5, y: 40.25, w: 3.2, h: 5.1, rotation: 12 };
    const seat = { x: 31.1, y: 39.0, w: 1.1, h: 1.6, rotation: 300 };
    const b1 = F.mapBox({ ...box }, F.CORNER, deskew.analysisToDeskew, 1920, 1080, deskew.dw, deskew.dh, -2.7);
    const b2 = F.mapBox({ ...b1 }, F.CORNER, deskew.deskewToAnalysis, deskew.dw, deskew.dh, 1920, 1080, 2.7);
    out.boxRound = ["x", "y", "w", "h", "rotation"].every(k => close(b2[k], box[k], 1e-9));
    const s1 = F.mapBox({ ...seat }, F.CENTRE, deskew.analysisToDeskew, 1920, 1080, deskew.dw, deskew.dh, -2.7);
    const s2 = F.mapBox({ ...s1 }, F.CENTRE, deskew.deskewToAnalysis, deskew.dw, deskew.dh, 1920, 1080, 2.7);
    out.seatRound = ["x", "y", "w", "h"].every(k => close(s2[k], seat[k], 1e-9)) && close(s2.rotation, seat.rotation, 1e-9);
    // Reading a seat with the corner rule lands half a seat away.
    const wrong = F.percentToPixels(seat, F.CORNER, 1920, 1080), right = F.percentToPixels(seat, F.CENTRE, 1920, 1080);
    out.conventionGap = [wrong.cx - right.cx, wrong.cy - right.cy];

    // ---- rotation preserved, distortion refused ---------------------------------
    const turn = F.transform("a", "b", [F.step.rotateAbout(Math.PI / 6, 0, 0)]);
    out.rotated = F.mapPixelBox({ cx: 10, cy: 0, w: 20, h: 10, rotation: 15 }, turn);
    const stretch = F.transform("a", "b", [F.step.scale(2, 1)]);
    try { F.mapPixelBox({ cx: 0, cy: 0, w: 4, h: 2, rotation: 30 }, stretch); out.stretchRotated = "accepted"; }
    catch { out.stretchRotated = "refused"; }
    out.stretchAxis = F.mapPixelBox({ cx: 1, cy: 1, w: 4, h: 2, rotation: 0 }, stretch);
    const shear = F.transform("a", "b", [F.step.matrix(1, 0, 0.5, 1, 0, 0)]);
    try { F.mapPixelBox({ cx: 0, cy: 0, w: 4, h: 2, rotation: 0 }, shear); out.shear = "accepted"; }
    catch { out.shear = "refused"; }
    out.cornersOfSquare = F.corners({ cx: 0, cy: 0, w: 2, h: 2, rotation: 90 }).map(p => p.map(v => Math.round(v * 1e9) / 1e9));
    return out;
  });

  checks.ok(r.deskewRound, "deskew: analysis → deskew → analysis returns every point (1e-9)");
  checks.ok(r.deskewMovesPoints, "and the deskew actually moves an off-centre point");
  checks.ok(r.noDeskewIsIdentity, "a deskew of 0 is the identity in both directions");
  checks.ok(r.centreToCentre, "the analysis canvas centre lands on the deskew canvas centre");
  checks.ok(r.deskewSize[0] > 1920 && r.deskewSize[1] > 1080, "the deskew canvas grows to hold the rotated plan", r.deskewSize);
  checks.equal(r.analysis.width, 1920, "a 2402 px plan is read at 1920 px (the cap)");
  checks.equal(r.analysis.originalWidth, 2402, "and the original width is recovered from the ratio");
  checks.ok(r.neverUpscaled, "a plan smaller than the cap is never upscaled");
  checks.ok(r.sourceCornerToAnalysisCorner && r.analysisRound, "source ↔ analysis is a scale with an exact inverse");
  checks.equal(JSON.stringify(r.tileOrigin), JSON.stringify([512, 300]), "a tile's (0,0) is its offset in the frame");
  checks.equal(JSON.stringify(r.tileFar), JSON.stringify([612, 350]), "and a tile read at 2x halves distances back into the frame");
  checks.ok(r.tileRound, "tile ↔ frame round trip");
  checks.equal(JSON.stringify(r.pdfOrigin), JSON.stringify([0, 1684]), "PDF (0,0) — the page's bottom-left — is the raster's bottom-left");
  checks.equal(JSON.stringify(r.pdfTopLeft), JSON.stringify([0, 0]), "PDF top-left is raster (0,0): the y axis is flipped");
  checks.equal(JSON.stringify(r.pdfRotated), JSON.stringify([100, 200]), "a rotated page's transform is applied as given, not assumed");
  checks.ok(r.pdfRound, "PDF ↔ source round trip");
  checks.ok(r.pdfLinear.mirrored && r.pdfLinear.uniform && !r.pdfLinear.sheared, "the PDF y flip is reported as a mirror with uniform scale", r.pdfLinear);
  checks.equal(r.badCompose, "refused", "composing frames out of order (source→analysis then deskew→analysis) is refused");
  checks.equal(JSON.stringify(r.chainFrames), JSON.stringify(["source", "deskew"]), "a valid chain names both ends");
  checks.ok(Math.abs(r.cornerPx.cx - 120) < 1e-9 && Math.abs(r.cornerPx.cy - 120) < 1e-9, "a CORNER box's centre is x + w/2", r.cornerPx);
  checks.ok(Math.abs(r.centrePx.cx - 100) < 1e-9 && Math.abs(r.centrePx.cy - 100) < 1e-9, "a CENTRE box's centre is x itself", r.centrePx);
  checks.ok(Math.abs(r.cornerRound.x - 10) < 1e-9 && Math.abs(r.centreRound.x - 10) < 1e-9, "each convention round-trips through pixels");
  checks.ok(r.boxRound, "a rotated candidate box survives deskew and back (position, size, angle)");
  checks.ok(r.seatRound, "and so does a seat, in its own convention");
  checks.ok(Math.abs(r.conventionGap[0] - 1.1 / 200 * 1920) < 1e-9, "reading a seat with the corner rule moves it by half its width", r.conventionGap);
  checks.ok(Math.abs(r.rotated.rotation - 45) < 1e-9 && Math.abs(r.rotated.w - 20) < 1e-9, "a 30° frame rotation adds 30° to a box and keeps its size", r.rotated);
  checks.equal(r.stretchRotated, "refused", "a non-uniform scale is REFUSED for a rotated box rather than approximated");
  checks.ok(Math.abs(r.stretchAxis.w - 8) < 1e-9 && Math.abs(r.stretchAxis.h - 2) < 1e-9, "but applied exactly to an axis-aligned one", r.stretchAxis);
  checks.equal(r.shear, "refused", "a shear is refused: map corners instead");
  checks.equal(r.cornersOfSquare.length, 4, "corners() gives the four corners of an oriented box");
}
