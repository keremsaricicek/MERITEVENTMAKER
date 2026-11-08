// EVERY SCREEN, BOTH THEMES, NO CONSOLE ERROR.
//
// Written for the 2026-11 decomposition of app-v8.js (benchmarks/
// CODE-HEALTH-2026-11.md): a capability that leaves the shell can lose a name
// that only one screen's render path reads, and that is a page error on a
// screen no other suite happened to open in that theme. So this opens every
// screen and mode a person can reach — the event list, the new-event form,
// Command Center, Floor Plan (draw, review and layout-change modes), Guests,
// Seating, Live, Reports, the finder panel, the guide — in the light and the
// dark theme, on a planned event with guests seated, checked in and No Show,
// and on a historical event's read-only views. The runner fails a suite on
// any console error or page error; this suite also asserts each screen
// rendered (non-empty #app, no contained-render failure card).
import { openApp, createBlankEvent, addGuest, addTables, gotoTab, settle, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "screen-console-sweep", tags: ["business", "fast"], timeout: 240000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Sweep Gala", date: futureDate() });
  await addTables(page, { quantity: 3 });
  await gotoTab(page, "guests");
  await addGuest(page, { name: "Ayla Kurt", additionalGuests: 2 });
  await addGuest(page, { name: "Bora Er", additionalGuests: 1, vip: "VIP" });
  await addGuest(page, { name: "Cem Su" });
  await page.evaluate(() => {
    const e = activeEvent();
    for (const n of ["Ayla Kurt", "Bora Er"]) assignGuestToTable(e.guests.find((g) => g.name === n).id, e.tables[0].id);
    e.guests.find((g) => g.name === "Ayla Kurt").arrivalStatus = "Checked In";
    e.guests.find((g) => g.name === "Bora Er").arrivalStatus = "No Show";
    touchEvent(e); render();
  });
  await settle(page);

  const views = [
    ["command", null], ["floor", null], ["floor", "review"], ["floor", "changes"],
    ["guests", null], ["seating", null], ["live", null], ["reports", null],
  ];
  const visit = async (label) => {
    await settle(page);
    const s = await page.evaluate(() => ({ len: (document.getElementById("app")?.innerHTML || "").length,
      failed: !!document.querySelector(".render-failure, [data-render-failure]") }));
    checks.ok(s.len > 200 && !s.failed, `${label}: rendered`, s);
  };
  for (const theme of ["light", "dark"]) {
    await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
    for (const [tab, mode] of views) {
      await page.evaluate(([tb, md]) => { ui.screen = "workspace"; ui.tab = tb; ui.planMode = md || null; render(); }, [tab, mode]);
      await visit(`${theme} · ${tab}${mode ? `/${mode}` : ""}`);
    }
    // the finder panel under the top bar
    await page.evaluate(() => { ui.planMode = null; ui.tab = "guests"; render(); renderGlobalSearch("ayla"); });
    await visit(`${theme} · finder`);
    await page.evaluate(() => renderGlobalSearch(""));
    // the event list and the new-event form
    await page.evaluate(() => { ui.screen = "events"; render(); });
    await visit(`${theme} · events`);
    // the guide
    await page.evaluate(() => { if (typeof openGuide === "function") openGuide(); });
    await settle(page);
    await page.evaluate(() => { const d = document.getElementById("guideDialog"); if (d && d.open) d.close(); });
    await page.evaluate(() => { ui.screen = "workspace"; render(); });
  }

  // a historical event's read-only views
  await page.evaluate(() => { const e = activeEvent(); e.status = "Completed"; touchEvent(e); render(); });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
    for (const tab of ["guests", "seating", "reports"]) {
      await page.evaluate((tb) => { ui.screen = "workspace"; ui.tab = tb; ui.planMode = null; render(); }, tab);
      await visit(`${theme} · historical ${tab}`);
    }
  }
}
