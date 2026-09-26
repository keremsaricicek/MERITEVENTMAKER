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
  const storageProvider = (() => {
    try { if (globalThis.MeritStorageProviders?.IndexedDBStorageProvider) return new MeritStorageProviders.IndexedDBStorageProvider(); }
    catch (error) { console.warn("IndexedDB provider unavailable, falling back to localStorage.", loggableError(error)); }
    return new MeritStorageProviders.LocalStorageStorageProvider(V8_STORAGE_KEY);
  })();
  globalThis.MERIT_STORAGE_STATUS = { provider: storageProvider.constructor.name };
  // Exposed so the training-data crops can be read back and exported without
  // routing image bytes through the state record. Read/write access to the
  // blob store only -- the state record still goes through saveState().
  globalThis.MERIT_STORAGE_PROVIDER = storageProvider;
  const todayKey = () => new Date().toLocaleDateString("en-CA");
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

  function blankRoot(){ return {version:8, schemaVersion:8, events:[], venues:[], verifiedExamples:[], trainingData:[], teachings:[], operatorSessions:[], analyses:[], calibration:null, audit:[], auditRetention:null, lastBackupAt:null}; }
  function isHistorical(event){ return !!event && (event.status === "Completed" || (!!event.date && event.date < todayKey())); }
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
  function canMutate(event, action="change this event"){
    if(!event) return false;
    if(isHistorical(event)){
      toast(`Historical events are read-only. You cannot ${action}.`, "error", 5200);
      return false;
    }
    return true;
  }
  function chairGeometry(table, count=Math.max(1, Number(table.capacity)||1)){
    const out=[];
    if(table.type==="round"||table.type==="bistro"){
      const rx=table.type==="bistro"?43:45, ry=table.type==="bistro"?43:46;
      for(let i=0;i<count;i++){const a=-Math.PI/2+i/count*Math.PI*2;out.push({x:50+Math.cos(a)*rx,y:50+Math.sin(a)*ry,rotation:a*180/Math.PI+90});}
    } else if(table.type==="square"){
      for(let i=0;i<count;i++){const u=i/count*4;if(u<1)out.push({x:15+u*70,y:7,rotation:0});else if(u<2)out.push({x:93,y:15+(u-1)*70,rotation:90});else if(u<3)out.push({x:85-(u-2)*70,y:93,rotation:180});else out.push({x:7,y:85-(u-3)*70,rotation:270});}
    } else {
      const top=Math.ceil(count/2),bottom=count-top;
      for(let i=0;i<top;i++)out.push({x:top===1?50:12+i*76/(top-1),y:8,rotation:0});
      for(let i=0;i<bottom;i++)out.push({x:bottom===1?50:88-i*76/(bottom-1),y:92,rotation:180});
    }
    return out;
  }
  // THREE QUANTITIES, AND THEY ARE NOT THE SAME NUMBER.
  //
  //   LOGICAL SEATS -- `table.capacity`. The assignment index space: seats
  //   0..capacity-1. Every guest assignment, seat number, report row and
  //   pax check indexes into this and nothing else. It exists whether or
  //   not anybody ever drew a chair.
  //
  //   PHYSICAL CHAIRS -- `table.chairs`. Objects with real coordinates,
  //   existing ONLY where the plan genuinely drew a chair, Assisted
  //   Detection found one, or a person placed one. When none of those
  //   happened the array is EMPTY -- not a ring of invented positions
  //   wearing a `physical:false` label.
  //
  //   OPERATIONAL CAPACITY -- see seatingCapacity() below: what the room
  //   can seat tonight, summed from logical seats.
  //
  // This function used to fabricate one chair object per capacity slot for
  // every table, symbolic or not, and mark the fake ones `physical:false`.
  // A 420-table symbolic plan therefore stored 4,200 chairs at coordinates
  // nothing had ever observed, re-derived and re-persisted on every single
  // save. A flag saying "this coordinate is not real" is not the same as
  // not writing the coordinate: the contract's rule is that no physical
  // chair is ever synthesised from a capacity number, and that is now
  // structural rather than annotated.
  //
  // `hasPhysicalSeats` decides WHETHER physical chairs exist; capacity
  // decides HOW MANY, when they do. Coordinates already on a chair survive
  // (Assisted Detection writes detected positions verbatim, and those must
  // never be regenerated into a synthetic ring) -- only the count follows
  // capacity.
  function syncTableChairs(table, count=table.capacity){
    count=Math.max(1,Math.min(99,Number(count)||1));
    table.capacity=count;
    if(table.hasPhysicalSeats===false){table.chairs=[];return table;}
    const old=Array.isArray(table.chairs)?table.chairs:[], geometry=chairGeometry({...table,capacity:count},count);
    table.chairs=geometry.map((p,index)=>({
      id:old[index]?.id||uid("chair"), parentTableId:table.id, seatNumber:index+1,
      x:Number.isFinite(old[index]?.x)?old[index].x:p.x, y:Number.isFinite(old[index]?.y)?old[index].y:p.y,
      rotation:Number.isFinite(old[index]?.rotation)?old[index].rotation:p.rotation, occupancy:null
    }));
    return table;
  }
  // The three quantities live in src/seat-model.js, which owns their
  // definitions for the shell and for every pure module. Aliased here so
  // the shell reads the same answer as everything else rather than keeping
  // a second copy of the arithmetic.
  const SEATS=()=>globalThis.MeritSeatModel;
  const logicalSeatCount=table=>SEATS().logicalSeatCount(table);
  const physicalChairCount=table=>SEATS().physicalChairCount(table);
  const canSeat=table=>SEATS().canSeat(table);
  function refreshChairOccupancy(event){
    for(const table of event.tables||[])syncTableChairs(table).chairs.forEach(chair=>chair.occupancy=null);
    // `continue`, not `return`: this used to abort the whole loop at the first
    // unassigned guest, leaving every later guest's chairs marked unoccupied.
    for(const guest of event.guests||[]){if(!guest.assignment)continue;const table=event.tables.find(t=>t.id===guest.assignment.tableId);if(!table)continue;(guest.assignment.seats||[]).forEach((seatIndex,partyIndex)=>{const chair=table.chairs[Number(seatIndex)];if(chair)chair.occupancy={guestId:guest.id,partyIndex,planned:true};});}
  }
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
    // syncTableChairs() empties `chairs` on a symbolic table and rebuilds a
    // physical table's chairs without the retired `physical` flag, so an
    // install that saved 4,200 invented chair coordinates sheds them on the
    // first load. Nothing operational rides on them: capacity, assignments
    // and seat indexes are untouched, and a physical table's real chair
    // coordinates are carried across verbatim.
    migrated.tables=(migrated.tables||[]).map(table=>syncTableChairs({...table,id:table.id||uid("table"),hasPhysicalSeats:table.hasPhysicalSeats!==false,capacitySource:globalThis.MeritCapacityProvenance.normalize(table.capacitySource)}));
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
    refreshChairOccupancy(migrated);
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
    parsed.events=(parsed.events||[]).map(migrateEvent); parsed.verifiedExamples ||= []; parsed.analyses ||= []; parsed.audit ||= [];
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
  async function loadV8Async(){
    try{
      const fromProvider=await storageProvider.load();
      if(fromProvider) return{data:parseRoot(fromProvider),recoveredAt:null};
    }catch(error){console.warn("StorageProvider load failed, checking legacy localStorage.",loggableError(error));}
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
      storageProvider.save(JSON.stringify(legacy)).catch(error=>console.warn("Could not persist migrated legacy state.",loggableError(error)));
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
        storageProvider.save(JSON.stringify(data)).catch(error=>console.warn("Could not persist auto-recovered state.",loggableError(error)));
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
  function persistPayload(payload,show){
    return storageProvider.save(payload)
      .then(()=>{if(show)toast("Saved locally in this browser.","success");autoSnapshot(payload);})
      .catch(error=>{
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
        return storageProvider.save(stripped).then(()=>toast("Event data was saved, but large images exceeded browser storage.","error",6500));
      })
      .catch(error=>{console.warn("StorageProvider save failed entirely.",loggableError(error));toast("Browser storage is full. Export the workbook before closing.","error",6500);});
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
    state.events.forEach(refreshChairOccupancy);
    let payload;
    try{payload=JSON.stringify(state);}
    catch(error){toast("Browser storage is full. Export the workbook before closing.","error",6500);return Promise.resolve();}
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

  seatPositions = function(table){syncTableChairs(table);return table.chairs.map(c=>({x:c.x,y:c.y,rotation:c.rotation,id:c.id,seatNumber:c.seatNumber}));};
  // WHAT THE ROOM CAN SEAT TONIGHT, and HOW MANY CHAIRS THE PLAN DREW --
  // two different questions, two different numbers, one definition each.
  function seatingCapacity(event){return SEATS().seatingCapacity(event);}
  function physicalCapacity(event){return SEATS().physicalCapacity(event);}
  function liveUsedIndexes(event,tableId,exceptIds=[]){
    const except=new Set(exceptIds), used=new Set();
    event.guests.forEach(g=>{if(except.has(g.id)||g.arrivalStatus==="No Show")return;if(g.assignment?.tableId===tableId)(g.assignment.seats||[]).forEach(index=>used.add(Number(index)));});
    return used;
  }
  function liveStats(event){
    let emptyTables=0,emptyChairs=0;
    // Seats free at the door, counted on the logical seat space. Reading
    // `chairs.length` here made a symbolic table report zero free seats
    // while the same table was happily accepting assignments.
    for(const table of event.tables.filter(canSeat)){
      const used=liveUsedIndexes(event,table.id); if(used.size===0)emptyTables++; emptyChairs+=Math.max(0,logicalSeatCount(table)-used.size);
    }
    const sum=status=>event.guests.filter(g=>g.arrivalStatus===status).reduce((n,g)=>n+paxOf(g),0);
    return {total:event.guests.reduce((n,g)=>n+paxOf(g),0),checked:sum("Checked In"),notArrived:sum("Not Arrived"),noShow:sum("No Show"),emptyTables,emptyChairs};
  }
  tableMatchesFilter = function(event,table){
    const used=ui.operationalMode?liveUsedIndexes(event,table.id):occupiedSeatIndexes(event,table.id);
    // Logical seats, matching the "N EMPTY" badge tableObjectHTML() draws
    // one function below -- the filter and the badge used to disagree on a
    // table whose chairs array was not its capacity.
    const empty=Math.max(0,logicalSeatCount(table)-used.size);
    if(ui.seatingFilter==="empty")return used.size===0;if(ui.seatingFilter==="available")return empty>0;if(ui.seatingFilter==="full")return empty===0;return true;
  };
  filterBannerHTML = function(){
    if(ui.operationalMode&&ui.seatingFilter==="available")return`<div class="operational-banner">${icon("chair")}<b>Live operational view:</b> red glow marks physically available chairs after No Show release.<button class="tiny-btn" data-clear-seating-filter>Clear</button></div>`;
    if(ui.seatingFilter==="all")return"";
    return`<div class="filter-banner">${icon("search")}<span>${{empty:"Showing empty tables",available:"Showing tables with available seats",full:"Showing full tables"}[ui.seatingFilter]}</span><button data-clear-seating-filter>${icon("x")}</button></div>`;
  };
  tableObjectHTML = function(event,table,seating){
    syncTableChairs(table);
    const selected=(!seating&&(ui.selectedObjectId===table.id||ui.selectedObjectIds.includes(table.id)))||(seating&&ui.selectedTableId===table.id);
    const highlighted=ui.highlightId===table.id,match=!seating||tableMatchesFilter(event,table);
    const used=seating&&ui.operationalMode?liveUsedIndexes(event,table.id):occupiedSeatIndexes(event,table.id);
    const assigned=used.size, empty=Math.max(0,table.capacity-assigned);
    // Every entry in `table.chairs` is a chair the plan really has, so all
    // of them draw. A symbolic table's ring stays silent because it has no
    // chairs to draw, not because a filter hides fabricated ones -- the
    // guard that used to stand here (`chair.physical===false?"":...`) was
    // the last consumer of a flag that only existed to disown coordinates
    // this code should never have written. Seat NUMBERS are unaffected:
    // they come from capacity, via the seat list and the S-labels in the
    // reports, not from this array.
    const chairs=table.chairs.map((chair,index)=>`<i class="chair ${used.has(index)?"occupied":seating&&ui.operationalMode?"available-live":""}" data-chair-id="${chair.id}" style="left:${chair.x}%;top:${chair.y}%;transform:translate(-50%,-50%) rotate(${chair.rotation||0}deg)"></i>${ui.showSeats?`<span class="seat-number" style="left:${50+(chair.x-50)*.69}%;top:${50+(chair.y-50)*.69}">S${chair.seatNumber}</span>`:""}`).join("");
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
    return`<div class="table-object ${esc(table.type)} ${selected?"selected multi-selected":""} ${highlighted?"highlighted":""} ${frozen?"frozen":""} ${unavailable?"unavailable":""} ${loadRow?"load-"+loadRow.band:""} ${seating&&!match?"dimmed":""} ${seating&&match&&ui.seatingFilter!=="all"?"filter-match operational-match":""}" data-object-id="${table.id}" data-object-kind="table" style="left:${table.x}px;top:${table.y}px;width:${table.w}px;height:${table.h}px;transform:rotate(${table.rotation||0}deg);z-index:${table.z||10}">${chairs}<div class="table-surface"><span class="table-label">${esc(formatTableNumber(table.number))}</span><span class="table-occ">${seating?assigned+" / ":""}${table.capacity}</span>${frozen?`<span class="table-frozen" title="${esc(t("freeze.tableFrozen"))}">${icon("lock")}</span>`:""}${unavailable?`<span class="table-unavailable" title="${esc(t("avail.tableUnavailable"))}">${icon("alert")}</span>`:""}${seating&&ui.seatingFilter==="available"&&empty?`<span class="table-empty">${empty} EMPTY</span>`:""}</div>${selected&&!seating?handlesHTML():""}</div>`;
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
    if(isHistorical(event)){
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
  // PHASE (preparation / ready / live / closed) changes what is emphasised,
  // never what is available.
  function eventPhase(event){
    if(isHistorical(event))return"closed";
    if((event.guests||[]).some(g=>g.arrivalStatus==="Checked In"||g.arrivalStatus==="No Show"))return"live";
    return"ready";
  }
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
  function onboardingCalloutHTML(key){
    if(onboardingSeen(key))return"";
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
  function addHandoverNote(event,text,by){
    const H=HANDOVER();
    if(!H||!event)return null;
    const trimmed=String(text||"").trim();
    if(!trimmed)return null;
    event.handoverNotes=Array.isArray(event.handoverNotes)?event.handoverNotes:[];
    const note={id:uid("handover"),text:trimmed.slice(0,H.NOTE_MAX),
      by:String(by||"").trim().slice(0,H.BY_MAX),at:nowISO()};
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
      phase:eventPhase(event),
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
  function eventReadiness(event){
    const doctor=planDoctorReport(event);
    const m=eventMetrics(event);
    const budget=event.analysis?.confidenceBudget||null;
    const inconsistent=(event.analysis?.selfCheck?.checks||[]).filter(c=>c.verdict==="INCONSISTENT");
    const phase=eventPhase(event);
    const reasons=doctor
      ?[...doctor.blocking.map(f=>({level:"blocker",finding:f})),
        ...doctor.needsReview.map(f=>({level:"review",finding:f}))]
      :[];
    const blocking=doctor?doctor.counts.blocking:0;
    const verdict=blocking?(phase==="live"?"liveRisk":"notReady")
      :reasons.length?"readyWithReview":"ready";
    return{phase,verdict,reasons,metrics:m,budget,inconsistent,doctor};
  }
  // WHAT is wrong and WHY the system believes it, in the operator's language.
  //
  // plan-doctor.js writes both in English on purpose -- they are what the
  // exported report and the regression suites read -- and carries the same fact
  // structurally in `params`, which is what a screen can translate. Same
  // pattern as the Self-Check's `params` and `origin`. A finding this table
  // does not know falls back to the module's own wording: English inside a
  // Turkish screen is a visible gap, which is the point; a raw key would not be.
  function doctorText(f){
    // planIssues() already wrote these through t(), so translating them again
    // would put a key where a sentence belongs.
    if(f.passthrough)return{what:f.what,detail:f.why};
    // One disagreement, one wording. The Command Center already restates
    // self-check findings from their own params, and a second phrasing of the
    // same finding in the same screen would read as two different problems.
    if(f.code==="planChecksDisagree"){
      const w=ccCheckText({id:f.checkId,verdict:"INCONSISTENT",params:f.params,statement:f.what,detail:f.why});
      return{what:w.statement,detail:w.detail};
    }
    const k="doctor."+f.code,has=x=>t(x)!==x;
    // Same ".1" convention the Self-Check restatement uses: a singular variant
    // exists only where a count of one would otherwise read as "1 tables". The
    // module puts the finding's primary count in `params.n` so this does not
    // have to know which of `guests`, `pax` or `seats` carries it. Turkish does
    // not inflect after a numeral, so its two forms are usually identical --
    // which is fine, and cheaper than teaching the substituter plural rules.
    const one=f.params&&f.params.n===1;
    const pick=x=>(one&&has(x+".1"))?x+".1":x;
    return{what:has(k)?t(pick(k),f.params):f.what,
      detail:has(k+".why")?t(pick(k+".why"),f.params):f.why};
  }
  // The Self-Check writes its sentences in English -- it is also read by the
  // benchmarks and the exported operator report. The Command Center is a
  // product screen and has to speak the operator's language, so it restates
  // each check from the structured `params` the check carries alongside its
  // sentence. A check this table does not know falls back to the module's own
  // wording: English in a Turkish screen is a visible gap, which is the point;
  // a raw key would not be.
  function ccCheckText(c){
    const p=c.params||{},base="cc.check."+String(c.id).split(":")[0]+"."+c.verdict;
    const has=k=>t(k)!==k;
    // A ".1" variant exists only where a count of one would otherwise read as
    // "1 numbers". English needs it; Turkish does not inflect the noun after a
    // numeral, so its two forms are usually the same sentence -- which is fine,
    // and cheaper than teaching the substituter about plural rules.
    const pick=k=>(p.d===1&&has(k+".1"))?k+".1":k;
    const s=pick(base),d=pick(base+".detail");
    return{
      statement:has(s)?t(s,p):c.statement,
      detail:has(d)?t(d,p):(c.detail||""),
    };
  }
  // Where a finding sends the operator, as a control rather than as a sentence.
  //
  // Three shapes, and the reason there are three rather than one is that two of
  // them already existed and are bound elsewhere: a bare screen is a [data-tab]
  // like every other navigation in the app, and the review centre has had its
  // own action since B2. Only a finding that points at a specific table, guest
  // or object needs the Doctor's own routing, and that is the one case where a
  // plain tab switch would lose the thing the row is about.
  //
  // Every finding gets one. A row that could not say where to go would be the
  // dead end the programme forbids, so `doctorGoHTML` returning "" is a defect
  // the suite checks for rather than a state the UI is allowed to reach.
  function doctorGoHTML(f){
    const a=f.action||{};
    const GO=globalThis.MeritPlanDoctor?.GO||{};
    const targeted=a.tableId||a.guestIds?.length||a.candidateIds?.length||a.filter;
    if(a.go===GO.REVIEW_CENTER&&!targeted)
      return`<button class="btn sm" data-cc-action="review">${t("cc.goto.review")}</button>`;
    if(!targeted&&(a.go===GO.SEATING||a.go===GO.GUESTS||a.go===GO.FLOOR))
      return`<button class="btn sm" data-tab="${a.go.toLowerCase()}">${t("cc.goto."+a.go.toLowerCase())}</button>`;
    // A finding whose destination this table does not recognise still gets a
    // control, labelled generically rather than with a raw key -- an operator
    // must never be shown "doctor.go.SOMETHING". That the case is unreachable
    // is asserted against the module itself, where the defect would be, rather
    // than left to be noticed as odd wording on a screen.
    const label=t("doctor.go."+a.go);
    return`<button class="btn sm" data-cc-go="${esc(f.code)}${f.checkId?":"+esc(f.checkId):""}">${label==="doctor.go."+a.go?t("doctor.go.open"):label}</button>`;
  }
  // THE EVENT RISK RADAR.
  //
  // "What could make this event fail operationally?" — and it runs no engine of
  // its own, which is the point. Every row comes from the Plan Doctor, which in
  // turn compares facts other layers already concluded; there is no second
  // opinion here and no weighting.
  //
  // TWO THINGS IT REFUSES TO DO.
  //
  // It shows no percentage. "92% ready" has to come from somewhere, and there
  // is no honest weighting of one duplicate table number against twelve
  // unseated guests, so the radar says which of four named situations the
  // event is in and lists the reasons.
  //
  // It says what it cannot see. A radar that shows only the risks it knows how
  // to evaluate teaches an operator that a quiet radar means a safe event, so
  // the risks this build does not yet model are named underneath, in the same
  // breath as the verdict. The list comes from the Doctor rather than from a
  // sentence written here, so a risk that ships stops being listed by itself.
  function riskRadarHTML(event,r){
    const notEvaluated=(r.doctor&&r.doctor.notEvaluated)||[];
    const names=notEvaluated
      .map(x=>t("radar.notEvaluated."+x.risk))
      .filter((v,i)=>v!=="radar.notEvaluated."+notEvaluated[i].risk);
    return`<section class="cc-block cc-primary cc-radar">
      <div class="cc-radar-head"><h3>${t("radar.title")}</h3><p>${t("radar.question")}</p></div>
      ${onboardingCalloutHTML("commandCenter")}
      ${r.reasons.length?`<ul class="cc-reasons">${r.reasons.map(ccReasonHTML).join("")}</ul>`
        :`<p class="cc-empty">${t("cc.attention.none")}</p>`}
      ${names.length?`<p class="cc-radar-blind">${esc(t("radar.doesNotCover",{risks:names.join(", ")}))}</p>`:""}
    </section>`;
  }
  function ccReasonHTML(r){
    const w=doctorText(r.finding);
    return`<li class="cc-reason ${r.level}"><i class="health-dot ${r.level==="blocker"?"blocker":"warn"}"></i><div class="cc-reason-body"><b>${esc(w.what)}</b>${w.detail?`<span>${esc(w.detail)}</span>`:""}</div>${doctorGoHTML(r.finding)}</li>`;
  }
  // A full Plan Doctor row: WHAT, WHY, SOURCE, WHAT IT AFFECTS, and the way to
  // act on it. The attention list above says the first and the last of those
  // because it is a summary; this is the pre-flight report, where an operator
  // is deciding whether to trust the answer, and provenance is the whole point.
  function doctorRowHTML(f){
    const w=doctorText(f);
    // A name with no translation is dropped rather than printed: an unknown
    // SOURCE would otherwise render as "doctor.source.WHATEVER" on the screen.
    const named=(prefix,list)=>[...new Set(list||[])].map(v=>prefix+v).filter(k=>t(k)!==k).map(k=>t(k));
    const sources=named("doctor.source.",f.sources);
    const affects=named("doctor.affects.",f.affects);
    return`<li class="doc-row lvl-${f.level}">
      <div class="doc-row-body">
        <b>${esc(w.what)}</b>
        ${w.detail?`<span class="doc-why">${esc(w.detail)}</span>`:""}
        <span class="doc-meta">${esc(t("doctor.sourceLabel"))}: ${esc(sources.join("; "))}${
          affects.length?` · ${esc(t("doctor.affectsLabel"))}: ${esc(affects.join(", "))}`:""}</span>
      </div>${doctorGoHTML(f)}</li>`;
  }
  // The report itself. Collapsed to its verdict until someone asks for it:
  // the Command Center's job is "what deserves my attention now", and the
  // pre-flight is the deliberate act of checking everything before the doors
  // open -- including the INFORMATION rows, which are worth reading once and
  // would be noise in a list an operator scans every few minutes.
  function planDoctorHTML(event,r){
    const d=r.doctor;
    if(!d)return"";
    const V=globalThis.MeritPlanDoctor.VERDICT;
    const tone=d.verdict===V.NO?"blocker":d.verdict===V.WITH_REVIEW?"warn":"ok";
    const section=(key,rows)=>rows.length
      ?`<section class="doc-section ${key}"><h4>${t("doctor.level."+key)}<span>${rows.length}</span></h4><ul class="doc-rows">${rows.map(doctorRowHTML).join("")}</ul></section>`:"";
    const open=ui.doctorOpen;
    const ran=event.finalCheck||null;
    // A recorded run is a record of an ACT, not a cached answer: the rows above
    // are always current. Where the event has changed since, say so rather than
    // letting a timestamp imply that what is on screen was what was checked.
    const stamp=ran
      ?(ran.signature===doctorSignature(d)
        ?t("doctor.lastRun",{when:relativeTime(ran.at)})
        :t("doctor.changedSince"))
      :t("doctor.neverRun");
    return`<section class="cc-block cc-doctor ${tone}">
      <div class="cc-doctor-head">
        <div><h3>${t("doctor.title")}</h3><p class="cc-doctor-q">${t("doctor.question")}</p></div>
        <div class="cc-doctor-verdict"><strong>${t("doctor.verdict."+d.verdict)}</strong><span>${esc(stamp)}</span></div>
        <button class="btn sm ${open?"":"primary"}" data-cc-doctor="${open?"close":"run"}">${t(open?"doctor.hide":"doctor.run")}</button>
      </div>
      <div class="cc-doctor-tally">${[["BLOCKING",d.counts.blocking],["NEEDS_REVIEW",d.counts.needsReview],["INFORMATION",d.counts.information]]
        .map(([k,n])=>`<span class="doc-tally ${k}"><b>${n}</b>${t("doctor.level."+k)}</span>`).join("")}</div>
      ${open?(d.all.length
        ?`${section("BLOCKING",d.blocking)}${section("NEEDS_REVIEW",d.needsReview)}${section("INFORMATION",d.information)}`
        :`<p class="cc-doctor-empty">${t("doctor.allClear")}</p>`):""}
    </section>`;
  }
  // What was checked, reduced to something two runs can be compared on. Codes
  // and counts, not wording: a translation change must not read as the event
  // having changed underneath the operator.
  function doctorSignature(d){
    return d.all.map(f=>f.code+"="+(f.weight??0)).sort().join("|");
  }
  // The Self-Check's first surface anywhere in the product. It produced real
  // findings that no operator could see unless they opened the review panel.
  function ccPlanConsistencyHTML(event){
    const sc=event.analysis?.selfCheck;
    // Two different silences, and saying the wrong one is a lie the operator
    // cannot detect. A plan that HAS been read but prints no figure about
    // itself -- no "166 tables x 12 pax = 1992" -- gives the self-check nothing
    // to compare, which is not the same as no plan having been read at all.
    if(!sc||!sc.checks.length){
      const analysed=!!event.analysis;
      return`<section class="cc-block"><h3>${t("cc.plan.title")}</h3><p class="cc-empty">${t(analysed?"cc.plan.nothingStated":"cc.plan.none")}</p></section>`;
    }
    const mark=v=>v==="CONSISTENT"?"ok":v==="INCONSISTENT"?"bad":v==="NEEDS_REVIEW"?"warn":"muted";
    const glyph=v=>v==="CONSISTENT"?"&#10003;":v==="INCONSISTENT"?"!":v==="NEEDS_REVIEW"?"?":"&#8212;";
    // RESULT, SOURCE and — where there is one — an ACTION. The sources come
    // from the check's own inputs, which have carried them since the engine was
    // built; nothing here invents provenance. The OCR internals stay out: an
    // operator needs to know a number was read off the drawing, not which two
    // crops agreed at what inset.
    return`<section class="cc-block"><h3>${t("cc.plan.title")}</h3><ul class="cc-checks">${sc.checks.map(c=>{
      const w=ccCheckText(c);
      // The ORIGIN, not the source sentence. The sentences are free English and
      // one of them is composed from the figures themselves; they also carry
      // OCR internals ("two crops agreed at what inset") that an operator does
      // not need and §5A says not to show by default.
      // An origin with no wording is DROPPED, not printed. It used to render as
      // "cc.origin.WHATEVER" the moment the value was anything this table did
      // not know -- which is one added ORIGIN away, and was found by rendering
      // the screen rather than by reading it.
      const sources=[...new Set((c.inputs||[]).map(i=>i&&i.origin).filter(Boolean))]
        .map(o=>"cc.origin."+o).filter(k=>t(k)!==k).map(k=>t(k));
      const act=c.verdict==="INCONSISTENT"||c.verdict==="NEEDS_REVIEW"
        ?`<button class="btn sm" data-cc-action="review">${t("cc.goto.review")}</button>`:"";
      return`<li class="cc-check ${mark(c.verdict)}"><i>${glyph(c.verdict)}</i><div class="cc-check-body"><b>${esc(w.statement)}</b><span>${esc(w.detail)}</span>${
        sources.length?`<em class="cc-check-source">${esc(t("cc.check.source"))}: ${esc(sources.join("; "))}</em>`:""}</div>${act}</li>`;
    }).join("")}</ul></section>`;
  }
  function ccSeatingHTML(event){
    // Beside pax/assigned/unassigned, this cell is read as "and how many
    // seats do we have" -- so it answers that, from operational capacity.
    // The drawn-chair count is a different fact and keeps its own labelled
    // column on the Home screen.
    const m=eventMetrics(event),cap=seatingCapacity(event);
    const cell=(v,l)=>`<div class="cc-metric"><b>${v}</b><span>${l}</span></div>`;
    return`<section class="cc-block"><h3>${t("cc.seating.title")}</h3><div class="cc-metrics">${
      cell(m.guests,t("cc.metric.pax"))}${cell(m.assigned,t("cc.metric.assigned"))}${
      cell(m.unassigned,t("cc.metric.unassigned"))}${cell(cap,t("cc.metric.seats"))}</div>${
      m.unassigned?`<button class="btn sm" data-tab="seating">${t("cc.goto.seating")}</button>`:""}</section>`;
  }
  // One shift tells the next what it needs to know. The digest computes
  // nothing new — every figure here is read straight from the module that
  // already owns it, so Handover cannot say something the rest of the screen
  // would disagree with. The notes below the digest are the ONLY thing this
  // section itself owns: free text, kept verbatim, newest first, with no edit
  // and no delete — and deliberately not the future Audit Trail (Phase P),
  // which will be a structured log of decisions the system itself recorded.
  function eventHandoverHTML(event,r){
    const H=HANDOVER();
    if(!H)return"";
    const m=eventMetrics(event),live=liveStats(event);
    const frozenCount=new Set((resolvedFreezes(event)||[]).map(f=>f.tableId)).size;
    const A=AVAIL();
    const unavailable=resolvedUnavailable(event)||[];
    const stranded=A?A.strandedGuests(event.tables||[],event.guests||[]):{records:0,pax:0};
    const notes=resolvedHandoverNotes(event);
    const historical=isHistorical(event);
    const cell=(v,l)=>`<div class="cc-metric"><b>${v}</b><span>${l}</span></div>`;
    return`<section class="cc-block cc-handover">
      <h3>${t("handover.title")}</h3>
      <p class="cc-handover-q">${t("handover.question")}</p>
      <div class="cc-metrics cc-metrics-handover">
        ${cell(t("cc.verdict."+r.verdict),t("handover.metric.verdict"))}
        ${cell(m.unassigned,t("handover.metric.unassigned"))}
        ${cell(live.notArrived,t("handover.metric.notArrived"))}
        ${cell(live.noShow,t("handover.metric.noShow"))}
        ${cell(frozenCount,t("handover.metric.frozen"))}
        ${cell(unavailable.length,t("handover.metric.unavailable"))}
      </div>
      ${stranded.records?`<p class="cc-handover-alert">${esc(t(stranded.records===1?"handover.stranded.1":"handover.stranded",{n:stranded.records,pax:stranded.pax}))}</p>`:""}
      <div class="cc-handover-notes">${notes.length
        ?`<ul class="handover-list">${notes.map(n=>`<li class="handover-note"><p>${esc(n.text)}</p><span>${
            n.by?esc(n.by)+" · ":""}${esc(relativeTime(n.at))}</span></li>`).join("")}</ul>`
        :`<p class="cc-empty">${t("handover.none")}</p>`}</div>
      ${historical?"":`<div class="cc-handover-form">
        <textarea data-handover-text placeholder="${esc(t("handover.placeholder"))}" maxlength="${H.NOTE_MAX}"></textarea>
        <div class="cc-handover-form-row">
          <input type="text" data-handover-by placeholder="${esc(t("handover.byPlaceholder"))}" maxlength="${H.BY_MAX}">
          <button class="btn sm primary" data-handover-add>${t("handover.add")}</button>
        </div>
      </div>`}
    </section>`;
  }
  function commandCenterHTML(event){
    const r=eventReadiness(event);
    return`<div class="screen-scroll"><div class="screen-inner command-center">
      <header class="cc-head verdict-${r.verdict}">
        <div class="cc-phase phase-${r.phase}">${t("cc.phase."+r.phase)}</div>
        <div class="cc-verdict">
          <strong>${t("cc.verdict."+r.verdict)}</strong>
          <span>${r.reasons.length?t(r.reasons.length===1?"cc.verdict.reasonCount1":"cc.verdict.reasonCount",{n:r.reasons.length}):t("cc.verdict.nothingOpen")}</span>
        </div>
      </header>
      ${riskRadarHTML(event,r)}
      <div class="cc-columns">${ccPlanConsistencyHTML(event)}${ccSeatingHTML(event)}</div>
      <div class="cc-columns">${arrivalWaveHTML(event,{compact:true})}${serviceLoadHTML(event,{compact:true})}</div>
      ${planDoctorHTML(event,r)}
      ${eventHandoverHTML(event,r)}
    </div></div>`;
  }
  // Take the operator to the thing the row is about, not merely to the screen
  // it lives on. A target that no longer resolves -- the table was deleted, the
  // candidate was dismissed -- falls back to the screen rather than doing
  // nothing: the row is about something that changed, and stranding the
  // operator on the Command Center with a click that did nothing is worse than
  // landing them one level too wide.
  function doctorGo(event,f){
    const a=(f&&f.action)||{};
    const GO=globalThis.MeritPlanDoctor.GO;
    const table=a.tableId?event.tables.find(x=>x.id===a.tableId):null;
    const guest=(a.guestIds||[]).map(id=>event.guests.find(g=>g.id===id)).find(Boolean)||null;
    if(a.go===GO.FLOOR){
      ui.tab="floor";ui.planMode="plan";
      ui.selectedObjectId=table?table.id:null;ui.selectedObjectIds=table?[table.id]:[];
      ui.highlightId=table?table.id:null;
    }else if(a.go===GO.GUESTS){
      ui.tab="guests";
      if(guest){ui.guestQuery=guest.name;ui.guestFilter="all";}
    }else if(a.go===GO.SEATING){
      ui.tab="seating";ui.operationalMode=false;
      ui.seatingFilter=a.filter||"all";
      ui.seatingQuery="";
      ui.seatingGuestScope=guest&&!guest.assignment?"unassigned":"all";
      ui.selectedGuestId=guest?guest.id:null;
      ui.selectedTableId=table?table.id:(guest&&guest.assignment?guest.assignment.tableId:null);
      ui.highlightId=ui.selectedTableId;
    }else if(a.go===GO.LIVE){
      // The arrivals screen, narrowed to the person the row is about. A row
      // about twelve No Shows opens the list; a row about one opens on them.
      ui.tab="live";
      ui.liveQuery=(a.guestIds||[]).length===1&&guest?guest.name:"";
      ui.liveWindow=null;
    }else if(a.go===GO.BACKUP){
      // The only row whose destination is an ACTION rather than a screen.
      // "Go and find the export button" is the dead end this layer forbids,
      // and the risk is precisely that nobody got round to pressing it.
      //
      // The render below is not cosmetic: without it the operator presses the
      // button, gets a file and a toast, and the row that asked for it is
      // still sitting there — which reads as "it did not work". The report is
      // derived on every read, so one render is all it takes for the risk to
      // disappear by itself.
      exportBackup();
      render();
      return;
    }else{
      // REVIEW and REVIEW_CENTER. Both land in the Floor Plan's review mode --
      // there is no separate review screen since B3 -- and differ only in
      // whether an object or the budget is what the operator came for.
      ui.tab="floor";ui.planMode="review";
      const alive=new Set((event.analysis?.candidates||[]).map(c=>c.id));
      const target=(a.candidateIds||[]).find(id=>alive.has(id))||null;
      ui.selectedCandidateId=target;
      ui.reviewCenterOpen=!target;
      ui.activeReviewGroupId=null;ui.activeQuestionId=null;
    }
    render();
  }
  function bindCommand(){
    const event=activeEvent();
    document.querySelectorAll("[data-cc-action]").forEach(b=>b.onclick=()=>{
      if(b.dataset.ccAction==="review"){ui.reviewCenterOpen=true;ui.tab="floor";ui.planMode="review";render();}
    });
    // The row is matched back to the live report rather than carrying its own
    // copy of the target: between render and click the operator may have fixed
    // the problem in another tab, and acting on a stale payload would send them
    // to a table that no longer exists.
    document.querySelectorAll("[data-cc-go]").forEach(b=>b.onclick=()=>{
      const [code,checkId]=String(b.dataset.ccGo).split(":");
      const d=planDoctorReport(event);
      const f=d&&d.all.find(x=>x.code===code&&(!checkId||x.checkId===checkId));
      if(f)doctorGo(event,f);else render();
    });
    document.querySelectorAll("[data-cc-doctor]").forEach(b=>b.onclick=()=>{
      if(b.dataset.ccDoctor==="close"){ui.doctorOpen=false;render();return;}
      ui.doctorOpen=true;
      // Recording that a person ran the pre-flight is a mutation of the event,
      // so it goes through canMutate like everything else -- a historical event
      // has no Command Center to run it from, and must not acquire one here.
      const d=planDoctorReport(event);
      if(d&&canMutate(event,"run the final check")){
        event.finalCheck={at:nowISO(),verdict:d.verdict,signature:doctorSignature(d),
          counts:{...d.counts}};
        touchEvent(event);
      }
      render();
    });
    document.querySelectorAll("[data-handover-add]").forEach(b=>b.onclick=()=>{
      if(!canMutate(event,"add a handover note"))return;
      const textEl=document.querySelector("[data-handover-text]");
      const byEl=document.querySelector("[data-handover-by]");
      const note=addHandoverNote(event,textEl?textEl.value:"",byEl?byEl.value:"");
      if(!note){toast(t("handover.empty"),"error");return;}
      touchEvent(event);
      render();
      toast(t("handover.added"),"success");
    });
  }
  // The next event is what the operator came for 95% of the time, so it gets
  // the hero treatment and everything else becomes a compact line.
  function nextEventHeroHTML(event){
    const totalPax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    const seatedPax=event.guests.filter(g=>g.assignment).reduce((n,g)=>n+paxOf(g),0);
    // The room's seats, not its drawn chairs: this bar answers "will they
    // fit", and "No tables in the plan yet" underneath it was a literal
    // falsehood on a plan carrying four hundred tables.
    const chairs=seatingCapacity(event);
    const bar=(label,value,max,cls)=>`<div class="nb"><div class="nb-top"><span>${label}</span><b>${value} / ${max}</b></div><div class="nb-track"><div class="nb-fill ${cls}" style="width:${max?Math.min(100,Math.round(value/max*100)):0}%"></div></div></div>`;
    const venue=[event.hotel,event.salon].filter(Boolean).join(" · ")||t("appbar.venueNotSet");
    return`<div class="next-event">
      <div class="next-event-main">
        <span class="next-badge"><i></i>${t("home.nextEvent")}</span>
        <h2>${esc(event.name)}</h2>
        <div class="next-event-when">${esc(fmtDate(event.date))} · ${esc(venue)}</div>
        <div class="next-event-bars">
          ${bar(t("home.seatedProgress"),seatedPax,totalPax,seatedPax&&seatedPax===totalPax?"good":"")}
          ${chairs?bar(t("home.capacityProgress"),totalPax,chairs,totalPax>chairs?"warn":"good"):`<div class="nb-top" style="color:var(--amber)">${t("home.noPlanYet")}</div>`}
        </div>
      </div>
      <div class="next-event-side">
        <button class="btn primary" data-open-event="${event.id}">${t("home.openEvent")}</button>
        <button class="btn" data-duplicate-event="${event.id}">${icon("copy")}${t("home.duplicate")}</button>
        <button class="btn" data-export-event-package="${event.id}" title="${esc(t("home.exportPackage"))}">${icon("download")}${t("home.exportPackageShort")}</button>
        <button class="btn danger" data-delete-event="${event.id}">${icon("trash")}${t("home.delete")}</button>
      </div>
    </div>`;
  }
  function upcomingLineHTML(event){
    const venue=[event.hotel,event.salon].filter(Boolean).join(" · ")||t("appbar.venueNotSet");
    return`<div class="event-line" data-open-event="${event.id}" title="${esc(t("home.openEventNamed",{name:event.name}))}">
      <div><b>${esc(event.name)}</b></div>
      <div class="muted">${esc(fmtDate(event.date))}</div>
      <div class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(venue)}</div>
      <div class="seat-tag">${eventMetrics(event).guests}</div>
      <div class="seat-tag">${physicalCapacity(event)}</div>
      <div class="row-icons"><button class="row-action" data-duplicate-event="${event.id}" aria-label="${esc(t("home.a11y.duplicate",{name:event.name}))}" title="${t("home.duplicate")}">${icon("copy")}</button><button class="row-action" data-export-event-package="${event.id}" aria-label="${esc(t("home.a11y.exportPackage",{name:event.name}))}" title="${esc(t("home.exportPackage"))}">${icon("download")}</button><button class="row-action" data-delete-event="${event.id}" aria-label="${esc(t("home.a11y.delete",{name:event.name}))}" title="${t("home.delete")}">${icon("trash")}</button></div>
    </div>`;
  }
  // ---- EVENT HISTORY & LEARNING ----------------------------------------
  //
  // Not a second Reports screen and not a model: src/event-history.js
  // averages exactly two real per-event facts (room utilization, no-show
  // rate) that MeritArrivalWave and eventMetrics()/physicalCapacity()
  // already computed for each completed event -- this function reads and
  // combines them, and computes nothing of its own. Shown only once there
  // is at least one completed event to read from.
  function eventHistoryLearningHTML(historyEvents){
    const M=globalThis.MeritEventHistory,AW=globalThis.MeritArrivalWave;
    if(!M||!AW||!historyEvents.length)return"";
    const outcomes=historyEvents.map(e=>{
      const w=AW.build({guests:e.guests||[],bucketMinutes:30});
      return M.outcome({
        totalPax:eventMetrics(e).guests,
        actualPax:w.actual.pax,
        // Utilisation is people against the seats the room had, so a
        // symbolic plan's history is measurable too.
        capacity:seatingCapacity(e),
        noShowPax:w.noShow.pax,
        noShowRecords:w.noShow.records,
      });
    });
    const L=M.learning(outcomes);
    const pct=x=>(x===null||x===undefined)?null:Math.round(x*100);
    const util=pct(L.averageUtilization),noShow=pct(L.averageNoShowRate);
    const sampleNote=sample=>sample===1?t("history.sampleNote1"):t("history.sampleNote",{n:sample});
    const tile=(label,value,sample)=>`<div class="mx-metric"><span class="mx-metric-label">${label}</span><span class="mx-metric-value">${value===null?"—":value+"%"}</span><span class="mx-metric-note">${sample?sampleNote(sample):t("history.noData")}</span></div>`;
    return`<div class="mx-section history-learning"><div class="mx-section-head"><h2>${t("history.title")}</h2></div>
      <p class="history-note">${t("history.note")}</p>
      <div class="mx-metrics" style="margin-bottom:0">
        ${tile(t("history.avgUtilization"),util,L.utilizationSampleSize)}
        ${tile(t("history.avgNoShow"),noShow,L.noShowSampleSize)}
      </div>
    </div>`;
  }
  eventsHTML = function(){
    const upcoming=state.events.filter(e=>!isHistorical(e)).sort((a,b)=>(a.date||"9999").localeCompare(b.date||"9999"));
    const history=state.events.filter(isHistorical).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
    const [next,...rest]=upcoming;
    return`<header class="appbar">${topBrand()}<div class="crumb">${t("home.crumb")} / <b>${t("home.portfolio")}</b></div><div class="appbar-actions">${helpButton()}<button class="btn quiet icon-only" data-action="backup-export" title="${t("backup.export")}">${icon("download")}</button><button class="btn quiet icon-only" data-action="backup-import" title="${t("backup.import")}">${icon("upload")}</button><button class="btn quiet icon-only" data-action="recovery-restore" title="${t("recovery.buttonTitle")}">${icon("undo")}</button><button class="btn primary" data-action="create-event">${icon("plus")}${t("home.createEvent")}</button></div></header><div class="mx-screen"><div class="mx-wrap">
      <div class="mx-head"><div><div class="kicker">${t("home.eyebrow")}</div><h1>${t("home.title")}</h1><p>${t("home.subtitle")}</p></div><span class="muted" style="font-size:12px">${t(state.events.length===1?"home.eventCount1":"home.eventsCount",{n:state.events.length})}</span></div>
      ${next?nextEventHeroHTML(next):`<div class="mx-empty"><h3>${t("home.noUpcoming")}</h3><p>${t("home.noUpcomingHint")}</p><button class="btn primary" data-action="create-event">${icon("plus")}${t("home.createEvent")}</button></div>`}
      ${rest.length?`<div class="mx-section"><div class="mx-section-head"><h2>${t("home.otherUpcoming")}</h2><span class="count">${rest.length}</span></div><div class="mx-list"><div class="mx-list-head event-line"><span>${t("home.col.event")}</span><span>${t("home.col.date")}</span><span>${t("home.col.hotelSalon")}</span><span>${t("home.col.guestPax")}</span><span>${t("home.col.physicalChairs")}</span><span></span></div>${rest.map(upcomingLineHTML).join("")}</div></div>`:""}
      ${eventHistoryLearningHTML(history)}
      <div class="mx-section"><div class="mx-section-head"><h2>${t("home.eventsHistory")}</h2><span class="count">${t("home.historyNote")}</span></div>${history.length?`<div class="mx-list"><div class="mx-list-head event-line"><span>${t("home.col.event")}</span><span>${t("home.col.date")}</span><span>${t("home.col.hotelSalon")}</span><span>${t("home.col.guestPax")}</span><span>${t("home.col.physicalChairs")}</span><span></span></div>${history.map(e=>`<div class="event-line" data-history-event="${e.id}" title="${esc(t("home.historyOpenHint"))}"><div><b>${esc(e.name)}</b></div><div class="muted">${esc(fmtDate(e.date))}</div><div class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc([e.hotel,e.salon].filter(Boolean).join(" · ")||"—")}</div><div class="seat-tag">${eventMetrics(e).guests}</div><div class="seat-tag">${physicalCapacity(e)}</div><div class="row-icons"><span class="readonly-tag">${icon("lock")}${t("home.readOnly")}</span><button class="row-action" data-export-event-package="${e.id}" aria-label="${esc(t("home.a11y.exportPackage",{name:e.name}))}" title="${esc(t("home.exportPackage"))}">${icon("download")}</button><button class="row-action" data-delete-event="${e.id}" aria-label="${esc(t("home.a11y.delete",{name:e.name}))}" title="${t("home.delete")}">${icon("trash")}</button></div></div>`).join("")}</div>`:`<div class="mx-empty" style="padding:30px">${t("home.noHistorical")}</div>`}</div>
    </div></div>`;
  };

  // The Command Center leads because it is the only screen that answers a
  // question about the WHOLE event; every tab after it owns one part of the
  // work. Historical events do not get one -- a finished event has no
  // readiness to assess, and "12 guests unassigned" on a closed night is
  // noise, not a finding.
  const normalTabs=[["command",()=>t("nav.commandTab")],["floor",()=>t("nav.floorPlanTab")],["guests",()=>t("nav.guestsTab")],["seating",()=>t("nav.seatingTab")],["live",()=>t("nav.liveTab")],["reports",()=>t("nav.reportsTab")]];
  const historyTabs=[["guests",()=>t("nav.guestsTab")],["seating",()=>t("nav.seatingTab")],["reports",()=>t("nav.reportsTab")]];
  workspaceHTML = function(event){
    const historical=isHistorical(event),tabs=historical?historyTabs:normalTabs;
    if(!tabs.some(([id])=>id===ui.tab))ui.tab=tabs[0][0];
    return`<section class="workspace ${ui.focusMode?"v8-focus":""}"><header class="workspace-head">${topBrand()}<div class="event-id"><strong>${esc(event.name)}</strong><span>${esc(fmtDate(event.date))} · ${esc([event.hotel,event.salon].filter(Boolean).join(" · ")||t("appbar.venueNotSet"))}</span></div><div class="workspace-actions"><div class="global-search">${icon("search")}<input id="globalGuestSearch" placeholder="${t("appbar.search")}" autocomplete="off"><div id="globalSearchResults" class="search-results hidden"></div></div>${planHealthHTML(event)}<button class="btn quiet sm lang-btn" data-v8-action="toggle-lang" title="Language / Dil">${ui.lang==="tr"?"TR":"EN"}</button><button class="btn quiet icon-only" data-action="save-now" title="${t("appbar.saveNow")}">${icon("save")}</button>${helpButton()}<button class="btn sm" data-action="back-events">${t("appbar.allEvents")}</button></div></header><nav class="tabs">${tabs.map(([id,label])=>`<button class="tab ${ui.tab===id?"active":""}" data-tab="${id}">${label()}</button>`).join("")}</nav>${historical?`<div class="workspace-readonly-banner">${icon("lock")}${t("nav.historicalBanner")}</div>`:ui.focusMode?"":onboardingCalloutHTML("globalFinder")}<div class="content">${tabContent(event)}</div>${ui.focusMode?`<button class="focus-exit" data-v8-action="focus">${t("nav.exitFocus")}</button>`:""}</section>`;
  };
  tabContent = function(event){
    if(isHistorical(event)){
      if(ui.tab==="guests")return`<div class="readonly-screen">${readonlyGuestsHTML(event)}</div>`;
      if(ui.tab==="seating")return`<div class="v8-lock">${seatingHTML(event)}</div>`;
      return reportsHTML(event);
    }
    if(ui.tab==="command")return commandCenterHTML(event);
    // One tab, two modes on the same drawing. Review used to be a screen that
    // replaced the shell; it is a mode now, so the event identity, the tab bar
    // and the global guest search survive the trip.
    if(ui.tab==="floor")return ui.planMode==="review"?analysisHTML(event)
      :ui.planMode==="changes"?layoutChangesHTML(event):floorPlanHTML(event);
    if(ui.tab==="guests")return guestsHTML(event);if(ui.tab==="seating")return seatingHTML(event);if(ui.tab==="live")return liveHTML(event);return reportsHTML(event);
  };
  function readonlyGuestsHTML(event){
    return`<div class="screen-inner"><div class="readonly-note">${icon("lock")}This historical guest list is read-only.</div><div class="screen-titlebar"><div><h2>Guest List</h2><p>${event.guests.length} records · ${eventMetrics(event).guests} total pax</p></div></div><div class="guest-shell"><table class="guest-table"><thead><tr><th>Name Surname</th><th>Pax</th><th>Planning</th><th>Arrival</th><th>VIP</th><th>Invited By</th><th>Table / Seats</th><th>Notes</th></tr></thead><tbody>${event.guests.map(g=>{const t=event.tables.find(x=>x.id===g.assignment?.tableId);return`<tr><td><b>${esc(g.name)}</b></td><td>${paxOf(g)}</td><td>${esc(g.planningStatus)}</td><td>${esc(g.arrivalStatus)}</td><td>${esc(g.vip)}</td><td>${esc(g.invitedBy||"—")}</td><td>${t?esc(t.number)+" · "+esc(seatRange(g.assignment.seats)):"—"}</td><td>${esc(g.notes||"")}</td></tr>`}).join("")||`<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">No guest records.</td></tr>`}</tbody></table></div></div>`;
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
            <div class="field full"><label>${t("setup.eventName")}</label><input name="name" required autocomplete="off" value="${esc(d.name)}" placeholder="${t("setup.eventNamePh")}"></div>
            <div class="field"><label>${t("setup.date")}</label><input name="date" type="date" required value="${esc(d.date)}"></div>
            <div class="field"><label>${t("setup.status")}</label><select name="status">${statuses.map(s=>`<option value="${s}" ${d.status===s?"selected":""}>${t("setup.status."+s)}</option>`).join("")}</select></div>
            <div class="field"><label>${t("setup.hotel")}</label><input name="hotel" required value="${esc(d.hotel)}" placeholder="${t("setup.hotelPh")}"></div>
            <div class="field"><label>${t("setup.salon")}</label><input name="salon" value="${esc(d.salon)}" placeholder="${t("setup.salonPh")}"></div>
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
  function decodableImage(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>img.naturalWidth>0?resolve(src):reject(new Error(t("plan.notAnImage")));img.onerror=()=>reject(new Error(t("plan.notAnImage")));img.src=src;});}
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
      try{ui.setupBusy=true;render();const pdf=await waitForPdf(),doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;newEventDraft.pdfDoc=doc;newEventDraft.pdfName=file.name;newEventDraft.pdfPages=Array.from({length:doc.numPages},(_,i)=>i);ui.setupBusy=false;await selectPdfPage(0);toast(`${doc.numPages} PDF page${doc.numPages===1?"":"s"} rendered locally. Choose a page thumbnail.`,"success",4500);}catch(error){ui.setupBusy=false;render();toast(t("setup.planReadFailed",{reason:error.message}),"error",6000);}return;
    }
    if(!(file.type==="image/png"||file.type==="image/jpeg"||/\.(png|jpe?g)$/.test(lower)))return toast("Choose PNG, JPG, JPEG or PDF.","error");
    let planSrc;try{planSrc=await readImageFile(file);}catch{return toast(t("plan.unreadableImage"),"error",6500);}
    newEventDraft.planSrc=planSrc;newEventDraft.planName=file.name;newEventDraft.pdfDoc=null;newEventDraft.pdfPages=[];render();
  }
  async function renderPdfThumbs(){
    const doc=newEventDraft.pdfDoc;if(!doc)return;
    for(const canvas of document.querySelectorAll("[data-pdf-thumb]")){const index=Number(canvas.dataset.pdfThumb),page=await doc.getPage(index+1),v=page.getViewport({scale:.28});canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);await page.render({canvasContext:canvas.getContext("2d"),viewport:v}).promise;}
  }
  function createBlankEventFromSetup(usePlan){
    syncSetupFields();const d=newEventDraft;if(!d.name.trim()||!d.date||!d.hotel.trim()){toast("Event name, date and hotel are required.","error");return;}
    const event=migrateEvent({id:uid("event"),name:d.name.trim(),date:d.date,hotel:d.hotel.trim(),salon:d.salon.trim(),status:d.status,coverImage:d.coverImage,tables:[],venueObjects:[],guests:[],background:{src:usePlan?d.planSrc:"",name:usePlan?d.planName:"",opacity:.34,visible:!!(usePlan&&d.planSrc),locked:true,isDefault:false,scale:100},createdAt:nowISO(),lastModified:nowISO()});
    state.events.unshift(event);if(globalThis.MeritVenueModel)MeritVenueModel.migrateVenues(state);audit(event,"EVENT_CREATED",{blank:!event.background.src,hotel:event.hotel,salon:event.salon});saveState();ui.activeEventId=event.id;ui.screen="workspace";ui.tab="floor";ui.leftCollapsed=true;render();toast(event.background.src?"Event created. Review the plan, then run Assisted Detection.":"Blank event created. Add plan objects when ready.","success",5000);
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
  // SPEED IS AN INDEX, NOT A PROMISE. The old search ran a table lookup INSIDE
  // the filter, so every keystroke cost O(guests x tables) — on a 4,000-seat
  // event that is millions of comparisons per character typed. One lowercase
  // haystack per guest is built once per change to the event and scanned
  // linearly after that. The suite measures it rather than asserting it.
  let guestIndexCache = null;
  function guestSearchIndex(event){
    // touchEvent() stamps lastModified on every mutation, so it is the cheapest
    // honest invalidation signal there is. The lengths are in the key too,
    // because an import can add guests inside one millisecond.
    const sig=`${event.id}|${event.lastModified}|${event.guests.length}|${event.tables.length}`;
    if(guestIndexCache&&guestIndexCache.sig===sig)return guestIndexCache;
    const tables=new Map(event.tables.map(t=>[t.id,t]));
    const rows=event.guests.map(g=>{
      const table=g.assignment?tables.get(g.assignment.tableId)||null:null;
      return{guest:g,table,
        name:String(g.name||"").toLocaleLowerCase("tr"),
        // Everything the phase asks to search by: names, the host or company
        // that brought them, VIP level, planning and arrival status, the table
        // number and its zone. `invitedBy` is where this data model keeps both
        // the host and the company — there is no separate company field, and
        // inventing one would be a field nobody fills in.
        hay:[g.name,g.vip,g.invitedBy,g.notes,g.planningStatus,g.arrivalStatus,
          table?table.number:"",table?formatTableNumber(table.number):"",table?table.zone:""]
          .filter(Boolean).join(" ").toLocaleLowerCase("tr")};
    });
    guestIndexCache={sig,rows,tables};
    return guestIndexCache;
  }
  // THE ONE GUEST-MATCHING ENGINE. Every search surface in the product — the
  // Global Finder's dropdown and Live's door search — must agree on WHICH
  // guests a query matches, over the same cached haystack and the same
  // term-AND-narrowing ("yilmaz vip" narrows, never widens). Two
  // independently-written filters is exactly how a query finds someone here
  // and finds nobody at the door. Ranking, limiting and presentation are left
  // to the caller because those legitimately differ (a 12-row typeahead vs a
  // full, arrival-sorted door list) — neither of those is a second engine.
  function matchGuestRows(event,query){
    const q=String(query||"").trim().toLocaleLowerCase("tr");
    if(!q)return{rows:[],terms:[]};
    const terms=q.split(/\s+/).filter(Boolean);
    const index=guestSearchIndex(event);
    return{rows:index.rows.filter(row=>terms.every(term=>row.hay.includes(term))),terms};
  }
  // Ranked by how the name matched, then alphabetically, so the order is
  // stable between keystrokes rather than depending on record order.
  function findGuests(event,query,limit=12){
    const{rows:matched,terms}=matchGuestRows(event,query);
    if(!terms.length)return{rows:[],total:0};
    const hits=matched.map(row=>({row,
      rank:row.name.startsWith(terms[0])?0:row.name.includes(terms[0])?1:2}));
    hits.sort((a,b)=>a.rank-b.rank||a.row.name.localeCompare(b.row.name,"tr"));
    return{rows:hits.slice(0,limit).map(h=>h.row),total:hits.length};
  }
  // The party is the people the same host brought. It is NOT the guest's own
  // companions — those are already inside the record as pax, and a "party" of
  // one record showing itself tells an operator nothing. `invitedBy` is the
  // only grouping in this data that survives a guest not being seated yet.
  function partyOf(event,guest){
    const host=String(guest.invitedBy||"").trim();
    if(!host)return[];
    return event.guests.filter(g=>String(g.invitedBy||"").trim()===host);
  }
  function guestResultHTML(event,row,active){
    const g=row.guest,table=row.table;
    const extra=additionalOf(g);
    const historical=isHistorical(event);
    const party=partyOf(event,g);
    const seatText=table?`${esc(formatTableNumber(table.number))} · ${esc(seatRange(g.assignment.seats))}`:t("find.noTable");
    // Each action is offered only where it can do something, with the reason
    // carried in the title rather than a dead control the operator presses and
    // learns nothing from.
    const act=(action,label,enabled,title)=>
      `<button class="btn sm ${enabled?"":"is-off"}" data-find-action="${action}" data-find-guest="${g.id}"${
        enabled?"":" disabled"}${title?` title="${esc(title)}"`:""}>${label}</button>`;
    return`<div class="find-row ${active?"active":""}" data-search-guest="${g.id}" role="option"${active?' aria-selected="true"':""}>
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
    const {rows,total}=findGuests(event,query);
    if(!String(query||"").trim()){box.classList.add("hidden");ui.findActive=-1;return;}
    // -1 is the shut state, set by Escape and by the ui defaults. Without the
    // <0 guard it survives the next keystroke, so the list came back with
    // nothing selected and Enter did nothing — the keyboard path silently died
    // after the first Escape.
    if(ui.findActive==null||ui.findActive<0||ui.findActive>=rows.length)ui.findActive=rows.length?0:-1;
    box.innerHTML=rows.length
      ?`<div class="find-list" role="listbox">${rows.map((r,i)=>guestResultHTML(event,r,i===ui.findActive)).join("")}</div>${
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

  // ---- LAYOUT CHANGES -------------------------------------------------------
  //
  // What has moved since the room was published. No new detector:
  // MeritVenueModel.compareToVersion has done this comparison since the venue
  // model was built and had no UI at all, so nothing in the product could
  // answer "what did we change since v3?" — the engine was reachable only from
  // a test. This is that answer, as a MODE of the Floor Plan rather than a
  // screen of its own: the plan stays the hero and the changes sit on it.
  function layoutChangeSource(event){
    const ref=event?.venueRef,VM=globalThis.MeritVenueModel;
    if(!ref||!VM)return null;
    const venue=VM.findVenue(state,ref.venueId),layout=VM.findLayout(venue,ref.layoutId);
    if(!layout||!(layout.versions||[]).length)return null;
    // The version this event was taken FROM. "What have I changed since the
    // room was published" is the operator's question; comparing against the
    // newest version would answer a different one the moment somebody else
    // published after this event was created.
    const version=VM.findVersion(layout,ref.layoutVersionId)||layout.versions[layout.versions.length-1];
    return version?{venue,layout,version}:null;
  }
  function layoutChanges(event){
    const src=layoutChangeSource(event);
    if(!src)return null;
    try{
      const diff=globalThis.MeritVenueModel.compareToVersion(state,src.version.id,
        {tables:event.tables,venueObjects:event.venueObjects,background:event.background});
      return{...diff,source:src};
    }catch{ return null; }
  }
  // A confirmation is stored against the VERSION it was made about, not just the
  // change: "T05 is gone relative to v3" is a fact that stays true, and keying
  // on the signature alone would let a table removed, re-added and removed again
  // come back already ticked.
  const changeKey=(versionId,c)=>`${versionId}::${c.type}|${c.kind}|${c.key}|${c.field||""}`;
  function planModeSwitchHTML(event){
    const changes=layoutChanges(event);
    if(!event.background?.src&&!changes)return"";
    const b=(mode,label)=>`<button class="${ui.planMode===mode?"active":""}" data-plan-mode="${mode}"${
      ui.planMode===mode?' aria-current="true"':""}>${label}</button>`;
    // The third mode appears only where there is a previous version to compare
    // against. An event that was never taken from a published layout has no
    // "since when" to answer, and an empty tab that is always there teaches an
    // operator to stop looking at it.
    return`<div class="planmode-switch" role="group" aria-label="${esc(t("plan.mode.label"))}">${
      event.background?.src?b("plan",t("plan.mode.plan"))+b("review",t("plan.mode.review")):""}${
      changes?b("changes",t("plan.mode.changes")):""}</div>`;
  }
  // Shared by both canvases: the Floor Plan is where an operator reads the
  // room spatially, and Seating is where they act on occupancy, so the toggle
  // belongs on both toolbars rather than only where it was easiest to add.
  // Offered only where there is occupancy to show -- an empty room has no
  // load, and a permanent toggle for an empty layer teaches an operator to
  // stop reading the toolbar, the same rule the freeze layer and the changes
  // mode follow.
  function loadLayerToolHTML(event){
    return(event.tables||[]).length&&(event.guests||[]).some(g=>g.assignment)
      ?`<div class="tool-group">${toolbarBtn("users",t("load.layer"),`data-load-layer`,ui.loadLayer)}</div>`:"";
  }
  function planMapToolbarHTML(event){
    const bg=event.background||{};
    // The language toggle used to live here AND in the review screen's own top
    // bar -- a global setting owned by two screen-local toolbars, and absent
    // from every other screen. It is in the workspace header now, with the rest
    // of the controls that are about the application rather than the drawing.
    // The switch decides for itself whether it has anything to offer: a plan to
    // review, a published version to compare against, or both. Gating the group
    // on a background image instead meant an event with a layout history and no
    // imported drawing had its change view built and unreachable.
    const modes=planModeSwitchHTML(event);
    return`<div class="planmap-toolbar">${modes?`<div class="tool-group">${modes}</div>`:""}<div class="tool-group">${toolbarBtn("mouse",t("toolbar.select"),`data-tool="select"`,ui.tool==="select")}${toolbarBtn("hand",t("toolbar.pan"),`data-tool="pan"`,ui.tool==="pan")}</div>${loadLayerToolHTML(event)}<div class="tool-group">${toolbarBtn("zoomOut",t("toolbar.zoomOut"),`data-canvas-action="zoom-out"`)}<span class="zoom-label">${Math.round(ui.zoom*100)}%</span>${toolbarBtn("zoomIn",t("toolbar.zoomIn"),`data-canvas-action="zoom-in"`)}${toolbarBtn("fit",t("toolbar.fit"),`data-canvas-action="fit"`)}</div><div class="tool-group">${toolbarBtn("eye",bg.visible?t("toolbar.hideOriginalPlan"):t("toolbar.showOriginalPlan"),`data-v8-action="toggle-bg"`,bg.visible)}${toolbarBtn("image",t("toolbar.replacePlan"),`data-v8-action="replace-bg"`)}</div><div class="tool-group">${toolbarBtn("fit",t("toolbar.focusMode"),`data-v8-action="focus"`,ui.focusMode)}</div>${bg.src?`<div class="tool-group">${toolbarBtn("image",t("toolbar.assistedDetection"),`data-v8-action="detect"`,false).replace('class="toolbar-btn','class="toolbar-btn ai')}</div>`:""}</div>`;
  }
  // What the pill puts where a seat count goes. On a plan whose tables are
  // drawn as symbols there is nothing to count: a bold "0 seats" in the
  // headline reads as "this room seats nobody", when the truth is that this
  // drawing does not show seats at all. The count is replaced by what kind of
  // drawing it is, and the tables — which this plan really does state — take
  // the number's place.
  function planSeatsPill(pi){
    const s=pi.planSummary||{};
    if(s.representation==="SYMBOLIC")
      return`<b>${s.tables??0}</b><small>${t("plan.symbolTables")}</small>`;
    return`<b>${s.physicalSeats??0}</b><small>${t("plan.seats")}</small>`;
  }
  // ONE answer to "how much of this plan still needs a person", for every
  // surface that asks it.
  //
  // Two pills used to compute this independently and disagree. Rendered on the
  // same event, in the same component, in the same corner of the screen, both
  // linking to the same Review Center, the product said:
  //
  //   Floor Plan tab   "37 items need review"   reviewGroups MEMBERS + questions
  //   Review screen    "6 to decide"            the Confidence Budget
  //
  // The 37 is the raw, un-collapsed count -- precisely what the Confidence
  // Budget exists to replace ("do not show the operator 50 warnings just
  // because the system has 50 uncertain facts"). Sharing one function is the
  // point: two call sites computing the same question separately is how they
  // drifted apart in the first place.
  //
  // The click attribute differs because the two surfaces are bound by different
  // binders, so it is a parameter rather than a reason to fork the function.
  function planReviewChipHTML(event,actionAttr){
    const budget=event.analysis?.confidenceBudget;
    const shown=budget?budget.counts.shown:0;
    if(shown)return`<i class="pill-div"></i><button class="pill-chip" data-${actionAttr}="open-review-center">${t("budget.chip",{n:shown})}</button>`;
    // Before an analysis has produced a budget there is still something honest
    // to say: how many groups are waiting. Never the member count.
    const pi=event.analysis?.planIntelligence;
    const groups=pi?reviewGroupCount(pi):0;
    return groups?`<i class="pill-div"></i><button class="pill-chip" data-${actionAttr}="open-review-center">${groups} ${t(groups===1?"review.group":"review.groups")}</button>`:"";
  }
  function planStatusPillHTML(event){
    const pi=event.analysis?.planIntelligence;if(!pi)return"";
    return`<div class="planmap-status-pill"><span>${t("plan.understood")}</span><b>${pi.planSummary.diningGroups}</b><small>${t("plan.diningGroups")}</small><i class="pill-div"></i>${planSeatsPill(pi)}${planReviewChipHTML(event,"v8-action")}</div>`;
  }
  function contextualCardHTML(event){
    const t_=event.tables.find(x=>x.id===ui.selectedObjectId),o=event.venueObjects.find(x=>x.id===ui.selectedObjectId);
    if(!t_&&!o)return"";
    // Every field this card renders edits ui.selectedObjectId ALONE, never
    // the rest of ui.selectedObjectIds -- so a canvas multi-select (bulk-add
    // just created 4 tables, a marquee caught several) must say so here,
    // rather than letting the blue multi-select outlines imply a stepper
    // click is about to change all of them.
    const alsoSelected=Math.max(0,(ui.selectedObjectIds||[]).length-1);
    const alsoSelectedHTML=alsoSelected?`<div class="contextual-card-also-selected">${t("inspector.alsoSelected",{n:alsoSelected})}</div>`:"";
    if(t_){const assigned=tableAssignedPax(event,t_.id),presets=t_.type==="round"?[6,8,10,12]:[2,4,6,8];
      // Data Provenance Inspector (Section 11): a read-only fact, never an
      // editable field -- capacitySource is set only by the writers named in
      // src/capacity-provenance.js, never chosen here.
      const provenanceHTML=CAPPROV()?`<div class="contextual-card-provenance"><span>${t("inspector.capacitySource")}</span><b>${esc(t(capacitySourceKey(t_.capacitySource)))}</b></div>`:"";
      return`<aside class="contextual-card"><div class="contextual-card-head"><strong>${esc(formatTableNumber(t_.number))}</strong><span>${esc(t_.zone)} · ${assigned} ${t("seating.occupied").toLowerCase()}</span></div>${alsoSelectedHTML}<div class="seat-editor"><div class="seat-stepper"><button data-seat-step="-1" title="${t("inspector.removeSeat")}">−</button><b>${t_.capacity}</b><button data-seat-step="1" title="${t("inspector.addSeat")}">+</button></div><div class="seat-presets">${presets.map(n=>`<button class="${t_.capacity===n?"active":""}" data-seat-capacity="${n}">${n}</button>`).join("")}<button data-seat-custom>${t("inspector.custom")}</button></div></div><div class="form-grid compact"><div class="field"><label>${t("inspector.type")}</label><select data-inspector="type">${["rectangle","square","round","bistro"].map(x=>`<option value="${x}" ${t_.type===x?"selected":""}>${t("bulk.type."+x)}</option>`).join("")}</select></div><div class="field"><label>${t("inspector.rotation")}</label><input data-inspector="rotation" type="number" value="${Math.round(t_.rotation||0)}"></div><div class="field full"><label>${t("inspector.zone")}</label><select data-inspector="zone">${ZONES.map(z=>`<option ${t_.zone===z?"selected":""}>${z}</option>`).join("")}</select></div></div>${provenanceHTML}<div class="contextual-card-actions"><button class="btn sm" data-inspector-action="duplicate">${icon("copy")}${t("toolbar.duplicate")}</button><button class="btn sm" data-inspector-action="lock">${icon("lock")}${t_.locked?t("seating.unlock"):t("seating.lock")}</button><button class="btn sm danger" data-inspector-action="delete">${icon("trash")}${t("toolbar.delete")}</button></div></aside>`;
    }
    // Sofa/bench/banquette pax cannot be read off a drawing, so its seat
    // count is either a person's verified number or explicitly unverified --
    // never silently treated as zero. Same provenance discipline as capacity.
    const seatProvenanceHTML=UNVERIFIED_SEATING.has(o.type)&&o.seatsConfidence?`<div class="contextual-card-provenance"><span>${t("poi.seatsOnThis")}</span><b>${o.seats==null?t("poi.seatsUnset"):o.seats}</b><i>${t(o.seatsConfidence==="verified"?"inspector.seatsVerified":"inspector.seatsUnverified")}</i></div>`:"";
    return`<aside class="contextual-card"><div class="contextual-card-head"><strong>${esc(o.label)}</strong><span>${t("inspector.object",{type:t("bulk.type."+o.type)})}</span></div>${alsoSelectedHTML}<div class="form-grid compact"><div class="field full"><label>${t("inspector.label")}</label><input data-inspector="label" value="${esc(o.label)}"></div><div class="field"><label>${t("inspector.rotation")}</label><input data-inspector="rotation" type="number" value="${Math.round(o.rotation||0)}"></div></div>${seatProvenanceHTML}<div class="contextual-card-actions"><button class="btn sm" data-inspector-action="duplicate">${icon("copy")}${t("toolbar.duplicate")}</button><button class="btn sm" data-inspector-action="lock">${icon("lock")}${o.locked?t("seating.unlock"):t("seating.lock")}</button><button class="btn sm danger" data-inspector-action="delete">${icon("trash")}${t("toolbar.delete")}</button></div></aside>`;
  }
  function addManuallyFabHTML(){return`<button class="planmap-fab" data-v8-action="add" title="${t("action.addManually")}">${icon(ui.v8AddOpen?"x":"plus")}<span>${t("action.addManually")}</span></button>`;}

  function v8Toolbar(event,seating=false){
    // The FREEZE ZONES layer button appears only where there is something to
    // show. A permanent toggle for an empty layer is how a toolbar teaches an
    // operator to stop reading it -- same rule as the Layout Changes mode.
    const freezeLayerBtn=eventFreezes(event).length
      ?`<div class="tool-group">${toolbarBtn("lock",t("freeze.layer"),`data-freeze-action="layer"`,ui.freezeLayer)}</div>`:"";
    return`<div class="canvas-toolbar v8-toolbar"><div class="tool-group">${toolbarBtn("mouse",t("toolbar.select"),`data-tool="select"`,ui.tool==="select")}${toolbarBtn("hand",t("toolbar.pan"),`data-tool="pan"`,ui.tool==="pan")}</div>${freezeLayerBtn}${loadLayerToolHTML(event)}${!seating?`<div class="tool-group">${toolbarBtn("plus",t("toolbar.addBulk"),`data-v8-action="add"`,ui.v8AddOpen)}${toolbarBtn("copy",t("toolbar.duplicate"),`data-v8-action="duplicate-selection"`)}${toolbarBtn("trash",t("toolbar.delete"),`data-v8-action="delete-selection"`)}</div><div class="tool-group">${toolbarBtn("undo",t("toolbar.undo"),`data-canvas-action="undo"`)}${toolbarBtn("redo",t("toolbar.redo"),`data-canvas-action="redo"`)}</div>`:""}<div class="tool-group">${toolbarBtn("zoomOut",t("toolbar.zoomOut"),`data-canvas-action="zoom-out"`)}<span class="zoom-label">${Math.round(ui.zoom*100)}%</span>${toolbarBtn("zoomIn",t("toolbar.zoomIn"),`data-canvas-action="zoom-in"`)}${toolbarBtn("fit",t("toolbar.fit"),`data-canvas-action="fit"`)}</div><div class="tool-group">${toolbarBtn("grid",t("toolbar.grid"),`data-canvas-action="grid"`,ui.grid)}${toolbarBtn("magnet",t("toolbar.snap"),`data-canvas-action="snap"`,ui.snap)}${toolbarBtn("seat",t("toolbar.seatLabels"),`data-canvas-action="seat-numbers"`,ui.showSeats)}</div><span class="toolbar-spacer"></span>${!seating?toolbarBtn("image",t("toolbar.assistedDetection"),`data-v8-action="detect" ${event.background?.src?"":"disabled"}`,false).replace('class="toolbar-btn','class="toolbar-btn ai'):""}${toolbarBtn("fit",t("toolbar.focusMode"),`data-v8-action="focus"`,ui.focusMode)}</div>`;
  }
  function bulkPanel(event){
    if(!ui.v8AddOpen)return"";const d=ui.bulkDraft||={kind:"table",type:"round",chairs:8,quantity:4,rows:2,cols:2,placement:"grid",prefix:"T",zone:"MAIN FLOOR"};
    // Option LABELS are translated; the option VALUES stay the English
    // identifiers the data model stores. The old markup relied on the label
    // being the value (`<option>${v}</option>`), so translating without an
    // explicit value= would have written Turkish words into table.type.
    const opt=(v,sel)=>`<option value="${v}" ${sel===v?"selected":""}>${t("bulk.type."+v)}</option>`;
    const typeValues=d.kind==="venue"?["stage","bar","entrance","exit","column","text"]:["rectangle","square","round","bistro"];
    const placeValues=["grid","row","repeated","array"];
    return`<div class="v8-create-pop"><h3>${t("bulk.title")}</h3><p>${t("bulk.subtitle")}</p><div class="bulk-grid"><div class="field"><label>${t("bulk.kind")}</label><select data-bulk="kind"><option value="table" ${d.kind==="table"?"selected":""}>${t("bulk.kind.table")}</option><option value="venue" ${d.kind==="venue"?"selected":""}>${t("bulk.kind.venue")}</option></select></div><div class="field"><label>${t("bulk.type")}</label><select data-bulk="type">${typeValues.map(v=>opt(v,d.type)).join("")}</select></div>${d.kind==="table"?`<div class="field"><label>${t("bulk.chairsEach")}</label><input data-bulk="chairs" type="number" min="1" max="99" value="${d.chairs}"></div><div class="field"><label>${t("bulk.numberPrefix")}</label><input data-bulk="prefix" value="${esc(d.prefix)}" maxlength="4"></div>`:""}<div class="field"><label>${t("bulk.quantity")}</label><input data-bulk="quantity" type="number" min="1" max="60" value="${d.quantity}"></div><div class="field"><label>${t("bulk.placement")}</label><select data-bulk="placement">${placeValues.map(v=>`<option value="${v}" ${d.placement===v?"selected":""}>${t("bulk.placement."+v)}</option>`).join("")}</select></div><div class="field"><label>${t("bulk.rows")}</label><input data-bulk="rows" type="number" min="1" max="12" value="${d.rows}"></div><div class="field"><label>${t("bulk.columns")}</label><input data-bulk="cols" type="number" min="1" max="12" value="${d.cols}"></div></div><div class="bulk-actions"><button class="btn sm" data-v8-action="close-add">${t("bulk.cancel")}</button><button class="btn sm primary" data-v8-action="commit-add">${t(d.placement==="repeated"?"bulk.startPlacement":"bulk.addToPlan")}</button></div></div>`;
  }
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
  }
  function bulkCount(d){
    if(d.placement==="array")return Math.max(1,Math.min(60,(Math.max(1,Number(d.rows)||1))*(Math.max(1,Number(d.cols)||1))));
    return Math.max(1,Math.min(60,Number(d.quantity)||1));
  }
  function bulkPositions(d){
    const count=bulkCount(d),gapX=190,gapY=145,out=[];
    const cols=d.placement==="row"?count:Math.max(1,Math.min(count,Number(d.cols)||1));
    for(let i=0;i<count;i++){const c=i%cols,r=Math.floor(i/cols);out.push({x:440+c*gapX,y:270+r*gapY});}
    return out;
  }
  function ghostHTML(){if(!ui.v8AddOpen||ui.bulkDraft?.placement==="repeated")return"";return bulkPositions(ui.bulkDraft).map((p,i)=>`<div class="ghost-object" data-label="${esc((ui.bulkDraft.prefix||"T")+String(i+1).padStart(2,"0"))}" style="left:${p.x}px;top:${p.y}px;width:120px;height:82px"></div>`).join("");}
  const oldViewport=canvasViewportHTML;
  canvasViewportHTML = function(event,seating){
    const html=oldViewport(event,seating);if(seating)return html;
    // Both replacements go through t(), so the v8 status survives a language
    // switch instead of only matching the English string.
    return html.replace("</div><div class=\"canvas-status\"",`${ghostHTML()}</div><div class="canvas-status v8-status"`)
      .replace(t("canvas.editHint"),`${t("canvas.multiSelectHint")}<span class="status-right">${t("canvas.selectedCount",{n:ui.selectedObjectIds.length||0})}</span>`);
  };
  floorPlanHTML = function(event){return`<div class="planmap-shell">${planMapToolbarHTML(event)}${bulkPanel(event)}${canvasViewportHTML(event,false)}${contextualCardHTML(event)}${planStatusPillHTML(event)}${addManuallyFabHTML()}</div>`;};

  // The changes view is the SAME canvas — same toolbar, same plan, same tables.
  // Only the outlines and the panel are added, because "the original plan
  // remains the hero" is not a slogan: a second canvas that redrew the room
  // from the diff would be a different drawing of the same night, and the
  // operator would be comparing the product's picture rather than their own.
  function layoutChangesHTML(event){
    return`<div class="planmap-shell in-changes">${planMapToolbarHTML(event)}${
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
    const d=layoutChanges(event);
    if(!d)return"";
    const seen=event.layoutChangesSeen||{};
    const rows=d.changes.map(c=>{
      const id=changeKey(d.source.version.id,c);
      const confirmed=!!seen[id];
      const uncertain=c.identity.confidence==="UNCERTAIN";
      const conf=t("changes.confidence."+c.identity.confidence);
      const selected=ui.selectedChangeId===id;
      // Only an UNCERTAIN change offers a confirmation. A table matched by its
      // own number is not a claim an operator needs to ratify, and asking them
      // to tick 40 certainties would make the ticks meaningless on the four
      // that matter.
      const act=uncertain&&!confirmed&&!isHistorical(event)
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
    const d=layoutChanges(event);
    if(!d||!ui.selectedChangeId)return"";
    const c=d.changes.find(x=>changeKey(d.source.version.id,x)===ui.selectedChangeId);
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
      const d=layoutChanges(event);
      const c=d&&d.changes.find(x=>changeKey(d.source.version.id,x)===ui.selectedChangeId);
      ui.highlightId=c?(c.tableIdAfter||c.tableIdBefore||null):null;
      render();
    });
    document.querySelectorAll("[data-change-confirm]").forEach(b=>b.onclick=()=>
      confirmLayoutChange(event,b.dataset.changeConfirm));
  }

  function uniqueNumber(event,prefix,index){let n=index;while(event.tables.some(t=>t.number===prefix+String(n).padStart(2,"0")))n++;return prefix+String(n).padStart(2,"0");}
  function createTable(event,d,x,y,index){const dims=d.type==="round"?[120,120]:d.type==="square"?[105,105]:d.type==="bistro"?[82,72]:[170,86],number=uniqueNumber(event,(d.prefix|| (d.type==="bistro"?"B":"T")).toUpperCase(),index);return syncTableChairs({id:uid("table"),number,type:d.type,x,y,w:dims[0],h:dims[1],capacity:Number(d.chairs)||1,zone:d.type==="bistro"?"BISTRO":d.zone||"MAIN FLOOR",rotation:0,locked:false,z:10,hasPhysicalSeats:true,capacitySource:"HUMAN_CONFIRMED"});}
  function commitBulk(){syncBulkFields();const event=activeEvent(),d=ui.bulkDraft;if(!canMutate(event,"add plan objects"))return;if(d.placement==="repeated"){ui.repeatPlacement={...d,remaining:Math.max(1,Number(d.quantity)||1),index:1};ui.v8AddOpen=false;render();toast("Repeated placement active. Click the canvas for each object; Esc cancels.","success",5000);return;}const positions=bulkPositions(d);if(!positions.length)return;recordUndo(event);const created=[];positions.forEach((p,i)=>{if(d.kind==="table"){const t=createTable(event,d,p.x,p.y,i+1);event.tables.push(t);created.push(t.id);}else{const sizes={stage:[380,180],bar:[300,70],entrance:[110,40],exit:[90,40],column:[55,55],text:[150,42]},s=sizes[d.type]||[120,50],o={id:uid("venue"),type:d.type,label:d.type.toUpperCase(),x:p.x,y:p.y,w:s[0],h:s[1],rotation:0,locked:false,z:4};event.venueObjects.push(o);created.push(o.id);}});ui.selectedObjectIds=created;ui.selectedObjectId=created[0];ui.v8AddOpen=false;touchEvent(event);render();toast(`${created.length} object${created.length===1?"":"s"} added with physical chair records.`,"success");}
  function placeRepeated(pointerEvent){const r=document.getElementById("canvasViewport").getBoundingClientRect(),d=ui.repeatPlacement,event=activeEvent(),x=(pointerEvent.clientX-r.left-ui.pan.x)/ui.zoom,y=(pointerEvent.clientY-r.top-ui.pan.y)/ui.zoom;if(!d||!canMutate(event,"place plan objects"))return;recordUndo(event);let id;if(d.kind==="table"){const t=createTable(event,d,x-60,y-45,d.index);event.tables.push(t);id=t.id;}else{const o={id:uid("venue"),type:d.type,label:d.type.toUpperCase(),x:x-60,y:y-30,w:120,h:60,rotation:0,locked:false,z:4};event.venueObjects.push(o);id=o.id;}d.remaining--;d.index++;ui.selectedObjectId=id;ui.selectedObjectIds=[id];if(d.remaining<=0)ui.repeatPlacement=null;touchEvent(event);render();}
  function duplicateSelection(){const event=activeEvent();if(!canMutate(event,"duplicate plan objects"))return;const ids=ui.selectedObjectIds.length?ui.selectedObjectIds:[ui.selectedObjectId].filter(Boolean);if(!ids.length)return toast("Select one or more objects first.");recordUndo(event);const created=[];for(const id of ids){const t=event.tables.find(x=>x.id===id),o=event.venueObjects.find(x=>x.id===id),c=clone(t||o);if(!c)continue;c.id=uid(t?"table":"venue");c.x+=24;c.y+=24;c.locked=false;if(t){c.number=uniqueNumber(event,t.type==="bistro"?"B":"T",1);c.chairs=(c.chairs||[]).map((chair,index)=>({...chair,id:uid("chair"),parentTableId:c.id,seatNumber:index+1,occupancy:null}));event.tables.push(c);}else event.venueObjects.push(c);created.push(c.id);}ui.selectedObjectIds=created;ui.selectedObjectId=created[0]||null;touchEvent(event);render();}
  function deleteSelection(){const event=activeEvent();if(!canMutate(event,"delete plan objects"))return;const ids=new Set(ui.selectedObjectIds.length?ui.selectedObjectIds:[ui.selectedObjectId].filter(Boolean));if(!ids.size)return;const affected=event.guests.filter(g=>ids.has(g.assignment?.tableId));if(!confirm(`Delete ${ids.size} selected object${ids.size===1?"":"s"}${affected.length?` and return ${affected.length} guest record(s) to Unassigned`:""}?`))return;recordUndo(event);affected.forEach(g=>SEAT().clear(g));event.tables=event.tables.filter(t=>!ids.has(t.id));event.venueObjects=event.venueObjects.filter(o=>!ids.has(o.id));ui.selectedObjectIds=[];ui.selectedObjectId=null;touchEvent(event);render();}

  function startMarquee(e){
    if(e.button!==0||ui.tool!=="select"||ui.repeatPlacement)return;const viewport=document.getElementById("canvasViewport"),world=document.getElementById("canvasWorld");if(![viewport,world,world.querySelector(".reference-layer")].includes(e.target))return;e.preventDefault();const box=document.createElement("div");box.className="marquee";viewport.appendChild(box);const r=viewport.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top;let current=[];
    const move=ev=>{const x=ev.clientX-r.left,y=ev.clientY-r.top,left=Math.min(sx,x),top=Math.min(sy,y),w=Math.abs(x-sx),h=Math.abs(y-sy);Object.assign(box.style,{left:left+"px",top:top+"px",width:w+"px",height:h+"px"});const br={left:r.left+left,top:r.top+top,right:r.left+left+w,bottom:r.top+top+h};current=[...world.querySelectorAll("[data-object-id]")].filter(el=>{const q=el.getBoundingClientRect();return q.right>=br.left&&q.left<=br.right&&q.bottom>=br.top&&q.top<=br.bottom;}).map(el=>el.dataset.objectId);};
    const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);box.remove();ui.selectedObjectIds=e.ctrlKey?[...new Set([...ui.selectedObjectIds,...current])]:current;ui.selectedObjectId=ui.selectedObjectIds[0]||null;render();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
  }
  startObjectDrag = function(e,id,kind,el){
    const event=activeEvent();if(!canMutate(event,"move plan objects")||ui.tool!=="select")return;
    if(e.ctrlKey||e.shiftKey){e.preventDefault();e.stopPropagation();ui.selectedObjectIds=ui.selectedObjectIds.includes(id)?ui.selectedObjectIds.filter(x=>x!==id):[...ui.selectedObjectIds,id];ui.selectedObjectId=ui.selectedObjectIds[0]||null;render();return;}
    if(!ui.selectedObjectIds.includes(id))ui.selectedObjectIds=[id];ui.selectedObjectId=id;
    const selected=ui.selectedObjectIds.map(objectId=>event.tables.find(x=>x.id===objectId)||event.venueObjects.find(x=>x.id===objectId)).filter(Boolean);if(selected.some(o=>o.locked))return toast("Unlock every selected object before moving.","error");
    e.preventDefault();e.stopPropagation();const snap=canvasSnapshot(event),sx=e.clientX,sy=e.clientY,start=selected.map(o=>({o,x:o.x,y:o.y}));let moved=false;
    const move=ev=>{const dx=(ev.clientX-sx)/ui.zoom,dy=(ev.clientY-sy)/ui.zoom;start.forEach(({o,x,y})=>{o.x=ui.snap?Math.round((x+dx)/10)*10:x+dx;o.y=ui.snap?Math.round((y+dy)/10)*10:y+dy;const node=document.querySelector(`[data-object-id="${o.id}"]`);if(node){node.style.left=o.x+"px";node.style.top=o.y+"px";}});moved=true;};
    const up=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);if(moved){recordUndo(event,snap);touchEvent(event);}render();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);
  };

  setTableCapacity = function(event,table,newCap){if(!canMutate(event,"change chair capacity"))return false;newCap=Math.max(1,Math.min(99,Number(newCap)||1));const occupied=tableAssignedPax(event,table.id);if(newCap<occupied){toast(`${table.number} has ${occupied} assigned pax. Capacity cannot drop below occupancy.`,"error",5000);return false;}recordUndo(event);repackTableAssignments(event,table,newCap);table.capacitySource="HUMAN_CONFIRMED";syncTableChairs(table,newCap);touchEvent(event);render();return true;};
  updateInspectorField = function(event,field,value){if(!canMutate(event,"edit plan objects"))return;original.updateInspectorField(event,field,value);const table=event.tables.find(x=>x.id===ui.selectedObjectId);if(table)syncTableChairs(table);};
  inspectorAction = function(event,action){if(!canMutate(event,`${action} plan objects`))return;if(action==="duplicate")return duplicateSelection();if(action==="delete")return deleteSelection();original.inspectorAction(event,action);};
  deleteSelectedObject = function(){deleteSelection();};
  startResize = function(...args){if(canMutate(activeEvent(),"resize plan objects"))original.startResize(...args);};
  startRotate = function(...args){if(canMutate(activeEvent(),"rotate plan objects"))original.startRotate(...args);};
  createTableFromDraft = function(){if(canMutate(activeEvent(),"add a table")){original.createTableFromDraft();const e=activeEvent(),t=e.tables.find(x=>x.id===ui.selectedObjectId);if(t){syncTableChairs(t);saveState();}}};
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
    if(isHistorical(event))return;
    document.querySelectorAll("[data-v8-action]").forEach(button=>button.onclick=()=>{const action=button.dataset.v8Action;if(action==="add"){ui.v8AddOpen=!ui.v8AddOpen;ui.bulkDraft ||= {kind:"table",type:"round",chairs:8,quantity:4,rows:2,cols:2,placement:"grid",prefix:"T",zone:"MAIN FLOOR"};render();}else if(action==="close-add"){ui.v8AddOpen=false;render();}else if(action==="commit-add")commitBulk();else if(action==="duplicate-selection")duplicateSelection();else if(action==="delete-selection")deleteSelection();else if(action==="focus"){ui.focusMode=!ui.focusMode;render();}else if(action==="detect")runAssistedDetection();else if(action==="toggle-bg"){recordUndo(event);event.background.visible=!event.background.visible;touchEvent(event);}else if(action==="replace-bg")document.getElementById("floorPlanFile").click();else if(action==="open-review-center"){ui.reviewCenterOpen=true;ui.tab="floor";ui.planMode="review";render();}else if(action==="toggle-lang"){ui.lang=ui.lang==="tr"?"en":"tr";render();}});
    // Typed fields update the draft and refresh only the ghost preview. A full
    // re-render on every change replaced the "Add to plan" button mid-click --
    // typing a value and clicking straight through lost both the edit and the
    // click. Selects still re-render, since choosing an option can change which
    // fields exist and no other click is in flight.
    document.querySelectorAll("[data-bulk]").forEach(input=>{
      const isSelect=input.tagName==="SELECT";
      input.oninput=()=>{
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
  function guestSelectionRows(event){
    const q=ui.seatingQuery.trim().toLocaleLowerCase("tr"),showAll=ui.seatingGuestScope==="all";
    if(!q)return event.guests.filter(g=>showAll||!g.assignment);
    const byId=tableIndex(event);
    return event.guests.filter(g=>(showAll||!g.assignment)&&
      [g.name,g.vip,g.invitedBy,g.planningStatus,byId.get(g.assignment?.tableId)?.number]
        .join(" ").toLocaleLowerCase("tr").includes(q));
  }
  seatingHTML = function(event){
    // Floor Plan collapses the side panels for its own map-first layout.
    // Seating's whole job is "move this guest onto that seat", so the guest
    // queue must never arrive collapsed and leave the operator staring at
    // an empty screen.
    ui.leftCollapsed=false;
    const records=guestSelectionRows(event);
    const selectedIds=ui.selectedGuestIds.length?ui.selectedGuestIds:[ui.selectedGuestId].filter(Boolean);
    const selPax=selectedIds.reduce((n,id)=>n+paxOf(event.guests.find(g=>g.id===id)||{}),0);
    const scopes=[["unassigned",t("seating.scope.unassigned")],["all",t("seating.scope.all")]];
    const filters=[["all",t("seating.filter.all")],["empty",t("seating.filter.empty")],["available",t("seating.filter.available")],["full",t("seating.filter.full")]];
    const totalPax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    const seatedPax=event.guests.filter(g=>g.assignment).reduce((n,g)=>n+paxOf(g),0);
    const freeChairs=Math.max(0,seatingCapacity(event)-seatedPax);
    const byId=tableIndex(event);
    const queue=records.length?records.map(g=>{
      const t_=g.assignment&&byId.get(g.assignment.tableId);
      return`<div class="queue-card ${selectedIds.includes(g.id)?"selected multi-selected":""}" draggable="true" data-seating-guest="${g.id}">
        <div class="party-name">${esc(g.name)}</div>
        <div class="party-sub">${paxDotsHTML(g)}<span>${t("guests.partyOf",{n:paxOf(g)})}</span>${g.vip&&g.vip!=="Standard"?`<span class="vip-tag">${esc(g.vip)}</span>`:""}${t_?`<span class="seat-tag">${esc(formatTableNumber(t_.number))}</span>`:""}</div>
      </div>`;
    }).join(""):`<div class="mx-empty" style="border:none;background:none;padding:26px 12px">${t("seating.noMatches")}</div>`;
    return`<div class="seat-stage">
      <aside class="seat-queue">
        <div class="seat-queue-head"><strong>${ui.seatingGuestScope==="all"?t("seating.allGuests"):t("seating.guestQueue")}</strong>${selectedIds.length?`<span class="sel">${t("seating.recordsSelected",{n:selectedIds.length,pax:selPax})}</span>`:""}</div>
        <div class="seat-queue-controls">
          <div class="guest-scope-strip">${scopes.map(([v,l])=>`<button class="seg-btn ${ui.seatingGuestScope===v?"active":""}" data-seating-scope="${v}">${l}</button>`).join("")}</div>
          <div class="guest-filter-strip">${filters.map(([v,l])=>`<button class="seg-btn ${ui.seatingFilter===v?"active":""}" data-seating-filter="${v}">${l}</button>`).join("")}</div>
          <input class="filter-input" id="seatingSearch" value="${esc(ui.seatingQuery)}" placeholder="${t("seating.search")}">
        </div>
        <div class="seat-queue-list">${queue}</div>
        <div class="seat-advice">${smartSeatingHTML(event)}${freezePanelHTML(event)}</div>
      </aside>
      <section class="seat-canvas-col">
        ${v8Toolbar(event,true)}
        ${canvasViewportHTML(event,true)}
        ${selectedTablePanelHTML(event)}
        ${seatingPreviewHTML(event)}
        <div class="seat-pill">${t("seating.statusPill",{seated:seatedPax,total:totalPax,tables:event.tables.length,free:freeChairs})}</div>
        ${freezeChallengeHTML(event)}
      </section>
    </div>`;
  };
  // ---- SMART SEATING --------------------------------------------------------
  //
  // Recommendations, a preview, and an Apply that goes through the SAME
  // assignGuestToTable() a drag-and-drop does. src/seating-advisor.js cannot
  // write an assignment at all; this is the only place its output can become a
  // mutation, and only a person pressing Apply does it.
  //
  // The whole design rests on that one boundary. "Smart seating" is where a
  // product starts quietly moving guests because it was confident, and the
  // structure here makes that impossible rather than merely discouraged.
  function seatingAdvice(event,guest){
    if(!guest||!globalThis.MeritSeatingAdvisor)return null;
    return globalThis.MeritSeatingAdvisor.recommend({
      guest,tables:event.tables,guests:event.guests,limit:4,
      // Resolved, not the rules. Passing an ARRAY (even an empty one) is what
      // tells the advisor the constraint was evaluated; passing nothing would
      // leave it honestly saying "not set up yet".
      frozen:resolvedFreezes(event)||undefined,
      unavailable:resolvedUnavailable(event)||undefined});
  }
  function reasonText(r){
    const k="seat.reason."+r;
    return t(k)!==k?t(k):r;
  }
  function smartSeatingHTML(event){
    const guest=event.guests.find(g=>g.id===ui.selectedGuestId);
    if(!guest||isHistorical(event))return"";
    const advice=seatingAdvice(event,guest);
    if(!advice)return"";
    const head=`<div class="ss-head"><strong>${t("seat.smartTitle")}</strong><span>${
      esc(t("seat.forGuest",{name:guest.name,pax:paxOf(guest)}))}</span></div>${onboardingCalloutHTML("smartSeating")}`;
    // A locked assignment is a person's decision and outranks anything this
    // layer could propose, so nothing is proposed at all — said, not hidden.
    if(advice.locked)
      return`<aside class="smart-seating">${head}<p class="ss-empty">${t("seat.lockedNote")}</p></aside>`;
    if(!advice.options.length){
      // "No table fits" reads as a broken feature unless it says WHY -- a room
      // that is mostly frozen or failed tonight is a real, explainable state,
      // not silence the operator has to go investigate on their own.
      const frozenCount=advice.blocked.filter(b=>b.why==="FROZEN").length;
      const unavailCount=advice.blocked.filter(b=>b.why==="UNAVAILABLE").length;
      const why=[
        frozenCount?t("seat.noneFitFrozen",{n:frozenCount}):"",
        unavailCount?t("seat.noneFitUnavailable",{n:unavailCount}):"",
      ].filter(Boolean).join(" ");
      return`<aside class="smart-seating">${head}<p class="ss-empty">${
        t("seat.noneFit",{pax:paxOf(guest),tables:advice.considered})}${
        why?` ${why}`:""}</p></aside>`;
    }
    const rows=advice.options.map(o=>`<li class="ss-option${
      ui.seatPreview&&ui.seatPreview.tableId===o.tableId?" active":""}">
      <div class="ss-option-head"><b>${esc(formatTableNumber(o.number))}</b><span>${
        esc(t("seat.freeOf",{free:o.free,capacity:o.capacity}))}${o.zone?` · ${esc(o.zone)}`:""}</span></div>
      <ul class="ss-why">${o.reasons.map(r=>`<li>${esc(reasonText(r))}</li>`).join("")}</ul>
      <button class="btn sm" data-seat-preview="${esc(o.tableId)}">${t("seat.previewImpact")}</button>
    </li>`).join("");
    return`<aside class="smart-seating">${head}
      <ol class="ss-options">${rows}</ol>
      <p class="ss-note">${t("seat.recommendationOnly")}</p>
    </aside>`;
  }
  // WHAT WOULD CHANGE — computed, never promised. Nothing has moved when this
  // is on screen; the numbers come from the advisor reading the same room.
  function seatingPreviewHTML(event){
    if(!ui.seatPreview||isHistorical(event))return"";
    const guest=event.guests.find(g=>g.id===ui.seatPreview.guestId);
    if(!guest)return"";
    const p=globalThis.MeritSeatingAdvisor?.previewMove({
      guest,tables:event.tables,guests:event.guests,toTableId:ui.seatPreview.tableId,
      frozen:resolvedFreezes(event)||undefined,
      unavailable:resolvedUnavailable(event)||undefined});
    if(!p)return"";
    const line=(label,before,after)=>`<div class="sp-row"><em>${esc(label)}</em><b>${
      before}</b><i>&rarr;</i><b>${after}</b></div>`;
    const notConfigured=t("seat.notConfigured");
    return`<aside class="seat-preview">
      <div class="sp-head"><strong>${t("seat.impactTitle")}</strong><span>${
        esc(t("seat.impactSub",{name:guest.name,pax:p.guest.pax}))}</span></div>
      <div class="sp-body">
        ${p.from?line(t("seat.tableLabel",{number:formatTableNumber(p.from.number)}),
          `${p.from.before}/${p.from.capacity}`,`${p.from.after}/${p.from.capacity}`):
          `<div class="sp-row"><em>${t("seat.currently")}</em><b>${t("seat.noTable")}</b></div>`}
        ${line(t("seat.tableLabel",{number:formatTableNumber(p.to.number)}),
          `${p.to.before}/${p.to.capacity}`,`${p.to.after}/${p.to.capacity}`)}
        ${line(t("seat.reserve"),p.reserve.before,p.reserve.after)}
        <div class="sp-row"><em>${t("seat.affected")}</em><b>${
          esc(affectedText(p.affectedGuests,p.affectedPax))}</b></div>
        ${p.hostGuestsAlreadyAtTarget?`<div class="sp-row"><em>${t("seat.cohesion")}</em><b>${
          esc(t("seat.cohesionValue",{n:p.hostGuestsAlreadyAtTarget}))}</b></div>`:""}
        ${(p.constraints||[]).map(c=>`<div class="sp-row ${
          c.state==="FROZEN"||c.state==="UNAVAILABLE"?"is-frozen":""}"><em>${esc(t("seat.constraint."+c.constraint))}</em><b>${
          esc(t("freeze.state."+c.state))}</b></div>`).join("")}
        ${p.unevaluated.map(u=>`<div class="sp-row muted"><em>${
          esc(t("seat.constraint."+u.constraint))}</em><b>${esc(notConfigured)}</b></div>`).join("")}
      </div>
      <div class="sp-foot">
        <span class="sp-nothing">${t("seat.nothingYet")}</span>
        <button class="btn sm" data-seat-cancel>${t("seat.cancel")}</button>
        <button class="btn sm primary" data-seat-apply>${t("seat.apply")}</button>
      </div>
    </aside>`;
  }
  function bindSmartSeating(){
    const event=activeEvent();
    document.querySelectorAll("[data-seat-preview]").forEach(b=>b.onclick=()=>{
      ui.seatPreview={guestId:ui.selectedGuestId,tableId:b.dataset.seatPreview};
      render();
    });
    const cancel=document.querySelector("[data-seat-cancel]");
    if(cancel)cancel.onclick=()=>{ui.seatPreview=null;render();};
    const apply=document.querySelector("[data-seat-apply]");
    if(apply)apply.onclick=()=>{
      const p=ui.seatPreview;if(!p)return;
      if(!canMutate(event,"seat a guest"))return;
      recordUndo(event);
      ui.seatPreview=null;
      // The same function a drag-and-drop calls. The advisor has no path to it
      // and never did: this line is the only way a recommendation becomes a
      // seat, and it runs because a person pressed Apply.
      assignGuestToTable(p.guestId,p.tableId);
    };
  }

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
    const m=mode||(eventPhase(event)==="live"?SL.MODE.LIVE:SL.MODE.PLANNED);
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
  const freezeReasons=()=>["VIP_AREA","HEAD_TABLES","SPONSOR_TABLES","MANAGEMENT_HOLD","LATE_ARRIVAL_RESERVE","OTHER"];
  function freezeScopeText(event,f){
    if(f.scope==="ZONE")return t("freeze.scope.zoneOf",{zone:f.zone});
    if(f.scope==="TABLE"){
      const tb=(event.tables||[]).find(x=>x.id===f.tableId);
      return t("freeze.scope.tableOf",{number:tb?formatTableNumber(tb.number):"—"});
    }
    const pad=n=>`${f.prefix}${String(n).padStart(2,"0")}`;
    return t("freeze.scope.rangeOf",{from:formatTableNumber(pad(f.from)),to:formatTableNumber(pad(f.to))});
  }
  const freezeReasonText=r=>{const k="freeze.reason."+r;return t(k)!==k?t(k):r;};
  const availReasonText=r=>{const k="avail.reason."+r;return t(k)!==k?t(k):r;};
  // "2 record - 5 pax" is the kind of small wrongness that makes an operator
  // trust the rest of the card less. Picked in JS because the substituter does
  // not do plurals and should not learn to.
  const affectedText=(guests,pax)=>t(guests===1?"seat.affectedValue":"seat.affectedValue.n",{guests,pax});
  function zonesInPlan(event){
    return [...new Set((event.tables||[]).map(x=>String(x.zone||"").trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,"tr"));
  }
  // Extracted so the field-commit handler can refresh JUST this box after a
  // zone/prefix/from/to edit, without a full render() -- re-rendering the
  // whole form on every keystroke would replace the input DOM nodes
  // themselves and throw the caret out of whichever field is being typed
  // into, the exact thing the field-commit handler's own comment warns
  // against for the note field.
  function freezeCoveragePreviewHTML(event,d){
    const F=FREEZE();
    if(!F||!d)return"";
    // A freeze holds SEATS, so what it can cover is every table that can
    // seat somebody -- whether or not the drawing depicted the chairs.
    const allSeatable=(event.tables||[]).filter(canSeat);
    const previewCovered=F.tablesCovered({...d,id:"__preview__"},event.tables||[]);
    const previewSeatable=previewCovered.filter(canSeat);
    const previewChairs=previewSeatable.reduce((n,x)=>n+(Number(x.capacity)||0),0);
    const coversAll=allSeatable.length>0&&previewSeatable.length>=allSeatable.length;
    return!previewCovered.length
      ?`<p class="freeze-preview freeze-preview-empty">${t("freeze.previewNone")}</p>`
      :`<p class="freeze-preview ${coversAll?"freeze-preview-all":""}">${t("freeze.preview",
          {tables:previewSeatable.length,total:allSeatable.length,chairs:previewChairs})}</p>${
        coversAll?`<p class="freeze-preview freeze-preview-all">${t("freeze.previewAll")}</p>`:""}`;
  }
  function freezeFormHTML(event){
    const d=ui.freezeDraft;
    if(!d)return"";
    const zones=zonesInPlan(event);
    const scopes=[["ZONE",t("freeze.scope.ZONE")],["TABLE_GROUP",t("freeze.scope.TABLE_GROUP")],["TABLE",t("freeze.scope.TABLE")]];
    const tables=[...(event.tables||[])].sort((a,b)=>naturalSort(a.number,b.number));
    // Live scope preview, computed from the draft exactly as it stands right
    // now -- so the fast path (open the form, touch nothing, click Freeze)
    // shows what it is about to hold back before it holds it back, not after.
    const previewHTML=`<div id="freezePreviewBox">${freezeCoveragePreviewHTML(event,d)}</div>`;
    return`<form class="freeze-form" data-freeze-form>
      <div class="field"><label for="fzScope">${t("freeze.field.scope")}</label>
        <select id="fzScope" data-freeze-field="scope">${scopes.map(([v,l])=>
          `<option value="${v}" ${d.scope===v?"selected":""}>${esc(l)}</option>`).join("")}</select></div>
      ${d.scope==="ZONE"?`<div class="field"><label for="fzZone">${t("freeze.field.zone")}</label>${
        zones.length?`<select id="fzZone" data-freeze-field="zone">${zones.map(z=>
          `<option value="${esc(z)}" ${d.zone===z?"selected":""}>${esc(z)}</option>`).join("")}</select>`
        :`<input id="fzZone" data-freeze-field="zone" value="${esc(d.zone||"")}" placeholder="${esc(t("freeze.field.zonePlaceholder"))}">`}</div>`:""}
      ${d.scope==="TABLE_GROUP"?`<div class="freeze-range">
        <div class="field"><label for="fzPrefix">${t("freeze.field.prefix")}</label><input id="fzPrefix" data-freeze-field="prefix" maxlength="4" value="${esc(d.prefix||"")}"></div>
        <div class="field"><label for="fzFrom">${t("freeze.field.from")}</label><input id="fzFrom" data-freeze-field="from" type="number" min="0" max="9999" value="${Number(d.from)||0}"></div>
        <div class="field"><label for="fzTo">${t("freeze.field.to")}</label><input id="fzTo" data-freeze-field="to" type="number" min="0" max="9999" value="${Number(d.to)||0}"></div>
      </div>`:""}
      ${d.scope==="TABLE"?`<div class="field"><label for="fzTable">${t("freeze.field.table")}</label>
        <select id="fzTable" data-freeze-field="tableId">${tables.map(x=>
          `<option value="${x.id}" ${d.tableId===x.id?"selected":""}>${esc(formatTableNumber(x.number))}</option>`).join("")}</select></div>`:""}
      <div class="field"><label for="fzReason">${t("freeze.field.reason")}</label>
        <select id="fzReason" data-freeze-field="reason">${freezeReasons().map(r=>
          `<option value="${r}" ${d.reason===r?"selected":""}>${esc(freezeReasonText(r))}</option>`).join("")}</select></div>
      <div class="field"><label for="fzNote">${t("freeze.field.note")}</label>
        <input id="fzNote" data-freeze-field="note" value="${esc(d.note||"")}" placeholder="${esc(t("freeze.field.notePlaceholder"))}"></div>
      ${previewHTML}
      <div class="freeze-form-actions">
        <button type="button" class="btn sm" data-freeze-action="cancel-form">${t("freeze.cancel")}</button>
        <button type="button" class="btn sm primary" data-freeze-action="create">${t("freeze.create")}</button>
      </div>
    </form>`;
  }
  function freezePanelHTML(event){
    const F=FREEZE();
    if(!F||isHistorical(event))return"";
    const raw=eventFreezes(event);
    const list=F.normalizeAll(raw);
    if(!list.length&&!ui.freezeDraft)
      return`<aside class="freeze-panel">
        <div class="fz-head"><strong>${t("freeze.title")}</strong></div>
        ${onboardingCalloutHTML("freezeZones")}
        <p class="fz-empty">${t("freeze.none")}</p>
        <button class="btn sm" data-freeze-action="open-form">${t("freeze.add")}</button>
      </aside>`;
    const held=F.heldCapacity(raw,event.tables||[],event.guests||[]);
    const rows=list.map(f=>{
      const covered=F.tablesCovered(f,event.tables||[]);
      const chairs=covered.filter(canSeat).reduce((n,x)=>n+logicalSeatCount(x),0);
      return`<li class="fz-row">
        <div class="fz-row-head"><b>${esc(freezeScopeText(event,f))}</b><span class="fz-reason">${esc(freezeReasonText(f.reason))}</span></div>
        <div class="fz-row-sub">${esc(t("freeze.covers",{tables:covered.length,chairs}))}${
          f.note?` · ${esc(f.note)}`:""}</div>
        <button class="btn sm" data-freeze-lift="${esc(f.id)}">${t("freeze.lift")}</button>
      </li>`;
    }).join("");
    return`<aside class="freeze-panel">
      <div class="fz-head"><strong>${t("freeze.title")}</strong><span>${
        esc(t("freeze.heldSummary",{chairs:held.chairs,open:held.open}))}</span></div>
      <ul class="fz-list">${rows}</ul>
      ${ui.freezeDraft?freezeFormHTML(event)
        :`<button class="btn sm" data-freeze-action="open-form">${t("freeze.add")}</button>`}
      <p class="fz-note">${t("freeze.panelNote")}</p>
    </aside>`;
  }
  // SUPERVISOR OVERRIDE REQUIRED. The operation is described, never performed:
  // nothing has moved while this is on screen, and Cancel leaves the room
  // exactly as it was. An override authorises THIS operation and nothing else
  // — the freeze is still standing afterwards, which is what "never silently
  // unlock" means in code rather than in a sentence.
  function freezeChallengeHTML(event){
    const c=ui.freezeChallenge;
    if(!c||isHistorical(event))return"";
    const r=c.report;
    const dir=r.directions.map(d=>t("freeze.direction."+d)).join(" · ");
    const what=r.freezes.map(f=>`<li>
      <b>${esc(freezeScopeText(event,f))}</b>
      <span>${esc(freezeReasonText(f.reason))}</span>
      ${f.note?`<em>${esc(f.note)}</em>`:""}
    </li>`).join("");
    const impact=r.tables.map(x=>`<div class="fc-row"><em>${
      esc(t("seat.tableLabel",{number:formatTableNumber(x.number)}))}</em><b>${
      x.before}/${x.capacity}</b><i>&rarr;</i><b>${x.after}/${x.capacity}</b></div>`).join("");
    return`<div class="freeze-challenge-scrim" data-freeze-scrim>
      <aside class="freeze-challenge" role="alertdialog" aria-labelledby="fcTitle">
        <div class="fc-head"><strong id="fcTitle">${t("freeze.overrideRequired")}</strong><span>${esc(dir)}</span></div>
        <div class="fc-body">
          <div class="fc-block"><h4>${t("freeze.whatIsFrozen")}</h4><ul class="fc-what">${what}</ul></div>
          <div class="fc-block"><h4>${t("freeze.affected")}</h4>
            <div class="fc-row"><em>${t("freeze.beingMoved")}</em><b>${
              esc(affectedText(r.movingRecords,r.movingPax))}</b></div>
            <div class="fc-row"><em>${t("freeze.alreadyInArea")}</em><b>${
              esc(affectedText(r.guestsInArea,r.paxInArea))}</b></div>
          </div>
          <div class="fc-block"><h4>${t("freeze.impact")}</h4>${impact}
            <div class="fc-row"><em>${t("freeze.heldChairs")}</em><b>${r.held.open}</b><i>&rarr;</i><b>${r.heldAfter.open}</b></div>
          </div>
        </div>
        <div class="fc-foot">
          <span class="fc-nothing">${t("freeze.nothingYet")}</span>
          <button class="btn sm" data-freeze-action="cancel-override">${t("seat.cancel")}</button>
          <button class="btn sm danger" data-freeze-action="override">${t("freeze.override")}</button>
        </div>
        <p class="fc-stays">${t("freeze.staysInPlace")}</p>
      </aside>
    </div>`;
  }
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
  function bindFreezeZones(){
    const event=activeEvent();
    document.querySelectorAll("[data-freeze-action]").forEach(b=>b.onclick=()=>{
      const action=b.dataset.freezeAction;
      if(action==="layer"){ui.freezeLayer=!ui.freezeLayer;render();}
      else if(action==="open-form"){
        const zones=zonesInPlan(event);
        const first=[...(event.tables||[])].sort((a,b)=>naturalSort(a.number,b.number))[0];
        const parsed=first&&FREEZE()?FREEZE().parseTableNumber(first.number):null;
        ui.freezeDraft={scope:zones.length?"ZONE":"TABLE_GROUP",zone:zones[0]||"",
          prefix:parsed?parsed.prefix:"T",from:parsed?parsed.n:1,to:parsed?parsed.n:1,
          tableId:ui.selectedTableId||(first?first.id:""),reason:"MANAGEMENT_HOLD",note:""};
        render();
      }
      else if(action==="cancel-form"){ui.freezeDraft=null;render();}
      else if(action==="create")createFreezeFromDraft();
      else if(action==="cancel-override"){ui.freezeChallenge=null;render();}
      else if(action==="override")authoriseFreezeOverride();
    });
    const loadBtn=document.querySelector("[data-load-layer]");
    if(loadBtn)loadBtn.onclick=()=>{ui.loadLayer=!ui.loadLayer;render();};
    document.querySelectorAll("[data-freeze-lift]").forEach(b=>b.onclick=()=>liftFreeze(b.dataset.freezeLift));
    // Fields whose value changes which tables the draft covers -- the coverage
    // preview box is refreshed directly for these, never via a full render(),
    // so typing in fzPrefix/fzFrom/fzTo never throws the caret out mid-edit.
    const COVERAGE_FIELDS=new Set(["zone","prefix","from","to","tableId"]);
    document.querySelectorAll("[data-freeze-field]").forEach(el=>{
      const commit=()=>{
        if(!ui.freezeDraft)return;
        const key=el.dataset.freezeField;
        ui.freezeDraft[key]=el.type==="number"?Number(el.value):el.value;
        // The scope field changes which OTHER fields the form shows at all,
        // so it alone needs the full form rebuilt.
        if(key==="scope"){render();return;}
        if(COVERAGE_FIELDS.has(key)){
          const box=document.getElementById("freezePreviewBox");
          if(box)box.innerHTML=freezeCoveragePreviewHTML(event,ui.freezeDraft);
        }
      };
      if(el.tagName==="SELECT")el.onchange=commit; else el.oninput=commit;
    });
    // Escape closes the challenge without authorising anything. A blocking
    // card with no keyboard way out is how an operator ends up clicking the
    // dangerous button to make it go away.
    const scrim=document.querySelector("[data-freeze-scrim]");
    if(scrim){
      scrim.onclick=e=>{if(e.target===scrim){ui.freezeChallenge=null;render();}};
      const btn=scrim.querySelector("[data-freeze-action='cancel-override']");
      if(btn)btn.focus();
    }
  }

  // Contextual card, not a permanent inspector: it exists only while a table
  // is selected, and closing it hands the space back to the plan.
  selectedTablePanelHTML = function(event){
    const t_=event.tables.find(x=>x.id===ui.selectedTableId);
    if(!t_)return"";
    const map=tableSeatMap(event,t_.id),occupied=tableAssignedPax(event,t_.id),empty=Math.max(0,t_.capacity-occupied);
    const selected=event.guests.find(g=>g.id===ui.selectedGuestId);
    const moving=selected&&selected.assignment&&selected.assignment.tableId!==t_.id;
    // Said on the card, not only on the canvas: the layer can be switched off,
    // and an operator about to press "Seat here" has to know what will happen.
    const F=FREEZE();
    const onIt=F?F.freezesOnTable(eventFreezes(event),t_):[];
    // A fact about the table, distinct from the freeze above: a freeze says
    // the PLACE is off-limits to the seating process until a person allows
    // it, and can be overridden for one move. Unavailable says the TABLE
    // ITSELF cannot be used tonight, and this card offers no override for it.
    const A=AVAIL();
    const unavailable=A&&A.isUnavailable(t_);
    const stranded=unavailable?Array.from({length:t_.capacity},(_,i)=>map.get(i)).filter(o=>o&&o.index===0):[];
    return`<aside class="table-card">
      <div class="table-card-head"><h3>${esc(formatTableNumber(t_.number))}</h3><span class="muted" style="font-size:11px">${esc(t_.zone||"")}</span><button class="table-card-close" data-close-table-card title="${t("seating.closeCard")}">&times;</button></div>
      ${onIt.length?`<div class="table-card-frozen">${icon("lock")}<b>${t("freeze.state.FROZEN")}</b><span>${
        esc(onIt.map(f=>freezeReasonText(f.reason)).join(" · "))}</span></div>`:""}
      ${unavailable?`<div class="table-card-unavailable">${icon("alert")}<b>${t("avail.state.UNAVAILABLE")}</b><span>${
        esc(availReasonText(t_.unavailableReason))}${t_.unavailableNote?` · ${esc(t_.unavailableNote)}`:""}</span></div>
        ${stranded.length?`<div class="table-card-stranded"><span>${esc(t(stranded.length===1?"avail.stranded.1":"avail.stranded",{n:stranded.length,pax:stranded.reduce((n,o)=>n+paxOf(o.guest),0)}))}</span>${
          stranded.map(o=>`<button class="btn sm" data-avail-select-guest="${o.guest.id}">${esc(o.guest.name)} — ${t("avail.relocate")}</button>`).join("")}</div>`:""}
      `:""}
      <div class="table-card-stats">
        <div><span>${t("seating.capacity")}</span><b>${t_.capacity}</b></div>
        <div><span>${t("seating.occupied")}</span><b>${occupied}</b></div>
        <div><span>${t("seating.empty")}</span><b>${empty}</b></div>
      </div>
      ${A?`${unavailable?"":onboardingCalloutHTML("tableAvailability")}<div class="table-card-avail">${unavailable
        ?`<button class="btn sm" data-avail-mark="${t_.id}" data-avail-next="AVAILABLE">${t("avail.markAvailable")}</button>`
        :`<select data-avail-reason required><option value="" disabled selected>${esc(t("avail.reason.CHOOSE"))}</option>${Object.keys(A.REASON).map(r=>
            `<option value="${r}">${esc(availReasonText(r))}</option>`).join("")}</select>
          <button class="btn sm danger" data-avail-mark="${t_.id}" data-avail-next="UNAVAILABLE">${t("avail.markUnavailable")}</button>`
      }</div>`:""}
      <div class="table-card-cta">${selected
        ?`<button class="btn primary sm ${unavailable?"is-blocked":""}" data-assign-selected="${t_.id}" title="${unavailable?esc(t("avail.cannotSeatHere")):""}">${t(moving?"seating.moveGuest":"seating.assignGuest",{name:selected.name,n:paxOf(selected)})}</button>`
        :`<div class="table-card-hint">${t("seating.pickGuestFirst")}</div>`}</div>
      <div class="table-card-seats">${Array.from({length:t_.capacity},(_,i)=>seatRowHTML(i,map.get(i),selected)).join("")}</div>
    </aside>`;
  };
  seatRowHTML = function(index,occupant,selected){
    if(!occupant)return`<div class="seat-row empty" data-empty-seat="${index}"><span class="seat-no">S${index+1}</span><span class="seat-person">${t("seating.seatEmpty")}</span>${selected?`<button class='seat-action'>${t("seating.assignHere")}</button>`:"<span></span>"}</div>`;
    const g=occupant.guest,label=occupant.companion?`GUEST OF ${g.name.toUpperCase()}`:g.name;
    return`<div class="seat-row ${ui.selectedGuestIds.includes(g.id)?"multi-selected":""}" draggable="${occupant.index===0}" data-occupant-guest="${occupant.index===0?g.id:""}"><span class="seat-no">S${index+1}</span><span class="seat-person">${esc(label)} ${occupant.companion?`<small>${t("seating.companion")}</small>`:""}</span>${occupant.index===0?`<span><button class="seat-action" data-lock-assignment="${g.id}">${g.assignment.locked?t("seating.unlock"):t("seating.lock")}</button> <button class="seat-action" data-unassign="${g.id}">${t("seating.unassign")}</button></span>`:"<span></span>"}</div>`;
  };
  function selectGuestRecord(id,eventLike,rows){
    const ids=rows.map(g=>g.id),index=ids.indexOf(id),anchor=ids.indexOf(ui.guestAnchorId);
    if(eventLike.shiftKey&&anchor>=0){const range=ids.slice(Math.min(anchor,index),Math.max(anchor,index)+1);ui.selectedGuestIds=eventLike.ctrlKey?[...new Set([...ui.selectedGuestIds,...range])]:range;}
    else if(eventLike.ctrlKey||eventLike.metaKey)ui.selectedGuestIds=ui.selectedGuestIds.includes(id)?ui.selectedGuestIds.filter(x=>x!==id):[...ui.selectedGuestIds,id];
    else ui.selectedGuestIds=[id];
    ui.selectedGuestId=ui.selectedGuestIds[0]||null;ui.guestAnchorId=id;
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
    const locked=guests.find(g=>g.assignment?.locked);if(locked)return toast(`${locked.name}'s assignment is locked.`,"error",5000);
    const used=occupiedSeatIndexes(event,tableId,null);for(const g of guests)if(g.assignment?.tableId===tableId)(g.assignment.seats||[]).forEach(s=>used.delete(Number(s)));
    let free=Array.from({length:table.capacity},(_,i)=>i).filter(i=>!used.has(i));if(preferred!==null&&free.includes(preferred))free=[preferred,...free.filter(i=>i!==preferred)];const required=guests.reduce((n,g)=>n+paxOf(g),0);if(free.length<required)return toast(`${table.number} has ${free.length} available chairs; the selected group needs ${required}. No assignments changed.`,"error",6000);
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
        refreshChairOccupancy(now);touchEvent(now);render();
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
      toast("The group move was rolled back.","error");
    }
  }
  assignGuestToTable = function(guestId,tableId,preferred=null,options=null){assignGuestGroup([guestId],tableId,preferred,options);};
  // unassignGuest is defined further down, where its undo lives.
  toggleAssignmentLock = function(id){const event=activeEvent();if(!canMutate(event,"change an assignment lock"))return;original.toggleAssignmentLock(id);};
  bindSeating = function(){
    bindPanelToggles();const event=activeEvent(),records=guestSelectionRows(event),search=document.getElementById("seatingSearch");
    if(search){search.oninput=()=>{ui.seatingQuery=search.value;const pos=search.selectionStart;render();requestAnimationFrame(()=>{const n=document.getElementById("seatingSearch");if(n){n.focus();n.setSelectionRange(pos,pos);}});};}
    const closeCard=document.querySelector("[data-close-table-card]");
    if(closeCard)closeCard.onclick=()=>{ui.selectedTableId=null;render();};
    document.querySelectorAll("[data-seating-scope]").forEach(b=>b.onclick=()=>{ui.seatingGuestScope=b.dataset.seatingScope;ui.selectedGuestIds=[];ui.selectedGuestId=null;render();});document.querySelectorAll("[data-seating-filter]").forEach(b=>b.onclick=()=>{ui.seatingFilter=b.dataset.seatingFilter;ui.operationalMode=false;render();});
    document.querySelectorAll("[data-seating-guest]").forEach(row=>{row.onclick=e=>{selectGuestRecord(row.dataset.seatingGuest,e,records);render();};row.ondragstart=e=>{if(!ui.selectedGuestIds.includes(row.dataset.seatingGuest))ui.selectedGuestIds=[row.dataset.seatingGuest];e.dataTransfer.setData("application/x-merit-guests",JSON.stringify(ui.selectedGuestIds));e.dataTransfer.setData("application/x-merit-guest",row.dataset.seatingGuest);};});
    document.querySelectorAll("[data-occupant-guest]").forEach(row=>{if(!row.dataset.occupantGuest)return;row.onclick=e=>{selectGuestRecord(row.dataset.occupantGuest,e,event.guests);render();};row.ondragstart=e=>{if(!ui.selectedGuestIds.includes(row.dataset.occupantGuest))ui.selectedGuestIds=[row.dataset.occupantGuest];e.dataTransfer.setData("application/x-merit-guests",JSON.stringify(ui.selectedGuestIds));};});
    // The table card's primary button. It was rendered by this file and bound
    // only by the OLD bindSeating in app-guests.js, which this file replaces --
    // so the most prominent control on the card had no handler at all and did
    // nothing when pressed. Found while building the freeze gate, which sits on
    // exactly this path.
    const assign=document.querySelector("[data-assign-selected]");
    if(assign)assign.onclick=()=>{
      const ids=ui.selectedGuestIds.length?ui.selectedGuestIds:[ui.selectedGuestId].filter(Boolean);
      if(ids.length)assignGuestGroup(ids,assign.dataset.assignSelected);
    };
    document.querySelectorAll("[data-empty-seat]").forEach(row=>row.onclick=()=>{const ids=ui.selectedGuestIds.length?ui.selectedGuestIds:[ui.selectedGuestId].filter(Boolean);if(ids.length)assignGuestGroup(ids,ui.selectedTableId,Number(row.dataset.emptySeat));});document.querySelectorAll("[data-unassign]").forEach(b=>b.onclick=()=>unassignGuest(b.dataset.unassign));document.querySelectorAll("[data-lock-assignment]").forEach(b=>b.onclick=()=>toggleAssignmentLock(b.dataset.lockAssignment));
    // Mark unavailable / mark available — the table card's own axis, next to
    // the freeze indicator but never touching it: marking a table unavailable
    // writes nothing but `availability` and its provenance.
    const availBtn=document.querySelector("[data-avail-mark]");
    if(availBtn)availBtn.onclick=()=>{
      const ev=activeEvent();if(!canMutate(ev,"change a table's availability"))return;
      const table=ev.tables.find(x=>x.id===availBtn.dataset.availMark);if(!table)return;
      const next=availBtn.dataset.availNext;
      const reasonEl=document.querySelector("[data-avail-reason]");
      if(next==="UNAVAILABLE"&&reasonEl&&!reasonEl.value){toast(t("avail.reasonRequiredToast"),"error");return;}
      setTableAvailability(ev,table,next,reasonEl?reasonEl.value:null);
      touchEvent(ev);render();
      toast(t(next==="UNAVAILABLE"?"avail.markedUnavailableToast":"avail.markedAvailableToast",
        {number:formatTableNumber(table.number)}),next==="UNAVAILABLE"?"error":"success");
    };
    // Selecting a stranded guest reuses the exact selection Smart Seating
    // already reads — this never moves anyone; it only shows recommendations
    // for the person selected, the same as picking them from the queue.
    document.querySelectorAll("[data-avail-select-guest]").forEach(b=>b.onclick=()=>{
      ui.selectedGuestId=b.dataset.availSelectGuest;ui.selectedGuestIds=[b.dataset.availSelectGuest];render();
    });
  };

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
  // ---- THE ARRIVAL WAVE -----------------------------------------------------
  //
  // Expected and actual, side by side, and never merged. src/arrival-wave.js
  // owns the arithmetic; this renders it and nothing else computes it, so the
  // Command Center's summary and the Live timeline cannot disagree.
  //
  // The degraded mode is the DEFAULT, not an error state: no guest record in
  // this product carries a stated arrival window unless a person typed one, so
  // most events will honestly have no expected axis at all. The screen says
  // that plainly rather than drawing a flat line at zero.
  let waveMemo={event:null,epoch:-1,step:null,wave:null};
  function arrivalWave(event){
    const W=globalThis.MeritArrivalWave;
    if(!W||!event)return null;
    const step=ui.waveBucket||30;
    if(waveMemo.event===event&&waveMemo.epoch===mutationEpoch&&waveMemo.step===step)return waveMemo.wave;
    waveMemo={event,epoch:mutationEpoch,step,
      wave:W.build({guests:event.guests||[],bucketMinutes:step})};
    return waveMemo.wave;
  }
  // The guests one selected wave is about, so the Live list can narrow to them.
  function waveGuestIds(event,key){
    const w=arrivalWave(event);
    const b=w&&w.buckets.find(x=>x.key===key);
    if(!b)return null;
    return new Set([...(b.expected?b.expected.guestIds:[]),...b.actual.guestIds]);
  }
  // The wave's own controls (bucket size, click-a-bar, VIP toggle, clear).
  // Shared by Live (the working timeline) and Reports' Post-Event Replay for
  // a historical event -- one binding, so a bucket click means the same
  // thing on either screen rather than two handlers drifting apart.
  function bindArrivalWaveControls(){
    document.querySelectorAll("[data-wave-bucket]").forEach(b=>b.onclick=()=>{
      ui.waveBucket=Number(b.dataset.waveBucket);ui.waveKey=null;render();});
    document.querySelectorAll("[data-wave-key]").forEach(b=>b.onclick=()=>{
      // Selecting the wave already selected clears it: the way out of a filter
      // is the control that put you in it, as well as the banner's own button.
      ui.waveKey=ui.waveKey===b.dataset.waveKey?null:b.dataset.waveKey;
      ui.waveVip=false;ui.liveWindow=null;render();});
    const waveVip=document.querySelector("[data-wave-vip]");
    if(waveVip)waveVip.onclick=()=>{ui.waveVip=!ui.waveVip;ui.waveKey=null;ui.liveWindow=null;render();};
    const waveClear=document.querySelector("[data-wave-clear]");
    if(waveClear)waveClear.onclick=()=>{ui.waveKey=null;ui.waveVip=false;render();};
  }
  // A bar pair per bucket. Heights are scaled to the busiest bucket in THIS
  // event, which is a drawing decision and not a claim -- the numbers are on
  // the row, and the tallest bar never means "full".
  function arrivalWaveHTML(event,{compact=false}={}){
    const w=arrivalWave(event);
    if(!w)return"";
    const head=`<div class="aw-head"><div><strong>${t("wave.title")}</strong><p>${t("wave.question")}</p></div>
      ${compact?"":`<div class="aw-steps" role="group" aria-label="${esc(t("wave.bucketLabel"))}">${
        [15,30,60].map(n=>`<button class="seg-btn ${w.bucketMinutes===n?"active":""}" data-wave-bucket="${n}">${
          t("wave.minutes",{n})}</button>`).join("")}</div>`}</div>`;
    if(!w.buckets.length)
      return`<section class="arrival-wave ${compact?"compact":""}">${head}
        <p class="aw-empty">${t("wave.nothingYet")}</p></section>`;
    const peak=Math.max(1,...w.buckets.map(b=>Math.max(b.expected?b.expected.pax:0,b.actual.pax)));
    const bars=w.buckets.map(b=>{
      const on=ui.waveKey===b.key;
      const eh=b.expected?Math.round(b.expected.pax/peak*100):0;
      const ah=Math.round(b.actual.pax/peak*100);
      return`<button class="aw-bucket ${on?"active":""}" data-wave-key="${esc(b.key)}"
        title="${esc(t("wave.bucketTitle",{from:b.from,to:b.to}))}">
        <span class="aw-bars">${b.expected
          ?`<i class="aw-bar expected" style="height:${Math.max(eh,b.expected.pax?3:0)}%"></i>`:""}
          <i class="aw-bar actual" style="height:${Math.max(ah,b.actual.pax?3:0)}%"></i></span>
        <span class="aw-time">${esc(b.from)}</span>
        <span class="aw-count">${b.expected?`${b.expected.pax}/`:""}${b.actual.pax}</span>
      </button>`;
    }).join("");
    // The expected axis is either real or absent, and the legend says which.
    const legend=w.expected.available
      ?`<span class="aw-key"><i class="aw-bar expected"></i>${t("wave.expected")}</span>
        <span class="aw-key"><i class="aw-bar actual"></i>${t("wave.actual")}</span>${
        w.expected.coverage==="PARTIAL"?`<span class="aw-partial">${
          esc(t("wave.partial",{stated:w.expected.statedRecords,total:w.expected.totalRecords}))}</span>`:""}`
      :`<span class="aw-key"><i class="aw-bar actual"></i>${t("wave.actual")}</span>
        <span class="aw-none">${t("wave.noExpected")}</span>`;
    const untimed=w.actual.untimedRecords
      ?`<p class="aw-untimed">${esc(t("wave.untimed",{records:w.actual.untimedRecords,pax:w.actual.untimedPax}))}</p>`:"";
    const vip=w.vipStillExpected.records
      ?`<button class="aw-vip" data-wave-vip>${esc(t("wave.vipOutstanding",{
        records:w.vipStillExpected.records,pax:w.vipStillExpected.pax}))}</button>`:"";
    return`<section class="arrival-wave ${compact?"compact":""}">${head}
      <div class="aw-chart">${bars}</div>
      <div class="aw-legend">${legend}</div>
      ${vip}${untimed}
      <p class="aw-note">${t("wave.noForecast")}</p>
    </section>`;
  }
  // What the selection currently narrows the Live list to, and the way out.
  function waveFilterBannerHTML(event){
    if(!ui.waveKey&&!ui.waveVip)return"";
    const w=arrivalWave(event);
    if(!w)return"";
    if(ui.waveVip)
      return`<div class="wave-banner">${icon("users")}<span>${
        esc(t("wave.showingVip",{pax:w.vipStillExpected.pax}))}</span><button class="btn sm" data-wave-clear>${
        t("wave.clearFilter")}</button></div>`;
    const b=w.buckets.find(x=>x.key===ui.waveKey);
    if(!b)return"";
    return`<div class="wave-banner">${icon("search")}<span>${
      esc(t("wave.showingWave",{from:b.from,to:b.to,
        expected:b.expected?b.expected.pax:0,actual:b.actual.pax}))}</span><button class="btn sm" data-wave-clear>${
      t("wave.clearFilter")}</button></div>`;
  }

  const ARRIVAL_ORDER={"Not Arrived":0,"Checked In":1,"No Show":2};
  // What the current search actually narrowed to, so the Enter key acts on
  // exactly the rows the operator can see. Deliberately a local, not ui state:
  // it is a property of the last render, and must never reach the stored schema.
  let liveVisibleIds=[];
  // How many arrival rows are mounted at a time, and how much a scroll adds.
  // Sized to comfortably overfill the tallest supported viewport so the first
  // screen is never short, without paying for 3,000 rows.
  const LIVE_WINDOW_STEP=60;
  liveHTML = function(event){
    const q=ui.liveQuery.trim(),s=liveStats(event);
    if(!ui.liveRecent)ui.liveRecent=[];
    const byId=tableIndex(event);
    // The wave selection narrows the SAME list the search does, rather than
    // opening a second one: selecting 19:30 is a filter on the door queue, and
    // the operator has to be able to work straight out of it and then leave.
    const waveIds=ui.waveKey?waveGuestIds(event,ui.waveKey):null;
    const vipIds=ui.waveVip?new Set(arrivalWave(event)?.vipStillExpected.guestIds||[]):null;
    // Same engine as the Global Finder (matchGuestRows): a query at the door
    // matches exactly the guests it would match in the appbar search — same
    // haystack (name, VIP, host, notes, both statuses, table number/zone),
    // same AND-narrowing across terms. Only the sort differs, on purpose:
    // Live orders "who is still outside" first, never by name-match rank.
    const matchedIds=q?new Set(matchGuestRows(event,q).rows.map(r=>r.guest.id)):null;
    const rows=event.guests
      .filter(g=>!waveIds||waveIds.has(g.id))
      .filter(g=>!vipIds||vipIds.has(g.id))
      .filter(g=>!matchedIds||matchedIds.has(g.id))
      // Not Arrived first: on event night the operator's list is "who is still
      // outside", not an alphabetical roster.
      .sort((a,b)=>(ARRIVAL_ORDER[a.arrivalStatus]-ARRIVAL_ORDER[b.arrivalStatus])||naturalSort(a.name,b.name));
    liveVisibleIds=rows.map(g=>g.id);
    // Enter only fires when the search has narrowed to a single person, and the
    // screen says whose door it is about to open. Checking in the wrong guest
    // is worse than one more keystroke, so there is no "top match wins" rule.
    const armedId=q&&rows.length===1&&rows[0].arrivalStatus!=="Checked In"?rows[0].id:null;
    const metrics=[
      `<div class="mx-metric is-hero is-good"><span class="mx-metric-label">${t("live.arrived")}</span><span class="mx-metric-value">${s.checked}</span><span class="mx-metric-note">${t("live.arrivedNote",{total:s.total})}</span></div>`,
      `<div class="mx-metric"><span class="mx-metric-label">${t("live.stillExpected")}</span><span class="mx-metric-value">${s.notArrived}</span><span class="mx-metric-note">${t("live.stillExpectedNote")}</span></div>`,
      `<div class="mx-metric ${s.noShow?"is-alert":""}"><span class="mx-metric-label">${t("live.kpi.noShow")}</span><span class="mx-metric-value">${s.noShow}</span><span class="mx-metric-note">${t("live.kpi.noShowNote")}</span></div>`,
      `<button class="mx-metric" data-live-kpi="empty"><span class="mx-metric-label">${t("live.kpi.emptyTables")}</span><span class="mx-metric-value">${s.emptyTables}</span><span class="mx-metric-note">${t("live.kpi.emptyTablesNote")}</span></button>`,
      `<button class="mx-metric" data-live-kpi="available"><span class="mx-metric-label">${t("live.kpi.emptyChairs")}</span><span class="mx-metric-value">${s.emptyChairs}</span><span class="mx-metric-note">${t("live.kpi.emptyChairsNote")}</span></button>`,
    ].join("");
    const recent=ui.liveRecent.length?ui.liveRecent.map(r=>`<div class="recent-item"><span class="arr-state ${r.to==="Checked In"?"in":r.to==="No Show"?"no":"not"}">${esc(t("status.arrival."+r.to))}</span><b>${esc(r.name)}</b><button class="undo-link" data-live-undo="${r.guestId}">${t("live.undo")}</button></div>`).join(""):`<div class="recent-item" style="color:var(--muted)">${t("live.recentEmpty")}</div>`;
    // Only the rows an operator can actually reach are built.
    //
    // Measured on 3,000 guests: first paint was 587ms median / 778ms p95,
    // split build 203 / parse 233 / layout 164, for 46,141 DOM nodes and
    // 1.9MB of HTML. There is no single hotspot to fix -- the cost IS
    // building every row -- so the fix is to stop building rows nobody sees.
    //
    // Nothing above this line changes: the filter, the arrival sort, the
    // metric strip, and liveVisibleIds (which arms Enter-to-check-in and must
    // reflect the WHOLE match set, or Enter would fire on the wrong person)
    // all still run over every guest. Only the DOM is capped, and the window
    // grows on scroll so the list is still fully browsable.
    const windowed=rows.slice(0,ui.liveWindow||LIVE_WINDOW_STEP);
    const hiddenCount=rows.length-windowed.length;
    const list=rows.length?windowed.map(g=>{
      const isIn=g.arrivalStatus==="Checked In",isNo=g.arrivalStatus==="No Show";
      const armed=g.id===armedId;
      return`<div class="arrival-row ${isIn?"is-in":isNo?"is-no":""} ${armed?"is-armed":""}">
        <div class="arrival-who"><div class="party-name">${esc(g.name)}</div><div class="party-sub">${partyMetaHTML(g)}</div></div>
        <div>${seatTagHTML(event,g,byId)}</div>
        <div><span class="arr-state ${isIn?"in":isNo?"no":"not"}">${esc(t("status.arrival."+g.arrivalStatus))}</span></div>
        <div class="arrival-actions">
          ${armed?`<kbd class="enter-key" title="${t("live.armedTitle")}">${t("live.armed")} ↵</kbd>`:""}
          <button class="btn-arrive ${isIn?"undo":"go"}" data-arrival="Checked In" data-live-guest="${g.id}">${isIn?t("live.undoCheckIn"):t("live.checkInAction")}</button>
          <button class="btn-arrive ${isNo?"undo":"no"}" data-arrival="No Show" data-live-guest="${g.id}">${isNo?t("live.undo"):t("live.noShow")}</button>
        </div>
      </div>`;
    }).join(""):`<div class="mx-empty"><h3>${q?t("live.noResults"):t("live.allArrived")}</h3></div>`;
    return`<div class="mx-screen"><div class="mx-wrap">
      <div class="mx-head"><div><h1>${t("live.title")}</h1><p>${t("live.subtitle")}</p></div></div>
      <div class="mx-metrics">${metrics}</div>
      <div class="live-stage">
        <div>
          <div class="live-search-hero"><span class="hero-icon">${icon("search")}</span><input id="liveSearch" value="${esc(ui.liveQuery)}" placeholder="${t("live.searchHero")}" autocomplete="off"></div>
          <p class="live-hint">${t("live.hint")}<br>${t("live.enterHint")}</p>
          ${waveFilterBannerHTML(event)}
          <div class="mx-list" id="liveList" style="margin-top:12px">${list}</div>
          ${hiddenCount>0?`<div class="live-more" id="liveMore"><span>${t("live.showingOf",{shown:windowed.length,total:rows.length})}</span><button class="btn sm" data-live-action="show-more">${t("live.showMore")}</button></div>`:""}
        </div>
        <aside class="live-aside">${arrivalWaveHTML(event)}
          <div class="live-aside-head">${t("live.recentTitle")}</div>${recent}</aside>
      </div>
    </div></div>`;
  };
  // render() replaces the input node, so focus has to be re-established by hand
  // after every keystroke -- otherwise the operator types one letter and loses
  // the field.
  function focusLiveSearch(caret){
    requestAnimationFrame(()=>{
      const n=document.getElementById("liveSearch");if(!n)return;
      n.focus();
      const pos=caret==null?n.value.length:caret;
      n.setSelectionRange(pos,pos);
    });
  }
  bindLive = function(){
    const search=document.getElementById("liveSearch");
    if(search){
      search.oninput=()=>{
        ui.liveQuery=search.value;
        // A new search is a new list, so the window starts again from the top.
        ui.liveWindow=LIVE_WINDOW_STEP;
        const pos=search.selectionStart;
        render();
        focusLiveSearch(pos);
      };
      // The door flow: type a name, press Enter, type the next name. The query
      // clears on a successful check-in so the operator never has to reach for
      // the mouse between two guests.
      search.onkeydown=e=>{
        // stopPropagation: the window-level Escape handler would otherwise fire a
        // second render for a key that means only "clear this field".
        if(e.key==="Escape"){e.preventDefault();e.stopPropagation();ui.liveQuery="";render();focusLiveSearch();return;}
        if(e.key!=="Enter")return;
        e.preventDefault();
        if(!ui.liveQuery.trim())return;
        const event=activeEvent();if(!canMutate(event,"change live arrival status"))return;
        if(!liveVisibleIds.length)return;
        if(liveVisibleIds.length>1){toast(t("live.tooMany",{n:liveVisibleIds.length}));return;}
        const g=event.guests.find(x=>x.id===liveVisibleIds[0]);if(!g)return;
        if(g.arrivalStatus==="Checked In"){toast(t("live.alreadyIn",{name:g.name}));return;}
        const from=g.arrivalStatus;
        // Same single axis as the buttons: arrivalStatus only. planningStatus
        // and the planned seat assignment are untouched.
        setArrival(event,g,"Checked In","live-keyboard");
        recordArrival(g,from,"Checked In");
        ui.liveQuery="";
        touchEvent(event);render();focusLiveSearch();
        toast(t("live.checkedInToast",{name:g.name}),"success");
      };
      // Event night: the operator walks up and types. Claim focus only when
      // nothing else already has it, so this never steals from another field.
      if(document.activeElement===document.body)search.focus();
    }
    bindArrivalWaveControls();
    document.querySelectorAll("[data-live-kpi]").forEach(b=>b.onclick=()=>{
      ui.tab="seating";ui.seatingFilter=b.dataset.liveKpi;ui.seatingGuestScope="all";ui.seatingQuery="";
      ui.operationalMode=true;ui.selectedGuestIds=[];ui.selectedGuestId=null;ui.selectedTableId=null;render();
    });
    document.querySelectorAll("[data-live-guest]").forEach(b=>b.onclick=()=>{
      const event=activeEvent();if(!canMutate(event,"change live arrival status"))return;
      const g=event.guests.find(x=>x.id===b.dataset.liveGuest),status=b.dataset.arrival;
      const from=g.arrivalStatus;
      // Arrival status is its own axis: this writes arrivalStatus and nothing
      // else. planningStatus and the planned seat assignment are untouched.
      setArrival(event,g,from===status?"Not Arrived":status,"live-buttons");
      recordArrival(g,from,g.arrivalStatus);
      touchEvent(event);render();
      if(g.arrivalStatus==="No Show")toast(t("live.noShowKeepsSeat"),"success",5200);
      else if(g.arrivalStatus==="Checked In")toast(t("live.checkedInToast",{name:g.name}),"success");
      else toast(t("live.undoneToast",{name:g.name}));
    });
    // Growing the window must NOT go through render(): a full re-render would
    // throw away the scroll position the operator just used to get here. The
    // extra rows are appended and the new buttons bound, nothing else moves.
    const growLive=()=>{
      const event=activeEvent();
      const before=ui.liveWindow||LIVE_WINDOW_STEP;
      ui.liveWindow=before+LIVE_WINDOW_STEP;
      const scroller=document.querySelector(".mx-screen")||document.scrollingElement;
      const keep=scroller?scroller.scrollTop:0;
      render();
      if(scroller)scroller.scrollTop=keep;
    };
    const more=document.querySelector("[data-live-action='show-more']");
    if(more)more.onclick=growLive;
    // Reaching the end of the list grows it without asking, so the button is a
    // fallback for keyboard and assistive use rather than the only way through.
    const sentinel=document.getElementById("liveMore");
    if(sentinel&&typeof IntersectionObserver==="function"){
      const io=new IntersectionObserver(entries=>{
        if(entries.some(e=>e.isIntersecting)){io.disconnect();growLive();}
      },{rootMargin:"400px"});
      io.observe(sentinel);
    }
    document.querySelectorAll("[data-live-undo]").forEach(b=>b.onclick=()=>{
      const event=activeEvent();if(!canMutate(event,"change live arrival status"))return;
      const id=b.dataset.liveUndo,entry=(ui.liveRecent||[]).find(r=>r.guestId===id),g=event.guests.find(x=>x.id===id);
      if(!entry||!g)return;
      setArrival(event,g,entry.from,"live-undo");
      ui.liveRecent=ui.liveRecent.filter(r=>r.guestId!==id);
      touchEvent(event);render();toast(t("live.undoneToast",{name:g.name}));
    });
  };
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
  function setArrival(event,guest,next,source){
    if(!event||!guest)return null;
    const from=guest.arrivalStatus;
    if(!["Not Arrived","Checked In","No Show"].includes(next))return null;
    guest.arrivalStatus=next;
    // The moment is kept only while the status it describes is true. A guest
    // who is un-checked-in, or turned into a No Show, has no arrival time —
    // leaving a stale one would put a person on the arrival curve who is not
    // in the room.
    if(next==="Checked In"){ if(!guest.checkedInAt)guest.checkedInAt=nowISO(); }
    else guest.checkedInAt=null;
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
    if(!event||!table)return null;
    const A=AVAIL();
    if(!A||!["AVAILABLE","UNAVAILABLE"].includes(next))return null;
    const from=table.availability||A.STATE.AVAILABLE;
    table.availability=next;
    if(next==="UNAVAILABLE"){
      table.unavailableReason=A.REASON[reason]||A.REASON.OTHER;
      table.unavailableNote=String(note||"").slice(0,400);
      // Kept from the first time this table failed tonight, not reset on a
      // second edit -- a table cannot become "more recently" unavailable.
      table.unavailableSince=table.unavailableSince||nowISO();
    }else{
      table.unavailableReason=null;table.unavailableNote="";table.unavailableSince=null;
    }
    audit(event,"TABLE_AVAILABILITY_CHANGED",{tableId:table.id,from,to:next,
      reason:table.unavailableReason});
    return{from,to:next};
  }

  function recordArrival(g,from,to){
    if(!ui.liveRecent)ui.liveRecent=[];
    ui.liveRecent=ui.liveRecent.filter(r=>r.guestId!==g.id);
    if(from!==to)ui.liveRecent.unshift({guestId:g.id,name:g.name,from,to});
    ui.liveRecent=ui.liveRecent.slice(0,6);
  }

  // ---- Excel import wizard: same design language, same five steps ------
  // Presentation only. app-guests.js keeps the reading, mapping, interpreting
  // and importing logic untouched -- including the rule that nothing is
  // written until step 5 and that blocking errors disable the import.
  const WIZ_STEPS=["wiz.step.file","wiz.step.preview","wiz.step.mapping","wiz.step.interpret","wiz.step.summary"];
  wizardStepsHTML = function(step){
    return`<div class="wz-rail">${WIZ_STEPS.map((k,i)=>`<div class="wz-node ${step===i+1?"active":step>i+1?"done":""}"><i>${step>i+1?"✓":i+1}</i><span>${t(k)}</span></div>`).join("")}</div>`;
  };
  // Labels are translated; the option VALUE stays the identifier the importer
  // writes against, so a Turkish UI never changes what a column maps to.
  mappingRowsHTML = function(p){
    return p.headers.map(h=>`<div class="wz-map"><div class="wz-map-src" title="${esc(h)}">${esc(h)}</div><div class="wz-map-arrow">→</div><select data-map-header="${esc(h)}">${MAP_FIELDS.map(([v])=>`<option value="${v}" ${p.mapping[h]===v?"selected":""}>${t(v?"wiz.map."+v:"wiz.map.ignore")}</option>`).join("")}</select></div>`).join("");
  };
  sourcePreviewHTML = function(p){
    return`<table class="wz-table"><thead><tr><th>#</th>${p.headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${p.rows.slice(0,15).map((row,i)=>`<tr><td>${i+1}</td>${p.headers.map(h=>`<td>${esc(row[h])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };
  // The message the importer stored stays English -- app-guests.js matches on
  // it to decide which issues survive a re-check. Only the drawn text changes.
  function wizIssueText(message){
    return typeof translateImportIssue==="function"?translateImportIssue(message):message;
  }
  interpretRowHTML = function(r,i){
    const issues=r.issues||[];
    const sel=(field,values,current)=>`<select data-interp-row="${i}" data-interp-field="${field}">${values.map(v=>`<option value="${v}" ${current===v?"selected":""}>${field==="planningStatus"?t("status.planning."+v):esc(v)}</option>`).join("")}</select>`;
    return`<tr>
      <td class="src" title="${esc(r.sourceName)}">${esc(r.sourceName)}</td>
      <td><input data-interp-row="${i}" data-interp-field="name" value="${esc(r.name)}"></td>
      <td class="num"><input data-interp-row="${i}" data-interp-field="additionalGuests" type="number" min="0" value="${r.additionalGuests}"></td>
      <td class="pax"><b>${r.pax}</b></td>
      <td>${sel("planningStatus",["Confirmed","Tentative"],r.planningStatus)}</td>
      <td>${sel("vip",["Standard","VIP","VVIP"],r.vip)}</td>
      <td><input data-interp-row="${i}" data-interp-field="tableNumber" value="${esc(r.tableNumber||"")}"></td>
      <td><input data-interp-row="${i}" data-interp-field="seatText" value="${esc(r.seatText||"")}"></td>
      <td>${issues.length?issues.map(x=>`<div class="wz-issue ${x.level}">⚠ ${esc(wizIssueText(x.message))}</div>`).join(""):`<span class="wz-ok">✓ ${t("wiz.ready")}</span>`}</td>
    </tr>`;
  };
  wizardBodyHTML = function(p){
    if(p.step===1)return`<div class="wz-drop">${icon("download")}<h3>${t("wiz.chooseTitle")}</h3><p>${t("wiz.chooseNote")}</p><div class="toolbar-row" style="justify-content:center;margin-top:6px"><button class="btn" data-wizard-template>${icon("download")}${t("wiz.template")}</button><button class="btn primary" data-wizard-choose>${icon("plus")}${t("wiz.choose")}</button></div></div>`;
    if(p.step===2)return`<h3 class="wz-title">${t("wiz.previewTitle")}</h3><p class="wz-note">${t("wiz.previewNote",{file:esc(p.fileName),shown:Math.min(15,p.rows.length),total:p.rows.length})}</p><div class="wz-scroll">${sourcePreviewHTML(p)}</div>`;
    if(p.step===3)return`<h3 class="wz-title">${t("wiz.mapTitle")}</h3><p class="wz-note">${t("wiz.mapNote")}</p><div style="max-width:780px">${mappingRowsHTML(p)}</div>`;
    if(p.step===4)return`<h3 class="wz-title">${t("wiz.interpTitle")}</h3><p class="wz-note">${t("wiz.interpNote")}</p><div class="wz-scroll"><table class="wz-table interp"><colgroup><col class="c-source"><col class="c-name"><col class="c-num"><col class="c-num"><col class="c-status"><col class="c-vip"><col class="c-table"><col class="c-seat"><col class="c-check"></colgroup><thead><tr><th>${t("wiz.col.source")}</th><th>${t("wiz.map.name")}</th><th>${t("wiz.col.additional")}</th><th>${t("wiz.col.totalPax")}</th><th>${t("wiz.map.planningStatus")}</th><th>${t("wiz.map.vip")}</th><th>${t("wiz.col.table")}</th><th>${t("wiz.col.seat")}</th><th>${t("wiz.col.validation")}</th></tr></thead><tbody>${p.interpreted.map((r,i)=>interpretRowHTML(r,i)).join("")}</tbody></table></div>`;
    const s=importSummary(p.interpreted);
    return`<h3 class="wz-title">${t("wiz.sumTitle")}</h3><p class="wz-note">${t("wiz.sumNote")}</p>
      <div class="wz-sum">
        <div><span>${t("wiz.sum.records")}</span><b>${s.records}</b></div>
        <div><span>${t("wiz.sum.guests")}</span><b>${s.guests}</b></div>
        <div><span>${t("wiz.sum.confirmed")}</span><b>${s.confirmed}</b></div>
        <div><span>${t("wiz.sum.tentative")}</span><b>${s.tentative}</b></div>
        <div><span>${t("wiz.sum.attention")}</span><b>${s.attention}</b></div>
      </div>
      ${s.errors?`<div class="wz-banner stop">${t("wiz.blocking",{n:s.errors})}</div>`:`<div class="wz-banner ok">${t("wiz.readyToImport",{records:s.records,guests:s.guests})}</div>`}`;
  };
  wizardFootHTML = function(p){
    if(p.step===1)return`<button class="btn" data-wizard-close>${t("setup.cancel")}</button>`;
    const back=`<button class="btn" data-wizard-back>${t("wiz.back")}</button>`;
    if(p.step===2)return`${back}<button class="btn primary" data-wizard-next>${t("wiz.toMapping")}${icon("arrow")}</button>`;
    if(p.step===3)return`${back}<button class="btn primary" data-wizard-next>${t("wiz.toInterpret")}${icon("arrow")}</button>`;
    if(p.step===4)return`${back}<button class="btn primary" data-wizard-next>${t("wiz.toSummary")}${icon("arrow")}</button>`;
    const s=importSummary(p.interpreted);
    return`${back}<button class="btn primary" data-wizard-import ${s.errors?"disabled":""}>${t("wiz.import")}</button>`;
  };
  renderExcelWizard = function(){
    const root=document.getElementById("excelWizard"),p=pendingImport;if(!p||!root)return;
    // id="wizTitle" is what #excelDialog's aria-labelledby points at, so the
    // dialog announces itself by name rather than as an unnamed dialog.
    root.innerHTML=`<div class="wz-head"><h2 id="wizTitle">${t("wiz.title")}</h2><button class="table-card-close" data-wizard-close aria-label="${t("wiz.close")}" title="${t("wiz.close")}">&times;</button></div>${wizardStepsHTML(p.step)}<div class="wz-body">${wizardBodyHTML(p)}</div><div class="wz-foot">${wizardFootHTML(p)}</div>`;
    bindExcelWizard();
  };

  // ---- Reports: catch problems BEFORE the workbook leaves the building --
  // The screen is free to change; the workbook contract is frozen. Nothing
  // here touches makeTablePlanSheet / makeListSheet / seatExportName.
  // The Audit Trail lives in Reports because it is history, not a live
  // screen — it stays reachable for a completed event exactly when an
  // operator most wants it, unlike the Command Center. Newest first, exactly
  // the order state.audit already keeps; nothing here re-sorts or groups.
  function auditTrailHTML(event){
    const T=TRAIL();
    const trail=resolvedAuditTrail(event);
    // HOW MANY ROWS TO PAINT is a rendering decision and nothing else. It
    // used to be answered by DELETING entries at 1,000, which is why this
    // window and the retention ceiling are now two different numbers from
    // two different constants. The window always states its own total --
    // a window that does not reads as the whole truth.
    const w=T?T.displayWindow(trail):{rows:trail,total:trail.length,hidden:0};
    // WHAT WAS ACTUALLY LOST, if anything. The old banner said the oldest
    // entries "may have been superseded", because nothing had counted them.
    // This one appears only when something really went, and says how much
    // and from when.
    const r=state.auditRetention;
    const lost=r&&r.evicted
      ?`<p class="audit-cap-notice">${esc(r.oldestDroppedAt
          ?t("audit.evictedSince",{n:r.evicted,since:fmtDate(String(r.oldestDroppedAt).slice(0,10))})
          :t("audit.evicted",{n:r.evicted}))}</p>`
      :"";
    return`<div class="mx-section"><div class="mx-section-head"><h2>${t("audit.title")}</h2><span class="count">${w.total}</span></div>
      <p class="audit-question">${t("audit.question")}</p>
      ${lost}
      ${w.hidden?`<p class="audit-more">${esc(t("audit.showingNewest",{shown:w.rows.length,total:w.total}))}</p>`:""}
      ${w.rows.length
        ?`<ul class="audit-trail">${w.rows.map(entry=>`<li class="audit-row"><span class="audit-text">${esc(auditTrailText(event,entry))}</span><span class="audit-when">${esc(relativeTime(entry.at))}</span></li>`).join("")}</ul>`
        :`<div class="mx-empty" style="padding:28px">${t("audit.none")}</div>`}
    </div>`;
  }
  // ---- POST-EVENT REPLAY -----------------------------------------------
  //
  // Only for a finished event, and only ever a different VIEW of two facts
  // this build already owns -- the Audit Trail's own decisions (src/audit-
  // trail.js, reused via resolvedAuditTrail/auditTrailText, never re-scoped
  // here) and the Arrival Wave's own chart (arrivalWaveHTML, reused as-is,
  // since a closed event's arrival data is now a stable historical record).
  // src/post-event-replay.js supplies the one thing neither already does:
  // oldest-first order, and "did this happen inside that bucket's window."
  //
  // The Audit Trail section (auditTrailHTML, above) stays exactly as it was
  // for a historical event -- unrelated concept (a decision log, newest-
  // first, always reachable) with its own suite; Replay sits above it as an
  // additional, richer read of the same underlying decisions.
  function postEventReplayHTML(event){
    const R=globalThis.MeritPostEventReplay,AW=globalThis.MeritArrivalWave;
    if(!R||!AW||!isHistorical(event))return"";
    const all=R.chronological(resolvedAuditTrail(event));
    const w=arrivalWave(event);
    const bucket=w&&ui.waveKey?w.buckets.find(b=>b.key===ui.waveKey):null;
    const entries=bucket?R.windowed(all,bucket,{minutesOfStamp:AW.minutesOfStamp,minutesOfClock:AW.minutesOfClock}):all;
    const rowHTML=entry=>{
      const mins=AW.minutesOfStamp(entry.at);
      const when=mins===null?relativeTime(entry.at):AW.clockOfMinutes(mins);
      return`<li class="replay-row"><span class="replay-when">${esc(when)}</span><span class="replay-text">${esc(auditTrailText(event,entry))}</span></li>`;
    };
    return`<div class="mx-section replay-section"><div class="mx-section-head"><h2>${t("replay.title")}</h2><span class="count">${entries.length}</span></div>
      <p class="replay-question">${t("replay.question")}</p>
      ${arrivalWaveHTML(event)}
      ${bucket?`<div class="wave-banner">${icon("search")}<span>${esc(t("replay.filteredCount",{n:entries.length}))}</span><button class="btn sm" data-wave-clear>${t("wave.clearFilter")}</button></div>`:""}
      ${entries.length
        ?`<ol class="replay-trail">${entries.map(rowHTML).join("")}</ol>`
        :`<div class="mx-empty" style="padding:28px">${t(bucket?"replay.noneInWindow":"replay.none")}</div>`}
    </div>`;
  }
  reportsHTML = function(event){
    const m=eventMetrics(event),s=seatingStats(event),issues=planIssues(event);
    const unassigned=event.guests.filter(g=>!g.assignment),unassignedPax=unassigned.reduce((n,g)=>n+paxOf(g),0);
    const fixFor=i=>`<button class="pf-fix" data-report-fix="${i.fix||"seating"}">${t(i.fix==="floor"?"reports.fixFloor":"reports.fixSeating")}</button>`;
    const preflight=issues.length
      ?issues.map(i=>`<div class="pf-item ${i.level}"><i class="pf-dot"></i><div class="pf-text"><b>${esc(i.title)}</b><span>${esc(i.text)}</span></div>${fixFor(i)}</div>`).join("")
      :`<div class="pf-item ok"><i class="pf-dot"></i><div class="pf-text"><b>${t("reports.preflightOk")}</b><span>${t("reports.preflightOkNote")}</span></div></div>`;
    const capacity=[
      `<div class="mx-metric is-hero"><span class="mx-metric-label">${t("reports.totalCapacity")}</span><span class="mx-metric-value">${m.total}</span><span class="mx-metric-note">${t("reports.tablesCount",{n:event.tables.length})}</span></div>`,
      `<div class="mx-metric"><span class="mx-metric-label">${t("reports.assignedGuests")}</span><span class="mx-metric-value">${m.assigned}</span><span class="mx-metric-note">${t("reports.live")}</span></div>`,
      `<div class="mx-metric"><span class="mx-metric-label">${t("reports.emptyChairs")}</span><span class="mx-metric-value">${s.emptyChairs}</span><span class="mx-metric-note">${t("reports.emptyTables")}: ${s.emptyTables}</span></div>`,
      `<div class="mx-metric ${unassignedPax?"is-warn":""}"><span class="mx-metric-label">${t("reports.unassigned")}</span><span class="mx-metric-value">${unassignedPax}</span><span class="mx-metric-note">${t("reports.guestsCount",{n:unassigned.length})}</span></div>`,
    ].join("");
    const tableRows=[...event.tables].sort((a,b)=>naturalSort(a.number,b.number))
      .map(t_=>`<div class="mx-row cols-report"><div><b style="font-size:12.5px">${esc(formatTableNumber(t_.number))}</b> <span class="muted" style="font-size:11.5px">${esc(t_.zone)}</span></div><div class="seat-tag">${tableAssignedPax(event,t_.id)} / ${t_.capacity}</div></div>`).join("");
    return`<div class="mx-screen"><div class="mx-wrap">
      <div class="mx-head"><div><h1>${t("reports.title")}</h1><p>${t("reports.subtitle")}</p></div></div>
      <div class="reports-stage">
        <div>
          ${postEventReplayHTML(event)}
          <div class="mx-section" style="margin-top:0"><div class="mx-section-head"><h2>${t("reports.preflight")}</h2><span class="count">${issues.length||""}</span></div><div class="preflight">${preflight}</div></div>
          <div class="mx-section"><div class="mx-section-head"><h2>${t("reports.capacitySummary")}</h2></div><div class="mx-metrics" style="margin-bottom:0">${capacity}</div></div>
          <div class="mx-section"><div class="mx-section-head"><h2>${t("reports.tableList")}</h2><span class="count">${t("reports.tablesCount",{n:event.tables.length})}</span></div>${event.tables.length?`<div class="mx-list">${tableRows}</div>`:`<div class="mx-empty" style="padding:28px">${t("reports.tablesCount",{n:0})}</div>`}</div>
          ${auditTrailHTML(event)}
        </div>
        <aside class="export-panel">
          <h3>${t("reports.workbook")}</h3>
          <p>${t("reports.workbookNote")}</p>
          <div class="sheet-preview">
            <div class="sheet-chip"><b>${t("reports.sheetTablePlan")}</b><span>${t("reports.sheetNoteTables",{n:event.tables.length})}</span></div>
            <div class="sheet-chip"><b>${t("reports.sheetGuestList")}</b><span>${t("reports.sheetNoteRecords",{n:event.guests.length})}</span></div>
            <div class="sheet-chip"><b>${t("reports.sheetUnassigned")}</b><span>${t("reports.sheetNoteGuests",{n:unassignedPax})}</span></div>
          </div>
          <button class="btn primary btn-export" data-report="xlsx">${icon("download")}${t("reports.exportTablePlan")}</button>
          <button class="btn" style="width:100%;justify-content:center;margin-top:8px" data-report="print">${icon("image")}${t("reports.printTablePlan")}</button>
          <button class="btn" style="width:100%;justify-content:center;margin-top:8px" data-report="csv">${icon("download")}${t("reports.guestCsv")}</button>
          <p style="font-size:11px;color:var(--muted-2);margin:12px 0 0;line-height:1.45">${t("reports.sheetsInEnglish")}</p>
        </aside>
      </div>
    </div></div>`;
  };
  // Own binder with null guards: the base one dereferences querySelector
  // results directly, which blanks Reports if a button is ever conditional.
  bindReports = function(){
    app.querySelectorAll("[data-report='csv']").forEach(b=>b.onclick=exportGuestCSV);
    app.querySelectorAll("[data-report='xlsx']").forEach(b=>b.onclick=exportTablePlanXLSX);
    app.querySelectorAll("[data-report='print']").forEach(b=>b.onclick=printTablePlan);
    app.querySelectorAll("[data-report-fix]").forEach(b=>b.onclick=()=>{ui.tab=b.dataset.reportFix;render();});
    // Post-Event Replay's wave chart (historical events only) needs the same
    // bucket-click/VIP/clear wiring Live uses -- a historical event has no
    // Live tab to have bound them already.
    bindArrivalWaveControls();
  };

  // ---- Paper table plan -----------------------------------------------
  // Walking the floor with a laptop is not how this job is done. The sheet is
  // built from buildTablePlanModel() -- the SAME model the workbook uses -- so
  // table numbering, seat numbering, "GUEST OF [PRIMARY NAME]", the per-table
  // total and the four-cards-per-row grouping cannot drift apart from the
  // exported .xlsx. Nothing in app-guests.js is touched.
  function printTablePlan(){
    const event=activeEvent();if(!event)return;
    if(!event.tables.length){toast(t("reports.printNoTables"),"error");return;}
    const model=buildTablePlanModel(event);
    const totalPax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    const seatedPax=event.guests.filter(g=>g.assignment).reduce((n,g)=>n+paxOf(g),0);
    // Four per row, same grouping as the workbook, so a page of paper and a
    // page of the spreadsheet show the same four tables side by side.
    const groups=[];
    for(let i=0;i<model.tables.length;i+=4)groups.push(model.tables.slice(i,i+4));
    const card=table=>{
      const seats=Array.from({length:table.capacity},(_,s)=>{
        const name=seatExportName(event,table,s);
        return`<tr class="${name?"":"free"}"><td class="s">S${s+1}</td><td class="n">${esc(name)}</td></tr>`;
      }).join("");
      return`<div class="pp-card">
        <div class="pp-card-head">${esc(formatTableNumber(table.number))}</div>
        <table class="pp-seats"><tbody>${seats}</tbody></table>
        <div class="pp-card-total"><span>TOTAL GUEST:</span><b>${tableAssignedPax(event,table.id)}</b></div>
      </div>`;
    };
    const root=printRoot();
    root.innerHTML=`
      <div class="pp-head">
        <div class="pp-title"><b>${esc(event.name)}</b><span>${esc([event.hotel,event.salon].filter(Boolean).join(" · "))}</span></div>
        <div class="pp-meta">
          <span>${esc(fmtDate(event.date))}</span>
          <span>${t("reports.printTables",{n:model.tables.length})}</span>
          <span>${t("reports.printPax",{seated:seatedPax,total:totalPax})}</span>
        </div>
      </div>
      ${groups.map(g=>`<div class="pp-row">${g.map(card).join("")}</div>`).join("")}`;
    document.body.classList.add("printing");
    // Clear the print layer once the dialog closes either way, so a stale plan
    // can never be printed after the seating has changed.
    const cleanup=()=>{document.body.classList.remove("printing");root.innerHTML="";window.removeEventListener("afterprint",cleanup);};
    window.addEventListener("afterprint",cleanup);
    window.print();
    // Browsers that never fire afterprint (or a blocked print dialog) must not
    // leave the app stuck behind the print layer.
    setTimeout(cleanup,60000);
  }
  function printRoot(){
    let root=document.getElementById("printRoot");
    if(!root){root=document.createElement("div");root.id="printRoot";document.body.appendChild(root);}
    return root;
  }

  // ---- Guests: a party list, not a spreadsheet ------------------------
  // Every row is ONE guest record. Companions are shown as part of that
  // record's identity, never promoted into rows of their own.
  function guestCounts(event){
    const totalPax=event.guests.reduce((n,g)=>n+paxOf(g),0);
    const seatedPax=event.guests.filter(g=>g.assignment).reduce((n,g)=>n+paxOf(g),0);
    return{records:event.guests.length,totalPax,seatedPax,unseatedPax:totalPax-seatedPax,
      vip:event.guests.filter(g=>g.vip&&g.vip!=="Standard").length};
  }
  function guestPartyCellHTML(event,g){
    const add=additionalOf(g),bits=[`${paxDotsHTML(g)}<span>${t("guests.partyOf",{n:paxOf(g)})}</span>`];
    if(add)bits.push(`<span>${t("guests.companions",{n:add})}</span>`);
    if(g.vip&&g.vip!=="Standard")bits.push(`<span class="vip-tag">${esc(g.vip)}</span>`);
    if(g.notes)bits.push(`<span class="note-dot" title="${esc(g.notes)}">${icon("edit")}${t("guests.hasNote")}</span>`);
    return`<div><div class="party-name">${esc(g.name)}</div><div class="party-sub">${bits.join("")}</div></div>`;
  }
  // ---- Undo for the two actions that destroy work ---------------------
  // A guest record is typed by hand or imported once; losing one to a mis-click
  // is the kind of mistake a non-technical operator cannot recover from. These
  // replace the thin canMutate wrappers that used to delegate to the base
  // implementations -- the guard is kept, the recovery is new.
  function toastAction(message,label,onAction,type="info",duration=8000){
    const wrap=document.getElementById("toastWrap");if(!wrap)return;
    const el=document.createElement("div");el.className="toast has-action "+type;
    const text=document.createElement("span");text.className="toast-text";text.textContent=message;
    const btn=document.createElement("button");btn.type="button";btn.className="toast-action";btn.textContent=label;
    let done=false;
    btn.onclick=()=>{if(done)return;done=true;el.remove();onAction();};
    el.append(text,btn);wrap.appendChild(el);
    setTimeout(()=>el.remove(),duration);
  }
  deleteGuest = function(id){
    const event=activeEvent(),g=event&&event.guests.find(x=>x.id===id);
    if(!g||!canMutate(event,"delete a guest"))return;
    if(!confirm(t("guests.confirmDelete",{name:g.name})))return;
    // The whole record is kept, including its planned assignment, so undo puts
    // the guest back exactly where they were rather than as a fresh unassigned
    // record. Position is kept too, so the list does not reshuffle on undo.
    const index=event.guests.indexOf(g),snapshot=JSON.parse(JSON.stringify(g));
    event.guests.splice(index,1);
    refreshChairOccupancy(event);
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
      refreshChairOccupancy(now);
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
    refreshChairOccupancy(event);
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
      refreshChairOccupancy(now);
      audit(now,"GUEST_REASSIGNED",{guestId:id,tableId:snapshot.tableId});
      touchEvent(now);render();
      toast(t("seating.reassignedToast",{name:guest.name,table:label}),"success");
    });
  };
  guestsHTML = function(event){
    const guests=filteredGuests(event),c=guestCounts(event),byId=tableIndex(event);
    const metrics=[
      `<div class="mx-metric is-hero"><span class="mx-metric-label">${t("guests.m.totalPax")}</span><span class="mx-metric-value">${c.totalPax}</span><span class="mx-metric-note">${t("guests.m.totalPaxNote",{n:c.records})}</span></div>`,
      `<div class="mx-metric ${c.seatedPax?"is-good":""}"><span class="mx-metric-label">${t("guests.m.seated")}</span><span class="mx-metric-value">${c.seatedPax}</span><span class="mx-metric-note">${t("guests.m.seatedNote")}</span></div>`,
      `<div class="mx-metric ${c.unseatedPax?"is-warn":""}"><span class="mx-metric-label">${t("guests.m.unseated")}</span><span class="mx-metric-value">${c.unseatedPax}</span><span class="mx-metric-note">${t("guests.m.unseatedNote")}</span></div>`,
      `<div class="mx-metric"><span class="mx-metric-label">${t("guests.m.vip")}</span><span class="mx-metric-value">${c.vip}</span><span class="mx-metric-note">${t("guests.m.vipNote")}</span></div>`,
    ].join("");
    // The unassigned backlog is stated outright instead of hiding behind a
    // filter the operator has to remember to switch to.
    const queue=c.unseatedPax
      ?`<div class="mx-queue"><b>${t("guests.queue",{n:c.unseatedPax})}</b><span>${t("guests.queueHint")}</span><button class="btn sm primary" data-guest-command="seating">${t("guests.queueGo")}</button></div>`
      :c.records?`<div class="mx-queue clear"><b>${t("guests.queueClear")}</b><span></span></div>`:"";
    const filters=[["all",t("guests.filter.all")],["assigned",t("guests.filter.assigned")],["unassigned",t("guests.filter.unassigned")],["confirmed",t("guests.filter.confirmed")],["tentative",t("guests.filter.tentative")]];
    const body=!c.records
      ?`<div class="mx-empty"><h3>${t("guests.emptyTitle")}</h3><p>${t("guests.emptyHint")}</p><div class="toolbar-row" style="justify-content:center"><button class="btn" data-guest-command="import">${icon("image")}${t("guests.importExcel")}</button><button class="btn primary" data-guest-command="add">${icon("plus")}${t("guests.addGuest")}</button></div></div>`
      :`<div class="mx-list"><div class="mx-list-head cols-guest"><span>${t("guests.col.guest")}</span><span>${t("guests.col.status")}</span><span>${t("guests.col.invitedBy")}</span><span>${t("guests.col.tableSeat")}</span><span></span></div>${
        guests.length?guests.map(g=>`<div class="mx-row cols-guest">${guestPartyCellHTML(event,g)}<div><span class="plan-tag ${g.planningStatus.toLowerCase()}">${esc(t("status.planning."+g.planningStatus))}</span></div><div class="muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.invitedBy||"—")}</div><div>${seatTagHTML(event,g,byId)}${g.assignment?.locked?" 🔒":""}</div><div class="row-icons"><button class="row-action" aria-label="${esc(t("guests.a11y.seat",{name:g.name}))}" title="${t("guests.col.tableSeat")}" data-guest-seat="${g.id}">${icon("seat")}</button><button class="row-action" aria-label="${esc(t("guests.a11y.edit",{name:g.name}))}" data-guest-edit="${g.id}">${icon("edit")}</button><button class="row-action" aria-label="${esc(t("guests.a11y.delete",{name:g.name}))}" data-guest-delete="${g.id}">${icon("trash")}</button></div></div>`).join(""):`<div class="mx-empty" style="border:none;background:none">${t("guests.noMatches")}</div>`
      }</div>`;
    return`<div class="mx-screen"><div class="mx-wrap">
      <div class="mx-head"><div><h1>${t("guests.title")}</h1><p>${t("guests.recordsSummary",{records:c.records,total:c.totalPax})}</p></div><div class="mx-head-actions"><button class="btn" data-guest-command="template">${icon("download")}${t("guests.excelTemplate")}</button><button class="btn" data-guest-command="import">${icon("image")}${t("guests.importExcel")}</button><button class="btn primary" data-guest-command="add">${icon("plus")}${t("guests.addGuest")}</button></div></div>
      <div class="mx-metrics">${metrics}</div>
      ${queue}
      <div class="mx-toolbar"><div class="grow"><input class="filter-input" id="guestSearch" style="width:100%" value="${esc(ui.guestQuery)}" placeholder="${t("guests.search")}"></div><select class="filter-input" id="guestFilter" style="width:170px">${filters.map(([v,l])=>`<option value="${v}" ${ui.guestFilter===v?"selected":""}>${l}</option>`).join("")}</select></div>
      ${body}
    </div></div>`;
  };

  openGuestDialog = function(...args){if(canMutate(activeEvent(),"edit guest records")){original.openGuestDialog(...args);translateStaticDialogs();}};

  // guestDialog/excelDialog markup lives once in index.html and never passes
  // through render(), so a language toggle has nothing to re-draw it. This
  // pushes the current language into that static markup directly, called on
  // every render() and whenever the guest dialog opens.
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
    const saveBtn=form.querySelector(".dialog-foot .btn.primary");if(saveBtn)saveBtn.textContent=t("guestDialog.save");
  }
  translateStaticDialogs();
  // deleteGuest is defined further up, where its undo lives.
  bindGuests = function(){
    if(isHistorical(activeEvent()))return;
    original.bindGuests();
    // The empty state repeats Import/Add, and the base binder uses
    // querySelector -- first match only -- so the duplicates would be inert.
    app.querySelectorAll("[data-guest-command='add']").forEach(b=>b.onclick=()=>openGuestDialog());
    app.querySelectorAll("[data-guest-command='import']").forEach(b=>b.onclick=openExcelWizard);
    app.querySelectorAll("[data-guest-command='template']").forEach(b=>b.onclick=downloadExcelTemplate);
    const toSeating=app.querySelector("[data-guest-command='seating']");
    if(toSeating)toSeating.onclick=()=>{ui.tab="seating";ui.seatingGuestScope="unassigned";ui.seatingQuery="";ui.selectedGuestId=null;ui.selectedGuestIds=[];render();};
  };
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
  function classOf(c){return c?{kind:c.kind,type:c.type,confidence:c.confidence,source:c.evidence?.geometry??null,candidateId:c.id}:null;}
  function truthOf(c){return c?{kind:c.kind,type:c.type,seats:c.seats??null,seatsConfidence:c.seatsConfidence??null}:null;}
  async function captureTrainingExample(event,c,{decisionType,predictionBefore=null,note=null}={}){
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
        note,
      });
      state.trainingData ||= [];
      state.trainingData.push(record);
      saveState();
      return record;
    }catch(error){
      if(!captureFailureReported){
        captureFailureReported=true;
        toast(`The correction was applied, but capturing it as a training example failed: ${error.message}`,"error",7000);
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
      c.kind=m.kind;c.type=m.type;c.status=m.status;c.selected=m.status!=="rejected";c.fromMemory=true;
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
  async function readPrintedTableNumbers(event){
    const analysis=event?.analysis;
    if(!analysis||!globalThis.MeritTableNumbers||!globalThis.MeritLabelOCR)return;
    if(typeof globalThis.runPlanOCR!=="function"||!analysis.ocr?.available)return;
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
      read=await globalThis.MeritTableNumbers.readTableNumbers(globalThis.runPlanOCR,globalThis.MeritLabelOCR,image,numbered,{
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
    const id=c?.taughtFrom?.lessonId;if(!id)return;
    const scope=c.taughtFrom.scope;
    state.teachings=(state.teachings||[]).filter(l=>l.id!==id);
    const was=c.taughtFrom.was;
    if(was){c.kind=was.kind;c.type=was.type;c.status=was.status;c.printedNumber=was.printedNumber;}
    delete c.taughtFrom;
    delete c.typeBasis;
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
    const event=activeEvent();if(!canMutate(event,"run plan analysis")||!event.background?.src)return toast("Import a floor plan first.","error");ui.analysisBusy=true;ui.analysisProgress=3;ui.analysisStage=t("analysis.stage.reading");ui.tab="floor";ui.planMode="review";
    // Import -> Confirm timing for the operator test. Local only, and carried
    // on objects that already survive the event migration: the background for
    // the import moment, the analysis for everything after it. A `planTimings`
    // field on the event itself was silently dropped by migrateEvent, which is
    // exactly the kind of thing a test that reads the value catches and a test
    // that reads the code does not.
    const analysisStartedAtMs=Date.now();
    render();await yieldFrame();
    try{
      const blob=await sourceBlob(event.background.src),bitmap=await createImageBitmap(blob),max=1920,ratio=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*ratio)),height=Math.max(1,Math.round(bitmap.height*ratio)),canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(bitmap,0,0,width,height);bitmap.close();
      ui.analysisStage=t("analysis.stage.understanding");ui.analysisProgress=22;render();await yieldFrame();
      // Deskew before anything measures a component. See estimatePlanSkew.
      //
      // Only when the evidence is real: the best angle has to beat square-on by
      // a margin, not merely tie with it. Measured, that gain is 2.03 and 2.20
      // on the two genuinely rotated variants and exactly 1.0000 on the six
      // straight renderings, so the deadband is not a close call.
      const skew=globalThis.MERIT_PLAN_DETECTION.resolve().estimatePlanSkew(canvas,width,height);
      const deskewDeg=skew.applyDeg;
      let dw=width,dh=height,dctx=ctx;
      if(deskewDeg){
        const rad=-deskewDeg*Math.PI/180,cos=Math.abs(Math.cos(rad)),sin=Math.abs(Math.sin(rad));
        dw=Math.max(1,Math.round(width*cos+height*sin));
        dh=Math.max(1,Math.round(width*sin+height*cos));
        const dcanvas=document.createElement("canvas");dcanvas.width=dw;dcanvas.height=dh;
        dctx=dcanvas.getContext("2d",{willReadFrequently:true});
        // Paper, not black, behind the rotated corners: a black wedge would read
        // as a giant dark object and change every tone family on the plan.
        dctx.fillStyle="#ffffff";dctx.fillRect(0,0,dw,dh);
        dctx.translate(dw/2,dh/2);dctx.rotate(rad);dctx.drawImage(canvas,-width/2,-height/2);
        dctx.setTransform(1,0,0,1,0,0);
      }
      const pixels=dctx.getImageData(0,0,dw,dh);
      // Everything the detector returns is in DESKEWED percent, and everything
      // the product stores and draws is in PLAN percent. These two are the only
      // bridge between them, and both are identities when no deskew happened.
      //
      // A candidate's w/h are its oriented box's own dimensions, not an
      // axis-aligned extent, so rotating the frame does not change them — only
      // the centre moves and the angle shifts by the correction that was
      // applied. That is why this mapping is four lines rather than a general
      // polygon transform.
      const skewRad=deskewDeg*Math.PI/180;
      const planFromDeskewPoint=(px,py)=>{
        if(!deskewDeg)return[px,py];
        const ox=px-dw/2,oy=py-dh/2,cos=Math.cos(skewRad),sin=Math.sin(skewRad);
        return[ox*cos-oy*sin+width/2,ox*sin+oy*cos+height/2];
      };
      const deskewFromPlanPoint=(px,py)=>{
        if(!deskewDeg)return[px,py];
        const ox=px-width/2,oy=py-height/2,cos=Math.cos(-skewRad),sin=Math.sin(-skewRad);
        return[ox*cos-oy*sin+dw/2,ox*sin+oy*cos+dh/2];
      };
      const planFromDeskew=o=>{
        if(!o)return o;
        if(deskewDeg){
          const[cx,cy]=planFromDeskewPoint((o.x+o.w/2)/100*dw,(o.y+o.h/2)/100*dh);
          const ow=o.w/100*dw,oh=o.h/100*dh;
          o.w=ow/width*100;o.h=oh/height*100;
          o.x=cx/width*100-o.w/2;o.y=cy/height*100-o.h/2;
          o.rotation=((o.rotation||0)+deskewDeg)%360;
        }
        for(const ch of o.chairDetections||[])planFromDeskewChair(ch);
        return o;
      };
      // A nested seat carries its CENTRE in x/y, not a top-left corner.
      const planFromDeskewChair=ch=>{
        if(!deskewDeg)return ch;
        const[cx,cy]=planFromDeskewPoint(ch.x/100*dw,ch.y/100*dh);
        const cw=ch.w/100*dw,chh=ch.h/100*dh;
        ch.x=cx/width*100;ch.y=cy/height*100;
        ch.w=cw/width*100;ch.h=chh/height*100;
        ch.rotation=((ch.rotation||0)+deskewDeg)%360;
        return ch;
      };
      // Human-confirmed regions travel the other way: they were stored in plan
      // percent and the detector needs them where it is looking.
      const deskewToPlan=list=>!deskewDeg?list:list.map(r=>{
        const[cx,cy]=deskewFromPlanPoint((r.x+r.w/2)/100*width,(r.y+r.h/2)/100*height);
        const w=r.w/100*width/dw*100,h=r.h/100*height/dh*100;
        return{x:cx/dw*100-w/2,y:cy/dh*100-h/2,w,h};
      });
      // The application layer talks to a PlanDetectionProvider, never to pixel
      // code or a vendor SDK directly (merit-plan-intelligence, "Provider
      // abstraction"). Today exactly one provider is installed and it is
      // classical computer vision: trainedModel stays false and the UI keeps
      // saying DOMAIN MODEL NOT INSTALLED.
      const provider=globalThis.MERIT_PLAN_DETECTION.resolve();
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
      const detection=await provider.detect(pixels,dw,dh,{confidenceThreshold:calibratedThreshold,protectedRegions:deskewToPlan(protectedRegions),onStage:async(key,progress)=>{
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
      event.analysis={id:uid("analysis"),engine:"ASSISTED_DETECTION",trainedModel:false,notice:"Classical computer vision is active; no trained Merit model is installed in this browser review.",createdAt:nowISO(),imageWidth:width,imageHeight:height,originalWidth:Math.round(width/ratio),originalHeight:Math.round(height/ratio),threshold,candidates:allCandidates,missed:allCandidates.filter(c=>c.missed).map(c=>c.id),groupingDecisions:carriedDecisions,memoryReapplied:memoryResult.reappliedCount,memoryRestored:memoryResult.restored.length,memoryConflicts:memoryResult.conflicts,comparison:{added:[...newSig].filter(x=>!oldSig.has(x)).length,removed:[...oldSig].filter(x=>!newSig.has(x)).length,changed:0},diagnostics:{...detection.diagnostics,resolution:`${width}×${height}`,detectionMs,provider:provider.id,providerLabel:provider.label,
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
      try{ocrResult=await runPlanOCR(canvas.toDataURL("image/png"));}catch(ocrError){ocrResult={available:false,text:null,reason:ocrError.message};}
      event.analysis.ocr={available:ocrResult.available,reason:ocrResult.reason||null,engine:"tesseract.js"};
      // Kept in full (not just the truncated capacityAudit.sourceText) so a
      // grouping/reclassification decision can recompute planIntelligence
      // later without re-running OCR.
      event.analysis.ocrText=ocrResult.available?ocrResult.text:null;
      let suppressedByText=[];
      if(ocrResult.available&&ocrResult.words?.length){
        const suppression=suppressTextFalsePositives(event.analysis.candidates,ocrResult.words,width,height);
        event.analysis.candidates=suppression.kept;
        event.analysis.diagnostics.textSuppressed=suppression.removedCount;
        suppressedByText=suppression.removed||[];
      }
      ui.analysisStage=t("analysis.stage.labels");render();await yieldFrame();
      await identifyLabelledVenueObjects(event,suppressedByText);
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
    }catch(error){console.error(error);ui.analysisBusy=false;ui.analysisStage="Analysis failed";render();toast(`Assisted Detection failed: ${error.message}`,"error",7000);}
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
    return`<button class="candidate-box ${c.kind} ${c.status} ${selected?"selected":""} ${reviewCls}" data-candidate-box="${c.id}" style="left:${c.x}%;top:${c.y}%;width:${c.w}%;height:${c.h}%;transform:rotate(${c.rotation||0}deg)" title="${esc(c.kind)} · ${Math.round(c.confidence*100)}%"></button>${(c.chairDetections||[]).map(ch=>`<i class="candidate-box chair ${reviewCls}" style="left:${ch.x}%;top:${ch.y}%;width:${Math.max(.5,ch.w)}%;height:${Math.max(.5,ch.h)}%;transform:translate(-50%,-50%) rotate(${ch.rotation||0}deg)"></i>`).join("")}`;
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
  const UNVERIFIED_SEATING=new Set(["sofa","bench","banquette"]);
  const RECLASSIFY_TAXONOMY=[
    {kind:"table",type:"round"},{kind:"table",type:"square"},{kind:"table",type:"rectangle"},{kind:"table",type:"bistro"},
    {kind:"venue",type:"chair"},{kind:"venue",type:"armchair"},
    // Sofa, bench and banquette are first-class types rather than one blurred
    // "sofa/bench" label, because they seat different numbers of people and a
    // venue counts them separately. None of the three ever gets a guessed seat
    // count -- see UNVERIFIED_SEATING below.
    {kind:"venue",type:"sofa"},{kind:"venue",type:"bench"},{kind:"venue",type:"banquette"},
    {kind:"venue",type:"stage"},{kind:"venue",type:"bar"},{kind:"venue",type:"entrance"},{kind:"venue",type:"exit"},
    {kind:"venue",type:"column"},{kind:"venue",type:"text"},{kind:"venue",type:"other"},
  ];
  // The learned encoder's opinion, in words. Deliberately NOT a percentage:
  // the similarity behind it is graded against this plan's own distribution,
  // which makes it a visual match strength and not a probability — showing it
  // as "97% certain" would be a fabricated confidence number.
  //
  // The tier is shown next to the verdict every time, never omitted. On a plan
  // with no operator decisions the comparison is against the detector's own
  // candidates, and an operator who is not told that would read a machine
  // agreeing with itself as independent corroboration.
  function visualClassWord(cls){
    const key="visual.class."+(cls==="table"?"table":(cls||"").split(":")[1]||"other");
    const word=t(key);
    return word===key?t("visual.class.other"):word;
  }
  function visualEvidenceHTML(c){
    const v=c?.visualEvidence;
    if(!v)return"";
    // Strength and agreement are independent, so all four combinations get a
    // sentence rather than the weak ones collapsing into one shrug. Only a
    // confident disagreement is coloured: the channel deletes nothing, so it
    // must not read like an error on every uncertain crop.
    const own=visualClassWord(v.cvClass),other=visualClassWord(v.nearestClass);
    const weak=v.strength==="weak"||v.strength==="unknown",disagrees=v.agreement==="disagree";
    const body=weak?(disagrees?t("visual.weakDisagree",{other}):t("visual.uncertain"))
      :disagrees?t("visual.disagree",{other,cls:own})
      :t(v.strength==="strong"?"visual.strong":"visual.moderate",{cls:own});
    return`<div class="poi-visual-note ${disagrees&&!weak?"disagree":weak?"weak":"agree"}">`
      +`<strong>${t("visual.title")}</strong>`
      +`<span>${esc(body)}</span><em>${esc(t("visual.tier."+(v.nearestTier||"provisional")))}</em></div>`;
  }
  // Seats this table and a neighbour can both claim. Shown only when there are
  // any — a line saying "0 seats are uncertain" on every card would be noise,
  // and the absence of the line is itself the answer.
  //
  // It names the neighbour, because "one of these seats might belong somewhere
  // else" is not an actionable sentence and "…might belong to T14" is.
  function relationNoteHTML(c){
    if(!c||c.kind!=="table")return"";
    const seats=(c.chairDetections||[]).filter(ch=>ch.relation&&ch.relation.ambiguous);
    if(!seats.length)return"";
    const event=activeEvent(),byId=new Map((event?.analysis?.candidates||[]).map(x=>[x.id,x]));
    const others=[...new Set(seats.map(s=>s.relation.runnerUpId).filter(Boolean))]
      .map(id=>byId.get(id)).filter(Boolean).map(x=>t("teach.type."+x.type));
    return`<div class="poi-relation-note"><strong>${t("relation.ambiguousTitle")}</strong>`
      +`<span>${esc(others.length?t("relation.ambiguousWith",{n:seats.length,other:others[0]})
        :t("relation.ambiguous",{n:seats.length}))}</span></div>`;
  }
  // What this table's number is, where that came from, and the one control that
  // has been missing since the Teach Area was built: a person confirming it.
  //
  // The state is shown rather than smoothed over. A number two crops agreed on
  // is not the same thing as a number a person stood behind, and the operator
  // has to be able to tell them apart -- it is the difference between "the
  // drawing was read twice" and "someone told us", and only the second one is
  // strong enough to identify this table across the whole venue.
  // `printedNumber.source` is stored English -- it travels with the reading into
  // memory, the exported report and the benchmarks, so it stays as written and
  // the screen says the same thing in the operator's language. A source this
  // build does not recognise is shown as it stands rather than relabelled.
  const NUMBER_SOURCES={
    "OCR of this table's own symbol":"number.source.ocr",
    "confirmed by a person":"number.source.person",
  };
  function numberSourceText(src){
    const key=NUMBER_SOURCES[src];
    return key?t(key):src;
  }
  function printedNumberHTML(c){
    if(!c||c.kind!=="table")return"";
    const p=c.printedNumber||null;
    const state=p?p.state:"NONE";
    const verified=state==="VERIFIED";
    const value=p&&typeof p.value==="number"?p.value:"";
    const mark=verified?"ok":state==="NONE"?"muted":"warn";
    return`<div class="poi-number ${mark}">
      <label for="poiNumber">${t("number.printedNumber")}</label>
      <div class="poi-number-row">
        <input id="poiNumber" class="field-input" type="number" min="1" max="9999" inputmode="numeric"
          placeholder="${esc(t("number.unread"))}" value="${value}">
        <button class="btn sm" data-review-action="confirm-number">${t("number.confirm")}</button>
      </div>
      <p class="poi-number-state">${esc(t("number.state."+state))}${
        p&&p.source?` · ${esc(numberSourceText(p.source))}`:""}</p>
    </div>`;
  }
  function reviewPoiCardHTML(c){
    if(!c)return"";
    const opt=o=>`<option value="${o.kind}:${o.type}" ${c.kind===o.kind&&c.type===o.type?"selected":""}>${t("teach.type."+o.type)}</option>`;
    return`<aside class="poi-card"><div class="poi-card-head"><strong>${t("teach.type."+c.type)}</strong><span>${c.kind==="table"?(c.seatsUnknown?`${t("poi.seatsNotShown")} · `:`${(c.chairDetections||[]).length} ${t("poi.seats")} · `):""}${t(c.status==="confirmed"?"poi.confirmed":c.status==="rejected"?"poi.rejected":"poi.unreviewed")}</span></div>${c.fromMemory?`<div class="poi-memory-note">${icon("check")}${t("poi.fromMemory")}</div>`:""}${c.taughtFrom?`<div class="poi-memory-note taught">${icon("check")}<span>${t("teachArea.appliedHere")} — ${t("teachArea.scope."+c.taughtFrom.scope)}</span><button class="btn sm quiet" data-review-action="forget">${t("teachArea.forget")}</button></div>`:""}${c.lowEvidence?`<div class="poi-lowevidence"><strong>${t("poi.lowEvidence")}</strong><span>${esc(t("poi.lowEvidence."+c.lowEvidence.reason))}</span></div>`:""}${visualEvidenceHTML(c)}${relationNoteHTML(c)}<select class="field-select" data-candidate-edit="kindtype"><optgroup label="${t("taxonomy.tables")}">${RECLASSIFY_TAXONOMY.filter(o=>o.kind==="table").map(opt).join("")}</optgroup><optgroup label="${t("taxonomy.objects")}">${RECLASSIFY_TAXONOMY.filter(o=>o.kind==="venue").map(opt).join("")}</optgroup></select>${UNVERIFIED_SEATING.has(c.type)?`<div class="poi-seat-row"><label for="poiSeatCount">${t("poi.seatsOnThis")}</label><input id="poiSeatCount" class="field-input" type="number" min="0" max="99" inputmode="numeric" placeholder="${t("poi.seatsUnset")}" value="${c.seats==null?"":c.seats}" data-candidate-edit="seatCount"><p class="poi-seat-note">${c.seats==null?t("poi.seatsUnverifiedNote"):t("poi.seatsVerifiedNote",{n:c.seats})}</p></div>`:""}${printedNumberHTML(c)}${(()=>{const av=scopeAvailability(c);const blocked=Object.entries(av).filter(([,s])=>!s.ok);const chosen=av[ui.teachScope||"plan"]?.ok?(ui.teachScope||"plan"):"plan";return`<div class="poi-teach"><label for="poiTeachScope">${t("teachArea.remember")}</label><div class="poi-teach-row"><select id="poiTeachScope" class="field-select" data-teach-scope>${["plan","layout","venue"].map(v=>`<option value="${v}" ${chosen===v?"selected":""} ${av[v].ok?"":"disabled"}>${t("teachArea.scope."+v)}</option>`).join("")}</select><button class="btn sm" data-review-action="teach">${t("teachArea.keep")}</button></div>${blocked.map(([,s])=>`<p class="poi-teach-blocked">${esc(s.why)}</p>`).join("")}<p class="poi-teach-note">${t("teachArea.notTraining")}</p></div>`;})()}<div class="poi-card-actions"><button class="btn sm primary" data-review-action="confirm">${t("action.correct")}</button><button class="btn sm" data-review-action="reject">${t("action.notAnObject")}</button><button class="btn sm" data-review-action="dismiss" title="${t("action.notImportantTitle")}">${t("action.notImportant")}</button></div></aside>`;
  }
  // Real pixel crop of a candidate straight out of the actual imported plan
  // image — a CSS background-position/-size window, never a synthesized or
  // generated diagram, per the product's honesty rule on AI review UI.
  function cropThumbHTML(event,c){
    const bg=event.background?.src;if(!bg||!c)return"";
    const pad=.6;
    const cw=Math.min(99,Math.max(3,c.w*(1+2*pad))),ch=Math.min(99,Math.max(3,c.h*(1+2*pad)));
    const cx=Math.min(100-cw,Math.max(0,c.x-c.w*pad)),cy=Math.min(100-ch,Math.max(0,c.y-c.h*pad));
    const sizeW=(100/cw*100).toFixed(2),sizeH=(100/ch*100).toFixed(2);
    const posX=(cx/(100-cw)*100).toFixed(2),posY=(cy/(100-ch)*100).toFixed(2);
    return`<div class="crop-thumb" style="background-image:url('${esc(bg)}');background-size:${sizeW}% ${sizeH}%;background-position:${posX}% ${posY}%" title="${esc(t("teach.type."+c.type))}"></div>`;
  }
  function memberCropsHTML(event,memberIds,max=6){
    const byId=new Map(event.analysis.candidates.map(c=>[c.id,c]));
    const shown=memberIds.slice(0,max).map(id=>cropThumbHTML(event,byId.get(id))).join("");
    const overflow=memberIds.length>max?`<span class="crop-more">+${memberIds.length-max}</span>`:"";
    return`<div class="review-group-crops">${shown}${overflow}</div>`;
  }
  // What the whole plan says, and what to look at first.
  //
  // Every claim shows its strength, because a product that states everything
  // in the same voice teaches an operator to trust all of it equally — and
  // some of it is a count bounded by detection recall. `strong` reads as
  // certain, and the interpreter has to earn it (benchmarks/interpreter/).
  // The most informative of the three impact quantities, not all three: a
  // priority line that reads "settles 12 objects, 48 seats and 2 disputed
  // claims" is a specification, not a reason to click.
  function impactWords(i){
    if(i.facts)return t("explain.settlesFacts",{objects:i.objects,facts:i.facts});
    if(i.seats)return t("explain.settlesSeats",{objects:i.objects,seats:i.seats});
    return t("explain.settles",{objects:i.objects});
  }
  function explainPlanHTML(event){
    const pi=event.analysis?.planIntelligence;
    if(!pi||!(pi.facts||[]).length)return"";
    const facts=pi.facts,priorities=(pi.reviewPriorities||[]).slice(0,4);
    // The domain layer names a type in its own vocabulary ("square"); the
    // sentence it lands in is a different question and belongs here. Without
    // this the Turkish read "masalarının çoğu square", which is the exact
    // failure the structured key/params design exists to prevent.
    // t() returns the KEY when a string is missing, so an unmapped type would
    // print "fact.type.whatever" on screen. Fall back to the raw type name,
    // which is at least a word.
    const typeWord=type=>{
      const key="fact.type."+type,word=t(key);
      return word===key?String(type):word;
    };
    // A type is named in the domain's own vocabulary ("square") and needs the
    // in-sentence word here. Params that are string KEYS are resolved by t()
    // itself, so nothing else needs unwrapping.
    const say=(key,params)=>t(key,params&&params.type?{...params,type:typeWord(params.type)}:params);
    // Collapsible, and open by default. The Review Center's job is ACTION —
    // the groups and questions below — and twelve facts unfolded push them
    // under the fold. Context that cannot be folded away is chrome.
    // Where two stages of the analysis cannot both be right. Shown ABOVE the
    // facts, because a claim and the reason to doubt it are useless in that
    // order: an operator who reads "112 seats" first has already believed it.
    // Each one names both sides and where each came from, and states no verdict
    // — the product does not know which side is wrong, and the resolution
    // belongs to the person looking at the drawing.
    const contradictions=pi.contradictions||[];
    const contradictionsHTML=contradictions.length
      ?`<div class="plan-contradictions"><strong>${t("contradiction.title")}</strong>`
        +`<ul>${contradictions.map(c=>
          `<li class="contra contra-${esc(c.severity)}">`
          +`<span class="contra-kind">${esc(t("contradiction.kind."+c.kind).toUpperCase())}</span>`
          +`<span class="contra-text">${esc(t(c.key,c.params))}</span>`
          +`<span class="contra-sides">${c.sides.map(s=>
            `<em>${esc(t(s.from,s.fromParams))}</em>: ${esc(t(s.claim,s.params))}`).join(" &nbsp;·&nbsp; ")}</span>`
          +`</li>`).join("")}</ul></div>`
      :"";
    return`<details class="plan-explain" open><summary>${t("explain.title")}</summary>`
      +contradictionsHTML
      +`<ul class="plan-explain-facts">${facts.map(f=>
        `<li class="fact fact-${esc(f.strength)}"><span class="fact-strength">${t("fact.strength."+f.strength)}</span>`
        +`<span class="fact-text">${esc(say(f.key,f.params))}</span>`
        // The evidence travels with the claim rather than living in a
        // diagnostics panel nobody opens.
        +(f.provenance&&f.provenance.length?`<span class="fact-basis">${t("explain.basedOn")}: ${esc(f.provenance.map(p=>
          say(p.key,p.params)).join("; "))}</span>`:"")
        // A claim whose confidence a disagreement lowered says so. Silently
        // restating it one notch weaker would hide the reason.
        +(f.strengthBefore?`<span class="fact-downgraded">${t("contradiction.downgraded")}</span>`:"")
        +`</li>`).join("")}</ul>`
      +(priorities.length?`<strong class="plan-explain-next">${t("explain.lookAtFirst")}</strong>`
        +`<ol class="plan-explain-priorities">${priorities.map(pr=>
          `<li>${esc(say(pr.key,pr.params))}`
          // What this one answer settles, next to the item. The order is
          // measured on exactly this quantity, so an operator who wants to
          // work the list differently can see what they are trading away.
          +(pr.downstreamImpact?.objects?`<span class="priority-impact">${esc(impactWords(pr.downstreamImpact))}</span>`:"")
          +`</li>`).join("")}</ol>`:"")
      +`</details>`;
  }
  // What is worth deciding, above the review groups, because it is the answer
  // to "where do I start" and the groups are only one of the things competing
  // for that answer. This is also the first surface the numbering-integrity
  // report, the self-check and the Teach Area's unresolved proposals have ever
  // had: three layers that produced data nobody could see.
  //
  // Everything below the line is stated, never dropped. A panel that showed six
  // items and implied that was all of it would be a filter lying about its own
  // coverage.
  // A ranked row that cannot be acted on is a ranked row that wastes the
  // operator's attention twice: once to read it, once to work out where to go.
  // Every claim that names objects opens a REVIEW QUEUE over exactly those
  // objects; a claim that names none (the self-check's arithmetic, say) is a
  // statement about the whole drawing and says so instead of offering a button
  // that would land nowhere.
  // What one decision buys, in the operator's language. One function, because
  // the ranked row and the queue bar are stating the same fact and a second
  // copy is a second thing to get wrong.
  // `analysis.notice` is stored English: the contract suite asserts on it, and
  // the exported operator report carries it, so it is DATA and stays as written.
  // The screen says the same thing in the operator's language. An analysis whose
  // notice this build does not recognise keeps its own words rather than being
  // relabelled with a sentence that might not be true of it.
  const ASSISTED_NOTICE="Classical computer vision is active; no trained Merit model is installed in this browser review.";
  function analysisNoticeText(a){
    return a && a.notice===ASSISTED_NOTICE ? t("plan.noticeAssisted") : (a && a.notice) || "";
  }
  function settlesText(s){
    if(!s)return"";
    return[s.facts?t(s.facts===1?"budget.settlesFacts1":"budget.settlesFacts",{n:s.facts}):"",
      s.objects?t(s.objects===1?"budget.settlesObjects1":"budget.settlesObjects",{n:s.objects}):""]
      .filter(Boolean).join(" · ");
  }
  function claimTargets(event,c){
    const a=event.analysis;if(!a)return[];
    const byId=new Map(a.candidates.map(x=>[x.id,x]));
    return (c.targetIds||[]).filter(id=>byId.has(id));
  }
  function budgetClaimHTML(c,event){
    const label=t(c.key,{...c.params,n:c.count??c.params.n??0});
    const cost=c.decisions===1?t("budget.oneDecision"):t("budget.nDecisions",{n:c.decisions});
    const settles=settlesText(c.settles);
    const ids=event?claimTargets(event,c):[];
    const go=ids.length
      ?`<button class="btn sm budget-claim-go" data-budget-open="${esc(c.id)}">${t(ids.length===1?"budget.goOne":"budget.goN",{n:ids.length})}</button>`
      :`<span class="budget-claim-nowhere">${t("budget.wholeDrawing")}</span>`;
    return`<li class="budget-claim"><div class="budget-claim-body"><span class="budget-claim-label">${esc(label)}</span><span class="budget-claim-meta">${esc(cost)}${settles?` · ${esc(settles)}`:""}${c.corroboratedBy.length?` · ${esc(t("budget.alsoCorroborated"))}`:""}</span></div>${go}</li>`;
  }
  // ---- the review queue ----------------------------------------------------
  //
  // "31 table numbers need review" has to become "table 1 of 31, decide, next"
  // and not "here are 31 things, good luck". The queue is deliberately thin: it
  // holds an ORDER and a POSITION, and nothing else. What is resolved is read
  // from the candidates themselves on every render, never remembered here --
  // a queue that kept its own idea of "done" would drift from the data the
  // moment a decision was undone, and would then be confidently wrong.
  function openReviewQueue(event,claimId){
    const b=event.analysis?.confidenceBudget;
    const c=b&&b.spend.find(x=>x.id===claimId);
    if(!c)return;
    const ids=claimTargets(event,c);
    if(!ids.length)return;
    // `why` is deliberately NOT carried here. plan-intelligence.js writes it in
    // English on purpose -- it explains the ORDERING to diagnostics and to the
    // benchmarks, and some of it is composed from internal identifiers, so
    // rendering it produced "contradiction.from.detectionAndShape and
    // contradiction.from.visualSecondOpinion cannot both be right" inside an
    // otherwise Turkish bar. What an operator reads is the claim's own label
    // plus what one decision settles, both of which are already translated.
    ui.reviewQueue={claimId,key:c.key,params:c.params,count:c.count,ids,index:0,skipped:[],
      settles:c.settles,decisions:c.decisions};
    ui.tab="floor";ui.planMode="review";ui.reviewCenterOpen=false;
    ui.activeReviewGroupId=null;ui.activeQuestionId=null;
    ui.selectedCandidateId=ids[0];
    render();
  }
  function queueState(event){
    const q=ui.reviewQueue;if(!q)return null;
    const byId=new Map((event.analysis?.candidates||[]).map(c=>[c.id,c]));
    // Present = still in the analysis. Resolved = a person has ruled on it, or
    // it is gone because they said it was not an object at all.
    const live=q.ids.filter(id=>byId.has(id));
    const resolved=q.ids.filter(id=>{const c=byId.get(id);return !c||c.status!=="unreviewed";});
    const skipped=new Set(q.skipped);
    const outstanding=live.filter(id=>byId.get(id).status==="unreviewed"&&!skipped.has(id));
    return{...q,live,resolvedCount:resolved.length,outstanding,total:q.ids.length,
      position:Math.min(q.index+1,Math.max(1,q.ids.length))};
  }
  function queueGo(event,delta){
    const q=ui.reviewQueue;if(!q)return;
    const n=q.ids.length;if(!n)return;
    q.index=(q.index+delta+n)%n;
    ui.selectedCandidateId=q.ids[q.index];
    ui.activeReviewGroupId=null;ui.activeQuestionId=null;
    render();
  }
  function queueNextOutstanding(event){
    const s=queueState(event);if(!s)return;
    // Search forward from where we are, wrapping once, so "next" means the next
    // one AFTER this rather than the first one in the list -- an operator who
    // has worked halfway down does not want to be sent back to the top.
    const n=s.ids.length;
    for(let step=1;step<=n;step++){
      const i=(s.index+step)%n,id=s.ids[i];
      if(s.outstanding.includes(id)){
        ui.reviewQueue.index=i;ui.selectedCandidateId=id;
        ui.activeReviewGroupId=null;ui.activeQuestionId=null;render();return;
      }
    }
    // Nothing outstanding: say so rather than moving the operator somewhere
    // arbitrary and letting them wonder whether the click registered.
    toast(t("queue.allDone",{n:s.total}),"success");
    render();
  }
  function closeReviewQueue(){
    ui.reviewQueue=null;ui.selectedCandidateId=null;render();
  }
  // After a decision, the operator should be looking at the next thing rather
  // than at the thing they just settled. Recomputation has already happened by
  // the time this runs, so the queue's own progress line and the budget row
  // behind it are both reading the new state -- a resolved item changes state
  // by itself instead of sitting there as a stale warning.
  function afterReviewDecision(event){
    if(ui.reviewQueue)queueNextOutstanding(event);else render();
  }
  function reviewQueueBarHTML(event){
    const s=queueState(event);if(!s)return"";
    const label=t(s.key,{...s.params,n:s.count??s.params?.n??s.total});
    const settles=settlesText(s.settles);
    // The separator is a real character, not a styled empty element: a dot that
    // exists only as CSS reads as "163 içinden 10 karara bağlandı" to anything
    // that takes the text, which is one number where there are two.
    const progress=[t("queue.position",{i:s.position,n:s.total}),
      t("queue.resolved",{n:s.resolvedCount}),
      s.skipped.length?t("queue.skipped",{n:s.skipped.length}):""].filter(Boolean).join(" · ");
    return`<div class="review-queue-bar">
      <div class="rq-what"><strong>${esc(label)}</strong>${
        settles?`<span>${esc(settles)}</span>`:""}</div>
      <div class="rq-progress">${esc(progress)}</div>
      <div class="rq-actions">
        <button class="btn sm" data-queue="prev">${t("queue.previous")}</button>
        <button class="btn sm" data-queue="skip">${t("queue.skip")}</button>
        <button class="btn sm primary" data-queue="next-outstanding"${
          s.outstanding.length?"":" disabled"}>${t("queue.nextUnresolved")}</button>
        <button class="btn sm quiet" data-queue="exit">${t("queue.exit")}</button>
      </div>
    </div>`;
  }
  function confidenceBudgetHTML(event){
    const b=event.analysis?.confidenceBudget;
    if(!b||!b.counts.claims)return"";
    const below=[b.counts.deferred?t("budget.deferred",{n:b.counts.deferred}):"",
      b.counts.nothingMeasurableDependsOnThem?t("budget.nothingDepends",{n:b.counts.nothingMeasurableDependsOnThem}):"",
      b.counts.notAnswerableFromTheDrawing?t("budget.notAnswerable",{n:b.counts.notAnswerableFromTheDrawing}):""].filter(Boolean);
    return`<section class="budget-block"><div class="budget-head"><strong>${t("budget.title")}</strong><span>${esc(t("budget.coverage",{pct:Math.round(b.coverage.objects*100)}))}</span></div><ol class="budget-list">${b.spend.map(c=>budgetClaimHTML(c,event)).join("")}</ol>${below.length?`<p class="budget-below"><b>${t("budget.belowTheLine")}</b> — ${esc(below.join(" · "))}</p>`:""}</section>`;
  }
  function reviewCenterPanelHTML(event){
    const pi=event.analysis.planIntelligence,decisions=event.analysis.groupingDecisions||[];
    return`<aside class="review-center-panel"><div class="review-center-head"><strong>${t("review.center")}</strong>${(ui.correctionUndo||[]).length?`<button class="btn sm quiet" data-review-decision-action="undo-correction" title="${t("review.undoCorrectionTitle")}">${icon("undo")} ${t("review.undoCorrection",{n:(ui.correctionUndo||[]).length})}</button>`:""}${decisions.length?`<button class="btn sm quiet" data-review-decision-action="undo-last" title="${t("diag.undoLastDecisionTitle")}">${icon("undo")} ${t("diag.undoLastDecision",{n:decisions.length})}</button>`:""}<button class="btn icon-only sm" data-review-action="close-review-center">${icon("x")}</button></div><div class="review-center-list">${confidenceBudgetHTML(event)}${explainPlanHTML(event)}${pi.reviewGroups.map(g=>`<div class="review-group-card"><div class="review-group-title">${esc(reviewGroupTitle(g))}</div>${memberCropsHTML(event,g.memberIds)}<div class="review-group-meta">${g.totalInFamily} ${t("review.similar")} · ${g.consistentCount} ${t("review.consistentOf")} · ${g.memberIds.length} ${t("review.needReview")}</div><div class="review-group-actions"><button class="btn sm primary" data-reviewgroup-action="confirm-family" data-group="${g.id}">${t("action.applyToAll")}</button><button class="btn sm" data-reviewgroup-action="inspect" data-group="${g.id}">${t("action.reviewOutliers")}</button></div></div>`).join("")||`<div class="inspector-empty">${t("review.noGroups")}</div>`}</div>${pi.uncertainQuestions.length?`<div class="review-center-difficult"><strong>${t("review.difficultQuestions")}</strong>${pi.uncertainQuestions.map(q=>`<div class="difficult-q-row"><span>${esc(questionText(q))}</span><button class="btn sm" data-question-action="open" data-question="${q.id}">${t("action.answer")}</button></div>`).join("")}</div>`:""}</aside>`;
  }
  // AI-generated review questions are stored as a semantic {questionType,
  // questionParams} pair (plan-intelligence.js), never a hardcoded English
  // string — this renders that through i18n.js's t() so the active UI
  // language is honored. q.question (a plain English literal) is kept only
  // as a defensive fallback for a question shape without a known type.
  // Review-group titles arrive as {type, kind} rather than an English phrase,
  // so the Turkish UI does not show "Round Table Family" in the middle of a
  // Turkish panel. Falls back to the pre-rendered string for any group shaped
  // the old way.
  function reviewGroupTitle(g){
    const p=g.titleParams;
    if(!p)return titleCase(g.title||"");
    // Reuse the shape labels the Add-objects panel already ships rather than
    // adding a parallel set that could drift out of sync. t() returns the key
    // itself when a string is missing, so that is the miss signal.
    const key="bulk.type."+p.type,label=t(key);
    const typeLabel=label===key?titleCase(p.type):label;
    return t(p.kind==="table"?"review.familyTitle.table":"review.familyTitle.object",{type:typeLabel});
  }
  // What kind of tables an arrangement is made of, from the key the question
  // was consolidated under ("2:square+square", "4:rectangle+square+square+
  // square"). Uniform arrangements name their type; mixed ones say so. Returns
  // null for a question stored before arrangements were recorded, so an older
  // analysis keeps its original wording rather than showing "(undefined)".
  function arrangementTypeLabel(arrangement){
    const types=String(arrangement||"").split(":")[1];
    if(!types)return null;
    const list=types.split("+").filter(Boolean);
    if(!list.length)return null;
    return list.every(x=>x===list[0])?t("teach.type."+list[0]):t("question.mixedTypes");
  }
  function questionText(q){
    if(q.questionType==="combinedDiningGroup"){
      const memberCount=q.questionParams?.memberCount??"?",count=q.coversGroups||1;
      // The kind of table is part of the question, not decoration: two
      // arrangements that differ only in type used to render as the same
      // sentence, so the operator was asked what looked like the same question
      // twice with no way to tell which was which.
      const type=arrangementTypeLabel(q.arrangement);
      // A question standing for several identical arrangements says so, rather
      // than looking like a question about one of them.
      if(count>1)return type
        ?t("question.combinedDiningGroupRepeatedOf",{memberCount,count,type})
        :t("question.combinedDiningGroupRepeated",{memberCount,count});
      return type
        ?t("question.combinedDiningGroupOf",{memberCount,type})
        :t("question.combinedDiningGroup",{memberCount});
    }
    return q.question||"";
  }
  // Exposed for the regression suite. The property under test is not what any
  // one question says, it is that no two DIFFERENT questions say the same
  // thing -- which cannot be checked without rendering several of them
  // together, and which markup review missed for as long as this wording
  // existed.
  globalThis.MeritOperatorQuestions={questionText,arrangementTypeLabel};
  function difficultQuestionCardHTML(event){
    const pi=event.analysis?.planIntelligence;if(!pi||!ui.activeQuestionId)return"";
    const q=pi.uncertainQuestions.find(x=>x.id===ui.activeQuestionId);if(!q)return"";
    const group=pi.furnitureGroups.find(g=>g.id===q.groupId);
    return`<div class="difficult-question-overlay"><div class="difficult-question-card"><div class="eyebrow">${t("teach.needsHelp")}</div>${group?memberCropsHTML(event,group.memberIds):""}<p class="difficult-question-text">${esc(questionText(q))}</p><div class="difficult-question-actions"><button class="btn primary" data-question-action="yes" data-question="${q.id}">${t("question.yesGroup")}</button><button class="btn" data-question-action="no" data-question="${q.id}">${t("question.noSeparate")}</button></div></div></div>`;
  }
  function reviewGroupCount(pi){return pi.reviewGroups.length+pi.uncertainQuestions.length;}
  // What the operator's own notes did to this plan, on the status bar rather
  // than behind a diagnostics panel: a change that came from a note a person
  // wrote must be visible as such, or it is indistinguishable from the detector
  // having got cleverer — which it did not.
  function teachAreaPillHTML(event){
    const ta=event.analysis?.teachArea;if(!ta)return"";
    const pending=ta.summary.review+ta.summary.ambiguous;
    if(!ta.applied&&!pending)return"";
    const parts=[];
    if(ta.applied)parts.push(t("teachArea.chip.applied",{n:ta.applied}));
    if(pending)parts.push(t("teachArea.chip.pending",{n:pending}));
    return`<i class="pill-div"></i><span class="pill-chip static" title="${esc(t("teachArea.chipTitle"))}">${esc(parts.join(" · "))}</span>`;
  }
  function planIntelBottomPillHTML(event){
    const pi=event.analysis.planIntelligence;
    return`<div class="planmap-status-pill wide"><span class="pill-check">${icon("check")}</span><b>${t("plan.understood")}</b><i class="pill-div"></i><b>${pi.planSummary.diningGroups}</b><small>${t("plan.diningGroups")}</small><i class="pill-div"></i>${planSeatsPill(pi)}${planReviewChipHTML(event,"review-action")}${teachAreaPillHTML(event)}<span class="toolbar-spacer"></span><button class="btn sm quiet" data-review-action="back">${t("review.editManually")}</button><button class="btn sm primary" data-review-action="commit">${t("action.confirmPlan")}</button></div>`;
  }
  // One pin per REVIEW GROUP (at the centroid of its members), not one per
  // individual object — a plan with hundreds of similar chairs must not turn
  // into hundreds of pins. Difficult questions (rare, high-value) each keep
  // their own pin since there is exactly one real decision behind each.
  function reviewMapPins(event,pi){
    if(!pi)return[];const byId=new Map(event.analysis.candidates.map(c=>[c.id,c]));
    const groupPins=pi.reviewGroups.map((g,i)=>{
      const members=g.memberIds.map(id=>byId.get(id)).filter(Boolean);if(!members.length)return null;
      const cx=members.reduce((n,m)=>n+m.x+m.w/2,0)/members.length,cy=members.reduce((n,m)=>n+m.y+m.h/2,0)/members.length;
      return{x:cx,y:cy,label:i+1,kind:"group",groupId:g.id};
    }).filter(Boolean);
    const questionPins=pi.uncertainQuestions.map((q,i)=>{const c=byId.get(q.candidateId);if(!c)return null;return{x:c.x+c.w/2,y:c.y+c.h/2,label:groupPins.length+i+1,kind:"question",questionId:q.id};}).filter(Boolean);
    return[...groupPins,...questionPins];
  }
  // Advanced Diagnostics content for the review screen. Every line here is a
  // real measured value from the detection pass -- which provider ran, which
  // detection path it took, how many chairs it actually found and how many it
  // could associate with a table. It states DOMAIN MODEL NOT INSTALLED
  // outright rather than letting "Assisted Detection" be mistaken for a
  // trained model (merit-plan-intelligence, AI truthfulness). Fields are
  // guarded because an analysis restored from localStorage may predate them.
  function detectionDiagnosticsHTML(a){
    const d=a.diagnostics||{},rows=[];
    rows.push(`${esc(a.engine)} · ${esc(d.resolution||"")}${Number.isFinite(d.detectionMs)?` · ${d.detectionMs} ms`:""}`);
    rows.push(`<b>${t("diag.notInstalled")}</b>`);
    const pathKey=d.detectionPath==="chair-first"?"diag.path.chairFirst":d.detectionPath==="table-first"?"diag.path.tableFirst":null;
    if(pathKey)rows.push(`${t("diag.path")}: ${t(pathKey)}`);
    const sourceKey={"colour-cluster":"diag.chairSource.colour","luma-components":"diag.chairSource.luma","none":"diag.chairSource.none"}[d.chairSource];
    if(sourceKey)rows.push(`${t("diag.chairSource")}: ${t(sourceKey)}`);
    if(Number.isFinite(d.chairsDetected))rows.push(t("diag.chairsFound",{n:d.chairsDetected,associated:d.chairsAssociated??0,orphans:d.chairsUnassociated??0}));
    if(d.mergesSplit)rows.push(t("diag.mergesSplit",{n:d.mergesSplit}));
    if(d.candidateCapReached)rows.push(t("diag.capReached"));
    rows.push(`Diff +${a.comparison.added} / −${a.comparison.removed}`);
    if(d.textSuppressed)rows.push(t("diag.textSuppressed",{n:d.textSuppressed}));
    return`<div class="analysis-note">${rows.join("<br>")}</div>`;
  }
  function analysisHTML(event){
    const a=event.analysis,candidates=reviewCandidates(event),selected=a?.candidates.find(c=>c.id===ui.selectedCandidateId),pi=a?.planIntelligence;
    const pins=reviewMapPins(event,pi);
    const target=activeReviewTargetIds(pi),byId=a?new Map(a.candidates.map(c=>[c.id,c])):new Map();
    // Working through a queue means the plan should follow the operator to each
    // object, not just to a group. Outside a queue a single selection is left
    // unzoomed on purpose -- someone clicking around the plan does not want the
    // view jumping under them -- but inside one, "take me there" is the request.
    const queued=ui.reviewQueue&&ui.selectedCandidateId?byId.get(ui.selectedCandidateId):null;
    const boundaryBox=target?.isGroup?unionBbox([...target.ids].map(id=>byId.get(id)).filter(Boolean))
      :queued?{x:queued.x,y:queued.y,w:queued.w,h:queued.h}:null;
    requestAnimationFrame(()=>applyReviewZoom(boundaryBox));
    const statusLabel=v=>t(v==="unreviewed"?"poi.unreviewed":v==="confirmed"?"poi.confirmed":"poi.rejected");
    return`<section class="planintel-screen ${ui.reviewQueue?"in-queue":""}"><header class="planintel-top">${planModeSwitchHTML(event)}<div class="planintel-title"><h2>${a?t("plan.understood"):(ui.analysisBusy?esc(ui.analysisStage):t("plan.noAnalysisYet"))}</h2>${a?`<p>${a.ocr&&!a.ocr.available?esc(t("ocr.unavailable",{reason:a.ocr.reason||"no network"})):esc(analysisNoticeText(a))}</p>`:`<p>${esc(ui.analysisStage)}</p>`}</div><span class="toolbar-spacer"></span>${a?`<details class="planintel-diagnostics"><summary>${t("diag.advancedDiagnostics")}</summary><div class="diag-pop">${detectionDiagnosticsHTML(a)}<div class="field"><label>${t("diag.status")}</label><select data-review-filter="status"><option value="all">${t("diag.all")}</option>${["unreviewed","confirmed","rejected"].map(v=>`<option value="${v}" ${ui.reviewFilter===v?"selected":""}>${statusLabel(v)}</option>`).join("")}</select></div><div class="field full"><label>${t("diag.minConfidence",{pct:Math.round(ui.reviewConfidence*100)})}</label><input data-review-filter="confidence" type="range" min="0" max=".95" step=".05" value="${ui.reviewConfidence}"></div><button class="btn sm" data-review-action="draw">${ui.reviewDrawMode?t("action.cancelDrawing"):t("action.aiMissed")}</button><button class="btn sm" data-review-action="save-verified">${t("action.saveVerifiedPlan")}</button><button class="btn sm" data-review-action="improve">${t("action.improveAI")}</button><button class="btn sm" data-review-action="export-dataset" title="${t("action.exportDatasetTitle")}">${t("action.exportDataset")}</button><button class="btn sm" data-review-action="session-report">${t("op.report")}</button></div></details><button class="btn" data-review-action="reanalyze">${t("action.reanalyze")}</button>`:""}</header>${reviewQueueBarHTML(event)}${pi?`<div class="planintel-map ${ui.reviewDrawMode?"draw-mode":""}" id="analysisScene"><div class="planintel-map-inner" id="analysisSceneInner"><img src="${event.background.src}" alt="Floor plan analysis source">${candidates.map(c=>candidateBox(c,selected?.id===c.id,target?.ids||null)).join("")}${boundaryBox?`<div class="review-group-boundary" style="left:${Math.max(0,boundaryBox.x-2.5)}%;top:${Math.max(0,boundaryBox.y-2.5)}%;width:${boundaryBox.w+5}%;height:${boundaryBox.h+5}%"></div>`:""}${pins.map(p=>p.kind==="group"?`<button class="review-pin group" data-review-action="focus-group" data-group="${p.groupId}" style="left:${p.x}%;top:${p.y}%" title="Review group ${p.label}">${p.label}</button>`:`<button class="review-pin question" data-question-action="open" data-question="${p.questionId}" style="left:${p.x}%;top:${p.y}%" title="Difficult question">${p.label}</button>`).join("")}</div></div>${ui.operatorReportOpen?`<aside class="op-report-panel"><div class="op-report-head"><strong>${t("op.reportTitle")}</strong><button class="btn icon-only sm" data-review-action="close-session-report">${icon("x")}</button></div><div class="op-report-body">${operatorReportHTML(event)}</div></aside>`:""}${selected&&!ui.reviewDrawMode?reviewPoiCardHTML(selected):""}${difficultQuestionCardHTML(event)}${planIntelBottomPillHTML(event)}${ui.reviewCenterOpen?reviewCenterPanelHTML(event):""}`:`<div class="v8-empty" style="margin:40px"><h2>${ui.analysisBusy?t("plan.analyzingLocally"):t("plan.noAnalysisYet")}</h2><p>${esc(ui.analysisStage)}</p></div>`}</section>`;
  }
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
  function applyCorrectionToFamily(event,corrected,wasKind,wasType){
    const pi=event.analysis?.planIntelligence;if(!pi)return 0;
    // Prefer the full similarity family; fall back to the review group.
    const group=(pi.similarityGroups||[]).find(g=>(g.memberIds||[]).includes(corrected.id))
      ||(pi.reviewGroups||[]).find(g=>(g.memberIds||[]).includes(corrected.id));
    if(!group)return 0;
    let n=0;
    for(const id of group.memberIds){
      if(id===corrected.id)continue;
      const other=event.analysis.candidates.find(x=>x.id===id);
      if(!other||other.status!=="unreviewed")continue;
      if(other.kind!==wasKind||other.type!==wasType)continue;
      other.kind=corrected.kind;other.type=corrected.type;
      if(corrected.kind!=="table")other.chairDetections=[];
      other.status="confirmed";other.selected=true;
      rememberCorrection(event,other);
      // Captured, but marked as propagated. A person looked at one object and
      // this repaired forty; recording forty human decisions would overstate
      // the evidence by a factor of forty, and an evaluation that counted them
      // as independent labels would be measuring its own guess.
      captureTrainingExample(event,other,{decisionType:"correction",
        predictionBefore:{kind:wasKind,type:wasType,confidence:other.confidence,source:other.evidence?.geometry??null,candidateId:other.id},
        note:`propagated from ${corrected.id}; not individually reviewed by a person`});
      n++;
    }
    return n;
  }
  // A reclassification lives entirely in event.analysis.candidates and
  // event.planMemory. The canvas undo stack snapshots {tables, venueObjects,
  // background}, so it cannot reach any of it -- which meant one dropdown
  // change that repaired a whole family of objects was, until now,
  // irreversible. The more objects the spread correctly fixed, the more
  // damage an accidental wrong pick did.
  //
  // Session-only, deliberately on ui rather than the event: like ui.liveRecent
  // it is a property of this working session and must never reach the stored
  // schema.
  function recordCorrectionUndo(event,affectedIds,label){
    ui.correctionUndo ||= [];
    const before=affectedIds.map(id=>{
      const c=event.analysis.candidates.find(x=>x.id===id);
      return c?{id,kind:c.kind,type:c.type,status:c.status,selected:c.selected,
        chairDetections:clone(c.chairDetections||[])}:null;
    }).filter(Boolean);
    const memoryBefore=(event.planMemory||[]).map(m=>m.id);
    ui.correctionUndo.push({before,memoryBefore,label,at:nowISO()});
    if(ui.correctionUndo.length>30)ui.correctionUndo.shift();
  }
  function undoLastCorrection(){
    const event=activeEvent();
    if(!canMutate(event,"undo a plan correction"))return 0;
    const entry=(ui.correctionUndo||[]).pop();
    if(!entry)return 0;
    let restored=0;
    for(const snap of entry.before){
      const c=event.analysis?.candidates.find(x=>x.id===snap.id);
      if(!c)continue;
      c.kind=snap.kind;c.type=snap.type;c.status=snap.status;c.selected=snap.selected;
      c.chairDetections=snap.chairDetections;
      restored++;
    }
    // Corrections write plan memory, so undoing one has to withdraw the memory
    // entries it added -- otherwise the reverted classification would come
    // straight back on the next Re-Analyze.
    const keep=new Set(entry.memoryBefore);
    if(event.planMemory)event.planMemory=event.planMemory.filter(m=>keep.has(m.id));
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
      const [kind,type]=value.split(":"),crossedKind=kind!==c.kind;
      const wasKind=c.kind,wasType=c.type;
      // Snapshot the corrected object AND every object the spread is about to
      // reach, before anything changes, so undo restores the whole action as
      // one unit rather than leaving the family half-corrected.
      recordCorrectionUndo(event,[c.id,...familyCandidateIds(event,c,wasKind,wasType)],"reclassify");
      c.kind=kind;c.type=type;
      if(crossedKind&&kind!=="table")c.chairDetections=[]; // a chair/armchair/sofa/stage/etc. candidate carries no nested seat detections of its own.
      if(UNVERIFIED_SEATING.has(type)){
        // Reclassifying INTO seating furniture never invents a capacity. It
        // starts as an admitted unknown; the operator supplies the number.
        c.seats=null;c.seatsConfidence="unverified";
      }else{delete c.seats;delete c.seatsConfidence;}
      c.status="confirmed";c.selected=true;
      rememberCorrection(event,c);
      captureTrainingExample(event,c,{decisionType:crossedKind||wasType!==type?"correction":"confirmation",
        predictionBefore:{kind:wasKind,type:wasType,confidence:c.confidence,source:c.evidence?.geometry??null,candidateId:c.id}});
      // One correction should repair the whole family, not one object. Every
      // still-unreviewed candidate that the similarity clustering already
      // considers the same shape gets the same correction. This is
      // calibration against measured geometry, NOT model training -- nothing
      // is learned across plans.
      const spread=applyCorrectionToFamily(event,c,wasKind,wasType);
      recomputePlanIntelligence(event); // reclassifying can move a candidate in/out of furniture grouping, similarity clustering, review groups and the physical-seat capacity sum — never just relabel it.
      if(spread)toast(t("review.correctionSpread",{n:spread}),"success",4200);
    }
    else c[field]=value;
    touchEvent(event);render();
  }
  function commitCandidates(){
    const event=activeEvent(),chosen=event.analysis?.candidates.filter(c=>c.selected&&c.status!=="rejected")||[];if(!chosen.length)return toast("Select at least one detection to confirm.","error");
    // The same verdict runSelfCheck() already reads (analysis.diagnostics.
    // representation.kind==="PHYSICAL") -- one fact, one source. A table
    // committed off a SYMBOLIC plan (or one with no verdict at all, since
    // absence of evidence is not evidence of drawn chairs) gets
    // hasPhysicalSeats:false, so it carries NO chair objects at all --
    // not a ring of fabricated positions flagged as unreal.
    const drawsSeats=!!(event.analysis?.diagnostics?.representation?.kind==="PHYSICAL");
    recordUndo(event);let tables=0,venues=0;for(const c of chosen){if(c.committedId)continue;const x=c.x/100*WORLD.width,y=c.y/100*WORLD.height,w=Math.max(55,c.w/100*WORLD.width),h=Math.max(45,c.h/100*WORLD.height);if(c.kind==="table"){const table=syncTableChairs({id:uid("table"),number:uniqueNumber(event,"T",1),type:["round","square","rectangle","bistro"].includes(c.type)?c.type:"rectangle",x,y,w,h,capacity:Math.max(1,c.chairDetections?.length||1),zone:"MAIN FLOOR",rotation:c.rotation||0,locked:false,z:10,hasPhysicalSeats:drawsSeats||!!c.chairDetections?.length,capacitySource:c.chairDetections?.length?"DETECTED_PHYSICAL_SEATS":"UNKNOWN"});if(c.chairDetections?.length){table.chairs=c.chairDetections.map((ch,index)=>({id:uid("chair"),parentTableId:table.id,seatNumber:index+1,x:Math.max(0,Math.min(100,(ch.x-c.x)/c.w*100)),y:Math.max(0,Math.min(100,(ch.y-c.y)/c.h*100)),rotation:ch.rotation||0,occupancy:null}));table.capacity=table.chairs.length;}event.tables.push(table);c.committedId=table.id;tables++;}else{const object={id:uid("venue"),type:c.type||"text",label:String(c.type||"OBJECT").toUpperCase(),x,y,w,h,rotation:c.rotation||0,locked:false,z:4};
      // Seating furniture keeps its capacity state on the committed object, so
      // "we do not know how many this banquette seats" survives leaving the
      // review screen instead of silently becoming zero on the floor plan.
      if(UNVERIFIED_SEATING.has(object.type)){object.seats=c.seats??null;object.seatsConfidence=c.seats==null?"unverified":"verified";}
      event.venueObjects.push(object);c.committedId=object.id;venues++;}c.status="confirmed";}if(event.analysis.timings)event.analysis.timings.confirmedAtMs=Date.now();recordOperatorAction(event,"confirm-plan",chosen.map(c=>c.id));touchEvent(event);ui.tab="floor";ui.planMode="plan";render();toast(`${tables} table${tables===1?"":"s"}, ${venues} venue object${venues===1?"":"s"} confirmed. Chair coordinates were preserved.`,"success",6000);
  }
  function bindReviewDrawing(){const scene=document.getElementById("analysisScene");if(!scene||!ui.reviewDrawMode)return;scene.onpointerdown=e=>{if(e.target!==scene&&e.target.tagName!=="IMG")return;e.preventDefault();const r=scene.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top,box=document.createElement("div");box.className="candidate-box selected";scene.appendChild(box);const move=ev=>{const x=ev.clientX-r.left,y=ev.clientY-r.top;Object.assign(box.style,{left:Math.min(sx,x)+"px",top:Math.min(sy,y)+"px",width:Math.abs(x-sx)+"px",height:Math.abs(y-sy)+"px"});};const up=ev=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",up);const x=Math.min(sx,ev.clientX-r.left)/r.width*100,y=Math.min(sy,ev.clientY-r.top)/r.height*100,w=Math.abs(ev.clientX-r.left-sx)/r.width*100,h=Math.abs(ev.clientY-r.top-sy)/r.height*100;if(w>1&&h>1){const event=activeEvent();const c={id:uid("candidate"),kind:"table",type:"rectangle",x,y,w,h,rotation:0,confidence:1,status:"unreviewed",selected:true,missed:true,chairDetections:[],evidence:{geometry:"manual",chairs:0,repetition:0}};event.analysis.candidates.push(c);event.analysis.missed.push(c.id);rememberCorrection(event,c,{manual:true});captureTrainingExample(event,c,{decisionType:"missedObject",note:"drawn by the operator on a region the detector never proposed"});ui.selectedCandidateId=c.id;ui.reviewDrawMode=false;touchEvent(event);}render();};document.addEventListener("pointermove",move);document.addEventListener("pointerup",up);};}
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
      toast(`Dataset export failed: ${error.message}`,"error",7000);
    }
  }
  globalThis.MERIT_TRAINING_EXPORT=buildTrainingDatasetExport;

  function saveVerified(){const event=activeEvent();if(!ui.teachAI)return toast("Enable Teach AI with corrections first.","error");const a=event.analysis;if(!a)return;state.verifiedExamples.push({id:uid("verified"),eventId:event.id,savedAt:nowISO(),engine:a.engine,trainedModel:false,threshold:a.threshold,imageSize:[a.imageWidth,a.imageHeight],predictions:a.candidates.map(clone),groundTruth:a.candidates.filter(c=>c.status!=="rejected").map(clone),rejected:a.candidates.filter(c=>c.status==="rejected").map(c=>c.id),missed:[...a.missed],hardExample:a.missed.length>0||a.candidates.some(c=>c.status==="rejected")});saveState();toast("Verified plan saved locally with predictions, corrections, rejections and missed detections.","success",6000);}
  function improveAI(){if(!state.verifiedExamples.length)return toast("Save at least one verified plan first.","error");const samples=state.verifiedExamples.flatMap(v=>v.groundTruth||[]),avg=samples.length?samples.reduce((n,c)=>n+(c.confidence||0),0)/samples.length:0;state.calibration={version:(state.calibration?.version||0)+1,updatedAt:nowISO(),examples:state.verifiedExamples.length,objects:samples.length,recommendedConfidence:Number(Math.max(.35,Math.min(.8,avg*.85)).toFixed(2)),trainedModel:false,label:"Local assisted-detection calibration; not a trained neural model"};saveState();toast(`Local calibration v${state.calibration.version} completed from ${state.verifiedExamples.length} verified plan(s). No trained model claim is made.`,"success",6500);}
  function bindReview(){
    const ev=activeEvent();
    document.querySelectorAll("[data-budget-open]").forEach(b=>b.onclick=()=>openReviewQueue(ev,b.dataset.budgetOpen));
    document.querySelectorAll("[data-queue]").forEach(b=>b.onclick=()=>{
      const a=b.dataset.queue;
      if(a==="prev")queueGo(ev,-1);
      else if(a==="skip"){
        const q=ui.reviewQueue;if(!q)return;
        const id=q.ids[q.index];
        if(id&&!q.skipped.includes(id))q.skipped.push(id);
        queueNextOutstanding(ev);
      }
      else if(a==="next-outstanding")queueNextOutstanding(ev);
      else if(a==="exit")closeReviewQueue();
    });
    document.querySelectorAll("[data-review-action]").forEach(b=>b.onclick=()=>{const action=b.dataset.reviewAction,event=activeEvent(),c=event.analysis?.candidates.find(x=>x.id===ui.selectedCandidateId);if(action==="back"){ui.planMode="plan";ui.activeReviewGroupId=null;ui.activeQuestionId=null;ui.selectedCandidateId=null;render();}else if(action==="reanalyze")runAssistedDetection();else if(action==="commit")commitCandidates();else if(action==="confirm"&&c){const was=classOf(c);c.status="confirmed";c.selected=true;rememberCorrection(event,c);captureTrainingExample(event,c,{decisionType:"confirmation",predictionBefore:was});recordOperatorAction(event,"confirm",c.id);recomputePlanIntelligence(event);touchEvent(event);afterReviewDecision(event);}else if(action==="reject"&&c){const was=classOf(c);c.status="rejected";c.selected=false;rememberCorrection(event,c);captureTrainingExample(event,c,{decisionType:"falsePositive",predictionBefore:was});recordOperatorAction(event,"reject",c.id);recomputePlanIntelligence(event);touchEvent(event);afterReviewDecision(event);}else if(action==="dismiss"&&c){const was=classOf(c);captureTrainingExample(event,c,{decisionType:"negative",predictionBefore:was,note:"operator dismissed this region as not important"});recordOperatorAction(event,"dismiss",c.id);event.analysis.candidates=event.analysis.candidates.filter(x=>x.id!==c.id);ui.selectedCandidateId=null;recomputePlanIntelligence(event);touchEvent(event);afterReviewDecision(event);}else if(action==="teach"&&c){ui.teachScope=document.querySelector("[data-teach-scope]")?.value||"plan";teachSelectedObject(event,c,ui.teachScope);}else if(action==="confirm-number"&&c){const scope=document.querySelector("[data-teach-scope]")?.value||"plan";teachTableNumber(event,c,document.getElementById("poiNumber")?.value,scope);}else if(action==="forget"&&c){forgetLesson(event,c);}else if(action==="draw"){if(!ui.reviewDrawMode)recordOperatorAction(event,"ai-missed-open",[]);ui.reviewDrawMode=!ui.reviewDrawMode;ui.activeReviewGroupId=null;ui.activeQuestionId=null;render();}else if(action==="save-verified")saveVerified();else if(action==="improve")improveAI();else if(action==="export-dataset")exportTrainingDataset();else if(action==="session-report"){ui.operatorReportOpen=true;render();}else if(action==="close-session-report"){ui.operatorReportOpen=false;render();}else if(action==="open-review-center"){ui.reviewCenterOpen=true;render();}else if(action==="close-review-center"){ui.reviewCenterOpen=false;render();}else if(action==="focus-group"){ui.activeReviewGroupId=b.dataset.group;ui.selectedCandidateId=null;ui.activeQuestionId=null;ui.reviewCenterOpen=true;render();}else if(action==="toggle-lang"){ui.lang=ui.lang==="tr"?"en":"tr";render();}});
    document.querySelectorAll("[data-candidate],[data-candidate-box]").forEach(node=>node.onclick=e=>{if(e.target.matches("input"))return;ui.selectedCandidateId=node.dataset.candidate||node.dataset.candidateBox;ui.activeReviewGroupId=null;ui.activeQuestionId=null;render();});document.querySelectorAll("[data-candidate-select]").forEach(input=>input.onchange=()=>{const c=activeEvent().analysis.candidates.find(x=>x.id===input.dataset.candidateSelect);c.selected=input.checked;touchEvent(activeEvent());});document.querySelectorAll("[data-candidate-edit]").forEach(input=>input.onchange=()=>{const f=input.dataset.candidateEdit,v=input.value;requestAnimationFrame(()=>updateCandidateField(f,v));});document.querySelectorAll("[data-review-filter]").forEach(input=>input.oninput=()=>{if(input.dataset.reviewFilter==="status")ui.reviewFilter=input.value;else if(input.dataset.reviewFilter==="class")ui.reviewClass=input.value;else ui.reviewConfidence=Number(input.value);render();});document.querySelector("[data-teach-ai]")?.addEventListener("change",e=>{ui.teachAI=e.target.checked;});
    document.querySelectorAll("[data-reviewgroup-action]").forEach(b=>b.onclick=()=>{
      const event=activeEvent(),pi=event.analysis?.planIntelligence,group=pi?.reviewGroups.find(g=>g.id===b.dataset.group);if(!group)return;
      if(b.dataset.reviewgroupAction==="confirm-family"){
        const strong=group.memberIds.filter(id=>!group.outlierIds.includes(id));
        strong.forEach(id=>{const c=event.analysis.candidates.find(x=>x.id===id);if(c){const was=classOf(c);c.status="confirmed";c.selected=true;rememberCorrection(event,c);
          captureTrainingExample(event,c,{decisionType:"confirmation",predictionBefore:was,
            note:"accepted in bulk via Confirm All; not individually reviewed by a person"});}});
        recordOperatorAction(event,"confirm-family",strong);
        // The queue is only worth following if it reflects the answer just
        // given. Confirming a family removes it from review, changes the seat
        // and table counts every fact rests on, and can settle a
        // contradiction outright -- so the next question has to be computed
        // from the plan as it is now, not as it was at import.
        recomputePlanIntelligence(event);
        touchEvent(event);ui.reviewCenterOpen=group.outlierIds.length>0;render();
        toast(`${strong.length} object${strong.length===1?"":"s"} confirmed as ${group.title}. ${group.outlierIds.length?group.outlierIds.length+" outlier(s) still need review.":""}`,"success",5000);
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
        ?`Confirmed as one seating group. Plan now shows ${newPi.planSummary.diningGroups} dining group(s). Undo is available in Review Center.`
        :`Split into ${memberIds.length} separate tables. Plan now shows ${newPi.planSummary.diningGroups} dining group(s). Undo is available in Review Center.`,
        "success",6000);
    });
    document.querySelectorAll("[data-review-decision-action='undo-correction']").forEach(b=>b.onclick=()=>{
      const n=undoLastCorrection();
      render();
      if(n)toast(t("review.undoCorrectionToast",{n}),"success",5000);
    });
    document.querySelectorAll("[data-review-decision-action='undo-last']").forEach(b=>b.onclick=()=>{
      const event=activeEvent();if(!canMutate(event,"undo a plan decision"))return;
      const decisions=event.analysis?.groupingDecisions;if(!decisions?.length)return;
      const undone=decisions.pop();recomputePlanIntelligence(event);touchEvent(event);render();
      toast(`Undone: ${undone.decision==="merged"?"one seating group":"separate tables"} decision reverted.`,"success",5000);
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
    const a=document.createElement("a");a.href=url;a.download=`merit-event-maker-yedek-${todayKey()}.json`;
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
    reader.onload=()=>{
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
      if(!confirm(t("backup.confirmRestore",{n})))return;
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
    a.download=`merit-event-package-${String(event.name||"event").toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,60)}-${todayKey()}.json`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
    toast(t("eventPackage.exportedToast",{name:event.name}),"success");
  }
  function importEventPackagePayload(parsed){
    const P=globalThis.MeritEventPackage;
    if(!P||!P.isWellFormed(parsed)){toast(t("eventPackage.invalidFile"),"error",6000);return;}
    if(Number(parsed.formatVersion)>P.FORMAT_VERSION){toast(t("eventPackage.futureVersion"),"error",9000);return;}
    const isRecord=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
    if(parsed.auditEntries!=null&&!(Array.isArray(parsed.auditEntries)&&parsed.auditEntries.every(isRecord))){toast(t("eventPackage.invalidFile"),"error",6000);return;}
    if(parsed.venue!=null&&!isRecord(parsed.venue)){toast(t("eventPackage.invalidFile"),"error",6000);return;}
    const problem=P.eventProblem(parsed.event,"event");
    if(problem){toast(t("eventPackage.invalidRecord",{path:problem.path,rule:importRuleText(problem.rule)}),"error",9000);return;}
    if(!P.referencesIntact(parsed.event)){toast(t("eventPackage.badReference"),"error",6500);return;}
    if(!confirm(t("eventPackage.confirmImport",{name:parsed.event.name||""})))return;
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
    storageProvider.load("autosnapshots").then(stored=>{
      const snap=R.latestSnapshot(stored);
      if(!snap){toast(t("recovery.none"),"error");return;}
      if(!confirm(t("recovery.confirmRestore",{when:relativeTime(snap.at)})))return;
      state=parseRoot(snap.payload);
      ui.screen="events";ui.activeEventId=null;ui.undo=[];ui.redo=[];
      saveState();render();
      toast(t("recovery.restoredToast",{when:relativeTime(snap.at)}),"success");
    }).catch(error=>{console.warn("Automatic recovery restore failed.",loggableError(error));toast(t("recovery.none"),"error");});
  }
  function bindV8Common(){
    document.querySelectorAll("[data-action='create-event']").forEach(b=>b.onclick=startNewEvent);document.querySelectorAll("[data-action='help']").forEach(b=>b.onclick=openGuide);document.querySelectorAll("[data-open-event]").forEach(b=>b.onclick=()=>openEvent(b.dataset.openEvent));// Row-level open + per-row action buttons now coexist on Home, so the
// buttons must not bubble into the row's open handler.
document.querySelectorAll("[data-duplicate-event]").forEach(b=>b.onclick=e=>{e.stopPropagation();duplicateEvent(b.dataset.duplicateEvent);});document.querySelectorAll("[data-export-event-package]").forEach(b=>b.onclick=e=>{e.stopPropagation();exportEventPackage(b.dataset.exportEventPackage);});document.querySelectorAll("[data-delete-event]").forEach(b=>b.onclick=e=>{e.stopPropagation();deleteEvent(b.dataset.deleteEvent);});document.querySelectorAll("[data-history-event]").forEach(row=>row.ondblclick=()=>openEvent(row.dataset.historyEvent));document.querySelectorAll("[data-history-event] .row-icons").forEach(el=>el.ondblclick=e=>e.stopPropagation());
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
  openEvent = function(id){const event=state.events.find(e=>e.id===id);if(!event)return;ui.activeEventId=id;ui.screen="workspace";ui.tab=isHistorical(event)?"guests":"command";ui.selectedObjectId=null;ui.selectedObjectIds=[];ui.selectedGuestIds=[];ui.operationalMode=false;ui.undo=[];ui.redo=[];render();};
  duplicateEvent = function(id,open=false){const source=state.events.find(e=>e.id===id);if(!source)return;original.duplicateEvent(id,open);const copy=state.events[0];copy.hotel=copy.hotel||copy.venue||"";copy.salon=copy.salon||"";copy.tables.forEach(t=>{t.chairs=(t.chairs||[]).map((c,i)=>({...c,id:uid("chair"),parentTableId:t.id,seatNumber:i+1,occupancy:null}));});saveState();};

  // What the operator sees when the stored record was written by a newer
  // build: the reason, both version numbers, and what to do -- not an empty
  // app with no explanation. Rendered ABOVE everything else and never
  // dismissed, because every control below it is operating on a blank slate
  // that will not be saved.
  function futureSchemaBannerHTML(){
    const g=globalThis.MERIT_SCHEMA_GUARD;
    if(!g||!g.readOnly)return"";
    return`<div class="schema-future-banner" data-schema-future role="alert">${icon("alert")}<div>
      <b>${esc(t("schema.futureTitle"))}</b>
      <span>${esc(t("schema.futureBody",{stored:g.storedVersion,build:g.buildVersion}))}</span>
    </div></div>`;
  }
  render = function(){
    translateStaticDialogs();
    if(ui.screen==="new-event"){app.innerHTML=setupHTML();bindSetup();return;}
    // No review branch here any more: review renders inside the workspace's
    // content area like every other mode, so the shell above it never leaves.
    if(!state.events.length&&ui.screen!=="events")ui.screen="events";
    app.innerHTML=futureSchemaBannerHTML()+(ui.screen==="events"?eventsHTML():workspaceHTML(activeEvent()));bindV8Common();
    if(ui.screen==="workspace"){
      const event=activeEvent(),historical=isHistorical(event);
      // Review mode draws no editable canvas, so bindCanvas() must not run for
      // it -- it would query a viewport that is not on the page.
      const reviewing=ui.tab==="floor"&&ui.planMode==="review";
      const changesMode=ui.tab==="floor"&&ui.planMode==="changes";
      // The changes view is the same canvas, so it keeps the same bindings --
      // pan, zoom and selection all still work while reading the diff.
      if(((ui.tab==="floor"&&!reviewing)||ui.tab==="seating")&&!historical)bindCanvas();
      if(reviewing&&!historical)bindReview();
      if(changesMode)bindLayoutChanges();
      if(ui.tab==="command"&&!historical)bindCommand();
      // Freeze bindings run on both canvases: the layer toggle lives in the
      // shared toolbar, and the panel and the override challenge in Seating.
      if(((ui.tab==="floor"&&!reviewing)||ui.tab==="seating")&&!historical)bindFreezeZones();
      if(ui.tab==="seating"&&!historical){bindSeating();bindSmartSeating();}if(ui.tab==="guests"&&!historical)bindGuests();if(ui.tab==="live"&&!historical)bindLive();if(ui.tab==="reports")bindReports();
      if(historical&&ui.tab==="seating")requestAnimationFrame(()=>fitCanvas(false));
    }
  };

  const oldGuideRender=renderGuide;
  renderGuide = function(){
    const root=document.getElementById("guideRoot"),tr=ui.guideLang==="tr",title=tr?"V8 Kullanıcı Kılavuzu":"V8 User Guide",cards=tr?[
      ["Etkinlikler","Yaklaşan etkinlikler kartlarda, geçmiş etkinlikler kilitli tabloda görünür. Geçmiş satırına çift tıklayın."],["Plan ve PDF","PNG/JPG/PDF yerelde açılır. PDF sayfasını küçük önizlemelerden seçin; hiçbir dosya yüklenmez."],["Assisted Detection","Klasik görüntü işleme adayları üretir. Sonuçlar AI değildir; onaylamadan plana eklenmez."],["Koltuk Yerleşimi","Ctrl/Shift ile çoklu seçim yapın. Grup taşıma tek işlem olarak doğrulanır; kapasite yetmezse hiçbir kayıt değişmez."],["Canlı Operasyon","No Show planlanan yeri korur ancak canlı kapasiteyi serbest bırakır. Empty Chairs kırmızı ışıklı koltuk görünümünü açar."],["Excel ve Kayıt","XLSX tamamen çevrimdışıdır. Table Plan, Guest List ve Unassigned sayfaları korunur; veriler tarayıcıda otomatik kaydedilir."]
    ]:[
      ["Events","Upcoming work appears as cards; past and Completed events are locked in History. Double-click a history row."],["Plans and PDF","PNG/JPG/PDF opens locally. Select PDF pages from thumbnails; no file is uploaded."],["Assisted Detection","Classical computer vision proposes candidates. It is not a trained AI model, and nothing is added until confirmation."],["Seating","Use Ctrl/Shift for multi-selection. Group moves validate as one transaction; insufficient capacity changes nothing."],["Live Operations","No Show preserves the planned assignment but releases live capacity. Empty Chairs opens the red-glow operational view."],["Excel and Storage","XLSX works offline. Table Plan, Guest List and Unassigned sheets remain available; browser autosave is automatic."]
    ];root.innerHTML=`<aside class="guide-nav"><div class="guide-brand"><strong>MERIT EVENT MAKER</strong><span>${title}</span></div></aside><section class="guide-main"><header class="guide-top"><h2>${title}</h2><div class="guide-actions"><div class="lang-toggle"><button data-guide-lang="en" class="${!tr?"active":""}">EN</button><button data-guide-lang="tr" class="${tr?"active":""}">TR</button></div><button class="btn quiet" data-guide-reset-onboarding>${tr?"İpuçlarını yeniden göster":"Show tips again"}</button><button class="btn" data-guide-print>${icon("print")}Print / PDF</button><button class="btn icon-only" data-guide-close>${icon("x")}</button></div></header><div class="guide-content"><div class="guide-hero"><div class="kicker">MERIT ENTERTAINMENT · V8 BROWSER REVIEW</div><h1>${title}</h1><p>${tr?"Masa planı, fiziksel koltuklar, misafirler, canlı operasyon ve doğrulanmış plan düzeltmeleri için çevrimdışı başvuru.":"Offline reference for plan objects, physical chairs, guests, live operations and verified plan corrections."}</p></div><div class="guide-v8-grid">${cards.map(([h,p])=>`<article class="guide-v8-card"><h3>${h}</h3><p>${p}</p></article>`).join("")}</div><div class="guide-tip">${tr?"Bu sürüm tarayıcı incelemesidir; EXE veya masaüstü çalışma zamanı içermez.":"This is a browser review build; it does not include an EXE or desktop runtime."}</div></div></section>`;root.querySelectorAll("[data-guide-lang]").forEach(b=>b.onclick=()=>{ui.guideLang=b.dataset.guideLang;renderGuide();});root.querySelector("[data-guide-close]").onclick=()=>document.getElementById("guideDialog").close();root.querySelector("[data-guide-print]").onclick=()=>window.print();
    root.querySelector("[data-guide-reset-onboarding]").onclick=()=>{resetOnboarding();toast(tr?"İpuçları yeniden gösterilecek.":"Onboarding tips will show again.","success");};
  };
  openGuide = function(){renderGuide();document.getElementById("guideDialog").showModal();};

  const oldFloorInput=document.getElementById("floorPlanFile"),freshFloorInput=oldFloorInput.cloneNode(true);oldFloorInput.replaceWith(freshFloorInput);freshFloorInput.addEventListener("change",async e=>{const file=e.target.files[0],event=activeEvent();if(!file||!event||!canMutate(event,"replace the floor plan"))return;try{let src,name=file.name;if(file.type==="application/pdf"||file.name.toLowerCase().endsWith(".pdf")){const pdf=await waitForPdf(),doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise,pageNumber=Math.max(1,Math.min(doc.numPages,Number(prompt(`PDF contains ${doc.numPages} pages. Enter page number:`,"1"))||1)),page=await doc.getPage(pageNumber),v=page.getViewport({scale:2.6}),canvas=document.createElement("canvas");canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);await page.render({canvasContext:canvas.getContext("2d"),viewport:v}).promise;src=canvas.toDataURL("image/png",.96);name=`${file.name} · page ${pageNumber}`;}else src=await readImageFile(file);recordUndo(event);event.background={src,name,opacity:.34,visible:true,locked:true,isDefault:false,scale:100,importedAtMs:Date.now()};touchEvent(event);render();toast("Floor plan imported locally. Assisted Detection is ready.","success");}catch(error){toast(t("plan.replaceFailed",{reason:error.message}),"error",6500);}finally{e.target.value="";}});

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
  for(const id of ["guestDialog","excelDialog","guideDialog"]){
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
    if(e.key==="Escape"){if(ui.freezeDraft)ui.freezeDraft=null;if(ui.reviewQueue){ui.reviewQueue=null;ui.selectedCandidateId=null;}if(ui.repeatPlacement){ui.repeatPlacement=null;toast("Repeated placement cancelled.");}if(ui.focusMode)ui.focusMode=false;if(ui.reviewDrawMode)ui.reviewDrawMode=false;if(ui.activeQuestionId)ui.activeQuestionId=null;if(ui.reviewCenterOpen)ui.reviewCenterOpen=false;render();return;}
    if(ui.screen!=="workspace"||ui.tab!=="floor"||isHistorical(activeEvent()))return;
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
    state=data;bootReady=true;render();
    // Never a silent swap: if the primary record could not be read at all
    // and an automatic snapshot stood in for it, the operator is told
    // plainly, including that it may not hold the most recent changes.
    if(recoveredAt)toast(t("recovery.bootRecoveredToast",{when:relativeTime(recoveredAt)}),"error",9000);
  }).catch(error=>{
    console.error("Storage load failed entirely; starting from a blank state.",loggableError(error));
    state=blankRoot();bootReady=true;render();
  });
})();