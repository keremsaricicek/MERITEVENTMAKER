(() => {
  "use strict";
  // MeritTrainingData — what a human decision leaves behind.
  //
  // Until now a correction changed a candidate's class and was remembered by
  // geometry so it would survive Re-Analyze. That is enough to keep one plan
  // tidy and useless as training data: it records the answer without the
  // question. Nothing kept the pixels the person was looking at, what the
  // detector had said before they disagreed, which plan and which version of
  // the venue it came from, or which build of the detector produced the
  // prediction. A dataset without those cannot be evaluated later, cannot be
  // split without leaking, and cannot be reproduced at all.
  //
  // So every decision becomes a record with the crop in it. This is a data
  // foundation and nothing more: it does not train anything, it does not
  // change a detection, and capturing a thousand crops does not make a model
  // exist. `trainedModel` stays false everywhere until real weights are
  // installed, and this module never sets it.
  //
  // Five decision types, all first-class:
  //
  //   confirmation   the detector was right, and a person said so
  //   correction     the detector found a real object and named it wrong
  //   falsePositive  the detector found something that is not there
  //   missedObject   a real object the detector never proposed
  //   negative       "ignore this" — a real region a person marked as not
  //                  interesting. Stored, never deleted: knowing what to
  //                  ignore is signal, and a delete throws it away.
  //
  // A confirmation is as valuable as a correction. A dataset of only the
  // detector's mistakes teaches a model that everything is a mistake.

  const DECISION_TYPES = ["confirmation", "correction", "falsePositive", "missedObject", "negative"];

  // A decision type says which side of the record must be present. Recording
  // a "correction" with no prediction, or a "missedObject" that claims to
  // have one, is a malformed example that would quietly poison an evaluation,
  // so it is refused at capture time rather than filtered later.
  const SHAPE = {
    confirmation:  { predictionBefore: true,  humanTruth: true },
    correction:    { predictionBefore: true,  humanTruth: true },
    falsePositive: { predictionBefore: true,  humanTruth: false },
    missedObject:  { predictionBefore: false, humanTruth: true },
    negative:      { predictionBefore: null,  humanTruth: false },  // null = either
  };

  const CROP_SIZE = 96;        // px, square, the crop written to storage
  const CROP_PADDING = 0.35;   // of the object's own span, so context is kept
  const SCHEMA_VERSION = 1;

  const nowISO = () => new Date().toISOString();
  const uid = prefix => `${prefix}_${(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2))}`;

  // ---- plan identity -------------------------------------------------------
  // A dataset that cannot tell two plans apart cannot be split without
  // leaking, and one that cannot notice a plan was swapped will happily
  // compare numbers from different images. The hash is of the actual bytes.
  async function planFingerprint(dataUrl) {
    if (typeof dataUrl !== "string" || !dataUrl) return null;
    const comma = dataUrl.indexOf(",");
    const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    let bytes;
    try {
      const binary = atob(payload);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
      bytes = new TextEncoder().encode(payload);
    }
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // ---- the crop ------------------------------------------------------------
  // Real pixels from the real plan, at a fixed size so a later model sees a
  // consistent input, with padding so the object is not cut out of its
  // context. `sourceRect` records exactly which pixels these are, in source
  // coordinates, so the crop can always be traced back to the plan.
  async function cropFromImage(image, geometryPct, { size = CROP_SIZE, padding = CROP_PADDING } = {}) {
    const W = image.width, H = image.height;
    const x = (geometryPct.x / 100) * W;
    const y = (geometryPct.y / 100) * H;
    const w = (geometryPct.w / 100) * W;
    const h = (geometryPct.h / 100) * H;
    // Square window around the object's centre: a fixed aspect keeps the
    // stored crops comparable, and stretching a rectangle to a square would
    // distort exactly the shape a classifier needs.
    const span = Math.max(w, h) * (1 + padding * 2);
    const cx = x + w / 2, cy = y + h / 2;
    const half = Math.max(4, span / 2);
    const sx = Math.round(cx - half), sy = Math.round(cy - half);
    const side = Math.round(half * 2);

    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    // Anything outside the plan is left as the plan's own background rather
    // than transparent, so an edge object does not train on a black band.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);
    return {
      dataUrl: canvas.toDataURL("image/png"),
      size,
      sourceRect: { x: sx, y: sy, w: side, h: side },
      objectRect: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) },
      padding,
    };
  }

  async function imageFromDataUrl(src) {
    if (globalThis.createImageBitmap) {
      const response = await fetch(src);
      const blob = await response.blob();
      return createImageBitmap(blob);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("The plan image could not be decoded for cropping."));
      img.src = src;
    });
  }

  // ---- the record ----------------------------------------------------------
  function buildRecord(input) {
    const {
      decisionType, plan, context, geometry, predictionBefore, humanTruth,
      providers, descriptor, crop, note,
    } = input;

    if (!DECISION_TYPES.includes(decisionType)) {
      throw new Error(`Unknown decisionType "${decisionType}". Expected one of: ${DECISION_TYPES.join(", ")}.`);
    }
    const shape = SHAPE[decisionType];
    if (shape.predictionBefore === true && !predictionBefore) {
      throw new Error(`A "${decisionType}" needs the prediction the human disagreed with; without it the example teaches nothing.`);
    }
    if (shape.predictionBefore === false && predictionBefore) {
      throw new Error(`A "${decisionType}" is by definition something the detector never proposed, so it cannot carry a prediction.`);
    }
    if (shape.humanTruth === true && !humanTruth) {
      throw new Error(`A "${decisionType}" needs the human's answer.`);
    }
    if (!plan || !plan.planHash) {
      throw new Error("Every example must name the plan it came from, by hash — otherwise a dataset cannot be split without leaking.");
    }
    if (!geometry || ![geometry.x, geometry.y, geometry.w, geometry.h].every(Number.isFinite)) {
      throw new Error("Every example needs the geometry it was taken from.");
    }

    return {
      id: uid("example"),
      schemaVersion: SCHEMA_VERSION,
      capturedAt: nowISO(),
      decisionType,
      plan: {
        planHash: plan.planHash,
        name: plan.name ?? null,
        width: plan.width ?? null,
        height: plan.height ?? null,
      },
      context: {
        eventId: context?.eventId ?? null,
        venueId: context?.venueId ?? null,
        layoutId: context?.layoutId ?? null,
        layoutVersionId: context?.layoutVersionId ?? null,
      },
      geometry: {
        // Percent of the plan, matching how the detector stores candidates,
        // plus rotation — which is never normalised away, because an
        // axis-aligned rewrite loses the one thing an oriented detector needs.
        x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h,
        rotation: Number.isFinite(geometry.rotation) ? geometry.rotation : 0,
      },
      predictionBefore: predictionBefore ? {
        kind: predictionBefore.kind ?? null,
        type: predictionBefore.type ?? null,
        confidence: Number.isFinite(predictionBefore.confidence) ? predictionBefore.confidence : null,
        source: predictionBefore.source ?? null,
        candidateId: predictionBefore.candidateId ?? null,
      } : null,
      humanTruth: humanTruth ? {
        kind: humanTruth.kind ?? null,
        type: humanTruth.type ?? null,
        seats: humanTruth.seats ?? null,
        seatsConfidence: humanTruth.seatsConfidence ?? null,
      } : null,
      // Which build said what. Two examples captured months apart are only
      // comparable if it is knowable whether the detector changed in between.
      providers: {
        detection: providers?.detection ?? null,
        embedding: providers?.embedding ?? null,
      },
      // The handcrafted descriptor at capture time, so a learned
      // representation can later be compared against the thing it claims to
      // beat, on the same objects.
      descriptor: descriptor ?? null,
      crop: crop ? {
        blobId: crop.blobId,
        size: crop.size,
        sourceRect: crop.sourceRect,
        objectRect: crop.objectRect,
        padding: crop.padding,
        encoding: "image/png",
      } : null,
      note: note ?? null,
    };
  }

  // ---- leakage-safe splitting ---------------------------------------------
  // Every crop from one plan goes to one side. Splitting crops at random puts
  // forty chairs from the same drawing on both sides of the line and turns a
  // memorised plan into a "95% accurate" model. Grouping by plan hash is the
  // whole point; the split is by plan, and the reported counts are of
  // examples, so a wildly unbalanced split is visible rather than assumed.
  function splitByPlan(records, { train = 0.7, val = 0.15, seed = 1 } = {}) {
    const byPlan = new Map();
    for (const record of records) {
      const key = record.plan?.planHash || "unknown";
      if (!byPlan.has(key)) byPlan.set(key, []);
      byPlan.get(key).push(record);
    }
    // Deterministic order from the hash itself, so the same dataset always
    // splits the same way without storing a shuffle.
    const plans = [...byPlan.keys()].sort((a, b) => {
      const ha = mix(a, seed), hb = mix(b, seed);
      return ha === hb ? a.localeCompare(b) : ha - hb;
    });
    const out = { train: [], val: [], test: [], plansPerSplit: { train: [], val: [], test: [] } };
    // Allocated by plan count, not by a fraction of a position. Rounding a
    // ratio leaves the test split empty for small plan counts -- six plans at
    // 70/15/15 put all six in train and val -- and an evaluation against an
    // empty test set reports nothing while looking like it ran. Below three
    // plans no split is meaningful at all, so everything stays in train and
    // the warning below says why.
    const total = plans.length;
    let trainCount, valCount;
    if (total < 3) {
      trainCount = total; valCount = 0;
    } else {
      trainCount = Math.max(1, Math.round(total * train));
      valCount = Math.max(1, Math.round(total * val));
      while (trainCount + valCount > total - 1) {
        if (valCount > 1) valCount--; else trainCount--;
      }
    }
    plans.forEach((planHash, index) => {
      const split = index < trainCount ? "train" : index < trainCount + valCount ? "val" : "test";
      out[split].push(...byPlan.get(planHash));
      out.plansPerSplit[split].push(planHash);
    });
    out.warning = plans.length < 3
      ? `Only ${plans.length} distinct plan(s) in this dataset. A split cannot say anything about generalisation to a new venue — every example in it comes from ${plans.length === 1 ? "one drawing" : "these drawings"}.`
      : null;
    return out;
  }

  function mix(text, seed) {
    let h = 2166136261 ^ seed;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }

  // ---- summary -------------------------------------------------------------
  function summarise(records) {
    const byType = {};
    for (const type of DECISION_TYPES) byType[type] = 0;
    const plans = new Set(), classes = {};
    for (const record of records) {
      byType[record.decisionType] = (byType[record.decisionType] || 0) + 1;
      if (record.plan?.planHash) plans.add(record.plan.planHash);
      const label = record.humanTruth?.kind;
      if (label) classes[label] = (classes[label] || 0) + 1;
    }
    return {
      total: records.length,
      byDecisionType: byType,
      distinctPlans: plans.size,
      labelledClasses: classes,
      withCrops: records.filter(r => r.crop?.blobId).length,
      // Said plainly rather than left for a reader to infer from a small
      // number: this is the sentence that stops "we have a dataset" becoming
      // "we have a model".
      readiness: plans.size < 3
        ? "NOT ENOUGH DISTINCT PLANS — this is a capture log, not a training set."
        : records.length < 500
          ? "TOO FEW EXAMPLES to evaluate a learned detector against the classical pipeline."
          : "Enough examples to attempt an evaluation. Whether a learned model beats the classical pipeline is still an open question until measured.",
    };
  }

  globalThis.MeritTrainingData = {
    DECISION_TYPES, SCHEMA_VERSION, CROP_SIZE, CROP_PADDING,
    planFingerprint, cropFromImage, imageFromDataUrl,
    buildRecord, splitByPlan, summarise,
  };
})();
