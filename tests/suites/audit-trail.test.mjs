// What actually happened to this event — the foundation, not the replay.
//
// This suite exists to keep four properties true:
//
//   AN ALLOWLIST, NOT A FILTER ON NOISE. touchEvent() no longer writes a
//   generic EVENT_UPDATED entry on every mutation at all (Section 16 — see
//   check 11 below) — but the trail still names exactly which codes belong,
//   on principle, rather than trusting write-time discipline alone: if a
//   future writer ever reintroduced noise, an operator would otherwise see
//   dozens of meaningless "event updated" lines drowning the real decisions.
//   src/audit-trail.js names exactly which codes belong; nothing else
//   reaches the screen.
//
//   ONE DECISION, ONE LINE. A guest checked in from the Global Finder used
//   to write TWO audit entries under two different codes with a colliding
//   "from" field. Phase P's own measured-first pass found this and fixed it
//   at the source (setArrival() is the one writer, of the field AND its
//   audit entry) — this suite proves it stays fixed.
//
//   SCOPED TO ONE EVENT. state.audit is a single root-level log shared by
//   every event in the install. A second event's decisions must never leak
//   into the first event's trail.
//
//   HISTORY STAYS READABLE. Unlike the Command Center (no tab at all once
//   an event is historical), Reports — and the trail inside it — stays
//   reachable for a completed event, because that is exactly when an
//   operator most wants to know what happened.
import { click, openApp, createBlankEvent, addTables, gotoTab, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "audit-trail", tags: ["business", "fast"], timeout: 120000 };

const TRAIL = `[...document.querySelectorAll(".audit-row")].map(li => ({
  text: li.querySelector(".audit-text")?.textContent.trim(),
  when: li.querySelector(".audit-when")?.textContent.trim(),
}))`;

export default async function run({ page, checks, baseUrl }) {
  // Behavioural checks (ordering, cap disclosure), not translation — pinned
  // to English since the product now boots Turkish; the bilingual check
  // further below explicitly exercises both languages on its own.
  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Audit Trail", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 2 });

  const room = await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 6;
    e.tables[1].number = "T02"; e.tables[1].capacity = 6;
    e.guests = [{
      id: "g_arda", name: "Arda Kaya", additionalGuests: 0, pax: 1, vip: "Standard",
      invitedBy: "Host", notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, createdAt: new Date().toISOString(),
    }];
    touchEvent(e); render();
    return { t01: e.tables[0].id, t02: e.tables[1].id };
  });

  // --- 1. the domain module itself: an allowlist, not a filter on noise -----
  const bare = await page.evaluate(() => {
    const T = MeritAuditTrail;
    return {
      excludesNoise: !T.DECISION_CODES.has("EVENT_UPDATED"),
      includesRealCodes: T.DECISION_CODES.has("ARRIVAL_STATUS_CHANGED") && T.DECISION_CODES.has("HANDOVER_NOTE_ADDED"),
      resolveScoped: T.resolve([
        { eventId: "e1", action: "ARRIVAL_STATUS_CHANGED" },
        { eventId: "e2", action: "ARRIVAL_STATUS_CHANGED" },
        { eventId: "e1", action: "EVENT_UPDATED" },
      ], "e1").length,
      resolveNoEventId: T.resolve([{ eventId: "e1", action: "ARRIVAL_STATUS_CHANGED" }], null).length,
    };
  });
  checks.ok(bare.excludesNoise, "the generic per-mutation entry is never in the allowlist");
  checks.ok(bare.includesRealCodes, "real decisions are in the allowlist");
  checks.equal(bare.resolveScoped, 1, "resolve() keeps only this event's allowlisted entry out of three raw ones", bare);
  checks.equal(bare.resolveNoEventId, 0, "no eventId means no trail, not everyone's trail", bare);

  // --- 2. EVENT_CREATED already happened — it should already be on screen ---
  await gotoTab(page, "reports");
  await settle(page);
  const afterCreate = await page.evaluate(TRAIL);
  checks.ok(afterCreate.some(r => /blank/i.test(r.text)),
    "creating a blank event is itself the first recorded decision", afterCreate);
  checks.ok(!afterCreate.some(r => /event_updated|EVENT_UPDATED/i.test(r.text)),
    "no raw EVENT_UPDATED noise reaches the screen", afterCreate);
  checks.ok(!afterCreate.some(r => /^[a-z][a-zA-Z0-9]*\.[a-zA-Z]/.test(r.text)),
    "every row is a sentence, never a raw i18n key", afterCreate);

  // --- 3. one decision, one line: check a guest in via the Global Finder ----
  await gotoTab(page, "guests"); // any screen; the finder lives in the shell header
  await page.fill("#globalGuestSearch", "Arda Kaya");
  await page.waitForTimeout(300);
  await click(page, '[data-find-action="checkin"]');
  await page.waitForTimeout(400);

  const arrivalAudit = await page.evaluate(() => ({
    arrivalEntries: (state.audit || []).filter(a => a.action === "ARRIVAL_STATUS_CHANGED").length,
    legacyEntries: (state.audit || []).filter(a => a.action === "GUEST_CHECKED_IN").length,
  }));
  checks.equal(arrivalAudit.arrivalEntries, 1, "exactly one audit entry for this one check-in", arrivalAudit);
  checks.equal(arrivalAudit.legacyEntries, 0,
    "and never a second GUEST_CHECKED_IN entry for the same decision under a different code", arrivalAudit);

  await gotoTab(page, "reports");
  await settle(page);
  const afterCheckin = await page.evaluate(TRAIL);
  const checkinRows = afterCheckin.filter(r => /Arda Kaya/.test(r.text));
  checks.equal(checkinRows.length, 1, "the trail shows exactly one line for the check-in, not two", afterCheckin);
  checks.ok(/Not Arrived.*Checked In|Bekleniyor.*Giriş/i.test(checkinRows[0].text),
    "naming the real transition in words", checkinRows[0]);

  // --- 4. table unavailable, a freeze, and a handover note all show up ------
  // setTableAvailability() is private to app-v8.js's own closure (a plain
  // function declaration with no matching outer `let`, unlike touchEvent/
  // render/state/ui) and genuinely unreachable from page.evaluate — the real
  // table card is driven instead, the same way table-availability.test.mjs
  // itself has to.
  await gotoTab(page, "seating");
  await page.evaluate((t01) => { ui.selectedTableId = t01; render(); }, room.t01);
  await page.waitForTimeout(300);
  // The reason select has a forced placeholder rather than defaulting to the
  // first REASON key, so an explicit choice is required before this button
  // does anything (table-availability.test.mjs covers that behaviour itself).
  await page.selectOption("[data-avail-reason]", "DAMAGED");
  await click(page, `[data-avail-mark="${room.t01}"][data-avail-next="UNAVAILABLE"]`);
  await page.waitForTimeout(350);
  await page.evaluate((t02) => {
    const e = state.events[0];
    e.freezes = [{ id: "f1", scope: "TABLE", tableId: t02, reason: "OTHER", note: "", createdAt: new Date().toISOString() }];
    touchEvent(e); render();
  }, room.t02);
  await gotoTab(page, "command");
  await settle(page);
  await page.fill("[data-handover-text]", "Fixture note for the audit trail suite.");
  await click(page, "[data-handover-add]");
  await page.waitForTimeout(300);

  await gotoTab(page, "reports");
  await settle(page);
  const full = await page.evaluate(TRAIL);
  checks.ok(full.some(r => /T\s*01/.test(r.text) && /unavailable|kullanılamaz/i.test(r.text)),
    "the table-availability decision is named with its table number", full);
  checks.ok(full.some(r => /Fixture note for the audit trail suite/.test(r.text)),
    "the handover note's own text is quoted, not just \"a note was added\"", full);
  // Freeze creation is written directly at line ~1961 by whatever UI flow
  // creates one; this suite wrote e.freezes directly rather than driving the
  // freeze form, so no FREEZE_CREATED audit entry exists to assert on here —
  // seating-freeze.test.mjs already covers that write path end to end.

  // --- 5. newest first, exactly the order the raw log already keeps --------
  const order = full.map(r => r.text);
  const noteIdx = order.findIndex(t => /Fixture note/.test(t));
  const checkinIdx = order.findIndex(t => /Arda Kaya/.test(t));
  const createdIdx = order.findIndex(t => /blank/i.test(t));
  checks.ok(noteIdx >= 0 && checkinIdx >= 0 && createdIdx >= 0 && noteIdx < checkinIdx && checkinIdx < createdIdx,
    "the most recent decision (the note) reads first, the event's own creation reads last", { order });

  // --- 6. scoped to one event — a second event's trail starts clean --------
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(400);
  await createBlankEvent(page, { name: "Second Event", hotel: "Merit Royal", date: futureDate() });
  await gotoTab(page, "reports");
  await settle(page);
  const secondTrail = await page.evaluate(TRAIL);
  checks.ok(!secondTrail.some(r => /Arda Kaya|Fixture note/.test(r.text)),
    "the first event's decisions do not leak into a brand-new second event's trail", secondTrail);
  checks.ok(secondTrail.some(r => /blank/i.test(r.text)),
    "the second event has exactly its own creation to show", secondTrail);

  // --- 7. an unresolvable id falls back honestly instead of throwing -------
  const fallback = await page.evaluate(() => {
    const e = state.events.find(x => x.name === "Second Event");
    state.audit.unshift({ id: "audit_fake", eventId: e.id, action: "GUEST_DELETED",
      detail: { name: "Ghost Guest" }, at: new Date().toISOString() });
    state.audit.unshift({ id: "audit_fake2", eventId: e.id, action: "ARRIVAL_STATUS_CHANGED",
      detail: { guestId: "not-a-real-guest-id", from: "Not Arrived", to: "Checked In", source: "test" },
      at: new Date().toISOString() });
    render();
    return true;
  });
  checks.ok(fallback, "seeding an entry that points at a guest id which does not exist does not throw");
  await settle(page);
  const withGhost = await page.evaluate(TRAIL);
  checks.ok(withGhost.some(r => /Ghost Guest/.test(r.text)), "a deleted guest's own name (carried in the entry) still renders", withGhost);
  checks.ok(withGhost.some(r => /no longer on this event|artık bu etkinlikte olmayan/i.test(r.text)),
    "an arrival change pointing at a guest id that no longer resolves falls back honestly instead of blanking or crashing", withGhost);

  // --- 7b. touchEvent() itself writes no noise into the shared log ---------
  // (Section 16.) By this point the test has already driven dozens of
  // ordinary mutations across two events -- table creation, an arrival
  // check-in, a freeze, handover notes, a second event's own creation --
  // every one of which calls touchEvent(). If it still wrote a generic
  // EVENT_UPDATED entry per mutation the way it used to, this array would
  // already be full of them. Checked here, BEFORE the next step's own
  // synthetic EVENT_UPDATED padding (which tests something else entirely --
  // the cap-disclosure banner -- and would otherwise mask this check).
  const noiseCount = await page.evaluate(() =>
    state.audit.filter(a => a.action === "EVENT_UPDATED").length);
  checks.equal(noiseCount, 0,
    "no EVENT_UPDATED entries exist anywhere in the shared audit log after a session of ordinary mutations",
    noiseCount);

  // --- 8. the shared-log cap is disclosed, not silently hidden --------------
  // Padding is APPENDED after this event's real entries (not a full
  // replacement) so its genuine EVENT_CREATED decision survives for the
  // historical-event check in the next section — only the cap banner itself
  // is under test here.
  const capped = await page.evaluate(() => {
    const e = state.events.find(x => x.name === "Second Event");
    const padding = Array.from({ length: 1000 }, (_, i) => ({
      id: "pad" + i, eventId: e.id, action: "EVENT_UPDATED", detail: {}, at: new Date().toISOString(),
    }));
    state.audit = [...state.audit, ...padding];
    render();
    return state.audit.length;
  });
  checks.ok(capped >= 1000, "fixture really is at or beyond the shared cap", capped);
  await settle(page);
  const capNotice = await page.evaluate(() => document.querySelector(".audit-cap-notice")?.textContent.trim() || null);
  checks.ok(capNotice, "at the shared cap, the trail discloses that older entries across ALL events may be gone", capNotice);

  // --- 9. historical events keep the trail (unlike the Command Center) -----
  await page.evaluate(() => { state.events.find(x => x.name === "Second Event").status = "Completed"; render(); });
  await page.waitForTimeout(300);
  const tabsNow = await page.locator(".tabs .tab").allTextContents();
  checks.ok(!tabsNow.some(tx => /command|kumanda/i.test(tx)), "command center is gone, as historical-immutability already proves");
  checks.ok(tabsNow.some(tx => /reports|raporlar/i.test(tx)), "but reports — and the trail inside it — stays reachable");
  await gotoTab(page, "reports");
  await settle(page);
  const historicalTrail = await page.evaluate(TRAIL);
  checks.ok(historicalTrail.length > 0, "a historical event's trail is still readable", historicalTrail.length);

  // --- 10. both languages, no raw keys, EN really differs from TR ----------
  await page.evaluate(() => { state.events.find(x => x.name === "Second Event").status = "Planning"; render(); });
  await gotoTab(page, "reports");
  await settle(page);
  const words = await page.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; render();
      out[lang] = {
        title: document.querySelector(".mx-section-head h2")?.textContent.trim() || "",
        question: document.querySelector(".audit-question")?.textContent.trim() || "",
      };
    }
    ui.lang = "en"; render();
    return out;
  });
  checks.ok(words.en.title && words.en.question && words.tr.title && words.tr.question,
    "both languages have real title/question text", words);
  checks.ok(words.en.title !== words.tr.title, "and Turkish is really Turkish", words);
}
