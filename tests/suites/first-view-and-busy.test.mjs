// EVERY TABLE IS ON SCREEN WHEN A CANVAS FIRST SHOWS IT, FIT REACHES EVERY
// OBJECT, AND LONG WORK SAYS SO BEFORE IT BLOCKS.
//
// Measured before this suite (§25 entry Z; benchmarks/perf/large-files.mjs):
//   - "Add Manually" with 24 tables used two columns whatever the quantity:
//     12 rows running to y≈1,950 in a 788-high room, so Seating opened with
//     most tables off-screen, and Fit fitted the ROOM, not the tables, so it
//     did not bring them back either;
//   - reading an 11.8 MB guest workbook blocked the page for 1.2 s and
//     writing a 50,000-guest workbook for ~5 s with nothing on screen saying
//     so, and the export could be pressed again meanwhile.
// And the error half of each: a file that cannot be read leaves the control
// usable again, with a message.
import { openApp, createBlankEvent, addTables, futureDate, settle, click } from "../lib/app-actions.mjs";

export const meta = { name: "first-view-and-busy", tags: ["ui", "floor-plan", "fast"], timeout: 200000 };

const tablesInView = (page) => page.evaluate(() => {
  const v = document.getElementById("canvasViewport").getBoundingClientRect();
  const els = [...document.querySelectorAll('#canvasWorld [data-object-kind="table"]')];
  const out = els.filter((el) => { const r = el.getBoundingClientRect(); return r.left < v.left - 1 || r.top < v.top - 1 || r.right > v.right + 1 || r.bottom > v.bottom + 1; });
  return { tables: els.length, outside: out.length };
});

export default async function run({ page, checks, baseUrl }) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, baseUrl, { lang: "en" });

  // --- 1. a small grid is placed exactly as before -------------------------
  await createBlankEvent(page, { name: "Small Grid", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 4 });
  checks.equal(await page.evaluate(() => activeEvent().tables.map((t) => [t.x, t.y])), [[440, 270], [630, 270], [440, 415], [630, 415]],
    "four tables land where they always did (a grid that fits the room is untouched)");
  const fitSame = await page.evaluate(() => {
    const v = document.getElementById("canvasViewport"), old = Math.max(.2, Math.min((v.clientWidth - 42) / 1355, (v.clientHeight - 42) / 788));
    fitCanvas(); return Math.abs(ui.zoom - old) < 1e-9;
  });
  checks.ok(fitSame, "Fit on a plan whose objects lie inside the room gives exactly the old view");

  // --- 2. 24 tables through Add Manually ------------------------------------
  await page.evaluate(() => { ui.screen = "events"; render(); });
  await createBlankEvent(page, { name: "Bulk Night", hotel: "Merit", date: futureDate() });
  await click(page, ".planmap-fab");
  await page.waitForSelector('[data-v8-action="commit-add"]');
  await page.fill('[data-bulk="quantity"]', "24");
  await page.waitForTimeout(200);
  checks.equal(await page.inputValue('[data-bulk="cols"]'), "7", "the column field shows the layout the preview will commit (7 columns for 24 tables)");
  await click(page, '[data-v8-action="commit-add"]');
  await page.waitForFunction(() => activeEvent().tables.length === 24);
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => { const ts = activeEvent().tables; return { maxRight: Math.max(...ts.map((t) => t.x + t.w)), maxBottom: Math.max(...ts.map((t) => t.y + t.h)) }; });
  checks.ok(box.maxRight <= 1355 && box.maxBottom <= 788, "all 24 tables are placed inside the room", box);
  checks.equal(await tablesInView(page), { tables: 24, outside: 0 }, "FLOOR PLAN: every new table is on screen after adding");
  await page.evaluate(() => { ui.tab = "seating"; render(); });
  await settle(page); await page.waitForTimeout(200);
  checks.equal(await tablesInView(page), { tables: 24, outside: 0 }, "SEATING opens with every table on screen");

  // --- 2b. an event saved before this fix, tables already past the room ------
  // (the old two-column layout), opened in Seating for the first time
  await page.evaluate(() => { ui.screen = "events"; render(); });
  await createBlankEvent(page, { name: "Old Grid", hotel: "Merit", date: futureDate() });
  await page.evaluate(() => {
    const e = activeEvent();
    for (let i = 0; i < 24; i++) e.tables.push({ id: "old" + i, number: "T" + String(i + 1).padStart(2, "0"), type: "round", x: 440 + (i % 2) * 190, y: 270 + Math.floor(i / 2) * 145,
      w: 120, h: 82, capacity: 8, zone: "MAIN FLOOR", rotation: 0, locked: false, z: 10, hasPhysicalSeats: false, chairs: [], origin: "MANUAL" });
    touchEvent(e); ui.zoom = .72; ui.pan = { x: 28, y: 24 }; ui.tab = "seating"; render();
  });
  await settle(page); await page.waitForTimeout(300);
  checks.equal(await tablesInView(page), { tables: 24, outside: 0 }, "an older event whose tables run past the room opens in Seating with every table on screen");
  await page.evaluate(() => { ui.activeEventId = state.events.find((e) => e.name === "Bulk Night").id; ui.tab = "floor"; render(); });
  await settle(page);

  // --- 3. a column count the operator types is kept, and Fit still reaches all
  await page.evaluate(() => { ui.tab = "floor"; render(); });
  await settle(page);
  await click(page, ".planmap-fab");
  await page.waitForSelector('[data-v8-action="commit-add"]');
  await page.fill('[data-bulk="cols"]', "2");
  await page.fill('[data-bulk="quantity"]', "12");
  await page.fill('[data-bulk="prefix"]', "B");
  await page.waitForTimeout(200);
  await click(page, '[data-v8-action="commit-add"]');
  await page.waitForFunction(() => activeEvent().tables.length === 36);
  await page.waitForTimeout(300);
  const typed = await page.evaluate(() => [...new Set(activeEvent().tables.filter((t) => /^B/.test(t.number)).map((t) => t.x))].length);
  checks.equal(typed, 2, "a column count the operator typed is honoured exactly (2 columns)");
  await page.evaluate(() => { ui.zoom = 1.6; ui.pan = { x: 0, y: 0 }; applyCanvasTransform(); });
  await click(page, '[data-canvas-action="fit"]');
  await page.waitForTimeout(200);
  checks.equal((await tablesInView(page)).outside, 0, "Fit brings every table on screen, including ones beyond the room's edge");
  // the operator's own view is not refitted behind their back
  await page.evaluate(() => { ui.zoom = 1.6; ui.pan = { x: 0, y: 0 }; applyCanvasTransform(); ui.tab = "seating"; render(); ui.tab = "floor"; render(); });
  await page.waitForTimeout(300);
  checks.equal(await page.evaluate(() => ui.zoom), 1.6, "a view the operator chose is kept when they come back to the canvas");

  // --- 4. reading a guest file says so, and a bad file leaves the wizard usable
  await page.evaluate(() => { ui.tab = "guests"; render(); });
  await settle(page);
  await page.evaluate(() => { const orig = File.prototype.text; File.prototype.text = function () { return new Promise((r) => setTimeout(() => r(orig.call(this)), 900)); }; });
  await click(page, "[data-guest-command='import']");
  await page.setInputFiles("#guestFileInput", { name: "slow.csv", mimeType: "text/csv", buffer: Buffer.from("NAME SURNAME,ADDITIONAL GUESTS\nAyşe Demir,0\n") });
  const reading = await page.waitForSelector('.wz-reading[role="status"]', { timeout: 800 }).then((el) => el.textContent()).catch(() => null);
  checks.ok(/Reading slow\.csv/.test(reading || ""), "while a guest file is read, the wizard names the file it is reading", reading);
  await page.waitForSelector("[data-wizard-next]");
  checks.equal(await page.locator(".wz-reading").count(), 0, "and the reading notice is gone once the rows are shown");
  await page.evaluate(() => { document.getElementById("excelDialog").close(); pendingImport = null; });
  await click(page, "[data-guest-command='import']");
  await page.setInputFiles("#guestFileInput", { name: "broken.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("not a workbook at all") });
  await page.waitForTimeout(600);
  const afterBad = await page.evaluate(() => ({
    reading: !!document.querySelector(".wz-reading"),
    choose: !!document.querySelector("[data-wizard-choose]:not([disabled])"),
    error: [...document.querySelectorAll(".toast")].some((x) => /error/.test(x.className)),
  }));
  checks.equal(afterBad, { reading: false, choose: true, error: true }, "a file that cannot be read: a message, and the wizard ready for another file");
  await page.evaluate(() => { document.getElementById("excelDialog").close(); pendingImport = null; });

  // --- 5. writing the workbook says so, and cannot be pressed twice ---------
  await page.evaluate(() => { ui.tab = "reports"; render(); });
  await settle(page);
  await page.evaluate(async () => { await loadXLSX(); const w = XLSX.writeFile; XLSX.writeFile = function (...a) { const t0 = performance.now(); while (performance.now() - t0 < 700); return w.apply(this, a); }; });
  const download = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await page.click("[data-report='xlsx']");
  const busy = await page.evaluate(() => { const b = document.querySelector("[data-report='xlsx']"); return { busy: b.getAttribute("aria-busy"), disabled: b.disabled, label: b.textContent.trim() }; });
  checks.equal(busy, { busy: "true", disabled: true, label: "Preparing workbook…" }, "the export control says the workbook is being prepared, and is disabled, before the work blocks");
  checks.ok(!!(await download), "the workbook still downloads");
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => { const b = document.querySelector("[data-report='xlsx']"); return { busy: b.getAttribute("aria-busy"), disabled: b.disabled }; });
  checks.equal(after, { busy: null, disabled: false }, "and the control is usable again afterwards");

  // --- 6a. toasts on a canvas: a free corner when there is one ---------------
  // Bottom-left is the usual corner; with a table there, the stack moves.
  const LONG = "Table T12 has 3 available chairs; the selected group needs 6. No assignments changed.";
  await page.evaluate(() => { const e = state.events.find((x) => x.name === "Small Grid"); ui.activeEventId = e.id; ui.screen = "workspace"; ui.tab = "floor";
    e.tables[0].x = 40; e.tables[0].y = 680; render(); fitCanvas(); });
  await settle(page);
  const moved = await page.evaluate((LONG) => {
    document.querySelectorAll(".toast").forEach((n) => n.remove());
    toast(LONG, "error", 60000); toast(LONG + " Again.", "success", 60000); toast(LONG + " Once more.", "info", 60000);
    const host = document.getElementById("toastWrap"), w = host.getBoundingClientRect();
    const under = [...document.querySelectorAll('[role=button],button')].filter((n) => !n.closest(".toast-wrap")).filter((n) => { const r = n.getBoundingClientRect(); return r.width && !(r.right <= w.left || r.left >= w.right || r.bottom <= w.top || r.top >= w.bottom); });
    const out = { corner: host.dataset.corner, covered: under.length, passThrough: host.classList.contains("pass-through") };
    document.querySelectorAll(".toast").forEach((n) => n.remove());
    return out;
  }, LONG);
  checks.ok(moved.corner !== "bl" && moved.covered === 0 && !moved.passThrough, "a table in the bottom-left corner: the toast stack moves to a corner that covers nothing", moved);

  // --- 6b. a room that fills the window: presses reach the table under it ---
  await page.evaluate(() => { ui.screen = "events"; render(); });
  await createBlankEvent(page, { name: "Full Room", hotel: "Merit", date: futureDate() });
  await page.evaluate(() => { ui.bulkDraft = null; });   // section 3's typed "2 columns" is kept for the session
  await addTables(page, { quantity: 35 });
  await page.evaluate(() => { ui.tab = "floor"; ui.selectedObjectId = null; ui.selectedObjectIds = []; render(); fitCanvas(); });
  await settle(page);
  const full = await page.evaluate((LONG) => {
    toast(LONG, "error", 60000); toast(LONG + " Again.", "success", 60000);
    const el = document.createElement("div"); el.className = "toast has-action info";
    const b = document.createElement("button"); b.type = "button"; b.className = "toast-action"; b.textContent = "Undo"; b.onclick = () => { window.__undone = true; };
    el.append("Removed.", b); pushToast(el, { duration: 60000 });
    const host = document.getElementById("toastWrap"), w = host.getBoundingClientRect();
    const t = [...document.querySelectorAll('#canvasWorld [data-object-kind="table"]')].find((n) => { const r = n.getBoundingClientRect(); return r.left < w.right - 4 && r.right > w.left + 4 && r.top < w.bottom - 4 && r.bottom > w.top + 4; });
    if (!t) return { passThrough: host.classList.contains("pass-through"), table: null, corner: host.dataset.corner, zoom: ui.zoom };
    const r = t.getBoundingClientRect(), x = (Math.max(r.left, w.left) + Math.min(r.right, w.right)) / 2, y = (Math.max(r.top, w.top) + Math.min(r.bottom, w.bottom)) / 2;
    const u = b.getBoundingClientRect();
    return { passThrough: host.classList.contains("pass-through"), table: t.dataset.objectId, x, y, undo: { x: u.left + u.width / 2, y: u.top + u.height / 2 } };
  }, LONG);
  checks.ok(full.passThrough && !!full.table, "a room that fills the window (35 tables) leaves no free corner: the stack lets presses through", full);
  if (full.table) {
    await page.mouse.click(full.x, full.y);
    await page.waitForTimeout(200);
    checks.equal(await page.evaluate(() => ui.selectedObjectId), full.table, "a table under the toast stack can still be pressed (the stack lets presses through)");
    await page.evaluate(() => { const b = document.querySelector("#toastWrap .toast-action"); if (b) { const r = b.getBoundingClientRect(); window.__undoAt = [r.left + r.width / 2, r.top + r.height / 2]; } });
    const at = await page.evaluate(() => window.__undoAt);
    await page.mouse.click(at[0], at[1]);
    checks.ok(await page.evaluate(() => window.__undone === true), "and the stack's own Undo is still pressable");
  } else {
    checks.ok(!full.passThrough, "no table under the stack, so nothing to press through", full);
  }
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((n) => n.remove()));

  // --- 6. a PDF that cannot be read: a message, and setup usable again -------
  await page.evaluate(() => { ui.screen = "events"; render(); });
  await click(page, '.appbar [data-action="create-event"]');
  await page.setInputFiles("#v8PlanFile", { name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nthis is not a pdf body") });
  await page.waitForFunction(() => !ui.setupBusy, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const pdfBad = await page.evaluate(() => ({
    create: !!document.querySelector('[data-setup="create"]:not([disabled])'),
    error: [...document.querySelectorAll(".toast")].some((x) => /error/.test(x.className)),
  }));
  checks.equal(pdfBad, { create: true, error: true }, "a PDF that cannot be read: a message, and the setup screen usable again");
}
