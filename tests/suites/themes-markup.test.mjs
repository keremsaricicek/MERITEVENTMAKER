// THEMES B–E, the markup their prototypes need (zip temalar, owner 2026-11-13):
//   C (Royal gece) OPENS DARK — only until the person chooses light/dark themselves;
//   Etkinlikler is the timeline of plates for A, C, D and E; B keeps its calendar;
//   Mimar GREETS the first time it opens, with three example sentences as chips that ask
//   through the same data-assistant-ask path as every other button.
// Mutation proof, recorded 2026-11-13: with C's dark default removed the first check fails;
// with the timeline back to "A only" the D check fails; without greet() the chip checks fail.
import { openApp, settle } from "../lib/app-actions.mjs";

export const meta = { name: "themes-markup", tags: ["ui", "fast"], timeout: 90000 };

const boot = async (page) => {
  await page.reload(); await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => { try { return Array.isArray(state.events) && !!document.querySelector("header.shell-top"); } catch { return false; } });
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await page.evaluate(() => { localStorage.removeItem("merit.theme.v1"); localStorage.setItem("merit.skin.v1", "c"); });
  await boot(page);
  checks.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "theme C opens dark when no light/dark was chosen", null);
  await page.evaluate(() => { localStorage.setItem("merit.theme.v1", "light"); });
  await boot(page);
  checks.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light", "a chosen mode wins over C's default", null);

  for (const [skin, timeline] of [["d", true], ["e", true], ["c", true], ["b", false]]) {
    const r = await page.evaluate((s) => { document.documentElement.dataset.skin = s; localStorage.setItem("merit.skin.v1", s); ui.screen = "events"; render(); return { tl: !!document.querySelector(".tl-screen"), cal: !!document.querySelector(".cal-screen") }; }, skin);
    checks.ok(timeline ? r.tl : (r.cal && !r.tl), `Etkinlikler on theme ${skin.toUpperCase()}: ${timeline ? "the timeline of plates" : "the calendar"}`, r);
  }

  await page.keyboard.press("F8");
  await settle(page);
  const g = await page.evaluate(() => ({ greet: document.querySelectorAll("#assistantPanel .assistant-greet").length, chips: [...document.querySelectorAll("#assistantPanel .assistant-chip")].map((b) => b.dataset.assistantAsk) }));
  checks.ok(g.greet === 1 && g.chips.length === 3 && g.chips.every(Boolean), "Mimar greets once with three example chips", g);
  const before = await page.evaluate(() => document.querySelectorAll("#assistantPanel .assistant-turn").length);
  await page.click("#assistantPanel .assistant-chip");
  await settle(page);
  const after = await page.evaluate(() => document.querySelectorAll("#assistantPanel .assistant-turn").length);
  checks.ok(after > before, "a chip asks Mimar through the usual path (a turn appears)", { before, after });
  await page.keyboard.press("F8"); await page.keyboard.press("F8"); await settle(page);
  checks.ok(await page.evaluate(() => document.querySelectorAll("#assistantPanel .assistant-greet").length) <= 1, "reopening never adds a second greeting", null);
}
