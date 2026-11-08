// The empty states that say what to do next (§20): the Floor Plan without a
// plan or tables, the plan waiting for Analyse, Live with nobody to show, the
// Seating queue with nobody left — each names what is missing and carries the
// control for the next step. Moved out of app-v8.js on 2026-11-08 (code health,
// capability 9 of 21, benchmarks/CODE-HEALTH-2026-11.md), at the original
// indentation, by scripts/extract-capability.mjs; the section comment below
// travelled with it. Presentation only: it reads the event and writes nothing.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let RULES;
  let esc;
  let icon;
  let render;
  let t;
  let ui;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritEmptyStates.create() is called once, by app-v8.js.");
    created=true;
    RULES=deps.RULES;
    esc=deps.esc;
    icon=deps.icon;
    render=deps.render;
    t=deps.t;
    ui=deps.ui;
  // ---- EMPTY STATES THAT SAY WHAT TO DO NEXT (§20) -------------------------
  // A blank canvas used to be a blank panel: the only sentence telling the
  // operator what to do was the toast raised when the event was created --
  // the transient carrier §17 ruled out for anything that stays true. Each
  // empty state now names what is missing and carries the control for the
  // next step. The card lets clicks through everywhere but itself.
  function canvasEmptyHTML(title,body,actions,cardAttrs=""){
    return`<div class="canvas-empty" data-canvas-empty role="status"><div class="canvas-empty-card"${cardAttrs}><b>${esc(title)}</b><span>${esc(body)}</span>${actions?`<div class="canvas-empty-actions">${actions}</div>`:""}</div></div>`;
  }
  function floorEmptyHTML(event){
    if(event.tables.length||(event.venueObjects||[]).length||event.background?.src||RULES().isHistorical(event))return"";
    if(ui.v8AddOpen||ui.repeatPlacement)return"";   // already adding: the card would sit in the way
    return canvasEmptyHTML(t("empty.floor.title"),t("empty.floor.body"),
      `<button class="btn primary" data-v8-action="replace-bg">${icon("image")}${t("empty.floor.import")}</button><button class="btn" data-v8-action="add">${icon("plus")}${t("action.addManually")}</button><small class="canvas-empty-drop">${esc(t("empty.floor.drop"))}</small>`,
      // SPEC-v4: the card is also where a plan file can be dropped (the same
      // #floorPlanFile import as the button; bound in bindPlanDrop).
      ` data-plan-drop`);
  }
  // A plan that is in the room but was never analysed: ONE clear "Analiz et"
  // — the existing Assisted Detection (data-v8-action="detect"), whose
  // suggestions are then accepted or rejected one by one in review.
  function floorAnalyseHTML(event){
    if(!event.background?.src||event.analysis||ui.analysisBusy||RULES().isHistorical(event))return"";
    return`<div class="plan-analyse-strip" data-plan-analyse role="status"><span><b>${esc(t("salon.analyse.title"))}</b> ${esc(t("salon.analyse.body"))}</span><button class="btn primary" data-v8-action="detect">${esc(t("salon.analyse.go"))}</button></div>`;
  }
  // "Everyone has arrived" was shown whenever the list was empty -- but the
  // list includes checked-in guests, so it is empty only when there are no
  // guests at all or a filter matches nobody. It was never true where shown.
  function liveEmptyHTML(event,q){
    if(q)return`<h3>${t("live.noResults")}</h3>`;
    if(!event.guests.length)return`<h3>${t("empty.noGuests")}</h3>${RULES().isHistorical(event)?"":`<button class="btn primary" data-empty-action="go-guests">${t("empty.goGuests")}</button>`}`;
    return`<h3>${t("live.waveEmpty")}</h3>`;
  }
  // "No matching guest records" was shown for three different situations; only
  // one of them involves matching.
  function seatingQueueEmptyHTML(event){
    if(!event.guests.length)return`<p>${t("empty.noGuests")}</p>${RULES().isHistorical(event)?"":`<button class="btn sm" data-empty-action="go-guests">${t("empty.goGuests")}</button>`}`;
    if(ui.seatingQuery.trim())return t("seating.noMatches");
    if(ui.seatingGuestScope!=="all")return`<p>${t("seating.allSeated")}</p><button class="btn sm" data-empty-action="seating-scope-all">${t("seating.showAll")}</button>`;
    return t("seating.noMatches");
  }
  document.addEventListener("click",e=>{
    const b=e.target.closest&&e.target.closest("[data-empty-action]");
    if(!b)return;
    const a=b.dataset.emptyAction;
    if(a==="go-floor"){ui.tab="floor";ui.planMode="plan";render();}
    else if(a==="go-guests"){ui.tab="guests";render();}
    else if(a==="seating-scope-all"){ui.seatingGuestScope="all";render();}
  });

  // The changes view is the SAME canvas — same toolbar, same plan, same tables.
  // Only the outlines and the panel are added, because "the original plan
  // remains the hero" is not a slogan: a second canvas that redrew the room
  // from the diff would be a different drawing of the same night, and the
  // operator would be comparing the product's picture rather than their own.
    return{canvasEmptyHTML,floorAnalyseHTML,floorEmptyHTML,liveEmptyHTML,seatingQueueEmptyHTML};
  }
  globalThis.MeritEmptyStates=Object.freeze({create,DEPS:Object.freeze(["RULES","esc","icon","render","t","ui"])});
})();
