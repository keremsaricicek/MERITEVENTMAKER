// The review-session log: what a real person did while reviewing a plan —
// when the session started, each action, and where it sat in the order the
// product had suggested — and the one-page report built from it.
//
// Moved byte-for-byte out of app-v8.js on 2026-11-01 (code health), at the
// original indentation. The edits forced by the move: `state` is read
// through getState(), because the shell reassigns it; the two read-only test
// hooks (globalThis.MeritOperatorSessions, globalThis.MeritOperatorReport)
// stay in the shell, which owns the active event, and call this module.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that).
(() => {
  "use strict";
  let activeEvent;
  let esc;
  let getState;
  let nowISO;
  let t;
  let ui;
  let uid;
  let created=false;

  // ---- operator sessions: what a real person actually did -----------------
  //
  // Every number in benchmarks/review-order/ is about reaching an error, not
  // about a person resolving one. The queue is measured against ground truth
  // by a script that never gets confused, never scrolls past a card, and never
  // decides the third question is not worth answering. Whether the screen works
  // for someone doing this job is a different question and this code cannot
  // answer it — it can only make the answer recordable.
  //
  // So this records what actually happened in a review session: when it
  // started, what was done, in what order, and how that order compares to the
  // one the product suggested. It is the instrument, not the result.
  //
  // ENTIRELY LOCAL. It lives in state alongside everything else, it is written
  // by the same storage provider, and there is no network path out of it — no
  // fetch, no beacon, no analytics endpoint, not behind a flag. A tool that
  // watches an operator work and can also phone home is a different product
  // from the one the user agreed to run.
  const OPERATOR_SESSION_MAX = 50;
  function operatorSession(event){
    const analysisId=event.analysis?.id;
    if(!analysisId)return null;
    getState().operatorSessions ||= [];
    let s=getState().operatorSessions.find(x=>x.analysisId===analysisId);
    if(!s){
      s={id:uid("session"),analysisId,eventId:event.id,startedAt:nowISO(),
        startedAtMs:Date.now(),actions:[],
        // The order the product proposed at the moment the session opened, so
        // "did they follow it" is measured against what they were actually
        // shown rather than against a queue recomputed after their edits.
        suggestedOrder:(event.analysis.planIntelligence?.reviewPriorities||[])
          .map(p=>({key:p.key,targetIds:p.targetIds||[]}))};
      getState().operatorSessions.push(s);
      if(getState().operatorSessions.length>OPERATOR_SESSION_MAX)
        getState().operatorSessions=getState().operatorSessions.slice(-OPERATOR_SESSION_MAX);
    }
    return s;
  }
  function recordOperatorAction(event,type,targetIds){
    const s=operatorSession(event);
    if(!s)return;
    const ids=(Array.isArray(targetIds)?targetIds:[targetIds]).filter(Boolean);
    // Which suggested item this action landed on, if any. -1 means the operator
    // worked somewhere the queue never pointed, which is itself a finding.
    const position=s.suggestedOrder.findIndex(p=>p.targetIds.some(id=>ids.includes(id)));
    s.actions.push({at:nowISO(),sinceStartMs:Date.now()-s.startedAtMs,
      type,targetIds:ids,suggestedPosition:position});
  }
  // A read-only summary for the operator-usability harness. Deliberately not
  // rendered anywhere: an operator being shown their own speed while working is
  // a different product decision, and one nobody asked for.
  function operatorSessionSummary(analysisId){
    const s=(getState().operatorSessions||[]).find(x=>x.analysisId===analysisId);
    if(!s)return null;
    const acts=s.actions;
    const onQueue=acts.filter(a=>a.suggestedPosition>=0);
    return{
      sessionId:s.id,analysisId:s.analysisId,startedAt:s.startedAt,
      suggestedItems:s.suggestedOrder.length,
      actions:acts.length,
      byType:acts.reduce((m,a)=>(m[a.type]=(m[a.type]||0)+1,m),{}),
      msToFirstAction:acts.length?acts[0].sinceStartMs:null,
      msToLastAction:acts.length?acts[acts.length-1].sinceStartMs:null,
      // Of the actions that landed on a suggested item, how far down the list
      // it was. A person working strictly top-down averages near 0.
      onQueueActions:onQueue.length,
      offQueueActions:acts.length-onQueue.length,
      meanSuggestedPosition:onQueue.length
        ? +(onQueue.reduce((n,a)=>n+a.suggestedPosition,0)/onQueue.length).toFixed(2):null,
      firstActionWasTopOfQueue:acts.length?acts[0].suggestedPosition===0:null,
    };
  }

  // ---- the import-to-confirm report ---------------------------------------
  //
  // The operator test is only worth running if the person running it does not
  // have to open a developer console to get the result. This assembles what the
  // session and the plan's own timings already recorded into one page an
  // operator can read, copy and send.
  //
  // It reports what happened. It does not grade it: there is no baseline for a
  // "good" review time and inventing one would be the same overclaiming this
  // product refuses everywhere else.
  function operatorReport(event){
    const a=event.analysis;
    if(!a)return null;
    const s=operatorSessionSummary(a.id),tm=a.timings||{};
    const pi=a.planIntelligence,secs=ms=>ms==null?null:Math.round(ms/100)/10;
    const alive=a.candidates.filter(c=>c.status!=="rejected");
    return{
      plan:event.background?.name||null,
      analysisId:a.id,
      timings:{
        importToAnalysisS:secs(tm.analysisStartedAtMs&&tm.importedAtMs&&tm.analysisStartedAtMs-tm.importedAtMs),
        analysisS:secs(tm.analysisCompletedAtMs&&tm.analysisStartedAtMs&&tm.analysisCompletedAtMs-tm.analysisStartedAtMs),
        reviewS:secs(tm.confirmedAtMs&&tm.analysisCompletedAtMs&&tm.confirmedAtMs-tm.analysisCompletedAtMs),
        importToConfirmS:secs(tm.confirmedAtMs&&tm.importedAtMs&&tm.confirmedAtMs-tm.importedAtMs),
        toFirstActionS:secs(s?.msToFirstAction),
      },
      actions:{
        total:s?.actions??0,byType:s?.byType||{},
        onQueue:s?.onQueueActions??0,offQueue:s?.offQueueActions??0,
        startedAtTopOfQueue:s?.firstActionWasTopOfQueue??null,
        meanQueuePosition:s?.meanSuggestedPosition??null,
      },
      plan_state:{
        objectsDetected:alive.length,
        stillUnreviewed:a.candidates.filter(c=>c.status==="unreviewed").length,
        heldBack:alive.filter(c=>c.lowEvidence).length,
        reviewItemsLeft:pi?.reviewPriorities?.length??null,
        openDisagreements:pi?.contradictions?.length??null,
        manuallyAdded:(a.missed||[]).length,
      },
      undoAvailable:(ui.correctionUndo||[]).length,
      confirmed:!!tm.confirmedAtMs,
    };
  }
  function operatorReportHTML(event){
    const r=operatorReport(event);
    if(!r)return`<p class="op-report-empty">${t("op.noSession")}</p>`;
    const row=(k,v)=>`<tr><th>${esc(t(k))}</th><td>${v==null?"—":esc(String(v))}</td></tr>`;
    const T=r.timings,A=r.actions,P=r.plan_state;
    return`<table class="op-report">`
      +row("op.plan",r.plan)
      +row("op.importToConfirm",T.importToConfirmS!=null?`${T.importToConfirmS} s`:null)
      +row("op.analysisTime",T.analysisS!=null?`${T.analysisS} s`:null)
      +row("op.reviewTime",T.reviewS!=null?`${T.reviewS} s`:null)
      +row("op.toFirstAction",T.toFirstActionS!=null?`${T.toFirstActionS} s`:null)
      +row("op.actions",A.total)
      +row("op.onQueue",`${A.onQueue} / ${A.onQueue+A.offQueue}`)
      +row("op.startedAtTop",A.startedAtTopOfQueue==null?null:t(A.startedAtTopOfQueue?"op.yes":"op.no"))
      +row("op.objects",P.objectsDetected)
      +row("op.unreviewed",P.stillUnreviewed)
      +row("op.heldBack",P.heldBack)
      +row("op.reviewLeft",P.reviewItemsLeft)
      +row("op.disagreements",P.openDisagreements)
      +row("op.manuallyAdded",P.manuallyAdded)
      +row("op.confirmed",t(r.confirmed?"op.yes":"op.no"))
      +`</table>`
      // The questions only a person can answer. Printed with the numbers so the
      // whole thing is one page to fill in and send back.
      +`<strong class="op-report-h">${t("op.questions")}</strong><ol class="op-report-q">`
      +["understood","obviouslyWrong","missedSomething","unnecessary","teachAI","explainUseful","slow","confusing"]
        .map(k=>`<li>${esc(t("op.q."+k))}</li>`).join("")
      +`</ol>`;
  }

  function create(deps){
    if(created)throw new Error("MeritReviewSessionLog.create() is called once, by app-v8.js.");
    created=true;
    activeEvent=deps.activeEvent;
    esc=deps.esc;
    getState=deps.getState;
    nowISO=deps.nowISO;
    t=deps.t;
    ui=deps.ui;
    uid=deps.uid;
    return{recordOperatorAction,operatorSessionSummary,operatorReport,operatorReportHTML};
  }
  globalThis.MeritReviewSessionLog=Object.freeze({create,DEPS:Object.freeze(["activeEvent","esc","getState","nowISO","t","ui","uid"])});
})();
