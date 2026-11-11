// What the plan can say about itself, and the Teach Area: is the printed
// numbering intact, can the plan check itself, the confidence budget, and the
// Teach Area's lessons — keep one (a scoped note, never training: it changes
// ONE object, within the scope the operator chose), apply them to an analysis,
// forget and restore one. Moved out of app-v8.js on 2026-11-08 (code health,
// capability 16 of 21, benchmarks/CODE-HEALTH-2026-11.md), at the original
// indentation, by scripts/extract-capability.mjs; the section comments and the
// suite-facing MeritTeachAreaWiring publication travelled with the code. The
// edit forced by the move: `state` is read through getState().
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let applyReviewWrites;
  let audit;
  let canMutate;
  let getState;
  let nowISO;
  let recomputePlanIntelligence;
  let render;
  let saveState;
  let t;
  let toast;
  let toastAction;
  let touchEvent;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritPlanTeach.create() is called once, by app-v8.js.");
    created=true;
    applyReviewWrites=deps.applyReviewWrites;
    audit=deps.audit;
    canMutate=deps.canMutate;
    getState=deps.getState;
    nowISO=deps.nowISO;
    recomputePlanIntelligence=deps.recomputePlanIntelligence;
    render=deps.render;
    saveState=deps.saveState;
    t=deps.t;
    toast=deps.toast;
    toastAction=deps.toastAction;
    touchEvent=deps.touchEvent;
  // ---- is the numbering intact? --------------------------------------------
  //
  // A separate layer over the numbers, because reading a symbol and trusting a
  // numbering are different jobs: only the whole set can say whether anything
  // is claimed twice or missing. It repairs nothing — a gap between 136 and 138
  // is reported as a gap, never filled in with 137.
  //
  // What it compares against comes from the DRAWING, not from a constant. The
  // stated table count is whatever the printed capacity rule said, if OCR read
  // one; with no such figure there is simply no range to be outside of, and
  // the layer says less rather than inventing a ceiling.
  function checkNumberIntegrity(event){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritNumberIntegrity)return;
    const tables=(analysis.candidates||[]).filter(c=>c.kind==="table"&&c.printedNumber);
    if(!tables.length)return;
    const rule=analysis.planIntelligence?.capacityAudit?.rule||null;
    analysis.numberIntegrity=globalThis.MeritNumberIntegrity.analyse({
      tables,
      statedCount:rule&&typeof rule.units==="number"?rule.units:null,
      statedCountSource:rule?`the capacity rule the drawing prints (${rule.units} x ${rule.perUnit} = ${rule.total})`:null,
    });
  }
  // ---- can the plan check itself? ------------------------------------------
  //
  // Not another detector: it reads nothing, measures nothing and adds no engine
  // calls. It compares the numbers already known against each other — what the
  // drawing states, what the detector found, what the arithmetic gives, what a
  // person confirmed — and says where they agree.
  //
  // `drawsSeats` is the guard that keeps one particular false finding buried.
  // Comparing a printed pax figure against a counted seat total means something
  // on a plan that draws seats and nothing on one that does not; "2064 stated,
  // 0 counted" is a restatement of what kind of drawing it is dressed up as a
  // discovery. It was withdrawn in an earlier sprint and must not return
  // through this layer, so the representation decision gates it.
  function runSelfCheck(event){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritSelfCheck)return;
    const pi=analysis.planIntelligence||{};
    const representation=analysis.diagnostics?.representation||null;
    const drawsSeats=!!representation&&representation.kind==="PHYSICAL";
    analysis.selfCheck=globalThis.MeritSelfCheck.run({
      capacityAudit:pi.capacityAudit||null,
      tablesDetected:(analysis.candidates||[]).filter(c=>c.kind==="table"&&c.status!=="rejected").length,
      seatsCounted:pi.planSummary?.physicalSeats??null,
      drawsSeats,
      numberIntegrity:analysis.numberIntegrity||null,
    });
  }
  // ---- the confidence budget ------------------------------------------------
  //
  // Runs LAST of everything, because it consumes what every other layer
  // concluded and nothing consumes it. Counted one line per uncertain fact the
  // two real plans produce 119 and 278 items; this decides which handful of
  // them is worth an operator's attention, and reports the rest rather than
  // dropping it. See src/plan-confidence-budget.js for what the measurement
  // said and why the ranking has no tunable weights.
  function runConfidenceBudget(event){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritConfidenceBudget)return;
    const pi=analysis.planIntelligence||{};
    const alive=(analysis.candidates||[]).filter(c=>c.status!=="rejected");
    const withState=s=>alive.filter(c=>c.printedNumber&&c.printedNumber.state===s);
    const needsReview=withState("NEEDS_REVIEW"),unknown=withState("UNKNOWN");
    analysis.confidenceBudget=globalThis.MeritConfidenceBudget.run({
      reviewPriorities:pi.reviewPriorities||[],
      numbers:{needsReview:needsReview.length,needsReviewIds:needsReview.map(c=>c.id),
        unknown:unknown.length,unknownIds:unknown.map(c=>c.id)},
      numberIntegrity:analysis.numberIntegrity||null,
      selfCheck:analysis.selfCheck||null,
      teachArea:analysis.teachArea||null,
    });
  }
  // ---- the Teach Area -------------------------------------------------------
  //
  // What a person who knows the room knows, kept with the reach they gave it.
  // The engine is src/plan-teach-area.js; this is the wiring, and the wiring has
  // two jobs the module deliberately does not do for itself: decide WHERE the
  // open drawing sits, and decide what "applying" a lesson actually means.
  //
  // Nothing here trains anything. A lesson is a stored note, re-offered on a
  // drawing it applies to; teaching a hundred of them leaves the detector
  // exactly as good and exactly as bad as it was before the first one.
  const OCR_REASON_KEY={ENGINE_NOT_LOADED:"ocr.reason.ENGINE_NOT_LOADED",TIMEOUT:"ocr.reason.TIMEOUT",FAILED:"ocr.reason.FAILED"};
  function teachWhere(event){
    return{planHash:event?.analysis?.planHash??null,
      layoutId:event?.venueRef?.layoutId??null,
      layoutVersionId:event?.venueRef?.layoutVersionId??null,
      venueId:event?.venueRef?.venueId??null};
  }
  // Applied lessons are RECORDED on the object, not folded in silently: the
  // review card shows the scope and the reason, so an operator can always see
  // that a change came from a note they wrote rather than from the detector.
  // Only APPLY proposals are acted on — REVIEW and AMBIGUOUS are carried to the
  // screen for a person to settle, which is the whole difference between this
  // and spreading a correction across everything that looks similar.
  function applyTeachArea(event){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritTeachArea)return;
    const inForce=globalThis.MeritTeachArea.inForce(getState().teachings||[],teachWhere(event));
    const alive=(analysis.candidates||[]).filter(c=>c.status!=="rejected");
    const result=globalThis.MeritTeachArea.propose(inForce.lessons,
      alive.map(c=>({id:c.id,kind:c.kind,type:c.type,x:c.x,y:c.y,w:c.w,h:c.h,
        vector:c.visualDescriptor?.vector||null,printedNumber:c.printedNumber||null})));
    const byId=new Map(inForce.lessons.map(l=>[l.id,l]));
    let applied=0,numbersChanged=false;
    for(const p of result.proposals){
      if(p.state!=="APPLY"||!p.candidateId)continue;
      const c=analysis.candidates.find(x=>x.id===p.candidateId),l=byId.get(p.lessonId);
      if(!c||!l)continue;
      const was={kind:c.kind,type:c.type,status:c.status,printedNumber:c.printedNumber||null};
      if(l.subject.kind==="objectIdentity"){
        if(l.subject.objectKind&&l.subject.objectKind!==c.kind){
          c.kind=l.subject.objectKind;
          if(c.kind!=="table")c.chairDetections=[];
        }
        c.type=l.subject.type;
        c.typeBasis="rememberedByAPerson";
        c.status="confirmed";c.selected=true;
      }else if(l.subject.kind==="tableNumber"&&typeof l.subject.value==="number"){
        // A person outranks two agreeing crops, so this is VERIFIED — but the
        // source says which of the two it was, because the reader of a number
        // has to be able to tell "the drawing was read twice" from "someone
        // told us".
        c.printedNumber={value:l.subject.value,state:"VERIFIED",confidence:null,
          suggestion:null,why:"a person confirmed this number",
          readings:[],source:"confirmed by a person"};
        numbersChanged=true;
      }else continue;
      c.taughtFrom={lessonId:l.id,scope:l.scope,why:p.why,at:nowISO(),was};
      applied++;
    }
    // A number a person supplied is part of the numbering, so the integrity
    // report has to be re-derived from it — otherwise the screen would show a
    // gap the operator has just filled.
    if(numbersChanged)checkNumberIntegrity(event);
    analysis.teachArea={applied,summary:result.summary,proposals:result.proposals,
      superseded:inForce.superseded,
      lessons:inForce.lessons.map(l=>({id:l.id,scope:l.scope,text:globalThis.MeritTeachArea.describe(l)})),
      statement:result.statement};
  }
  // Teaching is an explicit act with an explicit reach. The scope comes from a
  // control the operator sets, never inferred, and a refusal is shown to them
  // rather than swallowed: "not remembered, because across a venue an object has
  // to be identified by its printed number" is the message that makes them pick
  // the scope that works.
  // Confirming a table's printed number, which the Teach Area has supported
  // since it was built and nothing ever offered. It is the same lesson
  // machinery, with a `tableNumber` subject instead of an identity one -- and
  // it is the thing that unlocks venue scope, because across a venue an object
  // can only be identified by a number a person has stood behind.
  // THE SHARED BODY OF KEEPING A LESSON: build it, refuse visibly, store it,
  // audit it, say so, re-apply. `teachTableNumber` and `teachSelectedObject`
  // did these seven steps identically; what differs is passed in, never
  // defaulted (`benchmarks/CODE-INVENTORY.md` §2.1).
  //
  // `printedNumber` IS REQUIRED AND HAS NO DEFAULT. It is the one field that
  // differs for a load-bearing reason: confirming a number makes that number
  // the object's verified identity, and a venue-scoped lesson is refused for an
  // object without one. A helper that filled it in from the candidate would
  // refuse the operator's venue-scoped number confirmation by the very rule
  // they had just satisfied — `teach-venue-scope` fails on exactly that
  // mutation, while the two suites that already covered this area pass. So an
  // omitted value THROWS rather than falling back; `null` is the honest "no
  // number", `undefined` is a caller that forgot.
  function keepLesson(event,c,{scope,subject,printedNumber,auditAction,auditDetail,toastText}){
    if(!canMutate(event,"keep a lesson"))return;
    if(printedNumber===undefined)
      throw new Error("keepLesson: printedNumber must be passed explicitly — null for none, never omitted");
    const alive=(event.analysis?.candidates||[]).filter(x=>x.status!=="rejected");
    const r=globalThis.MeritTeachArea.lesson({
      scope,where:teachWhere(event),subject,
      from:{candidateId:c.id,kind:c.kind,type:c.type,
        geometry:{x:c.x,y:c.y,w:c.w,h:c.h,rotation:c.rotation||0},
        printedNumber,
        visual:c.visualDescriptor?.vector?{vector:Array.from(c.visualDescriptor.vector)}:null,
        context:globalThis.MeritPlanMemory?globalThis.MeritPlanMemory.contextSignature(c,alive):null},
    });
    if(!r.ok)return toast(t("teachArea.refused",{reason:r.reason}),"error",8000);
    getState().teachings ||= [];
    getState().teachings.push(r.lesson);
    saveState();
    audit(event,auditAction,{scope:r.lesson.scope,...auditDetail(r.lesson),
      text:globalThis.MeritTeachArea.describe(r.lesson)});
    applyTeachArea(event);recomputePlanIntelligence(event);touchEvent(event);render();
    // Undo is forgetting it at once, through the same writer as Forget — the
    // object gets the detector's own answer back, with nothing left claiming
    // a person wrote it.
    toastAction(toastText(r.lesson),t("teachArea.undo"),()=>{
      const taught=(event.analysis?.candidates||[]).find(x=>x.taughtFrom?.lessonId===r.lesson.id);
      if(taught)forgetLesson(event,taught);
      else if(canMutate(event,"undo a lesson")){getState().teachings=(getState().teachings||[]).filter(l=>l.id!==r.lesson.id);saveState();audit(event,"TEACH_AREA_LESSON_FORGOTTEN",{lessonId:r.lesson.id});render();}
    },"success",8000);
  }
  function teachTableNumber(event,c,value,scope){
    if(!globalThis.MeritTeachArea||!c)return;
    const n=Number(value);
    if(!Number.isFinite(n)||n<=0||n!==Math.round(n))
      return toast(t("number.notANumber"),"error",5000);
    keepLesson(event,c,{scope,
      subject:{kind:"tableNumber",value:n},
      // The number the operator is confirming is what identifies this object
      // from here on, so it travels as the object's own printed number --
      // otherwise a venue-scoped lesson about it would be refused by the very
      // rule the operator has just satisfied.
      printedNumber:{state:"VERIFIED",value:n},
      auditAction:"TEACH_AREA_NUMBER_CONFIRMED",
      auditDetail:()=>({value:n}),
      toastText:l=>t("number.confirmedToast",{n,scope:t("teachArea.scope."+l.scope)})});
  }
  // Whether a scope can be offered at all, and why not when it cannot.
  //
  // The Teach Area refuses a venue-wide lesson about an object with no
  // confirmed number, and used to refuse it AFTER the click -- the operator
  // chose a scope, pressed the button, and was told no. The rule is knowable
  // beforehand, so it is stated beforehand, next to the option it disables.
  function scopeAvailability(c){
    const verified=c&&c.printedNumber&&c.printedNumber.state==="VERIFIED"
      &&typeof c.printedNumber.value==="number";
    return{
      plan:{ok:true},
      layout:{ok:true},
      venue:verified?{ok:true}
        :{ok:false,why:t("teachArea.venueNeedsNumber")},
    };
  }
  function teachSelectedObject(event,c,scope){
    if(!globalThis.MeritTeachArea||!c)return;
    keepLesson(event,c,{scope,
      subject:{kind:"objectIdentity",objectKind:c.kind,type:c.type,label:t("teach.type."+c.type)},
      // The object's OWN number, whatever state it is in. Passed explicitly,
      // including when it is null, because the helper refuses to guess.
      printedNumber:c.printedNumber||null,
      auditAction:"TEACH_AREA_LESSON_KEPT",
      auditDetail:l=>({subject:l.subject}),
      toastText:l=>t("teachArea.kept",{label:t("teach.type."+c.type),scope:t("teachArea.scope."+l.scope)})});
  }
  // The other half of teaching. A note a person cannot take back is not a note,
  // it is a decision made on their behalf: forgetting removes the lesson from
  // the Teach Area entirely and puts the detector's own answer back, so the
  // object is not left holding a classification with no author.
  function forgetLesson(event,c){
    if(!canMutate(event,"forget a lesson"))return;
    const id=c?.taughtFrom?.lessonId;if(!id)return;
    const scope=c.taughtFrom.scope,lesson=(getState().teachings||[]).find(l=>l.id===id)||null;
    getState().teachings=(getState().teachings||[]).filter(l=>l.id!==id);
    // The detector's own answer back, through the same field writer as every
    // review decision (MeritReviewDecisions "forgetLesson").
    const p=globalThis.MeritReviewDecisions.plan({kind:"forgetLesson",candidateId:c.id},{candidates:[c]});
    if(p.ok)for(const w of p.writes)applyReviewWrites(c,w.set);
    else{delete c.taughtFrom;delete c.typeBasis;}
    saveState();
    audit(event,"TEACH_AREA_LESSON_FORGOTTEN",{lessonId:id});
    applyTeachArea(event);recomputePlanIntelligence(event);touchEvent(event);render();
    // Undo puts back the SAME stored lesson — its id, scope and the object it
    // was taught on — and lets the Teach Area apply it as it applies any note.
    if(lesson)toastAction(t("teachArea.forgotten",{scope:t("teachArea.scope."+scope)}),t("teachArea.undo"),()=>restoreLesson(event,lesson),"success",8000);
    else toast(t("teachArea.forgotten",{scope:t("teachArea.scope."+scope)}),"success",5000);
  }
  function restoreLesson(event,lesson){
    if(!canMutate(event,"restore a lesson"))return;
    getState().teachings ||= [];
    if(getState().teachings.some(l=>l.id===lesson.id))return;
    getState().teachings.push(lesson);
    saveState();
    audit(event,"TEACH_AREA_LESSON_RESTORED",{lessonId:lesson.id,scope:lesson.scope});
    applyTeachArea(event);recomputePlanIntelligence(event);touchEvent(event);render();
    toast(t("teachArea.restored",{scope:t("teachArea.scope."+lesson.scope)}),"success",5000);
  }
  // Exposed for the regression suite. The engine (src/plan-teach-area.js) can be
  // tested on its own, but the two decisions that matter most live here: what
  // "where am I" means for the open drawing, and what applying a lesson does to
  // a candidate. Driving them directly is how the round trip — teach it, throw
  // the answer away, get it back — is checked without a 30-second detection run.
  globalThis.MeritTeachAreaWiring={teachWhere,applyTeachArea,teachSelectedObject,forgetLesson,restoreLesson};
    return{OCR_REASON_KEY,applyTeachArea,checkNumberIntegrity,forgetLesson,runConfidenceBudget,runSelfCheck,scopeAvailability,teachSelectedObject,teachTableNumber};
  }
  globalThis.MeritPlanTeach=Object.freeze({create,DEPS:Object.freeze(["applyReviewWrites","audit","canMutate","getState","nowISO","recomputePlanIntelligence","render","saveState","t","toast","toastAction","touchEvent"])});
})();
