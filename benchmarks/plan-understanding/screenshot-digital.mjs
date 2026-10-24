#!/usr/bin/env node
// Renders the DIGITAL plan the product writes on Confirm, on its own drawing,
// at the three supported viewports — the visual half of the digital-fidelity
// contract rows (CONTRACT.md). Console errors are collected and printed.
//   node benchmarks/plan-understanding/screenshot-digital.mjs <outDir>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import { futureDate } from "../../tests/lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(HERE, "latest", "screens"));
fs.mkdirSync(OUT, { recursive: true });
const app = await serveApp();
const browser = await launchChromium();
const plans = [["merit-real-venue", "plans/merit-real-venue-plan.png"], ["ornek-symbolic", "plans/ornek-upright.png"]];
const sizes = [[1920, 1080], [2560, 1440], [1440, 900]];
for (const [id, file] of plans) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${app.baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Digital plan");
  await page.fill('input[name="hotel"]', "Merit");
  await page.fill('input[name="date"]', futureDate());
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(700);
  const b64 = fs.readFileSync(path.join(HERE, "..", file)).toString("base64");
  await page.evaluate(src => { state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 }; render(); }, `data:image/png;base64,${b64}`);
  await page.waitForTimeout(400);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 300000 });
  await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; render(); });
  await page.waitForTimeout(300);
  await page.click('[data-review-action="commit"]');
  await page.waitForTimeout(800);
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => { state.events[0].background.opacity = 0.55; fitCanvas(); render(); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${id}-${w}x${h}.png`) });
  }
  console.log(id, "tables", await page.evaluate(() => state.events[0].tables.length), "console errors", errors.length, errors.slice(0, 3));
  await page.close();
}
await browser.close();
await app.close?.();
console.log("wrote", OUT);
