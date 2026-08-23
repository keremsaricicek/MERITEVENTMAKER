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
    for(const guest of event.guests||[]){if(!guest.assignment)return;const table=event.tables.find(t=>t.id===guest.assignment.tableId);if(!table)continue;(guest.assignment.seats||[]).forEach((seatIndex,partyIndex)=>{const chair=table.chairs[Number(seatIndex)];if(chair)chair.occupancy={guestId:guest.id,partyIndex,planned:true};});}
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
    for(const table of event.tables){if(numbers.has(table.number))issues.push({level:"blocker",title:"Duplicate table number",text:table.number});numbers.add(table.number);}
    if(!event.tables.length)issues.push({level:"warn",title:"Blank plan",text:"Add tables manually or use Assisted Detection."});
    if(pax>capacity)issues.push({level:"blocker",title:"Capacity exceeded",text:`${pax} guest pax / ${capacity} physical chairs`});
    const unassigned=event.guests.filter(g=>!g.assignment).reduce((n,g)=>n+paxOf(g),0);if(unassigned)issues.push({level:"warn",title:"Unassigned guests",text:`${unassigned} pax still need seats.`});
    return issues;
  }
  function planHealthHTML(event){
    const issues=planIssues(event),level=issues.some(x=>x.level==="blocker")?"blocker":issues.length?"warn":"";
    return`<details class="plan-health"><summary><i class="health-dot ${level}"></i>Plan Health${issues.length?` · ${issues.length}`:" · Ready"}</summary><div class="health-pop">${issues.length?issues.map(x=>`<div class="health-item"><i class="health-dot ${x.level}"></i><div><b>${esc(x.title)}</b><span>${esc(x.text)}</span></div></div>`).join(""):`<div class="health-item"><i class="health-dot"></i><div><b>No blocking issues</b><span>Capacity, table numbers and assignments are consistent.</span></div></div>`}</div></details>`;
  }
  function eventCard(event){const m=eventMetrics(event),cover=event.coverImage?`<div class="event-cover" style="background-image:url('${event.coverImage}')"></div>`:`<div class="event-cover"><div class="event-cover-placeholder"></div></div>`;return`<article class="event-card" data-card-event="${event.id}">${cover}<div class="event-card-body"><div class="kicker">${esc(event.status)}</div><h3>${esc(event.name)}</h3><div class="event-meta">${esc(fmtDate(event.date))}<br>${esc([event.hotel,event.salon].filter(Boolean).join(" · ")||"Venue not set")}</div><div class="event-card-stats"><div class="event-card-stat"><b>${m.guests}</b><span>Guest pax</span></div><div class="event-card-stat"><b>${physicalCapacity(event)}</b><span>Physical chairs</span></div></div><div class="event-card-actions"><button class="btn primary" data-open-event="${event.id}">Open Event</button><button class="btn" data-duplicate-event="${event.id}" title="Duplicate">${icon("copy")}</button><button class="btn danger" data-delete-event="${event.id}" title="Delete">${icon("trash")}</button></div></div></article>`;}
  eventsHTML = function(){
    const upcoming=state.events.filter(e=>!isHistorical(e)).sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999"));
    const history=state.events.filter(isHistorical).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
    return`<header class="appbar">${topBrand()}<div class="crumb">Event Operations / <b>Portfolio</b></div><div class="appbar-actions">${helpButton()}<button class="btn primary" data-action="create-event">${icon("plus")}Create Event</button></div></header><section class="events-page"><div class="events-wrap v8-home"><div class="v8-home-head"><div><div class="kicker">MERIT ENTERTAINMENT · EVENT OPERATIONS</div><h1>Event Maker</h1><p>Upcoming production workspaces and immutable event history.</p></div><span class="muted">${state.events.length} event${state.events.length===1?"":"s"}</span></div><section class="event-section"><div class="event-section-title"><h2>Upcoming Events</h2><span>${upcoming.length}</span></div>${upcoming.length?`<div class="upcoming-grid">${upcoming.map(eventCard).join("")}</div>`:`<div class="v8-empty"><h2>No upcoming events</h2><p>Create an event with a truly blank plan or import a floor plan.</p><button class="btn primary" data-action="create-event">${icon("plus")}Create Event</button></div>`}</section><section class="event-section"><div class="event-section-title"><h2>Events History</h2><span>Past dates and Completed events are read-only</span></div><div class="history-shell"><table class="history-table"><thead><tr><th>Event</th><th>Date</th><th>Hotel / Salon</th><th>Guest pax</th><th>Physical chairs</th><th>Status</th><th>Access</th><th></th></tr></thead><tbody>${history.length?history.map(e=>`<tr data-history-event="${e.id}" title="Double-click to open read-only"><td><b>${esc(e.name)}</b></td><td>${esc(fmtDate(e.date))}</td><td>${esc([e.hotel,e.salon].filter(Boolean).join(" · ")||"—")}</td><td>${eventMetrics(e).guests}</td><td>${physicalCapacity(e)}</td><td><span class="status-chip">${esc(e.status)}</span></td><td><span class="history-readonly">${icon("lock")}Read-only</span></td><td><button class="btn sm danger" data-delete-event="${e.id}">Delete</button></td></tr>`).join(""):`<tr><td colspan="8" class="muted" style="text-align:center;padding:28px">No historical events.</td></tr>`}</tbody></table></div></section></div></section>`;
  };

  const normalTabs=[["floor","Floor Plan"],["guests","Guests"],["seating","Seating Plan"],["live","Live Event"],["reports","Reports"]];
  const historyTabs=[["guests","Guests"],["seating","Seating Plan"],["reports","Reports"]];
  workspaceHTML = function(event){
    const historical=isHistorical(event),tabs=historical?historyTabs:normalTabs;
    if(!tabs.some(([id])=>id===ui.tab))ui.tab=tabs[0][0];
    return`<section class="workspace ${ui.focusMode?"v8-focus":""}"><header class="workspace-head">${topBrand()}<div class="event-id"><strong>${esc(event.name)}</strong><span>${esc(fmtDate(event.date))} · ${esc([event.hotel,event.salon].filter(Boolean).join(" · ")||"Venue not set")}</span></div><div class="workspace-actions"><div class="global-search">${icon("search")}<input id="globalGuestSearch" placeholder="Find guest, inviter, table or seat" autocomplete="off"><div id="globalSearchResults" class="search-results hidden"></div></div>${planHealthHTML(event)}<button class="btn quiet icon-only" data-action="save-now" title="Save now">${icon("save")}</button>${helpButton()}<button class="btn sm" data-action="back-events">All Events</button></div></header><nav class="tabs">${tabs.map(([id,label])=>`<button class="tab ${ui.tab===id?"active":""}" data-tab="${id}">${label}</button>`).join("")}</nav>${historical?`<div class="workspace-readonly-banner">${icon("lock")}Historical event · Seating, guest and report records are immutable.</div>`:""}<div class="content">${tabContent(event)}</div>${ui.focusMode?`<button class="focus-exit" data-v8-action="focus">Esc · Exit Focus Mode</button>`:""}</section>`;
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
    return`<section class="setup-screen"><header class="setup-top">${topBrand()}<button class="btn" data-setup="cancel">${icon("x")}Cancel</button></header><div class="setup-shell"><section class="setup-panel"><div class="kicker">NEW EVENT · FULL SETUP</div><h1>Create Event</h1><p>Event identity, venue information and optional cover are stored separately from the plan.</p><form id="v8EventForm" class="setup-form"><div class="field full"><label>Event Name</label><input name="name" required autocomplete="off" value="${esc(d.name)}" placeholder="Event name"></div><div class="field"><label>Date</label><input name="date" type="date" required value="${esc(d.date)}"></div><div class="field"><label>Status</label><select name="status">${["Planning","Confirmed","Live"].map(s=>`<option ${d.status===s?"selected":""}>${s}</option>`).join("")}</select></div><div class="field"><label>Hotel</label><input name="hotel" required value="${esc(d.hotel)}" placeholder="Hotel"></div><div class="field"><label>Salon</label><input name="salon" value="${esc(d.salon)}" placeholder="Salon / hall"></div><div class="field full"><label>Optional Event Cover</label><label class="cover-drop" data-cover-drop>${d.coverImage?`<img src="${d.coverImage}" alt="Event cover" style="width:100%;height:100%;object-fit:cover">`:`<span>${icon("image")} Choose JPG or PNG cover</span>`}<input id="v8CoverFile" type="file" accept="image/png,image/jpeg" hidden></label>${d.coverImage?`<div class="file-tools"><button class="btn sm" type="button" data-setup="remove-cover">Remove cover</button></div>`:""}</div></form></section><section class="setup-panel"><div class="kicker">FLOOR PLAN · OPTIONAL</div><h1>Import or start blank</h1><p>PNG, JPG, JPEG and every page of a PDF are processed locally in this browser.</p><label class="plan-drop" id="v8PlanDrop">${d.planSrc?`<img class="plan-preview" src="${d.planSrc}" alt="Selected floor plan"><strong>${esc(d.planName)}</strong>`:`${icon("image")}<strong>Drop a floor plan here</strong><span>or click to choose PNG, JPG, JPEG or PDF</span>`}<input id="v8PlanFile" type="file" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" hidden></label>${d.pdfPages?.length?`<div class="pdf-pages">${d.pdfPages.map((p,i)=>`<button class="pdf-page ${d.pdfPage===i?"active":""}" type="button" data-pdf-page="${i}"><canvas data-pdf-thumb="${i}"></canvas><span>Page ${i+1}</span></button>`).join("")}</div>`:""}<div class="file-tools">${d.planSrc?`<button class="btn sm" data-setup="replace-plan">Replace</button><button class="btn sm danger" data-setup="remove-plan">Remove</button>`:""}</div><div class="privacy-note">Nothing is uploaded. PDF rendering, image analysis, guest data and autosave stay in this browser profile.</div><div class="setup-actions"><button class="btn" data-setup="blank" ${ui.setupBusy?"disabled":""}>Continue Without Floor Plan</button><button class="btn primary" data-setup="create" ${ui.setupBusy?"disabled":""}>${ui.setupBusy?"Preparing plan…":"Create Event"}${icon("arrow")}</button></div></section></div></section>`;
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
    return`<div class="planmap-toolbar"><div class="tool-group"><button class="toolbar-btn lang-btn" data-v8-action="toggle-lang" title="Language / Dil">${ui.lang==="tr"?"TR":"EN"}</button></div><div class="tool-group">${toolbarBtn("mouse","Select",`data-tool="select"`,ui.tool==="select")}${toolbarBtn("hand","Pan",`data-tool="pan"`,ui.tool==="pan")}</div><div class="tool-group">${toolbarBtn("zoomOut","Zoom out",`data-canvas-action="zoom-out"`)}<span class="zoom-label">${Math.round(ui.zoom*100)}%</span>${toolbarBtn("zoomIn","Zoom in",`data-canvas-action="zoom-in"`)}${toolbarBtn("fit","Fit",`data-canvas-action="fit"`)}</div><div class="tool-group">${toolbarBtn("eye",bg.visible?"Hide original plan":"Show original plan",`data-v8-action="toggle-bg"`,bg.visible)}${toolbarBtn("image","Replace plan",`data-v8-action="replace-bg"`)}</div><div class="tool-group">${toolbarBtn("fit","Focus Mode",`data-v8-action="focus"`,ui.focusMode)}</div>${bg.src?`<div class="tool-group">${toolbarBtn("image","Assisted Detection",`data-v8-action="detect"`,false).replace('class="toolbar-btn','class="toolbar-btn ai')}</div>`:""}</div>`;
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
      return`<aside class="contextual-card"><div class="contextual-card-head"><strong>${esc(formatTableNumber(t_.number))}</strong><span>${esc(t_.zone)} · ${assigned} occupied</span></div><div class="seat-editor"><div class="seat-stepper"><button data-seat-step="-1" title="Remove one seat">−</button><b>${t_.capacity}</b><button data-seat-step="1" title="Add one seat">+</button></div><div class="seat-presets">${presets.map(n=>`<button class="${t_.capacity===n?"active":""}" data-seat-capacity="${n}">${n}</button>`).join("")}<button data-seat-custom>Custom</button></div></div><div class="form-grid compact"><div class="field"><label>Type</label><select data-inspector="type">${["rectangle","square","round","bistro"].map(x=>`<option value="${x}" ${t_.type===x?"selected":""}>${titleCase(x)}</option>`).join("")}</select></div><div class="field"><label>Rotation</label><input data-inspector="rotation" type="number" value="${Math.round(t_.rotation||0)}"></div><div class="field full"><label>Zone</label><select data-inspector="zone">${ZONES.map(z=>`<option ${t_.zone===z?"selected":""}>${z}</option>`).join("")}</select></div></div><div class="contextual-card-actions"><button class="btn sm" data-inspector-action="duplicate">${icon("copy")}Duplicate</button><button class="btn sm" data-inspector-action="lock">${icon("lock")}${t_.locked?"Unlock":"Lock"}</button><button class="btn sm danger" data-inspector-action="delete">${icon("trash")}Delete</button></div></aside>`;
    }
    return`<aside class="contextual-card"><div class="contextual-card-head"><strong>${esc(o.label)}</strong><span>${titleCase(o.type)} object</span></div><div class="form-grid compact"><div class="field full"><label>Label</label><input data-inspector="label" value="${esc(o.label)}"></div><div class="field"><label>Rotation</label><input data-inspector="rotation" type="number" value="${Math.round(o.rotation||0)}"></div></div><div class="contextual-card-actions"><button class="btn sm" data-inspector-action="duplicate">${icon("copy")}Duplicate</button><button class="btn sm" data-inspector-action="lock">${icon("lock")}${o.locked?"Unlock":"Lock"}</button><button class="btn sm danger" data-inspector-action="delete">${icon("trash")}Delete</button></div></aside>`;
  }
  function addManuallyFabHTML(){return`<button class="planmap-fab" data-v8-action="add" title="${t("action.addManually")}">${icon(ui.v8AddOpen?"x":"plus")}<span>${t("action.addManually")}</span></button>`;}

  function v8Toolbar(event,seating=false){
    return`<div class="canvas-toolbar v8-toolbar"><div class="tool-group">${toolbarBtn("mouse","Select",`data-tool="select"`,ui.tool==="select")}${toolbarBtn("hand","Pan",`data-tool="pan"`,ui.tool==="pan")}</div>${!seating?`<div class="tool-group">${toolbarBtn("plus","Add / Bulk",`data-v8-action="add"`,ui.v8AddOpen)}${toolbarBtn("copy","Duplicate",`data-v8-action="duplicate-selection"`)}${toolbarBtn("trash","Delete",`data-v8-action="delete-selection"`)}</div><div class="tool-group">${toolbarBtn("undo","Undo",`data-canvas-action="undo"`)}${toolbarBtn("redo","Redo",`data-canvas-action="redo"`)}</div>`:""}<div class="tool-group">${toolbarBtn("zoomOut","Zoom out",`data-canvas-action="zoom-out"`)}<span class="zoom-label">${Math.round(ui.zoom*100)}%</span>${toolbarBtn("zoomIn","Zoom in",`data-canvas-action="zoom-in"`)}${toolbarBtn("fit","Fit",`data-canvas-action="fit"`)}</div><div class="tool-group">${toolbarBtn("grid","Grid",`data-canvas-action="grid"`,ui.grid)}${toolbarBtn("magnet","Snap",`data-canvas-action="snap"`,ui.snap)}${toolbarBtn("seat","Seat labels",`data-canvas-action="seat-numbers"`,ui.showSeats)}</div><span class="toolbar-spacer"></span>${!seating?toolbarBtn("image","Assisted Detection",`data-v8-action="detect" ${event.background?.src?"":"disabled"}`,false).replace('class="toolbar-btn','class="toolbar-btn ai'):""}${toolbarBtn("fit","Focus Mode",`data-v8-action="focus"`,ui.focusMode)}</div>`;
  }
  function bulkPanel(event){
    if(!ui.v8AddOpen)return"";const d=ui.bulkDraft||={kind:"table",type:"round",chairs:8,quantity:4,rows:2,cols:2,placement:"grid",prefix:"T",zone:"MAIN FLOOR"};
    return`<div class="v8-create-pop"><h3>Add Objects</h3><p>Preview a row, grid, repeated placement or array before committing.</p><div class="bulk-grid"><div class="field"><label>Kind</label><select data-bulk="kind"><option value="table">Table + chairs</option><option value="venue" ${d.kind==="venue"?"selected":""}>Venue object</option></select></div><div class="field"><label>Type</label><select data-bulk="type">${(d.kind==="venue"?["stage","bar","entrance","exit","column","text"]:["rectangle","square","round","bistro"]).map(v=>`<option ${d.type===v?"selected":""}>${v}</option>`).join("")}</select></div>${d.kind==="table"?`<div class="field"><label>Chairs each</label><input data-bulk="chairs" type="number" min="1" max="99" value="${d.chairs}"></div><div class="field"><label>Number prefix</label><input data-bulk="prefix" value="${esc(d.prefix)}" maxlength="4"></div>`:""}<div class="field"><label>Quantity</label><input data-bulk="quantity" type="number" min="1" max="60" value="${d.quantity}"></div><div class="field"><label>Placement</label><select data-bulk="placement">${["grid","row","repeated","array"].map(v=>`<option ${d.placement===v?"selected":""}>${v}</option>`).join("")}</select></div><div class="field"><label>Rows</label><input data-bulk="rows" type="number" min="1" max="12" value="${d.rows}"></div><div class="field"><label>Columns</label><input data-bulk="cols" type="number" min="1" max="12" value="${d.cols}"></div></div><div class="bulk-actions"><button class="btn sm" data-v8-action="close-add">Cancel</button><button class="btn sm primary" data-v8-action="commit-add">${d.placement==="repeated"?"Start placement":"Add to plan"}</button></div></div>`;
  }
  function bulkPositions(d){
    const count=Math.max(1,Math.min(60,Number(d.quantity)||1)),cols=d.placement==="row"?count:Math.max(1,Number(d.cols)||1),rows=Math.max(1,Number(d.rows)||1),gapX=190,gapY=145,out=[];
    for(let i=0;i<count;i++){const c=i%cols,r=Math.floor(i/cols);if(r>=rows&&d.placement!=="row")break;out.push({x:440+c*gapX,y:270+r*gapY});}return out;
  }
  function ghostHTML(){if(!ui.v8AddOpen||ui.bulkDraft?.placement==="repeated")return"";return bulkPositions(ui.bulkDraft).map((p,i)=>`<div class="ghost-object" data-label="${esc((ui.bulkDraft.prefix||"T")+String(i+1).padStart(2,"0"))}" style="left:${p.x}px;top:${p.y}px;width:120px;height:82px"></div>`).join("");}
  const oldViewport=canvasViewportHTML;
  canvasViewportHTML = function(event,seating){
    const html=oldViewport(event,seating);if(seating)return html;
    return html.replace("</div><div class=\"canvas-status\"",`${ghostHTML()}</div><div class="canvas-status v8-status"`).replace("Drag to move · Handles resize and rotate · Delete removes selection",`Ctrl/Shift multi-select · Drag blank canvas for marquee · Arrow keys nudge<span class="status-right">${ui.selectedObjectIds.length||0} selected</span>`);
  };
  floorPlanHTML = function(event){return`<div class="planmap-shell">${planMapToolbarHTML(event)}${bulkPanel(event)}${canvasViewportHTML(event,false)}${contextualCardHTML(event)}${planStatusPillHTML(event)}${addManuallyFabHTML()}</div>`;};

  function uniqueNumber(event,prefix,index){let n=index;while(event.tables.some(t=>t.number===prefix+String(n).padStart(2,"0")))n++;return prefix+String(n).padStart(2,"0");}
  function createTable(event,d,x,y,index){const dims=d.type==="round"?[120,120]:d.type==="square"?[105,105]:d.type==="bistro"?[82,72]:[170,86],number=uniqueNumber(event,(d.prefix|| (d.type==="bistro"?"B":"T")).toUpperCase(),index);return syncTableChairs({id:uid("table"),number,type:d.type,x,y,w:dims[0],h:dims[1],capacity:Number(d.chairs)||1,zone:d.type==="bistro"?"BISTRO":d.zone||"MAIN FLOOR",rotation:0,locked:false,z:10,hasPhysicalSeats:true});}
  function commitBulk(){const event=activeEvent(),d=ui.bulkDraft;if(!canMutate(event,"add plan objects"))return;if(d.placement==="repeated"){ui.repeatPlacement={...d,remaining:Math.max(1,Number(d.quantity)||1),index:1};ui.v8AddOpen=false;render();toast("Repeated placement active. Click the canvas for each object; Esc cancels.","success",5000);return;}const positions=bulkPositions(d);if(!positions.length)return;recordUndo(event);const created=[];positions.forEach((p,i)=>{if(d.kind==="table"){const t=createTable(event,d,p.x,p.y,i+1);event.tables.push(t);created.push(t.id);}else{const sizes={stage:[380,180],bar:[300,70],entrance:[110,40],exit:[90,40],column:[55,55],text:[150,42]},s=sizes[d.type]||[120,50],o={id:uid("venue"),type:d.type,label:d.type.toUpperCase(),x:p.x,y:p.y,w:s[0],h:s[1],rotation:0,locked:false,z:4};event.venueObjects.push(o);created.push(o.id);}});ui.selectedObjectIds=created;ui.selectedObjectId=created[0];ui.v8AddOpen=false;touchEvent(event);render();toast(`${created.length} object${created.length===1?"":"s"} added with physical chair records.`,"success");}
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
    document.querySelectorAll("[data-bulk]").forEach(input=>input.onchange=()=>{let value=input.type==="number"?Number(input.value):input.value;ui.bulkDraft[input.dataset.bulk]=value;if(input.dataset.bulk==="kind")ui.bulkDraft.type=value==="venue"?"stage":"round";render();});
    viewport?.addEventListener("pointerdown",e=>{if(ui.repeatPlacement&&e.target.closest("[data-object-id]")==null){e.preventDefault();placeRepeated(e);}},true);viewport?.addEventListener("pointerdown",startMarquee,true);
    world?.querySelectorAll("[data-object-id]").forEach(el=>{if(ui.selectedObjectIds.includes(el.dataset.objectId))el.classList.add("multi-selected");if(ui.tab==="seating"&&el.dataset.objectKind==="table"){el.addEventListener("drop",e=>{const raw=e.dataTransfer.getData("application/x-merit-guests");if(raw){e.preventDefault();e.stopPropagation();assignGuestGroup(JSON.parse(raw),el.dataset.objectId);}},true);}});
    const clear=document.querySelector("[data-clear-seating-filter]");if(clear)clear.onclick=()=>{ui.seatingFilter="all";ui.operationalMode=false;render();};
  };

  function guestSelectionRows(event){const q=ui.seatingQuery.trim().toLocaleLowerCase("tr"),showAll=ui.seatingGuestScope==="all";return event.guests.filter(g=>(showAll||!g.assignment)&&(!q||[g.name,g.vip,g.invitedBy,g.planningStatus,event.tables.find(t=>t.id===g.assignment?.tableId)?.number].join(" ").toLocaleLowerCase("tr").includes(q)));}
  seatingHTML = function(event){
    const records=guestSelectionRows(event),selectedIds=ui.selectedGuestIds.length?ui.selectedGuestIds:[ui.selectedGuestId].filter(Boolean),left=ui.leftCollapsed?collapsedPanel("left"):`<aside class="side-panel left"><div class="panel-head"><strong>${ui.seatingGuestScope==="all"?"All Guest Records":"Guests Needing Assignment"}</strong><button class="panel-toggle" data-panel-toggle="left">${icon("chevron")}</button></div>${selectedIds.length?`<div class="selection-count">${selectedIds.length} record${selectedIds.length===1?"":"s"} selected · ${selectedIds.reduce((n,id)=>n+paxOf(event.guests.find(g=>g.id===id)),0)} pax</div>`:""}<div class="guest-scope-strip">${[["all","All Guests"],["unassigned","Unassigned"]].map(([v,l])=>`<button class="seg-btn ${ui.seatingGuestScope===v?"active":""}" data-seating-scope="${v}">${l}</button>`).join("")}</div><div class="guest-filter-strip">${[["all","All Tables"],["empty","Empty Tables"],["available","Available Seats"],["full","Full Tables"]].map(([v,l])=>`<button class="seg-btn ${ui.seatingFilter===v?"active":""}" data-seating-filter="${v}">${l}</button>`).join("")}</div><div class="unassigned-search"><input class="filter-input" id="seatingSearch" value="${esc(ui.seatingQuery)}" placeholder="Search name, VIP or invited by"></div><div class="unassigned-list">${records.length?records.map(g=>{const table=event.tables.find(t=>t.id===g.assignment?.tableId);return`<div class="guest-row-card ${selectedIds.includes(g.id)?"selected multi-selected":""}" draggable="true" data-seating-guest="${g.id}"><strong>${esc(g.name)}${additionalOf(g)?` +${additionalOf(g)}`:""}</strong><span><em>${esc(g.invitedBy||g.vip)}</em><em>${table?esc(table.number):paxOf(g)+" pax"}</em></span></div>`}).join(""):`<div class="inspector-empty">No matching guest records.</div>`}</div></aside>`;
    return`<div class="${editorClasses(true)}">${left}<section class="canvas-column">${v8Toolbar(event,true)}${canvasViewportHTML(event,true)}</section>${selectedTablePanelHTML(event)}</div>`;
  };
  seatRowHTML = function(index,occupant,selected){
    if(!occupant)return`<div class="seat-row empty" data-empty-seat="${index}"><span class="seat-no">S${index+1}</span><span class="seat-person">Empty</span>${selected?"<button class='seat-action'>Assign here</button>":"<span></span>"}</div>`;
    const g=occupant.guest,label=occupant.companion?`GUEST OF ${g.name.toUpperCase()}`:g.name;
    return`<div class="seat-row ${ui.selectedGuestIds.includes(g.id)?"multi-selected":""}" draggable="${occupant.index===0}" data-occupant-guest="${occupant.index===0?g.id:""}"><span class="seat-no">S${index+1}</span><span class="seat-person">${esc(label)} ${occupant.companion?"<small>companion</small>":""}</span>${occupant.index===0?`<span><button class="seat-action" data-lock-assignment="${g.id}">${g.assignment.locked?"Unlock":"Lock"}</button> <button class="seat-action" data-unassign="${g.id}">Unassign</button></span>`:"<span></span>"}</div>`;
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
    try{for(const g of guests){const count=paxOf(g),seats=free.slice(cursor,cursor+count);cursor+=count;g.assignment={tableId,seats,locked:false};}ui.selectedTableId=tableId;ui.highlightId=tableId;touchEvent(event);render();toast(`${guests.length} record${guests.length===1?"":"s"} moved transactionally to ${table.number} · ${required} chairs reserved.`,"success",5000);}
    catch(error){snapshot.forEach(s=>{event.guests.find(g=>g.id===s.id).assignment=s.assignment;});toast("The group move was rolled back.","error");}
  }
  assignGuestToTable = function(guestId,tableId,preferred=null){assignGuestGroup([guestId],tableId,preferred);};
  unassignGuest = function(id){const event=activeEvent();if(!canMutate(event,"remove a seating assignment"))return;original.unassignGuest(id);};
  toggleAssignmentLock = function(id){const event=activeEvent();if(!canMutate(event,"change an assignment lock"))return;original.toggleAssignmentLock(id);};
  bindSeating = function(){
    bindPanelToggles();const event=activeEvent(),records=guestSelectionRows(event),search=document.getElementById("seatingSearch");if(search)search.oninput=()=>{ui.seatingQuery=search.value;render();};
    document.querySelectorAll("[data-seating-scope]").forEach(b=>b.onclick=()=>{ui.seatingGuestScope=b.dataset.seatingScope;ui.selectedGuestIds=[];ui.selectedGuestId=null;render();});document.querySelectorAll("[data-seating-filter]").forEach(b=>b.onclick=()=>{ui.seatingFilter=b.dataset.seatingFilter;ui.operationalMode=false;render();});
    document.querySelectorAll("[data-seating-guest]").forEach(row=>{row.onclick=e=>{selectGuestRecord(row.dataset.seatingGuest,e,records);render();};row.ondragstart=e=>{if(!ui.selectedGuestIds.includes(row.dataset.seatingGuest))ui.selectedGuestIds=[row.dataset.seatingGuest];e.dataTransfer.setData("application/x-merit-guests",JSON.stringify(ui.selectedGuestIds));e.dataTransfer.setData("application/x-merit-guest",row.dataset.seatingGuest);};});
    document.querySelectorAll("[data-occupant-guest]").forEach(row=>{if(!row.dataset.occupantGuest)return;row.onclick=e=>{selectGuestRecord(row.dataset.occupantGuest,e,event.guests);render();};row.ondragstart=e=>{if(!ui.selectedGuestIds.includes(row.dataset.occupantGuest))ui.selectedGuestIds=[row.dataset.occupantGuest];e.dataTransfer.setData("application/x-merit-guests",JSON.stringify(ui.selectedGuestIds));};});
    document.querySelectorAll("[data-empty-seat]").forEach(row=>row.onclick=()=>{const ids=ui.selectedGuestIds.length?ui.selectedGuestIds:[ui.selectedGuestId].filter(Boolean);if(ids.length)assignGuestGroup(ids,ui.selectedTableId,Number(row.dataset.emptySeat));});document.querySelectorAll("[data-unassign]").forEach(b=>b.onclick=()=>unassignGuest(b.dataset.unassign));document.querySelectorAll("[data-lock-assignment]").forEach(b=>b.onclick=()=>toggleAssignmentLock(b.dataset.lockAssignment));
  };

  liveHTML = function(event){
    const q=ui.liveQuery.trim().toLocaleLowerCase("tr"),rows=event.guests.filter(g=>!q||[g.name,g.vip,g.invitedBy,g.planningStatus,g.arrivalStatus,event.tables.find(t=>t.id===g.assignment?.tableId)?.number].join(" ").toLocaleLowerCase("tr").includes(q)),s=liveStats(event);
    const kpis=[["all","Total Guests",s.total,"All guest records","users",""],["checked","Checked In",s.checked,"Arrived pax","users",""],["not-arrived","Not Arrived",s.notArrived,"Awaiting arrival","users","attention"],["no-show","No Show",s.noShow,"Released operational seats","users","danger"],["empty","Empty Tables",s.emptyTables,"No live occupants","table",""],["available","Empty Chairs",s.emptyChairs,"Open operational chairs","chair","available"]];
    return`<div class="screen-scroll"><div class="screen-inner"><div class="screen-titlebar"><div><h2>Live Event</h2><p>No Show releases operational capacity while preserving the planned assignment.</p></div><input class="filter-input" id="liveSearch" value="${esc(ui.liveQuery)}" placeholder="Search name, invited by, table or status"></div><div class="live-kpis v8-live-kpis">${kpis.map(([id,label,value,note,ic,cls])=>`<button class="live-kpi ${cls}" data-live-kpi="${id}"><span class="kpi-top">${label}${icon(ic)}</span><b>${value}</b><small>${note}</small></button>`).join("")}</div><div class="live-list"><div class="live-row header v8-live-row"><span>Name Surname</span><span>Pax</span><span>Invited By</span><span>Table</span><span>Planning</span><span>Arrival</span><span>Action</span></div>${rows.map(g=>{const t=event.tables.find(x=>x.id===g.assignment?.tableId);return`<div class="live-row v8-live-row"><span><b>${esc(g.name)}${additionalOf(g)?` +${additionalOf(g)}`:""}</b><small class="subline">${esc(g.vip)}</small></span><span>${paxOf(g)}</span><span class="inviter-cell">${esc(g.invitedBy||"—")}</span><span>${t?esc(t.number):"—"}</span><span>${esc(g.planningStatus)}</span><span class="${g.arrivalStatus==="Checked In"?"arrival-checked":g.arrivalStatus==="No Show"?"arrival-no-show":""}">${esc(g.arrivalStatus)}</span><span class="live-actions"><button class="btn sm ${g.arrivalStatus==="Checked In"?"active":""}" data-arrival="Checked In" data-live-guest="${g.id}">Check In</button><button class="btn sm ${g.arrivalStatus==="No Show"?"danger":""}" data-arrival="No Show" data-live-guest="${g.id}">No Show</button></span></div>`}).join("")}</div></div></div>`;
  };
  bindLive = function(){
    const search=document.getElementById("liveSearch");search.oninput=()=>{ui.liveQuery=search.value;render();};document.querySelectorAll("[data-live-kpi]").forEach(b=>b.onclick=()=>{const target=b.dataset.liveKpi;if(["checked","not-arrived","no-show"].includes(target)){ui.liveQuery=target==="checked"?"Checked In":target==="not-arrived"?"Not Arrived":"No Show";return render();}ui.tab="seating";ui.seatingFilter=target;ui.seatingGuestScope="all";ui.seatingQuery="";ui.operationalMode=target==="available"||target==="empty";ui.selectedGuestIds=[];ui.selectedGuestId=null;ui.selectedTableId=null;render();});document.querySelectorAll("[data-live-guest]").forEach(b=>b.onclick=()=>{const event=activeEvent();if(!canMutate(event,"change live arrival status"))return;const g=event.guests.find(x=>x.id===b.dataset.liveGuest),status=b.dataset.arrival;g.arrivalStatus=g.arrivalStatus===status?"Not Arrived":status;audit(event,"ARRIVAL_STATUS_CHANGED",{guestId:g.id,status:g.arrivalStatus});touchEvent(event);render();toast(`${g.name}: ${g.arrivalStatus}.`,"success");});
  };

  openGuestDialog = function(...args){if(canMutate(activeEvent(),"edit guest records"))original.openGuestDialog(...args);};
  deleteGuest = function(...args){if(canMutate(activeEvent(),"delete guest records"))original.deleteGuest(...args);};
  bindGuests = function(){if(isHistorical(activeEvent()))return;original.bindGuests();};
  loadXLSX = function(){return globalThis.XLSX?Promise.resolve():Promise.reject(new Error("Embedded spreadsheet engine did not initialize."));};

  function yieldFrame(){return new Promise(resolve=>requestAnimationFrame(()=>resolve()));}
  function sourceBlob(src){return fetch(src).then(r=>r.blob());}
  function otsu(hist,total,sum){let bg=0,bgSum=0,best=-1,threshold=150;for(let value=0;value<256;value++){bg+=hist[value];if(!bg)continue;const fg=total-bg;if(!fg)break;bgSum+=value*hist[value];const score=bg*fg*((bgSum/bg)-((sum-bgSum)/fg))**2;if(score>best){best=score;threshold=value;}}return threshold;}
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
  async function runAssistedDetection(){
    const event=activeEvent();if(!canMutate(event,"run plan analysis")||!event.background?.src)return toast("Import a floor plan first.","error");ui.analysisBusy=true;ui.analysisProgress=3;ui.analysisStage=t("analysis.stage.reading");ui.screen="review";render();await yieldFrame();
    try{
      const blob=await sourceBlob(event.background.src),bitmap=await createImageBitmap(blob),max=1920,ratio=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*ratio)),height=Math.max(1,Math.round(bitmap.height*ratio)),canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(bitmap,0,0,width,height);bitmap.close();
      ui.analysisStage=t("analysis.stage.understanding");ui.analysisProgress=22;render();await yieldFrame();const pixels=ctx.getImageData(0,0,width,height),gray=new Uint8Array(width*height),hist=new Uint32Array(256);let sum=0;for(let i=0,o=0;i<gray.length;i++,o+=4){const v=Math.round(pixels.data[o]*.299+pixels.data[o+1]*.587+pixels.data[o+2]*.114);gray[i]=v;hist[v]++;sum+=v;}const threshold=otsu(hist,gray.length,sum),binary=new Uint8Array(gray.length),integral=new Uint32Array((width+1)*(height+1));for(let y=1;y<=height;y++){let row=0;for(let x=1;x<=width;x++){row+=gray[(y-1)*width+x-1];integral[y*(width+1)+x]=integral[(y-1)*(width+1)+x]+row;}}for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x,r=18,x0=Math.max(0,x-r),x1=Math.min(width-1,x+r),y0=Math.max(0,y-r),y1=Math.min(height-1,y+r),stride=width+1,local=(integral[(y1+1)*stride+x1+1]-integral[y0*stride+x1+1]-integral[(y1+1)*stride+x0]+integral[y0*stride+x0])/((x1-x0+1)*(y1-y0+1)),gx=-gray[(y-1)*width+x-1]+gray[(y-1)*width+x+1]-2*gray[y*width+x-1]+2*gray[y*width+x+1]-gray[(y+1)*width+x-1]+gray[(y+1)*width+x+1],gy=-gray[(y-1)*width+x-1]-2*gray[(y-1)*width+x]-gray[(y-1)*width+x+1]+gray[(y+1)*width+x-1]+2*gray[(y+1)*width+x]+gray[(y+1)*width+x+1],edge=Math.abs(gx)+Math.abs(gy)>150;binary[i]=(gray[i]<Math.min(threshold+12,local-7)||edge)?1:0;}
      ui.analysisStage=t("analysis.stage.understanding");ui.analysisProgress=45;render();await yieldFrame();const visited=new Uint8Array(binary.length),queue=new Int32Array(binary.length),components=[],minPixels=Math.max(10,Math.round(width*height*.000006));
      for(let start=0;start<binary.length;start++){if(!binary[start]||visited[start])continue;let head=0,tail=0,count=0,minX=width,minY=height,maxX=0,maxY=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;queue[tail++]=start;visited[start]=1;while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);count++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++){const next=yy*width+xx;if(binary[next]&&!visited[next]){visited[next]=1;queue[tail++]=next;}}}if(count<minPixels)continue;const w=maxX-minX+1,h=maxY-minY+1,aspect=w/h,fill=count/(w*h),mx=sx/count,my=sy/count,covXX=sxx/count-mx*mx,covYY=syy/count-my*my,covXY=sxy/count-mx*my,rotation=.5*Math.atan2(2*covXY,covXX-covYY)*180/Math.PI;components.push({x:minX,y:minY,w,h,count,aspect,fill,rotation});}
      ui.analysisStage=t("analysis.stage.seating");ui.analysisProgress=73;render();await yieldFrame();const area=width*height,minDim=Math.min(width,height),notWall=c=>!(Math.min(c.w,c.h)<3&&Math.max(c.w,c.h)>minDim*.08),chairs=components.filter(c=>notWall(c)&&Math.min(c.w,c.h)>=3&&Math.max(c.w,c.h)<=minDim*.065&&c.w*c.h<area*.0028&&c.fill>=.045),tables=components.filter(c=>notWall(c)&&Math.min(c.w,c.h)>=minDim*.016&&c.w*c.h>=area*.00015&&c.w*c.h<=area*.04&&c.aspect>=.35&&c.aspect<=3.8&&c.fill>=.035).sort((a,b)=>b.w*b.h-a.w*a.h).slice(0,100);
      const candidates=tables.map((t,index)=>{const nearby=chairs.filter(ch=>{const cx=ch.x+ch.w/2,cy=ch.y+ch.h/2,margin=Math.max(t.w,t.h)*.65;return cx>=t.x-margin&&cx<=t.x+t.w+margin&&cy>=t.y-margin&&cy<=t.y+t.h+margin&&!(cx>=t.x&&cx<=t.x+t.w&&cy>=t.y&&cy<=t.y+t.h);}).sort((a,b)=>{const ax=a.x+a.w/2-(t.x+t.w/2),ay=a.y+a.h/2-(t.y+t.h/2),bx=b.x+b.w/2-(t.x+t.w/2),by=b.y+b.h/2-(t.y+t.h/2);return ax*ax+ay*ay-bx*bx-by*by;}).slice(0,18),round=t.aspect>.78&&t.aspect<1.28&&t.fill<.68,confidence=Math.min(.94,.4+Math.min(.3,nearby.length*.04)+Math.min(.18,t.fill*.28));return{id:uid("candidate"),kind:"table",type:round?"round":"rectangle",x:t.x/width*100,y:t.y/height*100,w:t.w/width*100,h:t.h/height*100,rotation:t.rotation,confidence,status:"unreviewed",selected:confidence>=.48,chairDetections:nearby.map(ch=>({id:uid("candidate-chair"),x:(ch.x+ch.w/2)/width*100,y:(ch.y+ch.h/2)/height*100,w:ch.w/width*100,h:ch.h/height*100,rotation:ch.rotation,confidence:.56})),evidence:{geometry:Number(Math.min(.95,t.fill+.35).toFixed(2)),chairs:nearby.length,repetition:tables.filter(o=>Math.abs(o.w-t.w)<t.w*.2&&Math.abs(o.h-t.h)<t.h*.2).length}};});
      const venues=components.filter(c=>notWall(c)&&c.w*c.h>area*.008&&c.w*c.h<area*.12&&(c.aspect>3.1||c.aspect<.32)).slice(0,14).map(c=>({id:uid("candidate"),kind:"venue",type:c.aspect>3?"stage":"column",x:c.x/width*100,y:c.y/height*100,w:c.w/width*100,h:c.h/height*100,rotation:c.rotation,confidence:.52,status:"unreviewed",selected:false,chairDetections:[],evidence:{geometry:.62,chairs:0,repetition:0}}));
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
      event.analysis={id:uid("analysis"),engine:"ASSISTED_DETECTION",trainedModel:false,notice:"Classical computer vision is active; no trained Merit model is installed in this browser review.",createdAt:nowISO(),imageWidth:width,imageHeight:height,originalWidth:Math.round(width/ratio),originalHeight:Math.round(height/ratio),threshold,candidates:allCandidates,missed:allCandidates.filter(c=>c.missed).map(c=>c.id),groupingDecisions:carriedDecisions,memoryReapplied:memoryResult.reappliedCount,memoryRestored:memoryResult.restored.length,comparison:{added:[...newSig].filter(x=>!oldSig.has(x)).length,removed:[...oldSig].filter(x=>!newSig.has(x)).length,changed:0},diagnostics:{components:components.length,wallSuppression:true,chairs:chairs.length,tables:tables.length,resolution:`${width}×${height}`}};
      ui.analysisStage=t("analysis.stage.labels");ui.analysisProgress=84;render();await yieldFrame();
      let ocrResult={available:false,text:null,reason:"OCR not attempted"};
      try{ocrResult=await runPlanOCR(canvas.toDataURL("image/png"));}catch(ocrError){ocrResult={available:false,text:null,reason:ocrError.message};}
      event.analysis.ocr={available:ocrResult.available,reason:ocrResult.reason||null,engine:"tesseract.js"};
      // Kept in full (not just the truncated capacityAudit.sourceText) so a
      // grouping/reclassification decision can recompute planIntelligence
      // later without re-running OCR.
      event.analysis.ocrText=ocrResult.available?ocrResult.text:null;
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
    const pad=.4,tx=Math.max(0,bbox.x-bbox.w*pad),ty=Math.max(0,bbox.y-bbox.h*pad),tw=Math.min(100-tx,bbox.w*(1+2*pad)||20),th=Math.min(100-ty,bbox.h*(1+2*pad)||20);
    const scale=Math.max(1,Math.min(4,Math.min(100/Math.max(8,tw),100/Math.max(8,th))));
    const cxPx=(tx+tw/2)/100*rect.width,cyPx=(ty+th/2)/100*rect.height;
    inner.style.transform=`translate(${rect.width/2-cxPx*scale}px, ${rect.height/2-cyPx*scale}px) scale(${scale})`;
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
    return`<aside class="review-center-panel"><div class="review-center-head"><strong>${t("review.center")}</strong>${decisions.length?`<button class="btn sm quiet" data-review-decision-action="undo-last" title="Undo the most recent plan decision">${icon("undo")} Undo last decision (${decisions.length})</button>`:""}<button class="btn icon-only sm" data-review-action="close-review-center">${icon("x")}</button></div><div class="review-center-list">${pi.reviewGroups.map(g=>`<div class="review-group-card"><div class="review-group-title">${titleCase(g.title)}</div>${memberCropsHTML(event,g.memberIds)}<div class="review-group-meta">${g.totalInFamily} similar · ${g.consistentCount} ${t("review.consistentOf")} · ${g.memberIds.length} ${t("review.needReview")}</div><div class="review-group-actions"><button class="btn sm primary" data-reviewgroup-action="confirm-family" data-group="${g.id}">${t("action.applyToAll")}</button><button class="btn sm" data-reviewgroup-action="inspect" data-group="${g.id}">${t("action.reviewOutliers")}</button></div></div>`).join("")||`<div class="inspector-empty">${t("review.noGroups")}</div>`}</div>${pi.uncertainQuestions.length?`<div class="review-center-difficult"><strong>${t("review.difficultQuestions")}</strong>${pi.uncertainQuestions.map(q=>`<div class="difficult-q-row"><span>${esc(questionText(q))}</span><button class="btn sm" data-question-action="open" data-question="${q.id}">${t("action.answer")}</button></div>`).join("")}</div>`:""}</aside>`;
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
  function analysisHTML(event){
    const a=event.analysis,candidates=reviewCandidates(event),selected=a?.candidates.find(c=>c.id===ui.selectedCandidateId),pi=a?.planIntelligence;
    const pins=reviewMapPins(event,pi);
    const target=activeReviewTargetIds(pi),byId=a?new Map(a.candidates.map(c=>[c.id,c])):new Map();
    const boundaryBox=target?.isGroup?unionBbox([...target.ids].map(id=>byId.get(id)).filter(Boolean)):null;
    requestAnimationFrame(()=>applyReviewZoom(boundaryBox));
    return`<section class="planintel-screen"><header class="planintel-top"><button class="btn" data-review-action="back">${icon("arrow")}Floor Plan</button><div class="planintel-title"><h2>${a?t("plan.understood"):(ui.analysisBusy?esc(ui.analysisStage):"No analysis yet")}</h2>${a?`<p>${a.ocr&&!a.ocr.available?esc(t("ocr.unavailable",{reason:a.ocr.reason||"no network"})):a.notice}</p>`:`<p>${esc(ui.analysisStage)}</p>`}</div><span class="toolbar-spacer"></span>${a?`<details class="planintel-diagnostics"><summary>Advanced Diagnostics</summary><div class="diag-pop"><div class="analysis-note">${esc(a.engine)} · ${a.diagnostics.resolution}<br>Diff +${a.comparison.added} / −${a.comparison.removed}</div><div class="field"><label>Status</label><select data-review-filter="status"><option value="all">All</option>${["unreviewed","confirmed","rejected"].map(v=>`<option ${ui.reviewFilter===v?"selected":""}>${v}</option>`).join("")}</select></div><div class="field full"><label>Minimum confidence ${Math.round(ui.reviewConfidence*100)}%</label><input data-review-filter="confidence" type="range" min="0" max=".95" step=".05" value="${ui.reviewConfidence}"></div><button class="btn sm" data-review-action="draw">${ui.reviewDrawMode?"Cancel Drawing":t("action.aiMissed")}</button><button class="btn sm" data-review-action="save-verified">Save Verified Plan</button><button class="btn sm" data-review-action="improve">Improve AI (Local Calibration)</button></div></details><button class="btn" data-review-action="reanalyze">Re-Analyze</button>`:""}<button class="btn sm" data-review-action="toggle-lang">${ui.lang==="tr"?"TR":"EN"}</button></header>${pi?`<div class="planintel-map ${ui.reviewDrawMode?"draw-mode":""}" id="analysisScene"><div class="planintel-map-inner" id="analysisSceneInner"><img src="${event.background.src}" alt="Floor plan analysis source">${candidates.map(c=>candidateBox(c,selected?.id===c.id,target?.ids||null)).join("")}${boundaryBox?`<div class="review-group-boundary" style="left:${Math.max(0,boundaryBox.x-2.5)}%;top:${Math.max(0,boundaryBox.y-2.5)}%;width:${boundaryBox.w+5}%;height:${boundaryBox.h+5}%"></div>`:""}${pins.map(p=>p.kind==="group"?`<button class="review-pin group" data-review-action="focus-group" data-group="${p.groupId}" style="left:${p.x}%;top:${p.y}%" title="Review group ${p.label}">${p.label}</button>`:`<button class="review-pin question" data-question-action="open" data-question="${p.questionId}" style="left:${p.x}%;top:${p.y}%" title="Difficult question">${p.label}</button>`).join("")}</div></div>${selected&&!ui.reviewDrawMode?reviewPoiCardHTML(selected):""}${difficultQuestionCardHTML(event)}${planIntelBottomPillHTML(event)}${ui.reviewCenterOpen?reviewCenterPanelHTML(event):""}`:`<div class="v8-empty" style="margin:40px"><h2>${ui.analysisBusy?"Analyzing locally…":"No analysis yet"}</h2><p>${esc(ui.analysisStage)}</p></div>`}</section>`;
  }
  function updateCandidateField(field,value){
    const event=activeEvent(),c=event.analysis?.candidates.find(x=>x.id===ui.selectedCandidateId);if(!c)return;
    if(field==="rotation")c.rotation=Number(value)||0;
    else if(field==="chairs"){const count=Math.max(0,Math.min(99,Number(value)||0));c.chairDetections=Array.from({length:count},(_,i)=>c.chairDetections?.[i]||{id:uid("candidate-chair"),x:c.x+c.w/2,y:c.y+c.h/2,w:.7,h:.7,rotation:0,confidence:.3});}
    else if(field==="kindtype"){
      const [kind,type]=value.split(":"),crossedKind=kind!==c.kind;
      c.kind=kind;c.type=type;
      if(crossedKind&&kind!=="table")c.chairDetections=[]; // a chair/armchair/sofa/stage/etc. candidate carries no nested seat detections of its own.
      c.status="confirmed";c.selected=true;
      rememberCorrection(event,c);
      recomputePlanIntelligence(event); // reclassifying can move a candidate in/out of furniture grouping, similarity clustering, review groups and the physical-seat capacity sum — never just relabel it.
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
    document.querySelectorAll("[data-action='create-event']").forEach(b=>b.onclick=startNewEvent);document.querySelectorAll("[data-action='help']").forEach(b=>b.onclick=openGuide);document.querySelectorAll("[data-open-event]").forEach(b=>b.onclick=()=>openEvent(b.dataset.openEvent));document.querySelectorAll("[data-duplicate-event]").forEach(b=>b.onclick=()=>duplicateEvent(b.dataset.duplicateEvent));document.querySelectorAll("[data-delete-event]").forEach(b=>b.onclick=()=>deleteEvent(b.dataset.deleteEvent));document.querySelectorAll("[data-history-event]").forEach(row=>row.ondblclick=()=>openEvent(row.dataset.historyEvent));
    document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{ui.tab=b.dataset.tab;ui.selectedObjectId=null;ui.selectedObjectIds=[];ui.highlightId=null;ui.operationalMode=false;render();});const back=document.querySelector("[data-action='back-events']");if(back)back.onclick=()=>{ui.screen="events";ui.focusMode=false;render();};const save=document.querySelector("[data-action='save-now']");if(save)save.onclick=()=>saveState(true);const search=document.getElementById("globalGuestSearch");if(search){search.oninput=()=>renderGlobalSearch(search.value);search.onkeydown=e=>{if(e.key==="Escape")document.getElementById("globalSearchResults")?.classList.add("hidden");};}
  }
  bindCommon = bindV8Common;
  openEvent = function(id){const event=state.events.find(e=>e.id===id);if(!event)return;ui.activeEventId=id;ui.screen="workspace";ui.tab=isHistorical(event)?"guests":"floor";ui.selectedObjectId=null;ui.selectedObjectIds=[];ui.selectedGuestIds=[];ui.operationalMode=false;ui.undo=[];ui.redo=[];render();};
  duplicateEvent = function(id,open=false){const source=state.events.find(e=>e.id===id);if(!source)return;original.duplicateEvent(id,open);const copy=state.events[0];copy.hotel=copy.hotel||copy.venue||"";copy.salon=copy.salon||"";copy.tables.forEach(t=>{t.chairs=(t.chairs||[]).map((c,i)=>({...c,id:uid("chair"),parentTableId:t.id,seatNumber:i+1,occupancy:null}));});saveState();};

  render = function(){
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