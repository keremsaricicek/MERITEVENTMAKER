// The handcrafted visual descriptor, pinned to numbers worked out by hand.
//
// `MeritVisualEmbedding.providers.handcrafted` turns a candidate's pixels into
// the 14 numbers plan memory and the visual second opinion compare: fill
// ratio, edge density, an 8-bin intensity histogram and a 4-quadrant fill.
// Measured 2026-11-01, before it left app-v8.js: its arithmetic (the fill
// ratio, the histogram bins, the quadrant order, the edge scale, the vector
// layout) and the operator's provider override could each be broken without
// any suite noticing — the suites that use it compare descriptors with each
// other, so a consistent error is invisible to them. This suite fixes the
// answer on images small enough to compute on paper.
import { openApp } from "../lib/app-actions.mjs";

export const meta = { name: "visual-descriptor", tags: ["intelligence", "fast"], timeout: 60000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  const out = await page.evaluate(() => {
    const H = MeritVisualEmbedding.providers.handcrafted;
    // 4×4, the whole image is the candidate. Intensities: the top-left
    // quadrant is 0 and foreground; the top-right is 255; the bottom row of
    // quadrants is 100. Only the top-left 2×2 is foreground.
    const W = 4, Hh = 4, gray = new Uint8Array(16), binary = new Uint8Array(16);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = y * 4 + x;
      gray[i] = y < 2 ? (x < 2 ? 0 : 255) : 100;
      binary[i] = y < 2 && x < 2 ? 1 : 0;
    }
    const whole = { x: 0, y: 0, w: 100, h: 100 };
    const d = H.embed(gray, binary, W, Hh, whole);
    const tooSmall = H.embed(gray, binary, W, Hh, { x: 0, y: 0, w: 10, h: 10 });
    const was = globalThis.MERIT_VISUAL_EMBEDDING_PROVIDER;
    globalThis.MERIT_VISUAL_EMBEDDING_PROVIDER = "handcrafted";
    const forced = MeritVisualEmbedding.resolve().id;
    globalThis.MERIT_VISUAL_EMBEDDING_PROVIDER = was;
    return { d, vector: H.toVector(d), tooSmall, forced, dims: H.dimensions };
  });
  const d = out.d;
  checks.require(d, "a 4×4 candidate gets a descriptor", d);
  // 4 of 16 pixels are foreground.
  checks.equal(d.fillRatio, 0.25, "fill ratio is foreground pixels over all pixels");
  // Bins are 32 intensities wide: 0 → bin 0 (4 px), 100 → bin 3 (8 px), 255 → bin 7 (4 px).
  checks.equal(d.intensityHist, [0.25, 0, 0, 0.5, 0, 0, 0, 0.25], "the 8-bin histogram puts each pixel in intensity/32");
  // Quadrants in reading order: top-left, top-right, bottom-left, bottom-right.
  checks.equal(d.quadrantFill, [1, 0, 0, 0], "quadrant fill is in reading order, top-left first");
  // Only the four interior pixels contribute, each |right-left| + |below-above|:
  // (1,1): |255-0| + |100-0| = 355     (2,1): |255-0| + |100-255| = 410
  // (1,2): |100-100| + |100-0| = 100   (2,2): |100-100| + |100-255| = 155
  // 1020 / (16 × 255) = 0.25
  checks.equal(d.edgeDensity, 0.25, "edge density is the interior gradient sum over pixels × 255");
  checks.equal(out.vector, [0.25, 0.25, 0.25, 0, 0, 0.5, 0, 0, 0, 0.25, 1, 0, 0, 0],
    "the vector is fill, edge, the eight bins, then the four quadrants");
  checks.equal(out.vector.length, out.dims, "and has exactly the dimensions the provider declares");
  checks.equal(out.tooSmall, null, "a candidate under two pixels across has no descriptor rather than a made-up one");
  checks.equal(out.forced, "handcrafted-descriptor-v1", "MERIT_VISUAL_EMBEDDING_PROVIDER chooses the provider when set");
}
