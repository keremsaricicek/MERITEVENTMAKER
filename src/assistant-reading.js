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

  // The chat request for one sentence: the instruction, the worked examples, the sentence.
  function messages(text) {
    const m = [{ role: "system", content: SYSTEM }];
    for (const [u, a] of EXAMPLES) m.push({ role: "user", content: u }, { role: "assistant", content: JSON.stringify(a) });
    m.push({ role: "user", content: String(text) });
    return m;
  }
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
  function toParse(m, events, today) {
  if (!m || m.kind === "unknown") return { kind: "unknown" };
  const fold = (s) => (s == null ? "" : T().fold(String(s)));
  if (m.kind === "question") return { kind: "question", intent: m.intent, person: m.person || undefined, phone: m.phone || null, event: fold(m.event), many: !!m.many, table: m.table ? String(m.table).replace(/\s+/g, "").toUpperCase() : undefined };
  const steps = (m.steps || []).map((s) => {
    const o = { op: s.op };
    if (s.guest) o.guest = s.guest; if (s.table) o.table = String(s.table).replace(/\s+/g, "").toUpperCase(); if (s.from) o.from = fold(s.from);
    if (s.other) o.other = fold(s.other); if (s.name) o.name = s.name; if (s.pax != null) o.pax = s.pax; if (s.fromTable) o.fromTable = String(s.fromTable).replace(/\s+/g, "").toUpperCase();
    if (s.op === "setVip") o.vip = "VIP";
    // a past event named on an assign: the acting layer refuses it (as parse() marks it)
    if (s.op === "assign" && s.from) { const past = T().findEvent(events, fold(s.from), today).events.find((e) => e.past); delete o.from; if (past) o.event = past.name; }
    return o;
  });
  // "add, then seat at the table": the acting layer takes the table on addGuest
  if (steps.length === 2 && steps[0].op === "addGuest" && steps[1].op === "assign" && !steps[0].table) { steps[0].table = steps[1].table; steps.pop(); }
  return { kind: "command", plan: steps };
  }

  globalThis.MeritAssistantReading = Object.freeze({ INTENTS, OPS, SCHEMA, SYSTEM, EXAMPLES, messages, valid, toParse });
})();
