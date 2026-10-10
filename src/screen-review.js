// The Floor Plan's review mode ("Concept 3 — Live Map"): the evidence a
// candidate carries (visual second opinion, relation, printed number), the
// object card, crops, the plan explanation, the confidence budget and its
// claims, the review queue bar and its navigation, the Review Center, the
// operator questions, the map pins, the diagnostics note and the screen.
//
// Moved byte-for-byte out of app-v8.js on 2026-10-04 (technical gaps, item 2),
// at the original indentation. The only edit: the seven names the shell still
// uses are reached as REVIEW.name. (It reads no shell `state`; the one
// `state` here is a printed number's own reading state, a local.)
// MeritOperatorQuestions is published when this file loads rather than when
// app-v8.js runs; it is only ever called after start-up.
//
// What stayed in the shell, deliberately: every decision that changes the
// analysis or the plan — confirming, rejecting, reclassifying and spreading a
// correction to a family, committing candidates, the undo of a correction,
// training-example capture, calibration — and the canvas zoom/box helpers it
// shares with them. The queue functions here move the operator between
// objects (ui state) and change no analysis.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that).
(() => {
  "use strict";
  let activeEvent;
  let activeReviewTargetIds;
  let applyReviewZoom;
  let candidateBox;
  let esc;
  let FLOORPLAN;
  let icon;
  let OCR_REASON_KEY;
  let operatorReportHTML;
  let RECLASSIFY_TAXONOMY;
  let render;
  let reviewCandidates;
  let scopeAvailability;
  let t;
  let titleCase;
  let toast;
  let ui;
  let unionBbox;
  let UNVERIFIED_SEATING;
  let vlmQuestionCount;
  let created=false;

  // The learned encoder's opinion, in words. Deliberately NOT a percentage:
  // the similarity behind it is graded against this plan's own distribution,
  // which makes it a visual match strength and not a probability — showing it
  // as "97% certain" would be a fabricated confidence number.
  //
  // The tier is shown next to the verdict every time, never omitted. On a plan
  // with no operator decisions the comparison is against the detector's own
  // candidates, and an operator who is not told that would read a machine
  // agreeing with itself as independent corroboration.
  function visualClassWord(cls){
    const key="visual.class."+(cls==="table"?"table":(cls||"").split(":")[1]||"other");
    const word=t(key);
    return word===key?t("visual.class.other"):word;
  }
  function visualEvidenceHTML(c){
    const v=c?.visualEvidence;
    if(!v)return"";
    // Strength and agreement are independent, so all four combinations get a
    // sentence rather than the weak ones collapsing into one shrug. Only a
    // confident disagreement is coloured: the channel deletes nothing, so it
    // must not read like an error on every uncertain crop.
    const own=visualClassWord(v.cvClass),other=visualClassWord(v.nearestClass);
    const weak=v.strength==="weak"||v.strength==="unknown",disagrees=v.agreement==="disagree";
    const body=weak?(disagrees?t("visual.weakDisagree",{other}):t("visual.uncertain"))
      :disagrees?t("visual.disagree",{other,cls:own})
      :t(v.strength==="strong"?"visual.strong":"visual.moderate",{cls:own});
    return`<div class="poi-visual-note ${disagrees&&!weak?"disagree":weak?"weak":"agree"}">`
      +`<strong>${t("visual.title")}</strong>`
      +`<span>${esc(body)}</span><em>${esc(t("visual.tier."+(v.nearestTier||"provisional")))}</em></div>`;
  }
  // Seats this table and a neighbour can both claim. Shown only when there are
  // any — a line saying "0 seats are uncertain" on every card would be noise,
  // and the absence of the line is itself the answer.
  //
  // It names the neighbour, because "one of these seats might belong somewhere
  // else" is not an actionable sentence and "…might belong to T14" is.
  function relationNoteHTML(c){
    if(!c||c.kind!=="table")return"";
    const seats=(c.chairDetections||[]).filter(ch=>ch.relation&&ch.relation.ambiguous);
    if(!seats.length)return"";
    const event=activeEvent(),byId=new Map((event?.analysis?.candidates||[]).map(x=>[x.id,x]));
    const others=[...new Set(seats.map(s=>s.relation.runnerUpId).filter(Boolean))]
      .map(id=>byId.get(id)).filter(Boolean).map(x=>t("teach.type."+x.type));
    return`<div class="poi-relation-note"><strong>${t("relation.ambiguousTitle")}</strong>`
      +`<span>${esc(others.length?t("relation.ambiguousWith",{n:seats.length,other:others[0]})
        :t("relation.ambiguous",{n:seats.length}))}</span></div>`;
  }
  // What this table's number is, where that came from, and the one control that
  // has been missing since the Teach Area was built: a person confirming it.
  //
  // The state is shown rather than smoothed over. A number two crops agreed on
  // is not the same thing as a number a person stood behind, and the operator
  // has to be able to tell them apart -- it is the difference between "the
  // drawing was read twice" and "someone told us", and only the second one is
  // strong enough to identify this table across the whole venue.
  // `printedNumber.source` is stored English -- it travels with the reading into
  // memory, the exported report and the benchmarks, so it stays as written and
  // the screen says the same thing in the operator's language. A source this
  // build does not recognise is shown as it stands rather than relabelled.
  const NUMBER_SOURCES={
    "OCR of this table's own symbol":"number.source.ocr",
    "confirmed by a person":"number.source.person",
  };
  function numberSourceText(src){
    const key=NUMBER_SOURCES[src];
    return key?t(key):src;
  }
  function printedNumberHTML(c){
    if(!c||c.kind!=="table")return"";
    const p=c.printedNumber||null;
    const state=p?p.state:"NONE";
    const verified=state==="VERIFIED";
    const value=p&&typeof p.value==="number"?p.value:"";
    const mark=verified?"ok":state==="NONE"?"muted":"warn";
    return`<div class="poi-number ${mark}">
      <label for="poiNumber">${t("number.printedNumber")}</label>
      <div class="poi-number-row">
        <input id="poiNumber" class="field-input" type="number" min="1" max="9999" inputmode="numeric"
          placeholder="${esc(t("number.unread"))}" value="${value}">
        <button class="btn sm" data-review-action="confirm-number">${t("number.confirm")}</button>
      </div>
      <p class="poi-number-state">${esc(t("number.state."+state))}${
        p&&p.source?` · ${esc(numberSourceText(p.source))}`:""}</p>
    </div>`;
  }
  function reviewPoiCardHTML(c){
    if(!c)return"";
    const opt=o=>`<option value="${o.kind}:${o.type}" ${c.kind===o.kind&&c.type===o.type?"selected":""}>${t("teach.type."+o.type)}</option>`;
    return`<aside class="poi-card"><div class="poi-card-head"><strong>${t("teach.type."+c.type)}</strong><span>${c.kind==="table"?(c.seatsUnknown?`${t("poi.seatsNotShown")} · `:`${(c.chairDetections||[]).length} ${t("poi.seats")} · `):""}${t(c.status==="confirmed"?"poi.confirmed":c.status==="rejected"?"poi.rejected":"poi.unreviewed")}</span></div>${c.fromMemory?`<div class="poi-memory-note">${icon("check")}${t("poi.fromMemory")}</div>`:""}${c.taughtFrom?`<div class="poi-memory-note taught">${icon("check")}<span>${t("teachArea.appliedHere")} — ${t("teachArea.scope."+c.taughtFrom.scope)}</span><button class="btn sm quiet" data-review-action="forget">${t("teachArea.forget")}</button></div>`:""}${c.lowEvidence?`<div class="poi-lowevidence"><strong>${t("poi.lowEvidence")}</strong><span>${esc(t("poi.lowEvidence."+c.lowEvidence.reason))}</span></div>`:""}${visualEvidenceHTML(c)}${relationNoteHTML(c)}<select class="field-select" data-candidate-edit="kindtype" aria-label="${esc(t("review.kindType"))}"><optgroup label="${t("taxonomy.tables")}">${RECLASSIFY_TAXONOMY.filter(o=>o.kind==="table").map(opt).join("")}</optgroup><optgroup label="${t("taxonomy.objects")}">${RECLASSIFY_TAXONOMY.filter(o=>o.kind==="venue").map(opt).join("")}</optgroup></select>${UNVERIFIED_SEATING.has(c.type)?`<div class="poi-seat-row"><label for="poiSeatCount">${t("poi.seatsOnThis")}</label><input id="poiSeatCount" class="field-input" type="number" min="0" max="99" inputmode="numeric" placeholder="${t("poi.seatsUnset")}" value="${c.seats==null?"":c.seats}" data-candidate-edit="seatCount"><p class="poi-seat-note">${c.seats==null?t("poi.seatsUnverifiedNote"):t("poi.seatsVerifiedNote",{n:c.seats})}</p></div>`:""}${printedNumberHTML(c)}${(()=>{
      const av=scopeAvailability(c);
      const blocked=Object.entries(av).filter(([,s])=>!s.ok);
      const chosen=av[ui.teachScope||"plan"]?.ok?(ui.teachScope||"plan"):"plan";
      return`<div class="poi-teach"><label for="poiTeachScope">${t("teachArea.remember")}</label><div class="poi-teach-row"><select id="poiTeachScope" class="field-select" data-teach-scope>${["plan","layout","venue"].map(v=>`<option value="${v}" ${chosen===v?"selected":""} ${av[v].ok?"":"disabled"}>${t("teachArea.scope."+v)}</option>`).join("")}</select><button class="btn sm" data-review-action="teach">${t("teachArea.keep")}</button></div>${blocked.map(([,s])=>`<p class="poi-teach-blocked">${esc(s.why)}</p>`).join("")}<p class="poi-teach-note">${t("teachArea.notTraining")}</p></div>`;
    })()}<div class="poi-card-actions"><button class="btn sm primary" data-review-action="confirm">${t("action.correct")}</button><button class="btn sm" data-review-action="reject">${t("action.notAnObject")}</button><button class="btn sm" data-review-action="dismiss" title="${t("action.notImportantTitle")}">${t("action.notImportant")}</button></div></aside>`;
  }
  // Real pixel crop of a candidate straight out of the actual imported plan
  // image — a CSS background-position/-size window, never a synthesized or
  // generated diagram, per the product's honesty rule on AI review UI.
  function cropThumbHTML(event,c){
    const bg=event.background?.src;if(!bg||!c)return"";
    const pad=.6;
    const cw=Math.min(99,Math.max(3,c.w*(1+2*pad))),ch=Math.min(99,Math.max(3,c.h*(1+2*pad)));
    const cx=Math.min(100-cw,Math.max(0,c.x-c.w*pad)),cy=Math.min(100-ch,Math.max(0,c.y-c.h*pad));
    const sizeW=(100/cw*100).toFixed(2),sizeH=(100/ch*100).toFixed(2);
    const posX=(cx/(100-cw)*100).toFixed(2),posY=(cy/(100-ch)*100).toFixed(2);
    return`<div class="crop-thumb" style="background-image:url('${esc(bg)}');background-size:${sizeW}% ${sizeH}%;background-position:${posX}% ${posY}%" title="${esc(t("teach.type."+c.type))}"></div>`;
  }
  function memberCropsHTML(event,memberIds,max=6){
    const byId=new Map(event.analysis.candidates.map(c=>[c.id,c]));
    const shown=memberIds.slice(0,max).map(id=>cropThumbHTML(event,byId.get(id))).join("");
    const overflow=memberIds.length>max?`<span class="crop-more">+${memberIds.length-max}</span>`:"";
    return`<div class="review-group-crops">${shown}${overflow}</div>`;
  }
  // What the whole plan says, and what to look at first.
  //
  // Every claim shows its strength, because a product that states everything
  // in the same voice teaches an operator to trust all of it equally — and
  // some of it is a count bounded by detection recall. `strong` reads as
  // certain, and the interpreter has to earn it (benchmarks/interpreter/).
  // The most informative of the three impact quantities, not all three: a
  // priority line that reads "settles 12 objects, 48 seats and 2 disputed
  // claims" is a specification, not a reason to click.
  function impactWords(i){
    if(i.facts)return t("explain.settlesFacts",{objects:i.objects,facts:i.facts});
    if(i.seats)return t("explain.settlesSeats",{objects:i.objects,seats:i.seats});
    return t("explain.settles",{objects:i.objects});
  }
  function explainPlanHTML(event){
    const pi=event.analysis?.planIntelligence;
    if(!pi||!(pi.facts||[]).length)return"";
    const facts=pi.facts,priorities=(pi.reviewPriorities||[]).slice(0,4);
    // The domain layer names a type in its own vocabulary ("square"); the
    // sentence it lands in is a different question and belongs here. Without
    // this the Turkish read "masalarının çoğu square", which is the exact
    // failure the structured key/params design exists to prevent.
    // t() returns the KEY when a string is missing, so an unmapped type would
    // print "fact.type.whatever" on screen. Fall back to the raw type name,
    // which is at least a word.
    const typeWord=type=>{
      const key="fact.type."+type,word=t(key);
      return word===key?String(type):word;
    };
    // A type is named in the domain's own vocabulary ("square") and needs the
    // in-sentence word here. Params that are string KEYS are resolved by t()
    // itself, so nothing else needs unwrapping.
    const say=(key,params)=>t(key,params&&params.type?{...params,type:typeWord(params.type)}:params);
    // Collapsible, and open by default. The Review Center's job is ACTION —
    // the groups and questions below — and twelve facts unfolded push them
    // under the fold. Context that cannot be folded away is chrome.
    // Where two stages of the analysis cannot both be right. Shown ABOVE the
    // facts, because a claim and the reason to doubt it are useless in that
    // order: an operator who reads "112 seats" first has already believed it.
    // Each one names both sides and where each came from, and states no verdict
    // — the product does not know which side is wrong, and the resolution
    // belongs to the person looking at the drawing.
    const contradictions=pi.contradictions||[];
    const contradictionsHTML=contradictions.length
      ?`<div class="plan-contradictions"><strong>${t("contradiction.title")}</strong>`
        +`<ul>${contradictions.map(c=>
          `<li class="contra contra-${esc(c.severity)}">`
          +`<span class="contra-kind">${esc(t("contradiction.kind."+c.kind).toUpperCase())}</span>`
          +`<span class="contra-text">${esc(t(c.key,c.params))}</span>`
          +`<span class="contra-sides">${c.sides.map(s=>
            `<em>${esc(t(s.from,s.fromParams))}</em>: ${esc(t(s.claim,s.params))}`).join(" &nbsp;·&nbsp; ")}</span>`
          +`</li>`).join("")}</ul></div>`
      :"";
    return`<details class="plan-explain" open><summary>${t("explain.title")}</summary>`
      +contradictionsHTML
      +`<ul class="plan-explain-facts">${facts.map(f=>
        `<li class="fact fact-${esc(f.strength)}"><span class="fact-strength">${t("fact.strength."+f.strength)}</span>`
        +`<span class="fact-text">${esc(say(f.key,f.params))}</span>`
        // The evidence travels with the claim rather than living in a
        // diagnostics panel nobody opens.
        +(f.provenance&&f.provenance.length?`<span class="fact-basis">${t("explain.basedOn")}: ${esc(f.provenance.map(p=>
          say(p.key,p.params)).join("; "))}</span>`:"")
        // A claim whose confidence a disagreement lowered says so. Silently
        // restating it one notch weaker would hide the reason.
        +(f.strengthBefore?`<span class="fact-downgraded">${t("contradiction.downgraded")}</span>`:"")
        +`</li>`).join("")}</ul>`
      +(priorities.length?`<strong class="plan-explain-next">${t("explain.lookAtFirst")}</strong>`
        +`<ol class="plan-explain-priorities">${priorities.map(pr=>
          `<li>${esc(say(pr.key,pr.params))}`
          // What this one answer settles, next to the item. The order is
          // measured on exactly this quantity, so an operator who wants to
          // work the list differently can see what they are trading away.
          +(pr.downstreamImpact?.objects?`<span class="priority-impact">${esc(impactWords(pr.downstreamImpact))}</span>`:"")
          +`</li>`).join("")}</ol>`:"")
      +`</details>`;
  }
  // What is worth deciding, above the review groups, because it is the answer
  // to "where do I start" and the groups are only one of the things competing
  // for that answer. This is also the first surface the numbering-integrity
  // report, the self-check and the Teach Area's unresolved proposals have ever
  // had: three layers that produced data nobody could see.
  //
  // Everything below the line is stated, never dropped. A panel that showed six
  // items and implied that was all of it would be a filter lying about its own
  // coverage.
  // A ranked row that cannot be acted on is a ranked row that wastes the
  // operator's attention twice: once to read it, once to work out where to go.
  // Every claim that names objects opens a REVIEW QUEUE over exactly those
  // objects; a claim that names none (the self-check's arithmetic, say) is a
  // statement about the whole drawing and says so instead of offering a button
  // that would land nowhere.
  // What one decision buys, in the operator's language. One function, because
  // the ranked row and the queue bar are stating the same fact and a second
  // copy is a second thing to get wrong.
  // `analysis.notice` is stored English: the contract suite asserts on it, and
  // the exported operator report carries it, so it is DATA and stays as written.
  // The screen says the same thing in the operator's language. An analysis whose
  // notice this build does not recognise keeps its own words rather than being
  // relabelled with a sentence that might not be true of it.
  const ASSISTED_NOTICE="Classical computer vision is active; no trained Merit model is installed in this browser review.";
  function analysisNoticeText(a){
    return a && a.notice===ASSISTED_NOTICE ? t("plan.noticeAssisted") : (a && a.notice) || "";
  }
  function settlesText(s){
    if(!s)return"";
    return[s.facts?t(s.facts===1?"budget.settlesFacts1":"budget.settlesFacts",{n:s.facts}):"",
      s.objects?t(s.objects===1?"budget.settlesObjects1":"budget.settlesObjects",{n:s.objects}):""]
      .filter(Boolean).join(" · ");
  }
  function claimTargets(event,c){
    const a=event.analysis;if(!a)return[];
    const byId=new Map(a.candidates.map(x=>[x.id,x]));
    return (c.targetIds||[]).filter(id=>byId.has(id));
  }
  function budgetClaimHTML(c,event){
    const label=t(c.key,{...c.params,n:c.count??c.params.n??0});
    const cost=c.decisions===1?t("budget.oneDecision"):t("budget.nDecisions",{n:c.decisions});
    const settles=settlesText(c.settles);
    const ids=event?claimTargets(event,c):[];
    const go=ids.length
      ?`<button class="btn sm budget-claim-go" data-budget-open="${esc(c.id)}">${t(ids.length===1?"budget.goOne":"budget.goN",{n:ids.length})}</button>`
      :`<span class="budget-claim-nowhere">${t("budget.wholeDrawing")}</span>`;
    return`<li class="budget-claim"><div class="budget-claim-body"><span class="budget-claim-label">${esc(label)}</span><span class="budget-claim-meta">${esc(cost)}${settles?` · ${esc(settles)}`:""}${c.corroboratedBy.length?` · ${esc(t("budget.alsoCorroborated"))}`:""}</span></div>${go}</li>`;
  }
  // ---- the review queue ----------------------------------------------------
  //
  // "31 table numbers need review" has to become "table 1 of 31, decide, next"
  // and not "here are 31 things, good luck". The queue is deliberately thin: it
  // holds an ORDER and a POSITION, and nothing else. What is resolved is read
  // from the candidates themselves on every render, never remembered here --
  // a queue that kept its own idea of "done" would drift from the data the
  // moment a decision was undone, and would then be confidently wrong.
  function openReviewQueue(event,claimId){
    const b=event.analysis?.confidenceBudget;
    const c=b&&b.spend.find(x=>x.id===claimId);
    if(!c)return;
    const ids=claimTargets(event,c);
    if(!ids.length)return;
    // `why` is deliberately NOT carried here. plan-intelligence.js writes it in
    // English on purpose -- it explains the ORDERING to diagnostics and to the
    // benchmarks, and some of it is composed from internal identifiers, so
    // rendering it produced "contradiction.from.detectionAndShape and
    // contradiction.from.visualSecondOpinion cannot both be right" inside an
    // otherwise Turkish bar. What an operator reads is the claim's own label
    // plus what one decision settles, both of which are already translated.
    ui.reviewQueue={claimId,key:c.key,params:c.params,count:c.count,ids,index:0,skipped:[],
      settles:c.settles,decisions:c.decisions};
    ui.tab="floor";ui.planMode="review";ui.reviewCenterOpen=false;
    ui.activeReviewGroupId=null;ui.activeQuestionId=null;
    ui.selectedCandidateId=ids[0];
    render();
  }
  function queueState(event){
    const q=ui.reviewQueue;if(!q)return null;
    const byId=new Map((event.analysis?.candidates||[]).map(c=>[c.id,c]));
    // Present = still in the analysis. Resolved = a person has ruled on it, or
    // it is gone because they said it was not an object at all.
    const live=q.ids.filter(id=>byId.has(id));
    const resolved=q.ids.filter(id=>{const c=byId.get(id);return !c||c.status!=="unreviewed";});
    const skipped=new Set(q.skipped);
    const outstanding=live.filter(id=>byId.get(id).status==="unreviewed"&&!skipped.has(id));
    return{...q,live,resolvedCount:resolved.length,outstanding,total:q.ids.length,
      position:Math.min(q.index+1,Math.max(1,q.ids.length))};
  }
  function queueGo(event,delta){
    const q=ui.reviewQueue;if(!q)return;
    const n=q.ids.length;if(!n)return;
    q.index=(q.index+delta+n)%n;
    ui.selectedCandidateId=q.ids[q.index];
    ui.activeReviewGroupId=null;ui.activeQuestionId=null;
    render();
  }
  function queueNextOutstanding(event){
    const s=queueState(event);if(!s)return;
    // Search forward from where we are, wrapping once, so "next" means the next
    // one AFTER this rather than the first one in the list -- an operator who
    // has worked halfway down does not want to be sent back to the top.
    const n=s.ids.length;
    for(let step=1;step<=n;step++){
      const i=(s.index+step)%n,id=s.ids[i];
      if(s.outstanding.includes(id)){
        ui.reviewQueue.index=i;ui.selectedCandidateId=id;
        ui.activeReviewGroupId=null;ui.activeQuestionId=null;render();return;
      }
    }
    // Nothing outstanding: say so rather than moving the operator somewhere
    // arbitrary and letting them wonder whether the click registered.
    toast(t("queue.allDone",{n:s.total}),"success");
    render();
  }
  function closeReviewQueue(){
    ui.reviewQueue=null;ui.selectedCandidateId=null;render();
  }
  // After a decision, the operator should be looking at the next thing rather
  // than at the thing they just settled. Recomputation has already happened by
  // the time this runs, so the queue's own progress line and the budget row
  // behind it are both reading the new state -- a resolved item changes state
  // by itself instead of sitting there as a stale warning.
  function afterReviewDecision(event){
    if(ui.reviewQueue)queueNextOutstanding(event);else render();
  }
  function reviewQueueBarHTML(event){
    const s=queueState(event);if(!s)return"";
    const label=t(s.key,{...s.params,n:s.count??s.params?.n??s.total});
    const settles=settlesText(s.settles);
    // The separator is a real character, not a styled empty element: a dot that
    // exists only as CSS reads as "163 içinden 10 karara bağlandı" to anything
    // that takes the text, which is one number where there are two.
    const progress=[t("queue.position",{i:s.position,n:s.total}),
      t("queue.resolved",{n:s.resolvedCount}),
      s.skipped.length?t("queue.skipped",{n:s.skipped.length}):""].filter(Boolean).join(" · ");
    return`<div class="review-queue-bar">
      <div class="rq-what"><strong>${esc(label)}</strong>${
        settles?`<span>${esc(settles)}</span>`:""}</div>
      <div class="rq-progress">${esc(progress)}</div>
      <div class="rq-actions">
        <button class="btn sm" data-queue="prev">${t("queue.previous")}</button>
        <button class="btn sm" data-queue="skip">${t("queue.skip")}</button>
        <button class="btn sm primary" data-queue="next-outstanding"${
          s.outstanding.length?"":" disabled"}>${t("queue.nextUnresolved")}</button>
        <button class="btn sm quiet" data-queue="exit">${t("queue.exit")}</button>
      </div>
    </div>`;
  }
  function confidenceBudgetHTML(event){
    const b=event.analysis?.confidenceBudget;
    if(!b||!b.counts.claims)return"";
    const below=[b.counts.deferred?t("budget.deferred",{n:b.counts.deferred}):"",
      b.counts.nothingMeasurableDependsOnThem?t("budget.nothingDepends",{n:b.counts.nothingMeasurableDependsOnThem}):"",
      b.counts.notAnswerableFromTheDrawing?t("budget.notAnswerable",{n:b.counts.notAnswerableFromTheDrawing}):""].filter(Boolean);
    return`<section class="budget-block"><div class="budget-head"><strong>${t("budget.title")}</strong><span>${esc(t("budget.coverage",{pct:Math.round(b.coverage.objects*100)}))}</span></div><ol class="budget-list">${b.spend.map(c=>budgetClaimHTML(c,event)).join("")}</ol>${below.length?`<p class="budget-below"><b>${t("budget.belowTheLine")}</b> — ${esc(below.join(" · "))}</p>`:""}</section>`;
  }
  function reviewCenterPanelHTML(event){
    const pi=event.analysis.planIntelligence,decisions=event.analysis.groupingDecisions||[];
    return`<aside class="review-center-panel"><div class="review-center-head"><strong>${t("review.center")}</strong>${(ui.correctionUndo||[]).length?`<button class="btn sm quiet" data-review-decision-action="undo-correction" title="${t("review.undoCorrectionTitle")}">${icon("undo")} ${t("review.undoCorrection",{n:(ui.correctionUndo||[]).length})}</button>`:""}${decisions.length?`<button class="btn sm quiet" data-review-decision-action="undo-last" title="${t("diag.undoLastDecisionTitle")}">${icon("undo")} ${t("diag.undoLastDecision",{n:decisions.length})}</button>`:""}<button class="btn icon-only sm" data-review-action="close-review-center">${icon("x")}</button></div><div class="review-center-list">${confidenceBudgetHTML(event)}${explainPlanHTML(event)}${pi.reviewGroups.map(g=>`<div class="review-group-card"><div class="review-group-title">${esc(reviewGroupTitle(g))}</div>${memberCropsHTML(event,g.memberIds)}<div class="review-group-meta">${g.totalInFamily} ${t("review.similar")} · ${g.consistentCount} ${t("review.consistentOf")} · ${g.memberIds.length} ${t("review.needReview")}</div><div class="review-group-actions"><button class="btn sm primary" data-reviewgroup-action="confirm-family" data-group="${g.id}">${t("action.applyToAll")}</button><button class="btn sm" data-reviewgroup-action="inspect" data-group="${g.id}">${t("action.reviewOutliers")}</button></div></div>`).join("")||`<div class="inspector-empty">${t("review.noGroups")}</div>`}</div>${pi.uncertainQuestions.length?`<div class="review-center-difficult"><strong>${t("review.difficultQuestions")}</strong>${pi.uncertainQuestions.map(q=>`<div class="difficult-q-row"><span>${esc(questionText(q))}</span><button class="btn sm" data-question-action="open" data-question="${q.id}">${t("action.answer")}</button></div>`).join("")}</div>`:""}</aside>`;
  }
  // AI-generated review questions are stored as a semantic {questionType,
  // questionParams} pair (plan-intelligence.js), never a hardcoded English
  // string — this renders that through i18n.js's t() so the active UI
  // language is honored. q.question (a plain English literal) is kept only
  // as a defensive fallback for a question shape without a known type.
  // Review-group titles arrive as {type, kind} rather than an English phrase,
  // so the Turkish UI does not show "Round Table Family" in the middle of a
  // Turkish panel. Falls back to the pre-rendered string for any group shaped
  // the old way.
  function reviewGroupTitle(g){
    const p=g.titleParams;
    if(!p)return titleCase(g.title||"");
    // Reuse the shape labels the Add-objects panel already ships rather than
    // adding a parallel set that could drift out of sync. t() returns the key
    // itself when a string is missing, so that is the miss signal.
    const key="bulk.type."+p.type,label=t(key);
    const typeLabel=label===key?titleCase(p.type):label;
    return t(p.kind==="table"?"review.familyTitle.table":"review.familyTitle.object",{type:typeLabel});
  }
  // What kind of tables an arrangement is made of, from the key the question
  // was consolidated under ("2:square+square", "4:rectangle+square+square+
  // square"). Uniform arrangements name their type; mixed ones say so. Returns
  // null for a question stored before arrangements were recorded, so an older
  // analysis keeps its original wording rather than showing "(undefined)".
  function arrangementTypeLabel(arrangement){
    const types=String(arrangement||"").split(":")[1];
    if(!types)return null;
    const list=types.split("+").filter(Boolean);
    if(!list.length)return null;
    return list.every(x=>x===list[0])?t("teach.type."+list[0]):t("question.mixedTypes");
  }
  function questionText(q){
    if(q.questionType==="combinedDiningGroup"){
      const memberCount=q.questionParams?.memberCount??"?",count=q.coversGroups||1;
      // The kind of table is part of the question, not decoration: two
      // arrangements that differ only in type used to render as the same
      // sentence, so the operator was asked what looked like the same question
      // twice with no way to tell which was which.
      const type=arrangementTypeLabel(q.arrangement);
      // A question standing for several identical arrangements says so, rather
      // than looking like a question about one of them.
      if(count>1)return type
        ?t("question.combinedDiningGroupRepeatedOf",{memberCount,count,type})
        :t("question.combinedDiningGroupRepeated",{memberCount,count});
      return type
        ?t("question.combinedDiningGroupOf",{memberCount,type})
        :t("question.combinedDiningGroup",{memberCount});
    }
    return q.question||"";
  }
  // Exposed for the regression suite. The property under test is not what any
  // one question says, it is that no two DIFFERENT questions say the same
  // thing -- which cannot be checked without rendering several of them
  // together, and which markup review missed for as long as this wording
  // existed.
  globalThis.MeritOperatorQuestions={questionText,arrangementTypeLabel};
  function difficultQuestionCardHTML(event){
    const pi=event.analysis?.planIntelligence;if(!pi||!ui.activeQuestionId)return"";
    const q=pi.uncertainQuestions.find(x=>x.id===ui.activeQuestionId);if(!q)return"";
    const group=pi.furnitureGroups.find(g=>g.id===q.groupId);
    return`<div class="difficult-question-overlay"><div class="difficult-question-card"><div class="eyebrow">${t("teach.needsHelp")}</div>${group?memberCropsHTML(event,group.memberIds):""}<p class="difficult-question-text">${esc(questionText(q))}</p><div class="difficult-question-actions"><button class="btn primary" data-question-action="yes" data-question="${q.id}">${t("question.yesGroup")}</button><button class="btn" data-question-action="no" data-question="${q.id}">${t("question.noSeparate")}</button></div></div></div>`;
  }
  function reviewGroupCount(pi){return pi.reviewGroups.length+pi.uncertainQuestions.length;}
  // What the operator's own notes did to this plan, on the status bar rather
  // than behind a diagnostics panel: a change that came from a note a person
  // wrote must be visible as such, or it is indistinguishable from the detector
  // having got cleverer — which it did not.
  function teachAreaPillHTML(event){
    const ta=event.analysis?.teachArea;if(!ta)return"";
    const pending=ta.summary.review+ta.summary.ambiguous;
    if(!ta.applied&&!pending)return"";
    const parts=[];
    if(ta.applied)parts.push(t("teachArea.chip.applied",{n:ta.applied}));
    if(pending)parts.push(t("teachArea.chip.pending",{n:pending}));
    return`<i class="pill-div"></i><span class="pill-chip static" title="${esc(t("teachArea.chipTitle"))}">${esc(parts.join(" · "))}</span>`;
  }
  function planIntelBottomPillHTML(event){
    const pi=event.analysis.planIntelligence;
    return`<div class="planmap-status-pill wide"><span class="pill-check">${icon("check")}</span><b>${t("plan.understood")}</b><i class="pill-div"></i><b>${pi.planSummary.diningGroups}</b><small>${t("plan.diningGroups")}</small><i class="pill-div"></i>${FLOORPLAN.planSeatsPill(pi)}${FLOORPLAN.planReviewChipHTML(event,"review-action")}${teachAreaPillHTML(event)}<span class="toolbar-spacer"></span><button class="btn sm quiet" data-review-action="back">${t("review.editManually")}</button><button class="btn sm primary" data-review-action="commit">${t("action.confirmPlan")}</button></div>`;
  }
  // One pin per REVIEW GROUP (at the centroid of its members), not one per
  // individual object — a plan with hundreds of similar chairs must not turn
  // into hundreds of pins. Difficult questions (rare, high-value) each keep
  // their own pin since there is exactly one real decision behind each.
  function reviewMapPins(event,pi){
    if(!pi)return[];const byId=new Map(event.analysis.candidates.map(c=>[c.id,c]));
    const groupPins=pi.reviewGroups.map((g,i)=>{
      const members=g.memberIds.map(id=>byId.get(id)).filter(Boolean);if(!members.length)return null;
      const cx=members.reduce((n,m)=>n+m.x+m.w/2,0)/members.length,cy=members.reduce((n,m)=>n+m.y+m.h/2,0)/members.length;
      return{x:cx,y:cy,label:i+1,kind:"group",groupId:g.id};
    }).filter(Boolean);
    const questionPins=pi.uncertainQuestions.map((q,i)=>{const c=byId.get(q.candidateId);if(!c)return null;return{x:c.x+c.w/2,y:c.y+c.h/2,label:groupPins.length+i+1,kind:"question",questionId:q.id};}).filter(Boolean);
    return[...groupPins,...questionPins];
  }
  // Advanced Diagnostics content for the review screen. Every line here is a
  // real measured value from the detection pass -- which provider ran, which
  // detection path it took, how many chairs it actually found and how many it
  // could associate with a table. It states DOMAIN MODEL NOT INSTALLED
  // outright rather than letting "Assisted Detection" be mistaken for a
  // trained model (merit-plan-intelligence, AI truthfulness). Fields are
  // guarded because an analysis restored from localStorage may predate them.
  function detectionDiagnosticsHTML(a){
    const d=a.diagnostics||{},rows=[];
    rows.push(`${esc(a.engine)} · ${esc(d.resolution||"")}${Number.isFinite(d.detectionMs)?` · ${d.detectionMs} ms`:""}`);
    rows.push(`<b>${t("diag.notInstalled")}</b>`);
    const pathKey=d.detectionPath==="chair-first"?"diag.path.chairFirst":d.detectionPath==="table-first"?"diag.path.tableFirst":null;
    if(pathKey)rows.push(`${t("diag.path")}: ${t(pathKey)}`);
    const sourceKey={"colour-cluster":"diag.chairSource.colour","luma-components":"diag.chairSource.luma","none":"diag.chairSource.none"}[d.chairSource];
    if(sourceKey)rows.push(`${t("diag.chairSource")}: ${t(sourceKey)}`);
    if(Number.isFinite(d.chairsDetected))rows.push(t("diag.chairsFound",{n:d.chairsDetected,associated:d.chairsAssociated??0,orphans:d.chairsUnassociated??0}));
    if(d.mergesSplit)rows.push(t("diag.mergesSplit",{n:d.mergesSplit}));
    if(d.candidateCapReached)rows.push(t("diag.capReached"));
    rows.push(`Diff +${a.comparison.added} / −${a.comparison.removed}`);
    if(d.textSuppressed)rows.push(t("diag.textSuppressed",{n:d.textSuppressed}));
    // What the PDF the plan came from carries (src/plan-pdf-text.js): a scan
    // says every word was read off pixels; text objects say how many were used
    // as exact text; vector paths are named as present and NOT read.
    const ps=d.pdfSource;
    if(ps&&ps.kind==="SCAN")rows.push(t("diag.pdfSource.scan"));
    if(ps&&ps.textItems)rows.push(t("diag.pdfSource.text",{n:ps.textItems}));
    if(ps&&ps.paths)rows.push(t("diag.pdfSource.vector",{n:ps.paths}));
    // No relay holds a key for this page, so no vision-language model runs
    // (src/plan-vlm.js). Said outright, with what it would have been asked.
    const vlmPending=vlmQuestionCount(a);
    if(vlmPending!=null)rows.push(`<b>${t("diag.vlmNotConfigured")}</b> · ${t("diag.vlmPending",{n:vlmPending})}`);
    return`<div class="analysis-note">${rows.join("<br>")}</div>`;
  }
  function analysisHTML(event){
    const a=event.analysis,candidates=reviewCandidates(event),selected=a?.candidates.find(c=>c.id===ui.selectedCandidateId),pi=a?.planIntelligence;
    const pins=reviewMapPins(event,pi);
    const target=activeReviewTargetIds(pi),byId=a?new Map(a.candidates.map(c=>[c.id,c])):new Map();
    // Working through a queue means the plan should follow the operator to each
    // object, not just to a group. Outside a queue a single selection is left
    // unzoomed on purpose -- someone clicking around the plan does not want the
    // view jumping under them -- but inside one, "take me there" is the request.
    const queued=ui.reviewQueue&&ui.selectedCandidateId?byId.get(ui.selectedCandidateId):null;
    const boundaryBox=target?.isGroup?unionBbox([...target.ids].map(id=>byId.get(id)).filter(Boolean))
      :queued?{x:queued.x,y:queued.y,w:queued.w,h:queued.h}:null;
    requestAnimationFrame(()=>applyReviewZoom(boundaryBox));
    const statusLabel=v=>t(v==="unreviewed"?"poi.unreviewed":v==="confirmed"?"poi.confirmed":"poi.rejected");
    return`<section class="planintel-screen ${ui.reviewQueue?"in-queue":""}"><header class="planintel-top">${FLOORPLAN.planModeSwitchHTML(event)}<div class="planintel-title"><h2>${a?t("plan.understood"):(ui.analysisBusy?esc(ui.analysisStage):t("plan.noAnalysisYet"))}</h2>${a?`<p>${a.ocr&&!a.ocr.available?esc(t("ocr.unavailable",{reason:t(OCR_REASON_KEY[a.ocr.reasonCode]||"ocr.reason.FAILED")})):esc(analysisNoticeText(a))}</p>`:`<p>${esc(ui.analysisStage)}</p>`}</div><span class="toolbar-spacer"></span>${a?`<details class="planintel-diagnostics"><summary>${t("diag.advancedDiagnostics")}</summary><div class="diag-pop">${detectionDiagnosticsHTML(a)}<div class="field"><label for="fld-review-filter-status">${t("diag.status")}</label><select id="fld-review-filter-status" data-review-filter="status"><option value="all">${t("diag.all")}</option>${["unreviewed","confirmed","rejected"].map(v=>`<option value="${v}" ${ui.reviewFilter===v?"selected":""}>${statusLabel(v)}</option>`).join("")}</select></div><div class="field full"><label for="fld-review-filter-confidence">${t("diag.minConfidence",{pct:Math.round(ui.reviewConfidence*100)})}</label><input id="fld-review-filter-confidence" data-review-filter="confidence" type="range" min="0" max=".95" step=".05" value="${ui.reviewConfidence}"></div><button class="btn sm" data-review-action="draw">${ui.reviewDrawMode?t("action.cancelDrawing"):t("action.aiMissed")}</button><button class="btn sm" data-review-action="save-verified">${t("action.saveVerifiedPlan")}</button><button class="btn sm" data-review-action="improve">${t("action.improveAI")}</button><button class="btn sm" data-review-action="export-dataset" title="${t("action.exportDatasetTitle")}">${t("action.exportDataset")}</button><button class="btn sm" data-review-action="session-report">${t("op.report")}</button></div></details><button class="btn" data-review-action="reanalyze">${t("action.reanalyze")}</button>`:""}</header>${reviewQueueBarHTML(event)}${pi?`<div class="planintel-map ${ui.reviewDrawMode?"draw-mode":""}" id="analysisScene"><div class="planintel-map-inner" id="analysisSceneInner"><img src="${event.background.src}" alt="${esc(t("review.planImageAlt"))}">${candidates.map(c=>candidateBox(c,selected?.id===c.id,target?.ids||null)).join("")}${boundaryBox?`<div class="review-group-boundary" style="left:${Math.max(0,boundaryBox.x-2.5)}%;top:${Math.max(0,boundaryBox.y-2.5)}%;width:${boundaryBox.w+5}%;height:${boundaryBox.h+5}%"></div>`:""}${pins.map(p=>p.kind==="group"?`<button class="review-pin group" data-review-action="focus-group" data-group="${p.groupId}" style="left:${p.x}%;top:${p.y}%" title="Review group ${p.label}">${p.label}</button>`:`<button class="review-pin question" data-question-action="open" data-question="${p.questionId}" style="left:${p.x}%;top:${p.y}%" title="${esc(t("review.difficultQuestion"))}">${p.label}</button>`).join("")}</div></div>${ui.operatorReportOpen?`<aside class="op-report-panel"><div class="op-report-head"><strong>${t("op.reportTitle")}</strong><button class="btn icon-only sm" data-review-action="close-session-report">${icon("x")}</button></div><div class="op-report-body">${operatorReportHTML(event)}</div></aside>`:""}${selected&&!ui.reviewDrawMode?reviewPoiCardHTML(selected):""}${difficultQuestionCardHTML(event)}${planIntelBottomPillHTML(event)}${ui.reviewCenterOpen?reviewCenterPanelHTML(event):""}`:`<div class="v8-empty" style="margin:40px"><h2>${ui.analysisBusy?t("plan.analyzingLocally"):t("plan.noAnalysisYet")}</h2><p>${esc(ui.analysisStage)}</p></div>`}</section>`;
  }

  function create(deps){
    if(created)throw new Error("MeritScreenReview.create() is called once, by app-v8.js.");
    created=true;
    activeEvent=deps.activeEvent;
    activeReviewTargetIds=deps.activeReviewTargetIds;
    applyReviewZoom=deps.applyReviewZoom;
    candidateBox=deps.candidateBox;
    esc=deps.esc;
    FLOORPLAN=deps.FLOORPLAN;
    icon=deps.icon;
    OCR_REASON_KEY=deps.OCR_REASON_KEY;
    operatorReportHTML=deps.operatorReportHTML;
    RECLASSIFY_TAXONOMY=deps.RECLASSIFY_TAXONOMY;
    render=deps.render;
    reviewCandidates=deps.reviewCandidates;
    scopeAvailability=deps.scopeAvailability;
    t=deps.t;
    titleCase=deps.titleCase;
    toast=deps.toast;
    ui=deps.ui;
    unionBbox=deps.unionBbox;
    UNVERIFIED_SEATING=deps.UNVERIFIED_SEATING;
    vlmQuestionCount=deps.vlmQuestionCount;
    return{afterReviewDecision,analysisHTML,closeReviewQueue,openReviewQueue,queueGo,queueNextOutstanding,reviewGroupCount};
  }
  globalThis.MeritScreenReview=Object.freeze({create,DEPS:Object.freeze(["activeEvent","activeReviewTargetIds","applyReviewZoom","candidateBox","esc","FLOORPLAN","icon","OCR_REASON_KEY","operatorReportHTML","RECLASSIFY_TAXONOMY","render","reviewCandidates","scopeAvailability","t","titleCase","toast","ui","unionBbox","UNVERIFIED_SEATING","vlmQuestionCount"])});
})();
