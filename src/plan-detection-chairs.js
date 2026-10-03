// CHAIRS FIRST: THE SEATS, FOUND FROM THEIR OWN MODEL BEFORE ANY TABLE.
//
// Split B, stage B-5 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`, moved
// out of `detect()` in `src/plan-detection-classical.js` verbatim — the
// larger of the two stages the map called the hard part. Its hand-off to the
// tables stage is real, not incidental: the chair modal size, the uniform
// family and the chairs themselves are what table scoring reasons with, which
// is why the stages are ordered by data.
//
// findChairs(input)                                                     B-5
//   IN        { width, height, total, area, minPixels, sources, chairSources,
//               fallbackChairComps, fallbackChairLabels, accentMask,
//               chairSizeOk, analyze } — the object sources and chair-scale
//             pools from B-4, the accent mask, and the detector's own size
//             test and shape analyser.
//   OUT       { chairs, chairModal, chairUniform, chairSource,
//               chairSourceBreakdown, chairFloorSide, detectionPath,
//               secondaryFamilyDiagnostics, gapTo } — the chairs with their
//             family, the modal chair size and whether the family is uniform,
//             which source supplied them and why, and the gap measure the
//             tables stage and the column pass reuse.
//   MUTATES   via `analyze`, the cached shape of the components it examines.
//   FAILS     never: with no chair source it reports the table-first path.
//   TEST OWNER `benchmarks/detector-fingerprint.mjs` (28 plans,
//             byte-identical), `chair-families`, `benchmark:baseline`'s chair
//             recall and association fields.
//
// Measured with scratchpad stage-io (declarations at detect()'s own
// statement level, every declarator and destructuring pattern counted):
// twelve inputs, nine outputs, nothing earlier reassigned.
(() => {
  "use strict";
  const COMP = globalThis.MeritPlanComponents;
  const GEO = globalThis.MeritPlanGeometry;
  const PRIOR = globalThis.MeritPlanSizePrior;
  const SPLIT = globalThis.MeritPlanSplit;

  function findChairs(input) {
    const { width, height, total, area, minPixels, sources, chairSources, fallbackChairComps,
      fallbackChairLabels, accentMask, chairSizeOk, analyze } = input;
    // ---- STAGE B: chairs first -------------------------------------------
    // Chairs are detected from their OWN model before any table is
    // considered. That is what stops a chair drawn against a table outline
    // from being swallowed by the table blob, and it makes the seat count
    // independent of whether a table was found at all. On this product's
    // plans the chair count IS the number the operator needs (pax), so it is
    // a first-class output, not a by-product of table detection.
    if(accentMask){
      const{labels,comps}=COMP.labelComponents(accentMask,width,height,Math.max(6,Math.round(minPixels*.6)),true);
      chairSources.unshift({name:"colour-cluster",labels,rawCount:comps.length,comps:comps.filter(c=>chairSizeOk(c)&&c.fill>=.3)});
    }
    // The same physical chair can surface in more than one mask; the most
    // specific source wins and the duplicate is dropped (overlap of the
    // smaller box, not IoU, because the masks disagree slightly on size).
    const chairEntries=[];
    // Which chair family an entry belongs to. Everything the primary source
    // claimed is one family; each secondary family admitted below is its own.
    // This is the axis the whole chair stage reasons on from here down —
    // "which family is this, and does it look like the rest of THAT family"
    // rather than "does this look like the one modal object on the plan".
    const chairFamilyOf=e=>(e.source||"").startsWith("family:")?e.source:"primary";
    const addChairs=(comps,labels,name)=>{
      for(const c of comps){
        if(chairEntries.some(e=>GEO.sameObject(e.comp,c)))continue;
        c.source=name;
        chairEntries.push({comp:c,labels,source:name});
      }
    };
    let chairSource="none";
    // On a plan where the chairs have their OWN colour, the dedicated accent
    // cluster is the whole chair population and the tone families describe
    // something else -- on the real venue plan the strongest tone family IS
    // the tan table surface. Unioning the two sources therefore fed real
    // tables into the chair list, which both removed them from the table pool
    // (they get subtracted from it below) and inflated the seat count with
    // objects nobody sits on. Measured on that plan: tables were reported as
    // `venue/chair`, and the seat total only looked close to the drawing's
    // printed 124 because tables were padding it.
    //
    // So: the most specific source wins outright rather than being merged
    // with a weaker one. tone-cluster stays the chair source for monochrome
    // plans, where it is the only evidence there is.
    const colourChairs=chairSources.find(src=>src.name==="colour-cluster");
    const useColourOnly=colourChairs&&colourChairs.comps.length>=6;
    // MEASURED LIMITATION, deliberately left in place rather than traded away.
    //
    // On a colour plan only the accent cluster feeds the chair pool. That
    // costs the pale OUTLINED chairs ringing the round tables on the real
    // venue plan: they carry no accent colour and no distinct fill tone, so
    // the outline-interior source is the only evidence that can see them,
    // and it is excluded here.
    //
    // Letting it through was tried and measured. Real-plan chairs went
    // 79 -> 124 (which happens to match the drawing's printed 124), but
    // tables collapsed: F1 0.882 -> 0.543, and 0 of 24 square tables
    // survived. The reason is structural, not a tuning miss -- chairs are
    // subtracted from the table pool, and on THIS plan the chair symbols
    // (~34px) and the square tables (~44px) both pass chairSizeOk, whose
    // ceiling is 0.065 of the short edge, about 51px. So the source claims
    // real tables as chairs.
    //
    // The honest fix is a pipeline reordering: the chair/table split for
    // size-ambiguous components has to happen AFTER the modal table size is
    // known, so each component can be assigned to whichever modal it agrees
    // with. That is real work, not a threshold, and a chair number bought by
    // destroying table recall is worth nothing. See the sprint report.
    // A/B switch so the cost of the colour-only gate can be measured on the
    // same build against per-family ground truth, rather than argued about.
    // Benchmarks set it; the product never does.
    //
    // ---- secondary chair families (measured, see the table) ---------------
    //
    // Against per-chair ground truth on the real plan, the colour source is
    // exactly right and exactly incomplete:
    //
    //                     colour only        every source
    //   orange armchair    79/79              79/79
    //   bistro chair        0/10             10/10
    //   pale outlined       0/24             24/24
    //   chair TP / FP      79 / 0           113 / 303
    //   table F1            0.882             0.804
    //
    // The two missing families are not invisible to this pipeline. Every one
    // of the 34 is found by a source the colour gate discards -- along with
    // 303 things that are not chairs. That makes this a PRECISION problem
    // rather than a recall one, and precision is answerable with evidence.
    //
    // A real chair on a floor plan sits against a table. A shard of linework
    // does not, and neither does printed text. So the candidates the colour
    // source did not claim are grouped into families by size and shape, and
    // a family is admitted only when most of its members are adjacent to a
    // table SURFACE component -- available here because the surface masks
    // are built in this same pass. Repetition alone is NOT enough and was
    // measured wrong before (benchmarks/BISTRO-MERGE.md); adjacency is
    // evidence a text run or a wall fragment cannot fake.
    //
    // "Near a bigger thing" is not that evidence on its own, and measuring it
    // proved it: printed matter sits INSIDE a drawn legend box, whose filled
    // interior is itself a surface component, so every glyph of the capacity
    // block "touched a surface" and nine of them were admitted as chairs.
    //
    // The physical fact is narrower than adjacency. You sit AGAINST a table,
    // never inside one. So a candidate whose centre pixel belongs to the
    // surface it is near is contained BY that surface, not seated at it, and
    // it does not count. This is tested against the surface's actual mask
    // rather than its bounding box, because a chair in the ring around a
    // round table is inside that table's bounding SQUARE while being well
    // clear of the disc -- a box test would throw away every round-table
    // chair on this plan to catch the glyphs.
    const surfaceEntries=sources.flatMap(src=>src.comps.map(c=>({comp:c,labels:src.labels})));
    const gapTo=(a,b)=>Math.max(0,Math.max(a.x-(b.x+b.w),b.x-(a.x+a.w)))
      +Math.max(0,Math.max(a.y-(b.y+b.h),b.y-(a.y+a.h)));
    const surfaces=surfaceEntries.map(e=>e.comp);
    const containedBy=(c,e)=>{
      const cx=Math.round(c.x+c.w/2),cy=Math.round(c.y+c.h/2);
      if(cx<0||cy<0||cx>=width||cy>=height||!e.labels)return false;
      return e.labels[cy*width+cx]===e.comp.label;
    };
    //
    // And "something bigger nearby" is not the test either. Measured on the
    // real plan, the surface each capacity-block glyph was found against was
    // its own WORD: 49x20, 38x20, 58x21 — bigger, yes, but exactly as tall
    // as the glyph and grown only sideways. The surfaces real seats sit
    // against were 36x32, 67x67, 68x69.
    //
    // A table is broader than a chair in EVERY direction and several times
    // its area, because it seats several of them along each usable side. A
    // line of text can only ever be as tall as its own letters. That is the
    // difference, and it is a fact about furniture rather than a threshold
    // chosen to make this plan pass. The two numbers below are read off the
    // real plan (real seats: 3.3x area and up; glyphs: 1.1-2.9x) and are
    // guarded by the benchmark.
    // An aspect bar on the surface was tried here too -- a table is roughly
    // as broad as it is deep, a line of text is a line -- and it changed
    // nothing on any fixture, so it is not in the code. The five remaining
    // false chairs reach their surfaces some other way. An unexercised
    // constant is an unmeasured claim, and this one would also reject a long
    // trestle table, which is a real seat surface.
    const SEAT_SURFACE_MIN_AREA=3;
    const seatSurfaceFor=c=>{
      const reach=Math.max(c.w,c.h)*.7,area=c.w*c.h,longSide=Math.max(c.w,c.h);
      return surfaceEntries.find(e=>e.comp!==c&&!GEO.sameObject(e.comp,c)
        &&gapTo(c,e.comp)<=reach
        &&Math.min(e.comp.w,e.comp.h)>longSide
        &&e.comp.w*e.comp.h>=area*SEAT_SURFACE_MIN_AREA
        &&!containedBy(c,e))||null;
    };
    const touchesSurface=c=>!!seatSurfaceFor(c);
    // A secondary family also has to be a plausible SEAT. The primary colour
    // family gives the reference: on the real plan its chairs are ~35px, the
    // bistro chairs are ~17px and the pale crescents ~25px, so a factor of
    // about two below the reference is a real minority family. Without this
    // band the adjacency rule happily admitted families of 4-6px specks --
    // they repeat, and on a dense plan everything is near something.
    const SECONDARY_MIN_MEMBERS=4,SECONDARY_MIN_ADJACENT=.7;
    // Two bounds, and they anchor to different things on purpose.
    //
    // The FLOOR is relative to the primary chair family: a minority seat is
    // smaller than the main one but not by an order of magnitude. On the real
    // plan the reference is ~35px, the bistro chairs are ~17 and the pale
    // crescents ~25. Without a floor, adjacency admitted families of 4-6px
    // specks -- they repeat, and on a dense plan everything is near something.
    //
    // The CEILING is relative to the plan's own SURFACES, not to the chair.
    // Anchoring it to the chair (1.6x of 35 = 56px) admitted a family at
    // table scale, which removed 22 of 22 square tables from the table pool
    // and took table F1 to 0.529. Nothing the size of this plan's surfaces
    // may be claimed as a chair; the table pool needs it more.
    const SECONDARY_MIN_SIDE_RATIO=.4,SECONDARY_MAX_SURFACE_RATIO=.75;
    const secondaryFamilies=[];
    // WHICH POPULATION DEFINES WHAT A SEAT LOOKS LIKE HERE.
    //
    // It used to be the colour cluster and nothing else: the whole family
    // pass below sat inside `if (useColourOnly)`. On a plan drawn in ink
    // that gate never opens, and the consequence is not "no second family is
    // admitted" — it is that the sheet is allowed exactly ONE seat
    // vocabulary, set by whichever population happens to be the largest, and
    // that one vocabulary is applied to every room on it.
    //
    // Measured on `a9-mixed-representation`, a sheet carrying a symbolic
    // hall and a drawn terrace: the 72 numbered discs of the hall set the
    // modal seat at 48px, and the terrace's 24 real chairs — 22px, every
    // one of them detected, every one of them against a table — were
    // dropped by `chairAccepted` for not resembling a symbol in a different
    // room. With no seats, the terrace's three tables were never proposed:
    // `tablesFound: 0` and `associatedToTable: 0` were facts about a
    // statistic taken over the whole drawing, not about the terrace.
    //
    // So the reference is the largest chair source, whatever it is made of.
    // Colour, where a plan has it, is still the strongest evidence and is
    // still preferred; ink is what is left when there is none. Nothing below
    // is loosened — a family still needs four members, a size inside the
    // band, and most of its members sitting against a table surface.
    const SECONDARY_PRIMARY_MIN=6;
    // The two anchors the size band is measured against, hoisted so they are
    // always visible in diagnostics — including when no family was
    // considered at all. They are the quantities that decide whether a
    // second seat vocabulary can exist on this plan, and a bound whose
    // anchor is never printed cannot be argued with.
    let primaryReferenceSide=null,planSurfaceSide=null;
    // A real boolean: `useColourOnly` is the colour source itself when there
    // is none, so this used to report `null` on every ink plan and `false`
    // on none of them. A diagnostic that says "no" in two different ways is
    // a diagnostic somebody will misread.
    const colourPrimary=!!(useColourOnly&&!globalThis.MERIT_ALL_CHAIR_SOURCES);
    const primarySource=colourPrimary?colourChairs
      :chairSources.slice().sort((a,b)=>b.comps.length-a.comps.length)[0]||null;
    let primaryFamilyComps=primarySource?primarySource.comps:[];
    if(primarySource&&primarySource.comps.length>=SECONDARY_PRIMARY_MIN){
      // The PRIMARY source is not one family either, and assuming it was is
      // what hid the bistro seats for so long. On the real plan the accent
      // colour belongs to both the 34px armchairs and the 17px bistro
      // chairs: the colour cluster offers 111 components, the modal size
      // gate downstream keeps 79, and the ~10 it drops are real chairs found
      // by the strongest evidence this pipeline has. They were thrown away
      // for not resembling their bigger cousins.
      //
      // So the colour source is split the same way as everything else: its
      // dominant size family is the REFERENCE (it defines what a chair is on
      // this plan, and everything downstream measures against it), and its
      // minority members go back into the pool to earn admission on the same
      // adjacency evidence as any other family. A minority family is not
      // trusted because it shares a colour -- printed matter in the accent
      // colour would share it too -- it is trusted because most of its
      // members sit against a table surface.
      const primaryModal=PRIOR.modalMagnitude(primarySource.comps.map(c=>Math.sqrt(c.w*c.h)));
      const inPrimaryFamily=c=>!primaryModal||PRIOR.sizeAgreement(Math.sqrt(c.w*c.h),primaryModal)>=.25;
      const claimed=primarySource.comps.filter(inPrimaryFamily);
      primaryFamilyComps=claimed;
      const extra=primarySource.comps.filter(c=>!inPrimaryFamily(c))
        .map(c=>({comp:c,source:primarySource}));
      for(const src of chairSources){
        if(src===primarySource)continue;
        for(const c of src.comps){
          if(claimed.some(k=>GEO.sameObject(k,c))||extra.some(k=>GEO.sameObject(k.comp,c)))continue;
          extra.push({comp:c,source:src});
        }
      }
      // Family key: size and elongation, both on a log scale, so a family is
      // "objects drawn the same" rather than "objects within N pixels".
      const keyOf=c=>{
        const side=Math.sqrt(c.w*c.h),elong=Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h));
        return Math.round(Math.log(side)/Math.log(1.18))+":"+Math.round(Math.log(elong)/Math.log(1.25));
      };
      const medianSide=list=>{
        const v=list.map(c=>Math.sqrt(c.w*c.h)).sort((a,b)=>a-b);
        return v.length?v[v.length>>1]:0;
      };
      const referenceSide=medianSide(claimed);
      primaryReferenceSide=referenceSide;
      // How far apart the primary family's own seats stand, and how close a
      // candidate is to the nearest of them. A genuinely distinct seat family
      // sits at ITS OWN tables; a family of debris shed by the primary one
      // interleaves with the seats it came from.
      const centreOf=c=>[c.x+c.w/2,c.y+c.h/2];
      const primaryCentres=claimed.map(centreOf);
      const nearestPrimaryDistance=c=>{
        const[cx,cy]=centreOf(c);let best=Infinity;
        for(const[px,py] of primaryCentres){
          const d=Math.hypot(cx-px,cy-py);
          if(d<best)best=d;
        }
        return best;
      };
      const spacings=primaryCentres.map(([x0,y0])=>{
        let best=Infinity;
        for(const[px,py] of primaryCentres){
          if(px===x0&&py===y0)continue;
          const d=Math.hypot(x0-px,y0-py);
          if(d<best)best=d;
        }
        return best;
      }).filter(Number.isFinite).sort((a,b)=>a-b);
      const primarySpacing=spacings.length?spacings[spacings.length>>1]:0;
      const surfaceSide=medianSide(surfaces.filter(c=>Math.min(c.w,c.h)>=6));
      planSurfaceSide=surfaceSide;
      // IS THE FLOOR'S ANCHOR A SEAT AT ALL?
      //
      // The floor below says a minority seat is not an order of magnitude
      // smaller than the plan's MAIN SEAT. That premise is never checked,
      // and on a sheet drawn in two languages it is false: where the largest
      // repeated population is a hall of numbered symbols, `referenceSide`
      // is the size of a TABLE and the band it opens — [0.4R, 0.75S] with
      // R and S the same objects — sits entirely above every real seat on
      // the drawing.
      //
      // The check is the premise itself, and it needs no new constant: a
      // seat is smaller than the surface it is served on. This file already
      // states that three times (`seatSurfaceFor`'s `min side > longSide`,
      // its 3x area rule, and the ceiling immediately below). Where the
      // reference is NOT smaller than the plan's surfaces, it is not a seat
      // population, and a floor measured against it is measuring nothing.
      // The ceiling still applies — nothing at surface scale becomes a
      // chair — as do four members and the adjacency share, which is the
      // evidence that actually says "these are seats".
      //
      // Measured across every plan available here (family-anchors.mjs):
      // referenceSide < surfaceSide on a1, a2, a3, a4, a6, a7, a8 and the
      // real venue plan, so the floor is unchanged on all of them and its
      // value is untouched. The three where they are EQUAL are exactly the
      // three with no seating drawn or none detected — a5, ORNEK and the
      // mixed sheet. Setting the ratio to 0 instead was tried, as the
      // experiment that establishes what the floor protects: across eleven
      // plans it changed ONE admission, and that admission was a real seat
      // family. The constant is kept for the plans whose premise holds.
      const referenceIsSeatSized=!surfaceSide||referenceSide<surfaceSide;
      const groups=new Map();
      for(const e of extra){const k=keyOf(e.comp);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
      for(const [key,members] of groups){
        if(members.length<SECONDARY_MIN_MEMBERS)continue;
        const sides=members.map(m=>Math.sqrt(m.comp.w*m.comp.h)).sort((a,b)=>a-b);
        const side=sides[sides.length>>1];
        const sizeOk=(!referenceSide||!referenceIsSeatSized||side>=referenceSide*SECONDARY_MIN_SIDE_RATIO)
          &&(!surfaceSide||side<=surfaceSide*SECONDARY_MAX_SURFACE_RATIO);
        // Two questions, not one. The family answers "is a second kind of
        // seat drawn on this plan at all", and only a family most of whose
        // members sit at a table may say yes. Each MEMBER then answers "am I
        // one of them" for itself.
        //
        // Both are needed, because the trap on this plan is a family that is
        // genuinely mixed: the capacity block is printed at chair scale in
        // the chair's own colour, so its glyphs land in the same size-and-
        // shape family as the real bistro seats. Admitting the family whole
        // takes nine glyphs with it; rejecting it whole loses the seats.
        const seated=members.filter(m=>touchesSurface(m.comp));
        const adjacent=seated.length;
        const share=adjacent/members.length;
        // How much of this family is standing among the primary family's own
        // seats rather than at tables of its own.
        //
        // GATED ONLY WHERE THE SIZE FLOOR CANNOT BE — see `standsClear`
        // below. Everywhere else it is reported and nothing depends on it,
        // for the reason the rest of this paragraph gives.
        //
        // A genuinely distinct seat family sits at its
        // own tables and so stands well clear of the primary family's seats;
        // a family of debris shed by the primary one interleaves with them.
        // Measured, in units of the primary family's own seat spacing: the
        // real plan's five admitted families read 1.75 to 3.34, and the
        // `downscale-70` debris families read 1.04 and 1.07. It separates —
        // by 17%, on one plan, with the real plan's smallest admitted family
        // sitting closest to the line. That is not enough margin to delete a
        // family on, and it would remove 32 of that variant's 73 false chairs
        // rather than all of them. Left as evidence for whoever has more of it.
        const nearDists=members.map(m=>nearestPrimaryDistance(m.comp)).filter(Number.isFinite).sort((a,b)=>a-b);
        const medianNearPrimary=nearDists.length?nearDists[nearDists.length>>1]:Infinity;
        const crowding=primarySpacing?medianNearPrimary/primarySpacing:Infinity;
        // WHAT REPLACES THE FLOOR WHEN THE FLOOR HAS NO ANCHOR.
        //
        // The floor's job is "this is not debris shed by the primary
        // family", and it does that job by size, against the primary
        // family's median. Where the reference is not smaller than the
        // plan's own surfaces that anchor is meaningless (see
        // `referenceIsSeatSized`), and dropping the floor there with nothing
        // in its place admitted a family of four 12px fragments standing
        // among the symbols of `symbolic-plan-detection`'s drawing — a sheet
        // with no seat on it at all — which then kept four symbols out of
        // the swap as "tables with drawn seats". Measured: 48 tables for 44
        // symbols and 6 seats claimed where none exist.
        //
        // So the same question is asked with the measurement that answers it
        // without that anchor: does this family stand at its OWN tables, or
        // among the primary family's members? Everything measured so far, in
        // units of the primary family's own spacing:
        //
        //   debris    downscale-70            1.04, 1.07
        //   debris    the symbolic drawing    1.07
        //   real      merit-real-venue        1.75, 2.06, 2.34, 2.91, 3.34
        //   real      a9's terrace            3.73
        //
        // 1.07 against 1.75. The gate sits between them, and it applies ONLY
        // on the plans where the floor cannot — on every plan whose
        // reference really is seat-sized, nothing here changes and this
        // quantity stays what it has always been: reported, not gated on.
        //
        // It fails conservatively and it is worth saying how: a second
        // vocabulary drawn right among the first — a drawn top table at the
        // front of a symbolic ballroom — would read low and be refused. That
        // loses a family rather than inventing one, which is the direction
        // this contract requires when the evidence is genuinely ambiguous.
        const SECONDARY_MIN_CLEARANCE=1.4;
        const standsClear=referenceIsSeatSized||crowding>=SECONDARY_MIN_CLEARANCE;
        const admitted=sizeOk&&standsClear&&share>=SECONDARY_MIN_ADJACENT;
        secondaryFamilies.push({key,members:members.length,adjacent,
          share:Number(share.toFixed(2)),admitted,sizeOk,standsClear,
          side:Math.round(side),referenceSide:Math.round(referenceSide),surfaceSide:Math.round(surfaceSide),
          crowding:Number(crowding.toFixed(2)),primarySpacing:Math.round(primarySpacing),
          minClearance:referenceIsSeatSized?null:SECONDARY_MIN_CLEARANCE,
          source:members[0].source.name});
        // One entry per originating source, all under the same family name.
        // The label map a component was found in is what shape analysis has
        // to re-read its pixels from, so a family whose members came from two
        // masks cannot be pushed as one source with one of their label maps —
        // the other half would be measured against the wrong pixels.
        if(admitted){
          const bySource=new Map();
          for(const m of seated){
            if(!bySource.has(m.source))bySource.set(m.source,[]);
            bySource.get(m.source).push(m.comp);
          }
          for(const [src,comps] of bySource)
            chairSources.push({name:"family:"+key,labels:src.labels,rawCount:comps.length,comps});
        }
      }
    }
    const admittedFamilies=secondaryFamilies.filter(f=>f.admitted);
    const familySources=chairSources.filter(src=>src.name.startsWith("family:"));
    const activeChairSources=colourPrimary
      ?[{...colourChairs,comps:primaryFamilyComps},...familySources]
      // On an ink plan every source still contributes exactly what it did
      // before; what changes is the NAME a component arrives under. An
      // admitted family is offered first so its members carry their family's
      // label instead of their mask's, and `addChairs` keeps the first name
      // a component is seen with. That label is the whole point: it is what
      // gives the family its own modal size and its own elongation
      // downstream, instead of being measured against the plan's majority.
      // Same components, same count — a second vocabulary now gets to be
      // measured as one.
      :[...familySources,...chairSources.filter(src=>!src.name.startsWith("family:"))];
    const specificCount=activeChairSources.reduce((n,src)=>n+src.comps.length,0);
    // What each chair source actually offered, kept in diagnostics. Without
    // this the only visible fact is the final count, which cannot tell "the
    // source found nothing" apart from "the source found things and they
    // were filtered out" -- and those need opposite fixes.
    const chairSourceBreakdown=chairSources.map(src=>({
      name:src.name,offered:src.comps.length,
      rawPool:src.rawCount??null,
    })).concat([{name:"luma-fallback",offered:fallbackChairComps.length,rawPool:null}]);
    // Every secondary family considered, admitted or not, with the evidence
    // that decided it. A family rejected for sitting nowhere near a table is
    // the most useful line in this whole diagnostic.
    const secondaryFamilyDiagnostics={
      considered:secondaryFamilies.length,
      admitted:admittedFamilies.length,
      minMembers:SECONDARY_MIN_MEMBERS,minAdjacentShare:SECONDARY_MIN_ADJACENT,
      primary:primarySource?primarySource.name:null,
      primaryColour:colourPrimary,
      referenceSide:primaryReferenceSide===null?null:Math.round(primaryReferenceSide),
      surfaceSide:planSurfaceSide===null?null:Math.round(planSurfaceSide),
      // A SEAT IS SMALLER THAN THE TABLE IT SERVES. Both bounds below are
      // anchored to plan-wide medians, so this ratio says whether the two
      // populations they come from are actually different populations. Where
      // it approaches 1 the "reference seat" and the "reference table" are
      // the same objects, the band collapses onto them, and no real seat
      // anywhere on the sheet can fall inside it.
      referenceToSurface:primaryReferenceSide&&planSurfaceSide
        ?Number((primaryReferenceSide/planSurfaceSide).toFixed(3)):null,
      minSideRatio:SECONDARY_MIN_SIDE_RATIO,maxSurfaceRatio:SECONDARY_MAX_SURFACE_RATIO,
      families:secondaryFamilies.slice().sort((a,b)=>b.members-a.members).slice(0,12),
    };
    if(specificCount>=6){
      for(const src of activeChairSources)addChairs(src.comps,src.labels,src.name);
      chairSource=activeChairSources.find(src=>src.comps.length)?.name||"none";
    }else if(fallbackChairComps.length){
      addChairs(fallbackChairComps,fallbackChairLabels,"luma-components");
      chairSource="luma-components";
    }
    // Two chairs drawn a pixel or two apart merge into one blob. Where the
    // pixels actually show the gap, the same evidence-gated valley split used
    // for tables recovers both — measured, never assumed.
    const chairModalPre=PRIOR.modalMagnitude(chairEntries.map(e=>Math.sqrt(e.comp.w*e.comp.h)));
    if(chairModalPre){
      const modalSide=chairModalPre.value;
      for(let i=chairEntries.length-1;i>=0;i--){
        const e=chairEntries[i];
        if(Math.max(e.comp.w,e.comp.h)<modalSide*1.7)continue;
        const parts=SPLIT.splitAtValley(e.comp,e.labels,width,height,modalSide,modalSide);
        if(!parts||parts.length<2)continue;
        chairEntries.splice(i,1,...parts.map(p=>({comp:Object.assign(p,{source:e.source}),labels:e.labels,source:e.source})));
      }
    }
    for(const e of chairEntries)analyze([e.comp],e.labels);
    // Second dedup pass, now that a modal chair size exists. A drawn chair is
    // typically an outline plus an inner fill, or a seat plus a back; those
    // land as two components sitting almost on top of each other, and they
    // overlap too little for the earlier same-object test to catch. Two
    // centres closer together than ~0.55 of one chair cannot be two chairs on
    // a plan whose chairs are all one size, so they are merged into their
    // union. Measured on the venue plan: 63 such pairs out of 241.
    //
    // The gap is per FAMILY, not per plan. A merge distance taken from the
    // majority chair (~34px here) is wider than a minority chair is big, so
    // a global gap would swallow whole rings of the smaller seats into one
    // blob each — the families would be recovered above and then quietly
    // destroyed here.
    {
      const provisionalOf=list=>PRIOR.modalMagnitude(list.map(e=>Math.sqrt(e.comp.w*e.comp.h)));
      const gapByFamily=new Map();
      for(const e of chairEntries){
        const k=chairFamilyOf(e);
        if(!gapByFamily.has(k))gapByFamily.set(k,[]);
        gapByFamily.get(k).push(e);
      }
      for(const [k,list] of gapByFamily){
        const p=provisionalOf(list);
        gapByFamily.set(k,p&&p.support>=4?p.value*.55:0);
      }
      const provisional=provisionalOf(chairEntries);
      if(provisional&&provisional.support>=4){
        const merged=[];
        for(const e of chairEntries){
          const minGap=gapByFamily.get(chairFamilyOf(e))||0;
          const cx=e.comp.x+e.comp.w/2,cy=e.comp.y+e.comp.h/2;
          const hit=minGap&&merged.find(m=>chairFamilyOf(m)===chairFamilyOf(e)
            &&Math.hypot(cx-(m.comp.x+m.comp.w/2),cy-(m.comp.y+m.comp.h/2))<minGap);
          if(!hit){merged.push(e);continue;}
          const x1=Math.min(hit.comp.x,e.comp.x),y1=Math.min(hit.comp.y,e.comp.y);
          const x2=Math.max(hit.comp.x+hit.comp.w,e.comp.x+e.comp.w),y2=Math.max(hit.comp.y+hit.comp.h,e.comp.y+e.comp.h);
          hit.comp.x=x1;hit.comp.y=y1;hit.comp.w=x2-x1;hit.comp.h=y2-y1;
          hit.comp.shape=null; // recomputed by analyze() below
        }
        if(merged.length!==chairEntries.length){
          chairEntries.length=0;chairEntries.push(...merged);
          for(const e of chairEntries)analyze([e.comp],e.labels);
        }
      }
    }
    // Stage census, for the miss taxonomy only. Which objects existed as
    // components at all, before size/shape acceptance narrowed them — the
    // difference between "the detector never saw it" and "the detector saw
    // it and a later rule discarded it" needs opposite fixes.
    if(globalThis.MERIT_DETECT_DEBUG){
      globalThis.MERIT_STAGE_CENSUS={
        allSourceComps:sources.flatMap(s2=>s2.comps.map(c=>({x:c.x,y:c.y,w:c.w,h:c.h,source:s2.name}))),
        allSourceAll:sources.flatMap(s2=>(s2.all||[]).map(c=>({x:c.x,y:c.y,w:c.w,h:c.h,fill:+((c.fill??0).toFixed(3)),source:s2.name}))),
        chairEntries:chairEntries.map(e=>({x:e.comp.x,y:e.comp.y,w:e.comp.w,h:e.comp.h,family:chairFamilyOf(e)})),
      };
    }
    const chairComps=chairEntries.map(e=>e.comp);
    const primaryComps=chairEntries.filter(e=>chairFamilyOf(e)==="primary").map(e=>e.comp);
    // The modal is the PRIMARY family's, not the whole chair population's.
    // Downstream this number stands for "how big is a chair on this plan"
    // when subtracting chairs from the table pool and setting the split
    // thresholds, and a minority family of smaller seats must not drag it
    // down — a chair-scale short modal is exactly what over-split real
    // tables the last time it moved.
    const chairModal=PRIOR.modalMagnitude((primaryComps.length?primaryComps:chairComps).map(c=>Math.sqrt(c.w*c.h)));
    // A trustworthy chair population is MANY objects of ONE size. If the
    // population is not uniform we say so in the result and fall back to the
    // table-first path instead of reporting a seat count we cannot defend.
    // Judged on the primary family for the same reason: admitting a second,
    // smaller family is evidence about the plan, not a loss of confidence in
    // the first one.
    const chairUniform=!!chairModal&&(primaryComps.length?primaryComps:chairComps).length>=6
      &&chairModal.support/chairModal.total>=.6;
    // Chairs on a plan are drawn identically, so the repeated SHAPE is real
    // evidence too. Elongation is measured orientation-invariantly
    // (long/short side), because the same chair drawn on the left of a table
    // is the same object rotated 90 degrees, not a different one. This is
    // what tells a chair-sized printed glyph from a chair without OCR.
    const elongationOf=c=>Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h));
    const chairModalElongation=PRIOR.modalMagnitude((primaryComps.length?primaryComps:chairComps).map(elongationOf));
    // One elongation mode, deliberately. A second mode was implemented here
    // and REVERTED once the real plan had per-chair ground truth to measure
    // against -- see benchmarks/BISTRO-MERGE.md.
    //
    // The idea was that a plan may seat two chair shapes, and it fixed a
    // synthetic bistro fixture completely (0 of 5 tables to 5 of 5). On the
    // real plan it appeared to gain 8 chairs, 79 to 87. With spatial truth
    // those 8 turned out to be the printed capacity block -- "114 pax
    // seating / 10 pax bistro / Total : 124 pax" -- at 35x17 and elongation
    // ~2.0. Zero real chairs gained, 8 false ones, plus a table false
    // positive and four more review groups.
    //
    // Which is the failure this test was written to prevent, in the words of
    // the comment below it: a chair-sized printed glyph is told from a chair
    // by its repeated SHAPE, and widening the shape gate let the glyphs in.
    // The fixture could not catch it because the fixture had no printed
    // matter on it; it does now.
    //
    // A second family is still the right idea, but it needs independent
    // evidence that text cannot fake -- adjacency to a table surface, not a
    // looser shape rule. Shape alone is not enough.
    //
    // That is what the secondary-family pass above does, and this is where
    // its result is honoured: the elongation and size a candidate is judged
    // against are ITS OWN family's, so a 17px crescent is not asked to
    // resemble a 34px armchair. The gate is not loosened — each family is
    // still held to a single repeated size and a single repeated shape, and
    // a family only exists at all because most of its members sit against a
    // table surface. A run of printed glyphs still fails, now for the reason
    // it should: it never becomes a family.
    const familyProfiles=new Map();
    for(const e of chairEntries){
      const k=chairFamilyOf(e);
      if(!familyProfiles.has(k))familyProfiles.set(k,[]);
      familyProfiles.get(k).push(e.comp);
    }
    for(const [k,comps] of familyProfiles){
      familyProfiles.set(k,{
        count:comps.length,
        size:k==="primary"?chairModal:PRIOR.modalMagnitude(comps.map(c=>Math.sqrt(c.w*c.h))),
        elongation:k==="primary"?chairModalElongation:PRIOR.modalMagnitude(comps.map(elongationOf)),
      });
    }
    const profileFor=e=>familyProfiles.get(chairFamilyOf(e))||null;
    // The SMALLEST chair family, for the downstream rule "nothing at chair
    // scale is a table".
    //
    // That rule is enforced with one number, and taking it from the majority
    // chair is the same mistake as judging every chair against the majority
    // chair. This plan is the case that proves it: its bistro tables measure
    // 36x31 to 36x39 against ~34x34 armchairs, so a floor of one armchair
    // area (1156px) sits right in the middle of them — 1224 and 1258 survive,
    // 1116 and 1152 are deleted as "chair-sized". A bistro table is bigger
    // than a bistro chair; it is not bigger than an armchair, and it does not
    // have to be.
    //
    // Worth knowing: this exact change was implemented and measured once
    // before and changed nothing at all, because the bistro tables were
    // already being deleted an earlier stage up, at surface coverage. It was
    // reverted then for that reason — a guard loosened for a reason that
    // sounds right and measures as nothing is a guard weakened for free. It
    // is back now because that earlier stage was fixed and this one became
    // the binding constraint, which is the only argument that should have
    // brought it back.
    const chairFamilySides=[...familyProfiles.values()].map(p=>p.size?.value).filter(v=>v>0);
    const chairFloorSide=chairFamilySides.length?Math.min(...chairFamilySides):null;
    const chairShapeOk=(c,profile)=>{
      const modalElongation=profile?.elongation||chairModalElongation;
      if(!chairUniform||!modalElongation)return true;
      const elongation=elongationOf(c);
      return Math.abs(Math.log(elongation/modalElongation.value))<=Math.log(1.6);
    };
    const chairAccepted=e=>{
      const profile=profileFor(e);
      const modalSize=profile?.size||chairModal;
      return PRIOR.sizeAgreement(Math.sqrt(e.comp.w*e.comp.h),modalSize)>=.25&&chairShapeOk(e.comp,profile);
    };
    // Cross-family duplicate suppression was tried here and is NOT in the
    // code, because it measured as a no-op on every plan and variant.
    //
    // The near-duplicate merge above is deliberately per-family, so a ring of
    // small seats is not swallowed by a gap measured from the big ones, and
    // that leaves no suppression BETWEEN families. On `downscale-70` that
    // looked like the cause of 73 false chairs: a 24px armchair fragments
    // into 8-14px pieces which are too far from the primary modal to be
    // claimed, form a minority family of their own, and pass the
    // table-adjacency test trivially. But the pieces sit BESIDE their parent
    // chair, 15-40px from its centre, not inside it — "nothing sits inside a
    // chair" is true and removes nothing. See the family diagnostics'
    // `crowding` figure for what does separate them, and why it is not
    // gated on.
    // The family label lives on the entry, not the component, and the
    // relationship engine needs it: whether a chair looks like the chairs
    // already at a table is one of its tie-breakers. Assigning onto the same
    // component object rather than copying keeps object identity, which the
    // `sameObject` pool filter below depends on.
    const chairs=chairUniform
      ?chairEntries.filter(chairAccepted).map(e=>Object.assign(e.comp,{chairFamily:chairFamilyOf(e)}))
      :chairComps;
    if(globalThis.MERIT_STAGE_CENSUS){
      globalThis.MERIT_STAGE_CENSUS.accepted=chairs.map(c=>({x:c.x,y:c.y,w:c.w,h:c.h}));
      globalThis.MERIT_STAGE_CENSUS.rejectedByAcceptance=chairEntries.filter(e=>!chairAccepted(e))
        .map(e=>{const pr=profileFor(e);const modal=pr?.size||chairModal;
          return{x:e.comp.x,y:e.comp.y,w:e.comp.w,h:e.comp.h,family:chairFamilyOf(e),
            mag:+Math.sqrt(e.comp.w*e.comp.h).toFixed(1),modal:modal?+modal.value.toFixed(1):null,
            agree:+PRIOR.sizeAgreement(Math.sqrt(e.comp.w*e.comp.h),modal).toFixed(3),
            shapeOk:chairShapeOk(e.comp,pr),elong:+elongationOf(e.comp).toFixed(2)};});
      globalThis.MERIT_STAGE_CENSUS.chairModal=chairModal?+chairModal.value.toFixed(1):null;
      globalThis.MERIT_STAGE_CENSUS.chairUniform=chairUniform;
    }
    const detectionPath=chairUniform?"chair-first":"table-first";
    return { chairs, chairModal, chairUniform, chairSource, chairSourceBreakdown, chairFloorSide,
      detectionPath, secondaryFamilyDiagnostics, gapTo };
  }

  globalThis.MeritPlanChairs = { version: 1, findChairs };
})();
