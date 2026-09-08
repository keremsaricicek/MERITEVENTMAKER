// Confirming a table's number, and the scope that unlocks.
//
// The Teach Area has supported a `tableNumber` subject since it was built, and
// the apply layer has written the result since then too. Nothing ever offered
// it, so the strongest evidence the product recognises — a person standing
// behind a number — was unreachable.
//
// Two rules are load-bearing here and both are about honesty rather than
// features:
//
//   A number a PERSON confirmed is not the same fact as a number two crops
//   agreed on, and the inspector must let an operator tell them apart. The
//   difference decides whether a lesson may reach across a whole venue.
//
//   A scope the Teach Area would refuse is disabled BEFORE the click, with the
//   reason next to it. It used to refuse after: the operator chose, pressed,
//   and was told no.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent, importPlan, runDetection, ocrAvailability } from "../lib/app-actions.mjs";

export const meta = { name: "teach-number", tags: ["business", "fast"], timeout: 180000 };

// The REAL committed plan, for the reason given in app-actions.mjs.

// Select a table candidate in review mode through the app's own state, then let
// render() put the inspector on screen.
const SELECT_TABLE = `(function(){
  const alive = state.events[0].analysis.candidates.filter(c => c.kind === "table" && c.status !== "rejected");
  // Prefer one nobody has confirmed a number for: that is the state the
  // venue-scope rule is about. Where OCR ran for real, some tables may already
  // carry a verified number, and starting from one of those would test nothing.
  const t = alive.find(c => !(c.printedNumber && c.printedNumber.state === "VERIFIED")) || alive[0];
  if (!t) return null;
  ui.tab = "floor"; ui.planMode = "review"; ui.reviewCenterOpen = false;
  ui.selectedCandidateId = t.id; render();
  return t.id;
})()`;

// Re-select the SAME table. `SELECT_TABLE` deliberately prefers an unconfirmed
// one, so reusing it after a confirmation would silently move to a different
// table and test nothing.
const selectById = (page, id) => page.evaluate(tid => {
  ui.tab = "floor"; ui.planMode = "review"; ui.reviewCenterOpen = false;
  ui.selectedCandidateId = tid; render();
}, id);

const PANEL = `(function(){
  const sel = document.querySelector("[data-teach-scope]");
  return {
    numberPanel: !!document.querySelector(".poi-number"),
    input: document.getElementById("poiNumber")?.value ?? null,
    stateLine: document.querySelector(".poi-number-state")?.textContent.trim() || null,
    confirmButton: !!document.querySelector('[data-review-action="confirm-number"]'),
    scopes: sel ? [...sel.options].map(o => ({ v: o.value, disabled: o.disabled })) : [],
    blocked: [...document.querySelectorAll(".poi-teach-blocked")].map(n => n.textContent.trim()),
  };
})()`;

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const planPath = path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png");
  checks.require(fs.existsSync(planPath), "the real venue plan is present", planPath);

  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Numbers", hotel: "Merit Royal", date: "2026-11-26" });
  await importPlan(page, "data:image/png;base64," + fs.readFileSync(planPath).toString("base64"));
  await runDetection(page);
  checks.ok(true, "OCR availability on this machine", await ocrAvailability(page));

  const tableId = await page.evaluate(SELECT_TABLE);
  checks.require(!!tableId, "the plan produced a table to work with");
  await page.waitForTimeout(400);

  // --- 1. the panel exists, and says what state the number is in -----------
  const before = await page.evaluate(PANEL);
  checks.ok(before.numberPanel && before.confirmButton,
    "a table's inspector offers its printed number and a way to confirm it", before);
  checks.ok(before.stateLine && !/^[a-z][a-zA-Z0-9]*\./.test(before.stateLine),
    "the number's state is stated in words, not as a raw key", before.stateLine);

  // Where nothing was read off the drawing, the panel must say so rather than
  // showing an empty box with no explanation.
  const storedBefore = await page.evaluate(id =>
    state.events[0].analysis.candidates.find(c => c.id === id).printedNumber || null, tableId);
  if (!storedBefore) {
    checks.ok(before.input === "", "with no reading, the field is empty", before.input);
    checks.ok(/\S/.test(before.stateLine), "and the state line explains why", before.stateLine);
  }

  // --- 2. venue scope is refused BEFORE the click, with a reason -----------
  //
  // The precondition is stated rather than assumed: this only means anything
  // for a table no person has confirmed a number for. Where real OCR has
  // already produced one, the rule is satisfied and there is nothing to refuse.
  const unconfirmed = !(storedBefore && storedBefore.state === "VERIFIED");
  checks.ok(unconfirmed,
    "the table chosen has no confirmed number yet, so the venue rule has something to say",
    storedBefore);
  const venue = before.scopes.find(s => s.v === "venue");
  checks.ok(venue && venue.disabled,
    "venue scope is disabled while nothing identifies this table", before.scopes);
  checks.ok(before.scopes.filter(s => !s.disabled).length === 2,
    "this plan and this layout stay available", before.scopes);
  checks.equal(before.blocked.length, 1, "and exactly one reason is given");
  checks.ok(before.blocked[0].length > 20 && /\d|number|numara/i.test(before.blocked[0]),
    "the reason says what would make it available", before.blocked[0]);

  // --- 3. a number a person confirms is stored as theirs -------------------
  await page.fill("#poiNumber", "42");
  await click(page, '[data-review-action="confirm-number"]');
  await page.waitForTimeout(700);

  const stored = await page.evaluate(id => {
    const c = state.events[0].analysis.candidates.find(x => x.id === id);
    return { printedNumber: c && c.printedNumber, taughtFrom: c && c.taughtFrom ? c.taughtFrom.scope : null,
      lessons: (state.teachings || []).map(l => ({ kind: l.subject.kind, value: l.subject.value, scope: l.scope })) };
  }, tableId);
  checks.ok(stored.printedNumber && stored.printedNumber.value === 42,
    "the number the operator typed is the number stored", stored.printedNumber);
  checks.equal(stored.printedNumber.state, "VERIFIED", "and it is held as confirmed");
  checks.ok(/person/i.test(stored.printedNumber.source || ""),
    "with the source saying a person stood behind it, not that the drawing was read",
    stored.printedNumber.source);
  checks.ok(stored.lessons.some(l => l.kind === "tableNumber" && l.value === 42),
    "a tableNumber lesson was kept, through the same Teach Area as everything else", stored.lessons);

  // --- 4. confirming the number unlocks venue scope ------------------------
  await selectById(page, tableId);
  await page.waitForTimeout(400);
  const after = await page.evaluate(PANEL);
  const venueAfter = after.scopes.find(s => s.v === "venue");
  checks.ok(venueAfter && !venueAfter.disabled,
    "once a person has confirmed the number, venue scope becomes available", after.scopes);
  checks.equal(after.blocked.length, 0, "and the reason it was blocked is gone");
  checks.equal(after.input, "42", "the confirmed number is what the field shows");

  // --- 5. a venue-scoped lesson is now accepted rather than refused --------
  const beforeCount = await page.evaluate(() => (state.teachings || []).length);
  await page.selectOption("[data-teach-scope]", "venue");
  await page.waitForTimeout(200);
  await click(page, '[data-review-action="teach"]');
  await page.waitForTimeout(600);
  const venueLesson = await page.evaluate(() => {
    const ls = state.teachings || [];
    return { n: ls.length, last: ls[ls.length - 1] ? { kind: ls[ls.length - 1].subject.kind, scope: ls[ls.length - 1].scope } : null };
  });
  checks.equal(venueLesson.n, beforeCount + 1, "the venue-wide lesson was kept");
  checks.equal(venueLesson.last.scope, "venue", "at venue scope");

  // --- 6. rubbish is refused, and says so ---------------------------------
  await selectById(page, tableId);
  await page.waitForTimeout(300);
  const lessonsBefore = await page.evaluate(() => (state.teachings || []).length);
  await page.fill("#poiNumber", "0");
  await click(page, '[data-review-action="confirm-number"]');
  await page.waitForTimeout(500);
  checks.equal(await page.evaluate(() => (state.teachings || []).length), lessonsBefore,
    "zero is not a table number and is not stored");
  const toastText = await page.evaluate(() =>
    [...document.querySelectorAll("#toastWrap *")].map(n => n.textContent.trim()).filter(Boolean).join(" | "));
  checks.ok(/\S/.test(toastText), "and the operator is told why", toastText);

  // --- 7. no raw key in the panel, in either language ---------------------
  for (const lang of ["en", "tr"]) {
    await page.evaluate(l => { ui.lang = l; render(); }, lang);
    await page.waitForTimeout(300);
    const leaked = await page.evaluate(() => {
      const root = document.querySelector(".poi-card");
      if (!root) return ["(no inspector)"];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
      const found = new Set();
      let n;
      while ((n = walker.nextNode())) {
        const s = n.textContent.trim();
        if (s && s.length <= 60 && KEY.test(s) && !/^\d/.test(s)) found.add(s);
      }
      return [...found];
    });
    checks.equal(leaked.length, 0, `no untranslated key in the inspector in ${lang.toUpperCase()}`);
  }
}
