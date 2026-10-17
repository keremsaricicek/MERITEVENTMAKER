// ACROSS A VENUE, AN OBJECT IS IDENTIFIED BY A NUMBER A PERSON STOOD BEHIND.
//
// The Teach Area keeps what an operator knows about a room as a note with a
// scope — this plan, this layout, this venue. The venue scope carries a rule:
// a note about an OBJECT may only reach across a whole venue when the object
// carries a VERIFIED printed number, because nothing else identifies "the same
// table" across different drawings of the room. CLAUDE.md: "a venue-wide note
// about an object is only acted on when the object carries the same verified
// printed number."
//
// `benchmarks/CODE-INVENTORY.md` §2.1 proposes extracting the shared body of
// `teachTableNumber` and `teachSelectedObject` into one `keepLesson` helper,
// and names the one line that must survive it:
//
//   "from.printedNumber — {state:"VERIFIED", value:n} vs c.printedNumber||null.
//    This one is load-bearing. The number the operator is confirming is what
//    identifies the object from then on; if the extracted helper defaulted it,
//    a venue-scoped lesson would be refused by the very rule the operator has
//    just satisfied."
//
// It then says a characterization test of the venue-scope refusal through the
// app path "should be written before this extraction, not after". This is it.
//
// THREE CLAIMS, ALL THROUGH THE REAL REVIEW-SCREEN CONTROLS:
//
//   1. The refusal is stated BEFORE the click: with no verified number the
//      venue option is disabled, next to the reason.
//   2. The refusal is ENFORCED IN THE DOMAIN, not only by a disabled <option>.
//      A stale control, or a script, can still submit "venue"; `lesson()` must
//      refuse it and nothing may be stored. The same principle as `canMutate`
//      being enforced in domain logic rather than by hiding buttons.
//   3. Confirming a NUMBER at venue scope is ACCEPTED on that same object,
//      because the number being confirmed IS its verified identity. This is the
//      load-bearing line, and the one the mutation targets.
import { openApp, createBlankEvent, futureDate, click } from "../lib/app-actions.mjs";

export const meta = { name: "teach-venue-scope", tags: ["intelligence", "fast"], timeout: 60000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Teach", hotel: "Merit", date: futureDate() });

  // One table candidate with NO printed number, selected on the review screen.
  // The analysis carries the fields the real pipeline writes, because the
  // review screen reads them; `planIntelligence` comes from the product's own
  // published builder rather than being hand-shaped.
  await page.evaluate(() => {
    const event = state.events[0];
    const c = {
      id: "cand-teach", kind: "table", type: "round",
      x: 40, y: 40, w: 8, h: 8, rotation: 0,
      confidence: 0.9, status: "unreviewed", selected: true,
      chairDetections: [], printedNumber: null,
      evidence: { geometry: 0.8, chairs: 0, repetition: 1 },
    };
    event.analysis = {
      id: "an-teach", engine: "ASSISTED_DETECTION", trainedModel: false,
      createdAt: new Date().toISOString(),
      imageWidth: 1000, imageHeight: 800, threshold: 128,
      candidates: [c], missed: [], groupingDecisions: [],
      comparison: { added: 1, removed: 0, changed: 0 },
      memoryReapplied: 0, memoryRestored: 0, memoryConflicts: [],
      ocr: { available: false, reason: "not attempted", engine: "tesseract.js" },
      ocrText: null, timings: {},
      diagnostics: { representation: { kind: "PHYSICAL", associationRate: 0.96, evidence: {} } },
    };
    event.analysis.planIntelligence = globalThis.buildPlanIntelligence(event, null);
    state.teachings = [];
    ui.tab = "floor"; ui.planMode = "review"; ui.selectedCandidateId = c.id;
    render();
  });

  // --- 1. stated before the click ------------------------------------------
  const options = await page.evaluate(() =>
    [...document.querySelectorAll("[data-teach-scope] option")]
      .map((o) => ({ value: o.value, disabled: o.disabled })));
  const venueOpt = options.find((o) => o.value === "venue");
  checks.ok(venueOpt && venueOpt.disabled,
    "with no verified number the VENUE option is disabled — the rule is knowable beforehand, so it is stated beforehand rather than refused after the click",
    options);
  checks.ok(options.filter((o) => o.value !== "venue").every((o) => !o.disabled),
    "while plan and layout stay available — the refusal is about venue reach, not about teaching at all",
    options);

  // --- 2. enforced in the domain, not only by the disabled option ----------
  // Force the scope to venue the way a stale control or a script could, then
  // press the real button.
  const forceVenue = () => page.evaluate(() => {
    const sel = document.querySelector("[data-teach-scope]");
    const venue = [...sel.options].find((o) => o.value === "venue");
    venue.disabled = false;
    sel.value = "venue";
    return sel.value;
  });
  checks.equal(await forceVenue(), "venue", "the scope control really reads venue before the click", "venue");
  await click(page, '[data-review-action="teach"]');
  await page.waitForTimeout(300);
  const afterRefusal = await page.evaluate(() => ({
    teachings: (state.teachings || []).length,
    toast: [...document.querySelectorAll(".toast, [role='status'], [role='alert']")]
      .map((n) => n.textContent.trim()).filter(Boolean).slice(-1)[0] || null,
  }));
  checks.equal(afterRefusal.teachings, 0,
    "a venue-wide lesson about an object with no verified number is REFUSED by the domain even when the control is forced — nothing is stored. A disabled <option> is a courtesy, not the rule",
    afterRefusal);

  // --- 3. confirming the NUMBER at venue scope is accepted -----------------
  await page.evaluate(() => { ui.selectedCandidateId = "cand-teach"; render(); });
  await forceVenue();
  await page.fill("#poiNumber", "42");
  await click(page, '[data-review-action="confirm-number"]');
  await page.waitForTimeout(300);
  const afterNumber = await page.evaluate(() => {
    const ls = state.teachings || [];
    const l = ls[ls.length - 1] || null;
    return {
      teachings: ls.length,
      scope: l?.scope ?? null,
      subject: l?.subject ?? null,
      fromNumber: l?.from?.printedNumber ?? null,
    };
  });
  checks.equal(afterNumber.teachings, 1,
    "confirming a table's printed number at VENUE scope is ACCEPTED on the very object the previous lesson was refused for — the number being confirmed IS its verified identity. If the shared helper defaulted it to the object's (absent) number, this lesson would be refused by the rule the operator has just satisfied",
    afterNumber);
  checks.equal(afterNumber.scope, "venue", "and it is stored at venue scope, as chosen", afterNumber.scope);
  checks.ok(afterNumber.subject && afterNumber.subject.kind === "tableNumber" && afterNumber.subject.value === 42,
    "as a tableNumber lesson carrying 42", afterNumber.subject);
  checks.ok(afterNumber.fromNumber && afterNumber.fromNumber.state === "VERIFIED" && afterNumber.fromNumber.value === 42,
    "and the object it came from is recorded as VERIFIED 42 — the line the extraction must not default",
    afterNumber.fromNumber);

  // A malformed number is refused before the domain is consulted at all.
  await page.evaluate(() => { ui.selectedCandidateId = "cand-teach"; render(); });
  await page.fill("#poiNumber", "4.5");
  await click(page, '[data-review-action="confirm-number"]');
  await page.waitForTimeout(300);
  const afterBad = await page.evaluate(() => (state.teachings || []).length);
  checks.equal(afterBad, 1,
    "and a non-integer is refused outright — nothing new is stored for 4.5", afterBad);
}
