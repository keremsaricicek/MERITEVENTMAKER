// The 9/10 acceptance contract for plan understanding, as numbers a run is
// checked against. CONTRACT.md says why each number is what it is; this file
// is the same table in a form that can fail. Written on 2026-10-04 BEFORE any
// of the work it judges, against the baseline measured at 65808d5, and not to
// be loosened to pass: a threshold changes only with a shown error in it.
//
// Every row is checked per plan, on the AUTO view — what an operator gets by
// confirming the result as offered. Held-back candidates never count toward a
// pass: a real table the product did not offer is a miss.

const PRESENT = {
  table: { precision: 0.97, recall: 0.97, countError: 0.03 },
  bistro: { precision: 0.9, recall: 0.9 },
  chair: { precision: 0.95, recall: 0.95, countError: 0.05 },
  sofa: { precision: 0.9, recall: 0.9 },
  stage: { precision: 0.9, recall: 0.9 },
  column: { precision: 0.9, recall: 0.9 },
  bar: { precision: 0.9, recall: 0.9 },
  entrance: { precision: 0.9, recall: 0.9 },
  loca: { precision: 0.9, recall: 0.9 },
};

export const THRESHOLDS = {
  classes: PRESENT,
  absentClassMaxFalsePositives: 0,
  elementShapeIoUMedian: 0.5,
  links: { accuracy: 0.97, endToEnd: 0.92 },
  groups: { accuracy: 0.9, chairCountExactShare: 0.9, spuriousMax: 1 },
  geometry: { tableCentreErrorP90Share: 0.15, tableIoUP10: 0.6, tableTypeAccuracy: 0.97, tableRotationErrorP90Deg: 5, chairCentreErrorP90Share: 0.35 },
  direction: { precision: 0.95, coverage: 0.8 },
  printed: { tableNumberRecall: 0.9, tableNumberVerifiedPrecision: 0.99, capacityTotalCorrect: true },
  capacity: { heldBackLeakMax: 0, drawnChairsMaxError: 0.05, writtenTotalCorrect: true },
  corrections: { perHundredObjectsMax: 5 },
  // Added 2026-10-04, still before any fix: the plan as WRITTEN to the floor
  // plan, mapped back onto the drawing. Same bars as the analysis geometry —
  // committing must not lose what detection got right.
  digital: { tableCentreErrorP90Share: 0.15, tableAspectLogErrorP90: 0.1, tableSizeErrorP90: 0.15, chairCentreErrorP90Share: 0.35 },
  run: { analysisMs: { "merit-real-venue": 15000, "ornek-symbolic": 60000 }, peakHeapMB: 1024, planDataEgress: 0 },
};

function row(rows, plan, id, value, op, threshold) {
  let pass;
  if (value == null) pass = false;
  else if (op === ">=") pass = value >= threshold;
  else if (op === "<=") pass = value <= threshold;
  else pass = value === threshold;
  rows.push({ plan, id, value, op, threshold, pass });
}

export function evaluateContract(report) {
  const T = THRESHOLDS, rows = [];
  for (const p of report.plans) {
    const id = p.planId;
    for (const [cls, t] of Object.entries(T.classes)) {
      const c = p.classes[cls];
      if (!c) continue;
      if (c.gt > 0) {
        row(rows, id, `${cls}.precision`, c.precision, ">=", t.precision);
        row(rows, id, `${cls}.recall`, c.recall, ">=", t.recall);
        if (t.countError != null) row(rows, id, `${cls}.countError`, c.countError, "<=", t.countError);
        if (c.shapeIoU && c.shapeIoU.length && cls !== "chair" && cls !== "table" && cls !== "bistro") {
          const s = [...c.shapeIoU].sort((a, b) => a - b);
          row(rows, id, `${cls}.shapeIoUMedian`, s[s.length >> 1], ">=", T.elementShapeIoUMedian);
        }
      } else {
        row(rows, id, `${cls}.absentFalsePositives`, c.fp, "<=", T.absentClassMaxFalsePositives);
      }
    }
    if (p.links.groundTruth) {
      row(rows, id, "links.accuracy", p.links.accuracy, ">=", T.links.accuracy);
      row(rows, id, "links.endToEnd", p.links.endToEnd, ">=", T.links.endToEnd);
    }
    if (p.groups.groundTruth) {
      row(rows, id, "groups.accuracy", p.groups.accuracy, ">=", T.groups.accuracy);
      row(rows, id, "groups.chairCountExactShare", +(p.groups.chairCountExact / p.groups.groundTruth).toFixed(3), ">=", T.groups.chairCountExactShare);
    }
    row(rows, id, "groups.spurious", p.groups.spuriousGroups, "<=", T.groups.spuriousMax);
    const g = p.geometry;
    for (const [k, v] of Object.entries(T.geometry)) {
      if (k.startsWith("chair") && !p.classes.chair.gt) continue;
      row(rows, id, `geometry.${k}`, g[k], /Share$|Deg$/.test(k) && !/IoU|Accuracy/.test(k) ? "<=" : ">=", v);
    }
    if (p.direction.groundTruth) {
      row(rows, id, "direction.precision", p.direction.precision, ">=", T.direction.precision);
      row(rows, id, "direction.coverage", p.direction.coverage, ">=", T.direction.coverage);
    }
    if (p.printed.tableNumbers.legibleInTruth) {
      row(rows, id, "printed.tableNumberRecall", p.printed.tableNumbers.recall, ">=", T.printed.tableNumberRecall);
      row(rows, id, "printed.tableNumberVerifiedPrecision", p.printed.tableNumbers.verifiedPrecision, ">=", T.printed.tableNumberVerifiedPrecision);
    }
    if (p.printed.capacityTotal.truth != null) row(rows, id, "printed.capacityTotalCorrect", p.printed.capacityTotal.correct, "==", true);
    row(rows, id, "capacity.heldBackLeak", p.capacity.heldBackLeak, "<=", T.capacity.heldBackLeakMax);
    if (p.capacity.drawnChairs.truth) {
      const e = p.capacity.drawnChairs.product == null ? null : +(Math.abs(p.capacity.drawnChairs.product - p.capacity.drawnChairs.truth) / p.capacity.drawnChairs.truth).toFixed(3);
      row(rows, id, "capacity.drawnChairsError", e, "<=", T.capacity.drawnChairsMaxError);
    }
    if (p.capacity.writtenTotal.truth != null) row(rows, id, "capacity.writtenTotalCorrect", p.capacity.writtenTotal.product === p.capacity.writtenTotal.truth, "==", true);
    if (p.digital) {
      row(rows, id, "digital.committedEqualsOffered", p.digital.committedTables === p.classes.table.det, "==", true);
      for (const [k, v] of Object.entries(T.digital)) {
        if (k.startsWith("chair") && !p.classes.chair.gt) continue;
        row(rows, id, `digital.${k}`, p.digital[k], "<=", v);
      }
    }
    row(rows, id, "corrections.perHundredObjects", p.corrections.perHundredObjects, "<=", T.corrections.perHundredObjectsMax);
    row(rows, id, "run.analysisMs", p.run.analysisMs, "<=", T.run.analysisMs[id] ?? 60000);
    row(rows, id, "run.peakHeapMB", p.run.peakHeapMB, "<=", T.run.peakHeapMB);
    row(rows, id, "run.planDataEgress", p.run.planDataEgress, "<=", T.run.planDataEgress);
  }
  return { total: rows.length, passed: rows.filter(r => r.pass).length, rows };
}
