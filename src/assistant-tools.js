// THE F8 ASSISTANT'S READ-ONLY TOOLS — the data answers, not the model.
//
// "Ahmet Yılmaz Sezen Aksu konserinde nerede oturuyordu?" — the model decides
// WHICH of these to call and with what; every fact in the answer comes from
// here (benchmarks/AI-PLANNER-DESIGN.md §11). Nothing here writes.
//
// Pure: takes the events array, reads no `state` or `ui`. Two rules it keeps:
//
//   A PERSON IS NOT A RECORD. A guest is one record per event; the same person
//   across events is matched by name, and by phone/e-mail when the records
//   carry them. Two different phones under one name are two people — the tool
//   says so (`ambiguous`) and the assistant asks; it never merges them.
//
//   "CAME" MEANS CHECKED IN. Planned and arrived are separate axes (product
//   rule): a No Show keeps the planned seat and is reported as planned-not-
//   came, never as attended.
(function () {
  "use strict";
  const fold = (s) => String(s || "").toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const digits = (s) => String(s || "").replace(/\D+/g, "");
  const tableNo = (ev, id) => { const t = (ev.tables || []).find((x) => x.id === id); return t ? t.number : null; };

  // Every record whose name matches the query (all words, any order, folded),
  // grouped into people: same folded name AND compatible phone/e-mail.
  function findPerson(events, query, opts) {
    const words = fold(query).split(" ").filter(Boolean);
    const phone = digits(opts && opts.phone);
    const recs = [];
    for (const ev of events) for (const g of ev.guests || []) {
      const n = fold(g.name);
      if (words.length && words.every((w) => n.split(" ").some((p) => p.startsWith(w)))) {
        if (phone && digits(g.phone) && !digits(g.phone).endsWith(phone.slice(-7))) continue;
        recs.push({ eventId: ev.id, guestId: g.id, name: g.name, phone: g.phone || null, email: g.email || null });
      }
    }
    const people = [];
    for (const r of recs) {
      const key = fold(r.name), contact = digits(r.phone) || fold(r.email);
      let p = people.find((x) => x.key === key && (!contact || !x.contact || x.contact === contact));
      if (!p) { p = { key, name: r.name, contact: contact || null, records: [] }; people.push(p); }
      if (!p.contact && contact) p.contact = contact;
      p.records.push({ eventId: r.eventId, guestId: r.guestId });
    }
    const out = people.map((p) => ({ name: p.name, contact: p.contact, records: p.records }));
    return { people: out, ambiguous: out.length > 1, none: out.length === 0 };
  }

  // Events by words in the name or venue, a month name, a date, or "last"/"next"
  // relative to `today`.
  const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
  function findEvent(events, query, today) {
    const q = fold(query), now = String(today || "");
    // words every event name shares ("konser", "etkinlik") pick nothing out
    const generic = (w) => /^(konser|etkinlik|organizasyon|program|gece)/.test(w);
    const qw = q.split(" ").filter((x) => x.length > 2 && !generic(x));
    const score = (ev) => fold(ev.name + " " + (ev.venue || "")).split(" ").filter((w) => w.length > 2 && !generic(w) && qw.some((x) => w.startsWith(x) || x.startsWith(w))).length;
    const top = Math.max(0, ...events.map(score));
    let hit = top ? events.filter((ev) => score(ev) === top) : [];
    const m = MONTHS.findIndex((mo) => q.split(" ").some((x) => x.startsWith(mo)));
    if (m >= 0) hit = (hit.length ? hit : events).filter((ev) => Number(String(ev.date).slice(5, 7)) === m + 1);
    const iso = (q.match(/\b(20\d\d) (\d\d) (\d\d)\b/) || [])[0];
    if (iso) hit = events.filter((ev) => fold(ev.date) === iso);
    if (/\b(son|gecen|en son)\b/.test(q) && !hit.length) hit = events.filter((ev) => ev.date < now).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 1);
    if (/\b(sonraki|gelecek|yaklasan)\b/.test(q) && !hit.length) hit = events.filter((ev) => ev.date >= now).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 1);
    return { events: hit.map((ev) => ({ id: ev.id, name: ev.name, date: ev.date, venue: ev.venue || null, past: ev.date < now })), none: hit.length === 0 };
  }

  function seatOf(events, person, eventId) {
    const rec = (person.records || []).find((r) => r.eventId === eventId);
    const ev = events.find((e) => e.id === eventId);
    if (!rec || !ev) return { invited: false };
    const g = ev.guests.find((x) => x.id === rec.guestId);
    const a = g.assignment;
    return { invited: true, event: ev.id, table: a ? tableNo(ev, a.tableId) : null, seats: a ? a.seats || [] : [], pax: g.pax || 1,
             arrival: g.arrivalStatus || "Not Arrived", came: g.arrivalStatus === "Checked In" };
  }

  function eventsOf(events, person, today) {
    const rows = (person.records || []).map((r) => {
      const ev = events.find((e) => e.id === r.eventId);
      return Object.assign({ name: ev.name, date: ev.date, past: ev.date < String(today || "") }, seatOf(events, person, r.eventId));
    }).sort((a, b) => a.date.localeCompare(b.date));
    return { events: rows, checkedIn: rows.filter((x) => x.came).map((x) => x.event), noShow: rows.filter((x) => x.past && x.arrival === "No Show").map((x) => x.event) };
  }

  function eventFacts(events, eventId) {
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return { none: true };
    const gs = ev.guests || [], pax = (g) => g.pax || 1;
    const byTable = {};
    for (const g of gs) if (g.assignment) (byTable[tableNo(ev, g.assignment.tableId)] = byTable[tableNo(ev, g.assignment.tableId)] || []).push(g.name);
    return { event: ev.id, name: ev.name, date: ev.date, guests: gs.length, plannedPax: gs.reduce((s, g) => s + pax(g), 0),
             checkedInPax: gs.filter((g) => g.arrivalStatus === "Checked In").reduce((s, g) => s + pax(g), 0),
             noShow: gs.filter((g) => g.arrivalStatus === "No Show").map((g) => g.name),
             unassigned: gs.filter((g) => !g.assignment).map((g) => g.name), byTable };
  }

  globalThis.MeritAssistantTools = { findPerson, findEvent, seatOf, eventsOf, eventFacts, fold };
})();
