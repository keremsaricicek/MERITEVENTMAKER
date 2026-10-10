// WHAT SHAPE IS THIS, DECIDED FROM REAL PIXELS?
//
// Split A-5 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`, moved out of
// `src/plan-detection-classical.js` verbatim. Round, square or rectangle is
// answered from the component's own filled mask in its OBB frame — never from
// the bounding box's aspect ratio, which calls a circle a square as soon as it
// is drawn inside one.
//
// THE CROSSING ANALYSIS (`scripts/crossing-analysis.mjs`):
//
//   OUTWARD   one name, `GEO` — the handle for `globalThis.MeritPlanGeometry`,
//             which is a dependency on another MODULE and not on the shell.
//             This file binds its own, which is why that reads as a module
//             handle in the report rather than as a cut in the wrong place.
//   INWARD    `shapeAnalysis` and `classifyTableShape`, one reference each.
//   PRIVATE   none.
//
// AND THE MAP WAS WRONG ABOUT THIS GROUP. It recorded A-5's dependency as
// `maskSolidity` (A-3), which would have tied this move to the component
// labeller and its module-level scratch buffer — the one MEDIUM-risk item in
// Split A. Measured: `shapeAnalysis` does not name `maskSolidity` at all. Its
// only dependency is `GEO.minAreaRect`, which had already moved. A map is a
// record of a measurement, not a substitute for taking one again.
(function () {
  "use strict";

  // This module's own handle, bound the same way and for the same reason the
  // pipeline binds one. `boot-contract` enforces that the geometry file loads
  // first; without that, this is `undefined` at the moment it is read.
  const GEO = globalThis.MeritPlanGeometry;

  // ---- Oriented bounding box (real OBB, never forced axis-aligned) --------
  // Rotating-calipers-style minimum-area rectangle over the shape's boundary
  // points. This is the rotation-aware representation merit-plan-intelligence
  // requires: centre x/y, width, height and rotation are measured together and
  // carried end to end. Axis-aligned wins near-ties on purpose — a square or a
  // circle has (near-)equal area at every angle, and printing a spurious 37°
  // tilt for an axis-aligned object would be a fabricated orientation.
  // ---- FIX #4: shape decided from real pixels, not the bbox aspect --------
  // The component is hole-filled locally (flood from the padded window border;
  // whatever the outline encloses becomes solid), then measured in its own OBB
  // frame. `cornerOccupancy` is how much of the four OBB corner squares
  // (|u|>0.72 and |v|>0.72 of the half-extents — a region that lies entirely
  // OUTSIDE an inscribed ellipse and entirely INSIDE a rectangle) is actually
  // covered. A circle leaves them empty; a square fills them. quadrantFill is
  // the same 4-quadrant balance computeVisualDescriptor already produces,
  // measured here on the filled shape so an off-centre/L-shaped object can be
  // told apart from a symmetric one.
  function shapeAnalysis(labels,label,comp,width,height){
    const pad=1,x0=comp.x-pad,y0=comp.y-pad,lw=comp.w+2*pad,lh=comp.h+2*pad;
    if(lw<3||lh<3)return null;
    const loc=new Uint8Array(lw*lh);
    for(let y=0;y<lh;y++){
      const gy=y0+y;if(gy<0||gy>=height)continue;
      for(let x=0;x<lw;x++){
        const gx=x0+x;if(gx<0||gx>=width)continue;
        if(labels[gy*width+gx]===label)loc[y*lw+x]=1;
      }
    }
    const reached=new Uint8Array(lw*lh),stack=new Int32Array(lw*lh);
    let sp=0;
    const push=i=>{if(!loc[i]&&!reached[i]){reached[i]=1;stack[sp++]=i;}};
    for(let x=0;x<lw;x++){push(x);push((lh-1)*lw+x);}
    for(let y=0;y<lh;y++){push(y*lw);push(y*lw+lw-1);}
    while(sp){
      const p=stack[--sp],x=p%lw,y=(p/lw)|0;
      if(x>0)push(p-1);
      if(x<lw-1)push(p+1);
      if(y>0)push(p-lw);
      if(y<lh-1)push(p+lw);
    }
    const filled=new Uint8Array(lw*lh);
    let filledCount=0;
    for(let i=0;i<filled.length;i++)if(loc[i]||!reached[i]){filled[i]=1;filledCount++;}
    const bx=[],by=[];
    for(let y=0;y<lh;y++)for(let x=0;x<lw;x++){
      const i=y*lw+x;if(!filled[i])continue;
      if(x===0||y===0||x===lw-1||y===lh-1||!filled[i-1]||!filled[i+1]||!filled[i-lw]||!filled[i+lw]){bx.push(x0+x);by.push(y0+y);}
    }
    const obb=GEO.minAreaRect(bx,by);
    if(!obb)return null;
    const rad=obb.rotation*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
    const hw=Math.max(1,obb.w/2),hh=Math.max(1,obb.h/2);
    let cornerOn=0,cornerTotal=0,edgeOn=0,edgeTotal=0;
    const quadOn=[0,0,0,0],quadTotal=[0,0,0,0];
    for(let y=0;y<lh;y++)for(let x=0;x<lw;x++){
      const dx=x0+x-obb.cx,dy=y0+y-obb.cy;
      const u=(dx*cos+dy*sin)/hw,v=(-dx*sin+dy*cos)/hh;
      const au=Math.abs(u),av=Math.abs(v);
      if(au>1.02||av>1.02)continue;
      const on=filled[y*lw+x];
      const qi=(u<0?0:1)+(v<0?0:2);quadTotal[qi]++;if(on)quadOn[qi]++;
      if(au>.72&&av>.72){cornerTotal++;if(on)cornerOn++;}
      else if((au<.25&&av>.72)||(av<.25&&au>.72)){edgeTotal++;if(on)edgeOn++;}
    }
    const cornerOccupancy=cornerTotal?cornerOn/cornerTotal:0;
    const edgeOccupancy=edgeTotal?edgeOn/edgeTotal:0;
    return{obb,filledCount,rawCount:comp.count,
      obbFill:filledCount/Math.max(1,obb.w*obb.h),
      cornerOccupancy,edgeOccupancy,
      cornerVsEdge:edgeOccupancy>.02?cornerOccupancy/edgeOccupancy:(cornerOccupancy>.02?1:0),
      quadrantFill:quadTotal.map((n,i)=>n?quadOn[i]/n:0)};
  }
  function classifyTableShape(shape){
    if(!shape)return{type:"rectangle",basis:"no-shape-signal",shapeConfidence:.15};
    const aspect=shape.obb.w/Math.max(1,shape.obb.h);
    const squareish=aspect>=.82&&aspect<=1.22;
    let round,basis;
    if(shape.obbFill>=.5){round=shape.cornerOccupancy<.35;basis="corner-occupancy";}
    else{round=shape.cornerVsEdge<.35;basis="corner-vs-edge-density";} // an outline that never closed, so hole filling could not run
    // A strongly unbalanced quadrant signature is not a simple round table
    // even if the corners read empty (an arc, an L-shaped bench, a stray mark).
    const quads=shape.quadrantFill,spread=Math.max(...quads)-Math.min(...quads);
    if(round&&spread>.45){round=false;basis+="+quadrant-imbalance";}
    const type=round?"round":squareish?"square":"rectangle";
    const margin=round?Math.min(1,(.35-shape.cornerOccupancy)/.35):Math.min(1,(shape.cornerOccupancy-.35)/.4);
    return{type,basis,shapeConfidence:Math.max(.1,Math.min(1,margin)),aspect,squareish};
  }

  globalThis.MeritPlanShape = { version: 1, shapeAnalysis, classifyTableShape };
})();
