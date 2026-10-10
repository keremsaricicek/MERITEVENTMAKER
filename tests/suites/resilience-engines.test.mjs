// WHEN AN ENGINE DOES NOT LOAD, THE OPERATOR IS TOLD AND NOTHING IS HALF-DONE.
//
// The served build loads three engines from a CDN: SheetJS (workbooks),
// PDF.js (PDF plans) and Tesseract (OCR). Storage, imports, detection and
// render failures each have fault-injection suites; until 2026-10-04 no suite
// made an ENGINE fail, though a venue network that blocks the CDN does exactly
// that. Each case here blocks one engine for one page and holds DETECT /
// CONTAIN / INFORM / PRESERVE:
//   OCR missing  → Assisted Detection still runs on geometry, says OCR was
//                  unavailable and why, and invents no printed numbers;
//   SheetJS      → the export says it could not make the workbook, downloads
//                  nothing, and the control is usable again; a workbook import
//                  is refused with a message and the wizard stays usable;
//   PDF.js       → choosing a PDF plan says it could not be read, and the
//                  setup screen is usable again.
import fs from "node:fs";
import path from "node:path";
import { routeVendorFromCache } from "../lib/vendor.mjs";
import { openApp, createBlankEvent, addTables, futureDate, settle, click } from "../lib/app-actions.mjs";

export const meta = { name: "resilience-engines", tags: ["resilience", "fast"], timeout: 240000 };

async function pageWithout(context, baseUrl, pattern) {
  const p = await context.newPage();
  await routeVendorFromCache(p);
  await p.route(pattern, (r) => r.abort());      // registered last, so it wins
  const pageErrors = [], consoleErrors = [];
  p.on("pageerror", (e) => pageErrors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await openApp(p, baseUrl, { lang: "en" });
  return { p, pageErrors, consoleErrors };
}
const errorToast = (p) => p.evaluate(() => [...document.querySelectorAll(".toast.error")].map((x) => x.textContent.trim()).join(" | "));

export default async function run({ context, baseUrl, checks, repoRoot }) {
  // --- 1. OCR engine missing ------------------------------------------------
  {
    const { p, pageErrors, consoleErrors } = await pageWithout(context, baseUrl, "**/tesseract.js@*/**");
    checks.equal(await p.evaluate(() => typeof Tesseract), "undefined", "OCR: the engine really did not load");
    await createBlankEvent(p, { name: "No OCR", hotel: "Merit", date: futureDate() });
    const plan = fs.readFileSync(path.join(repoRoot, "benchmarks/adversarial/fixtures/a1-chair-under-table.png")).toString("base64");
    await p.evaluate((src) => { const e = activeEvent(); ui.tab = "floor"; e.background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 }; render(); }, "data:image/png;base64," + plan);
    await click(p, '[data-v8-action="detect"]');
    await p.waitForFunction(() => !!activeEvent().analysis && !ui.analysisBusy, null, { timeout: 180000 });
    const a = await p.evaluate(() => { const an = activeEvent().analysis; return { candidates: an.candidates.length, ocr: an.ocr && an.ocr.available, reason: an.ocr && an.ocr.reasonCode,
      printed: an.candidates.filter((c) => c.ocrNumber || c.printedNumber).length, header: document.querySelector(".planintel-title")?.textContent.replace(/\s+/g, " ").trim() || "" }; });
    checks.ok(a.candidates > 0, "OCR: Assisted Detection still runs on the drawing's geometry", a);
    checks.ok(a.ocr === false && !!a.reason, "OCR: the analysis records that OCR was unavailable, with a reason", a);
    checks.equal(a.printed, 0, "OCR: no printed number is invented without the engine that reads them");
    checks.ok(/OCR/i.test(a.header), "OCR: the review screen tells the operator OCR did not run", a.header);
    checks.equal(pageErrors, [], "OCR: no page errors");
    await p.close();
  }

  // --- 2. workbook engine missing ---------------------------------------------
  {
    const { p, pageErrors } = await pageWithout(context, baseUrl, "**/xlsx@*/**");
    checks.equal(await p.evaluate(() => typeof XLSX), "undefined", "WORKBOOK: the engine really did not load");
    await createBlankEvent(p, { name: "No Workbook", hotel: "Merit", date: futureDate() });
    await addTables(p, { quantity: 2 });
    await p.evaluate(() => { ui.tab = "reports"; render(); });
    await settle(p);
    let downloaded = false;
    p.on("download", () => { downloaded = true; });
    await click(p, "[data-report='xlsx']");
    await p.waitForTimeout(600);
    const after = await p.evaluate(() => { const b = document.querySelector("[data-report='xlsx']"); return { disabled: b.disabled, busy: b.getAttribute("aria-busy") }; });
    checks.ok(/workbook|spreadsheet|engine/i.test(await errorToast(p)), "WORKBOOK: the export says the workbook could not be made", await errorToast(p));
    checks.equal({ downloaded, ...after }, { downloaded: false, disabled: false, busy: null }, "WORKBOOK: nothing downloads, and the control is usable again");
    // a workbook import is refused with a message, the wizard still usable
    await p.evaluate(() => { document.querySelectorAll(".toast").forEach((n) => n.remove()); ui.tab = "guests"; render(); });
    await settle(p);
    await click(p, "[data-guest-command='import']");
    await p.setInputFiles("#guestFileInput", { name: "list.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]) });
    await p.waitForTimeout(600);
    const wizard = await p.evaluate(() => ({ choose: !!document.querySelector("[data-wizard-choose]:not([disabled])"), guests: activeEvent().guests.length }));
    checks.ok(!!(await errorToast(p)), "WORKBOOK: an .xlsx guest list is refused with a message", await errorToast(p));
    checks.equal(wizard, { choose: true, guests: 0 }, "WORKBOOK: nothing is imported and the wizard is ready for another file");
    checks.equal(pageErrors, [], "WORKBOOK: no page errors");
    await p.close();
  }

  // --- 3. PDF engine missing ----------------------------------------------------
  {
    const { p, pageErrors } = await pageWithout(context, baseUrl, "**/pdfjs-dist@*/**");
    await p.evaluate(() => { ui.screen = "events"; render(); });
    await click(p, '.appbar [data-action="create-event"]');
    const pdf = fs.readFileSync(path.join(repoRoot, "benchmarks/plans/ORNEK.pdf"));
    await p.setInputFiles("#v8PlanFile", { name: "plan.pdf", mimeType: "application/pdf", buffer: pdf });
    await p.waitForFunction(() => !ui.setupBusy && document.querySelector(".toast.error"), null, { timeout: 30000 }).catch(() => {});
    const setup = await p.evaluate(() => ({ create: !!document.querySelector('[data-setup="create"]:not([disabled])'), plan: !!document.querySelector(".pdf-pages") }));
    checks.ok(/PDF|plan|read/i.test(await errorToast(p)), "PDF: choosing a PDF plan says it could not be read", await errorToast(p));
    checks.equal(setup, { create: true, plan: false }, "PDF: the setup screen is usable again, with no half-loaded plan");
    checks.equal(pageErrors, [], "PDF: no page errors");
    await p.close();
  }
}
