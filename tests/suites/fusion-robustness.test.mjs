// Two rules that keep the local model's tables alive on a degraded rendering
// (benchmarks/robustness/README.md, 2026-10-17). Each is checked on inputs built
// here, so the rule itself is what is tested, not one plan's pixels.
//
// 1. Fusion's size reference is the median of the MODEL's boxes for the tables
//    BOTH witnesses see, when there are at least five. On the low-resolution
//    round trip of the Golden plan the classical proposals — including the
//    ones on the real tables — were fragments, their median was a fragment's
//    size, and 15 of the model's real tables were refused as "off size".
// 2. A table the model added confidently, at the plan's table size (the ones
//    fusion selects), is not deleted by text suppression. On the darkened
//    rendering Tesseract read word boxes off the table fills and deleted 14 of
//    the 16 real tables the model had added.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "fusion-robustness",
  tags: ["intelligence", "detection"],
  timeout: 60000,
  viewport: { width: 1200, height: 800 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);
  const out = await page.evaluate(() => {
    const W = 1000, H = 1000;
    let n = 0;
    const uid = (p) => `${p}-${++n}`;
    const box = (cx, cy, s) => ({ x: (cx - s / 2) / W * 100, y: (cy - s / 2) / H * 100, w: s / W * 100, h: s / H * 100 });
    const table = (cx, cy, s) => ({ id: uid("c"), kind: "table", type: "square", ...box(cx, cy, s), rotation: 0, status: "unreviewed", selected: true, chairDetections: [] });
    // five real tables both witnesses see (45 px), and ten classical fragments (20 px) nobody else sees
    const agreed = [0, 1, 2, 3, 4].map((i) => table(100 + i * 120, 100, 45));
    const fragments = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => table(100 + i * 80, 400, 20));
    const det = (cx, cy, s, score) => ({ cls: "table_rect", cx, cy, w: s, h: s, score });
    const model = { available: true, detections: [...agreed.map((_, i) => det(100 + i * 120, 100, 45, 0.9)), det(500, 700, 45, 0.9)] };
    const fused = MeritPlanModelFusion.fuse([...agreed, ...fragments], [], model, { width: W, height: H, uid });
    // the classical boxes ON the agreed tables are fragments too: the model's own boxes still set the size
    const fragmentsOnReal = [0, 1, 2, 3, 4].map((i) => table(100 + i * 120, 100, 22));
    const fusedFragmentBoxes = MeritPlanModelFusion.fuse(fragmentsOnReal, [], model, { width: W, height: H, uid });
    // the same plan with only the fragments as classical tables: nothing agreed, the old reference applies
    const fusedFragmentsOnly = MeritPlanModelFusion.fuse(fragments.map((f) => ({ ...f })), [], { available: true, detections: [det(500, 700, 45, 0.9)] }, { width: W, height: H, uid });

    // text suppression: a word box covering a model-added table, and the same word over a classical table
    const added = fused.added[0];
    const classical = table(800, 800, 45);
    const words = [added, classical].map((c) => ({ text: "XX", bbox: { x0: c.x / 100 * W, y0: c.y / 100 * H, x1: (c.x + c.w) / 100 * W, y1: (c.y + c.h) / 100 * H } }));
    const sup = MeritSuppressTextFalsePositives([added, classical], words, W, H);
    const unselected = { ...added, selected: false };
    const supUnselected = MeritSuppressTextFalsePositives([unselected], words.slice(0, 1), W, H);
    return {
      added: fused.added.length, offSize: fused.offSize,
      addedFragmentBoxes: fusedFragmentBoxes.added.length, offSizeFragmentBoxes: fusedFragmentBoxes.offSize,
      addedFragmentsOnly: fusedFragmentsOnly.added.length, offSizeFragmentsOnly: fusedFragmentsOnly.offSize,
      addedSelected: !!(added && added.selected), addedConsistent: !!(added && added.evidence && added.evidence.consistentSize),
      keptAdded: sup.kept.includes(added), removedClassical: sup.removed.includes(classical),
      unselectedRemoved: supUnselected.removed.length,
    };
  });

  checks.equal(out.added, 1, "a model table at the agreed tables' size is added, though most classical proposals are fragments");
  checks.equal(out.offSize, 0, "and it is not refused as off size");
  checks.equal(out.addedFragmentBoxes, 1, "the reference is the model's boxes of the agreed tables, not the classical fragments drawn on them");
  checks.equal(out.offSizeFragmentBoxes, 0, "so the real table is not refused as off size");
  checks.equal(out.addedFragmentsOnly, 0, "with fewer than five agreed tables the old reference (the classical median) still applies");
  checks.equal(out.offSizeFragmentsOnly, 1, "and refuses the same table as off size");
  checks.ok(out.addedSelected && out.addedConsistent, "the addition is selected and marked consistent in size");
  checks.ok(out.keptAdded, "text suppression keeps a selected, size-consistent model-added table under a word box");
  checks.ok(out.removedClassical, "but still removes a classical table with no seats under the same word box");
  checks.equal(out.unselectedRemoved, 1, "and an unselected model addition is not exempt");
}
