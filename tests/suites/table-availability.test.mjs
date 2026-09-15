// Is this table usable tonight, and who would it strand if not?
//
// Phase N closes the one risk the Plan Doctor used to admit it could not
// model. This suite exists to keep four properties true, because each one
// is the exact wrong thing this feature could quietly become:
//
//   DISTINCT FROM A FREEZE. A freeze is a rule about a PLACE, gated by
//   permission, and a supervisor can override one operation without lifting
//   it. Unavailable is a fact about the TABLE ITSELF — there is no override
//   anywhere for it, and marking or clearing it must never touch a freeze on
//   the same table, in either direction.
//
//   MARKING UNAVAILABLE MOVES NOBODY. A guest already seated at a table that
//   just failed keeps that assignment on paper until a person relocates them
//   through the existing seating flow. Nothing here has a path to an
//   assignment.
//
//   NO OVERRIDE, EVER. Unlike a freeze, there is no challenge card and no
//   parameter that lets a NEW assignment land on an unavailable table —
//   the same hard stop as a table with no physical seats.
//
//   ONE FACT, READ EVERYWHERE. The canvas, the table card, Smart Seating and
//   the Plan Doctor all read the SAME resolved answer, so none of them can
//   end up disagreeing about which tables cannot be used tonight.
import { click, openApp, createBlankEvent, addTables, addGuest, gotoTab, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "table-availability", tags: ["business", "fast"], timeout: 180000 };

const SNAPSHOT = `JSON.stringify(state.events[0].guests.map(g => [g.id, g.assignment]))`;

const CARD = `(function(){
  const c = document.querySelector(".table-card");
  if (!c) return null;
  return {
    unavailableBanner: c.querySelector(".table-card-unavailable")?.textContent.trim() || null,
    strandedText: c.querySelector(".table-card-stranded > span")?.textContent.trim() || null,
    strandedButtons: [...c.querySelectorAll("[data-avail-select-guest]")].map(b => b.textContent.trim()),
    markUnavailableBtn: !!c.querySelector("[data-avail-mark][data-avail-next='UNAVAILABLE']"),
    markAvailableBtn: !!c.querySelector("[data-avail-mark][data-avail-next='AVAILABLE']"),
    // Deliberately NOT the native "disabled" property (or aria-disabled, which
    // Playwright and some assistive tech treat as non-interactive the same
    // way): a truly disabled control swallows the click, so the same toast
    // the empty-seat row already gives would never fire from here. It only
    // LOOKS blocked (a CSS class + title) while the click still reaches
    // assignGuestGroup()'s own unavailable guard, the same as any seat row.
    assignBlocked: c.querySelector("[data-assign-selected]")?.classList.contains("is-blocked") ?? null,
    assignNativelyDisabled: c.querySelector("[data-assign-selected]")?.disabled ?? null,
  };
})()`;

const selectGuest = async (page, id) => {
  await page.evaluate(gid => {
    ui.selectedGuestId = gid; ui.selectedGuestIds = [gid]; ui.seatPreview = null; render();
  }, id);
  await page.waitForTimeout(300);
};
const selectTable = async (page, id) => {
  await page.evaluate(tid => { ui.selectedTableId = tid; render(); }, id);
  await page.waitForTimeout(300);
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Failure", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 3 });

  const room = await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 6; e.tables[0].zone = "MAIN FLOOR";
    e.tables[1].number = "T02"; e.tables[1].capacity = 6; e.tables[1].zone = "MAIN FLOOR";
    e.tables[2].number = "T03"; e.tables[2].capacity = 6; e.tables[2].zone = "MAIN FLOOR";
    const g = (id, name, pax, assignment) => ({
      id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: "Host",
      notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment, createdAt: new Date().toISOString(),
    });
    e.guests = [
      g("g_stay", "Deniz Kaya", 3, { tableId: e.tables[0].id, seats: [0, 1, 2], locked: false }),
      g("g_new", "Ela Aksoy", 1, null),
    ];
    touchEvent(e); render();
    return { t01: e.tables[0].id, t02: e.tables[1].id, t03: e.tables[2].id };
  });

  // --- 1. the domain module itself: a plain table is available -------------
  const bare = await page.evaluate(() => {
    const A = MeritTableAvailability;
    return {
      isUnavailable: A.isUnavailable(state.events[0].tables[0]),
      resolved: A.resolve(state.events[0].tables),
      stranded: A.strandedGuests(state.events[0].tables, state.events[0].guests),
      lost: A.lostCapacity(state.events[0].tables),
    };
  });
  checks.ok(!bare.isUnavailable, "a table with no availability field reads as available");
  checks.equal(bare.resolved.length, 0, "nothing resolves as unavailable yet", bare.resolved);
  checks.equal(bare.stranded.records, 0, "nobody is stranded yet", bare.stranded);
  checks.equal(bare.lost.chairs, 0, "no capacity is lost yet", bare.lost);

  await gotoTab(page, "seating");
  const beforeAll = await page.evaluate(SNAPSHOT);

  // --- 2. marking unavailable through the real table card -------------------
  await selectTable(page, room.t01);
  const cardBefore = await page.evaluate(CARD);
  checks.ok(cardBefore.markUnavailableBtn && !cardBefore.unavailableBanner,
    "an available table offers to mark it unavailable, with no banner yet", cardBefore);

  // The reason select has a disabled placeholder as its first entry rather
  // than defaulting to whichever REASON key happens to be listed first
  // (DAMAGED) -- a click that never opens the dropdown must not silently
  // record "Damaged" for a table that might be RELOCATED, on AV hold, or
  // anything else. Clicking Mark Unavailable without choosing a reason first
  // must do nothing but explain why.
  const reasonDefault = await page.evaluate(() => document.querySelector("[data-avail-reason]")?.value ?? null);
  checks.equal(reasonDefault, "", "the reason select starts on the forced placeholder, not a real reason", reasonDefault);
  await click(page, `[data-avail-mark="${room.t01}"][data-avail-next="UNAVAILABLE"]`);
  await page.waitForTimeout(350);
  const stillAvailable = await page.evaluate(
    (tid) => state.events[0].tables.find(t => t.id === tid).availability, room.t01);
  checks.ok(!stillAvailable, "clicking Mark Unavailable without choosing a reason marks nothing", stillAvailable);
  const guardToastText = (await page.locator("#toastWrap").allTextContents()).join(" ");
  checks.ok(/reason|neden/i.test(guardToastText),
    "and explains that a reason is needed, rather than a silent no-op", guardToastText);

  // Now choose a real reason and confirm the button actually works.
  await page.selectOption("[data-avail-reason]", "DAMAGED");
  await click(page, `[data-avail-mark="${room.t01}"][data-avail-next="UNAVAILABLE"]`);
  await page.waitForTimeout(350);

  const afterMark = await page.evaluate((tid) => {
    const t_ = state.events[0].tables.find(x => x.id === tid);
    const last = (state.audit || []).find(a => a.action === "TABLE_AVAILABILITY_CHANGED");
    return {
      availability: t_.availability, reason: t_.unavailableReason, since: t_.unavailableSince,
      capacity: t_.capacity, chairs: t_.chairs.length,
      audit: last && { from: last.detail.from, to: last.detail.to, reason: last.detail.reason },
    };
  }, room.t01);
  checks.equal(afterMark.availability, "UNAVAILABLE", "the table is now marked unavailable");
  checks.ok(afterMark.reason, "with a reason recorded", afterMark.reason);
  checks.ok(afterMark.since, "and a moment recorded", afterMark.since);
  checks.equal(afterMark.capacity, 6, "capacity is untouched by marking a table unavailable");
  checks.equal(afterMark.chairs, 6, "and so are its chairs — this is a status, not a resize");
  checks.ok(afterMark.audit && afterMark.audit.from === "AVAILABLE" && afterMark.audit.to === "UNAVAILABLE",
    "the change is audited", afterMark.audit);
  checks.equal(await page.evaluate(SNAPSHOT), beforeAll,
    "and marking a table unavailable moved nobody's assignment");

  // --- 3. the card shows the fact and who it strands -------------------------
  const cardAfter = await page.evaluate(CARD);
  checks.ok(cardAfter.unavailableBanner, "the card carries a visible unavailable banner", cardAfter);
  checks.ok(cardAfter.strandedText && /Deniz Kaya|1/.test(cardAfter.strandedButtons.join(" ")),
    "and names who it would strand", cardAfter);
  checks.equal(cardAfter.strandedButtons.length, 1,
    "one stranded guest record, not the individual seats", cardAfter.strandedButtons);
  checks.ok(cardAfter.markAvailableBtn && !cardAfter.markUnavailableBtn,
    "the card now offers to reverse it instead", cardAfter);

  // --- 4. the canvas shows it too, unconditionally (no layer toggle) --------
  await gotoTab(page, "floor");
  await settle(page);
  const canvasOn = await page.evaluate((tid) => {
    const el = document.querySelector(`[data-object-id="${tid}"]`);
    return { hasClass: el.classList.contains("unavailable"), hasIcon: !!el.querySelector(".table-unavailable") };
  }, room.t01);
  checks.ok(canvasOn.hasClass && canvasOn.hasIcon,
    "the unavailable table is marked on the canvas without any layer switched on", canvasOn);
  await gotoTab(page, "seating");
  await selectTable(page, room.t01);

  // --- 5. no override anywhere: a NEW assignment cannot land here -----------
  // The blocked-looking Assign button is the affordance; the real gate is
  // assignGuestGroup() itself, so this drives the lower-level empty-seat row
  // too, the same way a drag-and-drop would reach it.
  await selectGuest(page, "g_new");
  await selectTable(page, room.t01);
  const cardBlocking = await page.evaluate(CARD);
  checks.equal(cardBlocking.assignBlocked, true,
    "the primary seat-here action reads as blocked while the table is unavailable", cardBlocking);
  checks.equal(cardBlocking.assignNativelyDisabled, false,
    "but is not a native disabled control, so the click itself still reaches the guard", cardBlocking);
  const beforeAttempt = await page.evaluate(SNAPSHOT);
  const emptySeat = page.locator("[data-empty-seat]").first();
  if (await emptySeat.count()) await emptySeat.click({ force: true });
  await page.waitForTimeout(400);
  checks.equal(await page.evaluate(SNAPSHOT), beforeAttempt,
    "even a direct empty-seat click seats nobody at an unavailable table");
  const toastText = (await page.locator("#toastWrap").allTextContents()).join(" ");
  checks.ok(/unavailable|kullanılamaz/i.test(toastText),
    "and the operator is told why, not left with a silent no-op", toastText);

  // The primary CTA itself must give the SAME feedback as the empty-seat row
  // — a native disabled control would swallow this click with no toast at all.
  await click(page, "[data-assign-selected]");
  await page.waitForTimeout(400);
  checks.equal(await page.evaluate(SNAPSHOT), beforeAttempt,
    "clicking the primary CTA itself also seats nobody at an unavailable table");
  const ctaToastText = (await page.locator("#toastWrap").allTextContents()).join(" ");
  checks.ok(/unavailable|kullanılamaz/i.test(ctaToastText),
    "and gives the same explanation the empty-seat row gives, not a silent dead click", ctaToastText);

  // --- 6. Smart Seating excludes it, and names the reason -------------------
  const advice = await page.evaluate(() => {
    const guest = state.events[0].guests.find(g => g.id === "g_new");
    return MeritSeatingAdvisor.recommend({
      guest, tables: state.events[0].tables, guests: state.events[0].guests, limit: 4,
      unavailable: MeritTableAvailability.resolve(state.events[0].tables),
    });
  });
  checks.ok(!advice.options.some(o => o.tableId === room.t01),
    "the unavailable table is never recommended", advice.options.map(o => o.number));
  const blockedT01 = advice.blocked.find(b => b.tableId === room.t01);
  checks.equal(blockedT01 && blockedT01.why, "UNAVAILABLE",
    "and the reason it was removed is named", blockedT01);

  // --- 7. relocating a stranded guest reuses the existing selection ---------
  // Never a new "move" function: this sets the same ui.selectedGuestId the
  // guest queue itself sets, so Smart Seating populates for them and nothing
  // here has moved anyone.
  await click(page, `[data-avail-select-guest="g_stay"]`);
  await page.waitForTimeout(300);
  const selectedAfterRelocate = await page.evaluate(() => ui.selectedGuestId);
  checks.equal(selectedAfterRelocate, "g_stay",
    "selecting a stranded guest from the card selects them for Smart Seating, nothing more");
  checks.equal(await page.evaluate(SNAPSHOT), beforeAll,
    "and still nobody has been moved");

  // --- 8. distinct from a freeze, in both directions ------------------------
  await page.evaluate((tid) => {
    const e = state.events[0];
    e.freezes = [{ id: "f1", scope: "TABLE", tableId: tid, reason: "OTHER", note: "", createdAt: new Date().toISOString() }];
    touchEvent(e); render();
  }, room.t02);
  await page.evaluate((tid) => {
    const t_ = state.events[0].tables.find(x => x.id === tid);
    t_.availability = "UNAVAILABLE"; t_.unavailableReason = "SAFETY";
    touchEvent(state.events[0]); render();
  }, room.t02);
  await page.waitForTimeout(300);
  const both = await page.evaluate((tid) => {
    const t_ = state.events[0].tables.find(x => x.id === tid);
    return {
      frozen: MeritSeatingFreeze.tableState(state.events[0].freezes, t_),
      unavailable: MeritTableAvailability.isUnavailable(t_),
    };
  }, room.t02);
  checks.equal(both.frozen, "FROZEN", "T02 is frozen");
  checks.ok(both.unavailable, "and independently marked unavailable", both);
  // Clearing availability must never lift the freeze.
  await page.evaluate((tid) => {
    const t_ = state.events[0].tables.find(x => x.id === tid);
    t_.availability = "AVAILABLE"; t_.unavailableReason = null; t_.unavailableSince = null;
    touchEvent(state.events[0]); render();
  }, room.t02);
  const afterClearingAvail = await page.evaluate((tid) => {
    const t_ = state.events[0].tables.find(x => x.id === tid);
    return MeritSeatingFreeze.tableState(state.events[0].freezes, t_);
  }, room.t02);
  checks.equal(afterClearingAvail, "FROZEN",
    "marking a table available again never lifts a freeze on the same table");
  // And lifting the freeze must never touch availability.
  await page.evaluate((tid) => {
    const t_ = state.events[0].tables.find(x => x.id === tid);
    t_.availability = "UNAVAILABLE"; t_.unavailableReason = "SAFETY";
    state.events[0].freezes = [];
    touchEvent(state.events[0]); render();
  }, room.t02);
  const afterLiftingFreeze = await page.evaluate((tid) =>
    state.events[0].tables.find(x => x.id === tid).availability, room.t02);
  checks.equal(afterLiftingFreeze, "UNAVAILABLE",
    "and lifting a freeze never marks a table available again");
  // Clean up T02 for the checks below.
  await page.evaluate((tid) => {
    const t_ = state.events[0].tables.find(x => x.id === tid);
    t_.availability = "AVAILABLE"; t_.unavailableReason = null; t_.unavailableSince = null;
    touchEvent(state.events[0]); render();
  }, room.t02);

  // --- 9. the Plan Doctor: a real BLOCKING finding, and it reaches the radar
  const doctor = await page.evaluate((tid) => {
    const e = state.events[0];
    return MeritPlanDoctor.run({
      phase: "ready", tables: e.tables, guests: e.guests,
      frozen: [], unavailable: MeritTableAvailability.resolve(e.tables),
      backup: null, planIssues: [], analysis: null,
    });
  }, room.t01);
  const stranding = doctor.blocking.find(f => f.code === "guestsAtUnavailableTable");
  checks.ok(stranding, "the Plan Doctor raises the stranded guest as BLOCKING", doctor.blocking.map(f => f.code));
  checks.equal(stranding && stranding.params.pax, 3, "with the right pax", stranding && stranding.params);
  checks.equal(doctor.notEvaluated.length, 0,
    "and this build no longer admits table availability as unmodelled", doctor.notEvaluated);

  await gotoTab(page, "command");
  await settle(page);
  const radar = await page.evaluate(() => [...document.querySelectorAll(".cc-reason")]
    .map(r => r.querySelector(".cc-reason-body b")?.textContent.trim() || ""));
  checks.ok(radar.some(w => /unavailable|kullanılamaz/i.test(w)),
    "the Command Center's radar states it in words, not as a code", radar);

  // --- 10. both languages, no raw keys, EN really differs from TR ----------
  await gotoTab(page, "seating");
  await selectTable(page, room.t01);
  const words = await page.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; render();
      out[lang] = {
        banner: document.querySelector(".table-card-unavailable b")?.textContent.trim() || "",
        stranded: document.querySelector(".table-card-stranded > span")?.textContent.trim() || "",
        markAvail: document.querySelector("[data-avail-mark]")?.textContent.trim() || "",
      };
    }
    ui.lang = "en"; render();
    return out;
  });
  for (const lang of ["en", "tr"]) {
    checks.ok(Object.values(words[lang]).every(v => v.length > 0 && !/^[a-z][a-zA-Z0-9]*\.[a-zA-Z]/.test(v)),
      `${lang}: the table card is written in words, never a raw key`, words[lang]);
  }
  checks.ok(words.en.banner !== words.tr.banner, "and Turkish is really Turkish", words);
}
