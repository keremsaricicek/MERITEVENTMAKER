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

      // ---- table candidate pool --------------------------------------------
      let pool=[];
      for(const s of sources)for(const c of s.comps)pool.push({comp:c,labels:s.labels});
      // Chair-first has a second payoff: anything already claimed as a chair is
      // removed from the table pool, so chair blobs can no longer masquerade as
      // small tables (they did before — a 17px chair passes the table size
      // floor on a 1000px-tall plan) and cannot drag the modal table size down.
      if(chairUniform&&chairs.length){
        pool=pool.filter(p=>!chairs.some(ch=>GEO.sameObject(p.comp,ch)));
      }
      // The modal has to describe a TABLE, not the pool. Walls, printed text and
      // venue objects are all still in here, and a modal dragged out toward a
      // long wall makes every genuinely fused blob look too short to be a run --
      // which is the second reason the split pass never fired on a real plan.
      // Same filtering idea already used for the downstream modal table area:
      // drop anything chair-sized, and drop anything shaped like a wall.
      const spanOf=p=>{const o=p.comp.shape?.obb;
        const w=o?.w||p.comp.w,h=o?.h||p.comp.h;
        return{long:Math.max(w,h),short:Math.min(w,h)};};
      const chairAreaFloor=chairUniform&&chairModal?chairModal.value**2:0;
      // Both dimensions, not just area: an area-only floor still admits things
      // one chair wide, which drags the SHORT modal down to chair scale -- and a
      // chair-scale short modal lets the split halve real tables. Measured on
      // the real plan: area-only gave a 68x39 modal against a ~38px chair and
      // over-split to 51 tables where about 45 exist.
      const chairSpanFloor=chairUniform&&chairModal?chairModal.value*1.15:0;
      const furnitureish=pool.filter(p=>{
        const s=spanOf(p);
        if(chairAreaFloor&&s.long*s.short<=chairAreaFloor*1.3)return false;
        if(chairSpanFloor&&s.short<=chairSpanFloor)return false;
        return s.long/Math.max(1,s.short)<=4;
      });
      const spanPool=furnitureish.length>=4?furnitureish:pool;
      if(globalThis.MERIT_STAGE_CENSUS){
        const cbox=c=>({x:c.x,y:c.y,w:c.w,h:c.h,src:c.source,fill:c.fill??null});
        globalThis.MERIT_STAGE_CENSUS.stage_pool=pool.map(p2=>cbox(p2.comp));
        globalThis.MERIT_STAGE_CENSUS.stage_furnitureish=furnitureish.map(p2=>cbox(p2.comp));
      }
      const modalLong=PRIOR.modalMagnitude(spanPool.map(p=>spanOf(p).long));
      const modalShort=PRIOR.modalMagnitude(spanPool.map(p=>spanOf(p).short));
      let splitCount=0;
      const expanded=[];
      for(const entry of pool){
        const parts=SPLIT.splitAtValley(entry.comp,entry.labels,width,height,modalLong?.value,modalShort?.value);
        if(!parts||parts.length<2){expanded.push(entry);continue;}
        splitCount+=parts.length-1;
        for(const part of parts){
          part.source=entry.comp.source;
          analyze([part],entry.labels);
          expanded.push({comp:part,labels:entry.labels});
        }
      }
      // De-duplicate across sources: one physical table can surface both as an
      // enclosed interior and as a tone fill. Keep one, preferring the source
      // that gives the cleanest shape signal.
      //
      // Within a source the tie-break used to be raw pixel count -- biggest
      // wins. That is the same failure the modal prior was introduced to kill,
      // surviving here in the ordering: a blob spanning three tables and their
      // chairs has the largest count, so it was seeded first and every cleaner
      // table-sized box that overlapped it was then dropped as a duplicate.
      // Order by agreement with the repeated object size instead, using a
      // provisional modal measured over the furniture-shaped pool before any
      // splitting or de-duplication has happened.
      const provisionalModalArea=PRIOR.modalMagnitude(furnitureish.map(p=>{
        const s=spanOf(p);return s.long*s.short;
      }));
      const dedupFitness=comp=>{
        const o=comp.shape?.obb,a=o?o.w*o.h:comp.w*comp.h;
        return provisionalModalArea?PRIOR.sizeAgreement(Math.sqrt(a),{value:Math.sqrt(provisionalModalArea.value)}):0;
      };
      const sourceRank={tone:3,interior:2,fill:1};
      expanded.sort((a,b)=>(sourceRank[b.comp.source]||0)-(sourceRank[a.comp.source]||0)
        ||dedupFitness(b.comp)-dedupFitness(a.comp)
        ||b.comp.count-a.comp.count);
      // Two boxes describing ONE physical table often overlap only slightly:
      // the tone mask finds the table surface, the barrier mask finds the
      // table plus the chair tucked against it, so the boxes are offset by
      // roughly a chair. Measured on the real plan those pairs sit at IoU~0.13
      // -- far under any IoU threshold that would still keep two genuinely
      // adjacent tables apart. Centre distance separates the two cases
      // cleanly and scale-free: a duplicate is a fraction of a table away,
      // a real neighbour is about one table away.
      const modalSpanForDedup=provisionalModalArea?Math.sqrt(provisionalModalArea.value):null;
      const boxesIntersect=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
      const centreDistance=(a,b)=>Math.hypot((a.x+a.w/2)-(b.x+b.w/2),(a.y+a.h/2)-(b.y+b.h/2));
      const unique=[];
      for(const entry of expanded){
        const dup=unique.some(u=>{
          if(GEO.boxIoU(entry.comp,u.comp)>=.45)return true;
          if(!modalSpanForDedup)return false;
          // Same object seen twice: the boxes actually touch AND their centres
          // are much closer than one repeated object apart.
          return boxesIntersect(entry.comp,u.comp)&&centreDistance(entry.comp,u.comp)<modalSpanForDedup*.55;
        });
        if(dup)continue;
        unique.push(entry);
      }
      // ---- is this candidate actually made of table? ------------------------
      // A table drawn with a filled surface is mostly that surface colour. A
      // row of chairs, a wall fragment, a block of printed text and a door
      // swing are not, however table-shaped their bounding box looks. Asking
      // the pixels directly is stronger evidence than any size or aspect rule,
      // and it is the same colour reasoning that fixed the chair source.
      //
      // Only applied when the drawing really does have a surface family to
      // reason from, and never to a candidate that already carries chair
      // evidence -- a table surrounded by its own chairs is a table even if
      // its fill reads faintly.
      //
      // Coverage is asked of EVERY tone family, and the best answer wins.
      //
      // "Is this made of the stuff the plan's MAJORITY tables are made of" is a
      // different question from "is this made of one coherent surface", and on
      // a plan drawing two table finishes only the second is worth asking. This
      // plan draws its banquet tables in pale grey and its bistro tables in a
      // tan with a fine grid texture. Measured, per family, on the three bistro
      // discs (families are luma 229 / 121 / 146 / 201 / 169):
      //
      //   disc (63,217)   0.124  0.022  0.019  [0.254]  0.019
      //   disc (24,219)   0.131  0.016  0.013  [0.284]  0.020
      //   disc (380,704)  0.132  0.000  0.003  [0.274]  0.003
      //   wall panel      0.997  0      0      0        0
      //   merged blob     0.079  0.014  0.039  0.105    0.032
      //
      // Against the majority family alone all five bistro tables fall under the
      // 0.22 floor and are deleted; against their own they clear it. The wall
      // panel and the merged double-table blob are unaffected, because a thing
      // made of no surface is made of no surface however many you offer it.
      //
      // The single-family version of this filter was the last stage still
      // deleting this plan's minority tables. It only became fixable once the
      // tone model stopped capping itself at the three largest families
      // (TONE.buildToneModel) — before that there was no tan family to find, which
      // is why an earlier attempt at exactly this change measured as a no-op
      // and was reverted.
      //
      // The seat-evidence exemption the paragraph above describes was also
      // tried, twice, and is NOT what this code does. Exempting any low-cover
      // candidate with a chair against it found all 46 tables and 55 false
      // ones; requiring two chairs and modal size still gave 18 false ones
      // against a baseline of 6. On a banquet floor every gap between a
      // hundred chairs has chairs against it, so seats cannot carry that
      // decision here. The finish can, once it is allowed to be plural.
      let surfaceRejected=0,surfaceMinorityFinishKept=0;
      // What the surface filter turned away. Not made of table is not the same
      // as not an object — see the column pass further down.
      const surfaceRejectedComps=[];
      const uniqueBeforeSurface=unique.map(u=>u.comp);
      const surfaceFamilies=(masksTints&&masksTints.length)?masksTints:(surfaceMask?[surfaceMask]:[]);
      if(surfaceFamilies.length){
        // The best SINGLE family, never their union: a table is made of one
        // material, so the question is whether some one family accounts for
        // most of this candidate — not whether the candidate can be covered by
        // borrowing a little from each.
        const coverageIn=(c,mask)=>{
          const x0=Math.max(0,Math.round(c.x)),y0=Math.max(0,Math.round(c.y));
          const x1=Math.min(width,Math.round(c.x+c.w)),y1=Math.min(height,Math.round(c.y+c.h));
          let on=0,tot=0;
          for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){tot++;if(mask[y*width+x])on++;}
          return tot?on/tot:0;
        };
        // A MINORITY finish is weaker evidence than the plan's main one and has
        // to be corroborated.
        //
        // "Not made of the same stuff as this plan's tables" was doing real
        // work, and simply accepting any family threw it away: on the dense
        // fixture the architecture blocks along both edges are a genuine second
        // solid family (luma 142, solidity 0.94), so the plural test read them
        // as tables and cost four false positives.
        //
        // What separates them from the real plan's bistro tables is not the
        // material — both are a coherent minority finish — it is that one has
        // chairs drawn against it and the other does not. Architecture does not
        // acquire seating. So the dominant finish still stands on its own, and
        // a minority finish needs a seat against the candidate as well.
        //
        // This is much narrower than the seat exemption measured and rejected
        // above: that one offered seats to EVERY low-coverage candidate on the
        // plan, where on a banquet floor every gap between a hundred chairs has
        // chairs against it. Here seats only decide candidates that are already
        // made of a coherent, repeated surface which simply is not the majority
        // one.
        // ...and the minority finish may not be the plan's CHAIR material.
        //
        // A candidate made of the stuff this plan draws its chairs with is not
        // thereby a table, however solid and repeated that stuff is. Measured
        // on the grayscale variant, where the orange chairs become a mid-grey
        // tint family of their own (luma 145, solidity 0.59): letting it
        // license tables cost 32 extra table false positives, because on a
        // banquet floor a chair-material blob always has chairs beside it, so
        // the seat corroboration below is satisfied trivially.
        const dominantSurface=surfaceMask;
        const minoritySurfaces=(masksTints||[])
          .filter((m,i)=>m!==dominantSurface&&!tintIsChairMaterial[i]);
        const seatedAgainst=c=>chairs.some(ch=>!GEO.sameObject(ch,c)&&gapTo(c,ch)<=Math.max(ch.w,ch.h)*.35);
        const surfaceKept=unique.filter(u=>{
          const dominant=dominantSurface?coverageIn(u.comp,dominantSurface):0;
          let best=dominant,fromMinority=false;
          for(const mask of minoritySurfaces){
            const cov=coverageIn(u.comp,mask);
            if(cov>best){best=cov;fromMinority=true;}
          }
          u.comp.surfaceCoverage=+best.toFixed(3);
          u.comp.surfaceFromMinorityFinish=fromMinority;
          if(best<.22){surfaceRejected++;surfaceRejectedComps.push(u.comp);return false;}
          if(dominant>=.22)return true;
          if(dedupFitness(u.comp)>=.25&&seatedAgainst(u.comp)){surfaceMinorityFinishKept++;return true;}
          surfaceRejected++;surfaceRejectedComps.push(u.comp);return false;
        });
        // Refuse to apply the rule if it would gut the plan: that would mean
        // the surface family is not what this drawing uses for tables, and a
        // filter that removes almost everything is wrong, not strict.
        if(surfaceKept.length>=Math.max(4,unique.length*.2)){unique.length=0;unique.push(...surfaceKept);}
        else surfaceRejected=0;
      }
      if(globalThis.MERIT_STAGE_CENSUS){
        const cbox=c=>({x:c.x,y:c.y,w:c.w,h:c.h,src:c.source,fill:c.fill??null,cov:c.surfaceCoverage??null,
          minority:c.surfaceFromMinorityFinish??null,
          obbW:c.shape?.obb?.w??null,obbH:c.shape?.obb?.h??null,
          obbFill:c.shape?.obbFill??null,cornerVsEdge:c.shape?.cornerVsEdge??null,
          count:c.count??null});
        globalThis.MERIT_STAGE_CENSUS.stage_expanded=expanded.map(e=>cbox(e.comp));
        globalThis.MERIT_STAGE_CENSUS.stage_unique=uniqueBeforeSurface.map(cbox);
        globalThis.MERIT_STAGE_CENSUS.stage_surfaceRejected=surfaceRejectedComps.map(cbox);
        globalThis.MERIT_STAGE_CENSUS.stage_afterSurface=unique.map(e=>cbox(e.comp));
      }

      // ---- the symbol family is a family, not a polarity --------------------
      //
      // A plan that draws its tables as one repeated symbol may draw that
      // symbol in more than one tone. ORNEK draws 157 open circles and 9 filled
      // ones, all the same object at the same size, and the two halves arrive
      // through different code: the open ones through the chair sources (light
      // interior, dark rim), the filled ones through the tone/fill TABLE
      // sources, because a solid disc is a surface. The representation swap
      // below promotes the chair-source family and demotes everything the table
      // path proposed, so the filled half was thrown away with the
      // architecture — nine real tables lost to a difference in ink.
      //
      // So membership is asked as a family question — "which family does this
      // belong to", not "is this dark" — against the vocabulary the plan has
      // already declared through the OTHER half. Nothing here looks at tone,
      // and nothing here is specific to a plan or a coordinate.
      //
      // Both tests are agreement functions already used elsewhere in this file,
      // at the thresholds already used there (the fragment filter's .6 on size
      // and .55 on aspect). Measured on ORNEK's 40 de-duplicated table-pool
      // components, against a family modal taken from the open circles alone:
      //
      //                     size agreement      aspect agreement
      //   the 9 filled      0.89 – 0.94         0.96 – 0.97
      //   the other 31      0.00 – 0.94         0.00 – 0.99
      //   ...but none of the 31 passes BOTH: every component that agrees on
      //   size is a wall, a door or a bay at aspect 1.96 – 3.54 (agreement
      //   0.00 – 0.15), and every component that agrees on aspect is half the
      //   family's size or twice it (agreement 0.00 – 0.22).
      //
      // 9 of 9 and 0 of 31, with the nearest miss on either axis four times the
      // threshold away. It is not a knife edge, and if dark architecture ever
      // did start arriving as tables this is the measurement that would show
      // it: the aspect column is what holds the line.
      const symbolFamilyModal=(()=>{
        if(!chairUniform||!chairModal||chairs.length<8)return null;
        const asp=chairs.map(c=>{const o=c.shape?.obb,w=o?o.w:c.w,h=o?o.h:c.h;
          return Math.max(w,h)/Math.max(1,Math.min(w,h));}).sort((a,b)=>a-b);
        return{side:chairModal,aspect:asp[asp.length>>1]};
      })();
      const familyFromTableSources=symbolFamilyModal
        ?uniqueBeforeSurface.filter(c=>{
          const o=c.shape?.obb,w=o?o.w:c.w,h=o?o.h:c.h;
          return PRIOR.symbolFamilyMember({w,h},symbolFamilyModal);
        })
        :[];
      // Debug capture for benchmarks/run-benchmark.mjs: what each source
      // actually proposed, before and after de-duplication. Off unless asked.
      let debugPool=null;
      if(globalThis.MERIT_DETECT_DEBUG){
        const box=e=>({s:e.comp.source,x:Math.round(e.comp.x),y:Math.round(e.comp.y),
          w:Math.round(e.comp.w),h:Math.round(e.comp.h),n:e.comp.count,fit:+dedupFitness(e.comp).toFixed(2),
          cov:e.comp.surfaceCoverage??null});
        debugPool={provisionalModalArea:provisionalModalArea?Math.round(provisionalModalArea.value):null,
          expanded:expanded.map(box),unique:unique.map(box),
          preSurface:(uniqueBeforeSurface||[]).map(c=>box({comp:c}))};
      }
      for(const entry of unique)analyze([entry.comp],entry.labels);
      // The modal TABLE size must be measured over things that could be a
      // table. Printed glyphs, dimension ticks and wall fragments outnumber the
      // furniture on a busy plan, and letting them set the modal collapses it
      // to a few hundred square pixels — after which the off-modal rule below
      // prunes every real table for being "six times the modal". Measured on
      // the venue plan: modal 274px^2 and 83 genuine tables dropped. A table is
      // by definition at least as big as the plan's own chairs, so anything
      // smaller is excluded from the estimate.
      const chairAreaForModal=chairUniform&&chairModal?chairModal.value**2:null;
      const areaOf=u=>{const o=u.comp.shape?.obb;return o?o.w*o.h:u.comp.w*u.comp.h;};
      const modalPool=chairAreaForModal?unique.filter(u=>areaOf(u)>chairAreaForModal*1.3):unique;
      // THE `>= 4` FALLBACK IS KNOWN TO BE WRONG ON A MIXED SHEET, AND
      // ABSTAINING FROM IT WAS MEASURED AND REVERTED. Recorded here so it is
      // not re-derived: when fewer than four components survive the chair-area
      // filter, this reaches back to the UNFILTERED pool and takes the modal
      // from the very components the line above excluded for being smaller
      // than a chair. On `a9-mixed-representation` that is eleven title
      // glyphs setting a "modal table" of 347px², against which the terrace's
      // three real 104px tables are pruned as "six times the modal" —
      // `tableModalPool: 3`, and the three tables are the fixture's whole
      // remaining table gap.
      //
      // Returning `null` instead (the off-modal rule below already runs
      // without a modal, on the `chairSized` floor alone) recovers them and
      // costs more than it gains: on `a5-architecture-only` two architecture
      // components then survive as tables, which disables the unanchored-seat
      // abstention — that one requires `tablesFound === 0` — and brings back
      // the eight phantom chairs §7 removed. PASS to FAIL, two real
      // abstentions lost, for three tables on one synthetic fixture.
      // Narrowing it to "few, but not none" was tried too and changed
      // nothing, because a5's pool is itself between 1 and 3.
      //
      // The real fix is a modal that is local to a region rather than to a
      // sheet, which is the same mechanism §10 names for the photometric
      // statistics. It is not a threshold move and is not attempted here.
      const modalArea=PRIOR.modalMagnitude((modalPool.length>=4?modalPool:unique).map(areaOf));
      // Off-modal rejection. When the plan really is repetitive (a modal object
      // size supported by several objects), something a fifth the size of every
      // repeated object — a printed character, a dimension tick — is not a
      // table. This is the honest use of the modal prior: it drops what agrees
      // with nothing, instead of the old rule which kept whatever was biggest.
      // Disabled when there is no repeated population to reason from, so a plan
      // with two unlike tables is never pruned on a prior it does not have.
      let offModalDropped=0;
      const chairArea=chairUniform&&chairFloorSide?chairFloorSide**2:null;
      if((modalArea&&modalArea.support>=4)||chairArea){
        const kept=unique.filter(u=>{
          const o=u.comp.shape?.obb,objectArea=o?o.w*o.h:u.comp.w*u.comp.h;
          // Wildly off the repeated object size (an eighth of it, or six times
          // it) with a real repeated population to compare against...
          const wayOff=modalArea&&modalArea.support>=4&&(objectArea<modalArea.value/8||objectArea>modalArea.value*6);
          // ...or no bigger than the plan's own chairs, which a table is not.
          // The margin here used to be 1.3x, which on a real venue plan — where
          // a four-top is only modestly larger than the chairs around it — threw
          // away genuine tables. The defensible statement is the literal one: a
          // table is bigger than a chair. Measured on the venue plan, tightening
          // this recovered 7 tables and changed the seat count not at all.
          const chairSized=chairArea!=null&&objectArea<=chairArea;
          if(!wayOff&&!chairSized)return true;
          offModalDropped++;return false;
        });
        unique.length=0;unique.push(...kept);
      }

      // ---- chair -> table association --------------------------------------
      // merit-plan-intelligence requires each chair to belong to at most one
      // table. The old pipeline evaluated proximity per table independently, so
      // a chair sitting between two tables was counted twice — a real
      // over-count living next to the under-count.
      //
      // This first pass is deliberately the crude one: nearest qualifying table,
      // one chair one table. Its only consumer is the table scorer below, which
      // wants a seat-ADJACENCY count — "how many chairs stand against this
      // blob" — and nothing more.
      //
      // Keeping it crude is a correctness decision, not laziness. Feeding the
      // full relationship reasoning into the thing that decides WHAT IS A TABLE
      // is the circular evidence merit-plan-intelligence forbids: a table would
      // be a table because chairs relate well to it, and those chairs would
      // relate well to it because it is a table. Independent object evidence
      // first; relationship reasoning afterwards, on objects already classified.
      //
      // Measured, when this pass did use the evidence engine: seat counts
      // shifted, table confidence shifted with them, and three renderings of the
      // Golden Plan gained a phantom table each. Detection is not what the
      // engine is for.
      //
      // The real association — perimeter position, facing, arrangement, family,
      // competing tables, ambiguity — runs after suppression, over the tables
      // that survived. See src/plan-relationships.js.
      const tableBoxes=unique.map((entry,index)=>{
        const c=entry.comp,obb=c.shape?.obb||{cx:c.x+c.w/2,cy:c.y+c.h/2,w:c.w,h:c.h,rotation:c.pcaRotation||0};
        return{index,entry,obb};
      });
      // The ink centroid minus the box centre. A connected component already
      // carries both, so the asymmetry that reveals a backrest costs nothing
      // to compute and is the only honest source of a facing direction.
      const inkOffsetOf=ch=>{
        if(!Number.isFinite(ch.cx)||!Number.isFinite(ch.cy))return null;
        return{x:ch.cx-(ch.x+ch.w/2),y:ch.cy-(ch.y+ch.h/2)};
      };
      const chairOBB=ch=>ch.shape?.obb||{cx:ch.x+ch.w/2,cy:ch.y+ch.h/2,w:ch.w,h:ch.h,rotation:ch.pcaRotation||0};
      const relationInput=chairs.map((ch,i)=>({
        id:i,family:ch.chairFamily||chairSource||"unknown",
        obb:chairOBB(ch),inkOffset:inkOffsetOf(ch)}));
      const chairAssign=new Map(),chairsByTable=new Map(),chairRelation=new Map();
      let relationStats=null;
      {
        const pairs=[];
        for(let ci=0;ci<chairs.length;ci++){
          const ch=chairs[ci],px=ch.shape?.obb.cx??ch.x+ch.w/2,py=ch.shape?.obb.cy??ch.y+ch.h/2,span=Math.max(ch.w,ch.h);
          for(const box of tableBoxes){
            const margin=globalThis.MeritRelationships.reachFor(span,box.obb);
            const d=GEO.distanceToOBB(px,py,box.obb);
            if(d<=margin)pairs.push({ci,ti:box.index,d});
          }
        }
        pairs.sort((a,b)=>a.d-b.d||a.ci-b.ci||a.ti-b.ti);
        for(const p of pairs){
          if(chairAssign.has(p.ci))continue;
          chairAssign.set(p.ci,p.ti);
          if(!chairsByTable.has(p.ti))chairsByTable.set(p.ti,[]);
          chairsByTable.get(p.ti).push(p.ci);
        }
      }

      // ---- scoring and ranking (FIX #3) ------------------------------------
      const scored=tableBoxes.map(box=>{
        const c=box.entry.comp,obb=box.obb;
        const seats=(chairsByTable.get(box.index)||[]).length;
        const agreement=PRIOR.sizeAgreement(obb.w*obb.h,modalArea);
        const repetition=tableBoxes.filter(o=>Math.abs(o.obb.w-obb.w)<obb.w*.2&&Math.abs(o.obb.h-obb.h)<obb.h*.2).length;
        const shape=SHAPE.classifyTableShape(c.shape);
        // Deterministic evidence score, NOT a model probability: measured seat
        // adjacency, agreement with the plan's own modal object size, how many
        // identical objects repeat, and how clean the shape signal was.
        const confidence=Math.max(.15,Math.min(.94,
          .32+Math.min(.26,seats*.035)+agreement*.2+Math.min(.1,Math.max(0,repetition-1)*.025)+shape.shapeConfidence*.1
          -((seats===0&&repetition<=1)?.22:0)));
        return{box,c,obb,seats,agreement,repetition,shape,confidence,
          score:agreement*2+Math.min(1,seats/6)+Math.min(.5,(repetition-1)*.08)};
      });
      scored.sort((a,b)=>b.score-a.score||b.confidence-a.confidence);
      // A RESOURCE SAFETY CEILING, NOT A CORRECTNESS LIMIT.
      //
      // This was 240, and 240 is inside the range real venues occupy: the
      // large-venue fixture has 324 tables, so the detector returned exactly
      // 240 of them and reported table recall 0.741 — which is 240/324 to
      // four figures. Eighty-four real tables were dropped by arithmetic, not
      // by any judgement about them, and the operator's only clue was one row
      // in a diagnostics panel.
      //
      // The cap exists to bound work on pathological input (a photograph of
      // noise can label tens of thousands of components), and that is worth
      // keeping. It must simply sit far above any plan a venue could actually
      // draw. 2,000 is ~6x the largest fixture and ~2.5x the largest plausible
      // real venue, while still refusing to let a degenerate image run
      // unbounded.
      //
      // Note what this slice is NOT: it is not the junk filter. Fragment
      // suppression runs below and is what removes false candidates. Raising
      // this ceiling therefore cannot admit junk that suppression would have
      // caught — it only stops real objects being discarded before the filter
      // ever sees them. Plans under the ceiling are bit-identical either way,
      // which is why Golden (41 tables) and ORNEK (166) are unaffected.
      const MAX_TABLES=2000,capReached=scored.length>MAX_TABLES,ranked=scored.slice(0,MAX_TABLES);

      // ---- fragment suppression (Gate C/D) --------------------------------
      // Measured on the real venue plan: of 82 proposed tables, 41 were real
      // and 41 were fragments -- mostly pieces the valley-split step cut out
      // of merged linework and printed matter. They separate cleanly from real
      // furniture, but NOT on any single axis:
      //
      //                  real (n=41)          fragments (n=41)
      //   aspect         1.00-1.12            1.18-2.69  (median 1.55)
      //   sizeAgreement  median 0.99          median 0.39
      //   wasSplit       0/41                 28/41
      //   source         tone 41/41           fill 28, tone 13
      //
      // The tempting rule is "aspect > 1.18", which on this plan separates
      // them perfectly. It is also worthless: a banquet hall of 2.4-aspect
      // rectangle tables would lose every real table it has. So nothing here
      // is an absolute threshold. A plan states its own furniture vocabulary
      // -- a modal size (already used for scoring) and a modal aspect -- and
      // each candidate is judged against THAT. On a rectangle-table plan the
      // modal aspect simply becomes 2.4 and rectangles read as normal.
      //
      // A candidate is dropped only when it disagrees with the plan's own
      // vocabulary on THREE independent axes at once. One odd axis is a real
      // object that happens to be unusual; three is a fragment. Measured:
      // removes 35/41 fragments and 0/41 real tables.
      const aspectOf=obb=>Math.max(obb.w,obb.h)/Math.max(1,Math.min(obb.w,obb.h));
      const medianOf=vals=>{const v=[...vals].sort((a,b)=>a-b);return v.length?v[v.length>>1]:null;};
      const modalAspect=medianOf(ranked.map(s=>aspectOf(s.obb)));
      const agreeWith=(v,m)=>m?Math.max(0,1-Math.abs(v-m)/m):1;
      const fragmentEvidence=s=>{
        const reasons=[];
        if(s.c.wasSplit)reasons.push("cut out of a merged blob");
        if(s.agreement<.6)reasons.push(`size disagrees with the plan's modal object (${s.agreement.toFixed(2)})`);
        const aa=agreeWith(aspectOf(s.obb),modalAspect);
        if(aa<.85)reasons.push(`aspect ${aspectOf(s.obb).toFixed(2)} against plan modal ${modalAspect?modalAspect.toFixed(2):"?"}`);
        // Seat adjacency is evidence only where it could be seating.
        //
        // Recovering this plan's minority chair families gave two architectural
        // blobs their first seats and rescued both from this filter: a 45x99
        // wall panel picked up the two bistro chairs standing 11px from it, and
        // a 56x26 plinth picked up one. The comment below this block predicted
        // the opposite — that recovered chairs would rescue the bistro TABLES
        // and leave the seatless fragments alone. Half of that was right. The
        // chairs came back; the bistro tables are still rejected upstream, so
        // their chairs had no table to belong to and attached to the nearest
        // wall instead.
        //
        // So a seat counts only for a candidate that is at least the size of
        // the plan's own furniture — the wall panel's size agreement is 0.00.
        // The rule stays "no seats at all", not "fewer than two": requiring
        // two put a third reason on most of the plan, which tripped this
        // filter's own self-disabling guard and switched it off entirely
        // (table FP 8 -> 42). A filter that fires on everything is not strict,
        // it is broken, and the guard was right to say so.
        const seatsThatCount=s.agreement>=.25?s.seats:0;
        if(seatsThatCount===0)reasons.push("no seat adjacency");
        return reasons;
      };
      const FRAGMENT_MIN_REASONS=3;
      // The share of proposals that must agree with the plan's modal size
      // before this filter's reasons are worth acting on. Measured across the
      // robustness matrix, and the two groups do not overlap:
      //
      //   Golden Plan       0.432      lowres-roundtrip  0.190
      //   crop-pad          0.411      jpeg-q20          0.183
      //   noise             0.538
      //   blur              0.543
      //
      // The bar sits in a 2.2x gap between the worst legible rendering and the
      // best illegible one, which is as much margin as this evidence can offer.
      const VOCABULARY_MIN_AGREEING=.3;
      // A plan can hold more than one furniture family, and all three reasons
      // above are measured against ONE plan-wide modal, so a minority family
      // disagrees on every axis at once by construction -- exactly this
      // filter's deletion condition. benchmarks/fixtures/adversarial-bistro.png
      // isolates that: 18 square tables set the modal, and the 5 bistro tables
      // are proposed and then dropped with precisely these three reasons.
      //
      // "Repetition is counter-evidence" was tried here and MEASURED WRONG.
      // Requiring one extra reason for a repeated whole component fixed the
      // fixture (FN 5 -> 0) and broke the real plan (FP 6 -> 13, F1 0.882 ->
      // 0.820). The 7 fragments it spared are as tight a family as the real
      // bistros are, on every axis available:
      //
      //                    real plan, spared (all FP)   bistro fixture (real)
      //   tight repetition 7 of 7 within 8%             5 of 5 within 8%
      //   dimensions       55x26, 56x26, 54x26          44x38
      //   seats            0                            0
      //   source           tone                         tone
      //   wasSplit         false                        false
      //   sizeAgreement    0.35-0.46                    0.24
      //
      // The only axis that separates them is aspect (2.1 vs 1.16), and this
      // filter already refuses to use aspect as an absolute threshold -- a
      // banquet hall of 2.4-aspect rectangle tables would lose every table it
      // has. So repetition does not distinguish a minority furniture family
      // from a repeating fragment family, and the change was reverted.
      //
      // The axis that DOES separate them is the one already here: seats. The
      // bistros have two chairs each and score zero only because those chairs
      // touch the table and merge into its component, so the chair pass never
      // proposes them. Recovering merged chairs would give the bistros seat
      // adjacency (2 reasons, kept) and leave the real plan's 7 seatless
      // fragments exactly where they are. That is upstream work in the chair
      // pass, not a loosening of this filter.
      const reasonsNeeded=()=>FRAGMENT_MIN_REASONS;
      // A region the operator already confirmed (or drew themselves) is off
      // limits. The filter may disagree with the detector; it may not overrule
      // a human. Regions arrive as percentages of the plan, same units the
      // candidates are reported in.
      // ...but protection covers the OBJECT the human judged, not everything
      // whose centre happens to land in its box.
      //
      // Centre containment alone was the test, and it protected the wrong
      // things. Measured on the Golden Plan: confirm six chairs, Re-Analyze,
      // and four merged double-table blobs — which the fragment filter had
      // correctly deleted on the first pass — sat with their centres inside a
      // confirmed chair's box, were exempted, and survived. Those false tables
      // then absorbed fifteen real chairs as their seats, so fifteen standalone
      // chair candidates the operator had never touched vanished from the plan
      // (unassociated chairs 47 -> 32) and three remembered corrections had
      // nothing left to re-attach to.
      //
      // A blob twice the size of the chair a person confirmed is not that
      // chair. Overlap decides it, at the ordinary 0.5 intersection-over-union
      // that means "the same object" everywhere else in detection: the same
      // object re-detected scores about 0.95, and a merged pair containing it
      // scores about 0.44.
      const PROTECTED_MIN_IOU=.5;
      const isProtected=obb=>{
        const box={x:(obb.cx-obb.w/2)/width*100,y:(obb.cy-obb.h/2)/height*100,
          w:obb.w/width*100,h:obb.h/height*100};
        return protectedRegions.some(r=>{
          const ix=Math.max(0,Math.min(box.x+box.w,r.x+r.w)-Math.max(box.x,r.x));
          const iy=Math.max(0,Math.min(box.y+box.h,r.y+r.h)-Math.max(box.y,r.y));
          const inter=ix*iy;
          if(!inter)return false;
          return inter/(box.w*box.h+r.w*r.h-inter)>=PROTECTED_MIN_IOU;
        });
      };
      const looksFragmentary=s=>fragmentEvidence(s).length>=reasonsNeeded(s);
      // What the filter believes, BEFORE any human protection is considered.
      //
      // The two must be kept apart, and conflating them was a real defect.
      // `flagged` used to exclude protected candidates, and the self-disabling
      // guard below is computed from it — so protecting a region could remove
      // the very candidate whose presence was holding the filter back, switch
      // the filter on, and delete other objects entirely.
      //
      // Measured on the Golden Plan: six chair confirmations, then Re-Analyze.
      // The confirmed candidates became protected, `wouldLoseConfident` flipped
      // from true to false, the fragment filter went from standing down to
      // running, and FIFTEEN standalone chair candidates the operator had never
      // touched disappeared — merging into eight table-sized blobs, with
      // unassociated chairs dropping 47 to 32. Three remembered corrections
      // then had nothing left to re-attach to, which is what took Re-Analyze
      // retention to 0.81.
      //
      // A human decision may only ever SAVE a candidate. So the guard reasons
      // about the plan, and protection is applied to the outcome afterwards.
      const fragmentary=ranked.filter(looksFragmentary);
      const flagged=fragmentary.filter(s=>!isProtected(s.obb));
      const protectedFromFilter=fragmentary.length-flagged.length;
      // Self-disabling guard, same shape as the surface-coverage filter above:
      // if this would delete most of the plan, the plan is unusual rather than
      // its objects, and a filter that removes the furniture is worse than the
      // fragments it removes. Report the decision either way.
      // An A/B switch so before/after can be measured on the same build rather
      // than by reverting code. Benchmarks set it; the product never does.
      // The guard protects CONFIDENT candidates, not a proposal ratio.
      //
      // It used to be `flagged.length <= ranked.length * .45` — switch the
      // whole filter off if it would remove more than 45% of what was
      // proposed. Two measured problems with that. On the Golden Plan itself
      // the filter removes 38 of 88, which is 43.2%: the plan this project is
      // built around sits one percentage point from having its fragment filter
      // silently disabled. And the `crop-pad` variant — the same drawing moved
      // 60px right and 34px down, nothing else — crosses the line, switches the
      // filter off, keeps all 90 proposals and scores 44 table false positives
      // against 4 on the original.
      //
      // A ratio of proposals is the wrong quantity anyway: proposals include
      // known junk, so "how much of the pool would go" says nothing about
      // whether the plan's furniture is at risk. What matters is whether the
      // filter would take something the detector is confident about — and it
      // cannot, by construction, because deletion needs three independent
      // disagreements with the plan's own vocabulary and a candidate that
      // agrees on size and carries seats can collect at most two.
      //
      // So the guard now asks that directly: if any candidate that agrees with
      // the modal size AND has seats would be deleted, the filter's reasoning
      // is not describing this plan and it stands down. Otherwise it runs,
      // however many fragments there turn out to be.
      // Asked of `fragmentary`, not `flagged`: whether the filter's reasoning
      // describes this plan is a property of the plan, and must not change
      // because a person confirmed something.
      const wouldLoseConfident=fragmentary.some(s=>s.agreement>=.6&&s.seats>0);
      // ...and the vocabulary has to actually describe this plan.
      //
      // Every reason this filter deletes on is a disagreement with a
      // plan-derived modal. On a badly degraded rendering the modal describes
      // nothing — objects are fragmented, sizes scatter, and the filter becomes
      // confidently wrong rather than merely unhelpful. Measured on the
      // `lowres-roundtrip` variant with no such check: it deleted 13 real
      // tables, taking true positives from 28 to 15. A missed table costs an
      // operator more than a false one — a false table is one click to reject,
      // a missed table has to be found and drawn by hand — so a filter that is
      // guessing must stand down.
      //
      // "Does the vocabulary describe the plan" is measurable directly: the
      // share of proposals that agree with the modal size. Measured, that share
      // separates the cases cleanly, and it is a statement about evidence
      // rather than about how many things happen to have been proposed.
      const agreeingShare=ranked.length?ranked.filter(s=>s.agreement>=.6).length/ranked.length:0;
      const vocabularyTrusted=agreeingShare>=VOCABULARY_MIN_AGREEING;
      const fragmentFilterActive=!globalThis.MERIT_DISABLE_FRAGMENT_FILTER&&
        ranked.length>=8&&!wouldLoseConfident&&vocabularyTrusted;
      const fragmentDrops=fragmentFilterActive?flagged:[];
      const droppedIds=new Set(fragmentDrops.map(s=>s.box.index));
      const fragmentDiagnostics={
        active:fragmentFilterActive,
        proposed:ranked.length,
        dropped:fragmentDrops.length,
        protectedByHumanDecision:protectedFromFilter,
        flaggedButKept:fragmentFilterActive?0:flagged.length,
        minReasons:FRAGMENT_MIN_REASONS,
        agreeingShare:Number(agreeingShare.toFixed(3)),
        planModalAspect:modalAspect?Number(modalAspect.toFixed(3)):null,
        disabledReason:fragmentFilterActive?null:
          (globalThis.MERIT_DISABLE_FRAGMENT_FILTER?"disabled by benchmark A/B switch":
           ranked.length<8?"too few candidates to trust a plan-derived vocabulary":
           !vocabularyTrusted?`the plan's modal describes only ${Math.round(agreeingShare*100)}% of proposals`:
           "would have deleted a candidate that agrees with the plan and carries seats"),
        examples:fragmentDrops.slice(0,6).map(s=>({aspect:Number(aspectOf(s.obb).toFixed(2)),
          sizeAgreement:Number(s.agreement.toFixed(2)),seats:s.seats,split:!!s.c.wasSplit,
          repetition:s.repetition,reasons:fragmentEvidence(s)})),
      };
      const chosen=ranked.filter(s=>!droppedIds.has(s.box.index));
      const chosenIndexes=new Set(chosen.map(s=>s.box.index));
      if(globalThis.MERIT_STAGE_CENSUS)globalThis.MERIT_STAGE_CENSUS.stage_chosen=
        chosen.map(c2=>({x:c2.obb.cx-c2.obb.w/2,y:c2.obb.cy-c2.obb.h/2,w:c2.obb.w,h:c2.obb.h}));

      // ---- re-seat the chairs whose table did not survive -------------------
      //
      // Association runs over every table PROPOSAL, and the fragment filter
      // then deletes some of those proposals. A chair assigned to a deleted one
      // used to be dropped from seating entirely and re-emitted as a
      // free-standing object, even when a real, surviving table stood a few
      // pixels away.
      //
      // Measured on the Golden Plan once relationship ground truth was extended
      // from 24 chairs to 83: chair->table accuracy 0.711, with **zero** wrong
      // tables and 22 orphans — every failure was a seat the detector found and
      // seated nowhere. Their annotated tables are 2 to 5 pixels away and were
      // all detected. The detector had the answer and threw it out with the
      // losing proposal.
      //
      // So the REAL association happens here, once, over the tables that
      // survived — and this is the pass that carries the evidence model. It
      // runs after classification, on objects the detector has already decided
      // are tables, so nothing it concludes can feed back into that decision.
      //
      // It also replaces the old patch-up (keep pass one's answers, re-offer
      // only the orphans). Associating everything against the final table set
      // is both simpler and more correct: the context that decides it — how far
      // the other seats at a table sit, what family they are — is measured over
      // the tables that actually exist, not over a set that included proposals
      // since deleted. Nothing new is invented: the surviving tables are a
      // subset of the ones pass one already offered.
      const survivingBoxes=tableBoxes.filter(b=>chosenIndexes.has(b.index));
      const finalRelations=globalThis.MeritRelationships.associate(
        relationInput,survivingBoxes.map(b=>({id:b.index,obb:b.obb})));
      const adjacencyAssign=new Map(chairAssign);
      let reseated=0;
      chairAssign.clear();chairsByTable.clear();
      for(const r of finalRelations.results){
        // `tableIndex` is a position in the surviving list; `tableId` carries
        // the original pool index, which is what everything downstream uses.
        const ti=r.tableId;
        chairRelation.set(r.chairIndex,{...r,tableIndex:ti==null?null:ti});
        if(ti==null)continue;
        if(adjacencyAssign.get(r.chairIndex)!==ti)reseated++;
        chairAssign.set(r.chairIndex,ti);
        if(!chairsByTable.has(ti))chairsByTable.set(ti,[]);
        chairsByTable.get(ti).push(r.chairIndex);
      }
      // How many seats ended up somewhere other than where the crude adjacency
      // pass put them. Most of these are seats whose nearest table was a
      // proposal the suppression stage then deleted — the failure that used to
      // drop them from seating entirely.
      relationStats={...finalRelations.stats,seatedElsewhereThanAdjacency:reseated};

      const toPercentBox=obb=>({x:(obb.cx-obb.w/2)/width*100,y:(obb.cy-obb.h/2)/height*100,w:obb.w/width*100,h:obb.h/height*100});
      // Deterministic evidence score for a chair: how well it agrees with the
      // plan's own modal chair size, plus whether it came from a real colour
      // cluster or only from the luma fallback. Never a random number.
      const chairEvidence=(ch,associated)=>Math.max(.2,Math.min(.9,
        .34+PRIOR.sizeAgreement(Math.sqrt(ch.w*ch.h),chairModal)*.3+(chairSource==="colour-cluster"?.16:0)+(associated?.05:0)));
      // ---- bistro, which is a semantic type and not a shape -----------------
      //
      // Finding a table and knowing WHAT it is are two different jobs, and the
      // shape classifier can only ever answer round, square or rectangle: it
      // sees one component's pixels and nothing else. Measured before this
      // existed, the real plan found all five of its bistro tables and typed
      // every one of them wrong — detection recall 5/5, type accuracy 0/5.
      //
      // "Small table = bistro" is the tempting rule and it is wrong: a small
      // table is a small table, and on a plan of two-tops it would relabel the
      // entire room. What makes a bistro table a bistro table is how it is USED,
      // and that is visible in evidence the shape classifier does not have —
      // who sits at it, how many, and what it is drawn with.
      //
      // Small is necessary but never sufficient. At least two further facts
      // must agree, each of which comes from a different part of the pipeline,
      // so no single signal can carry the label:
      //
      //   seats far fewer than the plan's modal table    (association)
      //   seated by a minority CHAIR family              (chair families)
      //   drawn in a minority surface finish             (tone families)
      //
      // On the real plan all four hold for all five bistro tables. On a plan
      // whose tables are uniformly small the size test passes for everything
      // and the other three fail together, which is the intended behaviour.
      const BISTRO_MAX_AREA_RATIO=.7,BISTRO_MIN_REASONS=3;
      const seatCountOf=s=>(chairsByTable.get(s.box.index)||[]).length;
      const seatedCounts=chosen.map(seatCountOf).filter(n=>n>0).sort((a,b)=>a-b);
      const modalSeats=seatedCounts.length?seatedCounts[seatedCounts.length>>1]:0;
      const bistroReasons=s=>{
        const area=s.obb.w*s.obb.h;
        if(!modalArea||area>modalArea.value*BISTRO_MAX_AREA_RATIO)return[];
        const reasons=["smaller than this plan's modal table"];
        const seats=chairsByTable.get(s.box.index)||[];
        if(modalSeats&&seats.length&&seats.length<=Math.max(2,modalSeats*.5))
          reasons.push(`seats ${seats.length} against a modal table's ${modalSeats}`);
        if(seats.some(ci=>(chairs[ci]?.source||"").startsWith("family:")))
          reasons.push("seated by a minority chair family");
        if(s.c.surfaceFromMinorityFinish)reasons.push("drawn in a minority surface finish");
        return reasons.length>=BISTRO_MIN_REASONS?reasons:[];
      };
      let bistrosTyped=0;
      const candidates=chosen.map(s=>{
        const seatIndexes=chairsByTable.get(s.box.index)||[];
        const bistro=bistroReasons(s);
        if(bistro.length)bistrosTyped++;
        return{id:uid("candidate"),kind:"table",type:bistro.length?"bistro":s.shape.type,
          typeEvidence:bistro.length?bistro:null,...toPercentBox(s.obb),rotation:s.obb.rotation,
          confidence:s.confidence,status:"unreviewed",selected:s.confidence>=confidenceThreshold(),
          // WHY IT WAS HELD BACK, recorded where the decision is made. A
          // candidate below the review threshold was deselected silently:
          // the operator saw it unticked with nothing saying why, and the
          // adversarial harness read the same absence as "unknown". An
          // abstention the product cannot explain is a silent absence, which
          // is the one thing the reliability contract rules out. The
          // THRESHOLD IS UNCHANGED -- lowering it to make a fixture pass
          // would be tuning to the fixture; this states the reason for the
          // decision the threshold already made. A more specific reason set
          // further down (seatsInsideBody) is applied after this and wins.
          lowEvidence:s.confidence>=confidenceThreshold()?null:{
            reason:"belowReviewThreshold",
            confidence:Number(s.confidence.toFixed(2)),
            threshold:Number(confidenceThreshold().toFixed(2))},
          // WHICH SEAT VOCABULARY PUT SEATS HERE. A sheet can carry more than
          // one — the secondary-family pass above exists for exactly that —
          // and the representation swap further down needs to know. Its whole
          // argument is "these repeated marks sit at nothing, so they are not
          // chairs", which is an argument about the PRIMARY family and about
          // the tables size rank proposed out of it. A table whose seats came
          // from a separately admitted family was never part of that argument.
          seatFamilies:[...new Set(seatIndexes.map(ci=>chairs[ci].chairFamily||"primary"))],
          chairDetections:seatIndexes.map(ci=>{
            const obb=chairOBB(chairs[ci]),rel=chairRelation.get(ci);
            return{id:uid("candidate-chair"),x:obb.cx/width*100,y:obb.cy/height*100,
              w:obb.w/width*100,h:obb.h/height*100,rotation:obb.rotation,confidence:chairEvidence(chairs[ci],true),
              // Why this seat was put at this table, kept with the seat rather
              // than thrown away after the decision. An operator asking "why
              // is that chair on table 12" gets an answer, and a close call
              // between two tables is visible as a close call instead of
              // reading exactly like a certain one.
              // The runner-up's `tableId` is its index in the ORIGINAL table
              // pool, which is what the resolution pass below keys on. Its
              // `tableIndex` is a position in the surviving-table list and is
              // meaningless outside the engine.
              relation:rel?{ambiguous:rel.state==="ambiguous",score:rel.score,margin:rel.margin,
                reason:rel.reason,runnerUpTableIndex:rel.runnerUp?rel.runnerUp.tableId:null,
                runnerUpScore:rel.runnerUp?rel.runnerUp.score:null,
                competitors:rel.competitors,evidence:rel.evidence,
                orientation:{known:rel.orientation.known,angle:rel.orientation.angle,
                  strength:Number(rel.orientation.strength.toFixed(3)),evidence:rel.orientation.evidence,
                  facingKnown:rel.orientation.facingKnown,facingAngle:rel.orientation.facingAngle,
                  facingEvidence:rel.orientation.facingEvidence}}:null};
          }),
          evidence:{geometry:Number(Math.min(.95,(s.c.shape?.obbFill??s.c.fill)+.2).toFixed(2)),
            chairs:seatIndexes.length,repetition:s.repetition,source:s.c.source,
            shapeBasis:s.shape.basis,sizeAgreement:Number(s.agreement.toFixed(2)),split:!!s.c.wasSplit}};
      });
      // The relation records a runner-up by its position in the table pool.
      // Resolve those to real candidate ids now that the candidates exist, and
      // drop the reference where the runner-up did not survive into the final
      // list — pointing at an object the operator cannot see would be worse
      // than not naming it.
      {
        const idByTableIndex=new Map();
        chosen.forEach((s,i)=>idByTableIndex.set(s.box.index,candidates[i].id));
        for(const c of candidates)for(const ch of c.chairDetections){
          if(!ch.relation)continue;
          const ti=ch.relation.runnerUpTableIndex;
          ch.relation.runnerUpId=ti==null?null:(idByTableIndex.get(ti)||null);
          delete ch.relation.runnerUpTableIndex;
        }
      }
      // ---- a table that contains all of its own seats ---------------------
      //
      // Measured across eleven renderings (benchmarks/false-positives/): of 424
      // correctly detected tables, ZERO have every attached seat's centre
      // inside the table's own box. Of the invented ones, 121 do.
      //
      // The reason is physical rather than statistical. Chairs stand AROUND a
      // table, so their centres fall outside its outline; a box whose seats are
      // all inside itself is not a table with seats, it is a seat wrapped in a
      // table. On the renderings where tone separation collapses — `hue-shift`,
      // `bright-up`, `contrast-high`, `blur` — a chair merges with its
      // surroundings into one component and the table pass proposes a box
      // around it. Those four account for 121 of the 176 invented tables of
      // this kind.
      //
      // IT IS NOT DELETED, and that is the whole design. This is one venue, and
      // a drawing that tucks its chairs under the tables would trip the same
      // topology honestly. So the candidate is DESELECTED and flagged
      // low-evidence: it stays on screen, stays reviewable, keeps its seat, and
      // is simply not committed to the floor plan unless a person says so.
      // Abstention, not a verdict.
      //
      // ------------------------------------------------------------------
      // AND THAT WORRY WAS RIGHT. The adversarial fixtures were built to test
      // exactly this rule, and it failed both of them. On `a1` — a banquet
      // plan with the chairs tucked under long tables, which is how a plan
      // shows a set table nobody is sitting at — it held back all 8 tables it
      // found. On `a8` the table and its ring of chairs merge into one
      // component, so the proposed box spans the ring, so every seat centre
      // falls inside it, and it held back all 240 tables of a 324-table venue.
      // A rule that was right 158 times and wrong none on one drawing was
      // wrong 248 times on the first two drawings it had never seen.
      //
      // The fix came out of re-reading the measurement rather than guessing.
      // Of the 117 invented tables this gate has ever held across the eleven
      // renderings, EVERY SINGLE ONE has exactly one seat inside it. Not one
      // has two. The real tucked tables have six (a1) and ten (a8).
      //
      // So the topology was never the signal — the COUNT was. One seat inside
      // a box is a seat wrapped in a table. Six seats inside a box is a table
      // with its chairs pushed in. `seatFill` does not separate them (the
      // invented ones span 0.10-0.64 and a1's real ones sit at 0.27 in the
      // middle of that range); the seat count separates them completely.
      //
      // The seat count alone still is not enough, and `a8` proves it. On a
      // 324-table venue drawn at arena scale the seat symbols are 17px and
      // chair recall collapses to 0.074, so each merged table-plus-ring box
      // carries exactly ONE detected seat, inside itself — indistinguishable
      // from a fragment by the count. The gate held all 240 tables the plan
      // had, and the operator would have been handed an empty floor.
      //
      // What separates them there is not the individual candidate but the
      // SHARE. Measured across the eleven renderings, the most this pattern
      // ever describes on a plan where it is genuinely a fragment is 42%
      // (`hue-shift`; then 37%, 37%, 19%, and 2% or 0 everywhere else). On the
      // two plans where the held tables are real it describes 100%.
      //
      // So the gate refuses to run when it would claim most of the plan. That
      // is the same guard the surface filter above already applies for the same
      // reason: a suppression rule that removes almost everything is not being
      // strict, it is misfiring, and the honest response is to stand down and
      // say so rather than to hand back a blank drawing.
      const GATE_MAX_SHARE=.6;
      let seatsInsideBody=0,seatsInsideBodyStoodDown=null;
      {
        const held=candidates.filter(c=>{
          const seats=c.chairDetections||[];
          // Two or more seats under one box is a tucked table, not a fragment.
          // Measured, not assumed: of the 117 invented tables this gate has
          // ever held, every one has exactly one seat inside it.
          if(seats.length!==1)return false;
          // A nested seat carries its CENTRE in x/y; the table carries a
          // top-left corner. Comparing them the other way round would make
          // this fire on almost everything.
          const ch=seats[0];
          return ch.x>c.x&&ch.x<c.x+c.w&&ch.y>c.y&&ch.y<c.y+c.h;
        });
        const share=candidates.length?held.length/candidates.length:0;
        if(held.length&&share>GATE_MAX_SHARE){
          seatsInsideBodyStoodDown={wouldHold:held.length,of:candidates.length,
            share:Number(share.toFixed(3)),limit:GATE_MAX_SHARE};
        }else for(const c of held){
          c.selected=false;
          c.lowEvidence={reason:"seatsInsideBody",seats:1};
          seatsInsideBody++;
        }
      }
      // Chairs that belong to no detected table stay first-class objects with
      // their real coordinates instead of being dropped (which is how the old
      // pipeline lost seats). They are never attached to an invented table.
      // Printed glyphs are chair-sized, so on a plan with no colour separation
      // the chair detector reads the letters of a room label as seats. On the
      // dense benchmark fixture that is exactly what happened: 24 phantom
      // chairs, every one of them a letter of "BALLROOM B" / "96 PAX" /
      // "ZONE A" / "ZONE B".
      //
      // The existing OCR-based suppression cannot help here — it requires
      // Tesseract, and the whole point of the offline build is that OCR may be
      // absent. But text does not need to be READ to be recognised as text. A
      // word is a run of similarly-sized marks sitting on a shared baseline
      // with small, regular gaps. Chairs are arranged around a table
      // perimeter, and the ones that are not are still not baseline-aligned
      // with tight even spacing. That structure is the evidence, and it is
      // available with no engine at all.
      //
      // Deliberately conservative: only UNASSOCIATED chairs are eligible (a
      // chair the associator tied to a real table is never touched), the run
      // must be at least 4 long, and the gaps must be tighter than the marks
      // are wide — which is true of letters and false of seats around a table.
      const TEXT_RUN_MIN_TABLE_DISTANCE_WIDTHS=2.0;
      // Edge distance from a mark to the nearest DETECTED table box, in pixels.
      const nearestTableDistance=e=>{
        let best=Infinity;
        for(const s of chosen){
          const t=s.obb;
          const dx=Math.max(0,Math.abs(e.cx-t.cx)-(t.w/2+e.w/2));
          const dy=Math.max(0,Math.abs(e.cy-t.cy)-(t.h/2+e.h/2));
          best=Math.min(best,Math.hypot(dx,dy));
        }
        return best;
      };
      const textRunIndexes=(()=>{
        const eligible=[];
        for(let ci=0;ci<chairs.length;ci++){
          const ti=chairAssign.get(ci);
          if(ti!==undefined&&chosenIndexes.has(ti))continue;   // associated: leave alone
          const obb=chairOBB(chairs[ci]);
          eligible.push({ci,cx:obb.cx,cy:obb.cy,w:obb.w,h:obb.h,bottom:obb.cy+obb.h/2});
        }
        const flagged=new Set();
        if(eligible.length<4)return flagged;
        // group by shared baseline: bottom edges within 25% of glyph height
        const used=new Set();
        for(const seed of eligible){
          if(used.has(seed.ci))continue;
          const tol=Math.max(2,seed.h*.25);
          const line=eligible.filter(e=>!used.has(e.ci)&&Math.abs(e.bottom-seed.bottom)<=tol&&
            Math.abs(e.h-seed.h)<=seed.h*.6).sort((a,b)=>a.cx-b.cx);
          if(line.length<4)continue;
          // horizontal run: consecutive gaps small relative to mark width
          let run=[line[0]];
          const runs=[];
          for(let i=1;i<line.length;i++){
            const prev=run[run.length-1];
            const gap=(line[i].cx-line[i].w/2)-(prev.cx+prev.w/2);
            const maxGap=Math.max(prev.w,line[i].w)*.9;
            if(gap<=maxGap&&gap>=-Math.max(prev.w,line[i].w)*.5)run.push(line[i]);
            else{runs.push(run);run=[line[i]];}
          }
          runs.push(run);
          for(const r of runs){
            if(r.length<4)continue;
            // a real word's marks are packed: median gap under half the mark
            // width. Seats spaced around a table are not.
            const gaps=[];
            for(let i=1;i<r.length;i++)gaps.push((r[i].cx-r[i].w/2)-(r[i-1].cx+r[i-1].w/2));
            gaps.sort((a,b)=>a-b);
            const medGap=gaps[gaps.length>>1],medW=r.map(e=>e.w).sort((a,b)=>a-b)[r.length>>1];
            // Letters differ in width -- I against M -- while chairs are one
            // object repeated, so their widths barely vary. This is what
            // separates a word from a row of seats, and it is measured on the
            // run itself rather than assumed.
            // A seat serves a table. That is the domain fact this rests on,
            // and it separates the two cases where pixel statistics do not:
            // measured, printed glyphs sit 3-9 mark-widths from the nearest
            // detected table while real unassociated seats sit under 1.5 away,
            // because they are the seats of a table right there.
            //
            // (Shape variation was the first hypothesis -- letters differ in
            // width, seats do not -- and the measurement rejected it: glyph
            // runs came back at cv 0.08 against 0.03 for seats, far too close
            // to separate on. It is left out rather than tuned into place.)
            const runGap=r.reduce((worst,e)=>Math.min(worst,nearestTableDistance(e)),Infinity);
            const runGapInWidths=runGap/Math.max(1,medW);
            if(globalThis.MERIT_TEXTRUN_PROBE)globalThis.MERIT_TEXTRUN_PROBE.push({len:r.length,medW,medGap,runGap,runGapInWidths});
            if(medGap<=medW*.5&&runGapInWidths>=TEXT_RUN_MIN_TABLE_DISTANCE_WIDTHS){
              for(const e of r){flagged.add(e.ci);used.add(e.ci);}}
          }
        }
        return flagged;
      })();
      const chairVenues=[];
      let textGlyphChairsDropped=0;
      // Where members of the uniform family go when they do NOT become
      // standalone objects. On a plan that draws chairs these two exits are
      // correct and uninteresting: a chair at a table belongs to that table,
      // and a run of glyphs is printing. On a SYMBOLIC plan the same two
      // exits silently delete tables, so the boxes are kept rather than only
      // counted — a count says how many were lost, these say which.
      const familyLostToAssociation=[],familyLostToTextRun=[];
      // The object a family member becomes when it does reach the plan in its
      // own right. Factored out because the representation swap below can send
      // an exited member back through here, and a restored object that differed
      // in shape from its neighbours would be a second bug.
      const familyVenue=ch=>{
        const obb=chairOBB(ch);
        return{id:uid("candidate"),kind:"venue",type:"chair",...toPercentBox(obb),rotation:obb.rotation,
          confidence:chairEvidence(ch,false),status:"unreviewed",selected:false,chairDetections:[],
          // Which vocabulary this mark belongs to, carried onto the object so
          // the swap can tell a symbol of the plan's one family from a member
          // of a second, separately admitted seat family.
          seatFamily:ch.chairFamily||"primary",
          evidence:{geometry:Number(Math.min(.95,ch.fill).toFixed(2)),chairs:1,repetition:chairs.length,
            source:chairSource,unassociated:true}};
      };
      for(let ci=0;ci<chairs.length;ci++){
        const ti=chairAssign.get(ci);
        if(ti!==undefined&&chosenIndexes.has(ti)){familyLostToAssociation.push(chairs[ci]);continue;}
        if(textRunIndexes.has(ci)){textGlyphChairsDropped++;familyLostToTextRun.push(chairs[ci]);continue;}
        chairVenues.push(familyVenue(chairs[ci]));
      }
      // B-15 — columns, merged-row blobs and unnamed venue-scale shapes — is
      // MeritPlanVenueObjects (src/plan-detection-venues.js), contract there.
      const venueScale=VENUE_OBJECTS.venueScaleObjects({chosen,chairAssign,surfaceRejectedComps,chairs,gapTo,
        sources,venueSizeOk,analyze,uid,toPercentBox,chairVenues});
      const {columnComps,mergedRowVenues}=venueScale;
      let venues=venueScale.venues;

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
