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
    "teach.type.text": { en: "Text / Label", tr: "Yazı / Etiket" },
    "teach.type.other": { en: "Other", tr: "Diğer" },
    "teach.type.ignore": { en: "Ignore", tr: "Yoksay" },
    "taxonomy.tables": { en: "Tables", tr: "Masalar" },
    "taxonomy.objects": { en: "Other Objects", tr: "Diğer Nesneler" },

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
    "poi.fromMemory": { en: "Remembered from your earlier correction on this plan", tr: "Bu plandaki önceki düzeltmenizden hatırlandı" },
    "ocr.unavailable": { en: "OCR unavailable in this session ({reason}) — capacity audit skipped, not fabricated.", tr: "Bu oturumda OCR kullanılamıyor ({reason}) — kapasite denetimi atlandı, uydurulmadı." },

    "diag.notInstalled": { en: "DOMAIN MODEL NOT INSTALLED", tr: "ALAN MODELİ KURULU DEĞİL" },
    "diag.classicalCV": { en: "Classical computer vision is active; no trained Merit model is installed in this browser review.", tr: "Klasik görüntü işleme aktif; bu tarayıcı incelemesinde eğitilmiş bir Merit modeli kurulu değil." },
    // ---- Assisted Detection diagnostics ----
    // These describe what the classical pipeline actually did on this plan.
    // They must never imply a trained model: the path names describe pixel
    // work, not inference.
    "diag.path": { en: "Detection path", tr: "Algılama yolu" },
    "diag.path.chairFirst": { en: "Chair-first — chairs were detected from their own colour/size model, then tables were inferred among them", tr: "Önce sandalye — sandalyeler kendi renk/boyut modelinden algılandı, masalar bunların arasından çıkarıldı" },
    "diag.path.tableFirst": { en: "Table-first fallback — no separable chair population was found", tr: "Önce masa (yedek yol) — ayrıştırılabilir bir sandalye kümesi bulunamadı" },
    "diag.chairSource": { en: "Chair evidence", tr: "Sandalye kanıtı" },
    "diag.chairSource.colour": { en: "dominant saturated colour cluster measured in this drawing", tr: "bu çizimde ölçülen baskın doygun renk kümesi" },
    "diag.chairSource.luma": { en: "brightness components only (this drawing has no separable colour)", tr: "yalnızca parlaklık bileşenleri (bu çizimde ayrıştırılabilir renk yok)" },
    "diag.chairSource.none": { en: "no chair population was found", tr: "sandalye kümesi bulunamadı" },
    "diag.chairsFound": { en: "{n} chairs detected · {associated} associated with a table · {orphans} not associated with any table", tr: "{n} sandalye algılandı · {associated} bir masayla ilişkilendirildi · {orphans} hiçbir masayla ilişkilendirilmedi" },
    "diag.mergesSplit": { en: "{n} merged blob(s) split where the pixels showed a real gap", tr: "Piksellerde gerçek boşluk görülen {n} birleşik leke ayrıldı" },
    "diag.capReached": { en: "Candidate cap reached — the lowest-agreement candidates were dropped, not the largest kept", tr: "Aday sınırına ulaşıldı — en büyükler değil, boyut uyumu en düşük adaylar elendi" },
    "diag.textSuppressed": { en: "{n} candidate(s) discarded as printed text/labels via real OCR overlap", tr: "Gerçek OCR örtüşmesiyle {n} aday basılı yazı/etiket olarak elendi" },

    // ---- Guests screen ----
    "guests.title": { en: "Guest List", tr: "Misafir Listesi" },
    "guests.recordsSummary": { en: "{records} records · {total} total guests", tr: "{records} kayıt · {total} toplam misafir" },
    "guests.search": { en: "Search name, inviter, table or note", tr: "İsim, davet eden, masa veya not ara" },
    "guests.filter.all": { en: "All Guests", tr: "Tüm Misafirler" },
    "guests.filter.assigned": { en: "Assigned", tr: "Atanmış" },
    "guests.filter.unassigned": { en: "Unassigned", tr: "Atanmamış" },
    "guests.filter.confirmed": { en: "Confirmed", tr: "Onaylandı" },
    "guests.filter.tentative": { en: "Tentative", tr: "Ön Görüşme" },
    "guests.excelTemplate": { en: "Excel Template", tr: "Excel Şablonu" },
    "guests.importExcel": { en: "Import Excel", tr: "Excel İçe Aktar" },
    "guests.addGuest": { en: "Add Guest", tr: "Misafir Ekle" },
    "guests.col.name": { en: "Name Surname", tr: "Ad Soyad" },
    "guests.col.pax": { en: "Pax", tr: "Kişi" },
    "guests.col.status": { en: "Status", tr: "Durum" },
    "guests.col.vip": { en: "VIP", tr: "VIP" },
    "guests.col.invitedBy": { en: "Invited By", tr: "Davet Eden" },
    "guests.col.table": { en: "Table", tr: "Masa" },
    "guests.col.seat": { en: "Seat", tr: "Koltuk" },
    "guests.col.notes": { en: "Notes", tr: "Notlar" },
    "guests.col.actions": { en: "Actions", tr: "İşlemler" },
    "guests.noMatches": { en: "No matching guest records.", tr: "Eşleşen misafir kaydı yok." },
    // ---- Guests, party-centric redesign ----
    "guests.m.totalPax": { en: "Total Guests", tr: "Toplam Kişi" },
    "guests.m.totalPaxNote": { en: "Across {n} party records", tr: "{n} kayıt üzerinden" },
    "guests.m.seated": { en: "Seated", tr: "Oturtuldu" },
    "guests.m.seatedNote": { en: "Pax with a seat", tr: "Koltuğu olan kişi" },
    "guests.m.unseated": { en: "Not Seated", tr: "Oturtulmadı" },
    "guests.m.unseatedNote": { en: "Still need seats", tr: "Hâlâ koltuk gerekiyor" },
    "guests.m.vip": { en: "VIP / VVIP", tr: "VIP / VVIP" },
    "guests.m.vipNote": { en: "Priority parties", tr: "Öncelikli kayıtlar" },
    "guests.queue": { en: "{n} pax still need a seat", tr: "{n} kişinin hâlâ koltuğu yok" },
    "guests.queueHint": { en: "Open the Seating Plan to place them.", tr: "Yerleştirmek için Oturma Planı'nı açın." },
    "guests.queueGo": { en: "Open Seating Plan", tr: "Oturma Planını Aç" },
    "guests.queueClear": { en: "Every guest has a seat.", tr: "Her misafirin koltuğu var." },
    "guests.col.guest": { en: "Guest party", tr: "Misafir kaydı" },
    "guests.col.tableSeat": { en: "Table / Seat", tr: "Masa / Koltuk" },
    "guests.emptyTitle": { en: "No guests yet", tr: "Henüz misafir yok" },
    "guests.emptyHint": { en: "Add guests one by one, or import an existing list from Excel.", tr: "Misafirleri tek tek ekleyin veya mevcut listeyi Excel'den içe aktarın." },
    "guests.hasNote": { en: "Has a note", tr: "Notu var" },
    "guests.companions": { en: "{n} companions", tr: "{n} refakatçi" },
    "guests.partyOf": { en: "party of {n}", tr: "{n} kişilik" },
    // ---- Reports, preflight-before-export redesign ----
    "reports.preflight": { en: "Before you export", tr: "Dışa aktarmadan önce" },
    "reports.preflightOk": { en: "Everything checks out", tr: "Her şey hazır" },
    "reports.preflightOkNote": { en: "No blocking issues in this plan.", tr: "Bu planda engelleyici sorun yok." },
    "reports.fixSeating": { en: "Fix in Seating", tr: "Oturma Planında düzelt" },
    "reports.fixFloor": { en: "Fix in Floor Plan", tr: "Kat Planında düzelt" },
    "reports.workbook": { en: "Excel workbook", tr: "Excel çalışma kitabı" },
    "reports.workbookNote": { en: "Three worksheets, formatted for operational use at the venue.", tr: "Mekânda operasyonel kullanım için biçimlendirilmiş üç sayfa." },
    "reports.sheetTablePlan": { en: "TABLE PLAN", tr: "TABLE PLAN" },
    "reports.sheetGuestList": { en: "GUEST LIST", tr: "GUEST LIST" },
    "reports.sheetUnassigned": { en: "UNASSIGNED", tr: "UNASSIGNED" },
    "reports.sheetNoteTables": { en: "{n} tables", tr: "{n} masa" },
    "reports.sheetNoteRecords": { en: "{n} records", tr: "{n} kayıt" },
    "reports.sheetNoteGuests": { en: "{n} pax", tr: "{n} kişi" },
    "reports.sheetsInEnglish": { en: "Sheet names and column headers stay in English — the workbook is shared with venue and catering teams.", tr: "Sayfa adları ve sütun başlıkları İngilizce kalır — bu dosya mekân ve ikram ekipleriyle paylaşılır." },
    // ---- Plan health issues (shared by Plan Health pill and Reports preflight) ----
    "health.issue.duplicateTable": { en: "Duplicate table number", tr: "Yinelenen masa numarası" },
    "health.issue.duplicateTableText": { en: "Table {number} appears more than once.", tr: "{number} masası birden fazla kez geçiyor." },
    "health.issue.blankPlan": { en: "Blank plan", tr: "Boş plan" },
    "health.issue.blankPlanText": { en: "Add tables manually or use Assisted Detection.", tr: "Masaları elle ekleyin veya Destekli Tespit'i kullanın." },
    "health.issue.capacityExceeded": { en: "Capacity exceeded", tr: "Kapasite aşıldı" },
    "health.issue.capacityExceededText": { en: "{pax} guest pax against {capacity} physical chairs.", tr: "{capacity} fiziksel koltuğa karşılık {pax} misafir." },
    "health.issue.unassigned": { en: "Unassigned guests", tr: "Oturtulmamış misafirler" },
    "health.issue.unassignedText": { en: "{n} pax still need seats.", tr: "{n} kişinin hâlâ koltuğa ihtiyacı var." },
    // ---- Home, next-event-first redesign ----
    "home.nextEvent": { en: "Next event", tr: "Sıradaki etkinlik" },
    "home.otherUpcoming": { en: "Other upcoming events", tr: "Diğer yaklaşan etkinlikler" },
    "home.seatedProgress": { en: "Guests seated", tr: "Oturtulan misafir" },
    "home.capacityProgress": { en: "Chairs used", tr: "Kullanılan koltuk" },
    "home.duplicate": { en: "Duplicate", tr: "Kopyala" },
    "home.noPlanYet": { en: "No tables in the plan yet", tr: "Planda henüz masa yok" },
    "home.openEventNamed": { en: "Open {name}", tr: "{name} etkinliğini aç" },
    "home.historyOpenHint": { en: "Double-click a row to open it read-only", tr: "Salt okunur açmak için satıra çift tıklayın" },
    // ---- Seating, canvas-first redesign ----
    "seating.selectedTable": { en: "Selected table", tr: "Seçili masa" },
    "seating.capacity": { en: "Capacity", tr: "Kapasite" },
    "seating.occupied": { en: "Occupied", tr: "Dolu" },
    "seating.empty": { en: "Empty", tr: "Boş" },
    "seating.seatEmpty": { en: "Empty", tr: "Boş" },
    "seating.assignHere": { en: "Seat here", tr: "Buraya otur" },
    "seating.companion": { en: "companion", tr: "refakatçi" },
    "seating.lock": { en: "Lock", tr: "Kilitle" },
    "seating.unlock": { en: "Unlock", tr: "Kilidi aç" },
    "seating.unassign": { en: "Unassign", tr: "Atamayı kaldır" },
    "seating.assignGuest": { en: "Seat {name} ({n} seats)", tr: "{name} kaydını oturt ({n} koltuk)" },
    "seating.moveGuest": { en: "Move {name} here ({n} seats)", tr: "{name} kaydını buraya taşı ({n} koltuk)" },
    "seating.pickGuestFirst": { en: "Pick a guest on the left, then choose a seat.", tr: "Soldan bir misafir seçin, sonra koltuğu seçin." },
    "seating.closeCard": { en: "Close", tr: "Kapat" },
    "seating.statusPill": { en: "{seated} of {total} pax seated · {tables} tables · {free} chairs free", tr: "{total} kişiden {seated} tanesi oturtuldu · {tables} masa · {free} boş koltuk" },
    "seating.guestQueue": { en: "Guests to seat", tr: "Oturtulacak misafirler" },
    "seating.allGuests": { en: "All guests", tr: "Tüm misafirler" },
    "seating.tapTableHint": { en: "Select a table on the plan to see its seats.", tr: "Koltuklarını görmek için plandan bir masa seçin." },
    "canvas.editHint": { en: "Drag to move · Handles resize and rotate · Delete removes selection", tr: "Taşımak için sürükleyin · Tutamaçlar boyutlandırır ve döndürür · Delete seçimi siler" },
    // ---- Add Objects (fast manual plan building) ----
    // The option LABELS below are display-only. The stored values stay the
    // English identifiers the data model uses ("round", "grid", "stage"...).
    "bulk.title": { en: "Add Objects", tr: "Nesne Ekle" },
    "bulk.subtitle": { en: "Preview a row, grid, repeated placement or array before committing.", tr: "Onaylamadan önce satır, ızgara, tekrarlı yerleştirme veya dizi olarak önizleyin." },
    "bulk.kind": { en: "Kind", tr: "Nesne türü" },
    "bulk.type": { en: "Type", tr: "Şekil" },
    "bulk.chairsEach": { en: "Chairs each", tr: "Masa başına sandalye" },
    "bulk.numberPrefix": { en: "Number prefix", tr: "Numara öneki" },
    "bulk.quantity": { en: "Quantity", tr: "Adet" },
    "bulk.placement": { en: "Placement", tr: "Yerleşim" },
    "bulk.rows": { en: "Rows", tr: "Satır" },
    "bulk.columns": { en: "Columns", tr: "Sütun" },
    "bulk.cancel": { en: "Cancel", tr: "İptal" },
    "bulk.addToPlan": { en: "Add to plan", tr: "Plana ekle" },
    "bulk.startPlacement": { en: "Start placement", tr: "Yerleştirmeyi başlat" },
    "bulk.kind.table": { en: "Table + chairs", tr: "Masa + sandalye" },
    "bulk.kind.venue": { en: "Venue object", tr: "Mekân nesnesi" },
    "bulk.type.rectangle": { en: "Rectangle", tr: "Dikdörtgen" },
    "bulk.type.square": { en: "Square", tr: "Kare" },
    "bulk.type.round": { en: "Round", tr: "Yuvarlak" },
    "bulk.type.bistro": { en: "Bistro", tr: "Bistro" },
    "bulk.type.stage": { en: "Stage", tr: "Sahne" },
    "bulk.type.bar": { en: "Bar", tr: "Bar" },
    "bulk.type.entrance": { en: "Entrance", tr: "Giriş" },
    "bulk.type.exit": { en: "Exit", tr: "Çıkış" },
    "bulk.type.column": { en: "Column", tr: "Kolon" },
    "bulk.type.text": { en: "Text", tr: "Metin" },
    "bulk.placement.grid": { en: "Grid", tr: "Izgara" },
    "bulk.placement.row": { en: "Row", tr: "Satır" },
    "bulk.placement.repeated": { en: "Repeated (click to place)", tr: "Tekrarlı (tıklayarak yerleştir)" },
    "bulk.placement.array": { en: "Array", tr: "Dizi" },
    "canvas.multiSelectHint": { en: "Ctrl/Shift multi-select · Drag blank canvas for marquee · Arrow keys nudge", tr: "Ctrl/Shift ile çoklu seçim · Boş alanı sürükleyerek seçim kutusu · Ok tuşlarıyla ince ayar" },
    "canvas.selectedCount": { en: "{n} selected", tr: "{n} seçili" },
    "guests.additionalNote": { en: "+{n} guests · {pax} total pax", tr: "+{n} misafir · {pax} toplam kişi" },
    "guests.unassigned": { en: "Unassigned", tr: "Atanmadı" },

    // ---- Live Event screen ----
    "live.title": { en: "Live Event", tr: "Canlı Etkinlik" },
    "live.subtitle": { en: "No Show releases operational capacity while preserving the planned assignment.", tr: "Gelmedi (No Show), planlanan oturma yerini korurken operasyonel kapasiteyi serbest bırakır." },
    "live.search": { en: "Search name, invited by, table or status", tr: "İsim, davet eden, masa veya durum ara" },
    "live.kpi.total": { en: "Total Guests", tr: "Toplam Misafir" },
    "live.kpi.totalNote": { en: "All guest records", tr: "Tüm misafir kayıtları" },
    "live.kpi.checked": { en: "Checked In", tr: "Giriş Yaptı" },
    "live.kpi.checkedNote": { en: "Arrived pax", tr: "Gelen kişi sayısı" },
    "live.kpi.notArrived": { en: "Not Arrived", tr: "Bekleniyor" },
    "live.kpi.notArrivedNote": { en: "Awaiting arrival", tr: "Varış bekleniyor" },
    "live.kpi.noShow": { en: "No Show", tr: "Gelmedi" },
    "live.kpi.noShowNote": { en: "Released operational seats", tr: "Serbest bırakılan operasyonel koltuklar" },
    "live.kpi.emptyTables": { en: "Empty Tables", tr: "Boş Masalar" },
    "live.kpi.emptyTablesNote": { en: "No live occupants", tr: "Canlı doluluk yok" },
    "live.kpi.emptyChairs": { en: "Empty Chairs", tr: "Boş Koltuklar" },
    "live.kpi.emptyChairsNote": { en: "Open operational chairs", tr: "Açık operasyonel koltuklar" },
    // ---- Live Event, door-operation redesign ----
    "live.searchHero": { en: "Find a guest — start typing a name", tr: "Misafir bul — ismi yazmaya başlayın" },
    "live.hint": { en: "Check a guest in with one tap. A mistaken tap can be undone from Recent on the right.", tr: "Tek dokunuşla giriş alın. Yanlış dokunuşu sağdaki Son İşlemler'den geri alabilirsiniz." },
    "live.arrived": { en: "Arrived", tr: "Gelen" },
    "live.arrivedNote": { en: "of {total} expected pax", tr: "beklenen {total} kişiden" },
    "live.stillExpected": { en: "Still Expected", tr: "Bekleniyor" },
    "live.stillExpectedNote": { en: "Not arrived yet", tr: "Henüz gelmedi" },
    "live.recentTitle": { en: "Recent", tr: "Son İşlemler" },
    "live.recentEmpty": { en: "No arrivals recorded yet.", tr: "Henüz giriş kaydedilmedi." },
    "live.undo": { en: "Undo", tr: "Geri al" },
    "live.checkInAction": { en: "Check In", tr: "Giriş" },
    "live.undoCheckIn": { en: "Undo check-in", tr: "Girişi geri al" },
    "live.noResults": { en: "No guest matches that search.", tr: "Bu aramayla eşleşen misafir yok." },
    "live.allArrived": { en: "Everyone has arrived.", tr: "Tüm misafirler geldi." },
    "live.noTable": { en: "No table", tr: "Masa yok" },
    "live.noShowKeepsSeat": { en: "Marked No Show. The planned seat is kept; only live capacity is released.", tr: "Gelmedi olarak işaretlendi. Planlanan koltuk korunur; yalnızca canlı kapasite serbest bırakılır." },
    "live.checkedInToast": { en: "{name} checked in.", tr: "{name} giriş yaptı." },
    "live.undoneToast": { en: "{name} set back to Not Arrived.", tr: "{name} tekrar Gelmedi durumuna alındı." },
    "live.companionsOf": { en: "{n} companions", tr: "{n} refakatçi" },
    "live.partyOf": { en: "party of {n}", tr: "{n} kişilik" },
    "live.col.name": { en: "Name Surname", tr: "Ad Soyad" },
    "live.col.pax": { en: "Pax", tr: "Kişi" },
    "live.col.invitedBy": { en: "Invited By", tr: "Davet Eden" },
    "live.col.table": { en: "Table", tr: "Masa" },
    "live.col.planning": { en: "Planning", tr: "Planlama" },
    "live.col.arrival": { en: "Arrival", tr: "Varış" },
    "live.col.action": { en: "Action", tr: "İşlem" },
    "live.checkIn": { en: "Check In", tr: "Giriş Yap" },
    "live.noShow": { en: "No Show", tr: "Gelmedi" },

    // ---- Reports screen ----
    "reports.title": { en: "Reports & Export", tr: "Raporlar ve Dışa Aktarım" },
    "reports.subtitle": { en: "Operational seating workbook, guest list and unassigned records.", tr: "Operasyonel oturma çalışma kitabı, misafir listesi ve atanmamış kayıtlar." },
    "reports.guestCsv": { en: "Guest CSV", tr: "Misafir CSV" },
    "reports.exportTablePlan": { en: "Export Table Plan (.XLSX)", tr: "Masa Planını Dışa Aktar (.XLSX)" },
    "reports.capacitySummary": { en: "Capacity Summary", tr: "Kapasite Özeti" },
    "reports.live": { en: "Live", tr: "Canlı" },
    "reports.totalCapacity": { en: "Total capacity", tr: "Toplam kapasite" },
    "reports.assignedGuests": { en: "Assigned guests", tr: "Atanan misafirler" },
    "reports.emptyChairs": { en: "Empty physical chairs", tr: "Boş fiziksel koltuklar" },
    "reports.emptyTables": { en: "Empty tables", tr: "Boş masalar" },
    "reports.tableList": { en: "Table List", tr: "Masa Listesi" },
    "reports.tablesCount": { en: "{n} tables", tr: "{n} masa" },
    "reports.alphabeticalGuestList": { en: "Alphabetical Guest List", tr: "Alfabetik Misafir Listesi" },
    "reports.recordsCount": { en: "{n} records", tr: "{n} kayıt" },
    "reports.unassigned": { en: "Unassigned", tr: "Atanmamış" },
    "reports.guestsCount": { en: "{n} guests", tr: "{n} misafir" },
    "reports.allAssigned": { en: "All guests assigned", tr: "Tüm misafirler atandı" },
    "reports.ready": { en: "Ready", tr: "Hazır" },

    // ---- Seating screen ----
    "seating.allGuestRecords": { en: "All Guest Records", tr: "Tüm Misafir Kayıtları" },
    "seating.needingAssignment": { en: "Guests Needing Assignment", tr: "Atama Bekleyen Misafirler" },
    "seating.recordsSelected": { en: "{n} record(s) selected · {pax} pax", tr: "{n} kayıt seçildi · {pax} kişi" },
    "seating.scope.all": { en: "All Guests", tr: "Tüm Misafirler" },
    "seating.scope.unassigned": { en: "Unassigned", tr: "Atanmamış" },
    "seating.filter.all": { en: "All Tables", tr: "Tüm Masalar" },
    "seating.filter.empty": { en: "Empty Tables", tr: "Boş Masalar" },
    "seating.filter.available": { en: "Available Seats", tr: "Müsait Koltuklar" },
    "seating.filter.full": { en: "Full Tables", tr: "Dolu Masalar" },
    "seating.search": { en: "Search name, VIP or invited by", tr: "İsim, VIP veya davet eden ara" },
    "seating.noMatches": { en: "No matching guest records.", tr: "Eşleşen misafir kaydı yok." },

    // Display-only translation of the fixed internal status enums
    // (Confirmed/Tentative, Not Arrived/Checked In/No Show) -- the stored
    // value on the guest record stays the English enum string everywhere
    // (business logic compares against it directly); only the rendered
    // label changes with the active language.
    "status.planning.Confirmed": { en: "Confirmed", tr: "Onaylandı" },
    "status.planning.Tentative": { en: "Tentative", tr: "Ön Görüşme" },
    // These three must stay visually and verbally distinct in both languages.
    // "Not Arrived" and "No Show" both used to render as "Gelmedi", which made
    // them impossible to tell apart at the door.
    "status.arrival.Not Arrived": { en: "Not Arrived", tr: "Bekleniyor" },
    "status.arrival.Checked In": { en: "Checked In", tr: "Giriş Yaptı" },
    "status.arrival.No Show": { en: "No Show", tr: "Gelmedi" },
    "unit.pax": { en: "pax", tr: "kişi" },

    // ---- Shared canvas toolbar (Floor Plan + Seating) ----
    "toolbar.select": { en: "Select", tr: "Seç" },
    "toolbar.pan": { en: "Pan", tr: "Kaydır" },
    "toolbar.addBulk": { en: "Add / Bulk", tr: "Ekle / Toplu" },
    "toolbar.duplicate": { en: "Duplicate", tr: "Çoğalt" },
    "toolbar.delete": { en: "Delete", tr: "Sil" },
    "toolbar.undo": { en: "Undo", tr: "Geri Al" },
    "toolbar.redo": { en: "Redo", tr: "İleri Al" },
    "toolbar.zoomOut": { en: "Zoom out", tr: "Uzaklaştır" },
    "toolbar.zoomIn": { en: "Zoom in", tr: "Yakınlaştır" },
    "toolbar.fit": { en: "Fit", tr: "Sığdır" },
    "toolbar.grid": { en: "Grid", tr: "Izgara" },
    "toolbar.snap": { en: "Snap", tr: "Yasla" },
    "toolbar.seatLabels": { en: "Seat labels", tr: "Koltuk numaraları" },
    "toolbar.assistedDetection": { en: "Assisted Detection", tr: "Yapay Zeka Destekli Tespit" },
    "toolbar.focusMode": { en: "Focus Mode", tr: "Odak Modu" },

    // ---- Global appbar ----
    "appbar.search": { en: "Find guest, inviter, table or seat", tr: "Misafir, davet eden, masa veya koltuk ara" },
    "appbar.help": { en: "Help / User Guide", tr: "Yardım / Kullanım Kılavuzu" },
    "appbar.allEvents": { en: "All Events", tr: "Tüm Etkinlikler" },
    "appbar.saveNow": { en: "Save now", tr: "Şimdi Kaydet" },
    "appbar.localAutosave": { en: "Local autosave", tr: "Yerel Otomatik Kayıt" },
    "appbar.venueNotSet": { en: "Venue not set", tr: "Mekan Belirtilmedi" },

    // ---- Nav tabs ----
    "nav.floorPlanTab": { en: "Floor Plan", tr: "Kat Planı" },
    "nav.guestsTab": { en: "Guests", tr: "Misafirler" },
    "nav.seatingTab": { en: "Seating Plan", tr: "Oturma Planı" },
    "nav.liveTab": { en: "Live Event", tr: "Canlı Etkinlik" },
    "nav.reportsTab": { en: "Reports", tr: "Raporlar" },
    "nav.historicalBanner": { en: "Historical event · Seating, guest and report records are immutable.", tr: "Geçmiş etkinlik · Oturma, misafir ve rapor kayıtları değiştirilemez." },
    "nav.exitFocus": { en: "Esc · Exit Focus Mode", tr: "Esc · Odak Modundan Çık" },

    // ---- Plan Health ----
    "health.ready": { en: "Ready", tr: "Hazır" },
    "health.noBlockingIssues": { en: "No blocking issues", tr: "Engelleyici sorun yok" },
    "health.consistent": { en: "Capacity, table numbers and assignments are consistent.", tr: "Kapasite, masa numaraları ve atamalar tutarlı." },
    "health.planHealth": { en: "Plan Health", tr: "Plan Durumu" },

    // ---- Home / Events screen ----
    "home.crumb": { en: "Event Operations", tr: "Etkinlik Operasyonları" },
    "home.portfolio": { en: "Portfolio", tr: "Portföy" },
    "home.eyebrow": { en: "MERIT ENTERTAINMENT · EVENT OPERATIONS", tr: "MERIT ENTERTAINMENT · ETKİNLİK OPERASYONLARI" },
    "home.title": { en: "Event Maker", tr: "Etkinlik Oluşturucu" },
    "home.subtitle": { en: "Upcoming production workspaces and immutable event history.", tr: "Yaklaşan üretim çalışma alanları ve değiştirilemez etkinlik geçmişi." },
    "home.eventsCount": { en: "{n} events", tr: "{n} etkinlik" },
    "home.eventCount1": { en: "{n} event", tr: "{n} etkinlik" },
    "home.upcomingEvents": { en: "Upcoming Events", tr: "Yaklaşan Etkinlikler" },
    "home.noUpcoming": { en: "No upcoming events", tr: "Yaklaşan etkinlik yok" },
    "home.noUpcomingHint": { en: "Create an event with a truly blank plan or import a floor plan.", tr: "Tamamen boş bir planla etkinlik oluşturun veya bir kat planı içe aktarın." },
    "home.createEvent": { en: "Create Event", tr: "Etkinlik Oluştur" },
    "home.eventsHistory": { en: "Events History", tr: "Etkinlik Geçmişi" },
    "home.historyNote": { en: "Past dates and Completed events are read-only", tr: "Geçmiş tarihler ve Tamamlanmış etkinlikler salt okunurdur" },
    "home.col.event": { en: "Event", tr: "Etkinlik" },
    "home.col.date": { en: "Date", tr: "Tarih" },
    "home.col.hotelSalon": { en: "Hotel / Salon", tr: "Otel / Salon" },
    "home.col.guestPax": { en: "Guest pax", tr: "Misafir Kişi" },
    "home.col.physicalChairs": { en: "Physical chairs", tr: "Fiziksel Koltuk" },
    "home.col.status": { en: "Status", tr: "Durum" },
    "home.col.access": { en: "Access", tr: "Erişim" },
    "home.readOnly": { en: "Read-only", tr: "Salt Okunur" },
    "home.noHistorical": { en: "No historical events.", tr: "Geçmiş etkinlik yok." },
    "home.openEvent": { en: "Open Event", tr: "Etkinliği Aç" },
    "home.duplicate": { en: "Duplicate", tr: "Çoğalt" },
    "home.delete": { en: "Delete", tr: "Sil" },
    "toolbar.hideOriginalPlan": { en: "Hide original plan", tr: "Orijinal planı gizle" },
    "toolbar.showOriginalPlan": { en: "Show original plan", tr: "Orijinal planı göster" },
    "toolbar.replacePlan": { en: "Replace plan", tr: "Planı değiştir" },
  };

  function currentLang() {
    return (typeof ui !== "undefined" && ui.lang === "tr") ? "tr" : "en";
  }

  // ---- Toast translation -------------------------------------------------
  // Toasts are raised from ~40 call sites across three files, many with
  // interpolated data. Rather than rewrite every call, translation happens at
  // the toast boundary: an exact-match table for fixed messages, then ordered
  // patterns for the interpolated ones. Anything unmatched passes through in
  // English -- visible, and therefore fixable, rather than silently wrong.
  const TOAST_TR = {
    "Guest added.": "Misafir eklendi.",
    "Guest updated.": "Misafir güncellendi.",
    "Guest deleted.": "Misafir silindi.",
    "Event deleted.": "Etkinlik silindi.",
    "Event duplicated.": "Etkinlik çoğaltıldı.",
    "Nothing to undo.": "Geri alınacak bir şey yok.",
    "Nothing to redo.": "Yinelenecek bir şey yok.",
    "Saved locally in this browser.": "Bu tarayıcıya yerel olarak kaydedildi.",
    "Blank event created. Add plan objects when ready.": "Boş etkinlik oluşturuldu. Hazır olduğunuzda plan nesnelerini ekleyin.",
    "Event name, date and hotel are required.": "Etkinlik adı, tarih ve otel zorunludur.",
    "That table number is already in use.": "Bu masa numarası zaten kullanımda.",
    "This object is locked. Unlock it in the Inspector.": "Bu nesne kilitli. Kilidini denetçi panelinden açın.",
    "Unlock this object before resizing.": "Yeniden boyutlandırmadan önce bu nesnenin kilidini açın.",
    "Unlock this object before rotating.": "Döndürmeden önce bu nesnenin kilidini açın.",
    "Unlock this assignment before removing it.": "Kaldırmadan önce bu atamanın kilidini açın.",
    "Unlock every selected object before moving.": "Taşımadan önce seçili tüm nesnelerin kilidini açın.",
    "Select one or more objects first.": "Önce bir veya daha fazla nesne seçin.",
    "Select at least one detection to confirm.": "Onaylamak için en az bir tespit seçin.",
    "The group move was rolled back.": "Grup taşıma geri alındı.",
    "No assignments changed.": "Hiçbir atama değişmedi.",
    "Repeated placement cancelled.": "Tekrarlı yerleştirme iptal edildi.",
    "Import a floor plan first.": "Önce bir kat planı içe aktarın.",
    "Choose PNG, JPG, JPEG or PDF.": "PNG, JPG, JPEG veya PDF seçin.",
    "Floor plan imported locally. Assisted Detection is ready.": "Kat planı yerel olarak içe aktarıldı. Destekli Tespit hazır.",
    "Enable Teach AI with corrections first.": "Önce düzeltmelerle Yapay Zekâya Öğret'i etkinleştirin.",
    "Save at least one verified plan first.": "Önce en az bir doğrulanmış plan kaydedin.",
    "Excel template downloaded.": "Excel şablonu indirildi.",
    "Guest CSV exported.": "Misafir CSV'si dışa aktarıldı.",
    "Table Plan workbook exported with three worksheets.": "Masa planı çalışma kitabı üç sayfayla dışa aktarıldı.",
    "Fix blocking import errors first.": "Önce engelleyici içe aktarma hatalarını düzeltin.",
    "Map one column to Name Surname.": "Bir sütunu Ad Soyad ile eşleştirin.",
    "Name Surname is required.": "Ad Soyad zorunludur.",
    "Browser storage is full. Export the workbook before closing.": "Tarayıcı depolaması dolu. Kapatmadan önce çalışma kitabını dışa aktarın.",
    "Browser storage is full. Export your workbook before closing.": "Tarayıcı depolaması dolu. Kapatmadan önce çalışma kitabınızı dışa aktarın.",
    "Event data was saved, but large images exceeded browser storage.": "Etkinlik verisi kaydedildi, ancak büyük görseller tarayıcı depolamasını aştı.",
  };
  const TOAST_PATTERNS = [
    [/^(.+) returned to Unassigned\.$/, (m) => `${m[1]} atanmamışlara döndü.`],
    [/^(.+)'s assignment is locked\. Unlock it before moving\.$/, (m) => `${m[1]} ataması kilitli. Taşımadan önce kilidini açın.`],
    [/^(.+)'s assignment is locked\.$/, (m) => `${m[1]} ataması kilitli.`],
    [/^(.+) added with (\d+) chairs\.$/, (m) => `${m[1]}, ${m[2]} sandalyeyle eklendi.`],
    [/^(\d+) objects? added with physical chair records\.$/, (m) => `${m[1]} nesne fiziksel sandalye kayıtlarıyla eklendi.`],
    [/^(\d+) records? moved transactionally to (.+) · (\d+) chairs reserved\.$/, (m) => `${m[1]} kayıt ${m[2]} masasına taşındı · ${m[3]} sandalye ayrıldı.`],
    [/^(.+) has only (\d+) seats available for this record\.$/, (m) => `${m[1]} masasında bu kayıt için yalnızca ${m[2]} koltuk var.`],
    [/^Historical events are read-only\. You cannot (.+)\.$/, () => `Geçmiş etkinlikler salt okunurdur; bu işlem yapılamaz.`],
    [/^Assisted Detection failed: (.+)$/, (m) => `Destekli Tespit başarısız: ${m[1]}`],
    [/^(.+) added\.$/, (m) => `${m[1]} eklendi.`],
  ];
  function translateToast(message) {
    if (currentLang() !== "tr" || typeof message !== "string") return message;
    if (TOAST_TR[message]) return TOAST_TR[message];
    for (const [re, fn] of TOAST_PATTERNS) {
      const m = message.match(re);
      if (m) return fn(m);
    }
    return message;
  }
  globalThis.translateToast = translateToast;

  function t(key, vars) {
    const entry = STRINGS[key];
    let str = entry ? (entry[currentLang()] || entry.en) : key;
    if (vars) for (const k in vars) str = str.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
    return str;
  }

  globalThis.t = t;
  globalThis.MERIT_I18N_LANG = currentLang;
  globalThis.MERIT_I18N_STATUS = {
    coverage: "Floor Plan (toolbar + canvas + Plan Intelligence review + Review Center + Teach AI + AI-generated question text), Guests, Seating (left panel), Live Event, Reports, Home/Events, the shared workspace header/tabs/appbar, and the fixed planning/arrival status enums.",
    notMigrated: ["Seating's right-side selected-table inspector panel and the base Inspector (table/venue property editor)", "Create Event / setup wizard screen", "Guest add/edit dialog", "Excel import wizard", "Guide/User Manual modal body content", "toast messages", "Reports XLSX workbook content itself (by design -- exported files stay in the documented English/uppercase business format regardless of UI language, since the workbook is a shared operational artifact, not a UI screen)"],
    note: "Coverage now spans every primary screen's main content; the items above are real, flagged gaps for a follow-up pass, not silently ignored.",
  };
})();
