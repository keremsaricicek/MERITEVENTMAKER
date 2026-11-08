// A guest record out of the event and back, and a guest off their table and
// back: deleteGuest and unassignGuest with their Undo, the shared
// removeGuestRecord/restoreGuestRecord steps (the F8 assistant's undo uses the
// same two), the guest dialog's opener, and the guest's past on that card.
// Moved out of app-v8.js on 2026-11-08 (code health, capability 3 of 21,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs. From the shell's comment it leaves behind:
// "A guest record is typed by hand or imported once; losing one to a mis-click
// is the kind of mistake a non-technical operator cannot recover from. These
// replace the thin canMutate wrappers that used to delegate to the base
// implementations -- the guard is kept, the recovery is new."
//
// It writes guest.assignment only through MeritSeatAssignment (SEAT, handed
// over) — the one writer (`assignment-writer`) — and a restore never puts two
// people on one chair: its input is planned occupancy, occupiedSeatIndexes,
// never live occupancy. deleteGuest, unassignGuest and openGuestDialog stay
// app-v8.js's overrides of the pre-v8 globals; their bodies live here and the
// shell's reassignments delegate, so `boot-contract` still sees v8's version at
// runtime. The edit forced by the move: `state` is read through getState().
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let RULES;
  let SEAT;
  let activeEvent;
  let ask;
  let audit;
  let canMutate;
  let challengeFreeze;
  let formatTableNumber;
  let freezeBlocks;
  let getState;
  let occupiedSeatIndexes;
  let original;
  let render;
  let t;
  let toast;
  let toastAction;
  let touchEvent;
  let translateStaticDialogs;
  let ui;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritGuestRecordUndo.create() is called once, by app-v8.js.");
    created=true;
    RULES=deps.RULES;
    SEAT=deps.SEAT;
    activeEvent=deps.activeEvent;
    ask=deps.ask;
    audit=deps.audit;
    canMutate=deps.canMutate;
    challengeFreeze=deps.challengeFreeze;
    formatTableNumber=deps.formatTableNumber;
    freezeBlocks=deps.freezeBlocks;
    getState=deps.getState;
    occupiedSeatIndexes=deps.occupiedSeatIndexes;
    original=deps.original;
    render=deps.render;
    t=deps.t;
    toast=deps.toast;
    toastAction=deps.toastAction;
    touchEvent=deps.touchEvent;
    translateStaticDialogs=deps.translateStaticDialogs;
    ui=deps.ui;
  // A guest out of the event and back in, without asking and without a toast:
  // deleteGuest's own steps, shared with the F8 assistant's undo. The whole
  // record is kept, including its planned assignment, so a restore puts the
  // guest back exactly where they were rather than as a fresh unassigned
  // record. Position is kept too, so the list does not reshuffle.
  function removeGuestRecord(event,g){
    const index=event.guests.indexOf(g),snapshot=JSON.parse(JSON.stringify(g));
    event.guests.splice(index,1);
    RULES().syncEventChairs(event);
    audit(event,"GUEST_DELETED",{guestId:g.id,name:g.name});
    return{index,snapshot};
  }
  // null when the guest is already back; else whether the seat was lost. The
  // seat may have been given away in the meantime. Restoring the record matters
  // more than restoring the seat, so the guest comes back either way --
  // unassigned if the seat is gone, and the caller tells the operator.
  function restoreGuestRecord(now,kept){
    const {index,snapshot}=kept;
    if(!canMutate(now,"restore a guest")||now.guests.some(x=>x.id===snapshot.id))return null;
    let seatLost=false;
    if(snapshot.assignment){
      const table=now.tables.find(x=>x.id===snapshot.assignment.tableId);
      const used=table?occupiedSeatIndexes(now,table.id):null;
      const clash=!table||(snapshot.assignment.seats||[]).some(s=>used.has(Number(s)));
      if(clash){SEAT().clear(snapshot);seatLost=true;}
    }
    now.guests.splice(Math.min(index,now.guests.length),0,snapshot);
    RULES().syncEventChairs(now);
    audit(now,"GUEST_RESTORED",{guestId:snapshot.id,name:snapshot.name});
    return seatLost;
  }
  async function deleteGuest(id){
    const event=activeEvent(),g=event&&event.guests.find(x=>x.id===id);
    if(!g||!canMutate(event,"delete a guest"))return;
    if(!(await ask({title:t("ask.deleteGuestTitle"),body:t("guests.confirmDelete",{name:g.name}),confirmLabel:t("ask.delete"),danger:true})))return;
    const kept=removeGuestRecord(event,g);
    touchEvent(event);render();
    toastAction(t("guests.deletedToast",{name:g.name}),t("live.undo"),()=>{
      const now=activeEvent();
      if(!now||!canMutate(now,"restore a guest"))return;
      const seatLost=restoreGuestRecord(now,kept),snapshot=kept.snapshot;
      if(seatLost==null)return;
      touchEvent(now);render();
      toast(seatLost?t("guests.restoredNoSeat",{name:snapshot.name}):t("guests.restoredToast",{name:snapshot.name}),"success");
    });
  }
  function unassignGuest(id,options=null){
    const event=activeEvent(),g=event&&event.guests.find(x=>x.id===id);
    if(!g||!g.assignment)return;
    if(!canMutate(event,"unassign a guest"))return;
    if(g.assignment.locked){toast(t("seating.unlockFirst"),"error");return;}
    // Emptying a frozen table is a crossing too. A head-table or sponsor
    // freeze protects the arrangement that is THERE, and letting somebody be
    // pulled out of it silently would defeat the rule as completely as
    // filling it would.
    const blocked=freezeBlocks(event,[id],null,options);
    if(blocked)return challengeFreeze("unassign",blocked,[id],null,null);
    const snapshot=JSON.parse(JSON.stringify(g.assignment));
    const table=event.tables.find(x=>x.id===snapshot.tableId);
    const label=table?formatTableNumber(table.number):"";
    SEAT().clear(g);ui.selectedGuestId=id;
    RULES().syncEventChairs(event);
    touchEvent(event);render();
    toastAction(t("seating.unassignedToast",{name:g.name}),t("live.undo"),()=>{
      const now=activeEvent();
      if(!now||!canMutate(now,"reassign a guest"))return;
      const guest=now.guests.find(x=>x.id===id);if(!guest||guest.assignment)return;
      const back=now.tables.find(x=>x.id===snapshot.tableId);
      const used=back?occupiedSeatIndexes(now,back.id,id):null;
      if(!back||(snapshot.seats||[]).some(s=>used.has(Number(s)))){
        toast(t("seating.seatTaken",{name:guest.name}),"error",5200);return;
      }
      SEAT().write(guest,snapshot);
      RULES().syncEventChairs(now);
      audit(now,"GUEST_REASSIGNED",{guestId:id,tableId:snapshot.tableId});
      touchEvent(now);render();
      toast(t("seating.reassignedToast",{name:guest.name,table:label}),"success");
    });
  }

  function openGuestDialog(...args){if(canMutate(activeEvent(),"edit guest records")){original.openGuestDialog(...args);translateStaticDialogs();guestHistoryLine(args[0]);}}
  // THE GUEST'S PAST, ON THE CARD (owner 2026-11-02): facts from our own past events —
  // how many, came or not, which tables. Read only; never a prediction. Text, never markup.
  function guestHistoryLine(id){
    const dlg=document.getElementById("guestDialog"),body=dlg&&dlg.querySelector(".dialog-body");if(!body)return;
    let line=body.querySelector(".guest-history");if(!line){line=document.createElement("p");line.className="guest-history";body.appendChild(line);}
    line.textContent="";
    const e=activeEvent(),g=id&&e&&e.guests.find(x=>x.id===id),T=globalThis.MeritAssistantTools;if(!g||!T)return;
    const who=T.findPerson(getState().events,g.name,g.phone?{phone:g.phone}:null);
    if(who.people.length!==1){if(who.ambiguous)line.textContent=t("guest.historyAmbiguous");return;}
    const today=new Date().toLocaleDateString("en-CA"),past=T.eventsOf(getState().events,who.people[0],today).events.filter(x=>x.past&&x.event!==e.id);
    if(!past.length){line.textContent=t("guest.historyNone");return;}
    const came=past.filter(x=>x.came).length,tables=[...new Set(past.map(x=>x.table).filter(Boolean))].map(formatTableNumber);
    line.textContent=t("guest.history",{n:past.length,came,missed:past.length-came,tables:tables.join(", ")||"—"});
  }
    return{deleteGuest,openGuestDialog,removeGuestRecord,restoreGuestRecord,unassignGuest};
  }
  globalThis.MeritGuestRecordUndo=Object.freeze({create,DEPS:Object.freeze(["RULES","SEAT","activeEvent","ask","audit","canMutate","challengeFreeze","formatTableNumber","freezeBlocks","getState","occupiedSeatIndexes","original","render","t","toast","toastAction","touchEvent","translateStaticDialogs","ui"])});
})();
