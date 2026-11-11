// Is this event ready, and what deserves attention now: the plan's issues and
// health line, the Plan Doctor's report — the ONE place the whole event is
// judged, derived on every call and never stored — the readiness reasons, the
// backup risk, and the final check (doctorSignature, recordFinalCheck — the ONE
// writer of event.finalCheck, refusing a historical event). Moved out of
// app-v8.js on 2026-11-09 (code health, capability 10 of 21,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs; the Command Center and Plan Doctor section
// comments travelled with the code. Before the move the shell's function
// declarations were gathered into one span (declarations only, hoisted, so the
// order changes nothing). The rules are src/plan-doctor.js; the edit forced by
// the move: `state` is read through getState().
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let RULES;
  let canMutate;
  let esc;
  let eventMetrics;
  let getState;
  let nowISO;
  let paxOf;
  let resolvedFreezes;
  let resolvedUnavailable;
  let seatingCapacity;
  let t;
  let touchEvent;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritEventHealth.create() is called once, by app-v8.js.");
    created=true;
    RULES=deps.RULES;
    canMutate=deps.canMutate;
    esc=deps.esc;
    eventMetrics=deps.eventMetrics;
    getState=deps.getState;
    nowISO=deps.nowISO;
    paxOf=deps.paxOf;
    resolvedFreezes=deps.resolvedFreezes;
    resolvedUnavailable=deps.resolvedUnavailable;
    seatingCapacity=deps.seatingCapacity;
    t=deps.t;
    touchEvent=deps.touchEvent;
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
    if(RULES().isHistorical(event)){
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
  // PHASE (ready / live / closed, MeritEventRules.phase) changes what is
  // emphasised, never what is available.
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
  // THE ONE RISK THAT CANNOT BE RECOVERED FROM ON THE NIGHT.
  //
  // Everything this product knows lives in one browser profile. `lastBackupAt`
  // is recorded when an export actually succeeds — never when one is merely
  // offered — so "backed up" on the radar means a file really left the browser.
  function backupState(event){
    const at=getState().lastBackupAt||null;
    if(!event)return{at,staleBy:false};
    const changed=event.lastModified||event.createdAt||null;
    return{at,staleBy:!!(at&&changed&&changed>at)};
  }

  function planDoctorReport(event){
    if(!event||!globalThis.MeritPlanDoctor)return null;
    return globalThis.MeritPlanDoctor.run({
      phase:RULES().phase(event),
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
  // The four states are the Plan Doctor's own answer (MeritPlanDoctor.radar);
  // this only gathers what the Command Center shows beside it.
  function eventReadiness(event){
    const doctor=planDoctorReport(event);
    const m=eventMetrics(event);
    const budget=event.analysis?.confidenceBudget||null;
    const inconsistent=(event.analysis?.selfCheck?.checks||[]).filter(c=>c.verdict==="INCONSISTENT");
    const {verdict,reasons}=globalThis.MeritPlanDoctor?globalThis.MeritPlanDoctor.radar(doctor):{verdict:"ready",reasons:[]};
    return{phase:RULES().phase(event),verdict,reasons,metrics:m,budget,inconsistent,doctor};
  }
  // What was checked, reduced to something two runs can be compared on. Codes
  // and counts, not wording: a translation change must not read as the event
  // having changed underneath the operator.
  function doctorSignature(d){
    return d.all.map(f=>f.code+"="+(f.weight??0)).sort().join("|");
  }
  // The one writer of event.finalCheck: a person ran the pre-flight. It stays
  // in the shell with the other writers; the Command Center calls it.
  //
  // Recording that a person ran the pre-flight is a mutation of the event, so
  // it goes through canMutate like everything else -- a historical event has no
  // Command Center to run it from, and must not acquire one here.
  function recordFinalCheck(event,d){
    if(!d||!canMutate(event,"run the final check"))return;
    event.finalCheck={at:nowISO(),verdict:d.verdict,signature:doctorSignature(d),
      counts:{...d.counts}};
    touchEvent(event);
  }
    return{doctorSignature,eventReadiness,planDoctorReport,planHealthHTML,planIssues,recordFinalCheck};
  }
  globalThis.MeritEventHealth=Object.freeze({create,DEPS:Object.freeze(["RULES","canMutate","esc","eventMetrics","getState","nowISO","paxOf","resolvedFreezes","resolvedUnavailable","seatingCapacity","t","touchEvent"])});
})();
