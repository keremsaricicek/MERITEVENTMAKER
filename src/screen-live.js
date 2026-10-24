// The Live screen: the door list, its search, and the arrival wave.
//
// Moved verbatim out of app-v8.js on 2026-10-04 (technical gaps, item 2) —
// indentation kept, so every template's text is byte-identical. Three edits,
// each forced by the move: the two shell overrides became this module's own
// functions (app-v8.js keeps \`liveHTML\`/\`bindLive\` and calls through), and
// the mutation counter is read through an accessor because it is a number the
// shell keeps changing.
//
// Everything it reads from the app shell is handed to it by create(deps), once;
// it reads no shell global itself (\`dependency-direction\`, and
// \`screen-modules\` holds the list of names below against what the code uses).
(() => {
  "use strict";
  let ui;
  let t;
  let esc;
  let icon;
  let naturalSort;
  let paxOf;
  let activeEvent;
  let render;
  let touchEvent;
  let toast;
  let OCC;
  let SEARCH;
  let canMutate;
  let liveEmptyHTML;
  let partyMetaHTML;
  let recordArrival;
  let seatTagHTML;
  let setArrival;
  let tableIndex;
  let epoch;
  let created=false;

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
    if(waveMemo.event===event&&waveMemo.epoch===epoch()&&waveMemo.step===step)return waveMemo.wave;
    waveMemo={event,epoch:epoch(),step,
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
  const liveHTML = function(event){
    const q=ui.liveQuery.trim(),s=OCC().liveStats(event,{paxOf});
    if(!ui.liveRecent)ui.liveRecent=[];
    const byId=tableIndex(event);
    // The wave selection narrows the SAME list the search does, rather than
    // opening a second one: selecting 19:30 is a filter on the door queue, and
    // the operator has to be able to work straight out of it and then leave.
    const waveIds=ui.waveKey?waveGuestIds(event,ui.waveKey):null;
    const vipIds=ui.waveVip?new Set(arrivalWave(event)?.vipStillExpected.guestIds||[]):null;
    // Same engine as the Global Finder (MeritGuestSearch): a query at the door
    // matches exactly the guests it would match in the appbar search — same
    // haystack (name, VIP, host, notes, both statuses, table number/zone),
    // same AND-narrowing across terms. Only the sort differs, on purpose:
    // Live orders "who is still outside" first, never by name-match rank.
    const matchedIds=q?new Set(SEARCH.matchRows(event,q).rows.map(r=>r.guest.id)):null;
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
    // Armed = the one row Enter will act on: the only match, or -- with several
    // -- the row the operator CHOSE with the arrow keys (§23). With several and
    // no choice, nothing is armed and Enter still refuses: typing a first name
    // must never check in whoever happens to sort first.
    const chosen=q&&rows.length>1&&ui.liveCursor&&rows.some(g=>g.id===ui.liveCursor)?ui.liveCursor:null;
    const armedId=chosen&&rows.find(g=>g.id===chosen).arrivalStatus!=="Checked In"?chosen
      :q&&rows.length===1&&rows[0].arrivalStatus!=="Checked In"?rows[0].id:null;
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
    }).join(""):`<div class="mx-empty">${liveEmptyHTML(event,q)}</div>`;
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
  const bindLive = function(){
    const search=document.getElementById("liveSearch");
    if(search){
      search.oninput=()=>{
        ui.liveQuery=search.value;
        ui.liveCursor=null;   // a new search is a new list: no row stays chosen
        // A new search is a new list, so the window starts again from the top.
        ui.liveWindow=LIVE_WINDOW_STEP;
        const pos=search.selectionStart;
        render();
        // Focus and caret go back SYNCHRONOUSLY (§23). They used to wait for the
        // next animation frame, so a keystroke landing in between -- a fast
        // typist, a badge or barcode scanner at the door -- met a stale caret
        // and "Mehmet" became "metMeh". The test helper typed with a 20ms delay
        // and retried, which is why no suite saw it.
        const n=document.getElementById("liveSearch");
        if(n){n.focus();n.setSelectionRange(pos,pos);}
      };
      // The door flow: type a name, press Enter, type the next name. The query
      // clears on a successful check-in so the operator never has to reach for
      // the mouse between two guests.
      search.onkeydown=e=>{
        // stopPropagation: the window-level Escape handler would otherwise fire a
        // second render for a key that means only "clear this field".
        if(e.key==="Escape"){e.preventDefault();e.stopPropagation();ui.liveQuery="";ui.liveCursor=null;render();focusLiveSearch();return;}
        // ↑/↓ choose among several matches; the chosen row is marked exactly as
        // a unique match is, so the operator sees whose door Enter will open.
        if((e.key==="ArrowDown"||e.key==="ArrowUp")&&ui.liveQuery.trim()&&liveVisibleIds.length>1){
          e.preventDefault();
          const i=liveVisibleIds.indexOf(ui.liveCursor),n=liveVisibleIds.length;
          ui.liveCursor=liveVisibleIds[i<0?(e.key==="ArrowDown"?0:n-1):(i+(e.key==="ArrowDown"?1:n-1))%n];
          render();focusLiveSearch();
          document.querySelector(".arrival-row.is-armed, .arrival-row.is-chosen")?.scrollIntoView({block:"nearest"});
          return;
        }
        // Ctrl/⌘+Z with an empty search takes back the last arrival change --
        // the same as its Undo in Recent. With text in the box it stays the
        // box's own text undo.
        if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==="z"&&!search.value){
          const last=(ui.liveRecent||[])[0];
          if(last){e.preventDefault();document.querySelector(`[data-live-undo="${CSS.escape(last.guestId)}"]`)?.click();focusLiveSearch();}
          return;
        }
        if(e.key!=="Enter")return;
        e.preventDefault();
        if(!ui.liveQuery.trim())return;
        const event=activeEvent();if(!canMutate(event,"change live arrival status"))return;
        if(!liveVisibleIds.length)return;
        const pick=liveVisibleIds.length>1?(liveVisibleIds.includes(ui.liveCursor)?ui.liveCursor:null):liveVisibleIds[0];
        if(!pick){toast(t("live.tooMany",{n:liveVisibleIds.length}));return;}
        const g=event.guests.find(x=>x.id===pick);if(!g)return;
        if(g.arrivalStatus==="Checked In"){toast(t("live.alreadyIn",{name:g.name}));return;}
        const from=g.arrivalStatus;
        // Same single axis as the buttons: arrivalStatus only. planningStatus
        // and the planned seat assignment are untouched.
        setArrival(event,g,"Checked In","live-keyboard");
        recordArrival(g,from,"Checked In");
        ui.liveQuery="";ui.liveCursor=null;
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

  function create(deps){
    if(created)throw new Error("MeritScreenLive.create() is called once, by app-v8.js.");
    created=true;
    ui=deps.ui;
    t=deps.t;
    esc=deps.esc;
    icon=deps.icon;
    naturalSort=deps.naturalSort;
    paxOf=deps.paxOf;
    activeEvent=deps.activeEvent;
    render=deps.render;
    touchEvent=deps.touchEvent;
    toast=deps.toast;
    OCC=deps.OCC;
    SEARCH=deps.SEARCH;
    canMutate=deps.canMutate;
    liveEmptyHTML=deps.liveEmptyHTML;
    partyMetaHTML=deps.partyMetaHTML;
    recordArrival=deps.recordArrival;
    seatTagHTML=deps.seatTagHTML;
    setArrival=deps.setArrival;
    tableIndex=deps.tableIndex;
    epoch=deps.epoch;
    return{html:liveHTML,bind:bindLive,arrivalWave,arrivalWaveHTML,bindArrivalWaveControls};
  }
  globalThis.MeritScreenLive=Object.freeze({create,DEPS:Object.freeze(["ui", "t", "esc", "icon", "naturalSort", "paxOf", "activeEvent", "render", "touchEvent", "toast", "OCC", "SEARCH", "canMutate", "liveEmptyHTML", "partyMetaHTML", "recordArrival", "seatTagHTML", "setArrival", "tableIndex", "epoch"])});
})();
