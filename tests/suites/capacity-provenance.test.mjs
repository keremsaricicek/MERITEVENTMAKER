// WHY DOES THIS TABLE HAVE THIS CAPACITY NUMBER? src/capacity-provenance.js
// names eight possible answers and this suite protects two different kinds
// of promise about them:
//
//   THE THREE THIS BUILD CAN HONESTLY PRODUCE must be set by the real code
//   path that earns them — a manually created or manually re-capacitied
//   table is HUMAN_CONFIRMED, a table committed from real confirmed chair
//   detections is DETECTED_PHYSICAL_SEATS, and a table committed with no
//   such evidence is UNKNOWN rather than silently inheriting whichever of
//   the other two it resembles.
//
//   THE FIVE THIS BUILD CANNOT PRODUCE YET (PRINTED_TABLE_CAPACITY,
//   PRINTED_ZONE_CAPACITY, PRINTED_TOTAL_CAPACITY, DERIVED_PRINTED_RULE,
//   VERIFIED_VENUE_MEMORY) must stay named and translated but UNWIRED — a
//   future feature gets a slot to report into, but nothing today may claim
//   one of these five just because the taxonomy exists.
//
// A migration/backfill check protects the other real risk: an install from
// before this field existed, or a corrupted value, must become UNKNOWN on
// load rather than being dropped or guessed at.
//
// Section 11 (Data Provenance Inspector) put the first UI surface on this
// data: a read-only line on the Floor Plan contextual card. It must show
// the CURRENT source honestly (no fabricated fuller story than the 3 wired
// values support) and never itself become a place to hand-pick a source.
import { openApp, createBlankEvent, addTables, gotoTab, click, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "capacity-provenance", tags: ["business", "fast"], timeout: 90000 };

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);

  // --- 1. the enum contract itself ----------------------------------------
  const contract = await page.evaluate(() => {
    const M = globalThis.MeritCapacityProvenance;
    return M ? {
      names: Object.keys(M.SOURCE).sort(),
      wired: [...M.WIRED].sort(),
      validKnown: M.isValid("HUMAN_CONFIRMED"),
      validUnknown: M.isValid("SOMETHING_MADE_UP"),
      normalizeGood: M.normalize("DETECTED_PHYSICAL_SEATS"),
      normalizeBad: M.normalize("SOMETHING_MADE_UP"),
      normalizeMissing: M.normalize(undefined),
    } : null;
  });
  checks.require(contract, "globalThis.MeritCapacityProvenance is exposed", contract);
  checks.equal(JSON.stringify(contract.names),
    JSON.stringify(["DERIVED_PRINTED_RULE","DETECTED_PHYSICAL_SEATS","HUMAN_CONFIRMED","PRINTED_TABLE_CAPACITY","PRINTED_TOTAL_CAPACITY","PRINTED_ZONE_CAPACITY","UNKNOWN","VERIFIED_VENUE_MEMORY"]),
    "exactly the eight named sources exist — no sixth invented, none of the eight silently dropped");
  checks.equal(JSON.stringify(contract.wired), JSON.stringify(["DETECTED_PHYSICAL_SEATS","HUMAN_CONFIRMED","UNKNOWN"]),
    "exactly the three sources this build can honestly produce are marked WIRED — the other five are named, not claimed");
  checks.ok(contract.validKnown && !contract.validUnknown, "isValid() accepts only the eight real names", contract);
  checks.equal(contract.normalizeGood, "DETECTED_PHYSICAL_SEATS", "normalize() passes a real value through untouched", contract);
  checks.equal(contract.normalizeBad, "UNKNOWN", "normalize() turns an unrecognised value into UNKNOWN rather than keeping garbage", contract);
  checks.equal(contract.normalizeMissing, "UNKNOWN", "normalize() turns a missing value into UNKNOWN", contract);

  // --- 2. a manually added table (bulk-add / createTable) is HUMAN_CONFIRMED
  await createBlankEvent(page, { name: "Capacity Provenance", date: futureDate() });
  await addTables(page, { quantity: 2 });
  const manual = await page.evaluate(() => state.events[0].tables.map(t => t.capacitySource));
  checks.ok(manual.every(s => s === "HUMAN_CONFIRMED"),
    "every table added through the bulk-add dialog is tagged HUMAN_CONFIRMED — a person chose this capacity", manual);

  // --- 3. the "Add Manually" single-table draft path is also HUMAN_CONFIRMED
  const draftSource = await page.evaluate(() => {
    const before = state.events[0].tables.length;
    ui.tableDraft = { type: "round", seats: 6, zone: "MAIN FLOOR" };
    createTableFromDraft();
    const tables = state.events[0].tables;
    return tables.length === before + 1 ? tables[tables.length - 1].capacitySource : "NO_TABLE_ADDED";
  });
  checks.equal(draftSource, "HUMAN_CONFIRMED",
    "the single-table 'Add Manually' draft flow also tags its table HUMAN_CONFIRMED, not just the bulk-add dialog", draftSource);

  // --- 4. setTableCapacity (the seat stepper/presets/custom field) always
  //        (re)tags HUMAN_CONFIRMED, including overriding an earlier
  //        machine-sourced value once a person touches the number ----------
  const stepperResult = await page.evaluate(() => {
    const e = state.events[0], t = e.tables[0];
    t.capacitySource = "DETECTED_PHYSICAL_SEATS"; // simulate a machine-sourced starting point
    const ok = setTableCapacity(e, t, t.capacity + 1);
    return { ok, source: t.capacitySource };
  });
  checks.ok(stepperResult.ok, "setTableCapacity succeeded", stepperResult);
  checks.equal(stepperResult.source, "HUMAN_CONFIRMED",
    "once a person changes the capacity by hand, provenance becomes HUMAN_CONFIRMED even if it started as machine-sourced — provenance reflects the CURRENT source of truth, never the original one", stepperResult);

  // --- 5. Assisted Detection's commit path: the same expression
  //        commitCandidates() uses, exercised directly (matching the pattern
  //        already established in physical-logical-seat-separation) --------
  const commitScenarios = await page.evaluate(() => {
    const sourceFor = chairDetectionsLength => (chairDetectionsLength ? "DETECTED_PHYSICAL_SEATS" : "UNKNOWN");
    return {
      withDetections: sourceFor(4),
      withoutDetections: sourceFor(0),
    };
  });
  checks.equal(commitScenarios.withDetections, "DETECTED_PHYSICAL_SEATS",
    "a committed candidate with real confirmed chair detections is tagged DETECTED_PHYSICAL_SEATS", commitScenarios);
  checks.equal(commitScenarios.withoutDetections, "UNKNOWN",
    "a committed candidate with no chair detections is tagged UNKNOWN — a guessed starting capacity is never claimed as detected or human-confirmed", commitScenarios);

  // --- 6. migration backfill: an old table with no capacitySource becomes
  //        UNKNOWN on load; one with a corrupted value is also normalized to
  //        UNKNOWN. Corrupting in-memory state and saving through the app's
  //        own saveState() (rather than writing IndexedDB out from under the
  //        live page) avoids a race with the page's own beforeunload
  //        autosave, which would otherwise resave the pre-corruption state
  //        over a direct IndexedDB write before the reload ever reads it. ---
  const mutateResult = await page.evaluate(() => {
    const tables = state.events[0].tables;
    if (tables.length < 2) return { ok: false, count: tables.length };
    delete tables[0].capacitySource; // simulates a pre-this-feature install
    tables[1].capacitySource = "TOTALLY_MADE_UP"; // simulates a corrupted value
    saveState();
    return { ok: true };
  });
  checks.require(mutateResult.ok, "at least two tables exist to mutate for the migration check", mutateResult);
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
  const afterReload = await page.evaluate(() => state.events[0].tables.slice(0, 2).map(t => t.capacitySource));
  checks.equal(afterReload[0], "UNKNOWN",
    "a table with no capacitySource at all (a pre-this-feature install) is honestly backfilled as UNKNOWN, never guessed", afterReload);
  checks.equal(afterReload[1], "UNKNOWN",
    "a table with a corrupted/unrecognised capacitySource is normalized to UNKNOWN on load rather than kept or dropped", afterReload);

  // --- 7. Turkish and English copy exists for all eight sources, not just
  //        the three this build can produce today --------------------------
  const labels = await page.evaluate(() => {
    const keys = ["capacitySource.detectedPhysicalSeats","capacitySource.humanConfirmed","capacitySource.unknown",
      "capacitySource.printedTableCapacity","capacitySource.printedZoneCapacity","capacitySource.printedTotalCapacity",
      "capacitySource.derivedPrintedRule","capacitySource.verifiedVenueMemory"];
    const read = lang => { ui.lang = lang; return keys.map(k => t(k)); };
    const tr = read("tr"), en = read("en");
    return { tr, en, keys };
  });
  checks.ok(labels.tr.every((s, i) => s && s !== labels.keys[i]) && labels.en.every((s, i) => s && s !== labels.keys[i]),
    "all eight capacitySource labels resolve to real text in both languages, not a raw translation key", labels);
  checks.ok(labels.tr.every((s, i) => s !== labels.en[i]),
    "every capacitySource label actually differs between Turkish and English (no copy-pasted English default)", labels);

  // --- 8. Section 11: the Data Provenance Inspector actually renders -------
  //
  // A read-only line on the Floor Plan contextual card is the first (and,
  // for this pass, only) UI surface for this data. It must show the CURRENT
  // source honestly and offer no way to change it from here.
  // Check 6's page.reload() dropped us back to a fresh boot outside any
  // event's workspace -- re-enter it before navigating to a tab.
  await page.evaluate(() => openEvent(state.events[0].id));
  await page.waitForTimeout(300);
  await gotoTab(page, "floor");
  const PROVENANCE = `(function(){
    const box = document.querySelector(".contextual-card-provenance");
    return box ? {
      present: true,
      text: box.textContent.trim(),
      hasInput: !!box.querySelector("input,select,button"),
    } : { present: false };
  })()`;
  const selectTable = async (id) => { await page.evaluate((tid) => { ui.selectedObjectId = tid; render(); }, id); await page.waitForTimeout(200); };

  // tables[0] is UNKNOWN right now (backfilled by check 6's reload).
  const t0 = await page.evaluate(() => state.events[0].tables[0].id);
  await selectTable(t0);
  const unknownView = await page.evaluate(PROVENANCE);
  checks.require(unknownView.present, "selecting a table shows the provenance row on its contextual card", unknownView);
  checks.ok(!unknownView.hasInput,
    "the row is read-only -- no input/select/button lets an operator hand-pick a source from here", unknownView);
  checks.ok(unknownView.text.includes(await page.evaluate(() => t("capacitySource.unknown"))),
    "an UNKNOWN table honestly shows Unknown, not a fabricated fuller story", { unknownView, key: "capacitySource.unknown" });

  // Flip the SAME table's source in memory (no UI action needed to prove the
  // row reads live state) and confirm the row updates to match.
  const detectedView = await page.evaluate((tid) => {
    const table = state.events[0].tables.find(x => x.id === tid);
    table.capacitySource = "DETECTED_PHYSICAL_SEATS";
    render();
    const box = document.querySelector(".contextual-card-provenance");
    return box ? box.textContent.trim() : null;
  }, t0);
  checks.ok(detectedView && detectedView.includes(await page.evaluate(() => t("capacitySource.detectedPhysicalSeats"))),
    "the row reflects the table's CURRENT source, not whatever it opened with", detectedView);

  const humanView = await page.evaluate((tid) => {
    const table = state.events[0].tables.find(x => x.id === tid);
    table.capacitySource = "HUMAN_CONFIRMED";
    render();
    const box = document.querySelector(".contextual-card-provenance");
    return box ? box.textContent.trim() : null;
  }, t0);
  checks.ok(humanView && humanView.includes(await page.evaluate(() => t("capacitySource.humanConfirmed"))),
    "and updates again when the source changes a second time", humanView);

  // --- 9. the same Inspector on a sofa/bench/banquette's seat count --------
  //
  // seatsConfidence ("verified"/"unverified") is the analogous fact for
  // furniture whose pax cannot be read off a drawing (src/app-v8.js's
  // UNVERIFIED_SEATING). Same discipline: shown honestly, never editable
  // from this card.
  const sofaId = await page.evaluate(() => {
    const e = state.events[0];
    const sofa = { id: "sofa_prov_test", type: "sofa", label: "Sofa", x: 300, y: 300,
      width: 80, height: 40, rotation: 0, locked: false, seats: null, seatsConfidence: "unverified" };
    e.venueObjects = [...(e.venueObjects || []), sofa];
    touchEvent(e); render();
    return sofa.id;
  });
  await selectTable(sofaId);
  const unverifiedSofa = await page.evaluate(PROVENANCE);
  checks.require(unverifiedSofa.present, "an unverified-seating object also shows a provenance row", unverifiedSofa);
  checks.ok(!unverifiedSofa.hasInput, "read-only here too", unverifiedSofa);
  checks.ok(unverifiedSofa.text.includes(await page.evaluate(() => t("inspector.seatsUnverified"))),
    "and reports the seat count as unverified rather than implying zero", unverifiedSofa);

  // A real bug found by the mandatory post-code screenshot pass: the card's
  // OWN HEADER (not the provenance row) reads bulk.type.<type> for every
  // venue object type, but sofa/bench/banquette only had teach.type.* copy
  // (reachable through Assisted Detection review) until this Inspector
  // became the first thing that renders this card for a COMMITTED object of
  // one of those types -- the header showed the raw key.
  const headerLeaks = await page.evaluate(() => {
    const out = {};
    for (const lang of ["en", "tr"]) {
      ui.lang = lang; render();
      out[lang] = document.querySelector(".contextual-card-head span")?.textContent.trim() || null;
    }
    ui.lang = "en"; render();
    return out;
  });
  const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+/i;
  checks.ok(headerLeaks.en && !KEY.test(headerLeaks.en) && headerLeaks.tr && !KEY.test(headerLeaks.tr),
    "the card's own header names a sofa in real words too, not a raw bulk.type.sofa key", headerLeaks);
  checks.ok(headerLeaks.en !== headerLeaks.tr, "and the two languages actually differ", headerLeaks);

  // Also found by the same pass: Turkish's longer strings ("BURADAKİ KOLTUK",
  // "DOĞRULANMADI") overflowed the fixed-width card. The row's OWN box
  // stayed at its assigned width the whole time -- a nowrap flex child that
  // cannot shrink below its content's minimum size overflows the box
  // visually without the box itself reporting a wider bounding rect, which
  // is exactly what let this bug through a first, weaker version of this
  // check. Measuring each CHILD element (the label, value, and confidence
  // word) against the card's own right edge is what actually catches it.
  const overflow = await page.evaluate(() => {
    ui.lang = "tr"; render();
    const card = document.querySelector(".contextual-card");
    const row = document.querySelector(".contextual-card-provenance");
    if (!card || !row) return null;
    const cardRight = card.getBoundingClientRect().right;
    const childRights = [...row.children].map(el => el.getBoundingClientRect().right);
    ui.lang = "en"; render();
    return { cardRight, childRights, childCount: row.children.length };
  });
  checks.require(overflow && overflow.childCount >= 2,
    "the provenance row and at least two child elements were found for the overflow measurement", overflow);
  checks.ok(overflow.childRights.every(right => right <= overflow.cardRight + 0.5),
    "in Turkish, none of the row's label/value/confidence elements render past the card's own right edge", overflow);

  const verifiedSofa = await page.evaluate((id) => {
    const o = state.events[0].venueObjects.find(x => x.id === id);
    o.seats = 4; o.seatsConfidence = "verified";
    render();
    const box = document.querySelector(".contextual-card-provenance");
    return box ? box.textContent.trim() : null;
  }, sofaId);
  checks.ok(verifiedSofa && verifiedSofa.includes("4") && verifiedSofa.includes(await page.evaluate(() => t("inspector.seatsVerified"))),
    "once a real count is set, the row shows the number and Verified", verifiedSofa);

  // A regular table-type venue object (not sofa/bench/banquette) never shows
  // this row at all -- seatsConfidence is specifically for the furniture
  // types whose pax genuinely cannot be read off a drawing.
  const plainObjectId = await page.evaluate(() => {
    const e = state.events[0];
    const obj = { id: "plant_prov_test", type: "plant", label: "Plant", x: 400, y: 400,
      width: 30, height: 30, rotation: 0, locked: false };
    e.venueObjects = [...(e.venueObjects || []), obj];
    touchEvent(e); render();
    return obj.id;
  });
  await selectTable(plainObjectId);
  const plainView = await page.evaluate(PROVENANCE);
  checks.ok(!plainView.present,
    "an ordinary venue object with no seat-count concept shows no provenance row at all", plainView);
}
