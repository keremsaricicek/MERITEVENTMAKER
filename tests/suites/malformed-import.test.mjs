// A BAD FILE IS REFUSED WHOLE, WITH A MESSAGE, AND NOTHING CHANGES.
//
// `.claude/skills/merit-security-hardening/SKILL.md`: "A malformed
// XLSX/CSV/PDF/JSON is rejected with a message, never half-applied. Partial
// application of a corrupt import is worse than refusing it." And: "Numeric
// fields coming from a sheet are validated, not coerced and trusted. A pax
// value of "1e9" or "-3" is a rejection, not a table."
//
// `backup-restore` already refuses a foreign file, corrupt bytes and a broken
// reference. This suite covers what that one does not, and every case in it
// was a MEASURED failure when it was written, not a hypothetical:
//
//   A BACKUP FROM A NEWER BUILD threw uncaught out of the file reader — no
//     message — AND latched the schema guard's read-only flag on the CURRENT,
//     healthy install, which then silently stopped saving.
//   A LIST THAT IS NOT A LIST (`tables: "abc"`, `guests: [null]`) threw a
//     TypeError out of the file reader. Nothing was applied; nothing was said.
//   AN UNREADABLE DATE was accepted and saved, and every render of the Events
//     screen then threw `RangeError: Invalid time value` from fmtDate(). The
//     install was dead, and stayed dead across reloads, because the restore
//     had already been written.
//   A PARTY OF A BILLION (`additionalGuests: 1e9`) restored as a guest. From a
//     spreadsheet, "1e9" and "0x10" were read by Number() as a billion and as
//     sixteen.
//   AN ID CARRYING A QUOTE restored as an id, and ids are interpolated into
//     markup as attribute values.
//   A BROKEN .png became the event's floor plan, because nothing decoded it.
//
// Every refusal is asserted the same four ways: a message was shown, the
// events on this machine are exactly what they were, the page raised no error,
// and a normal save afterwards still lands (the guard was not latched).
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent, addTables, futureDate, gotoTab } from "../lib/app-actions.mjs";

export const meta = { name: "malformed-import", tags: ["security", "storage", "fast"], timeout: 200000, downloads: true };

export default async function run({ page, checks, baseUrl, artifactDir }) {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Malformed Source", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 2 });
  await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 6;
    e.guests = [{
      id: "g_mf", name: "Malformed Guest", additionalGuests: 1, pax: 2, vip: "Standard",
      invitedBy: "Host", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: { tableId: e.tables[0].id, seats: [0, 1], locked: false }, createdAt: new Date().toISOString(),
    }];
    touchEvent(e); render();
  });
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(300);

  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="backup-export"]')]);
  const backup = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  const [pdl] = await Promise.all([page.waitForEvent("download"), page.click("[data-export-event-package]")]);
  const pkg = JSON.parse(fs.readFileSync(await pdl.path(), "utf8"));
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const snapshot = () => page.evaluate(() => ({
    events: state.events.map((e) => `${e.id}|${e.name}|${e.tables.length}|${e.guests.map((g) => g.name).join(",")}`),
    venues: (state.venues || []).length,
    readOnly: !!(globalThis.MERIT_SCHEMA_GUARD && MERIT_SCHEMA_GUARD.readOnly),
  }));
  const lastToast = () => page.evaluate(() =>
    [...document.querySelectorAll(".toast")].map((n) => n.textContent.trim()).slice(-1)[0] || null);
  const clearToasts = () => page.evaluate(() => document.querySelectorAll(".toast").forEach((n) => n.remove()));

  // One refusal, asserted four ways.
  const refused = async (label, text, pattern) => {
    const before = await snapshot();
    const file = path.join(artifactDir, label.replace(/\W+/g, "-") + ".json");
    fs.writeFileSync(file, text);
    await clearToasts();
    pageErrors.length = 0;
    await click(page, '[data-action="backup-import"]');
    await page.setInputFiles("#backupFileInput", file);
    await page.waitForTimeout(600);
    const toast = await lastToast();
    const after = await snapshot();
    checks.ok(toast && pattern.test(toast), `${label}: refused WITH A MESSAGE that says what is wrong`, toast);
    checks.equal(after.events, before.events, `${label}: the events on this machine are exactly what they were`);
    checks.equal(after.venues, before.venues, `${label}: and so are its venues`);
    checks.equal(pageErrors.slice(), [], `${label}: no uncaught error out of the file reader`);
    checks.equal(after.readOnly, false, `${label}: and the install is still writable — refusing a file never latches the read-only guard`);
  };

  // --- BACKUPS ------------------------------------------------------------
  const b = (f) => { const x = clone(backup); f(x); return JSON.stringify(x); };
  await refused("backup from a newer build",
    b((x) => { x.payload.schemaVersion = 999; x.payload.version = 999; }), /newer version/i);
  await refused("backup with a null event", b((x) => { x.payload.events = [null]; }),
    /events\[0\] is not a record/);
  await refused("backup whose tables are not a list", b((x) => { x.payload.events[0].tables = "abc"; }),
    /events\[0\]\.tables is not a list/);
  await refused("backup with a null guest", b((x) => { x.payload.events[0].guests = [null]; }),
    /events\[0\]\.guests\[0\] is not a record/);
  await refused("backup whose guest name is an object",
    b((x) => { x.payload.events[0].guests[0].name = { first: "A" }; }), /guests\[0\]\.name is not text/);
  await refused("backup whose table number is a number",
    b((x) => { x.payload.events[0].tables[0].number = 7; }), /tables\[0\]\.number is not text/);
  await refused("backup with an unreadable date",
    b((x) => { x.payload.events[0].date = "not-a-date"; }), /date is not a valid date/);
  await refused("backup with a date that is not on the calendar",
    b((x) => { x.payload.events[0].date = "2026-02-31"; }), /date is not a valid date/);
  await refused("backup with a party of a billion",
    b((x) => { x.payload.events[0].guests[0].additionalGuests = 1e9; }), /additionalGuests is not a valid party size/);
  await refused("backup with a seat index of a billion",
    b((x) => { x.payload.events[0].guests[0].assignment.seats = [1e9]; }), /assignment is not a valid seat assignment/);
  await refused("backup with an id carrying markup",
    b((x) => { x.payload.events[0].guests[0].id = 'g" onmouseover="window.__pwned=1'; }), /guests\[0\]\.id is not an identifier/);
  await refused("backup whose audit log is not a list", b((x) => { x.payload.audit = "nope"; }),
    /not a MERIT EVENT MAKER backup/i);
  // Deep enough to overflow a recursive walker, in a field no check reads —
  // so this is the containment around the migration itself, not a rule.
  const deepText = JSON.stringify(backup).replace('"payload":{', `"payload":{"nested":${"[".repeat(120000)}${"]".repeat(120000)},`);
  {
    const before = await snapshot();
    const file = path.join(artifactDir, "deep.json");
    fs.writeFileSync(file, deepText);
    await clearToasts();
    pageErrors.length = 0;
    await click(page, '[data-action="backup-import"]');
    await page.setInputFiles("#backupFileInput", file);
    await page.waitForTimeout(1200);
    const after = await snapshot();
    const toast = await lastToast();
    checks.ok(!!toast, "a 120,000-level nested backup is answered with a message, restored or refused — never silence", toast);
    checks.equal(pageErrors.slice(), [], "and nesting that deep raises no uncaught error");
    checks.equal(after.readOnly, false, "and leaves the install writable", after);
    checks.ok(after.events.length >= 1, "and the install still has its events", after.events.length);
    void before;
  }

  // The control: after every refusal above, a GOOD backup still restores.
  {
    const good = clone(backup);
    good.payload.events[0].name = "Restored After Refusals";
    const file = path.join(artifactDir, "good.json");
    fs.writeFileSync(file, JSON.stringify(good));
    await click(page, '[data-action="backup-import"]');
    await page.setInputFiles("#backupFileInput", file);
    await page.waitForTimeout(700);
    const s = await snapshot();
    checks.ok(s.events.length === 1 && s.events[0].includes("Restored After Refusals"),
      "a valid backup still restores after all of that — the checks refuse bad files, not files", s.events);
  }

  // --- EVENT PACKAGES -----------------------------------------------------
  const p = (f) => { const x = clone(pkg); f(x); return JSON.stringify(x); };
  await refused("package from a newer build", p((x) => { x.formatVersion = 99; }), /newer version/i);
  await refused("package with a null guest", p((x) => { x.event.guests = [null]; }),
    /event\.guests\[0\] is not a record/);
  await refused("package with an unreadable date", p((x) => { x.event.date = "31/31/2031"; }),
    /event\.date is not a valid date/);
  await refused("package whose audit entries are not a list", p((x) => { x.auditEntries = "nope"; }),
    /not a MERIT EVENT MAKER event package/i);
  await refused("package with a null audit entry", p((x) => { x.auditEntries = [null]; }),
    /not a MERIT EVENT MAKER event package/i);
  await refused("package whose venue is not a record", p((x) => { x.venue = "Merit Royal"; }),
    /not a MERIT EVENT MAKER event package/i);

  // --- AN UNREADABLE DATE ALREADY ON DISK ---------------------------------
  // The import now refuses one, but a record written before this build, or
  // edited by hand, can still carry it. It must cost one field, not the
  // screen: fmtDate() renders "—" instead of throwing out of render().
  pageErrors.length = 0;
  const survived = await page.evaluate(() => {
    state.events[0].date = "garbage";
    ui.screen = "events"; ui.activeEventId = null;
    try { render(); } catch (e) { return { threw: e.message }; }
    return { threw: null, rendered: !!document.querySelector("[data-action='backup-import']"), dash: document.body.textContent.includes("—") };
  });
  checks.ok(!survived.threw && survived.rendered,
    "an unreadable date already in state renders — the Events screen no longer dies on it", survived);
  await page.evaluate(() => { state.events[0].date = new Date(Date.now() + 90 * 86400000).toLocaleDateString("en-CA"); render(); });

  // --- GUEST SPREADSHEETS -------------------------------------------------
  await page.evaluate(() => { ui.activeEventId = state.events[0].id; ui.screen = "workspace"; ui.tab = "guests"; render(); });
  await page.waitForTimeout(300);
  const csv = [
    "Name Surname,Pax",
    "Scientific,1e9",
    "Hexadecimal,0x10",
    "Negative,-3",
    "Fraction,2.5",
    "Too Many,150",
    "Formatted Number,3.00",
    "Plain,4",
  ].join("\n");
  await click(page, "[data-guest-command='import']");
  await page.setInputFiles("#guestFileInput", { name: "counts.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.waitForTimeout(400);
  await click(page, "[data-wizard-next]"); await page.waitForTimeout(150);
  await click(page, "[data-wizard-next]"); await page.waitForTimeout(250);
  const interpreted = await page.evaluate(() => pendingImport.interpreted.map((r) => ({
    name: r.name, pax: r.pax, error: (r.issues || []).some((x) => x.level === "error"),
  })));
  const row = (n) => interpreted.find((r) => r.name === n) || {};
  for (const n of ["Scientific", "Hexadecimal", "Negative", "Fraction", "Too Many"])
    checks.ok(row(n).error, `a pax cell of "${csv.split("\n").find((l) => l.startsWith(n)).split(",")[1]}" is a REJECTION, not a party of ${row(n).pax}`, row(n));
  checks.ok(!row("Formatted Number").error && row("Formatted Number").pax === 3,
    'a number-formatted "3.00" is still a party of three — strict is not the same as brittle', row("Formatted Number"));
  checks.ok(!row("Plain").error && row("Plain").pax === 4, "and a plain 4 is four", row("Plain"));
  await click(page, "[data-wizard-next]"); await page.waitForTimeout(200);
  const importDisabled = await page.evaluate(() => document.querySelector("[data-wizard-import]")?.disabled);
  checks.equal(importDisabled, true, "and the import cannot be run while any row carries one of those errors", importDisabled);
  await page.evaluate(() => { document.getElementById("excelDialog").close(); pendingImport = null; });

  // "+N" in the name is the other way a party size arrives from a sheet.
  await click(page, "[data-guest-command='import']");
  await page.setInputFiles("#guestFileInput", { name: "plus.csv", mimeType: "text/csv",
    buffer: Buffer.from("Name Surname\nHuge Party +500\nSmall Party +2\n") });
  await page.waitForTimeout(400);
  await click(page, "[data-wizard-next]"); await page.waitForTimeout(150);
  await click(page, "[data-wizard-next]"); await page.waitForTimeout(250);
  const plus = await page.evaluate(() => pendingImport.interpreted.map((r) => ({
    name: r.name, pax: r.pax, error: (r.issues || []).some((x) => x.level === "error") })));
  checks.ok(plus.find((r) => r.name === "Huge Party")?.error, 'a "+500" in the name is refused like a pax cell of 501', plus);
  checks.ok(plus.find((r) => r.name === "Small Party" && r.pax === 3 && !r.error), 'while "+2" is still a party of three', plus);
  await page.evaluate(() => { document.getElementById("excelDialog").close(); pendingImport = null; });

  // Files that are not spreadsheets at all.
  const guestsBefore = await page.evaluate(() => state.events[0].guests.length);
  const goodXlsx = await page.evaluate(() => {
    const ws = XLSX.utils.aoa_to_sheet([["Name Surname", "Pax"], ...Array.from({ length: 40 }, (_, i) => [`Row ${i}`, 2])]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Guests");
    return Array.from(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })));
  });
  for (const [label, buffer] of [
    ["a truncated .xlsx", Buffer.from(goodXlsx.slice(0, Math.floor(goodXlsx.length / 2)))],
    ["random bytes named .xlsx", Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256))],
    ["an empty .csv", Buffer.from("")],
  ]) {
    await clearToasts();
    pageErrors.length = 0;
    await click(page, "[data-guest-command='import']");
    const name = label.endsWith(".csv") ? "empty.csv" : "broken.xlsx";
    await page.setInputFiles("#guestFileInput", { name, mimeType: "application/octet-stream", buffer });
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => ({
      toast: [...document.querySelectorAll(".toast")].map((n) => n.textContent.trim()).slice(-1)[0] || null,
      guests: state.events[0].guests.length,
      reachedPreview: !!(pendingImport && pendingImport.step >= 2 && pendingImport.rows.length),
    }));
    checks.ok(r.toast && !r.reachedPreview, `${label} is refused with a message before any row is previewed`, r);
    checks.equal(r.guests, guestsBefore, `${label}: the guest list is untouched`);
    checks.equal(pageErrors.slice(), [], `${label}: no uncaught error`);
    await page.evaluate(() => { const d = document.getElementById("excelDialog"); if (d.open) d.close(); pendingImport = null; });
  }

  // --- FLOOR PLAN FILES ---------------------------------------------------
  await gotoTab(page, "floor");
  const planBefore = await page.evaluate(() => JSON.stringify(state.events[0].background || null));
  for (const [label, file] of [
    ["a .png that is not an image", { name: "plan.png", mimeType: "image/png", buffer: Buffer.from("this is not a png at all") }],
    ["a truncated .png", { name: "cut.png", mimeType: "image/png",
      buffer: Buffer.from("89504e470d0a1a0a0000000d49484452000003e8000002bc08060000", "hex") }],
    ["a .pdf that is not a PDF", { name: "plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nbroken") }],
  ]) {
    await clearToasts();
    pageErrors.length = 0;
    await page.setInputFiles("#floorPlanFile", file);
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => ({
      toast: [...document.querySelectorAll(".toast")].map((n) => n.textContent.trim()).slice(-1)[0] || null,
      plan: JSON.stringify(state.events[0].background || null),
    }));
    checks.ok(r.toast && /could not be replaced/i.test(r.toast), `${label} is refused with a message`, r.toast);
    checks.ok(r.plan === planBefore, `${label}: the current floor plan is exactly what it was`, null);
    checks.equal(pageErrors.slice(), [], `${label}: no uncaught error`);
  }
}
