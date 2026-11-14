// Redesign step 1 screenshots: the one top bar + the events calendar, light and
// dark, at 1440×900, 1920×1080 and 2560×1440. Serve the repo first
// (python3 -m http.server 8765 --bind 127.0.0.1) and pass the URL:
//   node benchmarks/ux/redesign/impl/step1/shoot.mjs http://127.0.0.1:8765
// The events below are made in the page for the picture only (no network,
// nothing kept): one tonight-ish gala with guests on tables, a few others,
// and two past ones.
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://127.0.0.1:8765";
const VIEWS = [[1440, 900], [1920, 1080], [2560, 1440]];
const errors = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const [w, h] of VIEWS) for (const theme of ["light", "dark"]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${w} ${theme} pageerror ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errors.push(`${w} ${theme} console ${m.text()}`); });
  await p.route((u) => !u.href.startsWith(BASE), (r) => r.abort());
  await p.goto(`${BASE}/index.html`);
  await p.waitForFunction(() => { try { return Array.isArray(state.events) && !!document.querySelector("header.shell-top"); } catch { return false; } });
  await p.evaluate((theme) => {
    localStorage.setItem("merit.theme.v1", theme); document.documentElement.dataset.theme = theme;
    const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA");
    const tables = Array.from({ length: 12 }, (_, i) => ({ id: "t" + i, number: "T" + String(i + 1).padStart(2, "0"), type: "round", capacity: 10, chairs: [], hasPhysicalSeats: false, x: 100 + (i % 4) * 160, y: 100 + Math.floor(i / 4) * 160, w: 90, h: 90, rotation: 0 }));
    const names = ["Ayşe Demir", "Mehmet Kaya", "Zeynep Arslan", "Can Öztürk", "Elif Şahin", "Burak Yıldız", "Selin Aydın", "Emre Koç", "Deniz Çelik", "Gizem Polat"];
    const guests = names.map((n, i) => ({ id: "g" + i, name: n, additionalGuests: i % 3, pax: 1 + (i % 3), vip: i === 0 ? "VIP" : "", invitedBy: "", notes: "", planningStatus: "Confirmed",
      arrivalStatus: i < 4 ? "Checked In" : "Not Arrived", assignment: i < 8 ? { tableId: "t" + (i % 12), seats: Array.from({ length: 1 + (i % 3) }, (_, k) => k), locked: false } : null, createdAt: "" }));
    const ev = (id, name, date, extra = {}) => ({ id, name, date, hotel: "Merit Royal Hotel", salon: "Grand Balo Salonu", status: "Planning", tables: [], guests: [], ...extra });
    state.events.push(ev("e1", "Yılbaşı Galası", day(2), { tables, guests }), ev("e2", "Caz Gecesi", day(5), { salon: "Kristal Salon" }), ev("e3", "Poker Night VIP", day(9)),
      ev("e4", "Kış Konseri", day(-3), { status: "Completed" }), ev("e5", "Noel Brunch", day(-6), { salon: "Teras" }));
    ui.activeEventId = "e1"; ui.screen = "events"; render();
  }, theme);
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, `home-${theme}-${w}.png`) });
  await p.evaluate(() => { openEvent("e1"); ui.tab = "guests"; render(); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, `guests-bar-${theme}-${w}.png`) });
  if (w === 1440) {
    await p.evaluate(() => { document.querySelector("header.shell-top .shell-more").open = true; });
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(OUT, `menu-${theme}-${w}.png`), clip: { x: w - 420, y: 0, width: 420, height: 260 } });
  }
  await ctx.close();
}
await b.close();
console.log(errors.length ? errors.join("\n") : "console clean (no page error, no console error)");
