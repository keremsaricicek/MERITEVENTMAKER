// THE THREE OBJECT SOURCES: INTERIORS, TONE FAMILIES, AND THE FILL MASK.
//
// Split B, stage B-4 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`, moved
// out of `detect()` in `src/plan-detection-classical.js` verbatim. Three
// independent candidate sources, in order of how specific their evidence is,
// each also offering its chair-scale components to the chair pool.
//
// collectSources(input)                                                B-4
//   IN        { data, gray, total, width, height, barrier, fillMask,
//               accentModel, toneModel, minPixels, minDim, CHAIR_MIN_SIDE_P,
//               notWall, tableSizeOk, chairSizeOk, mark } — the image, its
//             masks and colour model from B-1..B-3, the detector's own size
//             tests, and its phase timer (interiors / toneMasks / fillMask are
//             still timed where they were).
//   OUT       { sources, diagnosticsSources, chairSources, tintIsChairMaterial,
//               fallbackChairComps, fallbackChairLabels, accentMask,
//               surfaceMask, masksTints } — the table-scale sources, the
//             chair-scale ones, which tone families are chair material, the
//             fill-mask fallback, and the class masks the later stages ask
//             "is this made of table?" with.
//   OWNS      nothing that survives the call besides its outputs.
//   FAILS     never: with no colour model the tone pass is skipped, as before.
//   TEST OWNER `benchmarks/detector-fingerprint.mjs` (28 plans,
//             byte-identical), `chair-families`, `table-typing`.
(() => {
  "use strict";
  const COMP = globalThis.MeritPlanComponents;
  const TONE = globalThis.MeritPlanTone;

  function collectSources(input) {
    const { data, gray, total, width, height, barrier, fillMask, accentModel, toneModel,
      minPixels, minDim, CHAIR_MIN_SIDE_P, notWall, tableSizeOk, chairSizeOk, mark } = input;
    // ---- object sources --------------------------------------------------
    const sources=[],diagnosticsSources={};
    // Chair-size components are collected per source at the same time, in
    // order of how specific the evidence is (a dedicated colour cluster
    // beats a tone cluster beats "it was dark enough to threshold").
    const chairSources=[];
    let fallbackChairComps=[],fallbackChairLabels=null,accentMask=null,surfaceMask=null,masksTints=null;
    // Which tint families the plan uses as CHAIR material, aligned with masksTints.
    const tintIsChairMaterial=[];
    // (a) interiors of closed outlines — the primary table source
    {
      const enclosed=COMP.enclosedRegions(barrier,width,height);
      const{labels,comps}=COMP.labelComponents(enclosed,width,height,minPixels,false);
      const kept=comps.filter(c=>tableSizeOk(c)&&c.fill>=.35);
      for(const c of kept)c.source="interior";
      diagnosticsSources.interior=kept.length;
      sources.push({name:"interior",labels,comps:kept,all:comps});
      // The same enclosed interiors, at chair scale, are a chair source.
      // Not every chair is a filled symbol: the round tables on the real
      // venue plan are ringed by OUTLINED pale chairs, which carry no
      // saturated colour and no distinct fill tone, so neither the accent
      // cluster nor any tone family can see them. What they do have is a
      // closed outline, which is exactly what this pass already extracts --
      // it was simply never offered to the chair pool.
      const interiorChairs=comps.filter(c=>chairSizeOk(c)&&c.fill>=.35);
      if(interiorChairs.length)chairSources.push({name:"outline-interior",labels,
        rawCount:comps.length,comps:interiorChairs});
      mark("interiors");
    }
    // (b) tinted/solid fills straight from the colour model — one mask per
    //     tone family, so a mid-grey chair fill and a pale table fill cannot
    //     end up in the same mask and merge
    if(accentModel||toneModel){
      const masks=TONE.buildClassMasks(data,gray,total,accentModel,toneModel);
      accentMask=masks.accent;
      masksTints=masks.tints;
      // The tint family that actually carries furniture surfaces, kept as a
      // per-pixel mask so a table candidate can later be asked the direct
      // question "is this thing made of table?". Chosen by how much of the
      // drawing it covers, which on a seating plan is the table fill.
      //
      // Asking every solid tint family instead, and taking the best answer,
      // was tried here: it is the same "a plan may have two families" fix
      // that worked for chairs, and this plan does draw its bistro tables in
      // a different finish (tan, luma 213) from its banquet tables (pale
      // grey, luma 229). It changed nothing on the real plan — the tan is
      // not a tint family at all, so there was no second family to find —
      // and it cost the dense fixture four table false positives, because
      // there a second solid family exists and "made of SOME furniture tone"
      // is a weaker question than "made of THE table tone".
      //
      // The real-plan bistro finish needs the tone model to see tan as a
      // family in the first place; widening this consumer of it does not
      // help. Left as it was, with the finding recorded.
      surfaceMask=masks.tints.length?masks.tints.reduce((best,m)=>{
        let n=0;for(let i=0;i<total;i+=7)if(m[i])n++;
        return (!best||n>best.n)?{mask:m,n}:best;
      },null)?.mask||null:null;
      let toneKept=0;
      const toneFamilyEvidence=[];
      masks.tints.forEach((mask,index)=>{
        const solidity=COMP.maskSolidity(mask,width,height);
        const family=toneModel?.families?.[index]||null;
        const{labels,comps}=COMP.labelComponents(mask,width,height,minPixels,true);

        // Is this tone family furniture, or is it linework?
        //
        // Not decided by how dark it is. Linework is thin: its components
        // sprawl, have low fill inside their own bounding box, and vary
        // wildly in size. Furniture repeats: many components at nearly the
        // same scale, each solidly filling its box. So the family is asked
        // about its own components.
        const compact=comps.filter(c=>c.fill>=.45&&Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h))<=2.2);
        const sides=compact.map(c=>Math.sqrt(c.w*c.h)).sort((a,b)=>a-b);
        const medSide=sides.length?sides[sides.length>>1]:0;
        // How tightly the compact components agree on one size. A repeated
        // furniture symbol clusters hard; incidental ink blobs do not.
        const nearModal=medSide?compact.filter(c=>{
          const s=Math.sqrt(c.w*c.h);return s>=medSide*.65&&s<=medSide*1.55;}).length:0;
        const repetition=compact.length?nearModal/compact.length:0;
        // ...and what repeats has to be big enough to be a drawn object.
        //
        // Repetition alone says "many similar blobs", which is equally true of
        // a seating row and of the antialiasing band along every edge in the
        // drawing. Measured, once minority tone families were admitted: the
        // real plan's tan surface family arrives as 823 components whose
        // modal side is 4.9px against a 7.7px chair floor — fringe — and it
        // passed this test on 148 of 192 compact components agreeing with
        // each other. It then contributed 22 false chairs.
        //
        // The family's own modal size is the honest thing to ask about, and
        // the floor is the same plan-relative one a single chair must clear.
        const familyModalOk=medSide>=minDim*CHAIR_MIN_SIDE_P;
        const looksLikeFurniture=nearModal>=6&&repetition>=.55&&familyModalOk;
        // A dark family has to clear the structural bar outright, since dark
        // families are where linework actually lives. A light family may also
        // pass on the old solidity signal alone.
        const tableWorthy=solidity>=.25; // antialiasing fringe along outlines, not a real filled object
        const chairWorthy=looksLikeFurniture;
        toneFamilyEvidence.push({index,luma:family?.luma??null,
          solidity:Number(solidity.toFixed(3)),components:comps.length,compact:compact.length,
          nearModal,repetition:Number(repetition.toFixed(2)),
          modalSide:medSide?Number(medSide.toFixed(1)):null,
          usedForTables:tableWorthy,usedForChairs:chairWorthy,
          verdict:tableWorthy?"furniture surface (solid mask)":chairWorthy?"repeated compact family (chairs only)":"linework"});
        // On a neutral drawing one tone family IS the chairs (a mid-grey
        // chair fill against a pale table fill), so tone families are a real
        // chair source, not only a table source.
        tintIsChairMaterial[index]=chairWorthy;
        if(chairWorthy)chairSources.push({name:"tone-cluster"+index,labels,rawCount:comps.length,comps:comps.filter(c=>chairSizeOk(c)&&c.fill>=.3)});
        if(!tableWorthy)return;
        const kept=comps.filter(c=>tableSizeOk(c)&&c.fill>=.35);
        for(const c of kept)c.source="tone";
        toneKept+=kept.length;
        sources.push({name:"tone"+index,labels,comps:kept,all:comps});
      });
      diagnosticsSources.tone=toneKept;
      diagnosticsSources.toneFamilies=toneFamilyEvidence;

      // ---- dark repeated families, chairs only --------------------------
      // A mid-grey chair fill on white paper sits below the ink ceiling, so
      // the tone families above never see it: measured on the dense
      // grayscale fixture, 96 chairs and 0 detected, because their family
      // was discarded as linework before a component was examined.
      //
      // Darkness is the wrong question. Linework is thin; furniture is a
      // solid, repeated, similarly-sized blob. Each rejected dark peak gets
      // its own standalone mask -- deliberately NOT part of the tone LUT,
      // which would steal pixels from the table surface -- and earns a place
      // in the chair pool only by that structure.
      for(const [di,peak] of (toneModel?.darkCandidates||[]).entries()){
        let gap=Infinity;
        for(const q of toneModel.peaks)if(q!==peak)gap=Math.min(gap,Math.abs(q.luma-peak.luma));
        const window=Math.max(4,Math.min(16,Math.floor(gap/2)));
        const dmask=new Uint8Array(total);
        for(let i=0;i<total;i++){const v=gray[i];if(Math.abs(v-peak.luma)<=window)dmask[i]=1;}
        const{labels,comps}=COMP.labelComponents(dmask,width,height,minPixels,true);
        const compact=comps.filter(c=>c.fill>=.45&&Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h))<=2.2);
        const sides=compact.map(c=>Math.sqrt(c.w*c.h)).sort((a,b)=>a-b);
        const medSide=sides.length?sides[sides.length>>1]:0;
        const nearModal=medSide?compact.filter(c=>{
          const sv=Math.sqrt(c.w*c.h);return sv>=medSide*.65&&sv<=medSide*1.55;}).length:0;
        const rep=compact.length?nearModal/compact.length:0;
        const furniture=nearModal>=6&&rep>=.55;
        toneFamilyEvidence.push({index:"dark"+di,luma:peak.luma,belowInkCeiling:true,
          components:comps.length,compact:compact.length,nearModal,
          repetition:Number(rep.toFixed(2)),modalSide:medSide?Number(medSide.toFixed(1)):null,
          usedForTables:false,usedForChairs:furniture,
          verdict:furniture?"repeated compact family (chairs only)":"linework"});
        if(furniture)chairSources.push({name:"dark-tone-cluster"+di,labels,rawCount:comps.length,
          comps:comps.filter(c=>chairSizeOk(c)&&c.fill>=.3)});
        if(globalThis.MERIT_DETECT_DEBUG&&furniture){
          (globalThis.MERIT_DARK_FAMILY_PROBE||=[]).push({index:di,medSide:medSide,nearModal,rep,
            comps:comps.map(c=>({x:c.x,y:c.y,w:c.w,h:c.h,fill:+c.fill.toFixed(3),
              side:+Math.sqrt(c.w*c.h).toFixed(1),notWall:notWall(c),sizeOk:chairSizeOk(c)}))});
        }
      }
      mark("toneMasks");
    }
    // (c) solid dark objects straight from the fill mask (no edges OR-ed in)
    {
      const{labels,comps}=COMP.labelComponents(fillMask,width,height,minPixels,true);
      const kept=comps.filter(c=>tableSizeOk(c)&&c.fill>=.35);
      for(const c of kept)c.source="fill";
      diagnosticsSources.fill=kept.length;
      sources.push({name:"fill",labels,comps:kept,all:comps});
      fallbackChairComps=comps.filter(c=>chairSizeOk(c)&&c.fill>=.045);
      fallbackChairLabels=labels;
      diagnosticsSources.fallbackChairComponents=fallbackChairComps.length;
      mark("fillMask");
    }
    return { sources, diagnosticsSources, chairSources, tintIsChairMaterial,
      fallbackChairComps, fallbackChairLabels, accentMask, surfaceMask, masksTints };
  }

  globalThis.MeritPlanSources = { version: 1, collectSources };
})();
