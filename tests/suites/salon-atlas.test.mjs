// SALON, Atlas (owner 2026-11-13, zip temalar/tema-a "Salon"): the room on the left with
// nothing floating over it; a 360 px right panel with the venue, the hall, "N masa · X / Y
// kişi yerleşti", "Planı oku", "+ Masa ekle" and the legend; the hall drawn with walls.
// DOMAIN RULE (CLAUDE.md "Physical chair ≠ logical seat"): a table that records NO chairs
// gets its logical seats marked as decoration only — <i class="seat-mark">, never ".chair",
// never written to table.chairs; a table WITH chairs draws its chairs and no marks.
// Mutation proof, recorded 2026-11-12: with seatMarksHTML returning "" the marks check
// fails; with the marks given class "chair" the "never a chair" check fails; against the
// previous Salon (floating toolbar, fab on the plan) every panel check fails.
import { openApp, createBlankEvent, gotoTab, settle, futureDate, addTables } from "../lib/app-actions.mjs";

export const meta = { name: "salon-atlas", tags: ["ui", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Atlas Gala", hotel: "Merit Royal Hotel", salon: "Grand Balo Salonu", date: futureDate(12) });
  await settle(page);
  await gotoTab(page, "floor");
  await addTables(page, { quantity: 2 });
  await settle(page);

  const panel = await page.evaluate(() => {
    const side = document.querySelector(".salon-v5 .salon-side"), room = document.querySelector(".salon-v5 .salon-room");
    const r = side && side.getBoundingClientRect(), q = room && room.getBoundingClientRect();
    return { side: !!side, width: r ? Math.round(r.width) : 0, right: r && q ? r.left >= q.right - 1 : false,
      title: side?.querySelector("h2")?.textContent.trim() || null, line: side?.querySelector(".salon-side-head p")?.textContent.trim() || "",
      read: !!side?.querySelector('[data-v8-action="replace-bg"]'), add: !!side?.querySelector(".planmap-fab"), toolbarInSide: !!side?.querySelector(".planmap-toolbar"),
      floating: document.querySelectorAll(".salon-room .planmap-toolbar, .salon-room .planmap-fab, .salon-room .planmap-status-pill").length, legend: side?.querySelectorAll(".salon-legend li").length || 0 };
  });
  checks.ok(panel.side && panel.right && panel.width >= 340 && panel.width <= 380, "a ~360 px panel sits to the right of the room", panel);
  checks.equal(panel.title, "Grand Balo Salonu", "the panel names the hall", panel);
  checks.ok(/^2 masa · 0 \/ \d+ kişi yerleşti$/.test(panel.line), "\"N masa · X / Y kişi yerleşti\", read from the event", panel.line);
  checks.ok(panel.read && panel.add && panel.toolbarInSide && panel.legend === 4, "Planı oku, + Masa ekle, the view tools and the legend live in the panel", panel);
  checks.equal(panel.floating, 0, "nothing floats over the room", panel);

  const walls = await page.evaluate(() => !!document.querySelector(".salon-room .canvas-world .room-walls"));
  checks.ok(walls, "the hall is drawn with its walls", walls);

  // decorative seats vs real chairs
  const seats = await page.evaluate(() => {
    const ev = state.events[0], a = ev.tables[0], b = ev.tables[1];
    a.chairs = []; a.hasPhysicalSeats = false; a.capacity = 10;
    render();
    const el = (t) => document.querySelector(`.salon-room .table-object[data-object-id="${t.id}"]`);
    return { marks: el(a).querySelectorAll(".seat-mark").length, chairsDrawn: el(a).querySelectorAll(".chair").length, chairsData: a.chairs.length,
      realChairs: b.chairs.length, realDrawn: el(b).querySelectorAll(".chair").length, realMarks: el(b).querySelectorAll(".seat-mark").length };
  });
  checks.equal([seats.marks, seats.chairsDrawn, seats.chairsData], [10, 0, 0], "a table with no chairs: 10 seat marks, never a chair, nothing written to table.chairs", seats);
  checks.ok(seats.realChairs > 0 ? seats.realDrawn === seats.realChairs && seats.realMarks === 0 : seats.realMarks > 0, "a table with real chairs draws them, and no marks", seats);
}
