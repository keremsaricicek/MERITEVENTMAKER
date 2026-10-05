// Venue elements the drawing names or repeats (src/plan-venue-elements.js).
//
// What this pins:
//   A WORD IS A WHOLE WORD: "Giriş" folds to GIRIS and names an entrance;
//     "Loca1" in a legend is not the loca title, "BARBEKÜ" is not a bar, and a
//     reading below its engine's floor names nothing.
//   THE EXTENT IS MEASURED OR SAID NOT TO BE: the closed area a label sits in
//     is the element; an area that is not closed (open to the page's edge)
//     gives NO region, and the element is the label's own box with
//     geometryBasis "label".
//   COLUMNS ARE A FAMILY ON THE WALLS: three identical solid blocks threaded on
//     a wall are columns; the same blocks floating free are not, and two are
//     not a family.
//   LOCAS NEED THEIR TITLE: a row of like cells beside a printed LOCA is a row
//     of locas; the same row with no title is nothing.
//   ON THE GOLDEN PLAN, END TO END: one stage (a measured region, the truss
//     joined into it, not a second stage), the bar and both entrances at their
//     labels, nine columns, no loca — every one offered, every one saying why.
//   A PERSON'S DECISION STANDS: a stage the operator rejected stays rejected
//     after Re-Analyze, and no second stage is offered over it.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, importPlan, runDetection, reRunDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "plan-venue-elements", tags: ["intelligence"], timeout: 360000, viewport: { width: 1500, height: 950 } };

export default async function run({ page, checks, repoRoot, baseUrl }) {
  await openApp(page, baseUrl, { lang: "en" });
  checks.require(await page.evaluate(() => typeof globalThis.MeritVenueElements === "object"), "MeritVenueElements is published");

  // ---- the parts, on rasters written pixel by pixel ----------------------------
  const parts = await page.evaluate(() => {
    const V = globalThis.MeritVenueElements;
    const raster = (W, H) => { const data = new Uint8ClampedArray(W * H * 4).fill(255); return { width: W, height: H, data }; };
    const fill = (r, x0, y0, x1, y1, rgb) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = 4 * (y * r.width + x); r.data[p] = rgb[0]; r.data[p + 1] = rgb[1]; r.data[p + 2] = rgb[2]; } };
    const outline = (r, x0, y0, x1, y1, gapAt) => {
      for (let x = x0; x < x1; x++) { fill(r, x, y0, x + 1, y0 + 2, [60, 60, 60]); if (!(gapAt === "bottom" && x > x0 + 20 && x < x0 + 60)) fill(r, x, y1 - 2, x + 1, y1, [60, 60, 60]); }
      for (let y = y0; y < y1; y++) { fill(r, x0, y, x0 + 2, y + 1, [60, 60, 60]); fill(r, x1 - 2, y, x1, y + 1, [60, 60, 60]); }
    };
    const out = {};
    out.fold = [V.fold("Giriş"), V.fold("GİRİŞ KAPISI"), V.fold("Çıkış")];
    const it = (text, score) => ({ text, score, box: { x0: 10, y0: 10, x1: 40, y1: 20 } });
    out.anchors = V.anchorsFrom([it("Giriş", 0.98), it("Loca1", 0.99), it("BARBEKÜ", 0.99), it("BAR", 0.6), it("SAHNE", 0.97), it("LOCALAR", 0.95)], 0.9)
      .map(a => `${a.type}:${a.term}`);
    // A closed room with a label in it, and the same room with its bottom open
    // to a corridor that runs to the page's edge.
    const closed = raster(900, 700); outline(closed, 50, 40, 250, 160); fill(closed, 130, 90, 170, 102, [20, 20, 20]);
    out.closed = V.regionAround(closed, { x0: 128, y0: 88, x1: 172, y1: 104 });
    const open = raster(900, 700); outline(open, 50, 40, 250, 160, "bottom"); fill(open, 130, 90, 170, 102, [20, 20, 20]);
    out.open = V.regionAround(open, { x0: 128, y0: 88, x1: 172, y1: 104 });
    // Columns: a wall (a 6 px line) with three grey blocks set into it, and the
    // same three blocks floating in the room.
    const walled = raster(600, 300); fill(walled, 0, 100, 600, 106, [70, 70, 70]);
    for (const x of [80, 260, 440]) fill(walled, x, 92, x + 40, 114, [205, 205, 205]);
    out.walled = V.columnFamilies(walled, []).length;
    const floating = raster(600, 300);
    for (const x of [80, 260, 440]) fill(floating, x, 180, x + 40, 202, [205, 205, 205]);
    out.floating = V.columnFamilies(floating, []).length;
    const pair = raster(600, 300); fill(pair, 0, 100, 600, 106, [70, 70, 70]);
    for (const x of [80, 260]) fill(pair, x, 92, x + 40, 114, [205, 205, 205]);
    out.pair = V.columnFamilies(pair, []).length;
    // Locas: a grey band holding four outlined white cells, a LOCA title under it.
    const strip = raster(1400, 600); fill(strip, 40, 100, 660, 170, [228, 229, 230]);
    for (const x of [60, 210, 360, 510]) { fill(strip, x, 110, x + 130, 160, [255, 255, 255]); outline(strip, x, 110, x + 130, 160); }
    const title = { type: "locaTitle", term: "LOCA", score: 0.99, box: { x0: 320, y0: 180, x1: 380, y1: 200 } };
    out.locas = V.locaRows(strip, [title]).length;
    out.locasNoTitle = V.locaRows(strip, []).length;
    return out;
  });
  checks.equal(JSON.stringify(parts.fold), JSON.stringify(["GIRIS", "GIRISKAPISI", "CIKIS"]), "Turkish letters and spaces fold away: Giriş is GIRIS");
  checks.equal(JSON.stringify(parts.anchors), JSON.stringify(["entrance:GIRIS", "stage:SAHNE", "locaTitle:LOCALAR"]),
    "a word names an element only when it IS the word and was read above the floor (not Loca1, not BARBEKÜ, not a 0.6 BAR)", parts.anchors);
  checks.ok(parts.closed && parts.closed.x0 <= 54 && parts.closed.x1 >= 246 && parts.closed.y0 <= 44 && parts.closed.y1 >= 156,
    "the closed area a label sits in is measured to its walls", parts.closed);
  checks.equal(parts.open, null, "an area open to the page's edge is not an extent: no region, never a guess");
  checks.equal(parts.walled, 3, "three identical solid blocks set into a wall are three columns");
  checks.equal(parts.floating, 0, "the same blocks floating in the room are not columns");
  checks.equal(parts.pair, 0, "two blocks are not a family");
  checks.equal(parts.locas, 4, "a row of like cells beside a printed LOCA is a row of four locas");
  checks.equal(parts.locasNoTitle, 0, "the same row with no title is not called anything");

  // ---- the Golden Plan, end to end ------------------------------------------------
  const plan = "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64");
  await createBlankEvent(page, { name: "Venue elements", date: futureDate() });
  await importPlan(page, plan);
  await runDetection(page);
  const golden = await page.evaluate(() => {
    const a = state.events[0].analysis;
    const v = a.candidates.filter(c => c.kind === "venue" && ["stage", "bar", "entrance", "exit", "column", "loca", "banquette"].includes(c.type));
    const px = c => ({ x0: Math.round(c.x / 100 * 1355), y0: Math.round(c.y / 100 * 788), x1: Math.round((c.x + c.w) / 100 * 1355), y1: Math.round((c.y + c.h) / 100 * 788) });
    return {
      ocrModel: !!(a.ocrModel && a.ocrModel.available),
      byType: v.reduce((m, c) => { m[c.type] = (m[c.type] || 0) + 1; return m; }, {}),
      offered: v.filter(c => c.selected === true).length, total: v.length,
      stage: v.filter(c => c.type === "stage").map(c => ({ ...px(c), basis: c.geometryBasis, typeBasis: c.typeBasis, extent: c.evidence && c.evidence.extent })),
      bar: v.filter(c => c.type === "bar").map(c => ({ basis: c.geometryBasis, extent: c.evidence && c.evidence.extent })),
      columns: v.filter(c => c.type === "column").map(c => ({ wall: c.evidence && c.evidence.wallThrough, basis: c.typeBasis })),
      benches: v.filter(c => c.type === "banquette").map(c => ({ seatsUnknown: c.seatsUnknown === true, seats: c.chairDetections.length, basis: c.typeBasis })),
      seatColour: a.diagnostics.namedVenueElements && a.diagnostics.namedVenueElements.seatColour,
      explained: v.every(c => c.evidence && c.evidence.basis && c.evidence.extent),
      diag: a.diagnostics.namedVenueElements,
    };
  });
  checks.ok(golden.ocrModel, "the OCR model ran (served from the pinned test cache)");
  checks.equal(golden.byType.stage, 1, "one stage — the truss band the detector found is joined into it, not offered beside it", golden.byType);
  checks.ok(golden.stage[0] && golden.stage[0].basis === "region" && golden.stage[0].typeBasis === "printedLabel"
    && golden.stage[0].x0 <= 700 && golden.stage[0].x1 >= 1115 && golden.stage[0].y0 <= 500 && golden.stage[0].y1 >= 730,
    "the stage is the closed area around SAHNE with its truss: measured, not the label's box", golden.stage);
  checks.ok(golden.byType.bar === 1 && golden.bar[0].basis === "label" && /not measured/.test(golden.bar[0].extent),
    "the bar is placed at BAR and says its extent was NOT measured (the counter is open to the room)", golden.bar);
  checks.equal(golden.byType.entrance, 2, "both GİRİŞ labels are entrances");
  checks.ok(golden.byType.column >= 8 && golden.byType.column <= 10 && golden.columns.every(c => c.basis === "wallFamily" && c.wall >= 0.6),
    "the grey blocks threaded on the walls are columns, each with its wall evidence", golden.columns.length);
  checks.ok(!golden.byType.loca && !golden.byType.exit, "no loca and no exit: the drawing names neither", golden.byType);
  checks.ok(golden.byType.banquette === 3 && golden.benches.every(b => b.seatsUnknown && b.seats === 0 && b.basis === "seatColourBench"),
    "the three long benches in the seats' own colour are banquettes, their seat count admitted unknown, never guessed", golden.benches);
  checks.ok(Array.isArray(golden.seatColour) && golden.seatColour[0] > golden.seatColour[2] + 100,
    "the seat colour was measured off the detected chairs (the Golden Plan's orange), not assumed", golden.seatColour);
  checks.equal(golden.offered, golden.total, "each element the drawing names is offered");
  checks.ok(golden.explained, "and each one says what named it and how much of it was measured");

  // ---- a person's decision stands ---------------------------------------------------
  const stageId = await page.evaluate(() => state.events[0].analysis.candidates.find(c => c.type === "stage").id);
  const decided = await page.evaluate(id => !!globalThis.decideReview(state.events[0], { kind: "reject", candidateId: id }), stageId);
  checks.require(decided, "the operator's rejection of the stage was recorded by the review writer");
  await reRunDetection(page);
  const after = await page.evaluate(() => {
    const st = state.events[0].analysis.candidates.filter(c => c.type === "stage");
    return st.map(c => ({ status: c.status, selected: c.selected, fromMemory: !!c.fromMemory }));
  });
  checks.ok(after.length >= 1 && after.every(c => c.selected !== true) && after.some(c => c.status === "rejected"),
    "a stage the operator rejected stays rejected after Re-Analyze, and no stage is offered over it", after);
}
