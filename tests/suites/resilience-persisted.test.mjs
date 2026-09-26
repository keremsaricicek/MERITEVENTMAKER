// A STORED RECORD WITH A BROKEN RELATIONSHIP OPENS, SAYS SO, AND KEEPS IT.
//
// `.claude/skills/merit-resilience-hardening/SKILL.md`, persisted data:
// "a guest referencing a table that no longer exists" and "an assignment
// referencing a seat index beyond capacity". Both happen in real installs —
// a table deleted by a build that did not clear its guests, a capacity
// lowered by hand in a backup — and both are the kind of corruption that is
// tempting to "repair" silently on load.
//
// The product's answer, characterised here rather than changed, is the
// right one on all five counts:
//   CONTAIN   the record opens and every screen renders;
//   INFORM    the Plan Doctor names each problem at BLOCKING level, in the
//             header badge and the Command Center, with the guests' count;
//   PRESERVE  the assignment is NOT rewritten on load — a guest pointing at
//             a missing table still points at it after a save and a reload,
//             because deleting it would erase the evidence of what the plan
//             said, and guessing a new seat would be seating nobody asked for;
//   RECOVER   each finding carries its route to Seating, where a person fixes
//             it through the one assignment writer.
import { openApp } from "../lib/app-actions.mjs";
import { writeRecord, readRecord, deleteRecord, gotoBlank, bootApp } from "../lib/faults.mjs";

export const meta = { name: "resilience-persisted", tags: ["resilience", "storage", "fast"], timeout: 90000 };

export default async function run({ page, checks, baseUrl }) {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await openApp(page, baseUrl, { lang: "en" });
  const root = { schemaVersion: 9, version: 9, events: [{ id: "e1", name: "Broken Links", date: "2031-03-03", status: "Planning",
    tables: [{ id: "t1", number: "T01", type: "round", x: 100, y: 100, w: 120, h: 120, capacity: 4, hasPhysicalSeats: true, chairs: [] }],
    guests: [
      { id: "g1", name: "GHOST TABLE", pax: 1, additionalGuests: 0, assignment: { tableId: "t_gone", seats: [0], locked: false } },
      { id: "g2", name: "OVER CAPACITY", pax: 2, additionalGuests: 1, assignment: { tableId: "t1", seats: [6, 7], locked: false } },
      { id: "g3", name: "FINE", pax: 1, additionalGuests: 0, assignment: { tableId: "t1", seats: [0], locked: false } },
    ], venueObjects: [] }] };
  await gotoBlank(page, baseUrl);
  await writeRecord(page, "root", JSON.stringify(root));
  await deleteRecord(page, "autosnapshots");
  await bootApp(page, baseUrl);

  const screens = await page.evaluate(() => {
    const e = state.events[0]; const out = {};
    ui.activeEventId = e.id; ui.screen = "workspace";
    for (const tab of ["command", "floor", "guests", "seating", "live", "reports"]) {
      ui.tab = tab; try { render(); out[tab] = "ok"; } catch (err) { out[tab] = err.message; }
    }
    return out;
  });
  checks.ok(Object.values(screens).every((v) => v === "ok") && pageErrors.length === 0,
    "CONTAIN: a record with a dangling table and an impossible seat opens, and every screen renders", { screens, pageErrors });

  const findings = await page.evaluate(() => {
    ui.tab = "command"; render();
    const r = MeritPlanDoctor.run({ tables: state.events[0].tables, guests: state.events[0].guests });
    return { codes: r.all.map((f) => `${f.code}:${f.level}`), actions: r.all.map((f) => f.action && f.action.go),
      text: document.querySelector("#app").textContent };
  });
  checks.ok(findings.codes.includes("guestAtMissingTable:BLOCKING"),
    "INFORM: a guest at a table that is not in the plan is a BLOCKING finding", findings.codes);
  checks.ok(findings.codes.includes("seatBeyondTheTable:BLOCKING"),
    "INFORM: a seat number the table does not have is a BLOCKING finding", findings.codes);
  checks.ok(/table that is not in this plan/.test(findings.text) && /seat number/.test(findings.text),
    "and both are on the operator's screen, not only in the report object");
  checks.ok(findings.actions.filter(Boolean).length >= 2, "RECOVER: each finding carries the route to where it is fixed", findings.actions);

  // PRESERVE across a real save and reload.
  await page.evaluate(() => { state.events[0].name = "Broken Links (touched)"; touchEvent(state.events[0]); });
  await page.waitForTimeout(700);
  const stored = JSON.parse(await readRecord(page));
  const g1 = stored.events[0].guests.find((g) => g.id === "g1"), g2 = stored.events[0].guests.find((g) => g.id === "g2");
  checks.ok(g1.assignment?.tableId === "t_gone" && JSON.stringify(g2.assignment?.seats) === "[6,7]",
    "PRESERVE: neither assignment was rewritten by loading and saving — no silent 'repair' erased what the plan said",
    { g1: g1.assignment, g2: g2.assignment });
  await bootApp(page, baseUrl);
  const again = await page.evaluate(() => state.events[0].guests.map((g) => g.assignment && g.assignment.tableId));
  checks.equal(again, ["t_gone", "t1", "t1"], "and a reload reads them back exactly");
}
