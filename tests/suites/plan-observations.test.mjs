// Every object on an analysed plan can say who saw it, where, how sure that
// source was, and what to look at to see it again — MeritObservations.
//
// What this pins:
//   AN OBSERVATION THAT COULD NOT BE EXPLAINED IS REFUSED: no provider, an
//     unnamed frame or box convention, a confidence without its scale.
//   CONFIDENCES ARE NEVER AVERAGED: support() reports channels and counts and
//     has no combined confidence to report.
//   AGREEMENT FROM ONE IMAGE IS ONE SOURCE: two crops of a table number, or a
//     detector and OCR on the same raster, are one channel and are NOT
//     "independently confirmed"; the PDF's vectors, the PDF's text layer and a
//     person are channels of their own.
//   ON A REAL ANALYSIS every candidate carries observations that resolve, each
//     validates, a candidate's geometry is its observation's (corner box,
//     plan percent), every seat names the observation that produced it, a
//     venue object named by its printed label carries the OCR reading, the
//     analysis records its frames and both box conventions, and the scene
//     graph's nodes carry the observation ids and their real source.
//   STORED AND READ BACK: observations survive save → reload; an analysis
//     stored before observations existed still loads and reads as "not
//     recorded", not as an error.
import fs from "node:fs";
import path from "node:path";
import { openApp, createBlankEvent, importPlan, runDetection, futureDate } from "../lib/app-actions.mjs";

export const meta = { name: "plan-observations", tags: ["intelligence"], timeout: 300000, viewport: { width: 1600, height: 1000 } };

export default async function run({ page, checks, baseUrl, repoRoot }) {
  await openApp(page, baseUrl);
  checks.require(await page.evaluate(() => typeof globalThis.MeritObservations === "object"), "MeritObservations is published");

  // ---- the rules, on their own ----------------------------------------------
  const pure = await page.evaluate(() => {
    const O = globalThis.MeritObservations;
    const refuse = (input) => { try { O.create(input); return "accepted"; } catch (e) { return "refused"; } };
    const g = { frame: "plan-percent", convention: "corner", x: 1, y: 2, w: 3, h: 4 };
    const mk = (id, kind, provider, imageRef, extra) => O.create({ id, source: { kind, provider }, imageRef, geometry: g, ...(extra || {}) });
    const crops = [mk("a", "ocr", "tesseract.js", "img1", { confidence: { value: 94, scale: "ocr-0-100" } }),
                   mk("b", "ocr", "tesseract.js", "img1", { confidence: { value: 91, scale: "ocr-0-100" } })];
    const detAndOcr = [mk("c", "classical-cv", "classical-cv", "img1", { confidence: { value: 0.8, scale: "provider-native-0-1" } }), crops[0]];
    const twoModels = [mk("d", "classical-cv", "classical-cv", "img1"), mk("e", "learned-detector", "yolo", "img1")];
    const rasterAndVector = [mk("f", "classical-cv", "classical-cv", "img1"), mk("g", "pdf-vector", "pdfjs", "doc1")];
    const twoImages = [mk("h", "classical-cv", "classical-cv", "img1"), mk("i", "classical-cv", "classical-cv", "img2")];
    const s = O.support(detAndOcr);
    return {
      noProvider: refuse({ id: "x", source: { kind: "ocr" } }),
      unknownKind: refuse({ id: "x", source: { kind: "guess", provider: "p" } }),
      noConvention: refuse({ id: "x", source: { kind: "ocr", provider: "p" }, geometry: { frame: "plan-percent", x: 1, y: 1, w: 1, h: 1 } }),
      badFrame: refuse({ id: "x", source: { kind: "ocr", provider: "p" }, geometry: { ...g, frame: "screen" } }),
      unscaled: refuse({ id: "x", source: { kind: "ocr", provider: "p" }, confidence: { value: 0.9 } }),
      cropsConfirmed: O.independentlyConfirmed(crops),
      cropsChannels: O.support(crops).independentChannels,
      detAndOcrChannels: s.independentChannels,
      detAndOcrKeys: Object.keys(s).sort(),
      twoModelsConfirmed: O.independentlyConfirmed(twoModels),
      rasterVectorConfirmed: O.independentlyConfirmed(rasterAndVector),
      twoImagesChannels: O.support(twoImages).independentChannels,
      human: O.support([crops[0], O.create({ id: "j", source: { kind: "human", provider: "operator" } })]),
      keepsOwnConfidence: crops.map(o => o.confidence.value),
    };
  });
  checks.equal(pure.noProvider, "refused", "an observation without a provider is refused");
  checks.equal(pure.unknownKind, "refused", "an unknown source kind is refused");
  checks.equal(pure.noConvention, "refused", "geometry without a box convention is refused");
  checks.equal(pure.badFrame, "refused", "geometry in an unnamed frame is refused");
  checks.equal(pure.unscaled, "refused", "a confidence without its scale is refused");
  checks.equal(pure.cropsConfirmed, false, "two crops of one image read by one engine are NOT independent confirmation");
  checks.equal(pure.cropsChannels, 1, "they are one channel");
  checks.equal(pure.detAndOcrChannels, 1, "a detector and OCR on the same raster are one channel");
  checks.equal(pure.twoModelsConfirmed, false, "two models on the same image are not independent confirmation either");
  checks.equal(pure.rasterVectorConfirmed, true, "the raster and the PDF's vector paths are two channels");
  checks.equal(pure.twoImagesChannels, 2, "two different images are two channels");
  checks.ok(pure.human.humanDecided && pure.human.independentChannels === 2, "a person is a channel of their own", pure.human);
  checks.ok(!pure.detAndOcrKeys.some(k => /confidence/i.test(k)), "support() reports no combined confidence — nothing is averaged", pure.detAndOcrKeys);
  checks.equal(JSON.stringify(pure.keepsOwnConfidence), JSON.stringify([94, 91]), "each observation keeps its own confidence in its own units");

  // ---- a real analysis ---------------------------------------------------------
  await createBlankEvent(page, { name: "Observations", date: futureDate() });
  const plan = fs.readFileSync(path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png")).toString("base64");
  await importPlan(page, "data:image/png;base64," + plan);
  await runDetection(page);
  const real = await page.evaluate(() => {
    const O = globalThis.MeritObservations, a = state.events[0].analysis;
    const byId = new Map((a.observations || []).map(o => [o.id, o]));
    const cands = a.candidates;
    const withObs = cands.filter(c => (c.observationIds || []).length > 0).length;
    const dangling = cands.flatMap(c => (c.observationIds || []).filter(id => !byId.has(id))).length;
    const invalid = (a.observations || []).map(o => O.validate(o)).filter(p => p.length).length;
    const geometryMatches = cands.filter(c => {
      const o = byId.get((c.observationIds || [])[0]);
      return o && o.geometry && o.geometry.convention === "corner" && o.geometry.frame === "plan-percent"
        && o.geometry.x === c.x && o.geometry.y === c.y && o.geometry.w === c.w && o.geometry.h === c.h;
    }).length;
    const seats = cands.flatMap(c => (c.chairDetections || []).map(ch => ({ ch, c })));
    const seatsLinked = seats.filter(({ ch, c }) => ch.observedBy && (c.observationIds || []).includes(ch.observedBy)).length;
    const stage = cands.find(c => c.type === "stage" && c.typeBasis === "printedLabel");
    const stageObs = stage ? (stage.observationIds || []).map(id => byId.get(id)) : [];
    const firstTable = cands.find(c => c.kind === "table");
    const firstObs = byId.get(firstTable.observationIds[0]);
    const g = a.planIntelligence.sceneGraph;
    const nodes = (g.nodeList || []).filter(n => n.type === "physicalObject");
    return {
      candidates: cands.length, withObs, dangling, invalid, geometryMatches,
      seats: seats.length, seatsLinked,
      stage: stage ? { kinds: stageObs.map(o => o.source.kind), label: (stageObs.find(o => o.source.kind === "ocr") || {}).claim } : null,
      stageSupport: stage ? O.support(stageObs) : null,
      firstObs: { kind: firstObs.source.kind, provider: firstObs.source.provider, version: firstObs.source.version,
        scale: firstObs.confidence && firstObs.confidence.scale, value: firstObs.confidence && firstObs.confidence.value,
        sameAsCandidate: firstObs.confidence && firstObs.confidence.value === firstTable.confidence, imageRef: firstObs.imageRef, planHash: a.planHash },
      frames: a.frames,
      nodesWithObs: nodes.filter(n => Array.isArray(n.observationIds) && n.observationIds.length).length,
      nodes: nodes.length,
      nodeSources: [...new Set(nodes.map(n => n.source))],
    };
  });
  checks.ok(real.candidates > 40, "the Golden Plan was analysed", real.candidates);
  checks.equal(real.withObs, real.candidates, "every candidate carries at least one observation");
  checks.equal(real.dangling, 0, "every observation id on a candidate resolves");
  checks.equal(real.invalid, 0, "every stored observation validates");
  checks.equal(real.geometryMatches, real.candidates, "a candidate's geometry is its first observation's, as a corner box in plan percent");
  checks.ok(real.seats > 100 && real.seatsLinked === real.seats, "every seat names the observation that produced it", { seats: real.seats, linked: real.seatsLinked });
  checks.ok(real.stage && real.stage.kinds.includes("classical-cv") && real.stage.kinds.includes("ocr"), "the stage carries the detector's observation AND the OCR reading of its printed label", real.stage);
  checks.equal(real.stage && real.stage.label && real.stage.label.label, "SAHNE", "the label observation says what the drawing printed");
  checks.equal(real.stageSupport && real.stageSupport.independentChannels, 1, "and the two are ONE channel — the same raster — not independent confirmation");
  checks.equal(real.firstObs.kind, "classical-cv", "a detected table's observation names its source kind");
  checks.equal(real.firstObs.version, "2026-10-04", "and the detector build that made it");
  checks.ok(real.firstObs.scale === "provider-native-0-1" && real.firstObs.sameAsCandidate, "its confidence is the detector's own number, in the detector's own scale", real.firstObs);
  checks.ok(real.firstObs.imageRef && real.firstObs.imageRef === real.firstObs.planHash, "it names the image it was seen in (the plan hash)");
  checks.ok(real.frames && real.frames.conventions.candidate === "corner" && real.frames.conventions.seat === "centre"
    && real.frames.source.width === 1355 && real.frames.analysis.width === 1355, "the analysis records its frames and both box conventions", real.frames);
  checks.equal(real.nodesWithObs, real.nodes, "every object node in the scene graph carries its observation ids");
  checks.equal(JSON.stringify(real.nodeSources), JSON.stringify(["assistedDetection"]), "and a real source (nothing here was drawn or remembered)", real.nodeSources);

  // ---- stored and read back -------------------------------------------------
  await page.evaluate(() => saveState());
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => { try { return state.events.length === 1 && !!state.events[0].analysis; } catch { return false; } }, null, { timeout: 30000 });
  const back = await page.evaluate(() => {
    const a = state.events[0].analysis;
    return { obs: (a.observations || []).length, linked: a.candidates.filter(c => (c.observationIds || []).length).length, n: a.candidates.length };
  });
  checks.ok(back.obs > 0 && back.linked === back.n, "observations and their links survive save → reload", back);

  // An analysis stored before observations existed.
  const legacy = await page.evaluate(() => {
    const ev = state.events[0];
    delete ev.analysis.observations;
    for (const c of ev.analysis.candidates) { delete c.observationIds; for (const ch of c.chairDetections || []) delete ch.observedBy; }
    saveState();
    return true;
  });
  await page.waitForTimeout(800);
  await page.reload();
  const legacyOk = await page.waitForFunction(() => { try { return state.events.length === 1 && !!state.events[0].analysis; } catch { return false; } }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  const legacyRead = await page.evaluate(() => {
    const a = state.events[0].analysis, O = globalThis.MeritObservations;
    return { forCandidate: O.forCandidate(a, a.candidates[0]).length, support: O.support(O.forCandidate(a, a.candidates[0])).independentChannels };
  });
  checks.ok(legacy && legacyOk, "an analysis stored before observations existed still loads");
  checks.equal(legacyRead.forCandidate, 0, "and reads as 'no observations recorded', not as an error");
}
