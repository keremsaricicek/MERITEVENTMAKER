// Produce the two benchmark images for real plan #2 from the committed
// ORNEK.pdf, and print the sha256 of each.
//
//   node benchmarks/plans/extract-ornek.mjs
//
// ORNEK.pdf holds exactly one image and no text or vector geometry at all
// (see ORNEK-SOURCE.md), so there is nothing to render: the page IS a JPEG
// photograph in a PDF wrapper. This lifts that JPEG out byte for byte and
// then writes the same pixels turned the right way up.
//
//   ornek-raw.jpg       the embedded stream, unmodified. This is the document
//                       exactly as it arrived: portrait, with the plan lying
//                       on its side, plus the fold and shadow of the
//                       photograph. Nothing is corrected.
//   ornek-upright.png   the same pixels rotated 270 degrees, and nothing
//                       else — no deskew, no contrast, no crop. The plan
//                       reads landscape, which is how a human reads it and
//                       the frame the ground truth is annotated in.
//
// Rotating is not the normalisation work: that belongs to the product, on
// the real document, and is measured separately. This is only so that the
// annotation and the pixels agree on which way is up.
//
// Both files are committed, because the annotation carries their sha256 to
// detect a swapped image, and a PNG re-encoded by a different Chromium build
// would not hash the same. Re-run this only to verify reproducibility of the
// JPEG (which is a byte copy and always identical).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pdf = fs.readFileSync(path.join(here, "ORNEK.pdf"));

// Find the single /DCTDecode stream and copy its bytes out. A JPEG starts
// FFD8 and ends FFD9, so the extraction is checkable against the container's
// own /Length rather than trusted.
const marker = Buffer.from("/DCTDecode");
const at = pdf.indexOf(marker);
if (at < 0) throw new Error("no /DCTDecode image in ORNEK.pdf");
const lenAt = pdf.lastIndexOf(Buffer.from("/Length"), at);
const declared = Number(/\/Length\s+(\d+)/.exec(pdf.subarray(lenAt, lenAt + 40).toString("latin1"))?.[1]);
const start = pdf.indexOf(Buffer.from("stream", "latin1"), at) + "stream".length;
let s = start;
while (pdf[s] === 0x0d || pdf[s] === 0x0a) s++;
const jpeg = pdf.subarray(s, s + declared);
if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("extracted bytes are not a JPEG (no SOI)");
if (jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) throw new Error("extracted bytes are not a JPEG (no EOI)");

const rawPath = path.join(here, "ornek-raw.jpg");
fs.writeFileSync(rawPath, jpeg);

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
const { png, w0, h0, w1, h1 } = await page.evaluate(async (src) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = H; c.height = W;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((270 * Math.PI) / 180);
  g.drawImage(img, -W / 2, -H / 2);
  return { png: c.toDataURL("image/png"), w0: W, h0: H, w1: c.width, h1: c.height };
}, dataUrl);
await browser.close();

const uprightPath = path.join(here, "ornek-upright.png");
fs.writeFileSync(uprightPath, Buffer.from(png.split(",")[1], "base64"));

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
console.log(`ORNEK.pdf          ${pdf.length} bytes  sha256 ${sha(path.join(here, "ORNEK.pdf"))}`);
console.log(`ornek-raw.jpg      ${jpeg.length} bytes  ${w0}x${h0}  sha256 ${sha(rawPath)}`);
console.log(`ornek-upright.png  ${fs.statSync(uprightPath).size} bytes  ${w1}x${h1}  sha256 ${sha(uprightPath)}`);
console.log("");
console.log("upright(x,y) = ( raw.y , rawWidth - raw.x )     rawWidth = " + w0);
console.log("raw(x,y)     = ( rawWidth - upright.y , upright.x )");
