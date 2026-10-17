// "BEFORE YOU EXPORT" SAYS WHAT THE COMMAND CENTER SAYS.
//
// CLAUDE.md: one layer answers "can this event safely proceed?" and every
// surface reads it, "so the product cannot say two different things about one
// event". Measured before this suite: the Reports screen's pre-flight list was
// built from planIssues() — four rules — while the Command Center judged from
// the Plan Doctor. With three guests seated at a table marked UNAVAILABLE the
// Command Center said NOT READY, and Reports, one tab away, said "Everything
// checks out — No blocking issues in this plan" above the export button. The
// four planIssues() rules are ones the Doctor already expresses natively
// (plan-doctor.js EXPRESSED_NATIVELY), so the narrow list could only ever
// agree by omission.
import { openApp, createBlankEvent, addTables, futureDate, settle, click } from "../lib/app-actions.mjs";

export const meta = { name: "reports-preflight", tags: ["business", "ui", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "One Answer", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 2 });
  await page.evaluate(() => {
    const e = activeEvent();
    const g = (id, name) => ({ id, name, additionalGuests: 0, pax: 1, planningStatus: "Confirmed", vip: "Standard", arrivalStatus: "Not Arrived",
      checkedInAt: null, invitedBy: "", notes: "", assignment: null, createdAt: new Date().toISOString() });
    e.guests.push(g("g1", "Ada One"), g("g2", "Ben Two"), g("g3", "Cem Three"));
    touchEvent(e);
    for (const id of ["g1", "g2", "g3"]) assignGuestToTable(id, e.tables[0].id);
  });

  const commandCenter = async () => {
    await page.evaluate(() => { ui.tab = "command"; render(); });
    await settle(page);
    return page.evaluate(() => [...document.querySelectorAll(".cc-reason")].map((r) => ({
      level: r.classList.contains("blocker") ? "blocker" : "review", what: r.querySelector("b")?.textContent.trim() || "" })));
  };
  const reports = async () => {
    await page.evaluate(() => { ui.tab = "reports"; render(); });
    await settle(page);
    return page.evaluate(() => {
      const box = document.querySelector(".preflight");
      const rows = [...(box?.querySelectorAll(".pf-item:not(.ok)") || [])].map((r) => ({
        level: r.classList.contains("blocker") ? "blocker" : "review", what: r.querySelector("b")?.textContent.trim() || "" }));
      const head = [...document.querySelectorAll(".mx-section-head")].find((h) => h.nextElementSibling === box);
      return { rows, ok: !!box?.querySelector(".pf-item.ok"), count: head?.querySelector(".count")?.textContent.trim() || "" };
    });
  };

  // --- 1. the case that was measured: a failed table with guests at it -----
  await page.evaluate(() => { const e = activeEvent(); e.tables[0].availability = "UNAVAILABLE"; e.tables[0].unavailableReason = "DAMAGED";
    e.tables[0].unavailableSince = new Date().toISOString(); touchEvent(e); });
  const cc1 = await commandCenter();
  checks.ok(cc1.some((r) => r.level === "blocker"), "the Command Center names a blocking problem: guests are seated at a table that cannot be used", cc1);
  const rp1 = await reports();
  checks.ok(!rp1.ok, "Reports does NOT say everything checks out while the Command Center says the event is not ready", rp1);
  checks.equal(rp1.rows, cc1, "Reports lists exactly the Command Center's reasons, in the same order, at the same levels");
  checks.equal(rp1.count, String(cc1.length), "and its count is the same number", rp1.count);

  // --- 2. following the reason lands where the Command Center's does --------
  const destination = async (tab, selector) => {
    await page.evaluate((t) => { ui.tab = t; render(); }, tab);
    await settle(page);
    const found = await page.$(selector);
    if (!found) return null;
    await click(page, selector);
    await settle(page);
    return page.evaluate(() => ({ tab: ui.tab, table: ui.selectedTableId || ui.selectedObjectId || null }));
  };
  const fromCc = await destination("command", ".cc-reason.blocker button");
  const fromReports = await destination("reports", ".preflight .pf-item.blocker button");
  checks.ok(fromCc && fromReports, "both surfaces offer a way to act on the blocking reason", { fromCc, fromReports });
  checks.equal(fromReports, fromCc, "and Reports' control goes exactly where the Command Center's goes");

  // --- 3. fixed in one place, gone from both --------------------------------
  await page.evaluate(() => { const e = activeEvent(); e.tables[0].availability = "AVAILABLE"; e.tables[0].unavailableReason = null; touchEvent(e); });
  const cc2 = await commandCenter();
  const rp2 = await reports();
  checks.ok(!cc2.some((r) => r.level === "blocker") && !rp2.rows.some((r) => r.level === "blocker"), "the table back in service: neither surface still reports it", { cc2, rp2 });
  checks.equal(rp2.rows, cc2, "and the two lists still match");
  checks.equal(rp2.ok, cc2.length === 0, "\"Everything checks out\" appears exactly when the Command Center has nothing to report", { rp2, cc2 });

  // --- 4. a rule both lists had: worded once, by the Doctor ----------------
  // An unseated guest was one of planIssues()' four rules, so the old Reports
  // list said it too — in its own words, beside the Command Center's.
  await page.evaluate(() => { const e = activeEvent();
    e.guests.push({ id: "g4", name: "Dan Four", additionalGuests: 0, pax: 1, planningStatus: "Confirmed", vip: "Standard", arrivalStatus: "Not Arrived",
      checkedInAt: null, invitedBy: "", notes: "", assignment: null, createdAt: new Date().toISOString() });
    touchEvent(e); });
  const cc3 = await commandCenter();
  const rp3 = await reports();
  checks.ok(cc3.length > 0, "an unseated guest is a reason on the Command Center", cc3);
  checks.equal(rp3.rows, cc3, "and the same reason, worded the same way, in Reports");

  // --- 5. Turkish: the same rows, translated the same way -------------------
  await page.evaluate(() => { ui.lang = "tr"; render(); });
  const cc4 = await commandCenter();
  const rp4 = await reports();
  checks.equal(rp4.rows, cc4, "in Turkish the two lists are the same list too");
}
