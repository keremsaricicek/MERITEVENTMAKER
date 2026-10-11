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

// MERIT_MEM_CGROUP=/sys/fs/cgroup/memory/<name>: this process (and so the
// browser) runs inside a memory cgroup whose limit the caller set; the cgroup's
// own peak (RSS + page cache, every process in it) and its failcnt (times the
// limit was hit) are recorded per run.
const CG = process.env.MERIT_MEM_CGROUP || null;
if (CG) fs.writeFileSync(path.join(CG, "cgroup.procs"), String(process.pid));
const app = await serveApp();
const results = {};
try {
  for (const [name, file] of PLANS) {
    results[name] = { detectMs: [], readMs: [], peakPssMB: [], peakHeapMB: [], longestTaskMs: [], totalBlockingMs: [], localModelMs: [], ...(CG ? { cgroupPeakMB: [], cgroupFailcnt: [] } : {}) };
    for (let i = 0; i < RUNS; i++) {
      const browser = await launchChromium();
      // The browser is a child of this process; everything under it is the browser.
      const pid = process.pid;
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await routeVendorFromCache(page);
      // Main-thread responsiveness during the analysis: every task over 50 ms
      // the browser reports, so the answer is "the page froze for N ms at
      // worst", not a feeling.
      await page.addInitScript(() => {
        globalThis.__longTasks = [];
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) globalThis.__longTasks.push(e.duration); }).observe({ type: "longtask", buffered: true }); } catch {}
      });
      if (CG) { try { fs.writeFileSync(path.join(CG, "memory.max_usage_in_bytes"), "0"); } catch {} }
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
      await page.evaluate(() => { globalThis.__longTasks = []; });
      const t0 = Date.now();
      await runDetection(page, { timeout: 600000 });
      const detectMs = Date.now() - t0;
      const lt = await page.evaluate(() => ({ tasks: globalThis.__longTasks || [], model: state.events[0].analysis.localModel || null }));
      const readMs = await page.evaluate(() => { const t = performance.now(); MeritPlanReading.read(state.events[0].analysis); return performance.now() - t; });
      await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; ui.readingOpen = true; ui.planView = "digital"; render(); });
      await page.waitForTimeout(800);
      clearInterval(timer);
      results[name].detectMs.push(detectMs); results[name].readMs.push(+readMs.toFixed(1));
      results[name].peakPssMB.push(Math.round(peak)); results[name].peakHeapMB.push(Math.round(heap));
      results[name].longestTaskMs.push(Math.round(Math.max(0, ...lt.tasks)));
      results[name].totalBlockingMs.push(Math.round(lt.tasks.reduce((a, d) => a + Math.max(0, d - 50), 0)));
      results[name].localModelMs.push(lt.model && lt.model.available ? lt.model.ms : null);
      if (CG) {
        results[name].cgroupPeakMB.push(Math.round(Number(fs.readFileSync(path.join(CG, "memory.max_usage_in_bytes"), "utf8")) / 1048576));
        results[name].cgroupFailcnt.push(Number(fs.readFileSync(path.join(CG, "memory.failcnt"), "utf8")));
      }
      console.log(`${name} run ${i + 1}: detect ${detectMs} ms, read ${readMs.toFixed(1)} ms, peak browser PSS ${Math.round(peak)} MB, peak JS heap ${Math.round(heap)} MB, longest task ${results[name].longestTaskMs.at(-1)} ms, model ${results[name].localModelMs.at(-1)} ms`);
      await browser.close();
    }
  }
} finally { await app.close(); }
const summary = { measuredOn: new Date().toISOString(), cpu: cores, runs: RUNS, node: process.version,
  memoryCgroup: CG ? { path: CG, limitMB: Math.round(Number(fs.readFileSync(path.join(CG, "memory.limit_in_bytes"), "utf8")) / 1048576) } : null,
  plans: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([m, arr]) => [m, { median: q(arr, 0.5), p95: q(arr, 0.95), all: arr }]))])) };
fs.writeFileSync(path.join(HERE, "constrained-latest.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary.plans, null, 1));
