// The analysis run and Stop: runAssistedDetection — one analysis at a time,
// from the plan image through the classical pipeline
// (MERIT_PLAN_DETECTION), the pinned trained detector when it loaded from its
// pinned bytes (MeritPlanModel; missing → the classical path, and it says
// why), the refinement stages (src/plan-detection-refine.js), the plan's text
// (src/plan-text-intake.js), memory and the Teach Area — and stopAnalysis,
// which ends the engines' work. Moved out of app-v8.js on 2026-11-08 (code
// health, capability 17 of 21, benchmarks/CODE-HEALTH-2026-11.md), at the
// original indentation, by scripts/extract-capability.mjs. The edits forced by
// the move: the two facts this run shares with the background read
// (keptPlanText, prefetchStoppedSrc) stay the shell's and are read and written
// through getters/setters; the VLM screen, created further down the shell, is
// reached through getVLMSCREEN(); MeritPdfText, MeritPlanModel and
// MeritPlanModelFusion through globalThis. Classical computer vision is
// "Assisted Detection", never "AI"; the moved code is gated on
// `node benchmarks/detector-fingerprint.mjs --compare` as well as the suite.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let PLANTEXT;
  let REFINE;
  let TEACH;
  let activeEvent;
  let applyPlanMemory;
  let audit;
  let buildPlanIntelligence;
  let calibratedThreshold;
  let canMutate;
  let getKeptPlanText;
  let getPrefetchStoppedSrc;
  let getVLMSCREEN;
  let matchCandidatesByGeometry;
  let nowISO;
  let planHashFor;
  let render;
  let resolveVisualEmbeddingProvider;
  let runPlanOCR;
  let setKeptPlanText;
  let setPrefetchStoppedSrc;
  let t;
  let toast;
  let touchEvent;
  let ui;
  let uid;
  let yieldFrame;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritAnalysisRun.create() is called once, by app-v8.js.");
    created=true;
    PLANTEXT=deps.PLANTEXT;
    REFINE=deps.REFINE;
    TEACH=deps.TEACH;
    activeEvent=deps.activeEvent;
    applyPlanMemory=deps.applyPlanMemory;
    audit=deps.audit;
    buildPlanIntelligence=deps.buildPlanIntelligence;
    calibratedThreshold=deps.calibratedThreshold;
    canMutate=deps.canMutate;
    getKeptPlanText=deps.getKeptPlanText;
    getPrefetchStoppedSrc=deps.getPrefetchStoppedSrc;
    getVLMSCREEN=deps.getVLMSCREEN;
    matchCandidatesByGeometry=deps.matchCandidatesByGeometry;
    nowISO=deps.nowISO;
    planHashFor=deps.planHashFor;
    render=deps.render;
    resolveVisualEmbeddingProvider=deps.resolveVisualEmbeddingProvider;
    runPlanOCR=deps.runPlanOCR;
    setKeptPlanText=deps.setKeptPlanText;
    setPrefetchStoppedSrc=deps.setPrefetchStoppedSrc;
    t=deps.t;
    toast=deps.toast;
    touchEvent=deps.touchEvent;
    ui=deps.ui;
    uid=deps.uid;
    yieldFrame=deps.yieldFrame;
  // Run fn over items in order, giving the page a turn every ~40 ms so input,
  // scrolling and Stop are answered while a long pass runs. The work and its
  // order are unchanged.
  async function inSlices(items,fn,check){
    let since=performance.now();
    for(const item of items){
      fn(item);
      if(performance.now()-since>40){await new Promise(r=>setTimeout(r,0));if(check)check();since=performance.now();}
    }
  }
  async function runAssistedDetection(){
    // ONE ANALYSIS AT A TIME. A second press (a double click, Re-Analyze while
    // the first run is still going) started a second pipeline that interleaved
    // its writes to event.analysis with the first one's.
    if(ui.analysisBusy)return;
    const event=activeEvent();if(!canMutate(event,"run plan analysis")||!event.background?.src)return toast(t("toast.importPlanFirst"),"error");ui.analysisBusy=true;ui.analysisProgress=3;ui.analysisStage=t("analysis.stage.reading");ui.tab="floor";ui.planMode="review";
    // Import -> Confirm timing for the operator test. Local only, and carried
    // on objects that already survive the event migration: the background for
    // the import moment, the analysis for everything after it. A `planTimings`
    // field on the event itself was silently dropped by migrateEvent, which is
    // exactly the kind of thing a test that reads the value catches and a test
    // that reads the code does not.
    const analysisStartedAtMs=Date.now();
    // Where the time goes, per stage, on every run: the wall clock between one
    // stage mark and the next, kept on the analysis (timings.stages). Measured,
    // not estimated, so a speed-up is shown by the stage it moved.
    const stageTimes=[];let stageAt=performance.now();
    const stage=name=>{const now=performance.now();stageTimes.push({stage:name,ms:Math.round(now-stageAt),end:Math.round(now)});stageAt=now;};
    // What the plan's analysis was before this run. The new one REPLACES it
    // part-way through (before OCR, labels, numbers and the teach area run),
    // so a failure after that point used to leave a half-built analysis where
    // a complete one had been -- under a toast saying nothing was changed.
    const priorAnalysis=event.analysis;
    // STOP means stop. The operator's Stop button aborts this controller; every
    // long wait below is raced against it, so the pipeline leaves at once, and
    // stopAnalysisEngines() ends the work the engines were doing (a worker
    // mid-inference cannot be interrupted any other way). The previous analysis
    // is put back exactly as on a failure.
    const abort=new AbortController();ui.analysisAbort=abort;
    const stopped=new Promise((_,reject)=>abort.signal.addEventListener("abort",()=>reject(Object.assign(new Error("analysis stopped"),{analysisStopped:true})),{once:true}));
    // EXPECTED ABSTENTION: the rejection is read by every guard() below.
    stopped.catch(()=>null);
    const guard=p=>Promise.race([p,stopped]);
    const checkStopped=()=>{if(abort.signal.aborted)throw Object.assign(new Error("analysis stopped"),{analysisStopped:true});};
    // A turn for the page between steps that are each a few hundred ms on a
    // dense plan (measured: benchmarks/perf/README.md). Nothing is computed
    // differently; Stop is honoured at each turn.
    const turn=async()=>{await new Promise(r=>setTimeout(r,0));checkStopped();};
    render();await yieldFrame();
    try{
      const FRAMES=globalThis.MeritPlanFrames,{analysisFrame,ratio,width,height,canvas,ctx}=await PLANTEXT.analysisCanvasOf(event.background.src);stage("decode");
      // The two text reads, when they were started at import (S5): the same
      // reads of the same image, begun earlier. Taken over by this analysis, so
      // a Stop below ends them and a re-analysis reads afresh.
      let pre=PLANTEXT.takePlanTextPrefetch(event.background.src);
      const reusing=!pre&&globalThis.MERIT_PREFETCH!=="off"&&getKeptPlanText().src===event.background.src&&getKeptPlanText().model&&getKeptPlanText().page;
      if(reusing)pre={src:getKeptPlanText().src,model:Promise.resolve(PLANTEXT.copyRead(getKeptPlanText().model)),page:Promise.resolve(PLANTEXT.copyRead(getKeptPlanText().page)),startedAtMs:performance.now(),abort:null,kept:true};
      abort.signal.addEventListener("abort",()=>pre?.abort?.abort(),{once:true});
      const prefetchUse={model:false,page:false,startedBeforeMs:pre&&!pre.kept?Math.round(performance.now()-pre.startedAtMs):null,keptFromLastAnalysis:!!(pre&&pre.kept)};
      // Tesseract reads the whole analysis canvas in its own worker, so it is
      // started HERE and runs while the OCR model and the detector hold the main
      // thread; its answer is awaited where it was always read. Same input: the
      // canvas is drawn once above and nothing after this line draws on it.
      // Measured on ORNEK, the two engines one after the other were most of the
      // analysis's wall clock.
      const tesseractStartedAt=performance.now();let tesseractMs=null;const keptReads={model:null,page:null};
      const freshPageRead=()=>(async()=>{try{return await runPlanOCR(canvas.toDataURL("image/png"));}catch(ocrError){return{available:false,text:null,reason:ocrError.message,reasonCode:"FAILED"};}finally{tesseractMs=Math.round(performance.now()-tesseractStartedAt);}})();
      // A read begun at import is used only when it answered: one that failed
      // or was stopped is read again here, so the result never differs from
      // what reading now would give.
      const readWholePage=()=>pre&&pre.page?pre.page.then(r=>{if(r&&r.available){prefetchUse.page=true;tesseractMs=Math.round(performance.now()-tesseractStartedAt);return r;}return freshPageRead();}):freshPageRead();
      // EXPERIMENT ONLY (benchmarks/perf/README.md): MERIT_TESSERACT_PAGE =
      // "model-only" leaves Tesseract's whole-page read out when the OCR model
      // reads the page, and starts it only when the model could not. The product
      // reads with both until a measurement says one is enough.
      const pageOnlyIfModelFails=globalThis.MERIT_TESSERACT_PAGE==="model-only";
      let ocrStarted=pageOnlyIfModelFails?null:readWholePage();
      stage("tesseractStart");
      ui.analysisStage=t("analysis.stage.understanding");ui.analysisProgress=22;render();await yieldFrame();
      // Deskew before anything measures a component. See estimatePlanSkew.
      //
      // Only when the evidence is real: the best angle has to beat square-on by
      // a margin, not merely tie with it. Measured, that gain is 2.03 and 2.20
      // on the two genuinely rotated variants and exactly 1.0000 on the six
      // straight renderings, so the deadband is not a close call.
      const skew=globalThis.MERIT_PLAN_DETECTION.resolve().estimatePlanSkew(canvas,width,height);
      const deskewDeg=skew.applyDeg;stage("skew");
      // Every frame and both box conventions live in MeritPlanFrames
      // (src/plan-frames.js): the detector reads DESKEWED pixels, the product
      // stores and draws PLAN percent of the analysis canvas, and a deskew of 0
      // makes both directions the identity.
      const deskew=FRAMES.deskewFrame(width,height,deskewDeg),dw=deskew.dw,dh=deskew.dh;
      let dctx=ctx;
      if(deskew.applied){
        const dcanvas=document.createElement("canvas");dcanvas.width=dw;dcanvas.height=dh;
        dctx=dcanvas.getContext("2d",{willReadFrequently:true});
        // Paper, not black, behind the rotated corners: a black wedge would read
        // as a giant dark object and change every tone family on the plan.
        dctx.fillStyle="#ffffff";dctx.fillRect(0,0,dw,dh);
        dctx.translate(dw/2,dh/2);dctx.rotate(deskew.rad);dctx.drawImage(canvas,-width/2,-height/2);
        dctx.setTransform(1,0,0,1,0,0);
      }
      const pixels=dctx.getImageData(0,0,dw,dh);stage("deskew");
      // A candidate's w/h are its oriented box's own dimensions, so rotating
      // the frame moves only the centre and shifts the angle by the correction
      // applied. A candidate is a CORNER box; the seats nested in it are CENTRE
      // boxes — the two conventions MeritPlanFrames names.
      const planFromDeskew=o=>{
        if(!o)return o;
        if(deskew.applied)FRAMES.mapBox(o,FRAMES.CORNER,deskew.deskewToAnalysis,dw,dh,width,height,deskewDeg);
        for(const ch of o.chairDetections||[])planFromDeskewChair(ch);
        return o;
      };
      const planFromDeskewChair=ch=>deskew.applied?FRAMES.mapBox(ch,FRAMES.CENTRE,deskew.deskewToAnalysis,dw,dh,width,height,deskewDeg):ch;
      // Human-confirmed regions travel the other way: they were stored in plan
      // percent and the detector needs them where it is looking.
      const deskewToPlan=list=>!deskew.applied?list:list.map(r=>{
        const m=FRAMES.mapBox({x:r.x,y:r.y,w:r.w,h:r.h},FRAMES.CORNER,deskew.analysisToDeskew,width,height,dw,dh);
        return{x:m.x,y:m.y,w:m.w,h:m.h};
      });
      // The application layer talks to a PlanDetectionProvider, never to pixel
      // code or a vendor SDK directly (merit-plan-intelligence, "Provider
      // abstraction"). Today exactly one provider is installed and it is
      // classical computer vision. The local plan-symbol detector is not a
      // provider: it takes a second look beside it, below, and the analysis
      // records trainedModel true only when that model ran.
      const provider=globalThis.MERIT_PLAN_DETECTION.resolve();
      // The OCR MODEL reads the plan's text FIRST (src/plan-ocr-paddle.js): its
      // lines are the one evidence the detector takes from text — what is
      // printed is not a seat (see textRegions in plan-detection-chairs.js) —
      // and the same read later feeds the capacity, label and number stages.
      // Its boxes are SOURCE pixels; the detector looks at the deskewed
      // analysis canvas, so each line's corners go through both frames.
      ui.analysisStage=t("analysis.stage.labels");render();await yieldFrame();
      // The local plan-symbol detector (src/plan-model.js) needs only the
      // deskewed pixels and the runtime the OCR model brings. It starts as soon
      // as that runtime is up and runs in a worker beside the OCR model's read;
      // its answer is taken after the classical detector, where it always was.
      // The detector only reads the pixels, so both see the same ones.
      const localModelStarted=globalThis.MeritPlanModel&&globalThis.MeritPlanModelFusion?(async()=>{
        // EXPECTED ABSTENTION: a runtime that does not come up is reported by
        // the OCR model's read and by the local model's own (RUNTIME_NOT_LOADED).
        await globalThis.MeritPaddleOCR?.ready?.().catch(()=>null);
        if(abort.signal.aborted)return{available:false,reasonCode:"STOPPED",reason:"the analysis was stopped",detections:[]};
        return globalThis.MeritPlanModel.detect(pixels,dw,dh);
      })():null;
      const ocrModelRead=await guard(pre&&pre.model
        ?pre.model.then(r=>{if(r&&r.available){prefetchUse.model=true;return r;}return PLANTEXT.readPlanTextWithModel(event,undefined,abort.signal);})
        :PLANTEXT.readPlanTextWithModel(event,undefined,abort.signal));stage("ocrModel");
      keptReads.model=ocrModelRead&&ocrModelRead.available?PLANTEXT.copyRead(ocrModelRead):null;
      if(!ocrStarted)ocrStarted=ocrModelRead.available&&globalThis.Tesseract
        ?Promise.resolve({available:true,text:"",words:[],pageRead:"skipped: the OCR model read the page"})
        :readWholePage();
      // The crop workers start now, while the detector holds the page, so they
      // are ready when the label and number stages ask for them.
      globalThis.MeritPlanOCRCrops?.prewarm();
      // A plan imported from a PDF that carries TEXT OBJECTS (src/plan-pdf-text.js)
      // hands them on as exact text in the analysis pixels: the document states
      // its words, nothing reads them. They join the model's lines wherever
      // those are used for what is printed (never as a table's number — that
      // vote has its own provenance). A scan wrapped in a PDF has none.
      const pdfItems=globalThis.MeritPdfText?globalThis.MeritPdfText.scaledItems(event.background?.pdfSource,width,height):[];
      const textRegions=[];
      const textRegion=(box,sx,sy)=>{
        const corners=[[box.x0,box.y0],[box.x1,box.y0],[box.x0,box.y1],[box.x1,box.y1]]
          .map(([x,y])=>deskew.applied?deskew.analysisToDeskew.apply(x*sx,y*sy):[x*sx,y*sy]);
        textRegions.push({x0:Math.min(...corners.map(c=>c[0])),y0:Math.min(...corners.map(c=>c[1])),
          x1:Math.max(...corners.map(c=>c[0])),y1:Math.max(...corners.map(c=>c[1]))});
      };
      if(ocrModelRead.available&&ocrModelRead.imageSize){
        const sx=width/ocrModelRead.imageSize.width,sy=height/ocrModelRead.imageSize.height;
        for(const it of ocrModelRead.items||[]){
          if(!(it.score>=.9)||!String(it.text||"").trim())continue;
          textRegion(it.box,sx,sy);
        }
      }
      for(const it of pdfItems)textRegion(it.box,1,1);
      const detectionStartedAt=performance.now();
      // Regions the operator has already ruled on. An automatic filter is
      // allowed to disagree with the detector; it is never allowed to overrule
      // a human. Without this, fragment suppression runs before plan memory is
      // re-applied, so a table the operator explicitly confirmed could be
      // deleted before memory ever got the chance to restore it. It happened
      // to survive in testing only because an unrelated chair candidate
      // remained at that position for memory to match against -- an accident,
      // not a guarantee.
      const protectedRegions=(event.planMemory||[])
        .filter(m=>m.status==="confirmed"||m.manual)
        .map(m=>({x:m.geometry.x,y:m.geometry.y,w:m.geometry.w,h:m.geometry.h}));
      const detection=await guard(provider.detect(pixels,dw,dh,{confidenceThreshold:calibratedThreshold,protectedRegions:deskewToPlan(protectedRegions),textRegions,onStage:async(key,progress)=>{
        checkStopped();ui.analysisStage=t("analysis.stage."+key);ui.analysisProgress=progress;render();await yieldFrame();
      }}));
      const detectionMs=Math.round(performance.now()-detectionStartedAt);stage("classicalDetect");
      const candidates=detection.candidates,venues=detection.venues,threshold=detection.threshold;
      // The local plan-symbol detector (src/plan-model.js) takes a second,
      // independent look at the same deskewed pixels. Fusion adds only what the
      // classical pipeline did not propose and marks what the model does not
      // support; it removes nothing (src/plan-model-fusion.js). When the model
      // is unavailable the reason is kept and the classical path goes on alone.
      let localModel=null;
      if(localModelStarted){
        ui.analysisStage=t("analysis.stage.localModel");render();await yieldFrame();
        const read=await guard(localModelStarted);
        const fused=globalThis.MeritPlanModelFusion.fuse(candidates,venues,read,{width:dw,height:dh,uid,representation:detection.representation,textRegions,pixels:pixels.data});
        candidates.push(...fused.added);venues.push(...fused.addedVenues);
        localModel={available:read.available,reasonCode:read.reasonCode||null,reason:read.reason||null,ms:read.ms??null,model:read.model,
          loadMs:read.model&&read.model.loadMs!=null?read.model.loadMs:null,detections:read.detections.length,addedTables:fused.added.length,addedColumns:fused.addedVenues.filter(v=>v.type==="column").length,addedSeating:fused.seatingAdded,seatingOriented:fused.seatingOriented,tablesOnSeating:fused.tablesOnSeating,chairsAttached:fused.chairsAttached,chairsInText:fused.chairsInText,offSize:fused.offSize,unsupported:fused.unsupported};
      }
      // A vector PDF's own furniture shapes, when the import found repeated ones:
      // exact geometry, fused the same way (added where nothing was proposed).
      // No printed-text rule here: a drawn chair is drawn, whatever number is
      // printed inside it; the rule exists for what a model READ off pixels.
      // And chairs ARE attached (addChair), unlike the local model's: they are
      // the document's own shapes, not a reading (benchmarks/offline-intelligence,
      // vector-latest.json).
      let vectorObjects=null;
      const vo=event.background?.pdfSource?.vector?.objects;
      if(vo&&globalThis.MeritPlanModelFusion&&(vo.tables||[]).length&&!globalThis.MERIT_PLAN_VECTOR_DISABLED){
        const ps=event.background.pdfSource,kx=width/(ps.width||width),ky=height/(ps.height||height);
        const toDeskew=b=>{const[cx,cy]=deskew.applied?deskew.analysisToDeskew.apply(b.cx*kx,b.cy*ky):[b.cx*kx,b.cy*ky];return{cls:b.cls,score:1,cx,cy,w:b.w*kx,h:b.h*ky};};
        const fusedV=globalThis.MeritPlanModelFusion.fuse(candidates,venues,{available:true,detections:[...vo.tables,...vo.chairs].map(toDeskew)},{width:dw,height:dh,uid,representation:detection.representation},{source:"pdf-vector",addChair:0.45,supportField:"vectorSupport"});
        candidates.push(...fusedV.added);
        vectorObjects={reason:vo.reason,proposedTables:vo.tables.length,proposedChairs:vo.chairs.length,addedTables:fusedV.added.length,chairsAttached:fusedV.chairsAttached};
      }
      stage("localModelAndVector");
      ui.analysisStage=t("analysis.stage.seating");ui.analysisProgress=73;render();await yieldFrame();
      // Through the provider boundary rather than the function directly. That
      // seam was built for a future learned model and is now carrying one:
      // when src/plan-encoder-weights.js is present this resolves to the
      // trained encoder concatenated with the descriptor, and to the
      // descriptor alone when it is not. Which one ran is reported in the
      // detection diagnostics, never assumed.
      //
      // Embedding reads the deskewed pixel buffers, so it happens while the
      // geometry is still in deskewed space; the mapping back to plan space is
      // the next statement.
      const embedder=resolveVisualEmbeddingProvider();
      const embeddingStartedAt=performance.now();
      // In slices of about 40 ms, so a dense plan's few hundred crops do not
      // hold the page for a second at a time (measured: one task of ~1 s on
      // ORNEK). Each object's vector is its own; only the waiting changes.
      await inSlices(candidates,c=>{c.visualDescriptor=embedder.embed(detection.gray,detection.binary,dw,dh,c);},checkStopped);
      await inSlices(venues,c=>{c.visualDescriptor=embedder.embed(detection.gray,detection.binary,dw,dh,c);},checkStopped);
      // Seats the associator attached to a table are the best-corroborated
      // chairs on the plan, and they are what lets the second opinion say
      // "that looks more like a chair than a table" instead of only "that
      // matches nothing well". Measured: on six of the seven degraded
      // renderings a false table sits closer to a real chair than to a real
      // table (benchmarks/embedding/separation.json).
      //
      // Their vectors are kept OFF the stored objects and thrown away with
      // this pass. Persisting ~113 extra 128-float arrays per analysis would
      // cost real storage for something recomputed on every run. A nested seat
      // carries its CENTRE in x/y, so the box is converted before cropping.
      const seatVectors=new Map();
      await inSlices(candidates,c=>{for(const ch of c.chairDetections||[]){
        const v=embedder.embed(detection.gray,detection.binary,dw,dh,
          {x:ch.x-ch.w/2,y:ch.y-ch.h/2,w:ch.w,h:ch.h});
        if(v?.vector)seatVectors.set(ch.id,{vector:v.vector,tableId:c.id});
      }},checkStopped);
      const embeddingMs=Math.round(performance.now()-embeddingStartedAt);
      for(const c of [...candidates,...venues])planFromDeskew(c);
      await turn();
      // A table SYMBOL is found by the fill inside its ring; its drawn edge is
      // the ring. Measured from the pixels (src/plan-symbol-geometry.js) before
      // anything — memory included — reads the geometry. Only symbols: a table
      // with drawn chairs is measured by its own surface, and an axis-aligned
      // walk says nothing true about a rotated box.
      if(globalThis.MeritSymbolGeometry){
        const raster=ctx.getImageData(0,0,width,height);
        await turn();
        let refined=0;
        for(const c of candidates){
          if(c.kind!=="table"||c.symbolFamily!==true||(c.rotation||0)%180!==0)continue;
          const box={x0:c.x/100*width,y0:c.y/100*height,x1:(c.x+c.w)/100*width,y1:(c.y+c.h)/100*height};
          const r=globalThis.MeritSymbolGeometry.outerOutline(raster,box);
          if(!r||(r.x0===box.x0&&r.y0===box.y0&&r.x1===box.x1&&r.y1===box.y1))continue;
          c.geometryRefined={from:{x:c.x,y:c.y,w:c.w,h:c.h},basis:"the symbol's drawn ring, measured from the pixels",sides:r.measuredSides};
          c.x=r.x0/width*100;c.y=r.y0/height*100;c.w=(r.x1-r.x0)/width*100;c.h=(r.y1-r.y0)/height*100;
          refined++;
        }
        detection.diagnostics.symbolOutlinesRefined=refined;
        await turn();
      }
      detection.diagnostics.tablesHeldForOverlap=REFINE.holdBackOverlappingTables(candidates);
      const previous=event.analysis?.candidates||[],signatures=list=>list.map(c=>`${c.kind}:${c.type}:${Math.round(c.x)}:${Math.round(c.y)}`),oldSig=new Set(signatures(previous)),newSig=new Set(signatures([...candidates,...venues]));
      const freshCandidates=[...candidates,...venues];
      const priorCandidates=event.analysis?.candidates||[],priorDecisions=event.analysis?.groupingDecisions||[];
      const memoryResult=applyPlanMemory(freshCandidates,event.planMemory||[]);
      const allCandidates=[...freshCandidates,...memoryResult.restored];
      // Which candidate carries which human decision, so the reference tiering
      // below can tell a confirmed object from the detector's own guess. Run
      // AFTER plan memory, so a reclassified candidate is referenced under the
      // class the operator gave it rather than the one the detector guessed.
      const memoryByCandidate=new Map();
      for(const m of event.planMemory||[]){
        const cid=memoryResult.idRemap.get(m.sourceCandidateId);
        if(cid)memoryByCandidate.set(cid,m);
      }
      const secondOpinionStartedAt=performance.now();
      const secondOpinion=REFINE.applyVisualSecondOpinion(allCandidates,memoryByCandidate,seatVectors);
      secondOpinion.ms=Math.round(performance.now()-secondOpinionStartedAt);
      // Grouping decisions are keyed by candidate id, which is regenerated on
      // every analysis pass -- remap them through the same geometry match so
      // a "these are separate tables" answer survives Re-Analyze instead of
      // silently reverting to the detector's default grouping.
      await turn();
      const geometryRemap=matchCandidatesByGeometry(priorCandidates,allCandidates);
      const carriedDecisions=priorDecisions.map(d=>({...d,memberIds:d.memberIds.map(id=>geometryRemap.get(id)).filter(Boolean)})).filter(d=>d.memberIds.length>=2);
      event.analysis={id:uid("analysis"),engine:"ASSISTED_DETECTION",trainedModel:!!(localModel&&localModel.available),localModel,vectorObjects,notice:localModel&&localModel.available?"Classical computer vision and the local plan-symbol detector (a small trained model of plan symbols) are active.":"Classical computer vision is active; no trained Merit model is installed in this browser review.",createdAt:nowISO(),imageWidth:width,imageHeight:height,originalWidth:analysisFrame.originalWidth,originalHeight:analysisFrame.originalHeight,threshold,candidates:allCandidates,missed:allCandidates.filter(c=>c.missed).map(c=>c.id),groupingDecisions:carriedDecisions,memoryReapplied:memoryResult.reappliedCount,memoryRestored:memoryResult.restored.length,memoryConflicts:memoryResult.conflicts,comparison:{added:[...newSig].filter(x=>!oldSig.has(x)).length,removed:[...oldSig].filter(x=>!newSig.has(x)).length,changed:0},diagnostics:{...detection.diagnostics,resolution:`${width}×${height}`,detectionMs,provider:provider.id,providerLabel:provider.label,
        // Which visual representation actually produced the descriptors, and
        // whether it involved trained weights. Reported from the resolved
        // provider rather than from a constant, so an install without the
        // encoder says so instead of claiming one ran.
        embedding:{id:embedder.id,kind:embedder.kind||"handcrafted-descriptor",trainedModel:!!embedder.trainedModel,
          dimensions:embedder.dimensions||null,embeddingMs,
          cache:globalThis.MeritPlanEncoder?.cacheStats?.()||null,
          secondOpinion}}};
      // A complete PlanIntelligenceResult exists from the moment the analysis
      // object does, so the review screen (and anything reading the stored
      // event) never sees an analysis with null provider metadata or a null
      // seat count while OCR is still being attempted. It is recomputed below
      // once OCR either produced real text or honestly reported unavailable.
      event.analysis.ocrText=null;
      event.analysis.planIntelligence=buildPlanIntelligence(event,null);
      ui.analysisStage=t("analysis.stage.labels");ui.analysisProgress=84;render();await yieldFrame();
      stage("embedMemoryBuild");
      const ocrResult=await guard(ocrStarted);stage("tesseractWait");
      keptReads.page=ocrResult&&ocrResult.available&&ocrResult.pageRead==null?PLANTEXT.copyRead(ocrResult):null;
      event.analysis.ocr={available:ocrResult.available,reason:ocrResult.reason||null,reasonCode:ocrResult.reasonCode||null,engine:"tesseract.js"};
      // Kept in full (not just the truncated capacityAudit.sourceText) so a
      // grouping/reclassification decision can recompute planIntelligence
      // later without re-running OCR.
      event.analysis.ocrText=ocrResult.available?ocrResult.text:null;
      let suppressedByText=[];
      // The words text suppression measures against: Tesseract's, and the
      // lines the OCR model read (score >= 0.9) in the same analysis pixels.
      // Tesseract does not read outlined lettering — the Golden Plan's GİRİŞ,
      // BAR, the capacity block — and a "table" made of a door label and the
      // column beside it was then only held back by accident.
      const suppressionWords=[...(ocrResult.available?ocrResult.words||[]:[])];
      if(ocrModelRead.available&&ocrModelRead.imageSize){
        const sx=width/ocrModelRead.imageSize.width,sy=height/ocrModelRead.imageSize.height;
        for(const it of ocrModelRead.items||[])if(it.score>=.9&&String(it.text||"").trim())
          suppressionWords.push({text:it.text,bbox:{x0:it.box.x0*sx,y0:it.box.y0*sy,x1:it.box.x1*sx,y1:it.box.y1*sy}});
      }
      for(const it of pdfItems)suppressionWords.push({text:it.text,bbox:{...it.box}});
      const pdfSource=event.background?.pdfSource;
      if(pdfSource)event.analysis.diagnostics.pdfSource={kind:pdfSource.kind||null,textItems:pdfItems.length,
        paths:pdfSource.vector?.paths??null,images:pdfSource.vector?.images??null,truncated:!!pdfSource.text?.truncated,
        content:["RASTER","VECTOR","MIXED","EMPTY"].includes(pdfSource.content)?pdfSource.content:null,
        shapes:pdfSource.vector?.shapes&&typeof pdfSource.vector.shapes==="object"?Object.fromEntries(["rect","circle","ellipse","polygon","line","clipped"].map(k=>[k,Math.max(0,Math.floor(Number(pdfSource.vector.shapes[k])||0))])):null};
      // The plan's pixels, read once: text suppression asks the drawing what
      // is under a word (drawnEvidence), and the venue and facing reads below
      // use the same raster. Nothing draws on this canvas in between.
      let planRaster=null;
      if(suppressionWords.length){
        planRaster=ctx.getImageData(0,0,width,height);
        const suppression=REFINE.suppressTextFalsePositives(event.analysis.candidates,suppressionWords,width,height,planRaster);
        event.analysis.candidates=suppression.kept;
        event.analysis.diagnostics.textSuppressed=suppression.removedCount;
        event.analysis.diagnostics.textSuppressionKeptAsDrawn=suppression.keptAsDrawn;
        suppressedByText=suppression.removed||[];
      }
      ui.analysisStage=t("analysis.stage.labels");render();await yieldFrame();
      // The OCR MODEL (src/plan-ocr-paddle.js, PP-OCRv4): one plan-wide read at
      // the plan's own resolution, beside Tesseract. Its lines join the text
      // the capacity and label layers read, and its reading of each table's
      // symbol is one view in the printed-number vote. Unavailable is recorded
      // as such -- the Tesseract path carries on alone.
      event.analysis.ocrModel=ocrModelRead;
      if(event.analysis.ocrModel.available){
        const modelText=event.analysis.ocrModel.items.map(i=>i.text).join("\n").normalize("NFKC");
        event.analysis.ocrText=[event.analysis.ocrText,modelText].filter(Boolean).join("\n");
      }
      if(pdfItems.length)event.analysis.ocrText=[event.analysis.ocrText,pdfItems.map(i=>i.text).join("\n").normalize("NFKC")].filter(Boolean).join("\n");
      stage("textSuppression");
      await guard(REFINE.identifyLabelledVenueObjects(event,suppressedByText,abort.signal));stage("labels");
      // A turn for the page between the three steps of this stage, and inside
      // the facing read (each was measured over 200 ms on its own plan).
      let turnAt=performance.now();
      const pace=async()=>{if(performance.now()-turnAt<40)return;await turn();turnAt=performance.now();};
      await turn();
      if(!planRaster)planRaster=ctx.getImageData(0,0,width,height);
      await turn();
      await REFINE.placeNamedVenueElements(event,planRaster,ocrResult,pdfItems,turn);
      await turn();turnAt=performance.now();
      await REFINE.readChairFacing(event,planRaster,pace);stage("venueAndFacing");
      await guard(PLANTEXT.readPrintedTableNumbers(event,abort.signal,turn));stage("tableNumbers");
      // The drawing's own fingerprint, so a lesson taught on it can be found
      // again after a re-import under a different filename. Failing to compute
      // it is not fatal: plan-scope lessons simply do not match, which is the
      // safe direction.
      try{event.analysis.planHash=await guard(planHashFor(event.background.src));}catch(hashError){if(hashError?.analysisStopped)throw hashError;event.analysis.planHash=null;}stage("planHash");
      checkStopped();
      // Before plan intelligence is rebuilt, because a lesson can move an
      // object from table to venue and the capacity, relationship and
      // consistency layers all have to see the corrected answer.
      TEACH.applyTeachArea(event);
      // What each stage saw, in which frame, with its own confidence and a link
      // to look again (MeritObservations). Rebuilt whole on every analysis, so
      // no observation outlives the candidate it describes.
      event.analysis.frames={source:{width:analysisFrame.sourceWidth,height:analysisFrame.sourceHeight},analysis:{width,height,ratio},deskewDeg:deskewDeg||0,storedIn:"plan-percent of the analysis canvas",conventions:{candidate:FRAMES.CORNER,seat:FRAMES.CENTRE}};
      globalThis.MeritObservations.recordFromAnalysis(event.analysis,{detector:{id:provider.id,version:provider.version||null},ocrEngine:event.analysis.ocr?.available?"tesseract.js":null,ocrModel:event.analysis.ocrModel?.available?event.analysis.ocrModel.provider.id:null,imageRef:event.analysis.planHash||null});
      ui.analysisStage=t("analysis.stage.relating");ui.analysisProgress=90;render();await yieldFrame();
      ui.analysisStage=t("analysis.stage.capacity");ui.analysisProgress=95;render();await yieldFrame();
      event.analysis.planIntelligence=buildPlanIntelligence(event,event.analysis.ocrText);
      // LAST, and that position is the whole point. The self-check compares
      // what the drawing states against what was found, and the statement only
      // exists once planIntelligence has been rebuilt from the OCR text. Run
      // any earlier and it reads the pre-OCR interpretation: on a plan whose
      // tables are not numbered, readPrintedTableNumbers returns before it
      // refreshes anything, so the capacity rule the drawing prints would
      // simply not be there to check. It runs on every plan, not only numbered
      // ones — a drawing that prints a capacity rule can be checked against
      // itself whatever its tables look like.
      await turn();
      TEACH.runSelfCheck(event);
      await turn();
      // Last, and only last: it ranks what every layer above it concluded.
      TEACH.runConfidenceBudget(event);stage("intelligence");
      ui.analysisStage=t("analysis.stage.review");ui.analysisProgress=100;ui.analysisBusy=false;ui.analysisAbort=null;
      event.analysis.timings={importedAtMs:event.background?.importedAtMs??null,analysisStartedAtMs,analysisCompletedAtMs:Date.now(),stages:stageTimes,tesseractMs,prefetch:prefetchUse};
      if(globalThis.MERIT_PREFETCH!=="off"&&keptReads.model&&keptReads.model.available&&keptReads.page&&keptReads.page.available)setKeptPlanText({src:event.background.src,model:keptReads.model,page:keptReads.page});ui.selectedCandidateId=event.analysis.candidates[0]?.id||null;ui.difficultQuestionIndex=0;ui.activeReviewGroupId=null;ui.activeQuestionId=null;audit(event,"ASSISTED_DETECTION_COMPLETED",event.analysis.diagnostics);touchEvent(event);render();
      // A model on this computer, measured on closed questions, then looks at
      // what the analysis is unsure of — by itself, in the background (screen-vlm).
      getVLMSCREEN().afterAnalysis(event);
    }catch(error){
      event.analysis=priorAnalysis;ui.analysisAbort=null;
      if(error?.analysisStopped||abort.signal.aborted){
        setPrefetchStoppedSrc(event.background?.src||null);
        ui.analysisBusy=false;ui.analysisStage=t("analysis.stage.cancelled");render();toast(t("detect.cancelled"),"info",5000);
        return;
      }
      console.warn("Assisted Detection failed; the previous analysis is kept.",error);
      ui.analysisBusy=false;ui.analysisStage=t("analysis.stage.failed");render();toast(t("detect.failed"),"error",7000);
    }
  }
  // The Stop button. Ends the engines' work, not just the wait for it: every
  // OCR worker (a recognition cannot be interrupted any other way), and the
  // ONNX workers when an inference is running there — whose sessions go with
  // them, so the OCR model and the local detector load again on the next run.
  function stopAnalysis(){
    if(!ui.analysisBusy||!ui.analysisAbort||ui.analysisAbort.signal.aborted)return;
    ui.analysisStage=t("analysis.stage.cancelling");
    ui.analysisAbort.abort();
    stopAnalysisEngines();
    render();
  }
  function stopAnalysisEngines(){
    const stoppedEngines={tesseract:false,onnx:false};
    if(globalThis.MeritPlanOCRCrops){globalThis.MeritPlanOCRCrops.terminate();stoppedEngines.tesseract=true;}
    const pool=globalThis.MeritOrtPool;
    if(pool&&pool.status().busy>0){
      pool.terminate();
      globalThis.MeritPaddleOCR?.reset?.();
      globalThis.MeritPlanModel?.release?.();
      stoppedEngines.onnx=true;
    }
    ui.analysisStoppedEngines=stoppedEngines;
    return stoppedEngines;
  }
  // Re-derives the whole PlanIntelligenceResult from the CURRENT candidates +
  // any recorded grouping/reclassification decisions. Called after every
  // decision that changes the logical interpretation of the plan (grouping
  // answers, cross-kind reclassification) so capacity, dining-group counts,
  // Review Center and overlays are never stale relative to what a human
  // actually decided.
  // The self-check goes with it: a reclassification changes how many tables
  // were found, and a consistency report that still quotes the old count is
  // worse than none — it disagrees with the screen it sits on.
    return{runAssistedDetection,stopAnalysis};
  }
  globalThis.MeritAnalysisRun=Object.freeze({create,DEPS:Object.freeze(["PLANTEXT","REFINE","TEACH","activeEvent","applyPlanMemory","audit","buildPlanIntelligence","calibratedThreshold","canMutate","getKeptPlanText","getPrefetchStoppedSrc","getVLMSCREEN","matchCandidatesByGeometry","nowISO","planHashFor","render","resolveVisualEmbeddingProvider","runPlanOCR","setKeptPlanText","setPrefetchStoppedSrc","t","toast","touchEvent","ui","uid","yieldFrame"])});
})();
