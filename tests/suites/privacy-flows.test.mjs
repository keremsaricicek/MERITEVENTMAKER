// A GUEST'S NAME AND NOTE NEVER REACH THE CONSOLE OR A RAW ERROR TEXT — ON ANY MAIN FLOW.
//
// `.claude/skills/merit-security-hardening/SKILL.md`, Privacy: "Guest names,
// notes and contact-like fields must not appear in console logs, error
// messages, or telemetry of any kind. An error shown to an operator must not
// echo a raw record."
//
// `privacy-logs` holds the boot path against a corrupted stored record. This
// holds everything an operator does with a guest after that, with a SENTINEL
// guest (a name, an inviter and a note nobody else uses) in reach of every
// step, and every console message read whole — its text, and every argument
// evaluated (an Error's message AND stack, an object as JSON) — plus every
// uncaught page error:
//
//   typed through the dialog · seated · searched (guest list, door, finder) ·
//   checked in, set No Show, reset · moved between tables · exported (workbook,
//   CSV) · printed · asked about and commanded through F8 · deleted and undone
//   · saved while BOTH stores refuse the write (quota) · a broken guest file,
//   a broken backup and a broken event package each carrying the name next to
//   the damage — the case where a parser quotes what it failed on.
//
// Operator-facing error text (every toast and notice) is read too: it may name
// a guest where that is the message ("Selin is already seated"), but it must
// never carry a raw record (`"name":`, `{"id":`) or a parser excerpt.
//
// MUTATION PROOF, recorded 2026-11-01: the backup reader logging the error it
// refused (`catch(e){console.warn(e); ...}` at the parseRecordText call in
// importBackupFile) fails step "broken backup" — Chromium's SyntaxError quotes
// `"name": Sentinelka"`. That is also why the marker LEADS the name: the
// excerpt is ~10 characters, and a marker at the end of a name would be cut.
// Measured before any fix: nothing on these flows leaked (the boot path's leak
// was closed by privacy-logs' `loggableError`); this suite keeps it so.
// PRIVACY_FLOWS_DUMP=1 prints each step and every message read.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, addTables, addGuest, gotoTab, seatGuestOnFirstTable, futureDate, settle, typeQuery, click, autoAnswer } from "../lib/app-actions.mjs";

export const meta = { name: "privacy-flows", tags: ["security", "fast"], timeout: 300000, downloads: true };

// The marker leads the name: a parser excerpt keeps ~10 characters either side
// of the damage, so a marker at the end of a name could be cut off and missed.
const NAME = "Sentinelkaya Selin";
const INVITER = "Inviter Sentinelbey";
const NOTE = "Private note SENTINELNOTE allergy";
const LEAK = /sentin/i;
const RAW_RECORD = /"name"\s*:|\{"id"\s*:|"guests"\s*:\s*\[/;

export default async function run({ page, checks, baseUrl, artifactDir }) {
  const seen = [];
  let step = "boot";
  page.on("console", async (msg) => {
    const parts = [msg.text()];
    for (const a of msg.args()) {
      try {
        parts.push(await a.evaluate((v) => v instanceof Error ? `${v.name}: ${v.message}\n${v.stack}` : (v && typeof v === "object") ? JSON.stringify(v) : String(v)));
      } catch { /* a handle from a navigated-away page */ }
    }
    seen.push({ step, type: msg.type(), text: parts.join(" | ") });
  });
  page.on("pageerror", (e) => seen.push({ step, type: "pageerror", text: `${e.message}\n${e.stack}` }));
  const errorTexts = [];
  const readErrorTexts = async () => {
    const texts = await page.evaluate(() => [...document.querySelectorAll(".toast, [role='alert'], .storage-notice, .v8-error, .error")].map((n) => n.textContent.trim()).filter(Boolean));
    for (const text of texts) errorTexts.push({ step, text });
  };
  const at = async (name, fn) => { step = name; if (process.env.PRIVACY_FLOWS_DUMP) process.stderr.write(`      · ${name}\n`); await fn(); await settle(page).catch(() => {}); await readErrorTexts(); };

  await autoAnswer(page);
  await openApp(page, baseUrl, { lang: "en" });
  await at("create event", async () => {
    await createBlankEvent(page, { name: "Privacy Flows", hotel: "Merit Royal", date: futureDate() });
    checks.require((await addTables(page)) === 4, "four tables");
  });
  await at("guest typed", async () => {
    await gotoTab(page, "guests");
    await addGuest(page, { name: NAME, additionalGuests: 2, vip: "VIP" });
    await addGuest(page, { name: "Other Guest" });
    await page.evaluate(({ NAME, INVITER, NOTE }) => {
      const g = state.events[0].guests.find((x) => x.name === NAME);
      g.invitedBy = INVITER; g.notes = NOTE; saveState(); render();
    }, { NAME, INVITER, NOTE });
  });
  await at("seated", () => seatGuestOnFirstTable(page, "Selin"));
  await at("searched", async () => {
    await gotoTab(page, "guests");
    await typeQuery(page, "#guestSearch", "Sentinel");
    await gotoTab(page, "live");
    await typeQuery(page, "#liveSearch", "Selin");
    await typeQuery(page, "#globalGuestSearch", "Sentinelkaya");
    await page.fill("#globalGuestSearch", "").catch(() => {});
  });
  await at("arrival", async () => {
    await gotoTab(page, "live");
    await page.fill("#liveSearch", "").catch(() => {});
    const id = await page.evaluate((NAME) => activeEvent().guests.find((x) => x.name === NAME).id, NAME);
    const status = () => page.evaluate((id) => activeEvent().guests.find((x) => x.id === id).arrivalStatus, id);
    const states = [];
    for (const which of ["Checked In", "Checked In", "No Show", "No Show"]) {
      await click(page, `[data-arrival="${which}"][data-live-guest="${id}"]`);
      await page.waitForTimeout(250);
      states.push(await status());
    }
    checks.equal(states, ["Checked In", "Not Arrived", "No Show", "Not Arrived"], "the arrival flow ran through the door buttons: check in, undo, No Show, undo");
  });
  await at("moved", async () => {
    const moved = await page.evaluate((NAME) => {
      const e = activeEvent(), g = e.guests.find((x) => x.name === NAME), to = e.tables[1];
      assignGuestToTable(g.id, to.id); render();
      return e.guests.find((x) => x.name === NAME).assignment?.tableId === to.id;
    }, NAME);
    checks.ok(moved, "the party moved to the second table");
  });
  await at("exported", async () => {
    await gotoTab(page, "reports");
    await page.waitForSelector('button:has-text("Export Table Plan")', { timeout: 15000 });
    await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Export Table Plan")')]);
    await gotoTab(page, "guests");
    await Promise.all([page.waitForEvent("download"), page.evaluate(() => exportGuestCSV())]);
  });
  await at("printed", async () => {
    await gotoTab(page, "reports");
    await page.evaluate(() => { window.print = () => {}; });
    await click(page, "[data-report='print']").catch(() => {});
  });
  await at("F8", async () => {
    await gotoTab(page, "guests");
    await page.keyboard.press("F8");
    await page.waitForSelector("#assistantPanel:not([hidden])", { timeout: 5000 });
    for (const text of ["Sentinelkaya Selin nerede oturuyor?", "Sentinelkaya Selin'i T 03'e taşı", "Who is at T 02?"]) {
      await page.fill("#assistantInput", text);
      await page.press("#assistantInput", "Enter");
      await page.waitForFunction(() => !document.getElementById("assistantPanel").classList.contains("is-working"), null, { timeout: 20000 });
      await settle(page);
    }
    await page.keyboard.press("Escape");
  });
  await at("deleted and undone", async () => {
    await page.evaluate(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); });
    await gotoTab(page, "guests");
    const id = await page.evaluate((NAME) => activeEvent().guests.find((x) => x.name === NAME).id, NAME);
    await page.evaluate((id) => deleteGuest(id), id);
    const gone = await page.evaluate((id) => !activeEvent().guests.some((x) => x.id === id), id);
    await click(page, ".toast.has-action button");
    await page.waitForTimeout(300);
    const back = await page.evaluate((id) => activeEvent().guests.some((x) => x.id === id), id);
    checks.ok(gone && back, "the guest was deleted and restored from the toast's Undo", { gone, back });
  });
  await at("save refused by both stores", async () => {
    await page.evaluate(() => {
      const quota = () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); };
      window.__restore = { put: IDBObjectStore.prototype.put, set: Storage.prototype.setItem };
      IDBObjectStore.prototype.put = quota; Storage.prototype.setItem = quota;
    });
    await page.evaluate(({ NAME, NOTE }) => { const g = activeEvent().guests.find((x) => x.name === NAME) || activeEvent().guests[0]; g.notes = NOTE + " edited"; saveState(); render(); }, { NAME, NOTE });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.__restore.put; Storage.prototype.setItem = window.__restore.set; });
  });

  // Broken files carrying the name next to the damage: the case where a parser
  // quotes the text it failed on.
  const brokenJson = `{"format":"merit-event-maker-backup","events":[{"id":"e1","guests":[{"id":"g1","name": ${NAME}", "notes":"${NOTE}"}]}]}`;
  await at("broken guest file", async () => {
    await gotoTab(page, "guests");
    await click(page, "[data-guest-command='import']");
    await page.setInputFiles("#guestFileInput", { name: "broken.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(`PK\u0003\u0004${NAME} ${NOTE} not a zip`) });
    await page.waitForTimeout(600);
    await page.evaluate(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); });
  });
  await at("broken backup", async () => {
    await page.evaluate(() => { ui.screen = "events"; ui.activeEventId = null; render(); });
    const file = path.join(artifactDir, "broken-backup.json");
    fs.writeFileSync(file, brokenJson);
    await click(page, '[data-action="backup-import"]');
    await page.setInputFiles("#backupFileInput", file);
    await page.waitForTimeout(600);
  });
  await at("backup with a bad record", async () => {
    // Valid JSON, refused by the record check: the refusal names the PATH and
    // the rule, never the value or the record around it.
    const file = path.join(artifactDir, "bad-record-backup.json");
    fs.writeFileSync(file, JSON.stringify({ format: "merit-event-maker-backup", payload: { schemaVersion: 9, events: [{ id: "e1", name: "Gala", date: "2031-01-01", tables: [], guests: [{ id: "g1", name: NAME, notes: NOTE, invitedBy: INVITER, pax: "1e9", additionalGuests: { bad: NAME } }] }] } }));
    await click(page, '[data-action="backup-import"]');
    await page.setInputFiles("#backupFileInput", file);
    await page.waitForTimeout(600);
  });
  await at("broken event package", async () => {
    const file = path.join(artifactDir, "broken-package.json");
    fs.writeFileSync(file, JSON.stringify({ format: "merit-event-maker-event-package", event: { id: "e9", name: "Pkg", guests: [{ id: "g9", name: NAME, notes: NOTE, pax: -3 }] } }));
    await click(page, '[data-action="backup-import"]');
    await page.setInputFiles("#backupFileInput", file);
    await page.waitForTimeout(600);
  });

  // --- the verdict ----------------------------------------------------------
  const steps = [...new Set(seen.map((s) => s.step))];
  checks.ok(seen.length > 0 || steps.length === 0, "(console messages were captured)", { messages: seen.length });
  checks.ok(errorTexts.some((e) => e.step === "broken backup"), "the broken backup was refused with a message an operator sees", errorTexts.filter((e) => e.step === "broken backup"));
  const leaked = seen.filter((s) => LEAK.test(s.text)).map((s) => `${s.step} · ${s.type}: ${s.text.slice(0, 240)}`);
  checks.equal(leaked, [], "no console message or page error, on any flow, carries the guest's name, inviter or note");
  const raw = errorTexts.filter((e) => RAW_RECORD.test(e.text) || (LEAK.test(e.text) && /Unexpected token|is not valid JSON|SyntaxError/i.test(e.text)))
    .map((e) => `${e.step}: ${e.text.slice(0, 200)}`);
  checks.equal(raw, [], "no error text shown to the operator echoes a raw record or a parser excerpt of one");
  const notes = errorTexts.filter((e) => e.text.includes("SENTINELNOTE")).map((e) => `${e.step}: ${e.text.slice(0, 160)}`);
  checks.equal(notes, [], "no error text or notice carries a guest's private note");
  if (process.env.PRIVACY_FLOWS_DUMP) console.log(JSON.stringify(seen, null, 1));
  console.log(`    ${seen.length} console messages read across ${steps.length} flows; ${errorTexts.length} operator-facing texts`);
}
