// Columns are venue objects, not tables, and finding them is a different job
// from finding furniture.
//
// The column pass reads what the surface filter turned away: solid, repeated,
// compact things made of no table material, standing on a structural grid, that
// nobody sits at. Two failures this suite exists to prevent, both measured on
// benchmarks/fixtures/adversarial-architecture.png, whose six columns are exact
// by construction:
//
//   - A BIN EDGE. Families were keyed by round(log(size)/log(1.18)). The
//     fixture's four square columns measure 42 across and its two round ones
//     40 — 5% apart, well inside the 18% the key tolerates — but the two sizes
//     fall either side of a bin boundary. One structural grid became a family
//     of four and a family of two, and the pair died on the member floor.
//     Recall was 4/6 at precision 1.000: a bin edge wearing a detector's
//     clothes.
//   - SOMEONE ELSE'S CHAIR. "Nobody sits at it" was implemented as "no seat
//     nearby", and a column standing in a room of round tables is surrounded by
//     other people's seats. One round column lost to a chair 28px away that was
//     already seated at a table two feet from it.
//
// The counterweight is precision, and it is the thing that must not move: a
// line of printed text is a repeated compact seatless family too. What keeps it
// out is that a word is aligned in ONE direction and a structural grid in two.
// The real venue plan's annotation deliberately records that no columns are
// identifiable there, and nothing may be invented to make a recall number move.
//
// Slow (two real detection runs), so it is out of the default run and in --all.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = {
  name: "structural-objects",
  tags: ["intelligence", "slow"],
  timeout: 420000,
  viewport: { width: 1800, height: 1000 },
};

async function analyse(page, baseUrl, imagePath, eventName) {
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: eventName, hotel: "Merit", date: "2026-10-02" });
  const dataUrl = "data:image/png;base64," + fs.readFileSync(imagePath).toString("base64");
  await page.evaluate(([src, name]) => {
    state.events[0].background = { src, name, opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, [dataUrl, path.basename(imagePath)]);
  await page.waitForTimeout(500);
  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const a = state.events[0].analysis;
    const ow = a.originalWidth, oh = a.originalHeight;
    const alive = a.candidates.filter(c => c.status !== "rejected");
    return {
      columns: alive.filter(c => c.type === "column").map(c => ({
        kind: c.kind,
        cx: (c.x + c.w / 2) / 100 * ow, cy: (c.y + c.h / 2) / 100 * oh,
        side: Math.sqrt((c.w / 100 * ow) * (c.h / 100 * oh)),
        seats: (c.chairDetections || []).length,
        evidence: c.evidence || null,
      })),
      tables: alive.filter(c => c.kind === "table").length,
      columnsDetected: a.diagnostics.columnsDetected,
    };
  });
}

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const archPlan = path.join(repoRoot, "benchmarks/fixtures/adversarial-architecture.png");
  const textPlan = path.join(repoRoot, "benchmarks/fixtures/adversarial-text.png");
  checks.require(fs.existsSync(archPlan), "the architecture fixture is present", archPlan);
  checks.require(fs.existsSync(textPlan), "the text fixture is present", textPlan);

  // ---- a plan that has columns ---------------------------------------------
  const arch = await analyse(page, baseUrl, archPlan, "Structure");
  checks.ok(arch.columns.length > 0, "columns are found on a plan that has them", arch.columns.length);
  checks.ok(arch.tables > 0, "and its tables are still found", arch.tables);

  checks.ok(arch.columns.every(c => c.kind === "venue"),
    "a column is a venue object, never a table",
    arch.columns.filter(c => c.kind !== "venue").slice(0, 3));
  checks.ok(arch.columns.every(c => c.seats === 0),
    "no column is seated at — that is what made it a column",
    arch.columns.filter(c => c.seats > 0).slice(0, 3));
  checks.ok(arch.columns.every(c => c.evidence && /grid/.test(c.evidence.basis || "")),
    "every column records the grid reasoning that admitted it",
    arch.columns.map(c => c.evidence && c.evidence.basis).slice(0, 3));
  checks.ok(arch.columnsDetected === arch.columns.length,
    "the diagnostics agree with the candidates",
    { diagnostics: arch.columnsDetected, candidates: arch.columns.length });

  // ---- one grid, even when its members are not identical --------------------
  // The bin-edge regression, expressed without pinning a count: this fixture
  // draws its columns at two sizes a few percent apart, and a size key with a
  // boundary in it splits them. If every column found is the same size, one of
  // the two sizes has been lost again.
  const sides = arch.columns.map(c => c.side).sort((a, b) => a - b);
  const spread = sides.length ? sides[sides.length - 1] / sides[0] : 1;
  checks.ok(spread > 1.02,
    "columns of slightly different sizes are read as one structural grid",
    { smallest: +sides[0]?.toFixed(1), largest: +sides[sides.length - 1]?.toFixed(1), spread: +spread.toFixed(3) });
  checks.ok(spread < 1.18 * 1.5,
    "and the grid did not swallow objects of an unrelated size", +spread.toFixed(3));

  // ---- the columns stand on a grid, not in a line ---------------------------
  const xs = new Set(arch.columns.map(c => Math.round(c.cx / 40)));
  const ys = new Set(arch.columns.map(c => Math.round(c.cy / 40)));
  checks.ok(xs.size > 1 && ys.size > 1,
    "the detected columns span two axes, which is what a structural grid is",
    { distinctX: xs.size, distinctY: ys.size });

  // ---- and printed text is still not a column grid --------------------------
  // The precision side. A word is a repeated, compact, seatless family of marks
  // made of no table material; only the two-axis rule keeps it out. This is the
  // assertion that must fail if a future recall fix is bought with invention.
  const text = await analyse(page, baseUrl, textPlan, "Text");
  checks.ok(text.tables > 0, "tables are still found on the text fixture", text.tables);
  checks.ok(text.columns.length === 0,
    "printed text is never read as a column grid",
    { columns: text.columns.length, sample: text.columns.slice(0, 3) });
}
