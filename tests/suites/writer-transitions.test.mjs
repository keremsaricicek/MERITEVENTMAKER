// THE THREE SINGLE WRITERS, AND THE RULE EACH ONE APPLIES WHEN IT WRITES.
//
// setArrival(), setTableAvailability() and addHandoverNote() are each the only
// writer of their facts (benchmarks/APP-V8-OWNERSHIP-MAP.md A06, A19), and each
// applies a rule as it writes. Measured 2026-10-03 by mutating those rules one
// at a time against every suite that touches them: SIX OF SEVEN SURVIVED —
//
//   a repeat check-in keeps the moment the guest first arrived;
//   a status that does not exist is refused;
//   a table's "unavailable since" is kept from its FIRST failure tonight;
//   an unknown reason is recorded as OTHER, never stored raw;
//   a table back in service carries no reason, note or "since" of a failure;
//   a handover note is trimmed and capped at the module's length.
//
// Only "the arrival moment goes with the status" was held. This suite holds the
// rest — through the controls an operator uses where a control reaches the
// rule, and at the module boundary where none does (the UI only ever sends a
// valid status or reason, and offers no second "mark unavailable").
import { openApp, createBlankEvent, addTables, futureDate, settle, click } from "../lib/app-actions.mjs";

export const meta = { name: "writer-transitions", tags: ["business", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Writers", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 2 });
  const tableId = await page.evaluate(() => activeEvent().tables[0].id);

  // --- 1. a table back in service carries nothing of its failure -----------
  await page.evaluate((id) => { ui.tab = "seating"; ui.selectedTableId = id; render(); }, tableId);
  await settle(page);
  await page.selectOption("[data-avail-reason]", "DAMAGED");
  await click(page, `[data-avail-mark="${tableId}"][data-avail-next="UNAVAILABLE"]`);
  await settle(page);
  const failed = await page.evaluate((id) => { const t = activeEvent().tables.find((x) => x.id === id);
    return { availability: t.availability, reason: t.unavailableReason, since: !!t.unavailableSince }; }, tableId);
  checks.equal(failed, { availability: "UNAVAILABLE", reason: "DAMAGED", since: true }, "marked unavailable: the reason and the moment are recorded with it");
  await click(page, `[data-avail-mark="${tableId}"][data-avail-next="AVAILABLE"]`);
  await settle(page);
  const back = await page.evaluate((id) => { const t = activeEvent().tables.find((x) => x.id === id);
    return { availability: t.availability, reason: t.unavailableReason, note: t.unavailableNote, since: t.unavailableSince }; }, tableId);
  checks.equal(back, { availability: "AVAILABLE", reason: null, note: "", since: null },
    "back in service: no reason, note or moment of the failure stays on a working table");

  // --- 2. a handover note is trimmed ---------------------------------------
  // The textarea's maxlength already stops typing at the module's cap, so the
  // writer's own cap is checked at the module boundary below.
  await page.evaluate(() => { ui.tab = "command"; render(); });
  await settle(page);
  await page.fill("[data-handover-text]", "   Table 12 wobbles — wedge it before doors   ");
  await page.fill("[data-handover-by]", "  Duty Manager  ");
  await click(page, "[data-handover-add]");
  await settle(page);
  const note = await page.evaluate(() => { const n = (activeEvent().handoverNotes || [])[0]; return n ? { text: n.text, by: n.by, id: /^handover_/.test(n.id), at: !!n.at } : null; });
  checks.equal(note, { text: "Table 12 wobbles — wedge it before doors", by: "Duty Manager", id: true, at: true },
    "a note is stored trimmed, with its author trimmed, an id and the moment it was written");
  const before = await page.evaluate(() => (activeEvent().handoverNotes || []).length);
  await page.fill("[data-handover-text]", "     ");
  await click(page, "[data-handover-add]");
  await settle(page);
  checks.equal(await page.evaluate(() => (activeEvent().handoverNotes || []).length), before, "a note of only spaces is not a note: nothing is stored");

  // --- 3. the rules no control reaches, at the module boundary ------------
  const unit = await page.evaluate(() => {
    const AW = MeritArrivalWave, TA = MeritTableAvailability, H = MeritEventHandover;
    const first = "2026-01-01T19:00:00.000Z", later = "2026-01-01T21:30:00.000Z";
    const big = "y".repeat(H.NOTE_MAX + 50);
    return {
      recheckin: AW.arrivalTransition({ arrivalStatus: "Checked In", checkedInAt: first }, "Checked In", later),
      firstIn: AW.arrivalTransition({ arrivalStatus: "Not Arrived", checkedInAt: null }, "Checked In", later),
      noShow: AW.arrivalTransition({ arrivalStatus: "Checked In", checkedInAt: first }, "No Show", later),
      bogus: AW.arrivalTransition({ arrivalStatus: "Not Arrived" }, "Arrived", later),
      secondFailure: TA.availabilityTransition({ availability: "UNAVAILABLE", unavailableSince: first }, "UNAVAILABLE", "SAFETY", "", later),
      unknownReason: TA.availabilityTransition({}, "UNAVAILABLE", "GREMLINS", "n", later).unavailableReason,
      bogusState: TA.availabilityTransition({}, "BROKEN", "DAMAGED", "", later),
      capped: H.normalizeNote({ id: "handover_x", text: big, by: "z".repeat(H.BY_MAX + 9), at: later }),
      caps: [H.NOTE_MAX, H.BY_MAX],
    };
  });
  checks.equal(unit.recheckin, { arrivalStatus: "Checked In", checkedInAt: "2026-01-01T19:00:00.000Z" },
    "a repeat check-in keeps the moment the guest FIRST arrived — pressing it again does not move them on the curve");
  checks.equal(unit.firstIn, { arrivalStatus: "Checked In", checkedInAt: "2026-01-01T21:30:00.000Z" }, "a first check-in records now");
  checks.equal(unit.noShow, { arrivalStatus: "No Show", checkedInAt: null }, "a No Show has no arrival moment");
  checks.equal(unit.bogus, null, "a status that does not exist is refused, never stored");
  checks.ok(unit.secondFailure && unit.secondFailure.unavailableSince === "2026-01-01T19:00:00.000Z" && unit.secondFailure.unavailableReason === "SAFETY",
    "a table that fails again keeps the moment it FIRST failed tonight, with the new reason", unit.secondFailure);
  checks.equal(unit.unknownReason, "OTHER", "an unknown reason is recorded as OTHER, never stored raw");
  checks.equal(unit.bogusState, null, "an availability that does not exist is refused");
  checks.ok(unit.capped && unit.capped.text.length === unit.caps[0] && unit.capped.by.length === unit.caps[1],
    "a note and its author are capped at the module's lengths, whatever path wrote them", { text: unit.capped?.text.length, by: unit.capped?.by.length, caps: unit.caps });
}
