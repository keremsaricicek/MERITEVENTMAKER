// Assisted Detection's refinement stages, run by the analysis after the
// classical pipeline (src/plan-detection-classical.js) has proposed its
// candidates: the visual second opinion (it never deletes a candidate), the
// text false-positive filter (real evidence, not a raised threshold), naming
// an object from the word the drawing prints on it, holding back two tables
// that stand in one place, the venue elements the drawing names, which way
// each chair faces, and "find more like this". Moved out of app-v8.js on
// 2026-11-08 (code health, capability 14 of 21,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs; every section comment travelled with its
// code. This is classical computer vision — "Assisted Detection", never "AI";
// it fabricates no detection, confidence or metric, and the moved code is
// gated on `node benchmarks/detector-fingerprint.mjs --compare` (every plan
// IDENTICAL) as well as the full suite.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let analysisCanvasOf;
  let applyPlanMemory;
  let audit;
  let buildPlanIntelligence;
  let canMutate;
  let recomputePlanIntelligence;
  let render;
  let t;
  let toast;
  let toastAction;
  let touchEvent;
  let uid;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritPlanDetectionRefine.create() is called once, by app-v8.js.");
    created=true;
    analysisCanvasOf=deps.analysisCanvasOf;
    applyPlanMemory=deps.applyPlanMemory;
    audit=deps.audit;
    buildPlanIntelligence=deps.buildPlanIntelligence;
    canMutate=deps.canMutate;
    recomputePlanIntelligence=deps.recomputePlanIntelligence;
    render=deps.render;
    t=deps.t;
    toast=deps.toast;
    toastAction=deps.toastAction;
    touchEvent=deps.touchEvent;
    uid=deps.uid;
  // ---- the visual second opinion -------------------------------------------
  //
  // The learned encoder answers "does this crop look like the things we know
  // are real on this plan?" — a question the classical pipeline never asks,
  // because every stage of it reasons about geometry, size families and
  // adjacency instead of appearance.
  //
  // IT NEVER DELETES A CANDIDATE. That is measured, not cautious:
  // benchmarks/embedding/measure-separation.mjs simulated six suppression
  // rules against ground truth on the renderings where the detector invents
  // most, and every rule that removed a meaningful number of false tables also
  // removed real ones on at least one rendering. On `jpeg-q20` the channel
  // inverts outright — real tables score BELOW invented ones — so a rule tuned
  // on the others deletes real furniture there. A missed table costs an
  // operator more than an extra one they can reject in a click, so detector
  // fusion did not earn promotion and is not wired. The opinion is recorded as
  // evidence for the review queue and the contradiction engine to weigh.
  //
  // REFERENCES ARE TIERED and the tier travels with every answer, because
  // where the references came from is the whole question (§13). A plan on
  // which nobody has decided anything yet can only compare against the
  // detector's own better-corroborated guesses, and it says exactly that
  // rather than presenting the result as verified knowledge.
  const VISUAL_REF_MIN_AGREEMENT=.6,VISUAL_REF_MIN_CONFIDENCE=.6;
  function visualClassOf(c){return c.kind==="table"?"table":`${c.kind}:${c.type||"other"}`;}
  function buildVisualReferences(candidates,memoryByCandidate,seatVectors){
    const refs=[],qualifiedTables=new Set();
    for(const c of candidates){
      const vector=c.visualDescriptor?.vector;
      if(!vector||c.status==="rejected")continue;
      const m=memoryByCandidate.get(c.id);
      let tier=null;
      if(m){
        if(m.status==="rejected")continue; // a human said this is not an object; it is not a reference for anything
        tier=(m.status==="confirmed"||m.manual)?"verified":"memory";
      }else{
        // The detector's own guess, admitted only when a DIFFERENT stage of
        // the pipeline corroborates it: seats found by the chair pass, or a
        // repeated size family. A candidate whose only support is the same
        // reasoning we are about to second-guess is not a reference.
        const corroborated=c.kind==="table"
          ?(c.chairDetections?.length||0)>0&&(c.evidence?.sizeAgreement||0)>=VISUAL_REF_MIN_AGREEMENT
          :(c.confidence||0)>=VISUAL_REF_MIN_CONFIDENCE;
        if(corroborated)tier="provisional";
      }
      if(!tier)continue;
      refs.push({id:c.id,tier,vector,cls:visualClassOf(c)});
      if(c.kind==="table")qualifiedTables.add(c.id);
    }
    // A seat is a reference only if the table it was attached to is one. A
    // ring of marks around an invented table teaches nothing about chairs.
    for(const[chairId,rec]of seatVectors||[]){
      if(!qualifiedTables.has(rec.tableId))continue;
      refs.push({id:chairId,tier:"provisional",vector:rec.vector,cls:"venue:chair"});
    }
    return refs;
  }
  function applyVisualSecondOpinion(candidates,memoryByCandidate,seatVectors){
    const api=globalThis.MeritVisualSecondOpinion;
    if(!api?.build)return{available:false,reason:"visual second opinion module not loaded"};
    const refs=buildVisualReferences(candidates,memoryByCandidate,seatVectors);
    const library=api.build(refs);
    if(!library.referenceCount)
      return{available:false,reason:`no class reached ${api.minReferencesPerClass} trusted references`,
        referencesConsidered:refs.length};
    const answers=library.assessMany(candidates.map(c=>({
      id:c.id,vector:c.visualDescriptor?.vector||null,cvClass:visualClassOf(c)})));
    const agreement={agree:0,disagree:0},strength={strong:0,moderate:0,weak:0,unknown:0};
    let assessed=0;
    answers.forEach((a,i)=>{
      if(!a){delete candidates[i].visualEvidence;return;}
      candidates[i].visualEvidence=a;assessed++;
      agreement[a.agreement]=(agreement[a.agreement]||0)+1;
      strength[a.strength]=(strength[a.strength]||0)+1;
    });
    return{available:true,references:library.referenceCount,classes:library.classes,
      tiers:library.tiers,bestTier:library.bestTier,assessed,agreement,strength,
      // Recorded so nothing downstream can quietly start treating this as a
      // filter. Suppression was measured and refused.
      role:"evidence-only",suppresses:false};
  }
  // ---- what the drawing itself says under a word ---------------------------
  //
  // PRINTING IS STROKES; A SEAT IS AN AREA, AND IT STANDS AT A TABLE. OCR on
  // a degraded rendering reads junk off solid fills -- "KID", "ihn", "BE",
  // Tesseract confidence 15-49 -- and the text rule deleted the chairs it
  // covered: 25 real armchairs on the jpeg-q20 rendering of the Golden plan,
  // standalone primary-family seats with no adjacency to protect them.
  //
  // Two facts of the drawing say such a seat is not printing. It is a FILLED
  // REGION: the share of its box that is ink off every edge (luma below paper
  // - 12, local step below 12) is 0.58-0.68 on those chairs and 0.00-0.03 on
  // printed letters, and the bound sits between, not at either one. And it
  // STANDS AGAINST A TABLE, at the distance the tables stage already calls
  // "seated against" (a gap within 0.35 of the seat's long side). Area alone
  // was measured and refused: it kept the bold capacity lettering of the
  // greyscale rendering (area 0.34-0.49, 69-215 px from any table) and 17
  // filled label squares on the large-venue fixture (38 px, the seats' own
  // size, 40 px from the nearest table). Neither stands at a table.
  //
  // TABLES ARE NOT EXEMPTED, and that is measured, not cautious. Junk words
  // also delete real chairless tables (bistro B01/B05, 9 on a2, 8 on a4, 6 on
  // a7), and they also hide false solid ones that a confidence floor would
  // hand back. Some of those are ATTACHED -- Golden's grey equipment boxes,
  // the wall blocks and bar end of jpeg-q20, JPEG fragments of real tables:
  // an edge line runs on as ink past one end (0.98-1.00, real chairless
  // tables 0.26-0.27). But the architecture fixture's plinths and mullions
  // (a6) are filled, free-standing, chairless and junk-covered exactly like
  // the real ones; colour against the plan's seated tables, seat adjacency and
  // word confidence were each measured and none separates them (a6's seated
  // tables are mostly its plinths; its junk reads 0-40 like a2's). Exempting
  // tables offered 17 phantom tables there. Until something separates them,
  // the words decide for tables as before.
  const DRAWN_AREA_MIN=.3,SEATED_GAP_OF_LONG_SIDE=.35;
  function drawnEvidence(pixels,width,height){
    const d=pixels.data,lumaAt=i=>(d[4*i]*299+d[4*i+1]*587+d[4*i+2]*114)/1000;
    const hist=new Uint32Array(256);let n=0;
    for(let y=0;y<height;y+=4)for(let x=0;x<width;x+=4){hist[Math.min(255,Math.round(lumaAt(y*width+x)))]++;n++;}
    let paper=255;for(let v=0,seen=0;v<256;v++){seen+=hist[v];if(seen>=.98*n){paper=v;break;}}
    const pxBox=c=>{const x0=Math.max(0,Math.floor(c.x/100*width)),y0=Math.max(0,Math.floor(c.y/100*height));
      return{x0,y0,x1:Math.min(width,Math.max(x0+1,Math.floor((c.x+c.w)/100*width))),y1:Math.min(height,Math.max(y0+1,Math.floor((c.y+c.h)/100*height)))};};
    const areaShare=c=>{
      const{x0,y0,x1,y1}=pxBox(c);let on=0,tot=0;
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
        tot++;const i=y*width+x,v=lumaAt(i);if(v>=paper-12)continue;
        const gx=x>0&&x<width-1?Math.abs(lumaAt(i+1)-lumaAt(i-1))/2:0;
        const gy=y>0&&y<height-1?Math.abs(lumaAt(i+width)-lumaAt(i-width))/2:0;
        if(Math.max(gx,gy)<12)on++;
      }
      return tot?on/tot:0;
    };
    return{areaShare};
  }
  // ---- False-positive filtering, real evidence rather than a raised
  // threshold: capacity text ("114 pax seating"), dimension labels, and other
  // printed annotations get picked up by the classical binarization pass the
  // same as real furniture. Real OCR word boxes (from the same canvas the
  // detector ran on, so same pixel space) tell candidates and printed text
  // apart directly — a candidate whose area is dominated by recognized text
  // is dropped outright, UNLESS it has real seat adjacency (nearby chair
  // detections), which is strong counter-evidence it's an actual table.
  function suppressTextFalsePositives(candidates,words,width,height,pixels){
    const wordBoxesPct=(words||[]).filter(w=>w.text?.trim().length&&w.bbox).map(w=>({
      x:w.bbox.x0/width*100,y:w.bbox.y0/height*100,
      w:(w.bbox.x1-w.bbox.x0)/width*100,h:(w.bbox.y1-w.bbox.y0)/height*100,
    }));
    if(!wordBoxesPct.length)return{kept:candidates,removedCount:0,removed:[],keptAsDrawn:0};
    // The analysis's own pixels or none: a raster of another size would put
    // every box somewhere else.
    let look=null;
    const drawn=()=>look||(look=drawnEvidence(pixels,width,height));
    const canLook=!!(pixels&&pixels.data&&pixels.width===width&&pixels.height===height);
    // In pixels, so a plan's aspect does not stretch the gap.
    const gapPx=(a,b)=>Math.max(0,a.x-(b.x+b.w),b.x-(a.x+a.w))/100*width+Math.max(0,a.y-(b.y+b.h),b.y-(a.y+a.h))/100*height;
    const tables=candidates.filter(t=>t.kind==="table");
    const atATable=c=>{const long=Math.max(c.w/100*width,c.h/100*height);
      return tables.some(t=>gapPx(c,t)<=long*SEATED_GAP_OF_LONG_SIDE);};
    let keptAsDrawn=0;
    const overlapArea=(a,b)=>{
      const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y),x2=Math.min(a.x+a.w,b.x+b.w),y2=Math.min(a.y+a.h,b.y+b.h);
      return Math.max(0,x2-x1)*Math.max(0,y2-y1);
    };
    // What it removed, not only how many. A candidate deleted here is not
    // thereby proved to be text: measured on the Golden Plan, four junk tokens
    // ("EE", "N", "L", "NR") cover 82.7% of the drawing's real stage band and
    // delete it. The stage-label pass reads the drawing's own word for an
    // object from its own crop, and it cannot look at geometry that has already
    // been thrown away. Nothing comes back unless the drawing names it.
    const kept=[],removed=[];let removedCount=0;
    for(const c of candidates){
      const cArea=Math.max(.0001,c.w*c.h);
      let textArea=0;for(const wb of wordBoxesPct)textArea+=overlapArea(c,wb);
      const overlapRatio=Math.min(1,textArea/cArea),hasChairs=(c.chairDetections?.length||0)>0;
      // "It has chairs at it, so it is a real table and not printed text" is a
      // good exemption on a plan that draws chairs. On a plan whose tables are
      // numbered symbols it is unavailable BY CONSTRUCTION — no table there
      // has a chair — and this rule then deleted 117 of ORNEK's 132 tables,
      // because a table on that plan is a circle with a printed number inside
      // it and OCR of a photographed printout throws big, sloppy word boxes
      // across whole rows of them.
      //
      // It only ever happened with OCR running, so the benchmark never saw it:
      // this sandbox has no network, the CDN build silently has no OCR, and
      // the offline package — the one that actually ships with Tesseract —
      // was the broken one.
      //
      // A candidate that is one of a hundred-odd identical, regularly spaced
      // symbols is not printed text, whatever overlaps it. The evidence that
      // made it a table is the same evidence that protects it here.
      const isSymbol=c.symbolFamily===true;
      // And a column is not printed text either, for the same reason and by the
      // same argument. The column pass admits an object only on STRUCTURAL
      // evidence: repeated, compact, seatless, made of no table material, and
      // standing on a grid that is aligned in TWO directions. A word is aligned
      // in one. So the evidence that made it a column is precisely the evidence
      // that rules out text, and letting an overlapping word delete it throws
      // away the stronger finding for the weaker one.
      //
      // Measured on the adversarial architecture fixture with OCR live: without
      // this, 3 of its 6 exact columns were removed and the survivors were left
      // on a single axis -- the detector's own answer reduced to the very shape
      // it exists to reject. This exemption can only ever KEEP an object, so it
      // cannot move a table or chair number on either real plan.
      const isStructural=c.kind==="venue"&&c.type==="column";
      // AND A TABLE THE LOCAL MODEL ADDED, CONFIDENTLY AND AT THE SIZE THE
      // PLAN'S TABLES ARE DRAWN AT (fusion selects only those), is not printed
      // text: it exists only where the classical pass proposed nothing, and the
      // model reads shapes, not glyphs. Measured on the darkened rendering of
      // the Golden plan (benchmarks/robustness, bright-down, 2026-10-17): 14 of
      // the 16 real tables the model added were deleted here by word boxes
      // Tesseract read off the darkened table fills.
      const isModelTable=c.kind==="table"&&c.source==="local-model"&&c.selected===true&&c.evidence?.consistentSize===true;
      // AND A MEMBER OF AN ADMITTED SEAT FAMILY IS NOT PRINTED TEXT EITHER,
      // for the third time and by the same argument.
      //
      // The two exemptions above were written when a plan was one thing or the
      // other: a symbolic sheet has symbols and columns, a drawn sheet has
      // tables with chairs at them. A sheet that is symbolic in one hall and
      // drawn in another has a third kind of object — a DRAWN SEAT standing on
      // its own, because its table was not detected — and it qualifies for
      // none of them. `hasChairs` is false (a chair has no chairs),
      // `symbolFamily` is false (it is a real seat, not a symbol) and it is
      // not a column. So the text filter deleted every one of them.
      //
      // Measured on `a9-mixed-representation`, and only on CI, because this
      // sandbox has no network and Tesseract loads from a CDN: identical to
      // the local run through the whole detector — `keptDrawnSeats: 24` — and
      // then 0 chair objects in the result. The one environment where OCR
      // actually runs is the one where the whole terrace disappears.
      //
      // The exemption is the family's own admission evidence, which is
      // precisely the evidence a run of glyphs cannot produce: four or more
      // members at ONE repeated size and ONE repeated shape, at least 70% of
      // them against a surface broad enough to be a table, and standing clear
      // of the plan's primary family. `plan-detection-classical.js` says it
      // where the family is admitted — "a run of printed glyphs still fails,
      // now for the reason it should: it never becomes a family".
      //
      // Deliberately NOT extended to the primary family. An unassociated
      // primary-family chair really can be an OCR'd glyph — that is the
      // `a5-architecture-only` phantom-chair case — and it has no adjacency
      // evidence behind it. Like the column exemption, this can only ever KEEP
      // an object, and it is inert on a plan with no admitted second family,
      // so neither real plan can move on it.
      const isDrawnSeat=c.kind==="venue"&&c.type==="chair"
        &&!!c.seatFamily&&c.seatFamily!=="primary";
      const accused=overlapRatio>.4&&!hasChairs&&!isSymbol&&!isStructural&&!isDrawnSeat&&!isModelTable;
      // Asked only of a SEAT the words accuse (see drawnEvidence): a filled
      // region standing at a table is not printing. Tables: the words decide.
      const isSeat=c.kind==="venue"&&c.type==="chair";
      const drawnSeat=accused&&isSeat&&canLook&&atATable(c)&&drawn().areaShare(c)>=DRAWN_AREA_MIN;
      if(drawnSeat)keptAsDrawn++;
      if(accused&&!drawnSeat){removedCount++;removed.push(c);}else{kept.push(c);}
    }
    return{kept,removedCount,removed,keptAsDrawn};
  }
  // ---- naming an object from the word the drawing prints on it -------------
  //
  // Phase 6 stopped typing a venue object `stage` from its aspect ratio.
  // Measured across both real plans that rule named 8 objects and 6 of them
  // were wrong, with the 2 right ones sitting inside the range of the 6 wrong
  // ones — no threshold could separate them. Removing it cost the Golden Plan
  // its one real stage, and that cost was recorded rather than hidden.
  //
  // This is the corroboration that replaces the guess: the drawing's own word.
  // It needs no threshold at all, because it is not a measurement of shape —
  // either the label is printed on the object or it is not.
  //
  // Why it needs a crop rather than the full-page OCR already in hand: the
  // full-page pass runs on a canvas capped at 1920 and, on the Golden Plan,
  // returns 53 tokens of noise with no SAHNE among them. The same engine on a
  // crop of that one band reads SAHNE at confidence 96. The detector already
  // knows where its objects are; that is the whole advantage being used here.
  //
  // Measured over every band-shaped object on both real plans:
  //
  //   merit-real-venue  annotated stage            SAHNE, confidence 96
  //                     annotated stage extension  nothing  (unlabelled)
  //                     other shape-only band      nothing
  //   ornek-symbolic    all six bands              nothing
  //
  // 1 of 2 real stages, 0 of 7 everything else. The ORNEK result is the strong
  // half: those crops are NOT unreadable — they return "SILA 29.08.2026",
  // "Haluk Elver Salonu 1/2/3", "SALON 1166 * 12:1992 PAX". OCR worked on them
  // and they simply are not stages. A silent engine would prove nothing; a
  // talking engine that never says "stage" proves the rule.
  //
  // The unlabelled stage extension stays UNKNOWN. That is the honest outcome
  // and the point of the design: an object is named when the drawing names it,
  // and otherwise it keeps its geometry and loses only its label.
  const LABELLED_VENUE_TYPES=[
    {type:"stage",vocabulary:["SAHNE","STAGE","PODYUM","PLATFORM","SCENE","BUHNE"]},
  ];
  // OCR of a crop costs a full engine round-trip, so the pass is bounded. Bands
  // are the only shape a stage is ever drawn as, and a plan with dozens of them
  // is a plan whose bands mean something else.
  const MAX_LABEL_CANDIDATES=14;
  // A crop reader that stops asking once the analysis is stopped: the readers
  // still queued answer "unavailable" at once instead of starting the engine
  // again after the operator pressed Stop.
  function stoppableCropReader(signal){
    const read=globalThis.MeritPlanOCRCrops?globalThis.MeritPlanOCRCrops.read:globalThis.runPlanOCR;
    return(src,o)=>signal?.aborted?Promise.resolve({available:false,text:null,reason:"analysis stopped",reasonCode:"CANCELLED"}):read(src,o);
  }
  async function identifyLabelledVenueObjects(event,suppressedByText,signal=null){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritLabelOCR||typeof globalThis.runPlanOCR!=="function")return;
    if(!analysis.ocr?.available)return;
    const src=event.background?.src;
    if(!src)return;
    // Only objects nothing else has explained: shape-only venue proposals, plus
    // geometry text suppression removed. The second half is what makes this
    // work at all on the Golden Plan, where the stage is deleted before it can
    // be named — by four junk tokens covering 82.7% of it.
    const shapeOnly=(analysis.candidates||[]).filter(c=>c.kind==="venue"&&c.typeBasis==="aspectRatio");
    const pool=[...shapeOnly.map(c=>({box:c,fromSuppressed:false})),
      ...(suppressedByText||[]).map(c=>({box:c,fromSuppressed:true}))]
      .filter(e=>{
        const aspect=Math.max(e.box.w,e.box.h)/Math.max(.0001,Math.min(e.box.w,e.box.h));
        return aspect>=2;
      })
      .sort((a,b)=>(b.box.w*b.box.h)-(a.box.w*a.box.h))
      .slice(0,MAX_LABEL_CANDIDATES);
    if(!pool.length)return;
    let image;
    try{
      image=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});
    }catch{return;}
    const identified=[],attempts=[];
    // Every object's crops are read at once, on the crop workers when there are
    // several (MeritPlanOCRCrops); each object's answer is then taken in the
    // order above, exactly as when they were read one after another.
    const readCrop=stoppableCropReader(signal);
    // Each object's crops are cut in a task of their own (a turn for the page
    // between them): cut all at once, a dense plan's bands held it for 0.7 s.
    // EXPECTED ABSTENTION: an object whose crop cannot be read stays unnamed,
    // as it did when the read was awaited in the loop.
    const readings=await Promise.all(pool.map(entry=>Promise.all(LABELLED_VENUE_TYPES.map(spec=>
      new Promise(r=>setTimeout(r,0)).then(()=>globalThis.MeritLabelOCR.readLabel(readCrop,image,entry.box,spec.vocabulary,{timeoutMs:20000})).catch(()=>null)))));
    for(const [entryIndex,entry] of pool.entries()){
      for(const [specIndex,spec] of LABELLED_VENUE_TYPES.entries()){
        const reading=readings[entryIndex][specIndex];
        if(!reading)continue;
        attempts.push({type:spec.type,found:reading.found,confidence:reading.confidence,
          fromSuppressed:entry.fromSuppressed});
        if(!reading.found)continue;
        // The drawing named it. A suppressed object comes back ONLY here, and
        // only as the thing the drawing called it.
        const existing=entry.fromSuppressed?null:entry.box;
        const obj=existing||{...entry.box,id:uid("candidate"),kind:"venue",
          status:"unreviewed",selected:false,chairDetections:[]};
        obj.kind="venue";
        obj.type=spec.type;
        obj.typeBasis="printedLabel";
        obj.labelRead={term:reading.term,confidence:reading.confidence,variant:reading.variant,
          source:"OCR of this object's own crop"};
        obj.evidence={...(obj.evidence||{}),
          basis:`the drawing prints "${reading.term}" on this object`};
        if(!existing)analysis.candidates.push(obj);
        identified.push({type:spec.type,term:reading.term,confidence:reading.confidence,
          recoveredFromTextSuppression:entry.fromSuppressed});
        break;
      }
    }
    analysis.diagnostics.labelledVenueObjects={examined:pool.length,identified,attempts:attempts.length};
    if(identified.length)analysis.planIntelligence=buildPlanIntelligence(event,analysis.ocrText??null);
  }
  // ---- two tables cannot stand in one place -----------------------------------
  //
  // Physical tables do not overlap. When two offered tables cover the same
  // floor — a quarter of the smaller one's box or more — one of them is not a
  // table, and the weaker is held back for a person (lowEvidence
  // "overlapsAnotherTable"), never deleted: the piece a blob split produced
  // before a whole one, the lower confidence before the higher. Measured on the
  // Golden Plan: an armchair and half of the table beside it, split out of one
  // blob as a "rectangle table", overlapping that real table by a third.
  // Tables that merely touch (a joined group) overlap by a line, not a quarter.
  function holdBackOverlappingTables(candidates){
    const tables=(candidates||[]).filter(c=>c.kind==="table"&&!c.lowEvidence&&c.selected!==false);
    const inter=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    let held=0;
    for(let i=0;i<tables.length;i++)for(let j=i+1;j<tables.length;j++){
      const a=tables[i],b=tables[j];
      if(a.lowEvidence||b.lowEvidence)continue;
      const share=inter(a,b)/Math.max(1e-9,Math.min(a.w*a.h,b.w*b.h));
      if(share<.25)continue;
      const aSplit=!!a.evidence?.split,bSplit=!!b.evidence?.split;
      const weaker=aSplit!==bSplit?(aSplit?a:b):((a.confidence||0)<=(b.confidence||0)?a:b),stronger=weaker===a?b:a;
      weaker.lowEvidence={reason:"overlapsAnotherTable",with:stronger.id,share:+share.toFixed(2)};
      weaker.selected=false;
      held++;
    }
    // The seats the held-back reading had claimed are still seats. Each goes to
    // the offered table it stands against (the nearest within one chair of its
    // edge), which is where association would have put it without the split;
    // a seat with no such table stays with the held-back reading.
    const offered=(candidates||[]).filter(c=>c.kind==="table"&&!c.lowEvidence&&c.selected!==false);
    const gap=(ch,t)=>Math.max(0,t.x-ch.x,ch.x-(t.x+t.w))+Math.max(0,t.y-ch.y,ch.y-(t.y+t.h));
    let moved=0;
    for(const c of candidates||[]){
      if(c.lowEvidence?.reason!=="overlapsAnotherTable"||!c.chairDetections?.length)continue;
      const keep=[];
      for(const ch of c.chairDetections){
        let best=null,bd=Infinity;
        for(const t of offered){const g=gap(ch,t);if(g<bd){bd=g;best=t;}}
        if(best&&bd<=Math.max(ch.w,ch.h)){
          ch.relation={...(ch.relation||{}),reason:"reassignedFromOverlappingReading",from:c.id};
          (best.chairDetections||(best.chairDetections=[])).push(ch);moved++;
        }else keep.push(ch);
      }
      c.chairDetections=keep;
    }
    return {held,seatsMoved:moved};
  }
  // ---- venue elements the drawing names (src/plan-venue-elements.js) -------
  //
  // SAHNE, BAR, GİRİŞ, ÇIKIŞ printed on the plan become a stage, a bar, an
  // entrance, an exit — offered, because the drawing said so. The extent is the
  // closed area the word sits in when there is one, and the word's own box
  // (geometryBasis "label") when there is not. Readings come from the OCR model
  // (score >= 0.9) and from Tesseract's full-page words (confidence >= 90), each
  // against its own floor — never one scale read as the other.
  //
  // A place a person already ruled on (a candidate from plan memory, or one an
  // operator drew) is left alone: an element is never offered over a decision.
  // `turn` (optional) gives the page a turn between the four reads of the
  // drawing below; on a dense plan they are together a quarter of a second.
  async function placeNamedVenueElements(event,raster,ocrResult,pdfItems=[],turn=null){
    const pause=turn||(async()=>{});
    const analysis=event?.analysis,VE=globalThis.MeritVenueElements;
    if(!analysis||!VE||!raster)return;
    const W=raster.width,H=raster.height,items=[];
    const om=analysis.ocrModel;
    if(om&&om.available&&om.imageSize){
      const sx=W/om.imageSize.width,sy=H/om.imageSize.height;
      for(const it of om.items||[])items.push({text:it.text,score:it.score,engine:om.provider?.id||"ocr-model",
        box:{x0:it.box.x0*sx,y0:it.box.y0*sy,x1:it.box.x1*sx,y1:it.box.y1*sy}});
    }
    const anchors=VE.anchorsFrom(items,0.9);
    // The PDF's own words are exact text in these same pixels (score 1).
    anchors.push(...VE.anchorsFrom(pdfItems,1));
    if(ocrResult?.available)for(const w of ocrResult.words||[]){
      if(!w.bbox||!(w.confidence>=90))continue;
      for(const a of VE.anchorsFrom([{text:w.text,score:1,box:w.bbox}],1))anchors.push({...a,score:w.confidence/100,engine:"tesseract.js"});
    }
    const plans=VE.elementsFrom(raster,anchors,analysis.candidates);
    await pause();
    const decided=(analysis.candidates||[]).filter(c=>c.fromMemory||c.missed||c.status!=="unreviewed");
    const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
    const placed=[];
    for(const p of plans){
      if(!p.keepId&&decided.some(c=>overlaps(c,p.box)))continue;
      const fromPdf=p.anchor.engine==="pdfTextLayer";
      const read={term:p.anchor.term,confidence:fromPdf?null:Math.round(p.anchor.score*100),source:fromPdf?"the PDF's own text":"OCR of the whole plan",engine:p.anchor.engine||null};
      const geometry={x:p.box.x,y:p.box.y,w:p.box.w,h:p.box.h,rotation:0};
      let obj=p.keepId?analysis.candidates.find(c=>c.id===p.keepId):null;
      if(obj)Object.assign(obj,geometry);
      else{obj={id:uid("candidate"),kind:"venue",...geometry,confidence:fromPdf?null:p.anchor.score,status:"unreviewed",chairDetections:[]};analysis.candidates.push(obj);}
      obj.type=p.type;obj.typeBasis="printedLabel";obj.geometryBasis=p.geometryBasis;obj.selected=true;
      obj.labelRead=obj.labelRead||read;obj.labelReadWhole=read;
      obj.evidence={...(obj.evidence||{}),source:obj.evidence?.source||"venue-label",
        basis:`the drawing prints "${p.anchor.term}" here`,
        extent:p.geometryBasis==="region"?"the closed area the label sits in"+(p.mergeIds.length||p.keepId?", joined with the parts of it already found":"")
          :p.geometryBasis==="structure"?"the filled counter drawn around the label":"not measured: the label's own box"};
      if(p.mergeIds.length){const drop=new Set(p.mergeIds);analysis.candidates=analysis.candidates.filter(c=>!drop.has(c.id));}
      placed.push({type:p.type,term:p.anchor.term,geometryBasis:p.geometryBasis,joined:p.mergeIds.length+(p.keepId?1:0)});
    }
    // Families the drawing repeats: columns threaded on its walls, and the row
    // of loca cells a printed loca title labels. A shape-only proposal the
    // detector already made at the same place is that element (kept, retyped),
    // never a second object beside it.
    const share=(a,b)=>{const ix=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)),iy=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return ix*iy/Math.max(1e-9,Math.min(a.w*a.h,b.w*b.h));};
    const claimed=new Set();
    const offerFamilyMember=(type,box,fields)=>{
      const geometry={x:box.x,y:box.y,w:box.w,h:box.h,rotation:0};
      let obj=(analysis.candidates||[]).find(c=>c.kind==="venue"&&c.status==="unreviewed"&&!c.fromMemory&&!c.missed&&c.typeBasis!=="printedLabel"&&!claimed.has(c.id)&&share(c,geometry)>=.5);
      if(!obj&&decided.some(c=>overlaps(c,geometry)))return false;
      const reused=!!obj;
      if(!obj){obj={id:uid("candidate"),kind:"venue",status:"unreviewed",chairDetections:[]};analysis.candidates.push(obj);}
      claimed.add(obj.id);placedIds.add(obj.id);
      // An object the detector had already named THIS type keeps its own
      // reasoning (a column the grid pass admitted says why); the family's
      // evidence is added beside it, never written over it.
      const keepOwn=reused&&obj.type===type&&obj.evidence;
      const{evidence,...rest}=fields;
      Object.assign(obj,geometry,{type,selected:true,geometryBasis:"region"},rest);
      obj.evidence=keepOwn?{...obj.evidence,also:evidence}:evidence;
      return true;
    };
    const placedIds=new Set(plans.map(p=>p.keepId).filter(Boolean));
    for(const c of analysis.candidates)if(c.typeBasis==="printedLabel"&&c.labelReadWhole)placedIds.add(c.id);
    let columns=0,locas=0;
    await pause();
    for(const m of VE.columnFamilies(raster,analysis.candidates))
      if(offerFamilyMember("column",m.box,{confidence:m.wall,typeBasis:"wallFamily",
        evidence:{source:"column-family",basis:`one of ${m.familySize} identical solid blocks set into the walls`,wallThrough:m.wall,extent:"the block's own filled area"}}))columns++;
    await pause();
    for(const m of VE.locaRows(raster,anchors))
      if(offerFamilyMember("loca",m.box,{confidence:m.titleScore,typeBasis:"printedTitle",seatsUnknown:true,
        evidence:{source:"loca-row",basis:`one of ${m.rowSize} like cells in the row the drawing titles "${m.title}"`,extent:"the cell's own closed area",seats:"not printed per cell"}}))locas++;
    // Banquettes: long benches in the seats' own measured colour, against an
    // offered table. Seat count unknown, and said so (UNVERIFIED_SEATING).
    const offeredTables=analysis.candidates.filter(c=>c.kind==="table"&&c.status!=="rejected"&&c.selected!==false);
    const seatsSeen=offeredTables.flatMap(c=>(c.chairDetections||[]).map(ch=>({x:ch.x,y:ch.y,w:ch.w,h:ch.h})));
    await pause();
    const bench=VE.banquettes(raster,seatsSeen,offeredTables);
    let benches=0;
    for(const m of bench.found)
      if(offerFamilyMember("banquette",m.box,{confidence:null,typeBasis:"seatColourBench",seatsUnknown:true,
        evidence:{source:"seat-colour-bench",basis:"a solid bench in the seats' own colour, standing against a table",lengthInChairs:m.lengthInChairs,againstTables:m.againstTables,extent:"the bench's own filled area",seats:"not drawn: no divisions to count"}}))benches++;
    // These elements were placed AFTER plan memory ran, at their own
    // geometry: a decision a person made about one of them on an earlier run
    // is found again here, by the same identity rules, and stands.
    const fresh=analysis.candidates.filter(c=>placedIds.has(c.id)&&!c.fromMemory);
    const remembered=fresh.length&&(event.planMemory||[]).length?applyPlanMemory(fresh,event.planMemory).reappliedCount:0;
    analysis.diagnostics.namedVenueElements={anchors:anchors.length,placed,columns,locas,banquettes:benches,seatColour:bench.seatColour,memoryReapplied:remembered};
  }
  // ---- which way each chair faces, from its own stencil ---------------------
  //
  // src/plan-chair-facing.js reads a family's backrest off its averaged
  // stencil. That is now the ONLY way a facing is stated: the per-chair
  // ink-centroid rule it replaces was measured at 13 right of 19 stated on the
  // Golden Plan, below what a stated direction must be, so a chair the stencil
  // reading cannot settle says so (facingKnown false) instead.
  async function readChairFacing(event,raster,pause){
    const analysis=event?.analysis,F=globalThis.MeritChairFacing;
    if(!analysis||!F||!raster)return;
    const W=raster.width,H=raster.height,chairs=[],byId=new Map(),tableOf=new Map();
    for(const c of analysis.candidates||[]){
      if(c.kind!=="table")continue;
      for(const ch of c.chairDetections||[]){
        chairs.push({id:ch.id,cx:ch.x/100*W,cy:ch.y/100*H,w:ch.w/100*W,h:ch.h/100*H,rotation:ch.rotation||0});
        byId.set(ch.id,ch);tableOf.set(ch.id,c);
      }
    }
    // Sliced: on a plan with a hundred armchairs the read is ~0.3 s of work,
    // and the page gets a turn every ~40 ms of it. Same answer (chair-facing).
    const read=pause&&F.readFacingSliced?await F.readFacingSliced(raster,chairs,undefined,pause):F.readFacing(raster,chairs);
    let againstN=0,paper=null;
    for(const [id,ch] of byId){
      const rel=ch.relation||(ch.relation={}),o=rel.orientation||(rel.orientation={});
      const f=read.byId.get(id);
      if(f){o.facingKnown=true;o.facingAngle=f.facingAngle;o.facingEvidence=f.evidence;o.facingStencil={family:f.family,map:f.map,margin:f.margin};continue;}
      delete o.facingStencil;
      // not read from the stencil: a chair whose ink runs into its own table's drawn edge, and whose far side shows a backrest, faces it (D10)
      const box={cx:ch.x/100*W,cy:ch.y/100*H,w:ch.w/100*W,h:ch.h/100*H,rotation:ch.rotation||0};
      const t=tableOf.get(id),against=t&&F.againstFacing?F.againstFacing(raster,box,
        {cx:(t.x+t.w/2)/100*W,cy:(t.y+t.h/2)/100*H,w:t.w/100*W,h:t.h/100*H,rotation:t.rotation||0,type:t.type},paper??(paper=F.paperLevel(raster))):null;
      if(against&&F.backrestAway(raster,box,against.facingAngle)){o.facingKnown=true;o.facingAngle=against.facingAngle;o.facingEvidence=against.evidence;againstN++;}
      else{o.facingKnown=false;o.facingAngle=null;o.facingEvidence="stencilNotRead";}
    }
    analysis.diagnostics.chairFacing={chairs:chairs.length,stated:read.byId.size+againstN,fromStencil:read.byId.size,drawnAgainstTable:againstN,families:read.families};
  }
  // ---- the number printed inside each table symbol -------------------------
  //
  // Only for plans whose tables ARE numbered symbols. That is not a guess: the
  // representation decision has already established it, and each promoted table
  // carries `symbolFamily`. On a plan that draws furniture the tables are
  // identified by where they sit, the symbols carry no printed number, and this
  // pass would spend engine time to read nothing — so it does not run.
  //
  // The cost is real and worth stating: 163 symbols at two crops each is about
  // 9 seconds on top of detection. See src/plan-table-numbers.js for why two
  // crops rather than one, and why a montage was measured and abandoned.
  // One plan-wide read by the OCR model, stored with the analysis: the
  // provider that ran (or why none did), its timings, and every line it read
  // with its box in SOURCE pixels and its own score.
  // ---- "find more like this" (L3, 2026-10-18) ------------------------------
  // A person confirmed an object; its own pixels are the template
  // (MeritPlanExemplar, normalised cross-correlation at the four quarter
  // turns), searched on the analysis canvas the candidates are drawn in. What
  // comes back is a SUGGESTION: an unreviewed candidate of the same kind and
  // type, never selected, each decided by a person like any other. One
  // example, because that is the setting measured without phantoms (0 per 100
  // objects, 47 % of the missed tables recovered over the Golden Plan's
  // renderings; several examples are combined by agreement, searchMany).
  // Places the analysis already holds are excluded. Undo removes the
  // suggestions still unreviewed.
  async function findSimilar(event,c){
    if(!canMutate(event,"find similar objects"))return;
    const a=event.analysis,src=event.background?.src;
    if(!a||!src||!globalThis.MeritPlanExemplar||c.status!=="confirmed")return;
    let canvas,W,H;
    try{({canvas,width:W,height:H}=await analysisCanvasOf(src));}catch{return toast(t("plan.unreadableImage"),"error",6500);}
    const d=canvas.getContext("2d",{willReadFrequently:true}).getImageData(0,0,W,H).data,grey=new Float32Array(W*H);
    for(let i=0,j=0;i<grey.length;i++,j+=4)grey[i]=.299*d[j]+.587*d[j+1]+.114*d[j+2];
    const px=o=>({x:o.x/100*W,y:o.y/100*H,w:o.w/100*W,h:o.h/100*H});
    const known=a.candidates.filter(x=>x.status!=="rejected"&&x.id!==c.id).map(px);
    const found=globalThis.MeritPlanExemplar.searchMany(grey,W,H,[px(c)],{exclude:known});
    if(event.analysis!==a)return; // a re-analysis started meanwhile: this answer is about another one
    const added=found.map(f=>({id:uid("candidate"),kind:c.kind,type:c.type,x:f.x/W*100,y:f.y/H*100,w:f.w/W*100,h:f.h/H*100,rotation:0,
      confidence:Math.min(f.score,.7),status:"unreviewed",selected:false,source:"exemplar",exemplarOf:c.id,chairDetections:[],
      evidence:{geometry:"exemplar",basis:"resemblesConfirmed",resembles:c.id,matchScore:f.score,extent:"the confirmed object's own size"}}));
    if(!added.length)return toast(t("review.similarNone"),"info",5000);
    a.candidates.push(...added);
    audit(event,"EXEMPLAR_SUGGESTIONS_ADDED",{from:c.id,count:added.length});
    recomputePlanIntelligence(event);touchEvent(event);render();
    const ids=new Set(added.map(x=>x.id));
    toastAction(t("review.similarFound",{n:added.length}),t("teachArea.undo"),()=>{
      if(!canMutate(event,"undo suggestions")||event.analysis!==a)return;
      a.candidates=a.candidates.filter(x=>!(ids.has(x.id)&&x.status==="unreviewed"));
      recomputePlanIntelligence(event);touchEvent(event);render();
    },"success",8000);
  }
    return{applyVisualSecondOpinion,findSimilar,holdBackOverlappingTables,identifyLabelledVenueObjects,placeNamedVenueElements,readChairFacing,stoppableCropReader,suppressTextFalsePositives};
  }
  globalThis.MeritPlanDetectionRefine=Object.freeze({create,DEPS:Object.freeze(["analysisCanvasOf","applyPlanMemory","audit","buildPlanIntelligence","canMutate","recomputePlanIntelligence","render","t","toast","toastAction","touchEvent","uid"])});
})();
