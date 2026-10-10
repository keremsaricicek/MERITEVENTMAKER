#!/usr/bin/env node
// Ground-truth extraction for the real Golden Plan.
//
// This is an ANNOTATION tool, not a detector. It exists to establish spatial
// truth for the benchmark, and it must never share code or reasoning with
// src/app-v8.js — an annotation produced by the thing under test would score
// that thing against its own opinion. So the rules here are deliberately
// crude, literal and specific to this one drawing: exact ink colours, fixed
// pixel thresholds, no modal reasoning, no adaptive thresholds, no filters
// that "learn" anything from the image.
//
// The output is not trusted because the code ran. It is trusted because
// `--overlay` renders every extracted box back onto the plan and a person
// looked at it. The annotation records that, in annotationMethod, in those
// words.
//
// usage:
//   node benchmarks/annotate/extract-objects.mjs            # print a summary
//   node benchmarks/annotate/extract-objects.mjs --overlay out.png
//   node benchmarks/annotate/extract-objects.mjs --json out.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAN = path.join(HERE, "..", "plans", "merit-real-venue-plan.png");
const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] || true) : null; };

const browser = await launchChromium();
const page = await browser.newPage();
await page.goto("about:blank");
const src = "data:image/png;base64," + fs.readFileSync(PLAN).toString("base64");

const result = await page.evaluate(async src => {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  const W = img.width, H = img.height;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;

  const rgb = i => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];

  // ---- literal ink tests, read off this drawing's own palette -------------
  // Orange upholstery: (240,125,50)-ish. Strongly red-dominant.
  const isOrange = (r, g, b) => r > 150 && r - g > 55 && g - b > 20 && b < 170;
  // Tan table/chair surface: (235,216,180)-ish. Warm, low-contrast, light.
  const isTan = (r, g, b) => r > 190 && g > 170 && b > 110 && r - b > 25 && r - b < 110 && r - g < 45;
  // Steel blue: stage, bar counter, dais.
  const isBlue = (r, g, b) => b > 150 && b - r > 30 && b - g > 20;

  const classify = new Uint8Array(W * H); // 1 orange, 2 tan, 3 blue
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = rgb(i);
    if (isOrange(r, g, b)) classify[i] = 1;
    else if (isTan(r, g, b)) classify[i] = 2;
    else if (isBlue(r, g, b)) classify[i] = 3;
  }

  // ---- connected components on one class ---------------------------------
  function components(want, minPixels) {
    const seen = new Uint8Array(W * H);
    const out = [];
    const stack = new Int32Array(W * H);
    for (let start = 0; start < W * H; start++) {
      if (classify[start] !== want || seen[start]) continue;
      let top = 0; stack[top++] = start; seen[start] = 1;
      let minX = W, minY = H, maxX = 0, maxY = 0, count = 0;
      const pixels = [];
      while (top) {
        const i = stack[--top];
        const x = i % W, y = (i / W) | 0;
        count++;
        pixels.push(i);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (seen[j] || classify[j] !== want) continue;
          seen[j] = 1; stack[top++] = j;
        }
      }
      if (count >= minPixels) {
        out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area: count, pixels });
      }
    }
    return out;
  }

  const orange = components(1, 60);
  const tan = components(2, 80);
  const blue = components(3, 400);

  const shape = c => ({
    x: c.x, y: c.y, w: c.w, h: c.h, area: c.area,
    fill: +(c.area / (c.w * c.h)).toFixed(3),
    aspect: +(Math.max(c.w, c.h) / Math.max(1, Math.min(c.w, c.h))).toFixed(2),
    cx: c.x + c.w / 2, cy: c.y + c.h / 2,
  });

  return {
    size: [W, H],
    orange: orange.map(shape).sort((a, b) => b.area - a.area),
    tan: tan.map(shape).sort((a, b) => b.area - a.area),
    blue: blue.map(shape).sort((a, b) => b.area - a.area),
  };
}, src);

console.log(`plan ${result.size[0]}x${result.size[1]}`);
for (const [name, list] of [["orange", result.orange], ["tan", result.tan], ["blue", result.blue]]) {
  console.log(`\n${name}: ${list.length} components`);
  const buckets = new Map();
  for (const c of list) {
    const key = `${Math.round(c.w / 5) * 5}x${Math.round(c.h / 5) * 5}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  console.log("  size buckets:", [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([k, n]) => `${k}:${n}`).join("  "));
  console.log("  largest:", list.slice(0, 6).map(c => `${c.w}x${c.h}@(${Math.round(c.cx)},${Math.round(c.cy)})`).join(" "));
}

const jsonOut = flag("--json");
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(result, null, 1)); console.log("\nwrote", jsonOut); }

const overlayOut = flag("--overlay");
if (overlayOut) {
  const dataUrl = await page.evaluate(async ({ src, result }) => {
    const img = await createImageBitmap(await (await fetch(src)).blob());
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    x.lineWidth = 1.2;
    const draw = (list, colour) => {
      x.strokeStyle = colour;
      for (const o of list) x.strokeRect(o.x - .5, o.y - .5, o.w + 1, o.h + 1);
    };
    draw(result.tan, "#0066ff");
    draw(result.blue, "#00aa66");
    draw(result.orange, "#ff0000");
    return c.toDataURL("image/png");
  }, { src, result });
  fs.writeFileSync(overlayOut, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote", overlayOut);
}

await browser.close();
