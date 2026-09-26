// An INDEPENDENT circle and structure finder for the ORNEK plan, used ONLY to
// PROPOSE ground truth for a human to review.
//
//   node benchmarks/annotate/ornek-circle-finder.mjs <image> <out.json>
//
// It deliberately shares no code and no reasoning with the detector under
// test. If the product's own detector proposed the ground truth, the
// benchmark would be measuring the detector against itself and every number
// in it would be meaningless. Its only job is to save a human from clicking
// 166 circles by hand; every proposal it makes was then checked by eye
// against the real pixels, and the checked version is what benchmarks/
// annotations/ornek-symbolic.json froze. Running this again reproduces the
// PROPOSALS, not the annotation — see that file's annotationMethod.
//
// Four earlier versions, each of which measured something rather than
// assuming it. They are recorded because each failure says something true
// about this document:
//
//   v1  disc-shaped connected components. Near-touching circles fuse and the
//       aspect/fill test discards the pair: 70 of 166.
//   v2  a dark-RING matched filter. A vertical scan through a real circle
//       reads interior ~230, rim ~180-190, paper 255: the rim is not
//       separable from the interior, so the ring fired inside the disc too.
//   v3  distance transform against a local MEAN background. The mean window
//       is mostly filled by the discs themselves, so the background sank to
//       the discs own tone, the mask fragmented, and the distance field
//       peaked in the fragments: 103, many off-centre.
//   v4  the same, with background = local MAXIMUM (paper is the brightest
//       thing in any neighbourhood). Centres and radii became correct, with a
//       clean mode at r~39 - but a faint row whose tint is only ~6 grey
//       levels stayed invisible, and the photograph's fold was dark enough to
//       threshold as ink and invent circles.
//   v5  a whole-DISC matched filter (mean darkness inside minus mean darkness
//       in the surrounding ring). It sees the faint row and cancels the fold,
//       but on a uniform disc every test radius scores the same, so its radius
//       estimate is a tie broken arbitrarily.
//
// So the two work as a pair, and that is what this is: v4 locates and sizes,
// v5 confirms. A distance peak with no matched-filter support is fold or
// text; a matched-filter response with no distance peak is a disc too faint
// to threshold, and is kept at the modal radius the plan itself supplies.
//
// The structure pass finds the large non-circular ink - the "servant" bars,
// the wall pillars, the filled tables - by the same local-paper contrast,
// followed by a morphological opening. Without the opening every solid object
// is welded to every other one by the room outline and the box borders, and
// the whole plan comes back as a single component.
import { launchChromium } from "../../tests/lib/env.mjs";
import fs from "node:fs";

const [src, out] = process.argv.slice(2);
const mime = src.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/png";
const dataUrl = `data:${mime};base64,${fs.readFileSync(src).toString("base64")}`;

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on("console", (m) => console.log("  [page]", m.text()));

const found = await page.evaluate(async ({ dataUrl }) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  const gray = new Float32Array(W * H);
  for (let i = 0, p = 0; i < px.length; i += 4, p++)
    gray[p] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];

  // ---- local paper level: sliding-window maximum, monotonic deque, O(n) ----
  const line = new Float32Array(Math.max(W, H));
  const dq = new Int32Array(Math.max(W, H));
  const maxAxis = (n, get, set, R) => {
    for (let i = 0; i < n; i++) line[i] = get(i);
    let head = 0, tail = 0;
    for (let i = 0; i < n + R; i++) {
      if (i < n) {
        while (tail > head && line[dq[tail - 1]] <= line[i]) tail--;
        dq[tail++] = i;
      }
      const o = i - R;
      if (o >= 0) { while (dq[head] < o - R) head++; set(o, line[dq[head]]); }
    }
  };
  const paper = new Float32Array(W * H), tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) maxAxis(W, (x) => gray[y * W + x], (x, v) => { tmp[y * W + x] = v; }, 60);
  for (let x = 0; x < W; x++) maxAxis(H, (y) => tmp[y * W + x], (y, v) => { paper[y * W + x] = v; }, 60);
  const dark = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dark[i] = paper[i] - gray[i];

  const sat = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += dark[y * W + x];
      sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row;
    }
  }
  const box = (x, y, h) => {
    const x0 = Math.max(0, x - h), y0 = Math.max(0, y - h);
    const x1 = Math.min(W, x + h + 1), y1 = Math.min(H, y + h + 1);
    return {
      s: sat[y1 * (W + 1) + x1] - sat[y0 * (W + 1) + x1] - sat[y1 * (W + 1) + x0] + sat[y0 * (W + 1) + x0],
      n: (x1 - x0) * (y1 - y0),
    };
  };
  // matched filter: how much darker the disc is than the paper ring around it
  const discScore = (x, y, R) => {
    const hi = Math.max(1, Math.round(0.86 * R * 0.7071));
    const hIn = Math.round(1.18 * R), hOut = Math.round(1.62 * R);
    const a = box(x, y, hi), bIn = box(x, y, hIn), bOut = box(x, y, hOut);
    const ringN = bOut.n - bIn.n;
    if (ringN <= 0) return 0;
    return a.s / a.n - (bOut.s - bIn.s) / ringN;
  };

  // ---- stage 1: distance-transform peaks (accurate centre AND radius) ----
  const INK = 10;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const b = box(x, y, 3);
    if (b.s / b.n >= INK) mask[y * W + x] = 1;
  }
  const INF = 1e12;
  const f = new Float64Array(Math.max(W, H));
  const dsq = new Float64Array(W * H);
  const vv = new Int32Array(Math.max(W, H));
  const zz = new Float64Array(Math.max(W, H) + 1);
  const dt1d = (n, get, set) => {
    for (let i = 0; i < n; i++) f[i] = get(i);
    let k = 0; vv[0] = 0; zz[0] = -INF; zz[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[vv[k]] + vv[k] * vv[k])) / (2 * q - 2 * vv[k]);
      while (s <= zz[k]) { k--; s = ((f[q] + q * q) - (f[vv[k]] + vv[k] * vv[k])) / (2 * q - 2 * vv[k]); }
      k++; vv[k] = q; zz[k] = s; zz[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (zz[k + 1] < q) k++; set(q, (q - vv[k]) * (q - vv[k]) + f[vv[k]]); }
  };
  for (let y = 0; y < H; y++) dt1d(W, (x) => (mask[y * W + x] ? INF : 0), (x, d) => { dsq[y * W + x] = d; });
  const colBuf = new Float64Array(H);
  for (let x = 0; x < W; x++) {
    dt1d(H, (y) => dsq[y * W + x], (y, d) => { colBuf[y] = d; });
    for (let y = 0; y < H; y++) dsq[y * W + x] = colBuf[y];
  }
  const dist = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = Math.sqrt(dsq[i]);

  const MINR = 22, MAXR = 52;
  const peaks = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x, d = dist[p];
    if (d < MINR || d > MAXR) continue;
    const win = Math.max(2, Math.round(d * 0.55));
    let isPeak = true;
    for (let dy = -win; dy <= win && isPeak; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -win; dx <= win; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= W) continue;
        const o = dist[yy * W + xx];
        if (o > d || (o === d && (yy < y || (yy === y && xx < x)))) { isPeak = false; break; }
      }
    }
    if (isPeak) peaks.push({ x, y, r: d, from: "distance" });
  }

  // The plan tells us its own table size: the mode of the peak radii.
  const rh = new Map();
  for (const p of peaks) { const k = Math.round(p.r); rh.set(k, (rh.get(k) || 0) + 1); }
  let modalR = 38, best = 0;
  for (const [k, n] of rh) {
    // count a window of +-2 so a spread mode is not beaten by a spike
    let s = 0;
    for (let d = -2; d <= 2; d++) s += rh.get(k + d) || 0;
    if (s > best) { best = s; modalR = k; }
  }

  // ---- stage 2: matched-filter sweep at the plan's own table size ----
  const STEP = 2, m = Math.round(1.62 * modalR) + 2;
  const mf = [];
  for (let y = m; y < H - m; y += STEP) for (let x = m; x < W - m; x += STEP) {
    const s = discScore(x, y, modalR);
    if (s >= 4) mf.push({ x, y, s, r: modalR, from: "matched" });
  }
  mf.sort((a, b) => b.s - a.s);

  // ---- fuse: distance peaks first (they carry the real radius), then any
  // matched-filter response far enough from all of them to be a new object.
  for (const p of peaks) p.s = discScore(p.x, p.y, p.r);
  const scored = peaks.filter((p) => p.s >= 4).sort((a, b) => b.s - a.s);
  const kept = [];
  const cell = 2 * MAXR;
  const grid = new Map();
  const key = (gx, gy) => gx * 100000 + gy;
  const place = (cd, factor) => {
    const gx = Math.floor(cd.x / cell), gy = Math.floor(cd.y / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
      for (const o of grid.get(key(gx + a, gy + b)) || [])
        if (Math.hypot(cd.x - o.x, cd.y - o.y) < factor * (cd.r + o.r)) return false;
    kept.push(cd);
    const kk = key(gx, gy);
    if (!grid.has(kk)) grid.set(kk, []);
    grid.get(kk).push(cd);
    return true;
  };
  for (const p of scored) place(p, 0.75);
  const addedByMatched = mf.filter((p) => place(p, 0.85)).length;

  // ---- describe each survivor so a human can triage before looking ----
  const circles = kept.map((cd) => {
    let inSum = 0, inN = 0;
    const ir = Math.max(1, Math.round(cd.r * 0.55));
    for (let dy = -ir; dy <= ir; dy++) for (let dx = -ir; dx <= ir; dx++) {
      if (dx * dx + dy * dy > ir * ir) continue;
      const yy = cd.y + dy, xx = cd.x + dx;
      if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
      inSum += gray[yy * W + xx]; inN++;
    }
    const insideGray = inSum / Math.max(1, inN);
    // rim step: an honest disc is darker just inside its edge than just outside,
    // all the way round.
    let edgeHits = 0, edgeN = 0;
    for (let i = 0; i < 48; i++) {
      const a = (2 * Math.PI * i) / 48, ux = Math.cos(a), uy = Math.sin(a);
      const xi = Math.round(cd.x + ux * cd.r * 0.8), yi = Math.round(cd.y + uy * cd.r * 0.8);
      const xo = Math.round(cd.x + ux * cd.r * 1.3), yo = Math.round(cd.y + uy * cd.r * 1.3);
      if (xi < 0 || xi >= W || yi < 0 || yi >= H || xo < 0 || xo >= W || yo < 0 || yo >= H) continue;
      edgeN++;
      if (dark[yi * W + xi] - dark[yo * W + xo] > 2) edgeHits++;
    }
    return {
      cx: cd.x, cy: cd.y, r: +cd.r.toFixed(1),
      score: +cd.s.toFixed(2),
      edge: +(edgeHits / Math.max(1, edgeN)).toFixed(3),
      insideGray: Math.round(insideGray),
      from: cd.from,
    };
  });
  circles.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  return { W, H, modalR, circles, distancePeaks: peaks.length, addedByMatched };
}, { dataUrl });

fs.writeFileSync(out, JSON.stringify(found, null, 1) + "\n");
const cs = found.circles;
console.log(`${found.W}x${found.H}  modal table radius ${found.modalR}`);
console.log(`${found.distancePeaks} distance peaks -> ${cs.length} kept (${found.addedByMatched} of them seen only by the matched filter)`);
const show = (name, arr) => {
  const s = arr.slice().sort((a, b) => a - b);
  const q = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
  if (s.length) console.log(`${name}  min ${s[0]}  p10 ${q(0.1)}  median ${q(0.5)}  p90 ${q(0.9)}  max ${s[s.length - 1]}`);
};
show("radius     ", cs.map((c) => c.r));
show("score      ", cs.map((c) => c.score));
show("edge       ", cs.map((c) => c.edge));
show("insideGray ", cs.map((c) => c.insideGray));
await browser.close();
