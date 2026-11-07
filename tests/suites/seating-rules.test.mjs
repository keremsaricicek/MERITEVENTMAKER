// SEATING RULES (owner 2026-11-02): "şu iki kişi aynı masaya oturmasın", "VIP'ler önde".
//
//   A RULE WARNS, IT NEVER MOVES OR BLOCKS: seating two "apart" guests together still seats them,
//     and says the rule is broken; "bugün ne eksik" lists it.
//   RULES ARE KEPT: save → reload keeps them (normalised on load; an old event has none).
//   F8 READS THEM in Turkish and English; "kurallar" lists them; undo takes a rule back.
// Mutation proof, recorded 2026-11-02: before the change there were no rules → every check fails.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openApp, createBlankEvent, addTables, futureDate, settle, gotoTab } from "../lib/app-actions.mjs";

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
  await say("Ahmet Yılmaz ile Mehmet Kaya aynı masada oturmasın");
  // SPEC-v4: a rule is shown first and kept on Uygula
  await page.locator(".assistant-confirm").last().click(); await settle(page);
  const r1 = await page.evaluate(() => [...document.querySelectorAll(".assistant-turn.assistant")].pop().textContent);
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

  // --- REDESIGN v4 step 6 (SPEC-v4 "The working order" 5): Oturma → "Hazır" ------
  // "Hazır" opens Hazır mı?: the Plan Doctor's open issues (the one judge), each
  // with its "Git"; pointing at an issue about a table draws a thin line to it.
  // When nothing blocks, "Planı yerleştir" turns the room into the settled plan
  // (quiet: the queue and tools step back; "Düzenle" brings them back). A view,
  // never stored. Mutation proof, recorded 2026-11-07: with the line's target
  // lookup removed the line check fails; with the settle offered despite a
  // blocker the "only when nothing blocks" check fails.
  await page.evaluate(() => { ui.screen = "workspace"; ui.activeEventId = state.events[0].id; ui.tab = "seating";
    const e = state.events[0]; window.__cap0 = e.tables[0].capacity; e.tables[0].capacity = 1; e.tables[0].chairs = (e.tables[0].chairs || []).slice(0, 1); touchEvent(e); render(); });   // an over-full table: an issue with a place
  await settle(page);
  await page.click("[data-ready-open]"); await settle(page);
  const r = await page.evaluate(() => { const p = document.querySelector("[data-ready-panel]"); return p ? { title: p.querySelector("h2")?.textContent.trim(),
    issues: [...p.querySelectorAll("[data-ready-issue]")].map((li) => ({ blocker: li.classList.contains("blocker"), go: !!li.querySelector("button"), table: li.dataset.readyTable || null })),
    settle: !!p.querySelector("[data-ready-settle]") } : null; });
  checks.ok(r && r.title === "Hazır mı?" && r.issues.length >= 1 && r.issues.every((i) => i.go), "Hazır opens Hazır mı?: the Plan Doctor's issues, each with its Git", r);
  checks.equal(r.settle, !r.issues.some((i) => i.blocker), "Planı yerleştir is offered only when nothing blocks", r);
  const withTable = r.issues.findIndex((i) => i.table);
  checks.ok(withTable >= 0, "an over-full table is an issue with a place", r.issues);
  if (withTable >= 0) {
    await page.hover(`[data-ready-issue]:nth-of-type(${withTable + 1})`);
    const lead = await page.evaluate(() => document.querySelector(".ready-lead path")?.getAttribute("d") || "");
    checks.ok(/^M[\d.\s-]+[LC]/.test(lead), "pointing at an issue about a table draws a thin line to its place", lead);
  }
  // a clean room: one table, everyone seated → nothing blocks → settled plan
  await page.evaluate(() => { const e = state.events[0]; e.seatRules = []; e.tables[0].capacity = window.__cap0 || 8; e.guests.forEach((g) => { if (!g.assignment) assignGuestToTable(g.id, e.tables[0].id); }); touchEvent(e); render(); });
  await settle(page);
  const r2 = await page.evaluate(() => ({ settle: !!document.querySelector("[data-ready-settle]"), blockers: document.querySelectorAll("[data-ready-issue].blocker").length }));
  if (r2.settle) {
    await page.click("[data-ready-settle]"); await settle(page);
    const st = await page.evaluate(() => ({ settled: !!document.querySelector(".seat-v4.is-settled"), queue: getComputedStyle(document.querySelector(".seat-queue")).display, bar: document.querySelector("[data-ready-edit]")?.textContent.trim() || null, stored: JSON.stringify(state.events[0]).includes("settled") }));
    checks.ok(st.settled && st.queue === "none" && st.bar, "Planı yerleştir: the settled plan — quiet, the queue steps back, Düzenle stays", st);
    checks.equal(st.stored, false, "the settled view is never stored on the event", st.stored);
    await page.click("[data-ready-edit]"); await settle(page);
    checks.ok(await page.evaluate(() => !document.querySelector(".seat-v4.is-settled") && getComputedStyle(document.querySelector(".seat-queue")).display !== "none"), "Düzenle brings the tools back");
  } else checks.ok(false, "a clean room (everyone seated, no rule) is not blocked", r2);
}
