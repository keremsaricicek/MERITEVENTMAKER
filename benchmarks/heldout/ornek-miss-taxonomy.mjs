// Why did each of ORNEK's missed tables fail?
//
//   node benchmarks/heldout/ornek-miss-taxonomy.mjs
//
// 34 of 166 tables are not found. Treating that as one problem would produce
// one blunt fix; they are not one problem. This measures, for every annotated
// table, the image properties the detector actually reasons about, and then
// reports found-vs-missed as DISTRIBUTIONS rather than as a count.
//
// Nothing here is a fix and nothing here is tuned. It exists so that any rule
// proposed afterwards has a measured separation behind it, and so that a rule
// with no separation can be rejected before it is written.
//
// Measured per table, at the annotation's own centre and radius:
//
//   paper       local maximum grey around it — the paper level THERE. A fold
//               or a camera shadow shows up as this dropping, which is how the
//               band is identified without drawing a box round it by eye.
//   interior    mean grey inside 0.6r
//   contrast    paper - interior. How far the disc stands off its own paper.
//               This is the quantity a light-disc detector thresholds on.
//   rimStep     mean(dark just inside the edge) - mean(dark just outside).
//               Positive for a disc darker than its surround. Its SIGN is the
//               polarity: a light-fill/dark-rim table and a solid dark table
//               are opposite in a way no single threshold spans.
//   ink         fraction of the disc's own area that clears the local paper
//               by the detector's own ink threshold
//   crowding    distance to the nearest other annotated table, in radii
import { launchChromium } from "../../tests/lib/env.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(path.dirname(here));
const gt = JSON.parse(fs.readFileSync(path.join(repo, "benchmarks/annotations/ornek-symbolic.json"), "utf8"));
const reportPath = path.join(repo, "benchmarks/reports/latest.json");
const rep = JSON.parse(fs.readFileSync(reportPath, "utf8")).reports.find((r) => r.planId === "ornek-symbolic");
if (!rep) throw new Error("run `node benchmarks/run-benchmark.mjs` first — no ornek-symbolic report");
const missed = new Set(rep.tables.missedIds || []);

const img = fs.readFileSync(path.join(repo, "benchmarks/plans/ornek-upright.png"));
const dataUrl = `data:image/png;base64,${img.toString("base64")}`;

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const rows = await page.evaluate(async ({ dataUrl, objects }) => {
  const im = new Image();
  await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = dataUrl; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  const gray = new Float32Array(W * H);
  for (let i = 0, p = 0; i < px.length; i += 4, p++)
    gray[p] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];

  // local paper level: sliding-window maximum, the same estimate the
  // independent finder used, because paper is the brightest thing nearby
  const line = new Float32Array(Math.max(W, H));
  const dq = new Int32Array(Math.max(W, H));
  const maxAxis = (n, get, set, R) => {
    for (let i = 0; i < n; i++) line[i] = get(i);
    let head = 0, tail = 0;
    for (let i = 0; i < n + R; i++) {
      if (i < n) { while (tail > head && line[dq[tail - 1]] <= line[i]) tail--; dq[tail++] = i; }
      const o = i - R;
      if (o >= 0) { while (dq[head] < o - R) head++; set(o, line[dq[head]]); }
    }
  };
  const paper = new Float32Array(W * H), tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) maxAxis(W, (x) => gray[y * W + x], (x, v) => { tmp[y * W + x] = v; }, 60);
  for (let x = 0; x < W; x++) maxAxis(H, (y) => tmp[y * W + x], (y, v) => { paper[y * W + x] = v; }, 60);
  const dark = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dark[i] = paper[i] - gray[i];

  const at = (x, y, a) => (x < 0 || y < 0 || x >= W || y >= H ? null : a[y * H * 0 + y * W + x]);
  const INK = 10;
  return objects.map((o) => {
    const r = o.w / 2;
    let inSum = 0, inN = 0, inInk = 0, paperSum = 0;
    const ir = Math.round(r * 0.6);
    for (let dy = -ir; dy <= ir; dy++) for (let dx = -ir; dx <= ir; dx++) {
      if (dx * dx + dy * dy > ir * ir) continue;
      const yy = Math.round(o.cy) + dy, xx = Math.round(o.cx) + dx;
      if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
      const p = yy * W + xx;
      inSum += gray[p]; paperSum += paper[p]; inN++;
      if (dark[p] >= INK) inInk++;
    }
    // rim step, sampled all the way round
    let stepSum = 0, stepN = 0;
    for (let i = 0; i < 48; i++) {
      const a = (2 * Math.PI * i) / 48, ux = Math.cos(a), uy = Math.sin(a);
      const xi = Math.round(o.cx + ux * r * 0.8), yi = Math.round(o.cy + uy * r * 0.8);
      const xo = Math.round(o.cx + ux * r * 1.35), yo = Math.round(o.cy + uy * r * 1.35);
      if (xi < 0 || xi >= W || yi < 0 || yi >= H || xo < 0 || xo >= W || yo < 0 || yo >= H) continue;
      stepSum += dark[yi * W + xi] - dark[yo * W + xo]; stepN++;
    }
    const interior = inSum / Math.max(1, inN);
    const paperHere = paperSum / Math.max(1, inN);
    return {
      id: o.id, number: o.number, state: o.state, row: o.row,
      cx: o.cx, cy: o.cy,
      paper: +paperHere.toFixed(1),
      interior: +interior.toFixed(1),
      contrast: +(paperHere - interior).toFixed(1),
      rimStep: +(stepSum / Math.max(1, stepN)).toFixed(1),
      ink: +(inInk / Math.max(1, inN)).toFixed(3),
    };
  });
}, { dataUrl, objects: gt.objects });
await browser.close();

// crowding, from the annotation alone
for (const r of rows) {
  let best = Infinity;
  for (const o of rows) if (o !== r) best = Math.min(best, Math.hypot(o.cx - r.cx, o.cy - r.cy));
  r.crowding = +(best / 39).toFixed(2);
  r.found = !missed.has(r.id);
}

const q = (arr, f) => {
  const s = arr.slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : null;
};
const dist = (label, vals) =>
  `${label.padEnd(10)} n=${String(vals.length).padStart(3)}  min ${String(q(vals, 0)).padStart(7)}  p10 ${String(q(vals, 0.1)).padStart(7)}  med ${String(q(vals, 0.5)).padStart(7)}  p90 ${String(q(vals, 0.9)).padStart(7)}  max ${String(q(vals, 1)).padStart(7)}`;

const found = rows.filter((r) => r.found), miss = rows.filter((r) => !r.found);
console.log(`ORNEK miss taxonomy — ${found.length} found, ${miss.length} missed, of ${rows.length}\n`);
for (const field of ["contrast", "rimStep", "ink", "paper", "interior", "crowding"]) {
  console.log(`--- ${field}`);
  console.log("  " + dist("FOUND", found.map((r) => r[field])));
  console.log("  " + dist("MISSED", miss.map((r) => r[field])));
}

// ---- the taxonomy itself -------------------------------------------------
// Each rule is a statement about the pixels, applied in order, so every miss
// lands in exactly one group and the groups are countable.
const PAPER_SHADOW = 235;   // below this, the local paper is not white paper
const FAINT = 14;           // a disc this close to its paper is barely printed
function classify(r) {
  if (r.state === "filled") return "A dark-filled (tonal inverse)";
  if (r.contrast < FAINT) return "B faint print (low contrast to its own paper)";
  if (r.paper < PAPER_SHADOW) return "C inside the fold / shadow band";
  return "D other";
}
const groups = {};
for (const r of miss) (groups[classify(r)] ||= []).push(r);
console.log("\n=== TAXONOMY OF THE MISSES ===");
for (const k of Object.keys(groups).sort()) {
  const g = groups[k];
  console.log(`\n${k}: ${g.length}`);
  console.log(`  numbers  ${g.map((r) => r.number ?? "dark").join(", ")}`);
  console.log(`  contrast ${dist("", g.map((r) => r.contrast)).trim()}`);
  console.log(`  rimStep  ${dist("", g.map((r) => r.rimStep)).trim()}`);
  console.log(`  paper    ${dist("", g.map((r) => r.paper)).trim()}`);
}
// And the same rules over the tables that WERE found, so the groups can be
// checked for whether they describe the misses or just describe the plan.
const foundGroups = {};
for (const r of found) (foundGroups[classify(r)] ||= []).push(r);
console.log("\n=== the same rules over the 132 FOUND tables ===");
for (const k of Object.keys(foundGroups).sort())
  console.log(`  ${k}: ${foundGroups[k].length}`);

fs.writeFileSync(path.join(here, "ornek-miss-taxonomy.json"),
  JSON.stringify({ ranAt: new Date().toISOString(), rows, thresholds: { PAPER_SHADOW, FAINT } }, null, 1) + "\n");
console.log("\nwrote benchmarks/heldout/ornek-miss-taxonomy.json");
