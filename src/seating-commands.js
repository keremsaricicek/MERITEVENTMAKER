// The seating commands: seating a party (assignGuestGroup, and the pre-v8
// assignGuestToTable / toggleAssignmentLock overrides that go through it), and
// the freeze zones that may refuse it — create, lift, the per-operation
// override and the single gate every assignment path asks (freezeBlocks /
// challengeFreeze). Moved out of app-v8.js on 2026-11-08 (code health,
// capability 4 of 21, benchmarks/CODE-HEALTH-2026-11.md), at the original
// indentation, by scripts/extract-capability.mjs; the section comment below
// travelled with it.
//
// guest.assignment is written only through MeritSeatAssignment (SEAT, handed
// over) — the one writer (`assignment-writer`); this file decides whether and
// where, never how it is stored. A freeze is a rule about a place; an override
// is per operation and never stored (src/seating-freeze.js owns the rule).
// assignGuestToTable and toggleAssignmentLock stay app-v8.js's overrides of the
// pre-v8 globals as one-line delegates, so `boot-contract` sees v8's version.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let AVAIL;
  let FREEZE;
  let RULES;
  let SEAT;
  let activeEvent;
  let audit;
  let canMutate;
  let clone;
  let eventFreezes;
  let formatTableNumber;
  let nowISO;
  let occupiedSeatIndexes;
  let original;
  let paxOf;
  let render;
  let saveGuestRecord;
  let t;
  let toast;
  let toastAction;
  let touchEvent;
  let ui;
  let uid;
  let unassignGuest;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritSeatingCommands.create() is called once, by app-v8.js.");
    created=true;
    AVAIL=deps.AVAIL;
    FREEZE=deps.FREEZE;
    RULES=deps.RULES;
    SEAT=deps.SEAT;
    activeEvent=deps.activeEvent;
    audit=deps.audit;
    canMutate=deps.canMutate;
    clone=deps.clone;
    eventFreezes=deps.eventFreezes;
    formatTableNumber=deps.formatTableNumber;
    nowISO=deps.nowISO;
    occupiedSeatIndexes=deps.occupiedSeatIndexes;
    original=deps.original;
    paxOf=deps.paxOf;
    render=deps.render;
    saveGuestRecord=deps.saveGuestRecord;
    t=deps.t;
    toast=deps.toast;
    toastAction=deps.toastAction;
    touchEvent=deps.touchEvent;
    ui=deps.ui;
    uid=deps.uid;
    unassignGuest=deps.unassignGuest;
  // ---- FREEZE ZONES ---------------------------------------------------------
  //
  // Defined here, in Seating, because that is where an operator is thinking
  // about who sits where; drawn on the Floor Plan as a LAYER, because that is
  // where they are thinking about the room. Same rules, two views, one store.
  //
  // The freeze is never enforced by hiding a control. Every path that changes
  // an assignment runs the same evaluation (freezeBlocks), so an operator who
  // reaches a frozen table from a drag, a seat row, the table card or a Smart
  // Seating suggestion gets the same challenge and the same override.

  const freezeReasonText=r=>{const k="freeze.reason."+r;return t(k)!==k?t(k):r;};
  const availReasonText=r=>{const k="avail.reason."+r;return t(k)!==k?t(k):r;};

  function createFreezeFromDraft(){
    const event=activeEvent(),F=FREEZE(),d=ui.freezeDraft;
    if(!event||!F||!d)return;
    if(!canMutate(event,"freeze part of the room"))return;
    const f=F.normalize({...d,id:uid("freeze"),createdAt:nowISO()});
    if(!f)return toast(t("freeze.invalid"),"error",5000);
    const covered=F.tablesCovered(f,event.tables||[]);
    // A rule that covers nothing is refused rather than stored. It would show
    // as a held area holding nothing, and the operator would believe the room
    // was protected when it was not.
    if(!covered.length)return toast(t("freeze.coversNothing"),"error",5500);
    // Replaced, not pushed: the render memo keys on this array's identity.
    event.freezes=[...eventFreezes(event),f];
    ui.freezeDraft=null;
    audit(event,"FREEZE_CREATED",{freezeId:f.id,scope:f.scope,reason:f.reason,
      tables:covered.length,tableIds:covered.map(x=>x.id)});
    touchEvent(event);render();
    toast(t("freeze.created",{n:covered.length}),"success",4500);
  }
  function liftFreeze(id){
    const event=activeEvent(),F=FREEZE();
    if(!event||!F)return;
    if(!canMutate(event,"lift a freeze"))return;
    const f=F.normalizeAll(eventFreezes(event)).find(x=>x.id===id);
    if(!f)return;
    event.freezes=eventFreezes(event).filter(x=>String(x&&x.id)!==id);
    // Lifting is a deliberate act by a person and is recorded as one. It is
    // the ONLY way a freeze ends — no override, no seating operation and no
    // migration removes one as a side effect.
    audit(event,"FREEZE_LIFTED",{freezeId:id,scope:f.scope,reason:f.reason});
    touchEvent(event);render();
    toast(t("freeze.lifted"),"success",4000);
  }
  function authoriseFreezeOverride(){
    const c=ui.freezeChallenge;
    if(!c)return;
    const event=activeEvent();
    if(!canMutate(event,"override a freeze"))return;
    audit(event,"FREEZE_OVERRIDDEN",{kind:c.kind,
      freezeIds:c.report.freezes.map(f=>f.id),
      reasons:c.report.freezes.map(f=>f.reason),
      directions:c.report.directions,
      tableIds:c.report.tables.map(x=>x.id),
      guestIds:c.guestIds,pax:c.report.movingPax});
    ui.freezeChallenge=null;
    // The override is spent here, as an argument to ONE call. There is no
    // stored "overridden" flag for the next operation to find.
    if(c.kind==="assign")assignGuestGroup(c.guestIds,c.tableId,c.preferred,{override:true});
    else unassignGuest(c.guestIds[0],{override:true});
  }



  // WOULD THIS OPERATION CROSS A FREEZE? The single gate, used by every path
  // that changes an assignment. Returns the case for the decision, or null.
  //
  // `override` is a PARAMETER and never stored state: one supervisor decision
  // authorises exactly one operation, and the freeze is still standing when
  // the next one arrives. There is deliberately no function anywhere that
  // clears a freeze as a side effect of an override.
  function freezeBlocks(event,guestIds,toTableId,options){
    if(options&&options.override)return null;
    const F=FREEZE();
    if(!F||!event)return null;
    const report=F.evaluateOperation({freezes:eventFreezes(event),
      tables:event.tables||[],guests:event.guests||[],guestIds,toTableId});
    return report.state===F.STATE.OVERRIDE_REQUIRED?report:null;
  }
  function challengeFreeze(kind,report,guestIds,tableId,preferred){
    ui.freezeChallenge={kind,report,guestIds,tableId:tableId||null,
      preferred:preferred===undefined?null:preferred};
    ui.seatPreview=null;
    render();
  }
  // A group member seated away from the rest of the group: said, never prevented (owner 2026-11-02).
  const ruleLine=v=>v.kind==="apart"?t("rules.apartBroken",{a:v.a,b:v.b,table:formatTableNumber(v.table)}):t("rules.vipBroken",{name:v.name,table:formatTableNumber(v.table)});
  // "Paste a list" (src/paste-guests.js + src/messy-list.js): the dialog asks for the open event's
  // guests (to mark likely duplicates) and hands back the ticked rows; they are added here through
  // the one guest writer, for the open event only, never to a past one.
  globalThis.MERIT_PASTE_EXISTING=()=>{const e=activeEvent();return e?e.guests:[];};
  document.addEventListener("merit:add-guests",ev=>{
    const e=activeEvent(),rows=Array.isArray(ev.detail)?ev.detail:[];
    if(!e||!rows.length||!canMutate(e,"edit guest records"))return;
    let n=0;
    for(const r of rows){const name=String(r.name||"").trim().slice(0,120);if(!name)continue;const pax=Math.max(1,Math.min(99,Number(r.pax)||1));
      saveGuestRecord(e,null,{name,additionalGuests:pax-1,pax,planningStatus:"Confirmed",vip:"Standard",invitedBy:String(r.invitedBy||"").slice(0,120),notes:"",phone:String(r.phone||"").slice(0,30),expectedArrival:null});n++;}
    touchEvent(e);render();toast(t("paste.done",{n}),"success",5000);
  });
  function groupApartWarning(event,guests){
    const SR=globalThis.MeritSeatingRules;
    if(SR){const names=new Set(guests.map(g=>g.name));const v=SR.violations(event).filter(x=>names.has(x.a)||names.has(x.b)||names.has(x.name));if(v.length)toast(v.map(ruleLine).join(" "),"info",8000);}
    const G=globalThis.MeritGuestGroups;if(!G||guests.length!==1||!String(guests[0].invitedBy||"").trim())return;
    const sp=G.spread(event).find(s=>G.findHost(event,guests[0].invitedBy).group?.host===s.host);
    if(sp)toast(t("groups.apartToast",{name:guests[0].name,host:sp.host,tables:sp.tables.map(formatTableNumber).join(", ")}),"info",7000);
  }
  function assignGuestGroup(ids,tableId,preferred=null,options=null){
    const event=activeEvent();if(!canMutate(event,"change seating assignments"))return;ids=[...new Set(ids)].filter(Boolean);const guests=ids.map(id=>event.guests.find(g=>g.id===id)).filter(Boolean),table=event.tables.find(t=>t.id===tableId);if(!guests.length||!table)return;
    // A table marked unavailable cannot receive a NEW assignment, and unlike
    // a freeze there is no override: the table itself cannot hold anyone
    // tonight, the same hard stop as a table with zero capacity. Existing
    // occupants are untouched -- this only blocks writing MORE people onto it.
    const AV=AVAIL();
    if(AV&&AV.isUnavailable(table))return toast(t("avail.cannotSeatToast",{number:formatTableNumber(table.number)}),"error",6000);
    const locked=guests.find(g=>g.assignment?.locked);if(locked)return toast(t("toast.assignmentLockedName",{name:locked.name}),"error",5000);
    const used=occupiedSeatIndexes(event,tableId,null);for(const g of guests)if(g.assignment?.tableId===tableId)(g.assignment.seats||[]).forEach(s=>used.delete(Number(s)));
    let free=Array.from({length:table.capacity},(_,i)=>i).filter(i=>!used.has(i));if(preferred!==null&&free.includes(preferred))free=[preferred,...free.filter(i=>i!==preferred)];const required=guests.reduce((n,g)=>n+paxOf(g),0);if(free.length<required)return toast(t("toast.groupSeatsShort",{table:table.number,n:free.length,need:required}),"error",6000);
    // After the capacity check on purpose: asking a supervisor to authorise a
    // move that could not have happened anyway wastes the one thing this
    // mechanism is spending, which is somebody's attention.
    const blocked=freezeBlocks(event,ids,tableId,options);
    if(blocked)return challengeFreeze("assign",blocked,ids,tableId,preferred);
    const snapshot=guests.map(g=>({id:g.id,assignment:clone(g.assignment)}));let cursor=0;
    // Undo only matters here when the group had somewhere to fall back to --
    // a first-time assignment from Unassigned has nothing destructive to
    // recover (Unassign already covers that), and offering it anyway would
    // put an undo toast on every single seating instead of only real moves.
    const isMove=snapshot.some(s=>s.assignment);
    try{
      for(const g of guests){const count=paxOf(g),seats=free.slice(cursor,cursor+count);cursor+=count;SEAT().write(g,{tableId,seats,locked:false});}
      ui.selectedTableId=tableId;ui.highlightId=tableId;touchEvent(event);render();
      groupApartWarning(event,guests);
      const message=t("seating.groupMovedToast",{n:guests.length,plural:guests.length===1?"":"s",table:table.number,seats:required});
      if(!isMove){toast(message,"success",5000);return;}
      toastAction(message,t("live.undo"),()=>{
        const now=activeEvent();if(!now||!canMutate(now,"undo a seating move"))return;
        // Seats may have been given away since the move -- restore what's still
        // free and leave the rest exactly where the move put them, same
        // clash-safe contract as unassignGuest's undo.
        let anyClash=false;
        for(const s of snapshot){
          const guest=now.guests.find(x=>x.id===s.id);if(!guest)continue;
          if(!s.assignment){SEAT().clear(guest);continue;}
          const back=now.tables.find(x=>x.id===s.assignment.tableId);
          const used=back?occupiedSeatIndexes(now,back.id,s.id):null;
          if(!back||(s.assignment.seats||[]).some(seat=>used.has(Number(seat)))){anyClash=true;continue;}
          SEAT().write(guest,s.assignment);
        }
        RULES().syncEventChairs(now);touchEvent(now);render();
        toast(anyClash?t("seating.groupSeatTaken"):t("seating.groupRestoredToast"),anyClash?"error":"success",5200);
      });
    }
    catch(error){
      // Section 14: touchEvent(event) above this try's own assignment loop
      // already persisted the NEW assignment before render() ever ran, so a
      // throw from render() itself (not the loop) would otherwise leave
      // storage holding the successful move while this revert only undoes
      // it in memory -- the next UNRELATED touchEvent() anywhere in the app
      // would then persist this stale, reverted `state`, silently undoing an
      // already-saved seating move. Re-persisting the rollback here closes
      // that gap; it never calls render() again, since re-running whatever
      // just threw could throw a second time.
      snapshot.forEach(s=>{SEAT().write(event.guests.find(g=>g.id===s.id),s.assignment);});
      touchEvent(event);
      toast(t("toast.groupMoveRolledBack"),"error");
    }
  }
  function assignGuestToTable(guestId,tableId,preferred=null,options=null){assignGuestGroup([guestId],tableId,preferred,options);}
  // unassignGuest is defined further down, where its undo lives.
  function toggleAssignmentLock(id){const event=activeEvent();if(!canMutate(event,"change an assignment lock"))return;original.toggleAssignmentLock(id);}
    return{assignGuestGroup,assignGuestToTable,authoriseFreezeOverride,availReasonText,challengeFreeze,createFreezeFromDraft,freezeBlocks,freezeReasonText,liftFreeze,ruleLine,toggleAssignmentLock};
  }
  globalThis.MeritSeatingCommands=Object.freeze({create,DEPS:Object.freeze(["AVAIL","FREEZE","RULES","SEAT","activeEvent","audit","canMutate","clone","eventFreezes","formatTableNumber","nowISO","occupiedSeatIndexes","original","paxOf","render","saveGuestRecord","t","toast","toastAction","touchEvent","ui","uid","unassignGuest"])});
})();
