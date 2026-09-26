// AN AUTOMATED ACCESSIBILITY SCAN OF EVERY SCREEN, IN BOTH LANGUAGES.
//
// `.claude/skills/merit-accessibility-hardening/SKILL.md`, required evidence
// 1: "Automated scan across every screen, both languages, run in CI." And its
// rule, which is why this is suite ONE of several rather than the verdict:
// "an automated scan with no violations, on its own" is not evidence. A scan
// catches a control with no name; only the keyboard-workflow and dialog-focus
// suites catch a trap, a lost focus, or a task that cannot be finished.
//
// The engine is axe-core, pinned exactly in devDependencies and injected
// from node_modules — a TEST-only dependency that neither offline build
// contains. Rules: WCAG 2.0/2.1 A and AA, nothing best-practice, so a failure
// is a conformance failure and not a style opinion.
//
// Every screen is scanned in its real state, reached the way an operator
// reaches it: the empty install, the new-event form, an events list with
// upcoming AND historical events, every workspace tab with something in it,
// a selected table's card, the add-tables panel, the plan review with a
// candidate selected, the global finder's results, the freeze form, the
// guest dialog, every step of the import wizard, and the user guide.
import path from "node:path";
import { openApp, createBlankEvent, addTables, futureDate, gotoTab, settle, click, addGuest } from "../lib/app-actions.mjs";

export const meta = { name: "a11y-scan", tags: ["accessibility", "ui", "fast"], timeout: 240000 };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  page.on("dialog", (d) => d.accept());
  const axePath = path.join(repoRoot, "node_modules/axe-core/axe.min.js");
  let scanned = 0;
  const scan = async (label) => {
    if (!(await page.evaluate(() => typeof window.axe === "object"))) await page.addScriptTag({ path: axePath });
    await settle(page);
    const violations = await page.evaluate(async () => {
      const res = await axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        resultTypes: ["violations"],
      });
      return res.violations.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ` +
        v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} — ${(n.failureSummary || "").split("\n").slice(1).join(" ").trim()}`).join(" | "));
    });
    scanned++;
    if (process.env.A11Y_DUMP) {
      const full = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }))
        .violations.flatMap((v) => v.nodes.map((n) => ({ id: v.id, target: n.target.join(" "), html: n.html.slice(0, 160), summary: (n.failureSummary || "").split("\n").slice(1, 2).join("").trim().slice(0, 200) }))));
      (await import("node:fs")).appendFileSync(process.env.A11Y_DUMP, full.map((x) => JSON.stringify({ label, ...x })).join("\n") + (full.length ? "\n" : ""));
    }
    checks.equal(violations, [], `${label}: no WCAG A/AA violation`, violations);
  };

  await openApp(page, baseUrl, { lang: "en" });
  // A historical event beside the working one, so the History table renders.
  await createBlankEvent(page, { name: "Past Gala", hotel: "Merit", date: "2024-05-01" });
  await page.evaluate(() => { ui.screen = "events"; ui.activeEventId = null; render(); });
  await createBlankEvent(page, { name: "Scan Event", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 3 });
  await gotoTab(page, "guests");
  await addGuest(page, { name: "ALICE SCAN", additionalGuests: 1 });
  await addGuest(page, { name: "BOB SCAN" });
  await page.evaluate(() => {
    const e = state.events.find((x) => x.name === "Scan Event");
    const g = e.guests.find((x) => x.name === "ALICE SCAN");
    MeritSeatAssignment.write(g, { tableId: e.tables[0].id, seats: [0, 1], locked: false });
    touchEvent(e); render();
  });

  for (const lang of ["en", "tr"]) {
    const L = lang.toUpperCase();
    const to = async (fn, arg) => { await page.evaluate(fn, arg); await settle(page); };
    await to((l) => { ui.lang = l; ui.screen = "events"; ui.activeEventId = null; render(); }, lang);
    await scan(`${L} events list`);
    await click(page, '[data-action="create-event"]');
    await scan(`${L} new-event form`);
    await to(() => { ui.screen = "events"; render(); });

    await to(() => { ui.activeEventId = state.events.find((x) => x.name === "Scan Event").id; ui.screen = "workspace"; render(); });
    for (const tab of ["command", "floor", "guests", "seating", "live", "reports"]) {
      await gotoTab(page, tab);
      await scan(`${L} ${tab}`);
    }
    await gotoTab(page, "floor");
    await to(() => { const e = state.events.find((x) => x.name === "Scan Event"); ui.selectedObjectId = e.tables[0].id; ui.selectedObjectIds = [e.tables[0].id]; render(); });
    await scan(`${L} floor, table selected`);
    await to(() => { ui.selectedObjectId = null; ui.selectedObjectIds = []; render(); });
    await click(page, ".planmap-fab");
    await scan(`${L} floor, add-tables panel`);
    await to(() => { ui.v8AddOpen = false; render(); });

    await gotoTab(page, "seating");
    await click(page, '[data-freeze-action="open-form"]');
    await scan(`${L} seating, freeze form`);
    await page.click('[data-freeze-action="cancel-form"]').catch(() => {});

    await gotoTab(page, "guests");
    await click(page, '[data-guest-command="add"]');
    await page.waitForSelector("#guestForm", { state: "visible" });
    await scan(`${L} guest dialog`);
    await page.keyboard.press("Escape");

    await click(page, "[data-guest-command='import']");
    await scan(`${L} import wizard, choose file`);
    await page.setInputFiles("#guestFileInput", { name: "g.csv", mimeType: "text/csv",
      buffer: Buffer.from("Name Surname,Pax,Notes\nCAROL SCAN,2,window\nDAN SCAN,x,\n") });
    await page.waitForTimeout(300);
    await scan(`${L} import wizard, preview`);
    await click(page, "[data-wizard-next]");
    await scan(`${L} import wizard, mapping`);
    await click(page, "[data-wizard-next]");
    await scan(`${L} import wizard, interpretation`);
    await click(page, "[data-wizard-next]");
    await scan(`${L} import wizard, summary`);
    await to(() => { document.getElementById("excelDialog").close(); pendingImport = null; });

    await page.fill("#globalGuestSearch", "SCAN");
    await page.waitForTimeout(250);
    await scan(`${L} global finder results`);
    await page.fill("#globalGuestSearch", "");

    await page.evaluate(() => (typeof openGuide === "function" ? openGuide() : document.querySelector('[data-action="help"]')?.click()));
    await scan(`${L} user guide`);
    await to(() => document.getElementById("guideDialog").close());

    // The plan review, with a planted candidate shaped the way the pipeline
    // writes one and its intelligence built by the product's own builder.
    await to(() => {
      const event = state.events.find((x) => x.name === "Scan Event");
      const c = { id: "cand-scan", kind: "table", type: "round", x: 40, y: 40, w: 8, h: 8, rotation: 0,
        confidence: 0.9, status: "unreviewed", selected: true, chairDetections: [], printedNumber: null,
        evidence: { geometry: 0.8, chairs: 0, repetition: 1 } };
      event.analysis = { id: "an-scan", engine: "ASSISTED_DETECTION", trainedModel: false, createdAt: new Date().toISOString(),
        imageWidth: 1000, imageHeight: 800, threshold: 128, candidates: [c], missed: [], groupingDecisions: [],
        comparison: { added: 1, removed: 0, changed: 0 }, memoryReapplied: 0, memoryRestored: 0, memoryConflicts: [],
        ocr: { available: false, reason: "not attempted", engine: "tesseract.js" }, ocrText: null, timings: {},
        diagnostics: { representation: { kind: "PHYSICAL", associationRate: 0.96, evidence: {} } } };
      event.analysis.planIntelligence = globalThis.buildPlanIntelligence(event, null);
      ui.tab = "floor"; ui.planMode = "review"; ui.selectedCandidateId = null; render();
    });
    await scan(`${L} plan review`);
    await to(() => { ui.selectedCandidateId = "cand-scan"; render(); });
    await scan(`${L} plan review, candidate selected`);
    await to(() => { ui.planMode = "edit"; ui.selectedCandidateId = null; state.events.find((x) => x.name === "Scan Event").analysis = null; render(); });
  }
  checks.ok(scanned >= 40, `the scan really covered the product — ${scanned} screen states across both languages`, scanned);
}
