// THE F8 ASSISTANT'S FIRST READER — rules before the model.
//
// A sentence typed into the F8 panel is first read by these rules (fast,
// exact, offline); only what they cannot place goes to the local model
// (benchmarks/AI-PLANNER-DESIGN.md §6, §11–§12). The rules decide WHAT is
// asked or commanded and WHO / WHICH EVENT / WHICH TABLE it is about — by
// finding the names the data actually holds — and hand that to the tools
// (src/assistant-tools.js) or the acting layer (src/assistant-actions.js).
// They state no fact themselves: every number in an answer comes from the data.
//
// Pure: reads no `state` or `ui`; the events are passed in.
(function () {
  "use strict";
  const T = () => globalThis.MeritAssistantTools;
  const fold = (s) => T().fold(s);
  // a Turkish suffix after an apostrophe ("Ahmet'i", "T12'ye", "Tarkan'daki")
  const unsuffix = (s) => String(s || "").replace(/['’`][a-zçğıöşü]+/gi, "");

  // The longest guest name from the data that the sentence contains (folded,
  // word prefixes, so "ahmet yilmaz", "Ahmet'i" and "Ahmet" all find him).
  function personIn(text, events) {
    const words = fold(unsuffix(text)).split(" ");
    const names = new Set();
    for (const ev of events) for (const g of ev.guests || []) names.add(g.name);
    let best = null;
    for (const name of names) {
      const parts = fold(name).split(" ");
      for (let i = 0; i < words.length; i++) {
        let n = 0;  // consecutive name parts, each a word prefix with at most a Turkish suffix after it
        while (n < parts.length && i + n < words.length && words[i + n].startsWith(parts[n]) && words[i + n].length - parts[n].length <= 5) n++;
        if (!n || (best && (best.n > n || (best.n === n && best.at <= i)))) continue;  // more of the name wins; then the earlier one
        // a first name alone stands for the full names that start with it
        best = { name: n === parts.length ? name : words.slice(i, i + n).join(" "), n, at: i, len: n };
      }
    }
    return best;
  }
  const tables = (text) => (unsuffix(text).match(/\b(VIP\s?\d+|[TB]\s?\d{1,3})\b/gi) || []).map((x) => x.replace(/\s+/g, "").toUpperCase());
  const phone = (text) => { const m = String(text).match(/(\+?\d[\d\s]{8,}\d)/); return m ? m[1] : null; };
  // the part of the sentence that is not the person: where an event is named
  function eventPart(text, person) {
    const w = fold(unsuffix(text)).split(" ");
    return person ? w.filter((_, i) => i < person.at || i >= person.at + person.len).join(" ") : w.join(" ");
  }

  function parse(text, events, today) {
    const f = fold(unsuffix(text)), raw = String(text || "");
    const p = personIn(raw, events), tbs = tables(raw), ph = phone(raw);
    const evq = eventPart(raw, p);
    const has = (re) => re.test(f);
    // ---- commands -------------------------------------------------------------------------
    if (has(/\b(sil|kaldir|cikar|ekle|oturt|koy|al|tasi|yap|olsun)\b/)) {
      if (has(/\bherkes/) && tbs.length >= 2 && has(/\btasi/)) return { kind: "command", plan: [{ op: "moveTable", fromTable: tbs[0], table: tbs[1] }] };
      if (has(/\bekle\b/)) {
        const m = raw.match(/([A-ZÇĞİÖŞÜ][\wçğıöşüÇĞİÖŞÜ]+(?:\s+[A-ZÇĞİÖŞÜ][\wçğıöşüÇĞİÖŞÜ]+)*)\s*(?:\+\s*(\d+))?\s*ekle/);
        if (m) return { kind: "command", plan: [{ op: "addGuest", name: m[1].trim(), pax: 1 + Number(m[2] || 0), table: tbs[0] || null }] };
      }
      if (!p) return { kind: "command", plan: [{ op: "assign", guest: (raw.match(/^([^'’]+)['’]/) || [])[1] || raw.split(" ")[0], table: tbs[0] || "?" }] };
      const guest = p.name;
      if (has(/\byanina\b/)) {
        const w = fold(unsuffix(raw)).split(" "), k = w.indexOf("yanina");
        return { kind: "command", plan: [{ op: "nextTo", guest, other: w[k - 1] }] };
      }
      if (has(/\bsil\b/)) return { kind: "command", plan: [{ op: "deleteGuest", guest }] };
      if (has(/\b(masadan) (kaldir|cikar)/)) return { kind: "command", plan: [{ op: "unassign", guest }] };
      if (has(/\bvip\b/) && has(/\byap\b/)) return { kind: "command", plan: [{ op: "setVip", guest, vip: "VIP" }] };
      const plus = raw.match(/\+\s*(\d+)\s*olsun/), many = f.match(/\b(\d+) kisi olsun/);
      if (plus || many) return { kind: "command", plan: [{ op: "setPax", guest, pax: plus ? 1 + Number(plus[1]) : Number(many[1]) }] };
      if (has(/\b(yerine|masasina|yerinde|koltuguna)\b/) && !tbs.length) {
        const from = has(/\b(son|gecen|onceki)\b/) ? "son konser" : evq;
        return { kind: "command", plan: [{ op: "copySeat", guest, from, ...(ph ? { phone: ph } : {}) }] };
      }
      if (tbs.length) {
        const past = T().findEvent(events, evq, today).events.find((e) => e.past);
        return { kind: "command", plan: [{ op: "assign", guest, table: tbs[0], ...(past ? { event: past.name } : {}) }] };
      }
    }
    // ---- questions ------------------------------------------------------------------------
    if (p && has(/\b(nerede|nerde|nerelerde)\b|\b(kacinci|hangi) masa/)) return { kind: "question", intent: "seatAt", person: p.name, phone: ph, event: evq, many: has(/\bnerelerde\b/) };
    if (p && has(/\b(kac|hangi) (konser|etkinlik)/) && has(/\bgeldi/)) return { kind: "question", intent: "attended", person: p.name, phone: ph };
    if (p && has(/\bgeldi mi\b/)) return { kind: "question", intent: "seatAt", person: p.name, phone: ph, event: evq };
    if (p && has(/\bayni masa/)) return { kind: "question", intent: "sameTable", person: p.name };
    if (p && has(/\bvip\b/)) return { kind: "question", intent: "vipBefore", person: p.name };
    if (p && has(/\bkac kisi(yle)?\b/)) return { kind: "question", intent: "seatAt", person: p.name, event: evq };
    if (has(/\ben cok kisi\b/)) return { kind: "question", intent: "mostPeople" };
    if (has(/\bkac kisi\b/)) return { kind: "question", intent: "eventCount", event: evq };
    if (has(/\b(oturtulmadi|masasi yok|masaya oturmayan)/)) return { kind: "question", intent: "unassigned", event: evq };
    if (has(/\b(gelmeyen|gelmedi)/)) return { kind: "question", intent: "noShow", event: evq };
    if (tbs.length && has(/\bkim\b/)) return { kind: "question", intent: "whoAtTable", event: evq, table: tbs[0] };
    if (has(/\bhangi etkinli/)) return { kind: "question", intent: "whichEvent", event: evq };
    if (!p && has(/\b(nerede|nerde|otur)/)) return { kind: "question", intent: "seatAt", person: (raw.match(/^(\S+\s+\S+)/) || [])[1], event: evq };
    return { kind: "unknown" };
  }

  // An answer from the data for a parsed question: the facts (for the panel
  // to word) plus a plain Turkish sentence; `ask` when the person or event is
  // not one, `none` when the records do not hold it.
  function answer(q, events, today, currentId) {
    const Tl = T(), tr = (d) => { const [y, m, dd] = String(d).split("-"); return `${Number(dd)} ${["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"][Number(m) - 1]} ${y}`; };
    const seatTxt = (s) => s.table ? `${s.table}${s.seats && s.seats.length ? `, koltuk ${s.seats.map((x) => x + 1).join("–")}` : ""}` : "masası yoktu";
    const pickEvent = (text) => { let r = Tl.findEvent(events, text || "", today).events;
      // "geçen yılbaşı" is never this year's coming one
      if (/\b(gecen|onceki)\b/.test(fold(text))) r = r.filter((e) => e.past);
      return r.length === 1 ? r[0] : r.length ? { ask: `Hangi etkinlik? ${r.map((e) => e.name).join(", ")}` } : null; };
    let person = null;
    if (q.person) {
      const r = Tl.findPerson(events, q.person, q.phone ? { phone: q.phone } : null);
      if (r.none) return { none: true, text: `${q.person} için kayıt yok.` };
      if (r.ambiguous) return { ask: true, text: `${q.person} adında ${r.people.length} kişi var (${r.people.map((p) => p.contact || "iletişim yok").join(" / ")}). Hangisi? Telefonunu yazabilirsin.` };
      person = r.people[0];
    }
    if (q.intent === "attended" || q.intent === "sameTable" || q.intent === "vipBefore") {
      const h = Tl.eventsOf(events, person, today), past = h.events.filter((e) => e.past);
      if (q.intent === "attended") {
        const came = past.filter((e) => e.came), miss = past.filter((e) => !e.came);
        return { facts: h, text: `${person.name} ${came.length} etkinliğimize geldi${came.length ? ": " + came.map((e) => `${e.name} (${tr(e.date)})`).join(", ") : ""}.${miss.length ? ` Yeri olup gelmediği: ${miss.map((e) => e.name).join(", ")}.` : ""}` };
      }
      if (q.intent === "sameTable") { const tset = [...new Set(past.map((e) => e.table).filter(Boolean))]; return { facts: h, text: tset.length === 1 ? `Evet, hep ${tset[0]} masasında oturdu (${past.length} etkinlik).` : `Hayır: ${past.map((e) => `${e.name} ${e.table || "—"}`).join(", ")}.` }; }
      const v = past.filter((e) => /^VIP/i.test(e.table || ""));
      return { facts: h, text: v.length ? `Evet: ${v.map((e) => `${e.name} — ${e.table}`).join(", ")}.` : "Hayır, geçmiş etkinliklerde VIP masada oturmadı." };
    }
    if (q.intent === "seatAt") {
      if (q.many) { const h = Tl.eventsOf(events, person, today), evs = Tl.findEvent(events, q.event, today).events.map((e) => e.id); const rows = h.events.filter((e) => !evs.length || evs.includes(e.event)); return { facts: rows, text: rows.map((e) => `${e.name}: ${seatTxt(e)}${e.came ? "" : e.past ? " (gelmedi)" : ""}`).join("; ") + "." }; }
      const ev = pickEvent(q.event);
      if (!ev) return { none: true, text: "Bu etkinlik kayıtlarda yok." };
      if (ev.ask) return { ask: true, text: ev.ask };
      const s = Tl.seatOf(events, person, ev.id);
      if (!s.invited) return { none: true, text: `${person.name} ${ev.name} listesinde yok.` };
      return { facts: s, text: `${ev.name} (${tr(ev.date)}): ${person.name} ${seatTxt(s)}${s.pax > 1 ? `, ${s.pax} kişi` : ""}${ev.past ? (s.came ? " — geldi." : " — yeri vardı ama gelmedi.") : "."}` };
    }
    if (q.intent === "mostPeople") { const best = events.filter((e) => e.date < today).map((e) => Tl.eventFacts(events, e.id)).sort((a, b) => b.checkedInPax - a.checkedInPax)[0]; return { facts: best, text: `${best.name}: ${best.checkedInPax} kişi geldi.` }; }
    const ev = q.intent === "whichEvent" ? null : pickEvent(q.event || "");
    if (q.intent === "whichEvent") { const r = Tl.findEvent(events, q.event, today).events; return r.length ? { facts: r, text: r.map((e) => `${e.name} (${tr(e.date)})`).join(", ") + "." } : { none: true, text: "O zamanda bir etkinlik kaydı yok." }; }
    if (!ev) return { none: true, text: "Bu etkinlik kayıtlarda yok." };
    if (ev.ask) return { ask: true, text: ev.ask };
    const fct = Tl.eventFacts(events, ev.id);
    if (q.intent === "eventCount") return { facts: fct, text: ev.past ? `${fct.name}: ${fct.checkedInPax} kişi geldi (planlanan ${fct.plannedPax}).` : `${fct.name}: ${fct.plannedPax} kişi planlı, henüz yapılmadı.` };
    if (q.intent === "unassigned") return { facts: fct, text: fct.unassigned.length ? `Masası olmayanlar: ${fct.unassigned.join(", ")}.` : "Herkesin masası var." };
    if (q.intent === "noShow") return { facts: fct, text: fct.noShow.length ? `Gelmeyenler: ${fct.noShow.join(", ")}.` : "Gelmeyen yok." };
    if (q.intent === "whoAtTable") { const who = fct.byTable[q.table] || []; return { facts: who, text: who.length ? `${q.table}: ${who.join(", ")}.` : `${q.table} boş.` }; }
    return { ask: true, text: "Bunu anlayamadım; başka türlü yazar mısın?" };
  }

  globalThis.MeritAssistantParse = { parse, answer, personIn, tables };
})();
