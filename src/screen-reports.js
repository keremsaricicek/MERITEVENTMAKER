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
  // ---- RAPOR TASARIMCISI (owner, binding: "reporting always detailed, any
  // report you want, the preview always visible, PDF on request") -------------
  // What a report CONTAINS is decided by src/report-designer.js (pure, tested by
  // `report-designer`); this part only draws it, binds the controls and sends it
  // out. Preview (left, always visible) and designer (right) sit side by side;
  // the preview is the real sheets of paper at their millimetre size, scaled to
  // fit, one box per printed page.
  //
  // READ-ONLY BY CONSTRUCTION. Nothing here writes to the event, so a historical
  // (Completed or past) event gets the whole designer, preview and every export.
  // Templates are kept on THIS machine, per event id, OUTSIDE the event record
  // ("merit.reportTemplates.v2"), which is why saving one is allowed for a
  // historical event too: it never passes through canMutate because it never
  // mutates an event. Templates of the older build ("merit.reportTemplates.v1",
  // one list for every event) are still offered, marked as shared.
  //
  // OUTPUT. PDF and Print both use the browser's own print (Save as PDF): the
  // sheets are copied into #printRoot and the print stylesheet gives each its own
  // page at the chosen paper size — no network, no library. Excel goes through
  // SheetJS as its own workbook (one "REPORT" sheet); the one-click TABLE PLAN /
  // GUEST LIST / UNASSIGNED workbook is not built here (report-xlsx-identity).
  const TPL_KEY="merit.reportTemplates.v2",TPL_KEY_V1="merit.reportTemplates.v1";
  // A function body, not a top-level read: the module loads after this file.
  function RD(){
    return globalThis.MeritReportDesigner;
  }
  const rdHelpers=()=>({t,formatTableNumber,naturalSort});
  function rdState(event){
    if(!ui.reportDesign||ui.reportDesign.eventId!==event.id)ui.reportDesign={eventId:event.id,design:RD().defaults(),tplName:""};
    return ui.reportDesign;
  }
  function rdRead(key,fallback){try{const v=JSON.parse(globalThis.localStorage.getItem(key)||"null");return v==null?fallback:v;}catch{return fallback;}}
  function rdTemplates(event){
    const all=rdRead(TPL_KEY,{}),own=RD().templates(all&&typeof all==="object"&&!Array.isArray(all)?all[event.id]:[]);
    return[...own.map(x=>({scope:"event",tpl:x})),...RD().templates(rdRead(TPL_KEY_V1,[])).map(x=>({scope:"shared",tpl:x}))];
  }
  function rdWriteTemplates(event,list){
    const all=rdRead(TPL_KEY,{}),next=all&&typeof all==="object"&&!Array.isArray(all)?all:{};
    if(list.length)next[event.id]=list;else delete next[event.id];
    globalThis.localStorage.setItem(TPL_KEY,JSON.stringify(next));
  }
  function rdTitle(event,d){return d.title||t("rd.kind."+d.kind);}
  function rdEventLine(event){return[event.name,fmtDate(event.date),[event.hotel,event.salon].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");}
  function rdSheetsHTML(event,d){
    const R=RD(),rep=R.build(event,d,rdHelpers()),pg=R.paginate(rep),cols=rep.columns,n=pg.pages.length;
    const head=`<header class="rd-doc-head">${d.logo?`<img class="rd-logo" src="${esc(d.logo)}" alt="">`:""}<div><div class="rd-title">${esc(rdTitle(event,d))}</div>${d.subtitle?`<div class="rd-subtitle">${esc(d.subtitle)}</div>`:""}${d.showEvent?`<div class="rd-sub">${esc(rdEventLine(event))}</div>`:""}</div></header>`;
    const thead=`<thead><tr>${cols.map(c=>`<th class="rd-c-${c}">${esc(t("rd.col."+c))}</th>`).join("")}</tr></thead>`;
    const part=p=>(rep.grouped?`<tr class="rd-grp"><th colspan="${cols.length}"><span>${esc(p.group.label)}${p.cont?` <i>(${esc(t("rd.cont"))})</i>`:""}</span><span class="rd-grp-n">${esc(t("rd.groupCount",{records:p.group.records,pax:p.group.pax}))}</span></th></tr>`:"")
      +p.lines.map(l=>`<tr${l.type==="companion"?` class="rd-comp"`:""}>${l.cells.map((c,i)=>`<td class="rd-c-${cols[i]}">${esc(c)}</td>`).join("")}</tr>`).join("");
    return pg.pages.map((p,i)=>`<section class="rd-sheet" data-paper="${esc(d.paper)}" data-page="${i+1}" data-font="${d.font}" aria-label="${esc(t("rd.pageOf",{i:i+1,n}))}">
      ${i===0?head:""}
      ${rep.totals.records?`<table class="rd-table">${thead}<tbody>${p.parts.map(part).join("")}</tbody></table>`:`<p class="rd-empty">${esc(t("rd.empty"))}</p>`}
      ${i===n-1?`<div class="rd-total">${esc(t("rd.count",{records:rep.totals.records,pax:rep.totals.pax}))}</div>`:""}
      <footer class="rd-sheet-foot"><span>${esc(rdTitle(event,d))}</span><span>${esc(t("rd.pageOf",{i:i+1,n}))}</span></footer>
    </section>`).join("");
  }
  function designerHTML(event){
    const R=RD(),s=rdState(event),d=s.design,f=d.filters;
    const opt=(v,l,on)=>`<option value="${esc(v)}"${on?" selected":""}>${esc(l)}</option>`;
    const sel=(attr,label,options,cur)=>`<label class="rd-f">${esc(label)}<select class="filter-input" ${attr}>${options.map(([v,l])=>opt(v,l,cur===v)).join("")}</select></label>`;
    const hosts=[...new Map(event.guests.map(g=>String(g.invitedBy||"").trim()).filter(Boolean).map(h=>[h.toLocaleLowerCase("tr"),h])).values()].sort((a,b)=>naturalSort(a,b));
    const zones=[...new Set(event.tables.map(x=>String(x.zone||"")).filter(Boolean))].sort((a,b)=>naturalSort(a,b));
    const tables=[...event.tables].sort((a,b)=>naturalSort(a.number,b.number));
    const all=["",t("rd.all")];
    const colRows=[...d.cols,...R.COLUMNS.filter(c=>!d.cols.includes(c))].map(c=>{const on=d.cols.includes(c);return`<div class="rd-col" data-rd-col="${c}"><label><input type="checkbox"${on?" checked":""}> ${esc(t("rd.col."+c))}</label>${on?`<button class="btn sm quiet" data-rd-col-up="${c}" aria-label="${esc(t("rd.up")+": "+t("rd.col."+c))}">↑</button><button class="btn sm quiet" data-rd-col-down="${c}" aria-label="${esc(t("rd.down")+": "+t("rd.col."+c))}">↓</button>`:""}</div>`;}).join("");
    const tpls=rdTemplates(event);
    const historical=RULES().isHistorical(event);
    const panel=`<aside class="rd-panel" aria-label="${esc(t("rd.panel"))}">
      <div class="rd-out" role="group" aria-label="${esc(t("rd.output"))}">
        <button class="btn primary" data-rd-pdf>${icon("download")}${esc(t("rd.pdf"))}</button>
        <button class="btn" data-rd-print>${icon("image")}${esc(t("rd.print"))}</button>
        <button class="btn" data-rd-xlsx>${icon("download")}${esc(t("rd.excel"))}</button>
      </div>
      ${historical?`<p class="rd-readonly">${esc(t("rd.readonly"))}</p>`:""}
      ${sel("data-rd-kind",t("rd.kind"),R.KINDS.map(k=>[k,t("rd.kind."+k)]),d.kind)}
      <h3>${esc(t("rd.columns"))}</h3><div class="rd-cols">${colRows}</div>
      <label class="rd-check"><input type="checkbox" data-rd-companions${d.companions?" checked":""}> ${esc(t("rd.companions"))}</label>
      <h3>${esc(t("rd.filters"))}</h3>
      <label class="rd-f">${esc(t("rd.f.q"))}<input class="filter-input" type="search" data-rd-filter="q" value="${esc(f.q)}"></label>
      <div class="rd-two">${sel(`data-rd-filter="planning"`,t("rd.f.planning"),[all,...["Confirmed","Tentative"].map(x=>[x,t("status.planning."+x)])],f.planning)}
      ${sel(`data-rd-filter="arrival"`,t("rd.f.arrival"),[all,...["Not Arrived","Checked In","No Show"].map(x=>[x,t("status.arrival."+x)])],f.arrival)}</div>
      <div class="rd-two">${sel(`data-rd-filter="vip"`,t("rd.col.vip"),[all,["vip",t("rd.vip.vip")],["standard",t("rd.vip.standard")]],f.vip)}
      ${sel(`data-rd-filter="table"`,t("rd.f.table"),[all,[R.UNASSIGNED,t("rd.t.unassigned")],[R.ASSIGNED,t("rd.t.assigned")],...tables.map(x=>[x.id,formatTableNumber(x.number)])],f.table)}</div>
      <div class="rd-two">${sel(`data-rd-filter="zone"`,t("rd.f.zone"),[all,...zones.map(z=>[z,z])],f.zone)}
      ${sel(`data-rd-filter="host"`,t("rd.f.host"),[all,...hosts.map(h=>[h,h])],f.host)}</div>
      <h3>${esc(t("rd.order"))}</h3>
      <div class="rd-two">${sel("data-rd-sort",t("rd.sort"),R.SORTS.map(k=>[k,t("rd.sort."+k)]),d.sort.by)}
      ${sel("data-rd-dir",t("rd.dir"),[["asc",t("rd.dir.asc")],["desc",t("rd.dir.desc")]],d.sort.dir)}</div>
      ${sel("data-rd-group",t("rd.group"),R.GROUPS.map(k=>[k,t("rd.group."+k)]),d.groupBy)}
      <h3>${esc(t("rd.page"))}</h3>
      <label class="rd-f">${esc(t("rd.title"))}<input class="filter-input" data-rd-text="title" value="${esc(d.title)}" placeholder="${esc(t("rd.kind."+d.kind))}"></label>
      <label class="rd-f">${esc(t("rd.subtitleLabel"))}<input class="filter-input" data-rd-text="subtitle" value="${esc(d.subtitle)}"></label>
      <label class="rd-check"><input type="checkbox" data-rd-showevent${d.showEvent?" checked":""}> ${esc(t("rd.showEvent"))}</label>
      <label class="rd-f">${esc(t("rd.logo"))}<input type="file" accept="image/png,image/jpeg" data-rd-logo>${d.logo?`<button class="btn sm quiet" data-rd-logo-clear>${esc(t("rd.logoClear"))}</button>`:""}</label>
      <div class="rd-two">${sel("data-rd-paper",t("rd.paper"),R.PAPERS.map(x=>[x,t("rd.paper."+x)]),d.paper)}
      ${sel("data-rd-font",t("rd.font"),R.FONTS.map(x=>[String(x),x+" pt"]),String(d.font))}</div>
      <h3>${esc(t("rd.templates"))}</h3>
      ${tpls.length?`<label class="rd-f">${esc(t("rd.load"))}<select class="filter-input" data-rd-load>${opt("","—",true)}${tpls.map((x,i)=>opt(String(i),x.tpl.name+(x.scope==="shared"?" "+t("rd.shared"):""),false)).join("")}</select></label>`:""}
      <div class="rd-save"><input class="filter-input" data-rd-template-name aria-label="${esc(t("rd.templateName"))}" placeholder="${esc(t("rd.templateName"))}" value="${esc(s.tplName||"")}"><button class="btn" data-rd-save>${esc(t("rd.save"))}</button></div>
      ${tpls.some(x=>x.scope==="event"&&x.tpl.name===s.tplName)?`<button class="btn sm quiet rd-del" data-rd-delete>${esc(t("rd.delete",{name:s.tplName}))}</button>`:""}
      <p class="rd-note">${esc(t("rd.templatesNote"))}</p>
      <h3>${esc(t("rd.oneClickTitle"))}</h3>
      <button class="btn report-btn" data-report="xlsx">${icon("download")}${t("reports.exportTablePlan")}</button>
    </aside>`;
    return`<div class="rd-stage"><div class="rd-preview" role="region" aria-label="${esc(t("rd.preview"))}" tabindex="0">${rdSheetsHTML(event,d)}</div>${panel}</div>`;
  }
  function viewSwitchHTML(){
    const v=ui.reportsView==="designer"?"designer":"summary";
    return`<div class="seg rd-switch" role="group">${["summary","designer"].map(k=>`<button class="btn sm${v===k?" primary":""}" data-reports-view="${k}" aria-pressed="${v===k}">${esc(t("rd.view."+k))}</button>`).join("")}</div>`;
  }
  // The preview's sheets are real millimetres; scale them to the column.
  function rdFit(){
    const pv=app.querySelector(".rd-preview"),sh=pv&&pv.querySelector(".rd-sheet");if(!sh)return;
    const px=RD().pageBox(sh.dataset.paper).w*96/25.4,room=pv.clientWidth-48;
    pv.style.setProperty("--rd-zoom",String(Math.max(.25,Math.min(1,room/px)).toFixed(3)));
  }
  let rdResizeBound=false;
  function rdFileBase(event,d){return`${String(event.name||"event").replace(/[\\/:*?"<>|]+/g,"-")}-${String(rdTitle(event,d)).replace(/[\\/:*?"<>|]+/g,"-")}`.slice(0,120);}
  function rdPrint(event,d,asPdf){
    const sheets=app.querySelectorAll(".rd-preview .rd-sheet");if(!sheets.length)return;
    const root=printRoot();
    // Copies of the rendered sheets (nodes, not a string): no new markup sink.
    const wrap=document.createElement("div");wrap.className="rd-print";wrap.dataset.paper=d.paper;
    sheets.forEach(s=>wrap.appendChild(s.cloneNode(true)));
    root.replaceChildren(wrap);
    document.body.classList.add("printing","printing-designer");
    // Save as PDF names the file after the document title.
    const title=document.title;if(asPdf)document.title=rdFileBase(event,d);
    const cleanup=()=>{document.body.classList.remove("printing","printing-designer");root.replaceChildren();document.title=title;window.removeEventListener("afterprint",cleanup);};
    window.addEventListener("afterprint",cleanup);
    if(asPdf)toast(t("rd.pdfHint"),"info",6000);
    window.print();
    setTimeout(cleanup,60000);
  }
  function rdExcel(event,d){
    const X=globalThis.XLSX;
    if(!X){toast(t("guests.engineMissing"),"error",5200);return;}
    const R=RD(),rep=R.build(event,d,rdHelpers());
    const aoa=R.sheetRows(rep,[rdTitle(event,d),d.subtitle,d.showEvent?rdEventLine(event):""],rdHelpers());
    const wb=X.utils.book_new(),ws=X.utils.aoa_to_sheet(aoa);
    ws["!cols"]=rep.columns.map(c=>({wch:c==="name"||c==="notes"?32:c==="host"?24:12}));
    X.utils.book_append_sheet(wb,ws,"REPORT");
    X.writeFile(wb,rdFileBase(event,d)+".xlsx");
    toast(t("rd.excelDone"),"success");
  }
  function bindDesigner(){
    app.querySelectorAll("[data-reports-view]").forEach(b=>b.onclick=()=>{ui.reportsView=b.dataset.reportsView;render();});
    if(ui.reportsView!=="designer")return;
    const event=activeEvent();if(!event||!RD())return;
    const s=rdState(event),R=RD(),again=()=>render();
    // Any change to WHAT is shown makes it a custom report; the kind is only where it started.
    const what=fn=>{fn(s.design);s.design.kind="custom";s.design=R.normalize(s.design);again();};
    rdFit();
    if(!rdResizeBound){rdResizeBound=true;window.addEventListener("resize",()=>{if(ui.reportsView==="designer")rdFit();});}
    const one=(sel,fn)=>{const n=app.querySelector(sel);if(n)fn(n);};
    one("[data-rd-kind]",n=>n.onchange=()=>{s.design=R.applyKind(s.design,n.value);again();});
    app.querySelectorAll("[data-rd-col] input").forEach(i=>i.onchange=()=>{const c=i.closest("[data-rd-col]").dataset.rdCol;what(d=>{d.cols=i.checked?[...d.cols.filter(x=>x!==c),c]:d.cols.filter(x=>x!==c);});});
    const move=(c,k)=>what(d=>{const i=d.cols.indexOf(c),j=i+k;if(i<0||j<0||j>=d.cols.length)return;const a=d.cols.slice();[a[i],a[j]]=[a[j],a[i]];d.cols=a;});
    app.querySelectorAll("[data-rd-col-up]").forEach(b=>b.onclick=()=>move(b.dataset.rdColUp,-1));
    app.querySelectorAll("[data-rd-col-down]").forEach(b=>b.onclick=()=>move(b.dataset.rdColDown,1));
    // Typed fields re-render on a short pause, focus and caret kept.
    const typed=(n,sel,set)=>{n.oninput=()=>{set(n.value);clearTimeout(ui.rdTimer);const pos=n.selectionStart;ui.rdTimer=setTimeout(()=>{again();const m=app.querySelector(sel);if(m){m.focus();if(m.type!=="file"&&typeof m.setSelectionRange==="function"&&pos!=null)m.setSelectionRange(pos,pos);}},250);};};
    app.querySelectorAll("[data-rd-filter]").forEach(n=>{const k=n.dataset.rdFilter;
      if(n.tagName==="INPUT")typed(n,`[data-rd-filter="${k}"]`,v=>{s.design.filters[k]=v.slice(0,80);s.design.kind="custom";});
      else n.onchange=()=>what(d=>{d.filters[k]=n.value;});});
    app.querySelectorAll("[data-rd-text]").forEach(n=>{const k=n.dataset.rdText;typed(n,`[data-rd-text="${k}"]`,v=>{s.design[k]=v.slice(0,k==="title"?160:240);});});
    one("[data-rd-sort]",n=>n.onchange=()=>what(d=>{d.sort={by:n.value,dir:d.sort.dir};}));
    one("[data-rd-dir]",n=>n.onchange=()=>what(d=>{d.sort={by:d.sort.by,dir:n.value};}));
    one("[data-rd-group]",n=>n.onchange=()=>what(d=>{d.groupBy=n.value;}));
    one("[data-rd-companions]",n=>n.onchange=()=>what(d=>{d.companions=n.checked;}));
    one("[data-rd-showevent]",n=>n.onchange=()=>{s.design.showEvent=n.checked;again();});
    one("[data-rd-paper]",n=>n.onchange=()=>{s.design.paper=n.value;again();});
    one("[data-rd-font]",n=>n.onchange=()=>{s.design.font=Number(n.value)||12;again();});
    one("[data-rd-template-name]",n=>n.oninput=()=>{s.tplName=n.value;});
    one("[data-rd-logo]",n=>n.onchange=()=>{const file=n.files&&n.files[0];if(!file)return;if(file.size>400000){toast(t("rd.logoTooBig"),"error");return;}const rd=new FileReader();rd.onload=()=>{const next=R.normalize(Object.assign({},s.design,{logo:String(rd.result)}));if(next.logo){s.design=next;again();}};rd.readAsDataURL(file);});
    one("[data-rd-logo-clear]",n=>n.onclick=()=>{s.design.logo="";again();});
    one("[data-rd-load]",n=>n.onchange=()=>{const x=rdTemplates(event)[Number(n.value)];if(!x)return;const{name,...design}=x.tpl;s.design=R.normalize(design);s.tplName=name;again();});
    // EXPECTED ABSTENTION: a storage that refuses (quota, private mode) loses the
    // template, never the screen; the person is told.
    const store=list=>{try{rdWriteTemplates(event,list);return true;}catch(error){console.warn("The report template could not be kept on this machine.",error&&error.name);toast(t("rd.notSaved"),"error");}};
    const own=()=>rdTemplates(event).filter(x=>x.scope==="event").map(x=>x.tpl);
    one("[data-rd-save]",n=>n.onclick=()=>{
      const name=String((app.querySelector("[data-rd-template-name]")||{}).value||s.tplName||"").trim().slice(0,80);
      const tpl=R.template(name,s.design);
      if(!tpl){toast(t("rd.nameFirst"),"error");return;}
      s.tplName=tpl.name;if(store(R.upsert(own(),tpl)))toast(t("rd.saved",{name:tpl.name}));again();
    });
    one("[data-rd-delete]",n=>n.onclick=()=>{const name=s.tplName;if(store(own().filter(x=>x.name!==name)))toast(t("rd.deleted",{name}));s.tplName="";again();});
    one("[data-rd-print]",n=>n.onclick=()=>rdPrint(event,s.design,false));
    one("[data-rd-pdf]",n=>n.onclick=()=>rdPrint(event,s.design,true));
    one("[data-rd-xlsx]",n=>n.onclick=()=>rdExcel(event,s.design));
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
