// ONE THIN QUIET TOP BAR (owner-approved redesign, benchmarks/ux/redesign/6-birlesik,
// SPEC-v2.md "Structure"): "MERIT Event Maker" · Etkinlik · Salon · Misafirler ·
// Oturma · Kapı · Raporlar (icon + label) · the F8 command line · event name +
// clock · theme. No left sidebar, no second tab row. Every control the old
// header carried keeps a home: the rare ones in the "⋯" menu.
//
//   THE SIX ITEMS map to the existing screens: Etkinlik = the event's overview
//     (Command Center), Salon = floor, Misafirler = guests, Oturma = seating,
//     Kapı = live, Raporlar = reports. A historical event shows only the three
//     it ever had (guests, seating, reports) — no editing surface comes back.
//   THE COMMAND LINE is the guest finder (#globalGuestSearch, unchanged) and
//     the way into the F8 assistant: its key chip opens the panel, and Enter on
//     a sentence that names no guest hands that sentence to F8.
//   LIGHT AND DARK, from the prototype's tokens, switched by the button or F9,
//     remembered in localStorage — and a storage that throws only loses the
//     memory, never the switch.
//
// REDESIGN v4 (SPEC-v4.md, owner 2026-11-07 — the step-1 look was rejected):
//   TWO THEMES, A "Atlas sade" (default) and B "Birleşik", each light and dark,
//     chosen in the ⋯ menu and remembered ("merit.skin.v1", try/catch).
//   "OTEL TABELASI": the six words, no icons, in the working order; a finished
//     step carries a thin ✓, the next unfinished step is the emphasised word,
//     and one quiet "Sonraki: X →" sits at the bottom right. The right side is
//     event name · clock · theme · "Mimar" (the F8 assistant's door).
//   Mutation proof, recorded 2026-11-07: against the step-1 bar every v4 check
//     fails (icons present, no data-skin, no ✓, no Sonraki); with the skin
//     writer's try/catch removed the throwing-storage skin check throws.
//
// Mutation proof, recorded 2026-11-07: before the change (old two-row header,
// no theme) every check below fails at the first selector; with the theme key
// unbound (F9 removed from the keydown handler) "F9 switches back" fails; with
// the try/catch removed from the theme writer the throwing-storage check
// throws a page error.
import { click, openApp, createBlankEvent, gotoTab, settle, futureDate, addTables, addGuest } from "../lib/app-actions.mjs";

export const meta = { name: "shell-topbar", tags: ["ui", "fast"], timeout: 150000 };

const BAR = `(() => {
  const top = document.querySelector("header.shell-top");
  if (!top) return null;
  const items = [...top.querySelectorAll("nav.shell-nav .shell-nav-item")];
  const cs = getComputedStyle(top);
  return {
    height: Math.round(top.getBoundingClientRect().height),
    items: items.map((b) => ({ label: b.querySelector(".shell-nav-label")?.textContent.trim() || "", tab: b.dataset.tab || null,
      icon: !!b.querySelector("svg"), current: b.getAttribute("aria-current") === "page", disabled: b.disabled,
      done: !!b.querySelector(".shell-nav-check"), next: b.classList.contains("next") })),
    skin: document.documentElement.dataset.skin || null,
    nextButton: document.querySelector("[data-shell-next]")?.textContent.trim() || null,
    nextTarget: document.querySelector("[data-shell-next]")?.dataset.shellNext || null,
    mimar: top.querySelector("[data-shell-assistant]")?.textContent.replace(/\s+/g, " ").trim() || "",
    tabs: [...document.querySelectorAll(".tabs [data-tab]")].map((b) => b.dataset.tab),
    secondRow: document.querySelectorAll(".workspace > nav.tabs, .sidebar, .side-nav").length,
    brand: top.querySelector(".shell-brand")?.textContent.replace(/\\s+/g, " ").trim() || "",
    clock: top.querySelector("[data-shell-clock]")?.textContent.trim() || "",
    eventName: top.querySelector(".event-id strong")?.textContent.trim() || null,
    search: !!top.querySelector("#globalGuestSearch"),
    assistantKey: !!top.querySelector("[data-shell-assistant]"),
    theme: document.documentElement.dataset.theme || null,
    bg: cs.backgroundColor, font: cs.fontFamily,
    menu: [...top.querySelectorAll("details.shell-more [data-action], details.shell-more [data-v8-action]")].map((b) => b.dataset.action || b.dataset.v8Action),
  };
})()`;

// WCAG relative luminance contrast between two computed rgb() strings.
const CONTRAST = `((fg, bg) => {
  const lum = (s) => { const [r, g, b] = s.match(/[\\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
})`;

async function navContrast(page) {
  return page.evaluate(`(() => {
    const c = ${CONTRAST};
    const top = document.querySelector("header.shell-top"), bg = getComputedStyle(top).backgroundColor;
    const out = [...top.querySelectorAll(".shell-nav-item .shell-nav-label, .shell-brand, [data-shell-clock]")].map((el) => c(getComputedStyle(el).color, bg));
    return Math.min(...out);
  })()`);
}

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await page.evaluate(() => { try { localStorage.removeItem("merit.theme.v1"); } catch {} });

  // --- 1. the bar on the events home -----------------------------------------
  const home = await page.evaluate(BAR);
  checks.ok(home, "the events home has the one top bar", home);
  if (!home) return;
  checks.ok(home.height <= 56, "the bar is thin (the prototype's 52 px)", home.height);
  checks.equal(home.items.map((i) => i.label), ["Etkinlik", "Salon", "Misafirler", "Oturma", "Kapı", "Raporlar"],
    "six items, in the prototype's order and words", home.items);
  checks.ok(home.items.every((i) => !i.icon), "hotel signage: words only, no icons", home.items);
  checks.ok(home.items[0].current, "on the events home, Etkinlik is the current item", home.items);
  checks.ok(/^MERIT/.test(home.brand), "the mark reads MERIT", home.brand);
  checks.ok(/^\d{2}:\d{2}$/.test(home.clock), "the clock shows HH:MM", home.clock);
  checks.ok(home.assistantKey && /^Mimar/.test(home.mimar), "the bar's right side carries \"Mimar\", the F8 assistant's door", home.mimar);
  checks.equal(home.nextButton, null, "the events home has no \"Sonraki\" (no event is open)", home.nextButton);
  checks.equal(home.secondRow, 0, "no left sidebar, no second tab row", home);
  checks.ok(/Segoe UI Variable/.test(home.font) && /system-ui/.test(home.font), "a modern system sans stack", home.font);
  for (const a of ["help", "backup-export", "backup-import", "recovery-restore"])
    checks.ok(home.menu.includes(a), `the events home's "${a}" control kept a home in the ⋯ menu`, home.menu);

  // --- 2. light and dark --------------------------------------------------------
  checks.equal(home.theme, "light", "a first boot is light");
  checks.ok(await navContrast(page) >= 4.5, "light: the bar's text clears 4.5:1", await navContrast(page));
  await click(page, "[data-shell-theme]");
  const dark = await page.evaluate(BAR);
  checks.equal(dark.theme, "dark", "the toggle switches to dark", dark.theme);
  checks.equal(dark.bg, "rgb(19, 26, 35)", "dark is the prototype's classic deep navy surface (#131A23)", dark.bg);
  checks.ok(await navContrast(page) >= 4.5, "dark: the bar's text clears 4.5:1", await navContrast(page));
  checks.equal(await page.evaluate(() => localStorage.getItem("merit.theme.v1")), "dark", "the choice is remembered");
  await page.reload(); await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => { try { return Array.isArray(state.events) && !!document.querySelector("header.shell-top"); } catch { return false; } });
  checks.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "and comes back after a reload");
  await page.keyboard.press("F9");
  checks.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light", "F9 switches back");
  const throwing = await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new Error("quota"); };
    try { document.querySelector("[data-shell-theme]").click(); return document.documentElement.dataset.theme; }
    finally { Storage.prototype.setItem = orig; }
  });
  checks.equal(throwing, "dark", "a storage that throws loses only the memory, never the switch");
  await page.keyboard.press("F9");

  // --- 2b. two themes: A "Atlas sade" (default) and B "Birleşik" ------------------
  checks.equal(home.skin, "a", "a first boot is theme A, Atlas sade");
  const skinFace = () => page.evaluate(() => ({ skin: document.documentElement.dataset.skin, bg: getComputedStyle(document.querySelector("header.shell-top")).backgroundColor,
    brandFont: getComputedStyle(document.querySelector(".shell-brand b")).fontFamily, pressed: [...document.querySelectorAll("[data-shell-skin]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.shellSkin) }));
  const a = await skinFace();
  checks.equal(a.bg, "rgb(247, 248, 245)", "theme A light is the Atlas sade surface (#F7F8F5)", a);
  checks.ok(/Palatino|Iowan|Georgia/.test(a.brandFont), "theme A sets the mark in the serif", a.brandFont);
  checks.equal(a.pressed, ["a"], "the ⋯ menu shows theme A as the chosen one", a.pressed);
  await click(page, "header.shell-top .shell-more > summary");
  await click(page, '[data-shell-skin="b"]');
  const b = await skinFace();
  checks.equal(b.skin, "b", "the ⋯ menu switches to theme B", b);
  checks.equal(b.bg, "rgb(255, 255, 255)", "theme B light is the combined white surface", b);
  checks.ok(!/Palatino|Iowan/.test(b.brandFont), "theme B keeps the mark in the sans", b.brandFont);
  checks.equal(await page.evaluate(() => localStorage.getItem("merit.skin.v1")), "b", "the theme choice is remembered");
  for (const [skin, mode] of [["a", "light"], ["a", "dark"], ["b", "light"], ["b", "dark"]]) {
    await page.evaluate(([s, m]) => { document.documentElement.dataset.skin = s; document.documentElement.dataset.theme = m; }, [skin, mode]);
    checks.ok(await navContrast(page) >= 4.5, `theme ${skin.toUpperCase()} ${mode}: the bar's text clears 4.5:1`, await navContrast(page));
  }
  await page.reload(); await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => { try { return Array.isArray(state.events) && !!document.querySelector("header.shell-top"); } catch { return false; } });
  checks.equal(await page.evaluate(() => [document.documentElement.dataset.skin, document.documentElement.dataset.theme]), ["b", "light"], "theme B comes back after a reload");
  const skinThrow = await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new Error("quota"); };
    try { document.querySelector('[data-shell-skin="a"]').click(); return document.documentElement.dataset.skin; }
    finally { Storage.prototype.setItem = orig; }
  });
  checks.equal(skinThrow, "a", "a storage that throws loses only the memory of the theme, never the switch");

  // --- 3. the bar in an event ---------------------------------------------------
  await createBlankEvent(page, { name: "Topbar Gala", date: futureDate(20) });
  await settle(page);
  const ws = await page.evaluate(BAR);
  checks.equal(ws.tabs, ["command", "floor", "guests", "seating", "live", "reports"],
    "Etkinlik · Salon · Misafirler · Oturma · Kapı · Raporlar are the six screens the event already had", ws.tabs);
  checks.equal(ws.items.map((i) => i.label), ["Etkinlik", "Salon", "Misafirler", "Oturma", "Kapı", "Raporlar"], "same six words inside an event", ws.items);
  checks.equal(ws.eventName, "Topbar Gala", "the event's name sits in the bar", ws);
  checks.ok(ws.search, "the guest finder is the command line's field", ws);
  checks.equal(ws.secondRow, 0, "inside an event there is still only one bar", ws);
  for (const a of ["back-events", "save-now", "help", "toggle-lang"])
    checks.ok(ws.menu.includes(a), `the event header's "${a}" control kept a home in the ⋯ menu`, ws.menu);

  // --- 3b. the working order: ✓ on finished steps, the next one emphasised -------
  await gotoTab(page, "command");
  const onCommand = await page.evaluate(BAR);
  const step = (bar) => bar.items.map((i) => (i.done ? "✓" : "") + (i.next ? ">" : "") + i.tab).join(" ");
  checks.equal(step(onCommand), "✓command >floor guests seating live reports", "a blank event: Etkinlik ✓, Salon is the next step", step(ws));
  checks.equal([onCommand.nextTarget, onCommand.nextButton], ["floor", "Sonraki: Salon →"], "one quiet \"Sonraki: Salon →\" on the overview", onCommand);
  await click(page, "[data-shell-next]");
  await settle(page);
  checks.equal(await page.evaluate(() => ui.tab), "floor", "\"Sonraki\" opens the next screen");
  await addTables(page, { quantity: 2 });
  await settle(page);
  const afterFloor = await page.evaluate(BAR);
  checks.equal(step(afterFloor), "✓command ✓floor >guests seating live reports", "a room with tables: Salon ✓, Misafirler next", step(afterFloor));
  await gotoTab(page, "guests");
  await addGuest(page, { name: "Order Guest" });
  await settle(page);
  const afterGuests = await page.evaluate(BAR);
  checks.equal(step(afterGuests), "✓command ✓floor ✓guests >seating live reports", "a guest list: Misafirler ✓, Oturma next (nobody is seated yet)", step(afterGuests));
  await gotoTab(page, "live");
  const onLive = await page.evaluate(BAR);
  checks.ok(onLive.items.find((i) => i.tab === "live")?.current && onLive.items.filter((i) => i.current).length === 1,
    "the current item follows the screen (Kapı on Live), and only one is current", onLive.items);

  // --- 4. the command line opens the existing F8 assistant ---------------------
  await click(page, "[data-shell-assistant]");
  checks.ok(await page.evaluate(() => { const p = document.getElementById("assistantPanel"); return !!p && !p.hidden; }),
    "the command line's F8 chip opens the assistant panel");
  await page.keyboard.press("Escape");
  await page.fill("#globalGuestSearch", "kaç misafir var");
  await page.press("#globalGuestSearch", "Enter");
  await page.waitForTimeout(600);
  const handed = await page.evaluate(() => {
    const p = document.getElementById("assistantPanel");
    return { open: !!p && !p.hidden, asked: [...(p?.querySelectorAll(".assistant-turn.you p") || [])].map((x) => x.textContent) };
  });
  checks.ok(handed.open && handed.asked.includes("kaç misafir var"),
    "Enter on a sentence that names no guest hands it to F8 — one command line", handed);
  await page.keyboard.press("Escape");

  // --- 5. language from the ⋯ menu, English keys complete ------------------------
  await click(page, '.shell-more [data-v8-action="toggle-lang"]');
  await settle(page);
  const en = await page.evaluate(BAR);
  checks.equal(en.items.map((i) => i.label), ["Event", "Room", "Guests", "Seating", "Door", "Reports"], "every bar label has its English key", en.items);
  await click(page, '.shell-more [data-v8-action="toggle-lang"]');
  await settle(page);

  // --- 6. a historical event: only the three screens it ever had ------------------
  await page.evaluate(() => { const e = state.events.find((x) => x.name === "Topbar Gala"); e.status = "Completed"; ui.tab = "guests"; render(); });
  await settle(page);
  const hist = await page.evaluate(BAR);
  checks.equal(hist.tabs, ["guests", "seating", "reports"], "a historical event shows no Etkinlik overview, Salon or Kapı tab", hist.tabs);
  checks.ok(!hist.items.some((i) => i.next) && hist.nextButton === null, "a historical event has no next step and no \"Sonraki\"", hist);
  checks.ok(!hist.items.some((i) => /Salon|Kapı/.test(i.label)), "the editing surfaces are absent, not merely disabled", hist.items);
}
