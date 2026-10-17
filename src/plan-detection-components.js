// FROM A MASK TO OBJECTS: connected components, enclosed regions, solidity.
//
// Split A-3 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`, moved out of
// `src/plan-detection-classical.js` verbatim — but NOT the whole group.
//
// WHAT STAYED BEHIND, AND WHY. The map's A-3 opens with `buildClassMasks`,
// and that function calls `rgbBinIndex`, which belongs to A-2's colour model.
// A-2 was already measured as unavailable: its `RGB_*` and `*_CHROMA`
// constants are used on both sides of any cut, because `detect()`'s own pixel
// loop bins and thresholds chroma directly. So `buildClassMasks` travels with
// the colour work rather than with the component labeller, and A-3 splits
// into the part that is about PIXELS-TO-OBJECTS and the part that is about
// WHICH PIXELS. Measured after that split: outward crossings ZERO.
//
// THE MODULE-LEVEL BUFFER IS THE REASON THIS GROUP WAS RATED MEDIUM.
// `SCRATCH_QUEUE` is a single Int32Array reused across every call — the flood
// fill needs a work queue the size of the image, and allocating one per
// component would dominate the cost on a large plan. The map's warning was
// exact: "moving the labeller without the buffer would silently reallocate
// per call". It is silent because nothing about the OUTPUT changes; only the
// time does, and no correctness test would notice.
//
// So the buffer and its allocator move together and stay PRIVATE — neither is
// published — and `plan-detection-boundary` asserts the property directly:
// `SCRATCH_QUEUE` is declared at module level, and `scratchQueue` grows it
// rather than replacing it.
(function () {
  "use strict";

  // A real solidity measure (4-neighbour erosion survival). A genuine filled
  // object survives erosion; a 1px antialiasing halo along an outline does
  // not. This is what stops a "tint" family that is really just edge fringing
  // from being used as an object source.
  function maskSolidity(mask,width,height){
    let on=0,solid=0;
    for(let y=1;y<height-1;y+=2)for(let x=1;x<width-1;x++){ // every other row: this is a ratio, not a count
      const i=y*width+x;if(!mask[i])continue;on++;
      if(mask[i-1]&&mask[i+1]&&mask[i-width]&&mask[i+width])solid++;
    }
    return on?solid/on:0;
  }
  // FIX #2, part 1: enclosed-interior extraction. Tables on a CAD-style plan
  // are drawn as thin OUTLINES. Labelling the ink itself fuses two tables that
  // share or touch an outline into one component whose bbox spans both — the
  // "one table detected in the middle of two tables" report. The interior of
  // each closed outline, however, is a separate region: flood the background
  // in from the image border and whatever is left unreached (and not ink) is
  // enclosed by something. A shared outline still separates the two interiors,
  // so adjacent tables stay two objects. It also makes a chair drawn ON TOP OF
  // a table outline harmless: it cannot leak into the interior.
  function enclosedRegions(barrier,width,height){
    const reached=new Uint8Array(barrier.length),stack=scratchQueue(barrier.length);
    let sp=0;
    const seed=i=>{if(!barrier[i]&&!reached[i]){reached[i]=1;stack[sp++]=i;}};
    for(let x=0;x<width;x++){seed(x);seed((height-1)*width+x);}
    for(let y=0;y<height;y++){seed(y*width);seed(y*width+width-1);}
    // Span/scanline flood rather than per-pixel: the background of a floor plan
    // is most of the image, and pushing every background pixel individually was
    // the single most expensive step in the pass. Each pop fills a whole run and
    // seeds only the FIRST open pixel of each run in the rows above and below.
    while(sp){
      const p=stack[--sp],y=(p/width)|0,rowStart=y*width,rowEnd=rowStart+width-1;
      let l=p;while(l>rowStart&&!barrier[l-1]&&!reached[l-1]){l--;reached[l]=1;}
      let r=p;while(r<rowEnd&&!barrier[r+1]&&!reached[r+1]){r++;reached[r]=1;}
      if(y>0){
        let run=false;
        for(let q=l-width;q<=r-width;q++){
          if(barrier[q]||reached[q]){run=false;continue;}
          if(!run){reached[q]=1;stack[sp++]=q;run=true;}
        }
      }
      if(y<height-1){
        let run=false;
        for(let q=l+width;q<=r+width;q++){
          if(barrier[q]||reached[q]){run=false;continue;}
          if(!run){reached[q]=1;stack[sp++]=q;run=true;}
        }
      }
    }
    // Inverted in place (enclosed = not ink, not reachable from the border)
    // rather than into a second full-size array.
    for(let i=0;i<reached.length;i++)reached[i]=(!barrier[i]&&!reached[i])?1:0;
    return reached;
  }
  // One shared BFS work queue. Each labelling pass used to allocate (and
  // zero-fill) 4 bytes per pixel just to throw it away; the queue is always
  // written before it is read, so it can be reused across passes.
  let SCRATCH_QUEUE=null;
  function scratchQueue(size){
    if(!SCRATCH_QUEUE||SCRATCH_QUEUE.length<size)SCRATCH_QUEUE=new Int32Array(size);
    return SCRATCH_QUEUE;
  }
  function labelComponents(mask,width,height,minPixels,connect8){
    const labels=new Int32Array(mask.length),queue=scratchQueue(mask.length),comps=[];
    let label=0;
    for(let start=0;start<mask.length;start++){
      if(!mask[start]||labels[start])continue;
      label++;
      let head=0,tail=0,count=0,minX=width,minY=height,maxX=0,maxY=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;
      queue[tail++]=start;labels[start]=label;
      while(head<tail){
        const p=queue[head++],x=p%width,y=(p/width)|0;
        count++;
        if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
        sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;
        const left=x>0,right=x<width-1,up=y>0,down=y<height-1;
        if(left&&mask[p-1]&&!labels[p-1]){labels[p-1]=label;queue[tail++]=p-1;}
        if(right&&mask[p+1]&&!labels[p+1]){labels[p+1]=label;queue[tail++]=p+1;}
        if(up&&mask[p-width]&&!labels[p-width]){labels[p-width]=label;queue[tail++]=p-width;}
        if(down&&mask[p+width]&&!labels[p+width]){labels[p+width]=label;queue[tail++]=p+width;}
        if(connect8){
          if(left&&up&&mask[p-width-1]&&!labels[p-width-1]){labels[p-width-1]=label;queue[tail++]=p-width-1;}
          if(right&&up&&mask[p-width+1]&&!labels[p-width+1]){labels[p-width+1]=label;queue[tail++]=p-width+1;}
          if(left&&down&&mask[p+width-1]&&!labels[p+width-1]){labels[p+width-1]=label;queue[tail++]=p+width-1;}
          if(right&&down&&mask[p+width+1]&&!labels[p+width+1]){labels[p+width+1]=label;queue[tail++]=p+width+1;}
        }
      }
      if(count<minPixels)continue;
      const w=maxX-minX+1,h=maxY-minY+1,mx=sx/count,my=sy/count;
      const covXX=sxx/count-mx*mx,covYY=syy/count-my*my,covXY=sxy/count-mx*my;
      comps.push({label,x:minX,y:minY,w,h,count,aspect:w/h,fill:count/(w*h),cx:mx,cy:my,
        pcaRotation:.5*Math.atan2(2*covXY,covXX-covYY)*180/Math.PI});
    }
    return{labels,comps};
  }

  globalThis.MeritPlanComponents = {
    version: 1, maskSolidity, enclosedRegions, labelComponents,
  };
})();
