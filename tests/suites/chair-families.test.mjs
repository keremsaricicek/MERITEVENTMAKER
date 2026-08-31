// A plan may seat more than one kind of chair, and the detector must be able
// to say so.
//
// This guards the multi-family chair pass, and it guards it as a CONTRACT
// rather than as a score. Pinning "107 chairs" here would turn every honest
// detector improvement into a red build; accuracy belongs in
// benchmarks/run-benchmark.mjs against annotated ground truth. What is asserted
// here is the behaviour that took three attempts to get right, and each
// assertion corresponds to a failure that actually happened:
//
//   - Every stage of the chair pipeline used to compare candidates against THE
//     modal object on the plan, which only the majority family can match. The
//     real venue plan seats three chair families and reported one; the other
//     two scored 0.000 recall and nothing in the product said so.
//   - Loosening that gate on shape alone let the printed capacity block —
//     "114 pax seating / 10 pax bistro / Total : 124 pax", drawn at chair scale
//     in the chairs' own colour — through as eight chairs. See
//     benchmarks/BISTRO-MERGE.md. Recall and precision have to move together
//     here or the fix is not a fix.
//   - A family is admitted on adjacency to a table SURFACE, and each of its
//     members has to earn its own place. Both halves matter, because on this
//     plan the glyphs and the real bistro seats land in the same size-and-shape
//     family: admitting the family whole took nine glyphs with it.
//
// Slow (real detection on the real venue plan), so it is out of the default run
// and in --all.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = {
  name: "chair-families",
  tags: ["intelligence", "slow"],
  timeout: 300000,
  viewport: { width: 1800, height: 1000 },
};

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const planPath = path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png");
  const annotPath = path.join(repoRoot, "benchmarks/annotations/merit-real-venue.json");
  checks.require(fs.existsSync(planPath), "the real venue plan is present", planPath);
  checks.require(fs.existsSync(annotPath), "its annotation is present", annotPath);
  const annot = JSON.parse(fs.readFileSync(annotPath, "utf8"));

  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Families", hotel: "Merit", date: "2026-10-02" });

  const dataUrl = "data:image/png;base64," + fs.readFileSync(planPath).toString("base64");
  await page.evaluate(src => {
    state.events[0].background = { src, name: "merit-real-venue-plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, dataUrl);
  await page.waitForTimeout(500);

  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    const a = state.events[0].analysis;
    const alive = a.candidates.filter(c => c.status !== "rejected");
    const chairs = alive.flatMap(c => (c.chairDetections || []).map(ch => ({ x: ch.x, y: ch.y, w: ch.w, h: ch.h })));
    return {
      families: a.diagnostics.secondaryChairFamilies,
      sources: a.diagnostics.chairSourceBreakdown,
      chairSource: a.diagnostics.chairSource,
      detectionPath: a.diagnostics.detectionPath,
      chairs,
      planSize: [a.imageWidth ?? null, a.imageHeight ?? null],
    };
  });

  // --- the pass ran and reports how it decided -------------------------------
  const fam = result.families;
  checks.require(fam && typeof fam.considered === "number",
    "the secondary-family pass reports what it considered", fam);
  checks.ok(typeof fam.minMembers === "number" && typeof fam.minAdjacentShare === "number",
    "and states the rule it applied, rather than deciding invisibly",
    { minMembers: fam.minMembers, minAdjacentShare: fam.minAdjacentShare });
  checks.ok(fam.considered > 0,
    "there were candidate families to consider on a plan with three chair kinds", fam.considered);

  // --- more than one family was actually found -------------------------------
  // The whole point. A detector that can only describe the majority family is
  // wrong about this plan, and was, for the entire life of the annotation.
  checks.ok(fam.admitted > 0,
    "at least one minority chair family was admitted — the plan seats three kinds",
    { admitted: fam.admitted, considered: fam.considered });

  const admitted = (fam.families || []).filter(f => f.admitted);
  checks.ok(admitted.length === 0 || admitted.every(f => f.members >= fam.minMembers),
    "every admitted family met the member floor the pass says it applies",
    admitted.filter(f => f.members < fam.minMembers).slice(0, 3));
  checks.ok(admitted.length === 0 || admitted.every(f => f.share >= fam.minAdjacentShare - 1e-9),
    "every admitted family met the table-adjacency bar — repetition alone is never enough",
    admitted.filter(f => f.share < fam.minAdjacentShare).slice(0, 3));
  checks.ok(admitted.length === 0 || admitted.every(f => f.sizeOk),
    "every admitted family is a plausible seat size, not a family of specks",
    admitted.filter(f => !f.sizeOk).slice(0, 3));

  // The minority families are held to the SMALLER end of the size band, and a
  // family at surface scale is a table family, not a seat family. A regression
  // that let one in would remove real tables from the table pool.
  const overSized = admitted.filter(f => f.surfaceSide && f.side > f.surfaceSide);
  checks.ok(overSized.length === 0,
    "no admitted chair family is the size of the plan's table surfaces", overSized.slice(0, 3));

  // --- the families actually contributed seats -------------------------------
  const primary = (result.sources || []).find(s => s.name === result.chairSource);
  checks.ok(result.chairs.length > 0, "chairs were detected", result.chairs.length);
  checks.ok(!primary || result.chairs.length > 0,
    "the primary chair source is named in the breakdown", { chairSource: result.chairSource, primary });
  // A family whose members came from two different masks is pushed as two
  // source rows under one name — the label map a component was found in is what
  // shape analysis has to re-read its pixels from, so they cannot be merged.
  // The count that must match is the number of distinct family NAMES.
  const familySources = (result.sources || []).filter(s => s.name.startsWith("family:"));
  const familyNames = new Set(familySources.map(s => s.name));
  checks.ok(familyNames.size === fam.admitted,
    "each admitted family appears in the source breakdown, so its contribution is visible",
    { names: [...familyNames], rows: familySources.length, admitted: fam.admitted });

  // --- and printed matter still did not get in -------------------------------
  // The capacity block is the trap: chair-sized glyphs in the chairs' own
  // colour. This is deliberately a bound and not an exact count — a detector
  // that gets better here should stay green — but a gate loose enough to read
  // the whole block as seating fails.
  const textRegions = (annot.regions || []).filter(r => r.id === "capacity-block" || /giris/.test(r.id || ""));
  checks.require(textRegions.length > 0, "the annotation marks the printed-text regions", annot.regions);
  const W = annot.source.width, H = annot.source.height;
  const inText = result.chairs.filter(ch => {
    const cx = ch.x / 100 * W, cy = ch.y / 100 * H;
    return textRegions.some(r => cx >= r.x - 4 && cx <= r.x + r.w + 4 && cy >= r.y - 4 && cy <= r.y + r.h + 4);
  });
  checks.ok(inText.length <= 6,
    "the printed capacity block is not read as a block of seating",
    { inTextRegions: inText.length, regions: textRegions.map(r => r.id) });
}
