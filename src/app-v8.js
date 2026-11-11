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
  const ONBOARDING=globalThis.MeritOnboardingPanel.create({
    getState:()=>state,render:(...a)=>render(...a),saveState:(...a)=>saveState(...a),t:(...a)=>t(...a),
  });

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
  // The handover module accessor, read by the event log and the Command Center.
  const HANDOVER=()=>globalThis.MeritEventHandover||null;
  const EVENTLOG=globalThis.MeritEventLogPanel.create({
    HANDOVER:(...a)=>HANDOVER(...a),RULES:(...a)=>RULES(...a),TRAIL:(...a)=>TRAIL(...a),audit:(...a)=>audit(...a),
    formatTableNumber:(...a)=>formatTableNumber(...a),getSEATCMD:()=>SEATCMD,getState:()=>state,nowISO:(...a)=>nowISO(...a),t:(...a)=>t(...a),
    uid:(...a)=>uid(...a),
  });

  const HEALTH=globalThis.MeritEventHealth.create({
    RULES:(...a)=>RULES(...a),canMutate:(...a)=>canMutate(...a),esc:(...a)=>esc(...a),eventMetrics:(...a)=>eventMetrics(...a),getState:()=>state,
    nowISO:(...a)=>nowISO(...a),paxOf:(...a)=>paxOf(...a),resolvedFreezes:(...a)=>resolvedFreezes(...a),
    resolvedUnavailable:(...a)=>resolvedUnavailable(...a),seatingCapacity:(...a)=>seatingCapacity(...a),t:(...a)=>t(...a),
    touchEvent:(...a)=>touchEvent(...a),
  });

  // ---- moved to src/screen-command.js — see that file's header. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. ----------------------------
  const COMMAND=globalThis.MeritScreenCommand.create({
    activeEvent:(...a)=>activeEvent(...a),addHandoverNote:(...a)=>EVENTLOG.addHandoverNote(...a),AVAIL:(...a)=>AVAIL(...a),canMutate:(...a)=>canMutate(...a),doctorSignature:(...a)=>HEALTH.doctorSignature(...a),esc:(...a)=>esc(...a),eventMetrics:(...a)=>eventMetrics(...a),eventReadiness:(...a)=>HEALTH.eventReadiness(...a),exportBackup:(...a)=>PORTABILITY.exportBackup(...a),fmtDate:(...a)=>fmtDate(...a),getLive:()=>LIVE,HANDOVER:(...a)=>HANDOVER(...a),OCC:(...a)=>OCC(...a),onboardingCalloutHTML:(...a)=>ONBOARDING.onboardingCalloutHTML(...a),paxOf:(...a)=>paxOf(...a),planDoctorReport:(...a)=>HEALTH.planDoctorReport(...a),recordFinalCheck:(...a)=>HEALTH.recordFinalCheck(...a),relativeTime:(...a)=>relativeTime(...a),render:(...a)=>render(...a),resolvedFreezes:(...a)=>resolvedFreezes(...a),resolvedHandoverNotes:(...a)=>EVENTLOG.resolvedHandoverNotes(...a),resolvedUnavailable:(...a)=>resolvedUnavailable(...a),RULES:(...a)=>RULES(...a),seatingCapacity:(...a)=>seatingCapacity(...a),serviceLoadHTML:(...a)=>LOADPANEL.serviceLoadHTML(...a),t:(...a)=>t(...a),toast:(...a)=>toast(...a),touchEvent:(...a)=>touchEvent(...a),ui,
  });
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
    return HEALTH.eventReadiness(event).reasons.map(r=>({level:r.level==="blocker"?"blocker":"warn",text:COMMAND.doctorText(r.finding).what}));
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
    const bar=shellBarHTML({screen:"workspace",current:ui.tab,historical,event:{name:event.name,sub},planHealth:HEALTH.planHealthHTML(event),progress:historical?null:TOPBAR.stepProgress(event)});
    return`<section class="workspace ${ui.focusMode?"v8-focus":""}">${bar}${historical?`<div class="workspace-readonly-banner">${icon("lock")}${t("nav.historicalBanner")}</div>`:ui.focusMode?"":ONBOARDING.onboardingCalloutHTML("globalFinder")}<div class="content">${tabContent(event)}</div>${ui.focusMode?`<button class="focus-exit" data-v8-action="focus">${t("nav.exitFocus")}</button>`:""}</section>`;
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
    render:(...a)=>render(...a),repackTableAssignments:(...a)=>repackTableAssignments(...a),runAssistedDetection:(...a)=>ANALYSISRUN.runAssistedDetection(...a),
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
    activeEvent:(...a)=>activeEvent(...a),assignGuestGroup:(...a)=>SEATCMD.assignGuestGroup(...a),assignGuestToTable:(...a)=>assignGuestToTable(...a),authoriseFreezeOverride:(...a)=>SEATCMD.authoriseFreezeOverride(...a),AVAIL:(...a)=>AVAIL(...a),availReasonText:(...a)=>SEATCMD.availReasonText(...a),bindPanelToggles:(...a)=>bindPanelToggles(...a),canMutate:(...a)=>canMutate(...a),canSeat,canvasEmptyHTML:(...a)=>EMPTY.canvasEmptyHTML(...a),canvasViewportHTML:(...a)=>canvasViewportHTML(...a),createFreezeFromDraft:(...a)=>SEATCMD.createFreezeFromDraft(...a),esc:(...a)=>esc(...a),eventFreezes:(...a)=>eventFreezes(...a),formatTableNumber:(...a)=>formatTableNumber(...a),FREEZE:(...a)=>FREEZE(...a),freezeReasonText:(...a)=>SEATCMD.freezeReasonText(...a),icon:(...a)=>icon(...a),liftFreeze:(...a)=>SEATCMD.liftFreeze(...a),logicalSeatCount:(...a)=>logicalSeatCount(...a),naturalSort:(...a)=>naturalSort(...a),onboardingCalloutHTML:(...a)=>ONBOARDING.onboardingCalloutHTML(...a),paxDotsHTML:(...a)=>paxDotsHTML(...a),paxOf:(...a)=>paxOf(...a),recordUndo:(...a)=>recordUndo(...a),render:(...a)=>render(...a),resolvedFreezes:(...a)=>resolvedFreezes(...a),resolvedUnavailable:(...a)=>resolvedUnavailable(...a),RULES:(...a)=>RULES(...a),seatingCapacity:(...a)=>seatingCapacity(...a),seatingQueueEmptyHTML:(...a)=>EMPTY.seatingQueueEmptyHTML(...a),setTableAvailability:(...a)=>ARRIVAL.setTableAvailability(...a),t:(...a)=>t(...a),tableAssignedPax:(...a)=>tableAssignedPax(...a),tableIndex:(...a)=>tableIndex(...a),tableSeatMap:(...a)=>tableSeatMap(...a),toast:(...a)=>toast(...a),toggleAssignmentLock:(...a)=>toggleAssignmentLock(...a),touchEvent:(...a)=>touchEvent(...a),ui,unassignGuest:(...a)=>unassignGuest(...a),v8Toolbar:(...a)=>FLOORPLAN.v8Toolbar(...a),
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
    const reasons=HEALTH.eventReadiness(event).reasons||[];
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
    activeEvent:(...a)=>activeEvent(...a),app,auditTrailText:(...a)=>EVENTLOG.auditTrailText(...a),bindDoctorGo:(...a)=>COMMAND.bindDoctorGo(...a),buildTablePlanModel:(...a)=>buildTablePlanModel(...a),doctorGoHTML:(...a)=>COMMAND.doctorGoHTML(...a),doctorText:(...a)=>COMMAND.doctorText(...a),esc:(...a)=>esc(...a),eventMetrics:(...a)=>eventMetrics(...a),eventReadiness:(...a)=>HEALTH.eventReadiness(...a),exportGuestCSV,exportTablePlanXLSX,fmtDate:(...a)=>fmtDate(...a),formatTableNumber:(...a)=>formatTableNumber(...a),getState:()=>state,icon:(...a)=>icon(...a),LIVE,naturalSort:(...a)=>naturalSort(...a),paxOf:(...a)=>paxOf(...a),planIssues:(...a)=>HEALTH.planIssues(...a),relativeTime:(...a)=>relativeTime(...a),render:(...a)=>render(...a),resolvedAuditTrail:(...a)=>EVENTLOG.resolvedAuditTrail(...a),RULES:(...a)=>RULES(...a),seatExportName:(...a)=>seatExportName(...a),seatingStats:(...a)=>seatingStats(...a),t:(...a)=>t(...a),tableAssignedPax:(...a)=>tableAssignedPax(...a),toast:(...a)=>toast(...a),TRAIL:(...a)=>TRAIL(...a),ui,whileBusy:(...a)=>whileBusy(...a),
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
  const LEARNING=globalThis.MeritPlanLearning.create({
    getRetractedDecisions:()=>REVIEWCMD.retractedDecisions,getState:()=>state,nowISO:(...a)=>nowISO(...a),saveState:(...a)=>saveState(...a),storageProvider,
    t:(...a)=>t(...a),toast:(...a)=>toast(...a),uid:(...a)=>uid(...a),
  });

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
    analysisCanvasOf:(...a)=>PLANTEXT.analysisCanvasOf(...a),applyPlanMemory:(...a)=>LEARNING.applyPlanMemory(...a),audit:(...a)=>audit(...a),
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
    applyReviewWrites:(...a)=>REVIEWCMD.applyReviewWrites(...a),audit:(...a)=>audit(...a),canMutate:(...a)=>canMutate(...a),getState:()=>state,
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

  const ANALYSISRUN=globalThis.MeritAnalysisRun.create({
    PLANTEXT,REFINE,TEACH,activeEvent:(...a)=>activeEvent(...a),applyPlanMemory:(...a)=>LEARNING.applyPlanMemory(...a),audit:(...a)=>audit(...a),
    buildPlanIntelligence:(...a)=>buildPlanIntelligence(...a),calibratedThreshold:(...a)=>calibratedThreshold(...a),canMutate:(...a)=>canMutate(...a),
    getKeptPlanText:()=>keptPlanText,getPrefetchStoppedSrc:()=>prefetchStoppedSrc,getVLMSCREEN:()=>VLMSCREEN,
    matchCandidatesByGeometry:(...a)=>LEARNING.matchCandidatesByGeometry(...a),nowISO:(...a)=>nowISO(...a),planHashFor:(...a)=>LEARNING.planHashFor(...a),
    render:(...a)=>render(...a),resolveVisualEmbeddingProvider:(...a)=>LEARNING.resolveVisualEmbeddingProvider(...a),runPlanOCR:(...a)=>runPlanOCR(...a),
    setKeptPlanText:v=>{keptPlanText=v;},setPrefetchStoppedSrc:v=>{prefetchStoppedSrc=v;},t:(...a)=>t(...a),toast:(...a)=>toast(...a),
    touchEvent:(...a)=>touchEvent(...a),ui,uid:(...a)=>uid(...a),yieldFrame:(...a)=>yieldFrame(...a),
  });

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
        const r=HEALTH.eventReadiness(e);
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
    canMutate:(...a)=>canMutate(...a),decideReview:(...a)=>REVIEWCMD.decideReview(...a),esc:(...a)=>esc(...a),icon:(...a)=>icon(...a),render:(...a)=>render(...a),
    t:(...a)=>t(...a),toast:(...a)=>toast(...a),touchEvent:(...a)=>touchEvent(...a),ui,undoModelGrouping:(...a)=>undoModelGrouping(...a),undoReviewDecision:(...a)=>REVIEWCMD.undoReviewDecision(...a),
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

  // The long edge the analysis canvas is capped at. 1920 is the product's
  // value; MERIT_ANALYSIS_MAX_SIDE exists only so benchmarks/resolution can
  // measure what the cap costs on small objects (set by an init script, like
  // MERIT_DISABLE_FRAGMENT_FILTER), and is never set by the app.
  const ANALYSIS_MAX_SIDE=()=>{const v=Number(globalThis.MERIT_ANALYSIS_MAX_SIDE);return Number.isFinite(v)&&v>=640&&v<=8192?Math.round(v):1920;};
  const REVIEWCMD=globalThis.MeritReviewCommands.create({
    ANALYSISRUN,LEARNING,PLANEDIT,READING,REFINE,REVIEW,RULES:(...a)=>RULES(...a),SESSIONS,TEACH,UNVERIFIED_SEATING,VLMSCREEN,WORLD,
    activeEvent:(...a)=>activeEvent(...a),audit:(...a)=>audit(...a),canMutate:(...a)=>canMutate(...a),clone:(...a)=>clone(...a),getState:()=>state,
    nowISO:(...a)=>nowISO(...a),printedEvidence:(...a)=>printedEvidence(...a),recomputePlanIntelligence:(...a)=>recomputePlanIntelligence(...a),
    recordUndo:(...a)=>recordUndo(...a),render:(...a)=>render(...a),saveState:(...a)=>saveState(...a),storageProvider,t:(...a)=>t(...a),
    toast:(...a)=>toast(...a),touchEvent:(...a)=>touchEvent(...a),ui,uid:(...a)=>uid(...a),
  });

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
    ONBOARDING.beginRender();
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
      if(reviewing&&!historical)REVIEWCMD.bindReview();
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
    root.querySelector("[data-guide-reset-onboarding]").onclick=()=>{ONBOARDING.resetOnboarding();toast(t("toast.tipsReset"),"success");};
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
    if(btn)ONBOARDING.dismissOnboarding(btn.dataset.onboardingDismiss);
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