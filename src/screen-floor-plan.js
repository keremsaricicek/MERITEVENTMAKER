// The Floor Plan's chrome: the mode switch (plan / review / changes), the
// floating toolbar, the seat and review pills, the contextual card for a
// selected object, the Add-manually button, the shared canvas toolbar the
// Seating screen also uses, and the Add-to-plan panel.
//
// Moved byte-for-byte out of app-v8.js on 2026-10-04 (technical gaps, item 2),
// at the original indentation. The edits forced by the move: `state` is read
// through getState() (the shell reassigns it), UNVERIFIED_SEATING through
// getUnverifiedSeating() (app-v8.js declares it further down its IIFE, so a
// value captured at create() would not exist yet), and the nine names the
// shell still uses are reached as FLOORPLAN.name. What stayed in the shell,
// deliberately: the canvas itself — drawing, fitting, the first-view fit,
// dragging, marquee, the bulk placement maths — and every writer it calls
// (commitBulk, duplicate, delete, capacity, confirming a layout change).
// This module renders; it moves nothing.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that).
(() => {
  "use strict";
  let esc;
  let eventFreezes;
  let formatTableNumber;
  let getState;
  let getUnverifiedSeating;
  let icon;
  let reviewGroupCount;
  let shownCols;
  let t;
  let tableAssignedPax;
  let tableProvenanceHTML;
  let toolbarBtn;
  let ui;
  let VENUE;
  let ZONES;
  let created=false;

  function planModeSwitchHTML(event){
    const changes=VENUE().changesSinceSource(getState(),event);
    if(!event.background?.src&&!changes)return"";
    const b=(mode,label)=>`<button class="${ui.planMode===mode?"active":""}" data-plan-mode="${mode}"${
      ui.planMode===mode?' aria-current="true"':""}>${label}</button>`;
    // The third mode appears only where there is a previous version to compare
    // against. An event that was never taken from a published layout has no
    // "since when" to answer, and an empty tab that is always there teaches an
    // operator to stop looking at it.
    return`<div class="planmode-switch" role="group" aria-label="${esc(t("plan.mode.label"))}">${
      event.background?.src?b("plan",t("plan.mode.plan"))+b("review",t("plan.mode.review")):""}${
      changes?b("changes",t("plan.mode.changes")):""}</div>`;
  }
  // Shared by both canvases: the Floor Plan is where an operator reads the
  // room spatially, and Seating is where they act on occupancy, so the toggle
  // belongs on both toolbars rather than only where it was easiest to add.
  // Offered only where there is occupancy to show -- an empty room has no
  // load, and a permanent toggle for an empty layer teaches an operator to
  // stop reading the toolbar, the same rule the freeze layer and the changes
  // mode follow.
  function loadLayerToolHTML(event){
    return(event.tables||[]).length&&(event.guests||[]).some(g=>g.assignment)
      ?`<div class="tool-group">${toolbarBtn("users",t("load.layer"),`data-load-layer`,ui.loadLayer)}</div>`:"";
  }
  function planMapToolbarHTML(event){
    const bg=event.background||{};
    // The language toggle used to live here AND in the review screen's own top
    // bar -- a global setting owned by two screen-local toolbars, and absent
    // from every other screen. It is in the workspace header now, with the rest
    // of the controls that are about the application rather than the drawing.
    // The switch decides for itself whether it has anything to offer: a plan to
    // review, a published version to compare against, or both. Gating the group
    // on a background image instead meant an event with a layout history and no
    // imported drawing had its change view built and unreachable.
    const modes=planModeSwitchHTML(event);
    return`<div class="planmap-toolbar">${modes?`<div class="tool-group">${modes}</div>`:""}<div class="tool-group">${toolbarBtn("mouse",t("toolbar.select"),`data-tool="select"`,ui.tool==="select")}${toolbarBtn("hand",t("toolbar.pan"),`data-tool="pan"`,ui.tool==="pan")}</div>${loadLayerToolHTML(event)}<div class="tool-group">${toolbarBtn("zoomOut",t("toolbar.zoomOut"),`data-canvas-action="zoom-out"`)}<span class="zoom-label">${Math.round(ui.zoom*100)}%</span>${toolbarBtn("zoomIn",t("toolbar.zoomIn"),`data-canvas-action="zoom-in"`)}${toolbarBtn("fit",t("toolbar.fit"),`data-canvas-action="fit"`)}</div><div class="tool-group">${bg.src?toolbarBtn("eye",bg.visible?t("toolbar.hideOriginalPlan"):t("toolbar.showOriginalPlan"),`data-v8-action="toggle-bg"`,bg.visible):""}${toolbarBtn("image",t(bg.src?"toolbar.replacePlan":"toolbar.importPlan"),`data-v8-action="replace-bg"`)}</div><div class="tool-group">${toolbarBtn("fit",t("toolbar.focusMode"),`data-v8-action="focus"`,ui.focusMode)}</div>${bg.src?`<div class="tool-group">${toolbarBtn("image",t("toolbar.assistedDetection"),`data-v8-action="detect"`,false).replace('class="toolbar-btn','class="toolbar-btn ai')}</div>`:""}</div>`;
  }
  // What the pill puts where a seat count goes. On a plan whose tables are
  // drawn as symbols there is nothing to count: a bold "0 seats" in the
  // headline reads as "this room seats nobody", when the truth is that this
  // drawing does not show seats at all. The count is replaced by what kind of
  // drawing it is, and the tables — which this plan really does state — take
  // the number's place.
  function planSeatsPill(pi){
    const s=pi.planSummary||{};
    if(s.representation==="SYMBOLIC")
      return`<b>${s.tables??0}</b><small>${t("plan.symbolTables")}</small>`;
    return`<b>${s.physicalSeats??0}</b><small>${t("plan.seats")}</small>`;
  }
  // ONE answer to "how much of this plan still needs a person", for every
  // surface that asks it.
  //
  // Two pills used to compute this independently and disagree. Rendered on the
  // same event, in the same component, in the same corner of the screen, both
  // linking to the same Review Center, the product said:
  //
  //   Floor Plan tab   "37 items need review"   reviewGroups MEMBERS + questions
  //   Review screen    "6 to decide"            the Confidence Budget
  //
  // The 37 is the raw, un-collapsed count -- precisely what the Confidence
  // Budget exists to replace ("do not show the operator 50 warnings just
  // because the system has 50 uncertain facts"). Sharing one function is the
  // point: two call sites computing the same question separately is how they
  // drifted apart in the first place.
  //
  // The click attribute differs because the two surfaces are bound by different
  // binders, so it is a parameter rather than a reason to fork the function.
  function planReviewChipHTML(event,actionAttr){
    const budget=event.analysis?.confidenceBudget;
    const shown=budget?budget.counts.shown:0;
    if(shown)return`<i class="pill-div"></i><button class="pill-chip" data-${actionAttr}="open-review-center">${t("budget.chip",{n:shown})}</button>`;
    // Before an analysis has produced a budget there is still something honest
    // to say: how many groups are waiting. Never the member count.
    const pi=event.analysis?.planIntelligence;
    const groups=pi?reviewGroupCount(pi):0;
    return groups?`<i class="pill-div"></i><button class="pill-chip" data-${actionAttr}="open-review-center">${groups} ${t(groups===1?"review.group":"review.groups")}</button>`:"";
  }
  function planStatusPillHTML(event){
    const pi=event.analysis?.planIntelligence;if(!pi)return"";
    return`<div class="planmap-status-pill"><span>${t("plan.understood")}</span><b>${pi.planSummary.diningGroups}</b><small>${t("plan.diningGroups")}</small><i class="pill-div"></i>${planSeatsPill(pi)}${planReviewChipHTML(event,"v8-action")}</div>`;
  }
  function contextualCardHTML(event){
    const t_=event.tables.find(x=>x.id===ui.selectedObjectId),o=event.venueObjects.find(x=>x.id===ui.selectedObjectId);
    if(!t_&&!o)return"";
    // Every field this card renders edits ui.selectedObjectId ALONE, never
    // the rest of ui.selectedObjectIds -- so a canvas multi-select (bulk-add
    // just created 4 tables, a marquee caught several) must say so here,
    // rather than letting the blue multi-select outlines imply a stepper
    // click is about to change all of them.
    const alsoSelected=Math.max(0,(ui.selectedObjectIds||[]).length-1);
    const alsoSelectedHTML=alsoSelected?`<div class="contextual-card-also-selected">${t("inspector.alsoSelected",{n:alsoSelected})}</div>`:"";
    if(t_){const assigned=tableAssignedPax(event,t_.id),presets=t_.type==="round"?[6,8,10,12]:[2,4,6,8];
      // Data Provenance Inspector (Section 11): a read-only fact, never an
      // editable field -- capacitySource is set only by the writers named in
      // src/capacity-provenance.js, never chosen here.
      const provenanceHTML=tableProvenanceHTML(t_);
      return`<aside class="contextual-card"><div class="contextual-card-head"><strong>${esc(formatTableNumber(t_.number))}</strong><span>${esc(t_.zone)} · ${assigned} ${t("seating.occupied").toLowerCase()}</span></div>${alsoSelectedHTML}<div class="seat-editor"><div class="seat-stepper"><button data-seat-step="-1" title="${t("inspector.removeSeat")}">−</button><b>${t_.capacity}</b><button data-seat-step="1" title="${t("inspector.addSeat")}">+</button></div><div class="seat-presets">${presets.map(n=>`<button class="${t_.capacity===n?"active":""}" data-seat-capacity="${n}">${n}</button>`).join("")}<button data-seat-custom>${t("inspector.custom")}</button></div></div><div class="form-grid compact"><div class="field full"><label for="fld-inspector-number">${t("inspector.tableNumber")}</label><input id="fld-inspector-number" data-inspector="number" value="${esc(t_.number)}" maxlength="12" autocomplete="off" spellcheck="false"></div><div class="field"><label for="fld-inspector-type">${t("inspector.type")}</label><select id="fld-inspector-type" data-inspector="type">${["rectangle","square","round","bistro"].map(x=>`<option value="${x}" ${t_.type===x?"selected":""}>${t("bulk.type."+x)}</option>`).join("")}</select></div><div class="field"><label for="fld-inspector-rotation">${t("inspector.rotation")}</label><input id="fld-inspector-rotation" data-inspector="rotation" type="number" value="${Math.round(t_.rotation||0)}"></div><div class="field full"><label for="fld-inspector-zone">${t("inspector.zone")}</label><select id="fld-inspector-zone" data-inspector="zone">${ZONES.map(z=>`<option ${t_.zone===z?"selected":""}>${z}</option>`).join("")}</select></div></div>${provenanceHTML}<div class="contextual-card-actions"><button class="btn sm" data-inspector-action="duplicate">${icon("copy")}${t("toolbar.duplicate")}</button><button class="btn sm" data-inspector-action="lock">${icon("lock")}${t_.locked?t("seating.unlock"):t("seating.lock")}</button><button class="btn sm danger" data-inspector-action="delete">${icon("trash")}${t("toolbar.delete")}</button></div></aside>`;
    }
    // Sofa/bench/banquette pax cannot be read off a drawing, so its seat
    // count is either a person's verified number or explicitly unverified --
    // never silently treated as zero. Same provenance discipline as capacity.
    const seatProvenanceHTML=getUnverifiedSeating().has(o.type)&&o.seatsConfidence?`<div class="contextual-card-provenance"><span>${t("poi.seatsOnThis")}</span><b>${o.seats==null?t("poi.seatsUnset"):o.seats}</b><i>${t(o.seatsConfidence==="verified"?"inspector.seatsVerified":"inspector.seatsUnverified")}</i></div>`:"";
    return`<aside class="contextual-card"><div class="contextual-card-head"><strong>${esc(o.label)}</strong><span>${t("inspector.object",{type:t("bulk.type."+o.type)})}</span></div>${alsoSelectedHTML}<div class="form-grid compact"><div class="field full"><label for="fld-inspector-label">${t("inspector.label")}</label><input id="fld-inspector-label" data-inspector="label" value="${esc(o.label)}"></div><div class="field"><label for="fld-inspector-rotation-2">${t("inspector.rotation")}</label><input id="fld-inspector-rotation-2" data-inspector="rotation" type="number" value="${Math.round(o.rotation||0)}"></div></div>${seatProvenanceHTML}<div class="contextual-card-actions"><button class="btn sm" data-inspector-action="duplicate">${icon("copy")}${t("toolbar.duplicate")}</button><button class="btn sm" data-inspector-action="lock">${icon("lock")}${o.locked?t("seating.unlock"):t("seating.lock")}</button><button class="btn sm danger" data-inspector-action="delete">${icon("trash")}${t("toolbar.delete")}</button></div></aside>`;
  }
  function addManuallyFabHTML(){return`<button class="planmap-fab" data-v8-action="add" title="${t("action.addManually")}">${icon(ui.v8AddOpen?"x":"plus")}<span>${t("action.addManually")}</span></button>`;}

  function v8Toolbar(event,seating=false){
    // The FREEZE ZONES layer button appears only where there is something to
    // show. A permanent toggle for an empty layer is how a toolbar teaches an
    // operator to stop reading it -- same rule as the Layout Changes mode.
    const freezeLayerBtn=eventFreezes(event).length
      ?`<div class="tool-group">${toolbarBtn("lock",t("freeze.layer"),`data-freeze-action="layer"`,ui.freezeLayer)}</div>`:"";
    return`<div class="canvas-toolbar v8-toolbar"><div class="tool-group">${toolbarBtn("mouse",t("toolbar.select"),`data-tool="select"`,ui.tool==="select")}${toolbarBtn("hand",t("toolbar.pan"),`data-tool="pan"`,ui.tool==="pan")}</div>${freezeLayerBtn}${loadLayerToolHTML(event)}${!seating?`<div class="tool-group">${toolbarBtn("plus",t("toolbar.addBulk"),`data-v8-action="add"`,ui.v8AddOpen)}${toolbarBtn("copy",t("toolbar.duplicate"),`data-v8-action="duplicate-selection"`)}${toolbarBtn("trash",t("toolbar.delete"),`data-v8-action="delete-selection"`)}</div><div class="tool-group">${toolbarBtn("undo",t("toolbar.undo"),`data-canvas-action="undo"`)}${toolbarBtn("redo",t("toolbar.redo"),`data-canvas-action="redo"`)}</div>`:""}<div class="tool-group">${toolbarBtn("zoomOut",t("toolbar.zoomOut"),`data-canvas-action="zoom-out"`)}<span class="zoom-label">${Math.round(ui.zoom*100)}%</span>${toolbarBtn("zoomIn",t("toolbar.zoomIn"),`data-canvas-action="zoom-in"`)}${toolbarBtn("fit",t("toolbar.fit"),`data-canvas-action="fit"`)}</div><div class="tool-group">${toolbarBtn("grid",t("toolbar.grid"),`data-canvas-action="grid"`,ui.grid)}${toolbarBtn("magnet",t("toolbar.snap"),`data-canvas-action="snap"`,ui.snap)}${toolbarBtn("seat",t("toolbar.seatLabels"),`data-canvas-action="seat-numbers"`,ui.showSeats)}</div><span class="toolbar-spacer"></span>${!seating?toolbarBtn("image",t("toolbar.assistedDetection"),`data-v8-action="detect" ${event.background?.src?"":"disabled"}`,false).replace('class="toolbar-btn','class="toolbar-btn ai'):""}${toolbarBtn("fit",t("toolbar.focusMode"),`data-v8-action="focus"`,ui.focusMode)}</div>`;
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
    return`<div class="v8-create-pop"><h3>${t("bulk.title")}</h3><p>${t("bulk.subtitle")}</p><div class="bulk-grid"><div class="field"><label for="fld-bulk-kind">${t("bulk.kind")}</label><select id="fld-bulk-kind" data-bulk="kind"><option value="table" ${d.kind==="table"?"selected":""}>${t("bulk.kind.table")}</option><option value="venue" ${d.kind==="venue"?"selected":""}>${t("bulk.kind.venue")}</option></select></div><div class="field"><label for="fld-bulk-type">${t("bulk.type")}</label><select id="fld-bulk-type" data-bulk="type">${typeValues.map(v=>opt(v,d.type)).join("")}</select></div>${d.kind==="table"?`<div class="field"><label for="fld-bulk-chairs">${t("bulk.chairsEach")}</label><input id="fld-bulk-chairs" data-bulk="chairs" type="number" min="1" max="99" value="${d.chairs}"></div><div class="field"><label for="fld-bulk-prefix">${t("bulk.numberPrefix")}</label><input id="fld-bulk-prefix" data-bulk="prefix" value="${esc(d.prefix)}" maxlength="4"></div>`:""}<div class="field"><label for="fld-bulk-quantity">${t("bulk.quantity")}</label><input id="fld-bulk-quantity" data-bulk="quantity" type="number" min="1" max="60" value="${d.quantity}"></div><div class="field"><label for="fld-bulk-placement">${t("bulk.placement")}</label><select id="fld-bulk-placement" data-bulk="placement">${placeValues.map(v=>`<option value="${v}" ${d.placement===v?"selected":""}>${t("bulk.placement."+v)}</option>`).join("")}</select></div><div class="field"><label for="fld-bulk-rows">${t("bulk.rows")}</label><input id="fld-bulk-rows" data-bulk="rows" type="number" min="1" max="12" value="${d.rows}"></div><div class="field"><label for="fld-bulk-cols">${t("bulk.columns")}</label><input id="fld-bulk-cols" data-bulk="cols" type="number" min="1" max="12" value="${shownCols(d)}"></div></div><div class="bulk-actions"><button class="btn sm" data-v8-action="close-add">${t("bulk.cancel")}</button><button class="btn sm primary" data-v8-action="commit-add">${t(d.placement==="repeated"?"bulk.startPlacement":"bulk.addToPlan")}</button></div></div>`;
  }

  function create(deps){
    if(created)throw new Error("MeritScreenFloorPlan.create() is called once, by app-v8.js.");
    created=true;
    esc=deps.esc;
    eventFreezes=deps.eventFreezes;
    formatTableNumber=deps.formatTableNumber;
    getState=deps.getState;
    getUnverifiedSeating=deps.getUnverifiedSeating;
    icon=deps.icon;
    reviewGroupCount=deps.reviewGroupCount;
    shownCols=deps.shownCols;
    t=deps.t;
    tableAssignedPax=deps.tableAssignedPax;
    tableProvenanceHTML=deps.tableProvenanceHTML;
    toolbarBtn=deps.toolbarBtn;
    ui=deps.ui;
    VENUE=deps.VENUE;
    ZONES=deps.ZONES;
    return{addManuallyFabHTML,bulkPanel,contextualCardHTML,planMapToolbarHTML,planModeSwitchHTML,planReviewChipHTML,planSeatsPill,planStatusPillHTML,v8Toolbar};
  }
  globalThis.MeritScreenFloorPlan=Object.freeze({create,DEPS:Object.freeze(["esc","eventFreezes","formatTableNumber","getState","getUnverifiedSeating","icon","reviewGroupCount","shownCols","t","tableAssignedPax","tableProvenanceHTML","toolbarBtn","ui","VENUE","ZONES"])});
})();
