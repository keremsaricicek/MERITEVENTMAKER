#!/usr/bin/env node
// Draws a variant's transformed ground truth back onto the variant image.
// If the geometric map is wrong, every robustness number is wrong, and the
// only way to know is to look.
//   node benchmarks/robustness/check-variant-truth.mjs rotate-2 out.png
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [id, out] = process.argv.slice(2);
const annot = JSON.parse(fs.readFileSync(path.join(HERE, "annotations", `merit-real-${id}.json`), "utf8"));
const img = path.join(HERE, "..", annot.source.file);
const b = await launchChromium(); const p = await b.newPage(); await p.goto("about:blank");
const ext = img.endsWith(".jpg") ? "jpeg" : "png";
const src = `data:image/${ext};base64,` + fs.readFileSync(img).toString("base64");
const dataUrl = await p.evaluate(async ({ src, objects }) => {
  const im = await createImageBitmap(await (await fetch(src)).blob());
  const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
  const x = c.getContext("2d"); x.drawImage(im, 0, 0); x.lineWidth = 1.4;
  const colour = { table: "#0044ff", chair: "#ff0000", banquette: "#884400", stage: "#00aa44" };
  for (const o of objects) {
    x.strokeStyle = colour[o.class] || "#888";
    x.strokeRect(o.cx - o.w / 2, o.cy - o.h / 2, o.w, o.h);
  }
  return c.toDataURL("image/png");
}, { src, objects: annot.objects });
fs.writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
console.log("wrote", out, `(${annot.objects.length} objects on ${annot.source.width}x${annot.source.height})`);
await b.close();
