// A PRINTED CAPACITY RULE GIVES A SYMBOL ITS CAPACITY — ONLY WHERE IT APPLIES,
// NEVER AS CHAIRS, AND ALWAYS SAYING SO.
//
// §5 of the master programme. Measured before: a table committed from a
// symbolic plan got capacity 1 and source UNKNOWN even when the drawing prints
// "SALON : 166 * 12 : 1992 PAX" and the self-check had verified that
// multiplication — so a 166-table room arrived with 166 seats, and the one
// number on the page that says how many people sit at a table was ignored.
//
// Everything here goes through the REAL commit button. The capacity rule is
// produced by the product's own OCR-text parser (buildPlanIntelligence over the
// ORNEK capacity block), not written into the analysis by hand. Two older
// checks — in `capacity-provenance` and `physical-logical-seat-separation` —
// re-implemented commitCandidates()'s expression inside the test and tested
// the copy; this suite is what they now defer to.
import { openApp, settle } from "../lib/app-actions.mjs";

export const meta = { name: "capacity-rule-commit", tags: ["business", "intelligence", "fast"], timeout: 150000 };

const ORNEK_BLOCK = "SALON : 166 * 12 : 1992 PAX\nLOCALAR : 72 PAX\nTOPLAM : 2064 PAX";

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });

  // Plant an analysis shaped as the pipeline writes it, then press Commit.
  let lastToast = "";
  const commit = async ({ kind, ocrText = null, tables = 3, chairsOn = [] }) => {
    await page.evaluate(({ kind, ocrText, tables, chairsOn }) => {
      const candidates = [];
      for (let i = 0; i < tables; i++) candidates.push({ id: "cand" + i, kind: "table", type: "round", x: 10 + i * 12, y: 30, w: 6, h: 6, rotation: 0,
        confidence: 0.9, status: "unreviewed", selected: true, printedNumber: null, evidence: { geometry: 0.8, chairs: 0, repetition: 1 },
        chairDetections: chairsOn.includes(i) ? [0, 1, 2, 3].map((s) => ({ x: 10 + i * 12 + (s % 2) * 6, y: 30 + (s > 1 ? 6 : -1), w: 1, h: 1, rotation: 0 })) : [] });
      const event = { id: "ev-" + Math.random().toString(36).slice(2), name: "Kural", hotel: "Merit", salon: "", date: new Date(Date.now() + 90 * 864e5).toLocaleDateString("en-CA"), status: "Planning",
        tables: [], venueObjects: [], guests: [], background: { src: "", visible: true }, audit: [], handoverNotes: [] };
      event.analysis = { id: "an", planHash: "h", engine: "ASSISTED_DETECTION", trainedModel: false, createdAt: new Date().toISOString(),
        imageWidth: 1000, imageHeight: 800, threshold: 128, candidates, missed: [], groupingDecisions: [], comparison: { added: tables, removed: 0, changed: 0 },
        memoryReapplied: 0, memoryRestored: 0, memoryConflicts: [], ocr: { available: !!ocrText, engine: "tesseract.js" }, ocrText, timings: {},
        diagnostics: { representation: { kind, associationRate: kind === "PHYSICAL" ? 0.95 : 0.05, evidence: {} } } };
      event.analysis.planIntelligence = globalThis.buildPlanIntelligence(event, ocrText);
      state.events = [event]; ui.activeEventId = event.id; ui.screen = "workspace"; ui.tab = "floor"; ui.planMode = "review"; ui.selectedCandidateId = null; render();
    }, { kind, ocrText, tables, chairsOn });
    await settle(page);
    await page.click('[data-review-action="commit"]');
    await page.waitForSelector(".toast", { timeout: 5000 }).catch(() => null);
    lastToast = await page.evaluate(() => [...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" | "));
    await settle(page);
    return page.evaluate(() => activeEvent().tables.map((t) => ({ capacity: t.capacity, source: t.capacitySource, chairs: (t.chairs || []).length,
      evidence: t.capacityEvidence || null, physical: t.hasPhysicalSeats })));
  };

  // --- 1. the parser really produced the rule ------------------------------
  const rule = await page.evaluate((text) => {
    const e = { analysis: { candidates: [], groupingDecisions: [] } };
    return globalThis.buildPlanIntelligence(e, text)?.capacityAudit?.rule || null;
  }, ORNEK_BLOCK);
  checks.equal(rule && [rule.units, rule.perUnit, rule.total], [166, 12, 1992], "the product's own parser reads the ORNEK block as 166 × 12 = 1992");

  // --- 2. symbolic plan + verified rule: the symbols get 12, not chairs ----
  let t = await commit({ kind: "SYMBOLIC", ocrText: ORNEK_BLOCK, tables: 3 });
  checks.equal(t.map((x) => x.capacity), [12, 12, 12], "a symbolic plan's committed tables take the printed 12 per table");
  checks.ok(t.every((x) => x.source === "DERIVED_PRINTED_RULE"), "tagged DERIVED_PRINTED_RULE", t);
  checks.ok(t.every((x) => x.chairs === 0 && x.physical === false), "and NOT ONE chair is created: 12 is a logical seat space, the drawing drew none", t);
  checks.ok(t.every((x) => x.evidence && x.evidence.rule === "166 × 12 = 1992" && x.evidence.source === "DERIVED_PRINTED_RULE" && x.evidence.appliesTo === 3 && x.evidence.confirmedBy === null),
    "each carries its evidence: the rule, the source, how many symbols it was applied to, and that no person has confirmed it", t[0]);
  checks.equal(await page.evaluate(() => MeritSeatModel.seatingCapacity(activeEvent())), 36, "and the room now seats 36, not 3");
  checks.ok(/masa başına 12/.test(lastToast) && !/Sandalye koordinatları/.test(lastToast),
    "and the confirmation says the capacity came from the printed rule — not that chair coordinates were preserved, on a plan with no chairs", lastToast);

  // --- 3. the table's card says where the number came from ----------------
  await page.evaluate(() => { const e = activeEvent(); ui.planMode = "plan"; ui.selectedObjectId = e.tables[0].id; ui.selectedObjectIds = [e.tables[0].id]; render(); });
  await settle(page);
  checks.ok(await page.evaluate(() => /166 × 12 = 1992/.test(document.querySelector("[data-capacity-evidence]")?.textContent || "")),
    "the table's own card shows the rule the capacity was derived from");

  // --- 4. a person's number replaces it, and the history is kept ----------
  const changed = await page.evaluate(() => { const e = activeEvent(), tb = e.tables[0]; const ok = setTableCapacity(e, tb, 10); return { ok, cap: tb.capacity, source: tb.capacitySource, ev: tb.capacityEvidence }; });
  checks.ok(changed.ok && changed.cap === 10 && changed.source === "HUMAN_CONFIRMED", "a person setting 10 makes it HUMAN_CONFIRMED", changed);
  checks.ok(changed.ev && changed.ev.confirmedBy === "person" && changed.ev.previous === 12, "and the evidence records it was 12 from the rule before a person changed it", changed.ev);

  // --- 5. every refusal: the rule does NOT apply ---------------------------
  t = await commit({ kind: "PHYSICAL", ocrText: ORNEK_BLOCK, tables: 3, chairsOn: [0] });
  checks.equal(t.map((x) => [x.source, x.capacity]), [["DETECTED_PHYSICAL_SEATS", 4], ["UNKNOWN", 1], ["UNKNOWN", 1]],
    "on a plan that DRAWS seats the rule gives nothing: a table is counted by its chairs, a seatless one stays UNKNOWN");
  checks.ok(/Sandalye koordinatları korundu/.test(lastToast), "and there, where chairs were committed, the confirmation says their coordinates were kept", lastToast);
  t = await commit({ kind: "SYMBOLIC", ocrText: null, tables: 3 });
  checks.ok(t.every((x) => x.source === "UNKNOWN" && x.capacity === 1), "with no printed rule, a symbol stays UNKNOWN at 1", t);
  checks.ok(lastToast && !/Sandalye/.test(lastToast) && !/masa başına/.test(lastToast), "and the confirmation claims neither chairs nor a rule", lastToast);
  t = await commit({ kind: "NEEDS_REVIEW", ocrText: ORNEK_BLOCK, tables: 3 });
  checks.ok(t.every((x) => x.source === "UNKNOWN"), "when the plan's kind is undecided, the rule is not applied", t);
  t = await commit({ kind: "SYMBOLIC", ocrText: "SALON : 2 * 12 : 24 PAX\nTOPLAM : 24 PAX", tables: 3 });
  checks.ok(t.every((x) => x.source === "UNKNOWN"), "more seatless tables (3) than the rule says the room has (2): the rule is not describing them", t);
  t = await commit({ kind: "SYMBOLIC", ocrText: "SALON : 10 * 150 : 1500 PAX\nTOPLAM : 1500 PAX", tables: 3 });
  checks.ok(t.every((x) => x.source === "UNKNOWN"), "150 per table is not a number a person could type (≤ 99): refused", t);

  // --- 6. a plan figure is never a table's ---------------------------------
  const levels = await page.evaluate(() => {
    const CP = MeritCapacityProvenance;
    return { table: CP.normalizeForTable("PRINTED_TOTAL_CAPACITY"), zone: CP.normalizeForTable("PRINTED_ZONE_CAPACITY"), kept: CP.normalizeForTable("DERIVED_PRINTED_RULE"),
      stated: CP.planStatedCapacity(globalThis.buildPlanIntelligence({ analysis: { candidates: [], groupingDecisions: [] } }, "SALON : 166 * 12 : 1992 PAX\nLOCALAR : 72 PAX\nTOPLAM : 2064 PAX")?.capacityAudit) };
  });
  checks.equal([levels.table, levels.zone, levels.kept], ["UNKNOWN", "UNKNOWN", "DERIVED_PRINTED_RULE"], "a plan- or zone-level source on a table becomes UNKNOWN; a table-level one is kept");
  // The parser only returns rules that multiply out, but an analysis can come
  // from somewhere else — stored by an older build, or imported — so the
  // decision checks the arithmetic itself rather than trusting its source.
  const stale = await page.evaluate(() => MeritCapacityProvenance.ruleApplication({ rule: { units: 166, perUnit: 12, total: 2000, why: "stored" },
    representationKind: "SYMBOLIC", seatlessTables: 3 }));
  checks.equal([stale.applies, stale.why], [false, "arithmetic"], "a rule whose figures do not multiply out (166 × 12 ≠ 2000) is never applied, whatever produced it");
  checks.ok(levels.stated && levels.stated.source === "PRINTED_TOTAL_CAPACITY" && levels.stated.level === "plan" && levels.stated.total === 2064,
    "the drawing's 2064 is recorded as PRINTED_TOTAL_CAPACITY at PLAN level", levels.stated);
  await commit({ kind: "SYMBOLIC", ocrText: ORNEK_BLOCK, tables: 2 });
  await page.evaluate(() => { ui.tab = "command"; render(); });
  await settle(page);
  checks.ok(await page.evaluate(() => /2064/.test(document.querySelector("[data-plan-stated-capacity]")?.textContent || "")),
    "the Command Center states the drawing's 2064 beside the counted seats, as a plan figure");

  // --- 7. and it survives a save and a reload, with the plan source refused on a table
  await page.evaluate(() => { const e = activeEvent(); e.tables[1].capacitySource = "PRINTED_TOTAL_CAPACITY"; saveState(); });
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => { try { return state.events.length === 1; } catch { return false; } }, null, { timeout: 15000 });
  const after = await page.evaluate(() => state.events[0].tables.map((tb) => [tb.capacitySource, tb.capacity, !!tb.capacityEvidence]));
  checks.equal(after, [["DERIVED_PRINTED_RULE", 12, true], ["UNKNOWN", 12, true]],
    "after a reload the derived table keeps its source and evidence; a table wrongly carrying the plan's source is loaded as UNKNOWN");
}
