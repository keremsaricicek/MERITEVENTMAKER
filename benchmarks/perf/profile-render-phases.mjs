// Same fixture, but every screen measurement forces a layout flush inside the
// timed region, so the cost lands on the render that caused it instead of on
// whatever call happens next. Also breaks render() into HTML / innerHTML /
// bind / layout.
import { launchChromium } from "../../tests/lib/env.mjs";
import { serveApp } from "../../tests/lib/server.mjs";

// The runner serves the app itself; nothing here depends on a server a
// person remembered to start. MERIT_BASE_URL overrides it.
const app = await serveApp();

const b=await launchChromium();
const p=await b.newPage({viewport:{width:1920,height:1080}});
await p.goto(app.baseUrl + '/index.html');await p.waitForLoadState('networkidle');
await p.click('.appbar [data-action="create-event"]');await p.waitForTimeout(300);
await p.fill('input[name="name"]','Profile 4000');await p.fill('input[name="hotel"]','Merit Arena');
await p.fill('input[name="date"]','2026-12-31');
await p.click('button[data-setup="blank"]');await p.waitForTimeout(700);
await p.evaluate(()=>{
  const e=state.events[0];const tables=[];
  for(let i=0;i<400;i++){const col=i%20,row=Math.floor(i/20);
    const t={id:'tbl'+i,number:'T'+String(i+1).padStart(3,'0'),type:i%4===0?'round':i%4===1?'square':i%4===2?'rectangle':'bistro',
      x:120+col*160,y:120+row*150,w:120,h:110,capacity:10,zone:'MAIN FLOOR',rotation:0,locked:false,z:10,hasPhysicalSeats:true,chairs:[]};
    for(let s=0;s<10;s++){const a=s/10*Math.PI*2;t.chairs.push({id:'ch'+i+'_'+s,parentTableId:t.id,seatNumber:s+1,x:50+Math.cos(a)*46,y:50+Math.sin(a)*46,rotation:0,occupancy:null});}
    tables.push(t);}
  e.tables=tables;
  const vips=['Standard','VIP','VVIP'],plan=['Confirmed','Tentative'],arr=['Not Arrived','Checked In','No Show'];
  e.guests=Array.from({length:3000},(_,i)=>{const add=i%5===0?(i%4)+1:0;return{id:'g'+i,name:'GUEST '+String(i+1).padStart(4,'0'),
    additionalGuests:add,pax:1+add,planningStatus:plan[i%2],vip:vips[i%3],arrivalStatus:arr[i%3],
    invitedBy:'Host '+(i%40),notes:'',assignment:null,createdAt:new Date().toISOString()};});
  for(let i=0;i<500;i++){const g=e.guests[i],t=e.tables[i%400];g.assignment={tableId:t.id,seats:[0,1].slice(0,g.pax),locked:false};}
});

const r=await p.evaluate(()=>{
  const e=state.events[0];const T={};
  const flush=()=>document.body.offsetHeight;
  const t=(k,f)=>{const a=performance.now();f();flush();T[k]=+(performance.now()-a).toFixed(1);};
  // warm up
  ui.tab='guests';render();flush();
  t('guests: render+layout (3000 rows)',()=>{ui.guestQuery='';render();});
  t('guests: render+layout (1 row)',()=>{ui.guestQuery='GUEST 2500';render();});
  t('guests: render+layout (3000 rows) again',()=>{ui.guestQuery='';render();});
  t('seating: render+layout',()=>{ui.tab='seating';render();});
  t('seating: render+layout again',()=>{render();});
  t('live: render+layout',()=>{ui.tab='live';render();});
  t('live: render+layout again',()=>{render();});
  t('live: render+layout (1 row)',()=>{ui.liveQuery='GUEST 1234';render();});
  ui.liveQuery='';
  // breakdown of the live screen
  const html=(()=>{const a=performance.now();const h=liveHTML(e);T['  live: build HTML']=+(performance.now()-a).toFixed(1);return h;})();
  {const a=performance.now();app.innerHTML=html;T['  live: innerHTML']=+(performance.now()-a).toFixed(1);}
  {const a=performance.now();flush();T['  live: layout']=+(performance.now()-a).toFixed(1);}
  {const a=performance.now();const n=app.querySelectorAll('button').length;T['  live: querySelectorAll buttons']=+(performance.now()-a).toFixed(1);T['  live: button count']=n;}
  T['  live: DOM nodes']=app.querySelectorAll('*').length;
  ui.tab='guests';ui.guestQuery='';render();flush();
  T['  guests: DOM nodes']=app.querySelectorAll('*').length;
  ui.tab='seating';render();flush();
  T['  seating: DOM nodes']=app.querySelectorAll('*').length;
  return T;
});
console.log('\n=== RENDER + FORCED LAYOUT (ms) ===');
for(const k of Object.keys(r))console.log('  '+k.padEnd(42)+String(r[k]).padStart(8));
await b.close();
