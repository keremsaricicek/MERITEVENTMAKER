// The shell's keyboard and focus: focus returns to the control that opened a
// dialog, the click-only surfaces (tables and objects on the canvas) answer
// Enter/Space, a focused object scrolls into the overflow:hidden viewport, an
// open dialog keeps Tab inside itself, and the app-wide shortcuts (an open
// dialog owns the keyboard). Moved out of app-v8.js on 2026-11-09 (code health,
// capability 21 of 21, benchmarks/CODE-HEALTH-2026-11.md), at the original
// indentation, by scripts/extract-capability.mjs; the section comments
// travelled with the code. The listeners are added inside create(), which the
// shell calls where they used to be added — the same moment of boot, the same
// order relative to every other listener.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let ASSIST;
  let ONBOARDING;
  let PLANEDIT;
  let RULES;
  let TOPBAR;
  let activeEvent;
  let applyCanvasTransform;
  let canMutate;
  let recordUndo;
  let render;
  let t;
  let toast;
  let touchEvent;
  let ui;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritShellFocus.create() is called once, by app-v8.js.");
    created=true;
    ASSIST=deps.ASSIST;
    ONBOARDING=deps.ONBOARDING;
    PLANEDIT=deps.PLANEDIT;
    RULES=deps.RULES;
    TOPBAR=deps.TOPBAR;
    activeEvent=deps.activeEvent;
    applyCanvasTransform=deps.applyCanvasTransform;
    canMutate=deps.canMutate;
    recordUndo=deps.recordUndo;
    render=deps.render;
    t=deps.t;
    toast=deps.toast;
    touchEvent=deps.touchEvent;
    ui=deps.ui;
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
    return{};
  }
  globalThis.MeritShellFocus=Object.freeze({create,DEPS:Object.freeze(["ASSIST","ONBOARDING","PLANEDIT","RULES","TOPBAR","activeEvent","applyCanvasTransform","canMutate","recordUndo","render","t","toast","touchEvent","ui"])});
})();
