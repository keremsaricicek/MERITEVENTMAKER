// The visual descriptor registry: the handcrafted, deterministic descriptor
// computed from a candidate's own plan pixels, and the registry a learned
// encoder (src/plan-embedding.js) registers itself into. Published as
// globalThis.MeritVisualEmbedding; reads nothing from the app shell.
//
// Moved byte-for-byte out of app-v8.js on 2026-11-01 (code health), at the
// original indentation. It loads immediately before app-v8.js, which is where
// it used to run, so plan-embedding.js (loaded earlier) registers its encoder
// at the same moment as before. The shell's one caller now reaches it through
// globalThis.MeritVisualEmbedding.resolve().
(() => {
  "use strict";
  // ============================================================
  // VisualEmbeddingProvider (classical/deterministic implementation).
  //
  // Real visual similarity requires real pixel information, not just a
  // bounding box's area/aspect ratio. A real trained embedding model
  // (ONNX Runtime Web + a pretrained vision model such as MobileNetV2) was
  // evaluated for this: onnxruntime-web is on the npm registry and a real
  // ~14MB MobileNetV2 ONNX model IS fetchable in this environment via
  // media.githubusercontent.com (verified, not assumed) -- so bundling one is
  // technically possible. It was deprioritized for this pass in favor of the
  // explicitly higher-priority full-app visual redesign later in this same
  // sprint, not because it's infeasible; a future pass can wire a real
  // embedding model in as an alternate implementation of this exact function
  // signature (candidate pixels in, fixed-shape numeric descriptor out)
  // without touching plan-intelligence.js's clustering logic at all.
  //
  // This implementation instead computes a real, deterministic descriptor
  // straight from the actual decoded plan pixels already in memory from
  // detection (no synthetic/fabricated numbers): interior fill ratio (shape
  // occupancy), edge density (a Sobel-style gradient magnitude average,
  // texture/outline signal), an 8-bin grayscale intensity histogram (coarse
  // color/tone distribution), and a 4-quadrant fill balance (a cheap contour/
  // shape signature that tells a round table's radial fill apart from an
  // L-shaped or off-center one). This is real pixel-derived signal, honestly
  // labeled as classical/deterministic -- never described as a trained model.
  // ---- VisualEmbeddingProvider (Gate G) --------------------------------
  //
  // The boundary a real learned embedding model would plug into, so that
  // swapping one in is a provider registration rather than a rewrite of the
  // similarity clustering.
  //
  // Exactly one provider is installed today and it is NOT a model. It is a
  // hand-crafted descriptor: fill ratio, edge density, an 8-bin intensity
  // histogram and a quadrant fill signature, computed from the decoded plan
  // pixels. Calling that an embedding would be false, so `kind` says
  // "handcrafted-descriptor", `trainedModel` is false, and `dimensions` is the
  // real vector length rather than a model's hidden size. Nothing in the UI
  // may describe this as a learned or trained representation.
  //
  // See benchmarks/embedding/README.md for the license matrix and for the
  // measured baseline any candidate model has to beat before it is worth
  // shipping tens of megabytes of weights into an offline package.
  const VisualEmbeddingProviders={
    handcrafted:{
      id:"handcrafted-descriptor-v1",
      kind:"handcrafted-descriptor",
      trainedModel:false,
      label:"Geometric + intensity descriptor computed from plan pixels. Not a trained model, not an embedding.",
      dimensions:14, // fillRatio + edgeDensity + 8 histogram bins + 4 quadrants
      offline:true,
      licence:"n/a — computed in-product, no third-party weights",
      embed(gray,binary,width,height,candidate){
        return computeVisualDescriptor(gray,binary,width,height,candidate);
      },
      // Flat vector form, so a consumer can compare providers without knowing
      // the shape of any one of them.
      toVector(d){
        if(!d)return null;
        return [d.fillRatio,d.edgeDensity,...(d.intensityHist||[]),...(d.quadrantFill||[])];
      },
    },
  };
  function resolveVisualEmbeddingProvider(){
    // The learned encoder is the default WHEN IT IS INSTALLED, and only
    // because it was measured to be better on every retrieval number and
    // worse on none — see src/plan-embedding.js and
    // benchmarks/embedding/retrieval.json. If its weights are absent (a build
    // that did not run scripts/build-encoder-module.mjs) the app degrades to
    // the handcrafted descriptor rather than failing, and says which one ran
    // in the detection diagnostics either way.
    const id=globalThis.MERIT_VISUAL_EMBEDDING_PROVIDER
      ||(VisualEmbeddingProviders.learned?"learned":"handcrafted");
    return VisualEmbeddingProviders[id]||VisualEmbeddingProviders.handcrafted;
  }
  globalThis.MeritVisualEmbedding={
    providers:VisualEmbeddingProviders,
    resolve:resolveVisualEmbeddingProvider,
    // Registration seam for a future real model. Kept deliberately explicit:
    // a provider must declare whether it is a trained model, because the
    // honesty rules downstream key off that flag rather than off its name.
    register(id,provider){
      if(!provider||typeof provider.embed!=="function")throw new Error("A visual embedding provider needs an embed() function.");
      if(typeof provider.trainedModel!=="boolean")throw new Error("A visual embedding provider must declare trainedModel explicitly.");
      VisualEmbeddingProviders[id]=provider;
    },
  };
  // src/plan-embedding.js loads before this file, so it cannot register itself
  // against a registry that does not exist yet. It exposes the registration and
  // this calls it, which also means an installation without the weights simply
  // never registers and the handcrafted descriptor stays the resolved provider.
  if(typeof globalThis.MeritRegisterPlanEncoder==="function")globalThis.MeritRegisterPlanEncoder();
  function computeVisualDescriptor(gray,binary,width,height,c){
    const px=Math.max(0,Math.round(c.x/100*width)),py=Math.max(0,Math.round(c.y/100*height));
    const pw=Math.max(1,Math.min(width-px,Math.round(c.w/100*width))),ph=Math.max(1,Math.min(height-py,Math.round(c.h/100*height)));
    if(pw<2||ph<2)return null;
    const hist=new Array(8).fill(0),quadFg=[0,0,0,0],quadTotal=[0,0,0,0];
    let fg=0,edgeSum=0,total=0;
    for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
      const gx=px+x,gy=py+y;if(gx>=width||gy>=height)continue;
      const i=gy*width+gx,v=gray[i];
      total++;hist[Math.min(7,v>>5)]++;
      if(binary[i])fg++;
      const qi=(x<pw/2?0:1)+(y<ph/2?0:2);quadTotal[qi]++;if(binary[i])quadFg[qi]++;
      if(x>0&&x<pw-1&&y>0&&y<ph-1){
        edgeSum+=Math.abs(gray[gy*width+gx+1]-gray[gy*width+gx-1])+Math.abs(gray[(gy+1)*width+gx]-gray[(gy-1)*width+gx]);
      }
    }
    if(!total)return null;
    return{
      fillRatio:fg/total,
      edgeDensity:Math.min(1,edgeSum/(total*255)),
      intensityHist:hist.map(n=>n/total),
      quadrantFill:quadTotal.map((n,i)=>n?quadFg[i]/n:0),
    };
  }
})();
