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
const G6 = arg("grammar", "1") === "6";   // runB7f: grammar 5 + English sentences (owner 2026-11-02: the program is fully English too)
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
const LAST5 = ["Bilgin", "Ergün", "Uzun", "Erkin", "Sezgin", "Durgun", "Gürsoy", "Tetik", "Kalkan", "Ersin", "Öztekin", "Bütün"];
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
const person = (full = chance(0.75)) => (full ? `${pick(FIRST)} ${G5 && chance(0.3) ? pick(LAST5) : pick(LAST)}` : pick(FIRST));
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
  return [text, Cr(steps)];
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
  while (parts.length < k) { const [t, s] = stepEn(), ss = Array.isArray(s) ? s : [s]; if (steps.length + ss.length > 3) break; parts.push(t); steps.push(...ss); }
  let text = parts[0]; for (let i = 1; i < parts.length; i++) text += pick([" and ", ", then ", "; also "]) + parts[i].replace(/^./, (c) => c.toLowerCase());
  return [text, Cr(steps)];
}
function english() {
  const r = rnd();
  const [text, reading] = r < 0.42 ? questionEn() : r < 0.9 ? commandEn() : [pick(SMALL_EN), Ur()];
  const low = chance(0.3), q = reading.kind === "question";
  let tx = text + (q ? pick(["?", "?", "", " please?"]) : pick(["", "", ".", " please", " thanks"]));
  const r2 = JSON.parse(JSON.stringify(reading));
  if (low) { tx = tx.toLowerCase(); const lc = (v) => (typeof v === "string" ? v.toLocaleLowerCase("tr") : v); r2.person = lc(r2.person); r2.steps = r2.steps.map((s) => ({ ...s, guest: lc(s.guest), name: lc(s.name) })); }
  return [tx, r2];
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
const norm = (s) => R && globalThis.MeritAssistantTools.fold(String(s)).replace(/[^a-z0-9]+/g, " ").trim();
const testTexts = new Set([...readLines("questions.jsonl").map((q) => q.q), ...readLines("commands.jsonl").map((c) => c.text), ...readLines("variants.jsonl").map((v) => v.text),
  ...readLines("deep.jsonl").map((d) => d.text), ...readLines("fresh.jsonl").map((d) => d.text), ...["fresh2.jsonl", "fresh3.jsonl", ...(G4 ? ["fresh4.jsonl", "fresh5.jsonl", "typo5.jsonl"] : []), ...(G5 ? ["fresh6.jsonl", "typo6.jsonl"] : []), ...(G6 ? ["fresh7.jsonl", "typo7.jsonl", "fresh8.jsonl", "typo8.jsonl", "en7.jsonl", "entypo7.jsonl", "en8.jsonl", "entypo8.jsonl"] : [])].filter((f) => fs.existsSync(path.join(repo, "training/assistant", f))).flatMap((f) => readLines(f).map((d) => d.text)), ...R.EXAMPLES.map((e) => e[0])].map(norm));
const banned = new Set();
for (const e of fx.events) { for (const g of e.guests) g.name.split(/\s+/).forEach((w) => banned.add(norm(w))); e.name.split(/\s+/).filter((w) => w.length > 3 && !/konser|gala/i.test(w)).forEach((w) => banned.add(norm(w))); e.venue.split(/\s+/).forEach((w) => banned.add(norm(w))); }
["burak", "sahin", "selin", "ak", "deniz", "yurt", "okan", "er", "elif", "sen", "can", "ozturk", "zeynep", "arslan", "mehmet", "kaya", "ahmet", "yilmaz", "ayse", "demir", "tarkan", "sezen", "aksu", "mabel", "matiz", "harbiye", "zorlu", "yilbasi"].forEach((w) => banned.add(w));
if (G4) ["burcu", "tan", "riza", "oktay"].forEach((w) => banned.add(w));
if (G5) ["selim", "cetin", "hulya", "keskin", "kadir", "coskun", "oya", "ergin"].forEach((w) => banned.add(w));
// grammar 6: every name in the newer tests is barred, and leaves the pools (they were written from them)
if (G6) {
  for (const f of ["fresh7.jsonl", "fresh8.jsonl", "en7.jsonl", "en8.jsonl"].filter((f) => fs.existsSync(path.join(repo, "training/assistant", f)))) for (const d of readLines(f)) {
    for (const st of d.gold.steps || []) for (const v of [st.guest, st.name, st.other]) if (v) norm(v).split(" ").forEach((w) => banned.add(w));
    if (d.gold.person) norm(d.gold.person).split(" ").forEach((w) => banned.add(w));
  }
  for (const pool of [FIRST, LAST, LAST5, ARTISTS]) for (let i = pool.length - 1; i >= 0; i--) if (norm(pool[i]).split(" ").some((w) => banned.has(w))) pool.splice(i, 1);
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

// ---- write ------------------------------------------------------------------------
const out = arg("out"), N = Number(arg("n", 2400));
fs.mkdirSync(out, { recursive: true });
const shortPrompt = arg("prompt", "full") === "short";
const shots = shortPrompt ? null : R.EXAMPLES.map(([u, a]) => [u, JSON.stringify(a)]);
const seen = new Set(), counts = {};
let n = 0, skipped = 0;
const f = fs.openSync(path.join(out, "items.jsonl"), "w");
while (n < N) {
  const r = rnd();
  if (G6 && chance(Number(arg("english", "0.33")))) {
    let [text, reading] = english();
    if (chance(0.45)) text = careless(text, reading);
    const key = norm(text);
    if (testTexts.has(key) || seen.has(key) || grams(frame(text)).some((g) => testGrams.has(g)) || key.split(" ").some((w) => banned.has(w)) || !R.valid(reading)) { skipped++; continue; }
    seen.add(key); counts.english = (counts.english || 0) + 1; counts[reading.kind] = (counts[reading.kind] || 0) + 1;
    const sub = reading.kind === "question" ? reading.intent : reading.kind === "command" ? reading.steps.map((s) => s.op).join("+") : "unknown";
    fs.writeSync(f, JSON.stringify({ task: "F8", sub, q: text, system: shortPrompt ? R.SYSTEM_SHORT : R.SYSTEM, ...(shots ? { shots } : {}), truth: JSON.stringify(reading), level: reading.steps.length > 1 || text.length > 70 ? 3 : 2,
      family: "synth-f8-en", seed: Number(arg("seed", 71)), split: "train", image: null }) + "\n");
    n++; continue;
  }
  let [text, reading] = r < 0.42 ? question() : r < (G2 ? 0.89 : 0.93) ? command() : [G4 && chance(0.3) ? pick(SMALL4) : G3 && chance(0.4) ? pick(SMALL3) : G2 && chance(0.5) ? pick(SMALL2) : pick(SMALL), Ur()];
  [text, reading] = finish(text, reading, reading.kind === "question");
  if (G4 && chance(0.45)) text = careless(text, reading);
  const key = norm(text);
  if (testTexts.has(key) || seen.has(key) || (G4 && grams(frame(text)).some((g) => testGrams.has(g))) || key.split(" ").some((w) => banned.has(w)) || !R.valid(reading)) { skipped++; continue; }
  seen.add(key);
  const sub = reading.kind === "question" ? reading.intent : reading.kind === "command" ? reading.steps.map((s) => s.op).join("+") : "unknown";
  counts[reading.kind] = (counts[reading.kind] || 0) + 1;
  fs.writeSync(f, JSON.stringify({ task: "F8", sub, q: text, system: shortPrompt ? R.SYSTEM_SHORT : R.SYSTEM, ...(shots ? { shots } : {}), truth: JSON.stringify(reading), level: reading.steps.length > 1 || text.length > 70 ? 3 : 2,
    family: "synth-f8", seed: Number(arg("seed", 71)), split: "train", image: null }) + "\n");
  n++;
}
fs.closeSync(f);
console.log(n, "sentences", JSON.stringify(counts), "skipped", skipped);
