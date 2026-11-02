// F8 BATCH SEATING (owner 2026-11-02): "masasızları yerleştir", "VIP'leri VIP masalara al".
//
//   SHOWN FIRST, THEN ONAYLA — never carried out by itself.
//   A host's guests land together; no taken seat, no unavailable or frozen table, no split record.
//   Whoever does not fit is NAMED, not dropped. "masası olmayanlar kim" stays a question.
// Mutation proof, recorded 2026-11-02: before the change neither command was read → every check fails.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openApp, createBlankEvent, addTables, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "assistant-batch", tags: ["assistant", "fast"], timeout: 180000 };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  for (const f of ["assistant-tools.js", "assistant-parse.js"]) await import(pathToFileURL(path.join(repoRoot, "src", f)).href);
  const P = globalThis.MeritAssistantParse;
  const op = (x) => { const r = P.parse(x, [], "2020-01-01"); return r.kind === "command" ? r.plan[0].op : r.kind; };
  checks.equal(["masasizlari yerlestir", "Masası olmayanları uygun masalara dağıt", "seat everyone", "VIP'leri VIP masalara al", "move the VIPs to the VIP tables", "masası olmayanlar kim", "VIP'ler ön masalarda otursun"].map(op),
    ["seatUnassigned", "seatUnassigned", "seatUnassigned", "vipToVipTables", "vipToVipTables", op("masası olmayanlar kim"), "ruleVipFront"], "batch commands are read; a question stays a question; a rule stays a rule");
  checks.ok(op("masası olmayanlar kim") !== "seatUnassigned", "\"masası olmayanlar kim\" is never a batch move");

  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Toplu Test", date: futureDate() });
  await addTables(page, { quantity: 3 });
  await page.evaluate(() => {
    const e = state.events[0];
    e.tables.forEach((t, i) => { t.capacity = 4; });
    e.tables[2].availability = "UNAVAILABLE"; e.tables[2].availabilityReason = "BROKEN";
    const mk = (id, name, pax, host, ti) => ({ id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: host, notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: ti == null ? null : { tableId: e.tables[ti].id, seats: Array.from({ length: pax }, (_, i) => i), locked: false }, createdAt: "" });
    e.guests = [mk("s", "Sabit Kişi", 2, "", 0), mk("a", "Ayla Kerem", 2, "Kerem Sarıçiçek", null), mk("b", "Berk Kerem", 1, "Kerem Sarıçiçek", null), mk("c", "Cem Tek", 2, "", null), mk("d", "Dev Grup", 4, "", null)];
    touchEvent(e); render();
  });
  await page.keyboard.press("F8");
  await page.waitForSelector("#assistantPanel:not([hidden])", { timeout: 5000 });
  await page.fill("#assistantInput", "masasizlari yerlestir"); await page.press("#assistantInput", "Enter");
  await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 20000 });
  const shown = await page.evaluate(() => ({ confirm: !!document.querySelector(".assistant-turn.assistant:last-child .assistant-confirm"), text: [...document.querySelectorAll(".assistant-turn.assistant")].pop().textContent,
    seated: state.events[0].guests.filter((g) => g.assignment).length }));
  checks.ok(shown.confirm && shown.seated === 1, "the batch is shown first; nobody moves yet", shown);
  checks.ok(/Yer kalmadı: .*(Dev Grup|Cem Tek)/.test(shown.text), "whoever does not fit is named", shown.text);
  await page.click(".assistant-turn.assistant:last-child .assistant-confirm"); await settle(page);
  const r = await page.evaluate(() => { const e = state.events[0], at = (id) => (e.guests.find((g) => g.id === id).assignment || {}).tableId || null;
    const load = {}; for (const g of e.guests) if (g.assignment) load[g.assignment.tableId] = (load[g.assignment.tableId] || 0) + g.pax;
    return { a: at("a"), b: at("b"), s: at("s"), t0: e.tables[0].id, t2: e.tables[2].id, load, cap: 4 }; });
  checks.ok(r.a && r.a === r.b, "the host's guests sit together", r);
  checks.ok(r.s === r.t0 && Object.values(r.load).every((n) => n <= r.cap) && !Object.keys(r.load).includes(r.t2), "no taken seat taken, no table over capacity, the unavailable table unused", r);

  // Seating's "Taslak yerleşim" asks F8 the same thing: shown first, nothing moves
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const e = state.events[0]; e.guests.push({ id: "z", name: "Zeki Yeni", additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived", assignment: null, createdAt: "" }); touchEvent(e); ui.screen = "workspace"; ui.tab = "seating"; render(); });
  await settle(page);
  await page.click(".seat-draft");
  await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 20000 });
  const d = await page.evaluate(() => ({ confirm: !!document.querySelector(".assistant-turn.assistant:last-child .assistant-confirm"), z: !!state.events[0].guests.find((g) => g.id === "z").assignment }));
  checks.ok(d.confirm && !d.z, "Seating's draft button proposes through F8 and moves nobody before Onayla", d);
}
