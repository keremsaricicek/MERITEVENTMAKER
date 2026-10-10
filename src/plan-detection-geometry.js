// THE FOUR GEOMETRY ANSWERS THE DETECTOR KEEPS ASKING.
//
// Split A-4 and A-9 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.map`, moved
// out of `src/plan-detection-classical.js` verbatim. They are the lowest-risk
// group in that file and the map says why: pure functions of their arguments,
// no state, no DOM, no pixels — `minAreaRect` reads two coordinate arrays and
// the other three read boxes.
//
// THE CROSSING ANALYSIS, which is what makes a structural move safe here
// rather than hopeful. Measured in stripped code with `tests/lib/js-scan.mjs`
// across every file in `src/` and `index.html`:
//
//   OUTWARD (what this region read from the file's scope)   ZERO.
//   Every identifier in all four bodies is a parameter, a local, or `Math`.
//
//   INWARD (what the file reads from this region)           FOUR NAMES,
//   which are exactly the four published below — and nothing else in `src/`
//   or in `index.html` referenced any of them, so this move adds one name to
//   the app's vocabulary rather than four.
//
// The counts, including each definition: `minAreaRect` 2, `sameObject` 7,
// `boxIoU` 3, `distanceToOBB` 2. Every declarator on every comma-separated
// line was counted, because missing the third name on a four-name line is
// what shipped a `ReferenceError` into every real detection the first time
// this file was split.
//
// `plan-detection-classical.js` reaches these through the one published
// object and never through a local alias sharing a name with an internal —
// that is the rule that keeps "did we reach past the boundary?" answerable.
(function () {
  "use strict";

  // The REAL minimum-area rectangle, never forced axis-aligned. A table drawn
  // at an angle is a table at an angle, and `.claude/rules/ai.md` requires the
  // orientation to survive detection rather than be rounded away.
  function minAreaRect(pointsX,pointsY){
    const n=pointsX.length;
    if(n<3)return null;
    const step=Math.max(1,Math.ceil(n/220)),xs=[],ys=[];
    for(let i=0;i<n;i+=step){xs.push(pointsX[i]);ys.push(pointsY[i]);}
    const measure=deg=>{
      const rad=deg*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
      let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
      for(let i=0;i<xs.length;i++){
        const u=xs[i]*cos+ys[i]*sin,v=-xs[i]*sin+ys[i]*cos;
        if(u<minU)minU=u;if(u>maxU)maxU=u;if(v<minV)minV=v;if(v>maxV)maxV=v;
      }
      const w=maxU-minU+1,h=maxV-minV+1;
      return{deg,cos,sin,w,h,area:w*h,cu:(minU+maxU)/2,cv:(minV+maxV)/2};
    };
    const axis=measure(0);
    let best=axis;
    for(let deg=3;deg<90;deg+=3){const m=measure(deg);if(m.area<best.area)best=m;}
    for(let deg=best.deg-2;deg<=best.deg+2;deg++){
      if(deg===best.deg||deg<0||deg>=90)continue;
      const m=measure(deg);if(m.area<best.area)best=m;
    }
    if(axis.area<=best.area*1.03)best=axis;
    let w=best.w,h=best.h,rotation=best.deg;
    if(rotation>45){const swap=w;w=h;h=swap;rotation-=90;} // keep rotation in (-45,45]; same physical rectangle
    return{cx:best.cu*best.cos-best.cv*best.sin,cy:best.cu*best.sin+best.cv*best.cos,w,h,rotation};
  }

  // "Are these two boxes the SAME physical object?" — overlap measured against
  // the smaller box (two masks rarely agree on the exact extent of one object)
  // AND a size sanity check, because a chair sitting inside a table's bounding
  // box also overlaps it completely without being the same object.
  //
  // NOT the same question as `boxIoU`, and `benchmarks/CODE-INVENTORY.md` §2.2
  // records why the two must never be merged: intersection-over-minimum plus a
  // size guard answers "same object?", intersection-over-union answers "how
  // much do these agree?", and the detector needs both. Moving them into one
  // file is exactly when someone would notice they look alike; they are here
  // together so the reason not to is here too.
  function sameObject(a,b,sizeRatio=2.5){
    const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y);
    const x2=Math.min(a.x+a.w,b.x+b.w),y2=Math.min(a.y+a.h,b.y+b.h);
    const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1);
    if(!inter)return false;
    const areaA=a.w*a.h,areaB=b.w*b.h;
    return inter/Math.min(areaA,areaB)>.5&&Math.max(areaA,areaB)<=Math.min(areaA,areaB)*sizeRatio;
  }
  function boxIoU(a,b){
    const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y);
    const x2=Math.min(a.x+a.w,b.x+b.w),y2=Math.min(a.y+a.h,b.y+b.h);
    const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1);
    if(!inter)return 0;
    return inter/(a.w*a.h+b.w*b.h-inter);
  }
  // Distance from a point to an oriented rectangle's boundary (0 when inside).
  function distanceToOBB(px,py,obb){
    const rad=(obb.rotation||0)*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
    const dx=px-obb.cx,dy=py-obb.cy;
    const u=Math.abs(dx*cos+dy*sin)-obb.w/2,v=Math.abs(-dx*sin+dy*cos)-obb.h/2;
    return Math.hypot(Math.max(0,u),Math.max(0,v));
  }

  globalThis.MeritPlanGeometry = {
    version: 1, minAreaRect, sameObject, boxIoU, distanceToOBB,
  };
})();
