// What an operator's own event history shows — never what a model predicts.
//
// This suite exists to keep three properties true:
//
//   AN OPERATOR READING THEIR OWN PAST, NEVER A TRAINED MODEL. "Learning"
//   here means exactly what it means in the Teach Area and the captured-
//   decision log elsewhere in this product: real arithmetic over real
//   numbers, computed fresh on every read, never fitted or stored.
//
//   NULL MEANS NO DATA, NEVER ZERO. An event with no tables yet contributes
//   no utilization figure to the average; an event with no guests
//   contributes no no-show figure — reporting either as 0% would claim
//   something the data does not say.
//
//   AN AVERAGE NAMES ITS OWN SAMPLE SIZE, and each of the two facts this
//   phase surfaces (room utilization, no-show rate) tracks its own sample
//   independently, since an event that is missing one figure can still
//   contribute the other.
import { click, openApp, createBlankEvent, addTables, futureDate, settle } from "../lib/app-actions.mjs";

export const meta = { name: "event-history", tags: ["business", "fast"], timeout: 150000 };

const PANEL = `(function(){
  const s = document.querySelector(".history-learning");
  if (!s) return null;
  return {
    title: s.querySelector(".mx-section-head h2")?.textContent.trim() || "",
    note: s.querySelector(".history-note")?.textContent.trim() || "",
    tiles: [...s.querySelectorAll(".mx-metric")].map(m => ({
      label: m.querySelector(".mx-metric-label")?.textContent.trim() || "",
      value: m.querySelector(".mx-metric-value")?.textContent.trim() || "",
      note: m.querySelector(".mx-metric-note")?.textContent.trim() || "",
    })),
  };
})()`;


export default async function run({ page, checks, baseUrl }) {
  // Behavioural checks (wording logic, sample-size math), not translation —
  // pinned to English since the product now boots in Turkish by default.
  await openApp(page, baseUrl, { lang: "en" });

  // --- 1. the domain module itself: pure arithmetic, null means no data ----
  const unit = await page.evaluate(() => {
    const M = MeritEventHistory;
    const zeroCapacity = M.outcome({ totalPax: 4, actualPax: 3, capacity: 0, noShowPax: 1, noShowRecords: 1 });
    const zeroPax = M.outcome({ totalPax: 0, actualPax: 0, capacity: 6, noShowPax: 0, noShowRecords: 0 });
    const normal = M.outcome({ totalPax: 4, actualPax: 3, capacity: 4, noShowPax: 1, noShowRecords: 1 });
    const emptyLearning = M.learning([]);
    const mixedLearning = M.learning([zeroCapacity, zeroPax, normal]);
    return { zeroCapacity, zeroPax, normal, emptyLearning, mixedLearning };
  });
  checks.equal(unit.zeroCapacity.utilization, null, "zero table capacity means no utilization figure, never a claimed 0%", unit.zeroCapacity);
  checks.equal(unit.zeroPax.noShowRate, null, "zero invited pax means no no-show figure, never a claimed 0%", unit.zeroPax);
  checks.equal(unit.normal.utilization, 0.75, "utilization is actual (checked-in) pax over physical capacity", unit.normal);
  checks.equal(unit.normal.noShowRate, 0.25, "no-show rate is no-show pax over total invited pax", unit.normal);
  checks.equal(unit.emptyLearning.eventsConsidered, 0, "learning() on nothing considers zero events", unit.emptyLearning);
  checks.equal(unit.emptyLearning.averageUtilization, null, "and reports no average rather than a fabricated zero", unit.emptyLearning);
  // zeroCapacity has real pax (noShowRate 0.25) but no capacity (utilization null);
  // zeroPax has real capacity (utilization 0) but no invited pax (noShowRate null) —
  // each fact excludes only the outcome actually missing that figure.
  checks.equal(unit.mixedLearning.utilizationSampleSize, 2, "utilization excludes only the outcome with zero capacity", unit.mixedLearning);
  checks.equal(unit.mixedLearning.noShowSampleSize, 2, "no-show rate excludes only the outcome with zero invited pax", unit.mixedLearning);
  checks.equal(unit.mixedLearning.averageUtilization, 0.375, "the utilization average is over zeroPax (0) and normal (0.75) only", unit.mixedLearning);
  checks.equal(unit.mixedLearning.averageNoShowRate, 0.25, "the no-show average is over zeroCapacity (0.25) and normal (0.25) only", unit.mixedLearning);

  // --- 2. no panel while there are zero historical events -------------------
  const beforeAny = await page.evaluate(PANEL);
  checks.equal(beforeAny, null, "no history-learning panel before any event is historical");

  // --- 3. one historical event: singular sample-size wording -----------------
  await createBlankEvent(page, { name: "History A", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 1 });
  await page.evaluate(() => {
    const g = (id, name, extra) => ({
      id, name, additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "Host",
      notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, createdAt: new Date().toISOString(), ...extra,
    });
    const e = state.events.find(x => x.name === "History A");
    const t = e.tables[0];
    t.chairs = t.chairs.slice(0, 4); t.capacity = 4;
    e.guests = [
      g("a1", "A1", { arrivalStatus: "Checked In" }),
      g("a2", "A2", { arrivalStatus: "Checked In" }),
      g("a3", "A3", { arrivalStatus: "Checked In" }),
      g("a4", "A4", { arrivalStatus: "No Show" }),
    ];
    e.status = "Completed";
    touchEvent(e); render();
  });
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(300);
  const one = await page.evaluate(PANEL);
  checks.ok(one, "the panel appears once one event is historical");
  checks.equal(one.title.toLowerCase(), "what your history shows", "titled as a read of history, never implying a model", one.title);
  checks.equal(one.tiles.length, 2, "exactly two tiles: room utilization and no-show rate", one.tiles);
  checks.equal(one.tiles[0].value, "75%", "3 of 4 chairs used, from the one real event", one.tiles[0]);
  checks.equal(one.tiles[1].value, "25%", "1 of 4 invited pax was a no-show, from the one real event", one.tiles[1]);
  checks.ok(/only completed event/i.test(one.tiles[0].note), "singular wording for a utilization sample of exactly one", one.tiles[0]);
  checks.ok(/only completed event/i.test(one.tiles[1].note), "singular wording for a no-show sample of exactly one", one.tiles[1]);

  // --- 4. a second, different event: the average is really an average -------
  await createBlankEvent(page, { name: "History B", hotel: "Merit Royal", date: futureDate() });
  await addTables(page, { quantity: 1 });
  await page.evaluate(() => {
    const g = (id, name, extra) => ({
      id, name, additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "Host",
      notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, createdAt: new Date().toISOString(), ...extra,
    });
    const e = state.events.find(x => x.name === "History B");
    const t = e.tables[0];
    t.chairs = t.chairs.slice(0, 4); t.capacity = 4;
    e.guests = [
      g("b1", "B1", { arrivalStatus: "Checked In" }),
      g("b2", "B2", { arrivalStatus: "Checked In" }),
      g("b3", "B3", { arrivalStatus: "Checked In" }),
      g("b4", "B4", { arrivalStatus: "Checked In" }),
    ];
    e.status = "Completed";
    touchEvent(e); render();
  });
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(300);

  // --- 5. a third, blank-floor-plan event: excluded from utilization only ---
  await createBlankEvent(page, { name: "History C", hotel: "Merit Royal", date: futureDate() });
  await page.evaluate(() => {
    const g = (id, name, extra) => ({
      id, name, additionalGuests: 0, pax: 1, vip: "Standard", invitedBy: "Host",
      notes: "", planningStatus: "Confirmed", arrivalStatus: "Not Arrived",
      assignment: null, createdAt: new Date().toISOString(), ...extra,
    });
    const e = state.events.find(x => x.name === "History C");
    e.guests = [
      g("c1", "C1", { arrivalStatus: "Checked In" }),
      g("c2", "C2", { arrivalStatus: "No Show" }),
    ];
    e.status = "Completed";
    touchEvent(e); render();
  });
  await click(page, '[data-action="back-events"]');
  await page.waitForTimeout(300);

  const all = await page.evaluate(PANEL);
  checks.ok(all, "the panel is still there with three historical events");
  // utilization: (0.75 + 1.0) / 2 = 0.875 -> 88%, from A and B only (C has no tables)
  checks.equal(all.tiles[0].value, "88%", "the utilization average excludes the event with no physical capacity", all.tiles[0]);
  checks.ok(/across 2 completed events/i.test(all.tiles[0].note), "and its sample size says exactly 2, not 3", all.tiles[0]);
  // no-show: (0.25 + 0 + 0.5) / 3 = 0.25 -> 25%, all three contribute (C has real pax)
  checks.equal(all.tiles[1].value, "25%", "the no-show average includes all three events, since each has real invited pax", all.tiles[1]);
  checks.ok(/across 3 completed events/i.test(all.tiles[1].note), "and its own sample size is independently 3", all.tiles[1]);

  // --- 6. both languages, no raw keys, EN really differs from TR -----------
  const words = await page.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; render();
      const s = document.querySelector(".history-learning");
      out[lang] = {
        title: s?.querySelector(".mx-section-head h2")?.textContent.trim() || "",
        note: s?.querySelector(".history-note")?.textContent.trim() || "",
        labels: [...(s?.querySelectorAll(".mx-metric-label") || [])].map(x => x.textContent.trim()),
      };
    }
    ui.lang = "en"; render();
    return out;
  });
  checks.ok(words.en.title && words.en.note && words.tr.title && words.tr.note, "both languages have real title/note text", words);
  checks.ok(words.en.title !== words.tr.title, "and Turkish is really Turkish", words);
  checks.ok(!/history\./i.test(JSON.stringify(words)), "no raw history.* key reaches either screen", words);
}
