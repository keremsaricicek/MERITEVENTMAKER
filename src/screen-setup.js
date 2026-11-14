// The new-event form and plan-file intake: the setup screen's markup and
// binding, the draft it fills, the cover and plan file readers (PNG/JPG/PDF,
// with the PDF page picker), creating a blank event from the form, and "same
// layout, no guests" from a past event. Moved out of app-v8.js on 2026-11-08
// (code health, capability 2 of 21, benchmarks/CODE-HEALTH-2026-11.md), at the
// original indentation, by scripts/extract-capability.mjs. The edits forced by
// the move: `state` is read through getState() (the shell reassigns it) and
// MeritVenueModel through globalThis. The draft is this file's own: the
// calendar's "new event on this day" reads it through currentDraft(), because
// startNewEvent replaces it rather than editing it. A blank event stays blank:
// the event this creates carries no tables, guests or sample data — the rule is
// the shell's createEvent path, not this file's (no-sample-specific-runtime-logic).
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let audit;
  let clone;
  let esc;
  let getState;
  let icon;
  let migrateEvent;
  let nowISO;
  let openEvent;
  let render;
  let saveState;
  let t;
  let toast;
  let topBrand;
  let ui;
  let uid;
  let userError;
  let userMessage;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritScreenSetup.create() is called once, by app-v8.js.");
    created=true;
    audit=deps.audit;
    clone=deps.clone;
    esc=deps.esc;
    getState=deps.getState;
    icon=deps.icon;
    migrateEvent=deps.migrateEvent;
    nowISO=deps.nowISO;
    openEvent=deps.openEvent;
    render=deps.render;
    saveState=deps.saveState;
    t=deps.t;
    toast=deps.toast;
    topBrand=deps.topBrand;
    ui=deps.ui;
    uid=deps.uid;
    userError=deps.userError;
    userMessage=deps.userMessage;
  function setupHTML(){
    const d=newEventDraft;
    const statuses=["Planning","Confirmed","Live"];
    return`<section class="mx-setup">
      <header class="mx-setup-top">${topBrand()}<button class="btn" data-setup="cancel">${icon("x")}${t("setup.cancel")}</button></header>
      <div class="mx-setup-body">
        <section class="mx-panel">
          <div class="kicker">${t("setup.eyebrow")}</div>
          <h2>${t("setup.title")}</h2>
          <p>${t("setup.subtitle")}</p>
          <form id="v8EventForm" class="mx-form">
            <div class="field full"><label for="fld-name-name">${t("setup.eventName")}</label><input id="fld-name-name" name="name" required autocomplete="off" value="${esc(d.name)}" placeholder="${t("setup.eventNamePh")}"></div>
            <div class="field"><label for="fld-name-date">${t("setup.date")}</label><input id="fld-name-date" name="date" type="date" required value="${esc(d.date)}"></div>
            <div class="field"><label for="fld-name-status">${t("setup.status")}</label><select id="fld-name-status" name="status">${statuses.map(s=>`<option value="${s}" ${d.status===s?"selected":""}>${t("setup.status."+s)}</option>`).join("")}</select></div>
            <div class="field"><label for="fld-name-hotel">${t("setup.hotel")}</label><input id="fld-name-hotel" name="hotel" required value="${esc(d.hotel)}" placeholder="${t("setup.hotelPh")}"></div>
            <div class="field"><label for="fld-name-salon">${t("setup.salon")}</label><input id="fld-name-salon" name="salon" value="${esc(d.salon)}" placeholder="${t("setup.salonPh")}"></div>
            <div class="field full"><label>${t("setup.cover")} · ${t("setup.coverOptional")}</label>
              <label class="mx-drop cover" data-cover-drop>${d.coverImage?`<img src="${d.coverImage}" alt="">`:`<span>${icon("image")} ${t("setup.chooseCover")}</span>`}<input id="v8CoverFile" type="file" accept="image/png,image/jpeg" hidden></label>
              ${d.coverImage?`<div class="mx-setup-actions" style="margin-top:9px"><button class="btn sm" type="button" data-setup="remove-cover">${t("setup.removeCover")}</button></div>`:""}
            </div>
          </form>
        </section>
        <section class="mx-panel">
          <div class="kicker">${t("setup.planEyebrow")}</div>
          <h2>${t("setup.planTitle")}</h2>
          <p>${t("setup.planSubtitle")}</p>
          <label class="mx-drop" id="v8PlanDrop">${d.planSrc?`<img src="${d.planSrc}" alt=""><strong>${esc(d.planName)}</strong>`:`${icon("image")}<strong>${t("setup.dropPlan")}</strong><span>${t("setup.dropPlanHint")}</span>`}<input id="v8PlanFile" type="file" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" hidden></label>
          ${d.pdfPages?.length?`<div class="pdf-pages">${d.pdfPages.map((p,i)=>`<button class="pdf-page ${d.pdfPage===i?"active":""}" type="button" data-pdf-page="${i}"><canvas data-pdf-thumb="${i}"></canvas><span>${t("setup.page",{n:i+1})}</span></button>`).join("")}</div>`:""}
          ${d.planSrc?`<div class="mx-setup-actions" style="margin-top:11px;justify-content:flex-start"><button class="btn sm" data-setup="replace-plan">${t("setup.replacePlan")}</button><button class="btn sm danger" data-setup="remove-plan">${t("setup.removePlan")}</button></div>`:""}
          <p class="mx-note">${t("setup.privacy")}</p>
          <div class="mx-setup-actions">
            <button class="btn" data-setup="blank" ${ui.setupBusy?"disabled":""}>${t("setup.continueBlank")}</button>
            <button class="btn primary" data-setup="create" ${ui.setupBusy?"disabled":""}>${ui.setupBusy?t("setup.preparing"):t("setup.create")}${icon("arrow")}</button>
          </div>
        </section>
      </div>
    </section>`;
  }
  let newEventDraft={name:"",date:"",hotel:"",salon:"",status:"Planning",coverImage:"",planSrc:"",planName:"",pdfDoc:null,pdfPages:[],pdfPage:0,pdfSource:null};
  // SAME LAYOUT, NO GUESTS (owner 2026-11-02, "geçen etkinlikten kopyala"). A new
  // event at the same venue starts from the last one's room: its tables (numbers,
  // capacities, real chairs, positions), venue objects and plan — never its guests,
  // seats, arrivals, history or decisions. Dated a week ahead so it is not born
  // historical (a past date would make it immutable); the operator renames it.
  function duplicateLayout(id){
    const src=getState().events.find(e=>e.id===id);if(!src)return;
    const c=clone({tables:src.tables||[],venueObjects:src.venueObjects||[],background:src.background||null});
    c.tables.forEach(t=>{t.id=uid("table");});
    c.venueObjects.forEach(o=>{o.id=uid("venue");});
    const event=migrateEvent({id:uid("event"),name:src.name+" — "+t("home.duplicateLayout"),date:new Date(Date.now()+7*86400000).toLocaleDateString("en-CA"),hotel:src.hotel||"",salon:src.salon||"",
      status:"Planning",coverImage:src.coverImage||"",tables:c.tables,venueObjects:c.venueObjects,guests:[],background:c.background||undefined,createdAt:nowISO(),lastModified:nowISO()});
    getState().events.unshift(event);saveState();toast(t("toast.layoutCopied"),"success");openEvent(event.id);
  }
  // The draft is replaced, not edited, by startNewEvent, so a reader outside the
  // setup screen asks for the current one rather than holding a copy.
  function currentDraft(){return newEventDraft;}
  function startNewEvent(){newEventDraft={name:"",date:new Date(Date.now()+7*86400000).toLocaleDateString("en-CA"),hotel:"",salon:"",status:"Planning",coverImage:"",planSrc:"",planName:"",pdfDoc:null,pdfPages:[],pdfPage:0,pdfSource:null};ui.screen="new-event";render();}
  function syncSetupFields(){const f=document.getElementById("v8EventForm");if(!f)return;const data=new FormData(f);for(const k of ["name","date","hotel","salon","status"])newEventDraft[k]=String(data.get(k)||"");}
  function readDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});}
  // An image is accepted only once the browser has actually DECODED it. The
  // plan, cover and replace paths used to store whatever bytes a .png/.jpg
  // name carried, so a truncated or mislabelled file became the event's floor
  // plan: a broken image under every table, and Assisted Detection run on
  // nothing. Refusing here leaves the current plan exactly as it was.
  function decodableImage(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>img.naturalWidth>0?resolve(src):reject(userError(t("plan.notAnImage")));img.onerror=()=>reject(userError(t("plan.notAnImage")));img.src=src;});}
  async function readImageFile(file){return decodableImage(await readDataURL(file));}
  function waitForPdf(){if(globalThis.MeritPdf)return Promise.resolve(globalThis.MeritPdf);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Offline PDF renderer did not initialize.")),15000);addEventListener("merit-pdf-ready",()=>{clearTimeout(timer);resolve(globalThis.MeritPdf);},{once:true});});}
  // What the PDF page carries besides its pixels (src/plan-pdf-text.js): its
  // text objects in the raster's own pixels, and what it is drawn with. Kept
  // on the plan beside the image, so the analysis can use the document's own
  // words where it would otherwise read them off pixels. A page whose text
  // cannot be read is still a plan: the image is kept and this says why.
  async function pdfSourceOf(page,viewport,canvas){
    const P=globalThis.MeritPdfText;if(!P)return null;
    let text;
    try{text=P.itemsFromTextContent(await page.getTextContent(),viewport.transform);}
    catch{return{page:page.pageNumber,kind:"UNREAD",reasonCode:"TEXT_LAYER_FAILED"};}
    let vector={paths:null,images:null,text:null};
    try{
      const ops=await page.getOperatorList(),OPS=globalThis.pdfjsLib?.OPS;vector=P.vectorSummary(ops,OPS);
      const shapes=P.vectorShapes(ops,OPS,viewport.transform);vector.shapes=P.shapeSummary(shapes);
      // Furniture the document draws as repeated shapes (src/plan-vector-objects.js),
      // kept compact on the plan so the analysis can use exact geometry where a
      // scan would have to be interpreted. Proposals, never decisions.
      const VO=globalThis.MeritPlanVectorObjects;
      if(VO){
        const props=VO.propose(shapes.shapes,{width:canvas.width,height:canvas.height,texts:text.items.map(it=>({text:it.text,cx:(it.box.x0+it.box.x1)/2,cy:(it.box.y0+it.box.y1)/2}))});
        const r=b=>({cls:b.cls,cx:Math.round(b.cx*10)/10,cy:Math.round(b.cy*10)/10,w:Math.round(b.w*10)/10,h:Math.round(b.h*10)/10,angle:b.angle||0});
        vector.objects={reason:props.reason,groups:props.groups,tables:props.tables.slice(0,3000).map(r),chairs:props.chairs.slice(0,9000).map(r)};
      }
    }catch{vector.reasonCode="OPERATORS_FAILED";}
    return{page:page.pageNumber,scale:viewport.scale,width:canvas.width,height:canvas.height,kind:P.sourceKind(vector,text.items.length),content:P.contentClass(vector),
      text:{items:text.items,dropped:text.dropped,truncated:text.truncated},vector};
  }
  async function selectPdfPage(index){
    const doc=newEventDraft.pdfDoc;if(!doc)return;ui.setupBusy=true;render();
    const page=await doc.getPage(index+1),viewport=page.getViewport({scale:2.6}),canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
    newEventDraft.pdfSource=await pdfSourceOf(page,viewport,canvas);
    newEventDraft.pdfPage=index;newEventDraft.planSrc=canvas.toDataURL("image/png",.96);newEventDraft.planName=`${newEventDraft.pdfName} · page ${index+1}`;ui.setupBusy=false;render();requestAnimationFrame(renderPdfThumbs);
  }
  async function handlePlanFile(file){
    if(!file)return;syncSetupFields();const lower=file.name.toLowerCase();
    if(file.type==="application/pdf"||lower.endsWith(".pdf")){
      try{
        ui.setupBusy=true;
        render();
        const pdf=await waitForPdf(),doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
        newEventDraft.pdfDoc=doc;
        newEventDraft.pdfName=file.name;
        newEventDraft.pdfPages=Array.from({length:doc.numPages},(_,i)=>i);
        ui.setupBusy=false;
        await selectPdfPage(0);
        toast(t(doc.numPages===1?"toast.pdfPageOne":"toast.pdfPages",{n:doc.numPages}),"success",4500);
      }catch(error){
        ui.setupBusy=false;
        render();
        toast(t("setup.planReadFailed",{reason:userMessage(error,"plan.fileUnreadable")}),"error",6000);
      }
      return;
    }
    if(!(file.type==="image/png"||file.type==="image/jpeg"||/\.(png|jpe?g)$/.test(lower)))return toast(t("toast.chooseImageType"),"error");
    let planSrc;try{planSrc=await readImageFile(file);}catch{return toast(t("plan.unreadableImage"),"error",6500);}
    newEventDraft.planSrc=planSrc;newEventDraft.planName=file.name;newEventDraft.pdfDoc=null;newEventDraft.pdfPages=[];newEventDraft.pdfSource=null;render();
  }
  async function renderPdfThumbs(){
    const doc=newEventDraft.pdfDoc;if(!doc)return;
    // bindSetup() runs on every render and schedules this each time, and
    // choosing a page renders twice — so two passes could reach the SAME
    // canvas, and PDF.js throws "Cannot use the same canvas during multiple
    // render() operations" into the page (§28: the first suite to pick a PDF
    // page found it). A canvas is claimed before its first await, and a
    // thumbnail that cannot be drawn stays blank rather than throwing: it is
    // a preview, and the page itself is rendered separately on selection.
    for(const canvas of document.querySelectorAll("[data-pdf-thumb]")){
      if(canvas.dataset.thumbState)continue;canvas.dataset.thumbState="rendering";
      try{const index=Number(canvas.dataset.pdfThumb),page=await doc.getPage(index+1),v=page.getViewport({scale:.28});canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);await page.render({canvasContext:canvas.getContext("2d"),viewport:v}).promise;canvas.dataset.thumbState="done";}
      catch(error){canvas.dataset.thumbState="failed";}
    }
  }
  function createBlankEventFromSetup(usePlan){
    syncSetupFields();const d=newEventDraft;if(!d.name.trim()||!d.date||!d.hotel.trim()){toast(t("toast.eventFieldsRequired"),"error");return;}
    const event=migrateEvent({id:uid("event"),name:d.name.trim(),date:d.date,hotel:d.hotel.trim(),salon:d.salon.trim(),status:d.status,coverImage:d.coverImage,tables:[],venueObjects:[],guests:[],background:{src:usePlan?d.planSrc:"",name:usePlan?d.planName:"",opacity:.34,visible:!!(usePlan&&d.planSrc),locked:true,isDefault:false,scale:100,...(usePlan&&d.planSrc?{importedAtMs:Date.now()}:{}),...(usePlan&&d.planSrc&&d.pdfSource?{pdfSource:d.pdfSource}:{})},createdAt:nowISO(),lastModified:nowISO()});
    getState().events.unshift(event);if(globalThis.MeritVenueModel)globalThis.MeritVenueModel.migrateVenues(getState());audit(event,"EVENT_CREATED",{blank:!event.background.src,hotel:event.hotel,salon:event.salon});saveState();ui.activeEventId=event.id;ui.screen="workspace";ui.tab="floor";ui.leftCollapsed=true;render();toast(t(event.background.src?"toast.eventCreatedWithPlan":"toast.blankEventCreated"),"success",5000);
  }
  function bindSetup(){
    document.querySelector("[data-setup='cancel']").onclick=()=>{ui.screen="events";render();};
    const drop=document.getElementById("v8PlanDrop"),input=document.getElementById("v8PlanFile");drop.onclick=e=>{if(e.target===input)return;e.preventDefault();input.click();};input.onchange=()=>handlePlanFile(input.files[0]);
    drop.ondragover=e=>{e.preventDefault();drop.classList.add("dragging")};drop.ondragleave=()=>drop.classList.remove("dragging");drop.ondrop=e=>{e.preventDefault();drop.classList.remove("dragging");handlePlanFile(e.dataTransfer.files[0]);};
    document.querySelector("[data-cover-drop]").onclick=e=>{const f=document.getElementById("v8CoverFile");if(e.target===f)return;e.preventDefault();f.click();};document.getElementById("v8CoverFile").onchange=async e=>{const f=e.target.files[0];if(f){syncSetupFields();let cover;try{cover=await readImageFile(f);}catch{return toast(t("plan.unreadableImage"),"error",6500);}newEventDraft.coverImage=cover;render();}};
    document.querySelectorAll("[data-pdf-page]").forEach(b=>b.onclick=e=>{e.stopPropagation();syncSetupFields();selectPdfPage(Number(b.dataset.pdfPage));});
    document.querySelector("[data-setup='remove-cover']")?.addEventListener("click",e=>{e.preventDefault();syncSetupFields();newEventDraft.coverImage="";render();});
    document.querySelector("[data-setup='replace-plan']")?.addEventListener("click",e=>{e.preventDefault();input.click();});
    document.querySelector("[data-setup='remove-plan']")?.addEventListener("click",e=>{e.preventDefault();syncSetupFields();Object.assign(newEventDraft,{planSrc:"",planName:"",pdfDoc:null,pdfPages:[],pdfPage:0,pdfSource:null});render();});
    document.querySelector("[data-setup='blank']").onclick=e=>{e.preventDefault();createBlankEventFromSetup(false);};document.querySelector("[data-setup='create']").onclick=e=>{e.preventDefault();createBlankEventFromSetup(true);};
    requestAnimationFrame(renderPdfThumbs);
  }
    return{bindSetup,currentDraft,duplicateLayout,pdfSourceOf,readImageFile,setupHTML,startNewEvent,waitForPdf};
  }
  globalThis.MeritScreenSetup=Object.freeze({create,DEPS:Object.freeze(["audit","clone","esc","getState","icon","migrateEvent","nowISO","openEvent","render","saveState","t","toast","topBrand","ui","uid","userError","userMessage"])});
})();
