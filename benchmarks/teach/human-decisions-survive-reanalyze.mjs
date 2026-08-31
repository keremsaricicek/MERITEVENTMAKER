// The precise risk: the operator confirms an object that the fragment filter
// classifies as a fragment. On Re-Analyze the filter runs BEFORE plan memory,
// so if it drops that candidate, memory has nothing to match and the human's
// confirmed table disappears from their plan.
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

import fs from 'node:fs';

// The runner serves the app itself; nothing here depends on a server a
// person remembered to start. MERIT_BASE_URL overrides it.
const app = await serveApp();
const b=await launchChromium();
const p=await b.newPage({viewport:{width:1800,height:1000}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto(app.baseUrl + '/index.html');await p.waitForLoadState('networkidle');
await p.click('.appbar [data-action="create-event"]');await p.waitForTimeout(300);
await p.fill('input[name="name"]','Frag');await p.fill('input[name="hotel"]','Frag');await p.fill('input[name="date"]','2026-10-02');
await p.click('button[data-setup="blank"]');await p.waitForTimeout(700);
const b64=fs.readFileSync('/home/user/MERITEVENTMAKER/benchmarks/plans/merit-real-venue-plan.png').toString('base64');
await p.evaluate(src=>{state.events[0].background={src,name:'p.png',opacity:1,visible:true,locked:false,scale:100};render();},`data:image/png;base64,${b64}`);
await p.waitForTimeout(400);

// Pass 1 WITHOUT the filter, so the fragments are present and confirmable.
await p.evaluate(()=>{globalThis.MERIT_DISABLE_FRAGMENT_FILTER=true;});
await p.click('[data-v8-action="detect"]');
await p.waitForFunction(()=>!!state.events[0].analysis,null,{timeout:180000}).catch(()=>{});
await p.waitForTimeout(1000);

// Find a candidate the filter WOULD drop (3+ disagreement reasons), and have
// the operator confirm it as a real table through the inspector.
const victim=await p.evaluate(()=>{
  const a=state.events[0].analysis;
  const asp=c=>{const w=c.w,h=c.h;return Math.max(w,h)/Math.min(w,h);};
  const all=a.candidates.filter(c=>c.kind==='table');
  const med=[...all.map(asp)].sort((x,y)=>x-y)[all.length>>1];
  const agree=(v,m)=>Math.max(0,1-Math.abs(v-m)/m);
  const scored=all.map(c=>{let n=0;
    if(c.evidence?.split)n++;
    if((c.evidence?.sizeAgreement??1)<.6)n++;
    if(agree(asp(c),med)<.85)n++;
    if((c.chairDetections||[]).length===0)n++;
    return{c,n};}).filter(s=>s.n>=3).sort((a,b)=>b.n-a.n);
  if(!scored.length)return null;
  const c=scored[0].c;
  ui.selectedCandidateId=c.id;ui.activeReviewGroupId=null;ui.activeQuestionId=null;render();
  return{id:c.id,x:c.x,y:c.y,w:c.w,h:c.h,reasons:scored[0].n,type:c.type};
});
console.log('victim (a candidate the filter would drop):',JSON.stringify(victim));
if(!victim){console.log('no 3-reason candidate found; cannot test');await b.close();process.exit(2);}

// Confirm it via the real UI control.
const actions=await p.evaluate(()=>[...document.querySelectorAll('[data-review-action="confirm"]')].map(x=>x.dataset.reviewAction));
console.log('available candidate actions:',JSON.stringify(actions));
const btn=await p.$('[data-review-action="confirm"]');
if(btn){await btn.click();await p.waitForTimeout(300);}
const mem=await p.evaluate(()=>({n:(state.events[0].planMemory||[]).length,
  hasVictim:(state.events[0].planMemory||[]).some(m=>m.status==='confirmed')}));
console.log('plan memory after confirm:',JSON.stringify(mem));

// Now Re-Analyze WITH the filter on — the production path.
await p.evaluate(()=>{globalThis.MERIT_DISABLE_FRAGMENT_FILTER=false;});
await p.click('[data-review-action="reanalyze"]');
await p.waitForTimeout(4500);

const after=await p.evaluate(v=>{
  const a=state.events[0].analysis;
  const near=a.candidates.filter(c=>Math.abs(c.x-v.x)<1.0&&Math.abs(c.y-v.y)<1.0);
  return{frag:a.diagnostics?.fragmentSuppression??null,
    total:a.candidates.length,
    survivors:near.map(c=>({kind:c.kind,type:c.type,status:c.status,fromMemory:!!c.fromMemory}))};
},victim);
console.log('\nafter re-analyze WITH filter:',JSON.stringify(after,null,1));
const survived=after.survivors.some(c=>c.status==='confirmed');
console.log(survived?'\nOK: the human-confirmed object survived the fragment filter'
                   :'\nFAIL: the fragment filter DELETED an object the operator had confirmed');
console.log('ERRORS:',errs.length?JSON.stringify(errs.slice(0,3)):'clean');
await b.close();
process.exit(survived?0:1);
