// THE DOOR LIST (owner 2026-11-02): every guest record A–Z, party size, table.
//
//   ONE RECORD PER PARTY. "Mehmet Yılmaz +3" is one line, never four.
//   TURKISH ORDER. Çağla after Cem, İpek after Irmak, Şule after Sinan.
//   A GUEST WITH NO TABLE IS SAID SO (—), never dropped from the list.
//   A NAME IS TEXT. A hostile name prints as text, never as markup.
//   NOTHING CHANGES. Printing touches no record.
// Mutation proof, recorded 2026-11-02: before the change there is no door list → every check fails.
import { click, openApp, createBlankEvent, addTables, gotoTab, settle } from "../lib/app-actions.mjs";

export const meta = { name: "door-list", tags: ["reports", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Kapı Testi" });
  await addTables(page, { quantity: 3 });
  const before = await page.evaluate(() => {
    const e = state.events[0], mk = (id, name, pax, vip) => ({ id, name, additionalGuests: pax - 1, pax, vip: vip || "Standard", invitedBy: "", notes: "",
      planningStatus: "Confirmed", arrivalStatus: "Not Arrived", assignment: null, createdAt: new Date().toISOString() });
    e.guests = [mk("a", "Şule Kaya", 1), mk("b", "Cem Ak", 2, "VIP"), mk("c", "Çağla Er", 1), mk("d", "Mehmet Yılmaz", 4), mk("e", "Irmak Su", 1), mk("f", "İpek Ay", 1),
      mk("g", "Sinan Öz", 1), mk("h", '<img src=x onerror="window.__pwned=1">', 1)];
    e.guests[3].assignment = { tableId: e.tables[1].id, seats: [0, 1, 2, 3], locked: false };
    e.guests[1].assignment = { tableId: e.tables[0].id, seats: [0, 1], locked: false };
    touchEvent(e); render();
    return JSON.stringify(e.guests);
  });
  await gotoTab(page, "reports"); await settle(page);
  await page.evaluate(() => { window.print = () => {}; });
  await click(page, "[data-report='door']");
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#printRoot .door-list tbody tr")].map((r) => [r.querySelector(".dn").textContent.trim(), r.querySelector(".dt").textContent.trim()]));
  const names = rows.map((r) => r[0].replace(/\s+(\+\d+|VIP)\b.*$/, ""));
  checks.equal(rows.length, 8, "one line per guest record (a party of four is one line)");
  checks.equal(names.filter((n) => !n.startsWith("<")), ["Cem Ak", "Çağla Er", "Irmak Su", "İpek Ay", "Mehmet Yılmaz", "Sinan Öz", "Şule Kaya"], "Turkish alphabetical order");
  checks.ok(rows.some((r) => /^Mehmet Yılmaz\s+\+3$/.test(r[0]) && /^T\s?0?2$/.test(r[1])), "the party shows as +3 with its table", rows);
  checks.ok(rows.some((r) => /^Cem Ak\s+\+1\s+VIP$/.test(r[0])), "VIP is marked", rows);
  checks.equal(rows.find((r) => r[0].startsWith("Şule"))[1], "—", "a guest with no table gets a dash, not dropped");
  checks.ok(await page.evaluate(() => !window.__pwned && !document.querySelector("#printRoot img")), "a hostile name prints as text");
  checks.equal(await page.evaluate(() => JSON.stringify(state.events[0].guests)), before, "printing changes no record");
}
