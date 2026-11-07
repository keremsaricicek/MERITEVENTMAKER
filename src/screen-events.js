// The Events home screen: a month calendar of the real events with a calm
// detail panel (redesign step 1, 2026-11-07 — it replaced the hero card and
// the two lists), and what the history says (two averaged facts, no model).
//
// Moved byte-for-byte out of app-v8.js on 2026-10-04 (technical gaps, item 2),
// at the original indentation. The edits forced by the move: eventsHTML
// becomes this module's own function (app-v8.js keeps the override and calls
// through), and `state` is read through getState(), because the shell
// reassigns it (a backup restore, an import) and a captured value would go
// stale. The controls on this screen are bound by the shell's common binder,
// which stayed where it was: duplicating, exporting and deleting an event are
// writes.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that).
(() => {
  "use strict";
  let esc;
  let eventMetrics;
  let fmtDate;
  let getActiveId;
  let getState;
  let icon;
  let readiness;
  let RULES;
  let seatingCapacity;
  let skin;
  let t;
  let topbarHTML;
  let created=false;

  // ---- THE MONTH CALENDAR (owner-approved redesign v3, 2026-11-07) -------------
  //
  // One slim entry per event on its own day, Monday first; past events grey with
  // a lock (they are read-only everywhere else too: RULES().isHistorical). A click
  // only SELECTS — the calm panel on the right fills, nothing else moves; a
  // double-click, or "Etkinliği aç", opens. Which month and which event are shown
  // is this screen's own view state, never stored and never part of an event.
  //
  // The panel's figures are the event's own records (eventMetrics: pax, not
  // rows; seatingCapacity: logical seats, never drawn chairs; MeritArrivalWave:
  // who checked in) and "Hazır mı?" is the Plan Doctor's reading, handed over by
  // the shell — this screen forms no opinion of its own.
  const view={month:null,pick:null,shown:null};
  const pad2=n=>String(n).padStart(2,"0");
  const todayISO=()=>new Date().toLocaleDateString("en-CA");
  const lang=()=>(globalThis.MERIT_I18N_LANG&&globalThis.MERIT_I18N_LANG()==="en"?"en-GB":"tr-TR");
  const validDate=d=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d);
  function monthTitle(ym){
    const [y,m]=ym.split("-").map(Number);
    const name=new Intl.DateTimeFormat(lang(),{month:"long"}).format(new Date(y,m-1,1,12));
    return name.charAt(0).toLocaleUpperCase(lang())+name.slice(1)+" "+y;
  }
  function weekday(d){return new Intl.DateTimeFormat(lang(),{weekday:"long"}).format(new Date(d+"T12:00:00"));}
  function venueOf(e){return[e.hotel,e.salon].filter(Boolean).join(" · ");}
  // The event shown in the panel: the one clicked, else the one the operator
  // was just in, else the next upcoming, else the most recent past.
  function resolveSelected(events){
    const byId=id=>id&&events.find(e=>e.id===id);
    const upcoming=events.filter(e=>!RULES().isHistorical(e)).sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999"));
    const past=events.filter(e=>RULES().isHistorical(e)).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
    return byId(view.pick)||byId(getActiveId())||upcoming[0]||past[0]||null;
  }
  function select(id){view.pick=id||null;}
  function focus(id){view.pick=id||null;view.month=null;}
  function shift(n){
    if(!n){view.month=todayISO().slice(0,7);return;}
    const [y,m]=(view.month||view.shown||todayISO().slice(0,7)).split("-").map(Number);
    const d=new Date(y,m-1+n,1,12);
    view.month=d.getFullYear()+"-"+pad2(d.getMonth()+1);
  }
  function entryHTML(e,selectedId){
    const past=RULES().isHistorical(e),venue=e.salon||e.hotel||"";
    return`<button type="button" class="cal-entry${past?" past":""}${e.id===selectedId?" on":""}" data-cal-event="${esc(e.id)}"${past?` data-history-event="${esc(e.id)}"`:""} title="${esc(t("cal.entryTitle",{name:e.name}))}">${past?icon("lock"):"<i></i>"}<span class="cal-en"><b>${esc(e.name)}</b>${venue?`<small>${esc(venue)}</small>`:""}</span></button>`;
  }
  function gridHTML(events,ym,selectedId){
    const [Y,M]=ym.split("-").map(Number),today=todayISO();
    const start=(new Date(Y,M-1,1,12).getDay()+6)%7,days=new Date(Y,M,0,12).getDate(),cells=Math.ceil((start+days)/7)*7;
    let h="";
    for(let i=0;i<cells;i++){
      const d=i-start+1;
      if(d<1||d>days){h+=`<div class="cal-cell off"></div>`;continue;}
      const ds=`${Y}-${pad2(M)}-${pad2(d)}`;
      const here=events.filter(e=>e.date===ds).sort((a,b)=>String(a.name).localeCompare(String(b.name),lang()));
      h+=`<div class="cal-cell${ds===today?" today":""}${ds<today?" was":""}"><span class="cal-dn">${d}</span>${here.map(e=>entryHTML(e,selectedId)).join("")}${ds>=today?`<button type="button" class="cal-add" data-cal-new="${ds}" aria-label="${esc(t("cal.newEvent"))} · ${d}">+</button>`:""}</div>`;
    }
    const dow=t("cal.dow").split("|");
    return`<div class="cal-dow">${dow.map(x=>`<span>${esc(x)}</span>`).join("")}</div><div class="cal-grid" style="grid-template-rows:repeat(${cells/7},minmax(0,1fr))">${h}</div>`;
  }
  function detailHTML(e,historyEvents){
    if(!e)return`<aside class="cal-detail" aria-live="polite"><div class="cal-d-empty"><div class="cal-d-eyebrow">${esc(t("cal.eyebrow.first"))}</div><h2 class="cal-d-title">${esc(t("cal.none"))}</h2><p>${esc(t("cal.noneHint"))}</p></div>${eventHistoryLearningHTML(historyEvents)}</aside>`;
    const past=RULES().isHistorical(e),today=todayISO();
    const m=eventMetrics(e),SM=globalThis.MeritSeatModel,AW=globalThis.MeritArrivalWave;
    const tables=(e.tables||[]).filter(x=>SM?SM.canSeat(x):Number(x.capacity)>0).length;
    const arrived=AW?AW.build({guests:e.guests||[],bucketMinutes:30}).actual.pax:0;
    const kind=past?"past":e.date===today?"today":"upcoming";
    const when=validDate(e.date)?`${esc(fmtDate(e.date))}, ${esc(weekday(e.date))}`:esc(t("cal.undated"));
    const fact=(k,label,v,extra="")=>`<div data-cal-fact="${k}"><dt>${esc(label)}</dt><dd>${v}</dd>${extra}</div>`;
    let lines;
    if(past)lines=[{level:"info",text:t("cal.ready.past")}];
    else{
      const all=readiness(e)||[];
      const cap=s=>String(s||"").charAt(0).toLocaleUpperCase(lang())+String(s||"").slice(1);
      lines=all.length?all.slice(0,4).map(l=>({level:l.level,text:cap(l.text)})):[{level:"ok",text:t("cal.ready.none")}];
      if(all.length>4)lines[3]={level:"info",text:t("cal.ready.more",{n:all.length-3})};
    }
    const id=esc(e.id);
    // SPEC-v4: the tools are where the hand looks for them, visible, not behind ⋯.
    const tools=[
      ...(past?[]:[`<button type="button" class="btn" data-duplicate-event="${id}">${esc(t("home.duplicate"))}</button>`]),
      `<button type="button" class="btn" data-export-event-package="${id}" title="${esc(t("home.exportPackage"))}">${esc(t("cal.export"))}</button>`,
      `<button type="button" class="btn quiet danger" data-delete-event="${id}">${esc(t("cal.delete"))}</button>`,
    ].join("");
    return`<aside class="cal-detail" aria-live="polite">
      <div class="cal-d-eyebrow ${kind}">${esc(t("cal.eyebrow."+kind))}</div>
      <h2 class="cal-d-title">${esc(e.name)}</h2>
      <div class="cal-d-meta">${when}<br>${esc(venueOf(e)||t("appbar.venueNotSet"))}</div>
      <dl class="cal-facts">${fact("pax",t("cal.fact.pax"),m.guests)}${fact("tables",t("cal.fact.tables"),tables,`<dd class="cal-sub">${esc(t("cal.fact.seats",{n:seatingCapacity(e)}))}</dd>`)}${fact("seated",t("cal.fact.seated"),m.assigned)}${fact("arrived",t("cal.fact.arrived"),arrived)}</dl>
      <h3 class="cal-d-h">${esc(t("cal.ready"))}</h3>
      <ul class="cal-ready">${lines.map(l=>`<li class="${esc(l.level)}"><i class="cal-mk"></i><span>${esc(l.text)}</span></li>`).join("")}</ul>
      <div class="cal-d-acts"><button type="button" class="btn primary" data-open-event="${id}">${esc(t(past?"cal.openPast":"cal.open"))}</button><button type="button" class="btn" data-duplicate-layout="${id}" title="${esc(t("home.duplicateLayoutTitle"))}">${esc(t("cal.sameLayout"))}</button>${tools}</div>
      ${eventHistoryLearningHTML(historyEvents)}
    </aside>`;
  }
  // ---- THEME A: THE TIMELINE OF PLATES (SPEC-v4, benchmarks/ux/redesign/7-atlas-sade)
  //
  // Every event as a plate: its venue's own small plan, drawn from the event's
  // REAL tables (one shape per table at its stored position and size, rotation
  // kept; no chair is drawn, none invented), date, name, venue. Past ones on the
  // left, quiet and read-only; a "Bugün" line; today and upcoming on the right;
  // undated last. A click selects (the same data-cal-event the calendar uses),
  // the calm panel below carries the facts and the tools.
  function plateSVG(e){
    const ts=(e.tables||[]).filter(x=>[x.x,x.y,x.w,x.h].every(v=>Number.isFinite(Number(v))));
    if(!ts.length)return`<svg viewBox="0 0 160 104" class="tl-plan" role="img" aria-label="${esc(t("tl.noPlan"))}"><rect class="tl-none" x="6" y="6" width="148" height="92" rx="2"/><text x="80" y="57" text-anchor="middle" class="tl-none-t">${esc(t("tl.noPlan"))}</text></svg>`;
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const x of ts){const X=Number(x.x),Y=Number(x.y),W=Number(x.w),H=Number(x.h);x0=Math.min(x0,X);y0=Math.min(y0,Y);x1=Math.max(x1,X+W);y1=Math.max(y1,Y+H);}
    const pad=Math.max(24,(x1-x0)*.06),vx=x0-pad,vy=y0-pad,vw=x1-x0+2*pad,vh=y1-y0+2*pad,n=v=>Math.round(v*10)/10;
    const shapes=ts.map(x=>{
      const X=Number(x.x),Y=Number(x.y),W=Number(x.w),H=Number(x.h),cx=n(X+W/2),cy=n(Y+H/2),rot=Number(x.rotation)||0;
      const round=/round|bistro|cocktail|circle/.test(String(x.shape||x.type||""))&&!/rect|long|banquet/.test(String(x.shape||""));
      const tr=rot?` transform="rotate(${n(rot)} ${cx} ${cy})"`:"";
      return round?`<ellipse class="tl-t" cx="${cx}" cy="${cy}" rx="${n(W/2)}" ry="${n(H/2)}"${tr}/>`:`<rect class="tl-t" x="${n(X)}" y="${n(Y)}" width="${n(W)}" height="${n(H)}"${tr}/>`;
    }).join("");
    return`<svg viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" class="tl-plan" preserveAspectRatio="xMidYMax meet" role="img" aria-label="${esc(t("tl.planOf",{n:ts.length}))}"><rect class="tl-room" x="${n(vx)}" y="${n(vy)}" width="${n(vw)}" height="${n(vh)}" vector-effect="non-scaling-stroke"/>${shapes}</svg>`;
  }
  function timelineHTML(events,selectedId){
    const dated=events.filter(e=>validDate(e.date)).sort((a,b)=>a.date.localeCompare(b.date)||String(a.name).localeCompare(String(b.name),lang()));
    const undated=events.filter(e=>!validDate(e.date));
    const plate=e=>{
      const past=RULES().isHistorical(e),venue=venueOf(e),m=eventMetrics(e);
      const when=validDate(e.date)?`${esc(fmtDate(e.date))}<br>${esc(weekday(e.date))}`:esc(t("cal.undated"));
      const status=past?`${icon("lock")}${esc(t("tl.readOnly"))}`:esc(t("tl.status",{seated:m.assigned,pax:m.guests}));
      return`<button type="button" class="tl-plate${past?" past":""}${e.id===selectedId?" on":""}" data-cal-event="${esc(e.id)}"${past?` data-history-event="${esc(e.id)}"`:""} aria-pressed="${e.id===selectedId}" title="${esc(t("cal.entryTitle",{name:e.name}))}"><span class="tl-dr">${plateSVG(e)}</span><span class="tl-cap"><span class="tl-dt">${when}</span><b class="tl-nm">${esc(e.name)}</b>${venue?`<span class="tl-vn">${esc(venue)}</span>`:""}<span class="tl-ss">${status}</span></span></button>`;
    };
    const today=todayISO();
    let h="",crossed=false;
    for(const e of dated){
      if(!crossed&&!RULES().isHistorical(e)){crossed=true;h+=todayLine(today);}
      h+=plate(e);
    }
    if(!crossed)h+=todayLine(today);
    h+=undated.map(plate).join("");
    return`<div class="tl-strip" role="group" aria-label="${esc(t("cal.title"))}">${h}</div>`;
  }
  function todayLine(d){return`<div class="tl-today" aria-hidden="true"><span class="tl-today-lab">${esc(t("cal.today"))}<br>${esc(fmtDate(d))}</span></div>`;}
  // ---- EVENT HISTORY & LEARNING ----------------------------------------
  //
  // Not a second Reports screen and not a model: src/event-history.js
  // averages exactly two real per-event facts (room utilization, no-show
  // rate) that MeritArrivalWave and eventMetrics()/physicalCapacity()
  // already computed for each completed event -- this function reads and
  // combines them, and computes nothing of its own. Shown only once there
  // is at least one completed event to read from.
  function eventHistoryLearningHTML(historyEvents){
    const M=globalThis.MeritEventHistory,AW=globalThis.MeritArrivalWave;
    if(!M||!AW||!historyEvents.length)return"";
    const outcomes=historyEvents.map(e=>{
      const w=AW.build({guests:e.guests||[],bucketMinutes:30});
      return M.outcome({
        totalPax:eventMetrics(e).guests,
        actualPax:w.actual.pax,
        // Utilisation is people against the seats the room had, so a
        // symbolic plan's history is measurable too.
        capacity:seatingCapacity(e),
        noShowPax:w.noShow.pax,
        noShowRecords:w.noShow.records,
      });
    });
    const L=M.learning(outcomes);
    const pct=x=>(x===null||x===undefined)?null:Math.round(x*100);
    const util=pct(L.averageUtilization),noShow=pct(L.averageNoShowRate);
    const sampleNote=sample=>sample===1?t("history.sampleNote1"):t("history.sampleNote",{n:sample});
    const tile=(label,value,sample)=>`<div class="mx-metric"><span class="mx-metric-label">${label}</span><span class="mx-metric-value">${value===null?"—":value+"%"}</span><span class="mx-metric-note">${sample?sampleNote(sample):t("history.noData")}</span></div>`;
    return`<div class="mx-section history-learning"><div class="mx-section-head"><h2>${t("history.title")}</h2></div>
      <p class="history-note">${t("history.note")}</p>
      <div class="mx-metrics" style="margin-bottom:0">
        ${tile(t("history.avgUtilization"),util,L.utilizationSampleSize)}
        ${tile(t("history.avgNoShow"),noShow,L.noShowSampleSize)}
      </div>
    </div>`;
  }
  const eventsHTML = function(){
    const events=getState().events;
    const history=events.filter(e=>RULES().isHistorical(e)).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
    // Resolved on every render, never stored back: only a click selects, so
    // coming back from another event shows that event.
    const sel=resolveSelected(events),selId=sel?sel.id:null;
    const ym=view.month||(sel&&validDate(sel.date)?sel.date.slice(0,7):todayISO().slice(0,7));
    view.shown=ym;
    const undated=events.filter(e=>!validDate(e.date));
    const count=t(events.length===1?"home.eventCount1":"home.eventsCount",{n:events.length});
    const bar=topbarHTML({screen:"events",homeTarget:sel?{id:sel.id,historical:RULES().isHistorical(sel)}:null});
    if(skin&&skin()==="a")return`${bar}<section class="cal-screen tl-screen theme-scope">
      <div class="mx-head cal-head tl-head"><div><h1>${esc(t("cal.title"))}</h1><p>${esc(t("tl.subtitle"))} · ${esc(count)}</p></div><button type="button" class="btn primary" data-action="create-event">${icon("plus")}${esc(t("cal.newEvent"))}</button></div>
      ${timelineHTML(events,selId)}
      ${detailHTML(sel,history)}
    </section>`;
    return`${bar}<section class="cal-screen theme-scope">
      <div class="mx-head cal-head"><div><h1>${esc(t("cal.title"))}</h1><p>${esc(t("cal.subtitle"))} · ${esc(count)}</p></div><button type="button" class="btn primary" data-action="create-event">${icon("plus")}${esc(t("cal.newEvent"))}</button></div>
      <div class="cal-wrap"><div class="cal-box">
        <div class="cal-nav"><button type="button" class="shell-icon-btn" data-cal-month="-1" aria-label="${esc(t("cal.prev"))}" title="${esc(t("cal.prev"))}">‹</button><h2 class="cal-month">${esc(monthTitle(ym))}</h2><button type="button" class="shell-icon-btn" data-cal-month="1" aria-label="${esc(t("cal.next"))}" title="${esc(t("cal.next"))}">›</button><button type="button" class="btn sm" data-cal-month="0">${esc(t("cal.today"))}</button>${undated.length?`<div class="cal-undated"><span>${esc(t("cal.undated"))}</span>${undated.map(e=>entryHTML(e,selId)).join("")}</div>`:""}</div>
        ${gridHTML(events,ym,selId)}
      </div>${detailHTML(sel,history)}</div>
    </section>`;
  };

  function create(deps){
    if(created)throw new Error("MeritScreenEvents.create() is called once, by app-v8.js.");
    created=true;
    esc=deps.esc;
    eventMetrics=deps.eventMetrics;
    fmtDate=deps.fmtDate;
    getActiveId=deps.getActiveId;
    getState=deps.getState;
    icon=deps.icon;
    readiness=deps.readiness;
    RULES=deps.RULES;
    seatingCapacity=deps.seatingCapacity;
    skin=deps.skin;
    t=deps.t;
    topbarHTML=deps.topbarHTML;
    return{eventsHTML,select,focus,shift};
  }
  globalThis.MeritScreenEvents=Object.freeze({create,DEPS:Object.freeze(["esc","eventMetrics","fmtDate","getActiveId","getState","icon","readiness","RULES","seatingCapacity","skin","t","topbarHTML"])});
})();
