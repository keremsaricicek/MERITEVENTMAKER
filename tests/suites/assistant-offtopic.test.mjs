// Mimar does not chat (owner, 2026-11-14).
//
//   A SENTENCE THAT IS NEITHER A QUESTION ABOUT OUR EVENTS NOR A COMMAND GETS ONE
//   FIXED ANSWER, never the language model's free text. Measured the same day on
//   the shipped q08 reader (10 everyday sentences, $S/offtopic): with its adapter
//   it echoed the question or produced fragments; with the adapter off it invented
//   the weather ("20-25 derece") and an exchange rate ("1000 lira"). A small
//   model trained only on event work is not asked to make conversation.
//
// The relay is present here (Server-Timing merit-relay) and its /vlm-relay/chat
// answers with an invented reply, so the old path WOULD show it.
// Mutation proof, recorded 2026-11-14: against 3f911d2 (chat branch still live)
// both checks fail: the invented reply is shown and the chat route is called.
import { openApp, createBlankEvent, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "assistant-offtopic", tags: ["assistant", "fast"], timeout: 120000 };

export default async function run({ page, checks, baseUrl }) {
  let chatCalls = 0;
  await page.route("**/*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === "/vlm-relay/chat") { chatCalls++; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, reply: "Dolar bugün 1000 lira.", seconds: 1 }) }); }
    if (url.pathname.startsWith("/merit-backup/")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    if (url.pathname.startsWith("/vlm-relay/")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, reading: null, sure: false, seconds: 1 }) });
    if (req.resourceType() === "document") {
      const res = await route.fetch();
      return route.fulfill({ response: res, headers: { ...res.headers(), "server-timing": "merit-relay" } });
    }
    return route.continue();
  });
  await openApp(page, baseUrl, { lang: "tr" });
  checks.ok(await page.evaluate(() => performance.getEntriesByType("navigation")[0].serverTiming.some((e) => e.name === "merit-relay")), "the page is served as if by the relay");
  await createBlankEvent(page, { name: "Yılbaşı Galası", date: futureDate() });
  await settle(page);
  await page.keyboard.press("F8");
  await page.waitForSelector("#assistantPanel:not([hidden])", { timeout: 5000 });
  await page.fill("#assistantInput", "Dolar kaç lira?");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /etkinlik işlerinde|1000 lira|anlayamadım/i.test(document.getElementById("assistantPanel").textContent), null, { timeout: 15000 });
  await settle(page);
  const text = await page.evaluate(() => document.getElementById("assistantPanel").textContent);
  checks.ok(!/1000 lira/.test(text), "the model's invented reply is never shown");
  checks.ok(/etkinlik işlerinde/.test(text), "the fixed answer says what Mimar helps with");
  checks.equal(chatCalls, 0, "the free-chat route is never called");
}
