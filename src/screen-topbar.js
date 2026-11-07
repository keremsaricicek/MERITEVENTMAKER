// MERIT Event Maker — the one top bar (MeritScreenTopbar), redesign step 1.
//
// The owner-approved shell (benchmarks/ux/redesign/6-birlesik, SPEC-v2.md
// "Structure"): ONE thin quiet bar — "MERIT Event Maker" · Etkinlik · Salon ·
// Misafirler · Oturma · Kapı · Raporlar (inline icon + label) · the F8 command
// line · event name + clock · theme · ⋯. No left sidebar, no tab strip.
//
// It builds markup and owns the light/dark choice; it changes no event. The
// six items are the screens the workspace already had (Etkinlik is the event's
// overview, the Command Center); a historical event shows only the three it
// ever had. Every control the old headers carried keeps a home: the rare ones
// sit in the ⋯ menu with the SAME data-action the shell's binder already wires,
// so no writer moved. The command line is the existing guest finder
// (#globalGuestSearch) plus the door into the existing F8 assistant
// (src/screen-assistant.js, untouched).
//
// The theme is a fact about this machine, not about an event: it lives in
// localStorage ("merit.theme.v1"), read and written inside try/catch, so a
// storage that refuses only loses the memory — the switch still happens.
//
// Everything this reads from the shell is handed to it by create(deps), once.
(() => {
  "use strict";
  let esc;
  let t;
  let created=false;

  const THEME_KEY="merit.theme.v1";
  const sv=(body,size=16)=>`<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  // The prototype's icons, drawn on a 16 px grid.
  const IC={
    event:sv('<rect x="2.5" y="3.5" width="11" height="10" rx="1.6"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>'),
    salon:sv('<rect x="2.5" y="2.5" width="11" height="11" rx="1.6"/><circle cx="6" cy="6.5" r="1.4"/><rect x="8.6" y="8.6" width="3" height="2.4" rx=".6"/>'),
    guests:sv('<circle cx="6" cy="5.5" r="2.2"/><path d="M2.5 13c.4-2.2 1.8-3.4 3.5-3.4s3.1 1.2 3.5 3.4"/><circle cx="11" cy="6.2" r="1.7"/><path d="M10.4 9.7c1.6 0 2.7 1 3.1 2.8"/>'),
    seating:sv('<circle cx="8" cy="8" r="2.4"/><circle cx="8" cy="2.8" r="1"/><circle cx="8" cy="13.2" r="1"/><circle cx="2.8" cy="8" r="1"/><circle cx="13.2" cy="8" r="1"/>'),
    door:sv('<path d="M4 13.5V3.2c0-.4.3-.7.7-.7h6.6c.4 0 .7.3.7.7v10.3M2.5 13.5h11"/><circle cx="9.6" cy="8.4" r=".6" fill="currentColor"/>'),
    reports:sv('<path d="M4 2.5h5.5L12.5 5.5v8H4z"/><path d="M9.5 2.5v3h3M6 8.5h4.5M6 11h4.5"/>'),
    search:sv('<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2 13.8 13.8"/>'),
    moon:sv('<path d="M12.8 9.6A5.3 5.3 0 0 1 6.4 3.2a5.3 5.3 0 1 0 6.4 6.4z"/>'),
    sun:sv('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>'),
    more:sv('<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>'),
    lock:sv('<rect x="3.5" y="7" width="9" height="6.5" rx="1.4"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/>',12),
  };
  // tab id → label key, icon. The order is the prototype's.
  const ITEMS=[["command","shell.nav.event","event"],["floor","shell.nav.salon","salon"],["guests","shell.nav.guests","guests"],
    ["seating","shell.nav.seating","seating"],["live","shell.nav.door","door"],["reports","shell.nav.reports","reports"]];
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
  function initTheme(){document.documentElement.dataset.theme=readTheme();}

  // ---- markup -----------------------------------------------------------------
  function navHTML(ctx){
    const ws=ctx.screen==="workspace";
    const items=ITEMS.map(([id,key,ic])=>{
      const label=`${IC[ic]}<span class="shell-nav-label">${esc(t(key))}</span>`;
      if(ws){
        if(ctx.historical&&!HISTORY_TABS.has(id)){
          // A finished event has no overview, Salon or Kapı. The overview's
          // place takes you back to the calendar; the editing surfaces are
          // absent, not disabled (historical-immutability).
          return id==="command"?`<button type="button" class="shell-nav-item" data-shell-home title="${esc(t("shell.nav.toCalendar"))}">${label}</button>`:"";
        }
        const on=ctx.current===id;
        return`<button type="button" class="tab shell-nav-item${on?" active":""}" data-tab="${id}"${on?' aria-current="page"':""}>${label}</button>`;
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
  function commandHTML(ctx){
    const ph=esc(t("shell.command.placeholder")),open=esc(t("shell.command.open"));
    if(ctx.screen==="workspace")
      return`<div class="shell-cmd"><div class="shell-cmd-box">${IC.search}<input id="globalGuestSearch" placeholder="${ph}" aria-label="${ph}" autocomplete="off" spellcheck="false"><button type="button" class="shell-cmd-key" data-shell-assistant title="${open}" aria-label="${open}">F8</button></div><div id="globalSearchResults" class="search-results hidden"></div></div>`;
    return`<div class="shell-cmd"><button type="button" class="shell-cmd-box shell-cmd-button" data-shell-assistant title="${open}">${IC.search}<span>${ph}</span><kbd class="shell-cmd-key">F8</kbd></button></div>`;
  }
  // ⋯: the same data-action / data-v8-action the shell's binder already wires.
  function menuHTML(ctx){
    const item=(attr,label,title)=>`<button type="button" class="shell-menu-item" ${attr}${title?` title="${esc(title)}"`:""}>${esc(label)}</button>`;
    const rows=ctx.screen==="workspace"?[
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
    ];
    return`<details class="shell-more"><summary class="shell-icon-btn" title="${esc(t("shell.more"))}" aria-label="${esc(t("shell.more"))}">${IC.more}</summary><div class="shell-menu">${rows.join("")}</div></details>`;
  }
  function barHTML(ctx){
    const ws=ctx.screen==="workspace";
    const version=globalThis.MERIT_APP_VERSION?`<small class="brand-version">${esc(globalThis.MERIT_APP_VERSION)}</small>`:"";
    const brandInner=`<b>MERIT</b><span>Event Maker</span>${version}`;
    // The mark is the way back to the calendar from inside an event.
    const brand=ws?`<button type="button" class="shell-brand" data-action="back-events" title="${esc(t("shell.brandTitle"))}">${brandInner}</button>`:`<div class="shell-brand">${brandInner}</div>`;
    const theme=current(),themeLabel=esc(t(theme==="dark"?"shell.theme.toLight":"shell.theme.toDark"));
    const eventId=ws&&ctx.event?`<div class="event-id" title="${esc(ctx.event.sub||"")}"><strong>${esc(ctx.event.name)}</strong></div>`:"";
    return`<header class="shell-top theme-scope${ws?" workspace-head":""}">${brand}${navHTML(ctx)}${commandHTML(ctx)}<div class="shell-right workspace-actions">${ctx.planHealth||""}${eventId}<span class="shell-clock" data-shell-clock title="${esc(t("shell.clockTitle"))}">${clockText()}</span><button type="button" class="shell-icon-btn shell-theme" data-shell-theme title="${themeLabel}" aria-label="${themeLabel}"><span class="shell-theme-moon">${IC.moon}</span><span class="shell-theme-sun">${IC.sun}</span></button>${menuHTML(ctx)}</div></header>`;
  }

  function create(deps){
    if(created)throw new Error("MeritScreenTopbar.create() is called once, by app-v8.js.");
    created=true;
    esc=deps.esc;
    t=deps.t;
    initTheme();
    startClock();
    return{barHTML,icons:IC,theme:Object.freeze({current,set:setTheme,toggle:toggleTheme})};
  }
  globalThis.MeritScreenTopbar=Object.freeze({create,DEPS:Object.freeze(["esc","t"])});
})();
