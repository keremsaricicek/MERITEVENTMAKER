// THE EVENTS HOME IS A QUIET MONTH CALENDAR (owner-approved v3, SPEC-v2.md
// "Owner's verdict on v2/v3"; prototype benchmarks/ux/redesign/6-birlesik).
//
//   ONE SLIM ENTRY PER EVENT on its own day, Monday first; past events grey
//     with a lock and read-only; today's date marked; ‹ › months and "Bugün".
//   A CLICK SELECTS, nothing jumps: the calm right panel fills with the date,
//     the venue, Kişi / Masa / Oturmuş / Geldi from the event's own records,
//     "Hazır mı?" from the Plan Doctor (the one judge), "Etkinliği aç",
//     "Aynı yerleşimle yeni" and ⋯ (Çoğalt, Dışa aktar, Sil) — the existing
//     writers, bound by the shell exactly as before.
//   A PAST EVENT changes nothing by being shown: it opens read-only.
//
// Mutation proof, recorded 2026-11-07: before the change (hero card + lists)
// every check fails at ".cal-screen"; with the past class dropped from entries
// "a past event is grey with a lock" fails; with the shell's selection binding
// removed "a click selects" fails; with the facts read from physical chairs
// the seats line reads 0 and "Masa carries the room's logical seats" fails.
import { click, openApp, createBlankEvent, addTables, settle, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "events-calendar", tags: ["ui", "business", "fast"], timeout: 150000 };

const CAL = `(() => {
  const s = document.querySelector(".cal-screen");
  if (!s) return null;
  const panel = s.querySelector(".cal-detail");
  return {
    month: s.querySelector(".cal-month")?.textContent.trim() || "",
    dow: [...s.querySelectorAll(".cal-dow span")].map((x) => x.textContent.trim()),
    today: s.querySelector(".cal-cell.today .cal-dn")?.textContent.trim() || null,
    entries: [...s.querySelectorAll("[data-cal-event]")].map((b) => ({ id: b.dataset.calEvent, name: b.querySelector("b")?.textContent.trim(),
      past: b.classList.contains("past"), lock: !!b.querySelector("svg"), on: b.classList.contains("on"), history: b.hasAttribute("data-history-event") })),
    newBtn: !!s.querySelector('.mx-head [data-action="create-event"]'),
    title: panel?.querySelector(".cal-d-title")?.textContent.trim() || null,
    eyebrow: panel?.querySelector(".cal-d-eyebrow")?.textContent.trim() || null,
    venue: panel?.querySelector(".cal-d-meta")?.textContent.replace(/\\s+/g, " ").trim() || null,
    facts: Object.fromEntries([...(panel?.querySelectorAll("[data-cal-fact]") || [])].map((d) => [d.dataset.calFact, d.querySelector("dd")?.textContent.trim()])),
    seats: panel?.querySelector('[data-cal-fact="tables"] .cal-sub')?.textContent.trim() || null,
    ready: [...(panel?.querySelectorAll(".cal-ready li") || [])].map((li) => li.textContent.replace(/\\s+/g, " ").trim()),
    open: !!panel?.querySelector("[data-open-event]"),
    same: !!panel?.querySelector("[data-duplicate-layout]"),
    more: [...(panel?.querySelectorAll("details.cal-more [data-duplicate-event], details.cal-more [data-export-event-package], details.cal-more [data-delete-event]") || [])]
      .map((b) => Object.keys(b.dataset)[0]),
  };
})()`;
const monthLabel = (offset) => `(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + (${offset}));
  const m = new Intl.DateTimeFormat("tr-TR", { month: "long" }).format(d); return m.charAt(0).toLocaleUpperCase("tr-TR") + m.slice(1) + " " + d.getFullYear(); })()`;

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });

  // --- 1. an empty install: the month, today, no invented event ---------------
  const empty = await page.evaluate(CAL);
  checks.ok(empty, "the events home is the month calendar", empty);
  if (!empty) return;
  checks.equal(empty.month, await page.evaluate(monthLabel(0)), "it opens on this month when there is no event", empty.month);
  checks.equal(empty.dow, ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"], "Monday first, Turkish weekday heads", empty.dow);
  checks.equal(empty.today, String(new Date().getDate()), "today's date is marked", empty.today);
  checks.equal(empty.entries.length, 0, "a blank install shows no event — nothing is invented", empty.entries);
  checks.ok(empty.newBtn, "+ Yeni etkinlik sits at the top right of the page", empty);

  // --- 2. a real upcoming event: its entry and the calm panel ------------------
  await createBlankEvent(page, { name: "Takvim Galası", hotel: "Merit Royal", salon: "Grand Balo", date: futureDate(12) });
  await addTables(page, { quantity: 2 });
  await page.evaluate(() => {
    const e = state.events.find((x) => x.name === "Takvim Galası");
    e.tables.forEach((t) => { t.hasPhysicalSeats = false; t.chairs = []; t.capacity = 8; });
    e.guests = [
      { id: "cg1", name: "Ayşe Demir", additionalGuests: 2, pax: 3, vip: "", invitedBy: "", notes: "", planningStatus: "Confirmed", arrivalStatus: "Checked In", assignment: { tableId: e.tables[0].id, seats: [0, 1, 2], locked: false }, createdAt: "" },
      { id: "cg2", name: "Can Öz", additionalGuests: 0, pax: 1, vip: "", invitedBy: "", notes: "", planningStatus: "Tentative", arrivalStatus: "Not Arrived", assignment: null, createdAt: "" },
    ];
    touchEvent(e); saveState();
  });
  await click(page, '[data-action="back-events"]');
  await settle(page);
  const up = await page.evaluate(CAL);
  const upId = await page.evaluate(() => state.events.find((x) => x.name === "Takvim Galası").id);
  const upEntry = up.entries.find((x) => x.id === upId);
  checks.ok(upEntry && !upEntry.past && upEntry.name === "Takvim Galası", "the event sits on its day as one slim entry", up.entries);
  checks.ok(upEntry && upEntry.on, "the event you came back from is the selected one", up.entries);
  checks.equal(up.month, await page.evaluate(`(() => { const d = new Date(Date.now() + 12 * 86400000);
    const m = new Intl.DateTimeFormat("tr-TR", { month: "long" }).format(d); return m.charAt(0).toLocaleUpperCase("tr-TR") + m.slice(1) + " " + d.getFullYear(); })()`),
    "the calendar shows that event's month", up.month);
  checks.equal(up.title, "Takvim Galası", "the panel names it", up);
  checks.ok(/Merit Royal/.test(up.venue || "") && /Grand Balo/.test(up.venue || ""), "with its venue", up.venue);
  checks.equal(up.facts, { pax: "4", tables: "2", seated: "3", arrived: "3" },
    "Kişi / Masa / Oturmuş / Geldi from the event's own records (pax, not rows)", up.facts);
  checks.ok(/16/.test(up.seats || ""), "Masa carries the room's logical seats (symbolic tables count) — never physical chairs", up.seats);
  checks.ok(up.ready.length >= 1 && up.ready.length <= 4, "Hazır mı? lists at most four lines from the Plan Doctor", up.ready);
  checks.ok(up.open && up.same, "Etkinliği aç and Aynı yerleşimle yeni are on the panel", up);
  checks.equal(up.more.sort(), ["deleteEvent", "duplicateEvent", "exportEventPackage"], "⋯ holds Çoğalt, Dışa aktar and Sil", up.more);

  // --- 3. a past event: grey, locked, read-only --------------------------------
  await createBlankEvent(page, { name: "Geçen Yıl", hotel: "Merit Park", date: "2020-03-14" });
  await click(page, '[data-action="back-events"]');
  await settle(page);
  const past = await page.evaluate(CAL);
  const pastEntry = past.entries.find((x) => x.name === "Geçen Yıl");
  checks.equal(past.month, "Mart 2020", "the past event's month", past.month);
  checks.ok(pastEntry && pastEntry.past && pastEntry.lock && pastEntry.history, "a past event is grey with a lock", pastEntry);
  checks.ok(/salt okunur/i.test(past.eyebrow || ""), "its panel says read-only", past.eyebrow);
  checks.ok(past.ready.some((l) => /değiştirilemez/.test(l)), "and that it can no longer be changed", past.ready);
  const beforeOpen = await page.evaluate(() => JSON.stringify(state.events.find((x) => x.name === "Geçen Yıl")));
  await click(page, ".cal-detail [data-open-event]");
  await settle(page);
  const opened = await page.evaluate(() => ({ screen: ui.screen, tabs: [...document.querySelectorAll(".tabs [data-tab]")].map((b) => b.dataset.tab) }));
  checks.ok(opened.screen === "workspace" && !opened.tabs.includes("floor") && !opened.tabs.includes("live"), "opening it is read-only — no Salon, no Kapı", opened);
  checks.equal(await page.evaluate(() => JSON.stringify(state.events.find((x) => x.name === "Geçen Yıl"))), beforeOpen, "showing and opening a past event changed nothing in it");
  await click(page, '[data-action="back-events"]');
  await settle(page);

  // --- 4. months: ‹ › and Bugün --------------------------------------------------
  await click(page, '[data-cal-month="1"]');
  checks.equal((await page.evaluate(CAL)).month, "Nisan 2020", "› goes one month on");
  await click(page, '[data-cal-month="-1"]'); await click(page, '[data-cal-month="-1"]');
  checks.equal((await page.evaluate(CAL)).month, "Şubat 2020", "‹ goes one month back");
  await click(page, '[data-cal-month="0"]');
  const now = await page.evaluate(CAL);
  checks.equal(now.month, await page.evaluate(monthLabel(0)), "Bugün returns to this month", now.month);
  checks.equal(now.today, String(new Date().getDate()), "with today marked");

  // --- 5. a click selects; nothing else moves -----------------------------------
  for (let i = 0; i < 2 && !(await page.evaluate(CAL)).entries.some((x) => x.id === upId); i++) await click(page, '[data-cal-month="1"]');
  await click(page, `[data-cal-event="${upId}"]`);
  const sel = await page.evaluate(() => ({ screen: ui.screen }));
  const after = await page.evaluate(CAL);
  checks.ok(sel.screen === "events" && after.title === "Takvim Galası" && after.entries.find((x) => x.id === upId)?.on,
    "a click selects the entry and fills the panel; the screen stays", { sel, title: after.title });

  // --- 6. Aynı yerleşimle yeni goes through the existing writer -------------------
  const n0 = await page.evaluate(() => state.events.length);
  await click(page, ".cal-detail [data-duplicate-layout]");
  await settle(page);
  const copy = await page.evaluate(() => { const e = state.events[0]; return { n: state.events.length, guests: e.guests.length, tables: e.tables.length, screen: ui.screen }; });
  checks.equal(copy, { n: n0 + 1, guests: 0, tables: 2, screen: "workspace" }, "same layout, nobody comes along, and the new event opens", copy);

  // --- 7. English keys are complete ----------------------------------------------
  await page.evaluate(() => { ui.lang = "en"; ui.screen = "events"; render(); });
  const en = await page.evaluate(CAL);
  checks.equal(en.dow, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], "English weekday heads", en.dow);
  checks.ok(en.ready.length >= 1 && !en.ready.some((l) => /^[a-z]+\.[a-zA-Z.]+$/.test(l)), "no raw key in the panel", en.ready);
}
