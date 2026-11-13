// THE TABLE-PLAN WORKBOOK IS BYTE-IDENTICAL ACROSS THE REPORT DESIGNER.
//
// The report designer (src/report-designer.js, Raporlar → Tasarımcı) adds new
// documents; it must not change one byte of the existing one-click workbook
// (TABLE PLAN / GUEST LIST / UNASSIGNED, "GUEST OF [PRIMARY]", T/B/VIP
// numbering). This suite builds one fixed event (a +2 party seated, a No Show
// that keeps its planned seat, a VIP, a B table, an unassigned guest), presses
// the existing "Export Table Plan" button, and compares the downloaded file's
// sha256 with the hash recorded on the code BEFORE the designer was rebuilt
// (redesign-v4-product @ f172287, 2026-11-13). Two exports in one run must
// also be identical, so a mismatch means the contents changed, not the clock.
//
// The recorded hash is a contract; re-record only as a deliberate, explained
// change to the workbook itself (and update xlsx-contract with it).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, gotoTab, settle } from "../lib/app-actions.mjs";

export const meta = { name: "report-xlsx-identity", tags: ["business", "reports", "fast"], timeout: 120000, downloads: true };

const RECORDED = "b287f1c1f159a7a567b93e0afa7eb5441259d5240c14b229f2a068db159cb133";

export default async function run({ page, checks, baseUrl, artifactDir }) {
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Identity Gala", hotel: "Merit Royal", date: "2099-05-01" });
  await page.evaluate(() => {
    const e = activeEvent();
    const table = (id, number, capacity, zone) => ({ id, number, zone: zone || "", shape: "round", capacity, chairs: [], x: 100, y: 100, w: 80, h: 80, rotation: 0 });
    const guest = (id, name, extra, o) => Object.assign({ id, name, additionalGuests: extra, pax: 1 + extra, planningStatus: "Confirmed", vip: "Standard", invitedBy: "",
      notes: "", phone: "", arrivalStatus: "Not Arrived", checkedInAt: null, assignment: null, createdAt: "2099-01-01T00:00:00.000Z" }, o || {});
    e.tables.push(table("t1", "T01", 6, "Salon"), table("t2", "T02", 4, "Salon"), table("t3", "VIP1", 4, "Stage"), table("t4", "B01", 8, "Bar"), table("t5", "T10", 2, "Salon"));
    e.guests.push(
      guest("g1", "Kerem Sarıçiçek", 2, { vip: "VIP", invitedBy: "Junket A", assignment: { tableId: "t1", seats: [0, 1, 2] } }),
      guest("g2", "Ayşe Demir", 0, { arrivalStatus: "No Show", assignment: { tableId: "t1", seats: [3] } }),
      guest("g3", "Burak Şahin", 1, { planningStatus: "Tentative", arrivalStatus: "Checked In", assignment: { tableId: "t3", seats: [0, 1] } }),
      guest("g4", "Deniz Yıldız", 0, { assignment: { tableId: "t4", seats: [5] } }),
      guest("g5", "Emre Kaya", 3, { invitedBy: "Junket A" }),
      guest("g6", "Fatma Ak", 0, {}));
    render();
  });
  await settle(page);
  await gotoTab(page, "reports");
  const exportOnce = async (n) => {
    await page.waitForSelector('[data-report="xlsx"]', { timeout: 15000 });
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-report="xlsx"]')]);
    const file = path.join(artifactDir, `identity-${n}.xlsx`);
    await download.saveAs(file);
    const buf = fs.readFileSync(file);
    return crypto.createHash("sha256").update(buf).digest("hex");
  };
  const a = await exportOnce(1);
  const b = await exportOnce(2);
  checks.require(a === b, "two exports of the same event are byte-identical (the hash compares contents, not a clock)", { a, b });
  if (RECORDED === "RECORD_ME") { console.log("RECORD:", a); checks.ok(false, "the recorded hash is set"); return; }
  checks.equal(a, RECORDED, "the TABLE PLAN / GUEST LIST / UNASSIGNED workbook is byte-identical to the one recorded before the report designer");
}
