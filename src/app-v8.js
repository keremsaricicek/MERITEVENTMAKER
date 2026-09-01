(() => {
  "use strict";
  ICONS.upload='<path d="M12 21V9M7 14l5-5 5 5M4 21h16"></path>';
  const V8_STORAGE_KEY = "meritEventMaker.v8";
  const LEGACY_KEYS = ["meritEventMaker.v7", "meritEventMaker.v3", "meritEventMaker.v2", "meritEventMaker.v1"];
  // StorageProvider selection (src/storage-provider.js). IndexedDB is primary;
  // localStorage under V8_STORAGE_KEY/LEGACY_KEYS is now read-only -- it is
  // still where a pre-existing install's data lives, so it's the migration
  // source on first load, but nothing writes to it again after that.
  const storageProvider = (() => {
    try { if (globalThis.MeritStorageProviders?.IndexedDBStorageProvider) return new MeritStorageProviders.IndexedDBStorageProvider(); }
    catch (error) { console.warn("IndexedDB provider unavailable, falling back to localStorage.", error); }
    return new MeritStorageProviders.LocalStorageStorageProvider(V8_STORAGE_KEY);
  })();
  globalThis.MERIT_STORAGE_STATUS = { provider: storageProvider.constructor.name };
  // Exposed so the training-data crops can be read back and exported without
  // routing image bytes through the state record. Read/write access to the
  // blob store only -- the state record still goes through saveState().
  globalThis.MERIT_STORAGE_PROVIDER = storageProvider;
  const todayKey = () => new Date().toLocaleDateString("en-CA");
  const original = {
    render, bindCommon, bindCanvas, bindGuests, bindSeating, bindLive, bindReports,
    floorPlanHTML, seatingHTML, guestsHTML, reportsHTML, inspectorHTML,
    setTableCapacity, inspectorAction, updateInspectorField, deleteSelectedObject,
    startObjectDrag, startResize, startRotate, createTableFromDraft, addVenue,
    openGuestDialog, deleteGuest, assignGuestToTable, unassignGuest, toggleAssignmentLock,
    duplicateEvent, loadXLSX, saveState, touchEvent, openGuide,
    undoCanvas, redoCanvas
  };

  Object.assign(ui, {
    screen:"events", tab:"floor", focusMode:false, v8AddOpen:false,
    selectedObjectIds:[], selectedGuestIds:[], guestAnchorId:null,
    operationalMode:false, reviewFilter:"all", reviewClass:"all", reviewConfidence:0,
    analysisBusy:false, analysisProgress:0, analysisStage:"Ready", selectedCandidateId:null,
    reviewDrawMode:false, teachAI:false, setupBusy:false,
    lang:"en", reviewCenterOpen:false, difficultQuestionIndex:0, activeReviewGroupId:null, activeQuestionId:null, ocrText:null
  });

  function blankRoot(){ return {version:8, schemaVersion:8, events:[], venues:[], verifiedExamples:[], trainingData:[], operatorSessions:[], analyses:[], calibration:null, audit:[]}; }
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
    // Added with training-data capture. An install from before it simply has
    // no examples yet -- there is nothing to reconstruct, because the crops
    // it would have needed were never taken.
    parsed.trainingData ||= [];
    // Promote the old free-text hotel/salon strings into real Venue/Layout
    // records (src/venue-model.js). Additive: every event keeps its original
    // strings, and a venueRef is attached alongside, so nothing that reads
    // event.hotel today changes behaviour.
    if(globalThis.MeritVenueModel){
      const result=MeritVenueModel.migrateVenues(parsed);
      if(result.linked)parsed.audit.unshift({id:uid("audit"),eventId:null,action:"VENUE_MODEL_MIGRATION",detail:result,at:nowISO()});
    }
    return parsed;
  }
  // One-time migration source only: whatever a pre-StorageProvider install
  // left in localStorage. Read here, never written to again after this.
  function loadFromLegacyLocalStorage(){
    try{
      const own=localStorage.getItem(V8_STORAGE_KEY); if(own) return parseRoot(own);
      for(const key of LEGACY_KEYS){const raw=localStorage.getItem(key);if(raw){const migrated=parseRoot(raw);migrated.audit.unshift({id:uid("audit"),eventId:null,action:"LEGACY_MIGRATION",detail:{source:key,venueToHotel:true,salonInvented:false},at:nowISO()});return migrated;}}
    }catch(error){console.warn("Legacy localStorage restore failed",error);}
    return null;
  }
  async function loadV8Async(){
    try{
      const fromProvider=await storageProvider.load();
      if(fromProvider) return parseRoot(fromProvider);
    }catch(error){console.warn("StorageProvider load failed, checking legacy localStorage.",error);}
    const legacy=loadFromLegacyLocalStorage();
    if(legacy){
      // Get it into the real store right away so this migration only ever
      // has to run once, even if the provider load above merely came back
      // empty (first run after switching to IndexedDB) rather than erroring.
      storageProvider.save(JSON.stringify(legacy)).catch(error=>console.warn("Could not persist migrated legacy state.",error));
      return legacy;
    }
    return blankRoot();
  }
  saveState = function(show=false){
    // Nothing to persist yet, and persisting now would be actively harmful:
    // `state` is still the boot placeholder until loadV8Async() resolves, so
    // writing it (e.g. from the beforeunload handler firing on a reload that
    // races ahead of the async load) would overwrite real data with a blank
    // slate. See the isMigrationRace regression check in scratchpad.
    if(!bootReady)return;
    state.events.forEach(refreshChairOccupancy);
    let payload;
    try{payload=JSON.stringify(state);}
    catch(error){toast("Browser storage is full. Export the workbook before closing.","error",6500);return;}
    storageProvider.save(payload)
      .then(()=>{if(show)toast("Saved locally in this browser.","success");})
      .catch(error=>{
        // Large embedded images are the only realistic reason a save this
        // size fails -- strip them and retry once before giving up.
        console.warn("StorageProvider save failed, retrying with images stripped.",error);
        const compact=clone(state);compact.events.forEach(e=>{if(e.background)e.background.src="";if(e.coverImage)e.coverImage="";});
        return storageProvider.save(JSON.stringify(compact)).then(()=>toast("Event data was saved, but large images exceeded browser storage.","error",6500));
      })
      .catch(error=>{console.warn("StorageProvider save failed entirely.",error);toast("Browser storage is full. Export the workbook before closing.","error",6500);});
  };
  touchEvent = function(event){event.lastModified=nowISO();audit(event,"EVENT_UPDATED");saveState();};
  let bootReady=false;
  state=blankRoot();

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
    return`<header class="appbar">${topBrand()}<div class="crumb">${t("home.crumb")} / <b>${t("home.portfolio")}</b></div><div class="appbar-actions">${helpButton()}<button class="btn quiet icon-only" data-action="backup-export" title="${t("backup.export")}">${icon("download")}</button><button class="btn quiet icon-only" data-action="backup-import" title="${t("backup.import")}">${icon("upload")}</button><button class="btn primary" data-action="create-event">${icon("plus")}${t("home.createEvent")}</button></div></header><div class="mx-screen"><div class="mx-wrap">
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
    state.events.unshift(event);if(globalThis.MeritVenueModel)MeritVenueModel.migrateVenues(state);audit(event,"EVENT_CREATED",{blank:!event.background.src,hotel:event.hotel,salon:event.salon});saveState();ui.activeEventId=event.id;ui.screen="workspace";ui.tab="floor";ui.leftCollapsed=true;render();toast(event.background.src?"Event created. Review the plan, then run Assisted Detection.":"Blank event created. Add plan objects when ready.","success",5000);
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
  // Undo/redo were the last canvas mutation path with no historical guard, and
  // the most reachable one: the Ctrl+Z handler in app-guests.js is bound to
  // window and is gated on neither screen, tab nor event status. Marking an
  // event Completed without leaving the workspace -- or simply working past
  // midnight into a past-dated event -- left a live undo stack pointed at a
  // record that is supposed to be frozen, and one keystroke rewrote its floor
  // plan. Guarding the handler would have fixed that one caller; the rule is
  // that canMutate rejects every mutation path, so the guard goes here.
  undoCanvas = function(){if(canMutate(activeEvent(),"undo changes"))original.undoCanvas();};
  redoCanvas = function(){if(canMutate(activeEvent(),"redo changes"))original.redoCanvas();};

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

  // One lookup table per call instead of a linear scan per guest. These
  // filters ran `event.tables.find(...)` INSIDE a per-guest predicate, which
  // is O(guests x tables) -- 1.2M comparisons per render on the 4,000-seat
  // fixture (3,000 guests, 400 tables).
  //
  // Honest accounting: this was NOT what made those screens slow. Profiled on
  // that fixture the whole filter pass costs 3-4ms either way; the render time
  // was DOM layout, fixed in styles.css. The index is kept because it is the
  // correct shape and stops the cost growing with the table count, not because
  // it bought back a measured second.
  function tableIndex(event){
    const map=new Map();
    for(const t of event.tables||[])map.set(t.id,t);
    return map;
  }
  globalThis.meritTableIndex=tableIndex;
  function guestSelectionRows(event){
    const q=ui.seatingQuery.trim().toLocaleLowerCase("tr"),showAll=ui.seatingGuestScope==="all";
    if(!q)return event.guests.filter(g=>showAll||!g.assignment);
    const byId=tableIndex(event);
    return event.guests.filter(g=>(showAll||!g.assignment)&&
      [g.name,g.vip,g.invitedBy,g.planningStatus,byId.get(g.assignment?.tableId)?.number]
        .join(" ").toLocaleLowerCase("tr").includes(q));
  }
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
    const byId=tableIndex(event);
    const queue=records.length?records.map(g=>{
      const t_=g.assignment&&byId.get(g.assignment.tableId);
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
  // `byId` is optional so single-row callers stay simple; list callers pass
  // the index they already built rather than scanning the table array once
  // per row.
  function seatTagHTML(event,g,byId){
    const t_=g.assignment&&(byId?byId.get(g.assignment.tableId):event.tables.find(x=>x.id===g.assignment.tableId));
    if(!t_)return`<span class="seat-tag none">${t("live.noTable")}</span>`;
    return`<span class="seat-tag">${esc(formatTableNumber(t_.number))}${g.assignment.seats?.length?` · ${esc(seatRange(g.assignment.seats))}`:""}</span>`;
  }
  const ARRIVAL_ORDER={"Not Arrived":0,"Checked In":1,"No Show":2};
  // What the current search actually narrowed to, so the Enter key acts on
  // exactly the rows the operator can see. Deliberately a local, not ui state:
  // it is a property of the last render, and must never reach the stored schema.
  let liveVisibleIds=[];
  // How many arrival rows are mounted at a time, and how much a scroll adds.
  // Sized to comfortably overfill the tallest supported viewport so the first
  // screen is never short, without paying for 3,000 rows.
  const LIVE_WINDOW_STEP=60;
  liveHTML = function(event){
    const q=ui.liveQuery.trim().toLocaleLowerCase("tr"),s=liveStats(event);
    if(!ui.liveRecent)ui.liveRecent=[];
    const byId=tableIndex(event);
    const rows=event.guests
      .filter(g=>!q||[g.name,g.vip,g.invitedBy,g.planningStatus,g.arrivalStatus,byId.get(g.assignment?.tableId)?.number].join(" ").toLocaleLowerCase("tr").includes(q))
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
    // Only the rows an operator can actually reach are built.
    //
    // Measured on 3,000 guests: first paint was 587ms median / 778ms p95,
    // split build 203 / parse 233 / layout 164, for 46,141 DOM nodes and
    // 1.9MB of HTML. There is no single hotspot to fix -- the cost IS
    // building every row -- so the fix is to stop building rows nobody sees.
    //
    // Nothing above this line changes: the filter, the arrival sort, the
    // metric strip, and liveVisibleIds (which arms Enter-to-check-in and must
    // reflect the WHOLE match set, or Enter would fire on the wrong person)
    // all still run over every guest. Only the DOM is capped, and the window
    // grows on scroll so the list is still fully browsable.
    const windowed=rows.slice(0,ui.liveWindow||LIVE_WINDOW_STEP);
    const hiddenCount=rows.length-windowed.length;
    const list=rows.length?windowed.map(g=>{
      const isIn=g.arrivalStatus==="Checked In",isNo=g.arrivalStatus==="No Show";
      const armed=g.id===armedId;
      return`<div class="arrival-row ${isIn?"is-in":isNo?"is-no":""} ${armed?"is-armed":""}">
        <div class="arrival-who"><div class="party-name">${esc(g.name)}</div><div class="party-sub">${partyMetaHTML(g)}</div></div>
        <div>${seatTagHTML(event,g,byId)}</div>
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
          <div class="mx-list" id="liveList" style="margin-top:12px">${list}</div>
          ${hiddenCount>0?`<div class="live-more" id="liveMore"><span>${t("live.showingOf",{shown:windowed.length,total:rows.length})}</span><button class="btn sm" data-live-action="show-more">${t("live.showMore")}</button></div>`:""}
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
        // A new search is a new list, so the window starts again from the top.
        ui.liveWindow=LIVE_WINDOW_STEP;
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
    // Growing the window must NOT go through render(): a full re-render would
    // throw away the scroll position the operator just used to get here. The
    // extra rows are appended and the new buttons bound, nothing else moves.
    const growLive=()=>{
      const event=activeEvent();
      const before=ui.liveWindow||LIVE_WINDOW_STEP;
      ui.liveWindow=before+LIVE_WINDOW_STEP;
      const scroller=document.querySelector(".mx-screen")||document.scrollingElement;
      const keep=scroller?scroller.scrollTop:0;
      render();
      if(scroller)scroller.scrollTop=keep;
    };
    const more=document.querySelector("[data-live-action='show-more']");
    if(more)more.onclick=growLive;
    // Reaching the end of the list grows it without asking, so the button is a
    // fallback for keyboard and assistive use rather than the only way through.
    const sentinel=document.getElementById("liveMore");
    if(sentinel&&typeof IntersectionObserver==="function"){
      const io=new IntersectionObserver(entries=>{
        if(entries.some(e=>e.isIntersecting)){io.disconnect();growLive();}
      },{rootMargin:"400px"});
      io.observe(sentinel);
    }
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
    const guests=filteredGuests(event),c=guestCounts(event),byId=tableIndex(event);
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
        guests.length?guests.map(g=>`<div class="mx-row cols-guest">${guestPartyCellHTML(event,g)}<div><span class="plan-tag ${g.planningStatus.toLowerCase()}">${esc(t("status.planning."+g.planningStatus))}</span></div><div class="muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.invitedBy||"—")}</div><div>${seatTagHTML(event,g,byId)}${g.assignment?.locked?" 🔒":""}</div><div class="row-icons"><button class="row-action" aria-label="${esc(t("guests.a11y.seat",{name:g.name}))}" title="${t("guests.col.tableSeat")}" data-guest-seat="${g.id}">${icon("seat")}</button><button class="row-action" aria-label="${esc(t("guests.a11y.edit",{name:g.name}))}" data-guest-edit="${g.id}">${icon("edit")}</button><button class="row-action" aria-label="${esc(t("guests.a11y.delete",{name:g.name}))}" data-guest-delete="${g.id}">${icon("trash")}</button></div></div>`).join(""):`<div class="mx-empty" style="border:none;background:none">${t("guests.noMatches")}</div>`
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
  // ---- deskew -------------------------------------------------------------
  // A scan is never quite square to the page, and this pipeline is unusually
  // sensitive to that: almost every gate upstream of the oriented box uses the
  // AXIS-ALIGNED width and height of a component. Three degrees inflates the
  // box of an elongated object and changes its measured elongation, which moves
  // it into a different size-and-shape family — so one chair family splits into
  // several under-supported ones and each is then too small to be admitted.
  // Measured on the rotate variants before this existed: armchair recall fell
  // from 1.000 to 0.823 and review groups went from 12 to 35 and 41.
  //
  // Correcting the image once fixes every one of those gates at the same time,
  // which is why this is a deskew and not a rotation-tolerance rule in each of
  // them.
  //
  // Estimated by projection profile: rotate the ink by each candidate angle and
  // keep the one whose horizontal projection is most concentrated, because a
  // long wall collapses into a few tall rows only when it is parallel to the
  // scan direction. Per-pixel gradient voting was tried first and is NOT used:
  // a line drawn at 2 degrees is rendered as a staircase whose every local
  // gradient is exactly axis-aligned, so the aliasing votes for zero and drags
  // the estimate down. Measured, that method returned 1.74 and -2.54 for known
  // rotations of +2 and -3; this one returns 1.998 and -3.000.
  const SKEW_MAX_DEG=6,SKEW_STEP=.25,SKEW_MIN_DEG=.35,SKEW_MIN_GAIN=1.08;
  function estimatePlanSkew(sourceCanvas,width,height){
    // Skew is a global property of the drawing, so it is measured small.
    const target=500,s=Math.min(1,target/Math.max(width,height));
    const W=Math.max(8,Math.round(width*s)),H=Math.max(8,Math.round(height*s));
    const small=document.createElement("canvas");small.width=W;small.height=H;
    const sctx=small.getContext("2d",{willReadFrequently:true});
    sctx.drawImage(sourceCanvas,0,0,W,H);
    const d=sctx.getImageData(0,0,W,H).data;
    const gray=new Float32Array(W*H);
    for(let i=0,o=0;i<W*H;i++,o+=4)gray[i]=d[o]*.299+d[o+1]*.587+d[o+2]*.114;
    // Ink is gradient magnitude, so a pale plan and a dark one behave alike.
    const ink=new Float32Array(W*H);let inkTotal=0;
    for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
      const i=y*W+x,m=Math.abs(gray[i+1]-gray[i-1])+Math.abs(gray[i+W]-gray[i-W]);
      if(m>40){ink[i]=m;inkTotal+=m;}
    }
    if(!inkTotal)return{deg:0,gain:1,measured:false};
    const cx=W/2,cy=H/2,rows=new Float32Array(H+2);
    const scoreAt=deg=>{
      const r=deg*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r);
      rows.fill(0);
      for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
        const v=ink[y*W+x];if(!v)continue;
        const ry=((x-cx)*-sin+(y-cy)*cos+cy)|0;
        if(ry>=0&&ry<H)rows[ry]+=v;
      }
      let sum=0;for(let i=0;i<H;i++)sum+=rows[i]*rows[i];
      return sum;
    };
    const scores=[];let best=0,bestScore=-1,zero=1;
    for(let deg=-SKEW_MAX_DEG;deg<=SKEW_MAX_DEG+1e-9;deg+=SKEW_STEP){
      const sc=scoreAt(deg);scores.push(sc);
      if(Math.abs(deg)<1e-9)zero=sc||1;
      if(sc>bestScore){bestScore=sc;best=deg;}
    }
    const i0=Math.round((best+SKEW_MAX_DEG)/SKEW_STEP);
    const l=scores[i0-1]??bestScore,m=bestScore,r=scores[i0+1]??bestScore,den=l-2*m+r;
    const refined=best+(den?.5*(l-r)/den:0)*SKEW_STEP;
    return{deg:+refined.toFixed(3),gain:+(bestScore/zero).toFixed(4),measured:true};
  }
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
    // A luma floor used to exclude dark peaks here, on the theory that anything
    // dark enough is linework. On white paper that floor lands at 114, and a
    // mid-grey chair fill sits at 110 -- so on every monochrome plan the chair
    // family was thrown away as "ink" before a single component was looked at.
    // Measured on the dense grayscale fixture: 96 chairs, 0 detected, because
    // their tone family never existed.
    //
    // Darkness is the wrong question. Linework is THIN; furniture is a solid,
    // repeated, similarly-sized blob. That is a structural property and it is
    // measured per family from the family's own components, in the mask loop
    // below, where the pixels are actually available. Here the job is only to
    // offer the candidates -- including dark ones, flagged so the structural
    // test can be stricter with them.
    const inkCeil=Math.max(90,background.luma*.45);
    // Every qualifying peak is a candidate surface family, not the three
    // largest.
    //
    // This used to be `.slice(0,3)` — a top-three-by-mass cut — and a minority
    // furniture surface is DEFINED by having little mass, so that cap was not a
    // tie-break but a structural exclusion. Measured on the real venue plan:
    // its luma peaks are 29, 109, 121, 146, 169, 201, 229, 255, and the bistro
    // tables' tan surface does peak, at 201. The cut kept 229 (bulk grey
    // architecture) and 121/146 (linework), so no tint mask ever contained the
    // tan; the five bistro discs then scored 0.124-0.132 surface coverage
    // against a 0.22 floor and were deleted. All five of this plan's remaining
    // table misses were those tables. See benchmarks/SINGLE-FAMILY-AUDIT.md.
    //
    // Mass was never the right question. Whether a tone family is furniture is
    // decided downstream, from the family's own components -- are they compact,
    // repeated, similarly sized -- and that test cannot run on a family that
    // was thrown away before its mask was built. The filter conditions here
    // (real mass, not the background, above the ink ceiling) select candidates;
    // the structural test selects families.
    //
    // Bounded by the peak finder's own limit rather than an independent number.
    // Each family claims only a narrow band around its own peak, computed from
    // the gap to the nearest PEAK (not the nearest family), so admitting one
    // more family cannot widen or narrow anybody else's band -- the measured
    // failure that produced the old cap was adding DARK peaks, which sit close
    // together and do fight over pixels, and those are still kept out of this
    // list entirely (darkCandidates below).
    const families=peaks.filter(p=>p!==background&&p.luma<background.luma-10&&p.luma>inkCeil&&p.fraction>=.002)
      .sort((a,b)=>b.mass-a.mass);
    // Peaks the ceiling rejects. These are NOT added to `families`, because
    // `families` drives the nearest-family tone LUT and adding to it steals
    // pixels from the table surface family -- measured on the real colour
    // plan, tone sources fell 57 -> 23 and the table masks fragmented.
    //
    // They get their own standalone masks instead, and are offered only to the
    // chair pool, where the grayscale failure actually is.
    const darkFloor=Math.max(35,background.luma*.15);
    const darkCandidates=peaks.filter(p=>p!==background&&p.luma<=inkCeil&&p.luma>darkFloor&&p.fraction>=.0015)
      .sort((a,b)=>b.mass-a.mass).slice(0,3);
    const toneLut=new Uint8Array(256);
    families.forEach((family,index)=>{
      let gap=Infinity;
      for(const p of peaks)if(p!==family)gap=Math.min(gap,Math.abs(p.luma-family.luma));
      const window=Math.max(3,Math.min(14,Math.floor(gap/2)));
      for(let v=Math.max(0,family.luma-window);v<=Math.min(255,family.luma+window);v++)
        if(!toneLut[v]||Math.abs(v-family.luma)<Math.abs(v-families[toneLut[v]-1].luma))toneLut[v]=index+1;
    });
    return{peaks,background,families,darkCandidates,toneLut,
      summary:{peaks:peaks.map(p=>p.luma),backgroundLuma:background.luma,
        families:families.map(f=>({luma:f.luma,fraction:Number(f.fraction.toFixed(4))})),
        darkCandidates:darkCandidates.map(f=>({luma:f.luma,fraction:Number(f.fraction.toFixed(4))}))}};
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
    async detect(pixels,width,height,{onStage,protectedRegions=[]}={}){
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
      // The chair FLOOR is a fraction of the plan, like the ceiling already is.
      //
      // It used to be an absolute 3 pixels, which says nothing about a drawing:
      // it is below the width of antialiasing fringe at this resolution, and at
      // 70% scale it stops excluding anything at all. Two measured failures came
      // through it. The `downscale-70` variant exploded from 0 to 73 false
      // chairs. And once the tone model was allowed to see minority surface
      // families, the real plan's tan bistro finish arrived as 823 components
      // whose median side is 4.9px — edge fringe, not furniture — and the
      // structural test called that repeated population a chair family.
      //
      // A chair is a drawn object. On a 765px-tall plan the floor is 7.7px, the
      // smallest real seat is 15px, and the fringe is 5px. Expressed against the
      // plan rather than the pixel grid, it means the same thing at every
      // rendering scale, which is the point.
      const CHAIR_MIN_SIDE_P=.01;
      const chairSizeOk=c=>notWall(c)&&Math.min(c.w,c.h)>=minDim*CHAIR_MIN_SIDE_P&&Math.max(c.w,c.h)<=minDim*.065&&c.w*c.h<area*.0028;
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
      let fallbackChairComps=[],fallbackChairLabels=null,accentMask=null,surfaceMask=null,masksTints=null;
      // Which tint families the plan uses as CHAIR material, aligned with masksTints.
      const tintIsChairMaterial=[];
      // (a) interiors of closed outlines — the primary table source
      {
        const enclosed=enclosedRegions(barrier,width,height);
        const{labels,comps}=labelComponents(enclosed,width,height,minPixels,false);
        const kept=comps.filter(c=>tableSizeOk(c)&&c.fill>=.35);
        for(const c of kept)c.source="interior";
        diagnosticsSources.interior=kept.length;
        sources.push({name:"interior",labels,comps:kept,all:comps});
        // The same enclosed interiors, at chair scale, are a chair source.
        // Not every chair is a filled symbol: the round tables on the real
        // venue plan are ringed by OUTLINED pale chairs, which carry no
        // saturated colour and no distinct fill tone, so neither the accent
        // cluster nor any tone family can see them. What they do have is a
        // closed outline, which is exactly what this pass already extracts --
        // it was simply never offered to the chair pool.
        const interiorChairs=comps.filter(c=>chairSizeOk(c)&&c.fill>=.35);
        if(interiorChairs.length)chairSources.push({name:"outline-interior",labels,
          rawCount:comps.length,comps:interiorChairs});
        mark("interiors");
      }
      // (b) tinted/solid fills straight from the colour model — one mask per
      //     tone family, so a mid-grey chair fill and a pale table fill cannot
      //     end up in the same mask and merge
      if(accentModel||toneModel){
        const masks=buildClassMasks(data,gray,total,accentModel,toneModel);
        accentMask=masks.accent;
        masksTints=masks.tints;
        // The tint family that actually carries furniture surfaces, kept as a
        // per-pixel mask so a table candidate can later be asked the direct
        // question "is this thing made of table?". Chosen by how much of the
        // drawing it covers, which on a seating plan is the table fill.
        //
        // Asking every solid tint family instead, and taking the best answer,
        // was tried here: it is the same "a plan may have two families" fix
        // that worked for chairs, and this plan does draw its bistro tables in
        // a different finish (tan, luma 213) from its banquet tables (pale
        // grey, luma 229). It changed nothing on the real plan — the tan is
        // not a tint family at all, so there was no second family to find —
        // and it cost the dense fixture four table false positives, because
        // there a second solid family exists and "made of SOME furniture tone"
        // is a weaker question than "made of THE table tone".
        //
        // The real-plan bistro finish needs the tone model to see tan as a
        // family in the first place; widening this consumer of it does not
        // help. Left as it was, with the finding recorded.
        surfaceMask=masks.tints.length?masks.tints.reduce((best,m)=>{
          let n=0;for(let i=0;i<total;i+=7)if(m[i])n++;
          return (!best||n>best.n)?{mask:m,n}:best;
        },null)?.mask||null:null;
        let toneKept=0;
        const toneFamilyEvidence=[];
        masks.tints.forEach((mask,index)=>{
          const solidity=maskSolidity(mask,width,height);
          const family=toneModel?.families?.[index]||null;
          const{labels,comps}=labelComponents(mask,width,height,minPixels,true);

          // Is this tone family furniture, or is it linework?
          //
          // Not decided by how dark it is. Linework is thin: its components
          // sprawl, have low fill inside their own bounding box, and vary
          // wildly in size. Furniture repeats: many components at nearly the
          // same scale, each solidly filling its box. So the family is asked
          // about its own components.
          const compact=comps.filter(c=>c.fill>=.45&&Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h))<=2.2);
          const sides=compact.map(c=>Math.sqrt(c.w*c.h)).sort((a,b)=>a-b);
          const medSide=sides.length?sides[sides.length>>1]:0;
          // How tightly the compact components agree on one size. A repeated
          // furniture symbol clusters hard; incidental ink blobs do not.
          const nearModal=medSide?compact.filter(c=>{
            const s=Math.sqrt(c.w*c.h);return s>=medSide*.65&&s<=medSide*1.55;}).length:0;
          const repetition=compact.length?nearModal/compact.length:0;
          // ...and what repeats has to be big enough to be a drawn object.
          //
          // Repetition alone says "many similar blobs", which is equally true of
          // a seating row and of the antialiasing band along every edge in the
          // drawing. Measured, once minority tone families were admitted: the
          // real plan's tan surface family arrives as 823 components whose
          // modal side is 4.9px against a 7.7px chair floor — fringe — and it
          // passed this test on 148 of 192 compact components agreeing with
          // each other. It then contributed 22 false chairs.
          //
          // The family's own modal size is the honest thing to ask about, and
          // the floor is the same plan-relative one a single chair must clear.
          const familyModalOk=medSide>=minDim*CHAIR_MIN_SIDE_P;
          const looksLikeFurniture=nearModal>=6&&repetition>=.55&&familyModalOk;
          // A dark family has to clear the structural bar outright, since dark
          // families are where linework actually lives. A light family may also
          // pass on the old solidity signal alone.
          const tableWorthy=solidity>=.25; // antialiasing fringe along outlines, not a real filled object
          const chairWorthy=looksLikeFurniture;
          toneFamilyEvidence.push({index,luma:family?.luma??null,
            solidity:Number(solidity.toFixed(3)),components:comps.length,compact:compact.length,
            nearModal,repetition:Number(repetition.toFixed(2)),
            modalSide:medSide?Number(medSide.toFixed(1)):null,
            usedForTables:tableWorthy,usedForChairs:chairWorthy,
            verdict:tableWorthy?"furniture surface (solid mask)":chairWorthy?"repeated compact family (chairs only)":"linework"});
          // On a neutral drawing one tone family IS the chairs (a mid-grey
          // chair fill against a pale table fill), so tone families are a real
          // chair source, not only a table source.
          tintIsChairMaterial[index]=chairWorthy;
          if(chairWorthy)chairSources.push({name:"tone-cluster"+index,labels,rawCount:comps.length,comps:comps.filter(c=>chairSizeOk(c)&&c.fill>=.3)});
          if(!tableWorthy)return;
          const kept=comps.filter(c=>tableSizeOk(c)&&c.fill>=.35);
          for(const c of kept)c.source="tone";
          toneKept+=kept.length;
          sources.push({name:"tone"+index,labels,comps:kept,all:comps});
        });
        diagnosticsSources.tone=toneKept;
        diagnosticsSources.toneFamilies=toneFamilyEvidence;

        // ---- dark repeated families, chairs only --------------------------
        // A mid-grey chair fill on white paper sits below the ink ceiling, so
        // the tone families above never see it: measured on the dense
        // grayscale fixture, 96 chairs and 0 detected, because their family
        // was discarded as linework before a component was examined.
        //
        // Darkness is the wrong question. Linework is thin; furniture is a
        // solid, repeated, similarly-sized blob. Each rejected dark peak gets
        // its own standalone mask -- deliberately NOT part of the tone LUT,
        // which would steal pixels from the table surface -- and earns a place
        // in the chair pool only by that structure.
        for(const [di,peak] of (toneModel?.darkCandidates||[]).entries()){
          let gap=Infinity;
          for(const q of toneModel.peaks)if(q!==peak)gap=Math.min(gap,Math.abs(q.luma-peak.luma));
          const window=Math.max(4,Math.min(16,Math.floor(gap/2)));
          const dmask=new Uint8Array(total);
          for(let i=0;i<total;i++){const v=gray[i];if(Math.abs(v-peak.luma)<=window)dmask[i]=1;}
          const{labels,comps}=labelComponents(dmask,width,height,minPixels,true);
          const compact=comps.filter(c=>c.fill>=.45&&Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h))<=2.2);
          const sides=compact.map(c=>Math.sqrt(c.w*c.h)).sort((a,b)=>a-b);
          const medSide=sides.length?sides[sides.length>>1]:0;
          const nearModal=medSide?compact.filter(c=>{
            const sv=Math.sqrt(c.w*c.h);return sv>=medSide*.65&&sv<=medSide*1.55;}).length:0;
          const rep=compact.length?nearModal/compact.length:0;
          const furniture=nearModal>=6&&rep>=.55;
          toneFamilyEvidence.push({index:"dark"+di,luma:peak.luma,belowInkCeiling:true,
            components:comps.length,compact:compact.length,nearModal,
            repetition:Number(rep.toFixed(2)),modalSide:medSide?Number(medSide.toFixed(1)):null,
            usedForTables:false,usedForChairs:furniture,
            verdict:furniture?"repeated compact family (chairs only)":"linework"});
          if(furniture)chairSources.push({name:"dark-tone-cluster"+di,labels,rawCount:comps.length,
            comps:comps.filter(c=>chairSizeOk(c)&&c.fill>=.3)});
        }
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
        chairSources.unshift({name:"colour-cluster",labels,rawCount:comps.length,comps:comps.filter(c=>chairSizeOk(c)&&c.fill>=.3)});
      }
      // The same physical chair can surface in more than one mask; the most
      // specific source wins and the duplicate is dropped (overlap of the
      // smaller box, not IoU, because the masks disagree slightly on size).
      const chairEntries=[];
      // Which chair family an entry belongs to. Everything the primary source
      // claimed is one family; each secondary family admitted below is its own.
      // This is the axis the whole chair stage reasons on from here down —
      // "which family is this, and does it look like the rest of THAT family"
      // rather than "does this look like the one modal object on the plan".
      const chairFamilyOf=e=>(e.source||"").startsWith("family:")?e.source:"primary";
      const addChairs=(comps,labels,name)=>{
        for(const c of comps){
          if(chairEntries.some(e=>sameObject(e.comp,c)))continue;
          c.source=name;
          chairEntries.push({comp:c,labels,source:name});
        }
      };
      let chairSource="none";
      // On a plan where the chairs have their OWN colour, the dedicated accent
      // cluster is the whole chair population and the tone families describe
      // something else -- on the real venue plan the strongest tone family IS
      // the tan table surface. Unioning the two sources therefore fed real
      // tables into the chair list, which both removed them from the table pool
      // (they get subtracted from it below) and inflated the seat count with
      // objects nobody sits on. Measured on that plan: tables were reported as
      // `venue/chair`, and the seat total only looked close to the drawing's
      // printed 124 because tables were padding it.
      //
      // So: the most specific source wins outright rather than being merged
      // with a weaker one. tone-cluster stays the chair source for monochrome
      // plans, where it is the only evidence there is.
      const colourChairs=chairSources.find(src=>src.name==="colour-cluster");
      const useColourOnly=colourChairs&&colourChairs.comps.length>=6;
      // MEASURED LIMITATION, deliberately left in place rather than traded away.
      //
      // On a colour plan only the accent cluster feeds the chair pool. That
      // costs the pale OUTLINED chairs ringing the round tables on the real
      // venue plan: they carry no accent colour and no distinct fill tone, so
      // the outline-interior source is the only evidence that can see them,
      // and it is excluded here.
      //
      // Letting it through was tried and measured. Real-plan chairs went
      // 79 -> 124 (which happens to match the drawing's printed 124), but
      // tables collapsed: F1 0.882 -> 0.543, and 0 of 24 square tables
      // survived. The reason is structural, not a tuning miss -- chairs are
      // subtracted from the table pool, and on THIS plan the chair symbols
      // (~34px) and the square tables (~44px) both pass chairSizeOk, whose
      // ceiling is 0.065 of the short edge, about 51px. So the source claims
      // real tables as chairs.
      //
      // The honest fix is a pipeline reordering: the chair/table split for
      // size-ambiguous components has to happen AFTER the modal table size is
      // known, so each component can be assigned to whichever modal it agrees
      // with. That is real work, not a threshold, and a chair number bought by
      // destroying table recall is worth nothing. See the sprint report.
      // A/B switch so the cost of the colour-only gate can be measured on the
      // same build against per-family ground truth, rather than argued about.
      // Benchmarks set it; the product never does.
      //
      // ---- secondary chair families (measured, see the table) ---------------
      //
      // Against per-chair ground truth on the real plan, the colour source is
      // exactly right and exactly incomplete:
      //
      //                     colour only        every source
      //   orange armchair    79/79              79/79
      //   bistro chair        0/10             10/10
      //   pale outlined       0/24             24/24
      //   chair TP / FP      79 / 0           113 / 303
      //   table F1            0.882             0.804
      //
      // The two missing families are not invisible to this pipeline. Every one
      // of the 34 is found by a source the colour gate discards -- along with
      // 303 things that are not chairs. That makes this a PRECISION problem
      // rather than a recall one, and precision is answerable with evidence.
      //
      // A real chair on a floor plan sits against a table. A shard of linework
      // does not, and neither does printed text. So the candidates the colour
      // source did not claim are grouped into families by size and shape, and
      // a family is admitted only when most of its members are adjacent to a
      // table SURFACE component -- available here because the surface masks
      // are built in this same pass. Repetition alone is NOT enough and was
      // measured wrong before (benchmarks/BISTRO-MERGE.md); adjacency is
      // evidence a text run or a wall fragment cannot fake.
      //
      // "Near a bigger thing" is not that evidence on its own, and measuring it
      // proved it: printed matter sits INSIDE a drawn legend box, whose filled
      // interior is itself a surface component, so every glyph of the capacity
      // block "touched a surface" and nine of them were admitted as chairs.
      //
      // The physical fact is narrower than adjacency. You sit AGAINST a table,
      // never inside one. So a candidate whose centre pixel belongs to the
      // surface it is near is contained BY that surface, not seated at it, and
      // it does not count. This is tested against the surface's actual mask
      // rather than its bounding box, because a chair in the ring around a
      // round table is inside that table's bounding SQUARE while being well
      // clear of the disc -- a box test would throw away every round-table
      // chair on this plan to catch the glyphs.
      const surfaceEntries=sources.flatMap(src=>src.comps.map(c=>({comp:c,labels:src.labels})));
      const gapTo=(a,b)=>Math.max(0,Math.max(a.x-(b.x+b.w),b.x-(a.x+a.w)))
        +Math.max(0,Math.max(a.y-(b.y+b.h),b.y-(a.y+a.h)));
      const surfaces=surfaceEntries.map(e=>e.comp);
      const containedBy=(c,e)=>{
        const cx=Math.round(c.x+c.w/2),cy=Math.round(c.y+c.h/2);
        if(cx<0||cy<0||cx>=width||cy>=height||!e.labels)return false;
        return e.labels[cy*width+cx]===e.comp.label;
      };
      //
      // And "something bigger nearby" is not the test either. Measured on the
      // real plan, the surface each capacity-block glyph was found against was
      // its own WORD: 49x20, 38x20, 58x21 — bigger, yes, but exactly as tall
      // as the glyph and grown only sideways. The surfaces real seats sit
      // against were 36x32, 67x67, 68x69.
      //
      // A table is broader than a chair in EVERY direction and several times
      // its area, because it seats several of them along each usable side. A
      // line of text can only ever be as tall as its own letters. That is the
      // difference, and it is a fact about furniture rather than a threshold
      // chosen to make this plan pass. The two numbers below are read off the
      // real plan (real seats: 3.3x area and up; glyphs: 1.1-2.9x) and are
      // guarded by the benchmark.
      // An aspect bar on the surface was tried here too -- a table is roughly
      // as broad as it is deep, a line of text is a line -- and it changed
      // nothing on any fixture, so it is not in the code. The five remaining
      // false chairs reach their surfaces some other way. An unexercised
      // constant is an unmeasured claim, and this one would also reject a long
      // trestle table, which is a real seat surface.
      const SEAT_SURFACE_MIN_AREA=3;
      const seatSurfaceFor=c=>{
        const reach=Math.max(c.w,c.h)*.7,area=c.w*c.h,longSide=Math.max(c.w,c.h);
        return surfaceEntries.find(e=>e.comp!==c&&!sameObject(e.comp,c)
          &&gapTo(c,e.comp)<=reach
          &&Math.min(e.comp.w,e.comp.h)>longSide
          &&e.comp.w*e.comp.h>=area*SEAT_SURFACE_MIN_AREA
          &&!containedBy(c,e))||null;
      };
      const touchesSurface=c=>!!seatSurfaceFor(c);
      // A secondary family also has to be a plausible SEAT. The primary colour
      // family gives the reference: on the real plan its chairs are ~35px, the
      // bistro chairs are ~17px and the pale crescents ~25px, so a factor of
      // about two below the reference is a real minority family. Without this
      // band the adjacency rule happily admitted families of 4-6px specks --
      // they repeat, and on a dense plan everything is near something.
      const SECONDARY_MIN_MEMBERS=4,SECONDARY_MIN_ADJACENT=.7;
      // Two bounds, and they anchor to different things on purpose.
      //
      // The FLOOR is relative to the primary chair family: a minority seat is
      // smaller than the main one but not by an order of magnitude. On the real
      // plan the reference is ~35px, the bistro chairs are ~17 and the pale
      // crescents ~25. Without a floor, adjacency admitted families of 4-6px
      // specks -- they repeat, and on a dense plan everything is near something.
      //
      // The CEILING is relative to the plan's own SURFACES, not to the chair.
      // Anchoring it to the chair (1.6x of 35 = 56px) admitted a family at
      // table scale, which removed 22 of 22 square tables from the table pool
      // and took table F1 to 0.529. Nothing the size of this plan's surfaces
      // may be claimed as a chair; the table pool needs it more.
      const SECONDARY_MIN_SIDE_RATIO=.4,SECONDARY_MAX_SURFACE_RATIO=.75;
      const secondaryFamilies=[];
      let primaryFamilyComps=colourChairs?colourChairs.comps:[];
      if(useColourOnly&&!globalThis.MERIT_ALL_CHAIR_SOURCES){
        // The PRIMARY source is not one family either, and assuming it was is
        // what hid the bistro seats for so long. On the real plan the accent
        // colour belongs to both the 34px armchairs and the 17px bistro
        // chairs: the colour cluster offers 111 components, the modal size
        // gate downstream keeps 79, and the ~10 it drops are real chairs found
        // by the strongest evidence this pipeline has. They were thrown away
        // for not resembling their bigger cousins.
        //
        // So the colour source is split the same way as everything else: its
        // dominant size family is the REFERENCE (it defines what a chair is on
        // this plan, and everything downstream measures against it), and its
        // minority members go back into the pool to earn admission on the same
        // adjacency evidence as any other family. A minority family is not
        // trusted because it shares a colour -- printed matter in the accent
        // colour would share it too -- it is trusted because most of its
        // members sit against a table surface.
        const primaryModal=modalMagnitude(colourChairs.comps.map(c=>Math.sqrt(c.w*c.h)));
        const inPrimaryFamily=c=>!primaryModal||sizeAgreement(Math.sqrt(c.w*c.h),primaryModal)>=.25;
        const claimed=colourChairs.comps.filter(inPrimaryFamily);
        primaryFamilyComps=claimed;
        const extra=colourChairs.comps.filter(c=>!inPrimaryFamily(c))
          .map(c=>({comp:c,source:colourChairs}));
        for(const src of chairSources){
          if(src===colourChairs)continue;
          for(const c of src.comps){
            if(claimed.some(k=>sameObject(k,c))||extra.some(k=>sameObject(k.comp,c)))continue;
            extra.push({comp:c,source:src});
          }
        }
        // Family key: size and elongation, both on a log scale, so a family is
        // "objects drawn the same" rather than "objects within N pixels".
        const keyOf=c=>{
          const side=Math.sqrt(c.w*c.h),elong=Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h));
          return Math.round(Math.log(side)/Math.log(1.18))+":"+Math.round(Math.log(elong)/Math.log(1.25));
        };
        const medianSide=list=>{
          const v=list.map(c=>Math.sqrt(c.w*c.h)).sort((a,b)=>a-b);
          return v.length?v[v.length>>1]:0;
        };
        const referenceSide=medianSide(claimed);
        // How far apart the primary family's own seats stand, and how close a
        // candidate is to the nearest of them. A genuinely distinct seat family
        // sits at ITS OWN tables; a family of debris shed by the primary one
        // interleaves with the seats it came from.
        const centreOf=c=>[c.x+c.w/2,c.y+c.h/2];
        const primaryCentres=claimed.map(centreOf);
        const nearestPrimaryDistance=c=>{
          const[cx,cy]=centreOf(c);let best=Infinity;
          for(const[px,py] of primaryCentres){
            const d=Math.hypot(cx-px,cy-py);
            if(d<best)best=d;
          }
          return best;
        };
        const spacings=primaryCentres.map(([x0,y0])=>{
          let best=Infinity;
          for(const[px,py] of primaryCentres){
            if(px===x0&&py===y0)continue;
            const d=Math.hypot(x0-px,y0-py);
            if(d<best)best=d;
          }
          return best;
        }).filter(Number.isFinite).sort((a,b)=>a-b);
        const primarySpacing=spacings.length?spacings[spacings.length>>1]:0;
        const surfaceSide=medianSide(surfaces.filter(c=>Math.min(c.w,c.h)>=6));
        const groups=new Map();
        for(const e of extra){const k=keyOf(e.comp);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
        for(const [key,members] of groups){
          if(members.length<SECONDARY_MIN_MEMBERS)continue;
          const sides=members.map(m=>Math.sqrt(m.comp.w*m.comp.h)).sort((a,b)=>a-b);
          const side=sides[sides.length>>1];
          const sizeOk=(!referenceSide||side>=referenceSide*SECONDARY_MIN_SIDE_RATIO)
            &&(!surfaceSide||side<=surfaceSide*SECONDARY_MAX_SURFACE_RATIO);
          // Two questions, not one. The family answers "is a second kind of
          // seat drawn on this plan at all", and only a family most of whose
          // members sit at a table may say yes. Each MEMBER then answers "am I
          // one of them" for itself.
          //
          // Both are needed, because the trap on this plan is a family that is
          // genuinely mixed: the capacity block is printed at chair scale in
          // the chair's own colour, so its glyphs land in the same size-and-
          // shape family as the real bistro seats. Admitting the family whole
          // takes nine glyphs with it; rejecting it whole loses the seats.
          const seated=members.filter(m=>touchesSurface(m.comp));
          const adjacent=seated.length;
          const share=adjacent/members.length;
          // How much of this family is standing among the primary family's own
          // seats rather than at tables of its own.
          // Reported, not gated on. A genuinely distinct seat family sits at its
          // own tables and so stands well clear of the primary family's seats;
          // a family of debris shed by the primary one interleaves with them.
          // Measured, in units of the primary family's own seat spacing: the
          // real plan's five admitted families read 1.75 to 3.34, and the
          // `downscale-70` debris families read 1.04 and 1.07. It separates —
          // by 17%, on one plan, with the real plan's smallest admitted family
          // sitting closest to the line. That is not enough margin to delete a
          // family on, and it would remove 32 of that variant's 73 false chairs
          // rather than all of them. Left as evidence for whoever has more of it.
          const nearDists=members.map(m=>nearestPrimaryDistance(m.comp)).filter(Number.isFinite).sort((a,b)=>a-b);
          const medianNearPrimary=nearDists.length?nearDists[nearDists.length>>1]:Infinity;
          const crowding=primarySpacing?medianNearPrimary/primarySpacing:Infinity;
          const admitted=sizeOk&&share>=SECONDARY_MIN_ADJACENT;
          secondaryFamilies.push({key,members:members.length,adjacent,
            share:Number(share.toFixed(2)),admitted,sizeOk,
            side:Math.round(side),referenceSide:Math.round(referenceSide),surfaceSide:Math.round(surfaceSide),
            crowding:Number(crowding.toFixed(2)),primarySpacing:Math.round(primarySpacing),
            source:members[0].source.name});
          // One entry per originating source, all under the same family name.
          // The label map a component was found in is what shape analysis has
          // to re-read its pixels from, so a family whose members came from two
          // masks cannot be pushed as one source with one of their label maps —
          // the other half would be measured against the wrong pixels.
          if(admitted){
            const bySource=new Map();
            for(const m of seated){
              if(!bySource.has(m.source))bySource.set(m.source,[]);
              bySource.get(m.source).push(m.comp);
            }
            for(const [src,comps] of bySource)
              chairSources.push({name:"family:"+key,labels:src.labels,rawCount:comps.length,comps});
          }
        }
      }
      const admittedFamilies=secondaryFamilies.filter(f=>f.admitted);
      const activeChairSources=(useColourOnly&&!globalThis.MERIT_ALL_CHAIR_SOURCES)
        ?[{...colourChairs,comps:primaryFamilyComps},
          ...chairSources.filter(src=>src.name.startsWith("family:"))]
        :chairSources;
      const specificCount=activeChairSources.reduce((n,src)=>n+src.comps.length,0);
      // What each chair source actually offered, kept in diagnostics. Without
      // this the only visible fact is the final count, which cannot tell "the
      // source found nothing" apart from "the source found things and they
      // were filtered out" -- and those need opposite fixes.
      const chairSourceBreakdown=chairSources.map(src=>({
        name:src.name,offered:src.comps.length,
        rawPool:src.rawCount??null,
      })).concat([{name:"luma-fallback",offered:fallbackChairComps.length,rawPool:null}]);
      // Every secondary family considered, admitted or not, with the evidence
      // that decided it. A family rejected for sitting nowhere near a table is
      // the most useful line in this whole diagnostic.
      const secondaryFamilyDiagnostics={
        considered:secondaryFamilies.length,
        admitted:admittedFamilies.length,
        minMembers:SECONDARY_MIN_MEMBERS,minAdjacentShare:SECONDARY_MIN_ADJACENT,
        families:secondaryFamilies.slice().sort((a,b)=>b.members-a.members).slice(0,12),
      };
      if(specificCount>=6){
        for(const src of activeChairSources)addChairs(src.comps,src.labels,src.name);
        chairSource=activeChairSources.find(src=>src.comps.length)?.name||"none";
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
      //
      // The gap is per FAMILY, not per plan. A merge distance taken from the
      // majority chair (~34px here) is wider than a minority chair is big, so
      // a global gap would swallow whole rings of the smaller seats into one
      // blob each — the families would be recovered above and then quietly
      // destroyed here.
      {
        const provisionalOf=list=>modalMagnitude(list.map(e=>Math.sqrt(e.comp.w*e.comp.h)));
        const gapByFamily=new Map();
        for(const e of chairEntries){
          const k=chairFamilyOf(e);
          if(!gapByFamily.has(k))gapByFamily.set(k,[]);
          gapByFamily.get(k).push(e);
        }
        for(const [k,list] of gapByFamily){
          const p=provisionalOf(list);
          gapByFamily.set(k,p&&p.support>=4?p.value*.55:0);
        }
        const provisional=provisionalOf(chairEntries);
        if(provisional&&provisional.support>=4){
          const merged=[];
          for(const e of chairEntries){
            const minGap=gapByFamily.get(chairFamilyOf(e))||0;
            const cx=e.comp.x+e.comp.w/2,cy=e.comp.y+e.comp.h/2;
            const hit=minGap&&merged.find(m=>chairFamilyOf(m)===chairFamilyOf(e)
              &&Math.hypot(cx-(m.comp.x+m.comp.w/2),cy-(m.comp.y+m.comp.h/2))<minGap);
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
      const primaryComps=chairEntries.filter(e=>chairFamilyOf(e)==="primary").map(e=>e.comp);
      // The modal is the PRIMARY family's, not the whole chair population's.
      // Downstream this number stands for "how big is a chair on this plan"
      // when subtracting chairs from the table pool and setting the split
      // thresholds, and a minority family of smaller seats must not drag it
      // down — a chair-scale short modal is exactly what over-split real
      // tables the last time it moved.
      const chairModal=modalMagnitude((primaryComps.length?primaryComps:chairComps).map(c=>Math.sqrt(c.w*c.h)));
      // A trustworthy chair population is MANY objects of ONE size. If the
      // population is not uniform we say so in the result and fall back to the
      // table-first path instead of reporting a seat count we cannot defend.
      // Judged on the primary family for the same reason: admitting a second,
      // smaller family is evidence about the plan, not a loss of confidence in
      // the first one.
      const chairUniform=!!chairModal&&(primaryComps.length?primaryComps:chairComps).length>=6
        &&chairModal.support/chairModal.total>=.6;
      // Chairs on a plan are drawn identically, so the repeated SHAPE is real
      // evidence too. Elongation is measured orientation-invariantly
      // (long/short side), because the same chair drawn on the left of a table
      // is the same object rotated 90 degrees, not a different one. This is
      // what tells a chair-sized printed glyph from a chair without OCR.
      const elongationOf=c=>Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h));
      const chairModalElongation=modalMagnitude((primaryComps.length?primaryComps:chairComps).map(elongationOf));
      // One elongation mode, deliberately. A second mode was implemented here
      // and REVERTED once the real plan had per-chair ground truth to measure
      // against -- see benchmarks/BISTRO-MERGE.md.
      //
      // The idea was that a plan may seat two chair shapes, and it fixed a
      // synthetic bistro fixture completely (0 of 5 tables to 5 of 5). On the
      // real plan it appeared to gain 8 chairs, 79 to 87. With spatial truth
      // those 8 turned out to be the printed capacity block -- "114 pax
      // seating / 10 pax bistro / Total : 124 pax" -- at 35x17 and elongation
      // ~2.0. Zero real chairs gained, 8 false ones, plus a table false
      // positive and four more review groups.
      //
      // Which is the failure this test was written to prevent, in the words of
      // the comment below it: a chair-sized printed glyph is told from a chair
      // by its repeated SHAPE, and widening the shape gate let the glyphs in.
      // The fixture could not catch it because the fixture had no printed
      // matter on it; it does now.
      //
      // A second family is still the right idea, but it needs independent
      // evidence that text cannot fake -- adjacency to a table surface, not a
      // looser shape rule. Shape alone is not enough.
      //
      // That is what the secondary-family pass above does, and this is where
      // its result is honoured: the elongation and size a candidate is judged
      // against are ITS OWN family's, so a 17px crescent is not asked to
      // resemble a 34px armchair. The gate is not loosened — each family is
      // still held to a single repeated size and a single repeated shape, and
      // a family only exists at all because most of its members sit against a
      // table surface. A run of printed glyphs still fails, now for the reason
      // it should: it never becomes a family.
      const familyProfiles=new Map();
      for(const e of chairEntries){
        const k=chairFamilyOf(e);
        if(!familyProfiles.has(k))familyProfiles.set(k,[]);
        familyProfiles.get(k).push(e.comp);
      }
      for(const [k,comps] of familyProfiles){
        familyProfiles.set(k,{
          count:comps.length,
          size:k==="primary"?chairModal:modalMagnitude(comps.map(c=>Math.sqrt(c.w*c.h))),
          elongation:k==="primary"?chairModalElongation:modalMagnitude(comps.map(elongationOf)),
        });
      }
      const profileFor=e=>familyProfiles.get(chairFamilyOf(e))||null;
      // The SMALLEST chair family, for the downstream rule "nothing at chair
      // scale is a table".
      //
      // That rule is enforced with one number, and taking it from the majority
      // chair is the same mistake as judging every chair against the majority
      // chair. This plan is the case that proves it: its bistro tables measure
      // 36x31 to 36x39 against ~34x34 armchairs, so a floor of one armchair
      // area (1156px) sits right in the middle of them — 1224 and 1258 survive,
      // 1116 and 1152 are deleted as "chair-sized". A bistro table is bigger
      // than a bistro chair; it is not bigger than an armchair, and it does not
      // have to be.
      //
      // Worth knowing: this exact change was implemented and measured once
      // before and changed nothing at all, because the bistro tables were
      // already being deleted an earlier stage up, at surface coverage. It was
      // reverted then for that reason — a guard loosened for a reason that
      // sounds right and measures as nothing is a guard weakened for free. It
      // is back now because that earlier stage was fixed and this one became
      // the binding constraint, which is the only argument that should have
      // brought it back.
      const chairFamilySides=[...familyProfiles.values()].map(p=>p.size?.value).filter(v=>v>0);
      const chairFloorSide=chairFamilySides.length?Math.min(...chairFamilySides):null;
      const chairShapeOk=(c,profile)=>{
        const modalElongation=profile?.elongation||chairModalElongation;
        if(!chairUniform||!modalElongation)return true;
        const elongation=elongationOf(c);
        return Math.abs(Math.log(elongation/modalElongation.value))<=Math.log(1.6);
      };
      const chairAccepted=e=>{
        const profile=profileFor(e);
        const modalSize=profile?.size||chairModal;
        return sizeAgreement(Math.sqrt(e.comp.w*e.comp.h),modalSize)>=.25&&chairShapeOk(e.comp,profile);
      };
      // Cross-family duplicate suppression was tried here and is NOT in the
      // code, because it measured as a no-op on every plan and variant.
      //
      // The near-duplicate merge above is deliberately per-family, so a ring of
      // small seats is not swallowed by a gap measured from the big ones, and
      // that leaves no suppression BETWEEN families. On `downscale-70` that
      // looked like the cause of 73 false chairs: a 24px armchair fragments
      // into 8-14px pieces which are too far from the primary modal to be
      // claimed, form a minority family of their own, and pass the
      // table-adjacency test trivially. But the pieces sit BESIDE their parent
      // chair, 15-40px from its centre, not inside it — "nothing sits inside a
      // chair" is true and removes nothing. See the family diagnostics'
      // `crowding` figure for what does separate them, and why it is not
      // gated on.
      const chairs=chairUniform
        ?chairEntries.filter(chairAccepted).map(e=>e.comp)
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
      //
      // Within a source the tie-break used to be raw pixel count -- biggest
      // wins. That is the same failure the modal prior was introduced to kill,
      // surviving here in the ordering: a blob spanning three tables and their
      // chairs has the largest count, so it was seeded first and every cleaner
      // table-sized box that overlapped it was then dropped as a duplicate.
      // Order by agreement with the repeated object size instead, using a
      // provisional modal measured over the furniture-shaped pool before any
      // splitting or de-duplication has happened.
      const provisionalModalArea=modalMagnitude(furnitureish.map(p=>{
        const s=spanOf(p);return s.long*s.short;
      }));
      const dedupFitness=comp=>{
        const o=comp.shape?.obb,a=o?o.w*o.h:comp.w*comp.h;
        return provisionalModalArea?sizeAgreement(Math.sqrt(a),{value:Math.sqrt(provisionalModalArea.value)}):0;
      };
      const sourceRank={tone:3,interior:2,fill:1};
      expanded.sort((a,b)=>(sourceRank[b.comp.source]||0)-(sourceRank[a.comp.source]||0)
        ||dedupFitness(b.comp)-dedupFitness(a.comp)
        ||b.comp.count-a.comp.count);
      // Two boxes describing ONE physical table often overlap only slightly:
      // the tone mask finds the table surface, the barrier mask finds the
      // table plus the chair tucked against it, so the boxes are offset by
      // roughly a chair. Measured on the real plan those pairs sit at IoU~0.13
      // -- far under any IoU threshold that would still keep two genuinely
      // adjacent tables apart. Centre distance separates the two cases
      // cleanly and scale-free: a duplicate is a fraction of a table away,
      // a real neighbour is about one table away.
      const modalSpanForDedup=provisionalModalArea?Math.sqrt(provisionalModalArea.value):null;
      const boxesIntersect=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
      const centreDistance=(a,b)=>Math.hypot((a.x+a.w/2)-(b.x+b.w/2),(a.y+a.h/2)-(b.y+b.h/2));
      const unique=[];
      for(const entry of expanded){
        const dup=unique.some(u=>{
          if(boxIoU(entry.comp,u.comp)>=.45)return true;
          if(!modalSpanForDedup)return false;
          // Same object seen twice: the boxes actually touch AND their centres
          // are much closer than one repeated object apart.
          return boxesIntersect(entry.comp,u.comp)&&centreDistance(entry.comp,u.comp)<modalSpanForDedup*.55;
        });
        if(dup)continue;
        unique.push(entry);
      }
      // ---- is this candidate actually made of table? ------------------------
      // A table drawn with a filled surface is mostly that surface colour. A
      // row of chairs, a wall fragment, a block of printed text and a door
      // swing are not, however table-shaped their bounding box looks. Asking
      // the pixels directly is stronger evidence than any size or aspect rule,
      // and it is the same colour reasoning that fixed the chair source.
      //
      // Only applied when the drawing really does have a surface family to
      // reason from, and never to a candidate that already carries chair
      // evidence -- a table surrounded by its own chairs is a table even if
      // its fill reads faintly.
      //
      // Coverage is asked of EVERY tone family, and the best answer wins.
      //
      // "Is this made of the stuff the plan's MAJORITY tables are made of" is a
      // different question from "is this made of one coherent surface", and on
      // a plan drawing two table finishes only the second is worth asking. This
      // plan draws its banquet tables in pale grey and its bistro tables in a
      // tan with a fine grid texture. Measured, per family, on the three bistro
      // discs (families are luma 229 / 121 / 146 / 201 / 169):
      //
      //   disc (63,217)   0.124  0.022  0.019  [0.254]  0.019
      //   disc (24,219)   0.131  0.016  0.013  [0.284]  0.020
      //   disc (380,704)  0.132  0.000  0.003  [0.274]  0.003
      //   wall panel      0.997  0      0      0        0
      //   merged blob     0.079  0.014  0.039  0.105    0.032
      //
      // Against the majority family alone all five bistro tables fall under the
      // 0.22 floor and are deleted; against their own they clear it. The wall
      // panel and the merged double-table blob are unaffected, because a thing
      // made of no surface is made of no surface however many you offer it.
      //
      // The single-family version of this filter was the last stage still
      // deleting this plan's minority tables. It only became fixable once the
      // tone model stopped capping itself at the three largest families
      // (buildToneModel) — before that there was no tan family to find, which
      // is why an earlier attempt at exactly this change measured as a no-op
      // and was reverted.
      //
      // The seat-evidence exemption the paragraph above describes was also
      // tried, twice, and is NOT what this code does. Exempting any low-cover
      // candidate with a chair against it found all 46 tables and 55 false
      // ones; requiring two chairs and modal size still gave 18 false ones
      // against a baseline of 6. On a banquet floor every gap between a
      // hundred chairs has chairs against it, so seats cannot carry that
      // decision here. The finish can, once it is allowed to be plural.
      let surfaceRejected=0,surfaceMinorityFinishKept=0;
      // What the surface filter turned away. Not made of table is not the same
      // as not an object — see the column pass further down.
      const surfaceRejectedComps=[];
      const uniqueBeforeSurface=globalThis.MERIT_DETECT_DEBUG?unique.map(u=>u.comp):null;
      const surfaceFamilies=(masksTints&&masksTints.length)?masksTints:(surfaceMask?[surfaceMask]:[]);
      if(surfaceFamilies.length){
        // The best SINGLE family, never their union: a table is made of one
        // material, so the question is whether some one family accounts for
        // most of this candidate — not whether the candidate can be covered by
        // borrowing a little from each.
        const coverageIn=(c,mask)=>{
          const x0=Math.max(0,Math.round(c.x)),y0=Math.max(0,Math.round(c.y));
          const x1=Math.min(width,Math.round(c.x+c.w)),y1=Math.min(height,Math.round(c.y+c.h));
          let on=0,tot=0;
          for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){tot++;if(mask[y*width+x])on++;}
          return tot?on/tot:0;
        };
        // A MINORITY finish is weaker evidence than the plan's main one and has
        // to be corroborated.
        //
        // "Not made of the same stuff as this plan's tables" was doing real
        // work, and simply accepting any family threw it away: on the dense
        // fixture the architecture blocks along both edges are a genuine second
        // solid family (luma 142, solidity 0.94), so the plural test read them
        // as tables and cost four false positives.
        //
        // What separates them from the real plan's bistro tables is not the
        // material — both are a coherent minority finish — it is that one has
        // chairs drawn against it and the other does not. Architecture does not
        // acquire seating. So the dominant finish still stands on its own, and
        // a minority finish needs a seat against the candidate as well.
        //
        // This is much narrower than the seat exemption measured and rejected
        // above: that one offered seats to EVERY low-coverage candidate on the
        // plan, where on a banquet floor every gap between a hundred chairs has
        // chairs against it. Here seats only decide candidates that are already
        // made of a coherent, repeated surface which simply is not the majority
        // one.
        // ...and the minority finish may not be the plan's CHAIR material.
        //
        // A candidate made of the stuff this plan draws its chairs with is not
        // thereby a table, however solid and repeated that stuff is. Measured
        // on the grayscale variant, where the orange chairs become a mid-grey
        // tint family of their own (luma 145, solidity 0.59): letting it
        // license tables cost 32 extra table false positives, because on a
        // banquet floor a chair-material blob always has chairs beside it, so
        // the seat corroboration below is satisfied trivially.
        const dominantSurface=surfaceMask;
        const minoritySurfaces=(masksTints||[])
          .filter((m,i)=>m!==dominantSurface&&!tintIsChairMaterial[i]);
        const seatedAgainst=c=>chairs.some(ch=>!sameObject(ch,c)&&gapTo(c,ch)<=Math.max(ch.w,ch.h)*.35);
        const surfaceKept=unique.filter(u=>{
          const dominant=dominantSurface?coverageIn(u.comp,dominantSurface):0;
          let best=dominant,fromMinority=false;
          for(const mask of minoritySurfaces){
            const cov=coverageIn(u.comp,mask);
            if(cov>best){best=cov;fromMinority=true;}
          }
          u.comp.surfaceCoverage=+best.toFixed(3);
          u.comp.surfaceFromMinorityFinish=fromMinority;
          if(best<.22){surfaceRejected++;surfaceRejectedComps.push(u.comp);return false;}
          if(dominant>=.22)return true;
          if(dedupFitness(u.comp)>=.25&&seatedAgainst(u.comp)){surfaceMinorityFinishKept++;return true;}
          surfaceRejected++;surfaceRejectedComps.push(u.comp);return false;
        });
        // Refuse to apply the rule if it would gut the plan: that would mean
        // the surface family is not what this drawing uses for tables, and a
        // filter that removes almost everything is wrong, not strict.
        if(surfaceKept.length>=Math.max(4,unique.length*.2)){unique.length=0;unique.push(...surfaceKept);}
        else surfaceRejected=0;
      }
      // Debug capture for benchmarks/run-benchmark.mjs: what each source
      // actually proposed, before and after de-duplication. Off unless asked.
      let debugPool=null;
      if(globalThis.MERIT_DETECT_DEBUG){
        const box=e=>({s:e.comp.source,x:Math.round(e.comp.x),y:Math.round(e.comp.y),
          w:Math.round(e.comp.w),h:Math.round(e.comp.h),n:e.comp.count,fit:+dedupFitness(e.comp).toFixed(2),
          cov:e.comp.surfaceCoverage??null});
        debugPool={provisionalModalArea:provisionalModalArea?Math.round(provisionalModalArea.value):null,
          expanded:expanded.map(box),unique:unique.map(box),
          preSurface:(uniqueBeforeSurface||[]).map(c=>box({comp:c}))};
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
      const chairArea=chairUniform&&chairFloorSide?chairFloorSide**2:null;
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
      const MAX_TABLES=240,capReached=scored.length>MAX_TABLES,ranked=scored.slice(0,MAX_TABLES);

      // ---- fragment suppression (Gate C/D) --------------------------------
      // Measured on the real venue plan: of 82 proposed tables, 41 were real
      // and 41 were fragments -- mostly pieces the valley-split step cut out
      // of merged linework and printed matter. They separate cleanly from real
      // furniture, but NOT on any single axis:
      //
      //                  real (n=41)          fragments (n=41)
      //   aspect         1.00-1.12            1.18-2.69  (median 1.55)
      //   sizeAgreement  median 0.99          median 0.39
      //   wasSplit       0/41                 28/41
      //   source         tone 41/41           fill 28, tone 13
      //
      // The tempting rule is "aspect > 1.18", which on this plan separates
      // them perfectly. It is also worthless: a banquet hall of 2.4-aspect
      // rectangle tables would lose every real table it has. So nothing here
      // is an absolute threshold. A plan states its own furniture vocabulary
      // -- a modal size (already used for scoring) and a modal aspect -- and
      // each candidate is judged against THAT. On a rectangle-table plan the
      // modal aspect simply becomes 2.4 and rectangles read as normal.
      //
      // A candidate is dropped only when it disagrees with the plan's own
      // vocabulary on THREE independent axes at once. One odd axis is a real
      // object that happens to be unusual; three is a fragment. Measured:
      // removes 35/41 fragments and 0/41 real tables.
      const aspectOf=obb=>Math.max(obb.w,obb.h)/Math.max(1,Math.min(obb.w,obb.h));
      const medianOf=vals=>{const v=[...vals].sort((a,b)=>a-b);return v.length?v[v.length>>1]:null;};
      const modalAspect=medianOf(ranked.map(s=>aspectOf(s.obb)));
      const agreeWith=(v,m)=>m?Math.max(0,1-Math.abs(v-m)/m):1;
      const fragmentEvidence=s=>{
        const reasons=[];
        if(s.c.wasSplit)reasons.push("cut out of a merged blob");
        if(s.agreement<.6)reasons.push(`size disagrees with the plan's modal object (${s.agreement.toFixed(2)})`);
        const aa=agreeWith(aspectOf(s.obb),modalAspect);
        if(aa<.85)reasons.push(`aspect ${aspectOf(s.obb).toFixed(2)} against plan modal ${modalAspect?modalAspect.toFixed(2):"?"}`);
        // Seat adjacency is evidence only where it could be seating.
        //
        // Recovering this plan's minority chair families gave two architectural
        // blobs their first seats and rescued both from this filter: a 45x99
        // wall panel picked up the two bistro chairs standing 11px from it, and
        // a 56x26 plinth picked up one. The comment below this block predicted
        // the opposite — that recovered chairs would rescue the bistro TABLES
        // and leave the seatless fragments alone. Half of that was right. The
        // chairs came back; the bistro tables are still rejected upstream, so
        // their chairs had no table to belong to and attached to the nearest
        // wall instead.
        //
        // So a seat counts only for a candidate that is at least the size of
        // the plan's own furniture — the wall panel's size agreement is 0.00.
        // The rule stays "no seats at all", not "fewer than two": requiring
        // two put a third reason on most of the plan, which tripped this
        // filter's own self-disabling guard and switched it off entirely
        // (table FP 8 -> 42). A filter that fires on everything is not strict,
        // it is broken, and the guard was right to say so.
        const seatsThatCount=s.agreement>=.25?s.seats:0;
        if(seatsThatCount===0)reasons.push("no seat adjacency");
        return reasons;
      };
      const FRAGMENT_MIN_REASONS=3;
      // The share of proposals that must agree with the plan's modal size
      // before this filter's reasons are worth acting on. Measured across the
      // robustness matrix, and the two groups do not overlap:
      //
      //   Golden Plan       0.432      lowres-roundtrip  0.190
      //   crop-pad          0.411      jpeg-q20          0.183
      //   noise             0.538
      //   blur              0.543
      //
      // The bar sits in a 2.2x gap between the worst legible rendering and the
      // best illegible one, which is as much margin as this evidence can offer.
      const VOCABULARY_MIN_AGREEING=.3;
      // A plan can hold more than one furniture family, and all three reasons
      // above are measured against ONE plan-wide modal, so a minority family
      // disagrees on every axis at once by construction -- exactly this
      // filter's deletion condition. benchmarks/fixtures/adversarial-bistro.png
      // isolates that: 18 square tables set the modal, and the 5 bistro tables
      // are proposed and then dropped with precisely these three reasons.
      //
      // "Repetition is counter-evidence" was tried here and MEASURED WRONG.
      // Requiring one extra reason for a repeated whole component fixed the
      // fixture (FN 5 -> 0) and broke the real plan (FP 6 -> 13, F1 0.882 ->
      // 0.820). The 7 fragments it spared are as tight a family as the real
      // bistros are, on every axis available:
      //
      //                    real plan, spared (all FP)   bistro fixture (real)
      //   tight repetition 7 of 7 within 8%             5 of 5 within 8%
      //   dimensions       55x26, 56x26, 54x26          44x38
      //   seats            0                            0
      //   source           tone                         tone
      //   wasSplit         false                        false
      //   sizeAgreement    0.35-0.46                    0.24
      //
      // The only axis that separates them is aspect (2.1 vs 1.16), and this
      // filter already refuses to use aspect as an absolute threshold -- a
      // banquet hall of 2.4-aspect rectangle tables would lose every table it
      // has. So repetition does not distinguish a minority furniture family
      // from a repeating fragment family, and the change was reverted.
      //
      // The axis that DOES separate them is the one already here: seats. The
      // bistros have two chairs each and score zero only because those chairs
      // touch the table and merge into its component, so the chair pass never
      // proposes them. Recovering merged chairs would give the bistros seat
      // adjacency (2 reasons, kept) and leave the real plan's 7 seatless
      // fragments exactly where they are. That is upstream work in the chair
      // pass, not a loosening of this filter.
      const reasonsNeeded=()=>FRAGMENT_MIN_REASONS;
      // A region the operator already confirmed (or drew themselves) is off
      // limits. The filter may disagree with the detector; it may not overrule
      // a human. Regions arrive as percentages of the plan, same units the
      // candidates are reported in.
      // ...but protection covers the OBJECT the human judged, not everything
      // whose centre happens to land in its box.
      //
      // Centre containment alone was the test, and it protected the wrong
      // things. Measured on the Golden Plan: confirm six chairs, Re-Analyze,
      // and four merged double-table blobs — which the fragment filter had
      // correctly deleted on the first pass — sat with their centres inside a
      // confirmed chair's box, were exempted, and survived. Those false tables
      // then absorbed fifteen real chairs as their seats, so fifteen standalone
      // chair candidates the operator had never touched vanished from the plan
      // (unassociated chairs 47 -> 32) and three remembered corrections had
      // nothing left to re-attach to.
      //
      // A blob twice the size of the chair a person confirmed is not that
      // chair. Overlap decides it, at the ordinary 0.5 intersection-over-union
      // that means "the same object" everywhere else in detection: the same
      // object re-detected scores about 0.95, and a merged pair containing it
      // scores about 0.44.
      const PROTECTED_MIN_IOU=.5;
      const isProtected=obb=>{
        const box={x:(obb.cx-obb.w/2)/width*100,y:(obb.cy-obb.h/2)/height*100,
          w:obb.w/width*100,h:obb.h/height*100};
        return protectedRegions.some(r=>{
          const ix=Math.max(0,Math.min(box.x+box.w,r.x+r.w)-Math.max(box.x,r.x));
          const iy=Math.max(0,Math.min(box.y+box.h,r.y+r.h)-Math.max(box.y,r.y));
          const inter=ix*iy;
          if(!inter)return false;
          return inter/(box.w*box.h+r.w*r.h-inter)>=PROTECTED_MIN_IOU;
        });
      };
      const looksFragmentary=s=>fragmentEvidence(s).length>=reasonsNeeded(s);
      // What the filter believes, BEFORE any human protection is considered.
      //
      // The two must be kept apart, and conflating them was a real defect.
      // `flagged` used to exclude protected candidates, and the self-disabling
      // guard below is computed from it — so protecting a region could remove
      // the very candidate whose presence was holding the filter back, switch
      // the filter on, and delete other objects entirely.
      //
      // Measured on the Golden Plan: six chair confirmations, then Re-Analyze.
      // The confirmed candidates became protected, `wouldLoseConfident` flipped
      // from true to false, the fragment filter went from standing down to
      // running, and FIFTEEN standalone chair candidates the operator had never
      // touched disappeared — merging into eight table-sized blobs, with
      // unassociated chairs dropping 47 to 32. Three remembered corrections
      // then had nothing left to re-attach to, which is what took Re-Analyze
      // retention to 0.81.
      //
      // A human decision may only ever SAVE a candidate. So the guard reasons
      // about the plan, and protection is applied to the outcome afterwards.
      const fragmentary=ranked.filter(looksFragmentary);
      const flagged=fragmentary.filter(s=>!isProtected(s.obb));
      const protectedFromFilter=fragmentary.length-flagged.length;
      // Self-disabling guard, same shape as the surface-coverage filter above:
      // if this would delete most of the plan, the plan is unusual rather than
      // its objects, and a filter that removes the furniture is worse than the
      // fragments it removes. Report the decision either way.
      // An A/B switch so before/after can be measured on the same build rather
      // than by reverting code. Benchmarks set it; the product never does.
      // The guard protects CONFIDENT candidates, not a proposal ratio.
      //
      // It used to be `flagged.length <= ranked.length * .45` — switch the
      // whole filter off if it would remove more than 45% of what was
      // proposed. Two measured problems with that. On the Golden Plan itself
      // the filter removes 38 of 88, which is 43.2%: the plan this project is
      // built around sits one percentage point from having its fragment filter
      // silently disabled. And the `crop-pad` variant — the same drawing moved
      // 60px right and 34px down, nothing else — crosses the line, switches the
      // filter off, keeps all 90 proposals and scores 44 table false positives
      // against 4 on the original.
      //
      // A ratio of proposals is the wrong quantity anyway: proposals include
      // known junk, so "how much of the pool would go" says nothing about
      // whether the plan's furniture is at risk. What matters is whether the
      // filter would take something the detector is confident about — and it
      // cannot, by construction, because deletion needs three independent
      // disagreements with the plan's own vocabulary and a candidate that
      // agrees on size and carries seats can collect at most two.
      //
      // So the guard now asks that directly: if any candidate that agrees with
      // the modal size AND has seats would be deleted, the filter's reasoning
      // is not describing this plan and it stands down. Otherwise it runs,
      // however many fragments there turn out to be.
      // Asked of `fragmentary`, not `flagged`: whether the filter's reasoning
      // describes this plan is a property of the plan, and must not change
      // because a person confirmed something.
      const wouldLoseConfident=fragmentary.some(s=>s.agreement>=.6&&s.seats>0);
      // ...and the vocabulary has to actually describe this plan.
      //
      // Every reason this filter deletes on is a disagreement with a
      // plan-derived modal. On a badly degraded rendering the modal describes
      // nothing — objects are fragmented, sizes scatter, and the filter becomes
      // confidently wrong rather than merely unhelpful. Measured on the
      // `lowres-roundtrip` variant with no such check: it deleted 13 real
      // tables, taking true positives from 28 to 15. A missed table costs an
      // operator more than a false one — a false table is one click to reject,
      // a missed table has to be found and drawn by hand — so a filter that is
      // guessing must stand down.
      //
      // "Does the vocabulary describe the plan" is measurable directly: the
      // share of proposals that agree with the modal size. Measured, that share
      // separates the cases cleanly, and it is a statement about evidence
      // rather than about how many things happen to have been proposed.
      const agreeingShare=ranked.length?ranked.filter(s=>s.agreement>=.6).length/ranked.length:0;
      const vocabularyTrusted=agreeingShare>=VOCABULARY_MIN_AGREEING;
      const fragmentFilterActive=!globalThis.MERIT_DISABLE_FRAGMENT_FILTER&&
        ranked.length>=8&&!wouldLoseConfident&&vocabularyTrusted;
      const fragmentDrops=fragmentFilterActive?flagged:[];
      const droppedIds=new Set(fragmentDrops.map(s=>s.box.index));
      const fragmentDiagnostics={
        active:fragmentFilterActive,
        proposed:ranked.length,
        dropped:fragmentDrops.length,
        protectedByHumanDecision:protectedFromFilter,
        flaggedButKept:fragmentFilterActive?0:flagged.length,
        minReasons:FRAGMENT_MIN_REASONS,
        agreeingShare:Number(agreeingShare.toFixed(3)),
        planModalAspect:modalAspect?Number(modalAspect.toFixed(3)):null,
        disabledReason:fragmentFilterActive?null:
          (globalThis.MERIT_DISABLE_FRAGMENT_FILTER?"disabled by benchmark A/B switch":
           ranked.length<8?"too few candidates to trust a plan-derived vocabulary":
           !vocabularyTrusted?`the plan's modal describes only ${Math.round(agreeingShare*100)}% of proposals`:
           "would have deleted a candidate that agrees with the plan and carries seats"),
        examples:fragmentDrops.slice(0,6).map(s=>({aspect:Number(aspectOf(s.obb).toFixed(2)),
          sizeAgreement:Number(s.agreement.toFixed(2)),seats:s.seats,split:!!s.c.wasSplit,
          repetition:s.repetition,reasons:fragmentEvidence(s)})),
      };
      const chosen=ranked.filter(s=>!droppedIds.has(s.box.index));
      const chosenIndexes=new Set(chosen.map(s=>s.box.index));

      // ---- re-seat the chairs whose table did not survive -------------------
      //
      // Association runs over every table PROPOSAL, and the fragment filter
      // then deletes some of those proposals. A chair assigned to a deleted one
      // used to be dropped from seating entirely and re-emitted as a
      // free-standing object, even when a real, surviving table stood a few
      // pixels away.
      //
      // Measured on the Golden Plan once relationship ground truth was extended
      // from 24 chairs to 83: chair->table accuracy 0.711, with **zero** wrong
      // tables and 22 orphans — every failure was a seat the detector found and
      // seated nowhere. Their annotated tables are 2 to 5 pixels away and were
      // all detected. The detector had the answer and threw it out with the
      // losing proposal.
      //
      // So the losers' seats are offered to the survivors, using the same
      // margin-qualified pairs the first pass built. Nothing new is invented: a
      // chair is only re-seated at a table it already qualified for.
      let reseated=0;
      for(let ci=0;ci<chairs.length;ci++){
        const ti=chairAssign.get(ci);
        if(ti!==undefined&&chosenIndexes.has(ti))continue;
        let best=null;
        for(const p of pairs){
          if(p.ci!==ci||!chosenIndexes.has(p.ti))continue;
          if(!best||p.d<best.d)best=p;
        }
        if(!best)continue;
        if(ti!==undefined){
          const previous=chairsByTable.get(ti);
          if(previous){
            const at=previous.indexOf(ci);
            if(at>=0)previous.splice(at,1);
          }
        }
        chairAssign.set(ci,best.ti);
        if(!chairsByTable.has(best.ti))chairsByTable.set(best.ti,[]);
        chairsByTable.get(best.ti).push(ci);
        reseated++;
      }

      const toPercentBox=obb=>({x:(obb.cx-obb.w/2)/width*100,y:(obb.cy-obb.h/2)/height*100,w:obb.w/width*100,h:obb.h/height*100});
      const chairOBB=ch=>ch.shape?.obb||{cx:ch.x+ch.w/2,cy:ch.y+ch.h/2,w:ch.w,h:ch.h,rotation:ch.pcaRotation||0};
      // Deterministic evidence score for a chair: how well it agrees with the
      // plan's own modal chair size, plus whether it came from a real colour
      // cluster or only from the luma fallback. Never a random number.
      const chairEvidence=(ch,associated)=>Math.max(.2,Math.min(.9,
        .34+sizeAgreement(Math.sqrt(ch.w*ch.h),chairModal)*.3+(chairSource==="colour-cluster"?.16:0)+(associated?.05:0)));
      // ---- bistro, which is a semantic type and not a shape -----------------
      //
      // Finding a table and knowing WHAT it is are two different jobs, and the
      // shape classifier can only ever answer round, square or rectangle: it
      // sees one component's pixels and nothing else. Measured before this
      // existed, the real plan found all five of its bistro tables and typed
      // every one of them wrong — detection recall 5/5, type accuracy 0/5.
      //
      // "Small table = bistro" is the tempting rule and it is wrong: a small
      // table is a small table, and on a plan of two-tops it would relabel the
      // entire room. What makes a bistro table a bistro table is how it is USED,
      // and that is visible in evidence the shape classifier does not have —
      // who sits at it, how many, and what it is drawn with.
      //
      // Small is necessary but never sufficient. At least two further facts
      // must agree, each of which comes from a different part of the pipeline,
      // so no single signal can carry the label:
      //
      //   seats far fewer than the plan's modal table    (association)
      //   seated by a minority CHAIR family              (chair families)
      //   drawn in a minority surface finish             (tone families)
      //
      // On the real plan all four hold for all five bistro tables. On a plan
      // whose tables are uniformly small the size test passes for everything
      // and the other three fail together, which is the intended behaviour.
      const BISTRO_MAX_AREA_RATIO=.7,BISTRO_MIN_REASONS=3;
      const seatCountOf=s=>(chairsByTable.get(s.box.index)||[]).length;
      const seatedCounts=chosen.map(seatCountOf).filter(n=>n>0).sort((a,b)=>a-b);
      const modalSeats=seatedCounts.length?seatedCounts[seatedCounts.length>>1]:0;
      const bistroReasons=s=>{
        const area=s.obb.w*s.obb.h;
        if(!modalArea||area>modalArea.value*BISTRO_MAX_AREA_RATIO)return[];
        const reasons=["smaller than this plan's modal table"];
        const seats=chairsByTable.get(s.box.index)||[];
        if(modalSeats&&seats.length&&seats.length<=Math.max(2,modalSeats*.5))
          reasons.push(`seats ${seats.length} against a modal table's ${modalSeats}`);
        if(seats.some(ci=>(chairs[ci]?.source||"").startsWith("family:")))
          reasons.push("seated by a minority chair family");
        if(s.c.surfaceFromMinorityFinish)reasons.push("drawn in a minority surface finish");
        return reasons.length>=BISTRO_MIN_REASONS?reasons:[];
      };
      let bistrosTyped=0;
      const candidates=chosen.map(s=>{
        const seatIndexes=chairsByTable.get(s.box.index)||[];
        const bistro=bistroReasons(s);
        if(bistro.length)bistrosTyped++;
        return{id:uid("candidate"),kind:"table",type:bistro.length?"bistro":s.shape.type,
          typeEvidence:bistro.length?bistro:null,...toPercentBox(s.obb),rotation:s.obb.rotation,
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
      // ---- a table that contains all of its own seats ---------------------
      //
      // Measured across eleven renderings (benchmarks/false-positives/): of 424
      // correctly detected tables, ZERO have every attached seat's centre
      // inside the table's own box. Of the invented ones, 121 do.
      //
      // The reason is physical rather than statistical. Chairs stand AROUND a
      // table, so their centres fall outside its outline; a box whose seats are
      // all inside itself is not a table with seats, it is a seat wrapped in a
      // table. On the renderings where tone separation collapses — `hue-shift`,
      // `bright-up`, `contrast-high`, `blur` — a chair merges with its
      // surroundings into one component and the table pass proposes a box
      // around it. Those four account for 121 of the 176 invented tables of
      // this kind.
      //
      // IT IS NOT DELETED, and that is the whole design. This is one venue, and
      // a drawing that tucks its chairs under the tables would trip the same
      // topology honestly. So the candidate is DESELECTED and flagged
      // low-evidence: it stays on screen, stays reviewable, keeps its seat, and
      // is simply not committed to the floor plan unless a person says so.
      // Abstention, not a verdict.
      let seatsInsideBody=0;
      for(const c of candidates){
        const seats=c.chairDetections||[];
        if(!seats.length)continue;
        // A nested seat carries its CENTRE in x/y; the table carries a
        // top-left corner. Comparing them the other way round would make this
        // fire on almost everything.
        const inside=seats.filter(ch=>ch.x>c.x&&ch.x<c.x+c.w&&ch.y>c.y&&ch.y<c.y+c.h).length;
        if(inside!==seats.length)continue;
        c.selected=false;
        c.lowEvidence={reason:"seatsInsideBody",seats:seats.length};
        seatsInsideBody++;
      }
      // Chairs that belong to no detected table stay first-class objects with
      // their real coordinates instead of being dropped (which is how the old
      // pipeline lost seats). They are never attached to an invented table.
      // Printed glyphs are chair-sized, so on a plan with no colour separation
      // the chair detector reads the letters of a room label as seats. On the
      // dense benchmark fixture that is exactly what happened: 24 phantom
      // chairs, every one of them a letter of "BALLROOM B" / "96 PAX" /
      // "ZONE A" / "ZONE B".
      //
      // The existing OCR-based suppression cannot help here — it requires
      // Tesseract, and the whole point of the offline build is that OCR may be
      // absent. But text does not need to be READ to be recognised as text. A
      // word is a run of similarly-sized marks sitting on a shared baseline
      // with small, regular gaps. Chairs are arranged around a table
      // perimeter, and the ones that are not are still not baseline-aligned
      // with tight even spacing. That structure is the evidence, and it is
      // available with no engine at all.
      //
      // Deliberately conservative: only UNASSOCIATED chairs are eligible (a
      // chair the associator tied to a real table is never touched), the run
      // must be at least 4 long, and the gaps must be tighter than the marks
      // are wide — which is true of letters and false of seats around a table.
      const TEXT_RUN_MIN_TABLE_DISTANCE_WIDTHS=2.0;
      // Edge distance from a mark to the nearest DETECTED table box, in pixels.
      const nearestTableDistance=e=>{
        let best=Infinity;
        for(const s of chosen){
          const t=s.obb;
          const dx=Math.max(0,Math.abs(e.cx-t.cx)-(t.w/2+e.w/2));
          const dy=Math.max(0,Math.abs(e.cy-t.cy)-(t.h/2+e.h/2));
          best=Math.min(best,Math.hypot(dx,dy));
        }
        return best;
      };
      const textRunIndexes=(()=>{
        const eligible=[];
        for(let ci=0;ci<chairs.length;ci++){
          const ti=chairAssign.get(ci);
          if(ti!==undefined&&chosenIndexes.has(ti))continue;   // associated: leave alone
          const obb=chairOBB(chairs[ci]);
          eligible.push({ci,cx:obb.cx,cy:obb.cy,w:obb.w,h:obb.h,bottom:obb.cy+obb.h/2});
        }
        const flagged=new Set();
        if(eligible.length<4)return flagged;
        // group by shared baseline: bottom edges within 25% of glyph height
        const used=new Set();
        for(const seed of eligible){
          if(used.has(seed.ci))continue;
          const tol=Math.max(2,seed.h*.25);
          const line=eligible.filter(e=>!used.has(e.ci)&&Math.abs(e.bottom-seed.bottom)<=tol&&
            Math.abs(e.h-seed.h)<=seed.h*.6).sort((a,b)=>a.cx-b.cx);
          if(line.length<4)continue;
          // horizontal run: consecutive gaps small relative to mark width
          let run=[line[0]];
          const runs=[];
          for(let i=1;i<line.length;i++){
            const prev=run[run.length-1];
            const gap=(line[i].cx-line[i].w/2)-(prev.cx+prev.w/2);
            const maxGap=Math.max(prev.w,line[i].w)*.9;
            if(gap<=maxGap&&gap>=-Math.max(prev.w,line[i].w)*.5)run.push(line[i]);
            else{runs.push(run);run=[line[i]];}
          }
          runs.push(run);
          for(const r of runs){
            if(r.length<4)continue;
            // a real word's marks are packed: median gap under half the mark
            // width. Seats spaced around a table are not.
            const gaps=[];
            for(let i=1;i<r.length;i++)gaps.push((r[i].cx-r[i].w/2)-(r[i-1].cx+r[i-1].w/2));
            gaps.sort((a,b)=>a-b);
            const medGap=gaps[gaps.length>>1],medW=r.map(e=>e.w).sort((a,b)=>a-b)[r.length>>1];
            // Letters differ in width -- I against M -- while chairs are one
            // object repeated, so their widths barely vary. This is what
            // separates a word from a row of seats, and it is measured on the
            // run itself rather than assumed.
            // A seat serves a table. That is the domain fact this rests on,
            // and it separates the two cases where pixel statistics do not:
            // measured, printed glyphs sit 3-9 mark-widths from the nearest
            // detected table while real unassociated seats sit under 1.5 away,
            // because they are the seats of a table right there.
            //
            // (Shape variation was the first hypothesis -- letters differ in
            // width, seats do not -- and the measurement rejected it: glyph
            // runs came back at cv 0.08 against 0.03 for seats, far too close
            // to separate on. It is left out rather than tuned into place.)
            const runGap=r.reduce((worst,e)=>Math.min(worst,nearestTableDistance(e)),Infinity);
            const runGapInWidths=runGap/Math.max(1,medW);
            if(globalThis.MERIT_TEXTRUN_PROBE)globalThis.MERIT_TEXTRUN_PROBE.push({len:r.length,medW,medGap,runGap,runGapInWidths});
            if(medGap<=medW*.5&&runGapInWidths>=TEXT_RUN_MIN_TABLE_DISTANCE_WIDTHS){
              for(const e of r){flagged.add(e.ci);used.add(e.ci);}}
          }
        }
        return flagged;
      })();
      const chairVenues=[];
      let textGlyphChairsDropped=0;
      for(let ci=0;ci<chairs.length;ci++){
        const ti=chairAssign.get(ci);
        if(ti!==undefined&&chosenIndexes.has(ti))continue;
        if(textRunIndexes.has(ci)){textGlyphChairsDropped++;continue;}
        const ch=chairs[ci],obb=chairOBB(ch);
        chairVenues.push({id:uid("candidate"),kind:"venue",type:"chair",...toPercentBox(obb),rotation:obb.rotation,
          confidence:chairEvidence(ch,false),status:"unreviewed",selected:false,chairDetections:[],
          evidence:{geometry:Number(Math.min(.95,ch.fill).toFixed(2)),chairs:1,repetition:chairs.length,
            source:chairSource,unassociated:true}});
      }
      // ---- venue-scale objects (stage band / long bar / column) ------------
      // ---- columns and structural repeats -----------------------------------
      // A candidate the surface filter turned away is not a table: it is not
      // made of the material this plan draws tables with. That is a real and
      // useful verdict, and until now it ended the object's life. On a plan
      // that has columns, those are precisely the objects — solid, repeated,
      // compact, standing on a structural grid, and never seated at.
      //
      // Measured on benchmarks/fixtures/adversarial-architecture.png, whose six
      // columns are exact by construction: all six reach de-duplication, all
      // six score 0.000 surface coverage against the table tint, and all six
      // were then discarded. The fixture scored column recall 0.000 while
      // scoring 10 of 10 tables perfectly.
      //
      // A column is not "a small rectangle". Four independent facts have to
      // agree, and no single one of them is allowed to carry the decision:
      //
      //   the family repeats     3 or more members at one size
      //   it is compact          not a wall, not a line of text
      //   nobody sits at it      no chair anywhere near it
      //   it stands on a GRID    members share a row AND a column with other
      //                          members — which is what a structural grid is
      //
      // The last one has to be both axes, and that was measured the hard way:
      // "shares a row or a column" is satisfied by a line of text by
      // construction, and it put 26 false columns on the text fixture and 13 on
      // the dense one. A word is aligned in one direction. A column grid is
      // aligned in two, because the building's structure repeats across the
      // floor as well as along it.
      //
      // Together these are why this does not invent columns on the real venue
      // plan — whose annotation deliberately records that none are
      // identifiable there.
      const COLUMN_MIN_MEMBERS=3,COLUMN_MAX_ASPECT=1.6,COLUMN_ALIGN_SHARE=.5;
      const columnComps=(()=>{
        // "Nobody sits at it" has to mean nobody sits at it — not "no seat
        // happens to pass nearby". A column standing in a room full of tables
        // is surrounded by other people's chairs, and on the architecture
        // fixture exactly that killed C5: a seat belonging to a round table two
        // feet away came within 28px, and a column that six other facts agreed
        // about was thrown out for it. A chair the associator already seated at
        // a table that survived to `chosen` is spoken for, and its proximity
        // says nothing about this object. Only unclaimed seats count.
        const chosenTableIndexes=new Set(chosen.map(s=>s.box.index));
        const seatedAtRealTable=ci=>chosenTableIndexes.has(chairAssign.get(ci));
        const seatless=surfaceRejectedComps.filter(c=>{
          const aspect=Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h));
          if(aspect>COLUMN_MAX_ASPECT)return false;
          const reach=Math.max(c.w,c.h)*.7;
          return !chairs.some((ch,ci)=>!seatedAtRealTable(ci)&&gapTo(c,ch)<=reach);
        });
        if(seatless.length<COLUMN_MIN_MEMBERS)return[];
        // "One size" as a RELATION between members, not as a grid laid over the
        // number line.
        //
        // The chair pass keys families by round(log(size)/log(1.18)), and that
        // key has a boundary problem this fixture shows exactly: its four
        // square columns measure 42 across and its two round ones 40 — a 5%
        // difference, well inside the 18% the key is meant to tolerate — but 40
        // and 42 fall either side of a bin edge. The six columns of one
        // structural grid were split into a family of four and a family of two,
        // and the pair died on the member floor. Recall 4/6 with precision
        // 1.000 was a bin edge, not a detector limit.
        //
        // Same tolerance, expressed as "no member is more than 18% larger than
        // the next smaller one": sort by size and cut wherever that gap opens.
        // There is no boundary to sit on, because the comparison is always
        // between two real objects.
        const COLUMN_SIZE_RATIO=1.18;
        const sized=seatless.map(c=>({c,s:Math.sqrt(c.w*c.h)})).sort((a,b)=>a.s-b.s);
        const groups=[];
        let run=[];
        for(const it of sized){
          if(run.length&&it.s>run[run.length-1].s*COLUMN_SIZE_RATIO){groups.push(run.map(x=>x.c));run=[];}
          run.push(it);
        }
        if(run.length)groups.push(run.map(x=>x.c));
        const out=[];
        for(const members of groups){
          if(members.length<COLUMN_MIN_MEMBERS)continue;
          const tol=Math.max(4,members.reduce((n,c)=>n+Math.max(c.w,c.h),0)/members.length*.25);
          const centre=c=>[c.x+c.w/2,c.y+c.h/2];
          // Coordinate REUSE on both axes, measured over the family. Asking
          // each member to share both a row and a column with someone is the
          // same idea but breaks as soon as the grid is only partly detected:
          // with four of this fixture's six columns found, only one member has
          // both a row-partner and a column-partner and the family scored zero.
          const sharesOn=(get)=>members.filter(c=>{
            const v=get(centre(c));
            return members.some(o=>o!==c&&Math.abs(v-get(centre(o)))<=tol);
          }).length/members.length;
          const rowShare=sharesOn(p=>p[1]),columnShare=sharesOn(p=>p[0]);
          if(rowShare>=COLUMN_ALIGN_SHARE&&columnShare>=COLUMN_ALIGN_SHARE)out.push(...members);
        }
        return out;
      })();
      const venueComps=[];
      for(const s of sources)for(const c of s.all)if(venueSizeOk(c)&&!venueComps.some(o=>boxIoU(o,c)>=.5))venueComps.push(c);
      // A venue-scale blob that geometrically CONTAINS several detected tables
      // is not a stage -- it is the merged blob those tables were cut out of.
      // Measured on the dense fixture: three 511x102 "stages" at aspect 5.0,
      // each of which was exactly one row of six tables plus their seats. This
      // needs no threshold: either real table centres sit inside the box or
      // they do not.
      const tableCentres=chosen.map(s=>({cx:s.obb.cx,cy:s.obb.cy}));
      const containedTables=c=>tableCentres.filter(t=>
        t.cx>=c.x&&t.cx<=c.x+c.w&&t.cy>=c.y&&t.cy<=c.y+c.h).length;
      const mergedRowVenues=venueComps.filter(c=>containedTables(c)>=2);
      const venueCompsKept=venueComps.filter(c=>containedTables(c)<2);
      const columnVenues=columnComps.slice(0,40).map(c=>{
        const obb=c.shape?.obb||{cx:c.x+c.w/2,cy:c.y+c.h/2,w:c.w,h:c.h,rotation:c.pcaRotation||0};
        return{id:uid("candidate"),kind:"venue",type:"column",...toPercentBox(obb),
          rotation:obb.rotation,confidence:.55,status:"unreviewed",selected:false,chairDetections:[],
          evidence:{geometry:.6,chairs:0,repetition:columnComps.length,source:c.source||"structural",
            basis:"repeated compact object, aligned on a structural grid, no seating"}};
      });
      const venues=venueCompsKept.slice(0,14).map(c=>{
        analyze([c],sources.find(s=>s.all.includes(c)).labels);
        const obb=c.shape?.obb||{cx:c.x+c.w/2,cy:c.y+c.h/2,w:c.w,h:c.h,rotation:c.pcaRotation||0};
        return{id:uid("candidate"),kind:"venue",type:c.aspect>3?"stage":"column",...toPercentBox(obb),
          rotation:obb.rotation,confidence:.52,status:"unreviewed",selected:false,chairDetections:[],
          evidence:{geometry:.62,chairs:0,repetition:0,source:c.source||"fill"}};
      }).concat(columnVenues).concat(chairVenues);

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
          tableModalSeats:modalSeats||null,bistrosTyped,chairsReseated:reseated,seatsInsideBody,
          mergesSplit:splitCount,splitModalLong:modalLong?Math.round(modalLong.value):null,splitModalShort:modalShort?Math.round(modalShort.value):null,candidateCapReached:capReached,offModalDropped,surfaceRejected,surfaceMinorityFinishKept,secondaryChairFamilies:secondaryFamilyDiagnostics,fragmentSuppression:fragmentDiagnostics,
          textGlyphChairsDropped,mergedRowVenuesDropped:mergedRowVenues.length,columnsDetected:columnComps.length,debugPool,
          sources:diagnosticsSources,chairSourceBreakdown,phaseMs,
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
  // ---- VisualEmbeddingProvider (Gate G) --------------------------------
  //
  // The boundary a real learned embedding model would plug into, so that
  // swapping one in is a provider registration rather than a rewrite of the
  // similarity clustering.
  //
  // Exactly one provider is installed today and it is NOT a model. It is a
  // hand-crafted descriptor: fill ratio, edge density, an 8-bin intensity
  // histogram and a quadrant fill signature, computed from the decoded plan
  // pixels. Calling that an embedding would be false, so `kind` says
  // "handcrafted-descriptor", `trainedModel` is false, and `dimensions` is the
  // real vector length rather than a model's hidden size. Nothing in the UI
  // may describe this as a learned or trained representation.
  //
  // See benchmarks/embedding/README.md for the license matrix and for the
  // measured baseline any candidate model has to beat before it is worth
  // shipping tens of megabytes of weights into an offline package.
  const VisualEmbeddingProviders={
    handcrafted:{
      id:"handcrafted-descriptor-v1",
      kind:"handcrafted-descriptor",
      trainedModel:false,
      label:"Geometric + intensity descriptor computed from plan pixels. Not a trained model, not an embedding.",
      dimensions:14, // fillRatio + edgeDensity + 8 histogram bins + 4 quadrants
      offline:true,
      licence:"n/a — computed in-product, no third-party weights",
      embed(gray,binary,width,height,candidate){
        return computeVisualDescriptor(gray,binary,width,height,candidate);
      },
      // Flat vector form, so a consumer can compare providers without knowing
      // the shape of any one of them.
      toVector(d){
        if(!d)return null;
        return [d.fillRatio,d.edgeDensity,...(d.intensityHist||[]),...(d.quadrantFill||[])];
      },
    },
  };
  function resolveVisualEmbeddingProvider(){
    // The learned encoder is the default WHEN IT IS INSTALLED, and only
    // because it was measured to be better on every retrieval number and
    // worse on none — see src/plan-embedding.js and
    // benchmarks/embedding/retrieval.json. If its weights are absent (a build
    // that did not run scripts/build-encoder-module.mjs) the app degrades to
    // the handcrafted descriptor rather than failing, and says which one ran
    // in the detection diagnostics either way.
    const id=globalThis.MERIT_VISUAL_EMBEDDING_PROVIDER
      ||(VisualEmbeddingProviders.learned?"learned":"handcrafted");
    return VisualEmbeddingProviders[id]||VisualEmbeddingProviders.handcrafted;
  }
  globalThis.MeritVisualEmbedding={
    providers:VisualEmbeddingProviders,
    resolve:resolveVisualEmbeddingProvider,
    // Registration seam for a future real model. Kept deliberately explicit:
    // a provider must declare whether it is a trained model, because the
    // honesty rules downstream key off that flag rather than off its name.
    register(id,provider){
      if(!provider||typeof provider.embed!=="function")throw new Error("A visual embedding provider needs an embed() function.");
      if(typeof provider.trainedModel!=="boolean")throw new Error("A visual embedding provider must declare trainedModel explicitly.");
      VisualEmbeddingProviders[id]=provider;
    },
  };
  // src/plan-embedding.js loads before this file, so it cannot register itself
  // against a registry that does not exist yet. It exposes the registration and
  // this calls it, which also means an installation without the weights simply
  // never registers and the handcrafted descriptor stays the resolved provider.
  if(typeof globalThis.MeritRegisterPlanEncoder==="function")globalThis.MeritRegisterPlanEncoder();
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
  // ---- training-data capture (Gates E-G) ----------------------------------
  //
  // rememberCorrection above keeps a plan tidy: it records the answer so the
  // same object comes back the same way after Re-Analyze. It does not keep
  // the question. Nothing in it says what the detector had predicted, which
  // build predicted it, which plan and which layout version the object came
  // from, or what the operator was actually looking at.
  //
  // captureTrainingExample keeps all of that, with the real crop, in
  // state.trainingData. It is a data foundation and nothing else: it never
  // changes a detection, never trains anything, and never sets trainedModel.
  // See src/training-data.js for the record shape and the decision types.
  //
  // Failures are reported, not swallowed. A correction that was applied but
  // not captured is a real gap in the dataset, and an operator who is told
  // "saved" while nothing was stored would build on sand.
  let planImageCache={src:null,image:null};
  let planHashCache={src:null,hash:null};
  let captureFailureReported=false;
  async function planHashFor(src){
    if(planHashCache.src!==src)planHashCache={src,hash:await MeritTrainingData.planFingerprint(src)};
    return planHashCache.hash;
  }
  async function planImageFor(src){
    if(planImageCache.src!==src){
      if(planImageCache.image?.close)planImageCache.image.close();
      planImageCache={src,image:await MeritTrainingData.imageFromDataUrl(src)};
    }
    return planImageCache.image;
  }
  function classOf(c){return c?{kind:c.kind,type:c.type,confidence:c.confidence,source:c.evidence?.geometry??null,candidateId:c.id}:null;}
  function truthOf(c){return c?{kind:c.kind,type:c.type,seats:c.seats??null,seatsConfidence:c.seatsConfidence??null}:null;}
  async function captureTrainingExample(event,c,{decisionType,predictionBefore=null,note=null}={}){
    if(!globalThis.MeritTrainingData||!event?.background?.src||!c)return null;
    try{
      const src=event.background.src;
      const [planHash,image]=await Promise.all([planHashFor(src),planImageFor(src)]);
      if(!planHash)return null;
      const geometry={x:c.x,y:c.y,w:c.w,h:c.h,rotation:c.rotation||0};
      const shot=await MeritTrainingData.cropFromImage(image,geometry);
      const blobId=uid("crop");
      await storageProvider.putBlob(blobId,shot.dataUrl);
      const wantsTruth=decisionType==="confirmation"||decisionType==="correction"||decisionType==="missedObject";
      const record=MeritTrainingData.buildRecord({
        decisionType,
        plan:{planHash,name:event.background.name||null,width:image.width,height:image.height},
        context:{eventId:event.id,venueId:event.venueRef?.venueId??null,
          layoutId:event.venueRef?.layoutId??null,layoutVersionId:event.venueRef?.layoutVersionId??null},
        geometry,
        predictionBefore,
        humanTruth:wantsTruth?truthOf(c):null,
        providers:{
          detection:event.analysis?.diagnostics?.provider
            ?{id:event.analysis.diagnostics.provider,engine:event.analysis.engine,trainedModel:false}:null,
          embedding:(()=>{const p=MeritVisualEmbedding?.resolve?.();
            return p?{id:p.id,kind:p.kind,trainedModel:p.trainedModel,dimensions:p.dimensions}:null;})(),
        },
        descriptor:c.descriptor??null,
        crop:{blobId,size:shot.size,sourceRect:shot.sourceRect,objectRect:shot.objectRect,padding:shot.padding},
        note,
      });
      state.trainingData ||= [];
      state.trainingData.push(record);
      saveState();
      return record;
    }catch(error){
      if(!captureFailureReported){
        captureFailureReported=true;
        toast(`The correction was applied, but capturing it as a training example failed: ${error.message}`,"error",7000);
      }
      console.error("Training-data capture failed.",error);
      return null;
    }
  }
  function memoryDistance(c,m){const g=m.geometry;return Math.hypot(c.x-g.x,c.y-g.y,(c.w-g.w)*.5,(c.h-g.h)*.5);}
  // General old-candidate -> new-candidate geometry remap, used to carry
  // grouping decisions (which reference every member of a furniture group,
  // not just ones a human individually confirmed/reclassified) across a
  // Re-Analyze pass. Same deterministic-geometry reasoning as plan memory.
  function matchCandidatesByGeometry(oldCandidates,freshCandidates){
    const pairs=[];
    for(const o of oldCandidates)for(const c of freshCandidates)pairs.push({o,c,dist:Math.hypot(c.x-o.x,c.y-o.y,(c.w-o.w)*.5,(c.h-o.h)*.5)});
    pairs.sort((a,b)=>a.dist-b.dist);
    const usedO=new Set(),usedC=new Set(),remap=new Map();
    for(const{o,c,dist}of pairs){
      // Same size-relative rule as plan memory, and for the same reason: a
      // grouping decision carried onto a neighbouring chair is as wrong as a
      // correction carried onto one.
      if(dist>memoryTolerance(o)||usedO.has(o.id)||usedC.has(c.id))continue;
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
  // How far a remembered object is allowed to have moved, RELATIVE TO ITS OWN
  // SIZE rather than to the plan.
  //
  // A flat 3-percent-of-plan tolerance is the same distance for a banquet
  // table and for a chair, and on this plan's concert seating adjacent chairs
  // stand about 2.6 percent apart — inside it. Measured: after 21 corrections
  // and a Re-Analyze, three chair corrections came back on a NEIGHBOURING
  // chair, because greedy nearest-first pairing over 39 memories can displace
  // a match when several candidates are all within tolerance of each other.
  // Retention 0.857 against a 0.98 gate, and the operator sees a confirmed,
  // remembered decision sitting on the wrong seat.
  //
  // A big table can shift three percent of the plan and still obviously be
  // that table. A chair cannot: three percent is more than a chair away. So
  // the tolerance is a fraction of the object's own short side, floored so a
  // tiny object still has some slack and capped at the old value so nothing
  // matches more loosely than it used to.
  const MEMORY_TOLERANCE_OF_SIZE=.75,MEMORY_MIN_TOLERANCE=.5,MEMORY_MAX_TOLERANCE=3;
  function memoryTolerance(g){
    return Math.max(MEMORY_MIN_TOLERANCE,
      Math.min(MEMORY_MAX_TOLERANCE,Math.min(g.w,g.h)*MEMORY_TOLERANCE_OF_SIZE));
  }
  function applyPlanMemory(freshCandidates,memory){
    const idRemap=new Map();
    if(!memory?.length)return{reappliedCount:0,restored:[],idRemap,conflicts:[]};
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
    // Where the operator and the detector actually disagree. Re-applying a
    // correction silently makes the plan look right while hiding the fact that
    // the detector proposed the same wrong answer again -- which is exactly the
    // signal that says this class of object is not being read correctly. It is
    // recorded here, at the only place that can see both answers, and reported
    // as a MEMORY contradiction rather than being smoothed over.
    const conflicts=[];
    for(const{m,c,dist}of pairs){
      if(dist>memoryTolerance(m.geometry)||usedC.has(c.id)||usedM.has(m.id))continue;
      if(c.kind!==m.kind||c.type!==m.type)
        conflicts.push({kind:"overruled",candidateId:c.id,
          detector:{kind:c.kind,type:c.type},operator:{kind:m.kind,type:m.type}});
      c.kind=m.kind;c.type=m.type;c.status=m.status;c.selected=m.status!=="rejected";c.fromMemory=true;
      usedC.add(c.id);usedM.add(m.id);idRemap.set(m.sourceCandidateId,c.id);reappliedCount++;
    }
    const restored=[];
    for(const m of memory){
      // A confirmed object the detector did NOT find again this run. Not
      // fabricated back into existence, but not silent either: a human said
      // this is real and detection now disagrees.
      if(!usedM.has(m.id)&&!m.manual&&m.status==="confirmed")
        conflicts.push({kind:"lost",memoryId:m.id,object:{kind:m.kind,type:m.type},geometry:m.geometry});
      if(usedM.has(m.id)||!m.manual)continue; // a non-manual correction whose object wasn't re-detected this time is left alone -- we never fabricate a detection that didn't happen.
      const g=m.geometry,id=uid("candidate");
      restored.push({id,kind:m.kind,type:m.type,x:g.x,y:g.y,w:g.w,h:g.h,rotation:g.rotation,confidence:1,status:m.status,selected:m.status!=="rejected",missed:true,fromMemory:true,chairDetections:[],evidence:{geometry:"manual-memory",chairs:0,repetition:0}});
      idRemap.set(m.sourceCandidateId,id);
    }
    return{reappliedCount,restored,idRemap,conflicts};
  }
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
    state.operatorSessions ||= [];
    let s=state.operatorSessions.find(x=>x.analysisId===analysisId);
    if(!s){
      s={id:uid("session"),analysisId,eventId:event.id,startedAt:nowISO(),
        startedAtMs:Date.now(),actions:[],
        // The order the product proposed at the moment the session opened, so
        // "did they follow it" is measured against what they were actually
        // shown rather than against a queue recomputed after their edits.
        suggestedOrder:(event.analysis.planIntelligence?.reviewPriorities||[])
          .map(p=>({key:p.key,targetIds:p.targetIds||[]}))};
      state.operatorSessions.push(s);
      if(state.operatorSessions.length>OPERATOR_SESSION_MAX)
        state.operatorSessions=state.operatorSessions.slice(-OPERATOR_SESSION_MAX);
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
    const s=(state.operatorSessions||[]).find(x=>x.analysisId===analysisId);
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
  globalThis.MeritOperatorSessions={summary:operatorSessionSummary,
    all:()=>(state.operatorSessions||[]).map(s=>operatorSessionSummary(s.analysisId))};

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
  globalThis.MeritOperatorReport=()=>{const e=activeEvent();return e?operatorReport(e):null;};
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

  // ---- the visual second opinion -------------------------------------------
  //
  // The learned encoder answers "does this crop look like the things we know
  // are real on this plan?" — a question the classical pipeline never asks,
  // because every stage of it reasons about geometry, size families and
  // adjacency instead of appearance.
  //
  // IT NEVER DELETES A CANDIDATE. That is measured, not cautious:
  // benchmarks/embedding/measure-separation.mjs simulated six suppression
  // rules against ground truth on the renderings where the detector invents
  // most, and every rule that removed a meaningful number of false tables also
  // removed real ones on at least one rendering. On `jpeg-q20` the channel
  // inverts outright — real tables score BELOW invented ones — so a rule tuned
  // on the others deletes real furniture there. A missed table costs an
  // operator more than an extra one they can reject in a click, so detector
  // fusion did not earn promotion and is not wired. The opinion is recorded as
  // evidence for the review queue and the contradiction engine to weigh.
  //
  // REFERENCES ARE TIERED and the tier travels with every answer, because
  // where the references came from is the whole question (§13). A plan on
  // which nobody has decided anything yet can only compare against the
  // detector's own better-corroborated guesses, and it says exactly that
  // rather than presenting the result as verified knowledge.
  const VISUAL_REF_MIN_AGREEMENT=.6,VISUAL_REF_MIN_CONFIDENCE=.6;
  function visualClassOf(c){return c.kind==="table"?"table":`${c.kind}:${c.type||"other"}`;}
  function buildVisualReferences(candidates,memoryByCandidate,seatVectors){
    const refs=[],qualifiedTables=new Set();
    for(const c of candidates){
      const vector=c.visualDescriptor?.vector;
      if(!vector||c.status==="rejected")continue;
      const m=memoryByCandidate.get(c.id);
      let tier=null;
      if(m){
        if(m.status==="rejected")continue; // a human said this is not an object; it is not a reference for anything
        tier=(m.status==="confirmed"||m.manual)?"verified":"memory";
      }else{
        // The detector's own guess, admitted only when a DIFFERENT stage of
        // the pipeline corroborates it: seats found by the chair pass, or a
        // repeated size family. A candidate whose only support is the same
        // reasoning we are about to second-guess is not a reference.
        const corroborated=c.kind==="table"
          ?(c.chairDetections?.length||0)>0&&(c.evidence?.sizeAgreement||0)>=VISUAL_REF_MIN_AGREEMENT
          :(c.confidence||0)>=VISUAL_REF_MIN_CONFIDENCE;
        if(corroborated)tier="provisional";
      }
      if(!tier)continue;
      refs.push({id:c.id,tier,vector,cls:visualClassOf(c)});
      if(c.kind==="table")qualifiedTables.add(c.id);
    }
    // A seat is a reference only if the table it was attached to is one. A
    // ring of marks around an invented table teaches nothing about chairs.
    for(const[chairId,rec]of seatVectors||[]){
      if(!qualifiedTables.has(rec.tableId))continue;
      refs.push({id:chairId,tier:"provisional",vector:rec.vector,cls:"venue:chair"});
    }
    return refs;
  }
  function applyVisualSecondOpinion(candidates,memoryByCandidate,seatVectors){
    const api=globalThis.MeritVisualSecondOpinion;
    if(!api?.build)return{available:false,reason:"visual second opinion module not loaded"};
    const refs=buildVisualReferences(candidates,memoryByCandidate,seatVectors);
    const library=api.build(refs);
    if(!library.referenceCount)
      return{available:false,reason:`no class reached ${api.minReferencesPerClass} trusted references`,
        referencesConsidered:refs.length};
    const answers=library.assessMany(candidates.map(c=>({
      id:c.id,vector:c.visualDescriptor?.vector||null,cvClass:visualClassOf(c)})));
    const agreement={agree:0,disagree:0},strength={strong:0,moderate:0,weak:0,unknown:0};
    let assessed=0;
    answers.forEach((a,i)=>{
      if(!a){delete candidates[i].visualEvidence;return;}
      candidates[i].visualEvidence=a;assessed++;
      agreement[a.agreement]=(agreement[a.agreement]||0)+1;
      strength[a.strength]=(strength[a.strength]||0)+1;
    });
    return{available:true,references:library.referenceCount,classes:library.classes,
      tiers:library.tiers,bestTier:library.bestTier,assessed,agreement,strength,
      // Recorded so nothing downstream can quietly start treating this as a
      // filter. Suppression was measured and refused.
      role:"evidence-only",suppresses:false};
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
    const event=activeEvent();if(!canMutate(event,"run plan analysis")||!event.background?.src)return toast("Import a floor plan first.","error");ui.analysisBusy=true;ui.analysisProgress=3;ui.analysisStage=t("analysis.stage.reading");ui.screen="review";
    // Import -> Confirm timing for the operator test. Local only, and carried
    // on objects that already survive the event migration: the background for
    // the import moment, the analysis for everything after it. A `planTimings`
    // field on the event itself was silently dropped by migrateEvent, which is
    // exactly the kind of thing a test that reads the value catches and a test
    // that reads the code does not.
    const analysisStartedAtMs=Date.now();
    render();await yieldFrame();
    try{
      const blob=await sourceBlob(event.background.src),bitmap=await createImageBitmap(blob),max=1920,ratio=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*ratio)),height=Math.max(1,Math.round(bitmap.height*ratio)),canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(bitmap,0,0,width,height);bitmap.close();
      ui.analysisStage=t("analysis.stage.understanding");ui.analysisProgress=22;render();await yieldFrame();
      // Deskew before anything measures a component. See estimatePlanSkew.
      //
      // Only when the evidence is real: the best angle has to beat square-on by
      // a margin, not merely tie with it. Measured, that gain is 2.03 and 2.20
      // on the two genuinely rotated variants and exactly 1.0000 on the six
      // straight renderings, so the deadband is not a close call.
      const skew=estimatePlanSkew(canvas,width,height);
      const deskewDeg=(skew.measured&&Math.abs(skew.deg)>=SKEW_MIN_DEG&&skew.gain>=SKEW_MIN_GAIN)?skew.deg:0;
      let dw=width,dh=height,dctx=ctx;
      if(deskewDeg){
        const rad=-deskewDeg*Math.PI/180,cos=Math.abs(Math.cos(rad)),sin=Math.abs(Math.sin(rad));
        dw=Math.max(1,Math.round(width*cos+height*sin));
        dh=Math.max(1,Math.round(width*sin+height*cos));
        const dcanvas=document.createElement("canvas");dcanvas.width=dw;dcanvas.height=dh;
        dctx=dcanvas.getContext("2d",{willReadFrequently:true});
        // Paper, not black, behind the rotated corners: a black wedge would read
        // as a giant dark object and change every tone family on the plan.
        dctx.fillStyle="#ffffff";dctx.fillRect(0,0,dw,dh);
        dctx.translate(dw/2,dh/2);dctx.rotate(rad);dctx.drawImage(canvas,-width/2,-height/2);
        dctx.setTransform(1,0,0,1,0,0);
      }
      const pixels=dctx.getImageData(0,0,dw,dh);
      // Everything the detector returns is in DESKEWED percent, and everything
      // the product stores and draws is in PLAN percent. These two are the only
      // bridge between them, and both are identities when no deskew happened.
      //
      // A candidate's w/h are its oriented box's own dimensions, not an
      // axis-aligned extent, so rotating the frame does not change them — only
      // the centre moves and the angle shifts by the correction that was
      // applied. That is why this mapping is four lines rather than a general
      // polygon transform.
      const skewRad=deskewDeg*Math.PI/180;
      const planFromDeskewPoint=(px,py)=>{
        if(!deskewDeg)return[px,py];
        const ox=px-dw/2,oy=py-dh/2,cos=Math.cos(skewRad),sin=Math.sin(skewRad);
        return[ox*cos-oy*sin+width/2,ox*sin+oy*cos+height/2];
      };
      const deskewFromPlanPoint=(px,py)=>{
        if(!deskewDeg)return[px,py];
        const ox=px-width/2,oy=py-height/2,cos=Math.cos(-skewRad),sin=Math.sin(-skewRad);
        return[ox*cos-oy*sin+dw/2,ox*sin+oy*cos+dh/2];
      };
      const planFromDeskew=o=>{
        if(!o)return o;
        if(deskewDeg){
          const[cx,cy]=planFromDeskewPoint((o.x+o.w/2)/100*dw,(o.y+o.h/2)/100*dh);
          const ow=o.w/100*dw,oh=o.h/100*dh;
          o.w=ow/width*100;o.h=oh/height*100;
          o.x=cx/width*100-o.w/2;o.y=cy/height*100-o.h/2;
          o.rotation=((o.rotation||0)+deskewDeg)%360;
        }
        for(const ch of o.chairDetections||[])planFromDeskewChair(ch);
        return o;
      };
      // A nested seat carries its CENTRE in x/y, not a top-left corner.
      const planFromDeskewChair=ch=>{
        if(!deskewDeg)return ch;
        const[cx,cy]=planFromDeskewPoint(ch.x/100*dw,ch.y/100*dh);
        const cw=ch.w/100*dw,chh=ch.h/100*dh;
        ch.x=cx/width*100;ch.y=cy/height*100;
        ch.w=cw/width*100;ch.h=chh/height*100;
        ch.rotation=((ch.rotation||0)+deskewDeg)%360;
        return ch;
      };
      // Human-confirmed regions travel the other way: they were stored in plan
      // percent and the detector needs them where it is looking.
      const deskewToPlan=list=>!deskewDeg?list:list.map(r=>{
        const[cx,cy]=deskewFromPlanPoint((r.x+r.w/2)/100*width,(r.y+r.h/2)/100*height);
        const w=r.w/100*width/dw*100,h=r.h/100*height/dh*100;
        return{x:cx/dw*100-w/2,y:cy/dh*100-h/2,w,h};
      });
      // The application layer talks to a PlanDetectionProvider, never to pixel
      // code or a vendor SDK directly (merit-plan-intelligence, "Provider
      // abstraction"). Today exactly one provider is installed and it is
      // classical computer vision: trainedModel stays false and the UI keeps
      // saying DOMAIN MODEL NOT INSTALLED.
      const provider=resolvePlanDetectionProvider();
      const detectionStartedAt=performance.now();
      // Regions the operator has already ruled on. An automatic filter is
      // allowed to disagree with the detector; it is never allowed to overrule
      // a human. Without this, fragment suppression runs before plan memory is
      // re-applied, so a table the operator explicitly confirmed could be
      // deleted before memory ever got the chance to restore it. It happened
      // to survive in testing only because an unrelated chair candidate
      // remained at that position for memory to match against -- an accident,
      // not a guarantee.
      const protectedRegions=(event.planMemory||[])
        .filter(m=>m.status==="confirmed"||m.manual)
        .map(m=>({x:m.geometry.x,y:m.geometry.y,w:m.geometry.w,h:m.geometry.h}));
      const detection=await provider.detect(pixels,dw,dh,{protectedRegions:deskewToPlan(protectedRegions),onStage:async(key,progress)=>{
        ui.analysisStage=t("analysis.stage."+key);ui.analysisProgress=progress;render();await yieldFrame();
      }});
      const detectionMs=Math.round(performance.now()-detectionStartedAt);
      const candidates=detection.candidates,venues=detection.venues,threshold=detection.threshold;
      ui.analysisStage=t("analysis.stage.seating");ui.analysisProgress=73;render();await yieldFrame();
      // Through the provider boundary rather than the function directly. That
      // seam was built for a future learned model and is now carrying one:
      // when src/plan-encoder-weights.js is present this resolves to the
      // trained encoder concatenated with the descriptor, and to the
      // descriptor alone when it is not. Which one ran is reported in the
      // detection diagnostics, never assumed.
      //
      // Embedding reads the deskewed pixel buffers, so it happens while the
      // geometry is still in deskewed space; the mapping back to plan space is
      // the next statement.
      const embedder=resolveVisualEmbeddingProvider();
      const embeddingStartedAt=performance.now();
      for(const c of candidates)c.visualDescriptor=embedder.embed(detection.gray,detection.binary,dw,dh,c);
      for(const c of venues)c.visualDescriptor=embedder.embed(detection.gray,detection.binary,dw,dh,c);
      // Seats the associator attached to a table are the best-corroborated
      // chairs on the plan, and they are what lets the second opinion say
      // "that looks more like a chair than a table" instead of only "that
      // matches nothing well". Measured: on six of the seven degraded
      // renderings a false table sits closer to a real chair than to a real
      // table (benchmarks/embedding/separation.json).
      //
      // Their vectors are kept OFF the stored objects and thrown away with
      // this pass. Persisting ~113 extra 128-float arrays per analysis would
      // cost real storage for something recomputed on every run. A nested seat
      // carries its CENTRE in x/y, so the box is converted before cropping.
      const seatVectors=new Map();
      for(const c of candidates)for(const ch of c.chairDetections||[]){
        const v=embedder.embed(detection.gray,detection.binary,dw,dh,
          {x:ch.x-ch.w/2,y:ch.y-ch.h/2,w:ch.w,h:ch.h});
        if(v?.vector)seatVectors.set(ch.id,{vector:v.vector,tableId:c.id});
      }
      const embeddingMs=Math.round(performance.now()-embeddingStartedAt);
      for(const c of [...candidates,...venues])planFromDeskew(c);
      const previous=event.analysis?.candidates||[],signatures=list=>list.map(c=>`${c.kind}:${c.type}:${Math.round(c.x)}:${Math.round(c.y)}`),oldSig=new Set(signatures(previous)),newSig=new Set(signatures([...candidates,...venues]));
      const freshCandidates=[...candidates,...venues];
      const priorCandidates=event.analysis?.candidates||[],priorDecisions=event.analysis?.groupingDecisions||[];
      const memoryResult=applyPlanMemory(freshCandidates,event.planMemory||[]);
      const allCandidates=[...freshCandidates,...memoryResult.restored];
      // Which candidate carries which human decision, so the reference tiering
      // below can tell a confirmed object from the detector's own guess. Run
      // AFTER plan memory, so a reclassified candidate is referenced under the
      // class the operator gave it rather than the one the detector guessed.
      const memoryByCandidate=new Map();
      for(const m of event.planMemory||[]){
        const cid=memoryResult.idRemap.get(m.sourceCandidateId);
        if(cid)memoryByCandidate.set(cid,m);
      }
      const secondOpinionStartedAt=performance.now();
      const secondOpinion=applyVisualSecondOpinion(allCandidates,memoryByCandidate,seatVectors);
      secondOpinion.ms=Math.round(performance.now()-secondOpinionStartedAt);
      // Grouping decisions are keyed by candidate id, which is regenerated on
      // every analysis pass -- remap them through the same geometry match so
      // a "these are separate tables" answer survives Re-Analyze instead of
      // silently reverting to the detector's default grouping.
      const geometryRemap=matchCandidatesByGeometry(priorCandidates,allCandidates);
      const carriedDecisions=priorDecisions.map(d=>({...d,memberIds:d.memberIds.map(id=>geometryRemap.get(id)).filter(Boolean)})).filter(d=>d.memberIds.length>=2);
      event.analysis={id:uid("analysis"),engine:"ASSISTED_DETECTION",trainedModel:false,notice:"Classical computer vision is active; no trained Merit model is installed in this browser review.",createdAt:nowISO(),imageWidth:width,imageHeight:height,originalWidth:Math.round(width/ratio),originalHeight:Math.round(height/ratio),threshold,candidates:allCandidates,missed:allCandidates.filter(c=>c.missed).map(c=>c.id),groupingDecisions:carriedDecisions,memoryReapplied:memoryResult.reappliedCount,memoryRestored:memoryResult.restored.length,memoryConflicts:memoryResult.conflicts,comparison:{added:[...newSig].filter(x=>!oldSig.has(x)).length,removed:[...oldSig].filter(x=>!newSig.has(x)).length,changed:0},diagnostics:{...detection.diagnostics,resolution:`${width}×${height}`,detectionMs,provider:provider.id,providerLabel:provider.label,
        // Which visual representation actually produced the descriptors, and
        // whether it involved trained weights. Reported from the resolved
        // provider rather than from a constant, so an install without the
        // encoder says so instead of claiming one ran.
        embedding:{id:embedder.id,kind:embedder.kind||"handcrafted-descriptor",trainedModel:!!embedder.trainedModel,
          dimensions:embedder.dimensions||null,embeddingMs,
          cache:globalThis.MeritPlanEncoder?.cacheStats?.()||null,
          secondOpinion}}};
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
      ui.analysisStage=t("analysis.stage.review");ui.analysisProgress=100;ui.analysisBusy=false;
      event.analysis.timings={importedAtMs:event.background?.importedAtMs??null,analysisStartedAtMs,analysisCompletedAtMs:Date.now()};ui.selectedCandidateId=event.analysis.candidates[0]?.id||null;ui.difficultQuestionIndex=0;ui.activeReviewGroupId=null;ui.activeQuestionId=null;audit(event,"ASSISTED_DETECTION_COMPLETED",event.analysis.diagnostics);touchEvent(event);render();
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
  // Seating furniture whose capacity cannot be read off the drawing. A round
  // table with eight chairs drawn round it states its own capacity; a
  // banquette running along a wall does not, and the number of covers a venue
  // sets on it is an operational decision, not a geometric fact.
  //
  // So these carry seats:null / seatsConfidence:"unverified" and contribute
  // NOTHING to capacity until a human enters a number. That is deliberately
  // different from contributing zero: zero is a claim, and an unverified
  // banquette is an admitted unknown that the capacity auditor surfaces rather
  // than quietly absorbs.
  const UNVERIFIED_SEATING=new Set(["sofa","bench","banquette"]);
  const RECLASSIFY_TAXONOMY=[
    {kind:"table",type:"round"},{kind:"table",type:"square"},{kind:"table",type:"rectangle"},{kind:"table",type:"bistro"},
    {kind:"venue",type:"chair"},{kind:"venue",type:"armchair"},
    // Sofa, bench and banquette are first-class types rather than one blurred
    // "sofa/bench" label, because they seat different numbers of people and a
    // venue counts them separately. None of the three ever gets a guessed seat
    // count -- see UNVERIFIED_SEATING below.
    {kind:"venue",type:"sofa"},{kind:"venue",type:"bench"},{kind:"venue",type:"banquette"},
    {kind:"venue",type:"stage"},{kind:"venue",type:"bar"},{kind:"venue",type:"entrance"},{kind:"venue",type:"exit"},
    {kind:"venue",type:"column"},{kind:"venue",type:"text"},{kind:"venue",type:"other"},
  ];
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
  function reviewPoiCardHTML(c){
    if(!c)return"";
    const opt=o=>`<option value="${o.kind}:${o.type}" ${c.kind===o.kind&&c.type===o.type?"selected":""}>${t("teach.type."+o.type)}</option>`;
    return`<aside class="poi-card"><div class="poi-card-head"><strong>${t("teach.type."+c.type)}</strong><span>${c.kind==="table"?`${(c.chairDetections||[]).length} ${t("poi.seats")} · `:""}${t(c.status==="confirmed"?"poi.confirmed":c.status==="rejected"?"poi.rejected":"poi.unreviewed")}</span></div>${c.fromMemory?`<div class="poi-memory-note">${icon("check")}${t("poi.fromMemory")}</div>`:""}${c.lowEvidence?`<div class="poi-lowevidence"><strong>${t("poi.lowEvidence")}</strong><span>${esc(t("poi.lowEvidence."+c.lowEvidence.reason))}</span></div>`:""}${visualEvidenceHTML(c)}<select class="field-select" data-candidate-edit="kindtype"><optgroup label="${t("taxonomy.tables")}">${RECLASSIFY_TAXONOMY.filter(o=>o.kind==="table").map(opt).join("")}</optgroup><optgroup label="${t("taxonomy.objects")}">${RECLASSIFY_TAXONOMY.filter(o=>o.kind==="venue").map(opt).join("")}</optgroup></select>${UNVERIFIED_SEATING.has(c.type)?`<div class="poi-seat-row"><label for="poiSeatCount">${t("poi.seatsOnThis")}</label><input id="poiSeatCount" class="field-input" type="number" min="0" max="99" inputmode="numeric" placeholder="${t("poi.seatsUnset")}" value="${c.seats==null?"":c.seats}" data-candidate-edit="seatCount"><p class="poi-seat-note">${c.seats==null?t("poi.seatsUnverifiedNote"):t("poi.seatsVerifiedNote",{n:c.seats})}</p></div>`:""}<div class="poi-card-actions"><button class="btn sm primary" data-review-action="confirm">${t("action.correct")}</button><button class="btn sm" data-review-action="reject">${t("action.notAnObject")}</button><button class="btn sm" data-review-action="dismiss" title="${t("action.notImportantTitle")}">${t("action.notImportant")}</button></div></aside>`;
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
  function reviewCenterPanelHTML(event){
    const pi=event.analysis.planIntelligence,decisions=event.analysis.groupingDecisions||[];
    return`<aside class="review-center-panel"><div class="review-center-head"><strong>${t("review.center")}</strong>${(ui.correctionUndo||[]).length?`<button class="btn sm quiet" data-review-decision-action="undo-correction" title="${t("review.undoCorrectionTitle")}">${icon("undo")} ${t("review.undoCorrection",{n:(ui.correctionUndo||[]).length})}</button>`:""}${decisions.length?`<button class="btn sm quiet" data-review-decision-action="undo-last" title="${t("diag.undoLastDecisionTitle")}">${icon("undo")} ${t("diag.undoLastDecision",{n:decisions.length})}</button>`:""}<button class="btn icon-only sm" data-review-action="close-review-center">${icon("x")}</button></div><div class="review-center-list">${explainPlanHTML(event)}${pi.reviewGroups.map(g=>`<div class="review-group-card"><div class="review-group-title">${esc(reviewGroupTitle(g))}</div>${memberCropsHTML(event,g.memberIds)}<div class="review-group-meta">${g.totalInFamily} ${t("review.similar")} · ${g.consistentCount} ${t("review.consistentOf")} · ${g.memberIds.length} ${t("review.needReview")}</div><div class="review-group-actions"><button class="btn sm primary" data-reviewgroup-action="confirm-family" data-group="${g.id}">${t("action.applyToAll")}</button><button class="btn sm" data-reviewgroup-action="inspect" data-group="${g.id}">${t("action.reviewOutliers")}</button></div></div>`).join("")||`<div class="inspector-empty">${t("review.noGroups")}</div>`}</div>${pi.uncertainQuestions.length?`<div class="review-center-difficult"><strong>${t("review.difficultQuestions")}</strong>${pi.uncertainQuestions.map(q=>`<div class="difficult-q-row"><span>${esc(questionText(q))}</span><button class="btn sm" data-question-action="open" data-question="${q.id}">${t("action.answer")}</button></div>`).join("")}</div>`:""}</aside>`;
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
  function questionText(q){
    if(q.questionType==="combinedDiningGroup"){
      const memberCount=q.questionParams?.memberCount??"?",count=q.coversGroups||1;
      // A question standing for several identical arrangements says so, rather
      // than looking like a question about one of them.
      return count>1
        ?t("question.combinedDiningGroupRepeated",{memberCount,count})
        :t("question.combinedDiningGroup",{memberCount});
    }
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
    return`<section class="planintel-screen"><header class="planintel-top"><button class="btn" data-review-action="back">${icon("arrow")}${t("nav.floorPlan")}</button><div class="planintel-title"><h2>${a?t("plan.understood"):(ui.analysisBusy?esc(ui.analysisStage):t("plan.noAnalysisYet"))}</h2>${a?`<p>${a.ocr&&!a.ocr.available?esc(t("ocr.unavailable",{reason:a.ocr.reason||"no network"})):a.notice}</p>`:`<p>${esc(ui.analysisStage)}</p>`}</div><span class="toolbar-spacer"></span>${a?`<details class="planintel-diagnostics"><summary>${t("diag.advancedDiagnostics")}</summary><div class="diag-pop">${detectionDiagnosticsHTML(a)}<div class="field"><label>${t("diag.status")}</label><select data-review-filter="status"><option value="all">${t("diag.all")}</option>${["unreviewed","confirmed","rejected"].map(v=>`<option value="${v}" ${ui.reviewFilter===v?"selected":""}>${statusLabel(v)}</option>`).join("")}</select></div><div class="field full"><label>${t("diag.minConfidence",{pct:Math.round(ui.reviewConfidence*100)})}</label><input data-review-filter="confidence" type="range" min="0" max=".95" step=".05" value="${ui.reviewConfidence}"></div><button class="btn sm" data-review-action="draw">${ui.reviewDrawMode?t("action.cancelDrawing"):t("action.aiMissed")}</button><button class="btn sm" data-review-action="save-verified">${t("action.saveVerifiedPlan")}</button><button class="btn sm" data-review-action="improve">${t("action.improveAI")}</button><button class="btn sm" data-review-action="export-dataset" title="${t("action.exportDatasetTitle")}">${t("action.exportDataset")}</button><button class="btn sm" data-review-action="session-report">${t("op.report")}</button></div></details><button class="btn" data-review-action="reanalyze">${t("action.reanalyze")}</button>`:""}<button class="btn sm" data-review-action="toggle-lang">${ui.lang==="tr"?"TR":"EN"}</button></header>${pi?`<div class="planintel-map ${ui.reviewDrawMode?"draw-mode":""}" id="analysisScene"><div class="planintel-map-inner" id="analysisSceneInner"><img src="${event.background.src}" alt="Floor plan analysis source">${candidates.map(c=>candidateBox(c,selected?.id===c.id,target?.ids||null)).join("")}${boundaryBox?`<div class="review-group-boundary" style="left:${Math.max(0,boundaryBox.x-2.5)}%;top:${Math.max(0,boundaryBox.y-2.5)}%;width:${boundaryBox.w+5}%;height:${boundaryBox.h+5}%"></div>`:""}${pins.map(p=>p.kind==="group"?`<button class="review-pin group" data-review-action="focus-group" data-group="${p.groupId}" style="left:${p.x}%;top:${p.y}%" title="Review group ${p.label}">${p.label}</button>`:`<button class="review-pin question" data-question-action="open" data-question="${p.questionId}" style="left:${p.x}%;top:${p.y}%" title="Difficult question">${p.label}</button>`).join("")}</div></div>${ui.operatorReportOpen?`<aside class="op-report-panel"><div class="op-report-head"><strong>${t("op.reportTitle")}</strong><button class="btn icon-only sm" data-review-action="close-session-report">${icon("x")}</button></div><div class="op-report-body">${operatorReportHTML(event)}</div></aside>`:""}${selected&&!ui.reviewDrawMode?reviewPoiCardHTML(selected):""}${difficultQuestionCardHTML(event)}${planIntelBottomPillHTML(event)}${ui.reviewCenterOpen?reviewCenterPanelHTML(event):""}`:`<div class="v8-empty" style="margin:40px"><h2>${ui.analysisBusy?t("plan.analyzingLocally"):t("plan.noAnalysisYet")}</h2><p>${esc(ui.analysisStage)}</p></div>`}</section>`;
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
  // Exactly which candidates a spread will reach, computed with the same rules
  // the spread itself uses. Shared so the undo snapshot and the mutation can
  // never disagree about the affected set.
  function familyCandidateIds(event,corrected,wasKind,wasType){
    const pi=event.analysis?.planIntelligence;if(!pi)return[];
    const group=(pi.similarityGroups||[]).find(g=>(g.memberIds||[]).includes(corrected.id))
      ||(pi.reviewGroups||[]).find(g=>(g.memberIds||[]).includes(corrected.id));
    if(!group)return[];
    return group.memberIds.filter(id=>{
      if(id===corrected.id)return false;
      const other=event.analysis.candidates.find(x=>x.id===id);
      return !!other&&other.status==="unreviewed"&&other.kind===wasKind&&other.type===wasType;
    });
  }
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
      // Captured, but marked as propagated. A person looked at one object and
      // this repaired forty; recording forty human decisions would overstate
      // the evidence by a factor of forty, and an evaluation that counted them
      // as independent labels would be measuring its own guess.
      captureTrainingExample(event,other,{decisionType:"correction",
        predictionBefore:{kind:wasKind,type:wasType,confidence:other.confidence,source:other.evidence?.geometry??null,candidateId:other.id},
        note:`propagated from ${corrected.id}; not individually reviewed by a person`});
      n++;
    }
    return n;
  }
  // A reclassification lives entirely in event.analysis.candidates and
  // event.planMemory. The canvas undo stack snapshots {tables, venueObjects,
  // background}, so it cannot reach any of it -- which meant one dropdown
  // change that repaired a whole family of objects was, until now,
  // irreversible. The more objects the spread correctly fixed, the more
  // damage an accidental wrong pick did.
  //
  // Session-only, deliberately on ui rather than the event: like ui.liveRecent
  // it is a property of this working session and must never reach the stored
  // schema.
  function recordCorrectionUndo(event,affectedIds,label){
    ui.correctionUndo ||= [];
    const before=affectedIds.map(id=>{
      const c=event.analysis.candidates.find(x=>x.id===id);
      return c?{id,kind:c.kind,type:c.type,status:c.status,selected:c.selected,
        chairDetections:clone(c.chairDetections||[])}:null;
    }).filter(Boolean);
    const memoryBefore=(event.planMemory||[]).map(m=>m.id);
    ui.correctionUndo.push({before,memoryBefore,label,at:nowISO()});
    if(ui.correctionUndo.length>30)ui.correctionUndo.shift();
  }
  function undoLastCorrection(){
    const event=activeEvent();
    if(!canMutate(event,"undo a plan correction"))return 0;
    const entry=(ui.correctionUndo||[]).pop();
    if(!entry)return 0;
    let restored=0;
    for(const snap of entry.before){
      const c=event.analysis?.candidates.find(x=>x.id===snap.id);
      if(!c)continue;
      c.kind=snap.kind;c.type=snap.type;c.status=snap.status;c.selected=snap.selected;
      c.chairDetections=snap.chairDetections;
      restored++;
    }
    // Corrections write plan memory, so undoing one has to withdraw the memory
    // entries it added -- otherwise the reverted classification would come
    // straight back on the next Re-Analyze.
    const keep=new Set(entry.memoryBefore);
    if(event.planMemory)event.planMemory=event.planMemory.filter(m=>keep.has(m.id));
    recomputePlanIntelligence(event);
    touchEvent(event);
    return restored;
  }
  // Called one frame after the change event, never inside it. A <select> or
  // <input> change fires during blur, and re-rendering the whole app
  // synchronously inside that handler removes the node the browser is still
  // working with -- which throws "The node to be removed is no longer a child
  // of this node. Perhaps it was moved in a 'blur' event handler?" and leaves
  // the review screen half-drawn. Deferring one frame lets blur finish first.
  function updateCandidateField(field,value){
    const event=activeEvent(),c=event.analysis?.candidates.find(x=>x.id===ui.selectedCandidateId);if(!c)return;
    if(field==="seatCount"){
      // Blank means "still unknown", which is a different state from zero and
      // must round-trip as such. Only a number the operator actually typed
      // makes this furniture count toward capacity.
      const raw=String(value).trim();
      if(raw===""){c.seats=null;c.seatsConfidence="unverified";}
      else{c.seats=Math.max(0,Math.min(99,Number(raw)||0));c.seatsConfidence="verified";}
      recomputePlanIntelligence(event);
    }
    else if(field==="rotation")c.rotation=Number(value)||0;
    else if(field==="chairs"){const count=Math.max(0,Math.min(99,Number(value)||0));c.chairDetections=Array.from({length:count},(_,i)=>c.chairDetections?.[i]||{id:uid("candidate-chair"),x:c.x+c.w/2,y:c.y+c.h/2,w:.7,h:.7,rotation:0,confidence:.3});}
    else if(field==="kindtype"){
      const [kind,type]=value.split(":"),crossedKind=kind!==c.kind;
      const wasKind=c.kind,wasType=c.type;
      // Snapshot the corrected object AND every object the spread is about to
      // reach, before anything changes, so undo restores the whole action as
      // one unit rather than leaving the family half-corrected.
      recordCorrectionUndo(event,[c.id,...familyCandidateIds(event,c,wasKind,wasType)],"reclassify");
      c.kind=kind;c.type=type;
      if(crossedKind&&kind!=="table")c.chairDetections=[]; // a chair/armchair/sofa/stage/etc. candidate carries no nested seat detections of its own.
      if(UNVERIFIED_SEATING.has(type)){
        // Reclassifying INTO seating furniture never invents a capacity. It
        // starts as an admitted unknown; the operator supplies the number.
        c.seats=null;c.seatsConfidence="unverified";
      }else{delete c.seats;delete c.seatsConfidence;}
      c.status="confirmed";c.selected=true;
      rememberCorrection(event,c);
      captureTrainingExample(event,c,{decisionType:crossedKind||wasType!==type?"correction":"confirmation",
        predictionBefore:{kind:wasKind,type:wasType,confidence:c.confidence,source:c.evidence?.geometry??null,candidateId:c.id}});
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
    const event=activeEvent(),chosen=event.analysis?.candidates.filter(c=>c.selected&&c.status!=="rejected")||[];if(!chosen.length)return toast("Select at least one detection to confirm.","error");recordUndo(event);let tables=0,venues=0;for(const c of chosen){if(c.committedId)continue;const x=c.x/100*WORLD.width,y=c.y/100*WORLD.height,w=Math.max(55,c.w/100*WORLD.width),h=Math.max(45,c.h/100*WORLD.height);if(c.kind==="table"){const table=syncTableChairs({id:uid("table"),number:uniqueNumber(event,"T",1),type:["round","square","rectangle","bistro"].includes(c.type)?c.type:"rectangle",x,y,w,h,capacity:Math.max(1,c.chairDetections?.length||1),zone:"MAIN FLOOR",rotation:c.rotation||0,locked:false,z:10,hasPhysicalSeats:true});if(c.chairDetections?.length){table.chairs=c.chairDetections.map((ch,index)=>({id:uid("chair"),parentTableId:table.id,seatNumber:index+1,x:Math.max(0,Math.min(100,(ch.x-c.x)/c.w*100)),y:Math.max(0,Math.min(100,(ch.y-c.y)/c.h*100)),rotation:ch.rotation||0,occupancy:null}));table.capacity=table.chairs.length;}event.tables.push(table);c.committedId=table.id;tables++;}else{const object={id:uid("venue"),type:c.type||"text",label:String(c.type||"OBJECT").toUpperCase(),x,y,w,h,rotation:c.rotation||0,locked:false,z:4};
      // Seating furniture keeps its capacity state on the committed object, so
      // "we do not know how many this banquette seats" survives leaving the
      // review screen instead of silently becoming zero on the floor plan.
      if(UNVERIFIED_SEATING.has(object.type)){object.seats=c.seats??null;object.seatsConfidence=c.seats==null?"unverified":"verified";}
      event.venueObjects.push(object);c.committedId=object.id;venues++;}c.status="confirmed";}if(event.analysis.timings)event.analysis.timings.confirmedAtMs=Date.now();recordOperatorAction(event,"confirm-plan",chosen.map(c=>c.id));touchEvent(event);ui.screen="workspace";ui.tab="floor";render();toast(`${tables} table${tables===1?"":"s"}, ${venues} venue object${venues===1?"":"s"} confirmed. Chair coordinates were preserved.`,"success",6000);
  }
  function bindReviewDrawing(){const scene=document.getElementById("analysisScene");if(!scene||!ui.reviewDrawMode)return;scene.onpointerdown=e=>{if(e.target!==scene&&e.target.tagName!=="IMG")return;e.preventDefault();const r=scene.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top,box=document.createElement("div");box.className="candidate-box selected";scene.appendChild(box);const move=ev=>{const x=ev.clientX-r.left,y=ev.clientY-r.top;Object.assign(box.style,{left:Math.min(sx,x)+"px",top:Math.min(sy,y)+"px",width:Math.abs(x-sx)+"px",height:Math.abs(y-sy)+"px"});};const up=ev=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);const x=Math.min(sx,ev.clientX-r.left)/r.width*100,y=Math.min(sy,ev.clientY-r.top)/r.height*100,w=Math.abs(ev.clientX-r.left-sx)/r.width*100,h=Math.abs(ev.clientY-r.top-sy)/r.height*100;if(w>1&&h>1){const event=activeEvent();const c={id:uid("candidate"),kind:"table",type:"rectangle",x,y,w,h,rotation:0,confidence:1,status:"unreviewed",selected:true,missed:true,chairDetections:[],evidence:{geometry:"manual",chairs:0,repetition:0}};event.analysis.candidates.push(c);event.analysis.missed.push(c.id);rememberCorrection(event,c,{manual:true});captureTrainingExample(event,c,{decisionType:"missedObject",note:"drawn by the operator on a region the detector never proposed"});ui.selectedCandidateId=c.id;ui.reviewDrawMode=false;touchEvent(event);}render();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);};}
  // ---- dataset export (Gates H-J) ----------------------------------------
  //
  // One portable file containing every captured decision, its image crop, and
  // a leakage-safe train/val/test split computed by plan rather than by
  // example. The split is included so that whoever picks this up cannot
  // accidentally shuffle crops at random: forty chairs from one drawing on
  // both sides of the line produce a model that has memorised a venue and a
  // number that says it generalises.
  //
  // The file states what it is. `trainedModel` is false throughout, the
  // readiness line says plainly whether this is a training set or a capture
  // log, and nothing here trains, evaluates or promotes anything.
  const DATASET_FORMAT = "merit-training-dataset";
  const DATASET_FORMAT_VERSION = 1;
  async function buildTrainingDatasetExport({includeCrops=true}={}){
    const records=state.trainingData||[];
    const split=MeritTrainingData.splitByPlan(records);
    const splitOf=new Map();
    for(const name of ["train","val","test"])for(const r of split[name])splitOf.set(r.id,name);
    const examples=[];
    let cropsMissing=0;
    for(const record of records){
      const entry={...record,split:splitOf.get(record.id)||null};
      if(includeCrops&&record.crop?.blobId){
        const dataUrl=await storageProvider.getBlob(record.crop.blobId).catch(()=>null);
        // A missing crop is reported, never quietly replaced with a blank one:
        // a dataset that silently substitutes empty images trains on nothing
        // and reports success.
        if(dataUrl)entry.crop={...record.crop,dataUrl};
        else{entry.crop={...record.crop,dataUrl:null,missing:true};cropsMissing++;}
      }
      examples.push(entry);
    }
    return {
      format:DATASET_FORMAT,
      formatVersion:DATASET_FORMAT_VERSION,
      exportedAt:nowISO(),
      schemaVersion:MeritTrainingData.SCHEMA_VERSION,
      crop:{size:MeritTrainingData.CROP_SIZE,padding:MeritTrainingData.CROP_PADDING,encoding:"image/png",
        note:"Square crop centred on the object, padded by a fraction of its own span so context is kept. sourceRect gives the exact source pixels."},
      trainedModel:false,
      producedBy:"MERIT EVENT MAKER Assisted Detection (classical computer vision) plus human decisions. No model was trained to produce this file.",
      summary:MeritTrainingData.summarise(records),
      split:{
        method:"grouped by plan content hash; every crop from one plan lands in one split",
        rationale:"Splitting individual crops at random puts objects from the same drawing on both sides and turns a memorised venue into a high score.",
        counts:{train:split.train.length,val:split.val.length,test:split.test.length},
        plans:split.plansPerSplit,
        warning:split.warning,
      },
      cropsMissing,
      examples,
    };
  }
  async function exportTrainingDataset(){
    const records=state.trainingData||[];
    if(!records.length)return toast(t("teach.exportEmpty"),"error",5200);
    try{
      const payload=await buildTrainingDatasetExport();
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download=`merit-training-dataset-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),2000);
      const s=payload.summary;
      toast(t("teach.exportDone",{n:s.total,plans:s.distinctPlans}),"success",7000);
      if(payload.cropsMissing)toast(t("teach.exportMissingCrops",{n:payload.cropsMissing}),"error",7000);
    }catch(error){
      toast(`Dataset export failed: ${error.message}`,"error",7000);
    }
  }
  globalThis.MERIT_TRAINING_EXPORT=buildTrainingDatasetExport;

  function saveVerified(){const event=activeEvent();if(!ui.teachAI)return toast("Enable Teach AI with corrections first.","error");const a=event.analysis;if(!a)return;state.verifiedExamples.push({id:uid("verified"),eventId:event.id,savedAt:nowISO(),engine:a.engine,trainedModel:false,threshold:a.threshold,imageSize:[a.imageWidth,a.imageHeight],predictions:a.candidates.map(clone),groundTruth:a.candidates.filter(c=>c.status!=="rejected").map(clone),rejected:a.candidates.filter(c=>c.status==="rejected").map(c=>c.id),missed:[...a.missed],hardExample:a.missed.length>0||a.candidates.some(c=>c.status==="rejected")});saveState();toast("Verified plan saved locally with predictions, corrections, rejections and missed detections.","success",6000);}
  function improveAI(){if(!state.verifiedExamples.length)return toast("Save at least one verified plan first.","error");const samples=state.verifiedExamples.flatMap(v=>v.groundTruth||[]),avg=samples.length?samples.reduce((n,c)=>n+(c.confidence||0),0)/samples.length:0;state.calibration={version:(state.calibration?.version||0)+1,updatedAt:nowISO(),examples:state.verifiedExamples.length,objects:samples.length,recommendedConfidence:Number(Math.max(.35,Math.min(.8,avg*.85)).toFixed(2)),trainedModel:false,label:"Local assisted-detection calibration; not a trained neural model"};saveState();toast(`Local calibration v${state.calibration.version} completed from ${state.verifiedExamples.length} verified plan(s). No trained model claim is made.`,"success",6500);}
  function bindReview(){
    document.querySelectorAll("[data-review-action]").forEach(b=>b.onclick=()=>{const action=b.dataset.reviewAction,event=activeEvent(),c=event.analysis?.candidates.find(x=>x.id===ui.selectedCandidateId);if(action==="back"){ui.screen="workspace";ui.tab="floor";ui.activeReviewGroupId=null;ui.activeQuestionId=null;ui.selectedCandidateId=null;render();}else if(action==="reanalyze")runAssistedDetection();else if(action==="commit")commitCandidates();else if(action==="confirm"&&c){const was=classOf(c);c.status="confirmed";c.selected=true;rememberCorrection(event,c);captureTrainingExample(event,c,{decisionType:"confirmation",predictionBefore:was});recordOperatorAction(event,"confirm",c.id);recomputePlanIntelligence(event);touchEvent(event);render();}else if(action==="reject"&&c){const was=classOf(c);c.status="rejected";c.selected=false;rememberCorrection(event,c);captureTrainingExample(event,c,{decisionType:"falsePositive",predictionBefore:was});recordOperatorAction(event,"reject",c.id);recomputePlanIntelligence(event);touchEvent(event);render();}else if(action==="dismiss"&&c){const was=classOf(c);captureTrainingExample(event,c,{decisionType:"negative",predictionBefore:was,note:"operator dismissed this region as not important"});recordOperatorAction(event,"dismiss",c.id);event.analysis.candidates=event.analysis.candidates.filter(x=>x.id!==c.id);ui.selectedCandidateId=null;recomputePlanIntelligence(event);touchEvent(event);render();}else if(action==="draw"){if(!ui.reviewDrawMode)recordOperatorAction(event,"ai-missed-open",[]);ui.reviewDrawMode=!ui.reviewDrawMode;ui.activeReviewGroupId=null;ui.activeQuestionId=null;render();}else if(action==="save-verified")saveVerified();else if(action==="improve")improveAI();else if(action==="export-dataset")exportTrainingDataset();else if(action==="session-report"){ui.operatorReportOpen=true;render();}else if(action==="close-session-report"){ui.operatorReportOpen=false;render();}else if(action==="open-review-center"){ui.reviewCenterOpen=true;render();}else if(action==="close-review-center"){ui.reviewCenterOpen=false;render();}else if(action==="focus-group"){ui.activeReviewGroupId=b.dataset.group;ui.selectedCandidateId=null;ui.activeQuestionId=null;ui.reviewCenterOpen=true;render();}else if(action==="toggle-lang"){ui.lang=ui.lang==="tr"?"en":"tr";render();}});
    document.querySelectorAll("[data-candidate],[data-candidate-box]").forEach(node=>node.onclick=e=>{if(e.target.matches("input"))return;ui.selectedCandidateId=node.dataset.candidate||node.dataset.candidateBox;ui.activeReviewGroupId=null;ui.activeQuestionId=null;render();});document.querySelectorAll("[data-candidate-select]").forEach(input=>input.onchange=()=>{const c=activeEvent().analysis.candidates.find(x=>x.id===input.dataset.candidateSelect);c.selected=input.checked;touchEvent(activeEvent());});document.querySelectorAll("[data-candidate-edit]").forEach(input=>input.onchange=()=>{const f=input.dataset.candidateEdit,v=input.value;requestAnimationFrame(()=>updateCandidateField(f,v));});document.querySelectorAll("[data-review-filter]").forEach(input=>input.oninput=()=>{if(input.dataset.reviewFilter==="status")ui.reviewFilter=input.value;else if(input.dataset.reviewFilter==="class")ui.reviewClass=input.value;else ui.reviewConfidence=Number(input.value);render();});document.querySelector("[data-teach-ai]")?.addEventListener("change",e=>{ui.teachAI=e.target.checked;});
    document.querySelectorAll("[data-reviewgroup-action]").forEach(b=>b.onclick=()=>{
      const event=activeEvent(),pi=event.analysis?.planIntelligence,group=pi?.reviewGroups.find(g=>g.id===b.dataset.group);if(!group)return;
      if(b.dataset.reviewgroupAction==="confirm-family"){
        const strong=group.memberIds.filter(id=>!group.outlierIds.includes(id));
        strong.forEach(id=>{const c=event.analysis.candidates.find(x=>x.id===id);if(c){const was=classOf(c);c.status="confirmed";c.selected=true;rememberCorrection(event,c);
          captureTrainingExample(event,c,{decisionType:"confirmation",predictionBefore:was,
            note:"accepted in bulk via Confirm All; not individually reviewed by a person"});}});
        recordOperatorAction(event,"confirm-family",strong);
        // The queue is only worth following if it reflects the answer just
        // given. Confirming a family removes it from review, changes the seat
        // and table counts every fact rests on, and can settle a
        // contradiction outright -- so the next question has to be computed
        // from the plan as it is now, not as it was at import.
        recomputePlanIntelligence(event);
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
      // One question can stand for several identical arrangements, and each of
      // them gets its OWN decision record: a grouping decision belongs to the
      // tables it is about, and one record shared across arrangements is the
      // data-model bug already fixed once in this repository.
      const groupIds=q.groupIds?.length?q.groupIds:[q.groupId];
      const groups=groupIds.map(id=>pi.furnitureGroups.find(g=>g.id===id)).filter(Boolean);
      const memberIds=groups[0]?.memberIds||[];
      if(!canMutate(event,"answer a plan question"))return;
      const decision=action==="yes"?"merged":"separate";
      recordOperatorAction(event,`grouping-${decision}`,groups.flatMap(g=>g.memberIds||[]));
      event.analysis.groupingDecisions ||= [];
      for(const group of groups){
        event.analysis.groupingDecisions.push({id:uid("groupdecision"),memberIds:[...group.memberIds],decision,decidedAt:nowISO(),fromQuestionId:q.id});
        state.verifiedExamples.push({id:uid("verified"),eventId:event.id,savedAt:nowISO(),kind:"grouping-question",question:q.question,answer:action==="yes"?"one-group":"separate-tables",memberCandidateIds:group.memberIds});
      }
      recomputePlanIntelligence(event);
      const newPi=event.analysis.planIntelligence;
      touchEvent(event);ui.activeQuestionId=null;render();
      toast(decision==="merged"
        ?`Confirmed as one seating group. Plan now shows ${newPi.planSummary.diningGroups} dining group(s). Undo is available in Review Center.`
        :`Split into ${memberIds.length} separate tables. Plan now shows ${newPi.planSummary.diningGroups} dining group(s). Undo is available in Review Center.`,
        "success",6000);
    });
    document.querySelectorAll("[data-review-decision-action='undo-correction']").forEach(b=>b.onclick=()=>{
      const n=undoLastCorrection();
      render();
      if(n)toast(t("review.undoCorrectionToast",{n}),"success",5000);
    });
    document.querySelectorAll("[data-review-decision-action='undo-last']").forEach(b=>b.onclick=()=>{
      const event=activeEvent();if(!canMutate(event,"undo a plan decision"))return;
      const decisions=event.analysis?.groupingDecisions;if(!decisions?.length)return;
      const undone=decisions.pop();recomputePlanIntelligence(event);touchEvent(event);render();
      toast(`Undone: ${undone.decision==="merged"?"one seating group":"separate tables"} decision reverted.`,"success",5000);
    });
    bindReviewDrawing();
  }

  // Backup/restore: a product-level export of the app's own structured
  // state, distinct from the operational XLSX workbook. Never overwrites
  // current data with a file that fails format, structure or referential
  // integrity checks -- each failure is a specific, translated toast rather
  // than a generic "invalid file".
  function buildBackupPayload(){return{format:"merit-event-maker-backup",formatVersion:1,exportedAt:nowISO(),payload:state};}
  function exportBackup(){
    const blob=new Blob([JSON.stringify(buildBackupPayload(),null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`merit-event-maker-yedek-${todayKey()}.json`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
    toast(t("backup.exportedToast"),"success");
  }
  function backupReferencesIntact(payload){
    for(const event of payload.events||[]){
      const tableIds=new Set((event.tables||[]).map(x=>x.id));
      for(const g of event.guests||[])if(g.assignment&&g.assignment.tableId&&!tableIds.has(g.assignment.tableId))return false;
    }
    return true;
  }
  function importBackupFile(file){
    const reader=new FileReader();
    reader.onerror=()=>toast(t("backup.corruptFile"),"error",6000);
    reader.onload=()=>{
      let parsed;
      try{parsed=JSON.parse(reader.result);}catch{toast(t("backup.corruptFile"),"error",6000);return;}
      if(!parsed||parsed.format!=="merit-event-maker-backup"||!parsed.payload||!Array.isArray(parsed.payload.events)){toast(t("backup.invalidFile"),"error",6000);return;}
      if(!backupReferencesIntact(parsed.payload)){toast(t("backup.badReference"),"error",6500);return;}
      const n=parsed.payload.events.length;
      if(!confirm(t("backup.confirmRestore",{n})))return;
      state=parseRoot(JSON.stringify(parsed.payload));
      ui.screen="events";ui.activeEventId=null;ui.undo=[];ui.redo=[];
      saveState();render();
      toast(t("backup.restoredToast",{n}),"success");
    };
    reader.readAsText(file);
  }
  function bindV8Common(){
    document.querySelectorAll("[data-action='create-event']").forEach(b=>b.onclick=startNewEvent);document.querySelectorAll("[data-action='help']").forEach(b=>b.onclick=openGuide);document.querySelectorAll("[data-open-event]").forEach(b=>b.onclick=()=>openEvent(b.dataset.openEvent));// Row-level open + per-row action buttons now coexist on Home, so the
// buttons must not bubble into the row's open handler.
document.querySelectorAll("[data-duplicate-event]").forEach(b=>b.onclick=e=>{e.stopPropagation();duplicateEvent(b.dataset.duplicateEvent);});document.querySelectorAll("[data-delete-event]").forEach(b=>b.onclick=e=>{e.stopPropagation();deleteEvent(b.dataset.deleteEvent);});document.querySelectorAll("[data-history-event]").forEach(row=>row.ondblclick=()=>openEvent(row.dataset.historyEvent));document.querySelectorAll("[data-history-event] .row-icons").forEach(el=>el.ondblclick=e=>e.stopPropagation());
    document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{ui.tab=b.dataset.tab;ui.selectedObjectId=null;ui.selectedObjectIds=[];ui.highlightId=null;ui.operationalMode=false;render();});const back=document.querySelector("[data-action='back-events']");if(back)back.onclick=()=>{ui.screen="events";ui.focusMode=false;render();};const save=document.querySelector("[data-action='save-now']");if(save)save.onclick=()=>saveState(true);const search=document.getElementById("globalGuestSearch");if(search){search.oninput=()=>renderGlobalSearch(search.value);search.onkeydown=e=>{if(e.key==="Escape")document.getElementById("globalSearchResults")?.classList.add("hidden");};}
    const backupExport=document.querySelector("[data-action='backup-export']");if(backupExport)backupExport.onclick=exportBackup;
    const backupImport=document.querySelector("[data-action='backup-import']");if(backupImport)backupImport.onclick=()=>document.getElementById("backupFileInput").click();
    const backupInput=document.getElementById("backupFileInput");
    if(backupInput){const fresh=backupInput.cloneNode(true);backupInput.replaceWith(fresh);fresh.addEventListener("change",e=>{const file=e.target.files[0];if(file)importBackupFile(file);e.target.value="";});}
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

  const oldFloorInput=document.getElementById("floorPlanFile"),freshFloorInput=oldFloorInput.cloneNode(true);oldFloorInput.replaceWith(freshFloorInput);freshFloorInput.addEventListener("change",async e=>{const file=e.target.files[0],event=activeEvent();if(!file||!event||!canMutate(event,"replace the floor plan"))return;try{let src,name=file.name;if(file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")){const pdf=await waitForPdf(),doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise,pageNumber=Math.max(1,Math.min(doc.numPages,Number(prompt(`PDF contains ${doc.numPages} pages. Enter page number:`,"1"))||1)),page=await doc.getPage(pageNumber),v=page.getViewport({scale:2.6}),canvas=document.createElement("canvas");canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);await page.render({canvasContext:canvas.getContext("2d"),viewport:v}).promise;src=canvas.toDataURL("image/png",.96);name=`${file.name} · page ${pageNumber}`;}else src=await readDataURL(file);recordUndo(event);event.background={src,name,opacity:.34,visible:true,locked:true,isDefault:false,scale:100,importedAtMs:Date.now()};touchEvent(event);render();toast("Floor plan imported locally. Assisted Detection is ready.","success");}catch(error){toast(error.message,"error",6500);}finally{e.target.value="";}});

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

  // The very first render must wait on the async StorageProvider load --
  // every render() after this one is driven by user interaction and needs
  // nothing more than the in-memory `state` object already being current.
  loadV8Async().then(loaded=>{state=loaded;bootReady=true;render();}).catch(error=>{
    console.error("Storage load failed entirely; starting from a blank state.",error);
    state=blankRoot();bootReady=true;render();
  });
})();