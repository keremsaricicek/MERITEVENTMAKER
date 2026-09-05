// Finding a table and knowing WHAT it is are two different jobs.
//
// The shape classifier reads one component's pixels and can only ever answer
// round, square or rectangle. Measured before the bistro classifier existed,
// the real venue plan found all five of its bistro tables and typed every one
// of them wrong: detection recall 5/5, type accuracy 0/5. Nothing in the
// product said the two numbers were different.
//
// The tempting rule is "small table = bistro" and it is wrong. A small table is
// a small table; on a plan drawn entirely of two-tops that rule relabels the
// whole room. What makes a bistro table a bistro table is how it is USED, and
// that is visible in evidence the shape classifier does not hold: how many
// people sit at it, what KIND of chair they sit in, and what the table is drawn
// with. So this suite asserts the shape of the reasoning, not a score:
//
//   - a bistro label always carries its evidence, and always more than one kind
//   - size alone never types anything
//   - the size test is relative to THIS plan's modal table, never a constant
//   - on a plan of uniformly sized tables, nothing is a bistro
//
// Accuracy belongs in benchmarks/run-benchmark.mjs against annotated ground
// truth (`TYPES square 37/37  round 4/4  bistro 5/5`), where an honest
// improvement can move the number without turning the build red.
//
// Slow (two real detection runs on real images), so it is out of the default
// run and in --all.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = {
  name: "table-typing",
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
    const tables = a.candidates.filter(c => c.kind === "table" && c.status !== "rejected");
    return {
      tables: tables.map(c => ({
        type: c.type, w: c.w, h: c.h,
        seats: (c.chairDetections || []).length,
        typeEvidence: c.typeEvidence || null,
      })),
      bistrosTyped: a.diagnostics.bistrosTyped,
      tableModalArea: a.diagnostics.tableModalArea,
      tableModalSeats: a.diagnostics.tableModalSeats,
    };
  });
}

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const realPlan = path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png");
  const uniformPlan = path.join(repoRoot, "benchmarks/fixtures/adversarial-dense.png");
  checks.require(fs.existsSync(realPlan), "the real venue plan is present", realPlan);
  checks.require(fs.existsSync(uniformPlan), "the uniform-table fixture is present", uniformPlan);

  // ---- a plan that really does have bistro tables ---------------------------
  const real = await analyse(page, baseUrl, realPlan, "Typing");
  const bistros = real.tables.filter(t => t.type === "bistro");

  checks.ok(real.tables.length > 0, "tables were detected on the real plan", real.tables.length);
  checks.ok(bistros.length > 0,
    "the real plan's bistro tables are typed as bistro, not merely found",
    { bistros: bistros.length, tables: real.tables.length });
  checks.ok(real.bistrosTyped === bistros.length,
    "the diagnostics report the same count the candidates carry — no silent typing",
    { diagnostics: real.bistrosTyped, candidates: bistros.length });

  // Bistro is a minority reading of a room by construction. A classifier that
  // types most of the plan as bistro has stopped saying anything.
  checks.ok(bistros.length < real.tables.length * 0.5,
    "bistro stays a minority type — the room was not relabelled",
    { bistros: bistros.length, tables: real.tables.length });

  // ---- every bistro label shows its work ------------------------------------
  const unevidenced = bistros.filter(t => !Array.isArray(t.typeEvidence) || t.typeEvidence.length === 0);
  checks.ok(unevidenced.length === 0,
    "no table is typed bistro without recorded evidence", unevidenced.slice(0, 3));

  const thin = bistros.filter(t => (t.typeEvidence || []).length < 3);
  checks.ok(thin.length === 0,
    "no table is typed bistro on fewer than three agreeing facts",
    thin.map(t => t.typeEvidence).slice(0, 3));

  // Size is necessary and never sufficient: at least two of the further reasons
  // must come from somewhere other than the size test. Each of the other
  // reasons is produced by a different stage of the pipeline — association,
  // chair families, tone families — so no single signal can carry the label.
  const sizeOnly = bistros.filter(t =>
    (t.typeEvidence || []).filter(r => !/smaller than/.test(r)).length < 2);
  checks.ok(sizeOnly.length === 0,
    "size alone never types a bistro — two independent stages must agree",
    sizeOnly.map(t => t.typeEvidence).slice(0, 3));

  // ---- the size test is relative to this plan, not a constant ---------------
  checks.ok(real.tableModalArea > 0,
    "the plan's modal table area is measured and reported", real.tableModalArea);
  const notSmaller = bistros.filter(t => t.w * t.h >= real.tables
    .reduce((s, x) => s + x.w * x.h, 0) / real.tables.length);
  checks.ok(notSmaller.length === 0,
    "every bistro is smaller than this plan's average table, measured on the plan",
    notSmaller.slice(0, 3));

  const nonBistro = real.tables.filter(t => t.type !== "bistro");
  checks.ok(nonBistro.every(t => !t.typeEvidence),
    "tables that are not bistros carry no bistro evidence",
    nonBistro.filter(t => t.typeEvidence).slice(0, 3));

  // ---- and a plan of uniform tables has no bistros --------------------------
  // The negative control, and the reason the rule is not "small table". This
  // fixture is 24 identically drawn square tables; a size-only classifier types
  // roughly half of them bistro the moment the modal is computed from a pool
  // with any spread in it at all.
  const uniform = await analyse(page, baseUrl, uniformPlan, "Uniform");
  checks.ok(uniform.tables.length > 0, "tables were detected on the uniform fixture", uniform.tables.length);
  const falseBistros = uniform.tables.filter(t => t.type === "bistro");
  checks.ok(falseBistros.length === 0,
    "a plan of uniformly sized tables produces no bistros",
    { bistros: falseBistros.length, tables: uniform.tables.length });
  checks.ok(!uniform.bistrosTyped,
    "and its diagnostics agree", uniform.bistrosTyped);
}
