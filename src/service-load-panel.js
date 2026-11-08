// The service-load panel: the per-table band map the canvas draws and the
// panel the Command Center shows, memoised per event, mutation epoch and mode.
// Moved out of app-v8.js on 2026-11-08 (code health, capability 5 of 21,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs; the section comment below travelled with it.
// The arithmetic is src/service-load.js's (bands per table, no routes, no
// distances, PLANNED vs LIVE); this file computes nothing of its own. The edit
// forced by the move: the shell's mutation counter is read through
// getMutationEpoch(), because the shell increments it.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let RULES;
  let esc;
  let formatTableNumber;
  let getMutationEpoch;
  let t;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritServiceLoadPanel.create() is called once, by app-v8.js.");
    created=true;
    RULES=deps.RULES;
    esc=deps.esc;
    formatTableNumber=deps.formatTableNumber;
    getMutationEpoch=deps.getMutationEpoch;
    t=deps.t;
  // ---- SERVICE LOAD ---------------------------------------------------------
  //
  // src/service-load.js owns the arithmetic. The canvas draws bands, the
  // Command Center states the totals, and neither computes anything of its own.
  //
  // PLANNED on the Floor Plan, LIVE once the doors are open: the same layer
  // answers a different question in each, because a No Show's chairs are
  // physically free tonight while the plan correctly still shows them taken.
  let loadMemo={event:null,epoch:-1,mode:null,load:null};
  function serviceLoad(event,mode){
    const SL=globalThis.MeritServiceLoad;
    if(!SL||!event)return null;
    const m=mode||(RULES().phase(event)==="live"?SL.MODE.LIVE:SL.MODE.PLANNED);
    if(loadMemo.event===event&&loadMemo.epoch===getMutationEpoch()&&loadMemo.mode===m)return loadMemo.load;
    loadMemo={event,epoch:getMutationEpoch(),mode:m,
      load:SL.build({tables:event.tables||[],guests:event.guests||[],
        venueObjects:event.venueObjects||[],mode:m})};
    return loadMemo.load;
  }
  // tableObjectHTML runs once per table, so the band is looked up rather than
  // recomputed — same reason the frozen set is memoised.
  function loadBandMap(event){
    const l=serviceLoad(event);
    if(!l)return null;
    if(!loadMemo.bands||loadMemo.bandsFor!==l)
      {loadMemo.bands=new Map(l.tables.map(r=>[r.tableId,r]));loadMemo.bandsFor=l;}
    return loadMemo.bands;
  }
  function loadBandText(band){const k="load.band."+band;return t(k)!==k?t(k):band;}
  function serviceLoadHTML(event,{compact=false}={}){
    const l=serviceLoad(event);
    if(!l)return"";
    const SL=globalThis.MeritServiceLoad;
    const zones=l.zones.filter(z=>z.capacity>0).slice(0,compact?4:8);
    const rows=zones.map(z=>`<div class="sl-zone">
      <em>${esc(z.zone||t("load.noZone"))}</em>
      <span class="sl-bar"><i class="sl-fill band-${z.band}" style="width:${
        z.capacity?Math.round(z.pax/z.capacity*100):0}%"></i></span>
      <b>${z.pax}/${z.capacity}</b>
      <span class="sl-band band-${z.band}">${esc(loadBandText(z.band))}</span>
    </div>`).join("");
    // What it cannot see, from the engine's own list rather than a sentence
    // typed here — so an aspect that ships stops being listed by itself.
    const blind=l.notEvaluated.map(x=>t("load.notEvaluated."+x.aspect))
      .filter((v,i)=>v!=="load.notEvaluated."+l.notEvaluated[i].aspect);
    const service=l.servicePoints.known
      ?`<p class="sl-service">${esc(t("load.servicePoints",{n:l.servicePoints.count}))}${
        l.farthestFromService.length?` ${esc(t("load.farthest",{
          number:formatTableNumber(l.farthestFromService[0].number)}))}`:""}</p>`
      :`<p class="sl-service muted">${t("load.noServicePoints")}</p>`;
    return`<section class="service-load ${compact?"compact":""}">
      <div class="sl-head"><div><strong>${t("load.title")}</strong><p>${
        t(l.mode===SL.MODE.LIVE?"load.questionLive":"load.questionPlanned")}</p></div>
        <span class="sl-total">${l.room.seated}/${l.room.chairs}</span></div>
      ${rows?`<div class="sl-zones">${rows}</div>`:`<p class="sl-empty">${t("load.nothing")}</p>`}
      ${service}
      ${blind.length?`<p class="sl-blind">${esc(t("load.doesNotCover",{aspects:blind.join(", ")}))}</p>`:""}
    </section>`;
  }
    return{loadBandMap,serviceLoadHTML};
  }
  globalThis.MeritServiceLoadPanel=Object.freeze({create,DEPS:Object.freeze(["RULES","esc","formatTableNumber","getMutationEpoch","t"])});
})();
