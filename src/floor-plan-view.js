// The Floor Plan's view: what the canvas shows and where it looks — the
// bulk-add fields and their ghost preview, the plan's bounding box, fitting the
// first view and "fit" to the plan, the canvas viewport markup and the Floor
// Plan screen's frame (fitCanvas, canvasViewportHTML and floorPlanHTML stay
// app-v8.js's overrides of the pre-v8 globals as one-line delegates). It
// creates, moves and deletes nothing: that is src/floor-plan-editing.js.
// Moved out of app-v8.js on 2026-11-08 (code health, capability 7 of 21, part
// a, benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let FLOORPLAN;
  let WORLD;
  let activeEvent;
  let applyCanvasTransform;
  let esc;
  let floorAnalyseHTML;
  let floorEmptyHTML;
  let t;
  let ui;
  let worldSize;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritFloorPlanView.create() is called once, by app-v8.js.");
    created=true;
    FLOORPLAN=deps.FLOORPLAN;
    WORLD=deps.WORLD;
    activeEvent=deps.activeEvent;
    applyCanvasTransform=deps.applyCanvasTransform;
    esc=deps.esc;
    floorAnalyseHTML=deps.floorAnalyseHTML;
    floorEmptyHTML=deps.floorEmptyHTML;
    t=deps.t;
    ui=deps.ui;
    worldSize=deps.worldSize;
  // Quantity is authoritative everywhere except "array", where rows x cols is.
  // Grid used to silently truncate to rows*cols, so asking for 25 tables in a
  // 2x2 grid quietly produced 4 -- the Quantity field lied about the outcome.
  // The bulk fields commit on `change`, which fires only on blur. Typing a
  // value and immediately clicking "Add to plan" therefore used to discard
  // that last edit -- type prefix "B", click, get T01. Read the live DOM
  // values before committing, the same way syncSetupFields does.
  function syncBulkFields(){
    if(!ui.bulkDraft)return;
    document.querySelectorAll("[data-bulk]").forEach(input=>{
      // The column field shows the layout's count until the operator types one.
      if(input.dataset.bulk==="cols"&&!ui.bulkDraft.colsChosen)return;
      ui.bulkDraft[input.dataset.bulk]=input.type==="number"?Number(input.value):input.value;
    });
  }
  // Repaint just the placement ghosts, so the live preview can follow typing
  // without a full render tearing down the panel the operator is using.
  function refreshGhosts(){
    const world=document.getElementById("canvasWorld");
    if(!world)return;
    world.querySelectorAll(".ghost-object").forEach(n=>n.remove());
    world.insertAdjacentHTML("beforeend",ghostHTML());
    const cols=document.querySelector('[data-bulk="cols"]');if(cols&&ui.bulkDraft)cols.value=shownCols(ui.bulkDraft);
  }
  function bulkCount(d){
    if(d.placement==="array")return Math.max(1,Math.min(60,(Math.max(1,Number(d.rows)||1))*(Math.max(1,Number(d.cols)||1))));
    return Math.max(1,Math.min(60,Number(d.quantity)||1));
  }
  // Fit fitted the fixed 1355×788 world, so a table placed below or beside it
  // stayed off-screen after Fit. It now fits the world together with every
  // object on the plan; for a plan whose objects all lie inside the world that
  // is exactly the old view.
  function planBox(event){
    let b=null;
    for(const o of [...(event?.tables||[]),...(event?.venueObjects||[])]){
      const w=Number(o.w)||0,h=Number(o.h)||0,cx=(Number(o.x)||0)+w/2,cy=(Number(o.y)||0)+h/2;
      const hw=o.rotation?Math.hypot(w,h)/2:w/2,hh=o.rotation?Math.hypot(w,h)/2:h/2;
      b=b?{x0:Math.min(b.x0,cx-hw),y0:Math.min(b.y0,cy-hh),x1:Math.max(b.x1,cx+hw),y1:Math.max(b.y1,cy+hh)}:{x0:cx-hw,y0:cy-hh,x1:cx+hw,y1:cy+hh};
    }
    return b;
  }
  function fitCanvas(){
    const v=document.getElementById("canvasViewport");if(!v)return;
    const ev=activeEvent(),world=worldSize(ev),c=planBox(ev),x0=Math.min(0,c?c.x0:0),y0=Math.min(0,c?c.y0:0),bw=Math.max(world.width,c?c.x1:0)-x0,bh=Math.max(world.height,c?c.y1:0)-y0;
    ui.zoom=Math.max(.2,Math.min((v.clientWidth-42)/bw,(v.clientHeight-42)/bh));
    ui.pan.x=(v.clientWidth-bw*ui.zoom)/2-x0*ui.zoom;ui.pan.y=(v.clientHeight-bh*ui.zoom)/2-y0*ui.zoom;
    applyCanvasTransform();
  }
  function planFullyInView(event){
    const v=document.getElementById("canvasViewport"),c=planBox(event);if(!v||!c)return true;
    return ui.pan.x+c.x0*ui.zoom>=-1&&ui.pan.y+c.y0*ui.zoom>=-1&&ui.pan.x+c.x1*ui.zoom<=v.clientWidth+1&&ui.pan.y+c.y1*ui.zoom<=v.clientHeight+1;
  }
  // The first time a canvas shows an event's objects in this session, every
  // object is on screen: if the current view would cut any off, it is fitted.
  // After that the view is the operator's — it is never refitted behind them.
  const firstViewSeen=new Set();
  function firstViewFit(event){
    if(!event||!planBox(event))return;
    const key=event.id+":"+ui.tab;if(firstViewSeen.has(key))return;firstViewSeen.add(key);
    if(!planFullyInView(event))fitCanvas();
  }
  // A grid used the column count's default (2) whatever the quantity, so 24
  // tables became 12 rows running past the bottom of the room and Seating
  // opened with most of them off-screen (§25, entry Z). When a grid would
  // leave the room and the operator has not typed a column count, it starts
  // at the room's top-left with as many columns as fit. A count the operator
  // typed is kept exactly, and so is every grid that already fits.
  function bulkLayout(d){
    const count=bulkCount(d),gapX=190,gapY=145;
    let cols=d.placement==="row"?count:Math.max(1,Math.min(count,Number(d.cols)||1)),x0=440,y0=270;
    if(d.placement==="grid"&&!d.colsChosen&&y0+(Math.ceil(count/cols)-1)*gapY+82>WORLD.height){
      x0=60;y0=60;cols=Math.max(cols,Math.min(count,Math.floor((WORLD.width-x0-120)/gapX)+1));
    }
    return{count,cols,x0,y0,gapX,gapY};
  }
  function bulkPositions(d){
    const L=bulkLayout(d),out=[];
    for(let i=0;i<L.count;i++){const c=i%L.cols,r=Math.floor(i/L.cols);out.push({x:L.x0+c*L.gapX,y:L.y0+r*L.gapY});}
    return out;
  }
  const shownCols=d=>d.placement==="grid"&&!d.colsChosen?bulkLayout(d).cols:d.cols;
  function ghostHTML(){if(!ui.v8AddOpen||ui.bulkDraft?.placement==="repeated")return"";return bulkPositions(ui.bulkDraft).map((p,i)=>`<div class="ghost-object" data-label="${esc((ui.bulkDraft.prefix||"T")+String(i+1).padStart(2,"0"))}" style="left:${p.x}px;top:${p.y}px;width:120px;height:82px"></div>`).join("");}
  const oldViewport=globalThis.canvasViewportHTML;
  function canvasViewportHTML(event,seating){
    const html=oldViewport(event,seating);if(seating)return html;
    // Both replacements go through t(), so the v8 status survives a language
    // switch instead of only matching the English string.
    return html.replace("</div><div class=\"canvas-status\"",`${ghostHTML()}</div><div class="canvas-status v8-status"`)
      .replace(t("canvas.editHint"),`${t("canvas.multiSelectHint")}<span class="status-right">${t("canvas.selectedCount",{n:ui.selectedObjectIds.length||0})}</span>`);
  }
  function floorPlanHTML(event){return`<div class="planmap-shell">${FLOORPLAN.planMapToolbarHTML(event)}${floorAnalyseHTML(event)}${FLOORPLAN.bulkPanel(event)}${canvasViewportHTML(event,false)}${floorEmptyHTML(event)}${FLOORPLAN.contextualCardHTML(event)}${FLOORPLAN.planStatusPillHTML(event)}${FLOORPLAN.addManuallyFabHTML()}</div>`;}
    return{bulkPositions,canvasViewportHTML,firstViewFit,fitCanvas,floorPlanHTML,planFullyInView,refreshGhosts,shownCols,syncBulkFields};
  }
  globalThis.MeritFloorPlanView=Object.freeze({create,DEPS:Object.freeze(["FLOORPLAN","WORLD","activeEvent","applyCanvasTransform","esc","floorAnalyseHTML","floorEmptyHTML","t","ui","worldSize"])});
})();
