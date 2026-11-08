// The two writers of the room's live facts: setArrival — the ONE writer of
// guest.arrivalStatus / checkedInAt, with its audit line — and
// setTableAvailability — the ONE writer of table.availability — plus the live
// region that announces a status change and the door's recent-changes list.
// Moved out of app-v8.js on 2026-11-08 (code health, capability 6 of 21,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs; the section comments below travelled with
// them. The rules are not this file's: MeritArrivalWave.arrivalTransition and
// MeritTableAvailability.availabilityTransition decide, this file applies and
// audits (`writer-transitions`, `domain-writers`). Planning status and the
// planned seat are never written here.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let AVAIL;
  let RULES;
  let audit;
  let nowISO;
  let t;
  let ui;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritArrivalWriter.create() is called once, by app-v8.js.");
    created=true;
    AVAIL=deps.AVAIL;
    RULES=deps.RULES;
    audit=deps.audit;
    nowISO=deps.nowISO;
    t=deps.t;
    ui=deps.ui;
  // ---- THE ARRIVAL AXIS, IN ONE PLACE ---------------------------------------
  //
  // Four call sites used to write arrivalStatus independently — the Live Enter
  // key, the Live status buttons, the Live undo, and the guest finder — each
  // with its own audit line and none of them recording WHEN. Four writers of
  // one fact is how the fact drifts, and it is why the product could not draw
  // an arrival curve it believed: the audit is capped at a thousand entries and
  // a three-thousand-guest door would have overflowed it.
  //
  // So the moment lives on the guest record, next to the status it belongs to,
  // and exactly one function maintains the pair. It writes the arrival axis and
  // NOTHING else: planningStatus and the planned seat are separate facts and
  // are not touched here, in either direction.
  // The rule of change is MeritArrivalWave.arrivalTransition; this writes its
  // answer and the audit entry, and nothing else writes the arrival axis.
  function setArrival(event,guest,next,source){
    if(!event||!guest||RULES().mutationRefusal(event))return null;
    const from=guest.arrivalStatus;
    const change=globalThis.MeritArrivalWave.arrivalTransition(guest,next,nowISO());
    if(!change)return null;
    guest.arrivalStatus=change.arrivalStatus;
    guest.checkedInAt=change.checkedInAt;
    audit(event,"ARRIVAL_STATUS_CHANGED",{guestId:guest.id,from,to:next,
      at:guest.checkedInAt||null,source:source||"live"});
    return{from,to:next};
  }

  // ---- TABLE AVAILABILITY, THE SAME WAY: ONE WRITER --------------------------
  //
  // Same discipline as setArrival(): one function maintains `availability`
  // and its provenance fields together, so the reason and the moment can
  // never drift from the state they describe. Marking a table unavailable
  // touches NOTHING else — no assignment, no capacity, no chairs — the whole
  // point of this axis being separate from every other fact about the table.
  function setTableAvailability(event,table,next,reason,note){
    if(!event||!table||RULES().mutationRefusal(event))return null;
    const A=AVAIL();
    const change=A&&A.availabilityTransition(table,next,reason,note,nowISO());
    if(!change)return null;
    const from=table.availability||A.STATE.AVAILABLE;
    Object.assign(table,change);
    audit(event,"TABLE_AVAILABILITY_CHANGED",{tableId:table.id,from,to:next,
      reason:table.unavailableReason});
    return{from,to:next};
  }

  // ONE LIVE REGION FOR STATUS CHANGES, outside #app so render() never
  // replaces it: a region created in the same moment as its content is not
  // announced, and the recent-arrivals strip is rebuilt with the whole screen
  // on every check-in. It carries only THE CHANGE -- "AYŞE KAYA: Checked In" --
  // never the re-rendered list, and it is polite: a door check-in must not
  // interrupt whatever the screen reader was saying. Errors are the
  // assertive channel, and that is the toast's own role="alert".
  const announcer=(()=>{
    let el=document.getElementById("a11yAnnouncer");
    if(!el){el=document.createElement("div");el.id="a11yAnnouncer";el.className="sr-only";
      el.setAttribute("role","status");el.setAttribute("aria-live","polite");el.setAttribute("aria-atomic","true");
      document.body.appendChild(el);}
    return el;
  })();
  // Cleared first and set a tick later, so announcing the same words twice in
  // a row (two guests of the same name, one after the other) is still a change.
  function announce(text){announcer.textContent="";setTimeout(()=>{announcer.textContent=text;},40);}
  function recordArrival(g,from,to){
    if(from!==to)announce(t("a11y.arrivalChanged",{name:g.name,status:t("status.arrival."+to)}));
    if(!ui.liveRecent)ui.liveRecent=[];
    ui.liveRecent=ui.liveRecent.filter(r=>r.guestId!==g.id);
    if(from!==to)ui.liveRecent.unshift({guestId:g.id,name:g.name,from,to});
    ui.liveRecent=ui.liveRecent.slice(0,6);
  }
    return{recordArrival,setArrival,setTableAvailability};
  }
  globalThis.MeritArrivalWriter=Object.freeze({create,DEPS:Object.freeze(["AVAIL","RULES","audit","nowISO","t","ui"])});
})();
