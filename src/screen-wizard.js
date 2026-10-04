// The guest-import wizard's presentation: the five-step rail, the source
// preview, the column mapping, the paged interpretation table, the summary
// and the footer, and the dialog render that restores focus after each step.
//
// Moved byte-for-byte out of app-v8.js on 2026-10-04 (technical gaps, item 2),
// at the original indentation. The edits forced by the move: the seven
// overridden renderers become this module's own functions (app-v8.js keeps
// the overrides and calls through), and pendingImport is read through
// getPendingImport(), because app-guests.js replaces that object at every
// step. Reading, mapping, interpreting and importing stay in app-guests.js —
// nothing is written until step 5, and that rule is not this module's.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that).
(() => {
  "use strict";
  let bindExcelWizard;
  let esc;
  let getPendingImport;
  let icon;
  let importSummary;
  let MAP_FIELDS;
  let t;
  let translateImportIssue;
  let ui;
  let created=false;

  // ---- Excel import wizard: same design language, same five steps ------
  // Presentation only. app-guests.js keeps the reading, mapping, interpreting
  // and importing logic untouched -- including the rule that nothing is
  // written until step 5 and that blocking errors disable the import.
  const WIZ_STEPS=["wiz.step.file","wiz.step.preview","wiz.step.mapping","wiz.step.interpret","wiz.step.summary"];
  const wizardStepsHTML = function(step){
    return`<div class="wz-rail">${WIZ_STEPS.map((k,i)=>`<div class="wz-node ${step===i+1?"active":step>i+1?"done":""}"><i>${step>i+1?"✓":i+1}</i><span>${t(k)}</span></div>`).join("")}</div>`;
  };
  // Labels are translated; the option VALUE stays the identifier the importer
  // writes against, so a Turkish UI never changes what a column maps to.
  const mappingRowsHTML = function(p){
    return p.headers.map(h=>`<div class="wz-map"><div class="wz-map-src" title="${esc(h)}">${esc(h)}</div><div class="wz-map-arrow">→</div><select data-map-header="${esc(h)}" aria-label="${esc(t("wiz.mapColumn",{column:h}))}">${MAP_FIELDS.map(([v])=>`<option value="${v}" ${p.mapping[h]===v?"selected":""}>${t(v?"wiz.map."+v:"wiz.map.ignore")}</option>`).join("")}</select></div>`).join("");
  };
  const sourcePreviewHTML = function(p){
    return`<table class="wz-table"><thead><tr><th>#</th>${p.headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${p.rows.slice(0,15).map((row,i)=>`<tr><td>${i+1}</td>${p.headers.map(h=>`<td>${esc(row[h])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };
  // The message the importer stored stays English -- app-guests.js matches on
  // it to decide which issues survive a re-check. Only the drawn text changes.
  function wizIssueText(message){
    return typeof translateImportIssue==="function"?translateImportIssue(message):message;
  }
  const interpretRowHTML = function(r,i){
    const issues=r.issues||[];
    const cellName=key=>esc(t("wiz.rowField",{field:t(key),n:i+1}));
    const sel=(field,values,current,key)=>`<select data-interp-row="${i}" data-interp-field="${field}" aria-label="${cellName(key)}">${values.map(v=>`<option value="${v}" ${current===v?"selected":""}>${field==="planningStatus"?t("status.planning."+v):esc(v)}</option>`).join("")}</select>`;
    return`<tr>
      <td class="src" title="${esc(r.sourceName)}">${esc(r.sourceName)}</td>
      <td><input data-interp-row="${i}" data-interp-field="name" aria-label="${cellName("wiz.map.name")}" value="${esc(r.name)}"></td>
      <td class="num"><input data-interp-row="${i}" data-interp-field="additionalGuests" aria-label="${cellName("wiz.col.additional")}" type="number" min="0" value="${r.additionalGuests}"></td>
      <td class="pax"><b>${r.pax}</b></td>
      <td>${sel("planningStatus",["Confirmed","Tentative"],r.planningStatus,"wiz.map.planningStatus")}</td>
      <td>${sel("vip",["Standard","VIP","VVIP"],r.vip,"wiz.map.vip")}</td>
      <td><input data-interp-row="${i}" data-interp-field="tableNumber" aria-label="${cellName("wiz.col.table")}" value="${esc(r.tableNumber||"")}"></td>
      <td><input data-interp-row="${i}" data-interp-field="seatText" aria-label="${cellName("wiz.col.seat")}" value="${esc(r.seatText||"")}"></td>
      <td>${issues.length?issues.map(x=>`<div class="wz-issue ${x.level}">⚠ ${esc(wizIssueText(x.message))}</div>`).join(""):`<span class="wz-ok">✓ ${t("wiz.ready")}</span>`}</td>
    </tr>`;
  };
  // The interpretation step drew EVERY row as five editable controls: 2,000
  // rows froze the page for 3.9 s, 10,000 for 17.9 s, and each correction
  // redrew them all again (measured 2026-10-04, benchmarks/perf/large-files.mjs).
  // It now draws one page of rows; the pager and the "needs attention" filter
  // reach every row, and every row is still imported. A list that fits on one
  // page looks exactly as before.
  const INTERP_PAGE=200;
  function interpWindow(p){
    const rows=p.interpreted,attention=rows.reduce((n,r)=>n+(r.issues&&r.issues.length?1:0),0);
    const flagged=p.interpFilter==="attention";
    const idx=flagged?rows.flatMap((r,i)=>r.issues&&r.issues.length?[i]:[]):null,total=flagged?idx.length:rows.length;
    const pages=Math.max(1,Math.ceil(total/INTERP_PAGE)),page=Math.min(Math.max(0,p.interpPage|0),pages-1),from=page*INTERP_PAGE,to=Math.min(total,from+INTERP_PAGE);
    const out=flagged?idx.slice(from,to):Array.from({length:to-from},(_,k)=>from+k);
    if(rows.length<=INTERP_PAGE&&!flagged)return{rows:out,pager:""};
    const n=(x)=>x.toLocaleString(ui.lang==="tr"?"tr-TR":"en-US");
    const pager=`<div class="wz-pager" role="group" aria-label="${t("wiz.pager.label")}">
      <span class="wz-pager-range" aria-live="polite">${t(flagged?"wiz.pager.rangeAttention":"wiz.pager.range",{from:n(total?from+1:0),to:n(to),total:n(total)})}</span>
      ${attention||flagged?`<button class="btn sm" type="button" data-interp-filter="${flagged?"all":"attention"}" aria-pressed="${flagged}">${t("wiz.pager.attentionOnly",{n:n(attention)})}</button>`:""}
      <button class="btn sm" type="button" data-interp-page="${page-1}" ${page===0?"disabled":""}>${t("wiz.pager.prev",{n:INTERP_PAGE})}</button>
      <label class="wz-pager-goto">${t("wiz.pager.page")} <input type="number" min="1" max="${pages}" value="${page+1}" data-interp-goto aria-label="${t("wiz.pager.pageField",{n:n(pages)})}"> ${t("wiz.pager.pageOf",{n:n(pages)})}</label>
      <button class="btn sm" type="button" data-interp-page="${page+1}" ${page>=pages-1?"disabled":""}>${t("wiz.pager.next",{n:INTERP_PAGE})}</button>
    </div>`;
    return{rows:out,pager};
  }
  const wizardBodyHTML = function(p){
    if(p.step===1&&p.reading)return`<div class="wz-drop" aria-busy="true"><div class="wz-reading" role="status">${t("wiz.reading",{file:esc(p.reading)})}</div></div>`;
    if(p.step===1)return`<div class="wz-drop">${icon("download")}<h3>${t("wiz.chooseTitle")}</h3><p>${t("wiz.chooseNote")}</p><div class="toolbar-row" style="justify-content:center;margin-top:6px"><button class="btn" data-wizard-template>${icon("download")}${t("wiz.template")}</button><button class="btn primary" data-wizard-choose>${icon("plus")}${t("wiz.choose")}</button></div></div>`;
    if(p.step===2)return`<h3 class="wz-title">${t("wiz.previewTitle")}</h3><p class="wz-note">${t("wiz.previewNote",{file:esc(p.fileName),shown:Math.min(15,p.rows.length),total:p.rows.length})}</p><div class="wz-scroll">${sourcePreviewHTML(p)}</div>`;
    if(p.step===3)return`<h3 class="wz-title">${t("wiz.mapTitle")}</h3><p class="wz-note">${t("wiz.mapNote")}</p><div style="max-width:780px">${mappingRowsHTML(p)}</div>`;
    if(p.step===4){const w=interpWindow(p);return`<h3 class="wz-title">${t("wiz.interpTitle")}</h3><p class="wz-note">${t("wiz.interpNote")}</p>${w.pager}<div class="wz-scroll"><table class="wz-table interp"><colgroup><col class="c-source"><col class="c-name"><col class="c-num"><col class="c-num"><col class="c-status"><col class="c-vip"><col class="c-table"><col class="c-seat"><col class="c-check"></colgroup><thead><tr><th>${t("wiz.col.source")}</th><th>${t("wiz.map.name")}</th><th>${t("wiz.col.additional")}</th><th>${t("wiz.col.totalPax")}</th><th>${t("wiz.map.planningStatus")}</th><th>${t("wiz.map.vip")}</th><th>${t("wiz.col.table")}</th><th>${t("wiz.col.seat")}</th><th>${t("wiz.col.validation")}</th></tr></thead><tbody>${w.rows.length?w.rows.map((i)=>interpretRowHTML(p.interpreted[i],i)).join(""):`<tr><td colspan="9" class="wz-empty">${t("wiz.pager.noneFlagged")}</td></tr>`}</tbody></table></div>`;}
    const s=importSummary(p.interpreted);
    return`<h3 class="wz-title">${t("wiz.sumTitle")}</h3><p class="wz-note">${t("wiz.sumNote")}</p>
      <div class="wz-sum">
        <div><span>${t("wiz.sum.records")}</span><b>${s.records}</b></div>
        <div><span>${t("wiz.sum.guests")}</span><b>${s.guests}</b></div>
        <div><span>${t("wiz.sum.confirmed")}</span><b>${s.confirmed}</b></div>
        <div><span>${t("wiz.sum.tentative")}</span><b>${s.tentative}</b></div>
        <div><span>${t("wiz.sum.attention")}</span><b>${s.attention}</b></div>
      </div>
      ${s.errors?`<div class="wz-banner stop">${t("wiz.blocking",{n:s.errors})}</div>`:`<div class="wz-banner ok">${t("wiz.readyToImport",{records:s.records,guests:s.guests})}</div>`}`;
  };
  const wizardFootHTML = function(p){
    if(p.step===1)return`<button class="btn" data-wizard-close>${t("setup.cancel")}</button>`;
    const back=`<button class="btn" data-wizard-back>${t("wiz.back")}</button>`;
    if(p.step===2)return`${back}<button class="btn primary" data-wizard-next>${t("wiz.toMapping")}${icon("arrow")}</button>`;
    if(p.step===3)return`${back}<button class="btn primary" data-wizard-next>${t("wiz.toInterpret")}${icon("arrow")}</button>`;
    if(p.step===4)return`${back}<button class="btn primary" data-wizard-next>${t("wiz.toSummary")}${icon("arrow")}</button>`;
    const s=importSummary(p.interpreted);
    return`${back}<button class="btn primary" data-wizard-import ${s.errors?"disabled":""}>${t("wiz.import")}</button>`;
  };
  const renderExcelWizard = function(){
    const root=document.getElementById("excelWizard"),p=getPendingImport();if(!p||!root)return;
    // id="wizTitle" is what #excelDialog's aria-labelledby points at, so the
    // dialog announces itself by name rather than as an unnamed dialog.
    // Every step re-renders the whole dialog, which destroys the control that
    // had focus -- the Continue button just pressed, or the cell just edited.
    // Remember WHERE focus was, by attribute, and put it back afterwards;
    // failing that, land on the step's own primary control. Never the close
    // button, which showModal() would otherwise pick as the first focusable.
    const was=document.activeElement&&root.contains(document.activeElement)?document.activeElement:null;
    const wasSel=was&&(was.dataset.interpRow!=null?`[data-interp-row="${was.dataset.interpRow}"][data-interp-field="${was.dataset.interpField}"]`
      :was.dataset.mapHeader!=null?`[data-map-header="${CSS.escape(was.dataset.mapHeader)}"]`:null);
    root.innerHTML=`<div class="wz-head"><h2 id="wizTitle">${t("wiz.title")}</h2><button class="table-card-close" data-wizard-close aria-label="${t("wiz.close")}" title="${t("wiz.close")}">&times;</button></div>${wizardStepsHTML(p.step)}<div class="wz-body">${wizardBodyHTML(p)}</div><div class="wz-foot">${wizardFootHTML(p)}</div>`;
    bindExcelWizard();
    root.querySelectorAll("[data-interp-page]").forEach(b=>b.onclick=()=>{p.interpPage=Number(b.dataset.interpPage);renderExcelWizard();root.querySelector(".wz-scroll")?.scrollTo(0,0);});
    root.querySelectorAll("[data-interp-goto]").forEach(f=>f.onchange=()=>{const v=Math.round(Number(f.value));if(!Number.isFinite(v))return;p.interpPage=Math.max(0,Math.min(Number(f.max)||1,v)-1);renderExcelWizard();root.querySelector("[data-interp-goto]")?.focus();});
    root.querySelectorAll("[data-interp-filter]").forEach(b=>b.onclick=()=>{p.interpFilter=b.dataset.interpFilter;p.interpPage=0;renderExcelWizard();});
    // In PRIORITY order, not document order: Back precedes Continue in the footer.
    const primary=(wasSel&&root.querySelector(wasSel))||["[data-wizard-choose]","[data-wizard-next]","[data-wizard-import]:not([disabled])","[data-wizard-back]"].map(q=>root.querySelector(q)).find(Boolean);
    if(primary){
      root.querySelectorAll("[autofocus]").forEach(el=>el.removeAttribute("autofocus"));
      primary.setAttribute("autofocus","");
      if(document.getElementById("excelDialog")?.open)primary.focus();
    }
  };

  function create(deps){
    if(created)throw new Error("MeritScreenWizard.create() is called once, by app-v8.js.");
    created=true;
    bindExcelWizard=deps.bindExcelWizard;
    esc=deps.esc;
    getPendingImport=deps.getPendingImport;
    icon=deps.icon;
    importSummary=deps.importSummary;
    MAP_FIELDS=deps.MAP_FIELDS;
    t=deps.t;
    translateImportIssue=deps.translateImportIssue;
    ui=deps.ui;
    return{wizardStepsHTML,mappingRowsHTML,sourcePreviewHTML,interpretRowHTML,wizardBodyHTML,wizardFootHTML,renderExcelWizard};
  }
  globalThis.MeritScreenWizard=Object.freeze({create,DEPS:Object.freeze(["bindExcelWizard","esc","getPendingImport","icon","importSummary","MAP_FIELDS","t","translateImportIssue","ui"])});
})();
