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
import { click, openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = { name: "teach-number", tags: ["business", "fast"], timeout: 180000 };

const MAKE_PLAN = `(function(){
  const c = document.createElement("canvas");
  c.width = 900; c.height = 500;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#222"; g.lineWidth = 3;
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc(140 + i * 190, 160 + row * 190, 52, 0, Math.PI * 2);
      g.stroke();
    }
  return c.toDataURL("image/png");
})()`;

// Select a table candidate in review mode through the app's own state, then let
// render() put the inspector on screen.
const SELECT_TABLE = `(function(){
  const t = state.events[0].analysis.candidates.find(c => c.kind === "table" && c.status !== "rejected");
  if (!t) return null;
  ui.tab = "floor"; ui.planMode = "review"; ui.reviewCenterOpen = false;
  ui.selectedCandidateId = t.id; render();
  return t.id;
})()`;

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

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Numbers", hotel: "Merit Royal", date: "2026-11-26" });

  await page.evaluate(src => {
    state.events[0].background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, await page.evaluate(MAKE_PLAN));
  await page.waitForTimeout(300);
  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 120000 });
  await page.waitForTimeout(700);

  const tableId = await page.evaluate(SELECT_TABLE);
  checks.require(!!tableId, "the plan produced a table to work with");
  await page.waitForTimeout(400);

  // --- 1. the panel exists, and says what state the number is in -----------
  const before = await page.evaluate(PANEL);
  checks.ok(before.numberPanel && before.confirmButton,
    "a table's inspector offers its printed number and a way to confirm it", before);
  checks.ok(before.stateLine && !/^[a-z][a-zA-Z0-9]*\./.test(before.stateLine),
    "the number's state is stated in words, not as a raw key", before.stateLine);

  // This build has no OCR, so nothing was read off the drawing — and the panel
  // must say that rather than showing an empty box with no explanation.
  const storedBefore = await page.evaluate(id =>
    state.events[0].analysis.candidates.find(c => c.id === id).printedNumber || null, tableId);
  if (!storedBefore) {
    checks.ok(before.input === "", "with no reading, the field is empty", before.input);
    checks.ok(/\S/.test(before.stateLine), "and the state line explains why", before.stateLine);
  }

  // --- 2. venue scope is refused BEFORE the click, with a reason -----------
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
  await page.evaluate(SELECT_TABLE);
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
  await page.evaluate(SELECT_TABLE);
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
