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
  let render;
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
  // ---- REDESIGN v4 step 8 (SPEC-v4 "Raporlar"): RAPOR TASARIMCISI ----------------
  // A full-size live preview of a guest document (2/3) and a designer panel
  // (1/3): which columns and in what order, filters (name, group/junket, table,
  // VIP, arrival), title, logo, paper (A4/A3 × portrait/landscape), font size,
  // and templates saved on THIS machine ("merit.reportTemplates.v1", try/catch).
  // It reads the event and writes nothing to it. The workbook (TABLE PLAN /
  // GUEST LIST / UNASSIGNED) and its print are untouched: they stay on "Özet".
  const TPL_KEY="merit.reportTemplates.v1";
  const RD_COLS=["name","pax","table","seat","host","vip","planning","arrival","phone","notes"];
  const rdFold=s=>String(s||"").toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ı/g,"i").trim();
  function rdState(){
    if(!ui.reportDesign)ui.reportDesign={cols:["name","pax","table","host","vip"],filters:{name:"",group:"",table:"",vip:false,arrival:""},title:"",logo:"",paper:"A4-portrait",font:12,tplName:""};
    return ui.reportDesign;
  }
  function rdTemplates(){try{const v=JSON.parse(globalThis.localStorage.getItem(TPL_KEY)||"[]");return Array.isArray(v)?v.filter(x=>x&&typeof x.name==="string"):[];}catch{return[];}}
  function rdRows(event,d){
    const byId=new Map(event.tables.map(x=>[x.id,x])),f=d.filters,q=rdFold(f.name);
    return event.guests.filter(g=>{
      if(q&&!rdFold(g.name).includes(q))return false;
      if(f.group&&String(g.invitedBy||"")!==f.group)return false;
      if(f.table&&!(g.assignment&&g.assignment.tableId===f.table))return false;
      if(f.vip&&!/VIP/.test(String(g.vip||"")))return false;
      if(f.arrival&&g.arrivalStatus!==f.arrival)return false;
      return true;
    }).map(g=>({g,tb:g.assignment&&byId.get(g.assignment.tableId)}))
      .sort((a,b)=>(a.tb?0:1)-(b.tb?0:1)||naturalSort(a.tb?a.tb.number:"",b.tb?b.tb.number:"")||naturalSort(a.g.name,b.g.name));
  }
  function rdCell(col,r){
    const g=r.g;
    if(col==="name")return g.name;
    if(col==="pax")return String(paxOf(g));
    if(col==="table")return r.tb?formatTableNumber(r.tb.number):"—";
    if(col==="seat")return g.assignment&&Array.isArray(g.assignment.seats)&&g.assignment.seats.length?g.assignment.seats.map(n=>"S"+(n+1)).join(", "):"—";
    if(col==="host")return g.invitedBy||"—";
    if(col==="vip")return g.vip&&g.vip!=="Standard"?g.vip:"";
    if(col==="planning")return t("status.planning."+g.planningStatus);
    if(col==="arrival")return t("status.arrival."+(g.arrivalStatus||"Not Arrived"));
    if(col==="phone")return g.phone||"";
    if(col==="notes")return g.notes||"";
    return"";
  }
  function designerHTML(event){
    const d=rdState(),rows=rdRows(event,d),cols=d.cols.filter(c=>RD_COLS.includes(c));
    const pax=rows.reduce((n,r)=>n+paxOf(r.g),0);
    const groups=[...new Set(event.guests.map(g=>String(g.invitedBy||"")).filter(Boolean))].sort((a,b)=>naturalSort(a,b));
    const tables=[...event.tables].sort((a,b)=>naturalSort(a.number,b.number));
    const opt=(v,l,on)=>`<option value="${esc(v)}"${on?" selected":""}>${esc(l)}</option>`;
    const page=`<div class="rd-page" data-paper="${esc(d.paper)}" data-font="${Number(d.font)||12}">
      <div class="rd-doc-head">${d.logo?`<img class="rd-logo" src="${esc(d.logo)}" alt="">`:""}<div><div class="rd-title">${esc(d.title||event.name)}</div><div class="rd-sub">${esc([event.name,fmtDate(event.date),[event.hotel,event.salon].filter(Boolean).join(" · ")].filter(Boolean).join(" · "))}</div></div></div>
      <table class="rd-table"><thead><tr>${cols.map(c=>`<th>${esc(t("rd.col."+c))}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(rdCell(c,r))}</td>`).join("")}</tr>`).join("")}</tbody></table>
      <div class="rd-foot">${esc(t("rd.count",{records:rows.length,pax}))}</div></div>`;
    const colRows=[...cols,...RD_COLS.filter(c=>!cols.includes(c))].map(c=>{const on=cols.includes(c);return`<div class="rd-col" data-rd-col="${c}"><label><input type="checkbox"${on?" checked":""}> ${esc(t("rd.col."+c))}</label>${on?`<button class="btn sm quiet" data-rd-col-up="${c}" aria-label="${esc(t("rd.up"))}">↑</button><button class="btn sm quiet" data-rd-col-down="${c}" aria-label="${esc(t("rd.down"))}">↓</button>`:""}</div>`;}).join("");
    const tpls=rdTemplates();
    const panel=`<aside class="rd-panel" aria-label="${esc(t("rd.panel"))}">
      <h3>${esc(t("rd.columns"))}</h3><div class="rd-cols">${colRows}</div>
      <h3>${esc(t("rd.filters"))}</h3>
      <label class="rd-f">${esc(t("rd.f.name"))}<input class="filter-input" data-rd-filter="name" value="${esc(d.filters.name)}"></label>
      <label class="rd-f">${esc(t("rd.f.group"))}<select class="filter-input" data-rd-filter="group">${opt("",t("rd.all"),!d.filters.group)}${groups.map(x=>opt(x,x,d.filters.group===x)).join("")}</select></label>
      <label class="rd-f">${esc(t("rd.f.table"))}<select class="filter-input" data-rd-filter="table">${opt("",t("rd.all"),!d.filters.table)}${tables.map(x=>opt(x.id,formatTableNumber(x.number),d.filters.table===x.id)).join("")}</select></label>
      <label class="rd-f">${esc(t("rd.f.arrival"))}<select class="filter-input" data-rd-filter="arrival">${opt("",t("rd.all"),!d.filters.arrival)}${["Checked In","Not Arrived","No Show"].map(x=>opt(x,t("status.arrival."+x),d.filters.arrival===x)).join("")}</select></label>
      <label class="rd-check"><input type="checkbox" data-rd-filter="vip"${d.filters.vip?" checked":""}> ${esc(t("rd.f.vip"))}</label>
      <h3>${esc(t("rd.page"))}</h3>
      <label class="rd-f">${esc(t("rd.title"))}<input class="filter-input" data-rd-title value="${esc(d.title)}" placeholder="${esc(event.name)}"></label>
      <label class="rd-f">${esc(t("rd.logo"))}<input type="file" accept="image/png,image/jpeg" data-rd-logo>${d.logo?`<button class="btn sm quiet" data-rd-logo-clear>${esc(t("rd.logoClear"))}</button>`:""}</label>
      <div class="rd-two"><label class="rd-f">${esc(t("rd.paper"))}<select class="filter-input" data-rd-paper>${["A4-portrait","A4-landscape","A3-portrait","A3-landscape"].map(x=>opt(x,t("rd.paper."+x),d.paper===x)).join("")}</select></label>
      <label class="rd-f">${esc(t("rd.font"))}<select class="filter-input" data-rd-font>${[10,11,12,13,14].map(x=>opt(String(x),x+" pt",Number(d.font)===x)).join("")}</select></label></div>
      <h3>${esc(t("rd.templates"))}</h3>
      ${tpls.length?`<label class="rd-f">${esc(t("rd.load"))}<select class="filter-input" data-rd-load>${opt("","—",true)}${tpls.map((x,i)=>opt(String(i),x.name,false)).join("")}</select></label>`:""}
      <div class="rd-save"><input class="filter-input" data-rd-template-name placeholder="${esc(t("rd.templateName"))}" value="${esc(d.tplName||"")}"><button class="btn" data-rd-save>${esc(t("rd.save"))}</button></div>
      <button class="btn primary rd-print" data-rd-print>${icon("image")}${esc(t("rd.print"))}</button>
    </aside>`;
    return`<div class="rd-stage"><div class="rd-preview">${page}</div>${panel}</div>`;
  }
  function viewSwitchHTML(){
    const v=ui.reportsView==="designer"?"designer":"summary";
    return`<div class="seg rd-switch" role="group">${["summary","designer"].map(k=>`<button class="btn sm${v===k?" primary":""}" data-reports-view="${k}" aria-pressed="${v===k}">${esc(t("rd.view."+k))}</button>`).join("")}</div>`;
  }
  function bindDesigner(){
    const d=rdState(),again=()=>render();
    app.querySelectorAll("[data-reports-view]").forEach(b=>b.onclick=()=>{ui.reportsView=b.dataset.reportsView;again();});
    if(ui.reportsView!=="designer")return;
    app.querySelectorAll("[data-rd-col] input").forEach(i=>i.onchange=()=>{const c=i.closest("[data-rd-col]").dataset.rdCol;d.cols=i.checked?[...d.cols.filter(x=>x!==c),c]:d.cols.filter(x=>x!==c);again();});
    const move=(c,k)=>{const i=d.cols.indexOf(c),j=i+k;if(i<0||j<0||j>=d.cols.length)return;const a=d.cols.slice();[a[i],a[j]]=[a[j],a[i]];d.cols=a;again();};
    app.querySelectorAll("[data-rd-col-up]").forEach(b=>b.onclick=()=>move(b.dataset.rdColUp,-1));
    app.querySelectorAll("[data-rd-col-down]").forEach(b=>b.onclick=()=>move(b.dataset.rdColDown,1));
    // Typed fields re-render on a short pause, focus and caret kept; a change
    // event fired by the field being replaced can never start a second render.
    const typed=(n,set)=>{n.oninput=()=>{set(n.value);clearTimeout(ui.rdTimer);const key=n.dataset.rdFilter||"title",pos=n.selectionStart;ui.rdTimer=setTimeout(()=>{again();const m=app.querySelector(key==="title"?"[data-rd-title]":`[data-rd-filter="${key}"]`);if(m){m.focus();m.setSelectionRange(pos,pos);}},250);};};
    app.querySelectorAll("[data-rd-filter]").forEach(n=>{const k=n.dataset.rdFilter;if(n.tagName==="INPUT"&&n.type!=="checkbox")typed(n,v=>{d.filters[k]=v.slice(0,80);});else n.onchange=()=>{d.filters[k]=n.type==="checkbox"?n.checked:n.value;again();};});
    const one=(sel,fn)=>{const n=app.querySelector(sel);if(n)fn(n);};
    one("[data-rd-title]",n=>typed(n,v=>{d.title=v.slice(0,160);}));
    one("[data-rd-paper]",n=>n.onchange=()=>{d.paper=n.value;again();});
    one("[data-rd-font]",n=>n.onchange=()=>{d.font=Number(n.value)||12;again();});
    one("[data-rd-template-name]",n=>n.oninput=()=>{d.tplName=n.value;});
    one("[data-rd-logo]",n=>n.onchange=()=>{const f=n.files&&n.files[0];if(!f)return;if(f.size>400000){toast(t("rd.logoTooBig"),"error");return;}const rd=new FileReader();rd.onload=()=>{if(/^data:image\/(png|jpeg);base64,/.test(String(rd.result))){d.logo=String(rd.result);again();}};rd.readAsDataURL(f);});
    one("[data-rd-logo-clear]",n=>n.onclick=()=>{d.logo="";again();});
    one("[data-rd-load]",n=>n.onchange=()=>{const x=rdTemplates()[Number(n.value)];if(!x)return;Object.assign(d,{cols:Array.isArray(x.cols)?x.cols.filter(c=>RD_COLS.includes(c)):d.cols,filters:Object.assign({},d.filters,x.filters||{}),title:String(x.title||""),logo:String(x.logo||""),paper:String(x.paper||"A4-portrait"),font:Number(x.font)||12,tplName:x.name});again();});
    one("[data-rd-save]",n=>n.onclick=()=>{
      const name=String((app.querySelector("[data-rd-template-name]")||{}).value||d.tplName||"").trim().slice(0,80);
      if(!name){toast(t("rd.nameFirst"),"error");return;}
      const list=rdTemplates().filter(x=>x.name!==name);
      list.push({name,cols:d.cols,filters:d.filters,title:d.title,logo:d.logo,paper:d.paper,font:d.font});
      d.tplName=name;
      // EXPECTED ABSTENTION: a storage that refuses (quota, private mode) loses the
      // template, never the screen; the person is told.
      try{globalThis.localStorage.setItem(TPL_KEY,JSON.stringify(list));toast(t("rd.saved",{name}));}
      catch(error){console.warn("The report template could not be kept on this machine.",error&&error.name);toast(t("rd.notSaved"),"error");}
      again();
    });
    one("[data-rd-print]",n=>n.onclick=()=>{
      const page=app.querySelector(".rd-page");if(!page)return;
      document.body.classList.add("printing-designer");
      document.body.dataset.rdPaper=page.dataset.paper;
      const cleanup=()=>{document.body.classList.remove("printing-designer");delete document.body.dataset.rdPaper;window.removeEventListener("afterprint",cleanup);};
      window.addEventListener("afterprint",cleanup);
      window.print();
      setTimeout(cleanup,60000);
    });
  }
  const reportsHTML = function(event){
    if(ui.reportsView==="designer")return`<div class="mx-screen"><div class="mx-wrap rd-wrap">
      <div class="mx-head"><div><h1>${t("reports.title")}</h1><p>${esc(t("rd.subtitle"))}</p></div>${viewSwitchHTML()}</div>
      ${designerHTML(event)}
    </div></div>`;
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
      <div class="mx-head"><div><h1>${t("reports.title")}</h1><p>${t("reports.subtitle")}</p></div>${viewSwitchHTML()}</div>
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
          <button class="btn report-btn" data-report="print">${icon("image")}${t("reports.printTablePlan")}</button>
          <button class="btn report-btn" data-report="door">${icon("door")}${t("reports.printDoorList")}</button>
          <button class="btn report-btn" data-report="summary">${icon("check")}${t("reports.printSummary")}</button>
          <button class="btn report-btn" data-report="junket">${icon("download")}${t("reports.junketExport")}</button>
          <button class="btn report-btn" data-report="night">${icon("download")}${esc(t("reports.nightExport"))}</button>
          <button class="btn report-btn" data-report="csv">${icon("download")}${t("reports.guestCsv")}</button>
          <p style="font-size:11px;color:var(--muted-2);margin:12px 0 0;line-height:1.45">${t("reports.sheetsInEnglish")}</p>
        </aside>
      </div>
    </div></div>`;
  };
  // Own binder with null guards: the base one dereferences querySelector
  // results directly, which blanks Reports if a button is ever conditional.
  const bindReports = function(){
    bindDesigner();
    app.querySelectorAll("[data-report='night']").forEach(b=>b.onclick=exportNightReport);
    app.querySelectorAll("[data-report='csv']").forEach(b=>b.onclick=exportGuestCSV);
    app.querySelectorAll("[data-report='xlsx']").forEach(b=>b.onclick=()=>whileBusy(b,t("reports.preparingWorkbook"),exportTablePlanXLSX));
    app.querySelectorAll("[data-report='print']").forEach(b=>b.onclick=printTablePlan);
    app.querySelectorAll("[data-report='door']").forEach(b=>b.onclick=printDoorList);
    app.querySelectorAll("[data-report='summary']").forEach(b=>b.onclick=printEventSummary);
    app.querySelectorAll("[data-report='junket']").forEach(b=>b.onclick=exportJunketReport);
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
  // ---- Door list (owner 2026-11-02) ---------------------------------------
  // At the door the one question is "where do I sit". Every guest record A–Z in
  // Turkish order, with the party size and the table — or a dash when the guest
  // has no table yet. One record per party ("+2"), never split. Printed (or
  // saved as PDF from the print dialog); nothing is changed.
  function printDoorList(){
    const event=activeEvent();if(!event)return;
    if(!event.guests.length){toast(t("reports.doorNoGuests"),"error");return;}
    const tables=new Map(event.tables.map(x=>[x.id,x]));
    const rows=event.guests.slice().sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"tr",{sensitivity:"base"})).map(g=>{
      const tb=g.assignment?tables.get(g.assignment.tableId):null, extra=paxOf(g)-1;
      return`<tr><td class="dn">${esc(g.name)}${extra>0?` <span class="dx">+${extra}</span>`:""}${/VIP/i.test(g.vip||"")?` <span class="dv">${esc(g.vip)}</span>`:""}</td><td class="dt">${tb?esc(formatTableNumber(tb.number)):"—"}</td></tr>`;
    }).join("");
    const totalPax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    const root=printRoot();
    root.innerHTML=`
      <div class="pp-head">
        <div class="pp-title"><b>${esc(event.name)} — ${t("reports.doorTitle")}</b><span>${esc([event.hotel,event.salon].filter(Boolean).join(" · "))}</span></div>
        <div class="pp-meta"><span>${esc(fmtDate(event.date))}</span><span>${t("reports.doorCount",{n:event.guests.length,pax:totalPax})}</span></div>
      </div>
      <table class="door-list"><thead><tr><th>${t("reports.doorName")}</th><th>${t("reports.doorTable")}</th></tr></thead><tbody>${rows}</tbody></table>`;
    document.body.classList.add("printing");
    const cleanup=()=>{document.body.classList.remove("printing");root.innerHTML="";window.removeEventListener("afterprint",cleanup);};
    window.addEventListener("afterprint",cleanup);
    window.print();
    setTimeout(cleanup,60000);
  }
  // ---- Junket / host report, Excel (owner 2026-11-02) ----------------------
  // Its own small workbook — the table-plan workbook is not touched. Per host:
  // expected / came / did not come in people; then every guest of every host with
  // party size, table and arrival. A cell that starts like a formula is written as text.
  // NIGHT-END REPORT (benchmarks/FEATURES-2026-11-07.md §3): its OWN workbook, one
  // "NIGHT END" sheet from MeritNightReport (plain data, read-only, formula-safe
  // cells, English labels like the other workbooks). Never added to the TABLE
  // PLAN / GUEST LIST / UNASSIGNED workbook, which xlsx-contract guards.
  function exportNightReport(){
    const event=activeEvent();if(!event)return;
    const X=globalThis.XLSX,N=globalThis.MeritNightReport;
    if(!X||!N){toast(t("guests.engineMissing"),"error",5200);return;}
    const rows=N.summaryRows(N.build(event),()=>"");
    const wb=X.utils.book_new(),ws=X.utils.aoa_to_sheet(rows);
    ws["!cols"]=[{wch:32},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12},{wch:12}];
    X.utils.book_append_sheet(wb,ws,"NIGHT END");
    X.writeFile(wb,`${String(event.name||"event").replace(/[\\/:*?"<>|]+/g,"-")}-night-end.xlsx`);
    toast(t("reports.nightDone"),"success");
  }
  function exportJunketReport(){
    const event=activeEvent();if(!event)return;
    const X=globalThis.XLSX,G=globalThis.MeritGuestGroups;
    if(!X||!G){toast(t("guests.engineMissing"),"error",5200);return;}
    const safe=v=>typeof v==="string"&&/^[=+\-@\t\r]/.test(v)?"'"+v:v;
    const counts=G.counts(event);
    if(!counts.length){toast(t("reports.junketNone"),"error",5200);return;}
    const tables=new Map(event.tables.map(x=>[x.id,x]));
    const sum=[["HOST","EXPECTED","CAME","NO SHOW"],...counts.map(c=>[safe(c.host),c.expected,c.came,c.noShow])];
    const list=[["HOST","GUEST","PAX","TABLE","ARRIVAL"]];
    for(const h of G.hosts(event))for(const g of h.guests.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"tr"))){
      const tb=g.assignment?tables.get(g.assignment.tableId):null;
      list.push([safe(h.host),safe(String(g.name||"")),paxOf(g),tb?formatTableNumber(tb.number):"",g.arrivalStatus||"Not Arrived"]);
    }
    const wb=X.utils.book_new(),ws1=X.utils.aoa_to_sheet(sum),ws2=X.utils.aoa_to_sheet(list);
    ws1["!cols"]=[{wch:30},{wch:10},{wch:10},{wch:10}];ws2["!cols"]=[{wch:30},{wch:30},{wch:6},{wch:8},{wch:14}];
    X.utils.book_append_sheet(wb,ws1,"JUNKET SUMMARY");X.utils.book_append_sheet(wb,ws2,"JUNKET GUESTS");
    X.writeFile(wb,`${String(event.name||"event").replace(/[\\/:*?"<>|]+/g,"-")}-junket.xlsx`);
    toast(t("reports.junketDone"),"success");
  }
  // ---- Event summary, one page (owner 2026-11-02) --------------------------
  // After the night, for the boss or the client: who was expected, who came,
  // who did not, per host / junket ("Davet Eden"), and how the tables filled.
  // Counts only from the records; nothing estimated, nothing changed.
  function printEventSummary(){
    const event=activeEvent();if(!event)return;
    if(!event.guests.length){toast(t("reports.doorNoGuests"),"error");return;}
    const sum=(gs)=>gs.reduce((n,g)=>n+paxOf(g),0);
    const came=event.guests.filter(g=>g.arrivalStatus==="Checked In"),noShow=event.guests.filter(g=>g.arrivalStatus==="No Show");
    const hosts=new Map();
    for(const g of event.guests){const h=String(g.invitedBy||"").trim()||t("reports.sumNoHost");if(!hosts.has(h))hosts.set(h,[]);hosts.get(h).push(g);}
    const hostRows=[...hosts.entries()].sort((a,b)=>sum(b[1])-sum(a[1])).map(([h,gs])=>`<tr><td>${esc(h)}</td><td>${sum(gs)}</td><td>${sum(gs.filter(g=>g.arrivalStatus==="Checked In"))}</td><td>${sum(gs.filter(g=>g.arrivalStatus==="No Show"))}</td></tr>`).join("");
    const byTable=event.tables.map(tb=>{const gs=event.guests.filter(g=>g.assignment&&g.assignment.tableId===tb.id);return{tb,planned:sum(gs),came:sum(gs.filter(g=>g.arrivalStatus==="Checked In"))};});
    const emptyLive=byTable.filter(x=>x.planned>0&&x.came===0).map(x=>formatTableNumber(x.tb.number));
    const root=printRoot();
    root.innerHTML=`
      <div class="pp-head">
        <div class="pp-title"><b>${esc(event.name)} — ${t("reports.sumTitle")}</b><span>${esc([event.hotel,event.salon].filter(Boolean).join(" · "))}</span></div>
        <div class="pp-meta"><span>${esc(fmtDate(event.date))}</span></div>
      </div>
      <table class="sum-kpis"><tr><td><b>${sum(event.guests)}</b><span>${t("reports.sumExpected")}</span></td><td><b>${sum(came)}</b><span>${t("reports.sumCame")}</span></td><td><b>${sum(noShow)}</b><span>${t("reports.sumNoShow")}</span></td><td><b>${sum(event.guests)-sum(came)-sum(noShow)}</b><span>${t("reports.sumNotMarked")}</span></td></tr></table>
      <h3 class="sum-h">${t("reports.sumByHost")}</h3>
      <table class="sum-table"><thead><tr><th>${t("reports.sumHost")}</th><th>${t("reports.sumExpected")}</th><th>${t("reports.sumCame")}</th><th>${t("reports.sumNoShow")}</th></tr></thead><tbody>${hostRows}</tbody></table>
      <h3 class="sum-h">${t("reports.sumTables")}</h3>
      <p class="sum-p">${t("reports.sumTablesLine",{n:event.tables.length,used:byTable.filter(x=>x.came>0).length,empty:emptyLive.length})}${emptyLive.length?` ${esc(emptyLive.join(", "))}`:""}</p>
      ${noShow.length?`<h3 class="sum-h">${t("reports.sumNoShowList")}</h3><p class="sum-p">${noShow.map(g=>esc(g.name)).join(", ")}</p>`:""}`;
    document.body.classList.add("printing");
    const cleanup=()=>{document.body.classList.remove("printing");root.innerHTML="";window.removeEventListener("afterprint",cleanup);};
    window.addEventListener("afterprint",cleanup);
    window.print();
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
    render=deps.render;
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
  globalThis.MeritScreenReports=Object.freeze({create,DEPS:Object.freeze(["activeEvent","app","auditTrailText","bindDoctorGo","buildTablePlanModel","doctorGoHTML","doctorText","esc","eventMetrics","eventReadiness","exportGuestCSV","exportTablePlanXLSX","fmtDate","formatTableNumber","getState","icon","LIVE","naturalSort","paxOf","planIssues","relativeTime","render","resolvedAuditTrail","RULES","seatExportName","seatingStats","t","tableAssignedPax","toast","TRAIL","ui","whileBusy"])});
})();
