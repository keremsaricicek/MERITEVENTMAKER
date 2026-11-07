// Printed matter is not seat evidence (plan-detection-chairs.js, textRegions).
//
// What this pins, on the Golden Plan:
//   WITH THE TEXT MODEL: the capacity block ("114 pax seating", "10 pax
//     bistro", "Total : 124 pax") is printed at chair scale in the chairs'
//     accent colour. Its glyphs used to sit in the same size-and-shape family
//     as the two bistro chairs and the round tables' upright seats, dragging
//     that family to 5 seated of 8 (0.63, under the 0.7 floor) and losing the
//     seats with the glyphs. With the lines the OCR model read handed to the
//     detector, the glyphs are left out of the family, the floors are
//     unchanged, and the seats come back: both bistro tables at the bottom
//     wall carry two chairs.
//   THE LABEL IS NOT A TABLE: the door label GİRİŞ and the column beside it
//     are not offered as a table (Tesseract cannot read that lettering; the
//     model's lines feed text suppression too).
//   WITHOUT IT, NOTHING CHANGES: with the model's engine blocked the family
//     pass gets no text regions and decides exactly as before — that family
//     stays refused at 0.63.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "printed-matter-seats", tags: ["intelligence", "detection"], timeout: 360000, viewport: { width: 1400, height: 900 } };

const READ = () => {
  const a = state.events[0].analysis, W = 1355, H = 788;
  const fam = a.diagnostics.secondaryChairFamilies;
  const tables = a.candidates.filter(c => c.kind === "table").map(c => ({
    cx: (c.x + c.w / 2) / 100 * W, cy: (c.y + c.h / 2) / 100 * H, type: c.type, selected: c.selected === true, seats: (c.chairDetections || []).length }));
  const near = (x, y) => tables.find(t => Math.abs(t.cx - x) < 25 && Math.abs(t.cy - y) < 25) || null;
  return {
    textRegions: fam.textRegions,
    mixed: (fam.families || []).find(f => f.key === "18:1") || null,
    bistroLeft: near(202, 724), bistroRight: near(398, 719),
    doorLabelTable: near(45, 153),
    model: !!(a.ocrModel && a.ocrModel.available),
  };
};

export default async function run({ page, checks, repoRoot, baseUrl }) {
  const plan = "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64");

  await openApp(page, baseUrl, { lang: "en" });
  await createBlankEvent(page, { name: "Printed matter", date: futureDate() });
  await importPlan(page, plan);
  await runDetection(page);
  const on = await page.evaluate(READ);
  checks.require(on.model, "the OCR model read the plan (served from the pinned test cache)");
  checks.ok(on.textRegions >= 5, "the detector was handed the lines the model read", on.textRegions);
  checks.ok(on.mixed && on.mixed.printedExcluded === 3 && on.mixed.admitted === true && on.mixed.share >= 0.7,
    "the three capacity-block glyphs are left out of the seat family, which is admitted on the floors it always had", on.mixed);
  checks.ok(on.bistroLeft && on.bistroLeft.seats === 2 && on.bistroRight && on.bistroRight.seats === 2,
    "both bistro tables at the bottom wall carry their two drawn chairs", { left: on.bistroLeft, right: on.bistroRight });
  checks.ok(!on.doorLabelTable || on.doorLabelTable.selected === false, "the door label and the column beside it are not offered as a table", on.doorLabelTable);

  // ---- without the model: exactly the old decision ------------------------------
  await page.route(/onnxruntime-web|paddle-ocr-onnx-models/, r => r.abort());
  await page.reload();
  await page.waitForFunction(() => typeof globalThis.MeritPaddleOCR === "object");
  await createBlankEvent(page, { name: "No model", date: futureDate() });
  await importPlan(page, plan);
  await runDetection(page);
  const off = await page.evaluate(READ);
  checks.ok(!off.model && off.textRegions === 0, "with the engine blocked the detector gets no text regions", { model: off.model, textRegions: off.textRegions });
  checks.ok(off.mixed && off.mixed.printedExcluded === 0 && off.mixed.admitted === false && Math.abs(off.mixed.share - 0.63) < 0.01,
    "and the mixed family is judged as before: 5 seated of 8, refused", off.mixed);
  await page.unroute(/onnxruntime-web|paddle-ocr-onnx-models/);
}
