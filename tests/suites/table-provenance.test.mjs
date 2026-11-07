// WHERE A TABLE'S FACTS CAME FROM IS REACHABLE FROM THE TABLE.
//
// `merit-ui-quality-gates`: "Where a number came from is reachable — capacity
// provenance, printed numbers, detector source. A figure an operator cannot
// trace is a figure they will not trust."
//
// Measured before (§21 in benchmarks/MASTER-PROGRAMME-STATE.md): of the facts
// shown for a table, only its capacity said where it came from. A table a
// person confirmed from Assisted Detection lost the OCR reading of the number
// printed on its own symbol at the moment of confirmation, and was numbered
// T01, T02… in confirmation order — so a plan printing "42" on a table showed
// "T 01" with nothing to say the two disagree. The fixtures here are SYNTHETIC
// candidates planted through the product's own review screen; nothing claims
// a real plan was read.
import { openApp, createBlankEvent, addTables, futureDate, click, settle } from "../lib/app-actions.mjs";

export const meta = { name: "table-provenance", tags: ["business", "ui", "fast"], timeout: 120000 };

const plant = (page, candidates) => page.evaluate((cands) => {
  const event = state.events[0];
  event.analysis = {
    id: "an-prov", engine: "ASSISTED_DETECTION", trainedModel: false, createdAt: new Date().toISOString(),
    imageWidth: 1000, imageHeight: 800, threshold: 128, candidates: cands, missed: [], groupingDecisions: [],
    comparison: { added: cands.length, removed: 0, changed: 0 }, memoryReapplied: 0, memoryRestored: 0, memoryConflicts: [],
    ocr: { available: false, reason: "not attempted", engine: "tesseract.js" }, ocrText: null, timings: {},
    diagnostics: { representation: { kind: "SYMBOLIC", associationRate: 0, evidence: {} } },
  };
  event.analysis.planIntelligence = globalThis.buildPlanIntelligence(event, null);
  ui.tab = "floor"; ui.planMode = "review"; render();
}, candidates);
const cand = (id, x, printedNumber) => ({ id, kind: "table", type: "round", x, y: 30, w: 8, h: 8, rotation: 0,
  confidence: 0.9, status: "unreviewed", selected: true, chairDetections: [], evidence: { geometry: 0.8, chairs: 0, repetition: 3 }, printedNumber });

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Provenance", hotel: "Merit", date: futureDate() });

  // --- 1. confirmed from detection: origin and the printed reading travel --
  await plant(page, [
    cand("c-verified", 10, { value: 42, state: "VERIFIED", confidence: 0.97, why: "read twice", readings: [42, 42] }),
    cand("c-review", 30, { value: 17, state: "NEEDS_REVIEW", confidence: 0.4, why: "two readings", readings: [17, 11] }),
    cand("c-none", 50, null),
    // Untrusted shape: a reading this build does not know is not carried.
    cand("c-hostile", 70, { value: { $gt: 1 }, state: "OWNED", source: "<img src=x onerror=alert(1)>" }),
  ]);
  await click(page, '[data-review-action="commit"]');
  await settle(page);
  const tables = await page.evaluate(() => state.events[0].tables.map((t) => ({ id: t.id, number: t.number, origin: t.origin, printed: t.printedNumber })));
  checks.equal(tables.map((t) => t.origin), ["DETECTED", "DETECTED", "DETECTED", "DETECTED"], "a table confirmed from Assisted Detection records that it was");
  checks.equal(tables[0].printed, { value: 42, state: "VERIFIED", confidence: 0.97, source: "OCR" },
    "and keeps the OCR reading of the number printed on its own symbol — value, state and source, nothing else");
  checks.equal(tables[1].printed && tables[1].printed.state, "NEEDS_REVIEW", "an unconfirmed reading keeps its state, so it is never shown as certain");
  checks.equal([tables[2].printed, tables[3].printed], [null, null], "no reading, or one of an unknown shape, carries nothing");
  checks.equal(tables[0].number, "T01", "the table's own number is NOT changed by the reading — which number the room uses is a person's decision");

  const card = async (id) => {
    await page.evaluate((id) => { ui.planMode = "plan"; ui.selectedObjectId = id; ui.selectedObjectIds = [id]; render(); }, id);
    await settle(page);
    return page.evaluate(() => ({
      rows: [...document.querySelectorAll(".contextual-card .contextual-card-provenance")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
      mismatch: document.querySelector("[data-printed-mismatch]")?.textContent.trim() || null,
    }));
  };
  const verified = await card(tables[0].id);
  checks.ok(verified.rows.some((r) => r.includes("Destekli Tespit önerdi")),
    "selecting it shows where it came from, in Turkish", verified);
  checks.ok(verified.rows.some((r) => r.includes("42") && r.includes("Doğrulandı")),
    "and what the plan prints on it, with the reading's state", verified);
  checks.ok(verified.mismatch && verified.mismatch.includes("42") && verified.mismatch.includes("T 01"),
    "a VERIFIED printed number that disagrees with the table's own is stated beside it", verified.mismatch);
  const review = await card(tables[1].id);
  checks.ok(!review.mismatch && review.rows.some((r) => r.includes("17") && r.includes("bakması gerekiyor")),
    "an unconfirmed reading is shown as unconfirmed, and never raises a disagreement", review);
  const none = await card(tables[2].id);
  checks.ok(none.rows.some((r) => r.includes("numara okunmadı")) && !none.mismatch, "no reading says so", none);
  checks.ok(await page.evaluate(() => !document.querySelector(".contextual-card img, .contextual-card [onerror]")),
    "an untrusted reading never becomes markup");

  // --- 2. by hand, and copies ------------------------------------------------
  await addTables(page, { quantity: 1 });
  const manual = await page.evaluate(() => state.events[0].tables.at(-1));
  checks.equal(manual.origin, "MANUAL", "a table added by hand records that it was");
  const manualCard = await card(manual.id);
  checks.ok(manualCard.rows.some((r) => r.includes("Elle eklendi")) && !manualCard.rows.some((r) => r.includes("Planda basılı")),
    "and its card says so, without a printed-number row that would mean nothing for it", manualCard);
  await page.evaluate((id) => { ui.selectedObjectId = id; ui.selectedObjectIds = [id]; render(); }, tables[0].id);
  await click(page, '[data-inspector-action="duplicate"]');
  await settle(page);
  const copy = await page.evaluate(() => state.events[0].tables.at(-1));
  checks.equal({ origin: copy.origin, printed: copy.printedNumber ?? null }, { origin: "COPY", printed: null },
    "a copy of a detected table is a person's act: origin COPY, and the original's printed number does NOT come with it");

  // --- 3. older tables say it was not recorded — never a guess --------------
  const legacy = await page.evaluate(() => { const t = state.events[0].tables.at(-1); delete t.origin; render(); return t.id; });
  const legacyCard = await card(legacy);
  checks.ok(legacyCard.rows.some((r) => r.includes("Kaydedilmemiş")), "a table from before this was tracked says 'not recorded' rather than guessing", legacyCard);

  // --- 4. it survives a save and a reload ------------------------------------
  await page.evaluate(() => saveState());
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => { try { return state.events.length === 1; } catch { return false; } }, null, { timeout: 15000 });
  const after = await page.evaluate(() => state.events[0].tables.slice(0, 2).map((t) => ({ origin: t.origin, printed: t.printedNumber })));
  checks.equal(after, [{ origin: "DETECTED", printed: { value: 42, state: "VERIFIED", confidence: 0.97, source: "OCR" } },
    { origin: "DETECTED", printed: { value: 17, state: "NEEDS_REVIEW", confidence: 0.4, source: "OCR" } }], "both facts survive a save and a reload");
}
