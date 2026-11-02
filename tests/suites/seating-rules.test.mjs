// SEATING RULES (owner 2026-11-02): "şu iki kişi aynı masaya oturmasın", "VIP'ler önde".
//
//   A RULE WARNS, IT NEVER MOVES OR BLOCKS: seating two "apart" guests together still seats them,
//     and says the rule is broken; "bugün ne eksik" lists it.
//   RULES ARE KEPT: save → reload keeps them (normalised on load; an old event has none).
//   F8 READS THEM in Turkish and English; "kurallar" lists them; undo takes a rule back.
// Mutation proof, recorded 2026-11-02: before the change there were no rules → every check fails.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openApp, createBlankEvent, addTables, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "seating-rules", tags: ["business", "fast"], timeout: 180000 };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  for (const f of ["assistant-tools.js", "assistant-parse.js", "seating-rules.js"]) await import(pathToFileURL(path.join(repoRoot, "src", f)).href);
  const SR = globalThis.MeritSeatingRules, P = globalThis.MeritAssistantParse;
  checks.equal(SR.normalizeAll([{ kind: "apart", a: "x", b: "y" }, { kind: "apart", a: "y", b: "x" }, { kind: "vipFront" }, { kind: "vipFront" }, { kind: "bogus" }, null]).map((r) => r.kind), ["apart", "vipFront"],
    "rules are normalised: duplicates and junk dropped");
  const op = (x) => { const r = P.parse(x, [], "2020-01-01"); return r.kind === "command" ? r.plan[0].op + ":" + (r.plan[0].guest || "") + ":" + (r.plan[0].other || "") : r.kind + ":" + (r.what || ""); };
  checks.equal(["Ahmet Yılmaz ile Mehmet Kaya aynı masada oturmasın", "ahmet ve mehmet ayri otursun", "keep Ahmet and Mehmet apart", "VIP'ler ön masalarda otursun", "kurallar", "Ahmet ile Mehmet'i aynı masaya oturt"].map(op),
    ["ruleApart:Ahmet Yılmaz:Mehmet Kaya", "ruleApart:ahmet:mehmet", "ruleApart:Ahmet:Mehmet", "ruleVipFront::", "status:rules", op("Ahmet ile Mehmet'i aynı masaya oturt")],
    "rules are read in both languages; a positive 'aynı masaya oturt' is not a rule");
  checks.ok(!/^rule/.test(op("Ahmet ile Mehmet'i aynı masaya oturt")), "seating two people together is never read as a keep-apart rule");

  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Kural Testi", date: futureDate() });
  await addTables(page, { quantity: 3 });
  await page.evaluate(() => {
    const e = state.events[0], mk = (id, name) => ({ id, name, additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived", assignment: null, createdAt: "" });
    e.guests = [mk("a", "Ahmet Yılmaz"), mk("m", "Mehmet Kaya")]; touchEvent(e); render();
  });
  await page.keyboard.press("F8");
  await page.waitForSelector("#assistantPanel:not([hidden])", { timeout: 5000 });
  const say = async (text) => {
    await page.fill("#assistantInput", text); await page.press("#assistantInput", "Enter");
    await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 20000 });
    await settle(page);
    return page.evaluate(() => [...document.querySelectorAll(".assistant-turn.assistant")].pop().textContent);
  };
  const r1 = await say("Ahmet Yılmaz ile Mehmet Kaya aynı masada oturmasın");
  checks.ok(/aynı masada oturmasın/.test(r1) && await page.evaluate(() => state.events[0].seatRules.length === 1), "F8 keeps the rule", r1);
  const toast = await page.evaluate(() => { const e = state.events[0]; assignGuestToTable("a", e.tables[0].id); assignGuestToTable("m", e.tables[0].id);
    return { seated: e.guests.every((g) => g.assignment && g.assignment.tableId === e.tables[0].id), toasts: [...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" | ") }; });
  checks.ok(toast.seated && /Kural bozuldu/.test(toast.toasts), "seating them together still seats them — and says the rule is broken", toast);
  const miss = await say("bugün ne eksik");
  checks.ok(/Kural bozuldu/.test(miss), "\"bugün ne eksik\" lists the broken rule", miss);
  const list = await say("kurallar");
  checks.ok(/1 oturma kuralı/.test(list), "\"kurallar\" lists the rules", list);
  await page.evaluate(() => { saveState(); });
  await page.waitForTimeout(600);
  await page.reload(); await settle(page);
  checks.equal(await page.evaluate(() => (state.events[0].seatRules || []).map((r) => r.kind)), ["apart"], "save → reload keeps the rule");
}
