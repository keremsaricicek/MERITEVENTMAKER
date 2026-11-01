// Training examples in and out: every human decision captured as a record
// with its real crop (captureTrainingExample, plus the plan hash and image it
// is cropped from), and the one portable dataset file built from those records
// (buildTrainingDatasetExport / exportTrainingDataset). Nothing here trains,
// evaluates or promotes a model; the record shape, the crop and the
// plan-grouped split are src/training-data.js's.
//
// Moved byte-for-byte out of app-v8.js on 2026-11-01 (code health, ownership
// map A23), at the original indentation; the two blocks keep their own
// headers. The edits forced by the move: `state` is read through getState(),
// because the shell reassigns it; MeritTrainingData is handed over;
// MeritVisualEmbedding, which app-v8.js publishes, is read from globalThis at
// call time, as the bare name did; globalThis.MERIT_TRAINING_EXPORT stays the
// shell's.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that).
(() => {
  "use strict";
  let getState;
  let MeritTrainingData;
  let nowISO;
  let retractedDecisions;
  let saveState;
  let storageProvider;
  let t;
  let toast;
  let uid;
  let created=false;

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
    if(planHashCache.src!==src)planHashCache={src,hash:await MeritTrainingData.planFingerprint(src)};
    return planHashCache.hash;
  }
  async function planImageFor(src){
    if(planImageCache.src!==src){
      if(planImageCache.image?.close)planImageCache.image.close();
      planImageCache={src,image:await MeritTrainingData.imageFromDataUrl(src)};
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
      const shot=await MeritTrainingData.cropFromImage(image,geometry);
      const blobId=uid("crop");
      await storageProvider.putBlob(blobId,shot.dataUrl);
      const wantsTruth=decisionType==="confirmation"||decisionType==="correction"||decisionType==="missedObject";
      const record=MeritTrainingData.buildRecord({
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
      if(decisionId&&retractedDecisions.has(decisionId))MeritTrainingData.retract([record],decisionId,{reason:"the decision was undone"});
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

  // ---- dataset export (Gates H-J) ----------------------------------------
  //
  // One portable file containing every captured decision, its image crop, and
  // a leakage-safe train/val/test split computed by plan rather than by
  // example. The split is included so that whoever picks this up cannot
  // accidentally shuffle crops at random: forty chairs from one drawing on
  // both sides of the line produce a model that has memorised a venue and a
  // number that says it generalises.
  //
  // The file states what it is. `trainedModel` is false throughout, the
  // readiness line says plainly whether this is a training set or a capture
  // log, and nothing here trains, evaluates or promotes anything.
  const DATASET_FORMAT = "merit-training-dataset";
  const DATASET_FORMAT_VERSION = 1;
  async function buildTrainingDatasetExport({includeCrops=true}={}){
    const records=getState().trainingData||[];
    const split=MeritTrainingData.splitByPlan(records);
    const splitOf=new Map();
    for(const name of ["train","val","test"])for(const r of split[name])splitOf.set(r.id,name);
    const examples=[];
    let cropsMissing=0;
    for(const record of records){
      const entry={...record,split:splitOf.get(record.id)||null};
      if(includeCrops&&record.crop?.blobId){
        // EXPECTED ABSTENTION: a crop that cannot be read is counted below and
        // reported as missing, never swallowed.
        const dataUrl=await storageProvider.getBlob(record.crop.blobId).catch(()=>null);
        // A missing crop is reported, never quietly replaced with a blank one:
        // a dataset that silently substitutes empty images trains on nothing
        // and reports success.
        if(dataUrl)entry.crop={...record.crop,dataUrl};
        else{entry.crop={...record.crop,dataUrl:null,missing:true};cropsMissing++;}
      }
      examples.push(entry);
    }
    return {
      format:DATASET_FORMAT,
      formatVersion:DATASET_FORMAT_VERSION,
      exportedAt:nowISO(),
      schemaVersion:MeritTrainingData.SCHEMA_VERSION,
      crop:{size:MeritTrainingData.CROP_SIZE,padding:MeritTrainingData.CROP_PADDING,encoding:"image/png",
        note:"Square crop centred on the object, padded by a fraction of its own span so context is kept. sourceRect gives the exact source pixels."},
      trainedModel:false,
      producedBy:"MERIT EVENT MAKER Assisted Detection (classical computer vision) plus human decisions. No model was trained to produce this file.",
      summary:MeritTrainingData.summarise(records),
      split:{
        method:"grouped by plan content hash; every crop from one plan lands in one split",
        rationale:"Splitting individual crops at random puts objects from the same drawing on both sides and turns a memorised venue into a high score.",
        counts:{train:split.train.length,val:split.val.length,test:split.test.length},
        plans:split.plansPerSplit,
        warning:split.warning,
      },
      cropsMissing,
      examples,
    };
  }
  async function exportTrainingDataset(){
    const records=getState().trainingData||[];
    if(!records.length)return toast(t("teach.exportEmpty"),"error",5200);
    try{
      const payload=await buildTrainingDatasetExport();
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download=`merit-training-dataset-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),2000);
      const s=payload.summary;
      toast(t("teach.exportDone",{n:s.total,plans:s.distinctPlans}),"success",7000);
      if(payload.cropsMissing)toast(t("teach.exportMissingCrops",{n:payload.cropsMissing}),"error",7000);
    }catch(error){
      toast(t("dataset.exportFailed"),"error",7000);
    }
  }

  function create(deps){
    if(created)throw new Error("MeritTrainingCapture.create() is called once, by app-v8.js.");
    created=true;
    getState=deps.getState;
    MeritTrainingData=deps.MeritTrainingData;
    nowISO=deps.nowISO;
    retractedDecisions=deps.retractedDecisions;
    saveState=deps.saveState;
    storageProvider=deps.storageProvider;
    t=deps.t;
    toast=deps.toast;
    uid=deps.uid;
    return{planHashFor,captureTrainingExample,buildTrainingDatasetExport,exportTrainingDataset};
  }
  globalThis.MeritTrainingCapture=Object.freeze({create,DEPS:Object.freeze(["getState","MeritTrainingData","nowISO","retractedDecisions","saveState","storageProvider","t","toast","uid"])});
})();
