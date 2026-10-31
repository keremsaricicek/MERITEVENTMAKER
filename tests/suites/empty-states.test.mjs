// AN EMPTY SCREEN SAYS WHAT IS MISSING, TELLS THE TRUTH, AND OFFERS THE NEXT
// STEP — ONE TIP AT A TIME.
//
// `.claude/skills/merit-ui-quality-gates/SKILL.md`: "An empty state explains
// what to do next; it is not a blank panel", and "No warning flood."
//
// Measured on a brand-new blank event, in Turkish, at 1440 (§20 in
// benchmarks/MASTER-PROGRAMME-STATE.md):
//   · Live said "Tüm misafirler geldi" — "Everyone has arrived" — on an event
//     with no guests. Its list includes checked-in guests, so it is empty only
//     when there are none or a filter matches nobody: the sentence was never
//     true where it was shown.
//   · Seating's queue said "No MATCHING guest records" with no guests at all,
//     and again when every guest was already seated.
//   · The Floor Plan and Seating canvases were blank panels. The only sentence
//     saying what to do was the toast raised when the event was created.
//   · The Floor Plan offered "Show original plan" for a plan that does not
//     exist, and "Replace plan" when there was nothing to replace.
//   · Seating showed THREE onboarding tips at once.
// Every control below is pressed, not just found: an empty state whose button
// does nothing is a blank panel with a button on it.
import { openApp, createBlankEvent, addTables, futureDate, gotoTab, settle } from "../lib/app-actions.mjs";

export const meta = { name: "empty-states", tags: ["ui", "fast"], timeout: 180000 };

export default async function run({ page, checks, baseUrl }) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, baseUrl, { lang: "tr" });
  const t = (k, p) => page.evaluate(([k, p]) => t(k, p), [k, p]);
  const card = () => page.evaluate(() => {
    const c = document.querySelector("[data-canvas-empty]");
    return c ? { text: c.textContent.replace(/\s+/g, " ").trim(), buttons: [...c.querySelectorAll("button")].map((b) => b.textContent.trim()) } : null;
  });
  const callouts = () => page.evaluate(() => [...document.querySelectorAll(".onboarding-callout")].filter((n) => n.offsetParent).map((n) => n.dataset.onboarding));

  await createBlankEvent(page, { name: "Boş Etkinlik", hotel: "Merit Royal", date: futureDate() });

  // --- 1. the Floor Plan says it is empty, and both next steps work --------
  await gotoTab(page, "floor"); await settle(page);
  const floor = await card();
  checks.ok(floor && floor.text.includes(await t("empty.floor.title")) && floor.buttons.length === 2,
    "a blank Floor Plan says it is empty and offers two next steps — not a blank panel", floor);
  const toolbar = await page.evaluate(() => ({ toggle: !!document.querySelector('.planmap-toolbar [data-v8-action="toggle-bg"]'),
    replace: document.querySelector('.planmap-toolbar [data-v8-action="replace-bg"]')?.textContent.trim() }));
  checks.ok(!toolbar.toggle, "and it does not offer to show an original plan that does not exist", toolbar);
  checks.equal(toolbar.replace, await t("toolbar.importPlan"), "the plan control says IMPORT, not replace, when there is nothing to replace");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null),
    page.click('[data-canvas-empty] [data-v8-action="replace-bg"]')]);
  checks.ok(chooser, "its Import button opens the plan file chooser");
  await page.click('[data-canvas-empty] [data-v8-action="add"]');
  await settle(page);
  checks.ok(await page.evaluate(() => ui.v8AddOpen === true && !document.querySelector("[data-canvas-empty]")),
    "its Add button opens the add panel — and the card steps out of the way while adding");
  await page.evaluate(() => { ui.v8AddOpen = false; render(); });

  // --- 2. Seating: no tables, no guests — each said, each with its control --
  await gotoTab(page, "seating"); await settle(page);
  const seatCard = await card();
  checks.ok(seatCard && seatCard.text.includes(await t("empty.seating.title")),
    "Seating with no tables says there is nowhere to seat anyone", seatCard);
  const queue = await page.evaluate(() => document.querySelector(".seat-queue-list")?.textContent.replace(/\s+/g, " ").trim());
  checks.ok(queue.includes(await t("empty.noGuests")) && !queue.includes(await t("seating.noMatches")),
    "and its queue says there are no guests — not 'no matching guests'", queue);
  await page.click('.seat-queue-list [data-empty-action="go-guests"]');
  checks.equal(await page.evaluate(() => ui.tab), "guests", "the queue's control goes to Guests");
  await gotoTab(page, "seating"); await settle(page);
  await page.click('[data-canvas-empty] [data-empty-action="go-floor"]');
  checks.equal(await page.evaluate(() => ui.tab), "floor", "the canvas's control goes to the Floor Plan");

  // --- 3. Live: no guests is not "everyone has arrived" --------------------
  await gotoTab(page, "live"); await settle(page);
  const live = await page.evaluate(() => document.querySelector(".mx-empty")?.textContent.replace(/\s+/g, " ").trim());
  checks.ok(live && live.includes(await t("empty.noGuests")), "Live with no guests says so", live);
  checks.ok(!/Tüm misafirler geldi|Everyone has arrived/.test(live || ""), "and never that everyone has arrived", live);
  await page.click('.mx-empty [data-empty-action="go-guests"]');
  checks.equal(await page.evaluate(() => ui.tab), "guests", "its control goes to Guests");

  // --- 4. one tip at a time --------------------------------------------------
  for (const tab of ["command", "floor", "guests", "seating", "live", "reports"]) {
    await gotoTab(page, tab); await settle(page);
    const c = await callouts();
    checks.ok(c.length <= 1, `${tab}: at most one onboarding tip on screen`, c);
  }

  // --- 5. with tables and guests, the empty states give way ----------------
  await gotoTab(page, "floor"); await settle(page);
  await addTables(page, { quantity: 3 });
  await page.evaluate(() => {
    const e = activeEvent();
    e.guests.push({ id: "g1", name: "Ayşe Demir", additionalGuests: 0, pax: 1, planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: { tableId: e.tables[0].id, seats: [0], locked: false }, vip: "Standard", invitedBy: "", notes: "", createdAt: new Date().toISOString() });
    touchEvent(e); render();
  });
  await gotoTab(page, "floor"); await settle(page);
  checks.ok(!(await card()), "a Floor Plan with tables shows no empty card");
  await gotoTab(page, "seating"); await settle(page);
  checks.ok(!(await card()), "neither does Seating");
  // Every guest seated, Unassigned scope: the truth, and a way to see them.
  const allSeated = await page.evaluate(() => { ui.seatingGuestScope = "unassigned"; ui.seatingQuery = ""; render(); return document.querySelector(".seat-queue-list")?.textContent.replace(/\s+/g, " ").trim(); });
  checks.ok(allSeated.includes(await t("seating.allSeated")), "with everyone seated, the Unassigned queue says every guest has a seat — not 'no matches'", allSeated);
  await page.click('.seat-queue-list [data-empty-action="seating-scope-all"]');
  checks.ok(await page.evaluate(() => ui.seatingGuestScope === "all" && !!document.querySelector('[data-seating-guest="g1"]')),
    "and its control shows all guests, the seated one included");
  const noMatch = await page.evaluate(() => { ui.seatingQuery = "zzzz-nobody"; render(); return document.querySelector(".seat-queue-list")?.textContent.trim(); });
  checks.equal(noMatch, await t("seating.noMatches"), "'no matching guests' is kept for exactly the case it describes: a search that matched nobody");
  await page.evaluate(() => { ui.seatingQuery = ""; render(); });

  // --- 6. a completed event's empty states offer nothing to edit -----------
  // History shows Guests, Seating and Reports only (a Completed event has no
  // Live tab), so this is asserted on Seating — where the empty queue is.
  await page.evaluate(() => { const e = activeEvent(); e.guests = []; e.status = "Completed"; ui.tab = "seating"; ui.seatingQuery = ""; render(); });
  await settle(page);
  const hist = await page.evaluate(() => ({ tab: ui.tab, queue: document.querySelector(".seat-queue-list")?.textContent.replace(/\s+/g, " ").trim() || null,
    controls: document.querySelectorAll("[data-empty-action]").length }));
  checks.ok(hist.queue && hist.queue.includes("misafir yok"), "a historical event's Seating says it has no guests", hist);
  checks.equal(hist.controls, 0, "and offers no control that would edit it");
}
