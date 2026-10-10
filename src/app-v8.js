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
    analysisBusy:false, analysisProgress:0, analysisStage:"Ready", selectedCandidateId:null,
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
  async function loadV8Async(){
    let raw=null;
    try{
      raw=await storageProvider.load();
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
      .then(()=>{if(show)toast(t("toast.savedLocally"),"success");autoSnapshot(payload);storageRecovered();imagesStored();})
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
    const loadRow=ui.loadLayer?loadBandMap(event)?.get(table.id):null;
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
          ?t("audit.tableMarkedUnavailable",{number:tableNumber(d.tableId),reason:availReasonText(d.reason)})
          :t("audit.tableMarkedAvailable",{number:tableNumber(d.tableId)});
      case"FREEZE_CREATED":
        return t("audit.freezeCreated",{reason:freezeReasonText(d.reason)});
      case"FREEZE_LIFTED":
        return t("audit.freezeLifted",{reason:freezeReasonText(d.reason)});
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
    activeEvent:(...a)=>activeEvent(...a),addHandoverNote:(...a)=>addHandoverNote(...a),AVAIL:(...a)=>AVAIL(...a),canMutate:(...a)=>canMutate(...a),doctorSignature:(...a)=>doctorSignature(...a),esc:(...a)=>esc(...a),eventMetrics:(...a)=>eventMetrics(...a),eventReadiness:(...a)=>eventReadiness(...a),exportBackup:(...a)=>exportBackup(...a),fmtDate:(...a)=>fmtDate(...a),getLive:()=>LIVE,HANDOVER:(...a)=>HANDOVER(...a),OCC:(...a)=>OCC(...a),onboardingCalloutHTML:(...a)=>onboardingCalloutHTML(...a),paxOf:(...a)=>paxOf(...a),planDoctorReport:(...a)=>planDoctorReport(...a),recordFinalCheck:(...a)=>recordFinalCheck(...a),relativeTime:(...a)=>relativeTime(...a),render:(...a)=>render(...a),resolvedFreezes:(...a)=>resolvedFreezes(...a),resolvedHandoverNotes:(...a)=>resolvedHandoverNotes(...a),resolvedUnavailable:(...a)=>resolvedUnavailable(...a),RULES:(...a)=>RULES(...a),seatingCapacity:(...a)=>seatingCapacity(...a),serviceLoadHTML:(...a)=>serviceLoadHTML(...a),t:(...a)=>t(...a),toast:(...a)=>toast(...a),touchEvent:(...a)=>touchEvent(...a),ui,
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
  const EVENTS=globalThis.MeritScreenEvents.create({
    esc:(...a)=>esc(...a),eventMetrics:(...a)=>eventMetrics(...a),fmtDate:(...a)=>fmtDate(...a),getState:()=>state,helpButton:(...a)=>helpButton(...a),icon:(...a)=>icon(...a),paxOf:(...a)=>paxOf(...a),physicalCapacity:(...a)=>physicalCapacity(...a),RULES:(...a)=>RULES(...a),seatingCapacity:(...a)=>seatingCapacity(...a),t:(...a)=>t(...a),topBrand:(...a)=>topBrand(...a),
  });
  eventsHTML = function(...a){return EVENTS.eventsHTML(...a);};

  // The Command Center leads because it is the only screen that answers a
  // question about the WHOLE event; every tab after it owns one part of the
  // work. Historical events do not get one -- a finished event has no
  // readiness to assess, and "12 guests unassigned" on a closed night is
  // noise, not a finding.
  const normalTabs=[["command",()=>t("nav.commandTab")],["floor",()=>t("nav.floorPlanTab")],["guests",()=>t("nav.guestsTab")],["seating",()=>t("nav.seatingTab")],["live",()=>t("nav.liveTab")],["reports",()=>t("nav.reportsTab")]];
  const historyTabs=[["guests",()=>t("nav.guestsTab")],["seating",()=>t("nav.seatingTab")],["reports",()=>t("nav.reportsTab")]];
  workspaceHTML = function(event){
    const historical=RULES().isHistorical(event),tabs=historical?historyTabs:normalTabs;
    if(!tabs.some(([id])=>id===ui.tab))ui.tab=tabs[0][0];
    return`<section class="workspace ${ui.focusMode?"v8-focus":""}"><header class="workspace-head">${topBrand()}<div class="event-id"><strong>${esc(event.name)}</strong><span>${esc(fmtDate(event.date))} · ${esc([event.hotel,event.salon].filter(Boolean).join(" · ")||t("appbar.venueNotSet"))}</span></div><div class="workspace-actions"><div class="global-search">${icon("search")}<input id="globalGuestSearch" placeholder="${t("appbar.search")}" autocomplete="off"><div id="globalSearchResults" class="search-results hidden"></div></div>${planHealthHTML(event)}<button class="btn quiet sm lang-btn" data-v8-action="toggle-lang" title="Language / Dil">${ui.lang==="tr"?"TR":"EN"}</button><button class="btn quiet icon-only" data-action="save-now" title="${t("appbar.saveNow")}">${icon("save")}</button>${helpButton()}<button class="btn sm" data-action="back-events">${t("appbar.allEvents")}</button></div></header><nav class="tabs">${tabs.map(([id,label])=>`<button class="tab ${ui.tab===id?"active":""}" data-tab="${id}">${label()}</button>`).join("")}</nav>${historical?`<div class="workspace-readonly-banner">${icon("lock")}${t("nav.historicalBanner")}</div>`:ui.focusMode?"":onboardingCalloutHTML("globalFinder")}<div class="content">${tabContent(event)}</div>${ui.focusMode?`<button class="focus-exit" data-v8-action="focus">${t("nav.exitFocus")}</button>`:""}</section>`;
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
      :ui.planMode==="changes"?layoutChangesHTML(event):floorPlanHTML(event);
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

  function setupHTML(){
    const d=newEventDraft;
    const statuses=["Planning","Confirmed","Live"];
    return`<section class="mx-setup">
      <header class="mx-setup-top">${topBrand()}<button class="btn" data-setup="cancel">${icon("x")}${t("setup.cancel")}</button></header>
      <div class="mx-setup-body">
        <section class="mx-panel">
          <div class="kicker">${t("setup.eyebrow")}</div>
          <h2>${t("setup.title")}</h2>
          <p>${t("setup.subtitle")}</p>
          <form id="v8EventForm" class="mx-form">
            <div class="field full"><label for="fld-name-name">${t("setup.eventName")}</label><input id="fld-name-name" name="name" required autocomplete="off" value="${esc(d.name)}" placeholder="${t("setup.eventNamePh")}"></div>
            <div class="field"><label for="fld-name-date">${t("setup.date")}</label><input id="fld-name-date" name="date" type="date" required value="${esc(d.date)}"></div>
            <div class="field"><label for="fld-name-status">${t("setup.status")}</label><select id="fld-name-status" name="status">${statuses.map(s=>`<option value="${s}" ${d.status===s?"selected":""}>${t("setup.status."+s)}</option>`).join("")}</select></div>
            <div class="field"><label for="fld-name-hotel">${t("setup.hotel")}</label><input id="fld-name-hotel" name="hotel" required value="${esc(d.hotel)}" placeholder="${t("setup.hotelPh")}"></div>
            <div class="field"><label for="fld-name-salon">${t("setup.salon")}</label><input id="fld-name-salon" name="salon" value="${esc(d.salon)}" placeholder="${t("setup.salonPh")}"></div>
            <div class="field full"><label>${t("setup.cover")} · ${t("setup.coverOptional")}</label>
              <label class="mx-drop cover" data-cover-drop>${d.coverImage?`<img src="${d.coverImage}" alt="">`:`<span>${icon("image")} ${t("setup.chooseCover")}</span>`}<input id="v8CoverFile" type="file" accept="image/png,image/jpeg" hidden></label>
              ${d.coverImage?`<div class="mx-setup-actions" style="margin-top:9px"><button class="btn sm" type="button" data-setup="remove-cover">${t("setup.removeCover")}</button></div>`:""}
            </div>
          </form>
        </section>
        <section class="mx-panel">
          <div class="kicker">${t("setup.planEyebrow")}</div>
          <h2>${t("setup.planTitle")}</h2>
          <p>${t("setup.planSubtitle")}</p>
          <label class="mx-drop" id="v8PlanDrop">${d.planSrc?`<img src="${d.planSrc}" alt=""><strong>${esc(d.planName)}</strong>`:`${icon("image")}<strong>${t("setup.dropPlan")}</strong><span>${t("setup.dropPlanHint")}</span>`}<input id="v8PlanFile" type="file" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" hidden></label>
          ${d.pdfPages?.length?`<div class="pdf-pages">${d.pdfPages.map((p,i)=>`<button class="pdf-page ${d.pdfPage===i?"active":""}" type="button" data-pdf-page="${i}"><canvas data-pdf-thumb="${i}"></canvas><span>${t("setup.page",{n:i+1})}</span></button>`).join("")}</div>`:""}
          ${d.planSrc?`<div class="mx-setup-actions" style="margin-top:11px;justify-content:flex-start"><button class="btn sm" data-setup="replace-plan">${t("setup.replacePlan")}</button><button class="btn sm danger" data-setup="remove-plan">${t("setup.removePlan")}</button></div>`:""}
          <p class="mx-note">${t("setup.privacy")}</p>
          <div class="mx-setup-actions">
            <button class="btn" data-setup="blank" ${ui.setupBusy?"disabled":""}>${t("setup.continueBlank")}</button>
            <button class="btn primary" data-setup="create" ${ui.setupBusy?"disabled":""}>${ui.setupBusy?t("setup.preparing"):t("setup.create")}${icon("arrow")}</button>
          </div>
        </section>
      </div>
    </section>`;
  }
  let newEventDraft={name:"",date:"",hotel:"",salon:"",status:"Planning",coverImage:"",planSrc:"",planName:"",pdfDoc:null,pdfPages:[],pdfPage:0};
  function startNewEvent(){newEventDraft={name:"",date:new Date(Date.now()+7*86400000).toLocaleDateString("en-CA"),hotel:"",salon:"",status:"Planning",coverImage:"",planSrc:"",planName:"",pdfDoc:null,pdfPages:[],pdfPage:0};ui.screen="new-event";render();}
  function syncSetupFields(){const f=document.getElementById("v8EventForm");if(!f)return;const data=new FormData(f);for(const k of ["name","date","hotel","salon","status"])newEventDraft[k]=String(data.get(k)||"");}
  function readDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});}
  // An image is accepted only once the browser has actually DECODED it. The
  // plan, cover and replace paths used to store whatever bytes a .png/.jpg
  // name carried, so a truncated or mislabelled file became the event's floor
  // plan: a broken image under every table, and Assisted Detection run on
  // nothing. Refusing here leaves the current plan exactly as it was.
  function decodableImage(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>img.naturalWidth>0?resolve(src):reject(userError(t("plan.notAnImage")));img.onerror=()=>reject(userError(t("plan.notAnImage")));img.src=src;});}
  async function readImageFile(file){return decodableImage(await readDataURL(file));}
  function waitForPdf(){if(globalThis.MeritPdf)return Promise.resolve(globalThis.MeritPdf);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Offline PDF renderer did not initialize.")),15000);addEventListener("merit-pdf-ready",()=>{clearTimeout(timer);resolve(globalThis.MeritPdf);},{once:true});});}
  async function selectPdfPage(index){
    const doc=newEventDraft.pdfDoc;if(!doc)return;ui.setupBusy=true;render();
    const page=await doc.getPage(index+1),viewport=page.getViewport({scale:2.6}),canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
    newEventDraft.pdfPage=index;newEventDraft.planSrc=canvas.toDataURL("image/png",.96);newEventDraft.planName=`${newEventDraft.pdfName} · page ${index+1}`;ui.setupBusy=false;render();requestAnimationFrame(renderPdfThumbs);
  }
  async function handlePlanFile(file){
    if(!file)return;syncSetupFields();const lower=file.name.toLowerCase();
    if(file.type==="application/pdf"||lower.endsWith(".pdf")){
      try{
        ui.setupBusy=true;
        render();
        const pdf=await waitForPdf(),doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
        newEventDraft.pdfDoc=doc;
        newEventDraft.pdfName=file.name;
        newEventDraft.pdfPages=Array.from({length:doc.numPages},(_,i)=>i);
        ui.setupBusy=false;
        await selectPdfPage(0);
        toast(t(doc.numPages===1?"toast.pdfPageOne":"toast.pdfPages",{n:doc.numPages}),"success",4500);
      }catch(error){
        ui.setupBusy=false;
        render();
        toast(t("setup.planReadFailed",{reason:userMessage(error,"plan.fileUnreadable")}),"error",6000);
      }
      return;
    }
    if(!(file.type==="image/png"||file.type==="image/jpeg"||/\.(png|jpe?g)$/.test(lower)))return toast(t("toast.chooseImageType"),"error");
    let planSrc;try{planSrc=await readImageFile(file);}catch{return toast(t("plan.unreadableImage"),"error",6500);}
    newEventDraft.planSrc=planSrc;newEventDraft.planName=file.name;newEventDraft.pdfDoc=null;newEventDraft.pdfPages=[];render();
  }
  async function renderPdfThumbs(){
    const doc=newEventDraft.pdfDoc;if(!doc)return;
    // bindSetup() runs on every render and schedules this each time, and
    // choosing a page renders twice — so two passes could reach the SAME
    // canvas, and PDF.js throws "Cannot use the same canvas during multiple
    // render() operations" into the page (§28: the first suite to pick a PDF
    // page found it). A canvas is claimed before its first await, and a
    // thumbnail that cannot be drawn stays blank rather than throwing: it is
    // a preview, and the page itself is rendered separately on selection.
    for(const canvas of document.querySelectorAll("[data-pdf-thumb]")){
      if(canvas.dataset.thumbState)continue;canvas.dataset.thumbState="rendering";
      try{const index=Number(canvas.dataset.pdfThumb),page=await doc.getPage(index+1),v=page.getViewport({scale:.28});canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);await page.render({canvasContext:canvas.getContext("2d"),viewport:v}).promise;canvas.dataset.thumbState="done";}
      catch(error){canvas.dataset.thumbState="failed";}
    }
  }
  function createBlankEventFromSetup(usePlan){
    syncSetupFields();const d=newEventDraft;if(!d.name.trim()||!d.date||!d.hotel.trim()){toast(t("toast.eventFieldsRequired"),"error");return;}
    const event=migrateEvent({id:uid("event"),name:d.name.trim(),date:d.date,hotel:d.hotel.trim(),salon:d.salon.trim(),status:d.status,coverImage:d.coverImage,tables:[],venueObjects:[],guests:[],background:{src:usePlan?d.planSrc:"",name:usePlan?d.planName:"",opacity:.34,visible:!!(usePlan&&d.planSrc),locked:true,isDefault:false,scale:100},createdAt:nowISO(),lastModified:nowISO()});
    state.events.unshift(event);if(globalThis.MeritVenueModel)MeritVenueModel.migrateVenues(state);audit(event,"EVENT_CREATED",{blank:!event.background.src,hotel:event.hotel,salon:event.salon});saveState();ui.activeEventId=event.id;ui.screen="workspace";ui.tab="floor";ui.leftCollapsed=true;render();toast(t(event.background.src?"toast.eventCreatedWithPlan":"toast.blankEventCreated"),"success",5000);
  }
  function bindSetup(){
    document.querySelector("[data-setup='cancel']").onclick=()=>{ui.screen="events";render();};
    const drop=document.getElementById("v8PlanDrop"),input=document.getElementById("v8PlanFile");drop.onclick=e=>{e.preventDefault();input.click();};input.onchange=()=>handlePlanFile(input.files[0]);
    drop.ondragover=e=>{e.preventDefault();drop.classList.add("dragging")};drop.ondragleave=()=>drop.classList.remove("dragging");drop.ondrop=e=>{e.preventDefault();drop.classList.remove("dragging");handlePlanFile(e.dataTransfer.files[0]);};
    document.querySelector("[data-cover-drop]").onclick=e=>{e.preventDefault();document.getElementById("v8CoverFile").click();};document.getElementById("v8CoverFile").onchange=async e=>{const f=e.target.files[0];if(f){syncSetupFields();let cover;try{cover=await readImageFile(f);}catch{return toast(t("plan.unreadableImage"),"error",6500);}newEventDraft.coverImage=cover;render();}};
    document.querySelectorAll("[data-pdf-page]").forEach(b=>b.onclick=e=>{e.stopPropagation();syncSetupFields();selectPdfPage(Number(b.dataset.pdfPage));});
    document.querySelector("[data-setup='remove-cover']")?.addEventListener("click",e=>{e.preventDefault();syncSetupFields();newEventDraft.coverImage="";render();});
    document.querySelector("[data-setup='replace-plan']")?.addEventListener("click",e=>{e.preventDefault();input.click();});
    document.querySelector("[data-setup='remove-plan']")?.addEventListener("click",e=>{e.preventDefault();syncSetupFields();Object.assign(newEventDraft,{planSrc:"",planName:"",pdfDoc:null,pdfPages:[],pdfPage:0});render();});
    document.querySelector("[data-setup='blank']").onclick=e=>{e.preventDefault();createBlankEventFromSetup(false);};document.querySelector("[data-setup='create']").onclick=e=>{e.preventDefault();createBlankEventFromSetup(true);};
    requestAnimationFrame(renderPdfThumbs);
  }

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
  function guestResultHTML(event,row,active){
    const g=row.guest,table=row.table;
    const extra=additionalOf(g);
    const historical=RULES().isHistorical(event);
    const party=globalThis.MeritGuestSearch.partyOf(event,g);
    const seatText=table?`${esc(formatTableNumber(table.number))} · ${esc(seatRange(g.assignment.seats))}`:t("find.noTable");
    // Each action is offered only where it can do something, with the reason
    // carried in the title rather than a dead control the operator presses and
    // learns nothing from.
    const act=(action,label,enabled,title)=>
      `<button class="btn sm ${enabled?"":"is-off"}" data-find-action="${action}" data-find-guest="${g.id}"${
        enabled?"":" disabled"}${title?` title="${esc(title)}"`:""}>${label}</button>`;
    return`<div class="find-row ${active?"active":""}" data-search-guest="${g.id}" role="listitem"${active?' aria-current="true"':""}>
      <div class="find-who">
        <strong>${esc(g.name)}${extra?` +${extra}`:""}</strong>
        <span class="find-meta">${esc(t("find.pax",{n:paxOf(g)}))}${
          g.vip&&g.vip!=="Standard"?` · <b class="find-vip">${esc(g.vip)}</b>`:""} · ${esc(planningText(g.planningStatus))} · ${esc(arrivalText(g.arrivalStatus))}</span>
        <span class="find-meta">${seatText}${table&&table.zone?` · ${esc(table.zone)}`:""}${
          g.invitedBy?` · ${esc(t("find.invitedBy",{host:g.invitedBy}))}`:""}</span>
      </div>
      <div class="find-actions">
        ${act("plan",t("find.showOnPlan"),!!table,table?"":t("find.noTableReason"))}
        ${act("party",t("find.viewParty"),party.length>1,party.length>1?"":t("find.noPartyReason"))}
        ${act("checkin",t("find.checkIn"),!historical&&g.arrivalStatus!=="Checked In",
          historical?t("find.historicalReason"):g.arrivalStatus==="Checked In"?t("find.alreadyIn"):"")}
        ${act("table",t("find.changeTable"),!historical,historical?t("find.historicalReason"):"")}
      </div>
    </div>`;
  }
  // Both status axes are stored in English — they are domain values that the
  // workbook export and the contract read — so both are translated at the
  // render boundary and neither is translated in the data. An unrecognised
  // value is shown as it stands rather than relabelled with a word that might
  // not be true of it.
  const statusText=(prefix,status)=>{
    const k=prefix+String(status||"").replace(/\s+/g,"");
    return t(k)!==k?t(k):String(status||"");
  };
  const arrivalText=status=>statusText("find.arrival.",status);
  const planningText=status=>statusText("find.planning.",status);
  // Four things an operator does after finding somebody. None of them moves a
  // guest on its own: CHANGE TABLE opens Seating with the guest selected and
  // waits for a person to choose, because silently reseating somebody is the
  // one thing this product must never do.
  function findAction(event,action,guestId){
    const g=event.guests.find(x=>x.id===guestId);
    if(!g)return;
    const table=g.assignment?event.tables.find(t=>t.id===g.assignment.tableId):null;
    closeGuestSearch();
    if(action==="plan"&&table){
      ui.tab="floor";ui.planMode="plan";
      ui.selectedObjectId=table.id;ui.selectedObjectIds=[table.id];ui.highlightId=table.id;
      ui.selectedGuestId=g.id;
      render();
    }else if(action==="party"){
      const box=document.getElementById("globalGuestSearch");
      if(box){box.value=g.invitedBy||"";renderGlobalSearch(box.value);box.focus();}
    }else if(action==="checkin"){
      if(!canMutate(event,"check a guest in"))return;
      // Arrival status only. Planning status is a separate axis and nothing
      // here may write to it. setArrival() is the sole writer of the audit
      // entry too (ARRIVAL_STATUS_CHANGED, source:"finder") — a second,
      // differently-named entry here would log the same decision twice under
      // two codes, with a colliding "from" field meaning the guest's PREVIOUS
      // status in one and the calling UI surface in the other.
      setArrival(event,g,"Checked In","finder");
      touchEvent(event);render();
      toast(t("find.checkedIn",{name:g.name}),"success");
    }else if(action==="table"){
      if(!canMutate(event,"change a guest's table"))return;
      ui.tab="seating";ui.selectedGuestId=g.id;
      ui.seatingGuestScope="all";ui.seatingQuery=g.name;ui.seatingFilter="available";
      ui.selectedTableId=table?table.id:null;ui.highlightId=ui.selectedTableId;
      render();
    }
  }
  function closeGuestSearch(){
    ui.findActive=-1;
    document.getElementById("globalSearchResults")?.classList.add("hidden");
  }
  // Reassigns the top-level binding from src/app.js, the same way eventsHTML
  // and the other screen renderers are replaced by this file.
  renderGlobalSearch = function(query){
    const box=document.getElementById("globalSearchResults"),event=activeEvent();
    if(!box||!event)return;
    const {rows,total}=SEARCH.findGuests(event,query);
    if(!String(query||"").trim()){box.classList.add("hidden");ui.findActive=-1;return;}
    // -1 is the shut state, set by Escape and by the ui defaults. Without the
    // <0 guard it survives the next keystroke, so the list came back with
    // nothing selected and Enter did nothing — the keyboard path silently died
    // after the first Escape.
    if(ui.findActive==null||ui.findActive<0||ui.findActive>=rows.length)ui.findActive=rows.length?0:-1;
    box.innerHTML=rows.length
      ?`<div class="find-list" role="list" aria-label="${esc(t("find.resultsLabel"))}">${rows.map((r,i)=>guestResultHTML(event,r,i===ui.findActive)).join("")}</div>${
        total>rows.length?`<div class="find-more">${esc(t("find.more",{n:total-rows.length}))}</div>`:""}`
      :`<div class="find-empty">${t("find.none")}</div>`;
    box.classList.remove("hidden");
    box.querySelectorAll("[data-find-action]").forEach(b=>b.onclick=e=>{
      e.stopPropagation();
      if(b.disabled)return;
      findAction(event,b.dataset.findAction,b.dataset.findGuest);
    });
    // Clicking the row itself does the same as its primary action: show them on
    // the plan if they are seated, otherwise go and seat them.
    box.querySelectorAll("[data-search-guest]").forEach(row=>row.onclick=()=>{
      const g=event.guests.find(x=>x.id===row.dataset.searchGuest);
      findAction(event,g&&g.assignment?"plan":"table",row.dataset.searchGuest);
    });
  };
  // A door operator types and presses Enter; they do not reach for a mouse.
  function guestSearchKey(e){
    const box=document.getElementById("globalSearchResults");
    const input=document.getElementById("globalGuestSearch");
    if(!box||!input)return;
    if(e.key==="Escape"){closeGuestSearch();return;}
    const open=!box.classList.contains("hidden");
    if(!open)return;
    const rows=[...box.querySelectorAll("[data-search-guest]")];
    if(!rows.length)return;
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){
      e.preventDefault();
      ui.findActive=((ui.findActive??0)+(e.key==="ArrowDown"?1:-1)+rows.length)%rows.length;
      renderGlobalSearch(input.value);
    }else if(e.key==="Enter"){
      e.preventDefault();
      rows[Math.max(0,ui.findActive??0)]?.click();
    }
  }

  // ---- moved to src/screen-floor-plan.js — see that file's header. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. ----------------------------
  const FLOORPLAN=globalThis.MeritScreenFloorPlan.create({
    esc:(...a)=>esc(...a),eventFreezes:(...a)=>eventFreezes(...a),formatTableNumber:(...a)=>formatTableNumber(...a),getState:()=>state,getUnverifiedSeating:()=>UNVERIFIED_SEATING,icon:(...a)=>icon(...a),reviewGroupCount:(...a)=>REVIEW.reviewGroupCount(...a),shownCols:(...a)=>shownCols(...a),t:(...a)=>t(...a),tableAssignedPax:(...a)=>tableAssignedPax(...a),tableProvenanceHTML:(...a)=>tableProvenanceHTML(...a),toolbarBtn:(...a)=>toolbarBtn(...a),ui,VENUE:(...a)=>VENUE(...a),ZONES,
  });
  // Quantity is authoritative everywhere except "array", where rows x cols is.
  // Grid used to silently truncate to rows*cols, so asking for 25 tables in a
  // 2x2 grid quietly produced 4 -- the Quantity field lied about the outcome.
  // The bulk fields commit on `change`, which fires only on blur. Typing a
  // value and immediately clicking "Add to plan" therefore used to discard
  // that last edit -- type prefix "B", click, get T01. Read the live DOM
  // values before committing, the same way syncSetupFields does.
  function syncBulkFields(){
    if(!ui.bulkDraft)return;
    document.querySelectorAll("[data-bulk]").forEach(input=>{
      // The column field shows the layout's count until the operator types one.
      if(input.dataset.bulk==="cols"&&!ui.bulkDraft.colsChosen)return;
      ui.bulkDraft[input.dataset.bulk]=input.type==="number"?Number(input.value):input.value;
    });
  }
  // Repaint just the placement ghosts, so the live preview can follow typing
  // without a full render tearing down the panel the operator is using.
  function refreshGhosts(){
    const world=document.getElementById("canvasWorld");
    if(!world)return;
    world.querySelectorAll(".ghost-object").forEach(n=>n.remove());
    world.insertAdjacentHTML("beforeend",ghostHTML());
    const cols=document.querySelector('[data-bulk="cols"]');if(cols&&ui.bulkDraft)cols.value=shownCols(ui.bulkDraft);
  }
  function bulkCount(d){
    if(d.placement==="array")return Math.max(1,Math.min(60,(Math.max(1,Number(d.rows)||1))*(Math.max(1,Number(d.cols)||1))));
    return Math.max(1,Math.min(60,Number(d.quantity)||1));
  }
  // Fit fitted the fixed 1355×788 world, so a table placed below or beside it
  // stayed off-screen after Fit. It now fits the world together with every
  // object on the plan; for a plan whose objects all lie inside the world that
  // is exactly the old view.
  function planBox(event){
    let b=null;
    for(const o of [...(event?.tables||[]),...(event?.venueObjects||[])]){
      const w=Number(o.w)||0,h=Number(o.h)||0,cx=(Number(o.x)||0)+w/2,cy=(Number(o.y)||0)+h/2;
      const hw=o.rotation?Math.hypot(w,h)/2:w/2,hh=o.rotation?Math.hypot(w,h)/2:h/2;
      b=b?{x0:Math.min(b.x0,cx-hw),y0:Math.min(b.y0,cy-hh),x1:Math.max(b.x1,cx+hw),y1:Math.max(b.y1,cy+hh)}:{x0:cx-hw,y0:cy-hh,x1:cx+hw,y1:cy+hh};
    }
    return b;
  }
  fitCanvas = function(){
    const v=document.getElementById("canvasViewport");if(!v)return;
    const ev=activeEvent(),world=worldSize(ev),c=planBox(ev),x0=Math.min(0,c?c.x0:0),y0=Math.min(0,c?c.y0:0),bw=Math.max(world.width,c?c.x1:0)-x0,bh=Math.max(world.height,c?c.y1:0)-y0;
    ui.zoom=Math.max(.2,Math.min((v.clientWidth-42)/bw,(v.clientHeight-42)/bh));
    ui.pan.x=(v.clientWidth-bw*ui.zoom)/2-x0*ui.zoom;ui.pan.y=(v.clientHeight-bh*ui.zoom)/2-y0*ui.zoom;
    applyCanvasTransform();
  };
  function planFullyInView(event){
    const v=document.getElementById("canvasViewport"),c=planBox(event);if(!v||!c)return true;
    return ui.pan.x+c.x0*ui.zoom>=-1&&ui.pan.y+c.y0*ui.zoom>=-1&&ui.pan.x+c.x1*ui.zoom<=v.clientWidth+1&&ui.pan.y+c.y1*ui.zoom<=v.clientHeight+1;
  }
  // The first time a canvas shows an event's objects in this session, every
  // object is on screen: if the current view would cut any off, it is fitted.
  // After that the view is the operator's — it is never refitted behind them.
  const firstViewSeen=new Set();
  function firstViewFit(event){
    if(!event||!planBox(event))return;
    const key=event.id+":"+ui.tab;if(firstViewSeen.has(key))return;firstViewSeen.add(key);
    if(!planFullyInView(event))fitCanvas();
  }
  // A grid used the column count's default (2) whatever the quantity, so 24
  // tables became 12 rows running past the bottom of the room and Seating
  // opened with most of them off-screen (§25, entry Z). When a grid would
  // leave the room and the operator has not typed a column count, it starts
  // at the room's top-left with as many columns as fit. A count the operator
  // typed is kept exactly, and so is every grid that already fits.
  function bulkLayout(d){
    const count=bulkCount(d),gapX=190,gapY=145;
    let cols=d.placement==="row"?count:Math.max(1,Math.min(count,Number(d.cols)||1)),x0=440,y0=270;
    if(d.placement==="grid"&&!d.colsChosen&&y0+(Math.ceil(count/cols)-1)*gapY+82>WORLD.height){
      x0=60;y0=60;cols=Math.max(cols,Math.min(count,Math.floor((WORLD.width-x0-120)/gapX)+1));
    }
    return{count,cols,x0,y0,gapX,gapY};
  }
  function bulkPositions(d){
    const L=bulkLayout(d),out=[];
    for(let i=0;i<L.count;i++){const c=i%L.cols,r=Math.floor(i/L.cols);out.push({x:L.x0+c*L.gapX,y:L.y0+r*L.gapY});}
    return out;
  }
  const shownCols=d=>d.placement==="grid"&&!d.colsChosen?bulkLayout(d).cols:d.cols;
  function ghostHTML(){if(!ui.v8AddOpen||ui.bulkDraft?.placement==="repeated")return"";return bulkPositions(ui.bulkDraft).map((p,i)=>`<div class="ghost-object" data-label="${esc((ui.bulkDraft.prefix||"T")+String(i+1).padStart(2,"0"))}" style="left:${p.x}px;top:${p.y}px;width:120px;height:82px"></div>`).join("");}
  const oldViewport=canvasViewportHTML;
  canvasViewportHTML = function(event,seating){
    const html=oldViewport(event,seating);if(seating)return html;
    // Both replacements go through t(), so the v8 status survives a language
    // switch instead of only matching the English string.
    return html.replace("</div><div class=\"canvas-status\"",`${ghostHTML()}</div><div class="canvas-status v8-status"`)
      .replace(t("canvas.editHint"),`${t("canvas.multiSelectHint")}<span class="status-right">${t("canvas.selectedCount",{n:ui.selectedObjectIds.length||0})}</span>`);
  };
  floorPlanHTML = function(event){return`<div class="planmap-shell">${FLOORPLAN.planMapToolbarHTML(event)}${FLOORPLAN.bulkPanel(event)}${canvasViewportHTML(event,false)}${floorEmptyHTML(event)}${FLOORPLAN.contextualCardHTML(event)}${FLOORPLAN.planStatusPillHTML(event)}${FLOORPLAN.addManuallyFabHTML()}</div>`;};
  // ---- EMPTY STATES THAT SAY WHAT TO DO NEXT (§20) -------------------------
  // A blank canvas used to be a blank panel: the only sentence telling the
  // operator what to do was the toast raised when the event was created --
  // the transient carrier §17 ruled out for anything that stays true. Each
  // empty state now names what is missing and carries the control for the
  // next step. The card lets clicks through everywhere but itself.
  function canvasEmptyHTML(title,body,actions){
    return`<div class="canvas-empty" data-canvas-empty role="status"><div class="canvas-empty-card"><b>${esc(title)}</b><span>${esc(body)}</span>${actions?`<div class="canvas-empty-actions">${actions}</div>`:""}</div></div>`;
  }
  function floorEmptyHTML(event){
    if(event.tables.length||(event.venueObjects||[]).length||event.background?.src||RULES().isHistorical(event))return"";
    if(ui.v8AddOpen||ui.repeatPlacement)return"";   // already adding: the card would sit in the way
    return canvasEmptyHTML(t("empty.floor.title"),t("empty.floor.body"),
      `<button class="btn primary" data-v8-action="replace-bg">${icon("image")}${t("empty.floor.import")}</button><button class="btn" data-v8-action="add">${icon("plus")}${t("action.addManually")}</button>`);
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
  // ---- LAYOUT CHANGES -------------------------------------------------------
  //
  // What has moved since the room was published, as a MODE of the Floor Plan
  // rather than a screen of its own: the plan stays the hero and the changes
  // sit on it. The rules -- which version this event is compared to, what a
  // confirmation is keyed on -- and the comparison itself are MeritVenueModel's
  // (eventSourceVersion, changesSinceSource, confirmationKey,
  // compareToVersion); what follows is the screen.
  const VENUE=()=>globalThis.MeritVenueModel;
  function layoutChangesHTML(event){
    return`<div class="planmap-shell in-changes">${FLOORPLAN.planMapToolbarHTML(event)}${
      canvasViewportHTML(event,false)}${layoutChangePanelHTML(event)}${layoutChangeCardHTML(event)}</div>`;
  }
  function changeLabel(c){
    const k="changes.type."+c.type;
    return t(k)!==k?t(k):c.type;
  }
  // Before and after, only where the change actually has two values. MOVED has
  // none — it is a position, and "before: null → after: null" is noise dressed
  // as information; the distance in its evidence line is the real statement.
  function changeValuesHTML(c){
    if(c.before==null&&c.after==null)return"";
    const show=v=>v==null?"—":String(v);
    return`<span class="lc-values">${esc(show(c.before))} <i>&rarr;</i> ${esc(show(c.after))}</span>`;
  }
  function layoutChangePanelHTML(event){
    const d=VENUE().changesSinceSource(state,event);
    if(!d)return"";
    const seen=event.layoutChangesSeen||{};
    const rows=d.changes.map(c=>{
      const id=VENUE().confirmationKey(d.source.version.id,c);
      const confirmed=!!seen[id];
      const uncertain=c.identity.confidence==="UNCERTAIN";
      const conf=t("changes.confidence."+c.identity.confidence);
      const selected=ui.selectedChangeId===id;
      // Only an UNCERTAIN change offers a confirmation. A table matched by its
      // own number is not a claim an operator needs to ratify, and asking them
      // to tick 40 certainties would make the ticks meaningless on the four
      // that matter.
      const act=uncertain&&!confirmed&&!RULES().isHistorical(event)
        ?`<button class="btn sm" data-change-confirm="${esc(id)}">${t("changes.confirm")}</button>`
        :confirmed?`<span class="lc-confirmed">${t("changes.confirmed")}</span>`:"";
      return`<li class="lc-row ${c.type} ${selected?"selected":""} ${confirmed?"is-confirmed":""}" data-change-select="${esc(id)}">
        <span class="lc-type">${esc(changeLabel(c))}</span>
        <span class="lc-key">${esc(c.key)}</span>
        ${changeValuesHTML(c)}
        <span class="lc-conf ${c.identity.confidence}">${esc(conf)}</span>
        ${act}</li>`;
    }).join("");
    const src=d.source;
    return`<aside class="layout-changes">
      <div class="lc-head">
        <div><strong>${t("changes.title")}</strong><span>${esc(t("changes.comparedTo",{
          version:src.version.label,layout:src.layout.name}))}</span></div>
        <span class="lc-count">${d.changes.length}</span>
      </div>
      ${d.changes.length?`<ul class="lc-rows">${rows}</ul>`
        :`<p class="lc-empty">${t("changes.none")}</p>`}
    </aside>`;
  }
  // The contextual card: previous, current, how confident, and on what evidence.
  // Same shape as the review inspector, because it answers the same question
  // about a different kind of claim.
  function layoutChangeCardHTML(event){
    const d=VENUE().changesSinceSource(state,event);
    if(!d||!ui.selectedChangeId)return"";
    const c=d.changes.find(x=>VENUE().confirmationKey(d.source.version.id,x)===ui.selectedChangeId);
    if(!c)return"";
    const by=t("changes.identity."+c.identity.by);
    return`<div class="poi-card lc-card">
      <div class="poi-card-head"><strong>${esc(c.key)}</strong><span>${esc(changeLabel(c))}</span></div>
      <div class="lc-card-body">
        <div class="lc-pair"><em>${t("changes.before")}</em><b>${esc(c.before==null?"—":String(c.before))}</b></div>
        <div class="lc-pair"><em>${t("changes.after")}</em><b>${esc(c.after==null?"—":String(c.after))}</b></div>
        <div class="lc-pair"><em>${t("changes.confidenceLabel")}</em><b>${esc(t("changes.confidence."+c.identity.confidence))}</b></div>
        <div class="lc-pair"><em>${t("changes.identityLabel")}</em><b>${esc(by===("changes.identity."+c.identity.by)?c.identity.by:by)}</b></div>
        <p class="lc-evidence">${esc(c.identity.detail||"")}</p>
      </div>
    </div>`;
  }
  function confirmLayoutChange(event,id){
    if(!canMutate(event,"confirm a layout change"))return;
    event.layoutChangesSeen={...(event.layoutChangesSeen||{}),[id]:nowISO()};
    audit(event,"LAYOUT_CHANGE_CONFIRMED",{change:id});
    touchEvent(event);render();
  }
  function bindLayoutChanges(){
    const event=activeEvent();
    document.querySelectorAll("[data-change-select]").forEach(row=>row.onclick=e=>{
      if(e.target.closest("[data-change-confirm]"))return;
      const id=row.dataset.changeSelect;
      ui.selectedChangeId=ui.selectedChangeId===id?null:id;
      // Selecting a change highlights the object it is about, on the plan the
      // operator is already looking at. That is the whole overlay: no second
      // drawing, no ghost of the old layout on top of the new one.
      const d=VENUE().changesSinceSource(state,event);
      const c=d&&d.changes.find(x=>VENUE().confirmationKey(d.source.version.id,x)===ui.selectedChangeId);
      ui.highlightId=c?(c.tableIdAfter||c.tableIdBefore||null):null;
      render();
    });
    document.querySelectorAll("[data-change-confirm]").forEach(b=>b.onclick=()=>
      confirmLayoutChange(event,b.dataset.changeConfirm));
  }

  function uniqueNumber(event,prefix,index){let n=index;while(event.tables.some(t=>t.number===prefix+String(n).padStart(2,"0")))n++;return prefix+String(n).padStart(2,"0");}
  function createTable(event,d,x,y,index){
    const dims=d.type==="round"?[120,120]:d.type==="square"?[105,105]:d.type==="bistro"?[82,72]:[170,86],number=uniqueNumber(event,(d.prefix|| (d.type==="bistro"?"B":"T")).toUpperCase(),index);
    return RULES().syncTableChairs({id:uid("table"),number,origin:"MANUAL",type:d.type,x,y,w:dims[0],h:dims[1],capacity:Number(d.chairs)||1,zone:d.type==="bistro"?"BISTRO":d.zone||"MAIN FLOOR",rotation:0,locked:false,z:10,hasPhysicalSeats:true,capacitySource:"HUMAN_CONFIRMED"});
  }
  function commitBulk(){
    syncBulkFields();
    const event=activeEvent(),d=ui.bulkDraft;
    if(!canMutate(event,"add plan objects"))return;
    if(d.placement==="repeated"){
      ui.repeatPlacement={...d,remaining:Math.max(1,Number(d.quantity)||1),index:1};
      ui.v8AddOpen=false;
      render();
      toast(t("toast.repeatedPlacementActive"),"success",5000);
      return;
    }
    const positions=bulkPositions(d);
    if(!positions.length)return;
    recordUndo(event);
    const created=[];
    positions.forEach((p,i)=>{if(d.kind==="table"){
      const t=createTable(event,d,p.x,p.y,i+1);
      event.tables.push(t);
      created.push(t.id);
    }else{
      const sizes={stage:[380,180],bar:[300,70],entrance:[110,40],exit:[90,40],column:[55,55],text:[150,42]},s=sizes[d.type]||[120,50],o={id:uid("venue"),type:d.type,label:d.type.toUpperCase(),x:p.x,y:p.y,w:s[0],h:s[1],rotation:0,locked:false,z:4};
      event.venueObjects.push(o);
      created.push(o.id);
    }});
    ui.selectedObjectIds=created;
    ui.selectedObjectId=created[0];
    ui.v8AddOpen=false;
    touchEvent(event);
    render();
    requestAnimationFrame(()=>{if(!planFullyInView(event))fitCanvas();});
    toast(t(created.length===1?"toast.objectAddedChairsOne":"toast.objectsAddedChairs",{n:created.length}),"success");
  }
  function placeRepeated(pointerEvent){
    const r=document.getElementById("canvasViewport").getBoundingClientRect(),d=ui.repeatPlacement,event=activeEvent(),x=(pointerEvent.clientX-r.left-ui.pan.x)/ui.zoom,y=(pointerEvent.clientY-r.top-ui.pan.y)/ui.zoom;
    if(!d||!canMutate(event,"place plan objects"))return;
    recordUndo(event);
    let id;
    if(d.kind==="table"){
      const t=createTable(event,d,x-60,y-45,d.index);
      event.tables.push(t);
      id=t.id;
    }else{
      const o={id:uid("venue"),type:d.type,label:d.type.toUpperCase(),x:x-60,y:y-30,w:120,h:60,rotation:0,locked:false,z:4};
      event.venueObjects.push(o);
      id=o.id;
    }
    d.remaining--;
    d.index++;
    ui.selectedObjectId=id;
    ui.selectedObjectIds=[id];
    if(d.remaining<=0)ui.repeatPlacement=null;
    touchEvent(event);
    render();
  }
  function duplicateSelection(){
    const event=activeEvent();
    if(!canMutate(event,"duplicate plan objects"))return;
    const ids=ui.selectedObjectIds.length?ui.selectedObjectIds:[ui.selectedObjectId].filter(Boolean);
    if(!ids.length)return toast(t("toast.selectObjectsFirst"));
    recordUndo(event);
    const created=[];
    for(const id of ids){
      const t=event.tables.find(x=>x.id===id),o=event.venueObjects.find(x=>x.id===id),c=clone(t||o);
      if(!c)continue;
      c.id=uid(t?"table":"venue");
      c.x+=24;
      c.y+=24;
      c.locked=false;
      if(t){
        c.number=uniqueNumber(event,t.type==="bistro"?"B":"T",1);
        // A copy is a person's act: nothing about it was detected, and the
        // number printed on the ORIGINAL's symbol is not this table's (§21).
        c.origin="COPY";delete c.printedNumber;if(c.capacitySource==="DETECTED_PHYSICAL_SEATS")c.capacitySource="HUMAN_CONFIRMED";c.chairs=(c.chairs||[]).map((chair,index)=>({...chair,id:uid("chair"),parentTableId:c.id,seatNumber:index+1}));event.tables.push(c);}else event.venueObjects.push(c);created.push(c.id);}ui.selectedObjectIds=created;ui.selectedObjectId=created[0]||null;touchEvent(event);render();}
  async function deleteSelection(){
    const event=activeEvent();
    if(!canMutate(event,"delete plan objects"))return;
    const ids=new Set(ui.selectedObjectIds.length?ui.selectedObjectIds:[ui.selectedObjectId].filter(Boolean));
    if(!ids.size)return;
    const affected=event.guests.filter(g=>ids.has(g.assignment?.tableId));
    if(!(await ask({title:t("ask.deleteObjectsTitle",{n:ids.size}),body:affected.length?t("ask.deleteObjectsGuests",{n:ids.size,guests:affected.length}):"",confirmLabel:t("ask.delete"),danger:true})))return;
    recordUndo(event);
    affected.forEach(g=>SEAT().clear(g));
    event.tables=event.tables.filter(t=>!ids.has(t.id));
    event.venueObjects=event.venueObjects.filter(o=>!ids.has(o.id));
    ui.selectedObjectIds=[];
    ui.selectedObjectId=null;
    touchEvent(event);
    render();
  }

  function startMarquee(e){
    if(e.button!==0||ui.tool!=="select"||ui.repeatPlacement)return;const viewport=document.getElementById("canvasViewport"),world=document.getElementById("canvasWorld");if(![viewport,world,world.querySelector(".reference-layer")].includes(e.target))return;e.preventDefault();const box=document.createElement("div");box.className="marquee";viewport.appendChild(box);const r=viewport.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top;let current=[];
    const move=ev=>{
      const x=ev.clientX-r.left,y=ev.clientY-r.top,left=Math.min(sx,x),top=Math.min(sy,y),w=Math.abs(x-sx),h=Math.abs(y-sy);
      Object.assign(box.style,{left:left+"px",top:top+"px",width:w+"px",height:h+"px"});
      const br={left:r.left+left,top:r.top+top,right:r.left+left+w,bottom:r.top+top+h};
      current=[...world.querySelectorAll("[data-object-id]")].filter(el=>{
        const q=el.getBoundingClientRect();
        return q.right>=br.left&&q.left<=br.right&&q.bottom>=br.top&&q.top<=br.bottom;
      }).map(el=>el.dataset.objectId);
    };
    const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);box.remove();ui.selectedObjectIds=e.ctrlKey?[...new Set([...ui.selectedObjectIds,...current])]:current;ui.selectedObjectId=ui.selectedObjectIds[0]||null;render();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
  }
  startObjectDrag = function(e,id,kind,el){
    const event=activeEvent();if(!canMutate(event,"move plan objects")||ui.tool!=="select")return;
    if(e.ctrlKey||e.shiftKey){e.preventDefault();e.stopPropagation();ui.selectedObjectIds=ui.selectedObjectIds.includes(id)?ui.selectedObjectIds.filter(x=>x!==id):[...ui.selectedObjectIds,id];ui.selectedObjectId=ui.selectedObjectIds[0]||null;render();return;}
    if(!ui.selectedObjectIds.includes(id))ui.selectedObjectIds=[id];ui.selectedObjectId=id;
    const selected=ui.selectedObjectIds.map(objectId=>event.tables.find(x=>x.id===objectId)||event.venueObjects.find(x=>x.id===objectId)).filter(Boolean);if(selected.some(o=>o.locked))return toast(t("toast.unlockSelectedFirst"),"error");
    e.preventDefault();e.stopPropagation();const snap=canvasSnapshot(event),sx=e.clientX,sy=e.clientY,start=selected.map(o=>({o,x:o.x,y:o.y}));let moved=false;
    const move=ev=>{const dx=(ev.clientX-sx)/ui.zoom,dy=(ev.clientY-sy)/ui.zoom;start.forEach(({o,x,y})=>{o.x=ui.snap?Math.round((x+dx)/10)*10:x+dx;o.y=ui.snap?Math.round((y+dy)/10)*10:y+dy;const node=document.querySelector(`[data-object-id="${o.id}"]`);if(node){node.style.left=o.x+"px";node.style.top=o.y+"px";}});moved=true;};
    const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);if(moved){recordUndo(event,snap);touchEvent(event);}render();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
  };

  setTableCapacity = function(event,table,newCap){
    if(!canMutate(event,"change chair capacity"))return false;
    newCap=Math.max(1,Math.min(99,Number(newCap)||1));
    const occupied=tableAssignedPax(event,table.id);
    if(newCap<occupied){
      toast(t("toast.capacityBelowPax",{table:table.number,n:occupied}),"error",5000);
      return false;
    }
    recordUndo(event);
    repackTableAssignments(event,table,newCap);
    if(table.capacityEvidence&&table.capacitySource!=="HUMAN_CONFIRMED")table.capacityEvidence={...table.capacityEvidence,confirmedBy:"person",confirmedAt:nowISO(),previous:table.capacity};
    table.capacitySource="HUMAN_CONFIRMED";
    RULES().syncTableChairs(table,newCap);
    touchEvent(event);
    render();
    return true;
  };
  // A person can now type a table's number (§24): it was the one plan fact with
  // no path at all -- the only number field lived in the pre-v8 inspector,
  // which v8 never renders. Validated HERE before the base writer runs: letters,
  // digits, space, hyphen; at most 12; and unique by how the number is SHOWN,
  // so "T1" is refused beside an existing "T01" rather than becoming a second
  // "T 01" that the Plan Doctor would then have to call BLOCKING.
  updateInspectorField = function(event,field,value){if(!canMutate(event,"edit plan objects"))return;
    const table=event.tables.find(x=>x.id===ui.selectedObjectId);
    if(field==="number"&&table){
      const v=String(value??"").trim().toUpperCase().replace(/\s+/g," ");
      if(!v||v.length>12||!/^[A-Z0-9ÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ -]*$/.test(v)){toast(t("toast.tableNumberInvalid"),"error");render();return;}
      if(v===table.number){render();return;}
      if(event.tables.some(x=>x.id!==table.id&&formatTableNumber(x.number)===formatTableNumber(v))){toast(t("toast.tableNumberInUse"),"error");render();return;}
      original.updateInspectorField(event,field,v);
      table.numberSource="TYPED";touchEvent(event);
      return;
    }
    original.updateInspectorField(event,field,value);if(table)RULES().syncTableChairs(table);};
  inspectorAction = function(event,action){if(!canMutate(event,`${action} plan objects`))return;if(action==="duplicate")return duplicateSelection();if(action==="delete")return deleteSelection();original.inspectorAction(event,action);};
  deleteSelectedObject = function(){return deleteSelection();};
  startResize = function(...args){if(canMutate(activeEvent(),"resize plan objects"))original.startResize(...args);};
  startRotate = function(...args){if(canMutate(activeEvent(),"rotate plan objects"))original.startRotate(...args);};
  createTableFromDraft = function(){if(canMutate(activeEvent(),"add a table")){original.createTableFromDraft();const e=activeEvent(),t=e.tables.find(x=>x.id===ui.selectedObjectId);if(t){RULES().syncTableChairs(t);saveState();}}};
  addVenue = function(...args){if(canMutate(activeEvent(),"add a venue object"))original.addVenue(...args);};
  // Undo/redo were the last canvas mutation path with no historical guard, and
  // the most reachable one: the Ctrl+Z handler in app-guests.js is bound to
  // window and is gated on neither screen, tab nor event status. Marking an
  // event Completed without leaving the workspace -- or simply working past
  // midnight into a past-dated event -- left a live undo stack pointed at a
  // record that is supposed to be frozen, and one keystroke rewrote its floor
  // plan. Guarding the handler would have fixed that one caller; the rule is
  // that canMutate rejects every mutation path, so the guard goes here.
  undoCanvas = function(){if(canMutate(activeEvent(),"undo changes"))original.undoCanvas();};
  redoCanvas = function(){if(canMutate(activeEvent(),"redo changes"))original.redoCanvas();};

  const oldBindCanvas=bindCanvas;
  bindCanvas = function(){
    oldBindCanvas();const event=activeEvent(),viewport=document.getElementById("canvasViewport"),world=document.getElementById("canvasWorld");
    if(RULES().isHistorical(event))return;
    document.querySelectorAll("[data-v8-action]").forEach(button=>button.onclick=()=>{
      const action=button.dataset.v8Action;
      if(action==="add"){
        ui.v8AddOpen=!ui.v8AddOpen;
        ui.bulkDraft ||= {kind:"table",type:"round",chairs:8,quantity:4,rows:2,cols:2,placement:"grid",prefix:"T",zone:"MAIN FLOOR"};
        render();
      }else if(action==="close-add"){
        ui.v8AddOpen=false;
        render();
      }else if(action==="commit-add")commitBulk();else if(action==="duplicate-selection")duplicateSelection();else if(action==="delete-selection")deleteSelection();else if(action==="focus"){
        ui.focusMode=!ui.focusMode;
        render();
      }else if(action==="detect")runAssistedDetection();else if(action==="toggle-bg"){
        recordUndo(event);
        event.background.visible=!event.background.visible;
        touchEvent(event);
      }else if(action==="replace-bg")document.getElementById("floorPlanFile").click();else if(action==="open-review-center"){
        ui.reviewCenterOpen=true;
        ui.tab="floor";
        ui.planMode="review";
        render();
      }else if(action==="toggle-lang"){
        ui.lang=ui.lang==="tr"?"en":"tr";
        render();
      }
    });
    // Typed fields update the draft and refresh only the ghost preview. A full
    // re-render on every change replaced the "Add to plan" button mid-click --
    // typing a value and clicking straight through lost both the edit and the
    // click. Selects still re-render, since choosing an option can change which
    // fields exist and no other click is in flight.
    document.querySelectorAll("[data-bulk]").forEach(input=>{
      const isSelect=input.tagName==="SELECT";
      input.oninput=()=>{
        if(input.dataset.bulk==="cols")ui.bulkDraft.colsChosen=true;
        syncBulkFields();
        if(input.dataset.bulk==="kind")ui.bulkDraft.type=ui.bulkDraft.kind==="venue"?"stage":"round";
        if(isSelect)render();else refreshGhosts();
      };
    });
    viewport?.addEventListener("pointerdown",e=>{if(ui.repeatPlacement&&e.target.closest("[data-object-id]")==null){e.preventDefault();placeRepeated(e);}},true);viewport?.addEventListener("pointerdown",startMarquee,true);
    world?.querySelectorAll("[data-object-id]").forEach(el=>{if(ui.selectedObjectIds.includes(el.dataset.objectId))el.classList.add("multi-selected");if(ui.tab==="seating"&&el.dataset.objectKind==="table"){el.addEventListener("drop",e=>{const raw=e.dataTransfer.getData("application/x-merit-guests");if(raw){e.preventDefault();e.stopPropagation();assignGuestGroup(JSON.parse(raw),el.dataset.objectId);}},true);}});
    const clear=document.querySelector("[data-clear-seating-filter]");if(clear)clear.onclick=()=>{ui.seatingFilter="all";ui.operationalMode=false;render();};
  };

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
    activeEvent:(...a)=>activeEvent(...a),assignGuestGroup:(...a)=>assignGuestGroup(...a),assignGuestToTable:(...a)=>assignGuestToTable(...a),authoriseFreezeOverride:(...a)=>authoriseFreezeOverride(...a),AVAIL:(...a)=>AVAIL(...a),availReasonText:(...a)=>availReasonText(...a),bindPanelToggles:(...a)=>bindPanelToggles(...a),canMutate:(...a)=>canMutate(...a),canSeat,canvasEmptyHTML:(...a)=>canvasEmptyHTML(...a),canvasViewportHTML:(...a)=>canvasViewportHTML(...a),createFreezeFromDraft:(...a)=>createFreezeFromDraft(...a),esc:(...a)=>esc(...a),eventFreezes:(...a)=>eventFreezes(...a),formatTableNumber:(...a)=>formatTableNumber(...a),FREEZE:(...a)=>FREEZE(...a),freezeReasonText:(...a)=>freezeReasonText(...a),icon:(...a)=>icon(...a),liftFreeze:(...a)=>liftFreeze(...a),logicalSeatCount:(...a)=>logicalSeatCount(...a),naturalSort:(...a)=>naturalSort(...a),onboardingCalloutHTML:(...a)=>onboardingCalloutHTML(...a),paxDotsHTML:(...a)=>paxDotsHTML(...a),paxOf:(...a)=>paxOf(...a),recordUndo:(...a)=>recordUndo(...a),render:(...a)=>render(...a),resolvedFreezes:(...a)=>resolvedFreezes(...a),resolvedUnavailable:(...a)=>resolvedUnavailable(...a),RULES:(...a)=>RULES(...a),seatingCapacity:(...a)=>seatingCapacity(...a),seatingQueueEmptyHTML:(...a)=>seatingQueueEmptyHTML(...a),setTableAvailability:(...a)=>setTableAvailability(...a),t:(...a)=>t(...a),tableAssignedPax:(...a)=>tableAssignedPax(...a),tableIndex:(...a)=>tableIndex(...a),tableSeatMap:(...a)=>tableSeatMap(...a),toast:(...a)=>toast(...a),toggleAssignmentLock:(...a)=>toggleAssignmentLock(...a),touchEvent:(...a)=>touchEvent(...a),ui,unassignGuest:(...a)=>unassignGuest(...a),v8Toolbar:(...a)=>FLOORPLAN.v8Toolbar(...a),
  });
  seatingHTML = function(...a){return SEATING.seatingHTML(...a);};
  selectedTablePanelHTML = function(...a){return SEATING.selectedTablePanelHTML(...a);};
  seatRowHTML = function(...a){return SEATING.seatRowHTML(...a);};
  bindSeating = function(...a){return SEATING.bindSeating(...a);};

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
    if(loadMemo.event===event&&loadMemo.epoch===mutationEpoch&&loadMemo.mode===m)return loadMemo.load;
    loadMemo={event,epoch:mutationEpoch,mode:m,
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
  assignGuestToTable = function(guestId,tableId,preferred=null,options=null){assignGuestGroup([guestId],tableId,preferred,options);};
  // unassignGuest is defined further down, where its undo lives.
  toggleAssignmentLock = function(id){const event=activeEvent();if(!canMutate(event,"change an assignment lock"))return;original.toggleAssignmentLock(id);};


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
    ui,t,esc,icon,naturalSort,paxOf,OCC,SEARCH,canMutate,liveEmptyHTML,partyMetaHTML,recordArrival,seatTagHTML,setArrival,tableIndex,
    activeEvent:()=>activeEvent(),render:()=>render(),touchEvent:e=>touchEvent(e),toast:(...a)=>toast(...a),
    epoch:()=>mutationEpoch,
  });
  liveHTML = function(event){return LIVE.html(event);};
  bindLive = function(){return LIVE.bind();};
  // Session-only trail so a mis-tap at the door is recoverable. Deliberately
  // ui state, not event data -- it must never reach the stored schema.
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
    activeEvent:(...a)=>activeEvent(...a),app,auditTrailText:(...a)=>auditTrailText(...a),bindDoctorGo:(...a)=>COMMAND.bindDoctorGo(...a),buildTablePlanModel:(...a)=>buildTablePlanModel(...a),doctorGoHTML:(...a)=>COMMAND.doctorGoHTML(...a),doctorText:(...a)=>COMMAND.doctorText(...a),esc:(...a)=>esc(...a),eventMetrics:(...a)=>eventMetrics(...a),eventReadiness:(...a)=>eventReadiness(...a),exportGuestCSV,exportTablePlanXLSX,fmtDate:(...a)=>fmtDate(...a),formatTableNumber:(...a)=>formatTableNumber(...a),getState:()=>state,icon:(...a)=>icon(...a),LIVE,naturalSort:(...a)=>naturalSort(...a),paxOf:(...a)=>paxOf(...a),planIssues:(...a)=>planIssues(...a),relativeTime:(...a)=>relativeTime(...a),resolvedAuditTrail:(...a)=>resolvedAuditTrail(...a),RULES:(...a)=>RULES(...a),seatExportName:(...a)=>seatExportName(...a),seatingStats:(...a)=>seatingStats(...a),t:(...a)=>t(...a),tableAssignedPax:(...a)=>tableAssignedPax(...a),toast:(...a)=>toast(...a),TRAIL:(...a)=>TRAIL(...a),ui,whileBusy:(...a)=>whileBusy(...a),
  });
  reportsHTML = function(...a){return REPORTS.reportsHTML(...a);};
  bindReports = function(...a){return REPORTS.bindReports(...a);};
  // ---- moved to src/screen-guests.js — see that file's header. The shell hands it
  // what it reads; shell functions go over as late-binding wrappers, so a body
  // this file reassigns later is the one that runs. ----------------------------
  const GUESTS=globalThis.MeritScreenGuests.create({
    activeEvent:(...a)=>activeEvent(...a),additionalOf:(...a)=>additionalOf(...a),app,downloadExcelTemplate,esc:(...a)=>esc(...a),filteredGuests:(...a)=>filteredGuests(...a),icon:(...a)=>icon(...a),openExcelWizard,openGuestDialog:(...a)=>openGuestDialog(...a),original,paxDotsHTML:(...a)=>paxDotsHTML(...a),paxOf:(...a)=>paxOf(...a),render:(...a)=>render(...a),RULES:(...a)=>RULES(...a),seatTagHTML:(...a)=>seatTagHTML(...a),t:(...a)=>t(...a),tableIndex:(...a)=>tableIndex(...a),ui,
  });
  guestsHTML = function(...a){return GUESTS.guestsHTML(...a);};
  bindGuests = function(...a){return GUESTS.bindGuests(...a);};
  // ---- Undo for the two actions that destroy work ---------------------
  // A guest record is typed by hand or imported once; losing one to a mis-click
  // is the kind of mistake a non-technical operator cannot recover from. These
  // replace the thin canMutate wrappers that used to delegate to the base
  // implementations -- the guard is kept, the recovery is new.
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
  deleteGuest = async function(id){
    const event=activeEvent(),g=event&&event.guests.find(x=>x.id===id);
    if(!g||!canMutate(event,"delete a guest"))return;
    if(!(await ask({title:t("ask.deleteGuestTitle"),body:t("guests.confirmDelete",{name:g.name}),confirmLabel:t("ask.delete"),danger:true})))return;
    // The whole record is kept, including its planned assignment, so undo puts
    // the guest back exactly where they were rather than as a fresh unassigned
    // record. Position is kept too, so the list does not reshuffle on undo.
    const index=event.guests.indexOf(g),snapshot=JSON.parse(JSON.stringify(g));
    event.guests.splice(index,1);
    RULES().syncEventChairs(event);
    audit(event,"GUEST_DELETED",{guestId:g.id,name:g.name});
    touchEvent(event);render();
    toastAction(t("guests.deletedToast",{name:g.name}),t("live.undo"),()=>{
      const now=activeEvent();
      if(!now||!canMutate(now,"restore a guest"))return;
      if(now.guests.some(x=>x.id===snapshot.id))return;
      // The seat may have been given away in the meantime. Restoring the record
      // matters more than restoring the seat, so the guest comes back either
      // way -- unassigned if the seat is gone, and the operator is told.
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
      touchEvent(now);render();
      toast(seatLost?t("guests.restoredNoSeat",{name:snapshot.name}):t("guests.restoredToast",{name:snapshot.name}),"success");
    });
  };
  unassignGuest = function(id,options=null){
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
  };

  openGuestDialog = function(...args){if(canMutate(activeEvent(),"edit guest records")){original.openGuestDialog(...args);translateStaticDialogs();}};

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
  // ---- operator sessions: what a real person actually did -----------------
  //
  // Every number in benchmarks/review-order/ is about reaching an error, not
  // about a person resolving one. The queue is measured against ground truth
  // by a script that never gets confused, never scrolls past a card, and never
  // decides the third question is not worth answering. Whether the screen works
  // for someone doing this job is a different question and this code cannot
  // answer it — it can only make the answer recordable.
  //
  // So this records what actually happened in a review session: when it
  // started, what was done, in what order, and how that order compares to the
  // one the product suggested. It is the instrument, not the result.
  //
  // ENTIRELY LOCAL. It lives in state alongside everything else, it is written
  // by the same storage provider, and there is no network path out of it — no
  // fetch, no beacon, no analytics endpoint, not behind a flag. A tool that
  // watches an operator work and can also phone home is a different product
  // from the one the user agreed to run.
  const OPERATOR_SESSION_MAX = 50;
  function operatorSession(event){
    const analysisId=event.analysis?.id;
    if(!analysisId)return null;
    state.operatorSessions ||= [];
    let s=state.operatorSessions.find(x=>x.analysisId===analysisId);
    if(!s){
      s={id:uid("session"),analysisId,eventId:event.id,startedAt:nowISO(),
        startedAtMs:Date.now(),actions:[],
        // The order the product proposed at the moment the session opened, so
        // "did they follow it" is measured against what they were actually
        // shown rather than against a queue recomputed after their edits.
        suggestedOrder:(event.analysis.planIntelligence?.reviewPriorities||[])
          .map(p=>({key:p.key,targetIds:p.targetIds||[]}))};
      state.operatorSessions.push(s);
      if(state.operatorSessions.length>OPERATOR_SESSION_MAX)
        state.operatorSessions=state.operatorSessions.slice(-OPERATOR_SESSION_MAX);
    }
    return s;
  }
  function recordOperatorAction(event,type,targetIds){
    const s=operatorSession(event);
    if(!s)return;
    const ids=(Array.isArray(targetIds)?targetIds:[targetIds]).filter(Boolean);
    // Which suggested item this action landed on, if any. -1 means the operator
    // worked somewhere the queue never pointed, which is itself a finding.
    const position=s.suggestedOrder.findIndex(p=>p.targetIds.some(id=>ids.includes(id)));
    s.actions.push({at:nowISO(),sinceStartMs:Date.now()-s.startedAtMs,
      type,targetIds:ids,suggestedPosition:position});
  }
  // A read-only summary for the operator-usability harness. Deliberately not
  // rendered anywhere: an operator being shown their own speed while working is
  // a different product decision, and one nobody asked for.
  function operatorSessionSummary(analysisId){
    const s=(state.operatorSessions||[]).find(x=>x.analysisId===analysisId);
    if(!s)return null;
    const acts=s.actions;
    const onQueue=acts.filter(a=>a.suggestedPosition>=0);
    return{
      sessionId:s.id,analysisId:s.analysisId,startedAt:s.startedAt,
      suggestedItems:s.suggestedOrder.length,
      actions:acts.length,
      byType:acts.reduce((m,a)=>(m[a.type]=(m[a.type]||0)+1,m),{}),
      msToFirstAction:acts.length?acts[0].sinceStartMs:null,
      msToLastAction:acts.length?acts[acts.length-1].sinceStartMs:null,
      // Of the actions that landed on a suggested item, how far down the list
      // it was. A person working strictly top-down averages near 0.
      onQueueActions:onQueue.length,
      offQueueActions:acts.length-onQueue.length,
      meanSuggestedPosition:onQueue.length
        ? +(onQueue.reduce((n,a)=>n+a.suggestedPosition,0)/onQueue.length).toFixed(2):null,
      firstActionWasTopOfQueue:acts.length?acts[0].suggestedPosition===0:null,
    };
  }
  globalThis.MeritOperatorSessions={summary:operatorSessionSummary,
    all:()=>(state.operatorSessions||[]).map(s=>operatorSessionSummary(s.analysisId))};

  // ---- the import-to-confirm report ---------------------------------------
  //
  // The operator test is only worth running if the person running it does not
  // have to open a developer console to get the result. This assembles what the
  // session and the plan's own timings already recorded into one page an
  // operator can read, copy and send.
  //
  // It reports what happened. It does not grade it: there is no baseline for a
  // "good" review time and inventing one would be the same overclaiming this
  // product refuses everywhere else.
  function operatorReport(event){
    const a=event.analysis;
    if(!a)return null;
    const s=operatorSessionSummary(a.id),tm=a.timings||{};
    const pi=a.planIntelligence,secs=ms=>ms==null?null:Math.round(ms/100)/10;
    const alive=a.candidates.filter(c=>c.status!=="rejected");
    return{
      plan:event.background?.name||null,
      analysisId:a.id,
      timings:{
        importToAnalysisS:secs(tm.analysisStartedAtMs&&tm.importedAtMs&&tm.analysisStartedAtMs-tm.importedAtMs),
        analysisS:secs(tm.analysisCompletedAtMs&&tm.analysisStartedAtMs&&tm.analysisCompletedAtMs-tm.analysisStartedAtMs),
        reviewS:secs(tm.confirmedAtMs&&tm.analysisCompletedAtMs&&tm.confirmedAtMs-tm.analysisCompletedAtMs),
        importToConfirmS:secs(tm.confirmedAtMs&&tm.importedAtMs&&tm.confirmedAtMs-tm.importedAtMs),
        toFirstActionS:secs(s?.msToFirstAction),
      },
      actions:{
        total:s?.actions??0,byType:s?.byType||{},
        onQueue:s?.onQueueActions??0,offQueue:s?.offQueueActions??0,
        startedAtTopOfQueue:s?.firstActionWasTopOfQueue??null,
        meanQueuePosition:s?.meanSuggestedPosition??null,
      },
      plan_state:{
        objectsDetected:alive.length,
        stillUnreviewed:a.candidates.filter(c=>c.status==="unreviewed").length,
        heldBack:alive.filter(c=>c.lowEvidence).length,
        reviewItemsLeft:pi?.reviewPriorities?.length??null,
        openDisagreements:pi?.contradictions?.length??null,
        manuallyAdded:(a.missed||[]).length,
      },
      undoAvailable:(ui.correctionUndo||[]).length,
      confirmed:!!tm.confirmedAtMs,
    };
  }
  globalThis.MeritOperatorReport=()=>{const e=activeEvent();return e?operatorReport(e):null;};
  function operatorReportHTML(event){
    const r=operatorReport(event);
    if(!r)return`<p class="op-report-empty">${t("op.noSession")}</p>`;
    const row=(k,v)=>`<tr><th>${esc(t(k))}</th><td>${v==null?"—":esc(String(v))}</td></tr>`;
    const T=r.timings,A=r.actions,P=r.plan_state;
    return`<table class="op-report">`
      +row("op.plan",r.plan)
      +row("op.importToConfirm",T.importToConfirmS!=null?`${T.importToConfirmS} s`:null)
      +row("op.analysisTime",T.analysisS!=null?`${T.analysisS} s`:null)
      +row("op.reviewTime",T.reviewS!=null?`${T.reviewS} s`:null)
      +row("op.toFirstAction",T.toFirstActionS!=null?`${T.toFirstActionS} s`:null)
      +row("op.actions",A.total)
      +row("op.onQueue",`${A.onQueue} / ${A.onQueue+A.offQueue}`)
      +row("op.startedAtTop",A.startedAtTopOfQueue==null?null:t(A.startedAtTopOfQueue?"op.yes":"op.no"))
      +row("op.objects",P.objectsDetected)
      +row("op.unreviewed",P.stillUnreviewed)
      +row("op.heldBack",P.heldBack)
      +row("op.reviewLeft",P.reviewItemsLeft)
      +row("op.disagreements",P.openDisagreements)
      +row("op.manuallyAdded",P.manuallyAdded)
      +row("op.confirmed",t(r.confirmed?"op.yes":"op.no"))
      +`</table>`
      // The questions only a person can answer. Printed with the numbers so the
      // whole thing is one page to fill in and send back.
      +`<strong class="op-report-h">${t("op.questions")}</strong><ol class="op-report-q">`
      +["understood","obviouslyWrong","missedSomething","unnecessary","teachAI","explainUseful","slow","confusing"]
        .map(k=>`<li>${esc(t("op.q."+k))}</li>`).join("")
      +`</ol>`;
  }

  // ---- the visual second opinion -------------------------------------------
  //
  // The learned encoder answers "does this crop look like the things we know
  // are real on this plan?" — a question the classical pipeline never asks,
  // because every stage of it reasons about geometry, size families and
  // adjacency instead of appearance.
  //
  // IT NEVER DELETES A CANDIDATE. That is measured, not cautious:
  // benchmarks/embedding/measure-separation.mjs simulated six suppression
  // rules against ground truth on the renderings where the detector invents
  // most, and every rule that removed a meaningful number of false tables also
  // removed real ones on at least one rendering. On `jpeg-q20` the channel
  // inverts outright — real tables score BELOW invented ones — so a rule tuned
  // on the others deletes real furniture there. A missed table costs an
  // operator more than an extra one they can reject in a click, so detector
  // fusion did not earn promotion and is not wired. The opinion is recorded as
  // evidence for the review queue and the contradiction engine to weigh.
  //
  // REFERENCES ARE TIERED and the tier travels with every answer, because
  // where the references came from is the whole question (§13). A plan on
  // which nobody has decided anything yet can only compare against the
  // detector's own better-corroborated guesses, and it says exactly that
  // rather than presenting the result as verified knowledge.
  const VISUAL_REF_MIN_AGREEMENT=.6,VISUAL_REF_MIN_CONFIDENCE=.6;
  function visualClassOf(c){return c.kind==="table"?"table":`${c.kind}:${c.type||"other"}`;}
  function buildVisualReferences(candidates,memoryByCandidate,seatVectors){
    const refs=[],qualifiedTables=new Set();
    for(const c of candidates){
      const vector=c.visualDescriptor?.vector;
      if(!vector||c.status==="rejected")continue;
      const m=memoryByCandidate.get(c.id);
      let tier=null;
      if(m){
        if(m.status==="rejected")continue; // a human said this is not an object; it is not a reference for anything
        tier=(m.status==="confirmed"||m.manual)?"verified":"memory";
      }else{
        // The detector's own guess, admitted only when a DIFFERENT stage of
        // the pipeline corroborates it: seats found by the chair pass, or a
        // repeated size family. A candidate whose only support is the same
        // reasoning we are about to second-guess is not a reference.
        const corroborated=c.kind==="table"
          ?(c.chairDetections?.length||0)>0&&(c.evidence?.sizeAgreement||0)>=VISUAL_REF_MIN_AGREEMENT
          :(c.confidence||0)>=VISUAL_REF_MIN_CONFIDENCE;
        if(corroborated)tier="provisional";
      }
      if(!tier)continue;
      refs.push({id:c.id,tier,vector,cls:visualClassOf(c)});
      if(c.kind==="table")qualifiedTables.add(c.id);
    }
    // A seat is a reference only if the table it was attached to is one. A
    // ring of marks around an invented table teaches nothing about chairs.
    for(const[chairId,rec]of seatVectors||[]){
      if(!qualifiedTables.has(rec.tableId))continue;
      refs.push({id:chairId,tier:"provisional",vector:rec.vector,cls:"venue:chair"});
    }
    return refs;
  }
  function applyVisualSecondOpinion(candidates,memoryByCandidate,seatVectors){
    const api=globalThis.MeritVisualSecondOpinion;
    if(!api?.build)return{available:false,reason:"visual second opinion module not loaded"};
    const refs=buildVisualReferences(candidates,memoryByCandidate,seatVectors);
    const library=api.build(refs);
    if(!library.referenceCount)
      return{available:false,reason:`no class reached ${api.minReferencesPerClass} trusted references`,
        referencesConsidered:refs.length};
    const answers=library.assessMany(candidates.map(c=>({
      id:c.id,vector:c.visualDescriptor?.vector||null,cvClass:visualClassOf(c)})));
    const agreement={agree:0,disagree:0},strength={strong:0,moderate:0,weak:0,unknown:0};
    let assessed=0;
    answers.forEach((a,i)=>{
      if(!a){delete candidates[i].visualEvidence;return;}
      candidates[i].visualEvidence=a;assessed++;
      agreement[a.agreement]=(agreement[a.agreement]||0)+1;
      strength[a.strength]=(strength[a.strength]||0)+1;
    });
    return{available:true,references:library.referenceCount,classes:library.classes,
      tiers:library.tiers,bestTier:library.bestTier,assessed,agreement,strength,
      // Recorded so nothing downstream can quietly start treating this as a
      // filter. Suppression was measured and refused.
      role:"evidence-only",suppresses:false};
  }
  // ---- False-positive filtering, real evidence rather than a raised
  // threshold: capacity text ("114 pax seating"), dimension labels, and other
  // printed annotations get picked up by the classical binarization pass the
  // same as real furniture. Real OCR word boxes (from the same canvas the
  // detector ran on, so same pixel space) tell candidates and printed text
  // apart directly — a candidate whose area is dominated by recognized text
  // is dropped outright, UNLESS it has real seat adjacency (nearby chair
  // detections), which is strong counter-evidence it's an actual table.
  function suppressTextFalsePositives(candidates,words,width,height){
    const wordBoxesPct=(words||[]).filter(w=>w.text?.trim().length&&w.bbox).map(w=>({
      x:w.bbox.x0/width*100,y:w.bbox.y0/height*100,
      w:(w.bbox.x1-w.bbox.x0)/width*100,h:(w.bbox.y1-w.bbox.y0)/height*100,
    }));
    if(!wordBoxesPct.length)return{kept:candidates,removedCount:0,removed:[]};
    const overlapArea=(a,b)=>{
      const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y),x2=Math.min(a.x+a.w,b.x+b.w),y2=Math.min(a.y+a.h,b.y+b.h);
      return Math.max(0,x2-x1)*Math.max(0,y2-y1);
    };
    // What it removed, not only how many. A candidate deleted here is not
    // thereby proved to be text: measured on the Golden Plan, four junk tokens
    // ("EE", "N", "L", "NR") cover 82.7% of the drawing's real stage band and
    // delete it. The stage-label pass reads the drawing's own word for an
    // object from its own crop, and it cannot look at geometry that has already
    // been thrown away. Nothing comes back unless the drawing names it.
    const kept=[],removed=[];let removedCount=0;
    for(const c of candidates){
      const cArea=Math.max(.0001,c.w*c.h);
      let textArea=0;for(const wb of wordBoxesPct)textArea+=overlapArea(c,wb);
      const overlapRatio=Math.min(1,textArea/cArea),hasChairs=(c.chairDetections?.length||0)>0;
      // "It has chairs at it, so it is a real table and not printed text" is a
      // good exemption on a plan that draws chairs. On a plan whose tables are
      // numbered symbols it is unavailable BY CONSTRUCTION — no table there
      // has a chair — and this rule then deleted 117 of ORNEK's 132 tables,
      // because a table on that plan is a circle with a printed number inside
      // it and OCR of a photographed printout throws big, sloppy word boxes
      // across whole rows of them.
      //
      // It only ever happened with OCR running, so the benchmark never saw it:
      // this sandbox has no network, the CDN build silently has no OCR, and
      // the offline package — the one that actually ships with Tesseract —
      // was the broken one.
      //
      // A candidate that is one of a hundred-odd identical, regularly spaced
      // symbols is not printed text, whatever overlaps it. The evidence that
      // made it a table is the same evidence that protects it here.
      const isSymbol=c.symbolFamily===true;
      // And a column is not printed text either, for the same reason and by the
      // same argument. The column pass admits an object only on STRUCTURAL
      // evidence: repeated, compact, seatless, made of no table material, and
      // standing on a grid that is aligned in TWO directions. A word is aligned
      // in one. So the evidence that made it a column is precisely the evidence
      // that rules out text, and letting an overlapping word delete it throws
      // away the stronger finding for the weaker one.
      //
      // Measured on the adversarial architecture fixture with OCR live: without
      // this, 3 of its 6 exact columns were removed and the survivors were left
      // on a single axis -- the detector's own answer reduced to the very shape
      // it exists to reject. This exemption can only ever KEEP an object, so it
      // cannot move a table or chair number on either real plan.
      const isStructural=c.kind==="venue"&&c.type==="column";
      // AND A MEMBER OF AN ADMITTED SEAT FAMILY IS NOT PRINTED TEXT EITHER,
      // for the third time and by the same argument.
      //
      // The two exemptions above were written when a plan was one thing or the
      // other: a symbolic sheet has symbols and columns, a drawn sheet has
      // tables with chairs at them. A sheet that is symbolic in one hall and
      // drawn in another has a third kind of object — a DRAWN SEAT standing on
      // its own, because its table was not detected — and it qualifies for
      // none of them. `hasChairs` is false (a chair has no chairs),
      // `symbolFamily` is false (it is a real seat, not a symbol) and it is
      // not a column. So the text filter deleted every one of them.
      //
      // Measured on `a9-mixed-representation`, and only on CI, because this
      // sandbox has no network and Tesseract loads from a CDN: identical to
      // the local run through the whole detector — `keptDrawnSeats: 24` — and
      // then 0 chair objects in the result. The one environment where OCR
      // actually runs is the one where the whole terrace disappears.
      //
      // The exemption is the family's own admission evidence, which is
      // precisely the evidence a run of glyphs cannot produce: four or more
      // members at ONE repeated size and ONE repeated shape, at least 70% of
      // them against a surface broad enough to be a table, and standing clear
      // of the plan's primary family. `plan-detection-classical.js` says it
      // where the family is admitted — "a run of printed glyphs still fails,
      // now for the reason it should: it never becomes a family".
      //
      // Deliberately NOT extended to the primary family. An unassociated
      // primary-family chair really can be an OCR'd glyph — that is the
      // `a5-architecture-only` phantom-chair case — and it has no adjacency
      // evidence behind it. Like the column exemption, this can only ever KEEP
      // an object, and it is inert on a plan with no admitted second family,
      // so neither real plan can move on it.
      const isDrawnSeat=c.kind==="venue"&&c.type==="chair"
        &&!!c.seatFamily&&c.seatFamily!=="primary";
      if(overlapRatio>.4&&!hasChairs&&!isSymbol&&!isStructural&&!isDrawnSeat){removedCount++;removed.push(c);}else{kept.push(c);}
    }
    return{kept,removedCount,removed};
  }
  // ---- naming an object from the word the drawing prints on it -------------
  //
  // Phase 6 stopped typing a venue object `stage` from its aspect ratio.
  // Measured across both real plans that rule named 8 objects and 6 of them
  // were wrong, with the 2 right ones sitting inside the range of the 6 wrong
  // ones — no threshold could separate them. Removing it cost the Golden Plan
  // its one real stage, and that cost was recorded rather than hidden.
  //
  // This is the corroboration that replaces the guess: the drawing's own word.
  // It needs no threshold at all, because it is not a measurement of shape —
  // either the label is printed on the object or it is not.
  //
  // Why it needs a crop rather than the full-page OCR already in hand: the
  // full-page pass runs on a canvas capped at 1920 and, on the Golden Plan,
  // returns 53 tokens of noise with no SAHNE among them. The same engine on a
  // crop of that one band reads SAHNE at confidence 96. The detector already
  // knows where its objects are; that is the whole advantage being used here.
  //
  // Measured over every band-shaped object on both real plans:
  //
  //   merit-real-venue  annotated stage            SAHNE, confidence 96
  //                     annotated stage extension  nothing  (unlabelled)
  //                     other shape-only band      nothing
  //   ornek-symbolic    all six bands              nothing
  //
  // 1 of 2 real stages, 0 of 7 everything else. The ORNEK result is the strong
  // half: those crops are NOT unreadable — they return "SILA 29.08.2026",
  // "Haluk Elver Salonu 1/2/3", "SALON 1166 * 12:1992 PAX". OCR worked on them
  // and they simply are not stages. A silent engine would prove nothing; a
  // talking engine that never says "stage" proves the rule.
  //
  // The unlabelled stage extension stays UNKNOWN. That is the honest outcome
  // and the point of the design: an object is named when the drawing names it,
  // and otherwise it keeps its geometry and loses only its label.
  const LABELLED_VENUE_TYPES=[
    {type:"stage",vocabulary:["SAHNE","STAGE","PODYUM","PLATFORM","SCENE","BUHNE"]},
  ];
  // OCR of a crop costs a full engine round-trip, so the pass is bounded. Bands
  // are the only shape a stage is ever drawn as, and a plan with dozens of them
  // is a plan whose bands mean something else.
  const MAX_LABEL_CANDIDATES=14;
  async function identifyLabelledVenueObjects(event,suppressedByText){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritLabelOCR||typeof globalThis.runPlanOCR!=="function")return;
    if(!analysis.ocr?.available)return;
    const src=event.background?.src;
    if(!src)return;
    // Only objects nothing else has explained: shape-only venue proposals, plus
    // geometry text suppression removed. The second half is what makes this
    // work at all on the Golden Plan, where the stage is deleted before it can
    // be named — by four junk tokens covering 82.7% of it.
    const shapeOnly=(analysis.candidates||[]).filter(c=>c.kind==="venue"&&c.typeBasis==="aspectRatio");
    const pool=[...shapeOnly.map(c=>({box:c,fromSuppressed:false})),
      ...(suppressedByText||[]).map(c=>({box:c,fromSuppressed:true}))]
      .filter(e=>{
        const aspect=Math.max(e.box.w,e.box.h)/Math.max(.0001,Math.min(e.box.w,e.box.h));
        return aspect>=2;
      })
      .sort((a,b)=>(b.box.w*b.box.h)-(a.box.w*a.box.h))
      .slice(0,MAX_LABEL_CANDIDATES);
    if(!pool.length)return;
    let image;
    try{
      image=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});
    }catch{return;}
    const identified=[],attempts=[];
    for(const entry of pool){
      for(const spec of LABELLED_VENUE_TYPES){
        let reading;
        try{
          reading=await globalThis.MeritLabelOCR.readLabel(globalThis.runPlanOCR,image,entry.box,spec.vocabulary,{timeoutMs:20000});
        }catch{continue;}
        attempts.push({type:spec.type,found:reading.found,confidence:reading.confidence,
          fromSuppressed:entry.fromSuppressed});
        if(!reading.found)continue;
        // The drawing named it. A suppressed object comes back ONLY here, and
        // only as the thing the drawing called it.
        const existing=entry.fromSuppressed?null:entry.box;
        const obj=existing||{...entry.box,id:uid("candidate"),kind:"venue",
          status:"unreviewed",selected:false,chairDetections:[]};
        obj.kind="venue";
        obj.type=spec.type;
        obj.typeBasis="printedLabel";
        obj.labelRead={term:reading.term,confidence:reading.confidence,variant:reading.variant,
          source:"OCR of this object's own crop"};
        obj.evidence={...(obj.evidence||{}),
          basis:`the drawing prints "${reading.term}" on this object`};
        if(!existing)analysis.candidates.push(obj);
        identified.push({type:spec.type,term:reading.term,confidence:reading.confidence,
          recoveredFromTextSuppression:entry.fromSuppressed});
        break;
      }
    }
    analysis.diagnostics.labelledVenueObjects={examined:pool.length,identified,attempts:attempts.length};
    if(identified.length)analysis.planIntelligence=buildPlanIntelligence(event,analysis.ocrText??null);
  }
  // ---- two tables cannot stand in one place -----------------------------------
  //
  // Physical tables do not overlap. When two offered tables cover the same
  // floor — a quarter of the smaller one's box or more — one of them is not a
  // table, and the weaker is held back for a person (lowEvidence
  // "overlapsAnotherTable"), never deleted: the piece a blob split produced
  // before a whole one, the lower confidence before the higher. Measured on the
  // Golden Plan: an armchair and half of the table beside it, split out of one
  // blob as a "rectangle table", overlapping that real table by a third.
  // Tables that merely touch (a joined group) overlap by a line, not a quarter.
  function holdBackOverlappingTables(candidates){
    const tables=(candidates||[]).filter(c=>c.kind==="table"&&!c.lowEvidence&&c.selected!==false);
    const inter=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    let held=0;
    for(let i=0;i<tables.length;i++)for(let j=i+1;j<tables.length;j++){
      const a=tables[i],b=tables[j];
      if(a.lowEvidence||b.lowEvidence)continue;
      const share=inter(a,b)/Math.max(1e-9,Math.min(a.w*a.h,b.w*b.h));
      if(share<.25)continue;
      const aSplit=!!a.evidence?.split,bSplit=!!b.evidence?.split;
      const weaker=aSplit!==bSplit?(aSplit?a:b):((a.confidence||0)<=(b.confidence||0)?a:b),stronger=weaker===a?b:a;
      weaker.lowEvidence={reason:"overlapsAnotherTable",with:stronger.id,share:+share.toFixed(2)};
      weaker.selected=false;
      held++;
    }
    // The seats the held-back reading had claimed are still seats. Each goes to
    // the offered table it stands against (the nearest within one chair of its
    // edge), which is where association would have put it without the split;
    // a seat with no such table stays with the held-back reading.
    const offered=(candidates||[]).filter(c=>c.kind==="table"&&!c.lowEvidence&&c.selected!==false);
    const gap=(ch,t)=>Math.max(0,t.x-ch.x,ch.x-(t.x+t.w))+Math.max(0,t.y-ch.y,ch.y-(t.y+t.h));
    let moved=0;
    for(const c of candidates||[]){
      if(c.lowEvidence?.reason!=="overlapsAnotherTable"||!c.chairDetections?.length)continue;
      const keep=[];
      for(const ch of c.chairDetections){
        let best=null,bd=Infinity;
        for(const t of offered){const g=gap(ch,t);if(g<bd){bd=g;best=t;}}
        if(best&&bd<=Math.max(ch.w,ch.h)){
          ch.relation={...(ch.relation||{}),reason:"reassignedFromOverlappingReading",from:c.id};
          (best.chairDetections||(best.chairDetections=[])).push(ch);moved++;
        }else keep.push(ch);
      }
      c.chairDetections=keep;
    }
    return {held,seatsMoved:moved};
  }
  // ---- venue elements the drawing names (src/plan-venue-elements.js) -------
  //
  // SAHNE, BAR, GİRİŞ, ÇIKIŞ printed on the plan become a stage, a bar, an
  // entrance, an exit — offered, because the drawing said so. The extent is the
  // closed area the word sits in when there is one, and the word's own box
  // (geometryBasis "label") when there is not. Readings come from the OCR model
  // (score >= 0.9) and from Tesseract's full-page words (confidence >= 90), each
  // against its own floor — never one scale read as the other.
  //
  // A place a person already ruled on (a candidate from plan memory, or one an
  // operator drew) is left alone: an element is never offered over a decision.
  function placeNamedVenueElements(event,raster,ocrResult){
    const analysis=event?.analysis,VE=globalThis.MeritVenueElements;
    if(!analysis||!VE||!raster)return;
    const W=raster.width,H=raster.height,items=[];
    const om=analysis.ocrModel;
    if(om&&om.available&&om.imageSize){
      const sx=W/om.imageSize.width,sy=H/om.imageSize.height;
      for(const it of om.items||[])items.push({text:it.text,score:it.score,engine:om.provider?.id||"ocr-model",
        box:{x0:it.box.x0*sx,y0:it.box.y0*sy,x1:it.box.x1*sx,y1:it.box.y1*sy}});
    }
    const anchors=VE.anchorsFrom(items,0.9);
    if(ocrResult?.available)for(const w of ocrResult.words||[]){
      if(!w.bbox||!(w.confidence>=90))continue;
      for(const a of VE.anchorsFrom([{text:w.text,score:1,box:w.bbox}],1))anchors.push({...a,score:w.confidence/100,engine:"tesseract.js"});
    }
    const plans=VE.elementsFrom(raster,anchors,analysis.candidates);
    const decided=(analysis.candidates||[]).filter(c=>c.fromMemory||c.missed||c.status!=="unreviewed");
    const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
    const placed=[];
    for(const p of plans){
      if(!p.keepId&&decided.some(c=>overlaps(c,p.box)))continue;
      const read={term:p.anchor.term,confidence:Math.round(p.anchor.score*100),source:"OCR of the whole plan",engine:p.anchor.engine||null};
      const geometry={x:p.box.x,y:p.box.y,w:p.box.w,h:p.box.h,rotation:0};
      let obj=p.keepId?analysis.candidates.find(c=>c.id===p.keepId):null;
      if(obj)Object.assign(obj,geometry);
      else{obj={id:uid("candidate"),kind:"venue",...geometry,confidence:p.anchor.score,status:"unreviewed",chairDetections:[]};analysis.candidates.push(obj);}
      obj.type=p.type;obj.typeBasis="printedLabel";obj.geometryBasis=p.geometryBasis;obj.selected=true;
      obj.labelRead=obj.labelRead||read;obj.labelReadWhole=read;
      obj.evidence={...(obj.evidence||{}),source:obj.evidence?.source||"venue-label",
        basis:`the drawing prints "${p.anchor.term}" here`,
        extent:p.geometryBasis==="region"?"the closed area the label sits in"+(p.mergeIds.length||p.keepId?", joined with the parts of it already found":""):"not measured: the label's own box"};
      if(p.mergeIds.length){const drop=new Set(p.mergeIds);analysis.candidates=analysis.candidates.filter(c=>!drop.has(c.id));}
      placed.push({type:p.type,term:p.anchor.term,geometryBasis:p.geometryBasis,joined:p.mergeIds.length+(p.keepId?1:0)});
    }
    // Families the drawing repeats: columns threaded on its walls, and the row
    // of loca cells a printed loca title labels. A shape-only proposal the
    // detector already made at the same place is that element (kept, retyped),
    // never a second object beside it.
    const share=(a,b)=>{const ix=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)),iy=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return ix*iy/Math.max(1e-9,Math.min(a.w*a.h,b.w*b.h));};
    const claimed=new Set();
    const offerFamilyMember=(type,box,fields)=>{
      const geometry={x:box.x,y:box.y,w:box.w,h:box.h,rotation:0};
      let obj=(analysis.candidates||[]).find(c=>c.kind==="venue"&&c.status==="unreviewed"&&!c.fromMemory&&!c.missed&&c.typeBasis!=="printedLabel"&&!claimed.has(c.id)&&share(c,geometry)>=.5);
      if(!obj&&decided.some(c=>overlaps(c,geometry)))return false;
      const reused=!!obj;
      if(!obj){obj={id:uid("candidate"),kind:"venue",status:"unreviewed",chairDetections:[]};analysis.candidates.push(obj);}
      claimed.add(obj.id);placedIds.add(obj.id);
      // An object the detector had already named THIS type keeps its own
      // reasoning (a column the grid pass admitted says why); the family's
      // evidence is added beside it, never written over it.
      const keepOwn=reused&&obj.type===type&&obj.evidence;
      const{evidence,...rest}=fields;
      Object.assign(obj,geometry,{type,selected:true,geometryBasis:"region"},rest);
      obj.evidence=keepOwn?{...obj.evidence,also:evidence}:evidence;
      return true;
    };
    const placedIds=new Set(plans.map(p=>p.keepId).filter(Boolean));
    for(const c of analysis.candidates)if(c.typeBasis==="printedLabel"&&c.labelReadWhole)placedIds.add(c.id);
    let columns=0,locas=0;
    for(const m of VE.columnFamilies(raster,analysis.candidates))
      if(offerFamilyMember("column",m.box,{confidence:m.wall,typeBasis:"wallFamily",
        evidence:{source:"column-family",basis:`one of ${m.familySize} identical solid blocks set into the walls`,wallThrough:m.wall,extent:"the block's own filled area"}}))columns++;
    for(const m of VE.locaRows(raster,anchors))
      if(offerFamilyMember("loca",m.box,{confidence:m.titleScore,typeBasis:"printedTitle",seatsUnknown:true,
        evidence:{source:"loca-row",basis:`one of ${m.rowSize} like cells in the row the drawing titles "${m.title}"`,extent:"the cell's own closed area",seats:"not printed per cell"}}))locas++;
    // Banquettes: long benches in the seats' own measured colour, against an
    // offered table. Seat count unknown, and said so (UNVERIFIED_SEATING).
    const offeredTables=analysis.candidates.filter(c=>c.kind==="table"&&c.status!=="rejected"&&c.selected!==false);
    const seatsSeen=offeredTables.flatMap(c=>(c.chairDetections||[]).map(ch=>({x:ch.x,y:ch.y,w:ch.w,h:ch.h})));
    const bench=VE.banquettes(raster,seatsSeen,offeredTables);
    let benches=0;
    for(const m of bench.found)
      if(offerFamilyMember("banquette",m.box,{confidence:null,typeBasis:"seatColourBench",seatsUnknown:true,
        evidence:{source:"seat-colour-bench",basis:"a solid bench in the seats' own colour, standing against a table",lengthInChairs:m.lengthInChairs,againstTables:m.againstTables,extent:"the bench's own filled area",seats:"not drawn: no divisions to count"}}))benches++;
    // These elements were placed AFTER plan memory ran, at their own
    // geometry: a decision a person made about one of them on an earlier run
    // is found again here, by the same identity rules, and stands.
    const fresh=analysis.candidates.filter(c=>placedIds.has(c.id)&&!c.fromMemory);
    const remembered=fresh.length&&(event.planMemory||[]).length?applyPlanMemory(fresh,event.planMemory).reappliedCount:0;
    analysis.diagnostics.namedVenueElements={anchors:anchors.length,placed,columns,locas,banquettes:benches,seatColour:bench.seatColour,memoryReapplied:remembered};
  }
  // ---- which way each chair faces, from its own stencil ---------------------
  //
  // src/plan-chair-facing.js reads a family's backrest off its averaged
  // stencil. That is now the ONLY way a facing is stated: the per-chair
  // ink-centroid rule it replaces was measured at 13 right of 19 stated on the
  // Golden Plan, below what a stated direction must be, so a chair the stencil
  // reading cannot settle says so (facingKnown false) instead.
  function readChairFacing(event,raster){
    const analysis=event?.analysis,F=globalThis.MeritChairFacing;
    if(!analysis||!F||!raster)return;
    const W=raster.width,H=raster.height,chairs=[],byId=new Map();
    for(const c of analysis.candidates||[]){
      if(c.kind!=="table")continue;
      for(const ch of c.chairDetections||[]){
        chairs.push({id:ch.id,cx:ch.x/100*W,cy:ch.y/100*H,w:ch.w/100*W,h:ch.h/100*H,rotation:ch.rotation||0});
        byId.set(ch.id,ch);
      }
    }
    const read=F.readFacing(raster,chairs);
    for(const [id,ch] of byId){
      const rel=ch.relation||(ch.relation={}),o=rel.orientation||(rel.orientation={});
      const f=read.byId.get(id);
      if(f){o.facingKnown=true;o.facingAngle=f.facingAngle;o.facingEvidence=f.evidence;o.facingStencil={family:f.family,map:f.map,margin:f.margin};}
      else{o.facingKnown=false;o.facingAngle=null;o.facingEvidence="stencilNotRead";delete o.facingStencil;}
    }
    analysis.diagnostics.chairFacing={chairs:chairs.length,stated:read.byId.size,families:read.families};
  }
  // ---- the number printed inside each table symbol -------------------------
  //
  // Only for plans whose tables ARE numbered symbols. That is not a guess: the
  // representation decision has already established it, and each promoted table
  // carries `symbolFamily`. On a plan that draws furniture the tables are
  // identified by where they sit, the symbols carry no printed number, and this
  // pass would spend engine time to read nothing — so it does not run.
  //
  // The cost is real and worth stating: 163 symbols at two crops each is about
  // 9 seconds on top of detection. See src/plan-table-numbers.js for why two
  // crops rather than one, and why a montage was measured and abandoned.
  // One plan-wide read by the OCR model, stored with the analysis: the
  // provider that ran (or why none did), its timings, and every line it read
  // with its box in SOURCE pixels and its own score.
  async function readPlanTextWithModel(event,progress={from:24,span:6}){
    const M=globalThis.MeritPaddleOCR,src=event.background?.src;
    if(!M||!src)return{available:false,reasonCode:"ENGINE_NOT_LOADED",reason:"OCR model provider not present"};
    let image;
    try{image=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});}
    catch{return{available:false,reasonCode:"FAILED",reason:"plan image did not decode"};}
    const r=await M.readPlanText(image,{timeoutMs:120000,onProgress:p=>{ui.analysisProgress=progress.from+Math.round(p*progress.span);}});
    return r.available?{available:true,provider:r.provider,ms:r.ms,imageSize:r.imageSize,items:r.items}
      :{available:false,provider:r.provider||null,reasonCode:r.reasonCode||"FAILED",reason:r.reason||null};
  }
  async function readPrintedTableNumbers(event){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritTableNumbers||!globalThis.MeritLabelOCR)return;
    if(typeof globalThis.runPlanOCR!=="function"||!(analysis.ocr?.available||analysis.ocrModel?.available))return;
    const src=event.background?.src;
    if(!src)return;
    const numbered=(analysis.candidates||[]).filter(c=>c.kind==="table"&&c.symbolFamily===true);
    if(!numbered.length)return;
    let image;
    try{
      image=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});
    }catch{return;}
    const startedAt=Date.now();
    let read;
    try{
      // The number is read INSIDE the ring: where a symbol's drawn edge was
      // measured out to its ring (geometryRefined), the views still look at
      // the fill the detector found — the box they were designed and measured
      // around — never at the ring itself.
      const insideRing=numbered.map(c=>c.geometryRefined?{...c,...c.geometryRefined.from}:c);
      // The model's reading of each symbol, from its plan-wide read: the text
      // whose centre lies in the table's own box, in reading order.
      const om=analysis.ocrModel,modelReadings=new Map();
      if(om&&om.available&&globalThis.MeritPaddleOCR){
        const SW=om.imageSize.width,SH=om.imageSize.height;
        for(const table of insideRing){
          const r=globalThis.MeritPaddleOCR.numberInBox(om.items,{cx:(table.x+table.w/2)/100*SW,cy:(table.y+table.h/2)/100*SH,w:table.w/100*SW,h:table.h/100*SH});
          if(r)modelReadings.set(table.id,{...r,provider:om.provider.id});
        }
      }
      read=await globalThis.MeritTableNumbers.readTableNumbers(globalThis.runPlanOCR,globalThis.MeritLabelOCR,image,insideRing,{
        modelReadings,
        onProgress:(done,total)=>{
          ui.analysisProgress=84+Math.round((done/Math.max(1,total))*10);
        },
      });
    }catch{return;}
    for(const table of numbered){
      const r=read.byId.get(table.id);
      if(!r)continue;
      // The reading travels WITH its evidence. A downstream layer that wants to
      // know whether a number can be trusted must not have to guess.
      table.printedNumber={
        value:r.value,state:r.state,confidence:r.confidence??null,
        suggestion:r.suggestion??null,why:r.why,
        readings:r.readings,source:"OCR of this table's own symbol",
      };
    }
    analysis.diagnostics.printedTableNumbers={
      examined:numbered.length,...read.counts,views:read.views,ms:Date.now()-startedAt,
    };
    analysis.planIntelligence=buildPlanIntelligence(event,analysis.ocrText??null);
    checkNumberIntegrity(event);
  }
  // ---- is the numbering intact? --------------------------------------------
  //
  // A separate layer over the numbers, because reading a symbol and trusting a
  // numbering are different jobs: only the whole set can say whether anything
  // is claimed twice or missing. It repairs nothing — a gap between 136 and 138
  // is reported as a gap, never filled in with 137.
  //
  // What it compares against comes from the DRAWING, not from a constant. The
  // stated table count is whatever the printed capacity rule said, if OCR read
  // one; with no such figure there is simply no range to be outside of, and
  // the layer says less rather than inventing a ceiling.
  function checkNumberIntegrity(event){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritNumberIntegrity)return;
    const tables=(analysis.candidates||[]).filter(c=>c.kind==="table"&&c.printedNumber);
    if(!tables.length)return;
    const rule=analysis.planIntelligence?.capacityAudit?.rule||null;
    analysis.numberIntegrity=globalThis.MeritNumberIntegrity.analyse({
      tables,
      statedCount:rule&&typeof rule.units==="number"?rule.units:null,
      statedCountSource:rule?`the capacity rule the drawing prints (${rule.units} x ${rule.perUnit} = ${rule.total})`:null,
    });
  }
  // ---- can the plan check itself? ------------------------------------------
  //
  // Not another detector: it reads nothing, measures nothing and adds no engine
  // calls. It compares the numbers already known against each other — what the
  // drawing states, what the detector found, what the arithmetic gives, what a
  // person confirmed — and says where they agree.
  //
  // `drawsSeats` is the guard that keeps one particular false finding buried.
  // Comparing a printed pax figure against a counted seat total means something
  // on a plan that draws seats and nothing on one that does not; "2064 stated,
  // 0 counted" is a restatement of what kind of drawing it is dressed up as a
  // discovery. It was withdrawn in an earlier sprint and must not return
  // through this layer, so the representation decision gates it.
  function runSelfCheck(event){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritSelfCheck)return;
    const pi=analysis.planIntelligence||{};
    const representation=analysis.diagnostics?.representation||null;
    const drawsSeats=!!representation&&representation.kind==="PHYSICAL";
    analysis.selfCheck=globalThis.MeritSelfCheck.run({
      capacityAudit:pi.capacityAudit||null,
      tablesDetected:(analysis.candidates||[]).filter(c=>c.kind==="table"&&c.status!=="rejected").length,
      seatsCounted:pi.planSummary?.physicalSeats??null,
      drawsSeats,
      numberIntegrity:analysis.numberIntegrity||null,
    });
  }
  // ---- the confidence budget ------------------------------------------------
  //
  // Runs LAST of everything, because it consumes what every other layer
  // concluded and nothing consumes it. Counted one line per uncertain fact the
  // two real plans produce 119 and 278 items; this decides which handful of
  // them is worth an operator's attention, and reports the rest rather than
  // dropping it. See src/plan-confidence-budget.js for what the measurement
  // said and why the ranking has no tunable weights.
  function runConfidenceBudget(event){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritConfidenceBudget)return;
    const pi=analysis.planIntelligence||{};
    const alive=(analysis.candidates||[]).filter(c=>c.status!=="rejected");
    const withState=s=>alive.filter(c=>c.printedNumber&&c.printedNumber.state===s);
    const needsReview=withState("NEEDS_REVIEW"),unknown=withState("UNKNOWN");
    analysis.confidenceBudget=globalThis.MeritConfidenceBudget.run({
      reviewPriorities:pi.reviewPriorities||[],
      numbers:{needsReview:needsReview.length,needsReviewIds:needsReview.map(c=>c.id),
        unknown:unknown.length,unknownIds:unknown.map(c=>c.id)},
      numberIntegrity:analysis.numberIntegrity||null,
      selfCheck:analysis.selfCheck||null,
      teachArea:analysis.teachArea||null,
    });
  }
  // ---- the Teach Area -------------------------------------------------------
  //
  // What a person who knows the room knows, kept with the reach they gave it.
  // The engine is src/plan-teach-area.js; this is the wiring, and the wiring has
  // two jobs the module deliberately does not do for itself: decide WHERE the
  // open drawing sits, and decide what "applying" a lesson actually means.
  //
  // Nothing here trains anything. A lesson is a stored note, re-offered on a
  // drawing it applies to; teaching a hundred of them leaves the detector
  // exactly as good and exactly as bad as it was before the first one.
  const OCR_REASON_KEY={ENGINE_NOT_LOADED:"ocr.reason.ENGINE_NOT_LOADED",TIMEOUT:"ocr.reason.TIMEOUT",FAILED:"ocr.reason.FAILED"};
  function teachWhere(event){
    return{planHash:event?.analysis?.planHash??null,
      layoutId:event?.venueRef?.layoutId??null,
      layoutVersionId:event?.venueRef?.layoutVersionId??null,
      venueId:event?.venueRef?.venueId??null};
  }
  // Applied lessons are RECORDED on the object, not folded in silently: the
  // review card shows the scope and the reason, so an operator can always see
  // that a change came from a note they wrote rather than from the detector.
  // Only APPLY proposals are acted on — REVIEW and AMBIGUOUS are carried to the
  // screen for a person to settle, which is the whole difference between this
  // and spreading a correction across everything that looks similar.
  function applyTeachArea(event){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritTeachArea)return;
    const inForce=globalThis.MeritTeachArea.inForce(state.teachings||[],teachWhere(event));
    const alive=(analysis.candidates||[]).filter(c=>c.status!=="rejected");
    const result=globalThis.MeritTeachArea.propose(inForce.lessons,
      alive.map(c=>({id:c.id,kind:c.kind,type:c.type,x:c.x,y:c.y,w:c.w,h:c.h,
        vector:c.visualDescriptor?.vector||null,printedNumber:c.printedNumber||null})));
    const byId=new Map(inForce.lessons.map(l=>[l.id,l]));
    let applied=0,numbersChanged=false;
    for(const p of result.proposals){
      if(p.state!=="APPLY"||!p.candidateId)continue;
      const c=analysis.candidates.find(x=>x.id===p.candidateId),l=byId.get(p.lessonId);
      if(!c||!l)continue;
      const was={kind:c.kind,type:c.type,status:c.status,printedNumber:c.printedNumber||null};
      if(l.subject.kind==="objectIdentity"){
        if(l.subject.objectKind&&l.subject.objectKind!==c.kind){
          c.kind=l.subject.objectKind;
          if(c.kind!=="table")c.chairDetections=[];
        }
        c.type=l.subject.type;
        c.typeBasis="rememberedByAPerson";
        c.status="confirmed";c.selected=true;
      }else if(l.subject.kind==="tableNumber"&&typeof l.subject.value==="number"){
        // A person outranks two agreeing crops, so this is VERIFIED — but the
        // source says which of the two it was, because the reader of a number
        // has to be able to tell "the drawing was read twice" from "someone
        // told us".
        c.printedNumber={value:l.subject.value,state:"VERIFIED",confidence:null,
          suggestion:null,why:"a person confirmed this number",
          readings:[],source:"confirmed by a person"};
        numbersChanged=true;
      }else continue;
      c.taughtFrom={lessonId:l.id,scope:l.scope,why:p.why,at:nowISO(),was};
      applied++;
    }
    // A number a person supplied is part of the numbering, so the integrity
    // report has to be re-derived from it — otherwise the screen would show a
    // gap the operator has just filled.
    if(numbersChanged)checkNumberIntegrity(event);
    analysis.teachArea={applied,summary:result.summary,proposals:result.proposals,
      superseded:inForce.superseded,
      lessons:inForce.lessons.map(l=>({id:l.id,scope:l.scope,text:globalThis.MeritTeachArea.describe(l)})),
      statement:result.statement};
  }
  // Teaching is an explicit act with an explicit reach. The scope comes from a
  // control the operator sets, never inferred, and a refusal is shown to them
  // rather than swallowed: "not remembered, because across a venue an object has
  // to be identified by its printed number" is the message that makes them pick
  // the scope that works.
  // Confirming a table's printed number, which the Teach Area has supported
  // since it was built and nothing ever offered. It is the same lesson
  // machinery, with a `tableNumber` subject instead of an identity one -- and
  // it is the thing that unlocks venue scope, because across a venue an object
  // can only be identified by a number a person has stood behind.
  // THE SHARED BODY OF KEEPING A LESSON: build it, refuse visibly, store it,
  // audit it, say so, re-apply. `teachTableNumber` and `teachSelectedObject`
  // did these seven steps identically; what differs is passed in, never
  // defaulted (`benchmarks/CODE-INVENTORY.md` §2.1).
  //
  // `printedNumber` IS REQUIRED AND HAS NO DEFAULT. It is the one field that
  // differs for a load-bearing reason: confirming a number makes that number
  // the object's verified identity, and a venue-scoped lesson is refused for an
  // object without one. A helper that filled it in from the candidate would
  // refuse the operator's venue-scoped number confirmation by the very rule
  // they had just satisfied — `teach-venue-scope` fails on exactly that
  // mutation, while the two suites that already covered this area pass. So an
  // omitted value THROWS rather than falling back; `null` is the honest "no
  // number", `undefined` is a caller that forgot.
  function keepLesson(event,c,{scope,subject,printedNumber,auditAction,auditDetail,toastText}){
    if(!canMutate(event,"keep a lesson"))return;
    if(printedNumber===undefined)
      throw new Error("keepLesson: printedNumber must be passed explicitly — null for none, never omitted");
    const alive=(event.analysis?.candidates||[]).filter(x=>x.status!=="rejected");
    const r=globalThis.MeritTeachArea.lesson({
      scope,where:teachWhere(event),subject,
      from:{candidateId:c.id,kind:c.kind,type:c.type,
        geometry:{x:c.x,y:c.y,w:c.w,h:c.h,rotation:c.rotation||0},
        printedNumber,
        visual:c.visualDescriptor?.vector?{vector:Array.from(c.visualDescriptor.vector)}:null,
        context:globalThis.MeritPlanMemory?globalThis.MeritPlanMemory.contextSignature(c,alive):null},
    });
    if(!r.ok)return toast(t("teachArea.refused",{reason:r.reason}),"error",8000);
    state.teachings ||= [];
    state.teachings.push(r.lesson);
    saveState();
    audit(event,auditAction,{scope:r.lesson.scope,...auditDetail(r.lesson),
      text:globalThis.MeritTeachArea.describe(r.lesson)});
    toast(toastText(r.lesson),"success",6000);
    applyTeachArea(event);recomputePlanIntelligence(event);touchEvent(event);render();
  }
  function teachTableNumber(event,c,value,scope){
    if(!globalThis.MeritTeachArea||!c)return;
    const n=Number(value);
    if(!Number.isFinite(n)||n<=0||n!==Math.round(n))
      return toast(t("number.notANumber"),"error",5000);
    keepLesson(event,c,{scope,
      subject:{kind:"tableNumber",value:n},
      // The number the operator is confirming is what identifies this object
      // from here on, so it travels as the object's own printed number --
      // otherwise a venue-scoped lesson about it would be refused by the very
      // rule the operator has just satisfied.
      printedNumber:{state:"VERIFIED",value:n},
      auditAction:"TEACH_AREA_NUMBER_CONFIRMED",
      auditDetail:()=>({value:n}),
      toastText:l=>t("number.confirmedToast",{n,scope:t("teachArea.scope."+l.scope)})});
  }
  // Whether a scope can be offered at all, and why not when it cannot.
  //
  // The Teach Area refuses a venue-wide lesson about an object with no
  // confirmed number, and used to refuse it AFTER the click -- the operator
  // chose a scope, pressed the button, and was told no. The rule is knowable
  // beforehand, so it is stated beforehand, next to the option it disables.
  function scopeAvailability(c){
    const verified=c&&c.printedNumber&&c.printedNumber.state==="VERIFIED"
      &&typeof c.printedNumber.value==="number";
    return{
      plan:{ok:true},
      layout:{ok:true},
      venue:verified?{ok:true}
        :{ok:false,why:t("teachArea.venueNeedsNumber")},
    };
  }
  function teachSelectedObject(event,c,scope){
    if(!globalThis.MeritTeachArea||!c)return;
    keepLesson(event,c,{scope,
      subject:{kind:"objectIdentity",objectKind:c.kind,type:c.type,label:t("teach.type."+c.type)},
      // The object's OWN number, whatever state it is in. Passed explicitly,
      // including when it is null, because the helper refuses to guess.
      printedNumber:c.printedNumber||null,
      auditAction:"TEACH_AREA_LESSON_KEPT",
      auditDetail:l=>({subject:l.subject}),
      toastText:l=>t("teachArea.kept",{label:t("teach.type."+c.type),scope:t("teachArea.scope."+l.scope)})});
  }
  // The other half of teaching. A note a person cannot take back is not a note,
  // it is a decision made on their behalf: forgetting removes the lesson from
  // the Teach Area entirely and puts the detector's own answer back, so the
  // object is not left holding a classification with no author.
  function forgetLesson(event,c){
    if(!canMutate(event,"forget a lesson"))return;
    const id=c?.taughtFrom?.lessonId;if(!id)return;
    const scope=c.taughtFrom.scope;
    state.teachings=(state.teachings||[]).filter(l=>l.id!==id);
    // The detector's own answer back, through the same field writer as every
    // review decision (MeritReviewDecisions "forgetLesson").
    const p=globalThis.MeritReviewDecisions.plan({kind:"forgetLesson",candidateId:c.id},{candidates:[c]});
    if(p.ok)for(const w of p.writes)applyReviewWrites(c,w.set);
    else{delete c.taughtFrom;delete c.typeBasis;}
    saveState();
    audit(event,"TEACH_AREA_LESSON_FORGOTTEN",{lessonId:id});
    toast(t("teachArea.forgotten",{scope:t("teachArea.scope."+scope)}),"success",5000);
    applyTeachArea(event);recomputePlanIntelligence(event);touchEvent(event);render();
  }
  // Exposed for the regression suite. The engine (src/plan-teach-area.js) can be
  // tested on its own, but the two decisions that matter most live here: what
  // "where am I" means for the open drawing, and what applying a lesson does to
  // a candidate. Driving them directly is how the round trip — teach it, throw
  // the answer away, get it back — is checked without a 30-second detection run.
  globalThis.MeritTeachAreaWiring={teachWhere,applyTeachArea,teachSelectedObject,forgetLesson};
  // Exposed for the regression suite. This rule silently deleted 117 of
  // ORNEK's 132 tables and only did so when OCR was running, which is a
  // combination no benchmark in this repo exercises — the sandbox has no
  // network, so the CDN build has no OCR, and the offline package is built
  // rather than benchmarked. A pure function of (candidates, words) can be
  // pinned directly, and now is.
  globalThis.MeritSuppressTextFalsePositives = suppressTextFalsePositives;

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
    // What the plan's analysis was before this run. The new one REPLACES it
    // part-way through (before OCR, labels, numbers and the teach area run),
    // so a failure after that point used to leave a half-built analysis where
    // a complete one had been -- under a toast saying nothing was changed.
    const priorAnalysis=event.analysis;
    render();await yieldFrame();
    try{
      const FRAMES=globalThis.MeritPlanFrames,blob=await sourceBlob(event.background.src),bitmap=await createImageBitmap(blob),analysisFrame=FRAMES.analysisFrame(bitmap.width,bitmap.height,1920),ratio=analysisFrame.ratio,width=analysisFrame.width,height=analysisFrame.height,canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(bitmap,0,0,width,height);bitmap.close();
      ui.analysisStage=t("analysis.stage.understanding");ui.analysisProgress=22;render();await yieldFrame();
      // Deskew before anything measures a component. See estimatePlanSkew.
      //
      // Only when the evidence is real: the best angle has to beat square-on by
      // a margin, not merely tie with it. Measured, that gain is 2.03 and 2.20
      // on the two genuinely rotated variants and exactly 1.0000 on the six
      // straight renderings, so the deadband is not a close call.
      const skew=globalThis.MERIT_PLAN_DETECTION.resolve().estimatePlanSkew(canvas,width,height);
      const deskewDeg=skew.applyDeg;
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
      const pixels=dctx.getImageData(0,0,dw,dh);
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
      // classical computer vision: trainedModel stays false and the UI keeps
      // saying DOMAIN MODEL NOT INSTALLED.
      const provider=globalThis.MERIT_PLAN_DETECTION.resolve();
      // The OCR MODEL reads the plan's text FIRST (src/plan-ocr-paddle.js): its
      // lines are the one evidence the detector takes from text — what is
      // printed is not a seat (see textRegions in plan-detection-chairs.js) —
      // and the same read later feeds the capacity, label and number stages.
      // Its boxes are SOURCE pixels; the detector looks at the deskewed
      // analysis canvas, so each line's corners go through both frames.
      ui.analysisStage=t("analysis.stage.labels");render();await yieldFrame();
      const ocrModelRead=await readPlanTextWithModel(event);
      const textRegions=[];
      if(ocrModelRead.available&&ocrModelRead.imageSize){
        const sx=width/ocrModelRead.imageSize.width,sy=height/ocrModelRead.imageSize.height;
        for(const it of ocrModelRead.items||[]){
          if(!(it.score>=.9)||!String(it.text||"").trim())continue;
          const corners=[[it.box.x0,it.box.y0],[it.box.x1,it.box.y0],[it.box.x0,it.box.y1],[it.box.x1,it.box.y1]]
            .map(([x,y])=>deskew.applied?deskew.analysisToDeskew.apply(x*sx,y*sy):[x*sx,y*sy]);
          textRegions.push({x0:Math.min(...corners.map(c=>c[0])),y0:Math.min(...corners.map(c=>c[1])),
            x1:Math.max(...corners.map(c=>c[0])),y1:Math.max(...corners.map(c=>c[1]))});
        }
      }
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
      const detection=await provider.detect(pixels,dw,dh,{confidenceThreshold:calibratedThreshold,protectedRegions:deskewToPlan(protectedRegions),textRegions,onStage:async(key,progress)=>{
        ui.analysisStage=t("analysis.stage."+key);ui.analysisProgress=progress;render();await yieldFrame();
      }});
      const detectionMs=Math.round(performance.now()-detectionStartedAt);
      const candidates=detection.candidates,venues=detection.venues,threshold=detection.threshold;
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
      for(const c of candidates)c.visualDescriptor=embedder.embed(detection.gray,detection.binary,dw,dh,c);
      for(const c of venues)c.visualDescriptor=embedder.embed(detection.gray,detection.binary,dw,dh,c);
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
      for(const c of candidates)for(const ch of c.chairDetections||[]){
        const v=embedder.embed(detection.gray,detection.binary,dw,dh,
          {x:ch.x-ch.w/2,y:ch.y-ch.h/2,w:ch.w,h:ch.h});
        if(v?.vector)seatVectors.set(ch.id,{vector:v.vector,tableId:c.id});
      }
      const embeddingMs=Math.round(performance.now()-embeddingStartedAt);
      for(const c of [...candidates,...venues])planFromDeskew(c);
      // A table SYMBOL is found by the fill inside its ring; its drawn edge is
      // the ring. Measured from the pixels (src/plan-symbol-geometry.js) before
      // anything — memory included — reads the geometry. Only symbols: a table
      // with drawn chairs is measured by its own surface, and an axis-aligned
      // walk says nothing true about a rotated box.
      if(globalThis.MeritSymbolGeometry){
        const raster=ctx.getImageData(0,0,width,height);
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
      }
      detection.diagnostics.tablesHeldForOverlap=holdBackOverlappingTables(candidates);
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
      const secondOpinion=applyVisualSecondOpinion(allCandidates,memoryByCandidate,seatVectors);
      secondOpinion.ms=Math.round(performance.now()-secondOpinionStartedAt);
      // Grouping decisions are keyed by candidate id, which is regenerated on
      // every analysis pass -- remap them through the same geometry match so
      // a "these are separate tables" answer survives Re-Analyze instead of
      // silently reverting to the detector's default grouping.
      const geometryRemap=matchCandidatesByGeometry(priorCandidates,allCandidates);
      const carriedDecisions=priorDecisions.map(d=>({...d,memberIds:d.memberIds.map(id=>geometryRemap.get(id)).filter(Boolean)})).filter(d=>d.memberIds.length>=2);
      event.analysis={id:uid("analysis"),engine:"ASSISTED_DETECTION",trainedModel:false,notice:"Classical computer vision is active; no trained Merit model is installed in this browser review.",createdAt:nowISO(),imageWidth:width,imageHeight:height,originalWidth:analysisFrame.originalWidth,originalHeight:analysisFrame.originalHeight,threshold,candidates:allCandidates,missed:allCandidates.filter(c=>c.missed).map(c=>c.id),groupingDecisions:carriedDecisions,memoryReapplied:memoryResult.reappliedCount,memoryRestored:memoryResult.restored.length,memoryConflicts:memoryResult.conflicts,comparison:{added:[...newSig].filter(x=>!oldSig.has(x)).length,removed:[...oldSig].filter(x=>!newSig.has(x)).length,changed:0},diagnostics:{...detection.diagnostics,resolution:`${width}×${height}`,detectionMs,provider:provider.id,providerLabel:provider.label,
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
      let ocrResult={available:false,text:null,reason:"OCR not attempted"};
      try{ocrResult=await runPlanOCR(canvas.toDataURL("image/png"));}catch(ocrError){ocrResult={available:false,text:null,reason:ocrError.message,reasonCode:"FAILED"};}
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
      if(suppressionWords.length){
        const suppression=suppressTextFalsePositives(event.analysis.candidates,suppressionWords,width,height);
        event.analysis.candidates=suppression.kept;
        event.analysis.diagnostics.textSuppressed=suppression.removedCount;
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
      await identifyLabelledVenueObjects(event,suppressedByText);
      const planRaster=ctx.getImageData(0,0,width,height);
      placeNamedVenueElements(event,planRaster,ocrResult);
      readChairFacing(event,planRaster);
      await readPrintedTableNumbers(event);
      // The drawing's own fingerprint, so a lesson taught on it can be found
      // again after a re-import under a different filename. Failing to compute
      // it is not fatal: plan-scope lessons simply do not match, which is the
      // safe direction.
      try{event.analysis.planHash=await planHashFor(event.background.src);}catch{event.analysis.planHash=null;}
      // Before plan intelligence is rebuilt, because a lesson can move an
      // object from table to venue and the capacity, relationship and
      // consistency layers all have to see the corrected answer.
      applyTeachArea(event);
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
      runSelfCheck(event);
      // Last, and only last: it ranks what every layer above it concluded.
      runConfidenceBudget(event);
      ui.analysisStage=t("analysis.stage.review");ui.analysisProgress=100;ui.analysisBusy=false;
      event.analysis.timings={importedAtMs:event.background?.importedAtMs??null,analysisStartedAtMs,analysisCompletedAtMs:Date.now()};ui.selectedCandidateId=event.analysis.candidates[0]?.id||null;ui.difficultQuestionIndex=0;ui.activeReviewGroupId=null;ui.activeQuestionId=null;audit(event,"ASSISTED_DETECTION_COMPLETED",event.analysis.diagnostics);touchEvent(event);render();
    }catch(error){
      console.warn("Assisted Detection failed; the previous analysis is kept.",error);
      event.analysis=priorAnalysis;
      ui.analysisBusy=false;ui.analysisStage=t("analysis.stage.failed");render();toast(t("detect.failed"),"error",7000);
    }
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
  function recomputePlanIntelligence(event){event.analysis.planIntelligence=buildPlanIntelligence(event,event.analysis.ocrText??null);runSelfCheck(event);runConfidenceBudget(event);}
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
    return`<button class="candidate-box ${c.kind} ${c.status} ${selected?"selected":""} ${reviewCls}" data-candidate-box="${c.id}" style="left:${c.x}%;top:${c.y}%;width:${c.w}%;height:${c.h}%;transform:rotate(${c.rotation||0}deg)" title="${esc(c.kind)} · ${Number.isFinite(c.confidence)?Math.round(c.confidence*100)+"%":"—"}"></button>${(c.chairDetections||[]).map(ch=>`<i class="candidate-box chair ${reviewCls}" style="left:${ch.x}%;top:${ch.y}%;width:${Math.max(.5,ch.w)}%;height:${Math.max(.5,ch.h)}%;transform:translate(-50%,-50%) rotate(${ch.rotation||0}deg)"></i>`).join("")}`;
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
    activeEvent:(...a)=>activeEvent(...a),activeReviewTargetIds:(...a)=>activeReviewTargetIds(...a),applyReviewZoom:(...a)=>applyReviewZoom(...a),candidateBox:(...a)=>candidateBox(...a),esc:(...a)=>esc(...a),FLOORPLAN,icon:(...a)=>icon(...a),OCR_REASON_KEY,operatorReportHTML:(...a)=>operatorReportHTML(...a),RECLASSIFY_TAXONOMY,render:(...a)=>render(...a),reviewCandidates:(...a)=>reviewCandidates(...a),scopeAvailability:(...a)=>scopeAvailability(...a),t:(...a)=>t(...a),titleCase:(...a)=>titleCase(...a),toast:(...a)=>toast(...a),ui,unionBbox:(...a)=>unionBbox(...a),UNVERIFIED_SEATING,
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
    const familyIds=decision.kind==="reclassify"&&subject?familyCandidateIds(event,subject,subject.kind,subject.type):[];
    const p=DEC.plan({...decision,familyIds},{candidates:a.candidates,unverifiedSeating:[...UNVERIFIED_SEATING]});
    if(!p.ok)return null;
    const decisionId=uid("decision");
    const before=p.writes.map(w=>{const c=byId.get(w.id),snap={id:w.id,present:{}};
      for(const k of DEC.SNAPSHOT_FIELDS){snap.present[k]=k in c;if(k in c)snap[k]=clone(c[k]);}return snap;});
    ui.correctionUndo ||= [];
    ui.correctionUndo.push({decisionId,eventId:event.id,analysisId:a.id,kind:p.kind,label:p.kind,before,memoryBefore:clone(event.planMemory||[]),at:nowISO()});
    if(ui.correctionUndo.length>30)ui.correctionUndo.shift();
    for(const w of p.writes)applyReviewWrites(byId.get(w.id),w.set);
    for(const id of p.memory)rememberCorrection(event,byId.get(id));
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
        evidence:{what:label&&label.propagatedFrom?`spread from ${label.propagatedFrom}`:"the operator's own decision on this object"}}));
    }
    audit(event,"REVIEW_DECISION",{decisionId,kind:p.kind,targets:p.writes.map(w=>w.id),spread:p.spread,labels:p.training.length});
    if(REVIEW_OPERATOR_ACTION[p.kind])recordOperatorAction(event,REVIEW_OPERATOR_ACTION[p.kind],p.writes.map(w=>w.id));
    recomputePlanIntelligence(event);
    touchEvent(event);
    return{decisionId,affected:p.writes.length,spread:p.spread};
  }
  globalThis.decideReview=decideReview;
  function undoReviewDecision(event){
    event=event||activeEvent();
    if(!canMutate(event,"undo a plan correction"))return 0;
    const stack=ui.correctionUndo||[];
    const i=stack.map(e=>e.eventId).lastIndexOf(event.id);
    if(i<0)return 0;
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
  function commitCandidates(){
    if(!canMutate(activeEvent(),"confirm the plan"))return;
    const event=activeEvent(),chosen=event.analysis?.candidates.filter(c=>c.selected&&c.status!=="rejected")||[];if(!chosen.length)return toast(t("toast.selectDetectionFirst"),"error");
    // The same verdict runSelfCheck() already reads (analysis.diagnostics.
    // representation.kind==="PHYSICAL") -- one fact, one source. A table
    // committed off a SYMBOLIC plan (or one with no verdict at all, since
    // absence of evidence is not evidence of drawn chairs) gets
    // hasPhysicalSeats:false, so it carries NO chair objects at all --
    // not a ring of fabricated positions flagged as unreal.
    const drawsSeats=!!(event.analysis?.diagnostics?.representation?.kind==="PHYSICAL");
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
        const table=RULES().syncTableChairs({id:uid("table"),number:uniqueNumber(event,"T",1),type:["round","square","rectangle","bistro"].includes(c.type)?c.type:"rectangle",x:fp.x,y:fp.y,w:fp.w,h:fp.h,surface:fp.surface,capacity:Math.max(1,c.chairDetections?.length||(ruleUse.applies?ruleUse.perUnit:1)),zone:"MAIN FLOOR",rotation:c.rotation||0,locked:false,z:10,hasPhysicalSeats:drawsSeats||!!c.chairDetections?.length,capacitySource:c.chairDetections?.length?"DETECTED_PHYSICAL_SEATS":ruleUse.applies?"DERIVED_PRINTED_RULE":"UNKNOWN",origin:"DETECTED",printedNumber:printedEvidence(c.printedNumber),...(!c.chairDetections?.length&&ruleUse.applies?{capacityEvidence:{...ruleUse.evidence,at:nowISO()}}:{})});
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
      recordOperatorAction(event,"confirm-plan",chosen.map(c=>c.id));
      touchEvent(event);
      ui.tab="floor";
      ui.planMode="plan";
      render();
      toast(t(chairsKept?"toast.detectionsConfirmed":derived?"toast.detectionsConfirmedRule":"toast.detectionsConfirmedPlain",{tables,venues,perUnit:ruleUse.perUnit,tableWord:t(tables===1?"word.table":"word.tables"),venueWord:t(venues===1?"word.venueObject":"word.venueObjects")}),"success",6000);
  }
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
    document.querySelectorAll("[data-budget-open]").forEach(b=>b.onclick=()=>REVIEW.openReviewQueue(ev,b.dataset.budgetOpen));
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
      }else if(action==="reanalyze")runAssistedDetection();else if(action==="commit")commitCandidates();else if(action==="confirm"&&c){
        if(decideReview(event,{kind:"confirm",candidateId:c.id}))REVIEW.afterReviewDecision(event);
      }else if(action==="reject"&&c){
        if(decideReview(event,{kind:"reject",candidateId:c.id}))REVIEW.afterReviewDecision(event);
      }else if(action==="dismiss"&&c){
        // "Not important": kept in the analysis, rejected and marked dismissed --
        // never deleted -- so it can be undone and Re-Analyze does not ask again.
        if(decideReview(event,{kind:"notImportant",candidateId:c.id})){ui.selectedCandidateId=null;REVIEW.afterReviewDecision(event);}
      }else if(action==="teach"&&c){
        ui.teachScope=document.querySelector("[data-teach-scope]")?.value||"plan";
        teachSelectedObject(event,c,ui.teachScope);
      }else if(action==="confirm-number"&&c){
        const scope=document.querySelector("[data-teach-scope]")?.value||"plan";
        teachTableNumber(event,c,document.getElementById("poiNumber")?.value,scope);
      }else if(action==="forget"&&c){forgetLesson(event,c);}else if(action==="draw"){
        if(!ui.reviewDrawMode)recordOperatorAction(event,"ai-missed-open",[]);
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
      recordOperatorAction(event,`grouping-${decision}`,groups.flatMap(g=>g.memberIds||[]));
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

  // Backup/restore: a product-level export of the app's own structured
  // state, distinct from the operational XLSX workbook. Never overwrites
  // current data with a file that fails format, structure or referential
  // integrity checks -- each failure is a specific, translated toast rather
  // than a generic "invalid file".
  function buildBackupPayload(){return{format:"merit-event-maker-backup",formatVersion:1,exportedAt:nowISO(),payload:state};}
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
    state.lastBackupAt=nowISO();
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
    badDate:"import.rule.badDate",badPax:"import.rule.badPax",badAssignment:"import.rule.badAssignment",badId:"import.rule.badId"};
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
      state=next;
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
    const event=state.events.find(e=>e.id===eventId);
    const P=globalThis.MeritEventPackage;
    if(!event||!P)return;
    const venue=event.venueRef?(state.venues||[]).find(v=>v.id===event.venueRef.venueId)||null:null;
    const auditEntries=(state.audit||[]).filter(a=>a.eventId===eventId);
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
      if(parsed.venue&&!state.venues.some(v=>v.id===event.venueRef?.venueId)){
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
    if(newVenue)state.venues.push(newVenue);
    state.events.unshift(migrated);
    // Merge, never truncate. This line ran slice(0,1000) over the
    // concatenation, so importing an event whose history was larger than the
    // cap threw most of it away AND evicted the host install's own decisions
    // to make room for what survived.
    {
      const T=TRAIL();
      if(T){
        const r=T.merge(state.audit||[],auditEntries);
        state.audit=r.log;
        state.auditRetention=T.recordEviction(state.auditRetention||null,r);
      } else state.audit=[...auditEntries,...(state.audit||[])];
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
  const RECOVERY=()=>globalThis.MeritOfflineRecovery||null;
  function autoSnapshot(payload){
    const R=RECOVERY();
    if(!R||!state.events.length)return;
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
      state=parseRoot(snap.payload);
      ui.screen="events";ui.activeEventId=null;ui.undo=[];ui.redo=[];
      saveState();render();
      toast(t("recovery.restoredToast",{when:relativeTime(snap.at)}),"success");
    }).catch(error=>{console.warn("Automatic recovery restore failed.",loggableError(error));toast(t("recovery.none"),"error");});
  }
  function bindV8Common(){
    document.querySelectorAll("[data-action='create-event']").forEach(b=>b.onclick=startNewEvent);document.querySelectorAll("[data-action='help']").forEach(b=>b.onclick=openGuide);document.querySelectorAll("[data-open-event]").forEach(b=>b.onclick=()=>openEvent(b.dataset.openEvent));// Row-level open + per-row action buttons now coexist on Home, so the
// buttons must not bubble into the row's open handler.
document.querySelectorAll("[data-duplicate-event]").forEach(b=>b.onclick=e=>{
  e.stopPropagation();
  duplicateEvent(b.dataset.duplicateEvent);
});
document.querySelectorAll("[data-export-event-package]").forEach(b=>b.onclick=e=>{
  e.stopPropagation();
  exportEventPackage(b.dataset.exportEventPackage);
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
    const back=document.querySelector("[data-action='back-events']");if(back)back.onclick=()=>{ui.screen="events";ui.focusMode=false;render();};const save=document.querySelector("[data-action='save-now']");if(save)save.onclick=()=>saveState(true);const search=document.getElementById("globalGuestSearch");if(search){search.oninput=()=>renderGlobalSearch(search.value);search.onkeydown=guestSearchKey;}
    const backupExport=document.querySelector("[data-action='backup-export']");if(backupExport)backupExport.onclick=exportBackup;
    const backupImport=document.querySelector("[data-action='backup-import']");if(backupImport)backupImport.onclick=()=>document.getElementById("backupFileInput").click();
    const recoveryBtn=document.querySelector("[data-action='recovery-restore']");if(recoveryBtn)recoveryBtn.onclick=restoreLatestSnapshot;
    const backupInput=document.getElementById("backupFileInput");
    if(backupInput){const fresh=backupInput.cloneNode(true);backupInput.replaceWith(fresh);fresh.addEventListener("change",e=>{const file=e.target.files[0];if(file)importBackupFile(file);e.target.value="";});}
  }
  bindCommon = bindV8Common;
  openEvent = function(id){const event=state.events.find(e=>e.id===id);if(!event)return;ui.activeEventId=id;ui.screen="workspace";ui.tab=RULES().isHistorical(event)?"guests":"command";ui.selectedObjectId=null;ui.selectedObjectIds=[];ui.selectedGuestIds=[];ui.operationalMode=false;ui.undo=[];ui.redo=[];render();};
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
    else if(a==="backup"){exportBackup();}
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
    try{return renderScreen();}
    catch(error){renderFailure(error);}
  };
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
    if(b.dataset.renderRecover==="backup"){exportBackup();return;}
    ui.screen="events";ui.activeEventId=null;ui.selectedObjectId=null;ui.selectedObjectIds=[];render();
  });
  function renderScreen(){
    translateStaticDialogs();
    if(ui.screen==="new-event"){app.innerHTML=setupHTML();bindSetup();return;}
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
      if((ui.tab==="floor"&&!reviewing)||ui.tab==="seating"){const shown=activeEvent();requestAnimationFrame(()=>firstViewFit(shown));}
      if(reviewing&&!historical)bindReview();
      if(changesMode)bindLayoutChanges();
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
      let src,name=file.name;
      if(file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")){
        const pdf=await waitForPdf(),doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise,pageNumber=doc.numPages>1?await ask({title:t("ask.pdfPageTitle"),body:t("ask.pdfPageBody",{n:doc.numPages}),confirmLabel:t("ask.usePage"),number:{label:t("ask.pdfPageLabel"),min:1,max:doc.numPages,value:1}}):1;
        if(pageNumber===null)return;
        const page=await doc.getPage(pageNumber),v=page.getViewport({scale:2.6}),canvas=document.createElement("canvas");
        canvas.width=Math.ceil(v.width);
        canvas.height=Math.ceil(v.height);
        await page.render({canvasContext:canvas.getContext("2d"),viewport:v}).promise;
        src=canvas.toDataURL("image/png",.96);
        name=`${file.name} · page ${pageNumber}`;
      }else src=await readImageFile(file);
      recordUndo(event);
      event.background={src,name,opacity:.34,visible:true,locked:true,isDefault:false,scale:100,importedAtMs:Date.now()};
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
    if((e.key==="Delete"||e.key==="Backspace")&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){e.preventDefault();deleteSelection();return;}
    if(e.ctrlKey&&e.key.toLowerCase()==="d"){e.preventDefault();duplicateSelection();return;}
    if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){
      const event=activeEvent(),ids=ui.selectedObjectIds.length?ui.selectedObjectIds:[ui.selectedObjectId].filter(Boolean);if(!ids.length)return;e.preventDefault();const amount=e.shiftKey?10:1,dx=e.key==="ArrowLeft"?-amount:e.key==="ArrowRight"?amount:0,dy=e.key==="ArrowUp"?-amount:e.key==="ArrowDown"?amount:0;recordUndo(event);ids.forEach(id=>{const o=event.tables.find(x=>x.id===id)||event.venueObjects.find(x=>x.id===id);if(o&&!o.locked){o.x+=dx;o.y+=dy;}});touchEvent(event);render();
    }
  });

  // The very first render must wait on the async StorageProvider load --
  // every render() after this one is driven by user interaction and needs
  // nothing more than the in-memory `state` object already being current.
  loadV8Async().then(({data,recoveredAt})=>{
    // Never a silent swap: if the primary record could not be read at all
    // and an automatic snapshot stood in for it, the operator is told
    // plainly, including that it may not hold the most recent changes --
    // in a notice that stays until they put it away, not only a toast.
    if(recoveredAt)MERIT_STORAGE_NOTICE.recovered={at:recoveredAt};
    state=data;bootReady=true;render();
    if(recoveredAt)toast(t("recovery.bootRecoveredToast",{when:relativeTime(recoveredAt)}),"error",9000);
  }).catch(error=>{
    console.error("Storage load failed entirely; starting from a blank state.",loggableError(error));
    state=blankRoot();bootReady=true;render();
  });
})();