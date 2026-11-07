// MERIT Event Maker — the one top bar (MeritScreenTopbar), redesign v4.
//
// The owner-approved look (SPEC-v4.md; references benchmarks/ux/redesign/
// 7-atlas-sade = theme A, 8-tema-b = theme B; the step-1 look was rejected):
// an "otel tabelası" — the MERIT mark, then the six screens as small-caps words
// with thin separators and NO icons, in the working order Etkinlik · Salon ·
// Misafirler · Oturma · Kapı · Raporlar. A finished step carries a thin ✓, the
// next unfinished step is the emphasised word, and one quiet "Sonraki: X →"
// sits at the bottom right. Right side: the guest finder, event name · clock ·
// theme · "Mimar" (the existing F8 assistant, src/screen-assistant.js) · ⋯.
//
// It builds markup and owns two machine-level choices; it changes no event.
// "Finished" is DERIVED from the event each render (stepProgress) and stored
// nowhere. Every control the old headers carried keeps a home: the rare ones
// sit in the ⋯ menu with the SAME data-action the shell's binder already wires,
// so no writer moved. A historical event shows only the three screens it ever
// had, no next step and no "Sonraki".
//
// TWO THEMES × LIGHT/DARK: data-skin "a" (Atlas sade, default) | "b"
// (Birleşik) and data-theme "light" | "dark" on <html>. Both are facts about
// this machine, not about an event: localStorage "merit.skin.v1" and
// "merit.theme.v1", read and written inside try/catch, so a storage that
// refuses only loses the memory — the switch still happens.
//
// Everything this reads from the shell is handed to it by create(deps), once.
(() => {
  "use strict";
  let esc;
  let t;
  let created=false;

  const THEME_KEY="merit.theme.v1";
  const SKIN_KEY="merit.skin.v1";
  const SKINS=[["a","shell.skin.a"],["b","shell.skin.b"]];
  const sv=(body,size=16)=>`<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  // The bar's few icons (the screens themselves are words), on a 16 px grid.
  const IC={
    search:sv('<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2 13.8 13.8"/>'),
    moon:sv('<path d="M12.8 9.6A5.3 5.3 0 0 1 6.4 3.2a5.3 5.3 0 1 0 6.4 6.4z"/>'),
    sun:sv('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>'),
    more:sv('<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>'),
    lock:sv('<rect x="3.5" y="7" width="9" height="6.5" rx="1.4"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/>',12),
  };
  // tab id → label key, in the owner's working order (SPEC-v4 "The working order").
  const ITEMS=[["command","shell.nav.event"],["floor","shell.nav.salon"],["guests","shell.nav.guests"],
    ["seating","shell.nav.seating"],["live","shell.nav.door"],["reports","shell.nav.reports"]];
  const LABEL=Object.fromEntries(ITEMS);
  const HISTORY_TABS=new Set(["guests","seating","reports"]);

  function clockText(){const d=new Date();return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");}
  let clockTimer=null;
  function startClock(){
    if(clockTimer)return;
    clockTimer=setInterval(()=>{const v=clockText();document.querySelectorAll("[data-shell-clock]").forEach(n=>{if(n.textContent!==v)n.textContent=v;});},15000);
  }

  // ---- theme ------------------------------------------------------------------
  function readTheme(){try{const v=globalThis.localStorage.getItem(THEME_KEY);return v==="dark"?"dark":"light";}catch{return"light";}}
  function current(){return document.documentElement.dataset.theme==="dark"?"dark":"light";}
  function setTheme(name){
    const v=name==="dark"?"dark":"light";
    document.documentElement.dataset.theme=v;
    // EXPECTED ABSTENTION: a storage that refuses (private mode, quota) only
    // loses the memory of the choice; the screen still switches.
    try{globalThis.localStorage.setItem(THEME_KEY,v);}catch(error){console.warn("The theme choice could not be remembered on this machine.",error&&error.name);}
    document.querySelectorAll("[data-shell-theme]").forEach(b=>{const label=t(v==="dark"?"shell.theme.toLight":"shell.theme.toDark");b.title=label;b.setAttribute("aria-label",label);});
    return v;
  }
  function toggleTheme(){return setTheme(current()==="dark"?"light":"dark");}
  function initTheme(){document.documentElement.dataset.theme=readTheme();document.documentElement.dataset.skin=readSkin();}

  // ---- the two themes (A Atlas sade, B Birleşik) --------------------------------
  function readSkin(){try{return globalThis.localStorage.getItem(SKIN_KEY)==="b"?"b":"a";}catch{return"a";}}
  function currentSkin(){return document.documentElement.dataset.skin==="b"?"b":"a";}
  function setSkin(name){
    const v=name==="b"?"b":"a";
    document.documentElement.dataset.skin=v;
    // EXPECTED ABSTENTION: as for light/dark — only the memory is lost.
    try{globalThis.localStorage.setItem(SKIN_KEY,v);}catch(error){console.warn("The theme choice could not be remembered on this machine.",error&&error.name);}
    document.querySelectorAll("[data-shell-skin]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.shellSkin===v)));
    return v;
  }

  // ---- the working order ------------------------------------------------------
  // Derived from the event on every render, stored nowhere. Kapı and Raporlar
  // are never "finished": they are the evening and its paperwork.
  function stepProgress(event){
    const tables=event&&Array.isArray(event.tables)?event.tables:[],guests=event&&Array.isArray(event.guests)?event.guests:[];
    const unreviewed=((event&&event.analysis&&event.analysis.candidates)||[]).some(c=>c&&c.status==="unreviewed");
    const done={command:true,floor:tables.length>0&&!unreviewed,guests:guests.length>0,seating:guests.length>0&&guests.every(g=>g&&g.assignment),live:false,reports:false};
    const next=ITEMS.map(([id])=>id).find(id=>!done[id])||null;
    return{done,next};
  }
  function nextScreen(current){const ids=ITEMS.map(([id])=>id),i=ids.indexOf(current);return i>=0&&i<ids.length-1?ids[i+1]:null;}

  // ---- markup -----------------------------------------------------------------
  function navHTML(ctx){
    const ws=ctx.screen==="workspace";
    const items=ITEMS.map(([id,key])=>{
      const pr=ws&&!ctx.historical?ctx.progress:null;
      const finished=!!(pr&&pr.done[id]),isNext=!!(pr&&pr.next===id);
      const label=`<span class="shell-nav-label">${esc(t(key))}</span>${finished?`<span class="shell-nav-check" role="img" aria-label="${esc(t("shell.nav.done"))}"></span>`:""}`;
      if(ws){
        if(ctx.historical&&!HISTORY_TABS.has(id)){
          // A finished event has no overview, Salon or Kapı. The overview's
          // place takes you back to the calendar; the editing surfaces are
          // absent, not disabled (historical-immutability).
          return id==="command"?`<button type="button" class="shell-nav-item" data-shell-home title="${esc(t("shell.nav.toCalendar"))}">${label}</button>`:"";
        }
        const on=ctx.current===id;
        const title=isNext?` title="${esc(t("shell.nav.nextStep"))}"`:"";
        return`<button type="button" class="tab shell-nav-item${on?" active":""}${finished?" done":""}${isNext?" next":""}" data-tab="${id}"${on?' aria-current="page"':""}${title}>${label}</button>`;
      }
      // The events home: Etkinlik is where you are; the others open the event
      // selected in the calendar on that screen.
      if(id==="command")return`<button type="button" class="shell-nav-item active" data-shell-home aria-current="page">${label}</button>`;
      const target=ctx.homeTarget;
      const off=!target||(target.historical&&!HISTORY_TABS.has(id));
      const why=!target?t("shell.nav.chooseFirst"):off?t("shell.nav.readOnly"):"";
      return`<button type="button" class="shell-nav-item" data-shell-open="${id}"${target&&!off?` data-shell-event="${esc(target.id)}"`:""}${off?" disabled":""}${why?` title="${esc(why)}"`:""}>${label}</button>`;
    }).join("");
    return`<nav class="shell-nav tabs" aria-label="${esc(t("shell.nav.label"))}">${items}</nav>`;
  }
  // The guest finder (#globalGuestSearch, src/guest-search.js) keeps its home
  // in the bar, quieter; a sentence it cannot match still goes to Mimar.
  function commandHTML(ctx){
    if(ctx.screen!=="workspace")return`<div class="shell-cmd shell-cmd-empty"></div>`;
    const ph=esc(t("shell.command.placeholder"));
    return`<div class="shell-cmd"><div class="shell-cmd-box">${IC.search}<input id="globalGuestSearch" placeholder="${ph}" aria-label="${ph}" autocomplete="off" spellcheck="false"></div><div id="globalSearchResults" class="search-results hidden"></div></div>`;
  }
  function skinRowsHTML(){
    const cur=currentSkin();
    return[`<div class="shell-menu-head">${esc(t("shell.skin.title"))}</div>`,...SKINS.map(([id,key])=>`<button type="button" class="shell-menu-item shell-skin-item" data-shell-skin="${id}" aria-pressed="${cur===id}">${esc(t(key))}</button>`),"<hr>"];
  }
  // ⋯: the same data-action / data-v8-action the shell's binder already wires.
  function menuHTML(ctx){
    const item=(attr,label,title)=>`<button type="button" class="shell-menu-item" ${attr}${title?` title="${esc(title)}"`:""}>${esc(label)}</button>`;
    const rows=[...skinRowsHTML(),...(ctx.screen==="workspace"?[
      item('data-action="back-events"',t("appbar.allEvents")),
      item('data-action="save-now"',t("appbar.saveNow")),
      `<button type="button" class="shell-menu-item lang-btn" data-v8-action="toggle-lang" title="Language / Dil">${esc(t("shell.menu.language"))}</button>`,
      item('data-action="help"',t("appbar.help"),t("appbar.helpTitle")),
    ]:[
      item('data-action="help"',t("appbar.help"),t("appbar.helpTitle")),
      "<hr>",
      item('data-action="backup-export"',t("backup.export")),
      item('data-action="backup-import"',t("backup.import")),
      item('data-action="recovery-restore"',t("recovery.buttonTitle")),
      ...(ctx.diskBackup?[item('data-action="disk-backup-restore"',t("diskBackup.buttonTitle")),item('data-action="diagnose-report"',t("diagnose.buttonTitle"))]:[]),
    ])];
    return`<details class="shell-more"><summary class="shell-icon-btn" title="${esc(t("shell.more"))}" aria-label="${esc(t("shell.more"))}">${IC.more}</summary><div class="shell-menu">${rows.join("")}</div></details>`;
  }
  function barHTML(ctx){
    const ws=ctx.screen==="workspace";
    const version=globalThis.MERIT_APP_VERSION?`<small class="brand-version">${esc(globalThis.MERIT_APP_VERSION)}</small>`:"";
    const brandInner=`<b>MERIT</b>${version}`;
    // The mark is the way back to the calendar from inside an event.
    const brand=ws?`<button type="button" class="shell-brand" data-action="back-events" title="${esc(t("shell.brandTitle"))}">${brandInner}</button>`:`<div class="shell-brand">${brandInner}</div>`;
    const theme=current(),themeLabel=esc(t(theme==="dark"?"shell.theme.toLight":"shell.theme.toDark"));
    const eventId=ws&&ctx.event?`<div class="event-id" title="${esc(ctx.event.sub||"")}"><strong>${esc(ctx.event.name)}</strong></div><span class="shell-sep" aria-hidden="true"></span>`:"";
    const open=esc(t("shell.command.open"));
    const mimar=`<button type="button" class="shell-mimar" data-shell-assistant title="${open}" aria-label="${open}">${esc(t("shell.mimar"))} <kbd>F8</kbd></button>`;
    const nx=ws&&!ctx.historical?nextScreen(ctx.current):null;
    const next=nx?`<button type="button" class="shell-next" data-shell-next="${nx}">${esc(t("shell.nextTo",{screen:t(LABEL[nx])}))}</button>`:"";
    return`<header class="shell-top theme-scope${ws?" workspace-head":""}">${brand}${navHTML(ctx)}${commandHTML(ctx)}<div class="shell-right workspace-actions">${ctx.planHealth||""}${eventId}<span class="shell-clock" data-shell-clock title="${esc(t("shell.clockTitle"))}">${clockText()}</span><button type="button" class="shell-icon-btn shell-theme" data-shell-theme title="${themeLabel}" aria-label="${themeLabel}"><span class="shell-theme-moon">${IC.moon}</span><span class="shell-theme-sun">${IC.sun}</span></button>${mimar}${menuHTML(ctx)}</div>${next}</header>`;
  }

  function create(deps){
    if(created)throw new Error("MeritScreenTopbar.create() is called once, by app-v8.js.");
    created=true;
    esc=deps.esc;
    t=deps.t;
    initTheme();
    startClock();
    return{barHTML,icons:IC,stepProgress,theme:Object.freeze({current,set:setTheme,toggle:toggleTheme}),skin:Object.freeze({current:currentSkin,set:setSkin})};
  }
  globalThis.MeritScreenTopbar=Object.freeze({create,DEPS:Object.freeze(["esc","t"])});
})();
