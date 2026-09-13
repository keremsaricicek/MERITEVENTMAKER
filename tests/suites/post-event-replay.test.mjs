// The story of the night, not a third data source.
//
// This suite exists to keep four properties true:
//
//   BORROWED, NOT RECOMPUTED. Post-Event Replay renders the Audit Trail's own
//   entries and the Arrival Wave's own chart — it must never derive its own
//   opinion of either. Its only original arithmetic is oldest-first ordering
//   and "did this happen inside that bucket's window," and both must use the
//   wave module's own clock helpers rather than reimplementing them.
//
//   HISTORICAL ONLY. A Planning event's Reports screen keeps its Audit Trail
//   section but must never show a Replay section — the whole point of a
//   replay is that the night is over.
//
//   THE AUDIT TRAIL STAYS UNTOUCHED. Adding Replay above it must not change
//   the Audit Trail section's own order, classes, or content — the two are
//   different views of the same decisions, not one replacing the other.
//
//   A BUCKET CLICK NARROWS TO EXACTLY WHAT HAPPENED THEN, and the way out of
//   the filter is the same "Show everyone" control the Arrival Wave already
//   has, because this is one filter mechanism, not two that happen to look
//   alike.
import { click, openApp, createBlankEvent, addTables, gotoTab, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "post-event-replay", tags: ["business", "fast"], timeout: 120000 };

const REPLAY = `(function(){
  const s = document.querySelector(".replay-section");
  if (!s) return null;
  return {
    title: s.querySelector(".mx-section-head h2")?.textContent.trim() || "",
    count: s.querySelector(".mx-section-head .count")?.textContent.trim() || "",
    rows: [...s.querySelectorAll(".replay-row")].map(li => ({
      when: li.querySelector(".replay-when")?.textContent.trim() || "",
      text: li.querySelector(".replay-text")?.textContent.trim() || "",
    })),
    banner: s.querySelector(".wave-banner span")?.textContent.trim() || null,
    empty: s.querySelector(".mx-empty")?.textContent.trim() || null,
    hasWave: !!s.querySelector(".arrival-wave"),
  };
})()`;

const AUDIT_ROWS = `[...document.querySelectorAll(".audit-row .audit-text")].map(n => n.textContent.trim())`;

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);

  // --- 1. the domain module itself: pure, injected, non-mutating -----------
  const unit = await page.evaluate(() => {
    const R = MeritPostEventReplay, AW = MeritArrivalWave;
    const stamp = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const entries = [{ id: "a", at: stamp(18, 0) }, { id: "b", at: stamp(19, 0) }, { id: "c", at: stamp(20, 0) }];
    const chron = R.chronological(entries).map(e => e.id);
    const originalOrder = entries.map(e => e.id);
    const helpers = { minutesOfStamp: AW.minutesOfStamp, minutesOfClock: AW.minutesOfClock };
    const bucket = { fromMinutes: AW.minutesOfClock("19:00"), to: "19:30" };
    const windowed = R.windowed(entries, bucket, helpers).map(e => e.id);
    return {
      chron, originalOrder, windowed,
      missingHelpers: R.inWindow(entries[1], bucket, {}),
      noEntry: R.inWindow(null, bucket, helpers),
      noBucket: R.inWindow(entries[1], null, helpers),
      onNothing: R.chronological(null),
    };
  });
  checks.equal(unit.chron.join(","), "c,b,a", "chronological() reverses newest-first into oldest-first", unit.chron);
  checks.equal(unit.originalOrder.join(","), "a,b,c", "chronological() does not mutate the array it was given", unit.originalOrder);
  checks.equal(unit.windowed.join(","), "b", "windowed() keeps only the entry inside the bucket's own window", unit.windowed);
  checks.equal(unit.missingHelpers, false, "inWindow() refuses to guess when the clock helpers are not injected");
  checks.equal(unit.noEntry, false, "inWindow() is false for a missing entry rather than throwing");
  checks.equal(unit.noBucket, false, "inWindow() is false for a missing bucket rather than throwing");
  checks.equal(unit.onNothing, [], "chronological() on nothing is an empty list, not a throw");

  // --- fixture: a two-table event with two controlled, timed decisions -----
  await createBlankEvent(page, { name: "Replay Event", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 2 });
  await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 6;
    e.tables[1].number = "T02"; e.tables[1].capacity = 6;
    const g = (id, name, extra) => ({
      id, name, additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "Host",
      notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      expectedArrival: null, checkedInAt: null,
      assignment: null, createdAt: new Date().toISOString(), ...extra,
    });
    const stampAtFn = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const early = stampAtFn(19, 0), late = stampAtFn(20, 0);
    // createBlankEvent() wrote its own "Event created" audit entry at the
    // REAL current wall-clock time, not a controlled one. Whenever that
    // happens to land inside 19:00-20:00 (the two windows this fixture
    // exercises below), it silently joins the "19:00 wave" bucket alongside
    // the early check-in and inflates its count — a real, reproducible
    // failure this test would otherwise carry for up to two hours a day,
    // depending only on when someone happens to run it. Pinned to a fixed
    // hour well outside every window this test clicks, so the suite's
    // result never depends on the clock it runs on.
    const created = state.audit.find(a => a.eventId === e.id && a.action === "EVENT_CREATED");
    if (created) created.at = stampAtFn(8, 0);
    e.guests = [
      g("g_early", "Erken Misafir", { arrivalStatus: "Checked In", checkedInAt: early }),
      g("g_late", "Geç Misafir", { arrivalStatus: "Checked In", checkedInAt: late }),
    ];
    // Two real decisions at the SAME two moments the guests actually arrived,
    // seeded in the order they happened (oldest call first) — audit() itself
    // always unshifts, so this fixture matches exactly how a real evening
    // would have written them.
    state.audit.unshift({ id: "audit_early", eventId: e.id, action: "ARRIVAL_STATUS_CHANGED",
      detail: { guestId: "g_early", from: "Not Arrived", to: "Checked In", source: "test" }, at: early });
    state.audit.unshift({ id: "audit_late", eventId: e.id, action: "ARRIVAL_STATUS_CHANGED",
      detail: { guestId: "g_late", from: "Not Arrived", to: "Checked In", source: "test" }, at: late });
    touchEvent(e); render();
  });

  // --- 2. NOT shown while the event is still Planning -----------------------
  await gotoTab(page, "reports");
  await settle(page);
  const beforeHistorical = await page.evaluate(REPLAY);
  checks.equal(beforeHistorical, null, "no replay section on a live, non-historical event's Reports screen");
  const auditBefore = await page.evaluate(AUDIT_ROWS);
  checks.ok(auditBefore.some(t => /blank/i.test(t)), "the Audit Trail section is there on its own, unaffected", auditBefore);

  // --- 3. the event ends; replay appears, oldest-first, above the trail -----
  await page.evaluate(() => { state.events[0].status = "Completed"; render(); });
  await page.waitForTimeout(300);
  await gotoTab(page, "reports");
  await settle(page);
  const replay = await page.evaluate(REPLAY);
  checks.ok(replay, "a historical event's Reports screen carries a replay section");
  checks.equal(replay.title.toLowerCase(), "post-event replay", "titled as a replay of the whole night", replay.title);
  checks.ok(replay.hasWave, "reuses the real Arrival Wave chart rather than drawing a second one", replay);
  checks.equal(replay.rows.length, 3, "created, early check-in, late check-in — exactly three decisions", replay.rows);
  checks.ok(/blank/i.test(replay.rows[0].text), "oldest first: the event's own creation leads the story", replay.rows[0]);
  checks.ok(/Erken Misafir/.test(replay.rows[1].text), "then the earlier arrival", replay.rows[1]);
  checks.ok(/Geç Misafir/.test(replay.rows[2].text), "then the later arrival, last", replay.rows[2]);
  checks.equal(replay.rows[1].when, "19:00", "each row shows the clock time it happened, from the wave's own helpers", replay.rows[1]);
  checks.equal(replay.rows[2].when, "20:00", "including the later one", replay.rows[2]);

  // --- 4. the Audit Trail section is untouched by Replay's presence --------
  const auditAfter = await page.evaluate(AUDIT_ROWS);
  checks.equal(auditAfter.length, 3, "the audit trail itself still shows all three, in its own newest-first order", auditAfter);
  checks.ok(/Geç Misafir/.test(auditAfter[0]), "newest first in the audit trail, unlike replay above it", auditAfter);
  checks.ok(/blank/i.test(auditAfter[2]), "the creation entry is still last there, not reordered", auditAfter);

  // --- 5. clicking a bucket narrows the replay to that window ---------------
  await click(page, '[data-wave-key="19:00"]');
  await settle(page);
  const early = await page.evaluate(REPLAY);
  checks.equal(early.rows.length, 1, "selecting the 19:00 wave narrows replay to what happened in that window", early.rows);
  checks.ok(/Erken Misafir/.test(early.rows[0].text), "exactly the early check-in", early.rows[0]);
  checks.ok(early.banner && /1/.test(early.banner), "a banner discloses how many decisions are in the window", early.banner);

  // --- 6. a window with nothing in it says so, not an empty list -----------
  await click(page, '[data-wave-key="19:30"]');
  await settle(page);
  const middle = await page.evaluate(REPLAY);
  checks.equal(middle.rows.length, 0, "the 19:30 window has no decisions in it", middle.rows);
  checks.ok(middle.empty, "and says so explicitly rather than showing a bare empty list", middle.empty);

  // --- 7. the way out is the same control the wave already has -------------
  await click(page, '[data-wave-clear]');
  await settle(page);
  const cleared = await page.evaluate(REPLAY);
  checks.equal(cleared.rows.length, 3, "clearing the filter returns to the full oldest-first story", cleared.rows);

  // --- 8. both languages, no raw keys, EN really differs from TR -----------
  const words = await page.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; render();
      out[lang] = {
        title: document.querySelector(".replay-section .mx-section-head h2")?.textContent.trim() || "",
        question: document.querySelector(".replay-question")?.textContent.trim() || "",
      };
    }
    ui.lang = "en"; render();
    return out;
  });
  checks.ok(words.en.title && words.en.question && words.tr.title && words.tr.question,
    "both languages have real title/question text", words);
  checks.ok(words.en.title !== words.tr.title, "and Turkish is really Turkish", words);
  checks.ok(!/replay\./i.test(JSON.stringify(words)), "no raw replay.* key reaches either screen", words);
}
