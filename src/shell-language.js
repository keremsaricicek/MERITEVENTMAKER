// The shell's language plumbing for what render() never redraws: the static
// guest/Excel dialogs are pushed into the current language
// (translateStaticDialogs, vipLabel), every toast passes through
// translateToast, the embedded spreadsheet engine is the only one
// (loadXLSX never fetches), the guest dialog's Cancel closes it, and the Excel
// wizard refuses a historical event (canMutate). toast and loadXLSX stay
// app-v8.js overrides of the pre-v8 globals as one-line delegates. Moved out
// of app-v8.js on 2026-11-11 (code health, capability 20 of 21,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs. The edits forced by the move: the captures of
// the pre-v8 toast and translateToast read globalThis (what they read);
// openExcelWizard — a pre-v8 global this wraps in place — is read and replaced
// through getOpenExcelWizard()/setOpenExcelWizard().
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let activeEvent;
  let canMutate;
  let getOpenExcelWizard;
  let setOpenExcelWizard;
  let t;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritShellLanguage.create() is called once, by app-v8.js.");
    created=true;
    activeEvent=deps.activeEvent;
    canMutate=deps.canMutate;
    getOpenExcelWizard=deps.getOpenExcelWizard;
    setOpenExcelWizard=deps.setOpenExcelWizard;
    t=deps.t;
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
  function loadXLSX(){return globalThis.XLSX?Promise.resolve():Promise.reject(new Error("Embedded spreadsheet engine did not initialize."));}

  // Translate at the toast boundary rather than at ~40 call sites. Strings
  // already localized by t() simply pass through unmatched.
  const baseToast=globalThis.toast;
  function toast(message,...rest){return baseToast(typeof globalThis.translateToast==="function"?globalThis.translateToast(message):message,...rest);}

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
  const baseOpenExcelWizard=typeof getOpenExcelWizard()==="function"?getOpenExcelWizard():null;
  if(baseOpenExcelWizard)setOpenExcelWizard(function(...a){
    if(!canMutate(activeEvent(),"import a guest list"))return;
    return baseOpenExcelWizard(...a);
  });
    return{loadXLSX,toast,translateStaticDialogs,vipLabel};
  }
  globalThis.MeritShellLanguage=Object.freeze({create,DEPS:Object.freeze(["activeEvent","canMutate","getOpenExcelWizard","setOpenExcelWizard","t"])});
})();
