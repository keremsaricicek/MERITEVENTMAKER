// OTURMA, redesign 2026-11-12 (benchmarks/ux/redesign/SPEC-v4.md, "Owner 2026-11-12" and
// "Owner's verdict 2026-11-11"):
//   LIST LEFT, PLAN RIGHT, and the suggestions in a right panel with "Özet" (the technical
//     summary) BELOW them — not in the guest list, not floating over the plan.
//   THE OCCUPANCY RING: grey = boş, green = yer var, amber = dolmak üzere (≥ 80 %),
//     red = dolu. Derived from the same seats the drawing counts; stored nowhere.
//   HOVERING A GUEST lights his table and glows his own seats neon red; leaving clears it.
//     A view decoration: nothing is written.
// Mutation proof, recorded 2026-11-12: against the previous Oturma (suggestions inside the
// list, the pill floating on the plan, no ring, no hover) every check from "the right
// panel" on fails; with occBand's 80 % threshold changed to 90 % the amber check fails.
import { click, openApp, createBlankEvent, gotoTab, settle, futureDate, addTables, addGuest, seatGuestOnFirstTable } from "../lib/app-actions.mjs";

export const meta = { name: "oturma-layout", tags: ["ui", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Oturma Gala", date: futureDate(15) });
  await settle(page);
  await gotoTab(page, "floor");
  await addTables(page, { quantity: 3 });
  await gotoTab(page, "guests");
  await addGuest(page, { name: "Ayşe Demir", additionalGuests: 2 });
  await seatGuestOnFirstTable(page, "Ayşe Demir");
  await gotoTab(page, "seating");
  await click(page, '[data-seating-scope="all"]');
  await settle(page);

  const layout = await page.evaluate(() => {
    const stage = document.querySelector(".seat-stage");
    const box = (s) => { const n = stage && stage.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
    return { queue: box(":scope > .seat-queue"), canvas: box(":scope > .seat-canvas-col"), side: box(":scope > .seat-side"),
      adviceInList: !!document.querySelector(".seat-queue .seat-advice"), adviceInSide: !!document.querySelector(".seat-side .seat-advice"),
      summary: document.querySelector(".seat-side .seat-summary h3")?.textContent.trim() || null,
      summaryText: document.querySelector(".seat-side .seat-summary .seat-pill")?.textContent.trim() || "",
      pillOnPlan: !!document.querySelector(".seat-canvas-col .seat-pill") };
  });
  checks.ok(layout.queue && layout.canvas && layout.side && layout.queue.right <= layout.canvas.left + 1 && layout.canvas.right <= layout.side.left + 1,
    "the guest list is left, the plan in the middle, the right panel on the right", layout);
  checks.ok(layout.side && layout.side.width >= 280 && layout.side.width <= 330, "the right panel is the template's ~320 px", layout.side);
  checks.ok(layout.adviceInSide && !layout.adviceInList, "the suggestions live in the right panel, not in the guest list", layout);
  checks.equal(layout.summary, "Özet", "\"Özet\" sits below the suggestions", layout.summary);
  checks.ok(/3/.test(layout.summaryText) && !layout.pillOnPlan, "the technical summary moved under the suggestions, off the plan", layout);

  // The ring, from the seats the drawing counts (3 seated of the table's capacity).
  const ring = await page.evaluate(() => {
    const ev = state.events[0], seated = ev.tables[0], other = ev.tables[1];
    const cls = (t) => [...document.querySelector(`.seat-canvas-col .table-object[data-object-id="${t.id}"]`).classList].filter((c) => c.startsWith("occ-"));
    return { cap: seated.capacity, first: cls(seated), second: cls(other) };
  });
  const want = ring.cap <= 3 ? "occ-full" : 3 / ring.cap >= 0.8 ? "occ-near" : "occ-free";
  checks.equal(ring.first, [want], `a table with 3 of ${ring.cap} seated carries ${want}`, ring);
  checks.equal(ring.second, ["occ-empty"], "an empty table is grey (occ-empty)", ring);
  const bands = await page.evaluate(() => {
    const ev = state.events[0], t = ev.tables[1], cap = t.capacity, out = {};
    for (const n of [0, Math.ceil(cap * 0.5), Math.ceil(cap * 0.8), cap]) {
      ev.guests.push({ id: "probe", name: "Probe", additionalGuests: n - 1, pax: n, vip: "", invitedBy: "", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
        assignment: n ? { tableId: t.id, seats: Array.from({ length: n }, (_, i) => i), locked: false } : null, createdAt: "" });
      render();
      out[n] = [...document.querySelector(`.seat-canvas-col .table-object[data-object-id="${t.id}"]`).classList].find((c) => c.startsWith("occ-")) || null;
      ev.guests.pop();
    }
    render();
    return { cap, out };
  });
  const v = Object.values(bands.out);
  checks.equal(v, ["occ-empty", "occ-free", "occ-near", "occ-full"], "empty → grey, half → green, 80 % → amber, full → red", bands);

  // Hover lights the guest's table and his own seats; leaving clears it; nothing is written.
  await click(page, '[data-seating-scope="all"]');
  await settle(page);
  const before = await page.evaluate(() => JSON.stringify(state.events[0].guests.map((g) => g.assignment)));
  await page.hover('[data-seating-guest]:has-text("Ayşe Demir")');
  await page.waitForTimeout(400); // the chairs fade (transition) into the neon
  const lit = await page.evaluate(() => {
    const g = state.events[0].guests.find((x) => x.name === "Ayşe Demir"), tb = document.querySelector(`.seat-canvas-col .table-object[data-object-id="${g.assignment.tableId}"]`);
    const chairs = [...tb.querySelectorAll(".chair")];
    return { hot: tb.classList.contains("guest-hot"), others: document.querySelectorAll(".seat-canvas-col .guest-hot").length,
      seats: chairs.map((c, i) => (c.classList.contains("guest-seat") ? i : -1)).filter((i) => i >= 0), want: chairs.length ? g.assignment.seats.filter((i) => i < chairs.length) : [],
      neon: chairs.length ? getComputedStyle(tb.querySelector(".chair.guest-seat") || tb).backgroundColor : "rgb(255, 23, 68)" };
  });
  checks.ok(lit.hot && lit.others === 1, "hovering a seated guest lights his table, and only it", lit);
  checks.equal(lit.seats, lit.want, "his own seats glow, no others", lit);
  checks.equal(lit.neon, "rgb(255, 23, 68)", "in neon red (#FF1744)", lit.neon);
  await page.mouse.move(5, 5);
  checks.equal(await page.evaluate(() => document.querySelectorAll(".seat-canvas-col .guest-hot,.seat-canvas-col .guest-seat").length), 0, "leaving the row clears the light", null);
  checks.equal(await page.evaluate(() => JSON.stringify(state.events[0].guests.map((g) => g.assignment))), before, "hovering writes nothing", null);
}
