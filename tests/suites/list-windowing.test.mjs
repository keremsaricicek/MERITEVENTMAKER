// THE GUESTS LIST AND THE SEATING QUEUE MOUNT A WINDOW, AND NOTHING AN
// OPERATOR RELIES ON CHANGES.
//
// Measured in §26 (benchmarks/perf/README.md): at 3,000 guests the Guests
// screen mounted every record — about 70,000 DOM nodes — and its render ran a
// median of ~250 ms with a p95 up to 733 ms, breaking the performance
// contract's rule that a large list is never O(n) nodes in the guest count.
// Live's door list was already windowed; this one was not, and neither was
// Seating's guest queue (23,833 DOM nodes at 3,000 guests, 5,601 of them the
// drawing).
//
// Windowing is only an improvement if it is invisible to everything but the
// node count, so this holds it to what `live-windowing-correctness` holds the
// door to: the same order, the same counts, search and filter over EVERY
// record, a stated "showing X of Y", and a keyboard that keeps its place.
// It also carries the §23 door bug in the shape it had here: focus restored on
// the next frame with a caret read before render, so fast typing reordered
// letters.
import { openApp, createBlankEvent, futureDate, gotoTab, settle } from "../lib/app-actions.mjs";

export const meta = { name: "list-windowing", tags: ["business", "ui", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Pencere", hotel: "Merit", date: futureDate() });
  const seed = (n) => page.evaluate((n) => {
    const e = activeEvent();
    e.guests = [];
    for (let i = 0; i < n; i++) e.guests.push({ id: "g" + i, name: "MISAFIR " + String(i + 1).padStart(4, "0"), additionalGuests: i % 7 === 0 ? 2 : 0,
      pax: i % 7 === 0 ? 3 : 1, planningStatus: i % 2 ? "Tentative" : "Confirmed", vip: "Standard", arrivalStatus: "Not Arrived", checkedInAt: null,
      invitedBy: "", notes: "", assignment: null, createdAt: new Date().toISOString() });
    touchEvent(e); ui.guestQuery = ""; ui.guestFilter = "all"; ui.guestWindow = null; render();
  }, n);
  const rows = () => page.evaluate(() => [...document.querySelectorAll(".mx-list .mx-row")].map((r) => r.querySelector("[role=cell]")?.textContent || ""));
  const expected = (n) => page.evaluate((n) => filteredGuests(activeEvent()).slice(0, n).map((g) => g.name), n);
  const more = () => page.evaluate(() => document.getElementById("guestMore")?.textContent.trim() || null);

  // --- 1. 450 records: 200 mounted, in the list's own order, and it says so --
  await seed(450);
  await gotoTab(page, "guests");
  await settle(page);
  let mounted = await rows();
  checks.equal(mounted.length, 200, "450 guests mount 200 rows, not 450");
  const first200 = await expected(200);
  checks.ok(first200.every((name, i) => mounted[i].includes(name)), "the mounted rows are the list's first 200, in its own order", { first: mounted[0], expectedFirst: first200[0] });
  checks.ok(/450/.test(await more()) && /200/.test(await more()), "and the list says it is showing 200 of 450", await more());
  checks.ok(await page.evaluate(() => /450/.test(document.querySelector(".mx-head p")?.textContent || "")), "the header still counts every record");

  // --- 2. show more grows it, keeps the keyboard's place, then goes away ----
  await page.focus('[data-guest-command="show-more"]');
  await page.keyboard.press("Enter");
  await settle(page);
  checks.equal((await rows()).length, 400, "Show more (by keyboard) mounts the next 200");
  checks.equal(await page.evaluate(() => document.activeElement?.dataset?.guestCommand), "show-more", "and focus stays on Show more, so the keyboard keeps its place");
  await page.click('[data-guest-command="show-more"]');
  await settle(page);
  checks.equal((await rows()).length, 450, "the last press mounts the remaining 50");
  checks.equal(await more(), null, "and with nothing hidden the control is gone");

  // --- 3. search covers EVERY record, and a new search starts from the top --
  // Measured before the fix, typing at full speed through the base binder:
  // "Mehmet Yılmaz" arrived as "MeheYm", "misafir 1" as "mifir".
  for (const typed of ["Mehmet Yılmaz", "misafir 1"]) {
    await page.fill("#guestSearch", "");
    await page.dispatchEvent("#guestSearch", "input");
    await page.locator("#guestSearch").pressSequentially(typed, { delay: 0 });
    await settle(page);
    checks.equal(await page.inputValue("#guestSearch"), typed, `typed at full speed, "${typed}" arrives in the order it was typed`);
  }
  await page.fill("#guestSearch", "MISAFIR 0420");
  await page.dispatchEvent("#guestSearch", "input");
  await settle(page);
  mounted = await rows();
  checks.ok(mounted.length === 1 && mounted[0].includes("MISAFIR 0420"), "search finds a record far outside the first window", mounted);
  await page.fill("#guestSearch", "MISAFIR 0");
  await page.dispatchEvent("#guestSearch", "input");
  await settle(page);
  checks.equal((await rows()).length, 200, "a broad search starts again at a window of 200 — the grown window does not carry over");
  checks.ok(/450/.test(await more() || ""), "and says how many it matched", await more());

  // --- 4. a filter works over every record, and resets the window ----------
  await page.fill("#guestSearch", "");
  await page.dispatchEvent("#guestSearch", "input");
  await settle(page);
  await page.click('[data-guest-command="show-more"]');
  await settle(page);
  checks.equal((await rows()).length, 400, "(grown to 400 before changing the filter)");
  await page.selectOption("#guestFilter", "tentative");
  await settle(page);
  const tentative = await page.evaluate(() => activeEvent().guests.filter((g) => g.planningStatus === "Tentative").length);
  checks.equal((await rows()).length, 200, `the Tentative filter (${tentative} records) mounts a window of 200`);
  checks.ok((await more() || "").includes(String(tentative)), "and counts every Tentative record, not the mounted ones", await more());

  // --- 5. at stress size the mounted list stays bounded --------------------
  await seed(3000);
  await settle(page);
  const big = await page.evaluate(() => ({ rows: document.querySelectorAll(".mx-list .mx-row").length, nodes: document.getElementsByTagName("*").length }));
  checks.equal(big.rows, 200, "3,000 guests still mount 200 rows");
  checks.ok(big.nodes < 12000, `and the whole screen is ${big.nodes} DOM nodes (was ~70,000 in §26)`, big);

  // --- 6. the Seating queue: same window, same guarantees -----------------
  await seed(450);
  await gotoTab(page, "seating");
  await settle(page);
  const cards = () => page.evaluate(() => [...document.querySelectorAll(".seat-queue-list [data-seating-guest]")].map((c) => c.dataset.seatingGuest));
  const queueMore = () => page.evaluate(() => document.querySelector(".seat-queue-more")?.textContent.trim() || null);
  let q = await cards();
  const queueOrder = await page.evaluate(() => activeEvent().guests.filter((g) => !g.assignment).map((g) => g.id));
  checks.equal(q.length, 150, "450 unassigned guests mount 150 queue cards");
  checks.ok(q.every((id, i) => id === queueOrder[i]), "in the queue's own order");
  checks.ok(/450/.test(await queueMore() || "") && /150/.test(await queueMore() || ""), "and the queue says it is showing 150 of 450", await queueMore());
  await page.focus("[data-seating-action='queue-more']");
  await page.keyboard.press("Enter");
  await settle(page);
  checks.equal((await cards()).length, 300, "Show more (by keyboard) mounts the next 150");
  checks.equal(await page.evaluate(() => document.activeElement?.dataset?.seatingAction), "queue-more", "and focus stays on Show more");
  // Shift-click selects a RANGE of records; the range is taken from the full
  // list, so the window must not change what it covers.
  await page.click(`[data-seating-guest="${queueOrder[10]}"]`);
  await page.click(`[data-seating-guest="${queueOrder[40]}"]`, { modifiers: ["Shift"] });
  checks.equal(await page.evaluate(() => ui.selectedGuestIds.length), 31, "shift-click still selects the 31 records between two cards");
  for (const typed of ["Mehmet Yılmaz", "misafir 1"]) {
    await page.fill("#seatingSearch", "");
    await page.dispatchEvent("#seatingSearch", "input");
    await page.locator("#seatingSearch").pressSequentially(typed, { delay: 0 });
    await settle(page);
    checks.equal(await page.inputValue("#seatingSearch"), typed, `the Seating search keeps "${typed}" in the order it was typed`);
  }
  await page.fill("#seatingSearch", "MISAFIR 0420");
  await page.dispatchEvent("#seatingSearch", "input");
  await settle(page);
  q = await cards();
  checks.ok(q.length === 1 && q[0] === "g419", "the Seating search finds a guest far outside the window", q);
  await page.fill("#seatingSearch", "");
  await page.dispatchEvent("#seatingSearch", "input");
  await settle(page);
  checks.equal((await cards()).length, 150, "clearing the search starts the queue again at 150, not at the grown 300");
  await page.click('[data-seating-scope="all"]');
  await settle(page);
  checks.equal((await cards()).length, 150, "and a scope change does too");
  await seed(3000);
  await page.evaluate(() => { ui.tab = "seating"; render(); });
  await settle(page);
  const seat = await page.evaluate(() => ({ cards: document.querySelectorAll(".seat-queue-list [data-seating-guest]").length, nodes: document.getElementsByTagName("*").length }));
  checks.ok(seat.cards === 150 && seat.nodes < 9000, `at 3,000 guests Seating mounts 150 cards and ${seat.nodes} nodes (was 23,833 in §26)`, seat);
}
