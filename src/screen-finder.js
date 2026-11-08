// The Smart Guest Finder panel: the results under the top bar's search, the
// one next action per row and the finder's keys. Moved out of app-v8.js on 2026-11-08 (code health, capability 1 of 21 in
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs. The matching engine is not this file's: it is
// MeritGuestSearch (src/guest-search.js), created once by the shell and handed
// over as SEARCH, because Live's door search uses the same instance. It seats
// nobody: an arrival goes through setArrival, the one writer, handed to it; a
// seat action only opens Seating.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let RULES;
  let SEARCH;
  let activeEvent;
  let additionalOf;
  let canMutate;
  let esc;
  let formatTableNumber;
  let paxOf;
  let render;
  let seatRange;
  let setArrival;
  let t;
  let toast;
  let touchEvent;
  let ui;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritScreenFinder.create() is called once, by app-v8.js.");
    created=true;
    RULES=deps.RULES;
    SEARCH=deps.SEARCH;
    activeEvent=deps.activeEvent;
    additionalOf=deps.additionalOf;
    canMutate=deps.canMutate;
    esc=deps.esc;
    formatTableNumber=deps.formatTableNumber;
    paxOf=deps.paxOf;
    render=deps.render;
    seatRange=deps.seatRange;
    setArrival=deps.setArrival;
    t=deps.t;
    toast=deps.toast;
    touchEvent=deps.touchEvent;
    ui=deps.ui;
  function guestResultHTML(event,row,active){
    const g=row.guest,table=row.table;
    const extra=additionalOf(g);
    const historical=RULES().isHistorical(event);
    const party=globalThis.MeritGuestSearch.partyOf(event,g);
    const seatText=table?`${esc(formatTableNumber(table.number))} · ${esc(seatRange(g.assignment.seats))}`:t("find.noTable");
    // Each action is offered only where it can do something, with the reason
    // carried in the title rather than a dead control the operator presses and
    // learns nothing from.
    const act=(action,label,enabled,title)=>
      `<button class="btn sm ${enabled?"":"is-off"}" data-find-action="${action}" data-find-guest="${g.id}"${
        enabled?"":" disabled"}${title?` title="${esc(title)}"`:""}>${label}</button>`;
    return`<div class="find-row ${active?"active":""}" data-search-guest="${g.id}" role="listitem"${active?' aria-current="true"':""}>
      <div class="find-who">
        <strong>${esc(g.name)}${extra?` +${extra}`:""}</strong>
        <span class="find-meta">${esc(t("find.pax",{n:paxOf(g)}))}${
          g.vip&&g.vip!=="Standard"?` · <b class="find-vip">${esc(g.vip)}</b>`:""} · ${esc(planningText(g.planningStatus))} · ${esc(arrivalText(g.arrivalStatus))}</span>
        <span class="find-meta">${seatText}${table&&table.zone?` · ${esc(table.zone)}`:""}${
          g.invitedBy?` · ${esc(t("find.invitedBy",{host:g.invitedBy}))}`:""}</span>
      </div>
      <div class="find-actions">
        ${act("plan",t("find.showOnPlan"),!!table,table?"":t("find.noTableReason"))}
        ${act("party",t("find.viewParty"),party.length>1,party.length>1?"":t("find.noPartyReason"))}
        ${act("checkin",t("find.checkIn"),!historical&&g.arrivalStatus!=="Checked In",
          historical?t("find.historicalReason"):g.arrivalStatus==="Checked In"?t("find.alreadyIn"):"")}
        ${act("table",t("find.changeTable"),!historical,historical?t("find.historicalReason"):"")}
      </div>
    </div>`;
  }
  // Both status axes are stored in English — they are domain values that the
  // workbook export and the contract read — so both are translated at the
  // render boundary and neither is translated in the data. An unrecognised
  // value is shown as it stands rather than relabelled with a word that might
  // not be true of it.
  const statusText=(prefix,status)=>{
    const k=prefix+String(status||"").replace(/\s+/g,"");
    return t(k)!==k?t(k):String(status||"");
  };
  const arrivalText=status=>statusText("find.arrival.",status);
  const planningText=status=>statusText("find.planning.",status);
  // Four things an operator does after finding somebody. None of them moves a
  // guest on its own: CHANGE TABLE opens Seating with the guest selected and
  // waits for a person to choose, because silently reseating somebody is the
  // one thing this product must never do.
  function findAction(event,action,guestId){
    const g=event.guests.find(x=>x.id===guestId);
    if(!g)return;
    const table=g.assignment?event.tables.find(t=>t.id===g.assignment.tableId):null;
    closeGuestSearch();
    if(action==="plan"&&table){
      ui.tab="floor";ui.planMode="plan";
      ui.selectedObjectId=table.id;ui.selectedObjectIds=[table.id];ui.highlightId=table.id;
      ui.selectedGuestId=g.id;
      render();
    }else if(action==="party"){
      const box=document.getElementById("globalGuestSearch");
      if(box){box.value=g.invitedBy||"";renderGlobalSearch(box.value);box.focus();}
    }else if(action==="checkin"){
      if(!canMutate(event,"check a guest in"))return;
      // Arrival status only. Planning status is a separate axis and nothing
      // here may write to it. setArrival() is the sole writer of the audit
      // entry too (ARRIVAL_STATUS_CHANGED, source:"finder") — a second,
      // differently-named entry here would log the same decision twice under
      // two codes, with a colliding "from" field meaning the guest's PREVIOUS
      // status in one and the calling UI surface in the other.
      setArrival(event,g,"Checked In","finder");
      touchEvent(event);render();
      toast(t("find.checkedIn",{name:g.name}),"success");
    }else if(action==="table"){
      if(!canMutate(event,"change a guest's table"))return;
      ui.tab="seating";ui.selectedGuestId=g.id;
      ui.seatingGuestScope="all";ui.seatingQuery=g.name;ui.seatingFilter="available";
      ui.selectedTableId=table?table.id:null;ui.highlightId=ui.selectedTableId;
      render();
    }
  }
  function closeGuestSearch(){
    ui.findActive=-1;
    document.getElementById("globalSearchResults")?.classList.add("hidden");
  }
  // Reassigns the top-level binding from src/app.js, the same way eventsHTML
  // and the other screen renderers are replaced by this file.
  function renderGlobalSearch(query){
    const box=document.getElementById("globalSearchResults"),event=activeEvent();
    if(!box||!event)return;
    const {rows,total}=SEARCH.findGuests(event,query);
    if(!String(query||"").trim()){box.classList.add("hidden");ui.findActive=-1;return;}
    // -1 is the shut state, set by Escape and by the ui defaults. Without the
    // <0 guard it survives the next keystroke, so the list came back with
    // nothing selected and Enter did nothing — the keyboard path silently died
    // after the first Escape.
    if(ui.findActive==null||ui.findActive<0||ui.findActive>=rows.length)ui.findActive=rows.length?0:-1;
    box.innerHTML=rows.length
      ?`<div class="find-list" role="list" aria-label="${esc(t("find.resultsLabel"))}">${rows.map((r,i)=>guestResultHTML(event,r,i===ui.findActive)).join("")}</div>${
        total>rows.length?`<div class="find-more">${esc(t("find.more",{n:total-rows.length}))}</div>`:""}`
      :`<div class="find-empty">${t("find.none")}</div>`;
    box.classList.remove("hidden");
    box.querySelectorAll("[data-find-action]").forEach(b=>b.onclick=e=>{
      e.stopPropagation();
      if(b.disabled)return;
      findAction(event,b.dataset.findAction,b.dataset.findGuest);
    });
    // Clicking the row itself does the same as its primary action: show them on
    // the plan if they are seated, otherwise go and seat them.
    box.querySelectorAll("[data-search-guest]").forEach(row=>row.onclick=()=>{
      const g=event.guests.find(x=>x.id===row.dataset.searchGuest);
      findAction(event,g&&g.assignment?"plan":"table",row.dataset.searchGuest);
    });
  }
  // A door operator types and presses Enter; they do not reach for a mouse.
  function guestSearchKey(e){
    const box=document.getElementById("globalSearchResults");
    const input=document.getElementById("globalGuestSearch");
    if(!box||!input)return;
    if(e.key==="Escape"){closeGuestSearch();return;}
    const open=!box.classList.contains("hidden");
    if(!open)return;
    const rows=[...box.querySelectorAll("[data-search-guest]")];
    if(!rows.length)return;
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){
      e.preventDefault();
      ui.findActive=((ui.findActive??0)+(e.key==="ArrowDown"?1:-1)+rows.length)%rows.length;
      renderGlobalSearch(input.value);
    }else if(e.key==="Enter"){
      e.preventDefault();
      rows[Math.max(0,ui.findActive??0)]?.click();
    }
  }
    return{closeGuestSearch,guestSearchKey,renderGlobalSearch};
  }
  globalThis.MeritScreenFinder=Object.freeze({create,DEPS:Object.freeze(["RULES","SEARCH","activeEvent","additionalOf","canMutate","esc","formatTableNumber","paxOf","render","seatRange","setArrival","t","toast","touchEvent","ui"])});
})();
