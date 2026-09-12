// One-off probe: what colours does the real plan actually use?
import fs from 'node:fs';
import { launchChromium } from '../../tests/lib/env.mjs';
const b = await launchChromium();
const p = await b.newPage();
await p.goto('about:blank');
const src = 'data:image/png;base64,' + fs.readFileSync(new URL('../plans/merit-real-venue-plan.png', import.meta.url)).toString('base64');
const out = await p.evaluate(async src => {
  const img = await createImageBitmap(await (await fetch(src)).blob());
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, img.width, img.height).data;
  const at = (px, py) => { const i = (py * img.width + px) * 4; return [d[i], d[i+1], d[i+2]]; };
  // histogram of quantised colours
  const hist = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = `${d[i]>>4},${d[i+1]>>4},${d[i+2]>>4}`;
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
    .map(([k, n]) => ({ rgb: k.split(',').map(v => +v * 16 + 8), n, pct: +(n / (d.length / 4) * 100).toFixed(2) }));
  return { size: [img.width, img.height], top,
    samples: {
      orangeChair: at(228, 390), orangeChair2: at(760, 300),
      tableSurface: at(240, 435), paleChair: at(160, 430), paleChairEdge: at(158, 425),
      roundSurface: at(115, 435), bg: at(600, 200), bistro: at(200, 722),
    } };
}, src);
console.log(JSON.stringify(out, null, 1));
await b.close();
