// Two files at the size an operator could actually hand the product, through
// the real controls: a 50,000-row guest workbook and a 40-page PDF plan.
//
// Measured, not assumed: wall clock per step, the longest single main-thread
// block (the "frozen" moment an operator would feel — PerformanceObserver
// longtask), and JS heap from the DevTools protocol (performance.memory is
// coarsened in this browser, so it is not used). Nothing here is fabricated
// test data posing as a venue: the guests are numbered, the plan pages are
// drawn circles with printed numbers.
//
//   node benchmarks/perf/large-files.mjs            # both
//   ROWS=50000 PAGES=40 node benchmarks/perf/large-files.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp, REPO_ROOT } from "../../tests/lib/server.mjs";
import { openApp, createBlankEvent, futureDate, click } from "../../tests/lib/app-actions.mjs";
import { readRecord } from "../../tests/lib/faults.mjs";
import { BUDGETS, judge } from "./budgets.mjs";

const ROWS = Number(process.env.ROWS || 50000);
const PAGES = Number(process.env.PAGES || 40);
const ONLY = process.env.ONLY || "";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "merit-large-"));
const require = createRequire(import.meta.url);
const XLSX = require(path.join(REPO_ROOT, ".vendor-cache/xlsx-0.18.5/package/xlsx.js"));

const app = await serveApp();
const browser = await launchChromium();
const errs = [];
const out = {};

async function instrument(page) {
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(() => {
    window.__longest = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longest = Math.max(window.__longest, e.duration); }).observe({ type: "longtask", buffered: true }); } catch {}
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const heapMB = async () => {
    await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
    const m = (await cdp.send("Performance.getMetrics")).metrics.find((x) => x.name === "JSHeapUsedSize");
    return +(m.value / 1048576).toFixed(1);
  };
  const longest = async () => { const v = await page.evaluate(() => { const v = window.__longest; window.__longest = 0; return v; }); return Math.round(v); };
  return { heapMB, longest };
}
const step = async (label, fn, probe) => {
  await probe.longest();
  const t0 = Date.now(); await fn(); const ms = Date.now() - t0;
  const longestBlock = await probe.longest();
  return { label, ms, longestBlock };
};

// --- A. a 50,000-row guest workbook ----------------------------------------
if (!ONLY || ONLY === "xlsx") {
  const first = ["Ayşe", "Mehmet", "Zeynep", "Can", "Elif", "Murat", "Selin", "Emre", "Deniz", "Ömer"];
  const rows = [["NAME SURNAME", "ADDITIONAL GUESTS", "STATUS", "VIP", "INVITED BY", "NOTES"]];
  for (let i = 0; i < ROWS; i++) rows.push([`${first[i % 10]} Misafir ${String(i + 1).padStart(5, "0")}`, i % 7 === 0 ? (i % 3) + 1 : 0,
    i % 4 === 0 ? "Tentative" : "Confirmed", ["", "VIP", "", "VVIP", ""][i % 5], `Host ${i % 60}`, i % 11 === 0 ? "Vejetaryen" : ""]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Guests");
  const file = path.join(TMP, `guests-${ROWS}.xlsx`);
  XLSX.writeFile(wb, file);
  const bytes = fs.statSync(file).size;

  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const probe = await instrument(page);
  await openApp(page, app.baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Büyük Liste", hotel: "Merit", date: futureDate() });
  const heap0 = await probe.heapMB();
  await page.evaluate(() => { ui.tab = "guests"; render(); });
  await click(page, "[data-guest-command='import']");
  const steps = [];
  steps.push(await step("read + parse the workbook, open the wizard", async () => {
    await page.setInputFiles("#guestFileInput", file);
    await page.waitForFunction(() => document.getElementById("excelDialog").open && !!document.querySelector("[data-wizard-next]"), null, { timeout: 600000 });
  }, probe));
  for (let i = 0; i < 3; i++) steps.push(await step(`wizard step ${i + 2} → ${i + 3}`, async () => {
    const before = await page.evaluate(() => document.querySelector("#excelDialog").innerHTML.length);
    await page.click("[data-wizard-next]");
    await page.waitForFunction((b) => document.querySelector("#excelDialog").innerHTML.length !== b, before, { timeout: 600000 }).catch(() => {});
  }, probe));
  steps.push(await step("import → guests on screen", async () => {
    await page.click("[data-wizard-import]");
    await page.waitForFunction((n) => activeEvent().guests.length >= n, ROWS, { timeout: 600000 });
  }, probe));
  const imported = await page.evaluate(() => ({ records: activeEvent().guests.length, pax: activeEvent().guests.reduce((s, g) => s + g.pax, 0) }));
  steps.push(await step("saved to disk (the stored record holds every guest)", async () => {
    for (let i = 0; i < 1200; i++) {
      const rec = await readRecord(page, "root");
      if (rec && rec.includes(`Misafir ${String(ROWS).padStart(5, "0")}`)) return;
      await page.waitForTimeout(250);
    }
    throw new Error("never saved");
  }, probe));
  const heap1 = await probe.heapMB();
  for (const [label, fn] of [
    ["guests screen render", () => { ui.tab = "guests"; ui.guestQuery = ""; render(); }],
    ["guests search keystroke", () => { ui.guestQuery = "Misafir 4999"; render(); }],
    ["seating render", () => { ui.tab = "seating"; render(); }],
    ["live render", () => { ui.tab = "live"; ui.liveQuery = ""; render(); }],
    ["command center render", () => { ui.tab = "command"; render(); }],
    ["reports render", () => { ui.tab = "reports"; render(); }],
  ]) {
    steps.push(await step(label, () => page.evaluate(`(${fn.toString()})(); void document.body.offsetHeight;`), probe));
  }
  steps.push(await step("workbook exported (TABLE PLAN, GUEST LIST, UNASSIGNED)", () => page.evaluate(async () => { await exportTablePlanXLSX(); }), probe).catch((e) => ({ label: "workbook export", error: String(e).slice(0, 120) })));
  steps.push(await step("reload → event restored", async () => {
    await page.reload();
    await page.waitForFunction((n) => { try { return state.events[0] && state.events[0].guests.length >= n; } catch { return false; } }, ROWS, { timeout: 600000 });
  }, probe));
  const heap2 = await probe.heapMB();
  out.xlsx = { rows: ROWS, fileBytes: bytes, imported, steps, heapMB: { emptyEvent: heap0, afterImport: heap1, afterReload: heap2 } };
  await page.close();
}

// --- B. a 40-page PDF plan --------------------------------------------------
if (!ONLY || ONLY === "pdf") {
  const gen = await browser.newPage();
  const pagesHtml = Array.from({ length: PAGES }, (_, p) => {
    let svg = `<rect x="460" y="20" width="260" height="60" fill="none" stroke="#222" stroke-width="2"/><text x="590" y="58" font-size="22" text-anchor="middle">SAHNE ${p + 1}</text>`;
    for (let i = 0; i < 48; i++) {
      const x = 90 + (i % 8) * 140, y = 150 + Math.floor(i / 8) * 110;
      svg += `<circle cx="${x}" cy="${y}" r="34" fill="none" stroke="#222" stroke-width="2"/><text x="${x}" y="${y + 7}" font-size="20" text-anchor="middle">${p * 48 + i + 1}</text>`;
    }
    return `<section style="page-break-after:always;height:100vh"><svg viewBox="0 0 1180 820" width="100%" height="100%">${svg}</svg></section>`;
  }).join("");
  await gen.setContent(`<html><body style="margin:0">${pagesHtml}</body></html>`);
  const file = path.join(TMP, `plan-${PAGES}p.pdf`);
  await gen.pdf({ path: file, format: "A3", landscape: true, printBackground: true });
  await gen.close();
  const bytes = fs.statSync(file).size;

  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const probe = await instrument(page);
  await openApp(page, app.baseUrl, { lang: "tr" });
  await page.evaluate(() => { ui.screen = "events"; render(); });
  await click(page, '.appbar [data-action="create-event"]');
  await page.fill('input[name="name"]', "PDF Gecesi"); await page.fill('input[name="hotel"]', "Merit"); await page.fill('input[name="date"]', futureDate());
  const heap0 = await probe.heapMB();
  const steps = [];
  steps.push(await step(`open the ${PAGES}-page PDF → page 1 shown`, async () => {
    await page.setInputFiles("#v8PlanFile", file);
    await page.waitForFunction(() => document.querySelectorAll("[data-pdf-thumb]").length > 0 && !document.querySelector('[data-setup="create"][disabled]'), null, { timeout: 600000 });
  }, probe));
  steps.push(await step(`all ${PAGES} page thumbnails drawn`, async () => {
    await page.waitForFunction((n) => document.querySelectorAll('[data-pdf-thumb][data-thumb-state="done"],[data-pdf-thumb][data-thumb-state="failed"]').length >= n, PAGES, { timeout: 600000 });
  }, probe));
  const thumbs = await page.evaluate(() => ({ done: document.querySelectorAll('[data-thumb-state="done"]').length, failed: document.querySelectorAll('[data-thumb-state="failed"]').length }));
  steps.push(await step(`choose page ${PAGES}`, async () => {
    await page.click(`[data-pdf-page="${PAGES - 1}"]`);
    await page.waitForFunction((i) => !!document.querySelector(`[data-pdf-page="${i}"].active`) && !document.querySelector('[data-setup="create"][disabled]'), PAGES - 1, { timeout: 600000 });
  }, probe));
  steps.push(await step("create the event with that page as its plan", async () => {
    await page.click('[data-setup="create"]');
    await page.waitForFunction(() => { try { return ui.screen === "workspace" && !!activeEvent().background.src; } catch { return false; } }, null, { timeout: 600000 });
  }, probe));
  const chosen = await page.evaluate(() => activeEvent().background.name);
  const heap1 = await probe.heapMB();
  out.pdf = { pages: PAGES, fileBytes: bytes, thumbs, chosen, steps, heapMB: { setupOpen: heap0, afterCreate: heap1 } };
  await page.close();
}

for (const [k, v] of Object.entries(out)) {
  console.log(`\n=== ${k === "xlsx" ? `${v.rows.toLocaleString("en")}-row guest workbook (${(v.fileBytes / 1048576).toFixed(1)} MB)` : `${v.pages}-page PDF plan (${(v.fileBytes / 1048576).toFixed(1)} MB)`} ===`);
  for (const s of v.steps) console.log("  " + s.label.padEnd(52) + (s.error ? `ERROR ${s.error}` : `${String(s.ms).padStart(7)} ms   longest block ${String(s.longestBlock).padStart(6)} ms`));
  console.log("  heap (MB, after GC):", JSON.stringify(v.heapMB));
  if (v.imported) console.log("  imported:", JSON.stringify(v.imported));
  if (v.thumbs) console.log("  thumbnails:", JSON.stringify(v.thumbs), "plan:", v.chosen);
}
console.log("ERRORS:", errs.length ? JSON.stringify(errs.slice(0, 3)) : "clean");
console.log("JSON " + JSON.stringify(out));

// What an operator depends on, asserted: every row became one record, every
// page of the PDF could be chosen, and no step failed.
const failures = [];
if (out.xlsx && out.xlsx.imported.records !== ROWS) failures.push(`imported ${out.xlsx.imported.records} records from ${ROWS} rows`);
if (out.pdf && out.pdf.thumbs.done !== PAGES) failures.push(`${out.pdf.thumbs.done} of ${PAGES} page thumbnails drawn`);
if (out.pdf && !new RegExp(`page ${PAGES}$`).test(out.pdf.chosen || "")) failures.push(`the chosen page did not become the plan (${out.pdf.chosen})`);
for (const v of Object.values(out)) for (const s of v.steps) if (s.error) failures.push(`${s.label}: ${s.error}`);
failures.forEach((f) => console.log("FAIL:", f));

// Budgets (BUDGETS.json → largeFiles) hold at the default sizes only; a run
// at other sizes is a measurement.
const IDS = { xlsx: ["parse", "step2to3", "step3to4", "step4to5", "import", "save", "guestsRender", "guestsSearch", "seatingRender", "liveRender", "commandRender", "reportsRender", "export", "reload"],
  pdf: ["pdfOpen", "pdfThumbs", "pdfChoose", "pdfCreate"] };
let over = [];
if (ROWS === 50000 && PAGES === 40 && !ONLY) {
  const B = BUDGETS.largeFiles, rows = [];
  for (const kind of ["xlsx", "pdf"]) {
    if (out[kind].steps.length !== IDS[kind].length) failures.push(`${kind}: ${out[kind].steps.length} steps measured, ${IDS[kind].length} budgeted`);
    out[kind].steps.forEach((st, i) => rows.push([IDS[kind][i], st.error ? NaN : st.ms, B.steps[IDS[kind][i]].budgetMs]));
  }
  rows.push(["heap after import", out.xlsx.heapMB.afterImport, B.heapAfterImportMB.budget, "MB"]);
  over = judge("50,000-row workbook, 40-page PDF", rows);
}
await browser.close();
await app.close();
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(errs.length || failures.length || over.length ? 1 : 0);
