(() => {
  "use strict";
  // Centralized bilingual (tr-TR / en-US) string table. Every screen built or
  // touched by the Concept 3 rebuild reads strings through t(key, vars) so a
  // language switch never requires touching template code. Screens not yet
  // migrated (older Guests/Seating/Live/Reports templates) keep their literal
  // English strings until they're ported — see the migration note in
  // MERIT_I18N_STATUS below rather than assuming full app coverage.

  const STRINGS = {
    "nav.floorPlan": { en: "Floor Plan", tr: "Kat Planı" },
    "nav.guests": { en: "Guests", tr: "Misafirler" },
    "nav.seating": { en: "Seating Plan", tr: "Oturma Planı" },
    "nav.live": { en: "Live Event", tr: "Canlı Etkinlik" },
    "nav.reports": { en: "Reports", tr: "Raporlar" },
    "nav.allEvents": { en: "All Events", tr: "Tüm Etkinlikler" },

    "action.analyzePlan": { en: "Analyze Plan", tr: "Planı Analiz Et" },
    "action.confirmPlan": { en: "Confirm Plan", tr: "Planı Onayla" },
    "action.reviewCenter": { en: "Review Center", tr: "İnceleme Merkezi" },
    "action.addManually": { en: "Add Manually", tr: "Manuel Ekle" },
    "action.teachAI": { en: "Teach AI", tr: "AI'ya Öğret" },
    "action.correct": { en: "Correct", tr: "Doğru" },
    "action.change": { en: "Change", tr: "Değiştir" },
    "action.notAnObject": { en: "Not an object", tr: "Nesne Değil" },
    "action.reviewOutliers": { en: "Review outliers", tr: "Farklı Olanları İncele" },
    "action.applyToAll": { en: "Apply to all", tr: "Tümüne Uygula" },
    "action.applyStrongMatches": { en: "Apply to strong matches", tr: "Güçlü Eşleşmelere Uygula" },
    "action.choose": { en: "Choose which", tr: "Hangilerini Seç" },
    "action.aiMissed": { en: "AI Missed This", tr: "AI Bunu Kaçırdı" },
    "action.ignore": { en: "Ignore", tr: "Yoksay" },
    "action.undo": { en: "Undo", tr: "Geri Al" },
    "action.preview": { en: "Preview", tr: "Önizle" },
    "action.apply": { en: "Apply", tr: "Uygula" },
    "action.cancel": { en: "Cancel", tr: "İptal" },

    "analysis.stage.reading": { en: "Reading plan", tr: "Plan okunuyor" },
    "analysis.stage.understanding": { en: "Understanding venue", tr: "Mekan anlaşılıyor" },
    "analysis.stage.seating": { en: "Finding seating", tr: "Oturma düzeni bulunuyor" },
    "analysis.stage.labels": { en: "Reading labels", tr: "Yazılar okunuyor" },
    "analysis.stage.relating": { en: "Connecting furniture", tr: "Objeler ilişkilendiriliyor" },
    "analysis.stage.capacity": { en: "Checking capacity", tr: "Kapasite kontrol ediliyor" },
    "analysis.stage.review": { en: "Preparing review", tr: "İnceleme hazırlanıyor" },

    "plan.understood": { en: "Plan Understood", tr: "Plan Anlaşıldı" },
    "plan.diningGroups": { en: "dining groups", tr: "yemek grubu" },
    "plan.seats": { en: "seats", tr: "koltuk" },
    "plan.needsReview": { en: "items need review", tr: "öğe incelenmeli" },
    "plan.stage": { en: "stage", tr: "sahne" },
    "plan.bar": { en: "bar", tr: "bar" },
    "plan.entrances": { en: "entrances", tr: "giriş" },
    "plan.lounge": { en: "lounge area", tr: "lounge alanı" },

    "capacity.mismatchTitle": { en: "Capacity doesn't match yet", tr: "Kapasite henüz eşleşmiyor" },
    "capacity.drawingSays": { en: "The drawing says", tr: "Çizim şunu belirtiyor" },
    "capacity.iCount": { en: "I currently count", tr: "Şu anda saydığım" },
    "capacity.difference": { en: "Difference", tr: "Fark" },
    "capacity.showLikely": { en: "Show likely areas", tr: "Olası Bölgeleri Göster" },

    "teach.whatIsThis": { en: "What is this?", tr: "Bu nedir?" },
    "teach.needsHelp": { en: "AI Needs Your Help", tr: "AI Yardımına İhtiyaç Duyuyor" },
    "teach.similarFound": { en: "similar objects found", tr: "benzer obje bulundu" },
    "teach.type.round": { en: "Round Table", tr: "Yuvarlak Masa" },
    "teach.type.square": { en: "Square Table", tr: "Kare Masa" },
    "teach.type.rectangle": { en: "Rectangle Table", tr: "Dikdörtgen Masa" },
    "teach.type.bistro": { en: "Bistro Table", tr: "Bistro Masası" },
    "teach.type.chair": { en: "Chair", tr: "Sandalye" },
    "teach.type.armchair": { en: "Armchair", tr: "Koltuk" },
    "teach.type.sofa": { en: "Sofa / Bench", tr: "Sofa / Sedir" },
    "teach.type.stage": { en: "Stage", tr: "Sahne" },
    "teach.type.bar": { en: "Bar", tr: "Bar" },
    "teach.type.entrance": { en: "Entrance", tr: "Giriş" },
    "teach.type.exit": { en: "Exit", tr: "Çıkış" },
    "teach.type.column": { en: "Column", tr: "Kolon" },
    "teach.type.lounge": { en: "Lounge Object", tr: "Lounge Objesi" },
    "teach.type.other": { en: "Other", tr: "Diğer" },
    "teach.type.ignore": { en: "Ignore", tr: "Yoksay" },

    "question.yesGroup": { en: "Yes, one group", tr: "Evet, tek grup" },
    "question.noSeparate": { en: "No, separate tables", tr: "Hayır, ayrı masalar" },
    // AI-generated question text keyed by semantic type, never a hardcoded
    // English string — plan-intelligence.js emits {questionType, questionParams}
    // and app-v8.js's questionText() renders it through this table so a
    // Turkish UI never leaks English question text.
    "question.combinedDiningGroup": { en: "Do these {memberCount} connected tables operate as one seating group?", tr: "Bu {memberCount} bitişik masa tek bir oturma grubu olarak mı kullanılıyor?" },
    "review.center": { en: "Review Center", tr: "İnceleme Merkezi" },
    "review.difficultQuestions": { en: "Difficult questions", tr: "Zor Sorular" },
    "review.consistentOf": { en: "consistent", tr: "tutarlı" },
    "review.needReview": { en: "need review", tr: "inceleme gerekli" },
    "review.editManually": { en: "Edit plan manually", tr: "Planı manuel düzenle" },
    "review.noGroups": { en: "No grouped review items.", tr: "Gruplandırılmış inceleme öğesi yok." },
    "action.answer": { en: "Answer", tr: "Yanıtla" },
    "review.group": { en: "review group", tr: "inceleme grubu" },
    "review.groups": { en: "review groups", tr: "inceleme grubu" },
    "poi.seats": { en: "seats", tr: "koltuk" },
    "poi.unreviewed": { en: "Unreviewed", tr: "İncelenmedi" },
    "poi.confirmed": { en: "Confirmed", tr: "Onaylandı" },
    "poi.rejected": { en: "Rejected", tr: "Reddedildi" },
    "ocr.unavailable": { en: "OCR unavailable in this session ({reason}) — capacity audit skipped, not fabricated.", tr: "Bu oturumda OCR kullanılamıyor ({reason}) — kapasite denetimi atlandı, uydurulmadı." },

    "diag.notInstalled": { en: "DOMAIN MODEL NOT INSTALLED", tr: "ALAN MODELİ KURULU DEĞİL" },
    "diag.classicalCV": { en: "Classical computer vision is active; no trained Merit model is installed in this browser review.", tr: "Klasik görüntü işleme aktif; bu tarayıcı incelemesinde eğitilmiş bir Merit modeli kurulu değil." },
  };

  function currentLang() {
    return (typeof ui !== "undefined" && ui.lang === "tr") ? "tr" : "en";
  }

  function t(key, vars) {
    const entry = STRINGS[key];
    let str = entry ? (entry[currentLang()] || entry.en) : key;
    if (vars) for (const k in vars) str = str.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
    return str;
  }

  globalThis.t = t;
  globalThis.MERIT_I18N_LANG = currentLang;
  globalThis.MERIT_I18N_STATUS = {
    coverage: "Floor Plan / Plan Intelligence / Review Center / Teach AI / navigation / AI-generated question text (semantic type+params, see questionText() in app-v8.js) only.",
    notMigrated: ["Guests table screen", "Seating Plan legacy labels", "Live Event legacy labels", "Reports screen", "Guide/Help content"],
    note: "Foundation is real and working (see the language toggle in the top bar); full-app string migration is a follow-up pass, not implemented in this one.",
  };
})();
