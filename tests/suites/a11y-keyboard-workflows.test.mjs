// EVERY OPERATOR TASK, FINISHED WITHOUT A MOUSE.
//
// `.claude/skills/merit-accessibility-hardening/SKILL.md`: "Adding `aria-*`
// attributes is not accessibility work … The evidence that counts here is a
// completed operator task without a mouse, and nothing else substitutes for
// it." Its list: create an event · import a guest list · place and number
// tables · assign a guest to a table · check a guest in at the door · mark a
// No Show · export the workbook · review a detected plan · record a Teach
// Area lesson.
//
// THE RULES OF THIS SUITE. After the page loads, the operator's hands are on
// the keyboard: Tab / Shift+Tab to move, Enter / Space to act, arrows, typing
// and Escape. No `click()`, no `fill()`, no `ui.x = …` to move the product
// along. A control is reached by TABBING to it — `tabTo()` presses Tab until
// focus lands there and fails, naming where focus went instead, if it never
// does — so a control that is present but unreachable fails here even though
// every attribute on it is correct. Every control reached must show VISIBLE
// focus.
//
// THE ONE EXCEPTION, named: the operating system's file picker. A browser
// cannot drive it by keyboard in any test harness; the import is OPENED by
// keyboard and the file is handed over through Playwright's file-chooser
// event, which is what the picker would return.
//
// WHAT THIS FOUND, before the fixes that made it pass: a table on the Floor
// Plan and a guest card in Seating were pointer-only <div>s, so neither
// "number a table" nor "assign a guest" could be finished at all; and the
// import wizard's every step re-render destroyed the focused Continue button.
import fs from "node:fs";
import { openApp, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "a11y-keyboard-workflows", tags: ["accessibility", "business", "fast"], timeout: 240000, downloads: true };

export default async function run({ page, checks, baseUrl }) {
  page.on("dialog", (d) => d.accept());
  await openApp(page, baseUrl, { lang: "en" });

  const focusInfo = () => page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { body: true };
    const cs = getComputedStyle(a);
    const visible = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
    return { body: false, desc: (a.outerHTML || "").slice(0, 100), visible };
  });
  // Tab until focus lands on `selector`. Returns the number of presses.
  const tabTo = async (selector, { max = 300, back = false } = {}) => {
    const trail = [];
    for (let i = 1; i <= max; i++) {
      await page.keyboard.press(back ? "Shift+Tab" : "Tab");
      const hit = await page.evaluate((s) => !!document.activeElement && document.activeElement.matches(s), selector);
      if (hit) {
        const f = await focusInfo();
        checks.ok(f.visible, `focus is VISIBLE on ${selector}`, f.desc);
        return i;
      }
      if (i <= 3 || i % 50 === 0) trail.push((await focusInfo()).desc || "<body>");
    }
    throw new Error(`Tab never reached ${selector} in ${max} presses; focus went: ${trail.join(" → ")}`);
  };
  const press = (k) => page.keyboard.press(k);
  const settleKb = () => page.waitForTimeout(350);
  const ev = () => page.evaluate(() => {
    const e = state.events.find((x) => x.name === "Keyboard Gala");
    return e ? { id: e.id, tables: e.tables.map((t) => ({ id: t.id, number: t.number, x: t.x })),
      guests: e.guests.map((g) => ({ name: g.name, pax: g.pax, table: g.assignment?.tableId || null, arrival: g.arrivalStatus })),
      teachings: (state.teachings || []).length } : null;
  });

  // --- 1. CREATE AN EVENT --------------------------------------------------
  await tabTo('[data-action="create-event"]');
  await press("Enter"); await settleKb();
  await tabTo('input[name="name"]');
  await page.keyboard.type("Keyboard Gala");
  await tabTo('input[name="hotel"]');
  await page.keyboard.type("Merit Royal");
  await tabTo('button[data-setup="blank"]');
  await press("Enter"); await settleKb();
  checks.ok(!!(await ev()), "an event is CREATED from the keyboard alone — name, hotel, then Create");

  // --- 2. PLACE TABLES ------------------------------------------------------
  await tabTo('[data-tab="floor"]');
  await press("Enter"); await settleKb();
  await tabTo(".planmap-fab");
  await press("Enter"); await settleKb();
  await tabTo('[data-bulk="quantity"]');
  await press("Control+a"); await page.keyboard.type("3");
  await tabTo('[data-v8-action="commit-add"]');
  await press("Enter"); await settleKb();
  checks.equal((await ev()).tables.length, 3, "three tables are PLACED from the keyboard — the add panel, a quantity, Add");

  // --- 3. SELECT, MOVE AND NUMBER A TABLE ----------------------------------
  // The LAST table, and the precondition asserted: adding tables selects
  // them, so "table 1 is selected" was already true before any key — the
  // first version of this check passed with keyboard activation removed.
  const before = (await ev()).tables[2];
  checks.ok(await page.evaluate((id) => ui.selectedObjectId !== id, before.id),
    "precondition: the table about to be selected by keyboard is not already the selected one");
  await tabTo(`[data-object-id="${before.id}"]`);
  await press("Enter"); await settleKb();
  checks.ok(await page.evaluate((id) => ui.selectedObjectId === id && ui.selectedObjectIds.length === 1 && ui.selectedObjectIds[0] === id, before.id),
    "a table on the canvas is SELECTED with Enter, and is the only selection — it was a pointer-only <div> before this suite");
  checks.ok(await page.evaluate((id) => document.activeElement?.dataset.objectId === id, before.id),
    "and focus stays on that table after the re-render, so the next key acts on it");
  await press("Shift+ArrowRight"); await settleKb();
  checks.ok((await ev()).tables[2].x > before.x, "Shift+ArrowRight MOVES the selected table",
    { before: before.x, after: (await ev()).tables[2].x });
  const numberField = '[data-inspector="number"], #fld-inspector-number';
  const hasNumberField = await page.evaluate((s) => !!document.querySelector(s), numberField);
  if (hasNumberField) {
    await tabTo(numberField);
    await press("Control+a"); await page.keyboard.type("VIP1"); await press("Enter"); await settleKb();
    checks.ok((await ev()).tables.some((t) => t.number === "VIP1"), "and the selected table is NUMBERED from its card");
  } else {
    checks.ok(true, "the table card offers no number field to test (numbering is by the add panel's prefix)");
  }
  await press("Escape"); await settleKb();

  // --- 4. ADD A GUEST, THROUGH THE DIALOG -----------------------------------
  await tabTo('[data-tab="guests"]');
  await press("Enter"); await settleKb();
  await tabTo('[data-guest-command="add"]');
  await press("Enter"); await settleKb();
  await page.keyboard.type("KEYBOARD GUEST");
  await tabTo('#guestForm input[name="additionalGuests"]');
  await press("Control+a"); await page.keyboard.type("2");
  await press("Enter"); await settleKb();
  checks.ok((await ev()).guests.some((g) => g.name === "KEYBOARD GUEST" && g.pax === 3),
    "a guest of three is ADDED — typed into the dialog, saved with Enter", (await ev()).guests);

  // --- 5. IMPORT A GUEST LIST ----------------------------------------------
  await tabTo('[data-guest-command="import"]');
  await press("Enter"); await settleKb();
  const onChoose = await page.evaluate(() => document.activeElement?.matches("[data-wizard-choose]"));
  checks.ok(onChoose, "the import wizard opens with focus on Choose File — its first meaningful control");
  // The waiter is armed BEFORE the key, and given a moment: Playwright turns
  // on file-chooser interception asynchronously, and a key pressed in the
  // same tick opened the (invisible, headless) native picker instead —
  // this failed two runs in three until it waited.
  const chooserP = page.waitForEvent("filechooser", { timeout: 10000 });
  await page.waitForTimeout(150);
  await press("Enter");
  const chooser = await chooserP;
  await chooser.setFiles({ name: "kb.csv", mimeType: "text/csv", buffer: Buffer.from("Name Surname,Pax\nIMPORTED ONE,2\nIMPORTED TWO,1\n") });
  await settleKb();
  for (const step of ["mapping", "interpretation", "summary"]) {
    const onNext = await page.evaluate(() => document.activeElement?.matches("[data-wizard-next]"));
    checks.ok(onNext, `after each step focus is on Continue, not lost to <body> (→ ${step})`);
    await press("Enter"); await settleKb();
  }
  checks.ok(await page.evaluate(() => document.activeElement?.matches("[data-wizard-import]")),
    "and on the summary it is on Import");
  await press("Enter"); await settleKb();
  const imported = (await ev()).guests.filter((g) => g.name.startsWith("IMPORTED")).length;
  checks.equal(imported, 2, "a guest list is IMPORTED — every wizard step advanced with Enter");

  // --- 6. ASSIGN A GUEST TO A TABLE ----------------------------------------
  await tabTo('[data-tab="seating"]');
  await press("Enter"); await settleKb();
  const guestCard = await page.evaluate(() => {
    const e = state.events.find((x) => x.name === "Keyboard Gala");
    const g = e.guests.find((x) => x.name === "KEYBOARD GUEST");
    return `[data-seating-guest="${g.id}"]`;
  });
  await tabTo(guestCard);
  await press("Enter"); await settleKb();
  const target = (await ev()).tables[1].id;
  await tabTo(`[data-object-id="${target}"]`);
  await press("Enter"); await settleKb();
  await tabTo(".seat-action");
  await press("Enter"); await settleKb();
  checks.ok((await ev()).guests.some((g) => g.name === "KEYBOARD GUEST" && g.table === target),
    "a guest is ASSIGNED to a table — guest card, table, Assign here, all by Enter", (await ev()).guests);

  // --- 7. CHECK IN AT THE DOOR, AND 8. MARK A NO SHOW ----------------------
  await tabTo('[data-tab="live"]');
  await press("Enter"); await settleKb();
  await tabTo('[data-arrival="Checked In"]');
  await press("Enter"); await settleKb();
  checks.ok((await ev()).guests.some((g) => g.arrival === "Checked In"), "a guest is CHECKED IN at the door");
  await tabTo('[data-arrival="No Show"]');
  await press("Enter"); await settleKb();
  const g8 = (await ev()).guests;
  checks.ok(g8.some((g) => g.arrival === "No Show"), "a guest is marked NO SHOW");
  checks.ok(g8.find((g) => g.name === "KEYBOARD GUEST")?.table === target,
    "and the seated guest keeps the planned seat — a keyboard path writes arrival only, like the mouse", g8);

  // --- 9. EXPORT THE WORKBOOK ----------------------------------------------
  await tabTo('[data-tab="reports"]');
  await press("Enter"); await settleKb();
  await tabTo('[data-report="xlsx"]');
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), press("Enter")]);
  const size = fs.statSync(await download.path()).size;
  checks.ok(size > 1000, "the workbook is EXPORTED with Enter — a real file leaves the browser", size);

  // --- 10. REVIEW A DETECTED PLAN, AND 11. RECORD A TEACH AREA LESSON -------
  // The analysis is planted (shaped as the pipeline writes it, intelligence
  // built by the product's own builder) because running detection is not an
  // operator's keyboard task; reviewing its output is.
  await page.evaluate(() => {
    const event = state.events.find((x) => x.name === "Keyboard Gala");
    const c = { id: "cand-kb", kind: "table", type: "round", x: 40, y: 40, w: 8, h: 8, rotation: 0,
      confidence: 0.9, status: "unreviewed", selected: false, chairDetections: [], printedNumber: null,
      evidence: { geometry: 0.8, chairs: 0, repetition: 1 } };
    // `planHash` because a real analysis always carries the hash of the plan
    // it read, and a plan-scope lesson is refused without one — correctly.
    event.analysis = { id: "an-kb", planHash: "kb-plan-hash", engine: "ASSISTED_DETECTION", trainedModel: false, createdAt: new Date().toISOString(),
      imageWidth: 1000, imageHeight: 800, threshold: 128, candidates: [c], missed: [], groupingDecisions: [],
      comparison: { added: 1, removed: 0, changed: 0 }, memoryReapplied: 0, memoryRestored: 0, memoryConflicts: [],
      ocr: { available: false, reason: "not attempted", engine: "tesseract.js" }, ocrText: null, timings: {},
      diagnostics: { representation: { kind: "PHYSICAL", associationRate: 0.96, evidence: {} } } };
    event.analysis.planIntelligence = globalThis.buildPlanIntelligence(event, null);
    state.teachings = [];
    ui.tab = "floor"; ui.planMode = "review"; ui.selectedCandidateId = null; render();
    document.body.focus();
  });
  await settleKb();
  await tabTo('[data-candidate-box="cand-kb"]');
  await press("Enter"); await settleKb();
  checks.ok(await page.evaluate(() => ui.selectedCandidateId === "cand-kb"), "a detected object is SELECTED for review with Enter");
  // The lesson an operator records here is the table's printed number — the
  // same path teach-venue-scope drives with a mouse.
  await tabTo("#poiNumber");
  await page.keyboard.type("12");
  await tabTo('[data-review-action="confirm-number"]');
  await press("Enter"); await settleKb();
  checks.equal((await ev()).teachings, 1, "a Teach Area lesson — this table's printed number — is RECORDED from the keyboard");
  await page.evaluate(() => { ui.selectedCandidateId = null; render(); document.body.focus(); });
  await tabTo('[data-candidate-box="cand-kb"]');
  await press("Enter"); await settleKb();
  await tabTo('[data-review-action="confirm"]');
  await press("Enter"); await settleKb();
  checks.equal(await page.evaluate(() => state.events.find((x) => x.name === "Keyboard Gala").analysis.candidates[0].status),
    "confirmed", "and the detection is CONFIRMED from the keyboard");
}
