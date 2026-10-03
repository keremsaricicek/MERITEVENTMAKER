// STRAIGHTENING THE PAGE, AND THE THRESHOLD THAT DECIDES WHAT IS INK.
//
// Split A-1 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`, moved out of
// `src/plan-detection-classical.js` verbatim. A scan is never quite square to
// the page, and this pipeline is unusually sensitive to that: before deskew
// existed, armchair recall on the rotate variants fell from 1.000 to 0.823.
//
// THE CROSSING ANALYSIS (`scripts/crossing-analysis.mjs`):
//
//   OUTWARD   ZERO.
//   INWARD    `otsu` (the binarize stage) and `estimatePlanSkew` (the
//             provider's own surface).
//   PRIVATE   `SKEW_MAX_DEG`, `SKEW_STEP`, `SKEW_MIN_DEG`, `SKEW_MIN_GAIN`.
//
// THOSE FOUR PRIVATE NAMES ARE THE ONES. They are declared on a single
// comma-separated line, and the first attempt at extracting this pipeline
// captured only the first of them — so `SKEW_MIN_DEG` stayed in the shell
// while its value moved, and every REAL detection threw `ReferenceError`
// while the syntax checks, `smoke` and all four structural suites passed.
// They are now entirely inside the module that uses them, which is where the
// original mistake would have put them.
//
// THE ONLY PART OF THE DETECTOR THAT TOUCHES THE DOM. `estimatePlanSkew`
// needs a canvas 2D context to re-render the page at trial angles. The map
// called that out as the one caveat on this group, and the reason is
// forward-looking: a worker-based detector cannot use a DOM canvas, and that
// problem is better solved in one small file than inside a three-thousand-line
// one.
//
// SEPARATELY: `src/plan-embedding.js` has its own `otsu`, and it is NOT this
// one. That one takes raw pixels and builds its own histogram from a 32x32
// crop; this one takes a histogram the caller already has, because `detect()`
// builds luma and colour histograms in a single pass over the image and
// re-walking it would undo that. Same algorithm, two different input
// contracts. Recorded in `benchmarks/CODE-INVENTORY.md`; not merged here,
// because a structural move is not the place to decide a duplication
// question.
(function () {
  "use strict";

  function otsu(hist,total,sum){let bg=0,bgSum=0,best=-1,threshold=150;for(let value=0;value<256;value++){bg+=hist[value];if(!bg)continue;const fg=total-bg;if(!fg)break;bgSum+=value*hist[value];const score=bg*fg*((bgSum/bg)-((sum-bgSum)/fg))**2;if(score>best){best=score;threshold=value;}}return threshold;}
  // ---- deskew -------------------------------------------------------------
  // A scan is never quite square to the page, and this pipeline is unusually
  // sensitive to that: almost every gate upstream of the oriented box uses the
  // AXIS-ALIGNED width and height of a component. Three degrees inflates the
  // box of an elongated object and changes its measured elongation, which moves
  // it into a different size-and-shape family — so one chair family splits into
  // several under-supported ones and each is then too small to be admitted.
  // Measured on the rotate variants before this existed: armchair recall fell
  // from 1.000 to 0.823 and review groups went from 12 to 35 and 41.
  //
  // Correcting the image once fixes every one of those gates at the same time,
  // which is why this is a deskew and not a rotation-tolerance rule in each of
  // them.
  //
  // Estimated by projection profile: rotate the ink by each candidate angle and
  // keep the one whose horizontal projection is most concentrated, because a
  // long wall collapses into a few tall rows only when it is parallel to the
  // scan direction. Per-pixel gradient voting was tried first and is NOT used:
  // a line drawn at 2 degrees is rendered as a staircase whose every local
  // gradient is exactly axis-aligned, so the aliasing votes for zero and drags
  // the estimate down. Measured, that method returned 1.74 and -2.54 for known
  // rotations of +2 and -3; this one returns 1.998 and -3.000.
  const SKEW_MAX_DEG=6,SKEW_STEP=.25,SKEW_MIN_DEG=.35,SKEW_MIN_GAIN=1.08;
  function estimatePlanSkew(sourceCanvas,width,height){
    // Skew is a global property of the drawing, so it is measured small.
    const target=500,s=Math.min(1,target/Math.max(width,height));
    const W=Math.max(8,Math.round(width*s)),H=Math.max(8,Math.round(height*s));
    const small=document.createElement("canvas");small.width=W;small.height=H;
    const sctx=small.getContext("2d",{willReadFrequently:true});
    sctx.drawImage(sourceCanvas,0,0,W,H);
    const d=sctx.getImageData(0,0,W,H).data;
    const gray=new Float32Array(W*H);
    for(let i=0,o=0;i<W*H;i++,o+=4)gray[i]=d[o]*.299+d[o+1]*.587+d[o+2]*.114;
    // Ink is gradient magnitude, so a pale plan and a dark one behave alike.
    const ink=new Float32Array(W*H);let inkTotal=0;
    for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
      const i=y*W+x,m=Math.abs(gray[i+1]-gray[i-1])+Math.abs(gray[i+W]-gray[i-W]);
      if(m>40){ink[i]=m;inkTotal+=m;}
    }
    if(!inkTotal)return{deg:0,gain:1,measured:false,applyDeg:0};
    const cx=W/2,cy=H/2,rows=new Float32Array(H+2);
    const scoreAt=deg=>{
      const r=deg*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r);
      rows.fill(0);
      for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
        const v=ink[y*W+x];if(!v)continue;
        const ry=((x-cx)*-sin+(y-cy)*cos+cy)|0;
        if(ry>=0&&ry<H)rows[ry]+=v;
      }
      let sum=0;for(let i=0;i<H;i++)sum+=rows[i]*rows[i];
      return sum;
    };
    const scores=[];let best=0,bestScore=-1,zero=1;
    for(let deg=-SKEW_MAX_DEG;deg<=SKEW_MAX_DEG+1e-9;deg+=SKEW_STEP){
      const sc=scoreAt(deg);scores.push(sc);
      if(Math.abs(deg)<1e-9)zero=sc||1;
      if(sc>bestScore){bestScore=sc;best=deg;}
    }
    const i0=Math.round((best+SKEW_MAX_DEG)/SKEW_STEP);
    const l=scores[i0-1]??bestScore,m=bestScore,r=scores[i0+1]??bestScore,den=l-2*m+r;
    const refined=best+(den?.5*(l-r)/den:0)*SKEW_STEP;
    const deg=+refined.toFixed(3),gain=+(bestScore/zero).toFixed(4);
    // The deadband: correct the skew only when it clears BOTH thresholds.
    // Same expression runAssistedDetection used to evaluate; it lives here
    // now because SKEW_MIN_DEG/SKEW_MIN_GAIN do.
    return{deg,gain,measured:true,applyDeg:(Math.abs(deg)>=SKEW_MIN_DEG&&gain>=SKEW_MIN_GAIN)?deg:0};
  }
  // ============================================================
  // PlanDetectionProvider — classical-CV implementation
  //
  // Everything in this section is deterministic classical computer vision on
  // the real decoded plan pixels. It is NOT a trained model and must never be
  // presented as one (see .claude/skills/merit-plan-intelligence/SKILL.md,
  // "AI truthfulness"). It is exposed as a provider object
  //   { id, label, trainedModel:false, detect(pixels,width,height,hooks) }
  // so the application layer below never reaches into pixel code directly and
  // a future ONNX / YOLO-OBB provider can be dropped in behind the identical
  // call signature (real pixels in, oriented candidates out) without
  // runAssistedDetection() or plan-intelligence.js changing.
  //
  // Four accuracy defects diagnosed against a real venue plan drove this
  // rewrite; each fix is marked FIX #n below.
  //   1. colour was discarded on the first pass (luma only)
  //   2. Sobel edges were OR-ed into the labelling mask, so two tables drawn
  //      as adjacent outlines fused into ONE component centred between them
  //   3. table selection was "biggest area first, cap 100", which actively
  //      promoted those merge artifacts over correct single tables
  //   4. round vs rectangle came from the bounding-box aspect ratio, so every
  //      square table was reported as a round table
  // ============================================================

  // ---- FIX #1: a colour/tone model derived FROM THE IMAGE ----------------
  // No hue and no grey level is hardcoded. Two complementary models are built
  // from the drawing itself:
  //
  //  * ACCENT (hue): a 512-bin (3 bits/channel) RGB histogram reduced by
  //    mode-seeking leader clustering (descending bin population, fixed merge
  //    radius — deterministic, no RNG). The most saturated well-populated
  //    cluster family is the accent: orange chairs on the reported plan, blue
  //    chairs on the next venue's plan, same code path.
  //
  //  * TONE (lightness): 3 bits per channel cannot tell a pale beige or light
  //    grey table fill from white paper at all — they land in the SAME bucket —
  //    so tone families come from a full 8-bit luma histogram of the
  //    non-accent pixels instead. Its peaks are the drawing's real flat fills
  //    (paper / table fill / chair fill / ink), and each family only claims a
  //    narrow band around its own peak so antialiasing between two fills is
  //    claimed by neither.
  //
  // If the drawing has no saturated family the accent model simply comes out
  // empty and detection runs on tone alone; if it has no tone families either,
  // the luma component fallback still runs.

  globalThis.MeritPlanDeskew = { version: 1, otsu, estimatePlanSkew };
})();
