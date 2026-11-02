// F8 HELP AND F10 (owner 2026-11-02: the assistant must know every usage question).
//
//   "HOW DO I …" IS ANSWERED STEP BY STEP, in the UI's language, with "Götür" to the screen.
//   F10 OPENS THE HELP TOPICS; picking one answers it.
//   THE PANEL STAYS OPEN ACROSS SCREENS (it lives outside #app) — Götür moves the screen, not the panel.
//   A SENTENCE ABOUT A GUEST IS NOT A HELP QUESTION, and help changes nothing.
// Mutation proof, recorded 2026-11-02: before the change F10 did nothing and "masa nasil eklenir"
// was not answered → every check fails.
import { openApp, createBlankEvent, futureDate, settle, addTables } from "../lib/app-actions.mjs";

export const meta = { name: "assistant-help", tags: ["assistant", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Yardım Testi", date: futureDate() });
  await addTables(page, { quantity: 2 });
  const before = await page.evaluate(() => JSON.stringify(state.events));
  await page.keyboard.press("F8");
  await page.waitForSelector("#assistantPanel:not([hidden])", { timeout: 5000 });
  const say = async (text) => {
    await page.fill("#assistantInput", text); await page.press("#assistantInput", "Enter");
    await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 20000 });
    await settle(page);
    return page.evaluate(() => { const t = [...document.querySelectorAll(".assistant-turn.assistant")].pop(); return { text: t ? t.textContent : "", go: !!(t && t.querySelector(".assistant-go")) }; });
  };
  const a = await say("misafiri baska masaya nasil geciririm");
  checks.ok(/başka masaya geçirmek/i.test(a.text) && /Taşı/.test(a.text) && a.go, "a how-to question gets its steps and a Götür button", a);
  await page.click(".assistant-turn.assistant:last-child .assistant-go");
  await settle(page);
  checks.ok(await page.evaluate(() => ui.tab === "seating" && !document.getElementById("assistantPanel").hidden), "Götür opens Seating and the panel stays open", await page.evaluate(() => ui.tab));
  const g = await say("ahmet yilmaz nereye oturacak");
  checks.ok(!g.go, "a sentence about a guest is not answered as help", g);
  await page.keyboard.press("Escape");
  await page.keyboard.press("F10");
  await page.waitForSelector(".assistant-topics .assistant-topic", { timeout: 5000 });
  const n = await page.locator(".assistant-turn.assistant:last-child .assistant-topic").count();
  checks.ok(n >= 40, "F10 opens the help topics", n);
  await page.locator(".assistant-turn.assistant:last-child .assistant-topic", { hasText: "Kapı listesi" }).first().click();
  await settle(page);
  const last = await page.evaluate(() => [...document.querySelectorAll(".assistant-turn.assistant")].pop().textContent);
  checks.ok(/Kapı listesini yazdır/.test(last), "picking a topic answers it", last);
  checks.equal(await page.evaluate(() => JSON.stringify(state.events)), before, "help changes nothing");
}
