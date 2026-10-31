// Theatre seating as real plan objects: a ROW of chairs, no table surface.
//
//   A ROW IS SEATS, NOT FURNITURE. A chair row is a seating object (`type:
//   "row"`) whose chairs stand in one line facing the stage; it has no table
//   surface, and a guest is seated in it like at any table — seat for seat.
//
//   THE PLANNER'S ROWS ARE THE ROWS DRAWN. A theatre brief's chairs group into
//   rows of at most fourteen, one per block each side of the centre aisle; the
//   seats of the rows add up to the option's capacity, and Uygula draws exactly
//   those rows — one Geri al takes them all back.
//
//   A LONGER ROW IS A LONGER OBJECT. Raising a row's seats widens it in step, so
//   its chairs keep their spacing instead of being squeezed together.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openApp, createBlankEvent, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "theatre-rows", tags: ["planner", "assistant", "ui", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  // ---- pure: the geometry of a row and the planner's grouping -------------------
  await import(pathToFileURL(path.join(repoRoot, "src/event-rules.js")).href);
  await import(pathToFileURL(path.join(repoRoot, "src/planner-layout.js")).href);
  const g = globalThis.MeritEventRules.chairGeometry({ type: "row", capacity: 4 }, 4);
  checks.equal(g.map((p) => [Math.round(p.x * 10) / 10, p.y, p.rotation]), [[12.5, 50, 180], [37.5, 50, 180], [62.5, 50, 180], [87.5, 50, 180]],
    "a row's chairs stand in one line, evenly spaced, all facing the front");
  const L = globalThis.MeritPlannerLayout;
  checks.ok(typeof L.rows === "function", "the layout engine groups a theatre arrangement into rows");
  if (typeof L.rows === "function") {
    for (const b of [{ pax: 250, room_w_m: 15, room_l_m: 25, event: "theatre" }, { pax: 120, room_w_m: 14, room_l_m: 20, event: "theatre", stage: { depth_m: 4 } }]) {
      const p = L.plan(b), rows = L.rows(p);
      checks.equal(rows.reduce((s, r) => s + r.seats, 0), p.capacity, `${b.pax} pax: the rows' seats add up to the capacity shown`);
      checks.ok(rows.every((r) => r.seats >= 1 && r.seats <= p.defaults.seatsPerRowMax), `${b.pax} pax: every row has 1–${p.defaults.seatsPerRowMax} seats`);
      const bad = [];
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) if (L.overlaps(rows[i], rows[j])) bad.push([i, j]);
      checks.equal(bad, [], `${b.pax} pax: no two rows overlap`);
      checks.ok(rows.every((r) => r.x - r.w / 2 >= -1e-6 && r.x + r.w / 2 <= p.room.w + 1e-6 && r.y + r.h / 2 <= p.room.l + 1e-6), `${b.pax} pax: every row is inside the walls`);
    }
    checks.equal(L.rows(L.plan({ pax: 100, area_m2: 150, event: "banquet" })), [], "a banquet has no chair rows");
  }

  // ---- in the app: F8 brief → Uygula draws rows a guest can sit in ---------------
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Konferans", date: futureDate() });
  await page.keyboard.press("F8");
  await page.waitForSelector("#assistantPanel:not([hidden])", { timeout: 5000 });
  await page.fill("#assistantInput", "Salon 14x20 metre, 120 kişilik konferans, tiyatro düzeni");
  await page.press("#assistantInput", "Enter");
  await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 5000 });
  await settle(page);
  checks.ok(await page.locator(".assistant-option .assistant-apply").count() >= 1, "a theatre option can be applied (it is no longer shown only)");
  if (await page.locator(".assistant-option .assistant-apply").count()) {
    const want = await page.evaluate(() => { const p = MeritPlannerLayout.plan(MeritAssistantParse.brief("Salon 14x20 metre, 120 kişilik konferans, tiyatro düzeni")); return { rows: MeritPlannerLayout.rows(p).length, cap: p.capacity }; });
    await page.click(".assistant-option .assistant-apply");
    await settle(page);
    const drawn = await page.evaluate(() => { const ts = activeEvent().tables; return { n: ts.length, rows: ts.filter((x) => x.type === "row").length, cap: ts.reduce((s, x) => s + x.capacity, 0), chairsMatch: ts.every((x) => x.chairs.length === x.capacity) }; });
    checks.equal(drawn, { n: want.rows, rows: want.rows, cap: want.cap, chairsMatch: true }, "Uygula draws exactly the rows the option showed, each with its own chairs", { drawn, want });
    const surface = await page.evaluate(() => { const el = document.querySelector(".table-object.row .table-surface"); if (!el) return null; const s = getComputedStyle(el); return { bg: s.backgroundColor, border: s.borderTopWidth }; });
    checks.ok(surface && /rgba\(0, 0, 0, 0\)|transparent/.test(surface.bg) && surface.border === "0px", "a row is drawn without a table surface", surface);
    const seated = await page.evaluate(() => {
      const e = activeEvent(), row = e.tables.find((x) => x.type === "row");
      e.guests.push({ id: "gr1", name: "Deniz Kaya", additionalGuests: 1, pax: 2, planningStatus: "Confirmed", vip: "Standard", invitedBy: "", notes: "", arrivalStatus: "Not Arrived", checkedInAt: null, assignment: null, createdAt: new Date().toISOString() });
      assignGuestToTable("gr1", row.id);
      const a = e.guests.find((x) => x.id === "gr1").assignment;
      return a && a.tableId === row.id ? a.seats.length : 0;
    });
    checks.equal(seated, 2, "a party of two is seated in a row, a seat each");
    await page.evaluate(() => { const e = activeEvent(); e.guests = e.guests.filter((x) => x.id !== "gr1"); render(); });

    // a longer row is a longer object
    const grown = await page.evaluate(() => {
      const e = activeEvent(), row = e.tables.filter((x) => x.type === "row").pop(), c0 = row.capacity, w0 = row.w;
      const gap0 = (row.chairs[1].x - row.chairs[0].x) / 100 * row.w;
      setTableCapacity(e, row, c0 * 2);
      const gap1 = (row.chairs[1].x - row.chairs[0].x) / 100 * row.w;
      return { ratio: Math.round(row.w / w0 * 100) / 100, sameGap: Math.abs(gap1 - gap0) < 1, chairs: row.chairs.length === c0 * 2, number: /^S\d\d$/.test(row.number) };
    });
    checks.equal(grown, { ratio: 2, sameGap: true, chairs: true, number: true }, "twice the seats makes the row twice as long, chairs as far apart as before; rows are numbered S01…", grown);

    await page.locator(".assistant-undo").last().click();
    await settle(page);
    checks.equal(await page.evaluate(() => activeEvent().tables.length), 0, "one Geri al takes every row back");
  }
  checks.equal(pageErrors, [], "no page errors");
}
