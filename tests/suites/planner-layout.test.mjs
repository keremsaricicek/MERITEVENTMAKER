// The AI planner's layout engine (src/planner-layout.js): the model gives
// numbers, this code draws — so the drawing must be right by construction.
//
//   NOTHING OVERLAPS, NOTHING LEAVES THE ROOM. Every table's footprint (its
//   chairs included) is clear of every other and inside the walls.
//
//   THE TOTAL IS THE SUM. The capacity reported is exactly the seats drawn —
//   a total that disagreed with its own tables is the failure a model would
//   make and the reason the model does not add up.
//
//   A SHORT BRIEF IS A QUESTION, NOT A GUESS. No room or no head count returns
//   what to ask, never an invented layout; an assumed room shape is said.
import path from "node:path";
import { pathToFileURL } from "node:url";

export const meta = { name: "planner-layout", tags: ["planner", "fast"], timeout: 30000 };

export default async function run({ checks, repoRoot }) {
  await import(pathToFileURL(path.join(repoRoot, "src/planner-layout.js")).href);   // a classic script: it publishes globalThis.MeritPlannerLayout
  const L = globalThis.MeritPlannerLayout;
  const briefs = [
    { name: "banquet 150 m², 100 pax, Ø180", b: { pax: 100, area_m2: 150, event: "banquet", table_kind: "round", table_diam_cm: 180 } },
    { name: "gala 20×30 m, 400 pax, Ø150", b: { pax: 400, room_w_m: 20, room_l_m: 30, event: "gala", table_kind: "round", table_diam_cm: 150 } },
    { name: "wedding 600 m², 450 pax, 10 a table", b: { pax: 450, area_m2: 600, event: "wedding", table_kind: "round", seats_per_table: 10 } },
    { name: "theatre 250 pax in 15×25 m", b: { pax: 250, room_w_m: 15, room_l_m: 25, event: "theatre" } },
    { name: "theatre with a stage", b: { pax: 120, room_w_m: 14, room_l_m: 20, event: "theatre", stage: { depth_m: 4 } } },
    { name: "classroom 60 pax, 180×60, 3 a table", b: { pax: 60, room_w_m: 14, room_l_m: 18, event: "classroom", table_len_cm: 180, table_wid_cm: 60, seats_per_table: 3 } },
    { name: "U 24 pax", b: { pax: 24, room_w_m: 10, room_l_m: 12, event: "u_shape" } },
    { name: "boardroom 16 pax", b: { pax: 16, area_m2: 60, event: "boardroom" } },
    { name: "cocktail 300 pax 25 bistros", b: { pax: 300, room_w_m: 15, room_l_m: 20, event: "cocktail", table_count: 25 } },
    { name: "square tables 80 pax", b: { pax: 80, room_w_m: 16, room_l_m: 20, event: "meeting", table_kind: "square", table_len_cm: 120, table_wid_cm: 120, seats_per_table: 8 } },
  ];
  for (const { name, b } of briefs) {
    const p = L.plan(b);
    checks.ok(p.ok && p.items.length > 0, `${name}: an arrangement comes back`, p.ask || p.notes);
    if (!p.ok) continue;
    const bad = [];
    for (let i = 0; i < p.items.length; i++) for (let j = i + 1; j < p.items.length; j++) if (L.overlaps(p.items[i], p.items[j])) bad.push([i, j]);
    checks.equal(bad.slice(0, 3), [], `${name}: no two footprints overlap`);
    const out = p.items.filter((t) => { const f = t.foot, w = Array.isArray(f) ? f[0] : f || t.w, h = Array.isArray(f) ? f[1] : f || t.h; return t.x - w / 2 < -1e-6 || t.y - h / 2 < -1e-6 || t.x + w / 2 > p.room.w + 1e-6 || t.y + h / 2 > p.room.l + 1e-6; });
    checks.equal(out.length, 0, `${name}: every footprint is inside the room`);
    const sum = p.items.reduce((s, t) => s + (t.seats || 0), 0);
    if (p.event !== "cocktail") checks.equal(p.capacity, sum, `${name}: the capacity is exactly the seats drawn`);
    checks.ok(p.fits ? p.capacity >= p.pax : p.notes.some((n) => /fits \d+ of \d+/.test(n)), `${name}: either everyone fits or the shortfall is said`, { capacity: p.capacity, pax: p.pax, notes: p.notes });
  }
  // the design's own example: 150 m², 100 people — tight for a banquet, and said
  const tight = L.plan({ pax: 100, area_m2: 150, event: "banquet", table_diam_cm: 180 });
  checks.ok(tight.m2PerPerson === 1.5 && tight.notes.some((n) => /shape assumed/.test(n)), "150 m² / 100 people = 1.5 m² a person, and the assumed room shape is said", tight);
  // round tables seat by diameter unless the brief says otherwise
  checks.equal([150, 180, 200].map(L.roundSeats), [8, 10, 12], "Ø150 → 8, Ø180 → 10, Ø200 → 12");
  // a short brief asks
  checks.equal(L.plan({ pax: 100, event: "banquet" }).ask, "room size (m² or width × length)", "no room: it asks for the room");
  checks.equal(L.plan({ area_m2: 200, event: "banquet" }).ask, "how many people", "no head count: it asks for it");
  // a stage pushes the seating back by its depth plus the gap
  const st = L.plan({ pax: 120, room_w_m: 14, room_l_m: 20, event: "theatre", stage: { depth_m: 4 } });
  checks.ok(Math.min(...st.items.map((t) => t.y - t.h / 2)) >= 0.6 + 4 + 1.5 - 1e-6, "the first row starts behind the stage and its 1.5 m gap", Math.min(...st.items.map((t) => t.y)));
  // a theatre row never asks anyone to pass more than 14 seats to an aisle
  const th = L.plan({ pax: 250, room_w_m: 40, room_l_m: 25, event: "theatre" });
  const rowY = new Map(); th.items.forEach((t) => rowY.set(t.y.toFixed(3), (rowY.get(t.y.toFixed(3)) || 0) + 1));
  checks.ok([...rowY.values()].every((n) => n <= 28), "a theatre row holds at most two blocks of 14 either side of the centre aisle", [...rowY.values()]);
}
