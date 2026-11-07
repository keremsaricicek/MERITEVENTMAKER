// GUEST MEMORY — "has this person been with us before?" (owner-approved 2026-11-07).
//
// Pure and READ-ONLY: takes the stored events, returns a short history, writes
// nothing and copies nothing between events. A UI that offers "use last time's
// note" does it as a person's act, through the existing guest writer.
//
// THE EXISTING MATCHER. The same person across events is
// MeritAssistantTools.findPerson — folded name (ı/i, ş/s, case), all words, and
// a phone that disagrees in its last seven digits makes a different person.
// findPerson groups by the EXACT contact string, so "+90 532 111 22 33" and
// "0532 111 22 33" come back as two groups; this module joins groups of the
// same folded name only when their phones agree under findPerson's own
// last-seven rule. Same name under two different phones, with no phone on the
// record asked about, is AMBIGUOUS: both candidates are listed and no history
// is built (never merged). Every entry says what matched it: "name+phone" or
// only "name".
//
// "CAME" MEANS CHECKED IN (product rule: planned and arrived are two axes).
// A No Show is NO_SHOW; a past event with neither is NOT_RECORDED; a future
// one is UPCOMING. Nothing is inferred.
(function () {
  "use strict";

  const TOOLS = () => globalThis.MeritAssistantTools;
  const RULES = () => globalThis.MeritEventRules;
  const digits = (s) => String(s == null ? "" : s).replace(/\D+/g, "");
  const tail = (contact) => (/^\d+$/.test(contact || "") ? contact.slice(-7) : contact || "");
  const paxOf = (g) => Math.max(1, Number(g && g.pax) || 1);

  function isPast(ev) {
    const R = RULES();
    if (R && R.isHistorical) return R.isHistorical(ev);
    return ev.status === "Completed";
  }
  function outcomeOf(ev, g) {
    if (g.arrivalStatus === "Checked In") return "CAME";
    if (g.arrivalStatus === "No Show") return "NO_SHOW";
    return isPast(ev) ? "NOT_RECORDED" : "UPCOMING";
  }

  function recall(events, guest, opts) {
    const T = TOOLS();
    const list = Array.isArray(events) ? events : [];
    const name = String((guest && guest.name) || "").trim();
    if (!T || !T.findPerson || !name) return { none: true, history: [] };
    const phone = digits(guest.phone);
    const key = T.fold(name);
    const except = opts && opts.exceptEventId;
    const found = T.findPerson(list, name, phone ? { phone } : undefined);
    const same = found.people.filter((p) => T.fold(p.name) === key);
    if (!same.length) return { none: true, history: [] };

    // One identity per distinct contact under the last-seven rule; with a phone
    // asked, findPerson has already dropped every record whose phone disagrees.
    const identities = new Set(same.map((p) => tail(p.contact)).filter(Boolean));
    if (!phone && identities.size > 1) {
      const byIdentity = new Map();
      for (const p of same) {
        const id = tail(p.contact) || "";
        if (!byIdentity.has(id)) byIdentity.set(id, { name: p.name, phoneEnding: /^\d+$/.test(id) ? id.slice(-4) : null, eventIds: [] });
        byIdentity.get(id).eventIds.push(...p.records.map((r) => r.eventId));
      }
      return { ambiguous: true, people: [...byIdentity.values()], history: [] };
    }

    const history = [];
    for (const p of same) for (const r of p.records) {
      if (r.eventId === except) continue;
      const ev = list.find((e) => e.id === r.eventId);
      const g = ev && (ev.guests || []).find((x) => x.id === r.guestId);
      if (!g) continue;
      const t = g.assignment ? (ev.tables || []).find((x) => x.id === g.assignment.tableId) : null;
      history.push({
        eventId: ev.id, eventName: ev.name || "", date: ev.date || "",
        outcome: outcomeOf(ev, g),
        table: t ? String(t.number) : null,
        pax: paxOf(g), vip: g.vip || "Standard",
        notes: String(g.notes || ""), host: String(g.invitedBy || "").trim(),
        walkIn: g.walkIn === true,
        matchedBy: phone && digits(g.phone) ? "name+phone" : "name",
      });
    }
    history.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const distinct = (xs) => [...new Set(xs.filter(Boolean))];
    const count = (o) => history.filter((h) => h.outcome === o).length;
    return {
      none: history.length === 0,
      person: { name, phone: phone || null },
      history,
      summary: {
        events: history.length, came: count("CAME"), noShow: count("NO_SHOW"),
        notRecorded: count("NOT_RECORDED"), upcoming: count("UPCOMING"),
        vipMarks: distinct(history.map((h) => (h.vip !== "Standard" ? h.vip : null))),
        hosts: distinct(history.map((h) => h.host)),
        tables: distinct(history.map((h) => h.table)),
      },
    };
  }

  globalThis.MeritGuestMemory = Object.freeze({ version: 1, recall });
})();
