// THE VENUE-SCALE OBJECTS: COLUMNS ON A GRID, AND SHAPES LEFT UNNAMED.
//
// Split B, stage B-15 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`, moved
// out of `detect()` in `src/plan-detection-classical.js` verbatim — with B-16
// one of the two stages the map gives after the preamble, because it consumes
// the finished table pool and produces independent outputs.
//
// venueScaleObjects(input)                                             B-15
//   IN        { chosen, chairAssign, surfaceRejectedComps, chairs, gapTo,
//               sources, venueSizeOk, analyze, uid, toPercentBox,
//               chairVenues } — the tables that survived, the chair
//             associations, the objects the surface filter turned away, the
//             object sources and the detector's own size test, shape analyser
//             and constructors.
//   OUT       { columnComps, mergedRowVenues, venues } — the column family
//             (four independent facts must agree), the venue-scale blobs that
//             were really a row of tables, and the venue list: unnamed bands,
//             columns, then the unseated chairs.
//   MUTATES   via `analyze`, the kept venue components' cached shape — the
//             same objects, exactly as before the move.
//   FAILS     never.
//   TEST OWNER `benchmarks/detector-fingerprint.mjs` (28 plans,
//             byte-identical), the adversarial-architecture fixture (six
//             columns by construction), `structural-objects`.
(() => {
  "use strict";
  const GEO = globalThis.MeritPlanGeometry;

  function venueScaleObjects(input) {
    const { chosen, chairAssign, surfaceRejectedComps, chairs, gapTo, sources,
      venueSizeOk, analyze, uid, toPercentBox, chairVenues } = input;
    // ---- venue-scale objects (stage band / long bar / column) ------------
    // ---- columns and structural repeats -----------------------------------
    // A candidate the surface filter turned away is not a table: it is not
    // made of the material this plan draws tables with. That is a real and
    // useful verdict, and until now it ended the object's life. On a plan
    // that has columns, those are precisely the objects — solid, repeated,
    // compact, standing on a structural grid, and never seated at.
    //
    // Measured on benchmarks/fixtures/adversarial-architecture.png, whose six
    // columns are exact by construction: all six reach de-duplication, all
    // six score 0.000 surface coverage against the table tint, and all six
    // were then discarded. The fixture scored column recall 0.000 while
    // scoring 10 of 10 tables perfectly.
    //
    // A column is not "a small rectangle". Four independent facts have to
    // agree, and no single one of them is allowed to carry the decision:
    //
    //   the family repeats     3 or more members at one size
    //   it is compact          not a wall, not a line of text
    //   nobody sits at it      no chair anywhere near it
    //   it stands on a GRID    members share a row AND a column with other
    //                          members — which is what a structural grid is
    //
    // The last one has to be both axes, and that was measured the hard way:
    // "shares a row or a column" is satisfied by a line of text by
    // construction, and it put 26 false columns on the text fixture and 13 on
    // the dense one. A word is aligned in one direction. A column grid is
    // aligned in two, because the building's structure repeats across the
    // floor as well as along it.
    //
    // Together these are why this does not invent columns on the real venue
    // plan — whose annotation deliberately records that none are
    // identifiable there.
    const COLUMN_MIN_MEMBERS=3,COLUMN_MAX_ASPECT=1.6,COLUMN_ALIGN_SHARE=.5;
    const columnComps=(()=>{
      // "Nobody sits at it" has to mean nobody sits at it — not "no seat
      // happens to pass nearby". A column standing in a room full of tables
      // is surrounded by other people's chairs, and on the architecture
      // fixture exactly that killed C5: a seat belonging to a round table two
      // feet away came within 28px, and a column that six other facts agreed
      // about was thrown out for it. A chair the associator already seated at
      // a table that survived to `chosen` is spoken for, and its proximity
      // says nothing about this object. Only unclaimed seats count.
      const chosenTableIndexes=new Set(chosen.map(s=>s.box.index));
      const seatedAtRealTable=ci=>chosenTableIndexes.has(chairAssign.get(ci));
      const seatless=surfaceRejectedComps.filter(c=>{
        const aspect=Math.max(c.w,c.h)/Math.max(1,Math.min(c.w,c.h));
        if(aspect>COLUMN_MAX_ASPECT)return false;
        const reach=Math.max(c.w,c.h)*.7;
        return !chairs.some((ch,ci)=>!seatedAtRealTable(ci)&&gapTo(c,ch)<=reach);
      });
      if(seatless.length<COLUMN_MIN_MEMBERS)return[];
      // "One size" as a RELATION between members, not as a grid laid over the
      // number line.
      //
      // The chair pass keys families by round(log(size)/log(1.18)), and that
      // key has a boundary problem this fixture shows exactly: its four
      // square columns measure 42 across and its two round ones 40 — a 5%
      // difference, well inside the 18% the key is meant to tolerate — but 40
      // and 42 fall either side of a bin edge. The six columns of one
      // structural grid were split into a family of four and a family of two,
      // and the pair died on the member floor. Recall 4/6 with precision
      // 1.000 was a bin edge, not a detector limit.
      //
      // Same tolerance, expressed as "no member is more than 18% larger than
      // the next smaller one": sort by size and cut wherever that gap opens.
      // There is no boundary to sit on, because the comparison is always
      // between two real objects.
      const COLUMN_SIZE_RATIO=1.18;
      const sized=seatless.map(c=>({c,s:Math.sqrt(c.w*c.h)})).sort((a,b)=>a.s-b.s);
      const groups=[];
      let run=[];
      for(const it of sized){
        if(run.length&&it.s>run[run.length-1].s*COLUMN_SIZE_RATIO){groups.push(run.map(x=>x.c));run=[];}
        run.push(it);
      }
      if(run.length)groups.push(run.map(x=>x.c));
      const out=[];
      for(const members of groups){
        if(members.length<COLUMN_MIN_MEMBERS)continue;
        const tol=Math.max(4,members.reduce((n,c)=>n+Math.max(c.w,c.h),0)/members.length*.25);
        const centre=c=>[c.x+c.w/2,c.y+c.h/2];
        // Coordinate REUSE on both axes, measured over the family. Asking
        // each member to share both a row and a column with someone is the
        // same idea but breaks as soon as the grid is only partly detected:
        // with four of this fixture's six columns found, only one member has
        // both a row-partner and a column-partner and the family scored zero.
        const sharesOn=(get)=>members.filter(c=>{
          const v=get(centre(c));
          return members.some(o=>o!==c&&Math.abs(v-get(centre(o)))<=tol);
        }).length/members.length;
        const rowShare=sharesOn(p=>p[1]),columnShare=sharesOn(p=>p[0]);
        if(rowShare>=COLUMN_ALIGN_SHARE&&columnShare>=COLUMN_ALIGN_SHARE)out.push(...members);
      }
      return out;
    })();
    const venueComps=[];
    for(const s of sources)for(const c of s.all)if(venueSizeOk(c)&&!venueComps.some(o=>GEO.boxIoU(o,c)>=.5))venueComps.push(c);
    // A venue-scale blob that geometrically CONTAINS several detected tables
    // is not a stage -- it is the merged blob those tables were cut out of.
    // Measured on the dense fixture: three 511x102 "stages" at aspect 5.0,
    // each of which was exactly one row of six tables plus their seats. This
    // needs no threshold: either real table centres sit inside the box or
    // they do not.
    const tableCentres=chosen.map(s=>({cx:s.obb.cx,cy:s.obb.cy}));
    const containedTables=c=>tableCentres.filter(t=>
      t.cx>=c.x&&t.cx<=c.x+c.w&&t.cy>=c.y&&t.cy<=c.y+c.h).length;
    const mergedRowVenues=venueComps.filter(c=>containedTables(c)>=2);
    const venueCompsKept=venueComps.filter(c=>containedTables(c)<2);
    const columnVenues=columnComps.slice(0,40).map(c=>{
      const obb=c.shape?.obb||{cx:c.x+c.w/2,cy:c.y+c.h/2,w:c.w,h:c.h,rotation:c.pcaRotation||0};
      return{id:uid("candidate"),kind:"venue",type:"column",...toPercentBox(obb),
        rotation:obb.rotation,confidence:.55,status:"unreviewed",selected:false,chairDetections:[],
        evidence:{geometry:.6,chairs:0,repetition:columnComps.length,source:c.source||"structural",
          basis:"repeated compact object, aligned on a structural grid, no seating"}};
    });
    let venues=venueCompsKept.slice(0,14).map(c=>{
      analyze([c],sources.find(s=>s.all.includes(c)).labels);
      const obb=c.shape?.obb||{cx:c.x+c.w/2,cy:c.y+c.h/2,w:c.w,h:c.h,rotation:c.pcaRotation||0};
      // These objects are NOT given a name.
      //
      // The type used to be a bare aspect-ratio guess: longer than 3:1 meant
      // stage, compact meant column. Phase 4 stopped a zone built on that
      // guess being reported as STRONG, which removed the fabricated
      // certainty but not the fabrication — the claim was still made, just
      // more quietly.
      //
      // Measured over both real plans, the rule names 8 objects `stage`:
      //
      //   merit-real-venue  aspect 6.00, 7.93   — 2 stage objects annotated
      //   ornek-symbolic    aspect 2.80, 4.55, 5.43, 6.08, 8.97, 31.17
      //                                         — 0 stage objects annotated
      //
      // Two right and six wrong, and the two right ones sit INSIDE the range
      // of the six wrong ones. Aspect cannot be retuned to separate them,
      // and neither can the other axes measured beside it — object size
      // (10.9-13.4% of the plan against 12.9-13.1%), how many look-alike
      // siblings the object has (0-2 against 0-1), or how much furniture
      // faces it. Every one of them overlaps.
      //
      // So a long band with nothing else known about it is left unnamed. Its
      // shape is recorded, its basis is recorded, and it is reported as an
      // area that could not be identified. That is a real cost, honestly: the
      // Golden Plan's stage is genuine and is no longer named. It buys the
      // removal of six false ones, and it stops a 25%-precision label being
      // presented to an operator as a finding.
      //
      // What WOULD corroborate it is the drawing's own word for it — the
      // Golden Plan prints "SAHNE" beside its stage, and ORNEK prints nothing
      // beside any of its six bands. That needs OCR, which this sandbox
      // cannot run in the normal build (see benchmarks/CAPACITY-AS-A-RULE.md
      // for what happened last time a rule was built where no benchmark could
      // reach it), so it is recorded as the way forward and not written blind.
      //
      // Columns are unaffected: they are detected separately by the column
      // pass above, which requires four independent facts to agree (repeated
      // family, compact, unseated, standing on a two-axis grid) and scores
      // 6 of 6 with no false positives on the architecture fixture. That
      // pass is what a corroborated structural claim looks like; this is
      // what an uncorroborated one looks like.
      return{id:uid("candidate"),kind:"venue",type:"other",typeBasis:"aspectRatio",
        shapeSuggests:c.aspect>3?"band":"block",...toPercentBox(obb),
        rotation:obb.rotation,confidence:.52,status:"unreviewed",selected:false,chairDetections:[],
        evidence:{geometry:.62,chairs:0,repetition:0,source:c.source||"fill",
          basis:"a shape with no corroborating evidence of what it is"}};
    }).concat(columnVenues).concat(chairVenues);
    return { columnComps, mergedRowVenues, venues };
  }

  globalThis.MeritPlanVenueObjects = { version: 1, venueScaleObjects };
})();
