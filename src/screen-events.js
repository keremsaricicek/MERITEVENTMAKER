// The Events home screen: the next event's hero card, the other upcoming
// events, history and what the history says (two averaged facts, no model).
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
  let getState;
  let helpButton;
  let icon;
  let paxOf;
  let physicalCapacity;
  let RULES;
  let seatingCapacity;
  let t;
  let topBrand;
  let created=false;

  // The next event is what the operator came for 95% of the time, so it gets
  // the hero treatment and everything else becomes a compact line.
  function nextEventHeroHTML(event){
    const totalPax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    const seatedPax=event.guests.filter(g=>g.assignment).reduce((n,g)=>n+paxOf(g),0);
    // The room's seats, not its drawn chairs: this bar answers "will they
    // fit", and "No tables in the plan yet" underneath it was a literal
    // falsehood on a plan carrying four hundred tables.
    const chairs=seatingCapacity(event);
    const bar=(label,value,max,cls)=>`<div class="nb"><div class="nb-top"><span>${label}</span><b>${value} / ${max}</b></div><div class="nb-track"><div class="nb-fill ${cls}" style="width:${max?Math.min(100,Math.round(value/max*100)):0}%"></div></div></div>`;
    const venue=[event.hotel,event.salon].filter(Boolean).join(" · ")||t("appbar.venueNotSet");
    return`<div class="next-event">
      <div class="next-event-main">
        <span class="next-badge"><i></i>${t("home.nextEvent")}</span>
        <h2>${esc(event.name)}</h2>
        <div class="next-event-when">${esc(fmtDate(event.date))} · ${esc(venue)}</div>
        <div class="next-event-bars">
          ${bar(t("home.seatedProgress"),seatedPax,totalPax,seatedPax&&seatedPax===totalPax?"good":"")}
          ${chairs?bar(t("home.capacityProgress"),totalPax,chairs,totalPax>chairs?"warn":"good"):`<div class="nb-top" style="color:var(--amber)">${t("home.noPlanYet")}</div>`}
        </div>
      </div>
      <div class="next-event-side">
        <button class="btn primary" data-open-event="${event.id}">${t("home.openEvent")}</button>
        <button class="btn" data-duplicate-event="${event.id}">${icon("copy")}${t("home.duplicate")}</button>
        <button class="btn" data-export-event-package="${event.id}" title="${esc(t("home.exportPackage"))}">${icon("download")}${t("home.exportPackageShort")}</button>
        <button class="btn danger" data-delete-event="${event.id}">${icon("trash")}${t("home.delete")}</button>
      </div>
    </div>`;
  }
  function upcomingLineHTML(event){
    const venue=[event.hotel,event.salon].filter(Boolean).join(" · ")||t("appbar.venueNotSet");
    return`<div class="event-line" data-open-event="${event.id}" title="${esc(t("home.openEventNamed",{name:event.name}))}">
      <div><b>${esc(event.name)}</b></div>
      <div class="muted">${esc(fmtDate(event.date))}</div>
      <div class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(venue)}</div>
      <div class="seat-tag">${eventMetrics(event).guests}</div>
      <div class="seat-tag">${physicalCapacity(event)}</div>
      <div class="row-icons"><button class="row-action" data-duplicate-event="${event.id}" aria-label="${esc(t("home.a11y.duplicate",{name:event.name}))}" title="${t("home.duplicate")}">${icon("copy")}</button><button class="row-action" data-export-event-package="${event.id}" aria-label="${esc(t("home.a11y.exportPackage",{name:event.name}))}" title="${esc(t("home.exportPackage"))}">${icon("download")}</button><button class="row-action" data-delete-event="${event.id}" aria-label="${esc(t("home.a11y.delete",{name:event.name}))}" title="${t("home.delete")}">${icon("trash")}</button></div>
    </div>`;
  }
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
    const upcoming=getState().events.filter(e=>!RULES().isHistorical(e)).sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999"));
    const history=getState().events.filter(e=>RULES().isHistorical(e)).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
    const [next,...rest]=upcoming;
    return`<header class="appbar">${topBrand()}<div class="crumb">${t("home.crumb")} / <b>${t("home.portfolio")}</b></div><div class="appbar-actions">${helpButton()}<button class="btn quiet icon-only" data-action="backup-export" title="${t("backup.export")}">${icon("download")}</button><button class="btn quiet icon-only" data-action="backup-import" title="${t("backup.import")}">${icon("upload")}</button><button class="btn quiet icon-only" data-action="recovery-restore" title="${t("recovery.buttonTitle")}">${icon("undo")}</button><button class="btn primary" data-action="create-event">${icon("plus")}${t("home.createEvent")}</button></div></header><div class="mx-screen"><div class="mx-wrap">
      <div class="mx-head"><div><div class="kicker">${t("home.eyebrow")}</div><h1>${t("home.title")}</h1><p>${t("home.subtitle")}</p></div><span class="muted" style="font-size:12px">${t(getState().events.length===1?"home.eventCount1":"home.eventsCount",{n:getState().events.length})}</span></div>
      ${next?nextEventHeroHTML(next):`<div class="mx-empty"><h3>${t("home.noUpcoming")}</h3><p>${t("home.noUpcomingHint")}</p><button class="btn primary" data-action="create-event">${icon("plus")}${t("home.createEvent")}</button></div>`}
      ${rest.length?`<div class="mx-section"><div class="mx-section-head"><h2>${t("home.otherUpcoming")}</h2><span class="count">${rest.length}</span></div><div class="mx-list"><div class="mx-list-head event-line"><span>${t("home.col.event")}</span><span>${t("home.col.date")}</span><span>${t("home.col.hotelSalon")}</span><span>${t("home.col.guestPax")}</span><span>${t("home.col.physicalChairs")}</span><span></span></div>${rest.map(upcomingLineHTML).join("")}</div></div>`:""}
      ${eventHistoryLearningHTML(history)}
      <div class="mx-section"><div class="mx-section-head"><h2>${t("home.eventsHistory")}</h2><span class="count">${t("home.historyNote")}</span></div>${history.length?`<div class="mx-list"><div class="mx-list-head event-line"><span>${t("home.col.event")}</span><span>${t("home.col.date")}</span><span>${t("home.col.hotelSalon")}</span><span>${t("home.col.guestPax")}</span><span>${t("home.col.physicalChairs")}</span><span></span></div>${history.map(e=>`<div class="event-line" data-history-event="${e.id}" title="${esc(t("home.historyOpenHint"))}"><div><b>${esc(e.name)}</b></div><div class="muted">${esc(fmtDate(e.date))}</div><div class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc([e.hotel,e.salon].filter(Boolean).join(" · ")||"—")}</div><div class="seat-tag">${eventMetrics(e).guests}</div><div class="seat-tag">${physicalCapacity(e)}</div><div class="row-icons"><span class="readonly-tag">${icon("lock")}${t("home.readOnly")}</span><button class="row-action" data-export-event-package="${e.id}" aria-label="${esc(t("home.a11y.exportPackage",{name:e.name}))}" title="${esc(t("home.exportPackage"))}">${icon("download")}</button><button class="row-action" data-delete-event="${e.id}" aria-label="${esc(t("home.a11y.delete",{name:e.name}))}" title="${t("home.delete")}">${icon("trash")}</button></div></div>`).join("")}</div>`:`<div class="mx-empty" style="padding:30px">${t("home.noHistorical")}</div>`}</div>
    </div></div>`;
  };

  function create(deps){
    if(created)throw new Error("MeritScreenEvents.create() is called once, by app-v8.js.");
    created=true;
    esc=deps.esc;
    eventMetrics=deps.eventMetrics;
    fmtDate=deps.fmtDate;
    getState=deps.getState;
    helpButton=deps.helpButton;
    icon=deps.icon;
    paxOf=deps.paxOf;
    physicalCapacity=deps.physicalCapacity;
    RULES=deps.RULES;
    seatingCapacity=deps.seatingCapacity;
    t=deps.t;
    topBrand=deps.topBrand;
    return{eventsHTML};
  }
  globalThis.MeritScreenEvents=Object.freeze({create,DEPS:Object.freeze(["esc","eventMetrics","fmtDate","getState","helpButton","icon","paxOf","physicalCapacity","RULES","seatingCapacity","t","topBrand"])});
})();
