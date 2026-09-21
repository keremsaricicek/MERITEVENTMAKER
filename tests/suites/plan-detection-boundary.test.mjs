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
//   MeritSymbolFamilyMember the family predicate the detection benchmarks
//                           already called directly before the move.
//   MERIT_STAGE_CENSUS      the per-stage diagnostic census, populated only
//                           under MERIT_DETECT_DEBUG and read by
//                           benchmarks/heldout/ornek-stage-walk.mjs — the tool
//                           CLAUDE.md names for "diagnose before theorising".
//                           Measurement surface; the product never reads it.
//
// Adding to this set is a decision about what the pipeline promises. Do not
// widen it to make a failing check pass.
const PUBLIC = new Set(["MERIT_PLAN_DETECTION", "MeritSymbolFamilyMember", "MERIT_STAGE_CENSUS"]);

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
    "the file exports ONLY its registry, the symbol-family predicate the benchmarks already depended on, and the debug census — every other name stays inside the IIFE",
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

  checks.ok(detBindings.size > 30,
    "the detection file really does have a large private surface — which is what makes the next two checks meaningful rather than vacuous",
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
}
