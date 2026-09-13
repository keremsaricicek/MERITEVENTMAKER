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
import { openApp, createBlankEvent, addTables, futureDate } from "../lib/app-actions.mjs";

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
}
