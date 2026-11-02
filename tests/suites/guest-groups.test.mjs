// GROUPS AND JUNKETS (owner 2026-11-02: "Kerem Sarıçiçek'in misafirlerini aynı masaya al").
//
//   ONE HOST, ONE GROUP: "Davet Eden" folded ("KEREM SARICICEK" = "Kerem Sarıçiçek"); typed with case endings.
//   TOGETHER = ONE TABLE when one fits (preferring where they already sit), else the nearest few;
//     no seat already taken is taken, no unavailable table used, no record split.
//   F8 SHOWS THE MOVE FIRST and waits for Onayla; then the whole group sits together.
//   THE DOOR COUNTS PER GROUP (Live), and seating one member away from the group is SAID, not prevented.
// Mutation proof, recorded 2026-11-02: before the change none of this existed → every check fails.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openApp, createBlankEvent, addTables, futureDate, settle, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "guest-groups", tags: ["business", "fast"], timeout: 180000 };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  for (const f of ["assistant-tools.js", "assistant-parse.js", "guest-groups.js"]) await import(pathToFileURL(path.join(repoRoot, "src", f)).href);
  const G = globalThis.MeritGuestGroups, P = globalThis.MeritAssistantParse;
  const g = (id, host, pax, ti) => ({ id, name: "G" + id, pax, invitedBy: host, assignment: ti ? { tableId: ti } : null });
  const ev = { tables: [{ id: "t1", number: "T01", capacity: 8, x: 0, y: 0 }, { id: "t2", number: "T02", capacity: 6, x: 100, y: 0 }, { id: "t3", number: "T03", capacity: 10, x: 900, y: 0, availability: "UNAVAILABLE" }, { id: "t4", number: "T04", capacity: 10, x: 200, y: 0 }],
    guests: [g("1", "KEREM SARICICEK", 3, "t1"), g("2", "Kerem Sarıçiçek", 2, null), g("3", "kerem saricicek", 2, "t2"), g("4", "Loyalty Desk", 4, "t1")] };
  const h = G.findHost(ev, "kerem saricicegin");
  checks.ok(h.group && h.group.guests.length === 3, "one host, however it is written, with a case ending typed on", h);
  let p = G.plan(ev, h.group);
  checks.ok(p.steps && new Set(p.steps.map((s) => s.tableId)).size === 1 && p.steps[0].tableId !== "t3", "7 people fit one free table — together, never the unavailable one", p);
  ev.tables.forEach((t) => { if (t.id !== "t3") t.capacity = 4; });
  p = G.plan(ev, h.group);
  checks.ok(p.steps && p.steps.every((s) => s.tableId !== "t3") && p.tables.length >= 2, "when no table fits, the nearest few, records whole", p);
  const room = {}; for (const s of p.steps) { const gg = ev.guests.find((x) => x.id === s.guestId); room[s.tableId] = (room[s.tableId] || 0) + gg.pax; }
  checks.ok(Object.entries(room).every(([tid, n]) => n + (tid === "t1" ? 4 : 0) <= 4), "no seat already taken is taken", room);
  checks.equal(G.spread(ev).map((s) => s.host), ["KEREM SARICICEK"], "a group at several tables is found");
  const cmd = (x) => { const r = P.parse(x, [], "2020-01-01"); return r.kind === "command" ? r.plan[0].op + ":" + r.plan[0].host + ":" + (r.plan[0].table || "") : r.kind + ":" + (r.host || ""); };
  checks.equal(["Kerem Sarıçiçek'in misafirlerini aynı masaya al", "kerem saricicegin grubunu T05'e topla", "seat Kerem Sarıçiçek's guests together", "Kerem Sarıçiçek grubundan kaç kişi geldi"].map(cmd),
    ["groupTogether:Kerem Sarıçiçek:", "groupTogether:kerem saricicegin:T05", "groupTogether:Kerem Sarıçiçek:", "status:Kerem Sarıçiçek"], "the group commands and question are read, in both languages");

  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Grup Testi", date: futureDate() });
  await addTables(page, { quantity: 4 });
  await page.evaluate(() => {
    const e = state.events[0], mk = (id, name, pax, host, ti, arr) => ({ id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: host, notes: "", planningStatus: "Confirmed", arrivalStatus: arr || "Not Arrived",
      assignment: ti == null ? null : { tableId: e.tables[ti].id, seats: Array.from({ length: pax }, (_, i) => i + (id === "d" ? 4 : 0)), locked: false }, createdAt: "" });
    e.guests = [mk("a", "Ali Veli", 2, "Kerem Sarıçiçek", 0, "Checked In"), mk("b", "Ayşe Kara", 1, "KEREM SARICICEK", 1), mk("c", "Can Su", 1, "Kerem Sarıçiçek", null), mk("d", "Deniz Ak", 1, "", 2)];
    touchEvent(e); render();
  });
  await page.keyboard.press("F8");
  await page.waitForSelector("#assistantPanel:not([hidden])", { timeout: 5000 });
  await page.fill("#assistantInput", "Kerem Sarıçiçek'in misafirlerini aynı masaya al"); await page.press("#assistantInput", "Enter");
  await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 20000 });
  const shown = await page.evaluate(() => ({ confirm: !!document.querySelector(".assistant-turn.assistant:last-child .assistant-confirm"), moved: state.events[0].guests.filter((g) => g.invitedBy).map((g) => g.assignment && g.assignment.tableId) }));
  checks.ok(shown.confirm && new Set(shown.moved).size > 1, "F8 shows the group move first and moves nobody yet", shown);
  await page.click(".assistant-turn.assistant:last-child .assistant-confirm");
  await settle(page);
  const after = await page.evaluate(() => state.events[0].guests.filter((g) => g.invitedBy).map((g) => g.assignment && g.assignment.tableId));
  checks.ok(after.every(Boolean) && new Set(after).size === 1, "after Onayla the whole group sits at one table", after);
  await page.keyboard.press("Escape");
  await gotoTab(page, "live"); await settle(page);
  const live = await page.locator(".live-groups").textContent();
  checks.ok(/Kerem Sarıçiçek/.test(live) && /2 \/ 4/.test(live), "Live counts the group: 2 of 4 people arrived", live);
  await gotoTab(page, "seating"); await settle(page);
  const toast = await page.evaluate(() => { const e = state.events[0], other = e.tables.find((t) => t.id !== e.guests[0].assignment.tableId && !e.guests.some((g) => g.assignment && g.assignment.tableId === t.id));
    assignGuestToTable("c", other.id); return [...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" | "); });
  checks.ok(/Kerem Sarıçiçek grubundan/.test(toast), "seating a member away from the group is said (not prevented)", toast);

  // the junket report: its own workbook, per host and per guest; a formula-like name stays text
  await page.evaluate(() => { state.events[0].guests[3].invitedBy = "=HYPERLINK(1)"; touchEvent(state.events[0]); render(); });
  await gotoTab(page, "reports"); await settle(page);
  const wb = await page.evaluate(() => new Promise((res) => { const w = XLSX.writeFile; XLSX.writeFile = (book, name) => { XLSX.writeFile = w;
    res({ name, sheets: book.SheetNames, sum: XLSX.utils.sheet_to_json(book.Sheets["JUNKET SUMMARY"], { header: 1 }), list: XLSX.utils.sheet_to_json(book.Sheets["JUNKET GUESTS"], { header: 1 }) }); };
    document.querySelector("[data-report='junket']").click(); }));
  checks.equal(wb.sheets, ["JUNKET SUMMARY", "JUNKET GUESTS"], "the junket report is its own workbook");
  checks.ok(wb.sum.some((r) => r[0] === "Kerem Sarıçiçek" && r[1] === 4 && r[2] === 2), "per host: expected and came", wb.sum);
  checks.ok(wb.list.some((r) => r[0] === "'=HYPERLINK(1)"), "a formula-like host is written as text", wb.list);
}
