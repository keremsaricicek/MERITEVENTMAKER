// MERIT — Assisted Detection: the classical computer-vision pipeline.
//
// Extracted from app-v8.js (lines 3290-6098 at commit 9135e5d). This is a
// STRUCTURAL MOVE: no threshold, no algorithm, no output field and no ordering
// changed. The detector's measured behaviour is guarded by `npm run benchmark`
// against benchmarks/BASELINE.json, per plan and per field, and that
// comparison is the evidence the move was behaviour-neutral.
//
// STATUS: TRANSITIONAL EXTRACTION, NOT A FINISHED MODULE.
// 2809 lines in one file is not a healthy unit. It is a safe
// checkpoint: the pipeline now has a boundary it did not have, so the next
// step can split it along the responsibilities mapped in
// benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md. Do not cite this file's size as
// evidence of anything except that the split has not happened yet.
//
// THIS IS NOT A TRAINED MODEL. Everything here is deterministic classical CV
// on real decoded plan pixels. `trainedModel` is false and stays false until a
// real domain model is installed; nothing here may be described as AI. See
// .claude/rules/ai.md.
//
// THE BOUNDARY, which is the point of the file:
//   · It reads NO shell state. No `state`, no `ui`, no `render()`, no
//     `touchEvent()`. Enforced by tests/suites/dependency-direction.test.mjs.
//   · Everything it needs from the app arrives as an ARGUMENT. The confidence
//     threshold used to pre-select candidates is the only such input, and it
//     is injected as `confidenceThreshold` rather than read from
//     `state.calibration` — which is what it used to do.
//   · The app reaches it through ONE object, `globalThis.MERIT_PLAN_DETECTION`.
//     No internal helper is called from app-v8.js, and
//     tests/suites/plan-detection-boundary.test.mjs fails if one ever is.
//
// THE PROVIDER CONTRACT:
//   { id, label, trainedModel:false,
//     estimatePlanSkew(canvas, width, height)
//        -> { deg, gain, measured, applyDeg },   // applyDeg is 0 inside the deadband
//     async detect(pixels, width, height,
//                  { onStage, protectedRegions, confidenceThreshold }) }
// A future ONNX/YOLO-OBB provider implements the same shape and is registered
// beside this one — real pixels in, oriented candidates out — without
// runAssistedDetection() or plan-intelligence.js changing.
(() => {
  "use strict";
  // The geometry group's one published object. NOT destructured and NOT
  // aliased to the names it holds: a local `minAreaRect` sharing a name with
  // the function that used to live here would make "did this reach past the
  // boundary?" unanswerable, which is the rule `.claude/rules/code-health.md`
  // states for exactly this move. Every call below reads `GEO.`, so the
  // crossing is visible at the call site rather than only in a diff.
  const GEO = globalThis.MeritPlanGeometry;
  // The modal-size prior's one published object, reached the same way and for
  // the same reason. See the note above: no local alias may share a name with
  // a function that used to live here.
  const PRIOR = globalThis.MeritPlanSizePrior;
  // Shape analysis, reached the same way as the other two.
  const SHAPE = globalThis.MeritPlanShape;
  // Merged-blob splitting, reached the same way as the rest.
  const SPLIT = globalThis.MeritPlanSplit;
  // Mask-to-objects: connected components and enclosed regions.
  const COMP = globalThis.MeritPlanComponents;
  // Deskew and the ink threshold. The only DOM-touching part of the detector.
  const DESKEW = globalThis.MeritPlanDeskew;
  // The drawing's own palette — accent, tone bands, class masks (Split A-2).
  const TONE = globalThis.MeritPlanTone;
  // detect()'s first two stages, pixels and binarize (Split B-1/B-2).
  const PRE = globalThis.MeritPlanPreprocess;
  // The representation verdict and its swap (Split B-16).
  const VERDICT = globalThis.MeritPlanVerdict;
  // Venue-scale objects: columns, merged rows, unnamed bands (Split B-15).
  const VENUE_OBJECTS = globalThis.MeritPlanVenueObjects;
  // The three object sources (Split B-4).
  const SOURCES = globalThis.MeritPlanSources;
  // Chairs first (Split B-5).
  const CHAIRS = globalThis.MeritPlanChairs;
  // Which objects are tables (Split B-6 … B-14).
  const TABLES = globalThis.MeritPlanTables;
  // The detector's own ids, in the shell's shape (`candidate_<uuid>`). Until
  // 2026-10-03 every `uid(...)` here resolved to app.js's top-level `uid` — a
  // crossing into the shell no suite modelled, which made the pipeline depend
  // on app.js having loaded first. plan-detection-boundary now reads app.js's
  // bindings too.
  const uid=p=>p+"_"+(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2));
  // ---- The provider -------------------------------------------------------
  const CLASSICAL_CV_PROVIDER={
    id:"classical-cv",
    label:"Assisted Detection (classical computer vision)",
    trainedModel:false,
    estimatePlanSkew: DESKEW.estimatePlanSkew,
    async detect(pixels,width,height,{onStage,protectedRegions=[],confidenceThreshold=()=>.48}={}){
      const stage=onStage||(async()=>{});
      const total=width*height,data=pixels.data;
      // Real measured phase timings, reported in diagnostics so a future
      // performance change can be judged against numbers instead of a feeling.
      const phaseMs={};let phaseFrom=performance.now();
      const mark=name=>{const now=performance.now();phaseMs[name]=Math.round(now-phaseFrom);phaseFrom=now;};
      // B-1 and B-2 are MeritPlanPreprocess (src/plan-detection-preprocess.js),
      // each with its contract stated there.
      const {gray,threshold,binCount,binR,binG,binB,sampled,lumaLowChroma,lumaMidChroma}=PRE.measurePixels(data,width,height);
      mark("pixels");
      await stage("understanding",30);phaseFrom=performance.now();
      const {fillMask,barrier}=PRE.binarize(gray,width,height,threshold);
      const binary=barrier; // same union the previous pipeline labelled; kept for computeVisualDescriptor
      mark("binarize");
      const accentModel=TONE.buildAccentModel(binCount,binR,binG,binB,sampled);
      const toneModel=TONE.buildToneModel(lumaLowChroma,lumaMidChroma,sampled,accentModel?.accentChroma);
      mark("colourModel");
      await stage("understanding",42);phaseFrom=performance.now();

      const area=total,minDim=Math.min(width,height);
      const minPixels=Math.max(10,Math.round(area*.000006));
      const notWall=c=>!(Math.min(c.w,c.h)<3&&Math.max(c.w,c.h)>minDim*.08);
      const tableSizeOk=c=>notWall(c)&&Math.min(c.w,c.h)>=minDim*.016&&c.w*c.h>=area*.00015&&c.w*c.h<=area*.04&&c.aspect>=.28&&c.aspect<=3.6;
      // The chair FLOOR is a fraction of the plan, like the ceiling already is.
      //
      // It used to be an absolute 3 pixels, which says nothing about a drawing:
      // it is below the width of antialiasing fringe at this resolution, and at
      // 70% scale it stops excluding anything at all. Two measured failures came
      // through it. The `downscale-70` variant exploded from 0 to 73 false
      // chairs. And once the tone model was allowed to see minority surface
      // families, the real plan's tan bistro finish arrived as 823 components
      // whose median side is 4.9px — edge fringe, not furniture — and the
      // structural test called that repeated population a chair family.
      //
      // A chair is a drawn object. On a 765px-tall plan the floor is 7.7px, the
      // smallest real seat is 15px, and the fringe is 5px. Expressed against the
      // plan rather than the pixel grid, it means the same thing at every
      // rendering scale, which is the point.
      const CHAIR_MIN_SIDE_P=.01;
      const chairSizeOk=c=>notWall(c)&&Math.min(c.w,c.h)>=minDim*CHAIR_MIN_SIDE_P&&Math.max(c.w,c.h)<=minDim*.065&&c.w*c.h<area*.0028;
      const venueSizeOk=c=>notWall(c)&&c.w*c.h>area*.008&&c.w*c.h<area*.12&&(c.aspect>3.1||c.aspect<.32);

      // Shape analysis scans each candidate's own window, so it runs as late as
      // possible (only on candidates that survived de-duplication) and is
      // bounded by a real pixel budget rather than trusting the size filters to
      // keep the candidate count sane on a pathological drawing.
      let shapeBudget=area*6;
      const analyze=(comps,labels)=>{
        for(const c of comps){
          if(c.shape!==undefined)continue;
          if(shapeBudget<=0){c.shape=null;continue;}
          shapeBudget-=(c.w+2)*(c.h+2);
          c.shape=SHAPE.shapeAnalysis(labels,c.label,c,width,height);
        }
        return comps;
      };

      // B-4 — the three object sources — is MeritPlanSources
      // (src/plan-detection-sources.js), with its contract stated there.
      const{sources,diagnosticsSources,chairSources,tintIsChairMaterial,fallbackChairComps,fallbackChairLabels,
        accentMask,surfaceMask,masksTints}=SOURCES.collectSources({data,gray,total,width,height,barrier,fillMask,
        accentModel,toneModel,minPixels,minDim,CHAIR_MIN_SIDE_P,notWall,tableSizeOk,chairSizeOk,mark});
      await stage("seating",58);phaseFrom=performance.now();

      // B-5 — chairs first — is MeritPlanChairs (src/plan-detection-chairs.js),
      // with its contract stated there.
      const{chairs,chairModal,chairUniform,chairSource,chairSourceBreakdown,chairFloorSide,detectionPath,
        secondaryFamilyDiagnostics,gapTo}=CHAIRS.findChairs({width,height,total,area,minPixels,sources,chairSources,
        fallbackChairComps,fallbackChairLabels,accentMask,chairSizeOk,analyze});
      mark("chairs");

      // B-6 … B-14 — which objects are tables, and what is left over — is
      // MeritPlanTables (src/plan-detection-tables.js), contract there.
      const tablesOut=TABLES.findTables({uid,width,height,area,sources,analyze,venueSizeOk,threshold,masksTints,surfaceMask,tintIsChairMaterial,chairs,chairModal,chairUniform,chairSource,chairFloorSide,gapTo,protectedRegions,confidenceThreshold});
      const{candidates,chairVenues,pool,debugPool,modalPool,modalArea,modalSeats,modalLong,modalShort,bistrosTyped,reseated,seatsInsideBody,seatsInsideBodyStoodDown,relationStats,splitCount,capReached,offModalDropped,surfaceRejected,surfaceMinorityFinishKept,fragmentDiagnostics,textGlyphChairsDropped,familyLostToAssociation,familyLostToTextRun,familyFromTableSources,familyVenue,mergedRowVenues,columnComps,chairOBB,toPercentBox}=tablesOut;
      let venues=tablesOut.venues;
      mark("tables");
      const associatedSeats=candidates.reduce((n,c)=>n+c.chairDetections.length,0);

      // B-16 — what kind of drawing this is, and what that does to the
      // candidates — is MeritPlanVerdict (src/plan-detection-verdict.js), with
      // its contract stated there. It mutates `candidates` in place.
      const verdict=VERDICT.applyVerdict({chairUniform,chairs,associatedSeats,chairVenues,candidates,venues,
        familyLostToAssociation,familyLostToTextRun,familyVenue,familyFromTableSources,uid,toPercentBox});
      const {representation,representationSwap,familyRestoredBySwap}=verdict;
      venues=verdict.venues;

      return{
        candidates,venues,gray,binary,threshold,representation,
        diagnostics:{
          components:pool.length,wallSuppression:true,
          chairs:chairs.length,tables:candidates.length,
          detectionPath,chairSource,representation,representationSwap,
          chairsDetected:chairs.length,chairsAssociated:associatedSeats,chairsUnassociated:chairVenues.length,
          chairModalSize:chairModal?Number(chairModal.value.toFixed(1)):null,
          tableModalArea:modalArea?Math.round(modalArea.value):null,
          tableModalPool:modalPool.length,
          tableModalSeats:modalSeats||null,bistrosTyped,chairsReseated:reseated,seatsInsideBody,
          // Present only when the seat-containment gate stood down because it
          // would have claimed most of the plan. Its absence means it ran.
          seatsInsideBodyStoodDown,
          // What the relationship engine actually did, including the number
          // that decides whether it earned its place: how many seats it put at
          // a different table than "nearest perimeter" would have. Reported
          // even when it is zero.
          relations:relationStats,
          mergesSplit:splitCount,splitModalLong:modalLong?Math.round(modalLong.value):null,splitModalShort:modalShort?Math.round(modalShort.value):null,candidateCapReached:capReached,offModalDropped,surfaceRejected,surfaceMinorityFinishKept,secondaryChairFamilies:secondaryFamilyDiagnostics,fragmentSuppression:fragmentDiagnostics,
          textGlyphChairsDropped,
          familyLostToAssociation:familyLostToAssociation.map(ch=>toPercentBox(chairOBB(ch))),
          familyLostToTextRun:familyLostToTextRun.map(ch=>toPercentBox(chairOBB(ch))),
          familyRestoredBySwap,familyFromTableSources:familyFromTableSources.length,
          mergedRowVenuesDropped:mergedRowVenues.length,columnsDetected:columnComps.length,debugPool,
          sources:diagnosticsSources,chairSourceBreakdown,phaseMs,
          colorModel:accentModel?{isColorPlan:accentModel.isColorPlan,accentHue:accentModel.accentHue,
            accentChroma:accentModel.accentChroma,accentFraction:Number(accentModel.accentFraction.toFixed(4)),
            backgroundLuma:accentModel.backgroundLuma}:null,
          toneModel:toneModel?toneModel.summary:null,
        },
      };
    },
  };
  // The registry is the seam a future provider plugs into. Today there is
  // exactly one implementation and it is classical CV — nothing here implies
  // a trained model exists (trainedModel is false and stays false until a real
  // one is installed).
  const PLAN_DETECTION_PROVIDERS={"classical-cv":CLASSICAL_CV_PROVIDER};
  function resolvePlanDetectionProvider(){
    const requested=globalThis.MERIT_PLAN_DETECTION_PROVIDER_ID;
    return PLAN_DETECTION_PROVIDERS[requested]||CLASSICAL_CV_PROVIDER;
  }
  globalThis.MERIT_PLAN_DETECTION={providers:PLAN_DETECTION_PROVIDERS,resolve:resolvePlanDetectionProvider,
    activeId:CLASSICAL_CV_PROVIDER.id,trainedModelInstalled:false};
})();
