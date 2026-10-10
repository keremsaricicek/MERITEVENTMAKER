// HOW BIG IS THE THING THIS PLAN REPEATS, AND DOES THIS ONE AGREE WITH IT?
//
// Split A-6 and A-7 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`, moved out
// of `src/plan-detection-classical.js` verbatim. The modal-size prior is the
// rule that replaced "biggest area first", and it is the most-used internal
// idea in the detector: `sizeAgreement` is called from a dozen places and
// `modalMagnitude` from eleven.
//
// THE CROSSING ANALYSIS, measured with `scripts/crossing-analysis.mjs` before
// anything moved:
//
//   OUTWARD   ZERO. The region is closed over its own arguments.
//   INWARD    three names — `modalMagnitude` (11 references outside),
//             `sizeAgreement` (8) and `symbolFamilyMember` (1).
//   PRIVATE   the two symbol-family thresholds, which move with the predicate
//             whose measurement chose them.
//
// `app-v8.js` appeared to name `sizeAgreement` and does not: it reads
// `c.evidence?.sizeAgreement`, a PROPERTY on a candidate's evidence object,
// which is a different thing that happens to share a word. A crossing report
// is a place to start looking, not a verdict.
//
// LOW RISK TO MOVE, HIGH RISK TO CHANGE. `benchmarks/CODE-INVENTORY.md` §2.2
// records why `sizeAgreement` must never be merged with `boxIoU`: this one is
// a log-ratio agreement between a magnitude and a modal, and the other is
// intersection over union between two boxes. They answer different questions
// and the detector needs both.
//
// `MeritSymbolFamilyMember` was already public before this move —
// `tests/suites/symbol-family.test.mjs` calls it through the global — so it
// travels with its export intact and the name it is reached by does not
// change.
(function () {
  "use strict";

  function modalMagnitude(values){
    const vals=values.filter(v=>Number.isFinite(v)&&v>0);
    if(!vals.length)return null;
    const BIN=Math.log(1.15),counts=new Map();
    for(const v of vals){const k=Math.round(Math.log(v)/BIN);counts.set(k,(counts.get(k)||0)+1);}
    let bestK=null,bestN=-1;
    for(const k of [...counts.keys()].sort((a,b)=>a-b)){
      const support=(counts.get(k)||0)+(counts.get(k-1)||0)+(counts.get(k+1)||0);
      if(support>bestN){bestN=support;bestK=k;}
    }
    const pool=vals.filter(v=>Math.abs(Math.round(Math.log(v)/BIN)-bestK)<=1);
    return{value:pool.reduce((a,b)=>a+b,0)/pool.length,support:pool.length,total:vals.length};
  }
  function sizeAgreement(value,modal){
    if(!modal||!modal.value||!(value>0))return .5;
    return Math.max(0,1-Math.abs(Math.log(value/modal.value)/Math.log(1.7)));
  }
  // Does this box belong to the repeated symbol family the plan has declared?
  //
  // A plan whose tables are one repeated symbol may draw that symbol in more
  // than one tone — ORNEK draws 157 open circles and 9 filled ones, the same
  // object in different ink — and the two halves reach the pipeline through
  // different sources. The question asked here is therefore about the FAMILY,
  // never about tone: does this box agree with the vocabulary the plan stated
  // through the members already found?
  //
  // Both thresholds are the ones the fragment filter already uses for these two
  // agreement functions. Measured on ORNEK's 40 de-duplicated table-pool
  // components against a modal taken from the open circles alone: the 9 filled
  // discs score 0.89-0.94 on size and 0.96-0.97 on aspect; of the other 31,
  // every one that agrees on size is a wall, door or bay at aspect 1.96-3.54,
  // and every one that agrees on aspect is half the family's size or twice it.
  // 9 of 9 and 0 of 31, with the nearest miss on either axis about four times
  // the threshold away.
  const SYMBOL_FAMILY_MIN_SIZE_AGREEMENT=.6,SYMBOL_FAMILY_MIN_ASPECT_AGREEMENT=.55;
  function symbolFamilyMember(box,modal){
    if(!modal||!modal.side||!modal.aspect)return false;
    const w=box.w,h=box.h;
    if(!(w>0)||!(h>0))return false;
    if(sizeAgreement(Math.sqrt(w*h),modal.side)<SYMBOL_FAMILY_MIN_SIZE_AGREEMENT)return false;
    const aspect=Math.max(w,h)/Math.min(w,h);
    return Math.max(0,1-Math.abs(aspect-modal.aspect)/modal.aspect)>=SYMBOL_FAMILY_MIN_ASPECT_AGREEMENT;
  }
  // The name the benchmarks and `symbol-family` already reach it by. Kept
  // exactly as it was: a move must not rename a published surface.
  globalThis.MeritSymbolFamilyMember=symbolFamilyMember;
  globalThis.MeritPlanSizePrior = {
    version: 1, modalMagnitude, sizeAgreement, symbolFamilyMember,
  };
})();
