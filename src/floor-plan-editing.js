// Editing the Floor Plan's objects: creating tables (one, a bulk layout, or
// repeated placement), duplicating, deleting, marquee selection, dragging,
// resizing, rotating, the inspector's field edits, capacity changes, venues,
// canvas undo/redo, and the canvas binding that wires it all (each pre-v8
// global it replaces — startObjectDrag, setTableCapacity, updateInspectorField,
// inspectorAction, deleteSelectedObject, startResize, startRotate,
// createTableFromDraft, addVenue, undoCanvas, redoCanvas, bindCanvas — stays an
// app-v8.js override as a one-line delegate). Moved out of app-v8.js on
// 2026-11-08 (code health, capability 7 of 21, part b,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs. The edits forced by the move: the canvas
// binding's capture of the pre-v8 bindCanvas reads globalThis.bindCanvas (what
// it read before), and SEATCMD — created further down the shell — is read
// through getSEATCMD() at the moment of use.
//
// Every edit refuses a historical event (canMutate) and goes through the
// existing writers: capacity through setTableCapacity/syncTableChairs (a table
// that draws chairs keeps chairs and capacity in step; a chair is never
// synthesised from a number), seats through the seating commands.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let PLANVIEW;
  let RULES;
  let SEAT;
  let activeEvent;
  let ask;
  let canMutate;
  let canvasSnapshot;
  let clone;
  let fitCanvas;
  let formatTableNumber;
  let getSEATCMD;
  let nowISO;
  let original;
  let recordUndo;
  let render;
  let repackTableAssignments;
  let runAssistedDetection;
  let saveState;
  let t;
  let tableAssignedPax;
  let toast;
  let touchEvent;
  let ui;
  let uid;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritFloorPlanEditing.create() is called once, by app-v8.js.");
    created=true;
    PLANVIEW=deps.PLANVIEW;
    RULES=deps.RULES;
    SEAT=deps.SEAT;
    activeEvent=deps.activeEvent;
    ask=deps.ask;
    canMutate=deps.canMutate;
    canvasSnapshot=deps.canvasSnapshot;
    clone=deps.clone;
    fitCanvas=deps.fitCanvas;
    formatTableNumber=deps.formatTableNumber;
    getSEATCMD=deps.getSEATCMD;
    nowISO=deps.nowISO;
    original=deps.original;
    recordUndo=deps.recordUndo;
    render=deps.render;
    repackTableAssignments=deps.repackTableAssignments;
    runAssistedDetection=deps.runAssistedDetection;
    saveState=deps.saveState;
    t=deps.t;
    tableAssignedPax=deps.tableAssignedPax;
    toast=deps.toast;
    touchEvent=deps.touchEvent;
    ui=deps.ui;
    uid=deps.uid;
  function uniqueNumber(event,prefix,index){let n=index;while(event.tables.some(t=>t.number===prefix+String(n).padStart(2,"0")))n++;return prefix+String(n).padStart(2,"0");}
  const ROW_SEAT_PX=33;
  function createTable(event,d,x,y,index){
    // A theatre row (S01…) is as long as its chairs, 33 px (half a metre) each.
    const dims=d.type==="round"?[120,120]:d.type==="square"?[105,105]:d.type==="bistro"?[82,72]:d.type==="row"?[ROW_SEAT_PX*Math.max(1,Number(d.chairs)||1),34]:[170,86],number=uniqueNumber(event,(d.prefix|| (d.type==="bistro"?"B":d.type==="row"?"S":"T")).toUpperCase(),index);
    return RULES().syncTableChairs({id:uid("table"),number,origin:"MANUAL",type:d.type,x,y,w:dims[0],h:dims[1],capacity:Number(d.chairs)||1,zone:d.type==="bistro"?"BISTRO":d.zone||"MAIN FLOOR",rotation:0,locked:false,z:10,hasPhysicalSeats:true,capacitySource:"HUMAN_CONFIRMED"});
  }
  function commitBulk(){
    PLANVIEW.syncBulkFields();
    const event=activeEvent(),d=ui.bulkDraft;
    if(!canMutate(event,"add plan objects"))return;
    if(d.placement==="repeated"){
      ui.repeatPlacement={...d,remaining:Math.max(1,Number(d.quantity)||1),index:1};
      ui.v8AddOpen=false;
      render();
      toast(t("toast.repeatedPlacementActive"),"success",5000);
      return;
    }
    const positions=PLANVIEW.bulkPositions(d);
    if(!positions.length)return;
    recordUndo(event);
    const created=[];
    positions.forEach((p,i)=>{if(d.kind==="table"){
      const t=createTable(event,d,p.x,p.y,i+1);
      event.tables.push(t);
      created.push(t.id);
    }else{
      const sizes={stage:[380,180],bar:[300,70],entrance:[110,40],exit:[90,40],column:[55,55],text:[150,42]},s=sizes[d.type]||[120,50],o={id:uid("venue"),type:d.type,label:d.type.toUpperCase(),x:p.x,y:p.y,w:s[0],h:s[1],rotation:0,locked:false,z:4};
      event.venueObjects.push(o);
      created.push(o.id);
    }});
    ui.selectedObjectIds=created;
    ui.selectedObjectId=created[0];
    ui.v8AddOpen=false;
    touchEvent(event);
    render();
    requestAnimationFrame(()=>{if(!PLANVIEW.planFullyInView(event))fitCanvas();});
    toast(t(created.length===1?"toast.objectAddedChairsOne":"toast.objectsAddedChairs",{n:created.length}),"success");
  }
  function placeRepeated(pointerEvent){
    const r=document.getElementById("canvasViewport").getBoundingClientRect(),d=ui.repeatPlacement,event=activeEvent(),x=(pointerEvent.clientX-r.left-ui.pan.x)/ui.zoom,y=(pointerEvent.clientY-r.top-ui.pan.y)/ui.zoom;
    if(!d||!canMutate(event,"place plan objects"))return;
    recordUndo(event);
    let id;
    if(d.kind==="table"){
      const t=createTable(event,d,x-60,y-45,d.index);
      event.tables.push(t);
      id=t.id;
    }else{
      const o={id:uid("venue"),type:d.type,label:d.type.toUpperCase(),x:x-60,y:y-30,w:120,h:60,rotation:0,locked:false,z:4};
      event.venueObjects.push(o);
      id=o.id;
    }
    d.remaining--;
    d.index++;
    ui.selectedObjectId=id;
    ui.selectedObjectIds=[id];
    if(d.remaining<=0)ui.repeatPlacement=null;
    touchEvent(event);
    render();
  }
  function duplicateSelection(){
    const event=activeEvent();
    if(!canMutate(event,"duplicate plan objects"))return;
    const ids=ui.selectedObjectIds.length?ui.selectedObjectIds:[ui.selectedObjectId].filter(Boolean);
    if(!ids.length)return toast(t("toast.selectObjectsFirst"));
    recordUndo(event);
    const created=[];
    for(const id of ids){
      const t=event.tables.find(x=>x.id===id),o=event.venueObjects.find(x=>x.id===id),c=clone(t||o);
      if(!c)continue;
      c.id=uid(t?"table":"venue");
      c.x+=24;
      c.y+=24;
      c.locked=false;
      if(t){
        c.number=uniqueNumber(event,t.type==="bistro"?"B":"T",1);
        // A copy is a person's act: nothing about it was detected, and the
        // number printed on the ORIGINAL's symbol is not this table's (§21).
        c.origin="COPY";delete c.printedNumber;if(c.capacitySource==="DETECTED_PHYSICAL_SEATS")c.capacitySource="HUMAN_CONFIRMED";c.chairs=(c.chairs||[]).map((chair,index)=>({...chair,id:uid("chair"),parentTableId:c.id,seatNumber:index+1}));event.tables.push(c);}else event.venueObjects.push(c);created.push(c.id);}ui.selectedObjectIds=created;ui.selectedObjectId=created[0]||null;touchEvent(event);render();}
  async function deleteSelection(){
    const event=activeEvent();
    if(!canMutate(event,"delete plan objects"))return;
    const ids=new Set(ui.selectedObjectIds.length?ui.selectedObjectIds:[ui.selectedObjectId].filter(Boolean));
    if(!ids.size)return;
    const affected=event.guests.filter(g=>ids.has(g.assignment?.tableId));
    if(!(await ask({title:t("ask.deleteObjectsTitle",{n:ids.size}),body:affected.length?t("ask.deleteObjectsGuests",{n:ids.size,guests:affected.length}):"",confirmLabel:t("ask.delete"),danger:true})))return;
    recordUndo(event);
    affected.forEach(g=>SEAT().clear(g));
    event.tables=event.tables.filter(t=>!ids.has(t.id));
    event.venueObjects=event.venueObjects.filter(o=>!ids.has(o.id));
    ui.selectedObjectIds=[];
    ui.selectedObjectId=null;
    touchEvent(event);
    render();
  }

  function startMarquee(e){
    if(e.button!==0||ui.tool!=="select"||ui.repeatPlacement)return;const viewport=document.getElementById("canvasViewport"),world=document.getElementById("canvasWorld");if(![viewport,world,world.querySelector(".reference-layer")].includes(e.target))return;e.preventDefault();const box=document.createElement("div");box.className="marquee";viewport.appendChild(box);const r=viewport.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top;let current=[];
    const move=ev=>{
      const x=ev.clientX-r.left,y=ev.clientY-r.top,left=Math.min(sx,x),top=Math.min(sy,y),w=Math.abs(x-sx),h=Math.abs(y-sy);
      Object.assign(box.style,{left:left+"px",top:top+"px",width:w+"px",height:h+"px"});
      const br={left:r.left+left,top:r.top+top,right:r.left+left+w,bottom:r.top+top+h};
      current=[...world.querySelectorAll("[data-object-id]")].filter(el=>{
        const q=el.getBoundingClientRect();
        return q.right>=br.left&&q.left<=br.right&&q.bottom>=br.top&&q.top<=br.bottom;
      }).map(el=>el.dataset.objectId);
    };
    const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);box.remove();ui.selectedObjectIds=e.ctrlKey?[...new Set([...ui.selectedObjectIds,...current])]:current;ui.selectedObjectId=ui.selectedObjectIds[0]||null;render();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
  }
  function startObjectDrag(e,id,kind,el){
    const event=activeEvent();if(!canMutate(event,"move plan objects")||ui.tool!=="select")return;
    if(e.ctrlKey||e.shiftKey){e.preventDefault();e.stopPropagation();ui.selectedObjectIds=ui.selectedObjectIds.includes(id)?ui.selectedObjectIds.filter(x=>x!==id):[...ui.selectedObjectIds,id];ui.selectedObjectId=ui.selectedObjectIds[0]||null;render();return;}
    if(!ui.selectedObjectIds.includes(id))ui.selectedObjectIds=[id];ui.selectedObjectId=id;
    const selected=ui.selectedObjectIds.map(objectId=>event.tables.find(x=>x.id===objectId)||event.venueObjects.find(x=>x.id===objectId)).filter(Boolean);if(selected.some(o=>o.locked))return toast(t("toast.unlockSelectedFirst"),"error");
    e.preventDefault();e.stopPropagation();const snap=canvasSnapshot(event),sx=e.clientX,sy=e.clientY,start=selected.map(o=>({o,x:o.x,y:o.y}));let moved=false;
    const move=ev=>{const dx=(ev.clientX-sx)/ui.zoom,dy=(ev.clientY-sy)/ui.zoom;start.forEach(({o,x,y})=>{o.x=ui.snap?Math.round((x+dx)/10)*10:x+dx;o.y=ui.snap?Math.round((y+dy)/10)*10:y+dy;const node=document.querySelector(`[data-object-id="${o.id}"]`);if(node){node.style.left=o.x+"px";node.style.top=o.y+"px";}});moved=true;};
    const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);if(moved){recordUndo(event,snap);touchEvent(event);}render();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
  }

  function setTableCapacity(event,table,newCap){
    if(!canMutate(event,"change chair capacity"))return false;
    newCap=Math.max(1,Math.min(99,Number(newCap)||1));
    const occupied=tableAssignedPax(event,table.id);
    if(newCap<occupied){
      toast(t("toast.capacityBelowPax",{table:table.number,n:occupied}),"error",5000);
      return false;
    }
    recordUndo(event);
    repackTableAssignments(event,table,newCap);
    if(table.capacityEvidence&&table.capacitySource!=="HUMAN_CONFIRMED")table.capacityEvidence={...table.capacityEvidence,confirmedBy:"person",confirmedAt:nowISO(),previous:table.capacity};
    table.capacitySource="HUMAN_CONFIRMED";
    // A theatre row grows and shrinks with its seats, so its chairs keep their spacing.
    if(table.type==="row")table.w=Math.round(table.w*newCap/Math.max(1,table.capacity));
    RULES().syncTableChairs(table,newCap);
    touchEvent(event);
    render();
    return true;
  }
  // A person can now type a table's number (§24): it was the one plan fact with
  // no path at all -- the only number field lived in the pre-v8 inspector,
  // which v8 never renders. Validated HERE before the base writer runs: letters,
  // digits, space, hyphen; at most 12; and unique by how the number is SHOWN,
  // so "T1" is refused beside an existing "T01" rather than becoming a second
  // "T 01" that the Plan Doctor would then have to call BLOCKING.
  function updateInspectorField(event,field,value){if(!canMutate(event,"edit plan objects"))return;
    const table=event.tables.find(x=>x.id===ui.selectedObjectId);
    if(field==="number"&&table){
      const v=String(value??"").trim().toUpperCase().replace(/\s+/g," ");
      if(!v||v.length>12||!/^[A-Z0-9ÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ -]*$/.test(v)){toast(t("toast.tableNumberInvalid"),"error");render();return;}
      if(v===table.number){render();return;}
      if(event.tables.some(x=>x.id!==table.id&&formatTableNumber(x.number)===formatTableNumber(v))){toast(t("toast.tableNumberInUse"),"error");render();return;}
      original.updateInspectorField(event,field,v);
      table.numberSource="TYPED";touchEvent(event);
      return;
    }
    original.updateInspectorField(event,field,value);if(table)RULES().syncTableChairs(table);}
  function inspectorAction(event,action){if(!canMutate(event,`${action} plan objects`))return;if(action==="duplicate")return duplicateSelection();if(action==="delete")return deleteSelection();original.inspectorAction(event,action);}
  function deleteSelectedObject(){return deleteSelection();}
  function startResize(...args){if(canMutate(activeEvent(),"resize plan objects"))original.startResize(...args);}
  function startRotate(...args){if(canMutate(activeEvent(),"rotate plan objects"))original.startRotate(...args);}
  function createTableFromDraft(){if(canMutate(activeEvent(),"add a table")){original.createTableFromDraft();const e=activeEvent(),t=e.tables.find(x=>x.id===ui.selectedObjectId);if(t){RULES().syncTableChairs(t);saveState();}}}
  function addVenue(...args){if(canMutate(activeEvent(),"add a venue object"))original.addVenue(...args);}
  // Undo/redo were the last canvas mutation path with no historical guard, and
  // the most reachable one: the Ctrl+Z handler in app-guests.js is bound to
  // window and is gated on neither screen, tab nor event status. Marking an
  // event Completed without leaving the workspace -- or simply working past
  // midnight into a past-dated event -- left a live undo stack pointed at a
  // record that is supposed to be frozen, and one keystroke rewrote its floor
  // plan. Guarding the handler would have fixed that one caller; the rule is
  // that canMutate rejects every mutation path, so the guard goes here.
  function undoCanvas(){if(canMutate(activeEvent(),"undo changes"))original.undoCanvas();}
  function redoCanvas(){if(canMutate(activeEvent(),"redo changes"))original.redoCanvas();}

  const oldBindCanvas=globalThis.bindCanvas;
  function bindCanvas(){
    oldBindCanvas();const event=activeEvent(),viewport=document.getElementById("canvasViewport"),world=document.getElementById("canvasWorld");
    if(RULES().isHistorical(event))return;
    document.querySelectorAll("[data-v8-action]").forEach(button=>button.onclick=()=>{
      const action=button.dataset.v8Action;
      if(action==="add"){
        ui.v8AddOpen=!ui.v8AddOpen;
        ui.bulkDraft ||= {kind:"table",type:"round",chairs:8,quantity:4,rows:2,cols:2,placement:"grid",prefix:"T",zone:"MAIN FLOOR"};
        render();
      }else if(action==="close-add"){
        ui.v8AddOpen=false;
        render();
      }else if(action==="commit-add")commitBulk();else if(action==="duplicate-selection")duplicateSelection();else if(action==="delete-selection")deleteSelection();else if(action==="focus"){
        ui.focusMode=!ui.focusMode;
        render();
      }else if(action==="detect")runAssistedDetection();else if(action==="toggle-bg"){
        recordUndo(event);
        event.background.visible=!event.background.visible;
        touchEvent(event);
        // touchEvent only saves: without a render the plan stayed on screen and
        // the button kept saying "Hide", so the first press looked like nothing.
        render();
      }else if(action==="replace-bg")document.getElementById("floorPlanFile").click();else if(action==="open-review-center"){
        ui.reviewCenterOpen=true;
        ui.tab="floor";
        ui.planMode="review";
        render();
      }else if(action==="toggle-lang"){
        ui.lang=ui.lang==="tr"?"en":"tr";
        render();
      }
    });
    // Typed fields update the draft and refresh only the ghost preview. A full
    // re-render on every change replaced the "Add to plan" button mid-click --
    // typing a value and clicking straight through lost both the edit and the
    // click. Selects still re-render, since choosing an option can change which
    // fields exist and no other click is in flight.
    document.querySelectorAll("[data-bulk]").forEach(input=>{
      const isSelect=input.tagName==="SELECT";
      input.oninput=()=>{
        if(input.dataset.bulk==="cols")ui.bulkDraft.colsChosen=true;
        PLANVIEW.syncBulkFields();
        if(input.dataset.bulk==="kind")ui.bulkDraft.type=ui.bulkDraft.kind==="venue"?"stage":"round";
        if(isSelect)render();else PLANVIEW.refreshGhosts();
      };
    });
    viewport?.addEventListener("pointerdown",e=>{if(ui.repeatPlacement&&e.target.closest("[data-object-id]")==null){e.preventDefault();placeRepeated(e);}},true);viewport?.addEventListener("pointerdown",startMarquee,true);
    world?.querySelectorAll("[data-object-id]").forEach(el=>{if(ui.selectedObjectIds.includes(el.dataset.objectId))el.classList.add("multi-selected");if(ui.tab==="seating"&&el.dataset.objectKind==="table"){el.addEventListener("drop",e=>{const raw=e.dataTransfer.getData("application/x-merit-guests");if(raw){e.preventDefault();e.stopPropagation();getSEATCMD().assignGuestGroup(JSON.parse(raw),el.dataset.objectId);}},true);}});
    const clear=document.querySelector("[data-clear-seating-filter]");if(clear)clear.onclick=()=>{ui.seatingFilter="all";ui.operationalMode=false;render();};
  }
    return{addVenue,bindCanvas,createTable,createTableFromDraft,deleteSelectedObject,deleteSelection,duplicateSelection,inspectorAction,redoCanvas,setTableCapacity,startObjectDrag,startResize,startRotate,undoCanvas,uniqueNumber,updateInspectorField};
  }
  globalThis.MeritFloorPlanEditing=Object.freeze({create,DEPS:Object.freeze(["PLANVIEW","RULES","SEAT","activeEvent","ask","canMutate","canvasSnapshot","clone","fitCanvas","formatTableNumber","getSEATCMD","nowISO","original","recordUndo","render","repackTableAssignments","runAssistedDetection","saveState","t","tableAssignedPax","toast","touchEvent","ui","uid"])});
})();
