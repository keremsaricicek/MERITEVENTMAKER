// Every human decision on a plan leaves a record with the real pixels in it.
//
// The failure this guards against is not a crash. It is a dataset that looks
// full and is worthless: crops that are blank, examples that do not say which
// plan they came from, corrections with no record of what the detector had
// predicted, or forty auto-propagated labels counted as forty human decisions.
// Each of those produces a confident number later that means nothing, so each
// is asserted on the stored record rather than on the UI having reacted.
//
// Slow: it runs the real detector on the real plan to get real candidates to
// decide about.
import fs from "node:fs";
import path from "node:path";
import { click, openApp, createBlankEvent } from "../lib/app-actions.mjs";

export const meta = {
  name: "training-data-capture",
  tags: ["intelligence", "slow"],
  timeout: 300000,
  viewport: { width: 1800, height: 1000 },
};

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const planPath = path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png");
  checks.require(fs.existsSync(planPath), "the real venue plan is present", planPath);

  await openApp(page, baseUrl);
  checks.require(await page.evaluate(() => !!globalThis.MeritTrainingData),
    "the training-data module is loaded");

  await createBlankEvent(page, { name: "Capture", hotel: "Merit Starlit", date: "2026-10-02", salon: "Main Ballroom" });
  const planBytes = fs.readFileSync(planPath);
  await page.evaluate(src => {
    state.events[0].background = { src, name: "merit-real-venue-plan.png", opacity: 1, visible: true, locked: false, scale: 100 };
    render();
  }, "data:image/png;base64," + planBytes.toString("base64"));
  await page.waitForTimeout(400);

  await click(page, '[data-v8-action="detect"]');
  await page.waitForFunction(() => !!state.events[0].analysis, null, { timeout: 240000 });
  await page.waitForTimeout(800);
  checks.require(await page.evaluate(() => state.events[0].analysis.candidates.length > 4),
    "the detector produced candidates to decide about");

  const started = await page.evaluate(() => (state.trainingData || []).length);
  checks.ok(started === 0, "detection alone captures nothing — only a human decision does", started);

  // --- a confirmation ------------------------------------------------------
  await decide(page, "confirm");
  // --- a rejection: the detector found something that is not there ---------
  await decide(page, "reject");
  // --- a correction: right object, wrong name ------------------------------
  const target = await page.evaluate(async () => {
    const e = state.events[0];
    const c = e.analysis.candidates.find(x => x.status === "unreviewed" && x.kind === "table");
    if (!c) return null;
    ui.selectedCandidateId = c.id;
    render();
    await new Promise(r => setTimeout(r, 300));
    return { id: c.id, kind: c.kind, type: c.type };
  });
  checks.require(target, "there was an unreviewed table to reclassify");
  // Through the real dropdown, not a closure-scoped function: the point is
  // that the operator's own path captures the example.
  await page.selectOption('[data-candidate-edit="kindtype"]', "venue:column");
  await page.waitForFunction(id => state.events[0].analysis.candidates.find(c => c.id === id)?.kind === "venue",
    target.id, { timeout: 10000 });
  await page.waitForTimeout(700);
  // --- a dismissal: a real region the operator says is not important -------
  // Distinct from a rejection: "not an object" says the detector saw nothing;
  // "not important" says the thing is there and is not something we track.
  await decide(page, "dismiss");

  await page.waitForFunction(() => (state.trainingData || []).length >= 4, null, { timeout: 20000 })
    .catch(() => {});

  const records = await page.evaluate(() => state.trainingData || []);
  checks.require(records.length >= 4,
    "four decisions produced at least four captured examples", { captured: records.length });

  const types = new Set(records.map(r => r.decisionType));
  for (const type of ["confirmation", "falsePositive", "correction", "negative"]) {
    checks.ok(types.has(type), `a ${type} was captured`, [...types]);
  }
  checks.ok(types.has("negative"),
    "dismissing a region stores a negative example instead of deleting the evidence");

  // --- provenance ----------------------------------------------------------
  const hashes = new Set(records.map(r => r.plan?.planHash));
  checks.ok(hashes.size === 1 && [...hashes][0] && /^[0-9a-f]{64}$/.test([...hashes][0]),
    "every example names the plan it came from, by a real content hash", [...hashes]);

  const expectedHash = await sha256(planBytes);
  checks.ok([...hashes][0] === expectedHash,
    "the recorded hash is the hash of the actual plan file, so a swapped image is detectable",
    { recorded: [...hashes][0], file: expectedHash });

  const context = records[0].context;
  checks.ok(context.eventId && context.venueId && context.layoutId,
    "each example records the event, venue and layout it belongs to", context);

  checks.ok(records.every(r => r.providers?.detection?.trainedModel === false),
    "each example records which detector produced the prediction, and that it was not a trained model",
    records[0].providers);

  // The visual representation IS a trained model now — 5,656 parameters fitted
  // by gradient descent, see benchmarks/embedding/README.md. What this asserts
  // is not a fixed answer but that the captured provenance tells the TRUTH
  // about whichever representation ran, because the whole value of a stored
  // example is knowing what produced it. An installation without the weights
  // records the descriptor and `false`; one with them records the encoder and
  // `true`. What must never happen is the flag disagreeing with the provider
  // that is actually installed.
  const liveEmbedding = await page.evaluate(() => {
    const p = globalThis.MeritVisualEmbedding.resolve();
    return { id: p.id, trainedModel: p.trainedModel };
  });
  checks.ok(records.every(r => r.providers?.embedding?.id === liveEmbedding.id),
    "each example names the visual representation that was actually active",
    { recorded: records[0].providers?.embedding, live: liveEmbedding });
  checks.ok(records.every(r => r.providers?.embedding?.trainedModel === liveEmbedding.trainedModel),
    "and its trainedModel flag matches what that representation really is",
    { recorded: records[0].providers?.embedding?.trainedModel, live: liveEmbedding.trainedModel });
  checks.ok(records.every(r => typeof r.providers?.embedding?.trainedModel === "boolean"),
    "never left undefined — a missing flag reads as 'not a model' and would be a lie either way",
    records[0].providers?.embedding);

  // --- the record shape a decision type implies ----------------------------
  const correction = records.find(r => r.decisionType === "correction");
  checks.ok(correction?.predictionBefore?.kind && correction.predictionBefore.type,
    "a correction keeps what the detector had said, not just the answer", correction?.predictionBefore);
  checks.ok(correction?.humanTruth?.kind,
    "and what the human said instead", correction?.humanTruth);
  checks.ok(correction.predictionBefore.kind !== correction.humanTruth.kind
    || correction.predictionBefore.type !== correction.humanTruth.type,
    "a correction is a disagreement — the two differ",
    { before: correction.predictionBefore, after: correction.humanTruth });

  const falsePositive = records.find(r => r.decisionType === "falsePositive");
  checks.ok(falsePositive?.predictionBefore && falsePositive.humanTruth === null,
    "a false positive keeps the prediction and has no human label, because there is no object",
    { predictionBefore: !!falsePositive?.predictionBefore, humanTruth: falsePositive?.humanTruth });

  checks.ok(records.every(r => Number.isFinite(r.geometry?.rotation)),
    "every example keeps its rotation — nothing is normalised to axis-aligned",
    records.map(r => r.geometry?.rotation).slice(0, 4));

  // --- propagated labels are marked as such --------------------------------
  const propagated = records.filter(r => /propagated from/.test(r.note || ""));
  const individual = records.filter(r => !r.note || !/propagated|in bulk/.test(r.note));
  checks.ok(individual.length >= 4,
    "the decisions a person actually made are distinguishable from the ones spread for them",
    { individual: individual.length, propagated: propagated.length });
  if (propagated.length) {
    checks.ok(propagated.every(r => /not individually reviewed/.test(r.note)),
      "a propagated label says plainly that no person looked at it", propagated[0].note);
  }

  // --- the crops are real pixels -------------------------------------------
  const crops = await page.evaluate(async () => {
    const out = [];
    for (const record of (state.trainingData || []).slice(0, 6)) {
      if (!record.crop?.blobId) { out.push({ id: record.id, missing: true }); continue; }
      const dataUrl = await MERIT_STORAGE_PROVIDER.getBlob(record.crop.blobId);
      if (!dataUrl) { out.push({ id: record.id, missing: true }); continue; }
      // Decode it and measure: a crop that is one flat colour is a bug that
      // looks exactly like a working one in a file listing.
      const image = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      canvas.getContext("2d").drawImage(image, 0, 0);
      const px = canvas.getContext("2d").getImageData(0, 0, image.width, image.height).data;
      let min = 255, max = 0;
      for (let i = 0; i < px.length; i += 4) {
        const luma = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
        if (luma < min) min = luma;
        if (luma > max) max = luma;
      }
      const w = image.width, h = image.height;
      image.close();
      out.push({ id: record.id, w, h, bytes: dataUrl.length, contrast: max - min,
        sourceRect: record.crop.sourceRect });
    }
    return out;
  });
  checks.ok(crops.every(c => !c.missing), "every captured example has a stored crop", crops.filter(c => c.missing));
  checks.ok(crops.every(c => c.w === 96 && c.h === 96),
    "crops are a fixed size, so a later model sees a consistent input", crops.map(c => `${c.w}x${c.h}`));
  checks.ok(crops.every(c => c.contrast > 20),
    "each crop contains actual plan content, not a blank square", crops.map(c => c.contrast));
  checks.ok(crops.every(c => c.sourceRect && Number.isFinite(c.sourceRect.x) && c.sourceRect.w > 0),
    "each crop records which source pixels it is, so it can be traced back to the plan", crops[0]?.sourceRect);

  // --- crops live outside the state blob -----------------------------------
  const storage = await page.evaluate(async () => ({
    blobIds: (await MERIT_STORAGE_PROVIDER.listBlobIds()).length,
    stateHasPixels: JSON.stringify(state.trainingData).includes("data:image"),
  }));
  checks.ok(storage.blobIds >= 4, "the crops are in the blob store", storage);
  checks.ok(!storage.stateHasPixels,
    "and not inlined into the state record, which every ordinary save has to serialise", storage);

  // --- and all of it survives a reload -------------------------------------
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(900);
  const after = await page.evaluate(async () => {
    const records = state.trainingData || [];
    const first = records[0];
    const crop = first?.crop?.blobId ? await MERIT_STORAGE_PROVIDER.getBlob(first.crop.blobId) : null;
    return { count: records.length, planHash: first?.plan?.planHash, cropBytes: crop ? crop.length : 0 };
  });
  checks.ok(after.count === records.length, "every example survived a reload", after);
  checks.ok(after.cropBytes > 100, "and its crop came back with it", after);

  // --- the summary refuses to oversell what this is ------------------------
  const summary = await page.evaluate(() => MeritTrainingData.summarise(state.trainingData || []));
  checks.ok(summary.distinctPlans === 1, "the summary counts distinct plans, not examples", summary);
  checks.ok(/NOT ENOUGH DISTINCT PLANS/.test(summary.readiness),
    "one plan is reported as a capture log, never as a training set", summary.readiness);

  // --- the export is portable, honest, and split without leaking -----------
  const dataset = await page.evaluate(() => MERIT_TRAINING_EXPORT());
  checks.ok(dataset.format === "merit-training-dataset" && dataset.formatVersion >= 1,
    "the export names its own format and version", { format: dataset.format, version: dataset.formatVersion });
  checks.ok(dataset.examples.length === records.length, "every captured decision is in the file", dataset.examples.length);
  checks.ok(dataset.examples.every(e => typeof e.crop?.dataUrl === "string" && e.crop.dataUrl.startsWith("data:image/png")),
    "each exported example carries its actual crop, inline", dataset.cropsMissing);
  checks.ok(dataset.cropsMissing === 0, "no crop was silently replaced with a blank image", dataset.cropsMissing);
  checks.ok(dataset.trainedModel === false && /No model was trained/i.test(dataset.producedBy),
    "the file says plainly that no model produced it", dataset.producedBy);

  const splitCounts = dataset.split.counts;
  checks.ok(splitCounts.train + splitCounts.val + splitCounts.test === records.length,
    "the split covers every example exactly once", splitCounts);
  checks.ok(/grouped by plan/.test(dataset.split.method),
    "the split is by plan, not by example", dataset.split.method);
  const planSplits = dataset.split.plans;
  const planAppearsIn = ["train", "val", "test"].filter(name => planSplits[name].length > 0);
  checks.ok(planAppearsIn.length === 1,
    "with one plan, every example lands on one side — nothing leaks across the split", planSplits);
  checks.ok(typeof dataset.split.warning === "string" && /generalisation/.test(dataset.split.warning),
    "and the file says outright that one plan proves nothing about a new venue", dataset.split.warning);

  // A dataset from several plans must actually distribute them.
  const grouped = await page.evaluate(() => {
    const fake = [];
    for (let plan = 0; plan < 6; plan++) {
      for (let i = 0; i < 5; i++) {
        fake.push({ id: `e${plan}_${i}`, plan: { planHash: `hash${plan}` }, decisionType: "confirmation", humanTruth: { kind: "table" } });
      }
    }
    const split = MeritTrainingData.splitByPlan(fake);
    const where = {};
    for (const name of ["train", "val", "test"]) {
      for (const record of split[name]) {
        const hash = record.plan.planHash;
        (where[hash] ||= new Set()).add(name);
      }
    }
    return {
      counts: { train: split.train.length, val: split.val.length, test: split.test.length },
      plansInMoreThanOneSplit: Object.entries(where).filter(([, s]) => s.size > 1).map(([h]) => h),
      splitsUsed: Object.values(split.plansPerSplit).filter(list => list.length).length,
      warning: split.warning,
    };
  });
  checks.ok(grouped.plansInMoreThanOneSplit.length === 0,
    "no plan appears in two splits — the leak this exists to prevent", grouped.plansInMoreThanOneSplit);
  checks.ok(grouped.splitsUsed === 3, "six plans reach all three splits", grouped);
  checks.ok(grouped.warning === null, "and six plans no longer carry the one-plan warning", grouped.warning);
}

async function decide(page, action) {
  await page.evaluate(async act => {
    const e = state.events[0];
    const target = e.analysis.candidates.find(c => c.status === "unreviewed");
    if (!target) return;
    ui.selectedCandidateId = target.id;
    render();
    await new Promise(r => setTimeout(r, 250));
    document.querySelector(`[data-review-action="${act}"]`)?.click();
    await new Promise(r => setTimeout(r, 700));
  }, action);
  await page.waitForTimeout(400);
}

async function sha256(bytes) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}
