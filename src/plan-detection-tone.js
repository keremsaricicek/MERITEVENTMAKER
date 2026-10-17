// THE DRAWING'S OWN PALETTE: ACCENT, TONE BANDS, AND THE MASKS THEY MAKE.
//
// Split A-2 of `benchmarks/PLAN-DETECTION-OWNERSHIP-MAP.md`, moved out of
// `src/plan-detection-classical.js` verbatim. No hue and no grey level is
// hardcoded: the accent hue, its chroma, the background luma and the tone
// bands are all derived from the plan's own RGB and luma histograms.
//
// THE CROSSING ANALYSIS (`scripts/crossing-analysis.mjs`, lines 62–239):
//
//   OUTWARD   ZERO — the region is closed over its own arguments.
//   INWARD    `rgbBinIndex`, `buildAccentModel`, `buildToneModel`,
//             `buildClassMasks`, `RGB_BINS` (four uses), `LOW_CHROMA`,
//             `MID_CHROMA` — the published surface, read by detect()'s first
//             two stages.
//   PRIVATE   `rgbHue`, `hueGap`, `RGB_BITS`, `RGB_LEVELS`, `RGB_SHIFT`.
//
// `RGB_BITS,RGB_LEVELS,RGB_BINS,RGB_SHIFT` is one comma-separated line of four
// names — the exact shape that shipped a ReferenceError the first time this
// pipeline moved — so all four came together and the boundary suite checks
// each. Verified by the detector fingerprint: 28 of 28 plans byte-identical.
(() => {
  "use strict";
  const RGB_BITS=3,RGB_LEVELS=1<<RGB_BITS,RGB_BINS=RGB_LEVELS**3,RGB_SHIFT=8-RGB_BITS;
  const LOW_CHROMA=40,MID_CHROMA=90;
  function rgbBinIndex(r,g,b){return((r>>RGB_SHIFT)*RGB_LEVELS+(g>>RGB_SHIFT))*RGB_LEVELS+(b>>RGB_SHIFT);}
  function rgbHue(r,g,b){
    const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
    if(!d)return 0;
    let h;
    if(max===r)h=((g-b)/d)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;
    h*=60;return h<0?h+360:h;
  }
  function hueGap(a,b){const d=Math.abs(a-b)%360;return d>180?360-d:d;}
  function buildAccentModel(binCount,binR,binG,binB,total){
    const order=[];
    for(let bin=0;bin<RGB_BINS;bin++)if(binCount[bin])order.push(bin);
    order.sort((a,b)=>binCount[b]-binCount[a]||a-b); // ties broken by bin index so the model is reproducible run to run
    const clusters=[],MERGE_DIST=72; // one 3-bit bucket step is 32 per channel
    for(const bin of order){
      const n=binCount[bin],r=binR[bin]/n,g=binG[bin]/n,b=binB[bin]/n;
      let host=null,bestDist=Infinity;
      for(const cl of clusters){const d=Math.hypot(cl.r-r,cl.g-g,cl.b-b);if(d<bestDist){bestDist=d;host=cl;}}
      if(host&&bestDist<=MERGE_DIST){
        host.n+=n;host.sr+=binR[bin];host.sg+=binG[bin];host.sb+=binB[bin];
        host.r=host.sr/host.n;host.g=host.sg/host.n;host.b=host.sb/host.n;
      }else if(clusters.length<12)clusters.push({n,sr:binR[bin],sg:binG[bin],sb:binB[bin],r,g,b});
    }
    if(!clusters.length)return null;
    for(const cl of clusters){
      cl.luma=cl.r*.299+cl.g*.587+cl.b*.114;
      cl.chroma=Math.max(cl.r,cl.g,cl.b)-Math.min(cl.r,cl.g,cl.b);
      cl.hue=rgbHue(cl.r,cl.g,cl.b);
      cl.fraction=cl.n/total;
    }
    const background=clusters.reduce((best,c)=>c.n>best.n?c:best,clusters[0]);
    const others=clusters.filter(c=>c!==background);
    const saturated=others.filter(c=>c.chroma>=45&&c.fraction>=.0006)
      .sort((a,b)=>b.chroma*Math.sqrt(b.n)-a.chroma*Math.sqrt(a.n)||b.n-a.n);
    const seed=saturated[0]||null;
    // A drawn object is usually a saturated fill plus a darker stroke of the
    // SAME hue, so the accent family is hue-anchored, not a single cluster.
    const accent=seed?others.filter(c=>c.chroma>=Math.max(35,seed.chroma*.5)&&hueGap(c.hue,seed.hue)<=30&&c.fraction>=.0002):[];
    const accentSet=new Set(accent);
    // Per-bucket lookup, including the antialiased in-between buckets that
    // never got their own cluster: mask building becomes one lookup per pixel.
    const accentBucket=new Uint8Array(RGB_BINS),neutralBucket=new Uint8Array(RGB_BINS);
    const chromaCut=seed?Math.max(LOW_CHROMA,Math.min(MID_CHROMA,seed.chroma*.5)):MID_CHROMA;
    for(let bin=0;bin<RGB_BINS;bin++){
      const rb=(bin/(RGB_LEVELS*RGB_LEVELS))|0,gb=((bin/RGB_LEVELS)|0)%RGB_LEVELS,bb=bin%RGB_LEVELS,half=1<<(RGB_SHIFT-1);
      const r=rb*(1<<RGB_SHIFT)+half,g=gb*(1<<RGB_SHIFT)+half,b=bb*(1<<RGB_SHIFT)+half;
      let best=clusters[0],bestDist=Infinity;
      for(const cl of clusters){const d=(cl.r-r)**2+(cl.g-g)**2+(cl.b-b)**2;if(d<bestDist){bestDist=d;best=cl;}}
      accentBucket[bin]=accentSet.has(best)?1:0;
      neutralBucket[bin]=(!accentBucket[bin]&&(Math.max(r,g,b)-Math.min(r,g,b))<=chromaCut)?1:0;
    }
    return{clusters,background,accent,accentBucket,neutralBucket,
      isColorPlan:accent.length>0,
      accentHue:seed?Math.round(seed.hue):null,accentChroma:seed?Math.round(seed.chroma):null,
      accentFraction:accent.reduce((n,c)=>n+c.fraction,0),backgroundLuma:Math.round(background.luma)};
  }
  // Tone families: the real flat fills of the drawing, found as peaks of the
  // non-accent luma histogram. Each family claims only a narrow band around its
  // own peak, so the 1px antialiasing ramp between paper and a fill belongs to
  // neither family and cannot bridge two objects together.
  function buildToneModel(lowHist,midHist,sampled,accentChroma){
    const useMid=!accentChroma||accentChroma>=120; // a mid-chroma fill is a table tint, unless the accent itself is that weak
    const hist=new Float64Array(256);
    let neutral=0;
    for(let v=0;v<256;v++){hist[v]=lowHist[v]+(useMid?midHist[v]:0);neutral+=hist[v];}
    if(!neutral)return null;
    const smooth=new Float64Array(256);
    for(let v=0;v<256;v++){
      let sum=0,n=0;
      for(let k=-2;k<=2;k++){const u=v+k;if(u<0||u>255)continue;sum+=hist[u];n++;}
      smooth[v]=sum/n;
    }
    const raw=[];
    // The ends of the range are candidates too: white paper sits at 255 and a
    // solid black fill at 0, and skipping the boundaries made the brightest
    // fill (not the paper) look like the background of the drawing.
    for(let v=0;v<256;v++){
      const prev=v>0?smooth[v-1]:-1,next=v<255?smooth[v+1]:-1;
      if(smooth[v]>0&&smooth[v]>=prev&&smooth[v]>next)raw.push(v);
    }
    raw.sort((a,b)=>smooth[b]-smooth[a]||a-b);
    const peaks=[];
    for(const v of raw){
      if(peaks.some(p=>Math.abs(p.luma-v)<10))continue; // one peak per real fill, not per histogram wobble
      let mass=0;
      for(let k=-5;k<=5;k++){const u=v+k;if(u>=0&&u<256)mass+=hist[u];}
      peaks.push({luma:v,mass,fraction:mass/sampled});
      if(peaks.length>=8)break;
    }
    if(!peaks.length)return null;
    peaks.sort((a,b)=>a.luma-b.luma);
    const background=peaks.reduce((best,p)=>p.mass>best.mass?p:best,peaks[0]);
    // A luma floor used to exclude dark peaks here, on the theory that anything
    // dark enough is linework. On white paper that floor lands at 114, and a
    // mid-grey chair fill sits at 110 -- so on every monochrome plan the chair
    // family was thrown away as "ink" before a single component was looked at.
    // Measured on the dense grayscale fixture: 96 chairs, 0 detected, because
    // their tone family never existed.
    //
    // Darkness is the wrong question. Linework is THIN; furniture is a solid,
    // repeated, similarly-sized blob. That is a structural property and it is
    // measured per family from the family's own components, in the mask loop
    // below, where the pixels are actually available. Here the job is only to
    // offer the candidates -- including dark ones, flagged so the structural
    // test can be stricter with them.
    const inkCeil=Math.max(90,background.luma*.45);
    // Every qualifying peak is a candidate surface family, not the three
    // largest.
    //
    // This used to be `.slice(0,3)` — a top-three-by-mass cut — and a minority
    // furniture surface is DEFINED by having little mass, so that cap was not a
    // tie-break but a structural exclusion. Measured on the real venue plan:
    // its luma peaks are 29, 109, 121, 146, 169, 201, 229, 255, and the bistro
    // tables' tan surface does peak, at 201. The cut kept 229 (bulk grey
    // architecture) and 121/146 (linework), so no tint mask ever contained the
    // tan; the five bistro discs then scored 0.124-0.132 surface coverage
    // against a 0.22 floor and were deleted. All five of this plan's remaining
    // table misses were those tables. See benchmarks/SINGLE-FAMILY-AUDIT.md.
    //
    // Mass was never the right question. Whether a tone family is furniture is
    // decided downstream, from the family's own components -- are they compact,
    // repeated, similarly sized -- and that test cannot run on a family that
    // was thrown away before its mask was built. The filter conditions here
    // (real mass, not the background, above the ink ceiling) select candidates;
    // the structural test selects families.
    //
    // Bounded by the peak finder's own limit rather than an independent number.
    // Each family claims only a narrow band around its own peak, computed from
    // the gap to the nearest PEAK (not the nearest family), so admitting one
    // more family cannot widen or narrow anybody else's band -- the measured
    // failure that produced the old cap was adding DARK peaks, which sit close
    // together and do fight over pixels, and those are still kept out of this
    // list entirely (darkCandidates below).
    const families=peaks.filter(p=>p!==background&&p.luma<background.luma-10&&p.luma>inkCeil&&p.fraction>=.002)
      .sort((a,b)=>b.mass-a.mass);
    // Peaks the ceiling rejects. These are NOT added to `families`, because
    // `families` drives the nearest-family tone LUT and adding to it steals
    // pixels from the table surface family -- measured on the real colour
    // plan, tone sources fell 57 -> 23 and the table masks fragmented.
    //
    // They get their own standalone masks instead, and are offered only to the
    // chair pool, where the grayscale failure actually is.
    const darkFloor=Math.max(35,background.luma*.15);
    const darkCandidates=peaks.filter(p=>p!==background&&p.luma<=inkCeil&&p.luma>darkFloor&&p.fraction>=.0015)
      .sort((a,b)=>b.mass-a.mass).slice(0,3);
    const toneLut=new Uint8Array(256);
    families.forEach((family,index)=>{
      let gap=Infinity;
      for(const p of peaks)if(p!==family)gap=Math.min(gap,Math.abs(p.luma-family.luma));
      const window=Math.max(3,Math.min(14,Math.floor(gap/2)));
      for(let v=Math.max(0,family.luma-window);v<=Math.min(255,family.luma+window);v++)
        if(!toneLut[v]||Math.abs(v-family.luma)<Math.abs(v-families[toneLut[v]-1].luma))toneLut[v]=index+1;
    });
    return{peaks,background,families,darkCandidates,toneLut,
      summary:{peaks:peaks.map(p=>p.luma),backgroundLuma:background.luma,
        families:families.map(f=>({luma:f.luma,fraction:Number(f.fraction.toFixed(4))})),
        darkCandidates:darkCandidates.map(f=>({luma:f.luma,fraction:Number(f.fraction.toFixed(4))}))}};
  }

  // ---- Masks --------------------------------------------------------------
  function buildClassMasks(data,gray,total,accentModel,toneModel){
    const accent=accentModel?.isColorPlan?new Uint8Array(total):null;
    const familyCount=toneModel?.families.length||0,tints=[];
    for(let k=0;k<familyCount;k++)tints.push(new Uint8Array(total));
    const accentBucket=accentModel?.accentBucket,neutralBucket=accentModel?.neutralBucket,toneLut=toneModel?.toneLut;
    for(let i=0,o=0;i<total;i++,o+=4){
      const bin=rgbBinIndex(data[o],data[o+1],data[o+2]);
      if(accent&&accentBucket[bin]){accent[i]=1;continue;}
      if(!familyCount)continue;
      if(accentBucket&&accentBucket[bin])continue;
      if(neutralBucket&&!neutralBucket[bin])continue;
      const family=toneLut[gray[i]];
      if(family)tints[family-1][i]=1;
    }
    return{accent,tints};
  }

  globalThis.MeritPlanTone = {
    version: 1,
    RGB_BINS, LOW_CHROMA, MID_CHROMA,
    rgbBinIndex, buildAccentModel, buildToneModel, buildClassMasks,
  };
})();
