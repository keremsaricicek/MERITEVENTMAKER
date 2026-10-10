// The review screen's MODEL READING: a person sends the plan to a
// vision-language model through the relay on this page's own origin
// (server/vlm-relay.mjs), and the model's findings come back as marks on the
// same plan and a list beside it, each one waiting for a person.
//
// The order is fixed and every step is the operator's:
//   1. the button opens the panel and asks the relay what it is (status) —
//      nothing is sent by opening it; "Check connection" asks the API whether
//      the key and the model are accepted, which costs nothing;
//   2. "Send plan" shows exactly what will travel (the plan image at its pixel
//      size, the detector's boxes, the printed text read off the plan — and
//      what will not: no guest, no note, no event name) with the relay's spend
//      caps, and sends only on a yes;
//   3. the whole plan goes first; the model may name up to four regions to
//      look at closely, and each is sent as a zoomed crop; Cancel stops the
//      run at any point, including the request in flight;
//   4. each finding is Accepted or Dismissed one at a time. Accept goes
//      through the shell's existing writers — decideReview for a type or a
//      rejection (one object, never its family), the missed-object path for a
//      new object, the typed seat-count path for seats — so memory, training
//      capture, audit and undo behave as if the person had done it by hand,
//      and say it came from a model suggestion.
//
// An answer that arrives for an older analysis, another plan, another event
// or a cancelled run is refused whole (MeritVlmReview.staleReason). Findings
// are kept on the analysis they were made about (analysis.vlm) and vanish
// with it when the plan is analysed again.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that).
(() => {
  "use strict";
  let activeEvent;
  let addVlmCandidate;
  let applyReviewZoom;
  let ask;
  let audit;
  let canMutate;
  let decideReview;
  let esc;
  let icon;
  let render;
  let setVlmSeats;
  let t;
  let toast;
  let touchEvent;
  let ui;
  let created=false;

  const RELAY="/vlm-relay";
  const SEND_LIMIT_BYTES=3.6*1024*1024; // under the API's 5 MB per image once base64-encoded
  const V=()=>globalThis.MeritVlmReview;
  // Session-only: what the relay said, whether a run is in flight. Nothing
  // here is persisted; the findings live on the analysis.
  const session={relay:null,probing:false,busy:false,controller:null,runId:null,progress:null,check:null,checking:false,focusId:null};
  const served=()=>/^https?:$/.test(globalThis.location&&globalThis.location.protocol||"");
  const num=(n)=>{const v=Number(n);return Number.isFinite(v)?Math.round(v*100)/100:0;};
  const money=(n)=>"$"+(Number(n)||0).toFixed(2);
  // A code from the relay may be one this build has no words for (a newer
  // relay): the general sentence, with the code, rather than a raw key.
  const tx=(prefix,code)=>{const k=prefix+code,s=t(k);return s===k?`${t(prefix+"RELAY_ERROR")} (${code})`:s;};

  // ---- the relay --------------------------------------------------------------
  async function probe(){
    session.probing=true;render();
    try{
      const r=await globalThis.fetch(RELAY+"/status",{cache:"no-store",credentials:"same-origin"});
      let j=null;try{j=r.ok?await r.json():null;}catch{j=null;}
      session.relay=j&&j.relay===true?j:{relay:false,http:r.status};
    }catch{session.relay={relay:false,http:0};}
    session.probing=false;render();
    return session.relay;
  }
  async function post(path,body,signal){
    let r;
    try{r=await globalThis.fetch(RELAY+path,{method:"POST",headers:{"content-type":"application/json","x-merit-relay":"1"},body:JSON.stringify(body),signal,cache:"no-store",credentials:"same-origin"});}
    catch(e){return{ok:false,code:signal&&signal.aborted?"CANCELLED":"UNREACHABLE"};}
    let j=null;
    try{j=await r.json();}catch{return{ok:false,code:signal&&signal.aborted?"CANCELLED":r.status===404?"NO_RELAY":"RELAY_ERROR"};}
    return j&&typeof j==="object"?j:{ok:false,code:"RELAY_ERROR"};
  }

  // ---- pixels -----------------------------------------------------------------
  async function loadImage(src){const img=new globalThis.Image();img.src=src;await img.decode();return img;}
  // The part of the plan `frame` covers, at the size MeritVlmReview.fitSize
  // allows: PNG when it fits the limit (line drawings stay sharp), JPEG when not.
  function encodeFrame(img,frame,opts){
    const W=img.naturalWidth,H=img.naturalHeight;
    const sx=frame.x/100*W,sy=frame.y/100*H,sw=frame.w/100*W,sh=frame.h/100*H;
    const size=V().fitSize(sw,sh,opts);
    if(!size)throw new Error("IMAGE");
    const canvas=document.createElement("canvas");canvas.width=size.width;canvas.height=size.height;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#ffffff";ctx.fillRect(0,0,size.width,size.height);
    ctx.imageSmoothingQuality="high";
    ctx.drawImage(img,sx,sy,sw,sh,0,0,size.width,size.height);
    const limit=Math.min(SEND_LIMIT_BYTES,(session.relay&&session.relay.limits&&session.relay.limits.maxImageBytes)||SEND_LIMIT_BYTES);
    for(const [type,q] of [["image/png",undefined],["image/jpeg",.92],["image/jpeg",.8]]){
      const url=canvas.toDataURL(type,q),data=url.slice(url.indexOf(",")+1);
      if(data.length*3/4<=limit)return{mediaType:type,data,width:size.width,height:size.height};
    }
    throw new Error("IMAGE_TOO_LARGE");
  }

  // ---- one reading ---------------------------------------------------------------
  const currentKeys=()=>{const e=activeEvent(),a=e&&e.analysis;return{eventId:e&&e.id,analysisId:a&&a.id,planHash:a&&a.planHash||null};};

  async function start(){
    const event=activeEvent(),a=event&&event.analysis;
    if(!a||session.busy)return;
    if(!canMutate(event,"read the plan with a vision-language model"))return;
    const st=await probe();
    if(!st.relay||!st.configured)return; // the panel says why, persistently
    let img,overview;
    try{img=await loadImage(event.background.src);overview=encodeFrame(img,V().WHOLE,{maxEdge:V().IMAGE_MAX_EDGE});}
    catch{session.progress=null;toast(t("vlm.toast.image"),"error",6000);return;}
    const preview=V().payloadFor({analysis:a,planHash:a.planHash||null,runId:"run_preview",step:"overview",lang:ui.lang,frame:V().WHOLE,image:overview});
    const L=st.limits||{},U=st.usage||{};
    const yes=await ask({title:t("vlm.ask.title"),confirmLabel:t("vlm.ask.send"),body:[
      t("vlm.ask.sent",{w:overview.width,h:overview.height,boxes:preview.body.candidates.length,texts:preview.body.printedText.length,regions:Math.max(0,Math.min(V().MAX_REGIONS,(L.maxStepsPerRun||1)-1))}),
      t("vlm.ask.notSent"),
      t("vlm.ask.where",{model:st.model}),
      t("vlm.ask.caps",{run:money(L.maxUsdPerRun),day:money(L.maxUsdPerDay),spent:money(U.usd),requests:U.requests||0,maxRequests:L.maxRequestsPerDay||0}),
      t("vlm.ask.suggestions"),
    ].join("\n\n")});
    if(!yes)return;
    // Anything that changed while the question was open makes this a
    // different plan from the one the person agreed to send.
    if(activeEvent()!==event||event.analysis!==a){toast(t("vlm.toast.changed"),"error",6000);return;}
    const run={runId:V().newRunId(n=>globalThis.crypto.getRandomValues(new globalThis.Uint8Array(n))),eventId:event.id,analysisId:a.id,planHash:a.planHash||null,
      model:st.model,lang:ui.lang==="tr"?"tr":"en",startedAt:new Date().toISOString(),finishedAt:null,status:"running",code:null,
      planSummary:"",regions:[],findings:[],spentUsd:0,steps:0};
    a.vlm=run;
    audit(event,"VLM_READING_STARTED",{runId:run.runId,model:run.model,image:`${overview.width}x${overview.height}`,boxes:preview.body.candidates.length});
    touchEvent(event);
    session.busy=true;session.runId=run.runId;session.controller=new globalThis.AbortController();session.focusId=null;
    ui.vlmPanelOpen=true;
    try{
      session.progress={step:1,of:1,label:"overview"};render();
      const first=await step(run,{step:"overview",frame:V().WHOLE,image:overview,body:{...preview.body,runId:run.runId},refs:preview.refs});
      if(first){
        const maxRegions=Math.max(0,Math.min(V().MAX_REGIONS,(L.maxStepsPerRun||1)-1));
        run.regions=(first.result.regionsToInspect||[]).slice(0,maxRegions).map(r=>({frame:V().regionFrame(r.box,{width:overview.width,height:overview.height}),reason:r.reason,state:"pending",code:null}));
        touchEvent(event);
        for(const [i,region] of run.regions.entries()){
          if(run.status!=="running")break;
          session.progress={step:i+2,of:run.regions.length+1,label:"region",index:i+1,regions:run.regions.length};render();
          let image;
          try{image=encodeFrame(img,region.frame,{maxEdge:V().REGION_EDGE,upscale:V().REGION_UPSCALE});}
          catch{region.state="failed";region.code="IMAGE";continue;}
          const p=V().payloadFor({analysis:a,planHash:run.planHash,runId:run.runId,step:"region",lang:run.lang,frame:region.frame,image,reason:region.reason});
          const r=await step(run,{step:"region",regionIndex:i,frame:region.frame,image,body:p.body,refs:p.refs});
          region.state=r?"done":"failed";region.code=r?null:run.code;
          if(!r)break;
        }
      }
    }finally{
      if(run.status==="running")run.status=run.code?(run.steps>0&&run.findings.length?"partial":"failed"):"done";
      run.finishedAt=new Date().toISOString();
      session.busy=false;session.controller=null;session.progress=null;session.runId=null;
      if(activeEvent()===event&&event.analysis===a){
        const c=V().counts(run);
        audit(event,"VLM_READING_FINISHED",{runId:run.runId,status:run.status,code:run.code,findings:c.total,usd:run.spentUsd});
        touchEvent(event);
        if(run.status==="done")toast(t("vlm.toast.done",{n:c.total}),"success",5000);
        else if(run.status==="cancelled")toast(t("vlm.toast.cancelled"),"info",4000);
        else if(run.status!=="stale")toast(t("vlm.toast.stopped"),"error",7000);
      }
      render();
    }
  }

  // One request. Returns the response when it was accepted into the run,
  // null when the run must stop (an error, a cancel, or an answer that no
  // longer belongs to what is on the screen).
  async function step(run,{step,regionIndex,frame,image,body,refs}){
    const res=await post("/run",body,session.controller&&session.controller.signal);
    if(res&&res.run&&Number.isFinite(res.run.usd)){run.spentUsd=res.run.usd;run.steps=res.run.steps;}
    if(run.status==="cancelled"){return null;}
    const stale=V().staleReason(run,res&&res.ok?res:{...res,runId:run.runId,analysisId:run.analysisId,planHash:run.planHash},currentKeys());
    if(stale){
      run.status="stale";run.code="ANSWER_STALE";
      run.staleReason=stale;
      post("/cancel",{runId:run.runId});
      toast(t("vlm.toast.stale"),"error",7000);
      return null;
    }
    if(!res||!res.ok){
      run.code=res&&res.code||"RELAY_ERROR";
      if(run.code==="CANCELLED")run.status="cancelled";
      return null;
    }
    if(step==="overview")run.planSummary=String(res.result.planSummary||"").slice(0,800);
    const incoming=V().findingsFrom(res.result,{refs,frame,size:{width:image.width,height:image.height},step,regionIndex,idPrefix:run.runId.slice(4,12)});
    run.findings=V().mergeFindings(run.findings,incoming);
    touchEvent(activeEvent());render();
    return res;
  }

  function cancel(){
    const a=activeEvent()&&activeEvent().analysis,run=a&&a.vlm;
    if(!session.busy)return;
    if(run&&run.runId===session.runId&&run.status==="running"){run.status="cancelled";run.code="CANCELLED";}
    if(session.controller)session.controller.abort();
    post("/cancel",{runId:session.runId});
    render();
  }

  async function check(){
    if(session.checking)return;
    session.checking=true;session.check=null;render();
    const r=await post("/check",{});
    session.checking=false;session.check=r&&r.ok?{ok:true,model:r.model}:{ok:false,code:r&&r.code||"RELAY_ERROR"};
    render();
  }

  // ---- a person's decision on one finding ----------------------------------------
  function findingOf(id){const a=activeEvent()&&activeEvent().analysis,run=a&&a.vlm;return run?{a,run,f:run.findings.find(x=>x.id===id)}:{};}
  function accept(id){
    const event=activeEvent(),{a,run,f}=findingOf(id);
    if(!f)return;
    if(!canMutate(event,"apply a vision-language suggestion"))return;
    const p=V().acceptPlan(f,a);
    if(!p.ok){toast(t("vlm.toast.refused"),"error",5000);render();return;}
    let candidateId=null;
    if(p.action==="add")candidateId=addVlmCandidate(event,p.candidate,f);
    else if(p.action==="decide"){const r=decideReview(event,p.decision);if(!r){toast(t("vlm.toast.refused"),"error",5000);return;}candidateId=f.candidateId;}
    else if(p.action==="seats"){if(!setVlmSeats(event,p.candidateId,p.value,f)){toast(t("vlm.toast.refused"),"error",5000);return;}candidateId=p.candidateId;}
    if(!candidateId)return;
    f.state="accepted";f.decidedAt=new Date().toISOString();f.appliedTo=candidateId;
    audit(event,"VLM_FINDING_ACCEPTED",{runId:run.runId,findingId:f.id,kind:f.kind,candidateId});
    touchEvent(event);
    ui.selectedCandidateId=candidateId;
    toast(t("vlm.toast.accepted"),"success",3500);
    render();
  }
  function dismiss(id){
    const event=activeEvent(),{run,f}=findingOf(id);
    if(!f||f.state!=="open")return;
    if(!canMutate(event,"dismiss a vision-language suggestion"))return;
    f.state="dismissed";f.decidedAt=new Date().toISOString();
    audit(event,"VLM_FINDING_DISMISSED",{runId:run.runId,findingId:f.id,kind:f.kind});
    touchEvent(event);render();
  }
  function focus(id){
    const {a,f}=findingOf(id);if(!f)return;
    session.focusId=f.id;
    const c=f.candidateId&&a.candidates.find(x=>x.id===f.candidateId);
    if(c)ui.selectedCandidateId=c.id;
    render();
    const box=f.box||(c?{x:c.x,y:c.y,w:c.w,h:c.h}:null);
    if(box)globalThis.requestAnimationFrame(()=>applyReviewZoom(box));
  }

  // ---- what the screen shows ---------------------------------------------------
  const typeLabel=(type)=>type?t("teach.type."+type):"";
  function findingTitle(f,i){
    const what=f.kind==="wrongType"?t("vlm.kind.wrongType",{type:typeLabel(f.type)})
      :f.kind==="missing"?t("vlm.kind.missing",{type:typeLabel(f.type)})
      :f.kind==="seatCount"?t("vlm.kind.seatCount",{n:f.value})
      :f.kind==="printedNumber"?t("vlm.kind.printedNumber",{n:f.value})
      :t("vlm.kind."+f.kind);
    return`${i+1}. ${what}`;
  }
  function toolbarHTML(event){
    const a=event&&event.analysis;
    if(!a||!served())return"";
    if(session.busy){
      const p=session.progress||{},label=p.label==="region"?t("vlm.progress.region",{i:p.index,n:p.regions}):t("vlm.progress.overview");
      return`<span class="vlm-progress" role="status">${esc(t("vlm.progress",{step:p.step||1,of:p.of||1,what:label}))}</span><button class="btn" data-vlm-action="cancel">${t("vlm.cancel")}</button>`;
    }
    const c=a.vlm?V().counts(a.vlm):null;
    return`<button class="btn" data-vlm-action="toggle" aria-expanded="${ui.vlmPanelOpen?"true":"false"}" aria-controls="vlmPanel">${t("vlm.button")}${c&&c.open?` <span class="vlm-count">${c.open}</span>`:""}</button>`;
  }
  function mapHTML(event){
    const a=event&&event.analysis,run=a&&a.vlm;
    if(!run||!ui.vlmPanelOpen)return"";
    const byId=new Map(a.candidates.map(c=>[c.id,c]));
    const regions=(run.regions||[]).map((r,i)=>r&&r.frame?`<i class="vlm-region" style="left:${num(r.frame.x)}%;top:${num(r.frame.y)}%;width:${num(r.frame.w)}%;height:${num(r.frame.h)}%"><b>R${i+1}</b></i>`:"").join("");
    const marks=run.findings.map((f,i)=>{
      if(f.state!=="open")return"";
      const c=f.candidateId&&byId.get(f.candidateId),box=f.box||(c?{x:c.x-.4,y:c.y-.4,w:c.w+.8,h:c.h+.8}:null);
      if(!box)return"";
      return`<button class="vlm-mark kind-${esc(f.kind)} ${session.focusId===f.id?"focused":""}" data-vlm-action="focus" data-vlm-finding="${esc(f.id)}" style="left:${num(box.x)}%;top:${num(box.y)}%;width:${num(box.w)}%;height:${num(box.h)}%" aria-label="${esc(findingTitle(f,i))}" title="${esc(findingTitle(f,i))}"><b>${i+1}</b></button>`;
    }).join("");
    return regions+marks;
  }
  function relayStateHTML(){
    const r=session.relay;
    if(session.probing)return`<p class="vlm-note" role="status">${t("vlm.relay.probing")}</p>`;
    if(!r)return`<p class="vlm-note">${t("vlm.relay.unknown")}</p>`;
    if(!r.relay)return`<p class="vlm-state warn"><b>${t("vlm.relay.absent")}</b></p><p class="vlm-note">${t("vlm.relay.absentWhy")}</p><button class="btn sm" data-vlm-action="probe">${t("vlm.relay.again")}</button>`;
    if(!r.configured)return`<p class="vlm-state warn"><b>${t(r.reasonCode==="UNKNOWN_PRICE"?"vlm.relay.noPrice":"vlm.relay.noKey")}</b></p><p class="vlm-note">${t(r.reasonCode==="UNKNOWN_PRICE"?"vlm.relay.noPriceWhy":"vlm.relay.noKeyWhy",{model:esc(r.model||"")})}</p><button class="btn sm" data-vlm-action="probe">${t("vlm.relay.again")}</button>`;
    const L=r.limits||{},U=r.usage||{};
    const check=session.checking?`<span class="vlm-note" role="status">${t("vlm.check.running")}</span>`
      :session.check?(session.check.ok?`<span class="vlm-state ok">${t("vlm.check.ok")}</span>`:`<span class="vlm-state warn">${esc(tx("vlm.err.",session.check.code))}</span>`):"";
    return`<p class="vlm-state ok"><b>${t("vlm.relay.ready")}</b> · ${esc(r.model||"")}</p>
      <p class="vlm-note">${t("vlm.relay.caps",{run:money(L.maxUsdPerRun),day:money(L.maxUsdPerDay),spent:money(U.usd),requests:U.requests||0,maxRequests:L.maxRequestsPerDay||0})}</p>
      <div class="vlm-actions"><button class="btn sm" data-vlm-action="check" ${session.checking||session.busy?"disabled":""}>${t("vlm.check")}</button>${check}</div>`;
  }
  function findingRowHTML(a,f,i){
    const p=V().acceptPlan(f,a),conf=t("vlm.conf."+f.confidence);
    const state=f.state==="accepted"?`<span class="vlm-tag ok">${t("vlm.state.accepted")}</span>`:f.state==="dismissed"?`<span class="vlm-tag">${t("vlm.state.dismissed")}</span>`:"";
    const reason=!p.ok&&f.state==="open"?`<span class="vlm-reason">${esc(t("vlm.reason."+p.reason))}</span>`:"";
    const actions=f.state==="open"?`<div class="vlm-row-actions"><button class="btn sm primary" data-vlm-action="accept" data-vlm-finding="${esc(f.id)}" ${p.ok?"":`disabled title="${esc(t("vlm.reason."+p.reason))}"`}>${t("vlm.accept")}</button><button class="btn sm" data-vlm-action="dismiss" data-vlm-finding="${esc(f.id)}">${t("vlm.dismiss")}</button>${f.box||f.candidateId?`<button class="btn sm quiet" data-vlm-action="focus" data-vlm-finding="${esc(f.id)}">${t("vlm.show")}</button>`:""}</div>${reason}`:"";
    return`<li class="vlm-finding state-${esc(f.state)} kind-${esc(f.kind)} ${session.focusId===f.id?"focused":""}" data-vlm-row="${esc(f.id)}"><div class="vlm-finding-head"><b>${esc(findingTitle(f,i))}</b><small>${esc(conf)}${f.step==="region"?` · R${num(f.regionIndex)+1}`:""}</small>${state}</div>${f.evidence?`<q class="vlm-evidence">${esc(f.evidence)}</q>`:""}${actions}</li>`;
  }
  function panelHTML(event){
    if(!ui.vlmPanelOpen)return"";
    const a=event&&event.analysis,run=a&&a.vlm,c=run?V().counts(run):null;
    const status=run?`<p class="vlm-state ${run.status==="done"?"ok":run.status==="running"?"":"warn"}" role="status"><b>${t("vlm.run."+run.status)}</b>${run.code&&run.status!=="done"?` · ${esc(run.status==="stale"?tx("vlm.stale.",run.staleReason||"ANALYSIS_CHANGED"):tx("vlm.err.",run.code))}`:""}</p><p class="vlm-note">${t("vlm.run.meta",{model:esc(run.model||""),usd:money(run.spentUsd),steps:num(run.steps)})}</p>`:"";
    const body=run&&run.findings.length?`<ol class="vlm-findings">${run.findings.map((f,i)=>findingRowHTML(a,f,i)).join("")}</ol>`
      :run&&run.status!=="running"?`<p class="vlm-note">${t("vlm.noFindings")}</p>`:"";
    const send=session.relay&&session.relay.relay&&session.relay.configured&&!session.busy?`<button class="btn sm primary" data-vlm-action="start">${t(run?"vlm.sendAgain":"vlm.send")}</button>`:"";
    return`<aside class="vlm-panel" id="vlmPanel" aria-label="${esc(t("vlm.title"))}"><div class="vlm-head"><strong>${t("vlm.title")}</strong><button class="btn icon-only sm" data-vlm-action="close" aria-label="${esc(t("vlm.close"))}">${icon("x")}</button></div><div class="vlm-body">
      <section class="vlm-relay">${relayStateHTML()}${run?"":`<p class="vlm-note">${t("vlm.what")}</p>`}${send}</section>
      ${run?`<section class="vlm-run">${status}${run.planSummary?`<div class="vlm-summary"><small>${t("vlm.summaryLabel")}</small><p>${esc(run.planSummary)}</p></div>`:""}${c&&c.total?`<p class="vlm-note">${t("vlm.counts",{open:c.open,accepted:c.accepted,dismissed:c.dismissed})}</p>`:""}${body}</section>`:""}
    </div></aside>`;
  }
  // The diagnostics line. Until the relay has been asked, the old line stands:
  // no relay has been reached from this page, so nothing has been sent.
  function diagnosticsHTML(a,questionCount){
    const r=session.relay;
    if(!r||!r.relay)return questionCount!=null?`<b>${t("diag.vlmNotConfigured")}</b> · ${t("diag.vlmPending",{n:questionCount})}`:"";
    if(!r.configured)return`<b>${t("diag.vlmNotConfigured")}</b> · ${t(r.reasonCode==="UNKNOWN_PRICE"?"vlm.relay.noPrice":"vlm.relay.noKey")}`;
    return`<b>${t("vlm.relay.ready")}</b> · ${esc(r.model||"")}${a&&a.vlm?` · ${t("vlm.run."+a.vlm.status)}`:""}`;
  }

  // ---- controls ---------------------------------------------------------------
  function onAction(action,el){
    const id=el&&el.dataset?el.dataset.vlmFinding:null;
    if(action==="toggle"){ui.vlmPanelOpen=!ui.vlmPanelOpen;if(ui.vlmPanelOpen&&!session.relay)probe();render();}
    else if(action==="close"){ui.vlmPanelOpen=false;render();}
    else if(action==="probe")probe();
    else if(action==="check")check();
    else if(action==="start")start();
    else if(action==="cancel")cancel();
    else if(action==="accept")accept(id);
    else if(action==="dismiss")dismiss(id);
    else if(action==="focus")focus(id);
  }

  function create(deps){
    if(created)throw new Error("MeritScreenVlm.create() is called once, by app-v8.js.");
    created=true;
    activeEvent=deps.activeEvent;
    addVlmCandidate=deps.addVlmCandidate;
    applyReviewZoom=deps.applyReviewZoom;
    ask=deps.ask;
    audit=deps.audit;
    canMutate=deps.canMutate;
    decideReview=deps.decideReview;
    esc=deps.esc;
    icon=deps.icon;
    render=deps.render;
    setVlmSeats=deps.setVlmSeats;
    t=deps.t;
    toast=deps.toast;
    touchEvent=deps.touchEvent;
    ui=deps.ui;
    return{toolbarHTML,mapHTML,panelHTML,diagnosticsHTML,onAction,session:()=>({...session,controller:!!session.controller})};
  }
  globalThis.MeritScreenVlm=Object.freeze({create,DEPS:Object.freeze(["activeEvent","addVlmCandidate","applyReviewZoom","ask","audit","canMutate","decideReview","esc","icon","render","setVlmSeats","t","toast","touchEvent","ui"])});
})();
