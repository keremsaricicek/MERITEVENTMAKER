// Does the app boot and can an operator walk every screen without breaking it.
//
// Cheapest possible early warning: eight classic scripts share one global
// scope and load in a fixed order, so a single syntax error or a missing DOM
// id in index.html kills every file after it in the chain. That failure mode
// has already shipped once (the offline build dropped #guestDialog and the app
// booted to a dead shell), and it is invisible to any check that only reads
// source.
import { openApp, createBlankEvent, addTables, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "smoke", tags: ["business", "fast"], timeout: 90000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  checks.require(await page.evaluate(() => Array.isArray(state.events)), "app booted with a usable state object");

  await createBlankEvent(page, { name: "Smoke", hotel: "H", date: "2026-10-02" });
  const blank = await page.evaluate(() => {
    const e = state.events[0];
    return { tables: e.tables.length, guests: e.guests.length, assignments: e.guests.filter(g => g.assignment).length };
  });
  checks.ok(blank.tables === 0 && blank.guests === 0 && blank.assignments === 0,
    "a new blank event is actually blank — no sample tables, guests or assignments", blank);

  const tables = await addTables(page);
  checks.ok(tables === 4, "the Add Objects FAB creates the default four tables", tables);

  for (const tab of ["guests", "seating", "live", "reports"]) {
    await gotoTab(page, tab);
    const mounted = await page.evaluate(() => document.querySelector("#app")?.children.length || 0);
    checks.ok(mounted > 0, `the ${tab} screen renders content`, mounted);
  }

  await gotoTab(page, "floor");
  const survived = await page.evaluate(() => state.events[0].tables.length);
  checks.ok(survived === 4, "walking every screen did not mutate the floor plan", survived);
}
