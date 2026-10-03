// EVERY CRITICAL FACT HAS ONE WRITER, AND THE WRITER ITSELF APPLIES THE RULES.
//
// `assignment-writer` proves this for `guest.assignment`. The other facts an
// event night runs on — the arrival axis, a table's availability, the freezes,
// the handover notes — each have one writer in app-v8.js, but until 2026-10-03:
//
//   - the writers trusted their CALLERS to refuse a historical event. Every
//     current caller did; a new one, or a screen left open while the event's
//     date passed, would not have been stopped by the writer;
//   - a second arrival writer stood in app-guests.js (the Live binder app-v8
//     replaces at load), writing `arrivalStatus` raw — unreachable only
//     because of load order;
//   - duplicating an event reset each copied guest to Not Arrived but KEPT
//     their check-in moment, against the arrival axis's own rule.
//
// So this suite asserts the shape statically — who writes each field, and
// that each writer refuses a historical event itself — and then attempts the
// bypass a real operator can produce: a screen rendered while the event was
// live, used after it became historical.
import fs from "node:fs";
import path from "node:path";
import { stripCommentsAndStrings } from "../lib/js-scan.mjs";
import { click, openApp, createBlankEvent, addTables, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "domain-writers", tags: ["business", "fast"], timeout: 150000 };

// field family -> the functions allowed to assign it (file:function)
const WRITERS = {
  arrival: { fields: ["arrivalStatus", "checkedInAt"], allowed: ["app-v8.js:setArrival", "app.js:normalizeGuest"] },
  availability: { fields: ["availability", "unavailableReason", "unavailableSince", "unavailableNote"], allowed: [] },
  freezes: { fields: ["freezes"], allowed: ["app-v8.js:createFreezeFromDraft", "app-v8.js:liftFreeze", "app-v8.js:migrateEvent"] },
  handover: { fields: ["handoverNotes"], allowed: ["app-v8.js:addHandoverNote", "app-v8.js:migrateEvent"] },
};
// The single writer of each fact, and what it must call before it writes.
const GUARDED = ["setArrival", "setTableAvailability", "addHandoverNote", "createFreezeFromDraft", "liftFreeze"];

function enclosingFunction(lines, index) {
  for (let i = index; i >= 0; i--) {
    const m = lines[i].match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/) ||
      lines[i].match(/^\s*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/);
    if (m) return m[1];
  }
  return "(top level)";
}
function functionBody(code, name) {
  const start = code.search(new RegExp(`(?:function\\s+${name}\\s*\\(|\\b${name}\\s*=\\s*(?:async\\s+)?function\\s*\\()`));
  if (start < 0) return null;
  let depth = 0, i = code.indexOf("{", start);
  for (let j = i; j < code.length; j++) {
    if (code[j] === "{") depth++;
    else if (code[j] === "}" && --depth === 0) return code.slice(i, j + 1);
  }
  return null;
}

export default async function run({ page, checks, baseUrl, repoRoot }) {
  // --- 1. static: who writes each field ------------------------------------
  const files = fs.readdirSync(path.join(repoRoot, "src")).filter((f) => f.endsWith(".js"));
  const stripped = Object.fromEntries(files.map((f) => [f, stripCommentsAndStrings(fs.readFileSync(path.join(repoRoot, "src", f), "utf8"))]));
  for (const [family, { fields, allowed }] of Object.entries(WRITERS)) {
    const offenders = [];
    for (const f of files) {
      const lines = stripped[f].split("\n");
      lines.forEach((l, i) => {
        for (const k of fields) {
          const write = new RegExp(`\\.${k}\\s*(=(?!=)|\\|\\|=|\\?\\?=)|\\.${k}\\.(push|unshift|splice|pop|shift)\\(|\\.${k}\\.length\\s*=`);
          if (!write.test(l)) continue;
          const where = `${f}:${enclosingFunction(lines, i)}`;
          if (!allowed.includes(where)) offenders.push(`${where} (line ${i + 1}): ${l.trim().slice(0, 80)}`);
        }
      });
    }
    checks.equal(offenders, [], `${family}: written only by ${allowed.length ? allowed.join(", ") : "its module's transition, applied by its one writer"}`);
  }
  // Availability has no raw write at all: the module's transition, applied by
  // setTableAvailability() alone.
  const callers = files.flatMap((f) => {
    const lines = stripped[f].split("\n");
    return lines.flatMap((l, i) => /availabilityTransition\s*\(/.test(l) && f !== "table-availability.js" ? [`${f}:${enclosingFunction(lines, i)}`] : []);
  });
  checks.equal(callers, ["app-v8.js:setTableAvailability"], "a table's availability changes only through setTableAvailability()");

  // --- 2. static: every writer refuses a historical event itself ------------
  const v8 = stripped["app-v8.js"];
  const unguarded = GUARDED.filter((name) => {
    const body = functionBody(v8, name);
    return !body || !/mutationRefusal\s*\(|canMutate\s*\(/.test(body);
  });
  checks.equal(unguarded, [], `each single writer (${GUARDED.join(", ")}) refuses a historical event itself, not only through its callers`);

  // --- 3. the bypass an operator can produce: a stale screen ----------------
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Writers Night", hotel: "Merit", date: futureDate() });
  await addTables(page, { quantity: 2 });
  await page.evaluate(() => {
    const e = activeEvent();
    e.guests.push({ id: "g_door", name: "Door Guest", additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "", notes: "",
      planningStatus: "Confirmed", arrivalStatus: "Not Arrived", checkedInAt: null, assignment: null, createdAt: new Date().toISOString() });
    touchEvent(e);
  });
  const snapshot = () => page.evaluate(() => {
    const e = activeEvent();
    return JSON.stringify({ guests: e.guests.map((g) => [g.arrivalStatus, g.checkedInAt]), tables: e.tables.map((t) => t.availability || null),
      freezes: (e.freezes || []).length, notes: (e.handoverNotes || []).length });
  });
  const goHistorical = () => page.evaluate(() => { activeEvent().status = "Completed"; });
  const goLive = () => page.evaluate(() => { activeEvent().status = "Planning"; render(); });

  // a) Live: the door's check-in button
  await page.evaluate(() => { ui.tab = "live"; render(); });
  await settle(page);
  let before = await snapshot();
  await goHistorical();
  await click(page, '[data-live-guest="g_door"][data-arrival="Checked In"]');
  checks.equal(await snapshot(), before, "LIVE: a check-in pressed on a screen left open after the event became historical changes nothing");
  await goLive();

  // b) Command Center: the handover note
  await page.evaluate(() => { ui.tab = "command"; render(); });
  await settle(page);
  await page.fill("[data-handover-text]", "Written after the night ended");
  before = await snapshot();
  await goHistorical();
  await click(page, "[data-handover-add]");
  checks.equal(await snapshot(), before, "HANDOVER: a note added on a stale screen is not stored on a historical event");
  await goLive();

  // c) Seating: a table marked unavailable
  const tableId = await page.evaluate(() => activeEvent().tables[0].id);
  await page.evaluate((id) => { ui.tab = "seating"; ui.selectedTableId = id; render(); }, tableId);
  await settle(page);
  before = await snapshot();
  await goHistorical();
  await click(page, `[data-avail-mark="${tableId}"][data-avail-next="UNAVAILABLE"]`);
  checks.equal(await snapshot(), before, "AVAILABILITY: a table marked unavailable on a stale screen stays as it was");
  await goLive();

  // d) Freeze: created normally once (the control works), then refused when stale
  await page.evaluate(() => { ui.tab = "seating"; ui.selectedTableId = null; render(); });
  await settle(page);
  await click(page, '[data-freeze-action="open-form"]');
  await click(page, '[data-freeze-action="create"]');
  await settle(page);
  const made = await page.evaluate(() => (activeEvent().freezes || []).length);
  checks.equal(made, 1, "FREEZE: the control creates a freeze on a live event (the positive control)");
  await click(page, '[data-freeze-action="open-form"]');
  before = await snapshot();
  await goHistorical();
  await click(page, '[data-freeze-action="create"]');
  checks.equal(await snapshot(), before, "FREEZE: a freeze created on a stale screen is not stored on a historical event");
  await goLive();
  await page.evaluate(() => { ui.tab = "seating"; render(); });
  await settle(page);
  before = await snapshot();
  await goHistorical();
  const lift = await page.locator("[data-freeze-lift]").count();
  if (lift) await click(page, "[data-freeze-lift]");
  checks.ok(lift > 0, "FREEZE: a lift control was on screen to try", lift);
  checks.equal(await snapshot(), before, "FREEZE: a freeze lifted on a stale screen stays standing on a historical event");
  await goLive();

  // --- 4. duplicating an event starts its night fresh ------------------------
  const dup = await page.evaluate(() => {
    const e = activeEvent(), g = e.guests.find((x) => x.id === "g_door");
    g.arrivalStatus = "Checked In"; g.checkedInAt = "2026-01-01T19:00:00.000Z"; touchEvent(e);
    duplicateEvent(e.id);
    const copy = state.events.find((x) => x.id !== e.id && /Copy/.test(x.name));
    const cg = copy && copy.guests.find((x) => x.name === "Door Guest");
    return cg ? { arrivalStatus: cg.arrivalStatus, checkedInAt: cg.checkedInAt ?? null } : null;
  });
  checks.equal(dup, { arrivalStatus: "Not Arrived", checkedInAt: null },
    "DUPLICATE: a copied guest is Not Arrived with no arrival moment — the moment goes with the status, through the arrival rule");
}
