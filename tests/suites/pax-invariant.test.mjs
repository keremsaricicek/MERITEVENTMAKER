// Section 20 (single source of truth audit): guest.pax must never drift
// from 1 + guest.additionalGuests.
//
// additionalGuests is the fact an operator actually enters; pax is a
// redundant CACHED field, recomputed as 1+additionalGuests at five
// independent write sites (normalizeGuest, the guest-dialog submit
// handler, the import wizard's revalidateInterpreted/
// importInterpretedGuests, and the demo-seed data). Every site is
// correct today -- this suite does not find a live bug -- but there is
// no single setter enforcing the relationship, and paxOf() reads the
// cached field directly rather than recomputing it, so a future write
// site that sets additionalGuests without also setting pax would drift
// silently with nothing to catch it. This is a cheap invariant check
// across the real, UI-driven flows this project's own suites already
// exercise, not a refactor into a computed property -- that would touch
// every read site (paxOf, exports, reports, Excel import/export) and is
// out of scope without a real bug driving it.
import { click, openApp, createBlankEvent, addGuest, gotoTab, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "pax-invariant", tags: ["business", "fast"], timeout: 60000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "PaxCheck", hotel: "Merit Royal", date: futureDate() });
  await gotoTab(page, "guests");

  // --- 1. manual add via the guest dialog -----------------------------------
  await addGuest(page, { name: "Pax Guest", additionalGuests: 3 });
  const afterAdd = await page.evaluate(() => {
    const g = state.events[0].guests.find((x) => x.name === "Pax Guest");
    return { additionalGuests: g.additionalGuests, pax: g.pax };
  });
  checks.equal(afterAdd.pax, 1 + afterAdd.additionalGuests,
    "a manually added guest's pax equals 1 + additionalGuests right after creation", afterAdd);

  // --- 2. manual edit via the same dialog, changing the party size ---------
  const guestId = await page.evaluate(() => state.events[0].guests.find((x) => x.name === "Pax Guest").id);
  await click(page, `[data-guest-edit="${guestId}"]`);
  await page.waitForSelector("#guestForm", { state: "visible", timeout: 5000 });
  await page.fill('#guestForm input[name="additionalGuests"]', "0");
  await click(page, "#guestForm .dialog-foot .btn.primary");
  await page.waitForFunction(
    (id) => state.events[0].guests.find((x) => x.id === id).additionalGuests === 0,
    guestId, { timeout: 5000 });
  const afterEdit = await page.evaluate((id) => {
    const g = state.events[0].guests.find((x) => x.id === id);
    return { additionalGuests: g.additionalGuests, pax: g.pax };
  }, guestId);
  checks.equal(afterEdit.pax, 1 + afterEdit.additionalGuests,
    "editing the party size down keeps pax in sync, not left at the old cached value", afterEdit);

  // --- 3. the demo-seed data (seedGuests/createDemoEvent, src/app.js) -------
  // Called directly rather than through a UI action -- these are the
  // production seed-data generators themselves, exercised the same way a
  // brand-new "load a sample event" action would.
  const seedResult = await page.evaluate(() => {
    const guests = seedGuests();
    return { count: guests.length, allHold: guests.every((g) => g.pax === 1 + g.additionalGuests) };
  });
  checks.require(seedResult.count > 0, "seedGuests() produces a real, non-empty guest list", seedResult.count);
  checks.ok(seedResult.allHold, "every seeded demo guest's pax equals 1 + additionalGuests", seedResult);

  const demoEventResult = await page.evaluate(() => {
    const event = createDemoEvent();
    return { count: event.guests.length, allHold: event.guests.every((g) => g.pax === 1 + g.additionalGuests) };
  });
  checks.require(demoEventResult.count > 0, "createDemoEvent() produces a real, non-empty guest list too", demoEventResult.count);
  checks.ok(demoEventResult.allHold, "and the same invariant holds for every guest inside a freshly created demo event", demoEventResult);
}
