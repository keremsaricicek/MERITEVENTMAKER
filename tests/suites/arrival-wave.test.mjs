// When are they coming, and when did they actually come?
//
// Two axes, and this suite exists to keep them apart. The failures worth
// catching are all failures of honesty rather than of arithmetic:
//
//   AN ABSENT EXPECTED AXIS MUST READ AS ABSENT, NOT AS ZERO. No guest record
//   in this product carries a stated arrival window unless a person typed one,
//   so most events genuinely have no expected curve. A flat line at zero would
//   say "nobody is expected", which is a claim about the evening rather than a
//   fact about the data.
//
//   NOTHING IS PREDICTED. There is no projection field, and no bucket past the
//   last real figure. "310 guests expected in the next 20 minutes" would need a
//   model that does not exist.
//
//   A NO SHOW IS NEVER AN ARRIVAL. Counted, separately, and never on the curve.
//
//   THE MOMENT FOLLOWS THE STATUS. Un-checking somebody in, or turning them
//   into a No Show, must take their arrival time with it — a stale timestamp
//   leaves a person on the curve who is not in the room.
//
//   A PARTY IS ONE RECORD AND N PEOPLE, on both axes.
import { click, openApp, createBlankEvent, addTables, addGuest, gotoTab, futureDate, settle, typeQuery } from "../lib/app-actions.mjs";

export const meta = { name: "arrival-wave", tags: ["business", "fast"], timeout: 180000 };

const WAVE = `(function(){
  const s = document.querySelector(".arrival-wave");
  if (!s) return null;
  return {
    title: s.querySelector(".aw-head strong")?.textContent.trim() || "",
    buckets: [...s.querySelectorAll(".aw-bucket")].map(b => ({
      key: b.dataset.waveKey,
      time: b.querySelector(".aw-time")?.textContent.trim() || "",
      count: b.querySelector(".aw-count")?.textContent.trim() || "",
      expectedBar: !!b.querySelector(".aw-bar.expected"),
      active: b.classList.contains("active"),
    })),
    none: s.querySelector(".aw-none")?.textContent.trim() || null,
    partial: s.querySelector(".aw-partial")?.textContent.trim() || null,
    untimed: s.querySelector(".aw-untimed")?.textContent.trim() || null,
    vip: s.querySelector(".aw-vip")?.textContent.trim() || null,
    note: s.querySelector(".aw-note")?.textContent.trim() || null,
    empty: s.querySelector(".aw-empty")?.textContent.trim() || null,
    text: s.textContent,
  };
})()`;

const LIVE_ROWS = `[...document.querySelectorAll(".arrival-row .party-name")].map(n => n.textContent.trim())`;

// A stamp at a given wall-clock time today, built in the page so it lands in
// the browser's own timezone — the one the door is standing in.
const stampAt = (h, m) => `(function(){const d=new Date();d.setHours(${h},${m},0,0);return d.toISOString();})()`;

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Wave", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 2 });

  await page.evaluate(() => {
    const e = state.events[0];
    e.tables[0].number = "T01"; e.tables[0].capacity = 10;
    e.tables[1].number = "T02"; e.tables[1].capacity = 10;
    const g = (id, name, pax, extra) => ({
      id, name, additionalGuests: pax - 1, pax, vip: "Standard", invitedBy: "Host",
      notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      expectedArrival: null, checkedInAt: null,
      assignment: null, createdAt: new Date().toISOString(), ...extra,
    });
    e.guests = [
      g("g_a", "Ayşe Demir", 4),
      g("g_b", "Burak Şahin", 2),
      g("g_c", "Can Öztürk", 3, { vip: "VVIP" }),
      g("g_d", "Deniz Yıldız", 1),
    ];
    touchEvent(e); render();
  });

  await gotoTab(page, "live");
  await settle(page);

  // --- 1. an absent expected axis reads as absent ---------------------------
  const bare = await page.evaluate(WAVE);
  checks.ok(bare, "the Live screen carries an arrival wave");
  checks.ok(bare.empty, "with nothing on it yet — nobody has arrived and nobody stated a time", bare.empty);
  checks.equal(bare.buckets.length, 0, "and no invented buckets", bare.buckets);

  const axis = await page.evaluate(() => {
    const w = MeritArrivalWave.build({ guests: state.events[0].guests, bucketMinutes: 30 });
    return { available: w.expected.available, coverage: w.expected.coverage, why: w.expected.why,
      forecast: w.forecast, buckets: w.buckets.length };
  });
  checks.equal(axis.available, false, "the engine reports no expected axis");
  checks.equal(axis.coverage, "NONE", "coverage is NONE, not a zero curve");
  checks.ok(axis.why && axis.why.length > 10, "and it says why", axis.why);
  checks.equal(axis.forecast, null,
    "there is no forecast field to fill in — the product does not predict arrivals");

  // --- 2. an actual arrival appears, without an expected axis ---------------
  await page.evaluate(async (iso) => {
    const e = state.events[0];
    const g = e.guests.find(x => x.id === "g_a");
    g.arrivalStatus = "Checked In"; g.checkedInAt = iso;
    touchEvent(e); render();
  }, await page.evaluate(stampAt(19, 40)));
  await page.waitForTimeout(400);

  const actualOnly = await page.evaluate(WAVE);
  checks.equal(actualOnly.buckets.length, 1, "one arrival makes one interval", actualOnly.buckets);
  checks.equal(actualOnly.buckets[0].time, "19:30", "placed in the interval it happened in");
  checks.equal(actualOnly.buckets[0].count, "4", "counting PEOPLE, not records — a party of four is four");
  checks.ok(!actualOnly.buckets[0].expectedBar,
    "and no stated bar is drawn, because no time was stated");
  checks.ok(actualOnly.none && actualOnly.none.length > 20,
    "the screen says the expected axis does not exist rather than drawing it flat", actualOnly.none);
  checks.ok(actualOnly.note && /predict|tahmin/i.test(actualOnly.note),
    "and says plainly that nothing is predicted", actualOnly.note);
  checks.ok(!/\bforecast|tahmin edil(iyor|en)\b/i.test(actualOnly.text.replace(actualOnly.note, "")),
    "with no forecast anywhere else on it", actualOnly.text);

  // --- 3. a No Show is never an arrival -------------------------------------
  await page.evaluate((iso) => {
    const e = state.events[0];
    const g = e.guests.find(x => x.id === "g_b");
    // Deliberately give them a stale moment first, the way an un-do would.
    g.arrivalStatus = "Checked In"; g.checkedInAt = iso;
    touchEvent(e); render();
  }, await page.evaluate(stampAt(19, 45)));
  await page.waitForTimeout(300);
  const beforeNoShow = await page.evaluate(() =>
    MeritArrivalWave.build({ guests: state.events[0].guests, bucketMinutes: 30 }).actual.pax);
  checks.equal(beforeNoShow, 6, "two parties in: four plus two");

  await click(page, `[data-live-guest="g_b"][data-arrival="No Show"]`);
  await page.waitForTimeout(500);
  const afterNoShow = await page.evaluate(() => {
    const e = state.events[0];
    const w = MeritArrivalWave.build({ guests: e.guests, bucketMinutes: 30 });
    const g = e.guests.find(x => x.id === "g_b");
    return { actualPax: w.actual.pax, noShowPax: w.noShow.pax,
      stamp: g.checkedInAt, status: g.arrivalStatus,
      onCurve: w.buckets.some(b => b.actual.guestIds.includes("g_b")) };
  });
  checks.equal(afterNoShow.status, "No Show", "marking a No Show sets the arrival axis");
  checks.equal(afterNoShow.actualPax, 4, "and removes them from the arrival total");
  checks.equal(afterNoShow.noShowPax, 2, "counting them as a No Show instead");
  checks.equal(afterNoShow.stamp, null,
    "the arrival moment goes with the status — a stale one would leave somebody on the curve who is not in the room");
  checks.ok(!afterNoShow.onCurve, "and they are on no interval of the timeline");

  // TWO DEFENCES, AND BOTH HAVE TO BE TESTED. The check above only proves the
  // CALLER cleared the moment. The module has its own rule — a No Show is
  // never an arrival regardless of what its record carries — and that rule was
  // invisible to the check above, because by the time the module ran there was
  // no stamp left to mishandle. A restored older backup, or a hand-edited
  // file, is exactly the shape that arrives with both.
  const noShowWithStamp = await page.evaluate((iso) => {
    const guests = JSON.parse(JSON.stringify(state.events[0].guests));
    const g = guests.find(x => x.id === "g_b");
    g.arrivalStatus = "No Show"; g.checkedInAt = iso;
    const w = MeritArrivalWave.build({ guests, bucketMinutes: 30 });
    return { actualPax: w.actual.pax, noShowPax: w.noShow.pax,
      onCurve: w.buckets.some(b => b.actual.guestIds.includes("g_b")) };
  }, await page.evaluate(stampAt(19, 45)));
  checks.ok(!noShowWithStamp.onCurve,
    "a No Show that still carries an arrival moment is STILL not on the curve — the module's own rule, not the caller's");
  checks.equal(noShowWithStamp.actualPax, 4, "and is not in the arrival total either", noShowWithStamp);
  checks.equal(noShowWithStamp.noShowPax, 2, "it is a No Show, counted as one", noShowWithStamp);

  // --- 4. the same holds for un-checking somebody in ------------------------
  await click(page, `[data-live-guest="g_a"][data-arrival="Checked In"]`);
  await page.waitForTimeout(500);
  const undone = await page.evaluate(() => {
    const g = state.events[0].guests.find(x => x.id === "g_a");
    const w = MeritArrivalWave.build({ guests: state.events[0].guests, bucketMinutes: 30 });
    return { status: g.arrivalStatus, stamp: g.checkedInAt, actualPax: w.actual.pax,
      planning: g.planningStatus };
  });
  checks.equal(undone.status, "Not Arrived", "un-checking somebody in returns them to Not Arrived");
  checks.equal(undone.stamp, null, "and takes their arrival moment with it");
  checks.equal(undone.actualPax, 0, "the curve is empty again");
  checks.equal(undone.planning, "Confirmed",
    "and planning status never moved — the two axes are independent");

  // --- 5. check-in through the real door flow records a real moment --------
  const before = Date.now();
  await click(page, `[data-live-guest="g_c"][data-arrival="Checked In"]`);
  await page.waitForTimeout(500);
  const doorCheckIn = await page.evaluate(() => {
    const g = state.events[0].guests.find(x => x.id === "g_c");
    const entries = (state.audit || []).filter(a => a.action === "ARRIVAL_STATUS_CHANGED");
    const last = entries[0];
    return { stamp: g.checkedInAt, status: g.arrivalStatus,
      auditTo: last && last.detail.to, auditFrom: last && last.detail.from,
      auditAt: last && last.detail.at, source: last && last.detail.source };
  });
  checks.ok(doorCheckIn.stamp, "checking in at the door records when it happened");
  checks.ok(new Date(doorCheckIn.stamp).getTime() >= before - 2000,
    "with the real moment, not a placeholder", doorCheckIn.stamp);
  checks.equal(doorCheckIn.auditTo, "Checked In", "the audit records what it became");
  checks.equal(doorCheckIn.auditFrom, "Not Arrived", "and what it was");
  checks.equal(doorCheckIn.auditAt, doorCheckIn.stamp,
    "and the audit's moment is the guest record's moment — one fact, not two");
  checks.ok(doorCheckIn.source, "with where the change came from", doorCheckIn.source);

  // --- 6. a stated window creates the expected axis -------------------------
  await page.evaluate(() => {
    const e = state.events[0];
    e.guests.find(x => x.id === "g_a").expectedArrival = "19:30";
    e.guests.find(x => x.id === "g_d").expectedArrival = "20:30";
    touchEvent(e); render();
  });
  await page.waitForTimeout(400);
  const withExpected = await page.evaluate(WAVE);
  checks.ok(withExpected.buckets.length >= 2,
    "stated windows extend the timeline to cover them", withExpected.buckets);
  checks.ok(withExpected.buckets.every(b => b.expectedBar),
    "every interval now carries a stated bar as well as an arrived one", withExpected.buckets);
  checks.ok(!withExpected.none, "and the 'no stated times' message is gone");
  checks.ok(withExpected.partial,
    "but partial coverage is stated — two of four records carry a time, and a curve covering half the room without saying so is worse than none",
    withExpected.partial);
  const coverage = await page.evaluate(() =>
    MeritArrivalWave.build({ guests: state.events[0].guests, bucketMinutes: 30 }).expected.coverage);
  checks.equal(coverage, "PARTIAL", "the engine names the coverage rather than scoring it");

  // Expected and actual are separate: the stated one has not arrived.
  const separate = await page.evaluate(() => {
    const w = MeritArrivalWave.build({ guests: state.events[0].guests, bucketMinutes: 30 });
    const b = w.buckets.find(x => x.key === "19:30");
    return { expectedPax: b.expected.pax, actualPax: b.actual.pax,
      expectedIds: b.expected.guestIds, actualIds: b.actual.guestIds };
  });
  checks.equal(separate.expectedPax, 4, "the 19:30 interval expects four");
  checks.equal(separate.actualPax, 0, "and nobody arrived in it — the two axes never borrow from each other");
  checks.ok(separate.expectedIds.includes("g_a") && !separate.actualIds.includes("g_a"),
    "the same guest is on one axis and not the other", separate);

  // --- 7. selecting a wave narrows the same list, and lets go --------------
  const allRows = await page.evaluate(LIVE_ROWS);
  checks.equal(allRows.length, 4, "the door list shows everybody to begin with", allRows);
  await click(page, `[data-wave-key="19:30"]`);
  await page.waitForTimeout(400);
  const narrowed = await page.evaluate(LIVE_ROWS);
  checks.equal(narrowed.length, 1, "selecting a wave narrows the door list to it", narrowed);
  checks.equal(narrowed[0], "Ayşe Demir", "to the right people", narrowed);
  checks.ok(await page.evaluate(() => !!document.querySelector(".wave-banner")),
    "with a banner saying what is being shown");
  await click(page, "[data-wave-clear]");
  await page.waitForTimeout(400);
  checks.equal((await page.evaluate(LIVE_ROWS)).length, 4,
    "and one click returns to normal Live operation");

  // --- 8. VIPs still outside are discoverable ------------------------------
  const vipRow = await page.evaluate(WAVE);
  checks.ok(!vipRow.vip,
    "with the only VIP already checked in, nothing claims VIPs are outstanding", vipRow.vip);
  await click(page, `[data-live-guest="g_c"][data-arrival="Checked In"]`);
  await page.waitForTimeout(500);
  const vipBack = await page.evaluate(WAVE);
  checks.ok(vipBack.vip, "a VIP who has not arrived is surfaced", vipBack.vip);
  await click(page, "[data-wave-vip]");
  await page.waitForTimeout(400);
  const vipRows = await page.evaluate(LIVE_ROWS);
  checks.equal(vipRows.length, 1, "and can be isolated in one click", vipRows);
  checks.equal(vipRows[0], "Can Öztürk", "to the VIP who is still outside", vipRows);
  await click(page, "[data-wave-clear]");
  await page.waitForTimeout(400);

  // --- 9. a check-in with no recorded moment is counted, never placed ------
  const untimed = await page.evaluate(() => {
    const guests = JSON.parse(JSON.stringify(state.events[0].guests));
    // The shape a restore from an older backup produces: a status, no moment.
    guests.find(g => g.id === "g_d").arrivalStatus = "Checked In";
    guests.find(g => g.id === "g_d").checkedInAt = null;
    const w = MeritArrivalWave.build({ guests, bucketMinutes: 30 });
    return { total: w.actual.pax, timed: w.actual.timedPax, untimed: w.actual.untimedPax,
      onCurve: w.buckets.some(b => b.actual.guestIds.includes("g_d")) };
  });
  checks.equal(untimed.untimed, 1, "a check-in with no moment is counted as untimed");
  checks.equal(untimed.total, untimed.timed + untimed.untimed,
    "and is part of the arrival total — counted, not dropped", untimed);
  checks.ok(!untimed.onCurve,
    "but is never placed on an interval the module invented for it");

  // --- 10. the interval width is the operator's, and changes nothing -------
  await click(page, `[data-wave-bucket="60"]`);
  await page.waitForTimeout(400);
  const wide = await page.evaluate(() => ({
    ui: ui.waveBucket,
    total: MeritArrivalWave.build({ guests: state.events[0].guests, bucketMinutes: 60 }).actual.pax,
    fine: MeritArrivalWave.build({ guests: state.events[0].guests, bucketMinutes: 15 }).actual.pax,
  }));
  checks.equal(wide.ui, 60, "the interval width can be changed");
  checks.equal(wide.total, wide.fine,
    "and re-bucketing never changes how many people arrived");
  await click(page, `[data-wave-bucket="30"]`);
  await page.waitForTimeout(300);

  // --- 11. a completed event reads the timeline and cannot move it ---------
  await page.evaluate(() => {
    const e = state.events[0];
    e.status = "Completed";
    saveState(); ui.tab = "live"; render();
  });
  await page.waitForTimeout(500);
  const historical = await page.evaluate(() => {
    const e = state.events[0];
    const before = JSON.stringify(e.guests.map(g => [g.id, g.arrivalStatus, g.checkedInAt]));
    const g = e.guests.find(x => x.id === "g_d");
    // The real mutation path, on a read-only event.
    const changed = typeof setArrival === "function";
    const btn = document.querySelector('[data-live-guest="g_d"]');
    if (btn) btn.click();
    return { before, after: JSON.stringify(e.guests.map(x => [x.id, x.arrivalStatus, x.checkedInAt])),
      buttonPresent: !!btn, closureHidden: !changed, wave: !!document.querySelector(".arrival-wave") };
  });
  checks.equal(historical.after, historical.before,
    "a completed event's arrivals cannot be changed from the screen");
  checks.ok(historical.wave || !historical.buttonPresent,
    "and the timeline is still readable or the controls are simply not there", historical);

  // --- 12. both languages, no raw keys -------------------------------------
  const words = await page.evaluate(() => {
    const e = state.events[0]; e.status = "Planning"; saveState();
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; ui.tab = "live"; render();
      const s = document.querySelector(".arrival-wave");
      out[lang] = {
        title: s?.querySelector(".aw-head strong")?.textContent.trim() || "",
        question: s?.querySelector(".aw-head p")?.textContent.trim() || "",
        note: s?.querySelector(".aw-note")?.textContent.trim() || "",
      };
    }
    ui.lang = "en"; render();
    return out;
  });
  for (const lang of ["en", "tr"]) {
    checks.ok(Object.values(words[lang]).every(v => v.length > 0), `${lang}: the wave is written`, words[lang]);
    checks.ok(Object.values(words[lang]).every(v => !/^[a-z][a-zA-Z0-9]*\.[a-zA-Z]/.test(v)),
      `${lang}: in words, never a raw key`, words[lang]);
  }
  checks.ok(words.en.question !== words.tr.question,
    "and Turkish is really Turkish, not English left in place", words);
  checks.ok(words.en.note !== words.tr.note, "including the no-forecast statement", words);
}
