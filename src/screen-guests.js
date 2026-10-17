// The Guests screen: the party list, its counts and the windowed rows.
//
// Moved byte-for-byte out of app-v8.js on 2026-10-04 (technical gaps, item 2),
// at the original indentation. The edits forced by the move: guestsHTML/
// bindGuests become this module's own functions (app-v8.js keeps the overrides
// and calls through). What stayed in the shell, deliberately: deleteGuest and
// unassignGuest (they WRITE a guest and its seat, with their undo — a screen
// does not own a writer), the guest dialog's override, and the static-dialog
// translation every render() runs.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that).
(() => {
  "use strict";
  let activeEvent;
  let additionalOf;
  let app;
  let downloadExcelTemplate;
  let esc;
  let filteredGuests;
  let icon;
  let openExcelWizard;
  let openGuestDialog;
  let original;
  let paxDotsHTML;
  let paxOf;
  let render;
  let RULES;
  let seatTagHTML;
  let t;
  let tableIndex;
  let ui;
  let created=false;


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
    return`<div role="cell"><div class="party-name">${esc(g.name)}</div><div class="party-sub">${bits.join("")}</div></div>`;
  }

  // The Guests list is WINDOWED, like Live's door list. §26 measured it
  // rendering every record: 3,000 guests became ~70,000 DOM nodes and a
  // render with a p95 up to 733 ms, which breaks the rule that a large list is
  // never O(n) nodes in the guest count. Search, filter, counts and order are
  // computed over every guest exactly as before; only how many rows are
  // MOUNTED changes, and "showing X of Y" says so.
  const GUEST_WINDOW_STEP=200;
  const guestsHTML = function(event){
    const all=filteredGuests(event),c=guestCounts(event),byId=tableIndex(event);
    const guests=all.slice(0,ui.guestWindow||GUEST_WINDOW_STEP),hiddenGuests=all.length-guests.length;
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
      :`<div class="mx-list" role="table" aria-label="${esc(t("guests.title"))}"><div class="mx-list-head cols-guest" role="row"><span role="columnheader">${t("guests.col.guest")}</span><span role="columnheader">${t("guests.col.status")}</span><span role="columnheader">${t("guests.col.invitedBy")}</span><span role="columnheader">${t("guests.col.tableSeat")}</span><span role="columnheader"><span class="sr-only">${t("guests.col.actions")}</span></span></div>${
        guests.length?guests.map(g=>`<div class="mx-row cols-guest" role="row">${guestPartyCellHTML(event,g)}<div role="cell"><span class="plan-tag ${g.planningStatus.toLowerCase()}">${esc(t("status.planning."+g.planningStatus))}</span></div><div class="muted" role="cell" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.invitedBy||"—")}</div><div role="cell">${seatTagHTML(event,g,byId)}${g.assignment?.locked?" 🔒":""}</div><div class="row-icons" role="cell"><button class="row-action" aria-label="${esc(t("guests.a11y.seat",{name:g.name}))}" title="${t("guests.col.tableSeat")}" data-guest-seat="${g.id}">${icon("seat")}</button><button class="row-action" aria-label="${esc(t("guests.a11y.edit",{name:g.name}))}" data-guest-edit="${g.id}">${icon("edit")}</button><button class="row-action" aria-label="${esc(t("guests.a11y.delete",{name:g.name}))}" data-guest-delete="${g.id}">${icon("trash")}</button></div></div>`).join(""):`<div class="mx-empty" style="border:none;background:none">${t("guests.noMatches")}</div>`
      }</div>${hiddenGuests>0?`<div class="live-more" id="guestMore"><span>${t("guests.showingOf",{shown:guests.length,total:all.length})}</span><button class="btn sm" data-guest-command="show-more">${t("guests.showMore")}</button></div>`:""}`;
    return`<div class="mx-screen"><div class="mx-wrap">
      <div class="mx-head"><div><h1>${t("guests.title")}</h1><p>${t("guests.recordsSummary",{records:c.records,total:c.totalPax})}</p></div><div class="mx-head-actions"><button class="btn" data-guest-command="template">${icon("download")}${t("guests.excelTemplate")}</button><button class="btn" data-guest-command="import">${icon("image")}${t("guests.importExcel")}</button><button class="btn primary" data-guest-command="add">${icon("plus")}${t("guests.addGuest")}</button></div></div>
      <div class="mx-metrics">${metrics}</div>
      ${queue}
      <div class="mx-toolbar"><div class="grow"><input class="filter-input" id="guestSearch" style="width:100%" value="${esc(ui.guestQuery)}" placeholder="${t("guests.search")}"></div><select class="filter-input" id="guestFilter" aria-label="${esc(t("guests.filter.label"))}" style="width:170px">${filters.map(([v,l])=>`<option value="${v}" ${ui.guestFilter===v?"selected":""}>${l}</option>`).join("")}</select></div>
      ${body}
    </div></div>`;
  };


  // deleteGuest is defined further up, where its undo lives.
  const bindGuests = function(){
    if(RULES().isHistorical(activeEvent()))return;
    original.bindGuests();
    // The empty state repeats Import/Add, and the base binder uses
    // querySelector -- first match only -- so the duplicates would be inert.
    app.querySelectorAll("[data-guest-command='add']").forEach(b=>b.onclick=()=>openGuestDialog());
    app.querySelectorAll("[data-guest-command='import']").forEach(b=>b.onclick=openExcelWizard);
    app.querySelectorAll("[data-guest-command='template']").forEach(b=>b.onclick=downloadExcelTemplate);
    // A new search or filter starts from the top of the window again. Focus
    // and caret come back SYNCHRONOUSLY: the base binder restored them on the
    // next animation frame with a caret read before render, which is the bug
    // §23 measured at the door ("Mehmet" typed at full speed arriving as
    // "metMeh") in the same shape here.
    const search=document.getElementById("guestSearch");
    if(search)search.oninput=()=>{ui.guestQuery=search.value;ui.guestWindow=null;const pos=search.selectionStart;render();
      const n=document.getElementById("guestSearch");if(n){n.focus();n.setSelectionRange(pos,pos);}};
    const filter=document.getElementById("guestFilter");
    if(filter)filter.onchange=e=>{ui.guestFilter=e.target.value;ui.guestWindow=null;render();};
    // Growing the window keeps the scroll position and the keyboard's place.
    const more=app.querySelector("[data-guest-command='show-more']");
    if(more)more.onclick=()=>{
      ui.guestWindow=(ui.guestWindow||GUEST_WINDOW_STEP)+GUEST_WINDOW_STEP;
      const scroller=document.querySelector(".mx-screen")||document.scrollingElement,keep=scroller?scroller.scrollTop:0;
      render();
      if(scroller)scroller.scrollTop=keep;
      (app.querySelector("[data-guest-command='show-more']")||document.getElementById("guestSearch"))?.focus({preventScroll:true});
    };
    const toSeating=app.querySelector("[data-guest-command='seating']");
    if(toSeating)toSeating.onclick=()=>{ui.tab="seating";ui.seatingGuestScope="unassigned";ui.seatingQuery="";ui.selectedGuestId=null;ui.selectedGuestIds=[];render();};
  };


  function create(deps){
    if(created)throw new Error("MeritScreenGuests.create() is called once, by app-v8.js.");
    created=true;
    activeEvent=deps.activeEvent;
    additionalOf=deps.additionalOf;
    app=deps.app;
    downloadExcelTemplate=deps.downloadExcelTemplate;
    esc=deps.esc;
    filteredGuests=deps.filteredGuests;
    icon=deps.icon;
    openExcelWizard=deps.openExcelWizard;
    openGuestDialog=deps.openGuestDialog;
    original=deps.original;
    paxDotsHTML=deps.paxDotsHTML;
    paxOf=deps.paxOf;
    render=deps.render;
    RULES=deps.RULES;
    seatTagHTML=deps.seatTagHTML;
    t=deps.t;
    tableIndex=deps.tableIndex;
    ui=deps.ui;
    return{guestsHTML,bindGuests};
  }
  globalThis.MeritScreenGuests=Object.freeze({create,DEPS:Object.freeze(["activeEvent","additionalOf","app","downloadExcelTemplate","esc","filteredGuests","icon","openExcelWizard","openGuestDialog","original","paxDotsHTML","paxOf","render","RULES","seatTagHTML","t","tableIndex","ui"])});
})();
