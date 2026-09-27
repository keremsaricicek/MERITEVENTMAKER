// PLANNED AND LIVE OCCUPANCY DISAGREE FOR A NO SHOW — AND MUST.
//
// The product's most important operational rule, and the ownership map's named
// missing test for A03 (benchmarks/APP-V8-OWNERSHIP-MAP.md): a No Show KEEPS
// the planned seat — the plan, the workbook and the reports stay correct — and
// RELEASES the chair tonight. Two functions carry the two answers:
// `occupiedSeatIndexes` (planned) and `liveUsedIndexes` (live). Every suite
// exercised one or the other; none asserted that they differ, which is the
// rule itself. Written as the characterization test for moving the live half
// out of app-v8.js (MODULARIZATION-ORDER step 3), so it reads the pair through
// the surfaces an operator sees — the Seating badge in planned and in live
// mode, and the Live screen's figures — and holds before and after the move.
import { openApp, createBlankEvent, addTables, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "occupancy-pair", tags: ["business", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Doluluk", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 1 });
  await page.evaluate(() => {
    const e = activeEvent(), t = e.tables[0];
    setTableCapacity(e, t, 4);
    const g = (id, name, pax, arrival) => ({ id, name, additionalGuests: pax - 1, pax, planningStatus: "Confirmed", vip: "Standard", arrivalStatus: arrival,
      checkedInAt: arrival === "Checked In" ? new Date().toISOString() : null, invitedBy: "", notes: "", assignment: null, createdAt: new Date().toISOString() });
    e.guests.push(g("gA", "Aylin Tan", 2, "Not Arrived"), g("gB", "Berk Uz", 1, "Checked In"));
    touchEvent(e);
    assignGuestToTable("gA", t.id);
    assignGuestToTable("gB", t.id);
    // A No Show written the way the door writes it: arrival axis only.
    e.guests[0].arrivalStatus = "No Show";
    touchEvent(e);
  });
  const badge = async (operational) => {
    await page.evaluate((op) => { ui.tab = "seating"; ui.operationalMode = op; render(); }, operational);
    await settle(page);
    // The count sits in its own element ("3 / 4"), beside the table number.
    return page.evaluate(() => { const o = document.querySelector(".table-object");
      const count = [...(o?.querySelectorAll("*") || [])].map((el) => el.textContent.replace(/\s+/g, " ").trim()).find((x) => /^\d+ \/ \d+$/.test(x));
      return { text: count || "" }; });
  };
  const liveFigures = async () => {
    await page.evaluate(() => { ui.tab = "live"; ui.operationalMode = false; render(); });
    await settle(page);
    return page.evaluate(() => {
      const byLabel = (key) => { const want = t(key); const m = [...document.querySelectorAll(".mx-metric")].find((x) => x.querySelector(".mx-metric-label")?.textContent.trim() === want);
        return m ? Number(m.querySelector(".mx-metric-value")?.textContent.trim()) : null; };
      return { emptyChairs: byLabel("live.kpi.emptyChairs"), emptyTables: byLabel("live.kpi.emptyTables") };
    });
  };

  // --- 1. the PLAN keeps the No Show's seats --------------------------------
  const planned = await page.evaluate(() => { const e = activeEvent(); return { used: [...occupiedSeatIndexes(e, e.tables[0].id)].sort(), seats: e.guests[0].assignment?.seats }; });
  checks.equal(planned.used, [0, 1, 2], "planned occupancy counts the No Show's two seats: the plan does not change because someone did not come");
  checks.equal(planned.seats, [0, 1], "and the No Show's assignment is untouched");
  const plannedBadge = await badge(false);
  checks.ok(plannedBadge.text === "3 / 4", "the Seating plan shows 3 of 4 taken", plannedBadge);

  // --- 2. TONIGHT the chair is free ------------------------------------------
  const liveBadge = await badge(true);
  checks.ok(liveBadge.text === "1 / 4", "the same table in live mode shows 1 of 4 taken: the No Show's chairs are released", liveBadge);
  const live = await liveFigures();
  checks.equal(live, { emptyChairs: 3, emptyTables: 0 }, "Live counts 3 free chairs and no empty table");

  // --- 3. the two answers stay two answers -----------------------------------
  await page.evaluate(() => { const e = activeEvent(); e.guests[1].arrivalStatus = "No Show"; e.guests[1].checkedInAt = null; touchEvent(e); });
  const both = await liveFigures();
  checks.equal(both, { emptyChairs: 4, emptyTables: 1 }, "with both parties No Show, Live has the whole table free…");
  checks.equal(await page.evaluate(() => { const e = activeEvent(); return occupiedSeatIndexes(e, e.tables[0].id).size; }), 3,
    "…while the plan still seats all three people exactly where they were");
}
