// Persistence: reading the stored record (parseRecordText, parseRoot — the
// stored schema version is read, never stamped; a newer build's data opens
// read-only), migrating an event to the current shape (migrateEvent — real
// migrations, never new-install defaults), the legacy keys, quarantining a
// record that cannot be read instead of dropping it, the unload journal (the
// last moment before the tab closed; used only while the store is unchanged),
// the boot load (loadV8Async) and saveState — a COMPLETE snapshot, queued,
// read back, with the storage notice it raises. saveState stays app-v8.js's
// override of the pre-v8 global as a one-line delegate. Moved out of app-v8.js
// on 2026-11-11 (code health, capability 19 of 21,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs; every section comment travelled with its
// code. The edits forced by the move: `state` and `bootReady` are read through
// getters (the shell assigns both); PORTABILITY, created further down the
// shell, through getPORTABILITY(); MERIT_SCHEMA_GUARD / MERIT_STORAGE_NOTICE
// and the pure modules through globalThis. The state root, touchEvent, the
// mutation counter, canMutate and audit stay in app-v8.js: they are the state.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let LEGACY_KEYS;
  let RECOVERY;
  let RULES;
  let V8_STORAGE_KEY;
  let blankRoot;
  let getBootReady;
  let getPORTABILITY;
  let getState;
  let loggableError;
  let normalizeGuest;
  let nowISO;
  let render;
  let storageProvider;
  let t;
  let toast;
  let uid;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritShellStorage.create() is called once, by app-v8.js.");
    created=true;
    LEGACY_KEYS=deps.LEGACY_KEYS;
    RECOVERY=deps.RECOVERY;
    RULES=deps.RULES;
    V8_STORAGE_KEY=deps.V8_STORAGE_KEY;
    blankRoot=deps.blankRoot;
    getBootReady=deps.getBootReady;
    getPORTABILITY=deps.getPORTABILITY;
    getState=deps.getState;
    loggableError=deps.loggableError;
    normalizeGuest=deps.normalizeGuest;
    nowISO=deps.nowISO;
    render=deps.render;
    storageProvider=deps.storageProvider;
    t=deps.t;
    toast=deps.toast;
    uid=deps.uid;
  function migrateEvent(event){
    const migrated={...event};
    migrated.id ||= uid("event"); migrated.name=String(migrated.name||"Untitled Event");
    migrated.hotel=String(migrated.hotel ?? migrated.venue ?? "");
    migrated.salon=String(migrated.salon ?? "");
    migrated.venue=migrated.hotel; migrated.coverImage=migrated.coverImage||"";
    migrated.status=["Planning","Confirmed","Live","Completed"].includes(migrated.status)?migrated.status:"Planning";
    migrated.createdAt ||= nowISO(); migrated.lastModified ||= migrated.createdAt;
    // capacitySource: a value this build recognises survives untouched; a
    // table from before this field existed (or a corrupted one) is backfilled
    // honestly as UNKNOWN rather than guessed at -- the same migration
    // discipline as hasPhysicalSeats one line above.
    //
    // This is also where a stored event stops carrying fabricated chairs.
    // syncTableChairs() (src/event-rules.js) empties `chairs` on a symbolic table and rebuilds a
    // physical table's chairs without the retired `physical` flag, so an
    // install that saved 4,200 invented chair coordinates sheds them on the
    // first load. Nothing operational rides on them: capacity, assignments
    // and seat indexes are untouched, and a physical table's real chair
    // coordinates are carried across verbatim.
    migrated.tables=(migrated.tables||[]).map(table=>RULES().syncTableChairs({...table,id:table.id||uid("table"),hasPhysicalSeats:table.hasPhysicalSeats!==false,capacitySource:globalThis.MeritCapacityProvenance.normalizeForTable(table.capacitySource)}));
    migrated.venueObjects=(migrated.venueObjects||[]).map(o=>({...o,id:o.id||uid("venue")}));
    migrated.guests=(migrated.guests||[]).map(normalizeGuest);
    // FREEZE ZONES. An install from before them simply has none, which is the
    // correct empty state -- there is nothing to reconstruct. Stored rules are
    // re-normalized on every load rather than trusted: a hand-edited backup
    // could otherwise carry a freeze whose scope covers nothing definable,
    // which would show the operator a held area that holds nothing.
    // seating rules (src/seating-rules.js): warn-only notes; an old event has none
    migrated.seatRules=globalThis.MeritSeatingRules?globalThis.MeritSeatingRules.normalizeAll(migrated.seatRules):(Array.isArray(migrated.seatRules)?migrated.seatRules:[]);
    migrated.freezes=globalThis.MeritSeatingFreeze
      ?globalThis.MeritSeatingFreeze.normalizeAll(migrated.freezes)
      :(Array.isArray(migrated.freezes)?migrated.freezes:[]);
    // HANDOVER NOTES. An install from before them, or a brand-new blank event,
    // simply has none -- the correct empty state, nothing to reconstruct.
    // Re-normalized on every load like freezes: a hand-edited backup could
    // otherwise carry a note with no text, which would render as a blank line
    // in a log an operator is trusting for what the last shift actually said.
    migrated.handoverNotes=globalThis.MeritEventHandover
      ?globalThis.MeritEventHandover.resolve(migrated.handoverNotes)
      :(Array.isArray(migrated.handoverNotes)?migrated.handoverNotes:[]);
    migrated.background={src:"",name:"",opacity:.28,visible:false,locked:true,isDefault:false,scale:100,...(migrated.background||{})};
    if(migrated.background.isDefault){migrated.background.src="";migrated.background.visible=false;migrated.background.isDefault=false;}
    migrated.analysis=migrated.analysis||null;
    RULES().syncEventChairs(migrated);
    return migrated;
  }
  // A record this build must not read AND must not write over. Set once, by
  // parseRoot, when the stored schemaVersion is newer than this build knows.
  // Exposed so the UI and the suites can see the state rather than infer it.
  globalThis.MERIT_SCHEMA_GUARD={readOnly:false,storedVersion:null,buildVersion:null};
  // Thrown by parseRoot so every caller -- the normal load, the legacy
  // migration, the recovery snapshot -- gets the same containment without
  // each having to remember to check.
  function FutureSchemaError(storedVersion){
    const e=new Error("Stored data was written by a newer version of this application.");
    e.name="FutureSchemaError"; e.storedVersion=storedVersion; return e;
  }
  // Every record read from outside memory goes through the registry's reader,
  // which drops `__proto__`/`constructor`/`prototype` keys before anything can
  // copy them (src/schema-migrations.js, parseRecord).
  function parseRecordText(raw){
    const SM=globalThis.MeritSchemaMigrations;
    return SM&&SM.parseRecord?SM.parseRecord(raw):JSON.parse(raw);
  }
  // `forImport`: the record is a FILE an operator picked, not this install's
  // own stored record. A file from a newer build is refused exactly the same
  // way, but the read-only guard is NOT latched -- the guard protects the
  // stored record from being written over, and a refused file is not that
  // record. Latching it here used to leave a healthy install silently unable
  // to save after one wrong file was picked.
  function parseRoot(raw,{forImport=false}={}){
    const parsed=parseRecordText(raw);
    // READ the version, do not stamp it. `parsed.schemaVersion=8` used to sit
    // here: a record from a newer build had its version overwritten, its
    // unknown fields ignored, and was then saved over on the first mutation.
    // That is not a misread, it is data destruction, and the write is the
    // destructive half -- so FUTURE latches a read-only guard rather than
    // merely declining to migrate.
    // Root lists other than `events` are set aside before the schema chain
    // reads the record (see the per-event pass below for why). A root whose
    // `events` is not a list stays unreadable: there is nothing to open, and
    // the whole record is copied aside by the loader, as before.
    const setAside=[],setAt=nowISO();
    const isRec=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
    if(isRec(parsed))for(const key of ["venues","audit","verifiedExamples","analyses","trainingData","teachings","operatorSessions"]){
      if(parsed[key]==null)continue;
      if(!Array.isArray(parsed[key])){setAside.push({where:key,rule:"notList",at:setAt,raw:parsed[key]});parsed[key]=[];continue;}
      parsed[key]=parsed[key].filter(x=>isRec(x)||(setAside.push({where:key,rule:"notRecord",at:setAt,raw:x}),false));
    }
    const SM=globalThis.MeritSchemaMigrations;
    if(SM){
      const result=SM.migrate(parsed);
      if(result.status===SM.STATUS.FUTURE){
        if(!forImport)globalThis.MERIT_SCHEMA_GUARD={readOnly:true,storedVersion:result.from,buildVersion:SM.CURRENT_VERSION};
        throw FutureSchemaError(result.from);
      }
      if(result.status===SM.STATUS.UNREADABLE)throw new Error("Stored data is not a readable record.");
    }
    // No `else` that stamps a version. If the registry were ever missing from
    // the bundle, stamping would silently reintroduce the exact defect this
    // check exists to prevent -- so the record keeps whatever version it
    // declared and nothing claims to have migrated it.
    // ONE UNREADABLE RECORD IS SET ASIDE, NOT THE WHOLE STORE. Measured
    // 2026-10-03: a single event whose `guests` was not a list (or a null
    // guest, or an `audit` that was not a list) made this function throw, the
    // whole record went to quarantine and the operator faced an empty app —
    // every intact event out of reach on the night. A null entry, meanwhile,
    // was "migrated" into a fabricated "Untitled Event". Now each part that
    // cannot be read is moved, unchanged, into `setAside` (persisted, carried
    // by every backup), the rest opens, and the operator is told. An IMPORT
    // stays all-or-nothing: a backup is refused whole rather than half-applied.
    const PKG=globalThis.MeritEventPackage;
    parsed.events=(parsed.events||[]).flatMap(e=>{
      const problem=PKG?PKG.structureProblem(e):(isRec(e)?null:{path:"event",rule:"notRecord"});
      const label=isRec(e)?{eventId:typeof e.id==="string"?e.id:null,name:typeof e.name==="string"?e.name:null}:{};
      if(problem){setAside.push({where:"event",rule:problem.rule,path:problem.path,...label,at:setAt,raw:e});return[];}
      try{return[migrateEvent(e)];}
      catch{setAside.push({where:"event",rule:"migrationFailed",...label,at:setAt,raw:e});return[];}
    });
    if(setAside.length&&forImport)throw new Error("The record contains parts that cannot be read.");
    parsed.setAside=[...(Array.isArray(parsed.setAside)?parsed.setAside:[]),...setAside];
    if(setAside.length)globalThis.MERIT_STORAGE_NOTICE.setAside={count:setAside.length,at:setAt,hidden:false};
    parsed.verifiedExamples ||= []; parsed.analyses ||= []; parsed.audit ||= [];
    // Re-normalized on every load, like freezes and handover notes: a
    // hand-edited backup must not be able to claim a loss that never
    // happened, or to lose the record of one that did.
    parsed.auditRetention=globalThis.MeritAuditTrail
      ?globalThis.MeritAuditTrail.normalizeRetention(parsed.auditRetention)
      :(parsed.auditRetention||null);
    // Added with training-data capture. An install from before it simply has
    // no examples yet -- there is nothing to reconstruct, because the crops
    // it would have needed were never taken.
    parsed.trainingData ||= [];
    // The Teach Area (src/plan-teach-area.js). Lives at the root rather than on
    // an event because its whole point is reach: a lesson scoped to a venue has
    // to outlive the event it was taught in. An install from before it has no
    // lessons, which is the correct empty state -- nothing to reconstruct.
    parsed.teachings ||= [];
    // Promote the old free-text hotel/salon strings into real Venue/Layout
    // records (src/venue-model.js). Additive: every event keeps its original
    // strings, and a venueRef is attached alongside, so nothing that reads
    // event.hotel today changes behaviour.
    if(globalThis.MeritVenueModel){
      const result=globalThis.MeritVenueModel.migrateVenues(parsed);
      if(result.linked)parsed.audit.unshift({id:uid("audit"),eventId:null,action:"VENUE_MODEL_MIGRATION",detail:result,at:nowISO()});
    }
    return parsed;
  }
  // One-time migration source only: whatever a pre-StorageProvider install
  // left in localStorage. Read here, never written to again after this.
  function loadFromLegacyLocalStorage(){
    try{
      const own=localStorage.getItem(V8_STORAGE_KEY); if(own) return parseRoot(own);
      for(const key of LEGACY_KEYS){const raw=localStorage.getItem(key);if(raw){const migrated=parseRoot(raw);migrated.audit.unshift({id:uid("audit"),eventId:null,action:"LEGACY_MIGRATION",detail:{source:key,venueToHotel:true,salonInvented:false},at:nowISO()});return migrated;}}
    }catch(error){console.warn("Legacy localStorage restore failed",loggableError(error));}
    return null;
  }
  // WHAT THE OPERATOR MUST BE TOLD ABOUT STORAGE, kept until it stops being
  // true -- never only a toast, which disappears before anyone reads it.
  //   unreadable     the stored record could not be read at boot (see below)
  //   saveFailing    the last save failed entirely; cleared by the next success.
  //                  {reason:"serialize"} when the state could not even be
  //                  turned into a record -- not a storage refusal at all
  //   imagesDropped  saves succeed only WITHOUT the plan images, so the next
  //                  open has no plan; cleared by a save that keeps them
  //   recovered      this session opened an automatic recovery point because
  //                  the saved record was missing; later changes may be gone
  // The last three were each told by one toast and nothing else (§17).
  globalThis.MERIT_STORAGE_NOTICE={unreadable:null,saveFailing:null,dismissed:false,imagesDropped:null,recovered:null,setAside:null};
  // THE STORED RECORD COULD NOT BE READ. It used to be dropped on the floor:
  // the app opened empty with no word said, and the first save wrote the new,
  // almost-empty state over it -- destroying a record that was, more often
  // than not, one hand-edited quote away from readable
  // (tests/suites/resilience-storage.test.mjs). It is now copied to its own
  // key before anything else happens. If even that copy cannot be written,
  // this session does not save at all, so the only copy is never overwritten.
  async function quarantineUnreadable(raw){
    const at=nowISO(),key="quarantine:"+at;
    try{
      await storageProvider.save(raw,key);
      globalThis.MERIT_STORAGE_NOTICE.unreadable={kept:true,key,at,raw};
    }catch(error){
      console.warn("Could not keep a copy of the unreadable record; this session will not save.",loggableError(error));
      globalThis.MERIT_STORAGE_NOTICE.unreadable={kept:false,key:null,at,raw};
    }
  }
  // THE LAST MOMENT BEFORE THE TAB CLOSED. A save is an IndexedDB write the
  // browser may abort when the page is torn down, so a change made just
  // before closing could be lost (resilience-records, caught by CI
  // 2026-10-24). On pagehide/beforeunload the same complete snapshot a save
  // would write is also put, synchronously, in one localStorage slot; at the
  // next boot it is used when it differs from the stored record, and any
  // successful save removes it (the store then holds the newest picture). It
  // is written only when a save would be allowed, and only whole: a snapshot
  // that does not fit is not written at all (and an older one is removed),
  // never written without its images. It carries a fingerprint of the stored
  // record this tab last read or wrote, and is used only while the store
  // still holds exactly that record: a store something else has written since
  // (another tab, a restore, the suites' own injected records) is newer than
  // this tab's last moment, and the snapshot is dropped.
  const UNLOAD_JOURNAL_KEY="merit.unloadJournal.v1";
  let lastStoredRaw=null;
  const fingerprint=(str)=>{if(typeof str!=="string")return "none";let h=0x811c9dc5;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,0x01000193);}return (h>>>0).toString(16)+":"+str.length;};
  function readUnloadJournal(){try{const j=JSON.parse(localStorage.getItem(UNLOAD_JOURNAL_KEY)||"null");return j&&typeof j.payload==="string"&&typeof j.base==="string"?j:null;}catch(error){console.warn("The record kept when the tab closed could not be read.",loggableError(error));return null;}}
  function clearUnloadJournal(){try{localStorage.removeItem(UNLOAD_JOURNAL_KEY);}catch(error){console.warn("Could not remove the record kept when the tab closed.",loggableError(error));}}
  // ONE serialisation per close (CI, 2026-10-27: on a 50,000-guest event the
  // close-time work pushed the reload past its budget). beforeunload and
  // pagehide both fire, so the snapshot is written once per close (`unloadDone`,
  // reset when the page is shown again or saves again); and the save that
  // app-guests' beforeunload handler has just made in this same task already
  // holds the payload (`unloadPayload`, dropped at the next task).
  let unloadDone=false,unloadPayload=null;
  function writeUnloadJournal(){
    if(unloadDone)return;
    if(!getBootReady()||(globalThis.MERIT_SCHEMA_GUARD&&globalThis.MERIT_SCHEMA_GUARD.readOnly)||(globalThis.MERIT_STORAGE_NOTICE.unreadable&&!globalThis.MERIT_STORAGE_NOTICE.unreadable.kept))return;
    let payload=unloadPayload;
    if(payload==null){try{getState().events.forEach(e=>RULES().syncEventChairs(e));payload=JSON.stringify(getState());}catch(error){console.warn("Nothing kept when the tab closed: the state could not be serialised.",loggableError(error));return;}}
    unloadDone=true;
    if(payload===lastStoredRaw){clearUnloadJournal();return;}
    try{localStorage.setItem(UNLOAD_JOURNAL_KEY,JSON.stringify({base:fingerprint(lastStoredRaw),payload}));}catch(error){console.warn("Nothing kept when the tab closed: it does not fit.",loggableError(error));clearUnloadJournal();}
  }
  window.addEventListener("pagehide",writeUnloadJournal);
  window.addEventListener("beforeunload",writeUnloadJournal);
  window.addEventListener("pageshow",()=>{unloadDone=false;});
  async function loadV8Async(){
    let raw=null;
    try{
      raw=await storageProvider.load();
      lastStoredRaw=raw;
      const journal=readUnloadJournal();
      if(journal&&journal.base===fingerprint(raw)&&journal.payload!==raw){
        try{return{data:parseRoot(journal.payload),recoveredAt:null,fromJournal:true};}
        catch(error){console.warn("The record kept when the tab closed could not be read; using the stored record.",loggableError(error));}
      }
      if(journal)clearUnloadJournal();
      if(raw) return{data:parseRoot(raw),recoveredAt:null};
    }catch(error){
      console.warn("StorageProvider load failed, checking legacy localStorage.",loggableError(error));
      // A record from a NEWER build is not unreadable -- the schema guard owns
      // that case and already refuses to write over it.
      if(!(globalThis.MERIT_SCHEMA_GUARD&&globalThis.MERIT_SCHEMA_GUARD.readOnly)){
        // The record was read and would not parse: keep a copy. Or the READ
        // itself failed (storage blocked by another tab, a broken database):
        // nothing is known about what is stored, so nothing may be written
        // over it this session either.
        if(raw!=null)await quarantineUnreadable(raw);
        else globalThis.MERIT_STORAGE_NOTICE.unreadable={kept:false,key:null,at:nowISO(),raw:null};
      }
    }
    // Writing the recovered picture straight into the primary record is only
    // safe once whatever was there has been copied aside.
    const mayOverwrite=!globalThis.MERIT_STORAGE_NOTICE.unreadable||globalThis.MERIT_STORAGE_NOTICE.unreadable.kept;
    // A record from a newer build is not a missing record. Falling through to
    // the legacy reader or a recovery snapshot would present something OLDER
    // as though it were the current one -- harmless to the file, since the
    // guard blocks writes, but a lie on screen.
    if(globalThis.MERIT_SCHEMA_GUARD&&globalThis.MERIT_SCHEMA_GUARD.readOnly)return{data:blankRoot(),recoveredAt:null};
    const legacy=loadFromLegacyLocalStorage();
    if(legacy){
      // Get it into the real store right away so this migration only ever
      // has to run once, even if the provider load above merely came back
      // empty (first run after switching to IndexedDB) rather than erroring.
      if(mayOverwrite)storageProvider.save(JSON.stringify(legacy)).catch(error=>console.warn("Could not persist migrated legacy state.",loggableError(error)));
      return{data:legacy,recoveredAt:null};
    }
    // The primary record is gone or unreadable, and there is no legacy
    // install to fall back to either. Before conceding a blank slate that
    // silently discards whatever the operator had, try the automatic
    // recovery snapshot -- exactly the case offline-recovery.js exists for.
    // A snapshot that itself fails to parse is treated the same as none.
    try{
      const R=RECOVERY();
      const stored=R&&await storageProvider.load("autosnapshots");
      const snap=R&&R.latestSnapshot(stored);
      if(snap){
        const data=parseRoot(snap.payload);
        if(mayOverwrite)storageProvider.save(JSON.stringify(data)).catch(error=>console.warn("Could not persist auto-recovered state.",loggableError(error)));
        return{data,recoveredAt:snap.at};
      }
    }catch(error){console.warn("Automatic recovery snapshot could not be read either.",loggableError(error));}
    return{data:blankRoot(),recoveredAt:null};
  }
  // Section 13 (storage write-ordering safety): `storageProvider.save()` is
  // async (IndexedDBStorageProvider opens its own connection per call), so
  // two `saveState()` calls close together race on which write actually
  // lands last -- nothing structurally guaranteed the second call to START
  // was also the second call to LAND. `saveQueue` fixes this the direct
  // way, not by comparing epochs after the fact: every save chains onto the
  // one before it, so writes reach storage in exactly the order saveState()
  // was called, whichever caller (touchEvent or a direct saveState() call)
  // made them. persistPayload() never lets a failure break the chain --
  // its own last .catch() always resolves -- so one save's storage error
  // can never stall every save queued after it.
  let saveQueue=Promise.resolve();
  // A save that lands after failing ones ends the "not being saved" notice:
  // every save is a whole snapshot, so the first success after a failure has
  // written everything the failures could not.
  function storageRecovered(){if(globalThis.MERIT_STORAGE_NOTICE.saveFailing){globalThis.MERIT_STORAGE_NOTICE.saveFailing=null;if(getBootReady())render();}}
  // The whole payload -- images included -- was stored, so whatever the
  // "images not stored" notice said is no longer true.
  function imagesStored(){if(globalThis.MERIT_STORAGE_NOTICE.imagesDropped){globalThis.MERIT_STORAGE_NOTICE.imagesDropped=null;if(getBootReady())render();}}
  // Every autosave repeats the strip while the image does not fit, so the
  // notice and its toast are raised once, when the condition begins -- not
  // on every keystroke that saves.
  function imagesDropped(){
    if(globalThis.MERIT_STORAGE_NOTICE.imagesDropped)return;
    globalThis.MERIT_STORAGE_NOTICE.imagesDropped={at:nowISO(),hidden:false};
    toast(t("toast.imagesNotStored"),"error",6500);
    if(getBootReady())render();
  }
  // READ IT BACK. A save that resolved is a promise from the storage layer,
  // not a record on disk: a failing disk or a browser that truncates a value
  // resolves just the same. Each save is read back and compared; a record that
  // reads back different is a failing save, said so with its own message, and
  // is never "fixed" by the image-strip retry, which answers a different
  // failure (resilience-records injects it).
  async function saveAndReadBack(payload){
    await storageProvider.save(payload);
    const back=await storageProvider.load();
    if(back!==payload)throw Object.assign(new Error("The saved record read back different from what was written."),{readBack:true});
  }
  function persistPayload(payload,show){
    return saveAndReadBack(payload)
      .then(()=>{if(show)toast(t("toast.savedLocally"),"success");lastStoredRaw=payload;clearUnloadJournal();getPORTABILITY().autoSnapshot(payload);storageRecovered();imagesStored();})
      .catch(error=>{
        if(error&&error.readBack)throw error;
        // Large embedded images are the only realistic reason a save this
        // size fails -- strip them and retry once before giving up.
        //
        // Stripped from THIS PAYLOAD, not from live `state`. Rebuilding the
        // retry from `state` meant a save of one snapshot could persist a
        // different one: mutate memory while the first attempt is in flight
        // and the retry writes whatever `state` had become, under the
        // identity of a save that was supposed to write the earlier picture.
        // "This save writes this snapshot" is the promise the queue exists
        // to keep, and the failure path was the one place it did not hold.
        console.warn("StorageProvider save failed, retrying with images stripped.",loggableError(error));
        let stripped;
        try{
          const compact=JSON.parse(payload);
          (compact.events||[]).forEach(e=>{if(e.background)e.background.src="";if(e.coverImage)e.coverImage="";});
          stripped=JSON.stringify(compact);
        }catch(parseError){
          // The payload is the only copy of what this save meant; if it
          // cannot be reshaped, fail rather than substitute a different one.
          console.warn("Could not strip images from the queued payload.",loggableError(parseError));
          throw error;
        }
        return saveAndReadBack(stripped).then(()=>{storageRecovered();imagesDropped();});
      })
      .catch(error=>{console.warn("StorageProvider save failed entirely.",loggableError(error));
        const first=!globalThis.MERIT_STORAGE_NOTICE.saveFailing,readBack=!!(error&&error.readBack);
        globalThis.MERIT_STORAGE_NOTICE.saveFailing={at:nowISO(),reason:readBack?"readback":"write"};globalThis.MERIT_STORAGE_NOTICE.dismissed=false;
        if(first){toast(t(readBack?"toast.storageReadBack":"toast.storageFull"),"error",6500);if(getBootReady())render();}});
  }
  // A save that is QUEUED but has not started yet. Each payload is a
  // COMPLETE snapshot of `state`, so a waiting one is not partial work to
  // preserve -- it is an older photograph of the same subject, and replacing
  // it collapses a burst of writes without changing what finally lands.
  let pendingSave=null;
  // Returns the queued write, so a caller can wait for it. It used to return
  // undefined while chaining onto saveQueue, which made `await saveState()`
  // wait for nothing and resolve before a single byte was written -- a test
  // can poll around that; an export about to hand somebody a file cannot.
  // The returned promise never rejects: persistPayload()'s final .catch()
  // always resolves, so awaiting is safe and NOT awaiting raises no
  // unhandled rejection.
  function saveState(show=false){
    // Nothing to persist yet, and persisting now would be actively harmful:
    // `state` is still the boot placeholder until loadV8Async() resolves, so
    // writing it (e.g. from the beforeunload handler firing on a reload that
    // races ahead of the async load) would overwrite real data with a blank
    // slate. See the isMigrationRace regression check in scratchpad.
    if(!getBootReady())return Promise.resolve();
    // REFUSING TO READ MEANS REFUSING TO WRITE. The stored record was
    // written by a newer build; its unrecognised fields are the only copy of
    // somebody's work, and this build saving its own reduced picture over
    // them is exactly the destruction the version check exists to prevent.
    if(globalThis.MERIT_SCHEMA_GUARD&&globalThis.MERIT_SCHEMA_GUARD.readOnly)return Promise.resolve();
    // The same rule for a record that could not be read AND could not be
    // copied aside: saving would overwrite the only copy.
    if(globalThis.MERIT_STORAGE_NOTICE.unreadable&&!globalThis.MERIT_STORAGE_NOTICE.unreadable.kept)return Promise.resolve();
    getState().events.forEach(e=>RULES().syncEventChairs(e));
    let payload;
    try{payload=JSON.stringify(getState());}
    // Not a storage refusal: the state could not be turned into a record at
    // all (a value JSON cannot hold). It used to toast "Browser storage is
    // full" -- which was not what happened -- and then say nothing more
    // while every later save failed the same way.
    catch(error){
      console.warn("State could not be serialised for saving.",loggableError(error));
      const first=!globalThis.MERIT_STORAGE_NOTICE.saveFailing;
      globalThis.MERIT_STORAGE_NOTICE.saveFailing={at:nowISO(),reason:"serialize"};
      if(first){toast(t("toast.notSerializable"),"error",6500);if(getBootReady())render();}
      return Promise.resolve();
    }
    // a later save means a later picture; the close-time snapshot may reuse
    // this payload only within the task that made it
    unloadDone=false;unloadPayload=payload;setTimeout(()=>{unloadPayload=null;},0);
    // COALESCE. The pending slot is already the tail of the queue, so
    // handing it a newer payload keeps last-write-wins exactly: the newest
    // snapshot is still the one that lands, and it still lands last. `show`
    // is OR-ed because a coalesced save must not swallow somebody's request
    // for a confirmation toast.
    if(pendingSave){
      pendingSave.payload=payload;
      pendingSave.show=pendingSave.show||show;
      return pendingSave.promise;
    }
    const slot={payload,show,promise:null};
    pendingSave=slot;
    // Reading slot.payload INSIDE the callback, not closing over the value:
    // everything coalesced between queueing and starting must be picked up.
    slot.promise=saveQueue=saveQueue.then(()=>{
      pendingSave=null;
      return persistPayload(slot.payload,slot.show);
    });
    return slot.promise;
  }
    return{loadV8Async,migrateEvent,parseRecordText,parseRoot,saveState};
  }
  globalThis.MeritShellStorage=Object.freeze({create,DEPS:Object.freeze(["LEGACY_KEYS","RECOVERY","RULES","V8_STORAGE_KEY","blankRoot","getBootReady","getPORTABILITY","getState","loggableError","normalizeGuest","nowISO","render","storageProvider","t","toast","uid"])});
})();
