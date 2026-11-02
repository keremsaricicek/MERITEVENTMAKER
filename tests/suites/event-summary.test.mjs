// THE ONE-PAGE EVENT SUMMARY AND THE GUEST'S PAST ON THE CARD (owner 2026-11-02).
//
//   SUMMARY: expected / came / did not come / not marked in PEOPLE (pax), per host or junket,
//     and the tables that were planned but saw nobody arrive. Counts only; nothing changes.
//   A HOSTILE HOST OR NAME PRINTS AS TEXT.
//   THE CARD: a returning guest's past (events, came, did not come, tables) from our own records;
//     a first-timer is said to be one. Facts only — never a prediction.
// Mutation proof, recorded 2026-11-02: before the change there was no summary and no history line.
import { click, openApp, createBlankEvent, addTables, gotoTab, settle } from "../lib/app-actions.mjs";

export const meta = { name: "event-summary", tags: ["reports", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Özet Testi" });
  await addTables(page, { quantity: 3 });
  const before = await page.evaluate(() => {
    const e = state.events[0], mk = (id, name, pax, host, arr, ti) => ({ id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: host, notes: "", planningStatus: "Confirmed",
      arrivalStatus: arr, assignment: ti == null ? null : { tableId: e.tables[ti].id, seats: null, locked: false }, createdAt: "" });
    e.guests = [mk("a", "Ahmet Yılmaz", 4, "Kerem Sarıçiçek", "Checked In", 0), mk("b", "Can Er", 2, "Kerem Sarıçiçek", "No Show", 1), mk("c", "Ece Ak", 1, "", "Not Arrived", null),
      mk("d", "Zeki Su", 1, '<img src=x onerror="window.__pwned=1">', "Checked In", 0)];
    // a past event where Ahmet Yılmaz sat at T08 and came
    state.events.push({ id: "past1", name: "Bahar Galası", date: "2025-04-01", hotel: "", salon: "", status: "Completed", tables: [{ id: "pt", number: "T08", capacity: 8, chairs: [] }], venueObjects: [],
      guests: [{ id: "pa", name: "Ahmet Yılmaz", additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "", notes: "", planningStatus: "Confirmed", arrivalStatus: "Checked In", assignment: { tableId: "pt", seats: [0], locked: false }, createdAt: "" }] });
    touchEvent(e); render();
    return JSON.stringify(state.events);
  });
  await gotoTab(page, "reports"); await settle(page);
  await page.evaluate(() => { window.print = () => {}; });
  await click(page, "[data-report='summary']");
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => ({ kpis: [...document.querySelectorAll("#printRoot .sum-kpis b")].map((b) => b.textContent),
    host: [...document.querySelectorAll("#printRoot .sum-table tbody tr")].map((r) => [...r.children].map((c) => c.textContent)),
    text: document.getElementById("printRoot").textContent, pwned: !!window.__pwned || !!document.querySelector("#printRoot img") }));
  checks.equal(s.kpis, ["8", "5", "2", "1"], "expected / came / did not come / not marked, in people");
  checks.ok(s.host.some((r) => r[0] === "Kerem Sarıçiçek" && r[1] === "6" && r[2] === "4" && r[3] === "2"), "per host: expected, came, did not come", s.host);
  checks.ok(/T ?02/.test(s.text) && /Can Er/.test(s.text), "the table nobody came to and the no-shows are named", s.text.slice(0, 300));
  checks.ok(!s.pwned, "a hostile host or name prints as text");
  await page.evaluate(() => { const cl = () => { document.body.classList.remove("printing"); document.getElementById("printRoot").innerHTML = ""; }; cl(); });
  await gotoTab(page, "guests"); await settle(page);
  await page.evaluate(() => openGuestDialog("a"));
  const line = await page.locator("#guestDialog .guest-history").textContent();
  checks.ok(/1 etkinliğimiz/.test(line) && /1 kez geldi/.test(line) && /T ?08/.test(line), "a returning guest's past is on the card", line);
  await page.evaluate(() => document.getElementById("guestDialog").close());
  await page.evaluate(() => openGuestDialog("c"));
  checks.ok(/ilk kez/.test(await page.locator("#guestDialog .guest-history").textContent()), "a first-timer is said to be one");
  await page.evaluate(() => document.getElementById("guestDialog").close());
  checks.equal(await page.evaluate(() => JSON.stringify(state.events)), before, "nothing changes");
}
