#!/usr/bin/env node
// Import → a usable plan on screen, measured apart from analysis (S4, 2026-10-17).
//
//   taskset -c 0-3 node benchmarks/perf/import-usable.mjs [runs]   # 4 cores
//   taskset -c 0,1 node benchmarks/perf/import-usable.mjs [runs]   # 2 cores
//
// The analysis clock (analysis-profile.mjs) starts when Analyse is pressed. This
// one starts when a person chooses the plan FILE in the new-event dialog and
// stops when the event's Floor Plan shows that plan, drawn and answering input
// — before any analysis. Two parts, summed:
//   chooseMs   file chosen → the dialog shows it (a PNG decoded; a PDF opened,
//              its first page rendered and chosen)
//   openMs     Create pressed → the Floor Plan on screen with the plan's image
//              decoded, and one more frame drawn after it
// The name, venue and date are typed BEFORE the file is chosen, so no typing
// sits inside the clock. Each run is a fresh browser (cold). Median and worst
// per plan. Network refused, the same server every suite uses.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp, REPO_ROOT } from "../../tests/lib/server.mjs";
import { openApp, futureDate } from "../../tests/lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.argv[2]) || 5;
const OUT = process.env.OUT || path.join(HERE, "import-usable-latest.json");
const PLANS = [
  { name: "golden.png", file: "merit-real-venue-plan.png", mime: "image/png" },
  { name: "ornek.png", file: "ornek-upright.png", mime: "image/png" },
  { name: "ornek.pdf", file: "ORNEK.pdf", mime: "application/pdf" },
];
const cores = (() => { try { return execSync(`taskset -cp ${process.pid}`).toString().trim(); } catch { return "unknown"; } })();

const app = await serveApp();
const results = {};
for (const plan of PLANS) {
  const buffer = fs.readFileSync(path.join(REPO_ROOT, "benchmarks/plans", plan.file));
  const runs = [];
  for (let r = 0; r < RUNS; r++) {
    const browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    // PREFETCH=off measures the same clock with the import-time text reads
    // switched off, so their cost to the first usable view is a measured number.
    if (process.env.PREFETCH === "off") await page.addInitScript(() => { globalThis.MERIT_PREFETCH = "off"; });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApp(page, app.baseUrl, { lang: "tr" });
    await page.click('.appbar [data-action="create-event"]');
    await page.waitForSelector('input[name="name"]');
    await page.fill('input[name="name"]', "Ölçüm");
    await page.fill('input[name="hotel"]', "Merit");
    await page.fill('input[name="date"]', futureDate());
    const t0 = Date.now();
    await page.setInputFiles("#v8PlanFile", { name: plan.name, mimeType: plan.mime, buffer });
    if (plan.mime === "application/pdf") {
      // the first page is chosen by the dialog itself; wait for it to be the draft plan
      await page.waitForFunction(() => !!document.querySelector("#v8PlanDrop img")?.complete && document.querySelector("#v8PlanDrop img").naturalWidth > 0, null, { timeout: 120000 });
    } else {
      await page.waitForFunction(() => !!document.querySelector("#v8PlanDrop img")?.complete && document.querySelector("#v8PlanDrop img").naturalWidth > 0, null, { timeout: 60000 });
    }
    const chooseMs = Date.now() - t0;
    const t1 = Date.now();
    await page.click('[data-setup="create"]');
    // the Floor Plan with the event's own background on screen: the canvas
    // draws it as a CSS background-image (not an <img>; the first version of
    // this runner waited for an <img> and never saw one), so: an element that
    // carries it, laid out, and the image itself decoded, then two frames.
    await page.waitForFunction(() => {
      const e = typeof activeEvent === "function" ? activeEvent() : null;
      if (!e || !e.background || !e.background.src) return false;
      return [...document.querySelectorAll("[style*='background-image']")].some((el) => el.style.backgroundImage.includes(e.background.src.slice(0, 64)) && el.getBoundingClientRect().width > 0);
    }, null, { timeout: 60000 });
    await page.evaluate(async () => { const i = new Image(); i.src = activeEvent().background.src; await i.decode(); await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))); });
    const openMs = Date.now() - t1;
    runs.push({ chooseMs, openMs, totalMs: chooseMs + openMs, errors: errors.length });
    await browser.close();
    console.log(`${plan.name} run ${r + 1}: choose ${chooseMs} ms + open ${openMs} ms = ${chooseMs + openMs} ms`);
  }
  const med = (k) => { const s = runs.map((x) => x[k]).sort((a, b) => a - b); return s[s.length >> 1]; };
  const worst = (k) => Math.max(...runs.map((x) => x[k]));
  results[plan.name] = { runs, median: { chooseMs: med("chooseMs"), openMs: med("openMs"), totalMs: med("totalMs") }, worstTotalMs: worst("totalMs"),
    pageErrors: runs.reduce((n, x) => n + x.errors, 0) };
}
await app.close?.();
const out = { ranAt: new Date().toISOString(), cores, runs: RUNS, prefetch: process.env.PREFETCH === "off" ? "off" : "on", results };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { ...v.median, worstTotalMs: v.worstTotalMs, pageErrors: v.pageErrors }])), null, 1));
