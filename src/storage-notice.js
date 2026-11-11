// What the operator must be told about storage, kept on screen until it stops
// being true: saving is failing, images were dropped, the stored record could
// not be read (and was kept aside), a newer build wrote this data (read-only)
// — with the actions that need no broken screen (export, backup, restore).
// Moved out of app-v8.js on 2026-11-11 (code health, capability 19 of 21, part
// b, benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs; its click listener is added inside
// create(), where it was added before. The facts are src/shell-storage.js's
// (MERIT_STORAGE_NOTICE, MERIT_SCHEMA_GUARD), read through globalThis; `state`
// through getState().
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let PORTABILITY;
  let RULES;
  let esc;
  let exportTablePlanXLSX;
  let fmtDate;
  let getState;
  let icon;
  let relativeTime;
  let render;
  let t;
  let whileBusy;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritStorageNotice.create() is called once, by app-v8.js.");
    created=true;
    PORTABILITY=deps.PORTABILITY;
    RULES=deps.RULES;
    esc=deps.esc;
    exportTablePlanXLSX=deps.exportTablePlanXLSX;
    fmtDate=deps.fmtDate;
    getState=deps.getState;
    icon=deps.icon;
    relativeTime=deps.relativeTime;
    render=deps.render;
    t=deps.t;
    whileBusy=deps.whileBusy;
  // What the operator sees when the stored record was written by a newer
  // build: the reason, both version numbers, and what to do -- not an empty
  // app with no explanation. Rendered ABOVE everything else and never
  // dismissed, because every control below it is operating on a blank slate
  // that will not be saved.
  // The storage notices, persistent until true no longer. Each names what
  // happened, what was NOT lost, and the next step -- with the control for it.
  function storageNoticeHTML(){
    const n=globalThis.MERIT_STORAGE_NOTICE;
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
    const a=b.dataset.storageAction,n=globalThis.MERIT_STORAGE_NOTICE;
    if(a==="download-unreadable"&&n.unreadable){
      const url=URL.createObjectURL(new Blob([String(n.unreadable.raw)],{type:"application/json"}));
      const link=document.createElement("a");link.href=url;link.download=`merit-event-maker-unreadable-${RULES().todayKey()}.json`;
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
    }else if(a==="download-set-aside"){
      const url=URL.createObjectURL(new Blob([JSON.stringify(getState().setAside||[],null,2)],{type:"application/json"}));
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
    return{futureSchemaBannerHTML,storageNoticeHTML};
  }
  globalThis.MeritStorageNotice=Object.freeze({create,DEPS:Object.freeze(["PORTABILITY","RULES","esc","exportTablePlanXLSX","fmtDate","getState","icon","relativeTime","render","t","whileBusy"])});
})();
