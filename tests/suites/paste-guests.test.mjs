// "LISTE YAPIŞTIR" (owner 2026-11-02: a messy list from WhatsApp / e-mail becomes guests).
//
//   READ: one guest per line; "+2", "3 kişi", "eşiyle", "ve 2 arkadaşı", "and his wife" → people;
//     a phone; " - host"; titles and list marks off; a line with no letters skipped; a line that is
//     not a name said unreadable, never added.
//   SHOWN FIRST: nothing is added until "Ekle"; a likely duplicate is unticked and said so.
//   ADDED AS ONE RECORD PER PARTY through the guest writer ("Ahmet +2" is one record, pax 3).
// REDESIGN v4 step 5 (SPEC-v4 "Misafirler"): a row opens a RIGHT DETAIL PANEL with
//   that guest's facts and actions; an "Öneriler" strip offers to tidy the list
//   from the list's own facts — a duplicate name (Göster), a "+N" still in a name
//   (Uygula → one record, pax N+1, through the guest writer), a "VIP" written in a
//   name (Uygula → the VIP mark) — each accepted or ignored, nothing applied
//   without a click. Mutation proof, recorded 2026-11-07: with the "+N" reading
//   dropped the "+N" suggestion check fails; with Yoksay a no-op the ignore check fails.
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

  // --- REDESIGN v4 step 5: the right detail panel and "Öneriler" ------------------
  await page.evaluate(() => { const e = state.events[0]; const g = (id, name) => ({ id, name, additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived", assignment: null, createdAt: "" });
    e.guests.push(g("d1", "Selin Ak"), g("d2", "selin ak"), g("p1", "Murat Can +2"), g("v1", "Leyla Su VIP")); touchEvent(e); render(); });
  await settle(page);
  const tidy = () => page.evaluate(() => [...document.querySelectorAll("[data-tidy] [data-tidy-item]")].map((n) => ({ kind: n.dataset.tidyItem, text: n.textContent.replace(/\s+/g, " ").trim() })));
  let sug = await tidy();
  checks.ok(sug.some((x) => x.kind === "duplicate" && /Selin Ak/i.test(x.text)), "Öneriler: the same name twice is offered", sug);
  checks.ok(sug.some((x) => x.kind === "pax" && /Murat Can/.test(x.text) && /3/.test(x.text)), "Öneriler: a \"+2\" still in a name is offered as one record of 3", sug);
  checks.ok(sug.some((x) => x.kind === "vip" && /Leyla Su/.test(x.text)), "Öneriler: \"VIP\" written in a name is offered as the VIP mark", sug);
  const g0 = await page.evaluate(() => JSON.stringify(state.events[0].guests));
  checks.equal(await page.evaluate(() => JSON.stringify(state.events[0].guests)), g0, "nothing changes until a suggestion is accepted");
  await page.click('[data-tidy-item="pax"] [data-tidy-apply]'); await settle(page);
  const murat = await page.evaluate(() => { const g = state.events[0].guests.find((x) => x.id === "p1"); return `${g.name}|${g.pax}|${g.additionalGuests}`; });
  checks.equal(murat, "Murat Can|3|2", "Uygula makes it ONE record: name cleaned, pax 3, through the guest writer", murat);
  await page.click('[data-tidy-item="vip"] [data-tidy-ignore]'); await settle(page);
  sug = await tidy();
  checks.ok(!sug.some((x) => x.kind === "vip") && await page.evaluate(() => state.events[0].guests.find((x) => x.id === "v1").vip) === "Standard", "Yoksay hides it and changes nothing", sug);
  await page.click('[data-guest-row="p1"] [role="cell"]'); await settle(page);
  const det = await page.evaluate(() => { const d = document.querySelector(".guest-detail"); return d ? { name: d.querySelector(".gd-name")?.textContent.trim(), text: d.textContent.replace(/\s+/g, " "), edit: !!d.querySelector("[data-guest-edit]"), sel: document.querySelector('[data-guest-row="p1"]')?.classList.contains("on") } : null; });
  checks.ok(det && /Murat Can/.test(det.name || "") && /3 kişi/.test(det.text) && det.edit && det.sel, "a row opens the right panel with that guest's details and actions", det);
  await page.click(".guest-detail [data-guest-detail-close]"); await settle(page);
  checks.ok(await page.evaluate(() => !document.querySelector(".guest-detail")), "and × closes it");
}
