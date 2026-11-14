// What the plan remembers and what a person's decision captures: the visual
// embedding provider (classical, deterministic descriptors — not a trained
// model), plan memory (an earlier human decision re-applied to the same object
// of the same plan, matched by geometry within a size-scaled tolerance), and
// training-data capture (every human decision stores the real crop with full
// provenance; capturing trains nothing). Moved out of app-v8.js on 2026-11-08
// (code health, capability 13 of 21, benchmarks/CODE-HEALTH-2026-11.md), at
// the original indentation, by scripts/extract-capability.mjs; the section
// comments travelled with the code. The edits forced by the move: `state` and
// the retracted-decision set are read through getters (the shell reassigns
// both); MeritTrainingData and MeritVisualEmbedding through globalThis.
// Memory is per plan: no object position ever leaks from another event.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let getRetractedDecisions;
  let getState;
  let nowISO;
  let saveState;
  let storageProvider;
  let t;
  let toast;
  let uid;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritPlanLearning.create() is called once, by app-v8.js.");
    created=true;
    getRetractedDecisions=deps.getRetractedDecisions;
    getState=deps.getState;
    nowISO=deps.nowISO;
    saveState=deps.saveState;
    storageProvider=deps.storageProvider;
    t=deps.t;
    toast=deps.toast;
    uid=deps.uid;
  // ============================================================
  // VisualEmbeddingProvider (classical/deterministic implementation).
  //
  // Real visual similarity requires real pixel information, not just a
  // bounding box's area/aspect ratio. A real trained embedding model
  // (ONNX Runtime Web + a pretrained vision model such as MobileNetV2) was
  // evaluated for this: onnxruntime-web is on the npm registry and a real
  // ~14MB MobileNetV2 ONNX model IS fetchable in this environment via
  // media.githubusercontent.com (verified, not assumed) -- so bundling one is
  // technically possible. It was deprioritized for this pass in favor of the
  // explicitly higher-priority full-app visual redesign later in this same
  // sprint, not because it's infeasible; a future pass can wire a real
  // embedding model in as an alternate implementation of this exact function
  // signature (candidate pixels in, fixed-shape numeric descriptor out)
  // without touching plan-intelligence.js's clustering logic at all.
  //
  // This implementation instead computes a real, deterministic descriptor
  // straight from the actual decoded plan pixels already in memory from
  // detection (no synthetic/fabricated numbers): interior fill ratio (shape
  // occupancy), edge density (a Sobel-style gradient magnitude average,
  // texture/outline signal), an 8-bin grayscale intensity histogram (coarse
  // color/tone distribution), and a 4-quadrant fill balance (a cheap contour/
  // shape signature that tells a round table's radial fill apart from an
  // L-shaped or off-center one). This is real pixel-derived signal, honestly
  // labeled as classical/deterministic -- never described as a trained model.
  // ---- VisualEmbeddingProvider (Gate G) --------------------------------
  //
  // The boundary a real learned embedding model would plug into, so that
  // swapping one in is a provider registration rather than a rewrite of the
  // similarity clustering.
  //
  // Exactly one provider is installed today and it is NOT a model. It is a
  // hand-crafted descriptor: fill ratio, edge density, an 8-bin intensity
  // histogram and a quadrant fill signature, computed from the decoded plan
  // pixels. Calling that an embedding would be false, so `kind` says
  // "handcrafted-descriptor", `trainedModel` is false, and `dimensions` is the
  // real vector length rather than a model's hidden size. Nothing in the UI
  // may describe this as a learned or trained representation.
  //
  // See benchmarks/embedding/README.md for the license matrix and for the
  // measured baseline any candidate model has to beat before it is worth
  // shipping tens of megabytes of weights into an offline package.
  const VisualEmbeddingProviders={
    handcrafted:{
      id:"handcrafted-descriptor-v1",
      kind:"handcrafted-descriptor",
      trainedModel:false,
      label:"Geometric + intensity descriptor computed from plan pixels. Not a trained model, not an embedding.",
      dimensions:14, // fillRatio + edgeDensity + 8 histogram bins + 4 quadrants
      offline:true,
      licence:"n/a — computed in-product, no third-party weights",
      embed(gray,binary,width,height,candidate){
        return computeVisualDescriptor(gray,binary,width,height,candidate);
      },
      // Flat vector form, so a consumer can compare providers without knowing
      // the shape of any one of them.
      toVector(d){
        if(!d)return null;
        return [d.fillRatio,d.edgeDensity,...(d.intensityHist||[]),...(d.quadrantFill||[])];
      },
    },
  };
  function resolveVisualEmbeddingProvider(){
    // The learned encoder is the default WHEN IT IS INSTALLED, and only
    // because it was measured to be better on every retrieval number and
    // worse on none — see src/plan-embedding.js and
    // benchmarks/embedding/retrieval.json. If its weights are absent (a build
    // that did not run scripts/build-encoder-module.mjs) the app degrades to
    // the handcrafted descriptor rather than failing, and says which one ran
    // in the detection diagnostics either way.
    const id=globalThis.MERIT_VISUAL_EMBEDDING_PROVIDER
      ||(VisualEmbeddingProviders.learned?"learned":"handcrafted");
    return VisualEmbeddingProviders[id]||VisualEmbeddingProviders.handcrafted;
  }
  globalThis.MeritVisualEmbedding={
    providers:VisualEmbeddingProviders,
    resolve:resolveVisualEmbeddingProvider,
    // Registration seam for a future real model. Kept deliberately explicit:
    // a provider must declare whether it is a trained model, because the
    // honesty rules downstream key off that flag rather than off its name.
    register(id,provider){
      if(!provider||typeof provider.embed!=="function")throw new Error("A visual embedding provider needs an embed() function.");
      if(typeof provider.trainedModel!=="boolean")throw new Error("A visual embedding provider must declare trainedModel explicitly.");
      VisualEmbeddingProviders[id]=provider;
    },
  };
  // src/plan-embedding.js loads before this file, so it cannot register itself
  // against a registry that does not exist yet. It exposes the registration and
  // this calls it, which also means an installation without the weights simply
  // never registers and the handcrafted descriptor stays the resolved provider.
  if(typeof globalThis.MeritRegisterPlanEncoder==="function")globalThis.MeritRegisterPlanEncoder();
  function computeVisualDescriptor(gray,binary,width,height,c){
    const px=Math.max(0,Math.round(c.x/100*width)),py=Math.max(0,Math.round(c.y/100*height));
    const pw=Math.max(1,Math.min(width-px,Math.round(c.w/100*width))),ph=Math.max(1,Math.min(height-py,Math.round(c.h/100*height)));
    if(pw<2||ph<2)return null;
    const hist=new Array(8).fill(0),quadFg=[0,0,0,0],quadTotal=[0,0,0,0];
    let fg=0,edgeSum=0,total=0;
    for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
      const gx=px+x,gy=py+y;if(gx>=width||gy>=height)continue;
      const i=gy*width+gx,v=gray[i];
      total++;hist[Math.min(7,v>>5)]++;
      if(binary[i])fg++;
      const qi=(x<pw/2?0:1)+(y<ph/2?0:2);quadTotal[qi]++;if(binary[i])quadFg[qi]++;
      if(x>0&&x<pw-1&&y>0&&y<ph-1){
        edgeSum+=Math.abs(gray[gy*width+gx+1]-gray[gy*width+gx-1])+Math.abs(gray[(gy+1)*width+gx]-gray[(gy-1)*width+gx]);
      }
    }
    if(!total)return null;
    return{
      fillRatio:fg/total,
      edgeDensity:Math.min(1,edgeSum/(total*255)),
      intensityHist:hist.map(n=>n/total),
      quadrantFill:quadTotal.map((n,i)=>n?quadFg[i]/n:0),
    };
  }
  // ============================================================
  // Current Plan Memory: a human correction (reclassify, confirm, reject, or
  // a manually-drawn "AI missed this" object) must survive Re-Analyze, not be
  // silently discarded when runAssistedDetection() throws away the whole old
  // candidate list and generates fresh ones with new random ids. Stored on
  // event.planMemory (NOT event.analysis, which gets fully replaced on every
  // analysis pass) and matched back onto the newly detected candidates by
  // real geometry: since the source plan image never changed and the
  // classical CV pipeline is deterministic, the same physical object reappears
  // at essentially the same position/size on every re-run — this is a real,
  // honest match, not a fabricated one. Matching by learned visual similarity
  // instead of geometry alone is a separate, larger piece of future work (see
  // plan-intelligence.js's similarity clustering).
  function rememberCorrection(event,c,{manual=false}={}){
    event.planMemory ||= [];
    // Identity used to be geometry alone, which is really determinism matching:
    // it works because re-running a deterministic detector on identical pixels
    // puts every box back where it was. The moment the pixels differ — a JPEG
    // round trip, a greyscale export, a plan re-issued with two tables moved —
    // a decision is silently lost, or worse, lands on a different object.
    //
    // So the decision is stored with what the object LOOKED like and what stood
    // AROUND it as well as where it was. Both are already computed by the time
    // a person can click: the encoder ran over every candidate during detection,
    // and the neighbourhood is the candidate list itself.
    const alive=(event.analysis?.candidates||[]).filter(x=>x.status!=="rejected");
    const vector=c.visualDescriptor?.vector||null;
    const entry={id:uid("planmemory"),sourceCandidateId:c.id,kind:c.kind,type:c.type,status:c.status,
      geometry:{x:c.x,y:c.y,w:c.w,h:c.h,rotation:c.rotation||0},manual,correctedAt:nowISO(),
      // "Not important": rejected for this plan, and remembered as dismissed
      // so Re-Analyze does not ask again and the reason is not lost.
      dismissed:!!c.dismissed,
      // The identifier the drawing prints on it, when two crops agreed on one.
      // Stored with the memory so the same table can be recognised after a
      // re-import by its number rather than by resembling a hundred siblings.
      printedNumber:c.printedNumber&&c.printedNumber.state==="VERIFIED"
        ?{state:"VERIFIED",value:c.printedNumber.value}:null,
      visual:vector?{vector:Array.from(vector),
        provider:globalThis.MeritVisualEmbedding?.resolve?.()?.id||null,
        version:globalThis.MERIT_PLAN_ENCODER_WEIGHTS?.id||null}:null,
      context:globalThis.MeritPlanMemory?globalThis.MeritPlanMemory.contextSignature(c,alive):null};
    const existing=event.planMemory.findIndex(m=>m.sourceCandidateId===c.id);
    if(existing>=0)event.planMemory[existing]=entry;else event.planMemory.push(entry);
  }
  // ---- training-data capture (Gates E-G) ----------------------------------
  //
  // rememberCorrection above keeps a plan tidy: it records the answer so the
  // same object comes back the same way after Re-Analyze. It does not keep
  // the question. Nothing in it says what the detector had predicted, which
  // build predicted it, which plan and which layout version the object came
  // from, or what the operator was actually looking at.
  //
  // captureTrainingExample keeps all of that, with the real crop, in
  // state.trainingData. It is a data foundation and nothing else: it never
  // changes a detection, never trains anything, and never sets trainedModel.
  // See src/training-data.js for the record shape and the decision types.
  //
  // Failures are reported, not swallowed. A correction that was applied but
  // not captured is a real gap in the dataset, and an operator who is told
  // "saved" while nothing was stored would build on sand.
  let planImageCache={src:null,image:null};
  let planHashCache={src:null,hash:null};
  let captureFailureReported=false;
  async function planHashFor(src){
    if(planHashCache.src!==src)planHashCache={src,hash:await globalThis.MeritTrainingData.planFingerprint(src)};
    return planHashCache.hash;
  }
  async function planImageFor(src){
    if(planImageCache.src!==src){
      if(planImageCache.image?.close)planImageCache.image.close();
      planImageCache={src,image:await globalThis.MeritTrainingData.imageFromDataUrl(src)};
    }
    return planImageCache.image;
  }
  function truthOf(c){return c?{kind:c.kind,type:c.type,seats:c.seats??null,seatsConfidence:c.seatsConfidence??null}:null;}
  async function captureTrainingExample(event,c,{decisionType,predictionBefore=null,note=null,decisionId=null,propagatedFrom=null,reviewedIndividually=true}={}){
    if(!globalThis.MeritTrainingData||!event?.background?.src||!c)return null;
    try{
      const src=event.background.src;
      const [planHash,image]=await Promise.all([planHashFor(src),planImageFor(src)]);
      if(!planHash)return null;
      const geometry={x:c.x,y:c.y,w:c.w,h:c.h,rotation:c.rotation||0};
      const shot=await globalThis.MeritTrainingData.cropFromImage(image,geometry);
      const blobId=uid("crop");
      await storageProvider.putBlob(blobId,shot.dataUrl);
      const wantsTruth=decisionType==="confirmation"||decisionType==="correction"||decisionType==="missedObject";
      const record=globalThis.MeritTrainingData.buildRecord({
        decisionType,
        plan:{planHash,name:event.background.name||null,width:image.width,height:image.height},
        context:{eventId:event.id,venueId:event.venueRef?.venueId??null,
          layoutId:event.venueRef?.layoutId??null,layoutVersionId:event.venueRef?.layoutVersionId??null},
        geometry,
        predictionBefore,
        humanTruth:wantsTruth?truthOf(c):null,
        providers:{
          detection:event.analysis?.diagnostics?.provider
            ?{id:event.analysis.diagnostics.provider,engine:event.analysis.engine,trainedModel:false}:null,
          embedding:(()=>{const p=globalThis.MeritVisualEmbedding?.resolve?.();
            return p?{id:p.id,kind:p.kind,trainedModel:p.trainedModel,dimensions:p.dimensions}:null;})(),
        },
        descriptor:c.descriptor??null,
        crop:{blobId,size:shot.size,sourceRect:shot.sourceRect,objectRect:shot.objectRect,padding:shot.padding},
        note,decisionId,propagatedFrom,reviewedIndividually,
      });
      // A capture finishes after its crop is stored; if the decision was undone
      // meanwhile, the label is kept as retracted rather than counted.
      if(decisionId&&getRetractedDecisions().has(decisionId))globalThis.MeritTrainingData.retract([record],decisionId,{reason:"the decision was undone"});
      getState().trainingData ||= [];
      getState().trainingData.push(record);
      saveState();
      return record;
    }catch(error){
      if(!captureFailureReported){
        captureFailureReported=true;
        toast(t("training.captureFailed"),"error",7000);
      }
      console.error("Training-data capture failed.",error);
      return null;
    }
  }
  // General old-candidate -> new-candidate geometry remap, used to carry
  // grouping decisions (which reference every member of a furniture group,
  // not just ones a human individually confirmed/reclassified) across a
  // Re-Analyze pass. Same deterministic-geometry reasoning as plan memory.
  function matchCandidatesByGeometry(oldCandidates,freshCandidates){
    const pairs=[];
    for(const o of oldCandidates)for(const c of freshCandidates)pairs.push({o,c,dist:Math.hypot(c.x-o.x,c.y-o.y,(c.w-o.w)*.5,(c.h-o.h)*.5)});
    pairs.sort((a,b)=>a.dist-b.dist);
    const usedO=new Set(),usedC=new Set(),remap=new Map();
    for(const{o,c,dist}of pairs){
      // Same size-relative rule as plan memory, and for the same reason: a
      // grouping decision carried onto a neighbouring chair is as wrong as a
      // correction carried onto one.
      if(dist>memoryTolerance(o)||usedO.has(o.id)||usedC.has(c.id))continue;
      remap.set(o.id,c.id);usedO.add(o.id);usedC.add(c.id);
    }
    return remap;
  }
  // Re-applies remembered corrections onto a fresh detection pass: matches
  // each memory entry to its closest freshly-detected candidate (greedy
  // nearest-geometry, one-to-one) within a tight tolerance, overwrites that
  // candidate's kind/type/status with the remembered human decision (flagging
  // fromMemory so this is never silently indistinguishable from a fresh
  // detection), and re-inserts a manually-drawn "AI missed this" object
  // outright if the detector still doesn't find it. Returns an id remap so
  // grouping decisions (which reference old candidate ids) can be carried
  // forward too.
  // How far a remembered object is allowed to have moved, RELATIVE TO ITS OWN
  // SIZE rather than to the plan.
  //
  // A flat 3-percent-of-plan tolerance is the same distance for a banquet
  // table and for a chair, and on this plan's concert seating adjacent chairs
  // stand about 2.6 percent apart — inside it. Measured: after 21 corrections
  // and a Re-Analyze, three chair corrections came back on a NEIGHBOURING
  // chair, because greedy nearest-first pairing over 39 memories can displace
  // a match when several candidates are all within tolerance of each other.
  // Retention 0.857 against a 0.98 gate, and the operator sees a confirmed,
  // remembered decision sitting on the wrong seat.
  //
  // A big table can shift three percent of the plan and still obviously be
  // that table. A chair cannot: three percent is more than a chair away. So
  // the tolerance is a fraction of the object's own short side, floored so a
  // tiny object still has some slack and capped at the old value so nothing
  // matches more loosely than it used to.
  const MEMORY_TOLERANCE_OF_SIZE=.75,MEMORY_MIN_TOLERANCE=.5,MEMORY_MAX_TOLERANCE=3;
  function memoryTolerance(g){
    return Math.max(MEMORY_MIN_TOLERANCE,
      Math.min(MEMORY_MAX_TOLERANCE,Math.min(g.w,g.h)*MEMORY_TOLERANCE_OF_SIZE));
  }
  function applyPlanMemory(freshCandidates,memory){
    const idRemap=new Map();
    if(!memory?.length)return{reappliedCount:0,restored:[],idRemap,conflicts:[]};
    // Matched purely by geometry, never by kind: a reclassification memory's
    // whole point is that the detector's raw kind guess was wrong (e.g. a
    // table-shaped detection that a human corrected to venue:chair) -- the
    // freshly re-detected candidate at that position will get the SAME wrong
    // kind guess again on every re-run, so requiring kind equality here would
    // make the correction impossible to ever re-apply.
    //
    // Matching itself lives in src/plan-memory.js, where it is scored from
    // geometry, size, the learned encoder's embedding of the crop, the local
    // neighbourhood and family compatibility, and graded STRONG / LIKELY /
    // AMBIGUOUS / NONE. Only the first two re-apply. An AMBIGUOUS match — two
    // candidates that fit about equally — is deliberately NOT applied: picking
    // one silently is how a human decision lands on an object it was never
    // about, and that failure looks exactly like success.
    const byId=new Map(freshCandidates.map(c=>[c.id,c]));
    const memById=new Map(memory.map(m=>[m.id,m]));
    const result=globalThis.MeritPlanMemory.match(memory,
      freshCandidates.map(c=>({id:c.id,kind:c.kind,type:c.type,x:c.x,y:c.y,w:c.w,h:c.h,
        vector:c.visualDescriptor?.vector||null,printedNumber:c.printedNumber||null})));
    const usedC=new Set(),usedM=new Set();
    let reappliedCount=0;
    // Where the operator and the detector actually disagree. Re-applying a
    // correction silently makes the plan look right while hiding the fact that
    // the detector proposed the same wrong answer again -- which is exactly the
    // signal that says this class of object is not being read correctly. It is
    // recorded here, at the only place that can see both answers, and reported
    // as a MEMORY contradiction rather than being smoothed over.
    const conflicts=[];
    for(const hit of result.matches){
      const c=byId.get(hit.candidateId),m=memById.get(hit.memoryId);
      if(!c||!m)continue;
      if(hit.reclassifies)
        conflicts.push({kind:"overruled",candidateId:c.id,
          detector:{kind:c.kind,type:c.type},operator:{kind:m.kind,type:m.type}});
      c.kind=m.kind;c.type=m.type;c.status=m.status;c.selected=m.status!=="rejected";c.fromMemory=true;if(m.dismissed)c.dismissed=true;
      c.memoryMatch={grade:hit.grade,score:hit.score,margin:hit.margin,
        movedBeyondTolerance:!hit.withinOldTolerance,visualCosine:hit.visualCosine,terms:hit.terms};
      usedC.add(c.id);usedM.add(m.id);idRemap.set(m.sourceCandidateId,c.id);reappliedCount++;
    }
    // Two candidates fit this decision about equally well. Not applied, and not
    // silent: the operator is the only one who can say which object they meant.
    for(const hit of result.ambiguous){
      const m=memById.get(hit.memoryId);
      if(!m||usedM.has(m.id))continue;
      usedM.add(m.id);
      conflicts.push({kind:"ambiguous",memoryId:m.id,candidateId:hit.candidateId,
        object:{kind:m.kind,type:m.type},score:hit.score,margin:hit.margin});
    }
    const restored=[];
    for(const m of memory){
      // A confirmed object the detector did NOT find again this run. Not
      // fabricated back into existence, but not silent either: a human said
      // this is real and detection now disagrees.
      if(!usedM.has(m.id)&&!m.manual&&m.status==="confirmed")
        conflicts.push({kind:"lost",memoryId:m.id,object:{kind:m.kind,type:m.type},geometry:m.geometry});
      if(usedM.has(m.id)||!m.manual)continue; // a non-manual correction whose object wasn't re-detected this time is left alone -- we never fabricate a detection that didn't happen.
      const g=m.geometry,id=uid("candidate");
      restored.push({id,kind:m.kind,type:m.type,x:g.x,y:g.y,w:g.w,h:g.h,rotation:g.rotation,confidence:1,status:m.status,selected:m.status!=="rejected",missed:true,fromMemory:true,chairDetections:[],evidence:{geometry:"manual-memory",chairs:0,repetition:0}});
      idRemap.set(m.sourceCandidateId,id);
    }
    return{reappliedCount,restored,idRemap,conflicts,identity:result.stats};
  }
    return{applyPlanMemory,captureTrainingExample,matchCandidatesByGeometry,planHashFor,rememberCorrection,resolveVisualEmbeddingProvider};
  }
  globalThis.MeritPlanLearning=Object.freeze({create,DEPS:Object.freeze(["getRetractedDecisions","getState","nowISO","saveState","storageProvider","t","toast","uid"])});
})();
