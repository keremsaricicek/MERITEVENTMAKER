// One shift tells the next what it needs to know.
//
// This suite exists to keep three properties true, because each is the
// exact wrong thing this feature could quietly become:
//
//   ZERO NEW COMPUTATION. The digest is read straight from the modules that
//   already own each fact (Plan Doctor, liveStats, eventMetrics, Freeze
//   Zones, Table Availability) — it must never produce a number that
//   disagrees with the same fact shown elsewhere on the same screen.
//
//   THE NOTE LOG IS FREE TEXT, NOT A SYSTEM FACT. It is never parsed,
//   never moves a guest or a table, and is kept verbatim, newest first,
//   with no edit and no delete — a handover log that could be rewritten
//   after the fact would not be trustworthy as a record of what one shift
//   actually told the next. It must also stay visibly distinct from the
//   future Audit Trail: a note is a person's words, not a recorded decision.
//
//   HISTORICAL EVENTS LOSE THE COMPOSER, NOT JUST ITS BUTTON. Same
//   guarantee as every other mutation surface in this product: the control
//   is entirely absent from the DOM, not merely disabled.
import { click, openApp, createBlankEvent, addTables, gotoTab, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "event-handover", tags: ["business", "fast"], timeout: 120000 };

const SNAPSHOT = `JSON.stringify(state.events[0].guests.map(g => [g.id, g.assignment, g.arrivalStatus]))`;

const PANEL = `(function(){
  const s = document.querySelector(".cc-handover");
  if (!s) return null;
  const cell = i => s.querySelectorAll(".cc-metric")[i]?.querySelector("b")?.textContent.trim();
  return {
    metrics: [0,1,2,3,4,5].map(cell),
    alert: s.querySelector(".cc-handover-alert")?.textContent.trim() || null,
    notes: [...s.querySelectorAll(".handover-note")].map(li => ({
      text: li.querySelector("p")?.textContent.trim(),
      meta: li.querySelector("span")?.textContent.trim(),
      hasEditOrDelete: !!li.querySelector("button, [data-handover-edit], [data-handover-delete]"),
    })),
    empty: s.querySelector(".cc-empty")?.textContent.trim() || null,
    hasForm: !!s.querySelector(".cc-handover-form"),
  };
})()`;

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Handover", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 3 });

  const room = await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 6; e.tables[0].zone = "MAIN FLOOR";
    e.tables[1].number = "T02"; e.tables[1].capacity = 6; e.tables[1].zone = "MAIN FLOOR";
    e.tables[2].number = "T03"; e.tables[2].capacity = 6; e.tables[2].zone = "MAIN FLOOR";
    const g = (id, name, pax, opts = {}) => ({
      id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: "Host",
      notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, createdAt: new Date().toISOString(), ...opts,
    });
    e.guests = [
      g("g_seated", "Deniz Kaya", 3, { assignment: { tableId: e.tables[0].id, seats: [0, 1, 2], locked: false } }),
      g("g_unassigned", "Ela Aksoy", 1),
      g("g_noshow", "Cem Yildiz", 2, { arrivalStatus: "No Show", assignment: { tableId: e.tables[0].id, seats: [3, 4], locked: false } }),
    ];
    e.freezes = [{ id: "f1", scope: "TABLE", tableId: e.tables[1].id, reason: "OTHER", note: "", createdAt: new Date().toISOString() }];
    e.tables[2].availability = "UNAVAILABLE"; e.tables[2].unavailableReason = "DAMAGED";
    touchEvent(e); render();
    return { t01: e.tables[0].id, t02: e.tables[1].id, t03: e.tables[2].id };
  });
  // Only Ela (g_unassigned) has no table — Cem (No Show) keeps his planned
  // seat, exactly as No Show must: it releases live capacity, never the
  // assignment. T03 is the unavailable table and nobody is on it yet, so the
  // stranded-guest alert should stay silent until section 7 actually seats
  // someone there.

  // --- 1. the domain module itself: notes are normalized, not trusted -------
  const bare = await page.evaluate(() => {
    const H = MeritEventHandover;
    return {
      noteMax: H.NOTE_MAX, byMax: H.BY_MAX,
      empty: H.resolve(null),
      dropsBlank: H.normalizeNote({ text: "   ", by: "Ada" }),
      dropsMissing: H.normalizeNote({ by: "Ada" }),
      trims: H.normalizeNote({ text: "  hello  ", by: "  Ada  " }),
      slicesText: H.normalizeNote({ text: "x".repeat(H.NOTE_MAX + 50) }).text.length,
      slicesBy: H.normalizeNote({ text: "hi", by: "y".repeat(H.BY_MAX + 50) }).by.length,
      resolveDropsBlanks: H.resolve([{ text: "real" }, { text: "  " }, {}]).length,
    };
  });
  checks.equal(bare.empty.length, 0, "resolve(null) is an empty list, not a throw");
  checks.ok(bare.dropsBlank === null, "whitespace-only text normalizes to nothing");
  checks.ok(bare.dropsMissing === null, "a note with no text normalizes to nothing");
  checks.equal(bare.trims.text, "hello", "text is trimmed");
  checks.equal(bare.trims.by, "Ada", "the author field is trimmed too");
  checks.equal(bare.slicesText, bare.noteMax, "text is capped at NOTE_MAX", bare.slicesText);
  checks.equal(bare.slicesBy, bare.byMax, "the author field is capped at BY_MAX", bare.slicesBy);
  checks.equal(bare.resolveDropsBlanks, 1, "resolve() keeps only the real note out of three raw entries");

  await gotoTab(page, "command");
  await settle(page);

  // --- 2. the digest is read, not recomputed from scratch --------------------
  const panel1 = await page.evaluate(PANEL);
  checks.require(panel1, "the Event Handover section renders on the Command Center");
  checks.equal(panel1.metrics[1], "1", "one unassigned pax (Ela Aksoy)", panel1.metrics);
  checks.equal(panel1.metrics[2], "4", "not-arrived pax is Deniz's 3 plus Ela's 1", panel1.metrics);
  checks.equal(panel1.metrics[3], "2", "no-show pax matches Cem Yildiz's party of 2", panel1.metrics);
  checks.equal(panel1.metrics[4], "1", "one table held by a freeze (T02)", panel1.metrics);
  checks.equal(panel1.metrics[5], "1", "one table marked unavailable (T03)", panel1.metrics);
  checks.ok(!panel1.alert, "nobody is stranded yet, so no alert line renders", panel1.alert);
  checks.equal(panel1.empty, "No handover notes yet.", "the empty state is honest, not a placeholder note");
  checks.ok(panel1.hasForm, "a non-historical event offers the note composer");

  // --- 3. adding a note through the real UI ----------------------------------
  const beforeAll = await page.evaluate(SNAPSHOT);
  await page.fill("[data-handover-text]", "T14 leg is being fixed by 8pm — do not seat anyone there until confirmed.");
  await page.fill("[data-handover-by]", "Ayşe (day shift)");
  await click(page, "[data-handover-add]");
  await page.waitForTimeout(350);

  const afterNote = await page.evaluate(PANEL);
  checks.equal(afterNote.notes.length, 1, "the note appears in the list", afterNote.notes);
  checks.ok(afterNote.notes[0].text.startsWith("T14 leg is being fixed"), "with the exact text written", afterNote.notes[0]);
  checks.ok(afterNote.notes[0].meta.includes("Ayşe (day shift)"), "and the author who left it", afterNote.notes[0].meta);
  checks.ok(!afterNote.notes[0].hasEditOrDelete, "the note carries no edit or delete control", afterNote.notes[0]);
  checks.equal(await page.evaluate(SNAPSHOT), beforeAll, "adding a handover note moved nobody and changed no arrival status");

  const auditEntry = await page.evaluate(() => (state.audit || []).find(a => a.action === "HANDOVER_NOTE_ADDED"));
  checks.ok(auditEntry && auditEntry.detail.noteId, "the note's creation is audited with its id", auditEntry);

  // --- 4. a second note is prepended — newest first, never sorted/merged ----
  await page.fill("[data-handover-text]", "Bride's party running ~20 min late per the wedding planner.");
  await click(page, "[data-handover-add]");
  await page.waitForTimeout(350);
  const afterSecond = await page.evaluate(PANEL);
  checks.equal(afterSecond.notes.length, 2, "both notes are kept", afterSecond.notes);
  checks.ok(afterSecond.notes[0].text.startsWith("Bride's party"), "the newer note reads first", afterSecond.notes.map(n => n.text));
  checks.ok(afterSecond.notes[1].text.startsWith("T14 leg"), "the older note stays second, unedited", afterSecond.notes.map(n => n.text));

  // --- 5. a note with no author is still accepted — "by" is optional --------
  await page.fill("[data-handover-text]", "Backup power confirmed with the venue.");
  await page.fill("[data-handover-by]", "");
  await click(page, "[data-handover-add]");
  await page.waitForTimeout(350);
  const afterThird = await page.evaluate(PANEL);
  checks.equal(afterThird.notes.length, 3, "an unsigned note is still recorded", afterThird.notes);
  checks.ok(!afterThird.notes[0].meta.includes("undefined") && !afterThird.notes[0].meta.includes("null"),
    "an unsigned note never renders a literal 'undefined' or 'null'", afterThird.notes[0].meta);

  // --- 6. blank input adds nothing, and says so ------------------------------
  await page.fill("[data-handover-text]", "   ");
  await click(page, "[data-handover-add]");
  await page.waitForTimeout(350);
  const afterBlankAttempt = await page.evaluate(PANEL);
  checks.equal(afterBlankAttempt.notes.length, 3, "whitespace-only text adds no note", afterBlankAttempt.notes.length);
  const toastText = (await page.locator("#toastWrap").allTextContents()).join(" ");
  checks.ok(/write something|not eklemeden/i.test(toastText), "and the operator is told why, not left with a silent no-op", toastText);

  // --- 7. the stranded alert appears once someone actually is stranded ------
  await page.evaluate((t03) => {
    const e = state.events[0];
    e.guests[1].assignment = { tableId: t03, seats: [0], locked: false }; // Ela Aksoy -> unavailable T03
    touchEvent(e); render();
  }, room.t03);
  await page.waitForTimeout(300);
  const panelStranded = await page.evaluate(PANEL);
  checks.ok(panelStranded.alert && /1|one/i.test(panelStranded.alert),
    "one guest record stranded at the unavailable table is named in the digest", panelStranded.alert);
  // Undo, so later counts in this suite stay predictable.
  await page.evaluate(() => {
    const e = state.events[0];
    e.guests[1].assignment = null;
    touchEvent(e); render();
  });
  await page.waitForTimeout(300);

  // --- 8. reload round-trip: notes persist like everything else -------------
  // ui.screen/ui.tab are in-memory only and reset to the Events list on
  // reload (same as every other suite that reloads), so the storage-layer
  // check comes first, then the event is reopened to prove the panel still
  // renders it the same way.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  const reloadedState = await page.evaluate(() =>
    (state.events[0].handoverNotes || []).map(n => ({ text: n.text, by: n.by })));
  checks.equal(reloadedState.length, 3, "all three notes survive a reload at the storage layer", reloadedState);
  checks.ok(reloadedState[0].text.startsWith("Backup power"), "in the same newest-first order", reloadedState);

  await click(page, "[data-open-event]");
  await page.waitForTimeout(400);
  await gotoTab(page, "command");
  await settle(page);
  const reloaded = await page.evaluate(PANEL);
  checks.equal(reloaded.notes.length, 3, "and the reopened panel renders all three back", reloaded.notes.length);

  // --- 9. a historical event has no Command Center at all — Handover, its
  //        composer included, goes with it. Command Center already treats a
  //        finished event as having "no readiness to assess" (normalTabs vs.
  //        historyTabs in workspaceHTML): this is the same guarantee
  //        historical-immutability.test.mjs proves for the Floor Plan and
  //        Live Event tabs, not a new exception carved out for Handover.
  await page.evaluate(() => { state.events[0].status = "Completed"; render(); });
  await page.waitForTimeout(300);
  const tabsAfter = await page.locator(".tabs .tab").allTextContents();
  checks.ok(!tabsAfter.some(tx => /command|kumanda/i.test(tx)),
    "a historical event has no Command Center tab — the whole Handover section, composer included, is gone with it", tabsAfter);
  checks.equal(await page.locator('[data-tab="command"]').count(), 0,
    "the command tab control itself is absent, not merely unlabelled");
  // Undo, so the language pass below can reopen the Command Center.
  await page.evaluate(() => { state.events[0].status = "Planning"; render(); });
  await page.waitForTimeout(300);

  // --- 10. both languages, no raw keys, EN really differs from TR ----------
  await gotoTab(page, "command");
  await settle(page);
  const words = await page.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; render();
      const s = document.querySelector(".cc-handover");
      out[lang] = {
        title: s.querySelector("h3")?.textContent.trim() || "",
        question: s.querySelector(".cc-handover-q")?.textContent.trim() || "",
        addBtn: s.querySelector("[data-handover-add]")?.textContent.trim() || "",
        metricLabels: [...s.querySelectorAll(".cc-metric span")].map(x => x.textContent.trim()),
      };
    }
    ui.lang = "en"; render();
    return out;
  });
  for (const lang of ["en", "tr"]) {
    const w = words[lang];
    checks.ok(w.title && w.question && w.addBtn, `${lang}: the section's own words are all present`, w);
    checks.ok(w.metricLabels.every(v => v.length > 0 && !/^[a-z][a-zA-Z0-9]*\.[a-zA-Z]/.test(v)),
      `${lang}: the digest labels are words, never a raw i18n key`, w.metricLabels);
  }
  checks.ok(words.en.title !== words.tr.title, "and Turkish is really Turkish", words);
}
