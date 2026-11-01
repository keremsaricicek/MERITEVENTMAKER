// THE F8 ASSISTANT'S SECOND READER — what a local chat model is asked, and how
// its answer is taken (benchmarks/AI-PLANNER-DESIGN.md §6, §11–§12;
// training/README.md "Chat-model race").
//
// The rules (src/assistant-parse.js) read a sentence first. Only what they call
// "unknown" goes, through the relay (/vlm-relay/read), to a chat model on THIS
// machine, which returns the rules' own shape as JSON — never an answer, never a
// fact: the same answer() and acting layer then work from the data. This file
// is the ONE source of the instruction, the worked examples and the schema, for
// the relay that sends them and for training/assistant_race.mjs that measured
// them: what is served is word for word what was measured.
//
// The sentence is the person's own; anything else in it (a guest's note, a
// plan's printed word pasted in) is data the model reads, never an instruction
// it obeys: the schema admits nothing but a reading, and the acting layer
// changes nothing a person could not change by hand.
//
// Pure: reads no `state` or `ui`.
(function () {
  "use strict";
  const T = () => globalThis.MeritAssistantTools;
  const INTENTS = ["seatAt", "attended", "sameTable", "vipBefore", "mostPeople", "eventCount", "unassigned", "noShow", "whoAtTable", "whichEvent"];
  const OPS = ["assign", "copySeat", "nextTo", "moveTable", "unassign", "deleteGuest", "setPax", "setVip", "addGuest"];
  const S = { type: ["string", "null"] }, I = { type: ["integer", "null"] };
  const SCHEMA = { type: "object", additionalProperties: false, required: ["kind", "intent", "person", "phone", "event", "many", "table", "steps"], properties: {
    kind: { enum: ["question", "command", "unknown"] }, intent: { enum: [...INTENTS, null] }, person: S, phone: S, event: S, many: { type: "boolean" }, table: S,
    steps: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["op", "guest", "table", "from", "other", "name", "pax", "fromTable"],
      properties: { op: { enum: OPS }, guest: S, table: S, from: S, other: S, name: S, pax: I, fromTable: S } } } } };
  const SYSTEM = `Sen bir etkinlik yönetim programındaki asistanın okuyucususun. Kullanıcının cümlesini oku ve SADECE JSON ver; cevap verme, bilgi uydurma.
kind: "question" (geçmiş/şimdiki etkinlikler hakkında soru), "command" (açık etkinlikte misafir/masa değişikliği), "unknown" (anlamadıysan).
Soru ise intent:
- seatAt: bir kişi bir etkinlikte nerede oturdu / oturacak / geldi mi / kaç kişiyle geldi (person, event; birden çok etkinlik soruluyorsa many=true)
- attended: bir kişi kaç / hangi etkinliğimize geldi (person)
- sameTable: kişi hep aynı masada mı oturdu (person)
- vipBefore: kişi daha önce VIP masada oturdu mu (person)
- mostPeople: en çok kişinin geldiği etkinlik
- eventCount: bir etkinliğe kaç kişi geldi (event)
- unassigned: bir etkinlikte masası olmayanlar (event)
- noShow: bir etkinliğe gelmeyenler (event)
- whoAtTable: bir etkinlikte bir masada kim var (event, table)
- whichEvent: bir zamanda (ay, yıl) hangi etkinlik vardı (event = zamanı anlatan kelimeler)
person: cümledeki kişi adı, yazıldığı gibi ama ekleri olmadan ("Ahmet'i" → "Ahmet"). phone: yazılmışsa telefon. event: etkinliği anlatan kelimeler (ör. "sezen aksu konseri", "son konser", "haziran", "gecen yilbasi"), yoksa null. table: "T05", "VIP01" gibi.
Komut ise steps (sırayla):
- assign: guest'i table'a oturt / taşı / al (geçmiş bir etkinlik adı geçiyorsa from = o etkinlik)
- copySeat: guest'i bir etkinlikteki yerine oturt (from = o etkinliği anlatan kelimeler; "son/geçen konser" → "son konser")
- nextTo: guest'i other kişinin yanına oturt
- moveTable: fromTable'daki herkesi table'a taşı
- unassign: guest'i masasından kaldır (silme değil)
- deleteGuest: guest'i listeden sil
- setPax: guest'in kişi sayısı pax olsun ("+2 olsun" → pax 3)
- setVip: guest VIP olsun
- addGuest: yeni misafir ekle (name, pax; "+1" veya "ve bir misafiri" → pax 2); masası yazılmışsa ardından assign (guest = aynı ad, table)
Kullanmadığın alanlar null; many yoksa false; steps soru için boş liste.`;
  const EXAMPLES = [
    ["Zeynep Arslan Mabel Matiz'de nerede oturdu?", { kind: "question", intent: "seatAt", person: "Zeynep Arslan", phone: null, event: "mabel matiz", many: false, table: null, steps: [] }],
    ["Elif Şen kaç etkinliğimize geldi?", { kind: "question", intent: "attended", person: "Elif Şen", phone: null, event: null, many: false, table: null, steps: [] }],
    ["Sezen Aksu konserine kimler gelmedi?", { kind: "question", intent: "noShow", person: null, phone: null, event: "sezen aksu konseri", many: false, table: null, steps: [] }],
    ["Elif Şen'i T04'e oturt", { kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [{ op: "assign", guest: "Elif Şen", table: "T04", from: null, other: null, name: null, pax: null, fromTable: null }] }],
    ["Zeynep'i Tarkan konserindeki yerine koy", { kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [{ op: "copySeat", guest: "Zeynep", table: null, from: "tarkan konseri", other: null, name: null, pax: null, fromTable: null }] }],
    ["Mehmet Kaya'yı sil", { kind: "command", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [{ op: "deleteGuest", guest: "Mehmet Kaya", table: null, from: null, other: null, name: null, pax: null, fromTable: null }] }],
    ["Bugün hava nasıl?", { kind: "unknown", intent: null, person: null, phone: null, event: null, many: false, table: null, steps: [] }],
  ];

  // The short instruction a model TRAINED on the readings is asked with (runB7,
  // training/README.md): what to return is in its training, not in the prompt;
  // the schema still constrains the answer. Its chat manifest says
  // `serve.prompt: "short"`; every other reader gets the full one.
  const SYSTEM_SHORT = "Sen bir etkinlik programındaki asistanın okuyucususun. Kullanıcının cümlesini okuma JSON'una çevir; cevap verme, bilgi uydurma.";
  // The chat request for one sentence: the instruction, the worked examples, the sentence.
  function messages(text, opts) {
    if (opts && opts.prompt === "short") return [{ role: "system", content: SYSTEM_SHORT }, { role: "user", content: String(text) }];
    const m = [{ role: "system", content: SYSTEM }];
    for (const [u, a] of EXAMPLES) m.push({ role: "user", content: u }, { role: "assistant", content: JSON.stringify(a) });
    m.push({ role: "user", content: String(text) });
    return m;
  }
  // Small talk: what is neither a question about our events nor a command
  // ("Merhaba", "bana moral ver"). The model answers briefly, and is told it
  // knows nothing of the events, guests or tables — those come only from the
  // app's own data; the panel marks the reply as not resting on the data.
  const CHAT_SYSTEM = "Sen MERIT Event Maker programındaki yardımcı asistansın. Kısa (en fazla üç cümle), sıcak ve doğal Türkçe konuş. "
    + "Etkinlikler, misafirler, masalar, koltuklar ya da sayılar hakkında bilgi verme ve tahmin etme: bunları program kendi kayıtlarından cevaplar. "
    + "Böyle bir şey sorulursa, sorunun ad ve etkinlik adıyla yazılmasını iste. Bilmediğin bir şeyi bildiğini söyleme.";
  function chatMessages(text) { return [{ role: "system", content: CHAT_SYSTEM }, { role: "user", content: String(text) }]; }
  // A reading is taken only in exactly this shape; anything else is no reading.
  function valid(m) {
    const str = (v) => v === null || (typeof v === "string" && v.length <= 120);
    if (!m || typeof m !== "object" || Array.isArray(m)) return false;
    const keys = Object.keys(SCHEMA.properties);
    if (Object.keys(m).some((k) => !keys.includes(k)) || keys.some((k) => !(k in m))) return false;
    if (!["question", "command", "unknown"].includes(m.kind) || !(m.intent === null || INTENTS.includes(m.intent))) return false;
    if (![m.person, m.phone, m.event, m.table].every(str) || typeof m.many !== "boolean" || !Array.isArray(m.steps) || m.steps.length > 3) return false;
    const skeys = Object.keys(SCHEMA.properties.steps.items.properties);
    return m.steps.every((s) => s && typeof s === "object" && Object.keys(s).length === skeys.length && skeys.every((k) => k in s) && OPS.includes(s.op)
      && [s.guest, s.table, s.from, s.other, s.name, s.fromTable].every(str) && (s.pax === null || (Number.isInteger(s.pax) && s.pax >= 1 && s.pax <= 99)));
  }
  // The model's reading in parse()'s shape (src/assistant-parse.js), so the same
  // answer() and acting layer run on it. `events`/`today` resolve a past event
  // named on an assign, exactly as parse() marks it.
  //
  // GROUNDED IN THE SENTENCE (2026-11-02, training/README.md "Grounding"). With the
  // person's own `text`, every name and event word the model wrote is put back to
  // the word the person typed: a cut-off word ("okta" → "oktayı", "hazir" →
  // "haziranda") or one with a letter slipped ("burbu" → "burcu") becomes the typed
  // one, and a new guest's name is the whole name the sentence carries ("Ergin" in
  // "Oya Ergin'i …" → "Oya Ergin"). Whatever had to be repaired that way — or could
  // not be found in the sentence at all — marks the reading `loose`: the panel then
  // shows it and waits for Onayla instead of carrying it out by itself.
  const STOP = /^(bir|bi|misafir|misafiri|kisi|kisiyi|daha|listeye|liste|listede|de|da|ve|ile|diye|adinda|isimli|adli|ekle|yaz|kaydet|oturt|koy|al|tasi|gecir|sil|yap|olarak|esini|esi|esiyle|arkadasini|arkadasi|arkadaslarini|iki|uc|dort|bes|masaya|masasina|masaya|t\d+\w*|vip\d*\w*|\+\d+|\d+)$/;
  function words(text) {
    const out = [];
    for (const raw of String(text || "").split(/\s+/)) {
      if (!raw) continue;
      const [stem, ...rest] = raw.split(/['’]/);
      const clean = stem.replace(/[^\p{L}\p{N}+]+/gu, "");
      if (clean) out.push({ raw: clean, f: T().fold(clean), cut: rest.length > 0 });
    }
    return out;
  }
  // the typed word a model word stands for: {i, how: "same"|"suffix"|"repaired"} or null
  function typed(w, ws) {
    const f = T().fold(w);
    if (!f) return null;
    let i = ws.findIndex((x) => x.f === f);
    if (i >= 0) return { i, how: "same" };
    i = ws.findIndex((x) => x.f.length > f.length && T().sameWord(x.f, f) && !x.f.startsWith(f + " "));
    if (i >= 0 && ws[i].f.startsWith(f) && /^(n|y?[iuae]|n?[iu]n|[dt][ae]|[dt][ae]n|n?[ae]|y?l[ae]|il[ae]|ni|nu|ki)$/.test(ws[i].f.slice(f.length))) return { i, how: "suffix" };
    if (i >= 0) return { i, how: "repaired" };
    if (f.length >= 3) { i = ws.findIndex((x) => x.f.startsWith(f)); if (i >= 0) return { i, how: "repaired" }; }
    if (f.length >= 4) { i = ws.findIndex((x) => T().sameWord(f, x.f)); if (i >= 0) return { i, how: "repaired" }; }
    return null;
  }
  const title = (s) => s.split(" ").map((w) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1)).join(" ");
  function toParse(m, events, today, text) {
  if (!m || m.kind === "unknown") return { kind: "unknown" };
  const fold = (s) => (s == null ? "" : T().fold(String(s)));
  const ws = text == null ? null : words(text);
  let loose = false;
  // a phrase put back to the typed words (event words, a guest named)
  const back = (v) => {
    if (!ws || v == null) return v;
    return String(v).split(/\s+/).filter(Boolean).map((w) => {
      const t = typed(w, ws);
      if (!t) { loose = true; return w; }
      if (t.how === "repaired") { loose = true; return ws[t.i].raw; }
      return t.how === "suffix" ? w : ws[t.i].raw;
    }).join(" ");
  };
  // event words for a question that the sentence does not carry at all ("son konser" for "Can
  // Öztürk nerede oturuyor"): no event named — the open one is meant
  const said = (v) => {
    if (!ws || v == null) return v;
    const hits = String(v).split(/\s+/).filter(Boolean).map((w) => [w, typed(w, ws)]);
    return hits.some(([, t]) => t) ? hits.map(([w, t]) => (t && t.how === "repaired" ? ws[t.i].raw : w)).join(" ") : null;
  };
  // a NEW guest's name: the whole run of name words around what the model wrote
  const newName = (v) => {
    if (!ws || v == null) return v;
    const hits = String(v).split(/\s+/).filter(Boolean).map((w) => typed(w, ws));
    if (!hits.length || hits.some((h) => !h)) { loose = true; return v; }
    let a = Math.min(...hits.map((h) => h.i)), b = Math.max(...hits.map((h) => h.i));
    if (b - a + 1 !== hits.length) { loose = true; return v; }
    // a name the model wrote as ONE word may have lost a word of it ("Ergin" of "Oya Ergin'i")
    if (hits.length === 1) {
      if (a > 0 && !STOP.test(ws[a - 1].f) && !ws[a - 1].cut) a--;
      else if (b < ws.length - 1 && !ws[b].cut && !STOP.test(ws[b + 1].f)) b++;
    }
    const span = ws.slice(a, b + 1);
    if (span.length !== hits.length || hits.some((h) => h.how !== "same")) loose = true;
    const last = span[span.length - 1];
    let lastWord = last.raw;
    // "oktayı ekle", typed with no apostrophe: the case ending comes off, and the panel asks
    const after = ws[a + span.length];
    if (!last.cut && after && STOP.test(after.f) && /[^aeıioöuü][ıiuü]$/i.test(lastWord) && span.length > 1) { lastWord = lastWord.slice(0, -1); loose = true; }
    const name = span.slice(0, -1).map((x) => x.raw).concat(lastWord).join(" ");
    return name === name.toLocaleLowerCase("tr") ? title(name) : name;
  };
  if (m.kind === "question") return { kind: "question", intent: m.intent, person: m.person ? back(m.person) : undefined, phone: m.phone || null, event: fold(said(m.event)), many: !!m.many, table: m.table ? String(m.table).replace(/\s+/g, "").toUpperCase() : undefined };
  const steps = (m.steps || []).map((s) => {
    const o = { op: s.op };
    if (s.guest) o.guest = back(s.guest); if (s.table) o.table = String(s.table).replace(/\s+/g, "").toUpperCase(); if (s.from) o.from = fold(back(s.from));
    if (s.other) o.other = fold(back(s.other)); if (s.name) o.name = s.op === "addGuest" ? newName(s.name) : s.name; if (s.pax != null) o.pax = s.pax; if (s.fromTable) o.fromTable = String(s.fromTable).replace(/\s+/g, "").toUpperCase();
    if (s.op === "setVip") o.vip = "VIP";
    // a past event named on an assign: the acting layer refuses it (as parse() marks it)
    if (s.op === "assign" && s.from) { const past = T().findEvent(events, fold(s.from), today).events.find((e) => e.past); delete o.from; if (past) o.event = past.name; }
    return o;
  });
  // "add, then seat at the table": the acting layer takes the table on addGuest
  if (steps.length === 2 && steps[0].op === "addGuest" && steps[1].op === "assign" && !steps[0].table) { steps[0].table = steps[1].table; steps.pop(); }
  return loose ? { kind: "command", plan: steps, loose: true } : { kind: "command", plan: steps };
  }
  // May the panel carry this command out by itself (with the model sure of it)?
  // Only when nothing in it had to be repaired and every guest it names is one
  // guest of the open event.
  function grounded(parsed, text, events, currentId) {
    if (!parsed || parsed.kind !== "command") return true;
    if (parsed.loose) return false;
    const ev = (events || []).find((e) => e.id === currentId);
    if (!ev) return false;
    for (const st of parsed.plan) for (const who of [st.guest, st.other]) {
      if (!who) continue;
      const r = T().findPerson([ev], who);
      if (r.none || r.ambiguous || r.people[0].records.length !== 1) return false;
    }
    return true;
  }

  globalThis.MeritAssistantReading = Object.freeze({ INTENTS, OPS, SCHEMA, SYSTEM, SYSTEM_SHORT, EXAMPLES, CHAT_SYSTEM, messages, chatMessages, valid, toParse, grounded });
})();
