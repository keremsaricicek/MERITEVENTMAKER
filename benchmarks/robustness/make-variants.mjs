#!/usr/bin/env node
// Controlled variants of the one real Golden Plan, with their ground truth
// transformed alongside.
//
// THESE ARE NOT ADDITIONAL REAL PLANS. There is one real venue plan in this
// repository and every image here is derived from it. Each generated
// annotation carries `derivedFrom: "merit-real-venue"` and a `transform`
// block, and the robustness runner refuses to report them as distinct venues.
// What they do measure is real and worth measuring: whether a rescan, a
// screenshot, a JPEG round trip or a slightly rotated import destroys
// detection that works on the original.
//
// Geometry stays traceable. A transform declares how it maps a source pixel to
// a variant pixel, and the annotation is put through the same map, so the
// truth is exact for every variant rather than approximately reused.
//
//   node benchmarks/robustness/make-variants.mjs
//   node benchmarks/robustness/make-variants.mjs --only jpeg,rotate
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PLAN = path.join(ROOT, "plans", "merit-real-venue-plan.png");
const SOURCE_ANNOT = path.join(ROOT, "annotations", "merit-real-venue.json");
const IMG_DIR = path.join(HERE, "variants");
const ANNOT_DIR = path.join(HERE, "annotations");
const only = (process.argv.find(a => a.startsWith("--only="))?.slice(7)
  || (process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "") || "")
  .split(",").filter(Boolean);

fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(ANNOT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// The variants. `render` runs in the page against a source canvas and returns
// a data URL; `map` moves an annotation point from source to variant space.
// A transform that does not move geometry says so with `map: null`.
// ---------------------------------------------------------------------------
const VARIANTS = [
  { id: "grayscale", why: "a plan printed or scanned in black and white; removes every colour cue the chair clusterer uses",
    filter: "grayscale(1)" },
  { id: "contrast-low", why: "a faded photocopy or a washed-out scan", filter: "contrast(0.72)" },
  { id: "contrast-high", why: "an over-processed scan; thin linework thickens and merges", filter: "contrast(1.45)" },
  { id: "bright-up", why: "an overexposed phone photo of a printed plan", filter: "brightness(1.18)" },
  { id: "bright-down", why: "an underexposed scan", filter: "brightness(0.82)" },
  { id: "hue-shift", why: "a different printer profile; the accent is still one hue, just not the same one",
    filter: "hue-rotate(18deg) saturate(0.9)" },
  { id: "blur", why: "a soft scan or a slightly out-of-focus photo", filter: "blur(0.9px)" },
  { id: "jpeg-q40", why: "a plan that reached us through email or WhatsApp", encode: ["image/jpeg", 0.4] },
  { id: "jpeg-q20", why: "the same, harder", encode: ["image/jpeg", 0.2] },
  { id: "noise", why: "scanner sensor noise", noise: 12 },
  { id: "downscale-70", why: "a smaller export; every object is 30% smaller in pixels", scale: 0.7 },
  { id: "lowres-roundtrip", why: "downscaled to 45% and blown back up — a screenshot of a screenshot",
    scale: 1, roundTrip: 0.45 },
  { id: "rotate-2", why: "a page scanned slightly askew", rotate: 2 },
  { id: "rotate-minus-3", why: "the same, the other way and further", rotate: -3 },
  { id: "crop-pad", why: "a different export margin; every coordinate shifts", pad: { left: 60, top: 34 } },
];

const selected = only.length ? VARIANTS.filter(v => only.some(o => v.id.includes(o))) : VARIANTS;
const sourceAnnot = JSON.parse(fs.readFileSync(SOURCE_ANNOT, "utf8"));
const browser = await launchChromium();
const page = await browser.newPage();
await page.goto("about:blank");
const src = "data:image/png;base64," + fs.readFileSync(PLAN).toString("base64");

for (const variant of selected) {
  const { dataUrl, width, height } = await page.evaluate(async ({ src, v }) => {
    const img = await createImageBitmap(await (await fetch(src)).blob());
    const rad = (v.rotate || 0) * Math.PI / 180;
    const scale = v.scale ?? 1;
    const padL = v.pad?.left || 0, padT = v.pad?.top || 0;
    // A rotated page still has to fit, so the canvas grows to the rotated
    // bounding box. The map below has to agree with this exactly.
    const sw = img.width * scale, sh = img.height * scale;
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const W = Math.round(sw * cos + sh * sin) + padL * 2;
    const H = Math.round(sw * sin + sh * cos) + padT * 2;

    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H);
    if (v.filter) x.filter = v.filter;
    x.translate(W / 2, H / 2);
    x.rotate(rad);
    if (v.roundTrip) {
      // Actually resample down and back up, so the loss is real rather than
      // simulated by a blur.
      const small = document.createElement("canvas");
      small.width = Math.max(1, Math.round(img.width * v.roundTrip));
      small.height = Math.max(1, Math.round(img.height * v.roundTrip));
      small.getContext("2d").drawImage(img, 0, 0, small.width, small.height);
      x.drawImage(small, -sw / 2, -sh / 2, sw, sh);
    } else {
      x.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.filter = "none";

    if (v.noise) {
      const d = x.getImageData(0, 0, W, H);
      const p = d.data;
      // Deterministic noise: a fixture that changes every run cannot be a
      // regression fixture.
      let seed = 12345;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - .5; };
      for (let i = 0; i < p.length; i += 4) {
        const n = rnd() * v.noise * 2;
        p[i] = Math.max(0, Math.min(255, p[i] + n));
        p[i + 1] = Math.max(0, Math.min(255, p[i + 1] + n));
        p[i + 2] = Math.max(0, Math.min(255, p[i + 2] + n));
      }
      x.putImageData(d, 0, 0);
    }

    const encode = v.encode || ["image/png"];
    return { dataUrl: c.toDataURL(...encode), width: W, height: H };
  }, { src, v: variant });

  // Same geometry, computed here, so the annotation lands where the pixels did.
  const rad = (variant.rotate || 0) * Math.PI / 180;
  const scale = variant.scale ?? 1;
  const padL = variant.pad?.left || 0, padT = variant.pad?.top || 0;
  const sw = sourceAnnot.source.width * scale, sh = sourceAnnot.source.height * scale;
  const map = (px, py) => {
    const x0 = px * scale - sw / 2, y0 = py * scale - sh / 2;
    const rx = x0 * Math.cos(rad) - y0 * Math.sin(rad);
    const ry = x0 * Math.sin(rad) + y0 * Math.cos(rad);
    return [rx + width / 2, ry + height / 2];
  };
  const mapObject = o => {
    const [cx, cy] = map(o.cx, o.cy);
    // A rotated box's axis-aligned extent grows; using the source w/h would
    // make the truth narrower than the object actually is in this variant.
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    return { ...o,
      cx: +cx.toFixed(1), cy: +cy.toFixed(1),
      w: +((o.w * cos + o.h * sin) * scale).toFixed(1),
      h: +((o.w * sin + o.h * cos) * scale).toFixed(1),
      rotation: o.orientationKnown ? +(((o.rotation || 0) + (variant.rotate || 0) + 360) % 360).toFixed(1) : (o.rotation || 0) };
  };
  const mapRegion = r => {
    const [cx, cy] = map(r.x + r.w / 2, r.y + r.h / 2);
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const w = (r.w * cos + r.h * sin) * scale, h = (r.w * sin + r.h * cos) * scale;
    return { ...r, x: +(cx - w / 2).toFixed(1), y: +(cy - h / 2).toFixed(1), w: +w.toFixed(1), h: +h.toFixed(1) };
  };

  const ext = (variant.encode?.[0] || "image/png") === "image/jpeg" ? "jpg" : "png";
  const imgPath = path.join(IMG_DIR, `merit-real-${variant.id}.${ext}`);
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  fs.writeFileSync(imgPath, bytes);

  const annot = {
    planId: `merit-real-${variant.id}`,
    derivedFrom: "merit-real-venue",
    isRealVenue: false,
    transform: { id: variant.id, why: variant.why,
      filter: variant.filter || null, encode: variant.encode || null, noise: variant.noise || null,
      scale, rotate: variant.rotate || 0, roundTrip: variant.roundTrip || null, pad: variant.pad || null },
    source: {
      file: path.relative(ROOT, imgPath).split(path.sep).join("/"),
      width, height,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      venue: sourceAnnot.source.venue, layout: sourceAnnot.source.layout,
    },
    annotationMethod:
      `Derived from benchmarks/annotations/merit-real-venue.json by benchmarks/robustness/make-variants.mjs. The image is the real Golden Plan with the "${variant.id}" transform applied (${variant.why}); every object and region was put through the same geometric map the pixels were, so the truth is exact rather than reused. THIS IS NOT A SECOND REAL VENUE PLAN — it is the same drawing rendered differently, and any accuracy it shows says nothing about a venue this system has not seen.`,
    matchToleranceP: sourceAnnot.matchToleranceP,
    confidence: sourceAnnot.confidence,
    objects: sourceAnnot.objects.map(mapObject),
    relationships: sourceAnnot.relationships,
    logicalGroups: sourceAnnot.logicalGroups,
    capacity: sourceAnnot.capacity,
    regions: (sourceAnnot.regions || []).map(mapRegion),
  };
  fs.writeFileSync(path.join(ANNOT_DIR, `merit-real-${variant.id}.json`), JSON.stringify(annot, null, 2) + "\n");
  console.log(`${variant.id.padEnd(20)} ${width}x${height}  ${(bytes.length / 1024).toFixed(0)}KB  ${ext}`);
}

console.log(`\n${selected.length} variants written to benchmarks/robustness/variants/`);
console.log("These are transforms of ONE real plan, not additional real plans.");
await browser.close();
