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
    const ev = () => events().find((e) => e.id === current());
    const tableByNumber = (e, no) => (e.tables || []).find((t) => T().fold(t.number) === T().fold(no));
    function guestHere(e, name, opts) {
      const r = T().findPerson([e], name, opts);
      if (r.none) return { ask: `"${name}" bu etkinlikte yok`, missing: name };
      if (r.ambiguous) return { ask: `"${name}" adında ${r.people.length} kişi var — hangisi?` };
      const recs = r.people[0].records;
      if (recs.length > 1) return { ask: `"${name}" adında ${recs.length} kayıt var — hangisi?` };
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
      if (!e) return { ask: "açık etkinlik yok" };
      if (!canMutate(e)) return { refuse: "geçmiş bir etkinlik değiştirilemez" };
      const out = [];
      for (const st of plan) {
        if (st.event && T().findEvent(events(), st.event, today()).events.some((x) => x.id !== e.id && x.past)) return { refuse: "geçmiş bir etkinlik değiştirilemez" };
        if (st.op === "addGuest") { out.push({ op: "addGuest", name: st.name, pax: st.pax || 1, table: st.table || null }); continue; }
        if (st.op === "moveTable") {  // everyone at one table to another — no guest named
          const from = tableByNumber(e, st.fromTable), to = tableByNumber(e, st.table);
          if (!from || !to) return { ask: `${!from ? st.fromTable : st.table} bu etkinlikte yok` };
          for (const x of e.guests.filter((x) => x.assignment && x.assignment.tableId === from.id)) out.push({ op: "assign", guestId: x.id, name: x.name, tableId: to.id, number: to.number, seats: null });
          continue;
        }
        const g = guestHere(e, st.guest, st.phone ? { phone: st.phone } : null);
        if (g.ask) return { ask: g.ask };
        if (st.op === "assign" || st.op === "copySeat") {
          let tableNo = st.table, seats = st.seats || null;
          if (st.op === "copySeat") {
            const fromEv = T().findEvent(events(), st.from, today()).events.filter((x) => x.id !== e.id);
            if (fromEv.length !== 1) return { ask: fromEv.length ? "hangi etkinlik?" : `"${st.from}" bulunamadı` };
            const who = T().findPerson(events(), g.guest.name, g.guest.phone ? { phone: g.guest.phone } : null);
            if (who.ambiguous) return { ask: `"${g.guest.name}" adında birden fazla kişi var — hangisi?` };
            const s = T().seatOf(events(), who.people[0], fromEv[0].id);
            if (!s.invited || !s.table) return { ask: `${g.guest.name} o etkinlikte bir masada değildi` };
            tableNo = s.table; seats = s.seats;
          }
          const table = tableByNumber(e, tableNo);
          if (!table) return { ask: `${tableNo} bu etkinlikte yok` };
          if (g.guest.assignment && g.guest.assignment.tableId === table.id && (!seats || JSON.stringify(g.guest.assignment.seats) === JSON.stringify(seats))) { out.push({ op: "noop", line: `${g.guest.name} zaten ${table.number}` }); continue; }
          if (seats && !seatsFree(e, table, seats, g.guest.id)) return { ask: `${table.number} masasındaki o koltuk dolu — başka koltuk olsun mu?` };
          out.push({ op: "assign", guestId: g.guest.id, name: g.guest.name, tableId: table.id, number: table.number, seats });
        } else if (st.op === "nextTo") {  // the same table as another guest of this event
          const o = guestHere(e, st.other);
          if (o.ask) return { ask: o.ask };
          if (!o.guest.assignment) return { ask: `${o.guest.name} bu etkinlikte henüz bir masada değil` };
          const table = (e.tables || []).find((t) => t.id === o.guest.assignment.tableId);
          out.push({ op: "assign", guestId: g.guest.id, name: g.guest.name, tableId: table.id, number: table.number, seats: null });
        } else if (st.op === "unassign") out.push({ op: "unassign", guestId: g.guest.id, name: g.guest.name });
        else if (st.op === "deleteGuest") out.push({ op: "deleteGuest", guestId: g.guest.id, name: g.guest.name });
        else if (st.op === "setPax") out.push({ op: "setPax", guestId: g.guest.id, name: g.guest.name, pax: st.pax });
        else if (st.op === "setVip") out.push({ op: "setVip", guestId: g.guest.id, name: g.guest.name, vip: st.vip });
        else return { ask: "bunu anlayamadım" };
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
        if (s.op === "assign") { writers.assign(s.guestId, s.tableId, s.seats); lines.push(`${s.name} → ${s.number}${s.seats ? ` (koltuk ${s.seats.map((x) => x + 1).join(", ")})` : ""}`); }
        else if (s.op === "unassign") { writers.unassign(s.guestId); lines.push(`${s.name} masadan kaldırıldı`); }
        else if (s.op === "deleteGuest") { writers.deleteGuest(s.guestId); lines.push(`${s.name} silindi`); }
        else if (s.op === "setPax") { writers.setPax(s.guestId, s.pax); lines.push(`${s.name}: ${s.pax} kişi`); }
        else if (s.op === "setVip") { writers.setVip(s.guestId, s.vip); lines.push(`${s.name}: ${s.vip}`); }
        else if (s.op === "addGuest") {
          newId = writers.addGuest(s.name, s.pax); lines.push(`${s.name}${s.pax > 1 ? ` +${s.pax - 1}` : ""} eklendi`);
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
