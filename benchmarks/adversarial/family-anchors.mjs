// WHAT IS THE SIZE BAND ACTUALLY ANCHORED TO?
//
// A secondary chair family — a second kind of seat drawn on the same sheet —
// is admitted only if its members fall inside a band:
//
//     side >= referenceSide * SECONDARY_MIN_SIDE_RATIO      (not debris)
//     side <= surfaceSide   * SECONDARY_MAX_SURFACE_RATIO   (not a table)
//
// `referenceSide` is the median size of the plan's primary chair family and
// `surfaceSide` the median size of its surfaces. Both are PLAN-WIDE medians,
// and the ratio between them is the claim the band rests on: a seat is
// smaller than the table it serves. Where that ratio approaches 1, the two
// populations are the same objects and the band collapses onto them.
//
// This prints both anchors, their ratio, and every family considered, for
// every plan available here. It exists because the alternative to measuring
// this distribution is moving a constant until one fixture passes, which is
// the one thing benchmarks/README.md forbids.
//
//   node benchmarks/adversarial/family-anchors.mjs
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const plans = [];
for (const f of fs.readdirSync(path.join(HERE, "fixtures")).sort())
  if (f.endsWith(".png")) plans.push({ id: f.replace(/\.png$/, ""), file: path.join(HERE, "fixtures", f) });
for (const [id, rel] of [
  ["merit-real-venue", "plans/merit-real-venue-plan.png"],
  ["ornek-symbolic", "plans/ornek-upright.png"],
]) {
  const p = path.join(ROOT, "benchmarks", rel);
  if (fs.existsSync(p)) plans.push({ id, file: p, real: true });
}

const server = await serveApp(ROOT);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });

const rows = [];
for (const plan of plans) {
  // A fresh load per plan. Re-using one page and nulling `analysis` leaves the
  // shell on a screen that has no detect control, and a diagnostic that
  // silently measures the wrong run is worse than one that does not run.
  await page.goto(`${server.baseUrl}/index.html`);
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.goto(`${server.baseUrl}/index.html`);
  await page.waitForLoadState("networkidle");
  await page.click('.appbar [data-action="create-event"]');
  await page.waitForTimeout(300);
  await page.fill('input[name="name"]', "Anchors");
  await page.fill('input[name="hotel"]', "Anchors");
  await page.fill('input[name="date"]', "2026-10-02");
  await page.click('button[data-setup="blank"]');
  await page.waitForTimeout(700);
  await page.evaluate((src) => {
    state.events[0].background = { src, name: "p.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, `data:image/png;base64,${fs.readFileSync(plan.file).toString("base64")}`);
  await page.waitForTimeout(400);
  await page.click('[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 300000 })
    .catch(() => {});
  const d = await page.evaluate(() => (state.events[0].analysis || {}).diagnostics || {});
  const s = d.secondaryChairFamilies || {};
  rows.push({ id: plan.id, real: !!plan.real, chairs: d.chairs ?? null, tables: d.tables ?? null,
    representation: d.representation?.kind ?? null, s });
}
await browser.close();
await server.close();

const pad = (v, n) => String(v ?? "-").padEnd(n);
console.log("\nplan                        primary            ref  surf  ref/surf  cons adm  chairs tables  repr");
for (const r of rows) {
  console.log(`${pad(r.id, 27)} ${pad(r.s.primary, 18)} ${pad(r.s.referenceSide, 4)} ${pad(r.s.surfaceSide, 5)} ` +
    `${pad(r.s.referenceToSurface, 9)} ${pad(r.s.considered, 4)} ${pad(r.s.admitted, 3)} ` +
    `${pad(r.chairs, 6)} ${pad(r.tables, 6)} ${r.representation ?? "-"}${r.real ? "   [REAL]" : ""}`);
}
console.log("\nfamilies considered (side, and where each bound put it):");
for (const r of rows) {
  for (const f of r.s.families || []) {
    const floor = r.s.referenceSide * r.s.minSideRatio, ceil = r.s.surfaceSide * r.s.maxSurfaceRatio;
    console.log(`  ${pad(r.id, 27)} members=${pad(f.members, 4)} adjacent=${pad(f.share, 5)} side=${pad(f.side, 4)} ` +
      `band=[${floor.toFixed(1)}, ${ceil.toFixed(1)}] sizeOk=${pad(f.admitted ? true : f.sizeOk, 5)} ` +
      `ADMITTED=${f.admitted}  src=${f.source}`);
  }
}
console.log();
