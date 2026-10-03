// THE DETECTOR'S FIRST TWO STAGES: WHAT THE PIXELS ARE, AND WHAT IS INK.
//
// Split B, stages B-1 and B-2 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`,
// moved out of `detect()` in `src/plan-detection-classical.js` verbatim. They
// were chosen first because they consume nothing but pixels and hand forward
// well-defined arrays — the map's stated order. Each stage's contract:
//
// measurePixels(data, width, height)                                  B-1
//   IN        RGBA bytes of the plan, its width and height.
//   OUT       { gray, threshold, binCount, binR, binG, binB, sampled,
//               lumaLowChroma, lumaMidChroma } — the luma image, the Otsu ink
//             threshold, and the colour model's inputs (a fixed 2x2 subsample).
//   OWNS      its luma histogram and running sum; neither escapes.
//   CONSUMERS binarize (gray, threshold), the colour model (bins, sampled,
//             chroma-split luma histograms), every later stage (gray, threshold).
//   FAILS     never: pure arithmetic over the bytes it is given.
//
// binarize(gray, width, height, threshold)                            B-2
//   IN        the luma image and the ink threshold from B-1.
//   OUT       { fillMask, barrier } — the adaptive fill mask that is labelled,
//             and fill ∪ edges, the barrier for enclosed regions and the union
//             computeVisualDescriptor reads.
//   OWNS      the Sobel edge mask, the integral image and its stride; none
//             escapes. The edge map is deliberately NOT OR-ed into the
//             labelled mask (FIX #2): that fused adjacent tables into one.
//   CONSUMERS the object sources (interiors, fill mask) and the descriptor.
//   FAILS     never.
//
// TEST OWNER: `benchmarks/detector-fingerprint.mjs` (the whole output, 28
// plans, byte-identical across the move), `npm run benchmark:baseline`, and
// the suites that run real detection.
(() => {
  "use strict";
  const TONE = globalThis.MeritPlanTone;
  const DESKEW = globalThis.MeritPlanDeskew;

  function measurePixels(data, width, height) {
    const total = width * height;
    // ---- pass 1: luma + histogram + RGB colour histogram, one loop ----
    const gray=new Uint8Array(total),hist=new Uint32Array(256);
    // The colour model is a global statistic, so it is built from a fixed 2x2
    // subsample (deterministic, ~25% of the pixels) instead of every pixel.
    const binCount=new Uint32Array(TONE.RGB_BINS),binR=new Uint32Array(TONE.RGB_BINS),binG=new Uint32Array(TONE.RGB_BINS),binB=new Uint32Array(TONE.RGB_BINS);
    // Luma histograms split by how saturated the pixel is, so the tone model
    // can look at the drawing's fills without the accent objects skewing it.
    const lumaLowChroma=new Uint32Array(256),lumaMidChroma=new Uint32Array(256);
    let sum=0,sampled=0;
    for(let y=0;y<height;y++){
      const rowSampled=(y&1)===0;
      for(let x=0,i=y*width,o=i*4;x<width;x++,i++,o+=4){
        const r=data[o],g=data[o+1],b=data[o+2];
        const v=Math.round(r*.299+g*.587+b*.114);
        gray[i]=v;hist[v]++;sum+=v;
        if(rowSampled&&(x&1)===0){
          const bin=TONE.rgbBinIndex(r,g,b);
          binCount[bin]++;binR[bin]+=r;binG[bin]+=g;binB[bin]+=b;sampled++;
          const chroma=Math.max(r,g,b)-Math.min(r,g,b);
          if(chroma<TONE.LOW_CHROMA)lumaLowChroma[v]++;else if(chroma<TONE.MID_CHROMA)lumaMidChroma[v]++;
        }
      }
    }
    const threshold=DESKEW.otsu(hist,total,sum);
    return { gray, threshold, binCount, binR, binG, binB, sampled, lumaLowChroma, lumaMidChroma };
  }

  function binarize(gray, width, height, threshold) {
    const total = width * height;
    // ---- pass 2: adaptive fill mask and Sobel edge map, kept SEPARATE ----
    // FIX #2: the edge map is no longer OR-ed into the mask that gets
    // labelled. It is used only as a BARRIER for enclosed-region extraction
    // (where a shared outline helps by separating two interiors) and as the
    // union mask handed to computeVisualDescriptor, whose descriptor
    // semantics stay exactly as before.
    const fillMask=new Uint8Array(total),edgeMask=new Uint8Array(total),barrier=new Uint8Array(total);
    const integral=new Uint32Array((width+1)*(height+1));
    for(let y=1;y<=height;y++){let row=0;for(let x=1;x<=width;x++){row+=gray[(y-1)*width+x-1];integral[y*(width+1)+x]=integral[(y-1)*(width+1)+x]+row;}}
    const stride=width+1;
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const i=y*width+x,r=18,x0=Math.max(0,x-r),x1=Math.min(width-1,x+r),y0=Math.max(0,y-r),y1=Math.min(height-1,y+r);
      const local=(integral[(y1+1)*stride+x1+1]-integral[y0*stride+x1+1]-integral[(y1+1)*stride+x0]+integral[y0*stride+x0])/((x1-x0+1)*(y1-y0+1));
      const gx=-gray[i-width-1]+gray[i-width+1]-2*gray[i-1]+2*gray[i+1]-gray[i+width-1]+gray[i+width+1];
      const gy=-gray[i-width-1]-2*gray[i-width]-gray[i-width+1]+gray[i+width-1]+2*gray[i+width]+gray[i+width+1];
      if(gray[i]<Math.min(threshold+12,local-7))fillMask[i]=1;
      if(Math.abs(gx)+Math.abs(gy)>150)edgeMask[i]=1;
      barrier[i]=(fillMask[i]||edgeMask[i])?1:0;
    }
    return { fillMask, barrier };
  }

  globalThis.MeritPlanPreprocess = { version: 1, measurePixels, binarize };
})();
