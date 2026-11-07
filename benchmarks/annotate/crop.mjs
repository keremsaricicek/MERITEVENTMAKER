// Zoom into a region of the real plan for visual inspection.
// usage: node benchmarks/annotate/crop.mjs x y w h scale out.png
import fs from 'node:fs';
import { launchChromium } from '../../tests/lib/env.mjs';
const [x0, y0, w0, h0, scale, out] = process.argv.slice(2);
const b = await launchChromium();
const p = await b.newPage();
await p.goto('about:blank');
const src = 'data:image/png;base64,' + fs.readFileSync(new URL('../plans/merit-real-venue-plan.png', import.meta.url)).toString('base64');
const dataUrl = await p.evaluate(async ({ src, x0, y0, w0, h0, scale }) => {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  const c = document.createElement('canvas'); c.width = w0 * scale; c.height = h0 * scale;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  x.drawImage(img, x0, y0, w0, h0, 0, 0, w0 * scale, h0 * scale);
  return c.toDataURL('image/png');
}, { src, x0: +x0, y0: +y0, w0: +w0, h0: +h0, scale: +scale });
fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('wrote', out);
await b.close();
