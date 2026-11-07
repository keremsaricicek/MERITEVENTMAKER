// Data portability: everything that carries this install's records out of the
// browser or brings them back in — the whole-install backup file, the portable
// one-event package, and the automatic recovery snapshots with their restore.
//
// Moved byte-for-byte out of app-v8.js on 2026-11-01 (code health, ownership
// map A25), at the original indentation. The edits forced by the move: `state`
// is read through getState() and replaced through setState(), because the
// shell reassigns it; RECOVERY stays the shell's accessor (the boot loader
// reads it too) and is handed over. The rules these flows apply are not this
// file's: payload shape, structure checks and id renumbering are
// src/event-package.js, schema versions are src/schema-migrations.js,
// snapshot cadence is src/offline-recovery.js, audit merge is
// src/audit-trail.js.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that).
(() => {
  "use strict";
  let ask;
  let getState;
  let loggableError;
  let migrateEvent;
  let nowISO;
  let parseRecordText;
  let parseRoot;
  let RECOVERY;
  let relativeTime;
  let render;
  let RULES;
  let saveState;
  let setState;
  let storageProvider;
  let t;
  let toast;
  let TRAIL;
  let ui;
  let uid;
  let created=false;

  // Backup/restore: a product-level export of the app's own structured
  // state, distinct from the operational XLSX workbook. Never overwrites
  // current data with a file that fails format, structure or referential
  // integrity checks -- each failure is a specific, translated toast rather
  // than a generic "invalid file".
  function buildBackupPayload(){return{format:"merit-event-maker-backup",formatVersion:1,exportedAt:nowISO(),payload:getState()};}
  function exportBackup(){
    const blob=new Blob([JSON.stringify(buildBackupPayload(),null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`merit-event-maker-yedek-${RULES().todayKey()}.json`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
    // Recorded only here, after the file has actually been handed to the
    // browser. The radar reads this to say whether a copy of the event exists
    // anywhere, so it must never be set by opening a dialog or by an export
    // that failed -- "backed up" has to mean a file really left.
    getState().lastBackupAt=nowISO();
    saveState();
    toast(t("backup.exportedToast"),"success");
  }
  function backupReferencesIntact(payload){
    for(const event of payload.events||[]){
      const tableIds=new Set((event.tables||[]).map(x=>x.id));
      for(const g of event.guests||[])if(g.assignment&&g.assignment.tableId&&!tableIds.has(g.assignment.tableId))return false;
    }
    return true;
  }
  // The SAME file input serves both formats: a whole-install backup and a
  // single portable event package are both "a file the operator picked to
  // bring data in," and asking them to remember two different buttons for
  // what looks like one action would be the wrong kind of precision. Which
  // flow runs is decided from the file's own format marker, never the
  // control that opened the picker.
  // A file is refused WHOLE, with a message, before anything is replaced --
  // never half-applied and never a silent TypeError out of the file reader.
  // tests/suites/malformed-import.test.mjs feeds every refusal below through
  // this control.
  const IMPORT_RULE_KEY={notRecord:"import.rule.notRecord",notList:"import.rule.notList",notText:"import.rule.notText",
    badDate:"import.rule.badDate",badPax:"import.rule.badPax",badAssignment:"import.rule.badAssignment",badId:"import.rule.badId",notNumber:"import.rule.notNumber"};
  const importRuleText=rule=>t(IMPORT_RULE_KEY[rule]||"import.rule.notRecord");
  function firstEventProblem(events,at){
    const P=globalThis.MeritEventPackage;
    if(!P)return null;
    for(let i=0;i<events.length;i++){const p=P.eventProblem(events[i],`${at}[${i}]`);if(p)return p;}
    return null;
  }
  function importBackupFile(file){
    const reader=new FileReader();
    reader.onerror=()=>toast(t("backup.corruptFile"),"error",6000);
    reader.onload=async()=>{
      let parsed;
      try{parsed=parseRecordText(reader.result);}catch{toast(t("backup.corruptFile"),"error",6000);return;}
      if(parsed&&parsed.format==="merit-event-maker-event-package"){importEventPackagePayload(parsed);return;}
      if(!parsed||parsed.format!=="merit-event-maker-backup"||!parsed.payload||!Array.isArray(parsed.payload.events)){toast(t("backup.invalidFile"),"error",6000);return;}
      const SM=globalThis.MeritSchemaMigrations;
      if(SM&&!SM.readable(parsed.payload)){toast(t("backup.invalidFile"),"error",6000);return;}
      if(SM&&SM.versionOf(parsed.payload)>SM.CURRENT_VERSION){toast(t("backup.futureVersion"),"error",9000);return;}
      const problem=firstEventProblem(parsed.payload.events,"events");
      if(problem){toast(t("backup.invalidRecord",{path:problem.path,rule:importRuleText(problem.rule)}),"error",9000);return;}
      if(!backupReferencesIntact(parsed.payload)){toast(t("backup.badReference"),"error",6500);return;}
      const n=parsed.payload.events.length;
      if(!(await ask({title:t("ask.restoreTitle"),body:t("backup.confirmRestore",{n}),confirmLabel:t("ask.restore"),danger:true})))return;
      // Built into a local first and only then assigned: whatever the
      // migration chain meets that the checks above did not anticipate, the
      // current state is still the current state when it throws.
      let next;
      try{next=parseRoot(JSON.stringify(parsed.payload),{forImport:true});}
      catch(error){
        console.warn("Backup restore refused while migrating the file.",error&&error.name);
        toast(t(error&&error.name==="FutureSchemaError"?"backup.futureVersion":"backup.corruptFile"),"error",9000);
        return;
      }
      setState(next);
      ui.screen="events";ui.activeEventId=null;ui.undo=[];ui.redo=[];
      saveState();render();
      toast(t("backup.restoredToast",{n}),"success");
    };
    reader.readAsText(file);
  }

  // ---- PORTABLE EVENT PACKAGE: one event, not the whole install --------------
  //
  // src/event-package.js owns the payload shape and the id-renumbering; this
  // is the only code that touches state.events/state.audit for it. Never
  // updates lastBackupAt -- that fact means the WHOLE install left the
  // browser, and a single event leaving says nothing about any other event.
  function exportEventPackage(eventId){
    const event=getState().events.find(e=>e.id===eventId);
    const P=globalThis.MeritEventPackage;
    if(!event||!P)return;
    const venue=event.venueRef?(getState().venues||[]).find(v=>v.id===event.venueRef.venueId)||null:null;
    const auditEntries=(getState().audit||[]).filter(a=>a.eventId===eventId);
    const payload=P.buildPayload(JSON.parse(JSON.stringify(event)),{venue,auditEntries});
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;
    a.download=`merit-event-package-${String(event.name||"event").toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,60)}-${RULES().todayKey()}.json`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
    toast(t("eventPackage.exportedToast",{name:event.name}),"success");
  }
  async function importEventPackagePayload(parsed){
    const P=globalThis.MeritEventPackage;
    if(!P||!P.isWellFormed(parsed)){toast(t("eventPackage.invalidFile"),"error",6000);return;}
    if(Number(parsed.formatVersion)>P.FORMAT_VERSION){toast(t("eventPackage.futureVersion"),"error",9000);return;}
    const isRecord=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
    if(parsed.auditEntries!=null&&!(Array.isArray(parsed.auditEntries)&&parsed.auditEntries.every(isRecord))){toast(t("eventPackage.invalidFile"),"error",6000);return;}
    if(parsed.venue!=null&&!isRecord(parsed.venue)){toast(t("eventPackage.invalidFile"),"error",6000);return;}
    const problem=P.eventProblem(parsed.event,"event");
    if(problem){toast(t("eventPackage.invalidRecord",{path:problem.path,rule:importRuleText(problem.rule)}),"error",9000);return;}
    if(!P.referencesIntact(parsed.event)){toast(t("eventPackage.badReference"),"error",6500);return;}
    if(!(await ask({title:t("ask.importTitle"),body:t("eventPackage.confirmImport",{name:parsed.event.name||""}),confirmLabel:t("ask.import")})))return;
    // Everything is computed BEFORE state is touched. The venue used to be
    // pushed first and the event migrated after, so a migration that threw
    // left a venue behind with no event -- half an import.
    let migrated,auditEntries,newVenue=null;
    try{
      const renumbered=P.regenerateIds(parsed.event,parsed.auditEntries,uid);
      const event=renumbered.event;auditEntries=renumbered.auditEntries;
      if(parsed.venue&&!getState().venues.some(v=>v.id===event.venueRef?.venueId)){
        // The referenced venue travelled with the package but does not exist
        // here yet -- added as its own new record rather than merged into a
        // same-named one, so this import never silently rewrites a venue an
        // operator on this machine already relies on.
        newVenue={...JSON.parse(JSON.stringify(parsed.venue)),id:uid("venue")};
        if(event.venueRef)event.venueRef={...event.venueRef,venueId:newVenue.id};
      }
      migrated=migrateEvent(event);
    }catch(error){
      console.warn("Event package refused while migrating the file.",error&&error.name);
      toast(t("eventPackage.importFailed"),"error",9000);
      return;
    }
    if(newVenue)getState().venues.push(newVenue);
    getState().events.unshift(migrated);
    // Merge, never truncate. This line ran slice(0,1000) over the
    // concatenation, so importing an event whose history was larger than the
    // cap threw most of it away AND evicted the host install's own decisions
    // to make room for what survived.
    {
      const T=TRAIL();
      if(T){
        const r=T.merge(getState().audit||[],auditEntries);
        getState().audit=r.log;
        getState().auditRetention=T.recordEviction(getState().auditRetention||null,r);
      } else getState().audit=[...auditEntries,...(getState().audit||[])];
    }
    ui.screen="events";ui.activeEventId=null;
    saveState();render();
    toast(t("eventPackage.importedToast",{name:migrated.name}),"success");
  }

  // ---- OFFLINE RECOVERY: an automatic safety net, distinct from backup ------
  //
  // src/offline-recovery.js decides whether a moment is worth keeping and how
  // many to keep; this is the only code that touches storage for it. Snapshots
  // live under their own StorageProvider key ("autosnapshots"), never the
  // primary "root" record, so a corrupted primary record cannot take its own
  // safety net down with it.
  function autoSnapshot(payload){
    const R=RECOVERY();
    if(!R||!getState().events.length)return;
    storageProvider.load("autosnapshots").then(stored=>{
      const list=Array.isArray(stored)?stored:[];
      const last=R.latestSnapshot(list);
      if(!R.shouldSnapshot({hasContent:true,lastSnapshotAt:last&&last.at,now:Date.now()}))return;
      return storageProvider.save(R.withSnapshot(list,{at:nowISO(),payload}),"autosnapshots");
    }).catch(error=>console.warn("Automatic recovery snapshot failed.",loggableError(error)));
  }
  // A deliberate, operator-initiated restore while the app is otherwise
  // healthy -- e.g. undo did not reach far enough back. Confirmed exactly
  // like importBackupFile(), because it replaces the whole working state the
  // same way a backup file does.
  function restoreLatestSnapshot(){
    const R=RECOVERY();
    if(!R)return;
    storageProvider.load("autosnapshots").then(async stored=>{
      const snap=R.latestSnapshot(stored);
      if(!snap){toast(t("recovery.none"),"error");return;}
      if(!(await ask({title:t("ask.recoveryTitle"),body:t("recovery.confirmRestore",{when:relativeTime(snap.at)}),confirmLabel:t("ask.restore"),danger:true})))return;
      setState(parseRoot(snap.payload));
      ui.screen="events";ui.activeEventId=null;ui.undo=[];ui.redo=[];
      saveState();render();
      toast(t("recovery.restoredToast",{when:relativeTime(snap.at)}),"success");
    }).catch(error=>{console.warn("Automatic recovery restore failed.",loggableError(error));toast(t("recovery.none"),"error");});
  }

  function create(deps){
    if(created)throw new Error("MeritDataPortability.create() is called once, by app-v8.js.");
    created=true;
    ask=deps.ask;
    getState=deps.getState;
    loggableError=deps.loggableError;
    migrateEvent=deps.migrateEvent;
    nowISO=deps.nowISO;
    parseRecordText=deps.parseRecordText;
    parseRoot=deps.parseRoot;
    RECOVERY=deps.RECOVERY;
    relativeTime=deps.relativeTime;
    render=deps.render;
    RULES=deps.RULES;
    saveState=deps.saveState;
    setState=deps.setState;
    storageProvider=deps.storageProvider;
    t=deps.t;
    toast=deps.toast;
    TRAIL=deps.TRAIL;
    ui=deps.ui;
    uid=deps.uid;
    return{exportBackup,importBackupFile,exportEventPackage,autoSnapshot,restoreLatestSnapshot};
  }
  globalThis.MeritDataPortability=Object.freeze({create,DEPS:Object.freeze(["ask","getState","loggableError","migrateEvent","nowISO","parseRecordText","parseRoot","RECOVERY","relativeTime","render","RULES","saveState","setState","storageProvider","t","toast","TRAIL","ui","uid"])});
})();
