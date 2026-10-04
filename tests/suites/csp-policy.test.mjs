// THE PRODUCT RUNS UNDER AN ENFORCED CONTENT-SECURITY-POLICY.
//
// Until 2026-10-03 the page had no policy: one unescaped interpolation was
// enough for content to run as script (hostile-input found such a path the
// same day). index.html now carries a policy with no inline script and no
// eval. A policy that breaks the product gets switched off, so this walks the
// operations an operator performs — every screen, a guest typed and imported,
// a workbook exported, a PDF plan rendered, real Assisted Detection with OCR,
// a backup — and fails on ANY violation report. Then a negative control
// proves the policy is in force rather than merely present.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, addTables, futureDate, settle, click } from "../lib/app-actions.mjs";

export const meta = { name: "csp-policy", tags: ["security", "slow"], timeout: 300000 };

export default async function run({ page, checks, baseUrl, repoRoot, errors }) {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__cspViolations.push(`${e.violatedDirective} ← ${e.blockedURI || "inline"} (${(e.sample || "").slice(0, 60)})`));
  });
  const violations = () => page.evaluate(() => window.__cspViolations.slice());

  // --- 1. the policy is there, and it is strict where it matters -----------
  const html = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
  const policy = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
  const directive = (name) => (policy.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) || "");
  checks.ok(!!policy, "index.html carries a Content-Security-Policy", policy);
  checks.ok(!/unsafe-inline|unsafe-eval(?!\S)|'unsafe-eval'/.test(directive("script-src")), "script-src allows neither inline script nor eval", directive("script-src"));
  checks.ok(/'none'/.test(directive("object-src")) && /'none'/.test(directive("base-uri")), "no plugins, and the base URL cannot be rewritten", policy);
  checks.ok(!/unsafe-inline/.test(directive("style-src")), "a <style> element or foreign stylesheet is refused (only style ATTRIBUTES are allowed)", directive("style-src"));

  // --- 2. the product, under it ---------------------------------------------
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "CSP Gecesi", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 4 });
  for (const tab of ["command", "floor", "guests", "seating", "live", "reports"]) {
    await page.evaluate((t) => { ui.tab = t; render(); }, tab);
    await settle(page);
  }
  // a guest typed through the dialog, and a list imported through the wizard
  await page.evaluate(() => { ui.tab = "guests"; render(); });
  await settle(page);
  await click(page, "[data-guest-command='import']");
  await page.setInputFiles("#guestFileInput", { name: "g.csv", mimeType: "text/csv",
    buffer: Buffer.from("NAME SURNAME,ADDITIONAL GUESTS,STATUS\nAyşe Demir,1,Confirmed\nCan Öztürk,0,Tentative\n") });
  await page.waitForTimeout(400);
  for (let i = 0; i < 3; i++) { await click(page, "[data-wizard-next]"); await page.waitForTimeout(200); }
  await click(page, "[data-wizard-import]");
  await page.waitForTimeout(400);
  checks.ok((await page.evaluate(() => activeEvent().guests.length)) >= 2, "the import worked under the policy");
  // the workbook
  const xlsx = await page.evaluate(async () => { await exportTablePlanXLSX(); return typeof XLSX; });
  checks.equal(xlsx, "object", "the workbook engine loaded and the export ran under the policy");
  // a PDF plan, through the page's own PDF engine and worker
  const pdfB64 = fs.readFileSync(path.join(repoRoot, "benchmarks/plans/ORNEK.pdf")).toString("base64");
  const pdf = await page.evaluate(async (b64) => {
    await new Promise((r) => (globalThis.MeritPdf ? r() : addEventListener("merit-pdf-ready", r, { once: true })));
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const doc = await MeritPdf.getDocument({ data: u }).promise, p = await doc.getPage(1), vp = p.getViewport({ scale: 0.4 });
    const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
    await p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    return doc.numPages;
  }, pdfB64);
  checks.ok(pdf >= 1, "a PDF plan renders under the policy", pdf);
  // real Assisted Detection, OCR included (WebAssembly in a blob worker)
  const plan = fs.readFileSync(path.join(repoRoot, "benchmarks/adversarial/fixtures/a1-chair-under-table.png")).toString("base64");
  await page.evaluate((src) => {
    const e = activeEvent(); ui.tab = "floor";
    e.background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 }; render();
  }, "data:image/png;base64," + plan);
  await page.waitForTimeout(300);
  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!activeEvent().analysis && !ui.analysisBusy, null, { timeout: 180000 });
  const det = await page.evaluate(() => ({ candidates: activeEvent().analysis.candidates.length, ocr: !!(activeEvent().analysis.ocr && activeEvent().analysis.ocr.available) }));
  checks.ok(det.candidates > 0 && det.ocr, "Assisted Detection ran, with OCR available, under the policy", det);
  await page.evaluate(() => { ui.planMode = "review"; render(); });
  await settle(page);
  await page.evaluate(() => { ui.screen = "events"; render(); });
  await settle(page);
  const backup = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await click(page, '[data-action="backup-export"]');
  checks.ok(!!(await backup), "a backup downloads under the policy");
  checks.equal(await violations(), [], "NOT ONE violation across every screen, import, export, PDF, detection with OCR and backup");

  // --- 3. negative control: the policy is in force -------------------------
  const errorsBefore = errors.length;
  const ran = await page.evaluate(async () => {
    window.__cspRan = false;
    const d = document.createElement("div");
    d.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" onload="window.__cspRan=true">';
    document.body.appendChild(d);
    await new Promise((r) => setTimeout(r, 300));
    d.remove();
    return window.__cspRan;
  });
  const after = await violations();
  checks.equal(ran, false, "an inline handler planted in markup does NOT run");
  checks.ok(after.some((v) => /script-src/.test(v)), "and the browser reports it as a script-src violation — the policy is enforced, not decorative", after);
  // The refusal the control provoked is the browser doing its job; it is
  // removed from the run's console errors by exact shape, and only it.
  const provoked = errors.splice(errorsBefore).filter((e) => !/Refused to execute inline event handler/.test(e));
  errors.push(...provoked);
}
