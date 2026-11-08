// The plan's text: read in the background before Analyse is pressed (and
// handed to the analysis that asks for that image), the analysis canvas of a
// plan image, the OCR model's reading, and the table numbers printed inside
// each table symbol. Moved out of app-v8.js on 2026-11-08 (code health,
// capability 15 of 21, benchmarks/CODE-HEALTH-2026-11.md), at the original
// indentation, by scripts/extract-capability.mjs; the section comments
// travelled with the code. OCR is supporting evidence only — it never defines
// geometry by itself. The edits forced by the move: the shell keeps the two
// facts the analysis run writes (the image whose analysis a person stopped,
// and the last completed reads), and this file reads the first through
// getPrefetchStoppedSrc(); the Teach Area's number check is reached through
// getTEACH(), because it is created further down the shell.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let ANALYSIS_MAX_SIDE;
  let REFINE;
  let RULES;
  let buildPlanIntelligence;
  let getPrefetchStoppedSrc;
  let getTEACH;
  let runPlanOCR;
  let sourceBlob;
  let ui;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritPlanTextIntake.create() is called once, by app-v8.js.");
    created=true;
    ANALYSIS_MAX_SIDE=deps.ANALYSIS_MAX_SIDE;
    REFINE=deps.REFINE;
    RULES=deps.RULES;
    buildPlanIntelligence=deps.buildPlanIntelligence;
    getPrefetchStoppedSrc=deps.getPrefetchStoppedSrc;
    getTEACH=deps.getTEACH;
    runPlanOCR=deps.runPlanOCR;
    sourceBlob=deps.sourceBlob;
    ui=deps.ui;
  // ---- the plan's text, read before Analyse is pressed (S5, 2026-10-17) ----
  // Both text reads — the OCR model's and Tesseract's whole page — depend on
  // the plan image and on nothing else, so they can begin the moment a plan is
  // imported and be handed to the analysis when a person presses Analyse: the
  // same reads of the same pixels, started earlier. Measured on ORNEK they are
  // most of a cold analysis (benchmarks/perf/README.md). Only for a plan just
  // imported (`importedAtMs`, written by the import itself) into an event that
  // has no analysis yet and can still be changed; keyed by the image, so a plan
  // replaced before Analyse is never read for the new one. MERIT_PREFETCH="off"
  // turns it off for a measurement without it.
  const PREFETCH_WINDOW_MS=10*60*1000;
  const planTextPrefetch={src:null,model:null,page:null,startedAtMs:null,abort:null};
  async function analysisCanvasOf(src){
    const FRAMES=globalThis.MeritPlanFrames,blob=await sourceBlob(src),bitmap=await createImageBitmap(blob),analysisFrame=FRAMES.analysisFrame(bitmap.width,bitmap.height,ANALYSIS_MAX_SIDE());
    const width=analysisFrame.width,height=analysisFrame.height,canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(bitmap,0,0,width,height);bitmap.close();
    return{analysisFrame,ratio:analysisFrame.ratio,width,height,canvas,ctx};
  }
  function clearPlanTextPrefetch(){Object.assign(planTextPrefetch,{src:null,model:null,page:null,startedAtMs:null,abort:null});}
  const copyRead=r=>r==null?r:(typeof structuredClone==="function"?structuredClone(r):JSON.parse(JSON.stringify(r)));
  function startPlanTextPrefetch(event){
    if(globalThis.MERIT_PREFETCH==="off"||!event||event.analysis||ui.analysisBusy)return;
    const bg=event.background,src=bg?.src;
    if(!src||planTextPrefetch.src===src||src===getPrefetchStoppedSrc()||!(Date.now()-(bg.importedAtMs||0)<PREFETCH_WINDOW_MS))return;
    if(RULES().isHistorical(event))return;
    planTextPrefetch.abort?.abort();
    const abort=new AbortController(),startedAtMs=performance.now();
    // EXPECTED ABSTENTION: a read that fails here is read again by the analysis.
    const model=globalThis.MeritPaddleOCR?readPlanTextWithModel(event,null,abort.signal).catch(()=>null):null;
    const page=globalThis.Tesseract&&typeof globalThis.runPlanOCR==="function"
      ?analysisCanvasOf(src).then(a=>abort.signal.aborted?null:runPlanOCR(a.canvas.toDataURL("image/png"))).catch(()=>null):null;
    Object.assign(planTextPrefetch,{src,model,page,startedAtMs,abort});
  }
  globalThis.MeritPlanTextPrefetch=Object.freeze({status:()=>({active:!!planTextPrefetch.src})});
  function takePlanTextPrefetch(src){
    if(!src||planTextPrefetch.src!==src){planTextPrefetch.abort?.abort();clearPlanTextPrefetch();return null;}
    const taken={...planTextPrefetch};clearPlanTextPrefetch();return taken;
  }
  async function readPlanTextWithModel(event,progress={from:24,span:6},signal=null){
    const M=globalThis.MeritPaddleOCR,src=event.background?.src;
    if(!M||!src)return{available:false,reasonCode:"ENGINE_NOT_LOADED",reason:"OCR model provider not present"};
    let image;
    try{image=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});}
    catch{return{available:false,reasonCode:"FAILED",reason:"plan image did not decode"};}
    const r=await M.readPlanText(image,{timeoutMs:120000,signal,recMinWidth:globalThis.MERIT_PPOCR_REC_MIN_WIDTH,onProgress:p=>{if(progress)ui.analysisProgress=progress.from+Math.round(p*progress.span);}});
    return r.available?{available:true,provider:r.provider,ms:r.ms,imageSize:r.imageSize,items:r.items}
      :{available:false,provider:r.provider||null,reasonCode:r.reasonCode||"FAILED",reason:r.reason||null};
  }
  // `turn` (optional): a turn for the page between rebuilding the plan's
  // intelligence and checking the numbering, each ~0.1–0.2 s on a dense plan.
  // The analysis is still marked not complete while it runs.
  async function readPrintedTableNumbers(event,signal=null,turn=null){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritTableNumbers||!globalThis.MeritLabelOCR)return;
    if(typeof globalThis.runPlanOCR!=="function"||!(analysis.ocr?.available||analysis.ocrModel?.available))return;
    const src=event.background?.src;
    if(!src)return;
    const family=(analysis.candidates||[]).filter(c=>c.kind==="table"&&c.symbolFamily===true);
    // A table the local detector or a vector PDF added on a plan of numbered
    // symbols is read like the symbols: the classical pass missed it, which is
    // no reason for its number to go unread — and a number read for it is
    // checked against the rest for duplicates like any other. Only one drawn
    // at the family's size: an addition that is not a symbol of this family
    // has no printed number to look for.
    const side=c=>Math.sqrt(Math.max(0,c.w)*Math.max(0,c.h));
    const familySide=family.length>=3?family.map(side).sort((a,b)=>a-b)[Math.floor(family.length/2)]:null;
    const added=familySide?(analysis.candidates||[]).filter(c=>c.kind==="table"&&c.symbolFamily!==true&&(c.source==="local-model"||c.source==="pdf-vector")
      &&c.status!=="rejected"&&Math.abs(side(c)/familySide-1)<=.35):[];
    const numbered=[...family,...added];
    if(!numbered.length)return;
    let image;
    try{
      image=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});
    }catch{return;}
    const startedAt=Date.now();
    let read;
    try{
      // The number is read INSIDE the ring: where a symbol's drawn edge was
      // measured out to its ring (geometryRefined), the views still look at
      // the fill the detector found — the box they were designed and measured
      // around — never at the ring itself.
      const insideRing=numbered.map(c=>c.geometryRefined?{...c,...c.geometryRefined.from}:c);
      // The model's reading of each symbol, from its plan-wide read: the text
      // whose centre lies in the table's own box, in reading order.
      const om=analysis.ocrModel,modelReadings=new Map();
      if(om&&om.available&&globalThis.MeritPaddleOCR){
        const SW=om.imageSize.width,SH=om.imageSize.height;
        for(const table of insideRing){
          const r=globalThis.MeritPaddleOCR.numberInBox(om.items,{cx:(table.x+table.w/2)/100*SW,cy:(table.y+table.h/2)/100*SH,w:table.w/100*SW,h:table.h/100*SH});
          if(r)modelReadings.set(table.id,{...r,provider:om.provider.id});
        }
      }
      // On the crop workers when there are several, a few tables per worker in
      // flight; the answer does not depend on the order (readTableNumbers).
      const crops=globalThis.MeritPlanOCRCrops;
      read=await globalThis.MeritTableNumbers.readTableNumbers(REFINE.stoppableCropReader(signal),globalThis.MeritLabelOCR,image,insideRing,{
        modelReadings,concurrency:crops?2*crops.workers():1,
        onProgress:(done,total)=>{
          ui.analysisProgress=84+Math.round((done/Math.max(1,total))*10);
        },
      });
    }catch{return;}
    for(const table of numbered){
      const r=read.byId.get(table.id);
      if(!r)continue;
      // The reading travels WITH its evidence. A downstream layer that wants to
      // know whether a number can be trusted must not have to guess.
      table.printedNumber={
        value:r.value,state:r.state,confidence:r.confidence??null,
        suggestion:r.suggestion??null,why:r.why,
        readings:r.readings,source:"OCR of this table's own symbol",
      };
    }
    analysis.diagnostics.printedTableNumbers={
      examined:numbered.length,addedByModel:added.length,...read.counts,views:read.views,ms:Date.now()-startedAt,
    };
    analysis.planIntelligence=buildPlanIntelligence(event,analysis.ocrText??null);
    if(turn)await turn();
    getTEACH().checkNumberIntegrity(event);
  }
    return{analysisCanvasOf,copyRead,planTextPrefetch,readPlanTextWithModel,readPrintedTableNumbers,startPlanTextPrefetch,takePlanTextPrefetch};
  }
  globalThis.MeritPlanTextIntake=Object.freeze({create,DEPS:Object.freeze(["ANALYSIS_MAX_SIDE","REFINE","RULES","buildPlanIntelligence","getPrefetchStoppedSrc","getTEACH","runPlanOCR","sourceBlob","ui"])});
})();
