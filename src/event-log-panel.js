// The event's own log, as the screens read it: the handover notes (and
// addHandoverNote, their ONE writer, refusing a historical event) and the
// audit trail turned into sentences an operator can read (the foundation, not
// the replay). The rules are src/event-handover.js and src/audit-trail.js.
// Moved out of app-v8.js on 2026-11-09 (code health, capability 12 of 21,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs; the section comments travelled with the code.
// The edits forced by the move: `state` is read through getState(); the seating
// commands (for a rule's sentence) through getSEATCMD(), created further down
// the shell.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let HANDOVER;
  let RULES;
  let TRAIL;
  let audit;
  let formatTableNumber;
  let getSEATCMD;
  let getState;
  let nowISO;
  let t;
  let uid;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritEventLogPanel.create() is called once, by app-v8.js.");
    created=true;
    HANDOVER=deps.HANDOVER;
    RULES=deps.RULES;
    TRAIL=deps.TRAIL;
    audit=deps.audit;
    formatTableNumber=deps.formatTableNumber;
    getSEATCMD=deps.getSEATCMD;
    getState=deps.getState;
    nowISO=deps.nowISO;
    t=deps.t;
    uid=deps.uid;
  // ---- EVENT HANDOVER: the note log, one writer -----------------------------
  //
  // src/event-handover.js owns the shape of a note and nothing else — it does
  // not know what a table or a guest is. The "state of the event" half of
  // Handover is composed directly in eventHandoverHTML() below from facts that
  // already have a single source (Plan Doctor, liveStats, eventMetrics, Freeze
  // Zones, Table Availability), so this never becomes a second place those
  // numbers could disagree.
  function resolvedHandoverNotes(event){
    const H=HANDOVER();
    if(!H||!event)return[];
    return H.resolve(event.handoverNotes);
  }
  // The only writer. A note is appended, never edited or replaced — a
  // handover log a person could rewrite afterwards would not be trustworthy
  // as a record of what one shift actually told the next.
  // The note's shape -- trimmed, capped, refused when empty -- is
  // MeritEventHandover.normalizeNote, the same rule that reads stored notes;
  // this used to restate it.
  function addHandoverNote(event,text,by){
    const H=HANDOVER();
    // The writer refuses a historical event itself, whatever its caller
    // checked: a screen left open past midnight is a caller that checked
    // yesterday (domain-writers suite).
    if(!H||!event||RULES().mutationRefusal(event))return null;
    const note=H.normalizeNote({id:uid("handover"),text:String(text||""),by:String(by||""),at:nowISO()});
    if(!note)return null;
    event.handoverNotes=Array.isArray(event.handoverNotes)?event.handoverNotes:[];
    event.handoverNotes.unshift(note);
    audit(event,"HANDOVER_NOTE_ADDED",{noteId:note.id});
    return note;
  }

  // ---- AUDIT TRAIL: the foundation, not the replay ---------------------------
  //
  // src/audit-trail.js decides which raw `state.audit` entries are a decision
  // worth showing — an allowlist, kept even though touchEvent() itself no
  // longer writes a generic entry on every mutation (Section 16: that entry
  // never carried anything event.lastModified didn't already, and it was
  // competing with real decisions for the same shared, capped array) —
  // a future write-path can still only add a code this module already
  // named, never leak an unreviewed one in by default. This resolves the
  // list for one event; auditTrailText() below turns one entry into a
  // sentence, reaching into the CURRENT guest/table/freeze data for names,
  // never trusting a stale copy — a deleted guest's own audit line still
  // needs to read sensibly, so it falls back to the id it can no longer
  // resolve rather than throwing.
  function resolvedAuditTrail(event){
    const T=TRAIL();
    if(!T||!event)return[];
    return T.resolve(getState().audit,event.id);
  }
  function auditTrailText(event,entry){
    const d=entry.detail||{};
    const guestName=id=>{const g=(event.guests||[]).find(x=>x.id===id);return g?g.name:t("audit.unknownGuest");};
    const tableNumber=id=>{const tb=(event.tables||[]).find(x=>x.id===id);return tb?formatTableNumber(tb.number):t("audit.unknownTable");};
    switch(entry.action){
      case"EVENT_CREATED":
        return t(d.blank?"audit.eventCreatedBlank":"audit.eventCreatedFromPlan");
      case"GUEST_DELETED":
        return t("audit.guestDeleted",{name:d.name||t("audit.unknownGuest")});
      case"ARRIVAL_STATUS_CHANGED":
        return t("audit.arrivalChanged",{name:guestName(d.guestId),
          from:t("status.arrival."+d.from),to:t("status.arrival."+d.to)});
      case"TABLE_AVAILABILITY_CHANGED":
        return d.to==="UNAVAILABLE"
          ?t("audit.tableMarkedUnavailable",{number:tableNumber(d.tableId),reason:getSEATCMD().availReasonText(d.reason)})
          :t("audit.tableMarkedAvailable",{number:tableNumber(d.tableId)});
      case"FREEZE_CREATED":
        return t("audit.freezeCreated",{reason:getSEATCMD().freezeReasonText(d.reason)});
      case"FREEZE_LIFTED":
        return t("audit.freezeLifted",{reason:getSEATCMD().freezeReasonText(d.reason)});
      case"FREEZE_OVERRIDDEN":
        return t("audit.freezeOverridden");
      case"LAYOUT_CHANGE_CONFIRMED":
        return t("audit.layoutChangeConfirmed");
      case"HANDOVER_NOTE_ADDED":{
        const note=(event.handoverNotes||[]).find(n=>n.id===d.noteId);
        return t("audit.handoverNoteAdded",{text:note?note.text.slice(0,80):t("audit.noteGone")});
      }
      case"TEACH_AREA_NUMBER_CONFIRMED":
        return t("audit.teachNumberConfirmed",{value:d.value});
      case"TEACH_AREA_LESSON_KEPT":
        return t("audit.teachLessonKept");
      case"TEACH_AREA_LESSON_FORGOTTEN":
        return t("audit.teachLessonForgotten");
      case"TEACH_AREA_LESSON_RESTORED":
        return t("audit.teachLessonRestored");
      case"EXEMPLAR_SUGGESTIONS_ADDED":
        return t("audit.exemplarSuggestions",{n:d.count});
      case"ASSISTED_DETECTION_COMPLETED":
        return t("audit.detectionCompleted");
      default:
        return entry.action;
    }
  }
    return{addHandoverNote,auditTrailText,resolvedAuditTrail,resolvedHandoverNotes};
  }
  globalThis.MeritEventLogPanel=Object.freeze({create,DEPS:Object.freeze(["HANDOVER","RULES","TRAIL","audit","formatTableNumber","getSEATCMD","getState","nowISO","t","uid"])});
})();
