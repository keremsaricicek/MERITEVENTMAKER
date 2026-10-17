// TWO OBJECTS THAT MERGED INTO ONE BLOB, SEPARATED ONLY WHERE THE PIXELS SAY SO.
//
// Split A-8 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`, moved out of
// `src/plan-detection-classical.js` verbatim. Two filled tables touching with
// no drawn separator arrive as one component, and hole filling cannot help:
// there is no hole. The split is made where the pixel profile shows a real
// density valley AND every resulting part lands near the modal object size —
// never "this looks twice as big, cut it in half".
//
// THE CROSSING ANALYSIS (`scripts/crossing-analysis.mjs`):
//
//   OUTWARD   ZERO. The region is closed over its own arguments; the modal
//             sizes it judges parts against arrive as parameters, which is
//             what keeps it honest about not inventing a boundary.
//   INWARD    `splitAtValley`, two references.
//   PRIVATE   `splitAlongAxis`, called only by `splitAtValley`.
//
// The private half is the point worth noting: a name that was top-level in a
// three-thousand-line file is now genuinely internal to the one function that
// uses it, which no amount of moving lines around achieves on its own.
//
// THE RISK HERE IS DIFFERENT FROM THE OTHER GROUPS. This one changes the
// OBJECT COUNT, so a mistake moves every number downstream of it — the map
// rates it MEDIUM for exactly that reason. `mergesSplit` in the detection
// diagnostics is what makes the change visible, and the golden plan's 63
// split pairs out of 241 components is what a regression would move.
(function () {
  "use strict";

  // ---- FIX #3: a modal-size prior instead of "biggest area first" ---------
  // A venue plan is highly repetitive, so the population itself says what a
  // table is. The mode is taken in log space (constant RELATIVE bin width) so
  // it is scale-free, and the peak bin plus its two neighbours are averaged so
  // one bin boundary cannot swing the answer. Ranking by agreement with the
  // mode means a merged double-table blob (~2x modal) is demoted, where the
  // old "sort by area, cap 100" actively promoted it.
  // FIX #2, part 2: an evidence-gated split for blobs that really did merge
  // (two filled tables touching with no drawn separator, which hole filling
  // cannot help with). A split is only made where the pixels actually show a
  // density valley AND both halves land near the modal object size — never
  // "this looks twice as big, cut it in half".
  // Cut one axis of a blob wherever the pixel profile shows a real valley, and
  // only when every resulting part is a clean repeat of the modal object. A
  // valley that does not produce modal-sized parts is not a table boundary, and
  // inventing one is worse than leaving the blob merged.
  function splitAlongAxis(comp,labels,width,height,horizontal,modalSpan,modalAcross){
    if(!modalSpan||!modalAcross)return null;
    const long=horizontal?comp.w:comp.h,short=horizontal?comp.h:comp.w;
    if(long<modalSpan*1.7||short<modalAcross*.55)return null;
    const n=horizontal?comp.w:comp.h,across=horizontal?comp.h:comp.w,profile=new Int32Array(n);
    for(let a=0;a<across;a++)for(let b=0;b<n;b++){
      const gx=horizontal?comp.x+b:comp.x+a,gy=horizontal?comp.y+a:comp.y+b;
      if(gx<width&&gy<height&&labels[gy*width+gx]===comp.label)profile[b]++;
    }
    let sum=0;for(let i=0;i<n;i++)sum+=profile[i];
    const mean=sum/n,floor=mean*.35,guard=Math.round(modalSpan*.45),cuts=[];
    let runStart=-1;
    for(let i=guard;i<n-guard;i++){
      if(profile[i]<=floor){if(runStart<0)runStart=i;}
      else if(runStart>=0){cuts.push(Math.round((runStart+i-1)/2));runStart=-1;}
    }
    if(runStart>=0)cuts.push(Math.round((runStart+n-guard)/2));
    if(!cuts.length)return null;
    const bounds=[0,...cuts,n],parts=[];
    for(let i=0;i<bounds.length-1;i++){
      const from=bounds[i],to=bounds[i+1],len=to-from;
      if(len<modalSpan*.55||len>modalSpan*1.6)return null; // not a clean repeat of the modal object: leave the blob alone rather than inventing a boundary
      parts.push({from,to});
    }
    if(parts.length<2)return null;
    return parts.map(p=>{
      let count=0,minX=width,minY=height,maxX=0,maxY=0;
      for(let a=0;a<across;a++)for(let b=p.from;b<p.to;b++){
        const gx=horizontal?comp.x+b:comp.x+a,gy=horizontal?comp.y+a:comp.y+b;
        if(gx>=width||gy>=height||labels[gy*width+gx]!==comp.label)continue;
        count++;
        if(gx<minX)minX=gx;if(gx>maxX)maxX=gx;if(gy<minY)minY=gy;if(gy>maxY)maxY=gy;
      }
      if(!count)return null;
      const w=maxX-minX+1,h=maxY-minY+1;
      return{label:comp.label,x:minX,y:minY,w,h,count,aspect:w/h,fill:count/(w*h),
        cx:(minX+maxX)/2,cy:(minY+maxY)/2,pcaRotation:comp.pcaRotation,wasSplit:true};
    }).filter(Boolean);
  }
  // Tables in a banquet plan are laid out in GRIDS, not just rows: on the real
  // venue plan the fused blobs measured about 1.5 x 2 and 1 x 3 modal tables.
  // A single-axis cut cannot separate those -- it used to refuse outright the
  // moment a blob was wider than one table across, which is why the split pass
  // never fired on a real plan. So cut the long axis first, then try the other
  // axis inside each strip. Both passes keep the "every part must be a clean
  // repeat of the modal object" rule, so a blob that is not a grid of tables is
  // still left alone rather than carved into invented objects.
  function splitAtValley(comp,labels,width,height,modalLong,modalShort){
    if(!modalLong||!modalShort)return null;
    const first=comp.w>=comp.h;
    const strips=splitAlongAxis(comp,labels,width,height,first,modalLong,modalShort)
      ||splitAlongAxis(comp,labels,width,height,!first,modalShort,modalLong);
    const stage1=strips||[comp];
    const out=[];
    for(const strip of stage1){
      const across=strip.w>=strip.h;
      // Cut the perpendicular axis of each strip. Spans are swapped because a
      // strip's long side is now roughly one modal table.
      const cells=splitAlongAxis(strip,labels,width,height,across,
        across?modalLong:modalShort, across?modalShort:modalLong);
      if(cells&&cells.length>1)out.push(...cells);
      else out.push(strip);
    }
    if(out.length<2)return null;
    // Never return the untouched original dressed up as a split.
    return out.length===1&&out[0]===comp?null:out.map(c=>c===comp?c:{...c,wasSplit:true});
  }

  globalThis.MeritPlanSplit = { version: 1, splitAtValley };
})();
