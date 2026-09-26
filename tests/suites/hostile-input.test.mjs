// CONTENT IS SHOWN AS CONTENT — NEVER RUN, NEVER TURNED INTO MARKUP.
//
// `.claude/skills/merit-security-hardening/SKILL.md`: "'We use `esc()`' is not
// evidence. A hostile-input fixture that passes is." 335 escape calls prove a
// habit; one unescaped interpolation among them is the whole vulnerability, and
// counting cannot find it. This suite feeds hostile text through the ways text
// actually reaches this product and walks the screens that show it.
//
// THE PAYLOAD is one string carrying every shape that has historically
// escaped a template: an `<img onerror>`, a quote-breaking `"><svg onload>`, a
// `<script>`, an attribute-breaking `" autofocus onfocus=`, a `javascript:`
// URL, a template-expression lookalike, a right-to-left override and a null
// byte. Every one of them, if it became markup, calls `window.__pwned.push()`.
// A tag in front of it (`F:guestName|`) says which field it came from.
//
// THREE KINDS OF ENTRY, per the skill's list:
//
//   IMPORTED — a whole event carrying the payload in every text field (event,
//     hotel and salon names, table numbers and zones, object labels, guest
//     names, notes and invited-by, a freeze note, an unavailable note, a
//     handover note and its author, a venue and a layout name), restored
//     through the real backup control; and a guest spreadsheet whose cells
//     AND column headers carry it, walked through every wizard step.
//   TYPED — the new-event form, the guest dialog, the handover note, the
//     three search boxes and the global finder.
//   DERIVED — the plan's own text: the OCR engine is replaced before boot with
//     one that "reads" the payload off the drawing, the real Assisted Detection
//     runs, and the review screen renders what it made of it.
//
// ON EVERY SCREEN, three assertions:
//   NOTHING RAN          `window.__pwned` is still empty.
//   NOTHING BECAME MARKUP no element carries an `on*` attribute or a
//                        `javascript:` URL built from the payload, and no
//                        `<script>` holds it.
//   IT IS STILL THERE    the tagged text is visible as text (or sits in a
//                        field's value) — escaping that deletes content would
//                        pass the first two and lose the guest's name.
//
// `window.__pwned` is CUMULATIVE: once a payload fires, every later screen
// reports it too. The FIRST failing screen is where the hole is.
//
// MUTATION PROOF, recorded:
//   H1  esc() reduced to String() → fails on the very first screen (Events
//       list: 13 payloads fired, IMG.onerror and svg.onload in the DOM).
//   H2  ONE esc() removed — the guest name in the global finder's result row
//       → the finder is the first screen to fail, with the payload executed.
//   The whole claim of the suite is H2: one unescaped interpolation among
//   hundreds is found by walking the screens, which counting could not do.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent, addTables, futureDate, gotoTab, settle, typeQuery, autoAnswer } from "../lib/app-actions.mjs";

export const meta = { name: "hostile-input", tags: ["security", "ui", "fast"], timeout: 240000, downloads: true };

const PAYLOAD = [
  `<img src=x onerror="window.__pwned.push('img')">`,
  `"><svg onload="window.__pwned.push('svg')">`,
  `'><script>window.__pwned.push('script')</script>`,
  `" autofocus onfocus="window.__pwned.push('attr')" x="`,
  `javascript:window.__pwned.push('js')`,
  "${window.__pwned.push('tpl')}{{constructor.constructor('window.__pwned.push(1)')()}}",
  "‮evil‬",
  "nul\u0000byte",
].join(" ");
const tagged = (field) => `F:${field}|${PAYLOAD}`;
// What must be VISIBLE of it: the tag and the start of the first payload.
// The rest may be truncated by a narrow cell; this prefix never is.
const visibleMark = (field) => `F:${field}|<img src=x onerror=`;

async function audit(page, where, checks, { mustShow = [], allowMissing = false } = {}) {
  const r = await page.evaluate((mustShow) => {
    const handlerAttrs = [], jsUrls = [], scripts = [];
    for (const el of document.querySelectorAll("*")) {
      for (const a of el.attributes) {
        if (/^on/i.test(a.name) && /__pwned/.test(a.value)) handlerAttrs.push(`${el.tagName}.${a.name}`);
        if (/^(href|src|action|formaction|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) jsUrls.push(`${el.tagName}.${a.name}`);
      }
      if (el.tagName === "SCRIPT" && /__pwned/.test(el.textContent)) scripts.push("SCRIPT");
    }
    const values = [...document.querySelectorAll("input,textarea")].map((i) => i.value).join("\n");
    const text = document.body.textContent + "\n" + values;
    return {
      pwned: [...window.__pwned],
      handlerAttrs, jsUrls, scripts,
      missing: mustShow.filter((m) => !text.includes(m)),
    };
  }, mustShow);
  checks.equal(r.pwned, [], `${where}: nothing in the payload RAN`, r.pwned);
  checks.ok(!r.handlerAttrs.length && !r.jsUrls.length && !r.scripts.length,
    `${where}: nothing in the payload BECAME MARKUP — no handler attribute, javascript: URL or script built from it`,
    { handlerAttrs: r.handlerAttrs.slice(0, 5), jsUrls: r.jsUrls.slice(0, 5), scripts: r.scripts.length });
  if (mustShow.length && !allowMissing)
    checks.equal(r.missing, [], `${where}: and the text is still THERE, shown as text`, r.missing);
  return r;
}

export default async function run({ page, checks, baseUrl, artifactDir, repoRoot }) {
  // Installed before boot, so a payload that fires during the first render is
  // recorded rather than lost.
  await page.addInitScript(() => { window.__pwned = []; });
  page.on("dialog", (d) => d.accept());
  await autoAnswer(page);
  await openApp(page, baseUrl, { lang: "en" });

  // ======================= IMPORTED: A WHOLE EVENT =========================
  await createBlankEvent(page, { name: "Hostile Source", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 2 });
  await page.evaluate(({ T }) => {
    const e = state.events[0];
    const t = (f) => T.replace("__FIELD__", f);
    e.name = t("eventName"); e.hotel = t("hotel"); e.salon = t("salon"); e.venue = e.hotel;
    e.tables[0].number = t("tableNumber"); e.tables[0].zone = t("zone"); e.tables[0].capacity = 6;
    e.tables[1].number = "T02"; e.tables[1].zone = t("zone"); e.tables[1].capacity = 6;
    e.tables[1].availability = "UNAVAILABLE"; e.tables[1].unavailableReason = "OTHER"; e.tables[1].unavailableNote = t("unavailableNote");
    e.venueObjects = [{ id: "vo_hostile", type: "stage", label: t("objectLabel"), x: 600, y: 400, w: 300, h: 120, rotation: 0, locked: false, z: 3 }];
    e.guests = [{
      id: "g_hostile", name: t("guestName"), additionalGuests: 2, pax: 3, vip: "VIP",
      invitedBy: t("invitedBy"), notes: t("notes") + " " + "L".repeat(3000),
      planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: { tableId: e.tables[0].id, seats: [0, 1, 2], locked: false }, createdAt: new Date().toISOString(),
    }, {
      id: "g_hostile_2", name: t("unseatedGuest"), additionalGuests: 0, pax: 1, vip: "Standard",
      invitedBy: "", notes: "", planningStatus: "Tentative", arrivalStatus: "Not Arrived",
      assignment: null, createdAt: new Date().toISOString(),
    }];
    e.freezes = [{ id: "f_hostile", scope: "ZONE", zone: t("zone"), reason: "OTHER", note: t("freezeNote").slice(0, 400), createdAt: new Date().toISOString() }];
    e.handoverNotes = [{ id: "h_hostile", text: t("handover").slice(0, 500), by: t("by").slice(0, 120), at: new Date().toISOString() }];
    for (const v of state.venues || []) { v.name = t("venueName"); for (const l of v.layouts || []) l.name = t("layoutName"); }
    touchEvent(e); render();
  }, { T: tagged("__FIELD__") });
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="backup-export"]')]);
  const backupFile = path.join(artifactDir, "hostile-backup.json");
  fs.copyFileSync(await dl.path(), backupFile);

  // A fresh install restores it through the real control.
  await page.evaluate(() => { state.events = []; state.venues = []; render(); });
  await page.waitForTimeout(200);
  await click(page, '[data-action="backup-import"]');
  await page.setInputFiles("#backupFileInput", backupFile);
  await page.waitForTimeout(800);
  checks.require(await page.evaluate(() => state.events.length === 1 && state.events[0].guests.length === 2),
    "the hostile backup restored — the payload is ordinary text, and refusing it would not be the fix");

  await audit(page, "Events list", checks, { mustShow: [visibleMark("eventName")] });

  // Every workspace tab, with the payload-bearing thing selected where a tab
  // has a selection to show.
  await page.evaluate(() => { ui.activeEventId = state.events[0].id; ui.screen = "workspace"; render(); });
  await gotoTab(page, "command"); await settle(page);
  await audit(page, "Command Center", checks, { mustShow: [visibleMark("handover")] });
  await gotoTab(page, "floor"); await settle(page);
  await audit(page, "Floor Plan", checks, { mustShow: [visibleMark("tableNumber")], allowMissing: true });
  await page.evaluate(() => { ui.selectedObjectId = state.events[0].tables[0].id; ui.selectedObjectIds = [ui.selectedObjectId]; render(); });
  await settle(page);
  await audit(page, "Floor Plan, table selected", checks, { mustShow: [visibleMark("tableNumber")] });
  await page.evaluate(() => { ui.selectedObjectId = "vo_hostile"; ui.selectedObjectIds = ["vo_hostile"]; render(); });
  await settle(page);
  await audit(page, "Floor Plan, object selected", checks);
  await page.evaluate(() => { ui.selectedObjectId = null; ui.selectedObjectIds = []; render(); });
  await gotoTab(page, "guests"); await settle(page);
  await audit(page, "Guests", checks, { mustShow: [visibleMark("guestName"), visibleMark("invitedBy")] });
  await click(page, '[data-guest-edit="g_hostile"]');
  await page.waitForTimeout(250);
  await audit(page, "Guest dialog", checks, { mustShow: [visibleMark("guestName"), visibleMark("notes")] });
  await page.evaluate(() => document.getElementById("guestDialog").close());
  await gotoTab(page, "seating"); await settle(page);
  await audit(page, "Seating", checks, { mustShow: [visibleMark("unseatedGuest")] });
  await page.evaluate(() => { ui.selectedObjectId = state.events[0].tables[0].id; render(); });
  await settle(page);
  await audit(page, "Seating, table selected", checks, { mustShow: [visibleMark("guestName")] });
  await gotoTab(page, "live"); await settle(page);
  await audit(page, "Live", checks, { mustShow: [visibleMark("guestName")] });
  await gotoTab(page, "reports"); await settle(page);
  await audit(page, "Reports", checks);

  // ============================ TYPED ======================================
  // The three search boxes and the finder: the query is echoed into a field's
  // value and matched against the hostile names.
  await gotoTab(page, "guests");
  await typeQuery(page, "#guestSearch", "F:guestName|<img");
  await audit(page, "Guests, searched with markup", checks, { mustShow: [visibleMark("guestName")] });
  await gotoTab(page, "live");
  await typeQuery(page, "#liveSearch", "F:guestName|<img src=x");
  await audit(page, "Live door search, searched with markup", checks, { mustShow: [visibleMark("guestName")] });
  await gotoTab(page, "seating");
  await typeQuery(page, "#seatingSearch", `"><svg onload=`);
  await audit(page, "Seating search, typed markup", checks);
  await typeQuery(page, "#globalGuestSearch", "F:guestName|<img");
  await page.waitForTimeout(300);
  await audit(page, "Global finder results", checks, { mustShow: [visibleMark("guestName")] });
  await page.fill("#globalGuestSearch", "");

  // The guest dialog, typed the way a coordinator types.
  // The form is read back before saving, the way tests/lib addGuest does and
  // for the reason it records: a fill focuses and then inserts, and a render()
  // landing in between (a toast clearing, a save completing) moves the text.
  // This step failed once in six runs before it verified what it typed.
  await gotoTab(page, "guests");
  await settle(page);
  const want = { name: tagged("typedName"), invitedBy: tagged("typedInvitedBy"), notes: tagged("typedNotes") };
  let typed = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await click(page, '[data-guest-command="add"]');
    await page.waitForSelector("#guestForm", { state: "visible" });
    await page.fill('#guestForm input[name="name"]', want.name);
    await page.fill('#guestForm [name="invitedBy"]', want.invitedBy);
    await page.fill('#guestForm [name="notes"]', want.notes);
    typed = await page.evaluate(() => ({ name: document.querySelector('#guestForm input[name="name"]').value,
      invitedBy: document.querySelector('#guestForm [name="invitedBy"]').value, notes: document.querySelector('#guestForm [name="notes"]').value }));
    if (typed.name === want.name && typed.invitedBy === want.invitedBy && typed.notes === want.notes) break;
    await page.keyboard.press("Escape");
    await settle(page);
  }
  await click(page, "#guestForm .dialog-foot .btn.primary");
  await page.waitForTimeout(400);
  const savedNames = await page.evaluate(() => state.events[0].guests.map((g) => g.name.slice(0, 40)));
  checks.ok(savedNames.includes(want.name.slice(0, 40)) && await page.evaluate((n) => state.events[0].guests.some((g) => g.name === n), want.name),
    "a guest TYPED with the payload as a name is saved with exactly that name", { savedNames, typedOk: typed && typed.name === want.name });
  await audit(page, "Guests, after typing a hostile guest", checks, { mustShow: [visibleMark("typedName")] });

  // A handover note typed at the Command Center.
  await gotoTab(page, "command"); await settle(page);
  await page.fill("[data-handover-text]", tagged("typedHandover").slice(0, 480));
  await page.fill("[data-handover-by]", "F:typedBy|<svg onload=window.__pwned.push(1)>");
  await click(page, "[data-handover-add]");
  await page.waitForTimeout(300);
  await audit(page, "Command Center, after typing a handover note", checks, { mustShow: [visibleMark("typedHandover")] });

  // A new event, named with it.
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(300);
  await createBlankEvent(page, { name: tagged("typedEvent"), hotel: tagged("typedHotel"), salon: tagged("typedSalon"), date: futureDate() });
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(300);
  await audit(page, "Events list, after creating a hostile event", checks, { mustShow: [visibleMark("typedEvent")] });

  // ================= IMPORTED: A GUEST SPREADSHEET =========================
  // Headers and cells both carry it, and every wizard step renders one or the
  // other: the preview (cells), the mapping (headers), the interpretation
  // (editable fields) and the summary.
  await page.evaluate(() => { ui.activeEventId = state.events.find((e) => e.name.startsWith("F:eventName")).id; ui.screen = "workspace"; ui.tab = "guests"; render(); });
  await page.waitForTimeout(300);
  const csvCell = (f) => `"${tagged(f).replaceAll('"', '""')}"`;
  const csv = [
    `Name Surname,Notes,Invited By,${csvCell("header")}`,
    `${csvCell("csvName")},${csvCell("csvNotes")},${csvCell("csvInvitedBy")},x`,
  ].join("\n");
  await click(page, "[data-guest-command='import']");
  await page.setInputFiles("#guestFileInput", { name: "hostile.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.waitForTimeout(400);
  await audit(page, "Import wizard, source preview", checks, { mustShow: [visibleMark("csvName"), visibleMark("header")] });
  await click(page, "[data-wizard-next]"); await page.waitForTimeout(200);
  await audit(page, "Import wizard, column mapping", checks, { mustShow: [visibleMark("header")] });
  await click(page, "[data-wizard-next]"); await page.waitForTimeout(250);
  await audit(page, "Import wizard, interpretation", checks, { mustShow: [visibleMark("csvName")] });
  await click(page, "[data-wizard-next]"); await page.waitForTimeout(200);
  await audit(page, "Import wizard, summary", checks);
  await click(page, "[data-wizard-import]");
  await page.waitForTimeout(400);
  checks.ok(await page.evaluate((n) => state.events.some((e) => e.guests.some((g) => g.name === n)), tagged("csvName")),
    "the spreadsheet row imports with the payload as its name, unaltered");
  // The Guests search still holds the query typed above; clear it, or the
  // list is filtered to a different guest and the check reads nothing.
  await page.evaluate(() => { ui.guestQuery = ""; render(); });
  await page.waitForTimeout(200);
  await audit(page, "Guests, after the spreadsheet import", checks, { mustShow: [visibleMark("csvName")] });

  // ============== DERIVED: TEXT THE PRODUCT READS OFF A PLAN ===============
  // The OCR engine replaced before boot, returning the payload as words laid
  // over the whole sheet — so every detected object's text evidence, every
  // printed-number reading and every label search sees it. Then the real
  // Assisted Detection runs on a committed fixture.
  await page.addInitScript((P) => {
    Object.defineProperty(globalThis, "runPlanOCR", {
      configurable: true,
      get: () => async () => ({
        available: true,
        text: P,
        words: P.split(" ").map((w, i) => ({ text: w, confidence: 90,
          bbox: { x0: 20 + i * 90, y0: 20 + (i % 7) * 120, x1: 100 + i * 90, y1: 60 + (i % 7) * 120 } })),
      }),
      set: () => {},
    });
  }, `F:ocr|${PAYLOAD} 12 T07`);
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Hostile OCR", hotel: "Merit", date: futureDate() });
  const plan = fs.readFileSync(path.join(repoRoot, "benchmarks/adversarial/fixtures/a1-chair-under-table.png"));
  await page.evaluate((src) => {
    const e = state.events.find((x) => x.name === "Hostile OCR");
    ui.activeEventId = e.id; ui.screen = "workspace"; ui.tab = "floor";
    e.background = { src, name: "plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, "data:image/png;base64," + plan.toString("base64"));
  await page.waitForTimeout(400);
  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => { const e = state.events.find((x) => x.name === "Hostile OCR"); return !!e.analysis && !ui.analysisBusy; }, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const ocr = await page.evaluate(() => {
    const a = state.events.find((x) => x.name === "Hostile OCR").analysis;
    return { available: !!(a.ocr && a.ocr.available), candidates: a.candidates.length, text: String(a.ocrText || "").slice(0, 40) };
  });
  checks.ok(ocr.available && ocr.candidates > 0 && ocr.text.startsWith("F:ocr|"),
    "the stubbed engine's reading reached the analysis — the derived path really carried the payload", ocr);
  await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; render(); });
  await settle(page);
  await audit(page, "Plan review, after OCR read the payload", checks);
  const firstCandidate = await page.evaluate(() => state.events.find((x) => x.name === "Hostile OCR").analysis.candidates[0]?.id || null);
  if (firstCandidate) {
    await page.evaluate((id) => { ui.selectedCandidateId = id; render(); }, firstCandidate);
    await settle(page);
    await audit(page, "Plan review, a candidate selected", checks);
  }
}
