// The symbol family is a family, not a polarity.
//
// A plan whose tables are one repeated symbol may draw that symbol in more than
// one tone. ORNEK draws 157 open circles and 9 filled ones — the same object at
// the same size in different ink — and the two halves reach the pipeline
// through different sources: the open ones through the chair sources (light
// interior, dark rim), the filled ones through the tone/fill TABLE sources,
// because a solid disc is a surface. The representation swap promotes the
// chair-source family and demotes everything the table path proposed, so the
// filled half was thrown away with the architecture. Nine real tables lost to a
// difference in ink.
//
// The membership test is pinned here with the real measured numbers rather than
// with round ones, because the value of the rule is entirely in where it sits
// relative to the two populations it separates. A future change that widens it
// until architecture gets in, or narrows it until the family's own members fall
// out, has to fail something.
//
// Measured on ORNEK's 40 de-duplicated table-pool components, against a modal
// taken from the OPEN circles alone:
//
//                     size agreement      aspect agreement
//   the 9 filled      0.89 - 0.94         0.96 - 0.97
//   the other 31      0.00 - 0.94         0.00 - 0.99
//
// ...but none of the 31 passes both.
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "symbol-family",
  tags: ["intelligence"],
  timeout: 60000,
  viewport: { width: 1200, height: 800 },
};

export default async function run({ page, checks, baseUrl }) {
  await openApp(page, baseUrl);

  const present = await page.evaluate(() => typeof globalThis.MeritSymbolFamilyMember === "function");
  checks.require(present, "the family-membership test is reachable from the suite");

  const member = (box, modal) =>
    page.evaluate(({ b, m }) => globalThis.MeritSymbolFamilyMember(b, m), { b: box, m: modal });

  // ORNEK's own vocabulary, in detection-canvas pixels: modal side 55.9 from
  // the chair-family modal, modal aspect 1.06 from the open circles.
  const ORNEK = { side: { value: 55.9 }, aspect: 1.06 };

  // ---- the nine filled discs, at their real measured sizes ------------------
  const FILLED = [
    [56, 54], [56, 55], [57, 55], [59, 54], [58, 56],
    [60, 55], [60, 56], [62, 57], [62, 58],
  ];
  for (const [w, h] of FILLED)
    checks.ok(await member({ w, h }, ORNEK),
      `a ${w}x${h} filled disc is a member of the family the open circles declared`);

  // ---- the architecture in the same pool, at its real measured sizes --------
  // Each of these agrees with the family on ONE axis and is excluded by the
  // other. That is the whole design: neither test carries the decision alone.
  const NOT_MEMBERS = [
    [92, 37, "a bay that agrees on size (0.97) and is aspect 2.49"],
    [34, 119, "a door swing that agrees on size (1.13x) and is aspect 3.50"],
    [116, 37, "a wall band, aspect 3.14"],
    [94, 48, "a service block, aspect 1.96 — the closest architecture gets"],
    [37, 38, "a fragment that agrees on aspect (1.03) at 0.66x the family size"],
    [98, 103, "a block that agrees on aspect (1.05) at 1.78x the family size"],
    [249, 112, "the largest architecture object on the sheet"],
  ];
  for (const [w, h, why] of NOT_MEMBERS)
    checks.ok(!(await member({ w, h }, ORNEK)), `not a member: ${why}`);

  // ---- both axes are load-bearing ------------------------------------------
  // Stated as a pair of cases rather than as a comment, so removing either test
  // fails here rather than only showing up as a benchmark drift.
  checks.ok(!(await member({ w: 56 * 2.2, h: 54 * 2.2 }, ORNEK)),
    "the size test alone excludes a family-shaped object at twice the family's size");
  checks.ok(!(await member({ w: 100, h: 31 }, ORNEK)),
    "the aspect test alone excludes a family-sized object drawn as a band");

  // ---- the family's own tolerance, at the boundary --------------------------
  // sizeAgreement is 1 - |ln(v/m)| / ln(1.7), so the 0.6 floor sits at a ratio
  // of 1.7^0.4 = 1.238 either side. Checked from both directions so a change to
  // either constant is visible.
  const side = 55.9;
  checks.ok(await member({ w: side * 1.2, h: side * 1.2 }, ORNEK),
    "an object 1.20x the family's size is still a member");
  checks.ok(!(await member({ w: side * 1.3, h: side * 1.3 }, ORNEK)),
    "an object 1.30x the family's size is not");
  checks.ok(await member({ w: side * 0.82, h: side * 0.82 }, ORNEK),
    "and 0.82x is a member");
  checks.ok(!(await member({ w: side * 0.75, h: side * 0.75 }, ORNEK)),
    "while 0.75x is not");

  // ---- a plan with no declared family claims nothing ------------------------
  checks.ok(!(await member({ w: 56, h: 54 }, null)),
    "with no family modal, nothing is a member");
  checks.ok(!(await member({ w: 56, h: 54 }, { side: null, aspect: 1.06 })),
    "and a modal missing its size claims nothing either");

  // ---- the vocabulary is the PLAN's, not a constant -------------------------
  // The same box is a member on a plan whose symbol is that size and not on a
  // plan whose symbol is another size. This is what stops the rule being a
  // hard-coded description of one drawing.
  const SMALL = { side: { value: 20 }, aspect: 1.0 };
  checks.ok(await member({ w: 20, h: 20 }, SMALL),
    "on a plan whose symbol is 20px, a 20px box is a member");
  checks.ok(!(await member({ w: 56, h: 54 }, SMALL)),
    "and ORNEK's disc is not a member of that plan's family");
  checks.ok(!(await member({ w: 20, h: 20 }, ORNEK)),
    "nor is that plan's symbol a member of ORNEK's");

  // ---- a rectangular-table plan is served too -------------------------------
  // Nothing here assumes the symbol is round. A plan whose repeated table is a
  // 2.4:1 rectangle declares that aspect, and its own members belong.
  const RECT = { side: { value: 60 }, aspect: 2.4 };
  checks.ok(await member({ w: 93, h: 39 }, RECT),
    "on a rectangle-table plan the family's own 2.4:1 members belong");
  checks.ok(!(await member({ w: 60, h: 60 }, RECT)),
    "and a square of the same area does not");
}
