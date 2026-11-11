// Plan Intelligence review commands (the decision RULES are src/review-decisions.js,
// MeritReviewDecisions; this file is the shell's side): the ONE writer of a candidate's decision fields
// (applyReviewWrites) and its undo, a decision on one candidate or a family
// (labels spread to a family are marked as not individually reviewed), field
// edits, Confirm — commitCandidates, which writes confirmed chair coordinates
// verbatim and never regenerates a ring — the review drawing, the dataset
// export (grouped by plan so one venue never sits on both sides), local
// calibration (never described as training) and the review screen's binding.
// Moved out of app-v8.js on 2026-11-08 (code health, capability 18 of 21,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs; the section comments travelled with the
// code. The edits forced by the move: `state` is read through getState();
// MeritTrainingData through globalThis; the screens and engines this binds to
// are handed over by the shell, which creates them.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let ANALYSISRUN;
  let LEARNING;
  let PLANEDIT;
  let READING;
  let REFINE;
  let REVIEW;
  let RULES;
  let SESSIONS;
  let TEACH;
  let UNVERIFIED_SEATING;
  let VLMSCREEN;
  let WORLD;
  let activeEvent;
  let audit;
  let canMutate;
  let clone;
  let getState;
  let nowISO;
  let printedEvidence;
  let recomputePlanIntelligence;
  let recordUndo;
  let render;
  let saveState;
  let storageProvider;
  let t;
  let toast;
  let touchEvent;
  let ui;
  let uid;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritReviewCommands.create() is called once, by app-v8.js.");
    created=true;
    ANALYSISRUN=deps.ANALYSISRUN;
    LEARNING=deps.LEARNING;
    PLANEDIT=deps.PLANEDIT;
    READING=deps.READING;
    REFINE=deps.REFINE;
    REVIEW=deps.REVIEW;
    RULES=deps.RULES;
    SESSIONS=deps.SESSIONS;
    TEACH=deps.TEACH;
    UNVERIFIED_SEATING=deps.UNVERIFIED_SEATING;
    VLMSCREEN=deps.VLMSCREEN;
    WORLD=deps.WORLD;
    activeEvent=deps.activeEvent;
    audit=deps.audit;
    canMutate=deps.canMutate;
    clone=deps.clone;
    getState=deps.getState;
    nowISO=deps.nowISO;
    printedEvidence=deps.printedEvidence;
    recomputePlanIntelligence=deps.recomputePlanIntelligence;
    recordUndo=deps.recordUndo;
    render=deps.render;
    saveState=deps.saveState;
    storageProvider=deps.storageProvider;
    t=deps.t;
    toast=deps.toast;
    touchEvent=deps.touchEvent;
    ui=deps.ui;
    uid=deps.uid;
  // ---- review decisions: ONE writer ----------------------------------------
  //
  // Everything a person decides about a detected object goes through
  // decideReview(): confirm, reject, "not important", a type change and the
  // family it spreads to, accepting a family in bulk, and switching a candidate
  // in or out of what Confirm writes. MeritReviewDecisions (review-decisions.js)
  // says what the decision does; this applies it together with the four records
  // that have to agree with it -- plan memory (Re-Analyze keeps it), the
  // training label (what the detector said, what the person answered, whether
  // they looked at THIS object), the audit trail, and a human observation on
  // the object -- and undoReviewDecision() takes all of them back together.
  //
  // Before this, each button wrote its own subset: undo withdrew memory but
  // left the training label standing, undoing a correction over an earlier one
  // deleted both memory entries, "not important" deleted the candidate outright,
  // and no decision reached the audit trail. tests/suites/review-decisions.
  //
  // The undo stack is session-only, on ui, like ui.liveRecent: a property of
  // this working session that never reaches the stored schema.
  const retractedDecisions=new Set();
  const REVIEW_OPERATOR_ACTION={confirm:"confirm",reject:"reject",notImportant:"dismiss",confirmFamily:"confirm-family"};
  function applyReviewWrites(c,set){
    for(const k of ["kind","type","status","selected","dismissed"])if(k in set)c[k]=set[k];
    if("printedNumber" in set)c.printedNumber=set.printedNumber;
    if(set.clearSeats)c.chairDetections=[]; // a chair/armchair/sofa/stage/etc. carries no nested seat detections of its own
    if(set.seatsUnknown){c.seats=null;c.seatsConfidence="unverified";}
    if(set.dropSeatsState){delete c.seats;delete c.seatsConfidence;}
    if(set.forgetLesson){delete c.taughtFrom;delete c.typeBasis;}
    if("chairDetections" in set)c.chairDetections=set.chairDetections;
    if("seats" in set){c.seats=set.seats;c.seatsConfidence=set.seatsConfidence||"verified";if(set.seatsSource)c.seatsSource=set.seatsSource;}
  }
  function familyCandidateIds(event,corrected,wasKind,wasType){
    const pi=event.analysis?.planIntelligence;if(!pi)return[];
    const group=(pi.similarityGroups||[]).find(g=>(g.memberIds||[]).includes(corrected.id))
      ||(pi.reviewGroups||[]).find(g=>(g.memberIds||[]).includes(corrected.id));
    if(!group)return[];
    return group.memberIds.filter(id=>{
      if(id===corrected.id)return false;
      const other=event.analysis.candidates.find(x=>x.id===id);
      return !!other&&other.status==="unreviewed"&&other.kind===wasKind&&other.type===wasType;
    });
  }
  function decideReview(event,decision){
    if(!canMutate(event,"record a plan review decision"))return null;
    const a=event?.analysis;if(!a)return null;
    const DEC=globalThis.MeritReviewDecisions,byId=new Map(a.candidates.map(c=>[c.id,c]));
    const subject=byId.get(decision.candidateId);
    // One correction repairs the whole family, not one object -- calibration
    // against measured geometry on this plan, NOT model training.
    // A decision taken on a model's suggestion (decision.via==="vlm") is about
    // the ONE object the person looked at: spread:false keeps the family out.
    const familyIds=decision.kind==="reclassify"&&subject&&decision.spread!==false?familyCandidateIds(event,subject,subject.kind,subject.type):[];
    const p=DEC.plan({...decision,familyIds},{candidates:a.candidates,unverifiedSeating:[...UNVERIFIED_SEATING]});
    if(!p.ok)return null;
    // A model finding this decision answers (decision.vlm) changes WITH it: one
    // transaction, one undo. It must still be open and belong to this analysis.
    const finding=decision.vlm&&a.vlm&&a.vlm.findings.find(f=>f.id===decision.vlm.findingId);
    if(decision.vlm&&(!finding||finding.state!=="open"))return null;
    const decisionId=uid("decision");
    // Created objects are snapshotted as absent, so undo removes them.
    const createdIds=new Set((p.create||[]).map(c=>c.id));
    const before=p.writes.filter(w=>!createdIds.has(w.id)).map(w=>{const c=byId.get(w.id),snap={id:w.id,present:{}};
      for(const k of DEC.SNAPSHOT_FIELDS){snap.present[k]=k in c;if(k in c)snap[k]=clone(c[k]);}return snap;});
    ui.correctionUndo ||= [];
    ui.correctionUndo.push({decisionId,eventId:event.id,analysisId:a.id,kind:p.kind,label:p.kind,before,created:[...createdIds],
      finding:finding?{id:finding.id,state:finding.state}:null,memoryBefore:clone(event.planMemory||[]),at:nowISO()});
    if(ui.correctionUndo.length>30)ui.correctionUndo.shift();
    for(const c of p.create||[]){a.candidates.push(c);byId.set(c.id,c);if(c.missed&&!a.missed.includes(c.id))a.missed.push(c.id);}
    for(const w of p.writes)applyReviewWrites(byId.get(w.id),w.set);
    // An object the decision CREATED has no detection to be matched against on
    // the next analysis: it is remembered as manual, so re-analysis restores it.
    for(const id of p.memory)LEARNING.rememberCorrection(event,byId.get(id),{manual:createdIds.has(id)});
    for(const tr of p.training)LEARNING.captureTrainingExample(event,byId.get(tr.id),{decisionType:tr.decisionType,predictionBefore:tr.predictionBefore,
      note:tr.note||null,decisionId,propagatedFrom:tr.propagatedFrom||null,reviewedIndividually:tr.reviewedIndividually});
    // The object now carries a HUMAN observation: a person, not the detector,
    // said this -- and on one object they looked at, or as part of a spread.
    const O=globalThis.MeritObservations;
    if(O)for(const w of p.writes){
      const c=byId.get(w.id),label=p.training.find(t=>t.id===w.id);
      c.observationIds ||= [];
      O.link(a,c,O.create({id:uid("obs"),source:{kind:"human",provider:"operator"},imageRef:a.planHash||null,
        claim:{decisionId,decision:p.kind,kind:c.kind,type:c.type,status:c.status,selected:c.selected,
          reviewedIndividually:label?label.reviewedIndividually!==false:true},
        geometry:{frame:"plan-percent",convention:"corner",x:c.x,y:c.y,w:c.w,h:c.h,rotation:c.rotation||0},
        evidence:{what:label&&label.propagatedFrom?`spread from ${label.propagatedFrom}`:decision.via==="vlm"?"the operator accepted a vision-language model's suggestion about this object":"the operator's own decision on this object"}}));
    }
    if(finding){finding.state="accepted";finding.decidedAt=nowISO();finding.decisionId=decisionId;finding.appliedTo=p.writes[0]?.id||null;}
    audit(event,"REVIEW_DECISION",{decisionId,kind:p.kind,targets:p.writes.map(w=>w.id),spread:p.spread,labels:p.training.length,
      ...(decision.via==="vlm"?{via:"vlm",findingId:finding?.id||null,runId:decision.vlm?.runId||null}:{})});
    if(REVIEW_OPERATOR_ACTION[p.kind])SESSIONS.recordOperatorAction(event,REVIEW_OPERATOR_ACTION[p.kind],p.writes.map(w=>w.id));
    recomputePlanIntelligence(event);
    touchEvent(event);
    return{decisionId,affected:p.writes.length,spread:p.spread,created:[...createdIds]};
  }
  globalThis.decideReview=decideReview;
  // The last decision on this event — or, given its id, one particular
  // decision, provided no LATER decision touched the same objects (restoring
  // an older snapshot over a newer decision would undo that one too, silently).
  function undoReviewDecision(event,decisionId){
    event=event||activeEvent();
    if(!canMutate(event,"undo a plan correction"))return 0;
    const stack=ui.correctionUndo||[];
    const i=decisionId?stack.findIndex(e=>e.eventId===event.id&&e.decisionId===decisionId):stack.map(e=>e.eventId).lastIndexOf(event.id);
    if(i<0)return 0;
    const ids=e=>new Set([...e.before.map(b=>b.id),...(e.created||[])]);
    if(decisionId){const mine=ids(stack[i]);if(stack.slice(i+1).some(e=>e.eventId===event.id&&[...ids(e)].some(id=>mine.has(id))))return -1;}
    const entry=stack.splice(i,1)[0],a=event.analysis;
    // A decision about candidates of an analysis that has since been replaced
    // (Re-Analyze) has nothing left to restore here; memory carried it over.
    if(!a||a.id!==entry.analysisId)return 0;
    const byId=new Map(a.candidates.map(c=>[c.id,c]));
    let restored=0;
    for(const snap of entry.before){
      const c=byId.get(snap.id);if(!c)continue;
      for(const k of globalThis.MeritReviewDecisions.SNAPSHOT_FIELDS){if(snap.present[k])c[k]=snap[k];else delete c[k];}
      restored++;
    }
    // Objects the decision created are removed again, from every list that holds them.
    if(entry.created?.length){
      const gone=new Set(entry.created);
      a.candidates=a.candidates.filter(c=>!gone.has(c.id));
      a.missed=(a.missed||[]).filter(id=>!gone.has(id));
      restored+=entry.created.length;
    }
    // The model finding it answered is open again.
    if(entry.finding&&a.vlm){const f=a.vlm.findings.find(x=>x.id===entry.finding.id);if(f){f.state=entry.finding.state;delete f.decidedAt;delete f.decisionId;delete f.appliedTo;}}
    // Memory as it was, whole: a correction that REPLACED an earlier decision's
    // entry gets that earlier entry back, not a hole.
    event.planMemory=entry.memoryBefore;
    retractedDecisions.add(entry.decisionId);
    globalThis.MeritTrainingData.retract(getState().trainingData||[],entry.decisionId,{reason:"the decision was undone"});
    const gone=new Set((a.observations||[]).filter(o=>o.source.kind==="human"&&o.claim&&o.claim.decisionId===entry.decisionId).map(o=>o.id));
    if(gone.size){a.observations=a.observations.filter(o=>!gone.has(o.id));for(const c of a.candidates)if(c.observationIds)c.observationIds=c.observationIds.filter(id=>!gone.has(id));}
    audit(event,"REVIEW_DECISION_UNDONE",{decisionId:entry.decisionId,kind:entry.kind,targets:entry.before.map(b=>b.id)});
    recomputePlanIntelligence(event);
    touchEvent(event);
    return restored;
  }
  // Called one frame after the change event, never inside it. A <select> or
  // <input> change fires during blur, and re-rendering the whole app
  // synchronously inside that handler removes the node the browser is still
  // working with -- which throws "The node to be removed is no longer a child
  // of this node. Perhaps it was moved in a 'blur' event handler?" and leaves
  // the review screen half-drawn. Deferring one frame lets blur finish first.
  function updateCandidateField(field,value){
    const event=activeEvent(),c=event.analysis?.candidates.find(x=>x.id===ui.selectedCandidateId);if(!c)return;
    if(field==="seatCount"){
      // Blank means "still unknown", which is a different state from zero and
      // must round-trip as such. Only a number the operator actually typed
      // makes this furniture count toward capacity.
      const raw=String(value).trim();
      if(raw===""){c.seats=null;c.seatsConfidence="unverified";}
      else{c.seats=Math.max(0,Math.min(99,Number(raw)||0));c.seatsConfidence="verified";}
      recomputePlanIntelligence(event);
    }
    else if(field==="rotation")c.rotation=Number(value)||0;
    else if(field==="chairs"){const count=Math.max(0,Math.min(99,Number(value)||0));c.chairDetections=Array.from({length:count},(_,i)=>c.chairDetections?.[i]||{id:uid("candidate-chair"),x:c.x+c.w/2,y:c.y+c.h/2,w:.7,h:.7,rotation:0,confidence:.3});}
    else if(field==="kindtype"){
      // The person's type, spread to the unreviewed members of its family --
      // one decision, one undo, one audit entry (decideReview). Reclassifying
      // INTO seating furniture never invents a capacity: an admitted unknown.
      const [kind,type]=value.split(":");
      const r=decideReview(event,{kind:"reclassify",candidateId:c.id,to:{kind,type}});
      if(r&&r.spread)toast(t("review.correctionSpread",{n:r.spread}),"success",4200);
      render();return;
    }
    else c[field]=value;
    touchEvent(event);render();
  }
  // A seat count a person settled on a table that draws no chairs: typed into
  // the object card, or a suggestion they accepted. It is the table's logical
  // capacity (HUMAN_CONFIRMED) and creates no chair — the physical count stays
  // what the drawing drew, and the printed rule stays its own source.
  const personSeats=c=>c.seatsConfidence==="verified"&&Number.isInteger(c.seats)&&c.seats>0?c.seats:null;
  function commitCandidates(){
    if(!canMutate(activeEvent(),"confirm the plan"))return;
    const event=activeEvent(),chosen=event.analysis?.candidates.filter(c=>c.selected&&c.status!=="rejected")||[];if(!chosen.length)return toast(t("toast.selectDetectionFirst"),"error");
    // A table carries physical chairs only when chairs were found AT IT. It
    // used to inherit the plan's verdict (representation PHYSICAL): a table on
    // a chair-drawing plan whose own chairs were not detected was committed as
    // hasPhysicalSeats:true with no chairs, and syncTableChairs then built a
    // ring from its capacity number on the next load — chairs nobody drew
    // (found by vlm-reading's accept → Confirm → reload chain, 2026-10-10). A
    // SYMBOLIC plan's tables were already false; now an undetected table on a
    // physical plan is too, and its capacity stays a logical number.
    // §5: the drawing's printed capacity rule gives a seatless symbol its
    // capacity ONLY when MeritCapacityProvenance.ruleApplication() says the
    // rule describes these symbols — one decision for the whole commit, with
    // its reason, never a per-table guess. The capacity is a logical seat
    // space: no chair is created for it.
    const CP=globalThis.MeritCapacityProvenance;
    const ruleUse=CP&&CP.ruleApplication?CP.ruleApplication({rule:event.analysis?.planIntelligence?.capacityAudit?.rule||null,
      representationKind:event.analysis?.diagnostics?.representation?.kind||null,
      seatlessTables:(event.analysis?.candidates||[]).filter(c=>c.kind==="table"&&c.status!=="rejected"&&!c.chairDetections?.length).length}):{applies:false};
    recordUndo(event);
    let tables=0,venues=0,chairsKept=0,derived=0;
    // Plan percent -> world through the frame the reference layer DRAWS the
    // plan in (MeritPlanFrames.referenceLayerFrame): uniform, so every object
    // lands on its own drawing at its own shape. Stored at its true size --
    // nothing is grown to a minimum, which moved small objects off their
    // drawing and their chairs with them.
    const FRAMES=globalThis.MeritPlanFrames,src=event.analysis?.frames?.source;
    const natW=src?.width||event.analysis?.originalWidth||event.analysis?.imageWidth||WORLD.width;
    const natH=src?.height||event.analysis?.originalHeight||event.analysis?.imageHeight||WORLD.height;
    const world=FRAMES.worldForPlan(WORLD,natW,natH);
    const layer=FRAMES.referenceLayerFrame(world.width,world.height,event.background?.scale||100,natW,natH);
    const toWorld=(box,convention)=>{
      const[cx,cy]=layer.percentToWorld.apply(...(convention===FRAMES.CENTRE?[box.x,box.y]:[box.x+box.w/2,box.y+box.h/2]));
      return{cx,cy,w:box.w/100*layer.drawnWidth,h:box.h/100*layer.drawnHeight,rotation:box.rotation||0};
    };
    for(const c of chosen){
      if(c.committedId)continue;
      const body=toWorld(c,FRAMES.CORNER),x=body.cx-body.w/2,y=body.cy-body.h/2,w=body.w,h=body.h;
      if(c.kind==="table"){
        // The footprint holds the drawn surface and the drawn chairs; the
        // surface is kept as its own box inside it, each chair at its
        // detected centre in the table's own frame.
        const fp=FRAMES.footprintFor(body,c.rotation||0,(c.chairDetections||[]).map(ch=>toWorld(ch,FRAMES.CENTRE)));
        const table=RULES().syncTableChairs({id:uid("table"),number:PLANEDIT.uniqueNumber(event,"T",1),type:["round","square","rectangle","bistro"].includes(c.type)?c.type:"rectangle",x:fp.x,y:fp.y,w:fp.w,h:fp.h,surface:fp.surface,capacity:Math.max(1,c.chairDetections?.length||(personSeats(c)??(ruleUse.applies?ruleUse.perUnit:1))),zone:"MAIN FLOOR",rotation:c.rotation||0,locked:false,z:10,hasPhysicalSeats:!!c.chairDetections?.length,capacitySource:c.chairDetections?.length?"DETECTED_PHYSICAL_SEATS":personSeats(c)!=null?"HUMAN_CONFIRMED":ruleUse.applies?"DERIVED_PRINTED_RULE":"UNKNOWN",origin:"DETECTED",printedNumber:printedEvidence(c.printedNumber),...(!c.chairDetections?.length&&personSeats(c)!=null?{capacityEvidence:{via:c.seatsSource||"typed",seats:c.seats,at:nowISO()}}:!c.chairDetections?.length&&ruleUse.applies?{capacityEvidence:{...ruleUse.evidence,at:nowISO()}}:{})});
        if(c.chairDetections?.length){
          // A chair whose facing the drawing showed keeps it. The canvas draws a
          // chair at rotation 0 facing +y of its table (the layout convention of
          // MeritEventRules.chairGeometry), so the stored rotation is that
          // facing turned into the table's frame. A chair the drawing did not
          // show a front for is facing:null — drawn with no front — and keeps
          // its box angle, which is an axis and not a direction.
          table.chairs=fp.chairs.map((ch,index)=>{
            const o=c.chairDetections[index]?.relation?.orientation,known=!!(o&&o.facingKnown&&Number.isFinite(o.facingAngle));
            return{id:uid("chair"),parentTableId:table.id,seatNumber:index+1,x:ch.x,y:ch.y,
              rotation:known?((o.facingAngle-90-(c.rotation||0))%360+360)%360:ch.rotation,
              facing:known?o.facingAngle:null,facingSource:known?String(o.facingEvidence||"stencilBackrest"):"notObserved"};
          });
          table.capacity=table.chairs.length;
        }
        event.tables.push(table);
        c.committedId=table.id;
        tables++;
        chairsKept+=(table.chairs||[]).length;
        if(table.capacitySource==="DERIVED_PRINTED_RULE")derived++;
      }else{
        const object={id:uid("venue"),type:c.type||"text",label:String(c.type||"OBJECT").toUpperCase(),x,y,w,h,rotation:c.rotation||0,locked:false,z:4};
      // Seating furniture keeps its capacity state on the committed object, so
      // "we do not know how many this banquette seats" survives leaving the
      // review screen instead of silently becoming zero on the floor plan.
      if(UNVERIFIED_SEATING.has(object.type)){object.seats=c.seats??null;object.seatsConfidence=c.seats==null?"unverified":"verified";}
      event.venueObjects.push(object);
      c.committedId=object.id;
      venues++;}
      c.status="confirmed";}
      if(event.analysis.timings)event.analysis.timings.confirmedAtMs=Date.now();
      SESSIONS.recordOperatorAction(event,"confirm-plan",chosen.map(c=>c.id));
      touchEvent(event);
      ui.tab="floor";
      ui.planMode="plan";
      render();
      toast(t(chairsKept?"toast.detectionsConfirmed":derived?"toast.detectionsConfirmedRule":"toast.detectionsConfirmedPlain",{tables,venues,perUnit:ruleUse.perUnit,tableWord:t(tables===1?"word.table":"word.tables"),venueWord:t(venues===1?"word.venueObject":"word.venueObjects")}),"success",6000);
  }
  function bindReviewDrawing(){
    const scene=document.getElementById("analysisScene");
    if(!scene||!ui.reviewDrawMode)return;
    scene.onpointerdown=e=>{
      if(e.target!==scene&&e.target.tagName!=="IMG")return;
      e.preventDefault();
      const r=scene.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top,box=document.createElement("div");
      box.className="candidate-box selected";
      scene.appendChild(box);
      const move=ev=>{
        const x=ev.clientX-r.left,y=ev.clientY-r.top;
        Object.assign(box.style,{left:Math.min(sx,x)+"px",top:Math.min(sy,y)+"px",width:Math.abs(x-sx)+"px",height:Math.abs(y-sy)+"px"});
      };
      const up=ev=>{
        document.removeEventListener("pointermove",move);
        document.removeEventListener("pointerup",up);
        const x=Math.min(sx,ev.clientX-r.left)/r.width*100,y=Math.min(sy,ev.clientY-r.top)/r.height*100,w=Math.abs(ev.clientX-r.left-sx)/r.width*100,h=Math.abs(ev.clientY-r.top-sy)/r.height*100;
        if(w>1&&h>1){
          const event=activeEvent();
          const c={id:uid("candidate"),kind:"table",type:"rectangle",x,y,w,h,rotation:0,confidence:1,status:"unreviewed",selected:true,missed:true,chairDetections:[],evidence:{geometry:"manual",chairs:0,repetition:0}};
          event.analysis.candidates.push(c);
          event.analysis.missed.push(c.id);
          LEARNING.rememberCorrection(event,c,{manual:true});
          LEARNING.captureTrainingExample(event,c,{decisionType:"missedObject",note:"drawn by the operator on a region the detector never proposed"});
          ui.selectedCandidateId=c.id;
          ui.reviewDrawMode=false;
          touchEvent(event);
        }
        render();
      };
      document.addEventListener("pointermove",move);
      document.addEventListener("pointerup",up);
    };
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
    const split=globalThis.MeritTrainingData.splitByPlan(records);
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
      schemaVersion:globalThis.MeritTrainingData.SCHEMA_VERSION,
      crop:{size:globalThis.MeritTrainingData.CROP_SIZE,padding:globalThis.MeritTrainingData.CROP_PADDING,encoding:"image/png",
        note:"Square crop centred on the object, padded by a fraction of its own span so context is kept. sourceRect gives the exact source pixels."},
      trainedModel:false,
      producedBy:"MERIT EVENT MAKER Assisted Detection (classical computer vision) plus human decisions. No model was trained to produce this file.",
      summary:globalThis.MeritTrainingData.summarise(records),
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
  globalThis.MERIT_TRAINING_EXPORT=buildTrainingDatasetExport;

  function saveVerified(){
    const event=activeEvent();
    if(!ui.teachAI)return toast(t("toast.enableTeachFirst"),"error");
    const a=event.analysis;
    if(!a)return;
    getState().verifiedExamples.push({id:uid("verified"),eventId:event.id,savedAt:nowISO(),engine:a.engine,trainedModel:false,threshold:a.threshold,imageSize:[a.imageWidth,a.imageHeight],predictions:a.candidates.map(clone),groundTruth:a.candidates.filter(c=>c.status!=="rejected").map(clone),rejected:a.candidates.filter(c=>c.status==="rejected").map(c=>c.id),missed:[...a.missed],hardExample:a.missed.length>0||a.candidates.some(c=>c.status==="rejected")});
    saveState();
    toast(t("toast.verifiedPlanSaved"),"success",6000);
  }
  function improveAI(){
    if(!getState().verifiedExamples.length)return toast(t("toast.saveVerifiedFirst"),"error");
    const samples=getState().verifiedExamples.flatMap(v=>v.groundTruth||[]),avg=samples.length?samples.reduce((n,c)=>n+(c.confidence||0),0)/samples.length:0;
    getState().calibration={version:(getState().calibration?.version||0)+1,updatedAt:nowISO(),examples:getState().verifiedExamples.length,objects:samples.length,recommendedConfidence:Number(Math.max(.35,Math.min(.8,avg*.85)).toFixed(2)),trainedModel:false,label:"Local assisted-detection calibration; not a trained neural model"};
    saveState();
    toast(t("toast.calibrationDone",{v:getState().calibration.version,n:getState().verifiedExamples.length}),"success",6500);
  }
  function bindReview(){
    const ev=activeEvent();
    document.querySelectorAll("[data-vlm-action]").forEach(b=>b.onclick=()=>VLMSCREEN.onAction(b.dataset.vlmAction,b));
    document.querySelectorAll("[data-read-action]").forEach(b=>b.onclick=()=>READING.onAction(b.dataset.readAction,b));
    document.querySelectorAll("[data-budget-open]").forEach(b=>b.onclick=()=>REVIEW.openReviewQueue(ev,b.dataset.budgetOpen));
    const sceneForm=document.querySelector("[data-scene-form]");
    if(sceneForm)sceneForm.onsubmit=e=>{e.preventDefault();REVIEW.runSceneQuery(ev,String(new FormData(sceneForm).get("q")||""));};
    document.querySelectorAll("[data-queue]").forEach(b=>b.onclick=()=>{
      const a=b.dataset.queue;
      if(a==="prev")REVIEW.queueGo(ev,-1);
      else if(a==="skip"){
        const q=ui.reviewQueue;if(!q)return;
        const id=q.ids[q.index];
        if(id&&!q.skipped.includes(id))q.skipped.push(id);
        REVIEW.queueNextOutstanding(ev);
      }
      else if(a==="next-outstanding")REVIEW.queueNextOutstanding(ev);
      else if(a==="exit")REVIEW.closeReviewQueue();
    });
    document.querySelectorAll("[data-review-action]").forEach(b=>b.onclick=()=>{
      const action=b.dataset.reviewAction,event=activeEvent(),c=event.analysis?.candidates.find(x=>x.id===ui.selectedCandidateId);
      if(action==="back"){
        ui.planMode="plan";
        ui.activeReviewGroupId=null;
        ui.activeQuestionId=null;
        ui.selectedCandidateId=null;
        render();
      }else if(action==="reanalyze")ANALYSISRUN.runAssistedDetection();else if(action==="cancel-analysis")ANALYSISRUN.stopAnalysis();else if(action==="commit")commitCandidates();else if(action==="confirm"&&c){
        if(decideReview(event,{kind:"confirm",candidateId:c.id}))REVIEW.afterReviewDecision(event);
      }else if(action==="reject"&&c){
        if(decideReview(event,{kind:"reject",candidateId:c.id}))REVIEW.afterReviewDecision(event);
      }else if(action==="dismiss"&&c){
        // "Not important": kept in the analysis, rejected and marked dismissed --
        // never deleted -- so it can be undone and Re-Analyze does not ask again.
        if(decideReview(event,{kind:"notImportant",candidateId:c.id})){ui.selectedCandidateId=null;REVIEW.afterReviewDecision(event);}
      }else if(action==="teach"&&c){
        ui.teachScope=document.querySelector("[data-teach-scope]")?.value||"plan";
        TEACH.teachSelectedObject(event,c,ui.teachScope);
      }else if(action==="confirm-number"&&c){
        const scope=document.querySelector("[data-teach-scope]")?.value||"plan";
        TEACH.teachTableNumber(event,c,document.getElementById("poiNumber")?.value,scope);
      }else if(action==="forget"&&c){TEACH.forgetLesson(event,c);}else if(action==="find-similar"&&c){REFINE.findSimilar(event,c);}else if(action==="draw"){
        if(!ui.reviewDrawMode)SESSIONS.recordOperatorAction(event,"ai-missed-open",[]);
        ui.reviewDrawMode=!ui.reviewDrawMode;
        ui.activeReviewGroupId=null;
        ui.activeQuestionId=null;
        render();
      }else if(action==="save-verified")saveVerified();else if(action==="improve")improveAI();else if(action==="export-dataset")exportTrainingDataset();else if(action==="session-report"){
        ui.operatorReportOpen=true;
        render();
      }else if(action==="close-session-report"){
        ui.operatorReportOpen=false;
        render();
      }else if(action==="open-review-center"){
        ui.reviewCenterOpen=true;
        render();
      }else if(action==="close-review-center"){
        ui.reviewCenterOpen=false;
        render();
      }else if(action==="focus-group"){
        ui.activeReviewGroupId=b.dataset.group;
        ui.selectedCandidateId=null;
        ui.activeQuestionId=null;
        ui.reviewCenterOpen=true;
        render();
      }else if(action==="toggle-lang"){
        ui.lang=ui.lang==="tr"?"en":"tr";
        render();
      }
    });
    document.querySelectorAll("[data-candidate],[data-candidate-box]").forEach(node=>node.onclick=e=>{
      if(e.target.matches("input"))return;
      ui.selectedCandidateId=node.dataset.candidate||node.dataset.candidateBox;
      ui.activeReviewGroupId=null;
      ui.activeQuestionId=null;
      render();
    });
    document.querySelectorAll("[data-candidate-edit]").forEach(input=>input.onchange=()=>{
      const f=input.dataset.candidateEdit,v=input.value;
      requestAnimationFrame(()=>updateCandidateField(f,v));
    });
    document.querySelectorAll("[data-review-filter]").forEach(input=>input.oninput=()=>{
      if(input.dataset.reviewFilter==="status")ui.reviewFilter=input.value;else if(input.dataset.reviewFilter==="class")ui.reviewClass=input.value;else ui.reviewConfidence=Number(input.value);
      render();
    });
    document.querySelector("[data-teach-ai]")?.addEventListener("change",e=>{ui.teachAI=e.target.checked;});
    document.querySelectorAll("[data-reviewgroup-action]").forEach(b=>b.onclick=()=>{
      const event=activeEvent(),pi=event.analysis?.planIntelligence,group=pi?.reviewGroups.find(g=>g.id===b.dataset.group);if(!group)return;
      if(b.dataset.reviewgroupAction==="confirm-family"){
        const strong=group.memberIds.filter(id=>!group.outlierIds.includes(id));
        // Accepted in bulk: each label says it was not individually reviewed.
        if(!decideReview(event,{kind:"confirmFamily",ids:strong}))return;
        // The queue is only worth following if it reflects the answer just
        // given. Confirming a family removes it from review, changes the seat
        // and table counts every fact rests on, and can settle a
        // contradiction outright -- so the next question has to be computed
        // from the plan as it is now, not as it was at import.
        recomputePlanIntelligence(event);
        touchEvent(event);ui.reviewCenterOpen=group.outlierIds.length>0;render();
        toast(t("toast.groupConfirmed",{n:strong.length,objectWord:t(strong.length===1?"word.object":"word.objects"),title:group.title})+(group.outlierIds.length?" "+t("toast.outliersRemain",{n:group.outlierIds.length}):""),"success",5000);
      } else if(b.dataset.reviewgroupAction==="inspect"){
        ui.activeReviewGroupId=group.id;ui.selectedCandidateId=null;ui.activeQuestionId=null;ui.reviewCenterOpen=false;render();
      }
    });
    document.querySelectorAll("[data-question-action]").forEach(b=>b.onclick=()=>{
      const event=activeEvent(),pi=event.analysis?.planIntelligence,q=pi?.uncertainQuestions.find(x=>x.id===b.dataset.question);if(!q)return;
      const action=b.dataset.questionAction;
      if(action==="open"){ui.activeQuestionId=q.id;ui.activeReviewGroupId=null;ui.selectedCandidateId=null;ui.reviewCenterOpen=false;render();return;}
      // One question can stand for several identical arrangements, and each of
      // them gets its OWN decision record: a grouping decision belongs to the
      // tables it is about, and one record shared across arrangements is the
      // data-model bug already fixed once in this repository.
      const groupIds=q.groupIds?.length?q.groupIds:[q.groupId];
      const groups=groupIds.map(id=>pi.furnitureGroups.find(g=>g.id===id)).filter(Boolean);
      const memberIds=groups[0]?.memberIds||[];
      if(!canMutate(event,"answer a plan question"))return;
      const decision=action==="yes"?"merged":"separate";
      SESSIONS.recordOperatorAction(event,`grouping-${decision}`,groups.flatMap(g=>g.memberIds||[]));
      event.analysis.groupingDecisions ||= [];
      for(const group of groups){
        event.analysis.groupingDecisions.push({id:uid("groupdecision"),memberIds:[...group.memberIds],decision,decidedAt:nowISO(),fromQuestionId:q.id});
        getState().verifiedExamples.push({id:uid("verified"),eventId:event.id,savedAt:nowISO(),kind:"grouping-question",question:q.question,answer:action==="yes"?"one-group":"separate-tables",memberCandidateIds:group.memberIds});
      }
      recomputePlanIntelligence(event);
      const newPi=event.analysis.planIntelligence;
      touchEvent(event);ui.activeQuestionId=null;render();
      toast(decision==="merged"
        ?t("toast.confirmedOneGroup",{n:newPi.planSummary.diningGroups})
        :t("toast.splitIntoTables",{count:memberIds.length,n:newPi.planSummary.diningGroups}),
        "success",6000);
    });
    document.querySelectorAll("[data-review-decision-action='undo-correction']").forEach(b=>b.onclick=()=>{
      const n=undoReviewDecision(activeEvent());
      render();
      if(n)toast(t("review.undoCorrectionToast",{n}),"success",5000);
    });
    document.querySelectorAll("[data-review-decision-action='undo-last']").forEach(b=>b.onclick=()=>{
      const event=activeEvent();if(!canMutate(event,"undo a plan decision"))return;
      const decisions=event.analysis?.groupingDecisions;if(!decisions?.length)return;
      const undone=decisions.pop();recomputePlanIntelligence(event);touchEvent(event);render();
      toast(t("toast.decisionUndone",{what:t(undone.decision==="merged"?"toast.decisionOneGroup":"toast.decisionSeparate")}),"success",5000);
    });
    bindReviewDrawing();
  }
    return{applyReviewWrites,bindReview,decideReview,retractedDecisions,undoReviewDecision};
  }
  globalThis.MeritReviewCommands=Object.freeze({create,DEPS:Object.freeze(["ANALYSISRUN","LEARNING","PLANEDIT","READING","REFINE","REVIEW","RULES","SESSIONS","TEACH","UNVERIFIED_SEATING","VLMSCREEN","WORLD","activeEvent","audit","canMutate","clone","getState","nowISO","printedEvidence","recomputePlanIntelligence","recordUndo","render","saveState","storageProvider","t","toast","touchEvent","ui","uid"])});
})();
