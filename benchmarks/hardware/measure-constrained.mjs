// The product on a weak machine: time and memory of analysing a plan and
// reading it, on 2 CPU cores, repeated.
//
//   taskset -c 0,1 node benchmarks/hardware/measure-constrained.mjs [runs]
//
// Run under `taskset -c 0,1` so the browser (and its workers) have two cores,
// like an entry-level laptop. Memory is the proportional set (PSS) of EVERY browser
// process (renderer, GPU, utility) sampled every 100 ms, summed — the figure
// that matters against 8 GB — plus the page's JS heap. Median and p95 over the
// runs, never one number. Pinned OCR, network refused.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp, REPO_ROOT } from "../../tests/lib/server.mjs";
import { routeVendorFromCache } from "../../tests/lib/vendor.mjs";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../../tests/lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.argv[2]) || 3;
const PLANS = [["golden", "merit-real-venue-plan.png"], ["ornek", "ornek-upright.png"]];
const q = (v, p) => { const s = v.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const cores = (() => { try { return execSync(`taskset -cp ${process.pid}`).toString().trim(); } catch { return "unknown"; } })();

function browserRssMB(rootPid) {
  // Every descendant of the launched browser, by walking /proc.
  const kids = new Map();
  for (const d of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try { const st = fs.readFileSync(`/proc/${d}/stat`, "utf8"); const pp = Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1]); (kids.get(pp) || kids.set(pp, []).get(pp)).push(Number(d)); } catch {}
  }
  let total = 0; const stack = [...(kids.get(rootPid) || [])];
  while (stack.length) {
    const p = stack.pop();
    // PSS, not RSS: a library shared by six browser processes is counted once
    // across them, not six times. RSS summed over processes overstates RAM.
    try { const m = fs.readFileSync(`/proc/${p}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m); if (m) total += Number(m[1]); } catch {}
    for (const k of kids.get(p) || []) stack.push(k);
  }
  return total / 1024;
}

const app = await serveApp();
const results = {};
try {
  for (const [name, file] of PLANS) {
    results[name] = { detectMs: [], readMs: [], peakPssMB: [], peakHeapMB: [] };
    for (let i = 0; i < RUNS; i++) {
      const browser = await launchChromium();
      // The browser is a child of this process; everything under it is the browser.
      const pid = process.pid;
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await routeVendorFromCache(page);
      await openApp(page, app.baseUrl, { lang: "tr" });
      await createBlankEvent(page, { name: "HW", date: futureDate() });
      await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(REPO_ROOT, "benchmarks/plans", file)).toString("base64"));
      let peak = 0, heap = 0;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      const timer = setInterval(async () => {
        if (pid) peak = Math.max(peak, browserRssMB(pid));
        try { const m = await cdp.send("Performance.getMetrics"); const h = m.metrics.find((x) => x.name === "JSHeapUsedSize"); if (h) heap = Math.max(heap, h.value / 1048576); } catch {}
      }, 100);
      const t0 = Date.now();
      await runDetection(page, { timeout: 600000 });
      const detectMs = Date.now() - t0;
      const readMs = await page.evaluate(() => { const t = performance.now(); MeritPlanReading.read(state.events[0].analysis); return performance.now() - t; });
      await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; ui.readingOpen = true; ui.planView = "digital"; render(); });
      await page.waitForTimeout(800);
      clearInterval(timer);
      results[name].detectMs.push(detectMs); results[name].readMs.push(+readMs.toFixed(1));
      results[name].peakPssMB.push(Math.round(peak)); results[name].peakHeapMB.push(Math.round(heap));
      console.log(`${name} run ${i + 1}: detect ${detectMs} ms, read ${readMs.toFixed(1)} ms, peak browser PSS ${Math.round(peak)} MB, peak JS heap ${Math.round(heap)} MB`);
      await browser.close();
    }
  }
} finally { await app.close(); }
const summary = { measuredOn: new Date().toISOString(), cpu: cores, runs: RUNS, node: process.version,
  plans: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([m, arr]) => [m, { median: q(arr, 0.5), p95: q(arr, 0.95), all: arr }]))])) };
fs.writeFileSync(path.join(HERE, "constrained-latest.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary.plans, null, 1));
