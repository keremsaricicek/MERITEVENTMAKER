// The plan, read back in words (src/plan-reading.js, MeritPlanReading) and on
// the review screen (src/screen-reading.js).
//
// What this pins:
//   EVERY LINE STANDS ON SOMETHING. A sentence carries the objects (refs) or
//     the printed words (boxes) it comes from, every ref exists, and every key
//     it uses has a sentence in both languages.
//   HOW IT IS KNOWN IS NEVER PROMOTED. A block the sheet does not name is a
//     POSSIBLE stage (unsure), never a stage; pushed-together tables and a
//     per-box share of a printed total are worked out (inferred); a column in
//     front of a table "may" block the view — the drawing has no heights.
//   THE WORDS ON THE SHEET ARE SORTED BY WHAT THEY SAY, in Turkish or English:
//     capacity, measurement, stage, bar, entrance, box, service, technical,
//     venue, date; a list of names stacked beside the drawing is a legend; a
//     heading on the same line as a figure labels that figure.
//   GEOMETRY IN THE PLAN'S OWN PIXELS: a line of sight is tested in pixels, so
//     a non-square plan is not read in stretched percent.
//   ON SCREEN: the reading opens from the review header, a line puts its
//     objects under a mark and zooms to them, a part of the room is read on its
//     own, the digital view redraws the plan (one shape per table offered, the
//     scan hidden), and reading changes nothing in the analysis.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { openApp, createBlankEvent, importPlan, runDetection, reRunDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "plan-reading", tags: ["intelligence", "ux"], timeout: 240000, viewport: { width: 1920, height: 1080 } };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/plan-reading.js"), "utf8"), ctx);
  const R = ctx.MeritPlanReading;
  checks.require(!!R && typeof R.read === "function", "MeritPlanReading loads outside the browser");

  // ---- the words ---------------------------------------------------------------------
  checks.equal(["Total : 124 pax", "166 * 12 : 1992 PAX", "8m", "3,10m", "SAHNE", "Stage", "BAR", "GİRİŞ", "Entrance", "Loca 3A", "servant", "SYSTEM", "KONTROL", "WC", "Haluk Elver Salonu 1/2/3", "29.08.2026", "17", "8B", "TOPLAM", "random words"].map((x) => R.categoryOf(x)),
    ["capacity", "capacity", "dimension", "dimension", "stage", "stage", "bar", "entrance", "entrance", "loca", "service", "technical", "technical", "facility", "venueName", "date", "number", "number", "capacityLabel", "other"],
    "each word is sorted by what it says, Turkish or English");

  // ---- a synthetic room, 2:1, read in its own pixels ------------------------------------------
  const W = 2000, H = 1000;
  const tb = (id, x, y, over) => ({ id, kind: "table", type: "square", x, y, w: 4, h: 8, status: "unreviewed", selected: true, chairDetections: [{}, {}], ...over });
  const vn = (id, type, x, y, w, h, over) => ({ id, kind: "venue", type, x, y, w, h, status: "unreviewed", selected: true, ...over });
  const box = (text, x, y, w, h) => ({ text, box: { x0: x / 100 * W, y0: y / 100 * H, x1: (x + w) / 100 * W, y1: (y + h) / 100 * H } });
  const analysis = {
    imageWidth: W, imageHeight: H,
    candidates: [
      vn("stage", "stage", 70, 40, 20, 20, { typeBasis: "printedLabel" }),
      tb("t1", 60, 45), tb("t2", 20, 45), tb("t3", 24.2, 45), tb("t4", 28.4, 45),
      vn("col", "column", 40, 47, 2, 4),
      vn("ghost", "column", 50, 90, 2, 4, { status: "rejected" }),
      tb("held", 10, 10, { selected: false, lowEvidence: { reason: "belowReviewThreshold" } }),
    ],
    planIntelligence: {
      planSummary: { representation: "PHYSICAL", physicalSeats: 8, diningGroups: 2 },
      furnitureGroups: [{ id: "g1", memberIds: ["t2", "t3", "t4"], bbox: { x: 20, y: 45, w: 12.4, h: 8 } }, { id: "g2", memberIds: ["t1"] }],
      capacityAudit: { drawingStated: 12, unverified: [], physical: { heldBack: { tables: 1, seats: 2 } } },
      zones: [], contradictions: [],
    },
    ocrModel: { available: true, imageSize: { width: W, height: H }, items: [
      box("SAHNE", 78, 48, 4, 3), box("Total : 12 pax", 2, 2, 8, 3), box("8m", 75, 62, 2, 2), box("servant", 90, 90, 5, 3),
      box("Loca 1", 2, 70, 4, 2.5), box("Loca 2", 2, 73, 4, 2.5), box("Loca 3", 2, 76, 4, 2.5), box("Unreadable mess", 40, 90, 8, 3),
    ] },
  };
  const r = R.read(analysis);
  const all = [...r.headline, ...r.sections.flatMap((s) => s.sentences), ...r.regions.flatMap((x) => x.sentences || [])];
  const by = (k) => all.find((s) => s.key === k);
  const ids = new Set(analysis.candidates.map((c) => c.id));
  checks.ok(all.length > 8 && all.every((s) => s.refs.every((id) => ids.has(id))), "every sentence's objects exist in the analysis", all.filter((s) => !s.refs.every((id) => ids.has(id))).map((s) => s.key));
  checks.ok(!all.some((s) => s.refs.includes("ghost")), "a rejected object is never what a sentence stands on");
  const sight = by("read.room.sightline");
  checks.ok(!!sight && sight.certainty === "inferred" && sight.refs.includes("col") && sight.refs.filter((id) => id.startsWith("t")).sort().join() === "t2,t3,t4",
    "the column between the far tables and the stage is reported, in pixels, as possibly blocking those three — and not the table already in front", sight);
  const merged = by("read.tables.mergedOne");
  checks.ok(!!merged && merged.params.n === 3 && merged.params.seats === 6 && merged.certainty === "inferred", "three pushed-together tables are read as one 6-seat table, as a worked-out fact", merged);
  const gap = by("read.capacity.gap");
  checks.ok(!!gap && gap.params.diff === 4 && gap.params.held === 2 && gap.refs.includes("held"), "printed 12 vs 8 counted is a gap of 4, and the held-back table is named where to look", gap);
  checks.ok(by("read.stage.where").certainty === "stated" && by("read.stage.where").params.pos === "mr" && by("read.stage.front").refs.includes("t1"), "the stage named by its printed word is placed (middle right) and the table in front of it is named");
  const tx = Object.fromEntries(r.texts.map((x) => [x.text, x]));
  checks.equal([tx["SAHNE"].used.key, tx["Total : 12 pax"].used.key, tx["8m"].used.key, tx["servant"].used.key, tx["Loca 1"].used.key, tx["Unreadable mess"].used.key],
    ["read.used.named", "read.used.capacity", "read.used.dimension", "read.used.placeOnly", "read.used.legend", "read.used.none"],
    "every word says what it was used for: named the stage, the capacity, a measurement kept as text, a place only written, a legend, nothing");

  // What a person decided outranks how it was read; a remembered decision says so.
  const taught = JSON.parse(JSON.stringify(analysis));
  taught.candidates.find((c) => c.id === "stage").status = "confirmed";
  for (const id of ["t2", "t3", "t4"]) taught.candidates.find((c) => c.id === id).status = "confirmed";
  const rt = R.read(taught), all3 = rt.sections.flatMap((x) => x.sentences);
  const remembered = JSON.parse(JSON.stringify(taught));
  remembered.candidates.find((c) => c.id === "stage").fromMemory = true;
  const rm = R.read(remembered).sections.flatMap((x) => x.sentences);
  checks.equal([all3.find((x) => x.key === "read.stage.where").certainty, rm.find((x) => x.key === "read.stage.where").certainty, all3.find((x) => x.key === "read.tables.mergedOne").certainty],
    ["confirmed", "remembered", "inferred"], "a stage a person confirmed reads as confirmed, and as remembered when the decision came back from memory; three confirmed tables are still only worked out to be one table");

  // A block the sheet does not name, with tables on three sides, is only a possible stage.
  const noStage = JSON.parse(JSON.stringify(analysis));
  noStage.candidates = noStage.candidates.filter((c) => c.id !== "stage");
  noStage.candidates.push(vn("block", "other", 45, 40, 6, 20, { selected: false }), tb("n1", 45, 30), tb("n2", 39, 45), tb("n3", 52, 45), tb("n4", 45, 61));
  noStage.ocrModel.items = [];
  const r2 = R.read(noStage);
  const maybe = r2.sections.flatMap((s) => s.sentences).find((s) => s.key.startsWith("read.stage."));
  checks.ok(maybe && maybe.key === "read.stage.maybe" && maybe.certainty === "unsure" && maybe.refs.join() === "block", "an unnamed block ringed by tables is offered as a POSSIBLE stage, never as a stage", maybe);
  checks.ok(r2.sections.flatMap((s) => s.sentences).some((s) => s.key === "read.unsure.noText"), "no text read is said as such");

  // Every key the reader can produce has both languages.
  const src = fs.readFileSync(path.join(repoRoot, "src/plan-reading.js"), "utf8");
  const keys = [...new Set([...src.matchAll(/"(read\.[a-zA-Z.]+)"/g)].map((m) => m[1]).filter((k) => !k.endsWith(".")))];
  const i18n = fs.readFileSync(path.join(repoRoot, "src/i18n.js"), "utf8");
  const missing = keys.filter((k) => !new RegExp(`"${k.replace(/\./g, "\\.")}": \\{ en: "[^"]+", tr: "[^"]+" \\}`).test(i18n));
  checks.equal(missing, [], `every sentence key the reader uses (${keys.length}) has an English and a Turkish sentence`);

  // ---- on screen -----------------------------------------------------------------------
  await openApp(page, baseUrl, { lang: "tr" });
  await createBlankEvent(page, { name: "Okuma", date: futureDate() });
  await importPlan(page, "data:image/png;base64," + fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64"));
  await runDetection(page);
  await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; render(); });
  const snap = () => page.evaluate(() => JSON.stringify([state.events[0].analysis.candidates, state.events[0].analysis.planIntelligence.furnitureGroups]));
  const before = await snap();
  checks.require(await page.locator('[data-read-action="toggle"]').count() === 1, "the review header carries the plan reading control");
  await page.click('[data-read-action="toggle"]');
  await page.waitForSelector(".read-panel");
  const panel = await page.locator(".read-panel").textContent();
  checks.ok(/Sandalyeleri çizili bir yemek düzeni: \d+ masa, \d+ yerde birleştirilip uzun masa yapılmış, \d+ sandalye\. Plan kendisi 124 kişi diyor\./.test(panel) && /Sahne planın sağ alt kısmında/.test(panel)
    && /Birleştirilmiş masalar, \d+ yerde/.test(panel) && /Plan toplam 124 kişi yazıyor/.test(panel),
    "the Golden Plan is read out in Turkish: a dinner layout with drawn chairs, pushed-together tables, the printed 124, the stage at the bottom right", panel.slice(0, 600));
  const stageLine = await page.evaluate(() => [...document.querySelectorAll(".read-line")].find((b) => /Sahne planın sağ alt kısmında, genişliğinin/.test(b.textContent)).dataset.readId);
  await page.click(`[data-read-id="${stageLine}"]`);
  await page.waitForTimeout(700);
  const focused = await page.evaluate(() => ({ marks: document.querySelectorAll(".read-mark").length, words: document.querySelectorAll(".read-mark.word").length, zoom: document.getElementById("analysisSceneInner").style.transform, pressed: document.querySelector(".read-line.on") && document.querySelector(".read-line.on").getAttribute("aria-pressed") }));
  checks.ok(focused.marks >= 2 && focused.words === 1 && /scale\((?!1\))/.test(focused.zoom) && focused.pressed === "true",
    "pressing a line marks its object and the printed word it came from, and zooms the plan to them", focused);
  await page.click('[data-read-region]:not([data-read-region=""])');
  await page.waitForTimeout(400);
  const region = await page.evaluate(() => ({ lines: document.querySelectorAll(".read-section .read-line").length, region: document.querySelectorAll(".read-mark.region").length }));
  await page.click('[data-read-region=""]');
  const whole = await page.evaluate(() => document.querySelectorAll(".read-section .read-line").length);
  checks.ok(region.region === 1 && region.lines < whole, "a part of the room is read on its own: fewer lines, its outline on the plan", { region, whole });
  await page.click('[data-read-view="digital"]');
  await page.waitForTimeout(400);
  const digital = await page.evaluate(() => {
    const a = state.events[0].analysis, offered = a.candidates.filter((c) => c.kind === "table" && c.status !== "rejected").length;
    const svg = document.querySelector(".digital-plan"), img = document.querySelector("#analysisSceneInner > img");
    return { tables: svg ? svg.querySelectorAll(".dg-table").length : 0, offered, chairs: svg ? svg.querySelectorAll(".dg-chair").length : 0, stage: svg ? svg.querySelectorAll(".dg-stage").length : 0,
      columns: svg ? svg.querySelectorAll(".dg-column").length : 0, groups: svg ? svg.querySelectorAll(".dg-group").length : 0, imgOpacity: img && getComputedStyle(img).opacity };
  });
  checks.ok(digital.tables === digital.offered && digital.chairs >= 100 && digital.stage === 1 && digital.columns >= 1 && digital.groups >= 10 && digital.imgOpacity === "0",
    "the digital view redraws the plan from what was understood — every table offered, its chairs, the stage, the columns, the pushed-together tables — with the scan hidden", digital);
  // Where each shape lands, not only how many: a chair detection is stored by
  // its CENTRE and a table by its corner, and drawing a chair from its corner
  // put every one half its own size off the scan under it.
  const placed = await page.evaluate(() => {
    const a = state.events[0].analysis, W = a.imageWidth, H = a.imageHeight;
    // In drawing order: loose chairs (venue objects, stored by their corner) first, then each table's.
    const live = a.candidates.filter((c) => c.status !== "rejected");
    const want = [...live.filter((c) => c.kind === "venue" && c.type === "chair").map((c) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2, w: c.w })),
      ...live.filter((c) => c.kind === "table").flatMap((c) => c.chairDetections || [])].map((ch) => [ch.x / 100 * W, ch.y / 100 * H, ch.w / 100 * W]);
    const drawn = [...document.querySelectorAll(".digital-plan .dg-chair")].map((r) => [+r.getAttribute("x") + +r.getAttribute("width") / 2, +r.getAttribute("y") + +r.getAttribute("height") / 2]);
    let worst = 0, halfWidth = 0;
    drawn.forEach(([x, y], i) => { worst = Math.max(worst, Math.hypot(x - want[i][0], y - want[i][1])); halfWidth = Math.max(halfWidth, want[i][2] / 2); });
    return { chairs: drawn.length, expected: want.length, worstPx: Math.round(worst * 10) / 10, largestHalfWidthPx: Math.round(halfWidth * 10) / 10 };
  });
  checks.ok(placed.chairs === placed.expected && placed.worstPx <= 0.2,
    "every drawn chair is centred on the chair the analysis found (within rounding), not shifted off it by half its size", placed);
  const lettering = await page.evaluate(() => {
    const svg = document.querySelector(".digital-plan"), paper = getComputedStyle(svg.querySelector(".dg-paper")).fill;
    const num = svg.querySelector("text:not(.dg-badge)"), badges = [...svg.querySelectorAll(".dg-badge")].map((b) => b.textContent);
    return { numberStroke: num && getComputedStyle(num).stroke, paper, badges: badges.slice(0, 3), worded: badges.length > 0 && badges.every((b) => /^\d+ (koltuk|seats)$/.test(b)) };
  });
  // The app's icon rule strokes every svg in currentColor; inherited by the
  // lettering it drew a dark outline round every figure.
  checks.ok(lettering.numberStroke === lettering.paper && lettering.worded,
    "the digital view's figures carry a paper halo, not the icons' dark outline, and a pushed-together table's seats are worded (\"8 seats\"), never a bare figure that reads as a table number", lettering);
  await page.click('[data-read-view="original"]');
  await page.evaluate(() => { ui.lang = "en"; render(); });
  const en = await page.locator(".read-panel").textContent();
  checks.ok(/A dinner layout with drawn chairs/.test(en) && /The plan states a total of 124 people/.test(en), "and in English", en.slice(0, 300));
  checks.equal(await snap(), before, "reading the plan changed nothing in the analysis");

  // ---- what you teach, it says back — and says again on the next analysis --------------------
  await page.evaluate(() => { const ev = state.events[0], st = ev.analysis.candidates.find((c) => c.type === "stage"); decideReview(ev, { kind: "confirm", candidateId: st.id }); ui.readingOpen = true; render(); });
  const stageCert = () => page.evaluate(() => { const b = [...document.querySelectorAll(".read-line")].find((x) => /The stage is at|Stage at the/.test(x.textContent)); return b ? b.querySelector(".read-cert").textContent : null; });
  const afterConfirm = await stageCert();
  await reRunDetection(page);
  await page.evaluate(() => { ui.tab = "floor"; ui.planMode = "review"; ui.readingOpen = true; render(); });
  await page.waitForSelector(".read-panel");
  const afterReanalysis = await stageCert();
  checks.ok(afterConfirm === "You confirmed" && afterReanalysis === "Remembered",
    "a stage the person confirmed is read back as theirs, and after a fresh analysis of the same plan it is read back as remembered", { afterConfirm, afterReanalysis });
}
