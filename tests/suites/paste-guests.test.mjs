// "LISTE YAPIŞTIR" (owner 2026-11-02: a messy list from WhatsApp / e-mail becomes guests).
//
//   READ: one guest per line; "+2", "3 kişi", "eşiyle", "ve 2 arkadaşı", "and his wife" → people;
//     a phone; " - host"; titles and list marks off; a line with no letters skipped; a line that is
//     not a name said unreadable, never added.
//   SHOWN FIRST: nothing is added until "Ekle"; a likely duplicate is unticked and said so.
//   ADDED AS ONE RECORD PER PARTY through the guest writer ("Ahmet +2" is one record, pax 3).
// Mutation proof, recorded 2026-11-02: before the change there was no paste → every check fails.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openApp, createBlankEvent, futureDate, settle, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "paste-guests", tags: ["business", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  for (const f of ["assistant-tools.js", "messy-list.js"]) await import(pathToFileURL(path.join(repoRoot, "src", f)).href);
  const M = globalThis.MeritMessyList;
  const rows = M.parse("1. Ahmet Bey +2\n- Ayşe Hanım eşiyle\nMehmet Kaya (3 kişi) - Kerem Sarıçiçek\n0532 111 22 33 Can Öztürk\nDr. Elif Şen ve 2 arkadaşı\nJohn Smith and his wife\n•••\nbunlar geç gelecekmiş masa sonra belli olur dedi", [{ name: "Can Öztürk", phone: "0532 111 22 33" }]);
  checks.equal(rows.filter((r) => !r.problem).map((r) => `${r.name}|${r.pax}|${r.host || ""}|${r.phone || ""}`),
    ["Ahmet|3||", "Ayşe|2||", "Mehmet Kaya|3|Kerem Sarıçiçek|", "Can Öztürk|1||05321112233", "Elif Şen|3||", "John Smith|2||"], "names, people, host and phone are read; titles and marks come off");
  checks.ok(rows.find((r) => r.name === "Can Öztürk").duplicateOf === "Can Öztürk", "a guest already on the list is spotted (phone)");
  checks.ok(rows.some((r) => r.problem === "unreadable") && !rows.some((r) => /•/.test(r.name || "")), "a line that is not a name is unreadable; a line of marks is skipped");

  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Liste Testi", date: futureDate() });
  await page.evaluate(() => { const e = state.events[0]; e.guests = [{ id: "x", name: "Can Öztürk", additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived", assignment: null, createdAt: "" }]; touchEvent(e); render(); });
  await gotoTab(page, "guests"); await settle(page);
  await page.click('[data-guest-command="paste"]');
  await page.fill(".paste-guests .paste-text", "Ahmet Yılmaz +2\nAyşe Demir eşiyle - Kerem Sarıçiçek\ncan ozturk");
  await page.click('.paste-guests [data-paste="preview"]');
  const pv = await page.evaluate(() => ({ n: document.querySelectorAll(".paste-table tbody tr").length, ticked: [...document.querySelectorAll(".paste-table tbody input")].map((i) => i.checked), guests: state.events[0].guests.length }));
  checks.ok(pv.n === 3 && pv.ticked.join() === "true,true,false" && pv.guests === 1, "shown first: three rows, the duplicate unticked, nothing added yet", pv);
  await page.click('.paste-guests [data-paste="add"]'); await settle(page);
  const after = await page.evaluate(() => state.events[0].guests.map((g) => `${g.name}|${g.pax}|${g.invitedBy || ""}`).sort());
  checks.equal(after, ["Ahmet Yılmaz|3|", "Ayşe Demir|2|Kerem Sarıçiçek", "Can Öztürk|1|"], "added as one record per party, with the host; the duplicate left out");
}
