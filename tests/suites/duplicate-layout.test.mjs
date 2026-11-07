// SAME LAYOUT, NO GUESTS (owner 2026-11-02: "geçen etkinlikten kopyala").
//
//   THE ROOM COMES ALONG: table numbers, capacities, real chairs, positions and
//     venue objects, under new ids.
//   NOBODY COMES ALONG: no guest, seat, arrival or history — a blank event's rule.
//   NOT BORN HISTORICAL: dated ahead and Planning, so it can be worked on.
//   THE SOURCE IS UNTOUCHED.
// Mutation proof, recorded 2026-11-02: before the change there was no "Aynı düzen" → every check fails.
import { click, openApp, createBlankEvent, addTables, settle } from "../lib/app-actions.mjs";

export const meta = { name: "duplicate-layout", tags: ["business", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Bahar Galası" });
  await addTables(page, { quantity: 4 });
  const before = await page.evaluate(() => {
    const e = state.events[0];
    e.guests = [{ id: "g1", name: "Ahmet Yılmaz", additionalGuests: 1, pax: 2, vip: "VIP", invitedBy: "", notes: "", planningStatus: "Confirmed", arrivalStatus: "Checked In",
      assignment: { tableId: e.tables[0].id, seats: [0, 1], locked: false }, createdAt: "" }];
    e.venueObjects = [{ id: "v1", type: "stage", label: "SAHNE", x: 10, y: 10, w: 100, h: 40, rotation: 0, locked: true, z: 1 }];
    touchEvent(e); saveState(); ui.screen = "events"; render();
    return JSON.stringify(e);
  });
  await settle(page);
  await click(page, "[data-duplicate-layout]");
  await settle(page);
  const r = await page.evaluate(() => {
    const src = state.events.find((e) => e.name === "Bahar Galası"), copy = state.events.find((e) => e !== src);
    const shape = (t) => [t.number, t.capacity, (t.chairs || []).length, Math.round(t.x), Math.round(t.y)].join("|");
    return { n: state.events.length, src: JSON.stringify(src), copy: copy && { guests: copy.guests.length, tables: copy.tables.map(shape), srcTables: src.tables.map(shape),
      newIds: copy.tables.every((t) => !src.tables.some((s) => s.id === t.id)), objects: copy.venueObjects.map((o) => o.label), status: copy.status, date: copy.date,
      past: typeof isHistorical === "function" ? isHistorical(copy) : null, open: state.currentEventId === copy.id } };
  });
  checks.require(r.n === 2 && r.copy, "a second event exists", r);
  checks.equal(r.copy.guests, 0, "no guest comes along");
  checks.equal(r.copy.tables, r.copy.srcTables, "the same tables: numbers, capacities, chairs, positions");
  checks.ok(r.copy.newIds, "under new ids");
  checks.equal(r.copy.objects, ["SAHNE"], "the venue objects come along");
  checks.ok(r.copy.status === "Planning" && r.copy.date > new Date().toISOString().slice(0, 10) && r.copy.past !== true, "dated ahead, Planning, not historical", r.copy);
  checks.equal(r.src, before, "the source event is untouched");
}
