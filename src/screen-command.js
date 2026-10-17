// The Command Center screen: the verdict header, the readiness timeline, the
// Event Risk Radar, the Plan Doctor's findings and where each one goes, plan
// consistency, seating progress, the handover notes, and their bindings.
//
// Moved byte-for-byte out of app-v8.js on 2026-10-04 (technical gaps, item 2),
// at the original indentation. The edits forced by the move: LIVE is read
// through getLive() (app-v8.js creates the Live screen later in its own
// IIFE, so a captured value would not exist yet), and five names the rest of
// the shell uses are reached as COMMAND.name. What stayed in the shell,
// deliberately: planDoctorReport and eventReadiness (the one answer every
// surface reads), doctorSignature, and the two writers this screen calls —
// recordFinalCheck (the one writer of event.finalCheck) and addHandoverNote.
// This module renders and binds; it computes no verdict of its own.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that).
(() => {
  "use strict";
  let activeEvent;
  let addHandoverNote;
  let AVAIL;
  let canMutate;
  let doctorSignature;
  let esc;
  let eventMetrics;
  let eventReadiness;
  let exportBackup;
  let fmtDate;
  let getLive;
  let HANDOVER;
  let OCC;
  let onboardingCalloutHTML;
  let paxOf;
  let planDoctorReport;
  let recordFinalCheck;
  let relativeTime;
  let render;
  let resolvedFreezes;
  let resolvedHandoverNotes;
  let resolvedUnavailable;
  let RULES;
  let seatingCapacity;
  let serviceLoadHTML;
  let t;
  let toast;
  let touchEvent;
  let ui;
  let created=false;

  // WHAT is wrong and WHY the system believes it, in the operator's language.
  //
  // plan-doctor.js writes both in English on purpose -- they are what the
  // exported report and the regression suites read -- and carries the same fact
  // structurally in `params`, which is what a screen can translate. Same
  // pattern as the Self-Check's `params` and `origin`. A finding this table
  // does not know falls back to the module's own wording: English inside a
  // Turkish screen is a visible gap, which is the point; a raw key would not be.
  function doctorText(f){
    // planIssues() already wrote these through t(), so translating them again
    // would put a key where a sentence belongs.
    if(f.passthrough)return{what:f.what,detail:f.why};
    // One disagreement, one wording. The Command Center already restates
    // self-check findings from their own params, and a second phrasing of the
    // same finding in the same screen would read as two different problems.
    if(f.code==="planChecksDisagree"){
      const w=ccCheckText({id:f.checkId,verdict:"INCONSISTENT",params:f.params,statement:f.what,detail:f.why});
      return{what:w.statement,detail:w.detail};
    }
    const k="doctor."+f.code,has=x=>t(x)!==x;
    // Same ".1" convention the Self-Check restatement uses: a singular variant
    // exists only where a count of one would otherwise read as "1 tables". The
    // module puts the finding's primary count in `params.n` so this does not
    // have to know which of `guests`, `pax` or `seats` carries it. Turkish does
    // not inflect after a numeral, so its two forms are usually identical --
    // which is fine, and cheaper than teaching the substituter plural rules.
    const one=f.params&&f.params.n===1;
    const pick=x=>(one&&has(x+".1"))?x+".1":x;
    return{what:has(k)?t(pick(k),f.params):f.what,
      detail:has(k+".why")?t(pick(k+".why"),f.params):f.why};
  }
  // The Self-Check writes its sentences in English -- it is also read by the
  // benchmarks and the exported operator report. The Command Center is a
  // product screen and has to speak the operator's language, so it restates
  // each check from the structured `params` the check carries alongside its
  // sentence. A check this table does not know falls back to the module's own
  // wording: English in a Turkish screen is a visible gap, which is the point;
  // a raw key would not be.
  function ccCheckText(c){
    const p=c.params||{},base="cc.check."+String(c.id).split(":")[0]+"."+c.verdict;
    const has=k=>t(k)!==k;
    // A ".1" variant exists only where a count of one would otherwise read as
    // "1 numbers". English needs it; Turkish does not inflect the noun after a
    // numeral, so its two forms are usually the same sentence -- which is fine,
    // and cheaper than teaching the substituter about plural rules.
    const pick=k=>(p.d===1&&has(k+".1"))?k+".1":k;
    const s=pick(base),d=pick(base+".detail");
    return{
      statement:has(s)?t(s,p):c.statement,
      detail:has(d)?t(d,p):(c.detail||""),
    };
  }
  // Where a finding sends the operator, as a control rather than as a sentence.
  //
  // Three shapes, and the reason there are three rather than one is that two of
  // them already existed and are bound elsewhere: a bare screen is a [data-tab]
  // like every other navigation in the app, and the review centre has had its
  // own action since B2. Only a finding that points at a specific table, guest
  // or object needs the Doctor's own routing, and that is the one case where a
  // plain tab switch would lose the thing the row is about.
  //
  // Every finding gets one. A row that could not say where to go would be the
  // dead end the programme forbids, so `doctorGoHTML` returning "" is a defect
  // the suite checks for rather than a state the UI is allowed to reach.
  function doctorGoHTML(f,cls="btn sm"){
    const a=f.action||{};
    const GO=globalThis.MeritPlanDoctor?.GO||{};
    const targeted=a.tableId||a.guestIds?.length||a.candidateIds?.length||a.filter;
    if(a.go===GO.REVIEW_CENTER&&!targeted)
      return`<button class="${cls}" data-cc-action="review">${t("cc.goto.review")}</button>`;
    if(!targeted&&(a.go===GO.SEATING||a.go===GO.GUESTS||a.go===GO.FLOOR))
      return`<button class="${cls}" data-tab="${a.go.toLowerCase()}">${t("cc.goto."+a.go.toLowerCase())}</button>`;
    // A finding whose destination this table does not recognise still gets a
    // control, labelled generically rather than with a raw key -- an operator
    // must never be shown "doctor.go.SOMETHING". That the case is unreachable
    // is asserted against the module itself, where the defect would be, rather
    // than left to be noticed as odd wording on a screen.
    const label=t("doctor.go."+a.go);
    return`<button class="${cls}" data-cc-go="${esc(f.code)}${f.checkId?":"+esc(f.checkId):""}">${label==="doctor.go."+a.go?t("doctor.go.open"):label}</button>`;
  }
  // THE EVENT RISK RADAR.
  //
  // "What could make this event fail operationally?" — and it runs no engine of
  // its own, which is the point. Every row comes from the Plan Doctor, which in
  // turn compares facts other layers already concluded; there is no second
  // opinion here and no weighting.
  //
  // TWO THINGS IT REFUSES TO DO.
  //
  // It shows no percentage. "92% ready" has to come from somewhere, and there
  // is no honest weighting of one duplicate table number against twelve
  // unseated guests, so the radar says which of four named situations the
  // event is in and lists the reasons.
  //
  // It says what it cannot see. A radar that shows only the risks it knows how
  // to evaluate teaches an operator that a quiet radar means a safe event, so
  // the risks this build does not yet model are named underneath, in the same
  // breath as the verdict. The list comes from the Doctor rather than from a
  // sentence written here, so a risk that ships stops being listed by itself.
  function riskRadarHTML(event,r){
    const notEvaluated=(r.doctor&&r.doctor.notEvaluated)||[];
    const names=notEvaluated
      .map(x=>t("radar.notEvaluated."+x.risk))
      .filter((v,i)=>v!=="radar.notEvaluated."+notEvaluated[i].risk);
    return`<section class="cc-block cc-primary cc-radar">
      <div class="cc-radar-head"><h3>${t("radar.title")}</h3><p>${t("radar.question")}</p></div>
      ${onboardingCalloutHTML("commandCenter")}
      ${r.reasons.length?`<ul class="cc-reasons">${r.reasons.map(ccReasonHTML).join("")}</ul>`
        :`<p class="cc-empty">${t("cc.attention.none")}</p>`}
      ${names.length?`<p class="cc-radar-blind">${esc(t("radar.doesNotCover",{risks:names.join(", ")}))}</p>`:""}
    </section>`;
  }
  function ccReasonHTML(r){
    const w=doctorText(r.finding);
    return`<li class="cc-reason ${r.level}"><i class="health-dot ${r.level==="blocker"?"blocker":"warn"}"></i><div class="cc-reason-body"><b>${esc(w.what)}</b>${w.detail?`<span>${esc(w.detail)}</span>`:""}</div>${doctorGoHTML(r.finding)}</li>`;
  }
  // A full Plan Doctor row: WHAT, WHY, SOURCE, WHAT IT AFFECTS, and the way to
  // act on it. The attention list above says the first and the last of those
  // because it is a summary; this is the pre-flight report, where an operator
  // is deciding whether to trust the answer, and provenance is the whole point.
  function doctorRowHTML(f){
    const w=doctorText(f);
    // A name with no translation is dropped rather than printed: an unknown
    // SOURCE would otherwise render as "doctor.source.WHATEVER" on the screen.
    const named=(prefix,list)=>[...new Set(list||[])].map(v=>prefix+v).filter(k=>t(k)!==k).map(k=>t(k));
    const sources=named("doctor.source.",f.sources);
    const affects=named("doctor.affects.",f.affects);
    return`<li class="doc-row lvl-${f.level}">
      <div class="doc-row-body">
        <b>${esc(w.what)}</b>
        ${w.detail?`<span class="doc-why">${esc(w.detail)}</span>`:""}
        <span class="doc-meta">${esc(t("doctor.sourceLabel"))}: ${esc(sources.join("; "))}${
          affects.length?` · ${esc(t("doctor.affectsLabel"))}: ${esc(affects.join(", "))}`:""}</span>
      </div>${doctorGoHTML(f)}</li>`;
  }
  // The report itself. Collapsed to its verdict until someone asks for it:
  // the Command Center's job is "what deserves my attention now", and the
  // pre-flight is the deliberate act of checking everything before the doors
  // open -- including the INFORMATION rows, which are worth reading once and
  // would be noise in a list an operator scans every few minutes.
  function planDoctorHTML(event,r){
    const d=r.doctor;
    if(!d)return"";
    const V=globalThis.MeritPlanDoctor.VERDICT;
    const tone=d.verdict===V.NO?"blocker":d.verdict===V.WITH_REVIEW?"warn":"ok";
    const section=(key,rows)=>rows.length
      ?`<section class="doc-section ${key}"><h4>${t("doctor.level."+key)}<span>${rows.length}</span></h4><ul class="doc-rows">${rows.map(doctorRowHTML).join("")}</ul></section>`:"";
    const open=ui.doctorOpen;
    const ran=event.finalCheck||null;
    // A recorded run is a record of an ACT, not a cached answer: the rows above
    // are always current. Where the event has changed since, say so rather than
    // letting a timestamp imply that what is on screen was what was checked.
    const stamp=ran
      ?(ran.signature===doctorSignature(d)
        ?t("doctor.lastRun",{when:relativeTime(ran.at)})
        :t("doctor.changedSince"))
      :t("doctor.neverRun");
    return`<section class="cc-block cc-doctor ${tone}">
      <div class="cc-doctor-head">
        <div><h3>${t("doctor.title")}</h3><p class="cc-doctor-q">${t("doctor.question")}</p></div>
        <div class="cc-doctor-verdict"><strong>${t("doctor.verdict."+d.verdict)}</strong><span>${esc(stamp)}</span></div>
        <button class="btn sm ${open?"":"primary"}" data-cc-doctor="${open?"close":"run"}">${t(open?"doctor.hide":"doctor.run")}</button>
      </div>
      <div class="cc-doctor-tally">${[["BLOCKING",d.counts.blocking],["NEEDS_REVIEW",d.counts.needsReview],["INFORMATION",d.counts.information]]
        .map(([k,n])=>`<span class="doc-tally ${k}"><b>${n}</b>${t("doctor.level."+k)}</span>`).join("")}</div>
      ${open?(d.all.length
        ?`${section("BLOCKING",d.blocking)}${section("NEEDS_REVIEW",d.needsReview)}${section("INFORMATION",d.information)}`
        :`<p class="cc-doctor-empty">${t("doctor.allClear")}</p>`):""}
    </section>`;
  }

  // The Self-Check's first surface anywhere in the product. It produced real
  // findings that no operator could see unless they opened the review panel.
  function ccPlanConsistencyHTML(event){
    const sc=event.analysis?.selfCheck;
    // Two different silences, and saying the wrong one is a lie the operator
    // cannot detect. A plan that HAS been read but prints no figure about
    // itself -- no "166 tables x 12 pax = 1992" -- gives the self-check nothing
    // to compare, which is not the same as no plan having been read at all.
    if(!sc||!sc.checks.length){
      const analysed=!!event.analysis;
      return`<section class="cc-block"><h3>${t("cc.plan.title")}</h3><p class="cc-empty">${t(analysed?"cc.plan.nothingStated":"cc.plan.none")}</p></section>`;
    }
    const mark=v=>v==="CONSISTENT"?"ok":v==="INCONSISTENT"?"bad":v==="NEEDS_REVIEW"?"warn":"muted";
    const glyph=v=>v==="CONSISTENT"?"&#10003;":v==="INCONSISTENT"?"!":v==="NEEDS_REVIEW"?"?":"&#8212;";
    // RESULT, SOURCE and — where there is one — an ACTION. The sources come
    // from the check's own inputs, which have carried them since the engine was
    // built; nothing here invents provenance. The OCR internals stay out: an
    // operator needs to know a number was read off the drawing, not which two
    // crops agreed at what inset.
    return`<section class="cc-block"><h3>${t("cc.plan.title")}</h3><ul class="cc-checks">${sc.checks.map(c=>{
      const w=ccCheckText(c);
      // The ORIGIN, not the source sentence. The sentences are free English and
      // one of them is composed from the figures themselves; they also carry
      // OCR internals ("two crops agreed at what inset") that an operator does
      // not need and §5A says not to show by default.
      // An origin with no wording is DROPPED, not printed. It used to render as
      // "cc.origin.WHATEVER" the moment the value was anything this table did
      // not know -- which is one added ORIGIN away, and was found by rendering
      // the screen rather than by reading it.
      const sources=[...new Set((c.inputs||[]).map(i=>i&&i.origin).filter(Boolean))]
        .map(o=>"cc.origin."+o).filter(k=>t(k)!==k).map(k=>t(k));
      const act=c.verdict==="INCONSISTENT"||c.verdict==="NEEDS_REVIEW"
        ?`<button class="btn sm" data-cc-action="review">${t("cc.goto.review")}</button>`:"";
      return`<li class="cc-check ${mark(c.verdict)}"><i>${glyph(c.verdict)}</i><div class="cc-check-body"><b>${esc(w.statement)}</b><span>${esc(w.detail)}</span>${
        sources.length?`<em class="cc-check-source">${esc(t("cc.check.source"))}: ${esc(sources.join("; "))}</em>`:""}</div>${act}</li>`;
    }).join("")}</ul></section>`;
  }
  function ccSeatingHTML(event){
    // Beside pax/assigned/unassigned, this cell is read as "and how many
    // seats do we have" -- so it answers that, from operational capacity.
    // The drawn-chair count is a different fact and keeps its own labelled
    // column on the Home screen.
    const m=eventMetrics(event),cap=seatingCapacity(event);
    const cell=(v,l)=>`<div class="cc-metric"><b>${v}</b><span>${l}</span></div>`;
    return`<section class="cc-block"><h3>${t("cc.seating.title")}</h3><div class="cc-metrics">${
      cell(m.guests,t("cc.metric.pax"))}${cell(m.assigned,t("cc.metric.assigned"))}${
      cell(m.unassigned,t("cc.metric.unassigned"))}${cell(cap,t("cc.metric.seats"))}</div>${
      (()=>{const st=globalThis.MeritCapacityProvenance?.planStatedCapacity?.(event.analysis?.planIntelligence?.capacityAudit);
        // PRINTED_TOTAL_CAPACITY is a fact about the PLAN: stated beside the
        // counted seats, never spread across tables.
        return st?`<p class="cc-note" data-plan-stated-capacity>${esc(t(st.rule?"cc.planStatedRule":"cc.planStated",{total:st.total,units:st.rule?.units,perUnit:st.rule?.perUnit}))}</p>`:"";})()}${
      m.unassigned?`<button class="btn sm" data-tab="seating">${t("cc.goto.seating")}</button>`:""}</section>`;
  }
  // One shift tells the next what it needs to know. The digest computes
  // nothing new — every figure here is read straight from the module that
  // already owns it, so Handover cannot say something the rest of the screen
  // would disagree with. The notes below the digest are the ONLY thing this
  // section itself owns: free text, kept verbatim, newest first, with no edit
  // and no delete — and deliberately not the future Audit Trail (Phase P),
  // which will be a structured log of decisions the system itself recorded.
  function eventHandoverHTML(event,r){
    const H=HANDOVER();
    if(!H)return"";
    const m=eventMetrics(event),live=OCC().liveStats(event,{paxOf});
    const frozenCount=new Set((resolvedFreezes(event)||[]).map(f=>f.tableId)).size;
    const A=AVAIL();
    const unavailable=resolvedUnavailable(event)||[];
    const stranded=A?A.strandedGuests(event.tables||[],event.guests||[]):{records:0,pax:0};
    const notes=resolvedHandoverNotes(event);
    const historical=RULES().isHistorical(event);
    const cell=(v,l)=>`<div class="cc-metric"><b>${v}</b><span>${l}</span></div>`;
    return`<section class="cc-block cc-handover">
      <h3>${t("handover.title")}</h3>
      <p class="cc-handover-q">${t("handover.question")}</p>
      <div class="cc-metrics cc-metrics-handover">
        ${cell(t("cc.verdict."+r.verdict),t("handover.metric.verdict"))}
        ${cell(m.unassigned,t("handover.metric.unassigned"))}
        ${cell(live.notArrived,t("handover.metric.notArrived"))}
        ${cell(live.noShow,t("handover.metric.noShow"))}
        ${cell(frozenCount,t("handover.metric.frozen"))}
        ${cell(unavailable.length,t("handover.metric.unavailable"))}
      </div>
      ${stranded.records?`<p class="cc-handover-alert">${esc(t(stranded.records===1?"handover.stranded.1":"handover.stranded",{n:stranded.records,pax:stranded.pax}))}</p>`:""}
      <div class="cc-handover-notes">${notes.length
        ?`<ul class="handover-list">${notes.map(n=>`<li class="handover-note"><p>${esc(n.text)}</p><span>${
            n.by?esc(n.by)+" · ":""}${esc(relativeTime(n.at))}</span></li>`).join("")}</ul>`
        :`<p class="cc-empty">${t("handover.none")}</p>`}</div>
      ${historical?"":`<div class="cc-handover-form">
        <textarea data-handover-text placeholder="${esc(t("handover.placeholder"))}" maxlength="${H.NOTE_MAX}"></textarea>
        <div class="cc-handover-form-row">
          <input type="text" data-handover-by placeholder="${esc(t("handover.byPlaceholder"))}" maxlength="${H.BY_MAX}">
          <button class="btn sm primary" data-handover-add>${t("handover.add")}</button>
        </div>
      </div>`}
    </section>`;
  }
  // ---- READINESS TIMELINE (§22) ---------------------------------------------
  // The Command Center answered "can this event proceed?" with no sense of
  // time: nothing said how far away the event is, what had been done and when,
  // or that the last final check is older than the latest change. This strip
  // is DERIVED from what is already recorded -- the event date, the plan's
  // confirmation moment, guests' createdAt, the recorded final check, the
  // handover notes -- and invents nothing: a step whose moment was never
  // recorded says "done" without a date, never a guessed one, and nothing is
  // forecast (no "on track", no projected completion).
  function readinessSteps(event){
    const d=globalThis.MeritPlanDoctor?planDoctorReport(event):null;
    const guests=event.guests||[],total=guests.reduce((n,g)=>n+paxOf(g),0);
    const seated=guests.filter(g=>g.assignment).reduce((n,g)=>n+paxOf(g),0);
    const firstGuestAt=guests.map(g=>g.createdAt).filter(Boolean).sort()[0]||null;
    const confirmedMs=event.analysis?.timings?.confirmedAtMs;
    const ran=event.finalCheck||null;
    const stale=!!(ran&&d&&ran.signature!==doctorSignature(d));
    const notes=(event.handoverNotes||[]).filter(n=>n&&n.at).map(n=>n.at).sort();
    const days=daysUntil(event.date);
    return[
      {key:"plan",state:event.tables.length?"done":"open",at:event.tables.length&&confirmedMs?new Date(confirmedMs).toISOString():null,
        detail:event.tables.length?t("timeline.plan.done",{n:event.tables.length}):t("timeline.plan.open"),go:"floor"},
      {key:"guests",state:guests.length?"done":"open",at:firstGuestAt,
        detail:guests.length?t("timeline.guests.done",{n:guests.length,pax:total}):t("timeline.guests.open"),go:"guests"},
      {key:"seating",state:!total||!seated?"open":seated===total?"done":"partial",at:null,
        detail:total?t("timeline.seating.progress",{seated,total}):t("timeline.seating.none"),go:"seating"},
      {key:"check",state:!ran?"open":stale?"stale":"done",at:ran?ran.at:null,
        detail:t(!ran?"timeline.check.never":stale?"timeline.check.stale":"timeline.check.done"),go:"check"},
      {key:"handover",state:notes.length?"done":"open",at:notes.length?notes[notes.length-1]:null,
        detail:notes.length?t("timeline.handover.done",{n:notes.length}):t("timeline.handover.open"),go:"handover"},
      {key:"day",state:days==null?"open":days<0?"done":days===0?"today":"upcoming",at:null,
        detail:days==null?t("timeline.day.noDate"):days<0?t("timeline.day.past",{n:-days}):days===0?t("timeline.day.today"):t(days===1?"timeline.day.tomorrow":"timeline.day.inDays",{n:days}),go:null},
    ];
  }
  // Whole calendar days from today to the event date, in local time. A
  // calendar fact, not a forecast.
  function daysUntil(dateText){
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText||""));if(!m)return null;
    const day=new Date(+m[1],+m[2]-1,+m[3]),now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    return Math.round((day-today)/86400000);
  }
  function readinessTimelineHTML(event){
    if(RULES().isHistorical(event))return"";
    const steps=readinessSteps(event);
    // Characters the UI font carries: "◐" rendered as a clipped half-glyph (§25).
    const mark={done:"✓",partial:"…",stale:"!",open:"○",today:"●",upcoming:"○"};
    return`<section class="cc-timeline" data-readiness-timeline aria-label="${esc(t("timeline.title"))}"><h3>${t("timeline.title")}</h3><ol>${steps.map(s=>`<li class="tl-step ${s.state}" data-step="${s.key}" data-state="${s.state}">
      <span class="tl-mark" aria-hidden="true">${mark[s.state]}</span>
      <div class="tl-body"><b>${t("timeline.step."+s.key)}</b><span>${esc(s.detail)}</span>${s.at?`<time datetime="${esc(s.at)}">${esc(fmtDate(String(s.at).slice(0,10)))}</time>`:""}</div>
      ${s.go&&s.state!=="done"?`<button class="btn sm quiet" data-timeline-go="${s.go}">${t("timeline.go."+s.go)}</button>`:""}
    </li>`).join("")}</ol></section>`;
  }
  document.addEventListener("click",e=>{
    const b=e.target.closest&&e.target.closest("[data-timeline-go]");
    if(!b)return;
    const g=b.dataset.timelineGo;
    if(g==="check"){document.querySelector('[data-cc-doctor="run"]')?.click();return;}
    if(g==="handover"){document.querySelector("[data-handover-text]")?.focus();return;}
    ui.tab=g;if(g==="floor")ui.planMode="plan";render();
  });
  function commandCenterHTML(event){
    const r=eventReadiness(event);
    return`<div class="screen-scroll"><div class="screen-inner command-center">
      <header class="cc-head verdict-${r.verdict}">
        <div class="cc-phase phase-${r.phase}">${t("cc.phase."+r.phase)}</div>
        <div class="cc-verdict">
          <strong>${t("cc.verdict."+r.verdict)}</strong>
          <span>${r.reasons.length?t(r.reasons.length===1?"cc.verdict.reasonCount1":"cc.verdict.reasonCount",{n:r.reasons.length}):t("cc.verdict.nothingOpen")}</span>
        </div>
      </header>
      ${readinessTimelineHTML(event)}
      ${riskRadarHTML(event,r)}
      <div class="cc-columns">${ccPlanConsistencyHTML(event)}${ccSeatingHTML(event)}</div>
      <div class="cc-columns">${getLive().arrivalWaveHTML(event,{compact:true})}${serviceLoadHTML(event,{compact:true})}</div>
      ${planDoctorHTML(event,r)}
      ${eventHandoverHTML(event,r)}
    </div></div>`;
  }
  // Take the operator to the thing the row is about, not merely to the screen
  // it lives on. A target that no longer resolves -- the table was deleted, the
  // candidate was dismissed -- falls back to the screen rather than doing
  // nothing: the row is about something that changed, and stranding the
  // operator on the Command Center with a click that did nothing is worse than
  // landing them one level too wide.
  function doctorGo(event,f){
    const a=(f&&f.action)||{};
    const GO=globalThis.MeritPlanDoctor.GO;
    const table=a.tableId?event.tables.find(x=>x.id===a.tableId):null;
    const guest=(a.guestIds||[]).map(id=>event.guests.find(g=>g.id===id)).find(Boolean)||null;
    if(a.go===GO.FLOOR){
      ui.tab="floor";ui.planMode="plan";
      ui.selectedObjectId=table?table.id:null;ui.selectedObjectIds=table?[table.id]:[];
      ui.highlightId=table?table.id:null;
    }else if(a.go===GO.GUESTS){
      ui.tab="guests";
      if(guest){ui.guestQuery=guest.name;ui.guestFilter="all";ui.guestWindow=null;}
    }else if(a.go===GO.SEATING){
      ui.tab="seating";ui.operationalMode=false;
      ui.seatingFilter=a.filter||"all";
      ui.seatingQuery="";
      ui.seatingGuestScope=guest&&!guest.assignment?"unassigned":"all";
      ui.selectedGuestId=guest?guest.id:null;
      ui.selectedTableId=table?table.id:(guest&&guest.assignment?guest.assignment.tableId:null);
      ui.highlightId=ui.selectedTableId;
    }else if(a.go===GO.LIVE){
      // The arrivals screen, narrowed to the person the row is about. A row
      // about twelve No Shows opens the list; a row about one opens on them.
      ui.tab="live";
      ui.liveQuery=(a.guestIds||[]).length===1&&guest?guest.name:"";
      ui.liveWindow=null;
    }else if(a.go===GO.BACKUP){
      // The only row whose destination is an ACTION rather than a screen.
      // "Go and find the export button" is the dead end this layer forbids,
      // and the risk is precisely that nobody got round to pressing it.
      //
      // The render below is not cosmetic: without it the operator presses the
      // button, gets a file and a toast, and the row that asked for it is
      // still sitting there — which reads as "it did not work". The report is
      // derived on every read, so one render is all it takes for the risk to
      // disappear by itself.
      exportBackup();
      render();
      return;
    }else{
      // REVIEW and REVIEW_CENTER. Both land in the Floor Plan's review mode --
      // there is no separate review screen since B3 -- and differ only in
      // whether an object or the budget is what the operator came for.
      ui.tab="floor";ui.planMode="review";
      const alive=new Set((event.analysis?.candidates||[]).map(c=>c.id));
      const target=(a.candidateIds||[]).find(id=>alive.has(id))||null;
      ui.selectedCandidateId=target;
      ui.reviewCenterOpen=!target;
      ui.activeReviewGroupId=null;ui.activeQuestionId=null;
    }
    render();
  }
  // The Doctor's controls, wherever its reasons are shown -- the Command
  // Center and Reports' "Before you export" -- so a reason goes to the same
  // place from either.
  function bindDoctorGo(event){
    document.querySelectorAll("[data-cc-action]").forEach(b=>b.onclick=()=>{
      if(b.dataset.ccAction==="review"){ui.reviewCenterOpen=true;ui.tab="floor";ui.planMode="review";render();}
    });
    // The row is matched back to the live report rather than carrying its own
    // copy of the target: between render and click the operator may have fixed
    // the problem in another tab, and acting on a stale payload would send them
    // to a table that no longer exists.
    document.querySelectorAll("[data-cc-go]").forEach(b=>b.onclick=()=>{
      const [code,checkId]=String(b.dataset.ccGo).split(":");
      const d=planDoctorReport(event);
      const f=d&&d.all.find(x=>x.code===code&&(!checkId||x.checkId===checkId));
      if(f)doctorGo(event,f);else render();
    });
  }
  function bindCommand(){
    const event=activeEvent();
    bindDoctorGo(event);
    document.querySelectorAll("[data-cc-doctor]").forEach(b=>b.onclick=()=>{
      if(b.dataset.ccDoctor==="close"){ui.doctorOpen=false;render();return;}
      ui.doctorOpen=true;
      recordFinalCheck(event,planDoctorReport(event));
      render();
    });
    document.querySelectorAll("[data-handover-add]").forEach(b=>b.onclick=()=>{
      if(!canMutate(event,"add a handover note"))return;
      const textEl=document.querySelector("[data-handover-text]");
      const byEl=document.querySelector("[data-handover-by]");
      const note=addHandoverNote(event,textEl?textEl.value:"",byEl?byEl.value:"");
      if(!note){toast(t("handover.empty"),"error");return;}
      touchEvent(event);
      render();
      toast(t("handover.added"),"success");
    });
  }

  function create(deps){
    if(created)throw new Error("MeritScreenCommand.create() is called once, by app-v8.js.");
    created=true;
    activeEvent=deps.activeEvent;
    addHandoverNote=deps.addHandoverNote;
    AVAIL=deps.AVAIL;
    canMutate=deps.canMutate;
    doctorSignature=deps.doctorSignature;
    esc=deps.esc;
    eventMetrics=deps.eventMetrics;
    eventReadiness=deps.eventReadiness;
    exportBackup=deps.exportBackup;
    fmtDate=deps.fmtDate;
    getLive=deps.getLive;
    HANDOVER=deps.HANDOVER;
    OCC=deps.OCC;
    onboardingCalloutHTML=deps.onboardingCalloutHTML;
    paxOf=deps.paxOf;
    planDoctorReport=deps.planDoctorReport;
    recordFinalCheck=deps.recordFinalCheck;
    relativeTime=deps.relativeTime;
    render=deps.render;
    resolvedFreezes=deps.resolvedFreezes;
    resolvedHandoverNotes=deps.resolvedHandoverNotes;
    resolvedUnavailable=deps.resolvedUnavailable;
    RULES=deps.RULES;
    seatingCapacity=deps.seatingCapacity;
    serviceLoadHTML=deps.serviceLoadHTML;
    t=deps.t;
    toast=deps.toast;
    touchEvent=deps.touchEvent;
    ui=deps.ui;
    return{bindCommand,bindDoctorGo,commandCenterHTML,doctorGoHTML,doctorText};
  }
  globalThis.MeritScreenCommand=Object.freeze({create,DEPS:Object.freeze(["activeEvent","addHandoverNote","AVAIL","canMutate","doctorSignature","esc","eventMetrics","eventReadiness","exportBackup","fmtDate","getLive","HANDOVER","OCC","onboardingCalloutHTML","paxOf","planDoctorReport","recordFinalCheck","relativeTime","render","resolvedFreezes","resolvedHandoverNotes","resolvedUnavailable","RULES","seatingCapacity","serviceLoadHTML","t","toast","touchEvent","ui"])});
})();
