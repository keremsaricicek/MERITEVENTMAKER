// A PERSON CAN SET A TABLE'S NUMBER — VALIDATED, UNIQUE AS SHOWN, UNDOABLE.
//
// Measured (§21/§24 in benchmarks/MASTER-PROGRAMME-STATE.md): the one plan fact
// an operator could not change. The only number field lived in the pre-v8
// inspector, which the v8 Floor Plan never renders, so every table kept the
// number it was generated with — and a venue that prints "42" on a table could
// not make the event say 42. The field now sits in the table's own card, bound
// by the same inspector path as Type, Rotation and Zone.
import { openApp, createBlankEvent, addTables, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "table-number-edit", tags: ["business", "ui", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Numara", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 3 });
  const ids = await page.evaluate(() => {
    const e = activeEvent();
    e.guests.push({ id: "g1", name: "Ayşe Demir", additionalGuests: 1, pax: 2, planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: { tableId: e.tables[0].id, seats: [0, 1], locked: false }, vip: "Standard", invitedBy: "", notes: "", createdAt: new Date().toISOString() });
    // The provenance §21 carries: this table's symbol reads 42 on the plan.
    e.tables[0].origin = "DETECTED";
    e.tables[0].printedNumber = { value: 42, state: "VERIFIED", confidence: 0.97, source: "OCR" };
    touchEvent(e); return e.tables.map((t) => t.id);
  });
  const select = async (id) => { await page.evaluate((id) => { ui.tab = "floor"; ui.planMode = "plan"; ui.selectedObjectId = id; ui.selectedObjectIds = [id]; render(); }, id); await settle(page); };
  const numbers = () => page.evaluate(() => activeEvent().tables.map((t) => t.number));
  const setNumber = async (v) => { await page.fill("#fld-inspector-number", v); await page.press("#fld-inspector-number", "Enter"); await settle(page); };

  // --- 1. the field exists, in Turkish, showing the number ------------------
  await select(ids[0]);
  const field = await page.evaluate(() => ({ value: document.getElementById("fld-inspector-number")?.value,
    label: document.querySelector('label[for="fld-inspector-number"]')?.textContent }));
  checks.equal(field, { value: "T01", label: "Masa numarası" }, "the table's card has a number field, labelled in Turkish, holding its number");
  checks.ok(await page.evaluate(() => !!document.querySelector("[data-printed-mismatch]")), "(before: the plan's 42 disagrees with T01, as §21 states)");

  // --- 2. typing the printed number: select, type, Enter — three actions ----
  await setNumber("42");
  checks.equal((await numbers())[0], "42", "select the table, type 42, Enter: the table is 42");
  checks.equal(await page.evaluate(() => activeEvent().tables[0].numberSource), "TYPED", "and records that a person typed it");
  checks.ok(await page.evaluate(() => !document.querySelector("[data-printed-mismatch]")), "the disagreement with the printed number is gone, because there is none");
  checks.equal(await page.evaluate(() => { const e = activeEvent(); return e.tables.find((t) => t.id === e.guests[0].assignment.tableId).number; }), "42",
    "the seated party is still at that table — an assignment names the table, not its number");

  // --- 3. refused: a number another table already SHOWS ---------------------
  await select(ids[1]);
  await setNumber("T3");
  checks.equal((await numbers())[1], "T02", "'T3' is refused beside an existing T03 — unique by how numbers are shown, not by raw text");
  await setNumber("42");
  checks.equal((await numbers())[1], "T02", "and an exact duplicate is refused");
  checks.equal(await page.evaluate(() => document.getElementById("fld-inspector-number").maxLength), 12,
    "the field itself stops at 12 characters");
  for (const bad of ["", "   ", "<b>x</b>", "T 0!"]) {
    await setNumber(bad);
    checks.equal((await numbers())[1], "T02", `an invalid number (${JSON.stringify(bad).slice(0, 20)}) is refused and nothing changes`);
  }
  await setNumber("vip-3");
  checks.equal((await numbers())[1], "VIP-3", "letters, digits and a hyphen are accepted, upper-cased");

  // --- 4. undo takes it back ------------------------------------------------
  await page.evaluate(() => undoCanvas());
  await settle(page);
  checks.equal((await numbers())[1], "T02", "undo restores the previous number");

  // --- 5. survives a save and reload, and reaches Seating --------------------
  await page.evaluate(() => saveState());
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => { try { return state.events.length === 1; } catch { return false; } }, null, { timeout: 15000 });
  checks.equal(await page.evaluate(() => [state.events[0].tables[0].number, state.events[0].tables[0].numberSource]), ["42", "TYPED"], "a typed number survives a reload, with its source");
  await page.evaluate(() => { ui.activeEventId = state.events[0].id; ui.screen = "workspace"; ui.tab = "seating"; render(); });
  await settle(page);
  checks.ok(await page.evaluate(() => [...document.querySelectorAll(".table-object .table-label")].some((n) => n.textContent.trim() === "42")), "Seating shows the table as 42");
}
