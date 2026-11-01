// THE F8 ASSISTANT'S HANDS — a command plan in, the app's own writers called.
//
// "Ahmet'i geçen konserdeki yerine oturt" becomes, from the model, a small plan
// of steps ({op: "copySeat", guest: "Ahmet", from: "son konser"}); this module
// resolves every name and number against the data, checks each step, and only
// then calls the writers it was given. It carries a command out WITHOUT a
// confirmation — the command is the person's decision (owner, 2026-10-27) —
// but it never guesses (benchmarks/AI-PLANNER-DESIGN.md §12):
//
//   AMBIGUOUS IS A QUESTION. Two guests by that name, a table number this event
//   does not have, a seat already taken, a person with no seat to copy: nothing
//   is changed and the question comes back.
//
//   THE PAST IS NOT EDITED. A completed or past event is refused (`canMutate`,
//   injected), never changed.
//
//   ONE COMMAND, ONE UNDO. The executor takes one snapshot before the first
//   change of a command and registers a single undo for all of it.
//
//   A TABLE IS ITS NUMBER. A seat copied from another event goes to the table
//   with the SAME printed number here, and the same seat indexes — never to
//   "the table that looks like it".
//
// Injected, not reached for: it reads no `state`/`ui` and calls no `render()`.
// The app wires the real writers (assignGuestToTable through
// MeritSeatAssignment, the guest writers) when the F8 panel is built.
(function () {
  "use strict";
  const T = () => globalThis.MeritAssistantTools;

  function create(deps) {
    const { events, current, today, canMutate, writers, snapshot, registerUndo } = deps;
    // worded in the UI's language (deps.lang() "tr" | "en"; owner 2026-11-02: full Turkish and full English)
    const en = () => !!(deps.lang && deps.lang() === "en");
    const say = (trText, enText) => (en() ? enText : trText);
    const ev = () => events().find((e) => e.id === current());
    const tableByNumber = (e, no) => (e.tables || []).find((t) => T().fold(t.number) === T().fold(no));
    function guestHere(e, name, opts) {
      const r = T().findPerson([e], name, opts);
      if (r.none) return { ask: say(`"${name}" bu etkinlikte yok`, `"${name}" is not in this event`), missing: name };
      if (r.ambiguous) return { ask: say(`"${name}" adında ${r.people.length} kişi var — hangisi?`, `There are ${r.people.length} people named "${name}" — which one?`) };
      const recs = r.people[0].records;
      if (recs.length > 1) return { ask: say(`"${name}" adında ${recs.length} kayıt var — hangisi?`, `There are ${recs.length} records named "${name}" — which one?`) };
      return { guest: e.guests.find((g) => g.id === recs[0].guestId) };
    }
    function seatsFree(e, table, seats, guestId) {
      const used = new Set();
      for (const g of e.guests) if (g.id !== guestId && g.assignment && g.assignment.tableId === table.id) (g.assignment.seats || []).forEach((s) => used.add(Number(s)));
      return seats.every((s) => s < table.capacity && !used.has(s));
    }

    // Resolve and check every step first; only a plan that is wholly clear runs.
    function resolve(plan) {
      const e = ev();
      if (!e) return { ask: say("açık etkinlik yok", "no event is open") };
      if (!canMutate(e)) return { refuse: say("geçmiş bir etkinlik değiştirilemez", "a past event cannot be changed") };
      const out = [];
      for (const st of plan) {
        if (st.event && T().findEvent(events(), st.event, today()).events.some((x) => x.id !== e.id && x.past)) return { refuse: say("geçmiş bir etkinlik değiştirilemez", "a past event cannot be changed") };
        if (st.op === "addGuest") { out.push({ op: "addGuest", name: st.name, pax: st.pax || 1, table: st.table || null }); continue; }
        if (st.op === "moveTable") {  // everyone at one table to another — no guest named
          const from = tableByNumber(e, st.fromTable), to = tableByNumber(e, st.table);
          if (!from || !to) return { ask: say(`${!from ? st.fromTable : st.table} bu etkinlikte yok`, `${!from ? st.fromTable : st.table} is not in this event`) };
          for (const x of e.guests.filter((x) => x.assignment && x.assignment.tableId === from.id)) out.push({ op: "assign", guestId: x.id, name: x.name, tableId: to.id, number: to.number, seats: null });
          continue;
        }
        const g = guestHere(e, st.guest, st.phone ? { phone: st.phone } : null);
        if (g.ask) return { ask: g.ask };
        if (st.op === "assign" || st.op === "copySeat") {
          let tableNo = st.table, seats = st.seats || null;
          if (st.op === "copySeat") {
            const fromEv = T().findEvent(events(), st.from, today()).events.filter((x) => x.id !== e.id);
            if (fromEv.length !== 1) return { ask: fromEv.length ? say("hangi etkinlik?", "which event?") : say(`"${st.from}" bulunamadı`, `"${st.from}" was not found`) };
            const who = T().findPerson(events(), g.guest.name, g.guest.phone ? { phone: g.guest.phone } : null);
            if (who.ambiguous) return { ask: say(`"${g.guest.name}" adında birden fazla kişi var — hangisi?`, `More than one person is named "${g.guest.name}" — which one?`) };
            const s = T().seatOf(events(), who.people[0], fromEv[0].id);
            if (!s.invited || !s.table) return { ask: say(`${g.guest.name} o etkinlikte bir masada değildi`, `${g.guest.name} had no table at that event`) };
            tableNo = s.table; seats = s.seats;
          }
          const table = tableByNumber(e, tableNo);
          if (!table) return { ask: say(`${tableNo} bu etkinlikte yok`, `${tableNo} is not in this event`) };
          if (g.guest.assignment && g.guest.assignment.tableId === table.id && (!seats || JSON.stringify(g.guest.assignment.seats) === JSON.stringify(seats))) { out.push({ op: "noop", line: say(`${g.guest.name} zaten ${table.number}`, `${g.guest.name} is already at ${table.number}`) }); continue; }
          if (seats && !seatsFree(e, table, seats, g.guest.id)) return { ask: say(`${table.number} masasındaki o koltuk dolu — başka koltuk olsun mu?`, `That seat at ${table.number} is taken — another seat?`) };
          out.push({ op: "assign", guestId: g.guest.id, name: g.guest.name, tableId: table.id, number: table.number, seats });
        } else if (st.op === "nextTo") {  // the same table as another guest of this event
          const o = guestHere(e, st.other);
          if (o.ask) return { ask: o.ask };
          if (!o.guest.assignment) return { ask: say(`${o.guest.name} bu etkinlikte henüz bir masada değil`, `${o.guest.name} has no table in this event yet`) };
          const table = (e.tables || []).find((t) => t.id === o.guest.assignment.tableId);
          out.push({ op: "assign", guestId: g.guest.id, name: g.guest.name, tableId: table.id, number: table.number, seats: null });
        } else if (st.op === "unassign") out.push({ op: "unassign", guestId: g.guest.id, name: g.guest.name });
        else if (st.op === "deleteGuest") out.push({ op: "deleteGuest", guestId: g.guest.id, name: g.guest.name });
        else if (st.op === "setPax") out.push({ op: "setPax", guestId: g.guest.id, name: g.guest.name, pax: st.pax });
        else if (st.op === "setVip") out.push({ op: "setVip", guestId: g.guest.id, name: g.guest.name, vip: st.vip });
        else return { ask: say("bunu anlayamadım", "I could not understand that") };
      }
      return { steps: out };
    }

    // Runs a resolved plan through the writers, under one snapshot and one undo.
    function run(plan) {
      const r = resolve(plan);
      if (!r.steps) return r;
      const real = r.steps.filter((s) => s.op !== "noop");
      const lines = r.steps.filter((s) => s.op === "noop").map((s) => s.line);
      if (!real.length) return { applied: [], lines };
      const snap = snapshot(ev());
      let newId = null;
      for (const s of real) {
        if (s.op === "assign") { writers.assign(s.guestId, s.tableId, s.seats); lines.push(`${s.name} → ${s.number}${s.seats ? ` (${say("koltuk", "seat")} ${s.seats.map((x) => x + 1).join(", ")})` : ""}`); }
        else if (s.op === "unassign") { writers.unassign(s.guestId); lines.push(say(`${s.name} masadan kaldırıldı`, `${s.name} taken off the table`)); }
        else if (s.op === "deleteGuest") { writers.deleteGuest(s.guestId); lines.push(say(`${s.name} silindi`, `${s.name} deleted`)); }
        else if (s.op === "setPax") { writers.setPax(s.guestId, s.pax); lines.push(say(`${s.name}: ${s.pax} kişi`, `${s.name}: ${s.pax} people`)); }
        else if (s.op === "setVip") { writers.setVip(s.guestId, s.vip); lines.push(`${s.name}: ${s.vip}`); }
        else if (s.op === "addGuest") {
          newId = writers.addGuest(s.name, s.pax); lines.push(`${s.name}${s.pax > 1 ? ` +${s.pax - 1}` : ""} ${say("eklendi", "added")}`);
          if (s.table) { const t = tableByNumber(ev(), s.table); if (t) { writers.assign(newId, t.id, null); lines.push(`${s.name} → ${t.number}`); } }
        }
      }
      registerUndo(snap, lines);
      return { applied: real, lines };
    }
    return { resolve, run };
  }

  globalThis.MeritAssistantActions = { create };
})();
