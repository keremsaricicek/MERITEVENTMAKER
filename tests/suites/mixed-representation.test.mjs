// ONE SHEET, TWO DRAWING LANGUAGES.
//
// A venue does not always publish one sheet per vocabulary. `GRAND HOTEL —
// HALL A + TERRACE` is one drawing carrying a symbolically-numbered ballroom
// (72 identical discs, a printed capacity rule, not one seat drawn) beside a
// physically-drawn terrace (3 round tables, 24 chairs around them). Both are
// ordinary; what is not ordinary is a reader that answers "what kind of
// drawing is this?" once and then acts on that one answer everywhere.
//
// Three things had to be true before the terrace survived, and each one is a
// failure that was measured on this fixture rather than imagined:
//
//   THE FAMILY PASS HAS TO BE REACHABLE. The machinery that lets one plan
//   carry two seat vocabularies — "a 17px crescent is not asked to resemble a
//   34px armchair" — sat inside `if (useColourOnly)`. A plan drawn in ink
//   never opens that gate, so the sheet got ONE seat vocabulary, set by
//   whichever population was largest. Here that was Hall A's discs at 48px,
//   and the terrace's 22px chairs were dropped for not resembling a symbol in
//   a different room. Measured then: 0 of 24 chairs detected.
//
//   ITS SIZE FLOOR HAS TO BE ANCHORED TO A SEAT. The floor says a minority
//   seat is not an order of magnitude smaller than the plan's MAIN seat, and
//   nothing checked that the main population was a seat at all. On this sheet
//   `referenceSide` and `surfaceSide` were the same 48px — the same objects —
//   so the band opened at 19.2px and the terrace's 18px family missed it by
//   1.2px. The constant is untouched; what changed is that a floor measured
//   against something that is not smaller than the plan's own surfaces is
//   measuring nothing.
//
//   THE SWAP HAS TO ACT ON WHAT THE VERDICT WAS ABOUT. `SYMBOLIC` used to
//   begin `candidates.splice(0, candidates.length)` — every table on the
//   sheet. Its argument is "these repeated marks sit at nothing, so they are
//   not chairs", which is an argument about the primary family. A separately
//   admitted family earned its place on the opposite evidence, so neither it
//   nor the tables it seats was ever part of the claim.
//
// WHAT THIS SUITE DOES NOT CLAIM. The terrace's three TABLES are still
// missed, and the reason is measured and recorded rather than papered over:
// the plan-wide modal table area is set by the title's glyphs once the
// furniture is outnumbered, and the fix for that is a modal local to a region
// — not a threshold. The assertion below is therefore about the chairs
// surviving as chairs, which is what the swap decides, and it deliberately
// does not assert a table count it knows to be incomplete.
//
// Slow: real detection on a real image.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent, futureDate } from "../lib/app-actions.mjs";

export const meta = {
  name: "mixed-representation",
  tags: ["intelligence", "slow"],
  timeout: 300000,
  viewport: { width: 1800, height: 1000 },
};

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const planPath = path.join(repoRoot, "benchmarks/adversarial/fixtures/a9-mixed-representation.png");
  const declPath = path.join(repoRoot, "benchmarks/adversarial/declarations/a9-mixed-representation.json");
  checks.require(fs.existsSync(planPath), "the mixed-representation fixture is present", planPath);
  checks.require(fs.existsSync(declPath), "and its declaration is present", declPath);
  const decl = JSON.parse(fs.readFileSync(declPath, "utf8"));
  const drawnChairs = decl.objects.filter(o => o.class === "chair").length;
  const symbols = decl.objects.filter(o => o.class === "table" && o.drawnAs === "symbol").length;
  checks.equal(drawnChairs, 24, "the fixture draws 24 real chairs on its terrace", drawnChairs);
  checks.equal(symbols, 72, "and states its hall as 72 symbols with no seat drawn", symbols);

  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "Mixed", hotel: "Grand", date: futureDate() });
  await page.evaluate(src => {
    state.events[0].background = { src, name: "a9-mixed-representation.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, "data:image/png;base64," + fs.readFileSync(planPath).toString("base64"));
  await page.waitForTimeout(500);

  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 240000 });
  await page.waitForTimeout(800);

  const out = await page.evaluate(() => {
    const a = state.events[0].analysis || {};
    const d = a.diagnostics || {};
    const cands = a.candidates || [];
    // The terrace occupies the right-hand third of the sheet; the hall the
    // left. Read off the fixture's own geometry (the dividing wall stands at
    // x = 1110 of 1700), not tuned to a result.
    const inTerrace = c => c.x > 63;
    return {
      representation: (d.representation || {}).kind || null,
      swap: d.representationSwap || null,
      families: {
        considered: (d.secondaryChairFamilies || {}).considered ?? null,
        admitted: (d.secondaryChairFamilies || {}).admitted ?? null,
        primary: (d.secondaryChairFamilies || {}).primary ?? null,
        primaryColour: (d.secondaryChairFamilies || {}).primaryColour ?? null,
        referenceSide: (d.secondaryChairFamilies || {}).referenceSide ?? null,
        surfaceSide: (d.secondaryChairFamilies || {}).surfaceSide ?? null,
      },
      chairsDetected: d.chairs ?? null,
      chairVenues: cands.filter(c => c.kind === "venue" && c.type === "chair").length,
      chairVenuesInTerrace: cands.filter(c => c.kind === "venue" && c.type === "chair" && inTerrace(c)).length,
      tablesInTerrace: cands.filter(c => c.kind === "table" && inTerrace(c)).length,
      tablesInHall: cands.filter(c => c.kind === "table" && !inTerrace(c)).length,
      anyTrained: !!(a.provider && a.provider.trainedModel),
    };
  });

  // --- 1. the ink plan reaches the multi-family pass at all -----------------
  checks.equal(out.families.primaryColour, false,
    "this sheet has no accent colour, so the primary family is chosen from ink — the case the family pass used to skip entirely", out.families);
  checks.ok(out.families.considered >= 1,
    "and a second seat family is CONSIDERED. Zero here means the pass is gated behind colour again and every ink plan is back to one vocabulary", out.families);
  checks.ok(out.families.admitted >= 1,
    "and admitted. A family found and then refused on a bound taken from another room is the same loss with a better diagnostic", out.families);

  // --- 2. the floor's anchor ------------------------------------------------
  checks.ok(out.families.referenceSide !== null && out.families.surfaceSide !== null,
    "both anchors of the size band are reported, so the bound can be argued with rather than trusted", out.families);
  checks.ok(out.families.referenceSide >= out.families.surfaceSide,
    "on THIS sheet the reference 'chair' is not smaller than the plan's surfaces — it is the same population — which is exactly when a floor measured against it means nothing", out.families);

  // --- 3. the drawn terrace survives the symbolic verdict -------------------
  checks.equal(out.representation, "SYMBOLIC",
    "the verdict on the plan's own uniform family is still symbolic: 72 marks, none at a table", out.representation);
  checks.equal(out.chairVenuesInTerrace, drawnChairs,
    "and all 24 drawn chairs are still CHAIRS. Promoting them to tables is the whole failure this fixture exists for: a room inverted because of what was drawn in a different room", out);
  checks.equal(out.tablesInTerrace, 0,
    "no chair in the terrace became a table", out);
  checks.ok(out.tablesInHall >= 60,
    "while the hall's symbols are still promoted — the fix must not cost the behaviour it is scoping", out);
  checks.ok(out.swap && out.swap.keptDrawnSeats === drawnChairs,
    "the swap RECORDS what it did not touch. A swap that silently leaves part of a sheet alone is as large a claim as one that changes all of it", out.swap);
  checks.ok(out.swap && Array.isArray(out.swap.drawnSeatFamilies) && out.swap.drawnSeatFamilies.length >= 1,
    "and names the family it left alone", out.swap);

  // --- 4. none of this became a model claim --------------------------------
  checks.ok(!out.anyTrained,
    "and no trained model is claimed — a representation fix must not quietly become one", out.anyTrained);
}
