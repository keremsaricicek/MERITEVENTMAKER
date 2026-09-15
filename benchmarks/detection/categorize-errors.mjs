// GATE 4: each remaining table false positive, individually, with the
// evidence that was available to reject it. Solve by category, never by
// coordinate.
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

import fs from 'node:fs';

// The runner serves the app itself; nothing here depends on a server a
// person remembered to start. MERIT_BASE_URL overrides it.
const app = await serveApp();
const annot=JSON.parse(fs.readFileSync('/home/user/MERITEVENTMAKER/benchmarks/annotations/merit-real-venue.json','utf8'));
const W=annot.source.width,H=annot.source.height,diag=Math.hypot(W,H);
const tol=(annot.matchToleranceP??3)/100*diag;
const b=await launchChromium();
const p=await b.newPage({viewport:{width:1800,height:1000}});
await p.goto(app.baseUrl + '/index.html');await p.waitForLoadState('networkidle');
await p.click('.appbar [data-action="create-event"]');await p.waitForTimeout(300);
await p.fill('input[name="name"]','FP');await p.fill('input[name="hotel"]','FP');await p.fill('input[name="date"]','2026-10-02');
await p.click('button[data-setup="blank"]');await p.waitForTimeout(700);
const b64=fs.readFileSync('/home/user/MERITEVENTMAKER/benchmarks/plans/merit-real-venue-plan.png').toString('base64');
await p.evaluate(src=>{state.events[0].background={src,name:'p.png',opacity:1,visible:true,locked:false,scale:100};render();},`data:image/png;base64,${b64}`);
await p.waitForTimeout(400);
await p.click('[data-v8-action="detect"]');
await p.waitForFunction(()=>!!state.events[0].analysis,null,{timeout:180000}).catch(()=>{});
await p.waitForTimeout(700);
const det=await p.evaluate(()=>(state.events[0].analysis.candidates||[])
  .filter(c=>c.status!=='rejected'&&c.kind==='table')
  .map(c=>({id:c.id,type:c.type,x:c.x,y:c.y,w:c.w,h:c.h,conf:c.confidence,
    chairs:(c.chairDetections||[]).length,ev:c.evidence})));
const gtAll=annot.objects;
const D=det.map(c=>({...c,cx:(c.x+c.w/2)/100*W,cy:(c.y+c.h/2)/100*H,pw:c.w/100*W,ph:c.h/100*H}));
const gt=gtAll.filter(o=>o.class==='table');
const pairs=[];
gt.forEach((g,gi)=>D.forEach((d,di)=>{const dd=Math.hypot(g.cx-d.cx,g.cy-d.cy);if(dd<=tol)pairs.push({gi,di,dd});}));
pairs.sort((a,b)=>a.dd-b.dd);
const gU=new Set(),dU=new Set();
for(const q of pairs){if(gU.has(q.gi)||dU.has(q.di))continue;gU.add(q.gi);dU.add(q.di);}
const fp=D.filter((_,i)=>!dU.has(i)), missed=gt.filter((_,i)=>!gU.has(i));
// what is actually AT each FP location, per ground truth?
const nearestAnything=d=>{
  let best=null,bd=Infinity;
  for(const o of gtAll){const dd=Math.hypot((o.cx??0)-d.cx,(o.cy??0)-d.cy);
    if(dd<bd){bd=dd;best=o;}}
  return{obj:best,dist:Math.round(bd)};
};
const inRegion=d=>(annot.regions||[]).filter(r=>d.cx>=r.x&&d.cx<=r.x+r.w&&d.cy>=r.y&&d.cy<=r.y+r.h);
console.log(`FP=${fp.length}  FN=${missed.length}\n`);
console.log('=== FALSE POSITIVES, one by one ===');
fp.forEach((d,i)=>{
  const n=nearestAnything(d),rg=inRegion(d);
  const aspect=(Math.max(d.pw,d.ph)/Math.min(d.pw,d.ph)).toFixed(2);
  console.log(`\nFP${i+1}  at (${Math.round(d.cx)},${Math.round(d.cy)})  ${Math.round(d.pw)}x${Math.round(d.ph)}px  aspect ${aspect}`);
  console.log(`  classified as : table/${d.type}   confidence ${d.conf.toFixed(2)}   chairs ${d.chairs}`);
  console.log(`  evidence      : src=${d.ev?.source} sizeAgree=${d.ev?.sizeAgreement} split=${!!d.ev?.split} rep=${d.ev?.repetition}`);
  console.log(`  nearest GT    : ${n.obj?.class}/${n.obj?.type||''} "${n.obj?.id}" at ${n.dist}px`);
  console.log(`  inside region : ${rg.length?rg.map(r=>r.class+'/'+(r.subclass||r.id)).join(', '):'none'}`);
});
console.log('\n=== MISSED TABLES (FN) ===');
missed.forEach(g=>{
  const near=D.map(d=>({d,dd:Math.hypot(g.cx-d.cx,g.cy-d.cy)})).sort((a,b)=>a.dd-b.dd)[0];
  console.log(`  ${g.id} ${g.type} at (${g.cx},${g.cy}) ${g.w}x${g.h}  nearest detection ${Math.round(near.dd)}px away (tol ${Math.round(tol)})`);
});
await b.close();
