// The exported workbook is a shared operational artifact. Its sheet names,
// its companion-seat wording and its table numbering are a contract with the
// people who print it at the door.
//
// This opens the produced .xlsx and reads cells. "The export did not throw" is
// explicitly not enough: every regression this suite exists to catch (a lost
// UNASSIGNED filter, companion seats losing the primary guest's name, table
// cards regrouping) produces a perfectly valid file with the wrong contents.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, addTables, addGuest, gotoTab, seatGuestOnFirstTable } from "../lib/app-actions.mjs";

export const meta = { name: "xlsx-contract", tags: ["business", "reports", "fast"], timeout: 120000, downloads: true };

export default async function run({ page, checks, baseUrl, artifactDir }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "XLSX Contract", hotel: "Merit Royal", date: "2026-09-10" });
  checks.require((await addTables(page)) === 4, "four tables for the four-card horizontal group");

  await gotoTab(page, "guests");
  await addGuest(page, { name: "Kerem Sariciek", additionalGuests: 2, vip: "VIP" });
  await addGuest(page, { name: "Ayse Demir" });
  await seatGuestOnFirstTable(page, "Kerem");

  const scenario = await page.evaluate(() => {
    const e = state.events[0];
    const assigned = e.guests.find(g => g.assignment);
    return { assigned: assigned && assigned.name, unassigned: e.guests.filter(g => !g.assignment).map(g => g.name) };
  });
  checks.require(scenario.assigned === "Kerem Sariciek" && scenario.unassigned.includes("Ayse Demir"),
    "the scenario is one seated party and one unassigned guest", scenario);

  await gotoTab(page, "reports");
  await page.waitForSelector('[data-report-export], button:has-text("Export Table Plan")', { timeout: 15000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click('button:has-text("Export Table Plan")'),
  ]);
  const filePath = path.join(artifactDir, "xlsx-contract.xlsx");
  await download.saveAs(filePath);
  const buf = fs.readFileSync(filePath);
  checks.require(buf.length > 1000, "the export produced a real workbook", { bytes: buf.length });

  // Read it back through the app's own SheetJS, which is already loaded and is
  // the same engine that wrote it.
  const sheets = await page.evaluate(base64 => {
    const bin = atob(base64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const wb = XLSX.read(bytes, { type: "array" });
    const dump = {};
    for (const name of wb.SheetNames) dump[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    return dump;
  }, buf.toString("base64"));

  const names = Object.keys(sheets);
  checks.ok(names.includes("TABLE PLAN") && names.includes("GUEST LIST") && names.includes("UNASSIGNED"),
    "the workbook has all three contracted sheets", names);

  const tablePlan = JSON.stringify(sheets["TABLE PLAN"] || []).toUpperCase();
  const guestList = JSON.stringify(sheets["GUEST LIST"] || []);
  const unassigned = JSON.stringify(sheets["UNASSIGNED"] || []);

  checks.ok(guestList.includes("Kerem Sariciek") && guestList.includes("Ayse Demir"),
    "GUEST LIST holds every guest record", { sample: guestList.slice(0, 200) });
  checks.ok(tablePlan.includes("GUEST OF KEREM SARICIEK"),
    "companion seats export as GUEST OF [PRIMARY NAME], uppercased",
    { found: (JSON.stringify(sheets["TABLE PLAN"]).match(/GUEST OF[^"]*/i) || ["none"])[0] });

  const companionSeats = (tablePlan.match(/GUEST OF KEREM SARICIEK/g) || []).length;
  checks.ok(companionSeats === 2,
    "a +2 party exports one named seat and exactly two companion seats", { companionSeats });

  checks.ok(unassigned.includes("Ayse Demir"), "UNASSIGNED lists the unassigned guest", unassigned.slice(0, 200));
  checks.ok(!unassigned.includes("Kerem Sariciek"),
    "UNASSIGNED excludes the seated guest — it is a filter, not a copy of the guest list");

  for (const number of ["T 01", "T 02", "T 03", "T 04"]) {
    checks.ok(tablePlan.includes(number), `TABLE PLAN shows ${number} in the four-card horizontal group`);
  }
}
