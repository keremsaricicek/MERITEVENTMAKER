// The detection pipeline's boundary, which is the only thing the extraction
// actually bought.
//
// Moving 2,809 lines into src/plan-detection-classical.js is worth nothing on
// its own — the same code runs either way. What it buys is a SEAM: one object
// the app reaches the detector through, and a file that cannot reach back.
// A seam nothing enforces closes again the first time someone needs a helper
// "just this once", and the file is then 2,809 lines in a different place.
//
// So this suite asserts the seam, from both sides:
//
//   1. app-v8.js calls NOTHING in that file by name except the registry.
//   2. the registry is the single entry, and its shape is the contract a
//      future ONNX/YOLO provider would have to implement.
//   3. the honesty metadata (`trainedModel: false`) survives the move —
//      .claude/rules/ai.md forbids implying a trained model exists, and a
//      refactor is exactly the kind of change that quietly drops a flag.
//   4. the two values that used to be read across the seam now travel as
//      arguments and return fields, not as shared bindings.
//
// It reads CODE, not text: both files are full of comments naming these
// functions (this one included), and a grep-shaped rule would fire on all of
// them.
import fs from "node:fs";
import path from "node:path";
import { openApp } from "../lib/app-actions.mjs";
import { stripCommentsAndStrings, matchLines } from "../lib/js-scan.mjs";

export const meta = { name: "plan-detection-boundary", tags: ["business", "fast"], timeout: 60000 };

// The whole public surface. Everything else in the file is internal.
//
//   MERIT_PLAN_DETECTION    the registry — the app's only way in.
//   MERIT_STAGE_CENSUS      the per-stage diagnostic census, populated only
//                           under MERIT_DETECT_DEBUG and read by
//                           benchmarks/heldout/ornek-stage-walk.mjs — the tool
//                           CLAUDE.md names for "diagnose before theorising".
//                           Measurement surface; the product never reads it.
//
// Adding to this set is a decision about what the pipeline promises. Do not
// widen it to make a failing check pass.
// `MeritSymbolFamilyMember` was here until Split A-7 moved the predicate to
// `src/plan-detection-size-prior.js`. It is still published under exactly that
// name, by that file now, and `symbol-family` still reaches it through the
// global — a move must not rename a published surface. The pipeline no longer
// exports it, which is what the check below now means.
const PUBLIC = new Set(["MERIT_PLAN_DETECTION", "MERIT_STAGE_CENSUS"]);

export default async function run({ page, checks, baseUrl, repoRoot }) {
  const detFile = path.join(repoRoot, "src", "plan-detection-classical.js");
  checks.require(fs.existsSync(detFile),
    "the detection pipeline lives in its own file", "src/plan-detection-classical.js");

  const detCode = stripCommentsAndStrings(fs.readFileSync(detFile, "utf8"));
  const v8Code = stripCommentsAndStrings(fs.readFileSync(path.join(repoRoot, "src", "app-v8.js"), "utf8"));

  // --- 1. the file is a closed scope -------------------------------------
  checks.ok(detCode.trimStart().startsWith("(()"),
    "the pipeline is wrapped in its own IIFE, so its helpers are not on the global object where anything could reach them",
    detCode.trimStart().slice(0, 40));

  const exported = [...detCode.matchAll(/globalThis\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]);
  const unexpected = exported.filter((n) => !PUBLIC.has(n));
  checks.equal(unexpected.length, 0,
    "the file exports ONLY its registry and the debug census — every other name stays inside the IIFE",
    { exported: [...new Set(exported)], unexpected });

  // --- 2. neither side reaches past the seam ------------------------------
  // Every top-level binding of each file, INCLUDING every declarator on a
  // comma-separated line. That detail is not pedantry: the first version of
  // this extraction left `SKEW_MIN_DEG` (the third name on a four-name
  // `const` line) behind in the shell while its value moved, and every real
  // detection threw ReferenceError. Static checks that only see the first
  // declarator would have called that extraction clean.
  const bindings = (text) => {
    const names = new Set();
    for (const m of text.matchAll(/(?:^|\n)  (?:async )?function ([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of text.matchAll(/(?:^|\n)  (?:const|let|var)\s+([^\n;]*)/g)) {
      let depth = 0, cur = "";
      const parts = [];
      for (const ch of m[1]) {
        if ("([{".includes(ch)) depth++;
        else if (")]}".includes(ch)) depth--;
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
        cur += ch;
      }
      parts.push(cur);
      for (const p of parts) {
        const n = p.trim().match(/^([A-Za-z_$][\w$]*)/);
        if (n) names.add(n[1]);
      }
    }
    return names;
  };

  const detBindings = bindings(detCode);
  const v8Bindings = bindings(v8Code);
  for (const n of PUBLIC) detBindings.delete(n);

  // THE NEXT TWO CHECKS ARE ONLY WORTH ANYTHING IF `bindings()` REALLY WORKED.
  // If it ever returned an empty or tiny set — a parser change, a style change
  // in the file, a regex that stopped matching — `reaches` and `shellOnly`
  // would both be trivially empty and this suite would be green while checking
  // nothing.
  //
  // That used to be asserted as `size > 30`, and Split A broke it by
  // succeeding: the pipeline's private surface is SHRINKING on purpose, one
  // group at a time, and the count reached exactly 30. A floor that fails as
  // the intended work proceeds is a miscalibrated proxy, and lowering it each
  // time it bites would be a check that never says anything.
  //
  // So the guard is a POSITIVE CONTROL instead — names that are still in the
  // file and must be found — plus a floor low enough to survive the rest of
  // Split A and high enough to catch an extractor that collapsed.
  const mustFind = ["otsu", "CLASSICAL_CV_PROVIDER", "estimatePlanSkew", "GEO", "PRIOR"];
  const missing = mustFind.filter((n) => !detBindings.has(n));
  checks.equal(missing.length, 0,
    "the binding extractor really found the pipeline's own names — a positive control, so an extractor that silently stopped matching cannot leave the next two checks vacuously green",
    { missing, found: detBindings.size });
  checks.ok(detBindings.size >= 10,
    "and the private surface is still substantial. This floor is a sanity check on the parser, NOT a target: it is expected to keep falling as Split A proceeds",
    detBindings.size);

  // A bare identifier, never a property access: `provider.estimatePlanSkew()`
  // IS the sanctioned path and must not read as a violation.
  const bareUses = (text) =>
    new Set([...text.matchAll(/(^|[^\w.$])([A-Za-z_$][\w$]*)\s*(?![\s]*:)/g)].map((m) => m[2]));

  const v8Bare = bareUses(v8Code);
  const reaches = [...detBindings].filter((n) => v8Bare.has(n) && !v8Bindings.has(n));
  checks.equal(reaches.length, 0,
    "app-v8.js resolves no name that is bound only inside the detection pipeline — it goes through the registry. A name here is not a style complaint: it is a ReferenceError at runtime, and it is how the first attempt at this extraction broke every real detection",
    reaches);

  const detBare = bareUses(detCode);
  const shellOnly = [...v8Bindings].filter((n) => detBare.has(n) && !detBindings.has(n) && !PUBLIC.has(n));
  checks.equal(shellOnly.length, 0,
    "and the pipeline resolves no name that is bound only inside app-v8.js — everything it needs from the app arrives as an argument",
    shellOnly);

  // Copied, not moved, is the other way a split goes wrong: two detectors that
  // drift apart is worse than one in the wrong file.
  const v8Defines = new Set();
  for (const m of v8Code.matchAll(/(?:^|\n)  (?:async )?function ([A-Za-z_$][\w$]*)/g)) v8Defines.add(m[1]);
  const duplicated = [...detBindings].filter((n) => v8Defines.has(n));
  checks.equal(duplicated.length, 0,
    "no function was COPIED rather than moved", duplicated);

  // --- 3. the contract, live in the browser -------------------------------
  await openApp(page, baseUrl);

  const reg = await page.evaluate(() => {
    const r = globalThis.MERIT_PLAN_DETECTION;
    if (!r) return null;
    const p = r.resolve();
    return {
      hasResolve: typeof r.resolve === "function",
      trainedModelInstalled: r.trainedModelInstalled,
      providerIds: Object.keys(r.providers || {}),
      provider: {
        id: p.id, label: p.label, trainedModel: p.trainedModel,
        detect: typeof p.detect,
        estimatePlanSkew: typeof p.estimatePlanSkew,
        detectArity: p.detect.length,
      },
    };
  });

  checks.require(reg, "the registry is published on the page after boot");
  checks.ok(reg.hasResolve && reg.providerIds.length === 1 && reg.providerIds[0] === "classical-cv",
    "one provider is registered and it is the classical-CV one — the seam a future trained provider plugs into, not evidence that one exists",
    reg.providerIds);
  checks.equal(reg.provider.id, "classical-cv",
    "the provider id survived the move — the benchmark reports carry it as provenance", reg.provider.id);
  checks.equal(reg.provider.label, "Assisted Detection (classical computer vision)",
    "the label still says Assisted Detection, never AI (.claude/rules/ai.md)", reg.provider.label);
  checks.equal(reg.provider.trainedModel, false,
    "trainedModel is still FALSE on the provider — this is classical computer vision and the product must never imply otherwise",
    reg.provider.trainedModel);
  checks.equal(reg.trainedModelInstalled, false,
    "trainedModelInstalled is still FALSE on the registry", reg.trainedModelInstalled);
  checks.equal(reg.provider.detect, "function", "detect() is the entry point", reg.provider.detect);
  checks.equal(reg.provider.estimatePlanSkew, "function",
    "estimatePlanSkew() is part of the provider surface rather than a second bare entry point — deskew is detection work, and a future provider has to make its own decision about it",
    reg.provider.estimatePlanSkew);
  checks.equal(reg.provider.detectArity, 3,
    "detect(pixels, width, height, options) — three declared parameters plus a destructured options object, unchanged by the move",
    reg.provider.detectArity);

  // --- 4. the two values that used to cross the seam ----------------------
  // (a) the confidence threshold, injected instead of read from state.
  checks.ok(/confidenceThreshold=\(\)=>\.48/.test(detCode.replace(/\s/g, "")),
    "detect()'s confidenceThreshold defaults to .48, matching the uncalibrated fallback it replaced — an omitted option behaves like an uncalibrated install, not like pre-selection turned off",
    true);
  checks.ok(/confidenceThreshold:calibratedThreshold/.test(v8Code.replace(/\s/g, "")),
    "app-v8.js injects its calibrated threshold on every detect() call, so calibration still reaches the detector — by argument now, not by reaching for state",
    true);
  checks.equal(matchLines(detCode, /(^|[^\w.$])calibratedThreshold\b/).length, 0,
    "and the pipeline no longer names calibratedThreshold at all", 0);

  // (b) the skew deadband, returned instead of re-decided by the caller.
  checks.ok(/applyDeg/.test(detCode) && /skew\.applyDeg/.test(v8Code.replace(/\s/g, "")),
    "the deskew deadband is decided where its thresholds live and returned as applyDeg; the shell applies the answer rather than re-deriving it from SKEW_MIN_DEG/SKEW_MIN_GAIN",
    true);
  checks.equal(matchLines(v8Code, /(^|[^\w.$])SKEW_MIN_(DEG|GAIN)\b/).length, 0,
    "app-v8.js names neither skew threshold — they moved with the measurement that uses them", 0);

  // --- 5. THE SECOND SEAM: the geometry group -----------------------------
  //
  // Split A-4 and A-9 left the pipeline for `src/plan-detection-geometry.js`.
  // A seam nothing enforces closes again the first time someone needs a helper
  // "just this once", so this one is asserted the same way as the first — and
  // with the one extra rule this move had to obey.
  //
  // THE EXTRA RULE. What the pipeline reads from the module goes through the
  // module's one published object, never through a local alias sharing a name
  // with the function that used to live there. `const minAreaRect =
  // MeritPlanGeometry.minAreaRect` would leave every call site reading exactly
  // as it did before the move, which makes "did this reach past the boundary?"
  // unanswerable by reading the code — the question this whole suite exists to
  // answer. The handle is `GEO`, and the check below is that no bare call to
  // any of the four survives.
  const geoPath = path.join(repoRoot, "src", "plan-detection-geometry.js");
  checks.require(fs.existsSync(geoPath),
    "the geometry group lives in its own file", "src/plan-detection-geometry.js");
  const geoCode = stripCommentsAndStrings(fs.readFileSync(geoPath, "utf8"));
  const GEO_PUBLIC = ["minAreaRect", "sameObject", "boxIoU", "distanceToOBB"];
  const PRIOR_PUBLIC = ["modalMagnitude", "sizeAgreement", "symbolFamilyMember"];
  const SHAPE_PUBLIC = ["shapeAnalysis", "classifyTableShape"];
  const SPLIT_PUBLIC = ["splitAtValley"];
  const COMP_PUBLIC = ["maskSolidity", "enclosedRegions", "labelComponents"];

  checks.ok(geoCode.trimStart().startsWith("(function"),
    "it is wrapped in its own IIFE", geoCode.trimStart().slice(0, 30));
  const geoExported = [...geoCode.matchAll(/globalThis\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]);
  checks.equal(geoExported.join(","), "MeritPlanGeometry",
    "and publishes exactly one name — four functions arrived, one name entered the app's vocabulary", geoExported);

  // The geometry module's consumers are the pipeline AND the shape module,
  // which is the shape of a layered split working: A-5 took `minAreaRect`'s
  // only remaining caller with it, so the pipeline now makes no call to it at
  // all. The rule is about how a CALLER reaches it, so it is asserted over
  // every caller rather than over one file that used to be the only one.
  const geoConsumers = () => detCode + "\n" + stripCommentsAndStrings(
    fs.readFileSync(path.join(repoRoot, "src", "plan-detection-shape.js"), "utf8"));
  for (const n of GEO_PUBLIC) {
    checks.equal(matchLines(detCode, new RegExp(`(^|[^\\w.$])${n}\\s*\\(`)).length, 0,
      `the pipeline makes no BARE call to ${n}() — a local alias of that name would hide the crossing at every call site`,
      matchLines(detCode, new RegExp(`(^|[^\\w.$])${n}\\s*\\(`)).slice(0, 3));
    checks.ok(new RegExp(`GEO\\.${n}\\s*\\(`).test(geoConsumers()),
      `and whoever calls ${n} reaches it through the published object`, true);
  }

  // Copied rather than moved is the other way this goes wrong, and here it
  // would be silent: two minimum-area rectangles that drift apart would still
  // both look right in isolation.
  const geoDefines = new Set();
  for (const m of geoCode.matchAll(/(?:^|\n)  (?:async )?function ([A-Za-z_$][\w$]*)/g)) geoDefines.add(m[1]);
  checks.equal(GEO_PUBLIC.filter((n) => !geoDefines.has(n)).length, 0,
    "all four are DEFINED in the geometry file", [...geoDefines]);
  checks.equal(GEO_PUBLIC.filter((n) => detBindings.has(n) || v8Bindings.has(n)).length, 0,
    "and none of them is still defined in the pipeline or the shell — moved, not copied",
    GEO_PUBLIC.filter((n) => detBindings.has(n) || v8Bindings.has(n)));

  // The module is pure in the sense that matters for a one-way dependency: it
  // resolves nothing bound only in the pipeline or the shell. Measured the
  // same way as the first seam, counting every declarator.
  const geoBare = bareUses(geoCode);
  const geoReaches = [...detBindings, ...v8Bindings]
    .filter((n) => geoBare.has(n) && !bindings(geoCode).has(n) && n !== "GEO");
  checks.equal(geoReaches.length, 0,
    "the geometry module resolves no name bound only in the pipeline or the shell — it reads its arguments and Math, and nothing else",
    geoReaches);

  // And it is really loaded, in order, before the pipeline that calls it.
  const live = await page.evaluate(() => {
    const g = globalThis.MeritPlanGeometry;
    if (!g) return null;
    return {
      keys: Object.keys(g).sort(),
      // A real answer, not just a function reference: a square of side 10 at
      // the origin is 10x10 at rotation 0, whichever file it lives in.
      square: g.minAreaRect([0, 10, 10, 0], [0, 0, 10, 10]),
      same: g.sameObject({ x: 0, y: 0, w: 10, h: 10 }, { x: 1, y: 1, w: 10, h: 10 }),
      iou: Number(g.boxIoU({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }).toFixed(3)),
    };
  });
  checks.require(live, "MeritPlanGeometry is published on the page after boot");
  checks.equal(live.keys.join(","), "boxIoU,distanceToOBB,minAreaRect,sameObject,version",
    "with exactly the four functions and its version", live.keys);
  checks.ok(live.square && Math.round(live.square.w) === 11 && Math.round(live.square.h) === 11
    && live.square.rotation === 0,
    "and it still computes: a 10x10 square of points is an axis-aligned rectangle, not a rotated one. Booting is not computing — the same lesson the first split had to learn the hard way",
    live.square);
  checks.equal(live.same, true, "sameObject still answers same-object", live.same);
  checks.equal(live.iou, 1, "and boxIoU still answers 1 for identical boxes", live.iou);

  // --- 6. THE THIRD SEAM: the modal-size prior ----------------------------
  //
  // Split A-6 and A-7. Asserted exactly as the geometry seam is, with one
  // extra obligation: `MeritSymbolFamilyMember` was already a published name
  // before the move, so it has to still be published, under that name, by
  // whichever file holds the predicate now. A move must not rename a surface
  // something else already reaches for — `symbol-family` calls it through the
  // global and knows nothing about which file it came from.
  const priorPath = path.join(repoRoot, "src", "plan-detection-size-prior.js");
  checks.require(fs.existsSync(priorPath),
    "the modal-size prior lives in its own file", "src/plan-detection-size-prior.js");
  const priorCode = stripCommentsAndStrings(fs.readFileSync(priorPath, "utf8"));

  const priorExported = [...priorCode.matchAll(/globalThis\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]).sort();
  checks.equal(priorExported.join(","), "MeritPlanSizePrior,MeritSymbolFamilyMember",
    "it publishes its own object AND keeps MeritSymbolFamilyMember — the name that was public before the move is public after it",
    priorExported);

  for (const n of PRIOR_PUBLIC) {
    checks.equal(matchLines(detCode, new RegExp(`(^|[^\\w.$])${n}\\s*\\(`)).length, 0,
      `the pipeline makes no BARE call to ${n}()`,
      matchLines(detCode, new RegExp(`(^|[^\\w.$])${n}\\s*\\(`)).slice(0, 3));
    checks.ok(new RegExp(`PRIOR\\.${n}\\s*\\(`).test(detCode),
      `and reaches ${n} through the published object instead`, true);
  }
  checks.equal(PRIOR_PUBLIC.filter((n) => detBindings.has(n) || v8Bindings.has(n)).length, 0,
    "none of the three is still defined in the pipeline or the shell — moved, not copied",
    PRIOR_PUBLIC.filter((n) => detBindings.has(n) || v8Bindings.has(n)));

  const priorBare = bareUses(priorCode);
  const priorReaches = [...detBindings, ...v8Bindings]
    .filter((n) => priorBare.has(n) && !bindings(priorCode).has(n) && n !== "PRIOR");
  checks.equal(priorReaches.length, 0,
    "and it resolves no name bound only in the pipeline or the shell — the crossing analysis said ZERO outward, and this is that claim held over time",
    priorReaches);

  // Live, because booting is not computing. A modal over a cluster of ~20s
  // with one outlier is still ~20, and a magnitude equal to its modal still
  // agrees with it perfectly.
  const livePrior = await page.evaluate(() => {
    const p = globalThis.MeritPlanSizePrior;
    if (!p) return null;
    const modal = p.modalMagnitude([20, 21, 19, 20, 20, 97]);
    return {
      keys: Object.keys(p).sort(),
      modalValue: modal && Math.round(modal.value),
      modalSupport: modal && modal.support,
      agreesWithItself: Number(p.sizeAgreement(20, { value: 20 }).toFixed(3)),
      symbolStillGlobal: typeof globalThis.MeritSymbolFamilyMember === "function",
    };
  });
  checks.require(livePrior, "MeritPlanSizePrior is published on the page after boot");
  checks.equal(livePrior.keys.join(","), "modalMagnitude,sizeAgreement,symbolFamilyMember,version",
    "with exactly its three functions and a version", livePrior.keys);
  checks.equal(livePrior.modalValue, 20,
    "and it still computes: the modal of five ~20s and one 97 is 20, not the mean",
    livePrior.modalValue);
  checks.equal(livePrior.modalSupport, 5, "supported by the five, not by all six", livePrior.modalSupport);
  checks.equal(livePrior.agreesWithItself, 1,
    "and a magnitude equal to its modal agrees with it perfectly", livePrior.agreesWithItself);
  checks.ok(livePrior.symbolStillGlobal,
    "MeritSymbolFamilyMember is still reachable through the global it was always reached by",
    livePrior.symbolStillGlobal);

  // --- 7. THE FOURTH SEAM: shape analysis --------------------------------
  //
  // Split A-5, and the one group that depends on another MODULE rather than on
  // nothing: it binds its own `GEO` handle for `MeritPlanGeometry`. That is
  // the one-way direction this codebase wants, and it is only safe because
  // `boot-contract` now derives the load-order rule — without that, `GEO` is
  // `undefined` at the moment this file reads it and every shape comes back
  // as a thrown error rather than a wrong answer.
  const shapePath = path.join(repoRoot, "src", "plan-detection-shape.js");
  checks.require(fs.existsSync(shapePath),
    "shape analysis lives in its own file", "src/plan-detection-shape.js");
  const shapeCode = stripCommentsAndStrings(fs.readFileSync(shapePath, "utf8"));
  const shapeExported = [...shapeCode.matchAll(/globalThis\.([A-Za-z_$][\w$]*)\s*=/g)]
    .map((m) => m[1]).filter((n) => !n.startsWith("Merit") ? true : n !== "MeritPlanShape" ? true : true);
  checks.equal([...new Set(shapeExported)].sort().join(","), "MeritPlanShape",
    "it publishes exactly one name", shapeExported);

  for (const n of SHAPE_PUBLIC) {
    checks.equal(matchLines(detCode, new RegExp(`(^|[^\\w.$])${n}\\s*\\(`)).length, 0,
      `the pipeline makes no BARE call to ${n}()`,
      matchLines(detCode, new RegExp(`(^|[^\\w.$])${n}\\s*\\(`)).slice(0, 3));
    checks.ok(new RegExp(`SHAPE\\.${n}\\s*\\(`).test(detCode),
      `and reaches ${n} through the published object instead`, true);
  }
  checks.equal(SHAPE_PUBLIC.filter((n) => detBindings.has(n) || v8Bindings.has(n)).length, 0,
    "neither is still defined in the pipeline or the shell — moved, not copied",
    SHAPE_PUBLIC.filter((n) => detBindings.has(n) || v8Bindings.has(n)));

  // It may reach MeritPlanGeometry and nothing else. A module depending on a
  // module is fine; a module depending on the pipeline would be the loop this
  // whole split exists to prevent.
  const shapeBare = bareUses(shapeCode);
  const shapeReaches = [...detBindings, ...v8Bindings]
    .filter((n) => shapeBare.has(n) && !bindings(shapeCode).has(n) && n !== "GEO");
  checks.equal(shapeReaches.length, 0,
    "and it resolves no name bound only in the pipeline or the shell — its one dependency is another module, reached through that module's published object",
    shapeReaches);

  // Live, because booting is not computing — and here the wrong answer would
  // be silent rather than thrown. A disc is round; a filled box is not.
  const liveShape = await page.evaluate(() => {
    const s = globalThis.MeritPlanShape;
    if (!s) return null;
    return {
      keys: Object.keys(s).sort(),
      // The real input shape, read off `classifyTableShape` rather than
      // invented: a filled OBB whose four corner squares are empty is a disc,
      // and the same box with its corners covered is not.
      round: s.classifyTableShape({ obb: { w: 100, h: 100 }, obbFill: 0.9,
        cornerOccupancy: 0.05, cornerVsEdge: 0.1, quadrantFill: [0.8, 0.8, 0.8, 0.8] }),
      rect: s.classifyTableShape({ obb: { w: 240, h: 90 }, obbFill: 0.95,
        cornerOccupancy: 0.92, cornerVsEdge: 0.9, quadrantFill: [0.9, 0.9, 0.9, 0.9] }),
    };
  });
  checks.require(liveShape, "MeritPlanShape is published on the page after boot");
  checks.equal(liveShape.keys.join(","), "classifyTableShape,shapeAnalysis,version",
    "with exactly its two functions and a version", liveShape.keys);
  checks.equal(liveShape.round?.type, "round",
    "and it still computes: a filled square OBB with empty corners is a disc", liveShape.round);
  checks.equal(liveShape.rect?.type, "rectangle",
    "while a long box that fills its corners is a rectangle — decided from pixels, not from the bounding box",
    liveShape.rect);

  // --- 8. THE FIFTH SEAM: merged-blob splitting ---------------------------
  //
  // The one group whose risk is not about coupling: it CHANGES THE OBJECT
  // COUNT, so a mistake moves every number downstream. The structural checks
  // below are the same as the others; what actually guards the behaviour is
  // `npm run benchmark` against `BASELINE.json`, where the golden plan's split
  // pairs are a measured field.
  //
  // It is also the first move where a name became genuinely PRIVATE rather
  // than merely relocated: `splitAlongAxis` was top-level in a
  // three-thousand-line file and is now internal to the one function that
  // calls it. That is the thing a split is for, and it is asserted here
  // because nothing else would notice it being published "just in case".
  const splitPath = path.join(repoRoot, "src", "plan-detection-split.js");
  checks.require(fs.existsSync(splitPath),
    "merged-blob splitting lives in its own file", "src/plan-detection-split.js");
  const splitCode = stripCommentsAndStrings(fs.readFileSync(splitPath, "utf8"));
  const splitExported = [...splitCode.matchAll(/globalThis\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]);
  checks.equal([...new Set(splitExported)].join(","), "MeritPlanSplit",
    "it publishes exactly one name", splitExported);

  for (const n of SPLIT_PUBLIC) {
    checks.equal(matchLines(detCode, new RegExp(`(^|[^\\w.$])${n}\\s*\\(`)).length, 0,
      `the pipeline makes no BARE call to ${n}()`,
      matchLines(detCode, new RegExp(`(^|[^\\w.$])${n}\\s*\\(`)).slice(0, 3));
    checks.ok(new RegExp(`SPLIT\\.${n}\\s*\\(`).test(detCode),
      `and reaches ${n} through the published object instead`, true);
  }
  checks.ok(/function splitAlongAxis/.test(splitCode) && !/globalThis[^\n]*splitAlongAxis/.test(splitCode),
    "splitAlongAxis is defined in the module and NOT published — a helper that was top-level in a three-thousand-line file is now internal to its one caller",
    true);
  checks.equal(["splitAtValley", "splitAlongAxis"].filter((n) => detBindings.has(n) || v8Bindings.has(n)).length, 0,
    "and neither is still defined in the pipeline or the shell — moved, not copied", true);

  const splitBare = bareUses(splitCode);
  const splitReaches = [...detBindings, ...v8Bindings]
    .filter((n) => splitBare.has(n) && !bindings(splitCode).has(n));
  checks.equal(splitReaches.length, 0,
    "and it resolves no name bound only in the pipeline or the shell — the modal sizes it judges parts against arrive as arguments, which is what keeps it from inventing a boundary",
    splitReaches);

  const liveSplit = await page.evaluate(() => {
    const s = globalThis.MeritPlanSplit;
    return s ? { keys: Object.keys(s).sort(), fn: typeof s.splitAtValley } : null;
  });
  checks.require(liveSplit, "MeritPlanSplit is published on the page after boot");
  checks.equal(liveSplit.keys.join(","), "splitAtValley,version",
    "with exactly its one function and a version — splitAlongAxis is not on it", liveSplit.keys);
  checks.equal(liveSplit.fn, "function", "and it is callable", liveSplit.fn);

  // --- 9. THE SIXTH SEAM: mask to objects --------------------------------
  //
  // The group the map rated MEDIUM, and the reason is a single module-level
  // buffer rather than any coupling. `SCRATCH_QUEUE` is one Int32Array reused
  // across every flood fill; allocating one per component would dominate the
  // cost on a large plan and change NOTHING about the output. That is what
  // makes it dangerous to move: no correctness test would notice, so the
  // property is asserted here directly.
  const compPath = path.join(repoRoot, "src", "plan-detection-components.js");
  checks.require(fs.existsSync(compPath),
    "the component layer lives in its own file", "src/plan-detection-components.js");
  const compCode = stripCommentsAndStrings(fs.readFileSync(compPath, "utf8"));
  const compExported = [...compCode.matchAll(/globalThis\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]);
  checks.equal([...new Set(compExported)].join(","), "MeritPlanComponents",
    "it publishes exactly one name", compExported);

  for (const n of COMP_PUBLIC) {
    checks.equal(matchLines(detCode, new RegExp(`(^|[^\\w.$])${n}\\s*\\(`)).length, 0,
      `the pipeline makes no BARE call to ${n}()`,
      matchLines(detCode, new RegExp(`(^|[^\\w.$])${n}\\s*\\(`)).slice(0, 3));
    checks.ok(new RegExp(`COMP\\.${n}\\s*\\(`).test(detCode),
      `and reaches ${n} through the published object instead`, true);
  }

  // THE BUFFER, asserted as the property the map warned about. Declared once
  // at module level, and GROWN rather than replaced — `scratchQueue` must
  // return the existing array whenever it is already big enough.
  checks.ok(/\n\s{2}let SCRATCH_QUEUE\s*=\s*null/.test(compCode),
    "SCRATCH_QUEUE is declared once at MODULE level, not inside the function that hands it out — a per-call allocation would be invisible in every output and would only show up as time",
    true);
  checks.ok(/if\s*\(\s*!SCRATCH_QUEUE\s*\|\|\s*SCRATCH_QUEUE\.length\s*<\s*size\s*\)/.test(compCode),
    "and it is only replaced when the existing one is too small — the reuse this group was rated MEDIUM for",
    true);
  checks.ok(!/globalThis[^\n]*SCRATCH_QUEUE|globalThis[^\n]*scratchQueue/.test(compCode),
    "neither the buffer nor its allocator is published — they are the module's own business",
    true);
  checks.equal([...COMP_PUBLIC, "scratchQueue", "SCRATCH_QUEUE"]
    .filter((n) => detBindings.has(n) || v8Bindings.has(n)).length, 0,
    "and none of the five is still defined in the pipeline or the shell — moved, not copied", true);

  const compBare = bareUses(compCode);
  const compReaches = [...detBindings, ...v8Bindings]
    .filter((n) => compBare.has(n) && !bindings(compCode).has(n));
  checks.equal(compReaches.length, 0,
    "and it resolves no name bound only in the pipeline or the shell. `buildClassMasks` stayed behind precisely so this would be true: it calls rgbBinIndex, which belongs to the colour model, so it travels with the colour work instead",
    compReaches);

  // Live, because booting is not labelling. Two separated 2x2 blocks on a
  // 6x6 mask are two components, not one and not four.
  const liveComp = await page.evaluate(() => {
    const c = globalThis.MeritPlanComponents;
    if (!c) return null;
    const w = 6, h = 6, mask = new Uint8Array(w * h);
    const set = (x, y) => { mask[y * w + x] = 1; };
    for (const [ox, oy] of [[0, 0], [4, 4]])
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) set(ox + dx, oy + dy);
    const out = c.labelComponents(mask, w, h, 1, false);
    return { keys: Object.keys(c).sort(), count: (out.comps || []).length };
  });
  checks.require(liveComp, "MeritPlanComponents is published on the page after boot");
  checks.equal(liveComp.keys.join(","), "enclosedRegions,labelComponents,maskSolidity,version",
    "with exactly its three functions and a version — the scratch buffer is not on it", liveComp.keys);
  checks.equal(liveComp.count, 2,
    "and it still labels: two separated 2x2 blocks on a 6x6 mask are two components",
    liveComp.count);
}
