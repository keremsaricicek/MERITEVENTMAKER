// F8 HELP: "HOW DO I …" (owner 2026-11-02: the assistant must know every usage
// question and problem). Each topic says, step by step and in both languages,
// how a job is done, and where: `go` opens that screen (the panel's "Götür").
// `words` are the words a person uses for the job; `match()` picks the topic
// whose words the question carries most (folded, case endings and one slip
// forgiven), and says nothing rather than guessing when none fits.
// No model, no network: plain text, so it costs nothing to keep in memory.
// Measured on training/help/howto-test.jsonl (written before this file).
(function () {
  "use strict";
  const T = (tr, en) => ({ tr, en });
  const TOPICS = [
    { id: "event.create", go: { screen: "events" }, words: "yeni etkinlik olustur ac create new event baslat kur",
      title: T("Yeni etkinlik açmak", "Create a new event"),
      steps: T(["Tüm Etkinlikler ekranında sağ üstteki \"Etkinlik Oluştur\"a basın.", "Ad, tarih, otel ve salonu yazın; varsa salon planını ekleyin.", "Oluştur'a basın: etkinlik boş açılır (örnek masa ya da misafir yoktur)."],
        ["On All Events, press \"Create Event\" (top right).", "Type the name, date, hotel and room; add the venue plan if you have it.", "Press Create: the event opens blank (no sample tables or guests)."]) },
    { id: "event.copyLayout", go: { screen: "events" }, words: "ayni duzen gecen etkinlik kopyala masalar ayni salon same layout copy last tables previous venue",
      title: T("Geçen etkinliğin düzeniyle yeni etkinlik", "A new event with the last one's layout"),
      steps: T(["Tüm Etkinlikler'de eski etkinliğin yanındaki \"Aynı düzen\"e basın.", "Masalar, sandalyeler, nesneler ve plan gelir; misafir gelmez.", "Açılan etkinliğin adını ve tarihini düzeltin."],
        ["On All Events, press \"Same layout\" next to the old event.", "Tables, chairs, objects and the plan come along; no guests.", "Fix the new event's name and date."]) },
    { id: "event.duplicate", go: { screen: "events" }, words: "cogalt kopyala misafirleriyle birlikte duplicate copy with guests whole",
      title: T("Etkinliği misafirleriyle çoğaltmak", "Duplicate an event with its guests"),
      steps: T(["Tüm Etkinlikler'de etkinliğin yanındaki \"Çoğalt\"a basın.", "Kopyada misafirler ve yerleri durur, gelişler sıfırlanır."], ["On All Events, press \"Duplicate\" next to the event.", "The copy keeps guests and seats; arrivals are reset."]) },
    { id: "event.delete", go: { screen: "events" }, words: "etkinlik sil kaldir delete remove event",
      title: T("Etkinliği silmek", "Delete an event"),
      steps: T(["Tüm Etkinlikler'de etkinliğin yanındaki \"Sil\"e basın ve onaylayın.", "Geçmiş (tamamlanmış) etkinlikler değiştirilemez; silmeden önce yedek alın."], ["On All Events, press \"Delete\" next to the event and confirm.", "Past (completed) events cannot be changed; take a backup before deleting."]) },
    { id: "event.edit", go: { tab: "command" }, words: "etkinlik adi tarih degistir duzenle mekan salon rename date edit event name",
      title: T("Etkinliğin adını ya da tarihini değiştirmek", "Change an event's name or date"),
      steps: T(["Etkinliği açın, Komuta Merkezi'nde etkinlik bilgilerini düzenleyin.", "Tarihi geçmiş bir güne alırsanız etkinlik salt okunur olur."], ["Open the event and edit its details in the Command Center.", "A date in the past makes the event read-only."]) },
    { id: "event.package", go: { screen: "events" }, words: "baska bilgisayar tasi paket disa aktar gonder another computer package export send move transfer",
      title: T("Etkinliği başka bilgisayara taşımak", "Move an event to another computer"),
      steps: T(["Tüm Etkinlikler'de \"Paketi dışa aktar\"a basın; bir dosya iner.", "Diğer bilgisayarda bu dosyayı içe aktarın: yeni bir etkinlik olarak eklenir, mevcutlara dokunmaz."], ["On All Events, press \"Export package\"; a file downloads.", "Import that file on the other computer: it is added as a new event and touches no other."]) },
    { id: "plan.upload", go: { tab: "floor" }, words: "plan yukle pdf resim kat plani salon plani upload floor plan image pdf venue drawing",
      title: T("Salon planını yüklemek", "Upload the venue plan"),
      steps: T(["Etkinliği açın, Kat Planı sekmesine gidin.", "Planı (PDF ya da resim) sürükleyip bırakın ya da tıklayıp seçin.", "Plan, masaların altında kilitli bir katman olarak durur."], ["Open the event and go to Floor Plan.", "Drag the plan (PDF or image) in, or click to choose it.", "It sits under the tables as a locked layer."]) },
    { id: "plan.read", go: { tab: "floor" }, words: "plani oku analiz otomatik masa bul tespit read analyze detect tables automatic",
      title: T("Planı okutup masaları buldurmak", "Read the plan and find the tables"),
      steps: T(["Kat Planı'nda planı yükledikten sonra \"Planı oku\"ya basın.", "Bulunan masalar ve sandalyeler öneri olarak gelir; emin olunmayanlar ayrıca işaretlenir.", "Önerileri Kabul ile plana yazın."], ["After uploading on Floor Plan, press \"Read plan\".", "Found tables and chairs come as suggestions; uncertain ones are marked.", "Accept writes them to the plan."]) },
    { id: "plan.review", go: { tab: "floor" }, words: "yanlis masa duzelt plan doktoru kabul reddet hatali fix wrong table review accept reject doctor",
      title: T("Planda yanlış bulunanı düzeltmek", "Fix what the plan reading got wrong"),
      steps: T(["Kat Planı'nda Plan Doktoru'nu açın; işaretli yerleri tek tek gezin.", "Her birinde Kabul, Düzelt ya da \"Nesne değil\" seçin.", "Hiçbir şey siz onaylamadan değişmez."], ["Open Plan Doctor on Floor Plan; go through the marked places.", "For each: Accept, Fix or \"Not an object\".", "Nothing changes until you confirm."]) },
    { id: "plan.capacity", go: { tab: "floor" }, words: "kapasite kac masa lazim kisilik duzen yerlesim plani capacity how many tables layout people arrangement",
      title: T("Kaç masa gerekir (kapasite planı)", "How many tables (capacity plan)"),
      steps: T(["F8'e anlatın: \"450 kişilik gala, 10'luk yuvarlak masalar, 20x30 metre salon\".", "F8 bir ya da iki düzen önerir: masa sayısı ve kaç kişi sığdığı ile.", "Beğendiğinizi \"Uygula\" ile plana çizin; tek \"Geri al\" hepsini geri alır."],
        ["Describe it to F8: \"gala for 450, round tables of 10, room 20x30 m\".", "F8 proposes one or two layouts with the table count and how many fit.", "\"Apply\" draws the one you like; one \"Undo\" takes it all back."]) },
    { id: "seat.draft", go: { tab: "seating" }, words: "taslak yerlestir herkesi otomatik yerlesim masasizlar draft auto seat everyone unseated",
      title: T("Herkese taslak yerleşim", "Draft seats for everyone"),
      steps: T(["Oturma Planı'nda \"Taslak yerleşim\"e basın ya da F8'e \"masasızları yerleştir\" yazın.", "F8 önce önerisini gösterir: gruplar bir arada, dolu koltuk alınmaz.", "Onayla'ya basınca uygulanır; \"Geri al\" ile geri alınır."],
        ["Press \"Draft seating\" on Seating, or type \"seat everyone\" in F8.", "F8 shows the proposal first: groups together, no taken seat used.", "Onayla applies it; \"Undo\" takes it back."]) },
    { id: "table.add", go: { tab: "floor" }, words: "masa ekle yuvarlak dikdortgen kare bistro add table round rectangle square new",
      title: T("Masa eklemek", "Add a table"),
      steps: T(["Kat Planı'nda soldaki Oluştur > Masalar'dan masa türünü seçin.", "Kişi sayısını seçin, sonra plana tıklayıp yerleştirin."], ["On Floor Plan, choose the table type under Build > Tables.", "Pick the seat count, then click on the plan to place it."]) },
    { id: "table.capacity", go: { tab: "floor" }, words: "masa kisi sayisi koltuk kapasite artir azalt seats capacity how many change table size",
      title: T("Masanın kişi sayısını değiştirmek", "Change a table's seat count"),
      steps: T(["Masayı seçin; sağdaki panelde Oturma bölümünde eksi/artı ya da hazır sayıları kullanın.", "Masada çizili sandalyeler varsa onlar da birlikte güncellenir."], ["Select the table; use minus/plus or a preset under Seating in the right panel.", "Drawn chairs update with it."]) },
    { id: "table.number", go: { tab: "floor" }, words: "masa numarasi degistir adlandir rename table number code vip",
      title: T("Masa numarasını değiştirmek", "Change a table number"),
      steps: T(["Masayı seçin, sağdaki panelde Masa Numarası alanına yeni kodu yazın (ör. VIP02).", "Aynı numara iki masada olamaz; program uyarır."], ["Select the table and type the new code in Table Number (e.g. VIP02).", "Two tables cannot share a number; you are warned."]) },
    { id: "table.move", go: { tab: "floor" }, words: "masa tasi dondur yer degistir hizala move rotate drag align position",
      title: T("Masayı taşımak ya da döndürmek", "Move or rotate a table"),
      steps: T(["Seç aracı açıkken masayı sürükleyin.", "Yuvarlak tutamaç döndürür, kare tutamaç boyutlandırır.", "Ctrl+Z geri alır."], ["With Select on, drag the table.", "The round handle rotates, the square one resizes.", "Ctrl+Z undoes."]) },
    { id: "table.delete", go: { tab: "floor" }, words: "masa sil kaldir planddan delete remove table",
      title: T("Masayı silmek", "Delete a table"),
      steps: T(["Masayı seçip Delete tuşuna ya da paneldeki Sil'e basın.", "Masadaki misafirler masasız kalır, silinmez."], ["Select the table and press Delete (or Delete in the panel).", "Its guests become unseated, never deleted."]) },
    { id: "guest.add", go: { tab: "guests" }, words: "misafir ekle tek tek elle yeni misafir add guest manually new person",
      title: T("Elle misafir eklemek", "Add a guest by hand"),
      steps: T(["Misafirler sekmesinde \"Misafir Ekle\"ye basın.", "Ad Soyad ve ek kişi sayısını yazın (Ahmet +2 = 3 kişi), kaydedin.", "Ya da F8'e yazın: \"Ahmet Yılmaz +2 ekle\"."], ["On Guests, press \"Add Guest\".", "Type the name and the additional guests (Ahmet +2 = 3 people) and save.", "Or type in F8: \"add Ahmet Yılmaz +2\"."]) },
    { id: "guest.import", go: { tab: "guests" }, words: "excel liste yukle ice aktar misafir listesi import excel list upload spreadsheet csv",
      title: T("Excel'den misafir listesi almak", "Import the guest list from Excel"),
      steps: T(["Misafirler'de \"Excel İçe Aktar\"a basın, dosyayı seçin.", "Kolonları eşleştirin (Ad Soyad, Ek Kişi, VIP, Davet Eden…), önizlemeyi kontrol edin.", "Kırmızı uyarıları düzeltip içe aktarın."], ["On Guests, press \"Import Excel\" and choose the file.", "Map the columns (Name, Additional Guests, VIP, Invited By…) and check the preview.", "Fix red warnings, then import."]) },
    { id: "guest.pax", go: { tab: "guests" }, words: "arti +3 +2 kisi sayisi ne demek refakatci ek kisi plus mean companions party size additional",
      title: T("\"+3\" ne demek", "What \"+3\" means"),
      steps: T(["\"Ahmet +3\" tek kayıttır: Ahmet ve 3 refakatçi, toplam 4 kişi.", "Oturtunca 4 koltuk ayrılır; raporda refakatçiler \"GUEST OF AHMET\" yazılır."], ["\"Ahmet +3\" is one record: Ahmet and 3 companions, 4 people.", "Seating takes 4 seats; reports show companions as \"GUEST OF AHMET\"."]) },
    { id: "guest.edit", go: { tab: "guests" }, words: "misafir duzenle ad yanlis yazdim degistir bilgi edit guest name wrong change details",
      title: T("Misafiri düzenlemek", "Edit a guest"),
      steps: T(["Misafirler'de misafiri bulun (arama hata affeder), satıra tıklayın.", "Bilgileri değiştirip kaydedin."], ["Find the guest on Guests (search forgives typos) and click the row.", "Change the details and save."]) },
    { id: "guest.delete", go: { tab: "guests" }, words: "misafir sil listeden cikar kaldir delete guest remove from list",
      title: T("Misafiri silmek", "Delete a guest"),
      steps: T(["Misafiri açıp Sil'e basın ve onaylayın.", "Ya da F8: \"Mehmet Kaya'yı listeden sil\" — önce gösterir, onay bekler.", "Yalnızca masadan almak için silmeyin: \"masadan kaldır\"ı kullanın."], ["Open the guest and press Delete, then confirm.", "Or F8: \"delete Mehmet Kaya\" — shown first, waits for you.", "To just unseat, don't delete: use \"take off the table\"."]) },
    { id: "guest.vip", go: { tab: "guests" }, words: "vip vvip isaretle onemli misafir mark vip important",
      title: T("VIP işaretlemek", "Mark a guest as VIP"),
      steps: T(["Misafiri açın, VIP alanını seçin.", "Ya da F8: \"Zeynep Arslan'ı VIP yap\"."], ["Open the guest and set VIP.", "Or F8: \"make Zeynep Arslan VIP\"."]) },
    { id: "guest.invitedBy", go: { tab: "guests" }, words: "davet eden junket grup kimin misafiri invited by host group who invited company",
      title: T("Davet eden / junket bilgisi", "Who invited the guest (host / junket)"),
      steps: T(["Misafir kaydındaki \"Davet Eden\" alanına kişiyi ya da şirketi yazın (Excel'de INVITED BY kolonu).", "Akıllı yerleştirme bu bilgiyle aynı grubu yan yana önerir."], ["Type the host or company in the guest's \"Invited By\" (INVITED BY column in Excel).", "Smart seating uses it to keep a group together."]) },
    { id: "seat.assign", go: { tab: "seating" }, words: "oturt masaya yerlestir ata koltuk seat assign place guest table",
      title: T("Misafiri masaya oturtmak", "Seat a guest at a table"),
      steps: T(["Oturma Planı'nda soldan misafiri, sonra masayı seçip Ata'ya basın (sürükleyebilirsiniz de).", "Ya da F8: \"ahmet yilmazi t05e oturt\"."], ["On Seating, pick the guest on the left, then the table, and press Assign (or drag).", "Or F8: \"seat Ahmet Yılmaz at T05\"."]) },
    { id: "seat.move", go: { tab: "seating" }, words: "baska masaya gecir tasi degistir move guest another table change seat",
      title: T("Misafiri başka masaya geçirmek", "Move a guest to another table"),
      steps: T(["Misafiri arayın, yeni masayı seçip Taşı'ya basın.", "Ya da F8: \"Mehmet Kaya T11'e geçsin\"."], ["Search the guest, pick the new table and press Move.", "Or F8: \"move Mehmet Kaya to T11\"."]) },
    { id: "seat.unassign", go: { tab: "seating" }, words: "masadan kaldir al bosalt silmeden unseat unassign remove from table keep",
      title: T("Misafiri masadan almak (silmeden)", "Unseat a guest (without deleting)"),
      steps: T(["Masada misafirin yanındaki \"Kaldır\"a basın; misafir listede kalır.", "Ya da F8: \"Can Öztürk'ü masadan kaldır ama silme\"."], ["Press \"Unassign\" next to the guest at the table; the guest stays on the list.", "Or F8: \"take Can Öztürk off the table but keep him\"."]) },
    { id: "seat.smart", go: { tab: "seating" }, words: "akilli yerlestirme oneri tavsiye nereye oturtayim smart seating suggestion suggest where",
      title: T("Akıllı yerleştirme önerisi", "Smart seating suggestion"),
      steps: T(["Oturma Planı'nda misafiri seçin; öneriler grubunu ve boş yerleri dikkate alır.", "Öneri kimseyi kendisi taşımaz; Uygula'ya siz basarsınız."], ["Select the guest on Seating; suggestions weigh the group and free seats.", "A suggestion moves nobody; you press Apply."]) },
    { id: "seat.freeze", go: { tab: "seating" }, words: "kilitle dondur bolge oturtulmasin rezerve lock freeze zone reserve area nobody",
      title: T("Bir bölgeyi kilitlemek", "Lock an area"),
      steps: T(["Oturma Planı'nda dondurma bölgesi çizin ve nedenini yazın.", "O bölgeye oturtma uyarı verir; her işlem için ayrı onay istenir."], ["Draw a freeze zone on Seating and give a reason.", "Seating there warns and needs a per-operation override."]) },
    { id: "table.unavailable", go: { tab: "floor" }, words: "kullanilamaz kirik masa kapali disari unavailable broken table out of use",
      title: T("Masayı kullanılamaz yapmak", "Mark a table unavailable"),
      steps: T(["Masayı seçip \"Kullanılamaz\" yapın ve nedenini yazın.", "O masaya kimse oturtulamaz; yerleri dolu olanlar uyarılır."], ["Select the table, set \"Unavailable\" and give a reason.", "Nobody can be seated there; seated guests are flagged."]) },
    { id: "live.checkin", go: { tab: "live" }, words: "giris geldi isaretle etkinlik gunu kapı check in arrived night of event",
      title: T("Etkinlik günü gelenleri işaretlemek", "Check guests in on the night"),
      steps: T(["Canlı Etkinlik sekmesinde misafiri arayıp \"Geldi\"ye basın.", "Planlı yeri değişmez; giriş ayrı tutulur."], ["On Live Event, search the guest and press \"Check In\".", "The planned seat stays; arrival is kept separately."]) },
    { id: "live.noshow", go: { tab: "live" }, words: "gelmedi gelmeyen no show isaretle absent",
      title: T("Gelmeyeni işaretlemek", "Mark a no-show"),
      steps: T(["Canlı Etkinlik'te misafirin yanındaki \"Gelmedi\"ye basın.", "Planlı yeri silinmez; o yer canlıda boş sayılır."], ["On Live Event, press \"No Show\" next to the guest.", "The planned seat is kept; it counts as free live."]) },
    { id: "live.door", go: { tab: "live" }, words: "kapida f8 hizli giris yaz geldi door fast check in type arrived",
      title: T("Kapıda F8 ile hızlı giriş", "Fast check-in at the door with F8"),
      steps: T(["F8'e basın, \"ahmet yilmaz geldi\" yazın.", "Misafir \"Geldi\" olur ve masası söylenir. \"Geri al\" ile geri alınır."], ["Press F8 and type \"Ahmet Yılmaz arrived\".", "The guest is checked in and their table is said. \"Undo\" takes it back."]) },
    { id: "report.excel", go: { tab: "reports" }, words: "excel indir rapor masa plani disa aktar xlsx export download report",
      title: T("Masa planını Excel olarak indirmek", "Export the table plan to Excel"),
      steps: T(["Raporlar'da \"Masa Planını Dışa Aktar\"a basın.", "Dosyada TABLE PLAN, GUEST LIST ve UNASSIGNED sayfaları olur."], ["On Reports, press \"Export Table Plan\".", "The file has TABLE PLAN, GUEST LIST and UNASSIGNED sheets."]) },
    { id: "report.printPlan", go: { tab: "reports" }, words: "yazdir masa plani kagit cikti print table plan paper",
      title: T("Masa planını yazdırmak", "Print the table plan"),
      steps: T(["Raporlar'da \"Masa planını yazdır\"a basın.", "Yazdır penceresinden PDF olarak da kaydedebilirsiniz."], ["On Reports, press \"Print table plan\".", "You can also save it as PDF from the print dialog."]) },
    { id: "report.doorList", go: { tab: "reports" }, words: "kapi listesi alfabetik giris listesi door list alphabetical entrance",
      title: T("Kapı listesi almak", "Print the door list"),
      steps: T(["Raporlar'da \"Kapı listesini yazdır (A–Z)\"ya basın.", "A'dan Z'ye isim ve masa numarası çıkar; masası olmayanda \"—\" yazar."], ["On Reports, press \"Print door list (A–Z)\".", "Names A–Z with their table; a dash for no table."]) },
    { id: "backup.export", go: { screen: "events" }, words: "yedek al hepsini kaydet dosya backup save everything file",
      title: T("Yedek almak", "Make a backup"),
      steps: T(["Tüm Etkinlikler'de üstteki indirme simgesine basın: bütün etkinlikler bir dosyaya iner.", "Program ayrıca diske kendisi yedek alır."], ["On All Events, press the download icon at the top: every event goes into one file.", "The program also backs up to disk by itself."]) },
    { id: "backup.restore", go: { screen: "events" }, words: "yedekten geri don yukle geri yukle restore backup bring back",
      title: T("Yedekten geri dönmek", "Restore from a backup"),
      steps: T(["Tüm Etkinlikler'de yükleme simgesine basıp yedek dosyasını seçin.", "Ya da kaydet simgesiyle diskteki otomatik yedeklerden birini seçin.", "Önce dosya kontrol edilir; bozuksa hiçbir şey değişmez."], ["On All Events, press the upload icon and choose the backup file.", "Or use the save icon to pick an automatic backup on disk.", "The file is checked first; a bad one changes nothing."]) },
    { id: "backup.disk", go: { screen: "events" }, words: "otomatik yedek nerede disk klasor yedekler automatic backups where folder disk",
      title: T("Diskteki otomatik yedekler", "Automatic backups on disk"),
      steps: T(["Program klasöründeki \"yedekler\" klasöründe tutulur.", "Tüm Etkinlikler'deki kaydet simgesi bu yedekleri listeler."], ["They are in the \"yedekler\" folder of the program.", "The save icon on All Events lists them."]) },
    { id: "f8.use", go: null, words: "f8 asistan ne yapabilir komut yaz assistant what can do commands help",
      title: T("F8 asistanı ne yapar", "What the F8 assistant does"),
      steps: T(["Soru sorar gibi yazın: \"Ahmet galada nerede oturuyor\", \"masası olmayanlar kim\".", "İş yaptırın: \"ahmeti t05e oturt\", \"Ayşe +2 ekle\", \"mehmet geldi\".", "Emin olmadığında önce gösterir, Onayla'yı bekler. \"nasıl yapılır\" sorularına da cevap verir."], ["Ask: \"where does Ahmet sit at the gala\", \"who has no table\".", "Command: \"seat Ahmet at T05\", \"add Ayşe +2\", \"Mehmet arrived\".", "When unsure it shows first and waits. It also answers \"how do I\" questions."]) },
    { id: "lang.switch", go: null, words: "dil ingilizce turkce degistir language english turkish switch",
      title: T("Dili değiştirmek", "Switch the language"),
      steps: T(["Üstteki \"Language / Dil\" seçicisinden Türkçe ya da English seçin.", "Ekranlar ve F8'in cevapları o dile geçer."], ["Pick Türkçe or English in \"Language / Dil\" at the top.", "Screens and F8's answers switch."]) },
    { id: "diag.report", go: { screen: "events" }, words: "sorun hata bozuldu rapor gonder tani problem error broke report send diagnostic",
      title: T("Sorun olunca rapor göndermek", "Send a report when something goes wrong"),
      steps: T(["Tüm Etkinlikler'de uyarı simgesine (Tanı raporu indir) basın; bir dosya iner.", "Dosyada misafir bilgisi yoktur; bu dosyayı gönderin."], ["On All Events, press the alert icon (Download a diagnostic report); a file downloads.", "It holds no guest data; send that file."]) },
    { id: "search.guest", go: { tab: "guests" }, words: "misafir ara bul hizli arama search find guest quickly lookup",
      title: T("Misafir aramak", "Search for a guest"),
      steps: T(["Üstteki arama kutusuna adı yazın; harf hatası ve ekler affedilir (\"ozturku\").", "Sonuca tıklayınca misafir ve masası açılır."], ["Type the name in the top search; typos and endings are forgiven.", "Click a result to open the guest and their table."]) },
    { id: "undo", go: null, words: "geri al yanlislikla sildim ctrl z undo mistake deleted by accident",
      title: T("Geri almak", "Undo"),
      steps: T(["Kat Planı'nda Ctrl+Z geri alır, Ctrl+Y yineler.", "F8'in yaptığı işin altında \"Geri al\" düğmesi vardır.", "Silinen misafir için en son yedekten de dönülebilir."], ["On Floor Plan, Ctrl+Z undoes and Ctrl+Y redoes.", "Every F8 action has an \"Undo\" button under it.", "A deleted guest can also come back from the last backup."]) },
  ];
  const fold = (s) => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9+ ]+/g, " ").replace(/\s+/g, " ").trim();
  const STOP = new Set(["bir", "bi", "ve", "ile", "de", "da", "mi", "mu", "nasil", "nereden", "nerede", "ne", "icin", "istiyorum", "lazim", "the", "a", "an", "to", "how", "do", "i", "my", "of", "on", "is", "can", "where", "what", "with", "it", "this", "that", "for", "in", "and"]);
  const near = (q, w) => {
    const T = globalThis.MeritAssistantTools;
    if (q === w) return 1;
    if (w.length >= 4 && q.startsWith(w)) return 0.9;    // typed with an ending
    if (q.length >= 4 && w.startsWith(q)) return 0.8;    // typed short
    return T && T.sameWord && T.sameWord(q, w) ? 0.7 : 0;
  };
  const INDEX = TOPICS.map((tp) => ({ tp, words: [...new Set(fold(tp.words + " " + tp.title.tr + " " + tp.title.en).split(" ").filter((w) => w && !STOP.has(w)))] }));
  // The topic the question is about, or null when nothing fits well enough.
  function match(text) {
    const qs = fold(text).split(" ").filter((w) => w && !STOP.has(w));
    if (!qs.length) return null;
    let best = null, second = 0;
    for (const it of INDEX) {
      let sc = 0;
      for (const q of qs) { let m = 0; for (const w of it.words) { const v = near(q, w); if (v > m) m = v; } sc += m; }
      sc /= Math.sqrt(qs.length);
      if (!best || sc > best.score) { second = best ? best.score : 0; best = { topic: it.tp, score: sc }; } else if (sc > second) second = sc;
    }
    return best && best.score >= 0.9 ? Object.assign(best, { margin: best.score - second }) : null;
  }
  // "how do I …" — a sentence that asks for the way, not for a fact or a change
  function isHowTo(text) {
    const f = fold(text);
    return /\b(nasil|nereden|nereye|nerden|ne demek|nedir|yapabilir|how|where do|where can|where is the|what does|what can)\b/.test(f) && !/\b(oturuyor|oturdu|geldi mi|kac kisi|kimler)\b/.test(f);
  }
  globalThis.MeritHelpTopics = Object.freeze({ TOPICS, match, isHowTo, fold });
})();
