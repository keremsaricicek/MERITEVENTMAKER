// The first-run onboarding callouts (Section 12): short, dismissible,
// feature-anchored, one at a time per render (§20). dismissOnboarding() is the
// one writer of `state.onboarding`, which lives on `state` (never on an event,
// never exported, never reset by switching events). Moved out of app-v8.js on
// 2026-11-09 (code health, capability 11 of 21,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs; the section comment travelled with it. The
// edits forced by the move: `state` is read through getState(); render() resets
// "one callout per render" through beginRender() instead of writing this
// file's variable.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let getState;
  let render;
  let saveState;
  let t;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritOnboardingPanel.create() is called once, by app-v8.js.");
    created=true;
    getState=deps.getState;
    render=deps.render;
    saveState=deps.saveState;
    t=deps.t;
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
  function onboardingSeen(key){return !!(getState().onboarding&&getState().onboarding.seen&&getState().onboarding.seen[key]);}
  function dismissOnboarding(key){
    getState().onboarding=getState().onboarding||{seen:{}};
    getState().onboarding.seen=getState().onboarding.seen||{};
    getState().onboarding.seen[key]=true;
    saveState();render();
  }
  // Reachable again anytime from Help -- staff turnover means a new hire
  // starts on day 40 of the product's life, not day 1, so this is never a
  // one-shot the operator can permanently lose. Called from this file's own
  // renderGuide() override below (app-guests.js's version of renderGuide is
  // shadowed the same way contextualCardHTML and friends are).
  function resetOnboarding(){
    getState().onboarding={seen:{}};
    saveState();render();
  }
  // ONE AT A TIME (§20). A first-day operator on Seating saw three tips at
  // once -- the Global Finder banner, Freeze Zones and Smart Seating -- which
  // is the warning flood the quality gates forbid. The first callout a render
  // asks for is shown; the others wait until it is dismissed. render() clears
  // the slot, and a partial re-render of the SAME callout is still allowed.
  let calloutThisRender=null;
  // A new render may show one callout again; render() calls this first.
  function beginRender(){calloutThisRender=null;}
  function onboardingCalloutHTML(key){
    if(onboardingSeen(key))return"";
    if(calloutThisRender&&calloutThisRender!==key)return"";
    calloutThisRender=key;
    return`<div class="onboarding-callout" data-onboarding="${key}"><span>${t("onboarding."+key)}</span><button class="btn sm quiet" data-onboarding-dismiss="${key}">${t("onboarding.gotIt")}</button></div>`;
  }
    return{beginRender,dismissOnboarding,onboardingCalloutHTML,resetOnboarding};
  }
  globalThis.MeritOnboardingPanel=Object.freeze({create,DEPS:Object.freeze(["getState","render","saveState","t"])});
})();
