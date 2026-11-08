(() => {
  "use strict";
  ICONS.upload='<path d="M12 21V9M7 14l5-5 5 5M4 21h16"></path>';
  const V8_STORAGE_KEY = "meritEventMaker.v8";
  const LEGACY_KEYS = ["meritEventMaker.v7", "meritEventMaker.v3", "meritEventMaker.v2", "meritEventMaker.v1"];
  // What a storage failure may put in the console. A SyntaxError from
  // JSON.parse QUOTES the text it failed on -- and a stored record's text is
  // guest names: a record with one missing quote logged `"name": ZEYNEP KAY`
  // three times on a single boot (tests/suites/privacy-logs.test.mjs). For
  // those only the kind of failure survives; the excerpt, and the stack that
  // repeats it, do not. Any other error is logged whole, stack included,
  // because its message names a property or a quota, never a value.
  function loggableError(error){
    if(error&&error.name==="SyntaxError")return "SyntaxError: the stored record is not valid JSON (excerpt withheld: it may contain guest data)";
    return error;
  }
  // StorageProvider selection (src/storage-provider.js). IndexedDB is primary;
  // localStorage under V8_STORAGE_KEY/LEGACY_KEYS is now read-only -- it is
  // still where a pre-existing install's data lives, so it's the migration
  // source on first load, but nothing writes to it again after that.
  // MERIT_STORAGE_STATUS names the store that ACTUALLY holds the data, and
  // is updated if the resilient provider has to fall back after boot.
  const storageProvider = (() => {
    const P = globalThis.MeritStorageProviders;
    if (P?.ResilientStorageProvider) return new P.ResilientStorageProvider(V8_STORAGE_KEY, (p) => {
      globalThis.MERIT_STORAGE_STATUS = { provider: p.name, fallbackReason: p.fallbackReason };
      console.warn("IndexedDB refused to open; persisting to localStorage.");
    });
    try { if (P?.IndexedDBStorageProvider) return new P.IndexedDBStorageProvider(); }
    catch (error) { console.warn("IndexedDB provider unavailable, falling back to localStorage.", loggableError(error)); }
    return new P.LocalStorageStorageProvider(V8_STORAGE_KEY);
  })();
  globalThis.MERIT_STORAGE_STATUS = { provider: storageProvider.name || storageProvider.constructor.name, fallbackReason: storageProvider.fallbackReason || null };
  // Exposed so the training-data crops can be read back and exported without
  // routing image bytes through the state record. Read/write access to the
  // blob store only -- the state record still goes through saveState().
  globalThis.MERIT_STORAGE_PROVIDER = storageProvider;
  const original = {
    render, bindCommon, bindCanvas, bindGuests, bindSeating, bindLive, bindReports,
    floorPlanHTML, seatingHTML, guestsHTML, reportsHTML, inspectorHTML,
    setTableCapacity, inspectorAction, updateInspectorField, deleteSelectedObject,
    startObjectDrag, startResize, startRotate, createTableFromDraft, addVenue,
    openGuestDialog, deleteGuest, assignGuestToTable, unassignGuest, toggleAssignmentLock,
    duplicateEvent, loadXLSX, saveState, touchEvent, openGuide,
    undoCanvas, redoCanvas
  };

  Object.assign(ui, {
    screen:"events", tab:"floor", focusMode:false, v8AddOpen:false,
    selectedObjectIds:[], selectedGuestIds:[], guestAnchorId:null,
    operationalMode:false, reviewFilter:"all", reviewClass:"all", reviewConfidence:0,
    analysisBusy:false, analysisProgress:0, analysisStage:"Ready", analysisAbort:null, analysisStoppedEngines:null, selectedCandidateId:null,
    reviewDrawMode:false, teachAI:false, setupBusy:false,
    // Review is a MODE OF THE FLOOR PLAN, not a screen. It used to replace the
    // whole application shell, which took the event's name, the tab bar and the
    // global guest search away from an operator in the middle of a job -- they
    // could no longer tell which event they were in, and could not look a guest
    // up without abandoning the review. `planMode` is where that lives now, and
    // `ui.screen` stays "workspace" throughout.
    // This is Turkish hospitality/casino operations software: a fresh boot
    // must open in Turkish, not require finding the language toggle first.
    // (This Object.assign runs after app.js's own `const ui={...,lang:"tr"}`
    // and would silently re-clobber it back to English if it disagreed —
    // keep both in sync rather than relying on exactly one of them.)
    lang:"tr", planMode:"plan", reviewQueue:null, reviewCenterOpen:false, difficultQuestionIndex:0, activeReviewGroupId:null, activeQuestionId:null, ocrText:null,
    // The Plan Doctor's full report is opened deliberately. Its verdict and
    // tally are always on screen; the rows -- including the INFORMATION ones,
    // which are worth reading once and are noise in a list scanned every few
    // minutes -- appear when someone runs the pre-flight.
    doctorOpen:false,
    // Which layout change the operator is looking at, if any.
    selectedChangeId:null,
    // Which guest-search result the keyboard is on. -1 means the list is shut.
    findActive:-1,
    // The seating move being previewed, if any. Holding it here rather than in
    // the event is deliberate: a preview is a question, not a change, and it
    // must not survive into stored state.
    seatPreview:null,
    // FREEZE ZONES. The layer is on by default: a freeze is an operational
    // rule, not decoration, and an operator blocked by an invisible rule would
    // have no way to find out what stopped them.
    freezeLayer:true,
    // The operation waiting for a supervisor, if any. It holds a DESCRIPTION of
    // the operation, never a half-applied one -- nothing has moved while this
    // is set, and cancelling leaves the room exactly as it was.
    freezeChallenge:null,
    // The freeze being written, while the form is open.
    freezeDraft:null,
    // ARRIVAL WAVE. The bucket width an operator is reading the evening at, and
    // which wave (or the outstanding VIPs) the Live list is narrowed to. All
    // three are views, never facts: nothing here reaches stored state.
    waveBucket:30, waveKey:null, waveVip:false,
    // SERVICE LOAD. A layer on the same canvas, off by default: unlike a
    // freeze, load is not a rule an operator can be blocked by, so a permanent
    // tint over every table would be decoration rather than information.
    loadLayer:false
  });

  // Stamped with the version this build WRITES. It said 8 after the registry
  // moved to 9, so a brand-new install saved itself as an old record and ran
  // the 8→9 step over data that step never needed.
  function blankRoot(){ const v=globalThis.MeritSchemaMigrations?.CURRENT_VERSION??9; return {version:v, schemaVersion:v, events:[], venues:[], verifiedExamples:[], trainingData:[], teachings:[], operatorSessions:[], analyses:[], calibration:null, audit:[], auditRetention:null, lastBackupAt:null}; }
  // The one writer of the shared activity log. It used to end with
  // `state.audit.slice(0, 1000)` on EVERY write -- a shared log, so a busy
  // door erased its own event's opening entries and the previous event's
  // history with them, and the screen could only warn that something "may
  // have" gone. Retention now lives in src/audit-trail.js, which reports
  // exactly what it dropped; the count is accumulated into
  // state.auditRetention, which is persisted and never itself evicted.
  // Declared HERE, above its earliest caller, not beside the trail
  // rendering further down: a `const` arrow is in its temporal dead zone
  // until the IIFE body reaches it, so audit() and parseRoot() -- both of
  // which can run during boot -- would have thrown ReferenceError.
  // THE ONE WRITER of guest.assignment (src/seat-assignment.js). Eight
  // sites in this file used to assign the field directly; every one of
  // them now goes through here, which is what lets the Guests, Seating
  // and canvas extractions move at all.
  const SEAT=()=>globalThis.MeritSeatAssignment;
  const TRAIL=()=>globalThis.MeritAuditTrail||null;
  function audit(event, action, detail={}){
    const T=TRAIL();
    const entry={id:uid("audit"), eventId:event?.id||null, action, detail, at:nowISO()};
    if(!T){state.audit=[entry,...(state.audit||[])];return;}
    const r=T.append(state.audit||[],entry);
    state.audit=r.log;
    state.auditRetention=T.recordEviction(state.auditRetention||null,r);
  }
  // The event rules (src/event-rules.js, step 3b): whether a change may go
  // ahead is the module's decision; telling the operator why is this shell's.
  const RULES=()=>globalThis.MeritEventRules;
  function canMutate(event, action="change this event"){
    const refusal=RULES().mutationRefusal(event);
    if(refusal==="HISTORICAL")toast(t("toast.historicalReadOnly",{action}), "error", 5200);
    return !refusal;
  }
  // The three quantities live in src/seat-model.js, which owns their
  // definitions for the shell and for every pure module. Aliased here so
  // the shell reads the same answer as everything else rather than keeping
  // a second copy of the arithmetic.
  const SEATS=()=>globalThis.MeritSeatModel;
  const logicalSeatCount=table=>SEATS().logicalSeatCount(table);
  const physicalChairCount=table=>SEATS().physicalChairCount(table);
  const canSeat=table=>SEATS().canSeat(table);
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
    migrated.seatRules=globalThis.MeritSeatingRules?MeritSeatingRules.normalizeAll(migrated.seatRules):(Array.isArray(migrated.seatRules)?migrated.seatRules:[]);
    migrated.freezes=globalThis.MeritSeatingFreeze
      ?MeritSeatingFreeze.normalizeAll(migrated.freezes)
      :(Array.isArray(migrated.freezes)?migrated.freezes:[]);
    // HANDOVER NOTES. An install from before them, or a brand-new blank event,
    // simply has none -- the correct empty state, nothing to reconstruct.
    // Re-normalized on every load like freezes: a hand-edited backup could
    // otherwise carry a note with no text, which would render as a blank line
    // in a log an operator is trusting for what the last shift actually said.
    migrated.handoverNotes=globalThis.MeritEventHandover
      ?MeritEventHandover.resolve(migrated.handoverNotes)
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
        if(!forImport)MERIT_SCHEMA_GUARD={readOnly:true,storedVersion:result.from,buildVersion:SM.CURRENT_VERSION};
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
    if(setAside.length)MERIT_STORAGE_NOTICE.setAside={count:setAside.length,at:setAt,hidden:false};
    parsed.verifiedExamples ||= []; parsed.analyses ||= []; parsed.audit ||= [];
    // Re-normalized on every load, like freezes and handover notes: a
    // hand-edited backup must not be able to claim a loss that never
    // happened, or to lose the record of one that did.
    parsed.auditRetention=globalThis.MeritAuditTrail
      ?MeritAuditTrail.normalizeRetention(parsed.auditRetention)
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
      const result=MeritVenueModel.migrateVenues(parsed);
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
      MERIT_STORAGE_NOTICE.unreadable={kept:true,key,at,raw};
    }catch(error){
      console.warn("Could not keep a copy of the unreadable record; this session will not save.",loggableError(error));
      MERIT_STORAGE_NOTICE.unreadable={kept:false,key:null,at,raw};
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
    if(!bootReady||(globalThis.MERIT_SCHEMA_GUARD&&MERIT_SCHEMA_GUARD.readOnly)||(MERIT_STORAGE_NOTICE.unreadable&&!MERIT_STORAGE_NOTICE.unreadable.kept))return;
    let payload=unloadPayload;
    if(payload==null){try{state.events.forEach(e=>RULES().syncEventChairs(e));payload=JSON.stringify(state);}catch(error){console.warn("Nothing kept when the tab closed: the state could not be serialised.",loggableError(error));return;}}
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
      if(!(globalThis.MERIT_SCHEMA_GUARD&&MERIT_SCHEMA_GUARD.readOnly)){
        // The record was read and would not parse: keep a copy. Or the READ
        // itself failed (storage blocked by another tab, a broken database):
        // nothing is known about what is stored, so nothing may be written
        // over it this session either.
        if(raw!=null)await quarantineUnreadable(raw);
        else MERIT_STORAGE_NOTICE.unreadable={kept:false,key:null,at:nowISO(),raw:null};
      }
    }
    // Writing the recovered picture straight into the primary record is only
    // safe once whatever was there has been copied aside.
    const mayOverwrite=!MERIT_STORAGE_NOTICE.unreadable||MERIT_STORAGE_NOTICE.unreadable.kept;
    // A record from a newer build is not a missing record. Falling through to
    // the legacy reader or a recovery snapshot would present something OLDER
    // as though it were the current one -- harmless to the file, since the
    // guard blocks writes, but a lie on screen.
    if(globalThis.MERIT_SCHEMA_GUARD&&MERIT_SCHEMA_GUARD.readOnly)return{data:blankRoot(),recoveredAt:null};
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
  function storageRecovered(){if(MERIT_STORAGE_NOTICE.saveFailing){MERIT_STORAGE_NOTICE.saveFailing=null;if(bootReady)render();}}
  // The whole payload -- images included -- was stored, so whatever the
  // "images not stored" notice said is no longer true.
  function imagesStored(){if(MERIT_STORAGE_NOTICE.imagesDropped){MERIT_STORAGE_NOTICE.imagesDropped=null;if(bootReady)render();}}
  // Every autosave repeats the strip while the image does not fit, so the
  // notice and its toast are raised once, when the condition begins -- not
  // on every keystroke that saves.
  function imagesDropped(){
    if(MERIT_STORAGE_NOTICE.imagesDropped)return;
    MERIT_STORAGE_NOTICE.imagesDropped={at:nowISO(),hidden:false};
    toast(t("toast.imagesNotStored"),"error",6500);
    if(bootReady)render();
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
      .then(()=>{if(show)toast(t("toast.savedLocally"),"success");lastStoredRaw=payload;clearUnloadJournal();PORTABILITY.autoSnapshot(payload);storageRecovered();imagesStored();})
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
        const first=!MERIT_STORAGE_NOTICE.saveFailing,readBack=!!(error&&error.readBack);
        MERIT_STORAGE_NOTICE.saveFailing={at:nowISO(),reason:readBack?"readback":"write"};MERIT_STORAGE_NOTICE.dismissed=false;
        if(first){toast(t(readBack?"toast.storageReadBack":"toast.storageFull"),"error",6500);if(bootReady)render();}});
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
  saveState = function(show=false){
    // Nothing to persist yet, and persisting now would be actively harmful:
    // `state` is still the boot placeholder until loadV8Async() resolves, so
    // writing it (e.g. from the beforeunload handler firing on a reload that
    // races ahead of the async load) would overwrite real data with a blank
    // slate. See the isMigrationRace regression check in scratchpad.
    if(!bootReady)return Promise.resolve();
    // REFUSING TO READ MEANS REFUSING TO WRITE. The stored record was
    // written by a newer build; its unrecognised fields are the only copy of
    // somebody's work, and this build saving its own reduced picture over
    // them is exactly the destruction the version check exists to prevent.
    if(globalThis.MERIT_SCHEMA_GUARD&&MERIT_SCHEMA_GUARD.readOnly)return Promise.resolve();
    // The same rule for a record that could not be read AND could not be
    // copied aside: saving would overwrite the only copy.
    if(MERIT_STORAGE_NOTICE.unreadable&&!MERIT_STORAGE_NOTICE.unreadable.kept)return Promise.resolve();
    state.events.forEach(e=>RULES().syncEventChairs(e));
    let payload;
    try{payload=JSON.stringify(state);}
    // Not a storage refusal: the state could not be turned into a record at
    // all (a value JSON cannot hold). It used to toast "Browser storage is
    // full" -- which was not what happened -- and then say nothing more
    // while every later save failed the same way.
    catch(error){
      console.warn("State could not be serialised for saving.",loggableError(error));
      const first=!MERIT_STORAGE_NOTICE.saveFailing;
      MERIT_STORAGE_NOTICE.saveFailing={at:nowISO(),reason:"serialize"};
      if(first){toast(t("toast.notSerializable"),"error",6500);if(bootReady)render();}
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
  };
  // Bumped by every mutation that goes through touchEvent, so render-scoped
  // memos (see frozenTableIdSet) can be invalidated by a counter rather than
  // by comparing structures that may have been edited in place.
  let mutationEpoch=0;
  // touchEvent() itself writes no audit entry -- EVENT_UPDATED never carried
  // information nothing else already has (event.lastModified is the same
  // fact, at a single value), and writing one on every single mutation
  // competed with genuine decisions for the same shared, capped audit array
  // (Section 16). Callers that made a real decision call audit() themselves,
  // with a real allowlisted code, before or after touchEvent().
  // Returns the queued write as well, so a caller that must know a mutation
  // reached storage can await it. Every existing caller uses it as a
  // statement, which is unchanged.
  touchEvent = function(event){mutationEpoch++;event.lastModified=nowISO();return saveState();};
  let bootReady=false;
  state=blankRoot();

  seatPositions = function(table){RULES().syncTableChairs(table);return table.chairs.map(c=>({x:c.x,y:c.y,rotation:c.rotation,id:c.id,seatNumber:c.seatNumber}));};
  // WHAT THE ROOM CAN SEAT TONIGHT, and HOW MANY CHAIRS THE PLAN DREW --
  // two different questions, two different numbers, one definition each.
  function seatingCapacity(event){return SEATS().seatingCapacity(event);}
  function physicalCapacity(event){return SEATS().physicalCapacity(event);}
  // Live occupancy — liveUsedIndexes / liveStats — lives in src/occupancy.js
  // (MODULARIZATION-ORDER step 3a) and is reached only through its published
  // object, so a call site says which side of the boundary it is on.
  const OCC=()=>globalThis.MeritOccupancy;
  tableMatchesFilter = function(event,table){
    const used=ui.operationalMode?OCC().liveUsedIndexes(event,table.id):occupiedSeatIndexes(event,table.id);
    // Logical seats, matching the "N EMPTY" badge tableObjectHTML() draws
    // one function below -- the filter and the badge used to disagree on a
    // table whose chairs array was not its capacity.
    const empty=Math.max(0,logicalSeatCount(table)-used.size);
    if(ui.seatingFilter==="empty")return used.size===0;if(ui.seatingFilter==="available")return empty>0;if(ui.seatingFilter==="full")return empty===0;return true;
  };
  filterBannerHTML = function(){
    if(ui.operationalMode&&ui.seatingFilter==="available")return`<div class="operational-banner">${icon("chair")}<b>${t("seating.opView")}</b> ${t("seating.opViewBody")}<button class="tiny-btn" data-clear-seating-filter>${t("seating.clearFilter")}</button></div>`;
    if(ui.seatingFilter==="all")return"";
    return`<div class="filter-banner">${icon("search")}<span>${t({empty:"seating.showingEmpty",available:"seating.showingAvailable",full:"seating.showingFull"}[ui.seatingFilter])}</span><button data-clear-seating-filter aria-label="${esc(t("seating.clearFilter"))}">${icon("x")}</button></div>`;
  };
  // A table committed from a plan keeps the box its SURFACE was drawn at, in
  // percent of its footprint; a table made by hand has none and the stylesheet
  // places its surface. Numbers only, so nothing reaches the style attribute
  // that is not a finite figure.
  function surfaceStyle(table){
    const s=table.surface;if(!s||![s.x,s.y,s.w,s.h].every(Number.isFinite))return"";
    return` style="left:${s.x}%;top:${s.y}%;width:${s.w}%;height:${s.h}%"`;
  }
  tableObjectHTML = function(event,table,seating){
    RULES().syncTableChairs(table);
    const selected=(!seating&&(ui.selectedObjectId===table.id||ui.selectedObjectIds.includes(table.id)))||(seating&&ui.selectedTableId===table.id);
    const highlighted=ui.highlightId===table.id,match=!seating||tableMatchesFilter(event,table);
    const used=seating&&ui.operationalMode?OCC().liveUsedIndexes(event,table.id):occupiedSeatIndexes(event,table.id);
    const assigned=used.size, empty=Math.max(0,table.capacity-assigned);
    // Every entry in `table.chairs` is a chair the plan really has, so all
    // of them draw. A symbolic table's ring stays silent because it has no
    // chairs to draw, not because a filter hides fabricated ones -- the
    // guard that used to stand here (`chair.physical===false?"":...`) was
    // the last consumer of a flag that only existed to disown coordinates
    // this code should never have written. Seat NUMBERS are unaffected:
    // they come from capacity, via the seat list and the S-labels in the
    // reports, not from this array.
    const chairs=table.chairs.map((chair,index)=>`<i class="chair ${used.has(index)?"occupied":seating&&ui.operationalMode?"available-live":""}${chair.facing===null?" facing-unknown":""}" data-chair-id="${chair.id}" style="left:${chair.x}%;top:${chair.y}%;transform:translate(-50%,-50%) rotate(${chair.rotation||0}deg)"></i>${ui.showSeats?`<span class="seat-number" style="left:${50+(chair.x-50)*.69}%;top:${50+(chair.y-50)*.69}">S${chair.seatNumber}</span>`:""}`).join("");
    // THE FREEZE ZONES LAYER. A thin outline and a small mark, never an opaque
    // block: the operator has to keep reading the room through it, and a plan
    // covered in filled shapes is a plan nobody can work on. Hidden entirely
    // when the layer is off, so the marks never become permanent chrome.
    const frozen=ui.freezeLayer&&frozenTableIdSet(event).has(table.id);
    // A TABLE OUT OF SERVICE. Unlike the freeze layer above, this is never
    // gated behind a toggle: it is a fact about whether the table exists for
    // this event tonight, not an optional advisory layer, so it stays visible
    // whichever layers are on or off.
    const A=AVAIL();
    const unavailable=A&&A.isUnavailable(table);
    // THE SERVICE LOAD LAYER. A band on the table's own surface — never a blob
    // over the drawing, and never a smooth field interpolated between tables,
    // which would invent a figure for floor the product knows nothing about.
    const loadRow=ui.loadLayer?LOADPANEL.loadBandMap(event)?.get(table.id):null;
    return`<div class="table-object ${esc(table.type)} ${selected?"selected multi-selected":""} ${highlighted?"highlighted":""} ${frozen?"frozen":""} ${unavailable?"unavailable":""} ${loadRow?"load-"+loadRow.band:""} ${seating&&!match?"dimmed":""} ${seating&&match&&ui.seatingFilter!=="all"?"filter-match operational-match":""}" data-object-id="${table.id}" data-object-kind="table" tabindex="0" role="button" aria-pressed="${selected?"true":"false"}" aria-label="${esc([t("a11y.table",{number:formatTableNumber(table.number),seated:assigned,capacity:table.capacity}),frozen?t("a11y.frozen"):"",unavailable?t("a11y.unavailable"):""].filter(Boolean).join(", "))}" style="left:${table.x}px;top:${table.y}px;width:${table.w}px;height:${table.h}px;transform:rotate(${table.rotation||0}deg);z-index:${table.z||10}">${chairs}<div class="table-surface"${surfaceStyle(table)}><span class="table-label">${esc(formatTableNumber(table.number))}</span><span class="table-occ">${seating?assigned+" / ":""}${table.capacity}</span>${frozen?`<span class="table-frozen" title="${esc(t("freeze.tableFrozen"))}">${icon("lock")}</span>`:""}${unavailable?`<span class="table-unavailable" title="${esc(t("avail.tableUnavailable"))}">${icon("alert")}</span>`:""}${seating&&ui.seatingFilter==="available"&&empty?`<span class="table-empty">${esc(t("seating.emptySeats",{n:empty}))}</span>`:""}</div>${selected&&!seating?handlesHTML():""}</div>`;
  };

  function planIssues(event){
    // "Are there more people than seats" is a question about OPERATIONAL
    // capacity, not about how many chairs the drawing depicted. Asked with
    // physicalCapacity(), a 420-table symbolic plan answered zero and every
    // event on it opened with a false capacity BLOCKER.
    const issues=[],numbers=new Set(),capacity=seatingCapacity(event),pax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    // Each issue carries a stable `code` so callers can route on it without
    // string-matching a translated title.
    for(const table of event.tables){if(numbers.has(table.number))issues.push({level:"blocker",code:"duplicateTable",fix:"floor",title:t("health.issue.duplicateTable"),text:t("health.issue.duplicateTableText",{number:table.number})});numbers.add(table.number);}
    if(!event.tables.length)issues.push({level:"warn",code:"blankPlan",fix:"floor",title:t("health.issue.blankPlan"),text:t("health.issue.blankPlanText")});
    if(pax>capacity)issues.push({level:"blocker",code:"capacityExceeded",fix:"floor",title:t("health.issue.capacityExceeded"),text:t("health.issue.capacityExceededText",{pax,capacity})});
    const unassigned=event.guests.filter(g=>!g.assignment).reduce((n,g)=>n+paxOf(g),0);if(unassigned)issues.push({level:"warn",code:"unassigned",fix:"seating",title:t("health.issue.unassigned"),text:t("health.issue.unassignedText",{n:unassigned})});
    return issues;
  }
  // Two controls in one header row must not answer the same question twice.
  // Once the Command Center exists it owns "is this event ready", so the header
  // badge stops being a second, smaller, slightly different list and becomes
  // the way in: same dot, same count, one place to act. It counts what the
  // Command Center counts -- plan issues AND open plan questions AND
  // inconsistent checks -- so the two can never disagree the way the status
  // pill and the review chip did before B1.
  //
  // A historical event has no Command Center to open, so it keeps the popover.
  function planHealthHTML(event){
    if(RULES().isHistorical(event)){
      const issues=planIssues(event),level=issues.some(x=>x.level==="blocker")?"blocker":issues.length?"warn":"";
      return`<details class="plan-health"><summary><i class="health-dot ${level}"></i>${t("health.planHealth")}${issues.length?` · ${issues.length}`:` · ${t("health.ready")}`}</summary><div class="health-pop">${issues.length?issues.map(x=>`<div class="health-item"><i class="health-dot ${x.level}"></i><div><b>${esc(x.title)}</b><span>${esc(x.text)}</span></div></div>`).join(""):`<div class="health-item"><i class="health-dot"></i><div><b>${t("health.noBlockingIssues")}</b><span>${t("health.consistent")}</span></div></div>`}</div></details>`;
    }
    const r=eventReadiness(event);
    const level=r.verdict==="notReady"||r.verdict==="liveRisk"?"blocker":r.verdict==="readyWithReview"?"warn":"";
    const value=r.reasons.length?String(r.reasons.length):t("health.ready");
    return`<button class="plan-health-badge ${level}" data-tab="command" title="${esc(t("cc.badge.title"))}"><i class="health-dot ${level}"></i>${t("cc.badge.label")} · ${esc(value)}</button>`;
  }
  // ---- the Event Command Center ---------------------------------------------
  //
  // One question: IS THIS EVENT READY, AND WHAT DESERVES MY ATTENTION NOW?
  //
  // It is not a dashboard and not a second Live screen. Live already owns the
  // operational counts and the check-in flow, and none of that moves here --
  // a number belongs where it is acted on. This states what is wrong, and
  // takes you to the screen that owns the fix.
  //
  // It runs no engine of its own. Every line below comes from something that
  // already concluded it: planIssues(), the Confidence Budget, the Self-Check,
  // and the guest/seating state. Inventing a second opinion here would be the
  // parallel-system mistake the programme forbids.
  //
  // PHASE (ready / live / closed, MeritEventRules.phase) changes what is
  // emphasised, never what is available.
  // ---- the Plan Doctor ------------------------------------------------------
  //
  // The pre-flight check, and now the ONE place the whole event is judged. The
  // engine is src/plan-doctor.js; this is the wiring, and it exists so that
  // nothing in the product forms a second opinion about whether the event is
  // ready. Before it, the header badge, the readiness verdict and the reason
  // list each assembled their own view from planIssues() and the analysis, and
  // keeping three assemblies in agreement was a matter of care rather than
  // architecture. There is one assembly now and everything reads it.
  //
  // Derived on every call, never stored: a problem an operator has just fixed
  // is gone from the next render by construction, which is the only way to be
  // sure a resolved warning never lingers.
  // ---- FREEZE ZONES: one resolution, read by everything ---------------------
  //
  // Every surface that needs to know whether a table is frozen goes through
  // these two functions, so the recommender, the canvas, the Plan Doctor and
  // the override challenge cannot end up disagreeing about which tables a rule
  // covers. The RULES themselves live only in src/seating-freeze.js.
  const FREEZE=()=>globalThis.MeritSeatingFreeze||null;
  function eventFreezes(event){return (event&&event.freezes)||[];}
  function resolvedFreezes(event){
    const F=FREEZE();
    if(!F||!event)return null;
    return F.resolve(eventFreezes(event),event.tables||[]);
  }
  // ---- TABLE AVAILABILITY: one resolution, read by everything ---------------
  //
  // Same discipline as freezes, one line up: the recommender, the Plan
  // Doctor and the canvas all read the SAME resolved answer, so none of them
  // can end up disagreeing about which tables cannot be used tonight. The
  // RULE itself — what UNAVAILABLE means — lives only in
  // src/table-availability.js; a table's own `.availability` field is set by
  // setTableAvailability(), the single writer, below.
  const AVAIL=()=>globalThis.MeritTableAvailability||null;
  // ---- CAPACITY PROVENANCE: read-only, never set from a render path ---------
  //
  // The Data Provenance Inspector only ever DISPLAYS table.capacitySource --
  // it has no write path of its own. Letting an operator hand-pick a source
  // value here would let them claim DETECTED_PHYSICAL_SEATS or
  // HUMAN_CONFIRMED without the fact actually being true, the same failure
  // mode "DOMAIN MODEL NOT INSTALLED" exists to prevent for AI claims. The
  // only writers remain createTable/createTableFromDraft/setTableCapacity/
  // commitCandidates, per src/capacity-provenance.js.
  const CAPPROV=()=>globalThis.MeritCapacityProvenance||null;
  const capacitySourceKey=s=>"capacitySource."+String(s||"UNKNOWN").toLowerCase().replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
  // ---- WHERE A TABLE'S FACTS CAME FROM (§21) ---------------------------------
  // Measured before this: of the facts shown for a table, only its capacity
  // said where it came from. A table confirmed from Assisted Detection lost the
  // OCR reading of the number printed on its own symbol the moment it was
  // confirmed, and was numbered T01, T02... in confirmation order -- so a plan
  // that prints "42" on a table showed "T 01" with nothing to say the two
  // disagree. The evidence now travels with the table and is shown beside it.
  // All read-only: these are written only where the fact is made
  // (commitCandidates, createTable, duplicateSelection), never picked here.
  const TABLE_ORIGINS=new Set(["DETECTED","MANUAL","COPY"]);
  const PRINTED_STATES=new Set(["VERIFIED","LIKELY","NEEDS_REVIEW","UNKNOWN"]);
  // What survives of a reading: its value, its state and where it came from --
  // nothing else, and nothing of a shape this build does not know (a package
  // from elsewhere is untrusted input).
  function printedEvidence(p){
    if(!p||typeof p!=="object"||!PRINTED_STATES.has(p.state))return null;
    const value=typeof p.value==="number"&&Number.isFinite(p.value)?p.value:typeof p.value==="string"&&p.value.length<=12?p.value:null;
    return{value,state:p.state,confidence:typeof p.confidence==="number"?p.confidence:null,source:"OCR"};
  }
  function tableProvenanceHTML(t_){
    const row=(k,v,extra="")=>`<div class="contextual-card-provenance${extra}"><span>${esc(t(k))}</span><b>${esc(v)}</b></div>`;
    const origin=TABLE_ORIGINS.has(t_.origin)?t_.origin:"UNKNOWN";
    const rows=[];
    if(CAPPROV())rows.push(row("inspector.capacitySource",t(capacitySourceKey(t_.capacitySource))));
    const ev_=t_.capacityEvidence;
    if(ev_&&ev_.rule)rows.push(`<div class="contextual-card-provenance" data-capacity-evidence><span>${esc(t("provenance.capacityRule"))}</span><b>${esc(ev_.confirmedBy?t("provenance.capacityRuleConfirmed",{rule:ev_.rule,previous:ev_.previous??"—"}):t("provenance.capacityRuleValue",{rule:ev_.rule}))}</b></div>`);
    rows.push(row("provenance.origin",t("provenance.origin."+origin)));
    const p=printedEvidence(t_.printedNumber);
    if(origin==="DETECTED"){
      rows.push(row("provenance.printed",p&&p.value!=null?t("provenance.printedValue",{value:p.value,state:t("number.state."+p.state)}):t("provenance.printedNone")));
      // The disagreement is stated, not resolved: which number the room uses
      // is a person's decision, and nothing here renames anything.
      const digits=String(t_.number||"").replace(/\D+/g,"").replace(/^0+/,"");
      if(p&&p.state==="VERIFIED"&&p.value!=null&&String(p.value).replace(/^0+/,"")!==digits)
        rows.push(`<div class="contextual-card-provenance is-mismatch" data-printed-mismatch>${esc(t("provenance.printedMismatch",{printed:p.value,number:formatTableNumber(t_.number)}))}</div>`);
    }
    return rows.join("");
  }
  function resolvedUnavailable(event){
    const A=AVAIL();
    if(!A||!event)return null;
    return A.resolve(event.tables||[]);
  }
  // ---- INTERACTIVE FIRST-RUN ONBOARDING (Section 12) -------------------------
  //
  // A handful of short, dismissible, feature-anchored callouts -- never a
  // sequential "step N of M" tour, and never a second, driftable explanation
  // of domain rules the User Guide (app-guests.js's renderGuide()) already
  // owns. `state.onboarding` lives on `state` itself, exactly like
  // `state.audit` -- local-only, never part of an `event`, so it is never
  // subject to canMutate/isHistorical, never exported in a package, and
  // never resets when a person switches events. dismissOnboarding() is the
  // one writer; every callout site below only READS onboardingSeen().
  function onboardingSeen(key){return !!(state.onboarding&&state.onboarding.seen&&state.onboarding.seen[key]);}
  function dismissOnboarding(key){
    state.onboarding=state.onboarding||{seen:{}};
    state.onboarding.seen=state.onboarding.seen||{};
    state.onboarding.seen[key]=true;
    saveState();render();
  }
  // Reachable again anytime from Help -- staff turnover means a new hire
  // starts on day 40 of the product's life, not day 1, so this is never a
  // one-shot the operator can permanently lose. Called from this file's own
  // renderGuide() override below (app-guests.js's version of renderGuide is
  // shadowed the same way contextualCardHTML and friends are).
  function resetOnboarding(){
    state.onboarding={seen:{}};
    saveState();render();
  }
  // ONE AT A TIME (§20). A first-day operator on Seating saw three tips at
  // once -- the Global Finder banner, Freeze Zones and Smart Seating -- which
  // is the warning flood the quality gates forbid. The first callout a render
  // asks for is shown; the others wait until it is dismissed. render() clears
  // the slot, and a partial re-render of the SAME callout is still allowed.
  let calloutThisRender=null;
  function onboardingCalloutHTML(key){
    if(onboardingSeen(key))return"";
    if(calloutThisRender&&calloutThisRender!==key)return"";
    calloutThisRender=key;
    return`<div class="onboarding-callout" data-onboarding="${key}"><span>${t("onboarding."+key)}</span><button class="btn sm quiet" data-onboarding-dismiss="${key}">${t("onboarding.gotIt")}</button></div>`;
  }
  // tableObjectHTML runs once per table, so resolving the rules inside it would
  // make the canvas O(tables x freezes) PER TABLE -- 160,000 comparisons a
  // render on the 400-table fixture for a feature most events never use. The
  // memo is invalidated by touchEvent()'s epoch rather than by comparing
  // contents, because a freeze edited in place would not change any identity.
  let frozenMemo={event:null,epoch:-1,set:new Set()};
  function frozenTableIdSet(event){
    const F=FREEZE();
    if(!F||!event)return new Set();
    if(frozenMemo.event===event&&frozenMemo.epoch===mutationEpoch)return frozenMemo.set;
    frozenMemo={event,epoch:mutationEpoch,
      set:F.frozenTableIds(eventFreezes(event),event.tables||[])};
    return frozenMemo.set;
  }
  // ---- EVENT HANDOVER: the note log, one writer -----------------------------
  //
  // src/event-handover.js owns the shape of a note and nothing else — it does
  // not know what a table or a guest is. The "state of the event" half of
  // Handover is composed directly in eventHandoverHTML() below from facts that
  // already have a single source (Plan Doctor, liveStats, eventMetrics, Freeze
  // Zones, Table Availability), so this never becomes a second place those
  // numbers could disagree.
  const HANDOVER=()=>globalThis.MeritEventHandover||null;
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
    return T.resolve(state.audit,event.id);
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
          ?t("audit.tableMarkedUnavailable",{number:tableNumber(d.tableId),reason:SEATCMD.availReasonText(d.reason)})
          :t("audit.tableMarkedAvailable",{number:tableNumber(d.tableId)});
      case"FREEZE_CREATED":
        return t("audit.freezeCreated",{reason:SEATCMD.freezeReasonText(d.reason)});
      case"FREEZE_LIFTED":
        return t("audit.freezeLifted",{reason:SEATCMD.freezeReasonText(d.reason)});
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

  // THE ONE RISK THAT CANNOT BE RECOVERED FROM ON THE NIGHT.
  //
  // Everything this product knows lives in one browser profile. `lastBackupAt`
  // is recorded when an export actually succeeds — never when one is merely
  // offered — so "backed up" on the radar means a file really left the browser.
  function backupState(event){
    const at=state.lastBackupAt||null;
    if(!event)return{at,staleBy:false};
    const changed=event.lastModified||event.createdAt||null;
    return{at,staleBy:!!(at&&changed&&changed>at)};
  }

  function planDoctorReport(event){
    if(!event||!globalThis.MeritPlanDoctor)return null;
    return globalThis.MeritPlanDoctor.run({
      phase:RULES().phase(event),
      tables:event.tables||[],
      guests:event.guests||[],
      // What a person has held back, resolved here — with the REASON each table
      // was held, because "a reserve that already has guests in it" is a
      // contradiction and "a VIP area protecting the people in it" is not.
      frozen:resolvedFreezes(event)||[],
      // Tables a person took out of service, resolved the same way. The
      // Doctor does not decide WHICH tables fail — table-availability.js does
      // — it only reports what a failed one does to the room.
      unavailable:resolvedUnavailable(event)||[],
      // When a copy was last taken, and whether this event has moved since.
      // The Doctor stores nothing; this is read fresh like everything else.
      backup:backupState(event),
      // The rules planIssues() owns, handed over rather than re-implemented.
      // Whatever the Doctor does not express itself still reaches the operator.
      planIssues:planIssues(event),
      analysis:event.analysis||null,
    });
  }
  // The verdict is one of four named states, never a percentage. A number like
  // "92% ready" has to come from somewhere, and there is no honest weighting of
  // "one duplicate table number" against "twelve unseated guests" -- so the
  // product says which of four situations it is in, and lists the reasons.
  //
  // BLOCKING and NEEDS REVIEW become reasons; INFORMATION does not. That is the
  // difference between the two: information is worth knowing and demands
  // nothing, and putting it in the attention list would teach an operator that
  // the list is safe to ignore.
  // The four states are the Plan Doctor's own answer (MeritPlanDoctor.radar);
  // this only gathers what the Command Center shows beside it.
  function eventReadiness(event){
    const doctor=planDoctorReport(event);
    const m=eventMetrics(event);
    const budget=event.analysis?.confidenceBudget||null;
    const inconsistent=(event.analysis?.selfCheck?.checks||[]).filter(c=>c.verdict==="INCONSISTENT");
    const {verdict,reasons}=globalThis.MeritPlanDoctor?globalThis.MeritPlanDoctor.radar(doctor):{verdict:"ready",reasons:[]};
    return{phase:RULES().phase(event),verdict,reasons,metrics:m,budget,inconsistent,doctor};
  }
  // ---- moved to src/screen-command.js — see that file's header. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. ----------------------------
  const COMMAND=globalThis.MeritScreenCommand.create({
    activeEvent:(...a)=>activeEvent(...a),addHandoverNote:(...a)=>addHandoverNote(...a),AVAIL:(...a)=>AVAIL(...a),canMutate:(...a)=>canMutate(...a),doctorSignature:(...a)=>doctorSignature(...a),esc:(...a)=>esc(...a),eventMetrics:(...a)=>eventMetrics(...a),eventReadiness:(...a)=>eventReadiness(...a),exportBackup:(...a)=>PORTABILITY.exportBackup(...a),fmtDate:(...a)=>fmtDate(...a),getLive:()=>LIVE,HANDOVER:(...a)=>HANDOVER(...a),OCC:(...a)=>OCC(...a),onboardingCalloutHTML:(...a)=>onboardingCalloutHTML(...a),paxOf:(...a)=>paxOf(...a),planDoctorReport:(...a)=>planDoctorReport(...a),recordFinalCheck:(...a)=>recordFinalCheck(...a),relativeTime:(...a)=>relativeTime(...a),render:(...a)=>render(...a),resolvedFreezes:(...a)=>resolvedFreezes(...a),resolvedHandoverNotes:(...a)=>resolvedHandoverNotes(...a),resolvedUnavailable:(...a)=>resolvedUnavailable(...a),RULES:(...a)=>RULES(...a),seatingCapacity:(...a)=>seatingCapacity(...a),serviceLoadHTML:(...a)=>LOADPANEL.serviceLoadHTML(...a),t:(...a)=>t(...a),toast:(...a)=>toast(...a),touchEvent:(...a)=>touchEvent(...a),ui,
  });
  // What was checked, reduced to something two runs can be compared on. Codes
  // and counts, not wording: a translation change must not read as the event
  // having changed underneath the operator.
  function doctorSignature(d){
    return d.all.map(f=>f.code+"="+(f.weight??0)).sort().join("|");
  }
  // The one writer of event.finalCheck: a person ran the pre-flight. It stays
  // in the shell with the other writers; the Command Center calls it.
  //
  // Recording that a person ran the pre-flight is a mutation of the event, so
  // it goes through canMutate like everything else -- a historical event has no
  // Command Center to run it from, and must not acquire one here.
  function recordFinalCheck(event,d){
    if(!d||!canMutate(event,"run the final check"))return;
    event.finalCheck={at:nowISO(),verdict:d.verdict,signature:doctorSignature(d),
      counts:{...d.counts}};
    touchEvent(event);
  }

  // ---- moved to src/screen-events.js — see that file's header. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. ----------------------------
  // The one top bar (src/screen-topbar.js, redesign step 1): markup and the
  // light/dark choice only; every control in it is bound below by the same
  // binder as before, so no writer moved.
  const TOPBAR=globalThis.MeritScreenTopbar.create({esc:(...a)=>esc(...a),t:(...a)=>t(...a)});
  function shellBarHTML(ctx){
    return TOPBAR.barHTML({...ctx,diskBackup:!!(globalThis.MeritDiskBackup&&globalThis.MeritDiskBackup.available())});
  }
  // "Hazır mı?" on the calendar: the Plan Doctor's reasons in the Command
  // Center's own words — one judge, one wording.
  function calendarReadiness(event){
    return eventReadiness(event).reasons.map(r=>({level:r.level==="blocker"?"blocker":"warn",text:COMMAND.doctorText(r.finding).what}));
  }
  const EVENTS=globalThis.MeritScreenEvents.create({
    skin:()=>TOPBAR.skin.current(),esc:(...a)=>esc(...a),eventMetrics:(...a)=>eventMetrics(...a),fmtDate:(...a)=>fmtDate(...a),getActiveId:()=>ui.activeEventId,getState:()=>state,icon:(...a)=>icon(...a),readiness:(...a)=>calendarReadiness(...a),RULES:(...a)=>RULES(...a),seatingCapacity:(...a)=>seatingCapacity(...a),t:(...a)=>t(...a),topbarHTML:(...a)=>shellBarHTML(...a),
  });
  eventsHTML = function(...a){return EVENTS.eventsHTML(...a);};

  // The Command Center leads because it is the only screen that answers a
  // question about the WHOLE event; in the one top bar it is "Etkinlik", the
  // event's overview. Historical events do not get one -- a finished event has
  // no readiness to assess, and "12 guests unassigned" on a closed night is
  // noise, not a finding -- nor a Floor Plan or Live screen.
  const historyTabs=["guests","seating","reports"];
  workspaceHTML = function(event){
    const historical=RULES().isHistorical(event);
    const tabs=historical?historyTabs:["command","floor","guests","seating","live","reports"];
    if(!tabs.includes(ui.tab))ui.tab=tabs[0];
    const sub=[fmtDate(event.date),[event.hotel,event.salon].filter(Boolean).join(" · ")||t("appbar.venueNotSet")].join(" · ");
    const bar=shellBarHTML({screen:"workspace",current:ui.tab,historical,event:{name:event.name,sub},planHealth:planHealthHTML(event),progress:historical?null:TOPBAR.stepProgress(event)});
    return`<section class="workspace ${ui.focusMode?"v8-focus":""}">${bar}${historical?`<div class="workspace-readonly-banner">${icon("lock")}${t("nav.historicalBanner")}</div>`:ui.focusMode?"":onboardingCalloutHTML("globalFinder")}<div class="content">${tabContent(event)}</div>${ui.focusMode?`<button class="focus-exit" data-v8-action="focus">${t("nav.exitFocus")}</button>`:""}</section>`;
  };
  tabContent = function(event){
    if(RULES().isHistorical(event)){
      if(ui.tab==="guests")return`<div class="readonly-screen">${readonlyGuestsHTML(event)}</div>`;
      if(ui.tab==="seating")return`<div class="v8-lock">${seatingHTML(event)}</div>`;
      return reportsHTML(event);
    }
    if(ui.tab==="command")return COMMAND.commandCenterHTML(event);
    // One tab, two modes on the same drawing. Review used to be a screen that
    // replaced the shell; it is a mode now, so the event identity, the tab bar
    // and the global guest search survive the trip.
    if(ui.tab==="floor")return ui.planMode==="review"?REVIEW.analysisHTML(event)
      :ui.planMode==="changes"?LAYOUTCHG.layoutChangesHTML(event):floorPlanHTML(event);
    if(ui.tab==="guests")return guestsHTML(event);if(ui.tab==="seating")return seatingHTML(event);if(ui.tab==="live")return liveHTML(event);return reportsHTML(event);
  };
  function readonlyGuestsHTML(event){
    // Stored values (planning / arrival status, VIP level) are shown through
    // their labels; the records themselves are untouched (§18).
    return`<div class="screen-inner"><div class="readonly-note">${icon("lock")}${t("history.guestsReadOnly")}</div><div class="screen-titlebar"><div><h2>${t("guests.title")}</h2><p>${t("history.guestsCount",{n:event.guests.length,pax:eventMetrics(event).guests})}</p></div></div><div class="guest-shell"><table class="guest-table"><thead><tr><th>${t("guests.col.name")}</th><th>${t("guests.col.pax")}</th><th>${t("history.col.planning")}</th><th>${t("history.col.arrival")}</th><th>${t("guests.col.vip")}</th><th>${t("guests.col.invitedBy")}</th><th>${t("guests.col.tableSeat")}</th><th>${t("guests.col.notes")}</th></tr></thead><tbody>${event.guests.map(g=>{
      const tb=event.tables.find(x=>x.id===g.assignment?.tableId);
      return`<tr><td><b>${esc(g.name)}</b></td><td>${paxOf(g)}</td><td>${esc(t("status.planning."+g.planningStatus))}</td><td>${esc(t("status.arrival."+g.arrivalStatus))}</td><td>${esc(vipLabel(g.vip))}</td><td>${esc(g.invitedBy||"—")}</td><td>${tb?esc(tb.number)+" · "+esc(seatRange(g.assignment.seats)):"—"}</td><td>${esc(g.notes||"")}</td></tr>`
    }).join("")||`<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">${t("history.noGuests")}</td></tr>`}</tbody></table></div></div>`;
  }

  const SETUP=globalThis.MeritScreenSetup.create({
    audit:(...a)=>audit(...a),clone:(...a)=>clone(...a),esc:(...a)=>esc(...a),getState:()=>state,icon:(...a)=>icon(...a),
    migrateEvent:(...a)=>migrateEvent(...a),nowISO:(...a)=>nowISO(...a),openEvent:(...a)=>openEvent(...a),render:(...a)=>render(...a),
    saveState:(...a)=>saveState(...a),t:(...a)=>t(...a),toast:(...a)=>toast(...a),topBrand:(...a)=>topBrand(...a),ui,uid:(...a)=>uid(...a),
    userError:(...a)=>userError(...a),userMessage:(...a)=>userMessage(...a),
  });

  // ============================================================
  // Concept 3 — map-first Floor Plan workspace.
  // No permanent left object list, no permanent right technical inspector.
  // The plan fills the whole surface; a handful of floating elements provide
  // tools, and a small contextual card appears ONLY when something is
  // selected (data-inspector/-action attributes match base app.js's
  // bindInspector exactly, so no rebinding is needed here).
  // ============================================================
  // The Floor Plan's two modes, in one control that looks and sits the same in
  // both of them. Editing the plan and reviewing what was read off it are two
  // jobs on the same drawing, so they are two modes of one screen rather than
  // two screens -- and the switch between them must not look like navigation,
  // because it is not: the event, the tabs and the guest search do not move.
  // ---- SMART GUEST FINDER ---------------------------------------------------
  //
  // The global search was a name-and-table lookup that offered one destination.
  // At a door the question is rarely "where is this name" on its own — it is
  // "who is this, are they expected, have they arrived, where do they sit, and
  // who came with them", and then one action. This answers all of that in the
  // row, and offers the four things an operator actually does next.
  //
  // The matching engine — which guests a query means, the typeahead's ranking
  // and who came with whom — is MeritGuestSearch (src/guest-search.js). One
  // engine for both surfaces: the finder below and Live's door search.
  const SEARCH=globalThis.MeritGuestSearch.create({formatNumber:n=>formatTableNumber(n)});
  const FINDER=globalThis.MeritScreenFinder.create({
    RULES:(...a)=>RULES(...a),SEARCH,activeEvent:(...a)=>activeEvent(...a),additionalOf:(...a)=>additionalOf(...a),canMutate:(...a)=>canMutate(...a),
    esc:(...a)=>esc(...a),formatTableNumber:(...a)=>formatTableNumber(...a),paxOf:(...a)=>paxOf(...a),render:(...a)=>render(...a),
    seatRange:(...a)=>seatRange(...a),setArrival:(...a)=>ARRIVAL.setArrival(...a),t:(...a)=>t(...a),toast:(...a)=>toast(...a),touchEvent:(...a)=>touchEvent(...a),
    ui,
  });
  renderGlobalSearch = function(...a){return FINDER.renderGlobalSearch(...a);};
  // ---- moved to src/screen-floor-plan.js — see that file's header. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. ----------------------------
  const FLOORPLAN=globalThis.MeritScreenFloorPlan.create({
    esc:(...a)=>esc(...a),eventFreezes:(...a)=>eventFreezes(...a),formatTableNumber:(...a)=>formatTableNumber(...a),getState:()=>state,getUnverifiedSeating:()=>UNVERIFIED_SEATING,icon:(...a)=>icon(...a),reviewGroupCount:(...a)=>REVIEW.reviewGroupCount(...a),shownCols:(...a)=>PLANVIEW.shownCols(...a),t:(...a)=>t(...a),tableAssignedPax:(...a)=>tableAssignedPax(...a),tableProvenanceHTML:(...a)=>tableProvenanceHTML(...a),toolbarBtn:(...a)=>toolbarBtn(...a),ui,VENUE:(...a)=>VENUE(...a),ZONES,
  });
  const PLANVIEW=globalThis.MeritFloorPlanView.create({
    FLOORPLAN,WORLD,activeEvent:(...a)=>activeEvent(...a),applyCanvasTransform:(...a)=>applyCanvasTransform(...a),esc:(...a)=>esc(...a),
    floorAnalyseHTML:(...a)=>EMPTY.floorAnalyseHTML(...a),floorEmptyHTML:(...a)=>EMPTY.floorEmptyHTML(...a),t:(...a)=>t(...a),ui,worldSize:(...a)=>worldSize(...a),
  });
  fitCanvas = function(...a){return PLANVIEW.fitCanvas(...a);};
  canvasViewportHTML = function(...a){return PLANVIEW.canvasViewportHTML(...a);};
  floorPlanHTML = function(...a){return PLANVIEW.floorPlanHTML(...a);};
  const EMPTY=globalThis.MeritEmptyStates.create({
    RULES:(...a)=>RULES(...a),esc:(...a)=>esc(...a),icon:(...a)=>icon(...a),render:(...a)=>render(...a),t:(...a)=>t(...a),ui,
  });

  // The venue model accessor, read by the layout-change screen and the shell.
  const VENUE=()=>globalThis.MeritVenueModel;
  const LAYOUTCHG=globalThis.MeritScreenLayoutChanges.create({
    FLOORPLAN,RULES:(...a)=>RULES(...a),VENUE:(...a)=>VENUE(...a),activeEvent:(...a)=>activeEvent(...a),audit:(...a)=>audit(...a),
    canMutate:(...a)=>canMutate(...a),canvasViewportHTML:(...a)=>canvasViewportHTML(...a),esc:(...a)=>esc(...a),getState:()=>state,
    nowISO:(...a)=>nowISO(...a),render:(...a)=>render(...a),t:(...a)=>t(...a),touchEvent:(...a)=>touchEvent(...a),ui,
  });

  const PLANEDIT=globalThis.MeritFloorPlanEditing.create({
    PLANVIEW,RULES:(...a)=>RULES(...a),SEAT:(...a)=>SEAT(...a),activeEvent:(...a)=>activeEvent(...a),ask:(...a)=>ask(...a),
    canMutate:(...a)=>canMutate(...a),canvasSnapshot:(...a)=>canvasSnapshot(...a),clone:(...a)=>clone(...a),fitCanvas:(...a)=>fitCanvas(...a),
    formatTableNumber:(...a)=>formatTableNumber(...a),getSEATCMD:()=>SEATCMD,nowISO:(...a)=>nowISO(...a),original,recordUndo:(...a)=>recordUndo(...a),
    render:(...a)=>render(...a),repackTableAssignments:(...a)=>repackTableAssignments(...a),runAssistedDetection:(...a)=>runAssistedDetection(...a),
    saveState:(...a)=>saveState(...a),t:(...a)=>t(...a),tableAssignedPax:(...a)=>tableAssignedPax(...a),toast:(...a)=>toast(...a),
    touchEvent:(...a)=>touchEvent(...a),ui,uid:(...a)=>uid(...a),
  });
  startObjectDrag = function(...a){return PLANEDIT.startObjectDrag(...a);};
  setTableCapacity = function(...a){return PLANEDIT.setTableCapacity(...a);};
  updateInspectorField = function(...a){return PLANEDIT.updateInspectorField(...a);};
  inspectorAction = function(...a){return PLANEDIT.inspectorAction(...a);};
  deleteSelectedObject = function(...a){return PLANEDIT.deleteSelectedObject(...a);};
  startResize = function(...a){return PLANEDIT.startResize(...a);};
  startRotate = function(...a){return PLANEDIT.startRotate(...a);};
  createTableFromDraft = function(...a){return PLANEDIT.createTableFromDraft(...a);};
  addVenue = function(...a){return PLANEDIT.addVenue(...a);};
  undoCanvas = function(...a){return PLANEDIT.undoCanvas(...a);};
  redoCanvas = function(...a){return PLANEDIT.redoCanvas(...a);};
  bindCanvas = function(...a){return PLANEDIT.bindCanvas(...a);};
  // One lookup table per call instead of a linear scan per guest. These
  // filters ran `event.tables.find(...)` INSIDE a per-guest predicate, which
  // is O(guests x tables) -- 1.2M comparisons per render on the 4,000-seat
  // fixture (3,000 guests, 400 tables).
  //
  // Honest accounting: this was NOT what made those screens slow. Profiled on
  // that fixture the whole filter pass costs 3-4ms either way; the render time
  // was DOM layout, fixed in styles.css. The index is kept because it is the
  // correct shape and stops the cost growing with the table count, not because
  // it bought back a measured second.
  function tableIndex(event){
    const map=new Map();
    for(const t of event.tables||[])map.set(t.id,t);
    return map;
  }
  globalThis.meritTableIndex=tableIndex;
  // ---- moved to src/screen-seating.js — see that file's header. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. ----------------------------
  const SEATING=globalThis.MeritScreenSeating.create({
    activeEvent:(...a)=>activeEvent(...a),assignGuestGroup:(...a)=>SEATCMD.assignGuestGroup(...a),assignGuestToTable:(...a)=>assignGuestToTable(...a),authoriseFreezeOverride:(...a)=>SEATCMD.authoriseFreezeOverride(...a),AVAIL:(...a)=>AVAIL(...a),availReasonText:(...a)=>SEATCMD.availReasonText(...a),bindPanelToggles:(...a)=>bindPanelToggles(...a),canMutate:(...a)=>canMutate(...a),canSeat,canvasEmptyHTML:(...a)=>EMPTY.canvasEmptyHTML(...a),canvasViewportHTML:(...a)=>canvasViewportHTML(...a),createFreezeFromDraft:(...a)=>SEATCMD.createFreezeFromDraft(...a),esc:(...a)=>esc(...a),eventFreezes:(...a)=>eventFreezes(...a),formatTableNumber:(...a)=>formatTableNumber(...a),FREEZE:(...a)=>FREEZE(...a),freezeReasonText:(...a)=>SEATCMD.freezeReasonText(...a),icon:(...a)=>icon(...a),liftFreeze:(...a)=>SEATCMD.liftFreeze(...a),logicalSeatCount:(...a)=>logicalSeatCount(...a),naturalSort:(...a)=>naturalSort(...a),onboardingCalloutHTML:(...a)=>onboardingCalloutHTML(...a),paxDotsHTML:(...a)=>paxDotsHTML(...a),paxOf:(...a)=>paxOf(...a),recordUndo:(...a)=>recordUndo(...a),render:(...a)=>render(...a),resolvedFreezes:(...a)=>resolvedFreezes(...a),resolvedUnavailable:(...a)=>resolvedUnavailable(...a),RULES:(...a)=>RULES(...a),seatingCapacity:(...a)=>seatingCapacity(...a),seatingQueueEmptyHTML:(...a)=>EMPTY.seatingQueueEmptyHTML(...a),setTableAvailability:(...a)=>ARRIVAL.setTableAvailability(...a),t:(...a)=>t(...a),tableAssignedPax:(...a)=>tableAssignedPax(...a),tableIndex:(...a)=>tableIndex(...a),tableSeatMap:(...a)=>tableSeatMap(...a),toast:(...a)=>toast(...a),toggleAssignmentLock:(...a)=>toggleAssignmentLock(...a),touchEvent:(...a)=>touchEvent(...a),ui,unassignGuest:(...a)=>unassignGuest(...a),v8Toolbar:(...a)=>FLOORPLAN.v8Toolbar(...a),
  });
  // REDESIGN v4 step 6 (SPEC-v4 "The working order" 5): "Hazır" on Oturma opens
  // Hazır mı? — the Plan Doctor's open issues (eventReadiness: the one judge),
  // each with the Command Center's own "Git" (COMMAND.doctorGoHTML/bindDoctorGo);
  // pointing at an issue about a table draws a thin line to its place. When
  // nothing blocks, "Planı yerleştir" turns the room into the settled plan: a
  // quiet VIEW (ui.settledEvents, never stored), edits back via "Düzenle".
  function readyChromeHTML(event){
    const settled=!!(ui.settledEvents&&ui.settledEvents.has(event.id));
    if(settled)return`<div class="settled-bar" role="status">${esc(t("ready.settled"))}<button class="btn sm" data-ready-edit>${esc(t("ready.edit"))}</button></div>`;
    if(!ui.readyOpen)return`<button class="btn primary ready-open" data-ready-open>${esc(t("ready.open"))}</button>`;
    const reasons=eventReadiness(event).reasons||[];
    const blockers=reasons.filter(r=>r.level==="blocker").length;
    const rows=reasons.map(r=>{const w=COMMAND.doctorText(r.finding),a=(r.finding&&r.finding.action)||{},tid=a.tableId||(a.tableIds&&a.tableIds[0])||"";
      return`<li class="ready-issue ${r.level==="blocker"?"blocker":"warn"}" data-ready-issue${tid?` data-ready-table="${esc(tid)}"`:""} tabindex="0"><i class="health-dot ${r.level==="blocker"?"blocker":"warn"}"></i><div><b>${esc(w.what)}</b>${w.detail?`<span>${esc(w.detail)}</span>`:""}</div>${COMMAND.doctorGoHTML(r.finding)}</li>`;}).join("");
    return`<aside class="ready-panel theme-scope" data-ready-panel aria-label="${esc(t("ready.title"))}"><div class="ready-head"><h2>${esc(t("ready.title"))}</h2><button class="assistant-close" data-ready-close aria-label="${esc(t("assistant.close"))}">×</button></div>
      ${reasons.length?`<ul class="ready-list">${rows}</ul>`:`<p class="ready-ok">${esc(t("ready.none"))}</p>`}
      ${blockers?`<p class="ready-blocked">${esc(t("ready.blocked",{n:blockers}))}</p>`:`<div class="ready-settle"><b>${esc(t("ready.canSettle"))}</b><button class="btn primary" data-ready-settle>${esc(t("ready.settle"))}</button></div>`}
    </aside><svg class="ready-lead" aria-hidden="true"><path d=""/></svg>`;
  }
  function bindReady(){
    const event=activeEvent();if(!event)return;
    const q=s=>document.querySelector(s);
    if(q("[data-ready-open]"))q("[data-ready-open]").onclick=()=>{ui.readyOpen=true;render();};
    if(q("[data-ready-close]"))q("[data-ready-close]").onclick=()=>{ui.readyOpen=false;render();};
    if(q("[data-ready-settle]"))q("[data-ready-settle]").onclick=()=>{(ui.settledEvents||(ui.settledEvents=new Set())).add(event.id);ui.readyOpen=false;render();};
    if(q("[data-ready-edit]"))q("[data-ready-edit]").onclick=()=>{ui.settledEvents&&ui.settledEvents.delete(event.id);render();};
    if(q("[data-ready-panel]"))COMMAND.bindDoctorGo(event);
    const path=q(".ready-lead path");
    document.querySelectorAll("[data-ready-issue]").forEach(li=>{
      const draw=()=>{const tb=li.dataset.readyTable&&document.querySelector(`.seat-stage [data-object-id="${CSS.escape(li.dataset.readyTable)}"]`);
        if(!tb||!path){if(path)path.setAttribute("d","");return;}
        const a=li.getBoundingClientRect(),b=tb.getBoundingClientRect(),x1=a.left,y1=a.top+a.height/2,x2=b.left+b.width/2,y2=b.top+b.height/2,r=n=>Math.round(n);
        path.setAttribute("d",`M${r(x1)} ${r(y1)} C${r((x1+x2)/2)} ${r(y1)} ${r((x1+x2)/2)} ${r(y2)} ${r(x2)} ${r(y2)}`);};
      li.addEventListener("mouseenter",draw);li.addEventListener("focus",draw);
      li.addEventListener("mouseleave",()=>path&&path.setAttribute("d",""));
    });
  }
  seatingHTML = function(event){
    const inner=SEATING.seatingHTML(event);
    if(RULES().isHistorical(event))return inner;
    return`<div class="seat-v4${ui.settledEvents&&ui.settledEvents.has(event.id)?" is-settled":""}">${inner}${readyChromeHTML(event)}</div>`;
  };
  selectedTablePanelHTML = function(...a){return SEATING.selectedTablePanelHTML(...a);};
  seatRowHTML = function(...a){return SEATING.seatRowHTML(...a);};
  bindSeating = function(...a){const r=SEATING.bindSeating(...a);bindReady();return r;};

  const LOADPANEL=globalThis.MeritServiceLoadPanel.create({
    RULES:(...a)=>RULES(...a),esc:(...a)=>esc(...a),formatTableNumber:(...a)=>formatTableNumber(...a),getMutationEpoch:()=>mutationEpoch,
    t:(...a)=>t(...a),
  });

  const SEATCMD=globalThis.MeritSeatingCommands.create({
    AVAIL:(...a)=>AVAIL(...a),FREEZE:(...a)=>FREEZE(...a),RULES:(...a)=>RULES(...a),SEAT:(...a)=>SEAT(...a),activeEvent:(...a)=>activeEvent(...a),
    audit:(...a)=>audit(...a),canMutate:(...a)=>canMutate(...a),clone:(...a)=>clone(...a),eventFreezes:(...a)=>eventFreezes(...a),
    formatTableNumber:(...a)=>formatTableNumber(...a),nowISO:(...a)=>nowISO(...a),occupiedSeatIndexes:(...a)=>occupiedSeatIndexes(...a),original,
    paxOf:(...a)=>paxOf(...a),render:(...a)=>render(...a),saveGuestRecord:(...a)=>saveGuestRecord(...a),t:(...a)=>t(...a),toast:(...a)=>toast(...a),
    toastAction:(...a)=>toastAction(...a),touchEvent:(...a)=>touchEvent(...a),ui,uid:(...a)=>uid(...a),unassignGuest:(...a)=>unassignGuest(...a),
  });
  assignGuestToTable = function(...a){return SEATCMD.assignGuestToTable(...a);};
  toggleAssignmentLock = function(...a){return SEATCMD.toggleAssignmentLock(...a);};
  // A party of N renders as N dots — one solid for the named guest, the rest
  // muted for companions. A non-technical operator reads "four people" from
  // this instantly; "+3" in a pax column reads as a spreadsheet.
  function paxDotsHTML(g){
    const pax=paxOf(g);
    if(pax>10)return`<span class="pax-badge">${pax}</span>`;
    return`<span class="pax-dots">${Array.from({length:pax},(_,i)=>`<i class="${i?"companion":""}"></i>`).join("")}</span>`;
  }
  function partyMetaHTML(g){
    const add=additionalOf(g),bits=[];
    bits.push(`${paxDotsHTML(g)}<span>${t("live.partyOf",{n:paxOf(g)})}</span>`);
    if(add)bits.push(`<span>${t("live.companionsOf",{n:add})}</span>`);
    if(g.vip&&g.vip!=="Standard")bits.push(`<span class="vip-tag">${esc(g.vip)}</span>`);
    return bits.join("");
  }
  // `byId` is optional so single-row callers stay simple; list callers pass
  // the index they already built rather than scanning the table array once
  // per row.
  function seatTagHTML(event,g,byId){
    const t_=g.assignment&&(byId?byId.get(g.assignment.tableId):event.tables.find(x=>x.id===g.assignment.tableId));
    if(!t_)return`<span class="seat-tag none">${t("live.noTable")}</span>`;
    return`<span class="seat-tag">${esc(formatTableNumber(t_.number))}${g.assignment.seats?.length?` · ${esc(seatRange(g.assignment.seats))}`:""}</span>`;
  }
  // ---- THE LIVE SCREEN AND THE ARRIVAL WAVE → src/screen-live.js -----------
  // Moved out on 2026-10-04. The shell hands it what it reads, here, and keeps
  // the overrides. Shell functions go over as late-binding wrappers: render,
  // toast and touchEvent are reassigned by this file, and a captured reference
  // would freeze whichever body was current when the screen was created.
  const LIVE=globalThis.MeritScreenLive.create({
    ui,t,esc,icon,naturalSort,paxOf,OCC,SEARCH,canMutate,liveEmptyHTML:(...a)=>EMPTY.liveEmptyHTML(...a),partyMetaHTML,recordArrival:(...a)=>ARRIVAL.recordArrival(...a),seatTagHTML,setArrival:(...a)=>ARRIVAL.setArrival(...a),tableIndex,
    activeEvent:()=>activeEvent(),render:()=>render(),touchEvent:e=>touchEvent(e),toast:(...a)=>toast(...a),
    epoch:()=>mutationEpoch,
    saveGuest:(e,g,data)=>saveGuestRecord(e,g,data),assignGuest:(id,tableId)=>assignGuestToTable(id,tableId),
    ask:(o)=>ask(o),
  });
  liveHTML = function(event){return LIVE.html(event);};
  bindLive = function(){return LIVE.bind();};
  // Session-only trail so a mis-tap at the door is recoverable. Deliberately
  // ui state, not event data -- it must never reach the stored schema.
  const ARRIVAL=globalThis.MeritArrivalWriter.create({
    AVAIL:(...a)=>AVAIL(...a),RULES:(...a)=>RULES(...a),audit:(...a)=>audit(...a),nowISO:(...a)=>nowISO(...a),t:(...a)=>t(...a),ui,
  });

  // ---- moved to src/screen-wizard.js — see that file's header. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. ----------------------------
  const WIZARD=globalThis.MeritScreenWizard.create({
    bindExcelWizard:(...a)=>bindExcelWizard(...a),esc:(...a)=>esc(...a),getPendingImport:()=>pendingImport,icon:(...a)=>icon(...a),importSummary:(...a)=>importSummary(...a),MAP_FIELDS,t:(...a)=>t(...a),translateImportIssue:(...a)=>translateImportIssue(...a),ui,
  });
  wizardStepsHTML = function(...a){return WIZARD.wizardStepsHTML(...a);};
  mappingRowsHTML = function(...a){return WIZARD.mappingRowsHTML(...a);};
  sourcePreviewHTML = function(...a){return WIZARD.sourcePreviewHTML(...a);};
  interpretRowHTML = function(...a){return WIZARD.interpretRowHTML(...a);};
  wizardBodyHTML = function(...a){return WIZARD.wizardBodyHTML(...a);};
  wizardFootHTML = function(...a){return WIZARD.wizardFootHTML(...a);};
  renderExcelWizard = function(...a){return WIZARD.renderExcelWizard(...a);};

  // Writing a workbook blocks the page (5 s for 50,000 guests, measured). The
  // control says so BEFORE the work starts — two frames are yielded so the
  // browser paints it — and cannot be pressed twice meanwhile.
  async function whileBusy(button,label,work){
    if(!button||button.getAttribute("aria-busy")==="true")return;
    const was=[...button.childNodes];button.disabled=true;button.setAttribute("aria-busy","true");button.textContent=label;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    try{await work();}
    finally{if(button.isConnected){button.disabled=false;button.removeAttribute("aria-busy");button.replaceChildren(...was);}}
  }

  // ---- moved to src/screen-reports.js — see that file's header. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. ----------------------------
  const REPORTS=globalThis.MeritScreenReports.create({
    activeEvent:(...a)=>activeEvent(...a),app,auditTrailText:(...a)=>auditTrailText(...a),bindDoctorGo:(...a)=>COMMAND.bindDoctorGo(...a),buildTablePlanModel:(...a)=>buildTablePlanModel(...a),doctorGoHTML:(...a)=>COMMAND.doctorGoHTML(...a),doctorText:(...a)=>COMMAND.doctorText(...a),esc:(...a)=>esc(...a),eventMetrics:(...a)=>eventMetrics(...a),eventReadiness:(...a)=>eventReadiness(...a),exportGuestCSV,exportTablePlanXLSX,fmtDate:(...a)=>fmtDate(...a),formatTableNumber:(...a)=>formatTableNumber(...a),getState:()=>state,icon:(...a)=>icon(...a),LIVE,naturalSort:(...a)=>naturalSort(...a),paxOf:(...a)=>paxOf(...a),planIssues:(...a)=>planIssues(...a),relativeTime:(...a)=>relativeTime(...a),render:(...a)=>render(...a),resolvedAuditTrail:(...a)=>resolvedAuditTrail(...a),RULES:(...a)=>RULES(...a),seatExportName:(...a)=>seatExportName(...a),seatingStats:(...a)=>seatingStats(...a),t:(...a)=>t(...a),tableAssignedPax:(...a)=>tableAssignedPax(...a),toast:(...a)=>toast(...a),TRAIL:(...a)=>TRAIL(...a),ui,whileBusy:(...a)=>whileBusy(...a),
  });
  reportsHTML = function(...a){return REPORTS.reportsHTML(...a);};
  bindReports = function(...a){return REPORTS.bindReports(...a);};
  // ---- moved to src/screen-guests.js — see that file's header. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. ----------------------------
  const GUESTS=globalThis.MeritScreenGuests.create({
    activeEvent:(...a)=>activeEvent(...a),allEvents:()=>state.events,additionalOf:(...a)=>additionalOf(...a),app,downloadExcelTemplate,esc:(...a)=>esc(...a),filteredGuests:(...a)=>filteredGuests(...a),icon:(...a)=>icon(...a),openExcelWizard,openGuestDialog:(...a)=>openGuestDialog(...a),original,paxDotsHTML:(...a)=>paxDotsHTML(...a),paxOf:(...a)=>paxOf(...a),render:(...a)=>render(...a),RULES:(...a)=>RULES(...a),saveGuest:(e,g,patch)=>{if(!canMutate(e,"edit guest records"))return null;return saveGuestRecord(e,g,patch);},seatTagHTML:(...a)=>seatTagHTML(...a),t:(...a)=>t(...a),tableIndex:(...a)=>tableIndex(...a),ui,
  });
  guestsHTML = function(...a){return GUESTS.guestsHTML(...a);};
  bindGuests = function(...a){return GUESTS.bindGuests(...a);};
  // ---- Undo for the two actions that destroy work → src/guest-record-undo.js
  // (deleteGuest, unassignGuest, the guest dialog opener). The toast that
  // offers an Undo stays here: every capability that can be undone uses it.
  // Through pushToast() like every other toast, so an Undo offer is capped,
  // held and placed by the same rules -- and is the LAST thing a burst of
  // confirmations pushes off the screen.
  function toastAction(message,label,onAction,type="info",duration=8000){
    const el=document.createElement("div");el.className="toast has-action "+type;
    el.setAttribute("role",type==="error"?"alert":"status");
    const text=document.createElement("span");text.className="toast-text";text.textContent=message;
    const btn=document.createElement("button");btn.type="button";btn.className="toast-action";btn.textContent=label;
    let done=false;
    btn.onclick=()=>{if(done)return;done=true;clearTimeout(el._toastTimer);el.remove();onAction();};
    el.append(text,btn);
    pushToast(el,{duration});
  }
  const GUESTUNDO=globalThis.MeritGuestRecordUndo.create({
    RULES:(...a)=>RULES(...a),SEAT:(...a)=>SEAT(...a),activeEvent:(...a)=>activeEvent(...a),ask:(...a)=>ask(...a),audit:(...a)=>audit(...a),
    canMutate:(...a)=>canMutate(...a),challengeFreeze:(...a)=>SEATCMD.challengeFreeze(...a),formatTableNumber:(...a)=>formatTableNumber(...a),
    freezeBlocks:(...a)=>SEATCMD.freezeBlocks(...a),getState:()=>state,occupiedSeatIndexes:(...a)=>occupiedSeatIndexes(...a),original,
    render:(...a)=>render(...a),t:(...a)=>t(...a),toast:(...a)=>toast(...a),toastAction:(...a)=>toastAction(...a),touchEvent:(...a)=>touchEvent(...a),
    translateStaticDialogs:(...a)=>translateStaticDialogs(...a),ui,
  });
  deleteGuest = async function(...a){return GUESTUNDO.deleteGuest(...a);};
  unassignGuest = function(...a){return GUESTUNDO.unassignGuest(...a);};
  openGuestDialog = function(...a){return GUESTUNDO.openGuestDialog(...a);};
  // guestDialog/excelDialog markup lives once in index.html and never passes
  // through render(), so a language toggle has nothing to re-draw it. This
  // pushes the current language into that static markup directly, called on
  // every render() and whenever the guest dialog opens.
  const VIP_LEVELS=["Standard","VIP","VVIP"];
  // What the operator reads for a stored VIP level. "VIP"/"VVIP" read the same
  // in both languages; "Standard" does not.
  function vipLabel(v){const k="vip.level."+v;return t(k)!==k?t(k):String(v||"");}
  function translateStaticDialogs(){
    const form=document.getElementById("guestForm");if(!form)return;
    const editing=!!form.elements.id.value;
    const title=document.getElementById("guestDialogTitle");if(title)title.textContent=t(editing?"guests.editGuest":"guests.addGuest");
    const setLabel=(forId,key)=>{const lbl=form.querySelector(`label[for="${forId}"]`);if(lbl)lbl.textContent=t(key);};
    setLabel("gfName","guestDialog.name");
    setLabel("gfAdditional","guestDialog.additionalGuests");
    setLabel("gfPlanning","guestDialog.planningStatus");
    setLabel("gfVip","guestDialog.vipLevel");
    setLabel("gfInvitedBy","guestDialog.invitedBy");
    setLabel("gfExpectedArrival","guestDialog.expectedArrival");
    setLabel("gfNotes","guestDialog.notes");
    const paxLabel=document.getElementById("gfPaxLabel");if(paxLabel)paxLabel.textContent=t("guestDialog.totalPax");
    const planningSel=form.elements.planningStatus;
    if(planningSel){const cur=planningSel.value||"Confirmed";planningSel.innerHTML=`<option value="Confirmed">${t("status.planning.Confirmed")}</option><option value="Tentative">${t("status.planning.Tentative")}</option>`;planningSel.value=cur;}
    const cancelBtn=form.querySelector(".dialog-foot .btn:not(.primary)");if(cancelBtn)cancelBtn.textContent=t("guestDialog.cancel");
    const closeBtn=form.querySelector(".dialog-close");if(closeBtn)closeBtn.setAttribute("aria-label",t("a11y.close"));
    // The VALUE is the stored level; only the label is translated.
    const vipSel=form.elements.vip;
    // Built as nodes with textContent, not innerHTML: no new markup sink.
    if(vipSel){const cur=vipSel.value||"Standard";vipSel.replaceChildren(...VIP_LEVELS.map(v=>{const o=document.createElement("option");o.value=v;o.textContent=vipLabel(v);return o;}));vipSel.value=cur;}
    const saveBtn=form.querySelector(".dialog-foot .btn.primary");if(saveBtn)saveBtn.textContent=t("guestDialog.save");
  }
  translateStaticDialogs();
  loadXLSX = function(){return globalThis.XLSX?Promise.resolve():Promise.reject(new Error("Embedded spreadsheet engine did not initialize."));};

  // Translate at the toast boundary rather than at ~40 call sites. Strings
  // already localized by t() simply pass through unmatched.
  const baseToast=toast;
  toast=function(message,...rest){return baseToast(typeof translateToast==="function"?translateToast(message):message,...rest);};

  // Cancel and the close X live inside <form method="dialog"> as untyped
  // buttons, so both SUBMITTED the form: pressing Cancel on a guest edit
  // committed it -- pax change, capacity check and seat repack included.
  document.querySelectorAll("#guestDialog [value='cancel']").forEach(b=>{
    b.type="button";
    b.onclick=()=>document.getElementById("guestDialog").close("cancel");
  });

  // Importing guests is a mutation, but neither the wizard opener nor its
  // import step consulted canMutate; protection was incidental (bindGuests
  // simply never runs on historical events).
  const baseOpenExcelWizard=typeof openExcelWizard==="function"?openExcelWizard:null;
  if(baseOpenExcelWizard)openExcelWizard=function(...a){
    if(!canMutate(activeEvent(),"import a guest list"))return;
    return baseOpenExcelWizard(...a);
  };

  function yieldFrame(){return new Promise(resolve=>requestAnimationFrame(()=>resolve()));}
  function sourceBlob(src){return fetch(src).then(r=>r.blob());}
  // The classical detection pipeline used to live here (2809 lines).
  // It is now src/plan-detection-classical.js, loaded immediately before this
  // file, and it is reached ONLY through the registry it publishes. Keep it
  // that way: the moment app-v8.js calls one of its internal helpers by name,
  // the boundary is gone and the next split becomes unsafe. Deliberately NOT
  // aliased to a local name here — see benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md.
  // ============================================================
  // VisualEmbeddingProvider (classical/deterministic implementation).
  //
  // Real visual similarity requires real pixel information, not just a
  // bounding box's area/aspect ratio. A real trained embedding model
  // (ONNX Runtime Web + a pretrained vision model such as MobileNetV2) was
  // evaluated for this: onnxruntime-web is on the npm registry and a real
  // ~14MB MobileNetV2 ONNX model IS fetchable in this environment via
  // media.githubusercontent.com (verified, not assumed) -- so bundling one is
  // technically possible. It was deprioritized for this pass in favor of the
  // explicitly higher-priority full-app visual redesign later in this same
  // sprint, not because it's infeasible; a future pass can wire a real
  // embedding model in as an alternate implementation of this exact function
  // signature (candidate pixels in, fixed-shape numeric descriptor out)
  // without touching plan-intelligence.js's clustering logic at all.
  //
  // This implementation instead computes a real, deterministic descriptor
  // straight from the actual decoded plan pixels already in memory from
  // detection (no synthetic/fabricated numbers): interior fill ratio (shape
  // occupancy), edge density (a Sobel-style gradient magnitude average,
  // texture/outline signal), an 8-bin grayscale intensity histogram (coarse
  // color/tone distribution), and a 4-quadrant fill balance (a cheap contour/
  // shape signature that tells a round table's radial fill apart from an
  // L-shaped or off-center one). This is real pixel-derived signal, honestly
  // labeled as classical/deterministic -- never described as a trained model.
  // ---- VisualEmbeddingProvider (Gate G) --------------------------------
  //
  // The boundary a real learned embedding model would plug into, so that
  // swapping one in is a provider registration rather than a rewrite of the
  // similarity clustering.
  //
  // Exactly one provider is installed today and it is NOT a model. It is a
  // hand-crafted descriptor: fill ratio, edge density, an 8-bin intensity
  // histogram and a quadrant fill signature, computed from the decoded plan
  // pixels. Calling that an embedding would be false, so `kind` says
  // "handcrafted-descriptor", `trainedModel` is false, and `dimensions` is the
  // real vector length rather than a model's hidden size. Nothing in the UI
  // may describe this as a learned or trained representation.
  //
  // See benchmarks/embedding/README.md for the license matrix and for the
  // measured baseline any candidate model has to beat before it is worth
  // shipping tens of megabytes of weights into an offline package.
  const VisualEmbeddingProviders={
    handcrafted:{
      id:"handcrafted-descriptor-v1",
      kind:"handcrafted-descriptor",
      trainedModel:false,
      label:"Geometric + intensity descriptor computed from plan pixels. Not a trained model, not an embedding.",
      dimensions:14, // fillRatio + edgeDensity + 8 histogram bins + 4 quadrants
      offline:true,
      licence:"n/a — computed in-product, no third-party weights",
      embed(gray,binary,width,height,candidate){
        return computeVisualDescriptor(gray,binary,width,height,candidate);
      },
      // Flat vector form, so a consumer can compare providers without knowing
      // the shape of any one of them.
      toVector(d){
        if(!d)return null;
        return [d.fillRatio,d.edgeDensity,...(d.intensityHist||[]),...(d.quadrantFill||[])];
      },
    },
  };
  function resolveVisualEmbeddingProvider(){
    // The learned encoder is the default WHEN IT IS INSTALLED, and only
    // because it was measured to be better on every retrieval number and
    // worse on none — see src/plan-embedding.js and
    // benchmarks/embedding/retrieval.json. If its weights are absent (a build
    // that did not run scripts/build-encoder-module.mjs) the app degrades to
    // the handcrafted descriptor rather than failing, and says which one ran
    // in the detection diagnostics either way.
    const id=globalThis.MERIT_VISUAL_EMBEDDING_PROVIDER
      ||(VisualEmbeddingProviders.learned?"learned":"handcrafted");
    return VisualEmbeddingProviders[id]||VisualEmbeddingProviders.handcrafted;
  }
  globalThis.MeritVisualEmbedding={
    providers:VisualEmbeddingProviders,
    resolve:resolveVisualEmbeddingProvider,
    // Registration seam for a future real model. Kept deliberately explicit:
    // a provider must declare whether it is a trained model, because the
    // honesty rules downstream key off that flag rather than off its name.
    register(id,provider){
      if(!provider||typeof provider.embed!=="function")throw new Error("A visual embedding provider needs an embed() function.");
      if(typeof provider.trainedModel!=="boolean")throw new Error("A visual embedding provider must declare trainedModel explicitly.");
      VisualEmbeddingProviders[id]=provider;
    },
  };
  // src/plan-embedding.js loads before this file, so it cannot register itself
  // against a registry that does not exist yet. It exposes the registration and
  // this calls it, which also means an installation without the weights simply
  // never registers and the handcrafted descriptor stays the resolved provider.
  if(typeof globalThis.MeritRegisterPlanEncoder==="function")globalThis.MeritRegisterPlanEncoder();
  function computeVisualDescriptor(gray,binary,width,height,c){
    const px=Math.max(0,Math.round(c.x/100*width)),py=Math.max(0,Math.round(c.y/100*height));
    const pw=Math.max(1,Math.min(width-px,Math.round(c.w/100*width))),ph=Math.max(1,Math.min(height-py,Math.round(c.h/100*height)));
    if(pw<2||ph<2)return null;
    const hist=new Array(8).fill(0),quadFg=[0,0,0,0],quadTotal=[0,0,0,0];
    let fg=0,edgeSum=0,total=0;
    for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
      const gx=px+x,gy=py+y;if(gx>=width||gy>=height)continue;
      const i=gy*width+gx,v=gray[i];
      total++;hist[Math.min(7,v>>5)]++;
      if(binary[i])fg++;
      const qi=(x<pw/2?0:1)+(y<ph/2?0:2);quadTotal[qi]++;if(binary[i])quadFg[qi]++;
      if(x>0&&x<pw-1&&y>0&&y<ph-1){
        edgeSum+=Math.abs(gray[gy*width+gx+1]-gray[gy*width+gx-1])+Math.abs(gray[(gy+1)*width+gx]-gray[(gy-1)*width+gx]);
      }
    }
    if(!total)return null;
    return{
      fillRatio:fg/total,
      edgeDensity:Math.min(1,edgeSum/(total*255)),
      intensityHist:hist.map(n=>n/total),
      quadrantFill:quadTotal.map((n,i)=>n?quadFg[i]/n:0),
    };
  }
  // ============================================================
  // Current Plan Memory: a human correction (reclassify, confirm, reject, or
  // a manually-drawn "AI missed this" object) must survive Re-Analyze, not be
  // silently discarded when runAssistedDetection() throws away the whole old
  // candidate list and generates fresh ones with new random ids. Stored on
  // event.planMemory (NOT event.analysis, which gets fully replaced on every
  // analysis pass) and matched back onto the newly detected candidates by
  // real geometry: since the source plan image never changed and the
  // classical CV pipeline is deterministic, the same physical object reappears
  // at essentially the same position/size on every re-run — this is a real,
  // honest match, not a fabricated one. Matching by learned visual similarity
  // instead of geometry alone is a separate, larger piece of future work (see
  // plan-intelligence.js's similarity clustering).
  function rememberCorrection(event,c,{manual=false}={}){
    event.planMemory ||= [];
    // Identity used to be geometry alone, which is really determinism matching:
    // it works because re-running a deterministic detector on identical pixels
    // puts every box back where it was. The moment the pixels differ — a JPEG
    // round trip, a greyscale export, a plan re-issued with two tables moved —
    // a decision is silently lost, or worse, lands on a different object.
    //
    // So the decision is stored with what the object LOOKED like and what stood
    // AROUND it as well as where it was. Both are already computed by the time
    // a person can click: the encoder ran over every candidate during detection,
    // and the neighbourhood is the candidate list itself.
    const alive=(event.analysis?.candidates||[]).filter(x=>x.status!=="rejected");
    const vector=c.visualDescriptor?.vector||null;
    const entry={id:uid("planmemory"),sourceCandidateId:c.id,kind:c.kind,type:c.type,status:c.status,
      geometry:{x:c.x,y:c.y,w:c.w,h:c.h,rotation:c.rotation||0},manual,correctedAt:nowISO(),
      // "Not important": rejected for this plan, and remembered as dismissed
      // so Re-Analyze does not ask again and the reason is not lost.
      dismissed:!!c.dismissed,
      // The identifier the drawing prints on it, when two crops agreed on one.
      // Stored with the memory so the same table can be recognised after a
      // re-import by its number rather than by resembling a hundred siblings.
      printedNumber:c.printedNumber&&c.printedNumber.state==="VERIFIED"
        ?{state:"VERIFIED",value:c.printedNumber.value}:null,
      visual:vector?{vector:Array.from(vector),
        provider:globalThis.MeritVisualEmbedding?.resolve?.()?.id||null,
        version:globalThis.MERIT_PLAN_ENCODER_WEIGHTS?.id||null}:null,
      context:globalThis.MeritPlanMemory?globalThis.MeritPlanMemory.contextSignature(c,alive):null};
    const existing=event.planMemory.findIndex(m=>m.sourceCandidateId===c.id);
    if(existing>=0)event.planMemory[existing]=entry;else event.planMemory.push(entry);
  }
  // ---- training-data capture (Gates E-G) ----------------------------------
  //
  // rememberCorrection above keeps a plan tidy: it records the answer so the
  // same object comes back the same way after Re-Analyze. It does not keep
  // the question. Nothing in it says what the detector had predicted, which
  // build predicted it, which plan and which layout version the object came
  // from, or what the operator was actually looking at.
  //
  // captureTrainingExample keeps all of that, with the real crop, in
  // state.trainingData. It is a data foundation and nothing else: it never
  // changes a detection, never trains anything, and never sets trainedModel.
  // See src/training-data.js for the record shape and the decision types.
  //
  // Failures are reported, not swallowed. A correction that was applied but
  // not captured is a real gap in the dataset, and an operator who is told
  // "saved" while nothing was stored would build on sand.
  let planImageCache={src:null,image:null};
  let planHashCache={src:null,hash:null};
  let captureFailureReported=false;
  async function planHashFor(src){
    if(planHashCache.src!==src)planHashCache={src,hash:await MeritTrainingData.planFingerprint(src)};
    return planHashCache.hash;
  }
  async function planImageFor(src){
    if(planImageCache.src!==src){
      if(planImageCache.image?.close)planImageCache.image.close();
      planImageCache={src,image:await MeritTrainingData.imageFromDataUrl(src)};
    }
    return planImageCache.image;
  }
  function truthOf(c){return c?{kind:c.kind,type:c.type,seats:c.seats??null,seatsConfidence:c.seatsConfidence??null}:null;}
  async function captureTrainingExample(event,c,{decisionType,predictionBefore=null,note=null,decisionId=null,propagatedFrom=null,reviewedIndividually=true}={}){
    if(!globalThis.MeritTrainingData||!event?.background?.src||!c)return null;
    try{
      const src=event.background.src;
      const [planHash,image]=await Promise.all([planHashFor(src),planImageFor(src)]);
      if(!planHash)return null;
      const geometry={x:c.x,y:c.y,w:c.w,h:c.h,rotation:c.rotation||0};
      const shot=await MeritTrainingData.cropFromImage(image,geometry);
      const blobId=uid("crop");
      await storageProvider.putBlob(blobId,shot.dataUrl);
      const wantsTruth=decisionType==="confirmation"||decisionType==="correction"||decisionType==="missedObject";
      const record=MeritTrainingData.buildRecord({
        decisionType,
        plan:{planHash,name:event.background.name||null,width:image.width,height:image.height},
        context:{eventId:event.id,venueId:event.venueRef?.venueId??null,
          layoutId:event.venueRef?.layoutId??null,layoutVersionId:event.venueRef?.layoutVersionId??null},
        geometry,
        predictionBefore,
        humanTruth:wantsTruth?truthOf(c):null,
        providers:{
          detection:event.analysis?.diagnostics?.provider
            ?{id:event.analysis.diagnostics.provider,engine:event.analysis.engine,trainedModel:false}:null,
          embedding:(()=>{const p=MeritVisualEmbedding?.resolve?.();
            return p?{id:p.id,kind:p.kind,trainedModel:p.trainedModel,dimensions:p.dimensions}:null;})(),
        },
        descriptor:c.descriptor??null,
        crop:{blobId,size:shot.size,sourceRect:shot.sourceRect,objectRect:shot.objectRect,padding:shot.padding},
        note,decisionId,propagatedFrom,reviewedIndividually,
      });
      // A capture finishes after its crop is stored; if the decision was undone
      // meanwhile, the label is kept as retracted rather than counted.
      if(decisionId&&retractedDecisions.has(decisionId))MeritTrainingData.retract([record],decisionId,{reason:"the decision was undone"});
      state.trainingData ||= [];
      state.trainingData.push(record);
      saveState();
      return record;
    }catch(error){
      if(!captureFailureReported){
        captureFailureReported=true;
        toast(t("training.captureFailed"),"error",7000);
      }
      console.error("Training-data capture failed.",error);
      return null;
    }
  }
  // General old-candidate -> new-candidate geometry remap, used to carry
  // grouping decisions (which reference every member of a furniture group,
  // not just ones a human individually confirmed/reclassified) across a
  // Re-Analyze pass. Same deterministic-geometry reasoning as plan memory.
  function matchCandidatesByGeometry(oldCandidates,freshCandidates){
    const pairs=[];
    for(const o of oldCandidates)for(const c of freshCandidates)pairs.push({o,c,dist:Math.hypot(c.x-o.x,c.y-o.y,(c.w-o.w)*.5,(c.h-o.h)*.5)});
    pairs.sort((a,b)=>a.dist-b.dist);
    const usedO=new Set(),usedC=new Set(),remap=new Map();
    for(const{o,c,dist}of pairs){
      // Same size-relative rule as plan memory, and for the same reason: a
      // grouping decision carried onto a neighbouring chair is as wrong as a
      // correction carried onto one.
      if(dist>memoryTolerance(o)||usedO.has(o.id)||usedC.has(c.id))continue;
      remap.set(o.id,c.id);usedO.add(o.id);usedC.add(c.id);
    }
    return remap;
  }
  // Re-applies remembered corrections onto a fresh detection pass: matches
  // each memory entry to its closest freshly-detected candidate (greedy
  // nearest-geometry, one-to-one) within a tight tolerance, overwrites that
  // candidate's kind/type/status with the remembered human decision (flagging
  // fromMemory so this is never silently indistinguishable from a fresh
  // detection), and re-inserts a manually-drawn "AI missed this" object
  // outright if the detector still doesn't find it. Returns an id remap so
  // grouping decisions (which reference old candidate ids) can be carried
  // forward too.
  // How far a remembered object is allowed to have moved, RELATIVE TO ITS OWN
  // SIZE rather than to the plan.
  //
  // A flat 3-percent-of-plan tolerance is the same distance for a banquet
  // table and for a chair, and on this plan's concert seating adjacent chairs
  // stand about 2.6 percent apart — inside it. Measured: after 21 corrections
  // and a Re-Analyze, three chair corrections came back on a NEIGHBOURING
  // chair, because greedy nearest-first pairing over 39 memories can displace
  // a match when several candidates are all within tolerance of each other.
  // Retention 0.857 against a 0.98 gate, and the operator sees a confirmed,
  // remembered decision sitting on the wrong seat.
  //
  // A big table can shift three percent of the plan and still obviously be
  // that table. A chair cannot: three percent is more than a chair away. So
  // the tolerance is a fraction of the object's own short side, floored so a
  // tiny object still has some slack and capped at the old value so nothing
  // matches more loosely than it used to.
  const MEMORY_TOLERANCE_OF_SIZE=.75,MEMORY_MIN_TOLERANCE=.5,MEMORY_MAX_TOLERANCE=3;
  function memoryTolerance(g){
    return Math.max(MEMORY_MIN_TOLERANCE,
      Math.min(MEMORY_MAX_TOLERANCE,Math.min(g.w,g.h)*MEMORY_TOLERANCE_OF_SIZE));
  }
  function applyPlanMemory(freshCandidates,memory){
    const idRemap=new Map();
    if(!memory?.length)return{reappliedCount:0,restored:[],idRemap,conflicts:[]};
    // Matched purely by geometry, never by kind: a reclassification memory's
    // whole point is that the detector's raw kind guess was wrong (e.g. a
    // table-shaped detection that a human corrected to venue:chair) -- the
    // freshly re-detected candidate at that position will get the SAME wrong
    // kind guess again on every re-run, so requiring kind equality here would
    // make the correction impossible to ever re-apply.
    //
    // Matching itself lives in src/plan-memory.js, where it is scored from
    // geometry, size, the learned encoder's embedding of the crop, the local
    // neighbourhood and family compatibility, and graded STRONG / LIKELY /
    // AMBIGUOUS / NONE. Only the first two re-apply. An AMBIGUOUS match — two
    // candidates that fit about equally — is deliberately NOT applied: picking
    // one silently is how a human decision lands on an object it was never
    // about, and that failure looks exactly like success.
    const byId=new Map(freshCandidates.map(c=>[c.id,c]));
    const memById=new Map(memory.map(m=>[m.id,m]));
    const result=globalThis.MeritPlanMemory.match(memory,
      freshCandidates.map(c=>({id:c.id,kind:c.kind,type:c.type,x:c.x,y:c.y,w:c.w,h:c.h,
        vector:c.visualDescriptor?.vector||null,printedNumber:c.printedNumber||null})));
    const usedC=new Set(),usedM=new Set();
    let reappliedCount=0;
    // Where the operator and the detector actually disagree. Re-applying a
    // correction silently makes the plan look right while hiding the fact that
    // the detector proposed the same wrong answer again -- which is exactly the
    // signal that says this class of object is not being read correctly. It is
    // recorded here, at the only place that can see both answers, and reported
    // as a MEMORY contradiction rather than being smoothed over.
    const conflicts=[];
    for(const hit of result.matches){
      const c=byId.get(hit.candidateId),m=memById.get(hit.memoryId);
      if(!c||!m)continue;
      if(hit.reclassifies)
        conflicts.push({kind:"overruled",candidateId:c.id,
          detector:{kind:c.kind,type:c.type},operator:{kind:m.kind,type:m.type}});
      c.kind=m.kind;c.type=m.type;c.status=m.status;c.selected=m.status!=="rejected";c.fromMemory=true;if(m.dismissed)c.dismissed=true;
      c.memoryMatch={grade:hit.grade,score:hit.score,margin:hit.margin,
        movedBeyondTolerance:!hit.withinOldTolerance,visualCosine:hit.visualCosine,terms:hit.terms};
      usedC.add(c.id);usedM.add(m.id);idRemap.set(m.sourceCandidateId,c.id);reappliedCount++;
    }
    // Two candidates fit this decision about equally well. Not applied, and not
    // silent: the operator is the only one who can say which object they meant.
    for(const hit of result.ambiguous){
      const m=memById.get(hit.memoryId);
      if(!m||usedM.has(m.id))continue;
      usedM.add(m.id);
      conflicts.push({kind:"ambiguous",memoryId:m.id,candidateId:hit.candidateId,
        object:{kind:m.kind,type:m.type},score:hit.score,margin:hit.margin});
    }
    const restored=[];
    for(const m of memory){
      // A confirmed object the detector did NOT find again this run. Not
      // fabricated back into existence, but not silent either: a human said
      // this is real and detection now disagrees.
      if(!usedM.has(m.id)&&!m.manual&&m.status==="confirmed")
        conflicts.push({kind:"lost",memoryId:m.id,object:{kind:m.kind,type:m.type},geometry:m.geometry});
      if(usedM.has(m.id)||!m.manual)continue; // a non-manual correction whose object wasn't re-detected this time is left alone -- we never fabricate a detection that didn't happen.
      const g=m.geometry,id=uid("candidate");
      restored.push({id,kind:m.kind,type:m.type,x:g.x,y:g.y,w:g.w,h:g.h,rotation:g.rotation,confidence:1,status:m.status,selected:m.status!=="rejected",missed:true,fromMemory:true,chairDetections:[],evidence:{geometry:"manual-memory",chairs:0,repetition:0}});
      idRemap.set(m.sourceCandidateId,id);
    }
    return{reappliedCount,restored,idRemap,conflicts,identity:result.stats};
  }
  // ---- moved to src/review-session-log.js — see that file's header: what a
  // person did in a review session, and the report built from it. The shell
  // hands it what it reads; shell functions go over as late-binding wrappers. --
  const SESSIONS=globalThis.MeritReviewSessionLog.create({
    activeEvent:(...a)=>activeEvent(...a),esc:(...a)=>esc(...a),getState:()=>state,nowISO:(...a)=>nowISO(...a),t:(...a)=>t(...a),ui,uid:(...a)=>uid(...a),
  });
  globalThis.MeritOperatorSessions={summary:SESSIONS.operatorSessionSummary,
    all:()=>(state.operatorSessions||[]).map(s=>SESSIONS.operatorSessionSummary(s.analysisId))};
  globalThis.MeritOperatorReport=()=>{const e=activeEvent();return e?SESSIONS.operatorReport(e):null;};

  const REFINE=globalThis.MeritPlanDetectionRefine.create({
    analysisCanvasOf:(...a)=>PLANTEXT.analysisCanvasOf(...a),applyPlanMemory:(...a)=>applyPlanMemory(...a),audit:(...a)=>audit(...a),
    buildPlanIntelligence:(...a)=>buildPlanIntelligence(...a),canMutate:(...a)=>canMutate(...a),
    recomputePlanIntelligence:(...a)=>recomputePlanIntelligence(...a),render:(...a)=>render(...a),t:(...a)=>t(...a),toast:(...a)=>toast(...a),
    toastAction:(...a)=>toastAction(...a),touchEvent:(...a)=>touchEvent(...a),uid:(...a)=>uid(...a),
  });

  // Two facts the analysis run and the background read share, kept by the shell
  // because the run (runAssistedDetection) writes them; the plan-text intake
  // below reads the first through a getter.
  // A plan whose analysis a person stopped is not read again in the background:
  // Stop means stop, until they press Analyse again.
  let prefetchStoppedSrc=null;
  // The two reads an analysis COMPLETED, kept for the next analysis of the same
  // image (S7, 2026-10-18). Re-analysing a plan read its text again from
  // nothing: on ORNEK the OCR model alone was ~9.7 s of a ~14 s re-analysis.
  // One entry, keyed by the image, handed out as a copy so nothing a later
  // stage does to it can reach the next analysis; a stopped analysis keeps
  // nothing, and MERIT_PREFETCH="off" turns this off with the prefetch.
  let keptPlanText={src:null,model:null,page:null};
  const PLANTEXT=globalThis.MeritPlanTextIntake.create({
    ANALYSIS_MAX_SIDE:(...a)=>ANALYSIS_MAX_SIDE(...a),REFINE,RULES:(...a)=>RULES(...a),buildPlanIntelligence:(...a)=>buildPlanIntelligence(...a),
    getPrefetchStoppedSrc:()=>prefetchStoppedSrc,getTEACH:()=>TEACH,runPlanOCR:(...a)=>runPlanOCR(...a),sourceBlob:(...a)=>sourceBlob(...a),ui,
  });

  const TEACH=globalThis.MeritPlanTeach.create({
    applyReviewWrites:(...a)=>applyReviewWrites(...a),audit:(...a)=>audit(...a),canMutate:(...a)=>canMutate(...a),getState:()=>state,
    nowISO:(...a)=>nowISO(...a),recomputePlanIntelligence:(...a)=>recomputePlanIntelligence(...a),render:(...a)=>render(...a),
    saveState:(...a)=>saveState(...a),t:(...a)=>t(...a),toast:(...a)=>toast(...a),toastAction:(...a)=>toastAction(...a),
    touchEvent:(...a)=>touchEvent(...a),
  });

  // Exposed for the regression suite. This rule silently deleted 117 of
  // ORNEK's 132 tables and only did so when OCR was running, which is a
  // combination no benchmark in this repo exercises — the sandbox has no
  // network, so the CDN build has no OCR, and the offline package is built
  // rather than benchmarked. A pure function of (candidates, words) can be
  // pinned directly, and now is.
  globalThis.MeritSuppressTextFalsePositives = REFINE.suppressTextFalsePositives;

  // Run fn over items in order, giving the page a turn every ~40 ms so input,
  // scrolling and Stop are answered while a long pass runs. The work and its
  // order are unchanged.
  async function inSlices(items,fn,check){
    let since=performance.now();
    for(const item of items){
      fn(item);
      if(performance.now()-since>40){await new Promise(r=>setTimeout(r,0));if(check)check();since=performance.now();}
    }
  }
  async function runAssistedDetection(){
    // ONE ANALYSIS AT A TIME. A second press (a double click, Re-Analyze while
    // the first run is still going) started a second pipeline that interleaved
    // its writes to event.analysis with the first one's.
    if(ui.analysisBusy)return;
    const event=activeEvent();if(!canMutate(event,"run plan analysis")||!event.background?.src)return toast(t("toast.importPlanFirst"),"error");ui.analysisBusy=true;ui.analysisProgress=3;ui.analysisStage=t("analysis.stage.reading");ui.tab="floor";ui.planMode="review";
    // Import -> Confirm timing for the operator test. Local only, and carried
    // on objects that already survive the event migration: the background for
    // the import moment, the analysis for everything after it. A `planTimings`
    // field on the event itself was silently dropped by migrateEvent, which is
    // exactly the kind of thing a test that reads the value catches and a test
    // that reads the code does not.
    const analysisStartedAtMs=Date.now();
    // Where the time goes, per stage, on every run: the wall clock between one
    // stage mark and the next, kept on the analysis (timings.stages). Measured,
    // not estimated, so a speed-up is shown by the stage it moved.
    const stageTimes=[];let stageAt=performance.now();
    const stage=name=>{const now=performance.now();stageTimes.push({stage:name,ms:Math.round(now-stageAt),end:Math.round(now)});stageAt=now;};
    // What the plan's analysis was before this run. The new one REPLACES it
    // part-way through (before OCR, labels, numbers and the teach area run),
    // so a failure after that point used to leave a half-built analysis where
    // a complete one had been -- under a toast saying nothing was changed.
    const priorAnalysis=event.analysis;
    // STOP means stop. The operator's Stop button aborts this controller; every
    // long wait below is raced against it, so the pipeline leaves at once, and
    // stopAnalysisEngines() ends the work the engines were doing (a worker
    // mid-inference cannot be interrupted any other way). The previous analysis
    // is put back exactly as on a failure.
    const abort=new AbortController();ui.analysisAbort=abort;
    const stopped=new Promise((_,reject)=>abort.signal.addEventListener("abort",()=>reject(Object.assign(new Error("analysis stopped"),{analysisStopped:true})),{once:true}));
    // EXPECTED ABSTENTION: the rejection is read by every guard() below.
    stopped.catch(()=>null);
    const guard=p=>Promise.race([p,stopped]);
    const checkStopped=()=>{if(abort.signal.aborted)throw Object.assign(new Error("analysis stopped"),{analysisStopped:true});};
    // A turn for the page between steps that are each a few hundred ms on a
    // dense plan (measured: benchmarks/perf/README.md). Nothing is computed
    // differently; Stop is honoured at each turn.
    const turn=async()=>{await new Promise(r=>setTimeout(r,0));checkStopped();};
    render();await yieldFrame();
    try{
      const FRAMES=globalThis.MeritPlanFrames,{analysisFrame,ratio,width,height,canvas,ctx}=await PLANTEXT.analysisCanvasOf(event.background.src);stage("decode");
      // The two text reads, when they were started at import (S5): the same
      // reads of the same image, begun earlier. Taken over by this analysis, so
      // a Stop below ends them and a re-analysis reads afresh.
      let pre=PLANTEXT.takePlanTextPrefetch(event.background.src);
      const reusing=!pre&&globalThis.MERIT_PREFETCH!=="off"&&keptPlanText.src===event.background.src&&keptPlanText.model&&keptPlanText.page;
      if(reusing)pre={src:keptPlanText.src,model:Promise.resolve(PLANTEXT.copyRead(keptPlanText.model)),page:Promise.resolve(PLANTEXT.copyRead(keptPlanText.page)),startedAtMs:performance.now(),abort:null,kept:true};
      abort.signal.addEventListener("abort",()=>pre?.abort?.abort(),{once:true});
      const prefetchUse={model:false,page:false,startedBeforeMs:pre&&!pre.kept?Math.round(performance.now()-pre.startedAtMs):null,keptFromLastAnalysis:!!(pre&&pre.kept)};
      // Tesseract reads the whole analysis canvas in its own worker, so it is
      // started HERE and runs while the OCR model and the detector hold the main
      // thread; its answer is awaited where it was always read. Same input: the
      // canvas is drawn once above and nothing after this line draws on it.
      // Measured on ORNEK, the two engines one after the other were most of the
      // analysis's wall clock.
      const tesseractStartedAt=performance.now();let tesseractMs=null;const keptReads={model:null,page:null};
      const freshPageRead=()=>(async()=>{try{return await runPlanOCR(canvas.toDataURL("image/png"));}catch(ocrError){return{available:false,text:null,reason:ocrError.message,reasonCode:"FAILED"};}finally{tesseractMs=Math.round(performance.now()-tesseractStartedAt);}})();
      // A read begun at import is used only when it answered: one that failed
      // or was stopped is read again here, so the result never differs from
      // what reading now would give.
      const readWholePage=()=>pre&&pre.page?pre.page.then(r=>{if(r&&r.available){prefetchUse.page=true;tesseractMs=Math.round(performance.now()-tesseractStartedAt);return r;}return freshPageRead();}):freshPageRead();
      // EXPERIMENT ONLY (benchmarks/perf/README.md): MERIT_TESSERACT_PAGE =
      // "model-only" leaves Tesseract's whole-page read out when the OCR model
      // reads the page, and starts it only when the model could not. The product
      // reads with both until a measurement says one is enough.
      const pageOnlyIfModelFails=globalThis.MERIT_TESSERACT_PAGE==="model-only";
      let ocrStarted=pageOnlyIfModelFails?null:readWholePage();
      stage("tesseractStart");
      ui.analysisStage=t("analysis.stage.understanding");ui.analysisProgress=22;render();await yieldFrame();
      // Deskew before anything measures a component. See estimatePlanSkew.
      //
      // Only when the evidence is real: the best angle has to beat square-on by
      // a margin, not merely tie with it. Measured, that gain is 2.03 and 2.20
      // on the two genuinely rotated variants and exactly 1.0000 on the six
      // straight renderings, so the deadband is not a close call.
      const skew=globalThis.MERIT_PLAN_DETECTION.resolve().estimatePlanSkew(canvas,width,height);
      const deskewDeg=skew.applyDeg;stage("skew");
      // Every frame and both box conventions live in MeritPlanFrames
      // (src/plan-frames.js): the detector reads DESKEWED pixels, the product
      // stores and draws PLAN percent of the analysis canvas, and a deskew of 0
      // makes both directions the identity.
      const deskew=FRAMES.deskewFrame(width,height,deskewDeg),dw=deskew.dw,dh=deskew.dh;
      let dctx=ctx;
      if(deskew.applied){
        const dcanvas=document.createElement("canvas");dcanvas.width=dw;dcanvas.height=dh;
        dctx=dcanvas.getContext("2d",{willReadFrequently:true});
        // Paper, not black, behind the rotated corners: a black wedge would read
        // as a giant dark object and change every tone family on the plan.
        dctx.fillStyle="#ffffff";dctx.fillRect(0,0,dw,dh);
        dctx.translate(dw/2,dh/2);dctx.rotate(deskew.rad);dctx.drawImage(canvas,-width/2,-height/2);
        dctx.setTransform(1,0,0,1,0,0);
      }
      const pixels=dctx.getImageData(0,0,dw,dh);stage("deskew");
      // A candidate's w/h are its oriented box's own dimensions, so rotating
      // the frame moves only the centre and shifts the angle by the correction
      // applied. A candidate is a CORNER box; the seats nested in it are CENTRE
      // boxes — the two conventions MeritPlanFrames names.
      const planFromDeskew=o=>{
        if(!o)return o;
        if(deskew.applied)FRAMES.mapBox(o,FRAMES.CORNER,deskew.deskewToAnalysis,dw,dh,width,height,deskewDeg);
        for(const ch of o.chairDetections||[])planFromDeskewChair(ch);
        return o;
      };
      const planFromDeskewChair=ch=>deskew.applied?FRAMES.mapBox(ch,FRAMES.CENTRE,deskew.deskewToAnalysis,dw,dh,width,height,deskewDeg):ch;
      // Human-confirmed regions travel the other way: they were stored in plan
      // percent and the detector needs them where it is looking.
      const deskewToPlan=list=>!deskew.applied?list:list.map(r=>{
        const m=FRAMES.mapBox({x:r.x,y:r.y,w:r.w,h:r.h},FRAMES.CORNER,deskew.analysisToDeskew,width,height,dw,dh);
        return{x:m.x,y:m.y,w:m.w,h:m.h};
      });
      // The application layer talks to a PlanDetectionProvider, never to pixel
      // code or a vendor SDK directly (merit-plan-intelligence, "Provider
      // abstraction"). Today exactly one provider is installed and it is
      // classical computer vision. The local plan-symbol detector is not a
      // provider: it takes a second look beside it, below, and the analysis
      // records trainedModel true only when that model ran.
      const provider=globalThis.MERIT_PLAN_DETECTION.resolve();
      // The OCR MODEL reads the plan's text FIRST (src/plan-ocr-paddle.js): its
      // lines are the one evidence the detector takes from text — what is
      // printed is not a seat (see textRegions in plan-detection-chairs.js) —
      // and the same read later feeds the capacity, label and number stages.
      // Its boxes are SOURCE pixels; the detector looks at the deskewed
      // analysis canvas, so each line's corners go through both frames.
      ui.analysisStage=t("analysis.stage.labels");render();await yieldFrame();
      // The local plan-symbol detector (src/plan-model.js) needs only the
      // deskewed pixels and the runtime the OCR model brings. It starts as soon
      // as that runtime is up and runs in a worker beside the OCR model's read;
      // its answer is taken after the classical detector, where it always was.
      // The detector only reads the pixels, so both see the same ones.
      const localModelStarted=globalThis.MeritPlanModel&&globalThis.MeritPlanModelFusion?(async()=>{
        // EXPECTED ABSTENTION: a runtime that does not come up is reported by
        // the OCR model's read and by the local model's own (RUNTIME_NOT_LOADED).
        await globalThis.MeritPaddleOCR?.ready?.().catch(()=>null);
        if(abort.signal.aborted)return{available:false,reasonCode:"STOPPED",reason:"the analysis was stopped",detections:[]};
        return MeritPlanModel.detect(pixels,dw,dh);
      })():null;
      const ocrModelRead=await guard(pre&&pre.model
        ?pre.model.then(r=>{if(r&&r.available){prefetchUse.model=true;return r;}return PLANTEXT.readPlanTextWithModel(event,undefined,abort.signal);})
        :PLANTEXT.readPlanTextWithModel(event,undefined,abort.signal));stage("ocrModel");
      keptReads.model=ocrModelRead&&ocrModelRead.available?PLANTEXT.copyRead(ocrModelRead):null;
      if(!ocrStarted)ocrStarted=ocrModelRead.available&&globalThis.Tesseract
        ?Promise.resolve({available:true,text:"",words:[],pageRead:"skipped: the OCR model read the page"})
        :readWholePage();
      // The crop workers start now, while the detector holds the page, so they
      // are ready when the label and number stages ask for them.
      globalThis.MeritPlanOCRCrops?.prewarm();
      // A plan imported from a PDF that carries TEXT OBJECTS (src/plan-pdf-text.js)
      // hands them on as exact text in the analysis pixels: the document states
      // its words, nothing reads them. They join the model's lines wherever
      // those are used for what is printed (never as a table's number — that
      // vote has its own provenance). A scan wrapped in a PDF has none.
      const pdfItems=globalThis.MeritPdfText?MeritPdfText.scaledItems(event.background?.pdfSource,width,height):[];
      const textRegions=[];
      const textRegion=(box,sx,sy)=>{
        const corners=[[box.x0,box.y0],[box.x1,box.y0],[box.x0,box.y1],[box.x1,box.y1]]
          .map(([x,y])=>deskew.applied?deskew.analysisToDeskew.apply(x*sx,y*sy):[x*sx,y*sy]);
        textRegions.push({x0:Math.min(...corners.map(c=>c[0])),y0:Math.min(...corners.map(c=>c[1])),
          x1:Math.max(...corners.map(c=>c[0])),y1:Math.max(...corners.map(c=>c[1]))});
      };
      if(ocrModelRead.available&&ocrModelRead.imageSize){
        const sx=width/ocrModelRead.imageSize.width,sy=height/ocrModelRead.imageSize.height;
        for(const it of ocrModelRead.items||[]){
          if(!(it.score>=.9)||!String(it.text||"").trim())continue;
          textRegion(it.box,sx,sy);
        }
      }
      for(const it of pdfItems)textRegion(it.box,1,1);
      const detectionStartedAt=performance.now();
      // Regions the operator has already ruled on. An automatic filter is
      // allowed to disagree with the detector; it is never allowed to overrule
      // a human. Without this, fragment suppression runs before plan memory is
      // re-applied, so a table the operator explicitly confirmed could be
      // deleted before memory ever got the chance to restore it. It happened
      // to survive in testing only because an unrelated chair candidate
      // remained at that position for memory to match against -- an accident,
      // not a guarantee.
      const protectedRegions=(event.planMemory||[])
        .filter(m=>m.status==="confirmed"||m.manual)
        .map(m=>({x:m.geometry.x,y:m.geometry.y,w:m.geometry.w,h:m.geometry.h}));
      const detection=await guard(provider.detect(pixels,dw,dh,{confidenceThreshold:calibratedThreshold,protectedRegions:deskewToPlan(protectedRegions),textRegions,onStage:async(key,progress)=>{
        checkStopped();ui.analysisStage=t("analysis.stage."+key);ui.analysisProgress=progress;render();await yieldFrame();
      }}));
      const detectionMs=Math.round(performance.now()-detectionStartedAt);stage("classicalDetect");
      const candidates=detection.candidates,venues=detection.venues,threshold=detection.threshold;
      // The local plan-symbol detector (src/plan-model.js) takes a second,
      // independent look at the same deskewed pixels. Fusion adds only what the
      // classical pipeline did not propose and marks what the model does not
      // support; it removes nothing (src/plan-model-fusion.js). When the model
      // is unavailable the reason is kept and the classical path goes on alone.
      let localModel=null;
      if(localModelStarted){
        ui.analysisStage=t("analysis.stage.localModel");render();await yieldFrame();
        const read=await guard(localModelStarted);
        const fused=MeritPlanModelFusion.fuse(candidates,venues,read,{width:dw,height:dh,uid,representation:detection.representation,textRegions,pixels:pixels.data});
        candidates.push(...fused.added);venues.push(...fused.addedVenues);
        localModel={available:read.available,reasonCode:read.reasonCode||null,reason:read.reason||null,ms:read.ms??null,model:read.model,
          loadMs:read.model&&read.model.loadMs!=null?read.model.loadMs:null,detections:read.detections.length,addedTables:fused.added.length,addedColumns:fused.addedVenues.filter(v=>v.type==="column").length,addedSeating:fused.seatingAdded,seatingOriented:fused.seatingOriented,tablesOnSeating:fused.tablesOnSeating,chairsAttached:fused.chairsAttached,chairsInText:fused.chairsInText,offSize:fused.offSize,unsupported:fused.unsupported};
      }
      // A vector PDF's own furniture shapes, when the import found repeated ones:
      // exact geometry, fused the same way (added where nothing was proposed).
      // No printed-text rule here: a drawn chair is drawn, whatever number is
      // printed inside it; the rule exists for what a model READ off pixels.
      // And chairs ARE attached (addChair), unlike the local model's: they are
      // the document's own shapes, not a reading (benchmarks/offline-intelligence,
      // vector-latest.json).
      let vectorObjects=null;
      const vo=event.background?.pdfSource?.vector?.objects;
      if(vo&&globalThis.MeritPlanModelFusion&&(vo.tables||[]).length&&!globalThis.MERIT_PLAN_VECTOR_DISABLED){
        const ps=event.background.pdfSource,kx=width/(ps.width||width),ky=height/(ps.height||height);
        const toDeskew=b=>{const[cx,cy]=deskew.applied?deskew.analysisToDeskew.apply(b.cx*kx,b.cy*ky):[b.cx*kx,b.cy*ky];return{cls:b.cls,score:1,cx,cy,w:b.w*kx,h:b.h*ky};};
        const fusedV=MeritPlanModelFusion.fuse(candidates,venues,{available:true,detections:[...vo.tables,...vo.chairs].map(toDeskew)},{width:dw,height:dh,uid,representation:detection.representation},{source:"pdf-vector",addChair:0.45,supportField:"vectorSupport"});
        candidates.push(...fusedV.added);
        vectorObjects={reason:vo.reason,proposedTables:vo.tables.length,proposedChairs:vo.chairs.length,addedTables:fusedV.added.length,chairsAttached:fusedV.chairsAttached};
      }
      stage("localModelAndVector");
      ui.analysisStage=t("analysis.stage.seating");ui.analysisProgress=73;render();await yieldFrame();
      // Through the provider boundary rather than the function directly. That
      // seam was built for a future learned model and is now carrying one:
      // when src/plan-encoder-weights.js is present this resolves to the
      // trained encoder concatenated with the descriptor, and to the
      // descriptor alone when it is not. Which one ran is reported in the
      // detection diagnostics, never assumed.
      //
      // Embedding reads the deskewed pixel buffers, so it happens while the
      // geometry is still in deskewed space; the mapping back to plan space is
      // the next statement.
      const embedder=resolveVisualEmbeddingProvider();
      const embeddingStartedAt=performance.now();
      // In slices of about 40 ms, so a dense plan's few hundred crops do not
      // hold the page for a second at a time (measured: one task of ~1 s on
      // ORNEK). Each object's vector is its own; only the waiting changes.
      await inSlices(candidates,c=>{c.visualDescriptor=embedder.embed(detection.gray,detection.binary,dw,dh,c);},checkStopped);
      await inSlices(venues,c=>{c.visualDescriptor=embedder.embed(detection.gray,detection.binary,dw,dh,c);},checkStopped);
      // Seats the associator attached to a table are the best-corroborated
      // chairs on the plan, and they are what lets the second opinion say
      // "that looks more like a chair than a table" instead of only "that
      // matches nothing well". Measured: on six of the seven degraded
      // renderings a false table sits closer to a real chair than to a real
      // table (benchmarks/embedding/separation.json).
      //
      // Their vectors are kept OFF the stored objects and thrown away with
      // this pass. Persisting ~113 extra 128-float arrays per analysis would
      // cost real storage for something recomputed on every run. A nested seat
      // carries its CENTRE in x/y, so the box is converted before cropping.
      const seatVectors=new Map();
      await inSlices(candidates,c=>{for(const ch of c.chairDetections||[]){
        const v=embedder.embed(detection.gray,detection.binary,dw,dh,
          {x:ch.x-ch.w/2,y:ch.y-ch.h/2,w:ch.w,h:ch.h});
        if(v?.vector)seatVectors.set(ch.id,{vector:v.vector,tableId:c.id});
      }},checkStopped);
      const embeddingMs=Math.round(performance.now()-embeddingStartedAt);
      for(const c of [...candidates,...venues])planFromDeskew(c);
      await turn();
      // A table SYMBOL is found by the fill inside its ring; its drawn edge is
      // the ring. Measured from the pixels (src/plan-symbol-geometry.js) before
      // anything — memory included — reads the geometry. Only symbols: a table
      // with drawn chairs is measured by its own surface, and an axis-aligned
      // walk says nothing true about a rotated box.
      if(globalThis.MeritSymbolGeometry){
        const raster=ctx.getImageData(0,0,width,height);
        await turn();
        let refined=0;
        for(const c of candidates){
          if(c.kind!=="table"||c.symbolFamily!==true||(c.rotation||0)%180!==0)continue;
          const box={x0:c.x/100*width,y0:c.y/100*height,x1:(c.x+c.w)/100*width,y1:(c.y+c.h)/100*height};
          const r=globalThis.MeritSymbolGeometry.outerOutline(raster,box);
          if(!r||(r.x0===box.x0&&r.y0===box.y0&&r.x1===box.x1&&r.y1===box.y1))continue;
          c.geometryRefined={from:{x:c.x,y:c.y,w:c.w,h:c.h},basis:"the symbol's drawn ring, measured from the pixels",sides:r.measuredSides};
          c.x=r.x0/width*100;c.y=r.y0/height*100;c.w=(r.x1-r.x0)/width*100;c.h=(r.y1-r.y0)/height*100;
          refined++;
        }
        detection.diagnostics.symbolOutlinesRefined=refined;
        await turn();
      }
      detection.diagnostics.tablesHeldForOverlap=REFINE.holdBackOverlappingTables(candidates);
      const previous=event.analysis?.candidates||[],signatures=list=>list.map(c=>`${c.kind}:${c.type}:${Math.round(c.x)}:${Math.round(c.y)}`),oldSig=new Set(signatures(previous)),newSig=new Set(signatures([...candidates,...venues]));
      const freshCandidates=[...candidates,...venues];
      const priorCandidates=event.analysis?.candidates||[],priorDecisions=event.analysis?.groupingDecisions||[];
      const memoryResult=applyPlanMemory(freshCandidates,event.planMemory||[]);
      const allCandidates=[...freshCandidates,...memoryResult.restored];
      // Which candidate carries which human decision, so the reference tiering
      // below can tell a confirmed object from the detector's own guess. Run
      // AFTER plan memory, so a reclassified candidate is referenced under the
      // class the operator gave it rather than the one the detector guessed.
      const memoryByCandidate=new Map();
      for(const m of event.planMemory||[]){
        const cid=memoryResult.idRemap.get(m.sourceCandidateId);
        if(cid)memoryByCandidate.set(cid,m);
      }
      const secondOpinionStartedAt=performance.now();
      const secondOpinion=REFINE.applyVisualSecondOpinion(allCandidates,memoryByCandidate,seatVectors);
      secondOpinion.ms=Math.round(performance.now()-secondOpinionStartedAt);
      // Grouping decisions are keyed by candidate id, which is regenerated on
      // every analysis pass -- remap them through the same geometry match so
      // a "these are separate tables" answer survives Re-Analyze instead of
      // silently reverting to the detector's default grouping.
      await turn();
      const geometryRemap=matchCandidatesByGeometry(priorCandidates,allCandidates);
      const carriedDecisions=priorDecisions.map(d=>({...d,memberIds:d.memberIds.map(id=>geometryRemap.get(id)).filter(Boolean)})).filter(d=>d.memberIds.length>=2);
      event.analysis={id:uid("analysis"),engine:"ASSISTED_DETECTION",trainedModel:!!(localModel&&localModel.available),localModel,vectorObjects,notice:localModel&&localModel.available?"Classical computer vision and the local plan-symbol detector (a small trained model of plan symbols) are active.":"Classical computer vision is active; no trained Merit model is installed in this browser review.",createdAt:nowISO(),imageWidth:width,imageHeight:height,originalWidth:analysisFrame.originalWidth,originalHeight:analysisFrame.originalHeight,threshold,candidates:allCandidates,missed:allCandidates.filter(c=>c.missed).map(c=>c.id),groupingDecisions:carriedDecisions,memoryReapplied:memoryResult.reappliedCount,memoryRestored:memoryResult.restored.length,memoryConflicts:memoryResult.conflicts,comparison:{added:[...newSig].filter(x=>!oldSig.has(x)).length,removed:[...oldSig].filter(x=>!newSig.has(x)).length,changed:0},diagnostics:{...detection.diagnostics,resolution:`${width}×${height}`,detectionMs,provider:provider.id,providerLabel:provider.label,
        // Which visual representation actually produced the descriptors, and
        // whether it involved trained weights. Reported from the resolved
        // provider rather than from a constant, so an install without the
        // encoder says so instead of claiming one ran.
        embedding:{id:embedder.id,kind:embedder.kind||"handcrafted-descriptor",trainedModel:!!embedder.trainedModel,
          dimensions:embedder.dimensions||null,embeddingMs,
          cache:globalThis.MeritPlanEncoder?.cacheStats?.()||null,
          secondOpinion}}};
      // A complete PlanIntelligenceResult exists from the moment the analysis
      // object does, so the review screen (and anything reading the stored
      // event) never sees an analysis with null provider metadata or a null
      // seat count while OCR is still being attempted. It is recomputed below
      // once OCR either produced real text or honestly reported unavailable.
      event.analysis.ocrText=null;
      event.analysis.planIntelligence=buildPlanIntelligence(event,null);
      ui.analysisStage=t("analysis.stage.labels");ui.analysisProgress=84;render();await yieldFrame();
      stage("embedMemoryBuild");
      const ocrResult=await guard(ocrStarted);stage("tesseractWait");
      keptReads.page=ocrResult&&ocrResult.available&&ocrResult.pageRead==null?PLANTEXT.copyRead(ocrResult):null;
      event.analysis.ocr={available:ocrResult.available,reason:ocrResult.reason||null,reasonCode:ocrResult.reasonCode||null,engine:"tesseract.js"};
      // Kept in full (not just the truncated capacityAudit.sourceText) so a
      // grouping/reclassification decision can recompute planIntelligence
      // later without re-running OCR.
      event.analysis.ocrText=ocrResult.available?ocrResult.text:null;
      let suppressedByText=[];
      // The words text suppression measures against: Tesseract's, and the
      // lines the OCR model read (score >= 0.9) in the same analysis pixels.
      // Tesseract does not read outlined lettering — the Golden Plan's GİRİŞ,
      // BAR, the capacity block — and a "table" made of a door label and the
      // column beside it was then only held back by accident.
      const suppressionWords=[...(ocrResult.available?ocrResult.words||[]:[])];
      if(ocrModelRead.available&&ocrModelRead.imageSize){
        const sx=width/ocrModelRead.imageSize.width,sy=height/ocrModelRead.imageSize.height;
        for(const it of ocrModelRead.items||[])if(it.score>=.9&&String(it.text||"").trim())
          suppressionWords.push({text:it.text,bbox:{x0:it.box.x0*sx,y0:it.box.y0*sy,x1:it.box.x1*sx,y1:it.box.y1*sy}});
      }
      for(const it of pdfItems)suppressionWords.push({text:it.text,bbox:{...it.box}});
      const pdfSource=event.background?.pdfSource;
      if(pdfSource)event.analysis.diagnostics.pdfSource={kind:pdfSource.kind||null,textItems:pdfItems.length,
        paths:pdfSource.vector?.paths??null,images:pdfSource.vector?.images??null,truncated:!!pdfSource.text?.truncated,
        content:["RASTER","VECTOR","MIXED","EMPTY"].includes(pdfSource.content)?pdfSource.content:null,
        shapes:pdfSource.vector?.shapes&&typeof pdfSource.vector.shapes==="object"?Object.fromEntries(["rect","circle","ellipse","polygon","line","clipped"].map(k=>[k,Math.max(0,Math.floor(Number(pdfSource.vector.shapes[k])||0))])):null};
      // The plan's pixels, read once: text suppression asks the drawing what
      // is under a word (drawnEvidence), and the venue and facing reads below
      // use the same raster. Nothing draws on this canvas in between.
      let planRaster=null;
      if(suppressionWords.length){
        planRaster=ctx.getImageData(0,0,width,height);
        const suppression=REFINE.suppressTextFalsePositives(event.analysis.candidates,suppressionWords,width,height,planRaster);
        event.analysis.candidates=suppression.kept;
        event.analysis.diagnostics.textSuppressed=suppression.removedCount;
        event.analysis.diagnostics.textSuppressionKeptAsDrawn=suppression.keptAsDrawn;
        suppressedByText=suppression.removed||[];
      }
      ui.analysisStage=t("analysis.stage.labels");render();await yieldFrame();
      // The OCR MODEL (src/plan-ocr-paddle.js, PP-OCRv4): one plan-wide read at
      // the plan's own resolution, beside Tesseract. Its lines join the text
      // the capacity and label layers read, and its reading of each table's
      // symbol is one view in the printed-number vote. Unavailable is recorded
      // as such -- the Tesseract path carries on alone.
      event.analysis.ocrModel=ocrModelRead;
      if(event.analysis.ocrModel.available){
        const modelText=event.analysis.ocrModel.items.map(i=>i.text).join("\n").normalize("NFKC");
        event.analysis.ocrText=[event.analysis.ocrText,modelText].filter(Boolean).join("\n");
      }
      if(pdfItems.length)event.analysis.ocrText=[event.analysis.ocrText,pdfItems.map(i=>i.text).join("\n").normalize("NFKC")].filter(Boolean).join("\n");
      stage("textSuppression");
      await guard(REFINE.identifyLabelledVenueObjects(event,suppressedByText,abort.signal));stage("labels");
      // A turn for the page between the three steps of this stage, and inside
      // the facing read (each was measured over 200 ms on its own plan).
      let turnAt=performance.now();
      const pace=async()=>{if(performance.now()-turnAt<40)return;await turn();turnAt=performance.now();};
      await turn();
      if(!planRaster)planRaster=ctx.getImageData(0,0,width,height);
      await turn();
      await REFINE.placeNamedVenueElements(event,planRaster,ocrResult,pdfItems,turn);
      await turn();turnAt=performance.now();
      await REFINE.readChairFacing(event,planRaster,pace);stage("venueAndFacing");
      await guard(PLANTEXT.readPrintedTableNumbers(event,abort.signal,turn));stage("tableNumbers");
      // The drawing's own fingerprint, so a lesson taught on it can be found
      // again after a re-import under a different filename. Failing to compute
      // it is not fatal: plan-scope lessons simply do not match, which is the
      // safe direction.
      try{event.analysis.planHash=await guard(planHashFor(event.background.src));}catch(hashError){if(hashError?.analysisStopped)throw hashError;event.analysis.planHash=null;}stage("planHash");
      checkStopped();
      // Before plan intelligence is rebuilt, because a lesson can move an
      // object from table to venue and the capacity, relationship and
      // consistency layers all have to see the corrected answer.
      TEACH.applyTeachArea(event);
      // What each stage saw, in which frame, with its own confidence and a link
      // to look again (MeritObservations). Rebuilt whole on every analysis, so
      // no observation outlives the candidate it describes.
      event.analysis.frames={source:{width:analysisFrame.sourceWidth,height:analysisFrame.sourceHeight},analysis:{width,height,ratio},deskewDeg:deskewDeg||0,storedIn:"plan-percent of the analysis canvas",conventions:{candidate:FRAMES.CORNER,seat:FRAMES.CENTRE}};
      globalThis.MeritObservations.recordFromAnalysis(event.analysis,{detector:{id:provider.id,version:provider.version||null},ocrEngine:event.analysis.ocr?.available?"tesseract.js":null,ocrModel:event.analysis.ocrModel?.available?event.analysis.ocrModel.provider.id:null,imageRef:event.analysis.planHash||null});
      ui.analysisStage=t("analysis.stage.relating");ui.analysisProgress=90;render();await yieldFrame();
      ui.analysisStage=t("analysis.stage.capacity");ui.analysisProgress=95;render();await yieldFrame();
      event.analysis.planIntelligence=buildPlanIntelligence(event,event.analysis.ocrText);
      // LAST, and that position is the whole point. The self-check compares
      // what the drawing states against what was found, and the statement only
      // exists once planIntelligence has been rebuilt from the OCR text. Run
      // any earlier and it reads the pre-OCR interpretation: on a plan whose
      // tables are not numbered, readPrintedTableNumbers returns before it
      // refreshes anything, so the capacity rule the drawing prints would
      // simply not be there to check. It runs on every plan, not only numbered
      // ones — a drawing that prints a capacity rule can be checked against
      // itself whatever its tables look like.
      await turn();
      TEACH.runSelfCheck(event);
      await turn();
      // Last, and only last: it ranks what every layer above it concluded.
      TEACH.runConfidenceBudget(event);stage("intelligence");
      ui.analysisStage=t("analysis.stage.review");ui.analysisProgress=100;ui.analysisBusy=false;ui.analysisAbort=null;
      event.analysis.timings={importedAtMs:event.background?.importedAtMs??null,analysisStartedAtMs,analysisCompletedAtMs:Date.now(),stages:stageTimes,tesseractMs,prefetch:prefetchUse};
      if(globalThis.MERIT_PREFETCH!=="off"&&keptReads.model&&keptReads.model.available&&keptReads.page&&keptReads.page.available)keptPlanText={src:event.background.src,model:keptReads.model,page:keptReads.page};ui.selectedCandidateId=event.analysis.candidates[0]?.id||null;ui.difficultQuestionIndex=0;ui.activeReviewGroupId=null;ui.activeQuestionId=null;audit(event,"ASSISTED_DETECTION_COMPLETED",event.analysis.diagnostics);touchEvent(event);render();
      // A model on this computer, measured on closed questions, then looks at
      // what the analysis is unsure of — by itself, in the background (screen-vlm).
      VLMSCREEN.afterAnalysis(event);
    }catch(error){
      event.analysis=priorAnalysis;ui.analysisAbort=null;
      if(error?.analysisStopped||abort.signal.aborted){
        prefetchStoppedSrc=event.background?.src||null;
        ui.analysisBusy=false;ui.analysisStage=t("analysis.stage.cancelled");render();toast(t("detect.cancelled"),"info",5000);
        return;
      }
      console.warn("Assisted Detection failed; the previous analysis is kept.",error);
      ui.analysisBusy=false;ui.analysisStage=t("analysis.stage.failed");render();toast(t("detect.failed"),"error",7000);
    }
  }
  // The Stop button. Ends the engines' work, not just the wait for it: every
  // OCR worker (a recognition cannot be interrupted any other way), and the
  // ONNX workers when an inference is running there — whose sessions go with
  // them, so the OCR model and the local detector load again on the next run.
  function stopAnalysis(){
    if(!ui.analysisBusy||!ui.analysisAbort||ui.analysisAbort.signal.aborted)return;
    ui.analysisStage=t("analysis.stage.cancelling");
    ui.analysisAbort.abort();
    stopAnalysisEngines();
    render();
  }
  function stopAnalysisEngines(){
    const stoppedEngines={tesseract:false,onnx:false};
    if(globalThis.MeritPlanOCRCrops){globalThis.MeritPlanOCRCrops.terminate();stoppedEngines.tesseract=true;}
    const pool=globalThis.MeritOrtPool;
    if(pool&&pool.status().busy>0){
      pool.terminate();
      globalThis.MeritPaddleOCR?.reset?.();
      globalThis.MeritPlanModel?.release?.();
      stoppedEngines.onnx=true;
    }
    ui.analysisStoppedEngines=stoppedEngines;
    return stoppedEngines;
  }
  // Re-derives the whole PlanIntelligenceResult from the CURRENT candidates +
  // any recorded grouping/reclassification decisions. Called after every
  // decision that changes the logical interpretation of the plan (grouping
  // answers, cross-kind reclassification) so capacity, dining-group counts,
  // Review Center and overlays are never stale relative to what a human
  // actually decided.
  // The self-check goes with it: a reclassification changes how many tables
  // were found, and a consistency report that still quotes the old count is
  // worse than none — it disagrees with the screen it sits on.
  function recomputePlanIntelligence(event){event.analysis.planIntelligence=buildPlanIntelligence(event,event.analysis.ocrText??null);TEACH.runSelfCheck(event);TEACH.runConfidenceBudget(event);}
  function reviewCandidates(event){const a=event.analysis;if(!a)return[];return a.candidates.filter(c=>(ui.reviewFilter==="all"||c.status===ui.reviewFilter)&&(ui.reviewClass==="all"||c.kind===ui.reviewClass)&&c.confidence>=ui.reviewConfidence);}
  // Which candidate(s) the screen is actively asking a question about right
  // now — a difficult question's whole furniture group, an inspected Review
  // Center family, or a single selected candidate, in that priority order.
  // Everything NOT in this set gets visually quieted (see candidateBox)
  // so the one real decision in front of the human is unmistakable.
  function activeReviewTargetIds(pi){
    if(!pi)return null;
    if(ui.activeQuestionId){
      const q=pi.uncertainQuestions.find(x=>x.id===ui.activeQuestionId),group=q&&pi.furnitureGroups.find(g=>g.id===q.groupId);
      if(group)return{ids:new Set(group.memberIds),isGroup:group.memberIds.length>1};
    }
    if(ui.activeReviewGroupId){
      const group=pi.reviewGroups.find(g=>g.id===ui.activeReviewGroupId);
      if(group)return{ids:new Set(group.memberIds),isGroup:true};
    }
    if(ui.selectedCandidateId)return{ids:new Set([ui.selectedCandidateId]),isGroup:false};
    return null;
  }
  function unionBbox(members){
    if(!members.length)return null;
    const xs=members.flatMap(m=>[m.x,m.x+m.w]),ys=members.flatMap(m=>[m.y,m.y+m.h]);
    return{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
  }
  // Real camera-fit for a group review: scales/pans the (transformed) scene
  // wrapper so the target bbox fills most of the visible map, instead of
  // relying on the human to spot a small group inside a large plan. Resets
  // to the neutral 1x view for a plain single-candidate look (no bbox).
  function applyReviewZoom(bbox){
    const outer=document.getElementById("analysisScene"),inner=document.getElementById("analysisSceneInner");
    if(!outer||!inner)return;
    if(!bbox){inner.style.transform="";return;}
    const rect=outer.getBoundingClientRect();if(!rect.width||!rect.height)return;
    // Percentages are relative to the inner box (the rendered plan image), and
    // that box is centred inside the outer panel rather than filling it, so
    // measure both: offsetWidth/offsetLeft are layout values and are not
    // affected by the transform already on the element.
    const iw=inner.offsetWidth||rect.width,ih=inner.offsetHeight||rect.height;
    const ox=inner.offsetLeft,oy=inner.offsetTop;
    const pad=.4,tx=Math.max(0,bbox.x-bbox.w*pad),ty=Math.max(0,bbox.y-bbox.h*pad),tw=Math.min(100-tx,bbox.w*(1+2*pad)||20),th=Math.min(100-ty,bbox.h*(1+2*pad)||20);
    const scale=Math.max(1,Math.min(4,Math.min(100/Math.max(8,tw),100/Math.max(8,th))));
    const cxPx=(tx+tw/2)/100*iw,cyPx=(ty+th/2)/100*ih;
    inner.style.transform=`translate(${rect.width/2-ox-cxPx*scale}px, ${rect.height/2-oy-cyPx*scale}px) scale(${scale})`;
  }
  function candidateBox(c,selected,targetIds){
    const reviewCls=targetIds?(targetIds.has(c.id)?"review-target":"review-dimmed"):"";
    // a stored record can hold anything here (security sweep 2026-11-01): words escaped, numbers made numbers
    const n=(v,d=0)=>{const x=Number(v);return Number.isFinite(x)?x:d;};
    return`<button class="candidate-box ${esc(c.kind)} ${esc(c.status)} ${selected?"selected":""} ${reviewCls}" data-candidate-box="${esc(c.id)}" style="left:${n(c.x)}%;top:${n(c.y)}%;width:${n(c.w)}%;height:${n(c.h)}%;transform:rotate(${n(c.rotation)}deg)" title="${esc(c.kind)} · ${Number.isFinite(c.confidence)?Math.round(c.confidence*100)+"%":"—"}"></button>${(c.chairDetections||[]).map(ch=>`<i class="candidate-box chair ${reviewCls}" style="left:${n(ch.x)}%;top:${n(ch.y)}%;width:${Math.max(.5,n(ch.w))}%;height:${Math.max(.5,n(ch.h))}%;transform:translate(-50%,-50%) rotate(${n(ch.rotation)}deg)"></i>`).join("")}`;
  }
  // ============================================================
  // Concept 3 + Concept 2 + Concept 1 unified Plan Intelligence review screen.
  // The imported plan is the full-bleed hero. Review pins mark only the
  // objects a similarity cluster or a difficult question actually flags —
  // never every low-confidence box individually. A small POI card answers
  // one object; Review Center answers a whole family at once; the difficult
  // -question card is reserved for genuinely ambiguous multi-table grouping.
  // ============================================================
  // Full cross-kind reclassification taxonomy (merit-plan-intelligence
  // contract): correcting a detection to ANY of these must be able to cross
  // table<->venue kind, not just swap type within the same kind. "Ignore" is
  // deliberately not listed here — it is the existing "Not an object" reject
  // action, which already stores a real negative example rather than deleting.
  // Seating furniture whose capacity cannot be read off the drawing. A round
  // table with eight chairs drawn round it states its own capacity; a
  // banquette running along a wall does not, and the number of covers a venue
  // sets on it is an operational decision, not a geometric fact.
  //
  // So these carry seats:null / seatsConfidence:"unverified" and contribute
  // NOTHING to capacity until a human enters a number. That is deliberately
  // different from contributing zero: zero is a claim, and an unverified
  // banquette is an admitted unknown that the capacity auditor surfaces rather
  // than quietly absorbs.
  // A loca (a box sold as one unit) seats a party the drawing rarely prints per
  // box: the same admitted unknown.
  const UNVERIFIED_SEATING=new Set(["sofa","bench","banquette","loca"]);
  const RECLASSIFY_TAXONOMY=[
    {kind:"table",type:"round"},{kind:"table",type:"square"},{kind:"table",type:"rectangle"},{kind:"table",type:"bistro"},
    {kind:"venue",type:"chair"},{kind:"venue",type:"armchair"},
    // Sofa, bench and banquette are first-class types rather than one blurred
    // "sofa/bench" label, because they seat different numbers of people and a
    // venue counts them separately. None of the three ever gets a guessed seat
    // count -- see UNVERIFIED_SEATING below.
    {kind:"venue",type:"sofa"},{kind:"venue",type:"bench"},{kind:"venue",type:"banquette"},{kind:"venue",type:"loca"},
    {kind:"venue",type:"stage"},{kind:"venue",type:"bar"},{kind:"venue",type:"entrance"},{kind:"venue",type:"exit"},
    {kind:"venue",type:"column"},{kind:"venue",type:"text"},{kind:"venue",type:"other"},
  ];
  // ---- moved to src/screen-review.js — see that file's header. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. ----------------------------
  const REVIEW=globalThis.MeritScreenReview.create({
    activeEvent:(...a)=>activeEvent(...a),activeReviewTargetIds:(...a)=>activeReviewTargetIds(...a),applyReviewZoom:(...a)=>applyReviewZoom(...a),candidateBox:(...a)=>candidateBox(...a),esc:(...a)=>esc(...a),FLOORPLAN,icon:(...a)=>icon(...a),OCR_REASON_KEY:TEACH.OCR_REASON_KEY,operatorReportHTML:(...a)=>SESSIONS.operatorReportHTML(...a),RECLASSIFY_TAXONOMY,render:(...a)=>render(...a),reviewCandidates:(...a)=>reviewCandidates(...a),scopeAvailability:(...a)=>TEACH.scopeAvailability(...a),t:(...a)=>t(...a),titleCase:(...a)=>titleCase(...a),toast:(...a)=>toast(...a),ui,unionBbox:(...a)=>unionBbox(...a),UNVERIFIED_SEATING,
    // How many questions src/plan-vlm.js would ask about this analysis; null
    // when the module is not loaded. The review screen states that no
    // vision-language model is configured, with this count beside it.
    vlmQuestionCount:(analysis)=>globalThis.MeritVlm?globalThis.MeritVlm.questionsFor(analysis).length:null,
    // The model reading (src/screen-vlm.js): its control in the header, its
    // marks on the plan, its panel and its diagnostics line.
    vlmToolbarHTML:(...a)=>VLMSCREEN.toolbarHTML(...a),vlmMapHTML:(...a)=>VLMSCREEN.mapHTML(...a),vlmPanelHTML:(...a)=>VLMSCREEN.panelHTML(...a),vlmDiagnosticsHTML:(...a)=>VLMSCREEN.diagnosticsHTML(...a),
    // The plan reading (src/screen-reading.js): its control, its panel, its
    // marks and digital redraw on the plan, the box it zooms to, the view class.
    readingToolbarHTML:(...a)=>READING.toolbarHTML(...a),readingMapHTML:(...a)=>READING.mapHTML(...a),readingPanelHTML:(...a)=>READING.panelHTML(...a),
    readingFocusBox:(...a)=>READING.focusBox(...a),readingViewClass:(...a)=>READING.viewClass(...a),
  });
  const READING=globalThis.MeritScreenReading.create({
    activeEvent:(...a)=>activeEvent(...a),applyReviewZoom:(...a)=>applyReviewZoom(...a),esc:(...a)=>esc(...a),render:(...a)=>render(...a),t:(...a)=>t(...a),ui,
  });
  // The F8 assistant (src/screen-assistant.js): its own panel beside the
  // screen; questions answered from the data, commands carried out through
  // these writers only, each command one undo.
  // Is this page served by the relay (it names itself in a Server-Timing entry)?
  // Only then is there a /vlm-relay to ask; a page opened any other way asks nothing.
  const relayHere=()=>{try{const n=globalThis.performance.getEntriesByType("navigation")[0];return !!(n&&Array.isArray(n.serverTiming)&&n.serverTiming.some(e=>e.name==="merit-relay"));}catch{return false;}};
  // The relay's own status, asked once per page load and only when a relay serves
  // this page: whether a voice engine and web research are configured there.
  let relayStatusOnce=null;
  const relayStatus=()=>relayStatusOnce||(relayStatusOnce=!relayHere()?Promise.resolve(null):fetch("/vlm-relay/status",{headers:{"x-merit-relay":"1"},cache:"no-store",credentials:"same-origin"}).then(r=>r.ok?r.json():null).catch(error=>{console.warn("The relay status could not be read.",error&&error.name);return null;}));
  const ASSIST=globalThis.MeritScreenAssistant.create({
    events:()=>state.events,currentId:()=>ui.screen==="workspace"?ui.activeEventId:null,today:()=>new Date().toLocaleDateString("en-CA"),
    canMutate:(e)=>canMutate(e,"change this event"),t:(...a)=>t(...a),
    // SPEC-v4: a command shown first lights the table it names on the plan.
    highlight:(id)=>{ui.highlightId=id;render();},
    // Mimar's microphone (src/voice-input.js): live only when the relay reports a
    // voice engine; web research (src/web-research.js): only when switched on in
    // ⋯ → Ayarlar (OFF by default), the open event's guest names removed first.
    voice:{available:()=>relayStatus().then(s=>!!(s&&s.voice&&s.voice.configured&&globalThis.MeritVoiceInput)),createRecorder:()=>globalThis.MeritVoiceInput.createRecorder({lang:ui.lang==="en"?"en":"tr"})},
    research:{enabled:()=>!!(globalThis.MeritWebResearch&&TOPBAR.research.enabled()),prepare:(q)=>{const e=activeEvent();return globalThis.MeritWebResearch.prepare(q,{guestNames:e?e.guests.map(g=>g.name):[]});},send:(query)=>globalThis.MeritWebResearch.send(query)},
    // The second reader: what the rules could not place, read by the pinned chat
    // model on this machine through the relay (server/assistant-reader.mjs), and
    // its small-talk reply for what is neither question nor command; null when
    // no relay serves this page or no reader is configured.
    chatText:async(text)=>{if(!relayHere())return null;try{const r=await fetch("/vlm-relay/chat",{method:"POST",headers:{"content-type":"application/json","x-merit-relay":"1"},body:JSON.stringify({text}),cache:"no-store",credentials:"same-origin"});if(!r.ok)return null;const j=await r.json();return j&&j.ok&&typeof j.reply==="string"?j.reply:null;}catch{return null;}},
    readText:async(text)=>{if(!relayHere())return null;try{const r=await fetch("/vlm-relay/read",{method:"POST",headers:{"content-type":"application/json","x-merit-relay":"1"},body:JSON.stringify({text}),cache:"no-store",credentials:"same-origin"});if(!r.ok)return null;const j=await r.json();return j&&j.ok&&j.reading?{reading:j.reading,sure:!!j.sure}:null;}catch{return null;}},
    onChange:()=>{const e=activeEvent();if(e){RULES().syncEventChairs(e);touchEvent(e);}render();},
    // "Götür" from a help answer: the events list, or a tab of the open event (with none open, the events list)
    // F8 "bugün ne eksik" / "ne değişti": read-only summaries in the UI's language
    summary:(what,since)=>{
      const e=activeEvent();if(!e)return{text:t("assistant.noEvent")};
      if(what==="missing"){
        const r=eventReadiness(e);
        const lines=r.reasons.map(x=>{const w=COMMAND.doctorText(x.finding);return w.detail?`${w.what} — ${w.detail}`:w.what;});
        const G=globalThis.MeritGuestGroups,SR=globalThis.MeritSeatingRules;
        for(const v of SR?SR.violations(e):[])lines.push(SEATCMD.ruleLine(v));
        for(const s of G?G.spread(e):[])lines.push(t("groups.spreadLine",{host:s.host,tables:s.tables.map(formatTableNumber).join(", ")}));
        return{text:lines.length?t("assistant.missingSome",{n:lines.length}):t("assistant.missingNone"),lines};
      }
      if(what==="rules"){
        const SR=globalThis.MeritSeatingRules,rs=SR?SR.normalizeAll(e.seatRules):[],nm=id=>(e.guests.find(g=>g.id===id)||{}).name||"?";
        if(!rs.length)return{text:t("rules.none")};
        const v=SR.violations(e);
        return{text:t("rules.list",{n:rs.length}),lines:[...rs.map(r=>r.kind==="apart"?t("rules.apart",{a:nm(r.a),b:nm(r.b)}):t("rules.vipFront")),...v.map(SEATCMD.ruleLine)]};
      }
      if(what==="group"){
        const G=globalThis.MeritGuestGroups,h=G?G.findHost(e,since):{none:true};
        if(!h.group)return{text:h.ambiguous?t("groups.which",{list:h.ambiguous.join(", ")}):t("groups.none",{host:since})};
        const c=G.counts(e).find(x=>x.host===h.group.host);
        return{text:t("groups.countLine",{host:c.host,came:c.came,expected:c.expected,noShow:c.noShow})};
      }
      const rec=digestRoll(e),D=globalThis.MeritChangeDigest;
      const base=since==="today"?rec&&rec.cur:rec&&rec.prev,day=since==="today"?rec&&rec.day:rec&&rec.prevDay;
      const d=base&&D?D.diff(base,e):null;
      if(!d)return{text:t("assistant.changesNoBase")};
      const L=[],tn=n=>n?formatTableNumber(n):t("assistant.noTable");
      if(d.added.length)L.push(t("assistant.chAdded",{n:d.added.length,names:d.added.slice(0,8).join(", ")}));
      if(d.removed.length)L.push(t("assistant.chRemoved",{n:d.removed.length,names:d.removed.slice(0,8).join(", ")}));
      for(const m of d.moved.slice(0,12))L.push(`${m.name}: ${tn(m.from)} → ${tn(m.to)}`);
      if(d.moved.length>12)L.push(t("assistant.chMore",{n:d.moved.length-12}));
      for(const x of d.pax.slice(0,8))L.push(t("assistant.chPax",{name:x.name,from:x.from,to:x.to}));
      for(const x of d.vip.slice(0,8))L.push(`${x.name}: ${x.from||"—"} → ${x.to||"—"}`);
      if(d.tablesAdded.length)L.push(t("assistant.chTablesAdded",{list:d.tablesAdded.map(tn).join(", ")}));
      if(d.tablesRemoved.length)L.push(t("assistant.chTablesRemoved",{list:d.tablesRemoved.map(tn).join(", ")}));
      for(const c of d.capacity)L.push(t("assistant.chCapacity",{number:tn(c.number),from:c.from,to:c.to}));
      if(d.arrived)L.push(t("assistant.chArrived",{n:d.arrived}));
      return{text:d.count||d.arrived?t("assistant.changesSince",{day:fmtDate(day),n:d.count}):t("assistant.changesNone",{day:fmtDate(day)}),lines:L};
    },
    go:(g)=>{if(!g)return;if(g.screen==="events"||!activeEvent()){ui.screen="events";render();return;}ui.screen="workspace";ui.tab=g.tab;ui.selectedObjectId=null;ui.selectedObjectIds=[];render();},
    writers:{
      assign:(id,tableId,seats)=>assignGuestToTable(id,tableId,seats&&seats.length?seats[0]:null),
      unassign:(id)=>unassignGuest(id),
      deleteGuest:(id)=>{const e=activeEvent(),g=e&&e.guests.find(x=>x.id===id);if(!g||!canMutate(e,"delete a guest"))return null;return GUESTUNDO.removeGuestRecord(e,g);},
      restoreGuest:(kept)=>{const e=activeEvent();return e?GUESTUNDO.restoreGuestRecord(e,kept):null;},
      setPax:(id,pax)=>{const e=activeEvent(),g=e&&e.guests.find(x=>x.id===id);if(!g||!canMutate(e,"edit guest records"))return false;return !saveGuestRecord(e,g,{additionalGuests:pax-1,pax}).short;},
      setVip:(id,vip)=>{const e=activeEvent(),g=e&&e.guests.find(x=>x.id===id);if(!g||!canMutate(e,"edit guest records"))return;saveGuestRecord(e,g,{vip});},
      // seating rules: the whole list replaced (undo puts the old list back); warn-only
      setSeatRules:(rules)=>{const e=activeEvent();if(!e||!canMutate(e,"change seating rules"))return null;const before=e.seatRules||[];e.seatRules=globalThis.MeritSeatingRules.normalizeAll(rules);touchEvent(e);return before;},
      // the arrival axis's one writer (setArrival), as the Live screen and the finder use it
      setArrival:(id,status)=>{const e=activeEvent(),g=e&&e.guests.find(x=>x.id===id);if(!g)return null;return ARRIVAL.setArrival(e,g,status,"assistant");},
      addGuest:(name,pax)=>{const e=activeEvent();if(!e||!canMutate(e,"edit guest records"))return null;return saveGuestRecord(e,null,{name,additionalGuests:pax-1,pax,planningStatus:"Confirmed",vip:"Standard",invitedBy:"",notes:"",expectedArrival:null}).guest.id;},
      // An arrangement from the planner (metres) drawn as real tables through
      // createTable, after the canvas undo snapshot: Ctrl+Z and the panel's
      // Geri al both take the whole arrangement back.
      applyLayout:(plan)=>{
        const e=activeEvent();if(!e||!canMutate(e,"add plan objects"))return null;
        const PX=66.7,snap=canvasSnapshot(e);recordUndo(e,snap);
        // A theatre arrangement is drawn as its chair rows (S01…), never as loose chairs.
        const items=plan.event==="theatre"?globalThis.MeritPlannerLayout.rows(plan):plan.items.filter(it=>it.kind!=="chair");
        items.forEach((it,i)=>{
          const type=it.kind==="row"?"row":it.kind==="rect"?"rectangle":it.kind==="square"?"square":it.kind==="bistro"?"bistro":"round";
          const w=Math.round((it.d||it.w)*PX),h=type==="row"?34:Math.round((it.d||it.h)*PX);
          const tb=PLANEDIT.createTable(e,{type,chairs:it.seats||(it.standing||1),prefix:type==="bistro"?"B":type==="row"?"S":"T"},Math.round(it.x*PX-w/2),Math.round(it.y*PX-h/2),i+1);
          tb.w=w;tb.h=h;RULES().syncTableChairs(tb);e.tables.push(tb);
        });
        return()=>{const now=activeEvent();if(now&&canMutate(now,"undo the arrangement"))restoreSnapshot(now,snap);};
      },
    },
  });
  // A grouping answer the local model applies by itself (manifest autoApply,
  // training/README.md "Changing the plan by itself"): the record a person's
  // answer writes, marked as the model's with its run — never a training
  // example — and taken back by id from its finding.
  function applyModelGrouping(event,memberIds,decision,vlm){
    if(!event||!event.analysis||!canMutate(event,"apply a model answer"))return null;
    event.analysis.groupingDecisions ||= [];
    const d={id:uid("groupdecision"),memberIds:[...memberIds],decision,decidedAt:nowISO(),by:"model",vlm:{...vlm}};
    event.analysis.groupingDecisions.push(d);
    recomputePlanIntelligence(event);touchEvent(event);
    return d.id;
  }
  function undoModelGrouping(event,id){
    if(!event||!event.analysis||!canMutate(event,"undo a model answer"))return false;
    const list=event.analysis.groupingDecisions||[],i=list.findIndex(d=>d.id===id&&d.by==="model");
    if(i<0)return false;
    list.splice(i,1);recomputePlanIntelligence(event);touchEvent(event);
    return true;
  }
  const VLMSCREEN=globalThis.MeritScreenVlm.create({
    activeEvent:(...a)=>activeEvent(...a),applyModelGrouping:(...a)=>applyModelGrouping(...a),applyReviewZoom:(...a)=>applyReviewZoom(...a),ask:(...a)=>ask(...a),audit:(...a)=>audit(...a),
    canMutate:(...a)=>canMutate(...a),decideReview:(...a)=>decideReview(...a),esc:(...a)=>esc(...a),icon:(...a)=>icon(...a),render:(...a)=>render(...a),
    t:(...a)=>t(...a),toast:(...a)=>toast(...a),touchEvent:(...a)=>touchEvent(...a),ui,undoModelGrouping:(...a)=>undoModelGrouping(...a),undoReviewDecision:(...a)=>undoReviewDecision(...a),
  });
  // The confidence at which a fresh candidate arrives pre-selected. Local
  // calibration (improveAI) writes state.calibration.recommendedConfidence
  // from the operator's own verified plans; until this existed the button
  // computed that number and nothing ever read it, so "Improve AI" changed
  // nothing. This is threshold calibration from measured examples, not model
  // training, and trainedModel stays false.
  function calibratedThreshold(){
    const v=state.calibration?.recommendedConfidence;
    return Number.isFinite(v)?Math.max(.2,Math.min(.9,v)):.48;
  }
  // Spread a type correction across the candidates the similarity clustering
  // already grouped with this one. Only touches candidates that are still
  // unreviewed AND still carry the exact classification the operator just
  // rejected, so it can never overwrite a decision they made themselves.
  // Exactly which candidates a spread will reach, computed with the same rules
  // the spread itself uses. Shared so the undo snapshot and the mutation can
  // never disagree about the affected set.

  // ---- review decisions: ONE writer ----------------------------------------
  //
  // Everything a person decides about a detected object goes through
  // decideReview(): confirm, reject, "not important", a type change and the
  // family it spreads to, accepting a family in bulk, and switching a candidate
  // in or out of what Confirm writes. MeritReviewDecisions (review-decisions.js)
  // says what the decision does; this applies it together with the four records
  // that have to agree with it -- plan memory (Re-Analyze keeps it), the
  // training label (what the detector said, what the person answered, whether
  // they looked at THIS object), the audit trail, and a human observation on
  // the object -- and undoReviewDecision() takes all of them back together.
  //
  // Before this, each button wrote its own subset: undo withdrew memory but
  // left the training label standing, undoing a correction over an earlier one
  // deleted both memory entries, "not important" deleted the candidate outright,
  // and no decision reached the audit trail. tests/suites/review-decisions.
  //
  // The undo stack is session-only, on ui, like ui.liveRecent: a property of
  // this working session that never reaches the stored schema.
  const retractedDecisions=new Set();
  const REVIEW_OPERATOR_ACTION={confirm:"confirm",reject:"reject",notImportant:"dismiss",confirmFamily:"confirm-family"};
  function applyReviewWrites(c,set){
    for(const k of ["kind","type","status","selected","dismissed"])if(k in set)c[k]=set[k];
    if("printedNumber" in set)c.printedNumber=set.printedNumber;
    if(set.clearSeats)c.chairDetections=[]; // a chair/armchair/sofa/stage/etc. carries no nested seat detections of its own
    if(set.seatsUnknown){c.seats=null;c.seatsConfidence="unverified";}
    if(set.dropSeatsState){delete c.seats;delete c.seatsConfidence;}
    if(set.forgetLesson){delete c.taughtFrom;delete c.typeBasis;}
    if("chairDetections" in set)c.chairDetections=set.chairDetections;
    if("seats" in set){c.seats=set.seats;c.seatsConfidence=set.seatsConfidence||"verified";if(set.seatsSource)c.seatsSource=set.seatsSource;}
  }
  function familyCandidateIds(event,corrected,wasKind,wasType){
    const pi=event.analysis?.planIntelligence;if(!pi)return[];
    const group=(pi.similarityGroups||[]).find(g=>(g.memberIds||[]).includes(corrected.id))
      ||(pi.reviewGroups||[]).find(g=>(g.memberIds||[]).includes(corrected.id));
    if(!group)return[];
    return group.memberIds.filter(id=>{
      if(id===corrected.id)return false;
      const other=event.analysis.candidates.find(x=>x.id===id);
      return !!other&&other.status==="unreviewed"&&other.kind===wasKind&&other.type===wasType;
    });
  }
  function decideReview(event,decision){
    if(!canMutate(event,"record a plan review decision"))return null;
    const a=event?.analysis;if(!a)return null;
    const DEC=globalThis.MeritReviewDecisions,byId=new Map(a.candidates.map(c=>[c.id,c]));
    const subject=byId.get(decision.candidateId);
    // One correction repairs the whole family, not one object -- calibration
    // against measured geometry on this plan, NOT model training.
    // A decision taken on a model's suggestion (decision.via==="vlm") is about
    // the ONE object the person looked at: spread:false keeps the family out.
    const familyIds=decision.kind==="reclassify"&&subject&&decision.spread!==false?familyCandidateIds(event,subject,subject.kind,subject.type):[];
    const p=DEC.plan({...decision,familyIds},{candidates:a.candidates,unverifiedSeating:[...UNVERIFIED_SEATING]});
    if(!p.ok)return null;
    // A model finding this decision answers (decision.vlm) changes WITH it: one
    // transaction, one undo. It must still be open and belong to this analysis.
    const finding=decision.vlm&&a.vlm&&a.vlm.findings.find(f=>f.id===decision.vlm.findingId);
    if(decision.vlm&&(!finding||finding.state!=="open"))return null;
    const decisionId=uid("decision");
    // Created objects are snapshotted as absent, so undo removes them.
    const createdIds=new Set((p.create||[]).map(c=>c.id));
    const before=p.writes.filter(w=>!createdIds.has(w.id)).map(w=>{const c=byId.get(w.id),snap={id:w.id,present:{}};
      for(const k of DEC.SNAPSHOT_FIELDS){snap.present[k]=k in c;if(k in c)snap[k]=clone(c[k]);}return snap;});
    ui.correctionUndo ||= [];
    ui.correctionUndo.push({decisionId,eventId:event.id,analysisId:a.id,kind:p.kind,label:p.kind,before,created:[...createdIds],
      finding:finding?{id:finding.id,state:finding.state}:null,memoryBefore:clone(event.planMemory||[]),at:nowISO()});
    if(ui.correctionUndo.length>30)ui.correctionUndo.shift();
    for(const c of p.create||[]){a.candidates.push(c);byId.set(c.id,c);if(c.missed&&!a.missed.includes(c.id))a.missed.push(c.id);}
    for(const w of p.writes)applyReviewWrites(byId.get(w.id),w.set);
    // An object the decision CREATED has no detection to be matched against on
    // the next analysis: it is remembered as manual, so re-analysis restores it.
    for(const id of p.memory)rememberCorrection(event,byId.get(id),{manual:createdIds.has(id)});
    for(const tr of p.training)captureTrainingExample(event,byId.get(tr.id),{decisionType:tr.decisionType,predictionBefore:tr.predictionBefore,
      note:tr.note||null,decisionId,propagatedFrom:tr.propagatedFrom||null,reviewedIndividually:tr.reviewedIndividually});
    // The object now carries a HUMAN observation: a person, not the detector,
    // said this -- and on one object they looked at, or as part of a spread.
    const O=globalThis.MeritObservations;
    if(O)for(const w of p.writes){
      const c=byId.get(w.id),label=p.training.find(t=>t.id===w.id);
      c.observationIds ||= [];
      O.link(a,c,O.create({id:uid("obs"),source:{kind:"human",provider:"operator"},imageRef:a.planHash||null,
        claim:{decisionId,decision:p.kind,kind:c.kind,type:c.type,status:c.status,selected:c.selected,
          reviewedIndividually:label?label.reviewedIndividually!==false:true},
        geometry:{frame:"plan-percent",convention:"corner",x:c.x,y:c.y,w:c.w,h:c.h,rotation:c.rotation||0},
        evidence:{what:label&&label.propagatedFrom?`spread from ${label.propagatedFrom}`:decision.via==="vlm"?"the operator accepted a vision-language model's suggestion about this object":"the operator's own decision on this object"}}));
    }
    if(finding){finding.state="accepted";finding.decidedAt=nowISO();finding.decisionId=decisionId;finding.appliedTo=p.writes[0]?.id||null;}
    audit(event,"REVIEW_DECISION",{decisionId,kind:p.kind,targets:p.writes.map(w=>w.id),spread:p.spread,labels:p.training.length,
      ...(decision.via==="vlm"?{via:"vlm",findingId:finding?.id||null,runId:decision.vlm?.runId||null}:{})});
    if(REVIEW_OPERATOR_ACTION[p.kind])SESSIONS.recordOperatorAction(event,REVIEW_OPERATOR_ACTION[p.kind],p.writes.map(w=>w.id));
    recomputePlanIntelligence(event);
    touchEvent(event);
    return{decisionId,affected:p.writes.length,spread:p.spread,created:[...createdIds]};
  }
  globalThis.decideReview=decideReview;
  // The last decision on this event — or, given its id, one particular
  // decision, provided no LATER decision touched the same objects (restoring
  // an older snapshot over a newer decision would undo that one too, silently).
  function undoReviewDecision(event,decisionId){
    event=event||activeEvent();
    if(!canMutate(event,"undo a plan correction"))return 0;
    const stack=ui.correctionUndo||[];
    const i=decisionId?stack.findIndex(e=>e.eventId===event.id&&e.decisionId===decisionId):stack.map(e=>e.eventId).lastIndexOf(event.id);
    if(i<0)return 0;
    const ids=e=>new Set([...e.before.map(b=>b.id),...(e.created||[])]);
    if(decisionId){const mine=ids(stack[i]);if(stack.slice(i+1).some(e=>e.eventId===event.id&&[...ids(e)].some(id=>mine.has(id))))return -1;}
    const entry=stack.splice(i,1)[0],a=event.analysis;
    // A decision about candidates of an analysis that has since been replaced
    // (Re-Analyze) has nothing left to restore here; memory carried it over.
    if(!a||a.id!==entry.analysisId)return 0;
    const byId=new Map(a.candidates.map(c=>[c.id,c]));
    let restored=0;
    for(const snap of entry.before){
      const c=byId.get(snap.id);if(!c)continue;
      for(const k of globalThis.MeritReviewDecisions.SNAPSHOT_FIELDS){if(snap.present[k])c[k]=snap[k];else delete c[k];}
      restored++;
    }
    // Objects the decision created are removed again, from every list that holds them.
    if(entry.created?.length){
      const gone=new Set(entry.created);
      a.candidates=a.candidates.filter(c=>!gone.has(c.id));
      a.missed=(a.missed||[]).filter(id=>!gone.has(id));
      restored+=entry.created.length;
    }
    // The model finding it answered is open again.
    if(entry.finding&&a.vlm){const f=a.vlm.findings.find(x=>x.id===entry.finding.id);if(f){f.state=entry.finding.state;delete f.decidedAt;delete f.decisionId;delete f.appliedTo;}}
    // Memory as it was, whole: a correction that REPLACED an earlier decision's
    // entry gets that earlier entry back, not a hole.
    event.planMemory=entry.memoryBefore;
    retractedDecisions.add(entry.decisionId);
    MeritTrainingData.retract(state.trainingData||[],entry.decisionId,{reason:"the decision was undone"});
    const gone=new Set((a.observations||[]).filter(o=>o.source.kind==="human"&&o.claim&&o.claim.decisionId===entry.decisionId).map(o=>o.id));
    if(gone.size){a.observations=a.observations.filter(o=>!gone.has(o.id));for(const c of a.candidates)if(c.observationIds)c.observationIds=c.observationIds.filter(id=>!gone.has(id));}
    audit(event,"REVIEW_DECISION_UNDONE",{decisionId:entry.decisionId,kind:entry.kind,targets:entry.before.map(b=>b.id)});
    recomputePlanIntelligence(event);
    touchEvent(event);
    return restored;
  }
  // Called one frame after the change event, never inside it. A <select> or
  // <input> change fires during blur, and re-rendering the whole app
  // synchronously inside that handler removes the node the browser is still
  // working with -- which throws "The node to be removed is no longer a child
  // of this node. Perhaps it was moved in a 'blur' event handler?" and leaves
  // the review screen half-drawn. Deferring one frame lets blur finish first.
  function updateCandidateField(field,value){
    const event=activeEvent(),c=event.analysis?.candidates.find(x=>x.id===ui.selectedCandidateId);if(!c)return;
    if(field==="seatCount"){
      // Blank means "still unknown", which is a different state from zero and
      // must round-trip as such. Only a number the operator actually typed
      // makes this furniture count toward capacity.
      const raw=String(value).trim();
      if(raw===""){c.seats=null;c.seatsConfidence="unverified";}
      else{c.seats=Math.max(0,Math.min(99,Number(raw)||0));c.seatsConfidence="verified";}
      recomputePlanIntelligence(event);
    }
    else if(field==="rotation")c.rotation=Number(value)||0;
    else if(field==="chairs"){const count=Math.max(0,Math.min(99,Number(value)||0));c.chairDetections=Array.from({length:count},(_,i)=>c.chairDetections?.[i]||{id:uid("candidate-chair"),x:c.x+c.w/2,y:c.y+c.h/2,w:.7,h:.7,rotation:0,confidence:.3});}
    else if(field==="kindtype"){
      // The person's type, spread to the unreviewed members of its family --
      // one decision, one undo, one audit entry (decideReview). Reclassifying
      // INTO seating furniture never invents a capacity: an admitted unknown.
      const [kind,type]=value.split(":");
      const r=decideReview(event,{kind:"reclassify",candidateId:c.id,to:{kind,type}});
      if(r&&r.spread)toast(t("review.correctionSpread",{n:r.spread}),"success",4200);
      render();return;
    }
    else c[field]=value;
    touchEvent(event);render();
  }
  // A seat count a person settled on a table that draws no chairs: typed into
  // the object card, or a suggestion they accepted. It is the table's logical
  // capacity (HUMAN_CONFIRMED) and creates no chair — the physical count stays
  // what the drawing drew, and the printed rule stays its own source.
  const personSeats=c=>c.seatsConfidence==="verified"&&Number.isInteger(c.seats)&&c.seats>0?c.seats:null;
  function commitCandidates(){
    if(!canMutate(activeEvent(),"confirm the plan"))return;
    const event=activeEvent(),chosen=event.analysis?.candidates.filter(c=>c.selected&&c.status!=="rejected")||[];if(!chosen.length)return toast(t("toast.selectDetectionFirst"),"error");
    // A table carries physical chairs only when chairs were found AT IT. It
    // used to inherit the plan's verdict (representation PHYSICAL): a table on
    // a chair-drawing plan whose own chairs were not detected was committed as
    // hasPhysicalSeats:true with no chairs, and syncTableChairs then built a
    // ring from its capacity number on the next load — chairs nobody drew
    // (found by vlm-reading's accept → Confirm → reload chain, 2026-10-10). A
    // SYMBOLIC plan's tables were already false; now an undetected table on a
    // physical plan is too, and its capacity stays a logical number.
    // §5: the drawing's printed capacity rule gives a seatless symbol its
    // capacity ONLY when MeritCapacityProvenance.ruleApplication() says the
    // rule describes these symbols — one decision for the whole commit, with
    // its reason, never a per-table guess. The capacity is a logical seat
    // space: no chair is created for it.
    const CP=globalThis.MeritCapacityProvenance;
    const ruleUse=CP&&CP.ruleApplication?CP.ruleApplication({rule:event.analysis?.planIntelligence?.capacityAudit?.rule||null,
      representationKind:event.analysis?.diagnostics?.representation?.kind||null,
      seatlessTables:(event.analysis?.candidates||[]).filter(c=>c.kind==="table"&&c.status!=="rejected"&&!c.chairDetections?.length).length}):{applies:false};
    recordUndo(event);
    let tables=0,venues=0,chairsKept=0,derived=0;
    // Plan percent -> world through the frame the reference layer DRAWS the
    // plan in (MeritPlanFrames.referenceLayerFrame): uniform, so every object
    // lands on its own drawing at its own shape. Stored at its true size --
    // nothing is grown to a minimum, which moved small objects off their
    // drawing and their chairs with them.
    const FRAMES=globalThis.MeritPlanFrames,src=event.analysis?.frames?.source;
    const natW=src?.width||event.analysis?.originalWidth||event.analysis?.imageWidth||WORLD.width;
    const natH=src?.height||event.analysis?.originalHeight||event.analysis?.imageHeight||WORLD.height;
    const world=FRAMES.worldForPlan(WORLD,natW,natH);
    const layer=FRAMES.referenceLayerFrame(world.width,world.height,event.background?.scale||100,natW,natH);
    const toWorld=(box,convention)=>{
      const[cx,cy]=layer.percentToWorld.apply(...(convention===FRAMES.CENTRE?[box.x,box.y]:[box.x+box.w/2,box.y+box.h/2]));
      return{cx,cy,w:box.w/100*layer.drawnWidth,h:box.h/100*layer.drawnHeight,rotation:box.rotation||0};
    };
    for(const c of chosen){
      if(c.committedId)continue;
      const body=toWorld(c,FRAMES.CORNER),x=body.cx-body.w/2,y=body.cy-body.h/2,w=body.w,h=body.h;
      if(c.kind==="table"){
        // The footprint holds the drawn surface and the drawn chairs; the
        // surface is kept as its own box inside it, each chair at its
        // detected centre in the table's own frame.
        const fp=FRAMES.footprintFor(body,c.rotation||0,(c.chairDetections||[]).map(ch=>toWorld(ch,FRAMES.CENTRE)));
        const table=RULES().syncTableChairs({id:uid("table"),number:PLANEDIT.uniqueNumber(event,"T",1),type:["round","square","rectangle","bistro"].includes(c.type)?c.type:"rectangle",x:fp.x,y:fp.y,w:fp.w,h:fp.h,surface:fp.surface,capacity:Math.max(1,c.chairDetections?.length||(personSeats(c)??(ruleUse.applies?ruleUse.perUnit:1))),zone:"MAIN FLOOR",rotation:c.rotation||0,locked:false,z:10,hasPhysicalSeats:!!c.chairDetections?.length,capacitySource:c.chairDetections?.length?"DETECTED_PHYSICAL_SEATS":personSeats(c)!=null?"HUMAN_CONFIRMED":ruleUse.applies?"DERIVED_PRINTED_RULE":"UNKNOWN",origin:"DETECTED",printedNumber:printedEvidence(c.printedNumber),...(!c.chairDetections?.length&&personSeats(c)!=null?{capacityEvidence:{via:c.seatsSource||"typed",seats:c.seats,at:nowISO()}}:!c.chairDetections?.length&&ruleUse.applies?{capacityEvidence:{...ruleUse.evidence,at:nowISO()}}:{})});
        if(c.chairDetections?.length){
          // A chair whose facing the drawing showed keeps it. The canvas draws a
          // chair at rotation 0 facing +y of its table (the layout convention of
          // MeritEventRules.chairGeometry), so the stored rotation is that
          // facing turned into the table's frame. A chair the drawing did not
          // show a front for is facing:null — drawn with no front — and keeps
          // its box angle, which is an axis and not a direction.
          table.chairs=fp.chairs.map((ch,index)=>{
            const o=c.chairDetections[index]?.relation?.orientation,known=!!(o&&o.facingKnown&&Number.isFinite(o.facingAngle));
            return{id:uid("chair"),parentTableId:table.id,seatNumber:index+1,x:ch.x,y:ch.y,
              rotation:known?((o.facingAngle-90-(c.rotation||0))%360+360)%360:ch.rotation,
              facing:known?o.facingAngle:null,facingSource:known?String(o.facingEvidence||"stencilBackrest"):"notObserved"};
          });
          table.capacity=table.chairs.length;
        }
        event.tables.push(table);
        c.committedId=table.id;
        tables++;
        chairsKept+=(table.chairs||[]).length;
        if(table.capacitySource==="DERIVED_PRINTED_RULE")derived++;
      }else{
        const object={id:uid("venue"),type:c.type||"text",label:String(c.type||"OBJECT").toUpperCase(),x,y,w,h,rotation:c.rotation||0,locked:false,z:4};
      // Seating furniture keeps its capacity state on the committed object, so
      // "we do not know how many this banquette seats" survives leaving the
      // review screen instead of silently becoming zero on the floor plan.
      if(UNVERIFIED_SEATING.has(object.type)){object.seats=c.seats??null;object.seatsConfidence=c.seats==null?"unverified":"verified";}
      event.venueObjects.push(object);
      c.committedId=object.id;
      venues++;}
      c.status="confirmed";}
      if(event.analysis.timings)event.analysis.timings.confirmedAtMs=Date.now();
      SESSIONS.recordOperatorAction(event,"confirm-plan",chosen.map(c=>c.id));
      touchEvent(event);
      ui.tab="floor";
      ui.planMode="plan";
      render();
      toast(t(chairsKept?"toast.detectionsConfirmed":derived?"toast.detectionsConfirmedRule":"toast.detectionsConfirmedPlain",{tables,venues,perUnit:ruleUse.perUnit,tableWord:t(tables===1?"word.table":"word.tables"),venueWord:t(venues===1?"word.venueObject":"word.venueObjects")}),"success",6000);
  }
  // The long edge the analysis canvas is capped at. 1920 is the product's
  // value; MERIT_ANALYSIS_MAX_SIDE exists only so benchmarks/resolution can
  // measure what the cap costs on small objects (set by an init script, like
  // MERIT_DISABLE_FRAGMENT_FILTER), and is never set by the app.
  const ANALYSIS_MAX_SIDE=()=>{const v=Number(globalThis.MERIT_ANALYSIS_MAX_SIDE);return Number.isFinite(v)&&v>=640&&v<=8192?Math.round(v):1920;};
  function bindReviewDrawing(){
    const scene=document.getElementById("analysisScene");
    if(!scene||!ui.reviewDrawMode)return;
    scene.onpointerdown=e=>{
      if(e.target!==scene&&e.target.tagName!=="IMG")return;
      e.preventDefault();
      const r=scene.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top,box=document.createElement("div");
      box.className="candidate-box selected";
      scene.appendChild(box);
      const move=ev=>{
        const x=ev.clientX-r.left,y=ev.clientY-r.top;
        Object.assign(box.style,{left:Math.min(sx,x)+"px",top:Math.min(sy,y)+"px",width:Math.abs(x-sx)+"px",height:Math.abs(y-sy)+"px"});
      };
      const up=ev=>{
        document.removeEventListener("pointermove",move);
        document.removeEventListener("pointerup",up);
        const x=Math.min(sx,ev.clientX-r.left)/r.width*100,y=Math.min(sy,ev.clientY-r.top)/r.height*100,w=Math.abs(ev.clientX-r.left-sx)/r.width*100,h=Math.abs(ev.clientY-r.top-sy)/r.height*100;
        if(w>1&&h>1){
          const event=activeEvent();
          const c={id:uid("candidate"),kind:"table",type:"rectangle",x,y,w,h,rotation:0,confidence:1,status:"unreviewed",selected:true,missed:true,chairDetections:[],evidence:{geometry:"manual",chairs:0,repetition:0}};
          event.analysis.candidates.push(c);
          event.analysis.missed.push(c.id);
          rememberCorrection(event,c,{manual:true});
          captureTrainingExample(event,c,{decisionType:"missedObject",note:"drawn by the operator on a region the detector never proposed"});
          ui.selectedCandidateId=c.id;
          ui.reviewDrawMode=false;
          touchEvent(event);
        }
        render();
      };
      document.addEventListener("pointermove",move);
      document.addEventListener("pointerup",up);
    };
  }
  // ---- dataset export (Gates H-J) ----------------------------------------
  //
  // One portable file containing every captured decision, its image crop, and
  // a leakage-safe train/val/test split computed by plan rather than by
  // example. The split is included so that whoever picks this up cannot
  // accidentally shuffle crops at random: forty chairs from one drawing on
  // both sides of the line produce a model that has memorised a venue and a
  // number that says it generalises.
  //
  // The file states what it is. `trainedModel` is false throughout, the
  // readiness line says plainly whether this is a training set or a capture
  // log, and nothing here trains, evaluates or promotes anything.
  const DATASET_FORMAT = "merit-training-dataset";
  const DATASET_FORMAT_VERSION = 1;
  async function buildTrainingDatasetExport({includeCrops=true}={}){
    const records=state.trainingData||[];
    const split=MeritTrainingData.splitByPlan(records);
    const splitOf=new Map();
    for(const name of ["train","val","test"])for(const r of split[name])splitOf.set(r.id,name);
    const examples=[];
    let cropsMissing=0;
    for(const record of records){
      const entry={...record,split:splitOf.get(record.id)||null};
      if(includeCrops&&record.crop?.blobId){
        // EXPECTED ABSTENTION: a crop that cannot be read is counted below and
        // reported as missing, never swallowed.
        const dataUrl=await storageProvider.getBlob(record.crop.blobId).catch(()=>null);
        // A missing crop is reported, never quietly replaced with a blank one:
        // a dataset that silently substitutes empty images trains on nothing
        // and reports success.
        if(dataUrl)entry.crop={...record.crop,dataUrl};
        else{entry.crop={...record.crop,dataUrl:null,missing:true};cropsMissing++;}
      }
      examples.push(entry);
    }
    return {
      format:DATASET_FORMAT,
      formatVersion:DATASET_FORMAT_VERSION,
      exportedAt:nowISO(),
      schemaVersion:MeritTrainingData.SCHEMA_VERSION,
      crop:{size:MeritTrainingData.CROP_SIZE,padding:MeritTrainingData.CROP_PADDING,encoding:"image/png",
        note:"Square crop centred on the object, padded by a fraction of its own span so context is kept. sourceRect gives the exact source pixels."},
      trainedModel:false,
      producedBy:"MERIT EVENT MAKER Assisted Detection (classical computer vision) plus human decisions. No model was trained to produce this file.",
      summary:MeritTrainingData.summarise(records),
      split:{
        method:"grouped by plan content hash; every crop from one plan lands in one split",
        rationale:"Splitting individual crops at random puts objects from the same drawing on both sides and turns a memorised venue into a high score.",
        counts:{train:split.train.length,val:split.val.length,test:split.test.length},
        plans:split.plansPerSplit,
        warning:split.warning,
      },
      cropsMissing,
      examples,
    };
  }
  async function exportTrainingDataset(){
    const records=state.trainingData||[];
    if(!records.length)return toast(t("teach.exportEmpty"),"error",5200);
    try{
      const payload=await buildTrainingDatasetExport();
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download=`merit-training-dataset-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),2000);
      const s=payload.summary;
      toast(t("teach.exportDone",{n:s.total,plans:s.distinctPlans}),"success",7000);
      if(payload.cropsMissing)toast(t("teach.exportMissingCrops",{n:payload.cropsMissing}),"error",7000);
    }catch(error){
      toast(t("dataset.exportFailed"),"error",7000);
    }
  }
  globalThis.MERIT_TRAINING_EXPORT=buildTrainingDatasetExport;

  function saveVerified(){
    const event=activeEvent();
    if(!ui.teachAI)return toast(t("toast.enableTeachFirst"),"error");
    const a=event.analysis;
    if(!a)return;
    state.verifiedExamples.push({id:uid("verified"),eventId:event.id,savedAt:nowISO(),engine:a.engine,trainedModel:false,threshold:a.threshold,imageSize:[a.imageWidth,a.imageHeight],predictions:a.candidates.map(clone),groundTruth:a.candidates.filter(c=>c.status!=="rejected").map(clone),rejected:a.candidates.filter(c=>c.status==="rejected").map(c=>c.id),missed:[...a.missed],hardExample:a.missed.length>0||a.candidates.some(c=>c.status==="rejected")});
    saveState();
    toast(t("toast.verifiedPlanSaved"),"success",6000);
  }
  function improveAI(){
    if(!state.verifiedExamples.length)return toast(t("toast.saveVerifiedFirst"),"error");
    const samples=state.verifiedExamples.flatMap(v=>v.groundTruth||[]),avg=samples.length?samples.reduce((n,c)=>n+(c.confidence||0),0)/samples.length:0;
    state.calibration={version:(state.calibration?.version||0)+1,updatedAt:nowISO(),examples:state.verifiedExamples.length,objects:samples.length,recommendedConfidence:Number(Math.max(.35,Math.min(.8,avg*.85)).toFixed(2)),trainedModel:false,label:"Local assisted-detection calibration; not a trained neural model"};
    saveState();
    toast(t("toast.calibrationDone",{v:state.calibration.version,n:state.verifiedExamples.length}),"success",6500);
  }
  function bindReview(){
    const ev=activeEvent();
    document.querySelectorAll("[data-vlm-action]").forEach(b=>b.onclick=()=>VLMSCREEN.onAction(b.dataset.vlmAction,b));
    document.querySelectorAll("[data-read-action]").forEach(b=>b.onclick=()=>READING.onAction(b.dataset.readAction,b));
    document.querySelectorAll("[data-budget-open]").forEach(b=>b.onclick=()=>REVIEW.openReviewQueue(ev,b.dataset.budgetOpen));
    const sceneForm=document.querySelector("[data-scene-form]");
    if(sceneForm)sceneForm.onsubmit=e=>{e.preventDefault();REVIEW.runSceneQuery(ev,String(new FormData(sceneForm).get("q")||""));};
    document.querySelectorAll("[data-queue]").forEach(b=>b.onclick=()=>{
      const a=b.dataset.queue;
      if(a==="prev")REVIEW.queueGo(ev,-1);
      else if(a==="skip"){
        const q=ui.reviewQueue;if(!q)return;
        const id=q.ids[q.index];
        if(id&&!q.skipped.includes(id))q.skipped.push(id);
        REVIEW.queueNextOutstanding(ev);
      }
      else if(a==="next-outstanding")REVIEW.queueNextOutstanding(ev);
      else if(a==="exit")REVIEW.closeReviewQueue();
    });
    document.querySelectorAll("[data-review-action]").forEach(b=>b.onclick=()=>{
      const action=b.dataset.reviewAction,event=activeEvent(),c=event.analysis?.candidates.find(x=>x.id===ui.selectedCandidateId);
      if(action==="back"){
        ui.planMode="plan";
        ui.activeReviewGroupId=null;
        ui.activeQuestionId=null;
        ui.selectedCandidateId=null;
        render();
      }else if(action==="reanalyze")runAssistedDetection();else if(action==="cancel-analysis")stopAnalysis();else if(action==="commit")commitCandidates();else if(action==="confirm"&&c){
        if(decideReview(event,{kind:"confirm",candidateId:c.id}))REVIEW.afterReviewDecision(event);
      }else if(action==="reject"&&c){
        if(decideReview(event,{kind:"reject",candidateId:c.id}))REVIEW.afterReviewDecision(event);
      }else if(action==="dismiss"&&c){
        // "Not important": kept in the analysis, rejected and marked dismissed --
        // never deleted -- so it can be undone and Re-Analyze does not ask again.
        if(decideReview(event,{kind:"notImportant",candidateId:c.id})){ui.selectedCandidateId=null;REVIEW.afterReviewDecision(event);}
      }else if(action==="teach"&&c){
        ui.teachScope=document.querySelector("[data-teach-scope]")?.value||"plan";
        TEACH.teachSelectedObject(event,c,ui.teachScope);
      }else if(action==="confirm-number"&&c){
        const scope=document.querySelector("[data-teach-scope]")?.value||"plan";
        TEACH.teachTableNumber(event,c,document.getElementById("poiNumber")?.value,scope);
      }else if(action==="forget"&&c){TEACH.forgetLesson(event,c);}else if(action==="find-similar"&&c){REFINE.findSimilar(event,c);}else if(action==="draw"){
        if(!ui.reviewDrawMode)SESSIONS.recordOperatorAction(event,"ai-missed-open",[]);
        ui.reviewDrawMode=!ui.reviewDrawMode;
        ui.activeReviewGroupId=null;
        ui.activeQuestionId=null;
        render();
      }else if(action==="save-verified")saveVerified();else if(action==="improve")improveAI();else if(action==="export-dataset")exportTrainingDataset();else if(action==="session-report"){
        ui.operatorReportOpen=true;
        render();
      }else if(action==="close-session-report"){
        ui.operatorReportOpen=false;
        render();
      }else if(action==="open-review-center"){
        ui.reviewCenterOpen=true;
        render();
      }else if(action==="close-review-center"){
        ui.reviewCenterOpen=false;
        render();
      }else if(action==="focus-group"){
        ui.activeReviewGroupId=b.dataset.group;
        ui.selectedCandidateId=null;
        ui.activeQuestionId=null;
        ui.reviewCenterOpen=true;
        render();
      }else if(action==="toggle-lang"){
        ui.lang=ui.lang==="tr"?"en":"tr";
        render();
      }
    });
    document.querySelectorAll("[data-candidate],[data-candidate-box]").forEach(node=>node.onclick=e=>{
      if(e.target.matches("input"))return;
      ui.selectedCandidateId=node.dataset.candidate||node.dataset.candidateBox;
      ui.activeReviewGroupId=null;
      ui.activeQuestionId=null;
      render();
    });
    document.querySelectorAll("[data-candidate-edit]").forEach(input=>input.onchange=()=>{
      const f=input.dataset.candidateEdit,v=input.value;
      requestAnimationFrame(()=>updateCandidateField(f,v));
    });
    document.querySelectorAll("[data-review-filter]").forEach(input=>input.oninput=()=>{
      if(input.dataset.reviewFilter==="status")ui.reviewFilter=input.value;else if(input.dataset.reviewFilter==="class")ui.reviewClass=input.value;else ui.reviewConfidence=Number(input.value);
      render();
    });
    document.querySelector("[data-teach-ai]")?.addEventListener("change",e=>{ui.teachAI=e.target.checked;});
    document.querySelectorAll("[data-reviewgroup-action]").forEach(b=>b.onclick=()=>{
      const event=activeEvent(),pi=event.analysis?.planIntelligence,group=pi?.reviewGroups.find(g=>g.id===b.dataset.group);if(!group)return;
      if(b.dataset.reviewgroupAction==="confirm-family"){
        const strong=group.memberIds.filter(id=>!group.outlierIds.includes(id));
        // Accepted in bulk: each label says it was not individually reviewed.
        if(!decideReview(event,{kind:"confirmFamily",ids:strong}))return;
        // The queue is only worth following if it reflects the answer just
        // given. Confirming a family removes it from review, changes the seat
        // and table counts every fact rests on, and can settle a
        // contradiction outright -- so the next question has to be computed
        // from the plan as it is now, not as it was at import.
        recomputePlanIntelligence(event);
        touchEvent(event);ui.reviewCenterOpen=group.outlierIds.length>0;render();
        toast(t("toast.groupConfirmed",{n:strong.length,objectWord:t(strong.length===1?"word.object":"word.objects"),title:group.title})+(group.outlierIds.length?" "+t("toast.outliersRemain",{n:group.outlierIds.length}):""),"success",5000);
      } else if(b.dataset.reviewgroupAction==="inspect"){
        ui.activeReviewGroupId=group.id;ui.selectedCandidateId=null;ui.activeQuestionId=null;ui.reviewCenterOpen=false;render();
      }
    });
    document.querySelectorAll("[data-question-action]").forEach(b=>b.onclick=()=>{
      const event=activeEvent(),pi=event.analysis?.planIntelligence,q=pi?.uncertainQuestions.find(x=>x.id===b.dataset.question);if(!q)return;
      const action=b.dataset.questionAction;
      if(action==="open"){ui.activeQuestionId=q.id;ui.activeReviewGroupId=null;ui.selectedCandidateId=null;ui.reviewCenterOpen=false;render();return;}
      // One question can stand for several identical arrangements, and each of
      // them gets its OWN decision record: a grouping decision belongs to the
      // tables it is about, and one record shared across arrangements is the
      // data-model bug already fixed once in this repository.
      const groupIds=q.groupIds?.length?q.groupIds:[q.groupId];
      const groups=groupIds.map(id=>pi.furnitureGroups.find(g=>g.id===id)).filter(Boolean);
      const memberIds=groups[0]?.memberIds||[];
      if(!canMutate(event,"answer a plan question"))return;
      const decision=action==="yes"?"merged":"separate";
      SESSIONS.recordOperatorAction(event,`grouping-${decision}`,groups.flatMap(g=>g.memberIds||[]));
      event.analysis.groupingDecisions ||= [];
      for(const group of groups){
        event.analysis.groupingDecisions.push({id:uid("groupdecision"),memberIds:[...group.memberIds],decision,decidedAt:nowISO(),fromQuestionId:q.id});
        state.verifiedExamples.push({id:uid("verified"),eventId:event.id,savedAt:nowISO(),kind:"grouping-question",question:q.question,answer:action==="yes"?"one-group":"separate-tables",memberCandidateIds:group.memberIds});
      }
      recomputePlanIntelligence(event);
      const newPi=event.analysis.planIntelligence;
      touchEvent(event);ui.activeQuestionId=null;render();
      toast(decision==="merged"
        ?t("toast.confirmedOneGroup",{n:newPi.planSummary.diningGroups})
        :t("toast.splitIntoTables",{count:memberIds.length,n:newPi.planSummary.diningGroups}),
        "success",6000);
    });
    document.querySelectorAll("[data-review-decision-action='undo-correction']").forEach(b=>b.onclick=()=>{
      const n=undoReviewDecision(activeEvent());
      render();
      if(n)toast(t("review.undoCorrectionToast",{n}),"success",5000);
    });
    document.querySelectorAll("[data-review-decision-action='undo-last']").forEach(b=>b.onclick=()=>{
      const event=activeEvent();if(!canMutate(event,"undo a plan decision"))return;
      const decisions=event.analysis?.groupingDecisions;if(!decisions?.length)return;
      const undone=decisions.pop();recomputePlanIntelligence(event);touchEvent(event);render();
      toast(t("toast.decisionUndone",{what:t(undone.decision==="merged"?"toast.decisionOneGroup":"toast.decisionSeparate")}),"success",5000);
    });
    bindReviewDrawing();
  }

  // ---- moved to src/data-portability.js — see that file's header: the backup
  // file, the portable event package and the recovery points. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. RECOVERY stays here because
  // the boot loader reads it as well. ------------------------------------------
  const RECOVERY=()=>globalThis.MeritOfflineRecovery||null;
  const PORTABILITY=globalThis.MeritDataPortability.create({
    ask:(...a)=>ask(...a),getState:()=>state,loggableError:(...a)=>loggableError(...a),migrateEvent:(...a)=>migrateEvent(...a),nowISO:(...a)=>nowISO(...a),parseRecordText:(...a)=>parseRecordText(...a),parseRoot:(...a)=>parseRoot(...a),RECOVERY:(...a)=>RECOVERY(...a),relativeTime:(...a)=>relativeTime(...a),render:(...a)=>render(...a),RULES:(...a)=>RULES(...a),saveState:(...a)=>saveState(...a),setState:next=>{state=next;},storageProvider,t:(...a)=>t(...a),toast:(...a)=>toast(...a),TRAIL:(...a)=>TRAIL(...a),ui,uid:(...a)=>uid(...a),
  });
  function bindV8Common(){
    document.querySelectorAll("[data-action='create-event']").forEach(b=>b.onclick=SETUP.startNewEvent);document.querySelectorAll("[data-action='help']").forEach(b=>b.onclick=openGuide);document.querySelectorAll("[data-open-event]").forEach(b=>b.onclick=()=>openEvent(b.dataset.openEvent));// Row-level open + per-row action buttons now coexist on Home, so the
// buttons must not bubble into the row's open handler.
document.querySelectorAll("[data-duplicate-layout]").forEach(b=>b.onclick=e=>{
  e.stopPropagation();
  SETUP.duplicateLayout(b.dataset.duplicateLayout);
});
document.querySelectorAll("[data-duplicate-event]").forEach(b=>b.onclick=e=>{
  e.stopPropagation();
  duplicateEvent(b.dataset.duplicateEvent);
});
document.querySelectorAll("[data-export-event-package]").forEach(b=>b.onclick=e=>{
  e.stopPropagation();
  PORTABILITY.exportEventPackage(b.dataset.exportEventPackage);
});
document.querySelectorAll("[data-delete-event]").forEach(b=>b.onclick=e=>{
  e.stopPropagation();
  deleteEvent(b.dataset.deleteEvent);
});
document.querySelectorAll("[data-history-event]").forEach(row=>row.ondblclick=()=>openEvent(row.dataset.historyEvent));
document.querySelectorAll("[data-history-event] .row-icons").forEach(el=>el.ondblclick=e=>e.stopPropagation());
    // An unanswered override challenge and a half-written freeze are questions
    // about THIS screen. Carrying them to another tab would put a blocking
    // card over work the operator has moved on to.
    document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{ui.tab=b.dataset.tab;ui.selectedObjectId=null;ui.selectedObjectIds=[];ui.highlightId=null;ui.operationalMode=false;ui.freezeChallenge=null;ui.freezeDraft=null;ui.seatPreview=null;render();});
    // The language toggle is a SHELL control now, so it is bound here rather
    // than in bindCanvas(). It used to be wired only where the canvas was, which
    // was fine while it lived in the plan toolbar and is not now: on the Command
    // Center, on Guests, and in review mode there is no canvas, so the button
    // rendered and did nothing.
    document.querySelectorAll(".workspace-actions [data-v8-action='toggle-lang']")
      .forEach(b=>b.onclick=()=>{ui.lang=ui.lang==="tr"?"en":"tr";render();});
    // The Floor Plan's mode switch, wired next to the tabs because it is the
    // same kind of thing: it changes what you are looking at, not where you are.
    document.querySelectorAll("[data-plan-mode]").forEach(b=>b.onclick=()=>{
      ui.planMode=b.dataset.planMode;ui.tab="floor";
      ui.selectedCandidateId=null;ui.activeReviewGroupId=null;ui.activeQuestionId=null;
      ui.reviewDrawMode=false;ui.selectedChangeId=null;ui.highlightId=null;render();
    });
    // Back to the calendar: the bar's mark and the ⋯ menu both carry it. The
    // calendar comes back on the event you were in.
    document.querySelectorAll("[data-action='back-events'],[data-shell-home]").forEach(b=>b.onclick=()=>{EVENTS.focus(ui.activeEventId);ui.screen="events";ui.focusMode=false;render();});
    const save=document.querySelector("[data-action='save-now']");if(save)save.onclick=()=>saveState(true);
    const search=document.getElementById("globalGuestSearch");
    if(search){
      search.oninput=()=>renderGlobalSearch(search.value);search.onkeydown=FINDER.guestSearchKey;
      // ONE COMMAND LINE: a sentence that names no guest goes to F8. With a
      // guest row on offer, Enter stays the finder's (guestSearchKey).
      search.addEventListener("keydown",e=>{
        if(e.key!=="Enter")return;
        const box=document.getElementById("globalSearchResults"),v=search.value.trim();
        if(!v||(box&&!box.classList.contains("hidden")&&box.querySelector("[data-search-guest]")))return;
        e.preventDefault();search.value="";FINDER.closeGuestSearch();ASSIST.toggle(true);ASSIST.ask(v);
      });
    }
    bindShellBar();
    const backupExport=document.querySelector("[data-action='backup-export']");if(backupExport)backupExport.onclick=()=>PORTABILITY.exportBackup();
    const backupImport=document.querySelector("[data-action='backup-import']");if(backupImport)backupImport.onclick=()=>document.getElementById("backupFileInput").click();
    const recoveryBtn=document.querySelector("[data-action='recovery-restore']");if(recoveryBtn)recoveryBtn.onclick=()=>PORTABILITY.restoreLatestSnapshot();
    const backupInput=document.getElementById("backupFileInput");
    if(backupInput){const fresh=backupInput.cloneNode(true);backupInput.replaceWith(fresh);fresh.addEventListener("change",e=>{const file=e.target.files[0];if(file)PORTABILITY.importBackupFile(file);e.target.value="";});}
  }
  // The top bar's own controls and the calendar's view controls. None of them
  // writes to an event: theme, assistant, which screen, which month, which
  // event is shown. The writes on the calendar (open, same layout, duplicate,
  // export, delete) are the data-* controls bound above, as before.
  // A file dropped on the empty room goes through the plan file input's own
  // change handler — one import path, whichever way the file arrived.
  function bindPlanDrop(){
    document.querySelectorAll("[data-plan-drop]").forEach(z=>{
      z.ondragover=e=>{e.preventDefault();z.classList.add("dragging");};
      z.ondragleave=()=>z.classList.remove("dragging");
      z.ondrop=e=>{e.preventDefault();z.classList.remove("dragging");const files=e.dataTransfer&&e.dataTransfer.files,input=document.getElementById("floorPlanFile");if(!files||!files.length||!input)return;input.files=files;input.dispatchEvent(new Event("change"));};
    });
  }
  function bindShellBar(){
    document.querySelectorAll("[data-shell-theme]").forEach(b=>b.onclick=()=>TOPBAR.theme.toggle());
    bindPlanDrop();
    // A theme may change what a screen shows (A: the timeline, B: the calendar).
    document.querySelectorAll("[data-shell-research]").forEach(b=>b.onclick=()=>{TOPBAR.research.set(!TOPBAR.research.enabled());render();});
    document.querySelectorAll("[data-shell-skin]").forEach(b=>b.onclick=()=>{TOPBAR.skin.set(b.dataset.shellSkin);render();});
    // "Sonraki: X →" is the same move as clicking X in the bar.
    document.querySelectorAll("[data-shell-next]").forEach(b=>b.onclick=()=>{const tab=document.querySelector(`header.shell-top [data-tab="${b.dataset.shellNext}"]`);if(tab)tab.click();});
    document.querySelectorAll("[data-shell-assistant]").forEach(b=>b.onclick=()=>ASSIST.toggle(true));
    document.querySelectorAll("[data-shell-open][data-shell-event]").forEach(b=>b.onclick=()=>{
      const id=b.dataset.shellEvent,tab=b.dataset.shellOpen;
      openEvent(id);
      if(ui.screen==="workspace"&&ui.activeEventId===id&&ui.tab!==tab){ui.tab=tab;render();}
    });
    document.querySelectorAll("[data-cal-month]").forEach(b=>b.onclick=()=>{EVENTS.shift(Number(b.dataset.calMonth));render();});
    document.querySelectorAll("[data-cal-event]").forEach(b=>{
      b.onclick=()=>{EVENTS.select(b.dataset.calEvent);render();document.querySelector(`[data-cal-event="${CSS.escape(b.dataset.calEvent)}"]`)?.focus();};
      // A past entry already opens on double-click through [data-history-event].
      if(!b.hasAttribute("data-history-event"))b.ondblclick=()=>openEvent(b.dataset.calEvent);
    });
    document.querySelectorAll("[data-cal-new]").forEach(b=>b.onclick=()=>{SETUP.startNewEvent();SETUP.currentDraft().date=b.dataset.calNew;render();});
    // A ⋯ menu closes when you pick from it.
    document.querySelectorAll("details.shell-more .shell-menu-item,details.cal-more .shell-menu-item").forEach(b=>b.addEventListener("click",()=>{const d=b.closest("details");if(d)d.open=false;}));
  }
  // An open ⋯ menu closes on a click anywhere else, and on Escape.
  document.addEventListener("pointerdown",e=>{document.querySelectorAll("details.shell-more[open],details.cal-more[open]").forEach(d=>{if(!d.contains(e.target))d.open=false;});});
  bindCommon = bindV8Common;
  // F8 "ne değişti": the day's first picture of an event, kept per event on this machine
  // (src/change-digest.js; owner 2026-11-02). Never fails the open.
  const DIGEST_KEY="merit.dayDigest.v1";
  function digestRoll(event){
    const D=globalThis.MeritChangeDigest;if(!D||!event)return null;
    let all={};try{all=JSON.parse(localStorage.getItem(DIGEST_KEY)||"{}")||{};}catch{all={};}
    const today=new Date().toLocaleDateString("en-CA"),rec=D.roll(all[event.id],event,today);
    if(rec!==all[event.id]){all[event.id]=rec;try{localStorage.setItem(DIGEST_KEY,JSON.stringify(all));}catch{rec.unsaved=true;}}
    return rec;
  }
  openEvent = function(id){const event=state.events.find(e=>e.id===id);if(!event)return;digestRoll(event);ui.activeEventId=id;ui.screen="workspace";ui.tab=RULES().isHistorical(event)?"guests":"command";ui.selectedObjectId=null;ui.selectedObjectIds=[];ui.selectedGuestIds=[];ui.operationalMode=false;ui.undo=[];ui.redo=[];render();};
  duplicateEvent = function(id,open=false){const source=state.events.find(e=>e.id===id);if(!source)return;original.duplicateEvent(id,open);const copy=state.events[0];copy.hotel=copy.hotel||copy.venue||"";copy.salon=copy.salon||"";copy.tables.forEach(t=>{t.chairs=(t.chairs||[]).map((c,i)=>({...c,id:uid("chair"),parentTableId:t.id,seatNumber:i+1}));});saveState();};

  // What the operator sees when the stored record was written by a newer
  // build: the reason, both version numbers, and what to do -- not an empty
  // app with no explanation. Rendered ABOVE everything else and never
  // dismissed, because every control below it is operating on a blank slate
  // that will not be saved.
  // The storage notices, persistent until true no longer. Each names what
  // happened, what was NOT lost, and the next step -- with the control for it.
  function storageNoticeHTML(){
    const n=MERIT_STORAGE_NOTICE;
    const parts=[];
    if(n.unreadable&&!n.dismissed){
      parts.push(`<div class="schema-future-banner" data-storage-notice="unreadable" role="alert">${icon("alert")}<div>
        <b>${esc(t("storage.unreadableTitle"))}</b>
        <span>${esc(t(n.unreadable.kept?"storage.unreadableKept":n.unreadable.raw==null?"storage.unavailable":"storage.unreadableNotKept",{when:fmtDate(String(n.unreadable.at).slice(0,10))}))}</span>
        <span class="storage-notice-actions">${n.unreadable.raw!=null?`<button class="btn sm" data-storage-action="download-unreadable">${esc(t("storage.downloadUnreadable"))}</button>`:""}<button class="btn sm" data-storage-action="restore">${esc(t("storage.restoreBackup"))}</button>${n.unreadable.kept?`<button class="btn sm" data-storage-action="dismiss">${esc(t("storage.dismiss"))}</button>`:""}</span>
      </div></div>`);
    }
    if(n.setAside&&!n.setAside.hidden){
      parts.push(`<div class="schema-future-banner" data-storage-notice="set-aside" role="alert">${icon("alert")}<div>
        <b>${esc(t("storage.setAsideTitle",{n:n.setAside.count}))}</b>
        <span>${esc(t("storage.setAsideBody"))}</span>
        <span class="storage-notice-actions"><button class="btn sm" data-storage-action="download-set-aside">${esc(t("storage.downloadSetAside"))}</button><button class="btn sm" data-storage-action="dismiss">${esc(t("storage.dismiss"))}</button></span>
      </div></div>`);
    }
    if(n.saveFailing){
      parts.push(`<div class="schema-future-banner" data-storage-notice="save-failing" role="alert">${icon("alert")}<div>
        <b>${esc(t("storage.saveFailingTitle"))}</b>
        <span>${esc(t(n.saveFailing.reason==="serialize"?"storage.saveFailingSerializeBody":n.saveFailing.reason==="readback"?"storage.saveFailingReadBackBody":"storage.saveFailingBody"))}</span>
        <span class="storage-notice-actions">${n.saveFailing.reason==="serialize"
          // A backup is the same record that could not be made; the workbook
          // is built from the screen, not from it.
          ?`<button class="btn sm" data-storage-action="workbook">${esc(t("storage.exportWorkbook"))}</button>`
          :`<button class="btn sm" data-storage-action="backup">${esc(t("storage.downloadBackup"))}</button>`}</span>
      </div></div>`);
    }
    if(n.imagesDropped&&!n.imagesDropped.hidden){
      parts.push(`<div class="schema-future-banner" data-storage-notice="images-dropped" role="alert">${icon("alert")}<div>
        <b>${esc(t("storage.imagesDroppedTitle"))}</b>
        <span>${esc(t("storage.imagesDroppedBody"))}</span>
        <span class="storage-notice-actions"><button class="btn sm" data-storage-action="backup">${esc(t("storage.downloadBackup"))}</button><button class="btn sm" data-storage-action="dismiss">${esc(t("storage.dismiss"))}</button></span>
      </div></div>`);
    }
    if(n.recovered){
      parts.push(`<div class="schema-future-banner" data-storage-notice="recovered" role="alert">${icon("alert")}<div>
        <b>${esc(t("storage.recoveredTitle"))}</b>
        <span>${esc(t("storage.recoveredBody",{when:relativeTime(n.recovered.at)}))}</span>
        <span class="storage-notice-actions"><button class="btn sm" data-storage-action="dismiss">${esc(t("storage.dismiss"))}</button></span>
      </div></div>`);
    }
    return parts.join("");
  }
  document.addEventListener("click",e=>{
    const b=e.target.closest&&e.target.closest("[data-storage-action]");
    if(!b)return;
    const a=b.dataset.storageAction,n=MERIT_STORAGE_NOTICE;
    if(a==="download-unreadable"&&n.unreadable){
      const url=URL.createObjectURL(new Blob([String(n.unreadable.raw)],{type:"application/json"}));
      const link=document.createElement("a");link.href=url;link.download=`merit-event-maker-unreadable-${RULES().todayKey()}.json`;
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
    }else if(a==="download-set-aside"){
      const url=URL.createObjectURL(new Blob([JSON.stringify(state.setAside||[],null,2)],{type:"application/json"}));
      const link=document.createElement("a");link.href=url;link.download=`merit-event-maker-set-aside-${RULES().todayKey()}.json`;
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
    }else if(a==="restore"){document.getElementById("backupFileInput")?.click();}
    else if(a==="backup"){PORTABILITY.exportBackup();}
    else if(a==="workbook"){whileBusy(b,t("reports.preparingWorkbook"),exportTablePlanXLSX);}
    else if(a==="dismiss"){
      // Hide THIS notice: each one is dismissed on its own, and hiding one
      // never hides another that is still true.
      const kind=b.closest("[data-storage-notice]")?.dataset.storageNotice;
      if(kind==="recovered")n.recovered=null;
      else if(kind==="images-dropped"&&n.imagesDropped)n.imagesDropped.hidden=true;
      else if(kind==="set-aside"&&n.setAside)n.setAside.hidden=true;
      else n.dismissed=true;
      render();
    }
  });
  function futureSchemaBannerHTML(){
    const g=globalThis.MERIT_SCHEMA_GUARD;
    if(!g||!g.readOnly)return"";
    return`<div class="schema-future-banner" data-schema-future role="alert">${icon("alert")}<div>
      <b>${esc(t("schema.futureTitle"))}</b>
      <span>${esc(t("schema.futureBody",{stored:g.storedVersion,build:g.buildVersion}))}</span>
    </div></div>`;
  }
  // A SCREEN THAT THROWS IS CONTAINED. It used to escape render() as an
  // uncaught error, leaving whatever was on screen before -- stale, and bound
  // to state that had moved on -- with no word to the operator. It now shows a
  // recovery screen that names what happened and offers the two ways forward
  // that never need the broken screen: the events list, and a backup of
  // everything in memory. Still logged as an ERROR, on purpose: a render bug
  // must stay loud in every suite that does not set out to cause one.
  render = function(){
    calloutThisRender=null;
    // The page's language is the UI's. It was fixed at "en", so in Turkish
    // every CSS-uppercased label took English capitals -- "MISAFIRLER" for
    // MİSAFİRLER, "KOMUTA MERKEZI" -- and a screen reader read Turkish text
    // with an English voice. Set before the screen, so a render failure's
    // recovery screen is announced in the right language too.
    const lang=ui.lang==="en"?"en":"tr";
    if(document.documentElement.lang!==lang)document.documentElement.lang=lang;
    try{const out=renderScreen();schedulePlanTextPrefetch();return out;}
    catch(error){renderFailure(error);}
  };
  // After the frame that shows the plan, never inside it.
  function schedulePlanTextPrefetch(){
    if(ui.screen!=="workspace"||globalThis.MERIT_PREFETCH==="off")return;
    const event=activeEvent(),src=event?.background?.src;
    if(!src||event.analysis||PLANTEXT.planTextPrefetch.src===src||src===prefetchStoppedSrc||!event.background.importedAtMs)return;
    // Not before the plan is on screen: started at once, the engines' start-up
    // competed with the first view and cost it 0.2-1.4 s (benchmarks/perf/
    // import-usable.mjs, prefetch on vs off, 2026-10-18). The image decoded and
    // two frames drawn, then the reads begin.
    // EXPECTED ABSTENTION: an image that cannot be decoded only loses the wait;
    // the reads still start, and one that fails is read again by the analysis.
    const img=new Image();img.src=src;
    (img.decode?img.decode():Promise.resolve()).catch(()=>{}).then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>PLANTEXT.startPlanTextPrefetch(activeEvent()),0))));
  }
  function renderFailure(error){
    console.error("A screen failed to render; the recovery screen is shown instead.",error);
    app.innerHTML=`<section class="render-failure" data-render-failure role="alert">
      <h2>${esc(t("renderFailed.title"))}</h2>
      <p>${esc(t("renderFailed.body"))}</p>
      <div class="render-failure-actions"><button class="btn primary" data-render-recover="events">${esc(t("renderFailed.toEvents"))}</button><button class="btn" data-render-recover="backup">${esc(t("storage.downloadBackup"))}</button></div>
    </section>`;
    app.querySelector('[data-render-recover="events"]')?.focus();
  }
  document.addEventListener("click",e=>{
    const b=e.target.closest&&e.target.closest("[data-render-recover]");
    if(!b)return;
    if(b.dataset.renderRecover==="backup"){PORTABILITY.exportBackup();return;}
    ui.screen="events";ui.activeEventId=null;ui.selectedObjectId=null;ui.selectedObjectIds=[];render();
  });
  function renderScreen(){
    translateStaticDialogs();
    if(ui.screen==="new-event"){app.innerHTML=SETUP.setupHTML();SETUP.bindSetup();return;}
    // No review branch here any more: review renders inside the workspace's
    // content area like every other mode, so the shell above it never leaves.
    if(!state.events.length&&ui.screen!=="events")ui.screen="events";
    app.innerHTML=futureSchemaBannerHTML()+storageNoticeHTML()+(ui.screen==="events"?eventsHTML():workspaceHTML(activeEvent()));bindV8Common();
    if(ui.screen==="workspace"){
      const event=activeEvent(),historical=RULES().isHistorical(event);
      // Review mode draws no editable canvas, so bindCanvas() must not run for
      // it -- it would query a viewport that is not on the page.
      const reviewing=ui.tab==="floor"&&ui.planMode==="review";
      const changesMode=ui.tab==="floor"&&ui.planMode==="changes";
      // The changes view is the same canvas, so it keeps the same bindings --
      // pan, zoom and selection all still work while reading the diff.
      if(((ui.tab==="floor"&&!reviewing)||ui.tab==="seating")&&!historical)bindCanvas();
      if((ui.tab==="floor"&&!reviewing)||ui.tab==="seating"){const shown=activeEvent();requestAnimationFrame(()=>PLANVIEW.firstViewFit(shown));}
      if(reviewing&&!historical)bindReview();
      if(changesMode)LAYOUTCHG.bindLayoutChanges();
      if(ui.tab==="command"&&!historical)COMMAND.bindCommand();
      // Freeze bindings run on both canvases: the layer toggle lives in the
      // shared toolbar, and the panel and the override challenge in Seating.
      if(((ui.tab==="floor"&&!reviewing)||ui.tab==="seating")&&!historical)SEATING.bindFreezeZones();
      if(ui.tab==="seating"&&!historical){bindSeating();SEATING.bindSmartSeating();}if(ui.tab==="guests"&&!historical)bindGuests();if(ui.tab==="live"&&!historical)bindLive();if(ui.tab==="reports")bindReports();
      if(historical&&ui.tab==="seating")requestAnimationFrame(()=>fitCanvas(false));
    }
  };

  const oldGuideRender=renderGuide;
  renderGuide = function(){
    const root=document.getElementById("guideRoot"),tr=ui.guideLang==="tr",title=tr?"V8 Kullanıcı Kılavuzu":"V8 User Guide",cards=tr?[
      ["Etkinlikler","Yaklaşan etkinlikler kartlarda, geçmiş etkinlikler kilitli tabloda görünür. Geçmiş satırına çift tıklayın."],["Plan ve PDF","PNG/JPG/PDF yerelde açılır. PDF sayfasını küçük önizlemelerden seçin; hiçbir dosya yüklenmez."],["Destekli Tespit","Klasik görüntü işleme adayları üretir. Sonuçlar AI değildir; onaylamadan plana eklenmez."],["Koltuk Yerleşimi","Ctrl/Shift ile çoklu seçim yapın. Grup taşıma tek işlem olarak doğrulanır; kapasite yetmezse hiçbir kayıt değişmez."],["Canlı Operasyon","No Show planlanan yeri korur ancak canlı kapasiteyi serbest bırakır. Empty Chairs kırmızı ışıklı koltuk görünümünü açar."],["Excel ve Kayıt","XLSX tamamen çevrimdışıdır. Table Plan, Guest List ve Unassigned sayfaları korunur; veriler tarayıcıda otomatik kaydedilir."]
    ]:[
      ["Events","Upcoming work appears as cards; past and Completed events are locked in History. Double-click a history row."],["Plans and PDF","PNG/JPG/PDF opens locally. Select PDF pages from thumbnails; no file is uploaded."],["Assisted Detection","Classical computer vision proposes candidates. It is not a trained AI model, and nothing is added until confirmation."],["Seating","Use Ctrl/Shift for multi-selection. Group moves validate as one transaction; insufficient capacity changes nothing."],["Live Operations","No Show preserves the planned assignment but releases live capacity. Empty Chairs opens the red-glow operational view."],["Excel and Storage","XLSX works offline. Table Plan, Guest List and Unassigned sheets remain available; browser autosave is automatic."]
    ];
    root.innerHTML=`<aside class="guide-nav"><div class="guide-brand"><strong>MERIT EVENT MAKER</strong><span>${title}</span></div></aside><section class="guide-main"><header class="guide-top"><h2>${title}</h2><div class="guide-actions"><div class="lang-toggle"><button data-guide-lang="en" class="${!tr?"active":""}">EN</button><button data-guide-lang="tr" class="${tr?"active":""}">TR</button></div><button class="btn quiet" data-guide-reset-onboarding>${tr?"İpuçlarını yeniden göster":"Show tips again"}</button><button class="btn" data-guide-print>${icon("print")}${tr?"Yazdır / PDF":"Print / PDF"}</button><button class="btn icon-only" data-guide-close aria-label="${esc(t("a11y.close"))}" title="${esc(t("a11y.close"))}">${icon("x")}</button></div></header><div class="guide-content"><div class="guide-hero"><div class="kicker">MERIT ENTERTAINMENT · ${tr?"V8 TARAYICI İNCELEMESİ":"V8 BROWSER REVIEW"}</div><h1>${title}</h1><p>${tr?"Masa planı, fiziksel koltuklar, misafirler, canlı operasyon ve doğrulanmış plan düzeltmeleri için çevrimdışı başvuru.":"Offline reference for plan objects, physical chairs, guests, live operations and verified plan corrections."}</p></div><div class="guide-v8-grid">${cards.map(([h,p])=>`<article class="guide-v8-card"><h3>${h}</h3><p>${p}</p></article>`).join("")}</div><div class="guide-tip">${tr?"Bu sürüm tarayıcı incelemesidir; EXE veya masaüstü çalışma zamanı içermez.":"This is a browser review build; it does not include an EXE or desktop runtime."}</div></div></section>`;
    root.querySelectorAll("[data-guide-lang]").forEach(b=>b.onclick=()=>{
      ui.guideLang=b.dataset.guideLang;
      renderGuide();
    });
    root.querySelector("[data-guide-close]").onclick=()=>document.getElementById("guideDialog").close();
    root.querySelector("[data-guide-print]").onclick=()=>window.print();
    root.querySelector("[data-guide-reset-onboarding]").onclick=()=>{resetOnboarding();toast(t("toast.tipsReset"),"success");};
  };
  // The guide opens in the language the app is in: ui.guideLang defaulted to
  // Turkish and nothing ever changed it, so an operator working in English
  // pressed Help and got the Turkish guide (§18). Its own EN/TR switch still
  // flips it while it is open.
  openGuide = function(){ui.guideLang=ui.lang;renderGuide();document.getElementById("guideDialog").showModal();};

  const oldFloorInput=document.getElementById("floorPlanFile"),freshFloorInput=oldFloorInput.cloneNode(true);
  oldFloorInput.replaceWith(freshFloorInput);
  freshFloorInput.addEventListener("change",async e=>{
    const file=e.target.files[0],event=activeEvent();
    if(!file||!event||!canMutate(event,"replace the floor plan"))return;
    try{
      let src,name=file.name,pdfSource=null;
      if(file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")){
        const pdf=await SETUP.waitForPdf(),doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise,pageNumber=doc.numPages>1?await ask({title:t("ask.pdfPageTitle"),body:t("ask.pdfPageBody",{n:doc.numPages}),confirmLabel:t("ask.usePage"),number:{label:t("ask.pdfPageLabel"),min:1,max:doc.numPages,value:1}}):1;
        if(pageNumber===null)return;
        const page=await doc.getPage(pageNumber),v=page.getViewport({scale:2.6}),canvas=document.createElement("canvas");
        canvas.width=Math.ceil(v.width);
        canvas.height=Math.ceil(v.height);
        await page.render({canvasContext:canvas.getContext("2d"),viewport:v}).promise;
        pdfSource=await SETUP.pdfSourceOf(page,v,canvas);
        src=canvas.toDataURL("image/png",.96);
        name=`${file.name} · page ${pageNumber}`;
      }else src=await SETUP.readImageFile(file);
      recordUndo(event);
      event.background={src,name,opacity:.34,visible:true,locked:true,isDefault:false,scale:100,importedAtMs:Date.now(),...(pdfSource?{pdfSource}:{})};
      touchEvent(event);
      render();
      toast(t("toast.planImported"),"success");
    }catch(error){toast(t("plan.replaceFailed",{reason:userMessage(error,"plan.fileUnreadable")}),"error",6500);}finally{e.target.value="";}
  });

  // ---- Focus return after a dialog closes -----------------------------
  // A native <dialog> restores focus to whatever had it when showModal() ran.
  // That does not survive here: every close is followed by render(), which
  // replaces the DOM, so the remembered node is detached and focus falls to
  // <body> -- a keyboard user is dropped at the top of the document and has to
  // tab all the way back. So remember a SELECTOR, not the node, and re-find an
  // equivalent control after the re-render.
  let dialogOpener=null;
  function openerSelector(el){
    if(!el||el===document.body)return null;
    for(const key in el.dataset){
      const attr="data-"+key.replace(/[A-Z]/g,m=>"-"+m.toLowerCase());
      const val=el.dataset[key];
      return val?`[${attr}="${CSS.escape(val)}"]`:`[${attr}]`;
    }
    return el.id?`#${CSS.escape(el.id)}`:null;
  }
  document.addEventListener("pointerdown",e=>{
    const hit=e.target.closest&&e.target.closest("button,[role=button],a[href]");
    if(hit)dialogOpener=openerSelector(hit);
  },true);
  document.addEventListener("focusin",e=>{
    const el=e.target;
    if(el&&el.closest&&!el.closest("dialog")&&/BUTTON|A/.test(el.tagName))dialogOpener=openerSelector(el);
  },true);
  // One delegated listener for the life of the app, not a per-render bind --
  // onboarding callouts appear inside many different screens' own render
  // output (Smart Seating, Freeze Zones, Table Availability, the workspace
  // header, Command Center), and none of those screens' own bind*()
  // functions should need to know this feature exists.
  document.addEventListener("click",e=>{
    const btn=e.target.closest&&e.target.closest("[data-onboarding-dismiss]");
    if(btn)dismissOnboarding(btn.dataset.onboardingDismiss);
  });
  // KEYBOARD ACTIVATION for the click-only surfaces: the tables and objects
  // on the canvas and the guest cards in Seating are <div>s selected by a
  // pointer, so a keyboard user could reach neither a table nor a guest
  // (tests/suites/a11y-keyboard-workflows.test.mjs). They carry
  // role="button" and a tab stop; Enter or Space does what the pointer does,
  // through the same state -- selection on the Floor Plan (Ctrl/Shift adds to
  // it), the table on Seating, the card's own click handler for a guest --
  // and focus is put back on the same thing after render() replaces it.
  // Nudging, deleting and duplicating a selection by keyboard already existed.
  document.addEventListener("keydown",e=>{
    if(e.key!=="Enter"&&e.key!==" ")return;
    const el=e.target;
    if(!el||el.tagName==="BUTTON"||!el.matches||!el.matches('[role="button"][tabindex="0"]'))return;
    e.preventDefault();
    const sel=openerSelector(el),id=el.dataset.objectId,kind=el.dataset.objectKind;
    if(id){
      if(ui.tab==="seating"){if(kind==="table"){ui.selectedTableId=id;ui.highlightId=null;}}
      else{
        // The pointer's own gate (startObjectDrag): a read-only event or a
        // non-select tool selects nothing, by mouse or by key.
        if(!canMutate(activeEvent(),"move plan objects")||ui.tool!=="select")return;
        if(e.ctrlKey||e.shiftKey){ui.selectedObjectIds=ui.selectedObjectIds.includes(id)?ui.selectedObjectIds.filter(x=>x!==id):[...ui.selectedObjectIds,id];ui.selectedObjectId=ui.selectedObjectIds[0]||null;}
        else{ui.selectedObjectIds=[id];ui.selectedObjectId=id;}
      }
      render();
    }else el.click();
    requestAnimationFrame(()=>{const again=sel&&document.querySelector(sel);if(again)again.focus({preventScroll:true});});
  });
  // Focusing an object the pan has put off-screen would make the browser
  // SCROLL the overflow:hidden viewport to reveal it -- an offset the pan
  // state knows nothing about, so the map would sit shifted from then on.
  // Undo the scroll and move the pan instead, through the same transform
  // the pointer's pan uses.
  document.addEventListener("focusin",e=>{
    const obj=e.target&&e.target.closest&&e.target.closest("[data-object-id]");
    const vp=obj&&document.getElementById("canvasViewport");
    if(!vp||!vp.contains(obj))return;
    vp.scrollLeft=0;vp.scrollTop=0;
    const v=vp.getBoundingClientRect(),o=obj.getBoundingClientRect();
    if(o.left<v.left||o.right>v.right||o.top<v.top||o.bottom>v.bottom){
      ui.pan.x+=(v.left+v.width/2)-(o.left+o.width/2);ui.pan.y+=(v.top+v.height/2)-(o.top+o.height/2);
      if(typeof applyCanvasTransform==="function")applyCanvasTransform();
    }
  });
  // Chromium does not wrap Tab inside a modal <dialog>: from the last control
  // focus leaves the document for the browser's own UI and activeElement
  // becomes <body>, and Shift+Tab from the first does the same
  // (tests/suites/a11y-dialog-focus.test.mjs measured it on all three). In
  // the desktop build there is no browser UI to leave to at all. Wrap it, for
  // whichever native dialog is open.
  const DIALOG_FOCUSABLE='button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
  document.addEventListener("keydown",e=>{
    if(e.key!=="Tab")return;
    const dlg=document.querySelector("dialog[open]");if(!dlg)return;
    const f=[...dlg.querySelectorAll(DIALOG_FOCUSABLE)].filter(el=>!el.disabled&&el.offsetParent!==null&&el.getAttribute("tabindex")!=="-1");
    if(!f.length)return;
    const first=f[0],last=f[f.length-1],a=document.activeElement;
    if(e.shiftKey&&(a===first||!dlg.contains(a))){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&(a===last||!dlg.contains(a))){e.preventDefault();first.focus();}
  },true);
  for(const id of ["guestDialog","excelDialog","guideDialog","meritAskDialog"]){
    const dlg=document.getElementById(id);if(!dlg)continue;
    dlg.addEventListener("close",()=>{
      const sel=dialogOpener;
      // After render(), not before: the node to focus does not exist yet.
      requestAnimationFrame(()=>{
        let target=sel&&document.querySelector(sel);
        // The opener can legitimately be gone -- the guest it belonged to was
        // just deleted. Fall back to the screen's first real control rather
        // than leaving focus on <body>.
        // An opener in a ⋯ menu that closed behind the dialog: focus returns to
        // the menu's own button, the control a person used to get there.
        {const menu=target&&target.closest("details:not([open])");if(menu)target=menu.querySelector("summary");}
        if(!target||target.offsetParent===null)
          target=document.querySelector(".mx-head button, .appbar button, .tab.active");
        if(target)target.focus();
      });
    });
  }

  window.addEventListener("keydown",e=>{
    // AN OPEN DIALOG OWNS THE KEYBOARD. Escape inside one used to reach this
    // handler as well and clear the canvas selection behind it -- "Escape
    // closes the topmost layer and nothing else" -- and Delete or an arrow
    // pressed on a dialog's button deleted or nudged the selected table under
    // it. The dialog handles its own keys; nothing behind it does.
    if(document.querySelector("dialog[open]"))return;
    // F8 opens and closes the assistant from anywhere (it closes itself on Escape).
    if(e.key==="F8"){e.preventDefault();ASSIST.toggle();return;}
    // F9: light / dark, from anywhere (owner-approved redesign: day planning
    // light, night door dark).
    if(e.key==="F9"){e.preventDefault();TOPBAR.theme.toggle();return;}
    // F10: the help topics in the assistant panel (owner 2026-11-02)
    if(e.key==="F10"){e.preventDefault();ASSIST.help();return;}
    // "?": the keys and the sentences F8 understands — never while typing in a field
    if(e.key==="?"&&!(e.target&&(e.target.closest&&e.target.closest("input,textarea,select,[contenteditable]")))){e.preventDefault();ASSIST.shortcuts();return;}
    // The override challenge is a blocking decision, so Escape means "no" and
    // nothing else on the screen closes with it. Cancelling authorises
    // nothing and leaves the room exactly as it was.
    if(e.key==="Escape"&&ui.freezeChallenge){e.preventDefault();ui.freezeChallenge=null;render();return;}
    // Section 24: the challenge is the one modal-like surface in this app
    // that is NOT a native <dialog> (which traps Tab and closes on Escape
    // for free) -- it's a plain <aside role="alertdialog"> over a scrim.
    // Its scrim already blocks pointer clicks from reaching the room
    // behind it, and Escape already refuses the override above, but
    // without this, Tab could still walk keyboard focus straight past the
    // challenge's own buttons onto the floor plan behind it while the
    // room stays blocked to a mouse -- a real, keyboard-only escape from
    // a decision this session's own rules require to be forced.
    if(e.key==="Tab"&&ui.freezeChallenge){
      const scrim=document.querySelector("[data-freeze-scrim]");
      const focusables=scrim?[...scrim.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled&&el.offsetParent!==null):[];
      if(focusables.length){
        const first=focusables[0],last=focusables[focusables.length-1],active=document.activeElement;
        if(e.shiftKey&&active===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&active===last){e.preventDefault();first.focus();}
        else if(!scrim.contains(active)){e.preventDefault();first.focus();}
      }
      return;
    }
    if(e.key==="Escape"){if(ui.freezeDraft)ui.freezeDraft=null;if(ui.reviewQueue){ui.reviewQueue=null;ui.selectedCandidateId=null;}if(ui.repeatPlacement){ui.repeatPlacement=null;toast(t("toast.repeatedPlacementCancelled"));}if(ui.focusMode)ui.focusMode=false;if(ui.reviewDrawMode)ui.reviewDrawMode=false;if(ui.activeQuestionId)ui.activeQuestionId=null;if(ui.reviewCenterOpen)ui.reviewCenterOpen=false;render();return;}
    if(ui.screen!=="workspace"||ui.tab!=="floor"||RULES().isHistorical(activeEvent()))return;
    if((e.key==="Delete"||e.key==="Backspace")&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){e.preventDefault();PLANEDIT.deleteSelection();return;}
    if(e.ctrlKey&&e.key.toLowerCase()==="d"){e.preventDefault();PLANEDIT.duplicateSelection();return;}
    if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){
      const event=activeEvent(),ids=ui.selectedObjectIds.length?ui.selectedObjectIds:[ui.selectedObjectId].filter(Boolean);if(!ids.length)return;e.preventDefault();const amount=e.shiftKey?10:1,dx=e.key==="ArrowLeft"?-amount:e.key==="ArrowRight"?amount:0,dy=e.key==="ArrowUp"?-amount:e.key==="ArrowDown"?amount:0;recordUndo(event);ids.forEach(id=>{const o=event.tables.find(x=>x.id===id)||event.venueObjects.find(x=>x.id===id);if(o&&!o.locked){o.x+=dx;o.y+=dy;}});touchEvent(event);render();
    }
  });

  // The very first render must wait on the async StorageProvider load --
  // every render() after this one is driven by user interaction and needs
  // nothing more than the in-memory `state` object already being current.
  loadV8Async().then(({data,recoveredAt,fromJournal})=>{
    // Never a silent swap: if the primary record could not be read at all
    // and an automatic snapshot stood in for it, the operator is told
    // plainly, including that it may not hold the most recent changes --
    // in a notice that stays until they put it away, not only a toast.
    if(recoveredAt)MERIT_STORAGE_NOTICE.recovered={at:recoveredAt};
    state=data;bootReady=true;render();
    // the store catches up with what was kept when the tab closed
    if(fromJournal)saveState();
    if(recoveredAt)toast(t("recovery.bootRecoveredToast",{when:relativeTime(recoveredAt)}),"error",9000);
  }).catch(error=>{
    console.error("Storage load failed entirely; starting from a blank state.",loggableError(error));
    state=blankRoot();bootReady=true;render();
  });
})();