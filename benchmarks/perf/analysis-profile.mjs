#!/usr/bin/env node
// Where a plan analysis spends its time, stage by stage, and how long the page
// is frozen while it runs.
//
//   taskset -c 0-3 node benchmarks/perf/analysis-profile.mjs [runs]   # 4 cores
//   taskset -c 0,1 node benchmarks/perf/analysis-profile.mjs [runs]   # 2 cores
//
// For each plan, each run starts a FRESH browser (cold: engines, models and
// caches loaded from nothing), imports the plan, presses Analyse, and then
// presses Re-analyse on the same page (warm: everything already loaded).
// Reported per run:
//   totalMs        the button press to a complete, rendered result
//   stages         the analysis's own per-stage wall clock (analysis.timings)
//   tesseractMs    Tesseract's own time in its worker (overlaps other stages)
//   longestTaskMs  the longest main-thread task while it ran (input frozen)
//   blockingMs     total main-thread time over 50 ms per task
//   inputLatencyMaxMs  a frame asked for every 250 ms while it runs, timed to
//                  when it was drawn: the longest an operator's scroll, zoom
//                  or Stop would have waited
//   fromImportMs   the plan's import completing to the full result (cold only;
//                  the harness presses Analyse at once, as a person would not)
//   peakMemoryMb   the browser's processes together (page, renderer
//                  workers, GPU), PSS sampled every 250 ms
//   crops          crop reads by the engine vs. answered from memory
// Median and p95 per plan, never one number. Pinned OCR, network refused.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp, REPO_ROOT } from "../../tests/lib/server.mjs";
import { routeVendorFromCache } from "../../tests/lib/vendor.mjs";
import { openApp, createBlankEvent, importPlan, futureDate } from "../../tests/lib/app-actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.argv[2]) || 3;
const PLANS = (process.env.PLANS || "golden,ornek").split(",");
const FILES = { golden: "merit-real-venue-plan.png", ornek: "ornek-upright.png" };
const OUT = process.env.OUT || path.join(HERE, "analysis-profile-latest.json");
const cores = (() => { try { return execSync(`taskset -cp ${process.pid}`).toString().trim(); } catch { return "unknown"; } })();
// Every process descended from this one (the browser and all it started),
// as PSS: each shared page divided among the processes that share it, so the
// sum is what the browser costs the machine (the acceptance row is PSS). Where
// /proc/<pid>/smaps_rollup cannot be read, RSS is used and the row says so.
let memoryBasis = "pss";
function descendantsMb() {
  try {
    const rows = execSync("ps -eo pid=,ppid=,rss=").toString().trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
    const kids = new Map();
    for (const [pid, ppid] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push(pid); }
    const rss = new Map(rows.map(([pid, , kb]) => [pid, kb]));
    let total = 0; const stack = [...(kids.get(process.pid) || [])];
    while (stack.length) {
      const pid = stack.pop();
      let kb = null;
      try { const m = /^Pss:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${pid}/smaps_rollup`, "utf8")); if (m) kb = Number(m[1]); }
      catch (e) { if (e.code === "ENOENT" || e.code === "ESRCH") kb = 0; else kb = null; } // a process that just exited costs nothing
      if (kb == null) { memoryBasis = "rss (smaps_rollup unreadable)"; kb = rss.get(pid) || 0; }
      total += kb; stack.push(...(kids.get(pid) || []));
    }
    return Math.round(total / 1024);
  } catch { return null; }
}
const q = (v, p) => { const s = v.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };

async function analyse(page, selector, importDoneAt) {
  await page.evaluate(() => {
    globalThis.__longTasks = [];
    globalThis.__longTaskAt = [];
    globalThis.__probe = [];
    globalThis.__probeTimer = setInterval(() => {
      // An input the operator would make: how long until the page answers it.
      const t0 = performance.now();
      requestAnimationFrame(() => globalThis.__probe.push(performance.now() - t0));
    }, 250);
  });
  const t0 = Date.now();
  let peakMemoryMb = descendantsMb() || 0;
  const sampler = setInterval(() => { const v = descendantsMb(); if (v > peakMemoryMb) peakMemoryMb = v; }, 250);
  await page.click(selector);
  await page.waitForFunction(() => !ui.analysisBusy && state.events[0].analysis && state.events[0].analysis.timings && state.events[0].analysis.timings.analysisCompletedAtMs, null, { timeout: 600000, polling: 100 });
  const totalMs = Date.now() - t0;
  clearInterval(sampler);
  // one argument: Playwright passes a single serialisable value to the page
  const r = await page.evaluate(({ totalMs, importDoneAt }) => {
    clearInterval(globalThis.__probeTimer);
    const a = state.events[0].analysis, tasks = globalThis.__longTasks || [], probe = globalThis.__probe || [];
    return { totalMs, stages: a.timings.stages || [], tesseractMs: a.timings.tesseractMs ?? null,
      longestTaskMs: Math.round(Math.max(0, ...tasks)), blockingMs: Math.round(tasks.reduce((s, d) => s + Math.max(0, d - 50), 0)),
      inputLatencyMaxMs: Math.round(Math.max(0, ...probe)), localModel: a.localModel ? { ms: a.localModel.ms, loadMs: a.localModel.loadMs ?? null } : null,
      tables: a.candidates.filter((c) => c.kind === "table" && c.status !== "rejected").length,
      fromImportMs: importDoneAt ? a.timings.analysisCompletedAtMs - importDoneAt : null,
      runsIn: { ocrModel: a.ocrModel && a.ocrModel.provider ? a.ocrModel.provider.runsIn || null : null, localModel: a.localModel && a.localModel.model ? a.localModel.model.runsIn || null : null },
      crops: globalThis.MeritPlanOCRCrops ? MeritPlanOCRCrops.stats() : null,
      // Which stage each task over 200 ms fell in: the stage whose end is the
      // first after the task started.
      longTasksByStage: (globalThis.__longTaskAt || []).filter(([, d]) => d > 200).map(([at, d]) => {
        const st = (a.timings.stages || []).find((x) => x.end != null && x.end >= at);
        return { stage: st ? st.stage : "after", ms: Math.round(d) };
      }) };
  }, { totalMs, importDoneAt });
  return { ...r, peakMemoryMb, memoryBasis };
}

const app = await serveApp();
const out = { measuredOn: new Date().toISOString(), cores, runs: RUNS, node: process.version, plans: {} };
try {
  for (const name of PLANS) {
    const rows = { cold: [], warm: [] };
    for (let i = 0; i < RUNS; i++) {
      const browser = await launchChromium();
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await routeVendorFromCache(page, { offline: true });
      await page.addInitScript(() => {
        globalThis.__longTasks = [];
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { (globalThis.__longTasks || []).push(e.duration); (globalThis.__longTaskAt = globalThis.__longTaskAt || []).push([e.startTime, e.duration]); } }).observe({ type: "longtask", buffered: true }); } catch {}
      });
      await openApp(page, app.baseUrl, { lang: "tr" });
      await createBlankEvent(page, { name: "Profile", date: futureDate() });
      await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(REPO_ROOT, "benchmarks/plans", FILES[name])).toString("base64"));
      const importDoneAt = Date.now();
      const cold = await analyse(page, '[data-v8-action="detect"]', importDoneAt);
      rows.cold.push(cold);
      const warm = await analyse(page, '[data-review-action="reanalyze"]');
      rows.warm.push(warm);
      console.log(`${name} run ${i + 1}: cold ${cold.totalMs} ms (longest task ${cold.longestTaskMs}, input ${cold.inputLatencyMaxMs}) · warm ${warm.totalMs} ms (longest ${warm.longestTaskMs})`);
      console.log("   cold stages: " + cold.stages.map((s) => `${s.stage} ${s.ms}`).join(" · ") + ` · tesseract(worker) ${cold.tesseractMs}`);
      await browser.close();
    }
    const summarise = (list) => {
      const stageNames = [...new Set(list.flatMap((r) => r.stages.map((s) => s.stage)))];
      const per = (k) => ({ median: q(list.map((r) => r[k]), 0.5), p95: q(list.map((r) => r[k]), 0.95) });
      return { totalMs: per("totalMs"), fromImportMs: per("fromImportMs"), longestTaskMs: per("longestTaskMs"), blockingMs: per("blockingMs"), inputLatencyMaxMs: per("inputLatencyMaxMs"), tesseractMs: per("tesseractMs"), peakMemoryMb: per("peakMemoryMb"),
        stages: Object.fromEntries(stageNames.map((n) => [n, q(list.map((r) => (r.stages.find((s) => s.stage === n) || {}).ms ?? null), 0.5)])),
        tables: list.map((r) => r.tables), runs: list };
    };
    out.plans[name] = { cold: summarise(rows.cold), warm: summarise(rows.warm) };
  }
} finally { await app.close(); }
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
for (const [name, r] of Object.entries(out.plans)) for (const k of ["cold", "warm"]) {
  const s = r[k];
  console.log(`\n${name} ${k}: total ${s.totalMs.median} / ${s.totalMs.p95} ms · longest task ${s.longestTaskMs.median} ms · input latency max ${s.inputLatencyMaxMs.median} ms · peak memory ${s.peakMemoryMb.median} MB (${memoryBasis})`);
  console.log("  " + Object.entries(s.stages).sort((a, b) => (b[1] || 0) - (a[1] || 0)).map(([n, ms]) => `${n} ${ms}`).join(" · "));
}
console.log(`\nwrote ${path.relative(REPO_ROOT, OUT)} (cores ${cores})`);
