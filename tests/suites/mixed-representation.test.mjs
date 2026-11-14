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
// WHAT THIS SUITE DOES NOT CLAIM. On the environment this was written in the
// terrace's three TABLES are still missed, and the reason is measured rather
// than papered over: the plan-wide modal table area is set by the title's
// glyphs once the furniture is outnumbered, and the fix for that is a modal
// local to a region, not a threshold. So the assertions below are about the
// 24 drawn seats still being SEATS — which is what the swap decides — and
// they deliberately do not pin a table count that is known to be incomplete.
//
// THE FIRST VERSION OF THEM DID PIN ONE, AND CI CAUGHT IT. It asserted that
// the 24 arrive as 24 standalone chair objects inside the terrace, which is a
// statement about how this drawing happens to be detected rather than about
// what must be true: if those three tables were ever found, the same chairs
// would become their seats — the better outcome — and the suite would have
// reported a regression. It passed locally and failed on CI, where
// `keptDrawnSeats` was still 24. Counting the seats wherever the pipeline
// files them is the claim that was meant; the positions travel in the failure
// payload so the next environment to disagree says where, not only how many.
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
    const drawnSeats = cands.filter(c => c.kind === "venue" && c.type === "chair");
    return {
      // WHERE the surviving drawn seats actually are. A count alone cannot
      // tell "the fix worked" from "twenty-four of something else survived",
      // and this suite failed on CI while passing locally with the count
      // right — so the positions travel with it.
      drawnSeatBoxes: drawnSeats.slice(0, 30).map(c => ({ x: +c.x.toFixed(1), y: +c.y.toFixed(1),
        w: +c.w.toFixed(2), f: c.seatFamily })),
      tableBoxes: cands.filter(c => c.kind === "table").slice(0, 8)
        .map(c => ({ x: +c.x.toFixed(1), y: +c.y.toFixed(1), w: +c.w.toFixed(2), seats: (c.chairDetections || []).length })),
      seatsOnTerraceTables: cands.filter(c => c.kind === "table" && inTerrace(c))
        .reduce((n, c) => n + (c.chairDetections || []).length, 0),
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

  // THE CONTRACT, NOT THE SHAPE. The first version of this asserted that the
  // 24 chairs appear as 24 standalone chair objects in the terrace, and that
  // is a statement about how the terrace happens to be detected today, not
  // about what must be true. If the terrace's three tables were ever
  // detected, those same chairs would become their seats — the better
  // outcome — and the suite would have called it a failure. What must hold is
  // that the sheet's 24 drawn seats are still SEATS, wherever the pipeline
  // files them.
  const stillSeats = out.chairVenues + out.seatsOnTerraceTables;
  checks.ok(stillSeats === drawnChairs,
    "all 24 drawn seats are still seats. Promoting them to tables is the whole failure this fixture exists for: a room inverted because of what was drawn in a different room", out);
  checks.ok(out.tablesInTerrace <= 3,
    "and the terrace holds at most the 3 tables that are drawn there — 24 would mean its chairs became tables", out);
  checks.ok(out.tablesInHall >= 60,
    "while the hall's symbols are still promoted — the fix must not cost the behaviour it is scoping", out);
  checks.ok(out.swap && out.swap.keptDrawnSeats === drawnChairs,
    "the swap RECORDS what it did not touch. A swap that silently leaves part of a sheet alone is as large a claim as one that changes all of it", out.swap);
  checks.ok(out.swap && Array.isArray(out.swap.drawnSeatFamilies) && out.swap.drawnSeatFamilies.length >= 1,
    "and names the family it left alone", out.swap);

  // --- 4. none of this became a model claim --------------------------------
  checks.ok(!out.anyTrained,
    "and no trained model is claimed — a representation fix must not quietly become one", out.anyTrained);

  // --- 5. AND THE TEXT FILTER DOES NOT DELETE THEM -------------------------
  //
  // The run above had no OCR: Tesseract loads from a CDN and the sandbox this
  // was written in has no network, so `suppressTextFalsePositives` returned
  // early and never saw a word box. CI has network, and there the whole
  // terrace vanished — identical through the entire detector
  // (`keptDrawnSeats: 24`) and then zero chair objects in the result.
  //
  // The filter's exemptions were written for a sheet that is one thing or the
  // other: a symbol is not text, a column is not text. A DRAWN SEAT standing
  // on its own is a third kind of object and qualified for neither.
  //
  // So OCR is stubbed here rather than waited for. The stub claims the ENTIRE
  // sheet is printed text, which is not a plausible OCR result and is not
  // meant to be — it is the BOUND. Under it every candidate's overlap ratio
  // is 1, so only the exempt survive, and the question "is a drawn seat
  // exempt?" is asked with nothing else able to answer it.
  //
  // A fresh load, because the shell leaves no detect control on the screen it
  // moves to once an analysis exists, and the stub is installed BEFORE boot so
  // it is in place when `plan-ocr.js` would otherwise define the real one.
  await page.addInitScript(() => {
    globalThis.__meritOcrStub = true;
    Object.defineProperty(globalThis, "runPlanOCR", {
      configurable: true,
      get: () => async () => ({
        available: true,
        text: "TERRACE",
        // One word box larger than any canvas this can run on. `overlapArea`
        // clamps to each candidate's own box, so the ratio is 1 for everything.
        words: [{ text: "TERRACE", bbox: { x0: 0, y0: 0, x1: 100000, y1: 100000 } }],
      }),
      set: () => {},
    });
  });
  await openApp(page, baseUrl);
  await createBlankEvent(page, { name: "MixedOCR", hotel: "Grand", date: futureDate() });
  await page.evaluate(src => {
    state.events[0].background = { src, name: "a9-mixed-representation.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, "data:image/png;base64," + fs.readFileSync(planPath).toString("base64"));
  await page.waitForTimeout(500);
  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis && !ui.analysisBusy, null, { timeout: 240000 });
  await page.waitForTimeout(800);

  const withOcr = await page.evaluate(() => {
    const a = state.events[0].analysis || {};
    const cands = a.candidates || [];
    const inTerrace = c => c.x > 63;
    return {
      ocrAvailable: !!(a.ocr && a.ocr.available),
      textSuppressed: (a.diagnostics || {}).textSuppressed ?? null,
      drawnSeats: cands.filter(c => c.kind === "venue" && c.type === "chair"
        && c.seatFamily && c.seatFamily !== "primary").length,
      seatsOnTerraceTables: cands.filter(c => c.kind === "table" && inTerrace(c))
        .reduce((n, c) => n + (c.chairDetections || []).length, 0),
      tables: cands.filter(c => c.kind === "table").length,
      tally: cands.reduce((m, c) => (m[c.kind + "/" + c.type] = (m[c.kind + "/" + c.type] || 0) + 1, m), {}),
    };
  });
  checks.ok(withOcr.ocrAvailable, "the stubbed OCR really ran, so the text filter was really exercised", withOcr);
  checks.ok(withOcr.textSuppressed > 0,
    "and it really suppressed things — a filter that removed nothing would make the next check vacuous", withOcr);
  checks.ok(withOcr.drawnSeats + withOcr.seatsOnTerraceTables === drawnChairs,
    "all 24 drawn seats survive a claim that the whole sheet is printed text. A seat family is admitted on evidence a run of glyphs cannot produce — one repeated size and shape, most of its members against a table — which is exactly the evidence that rules out text",
    withOcr);
  checks.ok(withOcr.tables >= 60,
    "and the hall's symbols survive it too, as they already did", withOcr);
}
