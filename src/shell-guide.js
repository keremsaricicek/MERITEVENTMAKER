// The User Guide dialog as v8 shows it: renderGuide wraps the pre-v8 guide
// (app-guests.js, captured as oldGuideRender) in the product's chrome and
// language, and openGuide opens it in the UI's language. Both stay app-v8.js
// overrides of the pre-v8 globals as one-line delegates. Moved out of app-v8.js
// on 2026-11-09 (code health, capability 21 of 21, part b,
// benchmarks/CODE-HEALTH-2026-11.md), at the original indentation, by
// scripts/extract-capability.mjs. The edit forced by the move: the capture of
// the pre-v8 renderGuide reads globalThis.renderGuide, which is what it read.
//
// Everything this reads from the shell is handed to it by create(deps), once
// (`screen-modules` holds that); shell functions arrive as late-binding
// wrappers, so a body app-v8.js reassigns later is the one that runs.
(() => {
  "use strict";
  let ONBOARDING;
  let esc;
  let icon;
  let t;
  let toast;
  let ui;
  let created=false;

  function create(deps){
    if(created)throw new Error("MeritShellGuide.create() is called once, by app-v8.js.");
    created=true;
    ONBOARDING=deps.ONBOARDING;
    esc=deps.esc;
    icon=deps.icon;
    t=deps.t;
    toast=deps.toast;
    ui=deps.ui;
  const oldGuideRender=globalThis.renderGuide;
  function renderGuide(){
    const root=document.getElementById("guideRoot"),tr=ui.guideLang==="tr",title=tr?"V8 Kullanıcı Kılavuzu":"V8 User Guide",cards=tr?[
      ["Etkinlikler","Yaklaşan etkinlikler kartlarda, geçmiş etkinlikler kilitli tabloda görünür. Geçmiş satırına çift tıklayın."],["Plan ve PDF","PNG/JPG/PDF yerelde açılır. PDF sayfasını küçük önizlemelerden seçin; hiçbir dosya yüklenmez."],["Destekli Tespit","Klasik görüntü işleme adayları üretir. Sonuçlar AI değildir; onaylamadan plana eklenmez."],["Koltuk Yerleşimi","Ctrl/Shift ile çoklu seçim yapın. Grup taşıma tek işlem olarak doğrulanır; kapasite yetmezse hiçbir kayıt değişmez."],["Canlı Operasyon","No Show planlanan yeri korur ancak canlı kapasiteyi serbest bırakır. Empty Chairs kırmızı ışıklı koltuk görünümünü açar."],["Excel ve Kayıt","XLSX tamamen çevrimdışıdır. Table Plan, Guest List ve Unassigned sayfaları korunur; veriler tarayıcıda otomatik kaydedilir."]
    ]:[
      ["Events","Upcoming work appears as cards; past and Completed events are locked in History. Double-click a history row."],["Plans and PDF","PNG/JPG/PDF opens locally. Select PDF pages from thumbnails; no file is uploaded."],["Assisted Detection","Classical computer vision proposes candidates. It is not a trained AI model, and nothing is added until confirmation."],["Seating","Use Ctrl/Shift for multi-selection. Group moves validate as one transaction; insufficient capacity changes nothing."],["Live Operations","No Show preserves the planned assignment but releases live capacity. Empty Chairs opens the red-glow operational view."],["Excel and Storage","XLSX works offline. Table Plan, Guest List and Unassigned sheets remain available; browser autosave is automatic."]
    ];
    root.innerHTML=`<aside class="guide-nav"><div class="guide-brand"><strong>MERIT EVENT MAKER</strong><span>${title}</span></div></aside><section class="guide-main"><header class="guide-top"><h2>${title}</h2><div class="guide-actions"><div class="lang-toggle"><button data-guide-lang="en" class="${!tr?"active":""}">EN</button><button data-guide-lang="tr" class="${tr?"active":""}">TR</button></div><button class="btn quiet" data-guide-reset-onboarding>${tr?"İpuçlarını yeniden göster":"Show tips again"}</button><button class="btn" data-guide-print>${icon("print")}${tr?"Yazdır / PDF":"Print / PDF"}</button><button class="btn icon-only" data-guide-close aria-label="${esc(t("a11y.close"))}" title="${esc(t("a11y.close"))}">${icon("x")}</button></div></header><div class="guide-content"><div class="guide-hero"><div class="kicker">MERIT ENTERTAINMENT · ${tr?"V8 TARAYICI İNCELEMESİ":"V8 BROWSER REVIEW"}</div><h1>${title}</h1><p>${tr?"Masa planı, fiziksel koltuklar, misafirler, canlı operasyon ve doğrulanmış plan düzeltmeleri için çevrimdışı başvuru.":"Offline reference for plan objects, physical chairs, guests, live operations and verified plan corrections."}</p></div><div class="guide-v8-grid">${cards.map(([h,p])=>`<article class="guide-v8-card"><h3>${h}</h3><p>${p}</p></article>`).join("")}</div><div class="guide-tip">${tr?"Bu sürüm tarayıcı incelemesidir; EXE veya masaüstü çalışma zamanı içermez.":"This is a browser review build; it does not include an EXE or desktop runtime."}</div></div></section>`;
    root.querySelectorAll("[data-guide-lang]").forEach(b=>b.onclick=()=>{
      ui.guideLang=b.dataset.guideLang;
      renderGuide();
    });
    root.querySelector("[data-guide-close]").onclick=()=>document.getElementById("guideDialog").close();
    root.querySelector("[data-guide-print]").onclick=()=>window.print();
    root.querySelector("[data-guide-reset-onboarding]").onclick=()=>{ONBOARDING.resetOnboarding();toast(t("toast.tipsReset"),"success");};
  }
  // The guide opens in the language the app is in: ui.guideLang defaulted to
  // Turkish and nothing ever changed it, so an operator working in English
  // pressed Help and got the Turkish guide (§18). Its own EN/TR switch still
  // flips it while it is open.
  function openGuide(){ui.guideLang=ui.lang;renderGuide();document.getElementById("guideDialog").showModal();}
    return{openGuide,renderGuide};
  }
  globalThis.MeritShellGuide=Object.freeze({create,DEPS:Object.freeze(["ONBOARDING","esc","icon","t","toast","ui"])});
})();
