// MERIT Event Maker — the Ayarlar (Settings) page (MeritScreenSettings).
//
// Owner 2026-11-11/12 (benchmarks/ux/redesign/SPEC-v4.md): no appearance
// buttons in the bar; one calm page holds Tema (A–E, each with a live preview),
// Açık/Koyu/Sistem, the typeface and text size, the language, Mimar's (F8)
// switches and what is kept where, with the backup actions. Every choice is
// applied at once and remembered by the writer that already owned it — the
// top bar's appearance writers, the shell's language, Mimar's web research,
// the plan's second look, the backup functions. This module owns NO fact; it
// is a page of controls.
//
// Like the Mimar panel it builds its own <section> OUTSIDE #app, so a render()
// never wipes it and the bar above stays live: a click on any screen in the
// bar, or Esc, closes it. Every choice is a radiogroup ("one rounded track"):
// arrow keys move and apply, Tab leaves the group.
//
// Everything it reads from the shell is handed to it by create(deps), once.
(() => {
  "use strict";
  let counts;
  let diskBackup;
  let esc;
  let exportBackup;
  let getLang;
  let importBackup;
  let openMimar;
  let render;
  let research;
  let restoreSnapshot;
  let saveNow;
  let secondLook;
  let setLang;
  let storageStatus;
  let t;
  let topbar;
  let root=null;
  let created=false;

  const isOpen=()=>!!(root&&!root.hidden);

  // ---- markup ---------------------------------------------------------------------
  function track(key,label,options,currentValue){
    
    const items=options.map(([value,text])=>{
      const on=value===currentValue;
      return`<button type="button" role="radio" class="set-opt" data-set="${esc(key)}" data-value="${esc(value)}" aria-checked="${on}" tabindex="${on?0:-1}">${esc(text)}</button>`;
    }).join("");
    return`<div class="track" role="radiogroup" aria-label="${esc(label)}">${items}</div>`;
  }
  function row(label,note,control){
    
    return`<div class="set-row"><div class="set-label"><b>${esc(label)}</b>${note?`<small>${esc(note)}</small>`:""}</div><div class="set-control">${control}</div></div>`;
  }
  // A live preview of a theme: a tiny bar, a list and a room drawn with that
  // theme's own tokens (the token layer answers [data-preview-skin] too), so
  // it follows Açık/Koyu like the real screens do.
  function thumbHTML(id){
    const tables=Array.from({length:8},(_,i)=>`<i class="th-t${i===5?" th-me":""}"></i>`).join("");
    return`<span class="set-thumb" data-preview-skin="${id}" aria-hidden="true"><span class="th-bar"><b>MERIT</b><i></i><i></i><i></i></span><span class="th-body"><span class="th-side"><i></i><i></i><i></i><em></em></span><span class="th-room">${tables}</span></span></span>`;
  }
  function themesHTML(){
    const cur=topbar.skin.current();
    const tiles=topbar.skin.ids.map(id=>{
      const on=id===cur,name=t(`shell.skin.${id}`);
      return`<button type="button" role="radio" class="set-theme" data-set="skin" data-value="${id}" aria-checked="${on}" tabindex="${on?0:-1}" aria-label="${esc(name)}">${thumbHTML(id)}<span class="set-theme-name"><b>${esc(id.toUpperCase())} · ${esc(name)}</b><small>${esc(t(`settings.skin.${id}.note`))}</small></span></button>`;
    }).join("");
    return`<div class="set-themes" role="radiogroup" aria-label="${esc(t("settings.theme"))}">${tiles}</div>`;
  }
  function storageHTML(){
    const status=storageStatus()||{},records=counts();
    const idb=/indexeddb|resilient/i.test(String(status.provider||""))&&!status.fallbackReason;
    const where=`<p class="set-fact">${esc(t(idb?"settings.where.indexeddb":"settings.where.local"))}</p><p class="set-fact">${esc(t("settings.records",{events:records.events,guests:records.guests}))} · <span data-set-used></span></p>`;
    const link=(attr,label)=>`<button type="button" class="set-link" ${attr}>${esc(label)}</button>`;
    const actions=[link('data-set-do="save"',t("settings.saveNow")),link('data-set-do="export"',t("backup.export")),link('data-set-do="import"',t("backup.import")),link('data-set-do="restore"',t("recovery.buttonTitle")),
      ...(diskBackup()?[link('data-action="disk-backup-restore"',t("diskBackup.buttonTitle"))]:[])].join('<span class="set-dot" aria-hidden="true">·</span>');
    return row(t("settings.where"),"",where)+row(t("backup.export"),t("settings.backupNote"),`<div class="set-links">${actions}</div>`);
  }
  function pageHTML(){
    const onOff=[["on",t("settings.on")],["off",t("settings.off")]];
    const look=`<section class="set-group" aria-labelledby="setLook"><h2 id="setLook">${esc(t("settings.group.look"))}</h2>
      ${row(t("settings.theme"),t("settings.themeNote"),"")}${themesHTML()}
      ${row(t("settings.mode"),t("settings.modeNote"),track("mode",t("settings.mode"),[["light",t("settings.mode.light")],["dark",t("settings.mode.dark")],["system",t("settings.mode.system")]],topbar.theme.mode()))}
      ${row(t("settings.font"),t("settings.fontNote"),track("font",t("settings.font"),topbar.font.ids.map(id=>[id,t(`settings.font.${id}`)]),topbar.font.current()))}
      ${row(t("settings.size"),t("settings.sizeNote"),track("size",t("settings.size"),topbar.size.ids.map(id=>[id,t(`settings.size.${id}`)]),topbar.size.current()))}</section>`;
    const lang=`<section class="set-group" aria-labelledby="setLang"><h2 id="setLang">${esc(t("settings.group.language"))}</h2>
      ${row(t("settings.language"),t("settings.languageNote"),track("lang",t("settings.language"),[["tr",t("settings.lang.tr")],["en",t("settings.lang.en")]],getLang()))}</section>`;
    const second=secondLook();
    const mimar=`<section class="set-group" aria-labelledby="setMimar"><h2 id="setMimar">${esc(t("settings.group.mimar"))}</h2>
      ${row(t("settings.research"),t("shell.research.privacy"),track("research",t("settings.research"),onOff,research.enabled()?"on":"off"))}
      ${second?row(t("settings.secondLook"),t("settings.secondLookNote"),track("secondLook",t("settings.secondLook"),onOff,second.enabled()?"on":"off")):""}
      ${row(t("shell.mimar"),t("settings.mimarNote"),`<button type="button" class="set-link" data-set-do="mimar">${esc(t("settings.openMimar"))}</button>`)}</section>`;
    const store=`<section class="set-group" aria-labelledby="setStore"><h2 id="setStore">${esc(t("settings.group.storage"))}</h2>${storageHTML()}</section>`;
    return`<div class="set-page"><header class="set-head"><div><h1 tabindex="-1">${esc(t("settings.title"))}</h1><p>${esc(t("settings.lead"))}</p></div><button type="button" class="set-link" data-set-do="close">${esc(t("settings.close"))}</button></header>${look}${lang}${mimar}${store}</div>`;
  }

  // ---- behaviour ------------------------------------------------------------------
  function bytes(n){
    const lang=getLang()==="en"?"en-GB":"tr-TR";
    if(!(n>=0))return"";
    const mb=n/1048576;
    return mb>=1?`${mb.toLocaleString(lang,{maximumFractionDigits:1})} MB`:`${Math.max(1,Math.round(n/1024)).toLocaleString(lang)} KB`;
  }
  function fillUsage(){
    const span=root&&root.querySelector("[data-set-used]");
    if(!span)return;
    // EXPECTED ABSTENTION: a browser without the estimate API simply shows no figure.
    try{globalThis.navigator.storage.estimate().then(e=>{if(span.isConnected&&e&&e.usage>=0)span.textContent=t("settings.used",{used:bytes(e.usage)});}).catch(()=>{});}catch(error){console.warn("The storage estimate is not available in this browser.",error&&error.name);}
  }
  function paint(focusKey){
    root.innerHTML=pageHTML();
    fillUsage();
    if(focusKey){const el=root.querySelector(`[data-set="${focusKey}"][aria-checked="true"]`);if(el)el.focus();}
  }
  function apply(key,value){
    
    if(key==="skin")topbar.skin.set(value);
    else if(key==="mode")topbar.theme.set(value);
    else if(key==="font")topbar.font.set(value);
    else if(key==="size")topbar.size.set(value);
    else if(key==="lang")setLang(value);
    else if(key==="research"){research.set(value==="on");render();}
    else if(key==="secondLook"){const s=secondLook();if(s)s.set(value==="on");}
    // A theme may change what a screen shows (A: the timeline, B: the calendar).
    if(key==="skin")render();
    paint(key);
  }
  function act(what){
    if(what==="close")return close();
    if(what==="mimar"){close();openMimar();return;}
    if(what==="save")saveNow();
    else if(what==="export")exportBackup();
    else if(what==="import")importBackup();
    else if(what==="restore")restoreSnapshot();
  }
  function onClick(e){
    const opt=e.target.closest("[data-set]");
    if(opt){apply(opt.dataset.set,opt.dataset.value);return;}
    const doer=e.target.closest("[data-set-do]");
    if(doer)act(doer.dataset.setDo);
  }
  // Arrow keys inside a radiogroup move AND apply, the native radio way.
  function onKey(e){
    const opt=e.target.closest&&e.target.closest("[data-set]");
    if(!opt)return;
    const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key];
    if(e.key==="Home"||e.key==="End"||step){
      const all=[...opt.closest("[role=radiogroup]").querySelectorAll("[data-set]")],i=all.indexOf(opt);
      const next=e.key==="Home"?all[0]:e.key==="End"?all[all.length-1]:all[(i+step+all.length)%all.length];
      e.preventDefault();
      apply(next.dataset.set,next.dataset.value);
    }else if(e.key===" "||e.key==="Enter"){e.preventDefault();apply(opt.dataset.set,opt.dataset.value);}
  }
  function mark(open){document.querySelectorAll("[data-shell-settings]").forEach(b=>{b.setAttribute("aria-expanded",String(open));b.classList.toggle("on",open);});}
  function open(){
    if(!root){
      root=document.createElement("section");
      root.className="settings-page";
      root.id="settingsPage";
      root.setAttribute("aria-label",t("settings.title"));
      root.hidden=true;
      root.addEventListener("click",onClick);
      root.addEventListener("keydown",onKey);
      document.body.appendChild(root);
    }
    root.hidden=false;
    paint();
    mark(true);
    root.querySelector("h1")?.focus();
  }
  function close(){
    if(!isOpen())return;
    root.hidden=true;
    mark(false);
    document.querySelector("[data-shell-settings]")?.focus();
  }
  function toggle(){if(isOpen())close();else open();}
  // The bar re-renders with every render(): keep its "Ayarlar" word marked.
  function afterRender(){if(isOpen()){mark(true);root.setAttribute("aria-label",t("settings.title"));}}

  function create(deps){
    if(created)throw new Error("MeritScreenSettings.create() is called once, by app-v8.js.");
    created=true;
    counts=deps.counts;
    diskBackup=deps.diskBackup;
    esc=deps.esc;
    exportBackup=deps.exportBackup;
    getLang=deps.getLang;
    importBackup=deps.importBackup;
    openMimar=deps.openMimar;
    render=deps.render;
    research=deps.research;
    restoreSnapshot=deps.restoreSnapshot;
    saveNow=deps.saveNow;
    secondLook=deps.secondLook;
    setLang=deps.setLang;
    storageStatus=deps.storageStatus;
    t=deps.t;
    topbar=deps.topbar;
    // Esc closes the page first (before anything below it hears the key);
    // a click on a screen in the bar leaves it for that screen.
    document.addEventListener("keydown",e=>{
      if(e.key!=="Escape"||!isOpen()||document.querySelector("dialog[open]"))return;
      e.preventDefault();e.stopImmediatePropagation();close();
    },true);
    document.addEventListener("click",e=>{
      if(!isOpen()||!e.target.closest)return;
      if(e.target.closest("header.shell-top [data-tab],header.shell-top [data-shell-home],header.shell-top [data-shell-open],header.shell-top .shell-brand,[data-shell-next]"))close();
    },true);
    return{open,close,toggle,isOpen,afterRender};
  }
  globalThis.MeritScreenSettings=Object.freeze({create,DEPS:Object.freeze(["counts","diskBackup","esc","exportBackup","getLang","importBackup","openMimar","render","research","restoreSnapshot","saveNow","secondLook","setLang","storageStatus","t","topbar"])});
})();
