// The Seating screen: the guest queue, Smart Seating's options and preview,
// the freeze panel, its form and the override challenge, the table card and
// its seat rows, and the bindings for all of them.
//
// Moved byte-for-byte out of app-v8.js on 2026-10-04 (technical gaps, item 2),
// at the original indentation. The edits forced by the move: seatingHTML,
// selectedTablePanelHTML, seatRowHTML and bindSeating become this module's own
// functions (app-v8.js keeps the overrides and calls through). What stayed in
// the shell, deliberately, because each one WRITES or is the gate every write
// runs: assignGuestGroup / assignGuestToTable (through MeritSeatAssignment),
// freezeBlocks and challengeFreeze, the freeze writers (createFreezeFromDraft,
// liftFreeze, authoriseFreezeOverride), setTableAvailability,
// toggleAssignmentLock and unassignGuest. This module renders and binds; the
// Apply button's one line into assignGuestToTable() is still the only way a
// Smart Seating option becomes a seat. Also stayed: the two reason-text
// helpers the audit trail reads.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that).
(() => {
  "use strict";
  let activeEvent;
  let assignGuestGroup;
  let assignGuestToTable;
  let authoriseFreezeOverride;
  let AVAIL;
  let availReasonText;
  let bindPanelToggles;
  let canMutate;
  let canSeat;
  let canvasEmptyHTML;
  let canvasViewportHTML;
  let createFreezeFromDraft;
  let esc;
  let eventFreezes;
  let formatTableNumber;
  let FREEZE;
  let freezeReasonText;
  let icon;
  let liftFreeze;
  let logicalSeatCount;
  let naturalSort;
  let onboardingCalloutHTML;
  let paxDotsHTML;
  let paxOf;
  let recordUndo;
  let render;
  let resolvedFreezes;
  let resolvedUnavailable;
  let RULES;
  let seatingCapacity;
  let seatingQueueEmptyHTML;
  let setTableAvailability;
  let t;
  let tableAssignedPax;
  let tableIndex;
  let tableSeatMap;
  let toast;
  let toggleAssignmentLock;
  let touchEvent;
  let ui;
  let unassignGuest;
  let v8Toolbar;
  let created=false;

  function guestSelectionRows(event){
    const q=ui.seatingQuery.trim().toLocaleLowerCase("tr"),showAll=ui.seatingGuestScope==="all";
    if(!q)return event.guests.filter(g=>showAll||!g.assignment);
    const byId=tableIndex(event);
    return event.guests.filter(g=>(showAll||!g.assignment)&&
      [g.name,g.vip,g.invitedBy,g.planningStatus,byId.get(g.assignment?.tableId)?.number]
        .join(" ").toLocaleLowerCase("tr").includes(q));
  }
  const SEAT_QUEUE_STEP=150;
  const seatingHTML = function(event){
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
    const freeChairs=Math.max(0,seatingCapacity(event)-seatedPax);
    const byId=tableIndex(event);
    // WINDOWED, like the Guests list and the door (§26: the queue mounted
    // every unassigned guest, so at 3,000 guests Seating was 23,833 DOM nodes
    // of which the drawing was 5,601). Keyed on scope + query: whatever
    // changes either — a search, a scope button, the finder's CHANGE TABLE —
    // starts again from the top without every writer having to remember.
    const qKey=ui.seatingGuestScope+"\n"+ui.seatingQuery;
    if(!ui.seatQueueWindow||ui.seatQueueWindow.key!==qKey)ui.seatQueueWindow={key:qKey,n:SEAT_QUEUE_STEP};
    const shownRecords=records.slice(0,ui.seatQueueWindow.n),hiddenRecords=records.length-shownRecords.length;
    const queue=records.length?shownRecords.map(g=>{
      const t_=g.assignment&&byId.get(g.assignment.tableId);
      return`<div class="queue-card ${selectedIds.includes(g.id)?"selected multi-selected":""}" draggable="true" data-seating-guest="${g.id}" tabindex="0" role="button" aria-pressed="${selectedIds.includes(g.id)?"true":"false"}">
        <div class="party-name">${esc(g.name)}</div>
        <div class="party-sub">${paxDotsHTML(g)}<span>${t("guests.partyOf",{n:paxOf(g)})}</span>${g.vip&&g.vip!=="Standard"?`<span class="vip-tag">${esc(g.vip)}</span>`:""}${t_?`<span class="seat-tag">${esc(formatTableNumber(t_.number))}</span>`:""}</div>
      </div>`;
    }).join("")+(hiddenRecords>0?`<div class="live-more seat-queue-more"><span>${t("seating.showingOf",{shown:shownRecords.length,total:records.length})}</span><button class="btn sm" data-seating-action="queue-more">${t("guests.showMore")}</button></div>`:""):`<div class="mx-empty" style="border:none;background:none;padding:26px 12px">${seatingQueueEmptyHTML(event)}</div>`;
    return`<div class="seat-stage">
      <aside class="seat-queue">
        <div class="seat-queue-head"><strong>${ui.seatingGuestScope==="all"?t("seating.allGuests"):t("seating.guestQueue")}</strong>${selectedIds.length?`<span class="sel">${t("seating.recordsSelected",{n:selectedIds.length,pax:selPax})}</span>`:""}</div>
        <div class="seat-queue-controls">
          <div class="guest-scope-strip">${scopes.map(([v,l])=>`<button class="seg-btn ${ui.seatingGuestScope===v?"active":""}" data-seating-scope="${v}">${l}</button>`).join("")}</div>
          <div class="guest-filter-strip">${filters.map(([v,l])=>`<button class="seg-btn ${ui.seatingFilter===v?"active":""}" data-seating-filter="${v}">${l}</button>`).join("")}</div>
          <input class="filter-input" id="seatingSearch" value="${esc(ui.seatingQuery)}" placeholder="${t("seating.search")}">
        </div>
        <div class="seat-queue-list">${queue}</div>
        <div class="seat-advice">${smartSeatingHTML(event)}${freezePanelHTML(event)}</div>
      </aside>
      <section class="seat-canvas-col">
        ${v8Toolbar(event,true)}
        ${canvasViewportHTML(event,true)}
        ${event.tables.length?"":canvasEmptyHTML(t("empty.seating.title"),t("empty.seating.body"),
          RULES().isHistorical(event)?"":`<button class="btn primary" data-empty-action="go-floor">${t("empty.goFloor")}</button>`)}
        ${selectedTablePanelHTML(event)}
        ${seatingPreviewHTML(event)}
        <div class="seat-pill">${t("seating.statusPill",{seated:seatedPax,total:totalPax,tables:event.tables.length,free:freeChairs})}</div>
        ${freezeChallengeHTML(event)}
      </section>
    </div>`;
  };
  // ---- SMART SEATING --------------------------------------------------------
  //
  // Recommendations, a preview, and an Apply that goes through the SAME
  // assignGuestToTable() a drag-and-drop does. src/seating-advisor.js cannot
  // write an assignment at all; this is the only place its output can become a
  // mutation, and only a person pressing Apply does it.
  //
  // The whole design rests on that one boundary. "Smart seating" is where a
  // product starts quietly moving guests because it was confident, and the
  // structure here makes that impossible rather than merely discouraged.
  function seatingAdvice(event,guest){
    if(!guest||!globalThis.MeritSeatingAdvisor)return null;
    return globalThis.MeritSeatingAdvisor.recommend({
      guest,tables:event.tables,guests:event.guests,limit:4,
      // Resolved, not the rules. Passing an ARRAY (even an empty one) is what
      // tells the advisor the constraint was evaluated; passing nothing would
      // leave it honestly saying "not set up yet".
      frozen:resolvedFreezes(event)||undefined,
      unavailable:resolvedUnavailable(event)||undefined});
  }
  function reasonText(r){
    const k="seat.reason."+r;
    return t(k)!==k?t(k):r;
  }
  function smartSeatingHTML(event){
    const guest=event.guests.find(g=>g.id===ui.selectedGuestId);
    if(!guest||RULES().isHistorical(event))return"";
    const advice=seatingAdvice(event,guest);
    if(!advice)return"";
    const head=`<div class="ss-head"><strong>${t("seat.smartTitle")}</strong><span>${
      esc(t("seat.forGuest",{name:guest.name,pax:paxOf(guest)}))}</span></div>${onboardingCalloutHTML("smartSeating")}`;
    // A locked assignment is a person's decision and outranks anything this
    // layer could propose, so nothing is proposed at all — said, not hidden.
    if(advice.locked)
      return`<aside class="smart-seating">${head}<p class="ss-empty">${t("seat.lockedNote")}</p></aside>`;
    if(!advice.options.length){
      // "No table fits" reads as a broken feature unless it says WHY -- a room
      // that is mostly frozen or failed tonight is a real, explainable state,
      // not silence the operator has to go investigate on their own.
      const frozenCount=advice.blocked.filter(b=>b.why==="FROZEN").length;
      const unavailCount=advice.blocked.filter(b=>b.why==="UNAVAILABLE").length;
      const why=[
        frozenCount?t("seat.noneFitFrozen",{n:frozenCount}):"",
        unavailCount?t("seat.noneFitUnavailable",{n:unavailCount}):"",
      ].filter(Boolean).join(" ");
      return`<aside class="smart-seating">${head}<p class="ss-empty">${
        t("seat.noneFit",{pax:paxOf(guest),tables:advice.considered})}${
        why?` ${why}`:""}</p></aside>`;
    }
    const rows=advice.options.map(o=>`<li class="ss-option${
      ui.seatPreview&&ui.seatPreview.tableId===o.tableId?" active":""}">
      <div class="ss-option-head"><b>${esc(formatTableNumber(o.number))}</b><span>${
        esc(t("seat.freeOf",{free:o.free,capacity:o.capacity}))}${o.zone?` · ${esc(o.zone)}`:""}</span></div>
      <ul class="ss-why">${o.reasons.map(r=>`<li>${esc(reasonText(r))}</li>`).join("")}</ul>
      <button class="btn sm" data-seat-preview="${esc(o.tableId)}">${t("seat.previewImpact")}</button>
    </li>`).join("");
    return`<aside class="smart-seating">${head}
      <ol class="ss-options">${rows}</ol>
      <p class="ss-note">${t("seat.recommendationOnly")}</p>
    </aside>`;
  }
  // WHAT WOULD CHANGE — computed, never promised. Nothing has moved when this
  // is on screen; the numbers come from the advisor reading the same room.
  function seatingPreviewHTML(event){
    if(!ui.seatPreview||RULES().isHistorical(event))return"";
    const guest=event.guests.find(g=>g.id===ui.seatPreview.guestId);
    if(!guest)return"";
    const p=globalThis.MeritSeatingAdvisor?.previewMove({
      guest,tables:event.tables,guests:event.guests,toTableId:ui.seatPreview.tableId,
      frozen:resolvedFreezes(event)||undefined,
      unavailable:resolvedUnavailable(event)||undefined});
    if(!p)return"";
    const line=(label,before,after)=>`<div class="sp-row"><em>${esc(label)}</em><b>${
      before}</b><i>&rarr;</i><b>${after}</b></div>`;
    const notConfigured=t("seat.notConfigured");
    return`<aside class="seat-preview">
      <div class="sp-head"><strong>${t("seat.impactTitle")}</strong><span>${
        esc(t("seat.impactSub",{name:guest.name,pax:p.guest.pax}))}</span></div>
      <div class="sp-body">
        ${p.from?line(t("seat.tableLabel",{number:formatTableNumber(p.from.number)}),
          `${p.from.before}/${p.from.capacity}`,`${p.from.after}/${p.from.capacity}`):
          `<div class="sp-row"><em>${t("seat.currently")}</em><b>${t("seat.noTable")}</b></div>`}
        ${line(t("seat.tableLabel",{number:formatTableNumber(p.to.number)}),
          `${p.to.before}/${p.to.capacity}`,`${p.to.after}/${p.to.capacity}`)}
        ${line(t("seat.reserve"),p.reserve.before,p.reserve.after)}
        <div class="sp-row"><em>${t("seat.affected")}</em><b>${
          esc(affectedText(p.affectedGuests,p.affectedPax))}</b></div>
        ${p.hostGuestsAlreadyAtTarget?`<div class="sp-row"><em>${t("seat.cohesion")}</em><b>${
          esc(t("seat.cohesionValue",{n:p.hostGuestsAlreadyAtTarget}))}</b></div>`:""}
        ${(p.constraints||[]).map(c=>`<div class="sp-row ${
          c.state==="FROZEN"||c.state==="UNAVAILABLE"?"is-frozen":""}"><em>${esc(t("seat.constraint."+c.constraint))}</em><b>${
          esc(t("freeze.state."+c.state))}</b></div>`).join("")}
        ${p.unevaluated.map(u=>`<div class="sp-row muted"><em>${
          esc(t("seat.constraint."+u.constraint))}</em><b>${esc(notConfigured)}</b></div>`).join("")}
      </div>
      <div class="sp-foot">
        <span class="sp-nothing">${t("seat.nothingYet")}</span>
        <button class="btn sm" data-seat-cancel>${t("seat.cancel")}</button>
        <button class="btn sm primary" data-seat-apply>${t("seat.apply")}</button>
      </div>
    </aside>`;
  }
  function bindSmartSeating(){
    const event=activeEvent();
    document.querySelectorAll("[data-seat-preview]").forEach(b=>b.onclick=()=>{
      ui.seatPreview={guestId:ui.selectedGuestId,tableId:b.dataset.seatPreview};
      render();
    });
    const cancel=document.querySelector("[data-seat-cancel]");
    if(cancel)cancel.onclick=()=>{ui.seatPreview=null;render();};
    const apply=document.querySelector("[data-seat-apply]");
    if(apply)apply.onclick=()=>{
      const p=ui.seatPreview;if(!p)return;
      if(!canMutate(event,"seat a guest"))return;
      recordUndo(event);
      ui.seatPreview=null;
      // The same function a drag-and-drop calls. The advisor has no path to it
      // and never did: this line is the only way a recommendation becomes a
      // seat, and it runs because a person pressed Apply.
      assignGuestToTable(p.guestId,p.tableId);
    };
  }

  const freezeReasons=()=>["VIP_AREA","HEAD_TABLES","SPONSOR_TABLES","MANAGEMENT_HOLD","LATE_ARRIVAL_RESERVE","OTHER"];
  function freezeScopeText(event,f){
    if(f.scope==="ZONE")return t("freeze.scope.zoneOf",{zone:f.zone});
    if(f.scope==="TABLE"){
      const tb=(event.tables||[]).find(x=>x.id===f.tableId);
      return t("freeze.scope.tableOf",{number:tb?formatTableNumber(tb.number):"—"});
    }
    const pad=n=>`${f.prefix}${String(n).padStart(2,"0")}`;
    return t("freeze.scope.rangeOf",{from:formatTableNumber(pad(f.from)),to:formatTableNumber(pad(f.to))});
  }

  // "2 record - 5 pax" is the kind of small wrongness that makes an operator
  // trust the rest of the card less. Picked in JS because the substituter does
  // not do plurals and should not learn to.
  const affectedText=(guests,pax)=>t(guests===1?"seat.affectedValue":"seat.affectedValue.n",{guests,pax});
  function zonesInPlan(event){
    return [...new Set((event.tables||[]).map(x=>String(x.zone||"").trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,"tr"));
  }
  // Extracted so the field-commit handler can refresh JUST this box after a
  // zone/prefix/from/to edit, without a full render() -- re-rendering the
  // whole form on every keystroke would replace the input DOM nodes
  // themselves and throw the caret out of whichever field is being typed
  // into, the exact thing the field-commit handler's own comment warns
  // against for the note field.
  function freezeCoveragePreviewHTML(event,d){
    const F=FREEZE();
    if(!F||!d)return"";
    // A freeze holds SEATS, so what it can cover is every table that can
    // seat somebody -- whether or not the drawing depicted the chairs.
    const allSeatable=(event.tables||[]).filter(canSeat);
    const previewCovered=F.tablesCovered({...d,id:"__preview__"},event.tables||[]);
    const previewSeatable=previewCovered.filter(canSeat);
    const previewChairs=previewSeatable.reduce((n,x)=>n+(Number(x.capacity)||0),0);
    const coversAll=allSeatable.length>0&&previewSeatable.length>=allSeatable.length;
    return!previewCovered.length
      ?`<p class="freeze-preview freeze-preview-empty">${t("freeze.previewNone")}</p>`
      :`<p class="freeze-preview ${coversAll?"freeze-preview-all":""}">${t("freeze.preview",
          {tables:previewSeatable.length,total:allSeatable.length,chairs:previewChairs})}</p>${
        coversAll?`<p class="freeze-preview freeze-preview-all">${t("freeze.previewAll")}</p>`:""}`;
  }
  function freezeFormHTML(event){
    const d=ui.freezeDraft;
    if(!d)return"";
    const zones=zonesInPlan(event);
    const scopes=[["ZONE",t("freeze.scope.ZONE")],["TABLE_GROUP",t("freeze.scope.TABLE_GROUP")],["TABLE",t("freeze.scope.TABLE")]];
    const tables=[...(event.tables||[])].sort((a,b)=>naturalSort(a.number,b.number));
    // Live scope preview, computed from the draft exactly as it stands right
    // now -- so the fast path (open the form, touch nothing, click Freeze)
    // shows what it is about to hold back before it holds it back, not after.
    const previewHTML=`<div id="freezePreviewBox">${freezeCoveragePreviewHTML(event,d)}</div>`;
    return`<form class="freeze-form" data-freeze-form>
      <div class="field"><label for="fzScope">${t("freeze.field.scope")}</label>
        <select id="fzScope" data-freeze-field="scope">${scopes.map(([v,l])=>
          `<option value="${v}" ${d.scope===v?"selected":""}>${esc(l)}</option>`).join("")}</select></div>
      ${d.scope==="ZONE"?`<div class="field"><label for="fzZone">${t("freeze.field.zone")}</label>${
        zones.length?`<select id="fzZone" data-freeze-field="zone">${zones.map(z=>
          `<option value="${esc(z)}" ${d.zone===z?"selected":""}>${esc(z)}</option>`).join("")}</select>`
        :`<input id="fzZone" data-freeze-field="zone" value="${esc(d.zone||"")}" placeholder="${esc(t("freeze.field.zonePlaceholder"))}">`}</div>`:""}
      ${d.scope==="TABLE_GROUP"?`<div class="freeze-range">
        <div class="field"><label for="fzPrefix">${t("freeze.field.prefix")}</label><input id="fzPrefix" data-freeze-field="prefix" maxlength="4" value="${esc(d.prefix||"")}"></div>
        <div class="field"><label for="fzFrom">${t("freeze.field.from")}</label><input id="fzFrom" data-freeze-field="from" type="number" min="0" max="9999" value="${Number(d.from)||0}"></div>
        <div class="field"><label for="fzTo">${t("freeze.field.to")}</label><input id="fzTo" data-freeze-field="to" type="number" min="0" max="9999" value="${Number(d.to)||0}"></div>
      </div>`:""}
      ${d.scope==="TABLE"?`<div class="field"><label for="fzTable">${t("freeze.field.table")}</label>
        <select id="fzTable" data-freeze-field="tableId">${tables.map(x=>
          `<option value="${x.id}" ${d.tableId===x.id?"selected":""}>${esc(formatTableNumber(x.number))}</option>`).join("")}</select></div>`:""}
      <div class="field"><label for="fzReason">${t("freeze.field.reason")}</label>
        <select id="fzReason" data-freeze-field="reason">${freezeReasons().map(r=>
          `<option value="${r}" ${d.reason===r?"selected":""}>${esc(freezeReasonText(r))}</option>`).join("")}</select></div>
      <div class="field"><label for="fzNote">${t("freeze.field.note")}</label>
        <input id="fzNote" data-freeze-field="note" value="${esc(d.note||"")}" placeholder="${esc(t("freeze.field.notePlaceholder"))}"></div>
      ${previewHTML}
      <div class="freeze-form-actions">
        <button type="button" class="btn sm" data-freeze-action="cancel-form">${t("freeze.cancel")}</button>
        <button type="button" class="btn sm primary" data-freeze-action="create">${t("freeze.create")}</button>
      </div>
    </form>`;
  }
  function freezePanelHTML(event){
    const F=FREEZE();
    if(!F||RULES().isHistorical(event))return"";
    const raw=eventFreezes(event);
    const list=F.normalizeAll(raw);
    if(!list.length&&!ui.freezeDraft)
      return`<aside class="freeze-panel">
        <div class="fz-head"><strong>${t("freeze.title")}</strong></div>
        ${onboardingCalloutHTML("freezeZones")}
        <p class="fz-empty">${t("freeze.none")}</p>
        <button class="btn sm" data-freeze-action="open-form">${t("freeze.add")}</button>
      </aside>`;
    const held=F.heldCapacity(raw,event.tables||[],event.guests||[]);
    const rows=list.map(f=>{
      const covered=F.tablesCovered(f,event.tables||[]);
      const chairs=covered.filter(canSeat).reduce((n,x)=>n+logicalSeatCount(x),0);
      return`<li class="fz-row">
        <div class="fz-row-head"><b>${esc(freezeScopeText(event,f))}</b><span class="fz-reason">${esc(freezeReasonText(f.reason))}</span></div>
        <div class="fz-row-sub">${esc(t("freeze.covers",{tables:covered.length,chairs}))}${
          f.note?` · ${esc(f.note)}`:""}</div>
        <button class="btn sm" data-freeze-lift="${esc(f.id)}">${t("freeze.lift")}</button>
      </li>`;
    }).join("");
    return`<aside class="freeze-panel">
      <div class="fz-head"><strong>${t("freeze.title")}</strong><span>${
        esc(t("freeze.heldSummary",{chairs:held.chairs,open:held.open}))}</span></div>
      <ul class="fz-list">${rows}</ul>
      ${ui.freezeDraft?freezeFormHTML(event)
        :`<button class="btn sm" data-freeze-action="open-form">${t("freeze.add")}</button>`}
      <p class="fz-note">${t("freeze.panelNote")}</p>
    </aside>`;
  }
  // SUPERVISOR OVERRIDE REQUIRED. The operation is described, never performed:
  // nothing has moved while this is on screen, and Cancel leaves the room
  // exactly as it was. An override authorises THIS operation and nothing else
  // — the freeze is still standing afterwards, which is what "never silently
  // unlock" means in code rather than in a sentence.
  function freezeChallengeHTML(event){
    const c=ui.freezeChallenge;
    if(!c||RULES().isHistorical(event))return"";
    const r=c.report;
    const dir=r.directions.map(d=>t("freeze.direction."+d)).join(" · ");
    const what=r.freezes.map(f=>`<li>
      <b>${esc(freezeScopeText(event,f))}</b>
      <span>${esc(freezeReasonText(f.reason))}</span>
      ${f.note?`<em>${esc(f.note)}</em>`:""}
    </li>`).join("");
    const impact=r.tables.map(x=>`<div class="fc-row"><em>${
      esc(t("seat.tableLabel",{number:formatTableNumber(x.number)}))}</em><b>${
      x.before}/${x.capacity}</b><i>&rarr;</i><b>${x.after}/${x.capacity}</b></div>`).join("");
    return`<div class="freeze-challenge-scrim" data-freeze-scrim>
      <aside class="freeze-challenge" role="alertdialog" aria-labelledby="fcTitle">
        <div class="fc-head"><strong id="fcTitle">${t("freeze.overrideRequired")}</strong><span>${esc(dir)}</span></div>
        <div class="fc-body">
          <div class="fc-block"><h4>${t("freeze.whatIsFrozen")}</h4><ul class="fc-what">${what}</ul></div>
          <div class="fc-block"><h4>${t("freeze.affected")}</h4>
            <div class="fc-row"><em>${t("freeze.beingMoved")}</em><b>${
              esc(affectedText(r.movingRecords,r.movingPax))}</b></div>
            <div class="fc-row"><em>${t("freeze.alreadyInArea")}</em><b>${
              esc(affectedText(r.guestsInArea,r.paxInArea))}</b></div>
          </div>
          <div class="fc-block"><h4>${t("freeze.impact")}</h4>${impact}
            <div class="fc-row"><em>${t("freeze.heldChairs")}</em><b>${r.held.open}</b><i>&rarr;</i><b>${r.heldAfter.open}</b></div>
          </div>
        </div>
        <div class="fc-foot">
          <span class="fc-nothing">${t("freeze.nothingYet")}</span>
          <button class="btn sm" data-freeze-action="cancel-override">${t("seat.cancel")}</button>
          <button class="btn sm danger" data-freeze-action="override">${t("freeze.override")}</button>
        </div>
        <p class="fc-stays">${t("freeze.staysInPlace")}</p>
      </aside>
    </div>`;
  }

  function bindFreezeZones(){
    const event=activeEvent();
    document.querySelectorAll("[data-freeze-action]").forEach(b=>b.onclick=()=>{
      const action=b.dataset.freezeAction;
      if(action==="layer"){ui.freezeLayer=!ui.freezeLayer;render();}
      else if(action==="open-form"){
        const zones=zonesInPlan(event);
        const first=[...(event.tables||[])].sort((a,b)=>naturalSort(a.number,b.number))[0];
        const parsed=first&&FREEZE()?FREEZE().parseTableNumber(first.number):null;
        ui.freezeDraft={scope:zones.length?"ZONE":"TABLE_GROUP",zone:zones[0]||"",
          prefix:parsed?parsed.prefix:"T",from:parsed?parsed.n:1,to:parsed?parsed.n:1,
          tableId:ui.selectedTableId||(first?first.id:""),reason:"MANAGEMENT_HOLD",note:""};
        render();
      }
      else if(action==="cancel-form"){ui.freezeDraft=null;render();}
      else if(action==="create")createFreezeFromDraft();
      else if(action==="cancel-override"){ui.freezeChallenge=null;render();}
      else if(action==="override")authoriseFreezeOverride();
    });
    const loadBtn=document.querySelector("[data-load-layer]");
    if(loadBtn)loadBtn.onclick=()=>{ui.loadLayer=!ui.loadLayer;render();};
    document.querySelectorAll("[data-freeze-lift]").forEach(b=>b.onclick=()=>liftFreeze(b.dataset.freezeLift));
    // Fields whose value changes which tables the draft covers -- the coverage
    // preview box is refreshed directly for these, never via a full render(),
    // so typing in fzPrefix/fzFrom/fzTo never throws the caret out mid-edit.
    const COVERAGE_FIELDS=new Set(["zone","prefix","from","to","tableId"]);
    document.querySelectorAll("[data-freeze-field]").forEach(el=>{
      const commit=()=>{
        if(!ui.freezeDraft)return;
        const key=el.dataset.freezeField;
        ui.freezeDraft[key]=el.type==="number"?Number(el.value):el.value;
        // The scope field changes which OTHER fields the form shows at all,
        // so it alone needs the full form rebuilt.
        if(key==="scope"){render();return;}
        if(COVERAGE_FIELDS.has(key)){
          const box=document.getElementById("freezePreviewBox");
          if(box)box.innerHTML=freezeCoveragePreviewHTML(event,ui.freezeDraft);
        }
      };
      if(el.tagName==="SELECT")el.onchange=commit; else el.oninput=commit;
    });
    // Escape closes the challenge without authorising anything. A blocking
    // card with no keyboard way out is how an operator ends up clicking the
    // dangerous button to make it go away.
    const scrim=document.querySelector("[data-freeze-scrim]");
    if(scrim){
      scrim.onclick=e=>{if(e.target===scrim){ui.freezeChallenge=null;render();}};
      const btn=scrim.querySelector("[data-freeze-action='cancel-override']");
      if(btn)btn.focus();
    }
  }

  // Contextual card, not a permanent inspector: it exists only while a table
  // is selected, and closing it hands the space back to the plan.
  const selectedTablePanelHTML = function(event){
    const t_=event.tables.find(x=>x.id===ui.selectedTableId);
    if(!t_)return"";
    const map=tableSeatMap(event,t_.id),occupied=tableAssignedPax(event,t_.id),empty=Math.max(0,t_.capacity-occupied);
    const selected=event.guests.find(g=>g.id===ui.selectedGuestId);
    const moving=selected&&selected.assignment&&selected.assignment.tableId!==t_.id;
    // Said on the card, not only on the canvas: the layer can be switched off,
    // and an operator about to press "Seat here" has to know what will happen.
    const F=FREEZE();
    const onIt=F?F.freezesOnTable(eventFreezes(event),t_):[];
    // A fact about the table, distinct from the freeze above: a freeze says
    // the PLACE is off-limits to the seating process until a person allows
    // it, and can be overridden for one move. Unavailable says the TABLE
    // ITSELF cannot be used tonight, and this card offers no override for it.
    const A=AVAIL();
    const unavailable=A&&A.isUnavailable(t_);
    const stranded=unavailable?Array.from({length:t_.capacity},(_,i)=>map.get(i)).filter(o=>o&&o.index===0):[];
    return`<aside class="table-card">
      <div class="table-card-head"><h3>${esc(formatTableNumber(t_.number))}</h3><span class="muted" style="font-size:11px">${esc(t_.zone||"")}</span><button class="table-card-close" data-close-table-card title="${t("seating.closeCard")}">&times;</button></div>
      ${onIt.length?`<div class="table-card-frozen">${icon("lock")}<b>${t("freeze.state.FROZEN")}</b><span>${
        esc(onIt.map(f=>freezeReasonText(f.reason)).join(" · "))}</span></div>`:""}
      ${unavailable?`<div class="table-card-unavailable">${icon("alert")}<b>${t("avail.state.UNAVAILABLE")}</b><span>${
        esc(availReasonText(t_.unavailableReason))}${t_.unavailableNote?` · ${esc(t_.unavailableNote)}`:""}</span></div>
        ${stranded.length?`<div class="table-card-stranded"><span>${esc(t(stranded.length===1?"avail.stranded.1":"avail.stranded",{n:stranded.length,pax:stranded.reduce((n,o)=>n+paxOf(o.guest),0)}))}</span>${
          stranded.map(o=>`<button class="btn sm" data-avail-select-guest="${o.guest.id}">${esc(o.guest.name)} — ${t("avail.relocate")}</button>`).join("")}</div>`:""}
      `:""}
      <div class="table-card-stats">
        <div><span>${t("seating.capacity")}</span><b>${t_.capacity}</b></div>
        <div><span>${t("seating.occupied")}</span><b>${occupied}</b></div>
        <div><span>${t("seating.empty")}</span><b>${empty}</b></div>
      </div>
      ${A?`${unavailable?"":onboardingCalloutHTML("tableAvailability")}<div class="table-card-avail">${unavailable
        ?`<button class="btn sm" data-avail-mark="${t_.id}" data-avail-next="AVAILABLE">${t("avail.markAvailable")}</button>`
        :`<select data-avail-reason required aria-label="${esc(t("avail.reasonLabel"))}"><option value="" disabled selected>${esc(t("avail.reason.CHOOSE"))}</option>${Object.keys(A.REASON).map(r=>
            `<option value="${r}">${esc(availReasonText(r))}</option>`).join("")}</select>
          <button class="btn sm danger" data-avail-mark="${t_.id}" data-avail-next="UNAVAILABLE">${t("avail.markUnavailable")}</button>`
      }</div>`:""}
      <div class="table-card-cta">${selected
        ?`<button class="btn primary sm ${unavailable?"is-blocked":""}" data-assign-selected="${t_.id}" title="${unavailable?esc(t("avail.cannotSeatHere")):""}">${t(moving?"seating.moveGuest":"seating.assignGuest",{name:selected.name,n:paxOf(selected)})}</button>`
        :`<div class="table-card-hint">${t("seating.pickGuestFirst")}</div>`}</div>
      <div class="table-card-seats">${Array.from({length:t_.capacity},(_,i)=>seatRowHTML(i,map.get(i),selected)).join("")}</div>
    </aside>`;
  };
  const seatRowHTML = function(index,occupant,selected){
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

  const bindSeating = function(){
    bindPanelToggles();const event=activeEvent(),records=guestSelectionRows(event),search=document.getElementById("seatingSearch");
    // Focus and caret come back synchronously — the next-frame version
    // reordered fast typing, as §23 measured at the door and §26 here.
    if(search){search.oninput=()=>{ui.seatingQuery=search.value;const pos=search.selectionStart;render();const n=document.getElementById("seatingSearch");if(n){n.focus();n.setSelectionRange(pos,pos);}};}
    const queueMore=document.querySelector("[data-seating-action='queue-more']");
    if(queueMore)queueMore.onclick=()=>{
      ui.seatQueueWindow.n+=SEAT_QUEUE_STEP;
      const list=document.querySelector(".seat-queue-list"),keep=list?list.scrollTop:0;
      render();
      const again=document.querySelector(".seat-queue-list");if(again)again.scrollTop=keep;
      (document.querySelector("[data-seating-action='queue-more']")||document.getElementById("seatingSearch"))?.focus({preventScroll:true});
    };
    const closeCard=document.querySelector("[data-close-table-card]");
    if(closeCard)closeCard.onclick=()=>{ui.selectedTableId=null;render();};
    document.querySelectorAll("[data-seating-scope]").forEach(b=>b.onclick=()=>{ui.seatingGuestScope=b.dataset.seatingScope;ui.selectedGuestIds=[];ui.selectedGuestId=null;render();});document.querySelectorAll("[data-seating-filter]").forEach(b=>b.onclick=()=>{ui.seatingFilter=b.dataset.seatingFilter;ui.operationalMode=false;render();});
    document.querySelectorAll("[data-seating-guest]").forEach(row=>{row.onclick=e=>{selectGuestRecord(row.dataset.seatingGuest,e,records);render();};row.ondragstart=e=>{if(!ui.selectedGuestIds.includes(row.dataset.seatingGuest))ui.selectedGuestIds=[row.dataset.seatingGuest];e.dataTransfer.setData("application/x-merit-guests",JSON.stringify(ui.selectedGuestIds));e.dataTransfer.setData("application/x-merit-guest",row.dataset.seatingGuest);};});
    document.querySelectorAll("[data-occupant-guest]").forEach(row=>{if(!row.dataset.occupantGuest)return;row.onclick=e=>{selectGuestRecord(row.dataset.occupantGuest,e,event.guests);render();};row.ondragstart=e=>{if(!ui.selectedGuestIds.includes(row.dataset.occupantGuest))ui.selectedGuestIds=[row.dataset.occupantGuest];e.dataTransfer.setData("application/x-merit-guests",JSON.stringify(ui.selectedGuestIds));};});
    // The table card's primary button. It was rendered by this file and bound
    // only by the OLD bindSeating in app-guests.js, which this file replaces --
    // so the most prominent control on the card had no handler at all and did
    // nothing when pressed. Found while building the freeze gate, which sits on
    // exactly this path.
    const assign=document.querySelector("[data-assign-selected]");
    if(assign)assign.onclick=()=>{
      const ids=ui.selectedGuestIds.length?ui.selectedGuestIds:[ui.selectedGuestId].filter(Boolean);
      if(ids.length)assignGuestGroup(ids,assign.dataset.assignSelected);
    };
    document.querySelectorAll("[data-empty-seat]").forEach(row=>row.onclick=()=>{const ids=ui.selectedGuestIds.length?ui.selectedGuestIds:[ui.selectedGuestId].filter(Boolean);if(ids.length)assignGuestGroup(ids,ui.selectedTableId,Number(row.dataset.emptySeat));});document.querySelectorAll("[data-unassign]").forEach(b=>b.onclick=()=>unassignGuest(b.dataset.unassign));document.querySelectorAll("[data-lock-assignment]").forEach(b=>b.onclick=()=>toggleAssignmentLock(b.dataset.lockAssignment));
    // Mark unavailable / mark available — the table card's own axis, next to
    // the freeze indicator but never touching it: marking a table unavailable
    // writes nothing but `availability` and its provenance.
    const availBtn=document.querySelector("[data-avail-mark]");
    if(availBtn)availBtn.onclick=()=>{
      const ev=activeEvent();if(!canMutate(ev,"change a table's availability"))return;
      const table=ev.tables.find(x=>x.id===availBtn.dataset.availMark);if(!table)return;
      const next=availBtn.dataset.availNext;
      const reasonEl=document.querySelector("[data-avail-reason]");
      if(next==="UNAVAILABLE"&&reasonEl&&!reasonEl.value){toast(t("avail.reasonRequiredToast"),"error");return;}
      setTableAvailability(ev,table,next,reasonEl?reasonEl.value:null);
      touchEvent(ev);render();
      toast(t(next==="UNAVAILABLE"?"avail.markedUnavailableToast":"avail.markedAvailableToast",
        {number:formatTableNumber(table.number)}),next==="UNAVAILABLE"?"error":"success");
    };
    // Selecting a stranded guest reuses the exact selection Smart Seating
    // already reads — this never moves anyone; it only shows recommendations
    // for the person selected, the same as picking them from the queue.
    document.querySelectorAll("[data-avail-select-guest]").forEach(b=>b.onclick=()=>{
      ui.selectedGuestId=b.dataset.availSelectGuest;ui.selectedGuestIds=[b.dataset.availSelectGuest];render();
    });
  };

  function create(deps){
    if(created)throw new Error("MeritScreenSeating.create() is called once, by app-v8.js.");
    created=true;
    activeEvent=deps.activeEvent;
    assignGuestGroup=deps.assignGuestGroup;
    assignGuestToTable=deps.assignGuestToTable;
    authoriseFreezeOverride=deps.authoriseFreezeOverride;
    AVAIL=deps.AVAIL;
    availReasonText=deps.availReasonText;
    bindPanelToggles=deps.bindPanelToggles;
    canMutate=deps.canMutate;
    canSeat=deps.canSeat;
    canvasEmptyHTML=deps.canvasEmptyHTML;
    canvasViewportHTML=deps.canvasViewportHTML;
    createFreezeFromDraft=deps.createFreezeFromDraft;
    esc=deps.esc;
    eventFreezes=deps.eventFreezes;
    formatTableNumber=deps.formatTableNumber;
    FREEZE=deps.FREEZE;
    freezeReasonText=deps.freezeReasonText;
    icon=deps.icon;
    liftFreeze=deps.liftFreeze;
    logicalSeatCount=deps.logicalSeatCount;
    naturalSort=deps.naturalSort;
    onboardingCalloutHTML=deps.onboardingCalloutHTML;
    paxDotsHTML=deps.paxDotsHTML;
    paxOf=deps.paxOf;
    recordUndo=deps.recordUndo;
    render=deps.render;
    resolvedFreezes=deps.resolvedFreezes;
    resolvedUnavailable=deps.resolvedUnavailable;
    RULES=deps.RULES;
    seatingCapacity=deps.seatingCapacity;
    seatingQueueEmptyHTML=deps.seatingQueueEmptyHTML;
    setTableAvailability=deps.setTableAvailability;
    t=deps.t;
    tableAssignedPax=deps.tableAssignedPax;
    tableIndex=deps.tableIndex;
    tableSeatMap=deps.tableSeatMap;
    toast=deps.toast;
    toggleAssignmentLock=deps.toggleAssignmentLock;
    touchEvent=deps.touchEvent;
    ui=deps.ui;
    unassignGuest=deps.unassignGuest;
    v8Toolbar=deps.v8Toolbar;
    return{seatingHTML,selectedTablePanelHTML,seatRowHTML,bindSeating,bindFreezeZones,bindSmartSeating};
  }
  globalThis.MeritScreenSeating=Object.freeze({create,DEPS:Object.freeze(["activeEvent","assignGuestGroup","assignGuestToTable","authoriseFreezeOverride","AVAIL","availReasonText","bindPanelToggles","canMutate","canSeat","canvasEmptyHTML","canvasViewportHTML","createFreezeFromDraft","esc","eventFreezes","formatTableNumber","FREEZE","freezeReasonText","icon","liftFreeze","logicalSeatCount","naturalSort","onboardingCalloutHTML","paxDotsHTML","paxOf","recordUndo","render","resolvedFreezes","resolvedUnavailable","RULES","seatingCapacity","seatingQueueEmptyHTML","setTableAvailability","t","tableAssignedPax","tableIndex","tableSeatMap","toast","toggleAssignmentLock","touchEvent","ui","unassignGuest","v8Toolbar"])});
})();
