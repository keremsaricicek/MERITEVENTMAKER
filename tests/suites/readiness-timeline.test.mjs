// THE COMMAND CENTER KNOWS WHAT TIME IT IS — FROM RECORDS, NEVER A FORECAST.
//
// Measured before (§22 in benchmarks/MASTER-PROGRAMME-STATE.md): the Command
// Center had a phase and a verdict and no time at all — nothing said how far
// away the event is, what had been done and when, or that the last final check
// was older than the latest change (that lived only inside the collapsed Plan
// Doctor). The timeline is derived from what is recorded: the event date, the
// plan's confirmation moment, guests' createdAt, the recorded final check, the
// handover notes. Three refusals are asserted, because each is the easy lie:
//   · a step whose moment was never recorded shows NO date, not a guessed one;
//   · nothing is forecast — no "on track", no projected completion, no percent;
//   · a final check older than the event's latest change is not "done".
import { openApp, createBlankEvent, addTables, futureDate, gotoTab, settle, click } from "../lib/app-actions.mjs";

export const meta = { name: "readiness-timeline", tags: ["business", "ui", "fast"], timeout: 120000 };

const STEPS = () => [...document.querySelectorAll("[data-readiness-timeline] [data-step]")].map((n) => ({
  key: n.dataset.step, state: n.dataset.state, text: n.textContent.replace(/\s+/g, " ").trim(),
  date: n.querySelector("time")?.getAttribute("datetime") || null, go: n.querySelector("[data-timeline-go]")?.dataset.timelineGo || null,
}));

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  await createBlankEvent(page, { name: "Zaman", hotel: "Merit", date: inDays(12) });
  await gotoTab(page, "command"); await settle(page);
  const steps = () => page.evaluate(STEPS);

  // --- 1. a blank event: everything open, and the date is a calendar fact ---
  let s = await steps();
  checks.equal(s.map((x) => x.key), ["plan", "guests", "seating", "check", "handover", "day"], "six steps, in the order an event is prepared");
  checks.equal(s.slice(0, 5).map((x) => x.state), ["open", "open", "open", "open", "open"], "on a blank event every preparation step is open");
  checks.ok(s[5].state === "upcoming" && /12 gün sonra/.test(s[5].text), "and the event day is counted in whole calendar days", s[5]);
  checks.equal(s.slice(0, 5).map((x) => x.go), ["floor", "guests", "seating", "check", "handover"], "every open step carries the control for it");
  await click(page, '[data-timeline-go="guests"]');
  checks.equal(await page.evaluate(() => ui.tab), "guests", "an open step's control goes there");

  // --- 2. done steps show the RECORDED moment, and only a recorded one ------
  await gotoTab(page, "floor"); await settle(page);
  await addTables(page, { quantity: 2 });
  const guestAt = "2026-03-04T10:00:00.000Z";
  await page.evaluate((at) => {
    const e = activeEvent();
    e.guests.push({ id: "g1", name: "Ayşe Demir", additionalGuests: 1, pax: 2, planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, vip: "Standard", invitedBy: "", notes: "", createdAt: at });
    touchEvent(e); ui.tab = "command"; render();
  }, guestAt);
  await settle(page);
  s = await steps();
  checks.ok(s[0].state === "done" && s[0].date === null,
    "tables added by hand: the plan step is done, with NO date — none was recorded, so none is shown", s[0]);
  checks.ok(s[1].state === "done" && s[1].date === guestAt, "the guest step shows when the first guest was actually recorded", s[1]);
  checks.ok(s[2].state === "open" && /2 kişiden 0/.test(s[2].text), "seating is arithmetic over the guest list: 0 of 2 pax", s[2]);
  // Asserted HERE, where there is something to count: on a blank event there
  // is no ratio to turn into a percentage, so the check could not fail there.
  checks.ok(!/%|tahmin|forecast|yolunda|on track/i.test(s.map((x) => x.text).join(" ")),
    "with guests to count, still no percentage and no forecast — a count is stated as a count", s.map((x) => x.text));
  await page.evaluate(() => { const e = activeEvent(); e.guests[0].assignment = { tableId: e.tables[0].id, seats: [0, 1], locked: false }; touchEvent(e); render(); });
  await settle(page);
  s = await steps();
  checks.equal(s[2].state, "done", "with everyone seated, the seating step is done");

  // --- 3. the final check: run, then made stale by a change ----------------
  await click(page, '[data-timeline-go="check"]');
  await settle(page);
  s = await steps();
  checks.ok(s[3].state === "done" && s[3].date, "running the final check from the timeline records it, with its moment", s[3]);
  await page.evaluate(() => { const e = activeEvent(); e.guests.push({ id: "g2", name: "Can Öztürk", additionalGuests: 0, pax: 1, planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
    assignment: null, vip: "Standard", invitedBy: "", notes: "", createdAt: new Date().toISOString() }); touchEvent(e); render(); });
  await settle(page);
  s = await steps();
  checks.ok(s[3].state === "stale" && /değişti/.test(s[3].text) && s[3].go === "check",
    "after a change the check found something new about, it is NOT done: it says the event changed, and offers to run it again", s[3]);

  // --- 4. event day: today, and past ----------------------------------------
  await page.evaluate((d) => { activeEvent().date = d; render(); }, inDays(0));
  await settle(page);
  checks.ok((await steps())[5].state === "today", "on the day it says today");
  await page.evaluate((d) => { activeEvent().date = d; render(); }, "");
  await settle(page);
  checks.ok(/tarih kaydedilmemiş/.test((await steps())[5].text), "an event with no date says so, rather than inventing one");

  // A Completed event has no Command Center (history shows Guests, Seating and
  // Reports), so readinessTimelineHTML's historical guard is defensive and not
  // reachable today — a check for it here could never fail, and is not kept.
}
