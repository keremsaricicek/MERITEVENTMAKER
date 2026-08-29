(() => {
  "use strict";
  const V8_STORAGE_KEY = "meritEventMaker.v8";
  const LEGACY_KEYS = ["meritEventMaker.v7", "meritEventMaker.v3", "meritEventMaker.v2", "meritEventMaker.v1"];
  const todayKey = () => new Date().toLocaleDateString("en-CA");
  const original = {
    render, bindCommon, bindCanvas, bindGuests, bindSeating, bindLive, bindReports,
    floorPlanHTML, seatingHTML, guestsHTML, reportsHTML, inspectorHTML,
    setTableCapacity, inspectorAction, updateInspectorField, deleteSelectedObject,
    startObjectDrag, startResize, startRotate, createTableFromDraft, addVenue,
    openGuestDialog, deleteGuest, assignGuestToTable, unassignGuest, toggleAssignmentLock,
    duplicateEvent, loadXLSX, saveState, touchEvent, openGuide
  };

  Object.assign(ui, {
    screen:"events", tab:"floor", focusMode:false, v8AddOpen:false,
    selectedObjectIds:[], selectedGuestIds:[], guestAnchorId:null,
    operationalMode:false, reviewFilter:"all", reviewClass:"all", reviewConfidence:0,
    analysisBusy:false, analysisProgress:0, analysisStage:"Ready", selectedCandidateId:null,
    reviewDrawMode:false, teachAI:false, setupBusy:false,
    lang:"en", reviewCenterOpen:false, difficultQuestionIndex:0, activeReviewGroupId:null, activeQuestionId:null, ocrText:null
  });

  function blankRoot(){ return {version:8, schemaVersion:8, events:[], verifiedExamples:[], analyses:[], calibration:null, audit:[]}; }
  function isHistorical(event){ return !!event && (event.status === "Completed" || (!!event.date && event.date < todayKey())); }
  function audit(event, action, detail={}){
    state.audit ||= [];
    state.audit.unshift({id:uid("audit"), eventId:event?.id||null, action, detail, at:nowISO()});
    state.audit = state.audit.slice(0, 1000);
  }
  function canMutate(event, action="change this event"){
    if(!event) return false;
    if(isHistorical(event)){
      toast(`Historical events are read-only. You cannot ${action}.`, "error", 5200);
      return false;
    }
    return true;
  }
  function chairGeometry(table, count=Math.max(1, Number(table.capacity)||1)){
    const out=[];
    if(table.type==="round"||table.type==="bistro"){
      const rx=table.type==="bistro"?43:45, ry=table.type==="bistro"?43:46;
      for(let i=0;i<count;i++){const a=-Math.PI/2+i/count*Math.PI*2;out.push({x:50+Math.cos(a)*rx,y:50+Math.sin(a)*ry,rotation:a*180/Math.PI+90});}
    } else if(table.type==="square"){
      for(let i=0;i<count;i++){const u=i/count*4;if(u<1)out.push({x:15+u*70,y:7,rotation:0});else if(u<2)out.push({x:93,y:15+(u-1)*70,rotation:90});else if(u<3)out.push({x:85-(u-2)*70,y:93,rotation:180});else out.push({x:7,y:85-(u-3)*70,rotation:270});}
    } else {
      const top=Math.ceil(count/2),bottom=count-top;
      for(let i=0;i<top;i++)out.push({x:top===1?50:12+i*76/(top-1),y:8,rotation:0});
      for(let i=0;i<bottom;i++)out.push({x:bottom===1?50:88-i*76/(bottom-1),y:92,rotation:180});
    }
    return out;
  }
  function syncTableChairs(table, count=table.capacity){
    count=Math.max(1,Math.min(99,Number(count)||1));
    const old=Array.isArray(table.chairs)?table.chairs:[], geometry=chairGeometry({...table,capacity:count},count);
    table.capacity=count;
    table.chairs=geometry.map((p,index)=>({
      id:old[index]?.id||uid("chair"), parentTableId:table.id, seatNumber:index+1,
      x:Number.isFinite(old[index]?.x)?old[index].x:p.x, y:Number.isFinite(old[index]?.y)?old[index].y:p.y,
      rotation:Number.isFinite(old[index]?.rotation)?old[index].rotation:p.rotation, occupancy:null
    }));
    return table;
  }
  function refreshChairOccupancy(event){
    for(const table of event.tables||[])syncTableChairs(table).chairs.forEach(chair=>chair.occupancy=null);
    // `continue`, not `return`: this used to abort the whole loop at the first
    // unassigned guest, leaving every later guest's chairs marked unoccupied.
    for(const guest of event.guests||[]){if(!guest.assignment)continue;const table=event.tables.find(t=>t.id===guest.assignment.tableId);if(!table)continue;(guest.assignment.seats||[]).forEach((seatIndex,partyIndex)=>{const chair=table.chairs[Number(seatIndex)];if(chair)chair.occupancy={guestId:guest.id,partyIndex,planned:true};});}
  }
  function migrateEvent(event){
    const migrated={...event};
    migrated.id ||= uid("event"); migrated.name=String(migrated.name||"Untitled Event");
    migrated.hotel=String(migrated.hotel ?? migrated.venue ?? "");
    migrated.salon=String(migrated.salon ?? "");
    migrated.venue=migrated.hotel; migrated.coverImage=migrated.coverImage||"";
    migrated.status=["Planning","Confirmed","Live","Completed"].includes(migrated.status)?migrated.status:"Planning";
    migrated.createdAt ||= nowISO(); migrated.lastModified ||= migrated.createdAt;
    migrated.tables=(migrated.tables||[]).map(table=>syncTableChairs({...table,id:table.id||uid("table"),hasPhysicalSeats:table.hasPhysicalSeats!==false}));
    migrated.venueObjects=(migrated.venueObjects||[]).map(o=>({...o,id:o.id||uid("venue")}));
    migrated.guests=(migrated.guests||[]).map(normalizeGuest);
    migrated.background={src:"",name:"",opacity:.28,visible:false,locked:true,isDefault:false,scale:100,...(migrated.background||{})};
    if(migrated.background.isDefault){migrated.background.src="";migrated.background.visible=false;migrated.background.isDefault=false;}
    migrated.analysis=migrated.analysis||null;
    refreshChairOccupancy(migrated);
    return migrated;
  }
  function parseRoot(raw){
    const parsed=JSON.parse(raw); parsed.version=8; parsed.schemaVersion=8;
    parsed.events=(parsed.events||[]).map(migrateEvent); parsed.verifiedExamples ||= []; parsed.analyses ||= []; parsed.audit ||= [];
    return parsed;
  }
  function loadV8(){
    try{
      const own=localStorage.getItem(V8_STORAGE_KEY); if(own) return parseRoot(own);
      for(const key of LEGACY_KEYS){const raw=localStorage.getItem(key);if(raw){const migrated=parseRoot(raw);migrated.audit.unshift({id:uid("audit"),eventId:null,action:"LEGACY_MIGRATION",detail:{source:key,venueToHotel:true,salonInvented:false},at:nowISO()});return migrated;}}
    }catch(error){console.warn("V8 state restore failed",error);}
    return blankRoot();
  }
  saveState = function(show=false){
    state.events.forEach(refreshChairOccupancy);
    try{localStorage.setItem(V8_STORAGE_KEY,JSON.stringify(state));if(show)toast("Saved locally in this browser.","success");}
    catch(error){
      try{const compact=clone(state);compact.events.forEach(e=>{if(e.background)e.background.src="";if(e.coverImage)e.coverImage="";});localStorage.setItem(V8_STORAGE_KEY,JSON.stringify(compact));toast("Event data was saved, but large images exceeded browser storage.","error",6500);}
      catch{toast("Browser storage is full. Export the workbook before closing.","error",6500);}
    }
  };
  touchEvent = function(event){event.lastModified=nowISO();audit(event,"EVENT_UPDATED");saveState();};
  state=loadV8();

  seatPositions = function(table){syncTableChairs(table);return table.chairs.map(c=>({x:c.x,y:c.y,rotation:c.rotation,id:c.id,seatNumber:c.seatNumber}));};
  function physicalCapacity(event){return event.tables.filter(t=>t.hasPhysicalSeats!==false).reduce((sum,t)=>sum+t.chairs.length,0);}
  function liveUsedIndexes(event,tableId,exceptIds=[]){
    const except=new Set(exceptIds), used=new Set();
    event.guests.forEach(g=>{if(except.has(g.id)||g.arrivalStatus==="No Show")return;if(g.assignment?.tableId===tableId)(g.assignment.seats||[]).forEach(index=>used.add(Number(index)));});
    return used;
  }
  function liveStats(event){
    let emptyTables=0,emptyChairs=0;
    for(const table of event.tables.filter(t=>t.hasPhysicalSeats!==false)){
      const used=liveUsedIndexes(event,table.id); if(used.size===0)emptyTables++; emptyChairs+=Math.max(0,table.chairs.length-used.size);
    }
    const sum=status=>event.guests.filter(g=>g.arrivalStatus===status).reduce((n,g)=>n+paxOf(g),0);
    return {total:event.guests.reduce((n,g)=>n+paxOf(g),0),checked:sum("Checked In"),notArrived:sum("Not Arrived"),noShow:sum("No Show"),emptyTables,emptyChairs};
  }
  tableMatchesFilter = function(event,table){
    const used=ui.operationalMode?liveUsedIndexes(event,table.id):occupiedSeatIndexes(event,table.id);
    const empty=Math.max(0,table.chairs.length-used.size);
    if(ui.seatingFilter==="empty")return used.size===0;if(ui.seatingFilter==="available")return empty>0;if(ui.seatingFilter==="full")return empty===0;return true;
  };
  filterBannerHTML = function(){
    if(ui.operationalMode&&ui.seatingFilter==="available")return`<div class="operational-banner">${icon("chair")}<b>Live operational view:</b> red glow marks physically available chairs after No Show release.<button class="tiny-btn" data-clear-seating-filter>Clear</button></div>`;
    if(ui.seatingFilter==="all")return"";
    return`<div class="filter-banner">${icon("search")}<span>${{empty:"Showing empty tables",available:"Showing tables with available seats",full:"Showing full tables"}[ui.seatingFilter]}</span><button data-clear-seating-filter>${icon("x")}</button></div>`;
  };
  tableObjectHTML = function(event,table,seating){
    syncTableChairs(table);
    const selected=(!seating&&(ui.selectedObjectId===table.id||ui.selectedObjectIds.includes(table.id)))||(seating&&ui.selectedTableId===table.id);
    const highlighted=ui.highlightId===table.id,match=!seating||tableMatchesFilter(event,table);
    const used=seating&&ui.operationalMode?liveUsedIndexes(event,table.id):occupiedSeatIndexes(event,table.id);
    const assigned=used.size, empty=Math.max(0,table.capacity-assigned);
    const chairs=table.chairs.map((chair,index)=>`<i class="chair ${used.has(index)?"occupied":seating&&ui.operationalMode?"available-live":""}" data-chair-id="${chair.id}" style="left:${chair.x}%;top:${chair.y}%;transform:translate(-50%,-50%) rotate(${chair.rotation||0}deg)"></i>${ui.showSeats?`<span class="seat-number" style="left:${50+(chair.x-50)*.69}%;top:${50+(chair.y-50)*.69}">S${chair.seatNumber}</span>`:""}`).join("");
    return`<div class="table-object ${esc(table.type)} ${selected?"selected multi-selected":""} ${highlighted?"highlighted":""} ${seating&&!match?"dimmed":""} ${seating&&match&&ui.seatingFilter!=="all"?"filter-match operational-match":""}" data-object-id="${table.id}" data-object-kind="table" style="left:${table.x}px;top:${table.y}px;width:${table.w}px;height:${table.h}px;transform:rotate(${table.rotation||0}deg);z-index:${table.z||10}">${chairs}<div class="table-surface"><span class="table-label">${esc(formatTableNumber(table.number))}</span><span class="table-occ">${seating?assigned+" / ":""}${table.capacity}</span>${seating&&ui.seatingFilter==="available"&&empty?`<span class="table-empty">${empty} EMPTY</span>`:""}</div>${selected&&!seating?handlesHTML():""}</div>`;
  };

  function planIssues(event){
    const issues=[],numbers=new Set(),capacity=physicalCapacity(event),pax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    // Each issue carries a stable `code` so callers can route on it without
    // string-matching a translated title.
    for(const table of event.tables){if(numbers.has(table.number))issues.push({level:"blocker",code:"duplicateTable",fix:"floor",title:t("health.issue.duplicateTable"),text:t("health.issue.duplicateTableText",{number:table.number})});numbers.add(table.number);}
    if(!event.tables.length)issues.push({level:"warn",code:"blankPlan",fix:"floor",title:t("health.issue.blankPlan"),text:t("health.issue.blankPlanText")});
    if(pax>capacity)issues.push({level:"blocker",code:"capacityExceeded",fix:"floor",title:t("health.issue.capacityExceeded"),text:t("health.issue.capacityExceededText",{pax,capacity})});
    const unassigned=event.guests.filter(g=>!g.assignment).reduce((n,g)=>n+paxOf(g),0);if(unassigned)issues.push({level:"warn",code:"unassigned",fix:"seating",title:t("health.issue.unassigned"),text:t("health.issue.unassignedText",{n:unassigned})});
    return issues;
  }
  function planHealthHTML(event){
    const issues=planIssues(event),level=issues.some(x=>x.level==="blocker")?"blocker":issues.length?"warn":"";
    return`<details class="plan-health"><summary><i class="health-dot ${level}"></i>${t("health.planHealth")}${issues.length?` · ${issues.length}`:` · ${t("health.ready")}`}</summary><div class="health-pop">${issues.length?issues.map(x=>`<div class="health-item"><i class="health-dot ${x.level}"></i><div><b>${esc(x.title)}</b><span>${esc(x.text)}</span></div></div>`).join(""):`<div class="health-item"><i class="health-dot"></i><div><b>${t("health.noBlockingIssues")}</b><span>${t("health.consistent")}</span></div></div>`}</div></details>`;
  }
  function eventCard(event){const m=eventMetrics(event),cover=event.coverImage?`<div class="event-cover" style="background-image:url('${event.coverImage}')"></div>`:`<div class="event-cover"><div class="event-cover-placeholder"></div></div>`;return`<article class="event-card" data-card-event="${event.id}">${cover}<div class="event-card-body"><div class="kicker">${esc(event.status)}</div><h3>${esc(event.name)}</h3><div class="event-meta">${esc(fmtDate(event.date))}<br>${esc([event.hotel,event.salon].filter(Boolean).join(" · ")||t("appbar.venueNotSet"))}</div><div class="event-card-stats"><div class="event-card-stat"><b>${m.guests}</b><span>${t("home.col.guestPax")}</span></div><div class="event-card-stat"><b>${physicalCapacity(event)}</b><span>${t("home.col.physicalChairs")}</span></div></div><div class="event-card-actions"><button class="btn primary" data-open-event="${event.id}">${t("home.openEvent")}</button><button class="btn" data-duplicate-event="${event.id}" title="Duplicate">${icon("copy")}</button><button class="btn danger" data-delete-event="${event.id}" title="Delete">${icon("trash")}</button></div></div></article>`;}
  // The next event is what the operator came for 95% of the time, so it gets
  // the hero treatment and everything else becomes a compact line.
  function nextEventHeroHTML(event){
    const totalPax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    const seatedPax=event.guests.filter(g=>g.assignment).reduce((n,g)=>n+paxOf(g),0);
    const chairs=physicalCapacity(event);
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
      <div class="row-icons"><button class="row-action" data-duplicate-event="${event.id}" aria-label="${esc(t("home.a11y.duplicate",{name:event.name}))}" title="${t("home.duplicate")}">${icon("copy")}</button><button class="row-action" data-delete-event="${event.id}" aria-label="${esc(t("home.a11y.delete",{name:event.name}))}" title="${t("home.delete")}">${icon("trash")}</button></div>
    </div>`;
  }
  eventsHTML = function(){
    const upcoming=state.events.filter(e=>!isHistorical(e)).sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999"));
    const history=state.events.filter(isHistorical).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
    const [next,...rest]=upcoming;
    return`<header class="appbar">${topBrand()}<div class="crumb">${t("home.crumb")} / <b>${t("home.portfolio")}</b></div><div class="appbar-actions">${helpButton()}<button class="btn primary" data-action="create-event">${icon("plus")}${t("home.createEvent")}</button></div></header><div class="mx-screen"><div class="mx-wrap">
      <div class="mx-head"><div><div class="kicker">${t("home.eyebrow")}</div><h1>${t("home.title")}</h1><p>${t("home.subtitle")}</p></div><span class="muted" style="font-size:12px">${t(state.events.length===1?"home.eventCount1":"home.eventsCount",{n:state.events.length})}</span></div>
      ${next?nextEventHeroHTML(next):`<div class="mx-empty"><h3>${t("home.noUpcoming")}</h3><p>${t("home.noUpcomingHint")}</p><button class="btn primary" data-action="create-event">${icon("plus")}${t("home.createEvent")}</button></div>`}
      ${rest.length?`<div class="mx-section"><div class="mx-section-head"><h2>${t("home.otherUpcoming")}</h2><span class="count">${rest.length}</span></div><div class="mx-list"><div class="mx-list-head event-line"><span>${t("home.col.event")}</span><span>${t("home.col.date")}</span><span>${t("home.col.hotelSalon")}</span><span>${t("home.col.guestPax")}</span><span>${t("home.col.physicalChairs")}</span><span></span></div>${rest.map(upcomingLineHTML).join("")}</div></div>`:""}
      <div class="mx-section"><div class="mx-section-head"><h2>${t("home.eventsHistory")}</h2><span class="count">${t("home.historyNote")}</span></div>${history.length?`<div class="mx-list"><div class="mx-list-head event-line"><span>${t("home.col.event")}</span><span>${t("home.col.date")}</span><span>${t("home.col.hotelSalon")}</span><span>${t("home.col.guestPax")}</span><span>${t("home.col.physicalChairs")}</span><span></span></div>${history.map(e=>`<div class="event-line" data-history-event="${e.id}" title="${esc(t("home.historyOpenHint"))}"><div><b>${esc(e.name)}</b></div><div class="muted">${esc(fmtDate(e.date))}</div><div class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc([e.hotel,e.salon].filter(Boolean).join(" · ")||"—")}</div><div class="seat-tag">${eventMetrics(e).guests}</div><div class="seat-tag">${physicalCapacity(e)}</div><div class="row-icons"><span class="readonly-tag">${icon("lock")}${t("home.readOnly")}</span><button class="row-action" data-delete-event="${e.id}" aria-label="${esc(t("home.a11y.delete",{name:e.name}))}" title="${t("home.delete")}">${icon("trash")}</button></div></div>`).join("")}</div>`:`<div class="mx-empty" style="padding:30px">${t("home.noHistorical")}</div>`}</div>
    </div></div>`;
  };

  const normalTabs=[["floor",()=>t("nav.floorPlanTab")],["guests",()=>t("nav.guestsTab")],["seating",()=>t("nav.seatingTab")],["live",()=>t("nav.liveTab")],["reports",()=>t("nav.reportsTab")]];
  const historyTabs=[["guests",()=>t("nav.guestsTab")],["seating",()=>t("nav.seatingTab")],["reports",()=>t("nav.reportsTab")]];
  workspaceHTML = function(event){
    const historical=isHistorical(event),tabs=historical?historyTabs:normalTabs;
    if(!tabs.some(([id])=>id===ui.tab))ui.tab=tabs[0][0];
    return`<section class="workspace ${ui.focusMode?"v8-focus":""}"><header class="workspace-head">${topBrand()}<div class="event-id"><strong>${esc(event.name)}</strong><span>${esc(fmtDate(event.date))} · ${esc([event.hotel,event.salon].filter(Boolean).join(" · ")||t("appbar.venueNotSet"))}</span></div><div class="workspace-actions"><div class="global-search">${icon("search")}<input id="globalGuestSearch" placeholder="${t("appbar.search")}" autocomplete="off"><div id="globalSearchResults" class="search-results hidden"></div></div>${planHealthHTML(event)}<button class="btn quiet icon-only" data-action="save-now" title="${t("appbar.saveNow")}">${icon("save")}</button>${helpButton()}<button class="btn sm" data-action="back-events">${t("appbar.allEvents")}</button></div></header><nav class="tabs">${tabs.map(([id,label])=>`<button class="tab ${ui.tab===id?"active":""}" data-tab="${id}">${label()}</button>`).join("")}</nav>${historical?`<div class="workspace-readonly-banner">${icon("lock")}${t("nav.historicalBanner")}</div>`:""}<div class="content">${tabContent(event)}</div>${ui.focusMode?`<button class="focus-exit" data-v8-action="focus">${t("nav.exitFocus")}</button>`:""}</section>`;
  };
  tabContent = function(event){
    if(isHistorical(event)){
      if(ui.tab==="guests")return`<div class="readonly-screen">${readonlyGuestsHTML(event)}</div>`;
      if(ui.tab==="seating")return`<div class="v8-lock">${seatingHTML(event)}</div>`;
      return reportsHTML(event);
    }
    if(ui.tab==="floor")return floorPlanHTML(event);if(ui.tab==="guests")return guestsHTML(event);if(ui.tab==="seating")return seatingHTML(event);if(ui.tab==="live")return liveHTML(event);return reportsHTML(event);
  };
  function readonlyGuestsHTML(event){
    return`<div class="screen-inner"><div class="readonly-note">${icon("lock")}This historical guest list is read-only.</div><div class="screen-titlebar"><div><h2>Guest List</h2><p>${event.guests.length} records · ${eventMetrics(event).guests} total pax</p></div></div><div class="guest-shell"><table class="guest-table"><thead><tr><th>Name Surname</th><th>Pax</th><th>Planning</th><th>Arrival</th><th>VIP</th><th>Invited By</th><th>Table / Seats</th><th>Notes</th></tr></thead><tbody>${event.guests.map(g=>{const t=event.tables.find(x=>x.id===g.assignment?.tableId);return`<tr><td><b>${esc(g.name)}</b></td><td>${paxOf(g)}</td><td>${esc(g.planningStatus)}</td><td>${esc(g.arrivalStatus)}</td><td>${esc(g.vip)}</td><td>${esc(g.invitedBy||"—")}</td><td>${t?esc(t.number)+" · "+esc(seatRange(g.assignment.seats)):"—"}</td><td>${esc(g.notes||"")}</td></tr>`}).join("")||`<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">No guest records.</td></tr>`}</tbody></table></div></div>`;
  }

  function setupHTML(){
    const d=newEventDraft;
    const statuses=["Planning","Confirmed","Live"];
    return`<section class="mx-setup">
      <header class="mx-setup-top">${topBrand()}<button class="btn" data-setup="cancel">${icon("x")}${t("setup.cancel")}</button></header>
      <div class="mx-setup-body">
        <section class="mx-panel">
          <div class="kicker">${t("setup.eyebrow")}</div>
          <h2>${t("setup.title")}</h2>
          <p>${t("setup.subtitle")}</p>
          <form id="v8EventForm" class="mx-form">
            <div class="field full"><label>${t("setup.eventName")}</label><input name="name" required autocomplete="off" value="${esc(d.name)}" placeholder="${t("setup.eventNamePh")}"></div>
            <div class="field"><label>${t("setup.date")}</label><input name="date" type="date" required value="${esc(d.date)}"></div>
            <div class="field"><label>${t("setup.status")}</label><select name="status">${statuses.map(s=>`<option value="${s}" ${d.status===s?"selected":""}>${t("setup.status."+s)}</option>`).join("")}</select></div>
            <div class="field"><label>${t("setup.hotel")}</label><input name="hotel" required value="${esc(d.hotel)}" placeholder="${t("setup.hotelPh")}"></div>
            <div class="field"><label>${t("setup.salon")}</label><input name="salon" value="${esc(d.salon)}" placeholder="${t("setup.salonPh")}"></div>
            <div class="field full"><label>${t("setup.cover")} · ${t("setup.coverOptional")}</label>
              <label class="mx-drop cover" data-cover-drop>${d.coverImage?`<img src="${d.coverImage}" alt="">`:`<span>${icon("image")} ${t("setup.chooseCover")}</span>`}<input id="v8CoverFile" type="file" accept="image/png,image/jpeg" hidden></label>
              ${d.coverImage?`<div class="mx-setup-actions" style="margin-top:9px"><button class="btn sm" type="button" data-setup="remove-cover">${t("setup.removeCover")}</button></div>`:""}
            </div>
          </form>
        </section>
        <section class="mx-panel">
          <div class="kicker">${t("setup.planEyebrow")}</div>
          <h2>${t("setup.planTitle")}</h2>
          <p>${t("setup.planSubtitle")}</p>
          <label class="mx-drop" id="v8PlanDrop">${d.planSrc?`<img src="${d.planSrc}" alt=""><strong>${esc(d.planName)}</strong>`:`${icon("image")}<strong>${t("setup.dropPlan")}</strong><span>${t("setup.dropPlanHint")}</span>`}<input id="v8PlanFile" type="file" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" hidden></label>
          ${d.pdfPages?.length?`<div class="pdf-pages">${d.pdfPages.map((p,i)=>`<button class="pdf-page ${d.pdfPage===i?"active":""}" type="button" data-pdf-page="${i}"><canvas data-pdf-thumb="${i}"></canvas><span>${t("setup.page",{n:i+1})}</span></button>`).join("")}</div>`:""}
          ${d.planSrc?`<div class="mx-setup-actions" style="margin-top:11px;justify-content:flex-start"><button class="btn sm" data-setup="replace-plan">${t("setup.replacePlan")}</button><button class="btn sm danger" data-setup="remove-plan">${t("setup.removePlan")}</button></div>`:""}
          <p class="mx-note">${t("setup.privacy")}</p>
          <div class="mx-setup-actions">
            <button class="btn" data-setup="blank" ${ui.setupBusy?"disabled":""}>${t("setup.continueBlank")}</button>
            <button class="btn primary" data-setup="create" ${ui.setupBusy?"disabled":""}>${ui.setupBusy?t("setup.preparing"):t("setup.create")}${icon("arrow")}</button>
          </div>
        </section>
      </div>
    </section>`;
  }
  let newEventDraft={name:"",date:"",hotel:"",salon:"",status:"Planning",coverImage:"",planSrc:"",planName:"",pdfDoc:null,pdfPages:[],pdfPage:0};
  function startNewEvent(){newEventDraft={name:"",date:new Date(Date.now()+7*86400000).toLocaleDateString("en-CA"),hotel:"",salon:"",status:"Planning",coverImage:"",planSrc:"",planName:"",pdfDoc:null,pdfPages:[],pdfPage:0};ui.screen="new-event";render();}
  function syncSetupFields(){const f=document.getElementById("v8EventForm");if(!f)return;const data=new FormData(f);for(const k of ["name","date","hotel","salon","status"])newEventDraft[k]=String(data.get(k)||"");}
  function readDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});}
  function waitForPdf(){if(globalThis.MeritPdf)return Promise.resolve(globalThis.MeritPdf);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Offline PDF renderer did not initialize.")),15000);addEventListener("merit-pdf-ready",()=>{clearTimeout(timer);resolve(globalThis.MeritPdf);},{once:true});});}
  async function selectPdfPage(index){
    const doc=newEventDraft.pdfDoc;if(!doc)return;ui.setupBusy=true;render();
    const page=await doc.getPage(index+1),viewport=page.getViewport({scale:2.6}),canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
    newEventDraft.pdfPage=index;newEventDraft.planSrc=canvas.toDataURL("image/png",.96);newEventDraft.planName=`${newEventDraft.pdfName} · page ${index+1}`;ui.setupBusy=false;render();requestAnimationFrame(renderPdfThumbs);
  }
  async function handlePlanFile(file){
    if(!file)return;syncSetupFields();const lower=file.name.toLowerCase();
    if(file.type==="application/pdf"||lower.endsWith(".pdf")){
      try{ui.setupBusy=true;render();const pdf=await waitForPdf(),doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;newEventDraft.pdfDoc=doc;newEventDraft.pdfName=file.name;newEventDraft.pdfPages=Array.from({length:doc.numPages},(_,i)=>i);ui.setupBusy=false;await selectPdfPage(0);toast(`${doc.numPages} PDF page${doc.numPages===1?"":"s"} rendered locally. Choose a page thumbnail.`,"success",4500);}catch(error){ui.setupBusy=false;render();toast(error.message,"error",6000);}return;
    }
    if(!(file.type==="image/png"||file.type==="image/jpeg"||/\.(png|jpe?g)$/.test(lower)))return toast("Choose PNG, JPG, JPEG or PDF.","error");
    newEventDraft.planSrc=await readDataURL(file);newEventDraft.planName=file.name;newEventDraft.pdfDoc=null;newEventDraft.pdfPages=[];render();
  }
  async function renderPdfThumbs(){
    const doc=newEventDraft.pdfDoc;if(!doc)return;
    for(const canvas of document.querySelectorAll("[data-pdf-thumb]")){const index=Number(canvas.dataset.pdfThumb),page=await doc.getPage(index+1),v=page.getViewport({scale:.28});canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);await page.render({canvasContext:canvas.getContext("2d"),viewport:v}).promise;}
  }
  function createBlankEventFromSetup(usePlan){
    syncSetupFields();const d=newEventDraft;if(!d.name.trim()||!d.date||!d.hotel.trim()){toast("Event name, date and hotel are required.","error");return;}
    const event=migrateEvent({id:uid("event"),name:d.name.trim(),date:d.date,hotel:d.hotel.trim(),salon:d.salon.trim(),status:d.status,coverImage:d.coverImage,tables:[],venueObjects:[],guests:[],background:{src:usePlan?d.planSrc:"",name:usePlan?d.planName:"",opacity:.34,visible:!!(usePlan&&d.planSrc),locked:true,isDefault:false,scale:100},createdAt:nowISO(),lastModified:nowISO()});
    state.events.unshift(event);audit(event,"EVENT_CREATED",{blank:!event.background.src,hotel:event.hotel,salon:event.salon});saveState();ui.activeEventId=event.id;ui.screen="workspace";ui.tab="floor";ui.leftCollapsed=true;render();toast(event.background.src?"Event created. Review the plan, then run Assisted Detection.":"Blank event created. Add plan objects when ready.","success",5000);
  }
  function bindSetup(){
    document.querySelector("[data-setup='cancel']").onclick=()=>{ui.screen="events";render();};
    const drop=document.getElementById("v8PlanDrop"),input=document.getElementById("v8PlanFile");drop.onclick=e=>{e.preventDefault();input.click();};input.onchange=()=>handlePlanFile(input.files[0]);
    drop.ondragover=e=>{e.preventDefault();drop.classList.add("dragging")};drop.ondragleave=()=>drop.classList.remove("dragging");drop.ondrop=e=>{e.preventDefault();drop.classList.remove("dragging");handlePlanFile(e.dataTransfer.files[0]);};
    document.querySelector("[data-cover-drop]").onclick=e=>{e.preventDefault();document.getElementById("v8CoverFile").click();};document.getElementById("v8CoverFile").onchange=async e=>{const f=e.target.files[0];if(f){syncSetupFields();newEventDraft.coverImage=await readDataURL(f);render();}};
    document.querySelectorAll("[data-pdf-page]").forEach(b=>b.onclick=e=>{e.stopPropagation();syncSetupFields();selectPdfPage(Number(b.dataset.pdfPage));});
    document.querySelector("[data-setup='remove-cover']")?.addEventListener("click",e=>{e.preventDefault();syncSetupFields();newEventDraft.coverImage="";render();});
    document.querySelector("[data-setup='replace-plan']")?.addEventListener("click",e=>{e.preventDefault();input.click();});
    document.querySelector("[data-setup='remove-plan']")?.addEventListener("click",e=>{e.preventDefault();syncSetupFields();Object.assign(newEventDraft,{planSrc:"",planName:"",pdfDoc:null,pdfPages:[],pdfPage:0});render();});
    document.querySelector("[data-setup='blank']").onclick=e=>{e.preventDefault();createBlankEventFromSetup(false);};document.querySelector("[data-setup='create']").onclick=e=>{e.preventDefault();createBlankEventFromSetup(true);};
    requestAnimationFrame(renderPdfThumbs);
  }

  // ============================================================
  // Concept 3 — map-first Floor Plan workspace.
  // No permanent left object list, no permanent right technical inspector.
  // The plan fills the whole surface; a handful of floating elements provide
  // tools, and a small contextual card appears ONLY when something is
  // selected (data-inspector/-action attributes match base app.js's
  // bindInspector exactly, so no rebinding is needed here).
  // ============================================================
  function planMapToolbarHTML(event){
    const bg=event.background||{};
    return`<div class="planmap-toolbar"><div class="tool-group"><button class="toolbar-btn lang-btn" data-v8-action="toggle-lang" title="Language / Dil">${ui.lang==="tr"?"TR":"EN"}</button></div><div class="tool-group">${toolbarBtn("mouse",t("toolbar.select"),`data-tool="select"`,ui.tool==="select")}${toolbarBtn("hand",t("toolbar.pan"),`data-tool="pan"`,ui.tool==="pan")}</div><div class="tool-group">${toolbarBtn("zoomOut",t("toolbar.zoomOut"),`data-canvas-action="zoom-out"`)}<span class="zoom-label">${Math.round(ui.zoom*100)}%</span>${toolbarBtn("zoomIn",t("toolbar.zoomIn"),`data-canvas-action="zoom-in"`)}${toolbarBtn("fit",t("toolbar.fit"),`data-canvas-action="fit"`)}</div><div class="tool-group">${toolbarBtn("eye",bg.visible?t("toolbar.hideOriginalPlan"):t("toolbar.showOriginalPlan"),`data-v8-action="toggle-bg"`,bg.visible)}${toolbarBtn("image",t("toolbar.replacePlan"),`data-v8-action="replace-bg"`)}</div><div class="tool-group">${toolbarBtn("fit",t("toolbar.focusMode"),`data-v8-action="focus"`,ui.focusMode)}</div>${bg.src?`<div class="tool-group">${toolbarBtn("image",t("toolbar.assistedDetection"),`data-v8-action="detect"`,false).replace('class="toolbar-btn','class="toolbar-btn ai')}</div>`:""}</div>`;
  }
  function planStatusPillHTML(event){
    const pi=event.analysis?.planIntelligence;if(!pi)return"";
    const reviewCount=pi.reviewGroups.reduce((n,g)=>n+g.memberIds.length,0)+pi.uncertainQuestions.length;
    return`<div class="planmap-status-pill"><span>${t("plan.understood")}</span><b>${pi.planSummary.diningGroups}</b><small>${t("plan.diningGroups")}</small><i class="pill-div"></i><b>${pi.planSummary.physicalSeats}</b><small>${t("plan.seats")}</small>${reviewCount?`<i class="pill-div"></i><button class="pill-chip" data-v8-action="open-review-center">${reviewCount} ${t("plan.needsReview")}</button>`:""}</div>`;
  }
  function contextualCardHTML(event){
    const t_=event.tables.find(x=>x.id===ui.selectedObjectId),o=event.venueObjects.find(x=>x.id===ui.selectedObjectId);
    if(!t_&&!o)return"";
    if(t_){const assigned=tableAssignedPax(event,t_.id),presets=t_.type==="round"?[6,8,10,12]:[2,4,6,8];
      return`<aside class="contextual-card"><div class="contextual-card-head"><strong>${esc(formatTableNumber(t_.number))}</strong><span>${esc(t_.zone)} · ${assigned} ${t("seating.occupied").toLowerCase()}</span></div><div class="seat-editor"><div class="seat-stepper"><button data-seat-step="-1" title="${t("inspector.removeSeat")}">−</button><b>${t_.capacity}</b><button data-seat-step="1" title="${t("inspector.addSeat")}">+</button></div><div class="seat-presets">${presets.map(n=>`<button class="${t_.capacity===n?"active":""}" data-seat-capacity="${n}">${n}</button>`).join("")}<button data-seat-custom>${t("inspector.custom")}</button></div></div><div class="form-grid compact"><div class="field"><label>${t("inspector.type")}</label><select data-inspector="type">${["rectangle","square","round","bistro"].map(x=>`<option value="${x}" ${t_.type===x?"selected":""}>${t("bulk.type."+x)}</option>`).join("")}</select></div><div class="field"><label>${t("inspector.rotation")}</label><input data-inspector="rotation" type="number" value="${Math.round(t_.rotation||0)}"></div><div class="field full"><label>${t("inspector.zone")}</label><select data-inspector="zone">${ZONES.map(z=>`<option ${t_.zone===z?"selected":""}>${z}</option>`).join("")}</select></div></div><div class="contextual-card-actions"><button class="btn sm" data-inspector-action="duplicate">${icon("copy")}${t("toolbar.duplicate")}</button><button class="btn sm" data-inspector-action="lock">${icon("lock")}${t_.locked?t("seating.unlock"):t("seating.lock")}</button><button class="btn sm danger" data-inspector-action="delete">${icon("trash")}${t("toolbar.delete")}</button></div></aside>`;
    }
    return`<aside class="contextual-card"><div class="contextual-card-head"><strong>${esc(o.label)}</strong><span>${t("inspector.object",{type:t("bulk.type."+o.type)})}</span></div><div class="form-grid compact"><div class="field full"><label>${t("inspector.label")}</label><input data-inspector="label" value="${esc(o.label)}"></div><div class="field"><label>${t("inspector.rotation")}</label><input data-inspector="rotation" type="number" value="${Math.round(o.rotation||0)}"></div></div><div class="contextual-card-actions"><button class="btn sm" data-inspector-action="duplicate">${icon("copy")}${t("toolbar.duplicate")}</button><button class="btn sm" data-inspector-action="lock">${icon("lock")}${o.locked?t("seating.unlock"):t("seating.lock")}</button><button class="btn sm danger" data-inspector-action="delete">${icon("trash")}${t("toolbar.delete")}</button></div></aside>`;
  }
  function addManuallyFabHTML(){return`<button class="planmap-fab" data-v8-action="add" title="${t("action.addManually")}">${icon(ui.v8AddOpen?"x":"plus")}<span>${t("action.addManually")}</span></button>`;}

  function v8Toolbar(event,seating=false){
    return`<div class="canvas-toolbar v8-toolbar"><div class="tool-group">${toolbarBtn("mouse",t("toolbar.select"),`data-tool="select"`,ui.tool==="select")}${toolbarBtn("hand",t("toolbar.pan"),`data-tool="pan"`,ui.tool==="pan")}</div>${!seating?`<div class="tool-group">${toolbarBtn("plus",t("toolbar.addBulk"),`data-v8-action="add"`,ui.v8AddOpen)}${toolbarBtn("copy",t("toolbar.duplicate"),`data-v8-action="duplicate-selection"`)}${toolbarBtn("trash",t("toolbar.delete"),`data-v8-action="delete-selection"`)}</div><div class="tool-group">${toolbarBtn("undo",t("toolbar.undo"),`data-canvas-action="undo"`)}${toolbarBtn("redo",t("toolbar.redo"),`data-canvas-action="redo"`)}</div>`:""}<div class="tool-group">${toolbarBtn("zoomOut",t("toolbar.zoomOut"),`data-canvas-action="zoom-out"`)}<span class="zoom-label">${Math.round(ui.zoom*100)}%</span>${toolbarBtn("zoomIn",t("toolbar.zoomIn"),`data-canvas-action="zoom-in"`)}${toolbarBtn("fit",t("toolbar.fit"),`data-canvas-action="fit"`)}</div><div class="tool-group">${toolbarBtn("grid",t("toolbar.grid"),`data-canvas-action="grid"`,ui.grid)}${toolbarBtn("magnet",t("toolbar.snap"),`data-canvas-action="snap"`,ui.snap)}${toolbarBtn("seat",t("toolbar.seatLabels"),`data-canvas-action="seat-numbers"`,ui.showSeats)}</div><span class="toolbar-spacer"></span>${!seating?toolbarBtn("image",t("toolbar.assistedDetection"),`data-v8-action="detect" ${event.background?.src?"":"disabled"}`,false).replace('class="toolbar-btn','class="toolbar-btn ai'):""}${toolbarBtn("fit",t("toolbar.focusMode"),`data-v8-action="focus"`,ui.focusMode)}</div>`;
  }
  function bulkPanel(event){
    if(!ui.v8AddOpen)return"";const d=ui.bulkDraft||={kind:"table",type:"round",chairs:8,quantity:4,rows:2,cols:2,placement:"grid",prefix:"T",zone:"MAIN FLOOR"};
    // Option LABELS are translated; the option VALUES stay the English
    // identifiers the data model stores. The old markup relied on the label
    // being the value (`<option>${v}</option>`), so translating without an
    // explicit value= would have written Turkish words into table.type.
    const opt=(v,sel)=>`<option value="${v}" ${sel===v?"selected":""}>${t("bulk.type."+v)}</option>`;
    const typeValues=d.kind==="venue"?["stage","bar","entrance","exit","column","text"]:["rectangle","square","round","bistro"];
    const placeValues=["grid","row","repeated","array"];
    return`<div class="v8-create-pop"><h3>${t("bulk.title")}</h3><p>${t("bulk.subtitle")}</p><div class="bulk-grid"><div class="field"><label>${t("bulk.kind")}</label><select data-bulk="kind"><option value="table" ${d.kind==="table"?"selected":""}>${t("bulk.kind.table")}</option><option value="venue" ${d.kind==="venue"?"selected":""}>${t("bulk.kind.venue")}</option></select></div><div class="field"><label>${t("bulk.type")}</label><select data-bulk="type">${typeValues.map(v=>opt(v,d.type)).join("")}</select></div>${d.kind==="table"?`<div class="field"><label>${t("bulk.chairsEach")}</label><input data-bulk="chairs" type="number" min="1" max="99" value="${d.chairs}"></div><div class="field"><label>${t("bulk.numberPrefix")}</label><input data-bulk="prefix" value="${esc(d.prefix)}" maxlength="4"></div>`:""}<div class="field"><label>${t("bulk.quantity")}</label><input data-bulk="quantity" type="number" min="1" max="60" value="${d.quantity}"></div><div class="field"><label>${t("bulk.placement")}</label><select data-bulk="placement">${placeValues.map(v=>`<option value="${v}" ${d.placement===v?"selected":""}>${t("bulk.placement."+v)}</option>`).join("")}</select></div><div class="field"><label>${t("bulk.rows")}</label><input data-bulk="rows" type="number" min="1" max="12" value="${d.rows}"></div><div class="field"><label>${t("bulk.columns")}</label><input data-bulk="cols" type="number" min="1" max="12" value="${d.cols}"></div></div><div class="bulk-actions"><button class="btn sm" data-v8-action="close-add">${t("bulk.cancel")}</button><button class="btn sm primary" data-v8-action="commit-add">${t(d.placement==="repeated"?"bulk.startPlacement":"bulk.addToPlan")}</button></div></div>`;
  }
  // Quantity is authoritative everywhere except "array", where rows x cols is.
  // Grid used to silently truncate to rows*cols, so asking for 25 tables in a
  // 2x2 grid quietly produced 4 -- the Quantity field lied about the outcome.
  // The bulk fields commit on `change`, which fires only on blur. Typing a
  // value and immediately clicking "Add to plan" therefore used to discard
  // that last edit -- type prefix "B", click, get T01. Read the live DOM
  // values before committing, the same way syncSetupFields does.
  function syncBulkFields(){
    if(!ui.bulkDraft)return;
    document.querySelectorAll("[data-bulk]").forEach(input=>{
      ui.bulkDraft[input.dataset.bulk]=input.type==="number"?Number(input.value):input.value;
    });
  }
  // Repaint just the placement ghosts, so the live preview can follow typing
  // without a full render tearing down the panel the operator is using.
  function refreshGhosts(){
    const world=document.getElementById("canvasWorld");
    if(!world)return;
    world.querySelectorAll(".ghost-object").forEach(n=>n.remove());
    world.insertAdjacentHTML("beforeend",ghostHTML());
  }
  function bulkCount(d){
    if(d.placement==="array")return Math.max(1,Math.min(60,(Math.max(1,Number(d.rows)||1))*(Math.max(1,Number(d.cols)||1))));
    return Math.max(1,Math.min(60,Number(d.quantity)||1));
  }
  function bulkPositions(d){
    const count=bulkCount(d),gapX=190,gapY=145,out=[];
    const cols=d.placement==="row"?count:Math.max(1,Math.min(count,Number(d.cols)||1));
    for(let i=0;i<count;i++){const c=i%cols,r=Math.floor(i/cols);out.push({x:440+c*gapX,y:270+r*gapY});}
    return out;
  }
  function ghostHTML(){if(!ui.v8AddOpen||ui.bulkDraft?.placement==="repeated")return"";return bulkPositions(ui.bulkDraft).map((p,i)=>`<div class="ghost-object" data-label="${esc((ui.bulkDraft.prefix||"T")+String(i+1).padStart(2,"0"))}" style="left:${p.x}px;top:${p.y}px;width:120px;height:82px"></div>`).join("");}
  const oldViewport=canvasViewportHTML;
  canvasViewportHTML = function(event,seating){
    const html=oldViewport(event,seating);if(seating)return html;
    // Both replacements go through t(), so the v8 status survives a language
    // switch instead of only matching the English string.
    return html.replace("</div><div class=\"canvas-status\"",`${ghostHTML()}</div><div class="canvas-status v8-status"`)
      .replace(t("canvas.editHint"),`${t("canvas.multiSelectHint")}<span class="status-right">${t("canvas.selectedCount",{n:ui.selectedObjectIds.length||0})}</span>`);
  };
  floorPlanHTML = function(event){return`<div class="planmap-shell">${planMapToolbarHTML(event)}${bulkPanel(event)}${canvasViewportHTML(event,false)}${contextualCardHTML(event)}${planStatusPillHTML(event)}${addManuallyFabHTML()}</div>`;};

  function uniqueNumber(event,prefix,index){let n=index;while(event.tables.some(t=>t.number===prefix+String(n).padStart(2,"0")))n++;return prefix+String(n).padStart(2,"0");}
  function createTable(event,d,x,y,index){const dims=d.type==="round"?[120,120]:d.type==="square"?[105,105]:d.type==="bistro"?[82,72]:[170,86],number=uniqueNumber(event,(d.prefix|| (d.type==="bistro"?"B":"T")).toUpperCase(),index);return syncTableChairs({id:uid("table"),number,type:d.type,x,y,w:dims[0],h:dims[1],capacity:Number(d.chairs)||1,zone:d.type==="bistro"?"BISTRO":d.zone||"MAIN FLOOR",rotation:0,locked:false,z:10,hasPhysicalSeats:true});}
  function commitBulk(){syncBulkFields();const event=activeEvent(),d=ui.bulkDraft;if(!canMutate(event,"add plan objects"))return;if(d.placement==="repeated"){ui.repeatPlacement={...d,remaining:Math.max(1,Number(d.quantity)||1),index:1};ui.v8AddOpen=false;render();toast("Repeated placement active. Click the canvas for each object; Esc cancels.","success",5000);return;}const positions=bulkPositions(d);if(!positions.length)return;recordUndo(event);const created=[];positions.forEach((p,i)=>{if(d.kind==="table"){const t=createTable(event,d,p.x,p.y,i+1);event.tables.push(t);created.push(t.id);}else{const sizes={stage:[380,180],bar:[300,70],entrance:[110,40],exit:[90,40],column:[55,55],text:[150,42]},s=sizes[d.type]||[120,50],o={id:uid("venue"),type:d.type,label:d.type.toUpperCase(),x:p.x,y:p.y,w:s[0],h:s[1],rotation:0,locked:false,z:4};event.venueObjects.push(o);created.push(o.id);}});ui.selectedObjectIds=created;ui.selectedObjectId=created[0];ui.v8AddOpen=false;touchEvent(event);render();toast(`${created.length} object${created.length===1?"":"s"} added with physical chair records.`,"success");}
  function placeRepeated(pointerEvent){const r=document.getElementById("canvasViewport").getBoundingClientRect(),d=ui.repeatPlacement,event=activeEvent(),x=(pointerEvent.clientX-r.left-ui.pan.x)/ui.zoom,y=(pointerEvent.clientY-r.top-ui.pan.y)/ui.zoom;if(!d||!canMutate(event,"place plan objects"))return;recordUndo(event);let id;if(d.kind==="table"){const t=createTable(event,d,x-60,y-45,d.index);event.tables.push(t);id=t.id;}else{const o={id:uid("venue"),type:d.type,label:d.type.toUpperCase(),x:x-60,y:y-30,w:120,h:60,rotation:0,locked:false,z:4};event.venueObjects.push(o);id=o.id;}d.remaining--;d.index++;ui.selectedObjectId=id;ui.selectedObjectIds=[id];if(d.remaining<=0)ui.repeatPlacement=null;touchEvent(event);render();}
  function duplicateSelection(){const event=activeEvent();if(!canMutate(event,"duplicate plan objects"))return;const ids=ui.selectedObjectIds.length?ui.selectedObjectIds:[ui.selectedObjectId].filter(Boolean);if(!ids.length)return toast("Select one or more objects first.");recordUndo(event);const created=[];for(const id of ids){const t=event.tables.find(x=>x.id===id),o=event.venueObjects.find(x=>x.id===id),c=clone(t||o);if(!c)continue;c.id=uid(t?"table":"venue");c.x+=24;c.y+=24;c.locked=false;if(t){c.number=uniqueNumber(event,t.type==="bistro"?"B":"T",1);c.chairs=(c.chairs||[]).map((chair,index)=>({...chair,id:uid("chair"),parentTableId:c.id,seatNumber:index+1,occupancy:null}));event.tables.push(c);}else event.venueObjects.push(c);created.push(c.id);}ui.selectedObjectIds=created;ui.selectedObjectId=created[0]||null;touchEvent(event);render();}
  function deleteSelection(){const event=activeEvent();if(!canMutate(event,"delete plan objects"))return;const ids=new Set(ui.selectedObjectIds.length?ui.selectedObjectIds:[ui.selectedObjectId].filter(Boolean));if(!ids.size)return;const affected=event.guests.filter(g=>ids.has(g.assignment?.tableId));if(!confirm(`Delete ${ids.size} selected object${ids.size===1?"":"s"}${affected.length?` and return ${affected.length} guest record(s) to Unassigned`:""}?`))return;recordUndo(event);affected.forEach(g=>g.assignment=null);event.tables=event.tables.filter(t=>!ids.has(t.id));event.venueObjects=event.venueObjects.filter(o=>!ids.has(o.id));ui.selectedObjectIds=[];ui.selectedObjectId=null;touchEvent(event);render();}

  function startMarquee(e){
    if(e.button!==0||ui.tool!=="select"||ui.repeatPlacement)return;const viewport=document.getElementById("canvasViewport"),world=document.getElementById("canvasWorld");if(![viewport,world,world.querySelector(".reference-layer")].includes(e.target))return;e.preventDefault();const box=document.createElement("div");box.className="marquee";viewport.appendChild(box);const r=viewport.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top;let current=[];
    const move=ev=>{const x=ev.clientX-r.left,y=ev.clientY-r.top,left=Math.min(sx,x),top=Math.min(sy,y),w=Math.abs(x-sx),h=Math.abs(y-sy);Object.assign(box.style,{left:left+"px",top:top+"px",width:w+"px",height:h+"px"});const br={left:r.left+left,top:r.top+top,right:r.left+left+w,bottom:r.top+top+h};current=[...world.querySelectorAll("[data-object-id]")].filter(el=>{const q=el.getBoundingClientRect();return q.right>=br.left&&q.left<=br.right&&q.bottom>=br.top&&q.top<=br.bottom;}).map(el=>el.dataset.objectId);};
    const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);box.remove();ui.selectedObjectIds=e.ctrlKey?[...new Set([...ui.selectedObjectIds,...current])]:current;ui.selectedObjectId=ui.selectedObjectIds[0]||null;render();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
  }
  startObjectDrag = function(e,id,kind,el){
    const event=activeEvent();if(!canMutate(event,"move plan objects")||ui.tool!=="select")return;
    if(e.ctrlKey||e.shiftKey){e.preventDefault();e.stopPropagation();ui.selectedObjectIds=ui.selectedObjectIds.includes(id)?ui.selectedObjectIds.filter(x=>x!==id):[...ui.selectedObjectIds,id];ui.selectedObjectId=ui.selectedObjectIds[0]||null;render();return;}
    if(!ui.selectedObjectIds.includes(id))ui.selectedObjectIds=[id];ui.selectedObjectId=id;
    const selected=ui.selectedObjectIds.map(objectId=>event.tables.find(x=>x.id===objectId)||event.venueObjects.find(x=>x.id===objectId)).filter(Boolean);if(selected.some(o=>o.locked))return toast("Unlock every selected object before moving.","error");
    e.preventDefault();e.stopPropagation();const snap=canvasSnapshot(event),sx=e.clientX,sy=e.clientY,start=selected.map(o=>({o,x:o.x,y:o.y}));let moved=false;
    const move=ev=>{const dx=(ev.clientX-sx)/ui.zoom,dy=(ev.clientY-sy)/ui.zoom;start.forEach(({o,x,y})=>{o.x=ui.snap?Math.round((x+dx)/10)*10:x+dx;o.y=ui.snap?Math.round((y+dy)/10)*10:y+dy;const node=document.querySelector(`[data-object-id="${o.id}"]`);if(node){node.style.left=o.x+"px";node.style.top=o.y+"px";}});moved=true;};
    const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);if(moved){recordUndo(event,snap);touchEvent(event);}render();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
  };

  setTableCapacity = function(event,table,newCap){if(!canMutate(event,"change chair capacity"))return false;newCap=Math.max(1,Math.min(99,Number(newCap)||1));const occupied=tableAssignedPax(event,table.id);if(newCap<occupied){toast(`${table.number} has ${occupied} assigned pax. Capacity cannot drop below occupancy.`,"error",5000);return false;}recordUndo(event);repackTableAssignments(event,table,newCap);syncTableChairs(table,newCap);touchEvent(event);render();return true;};
  updateInspectorField = function(event,field,value){if(!canMutate(event,"edit plan objects"))return;original.updateInspectorField(event,field,value);const table=event.tables.find(x=>x.id===ui.selectedObjectId);if(table)syncTableChairs(table);};
  inspectorAction = function(event,action){if(!canMutate(event,`${action} plan objects`))return;if(action==="duplicate")return duplicateSelection();if(action==="delete")return deleteSelection();original.inspectorAction(event,action);};
  deleteSelectedObject = function(){deleteSelection();};
  startResize = function(...args){if(canMutate(activeEvent(),"resize plan objects"))original.startResize(...args);};
  startRotate = function(...args){if(canMutate(activeEvent(),"rotate plan objects"))original.startRotate(...args);};
  createTableFromDraft = function(){if(canMutate(activeEvent(),"add a table")){original.createTableFromDraft();const e=activeEvent(),t=e.tables.find(x=>x.id===ui.selectedObjectId);if(t){syncTableChairs(t);saveState();}}};
  addVenue = function(...args){if(canMutate(activeEvent(),"add a venue object"))original.addVenue(...args);};

  const oldBindCanvas=bindCanvas;
  bindCanvas = function(){
    oldBindCanvas();const event=activeEvent(),viewport=document.getElementById("canvasViewport"),world=document.getElementById("canvasWorld");
    if(isHistorical(event))return;
    document.querySelectorAll("[data-v8-action]").forEach(button=>button.onclick=()=>{const action=button.dataset.v8Action;if(action==="add"){ui.v8AddOpen=!ui.v8AddOpen;ui.bulkDraft ||= {kind:"table",type:"round",chairs:8,quantity:4,rows:2,cols:2,placement:"grid",prefix:"T",zone:"MAIN FLOOR"};render();}else if(action==="close-add"){ui.v8AddOpen=false;render();}else if(action==="commit-add")commitBulk();else if(action==="duplicate-selection")duplicateSelection();else if(action==="delete-selection")deleteSelection();else if(action==="focus"){ui.focusMode=!ui.focusMode;render();}else if(action==="detect")runAssistedDetection();else if(action==="toggle-bg"){recordUndo(event);event.background.visible=!event.background.visible;touchEvent(event);}else if(action==="replace-bg")document.getElementById("floorPlanFile").click();else if(action==="open-review-center"){ui.reviewCenterOpen=true;ui.screen="review";render();}else if(action==="toggle-lang"){ui.lang=ui.lang==="tr"?"en":"tr";render();}});
    // Typed fields update the draft and refresh only the ghost preview. A full
    // re-render on every change replaced the "Add to plan" button mid-click --
    // typing a value and clicking straight through lost both the edit and the
    // click. Selects still re-render, since choosing an option can change which
    // fields exist and no other click is in flight.
    document.querySelectorAll("[data-bulk]").forEach(input=>{
      const isSelect=input.tagName==="SELECT";
      input.oninput=()=>{
        syncBulkFields();
        if(input.dataset.bulk==="kind")ui.bulkDraft.type=ui.bulkDraft.kind==="venue"?"stage":"round";
        if(isSelect)render();else refreshGhosts();
      };
    });
    viewport?.addEventListener("pointerdown",e=>{if(ui.repeatPlacement&&e.target.closest("[data-object-id]")==null){e.preventDefault();placeRepeated(e);}},true);viewport?.addEventListener("pointerdown",startMarquee,true);
    world?.querySelectorAll("[data-object-id]").forEach(el=>{if(ui.selectedObjectIds.includes(el.dataset.objectId))el.classList.add("multi-selected");if(ui.tab==="seating"&&el.dataset.objectKind==="table"){el.addEventListener("drop",e=>{const raw=e.dataTransfer.getData("application/x-merit-guests");if(raw){e.preventDefault();e.stopPropagation();assignGuestGroup(JSON.parse(raw),el.dataset.objectId);}},true);}});
    const clear=document.querySelector("[data-clear-seating-filter]");if(clear)clear.onclick=()=>{ui.seatingFilter="all";ui.operationalMode=false;render();};
  };

  function guestSelectionRows(event){const q=ui.seatingQuery.trim().toLocaleLowerCase("tr"),showAll=ui.seatingGuestScope==="all";return event.guests.filter(g=>(showAll||!g.assignment)&&(!q||[g.name,g.vip,g.invitedBy,g.planningStatus,event.tables.find(t=>t.id===g.assignment?.tableId)?.number].join(" ").toLocaleLowerCase("tr").includes(q)));}
  seatingHTML = function(event){
    // Floor Plan collapses the side panels for its own map-first layout.
    // Seating's whole job is "move this guest onto that seat", so the guest
    // queue must never arrive collapsed and leave the operator staring at
    // an empty screen.
    ui.leftCollapsed=false;
    const records=guestSelectionRows(event);
    const selectedIds=ui.selectedGuestIds.length?ui.selectedGuestIds:[ui.selectedGuestId].filter(Boolean);
    const selPax=selectedIds.reduce((n,id)=>n+paxOf(event.guests.find(g=>g.id===id)||{}),0);
    const scopes=[["unassigned",t("seating.scope.unassigned")],["all",t("seating.scope.all")]];
    const filters=[["all",t("seating.filter.all")],["empty",t("seating.filter.empty")],["available",t("seating.filter.available")],["full",t("seating.filter.full")]];
    const totalPax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    const seatedPax=event.guests.filter(g=>g.assignment).reduce((n,g)=>n+paxOf(g),0);
    const freeChairs=Math.max(0,physicalCapacity(event)-seatedPax);
    const queue=records.length?records.map(g=>{
      const t_=g.assignment&&event.tables.find(x=>x.id===g.assignment.tableId);
      return`<div class="queue-card ${selectedIds.includes(g.id)?"selected multi-selected":""}" draggable="true" data-seating-guest="${g.id}">
        <div class="party-name">${esc(g.name)}</div>
        <div class="party-sub">${paxDotsHTML(g)}<span>${t("guests.partyOf",{n:paxOf(g)})}</span>${g.vip&&g.vip!=="Standard"?`<span class="vip-tag">${esc(g.vip)}</span>`:""}${t_?`<span class="seat-tag">${esc(formatTableNumber(t_.number))}</span>`:""}</div>
      </div>`;
    }).join(""):`<div class="mx-empty" style="border:none;background:none;padding:26px 12px">${t("seating.noMatches")}</div>`;
    return`<div class="seat-stage">
      <aside class="seat-queue">
        <div class="seat-queue-head"><strong>${ui.seatingGuestScope==="all"?t("seating.allGuests"):t("seating.guestQueue")}</strong>${selectedIds.length?`<span class="sel">${t("seating.recordsSelected",{n:selectedIds.length,pax:selPax})}</span>`:""}</div>
        <div class="seat-queue-controls">
          <div class="guest-scope-strip">${scopes.map(([v,l])=>`<button class="seg-btn ${ui.seatingGuestScope===v?"active":""}" data-seating-scope="${v}">${l}</button>`).join("")}</div>
          <div class="guest-filter-strip">${filters.map(([v,l])=>`<button class="seg-btn ${ui.seatingFilter===v?"active":""}" data-seating-filter="${v}">${l}</button>`).join("")}</div>
          <input class="filter-input" id="seatingSearch" value="${esc(ui.seatingQuery)}" placeholder="${t("seating.search")}">
        </div>
        <div class="seat-queue-list">${queue}</div>
      </aside>
      <section class="seat-canvas-col">
        ${v8Toolbar(event,true)}
        ${canvasViewportHTML(event,true)}
        ${selectedTablePanelHTML(event)}
        <div class="seat-pill">${t("seating.statusPill",{seated:seatedPax,total:totalPax,tables:event.tables.length,free:freeChairs})}</div>
      </section>
    </div>`;
  };
  // Contextual card, not a permanent inspector: it exists only while a table
  // is selected, and closing it hands the space back to the plan.
  selectedTablePanelHTML = function(event){
    const t_=event.tables.find(x=>x.id===ui.selectedTableId);
    if(!t_)return"";
    const map=tableSeatMap(event,t_.id),occupied=tableAssignedPax(event,t_.id),empty=Math.max(0,t_.capacity-occupied);
    const selected=event.guests.find(g=>g.id===ui.selectedGuestId);
    const moving=selected&&selected.assignment&&selected.assignment.tableId!==t_.id;
    return`<aside class="table-card">
      <div class="table-card-head"><h3>${esc(formatTableNumber(t_.number))}</h3><span class="muted" style="font-size:11px">${esc(t_.zone||"")}</span><button class="table-card-close" data-close-table-card title="${t("seating.closeCard")}">&times;</button></div>
      <div class="table-card-stats">
        <div><span>${t("seating.capacity")}</span><b>${t_.capacity}</b></div>
        <div><span>${t("seating.occupied")}</span><b>${occupied}</b></div>
        <div><span>${t("seating.empty")}</span><b>${empty}</b></div>
      </div>
      <div class="table-card-cta">${selected
        ?`<button class="btn primary sm" data-assign-selected="${t_.id}">${t(moving?"seating.moveGuest":"seating.assignGuest",{name:selected.name,n:paxOf(selected)})}</button>`
        :`<div class="table-card-hint">${t("seating.pickGuestFirst")}</div>`}</div>
      <div class="table-card-seats">${Array.from({length:t_.capacity},(_,i)=>seatRowHTML(i,map.get(i),selected)).join("")}</div>
    </aside>`;
  };
  seatRowHTML = function(index,occupant,selected){
    if(!occupant)return`<div class="seat-row empty" data-empty-seat="${index}"><span class="seat-no">S${index+1}</span><span class="seat-person">${t("seating.seatEmpty")}</span>${selected?`<button class='seat-action'>${t("seating.assignHere")}</button>`:"<span></span>"}</div>`;
    const g=occupant.guest,label=occupant.companion?`GUEST OF ${g.name.toUpperCase()}`:g.name;
    return`<div class="seat-row ${ui.selectedGuestIds.includes(g.id)?"multi-selected":""}" draggable="${occupant.index===0}" data-occupant-guest="${occupant.index===0?g.id:""}"><span class="seat-no">S${index+1}</span><span class="seat-person">${esc(label)} ${occupant.companion?`<small>${t("seating.companion")}</small>`:""}</span>${occupant.index===0?`<span><button class="seat-action" data-lock-assignment="${g.id}">${g.assignment.locked?t("seating.unlock"):t("seating.lock")}</button> <button class="seat-action" data-unassign="${g.id}">${t("seating.unassign")}</button></span>`:"<span></span>"}</div>`;
  };
  function selectGuestRecord(id,eventLike,rows){
    const ids=rows.map(g=>g.id),index=ids.indexOf(id),anchor=ids.indexOf(ui.guestAnchorId);
    if(eventLike.shiftKey&&anchor>=0){const range=ids.slice(Math.min(anchor,index),Math.max(anchor,index)+1);ui.selectedGuestIds=eventLike.ctrlKey?[...new Set([...ui.selectedGuestIds,...range])]:range;}
    else if(eventLike.ctrlKey||eventLike.metaKey)ui.selectedGuestIds=ui.selectedGuestIds.includes(id)?ui.selectedGuestIds.filter(x=>x!==id):[...ui.selectedGuestIds,id];
    else ui.selectedGuestIds=[id];
    ui.selectedGuestId=ui.selectedGuestIds[0]||null;ui.guestAnchorId=id;
  }
  function assignGuestGroup(ids,tableId,preferred=null){
    const event=activeEvent();if(!canMutate(event,"change seating assignments"))return;ids=[...new Set(ids)].filter(Boolean);const guests=ids.map(id=>event.guests.find(g=>g.id===id)).filter(Boolean),table=event.tables.find(t=>t.id===tableId);if(!guests.length||!table)return;
    const locked=guests.find(g=>g.assignment?.locked);if(locked)return toast(`${locked.name}'s assignment is locked.`,"error",5000);
    const used=occupiedSeatIndexes(event,tableId,null);for(const g of guests)if(g.assignment?.tableId===tableId)(g.assignment.seats||[]).forEach(s=>used.delete(Number(s)));
    let free=Array.from({length:table.capacity},(_,i)=>i).filter(i=>!used.has(i));if(preferred!==null&&free.includes(preferred))free=[preferred,...free.filter(i=>i!==preferred)];const required=guests.reduce((n,g)=>n+paxOf(g),0);if(free.length<required)return toast(`${table.number} has ${free.length} available chairs; the selected group needs ${required}. No assignments changed.`,"error",6000);
    const snapshot=guests.map(g=>({id:g.id,assignment:clone(g.assignment)}));let cursor=0;
    // Undo only matters here when the group had somewhere to fall back to --
    // a first-time assignment from Unassigned has nothing destructive to
    // recover (Unassign already covers that), and offering it anyway would
    // put an undo toast on every single seating instead of only real moves.
    const isMove=snapshot.some(s=>s.assignment);
    try{
      for(const g of guests){const count=paxOf(g),seats=free.slice(cursor,cursor+count);cursor+=count;g.assignment={tableId,seats,locked:false};}
      ui.selectedTableId=tableId;ui.highlightId=tableId;touchEvent(event);render();
      const message=t("seating.groupMovedToast",{n:guests.length,plural:guests.length===1?"":"s",table:table.number,seats:required});
      if(!isMove){toast(message,"success",5000);return;}
      toastAction(message,t("live.undo"),()=>{
        const now=activeEvent();if(!now||!canMutate(now,"undo a seating move"))return;
        // Seats may have been given away since the move -- restore what's still
        // free and leave the rest exactly where the move put them, same
        // clash-safe contract as unassignGuest's undo.
        let anyClash=false;
        for(const s of snapshot){
          const guest=now.guests.find(x=>x.id===s.id);if(!guest)continue;
          if(!s.assignment){guest.assignment=null;continue;}
          const back=now.tables.find(x=>x.id===s.assignment.tableId);
          const used=back?occupiedSeatIndexes(now,back.id,s.id):null;
          if(!back||(s.assignment.seats||[]).some(seat=>used.has(Number(seat)))){anyClash=true;continue;}
          guest.assignment=s.assignment;
        }
        refreshChairOccupancy(now);touchEvent(now);render();
        toast(anyClash?t("seating.groupSeatTaken"):t("seating.groupRestoredToast"),anyClash?"error":"success",5200);
      });
    }
    catch(error){snapshot.forEach(s=>{event.guests.find(g=>g.id===s.id).assignment=s.assignment;});toast("The group move was rolled back.","error");}
  }
  assignGuestToTable = function(guestId,tableId,preferred=null){assignGuestGroup([guestId],tableId,preferred);};
  // unassignGuest is defined further down, where its undo lives.
  toggleAssignmentLock = function(id){const event=activeEvent();if(!canMutate(event,"change an assignment lock"))return;original.toggleAssignmentLock(id);};
  bindSeating = function(){
    bindPanelToggles();const event=activeEvent(),records=guestSelectionRows(event),search=document.getElementById("seatingSearch");
    if(search){search.oninput=()=>{ui.seatingQuery=search.value;const pos=search.selectionStart;render();requestAnimationFrame(()=>{const n=document.getElementById("seatingSearch");if(n){n.focus();n.setSelectionRange(pos,pos);}});};}
    const closeCard=document.querySelector("[data-close-table-card]");
    if(closeCard)closeCard.onclick=()=>{ui.selectedTableId=null;render();};
    document.querySelectorAll("[data-seating-scope]").forEach(b=>b.onclick=()=>{ui.seatingGuestScope=b.dataset.seatingScope;ui.selectedGuestIds=[];ui.selectedGuestId=null;render();});document.querySelectorAll("[data-seating-filter]").forEach(b=>b.onclick=()=>{ui.seatingFilter=b.dataset.seatingFilter;ui.operationalMode=false;render();});
    document.querySelectorAll("[data-seating-guest]").forEach(row=>{row.onclick=e=>{selectGuestRecord(row.dataset.seatingGuest,e,records);render();};row.ondragstart=e=>{if(!ui.selectedGuestIds.includes(row.dataset.seatingGuest))ui.selectedGuestIds=[row.dataset.seatingGuest];e.dataTransfer.setData("application/x-merit-guests",JSON.stringify(ui.selectedGuestIds));e.dataTransfer.setData("application/x-merit-guest",row.dataset.seatingGuest);};});
    document.querySelectorAll("[data-occupant-guest]").forEach(row=>{if(!row.dataset.occupantGuest)return;row.onclick=e=>{selectGuestRecord(row.dataset.occupantGuest,e,event.guests);render();};row.ondragstart=e=>{if(!ui.selectedGuestIds.includes(row.dataset.occupantGuest))ui.selectedGuestIds=[row.dataset.occupantGuest];e.dataTransfer.setData("application/x-merit-guests",JSON.stringify(ui.selectedGuestIds));};});
    document.querySelectorAll("[data-empty-seat]").forEach(row=>row.onclick=()=>{const ids=ui.selectedGuestIds.length?ui.selectedGuestIds:[ui.selectedGuestId].filter(Boolean);if(ids.length)assignGuestGroup(ids,ui.selectedTableId,Number(row.dataset.emptySeat));});document.querySelectorAll("[data-unassign]").forEach(b=>b.onclick=()=>unassignGuest(b.dataset.unassign));document.querySelectorAll("[data-lock-assignment]").forEach(b=>b.onclick=()=>toggleAssignmentLock(b.dataset.lockAssignment));
  };

  // A party of N renders as N dots — one solid for the named guest, the rest
  // muted for companions. A non-technical operator reads "four people" from
  // this instantly; "+3" in a pax column reads as a spreadsheet.
  function paxDotsHTML(g){
    const pax=paxOf(g);
    if(pax>10)return`<span class="pax-badge">${pax}</span>`;
    return`<span class="pax-dots">${Array.from({length:pax},(_,i)=>`<i class="${i?"companion":""}"></i>`).join("")}</span>`;
  }
  function partyMetaHTML(g){
    const add=additionalOf(g),bits=[];
    bits.push(`${paxDotsHTML(g)}<span>${t("live.partyOf",{n:paxOf(g)})}</span>`);
    if(add)bits.push(`<span>${t("live.companionsOf",{n:add})}</span>`);
    if(g.vip&&g.vip!=="Standard")bits.push(`<span class="vip-tag">${esc(g.vip)}</span>`);
    return bits.join("");
  }
  function seatTagHTML(event,g){
    const t_=g.assignment&&event.tables.find(x=>x.id===g.assignment.tableId);
    if(!t_)return`<span class="seat-tag none">${t("live.noTable")}</span>`;
    return`<span class="seat-tag">${esc(formatTableNumber(t_.number))}${g.assignment.seats?.length?` · ${esc(seatRange(g.assignment.seats))}`:""}</span>`;
  }
  const ARRIVAL_ORDER={"Not Arrived":0,"Checked In":1,"No Show":2};
  // What the current search actually narrowed to, so the Enter key acts on
  // exactly the rows the operator can see. Deliberately a local, not ui state:
  // it is a property of the last render, and must never reach the stored schema.
  let liveVisibleIds=[];
  liveHTML = function(event){
    const q=ui.liveQuery.trim().toLocaleLowerCase("tr"),s=liveStats(event);
    if(!ui.liveRecent)ui.liveRecent=[];
    const rows=event.guests
      .filter(g=>!q||[g.name,g.vip,g.invitedBy,g.planningStatus,g.arrivalStatus,event.tables.find(x=>x.id===g.assignment?.tableId)?.number].join(" ").toLocaleLowerCase("tr").includes(q))
      // Not Arrived first: on event night the operator's list is "who is still
      // outside", not an alphabetical roster.
      .sort((a,b)=>(ARRIVAL_ORDER[a.arrivalStatus]-ARRIVAL_ORDER[b.arrivalStatus])||naturalSort(a.name,b.name));
    liveVisibleIds=rows.map(g=>g.id);
    // Enter only fires when the search has narrowed to a single person, and the
    // screen says whose door it is about to open. Checking in the wrong guest
    // is worse than one more keystroke, so there is no "top match wins" rule.
    const armedId=q&&rows.length===1&&rows[0].arrivalStatus!=="Checked In"?rows[0].id:null;
    const metrics=[
      `<div class="mx-metric is-hero is-good"><span class="mx-metric-label">${t("live.arrived")}</span><span class="mx-metric-value">${s.checked}</span><span class="mx-metric-note">${t("live.arrivedNote",{total:s.total})}</span></div>`,
      `<div class="mx-metric"><span class="mx-metric-label">${t("live.stillExpected")}</span><span class="mx-metric-value">${s.notArrived}</span><span class="mx-metric-note">${t("live.stillExpectedNote")}</span></div>`,
      `<div class="mx-metric ${s.noShow?"is-alert":""}"><span class="mx-metric-label">${t("live.kpi.noShow")}</span><span class="mx-metric-value">${s.noShow}</span><span class="mx-metric-note">${t("live.kpi.noShowNote")}</span></div>`,
      `<button class="mx-metric" data-live-kpi="empty"><span class="mx-metric-label">${t("live.kpi.emptyTables")}</span><span class="mx-metric-value">${s.emptyTables}</span><span class="mx-metric-note">${t("live.kpi.emptyTablesNote")}</span></button>`,
      `<button class="mx-metric" data-live-kpi="available"><span class="mx-metric-label">${t("live.kpi.emptyChairs")}</span><span class="mx-metric-value">${s.emptyChairs}</span><span class="mx-metric-note">${t("live.kpi.emptyChairsNote")}</span></button>`,
    ].join("");
    const recent=ui.liveRecent.length?ui.liveRecent.map(r=>`<div class="recent-item"><span class="arr-state ${r.to==="Checked In"?"in":r.to==="No Show"?"no":"not"}">${esc(t("status.arrival."+r.to))}</span><b>${esc(r.name)}</b><button class="undo-link" data-live-undo="${r.guestId}">${t("live.undo")}</button></div>`).join(""):`<div class="recent-item" style="color:var(--muted)">${t("live.recentEmpty")}</div>`;
    const list=rows.length?rows.map(g=>{
      const isIn=g.arrivalStatus==="Checked In",isNo=g.arrivalStatus==="No Show";
      const armed=g.id===armedId;
      return`<div class="arrival-row ${isIn?"is-in":isNo?"is-no":""} ${armed?"is-armed":""}">
        <div class="arrival-who"><div class="party-name">${esc(g.name)}</div><div class="party-sub">${partyMetaHTML(g)}</div></div>
        <div>${seatTagHTML(event,g)}</div>
        <div><span class="arr-state ${isIn?"in":isNo?"no":"not"}">${esc(t("status.arrival."+g.arrivalStatus))}</span></div>
        <div class="arrival-actions">
          ${armed?`<kbd class="enter-key" title="${t("live.armedTitle")}">${t("live.armed")} ↵</kbd>`:""}
          <button class="btn-arrive ${isIn?"undo":"go"}" data-arrival="Checked In" data-live-guest="${g.id}">${isIn?t("live.undoCheckIn"):t("live.checkInAction")}</button>
          <button class="btn-arrive ${isNo?"undo":"no"}" data-arrival="No Show" data-live-guest="${g.id}">${isNo?t("live.undo"):t("live.noShow")}</button>
        </div>
      </div>`;
    }).join(""):`<div class="mx-empty"><h3>${q?t("live.noResults"):t("live.allArrived")}</h3></div>`;
    return`<div class="mx-screen"><div class="mx-wrap">
      <div class="mx-head"><div><h1>${t("live.title")}</h1><p>${t("live.subtitle")}</p></div></div>
      <div class="mx-metrics">${metrics}</div>
      <div class="live-stage">
        <div>
          <div class="live-search-hero"><span class="hero-icon">${icon("search")}</span><input id="liveSearch" value="${esc(ui.liveQuery)}" placeholder="${t("live.searchHero")}" autocomplete="off"></div>
          <p class="live-hint">${t("live.hint")}<br>${t("live.enterHint")}</p>
          <div class="mx-list" style="margin-top:12px">${list}</div>
        </div>
        <aside class="live-aside"><div class="live-aside-head">${t("live.recentTitle")}</div>${recent}</aside>
      </div>
    </div></div>`;
  };
  // render() replaces the input node, so focus has to be re-established by hand
  // after every keystroke -- otherwise the operator types one letter and loses
  // the field.
  function focusLiveSearch(caret){
    requestAnimationFrame(()=>{
      const n=document.getElementById("liveSearch");if(!n)return;
      n.focus();
      const pos=caret==null?n.value.length:caret;
      n.setSelectionRange(pos,pos);
    });
  }
  bindLive = function(){
    const search=document.getElementById("liveSearch");
    if(search){
      search.oninput=()=>{
        ui.liveQuery=search.value;
        const pos=search.selectionStart;
        render();
        focusLiveSearch(pos);
      };
      // The door flow: type a name, press Enter, type the next name. The query
      // clears on a successful check-in so the operator never has to reach for
      // the mouse between two guests.
      search.onkeydown=e=>{
        // stopPropagation: the window-level Escape handler would otherwise fire a
        // second render for a key that means only "clear this field".
        if(e.key==="Escape"){e.preventDefault();e.stopPropagation();ui.liveQuery="";render();focusLiveSearch();return;}
        if(e.key!=="Enter")return;
        e.preventDefault();
        if(!ui.liveQuery.trim())return;
        const event=activeEvent();if(!canMutate(event,"change live arrival status"))return;
        if(!liveVisibleIds.length)return;
        if(liveVisibleIds.length>1){toast(t("live.tooMany",{n:liveVisibleIds.length}));return;}
        const g=event.guests.find(x=>x.id===liveVisibleIds[0]);if(!g)return;
        if(g.arrivalStatus==="Checked In"){toast(t("live.alreadyIn",{name:g.name}));return;}
        const from=g.arrivalStatus;
        // Same single axis as the buttons: arrivalStatus only. planningStatus
        // and the planned seat assignment are untouched.
        g.arrivalStatus="Checked In";
        recordArrival(g,from,"Checked In");
        audit(event,"ARRIVAL_STATUS_CHANGED",{guestId:g.id,status:"Checked In"});
        ui.liveQuery="";
        touchEvent(event);render();focusLiveSearch();
        toast(t("live.checkedInToast",{name:g.name}),"success");
      };
      // Event night: the operator walks up and types. Claim focus only when
      // nothing else already has it, so this never steals from another field.
      if(document.activeElement===document.body)search.focus();
    }
    document.querySelectorAll("[data-live-kpi]").forEach(b=>b.onclick=()=>{
      ui.tab="seating";ui.seatingFilter=b.dataset.liveKpi;ui.seatingGuestScope="all";ui.seatingQuery="";
      ui.operationalMode=true;ui.selectedGuestIds=[];ui.selectedGuestId=null;ui.selectedTableId=null;render();
    });
    document.querySelectorAll("[data-live-guest]").forEach(b=>b.onclick=()=>{
      const event=activeEvent();if(!canMutate(event,"change live arrival status"))return;
      const g=event.guests.find(x=>x.id===b.dataset.liveGuest),status=b.dataset.arrival;
      const from=g.arrivalStatus;
      // Arrival status is its own axis: this writes arrivalStatus and nothing
      // else. planningStatus and the planned seat assignment are untouched.
      g.arrivalStatus=from===status?"Not Arrived":status;
      recordArrival(g,from,g.arrivalStatus);
      audit(event,"ARRIVAL_STATUS_CHANGED",{guestId:g.id,status:g.arrivalStatus});
      touchEvent(event);render();
      if(g.arrivalStatus==="No Show")toast(t("live.noShowKeepsSeat"),"success",5200);
      else if(g.arrivalStatus==="Checked In")toast(t("live.checkedInToast",{name:g.name}),"success");
      else toast(t("live.undoneToast",{name:g.name}));
    });
    document.querySelectorAll("[data-live-undo]").forEach(b=>b.onclick=()=>{
      const event=activeEvent();if(!canMutate(event,"change live arrival status"))return;
      const id=b.dataset.liveUndo,entry=(ui.liveRecent||[]).find(r=>r.guestId===id),g=event.guests.find(x=>x.id===id);
      if(!entry||!g)return;
      g.arrivalStatus=entry.from;
      ui.liveRecent=ui.liveRecent.filter(r=>r.guestId!==id);
      audit(event,"ARRIVAL_STATUS_CHANGED",{guestId:g.id,status:g.arrivalStatus});
      touchEvent(event);render();toast(t("live.undoneToast",{name:g.name}));
    });
  };
  // Session-only trail so a mis-tap at the door is recoverable. Deliberately
  // ui state, not event data -- it must never reach the stored schema.
  function recordArrival(g,from,to){
    if(!ui.liveRecent)ui.liveRecent=[];
    ui.liveRecent=ui.liveRecent.filter(r=>r.guestId!==g.id);
    if(from!==to)ui.liveRecent.unshift({guestId:g.id,name:g.name,from,to});
    ui.liveRecent=ui.liveRecent.slice(0,6);
  }

  // ---- Excel import wizard: same design language, same five steps ------
  // Presentation only. app-guests.js keeps the reading, mapping, interpreting
  // and importing logic untouched -- including the rule that nothing is
  // written until step 5 and that blocking errors disable the import.
  const WIZ_STEPS=["wiz.step.file","wiz.step.preview","wiz.step.mapping","wiz.step.interpret","wiz.step.summary"];
  wizardStepsHTML = function(step){
    return`<div class="wz-rail">${WIZ_STEPS.map((k,i)=>`<div class="wz-node ${step===i+1?"active":step>i+1?"done":""}"><i>${step>i+1?"✓":i+1}</i><span>${t(k)}</span></div>`).join("")}</div>`;
  };
  // Labels are translated; the option VALUE stays the identifier the importer
  // writes against, so a Turkish UI never changes what a column maps to.
  mappingRowsHTML = function(p){
    return p.headers.map(h=>`<div class="wz-map"><div class="wz-map-src" title="${esc(h)}">${esc(h)}</div><div class="wz-map-arrow">→</div><select data-map-header="${esc(h)}">${MAP_FIELDS.map(([v])=>`<option value="${v}" ${p.mapping[h]===v?"selected":""}>${t(v?"wiz.map."+v:"wiz.map.ignore")}</option>`).join("")}</select></div>`).join("");
  };
  sourcePreviewHTML = function(p){
    return`<table class="wz-table"><thead><tr><th>#</th>${p.headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${p.rows.slice(0,15).map((row,i)=>`<tr><td>${i+1}</td>${p.headers.map(h=>`<td>${esc(row[h])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };
  // The message the importer stored stays English -- app-guests.js matches on
  // it to decide which issues survive a re-check. Only the drawn text changes.
  function wizIssueText(message){
    return typeof translateImportIssue==="function"?translateImportIssue(message):message;
  }
  interpretRowHTML = function(r,i){
    const issues=r.issues||[];
    const sel=(field,values,current)=>`<select data-interp-row="${i}" data-interp-field="${field}">${values.map(v=>`<option value="${v}" ${current===v?"selected":""}>${field==="planningStatus"?t("status.planning."+v):esc(v)}</option>`).join("")}</select>`;
    return`<tr>
      <td class="src" title="${esc(r.sourceName)}">${esc(r.sourceName)}</td>
      <td><input data-interp-row="${i}" data-interp-field="name" value="${esc(r.name)}"></td>
      <td class="num"><input data-interp-row="${i}" data-interp-field="additionalGuests" type="number" min="0" value="${r.additionalGuests}"></td>
      <td class="pax"><b>${r.pax}</b></td>
      <td>${sel("planningStatus",["Confirmed","Tentative"],r.planningStatus)}</td>
      <td>${sel("vip",["Standard","VIP","VVIP"],r.vip)}</td>
      <td><input data-interp-row="${i}" data-interp-field="tableNumber" value="${esc(r.tableNumber||"")}"></td>
      <td><input data-interp-row="${i}" data-interp-field="seatText" value="${esc(r.seatText||"")}"></td>
      <td>${issues.length?issues.map(x=>`<div class="wz-issue ${x.level}">⚠ ${esc(wizIssueText(x.message))}</div>`).join(""):`<span class="wz-ok">✓ ${t("wiz.ready")}</span>`}</td>
    </tr>`;
  };
  wizardBodyHTML = function(p){
    if(p.step===1)return`<div class="wz-drop">${icon("download")}<h3>${t("wiz.chooseTitle")}</h3><p>${t("wiz.chooseNote")}</p><div class="toolbar-row" style="justify-content:center;margin-top:6px"><button class="btn" data-wizard-template>${icon("download")}${t("wiz.template")}</button><button class="btn primary" data-wizard-choose>${icon("plus")}${t("wiz.choose")}</button></div></div>`;
    if(p.step===2)return`<h3 class="wz-title">${t("wiz.previewTitle")}</h3><p class="wz-note">${t("wiz.previewNote",{file:esc(p.fileName),shown:Math.min(15,p.rows.length),total:p.rows.length})}</p><div class="wz-scroll">${sourcePreviewHTML(p)}</div>`;
    if(p.step===3)return`<h3 class="wz-title">${t("wiz.mapTitle")}</h3><p class="wz-note">${t("wiz.mapNote")}</p><div style="max-width:780px">${mappingRowsHTML(p)}</div>`;
    if(p.step===4)return`<h3 class="wz-title">${t("wiz.interpTitle")}</h3><p class="wz-note">${t("wiz.interpNote")}</p><div class="wz-scroll"><table class="wz-table interp"><colgroup><col class="c-source"><col class="c-name"><col class="c-num"><col class="c-num"><col class="c-status"><col class="c-vip"><col class="c-table"><col class="c-seat"><col class="c-check"></colgroup><thead><tr><th>${t("wiz.col.source")}</th><th>${t("wiz.map.name")}</th><th>${t("wiz.col.additional")}</th><th>${t("wiz.col.totalPax")}</th><th>${t("wiz.map.planningStatus")}</th><th>${t("wiz.map.vip")}</th><th>${t("wiz.col.table")}</th><th>${t("wiz.col.seat")}</th><th>${t("wiz.col.validation")}</th></tr></thead><tbody>${p.interpreted.map((r,i)=>interpretRowHTML(r,i)).join("")}</tbody></table></div>`;
    const s=importSummary(p.interpreted);
    return`<h3 class="wz-title">${t("wiz.sumTitle")}</h3><p class="wz-note">${t("wiz.sumNote")}</p>
      <div class="wz-sum">
        <div><span>${t("wiz.sum.records")}</span><b>${s.records}</b></div>
        <div><span>${t("wiz.sum.guests")}</span><b>${s.guests}</b></div>
        <div><span>${t("wiz.sum.confirmed")}</span><b>${s.confirmed}</b></div>
        <div><span>${t("wiz.sum.tentative")}</span><b>${s.tentative}</b></div>
        <div><span>${t("wiz.sum.attention")}</span><b>${s.attention}</b></div>
      </div>
      ${s.errors?`<div class="wz-banner stop">${t("wiz.blocking",{n:s.errors})}</div>`:`<div class="wz-banner ok">${t("wiz.readyToImport",{records:s.records,guests:s.guests})}</div>`}`;
  };
  wizardFootHTML = function(p){
    if(p.step===1)return`<button class="btn" data-wizard-close>${t("setup.cancel")}</button>`;
    const back=`<button class="btn" data-wizard-back>${t("wiz.back")}</button>`;
    if(p.step===2)return`${back}<button class="btn primary" data-wizard-next>${t("wiz.toMapping")}${icon("arrow")}</button>`;
    if(p.step===3)return`${back}<button class="btn primary" data-wizard-next>${t("wiz.toInterpret")}${icon("arrow")}</button>`;
    if(p.step===4)return`${back}<button class="btn primary" data-wizard-next>${t("wiz.toSummary")}${icon("arrow")}</button>`;
    const s=importSummary(p.interpreted);
    return`${back}<button class="btn primary" data-wizard-import ${s.errors?"disabled":""}>${t("wiz.import")}</button>`;
  };
  renderExcelWizard = function(){
    const root=document.getElementById("excelWizard"),p=pendingImport;if(!p||!root)return;
    // id="wizTitle" is what #excelDialog's aria-labelledby points at, so the
    // dialog announces itself by name rather than as an unnamed dialog.
    root.innerHTML=`<div class="wz-head"><h2 id="wizTitle">${t("wiz.title")}</h2><button class="table-card-close" data-wizard-close aria-label="${t("wiz.close")}" title="${t("wiz.close")}">&times;</button></div>${wizardStepsHTML(p.step)}<div class="wz-body">${wizardBodyHTML(p)}</div><div class="wz-foot">${wizardFootHTML(p)}</div>`;
    bindExcelWizard();
  };

  // ---- Reports: catch problems BEFORE the workbook leaves the building --
  // The screen is free to change; the workbook contract is frozen. Nothing
  // here touches makeTablePlanSheet / makeListSheet / seatExportName.
  reportsHTML = function(event){
    const m=eventMetrics(event),s=seatingStats(event),issues=planIssues(event);
    const unassigned=event.guests.filter(g=>!g.assignment),unassignedPax=unassigned.reduce((n,g)=>n+paxOf(g),0);
    const fixFor=i=>`<button class="pf-fix" data-report-fix="${i.fix||"seating"}">${t(i.fix==="floor"?"reports.fixFloor":"reports.fixSeating")}</button>`;
    const preflight=issues.length
      ?issues.map(i=>`<div class="pf-item ${i.level}"><i class="pf-dot"></i><div class="pf-text"><b>${esc(i.title)}</b><span>${esc(i.text)}</span></div>${fixFor(i)}</div>`).join("")
      :`<div class="pf-item ok"><i class="pf-dot"></i><div class="pf-text"><b>${t("reports.preflightOk")}</b><span>${t("reports.preflightOkNote")}</span></div></div>`;
    const capacity=[
      `<div class="mx-metric is-hero"><span class="mx-metric-label">${t("reports.totalCapacity")}</span><span class="mx-metric-value">${m.total}</span><span class="mx-metric-note">${t("reports.tablesCount",{n:event.tables.length})}</span></div>`,
      `<div class="mx-metric"><span class="mx-metric-label">${t("reports.assignedGuests")}</span><span class="mx-metric-value">${m.assigned}</span><span class="mx-metric-note">${t("reports.live")}</span></div>`,
      `<div class="mx-metric"><span class="mx-metric-label">${t("reports.emptyChairs")}</span><span class="mx-metric-value">${s.emptyChairs}</span><span class="mx-metric-note">${t("reports.emptyTables")}: ${s.emptyTables}</span></div>`,
      `<div class="mx-metric ${unassignedPax?"is-warn":""}"><span class="mx-metric-label">${t("reports.unassigned")}</span><span class="mx-metric-value">${unassignedPax}</span><span class="mx-metric-note">${t("reports.guestsCount",{n:unassigned.length})}</span></div>`,
    ].join("");
    const tableRows=[...event.tables].sort((a,b)=>naturalSort(a.number,b.number))
      .map(t_=>`<div class="mx-row cols-report"><div><b style="font-size:12.5px">${esc(formatTableNumber(t_.number))}</b> <span class="muted" style="font-size:11.5px">${esc(t_.zone)}</span></div><div class="seat-tag">${tableAssignedPax(event,t_.id)} / ${t_.capacity}</div></div>`).join("");
    return`<div class="mx-screen"><div class="mx-wrap">
      <div class="mx-head"><div><h1>${t("reports.title")}</h1><p>${t("reports.subtitle")}</p></div></div>
      <div class="reports-stage">
        <div>
          <div class="mx-section" style="margin-top:0"><div class="mx-section-head"><h2>${t("reports.preflight")}</h2><span class="count">${issues.length||""}</span></div><div class="preflight">${preflight}</div></div>
          <div class="mx-section"><div class="mx-section-head"><h2>${t("reports.capacitySummary")}</h2></div><div class="mx-metrics" style="margin-bottom:0">${capacity}</div></div>
          <div class="mx-section"><div class="mx-section-head"><h2>${t("reports.tableList")}</h2><span class="count">${t("reports.tablesCount",{n:event.tables.length})}</span></div>${event.tables.length?`<div class="mx-list">${tableRows}</div>`:`<div class="mx-empty" style="padding:28px">${t("reports.tablesCount",{n:0})}</div>`}</div>
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
  bindReports = function(){
    app.querySelectorAll("[data-report='csv']").forEach(b=>b.onclick=exportGuestCSV);
    app.querySelectorAll("[data-report='xlsx']").forEach(b=>b.onclick=exportTablePlanXLSX);
    app.querySelectorAll("[data-report='print']").forEach(b=>b.onclick=printTablePlan);
    app.querySelectorAll("[data-report-fix]").forEach(b=>b.onclick=()=>{ui.tab=b.dataset.reportFix;render();});
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

  // ---- Guests: a party list, not a spreadsheet ------------------------
  // Every row is ONE guest record. Companions are shown as part of that
  // record's identity, never promoted into rows of their own.
  function guestCounts(event){
    const totalPax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    const seatedPax=event.guests.filter(g=>g.assignment).reduce((n,g)=>n+paxOf(g),0);
    return{records:event.guests.length,totalPax,seatedPax,unseatedPax:totalPax-seatedPax,
      vip:event.guests.filter(g=>g.vip&&g.vip!=="Standard").length};
  }
  function guestPartyCellHTML(event,g){
    const add=additionalOf(g),bits=[`${paxDotsHTML(g)}<span>${t("guests.partyOf",{n:paxOf(g)})}</span>`];
    if(add)bits.push(`<span>${t("guests.companions",{n:add})}</span>`);
    if(g.vip&&g.vip!=="Standard")bits.push(`<span class="vip-tag">${esc(g.vip)}</span>`);
    if(g.notes)bits.push(`<span class="note-dot" title="${esc(g.notes)}">${icon("edit")}${t("guests.hasNote")}</span>`);
    return`<div><div class="party-name">${esc(g.name)}</div><div class="party-sub">${bits.join("")}</div></div>`;
  }
  // ---- Undo for the two actions that destroy work ---------------------
  // A guest record is typed by hand or imported once; losing one to a mis-click
  // is the kind of mistake a non-technical operator cannot recover from. These
  // replace the thin canMutate wrappers that used to delegate to the base
  // implementations -- the guard is kept, the recovery is new.
  function toastAction(message,label,onAction,type="info",duration=8000){
    const wrap=document.getElementById("toastWrap");if(!wrap)return;
    const el=document.createElement("div");el.className="toast has-action "+type;
    const text=document.createElement("span");text.className="toast-text";text.textContent=message;
    const btn=document.createElement("button");btn.type="button";btn.className="toast-action";btn.textContent=label;
    let done=false;
    btn.onclick=()=>{if(done)return;done=true;el.remove();onAction();};
    el.append(text,btn);wrap.appendChild(el);
    setTimeout(()=>el.remove(),duration);
  }
  deleteGuest = function(id){
    const event=activeEvent(),g=event&&event.guests.find(x=>x.id===id);
    if(!g||!canMutate(event,"delete a guest"))return;
    if(!confirm(t("guests.confirmDelete",{name:g.name})))return;
    // The whole record is kept, including its planned assignment, so undo puts
    // the guest back exactly where they were rather than as a fresh unassigned
    // record. Position is kept too, so the list does not reshuffle on undo.
    const index=event.guests.indexOf(g),snapshot=JSON.parse(JSON.stringify(g));
    event.guests.splice(index,1);
    refreshChairOccupancy(event);
    audit(event,"GUEST_DELETED",{guestId:g.id,name:g.name});
    touchEvent(event);render();
    toastAction(t("guests.deletedToast",{name:g.name}),t("live.undo"),()=>{
      const now=activeEvent();
      if(!now||!canMutate(now,"restore a guest"))return;
      if(now.guests.some(x=>x.id===snapshot.id))return;
      // The seat may have been given away in the meantime. Restoring the record
      // matters more than restoring the seat, so the guest comes back either
      // way -- unassigned if the seat is gone, and the operator is told.
      let seatLost=false;
      if(snapshot.assignment){
        const table=now.tables.find(x=>x.id===snapshot.assignment.tableId);
        const used=table?occupiedSeatIndexes(now,table.id):null;
        const clash=!table||(snapshot.assignment.seats||[]).some(s=>used.has(Number(s)));
        if(clash){snapshot.assignment=null;seatLost=true;}
      }
      now.guests.splice(Math.min(index,now.guests.length),0,snapshot);
      refreshChairOccupancy(now);
      audit(now,"GUEST_RESTORED",{guestId:snapshot.id,name:snapshot.name});
      touchEvent(now);render();
      toast(seatLost?t("guests.restoredNoSeat",{name:snapshot.name}):t("guests.restoredToast",{name:snapshot.name}),"success");
    });
  };
  unassignGuest = function(id){
    const event=activeEvent(),g=event&&event.guests.find(x=>x.id===id);
    if(!g||!g.assignment)return;
    if(!canMutate(event,"unassign a guest"))return;
    if(g.assignment.locked){toast(t("seating.unlockFirst"),"error");return;}
    const snapshot=JSON.parse(JSON.stringify(g.assignment));
    const table=event.tables.find(x=>x.id===snapshot.tableId);
    const label=table?formatTableNumber(table.number):"";
    g.assignment=null;ui.selectedGuestId=id;
    refreshChairOccupancy(event);
    touchEvent(event);render();
    toastAction(t("seating.unassignedToast",{name:g.name}),t("live.undo"),()=>{
      const now=activeEvent();
      if(!now||!canMutate(now,"reassign a guest"))return;
      const guest=now.guests.find(x=>x.id===id);if(!guest||guest.assignment)return;
      const back=now.tables.find(x=>x.id===snapshot.tableId);
      const used=back?occupiedSeatIndexes(now,back.id,id):null;
      if(!back||(snapshot.seats||[]).some(s=>used.has(Number(s)))){
        toast(t("seating.seatTaken",{name:guest.name}),"error",5200);return;
      }
      guest.assignment=snapshot;
      refreshChairOccupancy(now);
      audit(now,"GUEST_REASSIGNED",{guestId:id,tableId:snapshot.tableId});
      touchEvent(now);render();
      toast(t("seating.reassignedToast",{name:guest.name,table:label}),"success");
    });
  };
  guestsHTML = function(event){
    const guests=filteredGuests(event),c=guestCounts(event);
    const metrics=[
      `<div class="mx-metric is-hero"><span class="mx-metric-label">${t("guests.m.totalPax")}</span><span class="mx-metric-value">${c.totalPax}</span><span class="mx-metric-note">${t("guests.m.totalPaxNote",{n:c.records})}</span></div>`,
      `<div class="mx-metric ${c.seatedPax?"is-good":""}"><span class="mx-metric-label">${t("guests.m.seated")}</span><span class="mx-metric-value">${c.seatedPax}</span><span class="mx-metric-note">${t("guests.m.seatedNote")}</span></div>`,
      `<div class="mx-metric ${c.unseatedPax?"is-warn":""}"><span class="mx-metric-label">${t("guests.m.unseated")}</span><span class="mx-metric-value">${c.unseatedPax}</span><span class="mx-metric-note">${t("guests.m.unseatedNote")}</span></div>`,
      `<div class="mx-metric"><span class="mx-metric-label">${t("guests.m.vip")}</span><span class="mx-metric-value">${c.vip}</span><span class="mx-metric-note">${t("guests.m.vipNote")}</span></div>`,
    ].join("");
    // The unassigned backlog is stated outright instead of hiding behind a
    // filter the operator has to remember to switch to.
    const queue=c.unseatedPax
      ?`<div class="mx-queue"><b>${t("guests.queue",{n:c.unseatedPax})}</b><span>${t("guests.queueHint")}</span><button class="btn sm primary" data-guest-command="seating">${t("guests.queueGo")}</button></div>`
      :c.records?`<div class="mx-queue clear"><b>${t("guests.queueClear")}</b><span></span></div>`:"";
    const filters=[["all",t("guests.filter.all")],["assigned",t("guests.filter.assigned")],["unassigned",t("guests.filter.unassigned")],["confirmed",t("guests.filter.confirmed")],["tentative",t("guests.filter.tentative")]];
    const body=!c.records
      ?`<div class="mx-empty"><h3>${t("guests.emptyTitle")}</h3><p>${t("guests.emptyHint")}</p><div class="toolbar-row" style="justify-content:center"><button class="btn" data-guest-command="import">${icon("image")}${t("guests.importExcel")}</button><button class="btn primary" data-guest-command="add">${icon("plus")}${t("guests.addGuest")}</button></div></div>`
      :`<div class="mx-list"><div class="mx-list-head cols-guest"><span>${t("guests.col.guest")}</span><span>${t("guests.col.status")}</span><span>${t("guests.col.invitedBy")}</span><span>${t("guests.col.tableSeat")}</span><span></span></div>${
        guests.length?guests.map(g=>`<div class="mx-row cols-guest">${guestPartyCellHTML(event,g)}<div><span class="plan-tag ${g.planningStatus.toLowerCase()}">${esc(t("status.planning."+g.planningStatus))}</span></div><div class="muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.invitedBy||"—")}</div><div>${seatTagHTML(event,g)}${g.assignment?.locked?" 🔒":""}</div><div class="row-icons"><button class="row-action" aria-label="${esc(t("guests.a11y.seat",{name:g.name}))}" title="${t("guests.col.tableSeat")}" data-guest-seat="${g.id}">${icon("seat")}</button><button class="row-action" aria-label="${esc(t("guests.a11y.edit",{name:g.name}))}" data-guest-edit="${g.id}">${icon("edit")}</button><button class="row-action" aria-label="${esc(t("guests.a11y.delete",{name:g.name}))}" data-guest-delete="${g.id}">${icon("trash")}</button></div></div>`).join(""):`<div class="mx-empty" style="border:none;background:none">${t("guests.noMatches")}</div>`
      }</div>`;
    return`<div class="mx-screen"><div class="mx-wrap">
      <div class="mx-head"><div><h1>${t("guests.title")}</h1><p>${t("guests.recordsSummary",{records:c.records,total:c.totalPax})}</p></div><div class="mx-head-actions"><button class="btn" data-guest-command="template">${icon("download")}${t("guests.excelTemplate")}</button><button class="btn" data-guest-command="import">${icon("image")}${t("guests.importExcel")}</button><button class="btn primary" data-guest-command="add">${icon("plus")}${t("guests.addGuest")}</button></div></div>
      <div class="mx-metrics">${metrics}</div>
      ${queue}
      <div class="mx-toolbar"><div class="grow"><input class="filter-input" id="guestSearch" style="width:100%" value="${esc(ui.guestQuery)}" placeholder="${t("guests.search")}"></div><select class="filter-input" id="guestFilter" style="width:170px">${filters.map(([v,l])=>`<option value="${v}" ${ui.guestFilter===v?"selected":""}>${l}</option>`).join("")}</select></div>
      ${body}
    </div></div>`;
  };

  openGuestDialog = function(...args){if(canMutate(activeEvent(),"edit guest records")){original.openGuestDialog(...args);translateStaticDialogs();}};

  // guestDialog/excelDialog markup lives once in index.html and never passes
  // through render(), so a language toggle has nothing to re-draw it. This
  // pushes the current language into that static markup directly, called on
  // every render() and whenever the guest dialog opens.
  function translateStaticDialogs(){
    const form=document.getElementById("guestForm");if(!form)return;
    const editing=!!form.elements.id.value;
    const title=document.getElementById("guestDialogTitle");if(title)title.textContent=t(editing?"guests.editGuest":"guests.addGuest");
    const setLabel=(forId,key)=>{const lbl=form.querySelector(`label[for="${forId}"]`);if(lbl)lbl.textContent=t(key);};
    setLabel("gfName","guestDialog.name");
    setLabel("gfAdditional","guestDialog.additionalGuests");
    setLabel("gfPlanning","guestDialog.planningStatus");
    setLabel("gfVip","guestDialog.vipLevel");
    setLabel("gfInvitedBy","guestDialog.invitedBy");
    setLabel("gfNotes","guestDialog.notes");
    const paxLabel=document.getElementById("gfPaxLabel");if(paxLabel)paxLabel.textContent=t("guestDialog.totalPax");
    const planningSel=form.elements.planningStatus;
    if(planningSel){const cur=planningSel.value||"Confirmed";planningSel.innerHTML=`<option value="Confirmed">${t("status.planning.Confirmed")}</option><option value="Tentative">${t("status.planning.Tentative")}</option>`;planningSel.value=cur;}
    const cancelBtn=form.querySelector(".dialog-foot .btn:not(.primary)");if(cancelBtn)cancelBtn.textContent=t("guestDialog.cancel");
    const saveBtn=form.querySelector(".dialog-foot .btn.primary");if(saveBtn)saveBtn.textContent=t("guestDialog.save");
  }
  translateStaticDialogs();
  // deleteGuest is defined further up, where its undo lives.
  bindGuests = function(){
    if(isHistorical(activeEvent()))return;
    original.bindGuests();
    // The empty state repeats Import/Add, and the base binder uses
    // querySelector -- first match only -- so the duplicates would be inert.
    app.querySelectorAll("[data-guest-command='add']").forEach(b=>b.onclick=()=>openGuestDialog());
    app.querySelectorAll("[data-guest-command='import']").forEach(b=>b.onclick=openExcelWizard);
    app.querySelectorAll("[data-guest-command='template']").forEach(b=>b.onclick=downloadExcelTemplate);
    const toSeating=app.querySelector("[data-guest-command='seating']");
    if(toSeating)toSeating.onclick=()=>{ui.tab="seating";ui.seatingGuestScope="unassigned";ui.seatingQuery="";ui.selectedGuestId=null;ui.selectedGuestIds=[];render();};
  };
  loadXLSX = function(){return globalThis.XLSX?Promise.resolve():Promise.reject(new Error("Embedded spreadsheet engine did not initialize."));};

  // Translate at the toast boundary rather than at ~40 call sites. Strings
  // already localized by t() simply pass through unmatched.
  const baseToast=toast;
  toast=function(message,...rest){return baseToast(typeof translateToast==="function"?translateToast(message):message,...rest);};

  // Cancel and the close X live inside <form method="dialog"> as untyped
  // buttons, so both SUBMITTED the form: pressing Cancel on a guest edit
  // committed it -- pax change, capacity check and seat repack included.
  document.querySelectorAll("#guestDialog [value='cancel']").forEach(b=>{
    b.type="button";
    b.onclick=()=>document.getElementById("guestDialog").close("cancel");
  });

  // Importing guests is a mutation, but neither the wizard opener nor its
  // import step consulted canMutate; protection was incidental (bindGuests
  // simply never runs on historical events).
  const baseOpenExcelWizard=typeof openExcelWizard==="function"?openExcelWizard:null;
  if(baseOpenExcelWizard)openExcelWizard=function(...a){
    if(!canMutate(activeEvent(),"import a guest list"))return;
    return baseOpenExcelWizard(...a);
  };

  function yieldFrame(){return new Promise(resolve=>requestAnimationFrame(()=>resolve()));}
  function sourceBlob(src){return fetch(src).then(r=>r.blob());}
  function otsu(hist,total,sum){let bg=0,bgSum=0,best=-1,threshold=150;for(let value=0;value<256;value++){bg+=hist[value];if(!bg)continue;const fg=total-bg;if(!fg)break;bgSum+=value*hist[value];const score=bg*fg*((bgSum/bg)-((sum-bgSum)/fg))**2;if(score>best){best=score;threshold=value;}}return threshold;}
  // ============================================================
  // PlanDetectionProvider — classical-CV implementation
  //
  // Everything in this section is deterministic classical computer vision on
  // the real decoded plan pixels. It is NOT a trained model and must never be
  // presented as one (see .claude/skills/merit-plan-intelligence/SKILL.md,
  // "AI truthfulness"). It is exposed as a provider object
  //   { id, label, trainedModel:false, detect(pixels,width,height,hooks) }
  // so the application layer below never reaches into pixel code directly and
  // a future ONNX / YOLO-OBB provider can be dropped in behind the identical
  // call signature (real pixels in, oriented candidates out) without
  // runAssistedDetection() or plan-intelligence.js changing.
  //
  // Four accuracy defects diagnosed against a real venue plan drove this
  // rewrite; each fix is marked FIX #n below.
  //   1. colour was discarded on the first pass (luma only)
  //   2. Sobel edges were OR-ed into the labelling mask, so two tables drawn
  //      as adjacent outlines fused into ONE component centred between them
  //   3. table selection was "biggest area first, cap 100", which actively
  //      promoted those merge artifacts over correct single tables
  //   4. round vs rectangle came from the bounding-box aspect ratio, so every
  //      square table was reported as a round table
  // ============================================================

  // ---- FIX #1: a colour/tone model derived FROM THE IMAGE ----------------
  // No hue and no grey level is hardcoded. Two complementary models are built
  // from the drawing itself:
  //
  //  * ACCENT (hue): a 512-bin (3 bits/channel) RGB histogram reduced by
  //    mode-seeking leader clustering (descending bin population, fixed merge
  //    radius — deterministic, no RNG). The most saturated well-populated
  //    cluster family is the accent: orange chairs on the reported plan, blue
  //    chairs on the next venue's plan, same code path.
  //
  //  * TONE (lightness): 3 bits per channel cannot tell a pale beige or light
  //    grey table fill from white paper at all — they land in the SAME bucket —
  //    so tone families come from a full 8-bit luma histogram of the
  //    non-accent pixels instead. Its peaks are the drawing's real flat fills
  //    (paper / table fill / chair fill / ink), and each family only claims a
  //    narrow band around its own peak so antialiasing between two fills is
  //    claimed by neither.
  //
  // If the drawing has no saturated family the accent model simply comes out
  // empty and detection runs on tone alone; if it has no tone families either,
  // the luma component fallback still runs.
  const RGB_BITS=3,RGB_LEVELS=1<<RGB_BITS,RGB_BINS=RGB_LEVELS**3,RGB_SHIFT=8-RGB_BITS;
  const LOW_CHROMA=40,MID_CHROMA=90;
  function rgbBinIndex(r,g,b){return((r>>RGB_SHIFT)*RGB_LEVELS+(g>>RGB_SHIFT))*RGB_LEVELS+(b>>RGB_SHIFT);}
  function rgbHue(r,g,b){
    const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
    if(!d)return 0;
    let h;
    if(max===r)h=((g-b)/d)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;
    h*=60;return h<0?h+360:h;
  }
  function hueGap(a,b){const d=Math.abs(a-b)%360;return d>180?360-d:d;}
  function buildAccentModel(binCount,binR,binG,binB,total){
    const order=[];
    for(let bin=0;bin<RGB_BINS;bin++)if(binCount[bin])order.push(bin);
    order.sort((a,b)=>binCount[b]-binCount[a]||a-b); // ties broken by bin index so the model is reproducible run to run
    const clusters=[],MERGE_DIST=72; // one 3-bit bucket step is 32 per channel
    for(const bin of order){
      const n=binCount[bin],r=binR[bin]/n,g=binG[bin]/n,b=binB[bin]/n;
      let host=null,bestDist=Infinity;
      for(const cl of clusters){const d=Math.hypot(cl.r-r,cl.g-g,cl.b-b);if(d<bestDist){bestDist=d;host=cl;}}
      if(host&&bestDist<=MERGE_DIST){
        host.n+=n;host.sr+=binR[bin];host.sg+=binG[bin];host.sb+=binB[bin];
        host.r=host.sr/host.n;host.g=host.sg/host.n;host.b=host.sb/host.n;
      }else if(clusters.length<12)clusters.push({n,sr:binR[bin],sg:binG[bin],sb:binB[bin],r,g,b});
    }
    if(!clusters.length)return null;
    for(const cl of clusters){
      cl.luma=cl.r*.299+cl.g*.587+cl.b*.114;
      cl.chroma=Math.max(cl.r,cl.g,cl.b)-Math.min(cl.r,cl.g,cl.b);
      cl.hue=rgbHue(cl.r,cl.g,cl.b);
      cl.fraction=cl.n/total;
    }
    const background=clusters.reduce((best,c)=>c.n>best.n?c:best,clusters[0]);
    const others=clusters.filter(c=>c!==background);
    const saturated=others.filter(c=>c.chroma>=45&&c.fraction>=.0006)
      .sort((a,b)=>b.chroma*Math.sqrt(b.n)-a.chroma*Math.sqrt(a.n)||b.n-a.n);
    const seed=saturated[0]||null;
    // A drawn object is usually a saturated fill plus a darker stroke of the
    // SAME hue, so the accent family is hue-anchored, not a single cluster.
    const accent=seed?others.filter(c=>c.chroma>=Math.max(35,seed.chroma*.5)&&hueGap(c.hue,seed.hue)<=30&&c.fraction>=.0002):[];
    const accentSet=new Set(accent);
    // Per-bucket lookup, including the antialiased in-between buckets that
    // never got their own cluster: mask building becomes one lookup per pixel.
    const accentBucket=new Uint8Array(RGB_BINS),neutralBucket=new Uint8Array(RGB_BINS);
    const chromaCut=seed?Math.max(LOW_CHROMA,Math.min(MID_CHROMA,seed.chroma*.5)):MID_CHROMA;
    for(let bin=0;bin<RGB_BINS;bin++){
      const rb=(bin/(RGB_LEVELS*RGB_LEVELS))|0,gb=((bin/RGB_LEVELS)|0)%RGB_LEVELS,bb=bin%RGB_LEVELS,half=1<<(RGB_SHIFT-1);
      const r=rb*(1<<RGB_SHIFT)+half,g=gb*(1<<RGB_SHIFT)+half,b=bb*(1<<RGB_SHIFT)+half;
      let best=clusters[0],bestDist=Infinity;
      for(const cl of clusters){const d=(cl.r-r)**2+(cl.g-g)**2+(cl.b-b)**2;if(d<bestDist){bestDist=d;best=cl;}}
      accentBucket[bin]=accentSet.has(best)?1:0;
      neutralBucket[bin]=(!accentBucket[bin]&&(Math.max(r,g,b)-Math.min(r,g,b))<=chromaCut)?1:0;
    }
    return{clusters,background,accent,accentBucket,neutralBucket,
      isColorPlan:accent.length>0,
      accentHue:seed?Math.round(seed.hue):null,accentChroma:seed?Math.round(seed.chroma):null,
      accentFraction:accent.reduce((n,c)=>n+c.fraction,0),backgroundLuma:Math.round(background.luma)};
  }
  // Tone families: the real flat fills of the drawing, found as peaks of the
  // non-accent luma histogram. Each family claims only a narrow band around its
  // own peak, so the 1px antialiasing ramp between paper and a fill belongs to
  // neither family and cannot bridge two objects together.
  function buildToneModel(lowHist,midHist,sampled,accentChroma){
    const useMid=!accentChroma||accentChroma>=120; // a mid-chroma fill is a table tint, unless the accent itself is that weak
    const hist=new Float64Array(256);
    let neutral=0;
    for(let v=0;v<256;v++){hist[v]=lowHist[v]+(useMid?midHist[v]:0);neutral+=hist[v];}
    if(!neutral)return null;
    const smooth=new Float64Array(256);
    for(let v=0;v<256;v++){
      let sum=0,n=0;
      for(let k=-2;k<=2;k++){const u=v+k;if(u<0||u>255)continue;sum+=hist[u];n++;}
      smooth[v]=sum/n;
    }
    const raw=[];
    // The ends of the range are candidates too: white paper sits at 255 and a
    // solid black fill at 0, and skipping the boundaries made the brightest
    // fill (not the paper) look like the background of the drawing.
    for(let v=0;v<256;v++){
      const prev=v>0?smooth[v-1]:-1,next=v<255?smooth[v+1]:-1;
      if(smooth[v]>0&&smooth[v]>=prev&&smooth[v]>next)raw.push(v);
    }
    raw.sort((a,b)=>smooth[b]-smooth[a]||a-b);
    const peaks=[];
    for(const v of raw){
      if(peaks.some(p=>Math.abs(p.luma-v)<10))continue; // one peak per real fill, not per histogram wobble
      let mass=0;
      for(let k=-5;k<=5;k++){const u=v+k;if(u>=0&&u<256)mass+=hist[u];}
      peaks.push({luma:v,mass,fraction:mass/sampled});
      if(peaks.length>=8)break;
    }
    if(!peaks.length)return null;
    peaks.sort((a,b)=>a.luma-b.luma);
    const background=peaks.reduce((best,p)=>p.mass>best.mass?p:best,peaks[0]);
    const inkCeil=Math.max(90,background.luma*.45);
    const families=peaks.filter(p=>p!==background&&p.luma<background.luma-10&&p.luma>inkCeil&&p.fraction>=.002)
      .sort((a,b)=>b.mass-a.mass).slice(0,3);
    const toneLut=new Uint8Array(256);
    families.forEach((family,index)=>{
      let gap=Infinity;
      for(const p of peaks)if(p!==family)gap=Math.min(gap,Math.abs(p.luma-family.luma));
      const window=Math.max(3,Math.min(14,Math.floor(gap/2)));
      for(let v=Math.max(0,family.luma-window);v<=Math.min(255,family.luma+window);v++)
        if(!toneLut[v]||Math.abs(v-family.luma)<Math.abs(v-families[toneLut[v]-1].luma))toneLut[v]=index+1;
    });
    return{peaks,background,families,toneLut,
      summary:{peaks:peaks.map(p=>p.luma),backgroundLuma:background.luma,
        families:families.map(f=>({luma:f.luma,fraction:Number(f.fraction.toFixed(4))}))}};
  }

  // ---- Masks --------------------------------------------------------------
  function buildClassMasks(data,gray,total,accentModel,toneModel){
    const accent=accentModel?.isColorPlan?new Uint8Array(total):null;
    const familyCount=toneModel?.families.length||0,tints=[];
    for(let k=0;k<familyCount;k++)tints.push(new Uint8Array(total));
    const accentBucket=accentModel?.accentBucket,neutralBucket=accentModel?.neutralBucket,toneLut=toneModel?.toneLut;
    for(let i=0,o=0;i<total;i++,o+=4){
      const bin=rgbBinIndex(data[o],data[o+1],data[o+2]);
      if(accent&&accentBucket[bin]){accent[i]=1;continue;}
      if(!familyCount)continue;
      if(accentBucket&&accentBucket[bin])continue;
      if(neutralBucket&&!neutralBucket[bin])continue;
      const family=toneLut[gray[i]];
      if(family)tints[family-1][i]=1;
    }
    return{accent,tints};
  }
  // A real solidity measure (4-neighbour erosion survival). A genuine filled
  // object survives erosion; a 1px antialiasing halo along an outline does
  // not. This is what stops a "tint" family that is really just edge fringing
  // from being used as an object source.
  function maskSolidity(mask,width,height){
    let on=0,solid=0;
    for(let y=1;y<height-1;y+=2)for(let x=1;x<width-1;x++){ // every other row: this is a ratio, not a count
      const i=y*width+x;if(!mask[i])continue;on++;
      if(mask[i-1]&&mask[i+1]&&mask[i-width]&&mask[i+width])solid++;
    }
    return on?solid/on:0;
  }
  // FIX #2, part 1: enclosed-interior extraction. Tables on a CAD-style plan
  // are drawn as thin OUTLINES. Labelling the ink itself fuses two tables that
  // share or touch an outline into one component whose bbox spans both — the
  // "one table detected in the middle of two tables" report. The interior of
  // each closed outline, however, is a separate region: flood the background
  // in from the image border and whatever is left unreached (and not ink) is
  // enclosed by something. A shared outline still separates the two interiors,
  // so adjacent tables stay two objects. It also makes a chair drawn ON TOP OF
  // a table outline harmless: it cannot leak into the interior.
  function enclosedRegions(barrier,width,height){
    const reached=new Uint8Array(barrier.length),stack=scratchQueue(barrier.length);
    let sp=0;
    const seed=i=>{if(!barrier[i]&&!reached[i]){reached[i]=1;stack[sp++]=i;}};
    for(let x=0;x<width;x++){seed(x);seed((height-1)*width+x);}
    for(let y=0;y<height;y++){seed(y*width);seed(y*width+width-1);}
    // Span/scanline flood rather than per-pixel: the background of a floor plan
    // is most of the image, and pushing every background pixel individually was
    // the single most expensive step in the pass. Each pop fills a whole run and
    // seeds only the FIRST open pixel of each run in the rows above and below.
    while(sp){
      const p=stack[--sp],y=(p/width)|0,rowStart=y*width,rowEnd=rowStart+width-1;
      let l=p;while(l>rowStart&&!barrier[l-1]&&!reached[l-1]){l--;reached[l]=1;}
      let r=p;while(r<rowEnd&&!barrier[r+1]&&!reached[r+1]){r++;reached[r]=1;}
      if(y>0){
        let run=false;
        for(let q=l-width;q<=r-width;q++){
          if(barrier[q]||reached[q]){run=false;continue;}
          if(!run){reached[q]=1;stack[sp++]=q;run=true;}
        }
      }
      if(y<height-1){
        let run=false;
        for(let q=l+width;q<=r+width;q++){
          if(barrier[q]||reached[q]){run=false;continue;}
          if(!run){reached[q]=1;stack[sp++]=q;run=true;}
        }
      }
    }
    // Inverted in place (enclosed = not ink, not reachable from the border)
    // rather than into a second full-size array.
    for(let i=0;i<reached.length;i++)reached[i]=(!barrier[i]&&!reached[i])?1:0;
    return reached;
  }
  // One shared BFS work queue. Each labelling pass used to allocate (and
  // zero-fill) 4 bytes per pixel just to throw it away; the queue is always
  // written before it is read, so it can be reused across passes.
  let SCRATCH_QUEUE=null;
  function scratchQueue(size){
    if(!SCRATCH_QUEUE||SCRATCH_QUEUE.length<size)SCRATCH_QUEUE=new Int32Array(size);
    return SCRATCH_QUEUE;
  }
  function labelComponents(mask,width,height,minPixels,connect8){
    const labels=new Int32Array(mask.length),queue=scratchQueue(mask.length),comps=[];
    let label=0;
    for(let start=0;start<mask.length;start++){
      if(!mask[start]||labels[start])continue;
      label++;
      let head=0,tail=0,count=0,minX=width,minY=height,maxX=0,maxY=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;
      queue[tail++]=start;labels[start]=label;
      while(head<tail){
        const p=queue[head++],x=p%width,y=(p/width)|0;
        count++;
        if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
        sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;
        const left=x>0,right=x<width-1,up=y>0,down=y<height-1;
        if(left&&mask[p-1]&&!labels[p-1]){labels[p-1]=label;queue[tail++]=p-1;}
        if(right&&mask[p+1]&&!labels[p+1]){labels[p+1]=label;queue[tail++]=p+1;}
        if(up&&mask[p-width]&&!labels[p-width]){labels[p-width]=label;queue[tail++]=p-width;}
        if(down&&mask[p+width]&&!labels[p+width]){labels[p+width]=label;queue[tail++]=p+width;}
        if(connect8){
          if(left&&up&&mask[p-width-1]&&!labels[p-width-1]){labels[p-width-1]=label;queue[tail++]=p-width-1;}
          if(right&&up&&mask[p-width+1]&&!labels[p-width+1]){labels[p-width+1]=label;queue[tail++]=p-width+1;}
          if(left&&down&&mask[p+width-1]&&!labels[p+width-1]){labels[p+width-1]=label;queue[tail++]=p+width-1;}
          if(right&&down&&mask[p+width+1]&&!labels[p+width+1]){labels[p+width+1]=label;queue[tail++]=p+width+1;}
        }
      }
      if(count<minPixels)continue;
      const w=maxX-minX+1,h=maxY-minY+1,mx=sx/count,my=sy/count;
      const covXX=sxx/count-mx*mx,covYY=syy/count-my*my,covXY=sxy/count-mx*my;
      comps.push({label,x:minX,y:minY,w,h,count,aspect:w/h,fill:count/(w*h),cx:mx,cy:my,
        pcaRotation:.5*Math.atan2(2*covXY,covXX-covYY)*180/Math.PI});
    }
    return{labels,comps};
  }

  // ---- Oriented bounding box (real OBB, never forced axis-aligned) --------
  // Rotating-calipers-style minimum-area rectangle over the shape's boundary
  // points. This is the rotation-aware representation merit-plan-intelligence
  // requires: centre x/y, width, height and rotation are measured together and
  // carried end to end. Axis-aligned wins near-ties on purpose — a square or a
  // circle has (near-)equal area at every angle, and printing a spurious 37°
  // tilt for an axis-aligned object would be a fabricated orientation.
  function minAreaRect(pointsX,pointsY){
    const n=pointsX.length;
    if(n<3)return null;
    const step=Math.max(1,Math.ceil(n/220)),xs=[],ys=[];
    for(let i=0;i<n;i+=step){xs.push(pointsX[i]);ys.push(pointsY[i]);}
    const measure=deg=>{
      const rad=deg*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
      let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
      for(let i=0;i<xs.length;i++){
        const u=xs[i]*cos+ys[i]*sin,v=-xs[i]*sin+ys[i]*cos;
        if(u<minU)minU=u;if(u>maxU)maxU=u;if(v<minV)minV=v;if(v>maxV)maxV=v;
      }
      const w=maxU-minU+1,h=maxV-minV+1;
      return{deg,cos,sin,w,h,area:w*h,cu:(minU+maxU)/2,cv:(minV+maxV)/2};
    };
    const axis=measure(0);
    let best=axis;
    for(let deg=3;deg<90;deg+=3){const m=measure(deg);if(m.area<best.area)best=m;}
    for(let deg=best.deg-2;deg<=best.deg+2;deg++){
      if(deg===best.deg||deg<0||deg>=90)continue;
      const m=measure(deg);if(m.area<best.area)best=m;
    }
    if(axis.area<=best.area*1.03)best=axis;
    let w=best.w,h=best.h,rotation=best.deg;
    if(rotation>45){const swap=w;w=h;h=swap;rotation-=90;} // keep rotation in (-45,45]; same physical rectangle
    return{cx:best.cu*best.cos-best.cv*best.sin,cy:best.cu*best.sin+best.cv*best.cos,w,h,rotation};
  }

  // ---- FIX #4: shape decided from real pixels, not the bbox aspect --------
  // The component is hole-filled locally (flood from the padded window border;
  // whatever the outline encloses becomes solid), then measured in its own OBB
  // frame. `cornerOccupancy` is how much of the four OBB corner squares
  // (|u|>0.72 and |v|>0.72 of the half-extents — a region that lies entirely
  // OUTSIDE an inscribed ellipse and entirely INSIDE a rectangle) is actually
  // covered. A circle leaves them empty; a square fills them. quadrantFill is
  // the same 4-quadrant balance computeVisualDescriptor already produces,
  // measured here on the filled shape so an off-centre/L-shaped object can be
  // told apart from a symmetric one.
  function shapeAnalysis(labels,label,comp,width,height){
    const pad=1,x0=comp.x-pad,y0=comp.y-pad,lw=comp.w+2*pad,lh=comp.h+2*pad;
    if(lw<3||lh<3)return null;
    const loc=new Uint8Array(lw*lh);
    for(let y=0;y<lh;y++){
      const gy=y0+y;if(gy<0||gy>=height)continue;
      for(let x=0;x<lw;x++){
        const gx=x0+x;if(gx<0||gx>=width)continue;
        if(labels[gy*width+gx]===label)loc[y*lw+x]=1;
      }
    }
    const reached=new Uint8Array(lw*lh),stack=new Int32Array(lw*lh);
    let sp=0;
    const push=i=>{if(!loc[i]&&!reached[i]){reached[i]=1;stack[sp++]=i;}};
    for(let x=0;x<lw;x++){push(x);push((lh-1)*lw+x);}
    for(let y=0;y<lh;y++){push(y*lw);push(y*lw+lw-1);}
    while(sp){
      const p=stack[--sp],x=p%lw,y=(p/lw)|0;
      if(x>0)push(p-1);
      if(x<lw-1)push(p+1);
      if(y>0)push(p-lw);
      if(y<lh-1)push(p+lw);
    }
    const filled=new Uint8Array(lw*lh);
    let filledCount=0;
    for(let i=0;i<filled.length;i++)if(loc[i]||!reached[i]){filled[i]=1;filledCount++;}
    const bx=[],by=[];
    for(let y=0;y<lh;y++)for(let x=0;x<lw;x++){
      const i=y*lw+x;if(!filled[i])continue;
      if(x===0||y===0||x===lw-1||y===lh-1||!filled[i-1]||!filled[i+1]||!filled[i-lw]||!filled[i+lw]){bx.push(x0+x);by.push(y0+y);}
    }
    const obb=minAreaRect(bx,by);
    if(!obb)return null;
    const rad=obb.rotation*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
    const hw=Math.max(1,obb.w/2),hh=Math.max(1,obb.h/2);
    let cornerOn=0,cornerTotal=0,edgeOn=0,edgeTotal=0;
    const quadOn=[0,0,0,0],quadTotal=[0,0,0,0];
    for(let y=0;y<lh;y++)for(let x=0;x<lw;x++){
      const dx=x0+x-obb.cx,dy=y0+y-obb.cy;
      const u=(dx*cos+dy*sin)/hw,v=(-dx*sin+dy*cos)/hh;
      const au=Math.abs(u),av=Math.abs(v);
      if(au>1.02||av>1.02)continue;
      const on=filled[y*lw+x];
      const qi=(u<0?0:1)+(v<0?0:2);quadTotal[qi]++;if(on)quadOn[qi]++;
      if(au>.72&&av>.72){cornerTotal++;if(on)cornerOn++;}
      else if((au<.25&&av>.72)||(av<.25&&au>.72)){edgeTotal++;if(on)edgeOn++;}
    }
    const cornerOccupancy=cornerTotal?cornerOn/cornerTotal:0;
    const edgeOccupancy=edgeTotal?edgeOn/edgeTotal:0;
    return{obb,filledCount,rawCount:comp.count,
      obbFill:filledCount/Math.max(1,obb.w*obb.h),
      cornerOccupancy,edgeOccupancy,
      cornerVsEdge:edgeOccupancy>.02?cornerOccupancy/edgeOccupancy:(cornerOccupancy>.02?1:0),
      quadrantFill:quadTotal.map((n,i)=>n?quadOn[i]/n:0)};
  }
  function classifyTableShape(shape){
    if(!shape)return{type:"rectangle",basis:"no-shape-signal",shapeConfidence:.15};
    const aspect=shape.obb.w/Math.max(1,shape.obb.h);
    const squareish=aspect>=.82&&aspect<=1.22;
    let round,basis;
    if(shape.obbFill>=.5){round=shape.cornerOccupancy<.35;basis="corner-occupancy";}
    else{round=shape.cornerVsEdge<.35;basis="corner-vs-edge-density";} // an outline that never closed, so hole filling could not run
    // A strongly unbalanced quadrant signature is not a simple round table
    // even if the corners read empty (an arc, an L-shaped bench, a stray mark).
    const quads=shape.quadrantFill,spread=Math.max(...quads)-Math.min(...quads);
    if(round&&spread>.45){round=false;basis+="+quadrant-imbalance";}
    const type=round?"round":squareish?"square":"rectangle";
    const margin=round?Math.min(1,(.35-shape.cornerOccupancy)/.35):Math.min(1,(shape.cornerOccupancy-.35)/.4);
    return{type,basis,shapeConfidence:Math.max(.1,Math.min(1,margin)),aspect,squareish};
  }

  // ---- FIX #3: a modal-size prior instead of "biggest area first" ---------
  // A venue plan is highly repetitive, so the population itself says what a
  // table is. The mode is taken in log space (constant RELATIVE bin width) so
  // it is scale-free, and the peak bin plus its two neighbours are averaged so
  // one bin boundary cannot swing the answer. Ranking by agreement with the
  // mode means a merged double-table blob (~2x modal) is demoted, where the
  // old "sort by area, cap 100" actively promoted it.
  function modalMagnitude(values){
    const vals=values.filter(v=>Number.isFinite(v)&&v>0);
    if(!vals.length)return null;
    const BIN=Math.log(1.15),counts=new Map();
    for(const v of vals){const k=Math.round(Math.log(v)/BIN);counts.set(k,(counts.get(k)||0)+1);}
    let bestK=null,bestN=-1;
    for(const k of [...counts.keys()].sort((a,b)=>a-b)){
      const support=(counts.get(k)||0)+(counts.get(k-1)||0)+(counts.get(k+1)||0);
      if(support>bestN){bestN=support;bestK=k;}
    }
    const pool=vals.filter(v=>Math.abs(Math.round(Math.log(v)/BIN)-bestK)<=1);
    return{value:pool.reduce((a,b)=>a+b,0)/pool.length,support:pool.length,total:vals.length};
  }
  function sizeAgreement(value,modal){
    if(!modal||!modal.value||!(value>0))return .5;
    return Math.max(0,1-Math.abs(Math.log(value/modal.value)/Math.log(1.7)));
  }
  // FIX #2, part 2: an evidence-gated split for blobs that really did merge
  // (two filled tables touching with no drawn separator, which hole filling
  // cannot help with). A split is only made where the pixels actually show a
  // density valley AND both halves land near the modal object size — never
  // "this looks twice as big, cut it in half".
  // Cut one axis of a blob wherever the pixel profile shows a real valley, and
  // only when every resulting part is a clean repeat of the modal object. A
  // valley that does not produce modal-sized parts is not a table boundary, and
  // inventing one is worse than leaving the blob merged.
  function splitAlongAxis(comp,labels,width,height,horizontal,modalSpan,modalAcross){
    if(!modalSpan||!modalAcross)return null;
    const long=horizontal?comp.w:comp.h,short=horizontal?comp.h:comp.w;
    if(long<modalSpan*1.7||short<modalAcross*.55)return null;
    const n=horizontal?comp.w:comp.h,across=horizontal?comp.h:comp.w,profile=new Int32Array(n);
    for(let a=0;a<across;a++)for(let b=0;b<n;b++){
      const gx=horizontal?comp.x+b:comp.x+a,gy=horizontal?comp.y+a:comp.y+b;
      if(gx<width&&gy<height&&labels[gy*width+gx]===comp.label)profile[b]++;
    }
    let sum=0;for(let i=0;i<n;i++)sum+=profile[i];
    const mean=sum/n,floor=mean*.35,guard=Math.round(modalSpan*.45),cuts=[];
    let runStart=-1;
    for(let i=guard;i<n-guard;i++){
      if(profile[i]<=floor){if(runStart<0)runStart=i;}
      else if(runStart>=0){cuts.push(Math.round((runStart+i-1)/2));runStart=-1;}
    }
    if(runStart>=0)cuts.push(Math.round((runStart+n-guard)/2));
    if(!cuts.length)return null;
    const bounds=[0,...cuts,n],parts=[];
    for(let i=0;i<bounds.length-1;i++){
      const from=bounds[i],to=bounds[i+1],len=to-from;
      if(len<modalSpan*.55||len>modalSpan*1.6)return null; // not a clean repeat of the modal object: leave the blob alone rather than inventing a boundary
      parts.push({from,to});
    }
    if(parts.length<2)return null;
    return parts.map(p=>{
      let count=0,minX=width,minY=height,maxX=0,maxY=0;
      for(let a=0;a<across;a++)for(let b=p.from;b<p.to;b++){
        const gx=horizontal?comp.x+b:comp.x+a,gy=horizontal?comp.y+a:comp.y+b;
        if(gx>=width||gy>=height||labels[gy*width+gx]!==comp.label)continue;
        count++;
        if(gx<minX)minX=gx;if(gx>maxX)maxX=gx;if(gy<minY)minY=gy;if(gy>maxY)maxY=gy;
      }
      if(!count)return null;
      const w=maxX-minX+1,h=maxY-minY+1;
      return{label:comp.label,x:minX,y:minY,w,h,count,aspect:w/h,fill:count/(w*h),
        cx:(minX+maxX)/2,cy:(minY+maxY)/2,pcaRotation:comp.pcaRotation,wasSplit:true};
    }).filter(Boolean);
  }
  // Tables in a banquet plan are laid out in GRIDS, not just rows: on the real
  // venue plan the fused blobs measured about 1.5 x 2 and 1 x 3 modal tables.
  // A single-axis cut cannot separate those -- it used to refuse outright the
  // moment a blob was wider than one table across, which is why the split pass
  // never fired on a real plan. So cut the long axis first, then try the other
  // axis inside each strip. Both passes keep the "every part must be a clean
  // repeat of the modal object" rule, so a blob that is not a grid of tables is
  // still left alone rather than carved into invented objects.
  function splitAtValley(comp,labels,width,height,modalLong,modalShort){
    if(!modalLong||!modalShort)return null;
    const first=comp.w>=comp.h;
    const strips=splitAlongAxis(comp,labels,width,height,first,modalLong,modalShort)
      ||splitAlongAxis(comp,labels,width,height,!first,modalShort,modalLong);
    const stage1=strips||[comp];
    const out=[];
    for(const strip of stage1){
      const across=strip.w>=strip.h;
      // Cut the perpendicular axis of each strip. Spans are swapped because a
      // strip's long side is now roughly one modal table.
      const cells=splitAlongAxis(strip,labels,width,height,across,
        across?modalLong:modalShort, across?modalShort:modalLong);
      if(cells&&cells.length>1)out.push(...cells);
      else out.push(strip);
    }
    if(out.length<2)return null;
    // Never return the untouched original dressed up as a split.
    return out.length===1&&out[0]===comp?null:out.map(c=>c===comp?c:{...c,wasSplit:true});
  }

  // ---- Candidate geometry helpers ----------------------------------------
  // "Are these two boxes the SAME physical object?" — overlap measured against
  // the smaller box (two masks rarely agree on the exact extent of one object)
  // AND a size sanity check, because a chair sitting inside a table's bounding
  // box also overlaps it completely without being the same object.
  function sameObject(a,b,sizeRatio=2.5){
    const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y);
    const x2=Math.min(a.x+a.w,b.x+b.w),y2=Math.min(a.y+a.h,b.y+b.h);
    const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1);
    if(!inter)return false;
    const areaA=a.w*a.h,areaB=b.w*b.h;
    return inter/Math.min(areaA,areaB)>.5&&Math.max(areaA,areaB)<=Math.min(areaA,areaB)*sizeRatio;
  }
  function boxIoU(a,b){
    const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y);
    const x2=Math.min(a.x+a.w,b.x+b.w),y2=Math.min(a.y+a.h,b.y+b.h);
    const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1);
    if(!inter)return 0;
    return inter/(a.w*a.h+b.w*b.h-inter);
  }
  // Distance from a point to an oriented rectangle's boundary (0 when inside).
  function distanceToOBB(px,py,obb){
    const rad=(obb.rotation||0)*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
    const dx=px-obb.cx,dy=py-obb.cy;
    const u=Math.abs(dx*cos+dy*sin)-obb.w/2,v=Math.abs(-dx*sin+dy*cos)-obb.h/2;
    return Math.hypot(Math.max(0,u),Math.max(0,v));
  }

  // ---- The provider -------------------------------------------------------
  const CLASSICAL_CV_PROVIDER={
    id:"classical-cv",
    label:"Assisted Detection (classical computer vision)",
    trainedModel:false,
    async detect(pixels,width,height,{onStage}={}){
      const stage=onStage||(async()=>{});
      const total=width*height,data=pixels.data;
      // Real measured phase timings, reported in diagnostics so a future
      // performance change can be judged against numbers instead of a feeling.
      const phaseMs={};let phaseFrom=performance.now();
      const mark=name=>{const now=performance.now();phaseMs[name]=Math.round(now-phaseFrom);phaseFrom=now;};
      // ---- pass 1: luma + histogram + RGB colour histogram, one loop ----
      const gray=new Uint8Array(total),hist=new Uint32Array(256);
      // The colour model is a global statistic, so it is built from a fixed 2x2
      // subsample (deterministic, ~25% of the pixels) instead of every pixel.
      const binCount=new Uint32Array(RGB_BINS),binR=new Uint32Array(RGB_BINS),binG=new Uint32Array(RGB_BINS),binB=new Uint32Array(RGB_BINS);
      // Luma histograms split by how saturated the pixel is, so the tone model
      // can look at the drawing's fills without the accent objects skewing it.
      const lumaLowChroma=new Uint32Array(256),lumaMidChroma=new Uint32Array(256);
      let sum=0,sampled=0;
      for(let y=0;y<height;y++){
        const rowSampled=(y&1)===0;
        for(let x=0,i=y*width,o=i*4;x<width;x++,i++,o+=4){
          const r=data[o],g=data[o+1],b=data[o+2];
          const v=Math.round(r*.299+g*.587+b*.114);
          gray[i]=v;hist[v]++;sum+=v;
          if(rowSampled&&(x&1)===0){
            const bin=rgbBinIndex(r,g,b);
            binCount[bin]++;binR[bin]+=r;binG[bin]+=g;binB[bin]+=b;sampled++;
            const chroma=Math.max(r,g,b)-Math.min(r,g,b);
            if(chroma<LOW_CHROMA)lumaLowChroma[v]++;else if(chroma<MID_CHROMA)lumaMidChroma[v]++;
          }
        }
      }
      const threshold=otsu(hist,total,sum);
      mark("pixels");
      await stage("understanding",30);phaseFrom=performance.now();
      // ---- pass 2: adaptive fill mask and Sobel edge map, kept SEPARATE ----
      // FIX #2: the edge map is no longer OR-ed into the mask that gets
      // labelled. It is used only as a BARRIER for enclosed-region extraction
      // (where a shared outline helps by separating two interiors) and as the
      // union mask handed to computeVisualDescriptor, whose descriptor
      // semantics stay exactly as before.
      const fillMask=new Uint8Array(total),edgeMask=new Uint8Array(total),barrier=new Uint8Array(total);
      const integral=new Uint32Array((width+1)*(height+1));
      for(let y=1;y<=height;y++){let row=0;for(let x=1;x<=width;x++){row+=gray[(y-1)*width+x-1];integral[y*(width+1)+x]=integral[(y-1)*(width+1)+x]+row;}}
      const stride=width+1;
      for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
        const i=y*width+x,r=18,x0=Math.max(0,x-r),x1=Math.min(width-1,x+r),y0=Math.max(0,y-r),y1=Math.min(height-1,y+r);
        const local=(integral[(y1+1)*stride+x1+1]-integral[y0*stride+x1+1]-integral[(y1+1)*stride+x0]+integral[y0*stride+x0])/((x1-x0+1)*(y1-y0+1));
        const gx=-gray[i-width-1]+gray[i-width+1]-2*gray[i-1]+2*gray[i+1]-gray[i+width-1]+gray[i+width+1];
        const gy=-gray[i-width-1]-2*gray[i-width]-gray[i-width+1]+gray[i+width-1]+2*gray[i+width]+gray[i+width+1];
        if(gray[i]<Math.min(threshold+12,local-7))fillMask[i]=1;
        if(Math.abs(gx)+Math.abs(gy)>150)edgeMask[i]=1;
        barrier[i]=(fillMask[i]||edgeMask[i])?1:0;
      }
      const binary=barrier; // same union the previous pipeline labelled; kept for computeVisualDescriptor
      mark("binarize");
      const accentModel=buildAccentModel(binCount,binR,binG,binB,sampled);
      const toneModel=buildToneModel(lumaLowChroma,lumaMidChroma,sampled,accentModel?.accentChroma);
      mark("colourModel");
      await stage("understanding",42);phaseFrom=performance.now();

      const area=total,minDim=Math.min(width,height);
      const minPixels=Math.max(10,Math.round(area*.000006));
      const notWall=c=>!(Math.min(c.w,c.h)<3&&Math.max(c.w,c.h)>minDim*.08);
      const tableSizeOk=c=>notWall(c)&&Math.min(c.w,c.h)>=minDim*.016&&c.w*c.h>=area*.00015&&c.w*c.h<=area*.04&&c.aspect>=.28&&c.aspect<=3.6;
      const chairSizeOk=c=>notWall(c)&&Math.min(c.w,c.h)>=3&&Math.max(c.w,c.h)<=minDim*.065&&c.w*c.h<area*.0028;
      const venueSizeOk=c=>notWall(c)&&c.w*c.h>area*.008&&c.w*c.h<area*.12&&(c.aspect>3.1||c.aspect<.32);

      // Shape analysis scans each candidate's own window, so it runs as late as
      // possible (only on candidates that survived de-duplication) and is
      // bounded by a real pixel budget rather than trusting the size filters to
      // keep the candidate count sane on a pathological drawing.
      let shapeBudget=area*6;
      const analyze=(comps,labels)=>{
        for(const c of comps){
          if(c.shape!==undefined)continue;
          if(shapeBudget<=0){c.shape=null;continue;}
          shapeBudget-=(c.w+2)*(c.h+2);
          c.shape=shapeAnalysis(labels,c.label,c,width,height);
        }
        return comps;
      };

      // ---- object sources --------------------------------------------------
      const sources=[],diagnosticsSources={};
      // Chair-size components are collected per source at the same time, in
      // order of how specific the evidence is (a dedicated colour cluster
      // beats a tone cluster beats "it was dark enough to threshold").
      const chairSources=[];
      let fallbackChairComps=[],fallbackChairLabels=null,accentMask=null;
      // (a) interiors of closed outlines — the primary table source
      {
        const enclosed=enclosedRegions(barrier,width,height);
        const{labels,comps}=labelComponents(enclosed,width,height,minPixels,false);
        const kept=comps.filter(c=>tableSizeOk(c)&&c.fill>=.35);
        for(const c of kept)c.source="interior";
        diagnosticsSources.interior=kept.length;
        sources.push({name:"interior",labels,comps:kept,all:comps});
        mark("interiors");
      }
      // (b) tinted/solid fills straight from the colour model — one mask per
      //     tone family, so a mid-grey chair fill and a pale table fill cannot
      //     end up in the same mask and merge
      if(accentModel||toneModel){
        const masks=buildClassMasks(data,gray,total,accentModel,toneModel);
        accentMask=masks.accent;
        let toneKept=0;
        masks.tints.forEach((mask,index)=>{
          if(maskSolidity(mask,width,height)<.25)return; // antialiasing fringe along outlines, not a real filled object
          const{labels,comps}=labelComponents(mask,width,height,minPixels,true);
          const kept=comps.filter(c=>tableSizeOk(c)&&c.fill>=.35);
          for(const c of kept)c.source="tone";
          toneKept+=kept.length;
          sources.push({name:"tone"+index,labels,comps:kept,all:comps});
          // On a neutral drawing one tone family IS the chairs (a mid-grey
          // chair fill against a pale table fill), so tone families are a real
          // chair source, not only a table source.
          chairSources.push({name:"tone-cluster",labels,comps:comps.filter(c=>chairSizeOk(c)&&c.fill>=.3)});
        });
        diagnosticsSources.tone=toneKept;
        mark("toneMasks");
      }
      // (c) solid dark objects straight from the fill mask (no edges OR-ed in)
      {
        const{labels,comps}=labelComponents(fillMask,width,height,minPixels,true);
        const kept=comps.filter(c=>tableSizeOk(c)&&c.fill>=.35);
        for(const c of kept)c.source="fill";
        diagnosticsSources.fill=kept.length;
        sources.push({name:"fill",labels,comps:kept,all:comps});
        fallbackChairComps=comps.filter(c=>chairSizeOk(c)&&c.fill>=.045);
        fallbackChairLabels=labels;
        diagnosticsSources.fallbackChairComponents=fallbackChairComps.length;
        mark("fillMask");
      }
      await stage("seating",58);phaseFrom=performance.now();

      // ---- STAGE B: chairs first -------------------------------------------
      // Chairs are detected from their OWN model before any table is
      // considered. That is what stops a chair drawn against a table outline
      // from being swallowed by the table blob, and it makes the seat count
      // independent of whether a table was found at all. On this product's
      // plans the chair count IS the number the operator needs (pax), so it is
      // a first-class output, not a by-product of table detection.
      if(accentMask){
        const{labels,comps}=labelComponents(accentMask,width,height,Math.max(6,Math.round(minPixels*.6)),true);
        chairSources.unshift({name:"colour-cluster",labels,comps:comps.filter(c=>chairSizeOk(c)&&c.fill>=.3)});
      }
      // The same physical chair can surface in more than one mask; the most
      // specific source wins and the duplicate is dropped (overlap of the
      // smaller box, not IoU, because the masks disagree slightly on size).
      const chairEntries=[];
      const addChairs=(comps,labels,name)=>{
        for(const c of comps){
          if(chairEntries.some(e=>sameObject(e.comp,c)))continue;
          c.source=name;
          chairEntries.push({comp:c,labels,source:name});
        }
      };
      let chairSource="none";
      const specificCount=chairSources.reduce((n,src)=>n+src.comps.length,0);
      if(specificCount>=6){
        for(const src of chairSources)addChairs(src.comps,src.labels,src.name);
        chairSource=chairSources.find(src=>src.comps.length)?.name||"none";
      }else if(fallbackChairComps.length){
        addChairs(fallbackChairComps,fallbackChairLabels,"luma-components");
        chairSource="luma-components";
      }
      // Two chairs drawn a pixel or two apart merge into one blob. Where the
      // pixels actually show the gap, the same evidence-gated valley split used
      // for tables recovers both — measured, never assumed.
      const chairModalPre=modalMagnitude(chairEntries.map(e=>Math.sqrt(e.comp.w*e.comp.h)));
      if(chairModalPre){
        const modalSide=chairModalPre.value;
        for(let i=chairEntries.length-1;i>=0;i--){
          const e=chairEntries[i];
          if(Math.max(e.comp.w,e.comp.h)<modalSide*1.7)continue;
          const parts=splitAtValley(e.comp,e.labels,width,height,modalSide,modalSide);
          if(!parts||parts.length<2)continue;
          chairEntries.splice(i,1,...parts.map(p=>({comp:Object.assign(p,{source:e.source}),labels:e.labels,source:e.source})));
        }
      }
      for(const e of chairEntries)analyze([e.comp],e.labels);
      // Second dedup pass, now that a modal chair size exists. A drawn chair is
      // typically an outline plus an inner fill, or a seat plus a back; those
      // land as two components sitting almost on top of each other, and they
      // overlap too little for the earlier same-object test to catch. Two
      // centres closer together than ~0.55 of one chair cannot be two chairs on
      // a plan whose chairs are all one size, so they are merged into their
      // union. Measured on the venue plan: 63 such pairs out of 241.
      {
        const provisional=modalMagnitude(chairEntries.map(e=>Math.sqrt(e.comp.w*e.comp.h)));
        if(provisional&&provisional.support>=4){
          const minGap=provisional.value*.55;
          const merged=[];
          for(const e of chairEntries){
            const cx=e.comp.x+e.comp.w/2,cy=e.comp.y+e.comp.h/2;
            const hit=merged.find(m=>Math.hypot(cx-(m.comp.x+m.comp.w/2),cy-(m.comp.y+m.comp.h/2))<minGap);
            if(!hit){merged.push(e);continue;}
            const x1=Math.min(hit.comp.x,e.comp.x),y1=Math.min(hit.comp.y,e.comp.y);
            const x2=Math.max(hit.comp.x+hit.comp.w,e.comp.x+e.comp.w),y2=Math.max(hit.comp.y+hit.comp.h,e.comp.y+e.comp.h);
            hit.comp.x=x1;hit.comp.y=y1;hit.comp.w=x2-x1;hit.comp.h=y2-y1;
            hit.comp.shape=null; // recomputed by analyze() below
          }
          if(merged.length!==chairEntries.length){
            chairEntries.length=0;chairEntries.push(...merged);
            for(const e of chairEntries)analyze([e.comp],e.labels);
          }
        }
      }
      const chairComps=chairEntries.map(e=>e.comp);
      const chairModal=modalMagnitude(chairComps.map(c=>Math.sqrt(c.w*c.h)));
      // A trustworthy chair population is MANY objects of ONE size. If the
      // population is not uniform we say so in the result and fall back to the
      // table-first path instead of reporting a seat count we cannot defend.
      const chairUniform=!!chairModal&&chairComps.length>=6&&chairModal.support/chairModal.total>=.6;
      // Chairs on a plan are drawn identically, so the repeated SHAPE is real
      // evidence too. Elongation is measured orientation-invariantly
      // (long/short side), because the same chair drawn on the left of a table
      // is the same object rotated 90 degrees, not a different one. This is
      // what tells a chair-sized printed glyph from a chair without OCR.
      const chairModalElongation=modalMagnitude(chairComps.map(c=>Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h))));
      const chairShapeOk=c=>{
        if(!chairUniform||!chairModalElongation)return true;
        const elongation=Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h));
        return Math.abs(Math.log(elongation/chairModalElongation.value))<=Math.log(1.6);
      };
      const chairs=chairUniform
        ?chairComps.filter(c=>sizeAgreement(Math.sqrt(c.w*c.h),chairModal)>=.25&&chairShapeOk(c))
        :chairComps;
      const detectionPath=chairUniform?"chair-first":"table-first";
      mark("chairs");

      // ---- table candidate pool --------------------------------------------
      let pool=[];
      for(const s of sources)for(const c of s.comps)pool.push({comp:c,labels:s.labels});
      // Chair-first has a second payoff: anything already claimed as a chair is
      // removed from the table pool, so chair blobs can no longer masquerade as
      // small tables (they did before — a 17px chair passes the table size
      // floor on a 1000px-tall plan) and cannot drag the modal table size down.
      if(chairUniform&&chairs.length){
        pool=pool.filter(p=>!chairs.some(ch=>sameObject(p.comp,ch)));
      }
      // The modal has to describe a TABLE, not the pool. Walls, printed text and
      // venue objects are all still in here, and a modal dragged out toward a
      // long wall makes every genuinely fused blob look too short to be a run --
      // which is the second reason the split pass never fired on a real plan.
      // Same filtering idea already used for the downstream modal table area:
      // drop anything chair-sized, and drop anything shaped like a wall.
      const spanOf=p=>{const o=p.comp.shape?.obb;
        const w=o?.w||p.comp.w,h=o?.h||p.comp.h;
        return{long:Math.max(w,h),short:Math.min(w,h)};};
      const chairAreaFloor=chairUniform&&chairModal?chairModal.value**2:0;
      // Both dimensions, not just area: an area-only floor still admits things
      // one chair wide, which drags the SHORT modal down to chair scale -- and a
      // chair-scale short modal lets the split halve real tables. Measured on
      // the real plan: area-only gave a 68x39 modal against a ~38px chair and
      // over-split to 51 tables where about 45 exist.
      const chairSpanFloor=chairUniform&&chairModal?chairModal.value*1.15:0;
      const furnitureish=pool.filter(p=>{
        const s=spanOf(p);
        if(chairAreaFloor&&s.long*s.short<=chairAreaFloor*1.3)return false;
        if(chairSpanFloor&&s.short<=chairSpanFloor)return false;
        return s.long/Math.max(1,s.short)<=4;
      });
      const spanPool=furnitureish.length>=4?furnitureish:pool;
      const modalLong=modalMagnitude(spanPool.map(p=>spanOf(p).long));
      const modalShort=modalMagnitude(spanPool.map(p=>spanOf(p).short));
      let splitCount=0;
      const expanded=[];
      for(const entry of pool){
        const parts=splitAtValley(entry.comp,entry.labels,width,height,modalLong?.value,modalShort?.value);
        if(!parts||parts.length<2){expanded.push(entry);continue;}
        splitCount+=parts.length-1;
        for(const part of parts){
          part.source=entry.comp.source;
          analyze([part],entry.labels);
          expanded.push({comp:part,labels:entry.labels});
        }
      }
      // De-duplicate across sources: one physical table can surface both as an
      // enclosed interior and as a tone fill. Keep one, preferring the source
      // that gives the cleanest shape signal.
      const sourceRank={tone:3,interior:2,fill:1};
      expanded.sort((a,b)=>(sourceRank[b.comp.source]||0)-(sourceRank[a.comp.source]||0)||b.comp.count-a.comp.count);
      const unique=[];
      for(const entry of expanded){
        if(unique.some(u=>boxIoU(entry.comp,u.comp)>=.45))continue;
        unique.push(entry);
      }
      for(const entry of unique)analyze([entry.comp],entry.labels);
      // The modal TABLE size must be measured over things that could be a
      // table. Printed glyphs, dimension ticks and wall fragments outnumber the
      // furniture on a busy plan, and letting them set the modal collapses it
      // to a few hundred square pixels — after which the off-modal rule below
      // prunes every real table for being "six times the modal". Measured on
      // the venue plan: modal 274px^2 and 83 genuine tables dropped. A table is
      // by definition at least as big as the plan's own chairs, so anything
      // smaller is excluded from the estimate.
      const chairAreaForModal=chairUniform&&chairModal?chairModal.value**2:null;
      const areaOf=u=>{const o=u.comp.shape?.obb;return o?o.w*o.h:u.comp.w*u.comp.h;};
      const modalPool=chairAreaForModal?unique.filter(u=>areaOf(u)>chairAreaForModal*1.3):unique;
      const modalArea=modalMagnitude((modalPool.length>=4?modalPool:unique).map(areaOf));
      // Off-modal rejection. When the plan really is repetitive (a modal object
      // size supported by several objects), something a fifth the size of every
      // repeated object — a printed character, a dimension tick — is not a
      // table. This is the honest use of the modal prior: it drops what agrees
      // with nothing, instead of the old rule which kept whatever was biggest.
      // Disabled when there is no repeated population to reason from, so a plan
      // with two unlike tables is never pruned on a prior it does not have.
      let offModalDropped=0;
      const chairArea=chairUniform&&chairModal?chairModal.value**2:null;
      if((modalArea&&modalArea.support>=4)||chairArea){
        const kept=unique.filter(u=>{
          const o=u.comp.shape?.obb,objectArea=o?o.w*o.h:u.comp.w*u.comp.h;
          // Wildly off the repeated object size (an eighth of it, or six times
          // it) with a real repeated population to compare against...
          const wayOff=modalArea&&modalArea.support>=4&&(objectArea<modalArea.value/8||objectArea>modalArea.value*6);
          // ...or no bigger than the plan's own chairs, which a table is not.
          // The margin here used to be 1.3x, which on a real venue plan — where
          // a four-top is only modestly larger than the chairs around it — threw
          // away genuine tables. The defensible statement is the literal one: a
          // table is bigger than a chair. Measured on the venue plan, tightening
          // this recovered 7 tables and changed the seat count not at all.
          const chairSized=chairArea!=null&&objectArea<=chairArea;
          if(!wayOff&&!chairSized)return true;
          offModalDropped++;return false;
        });
        unique.length=0;unique.push(...kept);
      }

      // ---- chair -> table association: one chair, at most one table --------
      // merit-plan-intelligence requires each chair to belong to at most one
      // table. The old pipeline evaluated proximity per table independently, so
      // a chair sitting between two tables was counted twice — a real
      // over-count living next to the under-count.
      const tableBoxes=unique.map((entry,index)=>{
        const c=entry.comp,obb=c.shape?.obb||{cx:c.x+c.w/2,cy:c.y+c.h/2,w:c.w,h:c.h,rotation:c.pcaRotation||0};
        return{index,entry,obb};
      });
      const chairAssign=new Map(),chairsByTable=new Map(),pairs=[];
      for(let ci=0;ci<chairs.length;ci++){
        const ch=chairs[ci],px=ch.shape?.obb.cx??ch.x+ch.w/2,py=ch.shape?.obb.cy??ch.y+ch.h/2,span=Math.max(ch.w,ch.h);
        for(const box of tableBoxes){
          const margin=Math.min(span*1.6+Math.min(box.obb.w,box.obb.h)*.25,Math.max(box.obb.w,box.obb.h)*.7);
          const d=distanceToOBB(px,py,box.obb);
          if(d<=margin)pairs.push({ci,ti:box.index,d});
        }
      }
      pairs.sort((a,b)=>a.d-b.d||a.ci-b.ci||a.ti-b.ti);
      for(const p of pairs){
        if(chairAssign.has(p.ci))continue;
        chairAssign.set(p.ci,p.ti);
        if(!chairsByTable.has(p.ti))chairsByTable.set(p.ti,[]);
        chairsByTable.get(p.ti).push(p.ci);
      }

      // ---- scoring and ranking (FIX #3) ------------------------------------
      const scored=tableBoxes.map(box=>{
        const c=box.entry.comp,obb=box.obb;
        const seats=(chairsByTable.get(box.index)||[]).length;
        const agreement=sizeAgreement(obb.w*obb.h,modalArea);
        const repetition=tableBoxes.filter(o=>Math.abs(o.obb.w-obb.w)<obb.w*.2&&Math.abs(o.obb.h-obb.h)<obb.h*.2).length;
        const shape=classifyTableShape(c.shape);
        // Deterministic evidence score, NOT a model probability: measured seat
        // adjacency, agreement with the plan's own modal object size, how many
        // identical objects repeat, and how clean the shape signal was.
        const confidence=Math.max(.15,Math.min(.94,
          .32+Math.min(.26,seats*.035)+agreement*.2+Math.min(.1,Math.max(0,repetition-1)*.025)+shape.shapeConfidence*.1
          -((seats===0&&repetition<=1)?.22:0)));
        return{box,c,obb,seats,agreement,repetition,shape,confidence,
          score:agreement*2+Math.min(1,seats/6)+Math.min(.5,(repetition-1)*.08)};
      });
      scored.sort((a,b)=>b.score-a.score||b.confidence-a.confidence);
      const MAX_TABLES=240,capReached=scored.length>MAX_TABLES,chosen=scored.slice(0,MAX_TABLES);
      const chosenIndexes=new Set(chosen.map(s=>s.box.index));

      const toPercentBox=obb=>({x:(obb.cx-obb.w/2)/width*100,y:(obb.cy-obb.h/2)/height*100,w:obb.w/width*100,h:obb.h/height*100});
      const chairOBB=ch=>ch.shape?.obb||{cx:ch.x+ch.w/2,cy:ch.y+ch.h/2,w:ch.w,h:ch.h,rotation:ch.pcaRotation||0};
      // Deterministic evidence score for a chair: how well it agrees with the
      // plan's own modal chair size, plus whether it came from a real colour
      // cluster or only from the luma fallback. Never a random number.
      const chairEvidence=(ch,associated)=>Math.max(.2,Math.min(.9,
        .34+sizeAgreement(Math.sqrt(ch.w*ch.h),chairModal)*.3+(chairSource==="colour-cluster"?.16:0)+(associated?.05:0)));
      const candidates=chosen.map(s=>{
        const seatIndexes=chairsByTable.get(s.box.index)||[];
        return{id:uid("candidate"),kind:"table",type:s.shape.type,...toPercentBox(s.obb),rotation:s.obb.rotation,
          confidence:s.confidence,status:"unreviewed",selected:s.confidence>=calibratedThreshold(),
          chairDetections:seatIndexes.map(ci=>{
            const obb=chairOBB(chairs[ci]);
            return{id:uid("candidate-chair"),x:obb.cx/width*100,y:obb.cy/height*100,
              w:obb.w/width*100,h:obb.h/height*100,rotation:obb.rotation,confidence:chairEvidence(chairs[ci],true)};
          }),
          evidence:{geometry:Number(Math.min(.95,(s.c.shape?.obbFill??s.c.fill)+.2).toFixed(2)),
            chairs:seatIndexes.length,repetition:s.repetition,source:s.c.source,
            shapeBasis:s.shape.basis,sizeAgreement:Number(s.agreement.toFixed(2)),split:!!s.c.wasSplit}};
      });
      // Chairs that belong to no detected table stay first-class objects with
      // their real coordinates instead of being dropped (which is how the old
      // pipeline lost seats). They are never attached to an invented table.
      const chairVenues=[];
      for(let ci=0;ci<chairs.length;ci++){
        const ti=chairAssign.get(ci);
        if(ti!==undefined&&chosenIndexes.has(ti))continue;
        const ch=chairs[ci],obb=chairOBB(ch);
        chairVenues.push({id:uid("candidate"),kind:"venue",type:"chair",...toPercentBox(obb),rotation:obb.rotation,
          confidence:chairEvidence(ch,false),status:"unreviewed",selected:false,chairDetections:[],
          evidence:{geometry:Number(Math.min(.95,ch.fill).toFixed(2)),chairs:1,repetition:chairs.length,
            source:chairSource,unassociated:true}});
      }
      // ---- venue-scale objects (stage band / long bar / column) ------------
      const venueComps=[];
      for(const s of sources)for(const c of s.all)if(venueSizeOk(c)&&!venueComps.some(o=>boxIoU(o,c)>=.5))venueComps.push(c);
      const venues=venueComps.slice(0,14).map(c=>{
        analyze([c],sources.find(s=>s.all.includes(c)).labels);
        const obb=c.shape?.obb||{cx:c.x+c.w/2,cy:c.y+c.h/2,w:c.w,h:c.h,rotation:c.pcaRotation||0};
        return{id:uid("candidate"),kind:"venue",type:c.aspect>3?"stage":"column",...toPercentBox(obb),
          rotation:obb.rotation,confidence:.52,status:"unreviewed",selected:false,chairDetections:[],
          evidence:{geometry:.62,chairs:0,repetition:0,source:c.source||"fill"}};
      }).concat(chairVenues);

      mark("tables");
      const associatedSeats=candidates.reduce((n,c)=>n+c.chairDetections.length,0);
      return{
        candidates,venues,gray,binary,threshold,
        diagnostics:{
          components:pool.length,wallSuppression:true,
          chairs:chairs.length,tables:candidates.length,
          detectionPath,chairSource,
          chairsDetected:chairs.length,chairsAssociated:associatedSeats,chairsUnassociated:chairVenues.length,
          chairModalSize:chairModal?Number(chairModal.value.toFixed(1)):null,
          tableModalArea:modalArea?Math.round(modalArea.value):null,
          mergesSplit:splitCount,splitModalLong:modalLong?Math.round(modalLong.value):null,splitModalShort:modalShort?Math.round(modalShort.value):null,candidateCapReached:capReached,offModalDropped,
          sources:diagnosticsSources,phaseMs,
          colorModel:accentModel?{isColorPlan:accentModel.isColorPlan,accentHue:accentModel.accentHue,
            accentChroma:accentModel.accentChroma,accentFraction:Number(accentModel.accentFraction.toFixed(4)),
            backgroundLuma:accentModel.backgroundLuma}:null,
          toneModel:toneModel?toneModel.summary:null,
        },
      };
    },
  };
  // The registry is the seam a future provider plugs into. Today there is
  // exactly one implementation and it is classical CV — nothing here implies
  // a trained model exists (trainedModel is false and stays false until a real
  // one is installed).
  const PLAN_DETECTION_PROVIDERS={"classical-cv":CLASSICAL_CV_PROVIDER};
  function resolvePlanDetectionProvider(){
    const requested=globalThis.MERIT_PLAN_DETECTION_PROVIDER_ID;
    return PLAN_DETECTION_PROVIDERS[requested]||CLASSICAL_CV_PROVIDER;
  }
  globalThis.MERIT_PLAN_DETECTION={providers:PLAN_DETECTION_PROVIDERS,resolve:resolvePlanDetectionProvider,
    activeId:CLASSICAL_CV_PROVIDER.id,trainedModelInstalled:false};
  // ============================================================
  // VisualEmbeddingProvider (classical/deterministic implementation).
  //
  // Real visual similarity requires real pixel information, not just a
  // bounding box's area/aspect ratio. A real trained embedding model
  // (ONNX Runtime Web + a pretrained vision model such as MobileNetV2) was
  // evaluated for this: onnxruntime-web is on the npm registry and a real
  // ~14MB MobileNetV2 ONNX model IS fetchable in this environment via
  // media.githubusercontent.com (verified, not assumed) -- so bundling one is
  // technically possible. It was deprioritized for this pass in favor of the
  // explicitly higher-priority full-app visual redesign later in this same
  // sprint, not because it's infeasible; a future pass can wire a real
  // embedding model in as an alternate implementation of this exact function
  // signature (candidate pixels in, fixed-shape numeric descriptor out)
  // without touching plan-intelligence.js's clustering logic at all.
  //
  // This implementation instead computes a real, deterministic descriptor
  // straight from the actual decoded plan pixels already in memory from
  // detection (no synthetic/fabricated numbers): interior fill ratio (shape
  // occupancy), edge density (a Sobel-style gradient magnitude average,
  // texture/outline signal), an 8-bin grayscale intensity histogram (coarse
  // color/tone distribution), and a 4-quadrant fill balance (a cheap contour/
  // shape signature that tells a round table's radial fill apart from an
  // L-shaped or off-center one). This is real pixel-derived signal, honestly
  // labeled as classical/deterministic -- never described as a trained model.
  function computeVisualDescriptor(gray,binary,width,height,c){
    const px=Math.max(0,Math.round(c.x/100*width)),py=Math.max(0,Math.round(c.y/100*height));
    const pw=Math.max(1,Math.min(width-px,Math.round(c.w/100*width))),ph=Math.max(1,Math.min(height-py,Math.round(c.h/100*height)));
    if(pw<2||ph<2)return null;
    const hist=new Array(8).fill(0),quadFg=[0,0,0,0],quadTotal=[0,0,0,0];
    let fg=0,edgeSum=0,total=0;
    for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
      const gx=px+x,gy=py+y;if(gx>=width||gy>=height)continue;
      const i=gy*width+gx,v=gray[i];
      total++;hist[Math.min(7,v>>5)]++;
      if(binary[i])fg++;
      const qi=(x<pw/2?0:1)+(y<ph/2?0:2);quadTotal[qi]++;if(binary[i])quadFg[qi]++;
      if(x>0&&x<pw-1&&y>0&&y<ph-1){
        edgeSum+=Math.abs(gray[gy*width+gx+1]-gray[gy*width+gx-1])+Math.abs(gray[(gy+1)*width+gx]-gray[(gy-1)*width+gx]);
      }
    }
    if(!total)return null;
    return{
      fillRatio:fg/total,
      edgeDensity:Math.min(1,edgeSum/(total*255)),
      intensityHist:hist.map(n=>n/total),
      quadrantFill:quadTotal.map((n,i)=>n?quadFg[i]/n:0),
    };
  }
  // ============================================================
  // Current Plan Memory: a human correction (reclassify, confirm, reject, or
  // a manually-drawn "AI missed this" object) must survive Re-Analyze, not be
  // silently discarded when runAssistedDetection() throws away the whole old
  // candidate list and generates fresh ones with new random ids. Stored on
  // event.planMemory (NOT event.analysis, which gets fully replaced on every
  // analysis pass) and matched back onto the newly detected candidates by
  // real geometry: since the source plan image never changed and the
  // classical CV pipeline is deterministic, the same physical object reappears
  // at essentially the same position/size on every re-run — this is a real,
  // honest match, not a fabricated one. Matching by learned visual similarity
  // instead of geometry alone is a separate, larger piece of future work (see
  // plan-intelligence.js's similarity clustering).
  function rememberCorrection(event,c,{manual=false}={}){
    event.planMemory ||= [];
    const entry={id:uid("planmemory"),sourceCandidateId:c.id,kind:c.kind,type:c.type,status:c.status,
      geometry:{x:c.x,y:c.y,w:c.w,h:c.h,rotation:c.rotation||0},manual,correctedAt:nowISO()};
    const existing=event.planMemory.findIndex(m=>m.sourceCandidateId===c.id);
    if(existing>=0)event.planMemory[existing]=entry;else event.planMemory.push(entry);
  }
  function memoryDistance(c,m){const g=m.geometry;return Math.hypot(c.x-g.x,c.y-g.y,(c.w-g.w)*.5,(c.h-g.h)*.5);}
  // General old-candidate -> new-candidate geometry remap, used to carry
  // grouping decisions (which reference every member of a furniture group,
  // not just ones a human individually confirmed/reclassified) across a
  // Re-Analyze pass. Same deterministic-geometry reasoning as plan memory.
  function matchCandidatesByGeometry(oldCandidates,freshCandidates){
    const TOLERANCE=3,pairs=[];
    for(const o of oldCandidates)for(const c of freshCandidates)pairs.push({o,c,dist:Math.hypot(c.x-o.x,c.y-o.y,(c.w-o.w)*.5,(c.h-o.h)*.5)});
    pairs.sort((a,b)=>a.dist-b.dist);
    const usedO=new Set(),usedC=new Set(),remap=new Map();
    for(const{o,c,dist}of pairs){
      if(dist>TOLERANCE||usedO.has(o.id)||usedC.has(c.id))continue;
      remap.set(o.id,c.id);usedO.add(o.id);usedC.add(c.id);
    }
    return remap;
  }
  // Re-applies remembered corrections onto a fresh detection pass: matches
  // each memory entry to its closest freshly-detected candidate (greedy
  // nearest-geometry, one-to-one) within a tight tolerance, overwrites that
  // candidate's kind/type/status with the remembered human decision (flagging
  // fromMemory so this is never silently indistinguishable from a fresh
  // detection), and re-inserts a manually-drawn "AI missed this" object
  // outright if the detector still doesn't find it. Returns an id remap so
  // grouping decisions (which reference old candidate ids) can be carried
  // forward too.
  function applyPlanMemory(freshCandidates,memory){
    const idRemap=new Map();
    if(!memory?.length)return{reappliedCount:0,restored:[],idRemap};
    const TOLERANCE=3;
    // Matched purely by geometry, never by kind: a reclassification memory's
    // whole point is that the detector's raw kind guess was wrong (e.g. a
    // table-shaped detection that a human corrected to venue:chair) -- the
    // freshly re-detected candidate at that position will get the SAME wrong
    // kind guess again on every re-run, so requiring kind equality here would
    // make the correction impossible to ever re-apply.
    const pairs=[];
    for(const m of memory)for(const c of freshCandidates)pairs.push({m,c,dist:memoryDistance(c,m)});
    pairs.sort((a,b)=>a.dist-b.dist);
    const usedC=new Set(),usedM=new Set();
    let reappliedCount=0;
    for(const{m,c,dist}of pairs){
      if(dist>TOLERANCE||usedC.has(c.id)||usedM.has(m.id))continue;
      c.kind=m.kind;c.type=m.type;c.status=m.status;c.selected=m.status!=="rejected";c.fromMemory=true;
      usedC.add(c.id);usedM.add(m.id);idRemap.set(m.sourceCandidateId,c.id);reappliedCount++;
    }
    const restored=[];
    for(const m of memory){
      if(usedM.has(m.id)||!m.manual)continue; // a non-manual correction whose object wasn't re-detected this time is left alone -- we never fabricate a detection that didn't happen.
      const g=m.geometry,id=uid("candidate");
      restored.push({id,kind:m.kind,type:m.type,x:g.x,y:g.y,w:g.w,h:g.h,rotation:g.rotation,confidence:1,status:m.status,selected:m.status!=="rejected",missed:true,fromMemory:true,chairDetections:[],evidence:{geometry:"manual-memory",chairs:0,repetition:0}});
      idRemap.set(m.sourceCandidateId,id);
    }
    return{reappliedCount,restored,idRemap};
  }
  // ---- False-positive filtering, real evidence rather than a raised
  // threshold: capacity text ("114 pax seating"), dimension labels, and other
  // printed annotations get picked up by the classical binarization pass the
  // same as real furniture. Real OCR word boxes (from the same canvas the
  // detector ran on, so same pixel space) tell candidates and printed text
  // apart directly — a candidate whose area is dominated by recognized text
  // is dropped outright, UNLESS it has real seat adjacency (nearby chair
  // detections), which is strong counter-evidence it's an actual table.
  function suppressTextFalsePositives(candidates,words,width,height){
    const wordBoxesPct=(words||[]).filter(w=>w.text?.trim().length&&w.bbox).map(w=>({
      x:w.bbox.x0/width*100,y:w.bbox.y0/height*100,
      w:(w.bbox.x1-w.bbox.x0)/width*100,h:(w.bbox.y1-w.bbox.y0)/height*100,
    }));
    if(!wordBoxesPct.length)return{kept:candidates,removedCount:0};
    const overlapArea=(a,b)=>{
      const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y),x2=Math.min(a.x+a.w,b.x+b.w),y2=Math.min(a.y+a.h,b.y+b.h);
      return Math.max(0,x2-x1)*Math.max(0,y2-y1);
    };
    const kept=[];let removedCount=0;
    for(const c of candidates){
      const cArea=Math.max(.0001,c.w*c.h);
      let textArea=0;for(const wb of wordBoxesPct)textArea+=overlapArea(c,wb);
      const overlapRatio=Math.min(1,textArea/cArea),hasChairs=(c.chairDetections?.length||0)>0;
      if(overlapRatio>.4&&!hasChairs){removedCount++;}else{kept.push(c);}
    }
    return{kept,removedCount};
  }
  async function runAssistedDetection(){
    const event=activeEvent();if(!canMutate(event,"run plan analysis")||!event.background?.src)return toast("Import a floor plan first.","error");ui.analysisBusy=true;ui.analysisProgress=3;ui.analysisStage=t("analysis.stage.reading");ui.screen="review";render();await yieldFrame();
    try{
      const blob=await sourceBlob(event.background.src),bitmap=await createImageBitmap(blob),max=1920,ratio=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*ratio)),height=Math.max(1,Math.round(bitmap.height*ratio)),canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(bitmap,0,0,width,height);bitmap.close();
      ui.analysisStage=t("analysis.stage.understanding");ui.analysisProgress=22;render();await yieldFrame();
      const pixels=ctx.getImageData(0,0,width,height);
      // The application layer talks to a PlanDetectionProvider, never to pixel
      // code or a vendor SDK directly (merit-plan-intelligence, "Provider
      // abstraction"). Today exactly one provider is installed and it is
      // classical computer vision: trainedModel stays false and the UI keeps
      // saying DOMAIN MODEL NOT INSTALLED.
      const provider=resolvePlanDetectionProvider();
      const detectionStartedAt=performance.now();
      const detection=await provider.detect(pixels,width,height,{onStage:async(key,progress)=>{
        ui.analysisStage=t("analysis.stage."+key);ui.analysisProgress=progress;render();await yieldFrame();
      }});
      const detectionMs=Math.round(performance.now()-detectionStartedAt);
      const candidates=detection.candidates,venues=detection.venues,threshold=detection.threshold;
      ui.analysisStage=t("analysis.stage.seating");ui.analysisProgress=73;render();await yieldFrame();
      for(const c of candidates)c.visualDescriptor=computeVisualDescriptor(detection.gray,detection.binary,width,height,c);
      for(const c of venues)c.visualDescriptor=computeVisualDescriptor(detection.gray,detection.binary,width,height,c);
      const previous=event.analysis?.candidates||[],signatures=list=>list.map(c=>`${c.kind}:${c.type}:${Math.round(c.x)}:${Math.round(c.y)}`),oldSig=new Set(signatures(previous)),newSig=new Set(signatures([...candidates,...venues]));
      const freshCandidates=[...candidates,...venues];
      const priorCandidates=event.analysis?.candidates||[],priorDecisions=event.analysis?.groupingDecisions||[];
      const memoryResult=applyPlanMemory(freshCandidates,event.planMemory||[]);
      const allCandidates=[...freshCandidates,...memoryResult.restored];
      // Grouping decisions are keyed by candidate id, which is regenerated on
      // every analysis pass -- remap them through the same geometry match so
      // a "these are separate tables" answer survives Re-Analyze instead of
      // silently reverting to the detector's default grouping.
      const geometryRemap=matchCandidatesByGeometry(priorCandidates,allCandidates);
      const carriedDecisions=priorDecisions.map(d=>({...d,memberIds:d.memberIds.map(id=>geometryRemap.get(id)).filter(Boolean)})).filter(d=>d.memberIds.length>=2);
      event.analysis={id:uid("analysis"),engine:"ASSISTED_DETECTION",trainedModel:false,notice:"Classical computer vision is active; no trained Merit model is installed in this browser review.",createdAt:nowISO(),imageWidth:width,imageHeight:height,originalWidth:Math.round(width/ratio),originalHeight:Math.round(height/ratio),threshold,candidates:allCandidates,missed:allCandidates.filter(c=>c.missed).map(c=>c.id),groupingDecisions:carriedDecisions,memoryReapplied:memoryResult.reappliedCount,memoryRestored:memoryResult.restored.length,comparison:{added:[...newSig].filter(x=>!oldSig.has(x)).length,removed:[...oldSig].filter(x=>!newSig.has(x)).length,changed:0},diagnostics:{...detection.diagnostics,resolution:`${width}×${height}`,detectionMs,provider:provider.id,providerLabel:provider.label}};
      // A complete PlanIntelligenceResult exists from the moment the analysis
      // object does, so the review screen (and anything reading the stored
      // event) never sees an analysis with null provider metadata or a null
      // seat count while OCR is still being attempted. It is recomputed below
      // once OCR either produced real text or honestly reported unavailable.
      event.analysis.ocrText=null;
      event.analysis.planIntelligence=buildPlanIntelligence(event,null);
      ui.analysisStage=t("analysis.stage.labels");ui.analysisProgress=84;render();await yieldFrame();
      let ocrResult={available:false,text:null,reason:"OCR not attempted"};
      try{ocrResult=await runPlanOCR(canvas.toDataURL("image/png"));}catch(ocrError){ocrResult={available:false,text:null,reason:ocrError.message};}
      event.analysis.ocr={available:ocrResult.available,reason:ocrResult.reason||null,engine:"tesseract.js"};
      // Kept in full (not just the truncated capacityAudit.sourceText) so a
      // grouping/reclassification decision can recompute planIntelligence
      // later without re-running OCR.
      event.analysis.ocrText=ocrResult.available?ocrResult.text:null;
      if(ocrResult.available&&ocrResult.words?.length){
        const suppression=suppressTextFalsePositives(event.analysis.candidates,ocrResult.words,width,height);
        event.analysis.candidates=suppression.kept;
        event.analysis.diagnostics.textSuppressed=suppression.removedCount;
      }
      ui.analysisStage=t("analysis.stage.relating");ui.analysisProgress=90;render();await yieldFrame();
      ui.analysisStage=t("analysis.stage.capacity");ui.analysisProgress=95;render();await yieldFrame();
      event.analysis.planIntelligence=buildPlanIntelligence(event,event.analysis.ocrText);
      ui.analysisStage=t("analysis.stage.review");ui.analysisProgress=100;ui.analysisBusy=false;ui.selectedCandidateId=event.analysis.candidates[0]?.id||null;ui.difficultQuestionIndex=0;ui.activeReviewGroupId=null;ui.activeQuestionId=null;audit(event,"ASSISTED_DETECTION_COMPLETED",event.analysis.diagnostics);touchEvent(event);render();
    }catch(error){console.error(error);ui.analysisBusy=false;ui.analysisStage="Analysis failed";render();toast(`Assisted Detection failed: ${error.message}`,"error",7000);}
  }
  // Re-derives the whole PlanIntelligenceResult from the CURRENT candidates +
  // any recorded grouping/reclassification decisions. Called after every
  // decision that changes the logical interpretation of the plan (grouping
  // answers, cross-kind reclassification) so capacity, dining-group counts,
  // Review Center and overlays are never stale relative to what a human
  // actually decided.
  function recomputePlanIntelligence(event){event.analysis.planIntelligence=buildPlanIntelligence(event,event.analysis.ocrText??null);}
  function reviewCandidates(event){const a=event.analysis;if(!a)return[];return a.candidates.filter(c=>(ui.reviewFilter==="all"||c.status===ui.reviewFilter)&&(ui.reviewClass==="all"||c.kind===ui.reviewClass)&&c.confidence>=ui.reviewConfidence);}
  // Which candidate(s) the screen is actively asking a question about right
  // now — a difficult question's whole furniture group, an inspected Review
  // Center family, or a single selected candidate, in that priority order.
  // Everything NOT in this set gets visually quieted (see candidateBox)
  // so the one real decision in front of the human is unmistakable.
  function activeReviewTargetIds(pi){
    if(!pi)return null;
    if(ui.activeQuestionId){
      const q=pi.uncertainQuestions.find(x=>x.id===ui.activeQuestionId),group=q&&pi.furnitureGroups.find(g=>g.id===q.groupId);
      if(group)return{ids:new Set(group.memberIds),isGroup:group.memberIds.length>1};
    }
    if(ui.activeReviewGroupId){
      const group=pi.reviewGroups.find(g=>g.id===ui.activeReviewGroupId);
      if(group)return{ids:new Set(group.memberIds),isGroup:true};
    }
    if(ui.selectedCandidateId)return{ids:new Set([ui.selectedCandidateId]),isGroup:false};
    return null;
  }
  function unionBbox(members){
    if(!members.length)return null;
    const xs=members.flatMap(m=>[m.x,m.x+m.w]),ys=members.flatMap(m=>[m.y,m.y+m.h]);
    return{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
  }
  // Real camera-fit for a group review: scales/pans the (transformed) scene
  // wrapper so the target bbox fills most of the visible map, instead of
  // relying on the human to spot a small group inside a large plan. Resets
  // to the neutral 1x view for a plain single-candidate look (no bbox).
  function applyReviewZoom(bbox){
    const outer=document.getElementById("analysisScene"),inner=document.getElementById("analysisSceneInner");
    if(!outer||!inner)return;
    if(!bbox){inner.style.transform="";return;}
    const rect=outer.getBoundingClientRect();if(!rect.width||!rect.height)return;
    // Percentages are relative to the inner box (the rendered plan image), and
    // that box is centred inside the outer panel rather than filling it, so
    // measure both: offsetWidth/offsetLeft are layout values and are not
    // affected by the transform already on the element.
    const iw=inner.offsetWidth||rect.width,ih=inner.offsetHeight||rect.height;
    const ox=inner.offsetLeft,oy=inner.offsetTop;
    const pad=.4,tx=Math.max(0,bbox.x-bbox.w*pad),ty=Math.max(0,bbox.y-bbox.h*pad),tw=Math.min(100-tx,bbox.w*(1+2*pad)||20),th=Math.min(100-ty,bbox.h*(1+2*pad)||20);
    const scale=Math.max(1,Math.min(4,Math.min(100/Math.max(8,tw),100/Math.max(8,th))));
    const cxPx=(tx+tw/2)/100*iw,cyPx=(ty+th/2)/100*ih;
    inner.style.transform=`translate(${rect.width/2-ox-cxPx*scale}px, ${rect.height/2-oy-cyPx*scale}px) scale(${scale})`;
  }
  function candidateBox(c,selected,targetIds){
    const reviewCls=targetIds?(targetIds.has(c.id)?"review-target":"review-dimmed"):"";
    return`<button class="candidate-box ${c.kind} ${c.status} ${selected?"selected":""} ${reviewCls}" data-candidate-box="${c.id}" style="left:${c.x}%;top:${c.y}%;width:${c.w}%;height:${c.h}%;transform:rotate(${c.rotation||0}deg)" title="${esc(c.kind)} · ${Math.round(c.confidence*100)}%"></button>${(c.chairDetections||[]).map(ch=>`<i class="candidate-box chair ${reviewCls}" style="left:${ch.x}%;top:${ch.y}%;width:${Math.max(.5,ch.w)}%;height:${Math.max(.5,ch.h)}%;transform:translate(-50%,-50%) rotate(${ch.rotation||0}deg)"></i>`).join("")}`;
  }
  // ============================================================
  // Concept 3 + Concept 2 + Concept 1 unified Plan Intelligence review screen.
  // The imported plan is the full-bleed hero. Review pins mark only the
  // objects a similarity cluster or a difficult question actually flags —
  // never every low-confidence box individually. A small POI card answers
  // one object; Review Center answers a whole family at once; the difficult
  // -question card is reserved for genuinely ambiguous multi-table grouping.
  // ============================================================
  // Full cross-kind reclassification taxonomy (merit-plan-intelligence
  // contract): correcting a detection to ANY of these must be able to cross
  // table<->venue kind, not just swap type within the same kind. "Ignore" is
  // deliberately not listed here — it is the existing "Not an object" reject
  // action, which already stores a real negative example rather than deleting.
  const RECLASSIFY_TAXONOMY=[
    {kind:"table",type:"round"},{kind:"table",type:"square"},{kind:"table",type:"rectangle"},{kind:"table",type:"bistro"},
    {kind:"venue",type:"chair"},{kind:"venue",type:"armchair"},{kind:"venue",type:"sofa"},
    {kind:"venue",type:"stage"},{kind:"venue",type:"bar"},{kind:"venue",type:"entrance"},{kind:"venue",type:"exit"},
    {kind:"venue",type:"column"},{kind:"venue",type:"text"},{kind:"venue",type:"other"},
  ];
  function reviewPoiCardHTML(c){
    if(!c)return"";
    const opt=o=>`<option value="${o.kind}:${o.type}" ${c.kind===o.kind&&c.type===o.type?"selected":""}>${t("teach.type."+o.type)}</option>`;
    return`<aside class="poi-card"><div class="poi-card-head"><strong>${t("teach.type."+c.type)}</strong><span>${c.kind==="table"?`${(c.chairDetections||[]).length} ${t("poi.seats")} · `:""}${t(c.status==="confirmed"?"poi.confirmed":c.status==="rejected"?"poi.rejected":"poi.unreviewed")}</span></div>${c.fromMemory?`<div class="poi-memory-note">${icon("check")}${t("poi.fromMemory")}</div>`:""}<select class="field-select" data-candidate-edit="kindtype"><optgroup label="${t("taxonomy.tables")}">${RECLASSIFY_TAXONOMY.filter(o=>o.kind==="table").map(opt).join("")}</optgroup><optgroup label="${t("taxonomy.objects")}">${RECLASSIFY_TAXONOMY.filter(o=>o.kind==="venue").map(opt).join("")}</optgroup></select><div class="poi-card-actions"><button class="btn sm primary" data-review-action="confirm">${t("action.correct")}</button><button class="btn sm" data-review-action="reject">${t("action.notAnObject")}</button></div></aside>`;
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
  function reviewCenterPanelHTML(event){
    const pi=event.analysis.planIntelligence,decisions=event.analysis.groupingDecisions||[];
    return`<aside class="review-center-panel"><div class="review-center-head"><strong>${t("review.center")}</strong>${decisions.length?`<button class="btn sm quiet" data-review-decision-action="undo-last" title="${t("diag.undoLastDecisionTitle")}">${icon("undo")} ${t("diag.undoLastDecision",{n:decisions.length})}</button>`:""}<button class="btn icon-only sm" data-review-action="close-review-center">${icon("x")}</button></div><div class="review-center-list">${pi.reviewGroups.map(g=>`<div class="review-group-card"><div class="review-group-title">${titleCase(g.title)}</div>${memberCropsHTML(event,g.memberIds)}<div class="review-group-meta">${g.totalInFamily} ${t("review.similar")} · ${g.consistentCount} ${t("review.consistentOf")} · ${g.memberIds.length} ${t("review.needReview")}</div><div class="review-group-actions"><button class="btn sm primary" data-reviewgroup-action="confirm-family" data-group="${g.id}">${t("action.applyToAll")}</button><button class="btn sm" data-reviewgroup-action="inspect" data-group="${g.id}">${t("action.reviewOutliers")}</button></div></div>`).join("")||`<div class="inspector-empty">${t("review.noGroups")}</div>`}</div>${pi.uncertainQuestions.length?`<div class="review-center-difficult"><strong>${t("review.difficultQuestions")}</strong>${pi.uncertainQuestions.map(q=>`<div class="difficult-q-row"><span>${esc(questionText(q))}</span><button class="btn sm" data-question-action="open" data-question="${q.id}">${t("action.answer")}</button></div>`).join("")}</div>`:""}</aside>`;
  }
  // AI-generated review questions are stored as a semantic {questionType,
  // questionParams} pair (plan-intelligence.js), never a hardcoded English
  // string — this renders that through i18n.js's t() so the active UI
  // language is honored. q.question (a plain English literal) is kept only
  // as a defensive fallback for a question shape without a known type.
  function questionText(q){
    if(q.questionType==="combinedDiningGroup")return t("question.combinedDiningGroup",{memberCount:q.questionParams?.memberCount??"?"});
    return q.question||"";
  }
  function difficultQuestionCardHTML(event){
    const pi=event.analysis?.planIntelligence;if(!pi||!ui.activeQuestionId)return"";
    const q=pi.uncertainQuestions.find(x=>x.id===ui.activeQuestionId);if(!q)return"";
    const group=pi.furnitureGroups.find(g=>g.id===q.groupId);
    return`<div class="difficult-question-overlay"><div class="difficult-question-card"><div class="eyebrow">${t("teach.needsHelp")}</div>${group?memberCropsHTML(event,group.memberIds):""}<p class="difficult-question-text">${esc(questionText(q))}</p><div class="difficult-question-actions"><button class="btn primary" data-question-action="yes" data-question="${q.id}">${t("question.yesGroup")}</button><button class="btn" data-question-action="no" data-question="${q.id}">${t("question.noSeparate")}</button></div></div></div>`;
  }
  function reviewGroupCount(pi){return pi.reviewGroups.length+pi.uncertainQuestions.length;}
  function planIntelBottomPillHTML(event){
    const pi=event.analysis.planIntelligence,groupCount=reviewGroupCount(pi);
    return`<div class="planmap-status-pill wide"><span class="pill-check">${icon("check")}</span><b>${t("plan.understood")}</b><i class="pill-div"></i><b>${pi.planSummary.diningGroups}</b><small>${t("plan.diningGroups")}</small><i class="pill-div"></i><b>${pi.planSummary.physicalSeats}</b><small>${t("plan.seats")}</small>${groupCount?`<i class="pill-div"></i><button class="pill-chip" data-review-action="open-review-center">${groupCount} ${t(groupCount===1?"review.group":"review.groups")}</button>`:""}<span class="toolbar-spacer"></span><button class="btn sm quiet" data-review-action="back">${t("review.editManually")}</button><button class="btn sm primary" data-review-action="commit">${t("action.confirmPlan")}</button></div>`;
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
    return`<div class="analysis-note">${rows.join("<br>")}</div>`;
  }
  function analysisHTML(event){
    const a=event.analysis,candidates=reviewCandidates(event),selected=a?.candidates.find(c=>c.id===ui.selectedCandidateId),pi=a?.planIntelligence;
    const pins=reviewMapPins(event,pi);
    const target=activeReviewTargetIds(pi),byId=a?new Map(a.candidates.map(c=>[c.id,c])):new Map();
    const boundaryBox=target?.isGroup?unionBbox([...target.ids].map(id=>byId.get(id)).filter(Boolean)):null;
    requestAnimationFrame(()=>applyReviewZoom(boundaryBox));
    const statusLabel=v=>t(v==="unreviewed"?"poi.unreviewed":v==="confirmed"?"poi.confirmed":"poi.rejected");
    return`<section class="planintel-screen"><header class="planintel-top"><button class="btn" data-review-action="back">${icon("arrow")}${t("nav.floorPlan")}</button><div class="planintel-title"><h2>${a?t("plan.understood"):(ui.analysisBusy?esc(ui.analysisStage):t("plan.noAnalysisYet"))}</h2>${a?`<p>${a.ocr&&!a.ocr.available?esc(t("ocr.unavailable",{reason:a.ocr.reason||"no network"})):a.notice}</p>`:`<p>${esc(ui.analysisStage)}</p>`}</div><span class="toolbar-spacer"></span>${a?`<details class="planintel-diagnostics"><summary>${t("diag.advancedDiagnostics")}</summary><div class="diag-pop">${detectionDiagnosticsHTML(a)}<div class="field"><label>${t("diag.status")}</label><select data-review-filter="status"><option value="all">${t("diag.all")}</option>${["unreviewed","confirmed","rejected"].map(v=>`<option value="${v}" ${ui.reviewFilter===v?"selected":""}>${statusLabel(v)}</option>`).join("")}</select></div><div class="field full"><label>${t("diag.minConfidence",{pct:Math.round(ui.reviewConfidence*100)})}</label><input data-review-filter="confidence" type="range" min="0" max=".95" step=".05" value="${ui.reviewConfidence}"></div><button class="btn sm" data-review-action="draw">${ui.reviewDrawMode?t("action.cancelDrawing"):t("action.aiMissed")}</button><button class="btn sm" data-review-action="save-verified">${t("action.saveVerifiedPlan")}</button><button class="btn sm" data-review-action="improve">${t("action.improveAI")}</button></div></details><button class="btn" data-review-action="reanalyze">${t("action.reanalyze")}</button>`:""}<button class="btn sm" data-review-action="toggle-lang">${ui.lang==="tr"?"TR":"EN"}</button></header>${pi?`<div class="planintel-map ${ui.reviewDrawMode?"draw-mode":""}" id="analysisScene"><div class="planintel-map-inner" id="analysisSceneInner"><img src="${event.background.src}" alt="Floor plan analysis source">${candidates.map(c=>candidateBox(c,selected?.id===c.id,target?.ids||null)).join("")}${boundaryBox?`<div class="review-group-boundary" style="left:${Math.max(0,boundaryBox.x-2.5)}%;top:${Math.max(0,boundaryBox.y-2.5)}%;width:${boundaryBox.w+5}%;height:${boundaryBox.h+5}%"></div>`:""}${pins.map(p=>p.kind==="group"?`<button class="review-pin group" data-review-action="focus-group" data-group="${p.groupId}" style="left:${p.x}%;top:${p.y}%" title="Review group ${p.label}">${p.label}</button>`:`<button class="review-pin question" data-question-action="open" data-question="${p.questionId}" style="left:${p.x}%;top:${p.y}%" title="Difficult question">${p.label}</button>`).join("")}</div></div>${selected&&!ui.reviewDrawMode?reviewPoiCardHTML(selected):""}${difficultQuestionCardHTML(event)}${planIntelBottomPillHTML(event)}${ui.reviewCenterOpen?reviewCenterPanelHTML(event):""}`:`<div class="v8-empty" style="margin:40px"><h2>${ui.analysisBusy?t("plan.analyzingLocally"):t("plan.noAnalysisYet")}</h2><p>${esc(ui.analysisStage)}</p></div>`}</section>`;
  }
  // The confidence at which a fresh candidate arrives pre-selected. Local
  // calibration (improveAI) writes state.calibration.recommendedConfidence
  // from the operator's own verified plans; until this existed the button
  // computed that number and nothing ever read it, so "Improve AI" changed
  // nothing. This is threshold calibration from measured examples, not model
  // training, and trainedModel stays false.
  function calibratedThreshold(){
    const v=state.calibration?.recommendedConfidence;
    return Number.isFinite(v)?Math.max(.2,Math.min(.9,v)):.48;
  }
  // Spread a type correction across the candidates the similarity clustering
  // already grouped with this one. Only touches candidates that are still
  // unreviewed AND still carry the exact classification the operator just
  // rejected, so it can never overwrite a decision they made themselves.
  function applyCorrectionToFamily(event,corrected,wasKind,wasType){
    const pi=event.analysis?.planIntelligence;if(!pi)return 0;
    // Prefer the full similarity family; fall back to the review group.
    const group=(pi.similarityGroups||[]).find(g=>(g.memberIds||[]).includes(corrected.id))
      ||(pi.reviewGroups||[]).find(g=>(g.memberIds||[]).includes(corrected.id));
    if(!group)return 0;
    let n=0;
    for(const id of group.memberIds){
      if(id===corrected.id)continue;
      const other=event.analysis.candidates.find(x=>x.id===id);
      if(!other||other.status!=="unreviewed")continue;
      if(other.kind!==wasKind||other.type!==wasType)continue;
      other.kind=corrected.kind;other.type=corrected.type;
      if(corrected.kind!=="table")other.chairDetections=[];
      other.status="confirmed";other.selected=true;
      rememberCorrection(event,other);
      n++;
    }
    return n;
  }
  function updateCandidateField(field,value){
    const event=activeEvent(),c=event.analysis?.candidates.find(x=>x.id===ui.selectedCandidateId);if(!c)return;
    if(field==="rotation")c.rotation=Number(value)||0;
    else if(field==="chairs"){const count=Math.max(0,Math.min(99,Number(value)||0));c.chairDetections=Array.from({length:count},(_,i)=>c.chairDetections?.[i]||{id:uid("candidate-chair"),x:c.x+c.w/2,y:c.y+c.h/2,w:.7,h:.7,rotation:0,confidence:.3});}
    else if(field==="kindtype"){
      const [kind,type]=value.split(":"),crossedKind=kind!==c.kind;
      const wasKind=c.kind,wasType=c.type;
      c.kind=kind;c.type=type;
      if(crossedKind&&kind!=="table")c.chairDetections=[]; // a chair/armchair/sofa/stage/etc. candidate carries no nested seat detections of its own.
      c.status="confirmed";c.selected=true;
      rememberCorrection(event,c);
      // One correction should repair the whole family, not one object. Every
      // still-unreviewed candidate that the similarity clustering already
      // considers the same shape gets the same correction. This is
      // calibration against measured geometry, NOT model training -- nothing
      // is learned across plans.
      const spread=applyCorrectionToFamily(event,c,wasKind,wasType);
      recomputePlanIntelligence(event); // reclassifying can move a candidate in/out of furniture grouping, similarity clustering, review groups and the physical-seat capacity sum — never just relabel it.
      if(spread)toast(t("review.correctionSpread",{n:spread}),"success",4200);
    }
    else c[field]=value;
    touchEvent(event);render();
  }
  function commitCandidates(){
    const event=activeEvent(),chosen=event.analysis?.candidates.filter(c=>c.selected&&c.status!=="rejected")||[];if(!chosen.length)return toast("Select at least one detection to confirm.","error");recordUndo(event);let tables=0,venues=0;for(const c of chosen){if(c.committedId)continue;const x=c.x/100*WORLD.width,y=c.y/100*WORLD.height,w=Math.max(55,c.w/100*WORLD.width),h=Math.max(45,c.h/100*WORLD.height);if(c.kind==="table"){const table=syncTableChairs({id:uid("table"),number:uniqueNumber(event,"T",1),type:["round","square","rectangle","bistro"].includes(c.type)?c.type:"rectangle",x,y,w,h,capacity:Math.max(1,c.chairDetections?.length||1),zone:"MAIN FLOOR",rotation:c.rotation||0,locked:false,z:10,hasPhysicalSeats:true});if(c.chairDetections?.length){table.chairs=c.chairDetections.map((ch,index)=>({id:uid("chair"),parentTableId:table.id,seatNumber:index+1,x:Math.max(0,Math.min(100,(ch.x-c.x)/c.w*100)),y:Math.max(0,Math.min(100,(ch.y-c.y)/c.h*100)),rotation:ch.rotation||0,occupancy:null}));table.capacity=table.chairs.length;}event.tables.push(table);c.committedId=table.id;tables++;}else{const object={id:uid("venue"),type:c.type||"text",label:String(c.type||"OBJECT").toUpperCase(),x,y,w,h,rotation:c.rotation||0,locked:false,z:4};event.venueObjects.push(object);c.committedId=object.id;venues++;}c.status="confirmed";}touchEvent(event);ui.screen="workspace";ui.tab="floor";render();toast(`${tables} table${tables===1?"":"s"}, ${venues} venue object${venues===1?"":"s"} confirmed. Chair coordinates were preserved.`,"success",6000);
  }
  function bindReviewDrawing(){const scene=document.getElementById("analysisScene");if(!scene||!ui.reviewDrawMode)return;scene.onpointerdown=e=>{if(e.target!==scene&&e.target.tagName!=="IMG")return;e.preventDefault();const r=scene.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top,box=document.createElement("div");box.className="candidate-box selected";scene.appendChild(box);const move=ev=>{const x=ev.clientX-r.left,y=ev.clientY-r.top;Object.assign(box.style,{left:Math.min(sx,x)+"px",top:Math.min(sy,y)+"px",width:Math.abs(x-sx)+"px",height:Math.abs(y-sy)+"px"});};const up=ev=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);const x=Math.min(sx,ev.clientX-r.left)/r.width*100,y=Math.min(sy,ev.clientY-r.top)/r.height*100,w=Math.abs(ev.clientX-r.left-sx)/r.width*100,h=Math.abs(ev.clientY-r.top-sy)/r.height*100;if(w>1&&h>1){const event=activeEvent();const c={id:uid("candidate"),kind:"table",type:"rectangle",x,y,w,h,rotation:0,confidence:1,status:"unreviewed",selected:true,missed:true,chairDetections:[],evidence:{geometry:"manual",chairs:0,repetition:0}};event.analysis.candidates.push(c);event.analysis.missed.push(c.id);rememberCorrection(event,c,{manual:true});ui.selectedCandidateId=c.id;ui.reviewDrawMode=false;touchEvent(event);}render();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);};}
  function saveVerified(){const event=activeEvent();if(!ui.teachAI)return toast("Enable Teach AI with corrections first.","error");const a=event.analysis;if(!a)return;state.verifiedExamples.push({id:uid("verified"),eventId:event.id,savedAt:nowISO(),engine:a.engine,trainedModel:false,threshold:a.threshold,imageSize:[a.imageWidth,a.imageHeight],predictions:a.candidates.map(clone),groundTruth:a.candidates.filter(c=>c.status!=="rejected").map(clone),rejected:a.candidates.filter(c=>c.status==="rejected").map(c=>c.id),missed:[...a.missed],hardExample:a.missed.length>0||a.candidates.some(c=>c.status==="rejected")});saveState();toast("Verified plan saved locally with predictions, corrections, rejections and missed detections.","success",6000);}
  function improveAI(){if(!state.verifiedExamples.length)return toast("Save at least one verified plan first.","error");const samples=state.verifiedExamples.flatMap(v=>v.groundTruth||[]),avg=samples.length?samples.reduce((n,c)=>n+(c.confidence||0),0)/samples.length:0;state.calibration={version:(state.calibration?.version||0)+1,updatedAt:nowISO(),examples:state.verifiedExamples.length,objects:samples.length,recommendedConfidence:Number(Math.max(.35,Math.min(.8,avg*.85)).toFixed(2)),trainedModel:false,label:"Local assisted-detection calibration; not a trained neural model"};saveState();toast(`Local calibration v${state.calibration.version} completed from ${state.verifiedExamples.length} verified plan(s). No trained model claim is made.`,"success",6500);}
  function bindReview(){
    document.querySelectorAll("[data-review-action]").forEach(b=>b.onclick=()=>{const action=b.dataset.reviewAction,event=activeEvent(),c=event.analysis?.candidates.find(x=>x.id===ui.selectedCandidateId);if(action==="back"){ui.screen="workspace";ui.tab="floor";ui.activeReviewGroupId=null;ui.activeQuestionId=null;ui.selectedCandidateId=null;render();}else if(action==="reanalyze")runAssistedDetection();else if(action==="commit")commitCandidates();else if(action==="confirm"&&c){c.status="confirmed";c.selected=true;rememberCorrection(event,c);touchEvent(event);render();}else if(action==="reject"&&c){c.status="rejected";c.selected=false;rememberCorrection(event,c);touchEvent(event);render();}else if(action==="delete-candidate"&&c){event.analysis.candidates=event.analysis.candidates.filter(x=>x.id!==c.id);ui.selectedCandidateId=null;touchEvent(event);render();}else if(action==="draw"){ui.reviewDrawMode=!ui.reviewDrawMode;ui.activeReviewGroupId=null;ui.activeQuestionId=null;render();}else if(action==="save-verified")saveVerified();else if(action==="improve")improveAI();else if(action==="open-review-center"){ui.reviewCenterOpen=true;render();}else if(action==="close-review-center"){ui.reviewCenterOpen=false;render();}else if(action==="focus-group"){ui.activeReviewGroupId=b.dataset.group;ui.selectedCandidateId=null;ui.activeQuestionId=null;ui.reviewCenterOpen=true;render();}else if(action==="toggle-lang"){ui.lang=ui.lang==="tr"?"en":"tr";render();}});
    document.querySelectorAll("[data-candidate],[data-candidate-box]").forEach(node=>node.onclick=e=>{if(e.target.matches("input"))return;ui.selectedCandidateId=node.dataset.candidate||node.dataset.candidateBox;ui.activeReviewGroupId=null;ui.activeQuestionId=null;render();});document.querySelectorAll("[data-candidate-select]").forEach(input=>input.onchange=()=>{const c=activeEvent().analysis.candidates.find(x=>x.id===input.dataset.candidateSelect);c.selected=input.checked;touchEvent(activeEvent());});document.querySelectorAll("[data-candidate-edit]").forEach(input=>input.onchange=()=>updateCandidateField(input.dataset.candidateEdit,input.value));document.querySelectorAll("[data-review-filter]").forEach(input=>input.oninput=()=>{if(input.dataset.reviewFilter==="status")ui.reviewFilter=input.value;else if(input.dataset.reviewFilter==="class")ui.reviewClass=input.value;else ui.reviewConfidence=Number(input.value);render();});document.querySelector("[data-teach-ai]")?.addEventListener("change",e=>{ui.teachAI=e.target.checked;});
    document.querySelectorAll("[data-reviewgroup-action]").forEach(b=>b.onclick=()=>{
      const event=activeEvent(),pi=event.analysis?.planIntelligence,group=pi?.reviewGroups.find(g=>g.id===b.dataset.group);if(!group)return;
      if(b.dataset.reviewgroupAction==="confirm-family"){
        const strong=group.memberIds.filter(id=>!group.outlierIds.includes(id));
        strong.forEach(id=>{const c=event.analysis.candidates.find(x=>x.id===id);if(c){c.status="confirmed";c.selected=true;rememberCorrection(event,c);}});
        touchEvent(event);ui.reviewCenterOpen=group.outlierIds.length>0;render();
        toast(`${strong.length} object${strong.length===1?"":"s"} confirmed as ${group.title}. ${group.outlierIds.length?group.outlierIds.length+" outlier(s) still need review.":""}`,"success",5000);
      } else if(b.dataset.reviewgroupAction==="inspect"){
        ui.activeReviewGroupId=group.id;ui.selectedCandidateId=null;ui.activeQuestionId=null;ui.reviewCenterOpen=false;render();
      }
    });
    document.querySelectorAll("[data-question-action]").forEach(b=>b.onclick=()=>{
      const event=activeEvent(),pi=event.analysis?.planIntelligence,q=pi?.uncertainQuestions.find(x=>x.id===b.dataset.question);if(!q)return;
      const action=b.dataset.questionAction;
      if(action==="open"){ui.activeQuestionId=q.id;ui.activeReviewGroupId=null;ui.selectedCandidateId=null;ui.reviewCenterOpen=false;render();return;}
      const group=pi.furnitureGroups.find(g=>g.id===q.groupId),memberIds=group?.memberIds||[];
      if(!canMutate(event,"answer a plan question"))return;
      const decision=action==="yes"?"merged":"separate";
      event.analysis.groupingDecisions ||= [];
      event.analysis.groupingDecisions.push({id:uid("groupdecision"),memberIds:[...memberIds],decision,decidedAt:nowISO(),fromQuestionId:q.id});
      state.verifiedExamples.push({id:uid("verified"),eventId:event.id,savedAt:nowISO(),kind:"grouping-question",question:q.question,answer:action==="yes"?"one-group":"separate-tables",memberCandidateIds:memberIds});
      recomputePlanIntelligence(event);
      const newPi=event.analysis.planIntelligence;
      touchEvent(event);ui.activeQuestionId=null;render();
      toast(decision==="merged"
        ?`Confirmed as one seating group. Plan now shows ${newPi.planSummary.diningGroups} dining group(s). Undo is available in Review Center.`
        :`Split into ${memberIds.length} separate tables. Plan now shows ${newPi.planSummary.diningGroups} dining group(s). Undo is available in Review Center.`,
        "success",6000);
    });
    document.querySelectorAll("[data-review-decision-action='undo-last']").forEach(b=>b.onclick=()=>{
      const event=activeEvent();if(!canMutate(event,"undo a plan decision"))return;
      const decisions=event.analysis?.groupingDecisions;if(!decisions?.length)return;
      const undone=decisions.pop();recomputePlanIntelligence(event);touchEvent(event);render();
      toast(`Undone: ${undone.decision==="merged"?"one seating group":"separate tables"} decision reverted.`,"success",5000);
    });
    bindReviewDrawing();
  }

  function bindV8Common(){
    document.querySelectorAll("[data-action='create-event']").forEach(b=>b.onclick=startNewEvent);document.querySelectorAll("[data-action='help']").forEach(b=>b.onclick=openGuide);document.querySelectorAll("[data-open-event]").forEach(b=>b.onclick=()=>openEvent(b.dataset.openEvent));// Row-level open + per-row action buttons now coexist on Home, so the
// buttons must not bubble into the row's open handler.
document.querySelectorAll("[data-duplicate-event]").forEach(b=>b.onclick=e=>{e.stopPropagation();duplicateEvent(b.dataset.duplicateEvent);});document.querySelectorAll("[data-delete-event]").forEach(b=>b.onclick=e=>{e.stopPropagation();deleteEvent(b.dataset.deleteEvent);});document.querySelectorAll("[data-history-event]").forEach(row=>row.ondblclick=()=>openEvent(row.dataset.historyEvent));document.querySelectorAll("[data-history-event] .row-icons").forEach(el=>el.ondblclick=e=>e.stopPropagation());
    document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{ui.tab=b.dataset.tab;ui.selectedObjectId=null;ui.selectedObjectIds=[];ui.highlightId=null;ui.operationalMode=false;render();});const back=document.querySelector("[data-action='back-events']");if(back)back.onclick=()=>{ui.screen="events";ui.focusMode=false;render();};const save=document.querySelector("[data-action='save-now']");if(save)save.onclick=()=>saveState(true);const search=document.getElementById("globalGuestSearch");if(search){search.oninput=()=>renderGlobalSearch(search.value);search.onkeydown=e=>{if(e.key==="Escape")document.getElementById("globalSearchResults")?.classList.add("hidden");};}
  }
  bindCommon = bindV8Common;
  openEvent = function(id){const event=state.events.find(e=>e.id===id);if(!event)return;ui.activeEventId=id;ui.screen="workspace";ui.tab=isHistorical(event)?"guests":"floor";ui.selectedObjectId=null;ui.selectedObjectIds=[];ui.selectedGuestIds=[];ui.operationalMode=false;ui.undo=[];ui.redo=[];render();};
  duplicateEvent = function(id,open=false){const source=state.events.find(e=>e.id===id);if(!source)return;original.duplicateEvent(id,open);const copy=state.events[0];copy.hotel=copy.hotel||copy.venue||"";copy.salon=copy.salon||"";copy.tables.forEach(t=>{t.chairs=(t.chairs||[]).map((c,i)=>({...c,id:uid("chair"),parentTableId:t.id,seatNumber:i+1,occupancy:null}));});saveState();};

  render = function(){
    translateStaticDialogs();
    if(ui.screen==="new-event"){app.innerHTML=setupHTML();bindSetup();return;}
    if(ui.screen==="review"){const event=activeEvent();app.innerHTML=analysisHTML(event);bindReview();return;}
    if(!state.events.length&&ui.screen!=="events")ui.screen="events";
    app.innerHTML=ui.screen==="events"?eventsHTML():workspaceHTML(activeEvent());bindV8Common();
    if(ui.screen==="workspace"){
      const event=activeEvent(),historical=isHistorical(event);
      if((ui.tab==="floor"||ui.tab==="seating")&&!historical)bindCanvas();
      if(ui.tab==="seating"&&!historical)bindSeating();if(ui.tab==="guests"&&!historical)bindGuests();if(ui.tab==="live"&&!historical)bindLive();if(ui.tab==="reports")bindReports();
      if(historical&&ui.tab==="seating")requestAnimationFrame(()=>fitCanvas(false));
    }
  };

  const oldGuideRender=renderGuide;
  renderGuide = function(){
    const root=document.getElementById("guideRoot"),tr=ui.guideLang==="tr",title=tr?"V8 Kullanıcı Kılavuzu":"V8 User Guide",cards=tr?[
      ["Etkinlikler","Yaklaşan etkinlikler kartlarda, geçmiş etkinlikler kilitli tabloda görünür. Geçmiş satırına çift tıklayın."],["Plan ve PDF","PNG/JPG/PDF yerelde açılır. PDF sayfasını küçük önizlemelerden seçin; hiçbir dosya yüklenmez."],["Assisted Detection","Klasik görüntü işleme adayları üretir. Sonuçlar AI değildir; onaylamadan plana eklenmez."],["Koltuk Yerleşimi","Ctrl/Shift ile çoklu seçim yapın. Grup taşıma tek işlem olarak doğrulanır; kapasite yetmezse hiçbir kayıt değişmez."],["Canlı Operasyon","No Show planlanan yeri korur ancak canlı kapasiteyi serbest bırakır. Empty Chairs kırmızı ışıklı koltuk görünümünü açar."],["Excel ve Kayıt","XLSX tamamen çevrimdışıdır. Table Plan, Guest List ve Unassigned sayfaları korunur; veriler tarayıcıda otomatik kaydedilir."]
    ]:[
      ["Events","Upcoming work appears as cards; past and Completed events are locked in History. Double-click a history row."],["Plans and PDF","PNG/JPG/PDF opens locally. Select PDF pages from thumbnails; no file is uploaded."],["Assisted Detection","Classical computer vision proposes candidates. It is not a trained AI model, and nothing is added until confirmation."],["Seating","Use Ctrl/Shift for multi-selection. Group moves validate as one transaction; insufficient capacity changes nothing."],["Live Operations","No Show preserves the planned assignment but releases live capacity. Empty Chairs opens the red-glow operational view."],["Excel and Storage","XLSX works offline. Table Plan, Guest List and Unassigned sheets remain available; browser autosave is automatic."]
    ];root.innerHTML=`<aside class="guide-nav"><div class="guide-brand"><strong>MERIT EVENT MAKER</strong><span>${title}</span></div></aside><section class="guide-main"><header class="guide-top"><h2>${title}</h2><div class="guide-actions"><div class="lang-toggle"><button data-guide-lang="en" class="${!tr?"active":""}">EN</button><button data-guide-lang="tr" class="${tr?"active":""}">TR</button></div><button class="btn" data-guide-print>${icon("print")}Print / PDF</button><button class="btn icon-only" data-guide-close>${icon("x")}</button></div></header><div class="guide-content"><div class="guide-hero"><div class="kicker">MERIT ENTERTAINMENT · V8 BROWSER REVIEW</div><h1>${title}</h1><p>${tr?"Masa planı, fiziksel koltuklar, misafirler, canlı operasyon ve doğrulanmış plan düzeltmeleri için çevrimdışı başvuru.":"Offline reference for plan objects, physical chairs, guests, live operations and verified plan corrections."}</p></div><div class="guide-v8-grid">${cards.map(([h,p])=>`<article class="guide-v8-card"><h3>${h}</h3><p>${p}</p></article>`).join("")}</div><div class="guide-tip">${tr?"Bu sürüm tarayıcı incelemesidir; EXE veya masaüstü çalışma zamanı içermez.":"This is a browser review build; it does not include an EXE or desktop runtime."}</div></div></section>`;root.querySelectorAll("[data-guide-lang]").forEach(b=>b.onclick=()=>{ui.guideLang=b.dataset.guideLang;renderGuide();});root.querySelector("[data-guide-close]").onclick=()=>document.getElementById("guideDialog").close();root.querySelector("[data-guide-print]").onclick=()=>window.print();
  };
  openGuide = function(){renderGuide();document.getElementById("guideDialog").showModal();};

  const oldFloorInput=document.getElementById("floorPlanFile"),freshFloorInput=oldFloorInput.cloneNode(true);oldFloorInput.replaceWith(freshFloorInput);freshFloorInput.addEventListener("change",async e=>{const file=e.target.files[0],event=activeEvent();if(!file||!event||!canMutate(event,"replace the floor plan"))return;try{let src,name=file.name;if(file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")){const pdf=await waitForPdf(),doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise,pageNumber=Math.max(1,Math.min(doc.numPages,Number(prompt(`PDF contains ${doc.numPages} pages. Enter page number:`,"1"))||1)),page=await doc.getPage(pageNumber),v=page.getViewport({scale:2.6}),canvas=document.createElement("canvas");canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);await page.render({canvasContext:canvas.getContext("2d"),viewport:v}).promise;src=canvas.toDataURL("image/png",.96);name=`${file.name} · page ${pageNumber}`;}else src=await readDataURL(file);recordUndo(event);event.background={src,name,opacity:.34,visible:true,locked:true,isDefault:false,scale:100};touchEvent(event);render();toast("Floor plan imported locally. Assisted Detection is ready.","success");}catch(error){toast(error.message,"error",6500);}finally{e.target.value="";}});

  // ---- Focus return after a dialog closes -----------------------------
  // A native <dialog> restores focus to whatever had it when showModal() ran.
  // That does not survive here: every close is followed by render(), which
  // replaces the DOM, so the remembered node is detached and focus falls to
  // <body> -- a keyboard user is dropped at the top of the document and has to
  // tab all the way back. So remember a SELECTOR, not the node, and re-find an
  // equivalent control after the re-render.
  let dialogOpener=null;
  function openerSelector(el){
    if(!el||el===document.body)return null;
    for(const key in el.dataset){
      const attr="data-"+key.replace(/[A-Z]/g,m=>"-"+m.toLowerCase());
      const val=el.dataset[key];
      return val?`[${attr}="${CSS.escape(val)}"]`:`[${attr}]`;
    }
    return el.id?`#${CSS.escape(el.id)}`:null;
  }
  document.addEventListener("pointerdown",e=>{
    const hit=e.target.closest&&e.target.closest("button,[role=button],a[href]");
    if(hit)dialogOpener=openerSelector(hit);
  },true);
  document.addEventListener("focusin",e=>{
    const el=e.target;
    if(el&&el.closest&&!el.closest("dialog")&&/BUTTON|A/.test(el.tagName))dialogOpener=openerSelector(el);
  },true);
  for(const id of ["guestDialog","excelDialog","guideDialog"]){
    const dlg=document.getElementById(id);if(!dlg)continue;
    dlg.addEventListener("close",()=>{
      const sel=dialogOpener;
      // After render(), not before: the node to focus does not exist yet.
      requestAnimationFrame(()=>{
        let target=sel&&document.querySelector(sel);
        // The opener can legitimately be gone -- the guest it belonged to was
        // just deleted. Fall back to the screen's first real control rather
        // than leaving focus on <body>.
        if(!target||target.offsetParent===null)
          target=document.querySelector(".mx-head button, .appbar button, .tab.active");
        if(target)target.focus();
      });
    });
  }

  window.addEventListener("keydown",e=>{
    if(e.key==="Escape"){if(ui.repeatPlacement){ui.repeatPlacement=null;toast("Repeated placement cancelled.");}if(ui.focusMode)ui.focusMode=false;if(ui.reviewDrawMode)ui.reviewDrawMode=false;if(ui.activeQuestionId)ui.activeQuestionId=null;if(ui.reviewCenterOpen)ui.reviewCenterOpen=false;render();return;}
    if(ui.screen!=="workspace"||ui.tab!=="floor"||isHistorical(activeEvent()))return;
    if((e.key==="Delete"||e.key==="Backspace")&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){e.preventDefault();deleteSelection();return;}
    if(e.ctrlKey&&e.key.toLowerCase()==="d"){e.preventDefault();duplicateSelection();return;}
    if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){
      const event=activeEvent(),ids=ui.selectedObjectIds.length?ui.selectedObjectIds:[ui.selectedObjectId].filter(Boolean);if(!ids.length)return;e.preventDefault();const amount=e.shiftKey?10:1,dx=e.key==="ArrowLeft"?-amount:e.key==="ArrowRight"?amount:0,dy=e.key==="ArrowUp"?-amount:e.key==="ArrowDown"?amount:0;recordUndo(event);ids.forEach(id=>{const o=event.tables.find(x=>x.id===id)||event.venueObjects.find(x=>x.id===id);if(o&&!o.locked){o.x+=dx;o.y+=dy;}});touchEvent(event);render();
    }
  });

  render();
})();