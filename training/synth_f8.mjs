// F8 sentences -> the second reader's JSON (text-only training items for runB7;
// training/README.md "runB7", pre-registered before this file was written).
//
// A small grammar makes the owner's kind of sentence — questions about past and
// coming events, commands on the open event, two- and three-job sentences, small
// talk — with other verbs, word orders, no apostrophes, no Turkish letters,
// fillers and long indirect clauses; each with its reading in
// MeritAssistantReading's shape, asked exactly as the relay asks (its
// instruction and worked examples). The names, events, venues and tables of the
// test fixture and of every test set are NOT in the pools, and no sentence equals
// a test sentence (checked below).
//
//   node training/synth_f8.mjs --out DIR [--n 2400 --seed 71] [--prompt short]
// (`--prompt short`: asked with MeritAssistantReading.SYSTEM_SHORT and no worked
// examples — the same sentences and readings, a prompt a tenth as long)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of ["src/assistant-tools.js", "src/assistant-reading.js"]) await import(pathToFileURL(path.join(repo, f)).href);
const R = globalThis.MeritAssistantReading;
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
// `--grammar 2` (runB7b): more phrasings per intent and step, two-job sentences sharing a verb
// or a pronoun, more small talk; grammar 1 (runB7) is unchanged and reproducible
const G10 = arg("grammar", "1") === "10";   // runR2: grammar 9 + the kinds r08y missed (names copied whole, pax, list vs table, possessives, tables in questions, multi-step), key-word typos, more names
const G9 = arg("grammar", "1") === "9" || G10;   // runR: grammar 8 + deep English (slang, table codes, numbers, ASCII names, how-to and out-of-scope English)
const G8 = arg("grammar", "1") === "8" || G9;   // runQ: grammar 7 + multi-step/deep, careless English, every test name barred
const G7 = arg("grammar", "1") === "7" || G8;   // runEq: grammar 6 + more careless typing, more English, surnames ending k/p/t/ç (softening)
const G6 = arg("grammar", "1") === "6" || G7;   // runB7f: grammar 5 + English sentences (owner 2026-11-02: the program is fully English too)
const G5 = arg("grammar", "1") === "5" || G6;   // runB7e: grammar 4 + surnames ending in -in/-ın/-un/-ün kept whole, negation with other verbs
const G4 = arg("grammar", "1") === "4" || G5;   // runB7d: grammar 3 + short/inverted questions, more "next to" verbs, terse adds, a stated count beside a story, more small talk
const G3 = arg("grammar", "1") === "3" || G4;   // runB7c: grammar 2 + negation that narrows a command, partner adds, out-of-scope questions
const G2 = arg("grammar", "1") === "2" || G3;
const NUMW = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi"];

// ---- seeded random -------------------------------------------------------------
let seed = Number(arg("seed", 71)) >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;

// ---- pools (nothing from the fixture or the test sets) ------------------------------
const FIRST = ["Murat", "Gizem", "Emre", "Seda", "Kerem", "Buse", "Hakan", "Derya", "Serkan", "Pınar", "Oğuz", "Ebru", "Tolga", "Nazlı", "Cem", "İrem", "Volkan", "Esra", "Barış", "Gül",
  "Kaan", "Melis", "Onur", "Ece", "Sinan", "Tuba", "Umut", "Aslı", "Levent", "Nur", "Erdem", "Yasemin", "Bora", "Dilek", "Fatih", "Hande", "Aylin", "Arda", "Şule", "Çağla", "Ömer", "Özge", "Ufuk", "Sibel", "Ilgaz", "Ümit", "Gökhan", "Neslihan", "Taner"];
const LAST = ["Tekin", "Güneş", "Aydın", "Polat", "Korkmaz", "Erdoğan", "Koç", "Kurt", "Özdemir", "Çelik", "Aksoy", "Turan", "Bulut", "Yıldız", "Karaca", "Ateş", "Uçar", "Toprak", "Duman", "Işık",
  "Bozkurt", "Kılıç", "Sarı", "Altun", "Uysal", "Erol", "Kocabaş", "Sevim", "Ünal", "Güler", "Çakır", "Ekinci", "Tunç", "Oral", "Başaran", "Önal", "Yalçın", "Gündüz", "Akın", "Soylu"];
const LAST7 = ["Akbulut", "Yiğit", "Kıvanç", "Bozbıyık", "Ozanalp", "Erdinç", "Karabacak", "Topçu"];
const LAST5 = ["Bilgin", "Ergün", "Uzun", "Erkin", "Sezgin", "Durgun", "Gürsoy", "Tetik", "Kalkan", "Ersin", "Öztekin", "Bütün"];
// grammar 8: more first names and surnames (none in any test set; checked below like every pool)
if (G8) { FIRST.push("Alper", "Bahar", "Cenk", "Dilara", "Ferhat", "Gamze", "Hilal", "İlker", "Kübra", "Mert", "Nihat", "Özlem", "Rabia", "Selçuk", "Tülin", "Utku", "Yusuf", "Zehra");
  LAST.push("Avcı", "Bayrak", "Coşar", "Dinç", "Gök", "Kalyoncu", "Nalbant", "Okur", "Pala", "Sağlam", "Temiz", "Vural", "Yaman", "Zengin"); }
// grammar 10: many more names, so a name is copied rather than recalled — long ones, Turkish letters, surnames ending
// in a vowel (the "kayas" possessive) and very short surnames (the split "elif" + "senat"); test names leave the pools below
const FIRST10 = ["Nurettin", "Saadet", "Kıymet", "Ertuğrul", "Şükran", "Hüsnü", "Gülizar", "Necdet", "Mükerrem", "Tülay", "İsmail", "Bedriye", "Cengiz", "Fikriye", "Rıfat", "Zübeyde",
  "Orhan", "Leman", "Yıldırım", "Perihan", "Muzaffer", "Sevgül", "Turgay", "Hatice", "Nazım", "Şaziye", "Atilla", "Gülseren", "İhsan", "Melahat", "Selahattin", "Nevin", "Doğan", "Füsun", "Ekrem", "Ülkü"];
const LAST10 = ["Karabulut", "Yazıcı", "Demirci", "Sarıca", "Akça", "Tatlı", "Kuzu", "Bilge", "Arıca", "Kuyucu", "Çalışkan", "Tosun", "Kahraman", "Gençtürk", "Dumlupınar", "Yörük", "Çiftçi", "Eskici",
  "Hacıoğlu", "Kocaoğlu", "Uğurlu", "Türkoğlu", "Saygılı", "Güleryüz", "Ilgın", "Börekçi", "Dağdelen", "Üstündağ", "Taşkıran", "Bıçakçı", "Ağca", "Tüfekçi", "Sönmezer", "Doğru", "Ölmez", "Erçetin"];
const LASTS10 = ["Taş", "Öz", "Ün", "Baş", "Tok", "Ay", "Uç", "Göç"];
if (G10) { FIRST.push(...FIRST10); LAST.push(...LAST10); }
const ARTISTS = ["Kenan Doğulu", "Sertab Erener", "Teoman", "Gripin", "Manuş Baba", "Sıla", "Hadise", "Gökhan Türkmen", "Model", "Yüksek Sadakat", "Ezhel", "Melek Mosso", "Göksel Demirpençe", "Cem Adrian",
  "Athena", "Mor ve Ötesi", "Yaşar", "Feridun Düzağaç", "Pinhani", "Kalben"];
const KINDS = ["konseri", "gecesi", "galası", "gösterisi"];
const VENUES = ["Cemil Topuzlu", "Bostancı", "Volkswagen Arena", "Lütfi Kırdar", "Maximum Uniq", "Küçükçiftlik", "Jolly Joker", "Congresium", "Hilton", "Swissotel"];
const OCC = ["bahar galası", "şirket yemeği", "mezuniyet balosu", "lansman", "iftar yemeği", "nişan", "düğün", "kurumsal gece", "ödül töreni", "bayi toplantısı", "cumhuriyet balosu", "sevgililer günü gecesi"];
const MONTHS = ["ocak", "şubat", "nisan", "mayıs", "temmuz", "ağustos", "ekim", "kasım", "aralık"]; // mart, haziran, eylül are in the tests
const TABLE_PFX = ["T", "T", "T", "VIP", "B"];
const PHONES = () => `05${pick(["32", "33", "35", "36", "41", "42", "52", "53", "55"])} ${100 + Math.floor(rnd() * 900)} ${10 + Math.floor(rnd() * 90)} ${10 + Math.floor(rnd() * 90)}`;
const SMALL2 = ["Bilet fiyatları ne kadar", "Hafta sonu hava nasıl olacak", "Salon kirası kaç para", "Döviz kuru kaç oldu", "Bana bir espri yap", "Kaçta kapanıyoruz", "Yemek menüsünü sen seç", "Sahne ışıkları nasıl olmalı", "Bana tavsiye ver", "Bugün çok işim var", "Ses sistemi kimden", "Bu ay ne kadar kazandık", "Otopark ücretli mi", "Garsonlar kaçta gelecek", "Çiçekçinin numarası ne"];
const SMALL3 = ["Bu programı kim yazdı", "Bilet fiyatı neydi", "Konser kaç saat sürdü", "Sanatçının ücreti ne kadardı", "Garson sayısı yeterli mi", "Otelin adresi ne", "Kaç şişe su lazım", "Davetiyeler basıldı mı", "Fotoğrafçı geliyor mu", "Bu yazılım ne kadar", "Hangi şarkıları çalacaklar", "Vale kaç kişi"];
const SMALL4 = ["Euro ne kadar", "Bu uygulamayı kim geliştirdi", "Yarın kar yağacak mı", "Bir bilmece sor", "Maç kaç kaç bitti", "Bugün günlerden ne", "Altın fiyatı ne", "Benimle sohbet et", "Ne yemek yesem", "Trafik nasıl", "Bu yazılımın sürümü ne", "Kimsin sen"];
const SMALL = ["Merhaba", "Selam, nasılsın?", "Günaydın", "İyi akşamlar", "Teşekkürler", "Sağ ol", "Kolay gelsin", "Bugün hava çok güzel", "Canım sıkkın", "Bana bir şarkı söyle", "Saat kaç?",
  "Dolar ne kadar oldu?", "Akşam ne yesem?", "Bir şiir yaz", "Hafta sonu ne yapalım", "Maç kaç kaç bitti?", "Kahve mi çay mı?", "Beni duyuyor musun?", "Adın ne?", "Nasıl çalışıyorsun?",
  "İstanbul'da trafik nasıl?", "Bana moral ver", "Çok iyisin", "Şaka yaptım", "Tamam", "Neyse boşver", "Bilgisayarı kapat", "Ekranı büyüt", "Programı güncelle", "Müzik aç",
  "Yarın toplantım var mı?", "Benzin ne kadar?", "Bir film öner", "Doğum günüm yaklaşıyor", "Hangi takımı tutuyorsun?", "Bana bir hikaye anlat", "Üşüdüm", "Uykum geldi", "Bugün günlerden ne?", "Hesap makinesini aç"];
const FILL_PRE = ["", "", "", "", "Lütfen ", "Rica etsem ", "Hemen ", "Bi ", "Şimdi ", "Acil: ", "Hatırlarsan, ", "Bir bakar mısın, ", "Bak, "];
const FILL_POST = ["", "", "", "", " lütfen", " hemen", " rica etsem", " teşekkürler", ", sağ ol", "!", "."];
const Q_POST = ["?", "?", "", " acaba?", " söyler misin?", ", bakar mısın?", ", hatırlıyor musun?", " biliyor musun?"];

// ---- Turkish suffixes (proper nouns keep the apostrophe; four-way and two-way harmony) ---
const VOW = "aeıioöuüAEIİOÖUÜ";
const lastVowel = (w) => { for (let i = w.length - 1; i >= 0; i--) if (VOW.includes(w[i])) return w[i].toLocaleLowerCase("tr"); return "e"; };
const endsVowel = (w) => VOW.includes(w[w.length - 1]);
const hard = (w) => "fstkçşhpFSTKÇŞHP".includes(w[w.length - 1]);
const v4 = (w) => ({ a: "ı", ı: "ı", e: "i", i: "i", o: "u", u: "u", ö: "ü", ü: "ü" })[lastVowel(w)];
const v2 = (w) => ("aıou".includes(lastVowel(w)) ? "a" : "e");
// how a table number is read aloud decides its suffix: T05 "beş", T10 "on", VIP01 "bir"
const DIGIT = ["sıfır", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"], TENS = ["", "on", "yirmi", "otuz"];
const spoken = (t) => { const n = Number(t.replace(/\D/g, "")); return n % 10 ? DIGIT[n % 10] : TENS[Math.floor(n / 10)] || "sıfır"; };
const SUF = {
  acc: (w) => (endsVowel(w) ? "y" : "") + v4(w), dat: (w) => (endsVowel(w) ? "y" : "") + v2(w), gen: (w) => (endsVowel(w) ? "n" : "") + v4(w) + "n",
  loc: (w) => (hard(w) ? "t" : "d") + v2(w), abl: (w) => (hard(w) ? "t" : "d") + v2(w) + "n", ins: (w) => (endsVowel(w) ? "y" : "") + "l" + v2(w),
};
let noApos = false;   // per sentence: written without apostrophes
const sfx = (w, c, sayAs) => w + (noApos ? "" : "'") + SUF[c](sayAs || w);
const tsfx = (t, c) => sfx(t, c, spoken(t));

// ---- things a sentence talks about ---------------------------------------------------
const person = (full = chance(0.75)) => (full ? `${pick(FIRST)} ${G7 && chance(0.25) ? pick(LAST7) : G5 && chance(0.3) ? pick(LAST5) : pick(LAST)}` : pick(FIRST));
const table = () => { const p = pick(TABLE_PFX); const n = p === "T" ? 1 + Math.floor(rnd() * 30) : 1 + Math.floor(rnd() * 6); return p + String(n).padStart(2, "0"); };
// an event as said in a sentence, and its words in the reading (lowercase, without the case ending)
function eventRef() {
  const r = rnd();
  if (r < 0.45) { const a = pick(ARTISTS), k = pick(KINDS); return chance(0.5) ? { base: `${a} ${k}`, word: `${a} ${k}`.toLocaleLowerCase("tr") } : { base: a, word: a.toLocaleLowerCase("tr") }; }
  if (r < 0.6) { const o = pick(OCC); return { base: o, word: o }; }
  if (r < 0.72) { const w = pick(["son konser", "geçen konser", "son etkinlik", "bir önceki konser"]); return { base: w, word: w.startsWith("bir") ? "son konser" : w.replace("geçen", "son") }; }
  if (r < 0.84) { const v = pick(VENUES); return { base: v, word: v.toLocaleLowerCase("tr"), venue: true }; }
  const m = pick(MONTHS), y = chance(0.3) ? " " + pick(["2025", "2024", "geçen yıl"]) : "";
  return { base: m + y, word: (m + y).replace("geçen yıl", "gecen yil"), month: true, stem: (c) => (y ? `${y.trim()} ${m}${SUF[c === "loc" ? "loc" : c](m)}` : m + SUF[c](m)) };
}
// an event + case. A possessive compound (konseri, galası, yemeği, toplantısı) takes the
// n-buffer (konserinde, galasına, yemeğini); a common noun softens k → ğ before a vowel
// (etkinliğe); a proper name keeps its apostrophe (Teoman'da).
const COMPOUND = /(konseri|gecesi|galası|gösterisi|balosu|yemeği|töreni|toplantısı)$/;
function evCase(e, c) {
  if (e.month) return e.stem(c);
  if (COMPOUND.test(e.base)) { const v = v2(e.base), u = v4(e.base); return e.base + { loc: "nd" + v, dat: "n" + v, abl: "nd" + v + "n", acc: "n" + u, gen: "n" + u + "n" }[c]; }
  if (ARTISTS.includes(e.base) || VENUES.includes(e.base)) return sfx(e.base, c);
  const sf = SUF[c](e.base);
  return ("aeıioöuü".includes(sf[0]) && e.base.endsWith("k") ? e.base.slice(0, -1) + "ğ" : e.base) + sf;
}
const evRead = (e) => e.word;

// ---- readings ------------------------------------------------------------------
const Qr = (intent, o = {}) => ({ kind: "question", intent, person: o.person ?? null, phone: o.phone ?? null, event: o.event ?? null, many: !!o.many, table: o.table ?? null, steps: [] });
const St = (op, o = {}) => ({ op, guest: o.guest ?? null, table: o.table ?? null, from: o.from ?? null, other: o.other ?? null, name: o.name ?? null, pax: o.pax ?? null, fromTable: o.fromTable ?? null });
const Cr = (steps) => ({ kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null, steps });
const Ur = () => ({ kind: "unknown", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [] });

// ---- questions -------------------------------------------------------------------
function question4(p, e) {
  const r = rnd();
  if (r < 0.3) return [pick([`${evCase(e, "loc")} ${p} neredeydi`, `${p} nerdeydi ${evCase(e, "loc")}`, `${sfx(p, "gen")} yeri ${evCase(e, "loc")}`, `${evCase(e, "loc")} ${sfx(p, "gen")} masası`, `${p} ${evCase(e, "loc")} hangi masa`]), Qr("seatAt", { person: p, event: evRead(e) })];
  if (r < 0.45) return [pick([`${evCase(e, "loc")} gelmeyenler`, `gelmeyenler ${evCase(e, "loc")}`, `${evCase(e, "dat")} kim gelmedi`, `${evCase(e, "loc")} kimler yoktu söyle`]), Qr("noShow", { event: evRead(e) })];
  if (r < 0.6) return [pick([`${evCase(e, "loc")} masasızlar`, `masası olmayanlar ${evCase(e, "loc")}`, `${evCase(e, "loc")} oturmayan var mı`]), Qr("unassigned", { event: evRead(e) })];
  if (r < 0.75) return [pick([`${p} kaç kere`, `${p} kaç konser`, `${p} kaç etkinlik geldi`]), Qr("attended", { person: p })];
  return [pick([`${evCase(e, "loc")} kaç kişi`, `kaç kişi geldi ${evCase(e, "dat")}`, `${evCase(e, "dat")} gelen sayısı`]), Qr("eventCount", { event: evRead(e) })];
}
function question() {
  const p = person(), e = eventRef(), pick1 = rnd();
  if (G4 && pick1 < 0.15) return question4(p, e);
  if (pick1 < 0.3) {   // seatAt
    const ph = chance(0.12) ? PHONES() : null, who = ph ? `${ph} ${pick(["numaralı", "telefonlu"])} ${p}` : p;
    if (e.venue && chance(0.6)) return [pick([`${who} ${sfx(e.base, "loc").replace(/'?(da|de|ta|te)$/, (m) => m)}ki konserlerde nerelerde oturdu`, `${sfx(p, "gen")} ${e.base} konserlerindeki masaları hangileriydi`]), Qr("seatAt", { person: p, phone: null, event: evRead(e), many: true })];
    const t = pick([`${who} ${evCase(e, "loc")} nerede oturdu`, `${who} ${evCase(e, "loc")} hangi masadaydı`, `${who} ${evCase(e, "loc")} kaçıncı masada oturuyordu`, `${sfx(p, "gen")} ${evCase(e, "loc")}ki yeri neresiydi`,
      `${who} ${evCase(e, "dat")} geldi mi`, `${who} ${evCase(e, "dat")} kaç kişiyle geldi`, `${evCase(e, "loc")} ${who} nerede oturuyordu`, `${who} ${evCase(e, "loc")} hangi koltuktaydı`, `${who} ${evCase(e, "loc")} nerede oturacak`, ...(G2 ? [`${who} ${evCase(e, "loc")} hangi masaya oturmuştu`, `${evCase(e, "loc")} ${sfx(p, "gen")} yeri neresiydi`, `${who} ${evCase(e, "dat")} katıldı mı`, `${who} ${evCase(e, "dat")} kaç kişi olarak geldi`, `${who}, ${evCase(e, "loc")} hangi masa`, `${evCase(e, "loc")} ${who} hangi koltukta oturdu`] : []), ...(G3 ? [`${sfx(p, "gen")} ${evCase(e, "loc")}ki grubu kaç kişiydi`, `${who} ${evCase(e, "dat")} kaç kişilik geldi`] : [])]);
    return [t, Qr("seatAt", { person: p, phone: t.includes(who) ? ph : null, event: evRead(e) })];
  }
  if (pick1 < 0.42) return [pick([`${p} kaç etkinliğimize geldi`, `${p} hangi konserlere katıldı`, `${p} bize kaç kere geldi`, `${p} şimdiye kadar kaç konserimizde bulundu`, `${sfx(p, "gen")} geldiği etkinlikler hangileri`, ...(G2 ? [`${p} şimdiye dek kaç kez geldi`, `${p} hangi etkinliklerimizde vardı`, `${p} bizim etkinliklere kaç defa katıldı`, `${p} kaç etkinliğe gelip kaçına gelmedi`] : [])]), Qr("attended", { person: p })];
  if (pick1 < 0.5) return [pick([`${p} hep aynı masada mı oturdu`, `${sfx(p, "gen")} masası her seferinde aynı mıydı`, `${p} her konserde aynı yerde mi oturuyor`, ...(G2 ? [`${p} hep aynı yere mi oturtuldu`, `${sfx(p, "gen")} masası değişiyor mu`, `${p} her etkinlikte aynı masayı mı alıyor`] : [])]), Qr("sameTable", { person: p })];
  if (pick1 < 0.58) return [pick([`${p} daha önce VIP masada oturdu mu`, `${p} hiç VIP'te ağırlandı mı`, `${sfx(p, "acc")} daha önce VIP masaya oturtmuş muyduk`, ...(G2 ? [`${p} önceden VIP bölümünde yer aldı mı`, `${sfx(p, "acc")} VIP masada ağırladık mı`, `${p} VIP masaya hiç oturdu mu`] : [])]), Qr("vipBefore", { person: p })];
  if (pick1 < 0.64) return [pick(["En çok kişi hangi konserde vardı", "en kalabalık etkinliğimiz hangisiydi", "Hangi etkinliğe en çok misafir geldi", "en çok katılım olan konser hangisi", ...(G2 ? ["Katılımın en yüksek olduğu etkinlik hangisi", "en çok insan hangi gece geldi", "en kalabalık konser hangisiydi"] : [])]), Qr("mostPeople")];
  if (pick1 < 0.72) return [pick([`${evCase(e, "dat")} kaç kişi geldi`, `${evCase(e, "loc")} kaç misafir vardı`, `${evCase(e, "dat")} toplam kaç kişi katıldı`, ...(G2 ? [`${evCase(e, "loc")} toplamda kaç kişi vardı`, `${evCase(e, "dat")} gelenlerin sayısı ne`, `${evCase(e, "dat")} kaç misafir katıldı`] : [])]), Qr("eventCount", { event: evRead(e) })];
  if (pick1 < 0.8) return [pick([`${evCase(e, "loc")} masası olmayanlar kim`, `${evCase(e, "loc")} kimler henüz oturtulmadı`, `${evCase(e, "loc")} yeri belli olmayan misafirler kimler`, ...(G2 ? [`${evCase(e, "loc")} yeri olmayan kaldı mı`, `${evCase(e, "loc")} masasız kimler var`, `${evCase(e, "loc")} oturtulmayı bekleyenler kim`] : [])]), Qr("unassigned", { event: evRead(e) })];
  if (pick1 < 0.88) return [pick([`${evCase(e, "dat")} kimler gelmedi`, `${evCase(e, "loc")} gelmeyenler kimdi`, `${evCase(e, "loc")} yeri olup gelmeyenler kimler`, ...(G2 ? [`${evCase(e, "dat")} gelmeyen var mı`, `${evCase(e, "loc")} kimler yoktu`, `${evCase(e, "loc")} yerini boş bırakanlar kimdi`] : [])]), Qr("noShow", { event: evRead(e) })];
  if (pick1 < 0.95) { const t = table(); return [pick([`${evCase(e, "loc")} ${tsfx(t, "loc")} kim var`, `${tsfx(t, "loc")} ${evCase(e, "loc")} kimler oturdu`, `${evCase(e, "loc")} ${t} masasında kim oturuyor`, ...(G2 ? [`${evCase(e, "loc")} ${tsfx(t, "dat")} kimi koyduk`, `${evCase(e, "loc")} ${tsfx(t, "loc")} oturanlar kim`, `${t} masasında ${evCase(e, "loc")} kimler vardı`] : [])]), Qr("whoAtTable", { event: evRead(e), table: t })]; }
  const m = pick(MONTHS), y = chance(0.3) ? pick(["2025 ", "2024 ", "geçen yıl "]) : "";
  return [pick([`${y}${m}${SUF.loc(m)} hangi etkinlik vardı`, `${y}${m} ayında ne yaptık`, `${y}${m}${SUF.loc(m)} hangi konserimiz vardı`, ...(G2 ? [`${y}${m} ayında hangi etkinliği yaptık`, `${y}${m}${SUF.loc(m)} ne vardı`] : [])]), Qr("whichEvent", { event: (y + m).replace("geçen yıl", "gecen yil") })];
}

// ---- commands (one step each; joined below) ------------------------------------------------
// grammar 3: a negation that narrows the command ("silme, sadece …"), partner adds
function step3() {
  const g = person(), t = table(), r = rnd();
  if (r < 0.35) return [pick([`${sfx(g, "acc")} silme, sadece masadan kaldır`, `${sfx(g, "acc")} listeden atma, masasını boşalt`, `${g} silinmesin, sadece masasız kalsın`]), St("unassign", { guest: g })];
  if (r < 0.5) return [pick([`${g} silinmesin, sadece VIP olsun`, `${sfx(g, "acc")} silme, VIP olarak işaretle`]), St("setVip", { guest: g })];
  if (r < 0.65) return [pick([`${sfx(g, "acc")} silmeyelim, ${tsfx(t, "dat")} oturtalım`, `${sfx(g, "acc")} çıkarma, ${tsfx(t, "dat")} geçir`]), St("assign", { guest: g, table: t })];
  const name = person(true), who = pick(["eşini", "kocasını", "karısını"]);
  if (r < 0.82) return [pick([`${name} ile ${who} ekle`, `${name} ve ${who} listeye ekle`]), St("addGuest", { name, pax: 2 })];
  return [pick([`${name} ile ${who} ${tsfx(t, "dat")} yerleştir`, `${name} ile ${who} ekle, ${tsfx(t, "dat")} otursunlar`]), [St("addGuest", { name, pax: 2 }), St("assign", { guest: name, table: t })]];
}
// grammar 4: more verbs for "next to", terse adds, a stated count beside a story (the stated number wins)
function step4() {
  const g = person(), r = rnd();
  if (r < 0.4) { const o = person(); if (o === g) return step4(); return [pick([`${sfx(g, "acc")} ${sfx(o, "gen")} yanına geçir`, `${g} ${sfx(o, "gen")} yanına gelsin`, `${sfx(o, "gen")} yanına ${sfx(g, "acc")} getir`, `${sfx(o, "gen")} yanına ${sfx(g, "acc")} yerleştir`, `${g} ile ${o} yan yana olsun`]), St("nextTo", { guest: g, other: o.toLocaleLowerCase("tr") })]; }
  if (r < 0.65) { const name = person(true); return [pick([`${name} eklensin`, `yeni isim ${name}`, `${name} de davetli`, `${name} gelecek, kaydet`]), St("addGuest", { name, pax: 1 })]; }
  const n = 1 + Math.floor(rnd() * 5), story = pick([`${sfx(g, "gen")} grubuna biri katıldı`, `${g} bir kişi daha getirecek`, `${sfx(g, "gen")} grubundan biri ayrıldı`, `${g} eksik gelecek`, `${sfx(g, "gen")} eşi de geliyor`]);
  return [`${story}, ${pick([`kişi sayısını ${n + 1} yap`, `${n + 1} kişi olsun`, `sayıyı ${NUMW[n + 1]} yap`])}`, St("setPax", { guest: g, pax: n + 1 })];
}
// grammar 5: keep-the-record negations with other verbs; adds whose surname ends like a suffix
function step5() {
  const g = person(), t = table(), r = rnd();
  if (r < 0.45) return [pick([`${sfx(g, "acc")} masasından çıkar, listede dursun`, `${sfx(g, "acc")} ${tsfx(t, "abl")} kaldır, kaydı kalsın`, `${g} masasız kalsın ama listeden çıkmasın`, `${sfx(g, "acc")} masadan indir, silinmesin`]), St("unassign", { guest: g })];
  if (r < 0.6) return [pick([`${g} kalsın, sadece VIP olarak işaretle`, `${sfx(g, "acc")} çıkarma, VIP yap`]), St("setVip", { guest: g })];
  const name = `${pick(FIRST)} ${pick(LAST5)}`, n = pick([0, 0, 1, 2]);
  return [pick([`${name}${n ? " +" + n : ""} ekle`, `listeye ${name} ekle`, `${name} da gelecek`, `yeni misafir ${name}`]), St("addGuest", { name, pax: n + 1 })];
}
function step() {
  if (G5 && chance(0.1)) return step5();
  if (G4 && chance(0.15)) return step4();
  if (G3 && chance(0.12)) return step3();
  const g = person(), t = table(), r = rnd();
  if (r < 0.2) return [pick([`${sfx(g, "acc")} ${tsfx(t, "dat")} oturt`, `${sfx(g, "acc")} ${tsfx(t, "dat")} yerleştir`, `${sfx(g, "acc")} ${tsfx(t, "dat")} al`, `${sfx(g, "acc")} ${tsfx(t, "dat")} koy`, `${sfx(g, "acc")} ${tsfx(t, "dat")} geçir`,
    `${sfx(g, "acc")} ${tsfx(t, "dat")} taşı`, `${g} ${tsfx(t, "dat")} geçsin`, `${g} ${tsfx(t, "loc")} otursun`, `${tsfx(t, "dat")} ${sfx(g, "acc")} oturt`, `${sfx(g, "gen")} masası ${t} olsun`, ...(G2 ? [`${sfx(g, "acc")} ${tsfx(t, "dat")} alır mısın`, `${sfx(g, "acc")} ${tsfx(t, "dat")} oturtalım`, `${g} artık ${tsfx(t, "loc")} otursun`, `${sfx(g, "acc")} ${t} masasına yerleştirir misin`, `${sfx(g, "acc")} ${tsfx(t, "dat")} aktar`] : [])]), St("assign", { guest: g, table: t })];
  if (r < 0.3) { const e = eventRef(); if (e.venue || e.month) return step(); return [pick([`${sfx(g, "acc")} ${evCase(e, "loc")}ki yerine oturt`, `${sfx(g, "acc")} ${evCase(e, "loc")}ki masasına al`, `${g} ${evCase(e, "loc")} nerede oturduysa oraya koy`, `${sfx(g, "dat")} ${evCase(e, "loc")}ki yerini ver`, ...(G2 ? [`${sfx(g, "acc")} ${evCase(e, "loc")} oturduğu yere koy`, `${sfx(g, "acc")} ${evCase(e, "loc")}ki koltuğuna oturt`, `${g} ${evCase(e, "loc")} nerede oturduysa yine orada otursun`] : [])]), St("copySeat", { guest: g, from: evRead(e) })]; }
  if (r < 0.38) { const o = person(); return [pick([`${sfx(g, "acc")} ${sfx(o, "gen")} yanına oturt`, `${g}, ${sfx(o, "gen")} yanında otursun`, `${sfx(g, "acc")} ${sfx(o, "gen")} yanına al`, ...(G2 ? [`${g} ${sfx(o, "gen")} yanında yer alsın`, `${sfx(g, "acc")} ${sfx(o, "gen")} hemen yanına yerleştir`] : [])]), St("nextTo", { guest: g, other: o.toLocaleLowerCase("tr") })]; }
  if (r < 0.46) { const f = table(); return [pick([`${tsfx(f, "loc")}ki herkesi ${tsfx(t, "dat")} taşı`, `${tsfx(f, "loc")}kileri ${tsfx(t, "dat")} geçir`, `${sfx(f, "acc", spoken(f))} komple ${tsfx(t, "dat")} al`, ...(G2 ? [`${tsfx(f, "loc")} oturan herkesi ${tsfx(t, "dat")} geçirelim`, `${t} masasına ${tsfx(f, "loc")}kileri taşı`] : [])]), St("moveTable", { table: t, fromTable: f })]; }
  if (r < 0.56) return [pick([`${sfx(g, "acc")} masadan kaldır`, `${sfx(g, "gen")} masasını boşalt`, `${sfx(g, "acc")} masasından al ama silme`, `${g} masasız kalsın`, `${g} masadan kalksın`, ...(G2 ? [`${sfx(g, "gen")} masa atamasını kaldır`, `${sfx(g, "acc")} masadan çıkar ama listede kalsın`, `${g} şimdilik masasız kalsın`] : [])]), St("unassign", { guest: g })];
  if (r < 0.66) return [pick([`${sfx(g, "acc")} sil`, `${sfx(g, "acc")} listeden çıkar`, `${g} gelmeyecek, listeden sil`, `${sfx(g, "acc")} davetlilerden çıkar`, `${sfx(g, "acc")} listeden kaldır`, ...(G2 ? [`${g} gelmeyecekmiş, sil`, `${sfx(g, "acc")} davetli listesinden sil`, `${sfx(g, "acc")} tamamen kaldır`, `${g} iptal, listeden çıkar`] : [])]), St("deleteGuest", { guest: g })];
  if (r < 0.76) { const n = 1 + Math.floor(rnd() * 5); return [pick([`${g} +${n} olsun`, `${sfx(g, "gen")} kişi sayısını ${n + 1} yap`, `${g} ${n + 1} kişi gelecek`, `${sfx(g, "gen")} grubu ${n + 1} kişi olsun`, ...(G2 ? [`${sfx(g, "gen")} kişi sayısı ${NUMW[n + 1]} olsun`, `${g} ${NUMW[n + 1]} kişilik olacak`] : [])]), St("setPax", { guest: g, pax: n + 1 })]; }
  if (r < 0.84) return [pick([`${sfx(g, "acc")} VIP yap`, `${g} VIP olsun`, `${sfx(g, "acc")} VIP olarak işaretle`, ...(G2 ? [`${g} VIP misafirimiz`, `${sfx(g, "acc")} VIP listesine al`, `${sfx(g, "acc")} VIP olarak kaydet`] : [])]), St("setVip", { guest: g })];
  const n = pick([0, 0, 1, 1, 2, 3]), extra = n === 0 ? "" : pick(n === 1 ? [" +1", " ve eşi", " ve bir misafiri"] : [` +${n}`, ` ve ${["", "", "iki", "üç"][n]} misafiri`]);
  const withT = chance(0.45), name = person(true);
  const verb = extra.startsWith(" ve") ? (extra.endsWith("eşi") ? extra.replace("eşi", "eşini") : extra + "ni") : extra;
  if (withT) return [pick([`${tsfx(t, "dat")} ${name}${verb} ekle`, `${name}${verb} ekle, ${tsfx(t, "dat")} oturt`.replace(/(.*),.*/, `$1 ve ${tsfx(t, "dat")} oturt`)]), [St("addGuest", { name, pax: n + 1 }), St("assign", { guest: name, table: t })]];
  return [pick([`${name}${verb} ekle`, `Yeni misafir: ${name}${extra}`, `listeye ${name}${verb} ekle`, ...(extra ? [] : [`${sfx(name, "acc")} listeye ekle`, `${sfx(name, "acc")} da ekle`]), ...(G2 ? [`${name} adında bir misafir ekle`, `${name} de gelecek, listeye ekle`] : [])]), St("addGuest", { name, pax: n + 1 })];
}
// two seats in one sentence sharing the verb, or a second job on the same guest ("onu")
function sharedCommand() {
  const g1 = person(), g2 = person(), t1 = table(), t2 = table(), v = pick(["oturt", "yerleştir", "al", "geçir", "koy"]);
  if (g1 === g2 || t1 === t2) return sharedCommand();
  if (chance(0.5)) return [`${sfx(g1, "acc")} ${tsfx(t1, "dat")}, ${sfx(g2, "acc")} ${v2(g2 + SUF.acc(g2)) === "a" ? "da" : "de"} ${tsfx(t2, "dat")} ${v}`, Cr([St("assign", { guest: g1, table: t1 }), St("assign", { guest: g2, table: t2 })])];
  const n = 1 + Math.floor(rnd() * 5), first = pick([[`${sfx(g1, "gen")} kişi sayısını ${n + 1} yap`, St("setPax", { guest: g1, pax: n + 1 })], [`${sfx(g1, "acc")} ${tsfx(t1, "dat")} oturt`, St("assign", { guest: g1, table: t1 })], [`${sfx(g1, "acc")} masadan kaldır`, St("unassign", { guest: g1 })]]);
  const second = pick([[`onu VIP ${pick(["yap", "olarak işaretle"])}`, St("setVip", { guest: g1 })], ...(first[1].op === "assign" ? [] : [[`onu ${tsfx(t2, "dat")} oturt`, St("assign", { guest: g1, table: t2 })]])]);
  return [`${first[0]}${pick([" ve ", ", sonra ", ", ardından "])}${second[0]}`, Cr([first[1], second[1]])];
}
function command() {
  if (G2 && chance(0.12)) return sharedCommand();
  const k = rnd() < 0.72 ? 1 : rnd() < 0.85 ? 2 : 3, parts = [], steps = [];
  while (parts.length < k) {
    const [t, s] = step(), ss = Array.isArray(s) ? s : [s];
    if (steps.length + ss.length > 3) break;
    parts.push(t); steps.push(...ss);
  }
  const joins = [" ve ", ", sonra ", ", ardından ", "; bir de ", ", "];
  let text = parts[0]; for (let i = 1; i < parts.length; i++) text += pick(joins) + parts[i];
  // a past event named on an assign: the reading carries it (the acting layer refuses)
  if (steps.length === 1 && steps[0].op === "assign" && chance(0.12)) { const e = eventRef(); if (!e.venue && !e.month) { text = `${evCase(e, "loc")} ${text}`; steps[0].from = evRead(e); } }
  return [text, Cr(G8 ? fold3(steps) : steps)];
}


// ---- grammar 6: English (the same readings; names, artists, tables as written) ------------------
const OCC_EN = ["spring gala", "company dinner", "graduation ball", "product launch", "awards night", "dealer meeting", "wedding", "charity dinner"];
const MON_EN = { january: "ocak", february: "şubat", april: "nisan", may: "mayıs", july: "temmuz", august: "ağustos", october: "ekim", november: "kasım", december: "aralık" };
const SMALL_EN = ["Hello", "Good morning", "Thanks", "How are you", "What time is it", "Tell me a story", "Is it raining", "What should I eat tonight", "Play some music", "Who made you",
  "What's the dollar rate", "Write a poem", "I'm tired", "Recommend a film", "How's the traffic", "What day is it today", "Turn up the screen", "Sing a song", "Who won the match", "Can you hear me"];
function eventEn() {
  const r = rnd();
  if (r < 0.5) { const a = pick(ARTISTS); return { say: chance(0.5) ? `the ${a} concert` : a, word: a.toLocaleLowerCase("tr") }; }
  if (r < 0.7) { const o = pick(OCC_EN); return { say: `the ${o}`, word: o }; }
  if (r < 0.85) return { say: pick(["the last concert", "our last event", "the previous concert"]), word: "son konser" };
  const v = pick(VENUES); return { say: `the ${v} show`, word: v.toLocaleLowerCase("tr") };
}
const own = (n) => `${n}'s`;
function questionEn() {
  const p = person(), e = eventEn(), r = rnd();
  if (r < 0.28) return [pick([`Where did ${p} sit at ${e.say}`, `Which table was ${p} at for ${e.say}`, `Did ${p} come to ${e.say}`, `Where is ${p} sitting at ${e.say}`, `What was ${own(p)} seat at ${e.say}`, `How many people did ${p} bring to ${e.say}`]), Qr("seatAt", { person: p, event: e.word })];
  if (r < 0.38) return [pick([`How many of our events has ${p} attended`, `Which concerts did ${p} come to`, `How often has ${p} been to our events`]), Qr("attended", { person: p })];
  if (r < 0.45) return [pick([`Does ${p} always sit at the same table`, `Is ${own(p)} table always the same`]), Qr("sameTable", { person: p })];
  if (r < 0.52) return [pick([`Has ${p} ever sat at a VIP table`, `Was ${p} at a VIP table before`]), Qr("vipBefore", { person: p })];
  if (r < 0.57) return [pick(["Which event had the most people", "What was our busiest concert"]), Qr("mostPeople")];
  if (r < 0.66) return [pick([`How many people came to ${e.say}`, `How many guests were at ${e.say}`]), Qr("eventCount", { event: e.word })];
  if (r < 0.76) return [pick([`Who has no table at ${e.say}`, `Who is still unseated at ${e.say}`, `Who doesn't have a seat yet at ${e.say}`]), Qr("unassigned", { event: e.word })];
  if (r < 0.86) return [pick([`Who didn't come to ${e.say}`, `Who were the no-shows at ${e.say}`, `Who missed ${e.say}`]), Qr("noShow", { event: e.word })];
  if (r < 0.94) { const t = table(); return [pick([`Who sat at ${t} at ${e.say}`, `Who is at table ${t} for ${e.say}`]), Qr("whoAtTable", { event: e.word, table: t })]; }
  const m = pick(Object.keys(MON_EN)); return [pick([`What event did we have in ${m}`, `Which concert was in ${m}`]), Qr("whichEvent", { event: MON_EN[m] })];
}
function stepEn() {
  const g = person(), t = table(), r = rnd();
  if (r < 0.2) return [pick([`Seat ${g} at ${t}`, `Move ${g} to ${t}`, `Put ${g} at table ${t}`, `${g} should sit at ${t}`, `Move ${g} over to ${t}`]), St("assign", { guest: g, table: t })];
  if (r < 0.28) { const e = eventEn(); if (e.word === "son konser" && chance(0.5)) return stepEn(); return [pick([`Give ${g} the seat they had at ${e.say}`, `Put ${g} where they sat at ${e.say}`]), St("copySeat", { guest: g, from: e.word })]; }
  if (r < 0.37) { const o = person(); if (o === g) return stepEn(); return [pick([`Seat ${g} next to ${o}`, `Put ${g} beside ${o}`, `${g} should sit with ${o}`, `Move ${g} to ${own(o)} table`]), St("nextTo", { guest: g, other: o.toLocaleLowerCase("tr") })]; }
  if (r < 0.45) { const f = table(); if (f === t) return stepEn(); return [pick([`Move everyone at ${f} to ${t}`, `Move all of ${f} to ${t}`]), St("moveTable", { table: t, fromTable: f })]; }
  if (r < 0.55) return [pick([`Take ${g} off their table`, `Unseat ${g} but keep them on the list`, `Remove ${g} from the table, don't delete them`]), St("unassign", { guest: g })];
  if (r < 0.63) return [pick([`Delete ${g}`, `Remove ${g} from the list`, `${g} is not coming, delete them`]), St("deleteGuest", { guest: g })];
  if (r < 0.71) { const n = 2 + Math.floor(rnd() * 4); return [pick([`Set ${own(g)} party size to ${n}`, `${g} is coming as ${n} people`, `Make ${own(g)} group ${n}`]), St("setPax", { guest: g, pax: n })]; }
  if (r < 0.78) return [pick([`Make ${g} VIP`, `Mark ${g} as VIP`]), St("setVip", { guest: g })];
  const name = person(true), n = pick([0, 0, 1, 1, 2]), extra = n === 0 ? "" : n === 1 ? pick([" +1", " and his wife", " and her husband", " and a friend"]) : pick([` +${n}`, " and two friends"]);
  if (chance(0.35)) return [pick([`Add ${name}${extra} to ${t}`, `Add ${name}${extra} and seat them at ${t}`]), [St("addGuest", { name, pax: n + 1 }), St("assign", { guest: name, table: t })]];
  return [pick([`Add ${name}${extra}`, `New guest: ${name}${extra}`, `Add ${name}${extra} to the list`, `Put ${name}${extra} on the guest list`]), St("addGuest", { name, pax: n + 1 })];
}
function commandEn() {
  const k = rnd() < 0.8 ? 1 : 2, parts = [], steps = [];
  while (parts.length < k) { const [t, s] = G9 && chance(0.65) ? stepEn9() : stepEn(), ss = Array.isArray(s) ? s : [s]; if (steps.length + ss.length > 3) break; parts.push(t); steps.push(...ss); }
  let text = parts[0]; for (let i = 1; i < parts.length; i++) text += pick([" and ", ", then ", "; also "]) + (G8 ? lcVerb(parts[i]) : parts[i].replace(/^./, (c) => c.toLowerCase()));
  return [text, Cr(G8 ? fold3(steps) : steps)];
}
function english() {
  const r = rnd();
  const [text, reading] = r < 0.42 ? questionEn() : r < (G9 ? 0.86 : 0.9) ? commandEn() : [G9 ? pick(chance(0.45) ? OUT_EN : chance(0.4) ? HOWTO_EN : SMALL_EN) : pick(SMALL_EN), Ur()];
  const low = chance(0.3), q = reading.kind === "question";
  let tx = text + (q ? pick(["?", "?", "", " please?"]) : pick(["", "", ".", " please", " thanks"]));
  const r2 = JSON.parse(JSON.stringify(reading));
  if (low) { tx = tx.toLowerCase(); const lc = (v) => (typeof v === "string" ? v.toLocaleLowerCase("tr") : v); r2.person = lc(r2.person); r2.steps = r2.steps.map((s) => ({ ...s, guest: lc(s.guest), name: lc(s.name) })); }
  return [tx, r2];
}

// ---- grammar 8 (runQ): multi-step / deep sentences ------------------------------------------------
// In a plan of three steps an add and its seat are ONE addGuest carrying the table: the acting layer's
// form (assistant-reading toParse folds add + assign only in a two-step plan; deep.jsonl dc2's gold).
function fold3(steps) {
  if (steps.length < 3) return steps;
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i], nx = steps[i + 1];
    if (s.op === "addGuest" && !s.table && nx && nx.op === "assign" && nx.guest === s.name) { out.push({ ...s, table: nx.table }); i++; } else out.push(s);
  }
  return out;
}
// a joined English part is lower-cased only when it starts with a verb (never a name)
const lcVerb = (t) => t.replace(/^(Seat|Move|Put|Take|Unseat|Delete|Remove|Set|Make|Mark|Add|New|Give)\b/, (w) => w.toLowerCase());
const J = (...a) => a.filter(Boolean).join(" ");
const COMP8 = [["eşiyle", 2], ["eşiyle beraber", 2], ["kocasıyla", 2], ["karısıyla birlikte", 2], ["bir misafiriyle", 2], ["bir arkadaşıyla", 2], ["iki misafiriyle", 3], ["iki arkadaşıyla beraber", 3], ["üç misafiriyle", 4], ["tek başına", 1], ["yalnız", 1]];
const TAIL8 = ["; listede yoksa bana sor", ", böyle biri yoksa hiçbir şeye dokunma", "; bulamazsan sor", ", emin değilsen önce sor", "; kayıt yoksa değiştirme", ", yanlış kişi olursa sor"];
const ORD8 = [["", ", sonra ", " ve "], ["Önce ", ", ardından ", ", son olarak "], ["İlk iş ", ", daha sonra ", "; en sonunda "], ["", "; sonra ", ", bir de "], ["Şöyle yapalım: ", ", sonra ", ", sonra da "]];
const seatV = () => pick(["oturt", "yerleştir", "geçir", "al", "koy", "aktar"]);
const daDe = (w) => (v2(w) === "a" ? "da" : "de");
const nsfx = (n, c) => sfx(String(n), c, DIGIT[n]);
// one job on a guest, said with the name the first time and "onu" after
function job8(g, ref, used) {
  const t = table(), o = person(), r = rnd(), gen = ref === "onu" ? "onun" : sfx(g, "gen");
  if (r < 0.25 && !used.has("assign")) return [`${ref} ${tsfx(t, "dat")} ${seatV()}`, St("assign", { guest: g, table: t }), "assign"];
  if (r < 0.4 && !used.has("unassign") && !used.has("assign")) return [`${ref} ${pick(["masasından kaldır", "masadan indir", "masasız bırak"])}`, St("unassign", { guest: g }), "unassign"];
  if (r < 0.6 && !used.has("setVip")) return [`${ref} VIP ${pick(["yap", "olarak işaretle", "listesine al"])}`, St("setVip", { guest: g }), "setVip"];
  if (r < 0.8 && !used.has("setPax")) { const n = 2 + Math.floor(rnd() * 5); return [pick([`${gen} kişi sayısını ${n} yap`, `${gen} grubunu ${n} kişi yap`]), St("setPax", { guest: g, pax: n }), "setPax"]; }
  if (!used.has("assign") && o !== g) return [`${ref} ${sfx(o, "gen")} yanına ${pick(["oturt", "yerleştir", "al"])}`, St("nextTo", { guest: g, other: o.toLocaleLowerCase("tr") }), "assign"];
  return null;
}
function deepCommand() {
  const g = person(chance(0.8)), g2 = person(chance(0.8)), t = table(), f = table(), r = rnd();
  if (g === g2 || f === t) return deepCommand();
  const [c, cp] = pick(COMP8), nn = person(true), nn2 = person(true), ord = pick(ORD8);
  let text, steps;
  if (r < 0.14) {   // someone leaves the table or the list, someone is added in the place
    const keep = chance(0.4), withT = chance(0.7);
    const first = keep ? pick([`${sfx(g, "acc")} silme, sadece masasından kaldır`, `${sfx(g, "acc")} listeden atma, masasını boşalt`, `${g} listede kalsın ama masadan kalksın`])
      : pick([`${g} ${pick(["artık gelmeyecekmiş", "gelemiyormuş", "iptal etti"])}, ${pick(["onu listeden tamamen sil", "kaydını sil", "onu listeden çıkar"])}`, `${sfx(g, "acc")} listeden tamamen sil`]);
    const add = withT ? pick([J(pick(["yerine", "onun yerine", "boşalan yere"]), tsfx(t, "dat"), sfx(nn, "acc"), c, pick(["ekle", "yaz"])), J(pick(["yerine", "onun yerine"]), sfx(nn, "acc"), c, tsfx(t, "dat"), pick(["ekle", "yerleştir"]))])
      : J(pick(["yerine", "onun yerine"]), sfx(nn, "acc"), c, "listeye ekle");
    text = `${first}${pick(["; ", ", ", " ve "])}${add}`;
    steps = [St(keep ? "unassign" : "deleteGuest", { guest: g }), St("addGuest", { name: nn, pax: cp, table: withT ? t : null })];
  } else if (r < 0.28) {   // a count changed, then the group / "onu" moved
    const a = 1 + Math.floor(rnd() * 4), b = a + 1 + Math.floor(rnd() * 3), up = chance(0.6), [from, to] = up ? [a, b] : [b, a];
    const first = pick([`${sfx(g, "gen")} kişi sayısını ${nsfx(from, "abl")} ${nsfx(to, "dat")} ${up ? pick(["çıkar", "yükselt"]) : pick(["düşür", "indir"])}`,
      `${sfx(g, "gen")} grubu ${up ? pick(["büyüdü", "genişledi"]) : pick(["küçüldü", "azaldı"])}, artık ${to} kişiler; ${pick(["sayıyı güncelle", "kişi sayısını düzelt", "kaydı düzelt"])}`]);
    const o = person(); if (o === g) return deepCommand();
    const sec = pick([[`${pick(["onu", "onları"])} ${tsfx(t, "dat")} ${pick(["taşı", "geçir", "oturt"])}`, St("assign", { guest: g, table: t })], [`onu ${sfx(o, "gen")} yanına oturt`, St("nextTo", { guest: g, other: o.toLocaleLowerCase("tr") })], [`onu VIP ${pick(["yap", "olarak işaretle"])}`, St("setVip", { guest: g })]]);
    text = `${first}${pick([" ve ", ", sonra ", "; ardından "])}${sec[0]}`; steps = [St("setPax", { guest: g, pax: to }), sec[1]];
  } else if (r < 0.4) {   // a whole table moved, then someone to "that same table"
    text = `${tsfx(f, "loc")} ${pick(["oturanların hepsini", "oturan herkesi", "kim varsa"])} ${tsfx(t, "dat")} ${pick(["kaydır", "taşı", "geçir"])}${pick([", sonra ", "; ardından ", " ve "])}${sfx(g, "acc")} ${daDe(g + SUF.acc(g))} ${pick(["aynı masaya", "o masaya", "oraya", `aynı yere, ${tsfx(t, "dat")}`])} ${seatV()}`;
    steps = [St("moveTable", { table: t, fromTable: f }), St("assign", { guest: g, table: t })];
  } else if (r < 0.52) {   // two adds in one sentence
    const [c2, cp2] = pick(COMP8); if (nn === nn2) return deepCommand();
    text = pick([`${pick(["Yeni misafirler var:", "Listeye iki kişi girecek:", "İki yeni davetli:"])} ${nn} ${c}, ${nn2} ${pick(["ise", "de"])} ${c2} ${pick(["gelecek", "katılacak"])}; ${pick(["ikisini de listeye ekle", "ikisini de kaydet", "ikisini de yaz"])}`,
      `${sfx(nn, "acc")} ${c} ve ${sfx(nn2, "acc")} ${c2} listeye ekle`]);
    steps = [St("addGuest", { name: nn, pax: cp }), St("addGuest", { name: nn2, pax: cp2 })];
  } else if (r < 0.62) {   // a negation that redirects
    text = pick([`${sfx(g, "acc")} ${sfx(g2, "gen")} yanına ${pick(["koyma", "oturtma"])}, ${pick(["onu doğrudan", "direkt", "onu"])} ${tsfx(t, "dat")} ${seatV()}`, `${sfx(g, "acc")} ${tsfx(f, "dat")} değil, ${tsfx(t, "dat")} ${seatV()}`,
      `${g} ${tsfx(f, "loc")} ${pick(["oturmasın", "kalmasın"])}, ${tsfx(t, "dat")} geçsin`, `${sfx(g, "acc")} silme, ${pick(["sadece", "yalnızca"])} ${tsfx(t, "dat")} ${seatV()}`]);
    steps = [St("assign", { guest: g, table: t })];
  } else if (r < 0.72) {   // an earlier seat copied, then someone else seated
    const e = eventRef(); if (e.venue || e.month) return deepCommand();
    text = `${sfx(g, "acc")} ${evCase(e, "loc")} ${pick(["oturduğu yere", "nerede oturduysa oraya"])} ${seatV()}${pick([", ardından ", ", sonra ", "; "])}${sfx(g2, "acc")} ${daDe(g2 + SUF.acc(g2))} ${tsfx(t, "dat")} ${seatV()}`;
    steps = [St("copySeat", { guest: g, from: evRead(e) }), St("assign", { guest: g2, table: t })];
  } else {   // two or three jobs with order words, "onu" for the same guest
    const k = chance(0.55) ? 2 : 3, parts = [], used = new Map();
    steps = [];
    while (parts.length < k) {
      const same = parts.length > 0 && chance(0.5), who = same ? steps[steps.length - 1].guest : parts.length === 0 ? g : g2;
      if (!who) break;
      const u = used.get(who) || new Set(), jb = job8(who, same ? "onu" : sfx(who, "acc"), u);
      if (!jb) break;
      u.add(jb[2]); used.set(who, u); parts.push(jb[0]); steps.push(jb[1]);
    }
    if (parts.length < 2) return deepCommand();
    text = ord[0] + parts[0] + ord[1] + parts[1] + (parts[2] ? ord[2] + parts[2] : "");
  }
  if (steps.some((s) => s.guest) && chance(0.2)) text += pick(TAIL8);
  return [text, Cr(fold3(steps))];
}
function deepQuestion() {
  const [core, reading] = question();
  const pre = pick(["Hani geçenlerde konuştuk ya, ", "Aklıma takıldı: ", "Müşteri soruyor, ", "Rapor için lazım, ", "Bir şey soracağım, ", "Toplantıdan önce şunu bilmem lazım: ", "Şunu merak ettim, ", ""]);
  const post = pick(["", ", bir hatırlat bana", ", tam olarak söyler misin", ", kontrol eder misin", ", yani kısaca söyle", "; acelem yok ama lazım", ", kayıtlara bakar mısın"]);
  if (!pre && !post) return deepQuestion();
  return [pre + core + post, reading];
}
function deepEn() {
  if (chance(0.3)) { const [q, rd] = questionEn(); return [pick(["Quick question before the meeting: ", "For the report, ", "A client is asking: ", "I need to know this, ", "Just checking, "]) + q + pick(["", ", can you check", ", please look it up", ", remind me", ", I need it now"]), rd]; }
  if (chance(0.25)) {   // someone seated, then a new guest added to that same table
    const g = person(), t = table(), name = person(true), n = pick([0, 1, 1, 2]), extra = n === 0 ? "" : n === 1 ? pick([" and his wife", " and her husband", " +1", " and a guest"]) : pick([" and two friends", " +2"]);
    return [`${pick(["First move", "Move", "Seat"])} ${g} ${pick(["to", "at"])} ${t}${pick([", then ", " and then ", "; after that "])}put ${name}${extra} at that table as well`, Cr(fold3([St("assign", { guest: g, table: t }), St("addGuest", { name, pax: n + 1 }), St("assign", { guest: name, table: t })]))];
  }
  const k = chance(0.6) ? 2 : 3, parts = [], steps = [], ord = pick([["First ", ", then ", ", and finally "], ["", " and then ", ", and after that "], ["", "; after that ", "; lastly "]]);
  while (parts.length < k) { const [t, s] = G9 && chance(0.6) ? stepEn9() : stepEn(), ss = Array.isArray(s) ? s : [s]; if (steps.length + ss.length > 3) break; parts.push(t); steps.push(...ss); }
  if (parts.length < 2) return deepEn();
  let text = ord[0] + (ord[0] ? lcVerb(parts[0]) : parts[0]);
  for (let i = 1; i < parts.length; i++) text += ord[Math.min(i, 2)] + lcVerb(parts[i]);
  return [text, Cr(fold3(steps))];
}
// English surface for grammar 8: case, punctuation and (sometimes) no Turkish letters, the reading kept in step
function surfaceEn(text, reading) {
  const q = reading.kind === "question", low = chance(0.35), tr = chance(0.4);
  let tx = text + (q ? pick(["?", "?", "", " please?"]) : pick(["", "", ".", " please", " thanks"]));
  const r2 = JSON.parse(JSON.stringify(reading));
  const map = (v) => (typeof v !== "string" ? v : tr ? detr(low ? v.toLocaleLowerCase("tr") : v) : low ? v.toLocaleLowerCase("tr") : v);
  if (low) tx = tx.toLowerCase();
  if (tr) tx = detr(tx);
  r2.person = map(r2.person); r2.event = map(r2.event);
  r2.steps = r2.steps.map((s) => ({ ...s, guest: map(s.guest), name: map(s.name), other: s.other == null ? s.other : (tr ? detr(s.other) : s.other), from: s.from == null ? s.from : (tr ? detr(s.from) : s.from) }));
  return [tx, r2];
}

// ---- grammar 9 (runR): deep English, from the misses read on the SEEN sets (en9/entypo9/en10/entypo10) --------
// possessives typed without an apostrophe ("kayas group" = Kaya), "take X of(f) the table" = unseat (not a copy),
// out-of-scope English questions = unknown, low confidence on English — and the kinds of English the owner listed:
// slang and short forms, table codes and numbers in every shape, Turkish names typed in ASCII, multi-step, how-to.
const NUM_EN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
// a table as people say or type it; the reading always carries the canonical code (T07, VIP02)
function tableSaid(t) {
  const m = /^([A-Z]+)(\d+)$/.exec(t), p = m[1], n = Number(m[2]), r = rnd();
  if (p === "T") return r < 0.25 ? t : r < 0.4 ? `table ${n}` : r < 0.5 ? (n <= 12 ? `table ${NUM_EN[n]}` : `table ${n}`) : r < 0.62 ? `t${n}` : r < 0.72 ? `T${n}` : r < 0.8 ? `T ${m[2]}` : r < 0.88 ? `t${m[2]}` : r < 0.94 ? `table T${m[2]}` : `T-${m[2]}`;
  return r < 0.3 ? t : r < 0.45 ? `${p} ${n}` : r < 0.55 ? `${p.toLowerCase()}${n}` : r < 0.65 ? `${p}-${m[2]}` : r < 0.75 ? `${p.toLowerCase()} ${m[2]}` : r < 0.85 ? (n <= 12 ? `${p} ${NUM_EN[n]}` : t) : `${p} table ${n}`;
}
const pron = () => pick([["him", "his"], ["her", "her"], ["them", "their"]]);
function stepEn9() {
  const g = person(), t = table(), ts = tableSaid(t), [ob, po] = pron(), r = rnd();
  if (r < 0.16) return [pick([`Seat ${g} at ${ts}`, `Move ${g} to ${ts}`, `Put ${g} at ${ts}`, `${g} goes to ${ts}`, `Send ${g} over to ${ts}`, `Sit ${g} at ${ts}`, `Stick ${g} at ${ts}`, `${g} should be at ${ts}`, `Can you put ${g} at ${ts}`, `${g} -> ${ts}`]), St("assign", { guest: g, table: t })];
  if (r < 0.24) { const e = eventEn(); if (e.word === "son konser") return stepEn9(); return [pick([`Give ${g} ${po} ${e.say.replace(/^the /, "")} seat`, `Seat ${g} where ${ob === "them" ? "they" : ob === "him" ? "he" : "she"} sat at ${e.say}`, `${g} should sit wherever ${ob === "them" ? "they" : ob === "him" ? "he" : "she"} sat at ${e.say}`, `Same seat for ${g} as at ${e.say}`]), St("copySeat", { guest: g, from: e.word })]; }
  if (r < 0.32) { const o = person(); if (o === g) return stepEn9(); return [pick([`Sit ${g} beside ${o}`, `Seat ${g} next to ${o}`, `Put ${g} with ${o}`, `${g} sits next to ${o}`, `Place ${g} by ${o}`, `Move ${g} next to ${o}`]), St("nextTo", { guest: g, other: o.toLocaleLowerCase("tr") })]; }
  if (r < 0.39) { const f = table(); if (f === t) return stepEn9(); const fs2 = tableSaid(f); return [pick([`Move everyone from ${fs2} to ${ts}`, `Move the whole of ${fs2} over to ${ts}`, `Everybody at ${fs2} goes to ${ts}`, `Shift all the guests at ${fs2} to ${ts}`, `Swap all of ${fs2} into ${ts}`]), St("moveTable", { table: t, fromTable: f })]; }
  if (r < 0.5) return [pick([`Take ${g} off ${po} table`, `Take ${g} off the table but keep ${ob}`, `Free up ${own(g)} seat`, `Unseat ${g}, keep ${ob} on the list`, `${g} doesn't need a table anymore, keep ${ob} on the list`, `Clear ${own(g)} seat but don't delete ${ob}`, `Get ${g} off ${po} table`, `Remove ${g} from ${po} table only`]), St("unassign", { guest: g })];
  if (r < 0.57) return [pick([`Delete ${g}`, `Remove ${g} from the guest list completely`, `${g} cancelled, delete ${ob}`, `Kick ${g} off the list`, `Drop ${g} from the list`, `Erase ${g}`]), St("deleteGuest", { guest: g })];
  if (r < 0.69) {
    const k = rnd(), n = 1 + Math.floor(rnd() * 6);
    const [say, pax] = k < 0.25 ? [pick([`${own(g)} party is now ${n}`, `Make ${own(g)} group ${n}`, `Set ${own(g)} party to ${n}`, `${own(g)} group is ${pick(NUM_EN.slice(1, 8))} people now`].map((x) => x)), null]
      : k < 0.45 ? [pick([`${g} is coming as ${NUM_EN[n]}`, `${g} is a party of ${n}`, `${g} will be ${n} people total`, `${g} comes with ${n} people in total`]), n]
      : k < 0.65 ? [pick([`${g} is bringing ${NUM_EN[n]} guests`, `${g} comes with ${n} guests`, `${g} plus ${n}`]), n + 1]
      : k < 0.8 ? [pick([`${g} is coming with ${po} wife`, `${g} brings ${po} husband`, `${g} and partner are coming`]), 2]
      : [`${g} is coming with ${po === "their" ? "their" : po} wife and ${NUM_EN[Math.max(1, n - 1)]} kids`, 2 + Math.max(1, n - 1)];
    if (pax === null) { const m = say.match(/(\d+)|(one|two|three|four|five|six|seven) people/); const v = m[1] ? Number(m[1]) : NUM_EN.indexOf(m[2]); return [say, St("setPax", { guest: g, pax: v })]; }
    return [say, St("setPax", { guest: g, pax })];
  }
  if (r < 0.76) return [pick([`Make ${g} a VIP`, `Mark ${g} VIP`, `${g} is VIP from now on`, `Flag ${g} as VIP`, `Give ${g} VIP status`, `VIP for ${g}`]), St("setVip", { guest: g })];
  const name = person(true), n = pick([0, 0, 1, 1, 2, 3]);
  const extra = n === 0 ? pick(["", "", " alone", " on their own"]) : n === 1 ? pick([" +1", " and his wife", " and her husband", " with a friend", " with one guest", " plus one"]) : pick([` +${n}`, ` with ${NUM_EN[n]} guests`, ` and ${NUM_EN[n]} friends`, ` with ${n} guests`]);
  const party = chance(0.15) ? pick([[`, party of ${n + 1}`, n + 1], [`, ${n + 1} people`, n + 1]]) : ["", null];
  const pax = party[1] ?? n + 1, ex = party[1] ? "" : extra;
  if (chance(0.35)) return [pick([`Add ${name}${ex}${party[0]} to ${ts}`, `Add ${name}${ex}${party[0]} and seat them at ${ts}`, `Bring in ${name}${ex} and put them at ${ts}`, `New guest ${name}${ex}, seat at ${ts}`]), [St("addGuest", { name, pax }), St("assign", { guest: name, table: t })]];
  return [pick([`Add ${name}${ex}${party[0]}`, `New guest: ${name}${ex}${party[0]}`, `Put ${name}${ex} on the list`, `Add ${name}${ex} to the guest list`, `Sign up ${name}${ex}`]), St("addGuest", { name, pax })];
}

function deepEn9() {
  const A = person(), B = person(), t = table(), ts = tableSaid(t), [ob, po] = pron(), N = person(true), N2 = person(true), r = rnd();
  if (A === B || N === N2) return deepEn9();
  const tail = pick(["", "", "", "; if they're not on the list ask me first", ", only if they're on the list", " - ask me if you can't find them", "; don't change anything if unsure"]);
  const k = pick([0, 1, 1, 2]), plus = k === 0 ? "" : k === 1 ? pick([" and his wife", " +1", " with her husband"]) : pick([" +2", ` with ${NUM_EN[k]} guests`]);
  if (r < 0.12) return [`${pick(["Seat", "Put", "Move"])} ${A} ${pick(["at", "to"])} ${ts}${pick([", then ", " and then ", "; after that "])}${pick([`put ${B} at the same table`, `seat ${B} there too`, `move ${B} to that table as well`, `${B} goes there too`])}${tail}`, Cr([St("assign", { guest: A, table: t }), St("assign", { guest: B, table: t })])];
  if (r < 0.22) return [`${pick(["Take", "Get"])} ${A} off ${ts} and ${pick([`seat ${B} there instead`, `put ${B} in ${po} place`, `give the spot to ${B}`])}`, Cr([St("unassign", { guest: A }), St("assign", { guest: B, table: t })])];
  if (r < 0.32) return [`${pick(["Delete", "Remove"])} ${A}${pick([" and", ", then"])} add ${N}${plus} in ${po} place at ${ts}`, Cr([St("deleteGuest", { guest: A }), St("addGuest", { name: N, pax: k + 1, table: t })])];
  if (r < 0.42) { const a = 1 + Math.floor(rnd() * 3), b = a + 1 + Math.floor(rnd() * 3); return [`${pick(["Change", "Bump", "Update"])} ${own(A)} party from ${a} to ${b}${pick([" and mark", ", then make", " and make"])} ${ob} VIP`, Cr([St("setPax", { guest: A, pax: b }), St("setVip", { guest: A })])]; }
  if (r < 0.52) return [`Add ${N}${plus} to ${ts}${pick([", then move ", " and then seat ", "; also put "])}${B} ${pick(["at the same table", "there as well", "at that table too"])}`, Cr([St("addGuest", { name: N, pax: k + 1, table: t }), St("assign", { guest: B, table: t })])];
  if (r < 0.62) return [`${pick(["Don't seat", "Do not put", "No need to put"])} ${A} next to ${B}${pick(["; put ", ", seat ", " - move "])}${ob} at ${ts} instead`, Cr([St("assign", { guest: A, table: t })])];
  if (r < 0.7) return [`Move ${A} to ${ts} and ${B} to ${ts} too`, Cr([St("assign", { guest: A, table: t }), St("assign", { guest: B, table: t })])];
  if (r < 0.78) return [`Add ${N} and ${N2}${pick([", both at ", " and seat both at ", ", the two of them at "])}${ts}`, Cr([St("addGuest", { name: N, pax: 1, table: t }), St("addGuest", { name: N2, pax: 1, table: t })])];
  if (r < 0.86) return [`${pick(["Put", "Add"])} ${N}${plus} on the list ${pick(["and seat", "and then move", ", then put"])} ${B} at ${ts}`, Cr([St("addGuest", { name: N, pax: k + 1 }), St("assign", { guest: B, table: t })])];
  const [q, rd] = chance(0.5) ? questionEn() : [pick([`where did ${A} sit at the last concert`]), Qr("seatAt", { person: A, event: "son konser" })];
  return [pick(["My manager is asking: ", "Quick one before the briefing: ", "For the client, ", "Just double-checking: ", "Before I print the list, ", "Sorry to bother you, ", "Can you look this up - "]) + q + pick(["", ", I need it for the report", ", thanks", ", can't remember", " - urgent"]), rd];
}
// short forms and slang; the reading does not change
const SLANG = [[/\bplease\b/gi, () => pick(["pls", "plz", "please"])], [/\bthanks\b/gi, () => pick(["thx", "ty", "thanks"])], [/\bwith\b/g, () => pick(["w/", "with"])], [/\bwithout\b/g, () => "w/o"],
  [/\b(at) (?=[A-Z]{1,3}\d|t\d|table)/g, () => pick(["@ ", "at "])], [/\band\b/g, () => pick(["n", "&", "and", "and"])], [/\bthem\b/g, () => pick(["em", "them"])], [/\bpeople\b/g, () => pick(["ppl", "people"])],
  [/\byou\b/gi, () => pick(["u", "you"])], [/\b(next) to\b/g, () => pick(["next 2", "next to"])], [/\bthough\b/g, () => "tho"], [/\bgoing to\b/g, () => "gonna"]];
function slangEn(text) {
  for (const [re, f] of SLANG) if (chance(0.6)) text = text.replace(re, () => f());
  if (chance(0.3)) text = pick(["yo ", "hey ", "ok so ", "quick one: ", "k ", "btw "]) + text.replace(/^./, (c) => c.toLowerCase());
  if (chance(0.35)) text += pick([" asap", " pls", " thx", " k?", " rn", " ty"]);
  return chance(0.6) ? text.toLowerCase() : text;
}
// questions the reader must leave alone (the world outside, other jobs), and how-to questions (the help topics answer them)
const OUT_EN = ["What's the weather like in Izmir this weekend", "What time is it in New York", "Book a taxi for the band", "What's 12 times 14", "Translate thank you into German", "Who won the game last night",
  "Set an alarm for 6", "Email the caterer about the menu", "Order more chairs from the supplier", "How much is the dollar today", "What's the capital of Australia", "Call the florist",
  "Is it going to rain in Bursa tomorrow", "Remind me to buy batteries", "How far is the airport", "Write a toast for the bride", "What's the wifi password", "Play some jazz", "Tell me something interesting",
  "What should the dress code be", "Which wine goes with fish", "How long is the drive to Bodrum", "Find me a cheap hotel", "Can you sing", "ur the best lol", "nvm", "ok cool", "brb", "lmao no", "who r u"];
const HOWTO_EN = ["how do I print the guest list", "how can I change the event date", "where do I find the backups", "how do I rotate a table on the plan", "how do I lock part of the room",
  "what does the green dot mean", "how do I switch the app to Turkish", "how can I mark a table out of use", "how do I send an error report", "where can I see the door list",
  "how do I search for a guest", "how do I move an event to another computer", "how do I let the program suggest seats", "what does unassigned mean", "how can I change a table's number",
  "how to upload a new floor plan", "how do i add guests one by one", "how do i start check in on the night"];

// ---- grammar 10 (runR2): the kinds of sentence r08y missed, read AFTER the runR verdict (training/README.md "runR2") ----
// Written from the error TYPES, never from an exam sentence: the guard below rejects any item that equals or shares a
// four-word run (names folded) with any test sentence, en11* (seen) and en12* (the blind exam) included.
const rare = () => `${pick(FIRST10.length ? FIRST10 : FIRST)} ${chance(0.15) && LASTS10.length ? pick(LASTS10) : pick(LAST10.length ? LAST10 : LAST)}`;
const anyName = () => (chance(0.55) ? rare() : person(true));
const numSaid = (n) => (chance(0.5) ? String(n) : NUM_EN[n]);
const gend = () => (chance(0.5) ? ["him", "his", "he"] : ["her", "her", "she"]);
// a stated count: a party / N people / N in total is N; "+N", "with N guests", "and N friends" is N + 1;
// a partner and N children is N + 2 (the guest counts too)
function paxEn10() {
  const [, po] = gend(), N = 1 + Math.floor(rnd() * 8), k = 1 + Math.floor(rnd() * 4), r = rnd();
  const forms = [
    [`is now a party of ${numSaid(N)}`, N], [`is a party of ${numSaid(N)} now`, N], [`will be ${numSaid(N)} people in total`, N], [`- ${numSaid(N)} people total`, N], [`is now ${numSaid(N)} people`, N],
    [`is bringing ${numSaid(k)} guests`, k + 1], [`comes with ${numSaid(k)} others`, k + 1], [`plus ${numSaid(k)}`, k + 1], [`+${k}`, k + 1], [`and ${numSaid(k)} friends are coming`, k + 1],
    [`is coming with ${po} wife and ${numSaid(k)} kids`, k + 2], [`brings ${po} husband and ${numSaid(k)} children`, k + 2], [`is coming with ${po} wife and a kid`, 3], [`is coming alone`, 1], [`, just one person`, 1],
  ];
  const [say, pax] = pick(forms);
  if (r < 0.55) { const g = person(); return [`${g} ${say}`.replace(" ,", ",").replace(" - ", " - "), Cr([St("setPax", { guest: g, pax })])]; }
  const name = anyName(), lead = pick(["Add", "New guest:", "Sign up", "Put on the list:"]);
  const addForms = [[`${lead} ${name}, party of ${numSaid(N)}`, N], [`${lead} ${name}, ${numSaid(N)} people total`, N], [`${lead} ${name} with ${numSaid(k)} guests`, k + 1],
    [`${lead} ${name} plus ${numSaid(k)}`, k + 1], [`${lead} ${name}, ${po} wife and ${numSaid(k)} kids`, k + 2], [`${lead} ${name} +${k}`, k + 1], [`${lead} ${name} on ${po} own`, 1]];
  const [t2, p2] = pick(addForms);
  return [t2, Cr([St("addGuest", { name, pax: p2 })])];
}
// off the LIST is a delete; off the TABLE / seat is an unseat (the record stays)
function listVsTableEn10() {
  const g = person(), [ob, po] = gend();
  if (chance(0.5)) return [pick([`${pick(["Kick", "Boot", "Drop", "Scrap", "Cross", "Strike", "Cut"])} ${g} off the list`, `${pick(["Drop", "Scrap", "Ditch", "Cut"])} ${g} from the guest list`, `${g} is off the list for good`,
    `Take ${g} off the guest list entirely`, `Get rid of ${g} completely`, `${g} cancelled - remove ${ob} from the list`, `${g} won't come, wipe ${ob} from the list`]), Cr([St("deleteGuest", { guest: g })])];
  return [pick([`${pick(["Bump", "Pull", "Yank", "Get", "Take"])} ${g} off ${po} table`, `Take ${g} off the table but keep ${ob}`, `${g} loses ${po} seat but stays on the list`,
    `Get ${g} out of ${po} seat, keep the record`, `Free up the seat ${g} has`, `${g} needs no table for now, keep ${ob} listed`, `Unseat ${g} - don't delete ${ob}`]), Cr([St("unassign", { guest: g })])];
}
// a possessive typed without its apostrophe: "Bilges group" is guest "Bilge" (the s is not part of the name)
function possEn10() {
  const vowelEnd = LAST10.filter((x) => /[aeıioöuü]$/i.test(x)), g = `${pick(FIRST10.length ? FIRST10 : FIRST)} ${pick(vowelEnd.length && chance(0.7) ? vowelEnd : LAST)}`;
  const gs = g + (chance(0.75) ? "s" : "'s"), N = 1 + Math.floor(rnd() * 7), t = table(), ts = tableSaid(t), o = person(), r = rnd();
  if (r < 0.3) return [pick([`${gs} group is now ${numSaid(N)}`, `make ${gs} party ${numSaid(N)}`, `${gs} headcount is ${numSaid(N)}`]), Cr([St("setPax", { guest: g, pax: N })])];
  if (r < 0.5) return [pick([`clear ${gs} seat`, `empty ${gs} chair but keep the record`, `${gs} table spot can go, keep the guest`]), Cr([St("unassign", { guest: g })])];
  if (r < 0.7) { if (o === g) return possEn10(); return [pick([`put ${o} at ${gs} table`, `${o} goes to ${gs} table`]), Cr([St("nextTo", { guest: o, other: g.toLocaleLowerCase("tr") })])]; }
  if (r < 0.85) return [pick([`${gs} seat should be ${ts}`, `change ${gs} table to ${ts}`]), Cr([St("assign", { guest: g, table: t })])];
  return [pick([`flag ${gs} record as VIP`, `${gs} status: VIP`]), Cr([St("setVip", { guest: g })])];
}
// questions naming a table the way people type it (the reading carries the code)
function tableQEn10() {
  const e = eventEn(), t = table(), ts = tableSaid(t), p = anyName(), r = rnd();
  if (r < 0.6) return [pick([`Who was at ${ts} during ${e.say}`, `Who was sitting at ${ts} for ${e.say}`, `Which guests were at ${ts} at ${e.say}`, `${ts} at ${e.say} - who was there`, `List the people at ${ts} for ${e.say}`, `Who did we put at ${ts} for ${e.say}`]),
    Qr("whoAtTable", { event: e.word, table: t })];
  return [pick([`Where'd ${p} sit at ${e.say}`, `Where was ${p} sitting during ${e.say}`, `What table was ${p} given at ${e.say}`, `Where did we seat ${p} for ${e.say}`]), Qr("seatAt", { person: p, event: e.word })];
}
// two or three jobs where the structure is the hard part
function multiEn10() {
  const A = person(), B = person(), t = table(), ts = tableSaid(t), [ob, , sb] = gend(), N1 = anyName(), N2 = anyName(), r = rnd();
  if (A === B || N1 === N2) return multiEn10();
  if (r < 0.3) return [pick([`Don't put ${A} beside ${B} - ${sb} goes to ${ts}`, `${A} must not sit with ${B}; give ${ob} ${ts}`, `Keep ${A} away from ${B} and put ${ob} at ${ts}`, `${A} shouldn't be near ${B}, move ${ob} to ${ts} instead`,
    `Instead of sitting by ${B}, ${A} takes ${ts}`, `Not beside ${B}: ${A} belongs at ${ts}`]), Cr([St("assign", { guest: A, table: t })])];
  if (r < 0.55) return [pick([`${N1} and ${N2} are new, seat the two of them at ${ts}`, `New guests ${N1} and ${N2} - each goes to ${ts}`, `Put new guests ${N1} and ${N2} together at ${ts}`, `Sign up ${N1} and ${N2} for ${ts}`]),
    Cr([St("addGuest", { name: N1, pax: 1, table: t }), St("addGuest", { name: N2, pax: 1, table: t })])];
  if (r < 0.7) return [pick([`${A} and ${B} both go to ${ts}`, `Both ${A} and ${B} -> ${ts}`, `${A} with ${B}, the pair of them at ${ts}`]), Cr([St("assign", { guest: A, table: t }), St("assign", { guest: B, table: t })])];
  const k = pick([0, 0, 1, 2]), plus = k === 0 ? "" : k === 1 ? pick([" plus one", " +1", " with a guest"]) : pick([" +2", ` with ${NUM_EN[k]} guests`]);
  const third = pick([[`make ${B} VIP`, St("setVip", { guest: B })], [`set ${B} to ${numSaid(3)} people`, St("setPax", { guest: B, pax: 3 })], [`unseat ${B}`, St("unassign", { guest: B })], [`delete ${B}`, St("deleteGuest", { guest: B })]]);
  const [o0, o1, o2] = pick([["To start, ", ", next ", ", and lastly "], ["", "; after that ", "; in the end "], ["Begin with ", ", then ", " and to finish "]]);
  return [`${o0}${o0 === "Begin with " ? "seating" : "seat"} ${A} at ${ts}${o1}${pick(["add", "sign up", "bring in"])} ${N1}${plus} ${pick(["at that table", "at the same spot", "at the same table as well"])}${o2}${third[0]}`,
    Cr(fold3([St("assign", { guest: A, table: t }), St("addGuest", { name: N1, pax: k + 1 }), St("assign", { guest: N1, table: t }), third[1]]))];
}
// "add <a new name> to <table>" is an add AND a seat; "move <a guest> to <table>" a seat only
function addToTableEn10() {
  const name = anyName(), g = person(), t = table(), ts = tableSaid(t), [ob] = gend(), r = rnd();
  if (r < 0.55) return [pick([`Add ${name} to ${ts}`, `Add ${name} at ${ts}`, `${name} is new, put ${ob} at ${ts}`, `Register ${name} and seat at ${ts}`, `Enter ${name} and place ${ob} at ${ts}`]), Cr([St("addGuest", { name, pax: 1 }), St("assign", { guest: name, table: t })])];
  if (r < 0.75) return [pick([`Add ${name} to the list`, `Register ${name}`, `Enter ${name} as a guest`]), Cr([St("addGuest", { name, pax: 1 })])];
  return [pick([`Move ${g} to ${ts}`, `Relocate ${g} to ${ts}`, `${g} switches to ${ts}`]), Cr([St("assign", { guest: g, table: t })])];
}
// a name right beside a short form or symbol must still be copied whole
function slangNameEn10() {
  const A = anyName(), B = anyName(), t = table(), ts = tableSaid(t), e = eventEn(), k = 1 + Math.floor(rnd() * 3), r = rnd();
  if (A === B) return slangNameEn10();
  if (r < 0.2) return [`${pick(["where'd", "where did", "whered"])} ${A} sit ${pick(["@", "at"])} ${e.say.replace(/^the /, "")}`, Qr("seatAt", { person: A, event: e.word })];
  if (r < 0.4) return [pick([`put ${A} next 2 ${B}`, `${A} nxt 2 ${B}`, `sit ${A} w/ ${B}`, `${A} by ${B} pls`]), Cr([St("nextTo", { guest: A, other: B.toLocaleLowerCase("tr") })])];
  if (r < 0.55) return [pick([`${A} -> ${ts}`, `${A} @ ${ts} pls`, `mv ${A} 2 ${ts}`]), Cr([St("assign", { guest: A, table: t })])];
  if (r < 0.7) return [pick([`kick ${A} off the list`, `${A} is out, del pls`, `boot ${A} from the list thx`]), Cr([St("deleteGuest", { guest: A })])];
  if (r < 0.85) return [pick([`add ${A} +${k} pls`, `new: ${A} w/ ${k} ppl`, `${A} +${k} new guest`]), Cr([St("addGuest", { name: A, pax: k + 1 })])];
  return [pick([`vip ${A} pls`, `${A} = vip`, `${A} vip now k`]), Cr([St("setVip", { guest: A })])];
}
function weakEn10() {
  const r = rnd();
  return r < 0.13 ? paxEn10() : r < 0.24 ? listVsTableEn10() : r < 0.34 ? possEn10() : r < 0.46 ? tableQEn10() : r < 0.62 ? multiEn10() : r < 0.74 ? addToTableEn10() : slangNameEn10();
}
// a typo IN a key word (the verb, "table", "next", "beside", "concert", "people" …), never in a name
const KEYW = new Set(["sit", "sitting", "seat", "seated", "beside", "next", "table", "concert", "people", "guests", "party", "list", "move", "add", "delete", "where", "which", "during", "group",
  "give", "put", "place", "remove", "friends", "kids", "wife", "husband", "together", "both", "instead", "same", "then", "after", "guest", "unseat", "kick", "show", "gala"]);
function keySlipEn(text, reading) {
  const keep = new Set(), add = (v) => { if (typeof v === "string") for (const w of norm(v).split(" ")) keep.add(w); };
  for (const k of ["person", "event", "phone", "table"]) add(reading[k]);
  for (const st of reading.steps) for (const k of ["guest", "table", "from", "other", "name", "fromTable"]) add(st[k]);
  const words = text.split(" "), idx = words.map((w, i) => [w.toLowerCase().replace(/[^a-z]/g, ""), i]).filter(([w]) => KEYW.has(w) && !keep.has(w));
  if (!idx.length) return text;
  const [, i] = pick(idx), w = words[i], j = 1 + Math.floor(rnd() * Math.max(1, w.length - 2)), r = rnd();
  if (w.length < 3 || !/^[a-zA-Z]+$/.test(w)) return text;
  words[i] = r < 0.25 ? w.slice(0, j) + w.slice(j + 1) : r < 0.45 ? w.slice(0, j) + w[j] + w.slice(j) : r < 0.75 ? w.slice(0, j) + (w[j + 1] || "") + w[j] + w.slice(j + 2) : w.slice(0, j) + (NEAR_EN[w[j].toLowerCase()] || w[j]) + w.slice(j + 1);
  return words.join(" ");
}
// Turkish: a full new name right before an artist's event (the name must not take the event word), and new names with companions
function weakTr10() {
  const name = `${pick(FIRST10.length ? FIRST10 : FIRST)} ${pick(LAST10.length ? LAST10 : LAST)}`;
  if (chance(0.6)) {
    const a = pick(ARTISTS), e = chance(0.5) ? { base: `${a} ${pick(KINDS)}`, word: "" } : { base: a, word: "" };
    e.word = e.base.toLocaleLowerCase("tr");
    const ph = chance(0.35) ? PHONES() : null, who = ph ? `${ph} ${pick(["numaralı", "telefonlu"])} ${name}` : name;
    return [pick([`${who} ${evCase(e, "loc")} nerede oturdu`, `${who} ${evCase(e, "loc")} hangi masadaydı`, `${who} ${evCase(e, "loc")} nerede oturuyordu`, `${who} ${evCase(e, "dat")} geldi mi`]), Qr("seatAt", { person: name, phone: ph, event: e.word })];
  }
  const [c, cp] = pick(COMP8);
  return [pick([`${name} ${c} listeye ekle`, `${name} ${c} gelecek, listeye ekle`, `yeni misafir ${name}, ${c}`]), Cr([St("addGuest", { name, pax: cp })])];
}

// ---- surface: fillers, case, no Turkish letters -----------------------------------------------
const DETR = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" };
const detr = (s) => s.replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => DETR[c]);
function finish(text, reading, isQ) {
  const pre = pick(FILL_PRE), post = isQ ? pick(Q_POST) : pick(FILL_POST);
  if (/[?!.]$/.test(text) && post) text = text.replace(/[?!.]$/, "");
  text = pre + text + post;
  const low = chance(0.25), tr = chance(0.25);
  const fix = (v) => (typeof v !== "string" ? v : (low ? v.toLocaleLowerCase("tr") : v));
  if (low) text = text.toLocaleLowerCase("tr").replace(/vıp/g, "vip");
  if (tr) text = detr(text);
  const map = (v, k) => (typeof v !== "string" || ["table", "fromTable", "op", "kind", "intent", "phone"].includes(k) ? v : (tr ? detr(fix(v)) : fix(v)));
  const r = JSON.parse(JSON.stringify(reading));
  for (const k of ["person", "event"]) r[k] = map(r[k], k);
  r.steps = r.steps.map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, map(v, k)])));
  if (low && r.table) r.table = r.table; // tables stay upper-case in the reading
  text = text.replace(/^./, (c) => (low ? c : c.toLocaleUpperCase("tr")));
  return [text, r];
}

// ---- checks against the tests ---------------------------------------------------------
const readLines = (f) => fs.readFileSync(path.join(repo, "training/assistant", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const fx = JSON.parse(fs.readFileSync(path.join(repo, "training/assistant/fixture.json"), "utf8"));
const ALLTESTS = fs.readdirSync(path.join(repo, "training/assistant")).filter((f) => f.endsWith(".jsonl")).sort();   // grammar 8: every test file, the runQ exam included
const norm = (s) => R && globalThis.MeritAssistantTools.fold(String(s)).replace(/[^a-z0-9]+/g, " ").trim();
const testTexts = new Set([...readLines("questions.jsonl").map((q) => q.q), ...readLines("commands.jsonl").map((c) => c.text), ...readLines("variants.jsonl").map((v) => v.text),
  ...readLines("deep.jsonl").map((d) => d.text), ...readLines("fresh.jsonl").map((d) => d.text), ...["fresh2.jsonl", "fresh3.jsonl", ...(G4 ? ["fresh4.jsonl", "fresh5.jsonl", "typo5.jsonl"] : []), ...(G5 ? ["fresh6.jsonl", "typo6.jsonl"] : []), ...(G6 ? ["fresh7.jsonl", "typo7.jsonl", "fresh8.jsonl", "typo8.jsonl", "en7.jsonl", "entypo7.jsonl", "en8.jsonl", "entypo8.jsonl", "fresh9.jsonl", "typo9.jsonl", "en9.jsonl", "entypo9.jsonl"] : [])].filter((f) => fs.existsSync(path.join(repo, "training/assistant", f))).flatMap((f) => readLines(f).map((d) => d.text)), ...(G8 ? ALLTESTS.flatMap((f) => readLines(f).map((d) => d.text ?? d.q)) : []), ...R.EXAMPLES.map((e) => e[0])].map(norm));
const banned = new Set();
for (const e of fx.events) { for (const g of e.guests) g.name.split(/\s+/).forEach((w) => banned.add(norm(w))); e.name.split(/\s+/).filter((w) => w.length > 3 && !/konser|gala/i.test(w)).forEach((w) => banned.add(norm(w))); e.venue.split(/\s+/).forEach((w) => banned.add(norm(w))); }
["burak", "sahin", "selin", "ak", "deniz", "yurt", "okan", "er", "elif", "sen", "can", "ozturk", "zeynep", "arslan", "mehmet", "kaya", "ahmet", "yilmaz", "ayse", "demir", "tarkan", "sezen", "aksu", "mabel", "matiz", "harbiye", "zorlu", "yilbasi"].forEach((w) => banned.add(w));
if (G4) ["burcu", "tan", "riza", "oktay"].forEach((w) => banned.add(w));
if (G5) ["selim", "cetin", "hulya", "keskin", "kadir", "coskun", "oya", "ergin"].forEach((w) => banned.add(w));
// grammar 6: every name in the newer tests is barred, and leaves the pools (they were written from them)
if (G6) {
  for (const f of (G8 ? ALLTESTS : ["fresh7.jsonl", "fresh8.jsonl", "en7.jsonl", "en8.jsonl", "fresh9.jsonl", "en9.jsonl"]).filter((f) => fs.existsSync(path.join(repo, "training/assistant", f)))) for (const d of readLines(f)) {
    if (!d.gold) continue;
    for (const st of d.gold.steps || []) for (const v of [st.guest, st.name, st.other]) if (v) norm(v).split(" ").forEach((w) => banned.add(w));
    if (d.gold.person) norm(d.gold.person).split(" ").forEach((w) => banned.add(w));
  }
  for (const pool of [FIRST, LAST, LAST5, LAST7, ARTISTS, ...(G10 ? [FIRST10, LAST10, LASTS10] : [])]) for (let i = pool.length - 1; i >= 0; i--) if (norm(pool[i]).split(" ").some((w) => banned.has(w))) pool.splice(i, 1);
}
// grammar 4 only: no sentence may share a four-word run (names folded to one token) with any
// test sentence — the tests stay tests of understanding, not of a copied frame
const NAMEW = new Set([...banned, ...FIRST.map(norm), ...LAST.map(norm)]);
const frame = (t) => norm(t).split(" ").map((w) => (NAMEW.has(w) ? "N" : w));
const grams = (ws) => ws.slice(0, -3).map((_, i) => ws.slice(i, i + 4).join(" "));
const testGrams = G4 ? new Set([...testTexts].flatMap((t) => grams(t.split(" ").map((w) => (NAMEW.has(w) ? "N" : w))))) : new Set();
for (const pool of [FIRST, LAST, ARTISTS, VENUES]) for (const x of pool) for (const w of norm(x).split(" ")) if (banned.has(w)) throw new Error(`pool word "${x}" is a test word`);

// grammar 4: typed the way the owner types (2026-11-01: "imla kurallarına dikkat etmem … nokta virgül
// yada i yerine ı yazamayabilirim … kelime yanlış harfle yazarım"): no apostrophes or punctuation,
// i/ı mixed up, a letter dropped, doubled, swapped or hit on the next key — in ordinary words only.
// Names, events, tables and numbers keep their letters (the reading copies them as written).
const NEAR = { a: "s", e: "r", i: "ı", ı: "i", o: "p", u: "y", r: "t", t: "y", n: "m", m: "n", k: "l", l: "k", s: "d", d: "s", y: "u", g: "ğ", c: "ç", z: "x" };
function careless(text, reading) {
  const keep = new Set();
  const add = (v) => { if (typeof v === "string") for (const w of norm(v).split(" ")) keep.add(w); };
  for (const k of ["person", "event", "phone", "table"]) add(reading[k]);
  for (const st of reading.steps) for (const k of ["guest", "table", "from", "other", "name", "fromTable"]) add(st[k]);
  if (chance(0.7)) text = text.replace(/[’']/g, "");
  if (chance(0.6)) text = text.replace(/[?!.,]/g, "").replace(/\s+/g, " ").trim();
  const words = text.split(" "), slips = 1 + (chance(0.35) ? 1 : 0);
  for (let k = 0, tries = 0; k < slips && tries < 12; tries++) {
    const i = Math.floor(rnd() * words.length), w = words[i];
    if (w.length < 4 || /\d/.test(w) || keep.has(norm(w)) || [...keep].some((x) => x && norm(w).startsWith(x))) continue;
    const j = 1 + Math.floor(rnd() * (w.length - 2)), r = rnd();
    words[i] = r < 0.25 ? w.slice(0, j) + w.slice(j + 1)
      : r < 0.45 ? w.slice(0, j) + w[j] + w.slice(j)
      : r < 0.65 ? w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2)
      : r < 0.85 ? w.slice(0, j) + (NEAR[w[j]] || w[j]) + w.slice(j + 1)
      : w.replace(/ı/g, "i").replace(/(?<=\S)i/g, chance(0.5) ? "ı" : "i");
    k++;
  }
  return words.join(" ");
}


// grammar 8: English typed carelessly — QWERTY neighbours, swapped / dropped / doubled letters,
// apostrophes dropped ("Kaya's" -> "Kayas", the guest stays "Kaya"); names, tables and numbers keep their letters
const NEAR_EN = { a: "s", s: "a", e: "r", r: "e", t: "r", o: "i", i: "o", n: "m", m: "n", h: "j", l: "k", d: "f", c: "v", y: "t", u: "y", b: "v", w: "e", g: "h", p: "o", k: "l" };
function carelessEn(text, reading) {
  const keep = new Set();
  const add = (v) => { if (typeof v === "string") for (const w of norm(v).split(" ")) keep.add(w); };
  for (const k of ["person", "event", "phone", "table"]) add(reading[k]);
  for (const st of reading.steps) for (const k of ["guest", "table", "from", "other", "name", "fromTable"]) add(st[k]);
  if (chance(0.8)) text = text.replace(/[’']/g, "");
  if (chance(0.6)) text = text.replace(/[?!.,;:]/g, "").replace(/\s+/g, " ").trim();
  const words = text.split(" "), slips = 1 + (chance(0.4) ? 1 : 0);
  for (let k = 0, tries = 0; k < slips && tries < 12; tries++) {
    const i = Math.floor(rnd() * words.length), w = words[i];
    if (w.length < 3 || /\d/.test(w) || !/^[a-zA-Z]+$/.test(w) || keep.has(norm(w)) || [...keep].some((x) => x && norm(w).startsWith(x))) continue;
    const j = 1 + Math.floor(rnd() * (w.length - 2)), r = rnd();
    words[i] = r < 0.25 ? w.slice(0, j) + w.slice(j + 1) : r < 0.45 ? w.slice(0, j) + w[j] + w.slice(j) : r < 0.7 ? w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2) : w.slice(0, j) + (NEAR_EN[w[j].toLowerCase()] || w[j]) + w.slice(j + 1);
    k++;
  }
  return words.join(" ");
}

// ---- write ------------------------------------------------------------------------
const out = arg("out"), N = Number(arg("n", 2400));
fs.mkdirSync(out, { recursive: true });
const shortPrompt = arg("prompt", "full") === "short";
const shots = shortPrompt ? null : R.EXAMPLES.map(([u, a]) => [u, JSON.stringify(a)]);
const seen = new Set(), counts = {};
let n = 0, skipped = 0;
const f = fs.openSync(path.join(out, "items.jsonl"), "w");
const G8guard = G8 ? await (await import(pathToFileURL(path.join(repo, "training/check_g8_guard.mjs")).href)).guard() : null;   // grammar 8: the runQ guard, applied as items are made
const ok = (text, reading) => { const key = norm(text); return !((G8guard && G8guard.f8(text, reading)) || testTexts.has(key) || seen.has(key) || grams(frame(text)).some((g) => testGrams.has(g)) || key.split(" ").some((w) => banned.has(w)) || !R.valid(reading)); };
while (n < N) {
  // grammar 10: 40 % from the kinds r08y missed (85 % English, 15 % Turkish), surfaced every way the exam's kinds are typed
  if (G10 && chance(0.4)) {
    let text, reading, fam;
    if (chance(0.15)) { [text, reading] = weakTr10(); [text, reading] = finish(text, reading, reading.kind === "question"); if (chance(0.5)) text = careless(text, reading); fam = "synth-f8-weak-tr"; }
    else {
      [text, reading] = surfaceEn(...weakEn10()); text = text.replace(/i\u0307/g, "i");
      if (chance(0.45)) { text = detr(text); const d = (v) => (typeof v === "string" ? detr(v) : v); reading = { ...reading, person: d(reading.person), event: d(reading.event), steps: reading.steps.map((s) => ({ ...s, guest: d(s.guest), name: d(s.name), other: d(s.other), from: d(s.from) })) }; }
      const s = rnd();
      if (s < 0.3) text = keySlipEn(text, reading); else if (s < 0.5) text = slangEn(text); else if (s < 0.75) text = carelessEn(text, reading);
      if (chance(0.15)) text = keySlipEn(text, reading);
      fam = "synth-f8-weak-en";
    }
    if (!ok(text, reading)) { skipped++; continue; }
    seen.add(norm(text)); counts.weak = (counts.weak || 0) + 1; counts[fam] = (counts[fam] || 0) + 1; counts[reading.kind] = (counts[reading.kind] || 0) + 1;
    const sub = reading.kind === "question" ? reading.intent : reading.kind === "command" ? reading.steps.map((s) => s.op).join("+") : "unknown";
    fs.writeSync(f, JSON.stringify({ task: "F8", sub, q: text, system: shortPrompt ? R.SYSTEM_SHORT : R.SYSTEM, ...(shots ? { shots } : {}), truth: JSON.stringify(reading), level: reading.steps.length > 1 || text.length > 70 ? 3 : 2,
      family: fam, seed: Number(arg("seed", 71)), split: "train", image: null }) + "\n");
    n++; continue;
  }
  // grammar 8: 30 % multi-step / deep (a quarter of them English)
  if (G8 && chance(0.3)) {
    let text, reading;
    if (chance(G9 ? 0.5 : 0.25)) { [text, reading] = surfaceEn(...(G9 && chance(0.55) ? deepEn9() : deepEn())); if (G9 && chance(0.25)) text = slangEn(text); else if (chance(0.6)) text = carelessEn(text, reading); }
    else { [text, reading] = chance(0.7) ? deepCommand() : deepQuestion(); [text, reading] = finish(text, reading, reading.kind === "question"); if (chance(0.5)) text = careless(text, reading); }
    if (!ok(text, reading)) { skipped++; continue; }
    seen.add(norm(text)); counts.deep = (counts.deep || 0) + 1; counts[reading.kind] = (counts[reading.kind] || 0) + 1;
    const sub = reading.kind === "question" ? reading.intent : reading.kind === "command" ? reading.steps.map((s) => s.op).join("+") : "unknown";
    fs.writeSync(f, JSON.stringify({ task: "F8", sub, q: text, system: shortPrompt ? R.SYSTEM_SHORT : R.SYSTEM, ...(shots ? { shots } : {}), truth: JSON.stringify(reading), level: 3,
      family: "synth-f8-deep", seed: Number(arg("seed", 71)), split: "train", image: null }) + "\n");
    n++; continue;
  }
  const r = rnd();
  if (G6 && chance(Number(arg("english", G10 ? "0.4" : G9 ? "0.55" : G7 ? "0.4" : "0.33")))) {
    let [text, reading] = english();
    if (G8 && chance(G9 ? 0.45 : 0.4)) { text = detr(text); const d = (v) => (typeof v === "string" ? detr(v) : v); reading = { ...reading, person: d(reading.person), event: d(reading.event), steps: reading.steps.map((s) => ({ ...s, guest: d(s.guest), name: d(s.name), other: d(s.other), from: d(s.from) })) }; }
    if (G9 && chance(0.3)) text = slangEn(text);
    else if (chance(G7 ? 0.6 : 0.45)) text = G8 ? carelessEn(text, reading) : careless(text, reading);
    const key = norm(text);
    if ((G8guard && G8guard.f8(text, reading)) || testTexts.has(key) || seen.has(key) || grams(frame(text)).some((g) => testGrams.has(g)) || key.split(" ").some((w) => banned.has(w)) || !R.valid(reading)) { skipped++; continue; }
    seen.add(key); counts.english = (counts.english || 0) + 1; counts[reading.kind] = (counts[reading.kind] || 0) + 1;
    const sub = reading.kind === "question" ? reading.intent : reading.kind === "command" ? reading.steps.map((s) => s.op).join("+") : "unknown";
    fs.writeSync(f, JSON.stringify({ task: "F8", sub, q: text, system: shortPrompt ? R.SYSTEM_SHORT : R.SYSTEM, ...(shots ? { shots } : {}), truth: JSON.stringify(reading), level: reading.steps.length > 1 || text.length > 70 ? 3 : 2,
      family: "synth-f8-en", seed: Number(arg("seed", 71)), split: "train", image: null }) + "\n");
    n++; continue;
  }
  let [text, reading] = r < 0.42 ? question() : r < (G2 ? 0.89 : 0.93) ? command() : [G4 && chance(0.3) ? pick(SMALL4) : G3 && chance(0.4) ? pick(SMALL3) : G2 && chance(0.5) ? pick(SMALL2) : pick(SMALL), Ur()];
  [text, reading] = finish(text, reading, reading.kind === "question");
  if (G4 && chance(G8 ? 0.7 : G7 ? 0.6 : 0.45)) text = careless(text, reading);
  const key = norm(text);
  if ((G8guard && G8guard.f8(text, reading)) || testTexts.has(key) || seen.has(key) || (G4 && grams(frame(text)).some((g) => testGrams.has(g))) || key.split(" ").some((w) => banned.has(w)) || !R.valid(reading)) { skipped++; continue; }
  seen.add(key);
  const sub = reading.kind === "question" ? reading.intent : reading.kind === "command" ? reading.steps.map((s) => s.op).join("+") : "unknown";
  counts[reading.kind] = (counts[reading.kind] || 0) + 1;
  fs.writeSync(f, JSON.stringify({ task: "F8", sub, q: text, system: shortPrompt ? R.SYSTEM_SHORT : R.SYSTEM, ...(shots ? { shots } : {}), truth: JSON.stringify(reading), level: reading.steps.length > 1 || text.length > 70 ? 3 : 2,
    family: "synth-f8", seed: Number(arg("seed", 71)), split: "train", image: null }) + "\n");
  n++;
}
fs.closeSync(f);
console.log(n, "sentences", JSON.stringify(counts), "skipped", skipped);
