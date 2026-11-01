// AN EXPORT CARRIES WHAT THE REPORT CONTRACT SAYS — AND NOTHING THAT RUNS.
//
// `.claude/skills/merit-security-hardening/SKILL.md`, Privacy: "Exports contain
// what the report contract says and nothing more." `.claude/rules/reports.md`
// is the contract: the workbook is TABLE PLAN, GUEST LIST and UNASSIGNED; the
// guest CSV is the same eight columns as the list sheets.
//
// `xlsx-contract` proves the workbook holds what it must. This proves the
// other half, on the two files an operator hands to a venue or caterer:
//
//   ONLY THE CONTRACT  A guest record that carries more than the contract —
//                      an e-mail, a phone number, an internal field, its own
//                      id and its event's — exports none of it: exactly the
//                      three sheets in order, exactly the eight columns, no
//                      cell and no workbook property carrying the extras.
//   NOTHING THAT RUNS  A name or note that starts with = + - @ (or a tab / CR)
//                      is a formula to the spreadsheet that opens the file:
//                      `=HYPERLINK("http://…","Open")` in a CSV becomes a live
//                      link, `=cmd|…` a DDE prompt (CSV/formula injection,
//                      OWASP). In the workbook such a cell must be a plain
//                      string with no formula; in the CSV it must be
//                      neutralised with a leading apostrophe — the text kept,
//                      only no longer a formula.
//   ROUND TRIP         The CSV this writes, imported back through the guest
//                      wizard, gives the names back as they were typed: the
//                      neutralising apostrophe is the file's, not the guest's.
//
// MEASURED BEFORE THE FIX, which is this suite's mutation proof: the CSV wrote
// `"=HYPERLINK(""http://evil.example/x"",""Open"")"` and three more
// formula-led cells as they were — each one live in the spreadsheet that opens
// the file. The workbook was already safe (SheetJS writes them as strings).
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, addTables, addGuest, gotoTab, seatGuestOnFirstTable, futureDate, click } from "../lib/app-actions.mjs";

export const meta = { name: "export-contract-privacy", tags: ["security", "reports", "fast"], timeout: 180000, downloads: true };

const LIST_HEADERS = ["NAME SURNAME", "PAX", "STATUS", "VIP", "INVITED BY", "TABLE", "SEATS", "NOTES"];
const SHEETS = ["TABLE PLAN", "GUEST LIST", "UNASSIGNED"];
const EXTRAS = { email: "leak.sentinel@example.com", phone: "+90 555 010 2030 SENTINEL", internalMemo: "INTERNAL-ONLY-SENTINEL" };
const FORMULA_NAMES = [
  `=HYPERLINK("http://evil.example/x","Open")`,
  `+cmd|' /C calc'!A0`,
  `@SUM(1+1)*cmd`,
  `-2+3+cmd`,
];
const FORMULA_LEAD = /^[=+\-@\t\r]/;

// RFC 4180, as the export writes it (every field quoted, "" for a quote).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export default async function run({ page, checks, baseUrl, artifactDir }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Export Contract", hotel: "Merit Royal", date: futureDate() });
  checks.require((await addTables(page)) === 4, "four tables");
  await gotoTab(page, "guests");
  await addGuest(page, { name: "Kerem Sariciek", additionalGuests: 1, vip: "VIP" });
  for (const name of FORMULA_NAMES) await addGuest(page, { name });
  await seatGuestOnFirstTable(page, "Kerem");

  // The record carries more than the contract: what an imported or older
  // record might hold. None of it may leave in an export.
  const ids = await page.evaluate((extras) => {
    const e = state.events[0];
    for (const g of e.guests) Object.assign(g, extras);
    e.guests.find((g) => g.name.startsWith("Kerem")).notes = "=1+1 note";
    saveState(); render();
    return { event: e.id, guests: e.guests.map((g) => g.id) };
  }, EXTRAS);
  const forbidden = [...Object.values(EXTRAS), ...ids.guests, ids.event];

  // --- the workbook -----------------------------------------------------------
  await gotoTab(page, "reports");
  await page.waitForSelector('button:has-text("Export Table Plan")', { timeout: 15000 });
  const [wbDownload] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Export Table Plan")')]);
  const wbPath = path.join(artifactDir, "export-contract.xlsx");
  await wbDownload.saveAs(wbPath);
  const wb = await page.evaluate((b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const book = XLSX.read(bytes, { type: "array", cellFormula: true });
    const sheets = {}, formulas = [], typed = [];
    for (const name of book.SheetNames) {
      const ws = book.Sheets[name];
      sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      for (const [addr, cell] of Object.entries(ws)) {
        if (addr[0] === "!") continue;
        if (cell.f) formulas.push(`${name}!${addr}: ${cell.f}`);
        if (typeof cell.v === "string" && /^[=+\-@]/.test(cell.v) && cell.t !== "s") typed.push(`${name}!${addr} is type ${cell.t}`);
      }
    }
    return { names: book.SheetNames, sheets, formulas, typed, props: JSON.stringify(book.Props || {}) + JSON.stringify(book.Custprops || {}) };
  }, fs.readFileSync(wbPath).toString("base64"));

  checks.equal(wb.names, SHEETS, "the workbook is exactly TABLE PLAN, GUEST LIST, UNASSIGNED, in that order");
  checks.equal(wb.sheets["GUEST LIST"]?.[0], LIST_HEADERS, "GUEST LIST has exactly the contracted eight columns");
  checks.equal(wb.sheets["UNASSIGNED"]?.[0], LIST_HEADERS, "UNASSIGNED has exactly the same eight columns");
  checks.ok(Object.values(wb.sheets).every((rows) => rows.every((r) => r.length <= 11)), "no sheet grew a column beyond its card or list layout");
  const wbText = JSON.stringify(wb.sheets) + wb.props;
  checks.equal(forbidden.filter((f) => wbText.includes(f)), [], "no e-mail, phone, internal field, guest id or event id reaches any cell or workbook property");
  checks.equal(wb.formulas, [], "no cell in the workbook is a formula — a formula-led name is written as text");
  checks.equal(wb.typed, [], "every formula-led cell is a plain string cell");
  checks.ok(FORMULA_NAMES.every((n) => JSON.stringify(wb.sheets["GUEST LIST"]).includes(JSON.stringify(n).slice(1, -1))),
    "and the names are kept exactly as typed in the workbook (escaping that deletes a guest would pass the rest)");

  // --- the guest CSV ----------------------------------------------------------
  await gotoTab(page, "guests");
  const [csvDownload] = await Promise.all([page.waitForEvent("download"),
    page.evaluate(() => { const b = document.querySelector("[data-report='csv']"); if (b) b.click(); else exportGuestCSV(); })]);
  const csvPath = path.join(artifactDir, "export-contract.csv");
  await csvDownload.saveAs(csvPath);
  const csvText = fs.readFileSync(csvPath, "utf8").replace(/^﻿/, "");
  const rows = parseCsv(csvText);
  checks.equal(rows[0], LIST_HEADERS, "the CSV has exactly the contracted eight columns");
  checks.ok(rows.length === 1 + 1 + FORMULA_NAMES.length && rows.every((r) => r.length === 8), "one row per guest record, eight fields each", rows.map((r) => r.length));
  checks.equal(forbidden.filter((f) => csvText.includes(f)), [], "no e-mail, phone, internal field, guest id or event id reaches the CSV");
  const live = rows.slice(1).flat().filter((v) => FORMULA_LEAD.test(v));
  checks.equal(live, [], "no CSV cell starts with = + - @ tab or CR — a spreadsheet would run it as a formula", live);
  for (const name of FORMULA_NAMES)
    checks.ok(rows.some((r) => r[0] === `'${name}`), `the formula-led name is kept, neutralised with a leading apostrophe: ${name}`);

  // --- round trip: the CSV back through the import wizard -------------------
  await page.evaluate(() => { ui.screen = "events"; ui.activeEventId = null; render(); });
  await createBlankEvent(page, { name: "Export Round Trip", hotel: "Merit Royal", date: futureDate() });
  await addTables(page); // the seated party's table must exist, or the wizard blocks its row
  await gotoTab(page, "guests");
  await click(page, "[data-guest-command='import']");
  await page.setInputFiles("#guestFileInput", { name: "back.csv", mimeType: "text/csv", buffer: fs.readFileSync(csvPath) });
  await page.waitForTimeout(500);
  for (let i = 0; i < 3; i++) { await click(page, "[data-wizard-next]").catch(() => {}); await page.waitForTimeout(250); }
  await click(page, "[data-wizard-import]");
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => activeEvent().guests.map((g) => g.name));
  checks.equal(FORMULA_NAMES.filter((n) => !back.includes(n)), [], "imported back, every formula-led name returns exactly as typed — the apostrophe was the file's, not the guest's", back);
}
