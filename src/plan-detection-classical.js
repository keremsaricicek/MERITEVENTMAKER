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
  const RGB_BITS=3,RGB_LEVELS=1<<RGB_BITS,RGB_BINS=RGB_LEVELS**3,RGB_SHIFT=8-RGB_BITS;
  const LOW_CHROMA=40,MID_CHROMA=90;
  function rgbBinIndex(r,g,b){return((r>>RGB_SHIFT)*RGB_LEVELS+(g>>RGB_SHIFT))*RGB_LEVELS+(b>>RGB_SHIFT);}
  function rgbHue(r,g,b){
    const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
    if(!d)return 0;
    let h;
    if(max===r)h=((g-b)/d)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;
    h*=60;return h<0?h+360:h;
  }
  function hueGap(a,b){const d=Math.abs(a-b)%360;return d>180?360-d:d;}
  function buildAccentModel(binCount,binR,binG,binB,total){
    const order=[];
    for(let bin=0;bin<RGB_BINS;bin++)if(binCount[bin])order.push(bin);
    order.sort((a,b)=>binCount[b]-binCount[a]||a-b); // ties broken by bin index so the model is reproducible run to run
    const clusters=[],MERGE_DIST=72; // one 3-bit bucket step is 32 per channel
    for(const bin of order){
      const n=binCount[bin],r=binR[bin]/n,g=binG[bin]/n,b=binB[bin]/n;
      let host=null,bestDist=Infinity;
      for(const cl of clusters){const d=Math.hypot(cl.r-r,cl.g-g,cl.b-b);if(d<bestDist){bestDist=d;host=cl;}}
      if(host&&bestDist<=MERGE_DIST){
        host.n+=n;host.sr+=binR[bin];host.sg+=binG[bin];host.sb+=binB[bin];
        host.r=host.sr/host.n;host.g=host.sg/host.n;host.b=host.sb/host.n;
      }else if(clusters.length<12)clusters.push({n,sr:binR[bin],sg:binG[bin],sb:binB[bin],r,g,b});
    }
    if(!clusters.length)return null;
    for(const cl of clusters){
      cl.luma=cl.r*.299+cl.g*.587+cl.b*.114;
      cl.chroma=Math.max(cl.r,cl.g,cl.b)-Math.min(cl.r,cl.g,cl.b);
      cl.hue=rgbHue(cl.r,cl.g,cl.b);
      cl.fraction=cl.n/total;
    }
    const background=clusters.reduce((best,c)=>c.n>best.n?c:best,clusters[0]);
    const others=clusters.filter(c=>c!==background);
    const saturated=others.filter(c=>c.chroma>=45&&c.fraction>=.0006)
      .sort((a,b)=>b.chroma*Math.sqrt(b.n)-a.chroma*Math.sqrt(a.n)||b.n-a.n);
    const seed=saturated[0]||null;
    // A drawn object is usually a saturated fill plus a darker stroke of the
    // SAME hue, so the accent family is hue-anchored, not a single cluster.
    const accent=seed?others.filter(c=>c.chroma>=Math.max(35,seed.chroma*.5)&&hueGap(c.hue,seed.hue)<=30&&c.fraction>=.0002):[];
    const accentSet=new Set(accent);
    // Per-bucket lookup, including the antialiased in-between buckets that
    // never got their own cluster: mask building becomes one lookup per pixel.
    const accentBucket=new Uint8Array(RGB_BINS),neutralBucket=new Uint8Array(RGB_BINS);
    const chromaCut=seed?Math.max(LOW_CHROMA,Math.min(MID_CHROMA,seed.chroma*.5)):MID_CHROMA;
    for(let bin=0;bin<RGB_BINS;bin++){
      const rb=(bin/(RGB_LEVELS*RGB_LEVELS))|0,gb=((bin/RGB_LEVELS)|0)%RGB_LEVELS,bb=bin%RGB_LEVELS,half=1<<(RGB_SHIFT-1);
      const r=rb*(1<<RGB_SHIFT)+half,g=gb*(1<<RGB_SHIFT)+half,b=bb*(1<<RGB_SHIFT)+half;
      let best=clusters[0],bestDist=Infinity;
      for(const cl of clusters){const d=(cl.r-r)**2+(cl.g-g)**2+(cl.b-b)**2;if(d<bestDist){bestDist=d;best=cl;}}
      accentBucket[bin]=accentSet.has(best)?1:0;
      neutralBucket[bin]=(!accentBucket[bin]&&(Math.max(r,g,b)-Math.min(r,g,b))<=chromaCut)?1:0;
    }
    return{clusters,background,accent,accentBucket,neutralBucket,
      isColorPlan:accent.length>0,
      accentHue:seed?Math.round(seed.hue):null,accentChroma:seed?Math.round(seed.chroma):null,
      accentFraction:accent.reduce((n,c)=>n+c.fraction,0),backgroundLuma:Math.round(background.luma)};
  }
  // Tone families: the real flat fills of the drawing, found as peaks of the
  // non-accent luma histogram. Each family claims only a narrow band around its
  // own peak, so the 1px antialiasing ramp between paper and a fill belongs to
  // neither family and cannot bridge two objects together.
  function buildToneModel(lowHist,midHist,sampled,accentChroma){
    const useMid=!accentChroma||accentChroma>=120; // a mid-chroma fill is a table tint, unless the accent itself is that weak
    const hist=new Float64Array(256);
    let neutral=0;
    for(let v=0;v<256;v++){hist[v]=lowHist[v]+(useMid?midHist[v]:0);neutral+=hist[v];}
    if(!neutral)return null;
    const smooth=new Float64Array(256);
    for(let v=0;v<256;v++){
      let sum=0,n=0;
      for(let k=-2;k<=2;k++){const u=v+k;if(u<0||u>255)continue;sum+=hist[u];n++;}
      smooth[v]=sum/n;
    }
    const raw=[];
    // The ends of the range are candidates too: white paper sits at 255 and a
    // solid black fill at 0, and skipping the boundaries made the brightest
    // fill (not the paper) look like the background of the drawing.
    for(let v=0;v<256;v++){
      const prev=v>0?smooth[v-1]:-1,next=v<255?smooth[v+1]:-1;
      if(smooth[v]>0&&smooth[v]>=prev&&smooth[v]>next)raw.push(v);
    }
    raw.sort((a,b)=>smooth[b]-smooth[a]||a-b);
    const peaks=[];
    for(const v of raw){
      if(peaks.some(p=>Math.abs(p.luma-v)<10))continue; // one peak per real fill, not per histogram wobble
      let mass=0;
      for(let k=-5;k<=5;k++){const u=v+k;if(u>=0&&u<256)mass+=hist[u];}
      peaks.push({luma:v,mass,fraction:mass/sampled});
      if(peaks.length>=8)break;
    }
    if(!peaks.length)return null;
    peaks.sort((a,b)=>a.luma-b.luma);
    const background=peaks.reduce((best,p)=>p.mass>best.mass?p:best,peaks[0]);
    // A luma floor used to exclude dark peaks here, on the theory that anything
    // dark enough is linework. On white paper that floor lands at 114, and a
    // mid-grey chair fill sits at 110 -- so on every monochrome plan the chair
    // family was thrown away as "ink" before a single component was looked at.
    // Measured on the dense grayscale fixture: 96 chairs, 0 detected, because
    // their tone family never existed.
    //
    // Darkness is the wrong question. Linework is THIN; furniture is a solid,
    // repeated, similarly-sized blob. That is a structural property and it is
    // measured per family from the family's own components, in the mask loop
    // below, where the pixels are actually available. Here the job is only to
    // offer the candidates -- including dark ones, flagged so the structural
    // test can be stricter with them.
    const inkCeil=Math.max(90,background.luma*.45);
    // Every qualifying peak is a candidate surface family, not the three
    // largest.
    //
    // This used to be `.slice(0,3)` — a top-three-by-mass cut — and a minority
    // furniture surface is DEFINED by having little mass, so that cap was not a
    // tie-break but a structural exclusion. Measured on the real venue plan:
    // its luma peaks are 29, 109, 121, 146, 169, 201, 229, 255, and the bistro
    // tables' tan surface does peak, at 201. The cut kept 229 (bulk grey
    // architecture) and 121/146 (linework), so no tint mask ever contained the
    // tan; the five bistro discs then scored 0.124-0.132 surface coverage
    // against a 0.22 floor and were deleted. All five of this plan's remaining
    // table misses were those tables. See benchmarks/SINGLE-FAMILY-AUDIT.md.
    //
    // Mass was never the right question. Whether a tone family is furniture is
    // decided downstream, from the family's own components -- are they compact,
    // repeated, similarly sized -- and that test cannot run on a family that
    // was thrown away before its mask was built. The filter conditions here
    // (real mass, not the background, above the ink ceiling) select candidates;
    // the structural test selects families.
    //
    // Bounded by the peak finder's own limit rather than an independent number.
    // Each family claims only a narrow band around its own peak, computed from
    // the gap to the nearest PEAK (not the nearest family), so admitting one
    // more family cannot widen or narrow anybody else's band -- the measured
    // failure that produced the old cap was adding DARK peaks, which sit close
    // together and do fight over pixels, and those are still kept out of this
    // list entirely (darkCandidates below).
    const families=peaks.filter(p=>p!==background&&p.luma<background.luma-10&&p.luma>inkCeil&&p.fraction>=.002)
      .sort((a,b)=>b.mass-a.mass);
    // Peaks the ceiling rejects. These are NOT added to `families`, because
    // `families` drives the nearest-family tone LUT and adding to it steals
    // pixels from the table surface family -- measured on the real colour
    // plan, tone sources fell 57 -> 23 and the table masks fragmented.
    //
    // They get their own standalone masks instead, and are offered only to the
    // chair pool, where the grayscale failure actually is.
    const darkFloor=Math.max(35,background.luma*.15);
    const darkCandidates=peaks.filter(p=>p!==background&&p.luma<=inkCeil&&p.luma>darkFloor&&p.fraction>=.0015)
      .sort((a,b)=>b.mass-a.mass).slice(0,3);
    const toneLut=new Uint8Array(256);
    families.forEach((family,index)=>{
      let gap=Infinity;
      for(const p of peaks)if(p!==family)gap=Math.min(gap,Math.abs(p.luma-family.luma));
      const window=Math.max(3,Math.min(14,Math.floor(gap/2)));
      for(let v=Math.max(0,family.luma-window);v<=Math.min(255,family.luma+window);v++)
        if(!toneLut[v]||Math.abs(v-family.luma)<Math.abs(v-families[toneLut[v]-1].luma))toneLut[v]=index+1;
    });
    return{peaks,background,families,darkCandidates,toneLut,
      summary:{peaks:peaks.map(p=>p.luma),backgroundLuma:background.luma,
        families:families.map(f=>({luma:f.luma,fraction:Number(f.fraction.toFixed(4))})),
        darkCandidates:darkCandidates.map(f=>({luma:f.luma,fraction:Number(f.fraction.toFixed(4))}))}};
  }

  // ---- Masks --------------------------------------------------------------
  function buildClassMasks(data,gray,total,accentModel,toneModel){
    const accent=accentModel?.isColorPlan?new Uint8Array(total):null;
    const familyCount=toneModel?.families.length||0,tints=[];
    for(let k=0;k<familyCount;k++)tints.push(new Uint8Array(total));
    const accentBucket=accentModel?.accentBucket,neutralBucket=accentModel?.neutralBucket,toneLut=toneModel?.toneLut;
    for(let i=0,o=0;i<total;i++,o+=4){
      const bin=rgbBinIndex(data[o],data[o+1],data[o+2]);
      if(accent&&accentBucket[bin]){accent[i]=1;continue;}
      if(!familyCount)continue;
      if(accentBucket&&accentBucket[bin])continue;
      if(neutralBucket&&!neutralBucket[bin])continue;
      const family=toneLut[gray[i]];
      if(family)tints[family-1][i]=1;
    }
    return{accent,tints};
  }
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
      // ---- pass 1: luma + histogram + RGB colour histogram, one loop ----
      const gray=new Uint8Array(total),hist=new Uint32Array(256);
      // The colour model is a global statistic, so it is built from a fixed 2x2
      // subsample (deterministic, ~25% of the pixels) instead of every pixel.
      const binCount=new Uint32Array(RGB_BINS),binR=new Uint32Array(RGB_BINS),binG=new Uint32Array(RGB_BINS),binB=new Uint32Array(RGB_BINS);
      // Luma histograms split by how saturated the pixel is, so the tone model
      // can look at the drawing's fills without the accent objects skewing it.
      const lumaLowChroma=new Uint32Array(256),lumaMidChroma=new Uint32Array(256);
      let sum=0,sampled=0;
      for(let y=0;y<height;y++){
        const rowSampled=(y&1)===0;
        for(let x=0,i=y*width,o=i*4;x<width;x++,i++,o+=4){
          const r=data[o],g=data[o+1],b=data[o+2];
          const v=Math.round(r*.299+g*.587+b*.114);
          gray[i]=v;hist[v]++;sum+=v;
          if(rowSampled&&(x&1)===0){
            const bin=rgbBinIndex(r,g,b);
            binCount[bin]++;binR[bin]+=r;binG[bin]+=g;binB[bin]+=b;sampled++;
            const chroma=Math.max(r,g,b)-Math.min(r,g,b);
            if(chroma<LOW_CHROMA)lumaLowChroma[v]++;else if(chroma<MID_CHROMA)lumaMidChroma[v]++;
          }
        }
      }
      const threshold=DESKEW.otsu(hist,total,sum);
      mark("pixels");
      await stage("understanding",30);phaseFrom=performance.now();
      // ---- pass 2: adaptive fill mask and Sobel edge map, kept SEPARATE ----
      // FIX #2: the edge map is no longer OR-ed into the mask that gets
      // labelled. It is used only as a BARRIER for enclosed-region extraction
      // (where a shared outline helps by separating two interiors) and as the
      // union mask handed to computeVisualDescriptor, whose descriptor
      // semantics stay exactly as before.
      const fillMask=new Uint8Array(total),edgeMask=new Uint8Array(total),barrier=new Uint8Array(total);
      const integral=new Uint32Array((width+1)*(height+1));
      for(let y=1;y<=height;y++){let row=0;for(let x=1;x<=width;x++){row+=gray[(y-1)*width+x-1];integral[y*(width+1)+x]=integral[(y-1)*(width+1)+x]+row;}}
      const stride=width+1;
      for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
        const i=y*width+x,r=18,x0=Math.max(0,x-r),x1=Math.min(width-1,x+r),y0=Math.max(0,y-r),y1=Math.min(height-1,y+r);
        const local=(integral[(y1+1)*stride+x1+1]-integral[y0*stride+x1+1]-integral[(y1+1)*stride+x0]+integral[y0*stride+x0])/((x1-x0+1)*(y1-y0+1));
        const gx=-gray[i-width-1]+gray[i-width+1]-2*gray[i-1]+2*gray[i+1]-gray[i+width-1]+gray[i+width+1];
        const gy=-gray[i-width-1]-2*gray[i-width]-gray[i-width+1]+gray[i+width-1]+2*gray[i+width]+gray[i+width+1];
        if(gray[i]<Math.min(threshold+12,local-7))fillMask[i]=1;
        if(Math.abs(gx)+Math.abs(gy)>150)edgeMask[i]=1;
        barrier[i]=(fillMask[i]||edgeMask[i])?1:0;
      }
      const binary=barrier; // same union the previous pipeline labelled; kept for computeVisualDescriptor
      mark("binarize");
      const accentModel=buildAccentModel(binCount,binR,binG,binB,sampled);
      const toneModel=buildToneModel(lumaLowChroma,lumaMidChroma,sampled,accentModel?.accentChroma);
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

      // ---- object sources --------------------------------------------------
      const sources=[],diagnosticsSources={};
      // Chair-size components are collected per source at the same time, in
      // order of how specific the evidence is (a dedicated colour cluster
      // beats a tone cluster beats "it was dark enough to threshold").
      const chairSources=[];
      let fallbackChairComps=[],fallbackChairLabels=null,accentMask=null,surfaceMask=null,masksTints=null;
      // Which tint families the plan uses as CHAIR material, aligned with masksTints.
      const tintIsChairMaterial=[];
      // (a) interiors of closed outlines — the primary table source
      {
        const enclosed=COMP.enclosedRegions(barrier,width,height);
        const{labels,comps}=COMP.labelComponents(enclosed,width,height,minPixels,false);
        const kept=comps.filter(c=>tableSizeOk(c)&&c.fill>=.35);
        for(const c of kept)c.source="interior";
        diagnosticsSources.interior=kept.length;
        sources.push({name:"interior",labels,comps:kept,all:comps});
        // The same enclosed interiors, at chair scale, are a chair source.
        // Not every chair is a filled symbol: the round tables on the real
        // venue plan are ringed by OUTLINED pale chairs, which carry no
        // saturated colour and no distinct fill tone, so neither the accent
        // cluster nor any tone family can see them. What they do have is a
        // closed outline, which is exactly what this pass already extracts --
        // it was simply never offered to the chair pool.
        const interiorChairs=comps.filter(c=>chairSizeOk(c)&&c.fill>=.35);
        if(interiorChairs.length)chairSources.push({name:"outline-interior",labels,
          rawCount:comps.length,comps:interiorChairs});
        mark("interiors");
      }
      // (b) tinted/solid fills straight from the colour model — one mask per
      //     tone family, so a mid-grey chair fill and a pale table fill cannot
      //     end up in the same mask and merge
      if(accentModel||toneModel){
        const masks=buildClassMasks(data,gray,total,accentModel,toneModel);
        accentMask=masks.accent;
        masksTints=masks.tints;
        // The tint family that actually carries furniture surfaces, kept as a
        // per-pixel mask so a table candidate can later be asked the direct
        // question "is this thing made of table?". Chosen by how much of the
        // drawing it covers, which on a seating plan is the table fill.
        //
        // Asking every solid tint family instead, and taking the best answer,
        // was tried here: it is the same "a plan may have two families" fix
        // that worked for chairs, and this plan does draw its bistro tables in
        // a different finish (tan, luma 213) from its banquet tables (pale
        // grey, luma 229). It changed nothing on the real plan — the tan is
        // not a tint family at all, so there was no second family to find —
        // and it cost the dense fixture four table false positives, because
        // there a second solid family exists and "made of SOME furniture tone"
        // is a weaker question than "made of THE table tone".
        //
        // The real-plan bistro finish needs the tone model to see tan as a
        // family in the first place; widening this consumer of it does not
        // help. Left as it was, with the finding recorded.
        surfaceMask=masks.tints.length?masks.tints.reduce((best,m)=>{
          let n=0;for(let i=0;i<total;i+=7)if(m[i])n++;
          return (!best||n>best.n)?{mask:m,n}:best;
        },null)?.mask||null:null;
        let toneKept=0;
        const toneFamilyEvidence=[];
        masks.tints.forEach((mask,index)=>{
          const solidity=COMP.maskSolidity(mask,width,height);
          const family=toneModel?.families?.[index]||null;
          const{labels,comps}=COMP.labelComponents(mask,width,height,minPixels,true);

          // Is this tone family furniture, or is it linework?
          //
          // Not decided by how dark it is. Linework is thin: its components
          // sprawl, have low fill inside their own bounding box, and vary
          // wildly in size. Furniture repeats: many components at nearly the
          // same scale, each solidly filling its box. So the family is asked
          // about its own components.
          const compact=comps.filter(c=>c.fill>=.45&&Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h))<=2.2);
          const sides=compact.map(c=>Math.sqrt(c.w*c.h)).sort((a,b)=>a-b);
          const medSide=sides.length?sides[sides.length>>1]:0;
          // How tightly the compact components agree on one size. A repeated
          // furniture symbol clusters hard; incidental ink blobs do not.
          const nearModal=medSide?compact.filter(c=>{
            const s=Math.sqrt(c.w*c.h);return s>=medSide*.65&&s<=medSide*1.55;}).length:0;
          const repetition=compact.length?nearModal/compact.length:0;
          // ...and what repeats has to be big enough to be a drawn object.
          //
          // Repetition alone says "many similar blobs", which is equally true of
          // a seating row and of the antialiasing band along every edge in the
          // drawing. Measured, once minority tone families were admitted: the
          // real plan's tan surface family arrives as 823 components whose
          // modal side is 4.9px against a 7.7px chair floor — fringe — and it
          // passed this test on 148 of 192 compact components agreeing with
          // each other. It then contributed 22 false chairs.
          //
          // The family's own modal size is the honest thing to ask about, and
          // the floor is the same plan-relative one a single chair must clear.
          const familyModalOk=medSide>=minDim*CHAIR_MIN_SIDE_P;
          const looksLikeFurniture=nearModal>=6&&repetition>=.55&&familyModalOk;
          // A dark family has to clear the structural bar outright, since dark
          // families are where linework actually lives. A light family may also
          // pass on the old solidity signal alone.
          const tableWorthy=solidity>=.25; // antialiasing fringe along outlines, not a real filled object
          const chairWorthy=looksLikeFurniture;
          toneFamilyEvidence.push({index,luma:family?.luma??null,
            solidity:Number(solidity.toFixed(3)),components:comps.length,compact:compact.length,
            nearModal,repetition:Number(repetition.toFixed(2)),
            modalSide:medSide?Number(medSide.toFixed(1)):null,
            usedForTables:tableWorthy,usedForChairs:chairWorthy,
            verdict:tableWorthy?"furniture surface (solid mask)":chairWorthy?"repeated compact family (chairs only)":"linework"});
          // On a neutral drawing one tone family IS the chairs (a mid-grey
          // chair fill against a pale table fill), so tone families are a real
          // chair source, not only a table source.
          tintIsChairMaterial[index]=chairWorthy;
          if(chairWorthy)chairSources.push({name:"tone-cluster"+index,labels,rawCount:comps.length,comps:comps.filter(c=>chairSizeOk(c)&&c.fill>=.3)});
          if(!tableWorthy)return;
          const kept=comps.filter(c=>tableSizeOk(c)&&c.fill>=.35);
          for(const c of kept)c.source="tone";
          toneKept+=kept.length;
          sources.push({name:"tone"+index,labels,comps:kept,all:comps});
        });
        diagnosticsSources.tone=toneKept;
        diagnosticsSources.toneFamilies=toneFamilyEvidence;

        // ---- dark repeated families, chairs only --------------------------
        // A mid-grey chair fill on white paper sits below the ink ceiling, so
        // the tone families above never see it: measured on the dense
        // grayscale fixture, 96 chairs and 0 detected, because their family
        // was discarded as linework before a component was examined.
        //
        // Darkness is the wrong question. Linework is thin; furniture is a
        // solid, repeated, similarly-sized blob. Each rejected dark peak gets
        // its own standalone mask -- deliberately NOT part of the tone LUT,
        // which would steal pixels from the table surface -- and earns a place
        // in the chair pool only by that structure.
        for(const [di,peak] of (toneModel?.darkCandidates||[]).entries()){
          let gap=Infinity;
          for(const q of toneModel.peaks)if(q!==peak)gap=Math.min(gap,Math.abs(q.luma-peak.luma));
          const window=Math.max(4,Math.min(16,Math.floor(gap/2)));
          const dmask=new Uint8Array(total);
          for(let i=0;i<total;i++){const v=gray[i];if(Math.abs(v-peak.luma)<=window)dmask[i]=1;}
          const{labels,comps}=COMP.labelComponents(dmask,width,height,minPixels,true);
          const compact=comps.filter(c=>c.fill>=.45&&Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h))<=2.2);
          const sides=compact.map(c=>Math.sqrt(c.w*c.h)).sort((a,b)=>a-b);
          const medSide=sides.length?sides[sides.length>>1]:0;
          const nearModal=medSide?compact.filter(c=>{
            const sv=Math.sqrt(c.w*c.h);return sv>=medSide*.65&&sv<=medSide*1.55;}).length:0;
          const rep=compact.length?nearModal/compact.length:0;
          const furniture=nearModal>=6&&rep>=.55;
          toneFamilyEvidence.push({index:"dark"+di,luma:peak.luma,belowInkCeiling:true,
            components:comps.length,compact:compact.length,nearModal,
            repetition:Number(rep.toFixed(2)),modalSide:medSide?Number(medSide.toFixed(1)):null,
            usedForTables:false,usedForChairs:furniture,
            verdict:furniture?"repeated compact family (chairs only)":"linework"});
          if(furniture)chairSources.push({name:"dark-tone-cluster"+di,labels,rawCount:comps.length,
            comps:comps.filter(c=>chairSizeOk(c)&&c.fill>=.3)});
          if(globalThis.MERIT_DETECT_DEBUG&&furniture){
            (globalThis.MERIT_DARK_FAMILY_PROBE||=[]).push({index:di,medSide:medSide,nearModal,rep,
              comps:comps.map(c=>({x:c.x,y:c.y,w:c.w,h:c.h,fill:+c.fill.toFixed(3),
                side:+Math.sqrt(c.w*c.h).toFixed(1),notWall:notWall(c),sizeOk:chairSizeOk(c)}))});
          }
        }
        mark("toneMasks");
      }
      // (c) solid dark objects straight from the fill mask (no edges OR-ed in)
      {
        const{labels,comps}=COMP.labelComponents(fillMask,width,height,minPixels,true);
        const kept=comps.filter(c=>tableSizeOk(c)&&c.fill>=.35);
        for(const c of kept)c.source="fill";
        diagnosticsSources.fill=kept.length;
        sources.push({name:"fill",labels,comps:kept,all:comps});
        fallbackChairComps=comps.filter(c=>chairSizeOk(c)&&c.fill>=.045);
        fallbackChairLabels=labels;
        diagnosticsSources.fallbackChairComponents=fallbackChairComps.length;
        mark("fillMask");
      }
      await stage("seating",58);phaseFrom=performance.now();

      // ---- STAGE B: chairs first -------------------------------------------
      // Chairs are detected from their OWN model before any table is
      // considered. That is what stops a chair drawn against a table outline
      // from being swallowed by the table blob, and it makes the seat count
      // independent of whether a table was found at all. On this product's
      // plans the chair count IS the number the operator needs (pax), so it is
      // a first-class output, not a by-product of table detection.
      if(accentMask){
        const{labels,comps}=COMP.labelComponents(accentMask,width,height,Math.max(6,Math.round(minPixels*.6)),true);
        chairSources.unshift({name:"colour-cluster",labels,rawCount:comps.length,comps:comps.filter(c=>chairSizeOk(c)&&c.fill>=.3)});
      }
      // The same physical chair can surface in more than one mask; the most
      // specific source wins and the duplicate is dropped (overlap of the
      // smaller box, not IoU, because the masks disagree slightly on size).
      const chairEntries=[];
      // Which chair family an entry belongs to. Everything the primary source
      // claimed is one family; each secondary family admitted below is its own.
      // This is the axis the whole chair stage reasons on from here down —
      // "which family is this, and does it look like the rest of THAT family"
      // rather than "does this look like the one modal object on the plan".
      const chairFamilyOf=e=>(e.source||"").startsWith("family:")?e.source:"primary";
      const addChairs=(comps,labels,name)=>{
        for(const c of comps){
          if(chairEntries.some(e=>GEO.sameObject(e.comp,c)))continue;
          c.source=name;
          chairEntries.push({comp:c,labels,source:name});
        }
      };
      let chairSource="none";
      // On a plan where the chairs have their OWN colour, the dedicated accent
      // cluster is the whole chair population and the tone families describe
      // something else -- on the real venue plan the strongest tone family IS
      // the tan table surface. Unioning the two sources therefore fed real
      // tables into the chair list, which both removed them from the table pool
      // (they get subtracted from it below) and inflated the seat count with
      // objects nobody sits on. Measured on that plan: tables were reported as
      // `venue/chair`, and the seat total only looked close to the drawing's
      // printed 124 because tables were padding it.
      //
      // So: the most specific source wins outright rather than being merged
      // with a weaker one. tone-cluster stays the chair source for monochrome
      // plans, where it is the only evidence there is.
      const colourChairs=chairSources.find(src=>src.name==="colour-cluster");
      const useColourOnly=colourChairs&&colourChairs.comps.length>=6;
      // MEASURED LIMITATION, deliberately left in place rather than traded away.
      //
      // On a colour plan only the accent cluster feeds the chair pool. That
      // costs the pale OUTLINED chairs ringing the round tables on the real
      // venue plan: they carry no accent colour and no distinct fill tone, so
      // the outline-interior source is the only evidence that can see them,
      // and it is excluded here.
      //
      // Letting it through was tried and measured. Real-plan chairs went
      // 79 -> 124 (which happens to match the drawing's printed 124), but
      // tables collapsed: F1 0.882 -> 0.543, and 0 of 24 square tables
      // survived. The reason is structural, not a tuning miss -- chairs are
      // subtracted from the table pool, and on THIS plan the chair symbols
      // (~34px) and the square tables (~44px) both pass chairSizeOk, whose
      // ceiling is 0.065 of the short edge, about 51px. So the source claims
      // real tables as chairs.
      //
      // The honest fix is a pipeline reordering: the chair/table split for
      // size-ambiguous components has to happen AFTER the modal table size is
      // known, so each component can be assigned to whichever modal it agrees
      // with. That is real work, not a threshold, and a chair number bought by
      // destroying table recall is worth nothing. See the sprint report.
      // A/B switch so the cost of the colour-only gate can be measured on the
      // same build against per-family ground truth, rather than argued about.
      // Benchmarks set it; the product never does.
      //
      // ---- secondary chair families (measured, see the table) ---------------
      //
      // Against per-chair ground truth on the real plan, the colour source is
      // exactly right and exactly incomplete:
      //
      //                     colour only        every source
      //   orange armchair    79/79              79/79
      //   bistro chair        0/10             10/10
      //   pale outlined       0/24             24/24
      //   chair TP / FP      79 / 0           113 / 303
      //   table F1            0.882             0.804
      //
      // The two missing families are not invisible to this pipeline. Every one
      // of the 34 is found by a source the colour gate discards -- along with
      // 303 things that are not chairs. That makes this a PRECISION problem
      // rather than a recall one, and precision is answerable with evidence.
      //
      // A real chair on a floor plan sits against a table. A shard of linework
      // does not, and neither does printed text. So the candidates the colour
      // source did not claim are grouped into families by size and shape, and
      // a family is admitted only when most of its members are adjacent to a
      // table SURFACE component -- available here because the surface masks
      // are built in this same pass. Repetition alone is NOT enough and was
      // measured wrong before (benchmarks/BISTRO-MERGE.md); adjacency is
      // evidence a text run or a wall fragment cannot fake.
      //
      // "Near a bigger thing" is not that evidence on its own, and measuring it
      // proved it: printed matter sits INSIDE a drawn legend box, whose filled
      // interior is itself a surface component, so every glyph of the capacity
      // block "touched a surface" and nine of them were admitted as chairs.
      //
      // The physical fact is narrower than adjacency. You sit AGAINST a table,
      // never inside one. So a candidate whose centre pixel belongs to the
      // surface it is near is contained BY that surface, not seated at it, and
      // it does not count. This is tested against the surface's actual mask
      // rather than its bounding box, because a chair in the ring around a
      // round table is inside that table's bounding SQUARE while being well
      // clear of the disc -- a box test would throw away every round-table
      // chair on this plan to catch the glyphs.
      const surfaceEntries=sources.flatMap(src=>src.comps.map(c=>({comp:c,labels:src.labels})));
      const gapTo=(a,b)=>Math.max(0,Math.max(a.x-(b.x+b.w),b.x-(a.x+a.w)))
        +Math.max(0,Math.max(a.y-(b.y+b.h),b.y-(a.y+a.h)));
      const surfaces=surfaceEntries.map(e=>e.comp);
      const containedBy=(c,e)=>{
        const cx=Math.round(c.x+c.w/2),cy=Math.round(c.y+c.h/2);
        if(cx<0||cy<0||cx>=width||cy>=height||!e.labels)return false;
        return e.labels[cy*width+cx]===e.comp.label;
      };
      //
      // And "something bigger nearby" is not the test either. Measured on the
      // real plan, the surface each capacity-block glyph was found against was
      // its own WORD: 49x20, 38x20, 58x21 — bigger, yes, but exactly as tall
      // as the glyph and grown only sideways. The surfaces real seats sit
      // against were 36x32, 67x67, 68x69.
      //
      // A table is broader than a chair in EVERY direction and several times
      // its area, because it seats several of them along each usable side. A
      // line of text can only ever be as tall as its own letters. That is the
      // difference, and it is a fact about furniture rather than a threshold
      // chosen to make this plan pass. The two numbers below are read off the
      // real plan (real seats: 3.3x area and up; glyphs: 1.1-2.9x) and are
      // guarded by the benchmark.
      // An aspect bar on the surface was tried here too -- a table is roughly
      // as broad as it is deep, a line of text is a line -- and it changed
      // nothing on any fixture, so it is not in the code. The five remaining
      // false chairs reach their surfaces some other way. An unexercised
      // constant is an unmeasured claim, and this one would also reject a long
      // trestle table, which is a real seat surface.
      const SEAT_SURFACE_MIN_AREA=3;
      const seatSurfaceFor=c=>{
        const reach=Math.max(c.w,c.h)*.7,area=c.w*c.h,longSide=Math.max(c.w,c.h);
        return surfaceEntries.find(e=>e.comp!==c&&!GEO.sameObject(e.comp,c)
          &&gapTo(c,e.comp)<=reach
          &&Math.min(e.comp.w,e.comp.h)>longSide
          &&e.comp.w*e.comp.h>=area*SEAT_SURFACE_MIN_AREA
          &&!containedBy(c,e))||null;
      };
      const touchesSurface=c=>!!seatSurfaceFor(c);
      // A secondary family also has to be a plausible SEAT. The primary colour
      // family gives the reference: on the real plan its chairs are ~35px, the
      // bistro chairs are ~17px and the pale crescents ~25px, so a factor of
      // about two below the reference is a real minority family. Without this
      // band the adjacency rule happily admitted families of 4-6px specks --
      // they repeat, and on a dense plan everything is near something.
      const SECONDARY_MIN_MEMBERS=4,SECONDARY_MIN_ADJACENT=.7;
      // Two bounds, and they anchor to different things on purpose.
      //
      // The FLOOR is relative to the primary chair family: a minority seat is
      // smaller than the main one but not by an order of magnitude. On the real
      // plan the reference is ~35px, the bistro chairs are ~17 and the pale
      // crescents ~25. Without a floor, adjacency admitted families of 4-6px
      // specks -- they repeat, and on a dense plan everything is near something.
      //
      // The CEILING is relative to the plan's own SURFACES, not to the chair.
      // Anchoring it to the chair (1.6x of 35 = 56px) admitted a family at
      // table scale, which removed 22 of 22 square tables from the table pool
      // and took table F1 to 0.529. Nothing the size of this plan's surfaces
      // may be claimed as a chair; the table pool needs it more.
      const SECONDARY_MIN_SIDE_RATIO=.4,SECONDARY_MAX_SURFACE_RATIO=.75;
      const secondaryFamilies=[];
      // WHICH POPULATION DEFINES WHAT A SEAT LOOKS LIKE HERE.
      //
      // It used to be the colour cluster and nothing else: the whole family
      // pass below sat inside `if (useColourOnly)`. On a plan drawn in ink
      // that gate never opens, and the consequence is not "no second family is
      // admitted" — it is that the sheet is allowed exactly ONE seat
      // vocabulary, set by whichever population happens to be the largest, and
      // that one vocabulary is applied to every room on it.
      //
      // Measured on `a9-mixed-representation`, a sheet carrying a symbolic
      // hall and a drawn terrace: the 72 numbered discs of the hall set the
      // modal seat at 48px, and the terrace's 24 real chairs — 22px, every
      // one of them detected, every one of them against a table — were
      // dropped by `chairAccepted` for not resembling a symbol in a different
      // room. With no seats, the terrace's three tables were never proposed:
      // `tablesFound: 0` and `associatedToTable: 0` were facts about a
      // statistic taken over the whole drawing, not about the terrace.
      //
      // So the reference is the largest chair source, whatever it is made of.
      // Colour, where a plan has it, is still the strongest evidence and is
      // still preferred; ink is what is left when there is none. Nothing below
      // is loosened — a family still needs four members, a size inside the
      // band, and most of its members sitting against a table surface.
      const SECONDARY_PRIMARY_MIN=6;
      // The two anchors the size band is measured against, hoisted so they are
      // always visible in diagnostics — including when no family was
      // considered at all. They are the quantities that decide whether a
      // second seat vocabulary can exist on this plan, and a bound whose
      // anchor is never printed cannot be argued with.
      let primaryReferenceSide=null,planSurfaceSide=null;
      // A real boolean: `useColourOnly` is the colour source itself when there
      // is none, so this used to report `null` on every ink plan and `false`
      // on none of them. A diagnostic that says "no" in two different ways is
      // a diagnostic somebody will misread.
      const colourPrimary=!!(useColourOnly&&!globalThis.MERIT_ALL_CHAIR_SOURCES);
      const primarySource=colourPrimary?colourChairs
        :chairSources.slice().sort((a,b)=>b.comps.length-a.comps.length)[0]||null;
      let primaryFamilyComps=primarySource?primarySource.comps:[];
      if(primarySource&&primarySource.comps.length>=SECONDARY_PRIMARY_MIN){
        // The PRIMARY source is not one family either, and assuming it was is
        // what hid the bistro seats for so long. On the real plan the accent
        // colour belongs to both the 34px armchairs and the 17px bistro
        // chairs: the colour cluster offers 111 components, the modal size
        // gate downstream keeps 79, and the ~10 it drops are real chairs found
        // by the strongest evidence this pipeline has. They were thrown away
        // for not resembling their bigger cousins.
        //
        // So the colour source is split the same way as everything else: its
        // dominant size family is the REFERENCE (it defines what a chair is on
        // this plan, and everything downstream measures against it), and its
        // minority members go back into the pool to earn admission on the same
        // adjacency evidence as any other family. A minority family is not
        // trusted because it shares a colour -- printed matter in the accent
        // colour would share it too -- it is trusted because most of its
        // members sit against a table surface.
        const primaryModal=PRIOR.modalMagnitude(primarySource.comps.map(c=>Math.sqrt(c.w*c.h)));
        const inPrimaryFamily=c=>!primaryModal||PRIOR.sizeAgreement(Math.sqrt(c.w*c.h),primaryModal)>=.25;
        const claimed=primarySource.comps.filter(inPrimaryFamily);
        primaryFamilyComps=claimed;
        const extra=primarySource.comps.filter(c=>!inPrimaryFamily(c))
          .map(c=>({comp:c,source:primarySource}));
        for(const src of chairSources){
          if(src===primarySource)continue;
          for(const c of src.comps){
            if(claimed.some(k=>GEO.sameObject(k,c))||extra.some(k=>GEO.sameObject(k.comp,c)))continue;
            extra.push({comp:c,source:src});
          }
        }
        // Family key: size and elongation, both on a log scale, so a family is
        // "objects drawn the same" rather than "objects within N pixels".
        const keyOf=c=>{
          const side=Math.sqrt(c.w*c.h),elong=Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h));
          return Math.round(Math.log(side)/Math.log(1.18))+":"+Math.round(Math.log(elong)/Math.log(1.25));
        };
        const medianSide=list=>{
          const v=list.map(c=>Math.sqrt(c.w*c.h)).sort((a,b)=>a-b);
          return v.length?v[v.length>>1]:0;
        };
        const referenceSide=medianSide(claimed);
        primaryReferenceSide=referenceSide;
        // How far apart the primary family's own seats stand, and how close a
        // candidate is to the nearest of them. A genuinely distinct seat family
        // sits at ITS OWN tables; a family of debris shed by the primary one
        // interleaves with the seats it came from.
        const centreOf=c=>[c.x+c.w/2,c.y+c.h/2];
        const primaryCentres=claimed.map(centreOf);
        const nearestPrimaryDistance=c=>{
          const[cx,cy]=centreOf(c);let best=Infinity;
          for(const[px,py] of primaryCentres){
            const d=Math.hypot(cx-px,cy-py);
            if(d<best)best=d;
          }
          return best;
        };
        const spacings=primaryCentres.map(([x0,y0])=>{
          let best=Infinity;
          for(const[px,py] of primaryCentres){
            if(px===x0&&py===y0)continue;
            const d=Math.hypot(x0-px,y0-py);
            if(d<best)best=d;
          }
          return best;
        }).filter(Number.isFinite).sort((a,b)=>a-b);
        const primarySpacing=spacings.length?spacings[spacings.length>>1]:0;
        const surfaceSide=medianSide(surfaces.filter(c=>Math.min(c.w,c.h)>=6));
        planSurfaceSide=surfaceSide;
        // IS THE FLOOR'S ANCHOR A SEAT AT ALL?
        //
        // The floor below says a minority seat is not an order of magnitude
        // smaller than the plan's MAIN SEAT. That premise is never checked,
        // and on a sheet drawn in two languages it is false: where the largest
        // repeated population is a hall of numbered symbols, `referenceSide`
        // is the size of a TABLE and the band it opens — [0.4R, 0.75S] with
        // R and S the same objects — sits entirely above every real seat on
        // the drawing.
        //
        // The check is the premise itself, and it needs no new constant: a
        // seat is smaller than the surface it is served on. This file already
        // states that three times (`seatSurfaceFor`'s `min side > longSide`,
        // its 3x area rule, and the ceiling immediately below). Where the
        // reference is NOT smaller than the plan's surfaces, it is not a seat
        // population, and a floor measured against it is measuring nothing.
        // The ceiling still applies — nothing at surface scale becomes a
        // chair — as do four members and the adjacency share, which is the
        // evidence that actually says "these are seats".
        //
        // Measured across every plan available here (family-anchors.mjs):
        // referenceSide < surfaceSide on a1, a2, a3, a4, a6, a7, a8 and the
        // real venue plan, so the floor is unchanged on all of them and its
        // value is untouched. The three where they are EQUAL are exactly the
        // three with no seating drawn or none detected — a5, ORNEK and the
        // mixed sheet. Setting the ratio to 0 instead was tried, as the
        // experiment that establishes what the floor protects: across eleven
        // plans it changed ONE admission, and that admission was a real seat
        // family. The constant is kept for the plans whose premise holds.
        const referenceIsSeatSized=!surfaceSide||referenceSide<surfaceSide;
        const groups=new Map();
        for(const e of extra){const k=keyOf(e.comp);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
        for(const [key,members] of groups){
          if(members.length<SECONDARY_MIN_MEMBERS)continue;
          const sides=members.map(m=>Math.sqrt(m.comp.w*m.comp.h)).sort((a,b)=>a-b);
          const side=sides[sides.length>>1];
          const sizeOk=(!referenceSide||!referenceIsSeatSized||side>=referenceSide*SECONDARY_MIN_SIDE_RATIO)
            &&(!surfaceSide||side<=surfaceSide*SECONDARY_MAX_SURFACE_RATIO);
          // Two questions, not one. The family answers "is a second kind of
          // seat drawn on this plan at all", and only a family most of whose
          // members sit at a table may say yes. Each MEMBER then answers "am I
          // one of them" for itself.
          //
          // Both are needed, because the trap on this plan is a family that is
          // genuinely mixed: the capacity block is printed at chair scale in
          // the chair's own colour, so its glyphs land in the same size-and-
          // shape family as the real bistro seats. Admitting the family whole
          // takes nine glyphs with it; rejecting it whole loses the seats.
          const seated=members.filter(m=>touchesSurface(m.comp));
          const adjacent=seated.length;
          const share=adjacent/members.length;
          // How much of this family is standing among the primary family's own
          // seats rather than at tables of its own.
          //
          // GATED ONLY WHERE THE SIZE FLOOR CANNOT BE — see `standsClear`
          // below. Everywhere else it is reported and nothing depends on it,
          // for the reason the rest of this paragraph gives.
          //
          // A genuinely distinct seat family sits at its
          // own tables and so stands well clear of the primary family's seats;
          // a family of debris shed by the primary one interleaves with them.
          // Measured, in units of the primary family's own seat spacing: the
          // real plan's five admitted families read 1.75 to 3.34, and the
          // `downscale-70` debris families read 1.04 and 1.07. It separates —
          // by 17%, on one plan, with the real plan's smallest admitted family
          // sitting closest to the line. That is not enough margin to delete a
          // family on, and it would remove 32 of that variant's 73 false chairs
          // rather than all of them. Left as evidence for whoever has more of it.
          const nearDists=members.map(m=>nearestPrimaryDistance(m.comp)).filter(Number.isFinite).sort((a,b)=>a-b);
          const medianNearPrimary=nearDists.length?nearDists[nearDists.length>>1]:Infinity;
          const crowding=primarySpacing?medianNearPrimary/primarySpacing:Infinity;
          // WHAT REPLACES THE FLOOR WHEN THE FLOOR HAS NO ANCHOR.
          //
          // The floor's job is "this is not debris shed by the primary
          // family", and it does that job by size, against the primary
          // family's median. Where the reference is not smaller than the
          // plan's own surfaces that anchor is meaningless (see
          // `referenceIsSeatSized`), and dropping the floor there with nothing
          // in its place admitted a family of four 12px fragments standing
          // among the symbols of `symbolic-plan-detection`'s drawing — a sheet
          // with no seat on it at all — which then kept four symbols out of
          // the swap as "tables with drawn seats". Measured: 48 tables for 44
          // symbols and 6 seats claimed where none exist.
          //
          // So the same question is asked with the measurement that answers it
          // without that anchor: does this family stand at its OWN tables, or
          // among the primary family's members? Everything measured so far, in
          // units of the primary family's own spacing:
          //
          //   debris    downscale-70            1.04, 1.07
          //   debris    the symbolic drawing    1.07
          //   real      merit-real-venue        1.75, 2.06, 2.34, 2.91, 3.34
          //   real      a9's terrace            3.73
          //
          // 1.07 against 1.75. The gate sits between them, and it applies ONLY
          // on the plans where the floor cannot — on every plan whose
          // reference really is seat-sized, nothing here changes and this
          // quantity stays what it has always been: reported, not gated on.
          //
          // It fails conservatively and it is worth saying how: a second
          // vocabulary drawn right among the first — a drawn top table at the
          // front of a symbolic ballroom — would read low and be refused. That
          // loses a family rather than inventing one, which is the direction
          // this contract requires when the evidence is genuinely ambiguous.
          const SECONDARY_MIN_CLEARANCE=1.4;
          const standsClear=referenceIsSeatSized||crowding>=SECONDARY_MIN_CLEARANCE;
          const admitted=sizeOk&&standsClear&&share>=SECONDARY_MIN_ADJACENT;
          secondaryFamilies.push({key,members:members.length,adjacent,
            share:Number(share.toFixed(2)),admitted,sizeOk,standsClear,
            side:Math.round(side),referenceSide:Math.round(referenceSide),surfaceSide:Math.round(surfaceSide),
            crowding:Number(crowding.toFixed(2)),primarySpacing:Math.round(primarySpacing),
            minClearance:referenceIsSeatSized?null:SECONDARY_MIN_CLEARANCE,
            source:members[0].source.name});
          // One entry per originating source, all under the same family name.
          // The label map a component was found in is what shape analysis has
          // to re-read its pixels from, so a family whose members came from two
          // masks cannot be pushed as one source with one of their label maps —
          // the other half would be measured against the wrong pixels.
          if(admitted){
            const bySource=new Map();
            for(const m of seated){
              if(!bySource.has(m.source))bySource.set(m.source,[]);
              bySource.get(m.source).push(m.comp);
            }
            for(const [src,comps] of bySource)
              chairSources.push({name:"family:"+key,labels:src.labels,rawCount:comps.length,comps});
          }
        }
      }
      const admittedFamilies=secondaryFamilies.filter(f=>f.admitted);
      const familySources=chairSources.filter(src=>src.name.startsWith("family:"));
      const activeChairSources=colourPrimary
        ?[{...colourChairs,comps:primaryFamilyComps},...familySources]
        // On an ink plan every source still contributes exactly what it did
        // before; what changes is the NAME a component arrives under. An
        // admitted family is offered first so its members carry their family's
        // label instead of their mask's, and `addChairs` keeps the first name
        // a component is seen with. That label is the whole point: it is what
        // gives the family its own modal size and its own elongation
        // downstream, instead of being measured against the plan's majority.
        // Same components, same count — a second vocabulary now gets to be
        // measured as one.
        :[...familySources,...chairSources.filter(src=>!src.name.startsWith("family:"))];
      const specificCount=activeChairSources.reduce((n,src)=>n+src.comps.length,0);
      // What each chair source actually offered, kept in diagnostics. Without
      // this the only visible fact is the final count, which cannot tell "the
      // source found nothing" apart from "the source found things and they
      // were filtered out" -- and those need opposite fixes.
      const chairSourceBreakdown=chairSources.map(src=>({
        name:src.name,offered:src.comps.length,
        rawPool:src.rawCount??null,
      })).concat([{name:"luma-fallback",offered:fallbackChairComps.length,rawPool:null}]);
      // Every secondary family considered, admitted or not, with the evidence
      // that decided it. A family rejected for sitting nowhere near a table is
      // the most useful line in this whole diagnostic.
      const secondaryFamilyDiagnostics={
        considered:secondaryFamilies.length,
        admitted:admittedFamilies.length,
        minMembers:SECONDARY_MIN_MEMBERS,minAdjacentShare:SECONDARY_MIN_ADJACENT,
        primary:primarySource?primarySource.name:null,
        primaryColour:colourPrimary,
        referenceSide:primaryReferenceSide===null?null:Math.round(primaryReferenceSide),
        surfaceSide:planSurfaceSide===null?null:Math.round(planSurfaceSide),
        // A SEAT IS SMALLER THAN THE TABLE IT SERVES. Both bounds below are
        // anchored to plan-wide medians, so this ratio says whether the two
        // populations they come from are actually different populations. Where
        // it approaches 1 the "reference seat" and the "reference table" are
        // the same objects, the band collapses onto them, and no real seat
        // anywhere on the sheet can fall inside it.
        referenceToSurface:primaryReferenceSide&&planSurfaceSide
          ?Number((primaryReferenceSide/planSurfaceSide).toFixed(3)):null,
        minSideRatio:SECONDARY_MIN_SIDE_RATIO,maxSurfaceRatio:SECONDARY_MAX_SURFACE_RATIO,
        families:secondaryFamilies.slice().sort((a,b)=>b.members-a.members).slice(0,12),
      };
      if(specificCount>=6){
        for(const src of activeChairSources)addChairs(src.comps,src.labels,src.name);
        chairSource=activeChairSources.find(src=>src.comps.length)?.name||"none";
      }else if(fallbackChairComps.length){
        addChairs(fallbackChairComps,fallbackChairLabels,"luma-components");
        chairSource="luma-components";
      }
      // Two chairs drawn a pixel or two apart merge into one blob. Where the
      // pixels actually show the gap, the same evidence-gated valley split used
      // for tables recovers both — measured, never assumed.
      const chairModalPre=PRIOR.modalMagnitude(chairEntries.map(e=>Math.sqrt(e.comp.w*e.comp.h)));
      if(chairModalPre){
        const modalSide=chairModalPre.value;
        for(let i=chairEntries.length-1;i>=0;i--){
          const e=chairEntries[i];
          if(Math.max(e.comp.w,e.comp.h)<modalSide*1.7)continue;
          const parts=SPLIT.splitAtValley(e.comp,e.labels,width,height,modalSide,modalSide);
          if(!parts||parts.length<2)continue;
          chairEntries.splice(i,1,...parts.map(p=>({comp:Object.assign(p,{source:e.source}),labels:e.labels,source:e.source})));
        }
      }
      for(const e of chairEntries)analyze([e.comp],e.labels);
      // Second dedup pass, now that a modal chair size exists. A drawn chair is
      // typically an outline plus an inner fill, or a seat plus a back; those
      // land as two components sitting almost on top of each other, and they
      // overlap too little for the earlier same-object test to catch. Two
      // centres closer together than ~0.55 of one chair cannot be two chairs on
      // a plan whose chairs are all one size, so they are merged into their
      // union. Measured on the venue plan: 63 such pairs out of 241.
      //
      // The gap is per FAMILY, not per plan. A merge distance taken from the
      // majority chair (~34px here) is wider than a minority chair is big, so
      // a global gap would swallow whole rings of the smaller seats into one
      // blob each — the families would be recovered above and then quietly
      // destroyed here.
      {
        const provisionalOf=list=>PRIOR.modalMagnitude(list.map(e=>Math.sqrt(e.comp.w*e.comp.h)));
        const gapByFamily=new Map();
        for(const e of chairEntries){
          const k=chairFamilyOf(e);
          if(!gapByFamily.has(k))gapByFamily.set(k,[]);
          gapByFamily.get(k).push(e);
        }
        for(const [k,list] of gapByFamily){
          const p=provisionalOf(list);
          gapByFamily.set(k,p&&p.support>=4?p.value*.55:0);
        }
        const provisional=provisionalOf(chairEntries);
        if(provisional&&provisional.support>=4){
          const merged=[];
          for(const e of chairEntries){
            const minGap=gapByFamily.get(chairFamilyOf(e))||0;
            const cx=e.comp.x+e.comp.w/2,cy=e.comp.y+e.comp.h/2;
            const hit=minGap&&merged.find(m=>chairFamilyOf(m)===chairFamilyOf(e)
              &&Math.hypot(cx-(m.comp.x+m.comp.w/2),cy-(m.comp.y+m.comp.h/2))<minGap);
            if(!hit){merged.push(e);continue;}
            const x1=Math.min(hit.comp.x,e.comp.x),y1=Math.min(hit.comp.y,e.comp.y);
            const x2=Math.max(hit.comp.x+hit.comp.w,e.comp.x+e.comp.w),y2=Math.max(hit.comp.y+hit.comp.h,e.comp.y+e.comp.h);
            hit.comp.x=x1;hit.comp.y=y1;hit.comp.w=x2-x1;hit.comp.h=y2-y1;
            hit.comp.shape=null; // recomputed by analyze() below
          }
          if(merged.length!==chairEntries.length){
            chairEntries.length=0;chairEntries.push(...merged);
            for(const e of chairEntries)analyze([e.comp],e.labels);
          }
        }
      }
      // Stage census, for the miss taxonomy only. Which objects existed as
      // components at all, before size/shape acceptance narrowed them — the
      // difference between "the detector never saw it" and "the detector saw
      // it and a later rule discarded it" needs opposite fixes.
      if(globalThis.MERIT_DETECT_DEBUG){
        globalThis.MERIT_STAGE_CENSUS={
          allSourceComps:sources.flatMap(s2=>s2.comps.map(c=>({x:c.x,y:c.y,w:c.w,h:c.h,source:s2.name}))),
          allSourceAll:sources.flatMap(s2=>(s2.all||[]).map(c=>({x:c.x,y:c.y,w:c.w,h:c.h,fill:+((c.fill??0).toFixed(3)),source:s2.name}))),
          chairEntries:chairEntries.map(e=>({x:e.comp.x,y:e.comp.y,w:e.comp.w,h:e.comp.h,family:chairFamilyOf(e)})),
        };
      }
      const chairComps=chairEntries.map(e=>e.comp);
      const primaryComps=chairEntries.filter(e=>chairFamilyOf(e)==="primary").map(e=>e.comp);
      // The modal is the PRIMARY family's, not the whole chair population's.
      // Downstream this number stands for "how big is a chair on this plan"
      // when subtracting chairs from the table pool and setting the split
      // thresholds, and a minority family of smaller seats must not drag it
      // down — a chair-scale short modal is exactly what over-split real
      // tables the last time it moved.
      const chairModal=PRIOR.modalMagnitude((primaryComps.length?primaryComps:chairComps).map(c=>Math.sqrt(c.w*c.h)));
      // A trustworthy chair population is MANY objects of ONE size. If the
      // population is not uniform we say so in the result and fall back to the
      // table-first path instead of reporting a seat count we cannot defend.
      // Judged on the primary family for the same reason: admitting a second,
      // smaller family is evidence about the plan, not a loss of confidence in
      // the first one.
      const chairUniform=!!chairModal&&(primaryComps.length?primaryComps:chairComps).length>=6
        &&chairModal.support/chairModal.total>=.6;
      // Chairs on a plan are drawn identically, so the repeated SHAPE is real
      // evidence too. Elongation is measured orientation-invariantly
      // (long/short side), because the same chair drawn on the left of a table
      // is the same object rotated 90 degrees, not a different one. This is
      // what tells a chair-sized printed glyph from a chair without OCR.
      const elongationOf=c=>Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h));
      const chairModalElongation=PRIOR.modalMagnitude((primaryComps.length?primaryComps:chairComps).map(elongationOf));
      // One elongation mode, deliberately. A second mode was implemented here
      // and REVERTED once the real plan had per-chair ground truth to measure
      // against -- see benchmarks/BISTRO-MERGE.md.
      //
      // The idea was that a plan may seat two chair shapes, and it fixed a
      // synthetic bistro fixture completely (0 of 5 tables to 5 of 5). On the
      // real plan it appeared to gain 8 chairs, 79 to 87. With spatial truth
      // those 8 turned out to be the printed capacity block -- "114 pax
      // seating / 10 pax bistro / Total : 124 pax" -- at 35x17 and elongation
      // ~2.0. Zero real chairs gained, 8 false ones, plus a table false
      // positive and four more review groups.
      //
      // Which is the failure this test was written to prevent, in the words of
      // the comment below it: a chair-sized printed glyph is told from a chair
      // by its repeated SHAPE, and widening the shape gate let the glyphs in.
      // The fixture could not catch it because the fixture had no printed
      // matter on it; it does now.
      //
      // A second family is still the right idea, but it needs independent
      // evidence that text cannot fake -- adjacency to a table surface, not a
      // looser shape rule. Shape alone is not enough.
      //
      // That is what the secondary-family pass above does, and this is where
      // its result is honoured: the elongation and size a candidate is judged
      // against are ITS OWN family's, so a 17px crescent is not asked to
      // resemble a 34px armchair. The gate is not loosened — each family is
      // still held to a single repeated size and a single repeated shape, and
      // a family only exists at all because most of its members sit against a
      // table surface. A run of printed glyphs still fails, now for the reason
      // it should: it never becomes a family.
      const familyProfiles=new Map();
      for(const e of chairEntries){
        const k=chairFamilyOf(e);
        if(!familyProfiles.has(k))familyProfiles.set(k,[]);
        familyProfiles.get(k).push(e.comp);
      }
      for(const [k,comps] of familyProfiles){
        familyProfiles.set(k,{
          count:comps.length,
          size:k==="primary"?chairModal:PRIOR.modalMagnitude(comps.map(c=>Math.sqrt(c.w*c.h))),
          elongation:k==="primary"?chairModalElongation:PRIOR.modalMagnitude(comps.map(elongationOf)),
        });
      }
      const profileFor=e=>familyProfiles.get(chairFamilyOf(e))||null;
      // The SMALLEST chair family, for the downstream rule "nothing at chair
      // scale is a table".
      //
      // That rule is enforced with one number, and taking it from the majority
      // chair is the same mistake as judging every chair against the majority
      // chair. This plan is the case that proves it: its bistro tables measure
      // 36x31 to 36x39 against ~34x34 armchairs, so a floor of one armchair
      // area (1156px) sits right in the middle of them — 1224 and 1258 survive,
      // 1116 and 1152 are deleted as "chair-sized". A bistro table is bigger
      // than a bistro chair; it is not bigger than an armchair, and it does not
      // have to be.
      //
      // Worth knowing: this exact change was implemented and measured once
      // before and changed nothing at all, because the bistro tables were
      // already being deleted an earlier stage up, at surface coverage. It was
      // reverted then for that reason — a guard loosened for a reason that
      // sounds right and measures as nothing is a guard weakened for free. It
      // is back now because that earlier stage was fixed and this one became
      // the binding constraint, which is the only argument that should have
      // brought it back.
      const chairFamilySides=[...familyProfiles.values()].map(p=>p.size?.value).filter(v=>v>0);
      const chairFloorSide=chairFamilySides.length?Math.min(...chairFamilySides):null;
      const chairShapeOk=(c,profile)=>{
        const modalElongation=profile?.elongation||chairModalElongation;
        if(!chairUniform||!modalElongation)return true;
        const elongation=elongationOf(c);
        return Math.abs(Math.log(elongation/modalElongation.value))<=Math.log(1.6);
      };
      const chairAccepted=e=>{
        const profile=profileFor(e);
        const modalSize=profile?.size||chairModal;
        return PRIOR.sizeAgreement(Math.sqrt(e.comp.w*e.comp.h),modalSize)>=.25&&chairShapeOk(e.comp,profile);
      };
      // Cross-family duplicate suppression was tried here and is NOT in the
      // code, because it measured as a no-op on every plan and variant.
      //
      // The near-duplicate merge above is deliberately per-family, so a ring of
      // small seats is not swallowed by a gap measured from the big ones, and
      // that leaves no suppression BETWEEN families. On `downscale-70` that
      // looked like the cause of 73 false chairs: a 24px armchair fragments
      // into 8-14px pieces which are too far from the primary modal to be
      // claimed, form a minority family of their own, and pass the
      // table-adjacency test trivially. But the pieces sit BESIDE their parent
      // chair, 15-40px from its centre, not inside it — "nothing sits inside a
      // chair" is true and removes nothing. See the family diagnostics'
      // `crowding` figure for what does separate them, and why it is not
      // gated on.
      // The family label lives on the entry, not the component, and the
      // relationship engine needs it: whether a chair looks like the chairs
      // already at a table is one of its tie-breakers. Assigning onto the same
      // component object rather than copying keeps object identity, which the
      // `sameObject` pool filter below depends on.
      const chairs=chairUniform
        ?chairEntries.filter(chairAccepted).map(e=>Object.assign(e.comp,{chairFamily:chairFamilyOf(e)}))
        :chairComps;
      if(globalThis.MERIT_STAGE_CENSUS){
        globalThis.MERIT_STAGE_CENSUS.accepted=chairs.map(c=>({x:c.x,y:c.y,w:c.w,h:c.h}));
        globalThis.MERIT_STAGE_CENSUS.rejectedByAcceptance=chairEntries.filter(e=>!chairAccepted(e))
          .map(e=>{const pr=profileFor(e);const modal=pr?.size||chairModal;
            return{x:e.comp.x,y:e.comp.y,w:e.comp.w,h:e.comp.h,family:chairFamilyOf(e),
              mag:+Math.sqrt(e.comp.w*e.comp.h).toFixed(1),modal:modal?+modal.value.toFixed(1):null,
              agree:+PRIOR.sizeAgreement(Math.sqrt(e.comp.w*e.comp.h),modal).toFixed(3),
              shapeOk:chairShapeOk(e.comp,pr),elong:+elongationOf(e.comp).toFixed(2)};});
        globalThis.MERIT_STAGE_CENSUS.chairModal=chairModal?+chairModal.value.toFixed(1):null;
        globalThis.MERIT_STAGE_CENSUS.chairUniform=chairUniform;
      }
      const detectionPath=chairUniform?"chair-first":"table-first";
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
      // (buildToneModel) — before that there was no tan family to find, which
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
      // ---- venue-scale objects (stage band / long bar / column) ------------
      // ---- columns and structural repeats -----------------------------------
      // A candidate the surface filter turned away is not a table: it is not
      // made of the material this plan draws tables with. That is a real and
      // useful verdict, and until now it ended the object's life. On a plan
      // that has columns, those are precisely the objects — solid, repeated,
      // compact, standing on a structural grid, and never seated at.
      //
      // Measured on benchmarks/fixtures/adversarial-architecture.png, whose six
      // columns are exact by construction: all six reach de-duplication, all
      // six score 0.000 surface coverage against the table tint, and all six
      // were then discarded. The fixture scored column recall 0.000 while
      // scoring 10 of 10 tables perfectly.
      //
      // A column is not "a small rectangle". Four independent facts have to
      // agree, and no single one of them is allowed to carry the decision:
      //
      //   the family repeats     3 or more members at one size
      //   it is compact          not a wall, not a line of text
      //   nobody sits at it      no chair anywhere near it
      //   it stands on a GRID    members share a row AND a column with other
      //                          members — which is what a structural grid is
      //
      // The last one has to be both axes, and that was measured the hard way:
      // "shares a row or a column" is satisfied by a line of text by
      // construction, and it put 26 false columns on the text fixture and 13 on
      // the dense one. A word is aligned in one direction. A column grid is
      // aligned in two, because the building's structure repeats across the
      // floor as well as along it.
      //
      // Together these are why this does not invent columns on the real venue
      // plan — whose annotation deliberately records that none are
      // identifiable there.
      const COLUMN_MIN_MEMBERS=3,COLUMN_MAX_ASPECT=1.6,COLUMN_ALIGN_SHARE=.5;
      const columnComps=(()=>{
        // "Nobody sits at it" has to mean nobody sits at it — not "no seat
        // happens to pass nearby". A column standing in a room full of tables
        // is surrounded by other people's chairs, and on the architecture
        // fixture exactly that killed C5: a seat belonging to a round table two
        // feet away came within 28px, and a column that six other facts agreed
        // about was thrown out for it. A chair the associator already seated at
        // a table that survived to `chosen` is spoken for, and its proximity
        // says nothing about this object. Only unclaimed seats count.
        const chosenTableIndexes=new Set(chosen.map(s=>s.box.index));
        const seatedAtRealTable=ci=>chosenTableIndexes.has(chairAssign.get(ci));
        const seatless=surfaceRejectedComps.filter(c=>{
          const aspect=Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h));
          if(aspect>COLUMN_MAX_ASPECT)return false;
          const reach=Math.max(c.w,c.h)*.7;
          return !chairs.some((ch,ci)=>!seatedAtRealTable(ci)&&gapTo(c,ch)<=reach);
        });
        if(seatless.length<COLUMN_MIN_MEMBERS)return[];
        // "One size" as a RELATION between members, not as a grid laid over the
        // number line.
        //
        // The chair pass keys families by round(log(size)/log(1.18)), and that
        // key has a boundary problem this fixture shows exactly: its four
        // square columns measure 42 across and its two round ones 40 — a 5%
        // difference, well inside the 18% the key is meant to tolerate — but 40
        // and 42 fall either side of a bin edge. The six columns of one
        // structural grid were split into a family of four and a family of two,
        // and the pair died on the member floor. Recall 4/6 with precision
        // 1.000 was a bin edge, not a detector limit.
        //
        // Same tolerance, expressed as "no member is more than 18% larger than
        // the next smaller one": sort by size and cut wherever that gap opens.
        // There is no boundary to sit on, because the comparison is always
        // between two real objects.
        const COLUMN_SIZE_RATIO=1.18;
        const sized=seatless.map(c=>({c,s:Math.sqrt(c.w*c.h)})).sort((a,b)=>a.s-b.s);
        const groups=[];
        let run=[];
        for(const it of sized){
          if(run.length&&it.s>run[run.length-1].s*COLUMN_SIZE_RATIO){groups.push(run.map(x=>x.c));run=[];}
          run.push(it);
        }
        if(run.length)groups.push(run.map(x=>x.c));
        const out=[];
        for(const members of groups){
          if(members.length<COLUMN_MIN_MEMBERS)continue;
          const tol=Math.max(4,members.reduce((n,c)=>n+Math.max(c.w,c.h),0)/members.length*.25);
          const centre=c=>[c.x+c.w/2,c.y+c.h/2];
          // Coordinate REUSE on both axes, measured over the family. Asking
          // each member to share both a row and a column with someone is the
          // same idea but breaks as soon as the grid is only partly detected:
          // with four of this fixture's six columns found, only one member has
          // both a row-partner and a column-partner and the family scored zero.
          const sharesOn=(get)=>members.filter(c=>{
            const v=get(centre(c));
            return members.some(o=>o!==c&&Math.abs(v-get(centre(o)))<=tol);
          }).length/members.length;
          const rowShare=sharesOn(p=>p[1]),columnShare=sharesOn(p=>p[0]);
          if(rowShare>=COLUMN_ALIGN_SHARE&&columnShare>=COLUMN_ALIGN_SHARE)out.push(...members);
        }
        return out;
      })();
      const venueComps=[];
      for(const s of sources)for(const c of s.all)if(venueSizeOk(c)&&!venueComps.some(o=>GEO.boxIoU(o,c)>=.5))venueComps.push(c);
      // A venue-scale blob that geometrically CONTAINS several detected tables
      // is not a stage -- it is the merged blob those tables were cut out of.
      // Measured on the dense fixture: three 511x102 "stages" at aspect 5.0,
      // each of which was exactly one row of six tables plus their seats. This
      // needs no threshold: either real table centres sit inside the box or
      // they do not.
      const tableCentres=chosen.map(s=>({cx:s.obb.cx,cy:s.obb.cy}));
      const containedTables=c=>tableCentres.filter(t=>
        t.cx>=c.x&&t.cx<=c.x+c.w&&t.cy>=c.y&&t.cy<=c.y+c.h).length;
      const mergedRowVenues=venueComps.filter(c=>containedTables(c)>=2);
      const venueCompsKept=venueComps.filter(c=>containedTables(c)<2);
      const columnVenues=columnComps.slice(0,40).map(c=>{
        const obb=c.shape?.obb||{cx:c.x+c.w/2,cy:c.y+c.h/2,w:c.w,h:c.h,rotation:c.pcaRotation||0};
        return{id:uid("candidate"),kind:"venue",type:"column",...toPercentBox(obb),
          rotation:obb.rotation,confidence:.55,status:"unreviewed",selected:false,chairDetections:[],
          evidence:{geometry:.6,chairs:0,repetition:columnComps.length,source:c.source||"structural",
            basis:"repeated compact object, aligned on a structural grid, no seating"}};
      });
      let venues=venueCompsKept.slice(0,14).map(c=>{
        analyze([c],sources.find(s=>s.all.includes(c)).labels);
        const obb=c.shape?.obb||{cx:c.x+c.w/2,cy:c.y+c.h/2,w:c.w,h:c.h,rotation:c.pcaRotation||0};
        // These objects are NOT given a name.
        //
        // The type used to be a bare aspect-ratio guess: longer than 3:1 meant
        // stage, compact meant column. Phase 4 stopped a zone built on that
        // guess being reported as STRONG, which removed the fabricated
        // certainty but not the fabrication — the claim was still made, just
        // more quietly.
        //
        // Measured over both real plans, the rule names 8 objects `stage`:
        //
        //   merit-real-venue  aspect 6.00, 7.93   — 2 stage objects annotated
        //   ornek-symbolic    aspect 2.80, 4.55, 5.43, 6.08, 8.97, 31.17
        //                                         — 0 stage objects annotated
        //
        // Two right and six wrong, and the two right ones sit INSIDE the range
        // of the six wrong ones. Aspect cannot be retuned to separate them,
        // and neither can the other axes measured beside it — object size
        // (10.9-13.4% of the plan against 12.9-13.1%), how many look-alike
        // siblings the object has (0-2 against 0-1), or how much furniture
        // faces it. Every one of them overlaps.
        //
        // So a long band with nothing else known about it is left unnamed. Its
        // shape is recorded, its basis is recorded, and it is reported as an
        // area that could not be identified. That is a real cost, honestly: the
        // Golden Plan's stage is genuine and is no longer named. It buys the
        // removal of six false ones, and it stops a 25%-precision label being
        // presented to an operator as a finding.
        //
        // What WOULD corroborate it is the drawing's own word for it — the
        // Golden Plan prints "SAHNE" beside its stage, and ORNEK prints nothing
        // beside any of its six bands. That needs OCR, which this sandbox
        // cannot run in the normal build (see benchmarks/CAPACITY-AS-A-RULE.md
        // for what happened last time a rule was built where no benchmark could
        // reach it), so it is recorded as the way forward and not written blind.
        //
        // Columns are unaffected: they are detected separately by the column
        // pass above, which requires four independent facts to agree (repeated
        // family, compact, unseated, standing on a two-axis grid) and scores
        // 6 of 6 with no false positives on the architecture fixture. That
        // pass is what a corroborated structural claim looks like; this is
        // what an uncorroborated one looks like.
        return{id:uid("candidate"),kind:"venue",type:"other",typeBasis:"aspectRatio",
          shapeSuggests:c.aspect>3?"band":"block",...toPercentBox(obb),
          rotation:obb.rotation,confidence:.52,status:"unreviewed",selected:false,chairDetections:[],
          evidence:{geometry:.62,chairs:0,repetition:0,source:c.source||"fill",
            basis:"a shape with no corroborating evidence of what it is"}};
      }).concat(columnVenues).concat(chairVenues);

      mark("tables");
      const associatedSeats=candidates.reduce((n,c)=>n+c.chairDetections.length,0);

      // ---- what kind of drawing is this? -----------------------------------
      // Everything above reasons about size rank: the small repeated things
      // are chairs, the bigger things they surround are tables. That holds
      // on a plan which DRAWS its furniture, and it is why this pipeline
      // works on the Golden Plan.
      //
      // A symbolic plan breaks it at the root. There, every table is the same
      // identical symbol and nothing is larger, so the reasoning inverts and
      // returns the architecture as tables and the tables as chairs. The test
      // is the chair-first path's own result: a drawn chair sits at a table,
      // so "how many of these chairs found a table" is a direct check on the
      // hypothesis that they are chairs at all. See src/plan-representation.js
      // for the measured separation — every plan that draws chairs is at or
      // above 0.95, the one that does not is at 0.077.
      let representation=null;
      let representationSwap=null;
      let familyRestoredBySwap=null;
      if(globalThis.MeritPlanRepresentation){
        representation=globalThis.MeritPlanRepresentation.decide({
          uniformFamily:chairUniform,
          uniformObjects:chairs.length,
          associatedToTable:associatedSeats,
          standalone:chairVenues.length,
          tablesFound:candidates.length,
        });
      }
      // NOTHING ANCHORS A SEATING CLAIM HERE.
      //
      // A standalone chair is a claim that somebody can sit somewhere. The
      // plan reader has just said it cannot tell what kind of drawing this
      // is -- UNKNOWN, because there were too few repeated objects for their
      // association rate to mean anything -- and not ONE table was found for
      // a chair to sit at. On an architect's shell issued before any
      // furniture exists, every filled shape is at furniture scale, so size
      // and repetition cannot separate a column from a chair; what separates
      // them is that a chair is a seat AT something, and here there is
      // nothing.
      //
      // The shapes are kept, because they are really on the drawing and an
      // operator may want to see them. What is dropped is the CLAIM about
      // what they are: they become the same uncorroborated shape the size
      // path already emits, with a basis that says so. Abstention is
      // surfaced in the product's own vocabulary rather than as a silent
      // absence -- and rather than as a confident default, which is what
      // "chair" was.
      //
      // Deliberately NOT a threshold and NOT keyed to any fixture: the
      // condition is the plan reader's own verdict plus its own recorded
      // evidence that no table exists. A drawing with even one table, or one
      // the reader could classify, is untouched.
      if(representation&&representation.kind==="UNKNOWN"&&chairVenues.length
         &&representation.evidence&&representation.evidence.tablesFound===0){
        for(const c of chairVenues){
          c.type="other";
          c.typeBasis="unanchoredSeat";
          c.shapeSuggests="block";
          c.evidence={...(c.evidence||{}),unassociated:true,
            basis:"a chair-sized shape with no table anywhere to be a seat at, on a drawing this reader could not classify"};
        }
      }
      const isPrimaryFamily=f=>(f||"primary")==="primary";
      const symbolVenues=chairVenues.filter(v=>isPrimaryFamily(v.seatFamily));
      const drawnSeatVenues=chairVenues.filter(v=>!isPrimaryFamily(v.seatFamily));
      if(representation&&representation.kind==="SYMBOLIC"&&symbolVenues.length){
        // The symbols ARE the tables. Promote them, and demote what size rank
        // called tables: on a plan whose tables are one uniform symbol, an
        // object that is not a member of that family is not a table. Both
        // counts are reported, because this swap is a large claim and has to
        // be visible rather than inferred from a changed number.
        //
        // THE SWAP ACTS ON THE FAMILY THE VERDICT WAS REACHED ABOUT, AND ON
        // NOTHING ELSE.
        //
        // It used to begin `candidates.splice(0, candidates.length)` — every
        // table on the sheet, wherever it stood. That is right while a drawing
        // speaks one language. A venue that publishes ONE sheet for a
        // symbolically-numbered ballroom and a physically-drawn terrace speaks
        // two, and a plan-wide verdict then lets the majority decide what the
        // minority is. Measured on `a9-mixed-representation`: the terrace's
        // three real tables were demoted to "not a table" and its
        // twenty-four real chairs re-read as tables, because of what was drawn
        // in a different room.
        //
        // The scope is not a threshold and not a region: it is the argument's
        // own subject. "These repeated marks sit at nothing, so they are not
        // chairs" is a statement about the PRIMARY uniform family and the
        // tables size rank proposed out of it. A separately admitted seat
        // family earned its place on its OWN adjacency evidence — most of its
        // members sitting against a table surface — which is the very evidence
        // this verdict says the primary family lacks. Neither it nor the
        // tables it seats was ever part of the claim, so neither is touched.
        //
        // On a plan with one vocabulary there are no such families and this
        // reduces, object for object, to what it did before: measured
        // identical on ORNEK, whose symbols are the only family on the sheet.
        const drawnSeatAnchored=c=>Array.isArray(c.seatFamilies)
          &&c.seatFamilies.some(f=>!isPrimaryFamily(f));
        const keptTables=candidates.filter(drawnSeatAnchored);
        const demoted=candidates.filter(c=>!drawnSeatAnchored(c));
        candidates.length=0;
        for(const c of demoted){
          c.kind="venue";
          c.type="other";
          c.selected=false;
          c.chairDetections=[];
          c.representationDemoted=true;
        }
        // ---- family members that took an exit only a chair can take --------
        //
        // Two routes remove a member of the uniform family before it ever
        // becomes an object. Both are correct on a plan that draws chairs, and
        // both delete tables here, for the same reason the OCR text-suppression
        // bug did: the exemption that makes them safe is unavailable by
        // construction on a plan whose tables are numbered symbols.
        //
        //   ASSOCIATION — the member was counted as a seat of a table proposal.
        //   Every one of those proposals has just been demoted two lines above,
        //   so the seat relationship no longer stands: its table is not a table.
        //   The pipeline already re-homes chairs whose table the fragment filter
        //   deleted ("re-seat the chairs whose table did not survive"); the swap
        //   deletes tables too and never did. Measured on ORNEK: 11 members
        //   exit here, 10 of them annotated tables.
        //
        //   TEXT RUN — the member was read as a printed glyph. That test's own
        //   discriminator is "this run sits at least 2 mark-widths from the
        //   nearest DETECTED table", which is what separates a caption from a
        //   row of seats. When the marks ARE the tables the quantity is
        //   degenerate, and measured on ORNEK the population straddles the
        //   threshold with no separation to find — min 0.62, median 1.97, max
        //   5.46 against a threshold of 2.0 — so 11 of 11 flagged marks are
        //   annotated tables and none is text. ORNEK is also the only plan in
        //   the whole benchmark set that reaches this code at all: the Golden
        //   Plan and all eight adversarial fixtures consider zero runs, because
        //   their seats are associated and only unassociated marks are eligible.
        //
        // Restoring them changes no input to the representation decision, which
        // was already taken above on the association rate as measured. It
        // changes what happens once that decision says these marks are tables.
        //
        // Both exits are filtered to the primary family for the reason the
        // first bullet gives: the restoration is justified by "its table has
        // just been demoted". A member of a second seat family whose table was
        // KEPT is still a seat of that table, and restoring it would unseat a
        // real guest's chair to make it a table of its own.
        const exitedPrimary=ch=>isPrimaryFamily(ch.chairFamily);
        const exited=[...familyLostToAssociation.filter(exitedPrimary),
          ...familyLostToTextRun.filter(exitedPrimary)];
        const restored=exited.map(familyVenue);
        // ...and the other half of the family, which never came through the
        // chair sources at all because it is drawn in solid ink. See the
        // measured membership test where familyFromTableSources is built.
        const alreadyHere=[...symbolVenues,...drawnSeatVenues,...restored];
        const overlapsExisting=c=>alreadyHere.some(v=>{
          const ix=Math.max(0,Math.min(c.x+c.w,v.x+v.w)-Math.max(c.x,v.x));
          const iy=Math.max(0,Math.min(c.y+c.h,v.y+v.h)-Math.max(c.y,v.y));
          return ix*iy>0;
        });
        const otherPolarity=familyFromTableSources
          .map(comp=>{const o=comp.shape?.obb||{cx:comp.x+comp.w/2,cy:comp.y+comp.h/2,w:comp.w,h:comp.h,rotation:comp.pcaRotation||0};
            return{id:uid("candidate"),kind:"venue",type:"chair",...toPercentBox(o),rotation:o.rotation,
              confidence:.5,status:"unreviewed",selected:false,chairDetections:[],
              evidence:{geometry:Number(Math.min(.95,comp.fill??.5).toFixed(2)),chairs:1,
                repetition:chairs.length,source:comp.source||"tone",unassociated:true}};})
          .filter(c=>!overlapsExisting(c));
        familyRestoredBySwap={fromAssociation:familyLostToAssociation.filter(exitedPrimary).length,
          fromTextRun:familyLostToTextRun.filter(exitedPrimary).length,otherPolarity:otherPolarity.length};
        const promoted=[...symbolVenues,...restored,...otherPolarity].map(c=>{
          c.kind="table";
          c.type="round";
          c.selected=true;
          c.chairDetections=[];
          // No seat count is asserted. The drawing shows no seats to count,
          // so a 0 here would read as "measured none" when the truth is
          // "this drawing does not say, by drawing". What it does say, it
          // says in print, and that is read elsewhere.
          c.seatsUnknown=true;
          // Membership of the plan's one symbol family, kept on the object so
          // later stages can tell "a table with no chairs drawn at it" from "a
          // table nothing was found at". Text suppression needs exactly that.
          c.symbolFamily=true;
          c.evidence={...(c.evidence||{}),unassociated:false,
            basis:"member of the plan's single uniform object family, on a drawing that shows no seating"};
          return c;
        });
        candidates.push(...keptTables,...promoted);
        // the promoted symbols are now tables; they must not also be venues.
        // Neither may anything else standing where a promoted member stands —
        // the solid half of the family reaches the surface filter, which turns
        // it away as "not made of table", and the column pass reads what that
        // filter turned away. A disc claimed by the family is spoken for, so it
        // cannot also be reported as a column.
        const promotedSet=new Set(promoted);
        const claimed=[...restored,...otherPolarity];
        const standsOnAPromotedMember=v=>claimed.some(c=>{
          const ix=Math.max(0,Math.min(c.x+c.w,v.x+v.w)-Math.max(c.x,v.x));
          const iy=Math.max(0,Math.min(c.y+c.h,v.y+v.h)-Math.max(c.y,v.y));
          return ix*iy>Math.min(c.w*c.h,v.w*v.h)*.5;
        });
        venues=venues.filter(v=>!promotedSet.has(v)&&!standsOnAPromotedMember(v)).concat(demoted);
        representationSwap={promotedToTable:promoted.length,demotedFromTable:demoted.length,
          restoredFromSeatOfADemotedTable:familyLostToAssociation.filter(exitedPrimary).length,
          restoredFromTextRun:familyLostToTextRun.filter(exitedPrimary).length,
          fromTheFamilysOtherPolarity:otherPolarity.length,
          // WHAT THE SWAP DID NOT TOUCH, and why. A swap that silently leaves
          // part of the sheet alone is as large a claim as one that changes it
          // all, so the exemption is counted here rather than inferred from a
          // number that did not move. Zero on a plan drawn in one vocabulary.
          keptAsDrawnFurniture:keptTables.length,
          keptDrawnSeats:drawnSeatVenues.length,
          drawnSeatFamilies:[...new Set(drawnSeatVenues.map(v=>v.seatFamily)
            .concat(keptTables.flatMap(c=>(c.seatFamilies||[]).filter(f=>!isPrimaryFamily(f)))))]};
      }

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
