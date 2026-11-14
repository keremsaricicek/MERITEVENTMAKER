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
  const RESEARCH_KEY="merit.webResearch.v1";
  const SKINS=[["a","shell.skin.a"],["b","shell.skin.b"],["c","shell.skin.c"],["d","shell.skin.d"],["e","shell.skin.e"]];
  const sv=(body,size=16)=>`<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  // The bar's few icons (the screens themselves are words), on a 16 px grid.
  const IC={
    search:sv('<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2 13.8 13.8"/>'),
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

  // ---- appearance: light/dark/system, theme A–E, font, text size ----------------
  // Each is a fact about this machine, not about an event, read and written
  // inside try/catch. EXPECTED ABSTENTION: a storage that refuses (private
  // mode, quota) only loses the memory of the choice; the screen still
  // switches. data-theme on <html> is always the RESOLVED mode (light|dark), so
  // every rule keys on one attribute; "system" follows the computer's own
  // setting and changes with it.
  const MODES=["light","dark","system"];
  const SKIN_IDS=SKINS.map(([id])=>id);
  const FONTS=["system","segoe","helvetica"],SIZES=["s","m","l"];
  const FONT_KEY="merit.font.v1",SIZE_KEY="merit.fontSize.v1";
  function store(key,v,what){try{globalThis.localStorage.setItem(key,v);}catch(error){console.warn(`The ${what} choice could not be remembered on this machine.`,error&&error.name);}}
  function readKey(key,allowed,fallback){try{const v=globalThis.localStorage.getItem(key);return allowed.includes(v)?v:fallback;}catch{return fallback;}}
  let modePref="light";
  const systemDark=()=>{try{return !!(globalThis.matchMedia&&globalThis.matchMedia("(prefers-color-scheme: dark)").matches);}catch{return false;}};
  function resolve(){const v=modePref==="system"?(systemDark()?"dark":"light"):modePref;document.documentElement.dataset.theme=v;return v;}
  function current(){return document.documentElement.dataset.theme==="dark"?"dark":"light";}
  function mode(){return modePref;}
  function setTheme(name){
    modePref=MODES.includes(name)?name:"light";
    store(THEME_KEY,modePref,"theme");
    return resolve();
  }
  function toggleTheme(){return setTheme(current()==="dark"?"light":"dark");}
  function readSkin(){return readKey(SKIN_KEY,SKIN_IDS,"a");}
  function currentSkin(){const v=document.documentElement.dataset.skin;return SKIN_IDS.includes(v)?v:"a";}
  function setSkin(name){
    const v=SKIN_IDS.includes(name)?name:"a";
    document.documentElement.dataset.skin=v;
    store(SKIN_KEY,v,"theme");
    if(v==="c"&&readKey(THEME_KEY,MODES,null)===null){modePref="dark";resolve();}
    document.querySelectorAll("[data-shell-skin]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.shellSkin===v)));
    return v;
  }
  function currentFont(){const v=document.documentElement.dataset.font;return FONTS.includes(v)?v:"system";}
  function setFont(name){const v=FONTS.includes(name)?name:"system";document.documentElement.dataset.font=v;store(FONT_KEY,v,"font");return v;}
  function currentSize(){const v=document.documentElement.dataset.size;return SIZES.includes(v)?v:"m";}
  function setSize(name){const v=SIZES.includes(name)?name:"m";document.documentElement.dataset.size=v;store(SIZE_KEY,v,"text size");return v;}
  function initTheme(){
    // Theme C (Royal gece) opens dark, as its prototype does — only until the
    // person chooses light/dark themselves.
    modePref=readKey(THEME_KEY,MODES,readSkin()==="c"?"dark":"light");resolve();
    const root=document.documentElement;
    root.dataset.skin=readSkin();root.dataset.font=readKey(FONT_KEY,FONTS,"system");root.dataset.size=readKey(SIZE_KEY,SIZES,"m");
    // "Sistem" follows the computer when it switches (an evening auto-dark).
    try{const mq=globalThis.matchMedia&&globalThis.matchMedia("(prefers-color-scheme: dark)");if(mq&&mq.addEventListener)mq.addEventListener("change",()=>{if(modePref==="system")resolve();});}catch(error){console.warn("This computer's own light/dark setting cannot be followed here.",error&&error.name);}
  }

  // ---- Ayarlar: web research for Mimar, OFF by default --------------------------
  // A fact about this machine; read and written inside try/catch (a refusing
  // storage keeps it OFF, the safe side).
  function researchOn(){try{return globalThis.localStorage.getItem(RESEARCH_KEY)==="on";}catch{return false;}}
  function setResearch(on){try{globalThis.localStorage.setItem(RESEARCH_KEY,on?"on":"off");}catch(error){console.warn("The web research choice could not be remembered on this machine.",error&&error.name);}return researchOn();}
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
  // ⋯: the same data-action / data-v8-action the shell's binder already wires.
  // Theme, Açık/Koyu and Mimar's web research moved to the Ayarlar page
  // (src/screen-settings.js, owner 2026-11-11: no appearance buttons in the bar).
  function menuHTML(ctx){
    const item=(attr,label,title)=>`<button type="button" class="shell-menu-item" ${attr}${title?` title="${esc(title)}"`:""}>${esc(label)}</button>`;
    const rows=[...(ctx.screen==="workspace"?[
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
    const settingsTitle=esc(t("settings.open"));
    // Event name at the right of the nav, before the clock, as in the approved
    // Atlas (owner 2026-11-13, zip temalar/tema-a); the venue line is its title.
    const eventId=ws&&ctx.event?`<div class="event-id shell-event" title="${esc(ctx.event.sub||"")}"><strong>${esc(ctx.event.name)}</strong></div><span class="shell-sep" aria-hidden="true"></span>`:"";
    const open=esc(t("shell.command.open"));
    const mimar=`<button type="button" class="shell-mimar" data-shell-assistant title="${open}" aria-label="${open}">${esc(t("shell.mimar"))} <kbd>F8</kbd></button>`;
    const nx=ws&&!ctx.historical?nextScreen(ctx.current):null;
    const next=nx?`<button type="button" class="shell-next" data-shell-next="${nx}">${esc(t("shell.nextTo",{screen:t(LABEL[nx])}))}</button>`:"";
    return`<header class="shell-top theme-scope${ws?" workspace-head":""}">${brand}${navHTML(ctx)}${commandHTML(ctx)}<div class="shell-right workspace-actions">${ctx.planHealth||""}${eventId}<span class="shell-clock" data-shell-clock title="${esc(t("shell.clockTitle"))}">${clockText()}</span><button type="button" class="shell-link" data-shell-settings title="${settingsTitle}">${esc(t("shell.settings"))}</button>${mimar}${menuHTML(ctx)}</div>${next}</header>`;
  }

  function create(deps){
    if(created)throw new Error("MeritScreenTopbar.create() is called once, by app-v8.js.");
    created=true;
    esc=deps.esc;
    t=deps.t;
    initTheme();
    startClock();
    return{barHTML,icons:IC,stepProgress,theme:Object.freeze({current,mode,set:setTheme,toggle:toggleTheme}),skin:Object.freeze({current:currentSkin,set:setSkin,ids:SKIN_IDS}),
      font:Object.freeze({current:currentFont,set:setFont,ids:FONTS}),size:Object.freeze({current:currentSize,set:setSize,ids:SIZES}),research:Object.freeze({enabled:researchOn,set:setResearch})};
  }
  globalThis.MeritScreenTopbar=Object.freeze({create,DEPS:Object.freeze(["esc","t"])});
})();
