// The handcrafted descriptor, ported to operate on a corpus crop.
//
// `handcrafted-descriptor-v1` in src/app-v8.js computes fill ratio, edge
// density, an 8-bin intensity histogram and a 4-quadrant fill signature from
// the decoded plan pixels, using detection's global binary mask for the
// foreground test. This port computes the same fourteen numbers from a 32x32
// crop, thresholding it with Otsu instead of borrowing detection's mask.
//
// That substitution is the point: the learned encoder sees exactly these
// pixels and nothing else, so the comparison is between two representations of
// the same input rather than between two pipelines. Otsu on the crop is if
// anything the more generous choice for the descriptor — it is a threshold
// fitted to the object being described.
export const DIMS = 14;

export function otsu(pixels) {
  const hist = new Array(256).fill(0);
  for (const v of pixels) hist[v]++;
  const total = pixels.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

export function describe(pixels, side) {
  const thr = otsu(pixels);
  // Ink is darker than paper on every plan in this corpus; the mask is
  // "darker than the crop's own threshold", which is what detection's binary
  // mask means too.
  const fg = i => (pixels[i] <= thr ? 1 : 0);
  let filled = 0;
  const hist = new Array(8).fill(0);
  const quadFg = [0, 0, 0, 0], quadTotal = [0, 0, 0, 0];
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const i = y * side + x;
    const on = fg(i);
    filled += on;
    hist[Math.min(7, pixels[i] >> 5)]++;
    const q = (y < side / 2 ? 0 : 2) + (x < side / 2 ? 0 : 1);
    quadTotal[q]++; quadFg[q] += on;
  }
  // Sobel magnitude, averaged — the same texture/outline signal, on the crop.
  let edge = 0, edgeN = 0;
  for (let y = 1; y < side - 1; y++) for (let x = 1; x < side - 1; x++) {
    const at = (dx, dy) => pixels[(y + dy) * side + (x + dx)];
    const gx = -at(-1, -1) - 2 * at(-1, 0) - at(-1, 1) + at(1, -1) + 2 * at(1, 0) + at(1, 1);
    const gy = -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1);
    edge += Math.hypot(gx, gy); edgeN++;
  }
  const total = side * side;
  return [
    filled / total,
    edgeN ? edge / edgeN / 1020 : 0,
    ...hist.map(h => h / total),
    ...quadFg.map((v, i) => (quadTotal[i] ? v / quadTotal[i] : 0)),
  ];
}
