// The Reports screen: the pre-flight ("before you export"), the Audit Trail,
// the post-event replay, the export controls and the printed table plan.
//
// Moved byte-for-byte out of app-v8.js on 2026-10-04 (technical gaps, item 2),
// at the original indentation, so every template's text is unchanged. The edits
// forced by the move: reportsHTML/bindReports become this module's own functions
// (app-v8.js keeps the overrides and calls through), and the stored root is
// read through getState() because the shell replaces it.
//
// The workbook contract (TABLE PLAN / GUEST LIST / UNASSIGNED) is NOT here: it
// lives in app-guests.js and is only called. Everything this reads from the
// shell is handed to it by create(deps), once (`screen-modules` holds that).
(() => {
  "use strict";
  let activeEvent;
  let app;
  let auditTrailText;
  let bindDoctorGo;
  let buildTablePlanModel;
  let doctorGoHTML;
  let doctorText;
  let esc;
  let eventMetrics;
  let eventReadiness;
  let exportGuestCSV;
  let exportTablePlanXLSX;
  let fmtDate;
  let formatTableNumber;
  let getState;
  let icon;
  let LIVE;
  let naturalSort;
  let paxOf;
  let planIssues;
  let relativeTime;
  let resolvedAuditTrail;
  let RULES;
  let seatExportName;
  let seatingStats;
  let t;
  let tableAssignedPax;
  let toast;
  let TRAIL;
  let ui;
  let whileBusy;
  let created=false;

  // ---- Reports: catch problems BEFORE the workbook leaves the building --
  // The screen is free to change; the workbook contract is frozen. Nothing
  // here touches makeTablePlanSheet / makeListSheet / seatExportName.
  // The Audit Trail lives in Reports because it is history, not a live
  // screen — it stays reachable for a completed event exactly when an
  // operator most wants it, unlike the Command Center. Newest first, exactly
  // the order state.audit already keeps; nothing here re-sorts or groups.
  function auditTrailHTML(event){
    const T=TRAIL();
    const trail=resolvedAuditTrail(event);
    // HOW MANY ROWS TO PAINT is a rendering decision and nothing else. It
    // used to be answered by DELETING entries at 1,000, which is why this
    // window and the retention ceiling are now two different numbers from
    // two different constants. The window always states its own total --
    // a window that does not reads as the whole truth.
    const w=T?T.displayWindow(trail):{rows:trail,total:trail.length,hidden:0};
    // WHAT WAS ACTUALLY LOST, if anything. The old banner said the oldest
    // entries "may have been superseded", because nothing had counted them.
    // This one appears only when something really went, and says how much
    // and from when.
    const r=getState().auditRetention;
    const lost=r&&r.evicted
      ?`<p class="audit-cap-notice">${esc(r.oldestDroppedAt
          ?t("audit.evictedSince",{n:r.evicted,since:fmtDate(String(r.oldestDroppedAt).slice(0,10))})
          :t("audit.evicted",{n:r.evicted}))}</p>`
      :"";
    return`<div class="mx-section"><div class="mx-section-head"><h2>${t("audit.title")}</h2><span class="count">${w.total}</span></div>
      <p class="audit-question">${t("audit.question")}</p>
      ${lost}
      ${w.hidden?`<p class="audit-more">${esc(t("audit.showingNewest",{shown:w.rows.length,total:w.total}))}</p>`:""}
      ${w.rows.length
        ?`<ul class="audit-trail">${w.rows.map(entry=>`<li class="audit-row"><span class="audit-text">${esc(auditTrailText(event,entry))}</span><span class="audit-when">${esc(relativeTime(entry.at))}</span></li>`).join("")}</ul>`
        :`<div class="mx-empty" style="padding:28px">${t("audit.none")}</div>`}
    </div>`;
  }
  // ---- POST-EVENT REPLAY -----------------------------------------------
  //
  // Only for a finished event, and only ever a different VIEW of two facts
  // this build already owns -- the Audit Trail's own decisions (src/audit-
  // trail.js, reused via resolvedAuditTrail/auditTrailText, never re-scoped
  // here) and the Arrival Wave's own chart (arrivalWaveHTML, reused as-is,
  // since a closed event's arrival data is now a stable historical record).
  // src/post-event-replay.js supplies the one thing neither already does:
  // oldest-first order, and "did this happen inside that bucket's window."
  //
  // The Audit Trail section (auditTrailHTML, above) stays exactly as it was
  // for a historical event -- unrelated concept (a decision log, newest-
  // first, always reachable) with its own suite; Replay sits above it as an
  // additional, richer read of the same underlying decisions.
  function postEventReplayHTML(event){
    const R=globalThis.MeritPostEventReplay,AW=globalThis.MeritArrivalWave;
    if(!R||!AW||!RULES().isHistorical(event))return"";
    const all=R.chronological(resolvedAuditTrail(event));
    const w=LIVE.arrivalWave(event);
    const bucket=w&&ui.waveKey?w.buckets.find(b=>b.key===ui.waveKey):null;
    const entries=bucket?R.windowed(all,bucket,{minutesOfStamp:AW.minutesOfStamp,minutesOfClock:AW.minutesOfClock}):all;
    const rowHTML=entry=>{
      const mins=AW.minutesOfStamp(entry.at);
      const when=mins===null?relativeTime(entry.at):AW.clockOfMinutes(mins);
      return`<li class="replay-row"><span class="replay-when">${esc(when)}</span><span class="replay-text">${esc(auditTrailText(event,entry))}</span></li>`;
    };
    return`<div class="mx-section replay-section"><div class="mx-section-head"><h2>${t("replay.title")}</h2><span class="count">${entries.length}</span></div>
      <p class="replay-question">${t("replay.question")}</p>
      ${LIVE.arrivalWaveHTML(event)}
      ${bucket?`<div class="wave-banner">${icon("search")}<span>${esc(t("replay.filteredCount",{n:entries.length}))}</span><button class="btn sm" data-wave-clear>${t("wave.clearFilter")}</button></div>`:""}
      ${entries.length
        ?`<ol class="replay-trail">${entries.map(rowHTML).join("")}</ol>`
        :`<div class="mx-empty" style="padding:28px">${t(bucket?"replay.noneInWindow":"replay.none")}</div>`}
    </div>`;
  }
  const reportsHTML = function(event){
    const m=eventMetrics(event),s=seatingStats(event);
    const unassigned=event.guests.filter(g=>!g.assignment),unassignedPax=unassigned.reduce((n,g)=>n+paxOf(g),0);
    // "Before you export" is the Command Center's attention list, read from
    // the same Plan Doctor with the same words and the same controls. It used
    // to be planIssues()' four rules, and said "Everything checks out" above
    // the export button while the Command Center said NOT READY -- guests at a
    // table marked unavailable is not one of the four. A finished event has no
    // pre-flight (it is a record, with nothing left to make ready), so it
    // keeps the plan's own consistency rules.
    const historical=RULES().isHistorical(event);
    const rows=historical
      ?planIssues(event).map(i=>({level:i.level,what:i.title,detail:i.text,go:""}))
      :eventReadiness(event).reasons.map(r=>{const w=doctorText(r.finding);return{level:r.level==="blocker"?"blocker":"warn",what:w.what,detail:w.detail,go:doctorGoHTML(r.finding,"pf-fix")};});
    const preflight=rows.length
      ?rows.map(r=>`<div class="pf-item ${r.level}"><i class="pf-dot"></i><div class="pf-text"><b>${esc(r.what)}</b>${r.detail?`<span>${esc(r.detail)}</span>`:""}</div>${r.go}</div>`).join("")
      :`<div class="pf-item ok"><i class="pf-dot"></i><div class="pf-text"><b>${t("reports.preflightOk")}</b><span>${t("reports.preflightOkNote")}</span></div></div>`;
    // Each figure is named for what it counts. The empty figure is LOGICAL
    // seats (seatingStats sums capacity), so it is not labelled as physical
    // chairs -- on a symbolic plan there are none. The assigned figure is the
    // PLAN's pax, noted with its guest records, never as "live".
    const guestsNote=n=>t(n===1?"reports.guestsCount.1":"reports.guestsCount",{n});
    const capacity=[
      `<div class="mx-metric is-hero"><span class="mx-metric-label">${t("reports.totalCapacity")}</span><span class="mx-metric-value">${m.total}</span><span class="mx-metric-note">${t("reports.tablesCount",{n:event.tables.length})}</span></div>`,
      `<div class="mx-metric"><span class="mx-metric-label">${t("reports.assignedPax")}</span><span class="mx-metric-value">${m.assigned}</span><span class="mx-metric-note">${guestsNote(event.guests.filter(g=>g.assignment).length)}</span></div>`,
      `<div class="mx-metric"><span class="mx-metric-label">${t("reports.emptySeats")}</span><span class="mx-metric-value">${s.emptyChairs}</span><span class="mx-metric-note">${t("reports.emptyTables")}: ${s.emptyTables}</span></div>`,
      `<div class="mx-metric ${unassignedPax?"is-warn":""}"><span class="mx-metric-label">${t("reports.unassigned")}</span><span class="mx-metric-value">${unassignedPax}</span><span class="mx-metric-note">${guestsNote(unassigned.length)}</span></div>`,
    ].join("");
    const tableRows=[...event.tables].sort((a,b)=>naturalSort(a.number,b.number))
      .map(t_=>`<div class="mx-row cols-report"><div><b style="font-size:12.5px">${esc(formatTableNumber(t_.number))}</b> <span class="muted" style="font-size:11.5px">${esc(t_.zone)}</span></div><div class="seat-tag">${tableAssignedPax(event,t_.id)} / ${t_.capacity}</div></div>`).join("");
    return`<div class="mx-screen"><div class="mx-wrap">
      <div class="mx-head"><div><h1>${t("reports.title")}</h1><p>${t("reports.subtitle")}</p></div></div>
      <div class="reports-stage">
        <div>
          ${postEventReplayHTML(event)}
          <div class="mx-section" style="margin-top:0"><div class="mx-section-head"><h2>${t("reports.preflight")}</h2><span class="count">${rows.length||""}</span></div><div class="preflight">${preflight}</div></div>
          <div class="mx-section"><div class="mx-section-head"><h2>${t("reports.capacitySummary")}</h2></div><div class="mx-metrics" style="margin-bottom:0">${capacity}</div></div>
          <div class="mx-section"><div class="mx-section-head"><h2>${t("reports.tableList")}</h2><span class="count">${t("reports.tablesCount",{n:event.tables.length})}</span></div>${event.tables.length?`<div class="mx-list">${tableRows}</div>`:`<div class="mx-empty" style="padding:28px">${t("reports.tablesCount",{n:0})}</div>`}</div>
          ${auditTrailHTML(event)}
        </div>
        <aside class="export-panel">
          <h3>${t("reports.workbook")}</h3>
          <p>${t("reports.workbookNote")}</p>
          <div class="sheet-preview">
            <div class="sheet-chip"><b>${t("reports.sheetTablePlan")}</b><span>${t("reports.sheetNoteTables",{n:event.tables.length})}</span></div>
            <div class="sheet-chip"><b>${t("reports.sheetGuestList")}</b><span>${t("reports.sheetNoteRecords",{n:event.guests.length})}</span></div>
            <div class="sheet-chip"><b>${t("reports.sheetUnassigned")}</b><span>${t("reports.sheetNoteGuests",{n:unassignedPax})}</span></div>
          </div>
          <button class="btn primary btn-export" data-report="xlsx">${icon("download")}${t("reports.exportTablePlan")}</button>
          <button class="btn" style="width:100%;justify-content:center;margin-top:8px" data-report="print">${icon("image")}${t("reports.printTablePlan")}</button>
          <button class="btn" style="width:100%;justify-content:center;margin-top:8px" data-report="csv">${icon("download")}${t("reports.guestCsv")}</button>
          <p style="font-size:11px;color:var(--muted-2);margin:12px 0 0;line-height:1.45">${t("reports.sheetsInEnglish")}</p>
        </aside>
      </div>
    </div></div>`;
  };
  // Own binder with null guards: the base one dereferences querySelector
  // results directly, which blanks Reports if a button is ever conditional.
  const bindReports = function(){
    app.querySelectorAll("[data-report='csv']").forEach(b=>b.onclick=exportGuestCSV);
    app.querySelectorAll("[data-report='xlsx']").forEach(b=>b.onclick=()=>whileBusy(b,t("reports.preparingWorkbook"),exportTablePlanXLSX));
    app.querySelectorAll("[data-report='print']").forEach(b=>b.onclick=printTablePlan);
    bindDoctorGo(activeEvent());
    // Post-Event Replay's wave chart (historical events only) needs the same
    // bucket-click/VIP/clear wiring Live uses -- a historical event has no
    // Live tab to have bound them already.
    LIVE.bindArrivalWaveControls();
  };

  // ---- Paper table plan -----------------------------------------------
  // Walking the floor with a laptop is not how this job is done. The sheet is
  // built from buildTablePlanModel() -- the SAME model the workbook uses -- so
  // table numbering, seat numbering, "GUEST OF [PRIMARY NAME]", the per-table
  // total and the four-cards-per-row grouping cannot drift apart from the
  // exported .xlsx. Nothing in app-guests.js is touched.
  function printTablePlan(){
    const event=activeEvent();if(!event)return;
    if(!event.tables.length){toast(t("reports.printNoTables"),"error");return;}
    const model=buildTablePlanModel(event);
    const totalPax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    const seatedPax=event.guests.filter(g=>g.assignment).reduce((n,g)=>n+paxOf(g),0);
    // Four per row, same grouping as the workbook, so a page of paper and a
    // page of the spreadsheet show the same four tables side by side.
    const groups=[];
    for(let i=0;i<model.tables.length;i+=4)groups.push(model.tables.slice(i,i+4));
    const card=table=>{
      const seats=Array.from({length:table.capacity},(_,s)=>{
        const name=seatExportName(event,table,s);
        return`<tr class="${name?"":"free"}"><td class="s">S${s+1}</td><td class="n">${esc(name)}</td></tr>`;
      }).join("");
      return`<div class="pp-card">
        <div class="pp-card-head">${esc(formatTableNumber(table.number))}</div>
        <table class="pp-seats"><tbody>${seats}</tbody></table>
        <div class="pp-card-total"><span>TOTAL GUEST:</span><b>${tableAssignedPax(event,table.id)}</b></div>
      </div>`;
    };
    const root=printRoot();
    root.innerHTML=`
      <div class="pp-head">
        <div class="pp-title"><b>${esc(event.name)}</b><span>${esc([event.hotel,event.salon].filter(Boolean).join(" · "))}</span></div>
        <div class="pp-meta">
          <span>${esc(fmtDate(event.date))}</span>
          <span>${t("reports.printTables",{n:model.tables.length})}</span>
          <span>${t("reports.printPax",{seated:seatedPax,total:totalPax})}</span>
        </div>
      </div>
      ${groups.map(g=>`<div class="pp-row">${g.map(card).join("")}</div>`).join("")}`;
    document.body.classList.add("printing");
    // Clear the print layer once the dialog closes either way, so a stale plan
    // can never be printed after the seating has changed.
    const cleanup=()=>{document.body.classList.remove("printing");root.innerHTML="";window.removeEventListener("afterprint",cleanup);};
    window.addEventListener("afterprint",cleanup);
    window.print();
    // Browsers that never fire afterprint (or a blocked print dialog) must not
    // leave the app stuck behind the print layer.
    setTimeout(cleanup,60000);
  }
  function printRoot(){
    let root=document.getElementById("printRoot");
    if(!root){root=document.createElement("div");root.id="printRoot";document.body.appendChild(root);}
    return root;
  }

  function create(deps){
    if(created)throw new Error("MeritScreenReports.create() is called once, by app-v8.js.");
    created=true;
    activeEvent=deps.activeEvent;
    app=deps.app;
    auditTrailText=deps.auditTrailText;
    bindDoctorGo=deps.bindDoctorGo;
    buildTablePlanModel=deps.buildTablePlanModel;
    doctorGoHTML=deps.doctorGoHTML;
    doctorText=deps.doctorText;
    esc=deps.esc;
    eventMetrics=deps.eventMetrics;
    eventReadiness=deps.eventReadiness;
    exportGuestCSV=deps.exportGuestCSV;
    exportTablePlanXLSX=deps.exportTablePlanXLSX;
    fmtDate=deps.fmtDate;
    formatTableNumber=deps.formatTableNumber;
    getState=deps.getState;
    icon=deps.icon;
    LIVE=deps.LIVE;
    naturalSort=deps.naturalSort;
    paxOf=deps.paxOf;
    planIssues=deps.planIssues;
    relativeTime=deps.relativeTime;
    resolvedAuditTrail=deps.resolvedAuditTrail;
    RULES=deps.RULES;
    seatExportName=deps.seatExportName;
    seatingStats=deps.seatingStats;
    t=deps.t;
    tableAssignedPax=deps.tableAssignedPax;
    toast=deps.toast;
    TRAIL=deps.TRAIL;
    ui=deps.ui;
    whileBusy=deps.whileBusy;
    return{reportsHTML,bindReports};
  }
  globalThis.MeritScreenReports=Object.freeze({create,DEPS:Object.freeze(["activeEvent","app","auditTrailText","bindDoctorGo","buildTablePlanModel","doctorGoHTML","doctorText","esc","eventMetrics","eventReadiness","exportGuestCSV","exportTablePlanXLSX","fmtDate","formatTableNumber","getState","icon","LIVE","naturalSort","paxOf","planIssues","relativeTime","resolvedAuditTrail","RULES","seatExportName","seatingStats","t","tableAssignedPax","toast","TRAIL","ui","whileBusy"])});
})();
