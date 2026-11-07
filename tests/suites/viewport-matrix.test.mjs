// EVERY SCREEN, AT EVERY SUPPORTED SIZE, IN BOTH LANGUAGES.
//
// The UI constitution names three desktop sizes — 1920×1080, 2560×1440 and
// ~1440 — and Turkish first. The accessibility, keyboard and localisation
// suites each run at ONE size (1920×1080), so a label that fits in English at
// 1920 and is cut off in Turkish at 1440 passed all of them. This walks every
// screen and the dialogs an operator opens, at all three sizes, in Turkish
// and in English, with long Turkish data (the longest real names are the
// ones that break layouts), and holds four things at each stop:
//
//   OVERFLOW  the page never scrolls sideways, and no control or heading
//             runs off the right edge of the window;
//   CLIPPING  no control's text is cut off silently — truncation is allowed
//             only with an ellipsis AND the full text in a title/aria-label;
//   FOCUS     Tab moves through the screen and every stop shows where focus
//             is (outline, ring, border or background changes);
//   AXE       WCAG 2.0/2.1 A and AA at that size (contrast and target size
//             depend on layout, so one size is not all sizes).
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, addTables, futureDate, settle, click } from "../lib/app-actions.mjs";

export const meta = { name: "viewport-matrix", tags: ["ui", "accessibility", "localization", "slow"], timeout: 600000 };

const VIEWPORTS = [[1920, 1080], [2560, 1440], [1440, 900]];
const LANGS = ["tr", "en"];
const TAB_STOPS = 18;

const SCREENS = [
  ["events list", () => { ui.screen = "events"; render(); }],
  ["new event", () => { ui.screen = "events"; render(); document.querySelector('[data-action="create-event"]').click(); }],
  ["command center", () => { ui.screen = "workspace"; ui.tab = "command"; render(); }],
  ["floor plan", () => { ui.screen = "workspace"; ui.tab = "floor"; ui.planMode = "plan"; render(); }],
  ["floor plan, a table selected", () => { ui.screen = "workspace"; ui.tab = "floor"; const t = activeEvent().tables[0]; ui.selectedObjectId = t.id; ui.selectedObjectIds = [t.id]; render(); }],
  ["guests", () => { ui.screen = "workspace"; ui.tab = "guests"; ui.selectedObjectId = null; ui.selectedObjectIds = []; render(); }],
  ["seating", () => { ui.screen = "workspace"; ui.tab = "seating"; render(); }],
  ["seating, a table selected", () => { ui.screen = "workspace"; ui.tab = "seating"; ui.selectedTableId = activeEvent().tables[1].id; render(); }],
  ["live", () => { ui.screen = "workspace"; ui.tab = "live"; ui.selectedTableId = null; render(); }],
  ["reports", () => { ui.screen = "workspace"; ui.tab = "reports"; render(); }],
  ["guest dialog", () => { ui.screen = "workspace"; ui.tab = "guests"; render(); document.querySelector('[data-guest-command="add"]').click(); }],
  ["import wizard", () => { ui.screen = "workspace"; ui.tab = "guests"; render(); document.querySelector('[data-guest-command="import"]').click(); }],
  ["add tables panel", () => { ui.screen = "workspace"; ui.tab = "floor"; ui.planMode = "plan"; render(); document.querySelector(".planmap-fab").click(); }],
];

function inspect() {
  const W = innerWidth, out = { pageOverflowX: document.documentElement.scrollWidth > W + 1, offRight: [], clipped: [], sideways: [] };
  // Containers built to scroll sideways: the canvas, the import tables, the
  // PDF page strip, the arrival chart. Any OTHER container that scrolls
  // sideways is a screen that does not fit.
  const INTENDED = "#canvasViewport, .wz-scroll, .source-scroll, .pdf-pages, .aw-chart, .analysis-canvas-shell";
  for (const el of document.querySelectorAll("*")) {
    const o = getComputedStyle(el).overflowX;
    if ((o === "auto" || o === "scroll") && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !el.matches(INTENDED))
      out.sideways.push((el.id ? "#" + el.id : "") + "." + String(el.className).trim().split(/\s+/).slice(0, 2).join(".") + ` (${el.scrollWidth} > ${el.clientWidth})`);
  }
  const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const scrollsOrClips = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return p; } return null; };
  const name = (el) => (el.getAttribute("data-action") || el.getAttribute("data-tab") || el.className || el.tagName).toString().slice(0, 40) + ": " + (el.textContent || el.value || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const root = document.querySelector("dialog[open]") || document.body;
  for (const el of root.querySelectorAll("button, a, label, h1, h2, h3, h4, th, [role=tab], .btn, select, input[type=button], .chip, .pill")) {
    if (!visible(el) || el.closest("#canvasWorld, .canvas-world, [aria-hidden=true]")) continue;
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 && !scrollsOrClips(el)) out.offRight.push(name(el));
    const s = getComputedStyle(el), txt = (el.textContent || "").trim();
    if (!txt || el.tagName === "SELECT" || el.children.length > 3) continue;
    if (el.scrollWidth > el.clientWidth + 1 && (s.overflowX === "hidden" || s.overflowX === "clip")) {
      const full = (el.getAttribute("title") || el.getAttribute("aria-label") || "").trim();
      if (!(s.textOverflow === "ellipsis" && full)) out.clipped.push(name(el));
    }
  }
  return out;
}

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const axeSource = fs.readFileSync(path.join(repoRoot, "node_modules/axe-core/axe.min.js"), "utf8");
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Büyük Salon Kış Galası — Uluslararası Ağırlama Gecesi", hotel: "Merit Royal Diamond Hotel & Spa", date: futureDate() });
  await addTables(page, { quantity: 12 });
  await page.evaluate(() => {
    const e = activeEvent(), names = ["Şükrü Çağlayangil-Öztürkoğlu", "Gülümser Ağaoğlu Karamanlıoğlu", "Mehmet Ali Büyükdoğanyiğit", "Ayşe", "Ömer Faruk İnceoğlu", "Çiğdem Ünsalan Yılmazkaya"];
    for (let i = 0; i < 60; i++) {
      const add = i % 5 === 0 ? 3 : 0, g = { id: "g" + i, name: names[i % names.length] + " " + (i + 1), additionalGuests: add, pax: 1 + add, vip: ["Standard", "VIP", "VVIP"][i % 3],
        invitedBy: "Uluslararası Satış ve Pazarlama Direktörlüğü", notes: i % 7 ? "" : "Vejetaryen menü, tekerlekli sandalye erişimi gerekli", planningStatus: i % 4 ? "Confirmed" : "Tentative",
        arrivalStatus: ["Not Arrived", "Checked In", "No Show"][i % 3], checkedInAt: i % 3 === 1 ? new Date().toISOString() : null, assignment: null, createdAt: new Date().toISOString() };
      e.guests.push(g);
    }
    for (let i = 0; i < 20; i++) { const g = e.guests[i], t = e.tables[i % 12], used = occupiedSeatIndexes(e, t.id), free = [];
      for (let s = 0; s < t.capacity && free.length < g.pax; s++) if (!used.has(s)) free.push(s);
      if (free.length >= g.pax) MeritSeatAssignment.write(g, { tableId: t.id, seats: free, locked: false }); }
    touchEvent(e);
  });

  const summary = { stops: 0, overflow: [], offRight: [], clipped: [], noFocusRing: [], axe: [] };
  for (const [w, h] of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h });
    for (const lang of LANGS) {
      await page.evaluate((l) => { ui.lang = l; render(); }, lang);
      for (const [label, open] of SCREENS) {
        const at = `${w}×${h} ${lang} — ${label}`;
        await page.evaluate(`(${open.toString()})()`);
        await settle(page); await page.waitForTimeout(150);
        // a dialog fades in: contrast sampled mid-fade is the fade, not the colours
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 3000 }).catch(() => {});
        summary.stops++;
        const r = await page.evaluate(inspect);
        if (r.pageOverflowX) summary.overflow.push(at);
        for (const x of r.sideways) summary.overflow.push(`${at}: ${x} scrolls sideways`);
        for (const x of r.offRight) summary.offRight.push(`${at}: ${x}`);
        for (const x of r.clipped) summary.clipped.push(`${at}: ${x}`);
        // focus: Tab through the first stops of the screen. Transitions are
        // switched off for the walk: a ring that fades in reads as "no
        // change" when its computed style is sampled mid-transition.
        await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.scrollTo(0, 0);
          // a constructed sheet: the page's CSP refuses an injected <style>
          window.__noTransitions = new CSSStyleSheet(); window.__noTransitions.replaceSync("*,*::before,*::after{transition:none!important;animation:none!important}");
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, window.__noTransitions]; });
        for (let k = 0; k < TAB_STOPS; k++) {
          await page.keyboard.press("Tab");
          const f = await page.evaluate(() => {
            const el = document.activeElement; if (!el || el === document.body) return null;
            const pick = (s) => [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor].join("|");
            const on = pick(getComputedStyle(el)), outline = getComputedStyle(el).outlineStyle !== "none" && parseFloat(getComputedStyle(el).outlineWidth) > 0;
            el.blur(); const off = pick(getComputedStyle(el)); el.focus({ preventScroll: true });
            const tag = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "") + (el.name ? `[name=${el.name}]` : "");
            return { ok: outline || on !== off, what: `${tag} "${(el.getAttribute("aria-label") || el.textContent || el.placeholder || "").replace(/\s+/g, " ").trim().slice(0, 30)}"` };
          });
          if (f && !f.ok) summary.noFocusRing.push(`${at}: ${f.what}`);
        }
        await page.evaluate(() => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== window.__noTransitions); });
        await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 3000))]));
        // axe at this size
        const axe = await page.evaluate(async (src) => {
          if (!window.axe) (0, eval)(src);
          const res = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
          return res.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(" ")}`);
        }, axeSource).catch((e) => [`axe failed: ${String(e).slice(0, 80)}`]);
        for (const v of axe) summary.axe.push(`${at}: ${v}`);
        await page.keyboard.press("Escape").catch(() => {});
        await page.evaluate(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); if (ui.v8AddOpen) { ui.v8AddOpen = false; render(); } });
      }
    }
  }
  const uniq = (xs) => [...new Set(xs)];
  checks.equal(summary.stops, VIEWPORTS.length * LANGS.length * SCREENS.length, "every screen was visited at every size in both languages");
  checks.equal(uniq(summary.overflow), [], "OVERFLOW: no screen scrolls sideways at any supported size");
  checks.equal(uniq(summary.offRight), [], "OVERFLOW: no control or heading runs off the right edge");
  checks.equal(uniq(summary.clipped), [], "CLIPPING: no control's text is cut off without an ellipsis and its full text");
  checks.equal(uniq(summary.noFocusRing), [], "FOCUS: every Tab stop shows where focus is");
  checks.equal(uniq(summary.axe), [], "AXE: no WCAG A/AA violation at any supported size, in either language");
}
