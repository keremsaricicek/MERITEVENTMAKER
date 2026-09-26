// The trained encoder, checked where it actually runs.
//
// There are two implementations of the forward pass on purpose:
// benchmarks/embedding/encoder.mjs carries it with a gradient tape because the
// trainer needs backward, and src/plan-embedding.js carries a tight inference-
// only version because the app needs speed. Two implementations of one function
// is a real risk — every retrieval number in benchmarks/embedding/retrieval.json
// was produced by the Node one, and they only describe the shipped product if
// the browser one computes the same thing. So this asserts parity on real crops
// instead of assuming it.
//
// It also pins the honesty invariant that matters most here. The encoder has
// `trainedModel: true` and that is true — real weights fitted by gradient
// descent multiply real pixels. It does NOT mean a trained DOMAIN MODEL is
// installed: detection is still classical computer vision, and the screen still
// says DOMAIN MODEL NOT INSTALLED. Both must remain simultaneously true.
import fs from "node:fs";
import path from "node:path";
import { openApp } from "../lib/app-actions.mjs";

export const meta = {
  name: "plan-encoder",
  tags: ["intelligence"],
  timeout: 120000,
  viewport: { width: 1600, height: 1000 },
};

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const weightsFile = path.join(repoRoot, "src/plan-encoder-weights.js");
  const cropsFile = path.join(repoRoot, "benchmarks/embedding/crops.json");
  checks.require(fs.existsSync(weightsFile),
    "the generated weights module is present (scripts/build-encoder-module.mjs)", weightsFile);

  await openApp(page, baseUrl);

  // ---- the encoder is installed and declares itself honestly ---------------
  const info = await page.evaluate(() => {
    const E = globalThis.MeritPlanEncoder;
    const reg = globalThis.MeritVisualEmbedding;
    const p = reg.resolve();
    return {
      available: !!(E && E.available),
      parameters: globalThis.MERIT_PLAN_ENCODER_WEIGHTS?.parameters ?? null,
      licence: globalThis.MERIT_PLAN_ENCODER_WEIGHTS?.licence ?? null,
      trainedOn: globalThis.MERIT_PLAN_ENCODER_WEIGHTS?.trainedOn ?? null,
      providers: Object.keys(reg.providers),
      resolvedId: p.id, resolvedTrained: p.trainedModel, dims: p.dimensions,
      handcraftedTrained: reg.providers.handcrafted.trainedModel,
    };
  });

  checks.ok(info.available, "the encoder's weights are loaded in the page", info.parameters);
  checks.ok(info.providers.includes("learned") && info.providers.includes("handcrafted"),
    "both representations stay registered, so the comparison remains runnable", info.providers);
  checks.ok(info.resolvedId.startsWith("merit-plan-encoder"),
    "the learned representation is the one detection resolves to", info.resolvedId);
  checks.ok(info.resolvedTrained === true,
    "and it declares trainedModel true, because trained weights really do run", info.resolvedTrained);
  checks.ok(info.handcraftedTrained === false,
    "while the handcrafted descriptor still declares itself not a model", info.handcraftedTrained);
  checks.ok(/no third-party weights/i.test(info.licence || ""),
    "the checkpoint states its provenance — trained here, no third-party weights", info.licence);
  checks.ok(info.trainedOn && Array.isArray(info.trainedOn.plans) && info.trainedOn.plans.length > 0,
    "and records which plans it was trained on", info.trainedOn);

  // A provider that will not say whether it is a model cannot be installed.
  const rejected = await page.evaluate(() => {
    try {
      globalThis.MeritVisualEmbedding.register("bogus", { embed: () => [] });
      return "accepted";
    } catch (e) { return e.message; }
  });
  checks.ok(/trainedModel/.test(rejected),
    "a provider that does not declare trainedModel is refused registration", rejected);

  // ---- the browser forward pass matches the trainer's ----------------------
  // The crops are cut here from the tracked Golden Plan image rather than read
  // from benchmarks/embedding/crops.bin, which is derived data and is not
  // committed. That keeps this check running everywhere — including CI — on
  // real plan pixels, instead of skipping wherever the corpus was not built.
  const planPath = path.join(repoRoot, "benchmarks/plans/merit-real-venue-plan.png");
  const annotPath = path.join(repoRoot, "benchmarks/annotations/merit-real-venue.json");
  checks.require(fs.existsSync(planPath) && fs.existsSync(annotPath),
    "the Golden Plan and its annotation are present", planPath);
  const annot = JSON.parse(fs.readFileSync(annotPath, "utf8"));
  const objects = annot.objects.filter(o => o.w > 2 && o.h > 2);
  const step = Math.max(1, Math.floor(objects.length / 40));
  const boxes = [];
  for (let i = 0; i < objects.length && boxes.length < 40; i += step) {
    const o = objects[i];
    boxes.push({ id: o.id, cls: o.class,
      x: (o.cx - o.w / 2) / annot.source.width * 100, y: (o.cy - o.h / 2) / annot.source.height * 100,
      w: o.w / annot.source.width * 100, h: o.h / annot.source.height * 100 });
  }

  const dataUrl = "data:image/png;base64," + fs.readFileSync(planPath).toString("base64");
  const cut = await page.evaluate(async ([src, bxs]) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const gray = new Uint8Array(c.width * c.height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4)
      gray[i] = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0;
    return bxs.map(b => {
      const crop = globalThis.MeritPlanEncoder.cropOf(gray, c.width, c.height, b);
      return { pixels: Array.from(crop), vec: globalThis.MeritPlanEncoder.encode(crop) };
    });
  }, [dataUrl, boxes]);

  const { forward, deserialise } = await import("../../benchmarks/embedding/encoder.mjs");
  const json = JSON.parse(fs.readFileSync(path.join(repoRoot, "benchmarks/embedding/encoder-weights.json"), "utf8"));
  const weights = deserialise(json);

  let worst = 0, worstAt = null;
  for (let i = 0; i < cut.length; i++) {
    const nodeVec = forward(weights, Uint8Array.from(cut[i].pixels));
    checks.require(cut[i].vec && cut[i].vec.length === nodeVec.length,
      "each browser embedding has the trainer's dimensionality",
      { object: boxes[i].id, got: cut[i].vec?.length, want: nodeVec.length });
    for (let j = 0; j < nodeVec.length; j++) {
      const diff = Math.abs(nodeVec[j] - cut[i].vec[j]);
      if (diff > worst) { worst = diff; worstAt = `${boxes[i].id}[${j}]`; }
    }
  }
  // Float32 in the browser against Float64 in the trainer, so exact equality is
  // not the bar; agreement far below anything that could reorder a
  // nearest-neighbour lookup is.
  checks.ok(worst < 1e-4,
    "the browser forward pass matches the trainer's on real Golden Plan crops",
    { crops: cut.length, worstAbsoluteDifference: worst, at: worstAt });

  const norms = cut.map(c => Math.sqrt(c.vec.reduce((s, x) => s + x * x, 0)));
  checks.ok(norms.every(n => Math.abs(n - 1) < 1e-5),
    "every embedding is a unit vector, so cosine distance means what it says",
    norms.slice(0, 3));

  // Different objects must not collapse to one direction. A trained encoder
  // that maps everything to the same vector scores perfectly on invariance and
  // is useless, and that failure is silent without this.
  let maxPairCos = -1;
  for (let i = 0; i < cut.length; i++) for (let j = i + 1; j < cut.length; j++) {
    let s = 0;
    for (let k = 0; k < cut[i].vec.length; k++) s += cut[i].vec[k] * cut[j].vec[k];
    if (boxes[i].cls !== boxes[j].cls) maxPairCos = Math.max(maxPairCos, s);
  }
  checks.ok(maxPairCos < 0.999,
    "objects of different classes do not collapse onto one embedding direction",
    { mostSimilarCrossClassPair: maxPairCos });

  // ---- an encoder is not a detector ---------------------------------------
  const honesty = await page.evaluate(() => {
    const out = { en: null, tr: null };
    const was = ui.lang;
    ui.lang = "en"; out.en = t("diag.notInstalled");
    ui.lang = "tr"; out.tr = t("diag.notInstalled");
    ui.lang = was;
    return out;
  });
  checks.ok(/DOMAIN MODEL NOT INSTALLED/.test(honesty.en),
    "shipping a trained encoder does not change what the screen says about a domain model", honesty.en);
  checks.ok(/ALAN MODELİ KURULU DEĞİL/.test(honesty.tr),
    "in Turkish too", honesty.tr);
}
