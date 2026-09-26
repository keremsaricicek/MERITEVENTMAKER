// WHAT CHANGED IS SAID, WHAT IS SHOWN CAN BE READ, AND COLOUR IS NEVER ALONE.
//
// `.claude/skills/merit-accessibility-hardening/SKILL.md`, required evidence
// 4 and 5, and the Visual rules:
//
//   ANNOUNCEMENTS. "A status change an operator must know about is announced
//     via a live region … a check-in confirmation is polite; a blocking error
//     is assertive … A live region must exist in the DOM BEFORE the content
//     changes … Do not announce the entire re-rendered list. Announce the
//     change." Before this suite a check-in was announced by nothing: the
//     recent-arrivals strip is rebuilt with the whole screen, and every toast,
//     errors included, sat in one polite region.
//   CONTRAST FROM PIXELS. "Contrast computed from rendered pixels" — not from
//     stylesheet values, which is what a scan reads. Each sample is
//     screenshotted and measured from what the browser actually painted: the
//     most common colour is the background, the pixel furthest from it is the
//     text. Samples cover both colour families: the light shell and the
//     `--pi-*` planmap / review surfaces.
//   NOT COLOUR ALONE. "VIP, No Show, frozen and unavailable states each need
//     a non-colour cue."
//   REDUCED MOTION. "prefers-reduced-motion respected."
import { openApp, createBlankEvent, addTables, futureDate, gotoTab, settle, addGuest } from "../lib/app-actions.mjs";

export const meta = { name: "a11y-announce-contrast", tags: ["accessibility", "ui", "fast"], timeout: 150000 };

export default async function run({ page, checks, baseUrl }) {
  page.on("dialog", (d) => d.accept());
  await openApp(page, baseUrl, { lang: "en" });

  // --- 1. the live region exists before anything happens --------------------
  const region = await page.evaluate(() => {
    const el = document.getElementById("a11yAnnouncer");
    window.__region = el;
    return el ? { live: el.getAttribute("aria-live"), role: el.getAttribute("role"),
      insideApp: !!el.closest("#app"), text: el.textContent } : null;
  });
  checks.ok(region && region.live === "polite" && region.role === "status" && !region.insideApp,
    "a polite status region exists from boot, OUTSIDE #app — so render() can never replace it and it is already there when the first change comes", region);

  await createBlankEvent(page, { name: "Announce", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 2 });
  await gotoTab(page, "guests");
  await addGuest(page, { name: "AYSE KAYA", vip: "VIP" });
  await addGuest(page, { name: "MEHMET DEMIR" });

  // --- 2. a check-in is announced, politely, and only the change ------------
  await gotoTab(page, "live");
  await settle(page);
  await page.focus('[data-arrival="Checked In"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const said = await page.evaluate(() => ({
    same: document.getElementById("a11yAnnouncer") === window.__region,
    text: document.getElementById("a11yAnnouncer").textContent,
    arrived: state.events[0].guests.filter((g) => g.arrivalStatus === "Checked In").map((g) => g.name),
  }));
  checks.ok(said.same, "the region that speaks is the same node that existed at boot — not one created with its content", said.same);
  checks.ok(said.arrived.length === 1 && said.text === `${said.arrived[0]}: Checked In`,
    "a check-in is ANNOUNCED — the guest's name and the new status, nothing else", said);
  checks.ok(said.text.length < 80, "one change, not the re-rendered door list", said.text.length);

  await page.focus('[data-arrival="No Show"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const said2 = await page.evaluate(() => document.getElementById("a11yAnnouncer").textContent);
  checks.ok(/: No Show$/.test(said2), "and a No Show is announced the same way", said2);
  await page.evaluate(() => { ui.lang = "tr"; render(); });
  await page.focus('[data-arrival="Checked In"]').catch(() => {});
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const saidTr = await page.evaluate(() => document.getElementById("a11yAnnouncer").textContent);
  checks.ok(/: (Giriş Yaptı|Gelmedi|Bekleniyor)$/.test(saidTr),
    "in Turkish the announcement is Turkish — an English aria string in a Turkish UI is a defect twice over", saidTr);
  await page.evaluate(() => { ui.lang = "en"; render(); });

  // --- 3. errors are assertive, confirmations are not -----------------------
  // An error the operator must hear: a guest list that holds no rows. (An
  // empty guest name is stopped by the field's own `required` before any
  // toast exists, so it cannot serve as the fixture.)
  await gotoTab(page, "guests");
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((n) => n.remove()));
  await page.click('[data-guest-command="add"]');
  await page.waitForSelector("#guestForm", { state: "visible" });
  await page.keyboard.press("Escape");
  await page.setInputFiles("#guestFileInput", { name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("Name Surname\n") });
  await page.waitForTimeout(300);
  const roles = await page.evaluate(() => [...document.querySelectorAll(".toast")].map((n) => ({ cls: n.className, role: n.getAttribute("role") })));
  const err = roles.filter((r) => /\berror\b/.test(r.cls));
  checks.ok(err.length && err.every((r) => r.role === "alert"), "a blocking error toast is ASSERTIVE (role=alert)", roles);
  checks.ok(roles.filter((r) => !/\berror\b/.test(r.cls)).every((r) => r.role === "status"),
    "and every other toast is a polite status — announcing everything assertively is as bad as announcing nothing", roles);
  await page.keyboard.press("Escape");

  // --- 4. not colour alone ---------------------------------------------------
  await page.evaluate(() => {
    const e = state.events[0];
    e.freezes = [{ id: "f_a11y", scope: "TABLE", tableId: e.tables[0].id, reason: "OTHER", note: "", createdAt: new Date().toISOString() }];
    e.tables[1].availability = "UNAVAILABLE"; e.tables[1].unavailableReason = "OTHER"; e.tables[1].unavailableSince = new Date().toISOString();
    ui.freezeLayer = true; touchEvent(e); render();
  });
  await gotoTab(page, "seating");
  await settle(page);
  const cues = await page.evaluate(() => {
    const e = state.events[0];
    const fz = document.querySelector(`[data-object-id="${e.tables[0].id}"]`);
    const un = document.querySelector(`[data-object-id="${e.tables[1].id}"]`);
    return {
      frozenIcon: !!fz?.querySelector(".table-frozen svg"),
      frozenDashed: fz ? getComputedStyle(fz, "::after").borderTopStyle : null,
      frozenName: fz?.getAttribute("aria-label") || "",
      unavailIcon: !!un?.querySelector(".table-unavailable svg"),
      unavailStripes: un ? getComputedStyle(un.querySelector(".table-surface")).backgroundImage : null,
      unavailName: un?.getAttribute("aria-label") || "",
    };
  });
  checks.ok(cues.frozenIcon && cues.frozenDashed === "dashed",
    "a FROZEN table carries an icon and a dashed outline, not only an amber tint", cues);
  checks.ok(/frozen/.test(cues.frozenName), "and says so in its accessible name", cues.frozenName);
  checks.ok(cues.unavailIcon && /repeating-linear-gradient/.test(cues.unavailStripes || ""),
    "an UNAVAILABLE table carries an icon and hazard stripes, not only red", cues);
  checks.ok(/unavailable/.test(cues.unavailName), "and says so in its accessible name", cues.unavailName);
  await gotoTab(page, "guests");
  await settle(page);
  const textCues = await page.evaluate(() => ({
    vip: [...document.querySelectorAll(".vip-tag, .vip-mark")].map((n) => n.textContent.trim()),
  }));
  checks.ok(textCues.vip.includes("VIP"), "VIP is written, not only tinted", textCues);
  await gotoTab(page, "live");
  await settle(page);
  const noShowText = await page.evaluate(() => document.querySelector("#app").textContent.includes("No Show"));
  checks.ok(noShowText, "No Show is written on the Live screen, not only coloured");

  // --- 5. contrast, from painted pixels -------------------------------------
  const measure = async (selector, label, minimum = 4.5) => {
    const loc = page.locator(selector).first();
    if (!(await loc.count())) { checks.ok(false, `${label}: sample ${selector} is on screen`); return; }
    const png = await loc.screenshot();
    const ratio = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const lum = (r, g, b) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const counts = new Map();
      for (let i = 0; i < d.length; i += 4) { const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); }
      const bgKey = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      const bg = lum(bgKey >> 16, (bgKey >> 8) & 255, bgKey & 255);
      let best = 1;
      for (const k of counts.keys()) {
        const l = lum(k >> 16, (k >> 8) & 255, k & 255);
        const r = (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05);
        if (r > best) best = r;
      }
      return Math.round(best * 100) / 100;
    }, png.toString("base64"));
    checks.ok(ratio >= minimum, `${label}: painted contrast ${ratio}:1 ≥ ${minimum}:1`, { selector, ratio });
  };

  // Light shell.
  await gotoTab(page, "guests");
  await settle(page);
  await measure('.mx-list-head [role="columnheader"]', "light shell — a guest-list column header");
  // Real table semantics, not a grid of divs: the guest list is tabular data.
  const table = await page.evaluate(() => {
    const t = document.querySelector('.mx-list[role="table"]');
    const rows = t ? [...t.querySelectorAll(':scope > [role="row"]')] : [];
    return { named: !!t?.getAttribute("aria-label"), rows: rows.length,
      headers: rows[0] ? rows[0].querySelectorAll(':scope > [role="columnheader"]').length : 0,
      cellsPerRow: rows.slice(1).map((r) => r.querySelectorAll(':scope > [role="cell"]').length) };
  });
  checks.ok(table.named && table.rows >= 3 && table.cellsPerRow.every((n) => n === table.headers),
    "the guest list is a named TABLE whose every row has one cell per column header", table);
  await gotoTab(page, "live");
  await settle(page);
  await measure('.btn-arrive.go[data-arrival="Checked In"]', "light shell — the Check In button (white on green)");
  // --pi-* surfaces: the floor plan's controls and a selected table's card.
  await gotoTab(page, "floor");
  await settle(page);
  await measure('button[data-canvas-action="zoom-in"]', "planmap — a canvas toolbar control");
  await page.evaluate(() => { const e = state.events[0]; ui.selectedObjectId = e.tables[0].id; ui.selectedObjectIds = [e.tables[0].id]; render(); });
  await settle(page);
  await measure(".contextual-card-head > span", "planmap — the selected table card's secondary line");
  await measure(".contextual-card .field label", "planmap — a field label in the card (the faint --pi-muted-2 step)");

  // --- 6. reduced motion ------------------------------------------------------
  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.evaluate(() => {
    const b = document.querySelector(".btn");
    return b ? getComputedStyle(b).transitionDuration : null;
  });
  checks.ok(motion && motion.split(",").every((v) => parseFloat(v) <= 0.001),
    "with prefers-reduced-motion, transitions collapse to effectively nothing", motion);
  await page.emulateMedia({ reducedMotion: "no-preference" });
}
