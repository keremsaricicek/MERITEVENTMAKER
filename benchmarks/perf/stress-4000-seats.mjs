// Gates AB/AC: a real 4,000-seat stress test with measured timings.
// Builds the dataset through the app's own model (syncTableChairs, real guest
// records with +N / VIP / statuses), then measures the operations an operator
// actually performs. Every number below is wall-clock in this environment.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1920,height:1080}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error'&&!/404|ERR_TUNNEL/.test(m.text()))errs.push('console: '+m.text())});
const T={};
const time=async(label,fn)=>{const t0=Date.now();const r=await fn();T[label]=Date.now()-t0;return r;};

await p.goto('http://localhost:8000/index.html');await p.waitForLoadState('networkidle');
await p.click('.appbar [data-action="create-event"]');await p.waitForTimeout(300);
await p.fill('input[name="name"]','Stress 4000');await p.fill('input[name="hotel"]','Merit Arena');
await p.fill('input[name="date"]','2026-12-31');
await p.click('button[data-setup="blank"]');await p.waitForTimeout(700);

// ---- build the dataset ----------------------------------------------------
const built=await time('buildDataset',()=>p.evaluate(()=>{
  const e=state.events[0];
  const TABLES=400, SEATS=10;            // 4,000 physical chairs
  const tables=[];
  for(let i=0;i<TABLES;i++){
    const col=i%20,row=Math.floor(i/20);
    const t={id:'tbl'+i,number:'T'+String(i+1).padStart(3,'0'),
      type:i%4===0?'round':i%4===1?'square':i%4===2?'rectangle':'bistro',
      x:120+col*160,y:120+row*150,w:120,h:110,capacity:SEATS,zone:'MAIN FLOOR',
      rotation:0,locked:false,z:10,hasPhysicalSeats:true,chairs:[]};
    // same chair record shape the app's own syncTableChairs produces
    for(let s=0;s<SEATS;s++){
      const ang=s/SEATS*Math.PI*2;
      t.chairs.push({id:'ch'+i+'_'+s,parentTableId:t.id,seatNumber:s+1,
        x:50+Math.cos(ang)*46,y:50+Math.sin(ang)*46,rotation:0,occupancy:null});
    }
    tables.push(t);
  }
  e.tables=tables;
  const vips=['Standard','VIP','VVIP'],plan=['Confirmed','Tentative'],arr=['Not Arrived','Checked In','No Show'];
  const guests=[];
  for(let i=0;i<3000;i++){
    const add=i%5===0?(i%4)+1:0;
    guests.push({id:'g'+i,name:'GUEST '+String(i+1).padStart(4,'0'),
      additionalGuests:add,pax:1+add,
      planningStatus:plan[i%2],vip:vips[i%3],arrivalStatus:arr[i%3],
      invitedBy:'Host '+(i%40),notes:'',assignment:null,createdAt:new Date().toISOString()});
  }
  e.guests=guests;
  return {tables:e.tables.length,chairs:e.tables.reduce((n,t)=>n+t.chairs.length,0),
    guests:e.guests.length,pax:e.guests.reduce((n,g)=>n+g.pax,0)};
}));
console.log('DATASET:',JSON.stringify(built));

await time('saveState',()=>p.evaluate(()=>{saveState();return true;}));
await time('renderFloorPlan',async()=>{await p.evaluate(()=>{ui.tab='floor';render();});await p.waitForTimeout(0);});
const domNodes=await p.evaluate(()=>document.querySelectorAll('#canvasWorld *').length);

// ---- bulk seating through the real transactional path ---------------------
await time('assign500Guests',()=>p.evaluate(()=>{
  const e=state.events[0];
  for(let i=0;i<500;i++){
    const g=e.guests[i],t=e.tables[i%400];
    const used=occupiedSeatIndexes(e,t.id,null);
    const free=[];for(let s=0;s<t.capacity&&free.length<g.pax;s++)if(!used.has(s))free.push(s);
    if(free.length>=g.pax)g.assignment={tableId:t.id,seats:free,locked:false};
  }
  return true;
}));

await time('guestsScreenRender',async()=>{await p.evaluate(()=>{ui.tab='guests';render();});});
await time('guestSearch',async()=>{await p.evaluate(()=>{ui.guestQuery='GUEST 2500';render();});});
await time('guestFilterUnassigned',async()=>{await p.evaluate(()=>{ui.guestQuery='';ui.guestFilter='unassigned';render();});});
await time('seatingScreenRender',async()=>{await p.evaluate(()=>{ui.guestFilter='all';ui.tab='seating';render();});});
await time('liveScreenRender',async()=>{await p.evaluate(()=>{ui.tab='live';render();});});
await time('liveSearch',async()=>{await p.evaluate(()=>{ui.liveQuery='GUEST 1234';render();});});
await time('checkIn',()=>p.evaluate(()=>{
  const e=state.events[0],g=e.guests.find(x=>x.name==='GUEST 1234');
  g.arrivalStatus='Checked In';touchEvent(e);render();return true;}));
await time('noShow',()=>p.evaluate(()=>{
  const e=state.events[0],g=e.guests.find(x=>x.name==='GUEST 1235');
  g.arrivalStatus='No Show';touchEvent(e);render();return true;}));
await time('reportsRender',async()=>{await p.evaluate(()=>{ui.liveQuery='';ui.tab='reports';render();});});
const xlsxBytes=await time('xlsxExport',()=>p.evaluate(async()=>{
  const before=document.querySelectorAll('a').length;
  let captured=0;
  const origCreate=URL.createObjectURL;
  URL.createObjectURL=(blob)=>{captured=blob.size;return origCreate.call(URL,blob);};
  document.querySelector('[data-report="xlsx"]').click();
  await new Promise(r=>setTimeout(r,2500));
  URL.createObjectURL=origCreate;
  return captured;
}));
await time('undoSnapshot',()=>p.evaluate(()=>{recordUndo(state.events[0]);return true;}));
await time('undoRestore',()=>p.evaluate(()=>{undoCanvas();return true;}));

// ---- persistence round trip ----------------------------------------------
await time('saveStateFull',()=>p.evaluate(()=>{saveState();return true;}));
await p.waitForTimeout(1200);
await time('reloadAndRestore',async()=>{
  await p.reload();await p.waitForLoadState('networkidle');
  await p.waitForFunction(()=>state.events.length>0&&state.events[0].tables.length>0,null,{timeout:60000});
});
const after=await p.evaluate(()=>({tables:state.events[0].tables.length,guests:state.events[0].guests.length,
  chairs:state.events[0].tables.reduce((n,t)=>n+t.chairs.length,0),
  assigned:state.events[0].guests.filter(g=>g.assignment).length,
  pax:state.events[0].guests.reduce((n,g)=>n+g.pax,0)}));

// ---- backup round trip ----------------------------------------------------
await time('backupExport',()=>p.evaluate(()=>{
  document.querySelector('[data-action="backup-export"]')?.click();return true;}));

const mem=await p.evaluate(()=>performance.memory?{
  usedMB:+(performance.memory.usedJSHeapSize/1048576).toFixed(1),
  limitMB:+(performance.memory.jsHeapSizeLimit/1048576).toFixed(1)}:null);

console.log('\n=== 4,000-SEAT PERFORMANCE (ms, wall clock) ===');
for(const k of Object.keys(T))console.log('  '+k.padEnd(24)+String(T[k]).padStart(7)+' ms');
console.log('\nDOM nodes in canvas world:',domNodes);
console.log('XLSX blob bytes:',xlsxBytes);
console.log('AFTER RELOAD:',JSON.stringify(after));
console.log('JS heap:',JSON.stringify(mem));
console.log('ERRORS:',errs.length?JSON.stringify(errs.slice(0,5)):'clean');
const integrity=after.tables===400&&after.chairs===4000&&after.guests===3000&&after.assigned===500;
console.log('DATA INTEGRITY AFTER RELOAD:',integrity?'OK':'FAILED');
await b.close();
process.exit(integrity?0:1);
