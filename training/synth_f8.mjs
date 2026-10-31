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
//   node training/synth_f8.mjs --out DIR [--n 2400 --seed 71]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of ["src/assistant-tools.js", "src/assistant-reading.js"]) await import(pathToFileURL(path.join(repo, f)).href);
const R = globalThis.MeritAssistantReading;
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };

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
const ARTISTS = ["Kenan Doğulu", "Sertab Erener", "Teoman", "Gripin", "Manuş Baba", "Sıla", "Hadise", "Gökhan Türkmen", "Model", "Yüksek Sadakat", "Ezhel", "Melek Mosso", "Göksel Demirpençe", "Cem Adrian",
  "Athena", "Mor ve Ötesi", "Yaşar", "Feridun Düzağaç", "Pinhani", "Kalben"];
const KINDS = ["konseri", "gecesi", "galası", "gösterisi"];
const VENUES = ["Cemil Topuzlu", "Bostancı", "Volkswagen Arena", "Lütfi Kırdar", "Maximum Uniq", "Küçükçiftlik", "Jolly Joker", "Congresium", "Hilton", "Swissotel"];
const OCC = ["bahar galası", "şirket yemeği", "mezuniyet balosu", "lansman", "iftar yemeği", "nişan", "düğün", "kurumsal gece", "ödül töreni", "bayi toplantısı", "cumhuriyet balosu", "sevgililer günü gecesi"];
const MONTHS = ["ocak", "şubat", "nisan", "mayıs", "temmuz", "ağustos", "ekim", "kasım", "aralık"]; // mart, haziran, eylül are in the tests
const TABLE_PFX = ["T", "T", "T", "VIP", "B"];
const PHONES = () => `05${pick(["32", "33", "35", "36", "41", "42", "52", "53", "55"])} ${100 + Math.floor(rnd() * 900)} ${10 + Math.floor(rnd() * 90)} ${10 + Math.floor(rnd() * 90)}`;
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
const person = (full = chance(0.75)) => (full ? `${pick(FIRST)} ${pick(LAST)}` : pick(FIRST));
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
function question() {
  const p = person(), e = eventRef(), pick1 = rnd();
  if (pick1 < 0.3) {   // seatAt
    const ph = chance(0.12) ? PHONES() : null, who = ph ? `${ph} ${pick(["numaralı", "telefonlu"])} ${p}` : p;
    if (e.venue && chance(0.6)) return [pick([`${who} ${sfx(e.base, "loc").replace(/'?(da|de|ta|te)$/, (m) => m)}ki konserlerde nerelerde oturdu`, `${sfx(p, "gen")} ${e.base} konserlerindeki masaları hangileriydi`]), Qr("seatAt", { person: p, phone: null, event: evRead(e), many: true })];
    const t = pick([`${who} ${evCase(e, "loc")} nerede oturdu`, `${who} ${evCase(e, "loc")} hangi masadaydı`, `${who} ${evCase(e, "loc")} kaçıncı masada oturuyordu`, `${sfx(p, "gen")} ${evCase(e, "loc")}ki yeri neresiydi`,
      `${who} ${evCase(e, "dat")} geldi mi`, `${who} ${evCase(e, "dat")} kaç kişiyle geldi`, `${evCase(e, "loc")} ${who} nerede oturuyordu`, `${who} ${evCase(e, "loc")} hangi koltuktaydı`, `${who} ${evCase(e, "loc")} nerede oturacak`]);
    return [t, Qr("seatAt", { person: p, phone: t.includes(who) ? ph : null, event: evRead(e) })];
  }
  if (pick1 < 0.42) return [pick([`${p} kaç etkinliğimize geldi`, `${p} hangi konserlere katıldı`, `${p} bize kaç kere geldi`, `${p} şimdiye kadar kaç konserimizde bulundu`, `${sfx(p, "gen")} geldiği etkinlikler hangileri`]), Qr("attended", { person: p })];
  if (pick1 < 0.5) return [pick([`${p} hep aynı masada mı oturdu`, `${sfx(p, "gen")} masası her seferinde aynı mıydı`, `${p} her konserde aynı yerde mi oturuyor`]), Qr("sameTable", { person: p })];
  if (pick1 < 0.58) return [pick([`${p} daha önce VIP masada oturdu mu`, `${p} hiç VIP'te ağırlandı mı`, `${sfx(p, "acc")} daha önce VIP masaya oturtmuş muyduk`]), Qr("vipBefore", { person: p })];
  if (pick1 < 0.64) return [pick(["En çok kişi hangi konserde vardı", "en kalabalık etkinliğimiz hangisiydi", "Hangi etkinliğe en çok misafir geldi", "en çok katılım olan konser hangisi"]), Qr("mostPeople")];
  if (pick1 < 0.72) return [pick([`${evCase(e, "dat")} kaç kişi geldi`, `${evCase(e, "loc")} kaç misafir vardı`, `${evCase(e, "dat")} toplam kaç kişi katıldı`]), Qr("eventCount", { event: evRead(e) })];
  if (pick1 < 0.8) return [pick([`${evCase(e, "loc")} masası olmayanlar kim`, `${evCase(e, "loc")} kimler henüz oturtulmadı`, `${evCase(e, "loc")} yeri belli olmayan misafirler kimler`]), Qr("unassigned", { event: evRead(e) })];
  if (pick1 < 0.88) return [pick([`${evCase(e, "dat")} kimler gelmedi`, `${evCase(e, "loc")} gelmeyenler kimdi`, `${evCase(e, "loc")} yeri olup gelmeyenler kimler`]), Qr("noShow", { event: evRead(e) })];
  if (pick1 < 0.95) { const t = table(); return [pick([`${evCase(e, "loc")} ${tsfx(t, "loc")} kim var`, `${tsfx(t, "loc")} ${evCase(e, "loc")} kimler oturdu`, `${evCase(e, "loc")} ${t} masasında kim oturuyor`]), Qr("whoAtTable", { event: evRead(e), table: t })]; }
  const m = pick(MONTHS), y = chance(0.3) ? pick(["2025 ", "2024 ", "geçen yıl "]) : "";
  return [pick([`${y}${m}${SUF.loc(m)} hangi etkinlik vardı`, `${y}${m} ayında ne yaptık`, `${y}${m}${SUF.loc(m)} hangi konserimiz vardı`]), Qr("whichEvent", { event: (y + m).replace("geçen yıl", "gecen yil") })];
}

// ---- commands (one step each; joined below) ------------------------------------------------
function step() {
  const g = person(), t = table(), r = rnd();
  if (r < 0.2) return [pick([`${sfx(g, "acc")} ${tsfx(t, "dat")} oturt`, `${sfx(g, "acc")} ${tsfx(t, "dat")} yerleştir`, `${sfx(g, "acc")} ${tsfx(t, "dat")} al`, `${sfx(g, "acc")} ${tsfx(t, "dat")} koy`, `${sfx(g, "acc")} ${tsfx(t, "dat")} geçir`,
    `${sfx(g, "acc")} ${tsfx(t, "dat")} taşı`, `${g} ${tsfx(t, "dat")} geçsin`, `${g} ${tsfx(t, "loc")} otursun`, `${tsfx(t, "dat")} ${sfx(g, "acc")} oturt`, `${sfx(g, "gen")} masası ${t} olsun`]), St("assign", { guest: g, table: t })];
  if (r < 0.3) { const e = eventRef(); if (e.venue || e.month) return step(); return [pick([`${sfx(g, "acc")} ${evCase(e, "loc")}ki yerine oturt`, `${sfx(g, "acc")} ${evCase(e, "loc")}ki masasına al`, `${g} ${evCase(e, "loc")} nerede oturduysa oraya koy`, `${sfx(g, "dat")} ${evCase(e, "loc")}ki yerini ver`]), St("copySeat", { guest: g, from: evRead(e) })]; }
  if (r < 0.38) { const o = person(); return [pick([`${sfx(g, "acc")} ${sfx(o, "gen")} yanına oturt`, `${g}, ${sfx(o, "gen")} yanında otursun`, `${sfx(g, "acc")} ${sfx(o, "gen")} yanına al`]), St("nextTo", { guest: g, other: o.toLocaleLowerCase("tr") })]; }
  if (r < 0.46) { const f = table(); return [pick([`${tsfx(f, "loc")}ki herkesi ${tsfx(t, "dat")} taşı`, `${tsfx(f, "loc")}kileri ${tsfx(t, "dat")} geçir`, `${sfx(f, "acc", spoken(f))} komple ${tsfx(t, "dat")} al`]), St("moveTable", { table: t, fromTable: f })]; }
  if (r < 0.56) return [pick([`${sfx(g, "acc")} masadan kaldır`, `${sfx(g, "gen")} masasını boşalt`, `${sfx(g, "acc")} masasından al ama silme`, `${g} masasız kalsın`, `${g} masadan kalksın`]), St("unassign", { guest: g })];
  if (r < 0.66) return [pick([`${sfx(g, "acc")} sil`, `${sfx(g, "acc")} listeden çıkar`, `${g} gelmeyecek, listeden sil`, `${sfx(g, "acc")} davetlilerden çıkar`, `${sfx(g, "acc")} listeden kaldır`]), St("deleteGuest", { guest: g })];
  if (r < 0.76) { const n = 1 + Math.floor(rnd() * 5); return [pick([`${g} +${n} olsun`, `${sfx(g, "gen")} kişi sayısını ${n + 1} yap`, `${g} ${n + 1} kişi gelecek`, `${sfx(g, "gen")} grubu ${n + 1} kişi olsun`]), St("setPax", { guest: g, pax: n + 1 })]; }
  if (r < 0.84) return [pick([`${sfx(g, "acc")} VIP yap`, `${g} VIP olsun`, `${sfx(g, "acc")} VIP olarak işaretle`]), St("setVip", { guest: g })];
  const n = pick([0, 0, 1, 1, 2, 3]), extra = n === 0 ? "" : pick(n === 1 ? [" +1", " ve eşi", " ve bir misafiri"] : [` +${n}`, ` ve ${["", "", "iki", "üç"][n]} misafiri`]);
  const withT = chance(0.45), name = person(true);
  const verb = extra.startsWith(" ve") ? (extra.endsWith("eşi") ? extra.replace("eşi", "eşini") : extra + "ni") : extra;
  if (withT) return [pick([`${tsfx(t, "dat")} ${name}${verb} ekle`, `${name}${verb} ekle, ${tsfx(t, "dat")} oturt`.replace(/(.*),.*/, `$1 ve ${tsfx(t, "dat")} oturt`)]), [St("addGuest", { name, pax: n + 1 }), St("assign", { guest: name, table: t })]];
  return [pick([`${name}${verb} ekle`, `Yeni misafir: ${name}${extra}`, `listeye ${name}${verb} ekle`, ...(extra ? [] : [`${sfx(name, "acc")} listeye ekle`, `${sfx(name, "acc")} da ekle`])]), St("addGuest", { name, pax: n + 1 })];
}
function command() {
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
  ...readLines("deep.jsonl").map((d) => d.text), ...readLines("fresh.jsonl").map((d) => d.text), ...R.EXAMPLES.map((e) => e[0])].map(norm));
const banned = new Set();
for (const e of fx.events) { for (const g of e.guests) g.name.split(/\s+/).forEach((w) => banned.add(norm(w))); e.name.split(/\s+/).filter((w) => w.length > 3 && !/konser|gala/i.test(w)).forEach((w) => banned.add(norm(w))); e.venue.split(/\s+/).forEach((w) => banned.add(norm(w))); }
["burak", "sahin", "selin", "ak", "deniz", "yurt", "okan", "er", "elif", "sen", "can", "ozturk", "zeynep", "arslan", "mehmet", "kaya", "ahmet", "yilmaz", "ayse", "demir", "tarkan", "sezen", "aksu", "mabel", "matiz", "harbiye", "zorlu", "yilbasi"].forEach((w) => banned.add(w));
for (const pool of [FIRST, LAST, ARTISTS, VENUES]) for (const x of pool) for (const w of norm(x).split(" ")) if (banned.has(w)) throw new Error(`pool word "${x}" is a test word`);

// ---- write ------------------------------------------------------------------------
const out = arg("out"), N = Number(arg("n", 2400));
fs.mkdirSync(out, { recursive: true });
const shots = R.EXAMPLES.map(([u, a]) => [u, JSON.stringify(a)]);
const seen = new Set(), counts = {};
let n = 0, skipped = 0;
const f = fs.openSync(path.join(out, "items.jsonl"), "w");
while (n < N) {
  const r = rnd();
  let [text, reading] = r < 0.42 ? question() : r < 0.93 ? command() : [pick(SMALL), Ur()];
  [text, reading] = finish(text, reading, reading.kind === "question");
  const key = norm(text);
  if (testTexts.has(key) || seen.has(key) || key.split(" ").some((w) => banned.has(w)) || !R.valid(reading)) { skipped++; continue; }
  seen.add(key);
  const sub = reading.kind === "question" ? reading.intent : reading.kind === "command" ? reading.steps.map((s) => s.op).join("+") : "unknown";
  counts[reading.kind] = (counts[reading.kind] || 0) + 1;
  fs.writeSync(f, JSON.stringify({ task: "F8", sub, q: text, system: R.SYSTEM, shots, truth: JSON.stringify(reading), level: reading.steps.length > 1 || text.length > 70 ? 3 : 2,
    family: "synth-f8", seed: Number(arg("seed", 71)), split: "train", image: null }) + "\n");
  n++;
}
fs.closeSync(f);
console.log(n, "sentences", JSON.stringify(counts), "skipped", skipped);
