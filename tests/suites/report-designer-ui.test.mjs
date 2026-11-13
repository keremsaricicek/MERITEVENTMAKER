// REPORT DESIGNER — the screen (Raporlar → Rapor tasarımcısı). What it guards:
//
//   THE PREVIEW IS ALWAYS VISIBLE beside the controls at 1440 px: paged like the
//     paper (one .rd-sheet per printed page, at the paper's millimetre size), one
//     row per guest record, "GUEST OF [PRIMARY]" companion lines when asked.
//   EVERY CONTROL CHANGES THE PREVIEW: kind, filter (a No Show keeps its table),
//     paper size, column order.
//   TEMPLATES are saved per event on this machine (merit.reportTemplates.v2,
//     outside the event), survive a reload, and load back the whole design.
//   OUTPUT: PDF/Print copy the sheets into #printRoot under the print stylesheet
//     (named @page per paper, one sheet per page, zoom 1) — no network, no
//     library; Excel writes its own one-sheet "REPORT" workbook.
//   READ-ONLY: a historical event gets the whole designer and says it is
//     read-only; nothing the designer does changes any event.
import { openApp, createBlankEvent, futureDate, gotoTab, settle } from "../lib/app-actions.mjs";

export const meta = { name: "report-designer-ui", tags: ["business", "reports", "ui", "fast"], timeout: 180000 };

export default async function run({ page, checks, baseUrl }) {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Rapor Galası", date: futureDate() });
  await page.evaluate(() => {
    const table = (id, number, zone) => ({ id, number, zone, shape: "round", capacity: 10, chairs: [], x: 100, y: 100, w: 80, h: 80, rotation: 0 });
    const guest = (id, name, extra, o) => Object.assign({ id, name, additionalGuests: extra, pax: 1 + extra, planningStatus: "Confirmed", vip: "Standard", invitedBy: "", notes: "", phone: "",
      arrivalStatus: "Not Arrived", checkedInAt: null, assignment: null, createdAt: "2026-01-01T00:00:00.000Z" }, o || {});
    const e = activeEvent();
    e.tables.push(table("t1", "T01", "Salon"), table("t2", "T02", "Teras"));
    e.guests.push(guest("g1", "Kerem Sarıçiçek", 2, { vip: "VIP", invitedBy: "Junket A", assignment: { tableId: "t1", seats: [0, 1, 2] } }),
      guest("g2", "Ayşe Demir", 0, { arrivalStatus: "No Show", assignment: { tableId: "t2", seats: [0] } }),
      guest("g3", "Burak Şahin", 0, {}));
    for (let i = 0; i < 70; i++) e.guests.push(guest("m" + i, "Misafir " + String(i).padStart(2, "0"), 0, { invitedBy: "Junket B" }));
    render();
  });
  await settle(page);
  const snapshot = () => page.evaluate(() => JSON.stringify(state.events));
  let before = await snapshot();
  await gotoTab(page, "reports");
  await page.click('[data-reports-view="designer"]');
  await page.waitForSelector(".rd-sheet", { timeout: 10000 });

  // ---- preview beside the controls ----
  const layout = await page.evaluate(() => {
    const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right }; };
    return { pv: r(".rd-preview"), panel: r(".rd-panel"), sheet: r(".rd-sheet"), out: r(".rd-out"), vw: innerWidth, vh: innerHeight };
  });
  checks.ok(layout.pv.r <= layout.panel.x + 1 && layout.pv.w > 600 && layout.panel.r <= layout.vw && layout.pv.y < layout.vh && layout.panel.y < layout.vh,
    "preview and designer side by side at 1440, both on screen", layout);
  checks.ok(layout.sheet.w <= layout.pv.w && layout.sheet.w > 300, "the sheet is scaled to fit the preview column", layout.sheet);
  checks.ok(layout.out.y < layout.vh - 40, "PDF / Print / Excel are visible without scrolling", layout.out);
  const view = () => page.evaluate(() => ({
    sheets: document.querySelectorAll(".rd-preview .rd-sheet").length,
    rows: document.querySelectorAll(".rd-preview tbody tr:not(.rd-grp):not(.rd-comp)").length,
    comps: [...document.querySelectorAll(".rd-preview tr.rd-comp .rd-c-name")].map((x) => x.textContent),
    names: [...document.querySelectorAll(".rd-preview tbody tr:not(.rd-grp):not(.rd-comp) .rd-c-name")].map((x) => x.textContent),
    width: document.querySelector(".rd-sheet").style.width,
    heads: [...document.querySelector(".rd-sheet thead tr").children].map((x) => x.className),
    pageLabel: document.querySelector(".rd-sheet:last-child .rd-sheet-foot span:last-child").textContent,
  }));
  let v = await view();
  checks.equal(v.rows, 73, "one row per guest record (a +2 party is one row)");
  checks.ok(v.sheets >= 2 && v.pageLabel === `Sayfa ${v.sheets} / ${v.sheets}`, "73 records are paged like the paper, each sheet numbered", v.sheets);

  // ---- kind ----
  await page.selectOption("[data-rd-kind]", "tablePlan");
  await page.waitForTimeout(150);
  v = await view();
  checks.equal([v.rows, v.comps], [2, ["GUEST OF KEREM SARIÇIÇEK", "GUEST OF KEREM SARIÇIÇEK"]],
    "table plan: only seated records, the party's two companions as GUEST OF [PRIMARY]");
  await page.selectOption("[data-rd-kind]", "guests");
  await page.selectOption('[data-rd-filter="arrival"]', "No Show");
  await page.waitForTimeout(150);
  v = await view();
  checks.equal(v.names, ["Ayşe Demir"], "the arrival filter narrows the preview");
  checks.equal((await page.textContent(".rd-preview tbody tr .rd-c-table")).replace(/\s/g, ""), "T02", "a No Show keeps its planned table");
  await page.selectOption('[data-rd-filter="arrival"]', "");
  await page.selectOption("[data-rd-paper]", "A3-landscape");
  await page.waitForTimeout(150);
  v = await view();
  checks.equal(v.width, "420mm", "paper A3 landscape: the sheet is 420 mm wide");
  const firstCol = v.heads[0];
  await page.click(`[data-rd-col-down="${firstCol.replace("rd-c-", "")}"]`);
  await page.waitForTimeout(150);
  v = await view();
  checks.equal(v.heads[1], firstCol, "moving a column down moves it in the preview");

  // ---- templates ----
  await page.fill("[data-rd-template-name]", "Kapı listesi");
  await page.click("[data-rd-save]");
  await page.waitForTimeout(150);
  const stored = await page.evaluate(() => { const all = JSON.parse(localStorage.getItem("merit.reportTemplates.v2") || "{}"); return { ids: Object.keys(all), first: (all[activeEvent().id] || [])[0] }; });
  checks.ok(stored.first && stored.first.name === "Kapı listesi" && stored.first.paper === "A3-landscape", "the template is kept per event id on this machine", stored);
  await page.selectOption("[data-rd-kind]", "vip");
  await page.selectOption("[data-rd-paper]", "A4-portrait");
  const eventId = await page.evaluate(() => activeEvent().id);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => { try { return Array.isArray(state.events); } catch { return false; } });
  await page.evaluate((id) => { openEvent(id); ui.reportsView = "designer"; }, eventId);
  await page.waitForTimeout(300);
  await gotoTab(page, "reports");
  await page.waitForSelector("[data-rd-load]", { timeout: 10000 });
  before = await snapshot(); // a reload re-runs the storage migration; the designer is measured from here
  const idx = await page.evaluate(() => [...document.querySelectorAll("[data-rd-load] option")].findIndex((o) => o.textContent === "Kapı listesi") - 1);
  await page.selectOption("[data-rd-load]", String(idx));
  await page.waitForTimeout(150);
  v = await view();
  checks.ok(idx >= 0 && v.width === "420mm" && v.heads[1] === firstCol && v.rows === 73, "after a reload the template loads back paper, column order and kind", { idx, v: v.width });

  // ---- output: print stylesheet, PDF, Excel ----
  const css = await page.evaluate(() => {
    const out = { pages: [], printSheet: false };
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r.type === CSSRule.PAGE_RULE || r.constructor.name === "CSSPageRule") out.pages.push(r.selectorText);
        if (r.media && [...r.media].includes("print") && /printing-designer[^{]*rd-sheet/.test(r.cssText)) out.printSheet = true;
      } }
    return out;
  });
  checks.ok(css.printSheet && ["rdA4p", "rdA4l", "rdA3p", "rdA3l"].every((n) => css.pages.includes(n)), "the print stylesheet gives each sheet its own page at every paper size", css);
  await page.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = { cls: document.body.className, sheets: document.querySelectorAll("#printRoot .rd-sheet").length, title: document.title }; }; });
  await page.click("[data-rd-pdf]");
  const printed = await page.evaluate(() => window.__printed);
  const shown = await page.evaluate(() => document.querySelectorAll(".rd-preview .rd-sheet").length);
  checks.ok(printed && /printing-designer/.test(printed.cls) && printed.sheets === shown && /Rapor Galası/.test(printed.title),
    "PDF prints exactly the previewed sheets through the browser (file named after the event)", { printed, shown });
  await page.emulateMedia({ media: "print" });
  const pr = await page.evaluate(() => { const s = getComputedStyle(document.querySelector("#printRoot .rd-sheet")); return { app: getComputedStyle(document.querySelector(".app")).display, zoom: s.zoom, brk: s.breakAfter }; });
  await page.emulateMedia({ media: "screen" });
  checks.ok(pr.app === "none" && String(pr.zoom) === "1" && pr.brk === "page", "in print the app is hidden and each sheet is one full-size page", pr);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.evaluate(() => { window.__xlsx = null; const X = window.XLSX, w = X.writeFile; X.writeFile = (wb, name) => { window.__xlsx = { name, sheets: wb.SheetNames, a1: wb.Sheets[wb.SheetNames[0]].A1 && wb.Sheets[wb.SheetNames[0]].A1.v }; X.writeFile = w; }; });
  await page.click("[data-rd-xlsx]");
  const xl = await page.evaluate(() => window.__xlsx);
  checks.ok(xl && xl.sheets.join() === "REPORT" && /\.xlsx$/.test(xl.name) && xl.a1, "Excel writes its own one-sheet REPORT workbook", xl);
  checks.ok(await page.$('.rd-panel [data-report="xlsx"]'), "the one-click table-plan workbook stays reachable from the designer");

  // ---- historical: read-only, still everything ----
  await page.evaluate(() => {
    const past = JSON.parse(JSON.stringify(activeEvent()));
    Object.assign(past, { id: "past-rd", name: "Geçen Yıl", date: "2025-03-15", status: "Completed" });
    state.events.push(past); ui.activeEventId = "past-rd"; render();
  });
  await settle(page);
  const pastBefore = await snapshot();
  await page.waitForSelector(".rd-readonly", { timeout: 5000 });
  checks.ok(await page.$(".rd-preview .rd-sheet"), "a historical event gets the preview and says it is read-only");
  await page.fill("[data-rd-template-name]", "Arşiv");
  await page.click("[data-rd-save]");
  await page.waitForTimeout(150);
  const pastTpl = await page.evaluate(() => (JSON.parse(localStorage.getItem("merit.reportTemplates.v2") || "{}")["past-rd"] || []).map((x) => x.name));
  checks.equal(pastTpl, ["Arşiv"], "a template for a historical event is kept outside the event");
  checks.equal(await snapshot(), pastBefore, "nothing in the designer changed a historical event");
  await page.evaluate(() => { state.events = state.events.filter((e) => e.id !== "past-rd"); ui.activeEventId = state.events[0].id; render(); });
  checks.equal(await snapshot(), before, "nothing in the designer changed the event");
  checks.equal(pageErrors, [], "no page errors");
}
