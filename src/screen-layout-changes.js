// The Floor Plan's layout-change mode: what has moved since the room was
// published, card by card, with the operator's confirmation of each change.
// Moved out of app-v8.js on 2026-11-08 (code health, capability 8 of 21,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs; the section comment below travelled with it.
// The rules and the comparison are MeritVenueModel's (identity by verified
// table number, then position, never visual similarity); this file is the
// screen and the one confirmation write, refused on a historical event. The
// edit forced by the move: `state` is read through getState().
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let FLOORPLAN;
  let RULES;
  let VENUE;
  let activeEvent;
  let audit;
  let canMutate;
  let canvasViewportHTML;
  let esc;
  let getState;
  let nowISO;
  let render;
  let t;
  let touchEvent;
  let ui;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritScreenLayoutChanges.create() is called once, by app-v8.js.");
    created=true;
    FLOORPLAN=deps.FLOORPLAN;
    RULES=deps.RULES;
    VENUE=deps.VENUE;
    activeEvent=deps.activeEvent;
    audit=deps.audit;
    canMutate=deps.canMutate;
    canvasViewportHTML=deps.canvasViewportHTML;
    esc=deps.esc;
    getState=deps.getState;
    nowISO=deps.nowISO;
    render=deps.render;
    t=deps.t;
    touchEvent=deps.touchEvent;
    ui=deps.ui;
  // ---- LAYOUT CHANGES -------------------------------------------------------
  //
  // What has moved since the room was published, as a MODE of the Floor Plan
  // rather than a screen of its own: the plan stays the hero and the changes
  // sit on it. The rules -- which version this event is compared to, what a
  // confirmation is keyed on -- and the comparison itself are MeritVenueModel's
  // (eventSourceVersion, changesSinceSource, confirmationKey,
  // compareToVersion); what follows is the screen.
  function layoutChangesHTML(event){
    return`<div class="planmap-shell in-changes">${FLOORPLAN.planMapToolbarHTML(event)}${
      canvasViewportHTML(event,false)}${layoutChangePanelHTML(event)}${layoutChangeCardHTML(event)}</div>`;
  }
  function changeLabel(c){
    const k="changes.type."+c.type;
    return t(k)!==k?t(k):c.type;
  }
  // Before and after, only where the change actually has two values. MOVED has
  // none — it is a position, and "before: null → after: null" is noise dressed
  // as information; the distance in its evidence line is the real statement.
  function changeValuesHTML(c){
    if(c.before==null&&c.after==null)return"";
    const show=v=>v==null?"—":String(v);
    return`<span class="lc-values">${esc(show(c.before))} <i>&rarr;</i> ${esc(show(c.after))}</span>`;
  }
  function layoutChangePanelHTML(event){
    const d=VENUE().changesSinceSource(getState(),event);
    if(!d)return"";
    const seen=event.layoutChangesSeen||{};
    const rows=d.changes.map(c=>{
      const id=VENUE().confirmationKey(d.source.version.id,c);
      const confirmed=!!seen[id];
      const uncertain=c.identity.confidence==="UNCERTAIN";
      const conf=t("changes.confidence."+c.identity.confidence);
      const selected=ui.selectedChangeId===id;
      // Only an UNCERTAIN change offers a confirmation. A table matched by its
      // own number is not a claim an operator needs to ratify, and asking them
      // to tick 40 certainties would make the ticks meaningless on the four
      // that matter.
      const act=uncertain&&!confirmed&&!RULES().isHistorical(event)
        ?`<button class="btn sm" data-change-confirm="${esc(id)}">${t("changes.confirm")}</button>`
        :confirmed?`<span class="lc-confirmed">${t("changes.confirmed")}</span>`:"";
      return`<li class="lc-row ${c.type} ${selected?"selected":""} ${confirmed?"is-confirmed":""}" data-change-select="${esc(id)}">
        <span class="lc-type">${esc(changeLabel(c))}</span>
        <span class="lc-key">${esc(c.key)}</span>
        ${changeValuesHTML(c)}
        <span class="lc-conf ${c.identity.confidence}">${esc(conf)}</span>
        ${act}</li>`;
    }).join("");
    const src=d.source;
    return`<aside class="layout-changes">
      <div class="lc-head">
        <div><strong>${t("changes.title")}</strong><span>${esc(t("changes.comparedTo",{
          version:src.version.label,layout:src.layout.name}))}</span></div>
        <span class="lc-count">${d.changes.length}</span>
      </div>
      ${d.changes.length?`<ul class="lc-rows">${rows}</ul>`
        :`<p class="lc-empty">${t("changes.none")}</p>`}
    </aside>`;
  }
  // The contextual card: previous, current, how confident, and on what evidence.
  // Same shape as the review inspector, because it answers the same question
  // about a different kind of claim.
  function layoutChangeCardHTML(event){
    const d=VENUE().changesSinceSource(getState(),event);
    if(!d||!ui.selectedChangeId)return"";
    const c=d.changes.find(x=>VENUE().confirmationKey(d.source.version.id,x)===ui.selectedChangeId);
    if(!c)return"";
    const by=t("changes.identity."+c.identity.by);
    return`<div class="poi-card lc-card">
      <div class="poi-card-head"><strong>${esc(c.key)}</strong><span>${esc(changeLabel(c))}</span></div>
      <div class="lc-card-body">
        <div class="lc-pair"><em>${t("changes.before")}</em><b>${esc(c.before==null?"—":String(c.before))}</b></div>
        <div class="lc-pair"><em>${t("changes.after")}</em><b>${esc(c.after==null?"—":String(c.after))}</b></div>
        <div class="lc-pair"><em>${t("changes.confidenceLabel")}</em><b>${esc(t("changes.confidence."+c.identity.confidence))}</b></div>
        <div class="lc-pair"><em>${t("changes.identityLabel")}</em><b>${esc(by===("changes.identity."+c.identity.by)?c.identity.by:by)}</b></div>
        <p class="lc-evidence">${esc(c.identity.detail||"")}</p>
      </div>
    </div>`;
  }
  function confirmLayoutChange(event,id){
    if(!canMutate(event,"confirm a layout change"))return;
    event.layoutChangesSeen={...(event.layoutChangesSeen||{}),[id]:nowISO()};
    audit(event,"LAYOUT_CHANGE_CONFIRMED",{change:id});
    touchEvent(event);render();
  }
  function bindLayoutChanges(){
    const event=activeEvent();
    document.querySelectorAll("[data-change-select]").forEach(row=>row.onclick=e=>{
      if(e.target.closest("[data-change-confirm]"))return;
      const id=row.dataset.changeSelect;
      ui.selectedChangeId=ui.selectedChangeId===id?null:id;
      // Selecting a change highlights the object it is about, on the plan the
      // operator is already looking at. That is the whole overlay: no second
      // drawing, no ghost of the old layout on top of the new one.
      const d=VENUE().changesSinceSource(getState(),event);
      const c=d&&d.changes.find(x=>VENUE().confirmationKey(d.source.version.id,x)===ui.selectedChangeId);
      ui.highlightId=c?(c.tableIdAfter||c.tableIdBefore||null):null;
      render();
    });
    document.querySelectorAll("[data-change-confirm]").forEach(b=>b.onclick=()=>
      confirmLayoutChange(event,b.dataset.changeConfirm));
  }
    return{bindLayoutChanges,layoutChangesHTML};
  }
  globalThis.MeritScreenLayoutChanges=Object.freeze({create,DEPS:Object.freeze(["FLOORPLAN","RULES","VENUE","activeEvent","audit","canMutate","canvasViewportHTML","esc","getState","nowISO","render","t","touchEvent","ui"])});
})();
