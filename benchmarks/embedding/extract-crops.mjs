// Build the crop corpus every embedding measurement runs on.
//
//   node benchmarks/embedding/extract-crops.mjs
//
// Writes crops.bin (raw uint8, 32x32 grayscale, one crop after another) and
// crops.json (the index: which plan, which rendering, which annotated object,
// what class and type). Both are derived data and are not committed — this
// script is the reproducible part.
//
// Every crop comes from an ANNOTATED ground-truth box on a real image. Nothing
// here is synthetic and nothing is jittered: the "same object seen differently"
// pairs are the same drawing genuinely re-rendered by
// benchmarks/robustness/make-variants.mjs (blurred, rescaled, recoloured, JPEG
// compressed, rotated), which is a far more honest invariance signal than
// augmentation applied to a crop after the fact.
//
// `plan` is the BASE plan, so all sixteen renderings of the Golden Plan carry
// the same value. Every split downstream groups by it, because a venue that
// appears on both sides of a split makes the number meaningless.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE);
const ROOT = path.dirname(BENCH);

export const CROP = 32;            // the encoder's input, and the descriptor's basis
export const CROP_MARGIN = 0.15;   // a little context: a chair is defined partly by what it sits against

// Every annotated image in the project, base plans and re-renderings alike.
function corpusImages() {
  const out = [];
  for (const f of fs.readdirSync(path.join(BENCH, "annotations")).sort()) {
    if (!f.endsWith(".json")) continue;
    const annot = JSON.parse(fs.readFileSync(path.join(BENCH, "annotations", f), "utf8"));
    out.push({ plan: annot.planId, variant: "ORIGINAL", annot,
               file: path.join(BENCH, annot.source.file) });
  }
  const rdir = path.join(BENCH, "robustness", "annotations");
  if (fs.existsSync(rdir)) {
    for (const f of fs.readdirSync(rdir).sort()) {
      if (!f.endsWith(".json")) continue;
      const annot = JSON.parse(fs.readFileSync(path.join(rdir, f), "utf8"));
      out.push({ plan: annot.derivedFrom || annot.planId,
                 variant: (annot.transform && annot.transform.id) || f.replace(/\.json$/, ""),
                 annot, file: path.join(BENCH, annot.source.file) });
    }
  }
  return out.filter(i => fs.existsSync(i.file));
}

async function cropsFor(page, imagePath, objects, W, H) {
  const b64 = fs.readFileSync(imagePath).toString("base64");
  const ext = path.extname(imagePath).toLowerCase() === ".jpg" ? "jpeg" : "png";
  return page.evaluate(async ([src, objs, side, margin]) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const lum = (x, y) => {
      const xi = Math.min(c.width - 1, Math.max(0, Math.round(x)));
      const yi = Math.min(c.height - 1, Math.max(0, Math.round(y)));
      const i = (yi * c.width + xi) * 4;
      return (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    };
    // Box-average downsample: a chair is a handful of pixels on a downscaled
    // plan, and point sampling would throw most of it away.
    return objs.map(o => {
      const w = o.w * (1 + margin * 2), h = o.h * (1 + margin * 2);
      const x0 = o.cx - w / 2, y0 = o.cy - h / 2;
      const out = new Array(side * side);
      const sx = w / side, sy = h / side;
      for (let r = 0; r < side; r++) for (let q = 0; q < side; q++) {
        const steps = Math.max(1, Math.min(4, Math.round(Math.min(sx, sy))));
        let sum = 0, n = 0;
        for (let dy = 0; dy < steps; dy++) for (let dx = 0; dx < steps; dx++) {
          sum += lum(x0 + (q + (dx + 0.5) / steps) * sx, y0 + (r + (dy + 0.5) / steps) * sy);
          n++;
        }
        out[r * side + q] = Math.round(sum / n);
      }
      return out;
    });
  }, [`data:image/${ext};base64,${b64}`, objects, CROP, CROP_MARGIN]);
}

async function main() {
  const images = corpusImages();
  if (!images.length) { console.error("No annotated images found."); process.exit(2); }
  const app = await serveApp();
  const browser = await launchChromium();
  const page = await browser.newPage();
  await page.goto(`${app.baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");

  const index = [];
  const buffers = [];
  for (const img of images) {
    const objs = (img.annot.objects || []).filter(o => Number.isFinite(o.cx) && o.w > 0 && o.h > 0);
    if (!objs.length) continue;
    const crops = await cropsFor(page, img.file, objs.map(o => ({ cx: o.cx, cy: o.cy, w: o.w, h: o.h })),
      img.annot.source.width, img.annot.source.height);
    crops.forEach((pixels, i) => {
      const o = objs[i];
      buffers.push(Uint8Array.from(pixels));
      index.push({ plan: img.plan, variant: img.variant, objectId: o.id,
                   cls: o.class, type: o.type || null,
                   side: Math.round(Math.sqrt(o.w * o.h)) });
    });
    console.log(`  ${img.plan.padEnd(28)} ${img.variant.padEnd(18)} ${crops.length} crops`);
  }
  await browser.close();
  await app.close();

  const bin = Buffer.concat(buffers.map(b => Buffer.from(b.buffer, b.byteOffset, b.byteLength)));
  fs.writeFileSync(path.join(HERE, "crops.bin"), bin);
  fs.writeFileSync(path.join(HERE, "crops.json"), JSON.stringify({
    builtAt: new Date().toISOString(),
    side: CROP, margin: CROP_MARGIN, count: index.length,
    note: "Grayscale crops of annotated ground-truth boxes. Same objectId under a different variant is the same physical object re-rendered. Group splits by `plan`.",
    entries: index,
  }, null, 1) + "\n");

  const plans = [...new Set(index.map(e => e.plan))];
  const classes = index.reduce((m, e) => (m[e.cls] = (m[e.cls] || 0) + 1, m), {});
  console.log(`\n${index.length} crops, ${CROP}x${CROP}, ${plans.length} base plans, ${bin.length} bytes`);
  console.log("classes:", JSON.stringify(classes));
  console.log("plans:  ", plans.join(", "));
}

// Loader used by every downstream script, so nothing re-implements the layout.
export function loadCrops(dir = HERE) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "crops.json"), "utf8"));
  const bin = fs.readFileSync(path.join(dir, "crops.bin"));
  const n = meta.side * meta.side;
  return meta.entries.map((e, i) => ({ ...e, pixels: new Uint8Array(bin.buffer, bin.byteOffset + i * n, n) }));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
