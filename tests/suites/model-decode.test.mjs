// One object, one box: the local model's second peak on a table it already
// found (E3, training/README.md, 2026-10-17).
//
// The decoder keeps every 3×3 local maximum of the heatmap, so a broad peak on a
// large table gave two boxes. Measured on generated val + held-out L4–L7
// (training/diagnose_fp.py): 43 of v2's 80 false tables and 132 of a later
// candidate's 148 were such second peaks, not look-alikes. A detection whose
// centre lies within half the short side of a STRONGER one of the same group is
// dropped; round and rectangular tables are one group. The rule is checked here
// on boxes built in the test, so it is the rule that is tested — training's
// `suppress_close` is the same lines in Python.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "model-decode",
  tags: ["intelligence", "detection"],
  timeout: 30000,
  viewport: { width: 1000, height: 700 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const out = await page.evaluate(() => {
    const S = MeritPlanModel.suppressClose;
    const d = (k, cx, cy, w, h, score) => ({ k, cx, cy, w, h, score });
    return {
      twoPeaks: S([d(1, 100, 100, 60, 40, 0.9), d(1, 108, 102, 58, 40, 0.7)]).length,
      crossClass: S([d(0, 100, 100, 50, 50, 0.8), d(1, 104, 99, 50, 50, 0.6)]).map((x) => x.k),
      pushedTogether: S([d(1, 100, 100, 50, 50, 0.9), d(1, 150, 100, 50, 50, 0.8)]).length,
      chairAtTable: S([d(1, 100, 100, 60, 60, 0.9), d(2, 100, 125, 20, 20, 0.8)]).length,
      chairsSideBySide: S([d(2, 100, 100, 20, 20, 0.9), d(2, 121, 100, 20, 20, 0.8)]).length,
      weakerFirstKept: S([d(1, 100, 100, 60, 60, 0.9), d(1, 112, 100, 30, 30, 0.95)].sort((a, b) => b.score - a.score)).map((x) => x.score),
    };
  });
  checks.equal(out.twoPeaks, 1, "two peaks on one table become one box");
  checks.equal(out.crossClass, [0], "a round and a rectangular box on one spot are one table, the stronger kept");
  checks.equal(out.pushedTogether, 2, "two tables pushed edge to edge (centres one side apart) both stay");
  checks.equal(out.chairAtTable, 2, "a chair at a table is another group and stays");
  checks.equal(out.chairsSideBySide, 2, "two chairs side by side both stay");
  checks.equal(out.weakerFirstKept, [0.95], "the stronger box decides, by score, not by size");
}
